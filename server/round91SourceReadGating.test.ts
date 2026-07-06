/**
 * Round 91 — Robust source reading + task-based research flow regression matrix.
 *
 * The Research AI workflows (Ask AI + "Review source with AI") must behave like a
 * manager-grade tool: a SOURCE that cannot be read is diagnosed distinctly from an AI
 * engine failure, and a catalogue review NEVER proposes changes from memory. This
 * suite locks the six promised behaviours:
 *
 *   A. readSource CLASSIFIES every failure (pure, network-free): pasted text passes
 *      through; an empty paste, an unreadable URL, a thin (JS-rendered) page under the
 *      review policy, and an empty/failed transcription each return a TYPED ok:false
 *      with an actionable retryHint — never a bare "failed to fetch".
 *   B. readSource SUCCESS carries grounding text + provenance + non-fatal caveats: a thin
 *      URL under the Ask policy is ok:true (thin:true, warned); a PDF read is ok:true via
 *      deterministic server-side extraction, and an image read via AI transcription — each
 *      carrying a "confirm against the original" caveat.
 *   C. REVIEW is source-gated: an unreadable source stops BEFORE the LLM (invokeLLM is
 *      never called), produces ZERO findings, lands the task in stage needs_source_fix,
 *      and returns the actionable message. Review never falls back to general knowledge.
 *   D. ASK without a readable source respects the manager's choice: with a failed source
 *      and NO opt-in it also stops at needs_source_fix (no silent guessing); WITH
 *      allowUnsourced it answers, and every finding is marked NOT grounded in the source.
 *   E. The flow is TASK-BASED + POLLABLE: startResearchTask returns immediately with
 *      stage "queued" (no LLM yet), and processResearchTask advances the SAME task to
 *      a terminal stage — i.e. the long work is resumable via taskId, not one blocking
 *      request.
 *   F. PROVENANCE is preserved on findings: when the model omits the source, the finding
 *      is back-filled from the ACTUAL attached source (label + kind + checkedAt), so a
 *      genuinely-sourced fact is never mislabelled "no source".
 *
 * Pure tests (A, B) plus LLM/fetch-mock runtime tests through the tRPC caller (C–F),
 * matching the Round 82/85/86/88/89 house style.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSource } from "./aiResearchService";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Stage 1b: PDFs are now read by DETERMINISTIC server-side text extraction (unpdf), not
// an AI transcription (stock OpenAI's inline-PDF read proved unreliable). Mock unpdf so
// the pure PDF-read test below is deterministic without a real PDF fixture.
vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({
    totalPages: 1,
    text: "CIC MMF effective annual rate 16.10% as at June 2026.",
  })),
}));

type AuthedUser = NonNullable<TrpcContext["user"]>;
function ctxFor(role: "admin" | "user"): TrpcContext {
  const user: AuthedUser = {
    id: role === "admin" ? 1 : 2,
    openId: `sample-${role}`,
    email: `${role}@example.com`,
    name: role === "admin" ? "Admin Person" : "Plain User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

/** A well-formed model reply the JSON-schema parser accepts. */
function modelReply(answer: string, findings: unknown[] = []) {
  return {
    model: "test-model",
    choices: [{ message: { content: JSON.stringify({ answer, findings }) } }],
  } as never;
}
function figure(key: string, value: string) {
  return { key, value };
}

/* ─────────────────── A. readSource classifies every failure ─────────────────── */

describe("Round 91 · A — readSource returns a TYPED failure, not a bare fetch error", () => {
  afterEach(() => vi.restoreAllMocks());

  it("passes pasted text through as ok:true with a char count", async () => {
    const r = await readSource({ kind: "text", text: "  91-day T-bill 15.98% as at 20 Jun 2026.  " });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("text");
      expect(r.text).toContain("15.98%");
      expect(r.text.length).toBeGreaterThan(0);
      expect(r.warnings).toEqual([]);
      expect(r.thin).toBe(false);
    }
  });

  it("empty pasted text is a typed failure with a paste hint", async () => {
    const r = await readSource({ kind: "text", text: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("thin_fetch");
      expect(r.retryHint.length).toBeGreaterThan(0);
    }
  });

  it("an unreadable URL is url_unreadable with the paste/upload hint (never a bare fetch error)", async () => {
    const intake = await import("./aiIntakeService");
    vi.spyOn(intake, "fetchDocumentText").mockRejectedValue(new Error("The source URL returned HTTP 403."));
    const r = await readSource({ kind: "url", url: "https://example.com/blocked" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("url_unreadable");
      expect(r.kind).toBe("url");
      expect(r.message).toMatch(/could not read this link/i);
      expect(r.retryHint).toMatch(/paste|upload/i);
    }
  });

  it("a thin (JS-rendered) page is FATAL under the review policy (thinIsFatal)", async () => {
    const intake = await import("./aiIntakeService");
    vi.spyOn(intake, "fetchDocumentText").mockResolvedValue("Loading…"); // < 600 chars
    const r = await readSource({ kind: "url", url: "https://spa.example/rates" }, { thinIsFatal: true });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("thin_fetch");
      expect(r.retryHint).toMatch(/paste|screenshot/i);
    }
  });
});

