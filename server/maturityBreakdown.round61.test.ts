// ─────────────────────────────────────────────────────────────────────────────
// R61 — Structured maturity breakdown + Diversify target choice.
//
// R61.1: the engine now emits a structured `maturityBreakdown` per month so the
//   Month Ledger can show principal vs final coupon as distinct lines (rather than
//   parsing the narration string). These tests lock the structured shape for FXD
//   (net-of-WHT final coupon), IFB (tax-exempt final coupon), and T-bill (discount).
// R61.3: `buildDiversifyLink` gains an "mmf" target that routes to the Contributions
//   lump-sum dialog; the T-bill target keeps the register add-dialog deep-link.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { runProjection, type ActualSecurity, type EngineSettings } from "./engine";
import { buildDiversifyLink } from "@shared/discount";

const SETTINGS: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.8206,
  tbill182Rate: 8.7782,
  tbill364Rate: 8.9746,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  startDate: "2026-07-01",
  horizonMonths: 120,
};

const WHT = 0.15;
const FACE = 100_000;

function fxd24(): ActualSecurity {
  return {
    securityType: "fxd",
    faceValue: FACE,
    issueDate: "2026-07-01",
    maturityDate: "2028-07-01",
    couponRate: 10.5,
    isTaxExempt: false,
    isMatured: false,
  };
}

function ifb24(): ActualSecurity {
  return {
    securityType: "ifb",
    faceValue: FACE,
    issueDate: "2026-07-01",
    maturityDate: "2028-07-01",
    couponRate: 12,
    isTaxExempt: true,
    isMatured: false,
  };
}

function tbill364(): ActualSecurity {
  return {
    securityType: "tbill_364",
    faceValue: FACE,
    issueDate: "2026-07-01",
    maturityDate: "2027-07-01",
    discountRate: 9,
    isTaxExempt: false,
    isMatured: false,
  };
}

describe("R61.1 — FXD maturity breakdown carries principal + net final coupon", () => {
  const result = runProjection(SETTINGS, [], [], [], [fxd24()]);
  const month = result.find(
    (r) => Array.isArray(r.maturityBreakdown) && r.maturityBreakdown.length > 0,
  );

  it("emits a structured breakdown entry at maturity", () => {
    expect(month).toBeTruthy();
    const entry = month!.maturityBreakdown!.find((e) => e.kind === "fxd");
    expect(entry).toBeTruthy();
    expect(entry!.principal).toBeCloseTo(FACE, 0);
    const grossCoupon = (FACE * (10.5 / 100)) / 2;
    expect(entry!.finalCoupon).toBeCloseTo(grossCoupon * (1 - WHT), 0);
  });

  it("breakdown total equals principal + final coupon", () => {
    const entry = month!.maturityBreakdown!.find((e) => e.kind === "fxd")!;
    expect(entry.total).toBeCloseTo(entry.principal + entry.finalCoupon, 0);
  });
});

describe("R61.1 — IFB maturity breakdown final coupon is tax-exempt", () => {
  const result = runProjection(SETTINGS, [], [], [], [ifb24()]);
  const entry = result
    .flatMap((r) => r.maturityBreakdown ?? [])
    .find((e) => e.kind === "ifb");

  it("includes the full (untaxed) final coupon", () => {
    expect(entry).toBeTruthy();
    const coupon = (FACE * (12 / 100)) / 2;
    expect(entry!.finalCoupon).toBeCloseTo(coupon, 0);
    expect(entry!.principal).toBeCloseTo(FACE, 0);
  });
});

describe("R61.1 — T-bill maturity breakdown has no coupon", () => {
  const result = runProjection(SETTINGS, [], [], [], [tbill364()]);
  const entry = result
    .flatMap((r) => r.maturityBreakdown ?? [])
    .find((e) => e.kind.startsWith("tbill"));

  it("records price as principal, net discount separately, and no coupon", () => {
    expect(entry).toBeTruthy();
    // A discount T-bill records principal = discounted price paid and the gain in
    // `discount` (net of WHT). total = principal + net discount (= face minus the
    // WHT withheld on the discount). No coupon component.
    expect(entry!.finalCoupon).toBeCloseTo(0, 6);
    expect(entry!.discount).toBeGreaterThan(0);
    expect(entry!.principal).toBeGreaterThan(0);
    expect(entry!.principal).toBeLessThan(FACE);
    expect(entry!.total).toBeCloseTo(entry!.principal + entry!.discount, 0);
  });
});

describe("R61.3 — buildDiversifyLink target choice", () => {
  it("builds a T-bill register deep-link with face value", () => {
    expect(buildDiversifyLink(2_155_069, "tbill_364")).toBe(
      "/securities?add=1&addType=tbill_364&face=2155069",
    );
  });

  it("builds an MMF lump-sum contributions deep-link with amount", () => {
    expect(buildDiversifyLink(2_155_069, "mmf")).toBe(
      "/contributions?addLump=1&amount=2155069",
    );
  });

  it("rounds the amount to a whole shilling", () => {
    expect(buildDiversifyLink(1234.6, "mmf")).toBe("/contributions?addLump=1&amount=1235");
  });

  it("omits the amount when non-positive", () => {
    expect(buildDiversifyLink(0, "mmf")).toBe("/contributions?addLump=1");
    expect(buildDiversifyLink(-5, "tbill_364")).toBe("/securities?add=1&addType=tbill_364");
  });
});
