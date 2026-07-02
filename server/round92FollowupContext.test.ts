/**
 * Round 92 — Ask AI follow-ups behave like a continuing analyst conversation.
 *
 * A follow-up in an enquiry thread must carry DURABLE structured context (prior
 * findings' values, sources, triage state, and corrections — not just prose), let the
 * manager choose an explicit source behaviour per turn, version corrections without
 * overwriting, and NOT re-emit a finding that merely repeats an established one. This
 * suite locks those promises:
 *
 *   A. suppressDuplicateFindings (pure): an exact same-instrument/same-figures repeat of
 *      a still-valid prior finding is dropped; a CHANGED value is kept; a brand-new
 *      instrument is kept; and a dismissed prior never suppresses.
 *   B. The tool-aware system prompt states the catalogue-vs-holdings invariants,
 *      approval gating, future-projections-only rule, and per-asset-class fields/risks.
 *   C. A follow-up feeds PRIOR STRUCTURED FINDINGS into the model input (the established
 *      block names the prior instrument + its figures + source), not only prose.
 *   D. A follow-up can ATTACH A NEW SOURCE (sourceMode "new") — the answer is grounded
 *      in it and the resolved mode is echoed back.
 *   E. A follow-up can REUSE THE PREVIOUS SOURCE (sourceMode "reuse_previous") with no new
 *      attachment — the prior turn's source is re-read and grounded on.
 *   F. A correction creates a VERSIONED finding (old→new + reason + correctedBy/At), marks
 *      the original superseded (never overwritten), and drafts a governed pending edit.
 *   G. A follow-up does NOT create a duplicate finding unless a value changed (end-to-end
 *      through the ask engine with prior findings loaded from the thread).
 *
 * Pure tests (A, B) + LLM/fetch-mock runtime tests through the tRPC caller (C–G),
 * matching the Round 82/85/88/89/91 house style.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RESEARCH_SYSTEM_PROMPT,
  suppressDuplicateFindings,
  type PriorFindingContext,
} from "./aiResearchService";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

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
/** The CURRENT-turn user message is the LAST user message in the payload (earlier
 *  user messages are prior thread turns folded in as conversation context). */
function lastUserMessage(call: unknown): string {
  const msgs = (call as { messages: Array<{ role: string; content: string }> }).messages;
  const users = msgs.filter((m) => m.role === "user");
  return users[users.length - 1]?.content ?? "";
}
/** Build a prior-finding context entry for the pure suppression tests. */
function prior(
  instrument: string,
  figures: Record<string, string>,
  overrides: Partial<PriorFindingContext> = {},
): PriorFindingContext {
  return {
    instrument,
    assetClass: overrides.assetClass ?? "treasury bill",
    figures,
    sourceLabel: overrides.sourceLabel ?? "Prior note",
    sourceUrl: overrides.sourceUrl ?? null,
    asOf: overrides.asOf ?? null,
    status: overrides.status ?? "new",
    correction: overrides.correction ?? null,
  };
}
/** A candidate finding as the engine sees it post-parse (instrumentName + extractedFields). */
function candidate(instrumentName: string, extractedFields: Record<string, string>) {
  return { instrumentName, extractedFields };
}

/* ─────────────────── A. Duplicate suppression is value-aware (pure) ─────────────────── */

