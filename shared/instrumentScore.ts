/**
 * Phase 8a — Unified, transparent instrument score.
 *
 * This module turns the heterogeneous facts an instrument already carries (net
 * yield after WHT, liquidity facet, issuer, expense ratio, figure freshness and
 * verification trust) into a SINGLE transparent number plus a fully itemised
 * breakdown of how that number was reached. It exists so the Explore/Research
 * surface can rank candidates on more than headline yield alone, while showing
 * the user EXACTLY which factors moved the score and by how much.
 *
 * NON-ADVISORY CONTRACT (load-bearing):
 *   - The score is a FACTUAL composite of published facts, never a recommendation.
 *   - It contains no "best / recommended / optimal / top / preferred" language.
 *   - A higher score means "more of the factual attributes this composite rewards
 *     (net yield) and fewer of the ones it penalises (illiquidity, single-issuer
 *     concentration, stale or unverified figures, fees)" — nothing more.
 *   - Every component is signed, labelled and explained so the user can disagree
 *     with the weighting and read the raw facts underneath.
 *
 * REUSE CONTRACT (no parallel engines):
 *   - Net yield reuses the same after-WHT idea as `shared/liquidAllocator.netYield`
 *     and `server/engine.netYield`. IFB tax-exemption is honoured by passing a 0
 *     WHT for that figure upstream (the catalog already stores the net figure for
 *     tax-exempt instruments).
 *   - The gov-outranks-bank-when-close tie-break reuses the SAME rule shape as
 *     `server/engine.applySovereignPreference` (a bank candidate beating the best
 *     government candidate by less than a threshold sorts after it).
 *   - Staleness reuses `STALE_AFTER_DAYS` / `VERY_STALE_AFTER_DAYS` and the
 *     `effectiveState` lifecycle from `shared/provenance.ts`.
 *
 * The module is pure and deterministic so it is unit-testable and can be shared
 * by the server (ranking endpoint) and the client (Explore table) unchanged.
 */

import {
  STALE_AFTER_DAYS,
  VERY_STALE_AFTER_DAYS,
  type VerificationState,
} from "./provenance";

/** Liquidity facet stored on the catalog row (drizzle `opportunities.liquidity`). */
export type LiquidityFacet = "daily" | "t_plus_settlement" | "term" | "illiquid";

/**
 * Asset-class buckets we group an instrument into for the sovereign tie-break.
 * Government discount/coupon paper is "gov"; bank deposits are "bank"; everything
 * else is "other" and never participates in the tie-break.
 */
export type ScoreBucket = "gov" | "bank" | "other";

/**
 * Compute the NET annual yield % for a catalog instrument WITHOUT double-discounting.
 *
 * The catalog publishes a yield/coupon figure plus a `yieldKind` describing what it
 * is. We must not subtract WHT from a figure that is already net, and must not leave
 * a gross coupon un-taxed. Rules (reusing the same 15% default WHT the engine uses
 * and the IFB tax-exemption already encoded in the asset model):
 *   - `yieldKind` containing "net" / "distribution" → already net, used verbatim.
 *   - tax-exempt instruments (IFB / explicitly tax-exempt) → net == gross.
 *   - everything else (coupon / interest / discount, gross) → gross × (1 − WHT).
 * Returns null when there is no published figure.
 */
export function catalogNetYieldPct(args: {
  yieldPct: number | null;
  yieldKind: string | null;
  assetClass: string;
  /** Neutral factual note (used only to detect an explicit tax-exempt marker). */
  factNote?: string | null;
  /** Withholding-tax rate %, default 15 (the engine default). */
  whtPct?: number;
}): number | null {
  if (args.yieldPct === null || !Number.isFinite(args.yieldPct)) return null;
  const gross = Number(args.yieldPct);
  const kind = (args.yieldKind ?? "").toLowerCase();
  const note = (args.factNote ?? "").toLowerCase();
  const wht = Math.min(100, Math.max(0, args.whtPct ?? 15));
  // Already-net figures: a fund's published net yield or a distribution yield.
  if (kind.includes("net") || kind.includes("distribution")) return gross;
  // Tax-exempt instruments (infrastructure bonds): net == gross.
  const taxExempt =
    kind.includes("exempt") ||
    note.includes("tax-exempt") ||
    note.includes("infrastructure bond");
  if (taxExempt) return gross;
  // Otherwise treat as a gross taxable income figure.
  return gross * (1 - wht / 100);
}

