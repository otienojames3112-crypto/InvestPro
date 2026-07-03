# Round 96 test harness reference (from round91SourceReadGating.test.ts)

## Imports + ctx helper (copy verbatim)
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthedUser = NonNullable<TrpcContext["user"]>;
function ctxFor(role: "admin" | "user"): TrpcContext {
  const user: AuthedUser = {
    id: role === "admin" ? 1 : 2,
    openId: `sample-${role}`,
    email: `${role}@example.com`,
    name: role === "admin" ? "Admin Person" : "Plain User",
    loginMethod: "manus", role,
    createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}
function modelReply(answer: string, findings: unknown[] = []) {
  return { model: "test-model", choices: [{ message: { content: JSON.stringify({ answer, findings }) } }] } as never;
}
```
- LLM mock: `const llm = await import("./_core/llm"); vi.spyOn(llm, "invokeLLM").mockResolvedValue(...)`.
- fetch mock: `const intake = await import("./aiIntakeService"); vi.spyOn(intake, "fetchDocumentText").mockRejectedValue(new Error("HTTP 500"))` (unreadable) or `.mockResolvedValue("Loading…")` (thin, fatal for review).
- Caller: `const caller = appRouter.createCaller(ctxFor("admin"));`

## New procedures under test (Round 96)
- `caller.research.startReviewTask({ catalogue:"mmf"|"bank"|"cbk"|"market_asset", source:{kind:"url"|"text"|"pdf"|"image",...}, sourceLabel? })`
  -> returns `{ taskId:number, threadId, stage:"queued" }`. Does NOT call LLM (queued only). kind="review", reviewCatalogue set, prompt is a LABEL only.
- `caller.research.processResearchTask({ taskId })` -> advances SAME task. For review-kind it REBUILDS the full question via buildCatalogueReviewQuestion(cat, freshSnapshot). Returns { taskId, threadId, answer, model, findings, stage, sourceStatus }.
- `caller.research.getTask({ id })` -> { task, findings }.
- `caller.research.startResearchTask({...})` (ask) already covered by round91 E.

## Behaviors to assert (Round 96)
A. startReviewTask returns queued + no LLM; processResearchTask advances to terminal (pollable review).
B. Review with unreadable URL -> stage needs_source_fix, 0 findings, LLM never called (source-gated, still true through the task flow).
C. Ledger explainer split: shared/ledgerExplain covered by ledgerExplain.test.ts already; server ledgerMonth facts split is prompt-only (assert via reading routers source string? better: keep to existing ledgerExplain.test.ts + add a source-scan test asserting the two distinct fact lines exist).
D. All Approved bank deep-link: assert AllApprovedInstruments.tsx catalogueHref uses r.targetRef (source scan).
E. bankHoldings.linkToInstrument: mutation exists + admin-gated + null clears. (Prefer source-scan / caller with a real holding is hard w/o seeded DB — use source scan for wiring + adminProcedure guard test: caller as "user" should throw FORBIDDEN.)

## Notes
- Existing round91 C already tests reviewCatalogueSource (blocking) gating; keep it (procedure retained).
- round95AiGovernance.test.ts asserts aiExplain read-only already.
- Source-scan style: `const src = readFileSync(join(__dirname, "..", "client/src/...tsx"), "utf8")` — check other tests use a `read()` helper. round89 uses `read("client/src/components/CatalogueSourceReview.tsx")`.
