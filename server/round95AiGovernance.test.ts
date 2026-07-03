/**
 * Round 95 — governance guards for the AI-assisted automation surfaces.
 *
 * Every AI touch point added in Round 95 must route through the governed Research
 * Desk pipeline and must never write portfolio/catalogue data on its own. These are
 * static-source guards (no DB, no network): they read the actual server/client files
 * and lock in the invariants the user asked for, so a future refactor cannot silently
 * turn an "explain" query into a mutation or let a review publish without approval.
 *
 *   1. The three AI EXPLANATION procedures (reconciliation mismatch, ledger month,
 *      dashboard status) are tRPC *queries* and the aiExplain router performs no
 *      data writes (no enqueue/insert/update/delete/reconcile) — it only explains.
 *   2. The read-only explanation ENGINE (aiExplainService) never imports the db and
 *      carries an explicit non-advice, "changes nothing" guardrail.
 *   3. Catalogue "Review source with AI" produces FINDINGS only — the review prompt
 *      states findings are proposals, never a catalogue write or a recommendation,
 *      and each strengthened per-catalogue instruction enumerates the requested
 *      change types.
 *   4. AI-sourced updates are APPROVAL-GATED: draftFromFinding only enqueues a pending
 *      update, and the sole path that turns a proposal into a live figure (`review`)
 *      is an admin-gated mutation keyed on an explicit `approve` flag.
 *   5. The client explanation surfaces call `aiExplain.*` via useQuery (never a
 *      mutation) and only fire on demand (enabled-gated), and the Rate Settings /
 *      Source Registry rows expose the governed "Review source with AI" button.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const routers = read("server/routers.ts");
const explainService = read("server/aiExplainService.ts");
const researchService = read("server/aiResearchService.ts");
const explainDialog = read("client/src/components/AiExplainDialog.tsx");
const reconciliation = read("client/src/pages/Reconciliation.tsx");
const ledger = read("client/src/pages/Ledger.tsx");
const dashboard = read("client/src/pages/Dashboard.tsx");
const updateRates = read("client/src/components/UpdateRatesPanel.tsx");
const researchDesk = read("client/src/pages/ResearchDesk.tsx");

/** Slice out the `aiExplain: router({ ... })` group so we can scan just its body. */
function aiExplainBlock(src: string): string {
  const start = src.indexOf("aiExplain: router({");
  expect(start, "aiExplain router group must exist").toBeGreaterThan(-1);
  // The next top-level router group is `securities: router({` (2-space indent).
  const end = src.indexOf("\n  securities: router({", start);
  expect(end, "a router group must follow aiExplain").toBeGreaterThan(start);
  return src.slice(start, end);
}

