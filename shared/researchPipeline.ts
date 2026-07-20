/**
 * Round 81 — Research pipeline governance (PURE, framework-free).
 *
 * This module is the single source of truth for the rule that separates
 * RESEARCH INTAKE from the LIVE REFERENCE CATALOGUES:
 *
 *   raw intake (AI / scrape / manual)  →  research_updates (PENDING)
 *                                            │  a human reviews + approves
 *                                            ▼
 *                                typed promotion into ONE catalogue table
 *                                   (mmf_funds | bank_instruments | opportunities)
 *
 * Nothing here touches the database or any framework. It (a) validates a proposed
 * pending update, (b) decides which catalogue table an approved update promotes
 * into and with what typed payload, and (c) exposes the invariants the tests lock:
 *   - AI/scrape origins may NEVER be pre-approved.
 *   - A pending update always cites a source.
 *   - The promotion target is derived from the asset class, never free-chosen, so
 *     a bank deposit can't be promoted into the securities catalogue by mistake.
 *   - No score/rank/priority is ever produced — a pending update is a proposed
 *     FACT, not a recommendation.
 */

import { type AssetClass, ASSET_CLASSES, type BankInstrumentType } from "./assetModel";

/** Which live catalogue an approved update writes into. */
export type PromotionTarget = "mmf" | "bank" | "opportunity";

/** How an update originated. AI + scrape are UNTRUSTED until a human approves. */
export type UpdateOrigin = "ai" | "manual" | "scrape";

export type UpdateChangeKind = "create" | "edit";

/**
 * The canonical mapping from a catalog asset class to the reference catalogue that
 * models it. This is deliberately total over {@link AssetClass} so a new class
 * can't silently fall through to the wrong table.
 *   - cash_mmf                       → mmf_funds
 *   - bank_deposit                   → bank_instruments
 *   - gov_* / equity / reit / etc.   → opportunities (the typed reference catalogue)
 */
export function promotionTargetForAssetClass(ac: AssetClass): PromotionTarget {
  switch (ac) {
    case "cash_mmf":
      return "mmf";
    case "bank_deposit":
      return "bank";
    case "gov_discount":
    case "gov_coupon":
    case "equity":
    case "reit":
    case "offshore_fund":
    case "alt":
    default:
      return "opportunity";
  }
}

/** A proposed pending update, before it is persisted. */
export interface PendingUpdateInput {
  target?: PromotionTarget; // optional; derived from assetClass when omitted
  targetRef?: string | null;
  changeKind: UpdateChangeKind;
  name: string;
  assetClass: string; // validated against ASSET_CLASSES
  issuer?: string | null;
  currency?: string | null;
  figures?: Record<string, unknown> | null;
  source: string;
  sourceUrl?: string | null;
  asOf?: number | null;
  origin: UpdateOrigin;
  aiModel?: string | null;
  sourceKey?: string | null;
  /** Round 82 — if drafted from a research finding, its id (traceability). */
  findingId?: number | null;
  /** Round 82 — for a single-field EDIT, the figure key this update changes. */
  field?: string | null;
  /** Round 88 — the live value BEFORE this edit (captured for the audit trail). */
  oldValue?: string | null;
  /** Round 88 — the manager-vouched new value proposed by this edit. */
  managerValue?: string | null;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  /** The resolved target (derived from assetClass) when validation passes. */
  target?: PromotionTarget;
  /** The narrowed asset class when validation passes. */
  assetClass?: AssetClass;
}

function isAssetClass(v: string): v is AssetClass {
  return (ASSET_CLASSES as readonly string[]).includes(v);
}

/**
 * Validate a proposed pending update. Enforces the governance invariants without
 * any I/O so both the server and the test-suite share one implementation.
 */
