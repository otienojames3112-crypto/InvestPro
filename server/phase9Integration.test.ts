import { describe, it, expect } from "vitest";
import {
  LEGACY_REDIRECTS,
  buildRedirectTarget,
  type LegacyRedirect,
} from "@shared/legacyRoutes";
import { buildAllocation } from "@shared/actuals";
import { reconcile } from "@shared/reconciliation";
import { glidedAllocation, ALLOCATION_TIERS, type AllocationTier } from "@shared/allocationModel";

/**
 * Phase 9 — cross-surface integration invariants.
 *
 * These are DB-free: they exercise the SAME pure helpers every page composes from
 * (buildAllocation, reconcile, glidedAllocation) plus the canonical legacy-route
 * map App.tsx renders. The point is to prove the surfaces cannot silently disagree:
 * one deposit must move every net-worth source together, the commit tier must drive
 * the same glide everywhere, reconciliation must go red the instant one page total
 * drifts, and every old URL must forward to a real area+tab.
 */

/* ───────────────────────── 1. Legacy redirect coverage ───────────────────────── */

describe("legacy route redirects forward every old URL to a real area + tab", () => {
  const VALID_AREAS = new Set(["plan", "cashflows", "holdings", "research", "review"]);

  it("every redirect targets a known area and a non-empty tab", () => {
    for (const r of LEGACY_REDIRECTS) {
      expect(VALID_AREAS.has(r.area), `${r.from} → unknown area ${r.area}`).toBe(true);
      expect(r.tab.length, `${r.from} has empty tab`).toBeGreaterThan(0);
      expect(r.from.startsWith("/"), `${r.from} must be absolute`).toBe(true);
    }
  });

  it("has no duplicate source paths (each old URL forwards exactly once)", () => {
    const froms = LEGACY_REDIRECTS.map((r) => r.from);
    expect(new Set(froms).size).toBe(froms.length);
  });

  it("covers the full set of consolidated areas", () => {
    const areas = new Set(LEGACY_REDIRECTS.map((r) => r.area));
    expect(areas).toEqual(VALID_AREAS);
  });

  it("builds a target that sets the tab param", () => {
    const r: LegacyRedirect = { from: "/ledger", area: "plan", tab: "ledger" };
    expect(buildRedirectTarget(r)).toBe("/plan?tab=ledger");
  });

  it("preserves extra query params from the old deep-link (e.g. ?class=)", () => {
    const r: LegacyRedirect = { from: "/explore", area: "research", tab: "all-approved" };
    const target = buildRedirectTarget(r, "class=equity&foo=bar");
    const url = new URL(target, "https://x.test");
    expect(url.pathname).toBe("/research");
    expect(url.searchParams.get("tab")).toBe("all-approved");
    expect(url.searchParams.get("class")).toBe("equity");
    expect(url.searchParams.get("foo")).toBe("bar");
  });

  it("rewrites a stale tab param to the canonical one", () => {
    const r: LegacyRedirect = { from: "/scenarios", area: "plan", tab: "scenarios" };
    // Old URL already carried tab=wrong — the canonical tab must win.
    expect(buildRedirectTarget(r, "tab=wrong")).toBe("/plan?tab=scenarios");
  });
});

/* ───────────────────────── 2. Deposit fan-out ───────────────────────── */

