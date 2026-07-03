# Round 99 — Holdings Inherit Reference Catalogue Details

## Key File Locations

### Schema
- `drizzle/schema.ts` — securities (line 307), bankInstrumentHoldings (line 827), portfolioSecondaryMmfs (line 703), opportunities (line 1099)
- All holding tables already have `holdingSnapshot: json("holdingSnapshot").$type<HoldingSnapshot>()`
- `shared/instrumentProfile.ts` — HoldingSnapshot type (line 309), CbkSecurityProfile (line 121), MmfProfile (line 189), BankInstrumentProfile (line 228), MarketAssetProfile (line 266)

### Routers (server/routers.ts)
- `deposits.add` (line 5048) — creates gov securities; currently NO snapshot; needs `opportunityId` input + snapshot build
- `bankHoldings.add` (line 6697) — already builds snapshot from bankInstruments catalogue row
- `secondaryMmfs.add` (line 6234) — already builds snapshot from mmfFunds catalogue row
- `modeling.commit` (line 6082) — creates market asset holdings; currently NO snapshot; needs snapshot from opportunities row

### Client Prefill
- `client/src/contexts/DepositDrawerContext.tsx` — DepositPrefill type (line 11)
  - `kind: "bank"` — has bankInstrumentId, bankName, instrumentType, indicativeRate, typicalTenor, tenorMonths, minAmount, source, asOfDate
  - `kind: "gov"` — THIN: only bucket + tbillTenorDays. NEEDS: opportunityId, issueNumber, ISIN, couponRate, WHT, maturityDate, settlementDate, couponPaymentDates, cleanPrice, accruedInterest, dirtyPrice, secondaryTradingLotSize, rediscountingRule, tenorYears, securityType
  - `kind: "mmf"` — has mmfFundId, fundName. NEEDS: EAR, grossYield, fee, WHT, dayCount, creditingFrequency already available via the catalogue query

### Client Forms
- `client/src/components/DepositDrawer.tsx` — main intake for bank + gov holdings
  - Bank prefill handling: lines 296-315 (seeds bankName, instrumentType, rate, tenor)
  - Gov prefill handling: lines 316-320 (only sets bucket + tbillTenorDays)
  - Bank submit: lines 444-490 (creates holding via bankHoldings.add)
  - Gov submit: lines 509-533 (creates deposit + auto-creates security register row)
- `client/src/pages/MmfAccounts.tsx` — MMF secondary add dialog (lines 80-161)
- `client/src/components/ModelDrawer.tsx` — market asset commit (lines 198-228)

### Where CBK catalogue rows live
- `opportunities` table with assetClass in (gov_discount, gov_coupon) — these are CBK securities
- The "CBK Securities Reference" page queries opportunities filtered by gov asset classes
- Each row has `extendedFields` JSON with CbkSecurityProfile data

## Implementation Plan

### 1. Gov Securities (Phase 3)
- Expand DepositPrefill `gov` variant to carry `opportunityId` + all CBK profile fields
- In DepositDrawer, when prefill.kind === "gov" AND has opportunityId, show read-only catalogue terms + user enters face value, actual price paid, date purchased, notes
- In deposits.add, accept optional `opportunityId`, load the opportunity row, build holdingSnapshot with CbkSecurityProfile copiedTerms, and use catalogue terms (couponRate, maturityDate, securityType, tenorYears) to populate the security register row

### 2. Bank Holdings (Phase 4)
- Expand DepositPrefill `bank` variant with whtRate, payoutFrequency, earlyWithdrawalPenalty, negotiable, noticePeriod
- In DepositDrawer bank form, prefill these additional fields; user confirms actual amount, negotiated rate, start/maturity dates
- bankHoldings.add already builds snapshot — just ensure the prefill carries the extra fields through

### 3. MMF Accounts (Phase 5)
- The secondaryMmfs.add already builds snapshot from mmfFunds row
- Expand MmfAccounts add dialog to show catalogue terms (EAR, gross yield, fee, WHT, day-count, crediting) as read-only context
- User enters opening balance + contribution schedule

### 4. Market Assets (Phase 6)
- In modeling.commit, accept optional `opportunityId`, load the opportunity row, build holdingSnapshot with MarketAssetProfile copiedTerms
- Store snapshot in the other_holdings row (needs holdingSnapshot column if not present)

### 5. Holding as Source of Truth (Phase 7)
- Verify that ledger/tax/accrual/reconciliation read from holding fields (securities.couponRate, securities.maturityDate, etc.) not from catalogue
- The existing architecture already does this — securities table IS the holding, and bankInstrumentHoldings IS the holding
- Just need to confirm no code path reads back from catalogue for math
- Add a comment/guard in the promotion path (research pipeline review) that catalogue updates NEVER mutate existing holding rows
