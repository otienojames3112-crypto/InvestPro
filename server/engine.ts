/**
 * KES 5M Investment Compounding Engine
 * Implements the SanlamAllianz MMF + CBK DhowCSD velocity loop strategy.
 *
 * Tax treatment (Kenya, resident individuals):
 *   - MMF interest:   15% WHT deducted at source; final tax — net yield used in projection
 *   - T-Bill discount: 15% WHT deducted at source; net discount used in projection
 *   - IFB coupons:    Tax-exempt (qualifying Infrastructure Bonds) — gross coupon used
 *   - FXD coupons:    15% WHT deducted at source — net coupon used in projection
 *
 * Planning rates (from PDF page 8):
 *   - MMF net planning return:    7.5% per year  (gross ~8.82% × 0.85 ≈ 7.5%)
 *   - T-Bill net planning return: 7.5% per year  (gross ~8.82% × 0.85 ≈ 7.5%)
 *   - IFB coupon (gross = net):   12.5% per year (tax-exempt)
 *   - FXD net coupon:             10.5% per year (gross ~12.35% × 0.85 ≈ 10.5%)
 *
 * Allocation rules by phase (from PDF page 1):
 *   Foundation    (M1–24):   MMF 50%, T-Bills 50%, IFB  0%, FXD  0%
 *   Growth        (M25–84):  MMF 20%, T-Bills 20%, IFB 45%, FXD 15%
 *   De-risking    (M85–102): MMF 25%, T-Bills 35%, IFB 30%, FXD 10%
 *   Final liq.    (M103–120):MMF 40%, T-Bills 45%, IFB 10%, FXD  5%
 *
 * Sweep logic:
 *   Every month, if MMF > safetyFloor + 50,000, sweep exactly KES 50,000 into DhowCSD.
 *   The target security rotates based on phase allocation ratios.
 *   In the final 18 months (M103–120) no new long bonds are purchased.
 */

export interface EngineSettings {
  /** Gross annual MMF yield % (e.g. 8.78). WHT is applied internally. */
  mmfYield: number;
  /** Gross annual T-bill rate % for 91-day bills (e.g. 8.82). WHT applied internally. */
  tbill91Rate: number;
  /** Gross annual T-bill rate % for 182-day bills (e.g. 8.78). WHT applied internally. */
  tbill182Rate: number;
  /** Gross annual T-bill rate % for 364-day bills (e.g. 8.97). WHT applied internally. */
  tbill364Rate: number;
  /** Gross annual IFB coupon % (e.g. 12.5). Tax-exempt — no WHT applied. */
  ifbCouponRate: number;
  /** Gross annual FXD coupon % (e.g. 12.35). WHT applied internally to yield net ~10.5%. */
  fxdCouponRate: number;
  /** Withholding tax rate % applied to MMF, T-Bill, and FXD income (e.g. 15). */
  withholdingTax: number;
  startingContribution: number;
  stepUpAmount: number;
  stepUpMonths: number;
  safetyFloor: number;
  targetAmount: number;
}

export interface MonthlyContributionOverride {
  monthNumber: number;
  overrideAmount?: number;
  lumpSum?: number;
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
}

export interface YearMilestone {
  year: number;
  month: number;
  projectedTotal: number;
  minHealthyCheckpoint: number;
  label: string;
}

export const YEAR_MILESTONES: YearMilestone[] = [
  { year: 1,  month: 12,  projectedTotal: 49590,   minHealthyCheckpoint: 44631,   label: "Still building the base. Do not panic if most money is still in MMF." },
  { year: 2,  month: 24,  projectedTotal: 177186,  minHealthyCheckpoint: 159467,  label: "Still building the base. Do not panic if most money is still in MMF." },
  { year: 3,  month: 36,  projectedTotal: 389825,  minHealthyCheckpoint: 350842,  label: "Growth stage. Coupons and reinvestment should begin helping noticeably." },
  { year: 4,  month: 48,  projectedTotal: 699174,  minHealthyCheckpoint: 629257,  label: "Growth stage. Coupons and reinvestment should begin helping noticeably." },
  { year: 5,  month: 60,  projectedTotal: 1117401, minHealthyCheckpoint: 1005661, label: "Growth stage. Coupons and reinvestment should begin helping noticeably." },
  { year: 6,  month: 72,  projectedTotal: 1653712, minHealthyCheckpoint: 1488340, label: "Growth stage. Coupons and reinvestment should begin helping noticeably." },
  { year: 7,  month: 84,  projectedTotal: 2320549, minHealthyCheckpoint: 2088495, label: "Growth stage. Coupons and reinvestment should begin helping noticeably." },
  { year: 8,  month: 96,  projectedTotal: 3132452, minHealthyCheckpoint: 2819207, label: "De-risking stage. More value should move toward T-bills and MMF." },
  { year: 9,  month: 108, projectedTotal: 4123515, minHealthyCheckpoint: 3711164, label: "De-risking stage. More value should move toward T-bills and MMF." },
  { year: 10, month: 120, projectedTotal: 5279234, minHealthyCheckpoint: 4751310, label: "Goal stage. Most or all money should be liquid or near-liquid." },
];

