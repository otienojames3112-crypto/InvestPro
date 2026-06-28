# Part 3 — Dashboard as a decision surface

## Discovery
- [ ] Locate rate-shock engine (Time Machine `rateShock`) entry points
- [ ] Locate contribution schedule (step-up amount/frequency, monthly contributions array)
- [ ] Locate step-up solver (Scenarios `solveForStepUp`)
- [ ] Locate milestone trajectory (projectedTotal / minHealthyCheckpoint)
- [ ] Locate net yield + real (after-inflation) yield computation (Portfolio Review)
- [ ] Locate end-state liquidity + latest-maturity data (Part 2 endStateSplit)

## Server
- [ ] projection range query → { base, low, high } (base rates, -2pp shock, missed-contributions)
- [ ] on-pace/behind status: engine vs target band + step-up recommendation to get back on pace
- [ ] contribution back-loading share: last-3-months / all contributions, threshold 35%
- [ ] goal-date liquidity: liquid spendable + %, latest security maturity + margin vs goal date

## Dashboard UI
- [ ] Headline shows base figure + explicit range (Projected ~X (range L–H))
- [ ] One reconciliation card: Projected (range) · Target · Status
- [ ] On-pace/Behind status with concrete step-up lever
- [ ] Net yield + real yield surfaced on front page (agree with fixed YTM)
- [ ] Back-loading caution banner (fires when share > 35%)
- [ ] Liquidity-on-goal-date headline fact + cushion margin line, warn if maturity near/after goal

## Verify
- [ ] New vitest specs for each server helper
- [ ] Full suite + tsc clean
- [ ] Visual check on Dashboard
- [ ] Checkpoint + deliver
