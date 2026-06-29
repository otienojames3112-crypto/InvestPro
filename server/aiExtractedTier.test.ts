import { describe, it, expect } from "vitest";
import {
  aiExtractedField,
  scrapedField,
  humanField,
  applyVerification,
  effectiveState,
  effectiveStateForClass,
  mergeScrape,
  mergeAiExtraction,
  summariseState,
  trustRank,
  stateLabel,
  viewerStateLabel,
  modelFreshnessPrompt,
  type FieldProvenance,
  type FieldProvenanceMap,
} from "../shared/provenance";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 29, 12, 0, 0); // 29-Jun-2026

function ai(value = "9.10", asOf: number | null = NOW): FieldProvenance {
  return aiExtractedField({
    value,
    source: "ILAM fact sheet Q1-2026 (AI-read)",
    sourceUrl: "https://example.com/factsheet.pdf",
    asOf,
    at: NOW,
    model: "test-model",
  });
}

describe("Part 8 — ai_extracted is the lowest-trust tier", () => {
  it("ranks below every other state", () => {
    for (const s of ["stale", "scraped_unverified", "human_verified", "human_entered"] as const) {
      expect(trustRank("ai_extracted")).toBeLessThan(trustRank(s));
    }
  });

  it("aiExtractedField starts at ai_extracted with no human stamps and records the model", () => {
    const p = ai();
    expect(p.verificationState).toBe("ai_extracted");
    expect(p.verifiedBy).toBeNull();
    expect(p.verifiedAt).toBeNull();
    expect(p.aiModel).toBe("test-model");
    expect(p.source).toContain("ILAM");
    expect(p.sourceUrl).toBe("https://example.com/factsheet.pdf");
  });

  it("labels read as provisional and cite the source in both first-person and viewer views", () => {
    const expected = "AI-extracted · unverified — confirm against source";
    expect(stateLabel("ai_extracted")).toBe(expected);
    expect(viewerStateLabel("ai_extracted")).toBe(expected);
  });
});

describe("Part 8 — ai_extracted never auto-promotes by age", () => {
  it("stays ai_extracted no matter how old (does NOT become stale)", () => {
    const old = ai("9.10", NOW - 400 * DAY);
    expect(effectiveState(old, NOW)).toBe("ai_extracted");
    expect(effectiveStateForClass(old, NOW, "cash_mmf")).toBe("ai_extracted");
    expect(effectiveStateForClass(old, NOW, "equity")).toBe("ai_extracted");
  });
});

describe("Part 8 — no-clobber: AI can never overwrite more-trusted data", () => {
  it("mergeAiExtraction fills an EMPTY slot", () => {
    const out = mergeAiExtraction(undefined, ai("9.10"));
    expect(out.verificationState).toBe("ai_extracted");
    expect(out.value).toBe("9.10");
  });

  it("mergeAiExtraction does NOT overwrite a scraped value", () => {
    const scraped = scrapedField({ value: "8.45", source: "NSE", asOf: NOW });
    const out = mergeAiExtraction(scraped, ai("9.10"));
    expect(out).toBe(scraped); // untouched reference
    expect(out.value).toBe("8.45");
    expect(out.verificationState).toBe("scraped_unverified");
  });

  it("mergeAiExtraction does NOT overwrite a human value", () => {
    const human = humanField({ value: "8.50", source: "broker note", by: "James", at: NOW });
    const out = mergeAiExtraction(human, ai("9.10"));
    expect(out.value).toBe("8.50");
    expect(out.verificationState).toBe("human_entered");
  });

  it("mergeAiExtraction does NOT overwrite a prior AI value (no AI-on-AI clobber)", () => {
    const prior = ai("9.10");
    const out = mergeAiExtraction(prior, ai("9.99"));
    expect(out.value).toBe("9.10");
  });
});

describe("Part 8 — a deterministic scrape MAY raise an ai_extracted figure", () => {
  it("a scrape overwrites ai_extracted (a known parser beats a possible hallucination)", () => {
    const aiFig = ai("9.10");
    const scraped = scrapedField({ value: "8.45", source: "NSE close", asOf: NOW });
    const out = mergeScrape(aiFig, scraped);
    expect(out.value).toBe("8.45");
    expect(out.verificationState).toBe("scraped_unverified");
    expect(trustRank(out.verificationState)).toBeGreaterThan(trustRank("ai_extracted"));
  });

  it("a scrape still never overwrites a human figure", () => {
    const human = humanField({ value: "8.50", source: "broker", by: "James", at: NOW });
    const scraped = scrapedField({ value: "8.45", source: "NSE", asOf: NOW + DAY });
    const out = mergeScrape(human, scraped);
    expect(out.value).toBe("8.50");
    expect(out.verificationState).toBe("human_entered");
  });
});

describe("Part 8 — a human action raises an AI figure to a human state", () => {
  it("confirm raises ai_extracted -> human_verified (value unchanged)", () => {
    const out = applyVerification(ai("9.10"), { kind: "confirm", by: "James", at: NOW + DAY });
    expect(out.verificationState).toBe("human_verified");
    expect(out.value).toBe("9.10");
    expect(out.verifiedBy).toBe("James");
  });

  it("override raises ai_extracted -> human_entered and changes the number + source", () => {
    const out = applyVerification(ai("9.10"), {
      kind: "override",
      by: "James",
      at: NOW + DAY,
      value: "8.50",
      source: "ILAM fact sheet Q1-2026 (confirmed)",
      sourceUrl: "https://example.com/factsheet.pdf",
    });
    expect(out.verificationState).toBe("human_entered");
    expect(out.value).toBe("8.50");
    expect(out.source).toContain("confirmed");
  });
});

describe("Part 8 — summariseState surfaces the weakest figure", () => {
  it("a single AI figure makes the row read ai_extracted even alongside a human figure", () => {
    const map: FieldProvenanceMap = {
      price: humanField({ value: "8.50", source: "broker", by: "James", at: NOW }),
      yield: ai("9.10"),
    };
    expect(summariseState(map)).toBe("ai_extracted");
  });
});

describe("Part 8 — modelFreshnessPrompt gives the most-urgent AI variant", () => {
  it("an AI driving figure produces an urgent, source-confirming prompt", () => {
    const map: FieldProvenanceMap = { yield: ai("9.10") };
    const r = modelFreshnessPrompt({ map, assetClass: "cash_mmf", nowMs: NOW });
    expect(r.shouldPrompt).toBe(true);
    expect(r.flagged.some((f) => f.state === "ai_extracted")).toBe(true);
    expect(r.message).toMatch(/AI/);
    expect(r.message).toMatch(/cited source/);
  });

  it("AI outranks stale/scrape when both are present among driving figures", () => {
    const map: FieldProvenanceMap = {
      price: scrapedField({ value: "10", source: "NSE", asOf: NOW - 400 * DAY }), // stale
      yield: ai("9.10"),
    };
    const r = modelFreshnessPrompt({ map, assetClass: "equity", drivingFields: ["price", "yield"], nowMs: NOW });
    expect(r.message).toMatch(/AI/);
  });
});
