# KES 5M Investment Tracker — Project TODO

## Schema & Backend
- [x] Define database schema: settings, ledger_entries, securities, contributions
- [x] Run migration and apply SQL
- [x] Build db.ts query helpers for all tables
- [x] Build tRPC routers: settings, ledger, securities, contributions, simulation

## Core Engine (server-side)
- [x] Compounding engine: MMF daily accrual (monthly equivalent)
- [x] T-bill discount return calculation
- [x] IFB semi-annual coupon (tax-exempt)
- [x] FXD bond coupon with 15% withholding tax
- [x] Phase-based allocation rules (Foundation/Growth/De-risking/Final Liquidity)
- [x] Sweep logic with KES 50,000 safety floor
- [x] 120-month projection simulator
- [x] Milestone checker and catch-up recommendation engine
- [x] Scenario comparison engine (step-up KES 0 to KES 3,500)

## Dashboard Page
- [x] Current portfolio value card
- [x] Progress bar toward KES 5M goal
- [x] Months elapsed and projected end value
- [x] Year-end milestone tracker with catch-up alerts
- [x] Quick stats: MMF balance, T-bills, IFBs, FXDs

## Portfolio Growth Chart
- [x] Area/line chart: actual vs projected balance over 120 months
- [x] Phase band highlights (Foundation/Growth/De-risking/Final Liquidity)
- [x] Year-end milestone markers
- [x] Recharts implementation

## Month-by-Month Ledger
- [x] Table with: month, date, save, CBK cash in, MMF to DhowCSD, main action, MMF end, T-bill end, IFB end, FXD end, total end
- [x] Entry types: contribution, coupon payment, maturity, sweep
- [x] Filterable and paginated

## Contribution Schedule Manager
- [x] Auto step-up schedule: KES 2,500 start, +KES 3,000 every 6 months
- [x] Manual override for any month's contribution
- [x] One-off lump sum entry
- [x] Visual contribution ladder table

## Rate Settings Panel
- [x] MMF yield (default 8.78%)
- [x] T-bill rates: 91-day (8.82%), 182-day (8.78%), 364-day (8.97%)
- [x] IFB coupon rate (default 12.5%)
- [x] FXD bond coupon rate (default 10.5%)
- [x] Tax rate (default 15% WHT on FXD only)
- [x] Save and recalculate projection on change

## CBK Securities Register
- [x] Log individual T-bill and bond purchases
- [x] Fields: security type, face value, issue date, maturity date, coupon rate
- [x] Auto-calculate next coupon date and maturity cash-flow
- [x] Summary by security type

## Scenario Comparison Tool
- [x] Side-by-side projections for step-up amounts: KES 0, 1000, 2000, 2800, 3000, 3500
- [x] Show: final monthly saving, total contributed, projected ending value, result (hit/miss)
- [x] Highlight the KES 3,000 step-up as the recommended path

## UI & Design
- [x] DashboardLayout with sidebar navigation
- [x] Dark/elegant color palette (deep navy + gold accents)
- [x] Google Fonts: Inter for body, Playfair Display for headings
- [x] Smooth transitions and micro-interactions
- [x] Responsive design (mobile-first)
- [x] Loading skeletons and empty states

## Testing
- [x] Vitest: compounding engine unit tests (34 tests)
- [x] Vitest: sweep logic unit tests
- [x] Vitest: scenario comparison unit tests
- [x] Auth logout test (1 test)
- [x] Total: 35 tests passing

## Delivery
- [x] Final checkpoint saved

## Deposit Entry Feature (Live Actuals)
- [x] Add deposit_entries table to schema (bucket, amount, date, notes)
- [x] Run migration and apply SQL
- [x] tRPC router: create, list, delete deposit entries
- [x] tRPC router: compute actuals summary (total contributed, remaining to target, tax on FXD)
- [x] Build Deposit Entry page: form to log deposits per bucket, history table
- [x] Update Dashboard: Actuals panel showing contributed vs projected, remaining, tax liability
- [x] Add Deposit Entry link to sidebar navigation

## Owner Rights
- [x] Grant admin role to otienojames3112@gmail.com
- [x] Grant admin role to otienojames707@gmail.com

## Accuracy Fixes Requested
- [x] Reconcile the engine with the original PDF allocation rules, especially the planned FXD bond allocation in the Growth, De-risking, and Final Liquidity phases
- [x] Apply 15% WHT correctly to MMF interest income as final tax for resident individuals
- [x] Apply 15% WHT correctly to T-Bill discount income deducted at source
- [x] Re-check whether IFB and FXD coupon timing, maturity recycling, and sweep rules match the original monthly plan table
- [x] Update dashboard, ledger, deposits, and settings pages so corrected tax treatment and corrected FXD allocations sync consistently across the app
- [x] Add or update engine tests to prove MMF WHT, T-Bill WHT, FXD coupon allocations, and milestone alignment are correct

