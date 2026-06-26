import { describe, it, expect } from "vitest";
import {
  classifyDurationRisk,
  DEFAULT_LIQUIDITY_HORIZON_DAYS,
} from "../shared/discount";

// R53: the duration-risk classifier must respect a *configurable* liquidity
// horizon. The same weighted-average days-to-maturity should change risk level
// as the investor moves their horizon, matching the Rate Settings control.
describe("R53 configurable liquidity horizon", () => {
  it("defaults to a one-year horizon", () => {
    expect(DEFAULT_LIQUIDITY_HORIZON_DAYS).toBe(365);
  });

  it("classifies by ratio against the default horizon", () => {
    // ratio <= 0.6 => low, <= 1 => moderate, else elevated
    expect(classifyDurationRisk(180)).toBe("low"); // 180/365 = 0.49
    expect(classifyDurationRisk(300)).toBe("moderate"); // 0.82
    expect(classifyDurationRisk(400)).toBe("elevated"); // 1.1
  });

  it("re-classifies the SAME maturity when the horizon changes", () => {
    const wAvgDays = 300;
    // With a generous 3-year horizon, 300 days is low risk.
    expect(classifyDurationRisk(wAvgDays, 365 * 3)).toBe("low");
    // With a 1-year horizon it's moderate.
    expect(classifyDurationRisk(wAvgDays, 365)).toBe("moderate");
    // With a tight 90-day (cash-need) horizon it's elevated.
    expect(classifyDurationRisk(wAvgDays, 90)).toBe("elevated");
  });

  it("treats a shorter horizon as stricter at the boundary", () => {
    // 180 days is exactly the 0.6 boundary for a 300-day horizon => low
    expect(classifyDurationRisk(180, 300)).toBe("low");
    // but exceeds the horizon entirely at 150 days => elevated
    expect(classifyDurationRisk(180, 150)).toBe("elevated");
  });

  it("guards against non-positive inputs", () => {
    expect(classifyDurationRisk(0, 365)).toBe("low");
    expect(classifyDurationRisk(-10, 365)).toBe("low");
    expect(classifyDurationRisk(200, 0)).toBe("elevated");
    expect(classifyDurationRisk(NaN, 365)).toBe("low");
  });
});
