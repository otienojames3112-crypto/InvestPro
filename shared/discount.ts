/**
 * Discount-instrument mechanics (Round 42).
 *
 * Kenyan Treasury Bills and Zero-Coupon Bonds are DISCOUNT instruments: you pay
 * LESS than the face (redemption) value up front, receive nothing in between,
 * and are repaid the full face at maturity. The gap between what you paid and
 * the face value — the DISCOUNT — is your entire return. Withholding tax applies
 * only to that discount, never to the full face.
 *
 * This contrasts with COUPON bonds (FXD/IFB), which are bought at par (price =
 * face), pay periodic coupons, and return principal at maturity. Coupon math is
 * handled elsewhere and is intentionally NOT touched here.
 *
 * Everything in this module is framework-free, deterministic, and unit-tested
 * against CBK-style worked examples. Money figures are KES.
 */

/** Default WHT rate on T-bill / zero-coupon discount income in Kenya (%). */
export const DISCOUNT_WHT_PCT = 15;

/**
 * Price of a short-dated discount instrument (T-bill) using simple interest.
 *
 *   price = face / (1 + (rate/100) × (days / dayCount))
 *
 * This is the CBK convention. Example: a 91-day, 100,000 face bill at 15%:
 *   price = 100,000 / (1 + 0.15 × 91/365) = 96,395.06 ≈ 96,400.
 */
export function tbillPrice(
  faceValue: number,
  ratePct: number,
  days: number,
  dayCount = 365,
): number {
  const face = Math.max(0, faceValue);
  const r = Math.max(0, ratePct) / 100;
  const t = Math.max(0, days) / (dayCount > 0 ? dayCount : 365);
  if (r === 0 || t === 0) return face;
  return face / (1 + r * t);
}

/**
 * Price of a long-dated discount instrument (zero-coupon bond) using compound
 * interest, because the price gap is large over multiple years.
 *
 *   price = face / (1 + rate/100)^years
 *
 * Example: a 5-year zero-coupon, 100,000 face at ~11.84%:
 *   price = 100,000 / (1.1184)^5 ≈ 57,000.
 */
export function zeroCouponPrice(
  faceValue: number,
  ratePct: number,
  years: number,
): number {
  const face = Math.max(0, faceValue);
  const r = Math.max(0, ratePct) / 100;
  const y = Math.max(0, years);
  if (r === 0 || y === 0) return face;
  return face / Math.pow(1 + r, y);
}

/** The gross discount = the instrument's entire pre-tax return. */
export function grossDiscount(faceValue: number, purchasePrice: number): number {
  return Math.max(0, faceValue - purchasePrice);
}

/** WHT charged at maturity, applied ONLY to the discount (never the face). */
export function whtOnDiscount(
  faceValue: number,
  purchasePrice: number,
  whtPct = DISCOUNT_WHT_PCT,
): number {
  return grossDiscount(faceValue, purchasePrice) * (Math.max(0, whtPct) / 100);
}

/** Net cash received at maturity = face − WHT on the discount. */
export function maturityProceeds(
  faceValue: number,
  purchasePrice: number,
  whtPct = DISCOUNT_WHT_PCT,
): number {
  return faceValue - whtOnDiscount(faceValue, purchasePrice, whtPct);
}

/** Net (after-tax) gain on a discount instrument held to maturity. */
export function netDiscountGain(
  faceValue: number,
  purchasePrice: number,
  whtPct = DISCOUNT_WHT_PCT,
): number {
  return grossDiscount(faceValue, purchasePrice) - whtOnDiscount(faceValue, purchasePrice, whtPct);
}

/**
 * Accreted ("dirty") value of a discount instrument partway through its life.
 *
 * The lot STARTS at purchasePrice and accretes straight-line toward faceValue as
 * it ages; it must NEVER exceed faceValue. `fraction` is elapsed/tenor in [0,1].
 * This is accretion — pulling the price up to par — NOT MMF-style compounding,
 * and NOT growth above face.
 */