export const SCENARIO_STEPUPS = [0, 1000, 2000, 2800, 3000, 3500];

export interface ScenarioResult {
  stepUp: number;
  finalMonthlySaving: number;
  totalContributed: number;
  projectedEndingValue: number;
  hitsTarget: boolean;
}

/**
 * Get the investment phase for a given month number.
 */
export function getPhase(month: number): "foundation" | "growth" | "de-risking" | "final-liquidity" {
  if (month <= 24) return "foundation";
  if (month <= 84) return "growth";
  if (month <= 102) return "de-risking";
  return "final-liquidity";
}

/**
 * Determine the sweep target security for a given month, rotating through the
 * phase allocation ratios.
 *
 * Phase allocation ratios (T-Bill : IFB : FXD):
 *   Foundation    → T-Bill only (1:0:0)
 *   Growth        → 3 sweeps cycle: IFB, IFB, IFB, T-Bill (approx 45%IFB, 20%T-Bill, 15%FXD)
 *                   Simplified cycle of 4: IFB, IFB, IFB, T-Bill — then every 4th+1 = FXD
 *                   Actual cycle of 7: T-Bill, IFB, IFB, IFB, IFB, IFB, FXD  (≈20:45:15 ratio)
 *   De-risking    → cycle of 10: T-Bill×3, IFB×3, FXD×1, T-Bill×3 (approx 35:30:10)
 *                   Simplified cycle of 4: T-Bill, T-Bill, IFB, IFB — every 4th = FXD
 *   Final liq.    → T-Bill only (no new long bonds)
 *
 * We use a sweep counter per phase to rotate through targets.
 */
export function getSweepTargetForMonth(
  month: number,
  sweepCountInPhase: number
): "tbill" | "ifb" | "fxd" | null {
  const phase = getPhase(month);

  switch (phase) {
    case "foundation":
      // T-Bills only for the first 24 months
      return "tbill";

    case "growth": {
      // Target mix: T-Bills 20%, IFB 45%, FXD 15% (out of 80% in DhowCSD)
      // Normalised to DhowCSD allocation: T-Bill 25%, IFB 56.25%, FXD 18.75%
      // Cycle of 16: T-Bill×4, IFB×9, FXD×3
      const cycle = sweepCountInPhase % 16;
      if (cycle < 4) return "tbill";
      if (cycle < 13) return "ifb";
      return "fxd";
    }

    case "de-risking": {
      // Target mix: T-Bills 35%, IFB 30%, FXD 10% (out of 75% in DhowCSD)
      // Normalised: T-Bill 46.7%, IFB 40%, FXD 13.3%
      // Cycle of 15: T-Bill×7, IFB×6, FXD×2
      const cycle = sweepCountInPhase % 15;
      if (cycle < 7) return "tbill";
      if (cycle < 13) return "ifb";
      return "fxd";
    }

    case "final-liquidity":
      // No new long bonds; T-Bills only (short-duration)
      return "tbill";

    default:
      return null;
  }
}

/**
 * Net annual yield after WHT for MMF and T-Bills.
 * Net = Gross × (1 - WHT/100)
 */
export function netYield(grossPct: number, whtPct: number): number {
  return grossPct * (1 - whtPct / 100);
}

/**
 * Calculate the monthly compounding factor from a net annual yield percentage.
 * Uses compound monthly equivalent: (1 + r/100)^(1/12) - 1
 */
export function monthlyRate(netAnnualPct: number): number {
  return Math.pow(1 + netAnnualPct / 100, 1 / 12) - 1;
}

/**
 * Calculate the scheduled contribution for a given month.
 */
export function getScheduledContribution(
  monthNumber: number,
  settings: Pick<EngineSettings, "startingContribution" | "stepUpAmount" | "stepUpMonths">
): number {
  const stepIndex = Math.floor((monthNumber - 1) / settings.stepUpMonths);
  return settings.startingContribution + stepIndex * settings.stepUpAmount;
}

/**
 * Run the full 120-month projection simulation.
 *
 * Key corrections vs previous version:
 * 1. MMF and T-Bill yields are net of 15% WHT (final tax for resident individuals).
 * 2. FXD coupons are net of 15% WHT.
 * 3. IFB coupons are gross (tax-exempt).
 * 4. Sweep target rotates through T-Bill / IFB / FXD per phase allocation ratios,
 *    so FXD bonds actually accumulate during the Growth and De-risking phases.
 * 5. Sweep threshold: MMF must exceed safetyFloor + 50,000 before a sweep occurs,
 *    and after the sweep MMF must remain >= safetyFloor.
 */
