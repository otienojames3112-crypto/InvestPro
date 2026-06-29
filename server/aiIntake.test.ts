import { describe, it, expect } from "vitest";
import {
  parseExtractionResponse,
  parseDiscoveryResponse,
  parseJsonLoose,
  contentToText,
  extractionToProvenanceMap,
} from "./aiIntakeService";
import {
  stripVerdictFields,
  isUsableExtraction,
  FORBIDDEN_VERDICT_KEYS,
  AI_EXTRACTABLE_FIELDS,
} from "../shared/aiIntake";
import {
  reconcileAiExtraction,
  mergeAiExtraction,
  aiExtractedField,
  scrapedField,
  humanField,
  type FieldProvenanceMap,
} from "../shared/provenance";

/* ── Structural guarantee: AI output cannot carry a verdict ─────────────────── */

describe("Part 8 — AI cannot rank/score/recommend (structural)", () => {
  it("stripVerdictFields removes every forbidden key at any depth", () => {
    const dirty = {
      name: "ACME Bond",
      score: 9.1,
      rating: "AAA",
      recommendation: "buy",
      figures: [{ field: "coupon", value: "13.5", quote: "coupon 13.5%", rank: 1, confidence: 0.9 }],
      nested: { best: true, quality: "high", keep: "this" },
    };
    const clean = stripVerdictFields(dirty) as Record<string, unknown>;
    const flat = JSON.stringify(clean);
    for (const k of FORBIDDEN_VERDICT_KEYS) {
      expect(flat).not.toContain(`"${k}":`);
    }
    // Non-verdict content survives.
    expect(clean.name).toBe("ACME Bond");
    expect((clean.nested as Record<string, unknown>).keep).toBe("this");
    expect((clean.figures as unknown[]).length).toBe(1);
  });

  it("parseExtractionResponse strips a hallucinated ranking before it can enter", () => {
    const raw = JSON.stringify({
      name: "CIC MMF",
      issuer: "CIC",
      assetClass: "cash_mmf",
      currency: "KES",
      market: null,
      notes: null,
      recommendation: "strong buy", // hallucinated verdict
      figures: [{ field: "yield", value: "9.25", quote: "Net annual yield 9.25%", asOf: null, score: 5 }],
    });
    const parsed = parseExtractionResponse(raw)!;
    expect(parsed).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain("recommendation");
    expect(JSON.stringify(parsed)).not.toContain("score");
    expect(parsed.figures[0].value).toBe("9.25");
  });

  it("the extractable field set is exactly the factual figure keys (no score key exists)", () => {
    expect(AI_EXTRACTABLE_FIELDS).not.toContain("score");
    expect(AI_EXTRACTABLE_FIELDS).not.toContain("rating");
  });
});

/* ── Extraction parsing: facts must cite a quote ────────────────────────────── */

describe("Part 8 — extraction parsing", () => {
  it("drops figures that lack a confirming quote (the librarian must show its work)", () => {
    const raw = JSON.stringify({
      name: "FXD1/2041",
      figures: [
        { field: "coupon", value: "13.5", quote: "Coupon: 13.50%", asOf: null },
        { field: "tenor", value: "15", quote: "", asOf: null }, // no quote → dropped
        { field: "maturity", value: "2041-03-01", quote: "Matures 1 Mar 2041", asOf: null },
      ],
    });
    const parsed = parseExtractionResponse(raw)!;
    const fields = parsed.figures.map((f) => f.field).sort();
    expect(fields).toEqual(["coupon", "maturity"]);
  });

  it("ignores unknown figure keys and de-dupes repeated keys (first wins)", () => {
    const raw = JSON.stringify({
      name: "Test",
      figures: [
        { field: "yield", value: "9.0", quote: "yield 9.0%", asOf: null },
        { field: "yield", value: "9.9", quote: "yield 9.9%", asOf: null }, // dup → ignored
        { field: "nonsense", value: "x", quote: "x", asOf: null }, // unknown → ignored
      ],
    });
    const parsed = parseExtractionResponse(raw)!;
    expect(parsed.figures.length).toBe(1);
    expect(parsed.figures[0].value).toBe("9.0");
  });

  it("returns null when there is no usable instrument", () => {
    expect(parseExtractionResponse('{"figures": []}')).toBeNull(); // no name
    expect(parseExtractionResponse("not json at all")).toBeNull();
  });

  it("parses JSON wrapped in ```json fences", () => {
    const fenced = "```json\n" + JSON.stringify({ name: "X", figures: [] }) + "\n```";
    expect(parseJsonLoose(fenced)).toMatchObject({ name: "X" });
    expect(isUsableExtraction(parseJsonLoose(fenced))).toBe(true);
  });

  it("contentToText flattens array content blocks", () => {
    expect(contentToText([{ type: "text", text: "he" }, { type: "text", text: "llo" }])).toBe("hello");
    expect(contentToText("hi")).toBe("hi");
  });
});

