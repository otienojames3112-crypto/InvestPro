# Round 90 test anchors (verified in source)

## New backend
- `server/db.ts` → `export async function listArchivedFederatedUniverse(): Promise<FederatedInstrument[]>` (line ~3562). Same FederatedInstrument shape as listFederatedUniverse. MMF keyed by fundName; bank keyed `bank:${id}`; opps by o.ref. Only rows with `isArchived(...)` (referenceRowMeta.archivedAt != null).
- `server/routers.ts` → `explore.approvedArchived: adminProcedure.query(...)` returns `{ instruments }` (line ~7961). approvedList unchanged (public, + planFit).
- `server/db.ts` setMmfActive(fundName, active, by, reason) → recordDeactivationAudit → sets meta.archivedAt on deactivate, clears on reactivate. Archiving = setActive false.
- catalogue.setActive adminProcedure input { catalogue, targetRef, active, reason? }.

## Client
- AllApprovedInstruments.tsx: Switch id="include-archived", `trpc.explore.approvedArchived.useQuery(undefined,{enabled: isManager && includeArchived})`, merged rows get `{...r, archived}`. ApprovedRow type `& { archived: boolean }`. fit passed undefined for archived. Row shows Archive badge; CatalogueRowControls isActive={!r.archived}.
  - Copy: "Include archived rows"; InfoHint "Manager-only. Off by default. When on, archived reference rows are shown with an “Archived” badge so you can find and reactivate them from here. Archived rows are never scored (no Plan Fit) and are never hard-deleted."
  - CardDescription: "Archived rows are hidden unless you turn on “Include archived rows”."
  - Header blurb: "approved reference universe" ... "governed review path (Research → Review Queue → manager approval)".
- referenceCatalogueTabs.tsx: CATALOGUE_TABS[0].id === "all-approved" (first tab), renders `<AllApprovedInstruments embedded />`.
- CatalogueRowControls.tsx invalidates `utils.explore?.approvedArchived?.invalidate?.()`.

## Governance single-path (test F static)
- routers.ts reviewCatalogueSource: comments "writes NOTHING to any catalogue", reuses ask engine + draftFromFinding. Returns findings via listResearchFindings (status new).
- AskAI.tsx FindingCard uses `trpc.research.draftFromFinding.useMutation` + button "Draft into review queue".
- CatalogueSourceReviewButton wired in all 4 pages with isManager={isManager}.

## Pure gate (shared/researchPipeline.ts)
- assetClassForCatalogue(c) (line 384); checkApprovalGate({assetClass,changeKind,figures,name,issuer,currency,source,asOf}) → { ok, catalogue, missing[] }.
- CATALOGUE_FIELD_RULES.cbk needs: securityType, tenor, yieldPct, whtRule, taxExempt, maturityRule, source, asOf.
- aiResearchService.ts exports: applyCbkRuleFill(figures), missingFieldsForFinding(cat,figures,envelope), normaliseFinding(raw).
  - applyCbkRuleFill fills securityType/tenorDays/tenor/whtRule/taxExempt/maturityRule for 91/182/364 bill but NEVER yieldPct.
  - normaliseFinding for cbk applies rule-fill; a bill with tenor but no yieldPct still lists rate/coupon missing.
- NOT_ADMIN_ERR_MSG from shared/const = 'You do not have required permission (10002)'.

## ctxFor helper (copy from opportunityMaintainer.test.ts lines 9-26)

## mmfFunds insert required cols: fundName, company, grossYield, ear (others defaulted).

## Confirmed exact strings/anchors (final)

### Routers
- explore.approvedList (public) returns { instruments, planFit, weights, scoredAt } (line ~7915).
- explore.approvedArchived (adminProcedure) returns { instruments } via listArchivedFederatedUniverse (line ~7962).
- catalogue.setActive adminProcedure input { catalogue, targetRef, active, reason? } → uses setMmfActive/setBankActive/setOpportunityActive (line ~8001).
- research.reviewCatalogueSource (adminProcedure) returns { taskId, threadId, catalogue, answer, model, findings }; comment "writes NOTHING to any catalogue" (line ~7748).
- research.draftFromFinding (adminProcedure) → validatePendingUpdate + enqueueResearchUpdate origin "ai"; comment "Still NOT a catalogue write" (line ~7640).
- researchPipeline.review({ id, approve }) publishes (used in E/F).
- appRouter export line 1081; AppRouter type line 8119.

