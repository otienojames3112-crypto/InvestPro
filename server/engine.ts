/**
 * KES 5M Investment Compounding Engine — v2
 *
 * Tax treatment (Kenya, resident individuals — Income Tax Act Cap 470):
 *   - MMF interest:    15% WHT deducted at source (gross rate entered; engine applies WHT).
 *                      SanlamAllianz quotes a GROSS effective annual yield; WHT is applied here.
 *   - T-Bill discount: 15% WHT deducted at source; net discount flows to MMF at maturity.
 *   - IFB coupons:     Tax-exempt (all qualifying Infrastructure Bonds per Finance Act 2023;
 *                      the proposed 3-year tenor threshold was NOT enacted — all IFBs are exempt).
 *   - FXD coupons:     15% WHT deducted at source; gross rate stored, net applied here.
 *
 * Allocation rules by phase (PDF page 1):
 *   Foundation    (M1–24):   MMF 50%, T-Bills 50%, IFB  0%, FXD  0%
 *   Growth        (M25–84):  MMF 20%, T-Bills 20%, IFB 45%, FXD 15%
 *   De-risking    (M85–102): MMF 25%, T-Bills 35%, IFB 30%, FXD 10%
 *   Final liq.    (M103–120):MMF 40%, T-Bills 45%, IFB 10%, FXD  5%
 *
 * Key design decisions (v2):
 *   1. Fixed-income buckets (T-Bill, IFB, FXD) are held at FACE VALUE — they do NOT compound
 *      in place. Returns flow exclusively as cash (coupons / maturity proceeds) back into MMF.
 *      Only MMF compounds in place.
 *   2. Each security is tracked as an individual lot with its own issue month, tenor, and rate,
 *      so maturities and coupons fire on real per-lot dates.
 *   3. When actuals are provided, months before currentMonth are seeded from real deposit entries
 *      and logged securities; future months continue from the actual current balances.
 *   4. WHT is accumulated inside the engine and exposed per month — getActualsSummary uses this
 *      number instead of recomputing with a separate formula.
 *   5. Sweep buys floor((mmf - safetyFloor) / 50000) lots per month, not just one.
 */

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

// ─── Constants ────────────────────────────────────────────────────────────────

export const SCENARIO_STEPUPS = [0, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000];

/**
 * YEAR_MILESTONES is now generated dynamically from a clean projection run.
 * This array is populated by calling generateMilestones() and is exported for
 * backward-compatibility with code that imported the constant directly.
 * It is lazily populated on first use.
 */
let _cachedMilestones: YearMilestone[] | null = null;

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
};

export function generateMilestones(settings?: EngineSettings): YearMilestone[] {
  const s = settings ?? DEFAULT_SETTINGS_FOR_MILESTONES;
  const results = runProjection(s);
  const milestones: YearMilestone[] = [];
  for (let year = 1; year <= 10; year++) {
    const month = year * 12;
    const row = results.find(r => r.monthNumber === month);
    if (!row) continue;
    const projected = row.totalEnd;
    milestones.push({
      year,
      month,
      projectedTotal: Math.round(projected),
      minHealthyCheckpoint: Math.round(projected * 0.9),
      label: MILESTONE_LABELS[year] ?? "",
    });
  }
  return milestones;
}

export function getYearMilestones(): YearMilestone[] {
  if (!_cachedMilestones) {
    _cachedMilestones = generateMilestones();
  }
  return _cachedMilestones;
}

/** Invalidate the milestone cache (call after settings change). */
export function invalidateMilestoneCache(): void {
  _cachedMilestones = null;
}

// Keep a static export for backward compatibility (populated lazily on first access).
// Code that does `import { YEAR_MILESTONES }` will get the dynamically-generated array.
export const YEAR_MILESTONES: YearMilestone[] = new Proxy([] as YearMilestone[], {
  get(_, prop) {
    const live = getYearMilestones();
    if (prop === "length") return live.length;
    if (prop === Symbol.iterator) return live[Symbol.iterator].bind(live);
    if (typeof prop === "string" && !isNaN(Number(prop))) return live[Number(prop)];
    return (live as unknown as Record<string | symbol, unknown>)[prop];
  },
});

// ─── Pure helpers ─────────────────────────────────────────────────────────────

