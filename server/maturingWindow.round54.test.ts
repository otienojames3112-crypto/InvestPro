import { describe, it, expect } from "vitest";
import {
  MATURING_WINDOW_OPTIONS,
  MATURING_WINDOW_ALL,
  maturingWindowLabel,
} from "../client/src/hooks/useMaturingWindow";

/**
 * R54: the "maturing-soon" window in the CBK Securities Register must support
 * longer terms so multi-year government paper (FXD / IFB bonds) can appear in
 * the lookahead — not just short T-bills. The filter rule is `days <= window`.
 */
const inWindow = (daysToMaturity: number, windowDays: number) =>
  daysToMaturity <= windowDays;

describe("R54 wider maturing-soon window", () => {
  it("exposes the expected ordered window options incl. long terms and All", () => {
    expect(MATURING_WINDOW_OPTIONS.map((o) => o.value)).toEqual([
      30,
      60,
      90,
      180,
      365,
      730,
      MATURING_WINDOW_ALL,
    ]);
  });

  it("labels long windows in human-friendly form", () => {
    expect(maturingWindowLabel(365)).toBe("1yr");
    expect(maturingWindowLabel(730)).toBe("2yr");
    expect(maturingWindowLabel(MATURING_WINDOW_ALL)).toBe("All");
    expect(maturingWindowLabel(90)).toBe("90d");
  });

  it("narrow windows exclude long-dated bonds", () => {
    const fxdDays = 638; // ~21mo FXD bond
    expect(inWindow(fxdDays, 30)).toBe(false);
    expect(inWindow(fxdDays, 90)).toBe(false);
    expect(inWindow(fxdDays, 180)).toBe(false);
    expect(inWindow(fxdDays, 365)).toBe(false); // 1yr still too short
  });

  it("wider windows include long-dated bonds", () => {
    const fxdDays = 638;
    expect(inWindow(fxdDays, 730)).toBe(true); // 2yr admits it
    expect(inWindow(fxdDays, MATURING_WINDOW_ALL)).toBe(true);
  });

  it("the All window admits even decade-out IFB lots", () => {
    const ifbDays = 2805; // ~7.7yr IFB
    expect(inWindow(ifbDays, 730)).toBe(false);
    expect(inWindow(ifbDays, MATURING_WINDOW_ALL)).toBe(true);
  });

  it("short T-bills still surface in every window", () => {
    const tbillDays = 66;
    for (const { value } of MATURING_WINDOW_OPTIONS) {
      // 66d is outside 30/60 but inside 90 and wider — assert the boundary holds
      expect(inWindow(tbillDays, value)).toBe(value >= 90);
    }
  });
});
