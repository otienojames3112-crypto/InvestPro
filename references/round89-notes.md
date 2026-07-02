# Round 89 — Per-catalogue "Review source with AI" (implementation state)

Goal: add a manager-only "Review <X> source with AI" button on each of the 4 reference
catalogue pages (MMF, Bank, CBK, Market Assets). Reuses the EXISTING Research Desk pipeline.
Manager attaches URL/text/PDF/screenshot; AI compares vs current catalogue rows and proposes
create/edit/stale findings. Findings → Review Queue (draftFromFinding) → approval → catalogue
update → Recently Approved audit. NOTHING auto-publishes. New page is NOT allowed.

## Key existing pieces to reuse (verified)
- server/aiResearchService.ts:
  - runResearchQuestion({question, scope, source, sourceLabel, priorMessages}) -> {answer, findings, model}
  - findingsToRows(taskId, drafts, threadId?) -> insert rows
  - RESEARCH_SYSTEM_PROMPT, ResearchScope, ResearchFindingDraft, ReferenceCatalogue
  - normaliseFinding etc. Findings target catalogue derived from assetClass.
- server/db.ts:
  - getMmfFunds() -> active mmf rows (fundName, company, grossYield, ear, managementFee, minInvestment, aumMillions, asOfDate, source)
  - getBankInstruments() -> all bank rows (bankName, instrumentType, minAmount, typicalTenor, indicativeRate, isNegotiable, asOfDate, source)
  - listOpportunities() -> active opps (name, issuer, assetClass, currency, market, yieldPct, yieldKind, lastPrice, trailingReturnPct, tenorYears, maturityDate, dataSource, dataAsOf)
  - enqueueResearchUpdate (always pending), reviewResearchUpdate (approval gate + typed promotion + date-effective history, non-retroactive), describePortfolioImpact
  - createResearchThread/insertResearchMessage/etc (Round 88)
- server/routers.ts research router: ask, draftFromFinding, listFindings, getThread, correctFinding,
  researchPipeline.impactOf (portfolio impact), recentlyApproved.
- Catalogue pages: MmfFunds.tsx (has manager "Add Fund" btn at header ~371), BankInstruments.tsx
  (manager add/correct btn ~267-289), CbkSecuritiesReference.tsx (header ~207, info badge only),
  MarketAssetsReference.tsx (header ~209, info badge only). All use trpc + AppShell + useAuth isManager.

## Plan
- aiResearchService: add pure `buildCatalogueReviewInstruction(catalogue)` + `summariseCatalogueRows(catalogue, rows)`
  (compact snapshot) + a `catalogueReviewQuestion(catalogue, rowSnapshot)` string builder. Pure + testable.
- routers.research.reviewCatalogueSource: adminProcedure; input {catalogue: mmf|bank|cbk|market_asset, source union (same as ask), sourceLabel?}.
  Loads current rows, builds the review question, opens a thread titled "Review <cat> source", runs
  runResearchQuestion with scope=catalogue, persists findings tagged to thread, returns {threadId, answer, findings}.
- Frontend: shared client/src/components/CatalogueSourceReview.tsx dialog (source picker reused from AskAI:
  url/text/pdf/image via opportunities.aiUploadDocument for files). Manager button on each page opens it.
  On result: show proposed findings with "Send to Review Queue" (calls research.draftFromFinding) + link to Research Desk.
- Post-approval impact: reuse impactOf in ResearchDesk ApproveDialog (already present). Ensure copy says
  "affects X active portfolios; future projections update from effective date; historical actuals unchanged".
  Add primaryMmf count if needed.
- Tests: round89 test file — reviewCatalogueSource proposes not publishes; approval updates MMF + rate history;
  bank proposes; CBK extracts 91/182/364; unapproved updates don't affect Dashboard/Ledger/Accrual/Tax/Recon.

## Invariants
- Findings/threads NEVER write a catalogue; only approving a pending update does.
- No auto-publish. Everything admin-only. Historical actuals never rewritten (date-effective history only).

## PROGRESS (backend DONE, tsc clean)
- aiResearchService.ts: added CatalogueRowSnapshot type + catalogueReviewInstruction(cat) +
  summariseCatalogueRows(cat, rows) + buildCatalogueReviewQuestion(cat, rows). All PURE, exported.
- routers.ts research router: added `reviewCatalogueSource` adminProcedure after `correctFinding`.
  Input: { catalogue: "mmf"|"bank"|"cbk"|"market_asset", source: {kind url|text|pdf|image ...}, sourceLabel? }.
  Loads current rows (getMmfFunds / getBankInstruments / listOpportunities filtered by gov vs market classes),
  builds question, opens review thread + task, persists user msg, runs runResearchQuestion (scope=catalogue),
  findingsToRows+insertResearchFindings, completeResearchTask, persists assistant msg.
  Returns { taskId, threadId, catalogue, answer, model, findings }.
  Import added to routers: buildCatalogueReviewQuestion + type CatalogueRowSnapshot from aiResearchService.

