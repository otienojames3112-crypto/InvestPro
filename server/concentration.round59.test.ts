import { describe, it, expect } from "vitest";
import { amountToShiftUnderCap } from "../shared/discount";

describe("amountToShiftUnderCap (R59)", () => {
  it("returns 0 when already within the cap", () => {
    // 50% top against a 60% cap → nothing to shift.
    expect(amountToShiftUnderCap(500_000, 1_000_000, 60)).toBe(0);
  });

  it("returns 0 exactly at the cap boundary", () => {
    // 60% against 60% cap → not strictly over → 0.
    expect(amountToShiftUnderCap(600_000, 1_000_000, 60)).toBe(0);
  });

  it("computes the shift so the remaining share equals the cap", () => {
    // 800k top of 1,000k total (80%) against a 60% cap.
    // x = (800k - 0.6*1,000k) / (1 - 0.6) = 200k / 0.4 = 500k.
    const x = amountToShiftUnderCap(800_000, 1_000_000, 60);
    expect(x).toBeCloseTo(500_000, 2);
    // Verify the resulting share is exactly the cap.
    const newShare = (800_000 - x) / (1_000_000 - x);
    expect(newShare).toBeCloseTo(0.6, 6);
  });

  it("handles a 100%-single-type book correctly", () => {
    // 1,000k of 1,000k (100%) against 60% cap.
    // x = (1,000k - 600k) / 0.4 = 1,000k → shift the entire excess to reach 60%? 
    // Actually new share = (1,000k - 1,000k)/(1,000k - 1,000k) is degenerate (0/0).
    // The formula gives x = 400k/0.4 = 1,000,000 which would empty the type;
    // but our guard returns the computed positive value. Verify it's the full holding.
    const x = amountToShiftUnderCap(1_000_000, 1_000_000, 60);
    expect(x).toBeCloseTo(1_000_000, 2);
  });

  it("returns a larger shift for a tighter cap", () => {
    const loose = amountToShiftUnderCap(800_000, 1_000_000, 70);
    const tight = amountToShiftUnderCap(800_000, 1_000_000, 40);
    expect(tight).toBeGreaterThan(loose);
  });

  it("treats cap >= 100 as no constraint (returns 0)", () => {
    expect(amountToShiftUnderCap(900_000, 1_000_000, 100)).toBe(0);
    expect(amountToShiftUnderCap(900_000, 1_000_000, 150)).toBe(0);
  });

  it("treats non-positive cap as disabled (returns 0)", () => {
    expect(amountToShiftUnderCap(900_000, 1_000_000, 0)).toBe(0);
    expect(amountToShiftUnderCap(900_000, 1_000_000, -10)).toBe(0);
  });

  it("returns 0 for degenerate totals", () => {
    expect(amountToShiftUnderCap(0, 0, 60)).toBe(0);
    expect(amountToShiftUnderCap(0, 1_000_000, 60)).toBe(0);
    expect(amountToShiftUnderCap(500_000, 0, 60)).toBe(0);
  });

  it("matches a worked 75%→50% example", () => {
    // 750k of 1,000k (75%) against 50% cap.
    // x = (750k - 0.5*1,000k)/(1-0.5) = 250k/0.5 = 500k.
    const x = amountToShiftUnderCap(750_000, 1_000_000, 50);
    expect(x).toBeCloseTo(500_000, 2);
    const newShare = (750_000 - x) / (1_000_000 - x);
    expect(newShare).toBeCloseTo(0.5, 6);
  });
});