export function runProjection(
  settings: EngineSettings,
  overrides: MonthlyContributionOverride[] = []
): MonthResult[] {
  const overrideMap = new Map<number, MonthlyContributionOverride>();
  for (const o of overrides) overrideMap.set(o.monthNumber, o);

  // Net yields after WHT
  const mmfNetAnnual   = netYield(settings.mmfYield, settings.withholdingTax);
  const tbillNetAnnual = netYield(settings.tbill364Rate, settings.withholdingTax);
  const mmfMonthly     = monthlyRate(mmfNetAnnual);
  const tbillMonthly   = monthlyRate(tbillNetAnnual);

  // IFB is tax-exempt — use gross rate
  const ifbMonthly = monthlyRate(settings.ifbCouponRate);

  // FXD net of WHT
  const fxdNetAnnual = netYield(settings.fxdCouponRate, settings.withholdingTax);
  const fxdMonthly   = monthlyRate(fxdNetAnnual);

  const results: MonthResult[] = [];

  let mmf  = 0;
  let tbill = 0;
  let ifb   = 0;
  let fxd   = 0;

  // Face values for coupon calculations (semi-annual payments)
  let ifbFaceValue  = 0;
  let fxdFaceValue  = 0;
  let tbillFaceValue = 0;

  // Sweep counter per phase (resets when phase changes)
  let sweepCount = 0;
  let lastPhase: string = "";

  for (let m = 1; m <= 120; m++) {
    const phase = getPhase(m);
    const override = overrideMap.get(m);

    // Reset sweep counter when phase changes
    if (phase !== lastPhase) {
      sweepCount = 0;
      lastPhase = phase;
    }

    // ── Step 1: Deposit contribution into MMF ──────────────────────────────
    const scheduled   = getScheduledContribution(m, settings);
    const contribution = override?.overrideAmount !== undefined ? override.overrideAmount : scheduled;
    const lumpSum      = override?.lumpSum ?? 0;
    const totalContrib = contribution + lumpSum;
    mmf += totalContrib;

    // ── Step 2: Apply monthly MMF interest (net of WHT) ───────────────────
    mmf = mmf * (1 + mmfMonthly);

    // ── Step 3: Receive CBK cash-in (coupons + maturities) ────────────────
    let cbkCashIn = 0;
    const cbkActions: string[] = [];

    // IFB semi-annual coupon — tax-exempt, paid every 6 months
    if (m % 6 === 0 && ifbFaceValue > 0) {
      const coupon = (settings.ifbCouponRate / 100 / 2) * ifbFaceValue;
      cbkCashIn += coupon;
      cbkActions.push(`IFB coupon KES ${Math.round(coupon).toLocaleString()} (tax-exempt)`);
    }

    // FXD semi-annual coupon — 15% WHT deducted at source, offset by 3 months
    if (m % 6 === 3 && fxdFaceValue > 0) {
      const grossCoupon = (settings.fxdCouponRate / 100 / 2) * fxdFaceValue;
      const netCoupon   = grossCoupon * (1 - settings.withholdingTax / 100);
      cbkCashIn += netCoupon;
      cbkActions.push(`FXD coupon KES ${Math.round(netCoupon).toLocaleString()} (net of 15% WHT)`);
    }

    // T-bill: model as annual maturity returning net interest (WHT already applied)
    // Principal is rolled over (stays in tbill balance); only net interest comes to MMF
    if (m % 12 === 0 && tbillFaceValue > 0) {
      const grossInterest = (settings.tbill364Rate / 100) * tbillFaceValue;
      const netInterest   = grossInterest * (1 - settings.withholdingTax / 100);
      cbkCashIn += netInterest;
      cbkActions.push(`T-bill maturity interest KES ${Math.round(netInterest).toLocaleString()} (net of 15% WHT)`);
    }

    // Move CBK cash-in back into MMF
    mmf += cbkCashIn;

    // ── Step 4: Sweep logic ────────────────────────────────────────────────
    // Rule: sweep KES 50,000 into DhowCSD only when MMF > safetyFloor + 50,000
    // After sweep, MMF must remain >= safetyFloor.
    let mmfToDhow  = 0;
    let sweepTarget: "tbill" | "ifb" | "fxd" | null = null;
    let mainAction = "";

    const canSweep = mmf > settings.safetyFloor + 50000;

    if (canSweep) {
      sweepTarget = getSweepTargetForMonth(m, sweepCount);

      if (sweepTarget !== null) {
        const tentativeMMF = mmf - 50000;
        if (tentativeMMF >= settings.safetyFloor) {
          mmfToDhow = 50000;
          mmf -= mmfToDhow;
          sweepCount++;

          if (sweepTarget === "tbill") {
            tbill          += mmfToDhow;
            tbillFaceValue += mmfToDhow;
          } else if (sweepTarget === "ifb") {
            ifb          += mmfToDhow;
            ifbFaceValue += mmfToDhow;
          } else if (sweepTarget === "fxd") {
            fxd          += mmfToDhow;
            fxdFaceValue += mmfToDhow;
          }
        }
      }
    }

    // Build main action description
    if (cbkActions.length > 0 && mmfToDhow > 0) {
      mainAction = `${cbkActions.join("; ")}; sweep KES 50,000 → ${sweepTarget?.toUpperCase()}`;
    } else if (cbkActions.length > 0) {
      mainAction = `${cbkActions.join("; ")}; deposit to MMF`;
    } else if (mmfToDhow > 0) {
      mainAction = `Deposit to MMF; sweep KES 50,000 → ${sweepTarget?.toUpperCase()}`;
    } else {
      mainAction = `Deposit to MMF; no DhowCSD sweep this month`;
    }

    // ── Step 5: Monthly accrual on DhowCSD holdings ───────────────────────
    // T-bills accrue at net monthly rate (WHT already reflected in netYield)
    tbill = tbill * (1 + tbillMonthly);
    // IFB accrues at gross coupon rate (tax-exempt); coupons are paid out semi-annually
    // so the balance grows at the full coupon rate between coupon dates
    ifb   = ifb   * (1 + ifbMonthly);
    // FXD accrues at net coupon rate (WHT already reflected)
    fxd   = fxd   * (1 + fxdMonthly);

    const total = mmf + tbill + ifb + fxd;

    results.push({
      monthNumber: m,
      contribution: totalContrib,
      cbkCashIn:    Math.round(cbkCashIn   * 100) / 100,
      mmfToDhow:    Math.round(mmfToDhow   * 100) / 100,
      mainAction,
      mmfEnd:   Math.round(mmf   * 100) / 100,
      tbillEnd: Math.round(tbill * 100) / 100,
      ifbEnd:   Math.round(ifb   * 100) / 100,
      fxdEnd:   Math.round(fxd   * 100) / 100,
      totalEnd: Math.round(total * 100) / 100,
      phase,
      sweepTarget,
    });
  }

  return results;
}

