# Part A — Model Integrity

## A1 — Inflation-adjust the goal (the liability)
- [x] Audit: inflation rate source = benchmark_inputs.inflation (6.68%), consumed by useBlendedYield/PortfolioReview
- [x] schema: add `inflationLinked` (boolean, default false) + `inflationOverrideRate` (nullable) to portfolios
- [x] migration generate + apply (applied directly via SQL; drizzle-kit generate blocked on unrelated account_status drift)
- [x] router: persist + expose inflationLinked/inflationOverrideRate on portfolios.get/list/update
- [x] thread nominalGoal + inflationRate through decisionSurface (inflation block + effectivePace)
- [x] pure helper for inflated goal + real-terms surplus (computeInflationAdjustedGoal in shared/decisionSurface.ts)
- [x] UI: settings toggle (default off) with editable inflation rate override
- [x] UI: "Goal today KES X · at goal date ≈ KES Y (Z% inflation)" in headline
- [x] UI: recompute on-track via effectivePace; express surplus in real (today's) terms
- [x] UI: when off, label goal "nominal (not inflation-adjusted)"

## A2 — Surface MMF uninsured status
- [x] Add parallel "mmf-uninsured" glossary entry next to kdic-insurance
- [x] MMF bucket: explicit uninsured note next to the money
- [x] end-state split card: caution when single MMF slice >issuer cap (reuse endStateLiquidSplit slices + effectiveIssuerCapFrac)

## A3 — Make base rate assumption explicit
- [x] headline/tooltip: "Assumes today's rates hold for the full horizon" on Projected figure

## Wrap-up
- [x] tests for inflated-goal + real-surplus pure fns (server/inflationGoal.test.ts, 5 tests)
- [x] full suite (763 pass) + tsc (clean)
- [x] screenshot verification
- [x] checkpoint + deliver
