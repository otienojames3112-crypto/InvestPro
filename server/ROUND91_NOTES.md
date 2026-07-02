# Round 91 — Robust manager-grade AI workflows — implementation notes

## Goal (from user pasted_content_26.txt)
Ask AI + Review source with AI must be robust. Split source-read errors from AI-engine
errors; Review must NOT propose changes unless the source was actually readable; move
long AI work to a pollable task-based flow; show source status in UI; preserve source
provenance; add tests.

## Runtime constraint
Autoscale serverless, 180s request timeout, min-instances=0, NO always-on worker.
=> "task-based flow" = start returns taskId immediately (status queued), a separate
`processResearchTask` mutation does read+LLM+parse+save and advances status; client polls
getTask/getThread/listFindings. This is the resumable pattern that fits.

## DONE so far
- `server/aiResearchService.ts`: added `SourceKind`, `SourceReadResult` type, and
  `readSource(source, {label?, thinIsFatal?})` helper (BEFORE the LLM). It classifies:
  url_unreadable | thin_fetch | pdf_unreadable | image_unreadable | storage_error.
  - text: pass-through; empty => ok:false thin_fetch.
  - url: fetchDocumentText; on throw => url_unreadable; isThinFetch => thin warning
    (ok:true thin:true) unless thinIsFatal => thin_fetch fail.
  - pdf/image: transcribeSourceToText; throw/empty => pdf/image_unreadable.
  - ok:true carries {kind,text,label,url?,warnings[],thin}.
  - `PASTE_OR_UPLOAD_HINT = "Paste the text, upload a PDF, or upload a screenshot."`

## KEY ANCHORS
- `server/aiResearchService.ts`
  - `ResearchSource` union: url{url}, text{text}, pdf{fileUrl}, image{imageUrl}  (~line 502)
  - `readSource(...)` ~line 556; `transcribeSourceToText(...)` ~line 662
  - `runResearchQuestion(args)` ~line 708 — currently reads source ITSELF (fetch/transcribe)
    at lines ~745-777 and pushes groundingWarnings; RETURNS {answer, findings, model}.
    Provenance fallback stamping ~lines 802-858; groundingWarnings appended to findings.
  - `fetchDocumentText(url,maxChars=40000)` + `isThinFetch` + `THIN_FETCH_MIN_CHARS=600`
    live in `server/aiIntakeService.ts` (imported into aiResearchService).
  - `missingFieldsForFinding(cat, figures, envelope?)`, `applyCbkRuleFill`, `normaliseFinding`,
    `parseResearchResponse`, `buildCatalogueReviewQuestion`, `summariseCatalogueRows`,
    `catalogueReviewInstruction` all exported here.
- `server/routers.ts` — `research` router (~line 7429):
  - listTasks, getTask (returns {task,findings}), listFindings, listThreads,
    getThread (returns {thread,messages,findings}), setThreadArchived, newFindingsCount.
  - `ask` adminProcedure ~line 7502: creates thread+task(status "running"),
    persists user msg, resolves source (storageGetSignedUrl for pdf/image), calls
    runResearchQuestion, findingsToRows+insertResearchFindings, completeResearchTask,
    inserts assistant msg, returns {taskId,threadId,answer,model,findings}.
    On catch: completeResearchTask(error) + throws BAD_REQUEST "The research engine could not complete this enquiry: ...".
  - `draftFromFinding` ~line 7640 (comment "Still NOT a catalogue write"; enqueueResearchUpdate).
  - `reviewCatalogueSource` adminProcedure ~line 7748: builds snapshot per catalogue,
    buildCatalogueReviewQuestion, creates thread+task, persists user msg, resolves source,
    calls runResearchQuestion, inserts findings, returns {taskId,threadId,catalogue,answer,model,findings}.
    On catch: "The review engine could not read this source: ...".