export function accretedValue(
  faceValue: number,
  purchasePrice: number,
  fraction: number,
): number {
  const f = Math.min(1, Math.max(0, fraction));
  const value = purchasePrice + (faceValue - purchasePrice) * f;
  // Clamp into [price, face] to guard against rounding or bad inputs.
  return Math.min(faceValue, Math.max(purchasePrice, value));
}

/**
 * Convenience: derive the price for a security given its type + rate + tenor.
 * - T-bills use simple-interest pricing over the tenor in days.
 * - Zero-coupon bonds use compound pricing over the tenor in years.
 * - Anything else (coupon bonds) is bought at par, so price === face.
 */
export function discountPriceForSecurity(args: {
  isDiscount: boolean;
  isZeroCoupon?: boolean;
  faceValue: number;
  ratePct: number;
  tenorDays?: number;
  tenorYears?: number;
}): number {
  if (!args.isDiscount) return args.faceValue;
  if (args.isZeroCoupon) {
    return zeroCouponPrice(args.faceValue, args.ratePct, args.tenorYears ?? 0);
  }
  return tbillPrice(args.faceValue, args.ratePct, args.tenorDays ?? 0);
}

/**
 * Round 48: CURRENT (mark-to-model) value of a single security as of `today`.
 *
 * This is the single source of truth for the Dashboard "Current Value" toggle on
 * the Holdings-by-Instrument card. It deliberately mirrors how the projection
 * engine treats each instrument so the two never drift:
 *
 *   - DISCOUNT instruments (T-bills, zero-coupon bonds): straight-line ACCRETION
 *     from purchasePrice toward faceValue, using elapsed/tenor between issue and
 *     maturity. Never above face. (See `accretedValue`.) If we have no
 *     purchasePrice on the lot we treat it as par and return face.
 *
 *   - COUPON bonds (FXD / IFB / floating-rate): bought at par and redeemed at
 *     par, so the clean price stays at face. We add the PRO-RATA accrued coupon
 *     since issue (couponRate% × face × elapsedDays/365) as the "dirty" value —
 *     this is the cash you'd be owed if you sold today. This is an approximation
 *     (no last-coupon reset, no benchmark re-fixing for floaters) but is
 *     deterministic and ties out with the day-by-day accrual page.
 *
 *   - MATURED lots: always worth their face value.
 *
 * All inputs are plain numbers / ISO-ish date strings (Drizzle `date` columns
 * arrive as `YYYY-MM-DD` strings or `Date`s); everything is framework-free.
 */
export interface CurrentValueSecurity {
  securityType: string;
  faceValue: number;
  purchasePrice?: number | null;
  couponRate?: number | null;
  issueDate: string | Date;
  maturityDate: string | Date;
  isMatured?: boolean | null;
}

/** Discount instrument types that accrete price → face. */
function isDiscountType(t: string): boolean {
  return t.startsWith("tbill") || t === "zero_coupon";
}

function toTime(d: string | Date): number {
  return d instanceof Date ? d.getTime() : new Date(d).getTime();
}

export function currentSecurityValue(s: CurrentValueSecurity, today: Date = new Date()): number {
  const face = Number(s.faceValue) || 0;
  if (face <= 0) return 0;

  // Matured lots redeem at face.
  if (s.isMatured) return face;

  const issue = toTime(s.issueDate);
  const maturity = toTime(s.maturityDate);
  const now = today.getTime();

  // Past maturity (even if not flagged matured yet) → face.
  if (Number.isFinite(maturity) && now >= maturity) return face;

  // Fraction of the lot's life elapsed, clamped to [0, 1].
  const span = maturity - issue;
  const fraction = span > 0 ? (now - issue) / span : 0;
  const f = Math.min(1, Math.max(0, fraction));

  if (isDiscountType(s.securityType)) {
    const price = Number(s.purchasePrice);
    // No stored price → treat as par (face) so we never under/over-state.
    if (!Number.isFinite(price) || price <= 0) return face;
    return accretedValue(face, price, f);
  }

  // Coupon bonds (fxd / ifb / floating_rate): par + pro-rata accrued coupon.
  const couponPct = Number(s.couponRate) || 0;
  const elapsedDays = span > 0 ? (f * span) / (1000 * 60 * 60 * 24) : 0;
  const accruedCoupon = face * (couponPct / 100) * (elapsedDays / 365);
  return face + Math.max(0, accruedCoupon);
}

