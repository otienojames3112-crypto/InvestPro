/**
 * Stage 10b-3b — Market Assets live insert repair (Equity/REIT/Offshore
 * fund/SACCO).
 *
 * Stage 10b-3 deployed and the page redesign worked, but the FIRST live QA
 * (Equity, "Extract facts", pasted text) failed with a toast before any
 * finding card appeared: the `insert into research_findings` query failed and
 * the task was marked failed.
 *
 * ROOT CAUSE (verified by schema + code audit, reproduced in test A below):
 * `research_findings.currency` is varchar(8). MARKET_ASSET_EXTRACTION_SCHEMA
 * is the ONLY structured extraction schema with a per-instrument `currency`
 * property, and its prompt carries the standard rule "If a field is not
 * printed, set it to 'missing_from_source'". The live Equity fixture has no
 * printed "Currency:" line, so the model returns the literal 19-character
 * sentinel — and `structuredInstrumentToDraft` passed `raw.currency` through
 * VERBATIM (`typeof raw.currency === "string" ? raw.currency : "KES"`),
 * producing a draft whose currency cannot fit the column. MySQL strict mode
 * rejects the whole insert ("Data too long for column 'currency'"), the task
 * is marked failed, and nothing ever reaches the review queue. All four
 * subtypes share the one schema, so all four were affected — SACCO worst
 * (a SACCO source practically never prints a currency line).
 *
 * NOT the cause (explicitly ruled out): the Stage 10b-3 asOfDate bridge's
 * human date string ("17 July 2026"). `findingsToRows` already guards
 * `sourceAsOf` with Date.parse-or-null, and V8 parses that string — no
 * crash. It DID parse in local time (a silent timezone skew vs. ISO), so
 * this stage normalizes the bridge to "YYYY-MM-DD" anyway (fix 2 below),
 * but the insert failure was the currency column.
 *
 * THE FIX (three layers, smallest change that covers all four subtypes):
 *   1. `normaliseDraftCurrency` — the structured draft's envelope currency:
 *      sentinel/blank → the pre-existing "KES" default; a fitting real code
 *      passes through unchanged; longer real text keeps an embedded 3-letter
 *      code when one exists (verbatim text still lives in
 *      extractedFields.currency).
 *   2. `marketAssetSourceAsOf` bridge now normalizes to "YYYY-MM-DD" via the
 *      established normalizeDateToYmd helper (ISO passthrough, no timezone
 *      shift, unparseable text kept verbatim rather than dropped).
 *   3. `findingsToRows` — a defensive choke-point guard for EVERY catalogue
 *      and path: a currency that is the sentinel or longer than varchar(8)
 *      becomes null at the row level, so no future draft shape can ever
 *      crash this insert again (values that fit are passed through
 *      byte-identical — MMF/Bank/CBK behavior unchanged).
 *   Plus: fundManager/bankName sentinel-guarding in the issuer resolution —
 *   a "missing_from_source" fundManager must not become the displayed issuer
 *   (and must not defeat the Stage 10b-3 name fallback).
 *
 * WHY STAGE 10b-3's TESTS MISSED IT: every fixture fed
 * `structuredInstrumentToDraft` either a clean currency or none at all
 * (never the sentinel the live model actually returns), no test ran a
 * market-asset draft through `findingsToRows` against the real column
 * limits, and the DB-gated test exercised `research_updates`
 * (enqueue→approve), never `research_findings`.
 *
 * Test layers (established convention — no jsdom):
 *   A. Pure — the exact live Equity failure reproduced through
 *      structuredInstrumentToDraft → findingsToRows, asserted against the
 *      real research_findings column limits (fails pre-fix, passes now).
 *   B. Pure — as-of normalization for all four subtypes.
 *   C. Pure — issuer sentinel-guarding.
 *   D. Pure — normaliseDraftCurrency directly + insert-payload safety,
 *      JSON-safety, subtype routing, and gate compatibility for all four
 *      subtype fixtures under sentinel conditions.
 *   E. Static source scan — the fix wiring exists where claimed.
 *   F. DB-gated — the live Equity scenario actually inserts into
 *      research_findings (requires DATABASE_URL, skipped otherwise).
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  findingsToRows,
  normaliseDraftCurrency,
  structuredInstrumentToDraft,
} from "./aiResearchService";
import {
  getCatalogueFieldContract,
  projectFindingToContractFigures,
} from "../shared/catalogueFieldContracts";
import { checkApprovalGate } from "../shared/researchPipeline";
import type { SourceClass } from "../shared/instrumentProfile";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const hasDb = Boolean(process.env.DATABASE_URL);

const SC: SourceClass = "market_asset_factsheet";
const SENTINEL = "missing_from_source";

/**
 * The exact live QA fixture the user pasted, as the model would return it
 * under the schema's sentinel rule: every printed field verbatim, and
 * `currency` — which has NO printed "Currency:" line — as the sentinel.
 * This is the value combination that crashed the live insert.
 */
