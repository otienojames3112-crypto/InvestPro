/**
 * Shared fixtures + a tiny "virtual portfolio" helper for the cross-page
 * integrity suites (Round: cross-page integrity).
 *
 * These tests deliberately DO NOT spin up tRPC + a live DB. Instead they drive
 * the exact PURE functions every page funnels through — `buildAllocation`,
 * `blendedYield`, `computeAnnualTax`, `reconcile`, `runProjection`,
 * `simulateAccrualDated` and the snapshot selectors — so a future edit that
 * breaks a cross-page contract fails here, not silently in production.
 *
 * `buildPortfolioState` takes a single set of raw rows (the way the DB would
 * hand them to `buildPortfolioSnapshot`) and derives, from those SAME rows,
 * every figure the different pages render. The suites then mutate the rows and
 * assert that every page's figure moves together.
 */
import {
  buildAllocation,
  blendedYield,
  type RawDepositRow,
  type RawSecurityRow,
  type RawSecondaryMmf,
  type RawBankHolding,
  type RawOtherHolding,
} from "../../shared/actuals";
import {
  reconcile,
  type ReconInputs,
  type ReconResult,
} from "../../shared/reconciliation";
import {
  computeNetWorthBases,
  selectDashboardHeadlineNetWorth,
  selectPortfolioReviewNetWorth,
  selectGoalPlanAssets,
  selectLedgerTodayComparableValue,
  type PortfolioSnapshot,
} from "../../shared/snapshot";
import { valueHolding } from "../../shared/holdingValue";

export interface RawRows {
  deposits: RawDepositRow[];
  securities: RawSecurityRow[];
  secondaryMmfs: RawSecondaryMmf[];
  bankHoldings: RawBankHolding[];
  otherHoldings: RawOtherHolding[];
  primaryFundId: number | null;
  /** Reference rates used by every income/tax page. */
  rates: {
    mmfYield: number;
    tbill364Rate: number;
    ifbCouponRate: number;
    fxdCouponRate: number;
    withholdingTax: number;
  };
}

/** A KES value for one other-holding through the single mark-to-model source. */
export function valueOther(h: RawOtherHolding): number {
  return valueHolding({
    assetClass: h.assetClass,
    behaviorClass: (h as { behaviorClass?: string | null }).behaviorClass ?? null,
    currentValue: (h as { currentValue?: string | number | null }).currentValue ?? null,
    units: (h as { units?: number | null }).units ?? null,
    unitPrice: (h as { unitPrice?: number | null }).unitPrice ?? null,
    currency: (h as { currency?: string | null }).currency ?? null,
    fxRateToKes: (h as { fxRateToKes?: number | null }).fxRateToKes ?? null,
    dataSource: (h as { dataSource?: string | null }).dataSource ?? null,
    dataAsOf: (h as { dataAsOf?: string | null }).dataAsOf ?? null,
  }).valueKes;
}

/**
 * Derive, from one set of raw rows, the figure each page shows — exactly the
 * way `buildPortfolioSnapshot` composes them on the server.
 */
export interface DerivedPortfolio {
  /** Allocation result (Holdings page + Portfolio Review donut). */
  alloc: ReturnType<typeof buildAllocation>;
  /** Canonical net-worth bases (Dashboard headline / Goal-plan / Income-tax). */
  fullNetWorth: number;
  goalPlanAssets: number;
  incomeTaxBase: number;
  /** Blended net yield base (Tax Summary + income). */
  blendedBase: number;
  /** Reconciliation result across the page sources. */
  recon: ReconResult;
}

