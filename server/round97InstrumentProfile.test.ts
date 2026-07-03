/**
 * Round 97 — Full Instrument Profiles + Instrument-Aware Extraction regression suite.
 *
 * Tests:
 *   A. Schema integrity: extendedFields on catalogue tables, holdingSnapshot on holding tables.
 *   B. Structured extraction: CBK bond prospectus → 3 findings with correct fields + _extendedFields.
 *   C. NEVER_INVENT_FIELDS enforcement: null/empty → "missing_from_source" sentinel.
 *   D. Source classification: classifySource returns correct SourceClass.
 *   E. Holding snapshot immutability: holdingSnapshot in bankHoldings.list output is present.
 *   F. Prompt discipline: extraction prompts forbid recommendations; RESEARCH_SYSTEM_PROMPT forbids buy/sell.
 *   G. Missing-field rendering: fmtFields hides _extendedFields, marks missing_from_source.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  NEVER_INVENT_FIELDS,
  MISSING_FROM_SOURCE,
  CBK_BOND_REQUIRED_FIELDS,
  SOURCE_CLASSES,
  isSourceClass,
} from "../shared/instrumentProfile";
import {
  classifySource,
  RESEARCH_SYSTEM_PROMPT,
  structuredInstrumentToDraft,
  tryInstrumentAwareExtraction,
} from "./aiResearchService";

const ROOT = join(__dirname, "..");

/* ─────────────────── A. Schema integrity ─────────────────── */

describe("Round 97 · A — extendedFields + holdingSnapshot columns in schema", () => {
  const schema = readFileSync(join(ROOT, "drizzle/schema.ts"), "utf-8");

  it("mmf_funds has extendedFields JSON column", () => {
    expect(schema).toContain('extendedFields: json("extendedFields")');
    // Verify it's inside the mmfFunds table (after the table declaration, before the next export)
    const mmfBlock = schema.slice(
      schema.indexOf('mysqlTable("mmf_funds"'),
      schema.indexOf("});", schema.indexOf('mysqlTable("mmf_funds"')) + 3,
    );
    expect(mmfBlock).toContain("extendedFields");
  });

  it("bank_instruments has extendedFields JSON column", () => {
    const bankBlock = schema.slice(
      schema.indexOf('mysqlTable("bank_instruments"'),
      schema.indexOf("});", schema.indexOf('mysqlTable("bank_instruments"')) + 3,
    );
    expect(bankBlock).toContain("extendedFields");
  });

  it("opportunities has extendedFields JSON column", () => {
    const oppBlock = schema.slice(
      schema.indexOf('mysqlTable("opportunities"'),
      schema.indexOf("});", schema.indexOf('mysqlTable("opportunities"')) + 3,
    );
    expect(oppBlock).toContain("extendedFields");
  });

  it("securities has holdingSnapshot JSON column", () => {
    const secBlock = schema.slice(
      schema.indexOf('mysqlTable("securities"'),
      schema.indexOf("});", schema.indexOf('mysqlTable("securities"')) + 3,
    );
    expect(secBlock).toContain("holdingSnapshot");
  });

  it("bank_instrument_holdings has holdingSnapshot JSON column", () => {
    const bankHBlock = schema.slice(
      schema.indexOf('mysqlTable("bank_instrument_holdings"'),
      schema.indexOf("});", schema.indexOf('mysqlTable("bank_instrument_holdings"')) + 3,
    );
    expect(bankHBlock).toContain("holdingSnapshot");
  });

  it("portfolio_secondary_mmfs has holdingSnapshot JSON column", () => {
    const mmfHBlock = schema.slice(
      schema.indexOf('mysqlTable("portfolio_secondary_mmfs"'),
      schema.indexOf("});", schema.indexOf('mysqlTable("portfolio_secondary_mmfs"')) + 3,
    );
    expect(mmfHBlock).toContain("holdingSnapshot");
  });
});

/* ─────────────────── B. Structured extraction: CBK bond → 3 findings ─────────────────── */

