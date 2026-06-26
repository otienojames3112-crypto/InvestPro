import { describe, it, expect } from "vitest";
import {
  classifyDurationRisk,
  DEFAULT_LIQUIDITY_HORIZON_DAYS,
} from "../shared/discount";

// ─────────────────────────────────────────────────────────────────────────────
// R52 — the Dashboard "Avg. Maturity" tile colour-codes a duration-risk hint by
// comparing the value-weighted average days-to-maturity against a liquidity
// horizon (default one year):
//   - low:      weighted DTM <= 60% of horizon
//   - moderate: weighted DTM <= 100% of horizon
//   - elevated: weighted DTM  > horizon
// These tests lock the boundaries so the tile classification can't drift.
// ─────────────────────────────────────────────────────────────────────────────

describe("R52 — duration-risk classification", () => {
  it("defaults the liquidity horizon to one year", () => {
    expect(DEFAULT_LIQUIDITY_HORIZON_DAYS).toBe(365);
  });

  it("classifies a short book as low risk", () => {
    expect(classifyDurationRisk(90)).toBe("low");
    expect(classifyDurationRisk(200)).toBe("low"); // 200/365 ≈ 0.55 ≤ 0.6
  });

  it("classifies a mid-horizon book as moderate", () => {
    expect(classifyDurationRisk(250)).toBe("moderate"); // ≈0.68
    expect(classifyDurationRisk(365)).toBe("moderate"); // exactly the horizon
  });

  it("classifies a book beyond the horizon as elevated", () => {
    expect(classifyDurationRisk(400)).toBe("elevated");
    expect(classifyDurationRisk(1200)).toBe("elevated");
  });

  it("honours a custom horizon", () => {
    // With a 90-day horizon, 60 days is low, 80 is moderate, 120 is elevated.
    expect(classifyDurationRisk(50, 90)).toBe("low"); // 0.55
    expect(classifyDurationRisk(80, 90)).toBe("moderate"); // 0.89
    expect(classifyDurationRisk(120, 90)).toBe("elevated"); // 1.33
  });

  it("treats an empty / zero-day book as low risk", () => {
    expect(classifyDurationRisk(0)).toBe("low");
    expect(classifyDurationRisk(-5)).toBe("low");
    expect(classifyDurationRisk(NaN)).toBe("low");
  });

  it("respects the exact 0.6 boundary (low) and just above (moderate)", () => {
    expect(classifyDurationRisk(219, 365)).toBe("low"); // 0.6
    expect(classifyDurationRisk(220, 365)).toBe("moderate"); // 0.603
  });
});
