import { describe, it, expect } from "vitest";
import {
  tbillPrice,
  zeroCouponPrice,
  grossDiscount,
  whtOnDiscount,
  maturityProceeds,
  netDiscountGain,
  accretedValue,
  DISCOUNT_WHT_PCT,
} from "../shared/discount";

// ─────────────────────────────────────────────────────────────────────────────
// R42 — Discount-instrument mechanics. The user's pasted worked examples are the
// acceptance tests. T-bills and zero-coupon bonds are bought below face; the
// discount is the return; WHT applies to the discount only.
// ─────────────────────────────────────────────────────────────────────────────

describe("R42 — Wanjiku's 91-day T-bill (CBK worked example)", () => {
  const FACE = 100_000;
  const RATE = 15; // %
  const DAYS = 91;

  it("prices at ~96,400 (simple-interest discount)", () => {
    const price = tbillPrice(FACE, RATE, DAYS);
    expect(price).toBeCloseTo(96_395.06, 0); // 100000 / (1 + 0.15*91/365)
    expect(Math.round(price / 100) * 100).toBe(96_400); // rounds to 96,400
  });

  it("gross discount is ~3,605", () => {
    const price = tbillPrice(FACE, RATE, DAYS);
    expect(grossDiscount(FACE, price)).toBeCloseTo(3_604.94, 0);
  });

  it("WHT (15%) applies to the discount only, ~540", () => {
    const price = tbillPrice(FACE, RATE, DAYS);
    const wht = whtOnDiscount(FACE, price, DISCOUNT_WHT_PCT);
    expect(wht).toBeCloseTo(540.74, 0); // 0.15 * 3604.94
    // WHT base is the discount, NOT face*rate*t
    expect(wht).not.toBeCloseTo(FACE * (RATE / 100) * (DAYS / 365) * 0.15, 0);
  });

  it("maturity credits face − WHT on discount ≈ 99,460", () => {
    const price = tbillPrice(FACE, RATE, DAYS);
    const proceeds = maturityProceeds(FACE, price, DISCOUNT_WHT_PCT);
    expect(Math.round(proceeds)).toBe(99_459); // 100000 - 540.74
    // Using the rounded 96,400 price the spec quotes, proceeds ≈ 99,460:
    const proceedsRounded = maturityProceeds(FACE, 96_400, DISCOUNT_WHT_PCT);
    expect(Math.round(proceedsRounded)).toBe(99_460); // 100000 - 0.15*3600
  });

  it("net gain ≈ 3,065 after tax (spec figure)", () => {
    const netRounded = netDiscountGain(FACE, 96_400, DISCOUNT_WHT_PCT);
    expect(Math.round(netRounded)).toBe(3_060); // 3600 - 540
    // With the exact price it is ~3,064:
    const price = tbillPrice(FACE, RATE, DAYS);
    expect(Math.round(netDiscountGain(FACE, price, DISCOUNT_WHT_PCT))).toBe(3_064);
  });
});

describe("R42 — accretion never starts at face nor exceeds it", () => {
  const FACE = 100_000;
  const PRICE = 96_400;

  it("starts at purchase price (fraction 0)", () => {
    expect(accretedValue(FACE, PRICE, 0)).toBe(PRICE);
  });

  it("ends at face (fraction 1)", () => {
    expect(accretedValue(FACE, PRICE, 1)).toBe(FACE);
  });

  it("is between price and face midway, never above face", () => {
    const mid = accretedValue(FACE, PRICE, 0.5);
    expect(mid).toBeGreaterThan(PRICE);
    expect(mid).toBeLessThan(FACE);
    expect(mid).toBeCloseTo(98_200, 0); // 96400 + 3600*0.5
  });

  it("clamps to face even if fraction overshoots", () => {
    expect(accretedValue(FACE, PRICE, 1.5)).toBe(FACE);
  });
});

describe("R42 — Amina's 5-year zero-coupon bond", () => {
  const FACE = 100_000;
  const YEARS = 5;

  it("prices below face using compounding", () => {
    // At ~11.84% the price is ~57,000 (spec's illustrative figure).
    const price = zeroCouponPrice(FACE, 11.84, YEARS);
    expect(Math.round(price / 1000) * 1000).toBe(57_000);
  });

  it("discount is the full return; WHT on the discount only", () => {
    const price = zeroCouponPrice(FACE, 11.84, YEARS);
    const disc = grossDiscount(FACE, price);
    expect(disc).toBeGreaterThan(40_000);
    const wht = whtOnDiscount(FACE, price, DISCOUNT_WHT_PCT);
    expect(wht).toBeCloseTo(disc * 0.15, 4);
    expect(maturityProceeds(FACE, price)).toBeCloseTo(FACE - wht, 4);
  });
});

describe("R42 — zero-rate / zero-tenor degrade to par (no discount)", () => {
  it("price equals face when rate is 0", () => {
    expect(tbillPrice(100_000, 0, 91)).toBe(100_000);
    expect(zeroCouponPrice(100_000, 0, 5)).toBe(100_000);
  });
  it("no discount → no WHT", () => {
    expect(whtOnDiscount(100_000, 100_000)).toBe(0);
    expect(maturityProceeds(100_000, 100_000)).toBe(100_000);
  });
});
