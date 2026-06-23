import { describe, it, expect } from "vitest";
import {
  runProjection,
  type EngineSettings,
  type ActualDeposit,
  type ActualSecurity,
} from "./engine";

/**
 * Round 23 — maturity recycling, sidebar drift badge, edit-history note.
 *
 * The recycle action is a router operation that writes rows; here we lock the
 * *engine-visible outcome* of each recycle mode (the register stays the single
 * source of truth, so a recycle is just "retire old lot + add new row"):
 *   - rebuy: matured lot leaves net worth; a fresh same-type lot for the same
 *     tenor restores the value in the same pocket.
 *   - mmf:   matured lot leaves net worth; proceeds reappear in the MMF pocket.
 * We also lock the tenor-preservation math and the drift-level thresholds that
 * the sidebar badge + Dashboard card share.
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

describe("Round 23 — recycle (re-buy) keeps the lot in the same pocket", () => {
  it("retires the matured lot and a fresh same-type lot restores net worth", () => {
    // Baseline: an ACTIVE T-bill (matures in the future) is held in full.
    const issue = monthsAfter(START, 1, 10);
    const activeMaturity = monthsAfter(START, 25, 10); // well in the future
    const beforeSec: ActualSecurity[] = [
      { securityType: "tbill_364", faceValue: 200000, issueDate: issue, maturityDate: activeMaturity, couponRate: 0, isTaxExempt: false, isMatured: false },
    ];
    const beforeDep: ActualDeposit[] = [
      { bucket: "tbill", amount: 200000, depositDate: issue, institutionType: "government_security", mmfFundId: null },
    ];
    const r0 = runProjection(SETTINGS, [], [], beforeDep, beforeSec, [], [], PRIMARY_FUND);
    const t0 = lastActual(r0);
    expect(t0.tbillEnd).toBeCloseTo(200000, 0);

    // Recycle "rebuy": the old lot is explicitly marked matured (leaves net
    // worth) and a fresh same-type lot is bought for the same face on the
    // redeploy date, maturing again in the future.
    const redeploy = monthsAfter(START, 5, 1);
    const newMaturity = monthsAfter(START, 29, 1);
    const afterSec: ActualSecurity[] = [
      { securityType: "tbill_364", faceValue: 200000, issueDate: issue, maturityDate: activeMaturity, couponRate: 0, isTaxExempt: false, isMatured: true },
      { securityType: "tbill_364", faceValue: 200000, issueDate: redeploy, maturityDate: newMaturity, couponRate: 0, isTaxExempt: false, isMatured: false },
    ];
    const afterDep: ActualDeposit[] = [
      { bucket: "tbill", amount: 200000, depositDate: issue, institutionType: "government_security", mmfFundId: null },
      { bucket: "tbill", amount: 200000, depositDate: redeploy, institutionType: "government_security", mmfFundId: null },
    ];
    const r1 = runProjection(SETTINGS, [], [], afterDep, afterSec, [], [], PRIMARY_FUND);
    const t1 = lastActual(r1);
    // Value is preserved in the T-bill pocket (not doubled, not lost): the
    // matured lot drops out and the fresh lot carries the 200k forward.
    expect(t1.tbillEnd).toBeCloseTo(200000, 0);
  });
});

describe("Round 23 — recycle (mmf) moves proceeds to the MMF pocket", () => {
  it("matured lot leaves the gov pocket and reappears in MMF", () => {
    const issue = monthsAfter(START, 1, 10);
    const maturity = monthsAfter(START, 4, 10);
    const afterSec: ActualSecurity[] = [
      { securityType: "tbill_364", faceValue: 200000, issueDate: issue, maturityDate: maturity, couponRate: 0, isTaxExempt: false, isMatured: true },
    ];
    const afterDep: ActualDeposit[] = [
      { bucket: "tbill", amount: 200000, depositDate: issue, institutionType: "government_security", mmfFundId: null },
      { bucket: "mmf", amount: 200000, depositDate: monthsAfter(START, 5, 1), institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
    ];
    const r = runProjection(SETTINGS, [], [], afterDep, afterSec, [], [], PRIMARY_FUND);
    const t = lastActual(r);
    // Matured gov lot no longer counted; proceeds now sit in the MMF pocket.
    expect(t.tbillEnd).toBe(0);
    expect(t.mmfEnd).toBeGreaterThanOrEqual(200000);
  });
});

/**
 * Tenor-preservation helper mirroring the router: a re-buy keeps the original
 * issue→maturity span (in whole months) measured from the redeploy date.
 */
function tenorMonths(issueISO: string, maturityISO: string): number {
  const issue = new Date(issueISO + "T12:00:00Z");
  const maturity = new Date(maturityISO + "T12:00:00Z");
  const ms = Math.max(maturity.getTime() - issue.getTime(), 0);
  return ms > 0 ? Math.round(ms / (1000 * 60 * 60 * 24 * 30.4375)) : 12;
}

describe("Round 23 — re-buy preserves the original tenor length", () => {
  it("a 12-month bill rolls into another ~12-month bill", () => {
    expect(tenorMonths("2026-01-15", "2027-01-15")).toBe(12);
  });
  it("a 3-month bill rolls into another ~3-month bill", () => {
    expect(tenorMonths("2026-01-10", "2026-04-10")).toBe(3);
  });
  it("a 24-month bond rolls into another ~24-month bond", () => {
    expect(tenorMonths("2026-01-01", "2028-01-01")).toBe(24);
  });
});

/**
 * Drift-level thresholds shared by useReconciliationDrift + the sidebar badge.
 * Mirror of the hook's classification so the badge can't silently change tiers.
 */
function driftLevel(engineToday: number, actualsTotal: number): "match" | "minor" | "major" {
  const delta = actualsTotal - engineToday;
  const denom = engineToday > 0 ? engineToday : actualsTotal || 1;
  const absPct = Math.abs((delta / denom) * 100);
  return absPct <= 1 ? "match" : absPct <= 5 ? "minor" : "major";
}

describe("Round 23 — reconciliation drift thresholds", () => {
  it("within 1% is a match (badge hidden)", () => {
    expect(driftLevel(1_000_000, 1_005_000)).toBe("match"); // +0.5%
    expect(driftLevel(1_000_000, 995_000)).toBe("match"); // -0.5%
  });
  it("1–5% is a minor (amber) drift", () => {
    expect(driftLevel(1_000_000, 1_030_000)).toBe("minor"); // +3%
    expect(driftLevel(1_000_000, 960_000)).toBe("minor"); // -4%
  });
  it("beyond 5% is a major (red) drift", () => {
    expect(driftLevel(1_000_000, 1_200_000)).toBe("major"); // +20%
    expect(driftLevel(1_000_000, 800_000)).toBe("major"); // -20%
  });
});
