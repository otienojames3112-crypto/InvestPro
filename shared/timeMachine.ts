/**
 * Time Machine — pure date/step math (sandbox only).
 *
 * This module holds ONLY deterministic, side-effect-free helpers so they can be
 * unit-tested in isolation and reused on both client and server. All DB writes,
 * record materialisation, and the engine re-forecast live in the server router;
 * here we only answer "given a current simulated instant, what is the next one?"
 * and "which projected events fall between two instants?".
 *
 * Time base: every instant is a UTC Unix-ms number. We deliberately normalise to
 * UTC midnight so day/month/year stepping is calendar-stable regardless of the
 * viewer's timezone — the simulated clock is a *calendar* position, not a
 * wall-clock moment.
 */

export type StepUnit = "day" | "week" | "month" | "year";

/** A future event the clock can jump to (maturity, coupon, contribution). */
export interface SimEvent {
  /** UTC Unix-ms (normalised to midnight) when the event occurs. */
  at: number;
  /** Event family — drives the icon/label in the jump menu. */
  kind: "maturity" | "coupon" | "contribution" | "month-end";
  /** Human-readable one-liner, e.g. "364-day T-bill matures (KES 1,200,000)". */
  label: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Normalise any instant to UTC midnight (00:00:00.000Z) of that calendar day. */
export function toUtcMidnight(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Today (real clock) as a UTC-midnight instant. */
export function todayUtcMidnight(now: number = Date.now()): number {
  return toUtcMidnight(now);
}

/**
 * Advance an instant forward by one unit. Always returns a UTC-midnight instant.
 * Month/year stepping is calendar-correct: clamps the day-of-month so e.g.
 * advancing Jan 31 by a month lands on Feb 28/29, not "Mar 3".
 */
export function advance(fromMs: number, unit: StepUnit, count: number = 1): number {
  const base = toUtcMidnight(fromMs);
  const d = new Date(base);
  const n = Math.max(0, Math.floor(count));
  if (n === 0) return base;
  switch (unit) {
    case "day":
      return base + n * MS_PER_DAY;
    case "week":
      return base + n * 7 * MS_PER_DAY;
    case "month":
      return addCalendarMonths(d, n);
    case "year":
      return addCalendarMonths(d, n * 12);
    default:
      return base;
  }
}

/** Add whole calendar months with day-of-month clamping; returns UTC midnight. */
function addCalendarMonths(d: Date, months: number): number {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const day = d.getUTCDate();
  const targetMonthIndex = m + months;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  // Last day of the target month (day 0 of the next month).
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return Date.UTC(targetYear, targetMonth, clampedDay);
}

/** Whole days between two instants (b - a), using UTC-midnight normalisation. */
export function daysBetween(aMs: number, bMs: number): number {
  return Math.round((toUtcMidnight(bMs) - toUtcMidnight(aMs)) / MS_PER_DAY);
}

/**
 * Given the current simulated instant and a list of upcoming events, return the
 * SOONEST event strictly after `currentMs` (UTC-midnight compare). Returns null
 * when nothing is left in the future — the caller should then fall back to a
 * fixed step or surface "no more events".
 */
export function nextEventAfter(currentMs: number, events: SimEvent[]): SimEvent | null {
  const cur = toUtcMidnight(currentMs);
  let best: SimEvent | null = null;
  for (const e of events) {
    const at = toUtcMidnight(e.at);
    if (at > cur && (best === null || at < toUtcMidnight(best.at))) {
      best = e;
    }
  }
  return best;
}

/** All events with `cur < at <= target`, sorted ascending — what a jump "passes through". */
export function eventsInWindow(currentMs: number, targetMs: number, events: SimEvent[]): SimEvent[] {
  const cur = toUtcMidnight(currentMs);
  const tgt = toUtcMidnight(targetMs);
  return events
    .map((e) => ({ ...e, at: toUtcMidnight(e.at) }))
    .filter((e) => e.at > cur && e.at <= tgt)
    .sort((a, b) => a.at - b.at);
}

/**
 * Clamp a requested jump target so the clock can never move backwards past the
 * session's anchor (real "today" when the session began) and never overshoot a
 * sane horizon cap. Returns the clamped UTC-midnight target.
 */
export function clampTarget(targetMs: number, anchorMs: number, maxYears: number = 60): number {
  const tgt = toUtcMidnight(targetMs);
  const anchor = toUtcMidnight(anchorMs);
  const hardMax = addCalendarMonths(new Date(anchor), maxYears * 12);
  if (tgt < anchor) return anchor;
  if (tgt > hardMax) return hardMax;
  return tgt;
}

/** Parse a YYYY-MM-DD string to a UTC-midnight instant. Returns null if invalid. */
export function parseDateToUtcMidnight(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, mo - 1, d);
  // Round-trip guard against impossible dates (e.g. 2026-02-31).
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/** Format a UTC-midnight instant as YYYY-MM-DD (for DB date columns / labels). */
export function formatUtcDate(ms: number): string {
  return new Date(toUtcMidnight(ms)).toISOString().split("T")[0];
}

/**
 * Materialisation modes (how the time machine treats elapsed projected months):
 *  - "accrue_only": move the clock only. No DB records are written; balances grow
 *    purely through the engine's re-forecast off the new boundary. Fully
 *    reversible by definition (nothing to delete besides the date).
 *  - "accept_plan": write DB actuals equal to what the engine projected for each
 *    newly-elapsed month (contribution deposits, sweep purchases, maturity
 *    settlements), each tagged with the session id. The engine's actuals-seeded
 *    path then reproduces identical totals.
 *  - "inject_variance": like accept_plan, but applies a user-supplied delta to the
 *    realised yield/contribution so the user can stress-test "what if returns came
 *    in X% under plan?". Still fully tagged + reversible.
 */
export type MaterializeMode = "accrue_only" | "accept_plan" | "inject_variance";

export interface VarianceSpec {
  /** Multiplicative factor on realised monthly yield (1 = on plan, 0.9 = 10% under). */
  yieldFactor?: number;
  /** Multiplicative factor on realised monthly contribution (1 = on plan). */
  contributionFactor?: number;
}

/** Apply a variance spec to a planned amount, guarding against negatives. */
export function applyVariance(amount: number, factor: number | undefined): number {
  if (factor == null || !Number.isFinite(factor)) return amount;
  return Math.max(0, amount * factor);
}

/**
 * A single recorded advance "step" for the Undo-last-step feature. Each advance
 * appends one of these to the portfolio's `simStepLog` so we can rewind exactly
 * one boundary (back to `fromMs`) and delete only the deposit rows that step
 * created (`depositIds`), without disturbing earlier steps.
 */
export interface SimStep {
  /** Simulated instant BEFORE this step (UTC Unix-ms). */
  fromMs: number;
  /** Simulated instant AFTER this step (UTC Unix-ms). */
  toMs: number;
  /** Materialisation mode used for this step. */
  mode: MaterializeMode;
  /** Deposit-entry ids this step materialised (empty for accrue_only). */
  depositIds: number[];
}

/** Safely parse a persisted step log (JSON string) into a typed array. */
export function parseStepLog(raw: string | null | undefined): SimStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is SimStep =>
        s != null &&
        typeof s.fromMs === "number" &&
        typeof s.toMs === "number" &&
        typeof s.mode === "string" &&
        Array.isArray(s.depositIds),
    );
  } catch {
    return [];
  }
}

/**
 * Pop the last step off a log, returning the step to undo and the remaining log.
 * Returns { step: null } when there is nothing to undo.
 */
export function popLastStep(log: SimStep[]): { step: SimStep | null; rest: SimStep[] } {
  if (log.length === 0) return { step: null, rest: [] };
  return { step: log[log.length - 1], rest: log.slice(0, -1) };
}
