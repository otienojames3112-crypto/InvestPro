/**
 * Round 86 — Research audit regression matrix.
 *
 * Locks the invariants introduced this round:
 *
 *   A. Approved-universe PURITY — `listFederatedUniverse` (and therefore the
 *      `explore.approvedList` view behind All Approved Instruments) only surfaces
 *      truly-approved rows: opportunity rows must be verified (not `unverified`,
 *      verificationState ∈ {human_verified, human_entered}) and not archived, so a
 *      scraped/unverified seed row like NSE:EABL never leaks in.
 *   B. Dedicated approved-universe page — the "all-approved" catalogue tab renders
 *      the new `AllApprovedInstruments` page (NOT the old Explore screener), and
 *      that page reads `explore.approvedList` while NOT depending on
 *      `opportunities.list` / `opportunities.scored` / a this/all scope toggle.
 *   C. ?ref= cross-catalogue leak fix — switching catalogue tab drops a stale
 *      `?ref=`/`?class=`, and every catalogue page clears a foreign ref that
 *      matches no row (useRefFocus.clearIfMissing wired on all four pages).
 *   D. Governed Test-Mode cleanup — a `researchAdmin` router exposes admin-only
 *      archive-all (Live-safe) + clear-pending + clear-audit, and a hard
 *      reset-to-seed gated behind `confirm: true`; the maintenance UI hides the
 *      destructive reset outside Test mode.
 *   E. Ask AI is allowed to sort/compare facts but still bans recommendations —
 *      both the system prompt and the on-screen banner reflect this.
 *
 * Static-source + pure-schema tests (no DB, no network), matching the Round 82/85
 * guard style.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const db = read("server/db.ts");
const routers = read("server/routers.ts");
const catalogueTabs = read("client/src/pages/referenceCatalogueTabs.tsx");
const allApproved = read("client/src/pages/AllApprovedInstruments.tsx");
const researchArea = read("client/src/pages/ResearchArea.tsx");
const tabbedArea = read("client/src/components/TabbedArea.tsx");
const useRefFocus = read("client/src/hooks/useRefFocus.ts");
const aiResearch = read("server/aiResearchService.ts");
const askAi = read("client/src/pages/AskAI.tsx");

const CATALOGUE_PAGES = [
  "client/src/pages/MmfFunds.tsx",
  "client/src/pages/BankInstruments.tsx",
  "client/src/pages/CbkSecuritiesReference.tsx",
  "client/src/pages/MarketAssetsReference.tsx",
] as const;

/* ─────────────────── A. Approved-universe purity ─────────────────── */

describe("Round 86 · A — approved universe excludes unverified rows", () => {
  const fed = db.slice(db.indexOf("export async function listFederatedUniverse"));
  const body = fed.slice(0, fed.indexOf("\n}\n"));

  it("gates opportunity rows behind human verification", () => {
    expect(body).toContain("if (o.unverified) continue;");
    expect(body).toContain("APPROVED_STATES.has(o.verificationState)");
  });

  it("defines the approved-state allowlist as human verified/entered only", () => {
    expect(body).toContain('new Set(["human_verified", "human_entered"])');
    expect(body).not.toContain('"scraped_unverified"');
    expect(body).not.toContain('"ai_extracted"');
  });

  it("excludes archived rows from every catalogue", () => {
    expect(body).toContain('isArchived("mmf"');
    expect(body).toContain('isArchived("bank"');
    expect(body).toContain("isArchived(cat, o.ref)");
  });
});

/* ─────────────── B. Dedicated approved-universe page ─────────────── */

describe("Round 86 · B — All Approved Instruments is a dedicated page", () => {
  it("the all-approved tab renders AllApprovedInstruments, not Explore", () => {
    expect(catalogueTabs).toContain('import AllApprovedInstruments from "./AllApprovedInstruments"');
    const allApprovedTab = catalogueTabs.slice(catalogueTabs.indexOf('id: "all-approved"'));
    const tabBlock = allApprovedTab.slice(0, allApprovedTab.indexOf("},"));
    expect(tabBlock).toContain("<AllApprovedInstruments");
    expect(tabBlock).not.toContain("<Explore");
  });

  it("reads the approvedList view", () => {
    expect(allApproved).toContain("trpc.explore.approvedList.useQuery");
  });

  it("does not depend on the opportunities screener or scope toggle", () => {
    expect(allApproved).not.toContain("opportunities.list");
    expect(allApproved).not.toContain("opportunities.scored");
    expect(allApproved).not.toContain("scopeView");
  });

  it("keeps a neutral catalogue-then-name order without a visible ranking mode", () => {
    expect(allApproved).toContain("CAT_ORDER[a.catalogue]");
    expect(allApproved).toContain("a.name.localeCompare(b.name)");
    expect(allApproved).not.toMatch(/plan[ _-]?fit/i);
  });
});

