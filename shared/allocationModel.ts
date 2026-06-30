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
import {
  type RiskTolerance,
  RISK_TOLERANCES,
  type RiskAssumption,
  type EndValueDistribution,
  type GoalProbability,
  buildEndValueDistribution,
  endValueFromParams,
  goalProbability,
  resolveRiskAssumption,
  PROBABILITY_FLOOR,
  PROBABILITY_CEIL,
} from "./riskModel";

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

/* ══════════════════════════════════════════════════════════════════════════
 * Allocation Model — Part 2 of 4: the GLIDE PATH (tier-aware convex de-risking)
 *
 * WHAT THIS IS
 *   A goal's target mix is not static. The glide moves it from the selected
 *   tier's STARTING template (Part 1) toward the Capital-Preservation END anchor
 *   as the goal date approaches, so risk is retired automatically as the time to
 *   recover from a loss shrinks. Every goal ends liquid and safe by its date,
 *   regardless of how aggressively it began.
 *
 * THE CURVE IS CONVEX, NOT LINEAR (the financial heart of it)
 *   A linear glide retires risk evenly, but the cost of a drawdown rises sharply
 *   as the goal nears: a 20% equity fall four years out is recoverable; the same
 *   fall four months out is not. So the interpolation is weighted by a CONVEX
 *   easing of the time-remaining fraction — the mix stays near the tier's growth
 *   posture through the early-and-middle journey, then converges quickly toward
 *   cash in the final stretch. The steepness is an EDITABLE assumption (see
 *   DEFAULT_GLIDE_PARAMS.steepness), not a magic constant.
 *
 * ONE CURVE, NOT TWO SYSTEMS
 *   The engine's Foundation → Growth → De-risking → Final phases are reframed as
 *   labeled REGIONS of this same curve (thresholds on time-remaining), not a
 *   separate mechanism. A Capital-Preservation goal's glide is nearly flat (it
 *   started safe); an Aggressive long-horizon goal's glide is dramatic — same
 *   curve function, different start anchor. The deterministic car-plan engine
 *   keeps its own discrete four-bucket phase table as its source of truth; this
 *   module REPRODUCES that table through the generalized curve (see
 *   `engineBucketsForPhase`) and is regression-locked against it, so the existing
 *   projection does not move.
 *
 * WEIGHTS + SHAPE ONLY
 *   As in Part 1, the glide owns only allocation WEIGHTS (Part 1 templates) and
 *   the curve-SHAPE parameters (steepness, phase thresholds) — all editable, all
 *   stored with provenance. No return / volatility / correlation / rate numbers
 *   live here; those resolve from riskModel / the sourced ingestion layer. The
 *   glide is a PLAN for managing risk over time, never a promise of a return.
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * Time-remaining fraction: 1.0 at the goal's START, 0.0 at the goal DATE. The
 * glide is a function of this (time-to-go), never a calendar date, so it behaves
 * identically for any horizon length.
 */
export type TimeRemainingFraction = number;

/**
 * The four phase labels, expressed as labeled regions of the one glide curve.
 * Identical strings to the engine's phases so the two never diverge.
 */
export type GlidePhase = "foundation" | "growth" | "de-risking" | "final-liquidity";

export const GLIDE_PHASES: readonly GlidePhase[] = [
  "foundation",
  "growth",
  "de-risking",
  "final-liquidity",
] as const;

/**
 * Editable curve-shape parameters. These are the ONLY numbers the glide owns
 * besides the Part 1 weight templates; they are stored with provenance and tuned
 * like any other assumption.
 */
export interface GlideParams {
  /**
   * Convexity exponent applied to the time-remaining fraction (> 1 ⇒ convex,
   * de-risking accelerates late). At 1.0 the glide is linear; the higher the
   * value, the longer the mix holds its growth posture before a steep late
   * descent toward cash.
   */
  steepness: number;
  /**
   * Phase-region thresholds on the ELAPSED fraction (1 − timeRemaining), in
   * ascending order. With elapsed e:
   *   e < foundationEnd        → foundation
   *   foundationEnd ≤ e < growthEnd     → growth
   *   growthEnd ≤ e < deRiskingEnd      → de-risking
   *   e ≥ deRiskingEnd                  → final-liquidity
   * Defaults mirror the engine's default phase fractions
   * (0.20 / +0.50 / +0.15 = 0.20, 0.70, 0.85) so the labels line up with the
   * existing car plan out of the box.
   */
  foundationEnd: number;
  growthEnd: number;
  deRiskingEnd: number;
}

/**
 * Default glide shape.
 *
 *   steepness = 2.0 — a quadratic ease. WHY CONVEX & WHY 2.0: a drawdown's cost
 *   rises roughly with how little time is left to recover, so risk should be
 *   shed faster as the date nears, not evenly. A quadratic keeps ~the tier's
 *   growth posture for the first ~half of the journey (at 50% elapsed the mix is
 *   only ~25% of the way to cash), then accelerates toward the safe anchor in
 *   the final stretch. It is a deliberately mild, explainable convexity — higher
 *   values de-risk even later/faster; 1.0 would be a plain linear glide.
 *
 *   phase thresholds = 0.20 / 0.70 / 0.85 — the engine's default phase fractions
 *   (foundation 0.20, growth 0.50, de-risking 0.15, final 0.15) as cumulative
 *   ELAPSED thresholds, so the glide's regions and the car plan's phases coincide.
 */
