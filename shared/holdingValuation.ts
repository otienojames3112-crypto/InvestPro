/**
 * Expansion Brief — Part 4: Projection-engine extension.
 *
 * THE single, BehaviorProfile-driven valuation router for every asset class. The
 * engine and previews call `projectHoldingValue(holding, monthIndex, scenario)`
 * and it dispatches on `BehaviorProfile.valuation` — there is NO
 * `if (assetClass === 'equity')` scattered anywhere else. New classes are wired
 * by adding a case here, never a new branch in the engine.
 *
 *   daily_accrual      → MMF: balance compounds (delegated to the caller's
 *                        accrual; not re-implemented here — MMF lives in the
 *                        engine's compounding loop and is UNCHANGED).
 *   accretion_to_face  → discount paper: delegates to shared/discount.ts.
 *   par_plus_coupon    → coupon bond: par + accrued coupon, PLUS an optional
 *                        duration mark-to-model adjustment for long bonds.
 *   market_price       → value = units × projectedUnitPrice (× projectedFxRate
 *                        for FX-exposed offshore holdings).
 *
 * Honesty rules baked in (formalized further in Part 6):
 *   - A price-driven value is ALWAYS assumption-dependent (driven by the user's
 *     own assumed return), never an engine forecast.
 *   - If the user gives no return view, price is held FLAT (capital growth 0) so
 *     the only modeled return is income — conservative, never silent appreciation.
 *   - FX is held FLAT at entry in the base case; depreciation is never baked in
 *     as "return". A user-supplied FX drift is honored if provided.
 *   - Held-to-maturity bond cashflows are unchanged; duration only moves the
 *     mark-to-model "value if sold today".
 *
 * Framework-free + deterministic; safe to import on client and server.
 */

import {
  type AssetClass,
  type BehaviorProfile,
  ASSET_PROFILES,
} from "./assetModel";
import { taxFor, type TaxForInput } from "./assetTax";
import { currentSecurityValue, type CurrentValueSecurity } from "./discount";

/** Same day-count + cadence the rest of the engine uses. */
export const DAYS_PER_YEAR = 365;
export const MONTHS_PER_YEAR = 12;

/** The three scenario presets. The base line uses "base"; Part 6 presents the band. */
export type Scenario = "conservative" | "base" | "optimistic";

/* ───────────────────────── Return decomposition ──────────────────────── */

/**
 * Split the user's assumed TOTAL annual return into income vs capital growth so
 * income is never double-counted as both a cash distribution and price growth.
 *
 *   capitalGrowth = total − income
 *
 * When the user gives no total-return view, capital growth is 0 (price flat) and
 * the only modeled return is the income rate. Income rate defaults to 0 too if
 * unknown — we never invent appreciation.
 */
export interface ReturnAssumption {
  /** User's assumed TOTAL annual return %/yr for the chosen scenario. */
  totalReturnPct: number | null | undefined;
  /** User's assumed INCOME (dividend/distribution/coupon) rate %/yr. */
  incomeRatePct: number | null | undefined;
}

export interface DecomposedReturn {
  totalPct: number;
  incomePct: number;
  capitalGrowthPct: number;
  /** True when no total-return view was supplied (price held flat). */
  priceFlat: boolean;
}

export function decomposeReturn(a: ReturnAssumption): DecomposedReturn {
  const income =
    typeof a.incomeRatePct === "number" && Number.isFinite(a.incomeRatePct)
      ? Math.max(0, a.incomeRatePct)
      : 0;
  const hasTotal =
    typeof a.totalReturnPct === "number" && Number.isFinite(a.totalReturnPct);
  const total = hasTotal ? (a.totalReturnPct as number) : income;
  // Capital growth is whatever total return is left after the income portion.
  const capitalGrowth = total - income;
  return {
    totalPct: total,
    incomePct: income,
    capitalGrowthPct: capitalGrowth,
    priceFlat: !hasTotal,
  };
}

/* ───────────────────────── Price & FX projection ─────────────────────── */

