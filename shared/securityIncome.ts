/**
 * ONE shared government-security income engine (Audit item #3).
 *
 * Every surface that touches government-security income — Dashboard, Ledger,
 * Daily Accrual, Tax Summary, Portfolio Review, Reconciliation — must derive its
 * numbers from THIS module so no two pages can disagree on how a T-bill, FXD, or
 * IFB earns and is taxed. It is framework-free (no React / tRPC / DOM) and pure,
 * so it is trivially unit-testable and safe to import from both client and
 * server.
 *
 * Instrument rules (the contract the audit locks):
 *
 *   T-BILLS / ZERO-COUPON (discount instruments):
 *     - income        = faceValue − purchasePrice   (the discount, NOT a coupon)
 *     - daily accretion = income / daysBetween(issueDate, maturityDate)
 *     - straight-line, NO daily compounding
 *     - WHT           = 15% on the discount unless overridden per holding
 *
 *   FXD (fixed-coupon Treasury bond):
 *     - coupon accrues straight-line between coupon dates
 *     - coupon is PAID on each coupon date
 *     - WHT is instrument-specific or tenor-derived (10y+ → 10%, else 15%),
 *       editable per holding
 *
 *   IFB (infrastructure bond):
 *     - same coupon accrual mechanics as FXD
 *     - WHT default 0% (tax-exempt), editable if the law changes
 *
 * All money figures are KES.
 */

export type SecurityIncomeKind =
  | "tbill_91"
  | "tbill_182"
  | "tbill_364"
  | "zero_coupon"
  | "fxd"
  | "ifb"
  | "floating_rate";

/** A single government security, as every page supplies it. */
export interface SecurityIncomeSpec {
  id?: number;
  securityType: SecurityIncomeKind;
  faceValue: number;
  /** % p.a. — for T-bills this is the annualised discount/yield if no price given. */
  couponRate: number;
  issueDate?: string | Date | null;
  maturityDate?: string | Date | null;
  isMatured?: boolean;
  /** Explicit exemption flag (IFB is exempt by default even without this). */
  isTaxExempt?: boolean;
  /** Cash paid up front for a discount instrument (T-bill / zero-coupon). */
  purchasePrice?: number | null;
  /** Bond tenor in years, used to derive the FXD WHT tier when not overridden. */
  tenorYears?: number | null;
  /** Per-holding WHT override (%). When set, it wins over the tier default. */
  whtRateOverride?: number | null;
}

const MS_PER_DAY = 86_400_000;
/** A coupon bond's coupon period (semi-annual) in days. */
export const COUPON_PERIOD_DAYS = 182.5;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isoDay(d: string | Date | null | undefined): string | null {
  if (d == null || d === "") return null;
  const s = d instanceof Date ? d.toISOString() : String(d);
  return s.slice(0, 10);
}

function dayMs(iso: string): number {
  return new Date(`${iso}T12:00:00.000Z`).getTime();
}

/** True for discount instruments (return is the discount, not a coupon). */
export function isDiscountSecurity(t: SecurityIncomeKind): boolean {
  return t.startsWith("tbill") || t === "zero_coupon";
}

/** True for coupon-bearing bonds (FXD / IFB / floating). */
export function isCouponSecurity(t: SecurityIncomeKind): boolean {
  return t === "fxd" || t === "ifb" || t === "floating_rate";
}

/**
 * The WHT rate (%) that applies to a security's income.
 *
 *  - A per-holding `whtRateOverride` always wins (editable per holding).
 *  - IFB (or any explicitly tax-exempt security) is 0%.
 *  - T-bills / zero-coupon: 15% on the discount.
 *  - FXD: tenor-tiered — 10% for tenor ≥ 10 years, otherwise 15%.
 */
