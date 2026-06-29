/**
 * Allocation Model — Part 1 of 4: risk tiers, target allocation templates, and
 * the horizon → tier suggestion engine.
 *
 * WHAT THIS IS
 *   The foundation layer for a future "suggested mix" feature. It defines five
 *   ordered risk TIERS, a target ALLOCATION TEMPLATE per tier across the
 *   behavior-class buckets the system already has, a validator that keeps every
 *   template honest (sums to 100, keeps an operational cash floor), and a pure
 *   `suggestTier()` that maps a goal's horizon (and optional nature) to a tier
 *   WITH a plain-language reason.
 *
 * WHAT THIS IS NOT (invariants — not preferences)
 *   - No tier is ever "best" or "recommended". The tiers are points on a
 *     spectrum; the engine SUGGESTS and always lets the user override.
 *   - A suggestion is never a locked choice. Overriding to any tier — even one
 *     that conflicts with the horizon — is always allowed; the conflict is
 *     FLAGGED for the UI to show a consequence later (Part 3), never blocked.
 *   - This module holds ALLOCATION WEIGHTS ONLY (percentages). It embeds no
 *     expected-return, volatility, correlation, or rate numbers. Everything the
 *     downstream parts need for return/risk resolves from `riskModel.ts` (which
 *     in turn draws on the sourced rate/ingestion layer), so the daily/weekly
 *     rate updates flow straight through without a second source of truth.
 *
 * Framework-free + deterministic so it imports cleanly on both client and
 * server and is trivially unit-testable.
 */

import type { AssetClass } from "./assetModel";
import { type RiskTolerance, RISK_TOLERANCES } from "./riskModel";

/* ───────────────────────────── Risk tiers ────────────────────────────── */

/**
 * The five ordered risk tiers, lowest → highest risk. These are intentionally
 * the SAME identifiers as `RiskTolerance` in riskModel.ts — a tier and a stated
 * risk-comfort band are the same spectrum, so we ALIAS rather than duplicate the
 * type. Aligning the names keeps one vocabulary across the risk and allocation
 * models.
 */
export type AllocationTier = RiskTolerance;

/**
 * Tiers in ascending risk order. Re-exports the riskModel ordering so the two
 * models can never drift apart. Index in this array == risk rank (0 = safest).
 */
export const ALLOCATION_TIERS: readonly AllocationTier[] = RISK_TOLERANCES;

/** A tier's plain-language identity — a label and a one-line description. */
export interface AllocationTierSpec {
  tier: AllocationTier;
  label: string;
  /** One-line, plain-language description. Never says "best" or "recommended". */
  description: string;
}

/**
 * Human labels + one-liners for each tier. Deliberately neutral: each line
 * describes the trade-off, none is framed as the right answer.
 */
export const ALLOCATION_TIER_SPECS: Record<AllocationTier, AllocationTierSpec> = {
  capital_preservation: {
    tier: "capital_preservation",
    label: "Capital Preservation",
    description: "Protect what you have; minimal swings, mostly cash and held-to-maturity government paper.",
  },
  conservative: {
    tier: "conservative",
    label: "Conservative",
    description: "Mostly fixed income with a small growth sleeve; small swings in exchange for a little more return.",
  },
  balanced: {
    tier: "balanced",
    label: "Balanced",
    description: "A middle mix of fixed income and growth assets; moderate swings for moderate expected return.",
  },
  growth: {
    tier: "growth",
    label: "Growth",
    description: "Tilted toward equities and offshore; larger swings accepted for higher expected long-run return.",
  },
  aggressive: {
    tier: "aggressive",
    label: "Aggressive",
    description: "Mostly equities and offshore; large swings are expected in pursuit of the highest long-run return.",
  },
};

/** The risk rank of a tier (0 = safest, 4 = riskiest). */
export function tierRank(tier: AllocationTier): number {
  return ALLOCATION_TIERS.indexOf(tier);
}

/** Read the spec for a tier (single lookup the UI/engine use). */
export function tierSpec(tier: AllocationTier): AllocationTierSpec {
  return ALLOCATION_TIER_SPECS[tier];
}

/* ───────────────────────── Allocation buckets ────────────────────────── */

/**
 * The behavior-class BUCKETS a template allocates across. These group the
 * existing `AssetClass` set (assetModel.ts) into the five families a target mix
 * is expressed over. The grouping is the ONLY place the 8 classes collapse to 5
 * buckets, so any future class change has a single touch point.
 *
 *   cash     → cash_mmf, bank_deposit (operational / near-cash)
 *   gov      → gov_discount + gov_coupon (government fixed income)
 *   equity   → equity (local listed shares / equity funds)
 *   reit     → reit (property funds)
 *   offshore → offshore_fund (global / FX-exposed funds)
 *
 * `alt` is intentionally NOT part of any template target (it is a reserved,
 * user-classified bucket); it maps to no allocation bucket and is excluded from
 * the target mix until a later part decides how to treat alternatives.
 */
