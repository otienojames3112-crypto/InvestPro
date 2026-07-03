# Round 95 — Governed AI-assisted automation (findings/explanations only; NO new pages)

## Guiding rule
Everything routes through the governed Research Desk pipeline. AI never writes data.
- Catalogue reviews -> findings only (already exists: `research.reviewCatalogueSource`).
- Reconciliation / Ledger / Dashboard -> READ-ONLY plain-language EXPLANATIONS (no writes at all).
- Rate Settings / Source Registry -> reuse `reviewCatalogueSource` to DRAFT updates (no save).
- Plan Fit / explanations are NOT recommendations.

## Phase 2 DONE
Strengthened `server/aiResearchService.ts::catalogueReviewInstruction` for mmf/bank/cbk/market
to enumerate every requested change type. Buttons already mounted on all 4 catalogue pages
(BankInstruments, CbkSecuritiesReference, MarketAssetsReference, MmfFunds via CatalogueSourceReviewButton).

## Phase 3 — READ-ONLY explanations (server/routers.ts)
Add a NEW router group `aiExplain: router({ ... })` (protected; dashboard/status gated to manager where noted).
Each procedure: gather the SAME page-facing data via existing helpers, build a compact factual
prompt, call `invokeLLM` (import from `./_core/llm`), return `{ answer, model }`. NO db writes.
Model call shape (see aiResearchService.ts ~734): `invokeLLM({ messages:[{role:'system',...},{role:'user',...}], temperature })`.
`res.choices[0].message.content` -> use a `contentToText` style unwrap (aiResearchService has `contentToText`).

Procedures:
1. `aiExplain.reconciliationMismatch` (protectedProcedure, input {portfolioId})
   - Load `reconciliation` query data (reuse the same loader the `reconciliation` proc uses ~line 3727).
   - ONLY meaningful when red/mismatch; server can still answer but the UI only shows the button when NOT reconciled/insync=false.
   - Prompt: read the mismatch rows/sections, explain likely cause in plain language, suggest where to look. NEVER edit.
2. `aiExplain.ledgerMonth` (protectedProcedure, input {portfolioId, monthNumber})
   - Load ledger entries via getLedgerEntries; pick the row for monthNumber (+ neighbors for context).
   - Explain: what came in (contribution/cbkCashIn), what matured, what was swept (mmfToDhow/mainAction), what stayed liquid (mmfEnd), tax/interest impact.
3. `aiExplain.dashboardStatus` (protectedProcedure, MANAGER only -> check ctx.user.role === 'admin', else FORBIDDEN; input {portfolioId})
   - Summarize on/off track, missing contributions, concentration warning, upcoming maturity, stale rates.
   - Reuse projection + actuals summary + rate staleness data already computed for the dashboard.

Ledger entry fields (from ledger.list -> getLedgerEntries): monthNumber, entryDate, contribution,
cbkCashIn, mmfToDhow, mainAction, mmfEndBalance, tbillEndBalance, ifbEndBalance, fxdEndBalance,
totalEndBalance, isActual.

## Phase 4 — Rate Settings / Source Registry "Review source with AI"
- Source Registry lives in ResearchDesk.tsx (trpc.researchPipeline.listSources / upsertSource / markSourceReviewed).
- Rate Settings page: find it (likely client/src/pages/RateSettings.tsx or settings). A row has a source URL.
- Add a button that opens the SAME CatalogueSourceReview dialog (reviewCatalogueSource) seeded with the row's
  source URL + the relevant catalogue, so AI parses the source and DRAFTS updates (findings), never saves.
- Reuse CatalogueSourceReviewButton / ReviewDialog where possible (may need a variant that accepts an initial source URL + catalogue).

## Phase 5 — Tests (server/round95AiAutomation.test.ts, static + shape)
- AI explanation procedures do NOT write data: assert the procedures contain no enqueue/insert/update/db-write calls (static scan of the aiExplain block) and are queries/read-only.
- Catalogue review creates findings only: reviewCatalogueSource returns findings, never calls a catalogue write (already true; add guard).
- Reconciliation explanation does not change reconciliation: aiExplain.reconciliationMismatch does not call reconcile/enqueue.
- AI source update requires approval: the Rate/Source review path uses reviewCatalogueSource -> draftFromFinding -> pending queue -> approval (no direct catalogue write).
- Run full suite + tsc.

