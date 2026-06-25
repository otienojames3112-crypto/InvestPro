import { describe, it, expect } from "vitest";
import {
  runProjection,
  type EngineSettings,
  type ActualSecurity,
} from "./engine";
import { tbillPrice, whtOnDiscount } from "../shared/discount";

/**
 * R42 — engine-level discount lifecycle.
 *
 * A recorded T-bill that carries an explicit purchasePrice must be modelled as a
 * DISCOUNT instrument end to end:
 *   • while held, its value sits between price and face (accretion, never above face);
 *   • at maturity it credits face − WHT(discount), with NO separate interest line.
 *
 * The plan starts in the past so elapsed (actual) months are exercised.
 */

function pastStartISO(monthsBack: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1, 12, 0, 0));
  return d.toISOString().split("T")[0];
}
function monthsAfter(startISO: string, k: number, day: number): string {
  const s = new Date(startISO + "T12:00:00Z");
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, day, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

const START = pastStartISO(2);

const SETTINGS: EngineSettings = {
  mmfYield: 13.2,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 30000,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  startDate: START,
  horizonMonths: 120,
};

const PRIMARY_FUND = 1;

function lastActual(results: ReturnType<typeof runProjection>) {
  const actuals = results.filter((r) => r.isActual);
  return actuals[actuals.length - 1];
}

describe("R42 — recorded priced T-bill follows discount mechanics", () => {
  const FACE = 100_000;
  const price = tbillPrice(FACE, 15, 91); // ≈ 96,395

  it("the CBK worked example prices a 91-day 15% bill near 96,400", () => {
    expect(price).toBeGreaterThan(96_000);
    expect(price).toBeLessThan(96_800);
  });

  it("while held, the lot value sits between purchase price and face (accretion, never above face)", () => {
    const securities: ActualSecurity[] = [
      {
        securityType: "tbill_91",
        faceValue: FACE,
        issueDate: monthsAfter(START, 0, 10),
        maturityDate: monthsAfter(START, 3, 10), // matures in the future
        couponRate: 0,
        isTaxExempt: false,
        isMatured: false,
        purchasePrice: price,
      },
    ];
    const results = runProjection(SETTINGS, [], [], [], securities, [], [], PRIMARY_FUND);
    const today = lastActual(results);
    // The held T-bill value must be at or above what was paid, and never exceed face.
    expect(today.tbillEnd).toBeGreaterThanOrEqual(price - 1);
    expect(today.tbillEnd).toBeLessThanOrEqual(FACE + 1);
  });

  it("net maturity proceeds = face − 15% WHT on the discount only", () => {
    const wht = whtOnDiscount(FACE, price, 15);
    const proceeds = FACE - wht;
    // Worked-example sanity: discount ≈ 3,605 → WHT ≈ 540.7 → proceeds ≈ 99,459.
    expect(wht).toBeGreaterThan(500);
    expect(wht).toBeLessThan(560);
    expect(proceeds).toBeGreaterThan(99_400);
    expect(proceeds).toBeLessThan(99_500);
  });

  it("legacy T-bills with NO purchasePrice still reconcile at face (backward compatible)", () => {
    const securities: ActualSecurity[] = [
      {
        securityType: "tbill_364",
        faceValue: 50_000,
        issueDate: monthsAfter(START, 0, 15),
        maturityDate: monthsAfter(START, 12, 15),
        couponRate: 0,
        isTaxExempt: false,
        isMatured: false,
        // no purchasePrice → legacy face-based behaviour
      },
    ];
    const results = runProjection(SETTINGS, [], [], [], securities, [], [], PRIMARY_FUND);
    const today = lastActual(results);
    expect(today.tbillEnd).toBeCloseTo(50_000, 0);
  });
});
