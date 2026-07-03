# Round 98 — Key Context for Comparison Proposals

## Architecture Decision

The existing pipeline already supports everything needed for comparison proposals:

1. **research_findings** carries: `extractedFields` (JSON), `warnings`, `missingFields`, `confidence`, `sourceLabel`, `sourceUrl`, `sourceAsOf`, `targetCatalogue`, `status` (new/drafted/dismissed/superseded)
2. **research_updates** carries: `changeKind` (create/edit), `figures` (JSON), `field`, `oldValue`, `managerValue`, `source`, `sourceUrl`, `asOf`, `target`, `targetRef`, `findingId`
3. **draftFromFinding** mutation: maps a finding into a pending update with optional manager edits to targetRef/changeKind/name/assetClass/issuer/currency/figures/field

### Strategy: Encode comparison metadata in extractedFields

Rather than adding new schema columns, I'll encode the comparison metadata INSIDE the finding's `extractedFields` JSON:

```typescript
extractedFields: {
  // Normal figures
  ear: "13.00",
  grossYield: "14.50",
  // Comparison metadata (prefixed with _)
  _proposalType: "update" | "create" | "stale",
  _currentValues: { ear: "12.00", grossYield: "13.50" },
  _changedFields: ["ear", "grossYield"],
  _impactNote: "Updating the selected primary MMF rate affects future projections from the effective date.",
  _confidence: "high",
  _targetRef: "mmf:cytonn-money-market-fund",  // for dedup/update matching
  _extendedFields: "..." // already used by Round 97
}
```

The `_` prefix convention is already established by `_extendedFields` from Round 97.

### Key functions to modify:

1. **catalogueReviewInstruction()** — already has per-catalogue prompts; upgrade to request explicit current→proposed comparison output
2. **buildCatalogueReviewQuestion()** — already builds the snapshot; keep as-is
3. **RESEARCH_SCHEMA** — the generic schema; for review tasks we already use structured extraction which has its own schema
4. **structuredInstrumentToDraft()** — already builds findings from structured extraction; add comparison metadata injection
5. **tryInstrumentAwareExtraction()** — already classifies and extracts; add comparison mode when snapshot is available

### New approach: Comparison-aware extraction

For catalogue reviews (kind:"review"), the process is:
1. `processResearchTask` already rebuilds the question with `catalogueSnapshot(cat)` 
2. The question already includes CURRENT CATALOGUE ROWS
3. The LLM already compares source vs current rows
4. Currently the generic RESEARCH_SCHEMA output doesn't carry current values

**Fix:** When `tryInstrumentAwareExtraction` is called for a review task, pass the current snapshot so it can:
- Match extracted instruments to existing rows (by name/issueNumber/ref)
- Inject `_currentValues` for changed fields
- Set `_proposalType` to create/update/stale
- Generate `_impactNote`

### Client rendering:

The `FindingCard` in AskAI.tsx already renders extractedFields. I'll add:
- A "Proposal type" badge (Create / Update / Stale)
- A current→proposed diff table for update proposals
- Impact note display
- Confidence/warning display (already exists)

### CBK issue-number dedup:

For CBK reviews, match by `issueNumber` field. If an existing row has the same issue number, propose an update (not create). The snapshot already includes issue numbers for CBK rows (via `summariseCatalogueRows`).

### Stale detection:

When a comprehensive source (e.g., full Serrari benchmark) does NOT mention a fund that exists in the catalogue, the AI should emit a "stale" proposal. This is already partially handled by the instruction ("emit an edit finding naming it and flag a possible STALE row").

### Flow (unchanged):
Source → AI comparison → findings (with _proposalType/_currentValues) → FindingCard shows diff → "Draft into queue" → research_updates (with field/oldValue from _currentValues) → Approve → catalogue update → audit log
