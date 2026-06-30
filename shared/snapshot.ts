/**
 * Canonical portfolio snapshot — the SINGLE source of money truth.
 *
 * The server `portfolio.snapshot` procedure composes the app's existing,
 * already-tested helpers (loadProjectionInputs + runProjection for the ledger,
 * loadAllocationInput + buildAllocation for net worth + allocation, the
 * allocation tier/gap helpers, the reconciliation cross-check) into ONE
 * structured object. Every page/tab then reads its numbers through the pure
 * selectors below instead of re-deriving money locally, so no two surfaces can
 * disagree on net worth, goal progress, tax, accrual, liquidity, allocation
 * gap, ledger rows, or reconciliation status.
 *
 * This file is PURE (no IO, no tRPC, no React) so it is trivially unit-testable
 * and shared verbatim by client and server.
 */

// ── Status vocabulary (consistent across every surface) ──────────────────────
// A value's provenance. Surfaces must label money/figures with one of these and
// must NEVER imply the app executed a real-world transaction.
export type ValueStatus =
  | "reference" // External reference data (e.g. published rates, catalogue)
  | "modelled" // Computed/projected by the engine
  | "suggested" // Suggested by the plan (a starting point, not advice)
  | "confirmed" // The user confirmed this choice
  | "actual"; // An actual recorded fact (a real deposit/withdrawal/holding)

export const VALUE_STATUS_LABEL: Record<ValueStatus, string> = {
  reference: "Reference data",
  modelled: "Modelled",
  suggested: "Suggested by plan",
  confirmed: "User confirmed",
  actual: "Actual recorded",
};

// ── Sub-shapes ───────────────────────────────────────────────────────────────

export interface SnapshotIdentity {
  portfolioId: number;
  name: string;
  /** Plain-language purpose/goal nature, if the portfolio carries one. */
  purpose: string | null;
  isSandbox: boolean;
  /** Committed strategy: the allocation policy + the committed glide tier. */
  allocationPolicy: "balanced" | "yield_first" | "custom";
  committedTier: string | null;
  tierOverridden: boolean;
  /** Unix-ms when the plan was last committed; null = never (draft/suggestion). */
  planCommittedAt: number | null;
  /** Derived: "committed" once the user has committed; else "draft". */
  planStatus: "committed" | "draft";
  /**
   * The tier the projection engine ACTUALLY executed for this snapshot's ledger.
   * Equals `committedTier` only once committed; before commit it is "balanced"
   * (the default path), so surfaces can prove the Ledger matches the committed
   * Allocation-Plan selection — or flag an uncommitted preview.
   */
  activePolicyTier: string;
}

export interface SnapshotGoal {
  target: number;
  horizonMonths: number;
  /** Months already elapsed against the effective (possibly simulated) clock. */
  elapsedMonths: number;
  horizonRemainingMonths: number;
  /** Engine-projected final value at the goal date (base case). */
  projectedFinalValue: number;
  /** Current net worth right now (the canonical figure). */
  netWorthNow: number;
}

/** A single behaviour-bucket actual value, in KES. */
export interface BucketValues {
  cash: number;
  gov: number;
  equity: number;
  reit: number;
  offshore: number;
  other: number;
}

export interface SnapshotHoldings {
  /** Canonical net worth = sum of every pocket (incl. other assets). */
  netWorth: number;
  primaryMmf: number;
  secondaryMmf: number;
  bank: number;
  tbill: number;
  ifb: number;
  fxd: number;
  /** Behaviour-class roll-up used by the allocation gap. */
  buckets: BucketValues;
  /** Free-form per-asset-class "other" pocket (equity/reit/offshore/property/…). */
  other: Record<string, number>;
  /**
   * Net-worth basis split (pasted Part 3/4). The three bases share ONE
   * underlying valuation; they differ only in WHICH pockets they sum:
   *  - fullNetWorth  : every pocket, incl. ALL other assets (== netWorth).
   *  - goalPlanAssets: core instruments + only other assets tagged includeInGoal.
   *  - incomeTaxBase : only income-producing pockets being modelled for tax/yield.
   * Surfacing them here lets every surface read the SAME number through a
   * selector instead of re-deriving its own "net worth".
   */
  fullNetWorth: number;
  goalPlanAssets: number;
  /** Other-asset value tagged OUT of the goal plan (fullNetWorth - goalPlanAssets, other only). */
  otherAssetsExcludedFromGoal: number;
  /** Total "other" assets (sum of the `other` map), regardless of goal tag. */
  otherAssetsTotal: number;
  /** Income-producing base modelled for tax/yield (MMF + bank + gov + recorded other income). */
  incomeTaxBase: number;
}

