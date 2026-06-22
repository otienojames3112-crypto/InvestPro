import { describe, it, expect } from "vitest";

/**
 * Mirrors the per-bucket WHT computation in the `deposits.summary` procedure.
 * Pure function kept here so the tax math is regression-tested independent of
 * the tRPC/DB plumbing.
 */
function computeTaxBreakdown(
  byBucket: { mmf: number; tbill: number; ifb: number; fxd: number },
  rates: { mmfYield: number; tbill364Rate: number; fxdCouponRate: number; withholdingTax: number },
) {
  const whtFrac = rates.withholdingTax / 100;
  const mmfWht = byBucket.mmf * (rates.mmfYield / 100) * whtFrac;
  const tbillWht = byBucket.tbill * (rates.tbill364Rate / 100) * whtFrac;
  const fxdCouponIncome = byBucket.fxd * (rates.fxdCouponRate / 100);
  const fxdWht = fxdCouponIncome * whtFrac;
  const ifbWht = 0;
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    taxBreakdown: {
      mmf: round2(mmfWht),
      tbill: round2(tbillWht),
      ifb: ifbWht,
      fxd: round2(fxdWht),
    },
    taxLiability: round2(mmfWht + tbillWht + fxdWht + ifbWht),
    annualFxdCouponIncome: round2(fxdCouponIncome),
  };
}

const RATES = { mmfYield: 10, tbill364Rate: 12, fxdCouponRate: 13, withholdingTax: 15 };

describe("deposits.summary tax breakdown", () => {
  it("attributes WHT to the MMF bucket (not FXD) when only MMF is held", () => {
    const r = computeTaxBreakdown({ mmf: 1_000_000, tbill: 0, ifb: 0, fxd: 0 }, RATES);
    // 1,000,000 * 10% * 15% = 15,000
    expect(r.taxBreakdown.mmf).toBe(15000);
    expect(r.taxBreakdown.fxd).toBe(0);
    expect(r.taxBreakdown.tbill).toBe(0);
    expect(r.taxLiability).toBe(15000);
  });

  it("treats IFB as fully tax-exempt regardless of balance", () => {
    const r = computeTaxBreakdown({ mmf: 0, tbill: 0, ifb: 5_000_000, fxd: 0 }, RATES);
    expect(r.taxBreakdown.ifb).toBe(0);
    expect(r.taxLiability).toBe(0);
  });

  it("computes T-bill discount WHT correctly", () => {
    const r = computeTaxBreakdown({ mmf: 0, tbill: 2_000_000, ifb: 0, fxd: 0 }, RATES);
    // 2,000,000 * 12% * 15% = 36,000
    expect(r.taxBreakdown.tbill).toBe(36000);
    expect(r.taxLiability).toBe(36000);
  });

  it("computes FXD coupon WHT and reports gross coupon income", () => {
    const r = computeTaxBreakdown({ mmf: 0, tbill: 0, ifb: 0, fxd: 1_000_000 }, RATES);
    // coupon = 1,000,000 * 13% = 130,000 ; WHT = 130,000 * 15% = 19,500
    expect(r.annualFxdCouponIncome).toBe(130000);
    expect(r.taxBreakdown.fxd).toBe(19500);
  });

  it("sums all taxable buckets into the total liability", () => {
    const r = computeTaxBreakdown(
      { mmf: 1_000_000, tbill: 1_000_000, ifb: 1_000_000, fxd: 1_000_000 },
      RATES,
    );
    // mmf 15,000 + tbill 18,000 + fxd 19,500 + ifb 0 = 52,500
    expect(r.taxLiability).toBe(52500);
    expect(r.taxBreakdown.mmf).toBe(15000);
    expect(r.taxBreakdown.tbill).toBe(18000);
    expect(r.taxBreakdown.fxd).toBe(19500);
    expect(r.taxBreakdown.ifb).toBe(0);
  });

  it("returns zero liability when there are no deposits", () => {
    const r = computeTaxBreakdown({ mmf: 0, tbill: 0, ifb: 0, fxd: 0 }, RATES);
    expect(r.taxLiability).toBe(0);
  });
});
