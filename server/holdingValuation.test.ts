import { describe, it, expect } from "vitest";
import {
  decomposeReturn,
  projectedUnitPrice,
  projectedFxRate,
  makeIncomeEvent,
  projectHoldingToHorizon,
  paymentsPerYear,
} from "../shared/holdingValuation";

/**
 * Part 4 — single valuation pipeline tests.
 *
 * These cover the NEW price-driven / income-bearing asset classes (equity, REIT,
 * offshore) and assert the two invariants the brief demands:
 *   1. Capital growth and income are decomposed — income is never double-counted
 *      as price growth.
 *   2. Existing fixed-income behaviour (no income supplied) reproduces the prior
 *      annual `(1+r)^years` compounding bit-for-bit.
 */

describe("decomposeReturn — capital vs income split", () => {
  it("splits a total return into capital growth (total − income)", () => {
    const d = decomposeReturn({ totalReturnPct: 12, incomeRatePct: 4 });
    expect(d.totalPct).toBe(12);
    expect(d.incomePct).toBe(4);
    expect(d.capitalGrowthPct).toBe(8);
    expect(d.priceFlat).toBe(false);
  });

  it("treats a missing total return as price-flat (only income accrues)", () => {
    const d = decomposeReturn({ totalReturnPct: null, incomeRatePct: 5 });
    expect(d.priceFlat).toBe(true);
    expect(d.incomePct).toBe(5);
    // With no total view supplied, total defaults to income, so capital growth is 0.
    expect(d.capitalGrowthPct).toBe(0);
  });

  it("never lets income exceed and invert into negative capital silently", () => {
    const d = decomposeReturn({ totalReturnPct: 3, incomeRatePct: 5 });
    // Honest: capital growth can be negative if the user's income assumption
    // exceeds their total-return assumption — we do not hide it.
    expect(d.capitalGrowthPct).toBe(-2);
  });
});

describe("price & FX projection helpers", () => {
  it("projects unit price forward at the capital-growth rate (monthly compounding)", () => {
    // 8%/yr applied as a simple monthly rate, compounded 12 months: (1+0.08/12)^12.
    const p = projectedUnitPrice(100, 8, 12);
    expect(p).toBeCloseTo(100 * Math.pow(1 + 0.08 / 12, 12), 4);
  });

  it("holds FX FLAT in the base case — shilling depreciation is never assumed", () => {
    expect(projectedFxRate(130, 60, null)).toBe(130);
    expect(projectedFxRate(130, 120, 0)).toBe(130);
  });

  it("honors an explicit user FX drift only when supplied", () => {
    const fx = projectedFxRate(130, 12, 5); // +5%/yr for 12 months
    expect(fx).toBeCloseTo(130 * 1.05, 0);
  });
});

describe("makeIncomeEvent — single taxFor() path", () => {
  it("nets local dividends at the 5% final WHT (no review needed)", () => {
    const e = makeIncomeEvent({
      grossKes: 1000,
      taxInput: { assetClass: "equity" },
      disposition: "sweep",
    });
    expect(e.taxRatePct).toBe(5);
    expect(e.taxKes).toBe(50);
    expect(e.netKes).toBe(950);
    expect(e.requiresReview).toBe(false);
  });

  it("applies the sourced REIT 5% (review-flagged) — never a silent zero", () => {
    const e = makeIncomeEvent({
      grossKes: 1000,
      taxInput: { assetClass: "reit" },
      disposition: "sweep",
    });
    // Part 7.0.b: REIT distribution now uses the sourced resident 5%, still
    // review-flagged for the unit-holder's circumstances. It is NOT a silent zero.
    expect(e.requiresReview).toBe(true);
    expect(e.taxRatePct).toBe(5);
    expect(e.netKes).toBe(950);
  });

  it("uses a user-supplied offshore distribution rate when provided", () => {
    const e = makeIncomeEvent({
      grossKes: 1000,
      taxInput: { assetClass: "offshore_fund", userRatePct: 15 },
      disposition: "sweep",
    });
    expect(e.taxRatePct).toBe(15);
    expect(e.netKes).toBe(850);
    expect(e.requiresReview).toBe(false);
  });
});

