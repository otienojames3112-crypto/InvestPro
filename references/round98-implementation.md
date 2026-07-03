# Round 98 — Implementation Plan (Full Context)

## What needs to change

### 1. Server: Comparison-aware extraction (aiResearchService.ts)

The existing `tryInstrumentAwareExtraction` (line 1620) already classifies + extracts.
For catalogue reviews, the question already includes the current rows (via `buildCatalogueReviewQuestion`).

**Key insight:** The LLM already sees current rows in the question. I need to:
1. Upgrade the extraction schemas to output comparison metadata per instrument
2. Inject `_proposalType`, `_currentValues`, `_changedFields`, `_impactNote` into extractedFields

**Approach:** Add a new `COMPARISON_SCHEMA` variant for each catalogue that adds:
- `proposalType`: "create" | "update" | "stale"
- `currentValues`: { key: oldValue } for changed fields
- `changedFields`: string[] of keys that differ
- `impactNote`: string

Actually simpler: modify `structuredInstrumentToDraft` (line 1497) to accept an optional `currentRows` parameter. After extraction, do a post-processing diff:
- Match extracted instrument to current rows by name/issueNumber/ref
- If matched: proposalType="update", compute changedFields, inject _currentValues
- If not matched: proposalType="create"
- For stale: the LLM already flags these in warnings; enhance to emit explicit stale findings

**Even simpler:** The LLM already compares (the instruction says "Compare each against CURRENT CATALOGUE ROWS"). The issue is just that the OUTPUT doesn't carry the comparison metadata. Fix: add comparison fields to the extraction schemas.

### 2. Extraction schema changes

Add to each extraction schema's per-instrument object:
```json
"proposalType": { "type": "string", "enum": ["create", "update", "stale"] },
"matchedCurrentRow": { "type": ["string", "null"], "description": "Name of the current catalogue row this matches, or null for new" },
"changedFields": { "type": "array", "items": { "type": "string" } },
"currentValues": { "type": "object", "additionalProperties": { "type": ["string", "null"] } }
```

But strict JSON schemas don't allow additionalProperties with typed values easily. Instead:
```json
"currentValues": { "type": "array", "items": { "type": "object", "properties": { "field": {"type":"string"}, "value": {"type":"string"} }, "required": ["field","value"], "additionalProperties": false } }
```

### 3. Post-extraction injection into extractedFields

In `structuredInstrumentToDraft`, after building `figures`, inject:
- `_proposalType`: from raw.proposalType
- `_currentValues`: JSON.stringify(raw.currentValues) 
- `_changedFields`: JSON.stringify(raw.changedFields)
- `_impactNote`: from raw.impactNote or generate based on catalogue type

### 4. Client: FindingCard upgrade (AskAI.tsx)

In `FindingCard` (line 497), after the existing field rendering:
- Read `_proposalType` from extractedFields
- If "update": show a diff table (current → proposed) for each changed field
- If "create": show a "New instrument" badge
- If "stale": show a "Stale" warning badge
- Show `_impactNote` if present

### 5. draftFromFinding enhancement

When drafting a finding with `_proposalType: "update"`:
- Set `changeKind: "edit"` (not "create")
- Set `targetRef` from `_targetRef` or matched current row ref
- Set `oldValue` from `_currentValues` for the primary changed field

### 6. Key file locations

- Extraction schemas: aiResearchService.ts lines 1140-1356
- structuredInstrumentToDraft: aiResearchService.ts line 1497
- tryInstrumentAwareExtraction: aiResearchService.ts line 1620
- catalogueReviewInstruction: aiResearchService.ts line 458
- buildCatalogueReviewQuestion: aiResearchService.ts line 521
- FindingCard: AskAI.tsx line 497
- fmtFields: AskAI.tsx (filters _ prefixed keys)
- draftFromFinding: routers.ts line 8616
- CatalogueSourceReview result UI: CatalogueSourceReview.tsx line 244
- PendingQueue in ResearchDesk: ResearchDesk.tsx line 309

### 7. Impact notes per catalogue

- MMF: "Updating the selected primary MMF rate affects future projections from the effective date. It does not rewrite past actuals."
- Bank: "Updating this bank product rate affects future maturity projections. It does not change existing holding terms."
- CBK: "Updating this CBK security reference affects yield tracking. It does not change existing lot cost or coupon receipts."
- Market: "Updating this market asset price affects portfolio valuation from today. It does not rewrite historical NAV."

### 8. Stale detection

For comprehensive sources (full benchmark tables), the LLM should emit a finding with proposalType="stale" for any current row NOT mentioned in the source. The instruction already says "emit an edit finding naming it and flag a possible STALE row" — I'll formalize this as proposalType="stale".

### 9. CBK dedup by issue number

When the LLM extracts a CBK instrument, it should check if the issue number matches an existing row. The current rows snapshot already includes issue numbers (via summariseCatalogueRows for cbk which shows name + assetClass + yield + tenor). I need to ensure the CBK snapshot includes issue numbers for matching.

Actually looking at summariseCatalogueRows for cbk (line 507):
```
`${i + 1}. ${fmt(r.name)} (${fmt(r.assetClass)}) — yield ${fmt(r.yieldPct)}%, tenor ${fmt(r.tenorYears)}y; as-of ${fmt(r.dataAsOf)}; src ${fmt(r.dataSource)}`
```

The `r.name` for CBK rows IS the issue number (e.g., "FXD1/2022/010"). So matching by name already works for CBK dedup.

### 10. Execution order

1. Modify extraction schemas to add comparison output fields
2. Update catalogueReviewInstruction to explicitly request comparison output
3. Update structuredInstrumentToDraft to inject _proposalType/_currentValues/_changedFields/_impactNote
4. Update FindingCard to render comparison metadata (diff table, badges, impact note)
5. Update draftFromFinding to auto-set changeKind/targetRef/oldValue from comparison metadata
6. Write tests
7. Run full suite + checkpoint
