/**
 * Cross-page integrity #4 — Reconciliation honesty ("no green-badge theater").
 *
 * Force ONE page's selector to return a different value in the fixture and
 * assert Reconciliation turns red. This proves the badge is wired to the real
 * page values, not hard-coded green.
 */
import { describe, it, expect } from "vitest";
import { reconcile, type ReconInputs } from "../../shared/reconciliation";

function honestInputs(): ReconInputs {
  return {
    // Sum of parts = 100k + 80k + 200k + 120k + 300k + 200k = 1,000,000.
    primaryMmfBalance: 100_000,
    secondaryMmfBalances: [80_000],
    bankHoldingPrincipals: [200_000],
    securityFaceValues: [120_000, 300_000],
    otherAssetValues: [200_000],
    projectionTodayValue: 1_000_000,
    dashboardActualsTotal: 1_000_000,
    accrualLedgerMmfTotal: 180_000,
    dashboardNetWorth: 1_000_000,
    portfolioReviewNetWorth: 1_000_000,
    // taxSummaryBase omitted: on the live page it is a separate fixed-income
    // blend, not part of the full-net-worth verdict (a non-income asset makes it
    // legitimately differ). Including it here would falsely fail the baseline.
  };
}

describe("reconciliation honesty (no green-badge theater)", () => {
  it("all-consistent inputs reconcile green", () => {
    const r = reconcile(honestInputs());
    expect(r.reconciled).toBe(true);
    expect(r.mismatches).toHaveLength(0);
  });

  it("a drifted Portfolio Review total turns the badge red and names the source", () => {
    const inputs = honestInputs();
    inputs.portfolioReviewNetWorth = 1_000_000 + 50_000; // one page lies by 50k
    const r = reconcile(inputs);
    expect(r.reconciled).toBe(false);
    expect(r.mismatches.map((m) => m.key)).toContain("portfolioReview");
  });

  it("a drifted Dashboard net worth turns the badge red", () => {
    const inputs = honestInputs();
    inputs.dashboardNetWorth = 900_000; // dashboard understates by 100k
    const r = reconcile(inputs);
    expect(r.reconciled).toBe(false);
    expect(r.mismatches.map((m) => m.key)).toContain("netWorth");
  });

  it("a drifted engine projection turns the badge red", () => {
    const inputs = honestInputs();
    inputs.projectionTodayValue = 1_000_000 + 10_000;
    const r = reconcile(inputs);
    expect(r.reconciled).toBe(false);
    expect(r.mismatches.map((m) => m.key)).toContain("projection");
  });

  it("a tiny rounding-level difference (<= tolerance) stays green", () => {
    const inputs = honestInputs();
    inputs.dashboardNetWorth = 1_000_000 + 3; // within RECON_TOLERANCE_KES (5)
    const r = reconcile(inputs);
    expect(r.reconciled).toBe(true);
  });
});
