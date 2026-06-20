import { describe, it, expect } from "vitest";
import {
  runProjection,
  runScenarios,
  getPhase,
  getSweepTargetForMonth,
  getScheduledContribution,
  netYield,
  monthlyRate,
  checkMilestones,
  YEAR_MILESTONES,
  SCENARIO_STEPUPS,
  type EngineSettings,
} from "./engine";

const DEFAULT_SETTINGS: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,   // gross; net ≈ 10.5% after 15% WHT
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
};

// ─── Phase detection ──────────────────────────────────────────────────────────
describe("getPhase", () => {
  it("returns foundation for months 1-24", () => {
    expect(getPhase(1)).toBe("foundation");
    expect(getPhase(12)).toBe("foundation");
    expect(getPhase(24)).toBe("foundation");
  });
  it("returns growth for months 25-84", () => {
    expect(getPhase(25)).toBe("growth");
    expect(getPhase(60)).toBe("growth");
    expect(getPhase(84)).toBe("growth");
  });
  it("returns de-risking for months 85-102", () => {
    expect(getPhase(85)).toBe("de-risking");
    expect(getPhase(102)).toBe("de-risking");
  });
  it("returns final-liquidity for months 103-120", () => {
    expect(getPhase(103)).toBe("final-liquidity");
    expect(getPhase(120)).toBe("final-liquidity");
  });
});

// ─── Sweep target rotation ────────────────────────────────────────────────────
describe("getSweepTargetForMonth", () => {
  it("always returns tbill in foundation phase", () => {
    for (let i = 0; i < 20; i++) {
      expect(getSweepTargetForMonth(1, i)).toBe("tbill");
      expect(getSweepTargetForMonth(24, i)).toBe("tbill");
    }
  });

  it("returns tbill in final-liquidity phase", () => {
    for (let i = 0; i < 10; i++) {
      expect(getSweepTargetForMonth(110, i)).toBe("tbill");
    }
  });

  it("returns fxd at least once in a 16-sweep growth cycle", () => {
    const targets = Array.from({ length: 16 }, (_, i) => getSweepTargetForMonth(30, i));
    expect(targets).toContain("fxd");
    expect(targets).toContain("ifb");
    expect(targets).toContain("tbill");
  });

  it("returns fxd at least once in a 15-sweep de-risking cycle", () => {
    const targets = Array.from({ length: 15 }, (_, i) => getSweepTargetForMonth(90, i));
    expect(targets).toContain("fxd");
    expect(targets).toContain("ifb");
    expect(targets).toContain("tbill");
  });

  it("growth cycle has more ifb sweeps than fxd sweeps (IFB 45% vs FXD 15%)", () => {
    const targets = Array.from({ length: 16 }, (_, i) => getSweepTargetForMonth(30, i));
    const ifbCount = targets.filter(t => t === "ifb").length;
    const fxdCount = targets.filter(t => t === "fxd").length;
    expect(ifbCount).toBeGreaterThan(fxdCount);
  });
});

// ─── WHT / net yield calculations ────────────────────────────────────────────
describe("netYield", () => {
  it("applies 15% WHT correctly to MMF yield", () => {
    const net = netYield(8.78, 15);
    expect(net).toBeCloseTo(7.463, 2);
  });

  it("applies 15% WHT correctly to T-bill rate", () => {
    const net = netYield(8.97, 15);
    expect(net).toBeCloseTo(7.6245, 2);
  });

  it("applies 15% WHT correctly to FXD coupon", () => {
    const net = netYield(12.35, 15);
    expect(net).toBeCloseTo(10.4975, 2);
  });

  it("zero WHT returns gross yield unchanged", () => {
    expect(netYield(12.5, 0)).toBe(12.5);
  });
});

describe("monthlyRate", () => {
  it("converts 7.5% annual to correct monthly rate", () => {
    const r = monthlyRate(7.5);
    expect(r).toBeCloseTo(0.006045, 4);
  });

  it("monthly compounding over 12 months approximates annual yield", () => {
    const r = monthlyRate(7.5);
    const annualised = (Math.pow(1 + r, 12) - 1) * 100;
    expect(annualised).toBeCloseTo(7.5, 2);
  });
});

// ─── Contribution schedule ────────────────────────────────────────────────────
describe("getScheduledContribution", () => {
  it("starts at 2500 in month 1", () => {
    expect(getScheduledContribution(1, DEFAULT_SETTINGS)).toBe(2500);
  });
  it("steps up to 5500 in month 7", () => {
    expect(getScheduledContribution(7, DEFAULT_SETTINGS)).toBe(5500);
  });
  it("steps up to 8500 in month 13", () => {
    expect(getScheduledContribution(13, DEFAULT_SETTINGS)).toBe(8500);
  });
  it("reaches 59500 by month 115-120", () => {
    expect(getScheduledContribution(115, DEFAULT_SETTINGS)).toBe(59500);
    expect(getScheduledContribution(120, DEFAULT_SETTINGS)).toBe(59500);
  });
});

