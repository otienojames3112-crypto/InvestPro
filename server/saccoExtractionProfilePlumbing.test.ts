/**
 * Stage 3b.4a - SACCO extraction/profile field plumbing only.
 *
 * This slice deliberately does NOT add approval-gate rules, baseline gate changes,
 * promotion mapping, holdings behavior, or classification changes. It only proves
 * the structured market-asset extraction can carry SACCO-specific facts and that
 * the existing structuredInstrumentToDraft flattening path preserves them.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { structuredInstrumentToDraft } from "../server/aiResearchService";

const SACCO_FIELD_KEYS = [
  "shareCapitalDividendRate",
  "depositRebateRate",
  "minimumShareCapital",
  "minimumMonthlyDeposit",
  "regulatoryStatus",
  "withdrawalTerms",
] as const;

type SaccoFieldKey = (typeof SACCO_FIELD_KEYS)[number];

const SERVICE_SOURCE = readFileSync(new URL("../server/aiResearchService.ts", import.meta.url), "utf8");

function draftFor(raw: Record<string, unknown>) {
  const draft = structuredInstrumentToDraft(
    {
      instrumentName: "Example SACCO",
      assetType: "sacco",
      currency: "KES",
      rawExcerpt: "Example SACCO declared member dividend and deposit rebate rates.",
      warnings: [],
      confidence: 0.9,
      proposalType: "create",
      matchedCurrentRow: null,
      changedFields: [],
      currentValues: [],
      ...raw,
    },
    "market_asset_factsheet",
  );
  expect(draft).not.toBeNull();
  return draft!;
}

function extendedFields(fields: Record<string, string>): Record<string, unknown> {
  const raw = fields._extendedFields;
  expect(raw).toBeTruthy();
  return JSON.parse(raw);
}

function expectSaccoFieldPreserved(key: SaccoFieldKey, value: string) {
  const draft = draftFor({ [key]: value });
  expect(draft.assetClass).toBe("alt");
  expect(draft.targetCatalogue).toBe("market_asset");
  expect(draft.extractedFields[key]).toBe(value);
  expect(extendedFields(draft.extractedFields)[key]).toBe(value);
}

describe("Stage 3b.4a - market-asset schema declares SACCO fields", () => {
  it("adds the SACCO keys to the strict market-asset schema and prompt", () => {
    const schemaStart = SERVICE_SOURCE.indexOf("const MARKET_ASSET_EXTRACTION_SCHEMA");
    const schemaEnd = SERVICE_SOURCE.indexOf("function extractionSchemaForClass");
    const schemaBlock = SERVICE_SOURCE.slice(schemaStart, schemaEnd);

    for (const key of SACCO_FIELD_KEYS) {
      expect(schemaBlock).toContain(`${key}:`);
      expect(schemaBlock).toContain(`"${key}"`);
    }
    expect(SERVICE_SOURCE).toContain("For SACCO entries");
  });
});

describe("Stage 3b.4a - SACCO fields survive structured draft plumbing", () => {
  it("carries share-capital dividend rate", () => {
    expectSaccoFieldPreserved("shareCapitalDividendRate", "13.5%");
  });

  it("carries deposit rebate / interest rate", () => {
    expectSaccoFieldPreserved("depositRebateRate", "8.0%");
  });

  it("carries minimum share capital", () => {
    expectSaccoFieldPreserved("minimumShareCapital", "KES 20,000");
  });

  it("carries minimum monthly deposit / contribution", () => {
    expectSaccoFieldPreserved("minimumMonthlyDeposit", "KES 1,000 per month");
  });

  it("carries SASRA / regulatory status", () => {
    expectSaccoFieldPreserved("regulatoryStatus", "SASRA-regulated deposit-taking SACCO");
  });

  it("carries withdrawal / liquidity terms", () => {
    expectSaccoFieldPreserved("withdrawalTerms", "Deposits withdrawable after 60 days' written notice");
  });

  it("preserves all SACCO fields together in extractedFields and _extendedFields", () => {
    const raw = {
      shareCapitalDividendRate: "13.5%",
      depositRebateRate: "8.0%",
      minimumShareCapital: "KES 20,000",
      minimumMonthlyDeposit: "KES 1,000 per month",
      regulatoryStatus: "SASRA-regulated deposit-taking SACCO",
      withdrawalTerms: "Deposits withdrawable after 60 days' written notice",
    };
    const draft = draftFor(raw);
    const extended = extendedFields(draft.extractedFields);

    for (const [key, value] of Object.entries(raw)) {
      expect(draft.extractedFields[key]).toBe(value);
      expect(extended[key]).toBe(value);
    }
  });
});

describe("Stage 3b.4a - existing market-asset behavior is unchanged", () => {
  it("keeps equity, REIT, offshore fund, and non-SACCO alt mappings unchanged", () => {
    expect(draftFor({ assetType: "equity", marketPrice: "12.50" }).assetClass).toBe("equity");
    expect(draftFor({ assetType: "reit", marketPrice: "12.50" }).assetClass).toBe("reit");
    expect(draftFor({ assetType: "offshore_fund", marketPrice: "12.50", currency: "USD" }).assetClass).toBe(
      "offshore_fund",
    );

    for (const assetType of ["etf", "property", "pension", "other"] as const) {
      const draft = draftFor({ assetType, marketPrice: "12.50" });
      expect(draft.assetClass).toBe("alt");
      expect(draft.targetCatalogue).toBe("market_asset");
    }
  });
});
