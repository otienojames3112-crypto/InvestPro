import { describe, it, expect } from "vitest";
import {
  runProjection,
  monthlyRate,
  type EngineSettings,
  type SecondaryMmfInput,
} from "./engine";

const BASE: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.8206,
  tbill182Rate: 8.7782,
  tbill364Rate: 8.9746,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  startDate: "2026-07-01",
  horizonMonths: 120,
};

describe("secondary MMF forward projection", () => {
  it("does not change totals when no secondaries are supplied", () => {
    const without = runProjection(BASE);
    const withEmpty = runProjection(BASE, [], [], [], [], []);
    expect(withEmpty[withEmpty.length - 1].totalEnd).toBeCloseTo(
      without[without.length - 1].totalEnd,
      2
    );
    // secondaryMmfEnd should always be present and zero here
    expect(withEmpty[withEmpty.length - 1].secondaryMmfEnd).toBe(0);
  });

  it("increases the portfolio total when a secondary MMF is present", () => {
    const secondaries: SecondaryMmfInput[] = [
      { currentBalance: 350000, monthlyContribution: 5000, ear: 12, whtRate: 15 },
    ];
    const base = runProjection(BASE);
    const withSec = runProjection(BASE, [], [], [], [], secondaries);
    const lastBase = base[base.length - 1].totalEnd;
    const lastSec = withSec[withSec.length - 1].totalEnd;
    expect(lastSec).toBeGreaterThan(lastBase);
    // The uplift must equal the secondary's own projected balance.
    expect(lastSec - lastBase).toBeCloseTo(
      withSec[withSec.length - 1].secondaryMmfEnd,
      1
    );
  });

  it("matches an independent net-compounding calculation for a single secondary", () => {
    const ear = 12;
    const wht = 15;
    const contribution = 5000;
    const startBalance = 100000;
    const secondaries: SecondaryMmfInput[] = [
      { currentBalance: startBalance, monthlyContribution: contribution, ear, whtRate: wht },
    ];
    const results = runProjection(BASE, [], [], [], [], secondaries);

    // Replicate the engine's exact per-month logic: add contribution, compound
    // on the GROSS monthly rate, then withhold tax on the interest portion.
    const grossMonthly = monthlyRate(ear);
    const whtFrac = wht / 100;
    let bal = startBalance;
    for (let m = 1; m <= (BASE.horizonMonths ?? 120); m++) {
      bal += contribution;
      const grossInterest = bal * grossMonthly;
      const netInterest = grossInterest * (1 - whtFrac);
      bal += netInterest;
    }
    expect(results[results.length - 1].secondaryMmfEnd).toBeCloseTo(bal, 0);
  });

  it("sums multiple secondaries with independent yields", () => {
    const secondaries: SecondaryMmfInput[] = [
      { currentBalance: 200000, monthlyContribution: 0, ear: 10, whtRate: 15 },
      { currentBalance: 150000, monthlyContribution: 2000, ear: 13, whtRate: 15 },
    ];
    const combined = runProjection(BASE, [], [], [], [], secondaries);
    const onlyA = runProjection(BASE, [], [], [], [], [secondaries[0]]);
    const onlyB = runProjection(BASE, [], [], [], [], [secondaries[1]]);
    const last = (r: ReturnType<typeof runProjection>) => r[r.length - 1].secondaryMmfEnd;
    expect(last(combined)).toBeCloseTo(last(onlyA) + last(onlyB), 1);
  });
});
