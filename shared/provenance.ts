/**
 * Expansion Brief — Part 7.1: per-figure data-source model & verification state.
 *
 * The honesty principle from Part 1 was "provenance travels with the value." Part
 * 7.1 makes that PER FIGURE, not per row: every individual number on an instrument
 * (price, yield, coupon, tenor, distribution, FX, fee, maturity, trailing return)
 * carries its own source, timestamps and a verification lifecycle.
 *
 * The point of the verification state is TRUST, not mere correctness: when a human
 * confirms or re-enters a figure, that figure's trust RISES (to human_verified /
 * human_entered) and we record who did it and when. A later automated re-scrape
 * must never silently lower a figure a person has already checked — it can only
 * mark it stale for display. The UI uses these states to show which figures a
 * real person has actually looked at.
 *
 * This module is pure and deterministic so the lifecycle is unit-testable and can
 * be reused for Live holdings provenance later. It performs NO ranking, scoring or
 * recommendation — it only describes where a number came from and how trusted it is.
 */

/**
 * Canonical figure keys. One instrument exposes a subset of these depending on its
 * asset class (a T-bill has no price/FX; an ETF has no coupon). Keys are stable so
 * provenance can be addressed individually by the UI and the verify mutation.
 */
export const FIELD_KEYS = [
  "price", // last traded / quoted price
  "yield", // headline yield (MMF/bank/dividend/distribution headline)
  "coupon", // bond coupon
  "tenor", // term in years
  "maturity", // maturity date
  "distribution", // REIT/fund distribution figure
  "fx", // FX rate used to express a foreign figure in KES
  "expense", // expense ratio / management fee
  "trailingReturn", // trailing 12-month total return
] as const;

export type FieldKey = (typeof FIELD_KEYS)[number];

export function isFieldKey(v: string): v is FieldKey {
  return (FIELD_KEYS as readonly string[]).includes(v);
}

/**
 * Verification lifecycle for a single figure.
 *  - ai_extracted:       an LLM pulled this figure from a source document. NO human and
 *                        NO deterministic parser has checked it. This is the LEAST
 *                        trusted state of all — a scraper at least parsed a known
 *                        structure, whereas an LLM may have hallucinated the number.
 *                        (Part 8.) It is never auto-promoted and never clobbers a
 *                        scrape or a human value; it only ever rises by being checked.
 *  - scraped_unverified: pulled from a public source by a deterministic parser, no
 *                        human has checked it.
 *  - human_verified:     a person confirmed the scraped/AI value is correct.
 *  - human_entered:      a person typed/overrode the value themselves.
 *  - stale:              a DISPLAY state for a scraped/AI figure whose as-of date is old
 *                        and which no human has since checked. It is derived, never a
 *                        stored downgrade of a human state.
 */
export const VERIFICATION_STATES = [
  "ai_extracted",
  "scraped_unverified",
  "human_verified",
  "human_entered",
  "stale",
] as const;

export type VerificationState = (typeof VERIFICATION_STATES)[number];

export function isVerificationState(v: string): v is VerificationState {
  return (VERIFICATION_STATES as readonly string[]).includes(v);
}

/**
 * Trust ranking. Higher = more trusted / more human attention. Used so a re-scrape
 * can never overwrite a figure a human has already verified or entered, AND so an AI
 * extraction can never overwrite a deterministic scrape or a human value.
 *
 * Ordering (lowest → highest): ai_extracted < scraped_unverified < stale-display
 * < human_verified < human_entered.
 *
 * Two figures share the bottom for two DIFFERENT reasons:
 *  - `ai_extracted` is the lowest STORED trust (an LLM may have hallucinated it), so a
 *    deterministic scrape is allowed to raise it.
 *  - `stale` is the lowest DISPLAY trust (a once-scraped figure gone old) — it is a
 *    derived projection, never a stored value, so it never participates in clobber
 *    decisions (those use the stored state). We give ai_extracted the true floor and
 *    place stale just above it for the brief's display ordering.
 */
const TRUST_RANK: Record<VerificationState, number> = {
  ai_extracted: 0,
  stale: 1,
  scraped_unverified: 2,
  human_verified: 3,
  human_entered: 4,
};