export function validatePendingUpdate(input: PendingUpdateInput): ValidationResult {
  const errors: string[] = [];

  const name = (input.name ?? "").trim();
  if (name === "") errors.push("A name is required.");

  if (!isAssetClass(input.assetClass)) {
    errors.push(`Unknown asset class "${input.assetClass}".`);
  }

  // Every pending update must cite a source — an approval must be defensible.
  const source = (input.source ?? "").trim();
  if (source === "") errors.push("A source is required for every research update.");

  // An edit must point at an existing row.
  if (input.changeKind === "edit" && !(input.targetRef ?? "").trim()) {
    errors.push("An edit update must reference the catalogue row it changes (targetRef).");
  }

  // The derived target must agree with any explicitly supplied target: callers may
  // not route an update to the wrong catalogue.
  let target: PromotionTarget | undefined;
  if (isAssetClass(input.assetClass)) {
    target = promotionTargetForAssetClass(input.assetClass);
    if (input.target && input.target !== target) {
      errors.push(
        `Asset class "${input.assetClass}" promotes into "${target}", not "${input.target}".`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    target: errors.length === 0 ? target : undefined,
    assetClass: errors.length === 0 && isAssetClass(input.assetClass) ? input.assetClass : undefined,
  };
}

/**
 * Guard the approval step: AI- and scrape-originated updates are UNTRUSTED and can
 * only ever be approved by an explicit human action. This function encodes the rule
 * that intake may not mark its own proposal approved.
 */
export function canBeCreatedApproved(origin: UpdateOrigin): boolean {
  // No origin may be born approved. Approval is always a separate human step.
  return false;
}

/**
 * Whether a given origin requires a human review before it can affect the
 * catalogue. Every origin does — this exists so callers/tests read intent clearly.
 */
export function requiresHumanApproval(_origin: UpdateOrigin): boolean {
  return true;
}

/* ── Typed promotion payloads ────────────────────────────────────────────────
 * When a maintainer approves a pending update, the server promotes it into ONE
 * catalogue table. These pure builders translate the neutral `figures` payload
 * into the typed shape each catalogue expects, so the db layer just persists them.
 * They intentionally read only known keys and never fabricate a missing figure.
 */

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  // Stage 10a stripped thousands separators and a trailing "%" before parsing
  // (source text commonly keeps the "%" verbatim, e.g. "12.50%") — without it,
  // Number() returned NaN and every caller silently fell back to null/0 (the
  // Stage 9f-1 MMF repro's EAR/gross yield both promoted as 0.00%).
  // Stage 10b-1b — that fix still failed on a currency PREFIX ("KES 50,000",
  // "Ksh 50,000") or a trailing unit/word SUFFIX ("10.50% per annum"): neither
  // is stripped by a fixed set of replacements, so Number() saw "KES 50000" or
  // "10.50 per annum" and returned NaN — the Stage 10b-1 live QA repro's
  // indicativeRate/minAmount both promoted as null (displayed "Rate
  // unavailable" / "Ksh 0"). Matching the first numeric token anywhere in the
  // string (after stripping thousands separators) tolerates any prefix/suffix
  // text without needing to enumerate every currency symbol or unit word a
  // source might use.
  const stripped = String(v).replace(/,/g, "").trim();
  const match = stripped.match(/-?\d+(?:\.\d+)?/);
  const n = match ? Number(match[0]) : NaN;
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

export interface MmfPromotion {
  fundName: string;
  company: string;
  grossYield: number | null;
  ear: number | null;
  managementFee: number | null;
  minInvestment: number | null;
  /** Stage 10a — mmf_funds.whtRate is a real, already-existing column (default
   *  15%) that promotion never wrote (see the mmf contract's "wht" field note,
   *  Slice 8b) — an approved update's WHT figure was silently dropped. Null
   *  when the update never carried one, so the row's existing/default rate is
   *  left untouched rather than overwritten with a guess. */
  wht: number | null;
  /** Stage 10a — mmf_funds.aumMillions is a real, already-existing column that
   *  promotion never wrote either (only the manual Add/Edit dialog could set
   *  it) — an approved update's AUM figure was silently dropped. Null when the
   *  update never carried one. */
  aumMillions: number | null;
  /** Stage 10a — no first-class column exists; folded into mmf_funds.extendedFields
   *  (MmfProfile.withdrawalNoticePeriod) at promotion time, same as sourceEnrichment. */
  withdrawalPeriod: string | null;
  source: string;
}
export interface BankPromotion {
  bankName: string;
  instrumentType: BankInstrumentType | null;
  minAmount: number | null;
  typicalTenor: string | null;
  indicativeRate: number | null;
  isNegotiable: boolean;
  notes: string | null;
  source: string;
}
export interface OpportunityPromotion {
  ref: string;
  name: string;
  assetClass: AssetClass;
  issuer: string | null;
  currency: string;
  market: string | null;
  yieldPct: number | null;
  yieldKind: string | null;
  lastPrice: number | null;
  trailingReturnPct: number | null;
  tenorYears: number | null;
  maturityDate: string | null; // ISO yyyy-mm-dd
  expenseRatioPct: number | null;
  liquidity: string | null;
  factNote: string | null;
  source: string;
}

export type PromotionPlan =
  | { target: "mmf"; payload: MmfPromotion }
  | { target: "bank"; payload: BankPromotion }
  | { target: "opportunity"; payload: OpportunityPromotion };

/** Slugify a name into a stable-ish opportunity ref when one isn't supplied. */
export function slugRef(prefix: string, name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${prefix}-${base || "item"}`;
}

/**
 * Stage 3b.1 — canonicalize a bank product's type into the catalogue's actual
 * enum values ("call_deposit" | "fixed_deposit" | "ordinary_savings" |
 * "target_savings" | "tiered_savings"). Two problems this fixes:
 *
 *   1. The structured bank-extraction schema writes the field as `productType`,
 *      not `instrumentType` — buildPromotionPlan previously read ONLY
 *      `figures.instrumentType`, which is never populated by that path, so
 *      every structured extraction silently promoted as "fixed_deposit".
 *   2. That schema's own vocabulary ("target_goal_savings",
 *      "tiered_high_yield_savings") is LONGER than the catalogue's actual enum
 *      ("target_savings", "tiered_savings") — bankInstruments.instrumentType is
 *      a strict MySQL enum, so writing the raw long form verbatim risked an
 *      insert failure.
 *
 * Returns null for anything missing or unrecognised — callers supply their own
 * explicit fallback rather than this function inventing one, so an unknown
 * value is never silently written as a DIFFERENT valid enum value.
 */
const BANK_INSTRUMENT_TYPE_ALIASES: Record<string, BankInstrumentType> = {
  call_deposit: "call_deposit",
  fixed_deposit: "fixed_deposit",
  ordinary_savings: "ordinary_savings",
  target_savings: "target_savings",
  tiered_savings: "tiered_savings",
  // Long-form vocabulary the structured bank-extraction schema actually emits.
  target_goal_savings: "target_savings",
  tiered_high_yield_savings: "tiered_savings",
};

export function canonicalizeBankInstrumentType(value: unknown): BankInstrumentType | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return BANK_INSTRUMENT_TYPE_ALIASES[key] ?? null;
}

const BANK_INSTRUMENT_TYPE_LABELS: Record<BankInstrumentType, string> = {
  call_deposit: "Call deposit",
  fixed_deposit: "Fixed deposit",
  ordinary_savings: "Ordinary savings",
  target_savings: "Target savings",
  tiered_savings: "Tiered savings",
};

/**
 * Stage 10b-1b — human-readable label for a bank product type, wherever it's
 * displayed OUTSIDE the live catalogue table (BankInstruments.tsx already has
 * its own equivalent map for the catalogue row itself). Tolerates the same
 * raw values `canonicalizeBankInstrumentType` accepts (short enum, the
 * extraction schema's longer form, or already-canonical) so a pending
 * finding's raw `productType`/`instrumentType` figure — still "fixed_deposit"
 * before promotion ever canonicalizes it — renders cleanly in the review
 * queue and approval modal, not as a raw enum. Falls back to the raw value
 * with underscores turned to spaces for anything unrecognised — never blank,
 * never a guess at a DIFFERENT type.
 */
export function bankInstrumentTypeLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const canonical = canonicalizeBankInstrumentType(value);
  if (canonical) return BANK_INSTRUMENT_TYPE_LABELS[canonical];
  const s = String(value).trim();
  return s === "" ? null : s.replace(/_/g, " ");
}

const CBK_SECURITY_TYPE_LABELS: Record<string, string> = {
  treasury_bill: "Treasury bill",
  tbill: "Treasury bill",
  zero_coupon: "Zero-coupon bond",
  fxd: "Fixed coupon bond (FXD)",
  treasury_bond: "Treasury bond",
  ifb: "Infrastructure bond (IFB)",
  infrastructure_bond: "Infrastructure bond (IFB)",
  floating: "Floating-rate bond",
  floating_rate: "Floating-rate bond",
};

/**
 * Stage 10b-2 — human-readable label for a CBK security type, same pattern
 * and same purpose as bankInstrumentTypeLabel above: the raw figure
 * ("treasury_bill", "fxd", "ifb" — applyCbkRuleFill's convention-based
 * vocabulary and the bond extraction schema's own vocabulary both land in the
 * same `securityType` key) is never shown to a manager as a raw enum. Falls
 * back to the raw value with underscores turned to spaces for anything
 * unrecognised — never blank, never a guess at a DIFFERENT type.
 */
export function cbkSecurityTypeLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "") return null;
  const key = s.toLowerCase().replace(/[\s-]+/g, "_");
  return CBK_SECURITY_TYPE_LABELS[key] ?? s.replace(/_/g, " ");
}

/**
 * Stage 10b-2 — human-readable Yes/No for CBK's boolean-ish taxExempt figure
 * ("true"/"false" strings, as applyCbkRuleFill and the extraction schemas
 * both write it), reused wherever the raw figure value is shown outside the
 * CBK catalogue page itself (which already has its own equivalent fmtYesNo).
 * Passes anything else through unchanged — never fabricates a value.
 */
export function cbkTaxExemptLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (s === "") return null;
  const t = s.toLowerCase();
  if (t === "true") return "Yes";
  if (t === "false") return "No";
  return s;
}

/**
 * Stage 10b-2b — normalizes a date-like value to a stable "YYYY-MM-DD"
 * string. CBK sources (and the LLM extraction that reads them) commonly
 * state dates as human text ("19 October 2026"), which — unlike MMF/Bank's
 * plain numeric figures — cannot be written as-is into a typed DB date
 * column (opportunities.maturityDate is a native MySQL DATE column; the
 * live QA repro's "Approve & promote" failure was exactly this: the raw
 * string reaching a typed date column untouched).
 *
 * Two input shapes, two different safe read-backs:
 *   - An already-ISO "YYYY-MM-DD" string is returned unchanged — no Date
 *     object involved, so there is no parsing/timezone step to get wrong.
 *   - Any OTHER string (e.g. "19 October 2026") is parsed via `new Date()`,
 *     which JS treats as LOCAL midnight for non-ISO formats — so it must be
 *     read back with LOCAL getters, or the day could shift by one in a
 *     negative-UTC-offset timezone.
 *   - A Date object (e.g. what a DB driver hands back for a DATE column) is
 *     UTC-anchored — the SAME convention client/src/lib/format.ts's
 *     formatUtcYmd already established for this app's date-only DB values —
 *     so it must be read back with UTC getters instead.
 * Returns null for anything unparseable — never fabricates a date.
 */
export function normalizeDateToYmd(v: string | Date | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed === "") return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const d = new Date(trimmed);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  if (Number.isNaN(v.getTime())) return null;
  const y = v.getUTCFullYear();
  const m = String(v.getUTCMonth() + 1).padStart(2, "0");
  const day = String(v.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Stage 10b-2b — CBK net yield after WHT, computed where safely possible:
 *   - an infrastructure bond (taxExempt true) nets to its gross yield/rate
 *     (0% WHT);
 *   - otherwise, the first "N%" figure in the whtRule free text (e.g. "15%
 *     withholding tax on the discount") is treated as the WHT rate.
 * Returns null (rendered as a dash, never a raw "Missing") when yieldPct is
 * unknown/unparseable, or when whtRule doesn't state a parseable rate and
 * taxExempt isn't true. yieldPct is accepted as a raw string (e.g. "10.50%")
 * since that's what both the live catalogue's typed column and a pending
 * finding's extracted figure can hold. Reused by the CBK catalogue table,
 * the review queue, the approval modal, and the Ask AI finding card — the
 * ONE place this math lives, per Stage 10b-2's original design (moved here
 * from being CbkSecuritiesReference.tsx-local so the other three surfaces
 * can share it too).
 */
export function cbkNetYieldAfterWht(
  yieldPctRaw: string | null,
  whtRule: string | null,
  taxExempt: string | null,
): number | null {
  if (yieldPctRaw === null) return null;
  const ym = yieldPctRaw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!ym) return null;
  const y = Number(ym[0]);
  if (!Number.isFinite(y)) return null;
  if ((taxExempt ?? "").trim().toLowerCase() === "true") return y;
  const wm = (whtRule ?? "").match(/(\d+(?:\.\d+)?)\s*%/);
  if (!wm) return null;
  const whtPct = Number(wm[1]);
  if (!Number.isFinite(whtPct)) return null;
  // `y * (100 - whtPct) / 100` (one division, at the end) instead of
  // `y * (1 - whtPct / 100)` (a division INSIDE the multiplication) — the
  // latter's intermediate `whtPct / 100` compounds binary-float rounding
  // error, e.g. 10.5 * 0.85 evaluates to 8.924999999999999 in IEEE 754
  // double precision, whose .toFixed(2) rounds DOWN to "8.92" instead of
  // the mathematically-correct "8.93". The reordered form is exact for
  // this case (yields 8.925) and equally or more precise for every other
  // input tested — every display site's .toFixed(2) reads correctly.
  return (y * (100 - whtPct)) / 100;
}

/**
 * Build the typed promotion plan for an APPROVED update. Pure: the db layer calls
 * this then persists `payload` into the matching table. Throws if the asset class
 * is invalid (validation should have caught it earlier).
 */
export function buildPromotionPlan(update: {
  target: PromotionTarget;
  targetRef?: string | null;
  name: string;
  assetClass: string;
  issuer?: string | null;
  currency?: string | null;
  figures?: Record<string, unknown> | null;
  source: string;
}): PromotionPlan {
  if (!isAssetClass(update.assetClass)) {
    throw new Error(`buildPromotionPlan: invalid asset class "${update.assetClass}"`);
  }
  const f = update.figures ?? {};
  const name = update.name.trim();
  const source = update.source.trim();
  const currency = str(update.currency) ?? "KES";

  if (update.target === "mmf") {
    return {
      target: "mmf",
      payload: {
        fundName: name,
        company: str(update.issuer) ?? name,
        grossYield: num(f.grossYield ?? f.yieldPct ?? f.yield),
        ear: num(f.ear ?? f.netYield ?? f.yieldPct),
        managementFee: num(f.managementFee ?? f.expenseRatioPct ?? f.fee),
        minInvestment: num(f.minInvestment ?? f.minAmount),
        wht: num(f.wht ?? f.whtRate),
        aumMillions: num(f.aum ?? f.aumMillions),
        withdrawalPeriod: str(f.withdrawalPeriod ?? f.withdrawalNoticePeriod),
        source,
      },
    };
  }

  if (update.target === "bank") {
    return {
      target: "bank",
      payload: {
        bankName: str(update.issuer) ?? name,
        // Stage 3b.1 — figures.instrumentType (generic/manual origin) OR
        // figures.productType (the structured extraction schema's field name),
        // canonicalized to the catalogue's real enum. Falls back to
        // "fixed_deposit" only when NEITHER is a recognised value — the SAME
        // default this already had, now reached deliberately, not by omission.
        instrumentType:
          canonicalizeBankInstrumentType(f.instrumentType ?? f.productType) ?? "fixed_deposit",
        minAmount: num(f.minAmount ?? f.minInvestment),
        typicalTenor: str(f.typicalTenor ?? f.tenor),
        indicativeRate: num(f.indicativeRate ?? f.yieldPct ?? f.rate),
        isNegotiable: f.isNegotiable === undefined ? true : Boolean(f.isNegotiable),
        notes: str(f.notes ?? f.factNote),
        source,
      },
    };
  }

  // opportunity (gov securities + market assets)
  const ref = str(update.targetRef) ?? slugRef(update.assetClass.startsWith("gov") ? "gov" : "mkt", name);
  return {
    target: "opportunity",
    payload: {
      ref,
      name,
      assetClass: update.assetClass,
      issuer: str(update.issuer),
      currency,
      market: str(f.market),
      yieldPct: num(f.yieldPct ?? f.yield ?? f.coupon),
      yieldKind: str(f.yieldKind),
      lastPrice: num(f.lastPrice ?? f.price),
      trailingReturnPct: num(f.trailingReturnPct ?? f.trailingReturn),
      tenorYears: num(f.tenorYears ?? f.tenor),
      // Stage 10b-2b — opportunities.maturityDate is a typed MySQL DATE
      // column; a CBK source's human date text ("19 October 2026") reached
      // it unnormalized and failed the write. normalizeDateToYmd() is a
      // pure passthrough for an already-clean "YYYY-MM-DD" value (every
      // OTHER promotion target that ever populates this field), so this is
      // additive for CBK only, not a behavior change for anything else.
      maturityDate: normalizeDateToYmd(str(f.maturityDate)),
      expenseRatioPct: num(f.expenseRatioPct ?? f.expense ?? f.fee),
      liquidity: str(f.liquidity),
      factNote: str(f.factNote ?? f.notes),
      source,
    },
  };
}

/* ── Source cadence ──────────────────────────────────────────────────────────
 * Pure helper the daily digest uses to decide which registered sources are DUE
 * for a review. No I/O — the db layer supplies rows and `now`.
 */
export interface SourceCadenceRow {
  key: string;
  label: string;
  cadenceDays: number;
  lastReviewedAt: number | null;
  active: boolean;
}
export interface SourceDueStatus extends SourceCadenceRow {
  /** Days until (negative) or since the next review is due. */
  dueInDays: number;
  /** True when the source is at/over its cadence and needs a look. */
  isDue: boolean;
  /** True when it has never been reviewed. */
  neverReviewed: boolean;
}

export function sourceDueStatus(row: SourceCadenceRow, now: number): SourceDueStatus {
  const dayMs = 24 * 60 * 60 * 1000;
  if (row.lastReviewedAt == null) {
    return { ...row, dueInDays: 0, isDue: true, neverReviewed: true };
  }
  const nextDue = row.lastReviewedAt + row.cadenceDays * dayMs;
  const dueInDays = Math.round((nextDue - now) / dayMs);
  return { ...row, dueInDays, isDue: now >= nextDue, neverReviewed: false };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Round 82 — AI-assisted manager workbench (PURE additions).
 *
 * These helpers encode the extra governance the workbench needs, all framework-
 * free so server + client + tests share one implementation:
 *   - the four REFERENCE CATALOGUES an approved fact can land in;
 *   - the catalogue-specific REQUIRED-FIELD gate that keeps an incomplete fact
 *     pending (a manager can still approve with an explicit override, but the
 *     gate makes the incompleteness visible);
 *   - the PORTFOLIO-IMPACT descriptor that states, in plain words, whether
 *     approving a given catalogue fact moves the portfolio math — the invariant
 *     being that reference facts NEVER move money; only confirmed holdings do.
 * ════════════════════════════════════════════════════════════════════════ */

/** The four reference catalogues (macro is context, not an approvable catalogue). */
export type ReferenceCatalogue = "mmf" | "bank" | "cbk" | "market_asset";

/**
 * Map a canonical asset class to the reference catalogue a manager reviews it in.
 * This is the UI/gate-facing sibling of {@link promotionTargetForAssetClass}
 * (which speaks the db's promotion vocabulary: mmf | bank | opportunity). Here the
 * "opportunity" table is split into the two catalogues a manager actually sees:
 * CBK government securities vs. everything else (market assets).
 */
export function catalogueForAssetClass(ac: AssetClass): ReferenceCatalogue {
  switch (ac) {
    case "cash_mmf":
      return "mmf";
    case "bank_deposit":
      return "bank";
    case "gov_discount":
    case "gov_coupon":
      return "cbk";
    default:
      return "market_asset";
  }
}

/**
 * Inverse of {@link catalogueForAssetClass}: a REPRESENTATIVE canonical asset class
 * for a catalogue, so callers holding only a `ReferenceCatalogue` (e.g. an Ask-AI
 * finding, a catalogue-review draft) can drive the shared `checkApprovalGate`. The
 * gate keys off the catalogue derived from this class, so any representative member
 * of the catalogue is correct (cbk→gov_discount stands in for gov_coupon too).
 */
export function assetClassForCatalogue(c: ReferenceCatalogue): AssetClass {
  switch (c) {
    case "mmf":
      return "cash_mmf";
    case "bank":
      return "bank_deposit";
    case "cbk":
      return "gov_discount";
    case "market_asset":
      return "equity";
  }
}

/** Human label for a catalogue (plain, for chrome + audit copy). */
export function catalogueLabel(c: ReferenceCatalogue): string {
  switch (c) {
    case "mmf":
      return "MMF market";
    case "bank":
      return "Bank products";
    case "cbk":
      return "CBK securities";
    case "market_asset":
      return "Market assets";
  }
}

/**
 * Round 83 — the FULL set of fields a NEW entry in each catalogue must carry
 * before it is complete enough to publish into a live reference catalogue. These
 * are the smallest sets that make each catalogue row meaningful, defensible, and
 * the portfolio math well-defined. A single-field EDIT is exempt (it changes one
 * figure on an already-complete row). Each field is checked against the neutral
 * `figures` bag with alias tolerance; identity fields (name/issuer/currency) and
 * provenance fields (source/as-of) are checked against the update envelope.
 *
 * The `label` is the human token shown in the "still missing" list. `escapable`
 * fields may be satisfied by an explicit "marked unavailable / rate unavailable"
 * flag rather than a number (e.g. a bank rate that is genuinely not published, or
 * a market-asset price that is not quoted), so a manager can still publish a
 * meaningful reference row without inventing a figure.
 */
export interface CatalogueFieldRule {
  /** Envelope identity/provenance key, or a figures-bag key. */
  key: string;
  label: string;
  /** Where to read it from. */
  source: "figures" | "name" | "issuer" | "currency" | "provenanceSource" | "asOf";
  /** May be satisfied by an explicit "unavailable"/"missing" flag instead of a value. */
  escapable?: boolean;
  /** The figures-bag flag that marks this field explicitly unavailable. */
  escapeFlag?: string;
}

export const CATALOGUE_FIELD_RULES: Record<ReferenceCatalogue, CatalogueFieldRule[]> = {
  // MMF Market: fund name, company/manager, gross yield or EAR, management fee,
  // minimum investment, source, as-of. (AUM is optional — never required.)
  mmf: [
    { key: "name", label: "fund name", source: "name" },
    { key: "company", label: "company / manager", source: "issuer" },
    { key: "ear", label: "gross yield or EAR", source: "figures" },
    { key: "managementFee", label: "management fee", source: "figures" },
    { key: "minInvestment", label: "minimum investment", source: "figures" },
    { key: "source", label: "source", source: "provenanceSource" },
    { key: "asOf", label: "as-of date", source: "asOf" },
  ],
  // Bank Product Catalogue: bank, product type, minimum amount, tenor/notice
  // (unless fully liquid), indicative rate OR explicit "rate unavailable",
  // negotiable yes/no, liquidity/withdrawal terms, source, as-of.
  bank: [
    { key: "name", label: "bank", source: "issuer" },
    { key: "instrumentType", label: "instrument type", source: "figures" },
    { key: "minAmount", label: "minimum amount", source: "figures" },
    { key: "typicalTenor", label: "tenor / notice period", source: "figures", escapable: true, escapeFlag: "fullyLiquid" },
    { key: "indicativeRate", label: "indicative rate", source: "figures", escapable: true, escapeFlag: "rateUnavailable" },
    { key: "isNegotiable", label: "negotiable (yes/no)", source: "figures" },
    // Stage 10b-1b — label rewritten from "liquidity / withdrawal terms" to
    // name the established Bank fields that actually satisfy it (see
    // figurePresent's widened "liquidity" alias list below). The old label
    // named a field ("liquidity") that Bank's extraction schema and contract
    // never produce — every bank finding failed this rule regardless of how
    // complete the source was, a false block, not a genuine gap.
    { key: "liquidity", label: "tenor / notice, early withdrawal rule, or access speed", source: "figures" },
    { key: "source", label: "source", source: "provenanceSource" },
    { key: "asOf", label: "as-of date", source: "asOf" },
  ],
  // CBK Securities Reference: security type, tenor, rate/coupon/previous avg rate,
  // WHT rule, tax-exempt flag, maturity rule, source, as-of. (Issue number,
  // auction date, value date are captured where applicable but not hard-required.)
  cbk: [
    { key: "securityType", label: "security type", source: "figures" },
    { key: "tenor", label: "tenor", source: "figures" },
    { key: "yieldPct", label: "rate / coupon / previous average rate", source: "figures" },
    { key: "whtRule", label: "WHT rule", source: "figures" },
    { key: "taxExempt", label: "tax-exempt flag", source: "figures" },
    { key: "maturityRule", label: "maturity rule", source: "figures" },
    { key: "source", label: "source", source: "provenanceSource" },
    { key: "asOf", label: "as-of date", source: "asOf" },
  ],
  // Market Assets Reference: asset class, name, issuer/manager, market, currency,
  // source, as-of, AND at least one of price / NAV / yield / return (else the row
  // must be explicitly marked missing with a manager override).
  market_asset: [
    { key: "name", label: "name", source: "name" },
    { key: "issuer", label: "issuer / manager", source: "issuer" },
    { key: "market", label: "market", source: "figures" },
    { key: "currency", label: "currency", source: "currency" },
    { key: "lastPrice", label: "price / NAV / yield / return", source: "figures", escapable: true, escapeFlag: "figuresUnavailable" },
    { key: "source", label: "source", source: "provenanceSource" },
    { key: "asOf", label: "as-of date", source: "asOf" },
  ],
};

/* ── Round 3 — CBK Securities sub-type tightening ────────────────────────────
 * `CATALOGUE_FIELD_RULES.cbk` above is the BASELINE every CBK security must meet
 * (security type, tenor, a rate, WHT rule, tax-exempt flag, maturity rule, source,
 * as-of). Treasury bills, FXD bonds and infrastructure bonds are meaningfully
 * different instruments, so each also carries its OWN required fields on top of
 * that baseline. This is ADDITIVE and only fires when the sub-type is confidently
 * detected — an undetectable sub-type ("unknown") gets no extra requirements, so
 * behaviour for anything we can't classify is unchanged from before this rule.
 */

/** A Treasury bill (discount, no coupon), an FXD (taxed coupon bond), or an
 *  infrastructure bond (tax-exempt coupon bond). */
export type CbkSubtype = "tbill" | "fxd" | "ifb";

/**
 * Detect a CBK security's sub-type from its figures bag + name. Two extraction
 * paths write `securityType` with DIFFERENT vocabularies — the structured-extraction
 * path writes "fxd" / "ifb" / "zero_coupon" (etc.), the deterministic rule-fill path
 * (`applyCbkRuleFill`) writes "treasury_bill" / "infrastructure_bond" /
 * "treasury_bond" — so this tolerates both, plus a name-based fallback for a finding
 * where the model never populated `securityType` at all. Returns `null` (not a
 * subtype) when nothing is confidently detected — callers must NOT tighten
 * requirements for an undetected instrument.
 */
export function detectCbkSubtype(
  figures: Record<string, unknown> | null | undefined,
  instrumentName?: string | null,
): CbkSubtype | null {
  const f = figures ?? {};
  const tenorDays = Number(f.tenorDays);
  if (Number.isFinite(tenorDays) && [91, 182, 364].includes(tenorDays)) return "tbill";

  const st = String(f.securityType ?? "").toLowerCase();
  if (/ifb|infrastructure/.test(st)) return "ifb";
  if (/tbill|treasury_bill|zero_coupon/.test(st)) return "tbill";
  if (/fxd|treasury_bond|floating/.test(st)) return "fxd";

  const name = (instrumentName ?? "").toLowerCase();
  if (/ifb|infrastructure/.test(name)) return "ifb";
  if (/t-?bill|treasury bill/.test(name)) return "tbill";
  if (/fxd|treasury bond|\bbond\b/.test(name)) return "fxd";

  return null;
}

/** The ADDITIONAL fields each CBK sub-type requires, on top of the cbk baseline. */
export const CBK_SUBTYPE_FIELD_RULES: Record<CbkSubtype, CatalogueFieldRule[]> = {
  tbill: [
    { key: "auctionDate", label: "auction date", source: "figures" },
    { key: "valueDate", label: "value / settlement date", source: "figures" },
  ],
  fxd: [
    { key: "issueNumber", label: "issue number", source: "figures" },
    { key: "couponRate", label: "coupon rate", source: "figures" },
    { key: "maturityDate", label: "maturity date", source: "figures" },
  ],
  ifb: [
    { key: "issueNumber", label: "issue number", source: "figures" },
    { key: "couponRate", label: "coupon rate", source: "figures" },
    { key: "maturityDate", label: "maturity date", source: "figures" },
  ],
};

/* ── Stage 3b.3 — Market-asset sub-type tightening (REIT / offshore fund) ────
 * `CATALOGUE_FIELD_RULES.market_asset` above is the BASELINE every market asset
 * must meet. Unlike CBK, NO separate sub-type detector is needed here: since
 * Stage 3b.2, `assetClass` itself reliably distinguishes "reit" and
 * "offshore_fund" from "equity"/"alt" whenever the source stated the type
 * unambiguously, so checkApprovalGate branches directly on the assetClass it
 * already receives. Hard-required (no escape flag) — a manager can still push a
 * genuinely data-scarce entry through with the existing full gate override.
 */

/** The ADDITIONAL fields REIT and offshore-fund market assets require, on top of
 *  the market_asset baseline. Equity and "alt" are unaffected. */
export const MARKET_ASSET_SUBTYPE_FIELD_RULES: Record<"reit" | "offshore_fund", CatalogueFieldRule[]> = {
  reit: [{ key: "distributionYield", label: "distribution yield", source: "figures" }],
  offshore_fund: [{ key: "expenseRatioPct", label: "expense ratio / fee", source: "figures" }],
};

/* -- Stage 3b.4b - SACCO market-asset replacement gate ---------------------
 * SACCOs still use the conservative AssetClass "alt", shared with ETFs,
 * property, pension and other alternatives. The detector therefore reads the
 * preserved extraction facts, never the class alone. When detected, SACCO uses a
 * replacement market-asset gate because exchange/price/NAV requirements do not
 * describe member share-capital and deposit terms.
 */

const KNOWN_NON_SACCO_MARKET_ASSET_TYPES = new Set([
  "equity",
  "reit",
  "offshore_fund",
  "etf",
  "property",
  "pension",
  "other",
]);

const SACCO_SPECIFIC_VALUE_KEYS = [
  "shareCapitalDividendRate",
  "depositRebateRate",
  "minimumShareCapital",
  "minimumMonthlyDeposit",
  "regulatoryStatus",
  "withdrawalTerms",
] as const;

const SACCO_FIELD_ALIASES: Record<(typeof SACCO_SPECIFIC_VALUE_KEYS)[number], string[]> = {
  shareCapitalDividendRate: ["shareCapitalDividendRate", "dividendRate"],
  depositRebateRate: ["depositRebateRate", "depositInterestRate"],
  minimumShareCapital: ["minimumShareCapital"],
  minimumMonthlyDeposit: ["minimumMonthlyDeposit", "minimumMonthlyContribution"],
  regulatoryStatus: ["regulatoryStatus"],
  withdrawalTerms: ["withdrawalTerms", "liquidity"],
};

export const SACCO_MARKET_ASSET_FIELD_RULES: CatalogueFieldRule[] = [
  { key: "name", label: "name", source: "name" },
  { key: "issuer", label: "issuer / manager", source: "issuer" },
  { key: "currency", label: "currency", source: "currency" },
  { key: "minimumShareCapital", label: "minimum share capital", source: "figures" },
  { key: "minimumMonthlyDeposit", label: "minimum monthly deposit / contribution", source: "figures" },
  { key: "regulatoryStatus", label: "SASRA / regulatory status", source: "figures" },
  { key: "withdrawalTerms", label: "withdrawal / liquidity terms", source: "figures" },
  { key: "source", label: "source", source: "provenanceSource" },
  { key: "asOf", label: "as-of date", source: "asOf" },
];

function normaliseMarketAssetType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return key === "" ? null : key;
}

function isRealSourceValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return true;
  const text = String(value).trim();
  if (text === "") return false;
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  return ![
    "missing_from_source",
    "unavailable",
    "not_available",
    "n/a",
    "na",
    "none",
    "unknown",
    "not_applicable",
    "not_published",
    "unpublished",
    "not_disclosed",
    "not_reported",
    "not_stated",
    "not_provided",
    "not_specified",
  ].includes(key);
}

function saccoFigurePresent(figures: Record<string, unknown> | null | undefined, key: string): boolean {
  if (!figures) return false;
  const aliases = SACCO_FIELD_ALIASES[key as keyof typeof SACCO_FIELD_ALIASES] ?? [key];
  return aliases.some((alias) => isRealSourceValue(figures[alias]));
}

export function detectMarketAssetSacco(args: {
  catalogue: ReferenceCatalogue;
  assetClass: AssetClass;
  figures?: Record<string, unknown> | null;
  name?: string | null;
  issuer?: string | null;
}): boolean {
  if (args.catalogue !== "market_asset") return false;
  const figures = args.figures ?? {};
  const assetType = normaliseMarketAssetType(figures.assetType);

  if (assetType === "sacco") return true;
  if (assetType && KNOWN_NON_SACCO_MARKET_ASSET_TYPES.has(assetType)) return false;
  if (args.assetClass !== "alt") return false;

  const regulatoryStatus = isRealSourceValue(figures.regulatoryStatus) ? String(figures.regulatoryStatus) : "";
  if (/\bsacco\b|\bsasra\b/i.test(regulatoryStatus)) return true;

  const hasQuotedMarketSignal = figurePresent(figures, "market") || figurePresent(figures, "lastPrice");
  if (hasQuotedMarketSignal) return false;

  const nameIssuerText = `${args.name ?? ""} ${args.issuer ?? ""}`;
  if (/\bsacco\b|\bsasra\b/i.test(nameIssuerText)) return true;

  return SACCO_SPECIFIC_VALUE_KEYS.some((key) => saccoFigurePresent(figures, key));
}

/**
 * Back-compat: the minimal figure keys per catalogue (used by tests + the
 * portfolio-impact primary-figure lookup). Kept as the projection-relevant subset
 * of {@link CATALOGUE_FIELD_RULES}.
 */
export const CATALOGUE_REQUIRED_FIELDS: Record<ReferenceCatalogue, string[]> = {
  mmf: ["ear"],
  bank: ["indicativeRate"],
  cbk: ["yieldPct"],
  market_asset: ["lastPrice"],
};

/**
 * The single figure key that is the "primary" driver for a catalogue — the one
 * whose change is worth calling out in the portfolio-impact summary.
 */
export function primaryFigureKeyForCatalogue(c: ReferenceCatalogue): string {
  return CATALOGUE_REQUIRED_FIELDS[c][0];
}

/** Read a figure value from a neutral figures bag, tolerating common aliases. */
function figurePresent(figures: Record<string, unknown> | null | undefined, key: string): boolean {
  if (!figures) return false;
  const aliases: Record<string, string[]> = {
    ear: ["ear", "netYield", "yieldPct", "yield", "grossYield"],
    indicativeRate: ["indicativeRate", "rate", "yieldPct"],
    // Stage 10b-2b — CBK_TBILL_EXTRACTION_SCHEMA's actual field names are
    // "weightedAvgRate" and "prevAvgRate" (not "previousAvgRate", which this
    // list had instead — a spelling mismatch, not a genuinely-recognised
    // alias). The CBK contract's own yieldPct aliases (shared/catalogueField
    // Contracts.ts) already recognised "weightedAvgRate", so the finding
    // card's contract-driven display resolved 10.50% correctly while this
    // gate's separate, narrower alias list still reported "rate / coupon /
    // previous average rate" missing for the exact same value — a live QA
    // repro. "previousAvgRate" is kept for backward compatibility.
    yieldPct: ["yieldPct", "yield", "coupon", "rate", "previousAvgRate", "prevAvgRate", "weightedAvgRate"],
    lastPrice: ["lastPrice", "price", "nav", "yieldPct", "yield", "trailingReturnPct", "trailingReturn", "distributionYield"],
    managementFee: ["managementFee", "expenseRatioPct", "fee"],
    // Stage 3b.3 — market-asset sub-type fields. The extraction schema's own field
    // name is `fee`; `expenseRatioPct` is the canonical key the offshore-fund rule
    // checks against.
    expenseRatioPct: ["expenseRatioPct", "fee"],
    distributionYield: ["distributionYield"],
    minInvestment: ["minInvestment", "minAmount"],
    minAmount: ["minAmount", "minInvestment"],
    instrumentType: ["instrumentType", "productType", "type"],
    typicalTenor: ["typicalTenor", "tenor", "noticePeriod"],
    isNegotiable: ["isNegotiable", "negotiable"],
    // Stage 10b-1b — Bank's own established fields (tenor/notice, early
    // withdrawal rule, access speed) describe exactly what "liquidity /
    // withdrawal terms" is asking for; Bank's extraction schema and contract
    // have never produced a literal "liquidity" or "withdrawalTerms" key, so
    // this rule blocked every bank finding regardless of completeness. Any ONE
    // of these being present now satisfies it — the same alias-tolerance
    // mechanism SACCO's withdrawalTerms rule already relies on above.
    liquidity: [
      "liquidity",
      "withdrawalTerms",
      "typicalTenor",
      "tenor",
      "noticePeriod",
      "earlyWithdrawalPenalty",
      "earlyWithdrawalRule",
      "accessSpeed",
    ],
    securityType: ["securityType", "instrumentType", "type"],
    tenor: ["tenor", "tenorYears", "typicalTenor"],
    whtRule: ["whtRule", "wht", "withholdingTax", "whtRate"],
    taxExempt: ["taxExempt", "taxExemptFlag", "isTaxExempt"],
    maturityRule: ["maturityRule", "maturityDate", "maturity"],
    market: ["market", "segment", "exchange"],
    // CBK sub-type fields (Round 3 — tbill/fxd/ifb-specific requirements below).
    issueNumber: ["issueNumber", "issueNo", "issue_number"],
    couponRate: ["couponRate", "coupon"],
    maturityDate: ["maturityDate", "maturity"],
    auctionDate: ["auctionDate", "auction_date"],
    valueDate: ["valueDate", "value_date", "settlementDate", "settlement_date"],
  };
  const keys = aliases[key] ?? [key];
  return keys.some((k) => {
    const v = figures[k];
    // Booleans (e.g. taxExempt=false, isNegotiable=false) count as present.
    if (typeof v === "boolean") return true;
    // Stage 10b-2 — this bare truthy/non-empty check treated the
    // "missing_from_source" sentinel (and other explicit absence markers) as
    // PRESENT, a documented, previously-deferred gap (see
    // server/cbkStructuredRuleFill.test.ts's old "KNOWN DEFERRED bug" block):
    // structuredInstrumentToDraft force-fills every NEVER_INVENT_FIELDS key
    // with this sentinel for every CBK finding, so an FXD/IFB bond genuinely
    // missing its issueNumber/couponRate/maturityDate silently passed the
    // "hard, no escape" subtype gate anyway. isRealSourceValue (already used
    // by the SACCO-specific checks above) is the SAME absence-marker
    // vocabulary the rest of the pipeline already treats as "not really
    // there" — reusing it here closes the gap without inventing a new rule.
    // MMF/Bank/market_asset never pass this sentinel into gate-checked
    // figures (only CBK's extraction path force-fills it), so this is a
    // behavioural no-op for every catalogue except CBK.
    return isRealSourceValue(v);
  });
}

export interface ApprovalGateResult {
  ok: boolean;
  catalogue: ReferenceCatalogue;
  /** Human labels of the required fields that are missing (empty when ok/edit). */
  missing: string[];
  /**
   * Stage 5 — the SAME missing fields as `missing`, but structured as {key, label}
   * pairs instead of label strings, so a caller (the follow-up-question generator)
   * can work from real field keys rather than parsing label text. Purely additive:
   * `missing` is unchanged and every existing caller keeps working untouched. A
   * compound "A or B" rule (e.g. SACCO's dividend/rebate rate) uses a pipe-joined
   * key ("shareCapitalDividendRate|depositRebateRate") since no single field backs
   * it. A value-assertion rule (e.g. "tax-exempt flag must be TRUE...") reuses the
   * real field's key even though the check is "wrong value", not "absent".
   */
  missingRules?: { key: string; label: string }[];
  /** Plain-language reason when blocked. */
  reason?: string;
  /** The detected CBK sub-type (tbill/fxd/ifb), when the catalogue is "cbk" and it
   *  was confidently detected. Null for every other catalogue, an edit, or an
   *  undetected CBK sub-type — callers should not tighten requirements on null. */
  cbkSubtype?: CbkSubtype | null;
}

/**
 * Round 83 — the STRENGTHENED catalogue-specific approval gate. A `create` must
 * carry every required field for its catalogue (identity + figures + provenance),
 * checked against {@link CATALOGUE_FIELD_RULES}. Escapable fields (a genuinely
 * unpublished bank rate/tenor, or an unquoted market-asset figure) may be
 * satisfied by an explicit "unavailable" flag in the figures bag rather than a
 * number — so a manager never has to invent a value, but the gate still forces an
 * explicit acknowledgement. A single-field EDIT is exempt. A blocked create is
 * NOT rejected: it stays pending and the manager sees exactly which fields are
 * missing, and may still approve with an explicit manager-vouched override (which
 * satisfies the escapable/primary figure) or a full gate override.
 */
export function checkApprovalGate(args: {
  assetClass: AssetClass;
  changeKind: UpdateChangeKind;
  figures?: Record<string, unknown> | null;
  /** Identity/provenance envelope for the row being approved. */
  name?: string | null;
  issuer?: string | null;
  currency?: string | null;
  source?: string | null;
  asOf?: number | null;
  /** A manager override value supplied at approval — satisfies the primary figure. */
  managerValue?: string | number | null;
}): ApprovalGateResult {
  const catalogue = catalogueForAssetClass(args.assetClass);
  if (args.changeKind === "edit") {
    return { ok: true, catalogue, missing: [], missingRules: [] };
  }
  const figures = args.figures ?? {};
  const hasOverride =
    args.managerValue !== undefined && args.managerValue !== null && String(args.managerValue).trim() !== "";
  const primaryKey = primaryFigureKeyForCatalogue(catalogue);
  const nonEmpty = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

  const missing: string[] = [];
  // Stage 5 — parallel structured list (key + label) alongside `missing` (labels
  // only), so a caller can generate a targeted follow-up question from a real field
  // key instead of parsing label text. Every push into `missing` below has a
  // matching push here.
  const missingRules: { key: string; label: string }[] = [];
  const addMissingForRule = (rule: CatalogueFieldRule) => {
    // A manager-vouched override always satisfies the catalogue's PRIMARY figure.
    if (hasOverride && rule.source === "figures" && rule.key === primaryKey) return;
    // An explicit "unavailable" flag satisfies an escapable field.
    if (rule.escapable && rule.escapeFlag && figures[rule.escapeFlag] === true) return;

    let present = false;
    switch (rule.source) {
      case "figures":
        present = figurePresent(figures, rule.key);
        break;
      case "name":
        present = nonEmpty(args.name);
        break;
      case "issuer":
        present = nonEmpty(args.issuer);
        break;
      case "currency":
        present = nonEmpty(args.currency);
        break;
      case "provenanceSource":
        present = nonEmpty(args.source);
        break;
      case "asOf":
        present = args.asOf !== undefined && args.asOf !== null && Number(args.asOf) > 0;
        break;
    }
    if (!present) {
      missing.push(rule.label);
      missingRules.push({ key: rule.key, label: rule.label });
    }
  };

  const isSacco = detectMarketAssetSacco({
    catalogue,
    assetClass: args.assetClass,
    figures,
    name: args.name,
    issuer: args.issuer,
  });

  if (isSacco) {
    for (const rule of SACCO_MARKET_ASSET_FIELD_RULES) {
      if (rule.source === "figures") {
        if (!saccoFigurePresent(figures, rule.key)) {
          missing.push(rule.label);
          missingRules.push({ key: rule.key, label: rule.label });
        }
      } else {
        addMissingForRule(rule);
      }
    }
    if (
      !saccoFigurePresent(figures, "shareCapitalDividendRate") &&
      !saccoFigurePresent(figures, "depositRebateRate")
    ) {
      const label = "share-capital dividend rate or deposit rebate / interest rate";
      missing.push(label);
      // No single field backs this OR-condition — a pipe-joined compound key so a
      // caller can still recognise it as "not one field" without a third shape.
      missingRules.push({ key: "shareCapitalDividendRate|depositRebateRate", label });
    }
    if (missing.length === 0) return { ok: true, catalogue, missing: [], missingRules: [], cbkSubtype: null };
    return {
      ok: false,
      catalogue,
      missing,
      missingRules,
      reason: `${catalogueLabel(catalogue)} entries need ${missing.join(", ")} before they can be published. Add the field(s), mark them unavailable, or approve with a manager-vouched value.`,
      cbkSubtype: null,
    };
  }

  for (const rule of CATALOGUE_FIELD_RULES[catalogue]) {
    addMissingForRule(rule);
  }

  // Round 3 — CBK sub-type tightening. Additive on top of the baseline cbk rules
  // above: a T-bill/FXD/IFB carries its OWN required fields when confidently
  // detected. An undetected sub-type adds nothing, so behaviour is unchanged for
  // anything we can't classify.
  let cbkSubtype: CbkSubtype | null = null;
  if (catalogue === "cbk") {
    cbkSubtype = detectCbkSubtype(figures, args.name);
    if (cbkSubtype) {
      for (const rule of CBK_SUBTYPE_FIELD_RULES[cbkSubtype]) {
        if (!figurePresent(figures, rule.key)) {
          missing.push(rule.label);
          missingRules.push({ key: rule.key, label: rule.label });
        }
      }
      // An infrastructure bond's whole point is its 0% WHT — the baseline only checks
      // that SOME taxExempt value was recorded, not that it is actually true. Catch a
      // row that recorded taxExempt=false (or "false") on an IFB, which would otherwise
      // silently pass the baseline check.
      if (cbkSubtype === "ifb") {
        const te = figures.taxExempt;
        const isTrue = te === true || String(te).trim().toLowerCase() === "true";
        if (!isTrue) {
          const label = "tax-exempt flag must be TRUE for an infrastructure bond";
          missing.push(label);
          // A real key (taxExempt) — the check is "wrong value", not "absent".
          missingRules.push({ key: "taxExempt", label });
        }
      }
    }
  }

  // Stage 3b.3 — market-asset sub-type tightening. Additive on top of the
  // baseline market_asset rules above. Since 3b.2, `args.assetClass` itself is
  // the sub-type signal for "reit"/"offshore_fund" — no separate detector is
  // needed the way CBK required one. Equity and "alt" get no extra requirements.
  if (catalogue === "market_asset") {
    if (args.assetClass === "reit" || args.assetClass === "offshore_fund") {
      for (const rule of MARKET_ASSET_SUBTYPE_FIELD_RULES[args.assetClass]) {
        if (!figurePresent(figures, rule.key)) {
          missing.push(rule.label);
          missingRules.push({ key: rule.key, label: rule.label });
        }
      }
    }
    if (args.assetClass === "offshore_fund") {
      // An offshore fund's whole point is FX exposure — a currency of literally
      // "KES" is inconsistent with that classification. NOTE: currency defaults
      // to "KES" upstream (structuredInstrumentToDraft) whenever the source did
      // not state one at all, so this ALSO catches "currency was never actually
      // confirmed" as well as a genuine mismatch — both cases warrant the same
      // remedy: the manager states/confirms the real currency before this
      // publishes. This gate never requires an FX RATE — that is a Holdings-
      // creation concern (assetGuardIssues), not a catalogue-completeness one.
      if ((args.currency ?? "").trim().toUpperCase() === "KES") {
        const label = "currency must not be KES for an offshore fund";
        missing.push(label);
        // A real key (currency) — the check is "wrong value", not "absent".
        missingRules.push({ key: "currency", label });
      }
    }
  }

  if (missing.length === 0) return { ok: true, catalogue, missing: [], missingRules: [], cbkSubtype };
  return {
    ok: false,
    catalogue,
    missing,
    missingRules,
    reason: `${catalogueLabel(catalogue)} entries need ${missing.join(", ")} before they can be published. Add the field(s), mark them unavailable, or approve with a manager-vouched value.`,
    cbkSubtype,
  };
}

/** A deterministic, template-based follow-up question for one missing gate field. */
export interface SuggestedFollowUp {
  key: string;
  label: string;
  question: string;
}

/**
 * Stage 7c — a candidate phrase Stage 7b's structured-extraction wiring found in the
 * source text for a still-missing field (see shared/candidatePhrases.ts). Deliberately
 * a minimal STRUCTURAL shape (not an import of `CandidateMatch`) — `candidatePhrases.ts`
 * already imports `ReferenceCatalogue` from this file, so importing back would create a
 * cycle. A `CandidateMatch[]` from that module satisfies this shape without any
 * explicit conversion.
 */
export interface FollowUpCandidateHint {
  key: string;
  phrase: string;
  value: string | null;
}

/**
 * Stage 5 — turn `checkApprovalGate`'s structured `missingRules` into deterministic
 * follow-up questions a manager can send back into the SAME enquiry (reusing the
 * previous source). Pure, no LLM, no field guessing: every question ASKS about a
 * gap, it never asserts or implies a value was found. This is a template layer only
 * — the actual answer still comes from the existing Ask AI pipeline re-reading the
 * source, so nothing here can silently fill a field.
 *
 * Deliberately does NOT special-case the compound "A|B" key (SACCO's dividend/
 * rebate rate) — its label already reads naturally as one question ("...for the
 * share-capital dividend rate or deposit rebate / interest rate for..."). It DOES
 * special-case a value-assertion rule (label containing "must be"/"must not"),
 * since those read as a wrong-value confirmation, not a blank lookup.
 *
 * Stage 7c — an optional `candidates` list (keyed by rule.key) sharpens the question
 * when Stage 7b found a synonym phrase for that field: it names the exact phrase/
 * value seen and asks the manager to CONFIRM it, never states it as fact and never
 * implies the field is now satisfied. A rule with no matching candidate (or when
 * `candidates` is omitted entirely) gets the exact same generic question as before —
 * this is purely additive, never a behaviour change for the no-candidate case.
 */
export function suggestFollowUpQuestions(
  missingRules: { key: string; label: string }[],
  instrumentName: string,
  candidates?: FollowUpCandidateHint[],
): SuggestedFollowUp[] {
  const candidateByKey = new Map((candidates ?? []).map((c) => [c.key, c]));
  return missingRules.map((rule) => {
    const candidate = candidateByKey.get(rule.key);
    const question = candidate
      ? candidate.value
        ? `I found '${candidate.phrase}: ${candidate.value}' in the source. Should this be used as the ${rule.label} for this ${instrumentName}?`
        : `I found '${candidate.phrase}' in the source, near where the ${rule.label} would be. Can you check whether this is the ${rule.label} for this ${instrumentName}?`
      : /\bmust (be|not)\b/i.test(rule.label)
        ? `The source doesn't clearly confirm: ${rule.label}. Can you check ${instrumentName} again and confirm?`
        : `Can you check the source again for the ${rule.label} for this ${instrumentName}?`;
    return { key: rule.key, label: rule.label, question };
  });
}