/**
 * Run scenario comparisons for different step-up amounts.
 */
export function runScenarios(
  baseSettings: EngineSettings,
  stepUps: number[] = SCENARIO_STEPUPS
): ScenarioResult[] {
  return stepUps.map((stepUp) => {
    const settings = { ...baseSettings, stepUpAmount: stepUp };
    const results  = runProjection(settings);
    const last     = results[results.length - 1];

    let totalContributed = 0;
    for (const r of results) totalContributed += r.contribution;

    return {
      stepUp,
      finalMonthlySaving:   getScheduledContribution(120, settings),
      totalContributed:     Math.round(totalContributed),
      projectedEndingValue: last.totalEnd,
      hitsTarget:           last.totalEnd >= settings.targetAmount,
    };
  });
}

/**
 * Check milestone status and generate catch-up recommendations.
 */
export function checkMilestones(
  currentMonth: number,
  currentTotal: number,
  settings: EngineSettings
): {
  milestone: YearMilestone | null;
  status: "on-track" | "behind" | "ahead";
  gap: number;
  recommendation: string;
} {
  const rawMilestone = YEAR_MILESTONES.find((m) => m.month === currentMonth);
  if (!rawMilestone) {
    return { milestone: null, status: "on-track", gap: 0, recommendation: "" };
  }

  // Scale milestone targets proportionally if the user has changed their goal
  const BASE_TARGET = 5000000;
  const scale = settings.targetAmount / BASE_TARGET;
  const milestone: YearMilestone = {
    ...rawMilestone,
    projectedTotal: Math.round(rawMilestone.projectedTotal * scale),
    minHealthyCheckpoint: Math.round(rawMilestone.minHealthyCheckpoint * scale),
  };

  const gap = currentTotal - milestone.minHealthyCheckpoint;

  if (currentTotal >= milestone.projectedTotal) {
    return {
      milestone,
      status: "ahead",
      gap,
      recommendation: "You are ahead of schedule. Keep up the discipline!",
    };
  } else if (currentTotal >= milestone.minHealthyCheckpoint) {
    return {
      milestone,
      status: "on-track",
      gap,
      recommendation: "You are on track. Continue your regular contributions.",
    };
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
