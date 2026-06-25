import { describe, it, expect } from "vitest";
import {
  runProjection,
  type EngineSettings,
  type ActualSecurity,
} from "./engine";

/**
 * Round 40 — CRITICAL: recorded securities must be visible to the ledger even
 * when the plan starts in the current/future month (currentMonth === 0).
 *
 * Previously the security-lot seeding loop was nested inside
 * `if (hasActuals && currentMonth > 0)`, so a brand-new plan (start = this
 * month) silently dropped every register holding: a recorded T-bill never
 * became a lot, never appeared in the ledger, never accrued, never matured.
 *
 * These tests start the plan IN THE CURRENT MONTH so currentMonth === 0, and
 * assert that a recorded security is projected forward from month 1.
 */

// Start the plan in the current month (UTC, day 1) → currentMonth === 0.
function currentMonthStartISO(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

// ISO date `k` months after the start date, on the given day.
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
  horizonMonths: 12,
};

const PRIMARY_FUND = 1;

describe("Round 40 — security lot seeding at currentMonth === 0", () => {
  it("shows a recorded 91-day T-bill in the T-bill 91d column from month 1, at face", () => {
    // 91-day T-bill (~3 months), issued in the start month, maturing 3 months later.
    const securities: ActualSecurity[] = [
      {
        securityType: "tbill_91",
        faceValue: 50000,
        issueDate: monthsAfter(START, 0, 24),
        maturityDate: monthsAfter(START, 3, 23),
        couponRate: 0,
        isTaxExempt: false,
        isMatured: false,
      },
    ];
    const results = runProjection(SETTINGS, [], [], [], securities, [], [], PRIMARY_FUND);

    const m1 = results.find((r) => r.monthNumber === 1)!;
    // The lot must be present at face in the 91-day column from month 1.
    expect(m1.tbill91End).toBeCloseTo(50000, 0);
    expect(m1.tbillEnd).toBeGreaterThanOrEqual(50000 - 1);
  });

  it("matures the T-bill in the correct month with narration + CBK-In cash, and keeps totalEnd continuous", () => {
    const securities: ActualSecurity[] = [
      {
        securityType: "tbill_91",
        faceValue: 50000,
        issueDate: monthsAfter(START, 0, 24),
        maturityDate: monthsAfter(START, 3, 23),
        couponRate: 0,
        isTaxExempt: false,
        isMatured: false,
      },
    ];
    const results = runProjection(SETTINGS, [], [], [], securities, [], [], PRIMARY_FUND);

    // issueMonth = 1, tenorMonths = 3 → matures at month 4 (age === tenorMonths).
    const maturityMonth = results.find((r) => r.monthNumber === 4)!;
    // CBK-In carries the returned cash (face + net interest).
    expect(maturityMonth.cbkCashIn).toBeGreaterThanOrEqual(50000);
    // Narration mentions the T-bill maturing.
    expect(maturityMonth.mainAction.toLowerCase()).toContain("t-bill");
    expect(maturityMonth.mainAction.toLowerCase()).toContain("matures");

    // The original lot is held at face right up to the month before maturity.
    const monthBefore = results.find((r) => r.monthNumber === 3)!;
    expect(monthBefore.tbill91End).toBeGreaterThanOrEqual(50000 - 1);

    // totalEnd must be continuous (no drop) across the maturity boundary — the
    // cash moved from the T-bill pocket into the MMF (and may be re-deployed by
    // the yield-max sweep), it was never lost.
    expect(maturityMonth.totalEnd).toBeGreaterThanOrEqual(monthBefore.totalEnd - 1);
  });

  it("regression: a recorded T-bill is NOT dropped when currentMonth === 0", () => {
    const securities: ActualSecurity[] = [
      {
        securityType: "tbill_91",
        faceValue: 50000,
        issueDate: monthsAfter(START, 0, 24),
        maturityDate: monthsAfter(START, 3, 23),
        couponRate: 0,
        isTaxExempt: false,
        isMatured: false,
      },
    ];
    const withSec = runProjection(SETTINGS, [], [], [], securities, [], [], PRIMARY_FUND);
    const withoutSec = runProjection(SETTINGS, [], [], [], [], [], [], PRIMARY_FUND);

    const m1With = withSec.find((r) => r.monthNumber === 1)!;
    const m1Without = withoutSec.find((r) => r.monthNumber === 1)!;
    // With the security recorded, month 1 must hold ~50k more across the portfolio.
    expect(m1With.totalEnd - m1Without.totalEnd).toBeGreaterThan(40000);
  });

  it("matured securities (isMatured=true) are not re-seeded as live lots", () => {
    const securities: ActualSecurity[] = [
      {
        securityType: "tbill_91",
        faceValue: 50000,
        issueDate: monthsAfter(START, 0, 24),
        maturityDate: monthsAfter(START, 3, 23),
        couponRate: 0,
        isTaxExempt: false,
        isMatured: true,
      },
    ];
    const results = runProjection(SETTINGS, [], [], [], securities, [], [], PRIMARY_FUND);
    const m1 = results.find((r) => r.monthNumber === 1)!;
    expect(m1.tbill91End).toBeCloseTo(0, 0);
  });
});