export const DEFAULT_GLIDE_PARAMS: GlideParams = {
  steepness: 2.0,
  foundationEnd: 0.20,
  growthEnd: 0.70,
  deRiskingEnd: 0.85,
};

/**
 * The END anchor every glide converges to: the Capital-Preservation tier's
 * template. Read from the (possibly edited) set of templates so an edit to the
 * CP template automatically moves every glide's destination — one source of
 * truth. Falls back to the default CP template.
 */
export function glideEndAnchor(
  templates?: Partial<Record<AllocationTier, AllocationWeights>>,
): AllocationWeights {
  const cp = templates?.capital_preservation;
  return cp ? { ...cp } : { ...DEFAULT_ALLOCATION_TEMPLATES.capital_preservation };
}

/** Clamp a number into [lo, hi]. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * The convex BLEND WEIGHT placed on the START anchor at a given time-remaining
 * fraction. At trf = 1 (start) it is 1 (all start anchor); at trf = 0 (goal
 * date) it is 0 (all end anchor). Convexity (steepness > 1) keeps this weight
 * HIGH for most of the journey then drops it quickly near the end:
 *
 *   startWeight(trf) = 1 − (1 − trf) ^ steepness
 *
 * Let elapsed = 1 − trf run 0 → 1 over the journey. Raising ELAPSED to a power
 * > 1 keeps elapsed^k small while elapsed is small (early/mid), so the start
 * weight stays near 1 — the mix holds its growth posture. As elapsed → 1 (the
 * final stretch) elapsed^k climbs steeply, so the start weight collapses and the
 * mix converges quickly toward the safe end anchor. This is the financial heart
 * of the glide: de-risking ACCELERATES late, because a late drawdown is the one
 * you cannot recover from. steepness = 1 reduces to a plain linear glide.
 */
export function glideStartWeight(
  timeRemainingFraction: TimeRemainingFraction,
  params: GlideParams = DEFAULT_GLIDE_PARAMS,
): number {
  const trf = clamp(Number(timeRemainingFraction) || 0, 0, 1);
  const k = Math.max(1, Number(params.steepness) || 1);
  const elapsed = 1 - trf;
  return 1 - Math.pow(elapsed, k);
}

/**
 * Re-normalise a raw blended mix back to a valid template: clamp negatives,
 * enforce the cash floor by topping cash up from the largest non-cash bucket if
 * needed, then rescale every bucket so the whole sums to exactly 100. Interpolating
 * two valid templates already sums to ~100 and respects the floor (both anchors
 * do), but float dust and the floor top-up are corrected here so EVERY point on
 * the glide re-validates.
 */
function normaliseToValidTemplate(raw: AllocationWeights): AllocationWeights {
  const out = {} as AllocationWeights;
  for (const b of ALLOCATION_BUCKETS) out[b] = Math.max(0, Number(raw[b]) || 0);

  // Enforce the cash floor by pulling from the largest non-cash bucket(s).
  if (out.cash < MIN_CASH_FLOOR_PCT) {
    let deficit = MIN_CASH_FLOOR_PCT - out.cash;
    const donors = ALLOCATION_BUCKETS.filter((b) => b !== "cash").sort(
      (a, b) => out[b] - out[a],
    );
    for (const d of donors) {
      if (deficit <= 0) break;
      const take = Math.min(out[d], deficit);
      out[d] -= take;
      out.cash += take;
      deficit -= take;
    }
  }

  // Rescale to sum to exactly 100.
  const total = ALLOCATION_BUCKETS.reduce((s, b) => s + out[b], 0);
  if (total > 0) {
    for (const b of ALLOCATION_BUCKETS) out[b] = (out[b] / total) * TEMPLATE_SUM_PCT;
  }
  return out;
}

/**
 * The glided target allocation for a tier at a given time-remaining fraction.
 *
 *   glidedAllocation(tier, trf) = blend( startAnchor=tierTemplate,
 *                                        endAnchor=capitalPreservation,
 *                                        w = trf ^ steepness )
 *
 * - At trf = 1 it equals the tier's start template; at trf = 0 it equals the
 *   Capital-Preservation end anchor.
 * - The result is re-normalised so it ALWAYS sums to 100 and honours the cash
 *   floor (the brief's re-validation requirement at every point).
 * - `templates` lets callers pass the stored/edited templates (so edits flow
 *   through); omitted ⇒ the Part 1 defaults.
 */
export function glidedAllocation(
  tier: AllocationTier,
  timeRemainingFraction: TimeRemainingFraction,
  params: GlideParams = DEFAULT_GLIDE_PARAMS,
  templates?: Partial<Record<AllocationTier, AllocationWeights>>,
): AllocationWeights {
  const start = templates?.[tier]
    ? { ...templates[tier]! }
    : { ...DEFAULT_ALLOCATION_TEMPLATES[tier] };
  const end = glideEndAnchor(templates);
  const w = glideStartWeight(timeRemainingFraction, params);

  const blended = {} as AllocationWeights;
  for (const b of ALLOCATION_BUCKETS) {
    blended[b] = start[b] * w + end[b] * (1 - w);
  }
  return normaliseToValidTemplate(blended);
}

/**
 * The phase LABEL for a point on the curve, by ELAPSED fraction (1 − trf), using
 * the editable thresholds. This is the single mapping that re-expresses the
 * engine's four phases as regions of the one glide.
 */