## Client wiring
- Reconciliation.tsx: add "Explain mismatch with AI" button, only when a section is red/out-of-sync. Dialog shows Streamdown answer. Manager-gated? user said "when reconciliation is red" (not manager-only) — keep for the portfolio owner; safe as read-only.
- Ledger.tsx: add "Explain this month" per row (icon button) -> dialog with the month's explanation.
- Dashboard.tsx: add "Explain my status" for MANAGER mode only (useAuth().user?.role === 'admin').
- Reuse a small shared AiExplainDialog component (new component file client/src/components/AiExplainDialog.tsx — NOT a page) to avoid repetition.

## Delivery (Phase 6)
- Full codebase ZIP: zip the project dir excluding node_modules/.git/dist/.manus-logs.
- DB dump: use webdev_execute_sql to introspect, OR mysqldump via DATABASE_URL. Prefer a SQL dump of schema+data. Check DATABASE_URL env in server/_core/env.ts. Likely TiDB/MySQL -> use `mysqldump`. If not available, script a dump via node/mysql2. Provide as attachment via manus-upload-file? For webdev, deliver files from sandbox. Use manus-upload-file to get URLs OR attach local paths in message.


## Manager-mode gating (decided)
userMode ("manager"/"simple") is a CLIENT localStorage preference, NOT a server role.
So aiExplain.dashboardStatus is a normal protectedProcedure scoped to the owner's own
portfolio (requirePortfolio). The "manager only" requirement is enforced in the UI: the
"Explain my status" button only renders when isManager (userMode==="manager").
The procedure itself is read-only regardless.

## aiExplain router — CLIENT-DRIVEN FACTS design (decided)
Each page already computes exactly the numbers it shows. Each aiExplain procedure accepts a
compact, page-computed facts object as INPUT (zod-validated), serialises it, calls
aiExplainService.explain(). NO db reads/writes beyond requirePortfolio (ownership guard).
All three are protectedProcedure ... .query(...) so they cannot mutate.
- reconciliationMismatch(input:{portfolioId, sections[], subChecks[]})
- ledgerMonth(input:{portfolioId, month{...ledger columns}})
- dashboardStatus(input:{portfolioId, status{onTrack,paceStatus,shortfall,plannedThis,actualThis,nextMaturity,concentration[],ratesStale,ratesLabel,netWorth,target,projectedFinal}})


## Round 95 — test-writing facts (verified from source)
Exports to import in tests:
- server/aiExplainService.ts: `ExplainKind`, `buildExplainPrompt(kind,title,facts)`, `explain(args)` — READ-ONLY, imports only invokeLLM + contentToText, no db import. Guardrail text: "you do NOT recommend buying/selling/switching anything", "You cannot change any data. Nothing you write is saved or executed."
- server/aiResearchService.ts: `catalogueReviewInstruction(catalogue)`, `buildCatalogueReviewQuestion(catalogue, rows)`.
  - buildCatalogueReviewQuestion closing contains: "never a catalogue write, never a recommendation."
  - mmf keywords: "NEW funds", "management-FEE", "MINIMUM-investment", "AUM changes", "STALE rows"
  - bank: "NEW products", "TENOR / notice-period", "NEGOTIABLE-flag"
  - cbk: "91-day, 182-day and 364-day", "issueNumber", "auctionDate", "valueDate", "RE-OPENING"
  - market_asset: "NEW instruments", "PRICE / NAV", "YIELD changes", "TRAILING-RETURN"

Router (server/routers.ts):
- `import { explain as aiExplain } from "./aiExplainService";` (~225)
- aiExplain router ~4489: reconciliationMismatch / ledgerMonth / dashboardStatus ALL `.query(`, each calls requirePortfolio then aiExplain({...}); NO enqueue/insert/update in group.
- reviewCatalogueSource: adminProcedure (8488) `.mutation`, returns findings, no catalogue write.
- draftFromFinding: adminProcedure (8380) -> enqueueResearchUpdate (pending 'drafted'); no publish.
- review: adminProcedure (7800) `.mutation` input.approve -> reviewResearchUpdate = "the ONLY path that turns a proposal into a live figure."

Client: AiExplainDialog.tsx pure presentation, parent owns useQuery; note "It changes nothing and is not investment advice". UpdateRatesPanel.tsx + ResearchDesk.tsx use CatalogueSourceReviewButton label="Review source with AI".

Test file: server/round95AiGovernance.test.ts (static-source guards, no DB/network).
