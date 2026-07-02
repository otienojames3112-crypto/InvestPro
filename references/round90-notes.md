# Round 90 — Research audit fixes (implementation notes)

Source of truth: /home/ubuntu/upload/pasted_content_24.txt (11 items).
Project: /home/ubuntu/kes5m-tracker. Tests run in **node** env, `server/**/*.test.ts` only (vitest.config.ts). No jsdom — UI checks are STATIC source guards (see round86/88 test style). Prior rounds: round88-notes.md, round89-notes.md.

## Status
- [x] Phase 2 (P0 crash): CatalogueSourceReview.tsx — listFindings returns `{ findings }`, not array. Fixed: unwrap via `findingsQuery.data?.findings` + `Array.isArray` guard, and seed `result.findings` from the mutation return. tsc clean.
- [x] Phase 3 Bank row identity DONE: resolveBankRef(bank:<id>|name) in db.ts; setBankActive/bankRateHistoryFor/verifyCataloguePublished/promotion(existing lookup + promotedRef=bank:<id> via extractInsertId)/archiveAll all ref-based; federatedUniverse targetRef=bank:<id> + isArchived/isStale by bank:<id>; BankInstruments.tsx table+drawer+focus+clearIfMissing use bank:${r.id}; search prefill skips bank:<id>. tsc clean.
- [x] Phase 4 Archive recoverability DONE: catalogue.listArchived (manager-only) + listArchivedCatalogueRows(catalogue) in db.ts (resolves archived meta -> source row, mmf=fundName/bank:<id>/cbk|market=o.ref). ArchivedRowsPanel + CatalogueScopeFilter shared components. Wired manager-only Active/Archived/All filter into MMF/Bank/CBK/Market pages (table gated by scope!=='archived', panel shown when scope!=='active'). All Approved toggle still TODO. tsc clean.
  FACTS: archived meta (archivedAt/By/Reason) persisted in referenceRowMeta, exposed per-catalogue via `catalogue.rowMeta` query (client already fetches metaData?.meta keyed by targetRef). getBankInstruments() returns ALL rows (active+inactive) — Bank page filters client-side by r.isActive. getMmfFunds() = SQL active-only (needs includeArchived flag). listOpportunities() — check active filter. federatedUniverse skips archived (isArchived continue at db.ts ~3293/3319/3355).
  PLAN: (a) add includeArchived option to getMmfFunds + mmfFunds.list (default false); (b) manager-only Active/Archived/All segmented filter on all 4 catalogue pages, show archived badge + by/date/reason (from rowMeta) + existing Reactivate (CatalogueRowControls already has Reactivate/audit); (c) 'Include archived rows' toggle (off) in All Approved (Explore federatedUniverse/approvedList) — add includeArchived input. Bank/CBK/Market rows already carry isActive/active client-side; MMF list is the only one needing a query flag. rowMeta targetRef keys: mmf=fundName, bank=bank:<id>, cbk/market=o.ref.
  MMF list proc @ routers.ts 5086; getMmfFunds @ db.ts 711; getBankInstruments @ 1021; federatedUniverse @ routers 7901; approvedList @ 7913.
- [ ] Phase 5 provenance + missing-fields + CBK completeness
- [~] Phase 6 Ask AI copy + follow-up: DONE — AiPrincipleBanner refreshed (approve-gated, extract/compare/sort/summarise allowed, no publish/execute/buy-sell); useSourceAttachment({followUp}) label 'Add another source for this follow-up'; wired in Conversation; contextNote() caption under assistant answers ('earlier conversation'/'source you attached'/both). tsc clean. Comments/tests updated in phase 8.
- [ ] Phase 7 All Approved cleanup + reorder
- [ ] Phase 8 tests + tsc + checkpoint
- [ ] Phase 9 ZIP

## Phase 3 — Bank row identity (target: `bank:<id>` everywhere)
Backend seams in server/db.ts keyed on bankName today:
- federatedUniverse/approved rows (~3311-3334): row already has `ref: "bank:${b.id}"` BUT sets `targetRef: b.bankName` and checks `isArchived("bank", b.bankName)` / `isStale("bank", b.bankName)`. FIX: use `bank:${b.id}` for targetRef + meta checks.
- `setBankActive(bankName,...)` (~3555): looks up by bankName, archives first match. FIX: accept a ref; add resolver.
- promotion bank branch (~2587-2610): `existing` lookup by `current.targetRef` == bankName; `promotedRef = p.bankName`. FIX: resolve `bank:<id>` for existing lookup; set promotedRef to `bank:${id}`.
- bankProductRateHistory insert (~2713): instId lookup by p.bankName. keep bankName column but ensure instId correct.
- catalogueRowExists bank branch (~2818): checks by bankName.
- bankRateHistoryFor(bankName) (~3721): rate history query by bankName column. Need ref→ how? bankProductRateHistory has bankInstrumentId + bankName. Prefer query by bankInstrumentId when ref is bank:<id>.
- archiveAll (test-mode, ~3820): archives by name — ok for test reset.