export function trustRank(s: VerificationState): number {
  return TRUST_RANK[s];
}

/** True when `a` is at least as trusted as `b`. */
export function isAtLeastAsTrusted(a: VerificationState, b: VerificationState): boolean {
  return trustRank(a) >= trustRank(b);
}

/** A human-checked figure is one a real person confirmed or entered. */
export function isHumanChecked(s: VerificationState): boolean {
  return s === "human_verified" || s === "human_entered";
}

/**
 * Provenance for one figure. `value` is stored as a string to preserve the source's
 * exact precision (mirrors how the numeric columns are decimals). Dates are stored
 * as epoch milliseconds (UTC) per the project's datetime rule.
 */
export interface FieldProvenance {
  /** The figure itself, verbatim from the source or the human. */
  value: string | null;
  /** Human-readable specific origin, e.g. "CBK auction 27-Jun-2026", "NSE close". */
  source: string | null;
  /** Direct link to the authoritative origin where one exists. */
  sourceUrl?: string | null;
  /** Timestamp the figure itself is as-of (NOT when we scraped it), epoch ms UTC. */
  asOf: number | null;
  /** When we last pulled/refreshed this figure, epoch ms UTC. */
  fetchedAt: number | null;
  /** Current verification state for this figure. */
  verificationState: VerificationState;
  /** Display name of the human who last confirmed/entered it. */
  verifiedBy?: string | null;
  /** When the human confirmed/entered it, epoch ms UTC. */
  verifiedAt?: number | null;
  /**
   * Part 8: when this figure was pulled by an LLM (verificationState=ai_extracted),
   * the model id that produced it. Recorded for honesty/auditing only — it is NEVER
   * a quality signal and never raises trust. Null for non-AI figures.
   */
  aiModel?: string | null;
}

/** A whole instrument's per-field provenance map (only the applicable keys are set). */
export type FieldProvenanceMap = Partial<Record<FieldKey, FieldProvenance>>;

/** Number of days after which a scraped, un-human-checked figure is considered stale. */
export const STALE_AFTER_DAYS = 30;
export const VERY_STALE_AFTER_DAYS = 90;

/**
 * Build a fresh scraped-figure provenance entry (used by the seed/ingestion). The
 * figure starts UNVERIFIED — no human has looked at it yet.
 */
export function scrapedField(args: {
  value: string | null;
  source: string | null;
  sourceUrl?: string | null;
  asOf: number | null;
  fetchedAt?: number | null;
}): FieldProvenance {
  return {
    value: args.value,
    source: args.source,
    sourceUrl: args.sourceUrl ?? null,
    asOf: args.asOf,
    fetchedAt: args.fetchedAt ?? args.asOf ?? null,
    verificationState: "scraped_unverified",
    verifiedBy: null,
    verifiedAt: null,
  };
}

/**
 * Part 8 — build a fresh AI-EXTRACTED figure provenance entry. An LLM read a source
 * document and pulled this figure; no human and no deterministic parser has checked
 * it, so it starts at the LOWEST trust state of all (`ai_extracted`). It is the AI
 * counterpart of `scrapedField`: it records the cited source the AI read it from, the
 * model that produced it, and the timestamps — but it asserts nothing about whether
 * the value is correct, and it carries no score/rank/quality field. It can only ever
 * RISE in trust by a human confirming it (or a deterministic scrape overwriting it).
 */
export function aiExtractedField(args: {
  value: string | null;
  /** The cited source document the AI read the figure FROM (e.g. "ILAM fact sheet Q1-2026"). */
  source: string | null;
  /** Direct link to that source document, so a human can confirm against it. */
  sourceUrl?: string | null;
  /** As-of date the AI believes the figure refers to, epoch ms UTC (may be null). */
  asOf?: number | null;
  /** When the AI extraction ran, epoch ms UTC. */
  at: number;
  /** The model id that produced it (audit only, never a quality signal). */
  model?: string | null;
}): FieldProvenance {
  return {
    value: args.value,
    source: args.source && args.source.trim() !== "" ? args.source.trim() : null,
    sourceUrl: args.sourceUrl && args.sourceUrl.trim() !== "" ? args.sourceUrl.trim() : null,
    asOf: args.asOf ?? null,
    fetchedAt: args.at,
    verificationState: "ai_extracted",
    verifiedBy: null,
    verifiedAt: null,
    aiModel: args.model ?? null,
  };
}

