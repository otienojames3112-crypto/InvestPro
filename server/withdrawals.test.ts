import { describe, it, expect } from "vitest";
import { computeActualsTotals } from "../shared/actuals";

const RATES = { withholdingTax: 15, mmfYield: 13.54, tbillRate: 8.97, fxdCouponRate: 12.35 };

describe("Round 27 — withdrawals netting (computeActualsTotals)", () => {
  it("nets a primary-MMF withdrawal out of depositsContributed", () => {
    const before = computeActualsTotals(
      [{ amount: 100_000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: null }],
      [], [], RATES, [], [],
    );
    expect(before.depositsContributed).toBe(100_000);

    const after = computeActualsTotals(
      [{ amount: 100_000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: null }],
      [], [], RATES, [],
      [{ sourceType: "mmf_fund", mmfFundId: null, amount: 30_000 }],
    );
    expect(after.depositsContributed).toBe(70_000);
    expect(after.totalContributed).toBe(70_000);
  });

  it("nets a bank withdrawal out of the bank bucket only", () => {
    const after = computeActualsTotals(
      [],
      [],
      [{ principal: 200_000, interestRate: 9.75, whtRate: 15, isActive: true }],
      RATES, [],
      [{ sourceType: "bank_instrument", amount: 50_000 }],
    );
    expect(after.bankBalance).toBe(150_000);
  });

  it("nets a government-security withdrawal out of securitiesValue", () => {
    const after = computeActualsTotals(
      [],
      [], [], RATES,
      [{ securityType: "tbill_364", faceValue: 100_000, couponRate: 0, isTaxExempt: false, isMatured: false }],
      [{ sourceType: "government_security", amount: 100_000 }],
    );
    expect(after.securitiesValue).toBe(0);
  });

  it("distinguishes primary vs secondary MMF withdrawals", () => {
    const after = computeActualsTotals(
      [{ amount: 80_000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: null }],
      [{ mmfFundId: 7, currentBalance: 60_000, ear: 12, whtRate: 15 }],
      [], RATES, [],
      [{ sourceType: "mmf_fund", mmfFundId: 7, amount: 20_000 }],
    );
    // Primary untouched; secondary reduced.
    expect(after.depositsContributed).toBe(80_000);
    expect(after.secondaryMmfBalance).toBe(40_000);
  });

  it("floors an over-withdrawal at zero (never negative)", () => {
    const after = computeActualsTotals(
      [{ amount: 10_000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: null }],
      [], [], RATES, [],
      [{ sourceType: "mmf_fund", mmfFundId: null, amount: 999_999 }],
    );
    expect(after.depositsContributed).toBe(0);
    expect(after.totalContributed).toBe(0);
  });

  it("reduces MMF tax proportionally after a withdrawal", () => {
    const full = computeActualsTotals(
      [{ amount: 100_000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: null }],
      [], [], RATES, [], [],
    );
    const half = computeActualsTotals(
      [{ amount: 100_000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: null }],
      [], [], RATES, [],
      [{ sourceType: "mmf_fund", mmfFundId: null, amount: 50_000 }],
    );
    expect(half.taxBreakdown.mmf).toBeCloseTo(full.taxBreakdown.mmf / 2, 2);
  });
});

describe("Round 27 — early fixed-deposit forfeiture math", () => {
  // Mirrors the router formula: amount * rate * (daysHeld / dayCount).
  function forfeit(amount: number, ratePct: number, daysHeld: number, dayCount = 365) {
    return Math.round(amount * (ratePct / 100) * (daysHeld / dayCount) * 100) / 100;
  }

  it("forfeits accrued interest proportional to days held", () => {
    // KES 100,000 at 9.75% held 90 days on Actual/365.
    expect(forfeit(100_000, 9.75, 90)).toBeCloseTo(2404.11, 1);
  });

  it("forfeits zero on day zero", () => {
    expect(forfeit(100_000, 9.75, 0)).toBe(0);
  });
});
