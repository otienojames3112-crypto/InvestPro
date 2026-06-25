import { describe, it, expect } from "vitest";
import {
  expectedAccrual,
  reconcileAccrual,
  type AccrualReconItem,
} from "../shared/reconciliation";
import {
  buildSecurityDailySchedule,
  buildBankDailySchedule,
  type SecurityIncomeInput,
  type BankIncomeInput,
} from "../shared/incomeBreakdown";

const DAYS = 365;
// A maturity far in the future so isLiveSecurity() always passes regardless of
// when the test runs.
const FUTURE = "2099-12-31";

describe("R40.6 — accrued interest + WHT reconciliation (gov + bank)", () => {
  it("expectedAccrual computes annual gross and WHT over a full year", () => {
    // KES 1,000,000 @ 12% with 15% WHT over 365 days = 120,000 gross, 18,000 WHT.
    const items: AccrualReconItem[] = [{ base: 1_000_000, ratePct: 12, whtPct: 15 }];
    const exp = expectedAccrual(items, DAYS);
    expect(exp.gross).toBeCloseTo(120_000, 0);
    expect(exp.wht).toBeCloseTo(18_000, 0);
  });

  it("gov-security schedule reconciles GREEN against the expectation", () => {
    const securities: SecurityIncomeInput[] = [
      { id: 1, securityType: "tbill_364", faceValue: 500_000, couponRate: 9, isTaxExempt: false, maturityDate: FUTURE },
      { id: 2, securityType: "ifb", faceValue: 1_000_000, couponRate: 13, isTaxExempt: true, maturityDate: FUTURE },
      { id: 3, securityType: "fxd", faceValue: 800_000, couponRate: 11, isTaxExempt: false, maturityDate: FUTURE },
    ];
    const schedule = buildSecurityDailySchedule(securities, DAYS);
    const items: AccrualReconItem[] = securities.map((s) => ({
      base: s.faceValue,
      ratePct: s.couponRate,
      whtPct: s.isTaxExempt || s.securityType === "ifb" ? 0 : 15,
    }));
    const r = reconcileAccrual(items, DAYS, schedule.grossTotal, schedule.whtTotal);
    expect(r.ok).toBe(true);
    expect(Math.abs(r.grossDiff)).toBeLessThanOrEqual(5);
    expect(Math.abs(r.whtDiff)).toBeLessThanOrEqual(5);
    // IFB is tax-exempt, so total WHT only covers the T-bill + FXD.
    const expectedWht = 500_000 * 0.09 * 0.15 + 800_000 * 0.11 * 0.15;
    expect(r.expectedWht).toBeCloseTo(expectedWht, 0);
  });

  it("gov-security check turns RED when the schedule drifts (wrong WHT tier)", () => {
    const securities: SecurityIncomeInput[] = [
      { id: 1, securityType: "fxd", faceValue: 1_000_000, couponRate: 12, isTaxExempt: false, maturityDate: FUTURE },
    ];
    const schedule = buildSecurityDailySchedule(securities, DAYS);
    // Expectation deliberately mis-states the WHT as 10% instead of the 15% the
    // schedule applies → the WHT drift exceeds tolerance and the row goes red.
    const wrongItems: AccrualReconItem[] = [{ base: 1_000_000, ratePct: 12, whtPct: 10 }];
    const r = reconcileAccrual(wrongItems, DAYS, schedule.grossTotal, schedule.whtTotal);
    expect(r.ok).toBe(false);
    expect(Math.abs(r.whtDiff)).toBeGreaterThan(5);
  });

  it("bank-instrument schedule reconciles GREEN against the expectation", () => {
    const holdings: BankIncomeInput[] = [
      { id: 1, bankName: "Equity", instrumentType: "fixed_deposit", principal: 1_000_000, interestRate: 10, whtRate: 15, dayCountBasis: 365, isActive: true },
      { id: 2, bankName: "KCB", instrumentType: "call_deposit", principal: 500_000, interestRate: 8, whtRate: 15, dayCountBasis: 360, isActive: true },
    ];
    const schedule = buildBankDailySchedule(holdings, DAYS);
    const items: AccrualReconItem[] = holdings.map((h) => ({
      base: h.principal,
      ratePct: h.interestRate,
      whtPct: h.whtRate,
      dayCountBasis: h.dayCountBasis,
    }));
    const r = reconcileAccrual(items, DAYS, schedule.grossTotal, schedule.whtTotal);
    expect(r.ok).toBe(true);
  });

  it("bank check turns RED when the expectation rate drifts from the schedule", () => {
    const holdings: BankIncomeInput[] = [
      { id: 1, bankName: "Equity", instrumentType: "fixed_deposit", principal: 2_000_000, interestRate: 10, whtRate: 15, dayCountBasis: 365, isActive: true },
    ];
    const schedule = buildBankDailySchedule(holdings, DAYS);
    // Expectation uses a wrong rate (7% vs the 10% the schedule used).
    const wrongItems: AccrualReconItem[] = [{ base: 2_000_000, ratePct: 7, whtPct: 15 }];
    const r = reconcileAccrual(wrongItems, DAYS, schedule.grossTotal, schedule.whtTotal);
    expect(r.ok).toBe(false);
    expect(Math.abs(r.grossDiff)).toBeGreaterThan(5);
  });

  it("ignores matured securities so they do not inflate the expectation", () => {
    const securities: SecurityIncomeInput[] = [
      { id: 1, securityType: "tbill_364", faceValue: 500_000, couponRate: 9, isTaxExempt: false, maturityDate: FUTURE },
      { id: 2, securityType: "tbill_364", faceValue: 999_999, couponRate: 9, isTaxExempt: false, isMatured: true, maturityDate: "2020-01-01" },
    ];
    const schedule = buildSecurityDailySchedule(securities, DAYS);
    const items: AccrualReconItem[] = [{ base: 500_000, ratePct: 9, whtPct: 15 }];
    const r = reconcileAccrual(items, DAYS, schedule.grossTotal, schedule.whtTotal);
    expect(r.ok).toBe(true);
  });
});
