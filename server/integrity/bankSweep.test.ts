import { describe, it, expect } from "vitest";
import {
  decideBankSweep,
  bankSweepEligibility,
  scoreBankCandidate,
  netOfTax,
  KDIC_INSURED_CAP_KES,
  DEFAULT_BANK_RISK_PENALTY_PCT,
  type GovSweepOption,
  type BankSweepCandidate,
} from "../../shared/bankSweep";

const GOV: GovSweepOption[] = [
  { bucket: "ifb", label: "IFB 24m", netPct: 15.0 },
  { bucket: "tbill", label: "364-day T-bill", netPct: 12.0 },
  { bucket: "fxd", label: "FXD 24m", netPct: 11.0 },
];

function bank(overrides: Partial<BankSweepCandidate> = {}): BankSweepCandidate {
  return {
    id: 1,
    bankName: "Test Bank",
    label: null,
    instrumentType: "fixed_deposit",
    principal: 0,
    interestRate: 20,
    whtRate: 15,
    minimumBalance: 0,
    isActive: true,
    isMatured: false,
    ...overrides,
  };
}

describe("bankSweep — net-of-tax", () => {
  it("applies WHT", () => {
    expect(netOfTax(20, 15)).toBeCloseTo(17, 6);
    expect(netOfTax(10, 0)).toBeCloseTo(10, 6);
  });
});

describe("bankSweep — eligibility", () => {
  it("excludes inactive, matured, non-term, zero-rate, and below-minimum", () => {
    expect(bankSweepEligibility(bank({ isActive: false }), 50_000).eligible).toBe(false);
    expect(bankSweepEligibility(bank({ isMatured: true }), 50_000).eligible).toBe(false);
    expect(bankSweepEligibility(bank({ instrumentType: "ordinary_savings" }), 50_000).eligible).toBe(false);
    expect(bankSweepEligibility(bank({ interestRate: 0 }), 50_000).eligible).toBe(false);
    expect(bankSweepEligibility(bank({ minimumBalance: 1_000_000, principal: 0 }), 50_000).eligible).toBe(false);
  });
  it("admits an active fixed deposit clearing its minimum", () => {
    const e = bankSweepEligibility(bank({ minimumBalance: 50_000 }), 50_000);
    expect(e.eligible).toBe(true);
  });
});

describe("bankSweep — risk-adjusted scoring", () => {
  it("penalises the uninsured share harder", () => {
    const cfg = { bankRiskPenaltyPct: DEFAULT_BANK_RISK_PENALTY_PCT, insuredCapKes: KDIC_INSURED_CAP_KES };
    const smallInsured = scoreBankCandidate(bank({ principal: 0 }), 100_000, cfg);
    const largeUninsured = scoreBankCandidate(bank({ principal: 900_000 }), 100_000, cfg);
    expect(largeUninsured.uninsuredFraction).toBeGreaterThan(smallInsured.uninsuredFraction);
    expect(largeUninsured.riskPenaltyPct).toBeGreaterThan(smallInsured.riskPenaltyPct);
    expect(largeUninsured.riskAdjustedNetPct).toBeLessThan(smallInsured.riskAdjustedNetPct);
  });
});