/**
 * Project a unit price forward at the CAPITAL-GROWTH rate (total − income),
 * compounded monthly over `monthIndex` months. Smooth in the base line; Part 6
 * wraps it in a volatility band. Price held flat when capital growth is 0.
 */
export function projectedUnitPrice(
  entryUnitPrice: number,
  capitalGrowthPctPerYear: number,
  monthIndex: number,
): number {
  const p0 = Number(entryUnitPrice) || 0;
  if (p0 <= 0) return 0;
  const monthly = capitalGrowthPctPerYear / 100 / MONTHS_PER_YEAR;
  return p0 * Math.pow(1 + monthly, Math.max(0, monthIndex));
}

/**
 * Project the FX rate (KES per native ccy). Base case: FLAT at the entry rate —
 * shilling depreciation is NEVER assumed as return. A user-supplied annual drift
 * (%/yr) is honored only when explicitly provided.
 */
export function projectedFxRate(
  entryFxRate: number,
  monthIndex: number,
  fxDriftPctPerYear: number | null | undefined = null,
): number {
  const fx0 = Number(entryFxRate) || 0;
  if (fx0 <= 0) return 0;
  if (typeof fxDriftPctPerYear !== "number" || !Number.isFinite(fxDriftPctPerYear) || fxDriftPctPerYear === 0) {
    return fx0; // flat — the honest default
  }
  const monthly = fxDriftPctPerYear / 100 / MONTHS_PER_YEAR;
  return fx0 * Math.pow(1 + monthly, Math.max(0, monthIndex));
}

/* ───────────────────────── Duration (long bonds) ─────────────────────── */

/**
 * Mark-to-model price sensitivity for a coupon bond:
 *   ΔPrice ≈ −modifiedDuration × Δyield × cleanPrice
 *
 * Held-to-maturity cashflows are unchanged (par + coupons); this only adjusts
 * the "value if sold today" under a rate shock. A 15-yr bond moves far more than
 * a 2-yr one for the same shock.
 *
 * `modifiedDuration` may be supplied; if absent we approximate it from tenor and
 * coupon (a standard, transparent approximation — Macaulay≈ via closed form for a
 * par bond, then modified = Macaulay / (1 + y/freq)). This is deterministic and
 * clearly an approximation, not a market quote.
 */
export function approxModifiedDuration(
  tenorYears: number,
  couponPctPerYear: number,
  yieldPctPerYear: number,
  freqPerYear = 2,
): number {
  const n = Math.max(1, Math.round(tenorYears * freqPerYear));
  const c = (couponPctPerYear / 100) / freqPerYear; // periodic coupon
  const y = (yieldPctPerYear / 100) / freqPerYear; // periodic yield
  if (y === 0) {
    // Zero-yield edge: Macaulay = weighted average time, simplifies to (n+1)/2 / freq for coupons.
    // Fall back to a flat tenor-based proxy to stay finite.
    return tenorYears / (1 + 0);
  }
  // Macaulay duration of a bond paying coupon c per period, redeemed at 1.
  let pv = 0;
  let weightedT = 0;
  for (let t = 1; t <= n; t++) {
    const cf = t === n ? c + 1 : c;
    const disc = cf / Math.pow(1 + y, t);
    pv += disc;
    weightedT += (t / freqPerYear) * disc;
  }
  if (pv <= 0) return tenorYears;
  const macaulay = weightedT / pv;
  return macaulay / (1 + y);
}

/**
 * Apply a duration-based mark-to-model adjustment to a clean price/value.
 * `deltaYieldPct` is in percentage POINTS (e.g. -2 for a −2pp rally, +1 for
 * +1pp sell-off). Returns the adjusted value.
 */
export function durationAdjustedValue(
  cleanValue: number,
  modifiedDuration: number,
  deltaYieldPct: number,
): number {
  const v = Number(cleanValue) || 0;
  if (v <= 0) return 0;
  const dPrice = -modifiedDuration * (deltaYieldPct / 100) * v;
  return Math.max(0, v + dPrice);
}

/* ───────────────────────── Income-event pipeline ─────────────────────── */

