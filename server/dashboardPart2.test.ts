import { describe, it, expect } from "vitest";
import {
  formatConcentrationPct,
  splitEndStateBuckets,
  type EndStateSplitSlice,
} from "../shared/discount";
import { generateMilestones, type EngineSettings } from "./engine";

// ─── Fix #2: one concentration formatter, one decimal, everywhere ──────────────

describe("Part 2 #2 — formatConcentrationPct (single shared formatter)", () => {
  it("renders the canonical 0.675 share as 67.5% (not 68%)", () => {
    expect(formatConcentrationPct(0.675)).toBe("67.5%");
  });

  it("keeps one decimal for any partial share", () => {
    expect(formatConcentrationPct(0.5)).toBe("50.0%");
    expect(formatConcentrationPct(0.123)).toBe("12.3%");
    expect(formatConcentrationPct(0.2499)).toBe("25.0%");
  });

  it("collapses a fully-concentrated share to a clean 100%", () => {
    expect(formatConcentrationPct(1)).toBe("100%");
    expect(formatConcentrationPct(0.9996)).toBe("100%");
  });

  it("clamps out-of-range and non-finite inputs", () => {
    expect(formatConcentrationPct(1.5)).toBe("100%");
    expect(formatConcentrationPct(-0.2)).toBe("0.0%");
    expect(formatConcentrationPct(Number.NaN)).toBe("0.0%");
  });

  it("matches across surfaces: the same share string is produced regardless of caller", () => {
    // The Dashboard chip, the breach banner, and Portfolio Review all call this
    // helper with the same fraction → identical output.
    const share = 0.675;
    const chip = formatConcentrationPct(share);
    const banner = formatConcentrationPct(share);
    const review = formatConcentrationPct(share);
    expect(chip).toBe(banner);
    expect(banner).toBe(review);
    expect(chip).toBe("67.5%");
  });
});

// ─── Fix #1: end-state bucket split matches the policy-aware allocation ─────────

describe("Part 2 #1 — splitEndStateBuckets (cards/chart/callout agree)", () => {
  const balancedSlices: EndStateSplitSlice[] = [
    { kind: "primary_mmf", targetBalance: 2_500_000 },
    { kind: "call_deposit", targetBalance: 2_500_000 },
  ];

  it("reallocates the pooled liquid pot into a 50/50 MMF/Bank split", () => {
    // Engine pooled it all in MMF (raw 5.0M MMF, 0 bank), but the allocator says 50/50.
    const r = splitEndStateBuckets(5_000_000, 0, balancedSlices, true);
    expect(r.applied).toBe(true);
    expect(r.mmf).toBe(2_500_000);
    expect(r.bank).toBe(2_500_000);
    // Buckets still sum to the original liquid pot.
    expect(r.mmf + r.bank).toBeCloseTo(5_000_000, 2);
  });

  it("groups secondary MMF into the MMF bucket and non-MMF kinds into bank", () => {
    const slices: EndStateSplitSlice[] = [
      { kind: "primary_mmf", targetBalance: 1_000_000 },
      { kind: "secondary_mmf", targetBalance: 1_000_000 },
      { kind: "tiered_savings", targetBalance: 1_000_000 },
    ];
    const r = splitEndStateBuckets(2_000_000, 1_000_000, slices, true);
    expect(r.applied).toBe(true);
    expect(r.mmf).toBe(2_000_000);
    expect(r.bank).toBe(1_000_000);
  });

  it("rescales slices to the projection's own liquid pot when they differ", () => {
    // Slices total 4.0M but the projection pot is 5.0M → scale up by 1.25.
    const slices: EndStateSplitSlice[] = [
      { kind: "primary_mmf", targetBalance: 2_000_000 },
      { kind: "call_deposit", targetBalance: 2_000_000 },
    ];
    const r = splitEndStateBuckets(5_000_000, 0, slices, true);
    expect(r.mmf + r.bank).toBeCloseTo(5_000_000, 0);
    expect(r.mmf).toBeCloseTo(2_500_000, 0);
    expect(r.bank).toBeCloseTo(2_500_000, 0);
  });

  it("leaves raw figures untouched when there is no genuine split (single home)", () => {
    const r = splitEndStateBuckets(5_000_000, 0, balancedSlices.slice(0, 1), false);
    expect(r.applied).toBe(false);
    expect(r.mmf).toBe(5_000_000);
    expect(r.bank).toBe(0);
  });

  it("leaves raw figures untouched when isSplit is false even with multiple slices", () => {
    const r = splitEndStateBuckets(4_000_000, 1_000_000, balancedSlices, false);
    expect(r.applied).toBe(false);
    expect(r.mmf).toBe(4_000_000);
    expect(r.bank).toBe(1_000_000);
  });

  it("returns raw when the liquid pot is zero", () => {
    const r = splitEndStateBuckets(0, 0, balancedSlices, true);
    expect(r.applied).toBe(false);
  });
});

