// ─────────────────────────────────────────────────────────────────────────────
// R60 — Final coupon paid at coupon-bond maturity.
//
// Previously the engine's coupon-bond maturity branch returned only the FACE
// (principal) and `continue`d, silently dropping the final coupon that is due on
// the maturity date (the maturity month is always a coupon date by construction,
// since bond tenors are multiples of the 6-month coupon cadence). These tests
// lock the corrected behaviour:
//   - At maturity, principal AND the final coupon are returned to the MMF.
//   - The final coupon is tax-exempt for IFB and net of WHT for FXD/floating.
//   - The coupon is paid EXACTLY ONCE (the periodic coupon block must not also
//     fire in the maturity month).
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { runProjection, type ActualSecurity, type EngineSettings } from "./engine";

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

// A 24-month FXD issued at the plan start. Coupon 10.5% → semi-annual gross
// coupon = 100,000 × 10.5%/2 = 5,250; net of 15% WHT = 4,462.5.
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

// A 24-month IFB, coupon 12% tax-exempt → semi-annual coupon = 6,000, no WHT.
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

// A 24-month floating-rate bond carrying an 11% current coupon, taxable like FXD.
function floating24(): ActualSecurity {
  return {
    securityType: "floating_rate",
    faceValue: FACE,
    issueDate: "2026-07-01",
    maturityDate: "2028-07-01",
    couponRate: 11,
    isTaxExempt: false,
    isMatured: false,
    marginRate: 1.5,
    resetMonths: 6,
  };
}

describe("R60 — FXD final coupon paid net of WHT at maturity", () => {
  const result = runProjection(SETTINGS, [], [], [], [fxd24()]);
  // The lot is issued in the start month (offset 0). Maturity is 24 months later,
  // i.e. month index 24 (1-based monthNumber 24 → results[23]).
  const maturityMonth = result.find((r) =>
    r.mainAction.includes("matures, returning") && r.mainAction.includes("final coupon"),
  );

  it("emits a maturity narration with principal + final coupon", () => {
    expect(maturityMonth).toBeTruthy();
    expect(maturityMonth!.mainAction).toContain("principal");
    expect(maturityMonth!.mainAction).toContain("final coupon");
    expect(maturityMonth!.mainAction).toContain("net of 15% tax");
  });

  it("the maturity month's CBK cash includes face + net final coupon", () => {
    const grossCoupon = FACE * (10.5 / 100) / 2; // 5,250
    const netCoupon = grossCoupon * (1 - WHT); // 4,462.5
    // cbkCashIn for the maturity month should equal face + net coupon.
    expect(maturityMonth!.cbkCashIn).toBeCloseTo(FACE + netCoupon, 0);
  });

  it("the final coupon is paid exactly once (no double count in the maturity month)", () => {
    const grossCoupon = FACE * (10.5 / 100) / 2;
    const netCoupon = grossCoupon * (1 - WHT);
    // If the periodic block ALSO fired, cbkCashIn would be face + 2×netCoupon.
    expect(maturityMonth!.cbkCashIn).toBeLessThan(FACE + 2 * netCoupon - 1);
  });
});

describe("R60 — IFB final coupon is tax-exempt at maturity", () => {
  const result = runProjection(SETTINGS, [], [], [], [ifb24()]);
  const maturityMonth = result.find((r) =>
    r.mainAction.includes("matures, returning") && r.mainAction.includes("final coupon"),
  );

  it("narrates a tax-exempt final coupon", () => {
    expect(maturityMonth).toBeTruthy();
    expect(maturityMonth!.mainAction).toContain("final coupon");
    expect(maturityMonth!.mainAction).toContain("tax-exempt");
  });

  it("the maturity month's CBK cash includes face + full (untaxed) final coupon", () => {
    const coupon = FACE * (12 / 100) / 2; // 6,000 (no WHT)
    expect(maturityMonth!.cbkCashIn).toBeCloseTo(FACE + coupon, 0);
  });
});

describe("R60 — floating-rate bond shares the FXD maturity branch (taxable coupon)", () => {
  const result = runProjection(SETTINGS, [], [], [], [floating24()]);
  const maturityMonth = result.find((r) =>
    r.mainAction.includes("matures, returning") && r.mainAction.includes("final coupon"),
  );

  it("pays a net-of-WHT final coupon at maturity", () => {
    expect(maturityMonth).toBeTruthy();
    expect(maturityMonth!.mainAction).toContain("net of 15% tax");
    const grossCoupon = FACE * (11 / 100) / 2; // 5,500
    const netCoupon = grossCoupon * (1 - WHT); // 4,675
    expect(maturityMonth!.cbkCashIn).toBeCloseTo(FACE + netCoupon, 0);
  });
});

describe("R60 — WHT on the final FXD coupon is accumulated", () => {
  it("the maturity month records WHT on the final coupon", () => {
    const result = runProjection(SETTINGS, [], [], [], [fxd24()]);
    const maturityMonth = result.find((r) =>
      r.mainAction.includes("final coupon") && r.mainAction.includes("net of"),
    );
    const grossCoupon = FACE * (10.5 / 100) / 2;
    const expectedWht = grossCoupon * WHT; // 787.5
    expect(maturityMonth!.whtThisMonth).toBeGreaterThanOrEqual(expectedWht - 1);
  });
});
