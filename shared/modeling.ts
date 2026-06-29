/**
 * Expansion Brief — Part 3: "Model what I chose".
 *
 * Pure, framework-free helpers that turn a CATALOG selection (an Explore
 * opportunity, Part 2) plus the USER's own investment inputs into a holding the
 * existing actuals path (`other_holdings`) can record — and that the existing
 * `buildAllocation` / `decisionSurface` math can preview WITHOUT any new source
 * of truth.
 *
 * Design rules honoured here:
 *   - The catalog only provides INDICATIVE reference values (price, yield, FX).
 *     Every figure that drives the user's holding is supplied/edited by the user;
 *     catalog values are defaults they can override.
 *   - We REUSE Part-1's `AssetClass` taxonomy and `assetGuardIssues` rather than
 *     re-deriving behavior. Price-driven / FX-exposed completeness is enforced by
 *     the same guard the register write path uses.
 *   - A price-driven holding's FUTURE value is an ASSUMPTION (user-entered return),
 *     never an engine forecast. We never invent or rank a return.
 *   - Nothing here advises, ranks, or auto-selects an amount.
 */

import {
  type AssetClass,
  profileFor,
  assetGuardIssues,
  type AssetGuardInput,
} from "./assetModel";

/**
 * The `other_holdings.assetClass` enum is the REGISTER's own (older) taxonomy.
 * It is NOT the Part-1 behavior `AssetClass`. To keep a single behavioural
 * source of truth while writing through the existing register, we map the
 * Part-1 class onto the closest register bucket. This is the ONLY place the two
 * taxonomies meet.
 */
export type RegisterAssetClass =
  | "real_estate"
  | "equity"
  | "etf"
  | "pension"
  | "sacco"
  | "business"
  | "crypto"
  | "insurance"
  | "other";

export function registerClassForAssetClass(ac: AssetClass): RegisterAssetClass {
  switch (ac) {
    case "equity":
      return "equity";
    case "reit":
      return "real_estate"; // a property fund sits with property in the register
    case "offshore_fund":
      return "etf"; // global/index funds are tracked as ETF-type holdings
    case "cash_mmf":
    case "bank_deposit":
    case "gov_discount":
    case "gov_coupon":
    case "alt":
    default:
      return "other";
  }
}

/**
 * The user's own modeling inputs. Catalog values may pre-fill these, but the
 * user owns and can edit every one. `amount` and `units` are linked through
 * `unitPrice`; callers supply whichever pair they have and we derive the rest.
 */
export interface ModelingInputs {
  assetClass: AssetClass;
  /** User's label for the holding (defaults to the catalog name). */
  name: string;
  /** Money the user is modelling putting in, in KES. */
  amountKes?: number | null;
  /** Units/shares bought (price-driven assets). */
  units?: number | null;
  /** Price per unit in the instrument's own currency. */
  unitPrice?: number | null;
  /** Instrument currency (e.g. "KES", "USD"). */
  currency?: string | null;
  /** FX rate to KES (>0) for non-KES instruments. */
  fxRateToKes?: number | null;
  /** User's assumed income rate %/yr (dividend/distribution/coupon). */
  incomeRatePct?: number | null;
  /** User's own assumed annual return scenarios (%/yr) — never engine-made. */
  assumedReturnConservative?: number | null;
  assumedReturnBase?: number | null;
  assumedReturnOptimistic?: number | null;
  /** Entry date (ISO yyyy-mm-dd) — from the clock by default. */
  entryDateIso?: string | null;
  /** Provenance carried from the catalog (source + as-of). */
  catalogRef?: string | null;
  dataSource?: string | null;
  dataAsOf?: string | null;
}

/** Derived KES amount for a holding, resolving the amount<->units<->price link. */
export function deriveAmountKes(inp: ModelingInputs): number {
  const profile = profileFor(inp.assetClass);
  const fx =
    profile.fxExposed && typeof inp.fxRateToKes === "number" && inp.fxRateToKes > 0
      ? inp.fxRateToKes
      : 1;
  // Price-driven: prefer units × price (× fx) when both present.
  if (
    profile.priceDriven &&
    typeof inp.units === "number" &&
    inp.units > 0 &&
    typeof inp.unitPrice === "number" &&
    inp.unitPrice > 0
  ) {
    return round2(inp.units * inp.unitPrice * fx);
  }
  // Otherwise fall back to the user's stated amount (already in KES).
  if (typeof inp.amountKes === "number" && inp.amountKes > 0) {
    return round2(inp.amountKes);
  }
  return 0;
}

/** Units implied by a KES amount at a given price (for the amount→units link). */
export function deriveUnits(amountKes: number, unitPrice: number, fxRateToKes = 1): number {
  if (!(unitPrice > 0) || !(fxRateToKes > 0) || !(amountKes > 0)) return 0;
  return round2(amountKes / (unitPrice * fxRateToKes));
}