export interface AllocationGapRow {
  bucket: string;
  targetPct: number;
  actualPct: number;
  /** Signed percentage-point gap (actual − target). */
  gapPp: number;
  direction: "over" | "under" | "aligned";
}

export interface SnapshotAllocation {
  tier: string;
  timeRemainingFraction: number;
  rows: AllocationGapRow[];
  isEmpty: boolean;
  caveat: string;
}

export interface ContributionPlanPoint {
  monthNumber: number;
  planned: number;
  actual: number | null;
}

export interface SnapshotContributions {
  startingContribution: number;
  stepUpAmount: number;
  stepUpMonths: number;
  totalPlanned: number;
  totalActual: number;
  points: ContributionPlanPoint[];
}

export interface LedgerRow {
  monthNumber: number;
  isActual: boolean;
  contribution: number;
  mmfEnd: number;
  mmfInterestNet: number;
  totalEnd: number;
}

export interface SnapshotIncome {
  /** Net interest accrued/earned to date across MMFs (KES). */
  accruedNetInterest: number;
  /** Blended net yield (%) on the current mix. */
  blendedNetYieldPct: number;
}

export interface SnapshotTax {
  /** Tax base (taxable income figure the Tax tab renders). */
  base: number;
  breakdown: Record<string, number>;
}

export interface LiquidityEvent {
  atMs: number;
  kind: "maturity" | "contribution";
  label: string;
  amount: number | null;
}

export interface ReconSourceStatus {
  label: string;
  value: number;
  ok: boolean;
}

export interface SnapshotReconciliation {
  ok: boolean;
  reference: number;
  sources: ReconSourceStatus[];
}

export interface FreshnessWarning {
  field: string;
  message: string;
  severity: "info" | "warn";
}

export interface NextAction {
  id: string;
  label: string;
  /** A route the command-centre can deep-link to. */
  href: string;
}

/** The complete canonical snapshot. */
export interface PortfolioSnapshot {
  identity: SnapshotIdentity;
  goal: SnapshotGoal;
  holdings: SnapshotHoldings;
  allocation: SnapshotAllocation;
  contributions: SnapshotContributions;
  ledger: LedgerRow[];
  income: SnapshotIncome;
  tax: SnapshotTax;
  liquidity: LiquidityEvent[];
  reconciliation: SnapshotReconciliation;
  warnings: FreshnessWarning[];
  nextActions: NextAction[];
  /** When the snapshot was assembled (Unix ms, effective/simulated clock). */
  asOfMs: number;
}

// ── Pure selectors (the ONLY way surfaces should read money) ─────────────────

export function selectNetWorth(s: PortfolioSnapshot): number {
  return s.holdings.netWorth;
}

// ── Canonical net-worth BASIS selectors (pasted Part 3/4) ────────────────────
// These are the ONLY sanctioned way for a surface to read a "net worth" figure.
// Reconciliation compares the very same selectors, so a page can never show a
// number that the trust check would not also see.

/**
 * Full Net Worth — everything the user owns in the portfolio: primary + secondary
 * MMFs, government securities, bank instruments, and ALL other assets. This is
 * the canonical headline figure; it must never omit a pocket.
 */
export function selectFullNetWorth(s: PortfolioSnapshot): number {
  return s.holdings.fullNetWorth;
}

/**
 * Goal-Plan Assets — assets actively assigned to THIS goal: core instruments
 * (MMFs + bank + government securities) plus only the other assets the user has
 * tagged "counts toward this goal".
 */
export function selectGoalPlanAssets(s: PortfolioSnapshot): number {
  return s.holdings.goalPlanAssets;
}

/**
 * Income / Tax Base — only the income-producing assets being modelled for
 * tax/yield (MMFs + bank + T-bills + FXD + IFB shown exempt + recorded other
 * income). Deliberately NOT "whole-portfolio net worth".
 */
export function selectIncomeTaxBase(s: PortfolioSnapshot): number {
  return s.holdings.incomeTaxBase;
}

/** The Dashboard headline callout uses Full Net Worth (never a pocket-omitting path). */
export function selectDashboardHeadlineNetWorth(s: PortfolioSnapshot): number {
  return selectFullNetWorth(s);
}

/** Portfolio Review uses the SAME Full Net Worth selector as the Dashboard. */
export function selectPortfolioReviewNetWorth(s: PortfolioSnapshot): number {
  return selectFullNetWorth(s);
}

/** Tax Summary renders the income-producing base — never the full net worth. */
export function selectTaxSummaryBase(s: PortfolioSnapshot): number {
  return selectIncomeTaxBase(s);
}

