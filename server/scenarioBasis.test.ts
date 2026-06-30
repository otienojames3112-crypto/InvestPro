import { describe, it, expect } from "vitest";
import {
  runProjection,
  runScenarios,
  deriveStepUps,
  type EngineSettings,
  type ScenarioActualBasis,
  type ActualDeposit,
} from "./engine";

/**
 * Scenarios basis toggle — the engine must support two explicit bases:
 *  A. "From actual portfolio today": project forward from recorded actuals
 *     (deposits, overrides, securities). The scenario at the portfolio's OWN
 *     current step-up must reproduce the run()/Ledger ending value exactly.
 *  B. "Clean scheduled plan": ignore recorded actuals; project the schedule.
 *
 * These two bases must DIVERGE whenever actuals differ from the clean schedule.
 */

const BASE: EngineSettings = {
  mmfYield: 9.0,
  tbill91Rate: 8.8,
  tbill182Rate: 8.9,
  tbill364Rate: 9.1,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 20_000,
  stepUpAmount: 3_000,
  stepUpMonths: 6,
  safetyFloor: 50_000,
  targetAmount: 5_000_000,
  horizonMonths: 120,
  startDate: "2026-07-01",
};

function endOf(results: { totalEnd: number }[]): number {
  return results[results.length - 1]?.totalEnd ?? 0;
}

describe("Scenario basis — actual vs clean", () => {
  it("actual-basis scenario at the current step-up reproduces the run()/Ledger ending value exactly", () => {
    // A handful of real deposits that are AHEAD of the clean schedule.
    const actualDeposits: ActualDeposit[] = [
      { bucket: "mmf", amount: 200_000, depositDate: "2026-07-05" },
      { bucket: "mmf", amount: 200_000, depositDate: "2026-08-05" },
    ];
    const basis: ScenarioActualBasis = {
      overrides: [],
      actualDeposits,
      actualSecurities: [],
    };

    // The canonical Ledger/Dashboard baseline at the current step-up.
    const ledger = runProjection(
      { ...BASE, stepUpAmount: 3_000 },
      basis.overrides,
      [],
      basis.actualDeposits,
      basis.actualSecurities,
      [],
      [],
      null,
    );
    const ledgerEnd = endOf(ledger);

    // The actual-basis scenario grid, including the current step-up.
    const ladder = Array.from(new Set([...deriveStepUps(3_000), 3_000])).sort((a, b) => a - b);
    const scenarios = runScenarios({ ...BASE }, ladder, [], [], [], null, basis);
    const current = scenarios.find((s) => s.stepUp === 3_000)!;

    expect(current).toBeTruthy();
    // Exact agreement — same engine, same inputs, same step-up.
    expect(current.projectedEndingValue).toBe(ledgerEnd);
  });

  it("clean basis ignores recorded actuals, so it diverges from the actual basis when contributions are MISSED", () => {
    // Messy actuals: the first three months recorded ZERO contribution
    // (overrideAmount: 0) even though the schedule expected 20,000/month. The
    // clean schedule never sees these misses; the actual basis must reflect the
    // shortfall and therefore project a LOWER ending value.
    const basis: ScenarioActualBasis = {
      overrides: [
        { monthNumber: 1, overrideAmount: 0 },
        { monthNumber: 2, overrideAmount: 0 },
        { monthNumber: 3, overrideAmount: 0 },
      ],
      actualDeposits: [],
      actualSecurities: [],
    };

    const ladder = deriveStepUps(3_000);
    const cleanGrid = runScenarios({ ...BASE }, ladder, [], [], [], null, null);
    const actualGrid = runScenarios({ ...BASE }, ladder, [], [], [], null, basis);

    const clean = cleanGrid.find((s) => s.stepUp === 3_000)!;
    const actual = actualGrid.find((s) => s.stepUp === 3_000)!;

    // Missed real contributions → actual basis ends BELOW the clean schedule.
    expect(actual.projectedEndingValue).toBeLessThan(clean.projectedEndingValue);
  });

  it("default (no actual basis) is the clean scheduled plan", () => {
    const ladder = deriveStepUps(3_000);
    const a = runScenarios({ ...BASE }, ladder, [], [], [], null);
    const b = runScenarios({ ...BASE }, ladder, [], [], [], null, null);
    expect(a.map((s) => s.projectedEndingValue)).toEqual(b.map((s) => s.projectedEndingValue));
  });
});

describe("Dynamic step-up range — not fixed 0–5,000", () => {
  it("a +79,000 step-up plan produces a grid that includes 79,000 and nearby values", () => {
    const ladder = deriveStepUps(79_000);
    expect(ladder).toContain(79_000);
    // Spread around the current value, well beyond the old 0–5,000 grid.
    expect(Math.max(...ladder)).toBeGreaterThan(100_000);
    expect(ladder.some((v) => v > 5_000 && v < 79_000)).toBe(true);
    expect(ladder[0]).toBe(0); // always offers the no-step-up baseline
  });

  it("a small step-up still gets the fine-grained low-end grid including the current value", () => {
    const ladder = deriveStepUps(3_000);
    expect(ladder).toContain(3_000);
    expect(ladder).toContain(0);
    expect(Math.max(...ladder)).toBeLessThanOrEqual(5_000);
  });

  it("target is whatever the portfolio carries — 1.2M car plan vs 5M plan", () => {
    const car: EngineSettings = { ...BASE, targetAmount: 1_200_000, horizonMonths: 12, startingContribution: 90_000, stepUpAmount: 0 };
    const carGrid = runScenarios(car, deriveStepUps(0), [], [], [], null);
    // hitsTarget is computed against the portfolio's own target (1.2M), not a hardcoded 5M.
    for (const s of carGrid) {
      expect(s.hitsTarget).toBe(s.projectedEndingValue >= 1_200_000);
    }
    const big: EngineSettings = { ...BASE, targetAmount: 5_000_000 };
    const bigGrid = runScenarios(big, deriveStepUps(3_000), [], [], [], null);
    for (const s of bigGrid) {
      expect(s.hitsTarget).toBe(s.projectedEndingValue >= 5_000_000);
    }
  });
});
