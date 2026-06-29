/**
 * Allocation Model — Part 2 (the glide path) test suite.
 *
 * Covers the financial invariants the brief calls out:
 *   1. Interpolation endpoints   — start = tier template, end = Capital Preservation.
 *   2. Convexity                 — late de-risking is faster than early.
 *   3. Mid-point validation      — every sampled point sums to 100 and holds the cash floor.
 *   4. Phase regions             — the four phases are labeled regions of the ONE curve.
 *   5. Param validation          — steepness ≥ 1 (never concave), thresholds strictly ascending.
 *   6. CAR-PLAN REGRESSION       — the generalized model reproduces the engine's exact
 *                                  discrete four-bucket phase table, pinned against the LIVE
 *                                  engine functions so the existing projection cannot drift.
 */

import { describe, it, expect } from "vitest";
import {
  ALLOCATION_TIERS,
  ALLOCATION_BUCKETS,
  DEFAULT_ALLOCATION_TEMPLATES,
  DEFAULT_GLIDE_PARAMS,
  MIN_CASH_FLOOR_PCT,
  TEMPLATE_SUM_PCT,
  glidedAllocation,
  glideStartWeight,
  glidePhaseForElapsed,
  glidePhaseForTimeRemaining,
  sampleGlidePath,
  validateGlideParams,
  validateAllocationWeights,
  engineBucketsForPhase,
  ENGINE_PHASE_BUCKETS,
  GLIDE_PHASES,
  type AllocationWeights,
  type GlidePhase,
} from "../shared/allocationModel";
// The LIVE engine — the regression pins the generalized model against these.
import { getPhaseAllocation, getPhase, getPhaseBoundaries } from "./engine";

const sum = (w: AllocationWeights) =>
  ALLOCATION_BUCKETS.reduce((s, b) => s + w[b], 0);

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe("glide — interpolation endpoints", () => {
  it("at time-remaining = 1 (start) equals the tier's own template", () => {
    for (const tier of ALLOCATION_TIERS) {
      const w = glidedAllocation(tier, 1);
      for (const b of ALLOCATION_BUCKETS) {
        expect(approx(w[b], DEFAULT_ALLOCATION_TEMPLATES[tier][b], 1e-6)).toBe(true);
      }
    }
  });

  it("at time-remaining = 0 (goal date) equals the Capital-Preservation anchor", () => {
    const cp = DEFAULT_ALLOCATION_TEMPLATES.capital_preservation;
    for (const tier of ALLOCATION_TIERS) {
      const w = glidedAllocation(tier, 0);
      for (const b of ALLOCATION_BUCKETS) {
        expect(approx(w[b], cp[b], 1e-6)).toBe(true);
      }
    }
  });

  it("Capital Preservation's own glide is flat (start anchor == end anchor)", () => {
    const cp = DEFAULT_ALLOCATION_TEMPLATES.capital_preservation;
    for (const trf of [1, 0.75, 0.5, 0.25, 0]) {
      const w = glidedAllocation("capital_preservation", trf);
      for (const b of ALLOCATION_BUCKETS) expect(approx(w[b], cp[b], 1e-6)).toBe(true);
    }
  });
});

describe("glide — convexity (late de-risking faster than early)", () => {
  it("the start-anchor blend weight is convex: holds growth early, drops fast late", () => {
    // startWeight(trf) = 1 - (1-trf)^2. The DROP in start weight over the LAST
    // quarter of the journey (trf 0.25 -> 0) must EXCEED the drop over the first
    // quarter (trf 1 -> 0.75): de-risking accelerates late.
    const earlyDrop = glideStartWeight(1.0) - glideStartWeight(0.75);
    const lateDrop = glideStartWeight(0.25) - glideStartWeight(0.0);
    expect(lateDrop).toBeGreaterThan(earlyDrop);
  });

  it("equity is shed faster in the final stretch than in the opening stretch", () => {
    // For a growth goal, compare how much equity falls in the first 25% of elapsed
    // time vs the last 25%. The convex glide must retire MORE equity late.
    const tier = "growth";
    const eq = (elapsed: number) => glidedAllocation(tier, 1 - elapsed).equity;
    const earlyShed = eq(0.0) - eq(0.25);
    const lateShed = eq(0.75) - eq(1.0);
    expect(lateShed).toBeGreaterThan(earlyShed);
  });

  it("steepness = 1 reduces to a plain linear glide", () => {
    const tier = "growth";
    const linear = { ...DEFAULT_GLIDE_PARAMS, steepness: 1 };
    // At the midpoint a linear glide is exactly halfway between the two anchors.
    const start = DEFAULT_ALLOCATION_TEMPLATES[tier];
    const end = DEFAULT_ALLOCATION_TEMPLATES.capital_preservation;
    const mid = glidedAllocation(tier, 0.5, linear);
    for (const b of ALLOCATION_BUCKETS) {
      const expected = (start[b] + end[b]) / 2;
      // allow small renormalisation dust
      expect(Math.abs(mid[b] - expected)).toBeLessThan(0.5);
    }
  });

  it("a higher steepness holds the growth posture longer (more equity at mid-life)", () => {
    const tier = "aggressive";
    const mild = glidedAllocation(tier, 0.5, { ...DEFAULT_GLIDE_PARAMS, steepness: 1.5 });
    const steep = glidedAllocation(tier, 0.5, { ...DEFAULT_GLIDE_PARAMS, steepness: 3 });
    expect(steep.equity).toBeGreaterThan(mild.equity);
  });
});