- DB helpers (server/db.ts): createResearchTask({...status}), completeResearchTask(taskId,{answerSummary,aiModel,findingCount}|{error}),
  createResearchThread, getResearchThread, listResearchMessages, insertResearchMessage,
  touchResearchThread, getResearchTask, listResearchTasks, listResearchFindings,
  insertResearchFindings, findingsToRows (in routers or db?), countNewFindings.
- research_task status enum: currently "running" / done / error (VERIFY in drizzle/schema.ts).
  Need statuses: queued, reading_source, asking_ai, extracting, done, needs_source_fix, failed.
  Plan: extend enum OR store a separate `stage` column. CHECK schema before migrating.

## PLAN state machine (task.status or task.stage)
queued -> reading_source -> asking_ai -> extracting -> done
                         \-> needs_source_fix (readSource ok:false)
   any -> failed (LLM/engine error)

## UI files
- client/src/pages/AskAI.tsx (FindingCard lives here; banner copy; source expander)
- client/src/components/CatalogueSourceReview.tsx (CatalogueSourceReviewButton + dialog)
- Need a shared SourceStatus panel component + task-stage display.

## Tests to add (round91*.test.ts)
a) Ask AI unreadable URL => source warning but still answers if allowed (allowUnsourced).
b) Review unreadable URL => no findings + source-fix message.
c) Review never falls back to general knowledge (source required).
d) long task resumable/pollable via taskId (start returns id; process advances; poll).
e) PDF/image source status visible.
f) findings preserve provenance (label/url/kind/checkedAt/sourceAsOf/transcription warning).

## UPDATE — server IMPLEMENTED + tsc CLEAN (post-compaction checkpoint)
- SourceReadResult + readSource DONE (reasons: url_unreadable|thin_fetch|pdf_unreadable|image_unreadable|storage_error).
- runResearchQuestion now accepts `preRead?: SourceReadResult|null`: grounds ONLY in preRead.text when ok; when failed+passed (ask+allowUnsourced) stamps "This answer was NOT grounded in the attached source (...)". Findings carry sourceKind + checkedAt; findingsToRows persists finding_source_kind.
- schema.ts: research_tasks widened (status adds queued/needs_source_fix/failed; new cols stage, kind, reviewCatalogue, sourceKind, sourceRef(text), sourceLabel, allowUnsourced, sourceStatus(json)); research_findings adds finding_source_kind. DB MIGRATED via webdev_execute_sql (drizzle-kit generate stalls on unrelated account_status rename — write SQL by hand).
- db.ts: createResearchTask(InsertResearchTask supports new fields); completeResearchTask({...,status?,stage?,sourceStatus?}); setResearchTaskStage(id,stage,{sourceStatus?}).
- routers.ts: shared helpers ABOVE zod schemas — PendingResearchSource, resolveResearchSource, catalogueSnapshot, executeResearchTask(opts) with ExecuteResearchTaskResult {taskId,threadId,answer,model,findings,stage,sourceStatus}.
  executeResearchTask stages: reading_source → review-fail=>needs_source_fix(0 findings,no LLM); ask-fail&&!allowUnsourced=>needs_source_fix; ask-fail&&allowUnsourced=>proceed with failed preRead → asking_ai → extracting → done | failed(engine).
  - `ask` delegates (added `allowUnsourced` bool input). Returns {...,stage,sourceStatus}.
  - NEW `startResearchTask` (returns taskId, stage queued) + `processResearchTask({taskId})`.
  - `reviewCatalogueSource` delegates kind:"review". Returns {...,stage,sourceStatus}.
- `npx tsc --noEmit` CLEAN.

## NEXT: UI (phase 5)
- CatalogueSourceReview.tsx (already re-read): ReviewDialog handle data.stage==="needs_source_fix" → show sourceStatus.message + retryHint, NO findings panel, keep attach open. When ok, show source chip (kind + chars + thin/transcription warning).
- AskAI.tsx: source-status panel from sourceStatus; stage label; allowUnsourced opt-in; needs_source_fix message+retryHint.
Then phase 6 (provenance already mostly done — verify), phase 7 tests + suite + tsc + checkpoint.
