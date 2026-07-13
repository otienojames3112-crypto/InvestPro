/**
 * Stage 4, Step 4.2b-ii — wiring searchAuthoritativeSource() into the research flow
 * (CBK; MMF as of Stage 7e; bank as of Stage 7f), behind an explicit `allowSearch`
 * opt-in.
 *
 * These tests exercise `shouldAttemptSearch`, `resolveSearchSource`, and
 * `searchFoundLabel` directly from aiResearchService.ts — the pure/injectable layer
 * that routers.ts's `ask` and `startResearchTask` mutations call. `resolveSearchSource`
 * always takes an injected `searchImpl`, so no test here ever calls the real
 * `searchAuthoritativeSource()` or touches global `fetch`/OpenAI. The routers.ts
 * call sites themselves (which persist to the DB) are exercised only by the existing
 * DB-dependent suites (e.g. round91SourceReadGating.test.ts), unchanged by this step.
 */
import { describe, expect, it, vi } from "vitest";
import {
  shouldAttemptSearch,
  resolveSearchSource,
  searchFailureMessage,
  searchFoundLabel,
  UNSUPPORTED_SEARCH_SCOPE_MESSAGE,
  type SearchSourceResolution,
} from "./aiResearchService";
import type { SearchSourceResult } from "./_core/webSearch";

function okResult(overrides?: Partial<Extract<SearchSourceResult, { ok: true }>>): SearchSourceResult {
  return {
    ok: true,
    kind: "search",
    text: "The 91-day T-bill rate is 8.8347% as of 2026-07-02.",
    citations: [{ url: "https://www.centralbank.go.ke/uploads/weekly_bulletin/bulletin.pdf", title: "CBK Weekly Bulletin" }],
    sourceLabel: "Central Bank of Kenya",
    catalogue: "cbk",
    subtype: null,
    searchedAt: Date.now(),
    ...overrides,
  };
}

function okMmfResult(overrides?: Partial<Extract<SearchSourceResult, { ok: true }>>): SearchSourceResult {
  return {
    ok: true,
    kind: "search",
    text: "Example MMF's EAR is 11.85% as of 2026-07-10.",
    citations: [{ url: "https://www.example-am.co.ke/mmf/factsheet.pdf", title: "Example MMF Factsheet" }],
    sourceLabel: "The fund manager's own factsheet",
    catalogue: "mmf",
    subtype: null,
    searchedAt: Date.now(),
    ...overrides,
  };
}

function okBankResult(overrides?: Partial<Extract<SearchSourceResult, { ok: true }>>): SearchSourceResult {
  return {
    ok: true,
    kind: "search",
    text: "Example Bank's 12-month fixed deposit indicative rate is 12.5% as of 2026-07-10.",
    citations: [{ url: "https://www.example-bank.co.ke/rates/fixed-deposit", title: "Example Bank Fixed Deposit Rates" }],
    sourceLabel: "The bank's own official rates / product page",
    catalogue: "bank",
    subtype: null,
    searchedAt: Date.now(),
    ...overrides,
  };
}

describe("Stage 4.2b-ii · shouldAttemptSearch (pure)", () => {
  it("1. CBK + no manual source + allowSearch:true → true (the only case that fires)", () => {
    expect(shouldAttemptSearch({ hasManualSource: false, allowSearch: true })).toBe(true);
  });

  it("2. a manual source ALWAYS wins, even when allowSearch is true", () => {
    expect(shouldAttemptSearch({ hasManualSource: true, allowSearch: true })).toBe(false);
  });

  it("allowSearch:false never attempts search, regardless of manual source", () => {
    expect(shouldAttemptSearch({ hasManualSource: false, allowSearch: false })).toBe(false);
    expect(shouldAttemptSearch({ hasManualSource: true, allowSearch: false })).toBe(false);
  });
});