export function glidePhaseForElapsed(
  elapsedFraction: number,
  params: GlideParams = DEFAULT_GLIDE_PARAMS,
): GlidePhase {
  const e = clamp(Number(elapsedFraction) || 0, 0, 1);
  if (e < params.foundationEnd) return "foundation";
  if (e < params.growthEnd) return "growth";
  if (e < params.deRiskingEnd) return "de-risking";
  return "final-liquidity";
}

/** Same, but taking the time-remaining fraction directly (elapsed = 1 − trf). */
export function glidePhaseForTimeRemaining(
  timeRemainingFraction: TimeRemainingFraction,
  params: GlideParams = DEFAULT_GLIDE_PARAMS,
): GlidePhase {
  return glidePhaseForElapsed(1 - clamp(Number(timeRemainingFraction) || 0, 0, 1), params);
}

/* ───────── Bridge: reproduce the engine's discrete four-bucket plan ───────── */

/**
 * The four engine buckets the deterministic car-plan projects over. The glide's
 * five allocation buckets collapse onto these for the car plan, which holds no
 * equity/REIT/offshore: cash ≈ MMF, and the government sleeve (gov) is split
 * across T-bills / IFB / FXD by phase.
 */
export interface EngineBucketWeights {
  mmf: number;
  tbill: number;
  ifb: number;
  fxd: number;
}

/**
 * The engine's documented phase → four-bucket target table, reproduced here so
 * the generalized model can express the car plan's behavior as regions of the
 * curve WITHOUT the engine importing this module. This is the single fixture the
 * regression test pins against `engine.getPhaseAllocation`; if the engine's
 * table ever changes, the regression test fails loudly and this must be updated
 * in lock-step.
 *
 *   foundation:      MMF 50 / Tbill 50 / IFB  0 / FXD  0
 *   growth:          MMF 20 / Tbill 20 / IFB 45 / FXD 15
 *   de-risking:      MMF 25 / Tbill 35 / IFB 30 / FXD 10
 *   final-liquidity: MMF 40 / Tbill 45 / IFB 10 / FXD  5
 */
export const ENGINE_PHASE_BUCKETS: Record<GlidePhase, EngineBucketWeights> = {
  foundation: { mmf: 0.5, tbill: 0.5, ifb: 0.0, fxd: 0.0 },
  growth: { mmf: 0.2, tbill: 0.2, ifb: 0.45, fxd: 0.15 },
  "de-risking": { mmf: 0.25, tbill: 0.35, ifb: 0.3, fxd: 0.1 },
  "final-liquidity": { mmf: 0.4, tbill: 0.45, ifb: 0.1, fxd: 0.05 },
};

/**
 * The engine's four-bucket target for a phase. Short-horizon plans use MMF +
 * 91-day T-bills only — identical to the engine's own short-horizon rule — so
 * the generalized model reproduces that branch too.
 */
export function engineBucketsForPhase(
  phase: GlidePhase,
  isShortHorizon = false,
): EngineBucketWeights {
  if (isShortHorizon) return { mmf: 0.5, tbill: 0.5, ifb: 0, fxd: 0 };
  return { ...ENGINE_PHASE_BUCKETS[phase] };
}

/* ───────────────────────── Full-curve query (for display) ───────────────── */

/** One sampled point on the glide curve, for charting "how your mix shifts". */
export interface GlideSamplePoint {
  /** Elapsed fraction 0..1 (0 = start, 1 = goal date). */
  elapsedFraction: number;
  /** Time-remaining fraction 1..0. */
  timeRemainingFraction: TimeRemainingFraction;
  /** Whole month index when a horizon is supplied (else null). */
  monthIndex: number | null;
  /** The phase region this point falls in. */
  phase: GlidePhase;
  /** The glided five-bucket target at this point (sums to 100, cash floored). */
  weights: AllocationWeights;
}

/**
 * Sample the WHOLE glide curve from start (elapsed 0) to goal date (elapsed 1)
 * so the UI (Part 4) can show the entire de-risking path, not just today's
 * point — making the glide explainable as an intentional design, never drift.
 *
 * - When `horizonMonths` is provided, samples once per month (inclusive of both
 *   ends) and stamps each point's month index; otherwise samples `steps + 1`
 *   evenly-spaced points.
 * - Pure: returns weights + shape only, no return/rate numbers.
 */
export function sampleGlidePath(opts: {
  tier: AllocationTier;
  horizonMonths?: number | null;
  steps?: number;
  params?: GlideParams;
  templates?: Partial<Record<AllocationTier, AllocationWeights>>;
}): GlideSamplePoint[] {
  const params = opts.params ?? DEFAULT_GLIDE_PARAMS;
  const horizon =
    opts.horizonMonths != null && Number(opts.horizonMonths) > 0
      ? Math.round(Number(opts.horizonMonths))
      : null;
  const n = horizon ?? Math.max(1, Math.round(Number(opts.steps) || 24));

  const points: GlideSamplePoint[] = [];
  for (let i = 0; i <= n; i++) {
    const elapsedFraction = i / n;
    const timeRemainingFraction = 1 - elapsedFraction;
    points.push({
      elapsedFraction,
      timeRemainingFraction,
      monthIndex: horizon != null ? i : null,
      phase: glidePhaseForElapsed(elapsedFraction, params),
      weights: glidedAllocation(opts.tier, timeRemainingFraction, params, opts.templates),
    });
  }
  return points;
}

/**
 * Validate a set of glide-shape params: steepness must be a finite number ≥ 1
 * (≥ 1 keeps the curve convex/linear, never concave — de-risking must not slow
 * down late), and the three phase thresholds must be finite, within (0,1), and
 * strictly ascending. Returns all failing reasons for an editor to show at once.
 */