describe("a single deposit moves every net-worth source together", () => {
  function allocFor(mmfAmount: number) {
    return buildAllocation({
      deposits: [{ amount: mmfAmount, bucket: "mmf", institutionType: null, mmfFundId: null }],
      securities: [{ securityType: "tbill_364", faceValue: 100_000, isMatured: false }],
      secondaryMmfs: [],
      bankHoldings: [{ principal: 50_000, interestRate: 10, isActive: true, currentValue: 0 }],
      otherHoldings: [],
      primaryFundId: null,
    });
  }

  it("net worth rises by exactly the deposit amount", () => {
    const before = allocFor(100_000);
    const after = allocFor(150_000);
    expect(after.netWorth - before.netWorth).toBeCloseTo(50_000, 6);
    expect(after.primaryMmf - before.primaryMmf).toBeCloseTo(50_000, 6);
  });

  it("the new net worth still equals the sum of its parts", () => {
    const a = allocFor(150_000);
    const parts = a.primaryMmf + a.secondaryMmf + a.tbill + a.ifb + a.fxd + a.bank +
      Object.values(a.other).reduce((x, y) => x + y, 0);
    expect(parts).toBeCloseTo(a.netWorth, 6);
  });

  it("reconciliation derived from that allocation is green for all page totals", () => {
    const a = allocFor(150_000);
    const r = reconcile({
      primaryMmfBalance: a.primaryMmf,
      secondaryMmfBalances: [],
      bankHoldingPrincipals: [a.bank],
      securityFaceValues: [a.tbill],
      otherAssetValues: [],
      projectionTodayValue: a.netWorth,
      dashboardActualsTotal: a.netWorth,
      accrualLedgerMmfTotal: a.primaryMmf,
      dashboardNetWorth: a.netWorth,
      portfolioReviewNetWorth: a.netWorth,
      // taxSummaryBase is intentionally a PARTIAL (fixed-income + bank) figure, not
      // a full net-worth source, so it is omitted from this net-worth reconciliation.
    });
    expect(r.reconciled).toBe(true);
    expect(r.reference).toBeCloseTo(a.netWorth, 2);
  });
});

/* ───────────────────────── 3. Reconciliation catches a drifting page ───────────────────────── */

describe("reconciliation fails the instant one page total differs from canonical", () => {
  const base = {
    primaryMmfBalance: 100_000,
    secondaryMmfBalances: [] as number[],
    bankHoldingPrincipals: [50_000],
    securityFaceValues: [100_000],
    otherAssetValues: [] as number[],
    projectionTodayValue: 250_000,
    dashboardActualsTotal: 250_000,
    accrualLedgerMmfTotal: 100_000,
    dashboardNetWorth: 250_000,
    portfolioReviewNetWorth: 250_000,
  };

  it("is green when every source agrees", () => {
    expect(reconcile(base).reconciled).toBe(true);
  });

  it("flags the Portfolio Review page when it omits a pocket (the classic bank-deposit bug)", () => {
    // Portfolio Review forgets the 50k bank deposit → 200k instead of 250k.
    const r = reconcile({ ...base, portfolioReviewNetWorth: 200_000 });
    expect(r.reconciled).toBe(false);
    expect(r.mismatches.some((m) => m.key === "portfolioReview")).toBe(true);
  });

  it("tolerates sub-5-KES rounding slack", () => {
    expect(reconcile({ ...base, dashboardNetWorth: 250_003 }).reconciled).toBe(true);
  });
});

/* ───────────────────────── 4. Commit tier drives the same glide everywhere ───────────────────────── */

describe("the committed tier produces one glide every surface shares", () => {
  it("each tier's glide sums to 100% (a valid template the Plan + Dashboard both read)", () => {
    for (const tier of ALLOCATION_TIERS) {
      const g = glidedAllocation(tier as AllocationTier, 0.8);
      const sum = Object.values(g).reduce((a, b) => a + b, 0);
      expect(sum, `${tier} glide must sum to 100`).toBeCloseTo(100, 2);
    }
  });

  it("the same tier + time-remaining is deterministic (Plan, Scenarios, Dashboard agree)", () => {
    expect(glidedAllocation("balanced", 0.8)).toEqual(glidedAllocation("balanced", 0.8));
  });

  it("a more aggressive tier never holds more cash than a safer one at the same horizon", () => {
    const safe = glidedAllocation("capital_preservation", 0.8);
    const bold = glidedAllocation("aggressive", 0.8);
    const cashSafe = safe.cash ?? 0;
    const cashBold = bold.cash ?? 0;
    expect(cashBold).toBeLessThanOrEqual(cashSafe);
  });
});