/**
 * Validate a modeling input set for commit. Reuses the Part-1 guard for
 * price/FX completeness and adds the basic amount requirement. Returns a list of
 * human-readable issues (empty = valid).
 */
export function modelingIssues(inp: ModelingInputs): string[] {
  const issues: string[] = [];
  if (!inp.name || inp.name.trim() === "") issues.push("A name is required.");

  const guardInput: AssetGuardInput = {
    assetClass: inp.assetClass,
    unitPrice: inp.unitPrice ?? null,
    units: inp.units ?? null,
    dataSource: inp.dataSource ?? null,
    dataAsOf: inp.dataAsOf ?? null,
    currency: inp.currency ?? null,
    fxRateToKes: inp.fxRateToKes ?? null,
  };
  issues.push(...assetGuardIssues(guardInput));

  const amount = deriveAmountKes(inp);
  if (!(amount > 0)) {
    issues.push("Enter an amount (or units × price) greater than zero.");
  }
  return issues;
}

/**
 * Build the `other_holdings` insert payload from validated modeling inputs. The
 * caller (router) supplies the portfolioId and persists via the EXISTING
 * `addOtherHolding` helper — we never write directly. Provenance is folded into
 * `notes` so it travels with the row and the audit log.
 */
export interface HoldingDraft {
  registerAssetClass: RegisterAssetClass;
  name: string;
  description: string | null;
  purchaseValue: number;
  currentValue: number;
  purchaseDate: string | null;
  notes: string;
  assumedReturnConservative: number | null;
  assumedReturnBase: number | null;
  assumedReturnOptimistic: number | null;
}

export function buildHoldingDraft(inp: ModelingInputs): HoldingDraft {
  const amount = deriveAmountKes(inp);
  const profile = profileFor(inp.assetClass);

  // Provenance line — always attached so a modeled holding is attributable.
  const provBits: string[] = [`Modeled from Explore (${profile.label})`];
  if (inp.catalogRef) provBits.push(`ref: ${inp.catalogRef}`);
  if (typeof inp.units === "number" && inp.units > 0 && typeof inp.unitPrice === "number") {
    const cur = (inp.currency ?? "KES").toUpperCase();
    provBits.push(`${inp.units} units @ ${cur} ${inp.unitPrice}`);
  }
  if (profile.fxExposed && typeof inp.fxRateToKes === "number") {
    provBits.push(`FX ${inp.fxRateToKes} KES/${(inp.currency ?? "").toUpperCase()}`);
  }
  if (typeof inp.incomeRatePct === "number" && inp.incomeRatePct > 0) {
    provBits.push(`assumed income ${inp.incomeRatePct}%/yr`);
  }
  if (inp.dataSource) provBits.push(`source: ${inp.dataSource}`);
  if (inp.dataAsOf) provBits.push(`as of ${inp.dataAsOf}`);

  return {
    registerAssetClass: registerClassForAssetClass(inp.assetClass),
    name: inp.name.trim(),
    description: profile.label,
    // At entry, cost basis == current value (you just "bought" at this price).
    purchaseValue: amount,
    currentValue: amount,
    purchaseDate: inp.entryDateIso ?? null,
    notes: provBits.join(" · "),
    assumedReturnConservative: numOrNull(inp.assumedReturnConservative),
    assumedReturnBase: numOrNull(inp.assumedReturnBase),
    assumedReturnOptimistic: numOrNull(inp.assumedReturnOptimistic),
  };
}

/**
 * Exit / disposal economics. Selling a price-driven holding returns cash to the
 * MMF at the CURRENT value; the gain/loss is current − cost, and for price-driven
 * assets any positive gain is taxable (capital-gains-style WHT supplied by the
 * caller, e.g. via `taxFor`). This is a RETURN OF CAPITAL + realised result, NOT
 * a penalty — losses are simply negative gains, never charged as a fee.
 */
export interface ExitResult {
  proceedsGross: number;
  costBasis: number;
  gainLoss: number;
  taxOnGain: number;
  proceedsNet: number;
}

