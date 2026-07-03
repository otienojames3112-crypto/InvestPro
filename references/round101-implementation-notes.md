# Round 101 — Parts 6, 7, 8 Implementation Notes

## Existing Infrastructure

### aiExplainService.ts
- `ExplainKind` type: `"reconciliation_mismatch" | "ledger_month" | "dashboard_status"`
- `EXPLAIN_GUARDRAILS` constant: shared guardrail text for all explain prompts
- `SYSTEM_BY_KIND` record: maps ExplainKind to system prompt
- `buildExplainPrompt(kind, title, facts)`: builds user prompt
- `explain({ kind, title, facts, model? })`: calls invokeLLM and returns `{ answer, model }`

### Existing aiExplain router (server/routers.ts line 4494)
- `aiExplain.reconciliationMismatch` — already wired to Reconciliation page
- `aiExplain.ledgerMonth` — already wired to Ledger page  
- `aiExplain.dashboardStatus` — already wired to Dashboard page

### Existing UI components
- `AiExplainDialog` component at `client/src/components/AiExplainDialog.tsx`
- Already used in Dashboard, Ledger, and Reconciliation pages

### Pages that NEED explainers added (Part 6):
- Holdings (Securities register, Bank holdings, MMF accounts, Market assets)
- Reference Catalogues (MMF Market, Bank Products, CBK Securities, Market Assets)
- Accrual / Tax Summary
- Scenarios / Allocation

### Part 7: Page-specific system prompts to add
1. Research prompt (for Reference Catalogues)
2. Dashboard prompt (already exists)
3. Ledger prompt (already exists)
4. Accrual prompt (new)
5. Reconciliation prompt (already exists)
6. Holdings prompt (new)
7. Scenario / Allocation prompt (new)

### Part 8: Glossary expansion
- Need to expand the Getting Started / glossary page with ~90 terms
- Check if a glossary page already exists

## Implementation Plan

### Step 1: Expand ExplainKind and SYSTEM_BY_KIND
Add new kinds: "holdings", "accrual_tax", "reference_catalogue", "scenario_allocation"

### Step 2: Add new aiExplain procedures
- `aiExplain.holdings` — receives holding details
- `aiExplain.accrualTax` — receives accrual/tax summary
- `aiExplain.referenceCatalogue` — receives catalogue context
- `aiExplain.scenarioAllocation` — receives scenario context

### Step 3: Add AiExplainDialog to remaining pages
- Holdings pages (all sub-pages)
- Reference Catalogue pages
- Accrual page
- Tax Summary page
- Scenarios page

### Step 4: Glossary/Getting Started
- Check existing glossary page location
- Expand with all ~90 terms organized by category
