# Round 93 — Reference Catalogue → Holdings action flow (working notes)

## Goal
Wire reference-catalogue rows to a confirm-first Holdings action flow. Reference rows never change money; only confirmed holdings do.

## DONE
1. Schema: nullable `bankInstrumentId int` on `bank_instrument_holdings`. Migration drizzle/0017_round93_bank_holding_catalogue_link.sql applied to live DB + recorded in __drizzle_migrations.
2. Backend bankHoldings.add: optional `bankInstrumentId` in zod input + threaded into addBankInstrumentHolding.
3. Backend bankHoldings.list: `bankInstrumentId` in output map.
4. DepositDrawerContext DepositPrefill: bank variant extended (bankInstrumentId, tenorMonths, minAmount, source, asOfDate). ADDED new `mmf` prefill kind { kind:"mmf", mmfFundId, fundName? }.
5. DepositDrawer.tsx:
   - prefillBankInstrumentId state; seeded in bank prefill effect; cleared in resetForm; passed to createBankHolding.mutateAsync({ bankInstrumentId }).
   - quick-fill Select also sets prefillBankInstrumentId = ref.id.
   - NEW mmfNotHeldName state; mmf prefill branch preselects a held MMF destination (primary/secondary) matching mmfFundId; if not held, destination "" + amber hint banner rendered above destination Select.
6. BankInstruments.tsx: removed broken /holdings/bank navigation (and unused useLocation). Detail-drawer "Next steps" now single button "Record a deposit into this product" -> openDrawer({ kind:"bank", bankInstrumentId: r.id, ... }). Imports useDepositDrawer.
7. MmfFunds.tsx (MMF Market): each row now has a DropdownMenu (MoreHorizontal) with 3 confirm-first actions:
   - "Add as MMF account" -> navigate(`${dashboardHref.mmf}&addSecondary=1&fundId=${fund.id}`)
   - "Record a deposit" -> openDrawer({ kind:"mmf", mmfFundId: fund.id, fundName })
   - "View composition" -> navigate("/mmf-strategy")
   Imports: useLocation, useDepositDrawer, DropdownMenu*, icons MoreHorizontal/PiggyBank/Receipt/PieChart.
8. App.tsx: mounted real Route path="/mmf-strategy" -> <MmfStrategy /> (was orphan page). Removed the /mmf-strategy legacy redirect from shared/legacyRoutes.ts so it no longer shadows the real route.

## TODO (remaining)
- DONE MmfAccounts.tsx: consumes ?addSecondary=1&fundId= deep-link (effect on [funds], strips params).
- DONE Securities.tsx: added CBK Securities catalogue back-link (inline + Compare-the-market).
- DONE OtherAssets.tsx: added Market Assets catalogue back-link. BankHoldings + MmfAccounts already had them.
- VERIFIED CBK Securities Reference (openDrawer(govPrefill)) + Market Assets Reference (navigate track=1) are already confirm-first.
- (was) MmfAccounts.tsx: consume ?addSecondary=1&fundId= deep-link. Import useLocation (or window.location.search) + useEffect. Mirror OtherAssets pattern (lines 696-723): parse params, setForm prefilled { ...EMPTY, mmfFundId:Number(fundId) }, setDialogOpen(true), then window.history.replaceState to strip addSecondary+fundId. MmfAccounts currently imports { useMemo, useState } only — add useEffect.
- Phase 4: verify CBK Securities (already confirm-first, has backlink) + Market Assets (already deep-links Holdings→Other). Add Holdings→Government (Securities.tsx) header back-link to dashboardHref.cbkSecurities (was noted missing). Verify MMF/Bank/Other holdings pages have catalogue back-links (MmfAccounts + BankHoldings + OtherAssets).
- Phase 5 tests + tsc + checkpoint:
  - phase9Integration test: /mmf-strategy removed from LEGACY_REDIRECTS — test only checks totality/consistency of remaining entries, no explicit mmf-strategy assertion, should stay green. VERIFY.
  - Add/extend a vitest: created bank holding stores bankInstrumentId; bank catalogue has no /holdings/bank nav; MMF add-secondary deep-link param handling; reference rows don't change net worth.
  - Run pnpm test + npx tsc --noEmit.

## Key payload shapes
- bankHoldings.add input: { portfolioId, bankInstrumentId?, bankName, label?, instrumentType, principal, interestRate, rateAsOfDate?, isNegotiable, dayCountBasis, whtRate, startDate?, tenorMonths?, maturityDate?, payoutFrequency, earlyBreakPenaltyPct, maturityAction, notes? }
- secondaryMmfs.add: { portfolioId, mmfFundId, label?, currentBalance, monthlyContribution }
- dashboardHref.mmf = "/holdings?tab=mmf"; cbkSecurities/mmfMarket/bankCatalogue/marketAssets = "/research?tab=reference-catalogues&cat=<id>"
- TabbedArea preserves unrelated query params on load (only drops ref/cat/class on tab SWITCH), so ?addSecondary&fundId survive initial navigation into /holdings?tab=mmf.
