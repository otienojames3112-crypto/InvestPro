/**
 * Independent reconciliation of a portfolio's "today" value across all subsystems.
 *
 * Each source is computed from its OWN data path; they must agree within TOLERANCE.
 * The whole point is to catch when the live valuation paths (computeActualsTotals,
 * runProjection, the accrual base) disagree — so this file must NOT invent a new
 * valuation. It only compares numbers the live pages already produce.
 *
 * Keep this free of React / DOM / tRPC imports so it stays trivially testable.
 */

export const RECON_TOLERANCE_KES = 5; // rounding slack

export interface ReconSource {
  key: string;
  label: string;
  value: number;
  detail: string;
}

export interface ReconResult {
  sources: ReconSource[];
  maxDiff: number;
  reconciled: boolean;
  mismatches: Array<{ key: string; label: string; diff: number }>;
  reference: number; // the value all others are compared against
}

export interface ReconInputs {
  // 1. Component holdings (the "sum of parts" net worth)
  primaryMmfBalance: number; // primary MMF balance today
  secondaryMmfBalances: number[]; // each tracked secondary MMF balance
  bankHoldingPrincipals: number[]; // each active bank instrument principal/current value
  securityFaceValues: number[]; // each active CBK register security face/current value
  otherAssetValues: number[]; // equities/real estate current values (if included in net worth)

  // 2. Engine projection value at the current month
  projectionTodayValue: number;

  // 3. Dashboard actuals aggregation (computeActualsTotals "total held today")
  dashboardActualsTotal: number;

  // 4. Daily-accrual ledger MMF base (primary + secondaries), summed
  accrualLedgerMmfTotal: number;

  // 5. Net worth as displayed on the dashboard "Live Net Worth" card
  dashboardNetWorth: number;

  // 6. Net worth as displayed on the Portfolio Review page (sum of allocation rows).
  //    Round 30: every page that shows a portfolio total is a reconciled source,
  //    so a page that silently omits a pocket (the bank-deposit bug) is flagged red.
  portfolioReviewNetWorth?: number;

