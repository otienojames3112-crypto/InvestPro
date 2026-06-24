import { describe, expect, it } from "vitest";
import {
  runProjection,
  applySovereignPreference,
  SOVEREIGN_PREFERENCE_THRESHOLD_PCT,
  type EngineSettings,
  type ActualBankHolding,
  type ActualDeposit,
} from "./engine";

/**
 * Round 30 engine behaviour:
 *  - TERM bank deposits (fixed_deposit / target_savings) accrue to maturity, then
 *    return principal + interest to the MMF where the yield-max allocator redeploys
 *    them. The Month Ledger narrates the maturity in plain language.
 *  - LIQUID bank deposits (call/ordinary/tiered savings) accrue in place and are
 *    never zeroed out by a maturity.
 *  - applySovereignPreference demotes a bank candidate that only narrowly beats the
 *    best government instrument.
 */

// A long horizon so the projection runs forward past any near-term maturity.
function baseSettings(overrides: Partial<EngineSettings> = {}): EngineSettings {
  return {
    mmfYield: 9,
    tbill91Rate: 9,
    tbill182Rate: 9.5,
    tbill364Rate: 10,
    ifbCouponRate: 12.5,
    fxdCouponRate: 12.35,
    withholdingTax: 15,
    startingContribution: 50_000,
    stepUpAmount: 0,
    stepUpMonths: 6,
    safetyFloor: 100_000,
    targetAmount: 5_000_000,
    // Start ~3 years ago so several actual months elapse and a near-dated maturity is hit.
    startDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 3)
      .toISOString()
      .slice(0, 10),
    horizonMonths: 120,
    ...overrides,
  };
}

// A single MMF deposit so the projection has actuals to seed from.
const seedDeposit: ActualDeposit[] = [
  {
    bucket: "mmf",
    amount: 200_000,
    depositDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 3)
      .toISOString()
      .slice(0, 10),
    institutionType: "mmf_fund",
    mmfFundId: 1,
  },
];

describe("Round 30 — bank-deposit maturity & redeployment", () => {
  it("matures a term fixed deposit: bank balance drops and cash is redeployed", () => {
    // Fixed deposit that matured roughly a year ago (well within elapsed months).
    const maturedAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365)
      .toISOString()
      .slice(0, 10);
    const startedAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 2)
      .toISOString()
      .slice(0, 10);
    const bank: ActualBankHolding[] = [
      {
        label: "NCBA 12-month FD",
        bankName: "NCBA",
        principal: 300_000,
        interestRate: 11,
        instrumentType: "fixed_deposit",
        tenorMonths: 12,
        startDate: startedAt,
        maturityDate: maturedAgo,
        payoutFrequency: "maturity",
        isActive: true,
      },
    ];

    const months = runProjection(
      baseSettings(),
      [],
      [],
      seedDeposit,
      [],
      [],
      bank,
      1,
    );

    expect(months.length).toBeGreaterThan(0);

    // The actual months should include a maturity event narrated in the ledger.
    const maturityMonth = months.find((m) =>
      /matur/i.test(m.mainAction) && /NCBA|fixed/i.test(m.mainAction),
    );
    expect(maturityMonth).toBeTruthy();

    // After maturity, the bank balance for that single holding must collapse to ~0
    // in at least one elapsed month (principal moved out to the MMF).
    const minBank = Math.min(...months.map((m) => m.bankEnd));
    expect(minBank).toBeLessThan(300_000 * 0.5);
  });

  it("keeps a liquid call deposit accruing in place (never zeroed by maturity)", () => {
    const startedAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 2)
      .toISOString()
      .slice(0, 10);
    const bank: ActualBankHolding[] = [
      {
        label: "Equity Call",
        bankName: "Equity",
        principal: 250_000,
        interestRate: 7,
        instrumentType: "call_deposit",
        startDate: startedAt,
        payoutFrequency: "on_call",
        isActive: true,
      },
    ];

    const months = runProjection(
      baseSettings(),
      [],
      [],
      seedDeposit,
      [],
      [],
      bank,
      1,
    );

    // A liquid deposit must accrue: its tracked bank balance never drops below the
    // original principal across the elapsed months.
    const minBank = Math.min(...months.map((m) => m.bankEnd));
    expect(minBank).toBeGreaterThanOrEqual(250_000 - 1);
  });
});

describe("Round 30 — sovereign preference tie-break", () => {
  it("demotes a bank candidate that only narrowly beats the best government net yield", () => {
    const ranked = [
      { bucket: "bank", netPct: 10.5, label: "Bank FD" },
      { bucket: "tbill", netPct: 10.0, label: "364-day T-bill" },
    ];
    const out = applySovereignPreference(ranked, SOVEREIGN_PREFERENCE_THRESHOLD_PCT);
    // Bank only beats gov by 0.5pp (< 1.0pp threshold) → government goes first.
    expect(out[0]?.bucket).toBe("tbill");
  });

  it("keeps a bank candidate first when it clears the threshold comfortably", () => {
    const ranked = [
      { bucket: "bank", netPct: 12.0, label: "Bank FD" },
      { bucket: "tbill", netPct: 10.0, label: "364-day T-bill" },
    ];
    const out = applySovereignPreference(ranked, SOVEREIGN_PREFERENCE_THRESHOLD_PCT);
    // Bank beats gov by 2.0pp (> 1.0pp threshold) → bank stays first.
    expect(out[0]?.bucket).toBe("bank");
  });

  it("returns a government-only list unchanged", () => {
    const ranked = [
      { bucket: "ifb", netPct: 12.5, label: "IFB" },
      { bucket: "fxd", netPct: 10.5, label: "FXD" },
    ];
    const out = applySovereignPreference(ranked);
    expect(out.map((r) => r.bucket)).toEqual(["ifb", "fxd"]);
  });
});
