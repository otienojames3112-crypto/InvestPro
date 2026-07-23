/**
 * Stage 10b-3c — Market Assets subtype promotion parity for SACCO, REIT,
 * and Offshore fund.
 *
 * Pure tests use the exact live SACCO QA fixture that previously reached the
 * review queue but failed field parity, the approval gate, and finally the
 * opportunities insert. The DB-gated test exercises the same governed
 * enqueue -> approve -> opportunities path when DATABASE_URL is available.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getCatalogueFieldContract,
  projectContractFiguresToExtendedFields,
  projectFindingToContractDisplayRows,
  projectFindingToContractFigures,
  type MarketAssetSubtype,
  type ProjectableFinding,
} from "../shared/catalogueFieldContracts";
import { buildPromotionPlan, checkApprovalGate } from "../shared/researchPipeline";
import { findingsToRows, type ResearchFindingDraft } from "./aiResearchService";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const hasDb = Boolean(process.env.DATABASE_URL);
const SOURCE = "Manually entered for Stage 10b-3 QA testing — not a live SACCO source.";
const AS_OF = Date.UTC(2026, 6, 17);
const RAW_LIQUIDITY = "Low liquidity; member deposits withdrawable after notice";

function saccoFinding(): ProjectableFinding {
  return {
    instrumentName: "Test Umoja SACCO",
    issuer: "Test Umoja SACCO",
    sourceLabel: SOURCE,
    sourceAsOf: AS_OF,
    extractedFields: {
      assetType: "sacco",
      productType: "Member deposits",
      dividendRate: "12.00%",
      minimumShareCapital: "KES 10,000",
      minimumMonthlyContribution: "KES 1,000",
      membershipRequirement: "Must be an active member with ID and registration",
      withdrawalTerms: "60 days notice",
      fees: "Joining fee KES 500",
      liquidity: RAW_LIQUIDITY,
      riskNote: "Regulated SACCO product; member risk applies",
    },
  };
}

function projectedFigures(subtype: MarketAssetSubtype, finding: ProjectableFinding) {
  const contract = getCatalogueFieldContract("market_asset", subtype);
  if (!contract) throw new Error(`Missing ${subtype} contract`);
  return projectFindingToContractFigures(contract, finding);
}

describe("Stage 10b-3c · SACCO exact live fixture — pure parity and DB safety", () => {
  const finding = saccoFinding();
  const contract = getCatalogueFieldContract("market_asset", "sacco")!;
  const figures = projectedFigures("sacco", finding);

  it("maps every established SACCO field, including the three live alias shapes", () => {
    const rows = projectFindingToContractDisplayRows(contract, finding);
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    expect(values).toMatchObject({
      saccoName: "Test Umoja SACCO",
      productType: "Member deposits",
      dividendRate: "12.00%",
      minimumShareCapital: "KES 10,000",
      minimumMonthlyDeposit: "KES 1,000",
      membershipRequirement: "Must be an active member with ID and registration",
      withdrawalTerms: "60 days notice",
      fees: "Joining fee KES 500",
      liquidity: RAW_LIQUIDITY,
      regulatoryStatus: "Regulated SACCO product; member risk applies",
      sourceLink: SOURCE,
    });
    expect(values.sourceAsOf).not.toBeNull();

    expect(figures.productType).toBe("Member deposits");
    expect(figures.minimumMonthlyDeposit).toBe("KES 1,000");
    expect(figures.regulatoryStatus).toBe("Regulated SACCO product; member risk applies");
    expect(figures.minimumMonthlyContribution).toBeUndefined();
    expect(figures.riskNote).toBeUndefined();
  });

  it("passes the SACCO approval gate without an override and uses the manager-facing risk/protection label", () => {
    const gate = checkApprovalGate({
      assetClass: "alt",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      currency: "KES",
      source: SOURCE,
      asOf: AS_OF,
    });
    expect(gate.ok).toBe(true);
    expect(gate.missing).toEqual([]);
    expect(gate.reason).toBeUndefined();
  });

  it("builds an opportunities payload whose liquidity fits varchar(32)", () => {
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass: "alt",
      issuer: finding.issuer,
      currency: "KES",
      figures,
      source: SOURCE,
    });
    expect(plan.target).toBe("opportunity");
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.liquidity).toBe("illiquid");
    expect(plan.payload.liquidity!.length).toBeLessThanOrEqual(32);
    expect(plan.payload.ref.length).toBeLessThanOrEqual(64);
    expect(plan.payload.name.length).toBeLessThanOrEqual(200);
    expect(plan.payload.currency.length).toBeLessThanOrEqual(8);
  });

  it("preserves subtype and verbatim SACCO extended fields while keeping typed-column liquidity safe", () => {
    const ext = projectContractFiguresToExtendedFields("market_asset", "sacco", figures);
    expect(ext).toMatchObject({
      assetType: "sacco",
      productType: "Member deposits",
      dividendRate: "12.00%",
      minimumShareCapital: "KES 10,000",
      minimumMonthlyDeposit: "KES 1,000",
      membershipRequirement: "Must be an active member with ID and registration",
      withdrawalTerms: "60 days notice",
      fees: "Joining fee KES 500",
      liquidity: RAW_LIQUIDITY,
      regulatoryStatus: "Regulated SACCO product; member risk applies",
    });
  });

  it("creates a research_findings insert payload that respects every varchar limit", () => {
    const draft: ResearchFindingDraft = {
      instrumentName: finding.instrumentName,
      issuer: finding.issuer ?? null,
      assetClass: "alt",
      targetCatalogue: "market_asset",
      currency: "KES",
      extractedFields: finding.extractedFields ?? {},
      sourceLabel: SOURCE,
      sourceUrl: null,
      sourceKind: "text",
      checkedAt: AS_OF,
      sourceAsOf: "2026-07-17",
      confidence: 0.95,
      missingFields: [],
      warnings: [],
      rawExcerpt: null,
    };
    const [row] = findingsToRows(1, [draft]);
    expect(row.instrumentName.length).toBeLessThanOrEqual(200);
    expect(row.issuer!.length).toBeLessThanOrEqual(200);
    expect(row.assetClass.length).toBeLessThanOrEqual(32);
    expect(row.targetCatalogue.length).toBeLessThanOrEqual(32);
    expect(row.currency!.length).toBeLessThanOrEqual(8);
    expect(row.sourceLabel!.length).toBeLessThanOrEqual(300);
    expect(row.sourceAsOf).toBe(AS_OF);
  });
});

describe("Stage 10b-3c · REIT and Offshore fund audit fixtures", () => {
  it("REIT maps all established fields, gates cleanly, and normalizes long liquidity safely while preserving it", () => {
    const finding: ProjectableFinding = {
      instrumentName: "Test Acorn Income REIT",
      issuer: "Acorn Holdings",
      sourceLabel: "Test REIT factsheet",
      sourceAsOf: AS_OF,
      extractedFields: {
        assetType: "reit",
        reitType: "Income REIT",
        exchange: "Nairobi Securities Exchange",
        marketPrice: "KES 20.00",
        distributionYield: "8.50%",
        recentDistribution: "KES 0.80 per unit",
        nav: "KES 21.10",
        occupancyRate: "94%",
        minInvestment: "100 units",
        liquidity: "Moderate liquidity; units trade through the exchange",
        riskLevel: "Medium",
      },
    };
    const figures = projectedFigures("reit", finding);
    expect(figures).toMatchObject({
      reitType: "Income REIT",
      market: "Nairobi Securities Exchange",
      lastPrice: "KES 20.00",
      distributionYield: "8.50%",
      yieldPct: "8.50%",
      recentDistribution: "KES 0.80 per unit",
      nav: "KES 21.10",
      occupancyRate: "94%",
      minInvestment: "100 units",
      riskLevel: "Medium",
    });
    expect(checkApprovalGate({
      assetClass: "reit",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      currency: "KES",
      source: finding.sourceLabel,
      asOf: AS_OF,
    }).ok).toBe(true);
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass: "reit",
      issuer: finding.issuer,
      currency: "KES",
      figures,
      source: finding.sourceLabel!,
    });
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.liquidity).toBe("t_plus_settlement");
    expect(plan.payload.liquidity!.length).toBeLessThanOrEqual(32);
    expect(projectContractFiguresToExtendedFields("market_asset", "reit", figures).liquidity)
      .toBe("Moderate liquidity; units trade through the exchange");
  });

  it("Offshore fund maps, gates, promotes, and preserves all subtype extended fields", () => {
    const finding: ProjectableFinding = {
      instrumentName: "Test Global Bond Fund",
      issuer: "Test Global Asset Management",
      sourceLabel: "Test offshore fund factsheet",
      sourceAsOf: AS_OF,
      extractedFields: {
        assetType: "offshore_fund",
        exchange: "Luxembourg",
        currency: "USD",
        fundType: "Global bond fund",
        trailingReturn: "8.00%",
        minInvestment: "USD 1,000",
        fee: "1.20%",
        withdrawalPeriod: "T+3 business days",
        fxRisk: "USD-denominated; KES value varies with FX",
        riskLevel: "Medium",
      },
    };
    const figures = projectedFigures("offshore_fund", finding);
    expect(figures).toMatchObject({
      market: "Luxembourg",
      fundType: "Global bond fund",
      trailingReturnPct: "8.00%",
      minInvestment: "USD 1,000",
      expenseRatioPct: "1.20%",
      withdrawalPeriod: "T+3 business days",
      fxRiskNote: "USD-denominated; KES value varies with FX",
      riskLevel: "Medium",
    });
    expect(checkApprovalGate({
      assetClass: "offshore_fund",
      changeKind: "create",
      figures,
      name: finding.instrumentName,
      issuer: finding.issuer,
      currency: "USD",
      source: finding.sourceLabel,
      asOf: AS_OF,
    }).ok).toBe(true);
    const plan = buildPromotionPlan({
      target: "opportunity",
      name: finding.instrumentName,
      assetClass: "offshore_fund",
      issuer: finding.issuer,
      currency: "USD",
      figures,
      source: finding.sourceLabel!,
    });
    if (plan.target !== "opportunity") throw new Error("unreachable");
    expect(plan.payload.currency).toBe("USD");
    expect(plan.payload.trailingReturnPct).toBeCloseTo(8);
    expect(plan.payload.expenseRatioPct).toBeCloseTo(1.2);
    expect(projectContractFiguresToExtendedFields("market_asset", "offshore_fund", figures))
      .toMatchObject({
        fundType: "Global bond fund",
        minInvestment: "USD 1,000",
        withdrawalPeriod: "T+3 business days",
        fxRiskNote: "USD-denominated; KES value varies with FX",
        riskLevel: "Medium",
      });
  });
});

describe("Stage 10b-3c · subtype table display wiring", () => {
  const page = read("client/src/pages/MarketAssetsReference.tsx");

  it("SACCO renders its established fields and never renders Equity/REIT/Offshore-only fields in its row branch", () => {
    const start = page.indexOf("// sacco");
    const block = page.slice(start, page.indexOf("\n  );", start) + 5);
    for (const key of [
      "productType",
      "dividendRate",
      "minimumShareCapital",
      "minimumMonthlyDeposit",
      "membershipRequirement",
      "withdrawalTerms",
      "fees",
      "liquidity",
      "regulatoryStatus",
    ]) {
      expect(block).toContain(`readField("${key}")`);
    }
    for (const irrelevant of ["ticker", "nav", "marketSector", "trailingReturnPct", "expenseRatioPct"]) {
      expect(block).not.toContain(`readField("${irrelevant}")`);
    }
  });

  it("REIT and Offshore fund remain routed to their own tables", () => {
    expect(page).toContain('reit: marketRows.filter((r) => r.assetClass === "reit"');
    expect(page).toContain('offshore_fund: marketRows.filter((r) => r.assetClass === "offshore_fund"');
    expect(page).toContain('<SubtypeTable subtype="reit" rows={bySubtype.reit}');
    expect(page).toContain('<SubtypeTable subtype="offshore_fund" rows={bySubtype.offshore_fund}');
  });
});

describe.skipIf(!hasDb)("Stage 10b-3c · exact SACCO approval reaches opportunities (requires DATABASE_URL)", () => {
  const ref = `zz-stage10b3c-sacco-${Date.now()}`;

  afterAll(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    // Non-destructive cleanup: retain the audit row and archive the test catalogue row.
    await db.update(schema.opportunities).set({ active: false }).where(eq(schema.opportunities.ref, ref));
  }, 30_000);

  it("approves without override, inserts safely, and reads back the SACCO subtype fields", async () => {
    const { enqueueResearchUpdate, getDb, reviewResearchUpdate } = await import("./db");
    const figures = projectedFigures("sacco", saccoFinding());
    const pendingId = await enqueueResearchUpdate({
      targetRef: ref,
      changeKind: "create",
      name: "Test Umoja SACCO",
      assetClass: "alt",
      issuer: "Test Umoja SACCO",
      currency: "KES",
      figures,
      source: SOURCE,
      asOf: AS_OF,
      origin: "manual",
    });
    expect(typeof pendingId).toBe("number");

    const result = await reviewResearchUpdate({
      id: pendingId as number,
      approve: true,
      reviewedBy: "Stage 10b-3c test",
      overrideGate: false,
    });
    expect(result.blocked).toBeUndefined();
    expect(result.promotedRef).toBe(ref);

    const db = await getDb();
    expect(db).toBeTruthy();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [saved] = await db.select().from(schema.opportunities).where(eq(schema.opportunities.ref, ref)).limit(1);
    expect(saved).toBeTruthy();
    expect(saved.assetClass).toBe("alt");
    expect(saved.liquidity).toBe("illiquid");
    expect(saved.dataAsOf?.toISOString().slice(0, 10)).toBe("2026-07-17");
    expect(saved.extendedFields as Record<string, unknown>).toMatchObject({
      assetType: "sacco",
      productType: "Member deposits",
      minimumMonthlyDeposit: "KES 1,000",
      regulatoryStatus: "Regulated SACCO product; member risk applies",
      liquidity: RAW_LIQUIDITY,
    });
  }, 30_000);
});
