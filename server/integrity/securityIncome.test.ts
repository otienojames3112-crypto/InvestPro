import { describe, it, expect } from "vitest";
import {
  computeSecurityIncome,
  whtRateFor,
  isDiscountSecurity,
  isCouponSecurity,
  securityAccruedNetToDate,
  securityIncomeOverWindow,
  holdingDays,
  type SecurityIncomeSpec,
} from "../../shared/securityIncome";

describe("securityIncome — instrument classification", () => {
  it("classifies discount vs coupon instruments", () => {
    expect(isDiscountSecurity("tbill_91")).toBe(true);
    expect(isDiscountSecurity("tbill_364")).toBe(true);
    expect(isDiscountSecurity("zero_coupon")).toBe(true);
    expect(isDiscountSecurity("fxd")).toBe(false);
    expect(isCouponSecurity("fxd")).toBe(true);
    expect(isCouponSecurity("ifb")).toBe(true);
    expect(isCouponSecurity("tbill_91")).toBe(false);
  });
});

describe("securityIncome — WHT rules", () => {
  it("IFB is tax-exempt (0%)", () => {
    expect(whtRateFor({ securityType: "ifb", faceValue: 1e6, couponRate: 12 })).toBe(0);
  });
  it("T-bills attract 15%", () => {
    expect(whtRateFor({ securityType: "tbill_91", faceValue: 1e6, couponRate: 9 })).toBe(15);
  });
  it("FXD is tenor-tiered: 10% at/over 10y, else 15%", () => {
    expect(whtRateFor({ securityType: "fxd", faceValue: 1e6, couponRate: 12, tenorYears: 12 })).toBe(10);
    expect(whtRateFor({ securityType: "fxd", faceValue: 1e6, couponRate: 12, tenorYears: 5 })).toBe(15);
  });
  it("per-holding override wins over the tier default", () => {
    expect(
      whtRateFor({ securityType: "fxd", faceValue: 1e6, couponRate: 12, tenorYears: 12, whtRateOverride: 5 }),
    ).toBe(5);
    // Even an IFB can be overridden if the law changes.
    expect(
      whtRateFor({ securityType: "ifb", faceValue: 1e6, couponRate: 12, whtRateOverride: 10 }),
    ).toBe(10);
  });
});

describe("securityIncome — T-bill discount accretion (NOT a coupon)", () => {
  const tbill: SecurityIncomeSpec = {
    securityType: "tbill_364",
    faceValue: 1_000_000,
    couponRate: 0, // discount instrument priced explicitly
    purchasePrice: 920_000,
    issueDate: "2026-01-01",
    maturityDate: "2026-12-31", // ~364 days
  };

  it("income equals the discount (face − price), not face × rate", () => {
    const r = computeSecurityIncome(tbill);
    expect(r.isDiscount).toBe(true);
    expect(r.lifetimeGross).toBeCloseTo(80_000, 2); // 1,000,000 − 920,000
    expect(r.lifetimeWht).toBeCloseTo(12_000, 2); // 15%
    expect(r.lifetimeNet).toBeCloseTo(68_000, 2);
  });

  it("accretes straight-line: per-day × days == lifetime discount", () => {
    const r = computeSecurityIncome(tbill);
    const days = holdingDays(tbill);
    expect(r.grossPerDay * days).toBeCloseTo(80_000, 0);
  });

  it("half-way through the window, ~half the discount has accrued net", () => {
    const half = securityAccruedNetToDate(tbill, "2026-07-01");
    expect(half).toBeGreaterThan(30_000);
    expect(half).toBeLessThan(38_000);
  });
});

describe("securityIncome — FXD coupon accrual", () => {
  const fxd: SecurityIncomeSpec = {
    securityType: "fxd",
    faceValue: 1_000_000,
    couponRate: 12, // 12% p.a. → 60,000 semi-annual coupon
    tenorYears: 6,
    issueDate: "2026-01-01",
    maturityDate: "2032-01-01",
  };

  it("one coupon period's gross is the semi-annual coupon", () => {
    const r = computeSecurityIncome(fxd);
    expect(r.isDiscount).toBe(false);
    expect(r.lifetimeGross).toBeCloseTo(60_000, 2); // 120,000 / 2
    expect(r.whtPct).toBe(15);
    expect(r.lifetimeWht).toBeCloseTo(9_000, 2);
  });

  it("IFB coupon accrues the same way but is tax-exempt", () => {
    const ifb = computeSecurityIncome({ ...fxd, securityType: "ifb" });
    expect(ifb.lifetimeGross).toBeCloseTo(60_000, 2);
    expect(ifb.lifetimeWht).toBe(0);
    expect(ifb.lifetimeNet).toBeCloseTo(60_000, 2);
  });
});

describe("securityIncome — forward window", () => {
  it("sums live securities' gross/WHT over a window", () => {
    const specs: SecurityIncomeSpec[] = [
      {
        securityType: "fxd",
        faceValue: 1_000_000,
        couponRate: 12,
        tenorYears: 6,
        issueDate: "2026-01-01",
        maturityDate: "2032-01-01",
      },
      {
        securityType: "ifb",
        faceValue: 1_000_000,
        couponRate: 10,
        issueDate: "2026-01-01",
        maturityDate: "2036-01-01",
      },
    ];
    const w = securityIncomeOverWindow(specs, 365, new Date("2026-06-01").getTime());
    // FXD taxed, IFB exempt → some WHT but less than 15% of total gross.
    expect(w.gross).toBeGreaterThan(0);
    expect(w.wht).toBeGreaterThan(0);
    expect(w.net).toBeCloseTo(w.gross - w.wht, 2);
    expect(w.base).toBeCloseTo(2_000_000, 2);
  });
});
