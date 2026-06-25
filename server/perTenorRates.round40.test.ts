import { describe, it, expect } from "vitest";
import {
  tenorRateFromMap,
  defaultRateForSecurity,
  type RateSettingsLike,
} from "../shared/securityTenor";

/**
 * Round 40 #3 — per-tenor IFB/FXD rates. A rate map keyed by tenor-years wins
 * over the flat coupon; missing keys fall back to the flat coupon so existing
 * portfolios are unaffected.
 */

const RATES: RateSettingsLike = {
  tbill91Rate: 8.82,
  tbill182Rate: 8.78,
  tbill364Rate: 8.97,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  ifbTenorRates: { "8.5": 14.2, "17": 15.8 },
  fxdTenorRates: { "2": 11.9, "10": 13.4, "25": 16.1 },
};

describe("Round 40 #3 — tenorRateFromMap", () => {
  it("returns the exact-key rate", () => {
    expect(tenorRateFromMap(RATES.ifbTenorRates, 8.5)).toBe(14.2);
    expect(tenorRateFromMap(RATES.fxdTenorRates, 10)).toBe(13.4);
  });

  it("snaps to the closest key within 0.25y", () => {
    expect(tenorRateFromMap(RATES.ifbTenorRates, 8.6)).toBe(14.2);
    expect(tenorRateFromMap(RATES.fxdTenorRates, 9.8)).toBe(13.4);
  });

  it("returns null when no key is close (caller falls back to flat)", () => {
    expect(tenorRateFromMap(RATES.ifbTenorRates, 11)).toBeNull();
    expect(tenorRateFromMap(RATES.fxdTenorRates, 5)).toBeNull();
  });

  it("returns null for missing map or invalid tenor", () => {
    expect(tenorRateFromMap(null, 8.5)).toBeNull();
    expect(tenorRateFromMap(RATES.ifbTenorRates, 0)).toBeNull();
    expect(tenorRateFromMap(RATES.ifbTenorRates, null)).toBeNull();
  });
});

describe("Round 40 #3 — defaultRateForSecurity uses tenor map then flat fallback", () => {
  it("IFB at a mapped tenor uses the map", () => {
    expect(defaultRateForSecurity("ifb", RATES, 8.5)).toBe(14.2);
    expect(defaultRateForSecurity("ifb", RATES, 17)).toBe(15.8);
  });

  it("IFB at an unmapped tenor falls back to flat coupon", () => {
    expect(defaultRateForSecurity("ifb", RATES, 11)).toBe(12.5);
    // No tenor supplied → flat coupon.
    expect(defaultRateForSecurity("ifb", RATES)).toBe(12.5);
  });

  it("FXD at a mapped tenor uses the map", () => {
    expect(defaultRateForSecurity("fxd", RATES, 10)).toBe(13.4);
    expect(defaultRateForSecurity("fxd", RATES, 25)).toBe(16.1);
  });

  it("FXD at an unmapped tenor falls back to flat coupon", () => {
    expect(defaultRateForSecurity("fxd", RATES, 15)).toBe(12.35);
  });

  it("T-bills ignore tenor maps and use their tenor discount rate", () => {
    expect(defaultRateForSecurity("tbill_91", RATES)).toBe(8.82);
    expect(defaultRateForSecurity("tbill_364", RATES)).toBe(8.97);
  });

  it("portfolios with no tenor maps behave exactly as before", () => {
    const flat: RateSettingsLike = {
      ifbCouponRate: 12.5,
      fxdCouponRate: 12.35,
    };
    expect(defaultRateForSecurity("ifb", flat, 8.5)).toBe(12.5);
    expect(defaultRateForSecurity("fxd", flat, 10)).toBe(12.35);
  });
});
