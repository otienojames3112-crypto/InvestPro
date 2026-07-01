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

---

## Round 82 — Research as an AI-assisted manager workbench

**Thesis (enforced end to end):** AI finds and structures market facts, the manager verifies
and approves them, approved facts update the reference catalogues, and **only confirmed
holdings affect the portfolio math.** There is now exactly one write path into a catalogue —
an *approved* pending update — and it is gated + audited.

### Data model (migration `0014_round82_research_workbench.sql`)
- `research_tasks` — one row per Ask-AI question (prompt, scope, answer summary, model, finding count, timing).
- `research_findings` — structured, verdict-free draft facts a task produced (instrument, target catalogue, extracted fields, source url/label/as-of, checked-at, confidence bucket, missing fields, warnings, raw excerpt, status, drafted-update link).
- `catalogue_audit_log` — immutable record of every approval (catalogue, target ref, change kind, field, old→new value, source, approver, task/update links, note).
- `research_updates` extended: `findingId`, `field`, `oldValue`, `managerValue` + new `conflict` status.
- `source_registry` extended: `category`, agent clock (`lastCheckedAt`, `lastSuccessfulCheckAt`, `status`).
- Applied by hand via `webdev_execute_sql` (project convention — drizzle journal is intentionally behind; later migrations are hand-authored + applied directly).

### Governance (server)
- **Three live-write bypasses closed.** `opportunities.aiExtract`, `opportunities.reviewCandidate` (approve), and `opportunities.addOpportunity` no longer touch the live catalogue — they all enqueue a **pending** `create`/`update` that a manager must approve. `addOpportunity` also normalises the incoming asset class to canonical before queueing.
- **Ask-AI engine** (`server/aiResearchService.ts`): natural-language question → answer summary + structured draft findings. Reads sources server-side, self-reports a `confidence` (governance metadata only, never a ranking/recommendation), lists `missingFields`, and is run through the verdict scrub — with `confidence` captured *before* the scrub so the global anti-verdict guard stays intact.
- **Approval gate + manager override + audit** live in `reviewResearchUpdate`: catalogue-specific required-field validation blocks incomplete `create`s (surfaced as a typed `BAD_REQUEST`), a `managerValue` lets the manager vouch for a figure over the AI's, and every approval writes a `catalogue_audit_log` row (old→new, source, approver, task link).
- **Explore federation** (`listFederatedUniverse`): the approved universe across MMF + Bank + CBK + Market catalogues; unapproved findings are excluded.
- **Portfolio-impact descriptor**: MMF yield changes affect projection *only if that fund is the portfolio's primary MMF*; bank/CBK/market catalogue edits are reference-only and never restate existing balances — surfaced per-card in Pending Updates.

### UX (client)
- Research is manager-only (non-admins see a lock card).
- Six-tab area in the navigation contract order: **Explore Screener · MMF Market · Bank Products · CBK Securities · Market Assets · Research Desk** (grouped visually as Desk / Explore / Reference Catalogues; legacy `?tab=` deep links still resolve).
- Research Desk: 4-tile digest (changes awaiting review · sources due · findings to triage · open source conflicts) + tabs **Ask AI · Findings · Pending Updates · Conflicts · Sources · Recently Approved · Document import**.
- Explore adds a **This catalogue / All catalogues** federation toggle.

### Scheduled source-check agent (`/api/scheduled/researchSourceCheck`)
- Project-level Heartbeat (periodic-updates §4a). On each run it finds registered sources whose agent-check cadence is due, runs the **same governed Ask-AI persistence path** per source, and writes **only `new` findings** — it never enqueues, approves, or publishes. It stamps the per-source agent clock, flags long-overdue sources `stale`, and notifies the owner only when there is something to act on.
- Handler is mounted in `server/_core/index.ts`. **The cron itself must be created after deploy** (dev sandboxes are unreachable). Once published, run from a sandbox terminal:

```bash
manus-heartbeat create \
  --name kes5m-research-source-check \
  --cron "0 0 6 * * *" \
  --path /api/scheduled/researchSourceCheck \
  --description "Daily 06:00 UTC: check due sources, draft new findings for manager review (never publishes)"
```

Persist the returned `task_uid` if you'll want to pause/update it later (`manus-heartbeat list` can also recover it).

### Tests
- `server/researchWorkbench.round82.test.ts` (24 tests): AI never emits verdicts / always drafts, approval gate per catalogue, portfolio-impact reference-vs-holding invariant, federation catalogue mapping, source agent-clock due logic, and source-string invariants that the three bypasses are closed + the scheduled handler only proposes.
- Two `opportunityMaintainer.test.ts` cases rewritten to the new governed contract (hand entry queues a pending update; nothing lands live until approved).
- Full suite: **147 files / 1450 tests green; `tsc` clean.**

### Bug fixed en route
- Research-finding `confidence` was being deleted by the shared anti-verdict scrub (`FORBIDDEN_VERDICT_KEYS`), collapsing every finding to 0. Fixed at the root by capturing self-reported confidence before the scrub, keeping the global guard intact for the catalogue shapes.