  // 7. Fixed-income + bank base the Tax Summary blends yield across.
  taxSummaryBase?: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function reconcile(inputs: ReconInputs): ReconResult {
  const sumParts =
    inputs.primaryMmfBalance +
    inputs.secondaryMmfBalances.reduce((a, b) => a + b, 0) +
    inputs.bankHoldingPrincipals.reduce((a, b) => a + b, 0) +
    inputs.securityFaceValues.reduce((a, b) => a + b, 0) +
    inputs.otherAssetValues.reduce((a, b) => a + b, 0);

  const sources: ReconSource[] = [
    {
      key: "sumParts",
      label: "Sum of all holdings (net worth from parts)",
      value: round2(sumParts),
      detail: "Primary MMF + secondary MMFs + bank deposits + CBK securities + other assets",
    },
    {
      key: "projection",
      label: "Engine projection value (today)",
      value: round2(inputs.projectionTodayValue),
      detail: "runProjection totalEnd at the current actual month",
    },
    {
      key: "dashboardActuals",
      label: "Dashboard 'total held today'",
      value: round2(inputs.dashboardActualsTotal),
      detail: "computeActualsTotals aggregation",
    },
    {
      key: "accrual",
      label: "Daily-accrual MMF base (summed)",
      value: round2(inputs.accrualLedgerMmfTotal),
      detail: "Per-fund accrual ledger starting balance — MMF portion only",
    },
    {
      key: "netWorth",
      label: "Dashboard 'Live Net Worth' card",
      value: round2(inputs.dashboardNetWorth),
      detail: "Headline net-worth figure",
    },
  ];

  // Round 30: include the Portfolio Review and Tax Summary page totals as their
  // own reconciled sources. They are derived from the same sum-of-parts helper,
  // so they reconcile green; if either page ever omits a pocket again, its row
  // turns red here instead of giving false assurance.
  if (typeof inputs.portfolioReviewNetWorth === "number") {
    sources.push({
      key: "portfolioReview",
      label: "Portfolio Review net-worth allocation",
      value: round2(inputs.portfolioReviewNetWorth),
      detail: "Sum of the allocation rows (MMF + CBK + bank deposits + other assets)",
    });
  }
  if (typeof inputs.taxSummaryBase === "number") {
    sources.push({
      key: "taxSummary",
      label: "Tax Summary blended-yield base",
      value: round2(inputs.taxSummaryBase),
      detail: "Fixed-income + bank base the Tax Summary blends yield across",
    });
  }

  // Compare everything to the "sum of parts" reference.
  const reference = round2(sumParts);

  // The accrual source is MMF-only; reconcile it against the MMF subtotal
  // separately (see reconcileMmf), not the whole portfolio.
  const fullPortfolioSources = sources.filter((s) => s.key !== "accrual");
  const mismatches = fullPortfolioSources
    .filter((s) => Math.abs(s.value - reference) > RECON_TOLERANCE_KES)
    .map((s) => ({ key: s.key, label: s.label, diff: round2(s.value - reference) }));

  const maxDiff = Math.max(0, ...fullPortfolioSources.map((s) => Math.abs(s.value - reference)));

  return {
    sources,
    maxDiff: round2(maxDiff),
    reconciled: mismatches.length === 0,
    mismatches,
    reference,
  };
}

/**
 * Separate MMF-only check so the accrual ledger base can be validated against the
 * MMF subtotal rather than the whole portfolio.
 */
export function reconcileMmf(
  accrualLedgerMmfTotal: number,
  primaryMmfBalance: number,
  secondaryMmfBalances: number[],
): { mmfSubtotal: number; accrual: number; diff: number; ok: boolean } {
  const mmfSubtotal = primaryMmfBalance + secondaryMmfBalances.reduce((a, b) => a + b, 0);
  const diff = round2(accrualLedgerMmfTotal - mmfSubtotal);
  return {
    mmfSubtotal: round2(mmfSubtotal),
    accrual: round2(accrualLedgerMmfTotal),
    diff,
    ok: Math.abs(diff) <= RECON_TOLERANCE_KES,
  };
}

/**
 * Round 39 — government-securities sub-check.
 *
 * Cross-checks the CBK register (the single source of truth) against the
 * government-security DEPOSITS that are supposed to have created it. Every
 * gov-security deposit auto-creates exactly one linked register row at the same
 * face value, so the sum of live register face values must equal the sum of
 * (non-matured) linked gov-security deposit amounts. A mismatch means a deposit
 * lost its register link, or a register lot was edited without syncing its
 * deposit — the exact double-count / orphan bugs this guard exists to catch.
 */
export interface ReconGovResult {
  registerFaceTotal: number;
  linkedDepositTotal: number;
  diff: number;
  ok: boolean;
}

export function reconcileGov(
  registerFaceValues: number[],
  linkedGovDepositAmounts: number[],
): ReconGovResult {
  const registerFaceTotal = round2(registerFaceValues.reduce((a, b) => a + b, 0));
  const linkedDepositTotal = round2(linkedGovDepositAmounts.reduce((a, b) => a + b, 0));
  const diff = round2(registerFaceTotal - linkedDepositTotal);
  return {
    registerFaceTotal,
    linkedDepositTotal,
    diff,
    ok: Math.abs(diff) <= RECON_TOLERANCE_KES,
  };
}

/**
 * Round 39 — bank-instruments sub-check.
 *
 * The sum of active bank-instrument principals (as the Dashboard/Portfolio
 * Review value them) must equal the sum of bank-instrument deposits net of
 * bank-instrument withdrawals. If a deposit increased a holding's principal but
 * the holding total drifts, this row turns red.
 */
export interface ReconBankResult {
  holdingPrincipalTotal: number;
  netDepositTotal: number;
  diff: number;
  ok: boolean;
}

export function reconcileBank(
  bankHoldingPrincipals: number[],
  bankDepositAmounts: number[],
  bankWithdrawalAmounts: number[],
): ReconBankResult {
  const holdingPrincipalTotal = round2(bankHoldingPrincipals.reduce((a, b) => a + b, 0));
  const deposits = bankDepositAmounts.reduce((a, b) => a + b, 0);
  const withdrawals = bankWithdrawalAmounts.reduce((a, b) => a + b, 0);
  const netDepositTotal = round2(deposits - withdrawals);
  const diff = round2(holdingPrincipalTotal - netDepositTotal);
  return {
    holdingPrincipalTotal,
    netDepositTotal,
    diff,
    ok: Math.abs(diff) <= RECON_TOLERANCE_KES,
  };
}

/**
 * Expansion Brief Part 5 — phantom-holding sub-check.
 *
 * Every tracked "other holding" (equities / REITs / offshore / property / any
 * non-core asset) is valued ONCE by the shared `valueHolding` mark-to-model
 * source and that value is what `buildAllocation` folds into net worth. This
 * guard proves the two agree: the sum of the per-holding mark-to-model values
 * MUST equal the other-assets total the allocation engine actually counted. If a
 * holding is counted in net worth but the proof can't see it (a class that was
 * added without being wired through valuation), or is valued on a stale
 * `currentValue` instead of units × price × FX, this row turns red.
 *
 * It also asserts COVERAGE: `valuedCount` must equal `heldCount`. A held row the
 * valuation source returns nothing for is a phantom holding and fails the check.
 */
export interface ReconHoldingsResult {
  /** Sum of per-holding mark-to-model (or stored) values. */
  markToModelTotal: number;
  /** Other-assets total the allocation engine folded into net worth. */
  allocationOtherTotal: number;
  diff: number;
  heldCount: number;
  valuedCount: number;
  ok: boolean;
}

export function reconcileHoldings(
  perHoldingValues: number[],
  allocationOtherTotal: number,
  heldCount: number,
): ReconHoldingsResult {
  const markToModelTotal = round2(perHoldingValues.reduce((a, b) => a + b, 0));
  const diff = round2(markToModelTotal - round2(allocationOtherTotal));
  const valuedCount = perHoldingValues.length;
  return {
    markToModelTotal,
    allocationOtherTotal: round2(allocationOtherTotal),
    diff,
    heldCount,
    valuedCount,
    ok: Math.abs(diff) <= RECON_TOLERANCE_KES && valuedCount === heldCount,
  };
}

/**
 * Plan-to-ledger contract check. The tier the projection engine ACTUALLY used
 * to build the ledger (`policyTierUsed`) must equal the tier the user committed
 * and sees on the Allocation Plan (`committedTier`). If they diverge, a page is
 * showing a probability/headline from one model while the Ledger follows
 * another — the exact silent disagreement this check exists to surface.
 *
 * `committed` is false when the plan has never been committed; in that state the
 * Ledger legitimately runs the default path and this is a benign "preview"
 * state, not a mismatch — so `ok` stays true while `committed` is false.
 */
export interface ReconPlanPolicyResult {
  committed: boolean;
  committedTier: string;
  policyTierUsed: string;
  ok: boolean;
}

export function reconcilePlanPolicy(args: {
  committed: boolean;
  committedTier: string | null;
  policyTierUsed: string;
}): ReconPlanPolicyResult {
  const committedTier = args.committedTier ?? "balanced";
  // Before commit, the engine runs the default path on purpose — not a drift.
  const ok = !args.committed || committedTier === args.policyTierUsed;
  return {
    committed: args.committed,
    committedTier,
    policyTierUsed: args.policyTierUsed,
    ok,
  };
}

/**
 * Round 40 (R40.6) — accrued-interest + WHT reconciliation sub-checks.
 *
 * The Daily Accrual page renders a day-by-day schedule (built by
 * buildSecurityDailySchedule / buildBankDailySchedule) and the Tax Summary page
 * estimates WHT. These two must agree with an INDEPENDENT closed-form expectation
 * computed straight from the instrument parameters (annual gross × days ÷ 365,
 * with the right WHT tier). If the schedule engine ever drifts from the simple
 * expectation — a rate misread, a wrong WHT tier, a double-count — the relevant
 * row turns red instead of silently mis-stating tax owed.
 *
 * Each input row carries its base, gross rate %, WHT rate % and whether it is
 * tax-exempt; we compute expected gross/WHT over the window and diff against the
 * schedule totals the page actually displays.
 */

export interface AccrualReconItem {
  /** Face value (gov) or principal (bank) the interest is earned on. */
  base: number;
  /** Annual gross rate, %. */
  ratePct: number;
  /** WHT rate, % (0 for IFB / tax-exempt). */
  whtPct: number;
  /** For bank instruments on a 360-day basis; defaults to 365. */
  dayCountBasis?: number;
}

export interface AccrualReconResult {
  expectedGross: number;
  expectedWht: number;
  scheduleGross: number;
  scheduleWht: number;
  grossDiff: number;
  whtDiff: number;
  ok: boolean;
}

/**
 * Independent closed-form accrued gross + WHT over `days` for a set of items.
 * Gov securities use a flat 365 basis; bank instruments may use 360.
 */
export function expectedAccrual(
  items: AccrualReconItem[],
  days: number,
): { gross: number; wht: number } {
  const n = Math.max(0, days);
  let gross = 0;
  let wht = 0;
  for (const it of items) {
    const base = Math.max(0, it.base);
    const ratePct = Math.max(0, it.ratePct);
    const dayCount = it.dayCountBasis && it.dayCountBasis > 0 ? it.dayCountBasis : 365;
    const grossAnnual = base * (ratePct / 100) * (365 / dayCount);
    const whtAnnual = grossAnnual * (Math.max(0, it.whtPct) / 100);
    gross += (grossAnnual * n) / 365;
    wht += (whtAnnual * n) / 365;
  }
  return { gross: round2(gross), wht: round2(wht) };
}

/**
 * Compare a day-by-day schedule's totals against the independent expectation.
 * `scheduleGross` / `scheduleWht` come from buildSecurityDailySchedule or
 * buildBankDailySchedule. A drift beyond tolerance flips `ok` to false.
 */
export function reconcileAccrual(
  items: AccrualReconItem[],
  days: number,
  scheduleGross: number,
  scheduleWht: number,
): AccrualReconResult {
  const exp = expectedAccrual(items, days);
  const grossDiff = round2(scheduleGross - exp.gross);
  const whtDiff = round2(scheduleWht - exp.wht);
  return {
    expectedGross: exp.gross,
    expectedWht: exp.wht,
    scheduleGross: round2(scheduleGross),
    scheduleWht: round2(scheduleWht),
    grossDiff,
    whtDiff,
    ok: Math.abs(grossDiff) <= RECON_TOLERANCE_KES && Math.abs(whtDiff) <= RECON_TOLERANCE_KES,
  };
}


/**
 * Ledger "Total" basis comparison (Ledger ambiguity fix).
 *
 * The Month Ledger Total follows the GOAL-PLAN asset scope (the engine never
 * sweeps Other Assets the user tagged OUT of the goal). The Dashboard headline
 * and Portfolio Review show FULL net worth. So those two figures are EXPECTED to
 * differ by exactly the goal-excluded other-asset value — this is a basis
 * difference to explain, not a discrepancy to hide.
 *
 * This pure helper takes the figures the pages already produce (via the snapshot
 * selectors) and decides whether the gap is the expected basis gap. Kept free of
 * any valuation logic so it can be unit-tested in isolation.
 */
export interface LedgerBasisInputs {
  /** Last actual Ledger row total (engine/goal-plan basis); null when nothing recorded. */
  ledgerActualValue: number | null;
  /** The goal-plan comparable the Ledger total should match (snapshot selector). */
  ledgerComparable: number;
  /** Dashboard headline net worth (full-net-worth basis). */
  dashboardNetWorth: number;
  /** Portfolio Review net worth (full-net-worth basis). */
  portfolioReviewNetWorth: number;
  /** Goal-plan assets (full minus goal-excluded other assets). */
  goalPlanAssets: number;
  /** Value of Other Assets tagged OUT of the goal. */
  otherAssetsExcludedFromGoal: number;
}

export interface LedgerBasisResult {
  /** Dashboard full net worth minus goal-plan assets. */
  fullVsGoalGap: number;
  /** The gap we EXPECT (== goal-excluded other assets). */
  expectedGap: number;
  /** True when the full-vs-goal gap equals the goal-excluded value (basis is explained). */
  gapExplained: boolean;
  /** True when the Ledger actual row sits on the goal-plan basis as expected. */
  ledgerMatchesGoalBasis: boolean;
  /** True when Dashboard and Portfolio Review agree (both full-net-worth basis). */
  dashboardMatchesReview: boolean;
}

/**
 * Audit item #4 — THREE-SECTION reconciliation.
 *
 * The old single verdict compared the income/tax base against sum-of-parts net
 * worth, which is a category error: the tax base is only the income-producing
 * capital, not the whole portfolio, so it would flip the badge red for a benign
 * reason (or, worse, hide a real full-net-worth drift behind a tax-base match).
 *
 * This helper cleanly separates the checks into three self-contained sections,
 * each with its OWN reference so a source is only ever compared to peers on the
 * SAME basis:
 *
 *   1. FULL PORTFOLIO VALUE — sum-of-parts vs engine projection vs dashboard
 *      actuals vs the headline net-worth card vs Portfolio Review. Every source
 *      here is a full-net-worth figure.
 *   2. GOAL-PLAN ASSETS — the goal-plan basis (full minus goal-excluded other
 *      assets) vs the Ledger "today" comparable. Other-asset exclusions are an
 *      expected basis difference, verified here, not a discrepancy.
 *   3. INCOME / TAX BASE — the income-producing base the Tax Summary blends
 *      yield across, compared ONLY to the snapshot's income/tax base. Never
 *      compared to full net worth.
 *
 * A section is green only when all its sources agree within tolerance; the
 * overall verdict is green only when all three sections are green.
 */
export interface ReconSectionSource {
  key: string;
  label: string;
  value: number;
  diff: number;
  ok: boolean;
}

export interface ReconSection {
  key: "fullPortfolio" | "goalPlan" | "incomeTax";
  label: string;
  reference: number;
  sources: ReconSectionSource[];
  maxDiff: number;
  ok: boolean;
}

export interface ReconSectionsInputs {
  // Section 1 — full portfolio value (all full-net-worth basis)
  sumOfParts: number;
  projectionTodayValue: number;
  dashboardActualsTotal: number;
  dashboardNetWorth: number;
  portfolioReviewNetWorth: number;
  // Section 2 — goal-plan assets
  goalPlanAssets: number;
  ledgerTodayComparable: number | null;
  // Section 3 — income / tax base
  incomeTaxBase: number;
  taxSummaryBase: number;
}

export interface ReconSectionsResult {
  sections: ReconSection[];
  ok: boolean;
}

function buildSection(
  key: ReconSection["key"],
  label: string,
  reference: number,
  rawSources: Array<{ key: string; label: string; value: number | null }>,
): ReconSection {
  const ref = round2(reference);
  const sources: ReconSectionSource[] = rawSources
    .filter((s) => typeof s.value === "number")
    .map((s) => {
      const value = round2(s.value as number);
      const diff = round2(value - ref);
      return { key: s.key, label: s.label, value, diff, ok: Math.abs(diff) <= RECON_TOLERANCE_KES };
    });
  const maxDiff = sources.length ? Math.max(...sources.map((s) => Math.abs(s.diff))) : 0;
  return {
    key,
    label,
    reference: ref,
    sources,
    maxDiff: round2(maxDiff),
    ok: sources.every((s) => s.ok),
  };
}

export function reconcileSections(input: ReconSectionsInputs): ReconSectionsResult {
  const fullPortfolio = buildSection(
    "fullPortfolio",
    "Full portfolio value",
    input.sumOfParts,
    [
      { key: "sumParts", label: "Sum of all holdings", value: input.sumOfParts },
      { key: "projection", label: "Engine projection (today)", value: input.projectionTodayValue },
      { key: "dashboardActuals", label: "Dashboard total held today", value: input.dashboardActualsTotal },
      { key: "netWorth", label: "Dashboard net-worth card", value: input.dashboardNetWorth },
      { key: "portfolioReview", label: "Portfolio Review net worth", value: input.portfolioReviewNetWorth },
    ],
  );
  const goalPlan = buildSection(
    "goalPlan",
    "Goal-plan assets",
    input.goalPlanAssets,
    [
      { key: "goalPlanAssets", label: "Goal-plan assets (full − excluded)", value: input.goalPlanAssets },
      { key: "ledgerToday", label: "Ledger 'today' comparable", value: input.ledgerTodayComparable },
    ],
  );
  const incomeTax = buildSection(
    "incomeTax",
    "Income / tax base",
    input.incomeTaxBase,
    [
      { key: "incomeTaxBase", label: "Income/tax base (snapshot)", value: input.incomeTaxBase },
      { key: "taxSummaryBase", label: "Tax Summary blended-yield base", value: input.taxSummaryBase },
    ],
  );
  const sections = [fullPortfolio, goalPlan, incomeTax];
  return { sections, ok: sections.every((s) => s.ok) };
}

export function compareLedgerBases(input: LedgerBasisInputs): LedgerBasisResult {
  const fullVsGoalGap = round2(input.dashboardNetWorth - input.goalPlanAssets);
  const expectedGap = round2(input.otherAssetsExcludedFromGoal);
  return {
    fullVsGoalGap,
    expectedGap,
    gapExplained: Math.abs(fullVsGoalGap - expectedGap) <= RECON_TOLERANCE_KES,
    ledgerMatchesGoalBasis:
      input.ledgerActualValue === null ||
      Math.abs(input.ledgerActualValue - input.ledgerComparable) <= RECON_TOLERANCE_KES,
    dashboardMatchesReview:
      Math.abs(input.dashboardNetWorth - input.portfolioReviewNetWorth) <= RECON_TOLERANCE_KES,
  };
}
