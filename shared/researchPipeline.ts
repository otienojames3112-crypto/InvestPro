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

import { type AssetClass, ASSET_CLASSES } from "./assetModel";

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
  const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
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
  source: string;
}
export interface BankPromotion {
  bankName: string;
  instrumentType: string | null;
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
        source,
      },
    };
  }

  if (update.target === "bank") {
    return {
      target: "bank",
      payload: {
        bankName: str(update.issuer) ?? name,
        instrumentType: str(f.instrumentType) ?? "fixed_deposit",
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
      maturityDate: str(f.maturityDate),
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
 * The figure keys a NEW entry in each catalogue must carry before it is complete
 * enough to publish. A single-field EDIT is exempt (it only changes one figure on
 * an already-complete row). These are intentionally minimal — the smallest set
 * that makes the catalogue row meaningful and the portfolio math well-defined.
 */
export const CATALOGUE_REQUIRED_FIELDS: Record<ReferenceCatalogue, string[]> = {
  // An MMF is only useful in projection if we know a yield.
  mmf: ["ear"],
  // A bank product needs an indicative rate to be a reference at all.
  bank: ["indicativeRate"],
  // A government security's defining figure is its yield.
  cbk: ["yieldPct"],
  // A market asset is price-driven — a last price is the minimum.
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
    yieldPct: ["yieldPct", "yield", "coupon", "rate"],
    lastPrice: ["lastPrice", "price", "nav"],
  };
  const keys = aliases[key] ?? [key];
  return keys.some((k) => {
    const v = figures[k];
    return v !== undefined && v !== null && String(v).trim() !== "";
  });
}

export interface ApprovalGateResult {
  ok: boolean;
  catalogue: ReferenceCatalogue;
  /** Required figure keys that are missing (empty when ok, or when it's an edit). */
  missing: string[];
  /** Plain-language reason when blocked. */
  reason?: string;
}

/**
 * The catalogue-specific approval gate. A `create` must carry every required
 * figure for its catalogue; an `edit` (single-field change to an existing row) is
 * always allowed through. A blocked create is NOT rejected — it stays pending and
 * the manager sees exactly which figures are missing, and may still approve with
 * an explicit manager-vouched override value (handled server-side).
 */
export function checkApprovalGate(args: {
  assetClass: AssetClass;
  changeKind: UpdateChangeKind;
  figures?: Record<string, unknown> | null;
  /** A manager override value supplied at approval — satisfies the gate. */
  managerValue?: string | number | null;
}): ApprovalGateResult {
  const catalogue = catalogueForAssetClass(args.assetClass);
  if (args.changeKind === "edit") {
    return { ok: true, catalogue, missing: [] };
  }
  const hasOverride =
    args.managerValue !== undefined && args.managerValue !== null && String(args.managerValue).trim() !== "";
  const missing = CATALOGUE_REQUIRED_FIELDS[catalogue].filter(
    (k) => !figurePresent(args.figures, k) && !(hasOverride && k === primaryFigureKeyForCatalogue(catalogue)),
  );
  if (missing.length === 0) return { ok: true, catalogue, missing: [] };
  return {
    ok: false,
    catalogue,
    missing,
    reason: `${catalogueLabel(catalogue)} entries need ${missing.join(", ")} before they can be published. Add the figure(s), or approve with a manager-vouched value.`,
  };
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
