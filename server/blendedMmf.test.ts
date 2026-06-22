import { describe, it, expect } from "vitest";
import { simulateAccrual, type DayRow } from "../shared/accrual";

/**
 * Round 15 — multi-MMF blended view.
 *
 * The Accrual page renders a "Blended" mode that runs the (unchanged) per-fund
 * `simulateAccrual` engine once per MMF account and then sums the daily rows
 * element-wise. These tests lock in the invariant that the blended totals are
 * exactly the arithmetic sum of the independent per-fund runs — i.e. the blend
 * introduces no new math, only aggregation.
 */

/** Mirror of the client-side blended aggregation (pure, for testing). */
function blendDailyRows(runs: DayRow[][], days: number): DayRow[] {
  const out: DayRow[] = [];
  for (let i = 0; i < days; i++) {
    let openingBalance = 0, grossInterest = 0, wht = 0, netInterest = 0, closingBalance = 0;
    for (const rows of runs) {
      const r = rows[i];
      if (!r) continue;
      openingBalance += r.openingBalance;
      grossInterest += r.grossInterest;
      wht += r.wht;
      netInterest += r.netInterest;
      closingBalance += r.closingBalance;
    }
    out.push({ day: i + 1, openingBalance, grossInterest, wht, netInterest, closingBalance });
  }
  return out;
}

describe("Blended MMF accrual", () => {
  const days = 30;
  // Three accounts with distinct balances, yields, day-counts, WHT, crediting.
  const accounts = [
    { balance: 500_000, ear: 9.2, dayCount: 365, wht: 15, crediting: "daily" as const },
    { balance: 250_000, ear: 11.4, dayCount: 360, wht: 15, crediting: "daily" as const },
    { balance: 120_000, ear: 8.0, dayCount: 365, wht: 10, crediting: "monthly" as const },
  ];

  const runs = accounts.map((a) =>
    simulateAccrual(a.balance, a.ear, a.dayCount, a.wht, a.crediting, days)
  );

  it("blended daily closing balance equals the sum of per-fund closing balances", () => {
    const blended = blendDailyRows(runs, days);
    for (let i = 0; i < days; i++) {
      const expected = runs.reduce((s, r) => s + r[i].closingBalance, 0);
      expect(blended[i].closingBalance).toBeCloseTo(expected, 6);
    }
  });

  it("blended period totals equal the sum of per-fund totals", () => {
    const blended = blendDailyRows(runs, days);
    const sum = (rows: DayRow[], key: keyof DayRow) =>
      rows.reduce((s, r) => s + (r[key] as number), 0);

    const blendedGross = sum(blended, "grossInterest");
    const blendedWht = sum(blended, "wht");
    const blendedNet = sum(blended, "netInterest");

    const expectedGross = runs.reduce((s, r) => s + sum(r, "grossInterest"), 0);
    const expectedWht = runs.reduce((s, r) => s + sum(r, "wht"), 0);
    const expectedNet = runs.reduce((s, r) => s + sum(r, "netInterest"), 0);

    expect(blendedGross).toBeCloseTo(expectedGross, 6);
    expect(blendedWht).toBeCloseTo(expectedWht, 6);
    expect(blendedNet).toBeCloseTo(expectedNet, 6);
    // Net = Gross − WHT must hold for the blend as well.
    expect(blendedNet).toBeCloseTo(blendedGross - blendedWht, 6);
  });

  it("blended starting balance equals the sum of account balances", () => {
    const blended = blendDailyRows(runs, days);
    const expectedStart = accounts.reduce((s, a) => s + a.balance, 0);
    expect(blended[0].openingBalance).toBeCloseTo(expectedStart, 6);
  });

  it("a single-account blend is identical to that account's own run", () => {
    const single = simulateAccrual(500_000, 9.2, 365, 15, "daily", days);
    const blended = blendDailyRows([single], days);
    for (let i = 0; i < days; i++) {
      expect(blended[i].closingBalance).toBeCloseTo(single[i].closingBalance, 6);
      expect(blended[i].netInterest).toBeCloseTo(single[i].netInterest, 6);
    }
  });
});
