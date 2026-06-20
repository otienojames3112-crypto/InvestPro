/**
 * KES 5M Investment Compounding Engine
 * Implements the SanlamAllianz MMF + CBK DhowCSD velocity loop strategy.
 */

export interface EngineSettings {
  mmfYield: number;          // Annual % e.g. 8.78
  tbill91Rate: number;       // Annual % e.g. 8.82
  tbill182Rate: number;      // Annual % e.g. 8.78
  tbill364Rate: number;      // Annual % e.g. 8.97
  ifbCouponRate: number;     // Annual % e.g. 12.5
  fxdCouponRate: number;     // Annual % e.g. 10.5
  withholdingTax: number;    // % e.g. 15
  startingContribution: number; // KES e.g. 2500
  stepUpAmount: number;      // KES e.g. 3000
  stepUpMonths: number;      // e.g. 6
  safetyFloor: number;       // KES e.g. 50000
  targetAmount: number;      // KES e.g. 5000000
}

export interface MonthlyContributionOverride {
  monthNumber: number;
  overrideAmount?: number;
  lumpSum?: number;
}

export interface MonthResult {
  monthNumber: number;
  contribution: number;
  cbkCashIn: number;        // Coupons + maturities received from CBK this month
  mmfToDhow: number;        // Amount swept from MMF to DhowCSD this month
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
  { year: 1, month: 12, projectedTotal: 49590, minHealthyCheckpoint: 44631, label: "Still building the base." },
  { year: 2, month: 24, projectedTotal: 177186, minHealthyCheckpoint: 159467, label: "Still building the base." },
  { year: 3, month: 36, projectedTotal: 389825, minHealthyCheckpoint: 350842, label: "Growth stage. Coupons and reinvestment should begin helping noticeably." },
  { year: 4, month: 48, projectedTotal: 699174, minHealthyCheckpoint: 629257, label: "Growth stage. Coupons and reinvestment should begin helping noticeably." },
  { year: 5, month: 60, projectedTotal: 1117401, minHealthyCheckpoint: 1005661, label: "Growth stage. Coupons and reinvestment should begin helping noticeably." },
  { year: 6, month: 72, projectedTotal: 1653712, minHealthyCheckpoint: 1488340, label: "Growth stage. Coupons and reinvestment should begin helping noticeably." },
  { year: 7, month: 84, projectedTotal: 2320549, minHealthyCheckpoint: 2088495, label: "Growth stage. Coupons and reinvestment should begin helping noticeably." },
  { year: 8, month: 96, projectedTotal: 3132452, minHealthyCheckpoint: 2819207, label: "De-risking stage. More value should move toward T-bills and MMF." },
  { year: 9, month: 108, projectedTotal: 4123515, minHealthyCheckpoint: 3711164, label: "De-risking stage. More value should move toward T-bills and MMF." },
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
 * Get the preferred sweep target security type for a given phase.
 */
export function getSweepTarget(phase: string): "tbill" | "ifb" | "fxd" | null {
  switch (phase) {
    case "foundation": return "tbill";
    case "growth": return "ifb";
    case "de-risking": return "tbill";
    case "final-liquidity": return null; // No new long bonds in final 18 months
    default: return null;
  }
}

/**
 * Calculate the monthly MMF return factor from an annual yield percentage.
 * Uses compound monthly equivalent: (1 + r/100)^(1/12) - 1
 */
export function monthlyMMFReturn(annualYieldPct: number): number {
  return Math.pow(1 + annualYieldPct / 100, 1 / 12) - 1;
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
 */
export function runProjection(
  settings: EngineSettings,
  overrides: MonthlyContributionOverride[] = []
): MonthResult[] {
  const overrideMap = new Map<number, MonthlyContributionOverride>();
  for (const o of overrides) overrideMap.set(o.monthNumber, o);

  const monthlyRate = monthlyMMFReturn(settings.mmfYield);
  const results: MonthResult[] = [];

  let mmf = 0;
  let tbill = 0;
  let ifb = 0;
  let fxd = 0;

  // Track bond holdings for coupon payments (simplified: track total face value per type)
  // Coupons are paid semi-annually (every 6 months) on IFB and FXD
  // T-bills mature and return principal + discount at maturity
  // For the projection engine, we model this as:
  //   - IFB: semi-annual coupon = (ifbCouponRate/100/2) * ifbFaceValue, tax-exempt
  //   - FXD: semi-annual coupon = (fxdCouponRate/100/2) * fxdFaceValue * (1 - withholdingTax/100)
  //   - T-bills: annual return = (tbill364Rate/100) * tbillFaceValue (simplified as annual yield)

  let ifbFaceValue = 0;
  let fxdFaceValue = 0;
  let tbillFaceValue = 0;

  for (let m = 1; m <= 120; m++) {
    const phase = getPhase(m);
    const sweepTarget = getSweepTarget(phase);
    const override = overrideMap.get(m);

    // Determine contribution
    const scheduled = getScheduledContribution(m, settings);
    const contribution = override?.overrideAmount !== undefined ? override.overrideAmount : scheduled;
    const lumpSum = override?.lumpSum ?? 0;
    const totalContrib = contribution + lumpSum;

    // Step 1: Deposit contribution into MMF
    mmf += totalContrib;

    // Step 2: Apply monthly MMF interest
    mmf = mmf * (1 + monthlyRate);

    // Step 3: Receive CBK cash-in (coupons + maturities)
    let cbkCashIn = 0;

    // IFB semi-annual coupon (months 6, 12, 18, 24, ... i.e. every 6 months)
    if (m % 6 === 0 && ifbFaceValue > 0) {
      const coupon = (settings.ifbCouponRate / 100 / 2) * ifbFaceValue; // tax-exempt
      cbkCashIn += coupon;
    }

    // FXD semi-annual coupon (offset by 3 months: months 3, 9, 15, 21, ...)
    if (m % 6 === 3 && fxdFaceValue > 0) {
      const grossCoupon = (settings.fxdCouponRate / 100 / 2) * fxdFaceValue;
      const netCoupon = grossCoupon * (1 - settings.withholdingTax / 100);
      cbkCashIn += netCoupon;
    }

    // T-bill annual maturity (every 12 months, simplified)
    if (m % 12 === 0 && tbillFaceValue > 0) {
      const tbillReturn = (settings.tbill364Rate / 100) * tbillFaceValue;
      cbkCashIn += tbillReturn; // Return the interest (principal stays invested)
    }

    // Move CBK cash-in back into MMF
    mmf += cbkCashIn;

    // Step 4: Sweep logic — if MMF is above safety floor + 50,000, sweep to DhowCSD
    let mmfToDhow = 0;
    let mainAction = `Deposit to MMF; no DhowCSD sweep this month`;

    // Enforce safety floor: only sweep if MMF after sweep stays >= safetyFloor
    const sweepThreshold = settings.safetyFloor + 50000;

    if (sweepTarget !== null && mmf >= sweepThreshold) {
      mmfToDhow = 50000;
      mmf -= mmfToDhow;
      // Safety check: ensure floor is maintained
      if (mmf < settings.safetyFloor) {
        mmf += mmfToDhow;
        mmfToDhow = 0;
        mainAction = `MMF below safety floor (KES ${settings.safetyFloor.toLocaleString()}); no sweep`;
      }

      if (sweepTarget === "tbill") {
        tbill += mmfToDhow;
        tbillFaceValue += mmfToDhow;
        mainAction = `Sweep KES 50,000 from MMF to DhowCSD; buy 1 x T-bill`;
      } else if (sweepTarget === "ifb") {
        ifb += mmfToDhow;
        ifbFaceValue += mmfToDhow;
        mainAction = `Sweep KES 50,000 from MMF to DhowCSD; buy 1 x IFB`;
      } else if (sweepTarget === "fxd") {
        fxd += mmfToDhow;
        fxdFaceValue += mmfToDhow;
        mainAction = `Sweep KES 50,000 from MMF to DhowCSD; buy 1 x FXD bond`;
      }
    } else if (cbkCashIn > 0) {
      mainAction = `Receive coupons KES ${cbkCashIn.toFixed(0)}; deposit to MMF`;
    }

    // Apply modest capital appreciation to bond holdings (mark-to-market simplified)
    // T-bills: accrue at discount rate monthly
    tbill = tbill * (1 + settings.tbill364Rate / 100 / 12);
    // IFB: accrue at coupon rate monthly (face value grows conceptually via reinvestment)
    ifb = ifb * (1 + settings.ifbCouponRate / 100 / 12 * 0.5); // half because coupons are paid out
    // FXD: accrue at net coupon rate monthly
    fxd = fxd * (1 + (settings.fxdCouponRate / 100) * (1 - settings.withholdingTax / 100) / 12 * 0.5);

    const total = mmf + tbill + ifb + fxd;

    results.push({
      monthNumber: m,
      contribution: totalContrib,
      cbkCashIn,
      mmfToDhow,
      mainAction,
      mmfEnd: Math.round(mmf * 100) / 100,
      tbillEnd: Math.round(tbill * 100) / 100,
      ifbEnd: Math.round(ifb * 100) / 100,
      fxdEnd: Math.round(fxd * 100) / 100,
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
    const results = runProjection(settings);
    const last = results[results.length - 1];

    // Calculate total contributed
    let totalContributed = 0;
    for (const r of results) {
      totalContributed += r.contribution;
    }

    // Final monthly saving
    const finalMonthly = getScheduledContribution(120, settings);

    return {
      stepUp,
      finalMonthlySaving: finalMonthly,
      totalContributed: Math.round(totalContributed),
      projectedEndingValue: last.totalEnd,
      hitsTarget: last.totalEnd >= settings.targetAmount,
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
  const milestone = YEAR_MILESTONES.find((m) => m.month === currentMonth);
  if (!milestone) {
    return { milestone: null, status: "on-track", gap: 0, recommendation: "" };
  }

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
