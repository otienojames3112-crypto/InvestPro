/**
 * Stage 4, Step 4.2a — searchAuthoritativeSource() (isolated, no live OpenAI calls).
 *
 * Every test injects a mock `fetchImpl` — the global `fetch` is never touched, so
 * there is no possibility of a live network/OpenAI call from this suite. Not wired
 * into runResearchQuestion/routers.ts/UI, so nothing here exercises the live Ask AI
 * flow, source classification, extraction schemas, the approval gate, promotion,
 * holdings, or tax.
 */
import { describe, expect, it, vi } from "vitest";

// This workspace/CI may have no OPENAI_API_KEY set at all. searchAuthoritativeSource
// correctly treats a missing key as search_failed (tested separately below) — but
// every OTHER test here needs a key configured so it actually reaches the mocked
// fetchImpl and exercises the real request/response handling. Mocking ./env (rather
// than mutating process.env) is deterministic regardless of module load order.
vi.mock("./_core/env", () => ({
  ENV: { openaiApiKey: "test-key", openaiBaseUrl: "", openaiModel: "" },
}));

const { searchAuthoritativeSource } = await import("./_core/webSearch");

/** A minimal successful Responses API reply with real url_citation annotations. */
function responsesReplyWithCitations() {
  return {
    output: [
      { type: "web_search_call" },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "The 91-day T-bill rate is 8.8347% as of 2026-07-02.",
            annotations: [
              { type: "url_citation", url: "https://www.centralbank.go.ke/results", title: "CBK Auction Results" },
            ],
          },
        ],
      },
    ],
  };
}

/** A Responses API reply with an answer but NO url_citation annotations. */
function responsesReplyNoCitations() {
  return {
    output: [
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "The rate is around 8.8%.", annotations: [] }],
      },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("Stage 4.2a · searchAuthoritativeSource", () => {
  it("1. no route returns ok:false and does not call fetch", async () => {
    const fetchImpl = vi.fn();
    const result = await searchAuthoritativeSource({
      catalogue: "market_asset",
      subtype: "pension", // no route registered for pension (Step 4.1)
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_route");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("2. a successful search with URL citations returns ok:true with text/citations/label", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(responsesReplyWithCitations()));
    const result = await searchAuthoritativeSource({
      catalogue: "cbk",
      instrumentHint: "91-Day Treasury Bill",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.kind).toBe("search");
      expect(result.text).toContain("8.8347%");
      expect(result.citations).toHaveLength(1);
      expect(result.citations[0].url).toBe("https://www.centralbank.go.ke/results");
      expect(result.citations[0].title).toBe("CBK Auction Results");
      expect(result.sourceLabel).toMatch(/central bank of kenya/i);
      expect(result.catalogue).toBe("cbk");
      expect(typeof result.searchedAt).toBe("number");
    }
  });

  it("3. a response with no URL citations returns ok:false, reason: no_citations", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(responsesReplyNoCitations()));
    const result = await searchAuthoritativeSource({
      catalogue: "cbk",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no_citations");
      expect(result.message).toMatch(/no real url citation/i);
    }
  });

  it("4a. a network error returns ok:false, reason: search_failed", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    const result = await searchAuthoritativeSource({
      catalogue: "mmf",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("search_failed");
      expect(result.message).toMatch(/ECONNRESET/);
    }
  });

  it("4b. a non-2xx API response returns ok:false, reason: search_failed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: "bad request" }, 400));
    const result = await searchAuthoritativeSource({
      catalogue: "bank",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("search_failed");
  });

  it("5. fixed-domain sources from the Stage 4.1 routing table are passed as allowed_domains", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(responsesReplyWithCitations()));
    await searchAuthoritativeSource({ catalogue: "cbk", fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.tools[0].type).toBe("web_search");
    expect(body.tools[0].filters.allowed_domains).toEqual(
      expect.arrayContaining(["centralbank.go.ke", "dhowcsd.centralbank.go.ke"]),
    );
  });

  it("6. variable-domain sources (no fixed domain) are described in the instruction text, not faked as a domain filter", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(responsesReplyWithCitations()));
    await searchAuthoritativeSource({ catalogue: "mmf", fetchImpl: fetchImpl as unknown as typeof fetch });

    const [, init] = fetchImpl.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);
    // MMF's primary source (the fund manager's own factsheet) has NO fixed domain —
    // it must be named in the prompt text, and must NOT appear in allowed_domains.
    expect(body.input).toMatch(/fund manager/i);
    expect(body.tools[0].filters?.allowed_domains ?? []).not.toContain(undefined);
    expect(body.tools[0].filters?.allowed_domains ?? []).toEqual(["cma.or.ke"]); // only the fixed-domain secondary
  });

  it("7. no live OpenAI call occurs — every test above injects a mock fetchImpl, global fetch is never touched", async () => {
    const globalFetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = globalFetchSpy as unknown as typeof fetch;
    try {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(responsesReplyWithCitations()));
      await searchAuthoritativeSource({ catalogue: "cbk", fetchImpl: fetchImpl as unknown as typeof fetch });
      expect(globalFetchSpy).not.toHaveBeenCalled();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns search_failed (never throws) when no API key is configured — and never calls fetch", async () => {
    const { ENV } = await import("./_core/env");
    const original = ENV.openaiApiKey;
    ENV.openaiApiKey = "";
    try {
      const fetchImpl = vi.fn();
      const result = await searchAuthoritativeSource({
        catalogue: "cbk",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("search_failed");
      expect(fetchImpl).not.toHaveBeenCalled();
    } finally {
      ENV.openaiApiKey = original;
    }
  });
});
