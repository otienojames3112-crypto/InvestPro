/**
 * Round 96 — pollable catalogue review + audit fixes regression matrix.
 *
 * This round finished the job Round 91 started for Ask AI, extending the same
 * TASK-BASED + POLLABLE contract to the "Review source with AI" surface, and
 * shipped four smaller correctness fixes. The suite locks in:
 *
 *   A. REVIEW is now pollable: `startReviewTask` persists a QUEUED review task and
 *      returns immediately (stage "queued", no LLM). `processResearchTask` advances
 *      the SAME task to a terminal stage, rebuilding the full catalogue-extraction
 *      question from a FRESH snapshot at process time. Re-processing is a no-op.
 *   B. REVIEW stays source-gated THROUGH the task flow: a queued review whose source
 *      cannot be read advances to `needs_source_fix` with ZERO findings and never
 *      calls the LLM — the guarantee is preserved end-to-end, not just on the old
 *      blocking path.
 *   C. `startReviewTask` is admin-gated (a plain user is FORBIDDEN).
 *   D. All Approved deep-links use the STABLE per-row focus key (`r.targetRef`, i.e.
 *      `bank:<id>` for a bank product) rather than the shared display name, so two
 *      products from the same bank no longer collide on the catalogue page.
 *   E. A legacy bank holding can be LINKED to a reference product after the fact via
 *      `bankHoldings.linkToInstrument` (admin-gated, null clears the link).
 *   F. The Ledger AI explainer describes Treasury (CBK) cash-in and maturing
 *      bank-deposit cash-in as SEPARATE facts, and reports the bank + secondary-MMF
 *      end balances — it never merges the two cash-in legs into one figure.
 *   G. The retired Explore screener is gone: the page file no longer exists and the
 *      all-approved catalogue tab renders AllApprovedInstruments.
 *
 * Runtime tests (A–C) drive the real tRPC caller with a mocked LLM + source reader,
 * matching the Round 91 house style; static-source guards (D–G) scan the actual files.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

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

/* ───────────────────── A. Review is task-based + pollable ───────────────────── */

describe("Round 96 · A — startReviewTask queues; processResearchTask advances the SAME review", () => {
  afterEach(() => vi.restoreAllMocks());

  it("start does NOT call the LLM; process advances to done and is idempotent", async () => {
    const llm = await import("./_core/llm");
    const llmSpy = vi.spyOn(llm, "invokeLLM").mockResolvedValue(
      modelReply("Two MMF rows look stale versus the fact sheet.", [
        {
          instrumentName: "CIC Money Market Fund",
          issuer: "CIC Asset Management",
          assetClass: "mmf",
          currency: "KES",
          figures: [figure("ear", "16.10%")],
          sourceLabel: "Pasted CIC fact sheet",
          sourceUrl: null,
          sourceAsOf: "2026-06-20",
          confidence: 0.9,
          warnings: [],
          rawExcerpt: "CIC MMF EAR 16.10% as at Jun 2026",
        },
      ]),
    );

    const caller = appRouter.createCaller(ctxFor("admin"));
    const started = await caller.research.startReviewTask({
      catalogue: "mmf",
      source: { kind: "text", text: "CIC Money Market Fund — effective annual rate 16.10% as at 20 Jun 2026." },
      sourceLabel: "Pasted CIC fact sheet",
    });

    // Queued only — the model has NOT been asked anything yet.
    expect(started.stage).toBe("queued");
    expect(typeof started.taskId).toBe("number");
    expect(llmSpy).not.toHaveBeenCalled();

    // The poller sees a queued task with no findings yet.
    const queued = await caller.research.getTask({ id: started.taskId });
    expect(queued.task?.stage).toBe("queued");
    expect(queued.task?.kind).toBe("review");
    expect(queued.task?.reviewCatalogue).toBe("mmf");
    expect(queued.findings.length).toBe(0);

    // Process the SAME task to completion.
    const done = await caller.research.processResearchTask({ taskId: started.taskId });
    expect(done.taskId).toBe(started.taskId);
    expect(done.stage).toBe("done");
    expect(done.findings.length).toBeGreaterThanOrEqual(1);
    expect(llmSpy).toHaveBeenCalledTimes(1);

    // Re-processing a finished review is a no-op returning the terminal state.
    const again = await caller.research.processResearchTask({ taskId: started.taskId });
    expect(again.stage).toBe("done");
    expect(llmSpy).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the FULL catalogue-extraction question at process time (not the label prompt)", async () => {
    const llm = await import("./_core/llm");
    const llmSpy = vi.spyOn(llm, "invokeLLM").mockResolvedValue(modelReply("No changes needed.", []));

    const caller = appRouter.createCaller(ctxFor("admin"));
    const started = await caller.research.startReviewTask({
      catalogue: "cbk",
      source: { kind: "text", text: "Auction 20 Jun 2026 — 91-day 15.98%, 182-day 16.20%, 364-day 16.75%." },
      sourceLabel: "CBK auction results",
    });
    // The persisted prompt is only a human label, never the extraction instruction.
    const queued = await caller.research.getTask({ id: started.taskId });
    expect(queued.task?.prompt).toMatch(/^Catalogue review:/);
    expect(queued.task?.prompt).not.toMatch(/91 ?\/ ?182 ?\/ ?364|extract/i);

    await caller.research.processResearchTask({ taskId: started.taskId });
    // The model actually received the rebuilt extraction question (mentions the
    // 91/182/364-day tenors the CBK instruction enumerates), proving the rebuild ran.
    expect(llmSpy).toHaveBeenCalledTimes(1);
    const sentMessages = JSON.stringify((llmSpy.mock.calls[0]?.[0] as { messages?: unknown }).messages ?? "");
    expect(sentMessages).toMatch(/91|182|364/);
  });
});

