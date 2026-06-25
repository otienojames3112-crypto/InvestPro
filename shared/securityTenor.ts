/**
 * Shared tenor / maturity / rate / WHT model for CBK government securities
 * (Round 39). This is the SINGLE source of truth used by:
 *   - the CBK Securities Register add/edit dialogs
 *   - the Record Deposit government-security flow
 *   - the server-side auto-create of register rows from gov-security deposits
 *   - the day-by-day accrual breakdowns
 *
 * Centralising it here is the cure for the recurring drift where maturity dates,
 * rates and WHT were computed differently on different pages.
 *
 * --- Kenyan tax rules encoded (sources to verify) -------------------------
 *   T-bills (91/182/364): 15% WHT on the discount (T-bill interest).
 *   IFB (Infrastructure Bonds): tax-exempt (0% WHT) as of 2026. The Finance
 *     Bill 2024's proposed 5% IFB tax was NOT enacted; kept exempt but flagged
 *     "subject to legislative change" in the UI glossary.
 *   FXD (regular Treasury bonds): tenor-tiered WHT —
 *       15% for tenor  < 10 years,
 *       10% for tenor >= 10 years.
 *     (Business Daily / Kenyan Wallstreet / Serrari 2025-26. Some older sources
 *     cite a 5-year threshold; current consensus is the 10-year threshold, so we
 *     default to 10 years and let the user override per bond.)
 */

export type SecurityType = "tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd";

/** Days-to-maturity for the three T-bill tenors. */
export const TBILL_TENOR_DAYS: Record<"tbill_91" | "tbill_182" | "tbill_364", number> = {
  tbill_91: 91,
  tbill_182: 182,
  tbill_364: 364,
};

/** Structured bond tenor options (years), grouped for the picker. */
export interface TenorOption {
  /** Tenor in years. May be fractional (e.g. 6.5, 7.5). */
  years: number;
  label: string;
  /** Optional grouping band shown in the picker. */
  band?: string;
}

/**
 * IFB tenors — these match actual Kenyan IFB issues
 * (IFB1/2024/8.5, IFB1/2023/17, IFB1/2022/19, etc.).
 */
export const IFB_TENORS: TenorOption[] = [
  { years: 6.5, label: "6.5 years", band: "Short–Medium" },
  { years: 7, label: "7 years", band: "Short–Medium" },
  { years: 7.5, label: "7.5 years", band: "Short–Medium" },
  { years: 8.5, label: "8.5 years", band: "Short–Medium" },
  { years: 11, label: "11 years", band: "Long" },
  { years: 14, label: "14 years", band: "Long" },
  { years: 15, label: "15 years", band: "Long" },
  { years: 17, label: "17 years", band: "Long" },
  { years: 19, label: "19 years", band: "Long" },
];

/** FXD tenors — common Treasury bond tenors. */
export const FXD_TENORS: TenorOption[] = [
  { years: 2, label: "2 years" },
  { years: 5, label: "5 years" },
  { years: 10, label: "10 years" },
  { years: 15, label: "15 years" },
  { years: 20, label: "20 years" },
  { years: 25, label: "25 years" },
];

/** Default tenor (years) used when a bond type is first selected. */
export const DEFAULT_IFB_TENOR_YEARS = 8.5;
export const DEFAULT_FXD_TENOR_YEARS = 10;

export function isTbill(t: SecurityType): t is "tbill_91" | "tbill_182" | "tbill_364" {
  return t === "tbill_91" || t === "tbill_182" || t === "tbill_364";
}

export function isBond(t: SecurityType): t is "ifb" | "fxd" {
  return t === "ifb" || t === "fxd";
}

/** The FXD WHT tier threshold, in years. */
export const FXD_WHT_TENOR_THRESHOLD_YEARS = 10;

/**
 * Tiered withholding-tax rate (%) for a security.
 *   - IFB: 0 (tax-exempt)
 *   - T-bills: 15
 *   - FXD: 15 if tenor < 10y, 10 if tenor >= 10y
 * `tenorYears` is only consulted for FXD.
 */
export function whtRateForSecurity(
  securityType: SecurityType,
  tenorYears?: number | null,
): number {
  if (securityType === "ifb") return 0;
  if (isTbill(securityType)) return 15;
  // FXD — tenor-tiered.
  const y = typeof tenorYears === "number" && tenorYears > 0 ? tenorYears : DEFAULT_FXD_TENOR_YEARS;
  return y >= FXD_WHT_TENOR_THRESHOLD_YEARS ? 10 : 15;
}