/** Map the Part-1 assetClass taxonomy onto the score bucket. */
export function bucketForAssetClass(assetClass: string): ScoreBucket {
  switch (assetClass) {
    case "gov_discount":
    case "gov_coupon":
      return "gov";
    case "bank_deposit":
      return "bank";
    default:
      return "other";
  }
}

/**
 * Tunable weights for the composite. Defaults are chosen so net yield dominates
 * (it is the headline fact) and the penalties are meaningful but never able to
 * flip a large yield gap on their own. All weights are exposed so the UI can show
 * them and a future settings surface can let a maintainer adjust them.
 */
export interface ScoreWeights {
  /** Points per 1pp of net yield. */
  netYieldPerPct: number;
  /** Penalty (points) for a t+settlement liquidity facet. */
  liquidityTPlusPenalty: number;
  /** Penalty (points) for a term (locked) liquidity facet. */
  liquidityTermPenalty: number;
  /** Penalty (points) for an illiquid facet. */
  liquidityIlliquidPenalty: number;
  /** Penalty (points) per 1pp of expense ratio. */
  expensePerPct: number;
  /** Penalty (points) when this issuer is over the concentration threshold. */
  concentrationPenalty: number;
  /** Penalty (points) for a figure that is stale (>= STALE_AFTER_DAYS). */
  stalePenalty: number;
  /** Additional penalty (points) for a very stale figure (>= VERY_STALE_AFTER_DAYS). */
  veryStalePenalty: number;
  /** Penalty (points) for an unverified figure (scraped/ai, no human check). */
  unverifiedPenalty: number;
  /**
   * Sovereign tie-break threshold in NET-YIELD points: a bank candidate whose net
   * yield beats the best government candidate by less than this is sorted after
   * the government candidate. Mirrors engine.SOVEREIGN_PREFERENCE_THRESHOLD_PCT.
   */
  sovereignThresholdPct: number;
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  netYieldPerPct: 10,
  liquidityTPlusPenalty: 2,
  liquidityTermPenalty: 6,
  liquidityIlliquidPenalty: 12,
  expensePerPct: 8,
  concentrationPenalty: 8,
  stalePenalty: 6,
  veryStalePenalty: 6,
  unverifiedPenalty: 4,
  sovereignThresholdPct: 0.5,
};

/** One signed line of the score breakdown. */
export interface ScoreComponent {
  /** Stable key for testing/UI. */
  key:
    | "net_yield"
    | "liquidity"
    | "expense"
    | "concentration"
    | "stale"
    | "unverified";
  /** Short human label, e.g. "Net yield". */
  label: string;
  /** Signed points contribution (+ adds to score, − subtracts). */
  points: number;
  /** Plain-language, non-advisory explanation of this line. */
  detail: string;
}

/** Reason an instrument is INELIGIBLE for scoring (a gate, not a penalty). */
export type IneligibilityReason =
  | "inactive"
  | "no_yield_figure"
  | "currency_excluded";

/** Input facts for one instrument. All optional facts may be null. */
export interface ScoreInput {
  ref: string;
  name: string;
  assetClass: string;
  issuer: string | null;
  currency: string;
  /** NET annual yield % after WHT (caller computes; tax-exempt passes its net = gross). */
  netYieldPct: number | null;
  /** Expense ratio / management fee %, where applicable. */
  expenseRatioPct: number | null;
  /** Liquidity facet, where stored. */
  liquidity: LiquidityFacet | null;
  /** As-of timestamp of the headline figure, epoch ms UTC (drives staleness). */
  dataAsOf: number | null;
  /** Effective verification/display state of the headline figure. */
  verificationState: VerificationState;
  /** Row is active (not soft-hidden). */
  active: boolean;
}

/** Options governing eligibility gates and concentration context. */
export interface ScoreContext {
  weights?: Partial<ScoreWeights>;
  /** "now" for staleness math, epoch ms UTC. Defaults to Date.now(). */
  nowMs?: number;
  /**
   * Currencies allowed by the eligibility gate. When provided, an instrument in a
   * currency NOT in this set is gated out (factual exclusion, not a penalty).
   */
  allowedCurrencies?: string[];
  /**
   * Issuers currently AT OR OVER the concentration threshold in the user's
   * portfolio. An instrument from such an issuer takes the concentration penalty.
   * This reuses the issuer-cap concept from the liquid allocator / portfolio
   * review rather than inventing a new concentration model.
   */
  concentratedIssuers?: string[];
}

