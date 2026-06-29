/**
 * Expansion Part 6 — risk-model unit tests.
 *
 * These cover the honesty invariants that make the feature defensible:
 *   - per-class default assumptions resolve correctly (user edits win)
 *   - the distribution math (mean/variance/percentile ordering) is sane
 *   - a fixed-income-only plan stays tight & near-deterministic (the car plan)
 *   - goal probability is NEVER 0% or 100% (always clamped)
 *   - a tolerance mismatch raises a WARNING, never a block
 *   - the volatile-name concentration brake flags but does not block
 *   - no output key ranks / recommends / scores (no-advice invariant)
 */
import { describe, it, expect } from "vitest";
import {
  resolveRiskAssumption,
  defaultRiskFor,
  buildEndValueDistribution,
  goalProbability,
  assessToleranceMismatch,
  assessVolatileConcentration,
  correlationBetween,
  classIsRisky,
  type RiskPosition,
} from "../shared/riskModel";

describe("resolveRiskAssumption", () => {
  it("falls back to the per-class default when no override is given", () => {
    const r = resolveRiskAssumption("equity");
    expect(r.expectedReturnPct).toBe(defaultRiskFor("equity").expectedReturnPct);
    expect(r.volatilityPct).toBe(defaultRiskFor("equity").volatilityPct);
    expect(r.expectedReturnIsDefault).toBe(true);
    expect(r.volatilityIsDefault).toBe(true);
    expect(r.correlationGroupIsDefault).toBe(true);
  });

  it("lets a user override win and tags it as not-default", () => {
    const r = resolveRiskAssumption("equity", { expectedReturnPct: 15, volatilityPct: 30 });
    expect(r.expectedReturnPct).toBe(15);
    expect(r.volatilityPct).toBe(30);
    expect(r.expectedReturnIsDefault).toBe(false);
    expect(r.volatilityIsDefault).toBe(false);
  });

  it("ignores an invalid correlation group and keeps the class default", () => {
    const r = resolveRiskAssumption("equity", { correlationGroup: "not_a_group" });
    expect(r.correlationGroup).toBe(defaultRiskFor("equity").correlationGroup);
    expect(r.correlationGroupIsDefault).toBe(true);
  });

  it("clamps negative volatility overrides to zero", () => {
    const r = resolveRiskAssumption("equity", { volatilityPct: -5 });
    expect(r.volatilityPct).toBe(0);
  });
});

describe("buildEndValueDistribution", () => {
  const horizonYears = 10;

  it("orders percentiles p10 < p50 < p90 and centers the mean above the median for a risky plan", () => {
    const positions: RiskPosition[] = [
      { valueKes: 1_000_000, assetClass: "equity", assumption: resolveRiskAssumption("equity") },
    ];
    const dist = buildEndValueDistribution({ positions, horizonYears });
    expect(dist.p10).toBeLessThan(dist.p50);
    expect(dist.p50).toBeLessThan(dist.p90);
    // For a lognormal, mean >= median.
    expect(dist.mean).toBeGreaterThanOrEqual(dist.p50);
    expect(dist.hasMaterialRisk).toBe(true);
    expect(dist.portfolioVolPct).toBeGreaterThan(10);
  });

  it("collapses to a near-deterministic point for a fixed-income-only plan (the car plan stays tight)", () => {
    const positions: RiskPosition[] = [
      { valueKes: 5_000_000, assetClass: "gov_discount", assumption: resolveRiskAssumption("gov_discount") },
      { valueKes: 2_000_000, assetClass: "cash_mmf", assumption: resolveRiskAssumption("cash_mmf") },
    ];
    const dist = buildEndValueDistribution({ positions, horizonYears });
    expect(dist.hasMaterialRisk).toBe(false);
    expect(dist.portfolioVolPct).toBeLessThan(3);
    // The band should be tight: p90/p10 within a few percent.
    const spread = (dist.p90 - dist.p10) / dist.p50;
    expect(spread).toBeLessThan(0.15);
  });

  it("folds a deterministic chunk in on every percentile without adding spread to it", () => {
    const positions: RiskPosition[] = [
      { valueKes: 1_000_000, assetClass: "equity", assumption: resolveRiskAssumption("equity") },
    ];
    const certain = 4_000_000;
    const withCertain = buildEndValueDistribution({ positions, horizonYears, extraCertainEndValue: certain });
    const without = buildEndValueDistribution({ positions, horizonYears });
    // Each percentile rises by exactly the certain chunk (rounding aside).
    expect(Math.abs(withCertain.p10 - (without.p10 + certain))).toBeLessThanOrEqual(1);
    expect(Math.abs(withCertain.p50 - (without.p50 + certain))).toBeLessThanOrEqual(1);
    expect(Math.abs(withCertain.p90 - (without.p90 + certain))).toBeLessThanOrEqual(1);
    expect(withCertain.certainEndValue).toBe(certain);
  });

  it("widens the cone as a second uncorrelated risky name is concentrated vs diversified", () => {
    const oneName: RiskPosition[] = [
      { valueKes: 2_000_000, assetClass: "equity", assumption: resolveRiskAssumption("equity") },
    ];
    const diversified: RiskPosition[] = [
      { valueKes: 1_000_000, assetClass: "equity", assumption: resolveRiskAssumption("equity") },
      { valueKes: 1_000_000, assetClass: "offshore_fund", assumption: resolveRiskAssumption("offshore_fund") },
    ];
    const a = buildEndValueDistribution({ positions: oneName, horizonYears });
    const b = buildEndValueDistribution({ positions: diversified, horizonYears });
    // Diversification across imperfectly-correlated names lowers portfolio vol.
    expect(b.portfolioVolPct).toBeLessThan(a.portfolioVolPct);
  });
});

