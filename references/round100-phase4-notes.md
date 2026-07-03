# Round 100 Phase 4 — Ledger UI Upgrade Notes

## Current State
- Engine changes DONE: instrumentEvents[] and secondaryMmfDetail[] are emitted
- tsc is clean
- All instrument events are emitted: contribution, missed_contribution, mmf_interest, mmf_deposit, tbill_purchase, tbill_maturity, bond_coupon, bond_maturity, bank_placement, bank_maturity, no_sweep, liquidity_at_goal
- lotLabel() uses issueNumber when available

## Ledger.tsx Structure (981 lines)
- Line 669: mainAction rendered as truncated span
- Line 671-708: Popover with explainLedgerRow(r) showing lede + lines + closing
- Line 710-720: AI explain button (Sparkles icon)
- Line 722-760: Sweep rationale tooltip (Info icon)
- Line 764-800: MMF End column with liquid split tooltip
- Line 830-840: FXD End, Bank End columns
- Line 840-853: Total End column with Actual/Projected badge
- Line 854-862: Phase badge column

## What to add for Phase 4
1. Add an "Events" expandable section INSIDE the existing popover (explainLedgerRow popover)
   - After the closing paragraph, show instrumentEvents as a list
   - Each event: icon + description + amount badge
2. For secondary MMF: add a tooltip on the MMF End that shows per-fund detail
   - Already have secondaryMmfDetail[] in the MonthResult
3. The mainAction text is already upgraded with issue numbers from the engine

## Key Types
- InstrumentEvent: { kind, description, amount, instrument, details? }
- SecondaryMmfMonthDetail: { label, deposit, grossInterest, wht, netInterest, endBalance }
- MonthResult already has: instrumentEvents, secondaryMmfDetail

## Approach
- Add instrumentEvents rendering inside the existing PopoverContent (after ex.closing)
- Add secondaryMmfDetail tooltip on the MMF End column when detail exists
- Keep it lightweight — just list the events with their descriptions