export function buildPortfolioState(rows: RawRows): DerivedPortfolio {
  const alloc = buildAllocation({
    deposits: rows.deposits,
    securities: rows.securities,
    secondaryMmfs: rows.secondaryMmfs,
    bankHoldings: rows.bankHoldings,
    otherHoldings: rows.otherHoldings,
    primaryFundId: rows.primaryFundId,
  });

  const netWorth = round2(alloc.netWorth);
  const otherAssetsTotal = round2(
    Object.values(alloc.other).reduce((a, b) => a + b, 0),
  );
  const excludedOtherAssets = round2(
    rows.otherHoldings
      .filter((h) => (h as { includeInGoal?: boolean }).includeInGoal === false)
      .reduce((s, h) => s + valueOther(h), 0),
  );

  const blended = blendedYield({
    primaryMmf: alloc.primaryMmf,
    primaryMmfRate: rows.rates.mmfYield,
    secondaryMmfs: rows.secondaryMmfs.map((s) => ({
      balance: Number((s as { currentBalance?: unknown }).currentBalance ?? 0) || 0,
      rate: Number((s as { ear?: unknown }).ear ?? 0) || 0,
    })),
    bankHoldings: rows.bankHoldings
      .filter((b) => (b as { isActive?: boolean }).isActive !== false)
      .map((b) => ({
        value: Number((b as { principal?: unknown }).principal ?? 0) || 0,
        rate: Number((b as { interestRate?: unknown }).interestRate ?? 0) || 0,
      })),
    securities: [
      { value: alloc.tbill, rate: rows.rates.tbill364Rate, taxExempt: false },
      { value: alloc.ifb, rate: rows.rates.ifbCouponRate, taxExempt: true },
      { value: alloc.fxd, rate: rows.rates.fxdCouponRate, taxExempt: false },
    ],
    whtRate: rows.rates.withholdingTax,
  });
  const taxBase = round2(blended.base);

  const bases = computeNetWorthBases({
    netWorth,
    excludedOtherAssetsKes: excludedOtherAssets,
    otherAssetsTotalKes: otherAssetsTotal,
    incomeTaxBaseKes: taxBase,
  });

  // Reconciliation sources — each from its own path, the way the server feeds it.
  const primaryMmfBalance = round2(alloc.primaryMmf);
  const secondaryMmfBalances = rows.secondaryMmfs.map(
    (s) => Number((s as { currentBalance?: unknown }).currentBalance ?? 0) || 0,
  );
  const bankHoldingPrincipals = rows.bankHoldings
    .filter((b) => (b as { isActive?: boolean }).isActive !== false)
    .map((b) => Number((b as { principal?: unknown }).principal ?? 0) || 0);
  const securityFaceValues = rows.securities
    .filter((s) => !(s as { isMatured?: boolean }).isMatured)
    .map((s) => Number((s as { faceValue?: unknown }).faceValue ?? 0) || 0);
  const otherAssetValues = rows.otherHoldings.map(valueOther);

  const recon = reconcile({
    primaryMmfBalance,
    secondaryMmfBalances,
    bankHoldingPrincipals,
    securityFaceValues,
    otherAssetValues,
    projectionTodayValue: netWorth,
    dashboardActualsTotal: netWorth,
    accrualLedgerMmfTotal:
      primaryMmfBalance + secondaryMmfBalances.reduce((a, b) => a + b, 0),
    dashboardNetWorth: netWorth,
    portfolioReviewNetWorth: netWorth,
    // NOTE: the income/tax base is intentionally NOT passed into the
    // full-net-worth verdict. On the live page it is a SEPARATE check
    // (fixed-income + bank blend), because a portfolio holding a non-income
    // asset (e.g. equity) legitimately has a tax base BELOW net worth. The
    // income/tax base is asserted on its own via DerivedPortfolio.incomeTaxBase.
  });

  return {
    alloc,
    fullNetWorth: bases.fullNetWorth,
    goalPlanAssets: round2(bases.goalPlanAssets),
    incomeTaxBase: taxBase,
    blendedBase: taxBase,
    recon,
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build a minimal PortfolioSnapshot whose holdings basis figures equal a derived
 * state, so the selector-level pages (Dashboard headline, Portfolio Review,
 * Ledger-today comparable, Goal-plan) can be asserted against the same numbers.
 */
export function snapshotFromState(d: DerivedPortfolio): PortfolioSnapshot {
  return {
    identity: {
      portfolioId: 1,
      name: "Integrity",
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
      projectedFinalValue: 0,
      netWorthNow: d.fullNetWorth,
    },
    holdings: {
      netWorth: d.fullNetWorth,
      primaryMmf: round2(d.alloc.primaryMmf),
      secondaryMmf: round2(d.alloc.secondaryMmf),
      bank: round2(d.alloc.bank),
      tbill: round2(d.alloc.tbill),
      ifb: round2(d.alloc.ifb),
      fxd: round2(d.alloc.fxd),
      buckets: {
        cash: round2(d.alloc.primaryMmf + d.alloc.secondaryMmf + d.alloc.bank),
        gov: round2(d.alloc.tbill + d.alloc.ifb + d.alloc.fxd),
        equity: round2(d.alloc.other["equity"] ?? 0),
        reit: round2(d.alloc.other["reit"] ?? 0),
        offshore: round2(d.alloc.other["offshore_fund"] ?? 0),
        other: 0,
      },
      other: d.alloc.other,
      fullNetWorth: d.fullNetWorth,
      goalPlanAssets: d.goalPlanAssets,
      otherAssetsExcludedFromGoal: round2(d.fullNetWorth - d.goalPlanAssets),
      otherAssetsTotal: round2(Object.values(d.alloc.other).reduce((a, b) => a + b, 0)),
      incomeTaxBase: d.incomeTaxBase,
    },
    allocation: { tier: "balanced", timeRemainingFraction: 1, rows: [], isEmpty: false, caveat: "" },
    contributions: {
      startingContribution: 0,
      stepUpAmount: 0,
      stepUpMonths: 12,
      totalPlanned: 0,
      totalActual: 0,
      points: [],
    },
    ledger: [],
    income: { accruedNetInterest: 0, blendedNetYieldPct: 0 },
    tax: {
      base: d.incomeTaxBase,
      annualWht: 0,
      whtToDate: 0,
      fullPeriodProjectedWht: 0,
      breakdown: {},
    },
    liquidity: [],
    reconciliation: {
      ok: d.recon.reconciled,
      reference: d.recon.reference,
      sources: d.recon.sources.map((s) => ({ label: s.label, value: s.value, ok: true })),
    },
    warnings: [],
    nextActions: [],
    asOfMs: 1_800_000_000_000,
  };
}

/** Page selectors re-exported so suites assert against the real selector code. */
export const pageSelectors = {
  dashboardHeadline: selectDashboardHeadlineNetWorth,
  portfolioReview: selectPortfolioReviewNetWorth,
  goalPlan: selectGoalPlanAssets,
  ledgerTodayComparable: selectLedgerTodayComparableValue,
};
