# Expansion Part 3 — "Model what I chose"

## Phase 1 — Audit
- [x] Actuals path = `otherHoldings` router (add/update/delete + income cascade) -> `other_holdings` table
- [x] Clock helper = `getNow(p)` (simulatedNow in sandbox, Date.now() in live)
- [x] Change History = `addAuditLog({entity, entityId, action, field, old/newValue, summary})`
- [x] Register = Other Assets page; add a "Modeled from Explore" provenance marker (notes + source)
- [x] Preview inputs = `buildAllocation` (net worth/allocation) + `decisionSurface` (end value+range, liquidity)
- [x] CTA stub = OpportunityDetail.tsx toast placeholder to replace with drawer
- [x] Mapping note: Part-1 AssetClass -> other_holdings enum; price-driven value is assumption-based (user return), not engine forecast

## Phase 2 — Backend
- [x] model-preview query: current plan vs plan-with-holding (no writes)
- [x] commit mutation writes through existing actuals path, tagged by assetClass + provenance
- [x] Change History entry with full provenance + user inputs
- [x] Respect Test/Live isolation (writes to active portfolio)

## Phase 3 — Drawer (inputs)
- [x] Drawer pre-filled with catalog facts as indicative; user owns all inputs
- [x] amount<->units derivation from (editable) price; entry date from clock
- [x] income rate editable (catalog as reference)
- [x] FX rate to KES for offshore (catalog feed + timestamp, editable)
- [x] catalog values marked "indicative"; mode obvious (Test/Live badge)

## Phase 4 — Preview + guardrails
- [x] live side-by-side: net worth, allocation share, liquidity, holding's own assumed scenario
- [x] framed "what this would do"; no advised/optimal amount
- [x] price-driven/FX value labeled assumption-dependent; engine band explicitly unchanged
- [x] Track in plan / Close actions

## Phase 5 — Register + lifecycle
- [x] Modeled holding appears in correct register section (Modeled-from-Explore badge)
- [x] edit (units/price/rate) via existing HoldingFormDialog
- [x] exit/disposal returns current value as cash; realised gain/loss net of optional user tax; not a penalty
- [x] delete with cascade discipline (delete cascades income records)

## Phase 6 — Tests + deliver
- [x] commit-through-actuals, preview math, mode isolation, exit gain/loss, no-advice invariants (18 new tests)
- [x] full suite + tsc clean; existing numbers unaffected (813/813 pass)
- [x] visual verification; checkpoint + deliver
