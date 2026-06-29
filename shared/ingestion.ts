/**
 * Expansion Brief — Part 7.2: the scraper / ingestion contract.
 *
 * This module defines the SHAPE every per-source adapter must conform to. The
 * single most important property here is the BRIGHT LINE from the brief:
 *
 *   The scraper must never compute, store, or infer a score, rating, rank,
 *   "performer," or quality signal.
 *
 * We enforce that STRUCTURALLY, not by convention: an adapter can only return
 * `ScrapedFigure`s drawn from the closed `FIELD_KEYS` set (price, yield, coupon,
 * tenor, maturity, distribution, fx, expense, trailingReturn) plus neutral
 * descriptive fields. There is no property anywhere in the return type that could
 * hold a ranking — so producing one is a type error, not a code-review catch.
 *
 * Adapters are PURE PARSERS: they take already-fetched raw text/JSON (HTML, CSV,
 * JSON) and a fetch timestamp, and return facts. They do NOT perform network I/O
 * themselves — fetching, caching, rate-limiting and back-off live in the runner
 * (`server/ingestion/runner.ts`) so the parsing logic stays deterministic and is
 * testable against fixtures with no network.
 *
 * This file is shared/ (pure, no server deps) so both the runner and the tests
 * import the exact same contract.
 */
import {
  type FieldKey,
  type FieldProvenance,
  type FieldProvenanceMap,
  scrapedField,
  toEpochMs,
} from "./provenance";

/**
 * The ONLY facts an adapter may emit for one figure. Mirrors a single
 * `FieldProvenance` minus the verification lifecycle (which the runner stamps as
 * `scraped_unverified` — an adapter can never assert a figure is human-checked).
 *
 * Note what is ABSENT and intentionally unrepresentable: no `score`, `rating`,
 * `rank`, `grade`, `tier`, `stars`, `recommended`, `isBest`, `performer`, or any
 * other quality signal. The shape simply has nowhere to put one.
 */
export interface ScrapedFigure {
  /** Which canonical figure this is. Constrained to the closed FieldKey union. */
  key: FieldKey;
  /** The figure verbatim from the source, as a string to preserve precision. */
  value: string;
  /** Specific authoritative origin label, e.g. "CBK auction 27-Jun-2026". */
  source: string;
  /** Direct link to the origin where one exists. */
  sourceUrl?: string | null;
  /** The timestamp the figure itself is as-of (NOT when we scraped), epoch ms UTC. */
  asOf: number | null;
}

/**
 * One instrument's worth of scraped facts. `ref` is the stable key the runner
 * upserts against; the descriptive fields are neutral identifiers only. Again,
 * there is deliberately no field here that could carry a ranking or score.
 */
export interface ScrapedInstrument {
  /** Stable reference key (NSE ticker, ISIN, fund code) — matches opportunities.ref. */
  ref: string;
  /** Display name (neutral). */
  name: string;
  /** AssetClass taxonomy value (cash_mmf | gov_discount | gov_coupon | equity | reit | ...). */
  assetClass: string;
  /** Issuer / manager / counterparty (neutral). */
  issuer?: string | null;
  /** ISO currency code. */
  currency?: string | null;
  /** Market/segment label (neutral descriptor, e.g. "NSE", "CBK"). */
  market?: string | null;
  /** Optional neutral factual note (no opinion, no quality language). */
  factNote?: string | null;
  /** The factual figures. Each is a closed-union ScrapedFigure. */
  figures: ScrapedFigure[];
}

/** The result of one adapter run: zero or more instruments of pure facts. */
export interface AdapterResult {
  /** Adapter identity, e.g. "cbk_dhowcsd". */
  sourceId: SourceId;
  /** Instruments parsed from the raw payload. */
  instruments: ScrapedInstrument[];
}

/** Stable identifiers for the authoritative origins we ingest from. */
export const SOURCE_IDS = ["cbk_dhowcsd", "nse", "fund_factsheet"] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

/**
 * What kind of raw payload an adapter parses. Used by the runner to set the right
 * Accept header and by tests to load the right fixture extension.
 */
export type PayloadKind = "html" | "json" | "csv";

/**
 * A per-source adapter. It is a PURE function over already-fetched text — it must
 * not fetch, must not sleep, must not touch the DB. `parse` throws when the
 * payload no longer matches the expected layout (a layout change must fail LOUDLY
 * in tests, never silently emit empty/garbage in production).
 */
