import { describe, it, expect } from "vitest";
import {
  simulateAccrualDated,
  ratesOnDate,
  geometricDailyRate,
  type AccrualRatePoint,
} from "../../shared/accrual";

/**
 * Suite 7 — Rate effective date.
 *
 * A mid-month MMF rate change must split the accrual cleanly by date: every day
 * BEFORE the effective date uses the old EAR/WHT, and every day FROM the
 * effective date forward uses the new EAR/WHT. The day-level applied rates and
 * the gross-interest amounts must reflect that boundary exactly. This proves the
 * rate is honoured by calendar date, not retroactively applied to the whole
 * period.
 */

const START = "2026-07-01";
const DAY_COUNT = 365;
const FALLBACK = { ear: 9.0, whtRate: 15 };

// Old rate from the start; new (higher) rate from the 16th.
const HISTORY: AccrualRatePoint[] = [
  { effectiveDate: "2026-07-01", ear: 9.0, whtRate: 15 },
  { effectiveDate: "2026-07-16", ear: 12.0, whtRate: 10 },
];

describe("rate effective date (mid-month change splits accrual by date)", () => {
  it("ratesOnDate returns the OLD rate before the change and NEW from the change date", () => {
    expect(ratesOnDate("2026-07-15", HISTORY, FALLBACK)).toEqual({ ear: 9.0, whtRate: 15 });
    // The effective date itself uses the new rate (>= comparison).
    expect(ratesOnDate("2026-07-16", HISTORY, FALLBACK)).toEqual({ ear: 12.0, whtRate: 10 });
    expect(ratesOnDate("2026-07-31", HISTORY, FALLBACK)).toEqual({ ear: 12.0, whtRate: 10 });
  });

  it("a date before all history falls back to the earliest known point", () => {
    expect(ratesOnDate("2026-06-01", HISTORY, FALLBACK)).toEqual({ ear: 9.0, whtRate: 15 });
  });

  it("days before the change apply the old EAR/WHT; days from the change apply the new ones", () => {
    const rows = simulateAccrualDated(1_000_000, START, DAY_COUNT, 31, HISTORY, FALLBACK);
    // Day 1..15 = Jul 1..15 (old rate). Day 16 = Jul 16 (new rate).
    const beforeChange = rows.filter((r) => r.date! < "2026-07-16");
    const fromChange = rows.filter((r) => r.date! >= "2026-07-16");
    expect(beforeChange.length).toBe(15);
    expect(fromChange.length).toBe(16);

    beforeChange.forEach((r) => {
      expect(r.appliedEar).toBe(9.0);
      expect(r.appliedWht).toBe(15);
    });
    fromChange.forEach((r) => {
      expect(r.appliedEar).toBe(12.0);
      expect(r.appliedWht).toBe(10);
    });
  });

  it("the per-day gross interest jumps to the new geometric daily rate on the change date", () => {
    const rows = simulateAccrualDated(1_000_000, START, DAY_COUNT, 31, HISTORY, FALLBACK);
    const lastOld = rows.find((r) => r.date === "2026-07-15")!;
    const firstNew = rows.find((r) => r.date === "2026-07-16")!;

    // gross = openingBalance * geometricDailyRate(ear). The new rate is higher,
    // so the new day's gross/opening ratio must equal the NEW daily rate.
    const oldDaily = geometricDailyRate(9.0, DAY_COUNT);
    const newDaily = geometricDailyRate(12.0, DAY_COUNT);
    expect(lastOld.grossInterest / lastOld.openingBalance).toBeCloseTo(oldDaily, 10);
    expect(firstNew.grossInterest / firstNew.openingBalance).toBeCloseTo(newDaily, 10);
    expect(newDaily).toBeGreaterThan(oldDaily);
  });

  it("the WHT fraction on each day matches the rate in force that day", () => {
    const rows = simulateAccrualDated(1_000_000, START, DAY_COUNT, 31, HISTORY, FALLBACK);
    const oldDay = rows.find((r) => r.date === "2026-07-10")!;
    const newDay = rows.find((r) => r.date === "2026-07-20")!;
    expect(oldDay.wht / oldDay.grossInterest).toBeCloseTo(0.15, 10);
    expect(newDay.wht / newDay.grossInterest).toBeCloseTo(0.10, 10);
  });

  it("net interest compounds continuously across the rate boundary (no reset)", () => {
    const rows = simulateAccrualDated(1_000_000, START, DAY_COUNT, 31, HISTORY, FALLBACK);
    // Each day's opening balance equals the previous day's closing balance —
    // the rate change does not reset or drop accrued interest.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].openingBalance).toBeCloseTo(rows[i - 1].closingBalance, 8);
    }
    // Final balance strictly exceeds principal (interest was earned).
    expect(rows[rows.length - 1].closingBalance).toBeGreaterThan(1_000_000);
  });
});