/* ─────────────── B. Review stays source-gated through the task flow ─────────────── */

describe("Round 96 · B — a queued review with an unreadable source never reaches the LLM", () => {
  afterEach(() => vi.restoreAllMocks());

  it("processing advances to needs_source_fix with zero findings, LLM never called", async () => {
    const intake = await import("./aiIntakeService");
    vi.spyOn(intake, "fetchDocumentText").mockRejectedValue(new Error("The source URL returned HTTP 500."));
    const llm = await import("./_core/llm");
    const llmSpy = vi.spyOn(llm, "invokeLLM").mockResolvedValue(modelReply("SHOULD NOT BE CALLED", []));

    const caller = appRouter.createCaller(ctxFor("admin"));
    const started = await caller.research.startReviewTask({
      catalogue: "bank",
      source: { kind: "url", url: "https://blocked.example/deposit-rates" },
      sourceLabel: "Blocked bank page",
    });
    expect(started.stage).toBe("queued");

    const done = await caller.research.processResearchTask({ taskId: started.taskId });
    expect(llmSpy).not.toHaveBeenCalled();
    expect(done.stage).toBe("needs_source_fix");
    expect(done.findings.length).toBe(0);
    expect(done.sourceStatus?.ok).toBe(false);
  });
});

/* ───────────────────── C. startReviewTask is admin-gated ───────────────────── */