describe("projectHoldingToHorizon — equity", () => {
  it("reproduces prior annual compounding when NO income is supplied (regression)", () => {
    const r = projectHoldingToHorizon({
      assetClass: "equity",
      scenario: "base",
      entryValueKes: 100_000,
      assumedReturnBasePct: 10,
      incomeRatePct: null,
      horizonYears: 10,
    });
    // 100k * 1.10^10 — bit-for-bit with the old flat compounding.
    expect(r.endValue).toBeCloseTo(259_374.25, 0);
    expect(r.incomeReceivedNet).toBe(0);
    expect(r.priceFlat).toBe(false);
  });

  it("decomposes a total return into capital growth + swept net income", () => {
    const r = projectHoldingToHorizon({
      assetClass: "equity",
      scenario: "base",
      entryValueKes: 100_000,
      assumedReturnBasePct: 10, // total
      incomeRatePct: 4, // dividend
      cadence: "annual",
      incomeDisposition: "sweep",
      horizonYears: 5,
    });
    // Capital grows at 10-4 = 6%/yr; income is swept (not in capital).
    expect(r.capitalValue).toBeCloseTo(100_000 * Math.pow(1.06, 5), 0);
    // Income is positive and netted at the 5% dividend WHT — never folded into price.
    expect(r.incomeReceivedNet).toBeGreaterThan(0);
    expect(r.taxRatePct).toBe(5);
  });

  it("DRIP reinvestment produces a higher end value than sweeping the same income", () => {
    const common = {
      assetClass: "equity" as const,
      scenario: "base" as const,
      entryValueKes: 100_000,
      assumedReturnBasePct: 10,
      incomeRatePct: 4,
      cadence: "annual" as const,
      horizonYears: 10,
    };
    const sweep = projectHoldingToHorizon({ ...common, incomeDisposition: "sweep" });
    const drip = projectHoldingToHorizon({ ...common, incomeDisposition: "reinvest" });
    // DRIP folds net income back into capital, so capital compounds higher.
    expect(drip.endValue).toBeGreaterThan(sweep.endValue);
    // For sweep, the income lives outside endValue and is reported separately.
    expect(sweep.incomeReceivedNet).toBeGreaterThan(0);
  });
});

describe("projectHoldingToHorizon — REIT & offshore", () => {
  it("REIT carries the review flag and applies the sourced 5% (not a silent zero)", () => {
    const r = projectHoldingToHorizon({
      assetClass: "reit",
      scenario: "base",
      entryValueKes: 200_000,
      assumedReturnBasePct: 9,
      incomeRatePct: 6,
      cadence: "semiannual",
      incomeDisposition: "sweep",
      horizonYears: 5,
    });
    // Part 7.0.b: sourced resident 5%, still review-flagged for circumstances.
    expect(r.taxRequiresReview).toBe(true);
    expect(r.taxRatePct).toBe(5);
    expect(r.incomeReceivedNet).toBeGreaterThan(0);
  });

  it("offshore holds FX flat in base and applies a user-supplied distribution WHT", () => {
    const r = projectHoldingToHorizon({
      assetClass: "offshore_fund",
      scenario: "base",
      entryValueKes: 500_000,
      assumedReturnBasePct: 8,
      incomeRatePct: 2,
      cadence: "annual",
      incomeDisposition: "sweep",
      userTaxRatePct: 15,
      horizonYears: 5,
    });
    expect(r.taxRatePct).toBe(15);
    expect(r.taxRequiresReview).toBe(false);
    // Capital grows at 8-2 = 6%/yr in KES terms (FX flat — no depreciation tailwind).
    expect(r.capitalValue).toBeCloseTo(500_000 * Math.pow(1.06, 5), 0);
  });

  it("price-flat: no total-return view means capital is held flat, only income accrues", () => {
    const r = projectHoldingToHorizon({
      assetClass: "equity",
      scenario: "base",
      entryValueKes: 100_000,
      assumedReturnBasePct: null,
      incomeRatePct: 4,
      cadence: "annual",
      incomeDisposition: "sweep",
      horizonYears: 3,
    });
    expect(r.priceFlat).toBe(true);
    expect(r.capitalValue).toBe(100_000); // flat
    expect(r.incomeReceivedNet).toBeGreaterThan(0);
  });
});

describe("cadence", () => {
  it("maps payment cadences to payments-per-year", () => {
    expect(paymentsPerYear("annual")).toBe(1);
    expect(paymentsPerYear("semiannual")).toBe(2);
    expect(paymentsPerYear("quarterly")).toBe(4);
    expect(paymentsPerYear("none")).toBe(0);
  });

  it("more frequent cadence does not change the gross annual income materially", () => {
    const base = {
      assetClass: "equity" as const,
      scenario: "base" as const,
      entryValueKes: 100_000,
      assumedReturnBasePct: 0, // isolate income; capital flat
      incomeRatePct: 4,
      incomeDisposition: "sweep" as const,
      horizonYears: 1,
    };
    const annual = projectHoldingToHorizon({ ...base, cadence: "annual" });
    const quarterly = projectHoldingToHorizon({ ...base, cadence: "quarterly" });
    // ~4% of 100k net of 5% WHT ≈ 3,600-3,800 depending on the within-year
    // payment base; both cadences land in the same neighbourhood.
    expect(annual.incomeReceivedNet).toBeGreaterThan(3_500);
    expect(quarterly.incomeReceivedNet).toBeGreaterThan(3_500);
    expect(Math.abs(annual.incomeReceivedNet - quarterly.incomeReceivedNet)).toBeLessThan(100);
  });
});

describe("no-advice invariants", () => {
  it("the projection result exposes no ranking/score/recommendation field", () => {
    const r = projectHoldingToHorizon({
      assetClass: "equity",
      scenario: "base",
      entryValueKes: 100_000,
      assumedReturnBasePct: 10,
      horizonYears: 10,
    });
    const keys = Object.keys(r);
    for (const banned of ["rank", "score", "recommend", "rating", "best", "buy"]) {
      expect(keys.some((k) => k.toLowerCase().includes(banned))).toBe(false);
    }
  });
});
