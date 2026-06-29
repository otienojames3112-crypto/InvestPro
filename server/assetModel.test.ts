import { describe, it, expect } from "vitest";
import {
  ASSET_CLASSES,
  ASSET_PROFILES,
  assetClassForSecurityType,
  assetClassForBankInstrument,
  assetClassForMmf,
  assetGuardIssues,
  isAssetRowComplete,
  profileFor,
} from "../shared/assetModel";
import { taxFor, netOfTax, RESIDENT_TAX_RATES } from "../shared/assetTax";
import { whtRateForSecurity, type SecurityType } from "../shared/securityTenor";

describe("AssetClass taxonomy (Expansion Part 1)", () => {
  it("maps every existing government securityType to the correct class (backfill rule)", () => {
    const discount: SecurityType[] = ["tbill_91", "tbill_182", "tbill_364", "zero_coupon"];
    const coupon: SecurityType[] = ["ifb", "fxd", "floating_rate"];
    for (const t of discount) expect(assetClassForSecurityType(t)).toBe("gov_discount");
    for (const t of coupon) expect(assetClassForSecurityType(t)).toBe("gov_coupon");
  });

  it("maps bank instruments and MMF to their classes", () => {
    for (const t of ["call_deposit", "fixed_deposit", "ordinary_savings", "target_savings", "tiered_savings"]) {
      expect(assetClassForBankInstrument(t)).toBe("bank_deposit");
    }
    expect(assetClassForMmf()).toBe("cash_mmf");
  });

  it("exposes a profile for every declared class", () => {
    for (const c of ASSET_CLASSES) {
      expect(profileFor(c)).toBeDefined();
      expect(ASSET_PROFILES[c].assetClass).toBe(c);
    }
  });

  it("preserves the behavior flags the engine relies on for existing classes", () => {
    // Discount paper accretes, is not price-driven, not FX-exposed, has maturity.
    const d = ASSET_PROFILES.gov_discount;
    expect(d.valuation).toBe("accretion_to_face");
    expect(d.priceDriven).toBe(false);
    expect(d.fxExposed).toBe(false);
    expect(d.hasMaturity).toBe(true);
    // Coupon bonds sit at par + coupon.
    expect(ASSET_PROFILES.gov_coupon.valuation).toBe("par_plus_coupon");
    expect(ASSET_PROFILES.gov_coupon.priceDriven).toBe(false);
    // MMF/bank are interest accrual, not price-driven.
    expect(ASSET_PROFILES.cash_mmf.priceDriven).toBe(false);
    expect(ASSET_PROFILES.bank_deposit.priceDriven).toBe(false);
    // MMF is uninsured; bank deposit is KDIC insured (matches existing copy).
    expect(ASSET_PROFILES.cash_mmf.insured).toBe("none");
    expect(ASSET_PROFILES.bank_deposit.insured).toBe("kdic_bank");
    // New classes are price-driven; offshore is FX-exposed.
    expect(ASSET_PROFILES.equity.priceDriven).toBe(true);
    expect(ASSET_PROFILES.reit.priceDriven).toBe(true);
    expect(ASSET_PROFILES.offshore_fund.priceDriven).toBe(true);
    expect(ASSET_PROFILES.offshore_fund.fxExposed).toBe(true);
    expect(ASSET_PROFILES.equity.fxExposed).toBe(false);
  });
});

describe("taxFor() single decision point parity (Expansion Part 1)", () => {
  it("reproduces whtRateForSecurity EXACTLY for discount + coupon income (no number change)", () => {
    const cases: Array<{ st: SecurityType; tenor?: number }> = [
      { st: "tbill_91" },
      { st: "tbill_182" },
      { st: "tbill_364" },
      { st: "zero_coupon" },
      { st: "ifb" },
      { st: "fxd", tenor: 5 },
      { st: "fxd", tenor: 12 },
      { st: "floating_rate", tenor: 7 },
    ];
    for (const { st, tenor } of cases) {
      const expected = whtRateForSecurity(st, tenor);
      const assetClass = assetClassForSecurityType(st);
      const got = taxFor({ assetClass, securityType: st, tenorYears: tenor });
      expect(got.ratePct).toBe(expected);
    }
  });

  it("treats IFB coupon as exempt", () => {
    const got = taxFor({ assetClass: "gov_coupon", securityType: "ifb" });
    expect(got.ratePct).toBe(0);
    expect(got.exempt).toBe(true);
  });

  it("uses 15% interest WHT for MMF and bank deposit", () => {
    expect(taxFor({ assetClass: "cash_mmf" }).ratePct).toBe(15);
    expect(taxFor({ assetClass: "bank_deposit" }).ratePct).toBe(15);
  });

  it("applies 5% resident dividend WHT for equities, overridable", () => {
    const def = taxFor({ assetClass: "equity" });
    expect(def.ratePct).toBe(RESIDENT_TAX_RATES.dividend);
    expect(def.requiresReview).toBe(false);
    const overridden = taxFor({ assetClass: "equity", userRatePct: 0 });
    expect(overridden.ratePct).toBe(0);
  });

  it("flags REIT and offshore distributions for review and never fabricates a rate", () => {
    const reit = taxFor({ assetClass: "reit" });
    expect(reit.requiresReview).toBe(true);
    expect(reit.basis).toBe("distribution");
    const offshore = taxFor({ assetClass: "offshore_fund" });
    expect(offshore.requiresReview).toBe(true);
    // user-supplied rate is honoured and no longer flagged
    const supplied = taxFor({ assetClass: "offshore_fund", userRatePct: 10 });
    expect(supplied.ratePct).toBe(10);
    expect(supplied.requiresReview).toBe(false);
  });

  it("netOfTax nets gross by the resolved rate", () => {
    expect(netOfTax(1000, { assetClass: "equity" })).toBeCloseTo(950, 6); // 5%
    expect(netOfTax(1000, { assetClass: "cash_mmf" })).toBeCloseTo(850, 6); // 15%
  });
});

describe("Asset guards (Expansion Part 1)", () => {
  it("existing non-price-driven classes are always complete", () => {
    expect(isAssetRowComplete({ assetClass: "gov_discount" })).toBe(true);
    expect(isAssetRowComplete({ assetClass: "gov_coupon" })).toBe(true);
    expect(isAssetRowComplete({ assetClass: "cash_mmf" })).toBe(true);
    expect(isAssetRowComplete({ assetClass: "bank_deposit" })).toBe(true);
  });

  it("price-driven assets require price, units and provenance", () => {
    const issues = assetGuardIssues({ assetClass: "equity" });
    expect(issues.length).toBeGreaterThan(0);
    const ok = assetGuardIssues({
      assetClass: "equity",
      unitPrice: 42.5,
      units: 100,
      dataSource: "NSE close",
      dataAsOf: "2026-06-28",
    });
    expect(ok).toEqual([]);
  });

  it("FX-exposed assets require currency and fx rate, flagged not defaulted", () => {
    const issues = assetGuardIssues({
      assetClass: "offshore_fund",
      unitPrice: 10,
      units: 5,
      dataSource: "Vanguard",
      dataAsOf: "2026-06-28",
    });
    expect(issues.some((i) => /currency/i.test(i))).toBe(true);
    expect(issues.some((i) => /fxRateToKes/i.test(i))).toBe(true);
    const ok = assetGuardIssues({
      assetClass: "offshore_fund",
      unitPrice: 10,
      units: 5,
      dataSource: "Vanguard",
      dataAsOf: "2026-06-28",
      currency: "USD",
      fxRateToKes: 129.5,
    });
    expect(ok).toEqual([]);
  });
});
