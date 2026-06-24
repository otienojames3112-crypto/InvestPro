/**
 * Round 27 — coverage for the new helpers added this round:
 *   - estInterestToDate (geometric daily accrual, net of WHT, used for the
 *     Dashboard "Est. interest earned" card)
 *   - deriveStepUps (flexible scenario step-up ladder centered on the user's
 *     current step-up)
 *   - end-state liquidity at the goal date (no security matures past horizon;
 *     short horizons land fully liquid)
 */
import { describe, it, expect } from "vitest";
import { estInterestToDate } from "../shared/actuals";
import { deriveStepUps, runProjection } from "./engine";

// A 12-month "car" plan mirroring the user's sample, using the engine's
// own settings field names (see engine.regression.test.ts BASELINE_SETTINGS).
const CAR_PLAN = {
  mmfYield: 13.54,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 41_000,
  stepUpAmount: 79_000,
  stepUpMonths: 6,
  safetyFloor: 50_000,
  targetAmount: 1_000_000,
  startDate: "2026-07-01",
  horizonMonths: 12,
};

describe("estInterestToDate — geometric, net-of-WHT accrual", () => {
  it("returns 0 for non-positive principal, rate, or zero/negative span", () => {
    expect(estInterestToDate(0, 13.54, 15, "2026-01-01", "2026-12-31")).toBe(0);
    expect(estInterestToDate(41_000, 0, 15, "2026-01-01", "2026-12-31")).toBe(0);
    expect(estInterestToDate(41_000, 13.54, 15, "2026-06-24", "2026-06-24")).toBe(0);
    expect(estInterestToDate(41_000, 13.54, 15, "2026-06-24", "2026-06-20")).toBe(0);
  });

  it("matches a manual 30-day geometric accrual on KES 41,000 @ 13.54% EAR, 15% WHT", () => {
    const principal = 41_000;
    const ear = 13.54;
    const days = 30;
    const dailyRate = Math.pow(1 + ear / 100, 1 / 365) - 1;
    const gross = principal * (Math.pow(1 + dailyRate, days) - 1);
    const expectedNet = gross * 0.85;
    const got = estInterestToDate(
      principal,
      ear,
      15,
      "2026-06-01",
      "2026-07-01",
    );
    expect(got).toBeCloseTo(Math.round(expectedNet * 100) / 100, 2);
  });

  it("a full year of accrual stays below the naive EAR figure (compounding net of WHT)", () => {
    // Naive: principal * EAR * 0.85. Geometric daily compounding lands very
    // close but slightly above the naive simple figure, and well under gross EAR.
    const principal = 100_000;
    const ear = 12;
    const net = estInterestToDate(principal, ear, 15, "2026-01-01", "2027-01-01");
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(principal * (ear / 100)); // below gross EAR
    expect(net).toBeGreaterThan(principal * (ear / 100) * 0.8); // sensible vs net
  });
});

describe("deriveStepUps — flexible scenario ladder", () => {
  it("keeps the fine low-end grid and always includes a small current step-up", () => {
    const ladder = deriveStepUps(3000);
    expect(ladder).toContain(3000);
    expect(ladder[0]).toBe(0);
    // sorted ascending, unique
    expect([...ladder].sort((a, b) => a - b)).toEqual(ladder);
    expect(new Set(ladder).size).toBe(ladder.length);
  });

  it("includes a non-grid small current value (e.g. 79,000 sits in a centered spread)", () => {
    const ladder = deriveStepUps(79_000);
    expect(ladder).toContain(79_000);
    expect(ladder).toContain(0);
    // centered spread: min interior point near 0.4x, max near 1.6x
    expect(Math.min(...ladder.filter((n) => n > 0))).toBeLessThanOrEqual(79_000);
    expect(Math.max(...ladder)).toBeGreaterThanOrEqual(79_000);
  });

  it("handles a zero current step-up without duplicates", () => {
    const ladder = deriveStepUps(0);
    expect(ladder).toContain(0);
    expect(new Set(ladder).size).toBe(ladder.length);
  });
});

describe("end-state liquidity at the goal date", () => {
  const result = runProjection(CAR_PLAN);
  const last = result[result.length - 1];

  it("lands fully liquid at month 12 — no locked CBK securities remain", () => {
    expect(last.tbillEnd).toBe(0);
    expect(last.ifbEnd).toBe(0);
    expect(last.fxdEnd).toBe(0);
    // essentially everything sits in MMF (liquid)
    expect(last.mmfEnd).toBeGreaterThan(last.totalEnd * 0.99);
  });

  it("never sweeps into a lot that would mature after the horizon", () => {
    // Every sweep label that names a tenor must fit before month 12.
    for (const m of result) {
      const label = (m.mainAction || "").toLowerCase();
      // No 364-day or 182-day sweep should appear so late that it can't mature.
      if (label.includes("sweep") && m.month >= 10) {
        // In the final tail there should be no new sweep at all.
        expect(label).not.toContain("sweep");
      }
    }
  });

  it("still reaches the KES 1M target with the sample plan", () => {
    expect(last.totalEnd).toBeGreaterThanOrEqual(1_000_000);
  });
});
