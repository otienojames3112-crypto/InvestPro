import { describe, it, expect } from "vitest";
import {
  solveForStepUp,
  runProjection,
  runScenarios,
  deriveStepUps,
  STEPUP_ROUNDING,
  SOLVER_MAX_STEPUP,
  type EngineSettings,
} from "./engine";

/**
 * Round 44 — forward step-up solver used by the Create-Portfolio dialog.
 *
 * The critical invariant: the recommendation must be produced by the SAME
 * engine the Scenarios page uses, so a portfolio created with the recommended
 * step-up actually reaches its target when re-projected. These tests feed the
 * recommendation back through runProjection / runScenarios and assert agreement.
 */

const BASE: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 0, // ignored by the solver
  stepUpAmount: 0, // ignored by the solver
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5_000_000,
  horizonMonths: 120,
  startDate: "2026-07-01",
};

function endValue(s: EngineSettings, startingContribution: number, stepUpAmount: number): number {
  const results = runProjection(
    { ...s, startingContribution, stepUpAmount },
    [],
    [],
    [],
    [],
    []
  );
  return results[results.length - 1]?.totalEnd ?? 0;
}

describe("solveForStepUp — forward step-up recommendation", () => {
  it("recommends a step-up whose re-projected value reaches the target", () => {
    const month1 = 10_000;
    const res = solveForStepUp(BASE, month1);
    expect(res.feasible).toBe(true);
    expect(res.recommendedStepUp).toBeGreaterThan(0);
    // Feeding the recommendation back through the engine must clear target.
    const reprojected = endValue(BASE, month1, res.recommendedStepUp);
    expect(reprojected).toBeGreaterThanOrEqual(BASE.targetAmount);
    expect(res.projectedEndingValue).toBeGreaterThanOrEqual(BASE.targetAmount);
  });

  it("rounds the recommendation up to a clean STEPUP_ROUNDING increment", () => {
    const res = solveForStepUp(BASE, 10_000);
    expect(res.recommendedStepUp % STEPUP_ROUNDING).toBe(0);
  });

  it("is the MINIMAL clean step-up — one increment lower misses the target", () => {
    const month1 = 10_000;
    const res = solveForStepUp(BASE, month1);
    expect(res.feasible).toBe(true);
    if (res.recommendedStepUp >= STEPUP_ROUNDING) {
      const oneLower = res.recommendedStepUp - STEPUP_ROUNDING;
      const lowerEnd = endValue(BASE, month1, oneLower);
      expect(lowerEnd).toBeLessThan(BASE.targetAmount);
    }
  });

  it("recommends 0 when the Month-1 contribution already reaches target with no step-up", () => {
    // A very large Month-1 contribution clears 5M with flat contributions.
    const res = solveForStepUp(BASE, 60_000);
    expect(res.feasible).toBe(true);
    expect(res.alreadyHitsAtZero).toBe(true);
    expect(res.recommendedStepUp).toBe(0);
    const flatEnd = endValue(BASE, 60_000, 0);
    expect(flatEnd).toBeGreaterThanOrEqual(BASE.targetAmount);
  });

  it("reports infeasible when even the cap step-up cannot reach target on a short horizon", () => {
    const tight: EngineSettings = { ...BASE, horizonMonths: 12, targetAmount: 50_000_000 };
    const res = solveForStepUp(tight, 100);
    expect(res.feasible).toBe(false);
    expect(res.recommendedStepUp).toBe(SOLVER_MAX_STEPUP);
    expect(res.shortfall).toBeGreaterThan(0);
  });

  it("agrees with the Scenarios engine: a scenario at the recommended step-up hits target", () => {
    const month1 = 10_000;
    const rec = solveForStepUp(BASE, month1).recommendedStepUp;
    // Build a scenario ladder that includes the recommended step-up and run it
    // through the exact runScenarios path the Scenarios page uses.
    const settingsWithStart: EngineSettings = { ...BASE, startingContribution: month1 };
    const ladder = Array.from(new Set([...deriveStepUps(rec), rec])).sort((a, b) => a - b);
    const scenarios = runScenarios(settingsWithStart, ladder, [], [], [], null);
    const match = scenarios.find((s) => s.stepUp === rec);
    expect(match).toBeDefined();
    expect(match!.hitsTarget).toBe(true);
  });

  it("a higher Month-1 contribution needs a smaller (or equal) recommended step-up", () => {
    const low = solveForStepUp(BASE, 5_000).recommendedStepUp;
    const high = solveForStepUp(BASE, 15_000).recommendedStepUp;
    expect(high).toBeLessThanOrEqual(low);
  });
});