/**
 * Round 49: How far a DISCOUNT lot has moved from its purchase price toward face.
 *
 * Returns a fraction in [0, 1] suitable for an accretion-progress bar:
 *   0   → just bought (current value == purchase price)
 *   1   → fully accreted / matured (current value == face)
 *
 * For coupon bonds (FXD/IFB) the concept doesn't apply (they sit at par), so we
 * return null and the UI should hide the bar.
 *
 * The fraction is computed from VALUE, not time, so it stays consistent with the
 * `currentSecurityValue` figure shown next to it:
 *   progress = (current − price) / (face − price)
 * When face == price (no discount) we fall back to elapsed-time fraction so a
 * zero-discount lot still shows sensible progress.
 */
export function accretionProgress(
  s: CurrentValueSecurity,
  today: Date = new Date(),
): number | null {
  if (!isDiscountType(s.securityType)) return null;

  const face = Number(s.faceValue) || 0;
  const price = Number(s.purchasePrice);
  if (face <= 0) return null;
  if (!Number.isFinite(price) || price <= 0) return null;

  if (s.isMatured) return 1;

  const maturity = toTime(s.maturityDate);
  if (Number.isFinite(maturity) && today.getTime() >= maturity) return 1;

  const current = currentSecurityValue(s, today);
  const spread = face - price;
  if (spread <= 0) {
    // No discount (price == face). Fall back to elapsed-time fraction.
    const issue = toTime(s.issueDate);
    const span = maturity - issue;
    const frac = span > 0 ? (today.getTime() - issue) / span : 0;
    return Math.min(1, Math.max(0, frac));
  }
  return Math.min(1, Math.max(0, (current - price) / spread));
}


/**
 * Duration-risk classification (Round 52).
 *
 * Given a value-weighted average days-to-maturity and a liquidity horizon (the
 * number of days within which the investor wants cash to be reachable), classify
 * how exposed the book is to being locked up beyond that horizon.
 *
 *   - "low":      weighted DTM is comfortably within the horizon (<= 60%).
 *   - "moderate": weighted DTM is approaching the horizon (<= 100%).
 *   - "elevated": weighted DTM exceeds the liquidity horizon.
 *
 * Framework-free and deterministic so it can be unit-tested and reused by both
 * the dashboard tile and any future alerts.
 */
export type DurationRisk = "low" | "moderate" | "elevated";

/** Default liquidity horizon used by the dashboard (one year). */
export const DEFAULT_LIQUIDITY_HORIZON_DAYS = 365;

export function classifyDurationRisk(
  weightedDays: number,
  horizonDays: number = DEFAULT_LIQUIDITY_HORIZON_DAYS,
): DurationRisk {
  if (!Number.isFinite(weightedDays) || weightedDays <= 0) return "low";
  if (!Number.isFinite(horizonDays) || horizonDays <= 0) return "elevated";
  const ratio = weightedDays / horizonDays;
  if (ratio <= 0.6) return "low";
  if (ratio <= 1) return "moderate";
  return "elevated";
}


