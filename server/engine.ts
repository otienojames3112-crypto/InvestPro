import { tenorRateFromMap } from "../shared/securityTenor";
import {
  tbillPrice,
  zeroCouponPrice,
  whtOnDiscount,
  accretedValue,
} from "../shared/discount";
import {
  allocateLiquidReserve,
  type LiquidHome,
  type LiquidAllocationResult,
} from "../shared/liquidAllocator";
/**
 * KES Investment Compounding Engine — v3
 *
 * Tax treatment (Kenya, resident individuals — Income Tax Act Cap 470):
 *   - MMF interest:    15% WHT deducted at source (gross rate entered; engine applies WHT).
 *                      SanlamAllianz quotes a GROSS effective annual yield; WHT is applied here.
 *   - T-Bill discount: 15% WHT deducted at source; net discount flows to MMF at maturity.
 *   - IFB coupons:     Tax-exempt (all qualifying Infrastructure Bonds per Finance Act 2023;
 *                      the proposed 3-year tenor threshold was NOT enacted — all IFBs are exempt).
 *   - FXD coupons:     15% WHT deducted at source; gross rate stored, net applied here.
 *
 * Allocation rules by phase (proportional fractions of horizonMonths):
 *   Foundation    (~20%): MMF 50%, T-Bills 50%, IFB  0%, FXD  0%
 *   Growth        (~50%): MMF 20%, T-Bills 20%, IFB 45%, FXD 15%
 *   De-risking    (~15%): MMF 25%, T-Bills 35%, IFB 30%, FXD 10%
 *   Final liq.    (~15%): MMF 40%, T-Bills 45%, IFB 10%, FXD  5%
 *
 * Short-horizon strategy (horizonMonths < SHORT_HORIZON_THRESHOLD = 30):
 *   IFBs and long FXDs cannot mature in time. Strategy collapses to MMF + 91-day T-bills only.
 *   The plan becomes contribution-driven rather than return-driven.
 *
 * Key design decisions (v3, inherits v2):
 *   1. Fixed-income buckets (T-Bill, IFB, FXD) are held at FACE VALUE — they do NOT compound
 *      in place. Returns flow exclusively as cash (coupons / maturity proceeds) back into MMF.
 *      Only MMF compounds in place.
 *   2. Each security is tracked as an individual lot with its own issue month, tenor, and rate,
 *      so maturities and coupons fire on real per-lot dates.
 *   3. When actuals are provided, months before currentMonth are seeded from real deposit entries
 *      and logged securities; future months continue from the actual current balances.
 *   4. WHT is accumulated inside the engine and exposed per month.
 *   5. Sweep buys floor((mmf - safetyFloor) / 50000) lots per month, not just one.
 *   6. Horizon is variable (12–240 months). Phases are proportional fractions of the horizon.
 *   7. Backwards solver: given target, horizon, and rates, computes required startingContribution.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum horizon (months) for the full bond-ladder strategy.
 * Below this threshold, IFBs and long FXDs cannot mature in time, so the engine
 * collapses to MMF + 91-day T-bills only.
 */
export const SHORT_HORIZON_THRESHOLD = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RateSnapshot {
  effectiveDate: string; // YYYY-MM-DD
  mmfYield: number;
  tbill91Rate: number;
  tbill182Rate: number;
  tbill364Rate: number;
  ifbCouponRate: number;
  fxdCouponRate: number;
  withholdingTax: number;
}

/**
 * Phase fractions — must sum to 1.0.
 * finalLiquidityFrac is implied: 1 - foundation - growth - deRisking.
 */
export interface PhaseFractions {
  foundationFrac: number; // default 0.20
  growthFrac: number;     // default 0.50
  deRiskingFrac: number;  // default 0.15
  // finalLiquidityFrac = 1 - foundationFrac - growthFrac - deRiskingFrac (default 0.15)
}

export interface EngineSettings {
  /** Gross annual MMF yield % (e.g. 8.78). WHT applied internally. */
  mmfYield: number;
  tbill91Rate: number;
  tbill182Rate: number;
  tbill364Rate: number;
  /** Gross annual IFB coupon % (e.g. 12.5). Tax-exempt — no WHT. */
  ifbCouponRate: number;
  /** Gross annual FXD coupon % (e.g. 12.35). WHT applied internally → net ~10.5%. */
  fxdCouponRate: number;
  withholdingTax: number;
  startingContribution: number;
  stepUpAmount: number;
  stepUpMonths: number;
  safetyFloor: number;
  targetAmount: number;
  startDate?: string;
  /** Total plan duration in months. Default 120. */
  horizonMonths?: number;
  /** Phase fractions. Defaults: foundation 0.20, growth 0.50, deRisking 0.15. */
  phaseFractions?: PhaseFractions;
  /**
   * Round 40: optional per-tenor bond rate maps keyed by tenor-years string.
   * When a swept lot's tenor matches a key, that rate is used for its coupon;
   * otherwise the flat ifbCouponRate/fxdCouponRate applies (no behavior change
   * for portfolios that never set these maps).
   */
  ifbTenorRates?: Record<string, number> | null;
  fxdTenorRates?: Record<string, number> | null;
  /**
   * Round 62 — per-portfolio concentration caps (fractions, 0..1). These replace
   * the old hardcoded ISSUER_CONCENTRATION_CAP (0.25) and the sweep's
   * FAMILY_CONCENTRATION_CAP (0.6). Defaults preserve previous behaviour.
   *   issuerCapFrac — max share of net worth in any one issuer/institution.
   *   typeCapFrac   — max share of net worth in any one instrument family.
   */
  issuerCapFrac?: number;
  typeCapFrac?: number;
  /**
   * Round 62 — allocation policy. "balanced" (default) respects the caps and
   * diversifies liquid cash; "yield_first" relaxes the caps toward 100% and
   * concentrates in the highest net-yield home; "custom" uses the user-set caps.
   */
  allocationPolicy?: "balanced" | "yield_first" | "custom";
  /**
   * Time Machine (sandbox only): override for "today" as Unix-ms (UTC). When
   * provided, the engine treats this as the current date for the actual/projected
   * boundary, lot ages, maturity checks, and coupon timing — letting a simulated
   * clock fast-forward the ledger. Undefined = real clock (new Date()).
   */
  nowOverride?: number;
  /**
   * Round 73 — Time Machine rate-shock stress test. When set, every yield rate
   * (MMF + all CBK families) is shifted by `deltaPct` percentage points for any
   * projected month whose calendar date is on/after `effectiveDate` (YYYY-MM-DD).
   * WHT is never shocked. Rates are floored at 0. This models a CBK rate move
   * (e.g. -2%) from a chosen date so the user can stress projected RETURNS, not
   * just contributions. Months before the effective date keep their base rates.
   */
  rateShock?: { effectiveDate: string; deltaPct: number };
}

/**
 * Apply a Time Machine rate-shock to a resolved month's rate set. Shifts every
 * yield rate by `deltaPct` (floored at 0) when `monthIso >= effectiveDate`;
 * WHT is left untouched. Pure + exported for direct unit testing.
 */
export function applyRateShock<
  T extends Pick<
    EngineSettings,
    "mmfYield" | "tbill91Rate" | "tbill182Rate" | "tbill364Rate" | "ifbCouponRate" | "fxdCouponRate" | "withholdingTax"
  >,
>(rates: T, monthIso: string, shock?: { effectiveDate: string; deltaPct: number }): T {
  if (!shock || monthIso < shock.effectiveDate) return rates;
  const bump = (v: number) => Math.max(0, v + shock.deltaPct);
  return {
    ...rates,
    mmfYield: bump(rates.mmfYield),
    tbill91Rate: bump(rates.tbill91Rate),
    tbill182Rate: bump(rates.tbill182Rate),
    tbill364Rate: bump(rates.tbill364Rate),
    ifbCouponRate: bump(rates.ifbCouponRate),
    fxdCouponRate: bump(rates.fxdCouponRate),
  };
}

/** An individual security lot held in the DhowCSD portfolio. */
export interface SecurityLot {
  id: string;
  bucket: "tbill" | "ifb" | "fxd";
  faceValue: number;
  /** Month number (1-based) when this lot was issued / purchased. */
  issueMonth: number;
  /** Tenor in months (3, 6, 12 for T-bills; 6, 12, 24, … for bonds). */
  tenorMonths: number;
  /** Annual coupon rate % (gross). 0 for T-bills (discount instruments). */
  couponRate: number;
  /** True for IFB — coupon is tax-exempt. */
  isTaxExempt: boolean;
  /**
   * Round 42 — DISCOUNT MECHANICS. Cash actually paid up front for a discount
   * instrument (T-bill / zero-coupon). When > 0 and < faceValue, the lot is
   * modelled as a true discount instrument: buy deducts this price, the value
   * accretes price→face, and maturity pays face with WHT on the discount only.
   * For coupon bonds (FXD/IFB) and legacy lots without a recorded price this is
   * undefined and the lot keeps its par/face behaviour.
   */
  purchasePrice?: number;
  /** Round 42 — true for a zero-coupon bond (long-dated discount instrument). */
  isZeroCoupon?: boolean;
}

export interface MonthlyContributionOverride {
  monthNumber: number;
  overrideAmount?: number;
  lumpSum?: number;
}

/**
 * A secondary MMF account held alongside the primary fund.
 * Each is projected forward independently using its own net yield, starting
 * balance, and monthly contribution, then folded into the portfolio total.
 */
export interface SecondaryMmfInput {
  /** Stable identifier (db row id), used only for traceability. */
  id?: number;
  /** Display label. */
  label?: string;
  /** Current balance (KES) at the start of the projection. */
  currentBalance: number;
  /** Monthly contribution assigned to this fund (KES). 0 if none. */
  monthlyContribution: number;
  /**
   * Gross effective annual yield % for this fund (e.g. 12.0). WHT is applied
   * inside the engine — matching how the primary MMF treats its fund EAR.
   */
  ear: number;
  /**
   * WHT % applied to this fund's interest. Defaults to the portfolio WHT when omitted.
   */
  whtRate?: number;
}

/** Actual deposit entry from the database (for actuals-seeded projection). */
export interface ActualDeposit {
  bucket: "mmf" | "tbill" | "ifb" | "fxd";
  amount: number;
  /** ISO date string YYYY-MM-DD */
  depositDate: string;
  /**
   * Destination of the deposit. Mirrors the destination-aware deposit fields
   * added in Round 17. When omitted, the deposit is attributed to the primary
   * plan via its `bucket` (legacy behaviour).
   *   - "mmf_fund"           → primary or secondary MMF fund (see mmfFundId)
   *   - "government_security"→ a T-bill/IFB/FXD lot held at face value
   *   - "bank_instrument"    → a bank call/fixed deposit (tracked separately)
   */
  institutionType?: "mmf_fund" | "government_security" | "bank_instrument" | null;
  /** Fund id when institutionType is "mmf_fund". Used to detect secondary-fund deposits. */
  mmfFundId?: number | null;
  /** Bank holding id when institutionType is "bank_instrument". */
  bankHoldingId?: number | null;
}

/**
 * A bank instrument holding (call / fixed deposit) tracked as a live actual.
 * During elapsed (actual) months it accrues simple interest on its principal
 * using its own rate, WHT, and day-count, on the same monthly footing as the
 * primary MMF, so identical money grows identically regardless of pocket.
 */
export interface ActualBankHolding {
  /** Optional display label, used in plain-language ledger maturity narration. */
  label?: string | null;
  /** Bank name, used as a fallback label in the ledger. */
  bankName?: string | null;
  principal: number;
  /** Gross annual interest rate % (WHT applied internally). */
  interestRate: number;
  /** WHT % applied to this holding's interest. Defaults to portfolio WHT. */
  whtRate?: number | null;
  /** Day-count basis (365 or 360). Defaults to 365. */
  dayCountBasis?: number | null;
  /** ISO date the holding started accruing (YYYY-MM-DD). */
  startDate?: string | null;
  isActive?: boolean;
  /**
   * Bank instrument kind. Determines whether the holding is TERM (matures and
   * pays out — fixed_deposit, target_savings) or LIQUID (accrues in place, no
   * maturity lock — call_deposit, ordinary_savings, tiered_savings).
   */
  instrumentType?:
    | "call_deposit"
    | "fixed_deposit"
    | "ordinary_savings"
    | "target_savings"
    | "tiered_savings"
    | null;
  /** Tenor in months for term deposits (fixed/goal). null/0 for liquid deposits. */
  tenorMonths?: number | null;
  /** ISO maturity date (term deposits). When present it drives the maturity month. */
  maturityDate?: string | null;
  /** Payout cadence. "maturity" = principal+interest returns at maturity. */
  payoutFrequency?: "maturity" | "monthly" | "quarterly" | "on_call" | null;
  /**
   * Round 31 — what the engine does with a TERM deposit at maturity:
   *   "redeploy" (default) → cash returns to the MMF for the yield-max allocator.
   *   "rollover"           → auto-renew the same tenor at the same rate.
   */
  maturityAction?: "redeploy" | "rollover" | null;
  /** Early-break penalty (% of accrued interest forfeited) if broken before maturity. */
  earlyBreakPenaltyPct?: number | null;
}

/** Actual security from the database (for actuals-seeded projection). */
export interface ActualSecurity {
  securityType:
    | "tbill_91"
    | "tbill_182"
    | "tbill_364"
    | "ifb"
    | "fxd"
    | "zero_coupon"
    | "floating_rate";
  faceValue: number;
  issueDate: string;
  maturityDate: string;
  couponRate: number;
  isTaxExempt: boolean;
  isMatured: boolean;
  /** Round 42 — cash paid for a discount instrument (T-bill / zero-coupon). */
  purchasePrice?: number | null;
  /** Round 42 — discount/yield rate used to price a discount instrument (%). */
  discountRate?: number | null;
  /** Round 42 — floating-rate bond: margin over the 91-day benchmark (%). */
  marginRate?: number | null;
  /** Round 42 — floating-rate bond: months between coupon resets. */
  resetMonths?: number | null;
}