describe("Round 97 · B — CBK bond prospectus structured extraction produces per-instrument findings", () => {
  afterEach(() => vi.restoreAllMocks());

  it("tryInstrumentAwareExtraction returns 3 findings for a 3-bond prospectus", async () => {
    const llm = await import("./_core/llm");
    let callCount = 0;
    vi.spyOn(llm, "invokeLLM").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Classification call
        return {
          model: "test-model",
          choices: [{
            message: {
              content: JSON.stringify({
                sourceClass: "cbk_bond_prospectus",
                confidence: 0.95,
                reasoning: "Contains FXD issue numbers and auction details",
              }),
            },
          }],
        } as never;
      }
      // Extraction call
      return {
        model: "test-model",
        choices: [{
          message: {
            content: JSON.stringify({
              answer: "This prospectus offers three reopened FXD bonds.",
              sharedAuctionFields: {
                salePeriodStart: "2026-06-23",
                salePeriodEnd: "2026-07-07",
                bidSubmissionDeadline: "2026-07-07T14:00:00",
                auctionDate: "2026-07-09",
                settlementDate: "2026-07-10",
                purpose: "Budget financing",
                nonCompetitiveMin: "50000",
                nonCompetitiveMax: "20000000",
                competitiveMin: "50000000",
              },
              instruments: [
                {
                  instrumentName: "FXD1/2022/010",
                  securityType: "fxd",
                  issueNumber: "FXD1/2022/010",
                  isin: "KE0000000101",
                  tenorLabel: "10 years",
                  tenorMonths: 120,
                  couponRate: 13.4,
                  withholdingTaxRate: 15,
                  maturityDate: "2032-06-20",
                  amountOnOffer: 20000000000,
                  cleanPrice: 98.5,
                  accruedInterestPer100: 1.23,
                  confidence: 0.92,
                  rawExcerpt: "FXD1/2022/010 coupon 13.4%",
                },
                {
                  instrumentName: "FXD1/2021/020",
                  securityType: "fxd",
                  issueNumber: "FXD1/2021/020",
                  isin: "KE0000000201",
                  tenorLabel: "20 years",
                  tenorMonths: 240,
                  couponRate: 14.159,
                  withholdingTaxRate: 15,
                  maturityDate: "2041-03-15",
                  amountOnOffer: 15000000000,
                  cleanPrice: null,
                  accruedInterestPer100: null,
                  confidence: 0.9,
                  rawExcerpt: "FXD1/2021/020 coupon 14.159%",
                },
                {
                  instrumentName: "FXD1/2026/030",
                  securityType: "fxd",
                  issueNumber: "FXD1/2026/030",
                  isin: null,
                  tenorLabel: "30 years",
                  tenorMonths: 360,
                  couponRate: 16.0,
                  withholdingTaxRate: 15,
                  maturityDate: "2056-07-10",
                  amountOnOffer: 10000000000,
                  cleanPrice: null,
                  accruedInterestPer100: null,
                  confidence: 0.88,
                  rawExcerpt: "FXD1/2026/030 coupon 16.0%",
                },
              ],
            }),
          },
        }],
      } as never;
    });

    const result = await tryInstrumentAwareExtraction(
      "REPUBLIC OF KENYA — PROSPECTUS FOR THE SALE OF GOVERNMENT SECURITIES\nFXD1/2022/010 FXD1/2021/020 FXD1/2026/030\nCoupon rates: 13.4%, 14.159%, 16.0%\nSale period: 23 June to 7 July 2026\nAuction date: 9 July 2026",
      "Extract the details from this CBK bond prospectus.",
    );

    expect(result).not.toBeNull();
    expect(result!.sourceClass).toBe("cbk_bond_prospectus");
    expect(result!.findings.length).toBe(3);

    // Each finding should have the issue number in extractedFields
    expect(result!.findings[0].extractedFields.issueNumber).toBe("FXD1/2022/010");
    expect(result!.findings[1].extractedFields.issueNumber).toBe("FXD1/2021/020");
    expect(result!.findings[2].extractedFields.issueNumber).toBe("FXD1/2026/030");

    // Each finding should carry _extendedFields with sourceClass
    for (const f of result!.findings) {
      expect(f.extractedFields._extendedFields).toBeDefined();
      const ext = JSON.parse(f.extractedFields._extendedFields);
      expect(ext.sourceClass).toBe("cbk_bond_prospectus");
      expect(ext.catalogueType).toBe("cbk");
    }

    // Shared auction fields should be propagated to each finding
    expect(result!.findings[0].extractedFields.auctionDate).toBe("2026-07-09");
    expect(result!.findings[1].extractedFields.salePeriodStart).toBe("2026-06-23");

    // Target catalogue should be CBK for all
    for (const f of result!.findings) {
      expect(f.targetCatalogue).toBe("cbk");
      expect(f.assetClass).toBe("gov_coupon");
    }
  });
});