export type AllocationBucket = "cash" | "gov" | "equity" | "reit" | "offshore";

export const ALLOCATION_BUCKETS: readonly AllocationBucket[] = [
  "cash",
  "gov",
  "equity",
  "reit",
  "offshore",
] as const;

/** Plain labels for chrome. */
export const ALLOCATION_BUCKET_LABELS: Record<AllocationBucket, string> = {
  cash: "Cash & MMF",
  gov: "Government fixed income",
  equity: "Equity",
  reit: "REIT / property",
  offshore: "Offshore funds",
};

/**
 * The single grouping from a behavior class to its allocation bucket. Returns
 * null for classes that are not part of the target mix (currently `alt`), so a
 * caller summing a live portfolio against a template can exclude them cleanly.
 */
export function bucketForClass(assetClass: AssetClass): AllocationBucket | null {
  switch (assetClass) {
    case "cash_mmf":
    case "bank_deposit":
      return "cash";
    case "gov_discount":
    case "gov_coupon":
      return "gov";
    case "equity":
      return "equity";
    case "reit":
      return "reit";
    case "offshore_fund":
      return "offshore";
    case "alt":
      return null;
    default:
      return null;
  }
}

/* ─────────────────────── Target allocation templates ─────────────────── */

/** A target mix over the five buckets, as whole-number percentages. */
export type AllocationWeights = Record<AllocationBucket, number>;

/**
 * A stored, editable allocation template for one tier. Modeled on the editable
 * rate/benchmark settings pattern: the WEIGHTS are the data, and provenance
 * (source, as-of, last-edited, notes) travels alongside so an edit is
 * defensible. The numbers here are illustrative STARTING points — all editable.
 */
export interface AllocationTemplate {
  tier: AllocationTier;
  weights: AllocationWeights;
  /** Where this template came from (default seed, a methodology note, a URL). */
  source?: string | null;
  /** "As of" / last-reviewed date (YYYY-MM-DD), provenance only. */
  asOf?: string | null;
  /** Free-text rationale or edit note. */
  notes?: string | null;
  /** Unix-ms of the last edit (UTC). Null for an un-edited default. */
  updatedAt?: number | null;
}

/** Minimum cash buffer every template must keep (operational liquidity). */
export const MIN_CASH_FLOOR_PCT = 5;

/** Templates must sum to exactly this. */
export const TEMPLATE_SUM_PCT = 100;

/**
 * The DEFAULT starting templates (illustrative, all editable). Stored as data
 * (seeded into the allocation_templates table), never used as code constants by
 * downstream logic — callers read the stored/edited template, falling back to
 * these only to seed. Each sums to 100 and keeps cash ≥ MIN_CASH_FLOOR_PCT.
 */
export const DEFAULT_ALLOCATION_TEMPLATES: Record<AllocationTier, AllocationWeights> = {
  capital_preservation: { cash: 40, gov: 60, equity: 0, reit: 0, offshore: 0 },
  conservative: { cash: 20, gov: 60, equity: 12, reit: 3, offshore: 5 },
  balanced: { cash: 10, gov: 45, equity: 28, reit: 7, offshore: 10 },
  growth: { cash: 5, gov: 25, equity: 45, reit: 10, offshore: 15 },
  aggressive: { cash: 5, gov: 10, equity: 55, reit: 10, offshore: 20 },
};

/** Build the default template (with seed provenance) for a tier. */
export function defaultTemplateFor(tier: AllocationTier): AllocationTemplate {
  return {
    tier,
    weights: { ...DEFAULT_ALLOCATION_TEMPLATES[tier] },
    source: "Default starting template (illustrative; editable)",
    asOf: null,
    notes: null,
    updatedAt: null,
  };
}

/* ─────────────────────────── Template validation ─────────────────────── */

export interface TemplateValidation {
  ok: boolean;
  /** The summed weight (for messaging). */
  total: number;
  /** Specific failure reasons (empty when ok). */
  errors: string[];
}

/**
 * Validate a candidate set of weights. A template is valid IFF:
 *   - every bucket weight is a finite number in [0, 100];
 *   - the weights sum to exactly 100 (TEMPLATE_SUM_PCT);
 *   - cash is at least the operational floor (MIN_CASH_FLOOR_PCT).
 * Returns all failing reasons so the editor can show them at once. This is the
 * single guard the save path MUST call before persisting a template.
 */
