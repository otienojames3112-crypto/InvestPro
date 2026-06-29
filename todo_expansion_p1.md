# Expansion Brief — Part 1 of 6: Data model & instrument abstraction

## Audit
- [x] securityType union in shared/securityTenor.ts (tbill_91/182/364, ifb, fxd, zero_coupon, floating_rate)
- [x] WHT single source: whtRateForSecurity (securityTenor.ts) + govWhtPct (actuals.ts); discount.ts whtOnDiscount; IFB exempt; FXD tenor-tiered 15/10
- [x] single-source fns confirmed: discount.ts, actuals.ts, liquidAllocator.ts, engine.ts (lot map ~1289 / maturity ~1543), reconciliation.ts (consumer only)
- [x] securities schema read (drizzle/schema.ts ~270-321)

## A1 — AssetClass taxonomy + BehaviorProfile (shared/assetModel.ts, re-exported via types.ts)
- [x] AssetClass enum (cash_mmf, bank_deposit, gov_discount, gov_coupon, equity, reit, offshore_fund, alt)
- [x] BehaviorProfile interface (valuation, cashflow, hasMaturity, isLiquid, priceDriven, fxExposed, incomeType, insured)
- [x] ASSET_PROFILES map per AssetClass (first four reproduce current behavior)
- [x] assetClassForSecurityType / assetClassForBankInstrument / assetClassForMmf mappings
- [x] assetGuardIssues + isAssetRowComplete guards

## A2 — schema + migration (additive nullable)
- [x] added 11 nullable columns to securities (schema.ts + drizzle/0006 SQL)
- [x] applied to live DB; columns verified present
- [x] backfilled assetClass for every holding; mismatch check = 0

## A3 — taxFor() single source (shared/assetTax.ts)
- [x] taxFor() delegates to whtRateForSecurity for coupon/discount (no re-derivation); 15% interest for MMF/bank
- [x] dividend 5% (KRA resident final tax); REIT/offshore sourced + requiresReview, user-overridable
- [x] netOfTax helper; re-exported via types.ts
- [x] REIT distribution / offshore treatment carried as sourced rates with provenance + requiresReview (RESIDENT_TAX_RATES + TaxRateResult.source)

## A4 — engine reads profile + guards
- [x] engine derives assetClass via shared mapping + skips price-driven classes (gov flow byte-identical)
- [x] assetClass stamped on all 3 write paths (register add/update, deposit auto-create)
- [x] guard: priceDriven => unitPrice, units, dataSource, dataAsOf required (assetGuardIssues)
- [x] guard: fxExposed => currency, fxRateToKes required, flagged not defaulted (assetGuardIssues)

## Wrap-up
- [x] tests: backfill mapping + profile parity + taxFor parity + guards (13 tests, server/assetModel.test.ts)
- [x] full suite 782/782 + tsc clean; no projection/ledger/dashboard/recon number changes
- [x] checkpoint + deliver
