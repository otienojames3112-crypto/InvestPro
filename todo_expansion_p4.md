# Expansion Brief Part 4 — Projection Engine Extension

## Phase 1 — Audit
- [x] Map the projection month grid + per-month valuation paths (MMF daily_accrual, T-bill/zero accretion_to_face, coupon par_plus_coupon)
- [x] Find the income sweep mechanism (coupons/maturities → liquid pot) to reuse for one income pipeline
- [x] Find scenario presets (base / rate-shock / up) and how the range endpoints are computed
- [x] Find the fund-from-liquid toggle handling (MMF reduction vs new money)
- [x] Confirm how other_holdings currently feed net worth/allocation but NOT runProjection
- [x] Locate BehaviorProfile.valuation field (shared/assetModel.ts) + taxFor (shared/assetTax.ts)

## Phase 2 — Valuation router
- [x] projectHoldingValue(holding, monthIndex, scenario) dispatched by BehaviorProfile.valuation
- [x] daily_accrual / accretion_to_face / par_plus_coupon delegate to existing fns UNCHANGED
- [x] market_price: units × projectedUnitPrice (× FX for offshore)
- [x] projectedUnitPrice (capital growth = total − income) + projectedFxRate (flat in base)
- [x] Regression guard: existing classes reproduce bit-for-bit

## Phase 3 — Income pipeline
- [x] Single income-event: gross → taxFor(assetClass, incomeType) → net
- [x] Net sweeps to liquid pot (default) or DRIP if user chose
- [x] Route existing coupon/interest flows through it unchanged (uniform "income received (net)")

## Phase 4 — Per-class mechanics
- [x] Equity: units×price, price grows at (total−income), dividends on schedule (cadence field, default annual), no auto-maturity
- [x] REIT: same machinery, distributions on schedule
- [x] Offshore: units × native-price × FX (flat base), income converted to KES net of sourced offshore tax
- [x] Long bonds: existing coupon cashflows + duration mark-to-model (−modDur × Δyield × cleanPrice) helpers for current/exit + rate-shock; HTM = par

## Phase 5 — Scenarios, funding, labels, tax
- [x] Compute & expose Conservative / Base / Optimistic per holding (base line uses Base) — all routed through projectHoldingToHorizon
- [x] Honor fund-from-liquid toggle (consume MMF + liquidity trade-off vs new money)
- [x] Every price-driven projected value flagged assumption-dependent ("your assumed return — not a forecast")
- [x] New tax rates sourced/editable with provenance (REIT/offshore requiresReview, user-editable WHT input)
- [x] ModelDrawer exposes income cadence + DRIP/sweep + editable WHT + capital-vs-income decomposition + priceFlat warning

## Phase 6 — Tests + deliver
- [x] Regression: existing-only numbers reproduced exactly (no-income equity = 259,374.25; gov/MMF/bank unchanged)
- [x] New per-class valuation tests (equity sweep/DRIP, REIT review flag, offshore FX-flat, income decomposition, cadence, no-advice invariants) — server/holdingValuation.test.ts, 18 tests
- [x] full suite + tsc clean (831 tests, tsc 0 errors); visual verification; checkpoint + deliver
