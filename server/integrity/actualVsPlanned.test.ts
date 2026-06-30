import { describe, it, expect } from "vitest";
import { runProjection, type EngineSettings } from "../engine";
import { reconcile, type ReconInputs } from "../../shared/reconciliation";

/**
 * Suite 6 — Actual vs planned (a missed contribution).
 *
 * Plan a contribution, then record reality where the month's deposit was missed.
 * The engine must (a) reflect zero contribution that month, (b) rebase the
 * projection so the horizon ending value is lower than the clean schedule, and
 * (c) reconciliation against the real balance must still come out green — the
 * shortfall is honest reality, not a reconciliation error.
 */

const START_ISO = "2026-07-01";
const HORIZON = 120;

const BASE: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 41_000,
  stepUpAmount: 0,
  stepUpMonths: 6,
  safetyFloor: 50_000,
  targetAmount: 5_000_000,
  horizonMonths: HORIZON,
  startDate: START_ISO,
};

/** ISO date for a start exactly `monthsBack` whole months before today. */
function pastStartISO(monthsBack: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

/** ISO date `k` whole months after `startISO`, on the given day. */
function monthsAfter(startISO: string, k: number, day: number): string {
  const s = new Date(startISO + "T12:00:00Z");
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, day, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

describe("actual vs planned (missed contribution rebases the projection honestly)", () => {
  it("a month with a zero override records zero contribution", () => {
    // Future projection where month 3's planned 41k is overridden to 0.
    const rows = runProjection(
      BASE,
      [{ monthNumber: 3, overrideAmount: 0 }],
      [],
      [],
      [],
      [],
    );
    const m3 = rows.find((r) => r.monthNumber === 3)!;
    expect(m3.contribution).toBe(0);
  });

  it("a missed contribution lowers the horizon ending value vs the clean schedule", () => {
    const clean = runProjection(BASE, [], [], [], [], []);
    const missed = runProjection(
      BASE,
      [{ monthNumber: 3, overrideAmount: 0 }],
      [],
      [],
      [],
      [],
    );
    const cleanEnd = clean[clean.length - 1].totalEnd;
    const missedEnd = missed[missed.length - 1].totalEnd;
    expect(missedEnd).toBeLessThan(cleanEnd);
    // The gap should be at least the missed principal (one 41k contribution),
    // since that money — plus its compounding — never entered the portfolio.
    expect(cleanEnd - missedEnd).toBeGreaterThanOrEqual(41_000);
  });

  it("a settled month with no recorded contribution is marked off-plan", () => {
    // Use a real 6-month-past start so the elapsed (actuals) path runs against
    // the real clock. Record a deposit ONLY in month 3 — months 1 and 2 are
    // settled with no recorded money in, so they diverge from the planned 41k.
    const start = pastStartISO(6);
    const rows = runProjection(
      { ...BASE, startDate: start },
      [],
      [],
      // actualDeposits (4th arg): a real primary-MMF deposit only in month 3.
      [{
        bucket: "mmf",
        amount: 41_000,
        depositDate: monthsAfter(start, 2, 5),
        institutionType: "mmf_fund",
        mmfFundId: 1,
      }] as never,
      [],
      [],
      [],
      1,
    );
    const m1 = rows.find((r) => r.monthNumber === 1)!;
    expect(m1.isActual).toBe(true);
    expect(m1.contribution).toBe(0);
    expect(m1.offPlan).toBe(true);
  });

  it("reconciliation against the honest (lower) real balance stays green", () => {
    // The portfolio is whatever reality says — every source agrees on the same
    // real number, so the verdict is green even though it is below plan.
    const realBalance = 38_500; // one short month of net MMF, honestly recorded
    const inputs: ReconInputs = {
      primaryMmfBalance: realBalance,
      secondaryMmfBalances: [],
      bankHoldingPrincipals: [],
      securityFaceValues: [],
      otherAssetValues: [],
      projectionTodayValue: realBalance,
      dashboardActualsTotal: realBalance,
      accrualLedgerMmfTotal: realBalance,
      dashboardNetWorth: realBalance,
      portfolioReviewNetWorth: realBalance,
    };
    const result = reconcile(inputs);
    expect(result.reconciled).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });

  it("a missed month does NOT create a reconciliation drift if every source agrees", () => {
    // Even with a below-plan balance, as long as Dashboard, projection, accrual
    // and portfolio review all read the SAME real number, there is no drift.
    const real = 79_000;
    const inputs: ReconInputs = {
      primaryMmfBalance: real,
      secondaryMmfBalances: [],
      bankHoldingPrincipals: [],
      securityFaceValues: [],
      otherAssetValues: [],
      projectionTodayValue: real,
      dashboardActualsTotal: real,
      accrualLedgerMmfTotal: real,
      dashboardNetWorth: real,
      portfolioReviewNetWorth: real,
    };
    const result = reconcile(inputs);
    expect(result.reconciled).toBe(true);
    expect(result.mismatches).toHaveLength(0);
  });
});
