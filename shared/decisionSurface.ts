/**
 * Part 3 — Dashboard decision-surface pure helpers.
 *
 * These functions turn raw projection/milestone numbers into the investor-facing
 * statements the Dashboard headline shows: a projection band, an on-pace/behind
 * status, the contribution back-loading share, and the goal-date liquidity
 * cushion. They are intentionally pure (no DB / no engine imports) so both the
 * tRPC query and unit tests share one source of truth.
 */

/** The contribution-back-loading caution threshold (share of total in the final quarter). */
export const BACKLOAD_THRESHOLD = 0.35;

// ─── Projection range band ──────────────────────────────────────────────────

export interface ProjectionRange {
  /** Base case — current rates, contributions on schedule. */
  base: number;
  /** Low case — worst of the rate-shock and missed-contributions cases. */
  low: number;
  /** High case — best of the modelled cases (usually the base). */
  high: number;
}

/**
 * Fold the three modelled ending values into a {base, low, high} band. `base` is
 * always the on-schedule current-rate projection; `low` is the worst downside,
 * `high` the best upside (clamped so the band always contains base).
 */
export function buildProjectionRange(
  base: number,
  rateShockCase: number,
  missedContributionsCase: number,
): ProjectionRange {
  const candidates = [base, rateShockCase, missedContributionsCase].filter(
    (v) => Number.isFinite(v) && v >= 0,
  );
  const lo = candidates.length ? Math.min(...candidates) : base;
  const hi = candidates.length ? Math.max(...candidates) : base;
  return {
    base: Math.round(base),
    low: Math.round(Math.min(lo, base)),
    high: Math.round(Math.max(hi, base)),
  };
}

// ─── On-pace / behind status ──────────────────────────────────────────────────

export type PaceStatus = "ahead" | "on_pace" | "behind";

export interface PaceAssessment {
  status: PaceStatus;
  /** How far the BASE projection sits above (positive) or below (negative) the target. */
  surplusOrShortfall: number;
  /** Convenience: positive shortfall amount when behind, else 0. */
  shortfall: number;
}

/**
 * Classify pace from the base projection against the goal target.
 *  - "ahead"   : base comfortably clears target (by > tolerance).
 *  - "on_pace" : base is within +/- tolerance of target.
 *  - "behind"  : base falls short of target by more than tolerance.
 *
 * `tolerance` defaults to 0 so any shortfall reads as "behind"; pass a small
 * band (e.g. 1% of target) if you want an explicit "on pace" middle ground.
 */
export function assessPace(
  baseProjected: number,
  target: number,
  tolerance = 0,
): PaceAssessment {
  const delta = baseProjected - target;
  let status: PaceStatus;
  if (delta > tolerance) status = "ahead";
  else if (delta >= -tolerance) status = "on_pace";
  else status = "behind";
  return {
    status,
    surplusOrShortfall: Math.round(delta),
    shortfall: status === "behind" ? Math.round(-delta) : 0,
  };
}

// ─── Contribution back-loading ──────────────────────────────────────────────

export interface BackloadAssessment {
  /** Share (0..1) of total contributions falling in the final quarter window. */
  share: number;
  /** Sum of contributions in the final-window months (KES). */
  finalWindowTotal: number;
  /** Sum of all contributions over the horizon (KES). */
  allTotal: number;
  /** Number of months in the final window actually summed. */
  windowMonths: number;
  /** Average monthly contribution across the final window (KES). */
  finalWindowMonthly: number;
  /** True when share exceeds BACKLOAD_THRESHOLD — caution should fire. */
  isBackloaded: boolean;
}

/**
 * Compute the contribution back-loading share from the per-month contribution
 * series. `windowMonths` is the size of the "final quarter" window (default 3).
 * The window is the last `windowMonths` entries of the array.
 */
export function assessBackloading(
  monthlyContributions: number[],
  windowMonths = 3,
  threshold = BACKLOAD_THRESHOLD,
): BackloadAssessment {
  const series = monthlyContributions.filter((v) => Number.isFinite(v));
  const allTotal = series.reduce((a, b) => a + b, 0);
  const n = Math.min(windowMonths, series.length);
  const window = series.slice(series.length - n);
  const finalWindowTotal = window.reduce((a, b) => a + b, 0);
  const share = allTotal > 0 ? finalWindowTotal / allTotal : 0;
  return {
    share,
    finalWindowTotal: Math.round(finalWindowTotal),
    allTotal: Math.round(allTotal),
    windowMonths: n,
    finalWindowMonthly: n > 0 ? Math.round(finalWindowTotal / n) : 0,
    isBackloaded: share > threshold,
  };
}

// ─── Goal-date liquidity cushion ──────────────────────────────────────────────

export interface LiquidityCushion {
  /** Liquid + spendable amount at the goal date (KES). */
  liquidAtGoal: number;
  /** Share (0..1) of the projected total that is liquid at the goal date. */
  liquidShare: number;
  /** Latest security maturity as a Unix-ms timestamp, or null when none. */
  latestMaturityMs: number | null;
  /** Days between the latest maturity and the goal date (positive = matures before goal). */
  cushionDays: number | null;
  /**
   * True when a security matures within `warnWindowDays` of the goal date OR
   * strictly after it — i.e. the maturity cuts the cushion uncomfortably close.
   */
  maturesNearOrAfterGoal: boolean;
}

const MS_PER_DAY = 86_400_000;

/**
 * Derive the goal-date liquidity facts. `goalDateMs` and `latestMaturityMs` are
 * UTC timestamps. A positive `cushionDays` means the last security matures that
 * many days BEFORE the goal; negative means it matures AFTER the goal.
 */
export function assessLiquidityCushion(
  liquidAtGoal: number,
  projectedTotal: number,
  goalDateMs: number,
  latestMaturityMs: number | null,
  warnWindowDays = 60,
): LiquidityCushion {
  const liquidShare = projectedTotal > 0 ? liquidAtGoal / projectedTotal : 0;
  let cushionDays: number | null = null;
  let maturesNearOrAfterGoal = false;
  if (latestMaturityMs != null && Number.isFinite(latestMaturityMs)) {
    cushionDays = Math.round((goalDateMs - latestMaturityMs) / MS_PER_DAY);
    // Near (within the warn window before goal) OR after the goal (negative cushion).
    maturesNearOrAfterGoal = cushionDays < warnWindowDays;
  }
  return {
    liquidAtGoal: Math.round(liquidAtGoal),
    liquidShare,
    latestMaturityMs: latestMaturityMs ?? null,
    cushionDays,
    maturesNearOrAfterGoal,
  };
}
