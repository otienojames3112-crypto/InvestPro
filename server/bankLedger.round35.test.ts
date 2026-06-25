import { describe, it, expect } from "vitest";
import { runProjection, type EngineSettings, type ActualBankHolding } from "./engine";

/**
 * Round 35 — Bank instruments must be visible in the Month-by-Month Ledger.
 *
 * The reported bug: a bank fixed deposit existed but never appeared in the
 * ledger (no Bank column, no placement/maturity narration). These tests pin
 * the engine outputs the ledger UI renders:
 *   - `bankEnd`     → the "Bank" balance column
 *   - `bankCashIn`  → the "Bank In" column (cash returned to the MMF at maturity)
 *   - `mainAction`  → placement + maturity narration
 */

const baseSettings: EngineSettings = {
  mmfYield: 9.0,
  tbill91Rate: 9.5,
  tbill182Rate: 10.0,
  tbill364Rate: 10.5,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.0,
  withholdingTax: 15,
  startingContribution: 41000,
  stepUpAmount: 0,
  stepUpMonths: 12,
  safetyFloor: 0,
  targetAmount: 5_000_000,
  // Start in the future so every month is a forward (projected) month — the
  // bank-placement narration only fires on the forward path.
  startDate: "2099-01-01",
  horizonMonths: 12,
};

/** A 3-month fixed deposit placed at the plan start. */
function makeFixedDeposit(): ActualBankHolding {
  return {
    label: "NCBA",
    bankName: "NCBA Bank",
    principal: 100000,
    interestRate: 10,
    whtRate: 15,
    dayCountBasis: 365,
    startDate: "2099-01-01",
    isActive: true,
    instrumentType: "fixed_deposit",
    tenorMonths: 3,
    maturityDate: "2099-04-01",
    payoutFrequency: "maturity",
    maturityAction: "redeploy",
    earlyBreakPenaltyPct: 50,
  };
}

describe("Round 35 — bank instruments in the ledger", () => {
  it("surfaces the bank balance (bankEnd) while the deposit is live", () => {
    const results = runProjection(baseSettings, [], [], [], [], [], [makeFixedDeposit()]);
    // Month 1 (placement month) through maturity should carry a positive bank balance.
    expect(results[0].bankEnd).toBeGreaterThanOrEqual(100000);
    expect(results[1].bankEnd).toBeGreaterThan(0);
  });

  it("narrates the placement in the month the deposit appears", () => {
    const results = runProjection(baseSettings, [], [], [], [], [], [makeFixedDeposit()]);
    expect(results[0].mainAction).toMatch(/Placed KES 100,000/);
    expect(results[0].mainAction).toMatch(/NCBA/);
    expect(results[0].mainAction).toMatch(/fixed deposit/i);
  });

  it("returns matured cash to the MMF (bankCashIn) and narrates the maturity", () => {
    const results = runProjection(baseSettings, [], [], [], [], [], [makeFixedDeposit()]);
    // 3-month tenor placed in month 1 → matures in month 4 (index 3).
    const maturityMonth = results.find((r) => r.bankCashIn > 0);
    expect(maturityMonth).toBeDefined();
    expect(maturityMonth!.bankCashIn).toBeGreaterThan(100000); // principal + net interest
    // After maturity the bank balance drops back to zero.
    const afterMaturity = results[results.length - 1];
    expect(afterMaturity.bankEnd).toBe(0);
  });

  it("does not invent a bank balance when there are no bank holdings", () => {
    const results = runProjection(baseSettings, [], [], [], [], [], []);
    expect(results.every((r) => r.bankEnd === 0)).toBe(true);
    expect(results.every((r) => r.bankCashIn === 0)).toBe(true);
    expect(results.every((r) => !/Placed KES/.test(r.mainAction))).toBe(true);
  });
});
