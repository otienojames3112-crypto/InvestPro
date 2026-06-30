import { describe, it, expect } from "vitest";
import {
  tieredPhaseMix,
  buildStrategyPolicy,
  type PhaseMix,
} from "../shared/strategyPolicy";
import { ALLOCATION_TIERS } from "../shared/allocationModel";

/** A representative "growth phase" mix (the engine's default has all 4 families). */
const GROWTH_PHASE: PhaseMix = { mmf: 0.2, tbill: 0.2, ifb: 0.45, fxd: 0.15 };
/** A "foundation phase" mix (no long bonds yet). */
const FOUNDATION_PHASE: PhaseMix = { mmf: 0.5, tbill: 0.5, ifb: 0, fxd: 0 };

function sum(m: PhaseMix): number {
  return m.mmf + m.tbill + m.ifb + m.fxd;
}

describe("tieredPhaseMix", () => {
  it("balanced is the identity (preserves the engine's current behaviour exactly)", () => {
    expect(tieredPhaseMix(GROWTH_PHASE, "balanced")).toEqual(GROWTH_PHASE);
    expect(tieredPhaseMix(FOUNDATION_PHASE, "balanced")).toEqual(FOUNDATION_PHASE);
  });

  it("every tier produces a mix that sums to 1", () => {
    for (const tier of ALLOCATION_TIERS) {
      expect(sum(tieredPhaseMix(GROWTH_PHASE, tier))).toBeCloseTo(1, 6);
      expect(sum(tieredPhaseMix(FOUNDATION_PHASE, tier))).toBeCloseTo(1, 6);
    }
  });

  it("capital_preservation empties the long-bond families entirely", () => {
    const m = tieredPhaseMix(GROWTH_PHASE, "capital_preservation");
    expect(m.ifb).toBeCloseTo(0, 6);
    expect(m.fxd).toBeCloseTo(0, 6);
    // All weight is now cash/short.
    expect(m.mmf + m.tbill).toBeCloseTo(1, 6);
  });

  it("conservative reduces long-bond weight vs balanced but does not zero it", () => {
    const m = tieredPhaseMix(GROWTH_PHASE, "conservative");
    const long = m.ifb + m.fxd;
    const balancedLong = GROWTH_PHASE.ifb + GROWTH_PHASE.fxd;
    expect(long).toBeLessThan(balancedLong);
    expect(long).toBeGreaterThan(0);
  });

  it("growth and aggressive increase long-bond weight, monotonically in risk", () => {
    const balLong = GROWTH_PHASE.ifb + GROWTH_PHASE.fxd;
    const growthLong = (() => {
      const m = tieredPhaseMix(GROWTH_PHASE, "growth");
      return m.ifb + m.fxd;
    })();
    const aggrLong = (() => {
      const m = tieredPhaseMix(GROWTH_PHASE, "aggressive");
      return m.ifb + m.fxd;
    })();
    expect(growthLong).toBeGreaterThan(balLong);
    expect(aggrLong).toBeGreaterThan(growthLong);
  });

  it("riskier tiers convert T-bills before touching the MMF working balance", () => {
    // Growth taps T-bills first; MMF should not fall below half its base until
    // T-bills are exhausted.
    const g = tieredPhaseMix(GROWTH_PHASE, "growth");
    expect(g.tbill).toBeLessThan(GROWTH_PHASE.tbill);
    expect(g.mmf).toBeGreaterThanOrEqual(GROWTH_PHASE.mmf - 1e-9); // growth (tilt .5) does not dip MMF
  });

  it("long-bond tilt lands on a phase with no existing bonds (foundation) using the default split", () => {
    const m = tieredPhaseMix(FOUNDATION_PHASE, "aggressive");
    expect(m.ifb + m.fxd).toBeGreaterThan(0);
    // Default split favours IFB (0.6) over FXD (0.4).
    expect(m.ifb).toBeGreaterThan(m.fxd);
  });
});

describe("buildStrategyPolicy", () => {
  it("balanced policy uses the engine's historical defaults", () => {
    const p = buildStrategyPolicy({
      selectedTier: "balanced",
      committedAt: 123,
      source: "user_override",
    });
    expect(p.riskRules.bandWidthMultiplier).toBeCloseTo(1.0, 6);
    expect(p.riskRules.allowLongBonds).toBe(true);
    expect(p.liquidityRules.safetyFloorMultiplier).toBeCloseTo(1.0, 6);
    expect(p.concentrationRules.familyCapFrac).toBeCloseTo(0.6, 6);
    expect(p.committedAt).toBe(123);
    expect(p.source).toBe("user_override");
  });

  it("capital_preservation forbids long bonds, holds the most cash, narrowest band", () => {
    const p = buildStrategyPolicy({
      selectedTier: "capital_preservation",
      committedAt: null,
      source: "suggested",
    });
    expect(p.riskRules.allowLongBonds).toBe(false);
    expect(p.riskRules.bandWidthMultiplier).toBeLessThan(1);
    expect(p.liquidityRules.safetyFloorMultiplier).toBeGreaterThan(1);
    expect(p.liquidityRules.endStateLiquidTargetPct).toBe(100);
  });

  it("policy fields move monotonically with tier risk rank", () => {
    const bands = ALLOCATION_TIERS.map(
      (t) =>
        buildStrategyPolicy({ selectedTier: t, committedAt: null, source: "suggested" })
          .riskRules.bandWidthMultiplier,
    );
    const caps = ALLOCATION_TIERS.map(
      (t) =>
        buildStrategyPolicy({ selectedTier: t, committedAt: null, source: "suggested" })
          .concentrationRules.familyCapFrac,
    );
    const floors = ALLOCATION_TIERS.map(
      (t) =>
        buildStrategyPolicy({ selectedTier: t, committedAt: null, source: "suggested" })
          .liquidityRules.safetyFloorMultiplier,
    );
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i]).toBeGreaterThan(bands[i - 1]); // wider band as risk rises
      expect(caps[i]).toBeGreaterThan(caps[i - 1]); // higher concentration cap
      expect(floors[i]).toBeLessThan(floors[i - 1]); // thinner cash buffer
    }
  });
});
