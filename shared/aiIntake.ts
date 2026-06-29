/**
 * Expansion Brief — Part 8: AI-assisted instrument intake & universe discovery.
 *
 * Anchoring principle: AI is a LIBRARIAN, never an ORACLE. It finds and structures
 * facts for a human to confirm. It never asserts a fact as true, never judges
 * quality, and never invents an instrument that becomes the source of record.
 *
 * This module defines the ONLY shapes AI output is allowed to take. The shapes are
 * deliberately closed and contain NO score / rank / rating / recommendation field.
 * A compile-time guard (`_assertNoVerdictFields` below) makes adding such a field a
 * type error, and a runtime sanitizer (`stripVerdictFields`) drops any such keys a
 * model hallucinates into its JSON. Together these make "AI cannot rank or
 * recommend" a property of the type system + pipeline, not just of the prompt copy.
 *
 * Everything AI produces enters the catalog at the lowest trust tier (ai_extracted,
 * see shared/provenance.ts) and must be confirmed by a human against the cited
 * source before it is trusted.
 */

import type { FieldKey } from "./provenance";

/**
 * Field keys an AI extraction is permitted to populate. This is exactly the factual
 * figure set from provenance.ts — there is no "score" or "rating" key to target.
 */
export const AI_EXTRACTABLE_FIELDS = [
  "price",
  "yield",
  "coupon",
  "tenor",
  "maturity",
  "distribution",
  "fx",
  "expense",
  "trailingReturn",
] as const satisfies readonly FieldKey[];

export type AiExtractableField = (typeof AI_EXTRACTABLE_FIELDS)[number];

/**
 * One factual figure the AI claims it read from the source document. `value` is kept
 * as a verbatim string (preserving the source's precision) and MUST be accompanied by
 * a `quote` — the exact snippet of source text the value was read from — so a human
 * can confirm it against the document. There is no confidence/score here on purpose:
 * a number is either in the document or it is not; the AI does not get to grade it.
 */
export interface AiExtractedFigure {
  field: AiExtractableField;
  /** Verbatim value as written in the source (e.g. "9.25", "13.50%", "2041-03-01"). */
  value: string;
  /** The exact source sentence/snippet this value was read from (for human confirm). */
  quote: string;
  /** Optional as-of date the figure refers to, ISO-8601 (the AI may not know it). */
  asOf?: string | null;
}

/**
 * The full result of reading ONE source document for ONE instrument. Identity fields
 * (name/issuer/currency/...) plus a list of factual figures. No verdict fields exist.
 */
export interface AiInstrumentExtraction {
  /** Proposed instrument name exactly as written in the document. */
  name: string;
  /** Issuer / manager, if stated. */
  issuer?: string | null;
  /** Asset class the document describes, as the AI reads it (still human-confirmed). */
  assetClass?: string | null;
  /** Currency code if stated (e.g. "KES", "USD"). */
  currency?: string | null;
  /** Listing market / venue if stated (e.g. "NSE"). */
  market?: string | null;
  /** Factual figures the AI read, each with a confirming quote. */
  figures: AiExtractedFigure[];
  /** Anything the AI could NOT find / was unsure of, in plain words (not a score). */
  notes?: string | null;
}

/**
 * A universe-discovery CANDIDATE: a name the AI proposes might be worth TRACKING.
 * It is a suggestion only — it is never inserted into the catalog until a human
 * approves it, and it carries NO ranking. The fields here are purely identifying +
 * a neutral rationale of why it might belong in scope (e.g. "KES money-market fund"),
 * never a judgement of whether it is GOOD.
 */
export interface AiCandidateInstrument {
  /** Proposed instrument name. */
  name: string;
  /** Issuer / manager if known. */
  issuer?: string | null;
  /** Asset class the AI thinks it is (human-confirmed before any insert). */
  assetClass?: string | null;
  /** Currency if known. */
  currency?: string | null;
  /**
   * A NEUTRAL, in-scope rationale — why it matches the requested universe (e.g.
   * "Regulated Kenyan MMF, KES-denominated"). NOT a quality judgement. The sanitizer
   * strips comparative/superlative verdict language is out of scope for code, but the
   * prompt forbids it and the field name keeps reviewers honest.
   */
  scopeReason?: string | null;
  /** Where the AI saw it (so a human can go look), if any. */
  sourceUrl?: string | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Structural guarantee: these shapes cannot carry a verdict.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The set of keys that would let AI rank/score/recommend. They are FORBIDDEN on every
 * AI shape. `stripVerdictFields` removes them at runtime; `_assertNoVerdictFields`
 * makes their presence on the static types a compile error.
 */
export const FORBIDDEN_VERDICT_KEYS = [
  "score",
  "scores",
  "rank",
  "ranking",
  "rating",
  "rate",
  "grade",
  "stars",
  "recommendation",
  "recommend",
  "recommended",
  "verdict",
  "opinion",
  "advice",
  "buy",
  "sell",
  "hold",
  "best",
  "worst",
  "top",
  "bestPick",
  "confidence",
  "quality",
  "suitability",
  "weight",
  "priority",
] as const;

export type ForbiddenVerdictKey = (typeof FORBIDDEN_VERDICT_KEYS)[number];

/**
 * Compile-time guard: if any AI shape ever gains a forbidden verdict key, the
 * intersection below resolves to `never` for that key and this assignment fails to
 * typecheck. `keyof` over the union catches it on every shape at once.
 */
type AiShapeKeys =
  | keyof AiExtractedFigure
  | keyof AiInstrumentExtraction
  | keyof AiCandidateInstrument;

// If this line errors, an AI shape introduced a forbidden verdict key — remove it.
// `Extract` is empty (`never`) only when no shape key overlaps the forbidden set.
const _assertNoVerdictFields: Extract<AiShapeKeys, ForbiddenVerdictKey> extends never
  ? true
  : never = true;
void _assertNoVerdictFields;

/**
 * Runtime sanitizer: defensively strip any forbidden verdict key (at any depth) from
 * an object a model returned, in case it hallucinates one despite the prompt + schema.
 * Returns a deep copy with those keys removed. This is the last line of the structural
 * guarantee: even a misbehaving model cannot smuggle a ranking into the catalog.
 */
export function stripVerdictFields<T>(input: T): T {
  const forbidden = new Set<string>(FORBIDDEN_VERDICT_KEYS as readonly string[]);
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (forbidden.has(k)) continue; // drop the verdict key entirely
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(input) as T;
}

/** True when a parsed object is structurally a usable extraction (has a name + figures array). */
export function isUsableExtraction(x: unknown): x is AiInstrumentExtraction {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return typeof o.name === "string" && o.name.trim() !== "" && Array.isArray(o.figures);
}
