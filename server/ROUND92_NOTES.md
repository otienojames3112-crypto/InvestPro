# Round 92 — Ask AI durable analyst follow-ups — implementation notes

## Goal (from user)
1. Pass prior STRUCTURED findings into follow-up context (not just prose): previous answer summaries, previous structured findings, prior source labels/URLs, prior manager corrections, and which findings were drafted/dismissed/superseded.
2. Explicit per-follow-up source behavior: Use previous source / Add another source / Ask without source. Banner: new source -> "Using previous context + this new source."; none -> "Using earlier conversation context."
3. Version corrected findings (already largely exists): new corrected finding with old value, corrected value, reason, source, correctedBy, correctedAt; never overwrite; draftable into Review Queue.
4. Tool-aware system prompt: catalogues != holdings; holdings = actual money; AI findings don't affect math until approved; approved catalogue changes affect FUTURE projections only; historical actuals not rewritten; MMF/bank/CBK/market assets have different fields & risks.
5. Tests: (a) follow-up includes prior findings; (b) follow-up can attach new source; (c) follow-up can use previous source; (d) correction creates versioned finding; (e) follow-up does not create duplicate findings unless values changed.

## DONE so far (server engine — aiResearchService.ts)
- Added `PriorFindingContext` interface (instrument, assetClass, figures:Record<string,string>, sourceLabel, sourceUrl, asOf, status new|drafted|dismissed|superseded, correction{field,oldValue,newValue,reason}|null).
- `runResearchQuestion` now accepts `priorFindings?: PriorFindingContext[] | null`.
- Renders `establishedBlock` ("WHAT YOU ALREADY ESTABLISHED IN THIS ENQUIRY ...") into the user message (after grounding, before followUpNote). Filters out dismissed, caps 40.
- Added `suppressDuplicateFindings(candidates, priorFindings)` (EXPORTED) + helpers `instrumentKey`, `normaliseFigures`. Drops a candidate only when same instrument + identical figures bag as a still-valid prior finding; keeps when any value changed / new instrument. Applied as `deduped` before return.

## TODO server (routers.ts)
- Add `buildPriorFindingsContext(threadId)` helper: load `listResearchFindings({ threadId })`, map to PriorFindingContext[]. For correction rows use correctionReason + supersedesId to fill `correction` (need old value: fetch the superseded row's extractedFields for the corrected field). Exclude nothing by status here except pass status through (engine filters dismissed). Prefer to include latest chain but pass all; engine dedupes by values.
- Wire into `executeResearchTask` opts (add priorFindings param) + pass to runResearchQuestion.
- Load + pass in `ask` (line ~7809) and `processResearchTask` (line ~7991). Also startResearchTask persists nothing extra; processResearchTask builds it.
- Explicit follow-up source behavior: `ask`/`startResearchTask` inputs currently have optional `source`. Add an input flag e.g. `sourceMode: "reuse_previous" | "new" | "none"` (optional, default infer). When reuse_previous and no new source, load the most recent prior user turn's source (sourceKind/sourceRef/sourceLabel from researchMessages) and re-resolve it. Banner text is UI-side but server can echo which mode was used in return.

## Correction versioning — ALREADY EXISTS (db.ts correctResearchFinding ~3129-3230; routers.ts correctFinding ~8118-8142)
- Writes new finding row status 'new', supersedesId=original.id, correctedBy, correctedAt, correctionReason; sets original status 'superseded', supersededById=new. Drafts governed pending edit with oldValue/managerValue/field/reason. Good. Just needs tests + surfacing in prior context.

## System prompt (aiResearchService.ts RESEARCH_SYSTEM_PROMPT ~88-113)
- Already has catalogues-vs-holdings + MMF/CBK/bank domain. NEED to add: AI findings don't affect math until approved; approved catalogue changes affect FUTURE projections only; historical actuals not rewritten; market_asset fields/risks; explicit "different fields and risks per catalogue" line.

## ResearchFinding schema fields (schema.ts ~1552-1603)
extractedFields: json Record<string,unknown>; sourceLabel; sourceUrl; sourceAsOf(bigint ms); status; threadId(thread_id); supersededById(superseded_by_id); supersedesId(supersedes_id); correctedBy(corrected_by); correctedAt(corrected_at); correctionReason(correction_reason).

## listResearchFindings(filter{taskId,threadId,status}) returns ResearchFinding[] newest-first (db.ts ~3013).
## researchMessages has sourceKind, sourceRef, sourceLabel per user turn (schema ~1522-1538).

## UI: client/src/pages/AskAI.tsx
- Finding type ~94-117 already has supersededById/supersedesId/correctedBy/correctedAt/correctionReason.
- CorrectFigureDialog + FindingCard ~213-510 create versioned corrections via trpc.research.correctFinding.
- useSourceAttachment ~512-705 = attach optional new source; NO reuse-previous/none mode.
- contextNote ~717-737 + follow-up Conversation composer ~783-920 = where source-choice selector + banners go.

## Tests plan (server/round92FollowupContext.test.ts)
- Pure: suppressDuplicateFindings (same values dropped, changed values kept, new instrument kept, dismissed prior ignored).
- Pure/spy: runResearchQuestion with priorFindings -> establishedBlock appears in invokeLLM messages (spy invokeLLM, assert user content contains instrument + figure + correction).
- Runtime via caller: ask opening (creates finding) -> follow-up in same thread includes prior findings (spy invokeLLM to capture prompt); follow-up with new source; follow-up reuse previous source; correctFinding creates versioned successor (status superseded on original, new row supersedesId + correctionReason + drafted pending).
- Duplicate: follow-up returning identical finding -> deduped to 0; changed value -> kept.

## Commands
- tsc: `npx tsc --noEmit` ; tests: `pnpm test` ; single: `npx vitest run server/round92FollowupContext.test.ts`
- Full suite baseline before R92: 1595 passing.