/**
 * Round 61: structured per-event maturity breakdown so the Ledger can render
 * principal vs final coupon (or discount) as distinct lines, instead of parsing
 * the narration string. One entry per security/deposit that matured this month.
 */
export interface MaturityBreakdown {
  /** Instrument family that matured. */
  kind: "tbill" | "ifb" | "fxd" | "bank";
  /** Human-readable label, e.g. "24-month FXD" or a bank deposit name. */
  label: string;
  /** Principal / face value returned (KES). */
  principal: number;
  /** Final coupon paid at maturity, net of any tax (KES). 0 for discount/bank. */
  finalCoupon: number;
  /** Net discount earned (KES) for discount instruments (T-bills). 0 otherwise. */
  discount: number;
  /** Net interest returned (KES) for bank term deposits / legacy lots. 0 otherwise. */
  interest: number;
  /** Total cash returned to the MMF (KES). */
  total: number;
  /** Tax note, e.g. "tax-exempt" or "net of 15% tax". */
  taxNote: string;
}

export interface MonthResult {
  monthNumber: number;
  contribution: number;
  cbkCashIn: number;
  mmfToDhow: number;
  mainAction: string;
  mmfEnd: number;
  tbillEnd: number;
  /** Round 39: T-bill balance split by tenor so the ledger can show 91/182/364. */
  tbill91End: number;
  tbill182End: number;
  tbill364End: number;
  ifbEnd: number;
  /** Round 39: dominant IFB tenor band (years) held at month-end, 0 when none. */
  ifbTenorYears: number;
  fxdEnd: number;
  totalEnd: number;
  /** Combined projected balance of all secondary MMF accounts this month. */
  secondaryMmfEnd: number;
  /** Combined projected balance of all bank instrument holdings this month. */
  bankEnd: number;
  /** Cash returned to the MMF this month by a maturing bank term deposit. */
  bankCashIn: number;
  phase: "foundation" | "growth" | "de-risking" | "final-liquidity";
  sweepTarget: "tbill" | "ifb" | "fxd" | null;
  /** Total WHT withheld this month (MMF + T-Bill + FXD). */
  whtThisMonth: number;
  /** True if this month's data comes from actual deposits/securities. */
  isActual: boolean;
  /**
   * R77: only meaningful on settled (actual) months. True when the recorded
   * reality diverged from the plan — a skipped, under-funded, or over-funded
   * contribution, or a sweep the plan projected that the real balance couldn't
   * fund. Drives the ledger's quiet "off-plan" row marker. Always false on
   * forward (projected) rows.
   */
  offPlan: boolean;
  /** True when the short-horizon strategy is active (MMF + T-bills only). */
  isShortHorizon: boolean;
  /**
   * Why each instrument was chosen this month — the net-of-tax yield ranking the
   * allocator evaluated, plus which families actually received the sweep. Null on
   * months with no sweep. Drives the Ledger "why this instrument" tooltip.
   */
  sweepRationale: SweepRationale | null;
  /**
   * Round 61: structured breakdown of every maturity this month (principal vs
   * final coupon / discount / interest). Empty when nothing matured. Drives the
   * Ledger "CBK In" maturity-detail popover.
   */
  maturityBreakdown: MaturityBreakdown[];
}

export interface SweepRationaleCandidate {
  bucket: "tbill" | "ifb" | "fxd";
  label: string;
  grossPct: number;
  netPct: number;
  taxNote: string;
  /** 1-based rank by net-of-tax yield (1 = highest). */
  rank: number;
  /** True if this family actually received part of the sweep this month. */
  chosen: boolean;
}

export interface SweepRationale {
  /** Total amount swept out of the MMF this month (KES). */
  amount: number;
  /** Net-yield-ranked candidates the allocator compared. */
  candidates: SweepRationaleCandidate[];
  /** Plain-language one-liner summarising the decision. */
  summary: string;
}

export interface YearMilestone {
  year: number;
  month: number;
  projectedTotal: number;
  minHealthyCheckpoint: number;
  /**
   * The fraction of projectedTotal used as the min-healthy checkpoint for THIS
   * row (0.9 in foundation/growth, 0.95 once de-risking/final-liquidity begins).
   * Exposed so the UI can label the actual fraction instead of a flat "90%".
   */
  checkpointFrac: number;
  label: string;
}

export interface ScenarioResult {
  stepUp: number;
  finalMonthlySaving: number;
  totalContributed: number;
  projectedEndingValue: number;
  hitsTarget: boolean;
}

/**
 * Result of the backwards solver.
 */