## PDF Re-read Notes
- [x] Page 1 confirms target mix by phase: Foundation months 1-24 = MMF 50%, T-Bills 50%, IFB 0%, FXD 0%; Growth months 25-84 = MMF 20%, T-Bills 20%, IFB 45%, FXD 15%; De-risking months 85-102 = MMF 25%, T-Bills 35%, IFB 30%, FXD 10%; Final Liquidity months 103-120 = MMF 40%, T-Bills 45%, IFB 10%, FXD 5%
- [x] Page 2 confirms contribution ladder starts at KES 2,500 and steps up by KES 3,000 every 6 months through month 120
- [x] Pages 3-4 show FXD balances do appear from the Growth phase onward, so the current app behavior with zero FXD is inconsistent with the original plan
- [x] Pages 3-4 show monthly action lines combining deposits, coupon receipts, maturities, and specific KES 50,000 sweeps into IFB and FXD, so the engine must model actual bucket purchases rather than a simplified no-FXD path


## Target Amount Interactivity & Plain Language
- [x] Add plain-language tooltip/explainer on the dashboard for what "Projected at Month 120" means
- [x] Add a quick-edit target amount control on the dashboard (click to change, saves to settings)
- [x] When target changes: milestones, progress bar, scenarios, deposits remaining-to-target all sync
- [x] Show "What this means" section on dashboard explaining the engine projection in simple terms

## Bug Fixes (Round 3)
- [x] Fix: second target-change attempt fails with "failed to change target amount" error
- [x] Fix: bucket balance cards (MMF/T-Bills/IFB/FXD) do not update when target changes — now show % of target so they visually respond to goal changes
- [x] Full end-to-end system test of every page and feature before publish — 52 tests pass, 0 TS errors, all 7 pages render correctly

## Round 4 Fixes
- [x] Clarify projected total vs target: show surplus/deficit clearly; explain that compounding overshoot is expected and desirable
- [x] When target changes, projected amounts should reflect the new target context (progress bar, milestone status, surplus/deficit all sync)
- [x] Move Record Deposits from a separate /deposits route to a global slide-out drawer accessible from sidebar and all dashboard CTAs

## Round 5 Fixes & Features
- [x] Fix target amount language: everywhere say "the amount you will HOLD at Month 120" not "total contributions"
- [x] Implement time-locked rate changes: rate_history table with effective_date; engine uses rate valid at each month
- [x] Build Getting Started guide page with SanlamAllianz MMF + CBK DhowCSD step-by-step setup
- [x] Account status tracker: click to mark account as opened, store account details (account number, name, date opened)
- [x] Add Getting Started to sidebar navigation after Rate Settings
- [x] Full pre-publish sync verification across all pages — 58 tests pass, 0 TS errors, all 7 pages render correctly

## Round 6 — Remaining Gaps Before Publish
- [x] Wire rate_history into projection engine: each month uses the rate snapshot effective on that month's date
- [x] Add regression tests: changing rates today does not alter past months' projections — 6 regression tests added, 58 total pass
- [x] Persist Getting Started account status/details in database (tRPC create/update/read)
- [x] Bind Getting Started UI to stored database state (not local state) — localStorage removed, DB-backed
- [x] End-to-end sync verification: change settings → confirm dashboard/ledger/scenarios/deposits all update — all 7 pages verified

## Round 7 — Engine Math Fixes & Rate Auto-Fetch
- [x] Update regression test target to KES 4,763,385 ±2%
- [x] Compute what step-up amount hits KES 5M under corrected engine
- [x] Add plan-vs-PDF explanation note to Dashboard milestones view
- [x] Update existing engine.test.ts to match corrected engine outputs
- [x] Finish wiring rate auto-fetch confirmation feature (RateRefreshPanel + router + DB)
- [x] Run full test suite and confirm all tests pass (71/71)
- [x] Save checkpoint

## Round 8 — Replace Scraper with Manual Rate Entry
- [x] Remove rateFetcher.ts, scheduledRateFetch.ts, and dead pending_rate_fetches table
- [x] Add cbkSourceUrl and sanlamSourceUrl columns to rate_settings schema
- [x] Run SQL migration for new URL columns
- [x] Remove rateRefresh tRPC router, replace with manual saveRates procedure
- [x] Remove /api/scheduled/rateFetch endpoint from index.ts
- [x] Remove RateRefreshPanel.tsx (auto-fetch UI)
- [x] Build UpdateRatesPanel.tsx with editable source URLs, clickable links, manual fields, staleness indicator
- [x] Wire UpdateRatesPanel into Settings page
- [x] Run full test suite and confirm all tests pass (71/71)
- [x] Save checkpoint

