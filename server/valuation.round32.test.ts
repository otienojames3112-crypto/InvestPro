import { describe, it, expect } from "vitest";
import { buildAllocation, blendedYield } from "../shared/actuals";
import { reconcile } from "../shared/reconciliation";

/**
 * Round 32 — one shared valuation path.
 *
 * These tests pin the two structural fixes from the audit:
 *  1. Portfolio Review no longer double-counts secondary-MMF deposits.
 *  2. Tax Summary's blended net yield is computed on the same base as gross,
 *     so it can never exceed gross or sit implausibly far below it.
 *
 * Most importantly, they prove the reconciliation cross-check is REAL: when a
 * page's shared math drifts (a double-count creeps back in), the corresponding
 * reconciliation row turns red instead of silently agreeing.
 */

// A representative portfolio mirroring the sandbox sample:
//   primary MMF 41,000 + secondary MMF 2,500 + bank deposit 100,000 = 143,500.
// The secondary fund (id 7) is ALSO recorded as a deposit row (bucket "mmf",
// institutionType "mmf_fund") — exactly the row that used to be double-counted.
const SECONDARY_FUND_ID = 7;

const deposits = [
  { amount: 41000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: 1 }, // primary
  { amount: 2500, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: SECONDARY_FUND_ID }, // secondary (must NOT add to primary)
];
const securities: { securityType: string; faceValue: number; isMatured?: boolean }[] = [];
const secondaryMmfs = [{ mmfFundId: SECONDARY_FUND_ID, currentBalance: 2500, ear: 8.82 }];
const bankHoldings = [
  { principal: 100000, interestRate: 10, isActive: true, currentValue: 0 },
];
const otherHoldings: { assetClass: string; currentValue: number }[] = [];

describe("buildAllocation — no double count", () => {
  it("keeps secondary-MMF deposit rows out of the primary bucket", () => {
    const a = buildAllocation({ deposits, securities, secondaryMmfs, bankHoldings, otherHoldings });
    expect(a.primaryMmf).toBe(41000); // NOT 43,500
    expect(a.secondaryMmf).toBe(2500);
    expect(a.bank).toBe(100000);
  });

  it("net worth equals the true sum of parts (143,500, not 146,000)", () => {
    const a = buildAllocation({ deposits, securities, secondaryMmfs, bankHoldings, otherHoldings });
    expect(a.netWorth).toBe(143500);
  });

  it("includes other assets in net worth when present", () => {
    const a = buildAllocation({
      deposits,
      securities,
      secondaryMmfs,
      bankHoldings,
      otherHoldings: [{ assetClass: "equity", currentValue: 50000 }],
    });
    expect(a.netWorth).toBe(193500);
    expect(a.other.equity).toBe(50000);
  });
});

describe("blendedYield — net is computed on the same base as gross", () => {
  it("net yield is below gross by the WHT drag and never exceeds gross", () => {
    const b = blendedYield({
      primaryMmf: 41000,
      primaryMmfRate: 13.54,
      secondaryMmfs: [{ balance: 2500, rate: 8.82 }],
      bankHoldings: [{ value: 100000, rate: 10 }],
      securities: [],
      whtRate: 15,
    });
    expect(b.base).toBe(143500);
    // All components here are taxable at 15%, so net == gross * 0.85 exactly.
    expect(b.netYield).toBeCloseTo(b.grossYield * 0.85, 6);
    expect(b.netYield).toBeLessThan(b.grossYield);
    // Drag for a pure-15% book is ~1.5pp on a ~10.6% gross — NOT 7.48pp.
    expect(b.taxDrag).toBeLessThan(2);
  });

  it("tax-exempt IFB lifts net yield toward gross", () => {
    const taxable = blendedYield({
      primaryMmf: 0, primaryMmfRate: 0, secondaryMmfs: [], bankHoldings: [],
      securities: [{ value: 100000, rate: 12, taxExempt: false }], whtRate: 15,
    });
    const exempt = blendedYield({
      primaryMmf: 0, primaryMmfRate: 0, secondaryMmfs: [], bankHoldings: [],
      securities: [{ value: 100000, rate: 12, taxExempt: true }], whtRate: 15,
    });
    expect(exempt.netYield).toBeGreaterThan(taxable.netYield);
    expect(exempt.netYield).toBeCloseTo(exempt.grossYield, 6); // exempt: net == gross
  });
});

describe("reconciliation is a real cross-check, not a tautology", () => {
  // Helper: build recon inputs the SAME way the server procedure does, deriving
  // the page sources from buildAllocation/blendedYield (principal basis).
  function buildInputs(opts: { breakPage?: boolean } = {}) {
    const alloc = buildAllocation({ deposits, securities, secondaryMmfs, bankHoldings, otherHoldings });
    const otherTotal = Object.values(alloc.other).reduce((a, b) => a + b, 0);

    // Simulate a regression: a page that double-counts the secondary deposit.
    const brokenAlloc = opts.breakPage
      ? alloc.netWorth - otherTotal + 2500 // the classic +2,500 double count
      : alloc.netWorth - otherTotal;

    const primaryMmfBalance = alloc.primaryMmf;
    const secondaryMmfBalances = [2500];
    const bankHoldingPrincipals = [100000];
    const securityFaceValues: number[] = [];

    return {
      primaryMmfBalance,
      secondaryMmfBalances,
      bankHoldingPrincipals,
      securityFaceValues,
      otherAssetValues: [],
      projectionTodayValue: 143500,
      dashboardActualsTotal: 143500,
      accrualLedgerMmfTotal: primaryMmfBalance + 2500,
      dashboardNetWorth: 143500,
      portfolioReviewNetWorth: brokenAlloc,
      taxSummaryBase: 143500,
    };
  }

  it("all sources reconcile green for a consistent portfolio", () => {
    const r = reconcile(buildInputs());
    expect(r.reference).toBe(143500);
    expect(r.reconciled).toBe(true);
    expect(r.mismatches).toHaveLength(0);
  });

  it("a double-count in the Portfolio Review math turns its row red", () => {
    const r = reconcile(buildInputs({ breakPage: true }));
    expect(r.reconciled).toBe(false);
    const flagged = r.mismatches.find((m) => m.key === "portfolioReview");
    expect(flagged).toBeDefined();
    expect(flagged!.diff).toBe(2500);
  });
});
