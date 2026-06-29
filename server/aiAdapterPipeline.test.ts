import { describe, it, expect } from "vitest";
import {
  extractionToAdapterResult,
  aiInstrumentToProvenanceMap,
  aiRefFromName,
} from "@shared/aiAdapter";
import { checkFigureSanity, parseNumeric } from "@shared/figureSanity";
import {
  reconcileAiExtraction,
  scrapedField,
  humanField,
  aiExtractedField,
  isAiProvisionalRow,
  hasAiExtractedFigure,
  countAiFigures,
  type FieldProvenanceMap,
} from "@shared/provenance";
import { stripVerdictFields } from "@shared/aiIntake";
import { AI_INTAKE_SOURCE_ID as AI_SRC } from "@shared/ingestion";
import type { AiInstrumentExtraction } from "@shared/aiIntake";

const NOW = Date.UTC(2026, 5, 1);

function sampleExtraction(over: Partial<AiInstrumentExtraction> = {}): AiInstrumentExtraction {
  return {
    name: "Acme Shilling Money Market Fund",
    issuer: "Acme Asset Managers",
    assetClass: "mmf",
    currency: "KES",
    market: null,
    figures: [
      { field: "yield", value: "9.25", quote: "The fund’s effective annual yield was 9.25% p.a." },
      { field: "expense", value: "2.0", quote: "Management fee: 2.0% per annum." },
    ],
    notes: null,
    ...over,
  };
}

describe("Part 8 deeper — AI extraction rides the same adapter pipeline", () => {
  it("maps an extraction onto the exact AdapterResult/ScrapedInstrument shape", () => {
    const res = extractionToAdapterResult({
      extraction: sampleExtraction(),
      ref: null,
      sourceLabel: "Acme fact sheet Q2-2026",
      sourceUrl: "https://acme.example/factsheet.pdf",
    });
    // Conflicts from AI are attributed to the non-scraper AI source id, not a real scraper.
    expect(res.sourceId).toBe(AI_SRC);
    expect(res.instruments).toHaveLength(1);
    const inst = res.instruments[0];
    expect(inst.ref).toBe(aiRefFromName("Acme Shilling Money Market Fund"));
    expect(inst.figures.map((f) => f.key).sort()).toEqual(["expense", "yield"]);
    // The figure source carries the cited label + the verbatim quote for one-glance confirm.
    const y = inst.figures.find((f) => f.key === "yield")!;
    expect(y.source).toContain("Acme fact sheet Q2-2026");
    expect(y.source).toContain("9.25% p.a.");
    expect(y.sourceUrl).toBe("https://acme.example/factsheet.pdf");
  });

  it("stamps every figure at the ai_extracted floor (never scraped_unverified)", () => {
    const res = extractionToAdapterResult({
      extraction: sampleExtraction(),
      sourceLabel: "Acme fact sheet",
      sourceUrl: null,
    });
    const { map } = aiInstrumentToProvenanceMap(res.instruments[0], { at: NOW, model: "test-model" });
    for (const p of Object.values(map)) {
      expect(p!.verificationState).toBe("ai_extracted");
      expect(p!.aiModel).toBe("test-model");
    }
  });
});

describe("Part 8 deeper — numeric sanity gates flag implausible values (never silently saved clean)", () => {
  it("passes plausible rate-like and price values", () => {
    expect(checkFigureSanity("yield", "9.25").ok).toBe(true);
    expect(checkFigureSanity("coupon", "13.5%").ok).toBe(true);
    expect(checkFigureSanity("price", "101.20").ok).toBe(true);
    expect(checkFigureSanity("expense", "2.0").ok).toBe(true);
    expect(checkFigureSanity("tenor", "5").ok).toBe(true);
    expect(checkFigureSanity("fx", "129.5").ok).toBe(true);
  });

  it("flags a misread-decimal yield above the 25% ceiling", () => {
    const v = checkFigureSanity("yield", "925");
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/implausible/i);
  });

  it("flags a negative price / zero price", () => {
    expect(checkFigureSanity("price", "-5").ok).toBe(false);
    expect(checkFigureSanity("price", "0").ok).toBe(false);
  });

  it("flags a fee above 5% and a negative fee", () => {
    expect(checkFigureSanity("expense", "12").ok).toBe(false);
    expect(checkFigureSanity("expense", "-1").ok).toBe(false);
  });

  it("flags an absurd tenor and a non-positive / percent fx", () => {
    expect(checkFigureSanity("tenor", "250").ok).toBe(false);
    expect(checkFigureSanity("fx", "0").ok).toBe(false);
    expect(checkFigureSanity("fx", "5%").ok).toBe(false);
  });

  it("passes non-numeric figures (the gate only governs numbers)", () => {
    expect(checkFigureSanity("maturity", "2041-03-01").ok).toBe(true);
    expect(parseNumeric("not a number")).toBeNull();
  });

  it("attaches a neutral reviewFlag to flagged figures in the provenance map and lists them", () => {
    const res = extractionToAdapterResult({
      extraction: sampleExtraction({
        figures: [
          { field: "yield", value: "925", quote: "yield 925" }, // misread decimal
          { field: "expense", value: "2.0", quote: "fee 2.0%" }, // fine
        ],
      }),
      sourceLabel: "src",
      sourceUrl: null,
    });
    const { map, flagged } = aiInstrumentToProvenanceMap(res.instruments[0], { at: NOW, model: null });
    expect(flagged.map((f) => f.key)).toEqual(["yield"]);
    expect(map.yield!.reviewFlag).toMatch(/implausible/i);
    expect(map.expense!.reviewFlag ?? null).toBeNull();
    // Flagging never changes trust ordering — still ai_extracted, still provisional.
    expect(map.yield!.verificationState).toBe("ai_extracted");
  });
});