## Round 9 — Multi-Portfolio Architecture
- [x] Add portfolios table to schema (name, userId, targetAmount, startDate, horizonMonths, contribution settings, phase fractions, source URLs)
- [x] Re-key all 7 tables (rateSettings, ledgerEntries, securities, contributionOverrides, depositEntries, rateHistory, accountStatus) from userId to portfolioId
- [x] SQL migration: create portfolios, add portfolioId columns, backfill from userId, migrate existing data into default portfolio
- [x] Engine: variable horizon (replace hardcoded 120 with horizonMonths parameter)
- [x] Engine: proportional phases (fractions of horizon, not absolute month numbers)
- [x] Engine: short-horizon strategy switch (< 30 months → MMF + 91-day T-bills only)
- [x] Engine: backwards solver (compute required startingContribution/stepUp to hit target)
- [x] Router: portfolio CRUD procedures (create, list, get, update, delete)
- [x] Router: re-key all existing procedures to accept portfolioId
- [x] Router: per-portfolio milestones generated dynamically
- [x] Frontend: portfolio list page (home screen after login)
- [x] Frontend: portfolio detail view (existing pages scoped to selected portfolio)
- [x] Frontend: backwards solver UI (new "Plan a Portfolio" form)
- [x] Frontend: short-horizon warning banner
- [x] Run full test suite and confirm all tests pass (71/71)
- [x] Save checkpoint

## Round 10 — MMF Comparison List + Other Asset Classes
- [x] Schema: add mmf_funds table (name, company, grossYield, ear, managementFee, minInvestment, aum, asOfDate, source)
- [x] Schema: add mmfFundId to portfolios table (nullable FK to mmf_funds)
- [x] Schema: add other_holdings table (portfolioId, assetClass, name, description, purchaseValue, currentValue, purchaseDate, notes, assumedReturnConservative, assumedReturnBase, assumedReturnOptimistic, incomeRecords)
- [x] Schema: add holding_income table (holdingId, amount, date, type, notes)
- [x] Run SQL migration for all new tables and columns
- [x] Seed 27 Kenyan MMF funds with current benchmark data
- [x] Engine: use selected fund EAR (net of fee) as MMF return; still apply 15% WHT on top
- [x] Engine: fall back to manual mmfYield if no fund selected
- [x] Router: mmfFunds CRUD (list, create, update, delete)
- [x] Router: portfolios.setFund (set mmfFundId on portfolio)
- [x] Router: otherHoldings CRUD (list, create, update, delete)
- [x] Router: holdingIncome CRUD (add, list, delete income records per holding)
- [x] Router: netWorth query (sum all buckets + other holdings current value)
- [x] Frontend: MMF Funds page (sortable/searchable table, add/edit/delete, rank vs top-5 avg, selected fund highlight)
- [x] Frontend: fund selector in Settings page (replace manual MMF yield with fund picker; manual override still available)
- [x] Frontend: dashboard fund rank card (show selected fund rank and gap vs top-5)
- [x] Frontend: Other Assets page (education section per asset class, holdings table, add/edit/delete holding, income tracker, net-worth summary)
- [x] Frontend: scenario projection on Other Assets page (user-entered assumed return, conservative/base/optimistic range, clearly labelled as scenario)
- [x] Frontend: add MMF Funds and Other Assets to sidebar navigation
- [x] Run full test suite and save checkpoint

## Round 11 — Dynamic MMF Fund Selection Across App
- [x] Backend: extend `settings.get` to include `selectedFundName` and `selectedFundEar` (join mmf_funds on portfolios.mmfFundId)
- [x] Frontend: create `useSelectedFund()` hook that reads mmfFundId from portfolio and looks it up in mmfFunds list
- [x] Frontend Dashboard: replace hardcoded "SanlamAllianz MMF" with dynamic fund name everywhere
- [x] Frontend Deposits page: replace hardcoded "SanlamAllianz MMF" bucket label and rate description with dynamic values
- [x] Frontend DepositDrawer: replace hardcoded "SanlamAllianz MMF" bucket label with dynamic fund name
- [x] Frontend Settings page: replace "SanlamAllianz MMF" label and description with dynamic fund name
- [x] Frontend UpdateRatesPanel: replace "SanlamAllianz MMF" source URL label with dynamic fund name
- [x] Frontend AppShell: replace hardcoded "SanlamAllianz MMF + CBK DhowCSD" with dynamic fund name
- [x] Frontend GettingStarted: mark the selected fund dynamically (not always "sanlam")
- [x] Support multiple MMF accounts: add secondary MMF tracking with full CRUD (add, edit, remove, view balances)

