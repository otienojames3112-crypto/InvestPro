import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isThinFetch,
  THIN_FETCH_MIN_CHARS,
  isVisionCapableModel,
  resolveVisionModel,
  aiExtractInstrument,
  extractionToProvenanceMap,
} from "./aiIntakeService";

/* ── Vision-capability allow-list ───────────────────────────────────────────── */

describe("Part 8.1 — isVisionCapableModel allow-list", () => {
  it("accepts known vision-capable model families", () => {
    for (const id of [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1",
      "gpt-5",
      "claude-3-5-sonnet",
      "claude-sonnet-4-6",
      "gemini-2.5-pro",
      "qwen2.5-vl-72b",
      "pixtral-12b",
    ]) {
      expect(isVisionCapableModel(id), id).toBe(true);
    }
  });

  it("rejects text-only models and empty/missing ids", () => {
    for (const id of ["gpt-3.5-turbo", "text-embedding-3-large", "deepseek-chat", "mistral-7b"]) {
      expect(isVisionCapableModel(id), id).toBe(false);
    }
    expect(isVisionCapableModel(null)).toBe(false);
    expect(isVisionCapableModel(undefined)).toBe(false);
    expect(isVisionCapableModel("")).toBe(false);
  });
});

/* ── Thin-fetch threshold (UX honesty, not a scraper knob) ──────────────────── */

describe("Part 8.1 — isThinFetch threshold", () => {
  it("flags text below the minimum and passes text at/above it", () => {
    expect(isThinFetch("")).toBe(true);
    expect(isThinFetch("a".repeat(THIN_FETCH_MIN_CHARS - 1))).toBe(true);
    expect(isThinFetch("a".repeat(THIN_FETCH_MIN_CHARS))).toBe(false);
    expect(isThinFetch("a".repeat(THIN_FETCH_MIN_CHARS + 500))).toBe(false);
  });

  it("trims whitespace before measuring (a whitespace-only page is thin)", () => {
    expect(isThinFetch("   \n\t   ".padEnd(THIN_FETCH_MIN_CHARS + 50, " "))).toBe(true);
  });
});

/* ── resolveVisionModel queries the gateway catalog ─────────────────────────── */

describe("Part 8.1 — resolveVisionModel", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns the first vision-capable id from the catalog", async () => {
    vi.spyOn(await import("./_core/llm"), "listLLMModels").mockResolvedValue({
      data: [{ id: "text-embedding-3-large" }, { id: "gpt-4o" }, { id: "gpt-5" }],
    } as never);
    expect(await resolveVisionModel()).toBe("gpt-4o");
  });

  it("returns null when no vision-capable model is available", async () => {
    vi.spyOn(await import("./_core/llm"), "listLLMModels").mockResolvedValue({
      data: [{ id: "gpt-3.5-turbo" }, { id: "deepseek-chat" }],
    } as never);
    expect(await resolveVisionModel()).toBeNull();
  });

  it("returns null (never throws) if the catalog call fails", async () => {
    vi.spyOn(await import("./_core/llm"), "listLLMModels").mockRejectedValue(new Error("offline"));
    expect(await resolveVisionModel()).toBeNull();
  });
});

/* ── Image extraction: vision guard + faithful transcription ────────────────── */

describe("Part 8.1 — aiExtractInstrument (image source)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("fails loudly when no vision-capable model is available", async () => {
    const llm = await import("./_core/llm");
    vi.spyOn(llm, "listLLMModels").mockResolvedValue({
      data: [{ id: "gpt-3.5-turbo" }],
    } as never);
    const invoke = vi.spyOn(llm, "invokeLLM");
    await expect(
      aiExtractInstrument({ source: { kind: "image", imageUrl: "https://x/y.png" } }),
    ).rejects.toThrow(/can't read images/i);
    // The guard short-circuits before any (billable) LLM call is made.
    expect(invoke).not.toHaveBeenCalled();
  });

  it("sends the image to a resolved vision model and parses fields (nulls over guesses)", async () => {
    const llm = await import("./_core/llm");
    vi.spyOn(llm, "listLLMModels").mockResolvedValue({
      data: [{ id: "gpt-4o" }],
    } as never);
    const invoke = vi.spyOn(llm, "invokeLLM").mockResolvedValue({
      model: "gpt-4o",
      choices: [
        {
          message: {
            content: JSON.stringify({
              name: "CIC MMF",
              issuer: "CIC",
              assetClass: "cash_mmf",
              currency: "KES",
              figures: [
                // present in the screenshot → extracted
                { field: "yield", value: "9.25", quote: "Net yield 9.25%", asOf: null },
                // not visible in the screenshot → the model omitted it (no guess)
              ],
            }),
          },
        },
      ],
    } as never);

    const { extraction, model } = await aiExtractInstrument({
      source: { kind: "image", imageUrl: "https://store/screenshot.png" },
    });

    expect(model).toBe("gpt-4o");
    expect(extraction).not.toBeNull();
    expect(extraction!.figures.map((f) => f.field)).toEqual(["yield"]);
    expect(extraction!.figures[0].value).toBe("9.25");
    // Price was absent → it is simply not present (null/omitted), never fabricated.
    expect(extraction!.figures.find((f) => f.field === "price")).toBeUndefined();

    // It actually used the resolved vision model and sent an image_url content block.
    const call = invoke.mock.calls[0][0] as {
      model?: string;
      temperature?: number;
      messages: Array<{ role: string; content: unknown }>;
    };
    expect(call.model).toBe("gpt-4o");
    expect(call.temperature).toBe(0); // accuracy-first
    const userMsg = call.messages.find((m) => m.role === "user")!;
    const blocks = userMsg.content as Array<{ type: string; image_url?: { url: string } }>;
    const img = blocks.find((b) => b.type === "image_url");
    expect(img?.image_url?.url).toBe("https://store/screenshot.png");
  });
});

/* ── Image provenance lands at the ai_extracted floor with an image-cited source ─ */

describe("Part 8.1 — image provenance", () => {
  it("stamps every image figure at ai_extracted, carrying the screenshot-cited label + quote", () => {
    const label = "read from an uploaded screenshot of CIC MMF fact sheet, 2026-06-29";
    const map = extractionToProvenanceMap({
      extraction: {
        name: "CIC MMF",
        figures: [{ field: "yield", value: "9.25", quote: "Net yield 9.25%", asOf: null }],
      },
      sourceLabel: label,
      sourceUrl: null,
      model: "gpt-4o",
      at: 1_700_000_000_000,
    });
    const y = map.yield!;
    expect(y.verificationState).toBe("ai_extracted");
    expect(y.value).toBe("9.25");
    expect(y.source).toContain("uploaded screenshot");
    expect(y.source).toContain("Net yield 9.25%");
    expect(y.aiModel).toBe("gpt-4o");
    expect(y.verifiedBy).toBeNull();
  });
});