/**
 * Build a fresh HUMAN-ENTERED figure provenance entry (used when a maintainer adds
 * an instrument by hand or types an authoritative value). The figure starts at
 * `human_entered` — a real person authored it — and carries who entered it and when,
 * plus the authoritative source they cited. This is the hand-entry counterpart of
 * `scrapedField`; it never ranks or scores anything, it only records origin + trust.
 */
export function humanField(args: {
  value: string | null;
  source: string | null;
  sourceUrl?: string | null;
  asOf?: number | null;
  by: string;
  at: number;
}): FieldProvenance {
  return {
    value: args.value,
    source: args.source && args.source.trim() !== "" ? args.source.trim() : "Entered by you",
    sourceUrl: args.sourceUrl && args.sourceUrl.trim() !== "" ? args.sourceUrl.trim() : null,
    asOf: args.asOf ?? args.at,
    fetchedAt: args.at,
    verificationState: "human_entered",
    verifiedBy: args.by,
    verifiedAt: args.at,
  };
}

/**
 * The effective DISPLAY state of a figure given the current time. A human-checked
 * figure is shown with its human state regardless of age (a person vouched for it).
 * A scraped figure whose as-of date is older than the stale threshold and which no
 * human has checked is shown as `stale`. This is a pure projection — it does not
 * mutate the stored state.
 */
export function effectiveState(p: FieldProvenance, nowMs: number): VerificationState {
  if (isHumanChecked(p.verificationState)) return p.verificationState;
  // An AI-extracted figure NEVER auto-promotes to a more trusted state by mere age:
  // it stays ai_extracted (provisional) until a human checks it or a scrape overwrites
  // it. We keep showing it as ai_extracted regardless of age — its provisionality is
  // a stronger caution than "stale", and we never want age to make it read as safer.
  if (p.verificationState === "ai_extracted") return "ai_extracted";
  const asOf = p.asOf;
  if (asOf === null) return p.verificationState;
  const ageDays = (nowMs - asOf) / (1000 * 60 * 60 * 24);
  if (ageDays >= STALE_AFTER_DAYS) return "stale";
  return p.verificationState;
}

/** Whether a figure should render the "may be stale" caution. */
export function isStaleForDisplay(p: FieldProvenance, nowMs: number): boolean {
  return effectiveState(p, nowMs) === "stale";
}

export type VerifyAction =
  | { kind: "confirm"; by: string; at: number }
  | {
      kind: "override";
      by: string;
      at: number;
      value: string;
      /** Authoritative origin the human took the value from, e.g. "ILAM fact sheet Q1-2026". */
      source?: string | null;
      /** Direct link to that origin, where one exists. */
      sourceUrl?: string | null;
      /** As-of timestamp of the human's figure (epoch ms UTC). Defaults to `at`. */
      asOf?: number | null;
    };

/**
 * Apply a human verification action to a figure. This is the heart of Part 7.1:
 * human attention RAISES trust.
 *
 *  - confirm:  the human says the existing value is correct -> human_verified.
 *  - override: the human supplies their own value -> human_entered, value updated.
 *
 * Invariants enforced here:
 *  1. A confirm/override always results in a human state (never leaves it scraped).
 *  2. An override changes BOTH the value AND the state — there is no number-only
 *     change that leaves trust untouched.
 *  3. Trust never goes DOWN as a result of a human action.
 *  4. verifiedBy / verifiedAt are always stamped on a human action.
 */
