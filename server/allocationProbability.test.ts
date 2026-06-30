/**
 * Allocation Model — Part 3 (the goal-probability feedback loop) test suite.
 *
 * Verifies the loop REUSES riskModel (no parallel engine), is honest about
 * uncertainty (floor/ceil clamp, caveat travels), and presents the three levers
 * as a neutral, quantified set — with the more-risk lever ALWAYS showing its
 * worsened downside. Also pins the two-sided, strictly-factual threshold
 * messaging and the editable-threshold validation.
 */
import { describe, it, expect } from "vitest";
import {
  resolveBucketAssumptions,
  glideEffectiveRisk,
  glideGoalProbability,
  computeLevers,
  probabilityInsight,
  validateProbabilityThresholds,
  DEFAULT_PROBABILITY_THRESHOLDS,
  RISK_ASSUMPTION_CAVEAT,
  BUCKET_RISK_CLASS,
  ALLOCATION_BUCKETS,
  ALLOCATION_TIERS,
  type BucketRiskAssumptions,
  type AllocationTier,
} from "../shared/allocationModel";
import { PROBABILITY_FLOOR, PROBABILITY_CEIL } from "../shared/riskModel";

const A: BucketRiskAssumptions = resolveBucketAssumptions();

/** A convenience base plan used across the suite. */
function plan(over?: Partial<Parameters<typeof glideGoalProbability>[0]>) {
  return {
    tier: "balanced" as AllocationTier,
    horizonMonths: 60,
    goal: 5_000_000,
    riskyValue: 4_500_000,
    extraCertainEndValue: 0,
    assumptions: A,
    ...over,
  };
}

describe("Part 3 — resolveBucketAssumptions reuses the sourced riskModel layer", () => {
  it("maps every bucket to its representative class and pulls non-hardcoded assumptions", () => {
    for (const b of ALLOCATION_BUCKETS) {
      expect(A[b]).toBeTruthy();
      expect(typeof A[b].expectedReturnPct).toBe("number");
      expect(typeof A[b].volatilityPct).toBe("number");
    }
    // cash is the safest bucket; equity/offshore carry materially more vol.
    expect(A.cash.volatilityPct).toBeLessThan(A.equity.volatilityPct);
    expect(A.cash.volatilityPct).toBeLessThan(A.offshore.volatilityPct);
    // gov maps to the volatile end of government (honest, not flattering).
    expect(BUCKET_RISK_CLASS.gov).toBe("gov_coupon");
  });

  it("threads per-bucket overrides through (sourced edits flow in)", () => {
    const bumped = resolveBucketAssumptions({ equity: { expectedReturnPct: 99 } });
    expect(bumped.equity.expectedReturnPct).toBe(99);
    // untouched buckets keep their resolved defaults
    expect(bumped.cash.expectedReturnPct).toBe(A.cash.expectedReturnPct);
  });
});

describe("Part 3 — effective risk is time-varying along the glide", () => {
  it("effective VOLATILITY is strictly monotonic in tier (more risk = wider cone)", () => {
    // In this model the resolved per-class EXPECTED RETURNS are similar but the
    // VOLATILITIES differ sharply, and every tier glides to the same cash anchor.
    // So climbing tiers buys SPREAD, not expected return — the honest story. We
    // therefore pin the robustly-monotonic quantity: effective vol.
    const vols = ALLOCATION_TIERS.map(
      (t) => glideEffectiveRisk({ tier: t, horizonMonths: 60, assumptions: A }).annualVolPct,
    );
    for (let i = 1; i < vols.length; i++) {
      expect(vols[i]).toBeGreaterThan(vols[i - 1]);
    }
  });

  it("the glide shape is horizon-invariant in fraction space → stable effective vol", () => {
    // Because the glide is defined over the time-remaining FRACTION, the
    // time-average is essentially horizon-independent; vol should not RISE with a
    // longer horizon (it stays flat or eases).
    const short = glideEffectiveRisk({ tier: "growth", horizonMonths: 24, assumptions: A });
    const long = glideEffectiveRisk({ tier: "growth", horizonMonths: 240, assumptions: A });
    expect(long.annualVolPct).toBeLessThanOrEqual(short.annualVolPct + 0.05);
  });
});

describe("Part 3 — probability is floor/ceil clamped (never 0% or 100%)", () => {
  it("a wildly overfunded plan caps at the ceiling, not 100%", () => {
    const r = glideGoalProbability(plan({ riskyValue: 50_000_000, goal: 1_000_000 }));
    expect(r.probability.probabilityPct).toBeLessThanOrEqual(PROBABILITY_CEIL * 100);
    expect(r.probability.probabilityPct).toBeLessThan(100);
  });

  it("a hopeless plan floors at the floor, not 0%", () => {
    const r = glideGoalProbability(plan({ riskyValue: 10_000, goal: 9_000_000 }));
    expect(r.probability.probabilityPct).toBeGreaterThanOrEqual(PROBABILITY_FLOOR * 100);
    expect(r.probability.probabilityPct).toBeGreaterThan(0);
  });

  it("every result carries the assumed-returns caveat", () => {
    expect(glideGoalProbability(plan()).caveat).toBe(RISK_ASSUMPTION_CAVEAT);
  });
});

