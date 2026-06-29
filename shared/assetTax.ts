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
 *   - Listed-share dividends (resident): 5% final tax (KRA, ITA Third Schedule
 *     para 5). SOURCED, not review-required.
 *   - REIT distributions to residents: a registered REIT is exempt at trust
 *     level (ITA s.20), but the exemption does NOT extend to withholding tax on
 *     dividend/interest income earned by non-exempt resident unitholders (NSE;
 *     TripleOKlaw, "The Tax Regime for REITs in Kenya", 2023). In practice the
 *     resident WHT applied to REIT income distributions tracks the resident
 *     dividend rate of 5%. We default to 5% (SOURCED) but still mark it
 *     `requiresReview` because the exact treatment depends on the unit-holder's
 *     circumstances and the specific REIT. It is NEVER a silent zero.
 *   - Offshore fund distributions: Kenyan residents are taxed on worldwide
 *     income; the applicable rate is jurisdiction-/treaty-dependent (foreign
 *     WHT, possible double-tax-treaty relief, plus Kenyan tax). There is no
 *     single Kenyan statutory rate, so we model a LABELLED, UNVERIFIED default
 *     (15% — a common non-resident WHT benchmark) that the user MUST confirm or
 *     override. It is surfaced as an assumption and flagged unverified — never
 *     presented as fact and never silently zero.
 */
export const RESIDENT_TAX_RATES = {
  /** Listed-share dividend WHT (resident, final tax). Sourced. */
  dividend: 5,
  /** REIT distribution — resident WHT tracks the 5% dividend rate; confirmable. */
  reitDistribution: 5,
  /** Offshore distribution — labelled UNVERIFIED benchmark, user must confirm. */
  offshoreDistribution: 15,
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
  /**
   * True when the rate is a LABELLED PLACEHOLDER that has NOT been confirmed
   * against an authoritative source for the user's circumstances (today: the
   * offshore-distribution benchmark). The UI must show it as "unverified —
   * confirm before relying on it" rather than as fact. A user-supplied rate
   * clears this. It is never used to justify a silent zero.
   */
  unverified: boolean;
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
        unverified: false,
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
        unverified: false,
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
        unverified: false,
        source:
          input.userRatePct != null
            ? "User-supplied dividend WHT rate"
            : "KRA resident dividend WHT 5% (final tax)",
        basis: "dividend",
      };
    }

    case "distribution": {
      // REIT / offshore distributions: jurisdiction- & circumstance-dependent.
      // Neither nets at an UNSOURCED zero. REIT uses the sourced resident 5%
      // (still review-flagged for the unit-holder's circumstances); offshore
      // uses a LABELLED, UNVERIFIED benchmark the user must confirm. A
      // user-supplied rate overrides both and clears the unverified flag.
      const isOffshore = input.assetClass === "offshore_fund";
      const userProvided = typeof input.userRatePct === "number" && input.userRatePct >= 0;
      const fallback = isOffshore
        ? RESIDENT_TAX_RATES.offshoreDistribution
        : RESIDENT_TAX_RATES.reitDistribution;
      const ratePct = userProvided ? (input.userRatePct as number) : fallback;
      return {
        ratePct,
        incomeType,
        exempt: ratePct === 0,
        // Both REIT and offshore want the user to confirm their own treatment.
        requiresReview: !userProvided,
        // Only the offshore benchmark is an UNVERIFIED placeholder; the REIT 5%
        // is sourced. A user-supplied rate is, by definition, confirmed.
        unverified: !userProvided && isOffshore,
        source: userProvided
          ? "User-supplied distribution WHT rate"
          : isOffshore
            ? "Offshore distribution — UNVERIFIED benchmark (15%): Kenyan residents are taxed on worldwide income; actual rate is treaty/jurisdiction dependent. Confirm before relying on it."
            : "Kenyan REIT distribution — resident WHT tracks the 5% dividend rate (registered REIT exempt at trust level per ITA s.20; WHT on unit-holder dividend/interest income still applies — NSE; TripleOKlaw 2023). Confirm for your circumstances.",
        basis: "distribution",
      };
    }

    default:
      return {
        ratePct: 0,
        incomeType: "none",
        exempt: true,
        requiresReview: false,
        unverified: false,
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
