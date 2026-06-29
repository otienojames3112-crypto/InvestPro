# Expansion Brief Part 5 — Ledger / Dashboard / Reconciliation propagation

One number, shown many places, never recomputed differently. All values sourced
from the shared `holdingValue.ts` mark-to-model source (units×price×FX), which in
turn builds on the Part-4 BehaviorProfile model. Test/Live isolation + provenance
intact everywhere.

## Phase 1 — Audit seams
- [x] reconciliation.ts: confirmed otherAssetValues slot; router fed [] before (phantom gap) — now wired
- [x] actuals.ts buildAllocation: now values otherHoldings via shared source, not raw currentValue
- [x] other_holdings schema: added behaviorClass/units/unitPrice/currency/fxRateToKes/incomeRatePct/dataSource/dataAsOf
- [x] Dashboard projected buckets + allocation mix + liquid split logic reviewed
- [x] Month Ledger income-event concept reviewed (holding_income table)
- [x] Tax Summary / Daily Accrual / Portfolio Review / Scenarios entry points reviewed
- [x] Maturity calendar source (securities-only filter → price-driven already excluded)

## Phase 2 — Shared mark-to-model helper
- [x] holdingMarketValue(units, unitPrice, fxRateToKes) — the ONE valuation other surfaces call
- [x] isPriceDriven(assetClass) predicate via BehaviorProfile (market_price valuation)
- [x] valueHolding() returns normalized record: precise class, valueKes, markToModel flag, native ccy, provenance
- [x] Provenance carrier (dataSource + dataAsOf) flows with the value
- [x] Migration 0008 applied (8 additive nullable columns); commit path persists them

## Phase 3 — Reconciliation spine (keystone)
- [x] otherAssetValues fed with units×price×FX for price-driven; currentValue for the rest
- [x] reference + every full-portfolio source lifted by same other-assets total; proof still balances (KES 0.00)
- [x] Phantom-holding guard: reconcileHoldings() fails if valuedCount != heldCount or totals drift
- [x] portfolioReviewNetWorth no longer strips other-assets out of the proof

## Phase 4 — Live net worth & holdings-by-instrument
- [x] Live net worth includes market-priced holdings at units×price×FX (Dashboard strip + headline)
- [x] Price-driven portion labeled "Market value" with units×price×FX line — distinct from fixed income
- [x] Holdings-by-instrument grouped under precise Equities / REITs / Offshore labels (valueKes + share)
- [x] Offshore rows show native ccy + KES-equivalent with FX rate + as-of timestamp
- [x] Provenance/as-of footnote per card; "manual entry" copy softened for mark-to-model rows

## Phase 5 — Dashboard projected buckets, mix, split, maturity calendar
- [x] Live Net Worth strip folds in Equity/REIT/Offshore buckets + headline total
- [x] No-maturity assets (equity/REIT/offshore) absent from maturity calendar (securities-only) — verified
- [x] End-state liquid split is core-fixed-income only by design (price-driven correctly excluded from issuer caps)
- Note: long bonds modeled via Part-4 duration mark; they live in opportunity modeling, not as a register maturity row

## Phase 6 — Posture honesty + concentration + insurance copy
- [x] Income yield (Benchmark Comparison) clarified as interest-bearing base ONLY; equities/REITs/offshore excluded
- [x] Capital-return posture + price/FX volatility + insurance note added under Dashboard net-worth strip
- [x] Never blend assumed equity return into the contractual net-yield number (wording + scope fixed)
- Note: issuer concentration caps remain a fixed-income-plan tool by design; single-equity concentration is surfaced via holding risk copy, not the gov issuer-cap engine

## Phase 7 — Ledger income events + analysis pages
- [x] ledger.incomeEvents procedure (portfolio-wide, joined to holding) + recorded-income panel in Month Ledger
- [x] Recorded income shown as a SEPARATE actual stream, never merged into projected core flows
- [x] Tax Summary: income addendum generalized to all price-driven classes, only when an income rate exists (never invented)
- [x] Daily Accrual: price-driven left OUT of the accrual engine by design (no fake daily-accrual line)
- [x] Portfolio Review: allocation rows already pick up new classes via shared buildAllocation

## Phase 8 — Tests + deliver
- [x] holdingValue.test.ts: mark-to-model, dual-currency, class-identity, fallback (no invented value)
- [x] Phantom-holding guard tests (pass/fail/tolerance/empty)
- [x] Bucket-by-instrument shares sum to 1
- [x] full suite 845 passing + tsc clean; visual verification on empty account; checkpoint + deliver
