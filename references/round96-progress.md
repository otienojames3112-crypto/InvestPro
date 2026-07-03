# Round 96 progress (internal working notes)

## Goal
Audit fixes + full migration bundle (codebase ZIP incl. node_modules + DB dump + built frontend).

## DONE (Phase 1 + 2)
- server/routers.ts: added `startReviewTask` adminProcedure (after startResearchTask ~line 8328).
  - Persists a QUEUED review task (kind:"review", reviewCatalogue set, prompt = label only,
    sourceKind/sourceRef/sourceLabel, opens a thread + user message). Returns {taskId, threadId, stage:"queued"}.
- server/routers.ts processResearchTask: for kind==="review" && task.reviewCatalogue, rebuild the FULL
  question via `buildCatalogueReviewQuestion(cat, await catalogueSnapshot(cat))` at process time (fresh rows).
  Ask tasks pass task.prompt verbatim.
- client/src/pages/AskAI.tsx: added shared pollable-task primitives (exported):
  - `TaskStage`, `STAGE_LABELS`, `isActiveStage`, `TaskStageProgress`, `ResearchTaskResult`, `useResearchTaskPoller()`.
  - Hook: run(start) -> start() creates queued task, calls processResearchTask.mutateAsync, polls getTask every 1.4s
    for live stage; `done` (process result) is authoritative for final result.
  - OpeningPanel + Conversation follow-up migrated from blocking `research.ask` to
    `startResearchTask` + poller. Live stage row + staged button labels added. sourceMode preserved.
- client/src/components/CatalogueSourceReview.tsx: ReviewDialog migrated from blocking
  `reviewCatalogueSource` to `startReviewTask` + poller. Imports useResearchTaskPoller/TaskStageProgress/STAGE_LABELS.
- tsc clean. Old blocking `research.ask` and `research.reviewCatalogueSource` procedures KEPT server-side
  (backward-compat + existing tests round91/round92/round89 rely on them).

## TODO remaining
- Phase 3 DONE (server + one client): AllApprovedInstruments.catalogueHref now uses r.targetRef (bank -> bank:<id>). tsc clean.
  Server: added bankHoldings.linkToInstrument mutation (validates via resolveBankRef, audit-logged, null clears). tsc clean.
  Phase 3 UI DONE: BankHoldings.tsx has manager-only "Link to reference product" dialog + Linked/Not-linked badge per holding.
  Verified in preview at /holdings?tab=bank. tsc clean.
- Phase 4 PROGRESS:
  * MMF Market actions VERIFIED (no change needed): "Add as MMF account" -> /mmf?addSecondary=1&fundId= opens
    Add-secondary dialog preseeded (MmfAccounts.tsx L120-132); "Record a deposit" -> openDrawer({kind:mmf,mmfFundId,fundName});
    DepositDrawer shows amber not-held hint (L667-672) when fund isn't held, routes to matching account when held.
  * Ledger AI explainer split DONE: routers.ts ledgerMonth input now has bankCashIn + bankEndBalance +
    secondaryMmfEndBalance + tbill91/182/364EndBalance (all optional); facts now emit SEPARATE
    "Cash released from CBK securities" and "Cash released from maturing bank instruments" lines +
    per-tenor T-bill breakdown + secondary MMF + bank deposits. Ledger.tsx wires all fields from projection row
    (no longer merges cbk+bank). tsc clean.
  * aiExplain read-only CONFIRMED: aiExplainService.ts has explicit read-only guardrails; ledgerMonth is a
    protectedProcedure QUERY (not mutation), does no DB writes. round95AiGovernance.test.ts already asserts this.
  STILL TODO Phase 4: retire Explore.tsx legacy (mark legacy + confirm not reachable via App.tsx route).
- Phase 5: tests — round89CatalogueReview.test.ts G section asserts `reviewCatalogueSource` in
  CatalogueSourceReview.tsx (line ~373-378); UPDATE to `startReviewTask`. Add new Round 96 tests:
  Ask AI task-flow non-blocking; review pollable; unreadable URL -> needs_source_fix + 0 findings;
  All Approved bank link bank:<id>; old bank holding linkable; ledger explainer split. Full suite + tsc.
- Phase 6: build client (pnpm build), ZIP full codebase INCL node_modules + .git excluded? include node_modules per user.
  DB dump via mysqldump --ssl-mode=REQUIRED (40 tables). Deliver.

## Prior delivery bundle names (Round 95)
- kes5m-tracker-codebase.zip (node_modules/.git excluded then)
- kes5m-tracker-db-dump.sql (TiDB, mysqldump --ssl-mode=REQUIRED, 40 tables)
NOTE: THIS round user explicitly wants node_modules INCLUDED + built frontend.