describe("Part 8 deeper — AI never clobbers a human or scraped value (no-clobber via reconcile)", () => {
  const aiMap: FieldProvenanceMap = {
    yield: aiExtractedField({ value: "9.25", source: "AI doc", at: NOW }),
    price: aiExtractedField({ value: "100.0", source: "AI doc", at: NOW }),
  };

  it("fills only empty slots; leaves a human value untouched and routes disagreement to conflicts", () => {
    const existing: FieldProvenanceMap = {
      yield: humanField({ value: "8.0", source: "ILAM sheet", by: "Jane", at: NOW }),
    };
    const r = reconcileAiExtraction(existing, aiMap);
    // Human yield kept as-is.
    expect(r.merged.yield!.value).toBe("8.0");
    expect(r.merged.yield!.verificationState).toBe("human_entered");
    // The disagreeing AI yield becomes a conflict, never an overwrite.
    expect(r.conflicts.some((c) => c.field === "yield")).toBe(true);
    // The empty price slot is filled at the ai_extracted floor.
    expect(r.merged.price!.verificationState).toBe("ai_extracted");
  });

  it("does not overwrite a scraped value either (scrape outranks AI)", () => {
    const existing: FieldProvenanceMap = {
      yield: scrapedField({ value: "9.25", source: "scraper", asOf: NOW, fetchedAt: NOW }),
    };
    const r = reconcileAiExtraction(existing, aiMap);
    // Agreeing AI value is silently dropped (nothing to confirm), scrape kept.
    expect(r.merged.yield!.verificationState).toBe("scraped_unverified");
    expect(r.conflicts.some((c) => c.field === "yield")).toBe(false);
  });
});

describe("Part 8 deeper — visibility predicates", () => {
  it("isAiProvisionalRow is true only when EVERY figure is ai_extracted", () => {
    const allAi: FieldProvenanceMap = {
      yield: aiExtractedField({ value: "9", source: "d", at: NOW }),
      price: aiExtractedField({ value: "100", source: "d", at: NOW }),
    };
    expect(isAiProvisionalRow(allAi)).toBe(true);

    const mixed: FieldProvenanceMap = {
      yield: humanField({ value: "9", source: "d", by: "Jane", at: NOW }),
      price: aiExtractedField({ value: "100", source: "d", at: NOW }),
    };
    // One confirmed figure makes the row visible (no longer AI-only).
    expect(isAiProvisionalRow(mixed)).toBe(false);
    // ...but it still has an AI figure awaiting review.
    expect(hasAiExtractedFigure(mixed)).toBe(true);
    expect(countAiFigures(mixed)).toBe(1);
  });

  it("an empty map is not provisional and has no AI figures", () => {
    expect(isAiProvisionalRow({})).toBe(false);
    expect(hasAiExtractedFigure({})).toBe(false);
    expect(countAiFigures({})).toBe(0);
  });
});

describe("Part 8 deeper — structural no-verdict guarantee still holds", () => {
  it("stripVerdictFields removes any smuggled ranking/score/recommendation key at depth", () => {
    const dirty = {
      name: "X",
      score: 9.9,
      figures: [{ field: "yield", value: "9", quote: "q", rating: "A", recommendation: "buy" }],
      best: true,
    } as unknown;
    const clean = stripVerdictFields(dirty) as Record<string, unknown>;
    expect(clean.score).toBeUndefined();
    expect((clean as { best?: unknown }).best).toBeUndefined();
    const fig = (clean.figures as Record<string, unknown>[])[0];
    expect(fig.rating).toBeUndefined();
    expect(fig.recommendation).toBeUndefined();
    // Factual fields survive.
    expect(fig.field).toBe("yield");
    expect(fig.value).toBe("9");
    expect(fig.quote).toBe("q");
  });
});
