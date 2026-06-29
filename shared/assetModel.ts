/**
 * Expansion Brief — Part 1: Generic asset abstraction.
 *
 * Today the system understands a fixed set of instruments by their
 * `securityType` (T-bill, IFB, FXD, zero-coupon, floating, MMF, bank deposits)
 * and branches on those strings throughout the engine, valuation and tax code.
 * Before we can add equities, REITs, offshore funds or longer bonds, "an asset"
 * must be describable by HOW IT BEHAVES — cash flows, valuation, liquidity, tax
 * — not by a hardcoded product name.
 *
 * This module introduces that abstraction WITHOUT changing any existing
 * behavior:
 *   - `AssetClass`        — a stable taxonomy keyed on behavior, not product.
 *   - `BehaviorProfile`   — flags/values the engine can read instead of `if FXD`.
 *   - `ASSET_PROFILES`    — one profile per class (the single source of truth).
 *   - `assetClassForSecurityType` / `assetClassForBankInstrument` — mappings that
 *     keep every existing record working and drive the DB backfill.
 *   - `assetGuardIssues`  — provenance/completeness guards for the new classes.
 *
 * It is framework-free and deterministic so it can be imported on both the
 * server (engine, routers, tax) and the client (badges, copy) with no drift.
 */

import type { SecurityType } from "./securityTenor";

/**
 * Stable taxonomy of asset classes. Each maps to a BEHAVIOR PROFILE, never a
 * product name. New classes are purely additive — existing records map onto the
 * first four and nothing about them changes.
 */
export type AssetClass =
  | "cash_mmf" // MMF — daily-accrual, liquid, no maturity
  | "bank_deposit" // call / fixed / savings — existing bank instruments
  | "gov_discount" // T-bill / zero-coupon — discount accretion to face
  | "gov_coupon" // FXD / IFB / floating — par + periodic coupon
  | "equity" // listed shares / equity funds — price-driven, dividends
  | "reit" // property funds — price-driven + distribution yield
  | "offshore_fund" // global / S&P funds — price-driven, FX-exposed
  | "alt"; // reserved for future alternatives

export const ASSET_CLASSES: readonly AssetClass[] = [
  "cash_mmf",
  "bank_deposit",
  "gov_discount",
  "gov_coupon",
  "equity",
  "reit",
  "offshore_fund",
  "alt",
] as const;

/** How an asset's value is established at a point in time. */
export type ValuationModel =
  | "accretion_to_face" // discount paper pulled toward face
  | "par_plus_coupon" // bond sits at par + accrued coupon
  | "market_price" // value = units × current market price
  | "daily_accrual"; // MMF — balance compounds daily

/** The shape of cash an asset throws off. */
export type CashflowModel =
  | "discount_at_maturity"
  | "periodic_coupon"
  | "dividend_or_distribution"
  | "none"
  | "interest_accrual";

/** The category of income for tax purposes — feeds `taxFor()`. */
export type IncomeType =
  | "coupon"
  | "dividend"
  | "distribution"
  | "interest"
  | "discount"
  | "none";

/** Deposit-insurance status — feeds the uninsured-status communication. */
export type InsuredStatus = "kdic_bank" | "none";

/**
 * The single behavior contract the engine and UI read instead of switching on
 * a product type. Adding a new asset class means adding one entry to
 * {@link ASSET_PROFILES} — never a new `if` in the engine.
 */
export interface BehaviorProfile {
  assetClass: AssetClass;
  /** Human label for chrome (plain, not jargon). */
  label: string;
  valuation: ValuationModel;
  cashflow: CashflowModel;
  /** Has a contractual redemption/maturity date (bonds/bills/FDs = true). */
  hasMaturity: boolean;
  /** Can be sold/withdrawn before any maturity (equities, REITs, MMF, call = true). */
  isLiquid: boolean;
  /** Value moves with a market price rather than accreting deterministically. */
  priceDriven: boolean;
  /** Denominated in / exposed to a non-KES currency. */
  fxExposed: boolean;
  /** Income category routed through the single `taxFor()` decision point. */
  incomeType: IncomeType;
  /** Deposit-insurance status. */
  insured: InsuredStatus;
}

/**
 * The single source of truth for per-class behavior. The first four reproduce
 * EXACTLY how the system treats existing instruments today; the rest describe
 * the new classes so later parts (valuation, tax, projection) can wire them in
 * through the same seams.
 */
