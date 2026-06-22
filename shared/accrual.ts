/**
 * Shared, pure financial math for MMF daily accrual and Kenyan withholding tax.
 *
 * This is the single source of truth used by both the frontend pages
 * (MmfAccrual, TaxSummary) and the vitest suite. Keep it free of any
 * React / DOM / tRPC imports so it stays trivially testable.
 */

export interface DayRow {
  day: number;
  openingBalance: number;
  grossInterest: number;
  wht: number;
  netInterest: number;
  closingBalance: number;
}

export type CreditingFrequency = "daily" | "monthly";

/**
 * Simulate daily MMF interest accrual.
 *
 * - dailyRate = annualEar% / dayCount  (dayCount is 365 or 360)
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
  const dailyRate = annualEar / 100 / dayCount;
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
      });
    }
  }
  return rows;
}

/** One full day of interest on a principal (no compounding). */
export function oneDayInterest(
  principal: number,
  annualEar: number,
  dayCount: number,
  whtRate: number
): { gross: number; wht: number; net: number } {
  const gross = principal * (annualEar / 100 / dayCount);
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
