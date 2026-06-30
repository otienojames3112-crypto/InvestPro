import { describe, it, expect } from "vitest";
import {
  runProjection,
  getPhaseAllocation,
  type EngineSettings,
  type MonthResult,
} from "./engine";
import {
  tieredPhaseMix,
  buildStrategyPolicy,
  type EngineTier,
  type PhaseMix,
} from "../shared/strategyPolicy";
import { reconcilePlanPolicy } from "../shared/reconciliation";

/**
 * Plan-to-ledger contract: the committed allocation tier must be the single
 * operating policy the projection engine runs. These tests prove that changing
 * the committed tier demonstrably changes the projected PATH (asset mix and
 * end-state liquidity), that the balanced tier reproduces today's path exactly,
 * and that the reconciliation plan-policy check flags any divergence.
 */

const BASE: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 25000,
  stepUpAmount: 5000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
};

const PHASES = ["foundation", "growth", "de-risking", "final-liquidity"] as const;
const TIER_AXIS: EngineTier[] = [
  "capital_preservation",
  "conservative",
  "balanced",
  "growth",
  "aggressive",
];

function projectWithTier(tier: EngineTier): MonthResult[] {
  return runProjection({ ...BASE, strategyTier: tier });
}

/**
 * Peak long-bond (risky) KES held at any point in the horizon. The tier shapes
 * the ACCUMULATION path; by the goal date every tier deliberately unwinds long
 * bonds into cash (the liquidity guard), so terminal holdings converge — the
 * divergence is visible mid-horizon, at peak exposure.
 */
function peakLongBonds(months: MonthResult[]) {
  return Math.max(...months.map((m) => m.ifbEnd + m.fxdEnd));
}

/** Average liquid share (MMF + T-bills as a fraction of total) over the horizon. */
function avgLiquidShare(months: MonthResult[]) {
  const shares = months
    .filter((m) => m.totalEnd > 0)
    .map((m) => (m.mmfEnd + m.tbillEnd) / m.totalEnd);
  return shares.reduce((a, b) => a + b, 0) / shares.length;
}

function baseMix(phase: (typeof PHASES)[number]): PhaseMix {
  return getPhaseAllocation(phase);
}

describe("tieredPhaseMix — the pure tilt the engine consumes", () => {
  it("balanced is the identity (keeps every existing projection test valid)", () => {
    for (const phase of PHASES) {
      const base = baseMix(phase);
      expect(tieredPhaseMix(base, "balanced")).toEqual(base);
    }
  });

  it("capital_preservation never allocates to long bonds", () => {
    for (const phase of PHASES) {
      const mix = tieredPhaseMix(baseMix(phase), "capital_preservation");
      expect(mix.ifb + mix.fxd).toBeCloseTo(0, 6);
    }
  });

  it("long-bond weight is monotonic across the tier axis (growth phase)", () => {
    const base = baseMix("growth");
    const longByTier = TIER_AXIS.map((t) => {
      const m = tieredPhaseMix(base, t);
      return m.ifb + m.fxd;
    });
    for (let i = 1; i < longByTier.length; i++) {
      expect(longByTier[i]).toBeGreaterThanOrEqual(longByTier[i - 1] - 1e-9);
    }
    // Extremes must actually differ, not merely be non-decreasing.
    expect(longByTier[longByTier.length - 1]).toBeGreaterThan(longByTier[0]);
  });

  it("every tier mix is a valid distribution summing to 1", () => {
    for (const t of TIER_AXIS) {
      for (const phase of PHASES) {
        const m = tieredPhaseMix(baseMix(phase), t);
        expect(m.mmf + m.tbill + m.ifb + m.fxd).toBeCloseTo(1, 6);
        for (const v of [m.mmf, m.tbill, m.ifb, m.fxd]) {
          expect(v).toBeGreaterThanOrEqual(-1e-9);
        }
      }
    }
  });
});