const LIVE_EQUITY_RAW = {
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
  currency: SENTINEL,
};
const LIVE_SHARED = { asOfDate: "17 July 2026" };
const LIVE_SOURCE_LABEL = "Manually entered for Stage 10b-3 QA testing — not a live market source.";

/** Assert one findingsToRows row against the REAL research_findings column limits. */
function assertRowInsertSafe(row: ReturnType<typeof findingsToRows>[number]) {
  // varchar columns
  expect(row.instrumentName.length).toBeLessThanOrEqual(200);
  if (row.issuer != null) expect(row.issuer.length).toBeLessThanOrEqual(200);
  if (row.assetClass != null) expect(row.assetClass.length).toBeLessThanOrEqual(32);
  if (row.currency != null) expect(row.currency.length).toBeLessThanOrEqual(8); // ← the live failure
  if (row.sourceLabel != null) expect(row.sourceLabel.length).toBeLessThanOrEqual(300);
  if (row.sourceUrl != null) expect(row.sourceUrl.length).toBeLessThanOrEqual(500);
  // enums
  expect(["mmf", "bank", "cbk", "market_asset", "macro"]).toContain(row.targetCatalogue);
  expect(["low", "medium", "high"]).toContain(row.confidence);
  if (row.sourceKind != null) expect(["url", "text", "pdf", "image"]).toContain(row.sourceKind);
  expect(["new", "drafted", "dismissed", "superseded"]).toContain(row.status);
  // bigint epoch-ms columns: a finite integer or null, never NaN/string/Date
  if (row.sourceAsOf != null) {
    expect(typeof row.sourceAsOf).toBe("number");
    expect(Number.isSafeInteger(row.sourceAsOf)).toBe(true);
  }
  expect(typeof row.checkedAt).toBe("number");
  expect(Number.isSafeInteger(row.checkedAt)).toBe(true);
  // JSON columns: round-trippable with no undefined/NaN/Date/BigInt loss
  for (const jsonVal of [row.extractedFields, row.missingFields, row.warnings]) {
    expect(JSON.parse(JSON.stringify(jsonVal))).toEqual(jsonVal);
  }
  for (const v of Object.values(row.extractedFields)) {
    expect(typeof v).toBe("string");
  }
}

// ── A. the exact live Equity failure, reproduced pure ─────────────────────────

describe("Stage 10b-3b · A — the live Equity insert failure, reproduced through the REAL draft→row path", () => {
  const draft = structuredInstrumentToDraft(LIVE_EQUITY_RAW, SC, LIVE_SHARED)!;
  // Stamp the provenance runResearchQuestion would add for pasted text.
  draft.sourceLabel = LIVE_SOURCE_LABEL;
  draft.sourceKind = "text";
  draft.checkedAt = Date.now();
  const rows = findingsToRows(101, [draft]);

  it("the sentinel currency that crashed the live insert never reaches the row — the draft falls back to the pre-existing KES default", () => {
    expect(draft.currency).toBe("KES");
    expect(rows[0].currency).toBe("KES");
  });

  it("the FULL insert row fits every research_findings column limit — the exact assertion that fails pre-fix (currency was the 19-char sentinel, varchar(8))", () => {
    expect(rows.length).toBe(1);
    assertRowInsertSafe(rows[0]);
  });

  it("the verbatim sentinel is still visible to the manager in extractedFields.currency — sanitizing the envelope never hides what the source did (not) say", () => {
    expect(rows[0].extractedFields.currency).toBe(SENTINEL);
  });

  it("sourceAsOf lands as the UTC-midnight epoch of 2026-07-17 — normalized by the bridge, parsed once by findingsToRows, no local-time skew", () => {
    expect(draft.sourceAsOf).toBe("2026-07-17");
    expect(rows[0].sourceAsOf).toBe(Date.parse("2026-07-17"));
  });

  it("every printed fixture field survives into extractedFields verbatim — the sanitization dropped nothing", () => {
    const f = rows[0].extractedFields;
    expect(f.ticker).toBe("TSCOM");
    expect(f.exchange).toBe("Nairobi Securities Exchange");
    expect(f.marketPrice).toBe("KES 25.50");
    expect(f.dividendYield).toBe("6.00%");
    expect(f.recentDividend).toBe("KES 1.50 per share");
    expect(f.priceChange).toBe("+2.00% today");
    expect(f.marketSector).toBe("Telecommunications");
    expect(f.minBuyAmount).toBe("100 shares");
    expect(f.liquidity).toBe("High liquidity, actively traded");
    expect(f.riskLevel).toBe("Medium");
  });
});

