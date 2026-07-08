/**
 * Stage 3b.4b - SACCO approval-gate replacement rules.
 *
 * SACCO still maps to AssetClass "alt", so the gate must detect it from
 * preserved extraction facts and then replace the generic market/exchange +
 * price/NAV/yield market-asset baseline with SACCO-specific completeness rules.
 */
import { describe, expect, it } from "vitest";
import { missingFieldsForFinding } from "../server/aiResearchService";
import { checkApprovalGate, detectMarketAssetSacco } from "../shared/researchPipeline";

const completeSaccoBase = {
  assetClass: "alt" as const,
  changeKind: "create" as const,
  name: "Example SACCO",
  issuer: "Example SACCO Society",
  currency: "KES",
  source: "Example SACCO annual report",
  asOf: Date.UTC(2026, 5, 30),
};

const completeSaccoFigures = {
  assetType: "sacco",
  shareCapitalDividendRate: "13.5%",
  depositRebateRate: "8.0%",
  minimumShareCapital: "KES 20,000",
  minimumMonthlyDeposit: "KES 1,000 per month",
  regulatoryStatus: "SASRA-regulated deposit-taking SACCO",
  withdrawalTerms: "Deposits withdrawable after 60 days' written notice",
};

function saccoGate(figures: Record<string, unknown>) {
  return checkApprovalGate({ ...completeSaccoBase, figures });
}

describe("Stage 3b.4b - SACCO detection", () => {
  it("detects explicit assetType=sacco", () => {
    expect(
      detectMarketAssetSacco({
        catalogue: "market_asset",
        assetClass: "alt",
        figures: { assetType: "sacco" },
      }),
    ).toBe(true);
  });

  it("is case/spacing tolerant for explicit assetType", () => {
    expect(
      detectMarketAssetSacco({
        catalogue: "market_asset",
        assetClass: "alt",
        figures: { assetType: "  SACCO  " },
      }),
    ).toBe(true);
  });

  it("does not infer SACCO fallback when assetType is an explicit known non-SACCO type", () => {
    const gate = checkApprovalGate({
      ...completeSaccoBase,
      figures: {
        ...completeSaccoFigures,
        assetType: "etf",
      },
    });

    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("market");
    expect(gate.missing).toContain("price / NAV / yield / return");
    expect(gate.missing).not.toContain("minimum share capital");
  });

  it("does not infer SACCO from name/issuer alone when a generic alt has market and price", () => {
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      name: "Example Sacco",
      issuer: "Example Sacco",
      currency: "KES",
      source: "Example sacco statement",
      asOf: Date.UTC(2026, 5, 30),
      figures: { market: "OTC", lastPrice: "1.00" },
    });

    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("supports conservative fallback from SACCO/SASRA wording when no contradictory assetType exists", () => {
    const gate = checkApprovalGate({
      ...completeSaccoBase,
      figures: {
        ...completeSaccoFigures,
        assetType: undefined,
      },
    });

    expect(gate.ok).toBe(true);
  });

  it("supports conservative fallback from a real SACCO-specific value, not from keys alone", () => {
    expect(
      detectMarketAssetSacco({
        catalogue: "market_asset",
        assetClass: "alt",
        figures: { minimumShareCapital: "KES 20,000" },
      }),
    ).toBe(true);

    expect(
      detectMarketAssetSacco({
        catalogue: "market_asset",
        assetClass: "alt",
        figures: {
          shareCapitalDividendRate: "missing_from_source",
          depositRebateRate: "missing_from_source",
          minimumShareCapital: "missing_from_source",
          minimumMonthlyDeposit: "missing_from_source",
          regulatoryStatus: "missing_from_source",
          withdrawalTerms: "missing_from_source",
        },
      }),
    ).toBe(false);
  });
});

