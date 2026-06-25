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
