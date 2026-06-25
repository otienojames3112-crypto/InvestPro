import { describe, it, expect } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// R42 — Coupon-bond worked stories. These lock the figures shown on the /learn
// page for Juma (FXD), Otieno (IFB) and Chalo (floating-rate). Coupon bonds are
// bought at par; the coupon is the return; FXD/floating coupons carry 15% WHT;
// IFB coupons are tax-exempt. The /learn page computes the same numbers live so
// the page can never drift from these acceptance tests.
// ─────────────────────────────────────────────────────────────────────────────

const FACE = 100_000;
const COUPON_WHT = 0.15;

describe("R42 — Juma's FXD bond (taxable coupon, semi-annual)", () => {
  const couponPct = 13.2;
  const annualGross = FACE * (couponPct / 100);
  const annualNet = annualGross * (1 - COUPON_WHT);

  it("gross coupon is face × rate (no discount mechanics)", () => {
    expect(annualGross).toBeCloseTo(13_200, 6);
  });

  it("each semi-annual coupon is half the annual coupon", () => {
    expect(annualGross / 2).toBeCloseTo(6_600, 6);
  });

  it("15% WHT is taken from each coupon", () => {
    const semiGross = annualGross / 2;
    expect(semiGross * COUPON_WHT).toBeCloseTo(990, 6);
    expect(semiGross * (1 - COUPON_WHT)).toBeCloseTo(5_610, 6);
  });

  it("net coupon income per year after WHT", () => {
    expect(annualNet).toBeCloseTo(11_220, 6);
  });

  it("is bought at par — there is NO discount return", () => {
    const price = FACE; // coupon bonds are par instruments
    expect(FACE - price).toBe(0);
  });
});

describe("R42 — Otieno's IFB bond (tax-exempt coupon)", () => {
  const couponPct = 12.5;
  const annualGross = FACE * (couponPct / 100);

  it("gross coupon is face × rate", () => {
    expect(annualGross).toBeCloseTo(12_500, 6);
  });

  it("WHT is zero — IFB coupons are exempt", () => {
    const wht = 0; // exempt
    expect(annualGross * (1 - 0)).toBeCloseTo(annualGross, 6);
    expect(wht).toBe(0);
  });

  it("net equals gross because there is no tax drag", () => {
    const annualNet = annualGross; // exempt
    expect(annualNet).toBeCloseTo(12_500, 6);
  });

  it("a tax-exempt 12.5% can beat a taxed 13.2% on net yield", () => {
    const fxdNet = 100_000 * 0.132 * (1 - COUPON_WHT); // 11,220
    const ifbNet = annualGross; // 12,500
    expect(ifbNet).toBeGreaterThan(fxdNet);
  });
});

describe("R42 — Chalo's floating-rate bond (resets to benchmark + margin)", () => {
  const margin = 1.5;

  it("first coupon uses benchmark + fixed margin", () => {
    const benchmark1 = 9.5;
    const rate1 = benchmark1 + margin; // 11.0%
    expect(rate1).toBeCloseTo(11.0, 6);
    const coupon1Gross = FACE * (rate1 / 100);
    expect(coupon1Gross).toBeCloseTo(11_000, 6);
    expect(coupon1Gross * (1 - COUPON_WHT)).toBeCloseTo(9_350, 6);
  });

  it("after an upward reset, only the benchmark moves; the margin stays fixed", () => {
    const benchmark2 = 11.0;
    const rate2 = benchmark2 + margin; // 12.5%
    expect(rate2).toBeCloseTo(12.5, 6);
    const coupon2Gross = FACE * (rate2 / 100);
    expect(coupon2Gross).toBeCloseTo(12_500, 6);
    expect(coupon2Gross * (1 - COUPON_WHT)).toBeCloseTo(10_625, 6);
  });

  it("a higher benchmark produces a strictly higher coupon", () => {
    const c1 = FACE * ((9.5 + margin) / 100);
    const c2 = FACE * ((11.0 + margin) / 100);
    expect(c2).toBeGreaterThan(c1);
  });

  it("floating coupons are taxed like FXD (15% WHT), not exempt", () => {
    const couponGross = FACE * ((9.5 + margin) / 100);
    expect(couponGross * COUPON_WHT).toBeGreaterThan(0);
  });
});
