import { describe, it, expect } from "vitest";
import {
  ASSET_CLASSES,
  isValidAssetClass,
  normaliseAssetClass,
  profileFor,
} from "../shared/assetModel";

/**
 * Round 81 follow-up — data-quality guard.
 *
 * A pre-existing AI-ingested catalogue row ("CIC Money Market Fund") stored its
 * assetClass as the raw human label "Money Market Fund", which `profileFor`
 * treated as `alt` and therefore rendered as "Alternative asset". These tests
 * lock in the normaliser that recovers the canonical class so the mislabel
 * cannot silently return.
 */
describe("normaliseAssetClass", () => {
  it("passes every canonical taxonomy code through unchanged", () => {
    for (const c of ASSET_CLASSES) {
      expect(normaliseAssetClass(c)).toBe(c);
    }
  });

  it("recovers cash_mmf from the exact legacy strings that caused the CIC mislabel", () => {
    expect(normaliseAssetClass("Money Market Fund")).toBe("cash_mmf");
    expect(normaliseAssetClass("money_market_fund")).toBe("cash_mmf");
    expect(normaliseAssetClass("MMF")).toBe("cash_mmf");
    expect(normaliseAssetClass("Money Market")).toBe("cash_mmf");
  });

  it("maps other common human labels onto the correct class", () => {
    expect(normaliseAssetClass("Balanced Fund")).toBe("alt");
    expect(normaliseAssetClass("Fixed Deposit")).toBe("bank_deposit");
    expect(normaliseAssetClass("Treasury Bill")).toBe("gov_discount");
    expect(normaliseAssetClass("Treasury Bond")).toBe("gov_coupon");
    expect(normaliseAssetClass("Shares")).toBe("equity");
    expect(normaliseAssetClass("Property Fund")).toBe("reit");
    expect(normaliseAssetClass("Offshore")).toBe("offshore_fund");
  });

  it("falls back to alt for genuinely unknown / empty / non-string input (never throws)", () => {
    expect(normaliseAssetClass("something we have never seen")).toBe("alt");
    expect(normaliseAssetClass("")).toBe("alt");
    expect(normaliseAssetClass(null)).toBe("alt");
    expect(normaliseAssetClass(undefined)).toBe("alt");
    expect(normaliseAssetClass(42 as unknown)).toBe("alt");
  });

  it("always returns a value that is itself a valid asset class", () => {
    const samples = ["Money Market Fund", "Balanced Fund", "nonsense", "", "cash_mmf"];
    for (const s of samples) {
      expect(isValidAssetClass(normaliseAssetClass(s))).toBe(true);
    }
  });

  it("a normalised MMF label yields the cash_mmf behaviour profile (not the alt fallback)", () => {
    const cls = normaliseAssetClass("Money Market Fund");
    const profile = profileFor(cls);
    expect(profile.assetClass).toBe("cash_mmf");
    expect(profile.label).toBe("Money-market fund");
  });
});
