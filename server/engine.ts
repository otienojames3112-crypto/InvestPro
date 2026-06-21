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
}

export interface MonthlyContributionOverride {
  monthNumber: number;
  overrideAmount?: number;
  lumpSum?: number;
}

/** Actual deposit entry from the database (for actuals-seeded projection). */
export interface ActualDeposit {
  bucket: "mmf" | "tbill" | "ifb" | "fxd";
  amount: number;
  /** ISO date string YYYY-MM-DD */
  depositDate: string;
}

/** Actual security from the database (for actuals-seeded projection). */
export interface ActualSecurity {
  securityType: "tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd";
  faceValue: number;
  issueDate: string;
  maturityDate: string;
  couponRate: number;
  isTaxExempt: boolean;
  isMatured: boolean;
}

export interface MonthResult {
  monthNumber: number;
  contribution: number;
  cbkCashIn: number;
  mmfToDhow: number;
  mainAction: string;
  mmfEnd: number;
  tbillEnd: number;
  ifbEnd: number;
  fxdEnd: number;
  totalEnd: number;
  phase: "foundation" | "growth" | "de-risking" | "final-liquidity";
  sweepTarget: "tbill" | "ifb" | "fxd" | null;
  /** Total WHT withheld this month (MMF + T-Bill + FXD). */
  whtThisMonth: number;
  /** True if this month's data comes from actual deposits/securities. */
  isActual: boolean;
  /** True when the short-horizon strategy is active (MMF + T-bills only). */
  isShortHorizon: boolean;
}

