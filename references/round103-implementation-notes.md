# Round 103 Implementation Notes

## Current Architecture (pre-fix)

### Extraction Gate (aiResearchService.ts line 925)
```ts
const canTryStructured = Boolean(grounding) && (priorTurns.length === 0 || args.intakeMode === "extract");
```
- Only runs structured extraction when: grounding exists AND (first turn OR intakeMode is "extract")
- Problem: follow-ups with reused source don't trigger extraction unless frontend explicitly sets "extract"

### runResearchQuestion args (line ~860)
```ts
args: {
  question: string;
  scope: ResearchScope;
  priorMessages: { role: string; content: string }[];
  priorFindings: PriorFindingContext[];
  grounding: string; // the source text prepended to the user message
  sourceKind: SourceKind | null;
  provenanceLabel: string | null;
  provenanceUrl: string | null;
  intakeMode?: "ask" | "extract" | null;
}
```

### ResearchAnswer (line 108-114)
```ts
interface ResearchAnswer {
  answer: string;
  findings: ResearchFindingDraft[];
  model: string | null;
  sourceClass?: SourceClass | null;
}
```

### tryInstrumentAwareExtraction (line 1704-1731)
- Classifies source → runs structured extraction → maps to ResearchFindingDraft[]
- Returns null if source is "unknown"
- No limit on instruments array (LLM decides how many to return)

### structuredInstrumentToDraft (line 1547-1693)
- Converts raw extracted object to ResearchFindingDraft
- Builds extractedFields with _extendedFields JSON
- Field names come directly from LLM schema (effectiveAnnualRate, minimumInvestment, etc.)
- NO normalization to catalogue canonical keys (ear, minInvestment, etc.)

### routers.ts research flow
- startResearchTask: creates task, inserts user message (WITHOUT taskId), calls processResearchTask
- processResearchTask: rebuilds priorMessages from thread, calls executeResearchTask
- executeResearchTask: reads source, builds grounding, calls runResearchQuestion
- The user message is inserted at line ~8560 without taskId field

### Frontend AskAI.tsx Conversation (line ~1094-1286)
- effectiveIntakeMode = source ? "extract" : intakeMode (only forces extract for NEW source)
- Does NOT display detectedSourceClass after follow-ups
- Does NOT show zero-findings diagnostic

## Changes Needed

1. **shouldForceExtraction helper** — server-side intent detection from question text
2. **Wire into extraction gate** — canTryStructured uses shouldForceExtraction OR intakeMode
3. **Fix taskId tagging** — insert user message with taskId in startResearchTask
4. **Field normalization** — map extraction schema names to catalogue canonical names
5. **Zero-findings diagnostic** — return reason when extraction expected but produced nothing
6. **Bulk MMF limit** — extraction prompt already says "one entry per fund"; just need to ensure no artificial cap
7. **Source-class display for follow-ups** — Conversation component stores and shows sourceClass
8. **Unsourced finding restriction** — findings without source get lower trust, not one-click draftable

## Field Normalization Map

### MMF (extraction schema → catalogue canonical)
- effectiveAnnualRate → ear
- minimumInvestment → minInvestment
- aum → aumMillions
- fundManager → issuer (already handled in structuredInstrumentToDraft)

### Bank (extraction schema → catalogue canonical)
- minimumAmount → minAmount
- negotiable → isNegotiable

### CBK
- couponRate → coupon (but keep couponRate too for profile)
- withholdingTaxRate → whtRate

### Market Assets
- marketPrice → lastPrice (or keep both)
