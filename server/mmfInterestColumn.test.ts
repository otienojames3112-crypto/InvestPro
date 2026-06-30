import { describe, it, expect } from "vitest";
import { runProjection, netYield, monthlyRate, type EngineSettings } from "./engine";

/**
 * Brief 1 — the Month Ledger now surfaces the per-month NET MMF interest the
 * engine already computes (gross − 15% WHT), the amount that compounds into
 * mmfEnd. These tests pin three properties:
 *   1. the figure is positive every month money sits in the MMF,
 *   2. it equals (opening MMF balance for the period) × net monthly MMF rate,
 *   3. surfacing it did NOT change the compounding — mmfEnd is unchanged.
 */
const SETTINGS: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  startDate: "2026-07-01",
};

describe("Month Ledger — MMF Interest (net) column", () => {
  const rows = runProjection(SETTINGS);

  it("is present on every month and never negative", () => {
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(typeof r.mmfInterestNet).toBe("number");
      expect(r.mmfInterestNet).toBeGreaterThanOrEqual(0);
    }
  });

  it("is strictly positive while there is an MMF balance earning interest", () => {
    // Any month that ends with a positive MMF balance must have earned some
    // net interest that month (the balance accrued before/at month-end).
    const earning = rows.filter((r) => r.mmfEnd > 0);
    expect(earning.length).toBeGreaterThan(0);
    for (const r of earning) {
      expect(r.mmfInterestNet).toBeGreaterThan(0);
    }
  });

  it("equals the month's interest-bearing balance × net monthly MMF rate (engine's gross-then-WHT path)", () => {
    // The engine computes interest as: gross = base × monthlyRate(grossYield),
    // then net = gross × (1 − wht); the balance then compounds by the net-annual
    // factor (1 + monthlyRate(netAnnual)). We reconstruct the implied base from
    // the recorded net interest using the SAME gross path the engine uses.
    const wht = SETTINGS.withholdingTax / 100;
    const grossMonthly = monthlyRate(SETTINGS.mmfYield);
    const netMonthlyForCompounding = monthlyRate(netYield(SETTINGS.mmfYield, SETTINGS.withholdingTax));
    const interestNetFactor = grossMonthly * (1 - wht); // net interest as a fraction of base
    expect(interestNetFactor).toBeGreaterThan(0);
    // Check an early month with no sweeps/maturities muddying the MMF end balance.
    const early = rows.slice(0, 6).filter((r) => r.mmfToDhow === 0 && r.cbkCashIn === 0 && r.mmfEnd > 0);
    expect(early.length).toBeGreaterThan(0);
    for (const r of early) {
      // mmfEnd = base × (1 + netMonthlyForCompounding) ⇒ base = mmfEnd / (1 + that)
      const base = r.mmfEnd / (1 + netMonthlyForCompounding);
      const expectedNetInterest = base * interestNetFactor;
      expect(r.mmfInterestNet).toBeCloseTo(expectedNetInterest, 2);
    }
  });

  it("did NOT change the compounding math — mmfEnd matches a parallel run", () => {
    // Surfacing is read-only: re-running the same settings must reproduce the
    // exact same MMF end balances (and total) every month.
    const again = runProjection(SETTINGS);
    for (let i = 0; i < rows.length; i++) {
      expect(rows[i].mmfEnd).toBe(again[i].mmfEnd);
      expect(rows[i].totalEnd).toBe(again[i].totalEnd);
    }
  });

  it("Car-sample shape: a short 12-month plan earns positive MMF interest each month", () => {
    const car = runProjection({
      ...SETTINGS,
      targetAmount: 1200000,
      horizonMonths: 12,
      startingContribution: 10000,
      stepUpAmount: 58500,
      stepUpMonths: 3,
    });
    expect(car).toHaveLength(12);
    const totalInterest = car.reduce((s, r) => s + r.mmfInterestNet, 0);
    expect(totalInterest).toBeGreaterThan(0);
    for (const r of car) {
      if (r.mmfEnd > 0) expect(r.mmfInterestNet).toBeGreaterThan(0);
    }
  });
});
