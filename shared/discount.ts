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
  /**
   * Round 62: WHT rate (%) applied to coupon income for taxable coupon bonds
   * (FXD / floating-rate). Used to net the accrued-coupon component of current
   * value. IFB is tax-exempt and ignores this. Defaults to 15% when omitted.
   */
  whtRatePct?: number | null;
}

/** IFB coupons are tax-exempt; FXD and floating-rate coupons attract WHT. */
function isTaxExemptCoupon(t: string): boolean {
  return t === "ifb";
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

  // Coupon bonds (fxd / ifb / floating_rate): clean price stays at par; we add
  // ONLY the coupon accrued since the LAST coupon date (semi-annual periods from
  // issue), reset at each payment and capped at one period. Net of WHT for FXD /
  // floating-rate; gross (tax-exempt) for IFB. This prevents the dirty value from
  // ballooning above face as more coupons accrue over the bond's life, so the
  // register/Dashboard current value reconciles with the face-based net worth.
  const couponPct = Number(s.couponRate) || 0;
  if (couponPct <= 0) return face;
  const accrued = accruedCouponSinceLastCoupon(
    face,
    couponPct,
    issue,
    now,
    maturity,
  );
  const exempt = isTaxExemptCoupon(s.securityType);
  const wht = exempt ? 0 : (Number(s.whtRatePct) || 15) / 100;
  const net = accrued * (1 - wht);
  return face + Math.max(0, net);
}

/** Days in one semi-annual coupon period (365 / 2). */
const COUPON_PERIOD_DAYS = 182.5;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Round 62: GROSS coupon accrued since the most recent coupon date.
 *
 * Coupons are assumed semi-annual, falling every ~182.5 days from issue. The
 * accrued amount resets to zero on each coupon date and grows linearly to one
 * full half-year coupon just before the next one. Capped at a single period so
 * the dirty value never exceeds face + one coupon.
 *
 *   halfYearCoupon = face × (couponPct/100) / 2
 *   fractionIntoPeriod = (daysSinceIssue mod 182.5) / 182.5
 *   accrued = halfYearCoupon × fractionIntoPeriod
 */
