/**
 * Regression: Dashboard "Needs attention" — the missed-contribution alert must
 * CLEAR once the user records a contribution into ANY destination that month,
 * not only the primary MMF.
 *
 * Root cause (fixed): the snapshot's per-month `actual` contribution only summed
 * PRIMARY-MMF deposits. A contribution into a secondary MMF, a bank instrument,
 * or a government security left `actual = 0`, so the amber "This month's
 * contribution not recorded" alert never cleared.
 *
 * Fix: `ContributionPlanPoint.actualAllDestinations` sums money committed across
 * every destination, bucketed by the engine's 1-based month index. The Dashboard
 * alert + "recorded so far" strip read this figure. This suite pins the pure
 * helper (`contributedByMonthAllDestinations`) that produces it.
 */
import { describe, it, expect } from "vitest";
import { contributedByMonthAllDestinations } from "../snapshot";

// A portfolio that started 2 months ago, so month 1 and month 2 are elapsed.
const START_ISO = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  d.setDate(1);
  return d.toISOString().split("T")[0];
})();

// An ISO date inside the current (2nd-elapsed) month.
const THIS_MONTH_ISO = (() => {
  const d = new Date();
  d.setDate(Math.min(15, 28));
  return d.toISOString().split("T")[0];
})();

const ELAPSED = 2;

describe("Needs attention clears — all-destination contribution", () => {
  it("counts a BANK deposit this month even when primary MMF is zero", () => {
    const byMonth = contributedByMonthAllDestinations({
      startIso: START_ISO,
      elapsedMonths: ELAPSED,
      deposits: [], // no MMF deposits at all
      securities: [],
      bankHoldings: [
        { startDate: THIS_MONTH_ISO, principal: 41_000, isActive: true },
      ],
    });
    // Bucketed into the current elapsed month (2), positive -> alert clears.
    expect(byMonth.get(ELAPSED) ?? 0).toBe(41_000);
  });

  it("counts a SECONDARY-MMF / other deposit this month (any deposit row)", () => {
    const byMonth = contributedByMonthAllDestinations({
      startIso: START_ISO,
      elapsedMonths: ELAPSED,
      deposits: [{ depositDate: THIS_MONTH_ISO, amount: 25_000 }],
      securities: [],
      bankHoldings: [],
    });
    expect(byMonth.get(ELAPSED) ?? 0).toBe(25_000);
  });

  it("counts a GOVERNMENT-SECURITY purchase at its cash committed (purchase price for discounts)", () => {
    const byMonth = contributedByMonthAllDestinations({
      startIso: START_ISO,
      elapsedMonths: ELAPSED,
      deposits: [],
      securities: [
        {
          issueDate: THIS_MONTH_ISO,
          faceValue: 50_000,
          purchasePrice: 48_924.11, // discount T-bill: cash out is the price, not face
          isMatured: false,
        },
      ],
      bankHoldings: [],
    });
    expect(byMonth.get(ELAPSED) ?? 0).toBeCloseTo(48_924.11, 2);
  });

  it("uses FACE value when a security has no recorded purchase price (coupon bond)", () => {
    const byMonth = contributedByMonthAllDestinations({
      startIso: START_ISO,
      elapsedMonths: ELAPSED,
      deposits: [],
      securities: [
        { issueDate: THIS_MONTH_ISO, faceValue: 100_000, purchasePrice: null, isMatured: false },
      ],
      bankHoldings: [],
    });
    expect(byMonth.get(ELAPSED) ?? 0).toBe(100_000);
  });

  it("nets out a withdrawal recorded in the same month (deposit − withdrawal)", () => {
    const byMonth = contributedByMonthAllDestinations({
      startIso: START_ISO,
      elapsedMonths: ELAPSED,
      // A deposit and a corrective withdrawal (mapped as negative) net to zero.
      deposits: [
        { depositDate: THIS_MONTH_ISO, amount: 30_000 },
        { depositDate: THIS_MONTH_ISO, amount: -30_000 },
      ],
      securities: [],
      bankHoldings: [],
    });
    expect(byMonth.get(ELAPSED) ?? 0).toBe(0);
  });

  it("ignores matured securities and inactive bank instruments", () => {
    const byMonth = contributedByMonthAllDestinations({
      startIso: START_ISO,
      elapsedMonths: ELAPSED,
      deposits: [],
      securities: [
        { issueDate: THIS_MONTH_ISO, faceValue: 50_000, purchasePrice: 48_000, isMatured: true },
      ],
      bankHoldings: [
        { startDate: THIS_MONTH_ISO, principal: 41_000, isActive: false },
      ],
    });
    expect(byMonth.get(ELAPSED) ?? 0).toBe(0);
  });

  it("clamps a future-dated contribution into the elapsed window (never lost)", () => {
    const future = new Date();
    future.setMonth(future.getMonth() + 6);
    const futureIso = future.toISOString().split("T")[0];
    const byMonth = contributedByMonthAllDestinations({
      startIso: START_ISO,
      elapsedMonths: ELAPSED,
      deposits: [{ depositDate: futureIso, amount: 12_000 }],
      securities: [],
      bankHoldings: [],
    });
    // Clamped to the last elapsed month, so it still counts (alert can clear).
    expect(byMonth.get(ELAPSED) ?? 0).toBe(12_000);
  });

  it("aggregates ALL destinations in the same month into one total", () => {
    const byMonth = contributedByMonthAllDestinations({
      startIso: START_ISO,
      elapsedMonths: ELAPSED,
      deposits: [{ depositDate: THIS_MONTH_ISO, amount: 10_000 }],
      securities: [
        { issueDate: THIS_MONTH_ISO, faceValue: 20_000, purchasePrice: null, isMatured: false },
      ],
      bankHoldings: [{ startDate: THIS_MONTH_ISO, principal: 15_000, isActive: true }],
    });
    expect(byMonth.get(ELAPSED) ?? 0).toBe(45_000);
  });
});
