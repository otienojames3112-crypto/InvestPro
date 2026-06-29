# Expansion Part 2 — Opportunity Catalog (Explore screener)

## Phase 1 — Audit (DONE)
- [x] staleness: client/src/lib/rateStaleness.ts (reuse, per-class thresholds)
- [x] mode: usePortfolio().mode + "Live → from Test" CTA chip in Dashboard
- [x] nav: navGroups array in AppShell.tsx (+ App.tsx Route); sandboxOnly flag supported
- [x] Part 1 fields present: assetClass, dataSource, dataAsOf, unitPrice, units, currency, yields
- [x] reference data → new opportunities table (global, same for everyone)

## Phase 2 — Backend (DONE)
- [x] opportunities reference table (schema.ts) with sourced fields + dataSource/dataAsOf; NO ranking column
- [x] table created in DB + migration SQL 0007 written
- [x] seed module server/opportunitySeed.ts (12 sourced, timestamped, unverified rows across classes)
- [x] db helpers: listOpportunities (neutral order), getOpportunityByRef, countOpportunities, upsertOpportunity
- [x] tRPC opportunities.list (self-seeding, neutral order) + opportunities.byRef; tsc clean

## Phase 3 — Frontend Explore page (DONE)
- [x] New page Explore.tsx; nav entry under new INVEST group
- [x] Neutral default sort (server: assetClass, then name) — metric sort only on user click
- [x] User filter: search, asset class, currency, liquidity, min/max yield
- [x] User sort by column asc/desc (their click only); nulls sort last
- [x] Per-row provenance + staleness badge (reuses rateStaleness)
- [x] Persistent "information only, verify before acting" disclaimer
- [x] Past-performance caution tooltip on trailing return

## Phase 4 — Detail view + Model CTA (DONE)
- [x] OpportunityDetail.tsx: full sourced profile, each fact timestamped + back button
- [x] Single primary action "Model in my plan" (hypothetical), toast stub for Part 3
- [x] Respects Test/Live mode with same chip styling as deposit CTA
- [x] No buy/invest/brokerage path; tsc clean

## Phase 5 — Audit + tests + deliver (DONE)
- [x] Neutral-language audit clean (only comments/disclaimers mention ranking, to deny it)
- [x] Tests: 13 new (seed neutrality/provenance, no ranking field, neutral order, staleness)
- [x] Full suite 795/795 pass; tsc clean
- [x] Visual verification of /explore + detail page
- [x] Checkpoint + deliver
- [ ] full suite + tsc clean; existing pages/numbers unaffected
- [ ] checkpoint + deliver