export function computeExit(params: {
  currentValue: number;
  costBasis: number;
  /** Tax rate (%) applied to a POSITIVE gain only. 0 for none. */
  gainTaxRatePct?: number;
}): ExitResult {
  const proceedsGross = Math.max(0, round2(params.currentValue));
  const costBasis = Math.max(0, round2(params.costBasis));
  const gainLoss = round2(proceedsGross - costBasis);
  const rate = Math.max(0, params.gainTaxRatePct ?? 0);
  const taxOnGain = gainLoss > 0 ? round2(gainLoss * (rate / 100)) : 0;
  const proceedsNet = round2(proceedsGross - taxOnGain);
  return { proceedsGross, costBasis, gainLoss, taxOnGain, proceedsNet };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
function numOrNull(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}


/* ───────────────────────── Preview (no-write) ─────────────────────────── */

import {
  buildAllocation,
  type AllocationInput,
  type AllocationResult,
} from "./actuals";

/**
 * The honest, source-of-truth-reusing preview of what adding a modeled holding
 * does to the picture. We deliberately do NOT touch the engine projection band:
 * `other_holdings` are net-worth/allocation items, not MMF/gov lots, so a
 * price-driven holding does not move the deterministic KES-5M engine number.
 * What it DOES change — and all we show — is:
 *   - net worth (before/after),
 *   - the allocation mix and the new holding's share,
 *   - a liquidity note IF the user is funding it by moving money OUT of the
 *     liquid pot (we never assume this silently — the caller passes the intent),
 *   - the holding's OWN assumed-return scenario (the user's assumption, labelled).
 *
 * `currentAlloc` is built by the caller from live rows via `buildAllocation`;
 * here we recompute "after" by appending the synthetic holding to the SAME
 * builder so there is exactly one allocation code path.
 */
export interface ModelPreviewInput {
  /** Everything `buildAllocation` needs for the CURRENT picture. */
  allocationInput: AllocationInput;
  /** The modeled holding (already validated/derived). */
  registerAssetClass: RegisterAssetClass;
  amountKes: number;
  /** Human label for the modeled holding's allocation slice. */
  label: string;
  /**
   * If true, the modeled amount is funded by drawing down the liquid pot
   * (primary MMF). We then show the liquid-pot reduction so the user sees the
   * liquidity trade-off honestly. If false, it is treated as new outside money
   * and net worth simply grows.
   */
  fundedFromLiquid: boolean;
  /** The user's own assumed annual return scenarios (%/yr), or nulls. */
  assumedReturnConservative?: number | null;
  assumedReturnBase?: number | null;
  assumedReturnOptimistic?: number | null;
  /** Years used for the holding's own scenario projection (plan horizon). */
  horizonYears: number;
}

export interface ModelPreviewResult {
  current: AllocationResult;
  withHolding: AllocationResult;
  netWorthBefore: number;
  netWorthAfter: number;
  netWorthDelta: number;
  /** The modeled holding's share of post-add net worth (%). */
  holdingSharePct: number;
  /** Liquid pot before/after (only differs when fundedFromLiquid). */
  liquidBefore: number;
  liquidAfter: number;
  /** True when funding it leaves the liquid pot lower (a liquidity trade-off). */
  reducesLiquidity: boolean;
  /** The holding's OWN assumed scenario values at horizon (user assumption). */
  scenario: {
    conservative: number | null;
    base: number | null;
    optimistic: number | null;
    years: number;
  };
}

export function previewModelImpact(inp: ModelPreviewInput): ModelPreviewResult {
  const current = buildAllocation(inp.allocationInput);

  // "After" reuses the SAME builder. Append the synthetic holding; when funded
  // from the liquid pot, also remove the amount from primary-MMF by adding an
  // offsetting negative MMF deposit row so the one builder nets it out.
  const afterInput: AllocationInput = {
    ...inp.allocationInput,
    otherHoldings: [
      ...inp.allocationInput.otherHoldings,
      { assetClass: inp.registerAssetClass, currentValue: inp.amountKes },
    ],
    deposits: inp.fundedFromLiquid
      ? [
          ...inp.allocationInput.deposits,
          { amount: -inp.amountKes, bucket: "mmf" as const },
        ]
      : inp.allocationInput.deposits,
    assetLabels: {
      ...(inp.allocationInput.assetLabels ?? {}),
      [inp.registerAssetClass]: inp.label,
    },
  };
  const withHolding = buildAllocation(afterInput);

  const netWorthBefore = round2(current.netWorth);
  const netWorthAfter = round2(withHolding.netWorth);
  const holdingSharePct =
    netWorthAfter > 0 ? round2((inp.amountKes / netWorthAfter) * 100) : 0;

  const liquidBefore = round2(current.primaryMmf);
  const liquidAfter = round2(withHolding.primaryMmf);

  const years = inp.horizonYears;
  const scen = (rate: number | null | undefined): number | null =>
    typeof rate === "number" && Number.isFinite(rate)
      ? round2(inp.amountKes * Math.pow(1 + rate / 100, years))
      : null;

  return {
    current,
    withHolding,
    netWorthBefore,
    netWorthAfter,
    netWorthDelta: round2(netWorthAfter - netWorthBefore),
    holdingSharePct,
    liquidBefore,
    liquidAfter,
    reducesLiquidity: inp.fundedFromLiquid && liquidAfter < liquidBefore,
    scenario: {
      conservative: scen(inp.assumedReturnConservative),
      base: scen(inp.assumedReturnBase),
      optimistic: scen(inp.assumedReturnOptimistic),
      years,
    },
  };
}
