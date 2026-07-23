/**
 * Round 88 — Threaded Ask AI regression matrix.
 *
 * Locks the invariants introduced this round:
 *
 *   A. FOLLOW-UP CONTEXT — runResearchQuestion folds prior thread turns into the
 *      LLM call as real conversation messages (oldest-first, capped at 10, clipped),
 *      placed between the system prompt and the new question, and tags the turn as a
 *      follow-up. A cold (first) turn carries no prior turns and no follow-up note.
 *   B. PER-TURN SOURCE — a source attached to THIS turn grounds the answer and its
 *      warning is stamped onto every finding (the manager sees the caveat per turn).
 *   C. THREAD-TAGGED FINDINGS — findingsToRows stamps the threadId onto every row so
 *      a thread's findings can be gathered across all its turns.
 *   D. VERSIONED CORRECTION — correctFinding never mutates the original or a
 *      catalogue: it writes a corrected successor, links the pair, supersedes the
 *      original, and drafts a GOVERNED pending edit (old → new + reason + source)
 *      that lands in the review queue. (Static + logic guards over db.ts/routers.ts.)
 *   E. DOMAIN-AWARE, DECISION-SAFE PROMPT/UI — the system prompt gains Kenyan-market
 *      domain context and a holdings-vs-reference invariant, still allows factual
 *      sort/compare, still bans advice; the threaded UI keeps the same guardrail copy.
 *
 * Mix of LLM-mock runtime tests (A, B, C) and static-source guards (D, E), matching
 * the Round 82/85/86 style (no DB, no network beyond the mocked LLM).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runResearchQuestion, findingsToRows, RESEARCH_SYSTEM_PROMPT } from "./aiResearchService";
import type { ResearchFindingDraft } from "./aiResearchService";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Minimal well-formed model reply the JSON-schema parser accepts. */
function modelReply(answer: string, findings: unknown[] = []) {
  return {
    model: "test-model",
    choices: [{ message: { content: JSON.stringify({ answer, findings }) } }],
  } as never;
}

/* ─────────────────── A. Follow-up context assembly ─────────────────── */

describe("Round 88 · A — follow-ups carry prior thread context", () => {
  afterEach(() => vi.restoreAllMocks());

  it("folds prior turns in as conversation messages between system and question, oldest-first", async () => {
    const llm = await import("./_core/llm");
    const invoke = vi.spyOn(llm, "invokeLLM").mockResolvedValue(modelReply("The 182-day bill yielded 15.10%."));

    await runResearchQuestion({
      question: "And the 182-day one?",
      scope: "cbk",
      priorMessages: [
        { role: "user", content: "What did the 91-day T-bill yield this week?" },
        { role: "assistant", content: "The 91-day bill yielded 14.80% at the latest auction." },
      ],
    });

    const call = invoke.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const roles = call.messages.map((m) => m.role);
    // system, then the two prior turns in order, then the new user question last.
    expect(roles).toEqual(["system", "user", "assistant", "user"]);
    expect(call.messages[0].content).toBe(RESEARCH_SYSTEM_PROMPT);
    expect(call.messages[1].content).toContain("91-day T-bill");
    expect(call.messages[2].content).toContain("14.80%");
    const finalUser = call.messages[call.messages.length - 1].content;
    expect(finalUser).toContain("And the 182-day one?");
    // A follow-up is explicitly framed as such and still asked to emit standalone findings.
    expect(finalUser).toMatch(/FOLLOW-UP/i);
    expect(finalUser).toMatch(/standalone FINDINGS/i);
  });

  it("a cold opening turn has no prior messages and no follow-up note", async () => {
    const llm = await import("./_core/llm");
    const invoke = vi.spyOn(llm, "invokeLLM").mockResolvedValue(modelReply("Here is the briefing."));

    await runResearchQuestion({ question: "Current top MMF effective rates?", scope: "mmf" });

    const call = invoke.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    expect(call.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(call.messages[1].content).not.toMatch(/FOLLOW-UP/i);
  });

  it("caps prior turns at the last 10 and clips each turn's length", async () => {
    const llm = await import("./_core/llm");
    const invoke = vi.spyOn(llm, "invokeLLM").mockResolvedValue(modelReply("ok"));

    const many = Array.from({ length: 14 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `turn-${i} ` + "x".repeat(9000),
    }));
    await runResearchQuestion({ question: "next?", scope: "any", priorMessages: many });

    const call = invoke.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    // system + 10 prior + 1 new question = 12
    expect(call.messages.length).toBe(12);
    // Only the LAST 10 survive: the first prior message kept is turn-4.
    expect(call.messages[1].content).toContain("turn-4");
    // Each prior turn is clipped well below its 9000-char body.
    for (const m of call.messages.slice(1, 11)) {
      expect(m.content.length).toBeLessThanOrEqual(4000);
    }
  });
});