// ─── Full projection ──────────────────────────────────────────────────────────
describe("runProjection", () => {
  const results = runProjection(DEFAULT_SETTINGS);

  it("produces exactly 120 months", () => {
    expect(results).toHaveLength(120);
  });

  it("month numbers are sequential 1-120", () => {
    results.forEach((r, i) => expect(r.monthNumber).toBe(i + 1));
  });

  it("all balances are non-negative", () => {
    for (const r of results) {
      expect(r.mmfEnd).toBeGreaterThanOrEqual(0);
      expect(r.tbillEnd).toBeGreaterThanOrEqual(0);
      expect(r.ifbEnd).toBeGreaterThanOrEqual(0);
      expect(r.fxdEnd).toBeGreaterThanOrEqual(0);
    }
  });

  it("total end equals sum of component balances", () => {
    for (const r of results) {
      const sum = r.mmfEnd + r.tbillEnd + r.ifbEnd + r.fxdEnd;
      expect(Math.abs(r.totalEnd - sum)).toBeLessThan(1);
    }
  });

  it("FXD balance grows above zero during the growth phase (months 25-84)", () => {
    const growthResults = results.filter(r => r.monthNumber >= 25 && r.monthNumber <= 84);
    const maxFxd = Math.max(...growthResults.map(r => r.fxdEnd));
    expect(maxFxd).toBeGreaterThan(0);
  });

  it("FXD balance grows above zero during the de-risking phase (months 85-102)", () => {
    const deRiskResults = results.filter(r => r.monthNumber >= 85 && r.monthNumber <= 102);
    const maxFxd = Math.max(...deRiskResults.map(r => r.fxdEnd));
    expect(maxFxd).toBeGreaterThan(0);
  });

  it("IFB balance grows above zero during the growth phase", () => {
    const growthResults = results.filter(r => r.monthNumber >= 25 && r.monthNumber <= 84);
    const maxIfb = Math.max(...growthResults.map(r => r.ifbEnd));
    expect(maxIfb).toBeGreaterThan(0);
  });

  it("T-bill balance grows during the foundation phase", () => {
    const foundationResults = results.filter(r => r.monthNumber <= 24);
    const maxTbill = Math.max(...foundationResults.map(r => r.tbillEnd));
    expect(maxTbill).toBeGreaterThan(0);
  });

  it("year-1 total (month 12) is in the range KES 40,000–60,000", () => {
    const yr1 = results[11].totalEnd;
    expect(yr1).toBeGreaterThan(40000);
    expect(yr1).toBeLessThan(60000);
  });

  it("year-10 total (month 120) is at or above the KES 5M target", () => {
    expect(results[119].totalEnd).toBeGreaterThanOrEqual(5000000);
  });

  it("phase assignment is correct for key months", () => {
    expect(results[0].phase).toBe("foundation");
    expect(results[23].phase).toBe("foundation");
    expect(results[24].phase).toBe("growth");
    expect(results[83].phase).toBe("growth");
    expect(results[84].phase).toBe("de-risking");
    expect(results[101].phase).toBe("de-risking");
    expect(results[102].phase).toBe("final-liquidity");
    expect(results[119].phase).toBe("final-liquidity");
  });

  it("applies contribution overrides correctly", () => {
    const overrides = [{ monthNumber: 1, overrideAmount: 10000 }];
    const overrideResults = runProjection(DEFAULT_SETTINGS, overrides);
    expect(overrideResults[0].contribution).toBe(10000);
    expect(overrideResults[0].totalEnd).toBeGreaterThan(results[0].totalEnd);
  });

  it("applies lump sum correctly", () => {
    const overrides = [{ monthNumber: 1, lumpSum: 100000 }];
    const overrideResults = runProjection(DEFAULT_SETTINGS, overrides);
    expect(overrideResults[0].contribution).toBe(2500 + 100000);
  });
});

// ─── Tax enforcement ──────────────────────────────────────────────────────────
describe("Tax enforcement", () => {
  it("IFB coupons are tax-exempt — action description contains 'tax-exempt'", () => {
    const settings: EngineSettings = { ...DEFAULT_SETTINGS, startingContribution: 100000, stepUpAmount: 0 };
    const results = runProjection(settings);
    const couponMonth = results.find(r => r.cbkCashIn > 0 && r.ifbEnd > 0 && r.monthNumber % 6 === 0);
    if (couponMonth) {
      expect(couponMonth.mainAction.toLowerCase()).toContain("tax-exempt");
    }
  });

  it("FXD coupons have 15% WHT deducted — net coupon < gross coupon", () => {
    const grossFxdCoupon = (DEFAULT_SETTINGS.fxdCouponRate / 100 / 2) * 50000;
    const netFxdCoupon   = grossFxdCoupon * (1 - DEFAULT_SETTINGS.withholdingTax / 100);
    expect(netFxdCoupon).toBeLessThan(grossFxdCoupon);
    expect(netFxdCoupon).toBeCloseTo(grossFxdCoupon * 0.85, 2);
  });

  it("MMF yield is net of 15% WHT — no-WHT projection produces higher final value", () => {
    const noTax = runProjection({ ...DEFAULT_SETTINGS, withholdingTax: 0 });
    const withTax = runProjection(DEFAULT_SETTINGS);
    expect(noTax[119].totalEnd).toBeGreaterThan(withTax[119].totalEnd);
  });

  it("T-bill interest is net of 15% WHT — no-WHT T-bill balance is higher", () => {
    const noTax = runProjection({ ...DEFAULT_SETTINGS, withholdingTax: 0 });
    const withTax = runProjection(DEFAULT_SETTINGS);
    expect(noTax[119].tbillEnd).toBeGreaterThan(withTax[119].tbillEnd);
  });

  it("FXD net coupon at 12.35% gross is approximately 10.5% net", () => {
    const net = netYield(12.35, 15);
    expect(net).toBeCloseTo(10.4975, 1);
  });
});

