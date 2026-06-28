# Part A — Model Integrity

## A1 — Inflation-adjust the goal (the liability)
- [ ] Audit: find inflation rate source already on Dashboard (real-yield line)
- [ ] schema: add `inflationLinked` (boolean, default false) + `inflationOverrideRate` (nullable) to portfolios
- [ ] migration generate + apply
- [ ] engine/router: compute nominalGoal = targetAmount * (1+rate)^horizonYears when linked
- [ ] thread nominalGoal + inflationRate through decisionSurface / summary / milestones
- [ ] pure helper for inflated goal + real-terms surplus (testable)
- [ ] UI: settings toggle (default off) with editable inflation rate
- [ ] UI: "Goal today KES X · at goal date ≈ KES Y (Z% inflation)"
- [ ] UI: recompute surplus/on-track against inflated goal; express surplus in real terms
- [ ] UI: when off, label goal "nominal (not inflation-adjusted)"

## A2 — Surface MMF uninsured status
- [ ] Add parallel "mmf-uninsured" glossary entry next to kdic-insurance
- [ ] per-issuer/concentration section + MMF bucket: explicit uninsured note
- [ ] end-state split card: caution when >issuer cap (or >40%) in single uninsured MMF (reuse splitEndStateBuckets / endStateLiquidSplit)

## A3 — Make base rate assumption explicit
- [ ] headline/tooltip: "Assumes current rates hold for the full horizon"
- [ ] (optional, low-effort) rates-ease central toggle

## Wrap-up
- [ ] tests for inflated-goal + real-surplus pure fns
- [ ] full suite + tsc
- [ ] screenshot verification
- [ ] checkpoint + deliver
