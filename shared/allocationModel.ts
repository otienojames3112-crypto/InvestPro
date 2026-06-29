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
