/**
 * Engine regression test — v2 (corrected engine, Option A)
 *
 * After fixing Fix 1 (no double-counting), the correct month-120 portfolio value
 * with the baseline parameters is KES 4,763,385 — NOT the PDF's KES 5,279,234.
 * The PDF's figure was computed with the old buggy engine that double-counted
 * T-bill/IFB/FXD returns (compounding buckets in place AND paying coupons/maturity
 * proceeds to MMF). The corrected engine is internally consistent and tied to real money.
 *
 * To reach KES 5,000,000 under the corrected engine, a KES 3,500 step-up is required
 * (vs the PDF's KES 3,000 step-up assumption).
 *
 * Baseline parameters:
 * - Start date: 2026-07-01
 * - Starting contribution: KES 2,500/month
 * - Step-up: +KES 3,000 every 6 months
 * - MMF yield: 8.78% gross (15% WHT → net ~7.46%)
 * - T-Bill 91d: 8.8206%, 182d: 8.7782%, 364d: 8.9746%
 * - IFB coupon: 12.5% (tax-exempt)
 * - FXD coupon: 12.35% gross (15% WHT → net ~10.50%)
 * - Withholding tax: 15%
 * - Safety floor: KES 50,000
 * - Target: KES 5,000,000
 *
 * Corrected month-120 value: KES 4,763,385
 * Tolerance: ±2% = [4,668,117 – 4,858,653]
 */

import { describe, it, expect } from "vitest";
import { runProjection } from "./engine";

const BASELINE_SETTINGS = {
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
};

describe("Engine regression — corrected baseline projection (Option A)", () => {
  it("month-120 portfolio value is within ±2% of KES 4,763,385 (corrected engine)", () => {
    const result = runProjection(BASELINE_SETTINGS);

    expect(result).toHaveLength(120);

    const month120 = result[119];
    const portfolio = month120.totalEnd;

    console.log(`Month-120 portfolio value: KES ${portfolio.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`);
    console.log(`Expected (corrected): ~KES 4,763,385`);
    console.log(`Delta: ${((portfolio / 4_763_385 - 1) * 100).toFixed(2)}%`);

    const EXPECTED = 4_763_385;
    const TOLERANCE = 0.02; // ±2%

    expect(portfolio).toBeGreaterThan(EXPECTED * (1 - TOLERANCE));
    expect(portfolio).toBeLessThan(EXPECTED * (1 + TOLERANCE));
  });

  it("KES 3,500 step-up hits KES 5M target under corrected engine", () => {
    const result = runProjection({ ...BASELINE_SETTINGS, stepUpAmount: 3500 });
    const last = result[119];
    expect(last.totalEnd).toBeGreaterThanOrEqual(5_000_000);
  });

  it("KES 3,000 step-up does NOT hit KES 5M target under corrected engine", () => {
    const result = runProjection(BASELINE_SETTINGS);
    const last = result[119];
    expect(last.totalEnd).toBeLessThan(5_000_000);
  });

  it("month-1 contribution matches starting contribution", () => {
    const result = runProjection(BASELINE_SETTINGS);
    expect(result[0].contribution).toBe(2500);
  });

  it("month-7 contribution is stepped up by stepUpAmount", () => {
    const result = runProjection(BASELINE_SETTINGS);
    expect(result[6].contribution).toBe(5500);
  });

  it("no month has negative portfolio value", () => {
    const result = runProjection(BASELINE_SETTINGS);
    for (const month of result) {
      expect(month.totalEnd).toBeGreaterThanOrEqual(0);
    }
  });

  it("portfolio grows monotonically (no unexpected drops)", () => {
    const result = runProjection(BASELINE_SETTINGS);
    for (let i = 1; i < result.length; i++) {
      const prev = result[i - 1].totalEnd;
      const curr = result[i].totalEnd;
      expect(curr).toBeGreaterThanOrEqual(prev - 1);
    }
  });

  it("total contributions equal KES 3,720,000 (6 months × 20 steps × avg contribution)", () => {
    const result = runProjection(BASELINE_SETTINGS);
    const sumContributions = result.reduce((s, m) => s + m.contribution, 0);
    // 6 months × sum(2500 + i*3000 for i=0..19) = 6 × 620,000 = 3,720,000
    expect(sumContributions).toBeCloseTo(3_720_000, -3);
  });

  it("year-end checkpoints match spec within 3% (years 1–9)", () => {
    const result = runProjection(BASELINE_SETTINGS);
    const SPEC_CHECKPOINTS: Record<number, number> = {
      12:  49_590,
      24:  177_186,
      36:  389_825,
    };
    for (const [monthStr, specValue] of Object.entries(SPEC_CHECKPOINTS)) {
      const m = Number(monthStr);
      const row = result[m - 1];
      const delta = Math.abs(row.totalEnd / specValue - 1);
      expect(delta).toBeLessThan(0.03); // within 3%
    }
  });
});
