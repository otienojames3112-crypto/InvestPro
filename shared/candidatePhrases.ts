/**
 * Stage 7a — pure, deterministic candidate-phrase matching (PURE, framework-free,
 * no LLM call, no I/O).
 *
 * Extraction schemas ask for fields under a fixed canonical name (e.g. `maturityDate`),
 * but a real source document often prints the SAME fact under a different label
 * ("Due Date", "Redemption Date"). When the model doesn't recognise the synonym, the
 * field is reported as genuinely MISSING even though the source contains it. This
 * module closes that gap WITHOUT an extra LLM call: given the source text already
 * loaded in memory for the extraction request (never a new fetch) and the list of
 * fields the approval gate reports missing, it scans for known synonym labels and
 * reports a CANDIDATE — the verbatim phrase it matched, plus a short nearby value if
 * one was cleanly extractable.
 *
 * Guardrails this module exists to enforce (do not weaken these when extending it):
 *   - Never invents a value: `value` is either a literal substring captured near the
 *     matched phrase, or null. Nothing is inferred, guessed, or filled from a model.
 *   - Never writes anything: a `CandidateMatch` is plain data. This module never
 *     touches `extractedFields`, `missingRules`, drafting, or approval — a caller
 *     decides what (if anything) to do with a candidate.
 *   - A field can only ever produce a candidate when its key has a REGISTERED
 *     synonym list below — an unregistered key can never produce a false positive.
 *   - "Candidate found" is a THIRD state, distinct from "present" and "missing" — it
 *     is never treated as if the field were satisfied.
 */

import type { ReferenceCatalogue } from "./researchPipeline";

/** One gate field's known synonym labels a source might print instead of the
 *  catalogue's canonical field name. Ordered longest/most-specific phrase first so
 *  a more precise synonym wins over a shorter generic one that happens to be its
 *  prefix (e.g. "term to maturity" before "term"). */
export interface FieldSynonyms {
  /** The gate's canonical field key this synonym list is for (e.g. "maturityDate"). */
  key: string;
  /** Human label — mirrors CatalogueFieldRule.label for display parity. */
  label: string;
  /** Lowercase synonym phrases, longest/most-specific first. */
  synonyms: string[];
}

/** A detected candidate — a synonym phrase found in the source text near a field
 *  the approval gate reports missing. Never a confirmed value. */
export interface CandidateMatch {
  key: string;
  label: string;
  /** The phrase exactly as it appears in the source (original casing preserved). */
  phrase: string;
  /** A short value captured immediately after the phrase, or null if none was
   *  cleanly found nearby (e.g. the value sits on a different line/table row). */
  value: string | null;
}

// ─── Per-catalogue synonym dictionaries ────────────────────────────────────────
// Every entry here is scoped to a REAL gate field key (CATALOGUE_FIELD_RULES /
// CBK_SUBTYPE_FIELD_RULES / MARKET_ASSET_SUBTYPE_FIELD_RULES / SACCO_MARKET_ASSET_
// FIELD_RULES in shared/researchPipeline.ts) — never an invented key.

const CBK_SYNONYMS: FieldSynonyms[] = [
  { key: "tenor", label: "tenor", synonyms: ["term to maturity", "tenor", "term"] },
  {
    key: "yieldPct",
    label: "rate / coupon / previous average rate",
    synonyms: [
      "weighted average rate of accepted bids",
      "weighted average interest rate of accepted bids",
      "weighted average interest rate",
      "weighted average yield",
      "annualised yield",
    ],
  },
  { key: "valueDate", label: "value / settlement date", synonyms: ["settlement date", "payment deadline", "value date"] },
  { key: "maturityDate", label: "maturity date", synonyms: ["redemption date", "due date", "maturity date"] },
  { key: "couponRate", label: "coupon rate", synonyms: ["coupon rate", "interest rate"] },
  { key: "auctionDate", label: "auction date", synonyms: ["auction date", "sale date"] },
  { key: "issueNumber", label: "issue number", synonyms: ["issue number", "issue no.", "issue no"] },
  { key: "cleanPrice", label: "clean price", synonyms: ["price per kshs 100", "price per 100", "clean price"] },
];

const MMF_SYNONYMS: FieldSynonyms[] = [
  { key: "ear", label: "gross yield or EAR", synonyms: ["effective annual rate", "effective yield", "net yield"] },
  { key: "managementFee", label: "management fee", synonyms: ["annual management fee", "management fee"] },
  {
    key: "minInvestment",
    label: "minimum investment",
    synonyms: ["minimum initial investment", "minimum investment", "minimum amount"],
  },
  { key: "asOf", label: "as-of date", synonyms: ["factsheet date", "report date", "as at"] },
];

const BANK_SYNONYMS: FieldSynonyms[] = [
  { key: "indicativeRate", label: "indicative rate", synonyms: ["indicative rate", "nominal rate", "effective rate"] },
  { key: "typicalTenor", label: "tenor / notice period", synonyms: ["notice period", "tenor", "term"] },
  { key: "minAmount", label: "minimum amount", synonyms: ["minimum balance", "minimum amount", "minimum deposit"] },
  { key: "asOf", label: "as-of date", synonyms: ["rate card date", "effective date", "as at"] },
];

