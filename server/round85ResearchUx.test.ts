/**
 * Round 85 — Research UX / pipeline audit regression matrix.
 *
 * Locks in the invariants introduced this round so they cannot silently regress:
 *
 *   A. Unified Ask-AI intake — `research.ask` accepts ONE optional `source`
 *      discriminated union (url | text | pdf | image); the separate "Import a
 *      document" fork is gone from the Ask AI page.
 *   B. Explore is no longer a top-level Research tab — it lives as the nested
 *      "all-approved" catalogue (All Approved Instruments), and the legacy
 *      `/explore` route + snapshot deep-link resolve there.
 *   C. Nested-catalogue legacy redirects (mmf-market, all-approved, …) forward to
 *      `reference-catalogues&cat=<id>`, not a bare `?tab=<id>` that would fall
 *      back to the Research Desk.
 *   D. MMF governed direct edit — `mmfFunds.update` accepts an optional `reason`,
 *      records it in the manual-correction audit, and appends a date-effective
 *      rate-history point when the headline EAR actually changes.
 *   E. MMF Market copy is source-aware/computed — no hardcoded "27 funds" or a
 *      baked industry-average EAR constant.
 *
 * These are static-source + pure-schema tests (no DB, no network), matching the
 * style of the Round 82/83 guards.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { LEGACY_REDIRECTS, buildRedirectTarget } from "../shared/legacyRoutes";
import { AREA_TABS } from "../shared/navigation";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const routers = read("server/routers.ts");
const askAi = read("client/src/pages/AskAI.tsx");
const catalogueTabs = read("client/src/pages/referenceCatalogueTabs.tsx");
const researchArea = read("client/src/pages/ResearchArea.tsx");
const mmf = read("client/src/pages/MmfFunds.tsx");
const appTsx = read("client/src/App.tsx");
const snapshot = read("server/snapshot.ts");

/* ─────────────────────────── A. Unified intake ─────────────────────────── */

describe("Round 85 · A — unified Ask-AI source union", () => {
  // A faithful re-declaration of the server's `research.ask` source union, used
  // to prove the four intake modes parse and malformed input is rejected. Kept in
  // lockstep with routers.ts by the source-guard test below.
  const source = z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("url"), url: z.string().url().max(500) }),
      z.object({ kind: z.literal("text"), text: z.string().min(1).max(40000) }),
      z.object({ kind: z.literal("pdf"), fileKey: z.string().min(1).max(300) }),
      z.object({ kind: z.literal("image"), fileKey: z.string().min(1).max(300) }),
    ])
    .optional();

  it("accepts all four source modes plus 'no source'", () => {
    expect(source.safeParse(undefined).success).toBe(true);
    expect(source.safeParse({ kind: "url", url: "https://cma.or.ke/rates" }).success).toBe(true);
    expect(source.safeParse({ kind: "text", text: "CIC MMF net yield 9.8%" }).success).toBe(true);
    expect(source.safeParse({ kind: "pdf", fileKey: "u1/doc.pdf" }).success).toBe(true);
    expect(source.safeParse({ kind: "image", fileKey: "u1/shot.png" }).success).toBe(true);
  });

  it("rejects malformed sources (bad url, empty text, unknown kind)", () => {
    expect(source.safeParse({ kind: "url", url: "not-a-url" }).success).toBe(false);
    expect(source.safeParse({ kind: "text", text: "" }).success).toBe(false);
    expect(source.safeParse({ kind: "audio", fileKey: "x" }).success).toBe(false);
  });

  it("routers.ts wires the unified union into research.ask (all four kinds resolved)", () => {
    const askIdx = routers.indexOf("ask: adminProcedure");
    expect(askIdx).toBeGreaterThan(-1);
    // Round 88/92 grew the ask procedure (thread resolution + message persistence +
    // per-follow-up source-mode resolution), and Stage 1b added getThread payload
    // scrubbing within this span, so widen the window to still reach the delegation +
    // source-resolution + engine call below.
    const seg = routers.slice(askIdx, askIdx + 15000);
    // The union lists every kind, and each is resolved into a ResearchSource.
    for (const kind of ["url", "text", "pdf", "image"]) {
      expect(seg).toContain(`z.literal("${kind}")`);
    }
    // Round 91 — the ask procedure now DELEGATES to the shared executeResearchTask
    // pipeline (which reads the source once, BEFORE the LLM, and classifies read
    // failures). The file-key→signed-URL resolution and the engine call therefore live
    // in that shared helper, not inline in `ask`. Assert the delegation here, and the
    // resolution + engine call at the shared helper below.
    expect(seg).toContain("executeResearchTask");
    const helperIdx = routers.indexOf("async function resolveResearchSource");
    expect(helperIdx).toBeGreaterThan(-1);
    const helper = routers.slice(helperIdx, routers.indexOf("// ─── Zod schemas"));
    // File-key kinds are turned into signed URLs the model reads.
    expect(helper).toContain("storageGetSignedUrl");
    // The shared pipeline reads the source (the single choke point) then calls the engine.
    expect(helper).toContain("readSource");
    expect(helper).toContain("runResearchQuestion");
  });

  it("the Ask AI page no longer has a separate Import-document tab/fork", () => {
    // The unified picker is an inline "source" expander on the Ask panel, not a
    // second top-level intake tab. Guard against the old fork wording returning.
    expect(askAi).not.toMatch(/Import a document/i);
    expect(askAi).not.toMatch(/TabsTrigger[^>]*value=["']import["']/);
  });
});

