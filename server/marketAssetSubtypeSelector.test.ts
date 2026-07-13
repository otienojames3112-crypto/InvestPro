/**
 * Market-asset search design (2026-07-13) — foundation slice: an explicit "Asset
 * type" selector in Ask AI's OpeningPanel, shown only when Focus = "Market assets".
 * This slice is UI-only: it collects a subtype but does NOT send it to the server,
 * does NOT enable market-asset search, and does NOT change any search behavior for
 * CBK/MMF/bank (which stays exactly as Stage 7e/7f left it).
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
    const idx = opening.indexOf('scope === "market_asset" && (');
    const block = opening.slice(idx, idx + 1000);
    expect(block).toContain("MARKET_ASSET_SUBTYPE_OPTIONS.map((o) =>");
    expect(block).toContain("onValueChange={(v) => setMarketAssetSubtype(v as MarketAssetSubtype)}");
  });

  it("6. copy makes clear the subtype is required before future market-asset search", () => {
    const idx = opening.indexOf('scope === "market_asset" && (');
    const block = opening.slice(idx, idx + 1000);
    expect(block).toMatch(/Required before AI search for market assets can be enabled/);
  });

  it("7. switching Focus away from market_asset resets the subtype selection", () => {
    expect(opening).toContain('if (v !== "market_asset") setMarketAssetSubtype("");');
  });

  it("8. switching Focus TO market_asset does not touch allowSearch (the CBK/MMF/bank reset line is untouched)", () => {
    expect(opening).toContain('if (v !== "cbk" && v !== "mmf" && v !== "bank") setAllowSearch(false);');
  });

  it("9. no inference from question text — the subtype setter is only ever called from the dropdown's onValueChange", () => {
    const setterCalls = [...opening.matchAll(/setMarketAssetSubtype\([^)]*\)/g)].map((m) => m[0]);
    expect(setterCalls.sort()).toEqual(
      ['setMarketAssetSubtype("")', "setMarketAssetSubtype(v as MarketAssetSubtype)"].sort(),
    );
  });
});

describe("Market-asset subtype selector · does not touch search behavior (guardrails)", () => {
  it("market_asset is still never sent as allowSearch: true — the mutation-site ternary condition is unchanged from Stage 7f", () => {
    const mutationSites = [...askAi.matchAll(/allowSearch: [^\n]+,/g)].map((m) => m[0]);
    expect(mutationSites.length).toBe(2); // OpeningPanel + Conversation, same as Stage 7f
    for (const site of mutationSites) {
      expect(site).toContain('=== "cbk"');
      expect(site).toContain('=== "mmf"');
      expect(site).toContain('=== "bank"');
      expect(site).not.toContain('=== "market_asset"');
    }
  });

  it("the search checkbox's disabled condition still does not include market_asset (unchanged from Stage 7f)", () => {
    expect(opening).toContain('disabled={scope !== "cbk" && scope !== "mmf" && scope !== "bank"}');
  });

  it("no new server call site or fetch was introduced — this file only touches AskAI.tsx", () => {
    expect(askAi).not.toContain("api.openai.com");
    expect(askAi).not.toMatch(/searchAuthoritativeSource/);
  });

  it("existing CBK/MMF/bank search copy is byte-identical to Stage 7f — no wording changed by this slice", () => {
    expect(opening).toContain("Search authoritative CBK sources if I don’t attach a source.");
    expect(opening).toContain("Search for a cited fund-manager source if I don’t attach a source.");
    expect(opening).toContain("Search for a cited bank product page if I don’t attach a source.");
  });

  it("market_asset gets no search opt-in copy of its own in this slice", () => {
    expect(askAi).not.toMatch(/Search for a cited (REIT|equity|offshore.fund|SACCO)/i);
    expect(askAi).not.toMatch(/[Ss]earch authoritative (REIT|equity|offshore fund|SACCO|market asset)/);
  });
});

describe("Market-asset subtype selector · Conversation correctly gets no selector in this slice", () => {
  // Conversation is a FOLLOW-UP on an existing thread. Its scope comes from
  // `data?.thread?.scope` — fixed at thread-creation time in OpeningPanel — and is
  // only ever displayed read-only ("Focus: {thread.scope}"), never re-selected. There
  // is no moment in Conversation where a manager picks Focus = "Market assets" (that
  // only happens once, when the thread is FIRST opened via OpeningPanel), so there is
  // no corresponding moment where a market-asset subtype needs to be picked there
  // either. These tests pin that invariant so a future slice can't silently violate it.

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

  it("Conversation has no market-asset subtype state or dropdown — MARKET_ASSET_SUBTYPE_OPTIONS is never referenced there", () => {
    expect(conversation).not.toContain("marketAssetSubtype");
    expect(conversation).not.toContain("MARKET_ASSET_SUBTYPE_OPTIONS");
    expect(conversation).not.toContain("MarketAssetSubtype");
  });

  it("Conversation's search checkbox is still gated on the thread's FIXED scope, same guard as Stage 7f — unaffected by this slice", () => {
    expect(conversation).toContain(
      'disabled={thread?.scope !== "cbk" && thread?.scope !== "mmf" && thread?.scope !== "bank"}',
    );
  });
});
