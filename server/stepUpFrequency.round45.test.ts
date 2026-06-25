import { describe, it, expect } from "vitest";
import {
  solveForStepUp,
  projectEndingValue,
  runProjection,
  type EngineSettings,
} from "./engine";

/**
 * Round 45 — step-up frequency awareness + projectEndingValue.
 *
 * The Create-Portfolio dialog now lets the user pick a step-up cadence
 * (every 3 / 6 / 12 months) and shows a live projected-vs-target delta. Both
 * features run on the same engine as everything else. These tests pin:
 *   1. The solver respects stepUpMonths — a more frequent cadence (every 3
 *      months) needs a smaller per-period step-up than a less frequent one
 *      (every 12 months) to hit the same target.
 *   2. projectEndingValue agrees with runProjection for the same inputs, so the
 *      dialog's delta is exact.
 *   3. The solver's reported projectedEndingValue matches projectEndingValue at
 *      the recommended step-up.
 */

const BASE: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 0,
  stepUpAmount: 0,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5_000_000,
  horizonMonths: 120,
  startDate: "2026-07-01",
};

describe("step-up frequency + projectEndingValue", () => {
  it("a more frequent cadence needs a smaller per-period step-up to reach target", () => {
    const month1 = 10_000;
    const every3 = solveForStepUp({ ...BASE, stepUpMonths: 3 }, month1);
    const every12 = solveForStepUp({ ...BASE, stepUpMonths: 12 }, month1);
    expect(every3.feasible).toBe(true);
    expect(every12.feasible).toBe(true);
    // Stepping up 4x as often should not require a larger per-period bump.
    expect(every3.recommendedStepUp).toBeLessThanOrEqual(every12.recommendedStepUp);
  });

  it("each cadence's recommendation actually reaches target when re-projected", () => {
    const month1 = 10_000;
    for (const sm of [3, 6, 12]) {
      const s: EngineSettings = { ...BASE, stepUpMonths: sm };
      const rec = solveForStepUp(s, month1).recommendedStepUp;
      const end = projectEndingValue(s, month1, rec);
      expect(end).toBeGreaterThanOrEqual(BASE.targetAmount);
    }
  });

  it("projectEndingValue agrees with runProjection for the same inputs", () => {
    const s: EngineSettings = { ...BASE, stepUpMonths: 6 };
    const month1 = 12_000;
    const stepUp = 4_000;
    const viaHelper = projectEndingValue(s, month1, stepUp);
    const results = runProjection(
      { ...s, startingContribution: month1, stepUpAmount: stepUp },
      [], [], [], [], []
    );
    const viaEngine = Math.round(results[results.length - 1]?.totalEnd ?? 0);
    expect(viaHelper).toBe(viaEngine);
  });

  it("solver's projectedEndingValue matches projectEndingValue at the recommended step-up", () => {
    const month1 = 9_000;
    const s: EngineSettings = { ...BASE, stepUpMonths: 6 };
    const res = solveForStepUp(s, month1);
    const viaHelper = projectEndingValue(s, month1, res.recommendedStepUp);
    expect(viaHelper).toBe(res.projectedEndingValue);
  });
});