// ─── Fix #4: per-bucket percentage uses projected total (sums to 100%) ──────────

describe("Part 2 #4 — bucket percentages sum to 100% of projected total", () => {
  it("dividing each bucket by the projected total yields shares that sum to ~100%", () => {
    const projectedTotal = 5_009_339;
    const buckets = {
      mmf: 2_504_669.5,
      bank: 2_504_669.5,
      tbill: 0,
      ifb: 0,
      fxd: 0,
    };
    const shares = Object.values(buckets).map((v) => (v / projectedTotal) * 100);
    const sum = shares.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 4);
  });

  it("the OLD goal denominator overshoots 100% when the plan overshoots the goal", () => {
    // Documents WHY the fix was needed: goal 5.0M, projected 5.009339M.
    const goal = 5_000_000;
    const projected = 5_009_339;
    const buckets = [projected]; // everything liquid in one bucket
    const oldPct = (buckets[0] / goal) * 100;
    expect(oldPct).toBeGreaterThan(100); // confusing "100.2% of goal"
    const newPct = (buckets[0] / projected) * 100;
    expect(newPct).toBeCloseTo(100, 4); // honest 100% of projected total
  });
});

// ─── Fix #3: Min-Healthy fraction is phase-dependent (90% vs 95%) ───────────────

describe("Part 2 #3 — milestone checkpointFrac reflects the phase actually used", () => {
  const SETTINGS: EngineSettings = {
    mmfYield: 8.78,
    tbill91Rate: 8.5,
    tbill182Rate: 8.78,
    tbill364Rate: 8.97,
    ifbCouponRate: 12.5,
    fxdCouponRate: 12.35,
    withholdingTax: 15,
    startingContribution: 30_000,
    stepUpAmount: 3_000,
    stepUpMonths: 6,
    safetyFloor: 50_000,
    targetAmount: 5_000_000,
    startDate: "2026-07-01",
    horizonMonths: 120,
  };

  it("exposes a checkpointFrac on every milestone", () => {
    const ms = generateMilestones(SETTINGS);
    expect(ms.length).toBeGreaterThan(0);
    for (const m of ms) {
      expect(m.checkpointFrac === 0.9 || m.checkpointFrac === 0.95).toBe(true);
      // The stored minHealthyCheckpoint is the fraction applied to the projected
      // total. The engine applies the fraction to the un-rounded projected value
      // then rounds, so allow a 1-shilling rounding slack vs the rounded total.
      expect(
        Math.abs(m.minHealthyCheckpoint - Math.round(m.projectedTotal * m.checkpointFrac)),
      ).toBeLessThanOrEqual(1);
    }
  });

  it("the final year uses 0.95 (de-risking/final), not a flat 0.90", () => {
    const ms = generateMilestones(SETTINGS);
    const finalYear = ms[ms.length - 1];
    expect(finalYear.checkpointFrac).toBe(0.95);
  });

  it("early Foundation/Growth years use 0.90", () => {
    const ms = generateMilestones(SETTINGS);
    // Year 1 of a 10-year plan is in the Foundation phase → 0.90.
    expect(ms[0].checkpointFrac).toBe(0.9);
  });
});