Plan: add helper `resolveBankRef(ref): { id, bankName } | null` that parses `bank:<id>` (numeric) else treats as legacy bankName. Use in setBankActive, setReferenceRowStale target, auditFor(no change—just string), rateHistory (bank branch), catalogueRowExists.
- `catalogue.setActive` router → calls setBankActive; must pass ref. Route by parsing.
- Frontend BankInstruments.tsx: change `staleByRef.get(r.bankName)`, `registerRow/data-ref/isFocused`, `CatalogueRowControls targetRef={r.bankName}` and drawer → use `bank:${r.id}` (rows have `.id`). refFocus uses `(rows).map(r=>r.bankName)` for the ref list — switch to `bank:${r.id}` and the `?ref=` deep-link accordingly. Recently Approved links (researchPipeline.recentlyApproved) — check how bank links built.
- CatalogueRowControls.tsx: no change needed (passes targetRef through), audit/rate dialogs use targetRef string.

rateHistory router bank branch: currently `bankRateHistoryFor(ref)` where ref=bankName. Change to resolve bank:<id> → bankInstrumentId and query bankProductRateHistory by bankInstrumentId (add helper bankRateHistoryForRef).

## Copy (item 2 banner) — Ask AI
Replace old banner with:
"AI drafts are unverified until you approve them. Ask AI can extract, compare, sort, and summarize facts from sources, but it does not publish catalogue values, change holdings, execute transactions, or tell you what to buy. Approved values become manager-verified records."
Allowed: factual sort by disclosed field. Banned: recommendation/suitability/"buy this". Update comments/tests that say AI can never rank/sort.

## Item 6 — All Approved Instruments wording + order
Replace screener/read-only screener/score → approved reference universe / approved instruments table / filter approved instruments / Plan Fit diagnostics.
Blurb: "All instruments shown here have been approved into one of the reference catalogues. Reference data does not affect portfolio math until a holding is recorded."
Reorder sub-tabs: All Approved Instruments FIRST, then MMF Market, Bank Product Catalogue, CBK Securities Reference, Market Assets Reference. (referenceCatalogueTabs.tsx CATALOGUE_TABS order.)

## Item 7 — provenance fallback (aiResearchService parse)
After parsing findings: sourceLabel = finding.sourceLabel ?? input.sourceLabel ?? ("Uploaded PDF"/"Uploaded screenshot"/"Pasted source text"/URL hostname). sourceUrl = finding.sourceUrl ?? source.url (if URL). Do NOT invent sourceAsOf.

## Item 8 — missingFieldsForFinding align with shared/researchPipeline CATALOGUE_FIELD_RULES/checkApprovalGate.
Old minimal: MMF ear / Bank indicativeRate / CBK yieldPct / Market lastPrice. Replace with the shared rules.

## Item 9 — CBK deterministic rule-fill (tbill_91/182/364)
securityType=tbill_91/182/364; tenor=91/182/364 days; whtRule="15% WHT on discount"; taxExempt=false; maturityRule=value date + tenor days. IFB: taxExempt=true, whtRule 0%. FXD: taxExempt=false, whtRule 15% if tenor<10y else 10% (editable). Tool fills, don't force AI to invent.

## Tests (Round 90) — server/round90*.test.ts
A crash unwrap; B banner copy; C follow-up (prior turns/new source/versioned correction); D archive recover; E bank per-product identity; F missing-fields==gate; G CBK 91/182/364 rule-fill + incomplete stays pending.


## Phase 5 EXACT FACTS (verified against source, do not re-read)

### aiResearchService.ts (584 lines)
- `missingFieldsForFinding(targetCatalogue, figures)` @ ~179 uses MINIMAL local list: mmf=["ear"], bank=["indicativeRate"], cbk=["yieldPct"], market_asset=["lastPrice"] with local aliases. NEEDS ALIGNMENT to shared full rules.
- `normaliseFinding` @ ~208 computes sourceLabel/sourceUrl = cleanStr(o.sourceLabel/sourceUrl); hasSource = Boolean(sourceLabel||sourceUrl); adds "No source cited" warning + caps confidence 0.3 when no source. This is where the model-omitted-provenance shows up.
- `runResearchQuestion(args)` @ ~483 → after `parseResearchResponse` (~575) it maps `withWarnings` and returns. Provenance fallback must be inserted HERE: after findings parsed, before/at withWarnings, stamp finding.sourceLabel/sourceUrl from actual attached `source` + args.sourceLabel when missing. source union: {kind:url,url}|{kind:text,text}|{kind:pdf,fileUrl}|{kind:image,imageUrl}. Legacy normalised into `source` var already (~511-518).
  - Fallback label: url→hostname of source.url; pdf→"Uploaded PDF"; image→"Uploaded screenshot"; text→"Pasted source text"; prefer args.sourceLabel if provided. sourceUrl fallback: source.url when kind==url. DO NOT invent sourceAsOf.
  - After stamping label/url, recompute confidence bucket? findingsToRows recomputes bucket via confidenceBucket(d.confidence, hasSource). If we stamp a label, hasSource becomes true at row time. Good. But normaliseFinding already capped d.confidence to 0.3 for no-source — acceptable (still low but sourced). Keep simple: stamp label/url + drop the "No source cited" warning when we DID attach one.
