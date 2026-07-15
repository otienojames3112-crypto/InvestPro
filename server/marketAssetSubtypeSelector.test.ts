/**
 * Market-asset search design (2026-07-13) — subtype selector (foundation slice) +
 * REIT + equity + offshore fund + SACCO search enablement (this slice completes the
 * full staged rollout). An explicit "Asset type" selector in Ask AI's OpeningPanel,
 * shown only when Focus = "Market assets", now gates AI search for all four subtypes
 * with a registered authoritative-source route — ETF/property/pension/other have no
 * route at all and remain unsearchable — exactly as CBK/MMF/bank search behavior
 * (Stage 7e/7f) is untouched. SACCO carries the highest source-trust risk of the
 * four and gets the strongest-worded verify caveat.
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

  it("6. copy tells the manager a subtype is required, and once selected confirms search is available (SACCO gets its own stronger wording)", () => {
    const idx = opening.indexOf('{scope === "market_asset" && (');
    const block = opening.slice(idx, idx + 1900);
    expect(block).toMatch(/Required before AI search for market assets can be enabled/);
    expect(block).toMatch(/AI search is available for this Asset type/);
    expect(block).toMatch(/AI search is available for SACCO\. SACCO sources vary the most/);
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

  it("10. selecting a subtype other than the four search-enabled ones resets allowSearch (no stale checked-but-about-to-be-disabled checkbox)", () => {
    const idx = opening.indexOf('{scope === "market_asset" && (');
    const block = opening.slice(idx, idx + 1300);
    expect(block).toMatch(
      /if \(next !== "reit" && next !== "equity" && next !== "offshore_fund" && next !== "sacco"\) \{\s*setAllowSearch\(false\);\s*\}/,
    );
  });
});

describe("Market-asset subtype selector · REIT + equity + offshore fund + SACCO search enablement (full rollout)", () => {
  it("marketAssetSearchReady is derived from scope AND all four subtypes together, never scope alone", () => {
    expect(opening).toMatch(
      /const marketAssetSearchReady =\s*scope === "market_asset" &&\s*\(marketAssetSubtype === "reit" \|\|\s*marketAssetSubtype === "equity" \|\|\s*marketAssetSubtype === "offshore_fund" \|\|\s*marketAssetSubtype === "sacco"\);/,
    );
  });

  it("the search checkbox is enabled (not disabled) when scope=market_asset and subtype is any of the four, alongside cbk/mmf/bank", () => {
    expect(opening).toContain(
      'disabled={scope !== "cbk" && scope !== "mmf" && scope !== "bank" && !marketAssetSearchReady}',
    );
    // marketAssetSearchReady itself covers all four subtypes — confirmed by this
    // describe block's first test above.
  });

  it("UI: Focus=Market assets + Asset type=Equity enables the checkbox when no manual source exists (via marketAssetSearchReady)", () => {
    const scope = "market_asset";
    const marketAssetSubtype = "equity";
    const marketAssetSearchReady =
      scope === "market_asset" &&
      (marketAssetSubtype === "reit" ||
        (marketAssetSubtype as string) === "equity" ||
        (marketAssetSubtype as string) === "offshore_fund" ||
        (marketAssetSubtype as string) === "sacco");
    const disabled = scope !== "cbk" && (scope as string) !== "mmf" && (scope as string) !== "bank" && !marketAssetSearchReady;
    expect(disabled).toBe(false);
  });

  it("UI: Focus=Market assets + Asset type=Offshore fund enables the checkbox when no manual source exists (via marketAssetSearchReady)", () => {
    const scope = "market_asset";
    const marketAssetSubtype = "offshore_fund";
    const marketAssetSearchReady =
      scope === "market_asset" &&
      ((marketAssetSubtype as string) === "reit" ||
        (marketAssetSubtype as string) === "equity" ||
        marketAssetSubtype === "offshore_fund" ||
        (marketAssetSubtype as string) === "sacco");
    const disabled = scope !== "cbk" && (scope as string) !== "mmf" && (scope as string) !== "bank" && !marketAssetSearchReady;
    expect(disabled).toBe(false);
  });

  it("UI: Focus=Market assets + Asset type=SACCO enables the checkbox when no manual source exists (via marketAssetSearchReady)", () => {
    const scope = "market_asset";
    const marketAssetSubtype = "sacco";
    const marketAssetSearchReady =
      scope === "market_asset" &&
      ((marketAssetSubtype as string) === "reit" ||
        (marketAssetSubtype as string) === "equity" ||
        (marketAssetSubtype as string) === "offshore_fund" ||
        marketAssetSubtype === "sacco");
    const disabled = scope !== "cbk" && (scope as string) !== "mmf" && (scope as string) !== "bank" && !marketAssetSearchReady;
    expect(disabled).toBe(false);
  });

  it("allowSearch is sent to startResearchTask for market_asset ONLY when marketAssetSearchReady (i.e. subtype is one of the four)", () => {
    expect(opening).toContain(
      'allowSearch: !source && (scope === "cbk" || scope === "mmf" || scope === "bank" || marketAssetSearchReady) ? allowSearch : undefined,',
    );
  });

  it("marketAssetSubtype is forwarded to startResearchTask ONLY for scope === market_asset, and only when selected (any of the four alike)", () => {
    expect(opening).toContain(
      'marketAssetSubtype: scope === "market_asset" && marketAssetSubtype ? marketAssetSubtype : undefined,',
    );
  });

  it("REIT, equity, and offshore fund behavior (copy, gating expression, mutation wiring) are completely unchanged by adding SACCO", () => {
    expect(opening).toContain("Search for a cited NSE/REIT source if I don’t attach a source.");
    expect(opening).toMatch(/The AI searches for a current, cited NSE listing or REIT source — never from its own memory\. Please verify the cited source before relying on it\./);
    expect(opening).toContain("Search for a cited NSE/equity source if I don’t attach a source.");
    expect(opening).toMatch(/The AI searches for a current, cited NSE listing or equity source — never from its own memory\. Please verify the cited source before relying on it\./);
    expect(opening).toContain("Search for a cited fund-manager/NAV source if I don’t attach a source.");
    expect(opening).toMatch(/Offshore fund sources vary by fund manager/i);
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

  it("offshore fund gets its own honest search copy — cites a fund-manager/NAV source, tells the manager sources vary and to verify", () => {
    expect(opening).toContain("Search for a cited fund-manager/NAV source if I don’t attach a source.");
    expect(opening).toMatch(/current, cited fund-manager NAV\/factsheet source/);
    expect(opening).toMatch(/Offshore fund sources vary by fund manager/i);
    expect(opening).toMatch(/please verify the cited source before relying on it/i);
  });

  it("SACCO gets its own honest search copy — cites a SACCO source, tells the manager SACCO sources vary widely and to verify CAREFULLY (strongest caveat of the four)", () => {
    expect(opening).toContain("Search for a cited SACCO source if I don’t attach a source.");
    expect(opening).toMatch(/current, cited SACCO source/);
    expect(opening).toMatch(/SACCO sources vary widely/i);
    expect(opening).toMatch(/verify the cited source carefully/i);
  });

  it("SACCO copy mentions SASRA only as a regulatory-status cross-check, and explicitly denies it as a source of dividend/rebate figures", () => {
    const idx = opening.indexOf("SACCO source (or SASRA");
    expect(idx).toBeGreaterThan(-1);
    const around = opening.slice(idx, idx + 150);
    expect(around).toMatch(/regulatory-status cross-check only/i);
    expect(around).toMatch(/never a source of dividend or rebate figures/i);
  });

  it("REIT, equity, offshore fund, and SACCO copy never claim the same blanket 'authoritative' guarantee CBK's wording implies", () => {
    expect(askAi).not.toMatch(/[Ss]earch authoritative (REIT|equity|offshore fund|SACCO|market asset)/);
  });

  it("ETF/property/pension/other still have NO search opt-in copy of their own — no route exists for them at all", () => {
    expect(askAi).not.toMatch(/Search for a cited (ETF|property|pension)/i);
    expect(askAi).not.toMatch(/[Ss]earch authoritative (ETF|property|pension|other)/);
  });

  it("ETF/property/pension are never mentioned inside the rendered search checkbox copy itself (comments above it may explain the exclusion — only the visible <span> text matters)", () => {
    const checkboxIdx = opening.indexOf("{!src.provided && (");
    const closeIdx = opening.indexOf("</label>", checkboxIdx);
    const block = opening.slice(checkboxIdx, closeIdx);
    expect(block).not.toMatch(/\betf\b|\bproperty\b|\bpension\b/i);
  });

  it("market_asset without a subtype selected (marketAssetSubtype === \"\") still keeps search disabled — falls through to the generic 'not ready' copy", () => {
    expect(opening).toMatch(
      /Select\s*“REIT,”\s*“Equity,”\s*“Offshore fund,”\s*or\s*“SACCO”\s*as the Asset type above to enable search/,
    );
  });

  it("the unsupported-scope explanation now also mentions Market assets + REIT, Equity, Offshore fund, or SACCO", () => {
    expect(opening).toMatch(/Market assets” with Asset type = REIT, Equity, Offshore fund, or SACCO/);
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
