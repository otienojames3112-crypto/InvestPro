# Round 100 — Engine Changes Implementation Plan

## 1. Add issueNumber to ActualSecurity and SecurityLot

### ActualSecurity (line 309 in engine.ts)
Add: `issueNumber?: string | null;`

### SecurityLot (line 182 in engine.ts)
Add: `issueNumber?: string | null;`

### mapActualSecurities (line 595 in routers.ts)
Extract issueNumber from `s.holdingSnapshot?.copiedTerms?.issueNumber?.value`:
```ts
issueNumber: (s.holdingSnapshot as any)?.copiedTerms?.issueNumber?.value ?? null,
```

### Lot creation (line 1372 in engine.ts)
Pass through: `...(sec.issueNumber ? { issueNumber: sec.issueNumber } : {}),`

## 2. Add InstrumentEvent type and instrumentEvents to MonthResult

### New type (after MaturityBreakdown, around line 356):
```ts
export interface InstrumentEvent {
  kind: "tbill_purchase" | "tbill_maturity" | "bond_coupon" | "bond_maturity" | "bank_placement" | "bank_maturity" | "bank_rollover" | "bank_accrual" | "mmf_interest" | "mmf_deposit" | "contribution" | "missed_contribution" | "no_sweep" | "liquidity_at_goal";
  description: string;
  amount: number;
  instrument: string;
  details?: Record<string, string | number | null>;
}
```

### MonthResult (line 358):
Add: `instrumentEvents: InstrumentEvent[];`

### SecondaryMmfMonthDetail (new type):
```ts
export interface SecondaryMmfMonthDetail {
  label: string;
  deposit: number;
  grossInterest: number;
  wht: number;
  netInterest: number;
  endBalance: number;
}
```

### MonthResult:
Add: `secondaryMmfDetail: SecondaryMmfMonthDetail[];`

## 3. Emit InstrumentEvents throughout the engine loop

### In the monthly loop (starting line 1391):
- Create `const instrumentEvents: InstrumentEvent[] = [];` at the start of each month
- Push events at each cash flow point:
  - Contribution: push contribution event
  - Secondary MMF: push per-fund events
  - Bank placement/maturity/rollover: push events
  - T-bill maturity: push event with issueNumber if available
  - Bond coupon: push event with issueNumber
  - Bond maturity: push event with issueNumber
  - Sweep: push event per instrument bought
  - MMF interest: push event
  - No-sweep: push event when guard.allowed is false and not actual month
  - Liquidity-at-goal: push event on final month

### Issue number in narration strings:
Replace `tenorLabel(lot.bucket, lot.tenorMonths)` with a helper:
```ts
function lotLabel(lot: SecurityLot): string {
  if (lot.issueNumber) return lot.issueNumber;
  return tenorLabel(lot.bucket, lot.tenorMonths);
}
```

## 4. Secondary MMF detail

### secondaryState needs label:
Change initialization (line 1214):
```ts
const secondaryState = secondaryMmfs.map((s) => ({
  label: s.label ?? "Secondary MMF",
  balance: s.currentBalance || 0,
  monthlyContribution: s.monthlyContribution || 0,
  ear: s.ear || 0,
  whtRate: s.whtRate,
}));
```

### In the secondary MMF loop (line 1457):
Track per-fund detail and push to `secondaryMmfDetail[]`.

## 5. Liquidity-at-goal explanation

### On the final month (m === horizonMonths):
Push a special InstrumentEvent with kind "liquidity_at_goal" that explains:
- Total liquid balance
- Whether any holdings are locked past goal date
- Explicit statement that funds are accessible

### The guard already prevents new purchases past goal date.
### Need to check if any ACTUAL securities have maturityDate > goal date and warn.

## 6. Key constraints
- Engine is PURE — no DB access
- All data passed via parameters
- SecurityLot.issueNumber comes from ActualSecurity which comes from mapActualSecurities
- The `notes` field on the securities table could also carry issue number as fallback
- The holdingSnapshot.copiedTerms.issueNumber.value is the canonical source

## 7. Files to edit
1. server/engine.ts — types + loop changes
2. server/routers.ts — mapActualSecurities to pass issueNumber
3. shared/ledgerExplain.ts — consume instrumentEvents
4. client/src/pages/Ledger.tsx — render instrumentEvents

## 8. Existing test contracts to preserve
- bankLedger.round35.test.ts: bankEnd pinning, placement narration, maturity cash
- finalCouponAtMaturity.round60.test.ts: principal + final coupon narration
- discountLifecycle.round42.test.ts: discount instrument math
- ledgerExplain.test.ts: headline mirrors mainAction, flow legs, tense
