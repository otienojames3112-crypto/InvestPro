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

// ─── Part A1 — Inflation-adjusted goal (the liability) ───────────────────────
//
// The goal is a real-asset price expressed in TODAY'S shillings. If we judge the
// projection (a nominal, future-shilling number) against a goal frozen in today's
// shillings, the surplus is overstated in real terms. When the user inflation-links
// a portfolio, we instead:
//   1. Inflate the goal to the goal date:  futureGoal = target × (1+i)^years
//   2. Test the nominal projection against that FUTURE goal (the honest on-track test)
//   3. Express the surplus back in today's shillings so the cushion is real, not nominal.
// All of this is pure so the tRPC query and unit tests share one source of truth.

export interface InflationAdjustedGoal {
  /** Whether inflation-linking is active for this assessment. */
  linked: boolean;
  /** Annual inflation rate as a fraction (e.g. 0.0668 for 6.68%). */
  inflationRate: number;
  /** Horizon expressed in years (months / 12). */
  horizonYears: number;
  /** Goal in today's shillings (the stored target). */
  goalToday: number;
  /**
   * Goal at the goal date. When linked this is target×(1+i)^years; when not
   * linked it equals goalToday (the goal is treated as nominal/fixed).
   */
  goalAtDate: number;
  /**
   * Discount factor (1+i)^years used to convert future shillings back to today's.
   * Always ≥ 1; equals 1 when not linked or rate is 0.
   */
  inflationFactor: number;
  /** Nominal projected ending value (future shillings) carried through for display. */
  projectedNominal: number;
  /** Projected ending value expressed in TODAY's shillings (projectedNominal / factor). */
  projectedReal: number;
  /** Nominal surplus/shortfall vs the goal that the on-track test uses (goalAtDate). */
  surplusNominal: number;
  /** Real (today's-shilling) surplus/shortfall = projectedReal − goalToday. */
  surplusReal: number;
  /**
   * Real surplus as a share of the goal (0.11 = ~11% real cushion). Negative when
   * the plan falls short in real terms. 0 when the goal is non-positive.
   */
  realCushionShare: number;
  /**
   * The goal the on-track / pace test MUST compare the nominal projection against:
   * goalAtDate when linked, goalToday when not. Callers feed this to assessPace.
   */
  effectiveGoal: number;
}

/**
 * Compute the inflation-adjusted view of the goal and the projection.
 *
 * @param target          Stored goal in today's shillings.
 * @param projectedNominal Base-case projected ending value (nominal/future shillings).
 * @param horizonMonths   Plan horizon in months.
 * @param inflationRatePct Annual inflation as a PERCENT (e.g. 6.68). Reused from the
 *                         Dashboard's existing inflation benchmark — not a new source.
 * @param linked          Whether the portfolio inflation-links its goal.
 */
export function computeInflationAdjustedGoal(opts: {
  target: number;
  projectedNominal: number;
  horizonMonths: number;
  inflationRatePct: number;
  linked: boolean;
}): InflationAdjustedGoal {
  const goalToday = Math.max(0, Number(opts.target) || 0);
  const projectedNominal = Math.max(0, Number(opts.projectedNominal) || 0);
  const horizonYears = (Number(opts.horizonMonths) || 0) / 12;
  const rateFrac = Math.max(0, (Number(opts.inflationRatePct) || 0) / 100);

  // The factor is only applied when linked; an unlinked goal is treated as nominal
  // (factor 1) so behaviour is identical to before the feature, just labelled.
  const inflationFactor = opts.linked
    ? Math.pow(1 + rateFrac, horizonYears)
    : 1;

  const goalAtDate = opts.linked ? goalToday * inflationFactor : goalToday;
  const projectedReal = inflationFactor > 0 ? projectedNominal / inflationFactor : projectedNominal;

  const effectiveGoal = goalAtDate;
  const surplusNominal = Math.round(projectedNominal - effectiveGoal);
  const surplusReal = Math.round(projectedReal - goalToday);
  const realCushionShare = goalToday > 0 ? (projectedReal - goalToday) / goalToday : 0;

  return {
    linked: opts.linked,
    inflationRate: rateFrac,
    horizonYears,
    goalToday: Math.round(goalToday),
    goalAtDate: Math.round(goalAtDate),
    inflationFactor,
    projectedNominal: Math.round(projectedNominal),
    projectedReal: Math.round(projectedReal),
    surplusNominal,
    surplusReal,
    realCushionShare,
    effectiveGoal: Math.round(effectiveGoal),
  };
}


// ─── Part B2 — Savings-led framing (return share of the ending value) ─────────
//
// This plan reaches its goal mostly by *saving* (contributions) and only thinly
// by *investing* (the return earned on those contributions). Giving YTM / net
// yield / unrealized gain investment-product prominence implies the investing
// drives the outcome — it does not. We compute the honest split so the UI can
// state plainly how small the investment contribution really is, which sets
// expectations and discourages yield-chasing with safety money.

export interface SavingsLedSplit {
  /** Projected ending value (nominal/future shillings). */
  projectedFinalValue: number;
  /** Sum of all contributions paid in over the horizon (KES). */
  totalContributions: number;
  /** Opening principal already in the pot at the start (KES). */
  startingPrincipal: number;
  /** Total principal you put in = startingPrincipal + totalContributions (KES). */
  principalIn: number;
  /** Return earned = projectedFinalValue − principalIn (KES); floored at 0. */
  returnEarned: number;
  /** Return as a share (0..1) of the ending value: returnEarned / projectedFinalValue. */
  returnShare: number;
  /** Principal as a share (0..1) of the ending value: principalIn / projectedFinalValue. */
  principalShare: number;
  /**
   * True when principal dominates (returnShare below `savingsLedThreshold`), i.e.
   * the plan is primarily structured-savings rather than investment-led.
   */
  isSavingsLed: boolean;
}

/** Below this return share the plan is "savings-led" (principal does most of the work). */
export const SAVINGS_LED_THRESHOLD = 0.35;

/**
 * Compute the savings-vs-investing split of the projected ending value.
 *
 * returnShare = (projectedFinalValue − totalContributions − startingPrincipal) / projectedFinalValue
 *
 * The result is the share of the ENDING VALUE attributable to investment return
 * (everything else is principal you saved). Pure so the tRPC query and unit tests
 * share one source of truth.
 */
export function computeSavingsLedSplit(opts: {
  projectedFinalValue: number;
  totalContributions: number;
  startingPrincipal?: number;
  savingsLedThreshold?: number;
}): SavingsLedSplit {
  const projectedFinalValue = Math.max(0, Number(opts.projectedFinalValue) || 0);
  const totalContributions = Math.max(0, Number(opts.totalContributions) || 0);
  const startingPrincipal = Math.max(0, Number(opts.startingPrincipal) || 0);
  const threshold = opts.savingsLedThreshold ?? SAVINGS_LED_THRESHOLD;

  const principalIn = startingPrincipal + totalContributions;
  const returnEarned = Math.max(0, projectedFinalValue - principalIn);
  const returnShare = projectedFinalValue > 0 ? returnEarned / projectedFinalValue : 0;
  const principalShare = projectedFinalValue > 0 ? Math.min(1, principalIn / projectedFinalValue) : 0;

  return {
    projectedFinalValue: Math.round(projectedFinalValue),
    totalContributions: Math.round(totalContributions),
    startingPrincipal: Math.round(startingPrincipal),
    principalIn: Math.round(principalIn),
    returnEarned: Math.round(returnEarned),
    returnShare,
    principalShare,
    isSavingsLed: returnShare < threshold,
  };
}