// ── B. as-of normalization, all four subtypes ────────────────────────────────

describe("Stage 10b-3b · B — the market-asset as-of bridge normalizes to YYYY-MM-DD for every subtype", () => {
  const cases = [
    { name: "Equity", raw: { instrumentName: "Test Safaricom PLC", assetType: "equity", marketPrice: "25.50" } },
    { name: "REIT", raw: { instrumentName: "Test Acorn Income REIT", assetType: "reit", marketPrice: "20.00" } },
    { name: "Offshore fund", raw: { instrumentName: "Test Global Bond Fund", assetType: "offshore_fund", trailingReturn: "8.0" } },
    { name: "SACCO", raw: { instrumentName: "Test Stima SACCO", assetType: "sacco", shareCapitalDividendRate: "12%" } },
  ];

  for (const c of cases) {
    it(`${c.name}: "17 July 2026" becomes "2026-07-17"`, () => {
      const draft = structuredInstrumentToDraft(c.raw, SC, { asOfDate: "17 July 2026" })!;
      expect(draft.sourceAsOf).toBe("2026-07-17");
    });
  }

  it("ISO input passes through unchanged (no double-conversion, no timezone shift)", () => {
    const draft = structuredInstrumentToDraft(cases[0].raw, SC, { asOfDate: "2026-07-17" })!;
    expect(draft.sourceAsOf).toBe("2026-07-17");
  });

  it("an unparseable string is kept verbatim (never dropped, never fabricated) — findingsToRows then safely nulls it at the row level", () => {
    const draft = structuredInstrumentToDraft(cases[0].raw, SC, { asOfDate: "no date stated" })!;
    expect(draft.sourceAsOf).toBe("no date stated");
    const rows = findingsToRows(1, [draft]);
    expect(rows[0].sourceAsOf).toBeNull();
  });

  it("the sentinel and blank still never bridge at all", () => {
    expect(structuredInstrumentToDraft(cases[0].raw, SC, { asOfDate: SENTINEL })!.sourceAsOf).toBeNull();
    expect(structuredInstrumentToDraft(cases[0].raw, SC, { asOfDate: "  " })!.sourceAsOf).toBeNull();
  });
});

// ── C. issuer sentinel-guarding ──────────────────────────────────────────────

describe("Stage 10b-3b · C — a sentinel fundManager/bankName never becomes the issuer", () => {
  it("Offshore fund with fundManager = sentinel falls back to the instrument's own name — not the raw sentinel string", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "Test Global Bond Fund", assetType: "offshore_fund", fundManager: SENTINEL, trailingReturn: "8.0" },
      SC,
    )!;
    expect(draft.issuer).toBe("Test Global Bond Fund");
  });

  it("a REAL fundManager still wins over the name fallback, unchanged", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "Test Global Bond Fund", assetType: "offshore_fund", fundManager: "Franklin Templeton", trailingReturn: "8.0" },
      SC,
    )!;
    expect(draft.issuer).toBe("Franklin Templeton");
  });

  it("a Bank finding with bankName = sentinel gets issuer null (honestly absent), not the sentinel string", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "90-Day Fixed Deposit", bankName: SENTINEL, indicativeRate: "9.5" },
      "bank_product_page",
    )!;
    expect(draft.issuer).toBeNull();
  });

  it("a Bank finding with a REAL bankName is byte-identical to before", () => {
    const draft = structuredInstrumentToDraft(
      { instrumentName: "90-Day Fixed Deposit", bankName: "Test Bank Ltd", indicativeRate: "9.5" },
      "bank_product_page",
    )!;
    expect(draft.issuer).toBe("Test Bank Ltd");
  });
});

// ── D. normaliseDraftCurrency + all-four-subtype insert-payload safety ───────

