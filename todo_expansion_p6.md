# Expansion Part 6 — Risk, volatility, honest projections & final guardrails

Goal: make uncertainty first-class. Projections containing price-driven/FX assets become a
range with a likelihood; safe fixed-income-only plans (the car) stay tight and unchanged.

## Phase 1 — Audit (done)
- [x] Located dormant risk scaffold (`securities.expectedReturnPct/volatilityPct`), no `correlationGroup`
- [x] `other_holdings` is the committed store for modeled price-driven holdings (Part 5 structured fields)
- [x] decisionSurface router builds rate-only band via `buildProjectionRange`; no probability metric
- [x] `projectHoldingToHorizon` (Part 4) projects a single price-driven holding; reuse for risky-leg mean
- [x] Settings.tsx is the portfolio-level control surface; has warn/ack precedent (yield-first dialog)

## Phase 2 — Shared risk-model module (`shared/riskModel.ts`) (done)
- [x] Per-class default assumptions: expectedReturnPct, volatilityPct, correlationGroup (labeled assumptions)
- [x] Coarse correlation matrix between groups (KES-rates / KES-equity / offshore-equity / property / cash)
- [x] Portfolio mean/variance closed form over the risky sleeve
- [x] Compose core (deterministic, tight) + risky (volatile) legs into one end-value distribution
- [x] Percentile anchors (~P10/P50/P90) via lognormal
- [x] Goal probability from the distribution, capped (never 0%/100%)
- [x] Risk-tolerance bands + default assumptions + mismatch (stated vs modeled vol) gap

## Phase 3 — Persist editable risk inputs + optional portfolio risk tolerance (done)
- [x] Additive nullable columns on `other_holdings`: expectedReturnPct, volatilityPct, correlationGroup, riskSource, riskAsOf
- [x] Additive nullable column on `portfolios`: riskTolerance
- [x] Hand-authored migration 0009; applied via webdev_execute_sql
- [x] Extended otherHoldings add/update + portfolios.update payloads
- [x] db helpers accept new columns

## Phase 4 — Wire distribution + goal-probability into decision-surface (done)
- [x] decisionSurface loads risky positions, computes distribution + goalProbability
- [x] Reuses base as deterministic chunk; widens only when risky assets present
- [x] Returns uncertainty metadata (hasMaterialRisk, p10/p50/p90, probability, tolerance, volatileConcentration)

## Phase 5 — Honesty layer + tolerance capture + concentration brakes (done)
- [x] Dashboard: band + "most likely X, range Y–Z (~80%)" + goal probability + caveats
- [x] ModelDrawer: price-volatility caveat (±vol, +FX) tied to per-class assumption
- [x] Scenarios: fixed-income-scope note pointing to the Dashboard probability range
- [x] Settings: optional risk-tolerance selector (plain language), warn-on-mismatch on Dashboard, never auto-allocate
- [x] Risk-aware concentration brake: flag (not block) over-concentration in a volatile name
- [x] Editable per-asset risk assumptions in the holding form + surfaced with "assumed/your own" tags

## Phase 6 — Tests + verify (done)
- [x] riskModel unit tests: mean/variance, lognormal percentiles, probability cap, fixed-income-only collapse (19 tests)
- [x] tolerance mismatch warning test
- [x] regulatory invariants: no ranking/recommend/auto-select language in risk outputs
- [x] full suite + tsc clean (864 passing, tsc clean)
- [x] visual check (Settings + Other Assets render)
- [x] checkpoint & deliver
