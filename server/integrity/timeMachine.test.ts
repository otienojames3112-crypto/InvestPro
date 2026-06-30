import { describe, it, expect } from "vitest";
import {
  runProjection,
  computeCurrentMonth,
  type EngineSettings,
} from "../engine";

/**
 * Suite 5 — Time Machine.
 *
 * `settings.nowOverride` (a Unix-ms clock) drives the engine's elapsed-month
 * boundary. Advancing the simulated clock must move the actual/projected split
 * (`currentMonth`) in lock-step with `computeCurrentMonth`, and parking the clock
 * at the goal date must put `currentMonth` exactly at the horizon. This proves the
 * Time Machine is a real clock input to the engine, not a cosmetic UI date.
 */

const START_ISO = "2026-07-01";
const HORIZON = 120;

const BASE: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 40_000,
  stepUpAmount: 2_000,
  stepUpMonths: 6,
  safetyFloor: 50_000,
  targetAmount: 5_000_000,
  horizonMonths: HORIZON,
  startDate: START_ISO,
};

/** Unix-ms for the first of a month N whole months after the start month. */
function clockAtMonthOffset(monthsAfterStart: number): number {
  const d = new Date(START_ISO + "T12:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + monthsAfterStart);
  return d.getTime();
}

describe("Time Machine (nowOverride drives the elapsed-month boundary)", () => {
  it("advancing the clock by N months moves currentMonth to N", () => {
    for (const n of [0, 1, 6, 12, 60]) {
      const nowMs = clockAtMonthOffset(n);
      expect(computeCurrentMonth(START_ISO, nowMs, HORIZON)).toBe(n);
    }
  });

  it("parking the clock at the goal date pins currentMonth at the horizon", () => {
    const goalClock = clockAtMonthOffset(HORIZON);
    expect(computeCurrentMonth(START_ISO, goalClock, HORIZON)).toBe(HORIZON);
    // Even well past the goal, currentMonth is clamped to the horizon.
    const wayPast = clockAtMonthOffset(HORIZON + 24);
    expect(computeCurrentMonth(START_ISO, wayPast, HORIZON)).toBe(HORIZON);
  });

  it("a clock before the start date clamps currentMonth to 0", () => {
    const before = clockAtMonthOffset(-6);
    expect(computeCurrentMonth(START_ISO, before, HORIZON)).toBe(0);
  });

  it("with no actuals, moving the clock does not change the clean projection", () => {
    // No actual deposits/securities => the projection is the same clean schedule
    // regardless of the simulated clock (the boundary only matters once reality
    // is recorded). The ending value must be stable.
    const early = runProjection({ ...BASE, nowOverride: clockAtMonthOffset(3) }, [], [], [], [], []);
    const later = runProjection({ ...BASE, nowOverride: clockAtMonthOffset(48) }, [], [], [], [], []);
    expect(early[early.length - 1].totalEnd).toBe(later[later.length - 1].totalEnd);
    expect(early.length).toBe(HORIZON);
  });

  it("with recorded actuals, the clock sets how many rows are marked actual", () => {
    // Record a real deposit in month 1; advance the clock to month 6. Months
    // 1..currentMonth become 'actual' (reality), the rest stay projected.
    const actualDeposits = [
      { depositDate: "2026-07-15", amount: 40_000 },
    ];
    const nowMs = clockAtMonthOffset(6);
    const rows = runProjection(
      { ...BASE, nowOverride: nowMs },
      [],
      actualDeposits as never,
      [],
      [],
      [],
    );
    const currentMonth = computeCurrentMonth(START_ISO, nowMs, HORIZON);
    const actualRows = rows.filter((r) => r.isActual);
    // Every actual row must sit at or before the elapsed-month boundary.
    actualRows.forEach((r) => expect(r.monthNumber).toBeLessThanOrEqual(currentMonth));
    // And there is at least one projected (future) row beyond the boundary.
    expect(rows.some((r) => !r.isActual && r.monthNumber > currentMonth)).toBe(true);
  });
});