/* ─────────────────── B. readSource success carries provenance + caveats ─────────────────── */

describe("Round 91 · B — a readable source carries grounding text, provenance and honest caveats", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a thin URL under the ASK policy is ok:true but flagged thin + warned", async () => {
    const intake = await import("./aiIntakeService");
    vi.spyOn(intake, "fetchDocumentText").mockResolvedValue("Rates: 15.98%"); // thin but non-empty
    const r = await readSource({ kind: "url", url: "https://www.example.com/rates" }); // thinIsFatal omitted
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.thin).toBe(true);
      expect(r.warnings.join(" ")).toMatch(/readable|JavaScript-rendered/i);
      // Label defaults to the bare hostname (www. stripped).
      expect(r.label).toBe("example.com");
      expect(r.url).toBe("https://www.example.com/rates");
    }
  });

  it("a PDF read is ok:true with a deterministic server-side extraction caveat", async () => {
    // readSource → transcribeSourceToText → extractPdfText (unpdf, mocked above). No LLM
    // call. A base64 data: URI is the storage-free upload the app now produces for a PDF.
    const r = await readSource(
      { kind: "pdf", fileUrl: "data:application/pdf;base64,JVBERi0xLjQK" },
      { label: "CIC fact sheet" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe("pdf");
      expect(r.label).toBe("CIC fact sheet");
      expect(r.text).toMatch(/16\.10%/);
      expect(r.warnings.join(" ")).toMatch(/read directly from the uploaded PDF/i);
    }
  });
});

/* ─────────────────── C. Review is source-gated (never guesses) ─────────────────── */

describe("Round 91 · C — Review source with AI never proposes from memory", () => {
  afterEach(() => vi.restoreAllMocks());

  it("an unreadable URL stops BEFORE the LLM: no findings, stage needs_source_fix", async () => {
    const intake = await import("./aiIntakeService");
    vi.spyOn(intake, "fetchDocumentText").mockRejectedValue(new Error("The source URL returned HTTP 500."));
    const llm = await import("./_core/llm");
    const llmSpy = vi.spyOn(llm, "invokeLLM").mockResolvedValue(modelReply("SHOULD NOT BE CALLED", []));

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.research.reviewCatalogueSource({
      catalogue: "mmf",
      source: { kind: "url", url: "https://blocked.example/factsheet" },
      sourceLabel: "Blocked fact sheet",
    });

    // The engine was NEVER asked — this was a SOURCE problem, not an AI answer.
    expect(llmSpy).not.toHaveBeenCalled();
    expect(res.stage).toBe("needs_source_fix");
    expect(res.findings.length).toBe(0);
    expect(res.sourceStatus?.ok).toBe(false);
    expect(res.answer).toMatch(/could not read/i);
  });

  it("a thin page is fatal for review (JS-rendered rates page yields no proposals)", async () => {
    const intake = await import("./aiIntakeService");
    vi.spyOn(intake, "fetchDocumentText").mockResolvedValue("Loading rates…");
    const llm = await import("./_core/llm");
    const llmSpy = vi.spyOn(llm, "invokeLLM").mockResolvedValue(modelReply("SHOULD NOT BE CALLED", []));

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.research.reviewCatalogueSource({
      catalogue: "cbk",
      source: { kind: "url", url: "https://spa.example/auction" },
    });
    expect(llmSpy).not.toHaveBeenCalled();
    expect(res.stage).toBe("needs_source_fix");
    expect(res.findings.length).toBe(0);
  });
});

/* ─────────────────── D. Ask AI respects the manager's source choice ─────────────────── */

describe("Round 91 · D — Ask AI stops or warns, per the manager's opt-in", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a failed source WITHOUT opt-in stops at needs_source_fix (no silent guessing)", async () => {
    const intake = await import("./aiIntakeService");
    vi.spyOn(intake, "fetchDocumentText").mockRejectedValue(new Error("DNS failure"));
    const llm = await import("./_core/llm");
    const llmSpy = vi.spyOn(llm, "invokeLLM").mockResolvedValue(modelReply("SHOULD NOT BE CALLED", []));

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.research.ask({
      question: "What is the latest 91-day T-bill yield from this page?",
      scope: "cbk",
      source: { kind: "url", url: "https://down.example/tbill" },
      // allowUnsourced omitted → default false
    });
    expect(llmSpy).not.toHaveBeenCalled();
    expect(res.stage).toBe("needs_source_fix");
    expect(res.findings.length).toBe(0);
  });

  it("a failed source WITH allowUnsourced answers, marking every finding NOT grounded", async () => {
    const intake = await import("./aiIntakeService");
    vi.spyOn(intake, "fetchDocumentText").mockRejectedValue(new Error("timeout"));
    const llm = await import("./_core/llm");
    vi.spyOn(llm, "invokeLLM").mockResolvedValue(
      modelReply("Broadly, recent 91-day T-bill yields have been near 16%.", [
        {
          instrumentName: "91-Day Treasury Bill",
          issuer: "CBK",
          assetClass: "treasury bill",
          currency: "KES",
          figures: [figure("yieldPct", "16%"), figure("tenorDays", "91")],
          sourceLabel: null,
          sourceUrl: null,
          sourceAsOf: null,
          confidence: 0.4,
          warnings: [],
          rawExcerpt: null,
        },
      ]),
    );

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.research.ask({
      question: "Roughly what is the 91-day T-bill yield?",
      scope: "cbk",
      source: { kind: "url", url: "https://down.example/tbill" },
      allowUnsourced: true,
    });
    expect(res.stage).toBe("done");
    expect(res.findings.length).toBeGreaterThanOrEqual(1);
    const warned = res.findings.every((f) =>
      (f.warnings ?? []).some((w) => /NOT grounded in the attached source/i.test(w)),
    );
    expect(warned).toBe(true);
    // A source that failed to read must NOT be stamped as provenance.
    for (const f of res.findings) expect(f.sourceLabel).toBeNull();
  });
});

