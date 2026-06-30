/**
 * Net-worth BASIS consistency (pasted Part 3/4).
 *
 * Proves the three sanctioned bases (Full Net Worth, Goal-Plan Assets, Income/
 * Tax Base) are derived from ONE snapshot and that the page-facing selectors all
 * read those same fields — so no surface can show a different "net worth" than
 * the one Reconciliation checks.
 *
 * Acceptance (from the brief):
 *  - Add KES 200,000 equity as an Other Asset → Full Net Worth, Dashboard
 *    headline, and Portfolio Review all increase by 200,000.
 *  - Tagging that equity OUT of the goal leaves Goal-Plan Assets unchanged while
 *    Full Net Worth still includes it.
 *  - Tax Summary base does NOT include the equity unless income is recorded.
 */
import { describe, it, expect } from "vitest";
import {
  selectFullNetWorth,
  selectGoalPlanAssets,
  selectIncomeTaxBase,
  selectDashboardHeadlineNetWorth,
  selectPortfolioReviewNetWorth,
  selectTaxSummaryBase,
  selectLedgerTodayComparableValue,
  type PortfolioSnapshot,
  type SnapshotHoldings,
} from "../shared/snapshot";

function holdings(over: Partial<SnapshotHoldings> = {}): SnapshotHoldings {
  const base: SnapshotHoldings = {
    netWorth: 1_000_000,
    primaryMmf: 600_000,
    secondaryMmf: 0,
    bank: 100_000,
    tbill: 200_000,
    ifb: 50_000,
    fxd: 50_000,
    buckets: { cash: 700_000, gov: 300_000, equity: 0, reit: 0, offshore: 0, other: 0 },
    other: {},
    fullNetWorth: 1_000_000,
    goalPlanAssets: 1_000_000,
    otherAssetsExcludedFromGoal: 0,
    otherAssetsTotal: 0,
    incomeTaxBase: 1_000_000,
  };
  return { ...base, ...over };
}

function snapshot(h: SnapshotHoldings): PortfolioSnapshot {
  return {
    identity: {
      portfolioId: 1,
      name: "Test",
      purpose: null,
      isSandbox: false,
      allocationPolicy: "balanced",
      committedTier: null,
      tierOverridden: false,
      planCommittedAt: null,
      planStatus: "draft",
      activePolicyTier: "balanced",
    },
    goal: {
      target: 5_000_000,
      horizonMonths: 120,
      elapsedMonths: 0,
      horizonRemainingMonths: 120,
      projectedFinalValue: 5_100_000,
      netWorthNow: h.netWorth,
    },
    holdings: h,
    allocation: { tier: "balanced", timeRemainingFraction: 1, rows: [], isEmpty: true, caveat: "" },
    contributions: {
      startingContribution: 0,
      stepUpAmount: 0,
      stepUpMonths: 6,
      totalPlanned: 0,
      totalActual: 0,
      points: [],
    },
    ledger: [],
    income: { accruedNetInterest: 0, blendedNetYieldPct: 0 },
    tax: { base: h.incomeTaxBase, breakdown: {} },
    liquidity: [],
    reconciliation: { ok: true, reference: h.fullNetWorth, sources: [] },
    warnings: [],
    nextActions: [],
    asOfMs: 0,
  };
}

