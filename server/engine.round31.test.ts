import { describe, expect, it } from "vitest";
import {
  runProjection,
  detectIssuerConcentration,
  ISSUER_CONCENTRATION_CAP,
  type EngineSettings,
  type ActualBankHolding,
  type ActualDeposit,
} from "./engine";
import { earlyBreakWhatIf } from "../shared/actuals";

/**
 * Round 31 enhancements:
 *  - earlyBreakWhatIf (shared): estimate net retained if a term deposit is broken
 *    before maturity, given an early-break penalty on accrued interest.
 *  - detectIssuerConcentration: flag any issuer above the 25% net-worth cap.
 *  - maturityAction "rollover" vs "redeploy": a rolled-over term deposit renews in
 *    place (bank balance stays funded) instead of returning cash to the MMF.
 */

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
    startDate: new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 3)
      .toISOString()
      .slice(0, 10),
    horizonMonths: 120,
    ...overrides,
  };
}

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

describe("Round 31 — early-break what-if (shared)", () => {
  it("forfeits the penalty share of accrued interest and keeps the rest", () => {
    // ~1 year at 12% gross, 15% WHT, on KES 100,000.
    const oneYearAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365)
      .toISOString()
      .slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const res = earlyBreakWhatIf({
      principal: 100_000,
      interestRate: 12,
      whtRate: 15,
      startISO: oneYearAgo,
      earlyBreakPenaltyPct: 25,
      asOfISO: today,
    });
    // Net interest for ~1y at 12% after 15% WHT is roughly KES 10,000.
    expect(res.accruedInterest).toBeGreaterThan(8_000);
    expect(res.accruedInterest).toBeLessThan(12_000);
    // Penalty is 25% of accrued; retained = accrued - penalty.
    expect(res.penaltyAmount).toBeCloseTo(res.accruedInterest * 0.25, 1);
    expect(res.retainedInterest).toBeCloseTo(res.accruedInterest * 0.75, 1);
    // Net-if-broken-now = principal + retained interest.
    expect(res.netIfBrokenNow).toBeCloseTo(100_000 + res.retainedInterest, 1);
    expect(res.netIfBrokenNow).toBeGreaterThan(100_000);
  });

  it("a 100% penalty forfeits all accrued interest (net = principal)", () => {
    const oneYearAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365)
      .toISOString()
      .slice(0, 10);
    const res = earlyBreakWhatIf({
      principal: 50_000,
      interestRate: 10,
      whtRate: 15,
      startISO: oneYearAgo,
      earlyBreakPenaltyPct: 100,
    });
    expect(res.retainedInterest).toBe(0);
    expect(res.netIfBrokenNow).toBeCloseTo(50_000, 2);
  });

  it("zero penalty keeps the full accrued interest", () => {
    const oneYearAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365)
      .toISOString()
      .slice(0, 10);
    const res = earlyBreakWhatIf({
      principal: 50_000,
      interestRate: 10,
      whtRate: 15,
      startISO: oneYearAgo,
      earlyBreakPenaltyPct: 0,
    });
    expect(res.penaltyAmount).toBe(0);
    expect(res.netIfBrokenNow).toBeCloseTo(50_000 + res.accruedInterest, 2);
  });
});

describe("Round 31 — per-issuer concentration", () => {
  it("flags an issuer above the 25% cap and aggregates same-bank deposits", () => {
    const breaches = detectIssuerConcentration(
      [
        { issuer: "KCB", value: 200_000 },
        { issuer: "kcb", value: 200_000 }, // same bank, different case → summed
        { issuer: "Equity", value: 100_000 },
      ],
      1_000_000,
    );
    // KCB = 400k = 40% > 25% → flagged. Equity = 10% → not flagged.
    expect(breaches.map((b) => b.issuer.toLowerCase())).toContain("kcb");
    expect(breaches.find((b) => b.issuer.toLowerCase() === "equity")).toBeUndefined();
    const kcb = breaches.find((b) => b.issuer.toLowerCase() === "kcb")!;
    expect(kcb.value).toBe(400_000);
    expect(kcb.share).toBeCloseTo(0.4, 3);
  });

  it("flags nothing when every issuer is at or below the cap", () => {
    const breaches = detectIssuerConcentration(
      [
        { issuer: "KCB", value: 250_000 }, // exactly 25% → not a breach (strictly greater)
        { issuer: "Equity", value: 200_000 },
      ],
      1_000_000,
    );
    expect(breaches).toHaveLength(0);
  });

  it("returns nothing when net worth is zero", () => {
    expect(detectIssuerConcentration([{ issuer: "KCB", value: 100 }], 0)).toEqual([]);
  });

  it("exposes a 25% default cap", () => {
    expect(ISSUER_CONCENTRATION_CAP).toBeCloseTo(0.25, 5);
  });
});

describe("Round 31 — maturity action (rollover vs redeploy)", () => {
  function bankWith(action: "redeploy" | "rollover"): ActualBankHolding[] {
    const startedAt = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 2)
      .toISOString()
      .slice(0, 10);
    const maturedAgo = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365)
      .toISOString()
      .slice(0, 10);
    return [
      {
        label: "Co-op 12m FD",
        bankName: "Co-op",
        principal: 300_000,
        interestRate: 11,
        instrumentType: "fixed_deposit",
        tenorMonths: 12,
        startDate: startedAt,
        maturityDate: maturedAgo,
        payoutFrequency: "maturity",
        maturityAction: action,
        isActive: true,
      },
    ];
  }

  it("rollover keeps the deposit funded; redeploy drains it to the MMF", () => {
    const redeployMonths = runProjection(baseSettings(), [], [], seedDeposit, [], [], bankWith("redeploy"), 1);
    const rolloverMonths = runProjection(baseSettings(), [], [], seedDeposit, [], [], bankWith("rollover"), 1);

    const minBankRedeploy = Math.min(...redeployMonths.map((m) => m.bankEnd));
    const minBankRollover = Math.min(...rolloverMonths.map((m) => m.bankEnd));

    // Redeploy: the matured FD collapses toward zero at some elapsed month.
    expect(minBankRedeploy).toBeLessThan(300_000 * 0.5);
    // Rollover: the deposit renews in place, so the bank balance stays funded.
    expect(minBankRollover).toBeGreaterThan(300_000 * 0.5);
    // The two strategies must produce a materially different minimum bank balance.
    expect(minBankRollover).toBeGreaterThan(minBankRedeploy);
  });
});
