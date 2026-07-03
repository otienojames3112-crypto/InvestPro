# Round 94 — Retire "screener / score" user-facing wording (Plan Fit language)

## Required mappings
- "screener" -> "approved reference universe" / "approved instruments table"
- "score" (noun, user-facing) -> "Plan Fit diagnostic"
- "scored" -> "included in Plan Fit" / "has Plan Fit"
- Never call Plan Fit a recommendation.
- Internal variable names (score, fit.score, netYieldPerPct, sortKey) may STAY.

## Verbatim copy required
- ResearchArea hint (client/src/pages/ResearchArea.tsx line ~113) ->
  "Approved reference universe across every approved catalogue row."
- AllApprovedInstruments intro (DONE) ->
  "All instruments shown here have been approved into one of the reference catalogues. Reference data does not affect portfolio math until a holding is recorded."

## Files + status
### AllApprovedInstruments.tsx — user-facing copy DONE
- intro paragraph replaced (DONE)
- archived-rows tooltip "never scored (no Plan Fit)" -> "never included in Plan Fit" (DONE)
- weights note "Net yield is scored at..." -> "Net yield contributes ... to the Plan Fit diagnostic" (DONE)
- Column header already "Plan Fit"; InfoHint already Plan-Fit worded (line 428) — OK.
- Remaining are COMMENTS ONLY (lines 87, 150, 200, 204) + internal fit.score.toFixed — leave code, but the two code-comment "scored" at 150/204 can stay (not user-facing). Comment at 87 mentions "score ranking language" — comment only.

### ResearchArea.tsx — TODO
- line ~17, ~20: code comments mention "read-only screener" / "Explore screener" — comments only, optional.
- line ~113 hint string: MUST change to the verbatim ResearchArea hint above. Current: "The four published reference catalogues plus All Approved Instruments — a read-only screener across every approved row. Managers can edit, deactivate, mark stale, or view the audit history of any row; reference data is never money — only confirmed holdings affect your plan."
  -> Replace the "read-only screener across every approved row" phrasing. User asked specifically: change to "Approved reference universe across every approved catalogue row." Keep the manager/edit sentence? User said change the hint to that exact sentence. Decision: replace the whole hint with a version that leads with the required sentence and keeps the governance clause, OR replace just the screener clause. Chosen: replace so it READS "The four published reference catalogues plus All Approved Instruments — approved reference universe across every approved catalogue row. Managers can edit, deactivate, mark stale, or view the audit history of any row; reference data is never money — only confirmed holdings affect your plan." (keeps info, swaps the screener phrase). NOTE: user text "Change to: Approved reference universe across every approved catalogue row." refers to the screener clause.

### Explore.tsx — separate legacy page (route /explore). NOT "All Approved Instruments" (that's AllApprovedInstruments.tsx). Explore still uses Score/screener heavily.
- Is Explore reachable? referenceCatalogueTabs renders AllApprovedInstruments (embedded) for the all-approved tab, NOT Explore. /explore is a legacy route. Check App.tsx: /explore likely redirects to research all-approved (routeRedirects promised map had "/explore": research/all-approved). So Explore.tsx may be DEAD/redirected — verify. If redirected & not rendered, leave it (out of scope: user said "All Approved Instruments"). CONFIRM before editing to avoid scope creep. Likely leave Explore.tsx untouched.

### CatalogueRowControls.tsx — code comment only (line 78 "approved-universe screener") — comment, optional.

## Tests
- Add static guard (server/round94PlanFitWording.test.ts): AllApprovedInstruments + ResearchArea hint contain no user-facing "screener"/"Screener" and no standalone user-facing "Score" label; ResearchArea hint contains "Approved reference universe across every approved catalogue row"; AllApprovedInstruments contains the exact intro sentence.
- Careful: assert on rendered strings, not comments. Simplest: assert the specific required sentences are PRESENT, and that the specific old sentences are ABSENT.
- Run full suite + tsc.

## Verify UI
- /research?tab=reference-catalogues&cat=all-approved  and the Reference Catalogues hint banner.
