import { describe, it, expect } from "vitest";
import { computeSavingsLedSplit, SAVINGS_LED_THRESHOLD } from "../shared/decisionSurface";

describe("computeSavingsLedSplit (Part B2 — savings-led framing)", () => {
  it("attributes most of the ending value to principal when return is thin", () => {
    // KES 5.0M ending, KES 4.0M contributed → 1.0M return = 20% share.
    const s = computeSavingsLedSplit({
      projectedFinalValue: 5_000_000,
      totalContributions: 4_000_000,
    });
    expect(s.principalIn).toBe(4_000_000);
    expect(s.returnEarned).toBe(1_000_000);
    expect(s.returnShare).toBeCloseTo(0.2, 5);
    expect(s.principalShare).toBeCloseTo(0.8, 5);
    expect(s.isSavingsLed).toBe(true); // 20% < 35% threshold
  });

  it("includes a separate starting principal in principalIn (no double count when 0)", () => {
    const s = computeSavingsLedSplit({
      projectedFinalValue: 1_200_000,
      totalContributions: 900_000,
      startingPrincipal: 100_000,
    });
    expect(s.principalIn).toBe(1_000_000);
    expect(s.returnEarned).toBe(200_000);
    expect(s.returnShare).toBeCloseTo(200_000 / 1_200_000, 5);
  });

  it("flags non-savings-led when the return share clears the threshold", () => {
    // 50% of ending value is return → investment-led.
    const s = computeSavingsLedSplit({
      projectedFinalValue: 2_000_000,
      totalContributions: 1_000_000,
    });
    expect(s.returnShare).toBeCloseTo(0.5, 5);
    expect(s.isSavingsLed).toBe(false);
    expect(0.5).toBeGreaterThan(SAVINGS_LED_THRESHOLD);
  });

  it("never reports negative return and clamps shares when contributions exceed value", () => {
    const s = computeSavingsLedSplit({
      projectedFinalValue: 800_000,
      totalContributions: 1_000_000, // paid in more than current value
    });
    expect(s.returnEarned).toBe(0);
    expect(s.returnShare).toBe(0);
    expect(s.principalShare).toBe(1); // clamped to 1
    expect(s.isSavingsLed).toBe(true);
  });

  it("is safe when the projected value is zero", () => {
    const s = computeSavingsLedSplit({ projectedFinalValue: 0, totalContributions: 0 });
    expect(s.returnShare).toBe(0);
    expect(s.principalShare).toBe(0);
    expect(s.returnEarned).toBe(0);
  });

  it("respects a custom savings-led threshold", () => {
    const s = computeSavingsLedSplit({
      projectedFinalValue: 1_000_000,
      totalContributions: 700_000, // 30% return share
      savingsLedThreshold: 0.25,
    });
    expect(s.returnShare).toBeCloseTo(0.3, 5);
    expect(s.isSavingsLed).toBe(false); // 30% >= custom 25% threshold
  });
});
