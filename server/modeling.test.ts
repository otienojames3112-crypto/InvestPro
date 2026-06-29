import { describe, it, expect } from "vitest";
import {
  registerClassForAssetClass,
  deriveAmountKes,
  deriveUnits,
  modelingIssues,
  buildHoldingDraft,
  computeExit,
  previewModelImpact,
  type ModelingInputs,
} from "../shared/modeling";
import type { AllocationInput } from "../shared/actuals";

/**
 * Expansion Brief Part 3 — "Model what I chose".
 * These tests lock in the single-source-of-truth contracts:
 *  - the modeling helpers derive amounts/units honestly,
 *  - validation reuses the Part-1 guard,
 *  - the commit DRAFT carries provenance (so the audit log + register are attributable),
 *  - exit economics are return-of-capital + realised gain/loss (a loss is NOT a fee),
 *  - the preview reuses buildAllocation (no parallel allocation math) and never
 *    touches the deterministic engine band,
 *  - nothing advises, ranks, or auto-selects an amount.
 */

const baseInputs = (over: Partial<ModelingInputs> = {}): ModelingInputs => ({
  assetClass: "equity",
  name: "Test Holding",
  amountKes: 100_000,
  ...over,
});

describe("Part-1 AssetClass -> register enum mapping (single meeting point)", () => {
  it("maps price-driven classes to their closest register bucket", () => {
    expect(registerClassForAssetClass("equity")).toBe("equity");
    expect(registerClassForAssetClass("reit")).toBe("real_estate");
    expect(registerClassForAssetClass("offshore_fund")).toBe("etf");
  });
  it("maps engine-spine and unknown classes to 'other' (never mis-bucketed)", () => {
    expect(registerClassForAssetClass("cash_mmf")).toBe("other");
    expect(registerClassForAssetClass("bank_deposit")).toBe("other");
    expect(registerClassForAssetClass("gov_discount")).toBe("other");
    expect(registerClassForAssetClass("gov_coupon")).toBe("other");
    expect(registerClassForAssetClass("alt")).toBe("other");
  });
});

describe("amount <-> units <-> price derivation", () => {
  it("prefers units x price for a price-driven holding", () => {
    const amt = deriveAmountKes(baseInputs({ amountKes: null, units: 100, unitPrice: 76 }));
    expect(amt).toBe(7_600);
  });
  it("applies FX for an offshore (fx-exposed) holding", () => {
    const amt = deriveAmountKes(
      baseInputs({ assetClass: "offshore_fund", amountKes: null, units: 10, unitPrice: 50, currency: "USD", fxRateToKes: 130 }),
    );
    expect(amt).toBe(65_000); // 10 * 50 * 130
  });
  it("falls back to the stated KES amount when units/price are absent", () => {
    expect(deriveAmountKes(baseInputs({ amountKes: 250_000 }))).toBe(250_000);
  });
  it("derives units from a KES amount at a price (and fx)", () => {
    expect(deriveUnits(7_600, 76)).toBe(100);
    expect(deriveUnits(65_000, 50, 130)).toBe(10);
    expect(deriveUnits(100, 0)).toBe(0); // guards bad price
  });
});