/**
 * ONE income-event mechanism for every asset class. Gross income for the period
 * is computed by the caller's cadence, then netted through the single `taxFor()`
 * decision point. The result is one uniform "income received (net)" concept the
 * ledger and reconciliation see regardless of coupon vs dividend vs distribution.
 */
export type IncomeDisposition = "sweep" | "reinvest";

export interface IncomeEvent {
  /** Gross income in KES for this event. */
  grossKes: number;
  /** WHT rate applied (%). */
  taxRatePct: number;
  /** Tax withheld (KES). */
  taxKes: number;
  /** Net income (KES) after WHT. */
  netKes: number;
  /** Where the net cash goes. */
  disposition: IncomeDisposition;
  /** Provenance of the rate (from taxFor). */
  taxSource: string;
  /** True when the rate is jurisdiction-dependent and the user should confirm. */
  requiresReview: boolean;
}

/**
 * Net a gross income amount through `taxFor()` and tag its disposition. This is
 * the single path coupons, dividends, distributions and interest all flow
 * through — no per-asset tax branch anywhere else.
 */
export function makeIncomeEvent(params: {
  grossKes: number;
  taxInput: TaxForInput;
  disposition: IncomeDisposition;
}): IncomeEvent {
  const gross = Math.max(0, Number(params.grossKes) || 0);
  const tax = taxFor(params.taxInput);
  const taxKes = gross * (Math.max(0, tax.ratePct) / 100);
  const netKes = gross - taxKes;
  return {
    grossKes: round2(gross),
    taxRatePct: tax.ratePct,
    taxKes: round2(taxKes),
    netKes: round2(netKes),
    disposition: params.disposition,
    taxSource: tax.source,
    requiresReview: tax.requiresReview,
  };
}

/* ───────────────────────── The valuation router ──────────────────────── */

/**
 * Everything `projectHoldingValue` needs. Existing classes only use the fields
 * relevant to them; price-driven classes use units/price/FX/return.
 */
export interface HoldingValuationInput {
  assetClass: AssetClass;
  /** Scenario preset driving the assumed return (price-driven only). */
  scenario: Scenario;

  /* Price-driven (equity / reit / offshore) */
  units?: number | null;
  entryUnitPrice?: number | null;
  /** Per-scenario assumed TOTAL annual return %/yr. */
  assumedReturnConservativePct?: number | null;
  assumedReturnBasePct?: number | null;
  assumedReturnOptimisticPct?: number | null;
  /** Assumed income (dividend/distribution) rate %/yr. */
  incomeRatePct?: number | null;
  /** FX (offshore only): entry rate KES per ccy + optional drift. */
  entryFxRate?: number | null;
  fxDriftPctPerYear?: number | null;

  /* Discount / coupon (delegates to discount.ts) */
  security?: CurrentValueSecurity | null;
  /** Duration mark-to-model: yield shock in pp and a modified duration (or tenor to approximate). */
  rateShockPct?: number | null;
  modifiedDuration?: number | null;
  tenorYears?: number | null;
  couponPctPerYear?: number | null;
  yieldPctPerYear?: number | null;

  /* Daily-accrual (MMF) — value passed through unchanged. */
  accruedValue?: number | null;
}

/** Pick the scenario's assumed total return. */
export function scenarioReturnPct(
  inp: HoldingValuationInput,
): number | null | undefined {
  switch (inp.scenario) {
    case "conservative":
      return inp.assumedReturnConservativePct;
    case "optimistic":
      return inp.assumedReturnOptimisticPct;
    case "base":
    default:
      return inp.assumedReturnBasePct;
  }
}

/**
 * THE single valuation router. Returns the holding's value (KES) at `monthIndex`
 * months from entry, under the chosen scenario.
 */