export interface ScoredInstrument {
  ref: string;
  name: string;
  assetClass: string;
  bucket: ScoreBucket;
  /** NET yield used (echoed for the sovereign tie-break + UI). */
  netYieldPct: number;
  /** Final composite score (sum of components). Higher = more rewarded facts. */
  score: number;
  /** Itemised, signed breakdown of how the score was reached. */
  components: ScoreComponent[];
  /** True when the instrument passed every eligibility gate. */
  eligible: boolean;
  /** Reasons the instrument was gated out (empty when eligible). */
  ineligibleReasons: IneligibilityReason[];
}

function resolveWeights(partial?: Partial<ScoreWeights>): ScoreWeights {
  return { ...DEFAULT_SCORE_WEIGHTS, ...(partial ?? {}) };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Score a single instrument. Returns the composite, the signed breakdown, and the
 * eligibility verdict. An INELIGIBLE instrument still returns a breakdown (so the
 * UI can show why it was gated) but its score is forced to a sentinel of -Infinity
 * so it always sorts last; callers typically filter on `eligible` instead.
 */
export function scoreInstrument(input: ScoreInput, ctx: ScoreContext = {}): ScoredInstrument {
  const w = resolveWeights(ctx.weights);
  const nowMs = ctx.nowMs ?? Date.now();
  const bucket = bucketForAssetClass(input.assetClass);
  const net = Number(input.netYieldPct) || 0;

  // ── Eligibility gates (factual exclusions, never penalties) ──
  const ineligibleReasons: IneligibilityReason[] = [];
  if (!input.active) ineligibleReasons.push("inactive");
  if (input.netYieldPct === null || !Number.isFinite(input.netYieldPct)) {
    ineligibleReasons.push("no_yield_figure");
  }
  if (
    ctx.allowedCurrencies &&
    ctx.allowedCurrencies.length > 0 &&
    !ctx.allowedCurrencies.includes(input.currency)
  ) {
    ineligibleReasons.push("currency_excluded");
  }
  const eligible = ineligibleReasons.length === 0;

  const components: ScoreComponent[] = [];

  // 1) Net yield — the headline, positive contribution.
  const netPoints = round1(net * w.netYieldPerPct);
  components.push({
    key: "net_yield",
    label: "Net yield",
    points: netPoints,
    detail: `${net.toFixed(2)}% net annual yield after tax, scored at ${w.netYieldPerPct} points per percentage point.`,
  });

  // 2) Liquidity penalty — how quickly the money can be reached.
  let liqPoints = 0;
  let liqDetail = "Daily-access (immediately spendable) — no liquidity penalty.";
  switch (input.liquidity) {
    case "t_plus_settlement":
      liqPoints = -w.liquidityTPlusPenalty;
      liqDetail = `Settles a few days after a sell (T+settlement) — −${w.liquidityTPlusPenalty}.`;
      break;
    case "term":
      liqPoints = -w.liquidityTermPenalty;
      liqDetail = `Locked until maturity (term) — −${w.liquidityTermPenalty}.`;
      break;
    case "illiquid":
      liqPoints = -w.liquidityIlliquidPenalty;
      liqDetail = `Hard to sell on demand (illiquid) — −${w.liquidityIlliquidPenalty}.`;
      break;
    case "daily":
    default:
      liqPoints = 0;
      liqDetail =
        input.liquidity === "daily"
          ? "Daily-access (immediately spendable) — no liquidity penalty."
          : "Liquidity not recorded — no liquidity penalty applied.";
      break;
  }
  components.push({ key: "liquidity", label: "Liquidity", points: round1(liqPoints), detail: liqDetail });

  // 3) Expense ratio penalty.
  const exp = Number(input.expenseRatioPct) || 0;
  const expPoints = exp > 0 ? -round1(exp * w.expensePerPct) : 0;
  components.push({
    key: "expense",
    label: "Fees",
    points: expPoints,
    detail:
      exp > 0
        ? `${exp.toFixed(2)}% expense ratio, scored at −${w.expensePerPct} points per percentage point.`
        : "No expense ratio recorded — no fee penalty.",
  });

  // 4) Issuer-concentration penalty (reuses the portfolio's issuer-cap context).
  const issuer = input.issuer ?? "";
  const isConcentrated =
    issuer !== "" && (ctx.concentratedIssuers ?? []).includes(issuer);
  const concPoints = isConcentrated ? -w.concentrationPenalty : 0;
  components.push({
    key: "concentration",
    label: "Issuer concentration",
    points: concPoints,
    detail: isConcentrated
      ? `You already hold this issuer (${issuer}) at or above your concentration threshold — −${w.concentrationPenalty}.`
      : "This issuer is within your concentration threshold — no penalty.",
  });

  // 5) Staleness penalty (reuses STALE_AFTER_DAYS / VERY_STALE_AFTER_DAYS).
  let stalePoints = 0;
  let staleDetail = "Figure is current — no staleness penalty.";
  if (input.verificationState === "stale") {
    // The display lifecycle already resolved this figure to stale.
    stalePoints = -w.stalePenalty;
    staleDetail = `The headline figure is marked stale — −${w.stalePenalty}.`;
  } else if (input.dataAsOf !== null && Number.isFinite(input.dataAsOf)) {
    const ageDays = (nowMs - (input.dataAsOf as number)) / (1000 * 60 * 60 * 24);
    if (ageDays >= VERY_STALE_AFTER_DAYS) {
      stalePoints = -(w.stalePenalty + w.veryStalePenalty);
      staleDetail = `The headline figure is over ${VERY_STALE_AFTER_DAYS} days old — −${w.stalePenalty + w.veryStalePenalty}.`;
    } else if (ageDays >= STALE_AFTER_DAYS) {
      stalePoints = -w.stalePenalty;
      staleDetail = `The headline figure is over ${STALE_AFTER_DAYS} days old — −${w.stalePenalty}.`;
    }
  }
  components.push({ key: "stale", label: "Freshness", points: round1(stalePoints), detail: staleDetail });

  // 6) Unverified penalty — no human has checked the figure.
  const isUnverified =
    input.verificationState === "scraped_unverified" ||
    input.verificationState === "ai_extracted";
  const unverPoints = isUnverified ? -w.unverifiedPenalty : 0;
  components.push({
    key: "unverified",
    label: "Verification",
    points: unverPoints,
    detail: isUnverified
      ? input.verificationState === "ai_extracted"
        ? `Figure was read by AI and not yet checked by a person — −${w.unverifiedPenalty}.`
        : `Figure was scraped and not yet checked by a person — −${w.unverifiedPenalty}.`
      : "A person has checked or entered this figure — no penalty.",
  });

  const rawScore = components.reduce((s, c) => s + c.points, 0);
  const score = eligible ? round1(rawScore) : -Infinity;

  return {
    ref: input.ref,
    name: input.name,
    assetClass: input.assetClass,
    bucket,
    netYieldPct: net,
    score,
    components,
    eligible,
    ineligibleReasons,
  };
}

/**
 * Apply the sovereign-preference tie-break to a SCORED list, mirroring
 * `server/engine.applySovereignPreference` but operating on the composite-score
 * world: a bank candidate whose NET YIELD beats the best government candidate by
 * less than `sovereignThresholdPct` is demoted below the government candidates.
 * Ineligible rows always sort last. Pure and stable.
 */
export function applySovereignPreferenceToScored<
  T extends { bucket: ScoreBucket; netYieldPct: number; score: number; eligible: boolean },
>(scored: T[], thresholdPct: number = DEFAULT_SCORE_WEIGHTS.sovereignThresholdPct): T[] {
  const bestGovNet = Math.max(
    -Infinity,
    ...scored.filter((s) => s.eligible && s.bucket === "gov").map((s) => s.netYieldPct),
  );
  return [...scored].sort((a, b) => {
    // Ineligible always last.
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
    if (Number.isFinite(bestGovNet)) {
      const aBankClose =
        a.bucket === "bank" && a.netYieldPct - bestGovNet < thresholdPct;
      const bBankClose =
        b.bucket === "bank" && b.netYieldPct - bestGovNet < thresholdPct;
      if (aBankClose && !bBankClose) return 1;
      if (!aBankClose && bBankClose) return -1;
    }
    return b.score - a.score;
  });
}

/**
 * Score and rank a whole list of instruments: score each, then sort by composite
 * with the sovereign tie-break applied. Eligible-only filtering is left to the
 * caller so a UI can still display gated rows with their reasons.
 */
export function scoreAndRank(
  inputs: ScoreInput[],
  ctx: ScoreContext = {},
): ScoredInstrument[] {
  const w = resolveWeights(ctx.weights);
  const scored = inputs.map((i) => scoreInstrument(i, ctx));
  return applySovereignPreferenceToScored(scored, w.sovereignThresholdPct);
}