export interface YearMilestone {
  year: number;
  month: number;
  projectedTotal: number;
  minHealthyCheckpoint: number;
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

/** Maximum starting contribution the solver will try before declaring infeasible. */
const SOLVER_MAX_CONTRIBUTION = 1_000_000;

const MILESTONE_LABELS: Record<number, string> = {
  1:  "Still building the base. Do not panic if most money is still in MMF.",
  2:  "Still building the base. Do not panic if most money is still in MMF.",
  3:  "Growth stage. Coupons and reinvestment should begin helping noticeably.",
  4:  "Growth stage. Coupons and reinvestment should begin helping noticeably.",
  5:  "Growth stage. Coupons and reinvestment should begin helping noticeably.",
  6:  "Growth stage. Coupons and reinvestment should begin helping noticeably.",
  7:  "Growth stage. Coupons and reinvestment should begin helping noticeably.",
  8:  "De-risking stage. More value should move toward T-bills and MMF.",
  9:  "De-risking stage. More value should move toward T-bills and MMF.",
  10: "Goal stage. Most or all money should be liquid or near-liquid.",
};

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
  if (!rateHistory || rateHistory.length === 0) return currentSettings;
  const monthStr = monthDate.toISOString().split("T")[0];
  const sorted = [...rateHistory].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const snapshot = sorted.find(s => s.effectiveDate <= monthStr);
  return snapshot ?? currentSettings;
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

// ─── Main projection engine ───────────────────────────────────────────────────

/**
 * Run the full projection simulation for horizonMonths months.
 *
 * @param settings         - Rate and plan settings (horizonMonths defaults to 120).
 * @param overrides        - Per-month contribution overrides.
 * @param rateHistory      - Historical rate snapshots for time-locked per-month rates.
 * @param actualDeposits   - Real deposit entries (for actuals-seeded mode).
 * @param actualSecurities - Real securities from the register (for actuals-seeded mode).
 */
export function runProjection(
  settings: EngineSettings,
  overrides: MonthlyContributionOverride[] = [],
  rateHistory: RateSnapshot[] = [],
  actualDeposits: ActualDeposit[] = [],
  actualSecurities: ActualSecurity[] = []
): MonthResult[] {
  const horizonMonths = settings.horizonMonths ?? 120;
  const isShortHorizon = horizonMonths < SHORT_HORIZON_THRESHOLD;
  const fractions = settings.phaseFractions;

  const overrideMap = new Map<number, MonthlyContributionOverride>();
  for (const o of overrides) overrideMap.set(o.monthNumber, o);

  const startDate = new Date(
    (settings.startDate ?? new Date().toISOString().split("T")[0]) + "T12:00:00Z"
  );
  const today = new Date();
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

  let actualsMMF = 0;

  if (hasActuals && currentMonth > 0) {
    for (const d of actualDeposits) {
      if (d.bucket === "mmf") actualsMMF += d.amount;
    }

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
      const bucket: "tbill" | "ifb" | "fxd" =
        sec.securityType.startsWith("tbill") ? "tbill"
        : sec.securityType === "ifb" ? "ifb"
        : "fxd";
      lots.push({
        id: `actual-${lotIdCounter++}`,
        bucket,
        faceValue: sec.faceValue,
        issueMonth,
        tenorMonths,
        couponRate: sec.couponRate,
        isTaxExempt: sec.isTaxExempt,
      });
    }
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

    if (hasActuals && m === currentMonth + 1 && currentMonth > 0) {
      mmf = actualsMMF;
    }

    let contribution = 0;
    let whtThisMonth = 0;

    if (!isActualMonth) {
      const scheduled = getScheduledContribution(m, settings);
      contribution = override?.overrideAmount !== undefined ? override.overrideAmount : scheduled;
      const lumpSum = override?.lumpSum ?? 0;
      contribution += lumpSum;
      mmf += contribution;
    } else {
      contribution = getScheduledContribution(m, settings);
    }

    if (!isActualMonth) {
      const interestGross = mmf * monthlyRate(rates.mmfYield);
      const interestWHT = interestGross * wht;
      whtThisMonth += interestWHT;
      mmf = mmf * (1 + mmfMonthly);
    }

    let cbkCashIn = 0;
    const cbkActions: string[] = [];
    const survivingLots: SecurityLot[] = [];

    for (const lot of lots) {
      const age = m - lot.issueMonth;

      if (age < 0) {
        survivingLots.push(lot);
        continue;
      }

      if (age === lot.tenorMonths) {
        cbkCashIn += lot.faceValue;
        cbkActions.push(`${lot.bucket.toUpperCase()} maturity KES ${Math.round(lot.faceValue).toLocaleString()}`);

        if (lot.bucket === "tbill") {
          const tenorYears = lot.tenorMonths / 12;
          const grossInterest = lot.faceValue * (rates.tbill364Rate / 100) * tenorYears;
          const netInterest = grossInterest * (1 - wht);
          whtThisMonth += grossInterest * wht;
          cbkCashIn += netInterest;
          cbkActions.push(`T-bill net discount KES ${Math.round(netInterest).toLocaleString()}`);
        }
        continue;
      }

      if ((lot.bucket === "ifb" || lot.bucket === "fxd") && age > 0 && age % 6 === 0) {
        const grossCoupon = (lot.couponRate / 100 / 2) * lot.faceValue;
        if (lot.isTaxExempt) {
          cbkCashIn += grossCoupon;
          cbkActions.push(`IFB coupon KES ${Math.round(grossCoupon).toLocaleString()} (tax-exempt)`);
        } else {
          const netCoupon = grossCoupon * (1 - wht);
          whtThisMonth += grossCoupon * wht;
          cbkCashIn += netCoupon;
          cbkActions.push(`FXD coupon KES ${Math.round(netCoupon).toLocaleString()} (net of ${rates.withholdingTax}% WHT)`);
        }
      }

      survivingLots.push(lot);
    }

    lots = survivingLots;
    mmf += cbkCashIn;

    let mmfToDhow = 0;
    let sweepTarget: "tbill" | "ifb" | "fxd" | null = null;

    // No new long bonds in final-liquidity phase
    const noNewLongBonds = m > deRiskingEnd;

    if (!isActualMonth) {
      const maxLots = Math.floor((mmf - settings.safetyFloor) / 50000);
      if (maxLots > 0) {
        const target = getSweepTargetForMonth(m, sweepCount, horizonMonths, fractions, isShortHorizon);
        if (target) {
          const effectiveBucket = noNewLongBonds && target.bucket !== "tbill"
            ? { bucket: "tbill" as const, tenorMonths: 3 }
            : target;

          sweepTarget = effectiveBucket.bucket;
          const lotsCount = maxLots;
          const totalSweep = lotsCount * 50000;

          if (mmf - totalSweep >= settings.safetyFloor) {
            mmf -= totalSweep;
            mmfToDhow = totalSweep;

            for (let i = 0; i < lotsCount; i++) {
              lots.push({
                id: `sim-${m}-${lotIdCounter++}`,
                bucket: effectiveBucket.bucket,
                faceValue: 50000,
                issueMonth: m,
                tenorMonths: effectiveBucket.tenorMonths,
                couponRate: effectiveBucket.bucket === "ifb"
                  ? rates.ifbCouponRate
                  : effectiveBucket.bucket === "fxd"
                  ? rates.fxdCouponRate
                  : 0,
                isTaxExempt: effectiveBucket.bucket === "ifb",
              });
            }
            sweepCount++;
          }
        }
      }
    }

    let tbillEnd = 0;
    let ifbEnd = 0;
    let fxdEnd = 0;
    for (const lot of lots) {
      if (lot.bucket === "tbill") {
        const age = m - lot.issueMonth;
        const tenorYears = lot.tenorMonths / 12;
        const grossDiscount = lot.faceValue * (rates.tbill364Rate / 100) * tenorYears;
        const netDiscount = grossDiscount * (1 - wht);
        const accruedDiscount = age > 0 ? netDiscount * (age / lot.tenorMonths) : 0;
        tbillEnd += lot.faceValue + accruedDiscount;
      } else if (lot.bucket === "ifb") {
        ifbEnd += lot.faceValue;
      } else if (lot.bucket === "fxd") {
        fxdEnd += lot.faceValue;
      }
    }

    let mainAction = "";
    const sweepDesc = mmfToDhow > 0
      ? `sweep KES ${Math.round(mmfToDhow).toLocaleString()} → ${sweepTarget?.toUpperCase()} (${Math.round(mmfToDhow / 50000)} lot${mmfToDhow > 50000 ? "s" : ""})`
      : "";
    if (cbkActions.length > 0 && sweepDesc) {
      mainAction = `${cbkActions.join("; ")}; ${sweepDesc}`;
    } else if (cbkActions.length > 0) {
      mainAction = `${cbkActions.join("; ")}; deposit to MMF`;
    } else if (sweepDesc) {
      mainAction = `Deposit to MMF; ${sweepDesc}`;
    } else {
      mainAction = "Deposit to MMF; no DhowCSD sweep this month";
    }

    const total = mmf + tbillEnd + ifbEnd + fxdEnd;

    results.push({
      monthNumber: m,
      contribution,
      cbkCashIn:    Math.round(cbkCashIn    * 100) / 100,
      mmfToDhow:    Math.round(mmfToDhow    * 100) / 100,
      mainAction,
      mmfEnd:   Math.round(mmf     * 100) / 100,
      tbillEnd: Math.round(tbillEnd * 100) / 100,
      ifbEnd:   Math.round(ifbEnd   * 100) / 100,
      fxdEnd:   Math.round(fxdEnd   * 100) / 100,
      totalEnd: Math.round(total    * 100) / 100,
      phase,
      sweepTarget,
      whtThisMonth: Math.round(whtThisMonth * 100) / 100,
      isActual: isActualMonth,
      isShortHorizon,
    });
  }

