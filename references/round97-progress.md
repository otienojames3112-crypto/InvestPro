# Round 97 Progress Notes (Updated)

## Completed
- Phase 1: shared/instrumentProfile.ts — SourceClass enum, profiles, HoldingSnapshot, NEVER_INVENT_FIELDS
- Phase 2: DB migration — extendedFields JSON on mmf_funds/bank_instruments/opportunities; holdingSnapshot JSON on securities/bank_instrument_holdings/portfolio_secondary_mmfs
- Phase 3: Server procedures — holdingSnapshot built at holding creation (bankHoldings.add, secondaryMmfs.add); extendedFields surfaced in catalogue list queries
- Phase 4 (IN PROGRESS): Instrument-aware extraction engine

## Phase 4 Status — DONE (server-side)
- Added to aiResearchService.ts:
  - `classifySource()` — fast LLM call using first 6000 chars to detect SourceClass
  - Per-catalogue extraction schemas: CBK_BOND, CBK_TBILL, MMF, BANK, MARKET_ASSET
  - `runStructuredExtraction()` — runs the per-catalogue schema extraction
  - `structuredInstrumentToDraft()` — maps raw extracted objects to ResearchFindingDraft
  - `tryInstrumentAwareExtraction()` — public entry point
  - Integration hook in `runResearchQuestion()`: if grounding text exists and NOT a follow-up, tries structured extraction first; falls through to generic on failure
- Updated db.ts reviewResearchUpdate publish path:
  - All three branches (mmf/bank/opportunity) now persist `figuresIn._extendedFields` as the catalogue row's `extendedFields` JSON column

## Key Architecture Decisions
- The structured extraction produces ResearchFindingDraft[] with extractedFields as a flat string bag (same as generic)
- The _extendedFields key in the figures bag carries the full profile JSON for persistence at approval time
- The finding's extractedFields stores the flat key-value pairs; the full structured profile is in _extendedFields
- Multi-instrument splitting: one finding per bond/fund/product in the source
- MISSING_FROM_SOURCE sentinel ("missing_from_source") used for fields AI cannot find
- NEVER_INVENT_FIELDS enforced post-extraction

## Phase 4 — COMPLETE
- _extendedFields now injected into finding's extractedFields via structuredInstrumentToDraft
- Publish path parses _extendedFields (string or object) into catalogue row's extendedFields JSON

## Phase 5 — Client (COMPLETE)
- [x] fmtFields hides _extendedFields key, shows "Missing from source" in amber italic for sentinel values
- [x] FindingCard renders missing fields distinctly
- [x] Source class badge on FindingCard header (violet badge from SOURCE_CLASS_LABELS)
- [x] BankInstruments detail sheet: extendedFields rendered as "Full profile" grid
- [x] OpportunityDetail: extendedFields rendered as "Full instrument profile" card
- [x] BankHoldings: holdingSnapshot shown as "Terms at purchase" inline summary
- [x] bankHoldings.list now returns holdingSnapshot

## Phase 6 — Tests (NOT STARTED)
- Schema integrity
- Extraction round-trip (CBK prospectus → 3 findings with correct fields)
- Holding snapshot immutability
- Prompt discipline guards (no buy/sell/hold recommendations)
- NEVER_INVENT_FIELDS enforcement
- Source class detection accuracy

## Key File Locations
- shared/instrumentProfile.ts — type model
- server/aiResearchService.ts — extraction engine (lines 1040-1550 approx)
- server/db.ts — publish path (reviewResearchUpdate lines 2453-2810)
- server/routers.ts — executeResearchTask (line 1140-1185), findingsToRows (aiResearchService line 415)
- drizzle/schema.ts — researchFindings table has extractedFields JSON column