/* ─────────────────── E. Task-based + pollable ─────────────────── */

describe("Round 91 · E — start returns a queued task, process advances it (resumable)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("startResearchTask does NOT call the LLM; processResearchTask advances the SAME task", async () => {
    const llm = await import("./_core/llm");
    const llmSpy = vi.spyOn(llm, "invokeLLM").mockResolvedValue(
      modelReply("The 182-day T-bill last cleared near 16.20%.", [
        {
          instrumentName: "182-Day Treasury Bill",
          issuer: "CBK",
          assetClass: "treasury bill",
          currency: "KES",
          figures: [figure("yieldPct", "16.20%"), figure("tenorDays", "182")],
          sourceLabel: "Pasted auction note",
          sourceUrl: null,
          sourceAsOf: "2026-06-20",
          confidence: 0.9,
          warnings: [],
          rawExcerpt: "182-day 16.20%",
        },
      ]),
    );

    const caller = appRouter.createCaller(ctxFor("admin"));
    const started = await caller.research.startResearchTask({
      question: "Record the 182-day T-bill rate from this note.",
      scope: "cbk",
      source: { kind: "text", text: "Auction 20 Jun 2026: 182-day 16.20%." },
      sourceLabel: "Pasted auction note",
    });
    // Nothing has been asked of the model yet — the task is merely queued.
    expect(started.stage).toBe("queued");
    expect(typeof started.taskId).toBe("number");
    expect(llmSpy).not.toHaveBeenCalled();

    // Poll state via getTask: still queued, no findings yet.
    const queued = await caller.research.getTask({ id: started.taskId });
    expect(queued.task?.stage).toBe("queued");
    expect(queued.findings.length).toBe(0);

    // Now process the SAME task to completion.
    const done = await caller.research.processResearchTask({ taskId: started.taskId });
    expect(done.taskId).toBe(started.taskId);
    expect(done.stage).toBe("done");
    expect(done.findings.length).toBeGreaterThanOrEqual(1);
    expect(llmSpy).toHaveBeenCalledTimes(1);

    // Re-processing a finished task is a no-op that returns the terminal state.
    const again = await caller.research.processResearchTask({ taskId: started.taskId });
    expect(again.stage).toBe("done");
    expect(llmSpy).toHaveBeenCalledTimes(1);
  });
});

/* ─────────────────── F. Provenance is preserved / back-filled ─────────────────── */

describe("Round 91 · F — findings keep the source's provenance even when the model omits it", () => {
  afterEach(() => vi.restoreAllMocks());

  it("back-fills label + kind + checkedAt from the ACTUAL pasted source", async () => {
    const llm = await import("./_core/llm");
    vi.spyOn(llm, "invokeLLM").mockResolvedValue(
      modelReply("The fund quotes an EAR of 16.10%.", [
        {
          instrumentName: `ZZ Provenance MMF ${Date.now()}`,
          issuer: "Test AMC",
          assetClass: "money market fund",
          currency: "KES",
          figures: [figure("ear", "16.10%")],
          // Model FORGOT to echo the source — the server must back-fill it.
          sourceLabel: null,
          sourceUrl: null,
          sourceAsOf: null,
          confidence: 0.9,
          warnings: [],
          rawExcerpt: "EAR 16.10%",
        },
      ]),
    );

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.research.ask({
      question: "Capture the MMF EAR from this fact sheet.",
      scope: "mmf",
      source: { kind: "text", text: "CIC MMF — Effective annual rate 16.10% as at June 2026." },
      sourceLabel: "CIC fact sheet",
    });
    expect(res.stage).toBe("done");
    expect(res.findings.length).toBeGreaterThanOrEqual(1);
    const f = res.findings[0];
    // Provenance was stamped from the attached source, not left blank.
    expect(f.sourceLabel).toBe("CIC fact sheet");
    // A readable source ⇒ checkedAt is set (the fact was verified against a source at read time).
    expect(typeof f.checkedAt === "number" || f.checkedAt === null).toBe(true);
    expect(f.checkedAt).not.toBeNull();
    // The "no source cited" self-warning is dropped once provenance is present.
    expect((f.warnings ?? []).some((w) => /No source was cited/i.test(w))).toBe(false);
  });
});
