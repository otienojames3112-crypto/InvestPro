import { describe, it, expect } from "vitest";
import { computeActualsTotals, type DepositRow, type SecurityActual } from "@shared/actuals";
import {
  deriveSafetyFloor,
  SWEEP_LOT_SIZE,
  generateMilestones,
  getPhase,
  phaseMilestoneLabel,
  type EngineSettings,
} from "./engine";

/**
 * Round 21 — Government-security single source of truth, auto safety floor,
 * and phase-aware milestone labels.
 *
 * The central invariant: a government-security deposit is represented by its
 * REGISTER row (securities), never by summing the deposit row. So the same
 * face value must appear EXACTLY ONCE in net worth, and the deposit row that
 * created it must not also inflate the primary-MMF contribution.
 */

const RATES = {
  withholdingTax: 15,
  mmfYield: 13.2,
  tbillRate: 8.97,
  fxdCouponRate: 12.35,
};

describe("government securities — register is the single source of truth", () => {
  it("values a gov security from the register, NOT from its deposit row", () => {
    // A 500k T-bill deposit that auto-created a register row.
    const deposits: DepositRow[] = [
      { amount: 500000, bucket: "tbill", institutionType: "government_security", mmfFundId: null },
      { amount: 120000, bucket: "mmf", institutionType: null, mmfFundId: null }, // genuine primary MMF
    ];
    const securities: SecurityActual[] = [
      { securityType: "tbill_364", faceValue: 500000, couponRate: 8.97, isTaxExempt: false },
    ];

    const r = computeActualsTotals(deposits, [], [], RATES, securities);

    // The gov deposit row is excluded from the primary contribution …
    expect(r.depositsContributed).toBe(120000);
    // … and counted once via the register.
    expect(r.securitiesValue).toBe(500000);
    // No double-count: total = 120k MMF + 500k register.
    expect(r.totalContributed).toBe(620000);
    expect(r.byBucket.tbill).toBe(500000);
    expect(r.byBucket.mmf).toBe(120000);
  });

  it("excludes matured securities from net worth", () => {
    const securities: SecurityActual[] = [
      { securityType: "tbill_91", faceValue: 200000, couponRate: 8.82, isTaxExempt: false, isMatured: true },
      { securityType: "fxd", faceValue: 300000, couponRate: 12.35, isTaxExempt: false },
    ];
    const r = computeActualsTotals([], [], [], RATES, securities);
    expect(r.securitiesValue).toBe(300000);
    expect(r.byBucket.fxd).toBe(300000);
    expect(r.byBucket.tbill).toBe(0);
  });

  it("treats IFB coupons as tax-exempt but still counts principal", () => {
    const securities: SecurityActual[] = [
      { securityType: "ifb", faceValue: 400000, couponRate: 12.5, isTaxExempt: true },
    ];
    const r = computeActualsTotals([], [], [], RATES, securities);
    expect(r.securitiesValue).toBe(400000);
    expect(r.byBucket.ifb).toBe(400000);
    expect(r.taxBreakdown.ifb).toBe(0);
  });

  it("does not double-count when both the deposit row and register exist together", () => {
    // Two gov deposits + their two register rows; one plain MMF deposit.
    const deposits: DepositRow[] = [
      { amount: 250000, bucket: "tbill", institutionType: "government_security" },
      { amount: 350000, bucket: "fxd", institutionType: "government_security" },
      { amount: 80000, bucket: "mmf" },
    ];
    const securities: SecurityActual[] = [
      { securityType: "tbill_182", faceValue: 250000, couponRate: 8.78, isTaxExempt: false },
      { securityType: "fxd", faceValue: 350000, couponRate: 12.35, isTaxExempt: false },
    ];
    const r = computeActualsTotals(deposits, [], [], RATES, securities);
    // 80k MMF + 250k + 350k register = 680k, NOT 1.28M.
    expect(r.totalContributed).toBe(680000);
    expect(r.depositsContributed).toBe(80000);
    expect(r.securitiesValue).toBe(600000);
  });
});

describe("deriveSafetyFloor — auto from contribution + sweep lot", () => {
  it("never goes below one sweep lot", () => {
    expect(deriveSafetyFloor(0)).toBe(SWEEP_LOT_SIZE);
    expect(deriveSafetyFloor(1000)).toBe(SWEEP_LOT_SIZE); // 2*1000 < lot → lot
  });

  it("uses ~2 months of contribution, rounded up to a whole lot", () => {
    // 2 * 40000 = 80000 → ceil(80000/50000)*50000 = 100000
    expect(deriveSafetyFloor(40000)).toBe(100000);
    // 2 * 30000 = 60000 → ceil to 100000
    expect(deriveSafetyFloor(30000)).toBe(100000);
    // 2 * 25000 = 50000 → exactly one lot
    expect(deriveSafetyFloor(25000)).toBe(50000);
  });

  it("is always a whole multiple of the lot size", () => {
    for (const c of [0, 7000, 33333, 90000, 250000]) {
      const floor = deriveSafetyFloor(c);
      expect(floor % SWEEP_LOT_SIZE).toBe(0);
      expect(floor).toBeGreaterThanOrEqual(SWEEP_LOT_SIZE);
    }
  });
});

describe("phase-aware milestone labels", () => {
  it("labels each milestone by its phase, never a generic 'Year N'", () => {
    const settings: EngineSettings = {
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
      startDate: "2026-07-01",
      horizonMonths: 180, // 15-year plan — the old bug fell back to generic labels for years 11+
    };
    const milestones = generateMilestones(settings);
    expect(milestones.length).toBe(15);
    for (const m of milestones) {
      const phase = getPhase(m.month, 180, settings.phaseFractions);
      const isFinalYear = m.month === 180 || m.year === 15;
      expect(m.label).toBe(phaseMilestoneLabel(phase, isFinalYear));
      // No milestone should be empty or a bare "Year N checkpoint".
      expect(m.label.length).toBeGreaterThan(10);
      expect(m.label).not.toMatch(/^Year \d+ checkpoint/i);
    }
  });

  it("tightens the healthy checkpoint once de-risking begins", () => {
    const milestones = generateMilestones();
    for (const m of milestones) {
      const ratio = m.minHealthyCheckpoint / m.projectedTotal;
      // 0.90 early, 0.95 in de-risking / final-liquidity — allow rounding slack.
      expect(ratio).toBeGreaterThanOrEqual(0.89);
      expect(ratio).toBeLessThanOrEqual(0.96);
    }
  });
});
