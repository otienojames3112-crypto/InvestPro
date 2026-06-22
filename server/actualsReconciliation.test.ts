import { describe, it, expect } from "vitest";
import {
  runProjection,
  monthOffsetFromStart,
  type EngineSettings,
  type ActualDeposit,
  type ActualBankHolding,
  type SecondaryMmfInput,
} from "./engine";

/**
 * Round 20 — Actuals reconciliation.
 *
 * These tests lock the contract that the projection's "today" snapshot (the
 * last actual month) represents every recorded pocket of real money exactly
 * once, on a unified basis, and that nothing is dropped or double-counted.
 *
 * The plan starts 6 months in the PAST so the elapsed-month (actuals) path is
 * actually exercised: currentMonth ≈ 6.
 */

// Build a start date exactly `n` whole months before today (UTC, day 1).
function pastStartISO(monthsBack: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

// ISO date `k` months after the start date.
function monthsAfter(startISO: string, k: number, day: number): string {
  const s = new Date(startISO + "T12:00:00Z");
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, day, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

const START = pastStartISO(6);

const SETTINGS: EngineSettings = {
  mmfYield: 13.2,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 30000,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  startDate: START,
  horizonMonths: 120,
};

const PRIMARY_FUND = 1;
const SECONDARY_FUND = 2;

/** The "today" snapshot = the last elapsed (actual) month's result. */
function todaySnapshot(results: ReturnType<typeof runProjection>) {
  const actuals = results.filter((r) => r.isActual);
  return actuals[actuals.length - 1];
}

describe("actuals reconciliation — every pocket represented once", () => {
  it("computes a non-zero currentMonth for a past start date", () => {
    expect(monthOffsetFromStart(START, new Date(START + "T12:00:00Z"))).toBe(1);
    const results = runProjection(SETTINGS, [], [], [
      { bucket: "mmf", amount: 100000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
    ]);
    // At least one actual month must exist.
    expect(results.some((r) => r.isActual)).toBe(true);
  });

  it("includes a primary-MMF deposit AND grows it through elapsed months", () => {
    const deposits: ActualDeposit[] = [
      { bucket: "mmf", amount: 100000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
    ];
    const results = runProjection(SETTINGS, [], [], deposits, [], [], [], PRIMARY_FUND);
    const today = todaySnapshot(results);
    // The MMF must hold MORE than the bare 100k principal because it accrued
    // interest across the elapsed months (Fix #3) — not a flat lump.
    expect(today.mmfEnd).toBeGreaterThan(100000);
    // But still in a sane band (a few months of ~13% net growth, not double).
    expect(today.mmfEnd).toBeLessThan(115000);
  });

  it("represents T-bill and FXD government-security deposits at face value (Fix #2)", () => {
    const deposits: ActualDeposit[] = [
      { bucket: "tbill", amount: 50000, depositDate: monthsAfter(START, 1, 15), institutionType: "government_security", mmfFundId: null },
      { bucket: "fxd", amount: 100000, depositDate: monthsAfter(START, 2, 1), institutionType: "government_security", mmfFundId: null },
    ];
    const results = runProjection(SETTINGS, [], [], deposits, [], [], [], PRIMARY_FUND);
    const today = todaySnapshot(results);
    // These would have been DROPPED entirely by the old engine.
    expect(today.tbillEnd).toBeCloseTo(50000, 0);
    expect(today.fxdEnd).toBeCloseTo(100000, 0);
  });

  it("does NOT double-count secondary-fund or bank deposits in the primary MMF", () => {
    const deposits: ActualDeposit[] = [
      // primary
      { bucket: "mmf", amount: 100000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
      // secondary fund — represented by secondaryState, must be excluded from primary
      { bucket: "mmf", amount: 30000, depositDate: monthsAfter(START, 1, 5), institutionType: "mmf_fund", mmfFundId: SECONDARY_FUND },
      // bank instrument — represented by bankState, must be excluded from primary
      { bucket: "mmf", amount: 200000, depositDate: monthsAfter(START, 2, 5), institutionType: "bank_instrument", mmfFundId: null },
    ];
    const secondaries: SecondaryMmfInput[] = [
      { currentBalance: 30000, monthlyContribution: 0, ear: 12, whtRate: 15 },
    ];
    const bank: ActualBankHolding[] = [
      { principal: 200000, interestRate: 10.5, whtRate: 15, startDate: monthsAfter(START, 2, 5), isActive: true },
    ];
    const results = runProjection(SETTINGS, [], [], deposits, [], secondaries, bank, PRIMARY_FUND);
    const today = todaySnapshot(results);
    // Primary MMF reflects only the 100k (plus its own accrued interest), NOT 330k.
    expect(today.mmfEnd).toBeGreaterThan(100000);
    expect(today.mmfEnd).toBeLessThan(115000);
    // Secondary and bank are held flat at principal during elapsed months.
    expect(today.secondaryMmfEnd).toBeCloseTo(30000, 0);
    expect(today.bankEnd).toBeCloseTo(200000, 0);
  });

  it("reconciles: today total == sum of all per-pocket balances", () => {
    const deposits: ActualDeposit[] = [
      { bucket: "mmf", amount: 100000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
      { bucket: "tbill", amount: 50000, depositDate: monthsAfter(START, 1, 15), institutionType: "government_security", mmfFundId: null },
      { bucket: "fxd", amount: 100000, depositDate: monthsAfter(START, 2, 1), institutionType: "government_security", mmfFundId: null },
      { bucket: "mmf", amount: 30000, depositDate: monthsAfter(START, 1, 5), institutionType: "mmf_fund", mmfFundId: SECONDARY_FUND },
      { bucket: "mmf", amount: 200000, depositDate: monthsAfter(START, 2, 5), institutionType: "bank_instrument", mmfFundId: null },
    ];
    const secondaries: SecondaryMmfInput[] = [
      { currentBalance: 30000, monthlyContribution: 0, ear: 12, whtRate: 15 },
    ];
    const bank: ActualBankHolding[] = [
      { principal: 200000, interestRate: 10.5, whtRate: 15, startDate: monthsAfter(START, 2, 5), isActive: true },
    ];
    const results = runProjection(SETTINGS, [], [], deposits, [], secondaries, bank, PRIMARY_FUND);
    const today = todaySnapshot(results);
    const sumOfPockets =
      today.mmfEnd + today.tbillEnd + today.ifbEnd + today.fxdEnd + today.secondaryMmfEnd + today.bankEnd;
    expect(today.totalEnd).toBeCloseTo(sumOfPockets, 2);
    // Total must be at least the bare principal of everything (480k) — interest only adds.
    expect(today.totalEnd).toBeGreaterThanOrEqual(480000);
    // And not wildly more than principal after a few elapsed months.
    expect(today.totalEnd).toBeLessThan(500000);
  });

  it("excludes inactive bank holdings from the projection", () => {
    const bank: ActualBankHolding[] = [
      { principal: 200000, interestRate: 10.5, whtRate: 15, startDate: monthsAfter(START, 0, 1), isActive: false },
    ];
    const deposits: ActualDeposit[] = [
      { bucket: "mmf", amount: 10000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
    ];
    const results = runProjection(SETTINGS, [], [], deposits, [], [], bank, PRIMARY_FUND);
    const today = todaySnapshot(results);
    expect(today.bankEnd).toBe(0);
  });

  it("forward months still receive scheduled contributions after the actual handoff", () => {
    const deposits: ActualDeposit[] = [
      { bucket: "mmf", amount: 100000, depositDate: monthsAfter(START, 0, 5), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
    ];
    const results = runProjection(SETTINGS, [], [], deposits, [], [], [], PRIMARY_FUND);
    const actuals = results.filter((r) => r.isActual);
    const firstForward = results[actuals.length]; // first non-actual month
    // The first forward month must add the scheduled contribution (>0), proving
    // the handoff from actuals to projection is continuous.
    expect(firstForward.isActual).toBe(false);
    expect(firstForward.contribution).toBeGreaterThan(0);
    // The forward total must exceed the last actual total (money keeps flowing in).
    expect(firstForward.totalEnd).toBeGreaterThan(actuals[actuals.length - 1].totalEnd);
  });
});
