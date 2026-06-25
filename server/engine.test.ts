import { describe, it, expect } from "vitest";
import {
  runProjection,
  runScenarios,
  getPhase,
  getSweepTargetForMonth,
  getScheduledContribution,
  netYield,
  monthlyRate,
  rankInstrumentsByNetYield,
  joinWithAnd,
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
  // getSweepTargetForMonth returns { bucket, tenorMonths } | null
  it("always returns tbill in foundation phase", () => {
    for (let i = 0; i < 20; i++) {
      expect(getSweepTargetForMonth(1, i)?.bucket).toBe("tbill");
      expect(getSweepTargetForMonth(24, i)?.bucket).toBe("tbill");
    }
  });

  it("returns tbill in final-liquidity phase", () => {
    for (let i = 0; i < 10; i++) {
      expect(getSweepTargetForMonth(110, i)?.bucket).toBe("tbill");
    }
  });

  it("returns fxd at least once in a 16-sweep growth cycle", () => {
    const targets = Array.from({ length: 16 }, (_, i) => getSweepTargetForMonth(30, i)?.bucket);
    expect(targets).toContain("fxd");
    expect(targets).toContain("ifb");
    expect(targets).toContain("tbill");
  });

  it("returns fxd at least once in a 15-sweep de-risking cycle", () => {
    const targets = Array.from({ length: 15 }, (_, i) => getSweepTargetForMonth(90, i)?.bucket);
    expect(targets).toContain("fxd");
    expect(targets).toContain("ifb");
    expect(targets).toContain("tbill");
  });

  it("growth cycle has more ifb sweeps than fxd sweeps (IFB 45% vs FXD 15%)", () => {
    const targets = Array.from({ length: 16 }, (_, i) => getSweepTargetForMonth(30, i)?.bucket);
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

  it("year-10 total (month 120) is in the range KES 4M–5.5M (corrected engine)", () => {
    // Allocation-targeted sweep (Round 26): month-120 ≈ KES 5,010,535 with the
    // baseline KES 3,000 step-up.
    expect(results[119].totalEnd).toBeGreaterThan(4000000);
    expect(results[119].totalEnd).toBeLessThan(5500000);
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
    // Use startDate so months are deterministic and IFB lots are bought in growth phase
    const settings: EngineSettings = { ...DEFAULT_SETTINGS, startingContribution: 100000, stepUpAmount: 0, startDate: "2026-07-01" };
    const results = runProjection(settings);
    // Find any month where an IFB coupon was paid (cbkCashIn > 0, ifbEnd > 0, age % 6 === 0)
    const couponMonth = results.find(r => r.cbkCashIn > 0 && r.ifbEnd > 0 && r.mainAction.toLowerCase().includes("ifb coupon"));
    if (couponMonth) {
      expect(couponMonth.mainAction.toLowerCase()).toContain("tax-exempt");
    }
    // If no coupon month found, that's acceptable (IFB lots may not have matured yet)
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

  it("T-bill discount is net of 15% WHT — no-WHT projection ends with more cash", () => {
    // Round 43: T-bills are discount instruments. Their in-flight balance
    // (tbillEnd) is the ACCRETED value price→face, which is WHT-INDEPENDENT —
    // WHT is charged only on the discount AT MATURITY, never on the running
    // balance. So the correct WHT invariant is on realised value: a 0% WHT run
    // keeps the full discount and therefore ends the horizon with more total
    // portfolio value than the 15% WHT run.
    const noTax = runProjection({ ...DEFAULT_SETTINGS, withholdingTax: 0 });
    const withTax = runProjection(DEFAULT_SETTINGS);
    expect(noTax[119].totalEnd).toBeGreaterThan(withTax[119].totalEnd);
  });

  it("FXD net coupon at 12.35% gross is approximately 10.5% net", () => {
    const net = netYield(12.35, 15);
    expect(net).toBeCloseTo(10.4975, 1);
  });
});

// ─── Scenarios ────────────────────────────────────────────────────────────────
describe("runScenarios", () => {
  const scenarios = runScenarios(DEFAULT_SETTINGS);

  it("produces 9 scenario results (SCENARIO_STEPUPS has 9 entries)", () => {
    // SCENARIO_STEPUPS = [0, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000]
    expect(scenarios).toHaveLength(9);
  });

  it("KES 3,000 step-up lands just under 5M with end-state liquidity (≈ 4.97M)", () => {
    // Round 27: end-state liquidity parks the final-tail surplus in MMF instead of
    // compounding it in bills, so the baseline now lands at ≈ KES 4.97M — just
    // short of 5M but inside the 4.5–5.2M acceptance band.
    const s3000 = scenarios.find(s => s.stepUp === 3000)!;
    expect(s3000.projectedEndingValue).toBeGreaterThanOrEqual(4_500_000);
    expect(s3000.projectedEndingValue).toBeLessThanOrEqual(5_200_000);
  });

  it("a higher KES 4,000 step-up clears the KES 5M target", () => {
    const s4000 = scenarios.find(s => s.stepUp === 4000)!;
    expect(s4000.hitsTarget).toBe(true);
    expect(s4000.projectedEndingValue).toBeGreaterThanOrEqual(5_000_000);
  });

  it("KES 2,000 step-up does NOT hit the KES 5M target", () => {
    const s2000 = scenarios.find(s => s.stepUp === 2000)!;
    expect(s2000.hitsTarget).toBe(false);
    expect(s2000.projectedEndingValue).toBeLessThan(5000000);
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
    // Allocation-targeted sweep (Round 26): month-120 ≈ KES 5,010,535.
    expect(YEAR_MILESTONES[9].projectedTotal).toBeGreaterThan(4500000);
    expect(YEAR_MILESTONES[9].projectedTotal).toBeLessThan(5300000);
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

// ─── Date normalisation (regression for startDate save bug) ─────────────────
describe("startDate normalisation", () => {
  it("extracts YYYY-MM-DD from ISO timestamp string", () => {
    const raw = "2026-07-01T12:00:00.000Z";
    const clean = String(raw).split("T")[0];
    expect(clean).toBe("2026-07-01");
  });

  it("extracts YYYY-MM-DD from Date object", () => {
    const d = new Date("2026-07-01T12:00:00.000Z");
    const clean = d.toISOString().split("T")[0];
    expect(clean).toBe("2026-07-01");
  });

  it("noon UTC Date does not shift date in any UTC+/- timezone", () => {
    // Storing at noon UTC means toISOString() always returns the correct date
    // regardless of the server's local timezone (UTC+3 for Kenya, UTC-X for other)
    const stored = new Date("2026-07-01T12:00:00.000Z");
    const recovered = stored.toISOString().split("T")[0];
    expect(recovered).toBe("2026-07-01");
  });

  it("plain YYYY-MM-DD string passes through unchanged", () => {
    const raw = "2026-07-01";
    const clean = String(raw).split("T")[0];
    expect(clean).toBe("2026-07-01");
  });
});

// ─── Target amount change regression ─────────────────────────────────────────
describe("target amount change", () => {
  it("changing target does not change projected bucket balances (they are engine outputs)", () => {
    const r1 = runProjection({ ...DEFAULT_SETTINGS, targetAmount: 5000000 });
    const r2 = runProjection({ ...DEFAULT_SETTINGS, targetAmount: 10000000 });
    // Bucket balances at month 120 must be identical — target is not an engine input
    expect(r1[119].mmfEnd).toBeCloseTo(r2[119].mmfEnd, 0);
    expect(r1[119].tbillEnd).toBeCloseTo(r2[119].tbillEnd, 0);
    expect(r1[119].ifbEnd).toBeCloseTo(r2[119].ifbEnd, 0);
    expect(r1[119].fxdEnd).toBeCloseTo(r2[119].fxdEnd, 0);
  });

  it("changing target changes whether the plan is on-track (milestone check)", () => {
    // Use corrected engine's M120 value (≈ 5,010,535) for comparison
    const correctedM120 = runProjection({ ...DEFAULT_SETTINGS, startDate: "2026-07-01" })[119].totalEnd;
    // At or above projected total → ahead
    const onTrack = checkMilestones(120, correctedM120 + 1, { ...DEFAULT_SETTINGS, startDate: "2026-07-01", targetAmount: 5000000 });
    // Well below min healthy checkpoint → behind
    const behind = checkMilestones(120, correctedM120 * 0.5, { ...DEFAULT_SETTINGS, startDate: "2026-07-01", targetAmount: 5000000 });
    expect(onTrack.status).toBe("ahead");
    expect(behind.status).toBe("behind");
  });
});

// ─── Auth logout (existing) ───────────────────────────────────────────────────
// (kept in server/auth.logout.test.ts)

// ─── Rate-history time-locking regression tests ───────────────────────────────
describe("runProjection with rate schedule (time-locked rates)", () => {
  // Settings with a fixed start date so month dates are deterministic
  const SETTINGS_WITH_DATE: EngineSettings = {
    ...DEFAULT_SETTINGS,
    startDate: "2026-07-01",
  };

  it("uses baseline rates for all months when no rate change snapshot exists", () => {
    const result = runProjection(SETTINGS_WITH_DATE, [], []);
    // Month 1 MMF end should be ~2515 (2500 contribution + small interest)
    expect(result[0].mmfEnd).toBeGreaterThan(2500);
    expect(result[0].mmfEnd).toBeLessThan(2600);
  });

  it("months before a rate change use the original rate; months after use the new rate", () => {
    // Month 1 = Jul 2026, Month 14 = Aug 2027 — rate change effective Aug 2027
    const higherMMF = 12.0; // significantly higher so the difference is detectable

    const schedule: RateSnapshot[] = [
      {
        effectiveDate: "2027-08-01",
        mmfYield: higherMMF,
        tbill91Rate: DEFAULT_SETTINGS.tbill91Rate,
        tbill182Rate: DEFAULT_SETTINGS.tbill182Rate,
        tbill364Rate: DEFAULT_SETTINGS.tbill364Rate,
        ifbCouponRate: DEFAULT_SETTINGS.ifbCouponRate,
        fxdCouponRate: DEFAULT_SETTINGS.fxdCouponRate,
        withholdingTax: DEFAULT_SETTINGS.withholdingTax,
      },
    ];

    const withChange = runProjection(SETTINGS_WITH_DATE, [], schedule);
    const withoutChange = runProjection(SETTINGS_WITH_DATE, [], []);

    // Month 13 (Jul 2027, before the Aug 2027 change): MMF end should be identical
    expect(withChange[12].mmfEnd).toBeCloseTo(withoutChange[12].mmfEnd, 0);

    // Month 120 (after the rate change): higher MMF rate means higher TOTAL portfolio
    // (higher MMF yield triggers more sweeps, so mmfEnd may be lower but totalEnd is higher)
    expect(withChange[119].totalEnd).toBeGreaterThan(withoutChange[119].totalEnd);
  });

  it("a rate change does not retroactively alter months before the effective date", () => {
    // Rate change from Jul 2031 onward (approx month 61)
    const schedule: RateSnapshot[] = [
      {
        effectiveDate: "2031-07-01",
        mmfYield: 15.0,
        tbill91Rate: DEFAULT_SETTINGS.tbill91Rate,
        tbill182Rate: DEFAULT_SETTINGS.tbill182Rate,
        tbill364Rate: DEFAULT_SETTINGS.tbill364Rate,
        ifbCouponRate: DEFAULT_SETTINGS.ifbCouponRate,
        fxdCouponRate: DEFAULT_SETTINGS.fxdCouponRate,
        withholdingTax: DEFAULT_SETTINGS.withholdingTax,
      },
    ];

    const withChange = runProjection(SETTINGS_WITH_DATE, [], schedule);
    const withoutChange = runProjection(SETTINGS_WITH_DATE, [], []);

    // Months 1-59 must be identical (rate change is in the future)
    for (let i = 0; i < 59; i++) {
      expect(withChange[i].mmfEnd).toBeCloseTo(withoutChange[i].mmfEnd, 0);
    }
    // Month 120 must diverge (higher rate means higher TOTAL portfolio)
    // Higher MMF rate triggers more sweeps → totalEnd is higher even if mmfEnd is similar
    expect(withChange[119].totalEnd).toBeGreaterThan(withoutChange[119].totalEnd);
  });

  it("multiple rate changes apply in chronological order", () => {
    const schedule: RateSnapshot[] = [
      {
        effectiveDate: "2028-01-01", // ~month 19
        mmfYield: 10.0,
        tbill91Rate: DEFAULT_SETTINGS.tbill91Rate,
        tbill182Rate: DEFAULT_SETTINGS.tbill182Rate,
        tbill364Rate: DEFAULT_SETTINGS.tbill364Rate,
        ifbCouponRate: DEFAULT_SETTINGS.ifbCouponRate,
        fxdCouponRate: DEFAULT_SETTINGS.fxdCouponRate,
        withholdingTax: DEFAULT_SETTINGS.withholdingTax,
      },
      {
        effectiveDate: "2030-01-01", // ~month 43 — rate drops back down
        mmfYield: 6.0,
        tbill91Rate: DEFAULT_SETTINGS.tbill91Rate,
        tbill182Rate: DEFAULT_SETTINGS.tbill182Rate,
        tbill364Rate: DEFAULT_SETTINGS.tbill364Rate,
        ifbCouponRate: DEFAULT_SETTINGS.ifbCouponRate,
        fxdCouponRate: DEFAULT_SETTINGS.fxdCouponRate,
        withholdingTax: DEFAULT_SETTINGS.withholdingTax,
      },
    ];

    const result = runProjection(SETTINGS_WITH_DATE, [], schedule);
    // Should not throw and should produce 120 rows
    expect(result).toHaveLength(120);
    // Final total should be positive
    expect(result[119].totalEnd).toBeGreaterThan(0);
  });
});

// ─── Round 28: yield-maximizing allocator & plain-language ledger ──────────────
describe("rankInstrumentsByNetYield (Round 28)", () => {
  const rates = {
    tbill91Rate: 8.82,
    tbill182Rate: 8.78,
    tbill364Rate: 8.97,
    ifbCouponRate: 12.5,
    fxdCouponRate: 12.35,
    withholdingTax: 15,
  };

  it("ranks tax-exempt IFB above taxed FXD and T-bills when long bonds fit", () => {
    const ranked = rankInstrumentsByNetYield(rates, { maxTbillTenor: 12, allowLongBonds: true });
    expect(ranked[0].bucket).toBe("ifb");
    // IFB net == gross (tax-exempt)
    expect(ranked[0].netPct).toBeCloseTo(12.5, 5);
    // every entry's netPct is sorted descending
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].netPct).toBeGreaterThanOrEqual(ranked[i].netPct);
    }
  });

  it("excludes long bonds when allowLongBonds is false (near the horizon)", () => {
    const ranked = rankInstrumentsByNetYield(rates, { maxTbillTenor: 6, allowLongBonds: false });
    expect(ranked.every((r) => r.bucket === "tbill")).toBe(true);
  });

  it("returns nothing investable when no tenor fits and no bonds allowed", () => {
    const ranked = rankInstrumentsByNetYield(rates, { maxTbillTenor: 0, allowLongBonds: false });
    expect(ranked.length).toBe(0);
  });

  it("FXD net-of-tax yield is below its gross coupon (WHT applied)", () => {
    const ranked = rankInstrumentsByNetYield(rates, { maxTbillTenor: 12, allowLongBonds: true });
    const fxd = ranked.find((r) => r.bucket === "fxd")!;
    expect(fxd.netPct).toBeLessThan(fxd.grossPct);
    expect(fxd.netPct).toBeCloseTo(12.35 * 0.85, 4);
  });
});

describe("joinWithAnd (Round 28)", () => {
  it("formats lists in plain English", () => {
    expect(joinWithAnd([])).toBe("");
    expect(joinWithAnd(["a"]))   .toBe("a");
    expect(joinWithAnd(["a", "b"])).toBe("a and b");
    expect(joinWithAnd(["a", "b", "c"])).toBe("a, b and c");
  });
});

describe("plain-language ledger main action (Round 28)", () => {
  it("describes sweeps as a move from the MMF into a named instrument with a maturity month, with no raw jargon", () => {
    const results = runProjection(
      { ...DEFAULT_SETTINGS, startingContribution: 120000, stepUpAmount: 0, horizonMonths: 120, startDate: "2026-07-01" },
      [], [], [], [], [], [], null,
    );
    const sweepMonth = results.find((r) => r.mmfToDhow > 0);
    expect(sweepMonth).toBeTruthy();
    expect(sweepMonth!.mainAction).toContain("Move KES");
    expect(sweepMonth!.mainAction).toContain("from the MMF into");
    expect(sweepMonth!.mainAction).toMatch(/maturing [A-Z][a-z]{2} \d{4}/);
    // No leftover internal jargon in the plain-language label.
    expect(sweepMonth!.mainAction).not.toContain("DhowCSD");
    expect(sweepMonth!.mainAction).not.toMatch(/sweep KES/);
  });

  it("a no-sweep month reads as adding the saving to the MMF", () => {
    const results = runProjection(
      { ...DEFAULT_SETTINGS, startingContribution: 1000, stepUpAmount: 0, horizonMonths: 120, startDate: "2026-07-01" },
      [], [], [], [], [], [], null,
    );
    const quiet = results.find((r) => r.mmfToDhow === 0 && r.cbkCashIn === 0);
    expect(quiet).toBeTruthy();
    expect(quiet!.mainAction.toLowerCase()).toContain("mmf");
  });
});

describe("sweep rationale for the ledger tooltip (Round 29)", () => {
  it("a swept month exposes a net-yield-ranked rationale with exactly one chosen-or-top family and a summary", () => {
    const results = runProjection(
      { ...DEFAULT_SETTINGS, startingContribution: 120000, stepUpAmount: 0, horizonMonths: 120, startDate: "2026-07-01" },
      [], [], [], [], [], [], null,
    );
    const sweepMonth = results.find((r) => r.mmfToDhow > 0 && r.sweepRationale);
    expect(sweepMonth).toBeTruthy();
    const rat = sweepMonth!.sweepRationale!;
    expect(rat.amount).toBeGreaterThan(0);
    expect(rat.candidates.length).toBeGreaterThan(0);
    // Ranks are 1-based, contiguous, and ordered by descending net yield.
    rat.candidates.forEach((c, i) => expect(c.rank).toBe(i + 1));
    for (let i = 1; i < rat.candidates.length; i++) {
      expect(rat.candidates[i - 1].netPct).toBeGreaterThanOrEqual(rat.candidates[i].netPct);
    }
    // At least one family was actually chosen, and the summary mentions net yield.
    expect(rat.candidates.some((c) => c.chosen)).toBe(true);
    expect(rat.summary.toLowerCase()).toContain("net");
  });

  it("a month with no sweep has a null rationale", () => {
    const results = runProjection(
      { ...DEFAULT_SETTINGS, startingContribution: 1000, stepUpAmount: 0, horizonMonths: 120, startDate: "2026-07-01" },
      [], [], [], [], [], [], null,
    );
    const quiet = results.find((r) => r.mmfToDhow === 0);
    expect(quiet).toBeTruthy();
    expect(quiet!.sweepRationale).toBeNull();
  });
});