describe("Stage 4.2b-ii · resolveSearchSource", () => {
  it("3. an unsupported scope (macro) returns a clear unsupported-scope result and never calls the search impl", async () => {
    const searchImpl = vi.fn();
    const resolution = await resolveSearchSource({
      scope: "macro",
      question: "What is the current inflation rate?",
      allowUnsourced: false,
      searchImpl: searchImpl as unknown as typeof import("./_core/webSearch").searchAuthoritativeSource,
    });
    expect(resolution.outcome).toBe("unsupported_scope");
    if (resolution.outcome === "unsupported_scope") expect(resolution.message).toBe(UNSUPPORTED_SEARCH_SCOPE_MESSAGE);
    expect(searchImpl).not.toHaveBeenCalled();
  });

  it("3b. market_asset is also unsupported (Stage 7f only enables cbk + mmf + bank)", async () => {
    const searchImpl = vi.fn();
    const resolution = await resolveSearchSource({
      scope: "market_asset",
      question: "What is the NSE price of this REIT?",
      allowUnsourced: false,
      searchImpl: searchImpl as unknown as typeof import("./_core/webSearch").searchAuthoritativeSource,
    });
    expect(resolution.outcome).toBe("unsupported_scope");
    expect(searchImpl).not.toHaveBeenCalled();
  });

  it("3c. the unsupported-scope message mentions all three supported scopes (CBK, MMF, bank)", () => {
    expect(UNSUPPORTED_SEARCH_SCOPE_MESSAGE).toMatch(/CBK/);
    expect(UNSUPPORTED_SEARCH_SCOPE_MESSAGE).toMatch(/MMF/i);
    expect(UNSUPPORTED_SEARCH_SCOPE_MESSAGE).toMatch(/bank/i);
  });

  it("4. a successful CBK search resolves to a url source with the real citation URL and a label carrying the title + 'AI search' wording", async () => {
    const searchImpl = vi.fn().mockResolvedValue(okResult());
    const resolution = await resolveSearchSource({
      scope: "cbk",
      question: "What is the current 91-day T-bill rate?",
      allowUnsourced: false,
      searchImpl,
    });
    expect(resolution.outcome).toBe("found");
    if (resolution.outcome === "found") {
      expect(resolution.source).toEqual({
        kind: "url",
        url: "https://www.centralbank.go.ke/uploads/weekly_bulletin/bulletin.pdf",
      });
      expect(resolution.label).toMatch(/^AI search:/);
      expect(resolution.label).toContain("Central Bank of Kenya");
      expect(resolution.label).toContain("CBK Weekly Bulletin");
    }
    expect(searchImpl).toHaveBeenCalledWith(expect.objectContaining({ catalogue: "cbk" }));
  });

  it("4b. Stage 7e — a successful MMF search resolves to a url source, calling searchImpl with catalogue mmf", async () => {
    const searchImpl = vi.fn().mockResolvedValue(okMmfResult());
    const resolution = await resolveSearchSource({
      scope: "mmf",
      question: "What is the top MMF EAR right now?",
      allowUnsourced: false,
      searchImpl,
    });
    expect(resolution.outcome).toBe("found");
    if (resolution.outcome === "found") {
      expect(resolution.source).toEqual({
        kind: "url",
        url: "https://www.example-am.co.ke/mmf/factsheet.pdf",
      });
      expect(resolution.label).toMatch(/^AI search:/);
      expect(resolution.label).toContain("Example MMF Factsheet");
    }
    expect(searchImpl).toHaveBeenCalledWith(expect.objectContaining({ catalogue: "mmf" }));
  });

  it("4c. Stage 7e — a manual source prevents MMF search from ever being attempted (shouldAttemptSearch gate, scope-agnostic)", () => {
    expect(shouldAttemptSearch({ hasManualSource: true, allowSearch: true })).toBe(false);
  });

  it("4d. Stage 7f — a successful bank search resolves to a url source, calling searchImpl with catalogue bank", async () => {
    const searchImpl = vi.fn().mockResolvedValue(okBankResult());
    const resolution = await resolveSearchSource({
      scope: "bank",
      question: "What is the top 12-month fixed deposit rate right now?",
      allowUnsourced: false,
      searchImpl,
    });
    expect(resolution.outcome).toBe("found");
    if (resolution.outcome === "found") {
      expect(resolution.source).toEqual({
        kind: "url",
        url: "https://www.example-bank.co.ke/rates/fixed-deposit",
      });
      expect(resolution.label).toMatch(/^AI search:/);
      expect(resolution.label).toContain("Example Bank Fixed Deposit Rates");
    }
    expect(searchImpl).toHaveBeenCalledWith(expect.objectContaining({ catalogue: "bank" }));
  });

  it("4e. Stage 7f — a manual source prevents bank search from ever being attempted (shouldAttemptSearch gate, scope-agnostic)", () => {
    expect(shouldAttemptSearch({ hasManualSource: true, allowSearch: true })).toBe(false);
  });

  it("5a. a search failure with allowUnsourced:false blocks — never a silent fallback to general model memory", async () => {
    const searchImpl = vi.fn().mockResolvedValue({
      ok: false,
      reason: "no_citations",
      message: "The search returned no real URL citations.",
    } satisfies SearchSourceResult);
    const resolution = await resolveSearchSource({
      scope: "cbk",
      question: "What is the current 91-day T-bill rate?",
      allowUnsourced: false,
      searchImpl,
    });
    expect(resolution.outcome).toBe("search_failed_blocked");
    if (resolution.outcome === "search_failed_blocked") {
      expect(resolution.message).toMatch(/did not find a source it could cite/i);
    }
  });

  it("5b. the SAME search failure with allowUnsourced:true does not block — the manager pre-authorised proceeding unsourced", async () => {
    const searchImpl = vi.fn().mockResolvedValue({
      ok: false,
      reason: "no_citations",
      message: "The search returned no real URL citations.",
    } satisfies SearchSourceResult);
    const resolution = await resolveSearchSource({
      scope: "cbk",
      question: "What is the current 91-day T-bill rate?",
      allowUnsourced: true,
      searchImpl,
    });
    expect(resolution.outcome).toBe("search_failed_unsourced");
  });

  it("5c. Stage 7e — an MMF search failure with allowUnsourced:false blocks, same rule as CBK", async () => {
    const searchImpl = vi.fn().mockResolvedValue({
      ok: false,
      reason: "no_citations",
      message: "The search returned no real URL citations.",
    } satisfies SearchSourceResult);
    const resolution = await resolveSearchSource({
      scope: "mmf",
      question: "What is the top MMF EAR right now?",
      allowUnsourced: false,
      searchImpl,
    });
    expect(resolution.outcome).toBe("search_failed_blocked");
  });

  it("5d. Stage 7e — the SAME MMF search failure with allowUnsourced:true does not block", async () => {
    const searchImpl = vi.fn().mockResolvedValue({
      ok: false,
      reason: "no_citations",
      message: "The search returned no real URL citations.",
    } satisfies SearchSourceResult);
    const resolution = await resolveSearchSource({
      scope: "mmf",
      question: "What is the top MMF EAR right now?",
      allowUnsourced: true,
      searchImpl,
    });
    expect(resolution.outcome).toBe("search_failed_unsourced");
  });

  it("5e. Stage 7f — a bank search failure with allowUnsourced:false blocks, same rule as CBK/MMF", async () => {
    const searchImpl = vi.fn().mockResolvedValue({
      ok: false,
      reason: "no_citations",
      message: "The search returned no real URL citations.",
    } satisfies SearchSourceResult);
    const resolution = await resolveSearchSource({
      scope: "bank",
      question: "What is the top 12-month fixed deposit rate right now?",
      allowUnsourced: false,
      searchImpl,
    });
    expect(resolution.outcome).toBe("search_failed_blocked");
  });

  it("5f. Stage 7f — the SAME bank search failure with allowUnsourced:true does not block", async () => {
    const searchImpl = vi.fn().mockResolvedValue({
      ok: false,
      reason: "no_citations",
      message: "The search returned no real URL citations.",
    } satisfies SearchSourceResult);
    const resolution = await resolveSearchSource({
      scope: "bank",
      question: "What is the top 12-month fixed deposit rate right now?",
      allowUnsourced: true,
      searchImpl,
    });
    expect(resolution.outcome).toBe("search_failed_unsourced");
  });

  it("6. a network/request failure (search_failed) behaves the same as no_citations for the blocked/unsourced split", async () => {
    const searchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "search_failed", message: "ECONNRESET" } satisfies SearchSourceResult);
    const blocked = await resolveSearchSource({ scope: "cbk", question: "q", allowUnsourced: false, searchImpl });
    expect(blocked.outcome).toBe("search_failed_blocked");
    const unsourced = await resolveSearchSource({ scope: "cbk", question: "q", allowUnsourced: true, searchImpl });
    expect(unsourced.outcome).toBe("search_failed_unsourced");
  });

  it("7. no_route (Step 4.1 has no registered source for this scope/sub-type) is reported distinctly", async () => {
    const searchImpl = vi
      .fn()
      .mockResolvedValue({ ok: false, reason: "no_route", message: "No authoritative source is registered." } satisfies SearchSourceResult);
    const resolution = await resolveSearchSource({ scope: "cbk", question: "q", allowUnsourced: false, searchImpl });
    expect(resolution.outcome).toBe("search_failed_blocked");
    if (resolution.outcome === "search_failed_blocked") {
      expect(resolution.message).toMatch(/no authoritative source registered/i);
    }
  });

  it("8. never calls the real searchAuthoritativeSource / global fetch — every test above injects searchImpl", async () => {
    const globalFetchSpy = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = globalFetchSpy as unknown as typeof fetch;
    try {
      const searchImpl = vi.fn().mockResolvedValue(okResult());
      await resolveSearchSource({ scope: "cbk", question: "q", allowUnsourced: false, searchImpl });
      expect(globalFetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Stage 4.2b-ii · searchFoundLabel (pure)", () => {
  it("combines the route's source label and the citation title", () => {
    expect(searchFoundLabel({ sourceLabel: "Central Bank of Kenya", citationTitle: "CBK Weekly Bulletin" })).toBe(
      "AI search: Central Bank of Kenya — CBK Weekly Bulletin",
    );
  });

  it("does not duplicate the title when it is identical to the source label", () => {
    expect(searchFoundLabel({ sourceLabel: "Central Bank of Kenya", citationTitle: "Central Bank of Kenya" })).toBe(
      "AI search: Central Bank of Kenya",
    );
  });

  it("falls back to just the source label when the citation has no title", () => {
    expect(searchFoundLabel({ sourceLabel: "Central Bank of Kenya", citationTitle: "" })).toBe(
      "AI search: Central Bank of Kenya",
    );
  });

  it("stays within the 200-char sourceLabel DB column limit", () => {
    const label = searchFoundLabel({ sourceLabel: "X".repeat(150), citationTitle: "Y".repeat(150) });
    expect(label.length).toBeLessThanOrEqual(200);
  });
});

describe("Stage 4.2b-ii · searchFailureMessage (pure)", () => {
  it("produces a distinct, human message for each failure reason", () => {
    const reasons: Array<SearchSourceResult> = [
      { ok: false, reason: "no_route", message: "x" },
      { ok: false, reason: "no_citations", message: "x" },
      { ok: false, reason: "search_failed", message: "ECONNRESET" },
    ];
    const messages = reasons.map((r) => searchFailureMessage(r as Extract<SearchSourceResult, { ok: false }>));
    expect(new Set(messages).size).toBe(3); // all distinct
    expect(messages[2]).toContain("ECONNRESET");
  });
});