describe("bankSweep — government-preference threshold", () => {
  it("prefers government when a bank only marginally beats it", () => {
    // Bank 16% net → 15.25% risk-adjusted (default 0.75 penalty, fully insured).
    // Best gov is 15% net; margin is 1pp, so bank does NOT clear it.
    const d = decideBankSweep(50_000, GOV, [bank({ interestRate: 16 / 0.85 })], {});
    expect(d.destination).toBe("government");
    expect(d.govBucket).toBe("ifb");
    expect(d.ledgerExplanation).toContain("Swept → Securities");
  });

  it("chooses the bank only when it clears the margin", () => {
    // Bank 20% gross → 17% net → 16.25% risk-adjusted (fully insured) vs 15% gov.
    const d = decideBankSweep(50_000, GOV, [bank({ interestRate: 20, principal: 0 })], {});
    expect(d.destination).toBe("bank");
    expect(d.bankId).toBe(1);
    expect(d.ledgerExplanation).toContain("fixed deposit");
  });

  it("falls back to government when there is no eligible bank", () => {
    const d = decideBankSweep(50_000, GOV, [bank({ isActive: false })], {});
    expect(d.destination).toBe("government");
    expect(d.ledgerExplanation).toContain("Swept → Securities");
  });

  it("returns none when there is no surplus", () => {
    const d = decideBankSweep(0, GOV, [bank()], {});
    expect(d.destination).toBe("none");
  });

  it("the uninsured penalty can tip a marginal deposit back to government", () => {
    // 20% gross → 17% net. Fully insured: 17 − 0.75 = 16.25% risk-adjusted, which
    // clears gov+margin (15% + 1pp = 16%) → bank. On top of a 5M principal it is
    // ~99% uninsured: penalty ≈ 0.75 + 1.5×0.99 ≈ 2.24pp → ~14.76% risk-adjusted,
    // below gov+margin → government. Same instrument, decision flipped by risk.
    const insured = decideBankSweep(
      50_000,
      GOV,
      [bank({ interestRate: 20, principal: 0 })],
      {},
    );
    expect(insured.destination).toBe("bank");

    const uninsured = decideBankSweep(
      50_000,
      GOV,
      [bank({ interestRate: 20, principal: 5_000_000 })],
      {},
    );
    expect(uninsured.destination).toBe("government");
    expect(uninsured.bestBank).not.toBeNull();
    expect(uninsured.bestBank!.uninsuredFraction).toBeGreaterThanOrEqual(0.9);
  });
});

describe("bankSweep — goal-horizon eligibility", () => {
  const gov: GovSweepOption[] = [{ bucket: "tbill", label: "T-bill", netPct: 11 }];
  it("rules out a fixed deposit that matures after the goal horizon", () => {
    const d = decideBankSweep(
      50_000,
      gov,
      [bank({ interestRate: 30, instrumentType: "fixed_deposit", monthsToMaturity: 24 })],
      { goalHorizonMonths: 12 },
    );
    expect(d.destination).toBe("government");
    expect(d.eligibility[0].eligible).toBe(false);
    expect(d.eligibility[0].reason).toContain("Matures after the goal");
  });
  it("admits a fixed deposit that matures before the goal", () => {
    const d = decideBankSweep(
      50_000,
      gov,
      [bank({ interestRate: 30, instrumentType: "fixed_deposit", monthsToMaturity: 6 })],
      { goalHorizonMonths: 12 },
    );
    expect(d.destination).toBe("bank");
  });
});

describe("bankSweep — concentration cap", () => {
  const gov: GovSweepOption[] = [{ bucket: "ifb", label: "IFB", netPct: 15 }];
  it("penalises an issuer that would breach the concentration cap", () => {
    // 20% gross → 17% net. With a tiny portfolio the sweep makes this issuer a
    // huge share, so the concentration penalty drags it below gov+margin.
    const concentrated = decideBankSweep(
      50_000,
      gov,
      [bank({ interestRate: 20, principal: 450_000 })],
      { portfolioValueKes: 500_000, issuerConcentrationCap: 0.2 },
    );
    // Same instrument in a large portfolio (low concentration) still wins.
    const diversified = decideBankSweep(
      50_000,
      gov,
      [bank({ interestRate: 20, principal: 0 })],
      { portfolioValueKes: 50_000_000, issuerConcentrationCap: 0.2 },
    );
    expect(concentrated.bestBank!.concentrationFraction).toBeGreaterThan(0.2);
    expect(concentrated.bestBank!.riskAdjustedNetPct).toBeLessThan(
      diversified.bestBank!.riskAdjustedNetPct,
    );
    expect(concentrated.destination).toBe("government");
    expect(diversified.destination).toBe("bank");
  });
});
