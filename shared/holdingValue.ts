/**
 * Expansion Brief Part 5 — the SINGLE mark-to-model valuation source.
 *
 * Every money-counting surface (Reconciliation, Live net worth, holdings-by-
 * instrument, Dashboard buckets, Portfolio Review, Tax Summary) values a tracked
 * "other holding" by calling THIS module — never by re-deriving units × price ×
 * FX inline or trusting a stale stored `currentValue`. One number, computed once,
 * shown many places.
 *
 * Design rules honoured here:
 *   - Price-driven value is RE-DERIVED from units × unitPrice × fxRateToKes when
 *     those structured inputs are present; otherwise we fall back to the stored
 *     currentValue (legacy manual rows) and flag it as NOT mark-to-model.
 *   - The precise behavior class (equity / reit / offshore_fund / …) is preserved
 *     even though the coarse register taxonomy collapses REIT→real_estate and
 *     offshore→etf. Labels, tax, risk and bucket classification all read the
 *     precise class.
 *   - Offshore holdings carry BOTH the native-currency amount and the KES
 *     equivalent with the FX rate and its as-of timestamp.
 *   - Provenance (source + as-of) travels with the value so any figure on any
 *     page is traceable.
 *
 * Keep this free of React / DOM / tRPC imports so it stays trivially testable.
 */

import {
  type AssetClass,
  type BehaviorProfile,
  type InsuredStatus,
  ASSET_CLASSES,
  profileFor,
} from "./assetModel";

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** The coarse register taxonomy stored in `other_holdings.assetClass`. */
export type RegisterAssetClass =
  | "real_estate"
  | "equity"
  | "etf"
  | "pension"
  | "sacco"
  | "business"
  | "crypto"
  | "insurance"
  | "other";

/**
 * Best-effort mapping from the coarse register class back to a precise behavior
 * class, used ONLY when a row has no explicit `behaviorClass` (legacy rows
 * written before Part 5). New rows always persist `behaviorClass` directly.
 */
export function behaviorClassFromRegister(rc: string | null | undefined): AssetClass | null {
  switch (rc) {
    case "equity":
      return "equity";
    case "real_estate":
      return "reit"; // property fund modeled as REIT behavior
    case "etf":
      return "offshore_fund"; // global/index fund tracked as offshore behavior
    default:
      return null; // pension / sacco / business / crypto / insurance / other → not a Part-4 class
  }
}

/** Coerce a stored behaviorClass string into a known AssetClass, else null. */
export function asAssetClass(value: string | null | undefined): AssetClass | null {
  if (value && (ASSET_CLASSES as readonly string[]).includes(value)) {
    return value as AssetClass;
  }
  return null;
}

/**
 * Resolve the precise behavior class for a holding row: prefer the explicit
 * stored `behaviorClass`, fall back to inferring from the register class.
 */
export function resolveBehaviorClass(row: {
  behaviorClass?: string | null;
  assetClass?: string | null;
}): AssetClass | null {
  return asAssetClass(row.behaviorClass) ?? behaviorClassFromRegister(row.assetClass);
}

/** True when the resolved class is valued by a market price (units × price × FX). */
export function isPriceDriven(assetClass: AssetClass | null): boolean {
  if (!assetClass) return false;
  return profileFor(assetClass).priceDriven;
}

/**
 * The raw fields THIS module needs from an `other_holdings` row. Decimal columns
 * arrive as strings from the driver; we coerce defensively.
 */
export interface HoldingValueInput {
  /** Coarse register class (other_holdings.assetClass). */
  assetClass?: string | null;
  /** Precise behavior class (other_holdings.behaviorClass), if persisted. */
  behaviorClass?: string | null;
  /** Stored KES value (fallback for legacy / non-price-driven rows). */
  currentValue?: number | string | null;
  units?: number | string | null;
  unitPrice?: number | string | null;
  currency?: string | null;
  fxRateToKes?: number | string | null;
  dataSource?: string | null;
  dataAsOf?: Date | string | number | null;
}

function num(x: unknown): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Mark-to-model KES value for a price-driven holding: units × unitPrice × FX.
 * Returns null when the structured inputs are absent (so the caller can fall
 * back to the stored value and label it as NOT mark-to-model).
 */
export function holdingMarketValue(input: HoldingValueInput): number | null {
  const units = num(input.units);
  const price = num(input.unitPrice);
  if (!(units > 0) || !(price > 0)) return null;
  const profile = profileFor(resolveBehaviorClass(input) ?? "alt");
  const fx = profile.fxExposed && num(input.fxRateToKes) > 0 ? num(input.fxRateToKes) : 1;
  return round2(units * price * fx);
}

