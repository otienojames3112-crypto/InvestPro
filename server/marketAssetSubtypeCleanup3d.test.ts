/**
 * Stage 10b-3d — live SACCO/REIT cleanup regressions.
 *
 * Pure and static tests only: no DB, network, or LLM. The raw objects mirror the
 * strict market-asset schema response seen immediately before
 * structuredInstrumentToDraft, including irrelevant subtype fields returned as
 * missing_from_source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  structuredInstrumentToDraft,
} from "./aiResearchService";
import {
  getCatalogueFieldContract,
  projectContractFiguresToExtendedFields,
  projectFindingToContractFigures,
} from "../shared/catalogueFieldContracts";
import { MISSING_FROM_SOURCE } from "../shared/instrumentProfile";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const SACCO_SOURCE = `Test SACCO Product (Stage 10b-3c QA)

SACCO name: Test Umoja SACCO
Product type: Member deposits
Dividend / interest rate: 12.00%
Minimum share capital: KES 10,000
Minimum monthly contribution: KES 1,000
Membership requirement: Must be an active member with ID and registration
Withdrawal terms: 60 days notice
Fees / charges: Joining fee KES 500
Liquidity: Low liquidity; member deposits withdrawable after notice and subject to SACCO by-laws
Risk / protection note: Regulated SACCO product; member risk applies
As of: 17 July 2026`;

const REIT_SOURCE = `Test REIT Product (Stage 10b-3c QA)

REIT name: Test Income REIT
REIT type: Income REIT
Unit price: KES 20.00
Distribution yield: 8.50%
Recent distribution: KES 1.70 per unit
NAV: KES 21.50 per unit
Occupancy: 92%
Minimum investment: KES 10,000
Liquidity / tradability: Listed and tradable on the Nairobi Securities Exchange, but actual exit speed depends on buyer demand and market activity
Risk level: Medium-high
As of: 17 July 2026`;

function strictSchemaNoise() {
  return {
    ticker: MISSING_FROM_SOURCE,
    dividendYield: MISSING_FROM_SOURCE,
    trailingReturn: MISSING_FROM_SOURCE,
    fee: MISSING_FROM_SOURCE,
    fxRisk: MISSING_FROM_SOURCE,
    membershipRequirement: MISSING_FROM_SOURCE,
    minimumShareCapital: MISSING_FROM_SOURCE,
  };
}

describe("Stage 10b-3d · SACCO product type source-grounded fallback", () => {
  it("auto-populates an explicit Product type source line when the structured model missed it", () => {
    const draft = structuredInstrumentToDraft(
      {
        instrumentName: "Test Umoja SACCO",
        assetType: "sacco",
        productType: MISSING_FROM_SOURCE,
        shareCapitalDividendRate: "12.00%",
        minimumShareCapital: "KES 10,000",
        minimumMonthlyDeposit: "KES 1,000",
        membershipRequirement: "Must be an active member with ID and registration",
        withdrawalTerms: "60 days notice",
        fees: "Joining fee KES 500",
        liquidity: "Low liquidity; member deposits withdrawable after notice and subject to SACCO by-laws",
        regulatoryStatus: "Regulated SACCO product; member risk applies",
        confidence: 0.95,
      },
      "market_asset_factsheet",
      { asOfDate: "17 July 2026" },
      SACCO_SOURCE,
    )!;

    expect(draft.extractedFields.productType).toBe("Member deposits");
    const contract = getCatalogueFieldContract("market_asset", "sacco")!;
    const figures = projectFindingToContractFigures(contract, draft);
    expect(figures.productType).toBe("Member deposits");
    expect(projectContractFiguresToExtendedFields("market_asset", "sacco", figures).productType)
      .toBe("Member deposits");
  });
});

describe("Stage 10b-3d · REIT NAV and subtype-aware finding quality", () => {
  const draft = structuredInstrumentToDraft(
    {
      instrumentName: "Test Income REIT",
      assetType: "reit",
      exchange: "Nairobi Securities Exchange",
      marketPrice: "KES 20.00",
      distributionYield: "8.50%",
      recentDistribution: "KES 1.70 per unit",
      nav: "KES 21.50 per unit",
      occupancyRate: "92%",
      minInvestment: "KES 10,000",
      liquidity: "Listed and tradable on the Nairobi Securities Exchange, but actual exit speed depends on buyer demand and market activity",
      riskLevel: "Medium-high",
      currency: "KES",
      confidence: 0.92,
      ...strictSchemaNoise(),
    },
    "market_asset_factsheet",
    { asOfDate: "17 July 2026" },
    REIT_SOURCE,
  )!;

  it("keeps model-reported confidence and excludes irrelevant other-subtype sentinels from missing fields", () => {
    expect(draft.confidence).toBe(0.92);
    expect(draft.missingFields).toEqual([]);
    for (const irrelevant of ["ticker", "dividendYield", "trailingReturn", "fee", "fxRisk", "minimumShareCapital"]) {
      expect(draft.missingFields).not.toContain(irrelevant);
    }
  });

  it("preserves NAV verbatim through contract projection and promotion extended fields", () => {
    const contract = getCatalogueFieldContract("market_asset", "reit")!;
    const figures = projectFindingToContractFigures(contract, draft);
    expect(figures.nav).toBe("KES 21.50 per unit");
    expect(projectContractFiguresToExtendedFields("market_asset", "reit", figures).nav)
      .toBe("KES 21.50 per unit");
  });

  it("renders final-table NAV verbatim instead of passing it through the numeric-only price formatter", () => {
    const page = read("client/src/pages/MarketAssetsReference.tsx");
    const start = page.indexOf('if (subtype === "reit")');
    const block = page.slice(start, page.indexOf('if (subtype === "offshore_fund")', start));
    expect(block).toContain('const nav = readField("nav");');
    expect(block).toContain('{nav ?? "—"}');
    expect(block).not.toContain("fmtPrice(nav, r.currency)");
  });
});

describe("Stage 10b-3d · Market Asset generic-preview cleanup", () => {
  it("does not render the generic Instrument Profile Preview when a supported subtype contract block exists", () => {
    const askAi = read("client/src/pages/AskAI.tsx");
    expect(askAi).toContain("const hasMarketAssetContractBlock = Boolean(");
    expect(askAi).toContain("if (hasMarketAssetContractBlock) return null;");
    expect(askAi).toContain("!hasMarketAssetContractBlock");
  });

  it("Offshore structured missing fields ignore Equity/SACCO-only strict-schema sentinels", () => {
    const draft = structuredInstrumentToDraft(
      {
        instrumentName: "Test Global Bond Fund",
        assetType: "offshore_fund",
        fundManager: "Test Global Asset Management",
        exchange: "Luxembourg",
        currency: "USD",
        fundType: "Global bond fund",
        trailingReturn: "8.00%",
        minInvestment: "USD 1,000",
        fee: "1.20%",
        withdrawalPeriod: "T+3 business days",
        fxRisk: "USD-denominated; KES value varies with FX",
        riskLevel: "Medium",
        confidence: 0.9,
        ticker: MISSING_FROM_SOURCE,
        dividendYield: MISSING_FROM_SOURCE,
        membershipRequirement: MISSING_FROM_SOURCE,
        minimumShareCapital: MISSING_FROM_SOURCE,
      },
      "market_asset_factsheet",
      { asOfDate: "17 July 2026" },
      "Fund manager: Test Global Asset Management\nAs of: 17 July 2026",
    )!;
    expect(draft.missingFields).toEqual([]);
    expect(draft.confidence).toBe(0.9);
  });
});
