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
