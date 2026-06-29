/**
 * Expansion Brief — Part 8 (deeper spec), item 2: "AI extraction = just another
 * adapter behind the same wall."
 *
 * This module makes the AI extractor return the EXACT SAME shape the deterministic
 * scrapers return — an `AdapterResult` of `ScrapedInstrument`s drawn from the closed
 * `FIELD_KEYS` set (Part 7.2). Because that shape has structurally NOWHERE to put a
 * score / rating / "performer" / recommendation, an AI model — even one that tries —
 * cannot smuggle a ranking into the catalog. The type is the real guarantee; the
 * prompt forbidding it is only the first line of defence.
 *
 * The ONE difference from a scraper run is trust: a scraper figure lands at
 * `scraped_unverified`, whereas an AI figure lands at the strictly-lower `ai_extracted`
 * tier. So this module provides `aiInstrumentToProvenanceMap`, the AI-tier analogue of
 * `instrumentToProvenanceMap`, which also runs each figure through the numeric sanity
 * gate (`checkFigureSanity`) and attaches a neutral `reviewFlag` to implausible values
 * so they are surfaced for review rather than saved as if clean.
 *
 * Pure + shared (no server deps) so the parse→map→reconcile pipeline is unit-testable
 * against fixtures with no network, exactly like the scraper adapters.
 */
import {
  type AdapterResult,
  type ScrapedInstrument,
  type ScrapedFigure,
} from "./ingestion";
import { aiExtractedField, type FieldKey, type FieldProvenanceMap } from "./provenance";
import { checkFigureSanity } from "./figureSanity";
import { AI_INTAKE_SOURCE_ID } from "./ingestion";
import type { AiInstrumentExtraction } from "./aiIntake";

/** Slugify a name into a stable provisional ref when the human supplies none. */
export function aiRefFromName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return `ai-${slug || "instrument"}`;
}

/**
 * Convert a sanitized {@link AiInstrumentExtraction} into the same `AdapterResult`
 * the scrapers emit. The extraction has already been stripped of verdict fields and
 * had every figure quote-checked upstream; here we map it onto the neutral
 * `ScrapedInstrument` shape so it can flow through the identical ingestion machinery.
 *
 * The figure `source` carries the cited document label plus the verbatim quote, so the
 * confirm-against-source UI shows exactly what to check. `asOf` is the figure's stated
 * as-of date when present.
 */
export function extractionToAdapterResult(args: {
  extraction: AiInstrumentExtraction;
  ref?: string | null;
  sourceLabel: string;
  sourceUrl: string | null;
}): AdapterResult {
  const { extraction } = args;
  const ref = args.ref && args.ref.trim() !== "" ? args.ref.trim() : aiRefFromName(extraction.name);

  const figures: ScrapedFigure[] = extraction.figures.map((f) => {
    const asOf = f.asOf ? Date.parse(f.asOf) : NaN;
    return {
      key: f.field as FieldKey,
      value: f.value,
      // Cited source + the verbatim quote, so a human can confirm it in one glance.
      source: `${args.sourceLabel} — “${truncate(f.quote, 160)}”`,
      sourceUrl: args.sourceUrl,
      asOf: Number.isFinite(asOf) ? asOf : null,
    };
  });

  const instrument: ScrapedInstrument = {
    ref,
    name: extraction.name,
    // Asset class is a neutral taxonomy hint the human confirms; never trusted blindly.
    assetClass: (extraction.assetClass ?? "alt").slice(0, 32),
    issuer: extraction.issuer ?? null,
    currency: (extraction.currency ?? "KES").slice(0, 8),
    market: extraction.market ?? null,
    factNote: extraction.notes ?? null,
    figures,
  };

  // We reuse the AdapterResult shape; sourceId is the non-scraper AI label so any
  // conflicts the reconcile step raises are attributed to AI, not to a real scraper.
  return { sourceId: AI_INTAKE_SOURCE_ID as AdapterResult["sourceId"], instruments: [instrument] };
}

/** One figure that failed the numeric sanity gate, surfaced to the human. */
export interface FlaggedFigure {
  key: FieldKey;
  value: string;
  reason: string;
}

/**
 * Build the AI-tier per-figure provenance map for one scraped-shaped instrument.
 *
 * This is the AI analogue of `instrumentToProvenanceMap`: every figure is stamped
 * `ai_extracted` (the strict trust floor) rather than `scraped_unverified`. On the way
 * out, each figure passes the numeric sanity gate; an implausible value is NOT dropped
 * and NOT silently saved — it is kept with a neutral `reviewFlag` so the human verifier
 * sees the warning and the value reads as doubly-provisional. We also return the list of
 * flagged figures so the caller can report them.
 */
export function aiInstrumentToProvenanceMap(
  inst: ScrapedInstrument,
  args: { at: number; model: string | null },
): { map: FieldProvenanceMap; flagged: FlaggedFigure[] } {
  const map: FieldProvenanceMap = {};
  const flagged: FlaggedFigure[] = [];

  for (const fig of inst.figures) {
    const verdict = checkFigureSanity(fig.key, fig.value);
    if (!verdict.ok) {
      flagged.push({ key: fig.key, value: fig.value, reason: verdict.reason ?? "Implausible value." });
    }
    map[fig.key] = aiExtractedField({
      value: fig.value,
      source: fig.source,
      sourceUrl: fig.sourceUrl ?? null,
      asOf: fig.asOf,
      at: args.at,
      model: args.model,
      reviewFlag: verdict.ok ? null : (verdict.reason ?? "Implausible value — confirm carefully."),
    });
  }

  return { map, flagged };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}