describe("Round 92 · A — suppressDuplicateFindings drops exact repeats, keeps changes", () => {
  it("drops a finding that exactly repeats a still-valid prior finding", () => {
    const priors = [prior("91-Day Treasury Bill", { yieldPct: "15.98%", tenorDays: "91" })];
    const out = suppressDuplicateFindings(
      [candidate("91-Day Treasury Bill", { yieldPct: "15.98%", tenorDays: "91" })],
      priors,
    );
    expect(out.length).toBe(0);
  });

  it("keeps a finding whose value CHANGED from the prior one", () => {
    const priors = [prior("91-Day Treasury Bill", { yieldPct: "15.98%", tenorDays: "91" })];
    const out = suppressDuplicateFindings(
      [candidate("91-Day Treasury Bill", { yieldPct: "16.20%", tenorDays: "91" })],
      priors,
    );
    expect(out.length).toBe(1);
    expect(out[0].extractedFields.yieldPct).toBe("16.20%");
  });

  it("keeps a finding for a brand-new instrument never seen before", () => {
    const priors = [prior("91-Day Treasury Bill", { yieldPct: "15.98%" })];
    const out = suppressDuplicateFindings(
      [candidate("182-Day Treasury Bill", { yieldPct: "16.40%" })],
      priors,
    );
    expect(out.length).toBe(1);
  });

  it("matches case/space-insensitively and ignores figure ORDER when repeating", () => {
    const priors = [prior("91-day  Treasury BILL", { tenorDays: "91", yieldPct: "15.98%" })];
    const out = suppressDuplicateFindings(
      [candidate("91-Day Treasury Bill", { yieldPct: "15.98%", tenorDays: "91" })],
      priors,
    );
    expect(out.length).toBe(0);
  });

  it("a DISMISSED prior never suppresses a repeat (manager rejected it, so re-surfacing is allowed)", () => {
    const priors = [prior("91-Day Treasury Bill", { yieldPct: "15.98%" }, { status: "dismissed" })];
    const out = suppressDuplicateFindings(
      [candidate("91-Day Treasury Bill", { yieldPct: "15.98%" })],
      priors,
    );
    expect(out.length).toBe(1);
  });

  it("no prior findings → every candidate passes through untouched", () => {
    const out = suppressDuplicateFindings([candidate("X", { a: "1" })], []);
    expect(out.length).toBe(1);
  });
});

/* ─────────────────── B. The system prompt is tool-aware (pure) ─────────────────── */

describe("Round 92 · B — the Ask AI system prompt states the tracker's invariants", () => {
  it("distinguishes reference catalogues from holdings/actual money", () => {
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/Reference catalogues are NOT holdings/i);
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/Holdings are the actual money/i);
  });

  it("states findings do not affect math until a human approves", () => {
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/do NOT affect any portfolio maths until a human APPROVES/i);
  });

  it("states approved changes affect FUTURE PROJECTIONS ONLY and never rewrite historical actuals", () => {
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/FUTURE PROJECTIONS ONLY/i);
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/never (?:restated|rewrite)|does not,? and must not,? rewrite HISTORICAL ACTUALS/i);
  });

  it("names the distinct fields/risks for MMFs, bank products, CBK securities, and market assets", () => {
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/MMFs:/);
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/Bank products/i);
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/CBK securities/i);
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/Market assets/i);
    // A representative risk per class.
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/withholding tax/i);
    expect(RESEARCH_SYSTEM_PROMPT).toMatch(/auction yield is a point-in-time/i);
  });
});

/* ─────────────────── C. Follow-up carries prior STRUCTURED findings ─────────────────── */

