import { describe, it, expect } from "vitest";
import {
  largestConcentration,
  concentrationTypeLabel,
  type CurrentValueSecurity,
} from "../shared/discount";

// A fixed "today" so accreted/coupon values are deterministic.
const TODAY = new Date("2026-06-26T00:00:00Z");

function tbill(face: number, tenor: "91" | "182" | "364" = "364"): CurrentValueSecurity {
  return {
    securityType: `tbill_${tenor}`,
    faceValue: face,
    purchasePrice: face, // par → current value === face, keeps math simple
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

describe("largestConcentration (R57)", () => {
  it("returns null when there are no lots", () => {
    expect(largestConcentration([], TODAY)).toBeNull();
  });

  it("returns null when all lots are worthless or matured", () => {
    const lots: CurrentValueSecurity[] = [
      { ...tbill(0) },
      { ...bond("fxd", 100_000), isMatured: true },
    ];
    expect(largestConcentration(lots, TODAY)).toBeNull();
  });

  it("reports 100% when only one type is held", () => {
    const res = largestConcentration([tbill(500_000), tbill(500_000)], TODAY);
    expect(res).not.toBeNull();
    expect(res!.topType).toBe("tbill");
    expect(res!.topLabel).toBe("T-Bills");
    expect(res!.topShare).toBeCloseTo(1, 6);
    expect(res!.typeCount).toBe(1);
    expect(res!.totalValue).toBeCloseTo(1_000_000, 2);
  });

  it("groups T-bill tenor variants into one class", () => {
    const lots = [tbill(300_000, "91"), tbill(300_000, "182"), tbill(400_000, "364")];
    const res = largestConcentration(lots, TODAY);
    expect(res!.topType).toBe("tbill");
    expect(res!.typeCount).toBe(1);
    expect(res!.topShare).toBeCloseTo(1, 6);
  });

  it("identifies the dominant type across mixed instruments", () => {
    // 700k FXD vs 300k T-bills → FXD dominates at 70%.
    const lots = [bond("fxd", 700_000), tbill(300_000)];
    const res = largestConcentration(lots, TODAY);
    expect(res!.topType).toBe("fxd");
    expect(res!.topLabel).toBe("FXD bonds");
    expect(res!.topShare).toBeCloseTo(0.7, 4);
    expect(res!.typeCount).toBe(2);
    expect(res!.totalValue).toBeCloseTo(1_000_000, 2);
  });

  it("counts distinct types and picks the largest among three", () => {
    const lots = [bond("ifb", 200_000), bond("fxd", 350_000), tbill(450_000)];
    const res = largestConcentration(lots, TODAY);
    expect(res!.typeCount).toBe(3);
    expect(res!.topType).toBe("tbill");
    expect(res!.topShare).toBeCloseTo(0.45, 4);
  });

  it("ignores matured lots in the totals", () => {
    const lots: CurrentValueSecurity[] = [
      bond("fxd", 600_000),
      { ...tbill(400_000), isMatured: true }, // excluded
    ];
    const res = largestConcentration(lots, TODAY);
    expect(res!.topType).toBe("fxd");
    expect(res!.topShare).toBeCloseTo(1, 6);
    expect(res!.typeCount).toBe(1);
    expect(res!.totalValue).toBeCloseTo(600_000, 2);
  });
});

describe("concentrationTypeLabel (R57)", () => {
  it("maps known types to friendly labels", () => {
    expect(concentrationTypeLabel("tbill_91")).toBe("T-Bills");
    expect(concentrationTypeLabel("tbill")).toBe("T-Bills");
    expect(concentrationTypeLabel("ifb")).toBe("IFB bonds");
    expect(concentrationTypeLabel("fxd")).toBe("FXD bonds");
    expect(concentrationTypeLabel("zero_coupon")).toBe("Zero-coupon");
    expect(concentrationTypeLabel("floating_rate")).toBe("Floating-rate");
  });

  it("falls back to a de-underscored label for unknown types", () => {
    expect(concentrationTypeLabel("some_new_type")).toBe("some new type");
  });
});