describe("Round 96 · C — startReviewTask rejects non-managers", () => {
  it("a plain user is FORBIDDEN", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    await expect(
      caller.research.startReviewTask({
        catalogue: "mmf",
        source: { kind: "text", text: "irrelevant" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

/* ───────────── D. All Approved deep-links use the stable focus key ───────────── */

describe("Round 96 · D — All Approved links by the stable per-row targetRef, not the shared name", () => {
  const page = read("client/src/pages/AllApprovedInstruments.tsx");

  it("catalogueHref derives the ref from r.targetRef (bank:<id> for banks), never r.name", () => {
    // Isolate the catalogueHref function body.
    const at = page.indexOf("function catalogueHref");
    expect(at, "catalogueHref must exist").toBeGreaterThan(-1);
    const body = page.slice(at, at + 900);
    // The stable per-row focus key is what gets encoded into ?ref=, so two
    // products at the same bank (which share a display name) can't collide.
    expect(body).toMatch(/const\s+refValue\s*=\s*r\.targetRef/);
    expect(body).toMatch(/ref=\$\{encodeURIComponent\(refValue\)\}/);
    // Guard against a regression to the old name-based ref for banks.
    expect(body).not.toMatch(/refValue\s*=\s*r\.name/);
  });
});

/* ─────────── E. A legacy bank holding can be linked to a reference product ─────────── */

describe("Round 96 · E — bankHoldings.linkToInstrument (auth+ownership-gated provenance backfill)", () => {
  const routers = read("server/routers.ts");

  it("the mutation exists, is auth+ownership gated and clears the link when passed null", () => {
    const at = routers.indexOf("linkToInstrument:");
    expect(at, "linkToInstrument mutation must exist").toBeGreaterThan(-1);
    const block = routers.slice(at, at + 1400);
    // Auth-gated procedure with explicit portfolio-ownership enforcement.
    expect(block).toContain("protectedProcedure");
    expect(block).toContain("requirePortfolio(input.portfolioId, ctx.user.id)");
    // Accepts a nullable bankInstrumentId so a manager can attach OR detach,
    // and the audit log records the (cleared) transition.
    expect(block).toMatch(/bankInstrumentId[\s\S]*?\.nullable\(\)/);
    expect(block).toContain("(cleared)");
  });

  it("a user without access to the portfolio is denied", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    await expect(
      caller.bankHoldings.linkToInstrument({ id: 1, portfolioId: 999999, bankInstrumentId: null }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

/* ─────────── F. Ledger explainer splits CBK vs bank cash-in ─────────── */

describe("Round 96 · F — the ledger AI explainer never merges Treasury and bank cash-in", () => {
  const routers = read("server/routers.ts");
  const ledger = read("client/src/pages/Ledger.tsx");

  it("the ledgerMonth facts describe CBK securities and bank instruments as SEPARATE lines", () => {
    const at = routers.indexOf("ledgerMonth:");
    expect(at).toBeGreaterThan(-1);
    const block = routers.slice(at, at + 3000);
    expect(block).toMatch(/Cash released from CBK securities/i);
    expect(block).toMatch(/Cash released from maturing bank instruments/i);
    // The two legs come from distinct inputs, not one summed field.
    expect(block).toContain("bankCashIn");
    expect(block).toContain("bankEndBalance");
  });

  it("the client sends cbkCashIn and bankCashIn separately (no merge into one figure)", () => {
    const at = ledger.indexOf("month: {");
    expect(at).toBeGreaterThan(-1);
    const block = ledger.slice(at, at + 900);
    expect(block).toMatch(/cbkCashIn:\s*explainRow\?\.cbkCashIn/);
    expect(block).toMatch(/bankCashIn:\s*explainRow\?\.bankCashIn/);
    // Guard against the old regression that summed the two legs into cbkCashIn.
    expect(block).not.toMatch(/cbkCashIn:.*\+.*bankCashIn/);
  });
});

/* ─────────── G. The Explore screener is retired ─────────── */

describe("Round 96 · G — the legacy Explore screener is gone, All Approved replaces it", () => {
  it("the Explore.tsx page file no longer exists", () => {
    expect(existsSync(resolve(ROOT, "client/src/pages/Explore.tsx"))).toBe(false);
  });

  it("the all-approved catalogue tab renders AllApprovedInstruments", () => {
    const tabs = read("client/src/pages/referenceCatalogueTabs.tsx");
    const m = tabs.match(/id:\s*"all-approved"[\s\S]*?render:\s*\(\)\s*=>\s*<([A-Za-z0-9_]+)/);
    expect(m?.[1]).toBe("AllApprovedInstruments");
    expect(tabs).not.toContain("import Explore ");
  });
});
