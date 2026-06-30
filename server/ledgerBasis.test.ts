import { describe, it, expect } from "vitest";
import { compareLedgerBases } from "../shared/reconciliation";

/**
 * Ledger "Total" basis-ambiguity fix.
 *
 * The Ledger Total follows the GOAL-PLAN scope; Dashboard + Portfolio Review show
 * FULL net worth. The two are EXPECTED to differ by exactly the value of Other
 * Assets tagged OUT of the goal. These tests prove the comparison helper labels
 * that gap as "explained" (not a discrepancy) and flips when it doesn't add up.
 */
describe("compareLedgerBases", () => {
  it("acceptance 1 — no goal-excluded assets: Ledger == Dashboard, gap is zero and explained", () => {
    const r = compareLedgerBases({
      ledgerActualValue: 1_000_000,
      ledgerComparable: 1_000_000,
      dashboardNetWorth: 1_000_000,
      portfolioReviewNetWorth: 1_000_000,
      goalPlanAssets: 1_000_000,
      otherAssetsExcludedFromGoal: 0,
    });
    expect(r.fullVsGoalGap).toBe(0);
    expect(r.expectedGap).toBe(0);
    expect(r.gapExplained).toBe(true);
    expect(r.ledgerMatchesGoalBasis).toBe(true);
    expect(r.dashboardMatchesReview).toBe(true);
  });

  it("acceptance 2 — a 200k asset tagged OUT of goal: Dashboard exceeds goal-plan by exactly 200k, and that gap is explained", () => {
    const goalPlan = 1_000_000;
    const excluded = 200_000;
    const r = compareLedgerBases({
      ledgerActualValue: goalPlan, // Ledger follows the goal-plan basis
      ledgerComparable: goalPlan,
      dashboardNetWorth: goalPlan + excluded, // full net worth includes the 200k
      portfolioReviewNetWorth: goalPlan + excluded,
      goalPlanAssets: goalPlan,
      otherAssetsExcludedFromGoal: excluded,
    });
    expect(r.fullVsGoalGap).toBe(200_000);
    expect(r.expectedGap).toBe(200_000);
    expect(r.gapExplained).toBe(true);
    expect(r.ledgerMatchesGoalBasis).toBe(true);
  });

  it("flags an UNEXPLAINED gap when full-vs-goal does not equal the excluded value", () => {
    const r = compareLedgerBases({
      ledgerActualValue: 1_000_000,
      ledgerComparable: 1_000_000,
      dashboardNetWorth: 1_350_000, // 350k higher
      portfolioReviewNetWorth: 1_350_000,
      goalPlanAssets: 1_000_000,
      otherAssetsExcludedFromGoal: 200_000, // but only 200k is tagged out
    });
    expect(r.fullVsGoalGap).toBe(350_000);
    expect(r.expectedGap).toBe(200_000);
    expect(r.gapExplained).toBe(false); // 150k is unexplained → turns red
  });

  it("flags when the Ledger actual row drifts off the goal-plan basis", () => {
    const r = compareLedgerBases({
      ledgerActualValue: 980_000, // 20k below the comparable
      ledgerComparable: 1_000_000,
      dashboardNetWorth: 1_000_000,
      portfolioReviewNetWorth: 1_000_000,
      goalPlanAssets: 1_000_000,
      otherAssetsExcludedFromGoal: 0,
    });
    expect(r.ledgerMatchesGoalBasis).toBe(false);
  });

  it("flags when Dashboard and Portfolio Review disagree (a page dropped a pocket)", () => {
    const r = compareLedgerBases({
      ledgerActualValue: null,
      ledgerComparable: 1_000_000,
      dashboardNetWorth: 1_200_000,
      portfolioReviewNetWorth: 1_000_000, // Review silently omitted 200k
      goalPlanAssets: 1_000_000,
      otherAssetsExcludedFromGoal: 200_000,
    });
    expect(r.dashboardMatchesReview).toBe(false);
  });

  it("treats a null Ledger actual (nothing recorded yet) as basis-matching", () => {
    const r = compareLedgerBases({
      ledgerActualValue: null,
      ledgerComparable: 1_000_000,
      dashboardNetWorth: 1_000_000,
      portfolioReviewNetWorth: 1_000_000,
      goalPlanAssets: 1_000_000,
      otherAssetsExcludedFromGoal: 0,
    });
    expect(r.ledgerMatchesGoalBasis).toBe(true);
  });

  it("tolerates sub-5 KES rounding slack in the gap", () => {
    const r = compareLedgerBases({
      ledgerActualValue: 1_000_000,
      ledgerComparable: 1_000_000,
      dashboardNetWorth: 1_200_003, // 3 KES of rounding noise
      portfolioReviewNetWorth: 1_200_003,
      goalPlanAssets: 1_000_000,
      otherAssetsExcludedFromGoal: 200_000,
    });
    expect(r.gapExplained).toBe(true);
  });
});
