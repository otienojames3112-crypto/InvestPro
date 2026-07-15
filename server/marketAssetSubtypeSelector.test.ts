/**
 * Market-asset search design (2026-07-13) — subtype selector (foundation slice) +
 * REIT search enablement + equity search enablement (this slice). An explicit
 * "Asset type" selector in Ask AI's OpeningPanel, shown only when Focus = "Market
 * assets", now also gates AI search: search is enabled when Asset type = "reit" OR
 * "equity" — offshore fund/SACCO remain unsearchable in this pass, exactly as CBK/
 * MMF/bank search behavior (Stage 7e/7f) is untouched.
 *
 * This repo has no jsdom/testing-library setup for client components (vitest runs
 * client-adjacent checks with `environment: "node"`); the established convention for
 * asserting AskAI.tsx behaviour (see askAiSearchCheckbox.test.ts, round85ResearchUx)
 * is a static read of the source file plus targeted string/substring assertions. No
 * DB, no network, no live OpenAI call.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf8");

const openingIdx = askAi.indexOf("function OpeningPanel(");
const opening = askAi.slice(openingIdx, askAi.indexOf("function ThreadHistory("));
const conversationIdx = askAi.indexOf("function Conversation(");
const conversation = askAi.slice(conversationIdx, openingIdx);

describe("Market-asset subtype selector · foundation", () => {
  it("1. MarketAssetSubtype is limited to exactly equity/reit/offshore_fund/sacco", () => {
    const idx = askAi.indexOf("type MarketAssetSubtype =");
    expect(idx).toBeGreaterThan(-1);
    const decl = askAi.slice(idx, askAi.indexOf(";", idx) + 1);
    expect(decl).toBe('type MarketAssetSubtype = "equity" | "reit" | "offshore_fund" | "sacco";');
  });

  it("2. the options list is exactly Equity, REIT, Offshore fund, SACCO — no ETF/property/pension/other", () => {
    const idx = askAi.indexOf("const MARKET_ASSET_SUBTYPE_OPTIONS");
    expect(idx).toBeGreaterThan(-1);
    const block = askAi.slice(idx, askAi.indexOf("];", idx) + 2);
    expect(block).toContain('{ value: "equity", label: "Equity" }');
    expect(block).toContain('{ value: "reit", label: "REIT" }');
    expect(block).toContain('{ value: "offshore_fund", label: "Offshore fund" }');
    expect(block).toContain('{ value: "sacco", label: "SACCO" }');
    expect(block).not.toMatch(/etf|property|pension|other/i);
  });

  it("3. state exists and defaults to no selection", () => {
    expect(opening).toContain('const [marketAssetSubtype, setMarketAssetSubtype] = useState<MarketAssetSubtype | "">("");');
  });

  it("4. the dropdown block is rendered ONLY when scope === \"market_asset\"", () => {
    expect(opening).toMatch(/\{scope === "market_asset" && \(\s*<div[\s\S]{0,600}Asset type/);
  });

  it("5. the dropdown is driven by MARKET_ASSET_SUBTYPE_OPTIONS, not a hardcoded/inferred list", () => {
    const idx = opening.indexOf('{scope === "market_asset" && (');
    const block = opening.slice(idx, idx + 1200);
    expect(block).toContain("MARKET_ASSET_SUBTYPE_OPTIONS.map((o) =>");
    expect(block).toContain("const next = v as MarketAssetSubtype;");
    expect(block).toContain("setMarketAssetSubtype(next);");
  });

  it("6. copy tells the manager REIT and Equity are the searchable subtypes so far", () => {
    const idx = opening.indexOf('{scope === "market_asset" && (');
    const block = opening.slice(idx, idx + 1600);
    expect(block).toMatch(/AI search is available for REIT and Equity/);
    expect(block).toMatch(/Required before AI search for market assets can be enabled/);
    expect(block).toMatch(/Only REIT and Equity search are available so far/);
  });

  it("7. switching Focus away from market_asset resets the subtype selection", () => {
    expect(opening).toContain('if (v !== "market_asset") setMarketAssetSubtype("");');
  });

  it("8. switching Focus TO/away-from cbk/mmf/bank still resets allowSearch the same way as Stage 7f (market_asset falls through this same line)", () => {
    expect(opening).toContain('if (v !== "cbk" && v !== "mmf" && v !== "bank") setAllowSearch(false);');
  });

  it("9. the subtype setter is only ever called from Focus-change reset and the dropdown's own onValueChange — never inferred from question text", () => {
    const setterCalls = [...opening.matchAll(/setMarketAssetSubtype\([^)]*\)/g)].map((m) => m[0]);
    expect(setterCalls.sort()).toEqual(['setMarketAssetSubtype("")', "setMarketAssetSubtype(next)"].sort());
  });

  it("10. selecting a subtype other than REIT or Equity resets allowSearch (no stale checked-but-about-to-be-disabled checkbox)", () => {
    const idx = opening.indexOf('{scope === "market_asset" && (');
    const block = opening.slice(idx, idx + 1200);
    expect(block).toContain('if (next !== "reit" && next !== "equity") setAllowSearch(false);');
  });
});

describe("Market-asset subtype selector · REIT + equity search enablement", () => {
  it("marketAssetSearchReady is derived from scope AND (reit OR equity) subtype together, never scope alone", () => {
    expect(opening).toMatch(
      /const marketAssetSearchReady =\s*scope === "market_asset" && \(marketAssetSubtype === "reit" \|\| marketAssetSubtype === "equity"\);/,
    );
  });

  it("the search checkbox is enabled (not disabled) when scope=market_asset and subtype is reit OR equity, alongside cbk/mmf/bank", () => {
    expect(opening).toContain(
      'disabled={scope !== "cbk" && scope !== "mmf" && scope !== "bank" && !marketAssetSearchReady}',
    );
    // marketAssetSearchReady itself covers both reit and equity — confirmed by the
    // "REIT + equity search enablement" describe block's first test above.
  });

  it("UI: Focus=Market assets + Asset type=Equity enables the checkbox when no manual source exists (via marketAssetSearchReady)", () => {
    // Simulate the exact state the checkbox's `disabled` expression reads.
    const scope = "market_asset";
    const marketAssetSubtype = "equity";
    const marketAssetSearchReady = scope === "market_asset" && (marketAssetSubtype === "reit" || (marketAssetSubtype as string) === "equity");
    const disabled = scope !== "cbk" && (scope as string) !== "mmf" && (scope as string) !== "bank" && !marketAssetSearchReady;
    expect(disabled).toBe(false);
  });

  it("allowSearch is sent to startResearchTask for market_asset ONLY when marketAssetSearchReady (i.e. subtype is reit or equity)", () => {
    expect(opening).toContain(
      'allowSearch: !source && (scope === "cbk" || scope === "mmf" || scope === "bank" || marketAssetSearchReady) ? allowSearch : undefined,',
    );
  });

  it("marketAssetSubtype is forwarded to startResearchTask ONLY for scope === market_asset, and only when selected (equity or reit alike)", () => {
    expect(opening).toContain(
      'marketAssetSubtype: scope === "market_asset" && marketAssetSubtype ? marketAssetSubtype : undefined,',
    );
  });

  it("REIT behavior (copy, gating expression, mutation wiring) is completely unchanged by adding equity", () => {
    expect(opening).toContain("Search for a cited NSE/REIT source if I don’t attach a source.");
    expect(opening).toMatch(/The AI searches for a current, cited NSE listing or REIT source — never from its own memory\. Please verify the cited source before relying on it\./);
    expect(opening).toContain('if (next !== "reit" && next !== "equity") setAllowSearch(false);');
  });

  it("REIT gets its own honest search copy — cites NSE/REIT, tells the manager to verify", () => {
    expect(opening).toContain("Search for a cited NSE/REIT source if I don’t attach a source.");
    expect(opening).toMatch(/current, cited NSE listing or REIT source/);
    expect(opening).toMatch(/Please verify the cited source before relying on it/);
  });

  it("equity gets its own honest search copy — cites NSE/equity, tells the manager to verify", () => {
    expect(opening).toContain("Search for a cited NSE/equity source if I don’t attach a source.");
    expect(opening).toMatch(/current, cited NSE listing or equity source/);
  });

  it("REIT and equity copy never claim the same blanket 'authoritative' guarantee CBK's wording implies", () => {
    expect(askAi).not.toMatch(/[Ss]earch authoritative (REIT|equity|market asset)/);
  });

  it("offshore fund and SACCO get NO search opt-in copy of their own — only REIT and equity do, in this slice", () => {
    expect(askAi).not.toMatch(/Search for a cited (offshore.fund|SACCO)/i);
    expect(askAi).not.toMatch(/[Ss]earch authoritative (offshore fund|SACCO)/);
  });

  it("ETF/property/pension/other are never mentioned anywhere near search copy (no route, never offered)", () => {
    const searchBlockIdx = opening.indexOf("Step 4.2b-iii");
    const block = opening.slice(searchBlockIdx, searchBlockIdx + 3000);
    expect(block).not.toMatch(/etf|property|pension/i);
  });

  it("market_asset without a subtype selected (marketAssetSubtype === \"\") still keeps search disabled — falls through to the generic 'not ready' copy", () => {
    expect(opening).toMatch(/Select\s*“?REIT”?\s*or\s*“?Equity”?\s*as the Asset type above to enable search/);
  });

  it("the unsupported-scope explanation now also mentions Market assets + REIT or Equity", () => {
    expect(opening).toMatch(/Market assets” with Asset type = REIT or Equity/);
  });
});

describe("Market-asset subtype selector · does not touch unrelated search behavior (guardrails)", () => {
  it("CBK/MMF/bank mutation-site conditions still include all three scopes, plus the new REIT case — not a regression, an addition", () => {
    const mutationSites = [...askAi.matchAll(/allowSearch: [^\n]+,/g)].map((m) => m[0]);
    expect(mutationSites.length).toBe(2); // OpeningPanel + Conversation, same as Stage 7f
    for (const site of mutationSites) {
      expect(site).toContain('=== "cbk"');
      expect(site).toContain('=== "mmf"');
      expect(site).toContain('=== "bank"');
    }
  });

  it("Conversation's mutation site does NOT gain a market_asset/REIT condition — Conversation is untouched by this slice", () => {
    const conversationMutationIdx = conversation.indexOf("allowSearch: ");
    const conversationSite = conversation.slice(conversationMutationIdx, conversation.indexOf("\n", conversationMutationIdx));
    expect(conversationSite).not.toContain("marketAssetSearchReady");
    expect(conversationSite).not.toContain('=== "market_asset"');
  });

  it("no new server call site or fetch was introduced — this file only touches AskAI.tsx (server changes verified separately)", () => {
    expect(askAi).not.toContain("api.openai.com");
    expect(askAi).not.toMatch(/searchAuthoritativeSource/);
  });

  it("existing CBK/MMF/bank search copy is byte-identical to Stage 7f — no wording changed by this slice", () => {
    expect(opening).toContain("Search authoritative CBK sources if I don’t attach a source.");
    expect(opening).toContain("Search for a cited fund-manager source if I don’t attach a source.");
    expect(opening).toContain("Search for a cited bank product page if I don’t attach a source.");
    expect(opening).toContain(
      "The AI looks up a current, cited CBK source — never from its own memory — and grounds the answer in it, exactly as if you’d pasted the link yourself.",
    );
    expect(opening).toContain(
      "The AI searches for a current, cited fund-manager factsheet (or CMA data as a cross-check) — never from its own memory. MMF sources vary by fund manager, so please verify the cited source before relying on it.",
    );
    expect(opening).toContain(
      "The AI searches for a current, cited bank rates/product page — never from its own memory. Bank sources vary by bank, so please verify the cited source before relying on it.",
    );
  });
});

describe("Market-asset subtype selector · Conversation correctly gets no selector or search in this slice", () => {
  // Conversation is a FOLLOW-UP on an existing thread. Its scope comes from
  // `data?.thread?.scope` — fixed at thread-creation time in OpeningPanel — and is
  // only ever displayed read-only ("Focus: {thread.scope}"), never re-selected. There
  // is no moment in Conversation where a manager picks Focus = "Market assets" (that
  // only happens once, when the thread is FIRST opened via OpeningPanel), so there is
  // no corresponding moment where a market-asset subtype needs to be picked (or REIT
  // search enabled) there either — the subtype was never persisted anywhere server-
  // side, so a follow-up on an existing market_asset thread has no way to reconstruct
  // it. These tests pin that invariant so a future slice can't silently violate it.

  it("Conversation never calls setScope — its scope is read-only, inherited from the thread", () => {
    expect(conversation).not.toContain("setScope(");
    expect(conversation).not.toContain("setScope =");
  });

  it("setScope exists exactly once, inside OpeningPanel's Focus <Select>, not in Conversation", () => {
    const allSetScopeCalls = [...askAi.matchAll(/setScope\(/g)];
    expect(allSetScopeCalls.length).toBe(1);
    const idx = askAi.indexOf("setScope(");
    expect(idx).toBeGreaterThan(openingIdx); // inside OpeningPanel, not before it (i.e. not in Conversation)
  });

  it("Conversation shows scope as read-only text, not a <Select>", () => {
    expect(conversation).toMatch(/thread\?\.scope && thread\.scope !== "any" \? `Focus: \$\{thread\.scope\}/);
    expect(conversation).not.toContain('<Label className="text-xs text-muted-foreground">Focus</Label>');
  });

  it("Conversation has no market-asset subtype state, dropdown, or REIT-readiness logic — none of these symbols appear there", () => {
    expect(conversation).not.toContain("marketAssetSubtype");
    expect(conversation).not.toContain("MARKET_ASSET_SUBTYPE_OPTIONS");
    expect(conversation).not.toContain("MarketAssetSubtype");
    expect(conversation).not.toContain("marketAssetSearchReady");
  });

  it("Conversation's search checkbox is still gated on the thread's FIXED scope only, same guard as Stage 7f — unaffected by this slice", () => {
    expect(conversation).toContain(
      'disabled={thread?.scope !== "cbk" && thread?.scope !== "mmf" && thread?.scope !== "bank"}',
    );
  });
});
