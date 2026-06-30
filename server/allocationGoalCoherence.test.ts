import { describe, it, expect } from "vitest";
import {
  glideGoalProbability,
  resolveBucketAssumptions,
  DEFAULT_GLIDE_PARAMS,
  DEFAULT_ALLOCATION_TEMPLATES,
  type AllocationTier,
} from "../shared/allocationModel";

/**
 * Regression for the Allocation-Plan "chance of reaching your goal" coherence fix.
 *
 * The bug: the page hardcoded goal = KES 5,000,000 and fed the probability model
 * ONLY the classified holdings (riskyValue), with no certain end value. For a goal
 * like the "Car" sample (target 1.2M, the plan projects ~1.43M) that produced a 1%
 * chance against 5M and a KES ~227k–242k range — completely detached from the plan.
 *
 * The fix feeds the model the REAL portfolio figures: goal = portfolio.targetAmount,
 * horizon = real months remaining, and the plan's own projected end value (from the
 * SAME projection engine the Dashboard uses) split into the price-volatile pot
 * (riskyValue) and the deterministic remainder (extraCertainEndValue =
 * projectedEndValue − riskyValue). These tests pin the resulting behavior.
 */

const assumptions = resolveBucketAssumptions();
const params = DEFAULT_GLIDE_PARAMS;
const templates = DEFAULT_ALLOCATION_TEMPLATES;

// The Car sample as the Dashboard sees it.
const CAR_GOAL = 1_200_000;
const CAR_PROJECTED_END = 1_430_000; // Dashboard "Projected ≈ KES 1.43M"
const CAR_HORIZON_MONTHS = 60;

function carProbability(tier: AllocationTier, riskyValue: number) {
  const extraCertainEndValue = Math.max(0, CAR_PROJECTED_END - riskyValue);
  return glideGoalProbability({
    tier,
    horizonMonths: CAR_HORIZON_MONTHS,
    goal: CAR_GOAL,
    riskyValue,
    extraCertainEndValue,
    assumptions,
    params,
    templates,
  });
}

describe("Allocation Plan goal coherence — Car sample (target 1.2M, plan ~1.43M)", () => {
  it("with the plan's projected end folded in, the chance of reaching 1.2M is HIGH", () => {
    // No classified holdings yet → the whole plan value is the (modeled) certain
    // remainder, exactly like a brand-new savings-led goal.
    const r = carProbability("balanced", 0);
    expect(r.goal).toBe(CAR_GOAL);
    // The plan overshoots the target by ~19%, so the odds must be high.
    expect(r.probability.probabilityPct).toBeGreaterThanOrEqual(90);
  });

  it("the likely range of outcomes brackets ~1.2M–1.5M, not ~227k–242k", () => {
    const r = carProbability("balanced", 0);
    // p50 sits at/above the projected end value (no risky pot to drag it down).
    expect(r.distribution.p50).toBeGreaterThanOrEqual(CAR_GOAL);
    expect(r.distribution.p50).toBeLessThanOrEqual(1_600_000);
    // The band is sane and well above the old broken ~242k ceiling.
    expect(r.distribution.p10).toBeGreaterThan(900_000);
    expect(r.distribution.p90).toBeLessThan(2_000_000);
    expect(r.distribution.p90).toBeGreaterThanOrEqual(r.distribution.p10);
  });

  it("the goal figure the page renders equals the portfolio target (1.2M), never 5M", () => {
    const r = carProbability("balanced", 0);
    expect(r.goal).toBe(1_200_000);
    expect(r.goal).not.toBe(5_000_000);
  });

  it("a real classified pot raises uncertainty (wider band) but the central odds stay high", () => {
    // Move 300k of the plan into the volatile risky bucket; the certain remainder
    // shrinks by the same amount, so the TOTAL still centers near 1.43M.
    const flat = carProbability("balanced", 0);
    const withRisky = carProbability("balanced", 300_000);
    const flatBand = flat.distribution.p90 - flat.distribution.p10;
    const riskyBand = withRisky.distribution.p90 - withRisky.distribution.p10;
    expect(riskyBand).toBeGreaterThan(flatBand); // price risk widens the cone
    expect(withRisky.probability.probabilityPct).toBeGreaterThanOrEqual(70);
  });
});

describe("the OLD hardcode (goal 5M, no certain value) was the broken state", () => {
  it("reproduces the ~1% / sub-250k symptom the fix removes", () => {
    const broken = glideGoalProbability({
      tier: "balanced",
      horizonMonths: CAR_HORIZON_MONTHS,
      goal: 5_000_000, // the hardcode
      riskyValue: 0, // no classified holdings
      extraCertainEndValue: 0, // the plan value was never folded in
      assumptions,
      params,
      templates,
    });
    expect(broken.probability.probabilityPct).toBeLessThanOrEqual(5);
    // With nothing to grow, the whole distribution collapses near zero.
    expect(broken.distribution.p90).toBeLessThan(250_000);
  });
});

describe("changing the target moves the probability monotonically", () => {
  it("a lower target than the plan's projected end is easier to reach than a higher one", () => {
    const easy = carProbability("balanced", 0); // goal 1.2M < projected 1.43M
    const hard = glideGoalProbability({
      tier: "balanced",
      horizonMonths: CAR_HORIZON_MONTHS,
      goal: 1_430_000 * 1.5, // a target well above what the plan reaches
      riskyValue: 0,
      extraCertainEndValue: CAR_PROJECTED_END,
      assumptions,
      params,
      templates,
    });
    expect(easy.probability.probabilityPct).toBeGreaterThan(
      hard.probability.probabilityPct,
    );
  });
});
