# Round 88 — Threaded Ask AI (implementation state)

Goal: Turn Ask AI (Research Desk) from one-shot into a threaded manager research assistant:
enquiry threads, follow-ups with prior context, per-follow-up source, versioned finding
corrections drafted to review queue with audit, domain-aware system prompt, tests.

## DONE
- Migration 0016_round88_threaded_research.sql applied + verified (research_threads,
  research_messages; findings +threadId +supersededById +supersedesId +correctedBy/At +correctionReason;
  research_tasks +threadId). All in drizzle/schema.ts as `researchThreads`, `researchMessages`,
  plus finding versioning cols. Types: ResearchThread/InsertResearchThread, ResearchMessage/InsertResearchMessage.
- server/aiResearchService.ts:
  - RESEARCH_SYSTEM_PROMPT upgraded: tool-context sentence at intro (line ~80), KENYAN-MARKET DOMAIN
    CONTEXT + HOLDINGS-vs-REFERENCE INVARIANT blocks after the "verbatim string" hard rule.
  - runResearchQuestion: added `priorMessages` arg; folds last 10 turns into invokeLLM messages + followUpNote.
  - findingsToRows(taskId, drafts, threadId?) now tags threadId.
- server/db.ts:
  - imports researchThreads, researchMessages + types.
  - enqueueResearchUpdate now persists findingId/field/oldValue/managerValue.
  - PendingUpdateInput (shared/researchPipeline.ts) gained oldValue + managerValue.
  - listResearchFindings: +threadId filter, status adds "superseded".
  - updateFindingStatus: status adds "superseded".
  - NEW helpers: createResearchThread, getResearchThread, listResearchThreads, touchResearchThread,
    insertResearchMessage, listResearchMessages, correctResearchFinding (versioned finding + drafts
    governed pending edit via enqueueResearchUpdate + closes loop to drafted).
- server/routers.ts research router:
  - imports the 7 new helpers.
  - ask: thread-aware (threadId input; create/continue thread; persists user msg pre-answer +
    assistant msg post-answer; passes priorMessages; tags findings threadId; returns threadId).
  - listFindings: +threadId, +"superseded" status.
  - NEW: listThreads, getThread, setThreadArchived, correctFinding.
- tsc clean after all backend changes.

## TODO (current phase 5 = UI)
- AskAI.tsx (client/src/pages/AskAI.tsx, 703 lines): currently one-shot EnquiryPanel + result +
  HistoryPanel. Need:
  - Threaded conversation view: after first ask, keep threadId; show transcript turns; "Ask a
    follow-up" box that calls research.ask with threadId (+ optional per-follow-up source, reuse
    existing source attach UI).
  - Findings grouped for the whole thread (research.getThread returns messages+findings).
  - FindingCard: add "Correct a figure" action -> research.correctFinding (field/newValue/reason);
    show versioned diff (superseded badge, supersedes/supersededById).
  - HistoryPanel -> thread list via research.listThreads / getThread (can keep listTasks too).
- Phase 6: tests in server/*.test.ts (prompt context assembly, per-follow-up source, correctFinding
  versioning+audit+drafted pending, factual-sort-not-advice). Run pnpm test + tsc. Verify UI. Checkpoint.
- Phase 7: zip full codebase + deliver.

## Key invariants to preserve
- Findings/threads NEVER write a catalogue; only approving a pending update does.
- correctFinding does NOT mutate original; versions it (old->superseded, new row) + drafts governed edit.
- Prompt allows factual sort/compare; bans advice/recommendation; holdings are off-limits.