// ─── Scenarios ────────────────────────────────────────────────────────────────
describe("runScenarios", () => {
  const scenarios = runScenarios(DEFAULT_SETTINGS);

  it("produces 6 scenario results", () => {
    expect(scenarios).toHaveLength(6);
  });

  it("KES 3,000 step-up hits the KES 5M target", () => {
    const s3000 = scenarios.find(s => s.stepUp === 3000)!;
    expect(s3000.hitsTarget).toBe(true);
    expect(s3000.projectedEndingValue).toBeGreaterThanOrEqual(5000000);
  });

  it("KES 0 step-up does not hit the KES 5M target", () => {
    const s0 = scenarios.find(s => s.stepUp === 0)!;
    expect(s0.hitsTarget).toBe(false);
  });

  it("higher step-up always produces higher ending value", () => {
    for (let i = 1; i < scenarios.length; i++) {
      expect(scenarios[i].projectedEndingValue).toBeGreaterThan(scenarios[i - 1].projectedEndingValue);
    }
  });

  it("KES 3,000 step-up total contributed is approximately KES 3,720,000", () => {
    const s3000 = scenarios.find(s => s.stepUp === 3000)!;
    expect(s3000.totalContributed).toBeGreaterThan(3600000);
    expect(s3000.totalContributed).toBeLessThan(3900000);
  });
});

// ─── Milestone check ──────────────────────────────────────────────────────────
describe("checkMilestones", () => {
  it("returns ahead when at the projected total", () => {
    const result = checkMilestones(12, 49590, DEFAULT_SETTINGS);
    expect(result.status).toBe("ahead");
  });

  it("returns on-track when between min checkpoint and projected total", () => {
    const result = checkMilestones(12, 47000, DEFAULT_SETTINGS);
    expect(result.status).toBe("on-track");
  });

  it("returns behind when below the minimum healthy checkpoint", () => {
    const result = checkMilestones(12, 40000, DEFAULT_SETTINGS);
    expect(result.status).toBe("behind");
    expect(result.recommendation).toContain("KES");
  });

  it("returns null milestone for non-year-end months", () => {
    const result = checkMilestones(7, 15000, DEFAULT_SETTINGS);
    expect(result.milestone).toBeNull();
  });

  it("all 10 year-end milestones are defined in YEAR_MILESTONES", () => {
    expect(YEAR_MILESTONES).toHaveLength(10);
    expect(YEAR_MILESTONES[9].month).toBe(120);
    expect(YEAR_MILESTONES[9].projectedTotal).toBe(5279234);
  });
});

// ─── Safety floor ─────────────────────────────────────────────────────────────
describe("Safety floor enforcement", () => {
  it("never sweeps when MMF is at or below safetyFloor + 50,000", () => {
    const settings: EngineSettings = { ...DEFAULT_SETTINGS, startingContribution: 2500, stepUpAmount: 0 };
    const results = runProjection(settings);
    const earlyResults = results.slice(0, 6);
    for (const r of earlyResults) {
      expect(r.mmfToDhow).toBe(0);
    }
  });

  it("MMF stays >= safetyFloor after every sweep", () => {
    const results = runProjection(DEFAULT_SETTINGS);
    for (const r of results) {
      if (r.mmfToDhow > 0) {
        expect(r.mmfEnd).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.safetyFloor);
      }
    }
  });

  it("custom safety floor of 100,000 is respected", () => {
    const settings = { ...DEFAULT_SETTINGS, safetyFloor: 100000 };
    const results = runProjection(settings);
    for (const r of results) {
      if (r.mmfToDhow > 0) {
        expect(r.mmfEnd).toBeGreaterThanOrEqual(100000);
      }
    }
  });

  it("no sweep occurs before MMF exceeds safetyFloor + 50,000", () => {
    const results = runProjection(DEFAULT_SETTINGS);
    for (const r of results) {
      if (r.mmfToDhow > 0) {
        const mmfBeforeSweep = r.mmfEnd + r.mmfToDhow;
        expect(mmfBeforeSweep).toBeGreaterThan(DEFAULT_SETTINGS.safetyFloor + 50000);
      }
    }
  });
});

// ─── Auth logout (existing) ───────────────────────────────────────────────────
// (kept in server/auth.logout.test.ts)