export interface SourceAdapter {
  /** Stable identity used for scheduling, caching, and conflict provenance. */
  readonly id: SourceId;
  /** Human label for logs and the conflict review surface. */
  readonly label: string;
  /** The payload format this adapter parses. */
  readonly payloadKind: PayloadKind;
  /** Canonical landing URL of the source (for provenance links / ToS reference). */
  readonly sourceUrl: string;
  /**
   * Parse already-fetched raw text into facts. `fetchedAt` is the epoch-ms time the
   * runner pulled the payload (stamped onto every figure's provenance downstream).
   * MUST throw a descriptive Error if the payload shape is unrecognised.
   */
  parse(raw: string, fetchedAt: number): AdapterResult;
}

/**
 * Per-source politeness / scheduling policy. The brief requires we respect each
 * source's terms and rate limits: equities daily, bonds/MMF weekly or per-auction,
 * and back off on failure rather than hammering. These are declarative constants
 * the runner consults; nothing here ranks anything.
 */
export interface SourcePolicy {
  /** Suggested refresh cadence. */
  cadence: "daily" | "weekly" | "per_auction";
  /** 6-field UTC cron (sec min hour dom mon dow) the Heartbeat scheduler would use. */
  cron: string;
  /** Minimum milliseconds between consecutive requests to this origin (rate limit). */
  minRequestSpacingMs: number;
  /** Max attempts before giving up for this run (exponential back-off between tries). */
  maxAttempts: number;
  /** Base back-off delay in ms; doubled each attempt (capped by the runner). */
  backoffBaseMs: number;
  /** Whether the source publishes robots/ToS that we honour by not crawling sub-pages. */
  singlePageOnly: boolean;
}

export const SOURCE_POLICIES: Record<SourceId, SourcePolicy> = {
  // Listed equities & REIT prices move daily; pull once per trading day after close.
  nse: {
    cadence: "daily",
    cron: "0 30 16 * * 1-5", // 16:30 UTC ≈ after NSE close, weekdays
    minRequestSpacingMs: 2000,
    maxAttempts: 4,
    backoffBaseMs: 1000,
    singlePageOnly: true,
  },
  // Auction-driven; CBK publishes weekly T-bill auctions and periodic bond results.
  cbk_dhowcsd: {
    cadence: "per_auction",
    cron: "0 0 9 * * 4", // 09:00 UTC Thursday (after the weekly T-bill auction)
    minRequestSpacingMs: 3000,
    maxAttempts: 4,
    backoffBaseMs: 2000,
    singlePageOnly: true,
  },
  // Manager fact sheets update slowly (daily yields, but published cadence is loose).
  fund_factsheet: {
    cadence: "weekly",
    cron: "0 0 7 * * 1", // 07:00 UTC Monday
    minRequestSpacingMs: 3000,
    maxAttempts: 3,
    backoffBaseMs: 2000,
    singlePageOnly: true,
  },
};

/**
 * Convert one adapter's `ScrapedFigure` into a `scraped_unverified` FieldProvenance.
 * Centralised so EVERY ingested figure starts unverified — an adapter physically
 * cannot mint a human-checked figure.
 */
export function figureToProvenance(fig: ScrapedFigure, fetchedAt: number): FieldProvenance {
  return scrapedField({
    value: fig.value,
    source: fig.source,
    sourceUrl: fig.sourceUrl ?? null,
    asOf: fig.asOf,
    fetchedAt,
  });
}

/** Build a fresh (all-unverified) FieldProvenanceMap from a scraped instrument. */
export function instrumentToProvenanceMap(
  inst: ScrapedInstrument,
  fetchedAt: number,
): FieldProvenanceMap {
  const map: FieldProvenanceMap = {};
  for (const fig of inst.figures) {
    map[fig.key] = figureToProvenance(fig, fetchedAt);
  }
  return map;
}

/**
 * A small helper adapters use to build a ScrapedFigure while normalising the
 * as-of value. Kept here (not in an adapter) so all adapters share identical
 * normalisation. Returns null when the value is missing/blank so callers can skip
 * absent figures rather than emit empty ones.
 */
export function mkFigure(args: {
  key: FieldKey;
  value: string | number | null | undefined;
  source: string;
  sourceUrl?: string | null;
  asOf: Date | string | number | null;
}): ScrapedFigure | null {
  if (args.value === null || args.value === undefined) return null;
  const v = typeof args.value === "number" ? String(args.value) : args.value.trim();
  if (v === "") return null;
  return {
    key: args.key,
    value: v,
    source: args.source,
    sourceUrl: args.sourceUrl ?? null,
    asOf: toEpochMs(args.asOf),
  };
}
