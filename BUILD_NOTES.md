# KES 5M Investment Tracker — Build Notes (Part 7 data-integrity layer)

This archive is the full application source (client + server + shared + drizzle), excluding
`node_modules`, `.git`, build output, logs, and one-off scripts.

## Run locally

```bash
pnpm install
# Provide the environment variables listed in README.md (DATABASE_URL, JWT_SECRET,
# VITE_APP_ID, OAUTH_SERVER_URL, the BUILT_IN_FORGE_* keys, etc.). In the Manus
# managed environment these are injected automatically.
pnpm dev          # single Node process serves API + Vite client
pnpm test         # full vitest suite (949 tests)
npx tsc --noEmit  # type gate
```

## Part 7 — what was built (data provenance, scraping, human-in-the-loop, honesty)

### 7.1 Per-figure provenance & verification state
- `shared/provenance.ts` — the model. Every figure (price, yield, coupon, tenor, maturity,
  distribution, expense, trailing return, FX) carries `value, source, sourceUrl, asOf,
  fetchedAt, verificationState` and `verifiedBy/verifiedAt`.
  States: `scraped_unverified | human_verified | human_entered | stale`.
- `drizzle/schema.ts` — `opportunities.fieldProvenance` (JSON map) + `verificationState`
  summary column. Live additive migration applied.
- A human action **raises** trust (`human_verified`/`human_entered`); it is never a silent
  number change. `applyVerification()` enforces the transition.

### 7.2 Per-source ingestion layer (facts only)
- `shared/ingestion.ts` — adapter contract whose return type structurally **cannot** carry a
  score/rank/rating/"performer". The bright line is a type, not a convention.
- `server/ingestion/adapters/{cbk,nse,fundFactsheet}.ts` — one pure parser per authoritative
  source (CBK/DhowCSD auctions, NSE prices/dividends, fund fact sheets). Each throws loudly on
  layout drift; covered by fixture tests in `server/ingestion/*.test.ts`.
- `server/ingestion/runner.ts` — fetch with rate-limit spacing + exponential back-off, parse,
  then `reconcileScrape()` + upsert as `scraped_unverified`, refreshing `asOf/fetchedAt`.
- A fresh scrape that disagrees with a human-checked figure **never clobbers** it — it raises a
  row in `ingestion_conflicts` for review (`server/scheduled/opportunityIngest.ts`).

### 7.3 Human override & verification workflow (maintainer/admin gated)
- `verifyField` (confirm → `human_verified`; edit value **+ source** → `human_entered`),
  `resolveConflict`, `runIngestion`, and `addOpportunity` are all `adminProcedure`.
- UI: per-figure Confirm / Edit-with-source controls (`client/src/pages/OpportunityDetail.tsx`),
  the conflict review screen (`client/src/pages/SourceConflicts.tsx`), and add-instrument-by-hand
  (`client/src/pages/AddInstrument.tsx`). End users see plain verification markers.

### 7.4 Catalog expansion (real-sourced, full provenance)
- `server/opportunitySeed.ts` — expanded to a representative universe (29 instruments) across
  equities, gov coupon/discount, MMFs, REITs, and offshore funds. Every instrument flows through
  `withProvenance`, so each figure has a real source + verification state — no placeholders.
- Default catalog order stays neutral (asset class, then name) at any size.

### 7.5 Staleness & honesty
- `effectiveStateForClass` / `staleDaysForClass` — per-asset-type staleness thresholds wired into
  the real `asOf/fetchedAt` display (equities/REIT ~3d, offshore ~4d, MMF/T-bill ~8d, bonds/deposit ~35d).
- `modelFreshnessPrompt` — a quiet, **non-blocking** prompt in `ModelDrawer.tsx` when a modeled
  figure is stale or unverified. The persistent "information only — verify before acting"
  disclaimer stays; no scraped figure is presented as verified or guaranteed.

### 7.6 Guardrails (regression-locked)
- `server/catalogGuardrails.test.ts` — facts-only at scale, neutral order at 500 rows, no silent
  clobber, and source+age+state always present.

Fixed-income plans and numbers are unchanged. Full suite: 949 tests green; `tsc` clean.