- `findingsToRows(taskId, drafts, threadId?)` @ ~287 sets confidence via confidenceBucket(d.confidence, Boolean(d.sourceLabel||d.sourceUrl)); sourceAsOf parsed from ISO.

### shared/researchPipeline.ts — CATALOGUE_FIELD_RULES @ 418 (FULL required set)
- mmf: name, company(issuer), ear(figures), managementFee, minInvestment, source, asOf. (AUM optional.)
- bank: name(issuer), instrumentType, minAmount, typicalTenor(escapable fullyLiquid), indicativeRate(escapable rateUnavailable), isNegotiable, liquidity, source, asOf.
- cbk: securityType, tenor, yieldPct, whtRule, taxExempt, maturityRule, source, asOf. (issueNumber/auctionDate/valueDate captured, NOT hard-required.)
- market_asset: name, issuer, market, currency, lastPrice(escapable figuresUnavailable), source, asOf.
- `figurePresent(figures,key)` has alias map (ear→[ear,netYield,yieldPct,yield,grossYield], etc.) — treats booleans as present.
- CATALOGUE_REQUIRED_FIELDS (minimal, back-compat) mmf=[ear] bank=[indicativeRate] cbk=[yieldPct] market=[lastPrice].
- `checkApprovalGate({assetClass,changeKind,figures,name,issuer,currency,source,asOf,managerValue})` @ 543: edit→ok. create→loops CATALOGUE_FIELD_RULES; managerValue override satisfies PRIMARY figure key; escapeFlag===true satisfies escapable; returns {ok,catalogue,missing:[labels],reason}.
- ALIGNMENT PLAN: rewrite missingFieldsForFinding to only assess the FIGURES-sourced rules that the FINDING carries (a finding has figures + name/issuer/currency + sourceLabel + sourceAsOf). Best: build a helper `missingFinding FieldsAgainstGate` that maps a ResearchFindingDraft → the checkApprovalGate `missing` labels (changeKind:"create"), passing name=instrumentName, issuer, currency, source=sourceLabel, asOf=Date.parse(sourceAsOf), figures=extractedFields. That way FindingCard shows EXACTLY the gate's missing labels. Keep it importable + pure for test F. Escapable fields: without escape flags the finding will list tenor/indicativeRate/liquidity as missing — acceptable & truthful (manager sees what's needed). Provide escape via figures flags only if source stated.

### Item 9 — CBK deterministic rule-fill (test G)
Where: reviewCatalogueSource CBK path OR normaliseFinding for cbk. Plan: a pure `applyCbkRuleFill(finding)` that, for cbk findings, derives from tenor/securityType: tbill_91/182/364 → securityType, tenor days, whtRule="15% WHT on discount", taxExempt=false, maturityRule="value date + N days". IFB → taxExempt=true, whtRule="0% (tax-exempt)". FXD → taxExempt=false, whtRule tenor<10y?"15%":"10%". Fill ONLY when source gave the tenor/type; never invent yield. Incomplete (no yieldPct) stays pending (gate still flags rate). Apply in reviewCatalogueSource after findings returned (cbk only), so Ask AI generic path unaffected — OR in a shared helper used by both. Decide: apply in aiResearchService parse for targetCatalogue==="cbk" so both paths benefit. Test G asserts 91/182/364 → 3 findings each with tenorDays + securityType + whtRule.

### Tests file: server/round90CatalogueReview... use server/round90*.test.ts. Node env, server/**/*.test.ts only.
- A crash unwrap (static guard on CatalogueSourceReview.tsx: Array.isArray + findings from mutation).
- B banner copy (static guard AskAI.tsx / AiPrincipleBanner text).
- C follow-up (runResearchQuestion priorMessages assembly via invokeLLM mock; + static UI copy "Ask a follow-up"/"Add another source for this follow-up").
- D archive recover (catalogue.listArchived returns archived rows w/ meta; static ArchivedRowsPanel guard).
- E bank identity (DONE round90; add test: two bank rows same bankName distinct ids; resolveBankRef; setBankActive archives only the one id; federatedUniverse targetRef=bank:<id>).
- F missing-fields == gate (missingFieldsForFinding(new helper) matches checkApprovalGate.missing for representative findings per catalogue).
- G CBK rule-fill (applyCbkRuleFill or parse: 91/182/364 → tenorDays/securityType/whtRule/taxExempt; incomplete stays flagged).

### Item 2 copy (Ask AI banner) + Item 6 (All Approved wording + reorder) — see earlier notes lines 36-44.