describe("Stage 10b-3b · D — normaliseDraftCurrency (pure)", () => {
  it("sentinel, blank, and non-string all fall back to the pre-existing KES default", () => {
    expect(normaliseDraftCurrency(SENTINEL)).toBe("KES");
    expect(normaliseDraftCurrency("")).toBe("KES");
    expect(normaliseDraftCurrency("   ")).toBe("KES");
    expect(normaliseDraftCurrency(null)).toBe("KES");
    expect(normaliseDraftCurrency(undefined)).toBe("KES");
  });

  it("genuinely-stated codes pass through byte-identical", () => {
    expect(normaliseDraftCurrency("KES")).toBe("KES");
    expect(normaliseDraftCurrency("USD")).toBe("USD");
    expect(normaliseDraftCurrency("GBP")).toBe("GBP");
  });

  it("longer real text keeps an embedded 3-letter code when one exists", () => {
    expect(normaliseDraftCurrency("US Dollar (USD)")).toBe("USD");
    expect(normaliseDraftCurrency("Kenyan Shilling KES")).toBe("KES");
  });

  it("over-long text with no extractable code falls back to KES rather than crashing the insert (the verbatim text stays in extractedFields)", () => {
    expect(normaliseDraftCurrency("shillings and cents")).toBe("KES");
    expect(normaliseDraftCurrency(SENTINEL).length).toBeLessThanOrEqual(8);
  });
});

describe("Stage 10b-3b · D — all four subtype fixtures build insert-safe rows under sentinel conditions AND still project/gate correctly", () => {
  const fixtures: Array<{
    label: string;
    subtype: "equity" | "reit" | "offshore_fund" | "sacco";
    gateAssetClass: "equity" | "reit" | "offshore_fund" | "alt";
    raw: Record<string, unknown>;
    expectCurrency: string;
  }> = [
    { label: "Equity (the live fixture)", subtype: "equity", gateAssetClass: "equity", raw: LIVE_EQUITY_RAW, expectCurrency: "KES" },
    {
      label: "REIT",
      subtype: "reit",
      gateAssetClass: "reit",
      raw: {
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
        currency: SENTINEL,
      },
      expectCurrency: "KES",
    },
    {
      label: "Offshore fund (real USD, sentinel-free — proving nothing regressed for a clean value)",
      subtype: "offshore_fund",
      gateAssetClass: "offshore_fund",
      raw: {
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
      },
      expectCurrency: "USD",
    },
    {
      label: "SACCO (the most exposed — a SACCO source almost never prints a currency line)",
      subtype: "sacco",
      gateAssetClass: "alt",
      raw: {
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
        currency: SENTINEL,
      },
      expectCurrency: "KES",
    },
  ];

  for (const fx of fixtures) {
    it(`${fx.label}: draft → findingsToRows produces a fully insert-safe row with currency "${fx.expectCurrency}" and sourceAsOf 2026-07-17`, () => {
      const draft = structuredInstrumentToDraft(fx.raw, SC, { asOfDate: "17 July 2026" })!;
      draft.sourceLabel = LIVE_SOURCE_LABEL;
      draft.sourceKind = "text";
      draft.checkedAt = Date.now();
      expect(draft.currency).toBe(fx.expectCurrency);
      expect(draft.sourceAsOf).toBe("2026-07-17");
      const rows = findingsToRows(102, [draft]);
      expect(rows[0].currency).toBe(fx.expectCurrency);
      expect(rows[0].sourceAsOf).toBe(Date.parse("2026-07-17"));
      assertRowInsertSafe(rows[0]);
    });

    it(`${fx.label}: the sanitized draft still projects to the ${fx.subtype} contract and passes the approval gate — the repair changed nothing downstream`, () => {
      const draft = structuredInstrumentToDraft(fx.raw, SC, { asOfDate: "17 July 2026" })!;
      const contract = getCatalogueFieldContract("market_asset", fx.subtype)!;
      const figures = projectFindingToContractFigures(contract, draft);
      const gate = checkApprovalGate({
        assetClass: fx.gateAssetClass,
        changeKind: "create",
        figures,
        name: draft.instrumentName,
        issuer: draft.issuer,
        currency: draft.currency,
        source: LIVE_SOURCE_LABEL,
        asOf: Date.parse("2026-07-17"),
      });
      expect(gate.ok).toBe(true);
      expect(gate.missing).toEqual([]);
    });
  }

  it("subtype routing is intact: equity/reit/offshore_fund keep their own assetClass, SACCO routes to 'alt' with the assetType detection signal preserved in extractedFields", () => {
    for (const fx of fixtures) {
      const draft = structuredInstrumentToDraft(fx.raw, SC)!;
      expect(draft.targetCatalogue).toBe("market_asset");
      expect(draft.assetClass).toBe(fx.gateAssetClass);
    }
    const sacco = structuredInstrumentToDraft(fixtures[3].raw, SC)!;
    expect(sacco.extractedFields.assetType).toBe("sacco");
  });
});