describe("net-worth basis selectors", () => {
  it("Full Net Worth equals the canonical net worth (every pocket)", () => {
    const s = snapshot(holdings());
    expect(selectFullNetWorth(s)).toBe(1_000_000);
    // Dashboard headline + Portfolio Review read the SAME selector.
    expect(selectDashboardHeadlineNetWorth(s)).toBe(selectFullNetWorth(s));
    expect(selectPortfolioReviewNetWorth(s)).toBe(selectFullNetWorth(s));
  });

  it("Tax Summary base reads the income/tax base, NOT full net worth", () => {
    const s = snapshot(holdings({ incomeTaxBase: 900_000 }));
    expect(selectTaxSummaryBase(s)).toBe(900_000);
    expect(selectIncomeTaxBase(s)).toBe(900_000);
    expect(selectTaxSummaryBase(s)).not.toBe(selectFullNetWorth(s));
  });

  it("Ledger-today comparable value uses Goal-Plan Assets", () => {
    const s = snapshot(holdings({ goalPlanAssets: 800_000, otherAssetsExcludedFromGoal: 200_000 }));
    expect(selectLedgerTodayComparableValue(s)).toBe(800_000);
    expect(selectGoalPlanAssets(s)).toBe(800_000);
  });

  it("ACCEPTANCE: adding a KES 200,000 equity raises Full Net Worth and every page that reads it by 200,000", () => {
    const before = snapshot(holdings());
    const after = snapshot(
      holdings({
        netWorth: 1_200_000,
        fullNetWorth: 1_200_000,
        goalPlanAssets: 1_200_000, // equity tagged into the goal by default
        otherAssetsTotal: 200_000,
        other: { equity: 200_000 },
        buckets: { cash: 700_000, gov: 300_000, equity: 200_000, reit: 0, offshore: 0, other: 0 },
      }),
    );
    const delta = (sel: (s: PortfolioSnapshot) => number) => sel(after) - sel(before);
    expect(delta(selectFullNetWorth)).toBe(200_000);
    expect(delta(selectDashboardHeadlineNetWorth)).toBe(200_000);
    expect(delta(selectPortfolioReviewNetWorth)).toBe(200_000);
    expect(delta(selectGoalPlanAssets)).toBe(200_000);
  });

  it("ACCEPTANCE: tagging the equity OUT of the goal leaves Goal-Plan Assets flat but keeps Full Net Worth inclusive", () => {
    const tagged = snapshot(
      holdings({
        netWorth: 1_200_000,
        fullNetWorth: 1_200_000,
        goalPlanAssets: 1_000_000, // equity excluded from the goal
        otherAssetsExcludedFromGoal: 200_000,
        otherAssetsTotal: 200_000,
        other: { equity: 200_000 },
      }),
    );
    expect(selectFullNetWorth(tagged)).toBe(1_200_000); // still counts it
    expect(selectGoalPlanAssets(tagged)).toBe(1_000_000); // does not
    expect(selectFullNetWorth(tagged) - selectGoalPlanAssets(tagged)).toBe(200_000);
  });

  it("ACCEPTANCE: the equity does NOT inflate the tax base unless income is recorded", () => {
    const s = snapshot(
      holdings({
        netWorth: 1_200_000,
        fullNetWorth: 1_200_000,
        goalPlanAssets: 1_200_000,
        otherAssetsTotal: 200_000,
        other: { equity: 200_000 },
        incomeTaxBase: 1_000_000, // unchanged: no recorded equity income
      }),
    );
    expect(selectTaxSummaryBase(s)).toBe(1_000_000);
    expect(selectTaxSummaryBase(s)).toBeLessThan(selectFullNetWorth(s));
  });
});


import { computeNetWorthBases } from "../shared/snapshot";

describe("computeNetWorthBases — the pure derivation the builder runs", () => {
  it("with nothing tagged out, Goal-Plan Assets equals Full Net Worth", () => {
    const b = computeNetWorthBases({
      netWorth: 1_000_000,
      excludedOtherAssetsKes: 0,
      otherAssetsTotalKes: 0,
      incomeTaxBaseKes: 900_000,
    });
    expect(b.fullNetWorth).toBe(1_000_000);
    expect(b.goalPlanAssets).toBe(1_000_000);
    expect(b.incomeTaxBase).toBe(900_000);
  });

  it("ACCEPTANCE: +200k equity tagged OUT raises Full NW but not Goal-Plan or tax base", () => {
    const before = computeNetWorthBases({
      netWorth: 1_000_000,
      excludedOtherAssetsKes: 0,
      otherAssetsTotalKes: 0,
      incomeTaxBaseKes: 1_000_000,
    });
    const after = computeNetWorthBases({
      netWorth: 1_200_000, // equity folded into net worth
      excludedOtherAssetsKes: 200_000, // but tagged out of the goal
      otherAssetsTotalKes: 200_000,
      incomeTaxBaseKes: 1_000_000, // no recorded equity income
    });
    expect(after.fullNetWorth - before.fullNetWorth).toBe(200_000);
    expect(after.goalPlanAssets).toBe(before.goalPlanAssets); // flat
    expect(after.incomeTaxBase).toBe(before.incomeTaxBase); // flat
    expect(after.fullNetWorth - after.goalPlanAssets).toBe(200_000);
  });

  it("ACCEPTANCE: +200k equity tagged IN raises Full NW and Goal-Plan together", () => {
    const after = computeNetWorthBases({
      netWorth: 1_200_000,
      excludedOtherAssetsKes: 0, // tagged into the goal
      otherAssetsTotalKes: 200_000,
      incomeTaxBaseKes: 1_000_000,
    });
    expect(after.fullNetWorth).toBe(1_200_000);
    expect(after.goalPlanAssets).toBe(1_200_000);
  });

  it("clamps every basis to non-negative", () => {
    const b = computeNetWorthBases({
      netWorth: -50,
      excludedOtherAssetsKes: 500,
      otherAssetsTotalKes: -10,
      incomeTaxBaseKes: -5,
    });
    expect(b.fullNetWorth).toBe(0);
    expect(b.goalPlanAssets).toBe(0);
    expect(b.otherAssetsTotal).toBe(0);
    expect(b.incomeTaxBase).toBe(0);
  });
});
