import { describe, it, expect } from "vitest";
import {
  rollupActualToBuckets,
  computeBucketGaps,
  resolveTierSelection,
  suggestTier,
  DEFAULT_ALLOCATION_TEMPLATES,
  GAP_ALIGNED_BAND_PP,
  RISK_ASSUMPTION_CAVEAT,
  ALLOCATION_BUCKETS,
  type ActualBucketValues,
  type AllocationTier,
  type TierSuggestion,
} from "../shared/allocationModel";

/**
 * Part 4 — the FACTUAL gap readout (target glide vs actual holdings) and the
 * override-always-wins tier selection. These are the two pieces of backend glue
 * the template surface renders; both must stay neutral (facts, never a buy/sell
 * instruction) and must never block an override.
 */

describe("rollupActualToBuckets", () => {
  it("percentages are taken on the CLASSIFIED base (unclassified 'other' is excluded)", () => {
    // 60k cash + 40k gov classified, plus a 100k house that maps to nothing.
    const actual: ActualBucketValues = {
      cash: 60_000,
      gov: 40_000,
      equity: 0,
      reit: 0,
      offshore: 0,
      other: 100_000,
    };
    const r = rollupActualToBuckets(actual);
    expect(r.classifiedKes).toBe(100_000);
    expect(r.otherKes).toBe(100_000);
    expect(r.totalKes).toBe(200_000);
    // The house must NOT dilute the cash/gov split.
    expect(r.pctOfClassified.cash).toBeCloseTo(60, 5);
    expect(r.pctOfClassified.gov).toBeCloseTo(40, 5);
    // Classified percentages sum to ~100.
    const sum = ALLOCATION_BUCKETS.reduce((s, b) => s + r.pctOfClassified[b], 0);
    expect(sum).toBeCloseTo(100, 1);
  });

  it("negative inputs floor at zero", () => {
    const r = rollupActualToBuckets({
      cash: -5_000,
      gov: 10_000,
      equity: 0,
      reit: 0,
      offshore: 0,
      other: 0,
    });
    expect(r.valueKes.cash).toBe(0);
    expect(r.classifiedKes).toBe(10_000);
    expect(r.pctOfClassified.gov).toBeCloseTo(100, 5);
  });

  it("a zero classified base yields an isEmpty rollup (no divide-by-zero)", () => {
    const r = rollupActualToBuckets({
      cash: 0,
      gov: 0,
      equity: 0,
      reit: 0,
      offshore: 0,
      other: 250_000,
    });
    expect(r.isEmpty).toBe(true);
    for (const b of ALLOCATION_BUCKETS) expect(r.pctOfClassified[b]).toBe(0);
  });
});

describe("computeBucketGaps", () => {
  const tier: AllocationTier = "balanced";
  const template = DEFAULT_ALLOCATION_TEMPLATES[tier];

  it("a mix exactly equal to the template reads 'aligned' across the board", () => {
    // Build actual KES that reproduces the template percentages on a 100k base.
    const actual: ActualBucketValues = {
      cash: template.cash * 1_000,
      gov: template.gov * 1_000,
      equity: template.equity * 1_000,
      reit: template.reit * 1_000,
      offshore: template.offshore * 1_000,
      other: 0,
    };
    const readout = computeBucketGaps({ template, actual });
    expect(readout.isEmpty).toBe(false);
    for (const g of readout.gaps) {
      expect(Math.abs(g.gapPp)).toBeLessThanOrEqual(GAP_ALIGNED_BAND_PP);
      expect(g.direction).toBe("aligned");
    }
    expect(readout.caveat).toBe(RISK_ASSUMPTION_CAVEAT);
  });

  it("over/under are signed correctly (actual − template)", () => {
    // All cash: cash is way over, every risky bucket is under.
    const actual: ActualBucketValues = {
      cash: 100_000,
      gov: 0,
      equity: 0,
      reit: 0,
      offshore: 0,
      other: 0,
    };
    const readout = computeBucketGaps({ template, actual });
    const cash = readout.gaps.find((g) => g.bucket === "cash")!;
    const equity = readout.gaps.find((g) => g.bucket === "equity")!;
    expect(cash.actualPct).toBeCloseTo(100, 1);
    expect(cash.gapPp).toBeGreaterThan(0);
    expect(cash.direction).toBe("over");
    if (template.equity > GAP_ALIGNED_BAND_PP) {
      expect(equity.gapPp).toBeLessThan(0);
      expect(equity.direction).toBe("under");
    }
  });

  it("the dead-band keeps tiny noise reading as 'aligned'", () => {
    // Nudge cash by exactly the band; should still be aligned.
    const base = template.cash * 1_000;
    const actual: ActualBucketValues = {
      cash: base, // identical → 0 gap
      gov: template.gov * 1_000,
      equity: template.equity * 1_000,
      reit: template.reit * 1_000,
      offshore: template.offshore * 1_000,
      other: 0,
    };
    const readout = computeBucketGaps({ template, actual, alignedBandPp: 5 });
    for (const g of readout.gaps) expect(g.direction).toBe("aligned");
  });

  it("with no holdings yet, every positive-weight bucket reads 'under' but flagged informational", () => {
    const actual: ActualBucketValues = {
      cash: 0,
      gov: 0,
      equity: 0,
      reit: 0,
      offshore: 0,
      other: 0,
    };
    const readout = computeBucketGaps({ template, actual });
    expect(readout.isEmpty).toBe(true);
    for (const g of readout.gaps) {
      expect(g.noHoldingsYet).toBe(true);
      if (g.templatePct > 0) expect(g.direction).toBe("under");
    }
  });

  it("gaps are returned in the canonical bucket order", () => {
    const readout = computeBucketGaps({
      template,
      actual: { cash: 1, gov: 1, equity: 1, reit: 1, offshore: 1, other: 0 },
    });
    expect(readout.gaps.map((g) => g.bucket)).toEqual([...ALLOCATION_BUCKETS]);
  });
});

describe("override always wins (resolveTierSelection)", () => {
  // A mid-horizon goal suggests a middle tier; we can override either way.
  const suggestion: TierSuggestion = suggestTier(60, "standard");

  it("defaults to the suggestion when nothing is chosen", () => {
    const sel = resolveTierSelection({ suggestion, selected: null });
    expect(sel.selectedTier).toBe(suggestion.tier);
    expect(sel.userOverrode).toBe(false);
  });

  it("a SAFER override is allowed and never conflicts", () => {
    const sel = resolveTierSelection({ suggestion, selected: "capital_preservation" });
    expect(sel.selectedTier).toBe("capital_preservation");
    expect(sel.userOverrode).toBe(suggestion.tier !== "capital_preservation");
    expect(sel.conflictsWithHorizon).toBe(false);
  });

  it("a RISKIER override is still allowed but FLAGGED (never blocked)", () => {
    const sel = resolveTierSelection({ suggestion, selected: "aggressive" });
    // The selection always takes the user's choice — never overridden back.
    expect(sel.selectedTier).toBe("aggressive");
    expect(sel.userOverrode).toBe(true);
    // Riskier than the horizon base tier ⇒ flagged for a consequence.
    expect(sel.conflictsWithHorizon).toBe(true);
  });

  it("choosing the suggestion itself is not an override", () => {
    const sel = resolveTierSelection({ suggestion, selected: suggestion.tier });
    expect(sel.userOverrode).toBe(false);
  });
});
