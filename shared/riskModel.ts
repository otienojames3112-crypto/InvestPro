/**
 * Expansion Brief — Part 6: Risk, volatility & honest projections.
 *
 * A single projected line is a defensible approximation for a T-bill but a
 * dangerous fiction for an equity or an offshore fund. THIS module makes
 * uncertainty first-class: it carries the per-class risk ASSUMPTIONS (expected
 * return, annualised volatility, a coarse correlation group), composes a plan's
 * end-value into a DISTRIBUTION (closed-form portfolio mean/variance — no Monte
 * Carlo required for honesty), and derives a goal PROBABILITY from it.
 *
 * Hard honesty rules baked in (these are invariants, not preferences):
 *   - Every figure here is an ASSUMPTION, never a fact or forecast. Defaults are
 *     sensible-by-class but always labeled "assumed" and always user-editable.
 *   - A fixed-income-only plan has ~zero modeled volatility on a held-to-maturity
 *     basis, so its distribution stays tight and near-deterministic — the car
 *     plan is unchanged. The cone widens ONLY as risky assets are added.
 *   - Probability is never rounded to certainty: it is clamped to [1%, 99%].
 *   - Nothing here ranks, recommends, auto-selects, or transacts. Risk tolerance
 *     sets DEFAULTS and raises WARNINGS only; the user always decides.
 *
 * Framework-free + deterministic so it imports cleanly on client and server and
 * is trivially unit-testable. It REUSES the existing band/decision-surface idea
 * (Conservative/Base/Optimistic → percentile anchors); it does not spawn a
 * parallel projection.
 */

import { type AssetClass, profileFor } from "./assetModel";

/* ───────────────────────── Correlation groups ────────────────────────── */

/**
 * A coarse correlation bucket — assets in the same group move together; the
 * cross-group correlations are deliberately rough (this is a transparent
 * approximation, not a covariance estimate from market data).
 */
export type CorrelationGroup =
  | "kes_rates" // KES fixed income (bills, bonds, MMF, bank) — held-to-maturity, near-zero vol
  | "kes_equity" // Nairobi-listed shares / local equity funds
  | "property" // REITs / property funds
  | "offshore_equity" // global / S&P / offshore funds (also FX-exposed)
  | "cash"; // call cash — effectively riskless

export const CORRELATION_GROUPS: readonly CorrelationGroup[] = [
  "kes_rates",
  "kes_equity",
  "property",
  "offshore_equity",
  "cash",
] as const;

/** Plain labels for chrome. */
export const CORRELATION_GROUP_LABELS: Record<CorrelationGroup, string> = {
  kes_rates: "KES rates",
  kes_equity: "KES equity",
  property: "Property",
  offshore_equity: "Offshore equity",
  cash: "Cash",
};

/**
 * Coarse, transparent correlation matrix between groups. Diagonal is 1. Values
 * are round, defensible guesses (NOT fitted): local equity and property move
 * somewhat together; offshore equity is loosely linked to local equity; rates
 * and cash are near-uncorrelated with the risky sleeve. The user cannot break
 * the plan by trusting these — they only widen/narrow the modeled cone.
 */
const CORR: Record<CorrelationGroup, Record<CorrelationGroup, number>> = {
  kes_rates: { kes_rates: 1, kes_equity: 0.1, property: 0.1, offshore_equity: 0.0, cash: 0.2 },
  kes_equity: { kes_rates: 0.1, kes_equity: 1, property: 0.5, offshore_equity: 0.4, cash: 0.0 },
  property: { kes_rates: 0.1, kes_equity: 0.5, property: 1, offshore_equity: 0.3, cash: 0.0 },
  offshore_equity: { kes_rates: 0.0, kes_equity: 0.4, property: 0.3, offshore_equity: 1, cash: 0.0 },
  cash: { kes_rates: 0.2, kes_equity: 0.0, property: 0.0, offshore_equity: 0.0, cash: 1 },
};

export function correlationBetween(a: CorrelationGroup, b: CorrelationGroup): number {
  return CORR[a]?.[b] ?? 0;
}

/* ───────────────────────── Per-class assumptions ─────────────────────── */

/**
 * The per-class risk ASSUMPTION set. Defaults are sensible by class but are
 * estimates of how much a holding could swing — the user is invited to replace
 * them with their own view. Provenance travels with any edited value.
 */
export interface RiskAssumption {
  /** Assumed long-run annual return (%/yr). */
  expectedReturnPct: number;
  /** Assumed annualised volatility — standard deviation of annual return (%/yr). */
  volatilityPct: number;
  correlationGroup: CorrelationGroup;
}

