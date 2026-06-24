import { describe, it, expect } from "vitest";
import {
  simulateAccrual,
  simulateAccrualDated,
  geometricDailyRate,
  ratesOnDate,
  oneDayInterest,
  whtOn,
  grossUpAnnualInterest,
  WHT_RATES,
} from "@shared/accrual";

describe("MMF daily accrual math (geometric daily rate)", () => {
  it("geometric daily rate compounds back to EXACTLY the EAR over a year", () => {
    // (1 + 0.12)^(1/365) compounded over 365 days reproduces 12% — no overshoot.
    const principal = 1_000_000;
    const ear = 12;
    const rows = simulateAccrual(principal, ear, 365, 0, "daily", 365);
    const growth = rows[rows.length - 1].closingBalance / principal - 1;
    expect(growth).toBeCloseTo(0.12, 4); // not e^0.12-1 ≈ 0.1275
  });

  it("daily gross uses the geometric rate, not EAR/365", () => {
    // 13.54% EAR → geometric daily on 1,000,000 ≈ 347.7/day, well below the
    // naive 13.54%/365 = 370.96/day. This is the bug from the brief (#3).
    const geo = geometricDailyRate(13.54, 365) * 1_000_000;
    const naive = (13.54 / 100 / 365) * 1_000_000;
    expect(geo).toBeLessThan(naive);
    expect(geo).toBeCloseTo(347.7, 0);
  });

  it("applies 15% WHT to each day's gross interest", () => {
    const rows = simulateAccrual(1_000_000, 12, 365, 15, "daily", 1);
    const r = rows[0];
    expect(r.grossInterest).toBeCloseTo(geometricDailyRate(12, 365) * 1_000_000, 4);
    expect(r.wht).toBeCloseTo(r.grossInterest * 0.15, 6);
    expect(r.netInterest).toBeCloseTo(r.grossInterest * 0.85, 6);
  });

  it("monthly crediting holds balance flat until day 30, then credits", () => {
    const rows = simulateAccrual(1_000_000, 12, 365, 15, "monthly", 31);
    // Days 1..29 closing balance unchanged
    expect(rows[0].closingBalance).toBe(1_000_000);
    expect(rows[28].closingBalance).toBe(1_000_000);
    // Day 30 credits the accrued net interest
    expect(rows[29].closingBalance).toBeGreaterThan(1_000_000);
    // Day 31 opening equals day 30 closing
    expect(rows[30].openingBalance).toBeCloseTo(rows[29].closingBalance, 6);
  });

  it("produces exactly `days` rows", () => {
    expect(simulateAccrual(500_000, 10, 360, 15, "daily", 90)).toHaveLength(90);
  });

  it("360 day-count basis yields a higher daily rate than 365", () => {
    const a = simulateAccrual(1_000_000, 12, 360, 0, "daily", 1)[0];
    const b = simulateAccrual(1_000_000, 12, 365, 0, "daily", 1)[0];
    expect(a.grossInterest).toBeGreaterThan(b.grossInterest);
  });

  it("oneDayInterest matches a single simulated day", () => {
    const sim = simulateAccrual(2_000_000, 9, 365, 15, "daily", 1)[0];
    const one = oneDayInterest(2_000_000, 9, 365, 15);
    expect(one.gross).toBeCloseTo(sim.grossInterest, 6);
    expect(one.wht).toBeCloseTo(sim.wht, 6);
    expect(one.net).toBeCloseTo(sim.netInterest, 6);
  });

  it("matches the brief: 13.54% EAR on KES 41,000 ≈ 14.27 gross/day (not 15.21)", () => {
    const sim = simulateAccrual(41_000, 13.54, 365, 15, "daily", 1)[0];
    // Geometric daily gross ≈ 14.26; the buggy simple EAR/365 gave ≈ 15.21.
    expect(sim.grossInterest).toBeCloseTo(14.26, 1);
    expect(sim.grossInterest).toBeLessThan(15.21);
  });
});

describe("Dated accrual: carries across months & picks up rate/WHT changes (Fix #4)", () => {
  const fallback = { ear: 10, whtRate: 15 };

  it("ratesOnDate uses the OLD rate before a change and the NEW rate from the change date", () => {
    const history = [
      { effectiveDate: "2026-01-01", ear: 10, whtRate: 15 },
      { effectiveDate: "2026-06-01", ear: 13, whtRate: 15 },
    ];
    expect(ratesOnDate("2026-05-31", history, fallback).ear).toBe(10);
    expect(ratesOnDate("2026-06-01", history, fallback).ear).toBe(13);
    expect(ratesOnDate("2026-12-31", history, fallback).ear).toBe(13);
  });

  it("closing balance of one day is the opening of the next (continuous compounding)", () => {
    const rows = simulateAccrualDated(100_000, "2026-01-01", 365, 90, [], fallback);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].openingBalance).toBeCloseTo(rows[i - 1].closingBalance, 6);
    }
    expect(rows).toHaveLength(90);
  });

  it("a mid-stream rate hike increases the applied EAR from the effective date", () => {
    const history = [
      { effectiveDate: "2026-01-01", ear: 8, whtRate: 15 },
      { effectiveDate: "2026-02-01", ear: 16, whtRate: 15 },
    ];
    const rows = simulateAccrualDated(1_000_000, "2026-01-15", 365, 40, history, fallback);
    const jan = rows.find(r => r.date === "2026-01-20")!;
    const feb = rows.find(r => r.date === "2026-02-10")!;
    expect(jan.appliedEar).toBe(8);
    expect(feb.appliedEar).toBe(16);
    expect(feb.grossInterest).toBeGreaterThan(jan.grossInterest);
  });

  it("a WHT change flows through to each day's tax from its effective date", () => {
    const history = [
      { effectiveDate: "2026-01-01", ear: 12, whtRate: 15 },
      { effectiveDate: "2026-03-01", ear: 12, whtRate: 20 },
    ];
    const rows = simulateAccrualDated(1_000_000, "2026-02-20", 365, 20, history, fallback);
    expect(rows.find(r => r.date === "2026-02-25")!.appliedWht).toBe(15);
    expect(rows.find(r => r.date === "2026-03-05")!.appliedWht).toBe(20);
  });
});

describe("Kenyan withholding tax", () => {
  it("MMF and bank interest use 15% final tax", () => {
    expect(WHT_RATES.mmfInterest).toBe(15);
    expect(WHT_RATES.bankInterest).toBe(15);
    expect(WHT_RATES.dividend).toBe(5);
  });

  it("whtOn never returns negative tax", () => {
    expect(whtOn(-100, 15)).toBe(0);
    expect(whtOn(1000, 15)).toBeCloseTo(150, 6);
  });

  it("grossUpAnnualInterest splits gross into wht + net", () => {
    const { gross, wht, net } = grossUpAnnualInterest(1_000_000, 12, 15);
    expect(gross).toBeCloseTo(120_000, 4);
    expect(wht).toBeCloseTo(18_000, 4);
    expect(net).toBeCloseTo(102_000, 4);
    expect(wht + net).toBeCloseTo(gross, 6);
  });

  it("tax-exempt instruments (rate 0) produce zero wht", () => {
    const { gross, wht, net } = grossUpAnnualInterest(1_000_000, 13, 0);
    expect(wht).toBe(0);
    expect(net).toBeCloseTo(gross, 6);
  });
});