export function validateGlideParams(
  params: Partial<GlideParams> | null | undefined,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const p = params ?? {};

  const k = Number(p.steepness);
  if (!Number.isFinite(k) || k < 1) {
    errors.push("De-risking aggressiveness (steepness) must be a number ≥ 1.");
  }

  const fe = Number(p.foundationEnd);
  const ge = Number(p.growthEnd);
  const de = Number(p.deRiskingEnd);
  for (const [name, v] of [
    ["Foundation end", fe],
    ["Growth end", ge],
    ["De-risking end", de],
  ] as const) {
    if (!Number.isFinite(v) || v <= 0 || v >= 1) {
      errors.push(`${name} threshold must be strictly between 0 and 1.`);
    }
  }
  if (Number.isFinite(fe) && Number.isFinite(ge) && Number.isFinite(de)) {
    if (!(fe < ge && ge < de)) {
      errors.push("Phase thresholds must be strictly ascending (foundation < growth < de-risking).");
    }
  }

  return { ok: errors.length === 0, errors };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * Allocation Model — Part 3 of 4: the goal-probability feedback loop.
 *
 * WHAT THIS IS
 *   For a goal's selected tier + the Part 2 glide + a contribution plan, this
 *   computes (a) a TIME-VARYING end-value distribution along the glide and a
 *   floor/ceil-clamped goal PROBABILITY, and (b) the three neutral LEVERS (more
 *   time, more contribution, more risk) each quantified as its effect on that
 *   probability, plus a two-sided, strictly-factual message keyed off editable
 *   high/low thresholds.
 *
 * WHAT THIS IS NOT (invariants)
 *   - NO second probability engine. The lognormal/correlation math is riskModel's
 *     `buildEndValueDistribution` (used per glide period to read each month's
 *     return + vol) and `endValueFromParams` + `goalProbability` for the final
 *     fold. Probability is NEVER shown as 0% or 100% — the floor/ceil clamp in
 *     `goalProbability` carries straight through.
 *   - NO hardcoded return/vol/correlation. The caller resolves a per-bucket
 *     `RiskAssumption` from the sourced layer (`resolveRiskAssumption`) and passes
 *     it in; defaults are only the documented riskModel per-class defaults.
 *   - NO preferred lever. The levers are returned as a flat, unsorted set with
 *     their numbers; the "more risk" lever ALWAYS also reports its worsened
 *     downside (p10), so more risk is never made to look free.
 *   - NO advice. The two-sided message is a factual statement about the math
 *     ("you could reach this at a lower tier; odds stay above X%"), never a
 *     recommendation to act.
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The representative behavior `AssetClass` used to source each allocation
 * bucket's risk assumption. A bucket is modeled by the class that dominates its
 * risk character; the GOVERNMENT bucket is mapped to `gov_coupon` (the more
 * volatile, longer-duration end of the government sleeve) so the band is honest
 * rather than flattering. This is the single bucket→class bridge the probability
 * layer uses; weights still come from the glide, assumptions from riskModel.
 */
export const BUCKET_RISK_CLASS: Record<AllocationBucket, AssetClass> = {
  cash: "cash_mmf",
  gov: "gov_coupon",
  equity: "equity",
  reit: "reit",
  offshore: "offshore_fund",
};

/** The caveat that MUST accompany every figure depending on risky assets. */
export const RISK_ASSUMPTION_CAVEAT =
  "Based on assumed returns; outcomes will vary.";

/** A per-bucket resolved risk assumption set (sourced by the caller). */
export type BucketRiskAssumptions = Record<AllocationBucket, RiskAssumption>;

/**
 * Resolve the per-bucket risk assumptions from the sourced layer. `overrides`
 * lets the caller thread stored per-class edits through `resolveRiskAssumption`
 * (return/vol/correlation), exactly like the existing recompute path; omitted
 * buckets fall back to the riskModel per-class defaults. Nothing is hardcoded
 * here — this is a thin adapter from buckets to riskModel's class assumptions.
 */
export function resolveBucketAssumptions(
  overrides?: Partial<
    Record<
      AllocationBucket,
      { expectedReturnPct?: number | null; volatilityPct?: number | null; correlationGroup?: string | null }
    >
  >,
): BucketRiskAssumptions {
  const out = {} as BucketRiskAssumptions;
  for (const b of ALLOCATION_BUCKETS) {
    const cls = BUCKET_RISK_CLASS[b];
    const r = resolveRiskAssumption(cls, overrides?.[b] ?? undefined);
    out[b] = {
      expectedReturnPct: r.expectedReturnPct,
      volatilityPct: r.volatilityPct,
      correlationGroup: r.correlationGroup,
    };
  }
  return out;
}

/**
 * The effective (time-averaged) annual return and volatility of a tier's GLIDED
 * mix across the horizon. Because the mix de-risks over time, a single static
 * mix would misstate the risk; instead we sample the glide month-by-month and,
 * for EACH month, reuse `buildEndValueDistribution` over that month's bucket
 * weights to read the period's portfolio return and volatility (so the
 * correlation/variance math is riskModel's, not a copy). We then average the
 * per-period return and the per-period VARIANCE across the horizon — variance
 * (not stdev) averages correctly for an independent-increments approximation —
 * and report the resulting effective annual return + vol.
 */
export interface GlideEffectiveRisk {
  annualReturnPct: number;
  annualVolPct: number;
  /** Number of periods sampled. */
  periods: number;
}

export function glideEffectiveRisk(opts: {
  tier: AllocationTier;
  horizonMonths: number;
  assumptions: BucketRiskAssumptions;
  params?: GlideParams;
  templates?: Partial<Record<AllocationTier, AllocationWeights>>;
}): GlideEffectiveRisk {
  const params = opts.params ?? DEFAULT_GLIDE_PARAMS;
  const horizon = Math.max(1, Math.round(Number(opts.horizonMonths) || 0));
  const points = sampleGlidePath({
    tier: opts.tier,
    horizonMonths: horizon,
    params,
    templates: opts.templates,
  });

  let sumReturn = 0;
  let sumVariance = 0;
  let n = 0;
  for (const pt of points) {
    // Build a notional position set for THIS month's mix and let riskModel
    // compute the period's portfolio return + vol from the resolved assumptions.
    const positions = ALLOCATION_BUCKETS.filter((b) => pt.weights[b] > 0).map((b) => ({
      valueKes: pt.weights[b], // weight as a notional KES value; only ratios matter
      assetClass: BUCKET_RISK_CLASS[b],
      assumption: opts.assumptions[b],
    }));
    if (positions.length === 0) continue;
    const slice = buildEndValueDistribution({ positions, horizonYears: 1 });
    sumReturn += slice.portfolioReturnPct;
    sumVariance += slice.portfolioVolPct * slice.portfolioVolPct;
    n += 1;
  }

  if (n === 0) return { annualReturnPct: 0, annualVolPct: 0, periods: 0 };
  const avgReturn = sumReturn / n;
  const avgVol = Math.sqrt(sumVariance / n);
  return {
    annualReturnPct: Math.round(avgReturn * 100) / 100,
    annualVolPct: Math.round(avgVol * 100) / 100,
    periods: n,
  };
}

/**
 * The full probability picture for a plan under a tier's glide. `riskyValue` is
 * the amount that follows the glided risky/growth allocation (typically the
 * plan's projected end value of the contributed pot), and `extraCertainEndValue`
 * is any deterministic chunk (e.g. a held-to-maturity core) folded in unchanged.
 * Reuses `endValueFromParams` (the shared lognormal core) + `goalProbability`
 * (floor/ceil clamp) — no second engine.
 */
export interface GlideProbabilityResult {
  tier: AllocationTier;
  horizonMonths: number;
  goal: number;
  effective: GlideEffectiveRisk;
  distribution: EndValueDistribution;
  probability: GoalProbability;
  caveat: string;
}

export function glideGoalProbability(opts: {
  tier: AllocationTier;
  horizonMonths: number;
  goal: number;
  /** The KES amount that follows the glided risky allocation. */
  riskyValue: number;
  /** Deterministic end value folded in (no modeled price volatility). Default 0. */
  extraCertainEndValue?: number;
  assumptions: BucketRiskAssumptions;
  params?: GlideParams;
  templates?: Partial<Record<AllocationTier, AllocationWeights>>;
}): GlideProbabilityResult {
  const horizonMonths = Math.max(1, Math.round(Number(opts.horizonMonths) || 0));
  const goal = Math.max(0, Number(opts.goal) || 0);
  const certain = Math.max(0, Number(opts.extraCertainEndValue) || 0);
  const effective = glideEffectiveRisk({
    tier: opts.tier,
    horizonMonths,
    assumptions: opts.assumptions,
    params: opts.params,
    templates: opts.templates,
  });
  const distribution = endValueFromParams({
    riskyValue: Math.max(0, Number(opts.riskyValue) || 0),
    annualReturnPct: effective.annualReturnPct,
    annualVolPct: effective.annualVolPct,
    horizonYears: horizonMonths / 12,
    extraCertainEndValue: certain,
  });
  const probability = goalProbability({
    dist: distribution,
    deterministicEndValue: certain || distribution.p50,
    goal,
  });
  return {
    tier: opts.tier,
    horizonMonths,
    goal,
    effective,
    distribution,
    probability,
    caveat: RISK_ASSUMPTION_CAVEAT,
  };
}

/* ───────────────────────────── The three levers ──────────────────────────── */

/** The kind of lever; a flat, neutral set — never ranked or preferred. */
export type LeverKind = "more_time" | "more_contribution" | "more_risk";

/**
 * One lever option: a concrete step and the probability it produces. For the
 * `more_risk` lever, `downsideP10` is ALSO populated (the new, lower 10th-
 * percentile end value) so the worsened downside is shown alongside the higher
 * central probability — more risk is never presented as free.
 */
export interface LeverOption {
  kind: LeverKind;
  /** A short, factual label, e.g. "+6 months" or "Growth tier". */
  label: string;
  /** The probability percentage AFTER applying this step (1..99). */
  probabilityPct: number;
  /** Change in probability points vs the current plan (can be negative). */
  deltaPct: number;
  /** Only for `more_risk`: the new 10th-percentile end value (KES). */
  downsideP10?: number;
  /** Only for `more_risk`: the current 10th-percentile end value (KES), for contrast. */
  baselineP10?: number;
}

/** Editable lever step sizes (mechanics, not preferences). */
export interface LeverSteps {
  /** Extra months to test, e.g. [3, 6, 12]. */
  monthSteps: number[];
  /** Extra monthly contribution KES to test, e.g. [5000, 10000]. */
  contributionSteps: number[];
}

export const DEFAULT_LEVER_STEPS: LeverSteps = {
  monthSteps: [3, 6, 12],
  contributionSteps: [5000, 10000],
};

/**
 * Estimate the additional risky end value contributed by raising the monthly
 * contribution, compounded along the glide at the effective return. This reuses
 * the effective-return number already computed for the plan — it does not invent
 * a parallel projection; it is a transparent annuity future-value of the EXTRA
 * contributions only, added to the existing risky value.
 */
function extraContributionFutureValue(
  extraMonthly: number,
  horizonMonths: number,
  annualReturnPct: number,
): number {
  const m = Math.max(0, Number(extraMonthly) || 0);
  if (m <= 0) return 0;
  const monthlyRate = Math.pow(1 + annualReturnPct / 100, 1 / 12) - 1;
  const nMonths = Math.max(0, Math.round(horizonMonths));
  if (monthlyRate <= 1e-9) return m * nMonths;
  return m * ((Math.pow(1 + monthlyRate, nMonths) - 1) / monthlyRate);
}

/**
 * Compute the three levers for a plan, each quantified, as a FLAT NEUTRAL SET.
 * The result is intentionally NOT sorted by effect and marks no option as
 * preferred. The caller passes the current plan inputs; each lever re-runs
 * `glideGoalProbability` with one input perturbed — the same function the live
 * picture uses, so applying a lever later recomputes identically.
 */
export function computeLevers(opts: {
  tier: AllocationTier;
  horizonMonths: number;
  goal: number;
  riskyValue: number;
  extraCertainEndValue?: number;
  assumptions: BucketRiskAssumptions;
  params?: GlideParams;
  templates?: Partial<Record<AllocationTier, AllocationWeights>>;
  steps?: LeverSteps;
}): LeverOption[] {
  const steps = opts.steps ?? DEFAULT_LEVER_STEPS;
  const base = glideGoalProbability(opts);
  const basePct = base.probability.probabilityPct;
  const levers: LeverOption[] = [];

  // Lever 1 — more time: push the goal date out by each step.
  for (const dm of steps.monthSteps) {
    const r = glideGoalProbability({ ...opts, horizonMonths: opts.horizonMonths + dm });
    levers.push({
      kind: "more_time",
      label: `+${dm} months`,
      probabilityPct: r.probability.probabilityPct,
      deltaPct: round1signed(r.probability.probabilityPct - basePct),
    });
  }

  // Lever 2 — more contribution: add the extra pot's future value to riskyValue.
  for (const dc of steps.contributionSteps) {
    const extra = extraContributionFutureValue(
      dc,
      opts.horizonMonths,
      base.effective.annualReturnPct,
    );
    const r = glideGoalProbability({ ...opts, riskyValue: opts.riskyValue + extra });
    levers.push({
      kind: "more_contribution",
      label: `+KES ${Math.round(dc).toLocaleString()}/month`,
      probabilityPct: r.probability.probabilityPct,
      deltaPct: round1signed(r.probability.probabilityPct - basePct),
    });
  }

  // Lever 3 — more risk: move up one tier (if any). ALWAYS report the worsened
  // downside (the new, lower p10) so the higher central case is never shown alone.
  const rank = tierRank(opts.tier);
  if (rank < ALLOCATION_TIERS.length - 1) {
    const higher = ALLOCATION_TIERS[rank + 1];
    const r = glideGoalProbability({ ...opts, tier: higher });
    levers.push({
      kind: "more_risk",
      label: `${tierSpec(higher).label} tier`,
      probabilityPct: r.probability.probabilityPct,
      deltaPct: round1signed(r.probability.probabilityPct - basePct),
      downsideP10: r.distribution.p10,
      baselineP10: base.distribution.p10,
    });
  }

  return levers;
}

/* ─────────────────────── Two-sided threshold messaging ────────────────────── */

/** Editable thresholds for the two-sided insight. Percentages in 0..100. */
export interface ProbabilityThresholds {
  /** At/above this, surface the factual "reachable at a lower tier" insight. */
  highPct: number;
  /** At/below this, surface the levers to improve the odds. */
  lowPct: number;
}

export const DEFAULT_PROBABILITY_THRESHOLDS: ProbabilityThresholds = {
  highPct: 85,
  lowPct: 60,
};

export type InsightTone = "comfortable" | "in_between" | "low";

/**
 * The two-sided insight. STRICTLY FACTUAL: it describes what the math shows,
 * never what the user "should" do.
 *   - comfortable (prob ≥ highPct) AND a safer tier keeps prob ≥ highPct:
 *       state that the goal is reachable at a lower tier (odds stay above X%).
 *   - low (prob ≤ lowPct): point to the levers (computed separately).
 *   - in between: neutral — show probability + levers without editorializing.
 * The lower-tier check actually recomputes the safer tier's probability, so the
 * claim is verified, not assumed.
 */
export interface ProbabilityInsight {
  tone: InsightTone;
  message: string;
  /** For the comfortable case: the safer tier that still clears highPct, if any. */
  lowerTier?: AllocationTier | null;
  lowerTierProbabilityPct?: number | null;
}

export function probabilityInsight(opts: {
  tier: AllocationTier;
  horizonMonths: number;
  goal: number;
  riskyValue: number;
  extraCertainEndValue?: number;
  assumptions: BucketRiskAssumptions;
  params?: GlideParams;
  templates?: Partial<Record<AllocationTier, AllocationWeights>>;
  thresholds?: ProbabilityThresholds;
}): ProbabilityInsight {
  const thresholds = opts.thresholds ?? DEFAULT_PROBABILITY_THRESHOLDS;
  const base = glideGoalProbability(opts);
  const pct = base.probability.probabilityPct;

  // LOW — surface the improvement levers (the levers themselves are computed by
  // computeLevers; here we only set the tone + factual framing).
  if (pct <= thresholds.lowPct) {
    return {
      tone: "low",
      message:
        `On the assumed figures, the modeled chance of reaching this goal is about ${pct}%. ` +
        `The levers below show, each on its own, what more time, a higher monthly amount, or a higher risk tier does to that number. ${RISK_ASSUMPTION_CAVEAT}`,
      lowerTier: null,
      lowerTierProbabilityPct: null,
    };
  }

  // COMFORTABLE — only if a SAFER tier still keeps the odds at/above highPct.
  if (pct >= thresholds.highPct) {
    const rank = tierRank(opts.tier);
    let lowerTier: AllocationTier | null = null;
    let lowerPct: number | null = null;
    // Walk DOWN from the current tier; report the LOWEST tier that still clears.
    for (let r = rank - 1; r >= 0; r--) {
      const candidate = ALLOCATION_TIERS[r];
      const rr = glideGoalProbability({ ...opts, tier: candidate });
      if (rr.probability.probabilityPct >= thresholds.highPct) {
        lowerTier = candidate;
        lowerPct = rr.probability.probabilityPct;
      } else {
        break; // tiers below this only get safer/lower — stop at the first miss
      }
    }
    if (lowerTier) {
      return {
        tone: "comfortable",
        message:
          `On the assumed figures, the modeled chance is about ${pct}%. ` +
          `You could reach this goal at a lower risk tier (${tierSpec(lowerTier).label}) and the modeled odds stay above ${thresholds.highPct}% (about ${lowerPct}%). ` +
          `This is a statement about the math, not a recommendation. ${RISK_ASSUMPTION_CAVEAT}`,
        lowerTier,
        lowerTierProbabilityPct: lowerPct,
      };
    }
    // Comfortable but no safer tier clears — fall through to neutral framing.
    return {
      tone: "comfortable",
      message:
        `On the assumed figures, the modeled chance is about ${pct}%. ` +
        `No lower risk tier keeps the modeled odds above ${thresholds.highPct}%. ${RISK_ASSUMPTION_CAVEAT}`,
      lowerTier: null,
      lowerTierProbabilityPct: null,
    };
  }

  // IN BETWEEN — neutral.
  return {
    tone: "in_between",
    message:
      `On the assumed figures, the modeled chance of reaching this goal is about ${pct}%. ` +
      `The levers below show what each change would do to that number. ${RISK_ASSUMPTION_CAVEAT}`,
    lowerTier: null,
    lowerTierProbabilityPct: null,
  };
}

/** Validate editable probability thresholds: both in [1,99], high > low. */
export function validateProbabilityThresholds(
  t: Partial<ProbabilityThresholds> | null | undefined,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const hi = Number(t?.highPct);
  const lo = Number(t?.lowPct);
  if (!Number.isFinite(hi) || hi < 1 || hi > 99) errors.push("High threshold must be between 1 and 99.");
  if (!Number.isFinite(lo) || lo < 1 || lo > 99) errors.push("Low threshold must be between 1 and 99.");
  if (Number.isFinite(hi) && Number.isFinite(lo) && !(hi > lo)) {
    errors.push("High threshold must be strictly greater than the low threshold.");
  }
  return { ok: errors.length === 0, errors };
}

/** Round to one decimal, preserving sign (so a +0.0/−0.0 reads cleanly as 0). */
function round1signed(n: number): number {
  const r = Math.round((Number(n) || 0) * 10) / 10;
  return r === 0 ? 0 : r;
}

// Re-export the floor/ceil so consumers can label the clamp without importing
// riskModel directly (single import surface for the allocation layer).
export { PROBABILITY_FLOOR, PROBABILITY_CEIL };


/* ═══════════════════════════════════════════════════════════════════════
 * Allocation Model — Part 4: the factual gap / drift readout
 *
 * Presentation glue ONLY. This layer adds no financial logic: it takes the
 * actual KES already rolled up by the app's single net-worth builder
 * (`buildAllocation` in shared/actuals.ts) and diffs it, in percentage
 * points, against a glided target template. The result is a neutral FACT
 * ("template ~28% equity; you hold ~5% — 23pp under"), never an instruction
 * to buy or sell. The page reuses this for both the "gap vs the template"
 * readout and the "drift once you hold things" readout — one helper, one
 * vocabulary, no second engine.
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * Actual KES value already held in each of the five behavior buckets, plus an
 * honest `other` remainder for anything that does not map to a target bucket
 * (real estate, SACCO, pension, crypto, …). The caller derives these from the
 * shared `buildAllocation` result — this helper does NOT re-value holdings.
 *
 * Mapping (mirrors `bucketForClass` + the car-plan vocabulary):
 *   cash     = primary MMF + secondary MMF + bank deposits (cash-like)
 *   gov      = T-bills + IFB + FXD (government fixed income)
 *   equity   = other["equity"]
 *   reit     = other["reit"]
 *   offshore = other["offshore_fund"]
 *   other    = every remaining tracked class (kept visible, never forced in)
 */
export interface ActualBucketValues {
  cash: number;
  gov: number;
  equity: number;
  reit: number;
  offshore: number;
  /** Tracked value that maps to no target bucket (shown honestly, excluded from gap %). */
  other: number;
}

export interface ActualBucketRollup {
  /** KES value per target bucket. */
  valueKes: Record<AllocationBucket, number>;
  /** KES that maps to no target bucket. */
  otherKes: number;
  /** Total tracked value across the five buckets (EXCLUDES `other`). */
  classifiedKes: number;
  /** Total tracked value INCLUDING the unclassified remainder. */
  totalKes: number;
  /**
   * Percent of the CLASSIFIED total in each bucket (sums to ~100 across the
   * five buckets). We compare against the template on the classified base so an
   * unclassified asset (e.g. a house) does not silently dilute every weight.
   */
  pctOfClassified: Record<AllocationBucket, number>;
  /** True when there is nothing to compare yet (no classified holdings). */
  isEmpty: boolean;
}

/**
 * Roll already-valued actual bucket sums into percentages of the classified
 * base. PURE. Negative inputs are floored at 0; a zero classified base yields
 * an `isEmpty` rollup with all-zero percentages (the page shows the gap as
 * "you hold nothing in this class yet" rather than dividing by zero).
 */
export function rollupActualToBuckets(actual: ActualBucketValues): ActualBucketRollup {
  const valueKes: Record<AllocationBucket, number> = {
    cash: Math.max(0, Number(actual.cash) || 0),
    gov: Math.max(0, Number(actual.gov) || 0),
    equity: Math.max(0, Number(actual.equity) || 0),
    reit: Math.max(0, Number(actual.reit) || 0),
    offshore: Math.max(0, Number(actual.offshore) || 0),
  };
  const otherKes = Math.max(0, Number(actual.other) || 0);
  const classifiedKes = ALLOCATION_BUCKETS.reduce((s, b) => s + valueKes[b], 0);
  const totalKes = classifiedKes + otherKes;
  const isEmpty = classifiedKes <= 0;
  const pctOfClassified: Record<AllocationBucket, number> = {
    cash: 0,
    gov: 0,
    equity: 0,
    reit: 0,
    offshore: 0,
  };
  if (!isEmpty) {
    for (const b of ALLOCATION_BUCKETS) {
      pctOfClassified[b] = round1signed((valueKes[b] / classifiedKes) * 100);
    }
  }
  return { valueKes, otherKes, classifiedKes, totalKes, pctOfClassified, isEmpty };
}

/** Neutral direction label for one bucket's gap — never a buy/sell instruction. */
export type GapDirection = "over" | "under" | "aligned";

export interface BucketGap {
  bucket: AllocationBucket;
  /** Target weight from the glided template (whole %, may carry one decimal). */
  templatePct: number;
  /** Actual weight as % of the classified base. */
  actualPct: number;
  /** actual − template, in percentage points (signed; + = over the template). */
  gapPp: number;
  /** Neutral classification using a small dead-band so tiny noise reads "aligned". */
  direction: GapDirection;
  /** True when no classified holdings exist yet (gap is informational only). */
  noHoldingsYet: boolean;
}

export interface GapReadout {
  /** Per-bucket factual gaps, in the canonical bucket order. */
  gaps: BucketGap[];
  /** The rollup the gaps were computed against (for KES context in the UI). */
  rollup: ActualBucketRollup;
  /** The exact target template (glided) the gaps were measured against. */
  template: AllocationWeights;
  /** The disclaimer that must travel with the readout. */
  caveat: string;
  /** True when there are no classified holdings to compare. */
  isEmpty: boolean;
}

/**
 * Percentage-point dead-band: a |gap| at or below this reads as "aligned" so
 * rounding noise never shows a spurious over/under. Two points is tighter than
 * any template step and matches the tone of the existing concentration bands.
 */
export const GAP_ALIGNED_BAND_PP = 2;

/**
 * Compute the factual gap between a glided target template and the actual mix.
 * PURE and presentation-only — it diffs two weight vectors the rest of the app
 * already produced. `template` is the glided allocation for the journey point;
 * `actual` is the rolled-up holdings. The output is a neutral set of facts in
 * canonical bucket order; the caller decides how to phrase the (always
 * self-directed) next step.
 */
export function computeBucketGaps(opts: {
  template: AllocationWeights;
  actual: ActualBucketValues;
  /** Override the aligned dead-band (defaults to GAP_ALIGNED_BAND_PP). */
  alignedBandPp?: number;
}): GapReadout {
  const rollup = rollupActualToBuckets(opts.actual);
  const band = Math.max(0, Number(opts.alignedBandPp ?? GAP_ALIGNED_BAND_PP) || 0);
  const gaps: BucketGap[] = ALLOCATION_BUCKETS.map((bucket) => {
    const templatePct = round1signed(Number(opts.template[bucket]) || 0);
    const actualPct = rollup.pctOfClassified[bucket];
    const gapPp = round1signed(actualPct - templatePct);
    let direction: GapDirection;
    if (rollup.isEmpty) {
      // No holdings yet: report the gap as the full template weight "under",
      // but mark it informational so the UI frames it as "nothing here yet".
      direction = templatePct > 0 ? "under" : "aligned";
    } else if (Math.abs(gapPp) <= band) {
      direction = "aligned";
    } else {
      direction = gapPp > 0 ? "over" : "under";
    }
    return {
      bucket,
      templatePct,
      actualPct,
      gapPp,
      direction,
      noHoldingsYet: rollup.isEmpty,
    };
  });
  return {
    gaps,
    rollup,
    template: { ...opts.template },
    caveat: RISK_ASSUMPTION_CAVEAT,
    isEmpty: rollup.isEmpty,
  };
}