describe("Round 92 · C — a follow-up feeds prior structured findings into the model", () => {
  afterEach(() => vi.restoreAllMocks());

  it("the established-context block names the prior instrument + figures + source", async () => {
    const llm = await import("./_core/llm");
    const spy = vi.spyOn(llm, "invokeLLM");
    const uniq = `ZZ Ctx MMF ${Date.now()}`;

    // Turn 1 — establish a finding (pasted source, so no network needed).
    spy.mockResolvedValueOnce(
      modelReply("The fund's EAR is 16.10%.", [
        {
          instrumentName: uniq,
          issuer: "Test AMC",
          assetClass: "money market fund",
          currency: "KES",
          figures: [figure("ear", "16.10%")],
          sourceLabel: "CIC fact sheet",
          sourceUrl: null,
          sourceAsOf: "2026-06-20",
          confidence: 0.9,
          warnings: [],
          rawExcerpt: "EAR 16.10%",
        },
      ]),
    );
    const caller = appRouter.createCaller(ctxFor("admin"));
    const first = await caller.research.ask({
      question: `Capture the EAR for ${uniq}.`,
      scope: "mmf",
      source: { kind: "text", text: `${uniq}: effective annual rate 16.10% as at Jun 2026.` },
      sourceLabel: "CIC fact sheet",
    });
    expect(first.stage).toBe("done");
    const threadId = first.threadId;

    // Turn 2 — a follow-up with NO new source. The engine must be handed the prior
    // finding in its message payload.
    spy.mockResolvedValueOnce(modelReply("Its management fee is separate from the EAR.", []));
    await caller.research.ask({
      question: "Is that quote net of the management fee?",
      scope: "mmf",
      threadId,
      sourceMode: "none",
    });

    // Inspect the SECOND invokeLLM call — its user message must contain the durable
    // established-context block referencing the prior instrument, its figure, and source.
    expect(spy).toHaveBeenCalledTimes(2);
    const userMsg = lastUserMessage(spy.mock.calls[1]?.[0]);
    expect(userMsg).toMatch(/WHAT YOU ALREADY ESTABLISHED IN THIS ENQUIRY/i);
    expect(userMsg).toContain(uniq);
    expect(userMsg).toMatch(/ear=16\.10%/i);
    expect(userMsg).toContain("CIC fact sheet");
  });
});

/* ─────────────────── D. Follow-up can attach a NEW source ─────────────────── */

describe("Round 92 · D — a follow-up can add another source", () => {
  afterEach(() => vi.restoreAllMocks());

  it("grounds the follow-up in the freshly attached source and echoes sourceMode 'new'", async () => {
    const llm = await import("./_core/llm");
    const spy = vi.spyOn(llm, "invokeLLM");
    const uniq = `ZZ NewSrc Bill ${Date.now()}`;

    spy.mockResolvedValueOnce(modelReply("Opened the enquiry.", []));
    const caller = appRouter.createCaller(ctxFor("admin"));
    const first = await caller.research.ask({
      question: `Start an enquiry about ${uniq}.`,
      scope: "cbk",
      sourceMode: "none",
    });
    const threadId = first.threadId;

    spy.mockResolvedValueOnce(
      modelReply("The latest note shows 16.35%.", [
        {
          instrumentName: uniq,
          issuer: "CBK",
          assetClass: "treasury bill",
          currency: "KES",
          figures: [figure("yieldPct", "16.35%")],
          sourceLabel: "New auction note",
          sourceUrl: null,
          sourceAsOf: "2026-06-27",
          confidence: 0.9,
          warnings: [],
          rawExcerpt: "16.35%",
        },
      ]),
    );
    const second = await caller.research.ask({
      question: "Here's a newer note — what does it say?",
      scope: "cbk",
      threadId,
      source: { kind: "text", text: `${uniq}: auction 27 Jun 2026 cleared at 16.35%.` },
      sourceLabel: "New auction note",
      sourceMode: "new",
    });
    expect(second.stage).toBe("done");
    expect(second.sourceMode).toBe("new");
    // The follow-up finding is grounded (checkedAt stamped) in the NEW source.
    const f = second.findings.find((x) => x.instrumentName === uniq);
    expect(f).toBeTruthy();
    expect(f?.checkedAt).not.toBeNull();

    // The second LLM call's user message contains the newly-attached grounding text.
    const userMsg = lastUserMessage(spy.mock.calls[1]?.[0]);
    expect(userMsg).toContain("16.35%");
  });
});

/* ─────────────────── E. Follow-up can REUSE the previous source ─────────────────── */