/**
 * Default risk assumptions per behavior class. Fixed income is near-zero
 * volatility on a HELD-TO-MATURITY basis (the plan does not mark it to market),
 * which is exactly why fixed-income-only plans keep their tight band. Equity,
 * property and offshore carry real volatility; offshore adds FX swing on top.
 *
 * These are intentionally round numbers — they read as assumptions, not quotes.
 */
export const DEFAULT_RISK_BY_CLASS: Record<AssetClass, RiskAssumption> = {
  cash_mmf: { expectedReturnPct: 9, volatilityPct: 1, correlationGroup: "cash" },
  bank_deposit: { expectedReturnPct: 8, volatilityPct: 1, correlationGroup: "kes_rates" },
  gov_discount: { expectedReturnPct: 13, volatilityPct: 1.5, correlationGroup: "kes_rates" },
  gov_coupon: { expectedReturnPct: 13.5, volatilityPct: 4, correlationGroup: "kes_rates" },
  equity: { expectedReturnPct: 12, volatilityPct: 25, correlationGroup: "kes_equity" },
  reit: { expectedReturnPct: 10, volatilityPct: 18, correlationGroup: "property" },
  offshore_fund: { expectedReturnPct: 11, volatilityPct: 22, correlationGroup: "offshore_equity" },
  alt: { expectedReturnPct: 10, volatilityPct: 30, correlationGroup: "kes_equity" },
};

/** Read the default assumption for a class (single lookup the UI/engine use). */
export function defaultRiskFor(assetClass: AssetClass): RiskAssumption {
  return DEFAULT_RISK_BY_CLASS[assetClass];
}

/**
 * Resolve the EFFECTIVE risk assumption for a holding: user-edited values win,
 * else fall back to the per-class default. Each resolved field reports whether
 * it came from the user (so the UI can mark defaults as "assumed by class").
 */
export interface RiskAssumptionResolved extends RiskAssumption {
  expectedReturnIsDefault: boolean;
  volatilityIsDefault: boolean;
  correlationGroupIsDefault: boolean;
}

export function resolveRiskAssumption(
  assetClass: AssetClass,
  overrides?: {
    expectedReturnPct?: number | null;
    volatilityPct?: number | null;
    correlationGroup?: string | null;
  },
): RiskAssumptionResolved {
  const def = defaultRiskFor(assetClass);
  const er = numOrNull(overrides?.expectedReturnPct);
  const vol = numOrNull(overrides?.volatilityPct);
  const cgRaw = overrides?.correlationGroup;
  const cg = (CORRELATION_GROUPS as readonly string[]).includes(cgRaw ?? "")
    ? (cgRaw as CorrelationGroup)
    : null;
  return {
    expectedReturnPct: er ?? def.expectedReturnPct,
    volatilityPct: vol != null ? Math.max(0, vol) : def.volatilityPct,
    correlationGroup: cg ?? def.correlationGroup,
    expectedReturnIsDefault: er == null,
    volatilityIsDefault: vol == null,
    correlationGroupIsDefault: cg == null,
  };
}

/* ───────────────────────── Portfolio distribution ────────────────────── */

/** One position fed into the distribution: its KES weight and risk assumption. */
export interface RiskPosition {
  /** KES value at "today" (the base for growth). */
  valueKes: number;
  assetClass: AssetClass;
  assumption: RiskAssumption;
}

/**
 * The distribution of a plan's END value, expressed as a small set of honest
 * numbers. We model the end value as lognormal (returns compound, value stays
 * non-negative), parameterised by the portfolio's expected annual return and
 * annualised volatility scaled to the horizon. P50 is the median (≈ "most
 * likely"), P10/P90 bound ~80% of outcomes.
 */
export interface EndValueDistribution {
  /** Horizon in years used to scale annual vol. */
  horizonYears: number;
  /** Expected (mean) end value, KES. */
  mean: number;
  /** Median (P50) end value, KES — the "most likely" anchor. */
  p50: number;
  /** ~10th percentile end value, KES (downside of the ~80% band). */
  p10: number;
  /** ~90th percentile end value, KES (upside of the ~80% band). */
  p90: number;
  /** Annualised portfolio volatility actually modeled (%/yr). */
  portfolioVolPct: number;
  /** Portfolio expected annual return modeled (%/yr). */
  portfolioReturnPct: number;
  /** Total horizon standard deviation of log-return (dimensionless). */
  sigmaHorizon: number;
  /** Median of the RISKY sleeve only (excludes the deterministic add-on). */
  riskyMedian: number;
  /** Deterministic end value folded in (no price volatility). */
  certainEndValue: number;
  /**
   * True when the plan contains price-driven / FX assets with material
   * volatility — i.e. when the band is meaningfully wider than a point. A
   * fixed-income-only plan reports false and a near-zero sigma, so callers keep
   * the existing tight, near-deterministic band unchanged.
   */
  hasMaterialRisk: boolean;
}