  return results;
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

export function runScenarios(
  baseSettings: EngineSettings,
  stepUps: number[] = SCENARIO_STEPUPS,
  rateHistory: RateSnapshot[] = []
): ScenarioResult[] {
  const horizonMonths = baseSettings.horizonMonths ?? 120;
  return stepUps.map((stepUp) => {
    const settings = { ...baseSettings, stepUpAmount: stepUp };
    const results = runProjection(settings, [], rateHistory);
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
 * Generate per-portfolio year-end milestones from a clean projection run.
 * Works for any horizon: generates one milestone per year up to horizonMonths.
 */
export function generateMilestones(settings?: EngineSettings): YearMilestone[] {
  const s = settings ?? DEFAULT_SETTINGS_FOR_MILESTONES;
  const horizonMonths = s.horizonMonths ?? 120;
  const results = runProjection(s);
  const milestones: YearMilestone[] = [];
  const totalYears = Math.floor(horizonMonths / 12);
  for (let year = 1; year <= totalYears; year++) {
    const month = year * 12;
    if (month > horizonMonths) break;
    const row = results.find(r => r.monthNumber === month);
    if (!row) continue;
    const projected = row.totalEnd;
    milestones.push({
      year,
      month,
      projectedTotal: Math.round(projected),
      minHealthyCheckpoint: Math.round(projected * 0.9),
      label: MILESTONE_LABELS[year] ?? `Year ${year} checkpoint.`,
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
  rateHistory: RateSnapshot[] = []
): {
  milestone: YearMilestone | null;
  status: "on-track" | "behind" | "ahead";
  gap: number;
  recommendation: string;
} {
  const milestones = generateMilestones(settings);
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
  rateHistory: RateSnapshot[] = []
): SolverResult {
  const horizonMonths = settings.horizonMonths ?? 120;
  const isShortHorizon = horizonMonths < SHORT_HORIZON_THRESHOLD;
  const target = settings.targetAmount;

  const project = (startingContribution: number): number => {
    const s: EngineSettings = { ...settings, startingContribution, stepUpAmount };
    const results = runProjection(s, [], rateHistory);
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
  const results = runProjection(s, [], rateHistory);
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
