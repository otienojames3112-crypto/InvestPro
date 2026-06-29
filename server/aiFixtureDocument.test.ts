/**
 * Part 8 (items 6-7 / acceptance) — FIXTURE-DOCUMENT extraction test.
 *
 * Drives the network-free intake pipeline end to end the way a real call does, but with
 * a fixed, stubbed model response instead of a live LLM:
 *
 *   stubbed model JSON  →  parseExtractionResponse  →  extractionToAdapterResult
 *                       →  aiInstrumentToProvenanceMap  (ai_extracted + sanity gate)
 *
 * Asserts the acceptance bar:
 *   - the present fields are extracted verbatim (no arithmetic / annualisation),
 *   - fields ABSENT from the document come back null (nulls over guesses),
 *   - figures with no confirming quote are dropped (the librarian must show its work),
 *   - a verdict/ranking field the model tried to smuggle in is stripped,
 *   - every figure lands at the ai_extracted trust floor, and
 *   - an implausible figure is FLAGGED by the numeric sanity gate (not saved as clean),
 *   - discovery returns a neutral, de-duplicated, suggestion-only candidate list.
 */
import { describe, it, expect } from "vitest";
import {
  parseExtractionResponse,
  parseDiscoveryResponse,
} from "./aiIntakeService";
import { extractionToAdapterResult, aiInstrumentToProvenanceMap } from "../shared/aiAdapter";

/**
 * A deliberately MESSY money-market-fund fact sheet, the kind a maintainer would paste.
 * It states a name, manager, currency, a daily yield, and a management fee — but NO
 * price, NO maturity (an MMF has none), and NO coupon. The extractor must take only
 * what's here and leave the rest null.
 */
const FIXTURE_DOC = `
NABO Africa Money Market Fund  —  Fact Sheet (as at 31 May 2026)
Manager: Nabo Capital Ltd.    Currency: KES
Effective annual yield (net, as at 31 May 2026): 9.25% p.a.
Management fee: 1.50% per annum of net asset value.
Minimum investment: KES 100,000.   Risk profile: low to moderate.
Note: yields are not guaranteed and fluctuate daily.
`;

/**
 * What a faithful model returns for that document under our schema. It includes an
 * `asOf`, a confirming quote per figure, ONE figure with no quote (must be dropped),
 * and a sneaky top-level "recommendation" + a per-figure "rating" the schema doesn't
 * allow — both must be stripped by stripVerdictFields.
 */
const STUBBED_MODEL_JSON = JSON.stringify({
  name: "NABO Africa Money Market Fund",
  issuer: "Nabo Capital Ltd.",
  assetClass: "money_market",
  currency: "KES",
  market: null,
  notes: "No unit price or maturity stated (money-market fund).",
  recommendation: "strong buy", // verdict field — must be stripped
  figures: [
    {
      field: "yield",
      value: "9.25",
      quote: "Effective annual yield (net, as at 31 May 2026): 9.25% p.a.",
      asOf: "2026-05-31",
      rating: 5, // per-figure verdict — must be stripped
    },
    {
      field: "expense",
      value: "1.50",
      quote: "Management fee: 1.50% per annum of net asset value.",
      asOf: null,
    },
    {
      // No quote → cannot be confirmed → dropped by the parser.
      field: "price",
      value: "100000",
      quote: "",
      asOf: null,
    },
  ],
});