const Z_P10 = -1.2815515655446004; // inverse normal CDF at 0.10
const Z_P90 = 1.2815515655446004; // inverse normal CDF at 0.90

/** Volatility (annualised, fraction) below which a plan is "near-deterministic". */
export const MATERIAL_RISK_VOL_THRESHOLD = 0.03; // 3% portfolio vol

/**
 * Compose the end-value distribution from a set of positions over a horizon.
 *
 * Portfolio expected return is the value-weighted mean of the positions'
 * expected returns. Portfolio variance uses the standard
 *   σ_p² = ΣΣ wᵢ wⱼ σᵢ σⱼ ρ(gᵢ, gⱼ)
 * with weights wᵢ = valueᵢ / totalValue and ρ from the coarse group matrix.
 * The end-value is then lognormal with drift (portfolio return) over the
 * horizon. Cash/held-to-maturity legs contribute their near-zero vol, so a plan
 * with no risky assets collapses to an essentially deterministic compounding.
 *
 * `extraCertainEndValue` lets the caller fold in a deterministic chunk (e.g. the
 * fixed-income engine's own projected end value of the liquid core / ladder)
 * that should grow with the plan but carry no modeled price volatility.
 */
export function buildEndValueDistribution(opts: {
  positions: RiskPosition[];
  horizonYears: number;
  /** Deterministic end value to add on top (no price volatility). Default 0. */
  extraCertainEndValue?: number;
}): EndValueDistribution {
  const years = Math.max(0, Number(opts.horizonYears) || 0);
  const positions = opts.positions.filter((p) => Number(p.valueKes) > 0);
  const certain = Math.max(0, Number(opts.extraCertainEndValue) || 0);

  const riskyValue = positions.reduce((a, p) => a + p.valueKes, 0);

  // Weights over the RISKY sleeve only (the deterministic chunk is handled apart).
  const weights = positions.map((p) => (riskyValue > 0 ? p.valueKes / riskyValue : 0));
  const mu = positions.reduce(
    (a, p, i) => a + weights[i] * (p.assumption.expectedReturnPct / 100),
    0,
  );

  // Portfolio variance of the risky sleeve.
  let variance = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = 0; j < positions.length; j++) {
      const si = positions[i].assumption.volatilityPct / 100;
      const sj = positions[j].assumption.volatilityPct / 100;
      const rho = correlationBetween(
        positions[i].assumption.correlationGroup,
        positions[j].assumption.correlationGroup,
      );
      variance += weights[i] * weights[j] * si * sj * rho;
    }
  }
  const sigmaAnnual = Math.sqrt(Math.max(0, variance));

  // Grow the risky sleeve by its expected return; lognormal spread on top.
  const riskyMean = riskyValue * Math.pow(1 + mu, years);
  // Horizon sigma of log-return scales with sqrt(time).
  const sigmaHorizon = sigmaAnnual * Math.sqrt(years);

  // Lognormal percentiles around the MEDIAN. Median of a lognormal whose mean is
  // riskyMean is mean * exp(-σ²/2). We anchor P50 at the median so P10<P50<P90.
  const median = riskyMean * Math.exp(-(sigmaHorizon * sigmaHorizon) / 2);
  const p10Risky = median * Math.exp(Z_P10 * sigmaHorizon);
  const p90Risky = median * Math.exp(Z_P90 * sigmaHorizon);

  const hasMaterialRisk = sigmaAnnual >= MATERIAL_RISK_VOL_THRESHOLD && riskyValue > 0;

  return {
    horizonYears: years,
    mean: round0(riskyMean + certain),
    p50: round0(median + certain),
    p10: round0(p10Risky + certain),
    p90: round0(p90Risky + certain),
    portfolioVolPct: round2(sigmaAnnual * 100),
    portfolioReturnPct: round2(mu * 100),
    sigmaHorizon,
    riskyMedian: round0(median),
    certainEndValue: round0(certain),
    hasMaterialRisk,
  };
}

/* ───────────────────────── Goal probability ──────────────────────────── */