export function applyVerification(p: FieldProvenance, action: VerifyAction): FieldProvenance {
  const nextState: VerificationState = action.kind === "confirm" ? "human_verified" : "human_entered";
  const next: FieldProvenance = {
    ...p,
    value: action.kind === "override" ? action.value : p.value,
    verificationState: isAtLeastAsTrusted(p.verificationState, nextState) && action.kind === "confirm"
      ? p.verificationState // already entered (higher) -> a confirm keeps the higher entered state
      : nextState,
    verifiedBy: action.by,
    verifiedAt: action.at,
  };
  // When a human re-enters, the figure is now THEIR figure. If they recorded where
  // the authoritative value came from, that origin replaces the old scraped source;
  // otherwise we keep the prior source (or mark it as hand-entered).
  if (action.kind === "override") {
    next.asOf = action.asOf ?? action.at;
    if (action.source !== undefined) {
      next.source = action.source && action.source.trim() !== "" ? action.source.trim() : "Entered by you";
      next.sourceUrl = action.sourceUrl && action.sourceUrl.trim() !== "" ? action.sourceUrl.trim() : null;
    } else {
      next.source = p.source ?? "Entered by you";
    }
  }
  return next;
}

/**
 * Merge a freshly scraped figure over an existing one WITHOUT lowering trust. If a
 * human has already verified/entered the figure, the scrape does not overwrite the
 * value or the human state; it only refreshes `fetchedAt` (so we know we looked) and
 * records the newly-seen scraped value/source in shadow fields is intentionally NOT
 * done here to keep the human's value authoritative. For an unverified figure, the
 * scrape replaces it.
 */
export function mergeScrape(existing: FieldProvenance | undefined, scraped: FieldProvenance): FieldProvenance {
  if (!existing) return scraped;
  if (isHumanChecked(existing.verificationState)) {
    // Keep the human's value/state; just note we re-checked the source.
    return { ...existing, fetchedAt: scraped.fetchedAt ?? existing.fetchedAt };
  }
  // Part 8: a deterministic scrape is MORE trusted than an AI extraction, so it is
  // allowed to overwrite an ai_extracted figure (raising it to scraped_unverified).
  // This is intentional and the ONE direction in which an AI value can be replaced
  // without a human: a known parser beats a possible hallucination. Human values are
  // already protected above; the scrape never reaches them.
  return scraped;
}

/**
 * Part 8 — the AI counterpart of {@link mergeScrape}. Merge a freshly AI-extracted
 * figure over an existing one WITHOUT EVER lowering OR overwriting more-trusted data.
 * Because `ai_extracted` is the lowest stored trust of all, an AI value may only be
 * written onto an EMPTY slot. If anything is already there — a human value, a
 * deterministic scrape, or even a prior AI extraction — the AI value is NOT applied
 * to the stored figure; the caller routes the disagreement to the conflicts surface
 * instead. This is what makes AI structurally unable to clobber or become the source
 * of record: it can fill a blank, never overwrite.
 */
export function mergeAiExtraction(
  existing: FieldProvenance | undefined,
  ai: FieldProvenance,
): FieldProvenance {
  if (!existing || existing.value == null) return ai;
  // Something more trusted is already present — keep it untouched.
  return existing;
}

/** Count how many figures in a map a human has actually checked. */
export function humanCheckedCount(map: FieldProvenanceMap): number {
  return Object.values(map).filter((p): p is FieldProvenance => !!p && isHumanChecked(p.verificationState)).length;
}

/** Total figures present in a map. */
export function figureCount(map: FieldProvenanceMap): number {
  return Object.values(map).filter((p) => !!p).length;
}

/** Short human label for a verification state (for badges, first-person/maintainer view). */
export function stateLabel(s: VerificationState): string {
  switch (s) {
    case "human_verified":
      return "Verified by you";
    case "human_entered":
      return "Entered by you";
    case "stale":
      return "May be stale";
    case "ai_extracted":
      return "AI-extracted · unverified — confirm against source";
    case "scraped_unverified":
    default:
      return "Unverified";
  }
}

/**
 * Viewer-neutral label for the END-USER view. A reader of the catalog wants to
 * know whether a *person* has checked a figure (not whether *they themselves*
 * did), so this phrases it impersonally. Use this on public-facing Explore/Detail
 * markers; use `stateLabel` only where the current user is the actor.
 */
export function viewerStateLabel(s: VerificationState): string {
  switch (s) {
    case "human_verified":
      return "Verified";
    case "human_entered":
      return "Maintainer-entered";
    case "stale":
      return "May be stale";
    case "ai_extracted":
      return "AI-extracted · unverified — confirm against source";
    case "scraped_unverified":
    default:
      return "Unverified scrape";
  }
}

