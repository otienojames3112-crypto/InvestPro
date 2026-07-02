# Round 85 — Research UX/pipeline audit implementation notes

## Confirmed scope (from user pasted_content_21.txt)
Top-level Research tabs → ONLY: Research Desk + Reference Catalogues (remove Explore Screener top-level).
Reference Catalogues sub-tabs: All Approved Instruments, MMF Market, Bank Product Catalogue, CBK Securities Reference, Market Assets Reference.

### Item breakdown
1. Merge "Import a document" into Ask AI. Remove the Import tab. Under Ask's "Add a specific source": URL / paste text / upload PDF / upload image. Same output (answer + findings + draft-to-queue) regardless of source.
2. Keep Enquiry History but secondary (smaller view).
3. Remove Explore Screener top-level tab; move function to "All Approved Instruments" inside Reference Catalogues (approved rows only across MMF/Bank/CBK/MarketAssets; no unapproved AI findings).
4. Keep old "score" idea but rename → optional "Plan Fit"/"Fit Diagnostics" drawer/column (NOT a recommendation). Explains: net-of-tax yield, maturity fit, liquidity fit, source freshness, issuer concentration risk, tax/fee drag. Default order neutral; sort by Plan Fit only if manager chooses.
5. Approval publishes immediately: cash_mmf→MMF Market; bank_deposit→Bank; gov_discount/gov_coupon→CBK; equity/reit/offshore_fund/alt→Market Assets. Recently Approved = audit log only. After approval show "Approved and published to X" + "Open published row". If publishing fails, keep pending + show error.
6. "Open published row" deep-link: /research?tab=reference-catalogues&cat=mmf-market&ref=... → open subtab, scroll to row, highlight briefly, or prefill search. Apply to all 4 catalogue pages.
7. Remove Serrari as page-wide MMF assumption. Neutral copy: "Approved Kenyan money-market fund reference data. Sources vary by fund; verify each row before acting." Compute dynamically: active fund count, avg EAR, top-5 avg EAR, latest as-of. Do NOT hardcode "27 CMA-regulated funds", "Data from Serrari Group", "Industry average EAR 9.24%", "Data last updated 21 Jun 2026".
8. MMF Market Source & Freshness column: source name, open link, as-of date, stale badge, audit/history.
9. MMF approval completeness gate: name, company, gross-or-EAR, management fee, min investment, source, as-of. AUM optional-but-flagged. Never store missing numerics as 0.
10. Govern direct MMF edits: reference edits (add/edit yield/fee/min/deactivate) require source + as-of + reason + old/new; write catalogue audit log + rate history (on yield/EAR change). Portfolio actions (set primary, add secondary, record deposit) may stay direct.
11. Tests (see item 12 in todo).

## Backend facts discovered
- server/db.ts reviewResearchUpdate (≈2450-2779): already publishes immediately, verifies row via verifyCataloguePublished, keeps update PENDING + returns `blocked{missing,reason}` on failure, writes rate history + catalogue audit AFTER verified publish. Returns { update, promotedRef, target }. router researchPipeline.review returns {...res, ok:boolean}.
- Direct MMF CRUD in db.ts (≈710-745): getMmfFunds/addMmfFund/updateMmfFund/deactivateMmfFund — thin, UNAUDITED. Needs governance (source/as-of/reason + audit + rate history).
- recordManualCorrectionAudit + audited activate/deactivate helpers exist ≈3287-3394. MMF rate-history readers ≈3406-3478.
- shared/researchPipeline.ts CATALOGUE_FIELD_RULES (≈414-465): MMF requires name/company, gross-or-EAR, mgmt fee, min investment, source, as-of; AUM absent(optional). checkApprovalGate ≈539-600 blocks incomplete creates, exempts edits, allows managerValue/overrideGate.
- listFederatedUniverse in db.ts (≈3052-3114): approved-only cross-catalogue union → backs "All Approved Instruments".