export interface SolverResult {
  /** Whether a feasible solution was found within the contribution cap. */
  feasible: boolean;
  /** Required starting contribution (KES/month). */
  requiredStartingContribution: number;
  /** Step-up amount used (same as input, or 0 if no step-up). */
  stepUpAmount: number;
  /** Projected ending value at the required contribution. */
  projectedEndingValue: number;
  /** Total contributions over the horizon. */
  totalContributed: number;
  /** Shortfall if infeasible (how much more is needed at the cap). */
  shortfall: number;
  /** Whether the target is contribution-driven (short horizon). */
  isShortHorizon: boolean;
  /** Message explaining the result. */
  message: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SCENARIO_STEPUPS = [0, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000];

/**
 * Build a dynamic step-up ladder that is relevant to THIS portfolio rather than a
 * fixed 0–5,000 spread. The ladder always:
 *   - starts at 0 (the "no step-up" baseline),
 *   - includes the user's current step-up exactly (so their plan is on the chart),
 *   - spreads sensibly around and beyond the current value so larger plans
 *     (e.g. +79,000) are covered, not capped at 5,000.
 * For small/zero current step-ups it falls back to the classic small-grid feel.
 * Returns a sorted, de-duplicated, non-negative integer ladder of ~9 points.
 */
export function deriveStepUps(currentStepUp: number): number[] {
  const cur = Math.max(0, Math.round(currentStepUp || 0));
  // For a small current step-up, keep the familiar fine-grained low-end grid
  // but still guarantee the current value is present.
  if (cur <= 5000) {
    const base = [0, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
    const set = new Set<number>([...base, cur]);
    return Array.from(set).filter((n) => n >= 0).sort((a, b) => a - b);
  }
  // For larger step-ups, build a spread centered on the current value:
  // 0, then a ladder from ~0.4x to ~1.6x of current in even steps, including cur.
  const lo = Math.round(cur * 0.4);
  const hi = Math.round(cur * 1.6);
  const points = new Set<number>([0, cur]);
  const steps = 7; // interior points
  for (let i = 0; i <= steps; i++) {
    const v = Math.round(lo + ((hi - lo) * i) / steps);
    points.add(Math.max(0, v));
  }
  return Array.from(points).sort((a, b) => a - b);
}

/** Maximum starting contribution the solver will try before declaring infeasible. */
const SOLVER_MAX_CONTRIBUTION = 1_000_000;

const DEFAULT_SETTINGS_FOR_MILESTONES: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.8206,
  tbill182Rate: 8.7782,
  tbill364Rate: 8.9746,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  startDate: "2026-07-01",
  horizonMonths: 120,
};

/**
 * The fixed lot size used by the monthly CBK sweep. Every gov-security purchase
 * is a whole multiple of this; the MMF must keep at least one lot's worth of
 * liquidity plus a working buffer before sweeping.
 */
export const SWEEP_LOT_SIZE = 50000;

/**
 * Auto-derive a sensible MMF safety floor from the user's contribution level and
 * the sweep lot size — so the user does not have to set it by hand. The floor is
 * the larger of (a) one sweep lot (you must always be able to keep a lot's worth
 * liquid) and (b) ~2 months of the current monthly contribution (a short working
 * buffer), rounded UP to a whole sweep lot for clean sweeps. The user may still
 * override it explicitly; this only supplies the default.
 */
export function deriveSafetyFloor(
  monthlyContribution: number,
  lotSize: number = SWEEP_LOT_SIZE,
  bufferMonths = 2,
): number {
  const byContribution = Math.max(0, monthlyContribution) * bufferMonths;
  const raw = Math.max(lotSize, byContribution);
  // Round up to a whole lot so the sweep arithmetic stays clean.
  return Math.ceil(raw / lotSize) * lotSize;
}

// ─── Phase helpers ────────────────────────────────────────────────────────────

/**
 * Compute the absolute month boundaries for each phase given horizon and fractions.
 * Returns { foundationEnd, growthEnd, deRiskingEnd } — all inclusive upper bounds.
 * finalLiquidityEnd = horizonMonths.
 */
export function getPhaseBoundaries(
  horizonMonths: number,
  fractions?: PhaseFractions
): { foundationEnd: number; growthEnd: number; deRiskingEnd: number } {
  const f = fractions ?? { foundationFrac: 0.20, growthFrac: 0.50, deRiskingFrac: 0.15 };
  const foundationEnd = Math.round(horizonMonths * f.foundationFrac);
  const growthEnd = Math.round(horizonMonths * (f.foundationFrac + f.growthFrac));
  const deRiskingEnd = Math.round(horizonMonths * (f.foundationFrac + f.growthFrac + f.deRiskingFrac));
  return { foundationEnd, growthEnd, deRiskingEnd };
}

/**
 * Determine the phase for a given month number, using proportional boundaries.
 */
export function getPhase(
  month: number,
  horizonMonths = 120,
  fractions?: PhaseFractions
): "foundation" | "growth" | "de-risking" | "final-liquidity" {
  const { foundationEnd, growthEnd, deRiskingEnd } = getPhaseBoundaries(horizonMonths, fractions);
  if (month <= foundationEnd) return "foundation";
  if (month <= growthEnd) return "growth";
  if (month <= deRiskingEnd) return "de-risking";
  return "final-liquidity";
}

/** Net annual yield after WHT. Net = Gross × (1 − WHT/100). */
export function netYield(grossPct: number, whtPct: number): number {
  return grossPct * (1 - whtPct / 100);
}

/** Monthly compounding factor from a net annual yield percentage. */
export function monthlyRate(netAnnualPct: number): number {
  return Math.pow(1 + netAnnualPct / 100, 1 / 12) - 1;
}

/**
 * Compute the engine's elapsed-month index (`currentMonth`) for a given clock
 * instant, mirroring the exact formula runProjection uses internally. Exposed so
 * the Time Machine can ask "how many whole months have elapsed at boundary X?"
 * with the same month-granularity arithmetic the projection boundary uses.
 */
export function computeCurrentMonth(
  startDateIso: string,
  nowMs: number,
  horizonMonths: number,
): number {
  const startDate = new Date((startDateIso ?? new Date().toISOString().split("T")[0]) + "T12:00:00Z");
  const today = new Date(nowMs);
  const monthsSinceStart = Math.floor(
    (today.getFullYear() - startDate.getFullYear()) * 12 +
    (today.getMonth() - startDate.getMonth()),
  );
  return Math.max(0, Math.min(monthsSinceStart, horizonMonths));
}

export function getScheduledContribution(
  monthNumber: number,
  settings: Pick<EngineSettings, "startingContribution" | "stepUpAmount" | "stepUpMonths">
): number {
  const stepIndex = Math.floor((monthNumber - 1) / settings.stepUpMonths);
  return settings.startingContribution + stepIndex * settings.stepUpAmount;
}

export function getRatesForMonth(
  monthDate: Date,
  rateHistory: RateSnapshot[],
  currentSettings: EngineSettings
): Pick<EngineSettings, "mmfYield" | "tbill91Rate" | "tbill182Rate" | "tbill364Rate" | "ifbCouponRate" | "fxdCouponRate" | "withholdingTax"> {
  const monthStr = monthDate.toISOString().split("T")[0];
  let base: Pick<
    EngineSettings,
    "mmfYield" | "tbill91Rate" | "tbill182Rate" | "tbill364Rate" | "ifbCouponRate" | "fxdCouponRate" | "withholdingTax"
  >;
  if (!rateHistory || rateHistory.length === 0) {
    base = currentSettings;
  } else {
    const sorted = [...rateHistory].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    const snapshot = sorted.find(s => s.effectiveDate <= monthStr);
    base = snapshot ?? currentSettings;
  }
  // Round 73 — apply the Time Machine rate-shock (if any) on/after its date.
  return applyRateShock(base, monthStr, currentSettings.rateShock);
}

/**
 * Determine the sweep target for a given month, rotating through the phase allocation.
 * Returns the bucket name and the tenor (in months) to use for the new lot.
 * When isShortHorizon is true, always returns 91-day T-bills.
 */
export function getSweepTargetForMonth(
  month: number,
  sweepCountInPhase: number,
  horizonMonths = 120,
  fractions?: PhaseFractions,
  isShortHorizon = false
): { bucket: "tbill" | "ifb" | "fxd"; tenorMonths: number } | null {
  if (isShortHorizon) {
    return { bucket: "tbill", tenorMonths: 3 };
  }

  const phase = getPhase(month, horizonMonths, fractions);

  switch (phase) {
    case "foundation":
      return { bucket: "tbill", tenorMonths: 12 };

    case "growth": {
      const cycle = sweepCountInPhase % 16;
      if (cycle < 4) return { bucket: "tbill", tenorMonths: 12 };
      if (cycle < 13) return { bucket: "ifb", tenorMonths: 12 };
      return { bucket: "fxd", tenorMonths: 12 };
    }

    case "de-risking": {
      const cycle = sweepCountInPhase % 15;
      if (cycle < 7) return { bucket: "tbill", tenorMonths: 6 };
      if (cycle < 13) return { bucket: "ifb", tenorMonths: 12 };
      return { bucket: "fxd", tenorMonths: 12 };
    }

    case "final-liquidity":
      return { bucket: "tbill", tenorMonths: 3 };

    default:
      return null;
  }
}

/**
 * Target NON-MMF bucket weights by phase, as fractions of the investable base
 * (everything except the MMF safety floor). These mirror the documented plan:
 *   Foundation:      MMF 50 / Tbill 50 / IFB  0 / FXD  0
 *   Growth:          MMF 20 / Tbill 20 / IFB 45 / FXD 15
 *   De-risking:      MMF 25 / Tbill 35 / IFB 30 / FXD 10
 *   Final liquidity: MMF 40 / Tbill 45 / IFB 10 / FXD  5
 * Short-horizon plans use MMF + 91-day T-bills only.
 */
export function getPhaseAllocation(
  phase: "foundation" | "growth" | "de-risking" | "final-liquidity",
  isShortHorizon = false
): { mmf: number; tbill: number; ifb: number; fxd: number } {
  if (isShortHorizon) return { mmf: 0.5, tbill: 0.5, ifb: 0, fxd: 0 };
  switch (phase) {
    case "foundation":
      return { mmf: 0.5, tbill: 0.5, ifb: 0.0, fxd: 0.0 };
    case "growth":
      return { mmf: 0.2, tbill: 0.2, ifb: 0.45, fxd: 0.15 };
    case "de-risking":
      return { mmf: 0.25, tbill: 0.35, ifb: 0.3, fxd: 0.1 };
    case "final-liquidity":
      return { mmf: 0.4, tbill: 0.45, ifb: 0.1, fxd: 0.05 };
    default:
      return { mmf: 0.5, tbill: 0.5, ifb: 0, fxd: 0 };
  }
}

/** Tenor (months) to use for a freshly-swept lot of each bucket, by phase. */
function tenorFor(
  bucket: "tbill" | "ifb" | "fxd",
  phase: string,
  isShortHorizon: boolean
): number {
  if (bucket === "ifb") return 24; // IFBs are long instruments
  if (bucket === "fxd") return 24; // FXD coupon bonds
  // T-bills: 364-day in growth/foundation, 182-day de-risking, 91-day final/short
  if (isShortHorizon || phase === "final-liquidity") return 3;
  if (phase === "de-risking") return 6;
  return 12;
}

/**
 * Number of whole months before the horizon in which NO new securities may be
 * bought — surplus must accumulate in MMF instead. The investor needs CASH at
 * the goal date, so even a 91-day (3-month) bill bought this close would mature
 * after the deadline. Defined as min(3, ceil(horizon/4)) so very short plans
 * still get a sensible no-buy tail without freezing the whole horizon.
 */
export function noBuyTailMonths(horizonMonths: number): number {
  return Math.min(3, Math.max(1, Math.ceil(horizonMonths / 4)));
}

/**
 * END-STATE LIQUIDITY RULE (the core principle of a goal-dated plan).
 *
 * Decide whether a sweep is allowed in month `m`, and if so the LONGEST T-bill
 * tenor (months) whose maturity still lands on or before the horizon. We never
 * buy an instrument that matures after the goal date — at the deadline the
 * investor needs cash, not paper maturing later.
 *
 * Returns:
 *   - allowed=false when m is inside the no-buy tail, OR no tenor fits.
 *   - maxTbillTenor: the longest of {12,6,3} months that satisfies
 *                    m + tenor <= horizon (progressively shortens near the end:
 *                    364 → 182 → 91 → none).
 *   - allowLongBonds: true only when a 24-month bond would still mature by the
 *                     horizon (i.e. m + 24 <= horizon). Otherwise IFB/FXD are
 *                     disallowed and their intended share folds into T-bills.
 */
export function liquidityGuardForMonth(
  m: number,
  horizonMonths: number,
): { allowed: boolean; maxTbillTenor: 0 | 3 | 6 | 12; allowLongBonds: boolean } {
  const tail = noBuyTailMonths(horizonMonths);
  // Final stretch: stop sweeping entirely, accumulate in MMF.
  if (m > horizonMonths - tail) {
    return { allowed: false, maxTbillTenor: 0, allowLongBonds: false };
  }
  const monthsLeft = horizonMonths - m; // months remaining after this month
  let maxTbillTenor: 0 | 3 | 6 | 12 = 0;
  if (monthsLeft >= 12) maxTbillTenor = 12;
  else if (monthsLeft >= 6) maxTbillTenor = 6;
  else if (monthsLeft >= 3) maxTbillTenor = 3;
  else maxTbillTenor = 0;
  const allowLongBonds = monthsLeft >= 24;
  return { allowed: maxTbillTenor > 0, maxTbillTenor, allowLongBonds };
}

/**
 * NET-OF-TAX YIELD RANKING (Round 28).
 *
 * For a given month's rates and the tenors the liquidity guard currently permits,
 * compute the effective NET annual yield of each auto-investable CBK family and
 * return them ranked highest-first. This is the basis of the yield-maximizing
 * sweep: within what end-state liquidity allows, deploy toward the family that
 * keeps the most money after tax.
 *   - T-bill: discount taxed at WHT; we score the LONGEST permitted tenor (its
 *             364/182/91-day rate) since longer bills generally yield more and the
 *             guard already caps tenor so nothing matures past the goal.
 *   - IFB:    coupon is TAX-EXEMPT, so its gross rate is its net rate — usually the
 *             top of the table. Only available when long bonds still fit (allowLongBonds).
 *   - FXD:    coupon taxed at WHT. Only available when long bonds still fit.
 * Returns an array of { bucket, grossPct, netPct, tenorMonths, label } sorted by netPct desc.
 */
export interface RankedInstrument {
  bucket: "tbill" | "ifb" | "fxd";
  grossPct: number;
  netPct: number;
  tenorMonths: number;
  label: string;
  taxNote: string;
}

/**
 * SOVEREIGN-PREFERENCE THRESHOLD (Round 30, EDITABLE).
 *
 * Government-backed instruments (T-bills, IFBs, FXD bonds) carry sovereign credit
 * backing that bank deposits do not. When a bank deposit's net-of-tax yield
 * advantage over the best government instrument is smaller than this threshold
 * (percentage points), the allocator PREFERS the government instrument anyway.
 * Set to 1.0pp by the plan brief; expose/raise/lower to taste.
 */
export const SOVEREIGN_PREFERENCE_THRESHOLD_PCT = 1.0;

/**
 * PER-ISSUER (BANK) CONCENTRATION CAP (Round 30, EDITABLE).
 *
 * For credit-risk diversification, no single bank/issuer may exceed this share of
 * the whole portfolio. Government securities are sovereign and EXEMPT from this
 * cap (they have their own 60% family cap for liquidity balance). 25% per the brief.
 */
export const ISSUER_CONCENTRATION_CAP = 0.25;

/**
 * EARLY-BREAK "WHAT-IF" (Round 31).
 *
 * Computes what an investor nets if they break a TERM deposit (fixed/goal
 * savings) TODAY instead of holding it to maturity. Breaking early forfeits a
 * share of the interest accrued so far (the bank's early-break penalty) on top
 * of giving up all future interest. Pure function — exported for the holding
 * card and for unit testing.
 *
 * @param principal        Original principal placed (KES).
 * @param accruedInterest  Net interest accrued to date (KES, after WHT).
 * @param valueAtMaturity  Projected net value if held to maturity (KES).
 * @param penaltyPct        Early-break penalty as a % of accrued interest forfeited.
 */
export interface EarlyBreakWhatIf {
  /** Cash available now if broken early (principal + retained interest). */
  netIfBrokenNow: number;
  /** Interest forfeited by breaking early (penalty + any future interest given up). */
  interestForfeited: number;
  /** The penalty amount charged on accrued interest. */
  penaltyAmount: number;
  /** What you keep instead by holding to maturity. */
  valueAtMaturity: number;
  /** Cost of breaking early vs holding (valueAtMaturity - netIfBrokenNow). */
  costOfBreaking: number;
}

export function earlyBreakWhatIf(
  principal: number,
  accruedInterest: number,
  valueAtMaturity: number,
  penaltyPct: number,
): EarlyBreakWhatIf {
  const safePrincipal = Math.max(0, principal);
  const safeAccrued = Math.max(0, accruedInterest);
  const penaltyFrac = Math.min(1, Math.max(0, penaltyPct / 100));
  const penaltyAmount = safeAccrued * penaltyFrac;
  const retainedInterest = safeAccrued - penaltyAmount;
  const netIfBrokenNow = safePrincipal + retainedInterest;
  const matValue = Math.max(netIfBrokenNow, valueAtMaturity);
  return {
    netIfBrokenNow: Math.round(netIfBrokenNow * 100) / 100,
    interestForfeited: Math.round((matValue - netIfBrokenNow) * 100) / 100,
    penaltyAmount: Math.round(penaltyAmount * 100) / 100,
    valueAtMaturity: Math.round(matValue * 100) / 100,
    costOfBreaking: Math.round((matValue - netIfBrokenNow) * 100) / 100,
  };
}

/**
 * PER-ISSUER CONCENTRATION DETECTION (Round 31).
 *
 * Given each issuer's current value and the whole-portfolio net worth, return the
 * issuers whose share exceeds ISSUER_CONCENTRATION_CAP (default 25%). Government
 * securities are sovereign and excluded by the caller. Pure + unit-testable.
 */
export interface IssuerConcentration {
  issuer: string;
  value: number;
  share: number; // 0..1
}

export function detectIssuerConcentration(
  issuerValues: { issuer: string; value: number }[],
  netWorth: number,
  cap: number = ISSUER_CONCENTRATION_CAP,
): IssuerConcentration[] {
  if (netWorth <= 0) return [];
  // Aggregate by issuer name (case-insensitive) so multiple deposits at the same
  // bank are summed before testing the cap.
  const byIssuer = new Map<string, { issuer: string; value: number }>();
  for (const iv of issuerValues) {
    const key = iv.issuer.trim().toLowerCase();
    const prev = byIssuer.get(key);
    if (prev) prev.value += iv.value;
    else byIssuer.set(key, { issuer: iv.issuer.trim(), value: iv.value });
  }
  const out: IssuerConcentration[] = [];
  for (const { issuer, value } of Array.from(byIssuer.values())) {
    const share = value / netWorth;
    if (share > cap) out.push({ issuer, value, share });
  }
  return out.sort((a, b) => b.share - a.share);
}

/**
 * Apply the sovereign-preference tie-break to a net-yield-ranked candidate list.
 * Bank candidates (bucket "bank") are demoted below a government candidate when
 * their net-yield advantage is within SOVEREIGN_PREFERENCE_THRESHOLD_PCT. Pure
 * government-only lists are returned unchanged. Exported for direct unit testing.
 */
export function applySovereignPreference<T extends { bucket: string; netPct: number }>(
  ranked: T[],
  thresholdPct: number = SOVEREIGN_PREFERENCE_THRESHOLD_PCT,
): T[] {
  const isGov = (b: string) => b === "tbill" || b === "ifb" || b === "fxd";
  const bestGovNet = Math.max(
    -Infinity,
    ...ranked.filter((r) => isGov(r.bucket)).map((r) => r.netPct),
  );
  if (!Number.isFinite(bestGovNet)) return ranked;
  // Stable re-sort: a bank candidate only beating gov by < threshold sorts after gov.
  return [...ranked].sort((a, b) => {
    const aBankClose = a.bucket === "bank" && a.netPct - bestGovNet < thresholdPct;
    const bBankClose = b.bucket === "bank" && b.netPct - bestGovNet < thresholdPct;
    if (aBankClose && !bBankClose) return 1;
    if (!aBankClose && bBankClose) return -1;
    return b.netPct - a.netPct;
  });
}

export function rankInstrumentsByNetYield(
  rates: Pick<EngineSettings, "tbill91Rate" | "tbill182Rate" | "tbill364Rate" | "ifbCouponRate" | "fxdCouponRate" | "withholdingTax">,
  opts: { maxTbillTenor: 0 | 3 | 6 | 12; allowLongBonds: boolean; longBondTenorMonths?: number },
): RankedInstrument[] {
  const out: RankedInstrument[] = [];
  const wht = rates.withholdingTax;
  // T-bill at the longest permitted tenor.
  if (opts.maxTbillTenor > 0) {
    const t = opts.maxTbillTenor;
    const gross = tbillRateForTenor(t, rates);
    out.push({
      bucket: "tbill",
      grossPct: gross,
      netPct: netYield(gross, wht),
      tenorMonths: t,
      label: tenorLabel("tbill", t),
      taxNote: `${wht}% WHT on discount`,
    });
  }
  if (opts.allowLongBonds) {
    const bondTenor = opts.longBondTenorMonths ?? 24;
    // IFB — tax exempt: net == gross.
    out.push({
      bucket: "ifb",
      grossPct: rates.ifbCouponRate,
      netPct: rates.ifbCouponRate,
      tenorMonths: bondTenor,
      label: tenorLabel("ifb", bondTenor),
      taxNote: "tax-exempt",
    });
    // FXD — coupon taxed.
    out.push({
      bucket: "fxd",
      grossPct: rates.fxdCouponRate,
      netPct: netYield(rates.fxdCouponRate, wht),
      tenorMonths: bondTenor,
      label: tenorLabel("fxd", bondTenor),
      taxNote: `${wht}% WHT on coupon`,
    });
  }
  return out.sort((a, b) => b.netPct - a.netPct);
}

/** Join a list into plain English: [a] -> "a"; [a,b] -> "a and b"; [a,b,c] -> "a, b and c". */
export function joinWithAnd(parts: string[]): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
}

/** Capitalise the first character of a string. */
export function capitalise(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/** Lower-case the first character of a string (for mid-sentence joins). */
export function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLowerCase() + s.slice(1);
}

/**
 * R75 — tense-aware Main Action. The ledger narration is written in the
 * present/future tense for months that are still ahead of the clock ("Move…",
 * "a 182-day T-bill matures…", "Add this month's saving…"). Once a month has
 * settled into actual (the simulated/real clock has passed it), the same phrase
 * should read as something that already happened. This switches only the finite
 * set of verbs the builder above can emit, so it stays accurate and natural
 * regardless of which branch produced the string. Idempotent on already-past
 * phrases (e.g. bank "Placed…/matured…" wording is left untouched).
 */