// ── E. static source scan — the fix wiring exists where claimed ──────────────

describe("Stage 10b-3b · E — fix wiring (static source scan)", () => {
  const aiService = read("server/aiResearchService.ts");

  it("structuredInstrumentToDraft routes the envelope currency through normaliseDraftCurrency, never raw", () => {
    expect(aiService).toContain("currency: normaliseDraftCurrency(raw.currency),");
    // The RETURNED DRAFT must not carry the old raw passthrough. The two
    // remaining `typeof raw.currency === "string" ? raw.currency : "KES"`
    // occurrences earlier in the function are gate-CONTEXT envelopes for the
    // CBK/MMF candidate-phrase scans — never persisted, deliberately
    // untouched. Scope the not-assertion to the draft's return object
    // (everything from the sentinel-guarded issuer resolution onward).
    const returnIdx = aiService.indexOf('raw.fundManager !== MISSING_FROM_SOURCE');
    expect(returnIdx).toBeGreaterThan(-1);
    const returnBlock = aiService.slice(returnIdx);
    expect(returnBlock).not.toContain('typeof raw.currency === "string" ? raw.currency : "KES"');
  });

  it("findingsToRows carries the varchar(8) choke-point guard for every catalogue", () => {
    const idx = aiService.indexOf("export function findingsToRows(");
    const block = aiService.slice(idx, idx + 2500);
    expect(block).toContain("d.currency !== MISSING_FROM_SOURCE && d.currency.length <= 8");
  });

  it("the market-asset as-of bridge normalizes through normalizeDateToYmd", () => {
    expect(aiService).toContain("const marketAssetSourceAsOf = marketAssetSourceAsOfRaw");
    expect(aiService).toContain("normalizeDateToYmd(marketAssetSourceAsOfRaw)");
  });

  it("the issuer resolution sentinel-guards both fundManager and bankName", () => {
    expect(aiService).toContain('raw.fundManager !== MISSING_FROM_SOURCE');
    expect(aiService).toContain('raw.bankName !== MISSING_FROM_SOURCE');
  });
});

// ── F. DB-gated — the live Equity scenario actually inserts (requires DATABASE_URL) ──

describe.skipIf(!hasDb)("Stage 10b-3b · F — the live Equity scenario round-trips through a REAL research_findings insert (requires DATABASE_URL)", () => {
  let taskId: number | null = null;

  afterAll(async () => {
    if (taskId == null) return;
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    // Non-destructive cleanup: dismiss the test finding rather than deleting it.
    await db
      .update(schema.researchFindings)
      .set({ status: "dismissed" })
      .where(eq(schema.researchFindings.taskId, taskId));
  });

  it("insertResearchFindings succeeds with the exact draft the live QA produced — the query that failed in production now completes, and the row reads back correctly", async () => {
    const { createResearchTask, insertResearchFindings, getDb } = await import("./db");
    taskId = await createResearchTask({
      createdByOpenId: "stage10b3b-test",
      createdByName: "Stage 10b-3b regression test",
      prompt: "Stage 10b-3b QA — live Equity insert repair regression",
      scope: "market_asset",
      status: "done",
    });
    expect(typeof taskId).toBe("number");

    const draft = structuredInstrumentToDraft(LIVE_EQUITY_RAW, SC, LIVE_SHARED)!;
    draft.sourceLabel = LIVE_SOURCE_LABEL;
    draft.sourceKind = "text";
    draft.checkedAt = Date.now();
    const rows = findingsToRows(taskId as number, [draft]);
    await insertResearchFindings(rows); // ← the exact query that failed live

    const db = await getDb();
    expect(db).toBeTruthy();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const [saved] = await db
      .select()
      .from(schema.researchFindings)
      .where(eq(schema.researchFindings.taskId, taskId as number))
      .limit(1);
    expect(saved).toBeTruthy();
    expect(saved.instrumentName).toBe("Test Safaricom PLC");
    expect(saved.currency).toBe("KES");
    expect(saved.sourceAsOf).toBe(Date.parse("2026-07-17"));
    expect((saved.extractedFields as Record<string, unknown>).currency).toBe(SENTINEL);
    expect((saved.extractedFields as Record<string, unknown>).marketPrice).toBe("KES 25.50");
  });
});
