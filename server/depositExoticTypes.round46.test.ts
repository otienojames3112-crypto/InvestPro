import { describe, it, expect } from "vitest";
import { discountPriceForSecurity, zeroCouponPrice } from "../shared/discount";
import { tenorYearsForSecurity, isDiscountInstrument } from "../shared/securityTenor";

/**
 * R46 — the Record Deposit drawer can now record ZERO-COUPON and FLOATING-RATE
 * paper, not just T-bill / IFB / FXD. The drawer maps these onto existing server
 * buckets (zero → tbill, floating → fxd) but passes the PRECISE govSecurityType,
 * so the auto-created register row uses the right mechanics. These tests pin the
 * shared logic the deposit path relies on, mirroring what the server does in
 * deposits.add for each type.
 */
describe("R46 — zero-coupon paper added via Record Deposits is priced at a discount", () => {
  it("is recognised as a discount instrument", () => {
    expect(isDiscountInstrument("zero_coupon")).toBe(true);
  });

  it("derives a below-face purchase price via compound pricing (same as register)", () => {
    const FACE = 200_000;
    const RATE = 13.5;
    const years = tenorYearsForSecurity("zero_coupon", 3);
    const depositPrice = discountPriceForSecurity({
      isDiscount: true,
      isZeroCoupon: true,
      faceValue: FACE,
      ratePct: RATE,
      tenorDays: 0,
      tenorYears: years,
    });
    // The register path for a zero-coupon collapses to zeroCouponPrice(face, rate, years).
    const registerPrice = zeroCouponPrice(FACE, RATE, years);
    expect(Math.abs(depositPrice - registerPrice)).toBeLessThan(1);
    expect(depositPrice).toBeLessThan(FACE);
    expect(depositPrice).toBeGreaterThan(0);
  });

  it("longer tenors price lower (more discount) for the same rate", () => {
    const FACE = 200_000;
    const RATE = 13.5;
    const p3 = discountPriceForSecurity({ isDiscount: true, isZeroCoupon: true, faceValue: FACE, ratePct: RATE, tenorYears: 3 });
    const p7 = discountPriceForSecurity({ isDiscount: true, isZeroCoupon: true, faceValue: FACE, ratePct: RATE, tenorYears: 7 });
    expect(p7).toBeLessThan(p3);
  });
});

describe("R46 — floating-rate paper added via Record Deposits is a par coupon bond", () => {
  it("is NOT a discount instrument (bought at par, return is the coupon)", () => {
    expect(isDiscountInstrument("floating_rate")).toBe(false);
  });

  it("discountPriceForSecurity returns face (par) for a non-discount instrument", () => {
    const FACE = 150_000;
    const price = discountPriceForSecurity({
      isDiscount: false,
      faceValue: FACE,
      ratePct: 12,
      tenorYears: tenorYearsForSecurity("floating_rate", 5),
    });
    expect(price).toBe(FACE);
  });
});
