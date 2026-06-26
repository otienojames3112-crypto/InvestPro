import { describe, it, expect } from "vitest";
import {
  largestConcentration,
  classifyConcentration,
  type CurrentValueSecurity,
} from "../shared/discount";

// A fixed "today" so accreted/coupon values are deterministic.
const TODAY = new Date("2026-06-26T00:00:00Z");

function tbill(face: number, tenor: "91" | "182" | "364" = "364"): CurrentValueSecurity {
  return {
    securityType: `tbill_${tenor}`,
    faceValue: face,
    purchasePrice: face, // par → current value === face
    issueDate: "2026-01-01",
    maturityDate: "2027-06-26",
    isMatured: false,
  };
}

function bond(type: "ifb" | "fxd", face: number): CurrentValueSecurity {
  return {
    securityType: type,
    faceValue: face,
    purchasePrice: face,
    couponRate: 0, // no accrued coupon so current value === face
    issueDate: "2026-06-26",
    maturityDate: "2031-06-26",
    isMatured: false,
  };
}

describe("largestConcentration breakdown (R58)", () => {
  it("returns an empty-safe null when there are no lots", () => {
    expect(largestConcentration([], TODAY)).toBeNull();
  });

  it("produces a per-type breakdown sorted by value descending", () => {
    const lots = [bond("fxd", 700_000), tbill(200_000), bond("ifb", 100_000)];
    const res = largestConcentration(lots, TODAY);
    expect(res).not.toBeNull();
    expect(res!.breakdown.map((b) => b.type)).toEqual(["fxd", "tbill", "ifb"]);
    expect(res!.breakdown.map((b) => b.label)).toEqual(["FXD bonds", "T-Bills", "IFB bonds"]);
  });

  it("breakdown shares sum to 1 and match the values", () => {
    const lots = [bond("fxd", 700_000), tbill(200_000), bond("ifb", 100_000)];
    const res = largestConcentration(lots, TODAY)!;
    const sum = res.breakdown.reduce((acc, s) => acc + s.share, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(res.breakdown[0].share).toBeCloseTo(0.7, 4);
    expect(res.breakdown[1].share).toBeCloseTo(0.2, 4);
    expect(res.breakdown[2].share).toBeCloseTo(0.1, 4);
    expect(res.breakdown[0].value).toBeCloseTo(700_000, 2);
  });

  it("groups T-bill tenor variants into one breakdown slice", () => {
    const lots = [tbill(300_000, "91"), tbill(300_000, "182"), tbill(400_000, "364")];
    const res = largestConcentration(lots, TODAY)!;
    expect(res.breakdown).toHaveLength(1);
    expect(res.breakdown[0].type).toBe("tbill");
    expect(res.breakdown[0].share).toBeCloseTo(1, 6);
  });

  it("single-instrument book yields a one-slice breakdown", () => {
    const res = largestConcentration([bond("fxd", 500_000)], TODAY)!;
    expect(res.breakdown).toHaveLength(1);
    expect(res.breakdown[0].type).toBe("fxd");
    expect(res.breakdown[0].share).toBeCloseTo(1, 6);
  });
});

describe("classifyConcentration (R58)", () => {
  it("flags a breach when the top share strictly exceeds the cap", () => {
    // 71% > 60% cap → breached
    expect(classifyConcentration(0.71, 60)).toBe("breached");
  });

  it("is ok when the top share equals the cap (boundary, not strict)", () => {
    expect(classifyConcentration(0.6, 60)).toBe("ok");
  });

  it("is ok when the top share is below the cap", () => {
    expect(classifyConcentration(0.45, 60)).toBe("ok");
  });

  it("treats a non-positive cap as always ok (feature disabled)", () => {
    expect(classifyConcentration(0.99, 0)).toBe("ok");
    expect(classifyConcentration(0.99, -5)).toBe("ok");
  });

  it("handles a 100% single-instrument book against a default cap", () => {
    expect(classifyConcentration(1, 60)).toBe("breached");
    expect(classifyConcentration(1, 100)).toBe("ok");
  });
});
