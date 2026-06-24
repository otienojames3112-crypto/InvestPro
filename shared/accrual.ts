/**
 * Shared, pure financial math for MMF daily accrual and Kenyan withholding tax.
 *
 * This is the single source of truth used by both the frontend pages
 * (MmfAccrual, TaxSummary) and the vitest suite. Keep it free of any
 * React / DOM / tRPC imports so it stays trivially testable.
 */

export interface DayRow {
  day: number;
  /** Calendar date for this row (ISO YYYY-MM-DD) when a startDate is supplied. */
  date?: string;
  openingBalance: number;
  grossInterest: number;
  wht: number;
  netInterest: number;
  closingBalance: number;
  /** The annual EAR (%) actually applied on this day (reflects rate changes). */
  appliedEar?: number;
  /** The WHT rate (%) actually applied on this day. */
  appliedWht?: number;
}

export type CreditingFrequency = "daily" | "monthly";

/**
 * Geometric daily rate from an EFFECTIVE annual rate (EAR).
 *
 * A money-market fund quotes an EAR that ALREADY embeds annual compounding,
 * so the correct per-day rate is the geometric root:
 *
 *     dailyRate = (1 + EAR/100)^(1/dayCount) - 1
 *
 * Compounding this rate over `dayCount` days reproduces the EAR exactly.
 * (The old `EAR/100/dayCount` simple rate over-states interest because it
 * then double-counts compounding when applied daily.)
 */
export function geometricDailyRate(annualEar: number, dayCount: number): number {
  return Math.pow(1 + annualEar / 100, 1 / dayCount) - 1;
}

/**
 * Simulate daily MMF interest accrual using the GEOMETRIC daily rate.
 *
 * - dailyRate = (1 + EAR/100)^(1/dayCount) - 1   (dayCount is 365 or 360)
 * - gross     = balance * dailyRate
 * - wht       = gross * whtRate%
 * - net       = gross - wht
 * - "daily"   crediting: net compounds into the balance every day
 * - "monthly" crediting: interest accrues on a fixed base and is credited
 *             (compounded) every 30 days
 */
export function simulateAccrual(
  principal: number,
  annualEar: number,
  dayCount: number,
  whtRate: number,
  crediting: CreditingFrequency,
  days: number
): DayRow[] {
  const rows: DayRow[] = [];
  const dailyRate = geometricDailyRate(annualEar, dayCount);
  let balance = principal;
  let accruedNet = 0;
  let accrualBase = principal;

  for (let day = 1; day <= days; day++) {
    const opening = balance;
    if (crediting === "daily") {
      const gross = balance * dailyRate;
      const wht = gross * (whtRate / 100);
      const net = gross - wht;
      balance += net;
      rows.push({
        day,
        openingBalance: opening,
        grossInterest: gross,
        wht,
        netInterest: net,
        closingBalance: balance,
        appliedEar: annualEar,
        appliedWht: whtRate,
      });
    } else {
      const gross = accrualBase * dailyRate;
      const wht = gross * (whtRate / 100);
      const net = gross - wht;
      accruedNet += net;
      let closing = opening;
      if (day % 30 === 0) {
        balance += accruedNet;
        closing = balance;
        accruedNet = 0;
        accrualBase = balance;
      }
      rows.push({
        day,
        openingBalance: opening,
        grossInterest: gross,
        wht,
        netInterest: net,
        closingBalance: closing,
        appliedEar: annualEar,
        appliedWht: whtRate,
      });
    }
  }
  return rows;
}

/** A dated rate change: from `effectiveDate` onward, use this EAR / WHT. */
export interface AccrualRatePoint {
  /** ISO YYYY-MM-DD — the first day this rate applies. */
  effectiveDate: string;
  /** Effective annual rate (%) of the fund from this date. */
  ear: number;
  /** Withholding-tax rate (%) from this date. */
  whtRate: number;
}

/** Add `n` days to an ISO date (UTC, no DST drift). */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Pick the EAR / WHT in force on a given date from a sorted rate history.
 * Uses the LATEST point whose effectiveDate <= the target date (the old rate
 * applies up to a change date; the new rate applies from the change date on).
 * Falls back to the first point when the date precedes all history.
 */
