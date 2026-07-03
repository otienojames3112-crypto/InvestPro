# Round 100 — Progress Tracker

## Status: Phase 3 — Implementing engine changes

## Completed
- Phase 1: Audit complete
- Phase 2: todo.md updated with Round 100 items
- Phase 3: In progress — implementing engine changes

## Key Decisions
1. Add `issueNumber?: string | null` to both `SecurityLot` (line 204) and `ActualSecurity` (line 332)
2. Add `InstrumentEvent` type and `instrumentEvents: InstrumentEvent[]` + `secondaryMmfDetail: SecondaryMmfMonthDetail[]` to `MonthResult`
3. Add `lotLabel(lot)` helper that returns issueNumber if available, else tenorLabel
4. Upgrade secondaryState to include `label` field
5. Emit instrumentEvents at each cash flow point in the engine loop
6. Add liquidity-at-goal event on final month (m === horizonMonths)
7. Keep mainAction strings backward-compatible (same phrases, just with issue numbers when available)
8. The explainLedgerRow function stays as-is (it uses mainAction as headline) — we add instrumentEvents as a SEPARATE expandable detail section in the Ledger UI

## Files to Edit (engine.ts changes)
1. Line 204: Add `issueNumber?: string | null;` to SecurityLot
2. Line 332: Add `issueNumber?: string | null;` to ActualSecurity
3. After line 356 (MaturityBreakdown): Add InstrumentEvent and SecondaryMmfMonthDetail interfaces
4. Line 410: Add `instrumentEvents: InstrumentEvent[];` and `secondaryMmfDetail: SecondaryMmfMonthDetail[];` to MonthResult
5. After line 1104 (tenorLabel): Add `lotLabel` helper
6. Line 1214: Add `label` to secondaryState initialization
7. Line 1372-1383: Add `issueNumber` to lot creation from actual securities
8. Line 1391 (start of monthly loop): Add `const instrumentEvents: InstrumentEvent[] = [];` and `const secondaryMmfDetail: SecondaryMmfMonthDetail[] = [];`
9. Throughout the loop: Push events at each cash flow point
10. Line 2075-2101 (results.push): Add instrumentEvents and secondaryMmfDetail

## Files to Edit (routers.ts changes)
- Line 595-616 (mapActualSecurities): Add issueNumber extraction from holdingSnapshot

## Files to Edit (Ledger.tsx changes)
- After mainAction column (line 763): Add expandable instrumentEvents detail section

## Test Contracts to Preserve
- bankLedger.round35.test.ts: `mainAction` must contain "Placed KES 100,000", "NCBA", "fixed deposit"
- finalCouponAtMaturity.round60.test.ts: `mainAction` must contain "matures, returning", "principal", "final coupon", "net of 15% tax"
- discountLifecycle.round42.test.ts: Does NOT check mainAction (only checks cbkCashIn math)
- ledgerExplain.test.ts: headline must equal mainAction verbatim

## Narration Changes (backward-compatible)
- T-bill maturity: Replace `a 91-day T-bill matures` with `a 91-day T-bill (FXD/xxx) matures` when issueNumber available
- Bond coupon: Replace `an IFB pays` with `FXD1/2022/010 pays` when issueNumber available
- Bond maturity: Replace `a 24-month FXD matures` with `FXD1/2022/010 matures` when issueNumber available
- These are ADDITIVE — tests that check for "matures, returning" or "final coupon" still pass

## No-sweep and missed-contribution language
- Already handled by buildActualSavingClause for actuals: "No contribution recorded this month (KES X was planned)"
- Already handled by UNEXECUTED_SWEEP_NOTE for actuals: "no sweep this month — MMF balance below the sweep threshold after the missed contribution"
- For PROJECTED months when guard.allowed is false: the else branch at line 2057 says "Add this month's saving to the MMF; nothing swept into securities this month" — need to make this more specific about WHY (approaching goal date)

## Secondary MMF Detail
- secondaryState already has balance, monthlyContribution, ear, whtRate
- Need to add `label` from SecondaryMmfInput
- In the loop (line 1457-1471), track per-fund: deposit, grossInterest, wht, netInterest, endBalance