/* ─────────────────── C. NEVER_INVENT_FIELDS enforcement ─────────────────── */

describe("Round 97 · C — NEVER_INVENT_FIELDS are marked missing_from_source, never invented", () => {
  afterEach(() => vi.restoreAllMocks());

  it("null/empty NEVER_INVENT fields become 'missing_from_source' in the draft", async () => {
    const llm = await import("./_core/llm");
    let callCount = 0;
    vi.spyOn(llm, "invokeLLM").mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          model: "test-model",
          choices: [{
            message: {
              content: JSON.stringify({
                sourceClass: "cbk_bond_prospectus",
                confidence: 0.9,
                reasoning: "Bond prospectus",
              }),
            },
          }],
        } as never;
      }
      return {
        model: "test-model",
        choices: [{
          message: {
            content: JSON.stringify({
              answer: "Extracted one bond with some fields missing.",
              instruments: [{
                instrumentName: "FXD1/2024/005",
                securityType: "fxd",
                issueNumber: "FXD1/2024/005",
                isin: null, // NEVER_INVENT — should become missing_from_source
                couponRate: 12.5,
                withholdingTaxRate: null, // NEVER_INVENT — should become missing_from_source
                maturityDate: "", // NEVER_INVENT — empty string should become missing_from_source
                amountOnOffer: 5000000000,
                cleanPrice: null, // NEVER_INVENT — should become missing_from_source
                accruedInterestPer100: null, // NEVER_INVENT — should become missing_from_source
                auctionDate: null, // NEVER_INVENT — should become missing_from_source
                confidence: 0.85,
                rawExcerpt: "FXD1/2024/005",
              }],
            }),
          },
        }],
      } as never;
    });

    const result = await tryInstrumentAwareExtraction(
      "PROSPECTUS: FXD1/2024/005 coupon 12.5%",
      "Extract bond details.",
    );

    expect(result).not.toBeNull();
    expect(result!.findings.length).toBe(1);
    const fields = result!.findings[0].extractedFields;

    // Fields that were null/empty and are in NEVER_INVENT_FIELDS should be "missing_from_source"
    expect(fields.isin).toBe(MISSING_FROM_SOURCE);
    expect(fields.withholdingTaxRate).toBe(MISSING_FROM_SOURCE);
    expect(fields.maturityDate).toBe(MISSING_FROM_SOURCE);
    expect(fields.cleanPrice).toBe(MISSING_FROM_SOURCE);
    expect(fields.accruedInterestPer100).toBe(MISSING_FROM_SOURCE);
    expect(fields.auctionDate).toBe(MISSING_FROM_SOURCE);

    // Fields that had real values should be preserved
    expect(fields.couponRate).toBe("12.5");
    expect(fields.issueNumber).toBe("FXD1/2024/005");
    expect(fields.amountOnOffer).toBe("5000000000");

    // missingFields list should include the missing ones
    expect(result!.findings[0].missingFields).toContain("isin");
    expect(result!.findings[0].missingFields).toContain("cleanPrice");
    expect(result!.findings[0].missingFields).not.toContain("couponRate");
  });

  it("NEVER_INVENT_FIELDS list is comprehensive for CBK bonds", () => {
    // All critical CBK fields should be in the never-invent list
    const criticalCbkFields = [
      "issueNumber", "isin", "couponRate", "maturityDate",
      "withholdingTaxRate", "cleanPrice", "accruedInterestPer100",
      "auctionDate", "settlementDate",
    ];
    for (const f of criticalCbkFields) {
      expect(NEVER_INVENT_FIELDS).toContain(f);
    }
  });
});

/* ─────────────────── D. Source classification ─────────────────── */