export function projectHoldingValue(
  inp: HoldingValuationInput,
  monthIndex: number,
): number {
  const profile: BehaviorProfile = ASSET_PROFILES[inp.assetClass];
  if (!profile) return 0;

  switch (profile.valuation) {
    case "daily_accrual":
      // MMF: the engine owns the compounding loop; value passes through here
      // unchanged so the router is the SINGLE entry point without re-deriving it.
      return round2(Number(inp.accruedValue) || 0);

    case "accretion_to_face":
    case "par_plus_coupon": {
      // Delegate to the existing shared bond/discount valuation (UNCHANGED), then
      // — for coupon bonds only — apply the optional duration mark-to-model shock.
      if (!inp.security) return 0;
      const base = currentSecurityValue(inp.security);
      const shock = Number(inp.rateShockPct) || 0;
      if (profile.valuation === "par_plus_coupon" && shock !== 0) {
        const md =
          typeof inp.modifiedDuration === "number" && inp.modifiedDuration > 0
            ? inp.modifiedDuration
            : approxModifiedDuration(
                Number(inp.tenorYears) || 0,
                Number(inp.couponPctPerYear) || 0,
                Number(inp.yieldPctPerYear) || Number(inp.couponPctPerYear) || 0,
              );
        return round2(durationAdjustedValue(base, md, shock));
      }
      return round2(base);
    }

    case "market_price": {
      // value = units × projectedUnitPrice (× FX for offshore).
      const units = Number(inp.units) || 0;
      const p0 = Number(inp.entryUnitPrice) || 0;
      if (units <= 0 || p0 <= 0) return 0;
      const dec = decomposeReturn({
        totalReturnPct: scenarioReturnPct(inp),
        incomeRatePct: inp.incomeRatePct,
      });
      const price = projectedUnitPrice(p0, dec.capitalGrowthPct, monthIndex);
      let value = units * price;
      if (profile.fxExposed) {
        const fx = projectedFxRate(
          Number(inp.entryFxRate) || 0,
          monthIndex,
          inp.fxDriftPctPerYear ?? null,
        );
        value = value * fx;
      }
      return round2(value);
    }

    default:
      return 0;
  }
}

/* ───────────────────────── helpers ───────────────────────────────────── */

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}


/* ───────────────────── Income schedule + horizon projection ───────────── */

/**
 * Income payment cadence per year. Equities/REITs typically pay 1–2x; we let the
 * caller specify but default to the brief's "on a schedule" (annual) so income
 * lands as discrete events, not a silent daily drip.
 */
export type IncomeCadence = "annual" | "semiannual" | "quarterly" | "none";

export function paymentsPerYear(c: IncomeCadence): number {
  switch (c) {
    case "semiannual":
      return 2;
    case "quarterly":
      return 4;
    case "annual":
      return 1;
    case "none":
    default:
      return 0;
  }
}

/**
 * Project a single price-driven holding to a horizon, decomposing the user's
 * assumed total return into capital growth (price) and income (dividends/
 * distributions paid on a schedule and netted through `taxFor()`).
 *
 * Returns BOTH the capital value and the accumulated net income so the caller
 * can decide whether income is swept to the liquid pot or reinvested. The two
 * are kept distinct so income is never silently double-counted as price growth.
 *
 * This is THE per-holding projection both the preview and any engine wiring use.
 */
export interface HoldingProjectionInput {
  assetClass: AssetClass;
  scenario: Scenario;
  /** Entry value in KES (units × price × fx already resolved by the caller). */
  entryValueKes: number;
  /** Per-scenario assumed TOTAL annual return %/yr (capital + income). */
  assumedReturnConservativePct?: number | null;
  assumedReturnBasePct?: number | null;
  assumedReturnOptimisticPct?: number | null;
  /** Assumed income (dividend/distribution) rate %/yr. */
  incomeRatePct?: number | null;
  /** Income payment cadence. */
  cadence?: IncomeCadence;
  /** Where net income goes each payment. */
  incomeDisposition?: IncomeDisposition;
  /** User-supplied WHT rate for distribution-type income (REIT/offshore). */
  userTaxRatePct?: number | null;
  /** Projection horizon in years. */
  horizonYears: number;
}