## FRONTEND CONTRACT (next)
- Build shared client/src/components/CatalogueSourceReview.tsx dialog:
  props { open, onOpenChange, catalogue: "mmf"|"bank"|"cbk"|"market_asset", label: string }.
  Source picker tabs: URL / Paste text / Upload PDF / Upload screenshot (reuse opportunities.aiUploadDocument
  mutation for file→fileKey, same as AskAI.tsx around line 273). Calls trpc.research.reviewCatalogueSource.
  On result: render answer briefing + findings list; each finding has "Send to Review Queue" btn calling
  trpc.research.draftFromFinding ({ findingId, changeKind:"create"|"edit", targetRef?, name?, assetClass?, figures? }).
  Provide link to Research Desk. Findings never auto-draft.
- Manager-only button on each of 4 pages:
  * MmfFunds.tsx header ~371 (next to "Add Fund"): "Review MMF source with AI"
  * BankInstruments.tsx header ~267-289: "Review bank source with AI"
  * CbkSecuritiesReference.tsx header ~207-229: "Review CBK source with AI"
  * MarketAssetsReference.tsx header ~209-231: "Review market source with AI"
  Gate on isManager (user?.role==="admin"). Use lucide Sparkles/Bot icon + Button size="sm" variant outline.
- draftFromFinding for CBK/market: assetClass should map so promotion target = cbk/market_asset. For MMF
  set assetClass cash_mmf, bank -> bank_deposit. The finding already carries assetClass from AI; UI can pass
  changeKind default "create" and let manager pick edit + targetRef when it matches an existing row name.

## TESTS TODO (phase 5) — server/round89CatalogueReview.test.ts
- buildCatalogueReviewQuestion/summariseCatalogueRows pure guards (mmf keys, cbk 91/182/364 instruction, empty snapshot).
- reviewCatalogueSource proposes-not-publishes (mock invokeLLM -> findings; assert no mmf/bank/opp row written).
- approval path: enqueueResearchUpdate(mmf create) -> reviewResearchUpdate(approve, managerValue) updates mmf_funds + appends mmf rate history (mmfRateHistory) — reuse existing round83 patterns.
- bank source review proposes update (finding -> draftFromFinding -> pending).
- CBK extraction: instruction contains 91/182/364 + issueNumber/auctionDate/valueDate.
- unapproved updates do NOT affect Dashboard/Ledger/Accrual/Tax/Reconciliation (pending row present, catalogue query unchanged).


## PROGRESS 2 — FRONTEND DONE (tsc clean)
- Exported from AskAI.tsx: `Finding` type, `FindingCard`, `useSourceAttachment`, `AskSource`.
- New component client/src/components/CatalogueSourceReview.tsx:
  `CatalogueSourceReviewButton({ catalogue, isManager, size? })` renders manager-only outline button;
  opens ReviewDialog which uses useSourceAttachment + calls trpc.research.reviewCatalogueSource,
  then lists trpc.research.listFindings({taskId}) rendered via FindingCard (Draft into review queue → draftFromFinding).
  Includes ShieldCheck banner "nothing changes a catalogue / approvals never rewrite past actuals" + link to /research.
- Buttons wired into all 4 pages (imports added):
  MmfFunds.tsx (next to Add Fund), BankInstruments.tsx (next to Add/correct, size=default),
  CbkSecuritiesReference.tsx (beside Info-only badge), MarketAssetsReference.tsx (beside Info-only badge).
- tsc: 0 errors.
- ROUTING: catalogue pages are NOT top-level routes. They are tabs under /research (ResearchArea/TabbedArea),
  reachable at /research?tab=reference-catalogues&cat=<param>. Screenshotting /mmf or /bank gives 404 (expected).
  So visual verification requires signed-in admin at /research; behavior is covered by tests instead.

## PHASE 4 (post-approval impact) — reuse existing:
  ResearchDesk.tsx ApproveDialog already calls trpc.researchPipeline.impactOf.useQuery and shows the
  "affects X active portfolios / future projections update from effective date / historical actuals unchanged"
  copy (per earlier audit). Verify copy present; only extend if missing. Likely NO new work needed — just confirm.

## PHASE 5 tests file: server/round89CatalogueReview.test.ts (see earlier TESTS TODO list).
NEXT AFTER TESTS: advance to phase 6, zip: cd /home/ubuntu && rm -f kes5m-tracker-source.zip && zip -r ... excluding node_modules/.git/dist/.manus-logs.


## PHASE 5 TEST PLAN — verified facts (write server/round89CatalogueReview.test.ts)