describe("Part 3 — the three levers, quantified and neutral", () => {
  // Use an under-funded plan so all levers have room to move the number.
  const base = plan({ riskyValue: 3_600_000, goal: 5_000_000 });
  const basePct = glideGoalProbability(base).probability.probabilityPct;
  const levers = computeLevers(base);

  it("returns more-time, more-contribution and more-risk options", () => {
    const kinds = new Set(levers.map((l) => l.kind));
    expect(kinds.has("more_time")).toBe(true);
    expect(kinds.has("more_contribution")).toBe(true);
    expect(kinds.has("more_risk")).toBe(true);
  });

  it("more time raises the central probability monotonically with the step", () => {
    const t = levers.filter((l) => l.kind === "more_time");
    for (const l of t) expect(l.probabilityPct).toBeGreaterThan(basePct);
    // bigger step ⇒ at least as high
    for (let i = 1; i < t.length; i++) {
      expect(t[i].probabilityPct).toBeGreaterThanOrEqual(t[i - 1].probabilityPct);
    }
  });

  it("more contribution raises the central probability monotonically with the step", () => {
    const c = levers.filter((l) => l.kind === "more_contribution");
    for (const l of c) expect(l.probabilityPct).toBeGreaterThan(basePct);
    for (let i = 1; i < c.length; i++) {
      expect(c[i].probabilityPct).toBeGreaterThanOrEqual(c[i - 1].probabilityPct);
    }
  });

  it("the more-risk lever ALWAYS reports its worsened downside (lower p10)", () => {
    const risk = levers.find((l) => l.kind === "more_risk")!;
    expect(risk.downsideP10).toBeDefined();
    expect(risk.baselineP10).toBeDefined();
    // Moving up a tier widens the cone: the 10th-percentile end value falls.
    expect(risk.downsideP10!).toBeLessThan(risk.baselineP10!);
  });

  it("is a FLAT set — not pre-sorted by effect (no implicit ranking)", () => {
    // The set is emitted in a fixed structural order (time, contribution, risk),
    // NOT sorted by probability — assert it is not monotonically sorted by pct.
    const pcts = levers.map((l) => l.probabilityPct);
    const sorted = [...pcts].sort((a, b) => b - a);
    expect(pcts).not.toEqual(sorted);
  });

  it("the top tier has no more-risk lever (nothing to climb to)", () => {
    const top = computeLevers(plan({ tier: "aggressive" }));
    expect(top.some((l) => l.kind === "more_risk")).toBe(false);
  });
});

describe("Part 3 — two-sided threshold messaging is strictly factual", () => {
  it("LOW: an under-funded plan points to the levers and states the chance plainly", () => {
    const ins = probabilityInsight(plan({ riskyValue: 2_500_000, goal: 5_000_000 }));
    expect(ins.tone).toBe("low");
    expect(ins.message).toContain("levers");
    expect(ins.message).toContain(RISK_ASSUMPTION_CAVEAT);
    expect(ins.lowerTier).toBeNull();
  });

  it("COMFORTABLE: an over-funded plan names a VERIFIED safer tier that still clears high", () => {
    const opts = plan({ tier: "growth", riskyValue: 9_000_000, goal: 5_000_000 });
    const ins = probabilityInsight(opts);
    expect(ins.tone).toBe("comfortable");
    if (ins.lowerTier) {
      // The claim must be verified: recomputing the named tier clears highPct.
      const rr = glideGoalProbability({ ...opts, tier: ins.lowerTier });
      expect(rr.probability.probabilityPct).toBeGreaterThanOrEqual(
        DEFAULT_PROBABILITY_THRESHOLDS.highPct,
      );
      expect(ins.message).toContain("not a recommendation");
    }
  });

  it("editable thresholds change the tone for the same plan", () => {
    // Pick a plan whose probability sits strictly inside (1, 99) so thresholds
    // can straddle it from both sides. riskyValue 3.6M → ~92.7% at h60/goal5M.
    const opts = plan({ riskyValue: 3_600_000, goal: 5_000_000 });
    const pct = glideGoalProbability(opts).probability.probabilityPct;
    expect(pct).toBeGreaterThan(1);
    expect(pct).toBeLessThan(99);
    // Force LOW: set lowPct at/above pct (and a higher highPct above it).
    const lowCut = Math.min(98, Math.ceil(pct));
    const low = probabilityInsight({
      ...opts,
      thresholds: { highPct: Math.min(99, lowCut + 1), lowPct: lowCut },
    });
    expect(low.tone).toBe("low");
    // Force COMFORTABLE: drop highPct strictly below pct.
    const high = probabilityInsight({
      ...opts,
      thresholds: { highPct: Math.max(2, Math.floor(pct) - 1), lowPct: 1 },
    });
    expect(high.tone).toBe("comfortable");
  });
});

describe("Part 3 — editable threshold validation", () => {
  it("accepts the documented defaults", () => {
    expect(validateProbabilityThresholds(DEFAULT_PROBABILITY_THRESHOLDS).ok).toBe(true);
  });
  it("rejects out-of-range and non-ordered pairs", () => {
    expect(validateProbabilityThresholds({ highPct: 60, lowPct: 85 }).ok).toBe(false); // high <= low
    expect(validateProbabilityThresholds({ highPct: 100, lowPct: 50 }).ok).toBe(false); // >99
    expect(validateProbabilityThresholds({ highPct: 50, lowPct: 0 }).ok).toBe(false); // <1
    expect(validateProbabilityThresholds({ highPct: 70, lowPct: 70 }).ok).toBe(false); // equal
  });
});
