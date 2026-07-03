# Round 102 — Ask AI: Clean Research-Intake Desk

## Key Backend Changes

### 1. Follow-up extraction fix (server/aiResearchService.ts, line 913)
Current gate: `const canTryStructured = Boolean(grounding) && priorTurns.length === 0;`
Fix: Allow structured extraction on follow-ups when a NEW source is attached AND the intake mode is "extract":
```ts
const canTryStructured = Boolean(grounding) && groundingText.length > 100 &&
  (priorTurns.length === 0 || args.intakeMode === "extract");
```

### 2. Expose source classification to frontend
`tryInstrumentAwareExtraction` (line 1678-1704) already calls `classifySource` and returns `{ answer, findings, sourceClass }`.
Need to surface `sourceClass` in the task result so the frontend can show the detected-source panel.
The `processResearchTask` result already returns `findings` and `sourceStatus`; add `sourceClass` field.

### 3. Extraction target mapping
```
cbk_bond_prospectus / cbk_bond_reopening / cbk_tbill_auction / cbk_tbill_auction_result → "CBK Securities Reference"
mmf_factsheet / mmf_benchmark → "MMF Market"
bank_product_page / bank_rate_card → "Bank Product Catalogue"
market_asset_factsheet / market_asset_price → "Market Assets Reference"
unknown → null
```

## Key Frontend Changes

### 1. Intake mode selector (AskAI.tsx OpeningPanel, near line 1394)
Add a toggle/selector between "Ask / explain" and "Extract instrument facts" near the Focus field.
Pass `intakeMode` to `startResearchTask`.

### 2. Detected source-class panel
After task completes, show: "Detected: {SOURCE_CLASS_LABELS[sourceClass]} → will draft {extractionTarget} findings."
If unknown: "I could not confidently classify this source. Choose a focus or paste clearer source text."

### 3. InstrumentProfilePreview component
When `finding.extractedFields._extendedFields` exists, render grouped fields instead of flat list.
Groups defined per catalogue type (CBK: Identity/Return&Tax/Auction/Purchase/Liquidity/CashFlow/Source;
MMF: Identity/Return/Access/Operations/Composition/Source; Bank: Identity/Return/Access/Source;
Market: Identity/Price/Risk/Source).

### 4. Missing field display
Already partially done: `fmtFields` maps "missing_from_source" → "Missing from source" with amber styling.
Enhancement: Add explicit warning text below: "This field was not found in the source. You may fill it manually at approval if you can verify it."

## Shared types (shared/instrumentProfile.ts)
- SOURCE_CLASSES: mmf_factsheet, mmf_benchmark, bank_product_page, bank_rate_card, cbk_tbill_auction, cbk_tbill_auction_result, cbk_bond_prospectus, cbk_bond_reopening, market_asset_factsheet, market_asset_price, unknown
- SOURCE_CLASS_LABELS: human-readable labels
- Profile interfaces: CbkSecurityProfile, MmfProfile, BankInstrumentProfile, MarketAssetProfile
- MISSING_FROM_SOURCE = "missing_from_source"
- NEVER_INVENT_FIELDS: issueNumber, isin, couponRate, maturityDate, etc.

## Test fixtures needed
CBK bond PDF with 3 reopened FXDs: FXD1/2022/010, FXD1/2021/020, FXD1/2026/030
Fields: issue number, tenor, ISIN, coupon rate, WHT, maturity date, sale period, bid deadline, auction date, settlement date, amount, purpose, non-competitive/competitive bid amounts, pricing tables, accrued interest per KES 100, dirty price, coupon payment dates.

## startResearchTask input schema (server/routers.ts)
Need to add optional `intakeMode: "ask" | "extract"` field to the input.
