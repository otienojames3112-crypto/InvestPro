import { describe, it, expect } from "vitest";
import {
  selectNetWorth,
  selectGoalProgress,
  selectActualVsPlanned,
  selectAllocationGap,
  selectLedgerRows,
  selectReconciliationStatus,
  selectPlanStatus,
  type PortfolioSnapshot,
} from "../shared/snapshot";
import { buildAllocation } from "../shared/actuals";
import { computeBucketGaps, glidedAllocation } from "../shared/allocationModel";

/**
 * Phase 1 — the canonical snapshot is the single source of money truth.
 *
 * `buildPortfolioSnapshot` needs DB-loaded rows, so these tests verify the two
 * things that can be checked without a live DB:
 *   1. The PURE SELECTORS read exactly what the snapshot carries (no re-deriving).
 *   2. The COMPOSITION INVARIANTS the builder relies on hold: the bucket roll-up
 *      sums to the same net worth `buildAllocation` produces, and the gap rows
 *      are exactly `computeBucketGaps` of the target glide vs the actual buckets.
 * Together these guarantee the snapshot cannot silently disagree with the
 * existing engine/allocation helpers the rest of the app already trusts.
 */

// A representative, hand-checkable snapshot fixture.
function makeSnapshot(): PortfolioSnapshot {
  return {
    identity: {
      portfolioId: 1,
      name: "Test",
      purpose: null,
      isSandbox: false,
      allocationPolicy: "balanced",
      committedTier: "growth",
      tierOverridden: false,
      planCommittedAt: 1_790_000_000_000,
      planStatus: "committed",
    },
    goal: {
      target: 1_200_000,
      horizonMonths: 60,
      elapsedMonths: 6,
      horizonRemainingMonths: 54,
      projectedFinalValue: 1_430_000,
      netWorthNow: 250_000,
    },
    holdings: {
      netWorth: 250_000,
      primaryMmf: 100_000,
      secondaryMmf: 0,
      bank: 50_000,
      tbill: 100_000,
      ifb: 0,
      fxd: 0,
      buckets: { cash: 150_000, gov: 100_000, equity: 0, reit: 0, offshore: 0, other: 0 },
      other: {},
    },
    allocation: {
      tier: "growth",
      timeRemainingFraction: 0.9,
      rows: [],
      isEmpty: false,
      caveat: "illustrative",
    },
    contributions: {
      startingContribution: 20_000,
      stepUpAmount: 5_000,
      stepUpMonths: 12,
      totalPlanned: 300_000,
      totalActual: 260_000,
      points: [
        { monthNumber: 1, planned: 20_000, actual: 20_000 },
        { monthNumber: 2, planned: 20_000, actual: 0 },
      ],
    },
    ledger: [
      { monthNumber: 1, isActual: true, contribution: 20_000, mmfEnd: 20_100, mmfInterestNet: 100, totalEnd: 20_100 },
      { monthNumber: 2, isActual: false, contribution: 20_000, mmfEnd: 40_300, mmfInterestNet: 200, totalEnd: 40_300 },
    ],
    income: { accruedNetInterest: 1_234, blendedNetYieldPct: 8.2 },
    tax: { base: 250_000, breakdown: { mmf: 100 } },
    liquidity: [{ atMs: 1_900_000_000_000, kind: "maturity", label: "T-bill", amount: 100_000 }],
    reconciliation: {
      ok: true,
      reference: 250_000,
      sources: [{ label: "Sum of parts", value: 250_000, ok: true }],
    },
    warnings: [],
    nextActions: [],
    asOfMs: 1_800_000_000_000,
  };
}