describe("Round 97 · D — classifySource returns correct SourceClass", () => {
  afterEach(() => vi.restoreAllMocks());

  it("classifies a CBK bond prospectus correctly", async () => {
    const llm = await import("./_core/llm");
    vi.spyOn(llm, "invokeLLM").mockResolvedValue({
      model: "test-model",
      choices: [{
        message: {
          content: JSON.stringify({
            sourceClass: "cbk_bond_prospectus",
            confidence: 0.95,
            reasoning: "Contains FXD issue numbers and auction details",
          }),
        },
      }],
    } as never);

    const result = await classifySource("REPUBLIC OF KENYA PROSPECTUS FXD1/2022/010");
    expect(result.sourceClass).toBe("cbk_bond_prospectus");
    expect(isSourceClass(result.sourceClass)).toBe(true);
  });

  it("returns 'unknown' for unclassifiable text", async () => {
    const llm = await import("./_core/llm");
    vi.spyOn(llm, "invokeLLM").mockResolvedValue({
      model: "test-model",
      choices: [{
        message: {
          content: JSON.stringify({
            sourceClass: "unknown",
            confidence: 0.3,
            reasoning: "Cannot determine document type",
          }),
        },
      }],
    } as never);

    const result = await classifySource("Some random text that is not financial");
    expect(result.sourceClass).toBe("unknown");
  });

  it("tryInstrumentAwareExtraction returns null for unknown source class", async () => {
    const llm = await import("./_core/llm");
    vi.spyOn(llm, "invokeLLM").mockResolvedValue({
      model: "test-model",
      choices: [{
        message: {
          content: JSON.stringify({
            sourceClass: "unknown",
            confidence: 0.2,
            reasoning: "Not a financial document",
          }),
        },
      }],
    } as never);

    const result = await tryInstrumentAwareExtraction("Random text", "What is this?");
    expect(result).toBeNull();
  });
});

/* ─────────────────── E. Holding snapshot in bankHoldings.list ─────────────────── */

describe("Round 97 · E — holdingSnapshot is exposed in bankHoldings.list output", () => {
  it("bankHoldings.list procedure returns holdingSnapshot field", () => {
    const routers = readFileSync(join(ROOT, "server/routers.ts"), "utf-8");
    // Find the bankHoldings.list procedure and verify it maps holdingSnapshot
    const listStart = routers.indexOf("bankHoldings: router({");
    expect(listStart).toBeGreaterThan(0);
    const listBlock = routers.slice(listStart, listStart + 2000);
    expect(listBlock).toContain("holdingSnapshot");
  });

  it("secondaryMmfs.list procedure returns holdingSnapshot field", () => {
    const routers = readFileSync(join(ROOT, "server/routers.ts"), "utf-8");
    const mmfListStart = routers.indexOf("secondaryMmfs: router({");
    expect(mmfListStart).toBeGreaterThan(0);
    const mmfListBlock = routers.slice(mmfListStart, mmfListStart + 2000);
    expect(mmfListBlock).toContain("holdingSnapshot");
  });
});

/* ─────────────────── F. Prompt discipline ─────────────────── */

describe("Round 97 · F — Prompt discipline: extraction never recommends", () => {
  it("RESEARCH_SYSTEM_PROMPT forbids buy/sell/hold recommendations", () => {
    // The system prompt says "you are NOT an adviser" and forbids inventing
    expect(RESEARCH_SYSTEM_PROMPT).toContain("NOT an adviser");
    expect(RESEARCH_SYSTEM_PROMPT).toContain("Do NOT invent instruments or figures");
    // It must not contain affirmative recommendation language
    expect(RESEARCH_SYSTEM_PROMPT).not.toMatch(/you should buy|I recommend buying/i);
  });

  it("STRUCTURED_EXTRACTION_PREAMBLE forbids recommendations", () => {
    const service = readFileSync(join(ROOT, "server/aiResearchService.ts"), "utf-8");
    const preambleStart = service.indexOf("STRUCTURED_EXTRACTION_PREAMBLE");
    const preambleBlock = service.slice(preambleStart, preambleStart + 500);
    expect(preambleBlock).toContain("Do NOT recommend buying, selling, or holding");
    expect(preambleBlock).toContain("Do NOT rank instruments");
  });

  it("CBK bond extraction prompt says DO NOT invent critical fields", () => {
    const service = readFileSync(join(ROOT, "server/aiResearchService.ts"), "utf-8");
    const cbkPromptIdx = service.indexOf("CBK BOND PROSPECTUS or REOPENING");
    expect(cbkPromptIdx).toBeGreaterThan(0);
    // Widen the slice to capture the full prompt including the CRITICAL line
    const cbkPrompt = service.slice(cbkPromptIdx, cbkPromptIdx + 900);
    expect(cbkPrompt).toContain("Do NOT invent issue numbers");
    expect(cbkPrompt).toContain("missing_from_source");
  });

  it("AI extraction preamble contains prohibition against recommendations", () => {
    const service = readFileSync(join(ROOT, "server/aiResearchService.ts"), "utf-8");
    const preambleStart = service.indexOf("STRUCTURED_EXTRACTION_PREAMBLE");
    const preambleEnd = service.indexOf("`;\n", preambleStart);
    const preamble = service.slice(preambleStart, preambleEnd);
    // The preamble explicitly says "Do NOT recommend buying, selling, or holding"
    expect(preamble).toContain("Do NOT recommend buying, selling, or holding");
    expect(preamble).toContain("Do NOT rank instruments");
    // It should not contain affirmative language like "you should buy" or "this is the best"
    expect(preamble).not.toMatch(/you should (buy|sell)/i);
    expect(preamble).not.toMatch(/this is the best/i);
  });
});

