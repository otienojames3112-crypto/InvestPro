/**
 * Stage 3 — CBK Securities sub-type tightening (PURE, framework-free).
 *
 * `checkApprovalGate`'s baseline CBK rules (security type, tenor, a rate, WHT
 * rule, tax-exempt flag, maturity rule, source, as-of) apply to every CBK
 * security. This suite locks the ADDITIONAL, sub-type-specific requirements
 * layered on top: a Treasury bill needs its auction + value date; an FXD or
 * infrastructure bond needs its issue number, coupon rate, and maturity date;
 * and an infrastructure bond's tax-exempt flag must be TRUE, not merely present.
 *
 * An undetected sub-type ("unknown") adds NOTHING — behaviour for anything the
 * detector can't classify is identical to before this change.
 */
import { describe, expect, it } from "vitest";
import { checkApprovalGate, detectCbkSubtype } from "../shared/researchPipeline";

const baseArgs = {
  assetClass: "gov_coupon" as const,
  changeKind: "create" as const,
  source: "CBK",
  asOf: Date.now(),
};

describe("Stage 3 · detectCbkSubtype", () => {
  it("detects a T-bill from tenorDays alone", () => {
    expect(detectCbkSubtype({ tenorDays: 91 })).toBe("tbill");
    expect(detectCbkSubtype({ tenorDays: "182" })).toBe("tbill");
    expect(detectCbkSubtype({ tenorDays: 364 })).toBe("tbill");
  });

  it("tolerates BOTH securityType vocabularies (structured-extraction vs rule-fill)", () => {
    expect(detectCbkSubtype({ securityType: "ifb" })).toBe("ifb");
    expect(detectCbkSubtype({ securityType: "infrastructure_bond" })).toBe("ifb");
    expect(detectCbkSubtype({ securityType: "fxd" })).toBe("fxd");
    expect(detectCbkSubtype({ securityType: "treasury_bond" })).toBe("fxd");
    expect(detectCbkSubtype({ securityType: "treasury_bill" })).toBe("tbill");
    expect(detectCbkSubtype({ securityType: "zero_coupon" })).toBe("tbill");
  });

  it("falls back to the instrument name when figures carry no signal", () => {
    expect(detectCbkSubtype({}, "IFB1/2024/8.5")).toBe("ifb");
    expect(detectCbkSubtype({}, "FXD1/2024/10")).toBe("fxd");
    expect(detectCbkSubtype({}, "91-Day Treasury Bill")).toBe("tbill");
  });

  it("returns null when nothing is confidently detected", () => {
    expect(detectCbkSubtype({})).toBeNull();
    expect(detectCbkSubtype({ someField: "x" }, "Unnamed Security")).toBeNull();
  });
});

