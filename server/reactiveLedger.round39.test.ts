import { describe, it, expect } from "vitest";
import {
  runProjection,
  type EngineSettings,
  type ActualDeposit,
} from "./engine";

/**
 * Round 39 — Ledger reactivity to off-schedule actual deposits.
 *
 * The Month Ledger must update when the user records a deposit different from
 * the projected schedule. If the plan projects KES 41,000 for an elapsed month
 * but the user actually deposits far more, the actual-month row AND every
 * subsequent row must recompute from the real money in — a higher MMF balance,
 * a different end total — and the "today" snapshot must still reconcile with the
 * sum of recorded pockets.
 *
 * The plan starts in the PAST so the elapsed (actuals) path is exercised.
 */

function pastStartISO(monthsBack: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

function monthsAfter(startISO: string, k: number, day: number): string {
  const s = new Date(startISO + "T12:00:00Z");
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, day, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

const START = pastStartISO(4);
const PRIMARY_FUND = 1;

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
  targetAmount: 5000000,
  startDate: START,
  horizonMonths: 120,
};

function lastActual(results: ReturnType<typeof runProjection>) {
  const actuals = results.filter((r) => r.isActual);
  return actuals[actuals.length - 1];
}

describe("Round 39 — ledger reacts to off-schedule actual deposits", () => {
  it("an actual deposit larger than the schedule raises that month and every later month", () => {
    // Baseline: a modest on-schedule deposit in month 1.
    const baselineDeposits: ActualDeposit[] = [
      { bucket: "mmf", amount: 41000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
    ];
    // Reactive: the SAME month, but the user actually deposited far more.
    const bigDeposits: ActualDeposit[] = [
      { bucket: "mmf", amount: 200000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
    ];

    const baseline = runProjection(SETTINGS, [], [], baselineDeposits, [], [], [], PRIMARY_FUND);
    const reactive = runProjection(SETTINGS, [], [], bigDeposits, [], [], [], PRIMARY_FUND);

    // The actual month must reflect the real (bigger) money, not the schedule.
    const baseToday = lastActual(baseline);
    const reactToday = lastActual(reactive);
    expect(reactToday.totalEnd).toBeGreaterThan(baseToday.totalEnd + 100000);

    // Every forward month must also be higher (the extra capital compounds forward).
    for (let m = reactToday.monthNumber; m <= SETTINGS.horizonMonths; m++) {
      const b = baseline.find((r) => r.monthNumber === m)!;
      const r = reactive.find((r) => r.monthNumber === m)!;
      expect(r.totalEnd).toBeGreaterThan(b.totalEnd);
    }
  });

  it("the actual-month total is seeded from the recorded deposit, not the projected contribution", () => {
    // Record an off-schedule deposit much larger than the 41k schedule.
    const deposits: ActualDeposit[] = [
      { bucket: "mmf", amount: 150000, depositDate: monthsAfter(START, 0, 10), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
    ];
    const results = runProjection(SETTINGS, [], [], deposits, [], [], [], PRIMARY_FUND);
    const today = lastActual(results);
    // The seeded actual must be at least the deposited principal (plus a little
    // interest), proving it used the real deposit rather than the 41k schedule.
    expect(today.totalEnd).toBeGreaterThanOrEqual(150000);
  });

  it("the 'today' snapshot reconciles with the sum of recorded pockets", () => {
    const deposits: ActualDeposit[] = [
      { bucket: "mmf", amount: 120000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
      { bucket: "mmf", amount: 60000, depositDate: monthsAfter(START, 1, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
    ];
    const results = runProjection(SETTINGS, [], [], deposits, [], [], [], PRIMARY_FUND);
    const today = lastActual(results);
    // Principal in = 180k; the snapshot must be at least that (interest on top),
    // and within a sane band (no double-count: well under 2x principal early on).
    expect(today.totalEnd).toBeGreaterThanOrEqual(180000);
    expect(today.totalEnd).toBeLessThan(360000);
  });
});
