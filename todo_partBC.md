# Part B & C TODO — Status/communication honesty + Layout/tone

## Audit
- [x] back-loading: decision.backloading.{share,isBackloaded,finalWindowMonthly}; threshold 0.35
- [x] On-track logic: Dashboard headline uses effectivePace/paceStatus + onTrack
- [x] return-share: sum MonthResult.contribution; no separate starting principal -> X=(base-totalContrib)/base, computed server-side
- [ ] find Posture & Exceptions band + the "N to review" count + maturity exception
- [ ] find unrealized-gain card + interest-earned (accrued) figure
- [ ] find "Foundation Phase" badge + persistent strip chrome

## B1 — On track conditional on contributions
- [x] when materially back-loaded: status "On track — if you sustain your contribution plan"
- [x] Next line: "Nothing today — on track, provided you keep to your contribution schedule"
- [x] when contributions largely complete: plain "On track"

## B2 — Savings-led framing
- [x] framing line + tooltip with principal/return breakdown
- [x] X computed server-side via computeSavingsLedSplit; startingPrincipal=0 to avoid double-counting actuals

## B3 — Action vs awareness exceptions
- [x] split band into "Needs your action" / "For your awareness"
- [x] self-correcting/acknowledged items -> awareness, excluded from review count
- [x] review count = action items only
- [x] maturity disposition: "auto-reinvested by the engine — nothing to do" (Test) vs "action needed" (Live)

## C1 — Reframe unrealized gain
- [x] tile leads with "Interest Earned So Far" (reuses v.unrealizedGain = accreted+accrued)
- [x] cost-basis / unrealized-gain framing demoted to detail sub-line + tooltip

## C2 — Plain-language chrome
- [x] phase badge -> plain label ("Building your base") with technical phase name + meaning in tooltip
- [x] helpers getPhasePlainLabel/getPhasePlainHint added in format.ts (reuse getPhaseName)

## Wrap-up
- [x] tests for return-share pure fn (6 tests, computeSavingsLedSplit)
- [x] full suite 769 passed + tsc clean
- [x] screenshot verification
- [x] checkpoint + deliver
