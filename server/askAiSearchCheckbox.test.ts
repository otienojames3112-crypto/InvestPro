/**
 * Stage 4, Step 4.2b-iii — the Ask AI UI checkbox that lets a manager opt into
 * `allowSearch` (Step 4.2b-ii's CBK-only search wiring).
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
    expect(opening).toMatch(/\{!src\.provided && \(\s*<label[\s\S]{0,900}Search authoritative CBK sources/);
  });

  it("3. disabled outside CBK scope, with a short explanation", () => {
    expect(opening).toContain('disabled={scope !== "cbk"}');
    expect(opening).toContain("Only available when Focus (below) is set to");
  });

  it("4. checking it flips local state via onChange", () => {
    expect(opening).toContain("checked={allowSearch}");
    expect(opening).toContain("onChange={(e) => setAllowSearch(e.target.checked)}");
  });

  it("5. allowSearch is sent to startResearchTask ONLY when no source resolved AND scope is cbk", () => {
    expect(opening).toContain('allowSearch: !source && scope === "cbk" ? allowSearch : undefined,');
  });

  it("6. switching Focus away from CBK resets the checkbox (no stale checked-but-disabled state)", () => {
    expect(opening).toContain('if (v !== "cbk") setAllowSearch(false);');
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
    expect(conversation).toMatch(/\{!src\.provided && \(\s*<label[\s\S]{0,900}Search authoritative CBK sources/);
  });

  it("3. disabled outside a CBK-scoped thread, with a short explanation", () => {
    expect(conversation).toContain('disabled={thread?.scope !== "cbk"}');
    expect(conversation).toContain("Only available for enquiries focused on");
  });

  it("4. checking it flips local state via onChange", () => {
    expect(conversation).toContain("checked={allowSearch}");
    expect(conversation).toContain("onChange={(e) => setAllowSearch(e.target.checked)}");
  });

  it("5. allowSearch is sent to startResearchTask ONLY when no source resolved AND the thread's scope is cbk", () => {
    expect(conversation).toContain(
      'allowSearch: !source && data?.thread?.scope === "cbk" ? allowSearch : undefined,',
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

describe("Stage 4.2b-iii · both forms are wired consistently and stay CBK-only", () => {
  it("neither form ever hardcodes allowSearch: true unconditionally (always gated by a scope==='cbk' check)", () => {
    const allowSearchLines = askAi.split("\n").filter((l) => l.includes("allowSearch:") && l.includes("startTask"));
    expect(allowSearchLines).toEqual([]); // sanity: allowSearch is never inline with the mutation call itself
    const mutationSites = [...askAi.matchAll(/allowSearch: [^\n]+,/g)].map((m) => m[0]);
    expect(mutationSites.length).toBe(2); // OpeningPanel + Conversation
    for (const site of mutationSites) {
      expect(site).toContain('=== "cbk"');
    }
  });

  it("no MMF/bank/market_asset search opt-in copy exists anywhere in AskAI.tsx yet", () => {
    expect(askAi).not.toMatch(/[Ss]earch authoritative (MMF|bank|market asset|REIT|offshore|SACCO)/);
  });

  it("no live OpenAI call is possible from this test file (static source read only)", () => {
    expect(askAi).not.toContain("api.openai.com");
  });
});