/* ─────────────────── G. Client rendering: fmtFields + source class badge ─────────────────── */

describe("Round 97 · G — Client renders extended fields correctly", () => {
  it("AskAI fmtFields hides _extendedFields and marks missing_from_source", () => {
    const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf-8");
    // fmtFields should filter out _extendedFields
    expect(askAi).toContain("_extendedFields");
    expect(askAi).toMatch(/k\s*!==\s*["']_extendedFields["']/);
    // Should handle missing_from_source sentinel
    expect(askAi).toContain("missing_from_source");
  });

  it("AskAI FindingCard renders source class badge from SOURCE_CLASS_LABELS", () => {
    const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf-8");
    expect(askAi).toContain("SOURCE_CLASS_LABELS");
    expect(askAi).toContain("isSourceClass");
  });

  it("BankInstruments detail sheet renders extendedFields", () => {
    const bankInst = readFileSync(join(ROOT, "client/src/pages/BankInstruments.tsx"), "utf-8");
    expect(bankInst).toContain("extendedFields");
    expect(bankInst).toContain("Full profile");
  });

  it("OpportunityDetail renders extendedFields as instrument profile", () => {
    const oppDetail = readFileSync(join(ROOT, "client/src/pages/OpportunityDetail.tsx"), "utf-8");
    expect(oppDetail).toContain("extendedFields");
    expect(oppDetail).toContain("instrument profile");
  });

  it("BankHoldings renders holdingSnapshot as 'Terms at purchase'", () => {
    const bankH = readFileSync(join(ROOT, "client/src/pages/BankHoldings.tsx"), "utf-8");
    expect(bankH).toContain("holdingSnapshot");
    expect(bankH).toContain("Terms at purchase");
  });
});

/* ─────────────────── H. Shared types integrity ─────────────────── */

describe("Round 97 · H — Shared instrumentProfile types are complete", () => {
  it("SOURCE_CLASSES includes all expected source types", () => {
    expect(SOURCE_CLASSES).toContain("cbk_bond_prospectus");
    expect(SOURCE_CLASSES).toContain("cbk_tbill_auction");
    expect(SOURCE_CLASSES).toContain("mmf_factsheet");
    expect(SOURCE_CLASSES).toContain("bank_product_page");
    expect(SOURCE_CLASSES).toContain("market_asset_factsheet");
    expect(SOURCE_CLASSES).toContain("unknown");
  });

  it("CBK_BOND_REQUIRED_FIELDS covers the acceptance criteria", () => {
    const required = [
      "securityType", "issueNumber", "tenorLabel", "couponRate",
      "withholdingTaxRate", "maturityDate", "salePeriodStart", "salePeriodEnd",
      "bidSubmissionDeadline", "auctionDate", "settlementDate", "amountOnOffer",
    ];
    for (const f of required) {
      expect(CBK_BOND_REQUIRED_FIELDS).toContain(f);
    }
  });

  it("MISSING_FROM_SOURCE is the correct sentinel string", () => {
    expect(MISSING_FROM_SOURCE).toBe("missing_from_source");
  });

  it("isSourceClass validates correctly", () => {
    expect(isSourceClass("cbk_bond_prospectus")).toBe(true);
    expect(isSourceClass("invalid_class")).toBe(false);
    expect(isSourceClass("")).toBe(false);
  });
});
