# Part 7.1 — Per-figure data source model & verification state

## Phase 1 — Audit (done)
- [x] opportunities table is the instrument record; provenance is row-level today (one dataSource/dataAsOf/unverified)
- [x] Seed (opportunitySeed.ts) carries per-row source + asOf; each instrument has up to ~6 figures sharing it
- [x] Router: opportunities.list (self-seeds) + byRef; db helpers upsert/get/list/count
- [x] OpportunityDetail renders each figure via <Fact source asOf> but all share r.dataSource/r.dataAsOf; no verification lifecycle
- [x] Explore.tsx is the catalog list

## Phase 2 — Shared provenance model
- [ ] shared/provenance.ts: canonical FieldKey union (price, yield, coupon, tenor, maturity, distribution, fx, expense, trailingReturn)
- [ ] VerificationState union: scraped_unverified | human_verified | human_entered | stale
- [ ] FieldProvenance type: { value, source, sourceUrl?, asOf, fetchedAt, verificationState, verifiedBy?, verifiedAt? }
- [ ] raiseVerification(): human confirm -> human_verified; human edit (new value) -> human_entered; never lowers trust
- [ ] staleness helper: asOf age -> derived stale flag (display) without overwriting a human state
- [ ] trustRank ordering so we never downgrade a human-checked figure on re-scrape

## Phase 3 — Schema + live migration
- [ ] Add fieldProvenance JSON column + row-level verificationState to opportunities (additive, nullable)
- [ ] Hand-authored migration 0010; apply via webdev_execute_sql; verify columns live
- [ ] Backfill: seed writes per-figure provenance (each figure scraped_unverified with its own source/asOf/fetchedAt)

## Phase 4 — Server
- [ ] db: persist/read fieldProvenance; helper to apply a verification transition
- [ ] opportunities.byRef/list return parsed per-field provenance
- [ ] protected mutation opportunities.verifyField (confirm or override value) -> raises state, stamps verifiedBy/verifiedAt
- [ ] Guard: override stores the new value AND raises state (not number-only)

## Phase 5 — UI
- [ ] Fact component shows per-figure verification badge (unverified / verified by you / entered by you / stale)
- [ ] Per-figure "Confirm" + "Edit value" controls (confirm raises to human_verified; edit to human_entered)
- [ ] Show verifiedBy/verifiedAt ("checked by you on …")
- [ ] Explore list: small per-row indicator of how many figures are human-checked
- [ ] Keep all neutrality/no-advice invariants intact

## Phase 6 — Tests + verify
- [ ] Lifecycle: confirm raises to human_verified; edit raises to human_entered; re-scrape never lowers a human state
- [ ] Override stores new value + raises state (no silent number-only change)
- [ ] Staleness derives from asOf without clobbering human state
- [ ] Migration backfill: every seeded figure has provenance
- [ ] Full suite + tsc clean; visual check; checkpoint & deliver