export function validateAllocationWeights(
  weights: Partial<AllocationWeights> | null | undefined,
): TemplateValidation {
  const errors: string[] = [];
  const w = weights ?? {};

  // Each bucket must be a finite number within [0, 100].
  let total = 0;
  for (const b of ALLOCATION_BUCKETS) {
    const raw = (w as Record<string, unknown>)[b];
    const n = Number(raw);
    if (raw == null || !Number.isFinite(n)) {
      errors.push(`${ALLOCATION_BUCKET_LABELS[b]} weight is missing or not a number.`);
      continue;
    }
    if (n < 0 || n > 100) {
      errors.push(`${ALLOCATION_BUCKET_LABELS[b]} weight must be between 0 and 100 (got ${n}).`);
    }
    total += n;
  }

  // The total must be exactly 100. Use a tiny epsilon so 100.0000001 from float
  // arithmetic still passes, but 99 / 101 do not.
  if (Math.abs(total - TEMPLATE_SUM_PCT) > 1e-6) {
    errors.push(`Weights must sum to ${TEMPLATE_SUM_PCT}% (currently ${round2(total)}%).`);
  }

  // Cash floor — never let the operational buffer hit zero.
  const cash = Number((w as Record<string, unknown>).cash);
  if (Number.isFinite(cash) && cash < MIN_CASH_FLOOR_PCT) {
    errors.push(
      `Cash must stay at or above the ${MIN_CASH_FLOOR_PCT}% operational floor (got ${cash}%).`,
    );
  }

  return { ok: errors.length === 0, total: round2(total), errors };
}

/** Convenience: validate a whole template (its weights). */
export function validateAllocationTemplate(template: AllocationTemplate): TemplateValidation {
  return validateAllocationWeights(template.weights);
}

/* ─────────────────────── Tier suggestion from horizon ─────────────────── */

/**
 * The optional nature of a goal, a modifier on the horizon-based suggestion.
 *   - critical:     can't-fail (medical, a committed deposit) → shift one tier SAFER.
 *   - standard:     ordinary goal → no shift.
 *   - aspirational: optional upside → NO automatic riskier shift (the user may
 *                   override up themselves; we never auto-increase risk).
 */
export type GoalNature = "critical" | "standard" | "aspirational";

export const GOAL_NATURES: readonly GoalNature[] = ["critical", "standard", "aspirational"] as const;

/**
 * Horizon bands (a starting heuristic, editable). Each band names the tier a
 * goal of that horizon lands in BEFORE any goalNature modifier. Expressed as an
 * ordered list of upper bounds in months; the first band whose `maxMonths` the
 * horizon is strictly less than wins, else the final (open-ended) tier.
 *
 *   < 24 months  → capital_preservation
 *   24–48        → conservative
 *   48–84        → balanced
 *   84–144       → growth
 *   > 144        → aggressive
 */
export interface HorizonBand {
  /** Exclusive upper bound in months; null = open-ended (the top band). */
  maxMonths: number | null;
  tier: AllocationTier;
}

export const HORIZON_BANDS: readonly HorizonBand[] = [
  { maxMonths: 24, tier: "capital_preservation" },
  { maxMonths: 48, tier: "conservative" },
  { maxMonths: 84, tier: "balanced" },
  { maxMonths: 144, tier: "growth" },
  { maxMonths: null, tier: "aggressive" },
] as const;

/** The tier a horizon lands in from the bands alone (no nature modifier). */
export function tierForHorizon(horizonMonths: number): AllocationTier {
  const h = Math.max(0, Number(horizonMonths) || 0);
  for (const band of HORIZON_BANDS) {
    if (band.maxMonths == null) return band.tier;
    if (h < band.maxMonths) return band.tier;
  }
  // Unreachable (the last band is open-ended), but keep a safe fallback.
  return "aggressive";
}

/** Shift a tier by `steps` and clamp to the [safest, riskiest] range. */
export function shiftTier(tier: AllocationTier, steps: number): AllocationTier {
  const idx = tierRank(tier);
  const next = Math.min(ALLOCATION_TIERS.length - 1, Math.max(0, idx + steps));
  return ALLOCATION_TIERS[next];
}

export interface TierSuggestion {
  /** The suggested tier (post-nature-modifier, clamped to range). */
  tier: AllocationTier;
  /** The tier the horizon bands alone produced (pre-modifier), for transparency. */
  baseTier: AllocationTier;
  /** Whether goalNature shifted the suggestion (and in which direction). */
  shiftedBy: number;
  /** Plain-language reasoning shown beside the suggestion. Never a locked choice. */
  reason: string;
}

