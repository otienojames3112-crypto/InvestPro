/**
 * Expansion Brief — Part 1: single tax decision point.
 *
 * Today tax is computed in several places that each branch on `securityType`
 * (`whtRateForSecurity`, `govWhtPct`, `whtOnDiscount`, `WHT_RATES`). Before we
 * add equities / REITs / offshore funds, every income stream must resolve its
 * withholding through ONE function so there is no parallel tax path to drift.
 *
 * `taxFor()` is that decision point. For the income types the system already
 * understands — interest, coupon, discount — it returns EXACTLY the rates the
 * existing helpers return (it delegates to them; it does not re-derive them), so
 * no current number changes. For the new income types — dividend, distribution —
 * it returns a SOURCED rate object carrying provenance, never a silently
 * hardcoded constant baked into the engine.
 *
 * The tool INFORMS and MODELS: it reports the rate, its basis and its source.
 * It never recommends an instrument or auto-selects one for tax reasons.
 *
 * Framework-free + deterministic; safe to import on client and server.
 */

import type { AssetClass, IncomeType } from "./assetModel";
import { ASSET_PROFILES } from "./assetModel";
import { whtRateForSecurity, type SecurityType } from "./securityTenor";

/**
 * Resident KRA withholding rates used for the NEW income types. These are the
 * single declared source for dividend/distribution WHT, with provenance so the
 * UI can show "where this number came from" rather than presenting it as fact.
 *
 *   - Listed-share dividends (resident): 5% final tax (KRA).
 *   - REIT distributions to residents: special regime — registered REITs are
 *     largely exempt at trust level and distribution treatment is not a single
 *     flat statutory rate. We default to 0 (treated at trust level) but mark it
 *     `requiresReview` so a user can override with their own circumstances.
 *   - Offshore fund distributions: jurisdiction/treaty dependent; we do NOT
 *     assume a rate (0 with `requiresReview`) and require the user to supply the
 *     applicable rate. The tool models whatever rate is provided; it never
 *     fabricates one.
 */
export const RESIDENT_TAX_RATES = {
  /** Listed-share dividend WHT (resident, final tax). */
  dividend: 5,
  /** REIT distribution — special regime, user-confirmable. */
  reitDistribution: 0,
  /** Offshore distribution — treaty/jurisdiction dependent, user-supplied. */
  offshoreDistribution: 0,
} as const;

export interface TaxRateResult {
  /** Withholding rate as a percentage (e.g. 15 = 15%). */
  ratePct: number;
  /** The income category this rate applies to. */
  incomeType: IncomeType;
  /** Whether the income is fully exempt (e.g. IFB coupon). */
  exempt: boolean;
  /**
   * True when the rate is jurisdiction-/circumstance-dependent and the user
   * should confirm or override it (REIT, offshore). The tool surfaces this; it
   * does not decide on the user's behalf.
   */
  requiresReview: boolean;
  /** Human-readable provenance of the rate (statute / authority / "user-supplied"). */
  source: string;
  /** Basis the rate is applied to. */
  basis: "discount" | "coupon" | "interest" | "dividend" | "distribution" | "none";
}

export interface TaxForInput {
  assetClass: AssetClass;
  /**
   * Income type override. When omitted, the asset class's profile income type is
   * used. (Bank/MMF/discount/coupon all have a deterministic profile income.)
   */
  incomeType?: IncomeType;
  /** Government security type — REQUIRED for gov_discount / gov_coupon so the
   * existing tiered WHT helper produces the SAME rate as today. */
  securityType?: SecurityType | string | null;
  /** Bond tenor in years — consulted only for FXD tiering (existing rule). */
  tenorYears?: number | null;
  /**
   * Explicit user-supplied WHT rate (%). Used for offshore/REIT where the user
   * provides the applicable treaty/circumstance rate. The tool models it as-is.
   */
  userRatePct?: number | null;
}

/**
 * The single tax decision point. Resolves the withholding rate + provenance for
 * any asset class & income type, delegating to the existing WHT helpers for the
 * income types the system already handled so no current figure changes.
 */
export function taxFor(input: TaxForInput): TaxRateResult {
  const profile = ASSET_PROFILES[input.assetClass];
  const incomeType: IncomeType = input.incomeType ?? profile?.incomeType ?? "none";

  switch (incomeType) {
    case "discount":
    case "coupon": {
      // Government paper: reuse the EXACT existing tiered helper. IFB exempt,
      // T-bill/zero 15%, FXD tenor-tiered 15/10. No re-derivation here.
      const st = (input.securityType ?? "") as SecurityType;
      const ratePct = st
        ? whtRateForSecurity(st, input.tenorYears ?? undefined)
        : incomeType === "discount"
          ? 15
          : 15;
      return {
        ratePct,
        incomeType,
        exempt: ratePct === 0,
        requiresReview: false,
        source:
          "KRA / shared whtRateForSecurity (IFB exempt; T-bill & zero 15%; FXD tenor-tiered 15/10)",
        basis: incomeType,
      };
    }

    case "interest": {
      // MMF and bank-deposit interest: 15% resident WHT (unchanged).
      return {
        ratePct: 15,
        incomeType,
        exempt: false,
        requiresReview: false,
        source: "KRA resident interest WHT 15% (MMF / bank deposit)",
        basis: "interest",
      };
    }

    case "dividend": {
      // Listed-share dividends to residents: 5% final tax.
      const ratePct =
        typeof input.userRatePct === "number" && input.userRatePct >= 0
          ? input.userRatePct
          : RESIDENT_TAX_RATES.dividend;
      return {
        ratePct,
        incomeType,
        exempt: ratePct === 0,
        requiresReview: false,
        source:
          input.userRatePct != null
            ? "User-supplied dividend WHT rate"
            : "KRA resident dividend WHT 5% (final tax)",
        basis: "dividend",
      };
    }

    case "distribution": {
      // REIT / offshore distributions: jurisdiction- & circumstance-dependent.
      // Default conservatively and FLAG for user review rather than asserting a
      // single statutory rate.
      const isOffshore = input.assetClass === "offshore_fund";
      const fallback = isOffshore
        ? RESIDENT_TAX_RATES.offshoreDistribution
        : RESIDENT_TAX_RATES.reitDistribution;
      const ratePct =
        typeof input.userRatePct === "number" && input.userRatePct >= 0
          ? input.userRatePct
          : fallback;
      return {
        ratePct,
        incomeType,
        exempt: ratePct === 0,
        requiresReview: input.userRatePct == null,
        source:
          input.userRatePct != null
            ? "User-supplied distribution WHT rate"
            : isOffshore
              ? "Offshore distribution — treaty/jurisdiction dependent; confirm applicable rate"
              : "Kenyan REIT distribution — special regime (registered REITs largely exempt at trust level); confirm treatment",
        basis: "distribution",
      };
    }

    default:
      return {
        ratePct: 0,
        incomeType: "none",
        exempt: true,
        requiresReview: false,
        source: "No taxable income stream for this asset class",
        basis: "none",
      };
  }
}

/** Net an amount through `taxFor()` (gross − WHT). */
export function netOfTax(gross: number, input: TaxForInput): number {
  const { ratePct } = taxFor(input);
  const g = Math.max(0, gross);
  return g - g * (Math.max(0, ratePct) / 100);
}