describe("Stage 3 · T-bill requires its own auction + value date", () => {
  const tbillFigures = {
    tenorDays: 91,
    securityType: "treasury_bill",
    tenor: "91-day",
    yieldPct: "15.98",
    whtRule: "15% withholding tax on the discount",
    taxExempt: "false",
    maturityRule: "value date + 91 days",
  };

  it("blocks a T-bill missing auctionDate/valueDate even with everything else present", () => {
    const gate = checkApprovalGate({ ...baseArgs, name: "91-Day Treasury Bill", figures: tbillFigures });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toEqual(["auction date", "value / settlement date"]);
    expect(gate.cbkSubtype).toBe("tbill");
  });

  it("clears once auctionDate + valueDate are supplied", () => {
    const gate = checkApprovalGate({
      ...baseArgs,
      name: "91-Day Treasury Bill",
      figures: { ...tbillFigures, auctionDate: "2026-06-18", valueDate: "2026-06-20" },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("tolerates the settlementDate alias for valueDate", () => {
    const gate = checkApprovalGate({
      ...baseArgs,
      name: "91-Day Treasury Bill",
      figures: { ...tbillFigures, auctionDate: "2026-06-18", settlementDate: "2026-06-20" },
    });
    expect(gate.ok).toBe(true);
  });
});

describe("Stage 3 · FXD requires issue number, coupon rate, and maturity date", () => {
  const fxdFigures = {
    securityType: "fxd",
    tenor: "10y",
    yieldPct: "14",
    whtRule: "15% withholding tax on coupon (10% for bonds of 10+ years)",
    taxExempt: "false",
    maturityRule: "fixed maturity date per prospectus",
  };

  it("blocks an FXD missing issueNumber/couponRate/maturityDate", () => {
    const gate = checkApprovalGate({ ...baseArgs, name: "FXD1/2024/10", figures: fxdFigures });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toEqual(["issue number", "coupon rate", "maturity date"]);
    expect(gate.cbkSubtype).toBe("fxd");
  });

  it("clears once issueNumber/couponRate/maturityDate are supplied", () => {
    const gate = checkApprovalGate({
      ...baseArgs,
      name: "FXD1/2024/10",
      figures: {
        ...fxdFigures,
        issueNumber: "FXD1/2024/10",
        couponRate: "14",
        maturityDate: "2034-06-20",
      },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("accepts the coupon alias for couponRate (normaliseExtractionFields' canonical key)", () => {
    const gate = checkApprovalGate({
      ...baseArgs,
      name: "FXD1/2024/10",
      figures: { ...fxdFigures, issueNumber: "FXD1/2024/10", coupon: "14", maturityDate: "2034-06-20" },
    });
    expect(gate.ok).toBe(true);
  });
});

describe("Stage 3 · IFB requires the SAME fields as FXD, plus taxExempt must be TRUE", () => {
  const ifbFigures = {
    securityType: "ifb",
    tenor: "12y",
    yieldPct: "14.5",
    whtRule: "0% — infrastructure bonds are tax-exempt",
    maturityRule: "fixed maturity date per prospectus",
    issueNumber: "IFB1/2024/12",
    couponRate: "14.5",
    maturityDate: "2036-06-20",
  };

  it("blocks an IFB whose taxExempt flag is missing", () => {
    const gate = checkApprovalGate({ ...baseArgs, name: "IFB1/2024/12", figures: ifbFigures });
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("tax-exempt flag");
  });

  it("blocks an IFB whose taxExempt flag was (incorrectly) recorded as false", () => {
    const gate = checkApprovalGate({
      ...baseArgs,
      name: "IFB1/2024/12",
      figures: { ...ifbFigures, taxExempt: false },
    });
    expect(gate.ok).toBe(false);
    // The baseline "tax-exempt flag" check passes (a value IS present — booleans count),
    // but Stage 3's IFB-specific check catches that it is the WRONG value.
    expect(gate.missing).toContain("tax-exempt flag must be TRUE for an infrastructure bond");
  });

  it("clears once taxExempt is explicitly true", () => {
    const gate = checkApprovalGate({
      ...baseArgs,
      name: "IFB1/2024/12",
      figures: { ...ifbFigures, taxExempt: true },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
    expect(gate.cbkSubtype).toBe("ifb");
  });

  it("also accepts the string \"true\"", () => {
    const gate = checkApprovalGate({
      ...baseArgs,
      name: "IFB1/2024/12",
      figures: { ...ifbFigures, taxExempt: "true" },
    });
    expect(gate.ok).toBe(true);
  });
});

describe("Stage 3 · an undetected sub-type adds no extra requirements (unchanged prior behaviour)", () => {
  it("a CBK security with no tenor/type/name signal is judged by the baseline rules only", () => {
    const gate = checkApprovalGate({
      ...baseArgs,
      name: "Unnamed Security",
      figures: {
        securityType: "custom",
        tenor: "5y",
        yieldPct: "13",
        whtRule: "15%",
        taxExempt: "false",
        maturityRule: "at maturity",
      },
    });
    expect(gate.cbkSubtype).toBeNull();
    expect(gate.ok).toBe(true); // baseline alone is satisfied; no sub-type extras applied
  });
});

describe("Stage 3 · an EDIT is exempt, exactly like the baseline gate", () => {
  it("a single-field edit never triggers sub-type requirements", () => {
    const gate = checkApprovalGate({
      assetClass: "gov_coupon",
      changeKind: "edit",
      name: "FXD1/2024/10",
      figures: { couponRate: "14" },
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });
});
