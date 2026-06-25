import { describe, it, expect } from "vitest";
import { isSecurityImmatureOn } from "../shared/securityTenor";

describe("R40.5 — immature government-security check", () => {
  it("flags a security maturing AFTER the withdrawal date as immature", () => {
    const r = isSecurityImmatureOn("2026-12-31", "2026-06-25");
    expect(r.isImmature).toBe(true);
    expect(r.daysToMaturity).toBeGreaterThan(0);
  });

  it("does NOT flag a security maturing ON the withdrawal date", () => {
    const r = isSecurityImmatureOn("2026-06-25", "2026-06-25");
    expect(r.isImmature).toBe(false);
    expect(r.daysToMaturity).toBe(0);
  });

  it("does NOT flag a security that already matured before the withdrawal date", () => {
    const r = isSecurityImmatureOn("2026-01-01", "2026-06-25");
    expect(r.isImmature).toBe(false);
    expect(r.daysToMaturity).toBeLessThan(0);
  });

  it("computes the correct whole-day count to maturity (timezone-safe)", () => {
    // 2026-06-25 -> 2026-07-25 is exactly 30 days.
    const r = isSecurityImmatureOn("2026-07-25", "2026-06-25");
    expect(r.daysToMaturity).toBe(30);
    expect(r.isImmature).toBe(true);
  });

  it("returns a safe non-immature default when dates are missing", () => {
    expect(isSecurityImmatureOn(null, "2026-06-25")).toEqual({ isImmature: false, daysToMaturity: 0 });
    expect(isSecurityImmatureOn("2026-12-31", null)).toEqual({ isImmature: false, daysToMaturity: 0 });
    expect(isSecurityImmatureOn(undefined, undefined)).toEqual({ isImmature: false, daysToMaturity: 0 });
  });

  it("accepts Date objects as well as YYYY-MM-DD strings", () => {
    const r = isSecurityImmatureOn(new Date("2026-09-01T00:00:00Z"), new Date("2026-06-25T00:00:00Z"));
    expect(r.isImmature).toBe(true);
  });
});
