/**
 * Part 7.0 corrections — test coverage.
 *
 * 7.0.b: REIT/offshore distribution WHT must be SOURCED, never an unsourced
 *        silent zero; offshore must carry an `unverified` flag until the user
 *        confirms; a user-supplied rate overrides and clears the flag. The
 *        existing fixed-income rates (interest/coupon/discount) must NOT change.
 */
import { describe, it, expect } from "vitest";
import { taxFor, netOfTax, RESIDENT_TAX_RATES } from "../shared/assetTax";
import { whtRateForSecurity } from "../shared/securityTenor";

describe("Part 7.0.b — sourced REIT / offshore distribution tax", () => {
  it("REIT distribution defaults to the sourced resident 5% (not zero), review-flagged but NOT unverified", () => {
    const t = taxFor({ assetClass: "reit", incomeType: "distribution" });
    expect(t.ratePct).toBe(5);
    expect(t.ratePct).toBeGreaterThan(0); // never a silent zero
    expect(t.exempt).toBe(false);
    expect(t.requiresReview).toBe(true); // confirm for circumstances
    expect(t.unverified).toBe(false); // 5% is sourced
    expect(t.source).toMatch(/REIT/i);
  });

  it("offshore distribution defaults to a LABELLED, UNVERIFIED 15% benchmark (not zero)", () => {
    const t = taxFor({ assetClass: "offshore_fund", incomeType: "distribution" });
    expect(t.ratePct).toBe(15);
    expect(t.ratePct).toBeGreaterThan(0); // never a silent zero
    expect(t.requiresReview).toBe(true);
    expect(t.unverified).toBe(true); // must be confirmed
    expect(t.source).toMatch(/UNVERIFIED/i);
  });

  it("a user-supplied rate overrides the default AND clears the unverified flag for offshore", () => {
    const t = taxFor({ assetClass: "offshore_fund", incomeType: "distribution", userRatePct: 10 });
    expect(t.ratePct).toBe(10);
    expect(t.unverified).toBe(false);
    expect(t.requiresReview).toBe(false);
    expect(t.source).toMatch(/user-supplied/i);
  });

  it("a user-supplied 0% is honored as a confirmed choice (exempt), not treated as a phantom silent zero", () => {
    const t = taxFor({ assetClass: "offshore_fund", incomeType: "distribution", userRatePct: 0 });
    expect(t.ratePct).toBe(0);
    expect(t.exempt).toBe(true);
    expect(t.unverified).toBe(false); // explicitly chosen, not an unsourced default
    expect(t.requiresReview).toBe(false);
  });

  it("the declared default rates are non-zero and sourced", () => {
    expect(RESIDENT_TAX_RATES.dividend).toBeGreaterThan(0);
    expect(RESIDENT_TAX_RATES.reitDistribution).toBeGreaterThan(0);
    expect(RESIDENT_TAX_RATES.offshoreDistribution).toBeGreaterThan(0);
  });

  it("netOfTax applies the sourced REIT rate (not zero)", () => {
    const net = netOfTax(1000, { assetClass: "reit", incomeType: "distribution" });
    expect(net).toBeCloseTo(950, 6); // 1000 − 5%
  });
});

describe("Part 7.0.b — existing fixed-income rates are unchanged", () => {
  it("MMF/bank interest stays 15% resident WHT and is neither review-required nor unverified", () => {
    const t = taxFor({ assetClass: "cash_mmf", incomeType: "interest" });
    expect(t.ratePct).toBe(15);
    expect(t.requiresReview).toBe(false);
    expect(t.unverified).toBe(false);
  });

  it("IFB coupon stays exempt (0%) via the existing tiered helper", () => {
    const t = taxFor({ assetClass: "gov_coupon", incomeType: "coupon", securityType: "ifb" });
    expect(t.ratePct).toBe(0);
    expect(t.exempt).toBe(true);
    expect(t.unverified).toBe(false);
  });

  it("T-bill discount stays exactly what the existing tiered helper returns, not flagged unverified", () => {
    const t = taxFor({ assetClass: "gov_discount", incomeType: "discount", securityType: "tbill" });
    expect(t.ratePct).toBe(whtRateForSecurity("tbill")); // delegates, no re-derivation
    expect(t.unverified).toBe(false);
    expect(t.requiresReview).toBe(false);
  });

  it("listed-share dividend stays the sourced 5% final tax, not unverified", () => {
    const t = taxFor({ assetClass: "equity", incomeType: "dividend" });
    expect(t.ratePct).toBe(5);
    expect(t.unverified).toBe(false);
    expect(t.requiresReview).toBe(false);
  });
});
