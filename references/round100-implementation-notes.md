# Round 100 — Plain-Language Instrument-Specific Ledger

## Current Architecture

### Engine (server/engine.ts, 2605 lines)
- `runProjection()` returns `MonthResult[]` directly to the client via `projection.run` tRPC query
- `MonthResult` interface (line 358): monthNumber, contribution, cbkCashIn, mmfToDhow, mainAction (string), mmfEnd, mmfInterestNet, tbill91End/182End/364End, ifbEnd, fxdEnd, totalEnd, secondaryMmfEnd, bankEnd, bankCashIn, phase, sweepTarget, whtThisMonth, isActual, offPlan, isShortHorizon, sweepRationale, maturityBreakdown[]
- `MaturityBreakdown` (line 339): kind (tbill|ifb|fxd|bank), label, principal, finalCoupon, discount, interest, total, taxNote
- `SecurityLot` (line 182): id, bucket, faceValue, issueMonth, tenorMonths, couponRate, isTaxExempt, purchasePrice?, isZeroCoupon?

### Main Action Generation (lines 1972-2068)
- Builds `cbkActions[]`, `bankMaturityActions[]`, `bankPlacementActions[]` as plain-language strings
- T-bill maturity (line 1594): "a 91-day T-bill matures at its KES X face value, returning KES Y to the MMF (KES Z net discount earned after 15% tax on the discount)"
- Coupon bond maturity (line 1649): "a 24-month FXD matures, returning KES X principal + KES Y final coupon (net of 15% tax) = KES Z to the MMF"
- Periodic coupon (line 1670/1675): "an IFB pays a KES X coupon into the MMF (tax-exempt)" / "an FXD bond pays a KES X coupon into the MMF (after 15% tax)"
- Bank placement (line 1508): "Placed KES X in NCBA fixed deposit at 10.5%, maturing Jan 2027"
- Bank maturity (line 1549): "a NCBA fixed deposit matured, returning KES X to the MMF (KES Y principal + KES Z net interest)"
- Bank rollover (line 1538): "a fixed deposit matured and auto-rolled over KES X into a fresh 6-month term at 10.5%"
- Sweep (line 1998): "Move KES X from the MMF into a 182-day T-bill (KES Y face) maturing May 2027"
- Settled actual month (line 2012-2049): uses buildActualSavingClause, UNEXECUTED_SWEEP_NOTE

### Ledger Explain (shared/ledgerExplain.ts, 188 lines)
- `explainLedgerRow(row: LedgerExplainRow)` → `LedgerExplanation` with headline, lede, lines[], closing
- Currently generic: "From CBK securities", "From a bank deposit" — NOT instrument-specific
- This is the click-to-expand popover content

### Ledger UI (client/src/pages/Ledger.tsx, 981 lines)
- Uses `trpc.projection.run.useQuery()` → renders MonthResult[] directly
- Main Action column (line 669): truncated mainAction text with popover (explainLedgerRow) and AI explain
- CBK Cash In column (line 600): shows amount with maturityBreakdown tooltip
- Bank Cash In column (line 658): just the amount, no breakdown tooltip

### What Needs to Change

1. **Engine mainAction** — already instrument-specific for most cases. Needs:
   - Issue number in T-bill/bond labels when available (SecurityLot doesn't have it currently)
   - "No contribution recorded this month. KES X was planned." for missed actuals
   - "No sweep this month because the MMF balance stayed below the sweep threshold."
   - Per-MMF interest detail when multiple MMFs exist

2. **SecurityLot** — add optional `issueNumber?: string` field for real lots seeded from actual securities

3. **MonthResult** — add new fields:
   - `instrumentEvents: InstrumentEvent[]` — structured per-instrument cash flow events
   - `secondaryMmfDetail?: SecondaryMmfMonthDetail[]` — per-fund breakdown

4. **InstrumentEvent** type (new):
   - kind: "tbill_purchase" | "tbill_maturity" | "bond_coupon" | "bond_maturity" | "bank_placement" | "bank_maturity" | "bank_rollover" | "bank_accrual" | "mmf_interest" | "mmf_deposit" | "contribution" | "missed_contribution" | "no_sweep"
   - description: string (plain language)
   - amount: number
   - instrument: string (e.g. "91-day T-bill", "FXD1/2022/010")
   - details: Record<string, string|number> (structured fields like issueNumber, couponRate, whtAmount, etc.)

5. **Ledger UI** — render instrumentEvents as expandable detail rows below each month

6. **Liquidity-at-goal** — engine guard already exists (line 2054: "kept in the MMF (no instrument matures before your goal date)"). Need to:
   - Add explicit explanation when final month shows liquid
   - Prevent new instrument purchases that would mature after goal date (already done via guard)
   - Show warning if any holding is locked past goal date

### mapActualSecurities function
- Located in server/routers.ts — maps DB security rows to SecurityLot[]
- Need to check if it passes issueNumber through

### Key Constraint
- The engine is PURE — no DB access inside runProjection
- All data must be passed in via parameters
- SecurityLot is the input type for actual securities
