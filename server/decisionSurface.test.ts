import { describe, it, expect } from "vitest";
import {
  buildProjectionRange,
  assessPace,
  assessBackloading,
  assessLiquidityCushion,
  BACKLOAD_THRESHOLD,
} from "../shared/decisionSurface";

describe("buildProjectionRange", () => {
  it("orders low <= base <= high from the three modelled cases", () => {
    const r = buildProjectionRange(5_000_000, 4_200_000, 3_800_000);
    expect(r.low).toBe(3_800_000);
    expect(r.high).toBe(5_000_000);
    expect(r.base).toBe(5_000_000);
    expect(r.low).toBeLessThanOrEqual(r.base);
    expect(r.high).toBeGreaterThanOrEqual(r.base);
  });

  it("always contains the base even if a downside case is unexpectedly higher", () => {
    // pathological: a 'low' case computed higher than base must not push base out of band
    const r = buildProjectionRange(5_000_000, 5_400_000, 4_900_000);
    expect(r.low).toBeLessThanOrEqual(r.base);
    expect(r.high).toBeGreaterThanOrEqual(r.base);
    expect(r.high).toBe(5_400_000);
    expect(r.low).toBe(4_900_000);
  });

  it("collapses to a point when all cases agree", () => {
    const r = buildProjectionRange(5_000_000, 5_000_000, 5_000_000);
    expect(r.low).toBe(5_000_000);
    expect(r.high).toBe(5_000_000);
  });
});

describe("assessPace", () => {
  it("flags behind with the correct shortfall when base < target", () => {
    const p = assessPace(4_500_000, 5_000_000);
    expect(p.status).toBe("behind");
    expect(p.shortfall).toBe(500_000);
    expect(p.surplusOrShortfall).toBe(-500_000);
  });

  it("flags ahead with a surplus when base > target beyond tolerance", () => {
    const p = assessPace(5_300_000, 5_000_000, 50_000);
    expect(p.status).toBe("ahead");
    expect(p.surplusOrShortfall).toBe(300_000);
    expect(p.shortfall).toBe(0);
  });

  it("reports on_pace inside the tolerance band", () => {
    const p = assessPace(5_020_000, 5_000_000, 50_000); // within +/-50k
    expect(p.status).toBe("on_pace");
    expect(p.shortfall).toBe(0);
  });
});

describe("assessBackloading", () => {
  it("computes the final-window share and fires above the threshold", () => {
    // 12 months: 9 small + 3 large so the last quarter dominates.
    const months = [
      10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000, 10_000,
      300_000, 300_000, 300_000,
    ];
    const b = assessBackloading(months, 3);
    expect(b.finalWindowTotal).toBe(900_000);
    expect(b.allTotal).toBe(990_000);
    expect(b.share).toBeCloseTo(900_000 / 990_000, 5);
    expect(b.share).toBeGreaterThan(BACKLOAD_THRESHOLD);
    expect(b.isBackloaded).toBe(true);
    expect(b.finalWindowMonthly).toBe(300_000);
  });

  it("does not fire for an even contribution schedule", () => {
    const months = Array.from({ length: 12 }, () => 20_000);
    const b = assessBackloading(months, 3);
    expect(b.share).toBeCloseTo(3 / 12, 5);
    expect(b.isBackloaded).toBe(false);
  });

  it("handles empty / zero contribution series safely", () => {
    expect(assessBackloading([], 3).share).toBe(0);
    expect(assessBackloading([0, 0, 0], 3).isBackloaded).toBe(false);
  });
});

describe("assessLiquidityCushion", () => {
  const goalMs = Date.UTC(2036, 5, 1);
  const day = 86_400_000;

  it("reports a comfortable cushion when the last maturity is well before the goal", () => {
    const c = assessLiquidityCushion(4_800_000, 5_000_000, goalMs, goalMs - 120 * day);
    expect(c.cushionDays).toBe(120);
    expect(c.maturesNearOrAfterGoal).toBe(false);
    expect(c.liquidShare).toBeCloseTo(0.96, 5);
  });

  it("warns when a maturity lands within the warn window", () => {
    const c = assessLiquidityCushion(4_800_000, 5_000_000, goalMs, goalMs - 30 * day);
    expect(c.cushionDays).toBe(30);
    expect(c.maturesNearOrAfterGoal).toBe(true);
  });

  it("warns (negative cushion) when a maturity falls after the goal", () => {
    const c = assessLiquidityCushion(4_800_000, 5_000_000, goalMs, goalMs + 20 * day);
    expect(c.cushionDays).toBe(-20);
    expect(c.maturesNearOrAfterGoal).toBe(true);
  });

  it("reports no cushion constraint when nothing is locked", () => {
    const c = assessLiquidityCushion(5_000_000, 5_000_000, goalMs, null);
    expect(c.cushionDays).toBeNull();
    expect(c.maturesNearOrAfterGoal).toBe(false);
    expect(c.liquidShare).toBe(1);
  });
});