/**
 * Round-level summary state of an instrument from its per-figure map: the highest
 * human attention any figure has received, else scraped_unverified. Used to keep
 * the row-level `verificationState` column in sync for cheap list-level badges.
 * Pure projection — does not consider staleness (staleness is a display concern).
 */
export function summariseState(map: FieldProvenanceMap): VerificationState {
  const present = Object.values(map).filter((p): p is FieldProvenance => !!p);
  if (present.length === 0) return "scraped_unverified";
  // The row badge reflects the LEAST-trusted figure on the instrument, so a single
  // unconfirmed AI figure makes the whole row read as provisional (you can't trust the
  // row more than its weakest number). This keeps ai_extracted visible at list level.
  let worst: VerificationState = present[0].verificationState;
  for (const p of present) {
    if (trustRank(p.verificationState) < trustRank(worst)) worst = p.verificationState;
  }
  return worst;
}

/**
 * The shape of an instrument's figure inputs the seed/ingestion hands us. Each
 * value is the raw figure as stored on the row (string|Date|null); the builder
 * only creates a provenance entry for figures that are actually present.
 */
export interface SeedFigureInputs {
  price?: string | null;
  yield?: string | null;
  coupon?: string | null;
  tenor?: string | null;
  maturity?: Date | string | null;
  distribution?: string | null;
  fx?: string | null;
  expense?: string | null;
  trailingReturn?: string | null;
}

/** Normalise a Date|string|number|null into an epoch-ms value or null. */
export function toEpochMs(v: Date | string | number | null | undefined): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * Build a per-figure provenance map from an instrument's row-level source/asOf and
 * its individual figures. Every present figure becomes its OWN scraped_unverified
 * FieldProvenance entry that inherits the row's source/asOf/url as the per-figure
 * source/asOf/url. This is the Part 7.1 backfill: it promotes the existing
 * one-source-per-row model into one-source-per-figure without changing any number.
 */
export function buildSeedProvenance(args: {
  figures: SeedFigureInputs;
  source: string | null;
  sourceUrl?: string | null;
  asOf: Date | string | number | null;
  fetchedAt?: Date | string | number | null;
}): FieldProvenanceMap {
  const asOf = toEpochMs(args.asOf);
  const fetchedAt = toEpochMs(args.fetchedAt) ?? asOf;
  const mk = (value: string | null): FieldProvenance =>
    scrapedField({ value, source: args.source, sourceUrl: args.sourceUrl ?? null, asOf, fetchedAt });

  const map: FieldProvenanceMap = {};
  const f = args.figures;
  if (f.price != null) map.price = mk(f.price);
  if (f.yield != null) map.yield = mk(f.yield);
  if (f.coupon != null) map.coupon = mk(f.coupon);
  if (f.tenor != null) map.tenor = mk(f.tenor);
  if (f.maturity != null) {
    const m = toEpochMs(f.maturity);
    map.maturity = mk(m != null ? new Date(m).toISOString() : null);
  }
  if (f.distribution != null) map.distribution = mk(f.distribution);
  if (f.fx != null) map.fx = mk(f.fx);
  if (f.expense != null) map.expense = mk(f.expense);
  if (f.trailingReturn != null) map.trailingReturn = mk(f.trailingReturn);
  return map;
}

/**
 * Part 7.2 — a detected disagreement between a fresh scrape and a figure a human
 * has already verified/entered. The runner records these for review; it NEVER
 * applies them, so the human's value stays authoritative.
 */
export interface FigureConflict {
  field: FieldKey;
  /** The value the human vouched for (kept). */
  humanValue: string | null;
  /** The human state that protects it (human_verified | human_entered). */
  humanState: VerificationState;
  /** The newly scraped value that disagrees (NOT applied). */
  scrapedValue: string | null;
  /** Where the disagreeing scrape came from. */
  scrapedSource: string | null;
  /** When the scrape was as-of, epoch ms. */
  scrapedAsOf: number | null;
}

export interface ReconcileResult {
  /** The map to persist: scrapes applied only where no human had checked the figure. */
  merged: FieldProvenanceMap;
  /** Figures where a scrape disagreed with a human value (flagged, not applied). */
  conflicts: FigureConflict[];
  /** Whether anything actually changed (so the runner can skip a no-op write). */
  changed: boolean;
}

