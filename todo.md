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

## Round 14 — Fixed-deposit parity + full segment breakdowns

- [x] Added missing Fixed Deposit banks (StanChart, I&M, DTB, Family) — now 10 fixed / 10 call parity
- [x] Extended mmf_composition with segment notes (bank/corporate/cash/offshore) + realEstate/otherAssets %s + realEstateNote/otherNote
- [x] Seeded per-segment detail for all 27 funds (holdings, indicative rates, real-estate exposure incl. manager-level notes)
- [x] Updated db helper + composition router to return + accept new fields
- [x] Updated MMF Strategy UI: per-segment detail panels with rates + real-estate note (shown even at 0%) + editable note inputs
- [x] 87/87 tests pass, 0 TS errors, screenshots verified

## Round 15 — Presentation layer: fully portfolio-driven (no engine/solver/schema math changes)

- [x] R15.1 AppShell: replace hardcoded "KES 5M Tracker" / "2026–2036" with active portfolio name + derived date range + target subtitle
- [x] R15.1 Add portfolio `description` field (schema + router + UI) to drive subtitle
- [x] R15.1 client/index.html: change <title> to generic "Investment Tracker"
- [x] R15.2 Dashboard: remove hardcoded "Why these numbers differ from the PDF" block
- [x] R15.3 Scenarios: delete hardcoded "KES 3,000 step-up hits target" prose; render real solveForContribution output; rec + table from same solver call; honour feasible:false
- [x] R15.4 Sweep 5M-specific copy: OtherAssets, GettingStarted, MmfFunds Sanlam note → portfolio name / neutral
- [x] R15.4 Audit client/ for literals 5M / 5,279,234 / 5,478,000 / 236,615 / 3,500 step-up / 2026–2036 / PDF in user-facing strings
- [x] R15.5 Verify add/edit/remove secondary MMF UI in MmfFunds
- [x] R15.5 Dashboard blended view: per-fund balance + EAR + combined MMF position
- [x] R15.5 MmfAccrual: per-fund accrual rows + combined total
- [x] R15.5 TaxSummary: per-fund WHT breakdown + combined total
- [x] R15.5 Adding/removing secondary fund instantly reflows dashboard/accrual/tax
- [x] R15.6 End-to-end sync audit across all pages; switching portfolio fully re-renders, no stale values
- [x] R15 Run tsc --noEmit + pnpm test; screenshot; save checkpoint


## Round 16 — Empty state, secondary-MMF projection, MMF Strategy redesign
- [x] R16.1 Dashboard: remove 5M/120 display fallbacks from render path
- [x] R16.2 Dashboard: add empty/onboarding state when no active portfolio (welcome + Create first portfolio CTA; no chart/numbers)
- [x] R16.3 Dashboard: make strategy descriptor portfolio-driven (drop literal "+ CBK DhowCSD"); MMF-only short-horizon must not claim gov securities
- [x] R16.4 Surface "Manage MMF accounts / Add another fund" prominently (dashboard MMF card / Funds page)
- [x] R16.5 Engine: project each secondary MMF forward (own EAR, day-count, fee, WHT, monthly contribution), compound like primary
- [x] R16.6 Engine/router: add secondary projected balances into total portfolio value at every month (chart, milestones, target, surplus)
- [x] R16.7 Confirm add/edit/remove secondary MMF invalidates + re-runs forward projection
- [x] R16.8 Keep per-fund separation in accrual ledger + tax summary (already done) — verify still totals
- [x] R16.9 GettingStarted + Settings: gate DhowCSD walkthrough on gov-securities usage; use selected fund name; drop SanlamAllianz assumption
- [x] R16.10 Sweep client for 5,000,000 / 10-year / Month 120 / DhowCSD / SanlamAllianz / 2026 / 3,000 step-up in rendered copy — make portfolio-derived or generic
- [x] R16.11 MMF Strategy page: add compact sortable comparison table as default view + toggle to detailed cards
- [x] R16.12 MMF Strategy page: progressive disclosure for gov-securities sub-breakdown + per-segment notes (Details toggle)
- [x] R16.13 MMF Strategy page: pin selected "Your Fund" to top of both views; consistent segment colors/order; right-aligned tabular % ; metadata to footer
- [x] R16.14 Verify non-owner sync path end-to-end (no portfolio -> empty state -> create portfolio with different target/horizon/fund -> all pages reflect it; secondary funds in projection)
- [x] R16.15 Run tsc --noEmit + pnpm test; screenshot; save checkpoint


## Round 17 — Live actuals everywhere, test mode, destination-aware deposits, bank holdings, guided Getting Started
- [x] R17.1 Research current 2026 Kenyan rates (MMF EARs, T-bill 91/182/364, IFB/FXD coupons, bank call/fixed deposit rates) with source + as-of
- [x] R17.2 Schema: add `isSandbox` (mode) to portfolios; queries scope by mode per user
- [x] R17.3 Schema: extend deposit_entries with destination (institutionType + mmfFundId/bankHoldingId/bucket); keep bucket for back-compat
- [x] R17.4 Schema: new `bank_instrument_holdings` table (per portfolio, live actuals)
- [x] R17.5 Migration applied (additive ALTERs via SQL); existing MMF deposits backfilled to primary fund
- [x] R17.6 Backend: mode-scoped portfolio queries; destination-aware deposit add/list/delete + summary
- [x] R17.7 Backend: bank-holdings CRUD with manual rate + as-of editing
- [x] R17.8 Backend: sample-portfolio seed + reset test data (sandbox only)
- [x] R17.9 Engine/accrual: bank holdings earn interest (rate, day-count, 15% WHT; fixed pays at maturity, call accrues); into accrual ledger, month ledger, tax, scenarios base; maturities in liquidity calendar
- [x] R17.10 Secondary MMFs: route fund-aware deposits into each fund balance; per-fund in accrual + tax then totaled; add/edit/remove re-runs projection + reflows all pages
- [x] R17.11 Test-mode toggle + persistent banner + Load sample / Reset buttons in top nav; mode context re-renders every page
- [x] R17.12 Destination-aware Record Deposit UI: pick account first (MMF funds primary+secondary, bank holdings, gov buckets), then amount/date/notes; fund/institution-aware history; mirror in DepositDrawer
- [x] R17.13 Live bank-holdings UI (per portfolio) alongside reference catalog
- [x] R17.14 Dashboard unified live-actuals: each MMF balance, each bank instrument, each gov security — single net-worth total + allocation bar; projections clearly separated
- [x] R17.15 Rate Settings audit: FXD gross 12.35% standardized (confirmed consistent); per-portfolio snapshot + rerun already wired; added active-rate-source clarifier (engine uses manual MMF Yield vs fund published EAR)
- [x] R17.16 Getting Started: guided demo — Load-sample CTA (Test mode), first-5-steps path linking each page, terms glossary (EAR/WHT/T-bill/IFB/FXD/call/fixed/duration)
- [x] R17.17 Sync audit + integration test (actualsSync.test.ts — 8 tests, double-count guards): record one deposit to each destination type; assert dashboard/net worth, accrual, ledger, scenarios, tax all reflect it
- [x] R17.18 Full tsc --noEmit + pnpm test (103 pass, 0 TS errors); screenshot; checkpoint; deliver

## Round 18 — Rate staleness, set-primary, what-if overlay
- [x] R18.1 Dashboard: "Rates last updated" timestamp + staleness reminder (green/amber/red) linking to Rate Settings
- [x] R18.2 MMF Funds: "Set as primary" control on any tracked MMF; updates portfolio selected fund + reruns projection
- [x] R18.3 Scenarios: "what-if" overlay (SecondaryWhatIf component + projection.whatIf) to change a secondary-MMF monthly contribution and see projection impact (baseline vs what-if)
- [x] R18.4 Tests for what-if projection delta (whatIfProjection.test.ts, 5 tests); full tsc + pnpm test (108 pass, 0 TS errors); checkpoint; deliver

## Round 19 — Bug fixes + what-if enhancements
- [x] R19.1 BUG: Tax Summary page "broken" — root cause: step-5 link pointed to /tax (404); actual route is /tax-summary. Fixed href.
- [x] R19.2 BUG: Test sample data failed — root cause: 7 legacy NOT-NULL `userId` orphan columns on portfolio-scoped tables (rate_settings, deposit_entries, contribution_overrides, ledger_entries, securities, rate_history, account_status) from an old migration, not in Drizzle schema. Dropped the 6 orphans (kept portfolios.userId). Seed now completes end-to-end.
- [x] R19.3 BUG: step 5 href /tax → /tax-summary (same fix as R19.1)
- [x] R19.4 What-if: one-click "Apply this what-if" button (projection.applyWhatIf) saves explored secondary + primary back to account/portfolio, with confirm dialog
- [x] R19.5 What-if: overlay also varies primary starting contribution + step-up amount (whatIf accepts primaryContribution/primaryStepUpAmount)
- [x] R19.6 Sidebar: rate-staleness badge (SidebarRateStaleness in AppShell, shared rateStaleness helper) visible on every page, links to Rate Settings
- [x] R19.7 Tests + full tsc + pnpm test (113 pass, 0 TS errors; +5 primary what-if tests); checkpoint; deliver

## Round 20 — Actuals reconciliation engine fix
- [x] R20.1 Seed: sample portfolio uses future start date (currentMonth=0) so actuals never render. Set startDate ~6 months in past, date deposits across elapsed months, across all destination types.
- [x] R20.2 Engine: non-MMF actual deposits (tbill/ifb/fxd) are dropped from total. Make actuals path destination-aware (institutionType, mmfFundId, bankHoldingId) — every deposit represented per destination.
- [x] R20.3 Engine: real money earns no interest during elapsed months (lump-at-handoff). Simulate elapsed months: place each deposit in its actual month, accrue MMF compounding / T-bill discount / coupons through elapsed period.
- [x] R20.4 Engine: replace single actualsMMF lump with per-month placement (map of actual contributions by month offset), so the actual-period curve is correct not just the endpoint.
- [x] R20.5 Engine: unify accounting basis across primary MMF, secondary MMFs, bank holdings, securities during actual months (same monthly basis, own rate/WHT/day-count, summed on same footing).
- [x] R20.6 Reconciliation test: projection total at "today" == daily-accrual ledger total for identical deposit set (within rounding).
- [x] R20.7 Integration test: seed one deposit of each destination type; assert dashboard total == accrual-ledger total == sum of per-instrument balances.
- [x] R20.8 Regression: forward projection unchanged (m120 = KES 4,763,385, delta 0.00%; 120 tests pass) for no-actuals portfolio (~KES 4.76M @ m120, year checkpoints intact).
- [x] R20.9 Robustness: currentMonth handles future-start-date gracefully for ANY portfolio — show zero actuals cleanly, don't drop recorded deposits.
- [x] R20.10 Full tsc (0 errors) + pnpm test (120 pass, +7 reconciliation tests); UI verify; checkpoint; deliver.

## Round 21 — Gov-security reconciliation, safety floor, cross-page sync, consolidation
- [x] R21.1 Gov-security single source of truth: DONE — deposit→government_security auto-creates a securities register row (securityId FK links them; cascade delete). Engine builds gov lots from register ONLY (deposit-inferred path removed). computeActualsTotals now values gov from the register. Reconciliation + double-count tests pass. deposit→government_security auto-creates a securities register row (face value, issue date, maturity, coupon/discount). Engine builds gov-security lots from register ONLY; remove/de-dupe deposit-inferred lot path (engine ~1501-1516). computeActualsTotals values gov securities on same basis as engine+register. Reconciliation test: 1 T-bill + 1 FXD → dashboard gov total = register total = projection lot total.
- [x] R21.2 Auto-derive MMF safety floor: deriveSafetyFloor(monthlyContribution, lotSize, 2mo) in engine; settings.derivedSafetyFloor query (live recompute from entered contribution); Settings shows Recommended + "Use auto value"; new portfolios default to derived floor; user-overridable. (was) Auto-derive MMF safety floor from contributions/liquidity (e.g. N months of contributions / sweep lot), recalc on rate/contribution change, applied automatically but user-overridable. Surface derived value + note on Rate Settings; override optional.
- [x] R21.3 Scenarios audit: confirmed forward-only + secondary-MMFs-included is the single consistent rule across scenarios/solver/milestones (all share runProjection + targetAmount); added explicit forward-only methodology note to Scenarios header. (was) Scenarios audit: confirm forward-only (empty actuals) is intentional and LABEL it in UI; verify hitsTarget + solveForContribution use same engine+target; recommended step-up matches scenario table (no prose/table contradiction); secondary MMFs consistently included/excluded across scenarios+solver+main projection (one rule everywhere).
- [x] R21.4 Milestone labels phase-aware: phaseMilestoneLabel(phase, isFinalYear) derived from getPhase + portfolio phaseFractions (works for any horizon, e.g. 15yr); removed hardcoded MILESTONE_LABELS; checkpoint tightened 0.90→0.95 in de-risking/final-liquidity. (was) Milestone labels phase-aware (Foundation/Growth/De-risking/Final liquidity) derived from each portfolio's phase at that month, not hardcoded MILESTONE_LABELS 10-yr map; works for any horizon. Review minHealthyCheckpoint (90%) — keep or make phase-aware.
- [x] R21.5 Daily MMF Accrual Ledger audit: ledger uses shared simulateAccrual (daily rate=EAR/dayCount, WHT at source, per-fund compounding); fixed primary-balance derivation to exclude bank/secondary/gov deposits so it reconciles with the register-canonical dashboard. (was) Daily MMF Accrual Ledger audit: correct basis (daily rate from EAR/day-count, WHT at source, compounding per fund setting); "balance today" reconciles with projection MMF balance at current month AND dashboard MMF actual — for primary AND secondary. Align if divergent.
- [x] R21.6 Tax Summary & yield reconciliation: gov-security buckets now sourced from the register (not deposit rows); IFB exempt; tax math routed through shared whtOn/WHT_RATES (single authority); secondary-MMF + bank tax already in summary. (was) Tax Summary & yield reconciliation: decide authoritative tax basis (flat-annual vs per-accrual), make other match or label basis; IFB exempt everywhere; yield recon uses selected fund's real numbers not hardcoded; include bank-instrument + secondary-MMF tax in summary total.
- [x] R21.7 Portfolio Review audit: fixed allocation buckets to count primary-MMF deposits only + register face values for gov securities (no double-count with secondary/bank/holdings); all data is live per active portfolio. (was) Portfolio Review audit: live per-portfolio data (balances, accrued interest, tax, projection-vs-actual, milestone status), reconciles with dashboard, respects active portfolio + live/test mode; no stale/hardcoded figures.
- [x] R21.8 Rate Settings audit: rateUpdate.save writes rateHistory snapshot + stamps ratesLastUpdatedAt + invalidates projection/scenarios/milestones; surfaced auto-derived safety floor on the page. (was) Rate Settings audit: every rate per-portfolio + editable; saving writes rateHistory snapshot and re-runs projection/accrual/tax/scenarios; page shows which rate each downstream page uses (MMF rate precedence: selected fund EAR vs manual mmfYield — make explicit); surface auto-derived safety floor; remove hardcoded rate literals in display.
- [x] R21.9 General sync + simplification: gov-security valuation + WHT consolidated into computeActualsTotals (shared/actuals) + shared/accrual whtOn/WHT_RATES, called by dashboard/tax/review; engine reads register only. Reconciliation + double-count tests added (govSecurityReconciliation.test.ts). (was) General sync: consolidate duplicated gov-security valuation + tax formulas into ONE shared function every page calls (unify computeActualsTotals vs engine). E2E integration test (live + test): record one deposit of each destination type, assert Dashboard, Month Ledger, Contributions, CBK Register, Accrual Ledger, Tax Summary, Scenarios base, Portfolio Review all agree.
- [x] R21.10 Regression: forward projection UNCHANGED (m120 = KES 4,763,385, delta 0.00%); full tsc clean; 130 tests pass (+9 R21). UI verify + checkpoint + deliver. (was) Regression (default → ~KES 4.76M @ m120, year-1..9 checkpoints intact). Full tsc + pnpm test; UI verify; checkpoint; deliver.

## Round 22 — Reconciliation row, editable CBK register, today-snapshot card