/* ────────────────── B & C. Explore removal + redirects ─────────────────── */

describe("Round 85 · B — Explore is nested, not a top-level Research tab", () => {
  it("AREA_TABS.research has exactly the two top-level tabs (no 'explore')", () => {
    expect([...AREA_TABS.research]).toEqual(["research-desk", "reference-catalogues"]);
    expect(AREA_TABS.research).not.toContain("explore");
  });

  it("ResearchArea declares only the two top-level tabs", () => {
    const ids = [...researchArea.matchAll(/\bid:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual(["research-desk", "reference-catalogues"]);
  });

  it("referenceCatalogueTabs exposes 'all-approved' rendering the Explore screener", () => {
    const ids = [...catalogueTabs.matchAll(/\bid:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
    // Round 90 — All Approved Instruments leads the catalogue tabs.
    expect(ids).toEqual([
      "all-approved",
      "mmf-market",
      "bank-catalogue",
      "cbk-securities",
      "market-assets",
    ]);
    // all-approved must render <Explore …>.
    const m = catalogueTabs.match(
      /id:\s*"all-approved"[\s\S]*?render:\s*\(\)\s*=>\s*<([A-Za-z0-9_]+)/,
    );
    expect(m?.[1]).toBe("AllApprovedInstruments");
  });
});

describe("Round 85 · C — legacy /explore + nested-cat redirects resolve correctly", () => {
  it("the /explore legacy redirect targets the nested all-approved catalogue", () => {
    const r = LEGACY_REDIRECTS.find((x) => x.from === "/explore");
    expect(r).toBeTruthy();
    expect(r).toMatchObject({ area: "research", tab: "all-approved" });
  });

  it("buildRedirectTarget preserves the ?class= handoff for /explore", () => {
    const r = LEGACY_REDIRECTS.find((x) => x.from === "/explore")!;
    const target = buildRedirectTarget(r, "class=equity");
    const url = new URL(target, "https://x.test");
    expect(url.pathname).toBe("/research");
    expect(url.searchParams.get("class")).toBe("equity");
  });

  it("App.tsx TabRedirect translates nested-catalogue ids into reference-catalogues&cat=", () => {
    // The mechanism that keeps mmf-strategy / explore redirects landing on the
    // right catalogue instead of silently falling back to the Research Desk.
    expect(appTsx).toContain("CATALOGUE_TAB_IDS");
    expect(appTsx).toMatch(/set\(["']tab["'],\s*["']reference-catalogues["']\)/);
    expect(appTsx).toMatch(/set\(["']cat["'],\s*tab\)/);
  });

  it("the allocation → screener snapshot deep-link points at the nested all-approved cat", () => {
    expect(snapshot).toContain("cat=all-approved");
    expect(snapshot).not.toContain("tab=explore");
  });
});

/* ─────────────────────── D. MMF governed direct edit ────────────────────── */

describe("Round 85 · D — MMF governed edit records reason + rate history", () => {
  it("mmfFunds.update input accepts an optional reason", () => {
    const idx = routers.indexOf("mmfFunds: router(");
    expect(idx).toBeGreaterThan(-1);
    const seg = routers.slice(idx, idx + 8000);
    expect(seg).toMatch(/reason:\s*z\.string\(\)\.max\(300\)\.optional\(\)/);
  });

  it("the update passes reason into the manual-correction audit", () => {
    const idx = routers.indexOf("mmfFunds: router(");
    const seg = routers.slice(idx, idx + 8000);
    expect(seg).toContain("recordManualCorrectionAudit");
    expect(seg).toMatch(/reason:\s*reason\s*\?\?\s*null/);
  });

  it("the update appends a rate-history point only when EAR actually changes", () => {
    const idx = routers.indexOf("mmfFunds: router(");
    const seg = routers.slice(idx, idx + 8000);
    expect(seg).toContain("appendMmfManualRatePoint");
    // Guarded by a real change in EAR (not an unconditional append).
    expect(seg).toMatch(/Number\(before\.ear\)\s*!==\s*rest\.ear/);
  });
});

/* ───────────────────── E. MMF Market copy is dynamic ────────────────────── */

describe("Round 85 · E — MMF Market copy/stats are source-aware, not hardcoded", () => {
  it("does not hardcode a fund count like '27 funds' in the copy", () => {
    expect(mmf).not.toMatch(/\b27 funds\b/);
  });

  it("does not carry a baked industry-average EAR constant", () => {
    expect(mmf).not.toMatch(/INDUSTRY_AVG_EAR\s*=/);
  });

  it("renders a Source & Freshness column and wires deep-link row focus", () => {
    expect(mmf).toMatch(/Source (&amp;|&) freshness/i);
    expect(mmf).toContain("useRefFocus");
  });
});