export function whtRateFor(spec: SecurityIncomeSpec): number {
  if (spec.whtRateOverride != null && Number.isFinite(spec.whtRateOverride)) {
    return Math.max(0, spec.whtRateOverride);
  }
  if (spec.isTaxExempt || spec.securityType === "ifb") return 0;
  if (isDiscountSecurity(spec.securityType)) return 15;
  // FXD / floating coupon bonds — tenor-tiered.
  const y = typeof spec.tenorYears === "number" && spec.tenorYears > 0 ? spec.tenorYears : null;
  if (y == null) return 15; // unknown tenor → conservative 15%
  return y >= 10 ? 10 : 15;
}

/** Whole days between issue and maturity (min 1). */
export function holdingDays(spec: SecurityIncomeSpec): number {
  const issue = isoDay(spec.issueDate);
  const maturity = isoDay(spec.maturityDate);
  if (!issue || !maturity) return 1;
  const days = Math.round((dayMs(maturity) - dayMs(issue)) / MS_PER_DAY);
  return Math.max(1, days);
}

export interface SecurityIncomeResult {
  /** Total GROSS income the instrument earns over its whole life (KES). */
  lifetimeGross: number;
  /** WHT on the lifetime gross at the applicable rate (KES). */
  lifetimeWht: number;
  /** Net lifetime income (gross − WHT). */
  lifetimeNet: number;
  /** Straight-line GROSS accretion/accrual per day (KES/day). */
  grossPerDay: number;
  /** Straight-line WHT per day (KES/day). */
  whtPerDay: number;
  /** Straight-line NET per day (KES/day). */
  netPerDay: number;
  /** The WHT rate (%) actually applied. */
  whtPct: number;
  /** True for discount instruments, false for coupon bonds. */
  isDiscount: boolean;
}

/**
 * The canonical per-instrument income breakdown.
 *
 * For a T-bill/zero-coupon with a purchase price, `lifetimeGross` is the discount
 * (face − price) and the per-day figures accrete it straight-line over the whole
 * issue→maturity window. For a coupon bond, `lifetimeGross` is one coupon period's
 * coupon (semi-annual), and the per-day figures accrue it straight-line across the
 * coupon period — matching how the coupon actually builds up between pay dates.
 *
 * When a discount instrument has no purchase price, the annualised yield in
 * `couponRate` is used to derive the discount over the holding window (face ×
 * yield × days/365), so a T-bill still earns a discount, never a coupon.
 */
export function computeSecurityIncome(spec: SecurityIncomeSpec): SecurityIncomeResult {
  const face = Math.max(0, spec.faceValue || 0);
  const rate = Math.max(0, spec.couponRate || 0);
  const whtPct = whtRateFor(spec);
  const isDiscount = isDiscountSecurity(spec.securityType);

  if (isDiscount) {
    const price =
      spec.purchasePrice != null && Number(spec.purchasePrice) > 0
        ? Number(spec.purchasePrice)
        : null;
    const days = holdingDays(spec);
    // Discount = face − price when a price is known; else derive from the
    // annualised yield over the holding window. Never treat it as a coupon.
    const lifetimeGross =
      price != null && price < face
        ? face - price
        : (face * (rate / 100) * days) / 365;
    const lifetimeWht = lifetimeGross * (whtPct / 100);
    const lifetimeNet = lifetimeGross - lifetimeWht;
    return {
      lifetimeGross: round2(lifetimeGross),
      lifetimeWht: round2(lifetimeWht),
      lifetimeNet: round2(lifetimeNet),
      grossPerDay: lifetimeGross / days,
      whtPerDay: lifetimeWht / days,
      netPerDay: lifetimeNet / days,
      whtPct,
      isDiscount: true,
    };
  }

  // Coupon bond (FXD / IFB / floating): one semi-annual coupon accrues straight-
  // line across a coupon period and is paid on the coupon date.
  const halfYearCoupon = (face * (rate / 100)) / 2;
  const lifetimeGross = halfYearCoupon; // one coupon period's worth
  const lifetimeWht = lifetimeGross * (whtPct / 100);
  const lifetimeNet = lifetimeGross - lifetimeWht;
  return {
    lifetimeGross: round2(lifetimeGross),
    lifetimeWht: round2(lifetimeWht),
    lifetimeNet: round2(lifetimeNet),
    grossPerDay: lifetimeGross / COUPON_PERIOD_DAYS,
    whtPerDay: lifetimeWht / COUPON_PERIOD_DAYS,
    netPerDay: lifetimeNet / COUPON_PERIOD_DAYS,
    whtPct,
    isDiscount: false,
  };
}