describe("Round 92 · E — a follow-up can reuse the previous source", () => {
  afterEach(() => vi.restoreAllMocks());

  it("re-reads the prior turn's source with no new attachment and echoes 'reuse_previous'", async () => {
    const llm = await import("./_core/llm");
    const spy = vi.spyOn(llm, "invokeLLM");
    const uniq = `ZZ Reuse MMF ${Date.now()}`;
    const sourceText = `${uniq}: gross yield 16.90%, management fee 2.00%, as at Jun 2026.`;

    // Turn 1 — attach a pasted source that stays on the thread.
    spy.mockResolvedValueOnce(
      modelReply("Gross yield is 16.90%.", [
        {
          instrumentName: uniq,
          issuer: "Test AMC",
          assetClass: "money market fund",
          currency: "KES",
          figures: [figure("yieldPct", "16.90%")],
          sourceLabel: "Reused fact sheet",
          sourceUrl: null,
          sourceAsOf: "2026-06-20",
          confidence: 0.9,
          warnings: [],
          rawExcerpt: "16.90%",
        },
      ]),
    );
    const caller = appRouter.createCaller(ctxFor("admin"));
    const first = await caller.research.ask({
      question: `What is the gross yield for ${uniq}?`,
      scope: "mmf",
      source: { kind: "text", text: sourceText },
      sourceLabel: "Reused fact sheet",
    });
    const threadId = first.threadId;

    // Turn 2 — reuse the previous source, NO new attachment.
    spy.mockResolvedValueOnce(
      modelReply("The management fee on that same sheet is 2.00%.", [
        {
          instrumentName: uniq,
          issuer: "Test AMC",
          assetClass: "money market fund",
          currency: "KES",
          figures: [figure("managementFee", "2.00%")],
          sourceLabel: "Reused fact sheet",
          sourceUrl: null,
          sourceAsOf: "2026-06-20",
          confidence: 0.9,
          warnings: [],
          rawExcerpt: "fee 2.00%",
        },
      ]),
    );
    const second = await caller.research.ask({
      question: "And what management fee does that same sheet quote?",
      scope: "mmf",
      threadId,
      sourceMode: "reuse_previous",
    });
    expect(second.stage).toBe("done");
    expect(second.sourceMode).toBe("reuse_previous");

    // The reused source text must have been re-read into the second call's grounding.
    const userMsg = lastUserMessage(spy.mock.calls[1]?.[0]);
    expect(userMsg).toContain("management fee 2.00%");
    // And the follow-up finding is grounded (checkedAt set) because it had a readable source.
    const f = second.findings.find((x) => x.instrumentName === uniq);
    expect(f?.checkedAt).not.toBeNull();
  });
});

/* ─────────────────── F. Corrections are versioned, never overwritten ─────────────────── */

describe("Round 92 · F — a correction creates a versioned finding + a governed edit", () => {
  afterEach(() => vi.restoreAllMocks());

  it("writes a NEW corrected finding, supersedes the original, and drafts a pending update", async () => {
    const llm = await import("./_core/llm");
    const spy = vi.spyOn(llm, "invokeLLM");
    const uniq = `ZZ Correct Bond ${Date.now()}`;

    spy.mockResolvedValueOnce(
      modelReply("The bond's issue number is 2690/090.", [
        {
          instrumentName: uniq,
          issuer: "CBK",
          assetClass: "treasury bond",
          currency: "KES",
          figures: [figure("issueNumber", "2690/090"), figure("couponPct", "13.5%")],
          sourceLabel: "CBK prospectus",
          sourceUrl: null,
          sourceAsOf: "2026-06-20",
          confidence: 0.9,
          warnings: [],
          rawExcerpt: "IFB1/2026 issue 2690/090",
        },
      ]),
    );
    const caller = appRouter.createCaller(ctxFor("admin"));
    const first = await caller.research.ask({
      question: `Capture the issue number for ${uniq}.`,
      scope: "cbk",
      source: { kind: "text", text: `${uniq} — issue no. 2690/090, coupon 13.5%.` },
      sourceLabel: "CBK prospectus",
    });
    const original = first.findings.find((x) => x.instrumentName === uniq);
    expect(original).toBeTruthy();

    // The manager corrects the issue number → 2690/091.
    const corrected = await caller.research.correctFinding({
      findingId: original!.id,
      field: "issueNumber",
      newValue: "2690/091",
      reason: "Transposed digit; the prospectus reopening is 2690/091.",
    });
    expect(corrected.newFindingId).toBeTruthy();
    expect(corrected.pendingUpdateId).toBeTruthy();

    // Re-read the thread: original is superseded (NOT overwritten), a new corrected row
    // exists carrying the new value + reason + correctedBy/At + a back-link.
    const thread = await caller.research.getThread({ id: first.threadId });
    const old = thread.findings.find((x) => x.id === original!.id);
    const neu = thread.findings.find((x) => x.id === corrected.newFindingId);
    expect(old?.status).toBe("superseded");
    expect(old?.supersededById).toBe(corrected.newFindingId);
    // Original value is preserved on the old row (never mutated in place).
    expect((old?.extractedFields as Record<string, string>).issueNumber).toBe("2690/090");
    // The corrected version carries the new value + full correction provenance.
    expect((neu?.extractedFields as Record<string, string>).issueNumber).toBe("2690/091");
    expect(neu?.supersedesId).toBe(original!.id);
    expect(neu?.correctedBy).toBeTruthy();
    expect(neu?.correctedAt).not.toBeNull();
    expect(neu?.correctionReason).toMatch(/2690\/091/);
  });
});

