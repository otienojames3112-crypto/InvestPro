/**
 * Stage 4, Step 4.2b-iii — the Ask AI UI checkbox that lets a manager opt into
 * `allowSearch` (Step 4.2b-ii's search wiring — CBK; MMF as of Stage 7e; bank as of
 * Stage 7f; market_asset/REIT as of the market-asset search design's REIT slice).
 *
 * This repo has no jsdom/testing-library setup for client components (vitest runs
 * client-adjacent checks with `environment: "node"`); the established convention for
 * asserting AskAI.tsx behaviour (see round85ResearchUx.test.ts, round86ResearchAudit,
 * round102AskAiCleanIntake, round97InstrumentProfile, round98CatalogueComparison) is
 * a static read of the source file plus targeted string/substring assertions. This
 * file follows that same convention — no DB, no network, no live OpenAI call.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf8");

// The two components that each own a source attachment + an `ask`/`startResearchTask`
// call: OpeningPanel (new enquiry) and Conversation (follow-up on an existing thread).
const openingIdx = askAi.indexOf("function OpeningPanel(");
const conversationIdx = askAi.indexOf("function Conversation(");
const opening = askAi.slice(openingIdx, askAi.indexOf("function ThreadHistory("));
const conversation = askAi.slice(conversationIdx, openingIdx);

describe("Stage 4.2b-iii · OpeningPanel search checkbox", () => {
  it("1. state exists and defaults unchecked", () => {
    expect(opening).toContain('const [allowSearch, setAllowSearch] = useState(false);');
  });

  it("2. the checkbox block is rendered ONLY when no manual source is attached (`{!src.provided && (`)", () => {
    expect(opening).toMatch(/\{!src\.provided && \(\s*<label[\s\S]{0,2000}Search authoritative CBK sources/);
  });

  it("3. disabled outside CBK/MMF/bank scope (and outside market_asset+REIT), with a short explanation", () => {
    expect(opening).toContain('disabled={scope !== "cbk" && scope !== "mmf" && scope !== "bank" && !marketAssetSearchReady}');
    expect(opening).toContain("Only available when Focus (below) is set to");
  });

  it("3b. Stage 7e/7f — enabled for MMF and bank, not just CBK", () => {
    expect(opening).toMatch(/scope === "cbk" \|\| scope === "mmf" \|\| scope === "bank"/);
  });

  it("4. checking it flips local state via onChange", () => {
    expect(opening).toContain("checked={allowSearch}");
    expect(opening).toContain("onChange={(e) => setAllowSearch(e.target.checked)}");
  });

  it("5. allowSearch is sent to startResearchTask ONLY when no source resolved AND scope is cbk/mmf/bank (or market_asset+REIT)", () => {
    expect(opening).toContain(
      'allowSearch: !source && (scope === "cbk" || scope === "mmf" || scope === "bank" || marketAssetSearchReady) ? allowSearch : undefined,',
    );
  });

  it("6. switching Focus away from CBK, MMF, AND bank resets the checkbox (no stale checked-but-disabled state)", () => {
    expect(opening).toContain('if (v !== "cbk" && v !== "mmf" && v !== "bank") setAllowSearch(false);');
  });

  it("7. existing allowUnsourced wiring is untouched by this step", () => {
    expect(opening).toContain("allowUnsourced: source ? allowUnsourced : undefined,");
  });
});

describe("Stage 4.2b-iii · Conversation (follow-up) search checkbox", () => {
  it("1. state exists and defaults unchecked", () => {
    expect(conversation).toContain('const [allowSearch, setAllowSearch] = useState(false);');
  });

  it("2. the checkbox sits inside the SAME `{!src.provided && (` guard as the source-mode pills", () => {
    expect(conversation).toMatch(/\{!src\.provided && \(\s*<label[\s\S]{0,2000}Search authoritative CBK sources/);
  });

  it("3. disabled outside a CBK/MMF/bank-scoped thread, with a short explanation", () => {
    expect(conversation).toContain(
      'disabled={thread?.scope !== "cbk" && thread?.scope !== "mmf" && thread?.scope !== "bank"}',
    );
    expect(conversation).toContain("Only available for enquiries focused on");
  });

  it("3b. Stage 7e/7f — enabled for an MMF- or bank-scoped thread, not just CBK", () => {
    expect(conversation).toMatch(/thread\?\.scope === "cbk" \|\| thread\?\.scope === "mmf" \|\| thread\?\.scope === "bank"/);
  });

  it("4. checking it flips local state via onChange", () => {
    expect(conversation).toContain("checked={allowSearch}");
    expect(conversation).toContain("onChange={(e) => setAllowSearch(e.target.checked)}");
  });

  it("5. allowSearch is sent to startResearchTask ONLY when no source resolved AND the thread's scope is cbk, mmf, or bank", () => {
    expect(conversation).toContain(
      'allowSearch: !source && (data?.thread?.scope === "cbk" || data?.thread?.scope === "mmf" || data?.thread?.scope === "bank") ? allowSearch : undefined,',
    );
  });

  it("6. existing allowUnsourced wiring is untouched by this step", () => {
    expect(conversation).toContain("allowUnsourced: source ? allowUnsourced : undefined,");
  });

  it("7. existing sourceMode ('reuse previous'/'add another'/'ask without source') pills are untouched", () => {
    expect(conversation).toContain('["reuse_previous", "Use previous source"]');
    expect(conversation).toContain('["new", "Add another source"]');
    expect(conversation).toContain('["none", "Ask without source"]');
  });
});

describe("Stage 4.2b-iii · both forms are wired consistently and stay CBK/MMF/bank-only", () => {
  it("neither form ever hardcodes allowSearch: true unconditionally (always gated by a scope cbk/mmf/bank check)", () => {
    const allowSearchLines = askAi.split("\n").filter((l) => l.includes("allowSearch:") && l.includes("startTask"));
    expect(allowSearchLines).toEqual([]); // sanity: allowSearch is never inline with the mutation call itself
    const mutationSites = [...askAi.matchAll(/allowSearch: [^\n]+,/g)].map((m) => m[0]);
    expect(mutationSites.length).toBe(2); // OpeningPanel + Conversation
    for (const site of mutationSites) {
      expect(site).toContain('=== "cbk"');
      expect(site).toContain('=== "mmf"');
      expect(site).toContain('=== "bank"');
    }
  });

  it("Stage 7e — MMF search opt-in copy exists, honestly caveated (no fixed-domain guarantee implied)", () => {
    expect(askAi).toMatch(/Search for a cited fund-manager source/);
    expect(askAi).toMatch(/MMF sources vary by fund manager/i);
    // Never claims MMF has the same fixed "authoritative" domain guarantee CBK has.
    expect(askAi).not.toMatch(/[Ss]earch authoritative MMF/);
  });

  it("Stage 7f — bank search opt-in copy exists, honestly caveated (no fixed-domain guarantee implied)", () => {
    expect(askAi).toMatch(/Search for a cited bank product page/);
    expect(askAi).toMatch(/Bank sources vary by bank/i);
    // Never claims bank has the same fixed "authoritative" domain guarantee CBK has.
    expect(askAi).not.toMatch(/[Ss]earch authoritative bank/);
  });

  it("both MMF and bank copy include a caveat that the cited source should be verified", () => {
    const verifyMentions = [...askAi.matchAll(/verify the cited source/gi)];
    expect(verifyMentions.length).toBeGreaterThanOrEqual(2); // at least one per scope, in both OpeningPanel and Conversation copy would double this, but assert the minimum
  });

  it("market_asset/REIT, market_asset/equity, market_asset/offshore-fund, and market_asset/SACCO search opt-in copy all exist (market-asset search design, full staged rollout) — none ever claim CBK's fixed-domain guarantee", () => {
    expect(askAi).toMatch(/Search for a cited NSE\/REIT source/);
    expect(askAi).toMatch(/Search for a cited NSE\/equity source/);
    expect(askAi).toMatch(/Search for a cited fund-manager\/NAV source/);
    expect(askAi).toMatch(/Search for a cited SACCO source/);
    expect(askAi).not.toMatch(/[Ss]earch authoritative (market asset|REIT|equity|offshore|SACCO)/);
  });

  it("no live OpenAI call is possible from this test file (static source read only)", () => {
    expect(askAi).not.toContain("api.openai.com");
  });
});