/* ── Discovery parsing: suggestions only, never ranked ──────────────────────── */

describe("Part 8 — discovery parsing", () => {
  it("dedupes by name and keeps neutral scope reasons (no ranking field survives)", () => {
    const raw = JSON.stringify({
      candidates: [
        { name: "CIC MMF", assetClass: "cash_mmf", currency: "KES", scopeReason: "KES MMF", rank: 1 },
        { name: "cic mmf", assetClass: "cash_mmf" }, // case-dupe → dropped
        { name: "Sanlam MMF", scopeReason: "KES MMF", recommendation: "best" },
      ],
    });
    const out = parseDiscoveryResponse(raw);
    expect(out.map((c) => c.name)).toEqual(["CIC MMF", "Sanlam MMF"]);
    expect(JSON.stringify(out)).not.toContain("rank");
    expect(JSON.stringify(out)).not.toContain("recommendation");
  });

  it("returns an empty list for malformed payloads", () => {
    expect(parseDiscoveryResponse("garbage")).toEqual([]);
    expect(parseDiscoveryResponse("{}")).toEqual([]);
  });
});

/* ── Provenance mapping: every figure lands at ai_extracted with a quote ─────── */

describe("Part 8 — extractionToProvenanceMap", () => {
  it("maps figures to ai_extracted provenance carrying the cited source + quote", () => {
    const map = extractionToProvenanceMap({
      extraction: {
        name: "CIC MMF",
        figures: [{ field: "yield", value: "9.25", quote: "Net annual yield 9.25%", asOf: "2026-05-01" }],
      },
      sourceLabel: "CIC fact sheet",
      sourceUrl: "https://example.com/cic",
      model: "test-model",
      at: 1_700_000_000_000,
    });
    const y = map.yield!;
    expect(y.verificationState).toBe("ai_extracted");
    expect(y.value).toBe("9.25");
    expect(y.source).toContain("CIC fact sheet");
    expect(y.source).toContain("Net annual yield 9.25%");
    expect(y.aiModel).toBe("test-model");
    expect(y.verifiedBy).toBeNull();
  });
});

/* ── No-clobber: AI fills blanks only; conflicts go to review ───────────────── */

const AT = 1_700_000_000_000;
const ai = (value: string) =>
  aiExtractedField({ value, source: "AI doc", sourceUrl: null, asOf: null, at: AT, model: "m" });

describe("Part 8 — reconcileAiExtraction never clobbers", () => {
  it("fills an empty slot with the AI value (lowest trust)", () => {
    const existing: FieldProvenanceMap = {};
    const { merged, conflicts, changed } = reconcileAiExtraction(existing, { yield: ai("9.25") });
    expect(changed).toBe(true);
    expect(conflicts).toHaveLength(0);
    expect(merged.yield!.verificationState).toBe("ai_extracted");
    expect(merged.yield!.value).toBe("9.25");
  });

  it("never overwrites a human-entered figure — disagreement becomes a conflict", () => {
    const existing: FieldProvenanceMap = {
      yield: humanField({ value: "8.00", by: "Owner", at: AT, source: "Owner check" }),
    };
    const { merged, conflicts, changed } = reconcileAiExtraction(existing, { yield: ai("9.25") });
    expect(merged.yield!.value).toBe("8.00"); // human untouched
    expect(merged.yield!.verificationState).toBe("human_entered");
    expect(changed).toBe(false);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ field: "yield", humanValue: "8.00", scrapedValue: "9.25" });
  });

  it("never overwrites a scraped figure either — AI is below scraped", () => {
    const existing: FieldProvenanceMap = {
      price: scrapedField({ value: "101.5", source: "NSE", sourceUrl: null, asOf: AT, fetchedAt: AT }),
    };
    const { merged, conflicts } = reconcileAiExtraction(existing, { price: ai("99.0") });
    expect(merged.price!.value).toBe("101.5");
    expect(merged.price!.verificationState).toBe("scraped_unverified");
    expect(conflicts).toHaveLength(1);
  });

  it("drops an agreeing AI value silently (AI cannot RAISE trust)", () => {
    const existing: FieldProvenanceMap = {
      yield: scrapedField({ value: "9.25", source: "NSE", sourceUrl: null, asOf: AT, fetchedAt: AT }),
    };
    const { merged, conflicts, changed } = reconcileAiExtraction(existing, { yield: ai("9.25") });
    expect(merged.yield!.verificationState).toBe("scraped_unverified"); // unchanged
    expect(changed).toBe(false);
    expect(conflicts).toHaveLength(0);
  });

  it("mergeAiExtraction fills only a blank slot and yields to any existing value", () => {
    expect(mergeAiExtraction(undefined, ai("9.25")).verificationState).toBe("ai_extracted");
    const human = humanField({ value: "8.0", by: "Owner", at: AT, source: "x" });
    expect(mergeAiExtraction(human, ai("9.25"))).toBe(human); // existing wins
  });
});