describe("Part 8 — fixture document extraction", () => {
  it("extracts present fields verbatim and leaves absent fields null", () => {
    const extraction = parseExtractionResponse(STUBBED_MODEL_JSON);
    expect(extraction).not.toBeNull();
    const e = extraction!;

    expect(e.name).toBe("NABO Africa Money Market Fund");
    expect(e.issuer).toBe("Nabo Capital Ltd.");
    expect(e.currency).toBe("KES");
    // Absent in the document → must be null, never guessed.
    expect(e.market).toBeNull();

    // Two figures survive (yield + expense); the quote-less price figure is dropped.
    const keys = e.figures.map((f) => f.field).sort();
    expect(keys).toEqual(["expense", "yield"]);

    const yieldFig = e.figures.find((f) => f.field === "yield")!;
    expect(yieldFig.value).toBe("9.25"); // verbatim, not annualised/computed
    expect(yieldFig.quote).toContain("9.25% p.a.");
    expect(yieldFig.asOf).toBe("2026-05-31");

    // The maturity / coupon / price the document never states must be entirely absent.
    expect(e.figures.find((f) => f.field === "maturity")).toBeUndefined();
    expect(e.figures.find((f) => f.field === "price")).toBeUndefined();
  });

  it("strips any verdict/ranking field the model tried to smuggle in", () => {
    const extraction = parseExtractionResponse(STUBBED_MODEL_JSON)!;
    // The shape has no place for a verdict, and the figures carry only facts.
    expect((extraction as Record<string, unknown>).recommendation).toBeUndefined();
    for (const f of extraction.figures) {
      expect((f as Record<string, unknown>).rating).toBeUndefined();
    }
  });

  it("maps every figure to the ai_extracted trust floor with its source quote", () => {
    const extraction = parseExtractionResponse(STUBBED_MODEL_JSON)!;
    const adapter = extractionToAdapterResult({
      extraction,
      sourceLabel: "NABO MMF Fact Sheet (May 2026)",
      sourceUrl: "https://example.com/nabo-mmf.pdf",
    });
    // Same AdapterResult shape a scraper produces — one instrument, neutral fields.
    expect(adapter.instruments).toHaveLength(1);
    const inst = adapter.instruments[0];
    expect(inst.name).toBe("NABO Africa Money Market Fund");

    const { map, flagged } = aiInstrumentToProvenanceMap(inst, { at: 1_700_000_000_000, model: "test-model" });

    // Both plausible figures present, every one at the ai_extracted floor.
    expect(Object.keys(map).sort()).toEqual(["expense", "yield"]);
    for (const prov of Object.values(map)) {
      expect(prov!.verificationState).toBe("ai_extracted");
      expect(prov!.aiModel).toBe("test-model");
      expect(prov!.source).toContain("NABO MMF Fact Sheet");
    }
    // These are plausible, so nothing is flagged.
    expect(flagged).toHaveLength(0);
    expect(map.yield!.reviewFlag ?? null).toBeNull();
  });

  it("flags an implausible figure via the numeric sanity gate (not saved as clean)", () => {
    // Same document, but the model MISREAD the yield as 925 (decimal slip).
    const misread = JSON.parse(STUBBED_MODEL_JSON);
    misread.figures[0].value = "925";
    const extraction = parseExtractionResponse(JSON.stringify(misread))!;
    const adapter = extractionToAdapterResult({
      extraction,
      sourceLabel: "NABO MMF Fact Sheet (May 2026)",
      sourceUrl: null,
    });
    const { map, flagged } = aiInstrumentToProvenanceMap(adapter.instruments[0], {
      at: 1_700_000_000_000,
      model: "test-model",
    });

    // The figure is kept (so the human sees it) but carries a loud review flag, and is
    // reported in `flagged` — it is never treated as a clean ai_extracted value.
    const flaggedYield = flagged.find((f) => f.key === "yield");
    expect(flaggedYield).toBeDefined();
    expect(map.yield!.verificationState).toBe("ai_extracted");
    expect(map.yield!.reviewFlag).toBeTruthy();
  });

  it("discovery returns a neutral, de-duplicated, suggestion-only candidate list", () => {
    const stubbed = JSON.stringify({
      candidates: [
        {
          name: "CIC Money Market Fund",
          issuer: "CIC Asset Management",
          assetClass: "money_market",
          currency: "KES",
          scopeReason: "Regulated Kenyan money-market fund, KES-denominated.",
          sourceUrl: "https://example.com/cic",
        },
        {
          // Duplicate name (case-insensitive) — must be collapsed.
          name: "cic money market fund",
          issuer: "CIC Asset Management",
          assetClass: "money_market",
          currency: "KES",
          scopeReason: "duplicate",
          sourceUrl: null,
        },
        {
          name: "Sanlam Money Market Fund",
          issuer: "Sanlam Investments",
          assetClass: "money_market",
          currency: "KES",
          scopeReason: "Regulated Kenyan money-market fund.",
          sourceUrl: null,
          rank: 1, // verdict field — must be stripped, never surfaced
        },
      ],
    });

    const candidates = parseDiscoveryResponse(stubbed);
    expect(candidates).toHaveLength(2); // duplicate collapsed
    const names = candidates.map((c) => c.name);
    expect(names).toContain("CIC Money Market Fund");
    expect(names).toContain("Sanlam Money Market Fund");
    // No ranking/score leaks through — the candidate shape has no such field.
    for (const c of candidates) {
      expect((c as Record<string, unknown>).rank).toBeUndefined();
      expect((c as Record<string, unknown>).score).toBeUndefined();
    }
  });
});
