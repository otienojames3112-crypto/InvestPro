# Round 86 — Research audit implementation notes

## Confirmed scope (from pasted_content_22.txt)
1. Dedicated AllApprovedInstruments.tsx — approved federated universe ONLY. Drop Explore.tsx for this tab.
   - Read only from `trpc.explore.federatedUniverse` (may alias to `trpc.researchUniverse.approvedList`).
   - MUST NOT call opportunities.list / opportunities.scored.
   - Remove: This-catalogue/All-catalogues toggle, scopeView, OpportunityRow, "Add instrument", screener copy.
2. Wording: "approved reference universe", "filter approved instruments", "Plan Fit diagnostics" (not Score/screener).
   - Explainer sentence: "All instruments shown here have been approved into one of the reference catalogues. Reference data does not affect portfolio math until a holding is recorded."
3. Keep score idea but rename to "Plan Fit" / "Fit Diagnostics". Transparent components: net-of-tax yield, maturity fit, liquidity fit, source freshness, issuer concentration risk, tax/fee drag. Neutral default order; sort by Plan Fit only on explicit choice.
4. Fix ?ref=NSE:EABL leaking into other catalogue search boxes. On cat switch, clear ref unless new catalogue owns it. Don't prefill search unless the row exists in that catalogue.
5. federatedUniverse must include APPROVED rows only. Rule: active && unverified==false && verificationState in {human_verified, human_entered} (MMF/bank are curated → treat active as approved; opportunities/CBK/market need the gate). Exclude scraped_unverified / ai_extracted.
6. Lifecycle controls on approved-universe: Open/Manage in catalogue (1-click), Deactivate/archive, Mark stale, View audit history. Reuse CatalogueRowControls.
7. Test Mode manager-only cleanup: clear/reset seeded reference catalogues, clear pending research queue, clear test recently-approved audit log. Live never hard-deletes (deactivate/archive only).
8. Ask AI banner: allow factual extract/compare/sort/summarize; ban buy/sell/recommend/best. New copy in AiIntake.tsx AiPrincipleBanner (lines ~125-136).
   New banner: "AI drafts are unverified until you approve them. Ask AI can extract, compare, sort, and summarize facts from sources, but it does not publish catalogue values, change holdings, execute transactions, or tell you what to buy. Approved values become manager-verified records."
9. Ask AI system prompt: allow factual sorting/comparison by disclosed column; keep recommendation ban. Located in aiResearchService.ts (RESEARCH prompt).
10. Tests A–D.

## Key backend facts
- `server/db.ts` listFederatedUniverse() lines ~3058-3114. Currently: mmf active, bank active, opportunities active (cbk+market_asset) — NO unverified/verificationState gate. THIS is the NSE:EABL leak.
- opportunities schema (drizzle/schema.ts ~1109-1146): `unverified` boolean default true; `verificationState` varchar default "scraped_unverified" (values: scraped_unverified | ai_extracted | human_verified | human_entered); `active` boolean.
- mmf_funds: isActive boolean, fundName, company, ear, source. bank_instruments: isActive, bankName, indicativeRate, source.
- Lifecycle helpers (db.ts ~3288-3360): setMmfActive(fundName,active,by,reason), setBankActive(bankName,...), setOpportunityActive(ref,...), setReferenceRowStale({catalogue,targetRef,instrumentName,stale,reason,by}), recordDeactivationAudit. referenceRowMeta table has archivedAt/staleAt.
- CatalogueRowControls.tsx (client/src/components) reuses trpc.catalogue.setActive/setStale/auditFor/rateHistory. invalidateAll() does NOT invalidate the federated query yet — add that.
- referenceRowMeta: (catalogue, targetRef) archived rows should be excluded from approved universe too.
- catalogueAuditLog table exists (approval trail): catalogue, targetRef, changeKind, approvedBy, approvedAt.

## FederatedRow routing (already correct in Explore.tsx)
- mmf→mmf-market (ref=name), bank→bank-catalogue (ref=name), cbk→cbk-securities (ref=r.ref), market→market-assets (ref=r.ref).
- href: `/research?tab=reference-catalogues&cat=${catParam}&ref=${refValue}`

## Plan (phases)
2 backend gate + Test-Mode cleanup → 3 AllApprovedInstruments.tsx → 4 ref-leak fix → 5 Ask AI banner+prompt → 6 Test Mode UI → 7 tests → 8 zip.


## PROGRESS (phase 3 in progress)
### DONE (phase 2 backend, tsc clean):
- db.ts listFederatedUniverse() REWRITTEN: approval gate (opps require !unverified && verificationState in {human_verified,human_entered}; archived excluded via referenceRowMeta.archivedAt; stale flag surfaced). FederatedInstrument type ENRICHED with: dataAsOf, verificationState, liquidity, maturityDate, expenseRatioPct, targetRef, stale. Bank liquidity derived from instrumentType (fixed_deposit/target_savings=term else daily). MMF liquidity=daily, verificationState=human_entered, expenseRatioPct from managementFee.
- db.ts appended Round86 cleanup helpers: archiveAllReferenceRows(by,reason){archived}, clearPendingResearchQueue(){deleted}, clearCatalogueAuditLog(){deleted}, resetReferenceCataloguesToSeed(seed){opportunitiesSeeded}.
- routers.ts: explore.approvedList publicProcedure added → {instruments, planFit(ref-keyed {score,eligible,ineligibleReasons,components,netYieldPct}), weights, scoredAt}. Reuses scoreInstrument from shared/instrumentScore. Imported scoreInstrument + LiquidityFacet.
- routers.ts: researchAdmin router added (adminProcedure): archiveAllReferenceRows({reason?}), clearPendingQueue(), clearApprovalAuditLog(), resetToSeed({confirm:true}). Imports of 4 cleanup helpers added to db import block.