/** Normalise two figure values for equality (trim + numeric tolerance). */
function valuesAgree(a: string | null, b: string | null): boolean {
  if (a == null || b == null) return a === b;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return a.trim() === b.trim();
}

/**
 * Reconcile a freshly scraped per-figure map against the stored one. This is the
 * heart of the "never clobber a human" rule, made pure and testable:
 *
 *  - For a figure no human has checked: the scrape is applied (via mergeScrape).
 *  - For a human_verified / human_entered figure: the human's value/state are kept.
 *    If the scrape AGREES, we only refresh fetchedAt (we re-checked the source). If
 *    the scrape DISAGREES, we keep the human value AND record a FigureConflict for
 *    review — the number is never silently overwritten.
 *  - Figures present in the stored map but absent from the scrape are left as-is.
 */
export function reconcileScrape(
  existing: FieldProvenanceMap,
  scraped: FieldProvenanceMap,
): ReconcileResult {
  const merged: FieldProvenanceMap = { ...existing };
  const conflicts: FigureConflict[] = [];
  let changed = false;

  for (const key of Object.keys(scraped) as FieldKey[]) {
    const fresh = scraped[key];
    if (!fresh) continue;
    const prior = existing[key];

    if (prior && isHumanChecked(prior.verificationState)) {
      if (valuesAgree(prior.value, fresh.value)) {
        // Agreement: just note we re-checked (refresh fetchedAt) — never downgrade.
        const next = { ...prior, fetchedAt: fresh.fetchedAt ?? prior.fetchedAt };
        if (next.fetchedAt !== prior.fetchedAt) changed = true;
        merged[key] = next;
      } else {
        // Disagreement with a human value: keep the human's, flag a conflict.
        merged[key] = { ...prior, fetchedAt: fresh.fetchedAt ?? prior.fetchedAt };
        if (merged[key]!.fetchedAt !== prior.fetchedAt) changed = true;
        conflicts.push({
          field: key,
          humanValue: prior.value,
          humanState: prior.verificationState,
          scrapedValue: fresh.value,
          scrapedSource: fresh.source,
          scrapedAsOf: fresh.asOf,
        });
      }
    } else {
      // No human attention yet: the scrape is authoritative.
      const next = mergeScrape(prior, fresh);
      if (!prior || !valuesAgree(prior.value, next.value) || prior.asOf !== next.asOf || prior.fetchedAt !== next.fetchedAt) {
        changed = true;
      }
      merged[key] = next;
    }
  }

  return { merged, conflicts, changed };
}

/**
 * Part 7.5 — per-asset-type staleness thresholds.
 *
 * A scraped figure goes "stale" at a cadence that matches how often its source
 * actually refreshes. A market-priced instrument (equity / REIT / offshore fund)
 * is meant to be daily, so it goes stale quickly; bonds, bills, MMF and bank
 * deposits move on a weekly/auction cadence, so a week-old figure is still fresh.
 * These mirror the ingestion cadence in `shared/ingestion.ts` (equities daily,
 * bonds/MMF weekly/per-auction) so display and pull policy never drift.
 *
 * The keys are the AssetClass strings from `shared/assetModel.ts`; we accept a
 * plain string (the row column is a string) and fall back to the generic
 * `STALE_AFTER_DAYS` for anything unknown, so this never throws on a new class.
 */
export const STALE_AFTER_DAYS_BY_CLASS: Record<string, number> = {
  equity: 3, // listed shares — daily close; allow a long weekend before "stale"
  reit: 3, // listed property fund — daily close
  offshore_fund: 4, // offshore close + FX; allow a small settlement/holiday buffer
  cash_mmf: 8, // MMF yields are published ~weekly
  bank_deposit: 35, // deposit rate cards change rarely (monthly-ish)
  gov_discount: 8, // T-bill auctions are weekly
  gov_coupon: 35, // bond coupons/levels move per-auction (monthly-ish)
  alt: STALE_AFTER_DAYS,
};

/** The stale threshold (in days) for a given asset class, with a safe default. */
export function staleDaysForClass(assetClass: string | null | undefined): number {
  if (!assetClass) return STALE_AFTER_DAYS;
  return STALE_AFTER_DAYS_BY_CLASS[assetClass] ?? STALE_AFTER_DAYS;
}