const MARKET_ASSET_SYNONYMS: FieldSynonyms[] = [
  {
    key: "lastPrice",
    label: "price / NAV / yield / return",
    synonyms: ["last traded price", "closing price", "market price", "nav"],
  },
  { key: "distributionYield", label: "distribution yield", synonyms: ["distribution yield", "income yield"] },
  { key: "expenseRatioPct", label: "expense ratio / fee", synonyms: ["total expense ratio", "expense ratio", "ter"] },
  { key: "asOf", label: "as-of date", synonyms: ["reporting date", "factsheet date", "as at"] },
  { key: "regulatoryStatus", label: "SASRA / regulatory status", synonyms: ["sasra-regulated", "sasra status", "regulated by"] },
  { key: "minimumShareCapital", label: "minimum share capital", synonyms: ["minimum share capital", "minimum shares"] },
  {
    key: "minimumMonthlyDeposit",
    label: "minimum monthly deposit / contribution",
    synonyms: ["minimum monthly contribution", "minimum monthly deposit"],
  },
  { key: "withdrawalTerms", label: "withdrawal / liquidity terms", synonyms: ["withdrawal terms", "exit terms", "notice period"] },
  { key: "shareCapitalDividendRate", label: "share-capital dividend rate", synonyms: ["share dividend rate", "dividend rate"] },
  { key: "depositRebateRate", label: "deposit rebate / interest rate", synonyms: ["deposit interest rate", "rebate rate"] },
];

function synonymsForCatalogue(catalogue: ReferenceCatalogue): FieldSynonyms[] {
  switch (catalogue) {
    case "cbk":
      return CBK_SYNONYMS;
    case "mmf":
      return MMF_SYNONYMS;
    case "bank":
      return BANK_SYNONYMS;
    case "market_asset":
      return MARKET_ASSET_SYNONYMS;
  }
}

/**
 * The {key, label} pairs registered for a catalogue's synonym dictionary — lets a
 * caller (e.g. a candidate-detection call site) know which field keys THIS module
 * can recognise synonyms for, without needing to know the dictionary's contents or
 * duplicate it. Read-only lookup data, not gate/approval logic.
 */
export function registeredFieldsForCatalogue(catalogue: ReferenceCatalogue): { key: string; label: string }[] {
  return synonymsForCatalogue(catalogue).map((d) => ({ key: d.key, label: d.label }));
}

/** Escape a string for safe literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Try one synonym phrase against the source text. Returns the phrase AS MATCHED
 *  (original source casing) plus a short same-line value, or null if the phrase
 *  isn't present at all. A phrase with nothing usable nearby still counts as a
 *  match (phrase found, value: null) — the manager can see WHERE, even without a
 *  clean captured value. */
function matchOneSynonym(sourceText: string, synonym: string): { phrase: string; value: string | null } | null {
  // Separator between the phrase and its value stays on the SAME LINE only
  // (horizontal whitespace, not \s, which would cross into the next paragraph).
  // The value capture is non-greedy and stops at the first sentence boundary
  // (". " + a capital letter), a newline, or end of string — never mid-decimal,
  // since a plain "8.8347" has no whitespace after its internal ".".
  const pattern = new RegExp(
    `(${escapeRegExp(synonym)})[ \\t]*[:\\-–]?[ \\t]*([^\\n\\r]{0,80}?)(?=\\.\\s+[A-Z]|[\\n\\r]|$)`,
    "i",
  );
  const m = pattern.exec(sourceText);
  if (!m) return null;
  const phrase = m[1];
  const rawValue = (m[2] ?? "").trim().replace(/[.,;]+$/, "").trim();
  return { phrase, value: rawValue.length > 0 ? rawValue.slice(0, 60) : null };
}

/**
 * Scan `sourceText` for known synonym labels of each field `missingRules` reports
 * as missing. Returns one `CandidateMatch` per rule that (a) has a registered
 * synonym list for its key, AND (b) actually matched somewhere in the text. Rules
 * with no registered synonyms, or whose synonyms don't appear anywhere, produce NO
 * candidate — silence, not a false positive. A compound "A|B" key (e.g. SACCO's
 * dividend/rebate OR-rule) tries each side's synonyms in turn under the one
 * candidate slot for that rule.
 */
export function findCandidatePhrases(
  sourceText: string,
  missingRules: { key: string; label: string }[],
  catalogue: ReferenceCatalogue,
): CandidateMatch[] {
  if (!sourceText || sourceText.trim() === "") return [];
  const dictionary = synonymsForCatalogue(catalogue);
  const byKey = new Map(dictionary.map((d) => [d.key, d]));

  const results: CandidateMatch[] = [];
  for (const rule of missingRules) {
    const subKeys = rule.key.includes("|") ? rule.key.split("|") : [rule.key];
    let found: { phrase: string; value: string | null } | null = null;
    for (const subKey of subKeys) {
      const entry = byKey.get(subKey);
      if (!entry) continue;
      for (const syn of entry.synonyms) {
        found = matchOneSynonym(sourceText, syn);
        if (found) break;
      }
      if (found) break;
    }
    if (found) {
      results.push({ key: rule.key, label: rule.label, phrase: found.phrase, value: found.value });
    }
  }
  return results;
}

/**
 * Stage 7c — safely parse a finding's hidden `extractedFields._candidatePhrases`
 * JSON string back into `CandidateMatch[]`. NEVER throws: absent, malformed JSON,
 * a non-array payload, or an array containing anything not shaped like a
 * `CandidateMatch` all fall back to an empty array rather than propagating an
 * error to the caller (a UI render path). Structural validation only — this does
 * not re-verify the phrase actually exists in any source text (that already
 * happened once, at extraction time, in findCandidatePhrases above).
 */
export function parseCandidatePhrases(raw: unknown): CandidateMatch[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((c): c is CandidateMatch => {
    if (!c || typeof c !== "object") return false;
    const o = c as Record<string, unknown>;
    return (
      typeof o.key === "string" &&
      typeof o.label === "string" &&
      typeof o.phrase === "string" &&
      (o.value === null || typeof o.value === "string")
    );
  });
}
