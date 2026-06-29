import { describe, it, expect } from "vitest";
import {
  ALLOCATION_TIERS,
  ALLOCATION_BUCKETS,
  DEFAULT_ALLOCATION_TEMPLATES,
  MIN_CASH_FLOOR_PCT,
  TEMPLATE_SUM_PCT,
  bucketForClass,
  defaultTemplateFor,
  validateAllocationWeights,
  validateAllocationTemplate,
  tierForHorizon,
  shiftTier,
  tierRank,
  suggestTier,
  resolveTierSelection,
  type AllocationWeights,
} from "../shared/allocationModel";
import type { AssetClass } from "../shared/assetModel";

describe("allocation tiers", () => {
  it("has exactly the five tiers in ascending risk order", () => {
    expect([...ALLOCATION_TIERS]).toEqual([
      "capital_preservation",
      "conservative",
      "balanced",
      "growth",
      "aggressive",
    ]);
    expect(tierRank("capital_preservation")).toBe(0);
    expect(tierRank("aggressive")).toBe(ALLOCATION_TIERS.length - 1);
  });

  it("shiftTier clamps at both ends and never wraps", () => {
    expect(shiftTier("capital_preservation", -1)).toBe("capital_preservation");
    expect(shiftTier("aggressive", +1)).toBe("aggressive");
    expect(shiftTier("balanced", -1)).toBe("conservative");
    expect(shiftTier("balanced", +1)).toBe("growth");
    expect(shiftTier("conservative", -5)).toBe("capital_preservation");
  });
});

describe("bucketForClass grouping", () => {
  it("maps every behavior class to the right bucket (alt excluded)", () => {
    const cases: Array<[AssetClass, ReturnType<typeof bucketForClass>]> = [
      ["cash_mmf", "cash"],
      ["bank_deposit", "cash"],
      ["gov_discount", "gov"],
      ["gov_coupon", "gov"],
      ["equity", "equity"],
      ["reit", "reit"],
      ["offshore_fund", "offshore"],
      ["alt", null],
    ];
    for (const [cls, expected] of cases) expect(bucketForClass(cls)).toBe(expected);
  });
});

describe("default templates", () => {
  it("every default template is valid (sums to 100, cash >= floor, in range)", () => {
    for (const tier of ALLOCATION_TIERS) {
      const v = validateAllocationTemplate(defaultTemplateFor(tier));
      expect(v.ok, `${tier}: ${v.errors.join("; ")}`).toBe(true);
      expect(v.total).toBe(TEMPLATE_SUM_PCT);
    }
  });

  it("riskier tiers do not allocate more to cash than safer ones (monotone de-risking of cash)", () => {
    const cashByRank = ALLOCATION_TIERS.map((t) => DEFAULT_ALLOCATION_TEMPLATES[t].cash);
    for (let i = 1; i < cashByRank.length; i++) {
      expect(cashByRank[i]).toBeLessThanOrEqual(cashByRank[i - 1]);
    }
  });

  it("riskier tiers hold at least as much equity as safer ones", () => {
    const eqByRank = ALLOCATION_TIERS.map((t) => DEFAULT_ALLOCATION_TEMPLATES[t].equity);
    for (let i = 1; i < eqByRank.length; i++) {
      expect(eqByRank[i]).toBeGreaterThanOrEqual(eqByRank[i - 1]);
    }
  });
});

describe("validateAllocationWeights", () => {
  const base: AllocationWeights = { cash: 10, gov: 45, equity: 28, reit: 7, offshore: 10 };

  it("accepts a clean, summing-to-100 mix", () => {
    expect(validateAllocationWeights(base).ok).toBe(true);
  });

  it("rejects a mix that does not sum to 100", () => {
    const v = validateAllocationWeights({ ...base, offshore: 5 }); // 95
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(/sum to 100/i);
  });

  it("rejects a cash weight below the operational floor", () => {
    // keep sum at 100 but push cash under the floor
    const v = validateAllocationWeights({ cash: 2, gov: 53, equity: 28, reit: 7, offshore: 10 });
    expect(v.ok).toBe(false);
    expect(v.errors.join(" ")).toMatch(new RegExp(`${MIN_CASH_FLOOR_PCT}%`));
  });

  it("rejects out-of-range and missing weights", () => {
    expect(validateAllocationWeights({ ...base, equity: 150 } as AllocationWeights).ok).toBe(false);
    const missing = validateAllocationWeights({ cash: 10, gov: 45, equity: 28, reit: 7 } as unknown as AllocationWeights);
    expect(missing.ok).toBe(false);
    expect(missing.errors.join(" ")).toMatch(/offshore/i);
  });

  it("tolerates float dust around 100 (e.g. 33.34 + 33.33 + 33.33)", () => {
    const v = validateAllocationWeights({ cash: 33.34, gov: 33.33, equity: 33.33, reit: 0, offshore: 0 });
    expect(v.ok).toBe(true);
  });
});