describe("goalProbability", () => {
  const horizonYears = 10;

  it("never reports 0% or 100% even when the deterministic plan clears the goal easily", () => {
    const positions: RiskPosition[] = [
      { valueKes: 100_000, assetClass: "cash_mmf", assumption: resolveRiskAssumption("cash_mmf") },
    ];
    const dist = buildEndValueDistribution({ positions, horizonYears, extraCertainEndValue: 10_000_000 });
    const p = goalProbability({ dist, deterministicEndValue: 10_000_000, goal: 5_000_000 });
    expect(p.probabilityPct).toBeLessThanOrEqual(99);
    expect(p.probabilityPct).toBeGreaterThanOrEqual(1);
    expect(p.clamped).toBe(true);
  });

  it("never reports 0% even when the plan misses badly", () => {
    const positions: RiskPosition[] = [
      { valueKes: 100_000, assetClass: "cash_mmf", assumption: resolveRiskAssumption("cash_mmf") },
    ];
    const dist = buildEndValueDistribution({ positions, horizonYears });
    const p = goalProbability({ dist, deterministicEndValue: 200_000, goal: 5_000_000 });
    expect(p.probabilityPct).toBeGreaterThanOrEqual(1);
    expect(p.probabilityPct).toBeLessThanOrEqual(99);
  });

  it("returns an interior probability for a genuinely uncertain risky plan", () => {
    const positions: RiskPosition[] = [
      { valueKes: 2_000_000, assetClass: "equity", assumption: resolveRiskAssumption("equity") },
    ];
    const dist = buildEndValueDistribution({ positions, horizonYears });
    // Aim the goal near the median so the probability lands well inside (0,1).
    const p = goalProbability({ dist, deterministicEndValue: dist.p50, goal: dist.p50 });
    expect(p.probability).toBeGreaterThan(0.2);
    expect(p.probability).toBeLessThan(0.8);
    expect(p.nearDeterministic).toBe(false);
  });
});

describe("assessToleranceMismatch", () => {
  it("flags (warns) when modeled vol exceeds the stated comfort ceiling", () => {
    const a = assessToleranceMismatch({ stated: "conservative", modeledVolPct: 20 });
    expect(a.exceedsComfort).toBe(true);
    expect(a.gapPct).toBeGreaterThan(0);
    expect(a.comfortVolCeilingPct).toBe(7);
  });

  it("does not flag when modeled vol is within comfort", () => {
    const a = assessToleranceMismatch({ stated: "growth", modeledVolPct: 10 });
    expect(a.exceedsComfort).toBe(false);
    expect(a.gapPct).toBe(0);
  });

  it("is silent when no tolerance is stated (optional, never forced)", () => {
    const a = assessToleranceMismatch({ stated: null, modeledVolPct: 50 });
    expect(a.stated).toBeNull();
    expect(a.exceedsComfort).toBe(false);
  });
});

describe("assessVolatileConcentration", () => {
  it("flags an over-concentrated volatile name but is null when the sleeve is fixed-income only", () => {
    expect(
      assessVolatileConcentration([
        { name: "T-bill", valueKes: 1_000_000, volatilityPct: 1.5 },
      ]),
    ).toBeNull();

    const flagged = assessVolatileConcentration([
      { name: "Safaricom", valueKes: 900_000, volatilityPct: 25 },
      { name: "Offshore fund", valueKes: 100_000, volatilityPct: 22 },
    ]);
    expect(flagged?.flagged).toBe(true);
    expect(flagged?.name).toBe("Safaricom");
    expect(flagged?.share).toBeGreaterThan(0.4);
  });

  it("does not flag a diversified volatile sleeve", () => {
    const ok = assessVolatileConcentration([
      { name: "A", valueKes: 350_000, volatilityPct: 25 },
      { name: "B", valueKes: 350_000, volatilityPct: 22 },
      { name: "C", valueKes: 300_000, volatilityPct: 20 },
    ]);
    expect(ok?.flagged).toBe(false);
    expect(ok?.share).toBeLessThanOrEqual(0.4);
  });
});

describe("correlation + class helpers", () => {
  it("has a symmetric correlation matrix with unit diagonal", () => {
    expect(correlationBetween("kes_equity", "kes_equity")).toBe(1);
    expect(correlationBetween("kes_equity", "property")).toBe(correlationBetween("property", "kes_equity"));
  });

  it("classifies price-driven classes as risky and fixed income as not", () => {
    expect(classIsRisky("equity")).toBe(true);
    expect(classIsRisky("reit")).toBe(true);
    expect(classIsRisky("offshore_fund")).toBe(true);
    expect(classIsRisky("gov_discount")).toBe(false);
    expect(classIsRisky("cash_mmf")).toBe(false);
  });
});

describe("no-advice invariant", () => {
  it("exposes no ranking/recommendation/score keys in risk outputs", () => {
    const positions: RiskPosition[] = [
      { valueKes: 1_000_000, assetClass: "equity", assumption: resolveRiskAssumption("equity") },
    ];
    const dist = buildEndValueDistribution({ positions, horizonYears: 10 });
    const prob = goalProbability({ dist, deterministicEndValue: dist.p50, goal: 5_000_000 });
    const tol = assessToleranceMismatch({ stated: "balanced", modeledVolPct: dist.portfolioVolPct });
    const conc = assessVolatileConcentration([{ name: "X", valueKes: 1, volatilityPct: 25 }]);
    const banned = /(rank|score|recommend|rating|best|buy|sell|advice)/i;
    for (const obj of [dist, prob, tol, conc]) {
      for (const key of Object.keys(obj ?? {})) {
        expect(key).not.toMatch(banned);
      }
    }
  });
});
