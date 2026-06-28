import { describe, it, expect } from "vitest";
import {
  securityYieldContribution,
  isDiscountSecurityType,
  currentSecurityValue,
  accruedCouponSinceLastCoupon,
} from "../shared/discount";
import { govAccruedInterestToDate } from "../shared/actuals";

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

describe("Part 1 — securityYieldContribution (single source of truth for YTM)", () => {
  it("coupon bond above face still yields a healthy positive net coupon yield (not negative accretion)", () => {
    // FXD trading above face (current > face): the OLD (face-current)/current math
    // produced a NEGATIVE yield. The corrected helper returns couponRate*(1-wht).
    const y = securityYieldContribution({
      securityType: "fxd",
      faceValue: 100_000,
      currentValue: 101_833, // dirty value above face
      couponRate: 13.5,
      whtRatePct: 15,
    });
    expect(y).not.toBeNull();
    // 13.5% * (1 - 0.15) = 11.475%
    expect(y!).toBeCloseTo(0.11475, 5);
    expect(y!).toBeGreaterThan(0);
  });

  it("IFB is tax-exempt: yield equals the gross coupon rate", () => {
    const y = securityYieldContribution({
      securityType: "ifb",
      faceValue: 100_000,
      currentValue: 100_500,
      couponRate: 12.5,
      whtRatePct: 15, // ignored because IFB is exempt
    });
    expect(y!).toBeCloseTo(0.125, 6);
  });

  it("discount lot keeps accretion-to-face annualised yield", () => {
    // Bought at 95,000, redeems at 100,000 in 182 days.
    const y = securityYieldContribution({
      securityType: "tbill_182",
      faceValue: 100_000,
      currentValue: 95_000,
      daysToMaturity: 182,
    });
    const expected = ((100_000 - 95_000) / 95_000) * (365 / 182);
    expect(y!).toBeCloseTo(expected, 6);
    expect(y!).toBeGreaterThan(0);
  });

  it("returns null for unusable lots so callers skip them from the weight", () => {
    expect(
      securityYieldContribution({ securityType: "tbill_91", faceValue: 0, currentValue: 0 }),
    ).toBeNull();
    expect(
      securityYieldContribution({
        securityType: "tbill_91",
        faceValue: 100_000,
        currentValue: 99_000,
        daysToMaturity: 0,
      }),
    ).toBeNull();
    // coupon bond with no coupon rate
    expect(
      securityYieldContribution({
        securityType: "fxd",
        faceValue: 100_000,
        currentValue: 100_000,
        couponRate: 0,
      }),
    ).toBeNull();
  });

  it("isDiscountSecurityType classifies instruments consistently", () => {
    expect(isDiscountSecurityType("tbill_91")).toBe(true);
    expect(isDiscountSecurityType("tbill_364")).toBe(true);
    expect(isDiscountSecurityType("zero_coupon")).toBe(true);
    expect(isDiscountSecurityType("fxd")).toBe(false);
    expect(isDiscountSecurityType("ifb")).toBe(false);
    expect(isDiscountSecurityType("floating_rate")).toBe(false);
  });
});

describe("Part 1 — govAccruedInterestToDate scoped to the current coupon period", () => {
  it("a bond held for years never reports more than ~one coupon period of interest", () => {
    const now = Date.UTC(2026, 5, 28); // 2026-06-28
    const issue = now - 900 * DAY; // issued ~2.5 years ago → many coupons already paid
    const maturity = now + 900 * DAY;
    const net = govAccruedInterestToDate(
      {
        securityType: "fxd",
        faceValue: 1_000_000,
        couponRate: 13.5,
        issueDate: iso(issue),
        maturityDate: iso(maturity),
        tenorYears: 5,
      },
      iso(now),
    );
    // One half-year coupon gross = 1,000,000 * 13.5% / 2 = 67,500; net of 15% WHT
    // = 57,375. The accrued-since-last-coupon figure must NOT exceed this, no
    // matter how old the bond is (the OLD issue→today math would report >150k).
    const oneCouponNet = (1_000_000 * 0.135) / 2 * (1 - 0.15);
    expect(net).toBeLessThanOrEqual(oneCouponNet + 1);
    expect(net).toBeGreaterThanOrEqual(0);
  });

  it("reconciles with currentSecurityValue's accrued component for the same FXD lot", () => {
    const now = new Date(Date.UTC(2026, 5, 28));
    const issue = new Date(now.getTime() - 100 * DAY); // 100 days into a period
    const maturity = new Date(now.getTime() + 800 * DAY);
    const face = 1_000_000;
    const couponPct = 13.5;

    // Net accrued from the actuals estimate.
    const estNet = govAccruedInterestToDate(
      {
        securityType: "fxd",
        faceValue: face,
        couponRate: couponPct,
        issueDate: issue.toISOString().slice(0, 10),
        maturityDate: maturity.toISOString().slice(0, 10),
        tenorYears: 5,
      },
      now.toISOString().slice(0, 10),
    );

    // Dirty-value accrued component from the register's single source of truth.
    const grossAccrued = accruedCouponSinceLastCoupon(
      face,
      couponPct,
      issue.getTime(),
      now.getTime(),
      maturity.getTime(),
    );
    const dirtyNet = grossAccrued * (1 - 0.15);
    const dirty = currentSecurityValue(
      {
        securityType: "fxd",
        faceValue: face,
        couponRate: couponPct,
        issueDate: issue,
        maturityDate: maturity,
        whtRatePct: 15,
      },
      now,
    );

    // The actuals estimate and the register's accrued component agree (both use
    // accrued-since-last-coupon, net of the same WHT). Allow date-rounding slack.
    expect(estNet).toBeCloseTo(dirtyNet, -1);
    // And the dirty value equals face + net accrued.
    expect(dirty).toBeCloseTo(face + dirtyNet, -1);
  });

  it("IFB accrues gross (tax-exempt) within the current period", () => {
    const now = new Date(Date.UTC(2026, 5, 28));
    const issue = new Date(now.getTime() - 91 * DAY); // ~half a period in
    const maturity = new Date(now.getTime() + 1000 * DAY);
    const net = govAccruedInterestToDate(
      {
        securityType: "ifb",
        faceValue: 1_000_000,
        couponRate: 12.5,
        issueDate: issue.toISOString().slice(0, 10),
        maturityDate: maturity.toISOString().slice(0, 10),
        isTaxExempt: true,
      },
      now.toISOString().slice(0, 10),
    );
    const oneCouponGross = (1_000_000 * 0.125) / 2;
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThanOrEqual(oneCouponGross + 1);
  });

  it("discount T-bill income stays scoped within its holding window (unchanged behaviour)", () => {
    const now = new Date(Date.UTC(2026, 5, 28));
    const issue = new Date(now.getTime() - 91 * DAY);
    const maturity = new Date(now.getTime() + 91 * DAY); // halfway through a 182d bill
    const net = govAccruedInterestToDate(
      {
        securityType: "tbill_182",
        faceValue: 100_000,
        couponRate: 0,
        issueDate: issue.toISOString().slice(0, 10),
        maturityDate: maturity.toISOString().slice(0, 10),
        purchasePrice: 95_000,
      },
      now.toISOString().slice(0, 10),
    );
    // ~half the 5,000 discount, net of 15% WHT ≈ 2,125. Must be positive and well
    // under the full discount.
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(5_000 * (1 - 0.15));
  });
});