export function getPhase(month: number): "foundation" | "growth" | "de-risking" | "final-liquidity" {
  if (month <= 24) return "foundation";
  if (month <= 84) return "growth";
  if (month <= 102) return "de-risking";
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
 */
export function getSweepTargetForMonth(
  month: number,
  sweepCountInPhase: number
): { bucket: "tbill" | "ifb" | "fxd"; tenorMonths: number } | null {
  const phase = getPhase(month);

  switch (phase) {
    case "foundation":
      // T-Bills only; use 364-day (12-month) tenor per PDF Rule 3
      return { bucket: "tbill", tenorMonths: 12 };

    case "growth": {
      // Cycle of 16: T-Bill×4, IFB×9, FXD×3
      const cycle = sweepCountInPhase % 16;
      if (cycle < 4) return { bucket: "tbill", tenorMonths: 12 };
      if (cycle < 13) return { bucket: "ifb", tenorMonths: 12 };
      return { bucket: "fxd", tenorMonths: 12 };
    }

    case "de-risking": {
      // Cycle of 15: T-Bill×7, IFB×6, FXD×2; use 182-day (6-month) T-bills per PDF Rule 3
      const cycle = sweepCountInPhase % 15;
      if (cycle < 7) return { bucket: "tbill", tenorMonths: 6 };
      if (cycle < 13) return { bucket: "ifb", tenorMonths: 12 };
      return { bucket: "fxd", tenorMonths: 12 };
    }

    case "final-liquidity":
      // No new long bonds; 91-day (3-month) T-bills per PDF Rule 3
      return { bucket: "tbill", tenorMonths: 3 };

    default:
      return null;
  }
}

// ─── Main projection engine ───────────────────────────────────────────────────

/**
 * Run the full 120-month projection simulation.
 *
 * @param settings         - Rate and plan settings.
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
  const overrideMap = new Map<number, MonthlyContributionOverride>();
  for (const o of overrides) overrideMap.set(o.monthNumber, o);

  // Determine current month from today vs startDate
  const startDate = new Date(
    (settings.startDate ?? new Date().toISOString().split("T")[0]) + "T12:00:00Z"
  );
  const today = new Date();
  const monthsSinceStart = Math.floor(
    (today.getFullYear() - startDate.getFullYear()) * 12 +
    (today.getMonth() - startDate.getMonth())
  );
  // currentMonth is 1-based; month 1 = startDate month
  // If today is before startDate, currentMonth = 0 (pure forecast)
  const currentMonth = Math.max(0, Math.min(monthsSinceStart, 120));
  const hasActuals = actualDeposits.length > 0 || actualSecurities.length > 0;

  const results: MonthResult[] = [];

  // ── State variables ──────────────────────────────────────────────────────────
  let mmf = 0;
  // Active security lots in DhowCSD
  let lots: SecurityLot[] = [];
  let lotIdCounter = 0;

  // Sweep counter per phase (resets when phase changes)
  let sweepCount = 0;
  let lastPhase = "";

  // ── Seed from actuals for past months ────────────────────────────────────────
  // For months 1..currentMonth, we use actual deposit data to set the starting
  // balances, then let the forecast engine continue from there.
  //
  // Strategy: compute actual bucket balances up to today from deposit entries,
  // then seed the simulation state at the boundary month.
  let actualsMMF = 0;
  let actualsTbillFace = 0;
  let actualsIfbFace = 0;
  let actualsFxdFace = 0;

  if (hasActuals && currentMonth > 0) {
    // Sum deposits by bucket up to today
    for (const d of actualDeposits) {
      const amt = d.amount;
      if (d.bucket === "mmf") actualsMMF += amt;
      else if (d.bucket === "tbill") actualsTbillFace += amt;
      else if (d.bucket === "ifb") actualsIfbFace += amt;
      else if (d.bucket === "fxd") actualsFxdFace += amt;
    }

    // Build lots from actual securities that are still active
    for (const sec of actualSecurities) {
      if (sec.isMatured) continue;
      const issueDate = new Date(sec.issueDate + "T12:00:00Z");
      const matDate = new Date(sec.maturityDate + "T12:00:00Z");
      const issueMonthOffset = Math.floor(
        (issueDate.getFullYear() - startDate.getFullYear()) * 12 +
        (issueDate.getMonth() - startDate.getMonth())
      );
      const issueMonth = issueMonthOffset + 1; // 1-based
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

  // ── Month loop ───────────────────────────────────────────────────────────────
  for (let m = 1; m <= 120; m++) {
    const monthDate = new Date(startDate);
    monthDate.setMonth(monthDate.getMonth() + (m - 1));

    const rates = getRatesForMonth(monthDate, rateHistory, settings);
    const wht = rates.withholdingTax / 100;

    // Net monthly MMF rate (gross yield, WHT applied)
    const mmfNetAnnual = netYield(rates.mmfYield, rates.withholdingTax);
    const mmfMonthly = monthlyRate(mmfNetAnnual);

    const phase = getPhase(m);
    const override = overrideMap.get(m);

    if (phase !== lastPhase) {
      sweepCount = 0;
      lastPhase = phase;
    }

    const isActualMonth = hasActuals && m <= currentMonth;

    // ── Seed state at the actuals boundary ──────────────────────────────────
    // At month = currentMonth + 1 (first forecast month), inject actual balances
    // as the starting state instead of the simulated state.
    if (hasActuals && m === currentMonth + 1 && currentMonth > 0) {
      mmf = actualsMMF;
      // lots already seeded from actual securities above; keep them
    }

    // ── Step 1: Contribution ─────────────────────────────────────────────────
    let contribution = 0;
    let whtThisMonth = 0;

    if (!isActualMonth) {
      const scheduled = getScheduledContribution(m, settings);
      contribution = override?.overrideAmount !== undefined ? override.overrideAmount : scheduled;
      const lumpSum = override?.lumpSum ?? 0;
      contribution += lumpSum;
      mmf += contribution;
    } else {
      // For actual months, contribution = sum of actual MMF deposits this month
      // (We already added all actuals to actualsMMF above; here we just record the
      //  scheduled amount for display purposes — the actual balance is seeded at boundary)
      contribution = getScheduledContribution(m, settings);
    }

    // ── Step 2: MMF monthly compounding (only for forecast months) ───────────
    if (!isActualMonth) {
      const grossInterest = mmf * monthlyRate(rates.mmfYield / 1); // gross monthly
      // Actually: compound at net rate (WHT already applied in netYield)
      const interestGross = mmf * monthlyRate(rates.mmfYield);
      const interestWHT = interestGross * wht;
      whtThisMonth += interestWHT;
      mmf = mmf * (1 + mmfMonthly);
    }

    // ── Step 3: Process lots — coupons and maturities ────────────────────────
    let cbkCashIn = 0;
    const cbkActions: string[] = [];
    const survivingLots: SecurityLot[] = [];

    for (const lot of lots) {
      const age = m - lot.issueMonth; // months since purchase

      if (age < 0) {
        // Lot not yet issued (shouldn't happen in normal flow)
        survivingLots.push(lot);
        continue;
      }

      // ── Maturity ─────────────────────────────────────────────────────────
      if (age === lot.tenorMonths) {
        // Return face value to MMF
        cbkCashIn += lot.faceValue;
        cbkActions.push(`${lot.bucket.toUpperCase()} maturity KES ${Math.round(lot.faceValue).toLocaleString()}`);

        if (lot.bucket === "tbill") {
          // T-bill: discount (net interest) flows to MMF at maturity
          const tenorYears = lot.tenorMonths / 12;
          const grossInterest = lot.faceValue * (rates.tbill364Rate / 100) * tenorYears;
          const netInterest = grossInterest * (1 - wht);
          whtThisMonth += grossInterest * wht;
          cbkCashIn += netInterest;
          cbkActions.push(`T-bill net discount KES ${Math.round(netInterest).toLocaleString()}`);
        }
        // Bond face value already added above; coupons handled separately below
        // Do NOT add lot to survivingLots — it's matured
        continue;
      }

      // ── Semi-annual coupon (bonds only) ──────────────────────────────────
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

    // ── Step 4: Sweep — buy floor((mmf - safetyFloor) / 50000) lots ─────────
    let mmfToDhow = 0;
    let sweepTarget: "tbill" | "ifb" | "fxd" | null = null;

    // No new long bonds in final 18 months (M103–120) — only T-bills allowed
    const noNewLongBonds = m >= 103;

    if (!isActualMonth) {
      const maxLots = Math.floor((mmf - settings.safetyFloor) / 50000);
      if (maxLots > 0) {
        const target = getSweepTargetForMonth(m, sweepCount);
        if (target) {
          // In final-liquidity phase, only T-bills
          const effectiveBucket = noNewLongBonds && target.bucket !== "tbill"
            ? { bucket: "tbill" as const, tenorMonths: 3 }
            : target;

          sweepTarget = effectiveBucket.bucket;
          const lotsCount = maxLots;
          const totalSweep = lotsCount * 50000;

          if (mmf - totalSweep >= settings.safetyFloor) {
            mmf -= totalSweep;
            mmfToDhow = totalSweep;

            // Create individual lots
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

    // ── Compute bucket totals from lots ──────────────────────────────────────
    // T-bills are valued at face value PLUS accrued net discount (mark-to-maturity).
    // This matches the spec's portfolio value which includes unrealised T-bill returns.
    // IFB and FXD are held at face value (coupons are cash, not accrued).
    let tbillEnd = 0;
    let ifbEnd = 0;
    let fxdEnd = 0;
    for (const lot of lots) {
      if (lot.bucket === "tbill") {
        // Accrued net discount = face × (net annual rate) × (age / 12)
        const age = m - lot.issueMonth; // months elapsed since purchase
        const tenorYears = lot.tenorMonths / 12;
        const grossDiscount = lot.faceValue * (rates.tbill364Rate / 100) * tenorYears;
        const netDiscount = grossDiscount * (1 - wht);
        // Accrue linearly over the tenor
        const accruedDiscount = age > 0 ? netDiscount * (age / lot.tenorMonths) : 0;
        tbillEnd += lot.faceValue + accruedDiscount;
      } else if (lot.bucket === "ifb") {
        ifbEnd += lot.faceValue;
      } else if (lot.bucket === "fxd") {
        fxdEnd += lot.faceValue;
      }
    }

    // ── Build action description ──────────────────────────────────────────────
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
  return stepUps.map((stepUp) => {
    const settings = { ...baseSettings, stepUpAmount: stepUp };
    const results = runProjection(settings, [], rateHistory);
    const last = results[results.length - 1];

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

// ─── Milestones ───────────────────────────────────────────────────────────────

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