describe("Round 95 · AI explanations are read-only queries", () => {
  const block = aiExplainBlock(routers);

  it("exposes all three explanation procedures", () => {
    expect(block).toContain("reconciliationMismatch:");
    expect(block).toContain("ledgerMonth:");
    expect(block).toContain("dashboardStatus:");
  });

  it("implements every explanation as a query, never a mutation", () => {
    // Three `.query(` handlers, zero `.mutation(` in the whole group.
    const queries = block.match(/\.query\(/g) ?? [];
    expect(queries.length).toBe(3);
    expect(block.includes(".mutation(")).toBe(false);
  });

  it("performs no data writes inside the explanation group", () => {
    // No enqueue/persist/mutation helpers may appear in the aiExplain body — it must
    // only read (requirePortfolio) and hand facts to the explain engine.
    for (const forbidden of [
      "enqueueResearchUpdate",
      "insertResearchMessage",
      "updateFindingStatus",
      "createResearch",
      "reviewResearchUpdate",
      ".insert(",
      ".update(",
      ".delete(",
      "reconcile(",
    ]) {
      expect(block.includes(forbidden), `aiExplain must not call ${forbidden}`).toBe(false);
    }
  });

  it("guards ownership and delegates to the read-only explain engine", () => {
    const calls = block.match(/aiExplain\(\{/g) ?? [];
    expect(calls.length).toBe(3);
    const guards = block.match(/requirePortfolio\(/g) ?? [];
    expect(guards.length).toBe(3);
  });
});

describe("Round 95 · the explanation engine cannot touch data or advise", () => {
  it("never imports the database layer", () => {
    expect(explainService.includes('from "./db"')).toBe(false);
    expect(explainService.includes("drizzle")).toBe(false);
  });

  it("carries an explicit non-advice / changes-nothing guardrail", () => {
    expect(explainService).toContain("do NOT recommend buying/selling/switching");
    expect(explainService).toContain("Nothing you write is saved or executed");
  });

  it("the shared dialog states it is not advice and changes nothing", () => {
    expect(explainDialog).toContain("changes nothing and is not");
    expect(explainDialog.toLowerCase()).toContain("investment advice");
  });
});

describe("Round 95 · catalogue review produces findings only", () => {
  it("frames every finding as a proposal, never a write or recommendation", () => {
    expect(researchService).toContain("never a catalogue write, never a recommendation");
  });

  it("enumerates the requested change types per catalogue", () => {
    // MMF
    expect(researchService).toContain("management-FEE");
    expect(researchService).toContain("STALE rows");
    // Bank
    expect(researchService).toContain("NEGOTIABLE-flag");
    expect(researchService).toContain("TENOR / notice-period");
    // CBK
    expect(researchService).toContain("91-day, 182-day and 364-day");
    expect(researchService).toContain("issueNumber");
    expect(researchService).toContain("valueDate");
    // Market assets
    expect(researchService).toContain("TRAILING-RETURN");
    expect(researchService).toContain("PRICE / NAV");
  });

  it("reviewCatalogueSource is admin-gated and never writes a catalogue directly", () => {
    const idx = routers.indexOf("reviewCatalogueSource: adminProcedure");
    expect(idx).toBeGreaterThan(-1);
    // Body up to the next procedure: it drives executeResearchTask (findings), and
    // must not enqueue/approve/publish anything itself.
    const body = routers.slice(idx, idx + 4535);
    expect(body).toContain("executeResearchTask");
    expect(body.includes("enqueueResearchUpdate")).toBe(false);
    expect(body.includes("reviewResearchUpdate")).toBe(false);
  });
});

describe("Round 95 · AI-sourced updates require explicit approval", () => {
  it("draftFromFinding only enqueues a pending update (admin-gated), never publishes", () => {
    const idx = routers.indexOf("draftFromFinding: adminProcedure");
    expect(idx).toBeGreaterThan(-1);
    const body = routers.slice(idx, idx + 2800);
    expect(body).toContain("enqueueResearchUpdate");
    // Drafting must not itself promote to a live catalogue figure.
    expect(body.includes("reviewResearchUpdate")).toBe(false);
  });

  it("the ONLY promotion path is the admin `review` mutation keyed on approve", () => {
    const idx = routers.indexOf("review: adminProcedure");
    expect(idx).toBeGreaterThan(-1);
    const body = routers.slice(idx, idx + 1600);
    expect(body).toContain(".mutation(");
    expect(body).toContain("approve:");
    expect(body).toContain("reviewResearchUpdate");
  });
});

describe("Round 95 · client surfaces are read-only and on-demand", () => {
  it("reconciliation explain is a demand-gated query shown only when red", () => {
    expect(reconciliation).toContain("trpc.aiExplain.reconciliationMismatch.useQuery");
    // enabled requires the dialog open AND the check to be NOT reconciled.
    expect(reconciliation).toContain("enabled: explainOpen");
    expect(reconciliation).toContain("!reconciled");
    expect(reconciliation.includes("aiExplain.reconciliationMismatch.useMutation")).toBe(false);
  });

  it("ledger explain is a demand-gated query per row", () => {
    expect(ledger).toContain("trpc.aiExplain.ledgerMonth.useQuery");
    expect(ledger).toContain("enabled: explainMonth != null");
    expect(ledger.includes("aiExplain.ledgerMonth.useMutation")).toBe(false);
  });

  it("dashboard status explain is a demand-gated query (manager-mode UI gate)", () => {
    expect(dashboard).toContain("trpc.aiExplain.dashboardStatus.useQuery");
    expect(dashboard).toContain("enabled: statusExplainOpen");
    expect(dashboard.includes("aiExplain.dashboardStatus.useMutation")).toBe(false);
  });

  it("Rate Settings and Source Registry rows expose the governed review button", () => {
    expect(updateRates).toContain('label="Review source with AI"');
    expect(researchDesk).toContain('label="Review source with AI"');
  });
});