export interface GoalProbability {
  /** Probability of reaching the goal, as a fraction in [0.01, 0.99]. */
  probability: number;
  /** Same as a clamped, never-certain percentage for display. */
  probabilityPct: number;
  /** True when the figure was clamped away from 0/100 (so we never imply certainty). */
  clamped: boolean;
  /** True when there is essentially no modeled uncertainty (deterministic plan). */
  nearDeterministic: boolean;
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26 via erf approximation). */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  // Numerical Recipes erfc-based approximation; accurate to ~1.2e-7.
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const ans =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 +
                            t *
                              (-1.13520398 +
                                t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? 1 - ans : ans - 1;
}

/** Display clamp — confidence is NEVER shown as certainty. */
export const PROBABILITY_FLOOR = 0.01;
export const PROBABILITY_CEIL = 0.99;

/**
 * Probability the plan's end value reaches `goal`, from the lognormal
 * distribution. For a near-deterministic plan (no modeled uncertainty) this
 * degrades gracefully to ~certain-but-capped: if the deterministic value clears
 * the goal we report the ceiling (99%), else the floor (1%) — we never print
 * "100% chance" even for a T-bill ladder.
 */
export function goalProbability(opts: {
  dist: EndValueDistribution;
  /** Deterministic end value (used when the plan has no modeled uncertainty). */
  deterministicEndValue: number;
  goal: number;
}): GoalProbability {
  const goal = Math.max(0, Number(opts.goal) || 0);
  const sigma = opts.dist.sigmaHorizon;

  // Near-deterministic: no meaningful spread — judge the point value, but cap it.
  if (!(sigma > 1e-6) || !opts.dist.hasMaterialRisk) {
    const clears = (opts.deterministicEndValue || opts.dist.p50) >= goal;
    return {
      probability: clears ? PROBABILITY_CEIL : PROBABILITY_FLOOR,
      probabilityPct: round1((clears ? PROBABILITY_CEIL : PROBABILITY_FLOOR) * 100),
      clamped: true,
      nearDeterministic: true,
    };
  }

  // The end value is (deterministic certain chunk) + (lognormal risky sleeve).
  // Only the risky sleeve carries the spread, so we test the residual goal
  // (goal − certain) against the risky lognormal median. If the certain chunk
  // alone already clears the goal, the residual is ≤ 0 and the plan clears with
  // capped certainty.
  const median = opts.dist.riskyMedian;
  const residualGoal = goal - opts.dist.certainEndValue;
  if (residualGoal <= 0) {
    return { probability: PROBABILITY_CEIL, probabilityPct: round1(PROBABILITY_CEIL * 100), clamped: true, nearDeterministic: false };
  }
  if (!(median > 0)) {
    return { probability: PROBABILITY_FLOOR, probabilityPct: 1, clamped: true, nearDeterministic: false };
  }
  // z = (ln(median) − ln(residualGoal)) / sigma ; P(V>=goal) = Φ(z)
  const z = (Math.log(median) - Math.log(residualGoal)) / sigma;
  const raw = normalCdf(z);
  const clampedVal = Math.min(PROBABILITY_CEIL, Math.max(PROBABILITY_FLOOR, raw));
  return {
    probability: clampedVal,
    probabilityPct: round1(clampedVal * 100),
    clamped: clampedVal !== raw,
    nearDeterministic: false,
  };
}

/* ───────────────────────── Risk tolerance ────────────────────────────── */

/** The optional, user-stated comfort band per portfolio. */
export type RiskTolerance =
  | "capital_preservation"
  | "conservative"
  | "balanced"
  | "growth"
  | "aggressive";

export const RISK_TOLERANCES: readonly RiskTolerance[] = [
  "capital_preservation",
  "conservative",
  "balanced",
  "growth",
  "aggressive",
] as const;

export interface RiskToleranceSpec {
  tolerance: RiskTolerance;
  label: string;
  blurb: string;
  /** The portfolio annualised volatility (%) this band is broadly comfortable with. */
  comfortVolCeilingPct: number;
}

export const RISK_TOLERANCE_SPECS: Record<RiskTolerance, RiskToleranceSpec> = {
  capital_preservation: {
    tolerance: "capital_preservation",
    label: "Capital preservation",
    blurb: "I do not want to risk losing capital; near-cash and held-to-maturity only.",
    comfortVolCeilingPct: 3,
  },
  conservative: {
    tolerance: "conservative",
    label: "Conservative",
    blurb: "Mostly fixed income; small swings are acceptable.",
    comfortVolCeilingPct: 7,
  },
  balanced: {
    tolerance: "balanced",
    label: "Balanced",
    blurb: "A mix of fixed income and some equities; moderate swings are fine.",
    comfortVolCeilingPct: 12,
  },
  growth: {
    tolerance: "growth",
    label: "Growth",
    blurb: "Tilted to equities; I can ride larger swings for higher expected return.",
    comfortVolCeilingPct: 18,
  },
  aggressive: {
    tolerance: "aggressive",
    label: "Aggressive",
    blurb: "Mostly equities / offshore; large swings are acceptable.",
    comfortVolCeilingPct: 100,
  },
};