export interface ValuedHolding {
  /** Precise behavior class (null for non-Part-4 register rows like pension). */
  behaviorClass: AssetClass | null;
  profile: BehaviorProfile | null;
  /** KES value used everywhere — mark-to-model when possible, else stored value. */
  valueKes: number;
  /** True when valueKes was re-derived as units × price × FX. */
  markToModel: boolean;
  priceDriven: boolean;
  fxExposed: boolean;
  hasMaturity: boolean;
  isLiquid: boolean;
  insured: InsuredStatus;
  /** Native-currency detail for offshore display (null when KES / not applicable). */
  native: {
    currency: string;
    units: number;
    unitPrice: number;
    amount: number; // units × unitPrice in native ccy
    fxRateToKes: number;
  } | null;
  provenance: { source: string | null; asOf: number | null };
}

/** Normalise a stored as-of value (Date | string | epoch) to epoch ms or null. */
function asOfToEpoch(v: Date | string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Produce the normalized valuation record every surface consumes. This is the
 * one place that decides a holding's KES value, whether it is mark-to-model, and
 * carries its class identity, risk flags and provenance.
 */
export function valueHolding(input: HoldingValueInput): ValuedHolding {
  const behaviorClass = resolveBehaviorClass(input);
  const profile = behaviorClass ? profileFor(behaviorClass) : null;
  const priceDriven = profile?.priceDriven ?? false;
  const fxExposed = profile?.fxExposed ?? false;

  const marked = priceDriven ? holdingMarketValue(input) : null;
  const stored = round2(num(input.currentValue));
  const valueKes = marked != null ? marked : stored;

  let native: ValuedHolding["native"] = null;
  const units = num(input.units);
  const price = num(input.unitPrice);
  const fx = num(input.fxRateToKes);
  if (fxExposed && units > 0 && price > 0 && (input.currency ?? "").toUpperCase() !== "KES") {
    native = {
      currency: (input.currency ?? "").toUpperCase() || "USD",
      units: round2(units),
      unitPrice: price,
      amount: round2(units * price),
      fxRateToKes: fx > 0 ? fx : 0,
    };
  }

  return {
    behaviorClass,
    profile,
    valueKes,
    markToModel: marked != null,
    priceDriven,
    fxExposed,
    hasMaturity: profile?.hasMaturity ?? false,
    isLiquid: profile?.isLiquid ?? false,
    insured: profile?.insured ?? "none",
    native,
    provenance: { source: input.dataSource ?? null, asOf: asOfToEpoch(input.dataAsOf) },
  };
}

/**
 * Group valued holdings into the dashboard's "holdings-by-instrument" categories.
 * Price-driven classes get their own named buckets (Equities / REITs / Offshore);
 * everything else folds into "Other assets". Returns KES value + share per bucket.
 */
export interface InstrumentBucket {
  key: string;
  label: string;
  valueKes: number;
  /** Share of the supplied total (0..1); caller passes the denominator. */
  share: number;
  markToModel: boolean;
  priceDriven: boolean;
}

const PRICE_BUCKETS: Partial<Record<AssetClass, { key: string; label: string }>> = {
  equity: { key: "equity", label: "Equities" },
  reit: { key: "reit", label: "REITs" },
  offshore_fund: { key: "offshore", label: "Offshore" },
};

export function bucketHoldingsByInstrument(
  holdings: ValuedHolding[],
  denominatorKes: number,
): InstrumentBucket[] {
  const denom = denominatorKes > 0 ? denominatorKes : 0;
  const acc = new Map<string, InstrumentBucket>();
  for (const h of holdings) {
    const spec = h.behaviorClass ? PRICE_BUCKETS[h.behaviorClass] : undefined;
    const key = spec?.key ?? "other";
    const label = spec?.label ?? "Other assets";
    const cur =
      acc.get(key) ??
      ({ key, label, valueKes: 0, share: 0, markToModel: false, priceDriven: false } as InstrumentBucket);
    cur.valueKes = round2(cur.valueKes + h.valueKes);
    cur.markToModel = cur.markToModel || h.markToModel;
    cur.priceDriven = cur.priceDriven || h.priceDriven;
    acc.set(key, cur);
  }
  const buckets = Array.from(acc.values()).filter((b) => b.valueKes > 0);
  for (const b of buckets) b.share = denom > 0 ? round2(b.valueKes / denom) : 0;
  buckets.sort((a, b) => b.valueKes - a.valueKes);
  return buckets;
}