describe("committed tier changes the projected ledger path", () => {
  it("Capital Preservation never builds long-bond exposure; Growth does", () => {
    const cpPeak = peakLongBonds(projectWithTier("capital_preservation"));
    const growthPeak = peakLongBonds(projectWithTier("growth"));
    expect(cpPeak).toBeLessThan(1); // effectively zero across the whole horizon
    expect(growthPeak).toBeGreaterThan(100_000); // genuine, material long-bond path
  });

  it("Capital Preservation stays more liquid than Aggressive over the horizon", () => {
    const cpShare = avgLiquidShare(projectWithTier("capital_preservation"));
    const aggShare = avgLiquidShare(projectWithTier("aggressive"));
    expect(cpShare).toBeGreaterThan(aggShare);
    expect(cpShare).toBeCloseTo(1, 1); // CP is essentially all cash/short
  });

  it("balanced projection is identical to no tier (back-compat guarantee)", () => {
    const noTier = runProjection({ ...BASE });
    const balanced = runProjection({ ...BASE, strategyTier: "balanced" });
    const lastNo = noTier[noTier.length - 1];
    const lastBal = balanced[balanced.length - 1];
    expect(lastBal.totalEnd).toBeCloseTo(lastNo.totalEnd, 6);
    expect(lastBal.ifbEnd).toBeCloseTo(lastNo.ifbEnd, 6);
    expect(lastBal.fxdEnd).toBeCloseTo(lastNo.fxdEnd, 6);
    expect(lastBal.mmfEnd).toBeCloseTo(lastNo.mmfEnd, 6);
    expect(lastBal.tbillEnd).toBeCloseTo(lastNo.tbillEnd, 6);
  });
});

describe("buildStrategyPolicy — the persisted operating policy", () => {
  it("derives a self-consistent policy that is monotonic in tier rank", () => {
    const policies = TIER_AXIS.map((tier) =>
      buildStrategyPolicy({ selectedTier: tier, committedAt: 1_700_000_000_000, source: "user_override" }),
    );
    policies.forEach((policy, i) => {
      expect(policy.selectedTier).toBe(TIER_AXIS[i]);
      expect(policy.source).toBe("user_override");
    });
    // Only capital preservation forbids long bonds.
    expect(policies[0].riskRules.allowLongBonds).toBe(false);
    for (let i = 1; i < policies.length; i++) {
      expect(policies[i].riskRules.allowLongBonds).toBe(true);
    }
    // Downside band widens with risk; cash buffer shrinks with risk.
    for (let i = 1; i < policies.length; i++) {
      expect(policies[i].riskRules.bandWidthMultiplier).toBeGreaterThan(
        policies[i - 1].riskRules.bandWidthMultiplier,
      );
      expect(policies[i].liquidityRules.safetyFloorMultiplier).toBeLessThanOrEqual(
        policies[i - 1].liquidityRules.safetyFloorMultiplier,
      );
    }
    // Balanced is the recentred middle.
    const balanced = policies[2];
    expect(balanced.riskRules.bandWidthMultiplier).toBeCloseTo(1, 6);
    expect(balanced.liquidityRules.safetyFloorMultiplier).toBeCloseTo(1, 6);
  });
});

describe("reconciliation plan-policy check — no split-model surfaces", () => {
  it("passes when the projection runs the committed tier", () => {
    expect(reconcilePlanPolicy({ committed: true, committedTier: "growth", policyTierUsed: "growth" }).ok).toBe(true);
  });

  it("fails when the ledger runs a different tier than the committed plan", () => {
    expect(reconcilePlanPolicy({ committed: true, committedTier: "growth", policyTierUsed: "balanced" }).ok).toBe(false);
  });

  it("is benign before commit (default path is legitimate, not a drift)", () => {
    const r = reconcilePlanPolicy({ committed: false, committedTier: null, policyTierUsed: "balanced" });
    expect(r.ok).toBe(true);
    expect(r.committedTier).toBe("balanced");
  });
});