/**
 * Class-aware variant of {@link effectiveState}. A human-checked figure keeps its
 * human state regardless of age. An unchecked scraped figure becomes `stale` once
 * its as-of date is older than the per-class threshold. Pure projection — never
 * mutates stored state. When `assetClass` is omitted this matches `effectiveState`.
 */
export function effectiveStateForClass(
  p: FieldProvenance,
  nowMs: number,
  assetClass: string | null | undefined,
): VerificationState {
  if (isHumanChecked(p.verificationState)) return p.verificationState;
  // AI-extracted figures never auto-promote with age (see effectiveState).
  if (p.verificationState === "ai_extracted") return "ai_extracted";
  const asOf = p.asOf;
  if (asOf === null) return p.verificationState;
  const ageDays = (nowMs - asOf) / (1000 * 60 * 60 * 24);
  if (ageDays >= staleDaysForClass(assetClass)) return "stale";
  return p.verificationState;
}

/** Whole-number age in days of a figure's as-of date, or null when unknown. */
export function figureAgeDays(p: FieldProvenance, nowMs: number): number | null {
  if (p.asOf === null) return null;
  return Math.floor((nowMs - p.asOf) / (1000 * 60 * 60 * 24));
}

/**
 * Part 7.5 — the non-blocking "verify before relying on it" prompt model used at
 * the Model-in-my-plan step. Given the figures that actually drive a modeled
 * holding (price for price-driven assets, the income/yield figure otherwise), it
 * reports whether ANY of them is stale or not-yet-human-verified, and a quiet
 * sentence the UI can show. It NEVER blocks: `shouldPrompt` is advisory only.
 *
 * This reuses the same provenance + class-threshold logic as the badges, so the
 * prompt and the per-figure markers can never disagree.
 */
export interface ModelFreshnessPrompt {
  shouldPrompt: boolean;
  /** The driving figures that triggered the prompt (for precise copy). */
  flagged: Array<{
    field: FieldKey;
    state: VerificationState;
    ageDays: number | null;
  }>;
  /** A single quiet sentence, or null when every driving figure is fine. */
  message: string | null;
}

export function modelFreshnessPrompt(args: {
  map: FieldProvenanceMap | null | undefined;
  assetClass: string | null | undefined;
  /** Which figures drive this holding's model (defaults to price + yield). */
  drivingFields?: FieldKey[];
  nowMs: number;
}): ModelFreshnessPrompt {
  const map = args.map ?? {};
  const driving = args.drivingFields ?? (["price", "yield", "distribution", "coupon"] as FieldKey[]);
  const flagged: ModelFreshnessPrompt["flagged"] = [];

  for (const field of driving) {
    const p = map[field];
    if (!p) continue;
    const state = effectiveStateForClass(p, args.nowMs, args.assetClass);
    if (state === "stale" || state === "scraped_unverified" || state === "ai_extracted") {
      flagged.push({ field, state, ageDays: figureAgeDays(p, args.nowMs) });
    }
  }

  if (flagged.length === 0) {
    return { shouldPrompt: false, flagged: [], message: null };
  }

  // Build one quiet sentence. Strongest caution first: an AI-extracted figure is the
  // most urgent to confirm (a model may have hallucinated it), then stale, then a raw
  // deterministic scrape.
  const ai = flagged.find((f) => f.state === "ai_extracted");
  if (ai) {
    return {
      shouldPrompt: true,
      flagged,
      message:
        "This figure was pulled from a document by AI and no one has checked it — it may be wrong. Confirm it against the cited source before relying on this model.",
    };
  }
  const stale = flagged.find((f) => f.state === "stale");
  if (stale) {
    const age = stale.ageDays != null ? `${stale.ageDays} day${stale.ageDays !== 1 ? "s" : ""} old` : "old";
    return {
      shouldPrompt: true,
      flagged,
      message: `This figure is about ${age} and no one has checked it recently — confirm or update it before relying on this model.`,
    };
  }
  return {
    shouldPrompt: true,
    flagged,
    message: "This figure is a raw scrape that no one has verified yet — confirm or update it before relying on this model.",
  };
}
