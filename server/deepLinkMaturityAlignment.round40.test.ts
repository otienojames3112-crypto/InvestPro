import { describe, it, expect } from "vitest";
import {
  runProjection,
  type EngineSettings,
  type ActualSecurity,
} from "./engine";
import { ledgerMonthForDate } from "../client/src/components/MaturityTimeline";

/**
 * Round 40 #2 — the Dashboard "Next 90 days" deep-link must point at the SAME
 * ledger month the engine matures the lot. Engine maturity month is
 * issueMonth + tenorMonths (age === tenorMonths), both derived from whole-month
 * date differences; the deep-link uses ledgerMonthForDate(maturityDate). These
 * must agree (no off-by-one).
 */

function currentMonthStartISO(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12, 0, 0));
  return d.toISOString().split("T")[0];
}
function monthsAfter(startISO: string, k: number, day: number): string {
  const s = new Date(startISO + "T12:00:00Z");
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, day, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

const START = currentMonthStartISO();
const SETTINGS: EngineSettings = {
  mmfYield: 13.2,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 41000,
  stepUpAmount: 0,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 1000000,
  startDate: START,
  horizonMonths: 18,
};

/**
 * The month the engine matures the RECORDED lot. We disable the yield-max sweep
 * by setting a tiny contribution + high safety floor so no NEW T-bills are
 * bought; then the T-bill column reflects only the recorded lot, and the month
 * its face value disappears from the column is the engine maturity month.
 */
function engineMaturityMonth(securities: ActualSecurity[], face: number): number | null {
  const settings: EngineSettings = {
    ...SETTINGS,
    startingContribution: 0,
    stepUpAmount: 0,
    safetyFloor: 10_000_000, // nothing is ever investable → no sweep buys
  };
  const results = runProjection(settings, [], [], [], securities, [], [], 1);
  let held = false;
  for (const r of results) {
    const hasLot = r.tbillEnd >= face - 1;
    if (hasLot) held = true;
    else if (held) return r.monthNumber; // first month the recorded lot is gone
  }
  return null;
}

describe("Round 40 #2 — deep-link maturity month aligns with engine", () => {
  it("91-day T-bill: deep-link month equals engine maturity month", () => {
    const issue = monthsAfter(START, 0, 24);
    const maturity = monthsAfter(START, 3, 23); // ~91 days later
    const securities: ActualSecurity[] = [
      { securityType: "tbill_91", faceValue: 50000, issueDate: issue, maturityDate: maturity, couponRate: 0, isTaxExempt: false, isMatured: false },
    ];
    const deepLink = ledgerMonthForDate(new Date(maturity), START);
    const engineMonth = engineMaturityMonth(securities, 50000);
    expect(engineMonth).not.toBeNull();
    expect(deepLink).toBe(engineMonth);
  });

  it("182-day T-bill: deep-link month equals engine maturity month", () => {
    const issue = monthsAfter(START, 1, 10);
    const maturity = monthsAfter(START, 7, 9); // ~182 days later
    const securities: ActualSecurity[] = [
      { securityType: "tbill_182", faceValue: 50000, issueDate: issue, maturityDate: maturity, couponRate: 0, isTaxExempt: false, isMatured: false },
    ];
    const deepLink = ledgerMonthForDate(new Date(maturity), START);
    const engineMonth = engineMaturityMonth(securities, 50000);
    expect(engineMonth).not.toBeNull();
    expect(deepLink).toBe(engineMonth);
  });

  it("ledgerMonthForDate is 1-indexed from the plan start", () => {
    expect(ledgerMonthForDate(new Date(monthsAfter(START, 0, 15)), START)).toBe(1);
    expect(ledgerMonthForDate(new Date(monthsAfter(START, 5, 15)), START)).toBe(6);
    // Dates before the start are not valid ledger months.
    expect(ledgerMonthForDate(new Date(monthsAfter(START, -2, 15)), START)).toBeNull();
  });
});
