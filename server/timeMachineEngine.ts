/**
 * Time Machine — materialisation planner (server, sandbox only).
 *
 * Turns the engine's projected months into concrete DB "write specs" for the
 * months a clock advance has newly turned from FUTURE into PAST. The router then
 * executes those specs (tagging every row with the active session id).
 *
 * ── Why we only materialise CONTRIBUTIONS ──────────────────────────────────────
 * The projection engine already derives maturities, coupons, sweeps and accrual
 * deterministically from the existing securities + the (now-advanced) clock
 * boundary. If we also wrote maturity/sweep rows we would DOUBLE-COUNT against the
 * engine's own forward modelling. The one genuinely exogenous cash event the
 * engine seeds from actuals is the monthly CONTRIBUTION — money the saver puts in.
 * So "accept plan as actual" records exactly those contributions as real MMF
 * deposits; everything else (interest growth, instrument settlement) continues to
 * flow from the engine re-forecast off the new boundary. This is what makes a big
 * fast-forward identical to many small day-by-day steps: the engine recomputes the
 * same way regardless of step size, and the only added actuals — contributions —
 * are additive and order-independent.
 *
 * "accrue_only" returns NO specs (clock-move only). "inject_variance" returns the
 * same contribution specs with a multiplicative factor applied.
 */

import type { MonthResult } from "./engine";
import { applyVariance, formatUtcDate, type MaterializeMode, type VarianceSpec } from "../shared/timeMachine";

/** A single MMF contribution deposit to write, dated within an elapsed month. */
export interface ContributionWriteSpec {
  /** 1-based engine month number this contribution belongs to. */
  monthNumber: number;
  /** Deposit amount (KES), variance already applied. */
  amount: number;
  /** Deposit date as YYYY-MM-DD (the month boundary that just elapsed). */
  depositDate: string;
  /** Narration recorded on the deposit row. */
  notes: string;
}

export interface MaterializePlan {
  specs: ContributionWriteSpec[];
  /** Total contribution KES that will be written. */
  totalContribution: number;
  /** Number of whole months that newly elapsed. */
  monthsElapsed: number;
}

/**
 * Compute the calendar date for the START of engine month `monthNumber` given the
 * plan start date. Month 1 == startDate; month N == startDate + (N-1) months.
 * Returns a YYYY-MM-DD string (UTC).
 */
export function monthStartDate(startDateIso: string, monthNumber: number): string {
  const start = new Date(startDateIso + "T00:00:00Z");
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const day = start.getUTCDate();
  const targetMonthIndex = m + (monthNumber - 1);
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  // Clamp the day to the last day of the target month so a month-end start date
  // (e.g. Nov 30 + 3mo) lands on Feb 28/29 rather than overflowing into March.
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDay);
  return formatUtcDate(Date.UTC(targetYear, targetMonth, clampedDay));
}

/**
 * Build the materialisation plan for a clock advance.
 *
 * @param months        The engine's month results (full horizon) computed at the
 *                      NEW boundary. We read each month's `contribution`.
 * @param startDateIso  Plan start date (YYYY-MM-DD) — used to date each deposit.
 * @param prevMonthIdx  `currentMonth` BEFORE the advance (months already elapsed).
 * @param nextMonthIdx  `currentMonth` AFTER the advance.
 * @param mode          accrue_only | accept_plan | inject_variance.
 * @param variance      Optional factors when mode === inject_variance.
 */
export function buildMaterializePlan(
  months: MonthResult[],
  startDateIso: string,
  prevMonthIdx: number,
  nextMonthIdx: number,
  mode: MaterializeMode,
  variance?: VarianceSpec,
): MaterializePlan {
  const monthsElapsed = Math.max(0, nextMonthIdx - prevMonthIdx);
  if (mode === "accrue_only" || monthsElapsed === 0) {
    return { specs: [], totalContribution: 0, monthsElapsed };
  }

  const factor = mode === "inject_variance" ? variance?.contributionFactor : undefined;
  const specs: ContributionWriteSpec[] = [];
  let total = 0;

  // Engine month numbers are 1-based; `currentMonth` is a count of elapsed months.
  // Advancing from prevMonthIdx -> nextMonthIdx newly realises months
  // (prevMonthIdx+1 .. nextMonthIdx).
  for (let m = prevMonthIdx + 1; m <= nextMonthIdx; m++) {
    const mr = months.find((x) => x.monthNumber === m);
    if (!mr) continue;
    const planned = Math.max(0, mr.contribution || 0);
    if (planned <= 0) continue;
    const amount = Math.round(applyVariance(planned, factor) * 100) / 100;
    if (amount <= 0) continue;
    total += amount;
    const note =
      mode === "inject_variance" && factor != null && factor !== 1
        ? `Time Machine: month ${m} contribution (variance ${(factor * 100).toFixed(0)}% of plan)`
        : `Time Machine: month ${m} contribution (accepted from plan)`;
    specs.push({
      monthNumber: m,
      amount,
      depositDate: monthStartDate(startDateIso, m),
      notes: note,
    });
  }

  return { specs, totalContribution: Math.round(total * 100) / 100, monthsElapsed };
}