export function ratesOnDate(
  date: string,
  history: AccrualRatePoint[],
  fallback: { ear: number; whtRate: number }
): { ear: number; whtRate: number } {
  if (!history || history.length === 0) return fallback;
  const sorted = [...history].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  let chosen: AccrualRatePoint | null = null;
  for (const p of sorted) {
    if (p.effectiveDate <= date) chosen = p;
    else break;
  }
  if (!chosen) {
    // Date precedes all history — use the earliest known point.
    return { ear: sorted[0].ear, whtRate: sorted[0].whtRate };
  }
  return { ear: chosen.ear, whtRate: chosen.whtRate };
}

/**
 * Date-aware daily accrual that CARRIES ACROSS MONTHS and PICKS UP RATE/WHT
 * CHANGES BY DATE (Fix #4).
 *
 * Every day is dated from `startDate`. The EAR and WHT used on each day come
 * from `history` via {@link ratesOnDate}, so a rate change on date D uses the
 * OLD rate for days before D and the NEW rate from D forward. Net interest
 * compounds daily (the closing balance of one day is the opening of the next),
 * so the ledger continues correctly across month and rate boundaries over the
 * full period — not just a 30-day window.
 */
export function simulateAccrualDated(
  principal: number,
  startDate: string,
  dayCount: number,
  days: number,
  history: AccrualRatePoint[],
  fallback: { ear: number; whtRate: number }
): DayRow[] {
  const rows: DayRow[] = [];
  let balance = principal;
  for (let i = 0; i < days; i++) {
    const date = addDays(startDate, i);
    const { ear, whtRate } = ratesOnDate(date, history, fallback);
    const dailyRate = geometricDailyRate(ear, dayCount);
    const opening = balance;
    const gross = balance * dailyRate;
    const wht = gross * (whtRate / 100);
    const net = gross - wht;
    balance += net;
    rows.push({
      day: i + 1,
      date,
      openingBalance: opening,
      grossInterest: gross,
      wht,
      netInterest: net,
      closingBalance: balance,
      appliedEar: ear,
      appliedWht: whtRate,
    });
  }
  return rows;
}

/** One full day of interest on a principal (no compounding, geometric rate). */
export function oneDayInterest(
  principal: number,
  annualEar: number,
  dayCount: number,
  whtRate: number
): { gross: number; wht: number; net: number } {
  const gross = principal * geometricDailyRate(annualEar, dayCount);
  const wht = gross * (whtRate / 100);
  return { gross, wht, net: gross - wht };
}

// ─── Kenyan withholding-tax rules (2026) ────────────────────────────────────

/** Default KRA withholding-tax rates (%). All final tax for residents. */
export const WHT_RATES = {
  /** MMF / unit-trust interest distribution. */
  mmfInterest: 15,
  /** Bank deposit interest. */
  bankInterest: 15,
  /** T-bill & T-bond (FXD) discount/coupon — 15% for bonds ≥ certain tenor. */
  tbill: 15,
  /** Treasury bond coupon (FXD). */
  fxdCoupon: 15,
  /** Dividends (resident). */
  dividend: 5,
} as const;

/** Compute WHT on a gross interest amount at a given rate (%). */
export function whtOn(grossAmount: number, ratePct: number): number {
  return Math.max(0, grossAmount) * (ratePct / 100);
}

/**
 * Annual gross interest for a holding given its balance and net EAR.
 * The EAR funds quote is already NET of the manager fee but GROSS of WHT,
 * so to recover pre-tax interest we gross-up by the WHT rate.
 */
export function grossUpAnnualInterest(
  balance: number,
  netEarPct: number,
  whtRatePct: number
): { gross: number; wht: number; net: number } {
  // netEar already reflects what the investor earns AFTER wht when expressed
  // as a take-home yield; but fund EARs are typically quoted gross-of-tax.
  // We treat the quoted EAR as the gross annual rate here.
  const gross = balance * (netEarPct / 100);
  const wht = whtOn(gross, whtRatePct);
  return { gross, wht, net: gross - wht };
}
