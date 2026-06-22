import { describe, it, expect } from "vitest";
import {
  simulateAccrual,
  oneDayInterest,
  whtOn,
  grossUpAnnualInterest,
  WHT_RATES,
} from "@shared/accrual";

describe("MMF daily accrual math", () => {
  it("daily crediting compounds and is close to the EAR over 365 days", () => {
    const principal = 1_000_000;
    const ear = 12; // 12% gross
    const wht = 0; // isolate compounding from tax
    const rows = simulateAccrual(principal, ear, 365, wht, "daily", 365);
    const final = rows[rows.length - 1].closingBalance;
    // Daily compounding of 12%/365 over 365 days ≈ e^0.12 - 1 ≈ 12.7497%
    const growth = final / principal - 1;
    expect(growth).toBeGreaterThan(0.126);
    expect(growth).toBeLessThan(0.128);
  });

  it("applies 15% WHT to each day's gross interest", () => {
    const rows = simulateAccrual(1_000_000, 12, 365, 15, "daily", 1);
    const r = rows[0];
    expect(r.grossInterest).toBeCloseTo((1_000_000 * 0.12) / 365, 4);
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