describe("validation reuses the Part-1 guard", () => {
  it("accepts a complete equity holding", () => {
    expect(modelingIssues(baseInputs({ units: 100, unitPrice: 76, dataSource: "NSE", dataAsOf: "2026-06-26" }))).toEqual([]);
  });
  it("requires a name", () => {
    expect(modelingIssues(baseInputs({ name: "" }))).toContain("A name is required.");
  });
  it("requires a positive amount", () => {
    const issues = modelingIssues(baseInputs({ amountKes: 0, units: null, unitPrice: null }));
    expect(issues.some((i) => i.toLowerCase().includes("amount"))).toBe(true);
  });
  it("flags an offshore holding missing FX (guard delegation)", () => {
    const issues = modelingIssues(
      baseInputs({ assetClass: "offshore_fund", amountKes: 50_000, currency: "USD", fxRateToKes: null }),
    );
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("commit draft carries provenance", () => {
  it("stamps a 'Modeled from Explore' provenance line with source + as-of", () => {
    const draft = buildHoldingDraft(
      baseInputs({
        name: "KCB",
        units: 100,
        unitPrice: 76,
        amountKes: null,
        catalogRef: "nse-kcb",
        dataSource: "NSE close",
        dataAsOf: "2026-06-26",
      }),
    );
    expect(draft.registerAssetClass).toBe("equity");
    expect(draft.purchaseValue).toBe(7_600);
    expect(draft.currentValue).toBe(7_600); // cost == current at entry
    expect(draft.notes.startsWith("Modeled from Explore")).toBe(true);
    expect(draft.notes).toContain("ref: nse-kcb");
    expect(draft.notes).toContain("source: NSE close");
    expect(draft.notes).toContain("as of 2026-06-26");
  });
  it("keeps the user's assumed returns and never invents them", () => {
    const draft = buildHoldingDraft(baseInputs({ assumedReturnBase: 9, assumedReturnConservative: null }));
    expect(draft.assumedReturnBase).toBe(9);
    expect(draft.assumedReturnConservative).toBeNull();
    expect(draft.assumedReturnOptimistic).toBeNull();
  });
});

describe("exit / disposal economics (return of capital, not a penalty)", () => {
  it("books a positive realised gain net of a supplied tax rate", () => {
    const r = computeExit({ currentValue: 120_000, costBasis: 100_000, gainTaxRatePct: 5 });
    expect(r.gainLoss).toBe(20_000);
    expect(r.taxOnGain).toBe(1_000); // 5% of the gain only
    expect(r.proceedsNet).toBe(119_000);
  });
  it("defaults to no gain tax (listed NSE shares are CGT-exempt)", () => {
    const r = computeExit({ currentValue: 120_000, costBasis: 100_000 });
    expect(r.taxOnGain).toBe(0);
    expect(r.proceedsNet).toBe(120_000);
  });
  it("treats a loss as a negative gain, never as a fee, and taxes nothing", () => {
    const r = computeExit({ currentValue: 80_000, costBasis: 100_000, gainTaxRatePct: 5 });
    expect(r.gainLoss).toBe(-20_000);
    expect(r.taxOnGain).toBe(0);
    expect(r.proceedsNet).toBe(80_000); // full current value returned, no penalty
  });
});

describe("preview reuses buildAllocation and respects the engine band", () => {
  const alloc = (): AllocationInput => ({
    deposits: [{ amount: 400_000, bucket: "mmf" }],
    securities: [],
    secondaryMmfs: [],
    bankHoldings: [],
    otherHoldings: [],
  });

  it("grows net worth when funded by new outside money", () => {
    const res = previewModelImpact({
      allocationInput: alloc(),
      registerAssetClass: "equity",
      amountKes: 100_000,
      label: "Equities",
      fundedFromLiquid: false,
      horizonYears: 10,
    });
    expect(res.netWorthBefore).toBe(400_000);
    expect(res.netWorthAfter).toBe(500_000);
    expect(res.netWorthDelta).toBe(100_000);
    expect(res.reducesLiquidity).toBe(false);
    expect(res.holdingSharePct).toBe(20); // 100k / 500k
  });

  it("keeps net worth flat but lowers liquidity when funded from the liquid pot", () => {
    const res = previewModelImpact({
      allocationInput: alloc(),
      registerAssetClass: "equity",
      amountKes: 100_000,
      label: "Equities",
      fundedFromLiquid: true,
      horizonYears: 10,
    });
    // money simply moved from MMF into the holding
    expect(res.netWorthAfter).toBe(400_000);
    expect(res.netWorthDelta).toBe(0);
    expect(res.liquidBefore).toBe(400_000);
    expect(res.liquidAfter).toBe(300_000);
    expect(res.reducesLiquidity).toBe(true);
  });

  it("projects only the holding's OWN assumed scenario (user assumption), not an engine forecast", () => {
    const res = previewModelImpact({
      allocationInput: alloc(),
      registerAssetClass: "equity",
      amountKes: 100_000,
      label: "Equities",
      fundedFromLiquid: false,
      assumedReturnBase: 10,
      assumedReturnConservative: null,
      horizonYears: 10,
    });
    // 100k * 1.10^10 ~= 259,374.25 — derived purely from the user's own rate
    expect(res.scenario.base).toBeCloseTo(259_374.25, 0);
    expect(res.scenario.conservative).toBeNull();
    expect(res.scenario.optimistic).toBeNull();
    expect(res.scenario.years).toBe(10);
  });
});
