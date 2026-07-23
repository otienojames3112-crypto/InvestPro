/**
 * Stage 10b-3 — Market Assets (Equity/REIT/Offshore fund/SACCO) end-to-end
 * field parity.
 *
 * Applies the same product philosophy Bank (10b-1/10b-1b) and CBK (10b-2/
 * 10b-2b) already went through to all four active market-asset subtypes at
 * once: established catalogue fields as explicit per-subtype table columns
 * (no more one generic price/yield/trailing-return/fee shape forced onto
 * Equity/REIT/Offshore fund), a multi-field edit path before approval, clean
 * labels (no raw enum/camelCase) in every correction/edit surface, and closed
 * extraction/gate gaps so a real market-asset source actually reaches the
 * catalogue intact.
 *
 * The audit found FOUR gaps, not a rebuild (contracts/gate/promotion for all
 * four subtypes already existed since Slices 8e-1..8e-4):
 *   1. A structural "issuer / manager" gate block — MARKET_ASSET_EXTRACTION_
 *      SCHEMA had NO manager/issuer concept at all, so finding.issuer was
 *      ALWAYS null for every AI-originated market-asset finding (documented,
 *      deferred out-of-scope in every 8e-* slice's own file header). Fixed by
 *      (a) adding a real `fundManager` extraction field for offshore funds,
 *      which genuinely have a distinct manager, and (b) falling back to the
 *      instrument's own name for equity/REIT/SACCO, which don't.
 *   2. No source-wide as-of-date bridge (the same gap class already fixed for
 *      MMF/Bank/CBK) — a source's stated "As of: ..." date was captured
 *      nowhere, so sourceAsOf always fell through to null regardless of what
 *      the source said.
 *   3. 16 established fields across the 4 subtypes were marked
 *      missingRequiresMigration despite `opportunities.extendedFields`
 *      already having a JSON home for them (same precedent as Bank's fees/
 *      accessSpeed in Stage 10b-1b) — migrated to the extendedFields tier.
 *   4. Multi-field edit (EditCatalogueFieldsDialog) and the one-field
 *      "Correct a figure" dropdown (CorrectFigureDialog) didn't support
 *      market assets at all; MarketAssetsReference.tsx forced Equity/REIT/
 *      Offshore fund into one generic table (SACCO already had its own since
 *      Stage 9c) — redesigned into 4 tabs, each with its own explicit-column
 *      table built from the same per-subtype contract every other display
 *      layer already uses.
 *
 * Five layers of test (established convention — no jsdom in this repo):
 *   A. Pure — the issuer fallback fix, via structuredInstrumentToDraft directly.
 *   B. Pure — the asOfDate bridge, via structuredInstrumentToDraft directly.
 *   C. Pure — the user's Equity QA fixture, and synthesized REIT/Offshore
 *      fund/SACCO fixtures (matching the same standard), extraction through
 *      contract-projection through gate through promotion plan.
 *   D. Static source-text scan — schema, contract, and UI wiring.
 *   E. Full edit → approve → published-row path via the real tRPC caller —
 *      requires DATABASE_URL, `describe.skipIf`'d out otherwise.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getCatalogueFieldContract,
  projectFindingToContractFigures,
  projectFindingToContractDisplayRows,
  type ProjectableFinding,
} from "../shared/catalogueFieldContracts";
import { checkApprovalGate, buildPromotionPlan } from "../shared/researchPipeline";
import { structuredInstrumentToDraft } from "./aiResearchService";
import type { SourceClass } from "../shared/instrumentProfile";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const hasDb = Boolean(process.env.DATABASE_URL);

type AuthedUser = NonNullable<TrpcContext["user"]>;
function ctxFor(role: "admin" | "user"): TrpcContext {
  const user: AuthedUser = {
    id: role === "admin" ? 1 : 2,
    openId: `sample-${role}`,
    email: `${role}@example.com`,
    name: role === "admin" ? "Admin Person" : "Plain User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const SC: SourceClass = "market_asset_factsheet";

// ── A. the issuer fallback fix, via structuredInstrumentToDraft directly ────

describe("Stage 10b-3 · A — market-asset findings no longer have a structurally-unsatisfiable issuer gap", () => {
  it("Equity: issuer falls back to the instrument's own name when no fundManager/bankName is present", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "Test Safaricom PLC", assetType: "equity", marketPrice: "25.50" },
      SC,
    );
    expect(draft?.issuer).toBe("Test Safaricom PLC");
  });

  it("REIT: issuer falls back to the instrument's own name", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "Acorn Income REIT", assetType: "reit", marketPrice: "20.00" },
      SC,
    );
    expect(draft?.issuer).toBe("Acorn Income REIT");
  });

  it("SACCO: issuer falls back to the instrument's own name", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "Stima SACCO", assetType: "sacco", shareCapitalDividendRate: "12%" },
      SC,
    );
    expect(draft?.issuer).toBe("Stima SACCO");
  });

  it("Offshore fund: a genuine fundManager value WINS over the name fallback — the fix never masks a real, separately-extracted manager", () => {
    const draft = structuredInstrumentToDraft(
      {
        instrumentName: "Franklin Templeton Global Bond Fund",
        assetType: "offshore_fund",
        fundManager: "Franklin Templeton",
        trailingReturn: "8.0",
      },
      SC,
    );
    expect(draft?.issuer).toBe("Franklin Templeton");
  });

  it("non-market-asset catalogues are unaffected by the fallback — a bare CBK finding with no bankName/fundManager still gets issuer: null", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "FXD1/2026/010", securityType: "fxd", yieldPct: "13.2" },
      "cbk_bond_prospectus",
    );
    expect(draft?.issuer).toBeNull();
  });

  it("control: checkApprovalGate now passes the issuer requirement using ONLY the fallback issuer — proving the fix actually closes the gate gap end to end, not just the draft-level field", () => {
    const draft = structuredInstrumentToDraft(
      {
        instrumentName: "Test Safaricom PLC",
        assetType: "equity",
        ticker: "TSCOM",
        exchange: "Nairobi Securities Exchange",
        marketPrice: "25.50",
        dividendYield: "6.00",
      },
      SC,
    )!;
    const equityContract = getCatalogueFieldContract("market_asset", "equity")!;
    const figures = projectFindingToContractFigures(equityContract, draft);
    const gate = checkApprovalGate({
      assetClass: "equity",
      changeKind: "create",
      figures,
      name: draft.instrumentName,
      issuer: draft.issuer,
      currency: draft.currency,
      source: "Manually entered for Stage 10b-3 QA testing — not a live market source.",
      asOf: Date.now(),
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });
});

// ── B. the asOfDate bridge, via structuredInstrumentToDraft directly ───────

describe("Stage 10b-3 · B — market-asset findings now carry a real sourceAsOf, bridged from the source-wide asOfDate", () => {
  it("a stated asOfDate (sharedFields, matching runStructuredExtraction's own generic collection) bridges to sourceAsOf", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "Test Safaricom PLC", assetType: "equity", marketPrice: "25.50" },
      SC,
      { asOfDate: "2026-07-17" },
    );
    expect(draft?.sourceAsOf).toBe("2026-07-17");
  });

  it("a missing_from_source or blank asOfDate never bridges — sourceAsOf stays null, not a fabricated string", () => {
    const missing = structuredInstrumentToDraft(
      { instrumentName: "Test Safaricom PLC", assetType: "equity", marketPrice: "25.50" },
      SC,
      { asOfDate: "missing_from_source" },
    );
    expect(missing?.sourceAsOf).toBeNull();
    const blank = structuredInstrumentToDraft(
      { instrumentName: "Test Safaricom PLC", assetType: "equity", marketPrice: "25.50" },
      SC,
      { asOfDate: "   " },
    );
    expect(blank?.sourceAsOf).toBeNull();
  });

  it("the bridge is scoped to market_asset only — a bare CBK draft with the same sharedFields.asOfDate is unaffected by it (CBK has its own, different auctionDate-based bridge)", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "FXD1/2026/010", securityType: "fxd", yieldPct: "13.2" },
      "cbk_bond_prospectus",
      { asOfDate: "2026-07-17" },
    );
    expect(draft?.sourceAsOf).toBeNull();
  });
});

// ── C. QA fixtures — extraction through contract-projection through gate through promotion ──

describe("Stage 10b-3 · C — the user's Equity QA fixture, end to end", () => {
  // Test NSE Equity (Stage 10b-3 QA)
  //
  // Company name: Test Safaricom PLC
  // Ticker: TSCOM
  // Exchange: Nairobi Securities Exchange
  // Current price: KES 25.50
  // Dividend yield: 6.00%
  // Recent dividend: KES 1.50 per share
  // Price change: +2.00% today
  // Market sector: Telecommunications
  // Minimum buy / board lot: 100 shares
  // Liquidity / trading: High liquidity, actively traded
  // Risk level: Medium
  // As of: 17 July 2026
  // Source: Manually entered for Stage 10b-3 QA testing — not a live market source.
  const rawEquity = {
    instrumentName: "Test Safaricom PLC",
    assetType: "equity",
    ticker: "TSCOM",
    exchange: "Nairobi Securities Exchange",
    marketPrice: "KES 25.50",
    dividendYield: "6.00%",
    recentDividend: "KES 1.50 per share",
    priceChange: "+2.00% today",
    marketSector: "Telecommunications",
    minBuyAmount: "100 shares",
    liquidity: "High liquidity, actively traded",
    riskLevel: "Medium",
  };
  const draft = structuredInstrumentToDraft(rawEquity, SC, { asOfDate: "17 July 2026" })!;
  const equityContract = getCatalogueFieldContract("market_asset", "equity")!;

  it("the draft carries the fallback issuer and the bridged sourceAsOf (Stage 10b-3b: normalized to YYYY-MM-DD)", () => {
    expect(draft.issuer).toBe("Test Safaricom PLC");
    expect(draft.sourceAsOf).toBe("2026-07-17");
  });

  it("every established Equity field the fixture states projects through the contract under its canonical key, including the 5 fields Stage 10b-3 moved to extendedFields", () => {
    const figures = projectFindingToContractFigures(equityContract, draft);
    expect(figures.ticker).toBe("TSCOM");
    expect(figures.market).toBe("Nairobi Securities Exchange");
    expect(figures.lastPrice).toBe("KES 25.50");
    expect(figures.yieldPct).toBe("6.00%");
    expect(figures.recentDividend).toBe("KES 1.50 per share");
    expect(figures.priceChange).toBe("+2.00% today");
    expect(figures.marketSector).toBe("Telecommunications");
    expect(figures.minBuyAmount).toBe("100 shares");
    expect(figures.liquidity).toBe("High liquidity, actively traded");
    expect(figures.riskLevel).toBe("Medium");
  });

  it("checkApprovalGate passes cleanly — every established field, plus the issuer fallback, is genuinely gate-compatible", () => {
    const figures = projectFindingToContractFigures(equityContract, draft);
    const gate = checkApprovalGate({
      assetClass: "equity",
      changeKind: "create",
      figures,
      name: draft.instrumentName,
      issuer: draft.issuer,
      currency: draft.currency,
      source: "Manually entered for Stage 10b-3 QA testing — not a live market source.",
      asOf: Date.parse("2026-07-17"),
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
  });

  it("buildPromotionPlan correctly maps the typed-column figures (market/lastPrice/yieldPct/liquidity) onto the opportunities payload", () => {
    const figures = projectFindingToContractFigures(equityContract, draft);
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: draft.instrumentName,
      assetClass: "equity",
      issuer: draft.issuer,
      figures,
      source: "Manually entered for Stage 10b-3 QA testing — not a live market source.",
    });
    expect(plan.target).toBe("opportunity");
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.name).toBe("Test Safaricom PLC");
    expect(plan.payload.market).toBe("Nairobi Securities Exchange");
    expect(plan.payload.lastPrice).toBeCloseTo(25.5);
    expect(plan.payload.yieldPct).toBeCloseTo(6.0);
    expect(plan.payload.liquidity).toBe("High liquidity, actively traded");
  });
});

describe("Stage 10b-3 · C — synthesized REIT/Offshore fund/SACCO QA fixtures (matching the same standard the user's Equity fixture set)", () => {
  it("REIT — extraction through gate through promotion, including the distributionYield alsoWriteKeys dual-write", () => {
    const raw = {
      instrumentName: "Test Acorn Income REIT (Stage 10b-3 QA)",
      assetType: "reit",
      exchange: "Nairobi Securities Exchange",
      marketPrice: "KES 20.00",
      distributionYield: "8.50%",
      recentDistribution: "KES 0.80 per unit",
      nav: "KES 21.10",
      occupancyRate: "94%",
      minInvestment: "100 units",
      liquidity: "Moderate liquidity",
      riskLevel: "Medium",
    };
    const draft = structuredInstrumentToDraft(raw, SC, { asOfDate: "17 July 2026" })!;
    expect(draft.issuer).toBe("Test Acorn Income REIT (Stage 10b-3 QA)");
    expect(draft.sourceAsOf).toBe("2026-07-17"); // Stage 10b-3b: bridge normalizes human dates

    const reitContract = getCatalogueFieldContract("market_asset", "reit")!;
    const figures = projectFindingToContractFigures(reitContract, draft);
    expect(figures.lastPrice).toBe("KES 20.00");
    expect(figures.distributionYield).toBe("8.50%");
    expect(figures.yieldPct).toBe("8.50%"); // alsoWriteKeys duplicate
    expect(figures.recentDistribution).toBe("KES 0.80 per unit");
    expect(figures.occupancyRate).toBe("94%");
    expect(figures.minInvestment).toBe("100 units");
    expect(figures.riskLevel).toBe("Medium");

    const gate = checkApprovalGate({
      assetClass: "reit",
      changeKind: "create",
      figures,
      name: draft.instrumentName,
      issuer: draft.issuer,
      currency: draft.currency,
      source: "Manually entered for Stage 10b-3 QA testing — not a live market source.",
      asOf: Date.parse("2026-07-17"),
    });
    expect(gate.ok).toBe(true);

    const plan = buildPromotionPlan({
      target: "opportunity",
      name: draft.instrumentName,
      assetClass: "reit",
      issuer: draft.issuer,
      figures,
      source: "Manually entered for Stage 10b-3 QA testing — not a live market source.",
    });
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.lastPrice).toBeCloseTo(20.0);
    expect(plan.payload.yieldPct).toBeCloseTo(8.5);
  });

  it("Offshore fund — extraction through gate through promotion, including the genuine fundManager (not the name fallback) and the currency-must-not-be-KES check", () => {
    const raw = {
      instrumentName: "Test Franklin Templeton Global Bond Fund (Stage 10b-3 QA)",
      assetType: "offshore_fund",
      fundManager: "Franklin Templeton Investments",
      fundType: "Global bond fund",
      exchange: "Luxembourg Stock Exchange",
      currency: "USD",
      trailingReturn: "8.00%",
      minInvestment: "USD 1,000",
      fee: "1.20%",
      withdrawalPeriod: "T+3 business days",
      fxRisk: "USD-denominated; KES depreciation increases KES-value returns",
      riskLevel: "Medium",
    };
    const draft = structuredInstrumentToDraft(raw, SC, { asOfDate: "17 July 2026" })!;
    expect(draft.issuer).toBe("Franklin Templeton Investments");
    expect(draft.currency).toBe("USD");

    const offshoreContract = getCatalogueFieldContract("market_asset", "offshore_fund")!;
    const figures = projectFindingToContractFigures(offshoreContract, draft);
    expect(figures.trailingReturnPct).toBe("8.00%");
    expect(figures.expenseRatioPct).toBe("1.20%");
    expect(figures.fundType).toBe("Global bond fund");
    expect(figures.minInvestment).toBe("USD 1,000");
    expect(figures.withdrawalPeriod).toBe("T+3 business days");
    expect(figures.riskLevel).toBe("Medium");

    const gate = checkApprovalGate({
      assetClass: "offshore_fund",
      changeKind: "create",
      figures,
      name: draft.instrumentName,
      issuer: draft.issuer,
      currency: draft.currency,
      source: "Manually entered for Stage 10b-3 QA testing — not a live market source.",
      asOf: Date.parse("2026-07-17"),
    });
    expect(gate.ok).toBe(true);

    const plan = buildPromotionPlan({
      target: "opportunity",
      name: draft.instrumentName,
      assetClass: "offshore_fund",
      issuer: draft.issuer,
      currency: draft.currency,
      figures,
      source: "Manually entered for Stage 10b-3 QA testing — not a live market source.",
    });
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.currency).toBe("USD");
    expect(plan.payload.trailingReturnPct).toBeCloseTo(8.0);
    expect(plan.payload.expenseRatioPct).toBeCloseTo(1.2);
  });

  it("SACCO — extraction through the SACCO replacement gate through promotion, including the assetType stamp detectMarketAssetSacco relies on", () => {
    const raw = {
      instrumentName: "Test Stima SACCO (Stage 10b-3 QA)",
      assetType: "sacco",
      shareCapitalDividendRate: "12%",
      minimumShareCapital: "KES 5,000",
      minimumMonthlyDeposit: "KES 500",
      membershipRequirement: "Must be a Kenya Power employee or family member",
      withdrawalTerms: "30-day notice",
      fees: "KES 200 annual",
      liquidity: "Monthly withdrawal window",
      regulatoryStatus: "SASRA-regulated",
    };
    const draft = structuredInstrumentToDraft(raw, SC, { asOfDate: "17 July 2026" })!;
    expect(draft.issuer).toBe("Test Stima SACCO (Stage 10b-3 QA)");
    expect(draft.assetClass).toBe("alt");

    const saccoContract = getCatalogueFieldContract("market_asset", "sacco")!;
    const figures = projectFindingToContractFigures(saccoContract, draft);
    expect(figures.assetType).toBe("sacco");
    expect(figures.dividendRate).toBe("12%");
    expect(figures.minimumShareCapital).toBe("KES 5,000");
    expect(figures.minimumMonthlyDeposit).toBe("KES 500");
    expect(figures.membershipRequirement).toBe("Must be a Kenya Power employee or family member");
    expect(figures.withdrawalTerms).toBe("30-day notice");
    expect(figures.fees).toBe("KES 200 annual");
    expect(figures.regulatoryStatus).toBe("SASRA-regulated");

    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      figures,
      name: draft.instrumentName,
      issuer: draft.issuer,
      currency: draft.currency,
      source: "Manually entered for Stage 10b-3 QA testing — not a live market source.",
      asOf: Date.parse("2026-07-17"),
    });
    expect(gate.ok).toBe(true);

    const plan = buildPromotionPlan({
      target: "opportunity",
      name: draft.instrumentName,
      assetClass: "alt",
      issuer: draft.issuer,
      figures,
      source: "Manually entered for Stage 10b-3 QA testing — not a live market source.",
    });
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.liquidity).toBe("Monthly withdrawal window");
    // No market/lastPrice/yieldPct — the SACCO replacement gate has no such requirement.
    expect(plan.payload.market).toBeNull();
    expect(plan.payload.lastPrice).toBeNull();
  });
});

// ── D. Static source-text scan — schema, contract, and UI wiring ──────────

describe("Stage 10b-3 · D — MARKET_ASSET_EXTRACTION_SCHEMA carries every established field this stage added", () => {
  const aiService = read("server/aiResearchService.ts");

  it("the schema gained a top-level asOfDate bridge field, mirroring Bank's own", () => {
    const idx = aiService.indexOf("const MARKET_ASSET_EXTRACTION_SCHEMA");
    const block = aiService.slice(idx, aiService.indexOf("required: [\"answer\", \"asOfDate\", \"instruments\"]", idx) + 60);
    expect(block).toContain("asOfDate: { type:");
    expect(block).toContain('required: ["answer", "asOfDate", "instruments"]');
  });

  it("every per-instrument field this stage added is present in the schema, per subtype", () => {
    const idx = aiService.indexOf("const MARKET_ASSET_EXTRACTION_SCHEMA");
    const block = aiService.slice(idx, aiService.indexOf("extractionSchemaForClass", idx));
    for (const key of [
      "recentDividend",
      "priceChange",
      "marketSector",
      "minBuyAmount",
      "riskLevel",
      "reitType",
      "recentDistribution",
      "occupancyRate",
      "minInvestment",
      "fundManager",
      "fundType",
      "withdrawalPeriod",
      "fxRisk",
      "membershipRequirement",
      "fees",
    ]) {
      expect(block).toContain(`${key}:`);
    }
  });

  it("the market_asset_factsheet/market_asset_price prompt describes per-subtype extraction instructions and the asOfDate bridge", () => {
    const idx = aiService.indexOf('case "market_asset_factsheet":');
    const block = aiService.slice(idx, idx + 2500);
    expect(block).toContain("For EQUITY entries");
    expect(block).toContain("For REIT entries");
    expect(block).toContain("For OFFSHORE FUND entries");
    expect(block).toContain("For SACCO entries");
    expect(block).toContain("asOfDate");
  });

  it("the issuer fallback and marketAssetSourceAsOf bridge are present in structuredInstrumentToDraft, scoped to targetCatalogue === \"market_asset\"", () => {
    expect(aiService).toContain('const marketAssetSourceAsOf =');
    expect(aiService).toContain('targetCatalogue === "market_asset" &&');
    expect(aiService).toContain('typeof raw.fundManager === "string"');
    expect(aiService).toContain('targetCatalogue === "market_asset"');
    expect(aiService).toContain("? name");
  });
});

describe("Stage 10b-3 · D — shared/catalogueFieldContracts.ts: 16 fields migrated to extendedFields, none left missingRequiresMigration", () => {
  const migrated: Array<{ subtype: "equity" | "reit" | "offshore_fund" | "sacco"; key: string }> = [
    { subtype: "equity", key: "recentDividend" },
    { subtype: "equity", key: "priceChange" },
    { subtype: "equity", key: "marketSector" },
    { subtype: "equity", key: "minBuyAmount" },
    { subtype: "equity", key: "riskLevel" },
    { subtype: "reit", key: "reitType" },
    { subtype: "reit", key: "recentDistribution" },
    { subtype: "reit", key: "occupancyRate" },
    { subtype: "reit", key: "minInvestment" },
    { subtype: "reit", key: "riskLevel" },
    { subtype: "offshore_fund", key: "fundType" },
    { subtype: "offshore_fund", key: "minInvestment" },
    { subtype: "offshore_fund", key: "withdrawalPeriod" },
    { subtype: "offshore_fund", key: "riskLevel" },
    { subtype: "sacco", key: "membershipRequirement" },
    { subtype: "sacco", key: "fees" },
  ];

  for (const { subtype, key } of migrated) {
    it(`market_asset/${subtype}.${key} is now storageStatus: "extendedFields", managerEditable, with a Stage 10b-3 note`, () => {
      const field = getCatalogueFieldContract("market_asset", subtype)!.fields.find((f) => f.key === key)!;
      expect(field.storageStatus).toBe("extendedFields");
      expect(field.managerEditable).toBe(true);
      expect(field.aliases).toContain(key);
      expect(field.note).toContain("Stage 10b-3");
    });
  }

  it("fundManager (offshore fund) was already correctly configured before this stage — no change needed (it's envelope-routed to `issuer`, not a figures-tier field)", () => {
    const field = getCatalogueFieldContract("market_asset", "offshore_fund")!.fields.find((f) => f.key === "fundManager")!;
    expect(field.storageStatus).toBe("column");
  });
});

describe("Stage 10b-3 · D — ResearchDesk.tsx: multi-field edit path extended to market assets", () => {
  const researchDeskPage = read("client/src/pages/ResearchDesk.tsx");

  it("EditCatalogueFieldsDialog resolves catalogue/subtype via resolveContractCatalogueForUpdate, supporting market_asset alongside mmf/bank/cbk", () => {
    expect(researchDeskPage).toContain("resolveContractCatalogueForUpdate(");
    expect(researchDeskPage).toContain('catalogue === "market_asset" && subtype !== undefined');
  });

  it("both Edit fields entry points (pending card + approval modal) are gated to include market_asset", () => {
    expect(researchDeskPage).toContain('data?.catalogue === "market_asset"');
    expect(researchDeskPage).toContain('contract.catalogue === "market_asset"');
  });

  it("ENVELOPE_KEYS_BY_CATALOGUE carries a market_asset entry routing name/issuer/currency/source/asOf correctly", () => {
    const idx = researchDeskPage.indexOf("ENVELOPE_KEYS_BY_CATALOGUE");
    const block = researchDeskPage.slice(idx, idx + 1500);
    expect(block).toContain("market_asset:");
    expect(block).toContain('fundManager: "issuer"');
    expect(block).toContain('currency: "currency"');
  });
});

describe("Stage 10b-3 · D — AskAI.tsx: CorrectFigureDialog generalized to all four market-asset subtypes", () => {
  const askAi = read("client/src/pages/AskAI.tsx");
  const dialogIdx = askAi.indexOf("function CorrectFigureDialog(");
  const dialog = askAi.slice(dialogIdx, askAi.indexOf("function ", dialogIdx + 30));

  it("resolves a market-asset subtype from assetClass (equity/reit/offshore_fund) or the raw assetType signal (sacco), mirroring the file's own existing SACCO-detection pattern", () => {
    expect(dialog).toContain("correctionMarketAssetSubtype");
    expect(dialog).toContain('String(finding.extractedFields?.assetType ?? "").trim().toLowerCase() === "sacco"');
  });

  it("resolves the contract via literal per-subtype getCatalogueFieldContract calls (not a single variable-parameterized call) — keeps every call statically greppable", () => {
    expect(dialog).toContain('getCatalogueFieldContract("market_asset", "equity")');
    expect(dialog).toContain('getCatalogueFieldContract("market_asset", "reit")');
    expect(dialog).toContain('getCatalogueFieldContract("market_asset", "offshore_fund")');
    expect(dialog).toContain('getCatalogueFieldContract("market_asset", "sacco")');
  });

  it("Stage 10b-3e extends the same contract-driven correction form to MMF and Bank", () => {
    expect(dialog).toContain('getCatalogueFieldContract("mmf")');
    expect(dialog).toContain('getCatalogueFieldContract("bank")');
    expect(dialog).toContain("projectFindingToContractDisplayRows");
  });
});

describe("Stage 10b-3 · D — MarketAssetsReference.tsx: 4-tab, per-subtype table redesign", () => {
  const marketAssetsPage = read("client/src/pages/MarketAssetsReference.tsx");

  it("renders 4 tabs (equity/reit/offshore_fund/sacco), each with its own SubtypeTable fed from its own filtered bucket", () => {
    expect(marketAssetsPage).toContain('<TabsTrigger value="equity">Equity');
    expect(marketAssetsPage).toContain('<TabsTrigger value="reit">REIT');
    expect(marketAssetsPage).toContain('<TabsTrigger value="offshore_fund">Offshore funds');
    expect(marketAssetsPage).toContain('<TabsTrigger value="sacco">SACCO');
  });

  it("every subtype table resolves its columns/labels from the SAME per-subtype contract every other display layer (Ask AI, review queue, approval modal, edit dialog) already uses — never a second, hand-typed field list", () => {
    expect(marketAssetsPage).toContain('getCatalogueFieldContract("market_asset", subtype)');
  });
});

// ── E. Full edit → approve → published-row path (requires DATABASE_URL) ────

describe.skipIf(!hasDb)("Stage 10b-3 · E — the Equity QA fixture round-trips through the real DB (requires DATABASE_URL)", () => {
  const TEST_REF = `zz-stage10b3-equity-${Date.now()}`;

  afterAll(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(schema.opportunities).set({ active: false }).where(eq(schema.opportunities.ref, TEST_REF));
  });

  it("a pending Equity update carrying the full QA scenario — including a post-draft price edit via updatePendingFields — approves cleanly and publishes every field correctly", async () => {
    const { enqueueResearchUpdate } = await import("./db");
    const pendingId = await enqueueResearchUpdate({
      targetRef: TEST_REF,
      changeKind: "create",
      name: "Test Safaricom PLC (Stage 10b-3 QA)",
      assetClass: "equity",
      currency: "KES",
      figures: {
        ticker: "TSCOM",
        market: "Nairobi Securities Exchange",
        lastPrice: "25.50",
        yieldPct: "6.00",
        recentDividend: "KES 1.50 per share",
        priceChange: "+2.00% today",
        marketSector: "Telecommunications",
        minBuyAmount: "100 shares",
        liquidity: "High liquidity, actively traded",
        riskLevel: "Medium",
      },
      source: "Manually entered for Stage 10b-3 QA testing — not a live market source.",
      asOf: Date.UTC(2026, 6, 17),
      origin: "manual",
    });
    expect(typeof pendingId).toBe("number");

    const caller = appRouter.createCaller(ctxFor("admin"));

    // The multi-field edit path (updatePendingFields) — now available for market assets.
    const edited = await caller.researchPipeline.updatePendingFields({
      id: pendingId as number,
      figures: { lastPrice: "26.00" },
    });
    expect((edited.update.figures as Record<string, unknown>).lastPrice).toBe("26.00");

    const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
    expect(res.ok).toBe(true);

    const { getDb } = await import("./db");
    const db = await getDb();
    expect(db).toBeTruthy();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [published] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.ref, TEST_REF)).limit(1);
    expect(published).toBeTruthy();
    expect(Number(published.lastPrice)).toBeCloseTo(26.0);
    expect(Number(published.yieldPct)).toBeCloseTo(6.0);
    const ext = published.extendedFields as Record<string, unknown> | null;
    expect(ext?.recentDividend).toBe("KES 1.50 per share");
    expect(ext?.marketSector).toBe("Telecommunications");
    expect(ext?.riskLevel).toBe("Medium");
  });
});