### Procedure under test: research.reviewCatalogueSource (routers.ts ~7746)
- input: { catalogue: "mmf"|"bank"|"cbk"|"market_asset", source: discriminatedUnion(kind url/text/pdf/image), sourceLabel? }
- adminProcedure (admin-only).
- Flow: loads current rows snapshot (mmf: getMmfFunds; bank: getBankInstruments; cbk/market: listOpportunities filtered by asset class gov_discount/gov_coupon vs equity/reit/offshore_fund/alt) → buildCatalogueReviewQuestion → createResearchThread + createResearchTask(status running, threadId) → insertResearchMessage(user turn w/ source) → runResearchQuestion({question,scope,source,sourceLabel}) → findingsToRows(taskId,findings,threadId) → insertResearchFindings → completeResearchTask → insertResearchMessage(assistant) → returns { taskId, threadId, catalogue, answer, model, findings }.
- On engine error: completeResearchTask(error) then throws TRPCError BAD_REQUEST "The review engine could not read this source:".

### Pure helpers to test (aiResearchService.ts ~329-404), exported:
- catalogueReviewInstruction(catalogue) — CBK string contains "91-day, 182-day and 364-day bills are SEPARATE", keys tenorDays (91/182/364), issueNumber, auctionDate, valueDate, yieldPct, prevAvgRate. MMF: ear, grossYield ("never convert one into the other"), managementFee, minInvestment, aumMillions. bank: indicativeRate, minAmount, typicalTenor, isNegotiable, liquidity in rawExcerpt, WHT 15% gross warning. market_asset: lastPrice, yieldPct, yieldKind, trailingReturnPct, expenseRatioPct, "PAST performance".
- summariseCatalogueRows(catalogue, rows) — empty → "(The catalogue is currently EMPTY". mmf line has EAR/gross/fee/min/AUM. caps at 200 + "… and N more".
- buildCatalogueReviewQuestion(catalogue, rows) — includes instruction + "CURRENT CATALOGUE ROWS" + snapshot + "one structured FINDING per proposed change".

### Test patterns available:
- LLM mock: vi.spyOn(await import("./_core/llm"),"invokeLLM").mockResolvedValue({model,choices:[{message:{content: JSON.stringify({answer,findings})}}]}). findings item shape: {instrumentName,issuer,assetClass,currency,figures:[{key,value}],sourceLabel,sourceUrl,sourceAsOf,confidence,warnings,rawExcerpt}.
- Caller/DB integration: appRouter.createCaller(ctxFor("admin"|"user")); ctxFor builds TrpcContext user w/ role (see opportunityMaintainer.test.ts). NOT_ADMIN_ERR_MSG from ../shared/const. DB helpers importable from ./db (getMmfFunds, getResearchUpdate, getMmfFundBy... etc).
- describePortfolioImpact (shared/researchPipeline.ts ~625): primary MMF → affectsProjection true "changes FUTURE projected accrual...does not restate your current balance"; bank/cbk/market referenceOnly true (informs NEXT/FUTURE, does not change existing). researchGovernance.round83.test.ts lines 289-314 already assert this.
- rateEffectiveDate.test.ts: ratesOnDate/simulateAccrualDated prove approved rate change is forward-only from effectiveDate (non-retroactive). Approval→rate history is date-effective.

### Test cases to write (Round 89):
A. reviewCatalogueSource is admin-only (user role rejected NOT_ADMIN_ERR_MSG).
B. MMF review (LLM-mocked, caller as admin) returns findings with status "new", proposes NOT publishes: getMmfFunds count unchanged before/after; findings[].status === "new"; no mmf_funds write. (Use a mock; may need to mock getMmfFunds/insertResearchFindings or just assert the finding status + that no live mmf row with the proposed name exists.)
C. Approval of an MMF pending update updates MMF Market + rate history — reuse existing enqueue→review path (may lean on researchGovernance round83 / existing coverage; assert via describePortfolioImpact + rate-history presence). Prefer a pure/static assertion referencing existing behavior to avoid DB mutation churn.
D. Bank review proposes (LLM mock) → finding status new, targetCatalogue bank.
E. CBK review extracts 91/182/364 — mock LLM returning three T-bill findings (tenorDays 91/182/364) → three findings, names by tenor; assert catalogueReviewInstruction("cbk") demands per-tenor separate findings (static) AND runtime three findings pass through.
F. Unapproved updates do not affect Dashboard/Ledger/Accrual/Tax/Reconciliation — pending research_update never reaches catalogue (getMmfFundByName/live row null while pending); rely on the invariant that projection reads catalogues, and a pending update is status "pending". Assert enqueue leaves status pending + live catalogue untouched (mirror opportunityMaintainer test), and that reviewCatalogueSource output findings are status "new"/not drafted (nothing enqueued until draftFromFinding).
G. Static guard: CatalogueSourceReview.tsx routes proposals to review queue (draftFromFinding), shows "Nothing here changes a catalogue" + approvals never rewrite past actuals; buttons on all 4 pages import CatalogueSourceReviewButton.

NEXT: write test file, run vitest (new file first, then full suite), tsc, screenshot skip (admin-gated), update todo, checkpoint, advance to phase 6, zip.
