# Part 7.0 — Three corrections before 7.1

## Phase 1 — Audit
- [x] Confirm how the headline projection treats committed price-driven holdings (runProjection ignores other_holdings entirely — contributes ZERO to base, not even flat) vs preview (projectHoldingToHorizon growth)
- [x] Locate decisionSurface / dashboard headline source for net worth + projection (server decisionSurface builds risk.distribution + probability; Dashboard line ~1089 headline shows range.base which excludes committed market holding)
- [x] Confirm goalProbability is computed but only shown in preview, not on committed dashboard (Dashboard DOES show a risk block at ~1172 when hasMaterialRisk, but the prominent headline ignores it)
- [x] Inspect assetTax.ts REIT/offshore rates + provenance pattern (done: both 0, requiresReview)
- [x] Locate Explore "Information only" control and confirm interactivity (passive Badge, no onClick/state; disclaimer card non-dismissible)

## Phase 2 — 7.0.b sourced tax rates
- [x] Research current Kenyan REIT distribution WHT + offshore income treatment (authoritative source: NSE, TripleOKlaw 2023, ITA s.20)
- [x] Replace reitDistribution:0 / offshoreDistribution:0 with sourced values + provenance (REIT 5% sourced+review; offshore 15% unverified)
- [x] If a rate cannot be confirmed, keep field flagged `unverified` (NOT silent zero) — offshore flagged unverified
- [x] Make rates editable assumptions in UI, surfaced with provenance (ModelDrawer WHT field + banner distinguishes sourced-review vs unverified; Tax Summary shows Unverified badge)
- [x] Acceptance: no income type taxes at an unsourced zero (unverified flag threaded through taxFor → IncomeEvent → projectHoldingToHorizon → preview → UI)

## Phase 3 — 7.0.a committed market band on dashboard
- [x] Headline for plans with price-driven holdings: most-likely X + ~80% range Y–Z via buildEndValueDistribution (Dashboard headline branches on decision.risk.hasMaterialRisk)
- [x] Surface goalProbability on the committed dashboard (probability shown in headline risk card)
- [x] Keep deterministic engine flat for contractual assets (band comes from risk.distribution; runProjection still ignores other_holdings — equities NOT grown deterministically)
- [x] Acceptance: committed equity → most-likely + range + goal-prob; fixed-income-only car plan UNCHANGED (else-branch keeps byte-for-byte range.base)

## Phase 4 — 7.0.c Explore control
- [x] Verify "Information only" is a passive label/tooltip, not a toggle (Explore + OpportunityDetail both use a static outline Badge, no handlers)
- [x] Ensure no interaction can flip the catalog into ranking/recommending (no state, header copy states nothing is ranked/scored/recommended)
- [x] Repair if it is interactive (no repair needed — already passive)

## Phase 5 — Tests + verify
- [x] Tax tests: REIT 5% sourced (review, not unverified); offshore 15% unverified; user rate overrides + clears flag; user 0% honored as confirmed (not silent zero); existing interest/coupon/discount/dividend unchanged (server/part70.test.ts, 10 tests)
- [x] Updated 2 stale Part-4 assertions in holdingValuation.test.ts that expected the OLD placeholder 0% for REIT (now sourced 5%, net 950)
- [x] Band headline / goal-probability: covered by existing Part-6 riskModel tests (distribution + goalProbability cap); the fixed-income-only collapse is the UI else-branch keeping range.base (visually verified unchanged at KES 5.01M / 4.68M–5.19M)
- [x] Full suite + tsc clean (874 passing, tsc 0 errors)
- [x] Visual check (Dashboard fixed-income band unchanged; Explore "Information only" passive + non-dismissible disclaimer)
- [x] Checkpoint & deliver
