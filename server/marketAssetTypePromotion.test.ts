/**
 * Stage 3b.2 — market-asset assetClass mislabelling fix (PURE, framework-free).
 *
 * structuredInstrumentToDraft previously flattened EVERY structured market-asset
 * extraction (market_asset_factsheet / market_asset_price source classes) to
 * AssetClass "equity", regardless of the real `assetType` the model extracted
 * (equity, reit, etf, offshore_fund, property, sacco, pension, other — a free
 * string per MARKET_ASSET_EXTRACTION_SCHEMA, not a hard enum). buildPromotionPlan
 * writes that assetClass straight into the LIVE opportunities.assetClass column,
 * so a real REIT/offshore-fund/sacco could be promoted mislabelled "equity" and
 * pick up the wrong downstream tax/behaviour treatment.
 *
 * This suite locks: assetType now determines the finding's assetClass for
 * market-asset extractions, mapping DIRECTLY only to the three classes this app
 * actually models distinctly (equity, reit, offshore_fund) when the source states
 * them unambiguously. etf/property/sacco/pension/other all fall to "alt" rather
 * than a lookalike class, because reit/offshore_fund actively DRIVE downstream tax
 * citations and FX-requirement validation (shared/assetTax.ts taxFor(),
 * assetGuardIssues() in shared/assetModel.ts enforced at holding-creation time)
 * that would be actively WRONG — not just imprecise — for a mismatched instrument:
 * a local KES-denominated ETF forced through offshore_fund's FX-required guard, or
 * a non-REIT property product given Kenya's specific REIT trust-level tax
 * exemption citation. Falls back to "equity" — the PRE-EXISTING default — only when
 * assetType is missing, the "missing_from_source" sentinel, or genuinely
 * unrecognised, so ambiguous-instrument behaviour is unchanged from before.
 *
 * Scoped to the promotion/source-class mapping only: no approval-gate changes,
 * no CBK/MMF/bank logic, no UI.
 */
import { describe, expect, it } from "vitest";
import { structuredInstrumentToDraft } from "../server/aiResearchService";

function draftFor(assetType: unknown) {
  const draft = structuredInstrumentToDraft(
    { instrumentName: "Sample Market Asset", assetType, marketPrice: "12.50", currency: "KES" },
    "market_asset_factsheet",
  );
  expect(draft).not.toBeNull();
  return draft!;
}

describe("Stage 3b.2 · market-asset assetType → assetClass mapping", () => {
  it("1. equity stays equity", () => {
    expect(draftFor("equity").assetClass).toBe("equity");
  });

  it("2. REIT promotes with the dedicated reit assetClass", () => {
    expect(draftFor("reit").assetClass).toBe("reit");
  });

  it("3. offshore fund promotes with the dedicated offshore_fund assetClass", () => {
    expect(draftFor("offshore_fund").assetClass).toBe("offshore_fund");
  });

  it("4. SACCO promotes as \"alt\" — the correct EXISTING value, since AssetClass has no dedicated sacco class (matches the generic-extraction-path fallback)", () => {
    expect(draftFor("sacco").assetClass).toBe("alt");
  });

  it("5. a MISSING assetType falls back safely to equity (the pre-existing default)", () => {
    expect(draftFor(undefined).assetClass).toBe("equity");
    expect(draftFor(null).assetClass).toBe("equity");
  });

  it("6. an UNKNOWN assetType does not write a dangerous/invalid value — falls back to the safe, valid \"equity\" default", () => {
    const draft = draftFor("some_future_instrument_type_the_model_invented");
    expect(draft.assetClass).toBe("equity");
    // Never a raw, un-mapped string reaching the typed AssetClass field.
    expect(draft.assetClass).not.toBe("some_future_instrument_type_the_model_invented");
  });

  it("property maps to alt, NOT reit — a property product isn't necessarily a legally-registered REIT, and reit's tax path cites Kenya's specific REIT trust-level exemption (ITA s.20), which would be a wrong legal claim for a non-REIT property scheme", () => {
    expect(draftFor("property").assetClass).toBe("alt");
  });

  it("etf maps to alt, NOT offshore_fund — an ETF can be locally listed and KES-denominated, and offshore_fund is fxExposed:true, which assetGuardIssues() actively REJECTS at holding-creation time unless the currency is non-KES with a positive FX rate", () => {
    expect(draftFor("etf").assetClass).toBe("alt");
  });

  it("pension and other map to alt, same as sacco/etf/property", () => {
    expect(draftFor("pension").assetClass).toBe("alt");
    expect(draftFor("other").assetClass).toBe("alt");
  });

  it("is tolerant of case and surrounding whitespace", () => {
    expect(draftFor("REIT").assetClass).toBe("reit");
    expect(draftFor("  Offshore_Fund  ").assetClass).toBe("offshore_fund");
  });

  it("the MISSING_FROM_SOURCE sentinel falls back to equity, not an unmapped literal", () => {
    expect(draftFor("missing_from_source").assetClass).toBe("equity");
  });

  it("targetCatalogue stays market_asset regardless of assetType (catalogue routing was never affected by this bug)", () => {
    expect(draftFor("reit").targetCatalogue).toBe("market_asset");
    expect(draftFor("sacco").targetCatalogue).toBe("market_asset");
    expect(draftFor(undefined).targetCatalogue).toBe("market_asset");
  });

  it("the market_asset_price source class is mapped the same way as market_asset_factsheet", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "Sample Market Asset", assetType: "reit", marketPrice: "12.50" },
      "market_asset_price",
    );
    expect(draft?.assetClass).toBe("reit");
  });
});