### CatalogueRowControls (client/src/components/CatalogueRowControls.tsx) — REUSE for lifecycle:
- Props: {catalogue:"mmf"|"bank"|"cbk"|"market_asset", targetRef, instrumentName?, isActive, isStale?, showRateHistory?, size?:"icon"|"sm"}. Admin-only (renders null otherwise). Handles deactivate/reactivate/mark-stale/audit/rate history. Uses trpc.catalogue.setActive/setStale/auditFor/rateHistory.
- Its invalidateAll() invalidates catalogue.rowMeta + researchPipeline.recentlyApproved + mmfFunds.list + bankInstruments.list. Does NOT invalidate explore.approvedList/federatedUniverse — the new page must invalidate its own query on mutation (wrap or invalidate via utils in page).

### AllApprovedInstruments.tsx plan (NEW FILE, replaces Explore embed for the all-approved tab):
- Reads ONLY trpc.explore.approvedList. NO opportunities.list/scored. NO scopeView toggle, NO OpportunityRow, NO "Add instrument".
- Filters: search (name/issuer/ref), catalogue filter (all/mmf/bank/cbk/market_asset), currency, min/max headline. Neutral order: CAT_ORDER {mmf:0,bank:1,cbk:2,market_asset:3} then name. Sort by Plan Fit ONLY on explicit column click (default neutral).
- Columns: Instrument | Catalogue badge | Ccy | Headline figure(+label) | [Plan Fit (toggle)] | Source & freshness(dataAsOf via rateStaleness + stale badge) | Manage(CatalogueRowControls + "Open in catalogue" link).
- Explainer copy (item 2): "All instruments shown here have been approved into one of the reference catalogues. Reference data does not affect portfolio math until a holding is recorded."
- Plan Fit label + Fit Diagnostics popover (reuse ScoreCell-style breakdown from approvedList.planFit[ref].components). Toggle "Show Plan Fit" default OFF.
- catParam map: mmf→mmf-market, bank→bank-catalogue, cbk→cbk-securities, market_asset→market-assets. refValue = (mmf|bank? r.name : r.ref). href `/research?tab=reference-catalogues&cat=${catParam}&ref=${enc(refValue)}`. targetRef for CatalogueRowControls = r.targetRef.
- CAT_BADGE palette + catalogueLabel from @shared/researchPipeline.
- After lifecycle mutation, invalidate explore.approvedList (pass an onChanged callback or use utils.explore.approvedList.invalidate()).

### Wiring:
- referenceCatalogueTabs.tsx currently renders Explore embedded for all-approved tab → switch to <AllApprovedInstruments/>. (Confirm the tab id is "all-approved".)
- Explore.tsx + /explore/:ref detail route + /explore/new still used by? Check: opportunities detail. Keep Explore.tsx file (detail route may still use it) but it's no longer the all-approved tab body. Actually all-approved was embedding Explore; verify nothing else imports Explore embedded.

### Item 4 ref-leak: useRefFocus prefills search from ?ref= on all 4 catalogue pages. BUG: switching cat keeps ?ref= in URL → wrong catalogue prefills search with foreign ref (NSE:EABL). FIX in referenceCatalogueTabs/ResearchArea cat-switch: strip ?ref= when cat changes; and in each catalogue page only prefill search if a row with that ref EXISTS. useRefFocus at client/src/hooks/useRefFocus.ts.

### Item 5 Ask AI: banner in AiIntake.tsx AiPrincipleBanner (~125-136). System prompt in aiResearchService.ts RESEARCH prompt. New banner text in note line 16 above. Allow factual sort/compare, ban buy/sell/recommend/best.

### Item 6 Test Mode UI: manager-only cleanup panel calling researchAdmin.* — likely on ResearchDesk or a Settings/Test area. Confirm best host. Gate hard reset behind confirm dialog.


## PROGRESS checkpoint (phase 6 in progress)
- Phases 2,3,4,5 DONE (tsc clean). Phase 5: RESEARCH_SYSTEM_PROMPT (aiResearchService.ts ~87) allows neutral factual sort/compare, bans advice/recommendations. AskAI banner (AskAI.tsx ~356) updated.
- researchAdmin router mutation names (routers.ts 7775-7803): archiveAllReferenceRows({reason?}) Live-safe; clearPendingQueue(); clearApprovalAuditLog(); resetToSeed({confirm:true}) hard/Test-only.
- Phase 6 host: AllApprovedInstruments.tsx, manager-only maintenance panel to insert AFTER disclaimer card (after line ~250, before Filters card). Mode via usePortfolio() mode==="sandbox". Use AlertDialog like ModeSwitcher. Live shows archive-all + clear-pending + clear-audit; resetToSeed only when sandbox.
- imports already in AllApprovedInstruments: useAuth, trpc, Card*, Button, Badge, FlaskConical, ShieldAlert, ShieldCheck, Clock. NEED to add: AlertDialog* , usePortfolio, useState (check), Trash2/RotateCcw/Loader2, toast.