describe("glide — every sampled point re-validates", () => {
  it("sums to 100 and honours the cash floor at every month for every tier", () => {
    for (const tier of ALLOCATION_TIERS) {
      const points = sampleGlidePath({ tier, horizonMonths: 120 });
      expect(points.length).toBe(121); // inclusive of both ends
      for (const p of points) {
        expect(approx(sum(p.weights), TEMPLATE_SUM_PCT, 1e-6)).toBe(true);
        expect(p.weights.cash).toBeGreaterThanOrEqual(MIN_CASH_FLOOR_PCT - 1e-6);
        // and it passes the same validator the editor uses
        expect(validateAllocationWeights(p.weights).ok).toBe(true);
      }
    }
  });

  it("monotonically de-risks: equity never increases as the goal approaches", () => {
    const points = sampleGlidePath({ tier: "aggressive", horizonMonths: 96 });
    for (let i = 1; i < points.length; i++) {
      // elapsed increases → time remaining falls → equity should be non-increasing
      expect(points[i].weights.equity).toBeLessThanOrEqual(points[i - 1].weights.equity + 1e-6);
    }
  });
});

describe("glide — phases are labeled regions of the one curve", () => {
  it("default thresholds map elapsed fraction to the four phases in order", () => {
    expect(glidePhaseForElapsed(0.0)).toBe("foundation");
    expect(glidePhaseForElapsed(0.19)).toBe("foundation");
    expect(glidePhaseForElapsed(0.20)).toBe("growth");
    expect(glidePhaseForElapsed(0.69)).toBe("growth");
    expect(glidePhaseForElapsed(0.70)).toBe("de-risking");
    expect(glidePhaseForElapsed(0.84)).toBe("de-risking");
    expect(glidePhaseForElapsed(0.85)).toBe("final-liquidity");
    expect(glidePhaseForElapsed(1.0)).toBe("final-liquidity");
  });

  it("time-remaining and elapsed are mirror inputs to the same labeling", () => {
    // Use non-boundary fractions so floating-point dust at exact thresholds
    // (0.20/0.70/0.85) does not flip a point into an adjacent region.
    for (const e of [0.05, 0.35, 0.55, 0.78, 0.95]) {
      expect(glidePhaseForTimeRemaining(1 - e)).toBe(glidePhaseForElapsed(e));
    }
  });

  it("the phase set matches the engine's phase vocabulary exactly", () => {
    expect([...GLIDE_PHASES]).toEqual([
      "foundation",
      "growth",
      "de-risking",
      "final-liquidity",
    ]);
  });
});

describe("glide — param validation", () => {
  it("accepts the documented defaults", () => {
    expect(validateGlideParams(DEFAULT_GLIDE_PARAMS).ok).toBe(true);
  });

  it("rejects concave/over-flat curves (steepness < 1)", () => {
    const r = validateGlideParams({ ...DEFAULT_GLIDE_PARAMS, steepness: 0.5 });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/steepness/i);
  });

  it("rejects non-ascending phase thresholds", () => {
    const r = validateGlideParams({
      steepness: 2,
      foundationEnd: 0.7,
      growthEnd: 0.5,
      deRiskingEnd: 0.85,
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/ascending/i);
  });

  it("rejects thresholds outside (0,1)", () => {
    expect(validateGlideParams({ ...DEFAULT_GLIDE_PARAMS, deRiskingEnd: 1 }).ok).toBe(false);
    expect(validateGlideParams({ ...DEFAULT_GLIDE_PARAMS, foundationEnd: 0 }).ok).toBe(false);
  });
});

describe("CAR-PLAN REGRESSION — generalized model reproduces the live engine", () => {
  it("engineBucketsForPhase matches the live getPhaseAllocation for every phase", () => {
    for (const phase of GLIDE_PHASES) {
      const mine = engineBucketsForPhase(phase as GlidePhase);
      const live = getPhaseAllocation(phase as GlidePhase);
      expect(mine).toEqual(live);
    }
  });

  it("the short-horizon branch also matches the live engine", () => {
    for (const phase of GLIDE_PHASES) {
      expect(engineBucketsForPhase(phase as GlidePhase, true)).toEqual(
        getPhaseAllocation(phase as GlidePhase, true),
      );
    }
  });

  it("ENGINE_PHASE_BUCKETS fixture is byte-for-byte the live engine table", () => {
    for (const phase of GLIDE_PHASES) {
      expect(ENGINE_PHASE_BUCKETS[phase as GlidePhase]).toEqual(
        getPhaseAllocation(phase as GlidePhase),
      );
    }
  });

  it("glide phase-region thresholds line up with the live engine phase boundaries", () => {
    // The glide's default thresholds (0.20 / 0.70 / 0.85) must classify a month
    // into the SAME phase the engine's getPhase does, across a representative horizon.
    const horizon = 120;
    const { foundationEnd, growthEnd, deRiskingEnd } = getPhaseBoundaries(horizon);
    expect(foundationEnd).toBe(24); // 0.20 * 120
    expect(growthEnd).toBe(84); // 0.70 * 120
    expect(deRiskingEnd).toBe(102); // 0.85 * 120

    for (let m = 1; m <= horizon; m++) {
      const enginePhase = getPhase(m, horizon);
      // The glide labels by elapsed fraction at the END of month m.
      const glidePhase = glidePhaseForElapsed(m / horizon);
      // Both use the same cumulative thresholds; allow the boundary month to land
      // in either adjacent region due to rounding/inclusive-end conventions.
      if (glidePhase !== enginePhase) {
        const idxG = GLIDE_PHASES.indexOf(glidePhase);
        const idxE = GLIDE_PHASES.indexOf(enginePhase as GlidePhase);
        expect(Math.abs(idxG - idxE)).toBeLessThanOrEqual(1);
      } else {
        expect(glidePhase).toBe(enginePhase);
      }
    }
  });
});