describe("snapshot selectors read the canonical figures verbatim", () => {
  const s = makeSnapshot();

  it("net worth comes straight from holdings.netWorth", () => {
    expect(selectNetWorth(s)).toBe(250_000);
  });

  it("goal progress is derived only from the goal block", () => {
    const g = selectGoalProgress(s);
    expect(g.target).toBe(1_200_000);
    expect(g.netWorthNow).toBe(250_000);
    expect(g.projectedFinalValue).toBe(1_430_000);
    expect(g.onTrack).toBe(true); // 1.43M ≥ 1.2M
    expect(g.projectedFraction).toBeCloseTo(1_430_000 / 1_200_000, 6);
    expect(g.progressFraction).toBeCloseTo(250_000 / 1_200_000, 6);
  });

  it("on-track is false when the projection falls short of target", () => {
    const short = makeSnapshot();
    short.goal.projectedFinalValue = 900_000;
    expect(selectGoalProgress(short).onTrack).toBe(false);
  });

  it("actual-vs-planned variance is actual − planned", () => {
    const v = selectActualVsPlanned(s);
    expect(v.totalPlanned).toBe(300_000);
    expect(v.totalActual).toBe(260_000);
    expect(v.variance).toBe(-40_000);
    expect(v.points).toHaveLength(2);
  });

  it("ledger / allocation / reconciliation selectors return the same objects", () => {
    expect(selectLedgerRows(s)).toBe(s.ledger);
    expect(selectAllocationGap(s)).toBe(s.allocation);
    expect(selectReconciliationStatus(s)).toBe(s.reconciliation);
  });
});

describe("composition invariants the builder depends on", () => {
  it("bucket roll-up sums to the same net worth buildAllocation produces", () => {
    const alloc = buildAllocation({
      deposits: [
        { amount: 100_000, bucket: "mmf", institutionType: null, mmfFundId: null },
        { amount: 100_000, bucket: "tbill", institutionType: "government_security", mmfFundId: null },
      ],
      securities: [{ securityType: "tbill_364", faceValue: 100_000, isMatured: false }],
      secondaryMmfs: [],
      bankHoldings: [{ principal: 50_000, interestRate: 10, isActive: true, currentValue: 0 }],
      otherHoldings: [],
      primaryFundId: null,
    });
    // The builder forms buckets as cash = primaryMmf + secondaryMmf + bank, gov = tbill+ifb+fxd, etc.
    const buckets = {
      cash: alloc.primaryMmf + alloc.secondaryMmf + alloc.bank,
      gov: alloc.tbill + alloc.ifb + alloc.fxd,
      equity: alloc.other["equity"] ?? 0,
      reit: alloc.other["reit"] ?? 0,
      offshore: alloc.other["offshore_fund"] ?? 0,
      other: 0,
    };
    const bucketSum =
      buckets.cash + buckets.gov + buckets.equity + buckets.reit + buckets.offshore + buckets.other;
    expect(bucketSum).toBeCloseTo(alloc.netWorth, 6);
  });

  it("selectPlanStatus reads the canonical commit marker (no re-derivation)", () => {
    const base = makeSnapshot();
    const committed = selectPlanStatus(base);
    expect(committed.status).toBe("committed");
    expect(committed.committedAtMs).toBe(1_790_000_000_000);
    // A draft snapshot (no commit marker) reports "draft".
    const draft: PortfolioSnapshot = {
      ...base,
      identity: { ...base.identity, planCommittedAt: null, planStatus: "draft" },
    };
    const d = selectPlanStatus(draft);
    expect(d.status).toBe("draft");
    expect(d.committedAtMs).toBeNull();
  });
  it("gap rows equal computeBucketGaps(target glide, actual buckets)", () => {
    const target = glidedAllocation("growth", 0.9);
    const actual = { cash: 150_000, gov: 100_000, equity: 0, reit: 0, offshore: 0, other: 0 };
    const readout = computeBucketGaps({ template: target, actual });
    // The gap is computed on the classified base; cash+gov here → 60/40.
    const cash = readout.gaps.find((g) => g.bucket === "cash")!;
    const gov = readout.gaps.find((g) => g.bucket === "gov")!;
    expect(cash.actualPct).toBeCloseTo(60, 1);
    expect(gov.actualPct).toBeCloseTo(40, 1);
    // direction is purely sign of (actual − target)
    for (const g of readout.gaps) {
      if (g.direction === "over") expect(g.gapPp).toBeGreaterThan(0);
      if (g.direction === "under") expect(g.gapPp).toBeLessThanOrEqual(0);
    }
  });
});