/**
 * The value comparable to the Ledger's "today" row for goal-progress purposes:
 * the goal-plan assets (what the committed plan is actually growing toward the
 * target). Other assets tagged out of the goal do not move the ledger.
 */
export function selectLedgerTodayComparableValue(s: PortfolioSnapshot): number {
  return selectGoalPlanAssets(s);
}

export interface GoalProgress {
  target: number;
  netWorthNow: number;
  projectedFinalValue: number;
  /** Fraction of target reached by current net worth, clamped 0..>1. */
  progressFraction: number;
  /** Fraction of target the projection reaches, clamped 0..>1. */
  projectedFraction: number;
  /** True when the projected final value meets or beats the target. */
  onTrack: boolean;
}

export function selectGoalProgress(s: PortfolioSnapshot): GoalProgress {
  const target = s.goal.target || 0;
  const safe = (n: number) => (target > 0 ? n / target : 0);
  return {
    target,
    netWorthNow: s.goal.netWorthNow,
    projectedFinalValue: s.goal.projectedFinalValue,
    progressFraction: safe(s.goal.netWorthNow),
    projectedFraction: safe(s.goal.projectedFinalValue),
    onTrack: s.goal.projectedFinalValue >= target && target > 0,
  };
}

export function selectTaxSummary(s: PortfolioSnapshot): SnapshotTax {
  return s.tax;
}

export function selectAccruedInterest(s: PortfolioSnapshot): number {
  return s.income.accruedNetInterest;
}

export function selectLiquidityEvents(s: PortfolioSnapshot): LiquidityEvent[] {
  return s.liquidity;
}

export function selectAllocationGap(s: PortfolioSnapshot): SnapshotAllocation {
  return s.allocation;
}

export function selectLedgerRows(s: PortfolioSnapshot): LedgerRow[] {
  return s.ledger;
}

export function selectReconciliationStatus(
  s: PortfolioSnapshot,
): SnapshotReconciliation {
  return s.reconciliation;
}

/**
 * Whether the plan has been committed (the ledger executes a committed plan) or
 * is still a draft/suggestion. Surfaces the single commit marker so no tab has
 * to re-derive commit state.
 */
export function selectPlanStatus(s: PortfolioSnapshot): {
  status: "committed" | "draft";
  committedAtMs: number | null;
} {
  return { status: s.identity.planStatus, committedAtMs: s.identity.planCommittedAt };
}

export function selectActualVsPlanned(s: PortfolioSnapshot): {
  totalPlanned: number;
  totalActual: number;
  variance: number;
  points: ContributionPlanPoint[];
} {
  return {
    totalPlanned: s.contributions.totalPlanned,
    totalActual: s.contributions.totalActual,
    variance: s.contributions.totalActual - s.contributions.totalPlanned,
    points: s.contributions.points,
  };
}


// ── Pure basis computation (pasted Part 3/4) ─────────────────────────────────
// The single sanctioned derivation of the three bases. The server snapshot
// builder calls THIS so the math that produces the persisted fields is the same
// math unit tests verify — no parallel formula can drift.

export interface NetWorthBasesInput {
  /** Canonical net worth (every pocket, incl. all other assets). */
  netWorth: number;
  /** Value (KES) of other assets the user tagged OUT of the goal. */
  excludedOtherAssetsKes: number;
  /** Total value (KES) of all other assets, regardless of goal tag. */
  otherAssetsTotalKes: number;
  /** Income-producing base modelled for tax/yield (MMF + bank + gov + recorded other income). */
  incomeTaxBaseKes: number;
}

export interface NetWorthBases {
  fullNetWorth: number;
  goalPlanAssets: number;
  otherAssetsExcludedFromGoal: number;
  otherAssetsTotal: number;
  incomeTaxBase: number;
}

/**
 * Derive the three canonical bases from one valuation. Full Net Worth is the
 * net worth verbatim; Goal-Plan Assets subtracts ONLY the tagged-out other
 * assets; the income/tax base is passed through unchanged (it never inherits
 * non-income asset value). Clamps keep every basis non-negative.
 */
export function computeNetWorthBases(input: NetWorthBasesInput): NetWorthBases {
  const fullNetWorth = Math.max(0, input.netWorth);
  const excluded = Math.max(0, input.excludedOtherAssetsKes);
  const goalPlanAssets = Math.max(0, fullNetWorth - excluded);
  return {
    fullNetWorth,
    goalPlanAssets,
    otherAssetsExcludedFromGoal: excluded,
    otherAssetsTotal: Math.max(0, input.otherAssetsTotalKes),
    incomeTaxBase: Math.max(0, input.incomeTaxBaseKes),
  };
}