## Round 12 — Professional Knowledge & Accuracy Layer

### Research (current 2026 data, record source + as-of date on every seeded row)
- [x] Research MMF composition/allocation factsheets: Nabo, Cytonn, Etica, CIC, Sanlam, Old Mutual, + others
- [x] Research Kenyan bank call/fixed deposit products: Equity, KCB, Co-op, Stanbic, NCBA, Absa
- [x] Research MMF market average yield benchmark + CBR + inflation (2026)
- [x] Confirm Kenyan tax mechanics: 15% WHT on MMF interest, T-bill discount WHT, FXD coupon WHT, IFB exempt

### Data layer
- [x] Add mmf_composition table (fund_id, bucket allocations %, notes, source, as_of)
- [x] Add bank_instruments table (bank, type, min amount, tenor, rate, negotiable, notes, source, as_of)
- [x] Add benchmark_inputs (global: mmf market avg, leaders avg, CBR, inflation, tbill, deposit rate, editable)
- [x] Add audit_log table (entity, entity_id, field, old_value, new_value, changed_by, changed_at)
- [x] Add per-fund settings: day_count_basis (365/360), crediting_frequency (daily/monthly), wht_rate
- [x] Generate migrations, apply via webdev_execute_sql, seed data (benchmarks, banks, compositions)
- [x] Add db helpers + tRPC routers for all new tables (full CRUD)

### Daily MMF Accrual Ledger (MmfAccrualLedger.tsx) — per-portfolio
- [x] Daily accrual engine (shared/accrual.ts): gross = balance × (rate ÷ day-count); WHT deducted per period; daily vs monthly crediting
- [x] What-if mode (defaults to current MMF balance, adjustable amount + horizon)
- [x] Per-day breakdown: opening, gross, WHT, net added, closing
- [x] Period roll-ups (gross/WHT/net totals over horizon)
- [x] "Withdraw today" readout: net interest earned, WHT deducted, amount receivable
- [x] Plain-language Kenyan MMF tax explainer + disclaimer
- [x] Vitest coverage for accrual + WHT math (10 tests)

### Tax Summary (TaxSummary.tsx) — per-portfolio
- [x] Rollup: MMF WHT, T-bill WHT, FXD coupon WHT, IFB exempt, dividends 5%, holdings income
- [x] WHT rate sourced from editable Rate Settings

### MMF Strategy & Composition (MmfStrategy.tsx) — global
- [x] Per-fund allocation breakdown + plain-English bucket explanations
- [x] Editable composition (Edit Composition mode) with source + as-of

### Banking Sector Instruments (BankInstruments.tsx) — global
- [x] Editable bank instruments table + call vs fixed deposit explainer
- [x] Fixed vs call deposit sections with negotiability + WHT notes

### Money-manager features
- [x] Client/portfolio summary printable export (Print / Save as PDF via browser)
- [x] Net worth across all asset classes on Portfolio Review + allocation
- [x] Effective vs nominal yield reconciliation (gross → WHT → take-home) on Tax Summary
- [x] Liquidity / cash-flow calendar (CBK security maturities)
- [x] Benchmark comparison (your fund vs MMF avg/leaders/T-bill/CBR/inflation, editable)
- [x] Audit trail / change log: audit_log table + router, and writes wired into rate updates, deposit create/delete, composition + benchmark edits (verified end-to-end)

### Cross-cutting
- [x] Added all new pages to grouped nav (Tracking / Analysis / Knowledge); per-portfolio pages respect selected portfolio
- [x] Maintained educate-and-track boundary (no buy recommendations)
- [x] 81/81 tests pass, 0 TS errors, screenshots verified

## Round 13 — Composition depth, bank coverage, WHT fix

- [x] Add more banks to Call Deposit section — now 10 banks (Equity, StanChart, KCB, Co-op, NCBA, Stanbic, Absa, I&M, DTB, Family)
- [x] Expand MMF composition to all 27 funds (verified 27/27 comp rows)
- [x] Add Government Securities sub-breakdown per fund (gov_tbills/gov_tbonds/gov_ifb columns + seeded for all 27)
- [x] Fix hardcoded WHT on Record Deposits — rewrote deposits.summary to compute per-bucket WHT from real balances (MMF/T-bill/FXD taxed, IFB exempt)
- [x] Update MMF Strategy UI to render gov-sec sub-breakdown panel + editable sub-fields with validation
- [x] Bank Instruments UI renders additional call deposits generically (verified 10 call / 6 fixed)
- [x] Added 6 vitest tax-breakdown tests; 87/87 tests pass, 0 TS errors; screenshots verified