describe("tierForHorizon bands", () => {
  it("maps each band correctly at and around its boundary", () => {
    expect(tierForHorizon(0)).toBe("capital_preservation");
    expect(tierForHorizon(23)).toBe("capital_preservation");
    expect(tierForHorizon(24)).toBe("conservative"); // boundary is exclusive lower
    expect(tierForHorizon(47)).toBe("conservative");
    expect(tierForHorizon(48)).toBe("balanced");
    expect(tierForHorizon(83)).toBe("balanced");
    expect(tierForHorizon(84)).toBe("growth");
    expect(tierForHorizon(143)).toBe("growth");
    expect(tierForHorizon(144)).toBe("aggressive");
    expect(tierForHorizon(600)).toBe("aggressive");
  });
});

describe("suggestTier", () => {
  it("standard goal returns the horizon band tier unchanged", () => {
    const s = suggestTier(120, "standard");
    expect(s.baseTier).toBe("growth");
    expect(s.tier).toBe("growth");
    expect(s.shiftedBy).toBe(0);
    expect(s.reason).toMatch(/override/i);
  });

  it("critical goal shifts exactly one tier safer (clamped at floor)", () => {
    const mid = suggestTier(120, "critical"); // growth -> balanced
    expect(mid.baseTier).toBe("growth");
    expect(mid.tier).toBe("balanced");
    expect(mid.shiftedBy).toBe(-1);

    const floor = suggestTier(6, "critical"); // capital_preservation stays put
    expect(floor.baseTier).toBe("capital_preservation");
    expect(floor.tier).toBe("capital_preservation");
    expect(floor.shiftedBy).toBe(0);
  });

  it("aspirational goal never auto-shifts riskier", () => {
    const s = suggestTier(60, "aspirational"); // balanced
    expect(s.tier).toBe(s.baseTier);
    expect(s.shiftedBy).toBe(0);
  });

  it("defaults nature to standard when omitted", () => {
    expect(suggestTier(36).tier).toBe("conservative");
  });
});

describe("resolveTierSelection (override + conflict flag)", () => {
  it("defaults to the suggestion when nothing chosen; not overridden, no conflict", () => {
    const suggestion = suggestTier(120, "standard"); // growth
    const r = resolveTierSelection({ suggestion, selected: null });
    expect(r.selectedTier).toBe("growth");
    expect(r.userOverrode).toBe(false);
    expect(r.conflictsWithHorizon).toBe(false);
  });

  it("flags a riskier-than-horizon override as a conflict (never blocks)", () => {
    const suggestion = suggestTier(120, "critical"); // base growth, suggested balanced
    const r = resolveTierSelection({ suggestion, selected: "aggressive" });
    expect(r.selectedTier).toBe("aggressive");
    expect(r.userOverrode).toBe(true);
    expect(r.conflictsWithHorizon).toBe(true); // riskier than base (growth)
  });

  it("a safer override is allowed and never conflicts", () => {
    const suggestion = suggestTier(120, "standard"); // growth
    const r = resolveTierSelection({ suggestion, selected: "conservative" });
    expect(r.userOverrode).toBe(true);
    expect(r.conflictsWithHorizon).toBe(false);
  });

  it("choosing the same as the suggestion is not an override", () => {
    const suggestion = suggestTier(60, "standard"); // balanced
    const r = resolveTierSelection({ suggestion, selected: "balanced" });
    expect(r.userOverrode).toBe(false);
    expect(r.conflictsWithHorizon).toBe(false);
  });

  it("a critical-shifted suggestion that matches the base horizon does not falsely flag", () => {
    // base growth, suggested balanced; user picks growth (the horizon base) — not a conflict.
    const suggestion = suggestTier(120, "critical");
    const r = resolveTierSelection({ suggestion, selected: "growth" });
    expect(r.selectedTier).toBe("growth");
    expect(r.userOverrode).toBe(true); // differs from the suggested (balanced)
    expect(r.conflictsWithHorizon).toBe(false); // equal to base, not riskier
  });

  it("ignores an unknown selected value and falls back to the suggestion", () => {
    const suggestion = suggestTier(36, "standard"); // conservative
    const r = resolveTierSelection({ suggestion, selected: "nonsense" as never });
    expect(r.selectedTier).toBe("conservative");
    expect(r.userOverrode).toBe(false);
  });
});

describe("buckets sanity", () => {
  it("exposes exactly five buckets", () => {
    expect([...ALLOCATION_BUCKETS]).toEqual(["cash", "gov", "equity", "reit", "offshore"]);
  });
});
