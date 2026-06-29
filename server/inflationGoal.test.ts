import { describe, it, expect } from "vitest";
import { computeInflationAdjustedGoal } from "../shared/decisionSurface";

// Part A1 — the inflated-goal math is the integrity core of the feature: it must
// never let a nominal surplus masquerade as real purchasing power. These tests
// pin the behaviour both when inflation-linking is OFF (back-compat / nominal)
// and ON (goal inflated to the goal date, surplus expressed in today's KES).

describe("computeInflationAdjustedGoal", () => {
  it("treats the goal as nominal when not linked (factor 1, no inflation)", () => {
    const r = computeInflationAdjustedGoal({
      target: 5_000_000,
      projectedNominal: 5_500_000,
      horizonMonths: 120,
      inflationRatePct: 6.68,
      linked: false,
    });
    expect(r.linked).toBe(false);
    expect(r.inflationFactor).toBe(1);
    // Goal at date equals today's goal; effective goal is the nominal target.
    expect(r.goalAtDate).toBe(5_000_000);
    expect(r.effectiveGoal).toBe(5_000_000);
    // Projected real == nominal when not linked.
    expect(r.projectedReal).toBe(5_500_000);
    expect(r.surplusNominal).toBe(500_000);
    expect(r.surplusReal).toBe(500_000);
  });

  it("inflates the goal to the goal date and discounts the projection when linked", () => {
    const inflationRatePct = 6.68;
    const horizonMonths = 120; // 10 years
    const target = 5_000_000;
    const projectedNominal = 8_000_000;
    const r = computeInflationAdjustedGoal({
      target,
      projectedNominal,
      horizonMonths,
      inflationRatePct,
      linked: true,
    });

    const years = horizonMonths / 12;
    const factor = Math.pow(1 + inflationRatePct / 100, years);
    expect(r.inflationFactor).toBeCloseTo(factor, 10);
    // Goal in future shillings is materially higher than the nominal target.
    expect(r.goalAtDate).toBe(Math.round(target * factor));
    expect(r.goalAtDate).toBeGreaterThan(target);
    expect(r.effectiveGoal).toBe(r.goalAtDate);
    // Projection discounted back to today's shillings.
    expect(r.projectedReal).toBe(Math.round(projectedNominal / factor));
    expect(r.projectedReal).toBeLessThan(projectedNominal);
    // Real surplus is in today's money, computed against the nominal target.
    expect(r.surplusReal).toBe(Math.round(projectedNominal / factor - target));
    // Nominal surplus uses the inflated goal — strictly smaller than a naive
    // (projectedNominal − target) would suggest, which is the whole point.
    expect(r.surplusNominal).toBe(Math.round(projectedNominal - target * factor));
    expect(r.surplusNominal).toBeLessThan(projectedNominal - target);
  });

  it("flips a nominal surplus into a real shortfall when inflation outruns it", () => {
    // 5.0M target, projection only 5.2M nominal over 10y at 6.68%: looks like a
    // +200k surplus nominally, but in real terms the plan falls short.
    const r = computeInflationAdjustedGoal({
      target: 5_000_000,
      projectedNominal: 5_200_000,
      horizonMonths: 120,
      inflationRatePct: 6.68,
      linked: true,
    });
    expect(r.surplusReal).toBeLessThan(0);
    expect(r.realCushionShare).toBeLessThan(0);
    // And the on-track test would see the projection below the inflated goal.
    expect(r.projectedNominal).toBeLessThan(r.effectiveGoal);
  });

  it("is robust to a zero rate (linked but no inflation = nominal behaviour)", () => {
    const r = computeInflationAdjustedGoal({
      target: 5_000_000,
      projectedNominal: 6_000_000,
      horizonMonths: 120,
      inflationRatePct: 0,
      linked: true,
    });
    expect(r.inflationFactor).toBe(1);
    expect(r.goalAtDate).toBe(5_000_000);
    expect(r.surplusReal).toBe(1_000_000);
  });

  it("handles a non-positive goal without dividing by zero", () => {
    const r = computeInflationAdjustedGoal({
      target: 0,
      projectedNominal: 1_000_000,
      horizonMonths: 60,
      inflationRatePct: 6.68,
      linked: true,
    });
    expect(r.goalToday).toBe(0);
    expect(r.realCushionShare).toBe(0);
    expect(Number.isFinite(r.surplusReal)).toBe(true);
  });
});