export interface HoldingProjectionResult {
  /** Capital value at horizon (price-driven growth only). */
  capitalValue: number;
  /** Total NET income received over the horizon. */
  incomeReceivedNet: number;
  /** Total income tax withheld over the horizon. */
  incomeTaxPaid: number;
  /**
   * If income is REINVESTED, the income is folded back into capital; if SWEPT,
   * `endValue` is capital only and income is returned separately. `endValue`
   * always reflects the disposition so the caller shows one honest number.
   */
  endValue: number;
  /** True when the modeled rate is jurisdiction-dependent (user should confirm). */
  taxRequiresReview: boolean;
  taxRatePct: number;
  /** True when price was held flat (no total-return view supplied). */
  priceFlat: boolean;
}

function pickScenarioReturn(inp: HoldingProjectionInput): number | null | undefined {
  switch (inp.scenario) {
    case "conservative":
      return inp.assumedReturnConservativePct;
    case "optimistic":
      return inp.assumedReturnOptimisticPct;
    case "base":
    default:
      return inp.assumedReturnBasePct;
  }
}

export function projectHoldingToHorizon(
  inp: HoldingProjectionInput,
): HoldingProjectionResult {
  const profile = ASSET_PROFILES[inp.assetClass];
  const entry = Math.max(0, Number(inp.entryValueKes) || 0);
  const years = Math.max(0, Number(inp.horizonYears) || 0);
  const months = Math.round(years * MONTHS_PER_YEAR);

  const dec = decomposeReturn({
    totalReturnPct: pickScenarioReturn(inp),
    incomeRatePct: inp.incomeRatePct,
  });

  // Income tax rate resolved ONCE through the single decision point.
  const taxInput: TaxForInput = {
    assetClass: inp.assetClass,
    userRatePct: inp.userTaxRatePct ?? null,
  };
  const tax = taxFor(taxInput);

  const cadence: IncomeCadence = inp.cadence ?? (profile.incomeType === "coupon" ? "semiannual" : "annual");
  const ppy = paymentsPerYear(cadence);
  const disposition: IncomeDisposition = inp.incomeDisposition ?? "sweep";

  // Annual-equivalent monthly growth factor: (1+g)^(1/12). This makes the
  // no-income case reproduce the prior annual compounding `(1+g)^years`
  // bit-for-bit, while still letting income events land on a monthly schedule.
  const g = dec.capitalGrowthPct / 100;
  const monthlyFactor = g === 0 ? 1 : Math.pow(1 + g, 1 / MONTHS_PER_YEAR);

  let capital = entry;
  let incomeNetTotal = 0;
  let incomeTaxTotal = 0;

  // Monthly walk so income events land on schedule and reinvested income starts
  // compounding from its payment month — not approximated at the end.
  const monthsBetweenPayments = ppy > 0 ? Math.round(MONTHS_PER_YEAR / ppy) : 0;
  for (let m = 1; m <= months; m++) {
    // Capital grows each month at the capital-growth rate (flat when priceFlat).
    capital = capital * monthlyFactor;

    // Income event when due.
    if (monthsBetweenPayments > 0 && m % monthsBetweenPayments === 0 && dec.incomePct > 0) {
      // Gross income for this period = income rate × period fraction × capital base.
      const periodFraction = 1 / ppy;
      const gross = capital * (dec.incomePct / 100) * periodFraction;
      const taxKes = gross * (Math.max(0, tax.ratePct) / 100);
      const net = gross - taxKes;
      incomeNetTotal += net;
      incomeTaxTotal += taxKes;
      if (disposition === "reinvest") {
        capital += net; // DRIP — net income buys more, compounds onward
      }
    }
  }

  const capitalValue = round2(capital);
  const incomeReceivedNet = round2(incomeNetTotal);
  const incomeTaxPaid = round2(incomeTaxTotal);
  const endValue =
    disposition === "reinvest" ? capitalValue : capitalValue; // income swept out is tracked separately

  return {
    capitalValue,
    incomeReceivedNet,
    incomeTaxPaid,
    endValue: round2(endValue),
    taxRequiresReview: tax.requiresReview,
    taxRatePct: tax.ratePct,
    priceFlat: dec.priceFlat,
  };
}
