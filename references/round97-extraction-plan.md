# Round 97 — Instrument-Aware Extraction Plan

## Current Pipeline (aiResearchService.ts)
1. `readSource()` (lines 598-695) — reads URL/text/PDF/image into grounding text
2. `runResearchQuestion()` (lines 750-987) — sends ONE LLM call with RESEARCH_SYSTEM_PROMPT + RESEARCH_SCHEMA
3. `parseResearchResponse()` → `normaliseFinding()` → provenance fallback → sourceKind stamp → duplicate suppression
4. Returns `ResearchAnswer { answer, findings[], model }`

## What to Add (Phase 4)

### A. Source-Class Detection
After `readSource()` succeeds (ok:true), add a FAST classification step:
- Call LLM with a short prompt: "Classify this source text into one of: [SOURCE_CLASSES list]"
- Use structured output (json_schema) with a single `sourceClass` field
- Store the detected class on the task (new column or in the findings' extractedFields)
- If "unknown" → proceed with the generic RESEARCH_SCHEMA (current behavior)
- If classified → use the per-catalogue STRUCTURED extraction schema

### B. Per-Catalogue Extraction Schemas
For classified sources, replace the generic RESEARCH_SCHEMA with a catalogue-specific one:

**CBK Bond Prospectus** (most complex):
- Schema asks for an array of bonds (multi-instrument)
- Each bond has ALL CbkSecurityProfile fields as extraction targets
- Fields not found → "missing_from_source" sentinel
- NEVER_INVENT_FIELDS enforcement in the prompt

**MMF Factsheet/Benchmark**:
- Schema asks for an array of funds
- Each fund has MmfProfile fields

**Bank Product Page/Rate Card**:
- Schema asks for an array of products
- Each product has BankInstrumentProfile fields

**Market Asset**:
- Schema asks for an array of assets
- Each asset has MarketAssetProfile fields

### C. Multi-Instrument Splitting
The structured extraction returns an ARRAY of instruments.
Each becomes ONE ResearchFindingDraft with:
- `extractedFields` populated from the profile fields (flattened to string values)
- `instrumentName` from the profile's name/issueNumber
- Shared auction-level fields (auctionDate, salePeriod) copied to each if not per-bond

### D. Missing-Field Handling
- Prompt instructs: "If you cannot find a field in the source, set it to 'missing_from_source'"
- Post-processing: for NEVER_INVENT_FIELDS, if the model returned null/empty → force to MISSING_FROM_SOURCE
- The finding's `missingFields` array lists fields that are MISSING_FROM_SOURCE
- The UI shows these as amber "Missing from source" badges

### E. Prompt Discipline
Already enforced by RESEARCH_SYSTEM_PROMPT. Additional per-extraction prompt:
- "Extract ONLY what is printed. Do not invent issue numbers, coupon rates, maturity dates, WHT, clean prices, accrued interest, or auction dates."
- "Do not recommend buying. Do not say this is the best instrument."

## Implementation Strategy
1. Add `classifySource()` function — fast LLM call with tiny schema
2. Add `STRUCTURED_EXTRACTION_SCHEMAS` — per-catalogue JSON schemas
3. Add `runStructuredExtraction()` — uses the classified schema
4. Modify `runResearchQuestion()` to:
   - After grounding text is ready, call classifySource()
   - If classified to a known catalogue, call runStructuredExtraction() instead of the generic path
   - Map structured results back to ResearchFindingDraft[] (same output shape)
5. The rest of the pipeline (provenance fallback, kind stamp, dedup) stays unchanged

## Key Files
- shared/instrumentProfile.ts — SourceClass enum, profile types, NEVER_INVENT_FIELDS, CBK_BOND_REQUIRED_FIELDS
- server/aiResearchService.ts — main extraction engine
- server/routers.ts — processResearchTask calls runResearchQuestion
