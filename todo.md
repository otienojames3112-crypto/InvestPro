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
- [ ] Fix: second target-change attempt fails with "failed to change target amount" error
- [ ] Fix: bucket balance cards (MMF/T-Bills/IFB/FXD) do not update when target changes
- [ ] Full end-to-end system test of every page and feature before publish