export function accruedCouponSinceLastCoupon(
  face: number,
  couponPct: number,
  issueTime: number,
  nowTime: number,
  maturityTime: number,
): number {
  if (face <= 0 || couponPct <= 0) return 0;
  if (!Number.isFinite(issueTime) || !Number.isFinite(nowTime)) return 0;
  if (nowTime <= issueTime) return 0;
  // At/after maturity the final coupon is paid in full (handled by the maturity
  // redemption path); here we just return a full period's worth.
  const halfYearCoupon = (face * (couponPct / 100)) / 2;
  const daysSinceIssue = (nowTime - issueTime) / MS_PER_DAY;
  if (Number.isFinite(maturityTime) && nowTime >= maturityTime) {
    return halfYearCoupon;
  }
  const fractionIntoPeriod = (daysSinceIssue % COUPON_PERIOD_DAYS) / COUPON_PERIOD_DAYS;
  return halfYearCoupon * fractionIntoPeriod;
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

/**
 * How much current value must be shifted OUT of the dominant instrument type to
 * bring its share back to (at most) the cap (Round 59).
 *
 * If we remove `x` from the top type's value (and from the total), the new share
 * is `(topValue - x) / (totalValue - x)`. Solving `(topValue - x)/(totalValue - x)
 * = cap` (cap as a fraction 0..1) gives:
 *
 *   x = (topValue - cap * totalValue) / (1 - cap)
 *
 * Intuition: every shilling moved out of the top type drops both its value and
 * the base, which is why the denominator is `(1 - cap)` rather than just 1.
 *
 * Returns 0 when already within the cap, when inputs are degenerate, or when the
 * cap is >= 100% (no constraint). Caps <= 0 are treated as "no constraint" too
 * (the feature is effectively disabled), matching `classifyConcentration`.
 */
export function amountToShiftUnderCap(
  topValue: number,
  totalValue: number,
  capPct: number,
): number {
  if (!(capPct > 0) || capPct >= 100) return 0;
  if (!(totalValue > 0) || !(topValue > 0)) return 0;
  const cap = capPct / 100;
  // Already within cap → nothing to shift.
  if (topValue / totalValue <= cap) return 0;
  const x = (topValue - cap * totalValue) / (1 - cap);
  return x > 0 ? x : 0;
}

/**
 * Round 60 — concentration-warning snooze predicate. Returns true when the given
 * snooze timestamp (Unix-ms, UTC) is set and still in the future relative to
 * `now`. Null/undefined/0 or a past timestamp means "not snoozed".
 *
 * Centralised here so the Dashboard UI and tests share one definition.
 */
export function isConcentrationSnoozed(
  snoozeUntil: number | null | undefined,
  now: number = Date.now(),
): boolean {
  return snoozeUntil != null && snoozeUntil > now;
}

/**
 * Round 60 — builds the "Diversify" deep-link into the CBK Securities register
 * that opens the add-security dialog pre-filled with a liquid instrument and the
 * suggested shift amount as the face value. Amount is rounded to a whole shilling
 * and clamped to a positive integer; non-positive amounts yield a plain add link.
 */
export function buildDiversifyLink(
  shiftAmount: number,
  addType: string = "tbill_364",
): string {
  const face = Math.round(shiftAmount);
  // Round 61 — the "mmf" target routes to the Contributions page and opens the
  // lump-sum override dialog prefilled, since a money-market top-up is recorded
  // as a one-off lump sum (not a CBK security). All other targets are CBK
  // securities booked through the register's add dialog.
  if (addType === "mmf") {
    if (!(face > 0)) return `/contributions?addLump=1`;
    return `/contributions?addLump=1&amount=${face}`;
  }
  if (!(face > 0)) return `/securities?add=1&addType=${encodeURIComponent(addType)}`;
  return `/securities?add=1&addType=${encodeURIComponent(addType)}&face=${face}`;
}

/**
 * R69.2 — maturity-aware per-type concentration analysis.
 *
 * The per-type cap (T-bills / IFB / FXD) is a DURATION / liquidity guardrail, not
 * credit diversification — every lot is the same sovereign issuer. A held bond
 * cannot be "shifted" without rediscounting it on the secondary market at a cost,
 * so when the dominant type is over the cap purely because of held, un-matured
 * lots, the correct guidance is: the breach self-corrects when enough of those
 * lots mature, and until then the engine simply stops buying more of that type.
 *
 * This analyzer walks the over-cap type's lots in maturity order and finds the
 * earliest maturity date at which the type's share drops back to (or below) the
 * cap. It also reports the net-worth share (the denominator that actually matters
 * for whether duration threatens the goal) alongside the "% of securities" share.
 */
export interface PerTypeBreachAnalysis {
  /** Over-cap dominant type key (grouped, e.g. "fxd", "tbill"). */
  type: string;
  /** Friendly label, e.g. "FXD bonds". */
  label: string;
  /** Dominant type's share of total *securities* value, 0..1. */
  shareOfSecurities: number;
  /** Dominant type's share of *net worth*, 0..1 (0 when netWorth unknown/0). */
  shareOfNetWorth: number;
  /** Current value held in the dominant type (KES). */
  topValue: number;
  /** Total securities value (KES). */
  totalSecurities: number;
  /** True when the share strictly exceeds the cap. */
  breached: boolean;
  /**
   * True when the breach resolves on its own as held lots mature within the
   * horizon (i.e. there exists a future maturity date — on/before the horizon —
   * after which the type is back under cap). False means it does NOT self-correct
   * within the horizon, so an early-sale / rediscount option is warranted.
   */
  selfCorrects: boolean;
  /**
   * Earliest maturity date (ms, UTC) at which the type returns under cap, or null
   * if it never does within the supplied lots (and thus within the horizon).
   */
  clearsAtMs: number | null;
}

/**
 * Analyze the dominant per-type breach with maturity awareness.
 *
 * @param lots         all current (held) security lots
 * @param capPct       per-type cap as a percentage (e.g. 60)
 * @param netWorth     total net worth (KES) for the net-worth-share denominator; pass 0/undefined to skip
 * @param horizonEndMs end of the plan horizon (ms, UTC); maturities after this do NOT count as self-correcting
 * @param today        valuation date
 */
export function analyzePerTypeBreach(
  lots: CurrentValueSecurity[],
  capPct: number,
  netWorth: number | undefined,
  horizonEndMs: number | null,
  today: Date = new Date(),
): PerTypeBreachAnalysis | null {
  const conc = largestConcentration(lots, today);
  if (!conc) return null;
  const breached = classifyConcentration(conc.topShare, capPct) === "breached";

  const nw = Number(netWorth) || 0;
  const shareOfNetWorth = nw > 0 ? conc.topValue / nw : 0;

  const base: PerTypeBreachAnalysis = {
    type: conc.topType,
    label: conc.topLabel,
    shareOfSecurities: conc.topShare,
    shareOfNetWorth,
    topValue: conc.topValue,
    totalSecurities: conc.totalValue,
    breached,
    selfCorrects: false,
    clearsAtMs: null,
  };
  if (!breached) return base;

  const cap = capPct > 0 ? capPct / 100 : 0;
  if (!(cap > 0) || cap >= 1) return base; // cap disabled → treat as not self-correcting

  // Gather the over-cap type's un-matured lots with their maturity time + current value.
  const groupKey = (t: string) => (t.startsWith("tbill") ? "tbill" : t);
  const now = today.getTime();
  const topLots = lots
    .filter((l) => !l.isMatured && groupKey(l.securityType) === conc.topType)
    .map((l) => ({
      mat: toTime(l.maturityDate),
      cv: currentSecurityValue(l, today),
    }))
    .filter((l) => l.cv > 0 && Number.isFinite(l.mat) && l.mat > now)
    .sort((a, b) => a.mat - b.mat);

  // Walk maturities in order. When a lot matures it leaves BOTH the type value and
  // the securities base (it becomes cash, then redeploys elsewhere). After each
  // maturity, recompute the type share; the first date it is <= cap is the clear date.
  let topRemaining = conc.topValue;
  let totalRemaining = conc.totalValue;
  for (const lot of topLots) {
    topRemaining -= lot.cv;
    totalRemaining -= lot.cv;
    const share = totalRemaining > 0 ? topRemaining / totalRemaining : 0;
    if (share <= cap) {
      const withinHorizon = horizonEndMs == null || lot.mat <= horizonEndMs;
      return { ...base, selfCorrects: withinHorizon, clearsAtMs: lot.mat };
    }
  }
  // Never clears via maturity (e.g. a single huge lot maturing after the goal, or
  // lots that don't bring it under cap) → does not self-correct.
  return base;
}


// ─── R70.1: parse an acknowledged-breach audit row into structured fields ────
//
// recordBreachAck writes audit_log rows shaped like:
//   field   = "issuer" | "type"
//   newValue = "67.5% vs 60% cap"
//   summary  = "Acknowledged actual per-instrument-type concentration breach: FXD bonds at 67.5% (cap 60%)"
// This pure helper extracts the cap kind, the breached label, and the
// share/cap percentages so the history table (and its tests) stay in sync.

export interface BreachAckRowInput {
  field?: string | null;
  newValue?: string | null;
  summary?: string | null;
}

export interface ParsedBreachAck {
  capKind: "issuer" | "type";
  label: string | null;
  sharePct: number | null;
  capPct: number | null;
}

export function parseBreachAckRow(row: BreachAckRowInput): ParsedBreachAck {
  const capKind: "issuer" | "type" = row.field === "issuer" ? "issuer" : "type";
  const m = /([0-9.]+)%\s*vs\s*([0-9.]+)%/.exec(row.newValue ?? "");
  const sharePct = m ? Number(m[1]) : null;
  const capPct = m ? Number(m[2]) : null;
  let label: string | null = null;
  if (row.summary) {
    // Anchor the label to the trailing " at <pct>% (cap ...)" so labels that
    // themselves contain the word "at" are not truncated. Greedy up to the
    // last " at <number>%".
    const lm = /breach:\s*(.+)\s+at\s+[0-9.]+%/.exec(row.summary);
    label = lm ? lm[1].trim() : null;
  }
  return { capKind, label, sharePct, capPct };
}