/* ─────────────────── B. Per-turn source grounds + warns ─────────────────── */

describe("Round 88 · B — a source attached to a turn grounds it and warns per finding", () => {
  afterEach(() => vi.restoreAllMocks());

  it("grounds on pasted text and passes findings through", async () => {
    const llm = await import("./_core/llm");
    const invoke = vi.spyOn(llm, "invokeLLM").mockResolvedValue(
      modelReply("From the fact sheet, the EAR is 15.98%.", [
        {
          instrumentName: "CIC MMF",
          issuer: "CIC",
          assetClass: "money market fund",
          currency: "KES",
          figures: [{ key: "ear", value: "15.98%" }],
          sourceLabel: "CIC fact sheet",
          sourceUrl: null,
          sourceAsOf: null,
          confidence: 0.9,
          warnings: [],
          rawExcerpt: "Effective annual rate 15.98%",
        },
      ]),
    );

    const res = await runResearchQuestion({
      question: "What is CIC MMF's EAR?",
      scope: "mmf",
      source: { kind: "text", text: "CIC Money Market Fund — Effective annual rate 15.98% as at May 2026." },
      sourceLabel: "CIC fact sheet",
    });

    const call = invoke.mock.calls[0][0] as { messages: Array<{ role: string; content: string }> };
    const userMsg = call.messages[call.messages.length - 1].content;
    expect(userMsg).toMatch(/GROUND YOUR FINDINGS IN THIS SOURCE/i);
    expect(userMsg).toContain("15.98%");
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0].extractedFields.ear).toBe("15.98%");
  });

  it("stamps a fetch-failure warning onto every finding when a URL source can't be read", async () => {
    const llm = await import("./_core/llm");
    vi.spyOn(llm, "invokeLLM").mockResolvedValue(
      modelReply("Answered from general knowledge.", [
        {
          instrumentName: "Some Fund",
          issuer: null,
          assetClass: "money market fund",
          currency: "KES",
          figures: [{ key: "ear", value: "10%" }],
          sourceLabel: "recollection",
          sourceUrl: null,
          sourceAsOf: null,
          confidence: 0.3,
          warnings: ["figure may be stale"],
          rawExcerpt: null,
        },
      ]),
    );

    const res = await runResearchQuestion({
      question: "What is the rate?",
      scope: "mmf",
      // A guaranteed-unresolvable host so fetchDocumentText throws and we take the warn path.
      source: { kind: "url", url: "https://nonexistent.invalid.example/rate" },
    });

    expect(res.findings).toHaveLength(1);
    // Original warning is preserved AND the grounding warning is appended to the finding.
    expect(res.findings[0].warnings).toContain("figure may be stale");
    expect(res.findings[0].warnings.some((w) => /could not fetch/i.test(w))).toBe(true);
  });
});

/* ─────────────────── C. Findings are thread-tagged ─────────────────── */

describe("Round 88 · C — findingsToRows tags the thread", () => {
  const draft: ResearchFindingDraft = {
    instrumentName: "CIC MMF",
    issuer: "CIC",
    assetClass: "money market fund",
    targetCatalogue: "mmf",
    currency: "KES",
    extractedFields: { ear: "15.98%" },
    sourceLabel: "CIC fact sheet",
    sourceUrl: null,
    sourceAsOf: null,
    confidence: 0.9,
    missingFields: [],
    warnings: [],
    rawExcerpt: null,
  };

  it("stamps the given threadId onto every row", () => {
    const rows = findingsToRows(42, [draft], 7);
    expect(rows).toHaveLength(1);
    expect(rows[0].taskId).toBe(42);
    expect(rows[0].threadId).toBe(7);
    expect(rows[0].status).toBe("new");
  });

  it("defaults threadId to null when none is given (backward compatible)", () => {
    const rows = findingsToRows(42, [draft]);
    expect(rows[0].threadId).toBeNull();
  });
});

/* ─────────────────── D. Versioned correction is governed + audited ─────────────────── */

