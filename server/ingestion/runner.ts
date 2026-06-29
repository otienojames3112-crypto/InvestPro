/**
 * Part 7.2 — ingestion runner.
 *
 * This is the ONLY layer that does network I/O. Adapters are pure parsers; the
 * runner fetches the raw payload (respecting per-source rate-limit spacing and
 * backing off exponentially on failure rather than hammering), hands the text to
 * the adapter, then upserts each parsed instrument via `ingestScrapedInstrument`
 * so every figure lands as `scraped_unverified` and NO human value is clobbered.
 *
 * Testability: `runAdapter` accepts an optional `rawOverride` (and the tests pass
 * fixture text), so the whole pipeline — parse → reconcile → upsert → conflicts —
 * is exercised with no network. The bright line holds end to end: nothing here can
 * produce a score/rank because neither the adapter result nor the DB has a slot.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  type AdapterResult,
  type SourceAdapter,
  type SourceId,
  SOURCE_POLICIES,
  instrumentToProvenanceMap,
} from "../../shared/ingestion";
import { ADAPTERS } from "./adapters";
import { ingestScrapedInstrument } from "../db";
import type { InsertOpportunity } from "../../drizzle/schema";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Equal-jitter exponential back-off, capped, mirroring the LLM helper's policy. */
function backoffDelay(attempt: number, baseMs: number, capMs = 30_000): number {
  const cap = Math.min(baseMs * 2 ** attempt, capMs);
  return cap / 2 + Math.random() * (cap / 2);
}

/** Last-request timestamps per source, so we honour `minRequestSpacingMs`. */
const lastRequestAt: Partial<Record<SourceId, number>> = {};

/**
 * Fetch a source's raw payload with rate-limit spacing + exponential back-off.
 * Returns the body text. Throws after `maxAttempts` so the caller can record a
 * failed run rather than swallow it.
 */
async function fetchRaw(adapter: SourceAdapter): Promise<string> {
  const policy = SOURCE_POLICIES[adapter.id];

  // Rate-limit: ensure minimum spacing since our last hit on this origin.
  const last = lastRequestAt[adapter.id];
  if (last !== undefined) {
    const wait = policy.minRequestSpacingMs - (Date.now() - last);
    if (wait > 0) await sleep(wait);
  }

  const accept =
    adapter.payloadKind === "json"
      ? "application/json"
      : adapter.payloadKind === "csv"
        ? "text/csv,text/plain"
        : "text/html";

  let lastErr: unknown;
  for (let attempt = 0; attempt < policy.maxAttempts; attempt++) {
    try {
      lastRequestAt[adapter.id] = Date.now();
      const res = await fetch(adapter.sourceUrl, {
        headers: { Accept: accept, "User-Agent": "kes5m-tracker/ingestion (contact: owner)" },
      });
      if (!res.ok) {
        // Honour Retry-After when present; otherwise exponential back-off.
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : backoffDelay(attempt, policy.backoffBaseMs);
        await res.body?.cancel().catch(() => {});
        if (attempt < policy.maxAttempts - 1) {
          await sleep(wait);
          continue;
        }
        throw new Error(`${adapter.id}: HTTP ${res.status} after ${policy.maxAttempts} attempts`);
      }
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < policy.maxAttempts - 1) {
        await sleep(backoffDelay(attempt, policy.backoffBaseMs));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${adapter.id}: fetch failed`);
}

/** Build the neutral base columns to upsert for one parsed instrument. */
function baseColumns(inst: AdapterResult["instruments"][number]): InsertOpportunity {
  return {
    ref: inst.ref,
    name: inst.name,
    assetClass: inst.assetClass,
    issuer: inst.issuer ?? null,
    currency: inst.currency ?? "KES",
    market: inst.market ?? null,
    factNote: inst.factNote ?? null,
    // Row-level provenance mirrors the freshest figure source; figures carry their own.
    dataSource: inst.figures[0]?.source ?? null,
    dataAsOf: inst.figures[0]?.asOf ? new Date(inst.figures[0].asOf) : null,
    unverified: true,
    active: true,
  } as InsertOpportunity;
}

export interface IngestionRunReport {
  sourceId: SourceId;
  instruments: number;
  conflicts: number;
  changed: number;
  ok: boolean;
  error?: string;
}

/**
 * Run a single adapter end to end. Pass `rawOverride` to skip the network (tests,
 * or replaying a cached payload). The fetch timestamp is stamped onto every
 * figure's provenance as `fetchedAt`.
 */
export async function runAdapter(
  adapter: SourceAdapter,
  rawOverride?: string,
  now: number = Date.now(),
): Promise<IngestionRunReport> {
  const report: IngestionRunReport = {
    sourceId: adapter.id,
    instruments: 0,
    conflicts: 0,
    changed: 0,
    ok: false,
  };
  try {
    const raw = rawOverride ?? (await fetchRaw(adapter));
    const result = adapter.parse(raw, now);
    for (const inst of result.instruments) {
      const map = instrumentToProvenanceMap(inst, now);
      const res = await ingestScrapedInstrument({
        base: baseColumns(inst),
        scraped: map,
        sourceId: adapter.id,
      });
      report.instruments += 1;
      report.conflicts += res.conflicts;
      if (res.changed) report.changed += 1;
    }
    report.ok = true;
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
    report.ok = false;
  }
  return report;
}

/** Run every registered adapter (used by the scheduled job). */
export async function runAllAdapters(): Promise<IngestionRunReport[]> {
  const reports: IngestionRunReport[] = [];
  for (const id of Object.keys(ADAPTERS) as SourceId[]) {
    reports.push(await runAdapter(ADAPTERS[id]));
  }
  return reports;
}

/** Load a fixture payload from disk (used by tests and local dry-runs). */
export async function loadFixture(name: string): Promise<string> {
  const p = path.join(import.meta.dirname, "fixtures", name);
  return readFile(p, "utf8");
}
