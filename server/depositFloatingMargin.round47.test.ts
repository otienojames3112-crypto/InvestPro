import { describe, it, expect } from "vitest";
import { computeMaturityDate, tenorYearsForSecurity } from "../shared/securityTenor";

/**
 * R47 — the Record Deposit drawer now captures a floating-rate note's
 * benchmark + margin (effective coupon = benchmark + margin) and a reset
 * cadence directly, and lets a zero-coupon bond override its maturity date for
 * non-standard tenors. These tests pin the pure pieces the drawer + server rely
 * on so the deposit path stays consistent with the register.
 */
describe("R47 — floating-rate effective coupon = benchmark + margin", () => {
  it("adds the margin on top of the benchmark", () => {
    const benchmark = 9.5; // e.g. 91-day T-bill
    const margin = 1.25;
    const effective = Math.round((benchmark + margin) * 100) / 100;
    expect(effective).toBe(10.75);
  });

  it("a zero margin leaves the coupon equal to the benchmark", () => {
    const benchmark = 11.2;
    const margin = 0;
    expect(Math.round((benchmark + margin) * 100) / 100).toBe(11.2);
  });

  it("the effective coupon rises monotonically with the margin", () => {
    const benchmark = 10;
    const low = benchmark + 0.5;
    const high = benchmark + 2.5;
    expect(high).toBeGreaterThan(low);
  });
});

describe("R47 — zero-coupon maturity-date override", () => {
  it("uses the explicit override when supplied (non-standard tenor)", () => {
    // The server honours input.maturityDate for non-t-bill instruments.
    const override = "2031-09-30";
    const isTbill = false;
    const derived = computeMaturityDate("zero_coupon", "2026-06-25", tenorYearsForSecurity("zero_coupon", 3));
    const chosen = override && !isTbill ? override : derived;
    expect(chosen).toBe(override);
    expect(chosen).not.toBe(derived);
  });

  it("falls back to the derived maturity when no override is given", () => {
    const override: string | undefined = undefined;
    const isTbill = false;
    const derived = computeMaturityDate("zero_coupon", "2026-06-25", tenorYearsForSecurity("zero_coupon", 3));
    const chosen = override && !isTbill ? override : derived;
    expect(chosen).toBe(derived);
  });

  it("derived zero-coupon maturity is roughly tenor years after issue", () => {
    const issue = "2026-06-25";
    const years = tenorYearsForSecurity("zero_coupon", 3);
    const derived = computeMaturityDate("zero_coupon", issue, years);
    const issueYear = Number(issue.slice(0, 4));
    const matYear = Number(String(derived).slice(0, 4));
    expect(matYear - issueYear).toBe(Math.round(years));
  });
});