/* ─────────────────── C. ?ref= cross-catalogue leak fix ─────────────────── */

describe("Round 86 · C — stale ?ref= no longer leaks across catalogues", () => {
  it("dropping ref/class when switching the nested catalogue tab", () => {
    expect(researchArea).toContain('next.delete("ref")');
    expect(researchArea).toContain('next.delete("class")');
  });

  it("dropping nested ref/cat/class when switching top-level Research tabs", () => {
    expect(tabbedArea).toContain('delete("ref")');
  });

  it("exposes a clearIfMissing helper on useRefFocus", () => {
    expect(useRefFocus).toContain("clearIfMissing");
  });

  it("wires clearIfMissing into all four catalogue pages", () => {
    for (const rel of CATALOGUE_PAGES) {
      expect(read(rel)).toContain("clearIfMissing");
    }
  });
});

/* ─────────────────── D. Governed Test-Mode cleanup ─────────────────── */

describe("Round 86 · D — researchAdmin cleanup is governed", () => {
  const admin = routers.slice(routers.indexOf("researchAdmin: router("));
  const block = admin.slice(0, admin.indexOf("\n  }),\n});"));

  it("exposes the four cleanup mutations", () => {
    expect(block).toContain("archiveAllReferenceRows: adminProcedure");
    expect(block).toContain("clearPendingQueue: adminProcedure");
    expect(block).toContain("clearApprovalAuditLog: adminProcedure");
    expect(block).toContain("resetToSeed: adminProcedure");
  });

  it("gates the destructive reset-to-seed behind an explicit confirm", () => {
    const reset = block.slice(block.indexOf("resetToSeed:"));
    expect(reset).toContain("z.literal(true)");
  });

  it("archive-all is soft (deactivate + archive, history preserved)", () => {
    const start = db.indexOf("export async function archiveAllReferenceRows");
    const end = db.indexOf("export async function clearPendingResearchQueue", start);
    const body = db.slice(start, end);
    // It sets active=false + archives via lifecycle helpers, never db.delete on catalogues.
    expect(body).not.toContain("db.delete(mmfFunds)");
    expect(body).not.toContain("db.delete(bankInstruments)");
  });

  it("shows reset as unavailable and exposes no frontend mutation trigger", () => {
    const maint = allApproved.slice(allApproved.indexOf("function ReferenceDataMaintenance"));
    expect(maint).toContain("Disabled until safe sandbox reset is implemented.");
    expect(maint).toContain("Reference catalogues are currently shared across Live and Test.");
    expect(maint).not.toContain("researchAdmin.resetToSeed.useMutation");
    expect(maint).not.toContain("resetToSeed.mutate");
  });
});

/* ─────────────────── E. Ask AI: sort/compare allowed, advice banned ─────────────────── */

describe("Round 86 · E — Ask AI allows factual sorting, bans recommendations", () => {
  const prompt = aiResearch.slice(aiResearch.indexOf("RESEARCH_SYSTEM_PROMPT"));
  const promptBody = prompt.slice(0, prompt.indexOf("`;"));

  it("system prompt permits neutral factual comparison / sorting", () => {
    expect(promptBody).toMatch(/factual/i);
    expect(promptBody).toMatch(/sort|sorted|comparison|compare/i);
  });

  it("system prompt still bans advice / recommendations / buy-sell-hold", () => {
    expect(promptBody).toMatch(/do not give advice|recommendation/i);
    expect(promptBody).toMatch(/buy\/sell\/hold|buy or sell/i);
  });

  it("on-screen banner tells the user AI can sort/compare but not recommend", () => {
    expect(askAi).toMatch(/sort and compare|compare/i);
    expect(askAi).toMatch(/never recommends|never tells you what to buy|does not.*recommend/i);
  });
});