/**
 * Default per-class assumptions are already set; tolerance is used for two
 * honest purposes only — (a) sensible defaults (handled at the UI layer when a
 * user adds a holding) and (b) a mismatch WARNING when the modeled mix is more
 * volatile than the stated comfort. This computes (b). It never blocks.
 */
export interface ToleranceAssessment {
  stated: RiskTolerance | null;
  comfortVolCeilingPct: number | null;
  modeledVolPct: number;
  /** True when modeled portfolio vol exceeds the stated comfort ceiling. */
  exceedsComfort: boolean;
  /** How far over the ceiling (pp), 0 when within or no tolerance stated. */
  gapPct: number;
}

export function assessToleranceMismatch(opts: {
  stated: RiskTolerance | null | undefined;
  modeledVolPct: number;
}): ToleranceAssessment {
  const stated = (RISK_TOLERANCES as readonly string[]).includes(opts.stated ?? "")
    ? (opts.stated as RiskTolerance)
    : null;
  const modeledVolPct = Math.max(0, Number(opts.modeledVolPct) || 0);
  if (!stated) {
    return { stated: null, comfortVolCeilingPct: null, modeledVolPct, exceedsComfort: false, gapPct: 0 };
  }
  const ceiling = RISK_TOLERANCE_SPECS[stated].comfortVolCeilingPct;
  const exceeds = modeledVolPct > ceiling;
  return {
    stated,
    comfortVolCeilingPct: ceiling,
    modeledVolPct,
    exceedsComfort: exceeds,
    gapPct: exceeds ? round2(modeledVolPct - ceiling) : 0,
  };
}

/* ───────────────────── Risk-aware concentration brake ─────────────────── */

/**
 * A risk-aware concentration flag: too much of the RISKY sleeve in a single
 * volatile name. Analogous to the bank issuer cap — an informed-risk flag the
 * user can acknowledge, never a block. The engine never silently favours the
 * highest-yield/highest-vol asset; this surfaces fragility so the user chooses.
 */
export interface VolatileConcentration {
  /** The single most concentrated risky holding's label. */
  name: string;
  /** Its share of the risky sleeve (0..1). */
  share: number;
  /** Its assumed volatility (%/yr). */
  volatilityPct: number;
  /** True when share exceeds the cap AND the name is materially volatile. */
  flagged: boolean;
}

/** Share of the risky sleeve in one name above which we caution. */
export const VOLATILE_NAME_CAP = 0.4;
/** Volatility (%) above which a name counts as "volatile" for the brake. */
export const VOLATILE_VOL_FLOOR = 12;

export function assessVolatileConcentration(
  holdings: { name: string; valueKes: number; volatilityPct: number }[],
  cap = VOLATILE_NAME_CAP,
): VolatileConcentration | null {
  const risky = holdings.filter((h) => h.valueKes > 0 && h.volatilityPct >= VOLATILE_VOL_FLOOR);
  const riskyTotal = risky.reduce((a, h) => a + h.valueKes, 0);
  if (riskyTotal <= 0) return null;
  let top = risky[0];
  for (const h of risky) if (h.valueKes > top.valueKes) top = h;
  const share = top.valueKes / riskyTotal;
  return {
    name: top.name,
    share: round2(share),
    volatilityPct: round2(top.volatilityPct),
    flagged: share > cap,
  };
}

/* ───────────────────── Class → group convenience ─────────────────────── */

/** The correlation group a class defaults to (used when no override stored). */
export function defaultGroupForClass(assetClass: AssetClass): CorrelationGroup {
  return DEFAULT_RISK_BY_CLASS[assetClass].correlationGroup;
}

/** True when a class is modeled as carrying material price risk. */
export function classIsRisky(assetClass: AssetClass): boolean {
  return profileFor(assetClass).priceDriven;
}

/* ───────────────────────── helpers ───────────────────────────────────── */

function numOrNull(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function round0(n: number): number {
  return Math.round(Number(n) || 0);
}
function round1(n: number): number {
  return Math.round((Number(n) || 0) * 10) / 10;
}
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
