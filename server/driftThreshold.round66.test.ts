import { describe, it, expect } from "vitest";
import { evaluateDriftThreshold } from "../shared/liquidAllocator";

describe("R66 — drift-threshold alert", () => {
  it("does not breach when no homes are reconciled (drift meaningless)", () => {
    const r = evaluateDriftThreshold({
      drifts: [500_000, -500_000],
      netWorth: 4_000_000,
      thresholdPct: 5,
      hasActuals: false,
    });
    expect(r.breached).toBe(false);
  });

  it("does not breach when total drift is within the threshold", () => {
    // Threshold 5% of 4M = 200k. Total drift 150k < 200k.
    const r = evaluateDriftThreshold({
      drifts: [100_000, -50_000],
      netWorth: 4_000_000,
      thresholdPct: 5,
      hasActuals: true,
    });
    expect(r.totalDrift).toBe(150_000);
    expect(r.thresholdValue).toBe(200_000);
    expect(r.breached).toBe(false);
  });

  it("breaches when total drift exceeds the threshold", () => {
    // Threshold 5% of 4M = 200k. Total drift 300k > 200k.
    const r = evaluateDriftThreshold({
      drifts: [200_000, -100_000],
      netWorth: 4_000_000,
      thresholdPct: 5,
      hasActuals: true,
    });
    expect(r.totalDrift).toBe(300_000);
    expect(r.thresholdValue).toBe(200_000);
    expect(r.breached).toBe(true);
  });

  it("sums absolute drifts across all homes", () => {
    const r = evaluateDriftThreshold({
      drifts: [120_000, -80_000, 40_000, -10_000],
      netWorth: 5_000_000,
      thresholdPct: 4,
      hasActuals: true,
    });
    // |120k|+|80k|+|40k|+|10k| = 250k. Threshold 4% of 5M = 200k → breach.
    expect(r.totalDrift).toBe(250_000);
    expect(r.thresholdValue).toBe(200_000);
    expect(r.breached).toBe(true);
  });

  it("never breaches when net worth is zero", () => {
    const r = evaluateDriftThreshold({
      drifts: [10_000],
      netWorth: 0,
      thresholdPct: 5,
      hasActuals: true,
    });
    expect(r.breached).toBe(false);
  });

  it("a tighter threshold makes a previously-safe drift breach", () => {
    const base = { drifts: [180_000], netWorth: 4_000_000, hasActuals: true };
    const safe = evaluateDriftThreshold({ ...base, thresholdPct: 5 }); // 200k
    const tight = evaluateDriftThreshold({ ...base, thresholdPct: 4 }); // 160k
    expect(safe.breached).toBe(false);
    expect(tight.breached).toBe(true);
  });
});
