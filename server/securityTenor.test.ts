import { describe, it, expect } from "vitest";
import {
  whtRateForSecurity,
  computeMaturityDate,
  defaultRateForSecurity,
  inferBondTenorYears,
  tenorYearsForSecurity,
  TBILL_TENOR_DAYS,
} from "../shared/securityTenor";

describe("whtRateForSecurity", () => {
  it("IFB is tax-exempt", () => {
    expect(whtRateForSecurity("ifb")).toBe(0);
    expect(whtRateForSecurity("ifb", 19)).toBe(0);
  });
  it("T-bills are always 15%", () => {
    expect(whtRateForSecurity("tbill_91")).toBe(15);
    expect(whtRateForSecurity("tbill_182")).toBe(15);
    expect(whtRateForSecurity("tbill_364")).toBe(15);
  });
  it("FXD is 15% under 10y and 10% at/over 10y", () => {
    expect(whtRateForSecurity("fxd", 2)).toBe(15);
    expect(whtRateForSecurity("fxd", 9.99)).toBe(15);
    expect(whtRateForSecurity("fxd", 10)).toBe(10);
    expect(whtRateForSecurity("fxd", 25)).toBe(10);
  });
  it("FXD defaults to the 10y tier when tenor omitted", () => {
    expect(whtRateForSecurity("fxd")).toBe(10);
  });
});

describe("computeMaturityDate", () => {
  it("adds the fixed day count for T-bills", () => {
    expect(computeMaturityDate("tbill_91", "2026-01-01")).toBe("2026-04-02"); // +91d
    expect(computeMaturityDate("tbill_182", "2026-01-01")).toBe("2026-07-02"); // +182d
    expect(computeMaturityDate("tbill_364", "2026-01-01")).toBe("2026-12-31"); // +364d
  });
  it("adds whole years for bonds", () => {
    expect(computeMaturityDate("fxd", "2026-06-25", 10)).toBe("2036-06-25");
    expect(computeMaturityDate("ifb", "2026-06-25", 7)).toBe("2033-06-25");
  });
  it("handles fractional bond tenors as days", () => {
    // 8.5y => +8y +182d
    const m = computeMaturityDate("ifb", "2026-01-01", 8.5);
    expect(m.startsWith("2034-07")).toBe(true);
  });
  it("returns empty string for invalid issue date", () => {
    expect(computeMaturityDate("tbill_91", "not-a-date")).toBe("");
  });
});

describe("defaultRateForSecurity", () => {
  const rates = {
    tbill91Rate: "8.8206",
    tbill182Rate: "8.7782",
    tbill364Rate: "8.9746",
    ifbCouponRate: "12.5000",
    fxdCouponRate: "12.3500",
  };
  it("maps each type to the right rate column", () => {
    expect(defaultRateForSecurity("tbill_91", rates)).toBeCloseTo(8.8206);
    expect(defaultRateForSecurity("tbill_182", rates)).toBeCloseTo(8.7782);
    expect(defaultRateForSecurity("tbill_364", rates)).toBeCloseTo(8.9746);
    expect(defaultRateForSecurity("ifb", rates)).toBeCloseTo(12.5);
    expect(defaultRateForSecurity("fxd", rates)).toBeCloseTo(12.35);
  });
  it("returns 0 when settings missing", () => {
    expect(defaultRateForSecurity("fxd", null)).toBe(0);
  });
});

describe("inferBondTenorYears", () => {
  it("snaps a near-8.5y span to 8.5", () => {
    expect(inferBondTenorYears("ifb", "2026-01-01", "2034-07-01")).toBe(8.5);
  });
  it("returns null for t-bills", () => {
    expect(inferBondTenorYears("tbill_91", "2026-01-01", "2026-04-02")).toBeNull();
  });
});

describe("tenorYearsForSecurity", () => {
  it("computes t-bill tenor as days/365", () => {
    expect(tenorYearsForSecurity("tbill_91")).toBeCloseTo(TBILL_TENOR_DAYS.tbill_91 / 365);
  });
  it("returns bond tenor as supplied", () => {
    expect(tenorYearsForSecurity("fxd", 15)).toBe(15);
  });
});