/** Is the security still live (accruing) at the effective `now`? */
export function isLiveSecurity(spec: SecurityIncomeSpec, now: number = Date.now()): boolean {
  if (spec.isMatured) return false;
  const maturity = isoDay(spec.maturityDate);
  if (!maturity) return true;
  const today = new Date(now).toISOString().slice(0, 10);
  return maturity >= today;
}

/**
 * NET income accrued to date on a single security (capped at maturity).
 *
 *  - Discount instruments: the discount accreted straight-line from issue to
 *    min(today, maturity).
 *  - Coupon bonds: the CURRENT coupon period's accrual only (resets each coupon
 *    date), so coupons already paid before tracking began are not re-counted.
 */
export function securityAccruedNetToDate(
  spec: SecurityIncomeSpec,
  todayISO: string,
): number {
  const income = computeSecurityIncome(spec);
  const issue = isoDay(spec.issueDate) ?? todayISO;
  const maturity = isoDay(spec.maturityDate);
  let endISO = todayISO;
  if (maturity && maturity < todayISO) endISO = maturity;
  const from = dayMs(issue);
  const to = dayMs(endISO);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
  const elapsedDays = Math.floor((to - from) / MS_PER_DAY);

  if (income.isDiscount) {
    const net = income.netPerDay * elapsedDays;
    return Math.max(0, round2(Math.min(net, income.lifetimeNet)));
  }

  // Coupon bond — accrue the current period only.
  const maturityMs = maturity ? dayMs(maturity) : Number.POSITIVE_INFINITY;
  if (Number.isFinite(maturityMs) && to >= maturityMs) {
    return Math.max(0, round2(income.lifetimeNet));
  }
  const fractionIntoPeriod = (elapsedDays % COUPON_PERIOD_DAYS) / COUPON_PERIOD_DAYS;
  return Math.max(0, round2(income.lifetimeNet * fractionIntoPeriod));
}

/** Sum of net accrued gov-security income to date across a portfolio. */
export function portfolioSecurityAccruedNet(
  specs: SecurityIncomeSpec[],
  todayISO: string,
): number {
  let total = 0;
  for (const s of specs) total += securityAccruedNetToDate(s, todayISO);
  return round2(total);
}

/**
 * Forward-looking GROSS + WHT income over the NEXT `days`, for the Tax Summary and
 * reconciliation. Discount instruments contribute their remaining discount
 * (capped at maturity); coupon bonds contribute their straight-line coupon accrual
 * over the window. Only live securities are included.
 */
export interface SecurityIncomeWindow {
  gross: number;
  wht: number;
  net: number;
  base: number;
}

export function securityIncomeOverWindow(
  specs: SecurityIncomeSpec[],
  days: number,
  now: number = Date.now(),
): SecurityIncomeWindow {
  const n = Math.max(0, days);
  let gross = 0;
  let wht = 0;
  let base = 0;
  for (const s of specs) {
    if (!isLiveSecurity(s, now)) continue;
    const income = computeSecurityIncome(s);
    base += Math.max(0, s.faceValue || 0);
    if (income.isDiscount) {
      // Cap the window at the instrument's remaining lifetime.
      const totalDays = holdingDays(s);
      const usable = Math.min(n, totalDays);
      gross += income.grossPerDay * usable;
      wht += income.whtPerDay * usable;
    } else {
      gross += income.grossPerDay * n;
      wht += income.whtPerDay * n;
    }
  }
  return {
    gross: round2(gross),
    wht: round2(wht),
    net: round2(gross - wht),
    base: round2(base),
  };
}