/**
 * Portfolio-impact descriptor: what approving THIS catalogue fact does — and does
 * NOT do — to the portfolio math. The invariant this makes explicit:
 *   - A reference-catalogue fact NEVER restates an existing balance or holding.
 *   - An MMF yield change affects FUTURE projected accrual ONLY IF that fund is
 *     the portfolio's primary MMF (the fund the projection actually uses).
 *   - Bank / CBK / market-asset facts are pure reference: they inform FUTURE
 *     decisions (a next deposit, a next auction bid, a watch price) but touch no
 *     existing holding until the manager records an actual holding.
 */
export interface PortfolioImpact {
  /** True only when approving this changes any figure the projection consumes. */
  affectsProjection: boolean;
  /** True when it never touches existing money (the common, safe case). */
  referenceOnly: boolean;
  /** One-sentence plain-language explanation for the approve dialog. */
  summary: string;
}

export function describePortfolioImpact(args: {
  assetClass: AssetClass;
  /** For MMF: is the instrument the portfolio's primary (projection) fund? */
  isPrimaryMmf?: boolean;
  instrumentName?: string | null;
}): PortfolioImpact {
  const catalogue = catalogueForAssetClass(args.assetClass);
  const name = (args.instrumentName ?? "this instrument").toString();
  if (catalogue === "mmf") {
    if (args.isPrimaryMmf) {
      return {
        affectsProjection: true,
        referenceOnly: false,
        summary: `${name} is your primary MMF, so a new yield changes FUTURE projected accrual. It does not restate your current balance.`,
      };
    }
    return {
      affectsProjection: false,
      referenceOnly: true,
      summary: `${name} is a reference rate. It changes projection only if you set it as your primary MMF.`,
    };
  }
  if (catalogue === "bank") {
    return {
      affectsProjection: false,
      referenceOnly: true,
      summary: `This is an indicative bank rate. It informs your NEXT deposit; it does not change any existing fixed deposit or holding.`,
    };
  }
  if (catalogue === "cbk") {
    return {
      affectsProjection: false,
      referenceOnly: true,
      summary: `This is a government-securities reference yield. It informs FUTURE purchases; it does not revalue any bill or bond you already hold.`,
    };
  }
  return {
    affectsProjection: false,
    referenceOnly: true,
    summary: `This is a market-asset reference price. It updates the catalogue only; your net worth changes only when you record an actual holding.`,
  };
}

/**
 * Cadence helper for the SCHEDULED AGENT clock (distinct from the manual review
 * cadence in {@link sourceDueStatus}). A source is due for an automated check
 * when it has never been checked, or when `cadenceDays` have elapsed since the
 * last agent check. Long overdue (≥ 3× cadence) marks it stale.
 */
export function agentCheckDue(
  row: { cadenceDays: number; lastCheckedAt: number | null; active: boolean },
  now: number,
): { due: boolean; stale: boolean } {
  if (!row.active) return { due: false, stale: false };
  const dayMs = 24 * 60 * 60 * 1000;
  if (row.lastCheckedAt == null) return { due: true, stale: false };
  const elapsed = now - row.lastCheckedAt;
  const cadenceMs = Math.max(1, row.cadenceDays) * dayMs;
  return { due: elapsed >= cadenceMs, stale: elapsed >= cadenceMs * 3 };
}