## Client facts
- ResearchArea.tsx TABS: research-desk, explore, reference-catalogues. Remove `explore`. Uses referenceCatalogueTabs.tsx CATALOGUE_TABS.
- referenceCatalogueTabs.tsx: MmfFunds, BankInstruments, CbkSecuritiesReference, MarketAssetsReference. Add AllApprovedInstruments as first tab id "all-approved".
- RecentlyApproved.tsx catalogueHref builds /research?tab=reference-catalogues&cat=...&ref=... (already includes ref).
- AskAI.tsx: tabs ask/import/history. EnquiryPanel has showSource toggle with sourceUrl + sourceText only. Uses ExtractPanel + AiPrincipleBanner from AiIntake.tsx. FindingCard drafts via research.draftFromFinding.
- research.ask input currently {question, scope, sourceUrl?, sourceText?}. aiExtract/aiUploadDocument live under opportunities router. aiUploadDocument returns {fileKey, kind}.
- MmfFunds.tsx: hardcodes INDUSTRY_AVG_EAR=9.24, "27 CMA-regulated", Serrari copy, "21 Jun 2026". top5Ear + vsAvg computed from constant. Table cols: #, Fund, EAR, Gross, Fee, Min, AUM, As of, actions. Uses CatalogueRowControls keyed by fund.fundName. Direct trpc.mmfFunds.add/update/deactivate/selectFund.
- shared/navigation.ts AREA_TABS.research lists research-desk/explore/reference-catalogues → update.

## aiResearchService.ts changes DONE
- Added ResearchSource union + transcribeSourceToText() + extended runResearchQuestion({source?, sourceLabel?}) normalising legacy sourceUrl/sourceText into union. (build error to verify — likely invokeLLM content typing; used cast.)

## Preview URL
https://3000-i9gvidf9mb5f40ce07b9d-e22e5152.us1.manus.computer


## PROGRESS (as of phase 4)
- DONE: aiResearchService.ts ResearchSource union + transcribeSourceToText + runResearchQuestion({source,sourceLabel}). tsc clean.
- DONE: routers.ts research.ask input now accepts discriminated `source` (url/text/pdf-fileKey/image-fileKey) + sourceLabel; resolves fileKey→signed URL via storageGetSignedUrl. Imports ResearchSource type. tsc clean.
- DONE: client/src/pages/AskAI.tsx REWRITTEN — Import tab removed; Ask panel has unified "Add a specific source" Collapsible with 4 modes (url/text/pdf/image) using aiUploadDocument + fileToBase64; Enquiry History now secondary Collapsible collapsed by default. tsc clean.

## Review/desk UI facts (item 5)
- ResearchDesk.tsx review mutation onSuccess (≈295-329): toasts promotedRef; handles res.blocked (stays pending, warning). Need to add "published to {catalogueLabel}" + optional open-published-row link. Uses useSearchParams from wouter. Has promotionTargetForAssetClass + AssetClass. Each update `u` has u.assetClass.
- shared/researchPipeline: catalogueForAssetClass(assetClass)→ReferenceCatalogue; catalogueLabel(cat). CATALOGUE_TAB_ID map lives in RecentlyApproved.tsx: mmf→mmf-market, bank→bank-catalogue, cbk→cbk-securities, market_asset→market-assets.
- review mutation return shape: { update, promotedRef, target, blocked? }. target is PromotionTarget (mmf|bank|opportunity) NOT the 4-catalogue split; use catalogueForAssetClass(u.assetClass) for the tab.
- RecentlyApproved.tsx already builds catalogueHref(catalogue,targetRef)=/research?tab=reference-catalogues&cat=...&ref=... and renders "Open in {label}". Change label→"Open published row".

## Deep-link focus plan (item 6)
- Catalogue pages: MmfFunds.tsx, BankInstruments.tsx, CbkSecuritiesReference.tsx, MarketAssetsReference.tsx (in client/src/pages). Rendered via referenceCatalogueTabs.tsx inside ResearchArea reference-catalogues tab.
- Need shared hook useRefFocus(ref): reads ?ref= from URL (wouter useSearchParams), returns {focusRef, matchRow(name/ref)->bool, rowRef callback to scroll+highlight}. Add data-ref attr + ring highlight ~2.5s. Also prefill each page's search box with ref on mount.
- Create client/src/hooks/useRefFocus.ts (or lib). Highlight via a temporary className (ring-2 ring-primary animate). Respect prefers-reduced-motion.