describe("Round 88 · D — correctFinding versions, never mutates, and stays queue-governed", () => {
  const db = read("server/db.ts");
  const routers = read("server/routers.ts");
  const correct = db.slice(db.indexOf("export async function correctResearchFinding"));
  const body = correct.slice(0, correct.indexOf("\n}\n") + 1 || correct.length);

  it("writes a NEW corrected finding row rather than updating the original's figures", () => {
    // A fresh row is inserted with the edited figures + a back-link to the original.
    expect(body).toContain("db.insert(researchFindings)");
    expect(body).toContain("supersedesId: original.id");
    expect(body).toMatch(/correctionReason: reason/);
  });

  it("supersedes (never deletes) the original and links it forward to its successor", () => {
    expect(body).toContain('status: "superseded"');
    expect(body).toContain("supersededById: newFindingId");
    // Guard against a hard delete of the original finding.
    expect(body).not.toMatch(/db\.delete\(researchFindings\)/);
  });

  it("refuses to correct an already-superseded finding (correct the latest version)", () => {
    expect(body).toMatch(/already been corrected/i);
    expect(body).toContain("original.supersededById != null");
  });

  it("drafts a GOVERNED pending edit carrying old → new + reason + source (no live write)", () => {
    expect(body).toContain("enqueueResearchUpdate");
    expect(body).toMatch(/changeKind:\s*"edit"/);
    expect(body).toContain("oldValue");
    expect(body).toContain("managerValue: newValue");
    // The correction never writes a catalogue directly — no promotion/publish call here.
    expect(body).not.toMatch(/buildPromotionPlan|reviewResearchUpdate\(/);
    // It closes the loop by marking the corrected finding 'drafted' to that update.
    expect(body).toMatch(/updateFindingStatus\(newFindingId, "drafted"/);
  });

  it("the tRPC correctFinding procedure is admin-only and requires a plain-English reason", () => {
    const proc = routers.slice(routers.indexOf("correctFinding: adminProcedure"));
    const procBody = proc.slice(0, 3500);
    expect(procBody).toContain("adminProcedure");
    expect(procBody).toMatch(/reason:\s*z\.string\(\)\.min\(3\)/);
    expect(procBody).toContain("correctResearchFinding");
  });
});

/* ─────────────────── E. Domain-aware, decision-safe prompt + UI ─────────────────── */

describe("Round 88 · E — prompt gains domain context + holdings invariant, keeps guardrails", () => {
  const promptBody = RESEARCH_SYSTEM_PROMPT;
  const askAi = read("client/src/pages/AskAI.tsx");

  it("adds Kenyan-market domain context (EAR vs yield, T-bill tenors, WHT)", () => {
    expect(promptBody).toMatch(/KENYAN-MARKET DOMAIN CONTEXT/i);
    expect(promptBody).toMatch(/effective annual rate|EAR/i);
    expect(promptBody).toMatch(/91-day|182-day|364-day/);
    expect(promptBody).toMatch(/withholding tax|WHT|15%/i);
  });

  it("adds a holdings-vs-reference invariant that keeps the AI on the reference side", () => {
    expect(promptBody).toMatch(/HOLDINGS-vs-REFERENCE INVARIANT/i);
    expect(promptBody).toMatch(/reference catalogue/i);
    expect(promptBody).toMatch(/holding|position|balance/i);
    // It must refuse to turn a source's example balance into a finding.
    expect(promptBody).toMatch(/example balance|never let a source's example|never produce a finding that states or changes a holding/i);
  });

  it("still allows factual sorting/comparison and still bans recommendations", () => {
    expect(promptBody).toMatch(/factual/i);
    expect(promptBody).toMatch(/sort|sorted|comparison|compare/i);
    expect(promptBody).toMatch(/do not give advice|recommendation/i);
    expect(promptBody).toMatch(/buy\/sell\/hold|buy or sell|buy\/sell/i);
  });

  it("the threaded UI keeps the sort/compare-yes, recommend-no guardrail copy", () => {
    expect(askAi).toMatch(/sort and compare|compare/i);
    expect(askAi).toMatch(/never recommends|never tells you what to buy|does not.*recommend/i);
  });

  it("the UI is genuinely threaded: follow-up composer + conversation continue via threadId", () => {
    expect(askAi).toMatch(/Ask a follow-up/i);
    expect(askAi).toContain("threadId");
    expect(askAi).toContain("research.getThread");
    expect(askAi).toContain("research.correctFinding");
    expect(askAi).toContain("research.listThreads");
  });
});
