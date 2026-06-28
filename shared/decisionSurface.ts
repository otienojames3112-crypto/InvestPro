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

// ─── Part 4 — Risk severity + primary-risk classification ───────────────────
//
// The Dashboard risk section must (a) lead with the risks that actually matter
// for a goal-matched sovereign-paper ladder and (b) colour a breach by its
// MESSAGE, not its mere existence. A self-correcting or acknowledged breach is
// "caution" (amber), never "action" (red). These pure helpers keep the colour
// ↔ message contract in one tested place so the tiles, banners, and the new
// primary panel can never drift apart again.

/**
 * Severity of a single risk row.
 *  - "ok"      : within tolerance, no attention needed (neutral / primary green).
 *  - "caution" : worth knowing but self-correcting, acknowledged, or modelled —
 *                renders AMBER. Reserve this for breaches that do NOT require the
 *                user to do anything right now.
 *  - "action"  : genuinely requires a decision — renders RED.
 */
export type RiskSeverity = "ok" | "caution" | "action";

/** Rank so callers can sort/escalate: action > caution > ok. */
export function severityRank(s: RiskSeverity): number {
  return s === "action" ? 2 : s === "caution" ? 1 : 0;
}

/**
 * Resolve the severity of a concentration/cap breach by its message.
 *
 * The brief (line-item #13): once a breach is self-correcting OR has been
 * acknowledged, it must render amber — red is reserved for breaches that
 * genuinely require action.
 *
 *  - not breached            → "ok"
 *  - breached + acknowledged → "caution"  (user already accepted it)
 *  - breached + selfCorrects → "caution"  (clears on its own by a known date)
 *  - breached, neither       → "action"   (needs a decision)
 */
export function classifyBreachSeverity(opts: {
  breached: boolean;
  selfCorrects?: boolean;
  acknowledged?: boolean;
}): RiskSeverity {
  if (!opts.breached) return "ok";
  if (opts.acknowledged) return "caution";
  if (opts.selfCorrects) return "caution";
  return "action";
}

/**
 * Resolve the severity of the rate / reinvestment risk from the projection band.
 * A bigger modelled downside (low case far below base) is a louder caution, but
 * rate risk is inherent to a re-rolling ladder and is never "action" on its own —
 * it is information the plan already prices in. We escalate to "caution" only when
 * the downside would actually MISS the target.
 */
export function classifyRateRisk(opts: {
  base: number;
  low: number;
  target: number;
}): RiskSeverity {
  if (!(opts.base > 0)) return "ok";
  // If even the modelled rate-shock low still clears the target, this is benign.
  if (opts.low >= opts.target) return "ok";
  return "caution";
}

/**
 * Resolve the severity of the contribution-shortfall risk.
 *  - behind on pace            → "action" (a decision is needed: step up / extend)
 *  - on pace but back-loaded   → "caution" (the plan leans on future escalation)
 *  - otherwise                 → "ok"
 */
export function classifyContributionRisk(opts: {
  paceStatus: PaceStatus;
  isBackloaded: boolean;
}): RiskSeverity {
  if (opts.paceStatus === "behind") return "action";
  if (opts.isBackloaded) return "caution";
  return "ok";
}

/**
 * Resolve the severity of liquidity-timing risk (cash locked at/after the goal).
 *  - a security matures AFTER the goal date           → "action" (cash is locked late)
 *  - a security matures uncomfortably near the goal    → "caution"
 *  - otherwise                                         → "ok"
 */
export function classifyLiquidityTimingRisk(opts: {
  cushionDays: number | null;
  maturesNearOrAfterGoal: boolean;
}): RiskSeverity {
  if (opts.cushionDays != null && opts.cushionDays < 0) return "action";
  if (opts.maturesNearOrAfterGoal) return "caution";
  return "ok";
}