/* ─────────────────── G. No duplicate finding unless a value changed (end-to-end) ─────────────────── */

describe("Round 92 · G — a follow-up does not duplicate an established finding", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drops an exact-repeat finding but keeps one whose value changed", async () => {
    const llm = await import("./_core/llm");
    const spy = vi.spyOn(llm, "invokeLLM");
    const uniq = `ZZ Dedup Bill ${Date.now()}`;
    const fpayload = (yieldPct: string) => [
      {
        instrumentName: uniq,
        issuer: "CBK",
        assetClass: "treasury bill",
        currency: "KES",
        figures: [figure("yieldPct", yieldPct), figure("tenorDays", "91")],
        sourceLabel: "Auction note",
        sourceUrl: null,
        sourceAsOf: "2026-06-20",
        confidence: 0.9,
        warnings: [],
        rawExcerpt: yieldPct,
      },
    ];

    // Turn 1 — establish yieldPct 15.98%.
    spy.mockResolvedValueOnce(modelReply("The 91-day cleared at 15.98%.", fpayload("15.98%")));
    const caller = appRouter.createCaller(ctxFor("admin"));
    const first = await caller.research.ask({
      question: `Record the 91-day yield for ${uniq}.`,
      scope: "cbk",
      source: { kind: "text", text: `${uniq}: 91-day 15.98%.` },
      sourceLabel: "Auction note",
    });
    const threadId = first.threadId;
    expect(first.findings.filter((x) => x.instrumentName === uniq).length).toBe(1);

    // Turn 2 — the model unhelpfully RE-EMITS the identical finding. It must be dropped.
    spy.mockResolvedValueOnce(modelReply("Same as before: 15.98%.", fpayload("15.98%")));
    const repeat = await caller.research.ask({
      question: "Just confirm the 91-day figure again.",
      scope: "cbk",
      threadId,
      sourceMode: "reuse_previous",
    });
    expect(repeat.findings.filter((x) => x.instrumentName === uniq).length).toBe(0);

    // Turn 3 — the value CHANGED (16.20%): the finding is kept for triage.
    spy.mockResolvedValueOnce(modelReply("It has since moved to 16.20%.", fpayload("16.20%")));
    const changed = await caller.research.ask({
      question: "Has the 91-day moved since?",
      scope: "cbk",
      threadId,
      sourceMode: "reuse_previous",
    });
    const kept = changed.findings.filter((x) => x.instrumentName === uniq);
    expect(kept.length).toBe(1);
    expect((kept[0].extractedFields as Record<string, string>).yieldPct).toBe("16.20%");
  });
});