### db.ts
- listFederatedUniverse: APPROVED_STATES=new Set(["human_verified","human_entered"]) (line 3276); `if (!APPROVED_STATES.has(o.verificationState)) continue;` (3354). isArchived filters per catalogue.
- listArchivedFederatedUniverse: filters via meta[cat][targetRef]?.archivedAt != null; MMF ref mmf:${id} keyed by fundName; bank ref bank:${id}; opps by o.ref, cbk/market only.
- setMmfActive/setBankActive/setOpportunityActive exported; archiving = setActive(false) → recordDeactivationAudit sets meta.archivedAt.
- getMmfFunds returns only isActive=true rows → archived MMF disappears from approvedList automatically.
- enqueueResearchUpdate, getMmfFunds, mmfRateHistoryFor, addMmfFund(InsertMmfFund{fundName,company,grossYield,ear}) exported.
- listReferenceRowMeta(catalogue) → Record<targetRef, ReferenceRowMeta>.

### aiResearchService.ts
- RESEARCH_SYSTEM_PROMPT export (line 83): "MAY present facts in a useful order", "NEUTRAL, FACTUAL comparisons", "Do NOT give ADVICE or RECOMMENDATIONS", "what to buy/sell/hold".
- applyCbkRuleFill(figures): fills securityType/tenorDays/tenor/whtRule/taxExempt/maturityRule for 91/182/364 T-bill; NEVER sets yieldPct. IFB → infrastructure_bond taxExempt true. FXD → treasury_bond.
- normaliseFinding(raw): for cbk calls applyCbkRuleFill({...figures,name}) then deletes name; missingFields via missingFieldsForFinding; unsourced → confidence capped Math.min(confidence,0.3) + warning "No source was cited".
- missingFieldsForFinding(cat, figures, envelope) → gate.missing.
- catalogueReviewInstruction/summariseCatalogueRows/buildCatalogueReviewQuestion exported (used in Round 89).

### shared/researchPipeline.ts
- assetClassForCatalogue: mmf→cash_mmf, bank→bank_deposit, cbk→gov_discount, market_asset→equity (line 384).
- checkApprovalGate({assetClass,changeKind,figures,name,issuer,currency,source,asOf}) → {ok,catalogue,missing}. edit changeKind always ok.
- CATALOGUE_FIELD_RULES.cbk labels: "security type","tenor","rate / coupon / previous average rate","WHT rule","tax-exempt flag","maturity rule","source","as-of date".

### Client static strings
- referenceCatalogueTabs.tsx: CATALOGUE_TABS[0].id === "all-approved" (FIRST), renders <AllApprovedInstruments embedded/>.
- AllApprovedInstruments.tsx: uses useAuth isManager = role==='admin'; explore.approvedList.useQuery; explore.approvedArchived.useQuery(undefined,{enabled:isManager&&includeArchived}); rows merge archived flag; fit={r.archived?undefined:planFit[r.ref]}; CatalogueRowControls isActive={!r.archived}; Switch id="include-archived"; "Include archived rows"; InfoHint text; header blurb "approved reference universe" + "governed review path (Research → Review Queue → manager approval)"; CardDescription "Archived rows are hidden unless you turn on"; isTestMode = mode==='sandbox'; ReferenceDataMaintenance resetToSeed.mutate({confirm:true}) gated by isTestMode.
- CatalogueRowControls.tsx invalidateAll includes utils.explore?.approvedArchived?.invalidate?.().
- CatalogueSourceReview.tsx: single-path comment "exactly ONE governed path: source → findings → review queue → approval → catalogue update"; guardrail "Nothing here changes a catalogue" + "approvals never rewrite past actuals" + "Review Queue"; buttons "Review MMF/bank/CBK/market source with AI"; "91 / 182 / 364-day"; imports FindingCard whose draft button calls research.draftFromFinding; CatalogueSourceReviewButton `if (!isManager) return null`.
- AskAI.tsx: FindingCard draft = trpc.research.draftFromFinding.useMutation; button "Draft into review queue"; banner "sort and compare the facts it finds, but it never writes to a catalogue, never tells you what to buy or sell, and never recommends".
- AiIntake.tsx AiPrincipleBanner: "extract, compare, sort and summarise", "never tells you what to buy, sell, or hold", "approved = manager-verified".
- All 4 catalogue pages import CatalogueSourceReviewButton with isManager={isManager}; and ArchivedRowsPanel + CatalogueScopeFilter.
- NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)'.