describe("Stage 3b.4b - SACCO replacement gate", () => {
  it("passes with no market/exchange and no price/NAV/yield/return when SACCO requirements are met", () => {
    const gate = saccoGate(completeSaccoFigures);
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("allows dividend-only economic return", () => {
    const figures: Record<string, unknown> = { ...completeSaccoFigures };
    delete figures.depositRebateRate;
    const gate = saccoGate(figures);
    expect(gate.ok).toBe(true);
  });

  it("allows rebate-only economic return", () => {
    const figures: Record<string, unknown> = { ...completeSaccoFigures };
    delete figures.shareCapitalDividendRate;
    const gate = saccoGate(figures);
    expect(gate.ok).toBe(true);
  });

  it("blocks when neither dividend nor rebate is present", () => {
    const figures: Record<string, unknown> = { ...completeSaccoFigures };
    delete figures.shareCapitalDividendRate;
    delete figures.depositRebateRate;
    const gate = saccoGate(figures);
    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("share-capital dividend rate or deposit rebate / interest rate");
  });

  it("blocks missing SACCO hard fields", () => {
    const cases: Array<[string, keyof typeof completeSaccoFigures]> = [
      ["minimum share capital", "minimumShareCapital"],
      ["minimum monthly deposit / contribution", "minimumMonthlyDeposit"],
      ["SASRA / regulatory status", "regulatoryStatus"],
      ["withdrawal / liquidity terms", "withdrawalTerms"],
    ];

    for (const [label, key] of cases) {
      const figures: Record<string, unknown> = { ...completeSaccoFigures };
      delete figures[key];
      const gate = saccoGate(figures);
      expect(gate.ok).toBe(false);
      expect(gate.missing).toContain(label);
    }
  });

  it("does not let missing_from_source or generic unavailable values satisfy SACCO hard fields", () => {
    const gate = saccoGate({
      assetType: "sacco",
      shareCapitalDividendRate: "missing_from_source",
      depositRebateRate: "not available",
      minimumShareCapital: "missing_from_source",
      minimumMonthlyDeposit: "unavailable",
      regulatoryStatus: "not disclosed",
      withdrawalTerms: "n/a",
    });

    expect(gate.ok).toBe(false);
    expect(gate.missing).toEqual(
      expect.arrayContaining([
        "minimum share capital",
        "minimum monthly deposit / contribution",
        "SASRA / regulatory status",
        "withdrawal / liquidity terms",
        "share-capital dividend rate or deposit rebate / interest rate",
      ]),
    );
  });

  it("keeps the edit exemption unchanged", () => {
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "edit",
      figures: { assetType: "sacco" },
    });

    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });
});

describe("Stage 3b.4b - non-SACCO behavior remains unchanged", () => {
  it("keeps non-SACCO alt behavior unchanged", () => {
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      name: "Example Property Fund",
      issuer: "Example Manager",
      currency: "KES",
      source: "Example factsheet",
      asOf: Date.UTC(2026, 5, 30),
      figures: {
        assetType: "property",
        market: "NSE",
        lastPrice: "12.50",
        shareCapitalDividendRate: "missing_from_source",
        depositRebateRate: "missing_from_source",
        minimumShareCapital: "missing_from_source",
        minimumMonthlyDeposit: "missing_from_source",
        regulatoryStatus: "missing_from_source",
        withdrawalTerms: "missing_from_source",
      },
    });

    expect(gate.ok).toBe(true);
  });

  it("still applies the generic market-asset gate to non-SACCO alt", () => {
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      name: "Example Property Fund",
      issuer: "Example Manager",
      currency: "KES",
      source: "Example factsheet",
      asOf: Date.UTC(2026, 5, 30),
      figures: { assetType: "property" },
    });

    expect(gate.ok).toBe(false);
    expect(gate.missing).toContain("market");
    expect(gate.missing).toContain("price / NAV / yield / return");
  });
});

describe("Stage 3b.4b - finding preview agrees with the approval gate", () => {
  it("missingFieldsForFinding reports SACCO gaps instead of generic market/price gaps", () => {
    const missing = missingFieldsForFinding(
      "market_asset",
      {
        assetType: "sacco",
        minimumShareCapital: "KES 20,000",
        minimumMonthlyDeposit: "KES 1,000 per month",
        regulatoryStatus: "SASRA-regulated deposit-taking SACCO",
        withdrawalTerms: "60 days' notice",
      },
      {
        name: "Example SACCO",
        issuer: "Example SACCO Society",
        currency: "KES",
        source: "Example SACCO annual report",
        asOf: Date.UTC(2026, 5, 30),
        assetClass: "alt",
      },
    );

    expect(missing).toContain("share-capital dividend rate or deposit rebate / interest rate");
    expect(missing).not.toContain("market");
    expect(missing).not.toContain("price / NAV / yield / return");
  });
});
