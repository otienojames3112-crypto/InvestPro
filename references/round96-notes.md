# Round 96 — Audit fixes (implementation notes)

Source spec: /home/ubuntu/upload/pasted_content_28.txt (9 numbered items).

## Server contracts already available (routers.ts, research router)
- `research.getTask` (adminProcedure query) input `{ id }` -> `{ task, findings }`. task has: stage, status, answerSummary, aiModel, sourceStatus (json), threadId, kind.
- `research.listFindings` query input `{ taskId?, threadId?, status? }` -> `{ findings }`.
- `research.getThread` query input `{ id }` -> `{ thread, messages, findings }`.
- `research.startResearchTask` (mutation) input `{ question, scope, source?, sourceLabel?, allowUnsourced?, threadId?, sourceMode? }` -> `{ taskId, threadId, stage:"queued" }`. kind="ask".
- `research.processResearchTask` (mutation) input `{ taskId }` -> `{ taskId, threadId, answer, model, findings, stage, sourceStatus }`. Runs read+AI+extract; idempotent (returns current state if not queued). Reads task.kind so it handles review too.
- Stage enum: queued -> reading_source -> asking_ai -> extracting -> done | needs_source_fix | failed.
- `research.reviewCatalogueSource` (mutation, adminProcedure) STILL BLOCKING. Input `{ catalogue: mmf|bank|cbk|market_asset, source (url|text|pdf|image union), sourceLabel? }`. Creates review thread+task (kind="review", stage="queued", allowUnsourced:false) THEN calls executeResearchTask directly.

### KEY INSIGHT: processResearchTask already handles kind="review". Add `startReviewTask` that persists the review task at stage "queued" (persist half of reviewCatalogueSource) returning { taskId, threadId, stage:"queued" }. Client then polls getTask + calls processResearchTask like Ask AI. round89 section G test asserts client contains `research.reviewCatalogueSource` — update that test.

## Client migration plan
- Fire-and-poll: after start, call processResearchTask.mutate() (server does work in its own request) and separately poll getTask every ~1.2s until stage terminal {done,needs_source_fix,failed}. UI driven by poll, not blocked on the process call.
- OpeningPanel + Conversation follow-up in AskAI.tsx: replace ask.useMutation with start->process->poll. Preserve threadId, sourceMode, allowUnsourced, source reuse.
- CatalogueSourceReview ReviewDialog: replace reviewCatalogueSource.useMutation with startReviewTask->process->poll. Keep strict needs_source_fix / zero-findings branch + listFindings({taskId}) refresh.

## Stage label map (UI)
queued="Queued", reading_source="Reading source…", asking_ai="Asking AI…", extracting="Extracting findings…", done, needs_source_fix, failed.

## Other items
- #2 AllApprovedInstruments.tsx: bank deep-link identity must be bank:<id> — use r.targetRef (federated) not r.name. Verify federated row exposes targetRef.
- #3 bank holding backfill: add manager `bankHoldings.linkToReference` mutation (set bankInstrumentId where null, match name+type+tenor) + UI action on BankHoldings. Only null ones.
- #4 MMF Market: verify add-secondary deep-link prefill, record-deposit drawer, not-held hint; add tests.
- #6 Explore.tsx legacy: check routing; ensure Research/All Approved never routes to Explore; retire/mark legacy. Add guard test.
- #7 Ledger explainer (aiExplain.ledgerMonth): split CBK vs bank cash (Ledger.tsx currently merges cbkCashIn+bankCashIn — WRONG). Add bank + T-bill tenor end balances; update prompt wording.
- #8 keep aiExplain queries read-only.
- #9 tests per spec lines 149-157.

## Delivery
Full codebase ZIP INCLUDING node_modules + DB dump + exact frontend UI (client/ source). node_modules huge -> large zip; provide restore notes.