export const ASSET_PROFILES: Record<AssetClass, BehaviorProfile> = {
  cash_mmf: {
    assetClass: "cash_mmf",
    label: "Money-market fund",
    valuation: "daily_accrual",
    cashflow: "interest_accrual",
    hasMaturity: false,
    isLiquid: true,
    priceDriven: false,
    fxExposed: false,
    incomeType: "interest",
    insured: "none", // MMFs are not KDIC-insured (matches existing copy)
  },
  bank_deposit: {
    assetClass: "bank_deposit",
    label: "Bank deposit",
    valuation: "daily_accrual",
    cashflow: "interest_accrual",
    hasMaturity: true, // fixed deposits mature; call/savings are liquid (see isLiquid)
    isLiquid: true, // call/savings withdrawable; fixed has a term but stays a deposit
    priceDriven: false,
    fxExposed: false,
    incomeType: "interest",
    insured: "kdic_bank", // KDIC insured to KES 500k
  },
  gov_discount: {
    assetClass: "gov_discount",
    label: "T-bill / zero-coupon",
    valuation: "accretion_to_face",
    cashflow: "discount_at_maturity",
    hasMaturity: true,
    isLiquid: false,
    priceDriven: false,
    fxExposed: false,
    incomeType: "discount",
    insured: "none",
  },
  gov_coupon: {
    assetClass: "gov_coupon",
    label: "Treasury bond",
    valuation: "par_plus_coupon",
    cashflow: "periodic_coupon",
    hasMaturity: true,
    isLiquid: false,
    priceDriven: false,
    fxExposed: false,
    incomeType: "coupon",
    insured: "none",
  },
  equity: {
    assetClass: "equity",
    label: "Listed shares / equity fund",
    valuation: "market_price",
    cashflow: "dividend_or_distribution",
    hasMaturity: false,
    isLiquid: true,
    priceDriven: true,
    fxExposed: false,
    incomeType: "dividend",
    insured: "none",
  },
  reit: {
    assetClass: "reit",
    label: "Property fund (REIT)",
    valuation: "market_price",
    cashflow: "dividend_or_distribution",
    hasMaturity: false,
    isLiquid: true,
    priceDriven: true,
    fxExposed: false,
    incomeType: "distribution",
    insured: "none",
  },
  offshore_fund: {
    assetClass: "offshore_fund",
    label: "Offshore / global fund",
    valuation: "market_price",
    cashflow: "dividend_or_distribution",
    hasMaturity: false,
    isLiquid: true,
    priceDriven: true,
    fxExposed: true,
    incomeType: "distribution",
    insured: "none",
  },
  alt: {
    assetClass: "alt",
    label: "Alternative asset",
    valuation: "market_price",
    cashflow: "none",
    hasMaturity: false,
    isLiquid: false,
    priceDriven: true,
    fxExposed: false,
    incomeType: "none",
    insured: "none",
  },
};

/** Read a behavior profile by class (single lookup the engine/UI should use). */
export function profileFor(assetClass: AssetClass): BehaviorProfile {
  return ASSET_PROFILES[assetClass];
}

/**
 * Map an existing government `securityType` to its AssetClass. This is the
 * backfill rule and keeps every current holding behaving exactly as before:
 *   T-bill / zero-coupon → gov_discount
 *   FXD / IFB / floating → gov_coupon
 */
export function assetClassForSecurityType(t: SecurityType | string): AssetClass {
  if (t === "tbill_91" || t === "tbill_182" || t === "tbill_364" || t === "zero_coupon") {
    return "gov_discount";
  }
  // ifb, fxd, floating_rate — par + periodic coupon
  return "gov_coupon";
}

/** Bank instrument enum values that currently exist in the schema. */
export type BankInstrumentType =
  | "call_deposit"
  | "fixed_deposit"
  | "ordinary_savings"
  | "target_savings"
  | "tiered_savings";

/** Every bank instrument maps to the bank_deposit class. */
export function assetClassForBankInstrument(_t: BankInstrumentType | string): AssetClass {
  return "bank_deposit";
}

/** MMF accounts map to cash_mmf. */
export function assetClassForMmf(): AssetClass {
  return "cash_mmf";
}

/**
 * Part 1 guard: a holding that is `priceDriven` MUST carry the inputs needed to
 * value it (unit price, units) and the provenance of any scraped figure
 * (dataSource, dataAsOf); an `fxExposed` holding MUST carry its currency and the
 * FX rate used. We REJECT/FLAG incomplete rows rather than silently defaulting.
 *
 * Returns a list of human-readable issues; empty array means the row is valid.
 */
export interface AssetGuardInput {
  assetClass: AssetClass;
  unitPrice?: number | null;
  units?: number | null;
  dataSource?: string | null;
  dataAsOf?: string | Date | null;
  currency?: string | null;
  fxRateToKes?: number | null;
}

export function assetGuardIssues(input: AssetGuardInput): string[] {
  const profile = ASSET_PROFILES[input.assetClass];
  const issues: string[] = [];
  if (!profile) {
    return [`Unknown asset class "${input.assetClass}".`];
  }

  if (profile.priceDriven) {
    if (!(typeof input.unitPrice === "number" && input.unitPrice > 0)) {
      issues.push("Price-driven asset requires a positive unitPrice.");
    }
    if (!(typeof input.units === "number" && input.units > 0)) {
      issues.push("Price-driven asset requires a positive units count.");
    }
    if (!input.dataSource || String(input.dataSource).trim() === "") {
      issues.push("Price-driven asset requires a dataSource (provenance).");
    }
    if (!input.dataAsOf) {
      issues.push("Price-driven asset requires a dataAsOf timestamp.");
    }
  }

  if (profile.fxExposed) {
    const cur = (input.currency ?? "").toString().trim().toUpperCase();
    if (!cur || cur === "KES") {
      issues.push("FX-exposed asset requires a non-KES currency.");
    }
    if (!(typeof input.fxRateToKes === "number" && input.fxRateToKes > 0)) {
      issues.push("FX-exposed asset requires a positive fxRateToKes.");
    }
  }

  return issues;
}

/** Convenience predicate used by write-path validation. */
export function isAssetRowComplete(input: AssetGuardInput): boolean {
  return assetGuardIssues(input).length === 0;
}