/**
 * Suggest a tier from a goal's horizon and (optional) nature. PURE and
 * deterministic; returns a suggestion plus a plain-language reason — never a
 * forced or locked choice. The caller stores it as `suggestedTier` and lets the
 * user override (see `resolveTierSelection`).
 *
 *   1. Map horizon → base tier via the editable HORIZON_BANDS.
 *   2. Apply the goalNature modifier:
 *        critical     → one tier safer (clamped),
 *        standard     → unchanged,
 *        aspirational → unchanged (we never auto-shift riskier).
 */
export function suggestTier(
  horizonMonths: number,
  goalNature: GoalNature = "standard",
): TierSuggestion {
  const h = Math.max(0, Number(horizonMonths) || 0);
  const baseTier = tierForHorizon(h);

  const steps = goalNature === "critical" ? -1 : 0;
  const tier = shiftTier(baseTier, steps);
  const shiftedBy = tierRank(tier) - tierRank(baseTier);

  const years = h / 12;
  const horizonPhrase =
    years < 2
      ? "under 2 years away"
      : `~${years % 1 === 0 ? years : years.toFixed(1)} years out`;

  let reason: string;
  if (shiftedBy < 0) {
    reason =
      `Suggested ${ALLOCATION_TIER_SPECS[tier].label} — your goal is ${horizonPhrase}, ` +
      `and because it is critical (can't-fail) we nudged one tier safer than the horizon alone implies. ` +
      `You can override this.`;
  } else if (baseTier === "capital_preservation") {
    reason =
      `Suggested ${ALLOCATION_TIER_SPECS[tier].label} — your goal is ${horizonPhrase}, ` +
      `too soon to ride out market swings, so the mix stays in cash and held-to-maturity paper. ` +
      `You can override this.`;
  } else if (baseTier === "aggressive") {
    reason =
      `Suggested ${ALLOCATION_TIER_SPECS[tier].label} — your goal is ${horizonPhrase}, ` +
      `a long runway that can absorb larger swings for higher expected return. You can override this.`;
  } else {
    reason =
      `Suggested ${ALLOCATION_TIER_SPECS[tier].label} — your goal is ${horizonPhrase}, ` +
      `enough time to ride out some market swings. You can override this.`;
  }

  return { tier, baseTier, shiftedBy, reason };
}

/* ───────────────── Per-goal tier selection (suggested vs chosen) ──────── */

/**
 * The per-goal/portfolio tier-selection state. Stored on the goal row:
 *   - suggestedTier: the computed suggestion (from suggestTier).
 *   - selectedTier:  the user's choice; defaults to the suggestion.
 *   - userOverrode:  true once the user picks anything other than the suggestion.
 * Overriding to ANY tier is always allowed and never blocked.
 */
export interface TierSelection {
  suggestedTier: AllocationTier;
  selectedTier: AllocationTier;
  userOverrode: boolean;
  /**
   * True when the selected tier conflicts with the horizon (i.e. is riskier than
   * the horizon-band suggestion). This is a FLAG for the UI to show a
   * consequence (Part 3), never a block. False when the user picked the
   * suggestion or chose something safer.
   */
  conflictsWithHorizon: boolean;
}

/**
 * Resolve the stored selection state from a suggestion and the user's (possibly
 * null) chosen tier. When the user has chosen nothing, the selection defaults to
 * the suggested tier and `userOverrode` is false. When they have chosen a tier,
 * `userOverrode` reflects whether it differs from the suggestion, and
 * `conflictsWithHorizon` is true only when the choice is RISKIER than the
 * horizon band's base tier — the case the UI should warn about. Choosing
 * something safer never conflicts.
 */
export function resolveTierSelection(opts: {
  /** The horizon-derived suggestion (already includes any critical shift). */
  suggestion: TierSuggestion;
  /** The user's stored choice, or null/undefined when they have not chosen. */
  selected?: AllocationTier | null;
}): TierSelection {
  const suggestedTier = opts.suggestion.tier;
  const chosen =
    opts.selected != null && (ALLOCATION_TIERS as readonly string[]).includes(opts.selected)
      ? (opts.selected as AllocationTier)
      : null;
  const selectedTier = chosen ?? suggestedTier;
  const userOverrode = chosen != null && chosen !== suggestedTier;

  // Conflict is measured against the horizon BASE tier (what the horizon alone
  // implies), so a critical-shifted suggestion does not make a horizon-matching
  // choice look like a conflict. Riskier-than-horizon = conflict.
  const conflictsWithHorizon = tierRank(selectedTier) > tierRank(opts.suggestion.baseTier);

  return { suggestedTier, selectedTier, userOverrode, conflictsWithHorizon };
}

/* ─────────────────────────────── helpers ─────────────────────────────── */

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