/**
 * Add a whole/fractional number of days to a date (returns a NEW Date).
 * Operates on a UTC-noon clone to dodge DST/timezone off-by-one issues.
 */
function addDays(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + Math.round(days));
  return d;
}

/** Add a whole/fractional number of years to a date (fraction handled as days). */
function addYears(base: Date, years: number): Date {
  const whole = Math.floor(years);
  const fracDays = Math.round((years - whole) * 365);
  const d = new Date(base.getTime());
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCFullYear(d.getUTCFullYear() + whole);
  if (fracDays) d.setUTCDate(d.getUTCDate() + fracDays);
  return d;
}

/** Parse a YYYY-MM-DD (or Date) into a UTC-noon Date; returns null if invalid. */
export function parseIssueDate(issue: string | Date | null | undefined): Date | null {
  if (!issue) return null;
  const d = issue instanceof Date ? new Date(issue.getTime()) : new Date(`${issue}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;
  return d;
}

/** Format a Date as YYYY-MM-DD (date-input friendly). */
export function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the maturity DATE for a security given its type, issue date and
 * (for bonds) tenor in years. T-bills use their fixed day count.
 * Returns a YYYY-MM-DD string, or "" when the issue date is invalid.
 */
export function computeMaturityDate(
  securityType: SecurityType,
  issueDate: string | Date,
  tenorYears?: number | null,
): string {
  const issue = parseIssueDate(issueDate);
  if (!issue) return "";
  if (isTbill(securityType)) {
    return toDateInput(addDays(issue, TBILL_TENOR_DAYS[securityType]));
  }
  const years =
    typeof tenorYears === "number" && tenorYears > 0
      ? tenorYears
      : securityType === "ifb"
        ? DEFAULT_IFB_TENOR_YEARS
        : DEFAULT_FXD_TENOR_YEARS;
  return toDateInput(addYears(issue, years));
}

/** Tenor in years for a T-bill (e.g. 91/365), or the supplied bond tenor. */
export function tenorYearsForSecurity(
  securityType: SecurityType,
  bondTenorYears?: number | null,
): number {
  if (isTbill(securityType)) return TBILL_TENOR_DAYS[securityType] / 365;
  return typeof bondTenorYears === "number" && bondTenorYears > 0
    ? bondTenorYears
    : securityType === "ifb"
      ? DEFAULT_IFB_TENOR_YEARS
      : DEFAULT_FXD_TENOR_YEARS;
}

/**
 * Best-effort inference of a bond's tenor (in years) from its issue and
 * maturity dates. Snaps to the nearest known tenor option so an 8.49y span
 * reads as "8.5y". Returns null for T-bills / invalid dates.
 */
export function inferBondTenorYears(
  securityType: SecurityType,
  issueDate: string | Date,
  maturityDate: string | Date,
): number | null {
  if (!isBond(securityType)) return null;
  const issue = parseIssueDate(issueDate);
  const mat = parseIssueDate(maturityDate);
  if (!issue || !mat) return null;
  const rawYears = (mat.getTime() - issue.getTime()) / (365 * 24 * 3600 * 1000);
  if (rawYears <= 0) return null;
  const options = securityType === "ifb" ? IFB_TENORS : FXD_TENORS;
  let best = options[0];
  let bestGap = Math.abs(options[0].years - rawYears);
  for (const o of options) {
    const gap = Math.abs(o.years - rawYears);
    if (gap < bestGap) {
      best = o;
      bestGap = gap;
    }
  }
  // If the span is far from any known option (>1y), keep the raw value rounded.
  if (bestGap > 1) return Math.round(rawYears * 10) / 10;
  return best.years;
}

export interface RateSettingsLike {
  tbill91Rate?: string | number | null;
  tbill182Rate?: string | number | null;
  tbill364Rate?: string | number | null;
  ifbCouponRate?: string | number | null;
  fxdCouponRate?: string | number | null;
  /** Round 40: optional per-tenor rate maps keyed by tenor-years string. */
  ifbTenorRates?: Record<string, number> | null;
  fxdTenorRates?: Record<string, number> | null;
}

/**
 * Look up a bond's per-tenor rate from a tenor-rate map, with snap-to-key
 * tolerance (so 8.5 matches "8.5" and "8.50"). Returns null when no map or no
 * close key exists, so the caller can fall back to the flat coupon rate.
 */
export function tenorRateFromMap(
  map: Record<string, number> | null | undefined,
  tenorYears: number | null | undefined,
): number | null {
  if (!map || typeof tenorYears !== "number" || !(tenorYears > 0)) return null;
  // Exact key first.
  const exact = map[String(tenorYears)];
  if (typeof exact === "number" && Number.isFinite(exact) && exact > 0) return exact;
  // Otherwise snap to the numerically closest key within 0.25y.
  let best: number | null = null;
  let bestGap = Infinity;
  for (const [k, v] of Object.entries(map)) {
    const ky = parseFloat(k);
    if (!Number.isFinite(ky) || typeof v !== "number" || !(v > 0)) continue;
    const gap = Math.abs(ky - tenorYears);
    if (gap < bestGap) {
      bestGap = gap;
      best = v;
    }
  }
  return bestGap <= 0.25 ? best : null;
}

function num(v: string | number | null | undefined): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Default gross rate (% p.a.) for a security pulled from Rate Settings.
 *   - T-bill 91/182/364 → that tenor's discount rate
 *   - IFB → IFB coupon rate
 *   - FXD → FXD coupon rate
 * Returns 0 when settings are missing.
 */
export function defaultRateForSecurity(
  securityType: SecurityType,
  rates: RateSettingsLike | null | undefined,
  tenorYears?: number | null,
): number {
  if (!rates) return 0;
  switch (securityType) {
    case "tbill_91":
      return num(rates.tbill91Rate);
    case "tbill_182":
      return num(rates.tbill182Rate);
    case "tbill_364":
      return num(rates.tbill364Rate);
    case "ifb": {
      // Prefer the per-tenor map; fall back to the flat IFB coupon.
      const t = tenorRateFromMap(rates.ifbTenorRates, tenorYears ?? null);
      return t ?? num(rates.ifbCouponRate);
    }
    case "fxd": {
      const t = tenorRateFromMap(rates.fxdTenorRates, tenorYears ?? null);
      return t ?? num(rates.fxdCouponRate);
    }
    default:
      return 0;
  }
}

/** Short tenor-band label for a security (e.g. "IFB 8.5y", "91d"). */
export function securityTenorBadge(
  securityType: SecurityType,
  bondTenorYears?: number | null,
): string {
  if (securityType === "tbill_91") return "91d";
  if (securityType === "tbill_182") return "182d";
  if (securityType === "tbill_364") return "364d";
  const y = tenorYearsForSecurity(securityType, bondTenorYears);
  const label = Number.isInteger(y) ? `${y}y` : `${y}y`;
  return securityType === "ifb" ? `IFB ${label}` : `FXD ${label}`;
}

/**
 * Round 40 (R40.5): decide whether a government security is still IMMATURE
 * relative to a proposed withdrawal/redemption date.
 *
 * Unlike a bank fixed deposit (which can be "broken" early at the bank for a
 * forfeiture), a CBK government security cannot simply be redeemed early at par.
 * The only way to get out before maturity is to SELL it on the secondary market
 * (a rediscount), where the price is set by prevailing market yields and may be
 * above OR below face value. So we WARN (not silently allow a par redemption)
 * when the maturity date is after the withdrawal date.
 *
 * Returns:
 *   isImmature  — true when maturityDate is strictly after withdrawalDate
 *   daysToMaturity — whole days remaining (>=0 when immature, may be negative)
 */
export function isSecurityImmatureOn(
  maturityDate: string | Date | null | undefined,
  withdrawalDate: string | Date | null | undefined,
): { isImmature: boolean; daysToMaturity: number } {
  const mat = parseIssueDate(maturityDate ?? null);
  const wd = parseIssueDate(withdrawalDate ?? null);
  if (!mat || !wd) return { isImmature: false, daysToMaturity: 0 };
  const msPerDay = 24 * 3600 * 1000;
  const days = Math.round((mat.getTime() - wd.getTime()) / msPerDay);
  return { isImmature: days > 0, daysToMaturity: days };
}