/**
 * Concentration analysis (Round 57).
 *
 * For a risk snapshot we want to flag how lopsided the book is: if a single
 * instrument TYPE (T-bill / IFB / FXD / zero-coupon / floating-rate) dominates
 * the portfolio's current (mark-to-model) value, that is concentration risk —
 * the opposite of diversification. This helper groups active lots by their
 * security type, values each lot with `currentSecurityValue`, and reports the
 * single largest type's share of the total.
 *
 * It is intentionally TYPE-based (not per-CUSIP) because all CBK paper shares
 * one issuer (the Government of Kenya); the meaningful diversification axis for
 * this tracker is instrument type / tenor profile, not issuer.
 *
 * Returns null when there are no valued lots so callers can hide the line.
 */
export interface ConcentrationResult {
  /** Human-friendly label of the dominant type, e.g. "T-Bills". */
  topLabel: string;
  /** Raw security type key of the dominant type, e.g. "tbill_91". */
  topType: string;
  /** Dominant type's share of total current value, 0..1. */
  topShare: number;
  /** Current value attributed to the dominant type (KES). */
  topValue: number;
  /** Total current value across all valued lots (KES). */
  totalValue: number;
  /** How many distinct instrument types are held. */
  typeCount: number;
  /**
   * Full per-type breakdown, sorted by value descending. Each share is 0..1 of
   * totalValue. Drives the per-type concentration bar (Round 58).
   */
  breakdown: ConcentrationSlice[];
}

/** One instrument-type's slice of the portfolio's current value. */
export interface ConcentrationSlice {
  /** Raw grouped type key, e.g. "tbill", "ifb", "fxd". */
  type: string;
  /** Friendly label, e.g. "T-Bills". */
  label: string;
  /** Current value held in this type (KES). */
  value: number;
  /** Share of total current value, 0..1. */
  share: number;
}

/**
 * Classify the top concentration share against a user-set cap (Round 58).
 * `capPct` is a percentage (e.g. 60 means 60%). Returns "breached" when the
 * dominant type's share strictly exceeds the cap, else "ok".
 */
export type ConcentrationStatus = "ok" | "breached";

export function classifyConcentration(
  topShare: number,
  capPct: number,
): ConcentrationStatus {
  if (!(capPct > 0)) return "ok";
  return topShare * 100 > capPct ? "breached" : "ok";
}

/** Map a raw security type to a friendly group label for concentration. */
export function concentrationTypeLabel(t: string): string {
  if (t.startsWith("tbill")) return "T-Bills";
  if (t === "ifb") return "IFB bonds";
  if (t === "fxd") return "FXD bonds";
  if (t === "zero_coupon") return "Zero-coupon";
  if (t === "floating_rate") return "Floating-rate";
  return t.replace(/_/g, " ");
}

export function largestConcentration(
  lots: CurrentValueSecurity[],
  today: Date = new Date(),
): ConcentrationResult | null {
  const byType = new Map<string, number>();
  let totalValue = 0;
  for (const lot of lots) {
    if (lot.isMatured) continue;
    const cv = currentSecurityValue(lot, today);
    if (!(cv > 0)) continue;
    // Group T-bill tenor variants (tbill_91/182/364) under one "tbill" key so
    // the dominant-type share reflects the asset class, not a single tenor.
    const key = lot.securityType.startsWith("tbill") ? "tbill" : lot.securityType;
    byType.set(key, (byType.get(key) ?? 0) + cv);
    totalValue += cv;
  }
  if (totalValue <= 0 || byType.size === 0) return null;

  let topType = "";
  let topValue = -1;
  byType.forEach((value, type) => {
    if (value > topValue) {
      topValue = value;
      topType = type;
    }
  });
  const breakdown: ConcentrationSlice[] = [];
  byType.forEach((value, type) => {
    breakdown.push({
      type,
      label: concentrationTypeLabel(type),
      value,
      share: value / totalValue,
    });
  });
  breakdown.sort((a, b) => b.value - a.value);

  return {
    topLabel: concentrationTypeLabel(topType),
    topType,
    topShare: topValue / totalValue,
    topValue,
    totalValue,
    typeCount: byType.size,
    breakdown,
  };
}