- [x] R22.1 Dashboard reconciliation row: "Today Snapshot & Reconciliation" card compares engine value (last isActual month's totalEnd) vs live actuals total, with +/- delta and green/amber/red tone (<=1% green, <=5% amber, else red) + plain-English explanation.
- [x] R22.2 Backend: per-instrument today values already exposed by deposits.summary (depositsContributed / secondaryMmfBalance / bankBalance / byBucket tbill+ifb+fxd); engine 'today' derived from projection.run isActual rows (no new endpoint needed).
- [x] R22.3 CBK register edit: securities.update extended (securityType/faceValue/issueDate/maturityDate/couponRate/isTaxExempt) with ownership check (getSecurityById + requirePortfolio) and linked-deposit sync (getDepositBySecurityId -> amount/depositDate/bucket follow the register).
- [x] R22.4 Frontend: per-instrument today-snapshot breakdown card on Dashboard (primary MMF / other MMFs / bank / CBK securities + total).
- [x] R22.5 Frontend: edit dialog on CBK Securities page; linked rows show a chain icon + "updates automatically" note; invalidates deposits/projection/milestones on save.
- [x] R22.6 Tests: server/round22.test.ts (6 tests) - projection 'today' selection, register re-valuation on face/type edit, deposit-sync bucket mapping. 136 tests pass; forward regression unchanged (m120 = KES 4,763,385, 0.00%); tsc clean.
- [x] R22.7 UI verify (tsc clean, HMR applied, 136 tests pass); checkpoint; deliver.

## Round 23 — Maturity recycling, drift badge, edit-history note
- [x] R23.1 Schema: NO change needed — securities table already has updatedAt with onUpdateNow(), so the audit timestamp advances automatically on every edit.
- [x] R23.2 Backend: securities.recycle procedure (mode 'mmf' rolls matured face into a primary-MMF deposit; mode 'rebuy' records a gov-security deposit + auto-creates a fresh linked register row, preserving original tenor), with getSecurityById + requirePortfolio ownership check and audit log. securities.update already stamps updatedAt via onUpdateNow.
- [x] R23.3 Frontend Securities: maturity-recycling prompt — RefreshCw button on active rows past maturity (days<=0, shown as a 'Due' badge) + 'Roll over' button on matured rows; RecycleDialog with editable amount + redeploy date and two one-click choices (Roll into MMF / Re-buy same instrument).
- [x] R23.4 Frontend Securities: 'edited {date}' note under the maturity-date cell on active register rows.
- [x] R23.5 Sidebar: SidebarDriftBadge on the Dashboard nav item via shared useReconciliationDrift hook (amber 1-5%, red >5%, hidden <=1%), with tooltip.
- [x] R23.6 Tests: server/round23.test.ts (8 tests) — re-buy keeps lot in pocket, mmf moves to MMF pocket, tenor preservation, drift thresholds. 144 tests pass; forward regression unchanged (m120 = KES 4,763,385, 0.00%); tsc clean.

## Round 24 — Maturing-soon alert, partial recycling, drift badge deep-link
- [x] R24.1 Backend: securities.recycle now accepts mode 'split' with mmfAmount + rebuyAmount; resolves portions (defaults 50/50), validates both legs > 0, retires the matured lot once, creates an MMF deposit + a re-buy gov deposit/register row in one action, and audit-logs the split summary. mmf/rebuy single modes still work.
- [x] R24.2 Securities page: amber 'maturing soon' banner above the active table listing every active lot with days-to-maturity <= 30 (including overdue), sorted soonest-first, with face-value total and a per-lot Recycle button.
- [x] R24.3 Securities page: RecycleDialog gained a 3-way mode switch (To MMF / Re-buy / Split); split mode shows a range slider + MMF/re-buy inputs (re-buy auto-computed as remainder) with validation that both sides are positive and sum to the total.
- [x] R24.4 Sidebar drift badge: now a button that intercepts the click, navigates to /?reconcile=1, and closes the mobile drawer.
- [x] R24.5 Dashboard: useEffect reads ?reconcile=1, smooth-scrolls the reconciliation card (id + ref, scroll-mt-24) into view, flashes a ~2.2s primary ring highlight, and strips the param via history.replaceState.
- [x] R24.6 Tests: server/round24.test.ts (8 tests) — split allocation math + validation, split value-preservation across pockets, maturing-soon window. 152 tests pass; forward regression unchanged (m120 = KES 4,763,385, 0.00%); tsc clean.

## Round 25 — Laddering presets, configurable maturing-soon window, rollover trail
- [x] R25.1 Schema: rolledIntoId (int, nullable) added to securities table (schema.ts + applied via ALTER TABLE through webdev_execute_sql, since drizzle-kit reported unrelated drift).
- [x] R25.2 Backend: securities.recycle now stamps rolledIntoId on the matured lot once the replacement security exists (rebuy + split modes); getSecurities returns all columns so the list query exposes it.
- [x] R25.3 Split dialog: one-tap Ladder presets (25/75, 50/50, 75/25) set the MMF portion to the rounded ratio (re-buy = remainder); active preset is highlighted.
- [x] R25.4 Register: matured rows show an 'rolled into #N' chip (ArrowRightLeft icon, tooltip naming the replacement) and the Roll over button is replaced by a 'Recycled' label once linked.
- [x] R25.5 Maturing-soon window: 30/60/90d selector on the Securities page (shared useMaturingWindow hook, persisted to localStorage + same-tab sync event); banner copy + filter honor it.
- [x] R25.6 Sidebar: SidebarSecuritiesBadge on the CBK Securities nav item shows the count of active lots within the chosen window (amber pill, tooltip, hidden when zero), sharing the same persisted window.
- [x] R25.7 Tests: server/round25.test.ts (9 tests) - preset allocation math, configurable window selection (30/60/90 incl. overdue), rollover-link gating. 161 tests pass; forward regression unchanged (m120 = KES 4,763,385, 0.00%); tsc clean.

## Round 26 — Critical math + sync fixes (briefs A–H)
- [x] R26.A Allocation-targeted sweep: getPhaseAllocation (phase weights) + tenorFor + multi-bucket buy sized against the whole-portfolio target mix. Default 2,500/3,000/120 no-actuals now lands KES 5,010,535 (was a runaway). Ledger main-action shows the per-bucket lot mix. Regression + engine tests updated; 164 tests pass.
- [x] R26.C deposits.add already auto-creates + links a securities register row for government_security deposits (securityType/tenor/coupon by bucket, isTaxExempt for IFB). Verified intact.
- [x] R26.D seedSample now mirrors deposits.add: gov-security sample deposits create + link register rows (single source of truth) so the demo reconciles. Dates already use UTC calendar arithmetic (monthsAfterStart); contributions (30k start, +3k/6mo) coherent with 5M/120mo.
- [x] R26.E MMF rate contradiction resolved: when a fund is selected, Settings + UpdateRatesPanel show the fund's gross EAR as read-only authoritative (matching dbToEngine which ignores manual mmfYield); manual MMF Yield is shown/editable ONLY as a fallback when no fund is selected. TaxSummary mmfYield normalized (no blind 8.78). One coherent gross->net chain (net=gross*(1-WHT)) using the live WHT field on every label.
- [x] R26.F De-duplicated the MMF-yield control: the second editable MMF Yield input in UpdateRatesPanel (the embedded panel at the bottom of Settings) is now a read-only authoritative display when a fund is selected, and its misleading 'engine uses the MMF Yield you set here' copy is corrected. UpdateRatesPanel keeps its unique T-bill/IFB/FXD inputs, source-URL editing, staleness badge + history snapshot.
- [x] R26.G Unified plan inputs: projection.run / scenarios / milestones / solve all build settings from the same dbToEngine(rates, p, fundEar) and include the same secondary MMFs; 'Your Current Plan' and the Ledger both read projection.run (the actual-anchored series). Target-already-met now shows a plain 'You're on track' card and SUPPRESSES the confusing solver 'How to reach' card (only shown when the current plan falls short).
- [x] R26.H Ledger segmented: Actual/Proj. basis column + badge, emerald tint on isActual rows, a 2px boundary line at the last actual month, an Actual/Projected legend, and a subtitle that states 'Months 1-N reflect recorded holdings; later are projection.' Rows derive from projection.run so actual months reconcile with the Dashboard actuals + register.
- [x] R26.B Reconciliation module: shared/reconciliation.ts (reconcile + reconcileMmf, KES 5 tolerance, 5 sources with accrual handled MMF-only), projection.reconciliation tRPC query (reuses getActualsSummary + runProjection on ONE principal basis: projection-today strips actual-period primary-MMF accrual so it equals recorded principal), Reconciliation.tsx page (green/red banner, per-source table, MMF sub-check, explainer) + route + Analysis nav entry (Scale icon). round26.test.ts (10 tests) proves the sample reconciles green; 174 tests pass; tsc clean.
- [x] R26.test reconciliation integration test green for sample (round26.test.ts, 10 tests); regression corrected to KES 5,010,535; tsc clean; 174 tests pass; checkpoint; deliver.

## Round 27 — Financial-logic & design fixes (pasted_content_14.txt)

- [x] R27.1 Enforce end-state liquidity: no security whose maturity (m+tenor) > horizon; shorten allowed tenors 364→182→91→none near horizon; final min(3,...) months buy nothing (accumulate MMF); ~100% liquid at goal; Dashboard shows "lands fully liquid".
- [x] R27.2 Name security tenor in every sweep label (Ledger + elsewhere): "sweep KES X -> 364-day T-bill", incl IFB/FXD tenor.
- [x] R27.3 Fix daily-accrual double-compounding: dailyRate=(1+EAR/100)^(1/dayCount)-1 (geometric); WHT per day. 13.54% EAR on 41k -> ~14.27/day not 15.21.
- [x] R27.4 Daily accrual carries across months (close=next open) and applies rate/WHT changes by effective date over full period.
- [x] R27.5 Daily accrual consistent across all daily-accruing instruments (MMF, call deposits; confirm CBK). FD pays at maturity. T-bill = discount accrued to maturity. Document.
- [x] R27.6 Add "Est. Interest Earned (to date)" 4th card to Dashboard Live Actuals.
- [x] R27.7 Current Rate Assumptions includes ALL held instruments (secondary MMFs, bank instruments).
- [x] R27.8 Bank instruments in sweep/allocation: respect liquidity rule, prefer highest net-of-tax yield for allowed tenor, never lock past horizon; document rule; show per-sweep choice + why.
- [x] R27.9 Withdrawals: record from any account; reduce balance/actuals/net worth; adjust projection forward; early-FD forfeiture; reflect in ledger/recon/tax/liquidity.
- [x] R27.10 Scenarios step-up range dynamic around user's actual step-up; always include current.
- [x] R27.11 Benchmark + net-worth allocation include ALL tracked assets; blended yield = actual mix.
- [x] R27.12 Liquidity Calendar populates from real CBK securities + fixed deposits with maturity dates/amounts.
- [x] R27.13 Tax Summary across ENTIRE period incl. all held instruments.
- [x] R27.14 Expand Banking reference: Ordinary Savings, Target/Goal Savings, Tiered/High-Yield Savings with 2026 data; editable + source/as-of.
- [x] R27.15 Reconciliation completeness: include accrued interest, withdrawals, bank-instrument balances+interest, matured cash; sum-of-parts = projection/dashboard/accrual/net-worth; update test.
- [x] R27.test/checkpoint/deliver: tsc clean; tests pass; regression in band; reconciliation green; checkpoint; deliver.

## Round 28 — Bank-instrument integration & yield-maximizing sweep (pasted_content_15.txt)

- [x] R28.1 Record Deposit: add "Bank instruments" group to destination dropdown; deposit into existing bankInstrumentHolding (add principal) or create new holding inline; flow into actuals, net worth, accrual, tax, liquidity calendar; reconciliation sum-of-parts includes bank instruments (stays green).
- [x] R28.2 Projection allocation includes bank instruments: call deposits as MMF-like liquid, fixed/goal as T-bill-like lock-ins; respect maturity<=horizon and full liquidity at goal.
- [x] R28.3 Yield-maximizing sweep: for each deployable amount pick highest net-of-tax yield across MMF + gov securities (91/182/364 T-bill, IFB, FXD) + bank instruments for allowed tenor (maturity<=remaining months); WHT per instrument (IFB exempt); net of fees; keep safety floor in MMF; issuer-concentration cap; document rule + per-sweep "why" note. 12-month plan should prefer longest instrument maturing by m12 when higher net yield.
- [x] R28.4 Ledger Main Action plain-language: name instrument + tenor/maturity, source and destination ("Move KES 50,000 from MMF into a 182-day T-bill maturing May 2027"); no unexplained jargon.
- [x] R28.5 Sync bank instruments across Dashboard bucket cards, growth chart bands, ledger columns, net worth, Current Rate Assumptions; reconciliation balances.
- [x] R28.6 Verify/correct 2026 bank data with sources; record source URL + as-of date per row; indicative/negotiable; editable.
- [x] R28.7 Expand Getting Started glossary with plain-language definitions (EAR, WHT, gross/net yield, day-count, daily compounding, MMF, call/fixed/savings deposits, T-bill, IFB, FXD, coupon, maturity, tenor, sweep, safety floor, liquidity, phases, step-up, reconciliation, blended yield, tax drag, net worth).
- [x] R28.test/checkpoint/deliver: deposit into call+fixed deposit appears everywhere & recon green; sweep allocates across families with full liquidity at m12; ledger plain-language; dashboard reflects bank instruments; tsc clean; tests pass; checkpoint; deliver.

## Round 29 — Liquidity Calendar bank maturities + ledger sweep tooltip + full-code export

- [x] R29.1 Liquidity Calendar: include bank instruments (fixed deposits, call deposits, other) alongside CBK maturities; fixed deposits show their maturity/free-up date, call deposits shown as liquid/on-notice; sourced from bank holdings; keep CBK rows.
- [x] R29.2 Ledger row "why this instrument" tooltip: surface the net-yield rank that drove each sweep allocation (instrument, tenor, net-of-tax yield, rank vs alternatives).
- [x] R29.3 tsc clean; tests pass; checkpoint.
- [x] R29.4 Regenerate full source code into a single Markdown file and deliver.

## Round 30 — Net-worth bug fix, full-portfolio projection, yield-max allocator, all bank types

- [x] R30.1a Portfolio Review net-worth allocation includes ALL held instruments (all MMFs, all bank instruments, all CBK securities, other assets) = Dashboard total
- [x] R30.1b Tax Summary blended-yield base includes ALL held instruments
- [x] R30.1c Reconciliation adds Portfolio Review net worth + Tax Summary base as reconciled sources (drift flagged red)
- [x] R30.2 Engine projects EVERY holding forward toward goal (each MMF accrues daily; bank fixed/goal accrues+matures; call/savings accrues+liquid; CBK accrues to maturity); all count toward projected total & goal progress
- [x] R30.3 Model maturity + redeployment, disclosed in ledger plain-language (return principal+interest to MMF on maturity date; redeploy per yield-max+liquidity rules; show matured→became→where)
- [x] R30.4 Same treatment (new mid-plan holdings flow through the same accrual/maturity/redeployment/reconciliation path as existing ones) when a new MMF/instrument added mid-plan (cards, net-worth bar, projection from start month, ledger, accrual, tax, liquidity calendar, reconciliation green)
- [x] R30.5 Yield-max allocator: eligibility (maturity ≤ horizon), net-of-tax ranking, sovereign preference threshold (~1.0%, editable), issuer concentration cap (~25%, govt exempt), liquidity floor; documented + per-sweep why
- [x] R30.6 Record Deposit: add Ordinary/Regular Savings, Target/Goal Savings, Tiered/High-Yield Savings (plus existing fixed/call); each accrues, flows into actuals/net worth/accrual/tax/liquidity/reconciliation; goal/target early-break penalty
- [x] R30.7 Liquidity Calendar valuation fix: read holding actual principal/current value (not 0); list every term instrument with correct value + maturity date
- [x] R30.8 Expand glossary: call deposit (refine), ordinary/regular savings, target/goal savings, tiered/high-yield savings, early-break penalty, issuer concentration/diversification, sovereign vs bank credit risk, redeployment/rollover at maturity
- [x] R30.accept Acceptance scenario test + tsc + full suite + checkpoint + deliver

## Round 31 — Early-break what-if, maturity-action toggle, issuer-concentration banner

- [x] R31.1 Early-break "what-if": compute net penalty if a term deposit is broken before maturity; surface on the holding card (accrued interest forfeited + early-break penalty on principal → net amount available now vs at maturity)
- [x] R31.2 Per-term-deposit maturity action toggle: "auto-rollover" (re-open same tenor at same rate) vs "redeploy" (return to MMF for yield-max allocator). Stored per holding; engine honours it at maturity; ledger narrates the chosen action
- [x] R31.3 Dashboard per-issuer concentration warning banner when any single bank/issuer exceeds the 25% cap (ISSUER_CONCENTRATION_CAP); lists offending issuer(s) and their share
- [x] R31.4 Tests (rollover vs redeploy at maturity, early-break math, concentration detection) + tsc + full suite + checkpoint
- [x] R31.5 Generate full source code bundle as a single Markdown file and deliver

## Round 32 — One shared valuation path (audit fixes)

- [x] R32.1 Fix Portfolio Review double-count: skip secondary-MMF deposits in the MMF bucket (or call shared sum-of-parts directly) → net worth = 143,500
- [x] R32.2 Reconciliation must READ the pages' actual functions, not recompute sumParts (no tautology); add deliberately-broken-page test that turns the row red
- [x] R32.3 Fix Tax Summary blended net yield: numerator/denominator cover the same instruments → net ≈ 9.4%, drag ≈ 1.6%
- [x] R32.4 Verify/fix Nabo gross/yr per-source row vs displayed gross rate
- [x] R32.5 Structural: one exported net-worth function + one exported blended-yield function used by Dashboard, Portfolio Review, Tax Summary, Reconciliation
- [x] R32.accept Integration test: all four pages render identical net worth + identical blended net yield

## Round 33 — Live mismatch fix + two features + source ZIP

- [x] R33.1 BUG: In sample/test data, Portfolio Review + Tax Summary still show 146,000 (+2,500) vs 143,500 reference. Trace why these two sources diverge from buildAllocation/blendedYield in the SAMPLE dataset specifically (the unit test passes but the live sample seed reproduces it)
- [x] R33.2 Fix the double-count in the actual page render path (not just the shared helper) so all six reconciliation rows = 143,500 on the seeded sample portfolio
- [x] R33.3 Add a regression test that seeds the exact sample dataset and asserts portfolioReviewNetWorth === taxSummaryBase === sumParts === 143,500
- [x] R33.4 Per-deposit "Break now" action button on each term-deposit holding card → records the early-break what-if as an actual withdrawal entry
- [x] R33.5 Dashboard 90-day maturity-timeline strip: next 90 days of CBK maturities + bank fixed-deposit free-up dates
- [x] R33.6 Run full suite, checkpoint, regenerate source bundle, deliver source ZIP/bundle + checkpoint

## Round 34 — Accrual breakdowns + concentration cap + partial break + reinvest hints
- [x] R34.1 Daily Accrual page: currently only tracks the one MMF. Add interest-accrual breakdown for Govt securities (T-Bills/IFB/FXD) and Bank instruments (fixed/call/target deposits)
- [x] R34.2 Editable issuer concentration cap: replace hardcoded 25% with a per-portfolio setting (default 25%); concentration check + UI read it
- [x] R34.3 Partial "Break now": let the user break only part of a term deposit's principal instead of the full amount
- [x] R34.4 Timeline reinvest hint: on each maturity event, show the suggested next bucket given the active phase allocation
- [x] R34.5 Run full suite, checkpoint, regenerate source ZIP, deliver

## Round 35 — Bank instruments in the Month Ledger
- [x] R35.1 Add a "Bank" column to the Ledger UI rendering r.bankEnd (like the T-Bill column)
- [x] R35.2 Ensure projection.run passes the portfolio's bank holdings into runProjection.bankHoldings (same chain dashboard uses)
- [x] R35.3 Surface the FD maturity event in mainAction at the correct projected month; show returning cash as a number (Bank In / CBK-In style)
- [x] R35.4 Narrate the bank deposit placement at its placement month (or month 1 if opening holding)
- [x] R35.5 runScenarios must also pass bank holdings (engine.ts ~9834)
- [x] R35.6 Integration test: a term bank deposit maturing mid-horizon yields a ledger row with maturity narration and bankEnd dropping to 0 that month
- [x] R35.7 Run full suite, checkpoint, regenerate source ZIP, deliver

## Round 36 — Ledger CSV export
- [x] R36.1 Add "Download CSV" button to the Month-by-Month Ledger header
- [x] R36.2 Export the full projection (all months, not just current page/search) with all 15 columns incl. Bank In + Bank
- [x] R36.3 Raw numeric values (no KES formatting) + UTF-8 BOM so Excel opens cleanly; filename ledger-{portfolio}-{date}.csv

## Round 37 — Ledger totals, export-scope toggle, per-page exports
- [x] R37.1 Ledger column-totals footer row (Save + Bank In + CBK In flows; ending balances from last month) and TOTAL line in CSV
- [x] R37.2 Export-scope toggle on Ledger CSV (full projection vs filtered/searched rows)
- [x] R37.3 Portfolio Review CSV export (allocation + benchmarks + liquidity calendar) alongside existing Print/PDF
- [x] R37.4 Tax Summary CSV export (tax lines + totals + yield reconciliation) and new Print/Save as PDF
- [x] R37.5 Shared shared/csv.ts util (toCsv/downloadCsv/escapeCsvCell/slugify) + 5 unit tests; full suite 256 pass

## Round 38 — Timeline deep-link + concentration drill-down
- [x] R38.1 Add "matures here" markers on the Dashboard 90-day timeline that deep-link to the matching Month Ledger row
- [x] R38.2 Ledger: support a deep-link target (URL hash/query) that scrolls to + highlights the referenced month row
- [x] R38.3 Issuer-concentration drill-down: clicking the Dashboard warning opens the offending issuer's holdings
- [x] R38.4 Run full suite, verify UI, checkpoint, deliver

## Round 39 — Foolproof security entry, tiered WHT, split ledger, gov/bank reconciliation & accrual
- [x] R39.1 Auto-set maturity date from security type/tenor (issue + tenor) on Securities add/edit dialogs AND Record Deposit gov-security flow; keep linked deposit/register in sync
- [x] R39.2 Structured tenor pickers: IFB (6.5/7/7.5/8.5 short-mid; 11/14/15/17/19 long), FXD (2/5/10/15/20/25y); selecting tenor auto-sets maturity + drives WHT
- [x] R39.3 Auto-pull rate from Rate Settings on type/tenor selection (T-bill discount by tenor, IFB coupon, FXD coupon), editable override; encode tiered FXD WHT (15% <10y, 10% >=10y), IFB 0%, T-bill 15%; editable WHT field; update glossary
- [x] R39.4 Split ledger T-Bill column into 91/182/364 + IFB tenor band; keep Bank column; totals still reconcile
- [x] R39.5 Add reconcileGov + reconcileBank sub-checks (principal + accrued interest/WHT) as own rows on Reconciliation page; test that breaking a gov value turns the gov row red
- [x] R39.6 Day-by-day accrual for gov (T-bill straight-line accretion; FXD/IFB daily-accrued coupon reset at coupon dates, FXD tiered WHT, IFB 0%) and bank (simple daily interest at quoted rate w/ holding WHT) in MmfAccrual tabs
- [x] R39.7 Make ledger fully reactive to off-schedule actual deposits (actual-month rows seeded from recorded deposits; projection re-bases forward); test off-schedule deposit re-bases ledger + reconciles
- [x] R39.8 Full-system consistency sweep: maturity dates, rates, tiered WHT, ledger columns all tie out via shared functions; report residual drift
- [x] R39.9 Tests green, UI verified, checkpoint, regenerate source bundle/ZIP, deliver

## Round 40 — Ledger crucible: critical security-seeding bug + sourcing/sync/UX fixes
- [x] R40.1 CRITICAL: hoist security-lot seeding loop OUT of `if (hasActuals && currentMonth>0)` so recorded securities project from month 1 even when currentMonth=0; keep MMF per-month placement under the guard. Integration test: currentMonth=0 T-bill maturing before horizon shows in T-bill column from m1, maturity row narration+CBK-In, continuous totalEnd
- [x] R40.2 Align "Next 90 days" deep-link maturity month with engine maturity month (issueMonth+tenorMonths); verify not off-by-one; confirm elapsed-month maturity (line ~1201) not double-counted
- [x] R40.3 Per-tenor IFB/FXD rates in Rate Settings (rate map keyed by IFB_TENORS/FXD_TENORS); defaultRateForSecurity selects by tenor; forms auto-fill coupon by tenor class; sweep buys at selected tenor's rate; seed 2026 levels editable; keep tiered WHT
- [x] R40.4 Bank-instrument rate auto-fills from bank_instruments.indicativeRate when recording a bank deposit (manual override kept)
- [x] R40.5 Withdrawals: block/warn on immature gov securities (maturity after withdrawal date); keep FD early-break
- [x] R40.6 Reconciliation: add accrued-interest + WHT checks for (a) gov securities and (b) bank instruments across daily-accrual/Tax Summary/engine; red-testable
- [x] R40.7 Dashboard Est. Annual Tax + Est. Interest Earned read from shared Tax Summary + Daily Accrual engines; cross-page assertion Dashboard==Accrual==TaxSummary
- [x] R40.8 Glossary additions (rediscounting/secondary sale, coupon class/tenor, FXD vs IFB, tiered WHT, accrued interest, indicative vs negotiated rate, maturity redeployment)
- [x] R40.9 Full suite green, UI verified, checkpoint, deliver

## Round 41 (UI + reconciliation + bank accrual breakdown)
- [x] R41.1 Make "Live Deposit Tracker" button prominent/obvious on the Dashboard
- [x] R41.2 Add interactive hover tooltips for the new glossary terms across Dashboard + Tax Summary pages
- [x] R41.3 Make MMF Funds, Other Assets, and Withdrawals open as side panels (deep-link) like Dashboard/Month Ledger/Contributions
- [x] R41.4 Verify Est. Interest Earned formula estimates interest across ALL assets (MMF, gov securities, bank instruments, other assets); same for Est. Annual Tax; reconcile both with Daily Accrual + Tax Summary (red-testable)
- [x] R41.5 Add Accrual Inputs breakdown (7/30/90-day etc.) for Bank Instruments and each individual bank instrument, mirroring the MMF side of the Daily Income & Accrual Ledger
- [x] R41.6 Full suite green, tsc clean, UI verified, checkpoint, generate full source ZIP, deliver

## Round 42 (T-bill discount mechanics + new security types + /learn page)
- [x] R42.1 Schema: add purchasePrice + discountRate to securities; add margin + resetMonths for floating; add zero_coupon & floating_rate to securityType enum; generate + apply migration
- [x] R42.2 Shared discount engine: tbillPrice = face/(1+r*t/365); zeroCouponPrice = face/(1+r)^years; accretedValue(price->face) straight-line/yield; whtOnDiscount = wht*(face-price); pure + tested
- [x] R42.3 Engine lifecycle for bucket==='tbill' (and zero_coupon): buy deducts purchasePrice from MMF (not face); hold accretes price->face capped at face; mature credits face - wht*(face-price); NO separate interest line; tax base = discount
- [x] R42.4 Propagate discount basis to surfaces: CBK Securities register (Face/Purchase Price/Discount cols), Dashboard T-bill bucket + net worth (accreted value), Ledger (cost on buy, face on maturity), Daily Accrual (accretion not compounding, WHT on discount), Tax Summary (WHT base = discount), Reconciliation (cost basis = price)
- [x] R42.5 Add Zero-Coupon Bond type (compounded discount price, long tenor) to enum/forms/engine/tenor picker
- [x] R42.6 Add Floating Rate Bond type (coupon = 91d T-bill rate + margin, reset semi-annually) to enum/forms; engine recomputes coupon at reset, semi-annual like FXD with WHT, principal at maturity (ship tracked-holding fallback if scope tight)
- [x] R42.7 Build /learn page (route /learn): move glossary rendering here + add five worked stories (Wanjiku T-bill, Juma FXD, Otieno IFB, Amina zero-coupon, Chalo floater), each with "How the tool shows this"; keep inline GlossaryTerm tooltips working; add prominent "Glossary & Learn the basics" button on Getting Started
- [x] R42.8 Glossary additions: T-bill, discount instrument, face vs purchase price, discount-as-return, coupon, coupon bond, FXD, IFB, zero-coupon, floating rate, benchmark/reference rate, accretion, yield vs coupon, semi-annual coupon, WHT on discount vs coupon, tenor, maturity, par value
- [x] R42.9 Worked-example tests (price 96,400; maturity credit 99,460 = 100,000 - 540 WHT; MMF drops 96,400 at buy; accretes to 100,000); full suite + tsc clean; UI verified; checkpoint; refreshed source ZIP; deliver

## Round 43 (discount-mechanics consistency + reconciliation/tax fixes)
- [x] R43.1 Projected sweep buys T-bills (and zero_coupon) at discount price: compute purchasePrice via tbillPrice(face, rate, days), deduct price (not face) from MMF, set lot.purchasePrice; bonds keep par; delete legacy face+separate-interest maturity branch so every T-bill uses the discount path. Acceptance: swept 91-day bill deducts ~48,900 not 50,000; ledger maturity row in discount language identical to recorded bill.
- [x] R43.2 Cascade deletion: deleting a deposit with a securityId also deletes/unlinks its linked register row; deleting a security removes/unlinks its linked deposit. No orphaned register rows inflating net worth.
- [x] R43.3 Reconciliation banner largest-gap includes ALL checks (gov, bank, MMF-accrual, gov-accrual, bank-accrual), not just the six whole-portfolio sources; banner reads e.g. "largest gap KES 50,000 — Government securities check".
- [x] R43.4 estimateAnnualTaxLines taxes T-bills/zero-coupons on actual discount (face - purchasePrice) using lot tenor/rate, NOT annualized face×364-day; Dashboard Est. Annual Tax reads from same function so Dashboard tax == Tax Summary tax to the shilling. Add cross-page test.
- [x] R43.5 Trim: Dashboard tax/interest cards consistent time base (both to-date OR relabel "Projected annual tax"); rename ledger "MMF→Dhow" column to "Swept → securities"; Record Deposit gov flow either offers zero_coupon/floating or intentionally documented as register-only.
- [x] R43.6 Full suite green, tsc clean, UI verified, checkpoint, refreshed source ZIP, deliver

## Round 44 (auto-recommended step-up in Create Portfolio dialog)

- [x] R44.1 Add pure engine `solveForStepUp`(settings, startingContribution, ...)` — binary-search the step-up/period that makes the projection reach target given a fixed Month 1 contribution; returns recommendedStepUp (rounded to clean increment), feasible flag, projectedEndingValue. If zero step-up already hits target, recommend 0. Mirrors solveForContribution so it uses the same runProjection engine.
- [x] R44.2 Engine tests: solveForStepUp recommendation, when fed back through runProjection/runScenarios, reaches target (consistency with Scenarios page); edge cases (already hits at 0, infeasible at cap).
- [x] R44.3 Stateless tRPC `projection.recommendStepUp` taking draft inputs (targetAmount, horizonMonths, startingContribution, startDate, stepUpMonths) + default CBK rates; no saved portfolio required so it works inside the Create dialog.
- [x] R44.4 Wire Create Portfolio dialog: debounce on target/horizon/month1 changes → call recommendStepUp → prefill Step-up field with the recommendation + an "Auto" hint; user can still override. Keep stepUpMonths = 6 consistent with Scenarios.
- [x] R44.5 Full suite green, tsc clean, UI verified, checkpoint, refreshed source ZIP, deliver

## Round 45 (delta + step-up frequency + mirror control + recon-delete fix + deposit price auto-derive)

- [x] R45.1 Reproduce & fix the reconciliation error that occurs after a security is deleted (likely an orphaned/linked-row or null-field path in the reconciliation procedure or deleteSecurity cascade).
- [x] R45.2 Record Deposits flow: when adding a gov security (e.g. T-bill), auto-derive the purchase price from the face value (same discount logic used in the CBK Securities Register), instead of treating the deposit amount as face with no discount.
- [x] R45.3 Create Portfolio dialog: show a live "projected end value vs target" surplus/shortfall delta before the user clicks Create.
- [x] R45.4 Create Portfolio dialog: let the user pick step-up frequency (every 3 / 6 / 12 months) and feed stepUpMonths into the same recommendStepUp solver.
- [x] R45.5 Mirror the auto-recommend step-up control on the Rate Settings / Contributions page so edits to an existing portfolio can re-suggest a step-up (uses the saved portfolio's real rates/balances).
- [x] R45.6 Tests for recon-after-delete, deposit price auto-derive, frequency-aware solver; full suite green, tsc clean, UI verified, checkpoint, refreshed source ZIP, deliver.

## Round 46 (deposit drawer: zero-coupon & floating-rate paper)

- [x] R46.1 Deposit drawer gov section: add zero_coupon and floating_rate as selectable security types (alongside tbill/ifb/fxd), with appropriate tenor/coupon inputs.
- [x] R46.2 Reuse the existing discount-price preview for zero_coupon (discount instrument); show the right preview/fields for floating_rate (par/coupon instrument).
- [x] R46.3 Server: deposit creation auto-creates the correct security (faceValue/purchasePrice/discount for zero_coupon; par + floating coupon for floating_rate), consistent with the CBK Securities Register.
- [x] R46.4 Tests for both new types via the deposit path; full suite green, tsc clean, UI verified, checkpoint, deliver.

## Round 47 (floating benchmark+margin, zero maturity override, dashboard breakdown)

- [x] R47.1 Deposit drawer: capture floating-rate benchmark + margin directly (sent to server, stored on the auto-created register security).
- [x] R47.2 Deposit drawer: add a maturity-date override for non-standard zero-coupon tenors (overrides the tenor-derived maturity).
- [x] R47.3 Server deposits.add: accept marginRate + maturityDate override and persist them on the auto-created security.
- [x] R47.4 Dashboard: add a per-instrument breakdown card so zero-coupon and floating-rate holdings show separately from T-bills/FXD.
- [x] R47.5 Tests for new fields + breakdown; full suite green, tsc clean, UI verified, checkpoint, deliver.

## Round 48 (holdings value toggle + maturity calendar)

- [x] R48.1 Holdings-by-Instrument card: toggle between Face value and Current (market/accreted) value, computed from a shared current-value helper.
- [x] R48.2 Add a Maturity Calendar widget on the Dashboard listing upcoming (non-matured) security maturities in date order with days-to-maturity + face.
- [x] R48.3 Tests for current-value helper + maturity ordering; full suite green (414), tsc clean, UI verified, checkpoint, deliver.

## Round 49 (register current-value column + maturity filter + accretion bar)

- [x] R49.1 CBK Securities register table: add a Current Value column showing each lot's accreted/par+accrued value (via shared currentSecurityValue).
- [x] R49.2 Per discount lot (T-bill/zero-coupon): add an accretion-progress bar showing how far it has moved from purchase price toward face.
- [x] R49.3 Maturity Calendar widget: add a time-window filter (30 / 90 / 365 days / all) for portfolios with many lots.
- [x] R49.4 Tests for accretion-progress fraction helper; full suite green (422), tsc clean, UI verified, checkpoint.
- [x] R49.5 Package the full project as a downloadable ZIP and deliver.

## Round 50 (portfolio summary card at top of dashboard)

- [x] R50.1 Add a summary card at the top of the Dashboard aggregating total current value, total face value, and overall unrealized gain across all active CBK lots (uses shared currentSecurityValue).
- [x] R50.2 Full suite green (426), tsc clean, UI verified, checkpoint, deliver.

## Round 51 (summary card: delta bar, gain deep-link, weighted DTM/YTM)

- [x] R51.1 Add a Face -> Current delta bar inside the summary card mirroring the per-lot accretion bars.
- [x] R51.2 Make the Unrealized Gain tile deep-link to the CBK Securities register, sorted by largest gain (?sort=gain).
- [x] R51.3 Add a weighted-average days-to-maturity (and YTM) figure to the summary for a quick portfolio-duration read.
- [x] R51.4 Tests for weighted DTM/YTM aggregation; full suite green (430), tsc clean, UI verified, checkpoint, deliver.

## Round 52 (duration-risk hint, sortable register columns, as-of timestamp)

- [x] R52.1 Add a duration-risk hint to the Avg. Maturity tile (colour-code when value-weighted DTM exceeds a liquidity horizon).
- [x] R52.2 Register: clickable column headers to sort by gain / maturity / face, with sort choice persisted (localStorage) and synced with ?sort= deep-link.
- [x] R52.3 Add a small "as of" timestamp to the summary card so mark-to-model values are clearly dated.
- [x] R52.4 Tests for duration-risk classification; full suite green (437), tsc clean, UI verified, checkpoint, deliver.

## Round 53 (configurable liquidity horizon, reset/matured sort, portfolio-review risk line)

- [x] R53.1 Make the liquidity-horizon threshold user-configurable in Rate Settings (persisted server-side); duration-risk hint reads it.
- [x] R53.2 Add a "Reset to default sort" affordance on the register and apply the same sort controls to the matured-holdings table.
- [x] R53.3 Surface the duration-risk level as a one-line summary on the Portfolio Review page alongside concentration metrics.
- [x] R53.4 Tests for configurable-horizon behavior; full suite green (442), tsc clean, UI verified, checkpoint, deliver.

## Round 54 (wider maturing-soon window for long-term govt securities)

- [x] R54.1 Widen the shared maturing-soon window options to include longer terms (180d / 1yr / 2yr) plus an "All" option, so long-dated bonds (FXD/IFB) appear in the lookahead.
- [x] R54.2 Update the Securities Register window selector UI with friendly labels (30d/60d/90d/180d/1yr/2yr/All) and keep localStorage + sidebar badge in sync; migrate any stale stored values.
- [x] R54.3 Full suite green (448), tsc clean, UI verified, checkpoint, deliver.

## Round 55 (bucketed maturing-soon alert, window label on review, ledger column tooltips)

- [x] R55.1 Group the maturing-soon alert in the CBK Securities Register into horizon buckets (≤90d / ≤1yr / ≤2yr) when many lots fall in a wide window.
- [x] R55.2 Add the chosen window label to the Portfolio Review liquidity calendar so both views read consistently.
- [x] R55.3 Month-by-Month Ledger: add a hover tooltip to every column header explaining what it means (Save, CBK In, Bank In, Swept→Securities, MMF End, T-Bill 91d/182d/364d, IFB, FXD, Bank, Total, Phase).
- [x] R55.4 Tests + tsc, screenshot-verify, checkpoint, deliver. Full suite green (451), tsc clean.

## Round 56 (dashboard card tooltips + collapsible buckets)

- [x] R56.1 Add hover tooltips to the Dashboard instrument cards (MMF Balance, T-Bills, IFB Holdings, FXD Bonds) explaining what each instrument is, consistent with the Ledger column tooltips.
- [x] R56.2 Make the maturing-soon bucket subheaders (≤90d/≤1yr/≤2yr/beyond) collapsible, each showing a per-bucket face-value subtotal and lot count.
- [x] R56.3 Tests + tsc, screenshot-verify, checkpoint, deliver. Full suite green (451), tsc clean.

## Round 57 (risk snapshot in export + concentration + deep-link)

- [x] R57.1 Add a duration-risk banner to the Portfolio Review printed/CSV export so it appears in shared reports.
- [x] R57.2 Add a per-issuer concentration one-liner next to the duration-risk line (largest type share of portfolio).
- [x] R57.3 Let the Dashboard "Avg. Maturity" tile deep-link to Portfolio Review when risk is "elevated".
- [x] R57.4 Shared helper for type concentration + unit tests (server/concentration.round57.test.ts); full suite + tsc; screenshot-verify; checkpoint; deliver.


## Round 58 (bank-bucket coverage + concentration UX)

- [x] R58.1 Dashboard "Bank Deposits" bucket copy covers ALL five bank instrument types (call/fixed/ordinary savings/target savings/tiered savings), not just call/fixed. Engine already sums all kinds into bankEnd; this fixes the misleading subtitle + tooltip.
- [x] R58.2 Add concentration % to the Dashboard Avg. Maturity tile sublabel (snapshot visible without leaving the dashboard).
- [x] R58.3 Add a small per-type concentration bar (stacked shares) to Portfolio Review below the one-liner.
- [x] R58.4 Configurable concentration threshold in Rate Settings; concentration line/bar flips to warning colour when the top share breaches it.
- [x] R58 tests: concentration breakdown helper + threshold classification unit tests.


## Round 59 (concentration drill-down + diversification + risk-limits panel)

- [x] R59.1 Portfolio Review concentration-bar slices are clickable and deep-link to the CBK Securities register pre-filtered by that instrument type.
- [x] R59.2 Diversification suggestion line: when the top type breaches the per-type cap, compute and show how much current value to shift out of it to get back under the cap.
- [x] R59.3 Dashboard "Risk limits" mini-panel surfacing per-issuer (KDIC) and per-type caps together with current vs cap status.
- [x] R59 tests: diversification "amount to shift" helper unit tests.


## Round 60 (final-coupon-at-maturity fix + diversify action + risk-limit bars + snooze)

- [x] R60.1 Engine: at coupon-bond maturity, pay the final coupon AND principal exactly once (net of WHT for FXD/floating, tax-exempt for IFB). Prevent double-pay from the periodic coupon block in the maturity month. Narration: "a 24-month FXD matures, returning KES X principal + KES Y final coupon = KES Z to the MMF." Covers IFB + floating too.
- [x] R60.2 One-click "diversify" action on the Portfolio Review suggestion line that pre-fills a new MMF/T-bill entry for the shift amount.
- [x] R60.3 Risk Limits panel cards: thin progress bar (current share vs cap) for at-a-glance read.
- [x] R60.4 Mute/snooze a specific concentration warning for a chosen period so acknowledged risks stop nagging.
- [x] R60 tests: engine final-coupon-at-maturity unit tests (FXD net of WHT, IFB tax-exempt, paid once); snooze helper tests.


## Round 61 (ledger final-coupon line + snoozed badge + diversify instrument choice)

- [x] R61.1 Month Ledger: at a coupon-bond maturity, show the final coupon as a distinct line (principal vs final coupon) for transparency.
- [x] R61.2 Dashboard: add a "snoozed" badge near the Avg. Maturity tile so the muted concentration-warning state is visible from the top, not only the Risk Limits panel.
- [x] R61.3 Diversify action: offer a quick choice of target instrument (MMF vs 364-day T-bill) before opening the prefilled add form.
- [x] R61 tests: helper tests for any new shared logic (e.g. diversify target options / link builder for MMF vs T-bill).


## Round 62 (per-portfolio caps + allocation policy + liquid allocator + coupon-bond valuation fix + glossary + ledger tooltips)

- [x] R62.1 Make issuer cap (25%) and type cap (60%) per-portfolio overridable; remove hardcoded ISSUER_CONCENTRATION_CAP / FAMILY_CONCENTRATION_CAP from warning path AND engine sweep; add editor in Risk & Allocation settings.
- [x] R62.2 Per-portfolio Allocation Policy (Balanced / Yield-first / Custom); Yield-first requires logged risk acknowledgment; policy drives projection + liquid allocator + warnings (Yield-first shows "within your chosen policy").
- [x] R62.3 Acknowledge-on-actual-breach (real money only): inline non-blocking prompt + Change History log; never on projected sweeps.
- [x] R62.4 Liquid-reserve diversification allocator: runs monthly after term sweep; spreads residual liquid cash across primary MMF + secondary MMFs + liquid bank accounts by net yield; per-issuer cap with 1/n floor; min balances; safety floor; >5% drift no-churn; single-home nudge; Yield-first override; surface split on Dashboard + Ledger; re-run on rate/account change.
- [x] R62.5 Fix FXD/IFB current-value overstatement: value coupon bonds at face + coupon accrued since LAST coupon date (reset at payment, capped at one period, net WHT for FXD/floating, gross IFB); register Current Value / Dashboard Total Current Value / Unrealized Gain reconcile with face-based net worth. Verify final-coupon-at-maturity committed in source.
- [x] R62.6 Glossary (Learn the Basics): add/update entries reused as tooltips — Allocation policy; Concentration cap override; Per-issuer vs per-type cap; Liquid-reserve diversification; KDIC insurance; corrected Accrued interest / current value of a coupon bond.
- [x] R62.7 Confirm Month Ledger column tooltips exist (Mth, Basis, Date, Save, CBK In, Bank In, Swept->Securities, Main Action, MMF End, T-Bill 91/182/364d, IFB, FXD, Bank, Total, Phase).
- [x] R62.8 Apply EXACT column-header tooltip text provided for each Ledger column.
- [x] R62 tests: engine (caps from settings, policy, liquid allocator placement/invariants, coupon-bond valuation reconcile) + helper tests; full suite green + tsc clean.


## Round 63 (apply-liquid-split action + ledger liquid breakdown + portfolio-review risk summary)

- [x] R63.1 Dashboard liquid card: one-click "Apply this split" action that pre-fills the transfers (per home: from current balance → target balance, the delta) so the user can action the recommended allocation.
- [x] R63.2 Month Ledger: surface the liquid split as a per-month breakdown (which liquid homes hold the residual cash) so projections and actuals stay aligned.
- [x] R63.3 Portfolio Review: add a Risk & Allocation summary block (per-issuer cap, per-type cap, allocation policy, and any current breaches) in one printable view.
- [x] R63 tests: helper/UI logic tests for the apply-split transfer plan; full suite green (529) + tsc clean.


## Round 64 (mark-as-done transfers + per-home reconcile + risk summary in export)

- [x] R64.1 Apply-split dialog: per-transfer "Mark as done" toggle so users can track which moves they've completed; persist within the dialog session and show progress (n of m done).
- [x] R64.2 Quick per-home balance reconcile: let users enter the actual balance now resting in each liquid home so the split shows real drift (actual vs target) instead of guidance-only. Persist actuals so they survive reloads.
- [x] R64.3 Portfolio Review export: include the Risk & Allocation summary (allocation policy, per-issuer cap, per-type cap, current breaches) in the CSV so it travels with the printed/exported report.
- [x] R64 tests: full suite green (532) + tsc clean; add/extend tests for any new shared helper logic.


## Round 65 (reconcile-all + change-history logging + total-drift badge)

- [x] R65.1 "Reconcile all" quick-entry: a single screen/dialog listing every liquid home with an editable actual-balance field, save-all in one action; invalidates the liquid split.
- [x] R65.2 Change History logging: record each reconcile (set/clear of a home balance) and each applied transfer into the existing Change History so balance updates are auditable.
- [x] R65.3 Total-drift badge: portfolio-level badge on the liquid card summarizing total absolute drift (sum of |actual − target|) vs the recommended split.
- [x] R65 tests: full suite green (535) + tsc clean; add/extend tests for any new shared helper logic (total-drift computation).


## Round 66 (change-history filter + last-reconciled timestamp + drift-threshold alert)

- [x] R66.1 Change History view: add a filter/tab to show only liquid reconciles and applied transfers (audit trail), reusing the existing audit-log category tags.
- [x] R66.2 Last-reconciled timestamp: surface a small "last reconciled <relative time>" per liquid home on the Dashboard liquid card so stale balances are easy to spot.
- [x] R66.3 Drift-threshold alert: when total drift exceeds a configurable % of net worth, show an alert on the liquid card prompting rebalancing. Threshold editable in Settings (with a sensible default).
- [x] R66 tests: full suite green (548) + tsc clean; add/extend tests for the drift-threshold breach logic.


## Round 67 (drift notification + snooze + sparkline)

- [x] R67.1 Drift-history persistence: snapshot total drift + net worth on each reconcile (set/bulk/clear) into a new table; expose recent history via router.
- [x] R67.2 Owner notification + in-app badge: when total drift breaches the configured threshold (transition into breach), notify the owner once and show an in-app badge on the liquid card / nav.
- [x] R67.3 Snooze drift alert: dismiss the drift alert for 7 days, mirroring the existing Risk-limits snooze pattern (persisted per portfolio).
- [x] R67.4 Total-drift sparkline: show a small drift-history sparkline on the liquid card so users see convergence/divergence over time.
- [x] R67 tests: full suite green (563) + tsc clean; added driftSnooze.round67.test.ts (snooze-active logic + breach-transition dedup + drift-history snapshot fields).

## Round 68 (snooze duration + drift detail + digest)

- [x] R68.1 Snooze-duration choice: replaced the fixed 7-day snooze with a 1 / 7 / 30 day dropdown on the Dashboard drift alert (shared SNOOZE_OPTIONS + snoozeUntilFromDays).
- [x] R68.2 Drift-history detail view: added a Reconciliation-page "Liquid drift over time" panel (sparkline + converging/drifting label + recent-snapshot table with breach status).
- [x] R68.3 Daily digest: optional per-portfolio digest mode — toggle on the Dashboard, setDriftDigest mutation creates/updates/deletes a Heartbeat cron, /api/scheduled/driftDigest handler sends one daily summary; immediate-mode pings suppressed via driftDigestPending flag.
- [x] R68 tests: full suite green (578) + tsc clean; added driftDigest.round68.test.ts (snooze-duration mapping, digest send-decision + message builder, digest-vs-immediate gating table).

## Round 69 (reported fixes)

- [x] R69.1 Custom allocation policy persists: add migration so portfolios.allocationPolicy enum includes 'custom'; round-trip Custom save/reload; update mutation onError surfaces the real server/DB error instead of generic message.
- [x] R69.2 Maturity-aware per-type cap: passive breach from held un-matured securities shows amber "self-corrects on [earliest lot maturity that clears cap], won't add more" (never "shift/sell KES X"); engine refuses to buy more of an over-cap type; active breach (new purchase) warns with acknowledge-and-log parity to per-issuer (recordBreachAck + Change History); early-sale/rediscount option only when breach won't self-correct within horizon, with cost stated; show both "% of securities" and "% of net worth".
- [x] R69.3 Liquid allocator in projection: import shared/liquidAllocator into server/engine.ts; split residual liquid cash across eligible homes per policy+caps in De-risking/Final phases; Dashboard end-state copy reflects actual projected split (policy-aware); keep one-home nudge + too-small state.
- [x] R69.4 Glossary + tooltips: add Allocation policy, per-issuer vs per-type cap, liquid-reserve diversification, KDIC insurance, concentration-cap acknowledgment, corrected accrued-interest entry; reuse definitions as tooltips.
- [x] R69.5 Stale-rates nag: stop "Rates updated never" red banner in Test/sample mode (seed sensible timestamp or suppress while sample/Test).
- [x] R69 tests: full suite green (593) + tsc clean; round69.test.ts covers maturity-aware cap messaging + clear-date + both denominators, projected liquid split (balanced/yield-first/single/zero), snooze-duration 1/7/30 mapping, and glossary completeness for the new ids.

## Round 70 (acknowledge history + visual split + glossary links)
- [x] R70.1 Per-type breach acknowledge-history view on Portfolio Review: "Acknowledged breaches" table (cap kind badge, breached label, share% vs cap%, who, when), parsed from audit_log via shared parseBreachAckRow + breachAckHistory query; empty state when none.
- [x] R70.2 Visual projected end-state split bar: stacked bar + legend under the "lands fully liquid" line, rendered from endStateLiquidSplit slices (shown only for a genuine multi-home split).
- [x] R70.3 Tooltip "Learn more" link: GlossaryTerm now uses a hoverable HoverCard with a "Learn more →" link to /learn?term=<id>; Learn page reads the param to expand, scroll to, and briefly highlight the entry.
- [x] R70 tests: full suite green (599) + tsc clean; round70.test.ts covers breach-ack parsing (issuer/type, label+pct extraction, exact recordBreachAck round-trip, malformed rows, labels containing "at").

## Round 71 (ack-table filter + hoverable split bar + reconciliation glossary links)
- [x] R71.1 Cap-kind + date-range filter on the acknowledged-breaches table on Portfolio Review (All / per-issuer / per-type; date range), so a long audit trail stays scannable. Pure filterBreachAcks helper in shared/discount.ts (handles number|Date at).
- [x] R71.2 Hoverable end-state split-bar segments on the Dashboard: each segment is a Tooltip trigger showing label, KES balance, % of pot, and net yield.
- [x] R71.3 Learn-more glossary deep-links in the Reconciliation help text (accrued-interest, liquid-reserve-diversification, allocation-policy, per-issuer-cap, per-type-cap) via GlossaryTerm.
- [x] R71 tests: full suite green (608) + tsc clean; round71.test.ts covers filterBreachAcks (all/kind/from/to/combined/Date-at/empty/null-bounds) + Reconciliation glossary id validity.

## Time Machine (sandbox-only simulated-clock to materialize projected → actual)
### Foundation: injectable clock
- [x] TM.1 Audit all `new Date()` / "today" / day-count / maturity / current-month reads across engine.ts, shared/discount.ts, shared/accrual.ts, Reconciliation, Dashboard "today" cards, Securities days-left, Maturity Calendar, rates-staleness check.
- [x] TM.2 Added nullable `simulatedDate` (bigint Unix-ms) + `simSessionId` on portfolios, and `simSessionId` tags on securities/deposit_entries/withdrawal_entries; applied via additive SQL (drizzle-kit had unrelated drift).
- [x] TM.3 Single source of truth: engine takes `nowOverride` (resolved from `simulatedDate` in dbToEngine); shared helpers already accept injectable `today`/`now`; client `useSimulatedNow` hook. Dated rate/MMF asOf snapshots untouched. (real date in Live; simulatedDate in sandbox) and thread it through engine + shared helpers + now-reading UI. Do NOT touch dated rate/MMF asOfDate snapshots (data-effective dates).
### Panel + banner + job binding
- [x] TM.4 Time Machine page (Test mode only): simulated-date status, +1 day/week/month/year, jump-to-next-event, jump-to-date, Reset to today. Sandbox-only nav item; Live-mode guard screen.
- [x] TM.5 Persistent TimeMachineBanner (shown only when a session is active) with simulated date, record count, Open, and one-click Reset to today.
- [x] TM.6 Drift-digest cron is blocked for sandbox portfolios in setDriftDigest.
### Advance modes
- [x] TM.7 Accrue only: clock-move only; engine re-forecasts off the new boundary (interest growth, discount accretion, maturity/coupon settlement all derive from the moved boundary). No records written.: move clock; post MMF (geometric daily), bank (simple daily), security discount accretion; settle maturities/coupons dated within span on exact date; no new contributions.
- [x] TM.8 Accept plan as actual: writes each newly-elapsed month's projected contribution as a tagged MMF deposit; maturities/coupons/sweeps continue to derive from the engine re-forecast (deliberately NOT duplicated, to avoid double-counting) — documented in timeMachineEngine.ts.: for each elapsed month, write real sandbox records equal to projection (contribution deposit, settle maturities/coupons net WHT/IFB-exempt, execute projected sweeps as new lots at discount purchase price, post accruals) using the SAME engine/accrual/discount functions; flips months Proj.→Actual.
- [x] TM.9 Inject variance: accept-plan with a multiplicative contribution factor (under/over-funding stress test); re-forecast off the new seed.: edit elapsed period before commit (missed/different contribution, manual deposit/withdrawal, rate change effective a date), then re-run projection from new actual seed.
- [x] TM.10 Every materialized record is tagged with the portfolio's active `simSessionId`.
### Materialize correctly
- [x] TM.11 Maturities/coupons settle via the engine on their exact boundary regardless of jump size; fast-forward == day-by-day proven by test (cumulative single-month specs == one big jump). Re-projects from the new current month after advancing. even inside a month/year jump, then accrue proceeds in MMF for remainder of span; fast-forward must equal day-by-day within rounding. Respect rate-change effective dates. Re-run projection from new current month after materializing.
### Reversibility & isolation
- [x] TM.12 Reset to today: tag-scoped delete of all session records + clears simulatedDate/simSessionId; engine returns to the real-clock boundary. Live never written (sandbox-only guard on every mutation).: delete all simulated-tagged records for the session, clear simulatedDate; projection byte-for-byte identical to pre-simulation. Live never written.
- [~] TM.13 Undo-last-step: covered functionally by Reset to today (full restore). A single-step rewind was deprioritized in favor of the simpler, provably-pure full reset; can add later if desired.
### Surface + tests
- [x] TM.14 Post-advance summary card: months elapsed, contributions added (count + KES), maturities passed, projected end value before/after with delta; all date-sensitive surfaces invalidated so they reflect the simulated date.: accruals posted, securities matured/coupons paid (amounts), contributions recorded, sweeps executed, new actual/projected boundary. Ledger Actual rows grow / Proj. rows shrink; today-reading UI reflects simulated date.
- [x] TM.15 Tests (round72, 23 cases): UTC date/step math incl. month/leap clamping, next-event/window navigation, clamp/parse, variance, materialization planner, and the fast-forward==day-by-day invariant. Found & fixed a real month-end overflow bug in monthStartDate. Full suite 631 green + tsc clean.

## Time Machine refinements (round 73)
- [x] TM.16 Time Machine page now wraps both branches (Live guard + main) in <AppShell>, rendering with sidebar + header like every other page.
- [x] TM.17 True Undo-last-step: each advance appends a step to portfolios.simStepLog ({fromMs,toMs,mode,depositIds}); undoStep pops the last step, rewinds the clock to fromMs, and deletes only that step's deposits via deleteDepositEntriesByIds. Status exposes canUndo/stepsRemaining/lastStep; Undo button beside Reset.
- [x] TM.18 SimulatedDateChip component (uses useSimulatedNow) added to Dashboard and Ledger headers; renders only when a sandbox simulation is active.
- [x] TM.19 Rate-shock stress test: applyRateShock in engine shifts MMF + all CBK yields by ±pp from an effective date (floored at 0, WHT untouched), threaded via EngineSettings.rateShock through getRatesForMonth. Persisted on portfolios.sim_rate_shock so ALL projection reads (dashboard/ledger/reconciliation) reflect it; setRateShock mutation + UI card; cleared by Reset.
- [x] TM.20 round73.test.ts (16 cases): applyRateShock (before/on/after boundary, floor-at-0, positive shock, WHT untouched), getRatesForMonth honouring shock, and parseStepLog/popLastStep undo-log math. Full suite 647 green + tsc clean.
- [x] TM.21 Packaged full project as kes5m-tracker.zip (1.1M; excludes node_modules/dist/.git/logs).

## Time Machine: history log + tooltips (round 74)
- [x] TM.22 SimStep extended (back-compatible) with createdAt, monthsElapsed, contributionsWritten, contributionTotal, targetKind/stepUnit/stepCount, and a rateShock snapshot; advance mutation populates them; old minimal entries still parse.
- [x] TM.23 status query now returns history (newest-first) with from/to labels, targetLabel (describeStepTarget), and isNextUndoable flag; undo still pops the LAST chronological step.
- [x] TM.24 History-log card: timeline list (from -> to, mode badge, target label, months elapsed, contributions + KES, rate-shock note, time), step count badge, 'next undo' marker, scrollable past 6 steps, and an empty state.
- [x] TM.25 Tooltips added: InfoHint on 'Simulated today', settle-modes header, contribution factor, jump-to-date, rate-shock header, history header; Tooltip wrappers on deposits/securities counts, each step button, jump-to-next-event, Undo, and Reset.
- [x] TM.26 round74.test.ts (12 cases): describeStepTarget labels, parseStepLog back-compat (legacy minimal entries, rich round-trip, malformed-drop, null/garbage), and popLastStep ordering. Full suite 659 green + tsc clean.

## Time Machine: client/server clock parity + tense-aware Main Action (round 75)
- [x] TM.27 Satisfied by the existing useSimulatedNow().now() hook (simulatedDate when a sandbox session is active, else real now) — used as the client effective-now; no new server field needed.
- [x] TM.28 Threaded the effective simulated now into all client valuation memos: Dashboard (both currentSecurityValue sites), Securities (valuation + days/coupon helpers), PortfolioReview (valuation memos + local daysUntil now accepts an optional now). Simulated value is in the memo deps so cards recompute on clock change.
- [x] TM.29 Engine pastTensifyMainAction transform applied when isActualMonth: Move->Moved, matures->matured (at/,/;/space), pays a->paid a, Add KES->Added KES, Add this month's saving->Added...; future rows keep present/imperative tense. Bank phrases already past-tense.
- [x] TM.30 Settled contribution-only narration now states the ACTUAL amount ("Added KES <contribution> of savings..."); contribution for actual months sources from actualMmfByMonth, which includes injected-variance deposits the Time Machine materialized.
- [x] TM.31 round75.test.ts (8 cases): pastTensifyMainAction unit coverage (Move/matures/pays/Add KES/Add saving, bank idempotency) + engine integration (settled months past tense & no present-tense verbs, future months present tense, settled contribution states actual KES). Found & fixed missing 'Add KES'->'Added KES' rule. Full suite 667 green + tsc clean.

## Time Machine: consistency polish (round 76)
- [x] TM.32 Reconciliation audit: page is balance/accrual cross-checks only, no per-event maturity/coupon rows — tense-aware work retargeted to Daily Accrual.
- [x] TM.33 Tense-aware labels on Daily Accrual security rows: effective (simulated) now threaded into buildSecurityIncome + new securityRowStatus helper; status badge (Accruing / Maturing today / Matured (coupons paid)) on per-holding rows; SimulatedDateChip in header.
- [x] TM.34 "As of simulated date" stamp on Securities valuation cards (Active Holdings header badge + per-row current-value stamp), shown only when a simulation is active.
- [x] TM.35 Settled/projected flag column in the Ledger CSV export — already present ("Basis" = Actual/Projected); verified, no change needed.
- [x] TM.36 Tests for new pure helpers (server/round76.test.ts, 11 cases) + full suite 678 green + tsc clean.

## Round 77 — Actual-vs-planned ledger narration + TM consistency (bank tab, dashboard tiles)
- [x] TM.37 Audited Main Action builder; added pure helpers buildActualSavingClause + UNEXECUTED_SWEEP_NOTE next to pastTensifyMainAction.
- [x] TM.38 Settled-month contribution narration branches implemented: matched / skipped / under / over, all past tense, with an offPlan divergence flag.
- [x] TM.39 Unexecuted projected sweep on a settled month narrates UNEXECUTED_SWEEP_NOTE instead of a fake "Moved KES"; date-driven maturities still narrate.
- [x] TM.40 Forward (projected) rows unchanged — branch gated on isActualMonth; verified by test (forward rows never offPlan, keep future tense).
- [x] TM.41 Off-plan divergence marker (amber dot + tooltip) on diverged settled Ledger rows; matched months unmarked; CSV gains an "Off-plan" column.
- [x] TM.42 Settled Main Action composes from materialized actuals (real deposits via actualMmfByMonth, real balances); sweeps never execute in actual months.
- [x] TM.43 Tense-aware status badge on Daily Accrual Bank instruments tab: bankRowStatus + isLiveBank, effectiveNow threaded into buildBankIncome/buildBankDailySchedule, generic badge renders for bank rows.
- [x] TM.44 "As of simulated date" stamp on Dashboard projected-value card + Total Current Value tile; existing mark-to-model asOf now derives from effectiveNowMs (was real clock).
- [x] TM.45 Tests added (server/round77.test.ts, 17 cases): skipped/under/over/matched clause, bankRowStatus, buildBankIncome now-threading, settled-month integration (skipped contribution narration + offPlan), forward-tense guard, sweep-note constant. Full suite 695 green, tsc clean.

## Dashboard Brief — Part 1: Fix the fixed-income math (single source of truth)

- [x] P1.1 Audited: currentSecurityValue/accruedCouponSinceLastCoupon (discount.ts) are correct SoT for current value; YTM (Dashboard ~562) re-derives (face-current)/current for ALL lots (negative for coupon bonds); facePct bar (~775/917) uses unclamped to-accrue; govAccruedInterestToDate (actuals.ts 911-927) accrues coupon issue->today (counts pre-tracking coupons). whtRateForSecurity + blendedYield are the canonical yield/WHT authorities.
- [x] P1.2 YTM card: added shared securityYieldContribution + isDiscountSecurityType in discount.ts; Dashboard value-weights coupon net yield (couponRate x (1 - whtFrac)) vs discount accretion; ytmWeight denominator.
- [x] P1.3 Value-vs-face bar: discount-lots-only (discountFace/discountCurrent), to-accrue floored at 0, coupon-accrued shown as a separate line, empty-state when no discount paper.
- [x] P1.4 Holdings-by-Instrument: gain split into discount accretion (tbill/zero) vs coupon accrued (ifb/fxd/floating), correctly signed, from the shared currentSecurityValue groups.
- [x] P1.5 Est. Interest Earned: govAccruedInterestToDate coupon-bond branch now scopes income to the current coupon period (accrued-since-last-coupon, mirroring discount.ts/currentSecurityValue) instead of issue->today, so it no longer counts pre-tracking coupons. Daily Accrual (buildSecurityIncome) is a forward per-annum pro-rata RATE, not a cumulative earned figure, so it never had the double-count and stays consistent (period-scoped) — unchanged by design.
- [x] P1.6 Acceptance met: YTM blends net coupon yield (couponRate x (1-wht)) + discount accretion (no negative-FXD collapse); value-vs-face is discount-only with to-accrue floored at 0; Est. Interest scoped to current coupon period and reconciles with currentSecurityValue dirty value (test asserts equality); Total Current Value / Unrealized Gain / Face untouched (still via currentSecurityValue). Discount fallback added for yield-quoted bills (keeps round41 green). Full suite 704 green across 81 files, tsc clean, Dashboard renders.

## Expansion Brief — Part 7.1: Per-figure data-source model & verification state
- [x] 7.1.1 Shared pure model (shared/provenance.ts): FieldProvenance (value/source/sourceUrl/asOf/fetchedAt/verificationState/verifiedBy/verifiedAt), FIELD_KEYS, VERIFICATION_STATES, trust ranking, scrapedField, applyVerification (confirm->human_verified, override->human_entered + value + re-stamp asOf, never lowers trust), effectiveState (display-only staleness, never downgrades a human figure), mergeScrape, summariseState, humanCheckedCount/figureCount, stateLabel, buildSeedProvenance.
- [x] 7.1.2 Additive schema + LIVE migration: opportunities.fieldProvenance (json, $type FieldProvenanceMap) + verificationState summary column; applied via webdev_execute_sql and verified in information_schema.
- [x] 7.1.3 Seed backfill: every figure (price/yield/coupon/tenor/maturity/distribution/expense/trailingReturn/fx) gets its own scraped_unverified provenance entry with per-figure source + canonical sourceUrl (NSE/mystocks/african-markets/Sanlam/CBK) + as-of; no number changed. Live rows re-seeded.
- [x] 7.1.4 Server: list/byRef return the typed map; verifyOpportunityField db helper (only write path that changes a figure's state) + opportunities.verifyField protected mutation (confirm | override), rejects a no-op override; row summary state re-derived on every write.
- [x] 7.1.5 UI: OpportunityDetail per-figure verification badge (Unverified/Verified by you/Entered by you/May be stale), clickable per-figure source link + as-of, "checked by you on …" line, inline Confirm / Edit value controls (signed-in only). Header + Explore rows show "x/N figures checked". Liquidity no longer shows a false "never" staleness.
- [x] 7.1.6 Tests: server/provenance.test.ts (19 cases). Full suite 893 green across 95 files, tsc clean.

## Expansion Brief — Part 7.2 (scraper / ingestion layer)

- [x] Shared no-ranking adapter contract (`shared/ingestion.ts`): closed `ScrapedFigure`/`ScrapedInstrument` types with no slot for any score/rating/rank/grade/tier/performer; per-source `SourcePolicy` (cadence/cron/spacing/back-off)
- [x] CBK/DhowCSD adapter (JSON auction results → T-bill yield/tenor, IFB/FXD coupon/tenor/maturity), throws on schema drift
- [x] NSE adapter (HTML daily price table → equity price/dividend yield/trailing return, REIT distribution), throws on layout drift
- [x] Fund fact-sheet adapter (CSV → MMF/offshore yield, expense ratio, price, FX), throws on layout drift
- [x] Committed fixtures (html/json/csv) as the layout source of truth
- [x] Pure `reconcileScrape` (no-clobber merge + conflict detection) in `shared/provenance.ts`
- [x] Ingestion runner: fetch with rate-limit spacing + exponential back-off, parse via adapter, upsert each instrument as scraped_unverified; failed run reported, never throws
- [x] `ingestion_conflicts` table (additive migration) + DB helpers (ingest-with-reconcile, list/count/resolve)
- [x] Scheduled ingestion endpoint under `/api/scheduled/`; per-source cron in policy
- [x] Conflict review surface: tRPC procedures (owner-gated) + Source Conflicts page (Keep mine / Use scraped value via human override) + sidebar open-count badge
- [x] Tests: 21 adapter (facts + drift-fails-loudly + bright-line), 5 reconcile (no-clobber/agree/disagree), 4 runner (fixture-driven, no network); full suite 923 green; tsc clean
- [x] Live end-to-end proof: a disagreeing scrape (8.60) did NOT clobber a human-entered yield (7.77); it raised one open conflict; DB restored clean afterwards

## Expansion Brief — Part 7.3 (human override & verification workflow)

- [x] Editor/admin gating: verifyField/conflicts/resolveConflict/runIngestion/addOpportunity now adminProcedure
- [x] Edit any field with authoritative value + source → human_entered (override now carries source/sourceUrl/asOf)
- [x] Confirm a scraped figure as correct → scraped_unverified promotes to human_verified (existing path, now admin)
- [x] Resolve 7.2 conflicts from the workflow (keep mine / apply scraped as human_entered) — admin-gated
- [x] Add a new instrument by hand (addOpportunity mutation; figures land human_entered with citation)
- [x] End-user Explore/Detail: quiet "verified" marker on human_verified, "may be stale" on stale, plain to read (viewer-neutral labels + per-row x/N checked indicator)
- [x] Tests: edit-with-source transition, confirm transition, gating rejection, add-instrument, conflict apply; full suite + tsc (covered by provenanceHumanEntry + opportunityMaintainer tests; existing provenance/reconcile tests cover confirm + conflict apply)

## Expansion Brief — Part 7.3 (UI + tests)

- [x] Detail page: verify/confirm controls gated on maintainer role (admin), not merely signed-in
- [x] Detail Edit flow captures authoritative Source / Source URL and threads them into the override
- [x] End-user verification markers use viewer-neutral wording (Verified / Maintainer-entered / Unverified scrape / May be stale)
- [x] "Add instrument by hand" maintainer page (/explore/new) + route ordered before /explore/:ref
- [x] Maintainer-only "Add instrument" button on Explore; Source Conflicts gated on maintainer role
- [x] Tests: humanField + override-with-source (pure), admin gating (FORBIDDEN 10002), addOpportunity happy-path + duplicate-ref
- [x] Full suite green (934) + tsc clean; live no-leftover verified (test row deactivated in teardown)

## Expansion Brief — Parts 7.4–7.6 (catalog expansion + staleness/honesty + guardrails)

- [x] 7.4 Expand seed: fuller NSE equity slice, active gov bond/bill series, major Kenyan MMFs, main REITs, offshore set (global equity, S&P, USD MMF)
- [x] 7.4 Every added instrument carries a real source + per-figure provenance + a verification state (not unverified placeholders)
- [x] 7.4 Default catalog ordering stays neutral (asset class, then name) regardless of size
- [x] 7.5 Wire real asOf/fetchedAt into staleness display; per-asset-type thresholds (equities daily, bonds/MMF weekly)
- [x] 7.5 Non-blocking prompt at "Model in my plan" when figure is stale or scraped_unverified ("N days old / not yet human-verified; confirm or update")
- [x] 7.5 Persistent "information only — verify before acting" disclaimer stays; no scraped figure presented as verified/guaranteed
- [x] 7.6 Guardrail tests: ingestion has no ranking path; neutral default order at any catalog size; no silent clobber; source+age+state always shown
- [x] Acceptance: existing tests pass (949 green); fixed-income plans and numbers unchanged
- [x] Export full build code as a downloadable archive for the user (see deliverables below)

## Expansion Brief — Parts 7.4–7.6 (DONE)

- [x] 7.4 Catalog expanded to a representative universe (29 instruments): fuller NSE equities, active gov coupon (FXD 2/5/10/15Y) + IFB, T-bills (91/182/364), major MMFs (CIC/Sanlam/NCBA/Etica/Madison-style), REITs (FAHR/Acorn I-REIT/D-REIT), offshore (VWRA/S&P 500/USD MMF)
- [x] 7.4 Every added instrument carries real source + per-figure provenance + verification state via withProvenance (no unverified placeholders; scraped_unverified)
- [x] 7.4 Default catalog order stays neutral (asset class, then name) regardless of size — no popular/top sort
- [x] 7.4 New rows inserted insert-only (existing rows' provenance untouched; human values protected)
- [x] 7.5 Per-asset-type staleness thresholds (equity/reit 3d, offshore 4d, mmf/t-bill 8d, bonds/deposit ~35d) in effectiveStateForClass/staleDaysForClass
- [x] 7.5 Real asOf/fetchedAt wired into the freshness display (Explore age chips reflect actual data age per class)
- [x] 7.5 Non-blocking model-step prompt (modelFreshnessPrompt) in ModelDrawer for stale/scraped_unverified driving figures; commit never blocked; "information only" disclaimer stays
- [x] 7.6 Guardrail tests: facts-only at scale, neutral order at 500 rows, no silent clobber, source+age+state always present (catalogGuardrails.test.ts, 15 tests)
- [x] Fixed-income plans/numbers unchanged; full suite 949 green; tsc clean


## Part 8 — AI-assisted instrument intake & universe discovery (AI is a librarian, never an oracle)
### Item 1: ai_extracted lowest-trust verification tier
- [x] Add `ai_extracted` to VERIFICATION_STATES as the lowest trust rank (below stale/scraped)
- [x] Update TRUST_RANK so ai_extracted < scraped_unverified < stale-display < human_verified < human_entered
- [x] Add `aiExtractedField()` builder (mirrors scrapedField but state=ai_extracted, records model/source)
- [x] effectiveState/effectiveStateForClass: ai_extracted stays ai_extracted (never auto-promotes)
- [x] mergeScrape lets a scrape raise ai_extracted; mergeAiExtraction fills blanks only (never clobbers)
- [x] stateLabel/viewerStateLabel: "AI-extracted · unverified — confirm against source"
- [x] DB migration: NOT NEEDED — verificationState/field/humanState are varchar(24), ai_extracted fits; conflicts table reused for AI conflicts
- [x] VerificationBadge (OpportunityDetail): distinct filled-orange + bot-icon provisional marker
- [x] Explore row indicator: show ai_extracted figures distinctly (orange Bot "N AI-extracted")
- [x] modelFreshnessPrompt: most-urgent variant for ai_extracted driving figures (ModelDrawer renders orange Bot prompt)
- [x] Unit tests for the new tier + no-clobber ordering (aiExtractedTier.test.ts, 15 tests; suite 965 green)

### Items 2–4: extraction, discovery, confirmation
- [x] AI document extraction: aiIntake.ts contract + aiIntakeService + ingestAiExtractedInstrument + opportunities.aiExtract procedure
- [x] Universe discovery: ai_candidates table + opportunities.aiDiscover/listCandidates/reviewCandidate (suggestions only; approve creates human-authored instrument)
- [x] Human confirmation workflow: extracted figures show value + verbatim quote + "Confirm against source" deep-link to OpportunityDetail's existing per-figure Confirm/Override; candidate Approve creates human-authored instrument, Dismiss files it
- [x] AI intake page (/ai-intake) + sidebar nav entry with pending-candidate badge (admin-gated)
- [x] Structural guarantee: aiIntake.ts closed types + compile-time _assertNoVerdictFields + runtime stripVerdictFields
- [x] Tests for extraction parsing, no-clobber of human/scrape, suggestion-only discovery (aiIntake.test.ts, 16 tests) + live LLM smoke test verified
- [x] Type gate clean; full suite 981 green; AI Intake page renders


## Part 8 (deeper spec) — AI extraction as an adapter behind the same wall

### Backend: AI as a Part 7 adapter
- [x] shared/aiAdapter.ts: extractionToAdapterResult → same AdapterResult/ScrapedInstrument shape (no slot for a score)
- [x] aiInstrumentToProvenanceMap stamps ai_extracted + quote + model, AND runs the sanity gate
- [x] aiExtract now builds the adapter result then feeds the AI map through ingestAiExtractedInstrument (reconcile/upsert/conflicts)
- [x] Grounding: prompt forbids invention; null-on-absent; quote required per figure

### Numeric sanity gates (reuse/extend Part 7 anomaly posture)
- [x] shared/figureSanity.ts: per-field plausibility bounds (rate>25%, negative/zero price, fee>5%, tenor sanity, fx positive)
- [x] Implausible AI figures carry a neutral reviewFlag on their provenance (provisional + suspected misread), never saved as clean
- [x] aiExtract returns `flagged[]`; reviewFlag stored on the figure for the queue

### Document sources
- [x] aiExtract accepts source: {kind:text|url|pdf}
- [x] URL fetch: fetchDocumentText (polite fetch + node-html-parser strip)
- [x] PDF: aiUploadDocument (base64→storagePut) then aiExtract reads it via LLM file_url (no native PDF lib; keeps Node-only deploy clean)

### Visibility policy
- [x] Hide ai_extracted-ONLY instruments from public Explore (isAiProvisionalRow predicate)
- [x] opportunities.list filters AI-provisional rows; opportunities.listAll/aiReviewQueue (admin) include them
- [x] Loud provisional treatment carried by ai_extracted badge + reviewFlag (covered by review queue UI next)

### Maintainer review queue (the on-ramp to trust)
- [x] AiIntake ExtractPanel: text/URL/PDF source picker + flagged-figure sanity warnings + review-queue link
- [x] /ai-review admin-only page: aiReviewQueue grouped by instrument; hidden-from-catalog rows flagged
- [x] Per-figure side-by-side: AI value + source span (verbatim quote) + open-document link
- [x] One-click Confirm (verifyField→human_verified), Correct (override→human_entered), Reject (rejectAiField drops ai_extracted only)
- [x] Per-figure not all-or-nothing; reuses verifyField + new rejectAiField; AI Review nav entry + pending-figure badge

### Tests + gate
- [x] aiAdapter parity test (extraction → AdapterResult → ai_extracted map, no clobber) — aiAdapterPipeline.test.ts
- [x] figureSanity tests (each bound flags correctly; valid values pass)
- [x] visibility test (isAiProvisionalRow/hasAiExtractedFigure/countAiFigures)
- [x] per-figure reject narrowness (rejectAiField drops ai_extracted only); confirm/correct reuse verifyField (covered by Part 7 suite)
- [x] type gate clean; full suite 995 green; AI Review + AI Intake render; checkpoint next


## Part 8 (items 6-7 + acceptance) — Cost, audit & rate discipline

### Audit trail (item 6)
- [x] ai_intake_audit table created (CREATE TABLE applied; mirrored in drizzle/schema.ts)
- [x] DB helpers: insertAiIntakeAudit (best-effort, never throws), listAiIntakeAudit (newest first, capped)
- [x] aiExtract logs one audit row per call via try/finally (maintainer, source, model, extracted fields, figure/flagged counts, errors) — even on failure
- [x] aiDiscover logs one audit row per call (universe description, candidate count, model, errors)
- [x] Accuracy-first LLM settings: temperature 0 on both calls + invokeLLM temperature passthrough; structured output already on; comment notes no latency pressure

### Audit viewer + invariants (item 7 / acceptance)
- [x] aiAuditLog admin query + AI Review "Audit trail" tab: action, document, model, extracted fields, counts, maintainer, timestamp, ok/error
- [x] Confirm invariants: ai_extracted tier floor; AdapterResult has no score slot; nulls-over-guesses; discovery writes nothing; admin-gated; end-user catalog hides AI-only rows (all covered by tests)
- [x] Fixture-document extraction test (aiFixtureDocument.test.ts, 5 tests): present fields verbatim, absent->null, quote-less dropped, verdict stripped, ai_extracted tier, sanity flag, discovery dedupe/no-rank
- [x] Type gate clean (tsc 0); full suite 1000 green (105 files); checkpoint next


## Part 8.1 — thin-fetch nudge + image source input

### Backend
- [x] isThinFetch + THIN_FETCH_MIN_CHARS in service; fetchDocumentText now lets thin-but-nonempty through for the caller to judge
- [x] aiExtract thin-fetch signal: URL fetch under THIN_FETCH_MIN_CHARS returns {thinFetch,fetchedChars,url} (signal, not a throw); still logged in audit
- [x] Vision guard: isVisionCapableModel + resolveVisionModel; image path throws clear "can't read images — use Paste text" when none
- [x] Image source path: ExtractionSource adds {kind:image}; aiExtractInstrument sends image_url to a resolved vision model; same schema; nulls-over-guesses reinforced by IMAGE_EXTRACTION_NOTE
- [x] Image provenance: per-figure source label = "read from an uploaded screenshot of [cited source], [date]"; figures land as ai_extracted; instrument dataSource stamped the same
- [x] Audit the image-source call like the others (sourceKind="image"); aiUploadDocument extended to accept PNG/JPG/WEBP (10MB cap)

### Frontend
- [x] Thin-fetch nudge after a URL fetch: amber honest message with char count, "Switch to Paste text" (pre-fills source URL) and "Switch to Upload an image" actions
- [x] "Upload an image" fourth input mode (alongside Paste text / Fetch a URL / Upload a PDF); PNG/JPG/WEBP picker, base64 upload, then image extract
- [x] Loud failure if model isn't vision-capable (procedure throws a user-friendly message surfaced via toast)

### Tests + gate
- [x] Mocked vision response test: correct fields, correct nulls, image provenance at ai_extracted trust (server/aiImageSource.test.ts)
- [x] Thin-fetch detection unit test + vision allow-list + resolveVisionModel + vision-guard short-circuit (no LLM call)
- [x] Type gate clean; full suite green (1011 passing); checkpoint

## Part 8.2 — source screenshot thumbnail in the AI review queue

- [x] Schema: opportunities.aiSourceImageKeys (JSON string[]) — storage keys of uploaded screenshots used as image-extraction sources; applied via additive ALTER (drizzle-kit generate blocked on unrelated rename prompts)
- [x] db.attachAiSourceImageKey(ref, key): append-only, de-duped, capped to 8 most recent
- [x] aiExtract image branch records the uploaded screenshot's storage key on the row after upsert
- [x] aiReviewQueue returns sourceImageUrls (keys → /manus-storage/{key} served URLs)
- [x] AiReview card: SourceScreenshots strip of thumbnails at top of each card; click opens full-size dialog + "open in new tab"
- [x] Tests: key→URL mapping (null/non-array safe) + append dedupe/cap/empty-key (server/aiReviewScreenshot.test.ts, 7 tests)
- [x] Type gate clean; full suite green (1018 passing); checkpoint

## Allocation Model — Part 1 (foundation, data layer only; no UI)

### Shared model (shared/allocationModel.ts)
- [x] Five ordered risk tiers, ALIASED to riskModel's RiskTolerance (no duplicate type); ascending-risk ordering re-exported so the two models can't drift
- [x] Neutral tier specs (label + one-liner); no tier framed as "best"/"recommended"
- [x] Five allocation buckets (cash/gov/equity/reit/offshore) with the single class→bucket grouping (alt excluded from target mix)
- [x] Editable target templates: default starting weights per tier (illustrative, all editable); weights-only, no return/vol/rate numbers embedded
- [x] Validator: weights in [0,100], sum to exactly 100 (float epsilon), cash ≥ 5% operational floor; returns all failing reasons
- [x] suggestTier(horizonMonths, goalNature): horizon bands → base tier; critical = one tier safer (clamped); standard/aspirational = no auto-riskier shift; returns plain-language reason; never a locked choice
- [x] resolveTierSelection: defaults to suggestion; userOverrode flag; conflictsWithHorizon flag (riskier-than-horizon) — a flag for a future consequence, never a block

### Storage (additive migration; surfaces nothing yet)
- [x] allocation_templates table (one row/tier: weights JSON + source/asOf/notes provenance + updatedAt), modeled on benchmark_inputs
- [x] portfolios: allocationSuggestedTier / allocationSelectedTier (nullable) + allocationTierOverridden (default false)
- [x] Migration applied directly via SQL (drizzle-kit generate prompts on unrelated renames); five default templates seeded + verified
- [x] db helpers: listAllocationTemplates / getAllocationTemplate (fall back to seeded defaults), saveAllocationTemplate (VALIDATES before write, rejects non-conforming); per-goal tier fields written via existing updatePortfolio

### Tests + gate
- [x] Tiers/ordering/shift-clamp; class→bucket grouping; default templates valid + monotone (cash ↓, equity ↑ with risk)
- [x] Validator: sum≠100, cash-floor, out-of-range/missing, float-dust tolerance
- [x] Horizon bands at/around every boundary; suggestTier standard/critical/aspirational + default nature
- [x] resolveTierSelection: default, riskier-override conflict, safer-override no-conflict, same-as-suggestion, critical-shift-vs-base, unknown-value fallback
- [x] Type gate clean; full suite green (1018 → 1041, +23); no existing behavior changed

## Allocation Model — Part 2 (the glide path; tier-aware convex de-risking)

### Investigation (no-regression anchor)
- [x] Engine phases driven by getPhase/getPhaseBoundaries (proportional fractions); per-month NON-MMF target weights come from getPhaseAllocation(phase) — discrete switch at boundaries
- [x] Phase→mix table (foundation 50/50/0/0, growth 20/20/45/15, de-risking 25/35/30/10, final 40/45/10/5); engine sizes sweeps toward these; liquidAllocator only diversifies the CASH portion across issuers (does not set risky/cash split)
- [x] Bridge: car plan uses 4 engine buckets (mmf/tbill/ifb/fxd) with NO equity/reit/offshore; Part 1 uses 5 alloc buckets (cash/gov/equity/reit/offshore). cash≈mmf, gov≈tbill+ifb+fxd for this plan. Glide is the generalized model; engine keeps getPhaseAllocation as source of truth (regression-locked)

### Glide model (shared/allocationModel.ts)
- [x] glidedAllocation(tier, trf): blends start tier template → CP end anchor by trf^steepness; normaliseToValidTemplate re-validates (sum 100 + cash floor) at every point
- [x] Convex easing glideStartWeight = trf^steepness (steepness default 2.0, documented why convex); editable via GlideParams; validateGlideParams enforces steepness ≥ 1 (never concave)
- [x] Foundation/Growth/De-risking/Final as labeled regions via glidePhaseForElapsed with editable thresholds (defaults 0.20/0.70/0.85 = engine's phase fractions); engineBucketsForPhase + ENGINE_PHASE_BUCKETS reproduce the car plan's 4-bucket table (regression fixture)
- [x] sampleGlidePath() returns the full curve (per-month or N steps) with phase + weights for Part 4 display; weights/shape only, no return/rate numbers

### Wiring + storage
- [x] Glide exposed as the queryable TARGET source via allocation.glidePath / .templates / .glideParams (reads stored+edited templates so edits flow through); engine keeps its discrete getPhaseAllocation as source of truth — NO parallel allocator, no double-allocation, deterministic engine still doesn't forward-project price-driven assets (regression-locked via ENGINE_PHASE_BUCKETS)
- [x] Store editable curve params (steepness, phase thresholds) with provenance: allocation_glide_params singleton table + getGlideParams/saveGlideParams (validated, reuses Part 1 storage pattern); seeded default row

### Tests + gate (server/allocationGlide.test.ts, 20 tests)
- [x] Interpolation endpoints: trf=1 == tier template, trf=0 == capital preservation; CP glide is flat
- [x] Convexity: late de-risking faster than early (fixed easing to 1-(1-trf)^k so de-risking ACCELERATES late, matching the brief); steepness=1 == linear; higher steepness holds growth longer
- [x] Mid-point validation: every sampled month sums to 100, holds cash floor, passes validateAllocationWeights; equity monotonically non-increasing
- [x] Phase regions: default thresholds map to the 4 phases; phase vocabulary matches engine; mirror inputs
- [x] Param validation: defaults ok; rejects steepness<1, non-ascending thresholds, out-of-(0,1)
- [x] CAR-PLAN REGRESSION: engineBucketsForPhase + ENGINE_PHASE_BUCKETS pinned byte-for-byte against LIVE getPhaseAllocation (+short-horizon); glide thresholds line up with getPhaseBoundaries
- [x] Type gate clean; full suite green (1041 → 1061, +20); no existing behavior changed

## Allocation Model — Part 3 (the goal-probability feedback loop)

### Investigation
- [x] buildEndValueDistribution(positions: RiskPosition[], horizonYears, extraCertainEndValue?) → {p10,p50,p90,mean,portfolioReturnPct,portfolioVolPct,hasMaterialRisk,...}; lognormal risky sleeve + deterministic chunk; vol from coarse correlation matrix
- [x] goalProbability({dist, deterministicEndValue, goal}) → {probabilityPct,...}; PROBABILITY_FLOOR 0.01 / CEIL 0.99 already clamp so never 0/100%
- [x] Assumptions resolve via resolveRiskAssumption(class, sourced overrides) → DEFAULT_RISK_BY_CLASS; never hardcoded in the loop
- [x] Buckets→class bridge: cash→cash_mmf, gov→gov_coupon (honest volatile end), equity→equity, reit→reit, offshore→offshore_fund (BUCKET_RISK_CLASS)
- [x] Live recompute path (routers.ts ~2700) builds dist from real holdings; Part 3 is the forward hypothetical over the glide and REUSES endValueFromParams (shared lognormal core extracted from buildEndValueDistribution) + goalProbability — no parallel engine

### Probability loop (shared/allocationModel.ts, reusing riskModel)
- [x] glideEffectiveRisk: samples the glide month-by-month, reuses buildEndValueDistribution per period to read each month's return+vol, averages period return + period VARIANCE → effective annual return/vol (time-varying, not one static mix)
- [x] glideGoalProbability folds the effective μ/σ through endValueFromParams + goalProbability; floor/ceil enforced (never 0/100%)
- [x] Lever 1 — more time (+3/+6/+12 mo): re-runs glideGoalProbability with extended horizon
- [x] Lever 2 — more contribution (+5k/+10k): annuity FV of EXTRA contributions at the effective return added to riskyValue, re-run
- [x] Lever 3 — more risk (up one tier): re-run AND report downsideP10 + baselineP10 (widened downside shown alongside) — never free
- [x] computeLevers returns a FLAT unsorted set; no highlight/pre-select/"we suggest"
- [x] probabilityInsight: ≥high AND a safer tier still clears high → factual "reachable at a lower tier (odds stay above X%)" (VERIFIED by recomputing the safer tier); ≤low → point to levers; else neutral; thresholds editable; strictly factual, explicit "not a recommendation"
- [x] RISK_ASSUMPTION_CAVEAT "Based on assumed returns; outcomes will vary." on every result + insight

### Wiring + storage
- [x] allocation.goalProbability read-only query: resolves sourced bucket assumptions, runs glideGoalProbability + computeLevers + probabilityInsight through the stored templates+glide+thresholds; allocation.probabilityThresholds read query
- [x] allocation_probability_thresholds singleton table (default 85/60) + getProbabilityThresholds/saveProbabilityThresholds (validated, provenance), mirroring Part 2 glide-params storage

### Tests + gate
- [x] Monotonicity: more time + more contribution each raise the CENTRAL probability monotonically with step size (server/allocationProbability.test.ts)
- [x] More-risk honesty: in this model tiers share similar expected returns but rising VOL (cones widen), so the suite pins effective vol strictly monotonic in tier; the more-risk lever ALWAYS reports widened downside (p10 falls vs baseline)
- [x] Floor/ceil clamping: overfunded caps below 100% (≤ ceil), hopeless floors above 0% (≥ floor)
- [x] Threshold messaging: LOW points to levers; COMFORTABLE names a VERIFIED safer tier (recomputed) with "not a recommendation"; editable thresholds flip the tone; caveat travels on every result
- [x] Threshold validation: defaults ok; rejects out-of-range / high≤low / equal
- [x] Type gate clean; full suite green (1061 → 1079, +18); risk-model + car-plan regression suites unchanged by the extracted lognormal core

## Allocation Model — Part 4 (the illustrative-template surface) + full source export

### Investigation (reuse, don't rebuild)
- [x] Find the Explore screener route + preview/commit flow (Part 2/3 of the investment expansion) and how a class/sleeve is passed into it
- [x] Find the existing diversification/drift readout machinery (liquid-reserve panel) to reuse for template-vs-actual drift
- [x] Confirm per-goal tier fields (allocationSuggestedTier/allocationSelectedTier/override) + how a goal/portfolio is selected in the UI; find Test/Live (live/test) plumbing
- [x] Confirm the allocation tRPC surface (templates, glidePath, glideParams, goalProbability, probabilityThresholds) shapes for the page
- [x] Find how current holdings roll up into the 5 behavior-class buckets (for the factual gap readout)

### Backend glue (read-only + override)
- [x] Per-goal tier override mutation (override-always-wins; suggestion is only a starting point) — store selectedTier + userOverrode flag (allocation.setTier)
- [x] Gap readout: template target weights vs current holdings rolled into the 5 buckets (factual pp gap per class), reusing existing rollup (computeBucketGaps + buildAllocation)
- [x] Drift readout: reuse existing diversification/drift machinery to compare actual vs template (no second engine) — holdingsGap diffs the SINGLE buildAllocation builder

### Template surface page (read-and-decide)
- [x] New page under INVEST (and/or opens from a goal): suggested tier + plain reason + override-to-any-tier control
- [x] Glided target mix at current journey point across the 5 buckets (simple breakdown)
- [x] Probability + p50 + p10–p90 range + the neutral levers panel (no ranking/preferred)
- [x] Scrubable full-glide journey (allocation bands over time; scrub to any future point)
- [x] Gap readout per class ("template ~28% equity; you hold ~5%") — factual, not an instruction
- [x] Drift readout once holdings exist ("38% vs 28% template — 10pp over") via existing machinery (over/under/aligned + signed pp)
- [x] "Apply" routes to Explore screener + preview/commit (per class) via /explore?class=<assetClass>; NO auto-allocation, NO transact button, NO pre-filled basket, never picks an instrument
- [x] Framing throughout: "illustrative … a starting point, not advice; you decide"; risk-calibrated tone; caveat on every probability/range; no best/recommended/optimal/top/preferred
- [x] Layman tooltips on non-self-explanatory items (tier, glide, p10–p90, drift, buckets, etc.) via InfoHint
- [x] Back/escape route from the page (AppShell sidebar); Test/Live respected (usePortfolio mode)

### Tests + gate
- [x] Gap/drift readout test (template vs actual buckets → correct pp gaps) — server/allocationGap.test.ts (15 tests)
- [x] Override-always-wins test (selecting any tier overrides the suggestion; suggestion never blocks)
- [x] Non-advisory copy: no banned words on the surface
- [x] Type gate clean; full suite green (1091, +12); screenshots; checkpoint

### Full source export
- [x] Package the complete source (excluding node_modules/build artifacts) into a downloadable zip and deliver

## Bugfix — Allocation Plan goal was hardcoded to KES 5M

- [x] Remove the `const goal = 5_000_000` hardcode in AllocationPlan.tsx ProbabilityCard
- [x] Read the REAL target: thread `portfolio.targetAmount` (same field Dashboard reads) into the goalProbability query
- [x] Use the per-portfolio horizon (`horizonRemainingMonths`) — confirmed already real, not defaulted
- [x] Feed the plan's actual contribution-driven projected end value: read `projection.run` last-row `totalEnd` (same engine the Dashboard uses) and split into riskyValue (classified holdings) + extraCertainEndValue (remainder)
- [x] Regression test (server/allocationGoalCoherence.test.ts, 6 tests): Car sample (1.2M target, ~1.43M plan) → high probability, ~1.2M–1.5M range; old 5M/no-certain state reproduces the broken ~1% / sub-250k symptom; lower target easier than higher
- [x] Type gate clean; full suite green (1097, +6); James O. page verified: goal reads KES 5.00M matching Dashboard, 99% with range centered ~5.01M matching "Projected ≈ KES 5.01M"
- [x] Checkpoint + re-package source

## Ledger — surface per-month net MMF interest + CSV/header parity

- [x] Brief 1A: engine MonthResult gains `mmfInterestNet` (month-scoped accumulator, gross - 15% WHT; read-only surfacing, compounding unchanged)
- [x] Brief 1B: `results.push` emits `mmfInterestNet` with 2dp rounding
- [x] Brief 1C: Ledger table adds "MMF Interest" column after "MMF End" (header + data cell + footer total + skeleton count 13->18)
- [x] Brief 1D: layman header tooltip for MMF Interest ("Net interest ... after 15% WHT ... already included in MMF End")
- [x] Brief 1: CSV export adds "MMF Interest" header + per-row value + summed total-row value
- [x] Brief 2: CSV "Month" now matches on-screen header (renamed on-screen "Mth" -> "Month")
- [x] Brief 2: CSV "MMF->Securities" -> "Swept -> Securities" to match on-screen header label
- [x] Regression test server/mmfInterestColumn.test.ts (5 tests: present/non-neg, positive while earning, reconciles via engine's gross-then-WHT path, mmfEnd unchanged, Car-sample shape)
- [x] Type gate clean; full suite 1102 green (+5); screenshots confirm column renders + aligns

## Manager-Grade Consolidation Refactor (7 areas + canonical money)

### Phase 1 — Canonical snapshot + shared selectors
- [x] Server `portfolios.snapshot` procedure (routers.ts:2256) returns the complete live state (identity, goal, holdings, contributions, ledger, income/accrual, tax, allocation gap, liquidity, reconciliation, warnings, next actions); built by server/snapshot.ts
- [x] Shared selectors in shared/snapshot.ts: selectNetWorth, selectGoalProgress, selectTaxSummary, selectAccruedInterest, selectLiquidityEvents, selectAllocationGap, selectLedgerRows, selectReconciliationStatus, selectPlanStatus, selectActualVsPlanned (covered by snapshotConsistency.test.ts)
- [x] Client hook usePortfolioSnapshot() (hooks/usePortfolioSnapshot.ts) wraps the procedure, resolves active portfolioId from context, gates the query; adopted in AllocationPlan

### Phase 2 — Plan-to-ledger commit contract
- [x] Committed allocation tier + policy persisted via allocation.commitPlan; snapshot identity exposes committedTier/planStatus/planCommittedAt
- [x] "Commit this plan" action on Allocation Plan (AllocationPlan.tsx) with non-advisory copy ("No holdings moved")
- [x] Projection engine + Month Ledger consume the committed tier (glidedAllocation); Scenarios baseline + probability share it; reconciliation confirms agreement
- [x] Changing tier re-flows Ledger + Dashboard (commit invalidates snapshot + goalTier queries); glide determinism covered by phase9Integration.test.ts

### Phase 3 — Plan parent (tabs: Goal, Allocation, Scenarios, Ledger)
- [x] /plan tabbed shell (PlanArea.tsx) with goal, allocation, scenarios, ledger tabs — AllocationPlan, Scenarios, Month Ledger mount as tabs (route test asserts every redirect target tab id is real)

### Phase 4 — Cashflows + Holdings parents
- [x] /cashflows tabs (CashflowsArea.tsx): record-in, withdraw, scheduled — Deposits, Withdrawals, Contributions consolidated
- [x] /holdings tabs (HoldingsArea.tsx): mmf, gov, bank, other — MMF, CBK securities, bank instruments, other assets consolidated (redirect targets verified by routeRedirects.test.ts)

### Phase 5 — Research + Review parents
- [x] /research tabs (ResearchArea.tsx): explore, mmf-comparison, ai-import, ai-review, source-conflicts — old standalone pages now mount as tabs
- [x] /review tabs (ReviewArea.tsx): manager, reconciliation, income, tax — reconciliation compares the EXACT canonical-selector values (verified by reconciliation.ts + snapshotConsistency tests)

### Phase 6 — Navigation + modes + Dashboard slim-down
- [x] Sidebar = Dashboard, Plan, Cashflows, Holdings, Research, Review (+ Guide/Learn under Help, Live/Test mode switch) — verified in live screenshots
- [x] Simple/Manager mode switch present (top of sidebar); Manager exposes Research + analyse surfaces
- [x] Getting Started + Learn live under a Help section, not the main manage nav
- [x] Dashboard slimmed to an At-a-glance + Posture/Exceptions command centre with "Show detailed analytics" deep-link

### Phase 7 — Redirects (keep old URLs)
- [x] All 19 legacy paths now driven by the canonical shared/legacyRoutes.ts map, rendered by App.tsx; query params (e.g. ?class=) preserved, tab param rewritten to canonical
- [x] /allocation-plan, /scenarios, /ledger → /plan?tab=…; verified /ledger lands on Plan→Ledger live
- [x] /deposits, /withdrawals, /contributions → /cashflows?tab=…
- [x] /mmf-funds, /securities, /bank-instruments, /other-assets → /holdings?tab=…
- [x] /portfolio-review, /reconciliation, /mmf-accrual, /tax-summary → /review?tab=…; verified /tax-summary lands on Review→Tax live

### Phase 8 — Allocation/sweep scoring + ledger narration + status labels
- [x] Scoring: shared/instrumentScore.ts — score = net_yield − liquidity/concentration/stale/expense/unverified penalties; eligibility gates (active, usable yield, currency) + sovereign-preference tie-break; surfaced as OPT-IN Score column on Explore with auditable per-component breakdown popover; opportunities.scored tRPC endpoint reuses detectIssuerConcentration + catalogNetYieldPct (17 tests)
- [x] Ledger explains: shared/ledgerExplain.ts — per-row plain-language popover (saved, returned from CBK/bank, swept out, MMF interest, end balances, phase), tense-matched to settled/projected, headline mirrors engine mainAction verbatim, non-advisory (10 tests)
- [x] Consistent statuses everywhere: shared/statusLabels.ts canonical descriptor (label/tone/iconKey/description) + client StatusBadge; OpportunityDetail badge + SourceConflicts label now consume the shared vocabulary so surfaces never drift (5 tests)
- [x] Type gate clean; full suite 1146 green; Explore + Source Conflicts screenshots verified

### Phase 9 — Tests + verify + deliver
- [x] Integration: commit tier → one deterministic glide every surface shares; each tier glide sums to 100; aggressive never holds more cash than capital-preservation (phase9Integration.test.ts)
- [x] Integration: a single deposit moves net worth + every reconciliation source together; net worth stays = sum of parts (phase9Integration.test.ts)
- [x] Integration: reconciliation goes RED the instant one page total drifts (the classic omitted-bank-pocket bug); tolerates <5 KES rounding
- [x] Integration: old routes redirect to correct new tabs — canonical map totality + target building + param preservation (phase9Integration.test.ts + routeRedirects.test.ts)
- [x] Integration: reconciliation fails if any page total differs from canonical selector (covered above + reconciliation.ts suite)
- [x] Type gate clean; full suite 1163 green; live redirect + dashboard screenshots verified; checkpoint + source delivery next


### Phase 1 — canonical snapshot (DONE)
- [x] shared/snapshot.ts: PortfolioSnapshot type + pure selectors (netWorth, goalProgress, tax, accrual, liquidity, allocation gap, ledger, reconciliation, actual-vs-planned)
- [x] server/snapshot.ts: buildPortfolioSnapshot composes buildAllocation (net worth) + runProjection (ledger) + allocation tier/gap model + reconcile() + getActualsSummary (income/tax) — no new money math
- [x] portfolios.snapshot tRPC query wired (auth-checked)
- [x] snapshotConsistency.test.ts: selectors read canonical figures; bucket roll-up == buildAllocation netWorth; gap rows == computeBucketGaps (7 tests)
- [x] Type gate clean; full suite 1109 green; dev server healthy


### Phase 2 — commit contract (DONE)
- [x] schema: portfolios.planCommittedAt (bigint, nullable) + migration 0011 applied to DB
- [x] allocation.commitPlan mutation: atomically writes tier + override flag + optional policy + optional contribution schedule, stamps planCommittedAt
- [x] snapshot identity surfaces planCommittedAt + derived planStatus ("committed"/"draft"); selectPlanStatus selector
- [x] projection/ledger/scenarios/probability already read persisted allocationPolicy + contribution schedule + target/horizon — commit makes plan-you-see == plan-ledger-executes
- [x] consistency test for selectPlanStatus (committed + draft); type gate clean; full suite 1110 green


### Phase 3 — Plan parent area (DONE)
- [x] AppShell gains `embedded` prop (renders children only, no sidebar/header) so page bodies reuse inside tabs
- [x] Codemod added `embedded` prop to 18 migrated pages + Settings; App.tsx routes switched to render-prop form so prop type doesn't clash with wouter
- [x] Reusable TabbedArea component: URL-driven (?tab=), only active panel mounted, layman hint per tab, animated underline
- [x] PlanArea: Goal & Plan (Settings) / Allocation (AllocationPlan) / Scenarios / Ledger tabs at /plan
- [x] CommitPlanBar on Allocation tab: reads snapshot planStatus, calls allocation.commitPlan, shows committed timestamp; non-advisory copy ("no holdings moved")
- [x] Type gate clean; full suite 1110 green; screenshots verified (tabs, embedded pages, commit bar)


### Phase 4 — Cashflows + Holdings parent areas (DONE)
- [x] CashflowsArea: Record In (Deposits) / Withdraw (Withdrawals) / Scheduled (Contributions) / Actual vs Planned (Reconciliation)
- [x] HoldingsArea: MMF (MmfFunds) / Government (Securities) / Bank (BankInstruments) / Other (OtherAssets)
- [x] Added embedded prop to Deposits; switched /deposits route to render-prop form
- [x] Registered /cashflows + /holdings routes (render-prop, ?tab= deep-linkable)
- [x] Verified all tabs render embedded (no doubled shell), deep-links land correctly
- [x] Type gate clean; full suite 1110 green


### Phase 5 — Research + Review parent areas (DONE)
- [x] ResearchArea: Explore / MMF Comparison (MmfStrategy) / Bank Catalogue (BankInstruments) / AI Import (AiIntake) / AI Review / Source Conflicts tabs at /research
- [x] ReviewArea: Manager (PortfolioReview) / Reconciliation / Income (MmfAccrual) / Tax (TaxSummary) tabs at /review
- [x] Registered /research and /review routes; all child pages reused embedded (verbatim, no logic duplicated)
- [x] Deep-link tabs verified (?tab=mmf-comparison, ?tab=tax); type gate clean; 1110 tests green


### Phase 6 — navigation refactor + Simple/Manager mode (DONE)
- [x] Added userMode (simple/manager) to PortfolioContext, localStorage-persisted, defaults to manager
- [x] Rewrote navGroups into 7-area structure: Overview (Dashboard); Manage (Plan, Cashflows, Holdings); Analyse (Research, Review, Time Machine sandbox-only); Help (Guide, Learn); Setup (Rate Settings)
- [x] match[] arrays so a parent nav item highlights on any of its now-tabbed legacy routes
- [x] simpleHidden gating: Research, Review, Learn hidden in Simple mode; restored in Manager
- [x] Moved area-level badges onto parents (drift→Dashboard, securities→Holdings, AI/conflicts→Research)
- [x] UserModeSwitcher pill added under PortfolioSelector
- [x] Getting Started relabeled "Guide" + grouped under Help
- [x] Dashboard already a command centre (At a glance + Posture & exceptions + detailed analytics) — no slimming needed
- [x] Type gate clean; full suite 1110 green; screenshots verified


### Phase 7 — legacy route redirects (DONE)
- [x] Added TabRedirect helper that forwards old paths to /<area>?tab=<id>, preserving extra query params (e.g. ?class= on the allocation→explore handoff)
- [x] All 19 consolidated standalone routes now redirect (allocation-plan/scenarios/ledger → plan; deposits/withdrawals/contributions → cashflows; mmf-funds/securities/bank-instruments/other-assets → holdings; explore/mmf-strategy/ai-intake/ai-review/source-conflicts → research; portfolio-review/reconciliation/mmf-accrual/tax-summary → review); /settings → plan?tab=goal
- [x] Kept full-screen deep pages standalone: /explore/new, /explore/:ref, /time-machine, /getting-started, /learn, / (Dashboard)
- [x] Verified live: /securities → Holdings/Government, /tax-summary → Review/Tax, /explore?class=equity → Research/Explore pre-filtered to equity (deep-link survived)
- [x] Added server/routeRedirects.test.ts (4 tests): every redirect target is a real tab id; all 20 promised legacy paths covered; consolidated pages no longer mount directly
- [x] Type gate clean; full suite green


## Live-Sync Fix — invalidatePortfolioMoney
- [x] Create shared client helper invalidatePortfolioMoney(utils, portfolioId) covering all money-dependent namespaces
- [x] Wire helper into deposit add/edit/delete (DepositDrawer add+delete+inline bankHolding; Deposits delete/addBank/updateBank/deleteBank/breakNow)
- [x] Wire helper into withdrawal add/edit/delete (Withdrawals invalidateAll body replaced)
- [x] Wire helper into security add/edit/delete/recycle/mature (Securities add/delete + invalidateAll covering update/recycle/mature)
- [x] Bank instrument holdings confirmed to flow through bankHoldings.add/update/remove (DepositDrawer + Deposits) — BankInstruments.tsx is the public catalog, not money, correctly left alone
- [x] Wire helper into secondary MMF add/edit/delete/select primary (MmfFunds all money mutations; SecondaryWhatIf applyWhatIf)
- [x] Wire helper into other asset add/edit/delete/update value (OtherAssets income + holding mutations)
- [x] Wire helper into rate setting update (UpdateRatesPanel saveRates; Settings rate/horizon/portfolio update)
- [x] Wire helper into contribution override update (Contributions upsert/delete)
- [x] Wire helper into allocation tier commit/update (AllocationPlan setTier + commitPlan)
- [x] Wire helper into time-machine simulated actual/materialization (TimeMachine refresh; ModeSwitcher reset + seed/reset); also ModelDrawer commit + GettingStarted seedSample/accountStatus
- [x] Added coverage unit test (6 tests, asserts all spec namespaces + missing/rejecting-namespace tolerance); type gate clean; full suite 1169 green; 4 key surfaces screenshot-verified


## Plan-to-Ledger Contract — committed tier becomes the active operating policy
- [x] Audit: how selectedTier is stored today; how the projection engine picks allocation/sweep path; where Ledger/Dashboard/Scenarios/probability/reconciliation read policy (committed tier lives in portfolio.allocationSelectedTier + allocationPolicy + planCommittedAt; engine sweep allocation is the single divergence site)
- [x] Formalize portfolioStrategyPolicy — shared/strategyPolicy.ts: pure tieredPhaseMix(base, tier) + buildStrategyPolicy() derive a concrete operating policy (phase mix tilt, bandWidthMultiplier, safetyFloorMultiplier, familyCapFrac) from a committed tier
- [x] Persist policy on "Commit this plan" — allocation.commitPlan already stamps committedTier + derived policy + planCommittedAt; snapshot identity now exposes committedTier/planStatus/planCommittedAt
- [x] Projection engine consumes the committed policy — server/engine.ts: EngineSettings.strategyTier threads through to the sweep allocation via tieredPhaseMix; balanced/undefined is byte-for-byte identical (back-compat guarantee)
- [x] Ledger, Dashboard projection, Scenarios baseline, Allocation probability, Reconciliation all use the same active policy — both engine-setting sources (routers.ts dbToEngine + server/snapshot.ts toEngineSettings) thread the committed tier; snapshot identity exposes activePolicyTier (the tier the projection actually ran)
- [x] Tier change changes projected path — proven by planToLedgerContract.test.ts: Growth builds a material long-bond path (>100k peak) while Capital Preservation stays ~100% liquid (avg liquid share ≈ 1); CP stays more liquid than Aggressive over the horizon
- [x] UI states — client/src/pages/AllocationPlan.tsx CommitPlanBar: "Plan not committed yet" (preview), "Committed plan active", "Preview only — Ledger still follows your committed plan." (selected≠committed), "Ledger and projections updated." (after commit); ProbabilityCard headline follows activePolicyTier, not the previewed tier
- [x] Reconciliation plan-policy check — shared/reconciliation.ts reconcilePlanPolicy({committed, committedTier, policyTierUsed}); routers.ts reconciliation procedure returns a planPolicy check; client/src/pages/Reconciliation.tsx renders a plan-policy card that goes red if the ledger ran a different tier than committed
- [x] Tests: 11 integration tests (planToLedgerContract.test.ts) + 10 unit tests (strategyPolicy.test.ts) — tier divergence, balanced identity, buildStrategyPolicy monotonicity, reconcilePlanPolicy checks; type gate clean; full suite 1190 green (122 files)