export function pastTensifyMainAction(s: string): string {
  return s
    .replace(/\bMove KES/g, "Moved KES")
    .replace(/ matures at /g, " matured at ")
    .replace(/ matures,/g, " matured,")
    .replace(/ matures;/g, " matured;")
    .replace(/ matures /g, " matured ")
    .replace(/ pays a /g, " paid a ")
    .replace(/\bAdd KES/g, "Added KES")
    .replace(/Add this month's saving/g, "Added this month's saving");
}

/**
 * How a settled month's REAL contribution compared to what the step-up schedule
 * had planned for it. Drives both the past-tense saving clause and the row's
 * off-plan marker. "none" means there was nothing planned and nothing recorded.
 */
export type ContributionDivergence = "matched" | "skipped" | "under" | "over" | "none";

export interface ActualSavingClause {
  /** Past-tense narration of what was (or wasn't) saved vs the plan. */
  text: string;
  divergence: ContributionDivergence;
}

/** Rounding tolerance (KES) within which actual ≈ planned counts as "matched". */
export const CONTRIBUTION_MATCH_TOLERANCE = 1;

const kesInt = (n: number) => Math.round(n).toLocaleString();

/**
 * Build the past-tense saving clause for a SETTLED (actual) month by comparing
 * the real recorded contribution against the originally-planned amount.
 *
 *  - matched  : "Added KES 20,000 of savings to the MMF"
 *  - skipped  : "No contribution recorded this month (KES 20,000 was planned)"
 *  - under    : "Added KES 12,000 to the MMF — KES 8,000 short of the KES 20,000 planned"
 *  - over     : "Added KES 60,000 to the MMF — KES 40,000 above the KES 20,000 planned"
 *
 * `planned <= 0` with no actual yields "none" (nothing was expected). The caller
 * composes maturities/sweeps around this clause; this function only narrates the
 * contribution leg.
 */
export function buildActualSavingClause(actual: number, planned: number): ActualSavingClause {
  const a = Math.max(0, actual);
  const p = Math.max(0, planned);
  const diff = a - p;

  if (p <= CONTRIBUTION_MATCH_TOLERANCE && a <= CONTRIBUTION_MATCH_TOLERANCE) {
    return { text: "", divergence: "none" };
  }
  if (Math.abs(diff) <= CONTRIBUTION_MATCH_TOLERANCE) {
    return {
      text: `Added KES ${kesInt(a)} of savings to the MMF`,
      divergence: "matched",
    };
  }
  if (a <= CONTRIBUTION_MATCH_TOLERANCE) {
    return {
      text: `No contribution recorded this month (KES ${kesInt(p)} was planned)`,
      divergence: "skipped",
    };
  }
  if (diff < 0) {
    return {
      text: `Added KES ${kesInt(a)} to the MMF — KES ${kesInt(-diff)} short of the KES ${kesInt(p)} planned`,
      divergence: "under",
    };
  }
  return {
    text: `Added KES ${kesInt(a)} to the MMF — KES ${kesInt(diff)} above the KES ${kesInt(p)} planned`,
    divergence: "over",
  };
}

/**
 * Narration used when the plan projected a sweep into securities for a settled
 * month but the REAL MMF balance couldn't fund it (e.g. the contribution was
 * skipped). Date-driven maturities are unaffected and narrate separately.
 */
export const UNEXECUTED_SWEEP_NOTE =
  "no sweep this month — MMF balance below the sweep threshold after the missed contribution";


/** Human-readable tenor label for a swept lot, e.g. "364-day T-bill". */
export function tenorLabel(bucket: "tbill" | "ifb" | "fxd", tenorMonths: number): string {
  if (bucket === "tbill") {
    if (tenorMonths <= 3) return "91-day T-bill";
    if (tenorMonths <= 6) return "182-day T-bill";
    return "364-day T-bill";
  }
  if (bucket === "ifb") return `${tenorMonths}-month IFB`;
  return `${tenorMonths}-month FXD`;
}

/** The gross T-bill rate that matches a lot's tenor (91/182/364-day). */
export function tbillRateForTenor(
  tenorMonths: number,
  rates: Pick<EngineSettings, "tbill91Rate" | "tbill182Rate" | "tbill364Rate">,
): number {
  if (tenorMonths <= 3) return rates.tbill91Rate;
  if (tenorMonths <= 6) return rates.tbill182Rate;
  return rates.tbill364Rate;
}

/**
 * Standard day-count for a T-bill tenor band (91 / 182 / 364 days). Used to price
 * swept T-bill lots with the same tbillPrice() helper the recorded path uses, so a
 * swept and a recorded bill of the same tenor are modelled identically (Round 43).
 */
export function tbillDaysForTenor(tenorMonths: number): number {
  if (tenorMonths <= 3) return 91;
  if (tenorMonths <= 6) return 182;
  return 364;
}

/**
 * 1-based month offset of a given ISO date relative to the plan start date.
 * Month 1 = the start month. Returns null when the date is missing/invalid.
 * A date before the start date clamps to 1; the caller decides further clamping.
 */
export function monthOffsetFromStart(
  isoDate: string | null | undefined,
  startDate: Date
): number | null {
  if (!isoDate) return null;
  const d = new Date(isoDate.split("T")[0] + "T12:00:00Z");
  if (isNaN(d.getTime())) return null;
  const offset =
    (d.getFullYear() - startDate.getFullYear()) * 12 +
    (d.getMonth() - startDate.getMonth());
  return offset + 1; // 1-based: the start month is month 1
}

// ─── Main projection engine ───────────────────────────────────────────────────

/**
 * Run the full projection simulation for horizonMonths months.
 *
 * @param settings         - Rate and plan settings (horizonMonths defaults to 120).
 * @param overrides        - Per-month contribution overrides.
 * @param rateHistory      - Historical rate snapshots for time-locked per-month rates.
 * @param actualDeposits   - Real deposit entries (for actuals-seeded mode).
 * @param actualSecurities - Real securities from the register (for actuals-seeded mode).
 * @param secondaryMmfs    - Secondary MMF accounts projected alongside the primary.
 * @param bankHoldings     - Bank call/fixed deposits tracked as live actuals.
 * @param primaryFundId    - Id of the portfolio's primary MMF fund. Deposits whose
 *                           mmfFundId differs (secondary funds) or whose destination
 *                           is a bank instrument are excluded from the primary MMF so
 *                           their balances are not double-counted.
 */
export function runProjection(
  settings: EngineSettings,
  overrides: MonthlyContributionOverride[] = [],
  rateHistory: RateSnapshot[] = [],
  actualDeposits: ActualDeposit[] = [],
  actualSecurities: ActualSecurity[] = [],
  secondaryMmfs: SecondaryMmfInput[] = [],
  bankHoldings: ActualBankHolding[] = [],
  primaryFundId: number | null = null
): MonthResult[] {
  const horizonMonths = settings.horizonMonths ?? 120;
  const isShortHorizon = horizonMonths < SHORT_HORIZON_THRESHOLD;
  const fractions = settings.phaseFractions;

  // ── Round 62: effective concentration caps + allocation policy ──
  // The per-family sweep cap (typeCapFrac) replaces the old hardcoded 0.6, and
  // the per-issuer cap replaces the old hardcoded 0.25. In "yield_first" mode we
  // relax the family cap toward 100% so the engine concentrates in the highest
  // net-yield family, per the user's acknowledged policy.
  const allocationPolicy = settings.allocationPolicy ?? "balanced";
  const baseTypeCapFrac =
    typeof settings.typeCapFrac === "number" && settings.typeCapFrac > 0
      ? settings.typeCapFrac
      : 0.6;
  const effectiveFamilyCapFrac =
    allocationPolicy === "yield_first" ? 1 : baseTypeCapFrac;

  const overrideMap = new Map<number, MonthlyContributionOverride>();
  for (const o of overrides) overrideMap.set(o.monthNumber, o);

  const startDate = new Date(
    (settings.startDate ?? new Date().toISOString().split("T")[0]) + "T12:00:00Z"
  );
  const today = settings.nowOverride != null ? new Date(settings.nowOverride) : new Date();
  const monthsSinceStart = Math.floor(
    (today.getFullYear() - startDate.getFullYear()) * 12 +
    (today.getMonth() - startDate.getMonth())
  );
  const currentMonth = Math.max(0, Math.min(monthsSinceStart, horizonMonths));
  const hasActuals = actualDeposits.length > 0 || actualSecurities.length > 0;

  const results: MonthResult[] = [];

  let mmf = 0;
  let lots: SecurityLot[] = [];
  let lotIdCounter = 0;
  let sweepCount = 0;
  let lastPhase = "";

  // Secondary MMF accounts: each projected forward independently from its own
  // current balance, using its own gross EAR (WHT applied here) and any monthly
  // contribution. Balances are folded into the portfolio total every month.
  const secondaryState = secondaryMmfs.map((s) => ({
    balance: s.currentBalance || 0,
    monthlyContribution: s.monthlyContribution || 0,
    ear: s.ear || 0,
    whtRate: s.whtRate,
  }));

  // ── Bank instrument holdings (live actuals → goal-directed capital) ──
  // Round 30: every bank holding is projected forward toward the goal, not parked
  // as a side balance. LIQUID kinds (call/ordinary/tiered savings) accrue in place
  // and stay withdrawable. TERM kinds (fixed_deposit, target/goal savings) accrue
  // to their maturity month, then return principal + final net interest to the MMF
  // where the yield-max allocator re-deploys the cash (see maturity handling in
  // the monthly loop). Each accrues monthly net interest on its own rate/WHT.
  const LIQUID_BANK_KINDS = new Set(["call_deposit", "ordinary_savings", "tiered_savings"]);
  const bankState = bankHoldings
    .filter((b) => b.isActive !== false)
    .map((b) => {
      const kind = b.instrumentType ?? "call_deposit";
      const isLiquid = LIQUID_BANK_KINDS.has(kind);
      // Term deposits mature on their maturity date (preferred) or start+tenor.
      let maturityMonth: number | null = null;
      if (!isLiquid) {
        const fromDate = monthOffsetFromStart(b.maturityDate, startDate);
        if (fromDate != null) maturityMonth = fromDate;
        else if (b.tenorMonths && b.tenorMonths > 0) {
          const start = monthOffsetFromStart(b.startDate, startDate) ?? 1;
          maturityMonth = start + Math.round(b.tenorMonths);
        }
      }
      return {
        label: b.label ?? b.bankName ?? null,
        kind,
        isLiquid,
        balance: b.principal || 0,
        principal: b.principal || 0,
        interestRate: b.interestRate || 0,
        whtRate: b.whtRate ?? null,
        // Month offset (1-based) at which the holding begins accruing.
        startMonth: monthOffsetFromStart(b.startDate, startDate) ?? 1,
        // Forward month at which a term deposit matures (null = never matures).
        maturityMonth,
        // Tenor in months — needed to schedule the NEXT maturity when rolling over.
        tenorMonths: b.tenorMonths && b.tenorMonths > 0 ? Math.round(b.tenorMonths) : null,
        // Round 31: what to do with principal+interest at maturity.
        //   "redeploy" → cash to MMF, re-deployed by the yield-max sweep.
        //   "rollover" → auto-renew same tenor at same rate, staying in the bank.
        maturityAction: (b.maturityAction ?? "redeploy") as "redeploy" | "rollover",
        // Set true once a term deposit has matured and paid out into the MMF
        // (only used for the "redeploy" path; rollovers keep accruing).
        matured: false,
      };
    });

  // ── Per-month placement of actual primary-MMF deposits ──
  // Deposits attributed to the PRIMARY plan (primary MMF fund, or legacy bucket
  // "mmf" with no destination) are placed in the month they actually occurred so
  // they compound through the elapsed period exactly like the forward path.
  // Secondary-fund and bank-instrument deposits are EXCLUDED here because their
  // balances are represented by `secondaryState` / `bankState` respectively
  // (mirrors the double-counting rule in shared/actuals.ts:computeActualsTotals).
  const actualMmfByMonth = new Map<number, number>();

  if (hasActuals && currentMonth > 0) {
    for (const d of actualDeposits) {
      const dest = d.institutionType ?? null;
      // Government-security deposits become lots (handled below).
      if (dest === "government_security") continue;
      // Bank-instrument deposits are represented by bankState; skip.
      if (dest === "bank_instrument") continue;
      // Secondary-fund deposits are represented by secondaryState; skip.
      if (dest === "mmf_fund" && d.mmfFundId != null && primaryFundId != null && d.mmfFundId !== primaryFundId) {
        continue;
      }
      // Remaining: primary-MMF fund deposits, or legacy bucket==="mmf" with no
      // destination metadata. Only bucket==="mmf" lands in the MMF balance;
      // a legacy non-mmf bucket with no destination falls through to lots below.
      if (d.bucket === "mmf") {
        const offset = monthOffsetFromStart(d.depositDate, startDate) ?? 1;
        const placeMonth = Math.max(1, Math.min(offset, currentMonth));
        actualMmfByMonth.set(placeMonth, (actualMmfByMonth.get(placeMonth) ?? 0) + d.amount);
      }
    }
  }

  // ── Government-security lot seeding (Round 40 critical fix) ──
  // Government securities are sourced EXCLUSIVELY from the securities register
  // (the single source of truth). A government-security deposit auto-creates a
  // register row (see deposits.add in routers.ts), so we deliberately do NOT
  // build a lot from the deposit itself — that would double-count the holding.
  //
  // CRITICAL: this loop MUST run whenever there are recorded securities, even when
  // the plan starts in the current/future month (currentMonth === 0). A recorded
  // T-bill/IFB/FXD is a REAL holding that must be projected forward immediately —
  // it has to appear in the ledger from month 1, accrue, and mature on schedule.
  // It was previously nested under `hasActuals && currentMonth > 0`, which silently
  // dropped every register holding for a brand-new plan.
  for (const sec of actualSecurities) {
    if (sec.isMatured) continue;
    const issueDate = new Date(sec.issueDate + "T12:00:00Z");
    const matDate = new Date(sec.maturityDate + "T12:00:00Z");
    const issueMonthOffset = Math.floor(
      (issueDate.getFullYear() - startDate.getFullYear()) * 12 +
      (issueDate.getMonth() - startDate.getMonth())
    );
    const issueMonth = issueMonthOffset + 1;
    const tenorMonths = Math.round(
      (matDate.getFullYear() - issueDate.getFullYear()) * 12 +
      (matDate.getMonth() - issueDate.getMonth())
    );
    // Round 42: map the security type into the engine's internal family.
    //  - T-bills + zero-coupon  → "tbill" family (discount instruments)
    //  - IFB                    → "ifb"   family (tax-exempt coupon)
    //  - FXD + floating-rate    → "fxd"   family (taxable coupon)
    const isZero = sec.securityType === "zero_coupon";
    const isFloating = sec.securityType === "floating_rate";
    const isDiscountFamily = sec.securityType.startsWith("tbill") || isZero;
    const bucket: "tbill" | "ifb" | "fxd" =
      isDiscountFamily ? "tbill"
      : sec.securityType === "ifb" ? "ifb"
      : "fxd";

    // Round 42: determine the cash paid up front for discount instruments. Prefer
    // the explicitly recorded purchasePrice; otherwise derive it from the
    // discount rate (compound pricing for zero-coupon, simple for T-bills). For
    // coupon bonds and legacy lots without a price this stays undefined (par).
    let purchasePrice: number | undefined;
    if (isDiscountFamily) {
      if (sec.purchasePrice != null && Number(sec.purchasePrice) > 0) {
        purchasePrice = Number(sec.purchasePrice);
      } else if (sec.discountRate != null && Number(sec.discountRate) > 0) {
        const tenorDays = Math.max(
          1,
          Math.round((matDate.getTime() - issueDate.getTime()) / 86_400_000),
        );
        purchasePrice = isZero
          ? zeroCouponPrice(sec.faceValue, Number(sec.discountRate), tenorDays / 365)
          : tbillPrice(sec.faceValue, Number(sec.discountRate), tenorDays);
      }
    }

    lots.push({
      id: `actual-${lotIdCounter++}`,
      bucket,
      faceValue: sec.faceValue,
      issueMonth,
      tenorMonths,
      // Floating-rate bonds carry their CURRENT reset coupon in couponRate.
      couponRate: sec.couponRate,
      isTaxExempt: sec.isTaxExempt,
      ...(purchasePrice != null ? { purchasePrice } : {}),
      ...(isZero ? { isZeroCoupon: true } : {}),
    });
    void isFloating;
  }

  // Determine the last month at which new long bonds are allowed.
  // In the final-liquidity phase, only T-bills are swept.
  const { deRiskingEnd } = getPhaseBoundaries(horizonMonths, fractions);

  for (let m = 1; m <= horizonMonths; m++) {
    const monthDate = new Date(startDate);
    monthDate.setMonth(monthDate.getMonth() + (m - 1));

    const rates = getRatesForMonth(monthDate, rateHistory, settings);
    const wht = rates.withholdingTax / 100;

    const mmfNetAnnual = netYield(rates.mmfYield, rates.withholdingTax);
    const mmfMonthly = monthlyRate(mmfNetAnnual);

    const phase = getPhase(m, horizonMonths, fractions);
    const override = overrideMap.get(m);

    if (phase !== lastPhase) {
      sweepCount = 0;
      lastPhase = phase;
    }

    const isActualMonth = hasActuals && m <= currentMonth;

    let contribution = 0;
    let whtThisMonth = 0;

    if (!isActualMonth) {
      // Forward (future) months: scheduled contribution + overrides flow to MMF.
      const scheduled = getScheduledContribution(m, settings);
      contribution = override?.overrideAmount !== undefined ? override.overrideAmount : scheduled;
      const lumpSum = override?.lumpSum ?? 0;
      contribution += lumpSum;
      mmf += contribution;
    } else {
      // Elapsed (actual) months: place this month's REAL primary-MMF deposits in
      // the month they actually occurred (Fix #4), so the actual-period curve is
      // correct, not just the endpoint. `contribution` reflects real money in.
      contribution = actualMmfByMonth.get(m) ?? 0;
      mmf += contribution;
    }

    // Primary MMF compounds EVERY month — actual and forward alike (Fix #3, #5).
    // During actual months the real deposits accrue interest through the elapsed
    // period exactly as the forward projection would, so the projected balance at
    // "today" matches the daily-accrual ledger for the same deposits.
    {
      const interestGross = mmf * monthlyRate(rates.mmfYield);
      const interestWHT = interestGross * wht;
      whtThisMonth += interestWHT;
      mmf = mmf * (1 + mmfMonthly);
    }

    // ── Secondary MMF accounts ──
    // Each is contribution-driven plus its own net compounding. We always
    // accrue/contribute (even in actuals-seeded months) because these balances
    // are tracked separately from the primary plan's deposit ledger.
    //
    // Unified accounting basis (Fix #5): `currentBalance` is the balance AS OF
    // TODAY. During elapsed (actual) months we hold each secondary balance flat
    // (no extra contribution, no layered interest) so the projected total at
    // "today" equals the dashboard's principal-only figure. From the forward
    // period onward, each fund contributes monthly and compounds on its net EAR,
    // exactly on the same monthly footing as the primary MMF.
    let secondaryMmfEnd = 0;
    for (const sec of secondaryState) {
      if (sec.balance === 0 && sec.monthlyContribution === 0) continue;
      if (!isActualMonth) {
        const secWhtPct = sec.whtRate ?? rates.withholdingTax;
        const secWht = secWhtPct / 100;
        // Add this fund's own monthly contribution.
        sec.balance += sec.monthlyContribution;
        // Compound on the fund's gross EAR, then withhold tax on the interest.
        const grossInterest = sec.balance * monthlyRate(sec.ear);
        const netInterest = grossInterest * (1 - secWht);
        whtThisMonth += grossInterest * secWht;
        sec.balance += netInterest;
      }
      secondaryMmfEnd += sec.balance;
    }

    // ── Bank instrument holdings (goal-directed capital) ──
    // Unified rule: principal is held flat through elapsed (actual) months (so the
    // "today" total equals recorded principal), then accrues simple monthly
    // interest on its own rate/WHT/day-count going forward.
    //   - LIQUID kinds (call/ordinary/tiered savings): accrue in place, never
    //     mature, stay withdrawable — they remain in the bank pocket (bankEnd).
    //   - TERM kinds (fixed_deposit, target/goal savings): accrue until their
    //     maturity month, then return PRINCIPAL + accrued net interest to the MMF
    //     and are re-deployed by the yield-max sweep below. This is what makes a
    //     maturing bank deposit goal-directed capital rather than a side balance.
    let bankEnd = 0;
    let bankMaturedCashIn = 0;
    const bankMaturityActions: string[] = [];
    const bankMaturityBreakdown: MaturityBreakdown[] = [];
    const bankPlacementActions: string[] = [];
    for (const b of bankState) {
      if (b.matured) continue;
      if (b.balance === 0) continue;
      const bWhtPct = b.whtRate ?? rates.withholdingTax;
      const bWht = bWhtPct / 100;

      // Placement narration: in the FORWARD month the deposit first appears
      // (its startMonth, or month 1 for an opening holding), state where the
      // principal came from so a layperson can trace every shilling.
      if (!isActualMonth && m === b.startMonth) {
        const placeKind =
          b.kind === "fixed_deposit" ? "fixed deposit"
          : b.kind === "target_savings" ? "goal/target savings"
          : b.kind === "call_deposit" ? "call deposit"
          : "savings deposit";
        const whoPlace = b.label ? `${b.label} ${placeKind}` : `a ${placeKind}`;
        const tenorPart =
          !b.isLiquid && b.maturityMonth != null
            ? `, maturing ${(() => { const d = new Date(startDate); d.setMonth(d.getMonth() + (b.maturityMonth - 1)); return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" }); })()}`
            : "";
        bankPlacementActions.push(
          `Placed KES ${Math.round(b.principal).toLocaleString()} in ${whoPlace} at ${b.interestRate}%${tenorPart}`
        );
      }

      // Accrue this month's net interest on the forward path.
      if (!isActualMonth && m >= b.startMonth) {
        const grossInterest = b.balance * (b.interestRate / 100) / 12;
        const netInterest = grossInterest * (1 - bWht);
        whtThisMonth += grossInterest * bWht;
        b.balance += netInterest;
      }

      // Term-deposit maturity: in the forward maturity month, either roll over
      // (auto-renew, staying in the bank) or redeploy (return to the MMF).
      if (!isActualMonth && !b.isLiquid && b.maturityMonth != null && m >= b.maturityMonth) {
        const payout = b.balance;
        const interestPortion = Math.max(0, payout - b.principal);
        const niceKind =
          b.kind === "fixed_deposit" ? "fixed deposit"
          : b.kind === "target_savings" ? "goal/target savings"
          : "bank deposit";
        const who = b.label ? `${b.label} ${niceKind}` : `a ${niceKind}`;

        if (b.maturityAction === "rollover" && b.tenorMonths && b.tenorMonths > 0) {
          // Auto-renew: principal+interest becomes the new principal for a fresh
          // term at the same rate. The deposit keeps accruing in the bank and the
          // next maturity is scheduled one tenor later.
          b.principal = payout;
          b.maturityMonth = b.maturityMonth + b.tenorMonths;
          bankMaturityActions.push(
            `${who} matured and auto-rolled over KES ${Math.round(payout).toLocaleString()} into a fresh ${b.tenorMonths}-month term at ${b.interestRate}% (principal + KES ${Math.round(interestPortion).toLocaleString()} net interest reinvested)`
          );
          bankEnd += b.balance; // stays in the bank pocket
          continue;
        }

        // Default: redeploy to the MMF for the yield-max allocator.
        bankMaturedCashIn += payout;
        b.matured = true;
        b.balance = 0;
        bankMaturityActions.push(
          `${who} matured, returning KES ${Math.round(payout).toLocaleString()} to the MMF (KES ${Math.round(b.principal).toLocaleString()} principal + KES ${Math.round(interestPortion).toLocaleString()} net interest)`
        );
        bankMaturityBreakdown.push({
          kind: "bank",
          label: who,
          principal: Math.round(b.principal * 100) / 100,
          finalCoupon: 0,
          discount: 0,
          interest: Math.round(interestPortion * 100) / 100,
          total: Math.round(payout * 100) / 100,
          taxNote: "net of tax",
        });
        continue; // do not add to bankEnd; the cash is now in the MMF
      }

      bankEnd += b.balance;
    }

    let cbkCashIn = 0;
    const cbkActions: string[] = [];
    const maturityBreakdown: MaturityBreakdown[] = [];
    const survivingLots: SecurityLot[] = [];

    for (const lot of lots) {
      const age = m - lot.issueMonth;

      if (age < 0) {
        survivingLots.push(lot);
        continue;
      }

      if (age === lot.tenorMonths) {
        if (lot.bucket === "tbill") {
          // ── DISCOUNT INSTRUMENT MATURITY (Round 42) ──────────────────────
          // A T-bill / zero-coupon is repaid its FACE value. The discount
          // (face − price) is the entire return, and WHT applies to that
          // discount only — never to the face. There is NO separate interest
          // line: the face IS principal + return rolled together.
          if (lot.purchasePrice != null && lot.purchasePrice > 0 && lot.purchasePrice < lot.faceValue) {
            const whtAmt = whtOnDiscount(lot.faceValue, lot.purchasePrice, wht * 100);
            const proceeds = lot.faceValue - whtAmt;
            const netGain = lot.faceValue - lot.purchasePrice - whtAmt;
            cbkCashIn += proceeds;
            whtThisMonth += whtAmt;
            cbkActions.push(
              `a ${tenorLabel(lot.bucket, lot.tenorMonths)} matures at its KES ${Math.round(lot.faceValue).toLocaleString()} face value, returning KES ${Math.round(proceeds).toLocaleString()} to the MMF (KES ${Math.round(netGain).toLocaleString()} net discount earned after ${rates.withholdingTax}% tax on the discount)`
            );
            maturityBreakdown.push({
              kind: "tbill",
              label: tenorLabel(lot.bucket, lot.tenorMonths),
              principal: Math.round(lot.purchasePrice * 100) / 100,
              finalCoupon: 0,
              discount: Math.round(netGain * 100) / 100,
              interest: 0,
              total: Math.round(proceeds * 100) / 100,
              taxNote: `net of ${rates.withholdingTax}% tax on the discount`,
            });
          } else {
            // Legacy lot without a recorded price: keep the previous behaviour
            // (face + separately-computed net discount) so older projections and
            // tests that seed face-only lots stay stable.
            cbkCashIn += lot.faceValue;
            const tenorYears = lot.tenorMonths / 12;
            const grossInterest = lot.faceValue * (tbillRateForTenor(lot.tenorMonths, rates) / 100) * tenorYears;
            const netInterest = grossInterest * (1 - wht);
            whtThisMonth += grossInterest * wht;
            cbkCashIn += netInterest;
            cbkActions.push(
              `a ${tenorLabel(lot.bucket, lot.tenorMonths)} matures, returning KES ${Math.round(lot.faceValue + netInterest).toLocaleString()} to the MMF (KES ${Math.round(netInterest).toLocaleString()} net interest after ${rates.withholdingTax}% tax)`
            );
            maturityBreakdown.push({
              kind: "tbill",
              label: tenorLabel(lot.bucket, lot.tenorMonths),
              principal: Math.round(lot.faceValue * 100) / 100,
              finalCoupon: 0,
              discount: 0,
              interest: Math.round(netInterest * 100) / 100,
              total: Math.round((lot.faceValue + netInterest) * 100) / 100,
              taxNote: `net of ${rates.withholdingTax}% tax`,
            });
          }
        } else {
          // ── COUPON-BOND MATURITY (Round 60) ──────────────────────────────
          // A coupon bond (IFB / FXD / floating-rate) returns its FACE value as
          // principal AND pays its FINAL coupon on the same date. By construction
          // the maturity month is always a coupon date (tenor is a multiple of the
          // 6-month coupon cadence), so the final coupon must be paid here. The
          // `continue` below guarantees the periodic coupon block does NOT also
          // fire this month, so the final coupon is paid exactly once.
          //   - IFB:            coupon is tax-exempt (gross = net).
          //   - FXD / floating: coupon is net of WHT.
          const grossFinalCoupon = (lot.couponRate / 100 / 2) * lot.faceValue;
          const netFinalCoupon = lot.isTaxExempt
            ? grossFinalCoupon
            : grossFinalCoupon * (1 - wht);
          if (!lot.isTaxExempt) whtThisMonth += grossFinalCoupon * wht;
          cbkCashIn += lot.faceValue + netFinalCoupon;
          const total = lot.faceValue + netFinalCoupon;
          const taxNote = lot.isTaxExempt ? "tax-exempt" : `net of ${rates.withholdingTax}% tax`;
          cbkActions.push(
            `a ${tenorLabel(lot.bucket, lot.tenorMonths)} matures, returning KES ${Math.round(lot.faceValue).toLocaleString()} principal + KES ${Math.round(netFinalCoupon).toLocaleString()} final coupon (${taxNote}) = KES ${Math.round(total).toLocaleString()} to the MMF`
          );
          maturityBreakdown.push({
            kind: lot.bucket === "ifb" ? "ifb" : "fxd",
            label: tenorLabel(lot.bucket, lot.tenorMonths),
            principal: Math.round(lot.faceValue * 100) / 100,
            finalCoupon: Math.round(netFinalCoupon * 100) / 100,
            discount: 0,
            interest: 0,
            total: Math.round(total * 100) / 100,
            taxNote,
          });
        }
        continue;
      }

      if ((lot.bucket === "ifb" || lot.bucket === "fxd") && age > 0 && age % 6 === 0) {
        const grossCoupon = (lot.couponRate / 100 / 2) * lot.faceValue;
        if (lot.isTaxExempt) {
          cbkCashIn += grossCoupon;
          cbkActions.push(`an IFB pays a KES ${Math.round(grossCoupon).toLocaleString()} coupon into the MMF (tax-exempt)`);
        } else {
          const netCoupon = grossCoupon * (1 - wht);
          whtThisMonth += grossCoupon * wht;
          cbkCashIn += netCoupon;
          cbkActions.push(`an FXD bond pays a KES ${Math.round(netCoupon).toLocaleString()} coupon into the MMF (after ${rates.withholdingTax}% tax)`);
        }
      }

      survivingLots.push(lot);
    }

    lots = survivingLots;
    // Matured term-deposit cash joins maturing-security cash in the MMF, where the
    // yield-max sweep below re-deploys it toward the goal (Round 30, R30.3).
    mmf += cbkCashIn;
    mmf += bankMaturedCashIn;

    let mmfToDhow = 0;
    let sweepTarget: "tbill" | "ifb" | "fxd" | null = null;
    // Per-bucket lot counts bought this month (for the ledger "main action" label).
    const sweepBuy = { tbill: 0, ifb: 0, fxd: 0 };
    // Net-yield ranking the allocator compared this month (for the ledger tooltip).
    let sweepRationale: SweepRationale | null = null;
    let rankedThisMonth: RankedInstrument[] = [];

    // ── END-STATE LIQUIDITY GUARD (Fix #1) ──
    // Decide what this month is allowed to buy so nothing matures after the
    // horizon. `tbillTenorThisMonth` is the longest tenor that still matures by
    // the goal date; `allowLongBonds` is false unless a 24-month bond fits.
    const guard = liquidityGuardForMonth(m, horizonMonths);
    // No new long bonds either in the final-liquidity phase (legacy rule) OR
    // whenever a 24-month bond would mature past the horizon (new rule).
    const noNewLongBonds = m > deRiskingEnd || !guard.allowLongBonds;
    const tbillTenorThisMonth = guard.maxTbillTenor;

    if (!isActualMonth && guard.allowed) {
      // ── SWEEP / ALLOCATION DECISION RULE (Fix #8) ──────────────────────────
      // The goal-driven sweep deploys surplus MMF cash according to three rules,
      // in priority order:
      //   (a) END-STATE LIQUIDITY (Fix #1): never buy an instrument that matures
      //       after the horizon. The liquidity guard caps the T-bill tenor and
      //       disables long bonds (IFB/FXD) as the goal date approaches, and stops
      //       sweeping entirely in the final stretch so the plan lands ~100% liquid.
      //   (b) HIGHEST NET-OF-TAX YIELD for the allowed tenor: within what the guard
      //       permits, the phase allocation tilts toward the higher net-yield CBK
      //       instruments (IFB tax-exempt, then FXD, then T-bills for liquidity).
      //   (c) NEVER LOCK PAST THE HORIZON: enforced by (a).
      //
      // BANK INSTRUMENTS (call/fixed deposits): these are modelled as user-tracked
      // ACTUALS rather than auto-bought by the projection. Their rates are
      // negotiated per bank/relationship (the reference data is explicitly
      // "indicative" and "negotiable"), so the deterministic engine does not invent
      // a negotiated rate to sweep into. Any bank deposit the user RECORDS accrues
      // on its own rate/WHT (see bankState above), counts toward the portfolio
      // total and the liquidity calendar, and — being mostly call deposits — is as
      // liquid as MMF. Call deposits therefore need no horizon guard; a recorded
      // fixed deposit maturing past the horizon is surfaced to the user (and an
      // early withdrawal forfeits interest via the withdrawals flow).
      //
      // Allocation-targeted sweep: deploy surplus TOWARD the phase's non-MMF bucket
      // mix instead of dumping the entire surplus into a single bucket. Each month
      // we size the desired KES in each non-MMF bucket from the phase weights, then
      // buy whole 50k lots to close the largest gaps without exceeding the surplus.
      const investableBase = mmf - settings.safetyFloor;
      const maxLots = Math.floor(investableBase / SWEEP_LOT_SIZE);

      if (maxLots > 0) {
        const alloc = getPhaseAllocation(phase, isShortHorizon);

        // Current KES already held in each non-MMF bucket (face value).
        const held = { tbill: 0, ifb: 0, fxd: 0 };
        for (const lot of lots) held[lot.bucket] += lot.faceValue;

        // Size targets against the WHOLE portfolio (MMF + all lots), so the phase
        // weights describe the end-state mix rather than just this month's surplus.
        // This keeps IFB/FXD from being starved by rolling T-bill maturities: their
        // gap stays open until they reach their share of the full portfolio.
        const portfolioTotal = mmf + held.tbill + held.ifb + held.fxd;
        const want = {
          tbill: alloc.tbill * portfolioTotal,
          ifb: alloc.ifb * portfolioTotal,
          fxd: alloc.fxd * portfolioTotal,
        };

        // Gap to close per bucket (never negative). In the final-liquidity phase,
        // do NOT add IFB/FXD — fold their intended share into T-bills.
        const gap = {
          tbill: Math.max(0, want.tbill - held.tbill),
          ifb: noNewLongBonds ? 0 : Math.max(0, want.ifb - held.ifb),
          fxd: noNewLongBonds ? 0 : Math.max(0, want.fxd - held.fxd),
        };
        if (noNewLongBonds) {
          gap.tbill += Math.max(0, want.ifb - held.ifb) + Math.max(0, want.fxd - held.fxd);
        }

        // ── YIELD-MAXIMIZING ORDER (Round 28) ──────────────────────────────
        // Fill the phase gaps in order of NET-OF-TAX YIELD (highest first) for the
        // instruments the liquidity guard currently permits, instead of a fixed
        // ifb→fxd→tbill order. IFB (tax-exempt) usually ranks top, but if FXD's
        // after-tax coupon or a long T-bill out-yields it for this month's rates,
        // money flows there first. A per-family CONCENTRATION CAP keeps any single
        // family from absorbing the whole surplus in one month.
        const ranked = rankInstrumentsByNetYield(rates, {
          maxTbillTenor: tbillTenorThisMonth,
          allowLongBonds: !noNewLongBonds,
          longBondTenorMonths: 24,
        });
        rankedThisMonth = ranked;
        // Concentration cap (Round 62): at most this share of the whole portfolio
        // in one family. Driven by the per-portfolio typeCapFrac setting, relaxed
        // to 100% under the Yield-first allocation policy.
        const capKES = (mmf + held.tbill + held.ifb + held.fxd) * effectiveFamilyCapFrac;
        let remaining = maxLots;
        // Order the three families by their net-yield rank for this month.
        const order = ranked.map((r) => r.bucket).filter((b) => gap[b] > 0);
        // Ensure tbill is always a fallback target even if it wasn't ranked above 0 gap.
        for (const b of [...order, "tbill" as const]) {
          if (remaining <= 0) break;
          if (sweepBuy[b] > 0 && order.includes(b)) continue; // already filled in ranked pass
          const headroomKES = Math.max(0, capKES - (held[b] + sweepBuy[b] * SWEEP_LOT_SIZE));
          const wantLots = Math.floor(Math.min(gap[b], headroomKES) / SWEEP_LOT_SIZE);
          const lotsForB = Math.min(remaining, wantLots);
          if (lotsForB > 0) {
            sweepBuy[b] += lotsForB;
            remaining -= lotsForB;
          }
        }
        // Any leftover affordable lots (rounding / capped families) go to T-bills
        // for liquidity — they are the most liquid CBK family and always permitted.
        if (remaining > 0) {
          sweepBuy.tbill += remaining;
          remaining = 0;
        }

        // ── DISCOUNT-AWARE SWEEP COST (Round 43, Fix #1) ───────────────────
        // A T-bill is BOUGHT BELOW FACE: the buyer pays a price < 50,000 and is
        // repaid the 50,000 face at maturity — the discount IS the return. So the
        // MMF must be debited the PRICE of each T-bill lot, not its face. Bonds
        // (IFB / FXD) are bought at par, so they still cost their full face.
        // We price each T-bill lot with the SAME tbillPrice() helper the recorded
        // path uses (engine line ~1084) so a swept and a recorded bill of the
        // same tenor are modelled identically.
        const tbillLotTenor = Math.min(tenorFor("tbill", phase, isShortHorizon), tbillTenorThisMonth || 3);
        const tbillLotPrice = tbillPrice(
          SWEEP_LOT_SIZE,
          tbillRateForTenor(tbillLotTenor, rates),
          tbillDaysForTenor(tbillLotTenor),
        );
        const totalLots = sweepBuy.tbill + sweepBuy.ifb + sweepBuy.fxd;
        // Cash actually leaving the MMF: T-bills at discount price, bonds at par.
        const totalSweepCost =
          sweepBuy.tbill * tbillLotPrice +
          (sweepBuy.ifb + sweepBuy.fxd) * SWEEP_LOT_SIZE;

        if (totalLots > 0 && mmf - totalSweepCost >= settings.safetyFloor) {
          mmf -= totalSweepCost;
          mmfToDhow = totalSweepCost;
          // Representative target for any single-target consumers (largest buy).
          sweepTarget = (["ifb", "fxd", "tbill"] as const).reduce(
            (a, b) => (sweepBuy[b] > sweepBuy[a] ? b : a),
            "tbill" as "tbill" | "ifb" | "fxd"
          );

          for (const b of ["tbill", "ifb", "fxd"] as const) {
            for (let i = 0; i < sweepBuy[b]; i++) {
              // T-bill tenor is capped by the liquidity guard so the lot always
              // matures on or before the horizon. Long bonds keep their phase
              // tenor (only reached when allowLongBonds was true).
              const lotTenor =
                b === "tbill"
                  ? tbillLotTenor
                  : tenorFor(b, phase, isShortHorizon);
              lots.push({
                id: `sim-${m}-${lotIdCounter++}`,
                bucket: b,
                faceValue: SWEEP_LOT_SIZE,
                issueMonth: m,
                tenorMonths: lotTenor,
                couponRate:
                  b === "ifb"
                    ? (tenorRateFromMap(settings.ifbTenorRates, lotTenor / 12) ?? rates.ifbCouponRate)
                    : b === "fxd"
                    ? (tenorRateFromMap(settings.fxdTenorRates, lotTenor / 12) ?? rates.fxdCouponRate)
                    : 0,
                isTaxExempt: b === "ifb",
                // T-bills carry the discount price so maturity credits face − WHT
                // on the discount (the SAME discount path recorded bills use).
                ...(b === "tbill" ? { purchasePrice: tbillLotPrice } : {}),
              });
            }
          }
          sweepCount++;

          // SWEEP RATIONALE (Round 29): persist the net-yield ranking the
          // allocator compared so the ledger can explain WHY each instrument was
          // chosen this month.
          const chosenBuckets = new Set(
            (["tbill", "ifb", "fxd"] as const).filter((b) => sweepBuy[b] > 0),
          );
          const candidates: SweepRationaleCandidate[] = rankedThisMonth.map((r, i) => ({
            bucket: r.bucket,
            label: r.label,
            grossPct: Math.round(r.grossPct * 100) / 100,
            netPct: Math.round(r.netPct * 100) / 100,
            taxNote: r.taxNote,
            rank: i + 1,
            chosen: chosenBuckets.has(r.bucket),
          }));
          const top = candidates.find((c) => c.chosen) ?? candidates[0];
          const familyName = (b: "tbill" | "ifb" | "fxd") =>
            b === "tbill" ? "T-bill" : b === "ifb" ? "IFB" : "FXD";
          let summary: string;
          if (top) {
            const beat = candidates.filter((c) => c.rank > top.rank);
            const beatTxt =
              beat.length > 0
                ? ` It out-yields ${joinWithAnd(
                    beat.map((c) => familyName(c.bucket) + " (" + c.netPct.toFixed(2) + "% net)"),
                  )} after tax.`
                : "";
            summary =
              "Chosen for the highest net-of-tax yield among instruments allowed to mature by your goal date: " +
              familyName(top.bucket) + " at " + top.netPct.toFixed(2) + "% net (" +
              top.grossPct.toFixed(2) + "% gross, " + top.taxNote + ")." + beatTxt +
              " The MMF safety floor is kept liquid and no single family exceeds 60% of the portfolio.";
          } else {
            summary =
              "Surplus above the MMF safety floor was swept into the highest net-of-tax instrument allowed to mature by your goal date.";
          }
          sweepRationale = {
            amount: Math.round(mmfToDhow * 100) / 100,
            candidates,
            summary,
          };
        }
      }
    }

    let tbillEnd = 0;
    let tbill91End = 0;
    let tbill182End = 0;
    let tbill364End = 0;
    let ifbEnd = 0;
    let fxdEnd = 0;
    // Round 39: track the largest IFB lot's tenor so the ledger shows the band.
    let ifbDominantFace = 0;
    let ifbTenorYears = 0;
    for (const lot of lots) {
      if (lot.bucket === "tbill") {
        const age = m - lot.issueMonth;
        let lotValue: number;
        if (lot.purchasePrice != null && lot.purchasePrice > 0 && lot.purchasePrice < lot.faceValue) {
          // ── DISCOUNT INSTRUMENT VALUE (Round 42) ─────────────────────────
          // The lot was bought BELOW face and accretes price→face as it ages,
          // never exceeding face. This is accretion (price pulled up to par),
          // not MMF-style compounding and not growth above face. The fraction
          // is elapsed/tenor, clamped to [0,1] inside accretedValue().
          const fraction = lot.tenorMonths > 0 ? age / lot.tenorMonths : 1;
          lotValue = accretedValue(lot.faceValue, lot.purchasePrice, fraction);
        } else {
          // Legacy face-based lot (no recorded price): preserve prior behaviour —
          // flat at face during elapsed months, accrue net discount above face
          // across the forward horizon only.
          const tenorYears = lot.tenorMonths / 12;
          const grossDiscount = lot.faceValue * (tbillRateForTenor(lot.tenorMonths, rates) / 100) * tenorYears;
          const netDiscount = grossDiscount * (1 - wht);
          const accruedDiscount = !isActualMonth && age > 0 ? netDiscount * (age / lot.tenorMonths) : 0;
          lotValue = lot.faceValue + accruedDiscount;
        }
        tbillEnd += lotValue;
        // Bucket by nearest standard tenor (91d≈3m, 182d≈6m, 364d≈12m).
        if (lot.tenorMonths <= 4) tbill91End += lotValue;
        else if (lot.tenorMonths <= 9) tbill182End += lotValue;
        else tbill364End += lotValue;
      } else if (lot.bucket === "ifb") {
        ifbEnd += lot.faceValue;
        if (lot.faceValue > ifbDominantFace) {
          ifbDominantFace = lot.faceValue;
          ifbTenorYears = Math.round((lot.tenorMonths / 12) * 10) / 10;
        }
      } else if (lot.bucket === "fxd") {
        fxdEnd += lot.faceValue;
      }
    }

    // Tenor used by T-bills bought THIS month (for the label) — the guard caps it.
    const sweptTbillTenor = Math.min(tenorFor("tbill", phase, isShortHorizon), tbillTenorThisMonth || 3);
    let mainAction = "";
    // ── PLAIN-LANGUAGE MAIN ACTION (Round 28) ──────────────────────────────
    // Describe each buy as a move FROM the MMF INTO a named instrument, with its
    // tenor and the calendar month it matures — e.g.
    // "Move KES 50,000 from the MMF into a 182-day T-bill maturing May 2027".
    const monthName = (offsetFromThis: number): string => {
      const d = new Date(startDate);
      d.setMonth(d.getMonth() + (m - 1) + offsetFromThis);
      return d.toLocaleDateString("en-GB", { month: "short", year: "numeric" });
    };
    const buyParts: string[] = [];
    if (sweepBuy.ifb > 0) {
      const t = tenorFor("ifb", phase, isShortHorizon);
      buyParts.push(`${sweepBuy.ifb === 1 ? "a" : sweepBuy.ifb + "×"} ${tenorLabel("ifb", t)} (tax-exempt) maturing ${monthName(t)}`);
    }
    if (sweepBuy.fxd > 0) {
      const t = tenorFor("fxd", phase, isShortHorizon);
      buyParts.push(`${sweepBuy.fxd === 1 ? "a" : sweepBuy.fxd + "×"} ${tenorLabel("fxd", t)} maturing ${monthName(t)}`);
    }
    if (sweepBuy.tbill > 0) {
      // T-bills are bought below face — note the face acquired so the investor sees
      // what matures, while the headline KES figure below is the cash actually paid.
      const faceAcquired = sweepBuy.tbill * SWEEP_LOT_SIZE;
      buyParts.push(`${sweepBuy.tbill === 1 ? "a" : sweepBuy.tbill + "×"} ${tenorLabel("tbill", sweptTbillTenor)} (KES ${faceAcquired.toLocaleString()} face) maturing ${monthName(sweptTbillTenor)}`);
    }
    const sweepDesc = mmfToDhow > 0
      ? `Move KES ${Math.round(mmfToDhow).toLocaleString()} from the MMF into ${joinWithAnd(buyParts)}`
      : "";
    // Maturities/coupons already arrive as plain phrases. Round 30: bank term
    // deposits maturing this month are narrated alongside CBK maturities so the
    // investor sees, month by month, exactly what matured and where it went.
    const maturityActions = [...cbkActions, ...bankMaturityActions];
    // Did any cash mature into the MMF this month (CBK or bank term deposit)?
    const maturedCashThisMonth = cbkCashIn + bankMaturedCashIn > 0;

    // R77 — off-plan tracking for SETTLED months: a settled row narrates what
    // REALLY happened (real deposit vs the planned step-up) and flags rows that
    // diverged so a scanner can spot them without reading every Main Action.
    let offPlan = false;

    if (isActualMonth) {
      // ── SETTLED MONTH (actuals) ──────────────────────────────────────────
      // Compose entirely from the materialized record: date-driven maturities
      // (which still occur regardless of contributions) + the real contribution
      // compared to what the plan had scheduled, and a note when a sweep the
      // plan would have made couldn't be funded by the real balance.
      const planned = getScheduledContribution(m, settings)
        + (override?.overrideAmount !== undefined ? override.overrideAmount - getScheduledContribution(m, settings) : 0)
        + (override?.lumpSum ?? 0);
      const saving = buildActualSavingClause(contribution, planned);
      offPlan = saving.divergence === "skipped" || saving.divergence === "under" || saving.divergence === "over";

      // Would the plan have swept this month, but the real balance couldn't fund
      // it? In a sweeping phase, had the planned contribution landed, the
      // investable surplus would have cleared one lot; with the real (skipped or
      // short) deposit it does not. Maturities are unaffected and narrate above.
      const actualSurplus = mmf - settings.safetyFloor;
      const plannedSurplus = mmf - contribution + planned - settings.safetyFloor;
      const sweepWouldHaveRun =
        guard.allowed &&
        (saving.divergence === "skipped" || saving.divergence === "under") &&
        plannedSurplus >= SWEEP_LOT_SIZE &&
        actualSurplus < SWEEP_LOT_SIZE;

      const clauses: string[] = [];
      if (maturityActions.length > 0) clauses.push(capitalise(maturityActions.join("; ")));
      if (saving.text) {
        clauses.push(maturityActions.length > 0 ? lowerFirst(saving.text) : saving.text);
      }
      if (sweepWouldHaveRun) {
        clauses.push(UNEXECUTED_SWEEP_NOTE);
        offPlan = true;
      }
      if (clauses.length === 0) {
        // Nothing planned and nothing recorded — a genuinely quiet month.
        clauses.push("No new saving recorded this month; balance kept in the MMF");
      }
      mainAction = clauses.join("; ");
    } else if (maturityActions.length > 0 && sweepDesc) {
      mainAction = `${capitalise(maturityActions.join("; "))}, then ${lowerFirst(sweepDesc)}`;
    } else if (maturityActions.length > 0) {
      // Cash matured but nothing was re-deployed — say so explicitly and why.
      mainAction = `${capitalise(maturityActions.join("; "))}; kept in the MMF (no instrument matures before your goal date)`;
    } else if (sweepDesc) {
      mainAction = sweepDesc;
    } else {
      mainAction = "Add this month's saving to the MMF; nothing swept into securities this month";
    }
    // Prepend any bank-deposit placement narration so the investor sees where a
    // newly-appearing bank balance came from (Round 35).
    if (bankPlacementActions.length > 0) {
      mainAction = `${capitalise(bankPlacementActions.join("; "))}. ${mainAction}`;
    }
    // R75 — a settled (actual) month already happened, so narrate it in the past
    // tense. Future months keep the present/future tense.
    if (isActualMonth) {
      mainAction = pastTensifyMainAction(mainAction);
    }
    // Silence unused-variable lints when no maturity occurred.
    void maturedCashThisMonth;

    const total = mmf + tbillEnd + ifbEnd + fxdEnd + secondaryMmfEnd + bankEnd;

    results.push({
      monthNumber: m,
      contribution,
      cbkCashIn:    Math.round(cbkCashIn    * 100) / 100,
      mmfToDhow:    Math.round(mmfToDhow    * 100) / 100,
      mainAction,
      mmfEnd:   Math.round(mmf     * 100) / 100,
      tbillEnd: Math.round(tbillEnd * 100) / 100,
      tbill91End:  Math.round(tbill91End  * 100) / 100,
      tbill182End: Math.round(tbill182End * 100) / 100,
      tbill364End: Math.round(tbill364End * 100) / 100,
      ifbEnd:   Math.round(ifbEnd   * 100) / 100,
      ifbTenorYears,
      fxdEnd:   Math.round(fxdEnd   * 100) / 100,
      totalEnd: Math.round(total    * 100) / 100,
      secondaryMmfEnd: Math.round(secondaryMmfEnd * 100) / 100,
      bankEnd: Math.round(bankEnd * 100) / 100,
      bankCashIn: Math.round(bankMaturedCashIn * 100) / 100,
      phase,
      sweepTarget,
      whtThisMonth: Math.round(whtThisMonth * 100) / 100,
      isActual: isActualMonth,
      offPlan,
      isShortHorizon,
      sweepRationale,
      maturityBreakdown: [...maturityBreakdown, ...bankMaturityBreakdown],
    });
  }

  return results;
}

// ─── R69.3: projected end-state liquid split ───────────────────────────────────

export interface ProjectedLiquidHomeInput {
  id: string;
  label: string;
  kind: LiquidHome["kind"];
  issuer: string;
  grossYieldPct: number;
  whtRatePct: number;
  minBalance?: number;
}

export interface ProjectedLiquidSplitResult extends LiquidAllocationResult {
  /** True when more than one eligible liquid home received a slice. */
  isSplit: boolean;
  /** Number of homes that end up holding a non-trivial slice (>= KES 1). */
  fundedHomeCount: number;
}

/**
 * Run the liquid-reserve allocator on the PROJECTED end-state liquid pot.
 *
 * At the horizon the De-risking / Final-liquidity phases have already drained the
 * term securities (T-bills / IFB / FXD) back into cash, so the projected liquid
 * pot is mmfEnd + secondaryMmfEnd + the liquid portion of bankEnd. We feed that
 * pot through the SAME `allocateLiquidReserve` used for today's actuals so the
 * Dashboard end-state copy reflects the real policy-aware split (Balanced /
 * Custom diversify; Yield-first may legitimately concentrate) rather than
 * assuming everything sits in the primary MMF.
 *
 * Pure and deterministic — does not mutate the projection.
 */
export function projectedLiquidSplit(
  finalMonth: MonthResult | undefined,
  homes: ProjectedLiquidHomeInput[],
  opts: {
    netWorth: number;
    issuerCapFrac?: number;
    safetyFloor?: number;
    allocationPolicy?: "balanced" | "yield_first" | "custom";
    /** Liquid pot to place. Defaults to mmfEnd + secondaryMmfEnd + bankEnd. */
    liquidPot?: number;
  },
): ProjectedLiquidSplitResult {
  const pot =
    typeof opts.liquidPot === "number"
      ? Math.max(0, opts.liquidPot)
      : Math.max(
          0,
          (finalMonth?.mmfEnd ?? 0) +
            (finalMonth?.secondaryMmfEnd ?? 0) +
            (finalMonth?.bankEnd ?? 0),
        );

  // Seed each home's starting balance to zero; the allocator distributes `pot`
  // across them by net yield and caps. The projection's per-home detail isn't
  // tracked month-by-month, so a clean redistribution of the pot is the right
  // model for the end-state target split.
  const allocHomes: LiquidHome[] = homes.map((h) => ({
    id: h.id,
    label: h.label,
    kind: h.kind,
    issuer: h.issuer,
    grossYieldPct: h.grossYieldPct,
    whtRatePct: h.whtRatePct,
    currentBalance: 0,
    minBalance: h.minBalance ?? 0,
  }));

  const result = allocateLiquidReserve({
    homes: allocHomes,
    netWorth: Math.max(opts.netWorth, pot),
    liquidPot: pot,
    issuerCapFrac: opts.issuerCapFrac,
    safetyFloor: opts.safetyFloor,
    allocationPolicy: opts.allocationPolicy ?? "balanced",
  });

  const fundedHomeCount = result.slices.filter((s) => s.targetBalance >= 1).length;
  return {
    ...result,
    fundedHomeCount,
    isSplit: fundedHomeCount > 1,
  };
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

export function runScenarios(
  baseSettings: EngineSettings,
  stepUps: number[] = SCENARIO_STEPUPS,
  rateHistory: RateSnapshot[] = [],
  secondaryMmfs: SecondaryMmfInput[] = [],
  bankHoldings: ActualBankHolding[] = [],
  primaryFundId: number | null = null
): ScenarioResult[] {
  const horizonMonths = baseSettings.horizonMonths ?? 120;
  return stepUps.map((stepUp) => {
    const settings = { ...baseSettings, stepUpAmount: stepUp };
    const results = runProjection(settings, [], rateHistory, [], [], secondaryMmfs, bankHoldings, primaryFundId);
    const last = results[results.length - 1];

    let totalContributed = 0;
    for (const r of results) totalContributed += r.contribution;

    return {
      stepUp,
      finalMonthlySaving:   getScheduledContribution(horizonMonths, settings),
      totalContributed:     Math.round(totalContributed),
      projectedEndingValue: last.totalEnd,
      hitsTarget:           last.totalEnd >= settings.targetAmount,
    };
  });
}

// ─── Milestones ───────────────────────────────────────────────────────────────

/**
 * Build a milestone narrative from the portfolio's PHASE at that month, so the
 * story matches any horizon (a 15-year plan no longer falls back to a generic
 * "Year N checkpoint" for years 11+). The phase is derived from the portfolio's
 * own phase fractions, not a hardcoded 10-year map.
 */
export function phaseMilestoneLabel(
  phase: "foundation" | "growth" | "de-risking" | "final-liquidity",
  isFinalYear: boolean,
): string {
  if (isFinalYear) {
    return "Goal stage. Most or all money should be liquid or near-liquid as you approach the target.";
  }
  switch (phase) {
    case "foundation":
      return "Foundation phase. Still building the base — do not worry if most money is still in the MMF and short T-bills.";
    case "growth":
      return "Growth phase. Coupons and reinvestment from IFBs and FXDs should start compounding noticeably.";
    case "de-risking":
      return "De-risking phase. Value should be shifting back toward T-bills and the MMF to lock in gains.";
    case "final-liquidity":
      return "Final-liquidity phase. Holdings should be mostly liquid or near-liquid, ready to draw down.";
  }
}

export function generateMilestones(
  settings?: EngineSettings,
  secondaryMmfs: SecondaryMmfInput[] = []
): YearMilestone[] {
  const s = settings ?? DEFAULT_SETTINGS_FOR_MILESTONES;
  const horizonMonths = s.horizonMonths ?? 120;
  const results = runProjection(s, [], [], [], [], secondaryMmfs);
  const milestones: YearMilestone[] = [];
  const totalYears = Math.floor(horizonMonths / 12);
  for (let year = 1; year <= totalYears; year++) {
    const month = year * 12;
    if (month > horizonMonths) break;
    const row = results.find(r => r.monthNumber === month);
    if (!row) continue;
    const projected = row.totalEnd;
    const phase = getPhase(month, horizonMonths, s.phaseFractions);
    // The healthy checkpoint is 90% in the early phases (more variance is fine
    // while building) and tightens to 95% once de-risking begins, since the
    // plan should be converging on target.
    const checkpointFrac = phase === "de-risking" || phase === "final-liquidity" ? 0.95 : 0.9;
    const isFinalYear = month === horizonMonths || (year === totalYears);
    milestones.push({
      year,
      month,
      projectedTotal: Math.round(projected),
      minHealthyCheckpoint: Math.round(projected * checkpointFrac),
      checkpointFrac,
      label: phaseMilestoneLabel(phase, isFinalYear),
    });
  }
  return milestones;
}

/** @deprecated Use generateMilestones(settings) directly. */
export function getYearMilestones(): YearMilestone[] {
  return generateMilestones();
}

/** @deprecated No-op — milestones are now generated per-portfolio on demand. */
export function invalidateMilestoneCache(): void {
  // no-op
}

/** @deprecated Backward compat — returns default 120-month milestones. */
export const YEAR_MILESTONES: YearMilestone[] = new Proxy([] as YearMilestone[], {
  get(_, prop) {
    const live = generateMilestones();
    if (prop === "length") return live.length;
    if (prop === Symbol.iterator) return live[Symbol.iterator].bind(live);
    if (typeof prop === "string" && !isNaN(Number(prop))) return live[Number(prop)];
    return (live as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export function checkMilestones(
  currentMonth: number,
  currentTotal: number,
  settings: EngineSettings,
  rateHistory: RateSnapshot[] = [],
  secondaryMmfs: SecondaryMmfInput[] = []
): {
  milestone: YearMilestone | null;
  status: "on-track" | "behind" | "ahead";
  gap: number;
  recommendation: string;
} {
  const milestones = generateMilestones(settings, secondaryMmfs);
  const rawMilestone = milestones.find((m) => m.month === currentMonth);
  if (!rawMilestone) {
    return { milestone: null, status: "on-track", gap: 0, recommendation: "" };
  }

  const milestone = rawMilestone;
  const gap = currentTotal - milestone.minHealthyCheckpoint;

  if (currentTotal >= milestone.projectedTotal) {
    return { milestone, status: "ahead", gap, recommendation: "You are ahead of schedule. Keep up the discipline!" };
  } else if (currentTotal >= milestone.minHealthyCheckpoint) {
    return { milestone, status: "on-track", gap, recommendation: "You are on track. Continue your regular contributions." };
  } else {
    const shortfall = milestone.minHealthyCheckpoint - currentTotal;
    return {
      milestone,
      status: "behind",
      gap: -shortfall,
      recommendation: `You are KES ${shortfall.toLocaleString()} below the healthy checkpoint. Consider increasing your next step-up by KES 1,000–2,000, adding a one-off lump sum, or giving the plan more time.`,
    };
  }
}

// ─── Backwards Solver ─────────────────────────────────────────────────────────

/**
 * Solve backwards: given a target, horizon, and rates, compute the required
 * starting contribution (and optional step-up) to reach the goal.
 *
 * Strategy:
 *   - Hold the step-up amount fixed (caller supplies it, or 0 for flat contributions).
 *   - Binary-search on startingContribution until month-horizonMonths total ≥ target.
 *   - If even SOLVER_MAX_CONTRIBUTION doesn't reach the target, report infeasible
 *     with the shortfall and what would be needed.
 *
 * @param settings   - Base settings (target, horizon, rates, step-up). startingContribution is ignored.
 * @param stepUpAmount - Step-up amount to use (0 = flat contributions).
 * @param rateHistory  - Rate history for time-locked projection.
 */
export function solveForContribution(
  settings: EngineSettings,
  stepUpAmount = 0,
  rateHistory: RateSnapshot[] = [],
  secondaryMmfs: SecondaryMmfInput[] = []
): SolverResult {
  const horizonMonths = settings.horizonMonths ?? 120;
  const isShortHorizon = horizonMonths < SHORT_HORIZON_THRESHOLD;
  const target = settings.targetAmount;

  const project = (startingContribution: number): number => {
    const s: EngineSettings = { ...settings, startingContribution, stepUpAmount };
    const results = runProjection(s, [], rateHistory, [], [], secondaryMmfs);
    return results[results.length - 1]?.totalEnd ?? 0;
  };

  // Quick feasibility check at the cap
  const atCap = project(SOLVER_MAX_CONTRIBUTION);
  if (atCap < target) {
    const shortfall = target - atCap;
    return {
      feasible: false,
      requiredStartingContribution: SOLVER_MAX_CONTRIBUTION,
      stepUpAmount,
      projectedEndingValue: atCap,
      totalContributed: 0,
      shortfall,
      isShortHorizon,
      message: `Target of KES ${target.toLocaleString()} is not achievable within ${horizonMonths} months even at KES ${SOLVER_MAX_CONTRIBUTION.toLocaleString()}/month. ` +
        `Shortfall: KES ${Math.round(shortfall).toLocaleString()}. ` +
        `Consider a longer horizon, a higher target tolerance, or a lower target.`,
    };
  }

  // Binary search: find minimum startingContribution that hits target
  let lo = 0;
  let hi = SOLVER_MAX_CONTRIBUTION;
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    if (project(mid) >= target) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  const requiredStartingContribution = Math.ceil(hi); // round up to nearest KES
  const projectedEndingValue = project(requiredStartingContribution);

  // Compute total contributed
  const s: EngineSettings = { ...settings, startingContribution: requiredStartingContribution, stepUpAmount };
  const results = runProjection(s, [], rateHistory, [], [], secondaryMmfs);
  let totalContributed = 0;
  for (const r of results) totalContributed += r.contribution;

  const shortHorizonNote = isShortHorizon
    ? ` Note: this is a short-horizon plan (${horizonMonths} months). The strategy uses MMF + 91-day T-bills only — returns are limited, so the result is primarily contribution-driven.`
    : "";

  const stepUpNote = stepUpAmount > 0
    ? ` with a KES ${stepUpAmount.toLocaleString()} step-up every ${settings.stepUpMonths ?? 6} months`
    : " (flat contributions, no step-up)";

  return {
    feasible: true,
    requiredStartingContribution,
    stepUpAmount,
    projectedEndingValue: Math.round(projectedEndingValue),
    totalContributed: Math.round(totalContributed),
    shortfall: 0,
    isShortHorizon,
    message: `To reach KES ${target.toLocaleString()} in ${horizonMonths} months, start at KES ${requiredStartingContribution.toLocaleString()}/month${stepUpNote}.${shortHorizonNote}`,
  };
}

// ─── Forward Step-Up Solver ───────────────────────────────────────────────────

/** Maximum step-up/period the solver will try before declaring infeasible. */
export const SOLVER_MAX_STEPUP = 500_000;

/** Recommended step-ups are rounded UP to the nearest this many KES for a clean figure. */
export const STEPUP_ROUNDING = 500;

export interface StepUpSolverResult {
  /** Whether a feasible step-up was found within the cap (given the fixed Month-1 contribution). */
  feasible: boolean;
  /** Recommended step-up amount per period (KES), rounded up to STEPUP_ROUNDING. */
  recommendedStepUp: number;
  /** The fixed starting (Month 1) contribution this recommendation is based on. */
  startingContribution: number;
  /** Projected ending value at the recommended step-up. */
  projectedEndingValue: number;
  /** True when the plan already reaches target at zero step-up (recommendedStepUp = 0). */
  alreadyHitsAtZero: boolean;
  /** Shortfall if infeasible (how much short the plan is even at the step-up cap). */
  shortfall: number;
  /** Whether the target is contribution-driven (short horizon). */
  isShortHorizon: boolean;
  /** Human-readable explanation. */
  message: string;
}

/**
 * Forward solver used by the Create-Portfolio dialog: the user FIXES the Month-1
 * contribution, and we recommend the step-up/period that makes the projection
 * reach the target. This is the mirror of {@link solveForContribution} (which
 * fixes the step-up and solves for the contribution) and uses the SAME
 * {@link runProjection} engine, so a portfolio created with the recommended
 * step-up will agree with the Scenarios page.
 *
 * Strategy:
 *   - Hold startingContribution fixed (caller supplies it).
 *   - If the plan already reaches target with NO step-up, recommend 0.
 *   - Otherwise binary-search the step-up amount until the horizon total ≥ target,
 *     then round UP to STEPUP_ROUNDING for a clean recommendation.
 *   - If even SOLVER_MAX_STEPUP doesn't reach the target, report infeasible.
 *
 * @param settings            - Base settings (target, horizon, rates, stepUpMonths). stepUpAmount is ignored.
 * @param startingContribution - The fixed Month-1 contribution (KES/month).
 * @param rateHistory         - Rate history for time-locked projection.
 * @param secondaryMmfs       - Optional tracked secondary MMFs.
 */
export function solveForStepUp(
  settings: EngineSettings,
  startingContribution: number,
  rateHistory: RateSnapshot[] = [],
  secondaryMmfs: SecondaryMmfInput[] = []
): StepUpSolverResult {
  const horizonMonths = settings.horizonMonths ?? 120;
  const isShortHorizon = horizonMonths < SHORT_HORIZON_THRESHOLD;
  const target = settings.targetAmount;
  const start = Math.max(0, Math.round(startingContribution || 0));

  const project = (stepUpAmount: number): number => {
    const s: EngineSettings = { ...settings, startingContribution: start, stepUpAmount };
    const results = runProjection(s, [], rateHistory, [], [], secondaryMmfs);
    return results[results.length - 1]?.totalEnd ?? 0;
  };

  // 1) Already on track with no step-up at all?
  const atZero = project(0);
  if (atZero >= target) {
    return {
      feasible: true,
      recommendedStepUp: 0,
      startingContribution: start,
      projectedEndingValue: Math.round(atZero),
      alreadyHitsAtZero: true,
      shortfall: 0,
      isShortHorizon,
      message: `At KES ${start.toLocaleString()}/month, the plan already reaches KES ${target.toLocaleString()} within ${horizonMonths} months — no step-up required.`,
    };
  }

  // 2) Feasibility check at the step-up cap.
  const atCap = project(SOLVER_MAX_STEPUP);
  if (atCap < target) {
    const shortfall = target - atCap;
    return {
      feasible: false,
      recommendedStepUp: SOLVER_MAX_STEPUP,
      startingContribution: start,
      projectedEndingValue: Math.round(atCap),
      alreadyHitsAtZero: false,
      shortfall,
      isShortHorizon,
      message: `Even with a very large step-up, KES ${start.toLocaleString()}/month cannot reach KES ${target.toLocaleString()} in ${horizonMonths} months. Consider a higher Month-1 amount, a longer horizon, or a lower target.`,
    };
  }

  // 3) Binary-search the minimum step-up that reaches target.
  let lo = 0;
  let hi = SOLVER_MAX_STEPUP;
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    if (project(mid) >= target) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  // Round UP to a clean increment so the recommendation comfortably clears target.
  const recommendedStepUp = Math.ceil(hi / STEPUP_ROUNDING) * STEPUP_ROUNDING;
  const projectedEndingValue = project(recommendedStepUp);

  const shortHorizonNote = isShortHorizon
    ? ` Note: this is a short-horizon plan (${horizonMonths} months), so the result is primarily contribution-driven.`
    : "";

  return {
    feasible: true,
    recommendedStepUp,
    startingContribution: start,
    projectedEndingValue: Math.round(projectedEndingValue),
    alreadyHitsAtZero: false,
    shortfall: 0,
    isShortHorizon,
    message: `To reach KES ${target.toLocaleString()} in ${horizonMonths} months starting at KES ${start.toLocaleString()}/month, step up by about KES ${recommendedStepUp.toLocaleString()} every ${settings.stepUpMonths ?? 6} months.${shortHorizonNote}`,
  };
}

/**
 * Project the ending value for a SPECIFIC starting contribution + step-up amount.
 * Used by the Create-Portfolio dialog to show an exact "projected vs target"
 * delta even when the user types a custom step-up (rather than the recommended
 * one). Same engine as everything else, so the delta agrees with the Scenarios
 * page once the portfolio exists.
 */
export function projectEndingValue(
  settings: EngineSettings,
  startingContribution: number,
  stepUpAmount: number,
  rateHistory: RateSnapshot[] = [],
  secondaryMmfs: SecondaryMmfInput[] = []
): number {
  const s: EngineSettings = {
    ...settings,
    startingContribution: Math.max(0, Math.round(startingContribution || 0)),
    stepUpAmount: Math.max(0, stepUpAmount || 0),
  };
  const results = runProjection(s, [], rateHistory, [], [], secondaryMmfs);
  return Math.round(results[results.length - 1]?.totalEnd ?? 0);
}
