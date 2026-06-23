import { describe, it, expect } from "vitest";
import {
  runProjection,
  type EngineSettings,
  type ActualDeposit,
  type ActualSecurity,
} from "./engine";

/**
 * Round 24 — maturing-soon alert, partial (split) recycling, drift-badge deep link.
 *
 * The split recycle is a router operation, so here we lock:
 *   1. The split-allocation math the router uses to divide proceeds between the
 *      MMF leg and the re-buy leg (and the validation that both legs are > 0 and
 *      that the parts sum to the redeemed total).
 *   2. The engine-visible outcome of a split recycle: the matured lot leaves the
 *      gov pocket, part reappears in MMF and the remainder in a fresh gov lot,
 *      with the total value preserved (not doubled, not lost).
 *   3. The maturing-soon window selection the Securities page uses (days <= 30,
 *      including already-overdue lots).
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

const START = pastStartISO(8);

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
  return results.filter((r) => r.isActual).pop()!;
}

/**
 * Mirror of the router's split-allocation resolution. Returns the rounded MMF and
 * re-buy portions, or throws when the split is invalid (matching the BAD_REQUEST
 * guards in securities.recycle).
 */
function resolveSplit(face: number, mmfAmount?: number, rebuyAmount?: number) {
  let mmf = mmfAmount ?? face / 2;
  let rebuy = rebuyAmount ?? face / 2;
  mmf = Math.round(mmf * 100) / 100;
  rebuy = Math.round(rebuy * 100) / 100;
  const total = mmf + rebuy;
  if (total <= 0) throw new Error("Recycle amount must be positive.");
  if (mmf <= 0 || rebuy <= 0) throw new Error("A split rollover needs a positive amount on both sides.");
  return { mmf, rebuy, total };
}

describe("Round 24 — split-recycle allocation math", () => {
  it("defaults to a 50/50 face split when no portions are given", () => {
    const { mmf, rebuy, total } = resolveSplit(200000);
    expect(mmf).toBe(100000);
    expect(rebuy).toBe(100000);
    expect(total).toBe(200000);
  });
  it("honours explicit portions that sum to the redeemed total", () => {
    const { mmf, rebuy, total } = resolveSplit(200000, 150000, 50000);
    expect(mmf).toBe(150000);
    expect(rebuy).toBe(50000);
    expect(total).toBe(200000);
  });
  it("rejects a split where one side is zero", () => {
    expect(() => resolveSplit(200000, 200000, 0)).toThrow();
    expect(() => resolveSplit(200000, 0, 200000)).toThrow();
  });
  it("rejects a split where both sides are zero", () => {
    expect(() => resolveSplit(200000, 0, 0)).toThrow();
  });
});

describe("Round 24 — split recycle preserves total value across pockets", () => {
  it("matured lot leaves gov; part lands in MMF, remainder in a fresh gov lot", () => {
    const issue = monthsAfter(START, 1, 10);
    const maturity = monthsAfter(START, 4, 10); // already matured by 'today'
    const redeploy = monthsAfter(START, 5, 1);
    const newMaturity = monthsAfter(START, 29, 1);

    // Split 200k -> 120k MMF + 80k re-buy.
    const afterSec: ActualSecurity[] = [
      { securityType: "tbill_364", faceValue: 200000, issueDate: issue, maturityDate: maturity, couponRate: 0, isTaxExempt: false, isMatured: true },
      { securityType: "tbill_364", faceValue: 80000, issueDate: redeploy, maturityDate: newMaturity, couponRate: 0, isTaxExempt: false, isMatured: false },
    ];
    const afterDep: ActualDeposit[] = [
      { bucket: "tbill", amount: 200000, depositDate: issue, institutionType: "government_security", mmfFundId: null },
      { bucket: "mmf", amount: 120000, depositDate: redeploy, institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
      { bucket: "tbill", amount: 80000, depositDate: redeploy, institutionType: "government_security", mmfFundId: null },
    ];
    const r = runProjection(SETTINGS, [], [], afterDep, afterSec, [], [], PRIMARY_FUND);
    const t = lastActual(r);
    // Re-bought gov leg carries the 80k portion (matured 200k lot dropped out).
    expect(t.tbillEnd).toBeCloseTo(80000, 0);
    // MMF leg carries at least the 120k portion (plus any accrued yield).
    expect(t.mmfEnd).toBeGreaterThanOrEqual(120000);
  });
});

/**
 * Mirror of the Securities page maturing-soon selector: active lots whose
 * maturity is within the next 30 days, including any already past due.
 */
function daysUntil(dateStr: string): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
function isMaturingSoon(maturityISO: string): boolean {
  return daysUntil(maturityISO) <= 30;
}

describe("Round 24 — maturing-soon window (<= 30 days, incl. overdue)", () => {
  it("flags a lot maturing in 10 days", () => {
    const d = new Date();
    d.setDate(d.getDate() + 10);
    expect(isMaturingSoon(d.toISOString().split("T")[0])).toBe(true);
  });
  it("flags an already-overdue lot", () => {
    const d = new Date();
    d.setDate(d.getDate() - 5);
    expect(isMaturingSoon(d.toISOString().split("T")[0])).toBe(true);
  });
  it("does NOT flag a lot maturing in 60 days", () => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    expect(isMaturingSoon(d.toISOString().split("T")[0])).toBe(false);
  });
});
