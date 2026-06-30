/**
 * Cross-page integrity #2 — Other Assets net worth.
 *
 * Add a KES 200,000 equity holding and assert:
 *   - Dashboard headline full net worth includes it (selectDashboardHeadlineNetWorth);
 *   - the net-worth strip / Portfolio Review includes it (selectPortfolioReviewNetWorth);
 *   - the income/tax base does NOT include it unless income is recorded;
 *   - the Reconciliation full-net-worth section includes it.
 *
 * Also covers the goal-tagging distinction: an equity tagged out of the goal
 * raises full net worth but leaves Goal-plan assets (the Ledger basis) flat.
 */
import { describe, it, expect } from "vitest";
import {
  buildPortfolioState,
  snapshotFromState,
  pageSelectors,
  type RawRows,
} from "./fixtures";

function baseRows(): RawRows {
  return {
    deposits: [{ amount: 100_000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: 1 }],
    securities: [],
    secondaryMmfs: [],
    bankHoldings: [],
    otherHoldings: [],
    primaryFundId: 1,
    rates: { mmfYield: 15, tbill364Rate: 16, ifbCouponRate: 14, fxdCouponRate: 13, withholdingTax: 15 },
  };
}

const EQUITY = 200_000;

describe("Other Assets net worth (+200k equity)", () => {
  it("includes the equity in Dashboard headline, Review and Reconciliation, but not the tax base", () => {
    const before = buildPortfolioState(baseRows());
    const rows = baseRows();
    rows.otherHoldings.push({ assetClass: "equity", currentValue: EQUITY, includeInGoal: true } as RawRows["otherHoldings"][number]);
    const after = buildPortfolioState(rows);

    const beforeSnap = snapshotFromState(before);
    const afterSnap = snapshotFromState(after);

    // Dashboard headline full net worth includes it.
    expect(pageSelectors.dashboardHeadline(afterSnap)).toBeCloseTo(
      pageSelectors.dashboardHeadline(beforeSnap) + EQUITY,
      2,
    );
    // Portfolio Review (net-worth strip) includes it.
    expect(pageSelectors.portfolioReview(afterSnap)).toBeCloseTo(
      pageSelectors.portfolioReview(beforeSnap) + EQUITY,
      2,
    );
    // Income/tax base is unchanged — no income recorded against the equity.
    expect(after.incomeTaxBase).toBeCloseTo(before.incomeTaxBase, 2);
    // Reconciliation full-net-worth reference includes it.
    expect(after.recon.reference).toBeCloseTo(before.recon.reference + EQUITY, 2);
    expect(after.recon.reconciled).toBe(true);
  });

  it("an equity tagged OUT of the goal raises full net worth but leaves Goal-plan (Ledger basis) flat", () => {
    const before = buildPortfolioState(baseRows());
    const rows = baseRows();
    rows.otherHoldings.push({ assetClass: "equity", currentValue: EQUITY, includeInGoal: false } as RawRows["otherHoldings"][number]);
    const after = buildPortfolioState(rows);

    const afterSnap = snapshotFromState(after);
    const beforeSnap = snapshotFromState(before);

    // Full net worth (Dashboard headline) rises by the equity.
    expect(pageSelectors.dashboardHeadline(afterSnap)).toBeCloseTo(
      pageSelectors.dashboardHeadline(beforeSnap) + EQUITY,
      2,
    );
    // Goal-plan assets (the Ledger-today comparable basis) stay flat.
    expect(pageSelectors.goalPlan(afterSnap)).toBeCloseTo(pageSelectors.goalPlan(beforeSnap), 2);
    expect(pageSelectors.ledgerTodayComparable(afterSnap)).toBeCloseTo(
      pageSelectors.ledgerTodayComparable(beforeSnap),
      2,
    );
    // The two bases now differ by exactly the excluded equity.
    expect(
      pageSelectors.dashboardHeadline(afterSnap) - pageSelectors.goalPlan(afterSnap),
    ).toBeCloseTo(EQUITY, 2);
  });

  it("Dashboard headline equals the Reconciliation reference once the equity is added", () => {
    const rows = baseRows();
    rows.otherHoldings.push({ assetClass: "equity", currentValue: EQUITY, includeInGoal: true } as RawRows["otherHoldings"][number]);
    const after = buildPortfolioState(rows);
    const snap = snapshotFromState(after);
    expect(pageSelectors.dashboardHeadline(snap)).toBeCloseTo(after.recon.reference, 2);
  });
});
