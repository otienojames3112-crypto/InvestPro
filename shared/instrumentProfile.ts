/**
 * Round 97 — Full Instrument Profile Model.
 *
 * Reference catalogues are upgraded from thin rows (name + rate) into rich
 * instrument profiles. Each catalogue row carries an `extendedFields` JSON
 * column typed by this module. The model is split into:
 *
 *   1. Shared fields — common to ALL catalogue types.
 *   2. Per-catalogue fields — CBK securities, MMF, bank instruments, market assets.
 *   3. Holding snapshot — the terms copied at purchase time (immutable provenance).
 *   4. Source classification — what kind of document the AI is looking at.
 *
 * Design principles:
 *   - A field marked `null` means "not applicable" or "not yet populated."
 *   - A field set to the string `"missing_from_source"` means the AI looked for
 *     it in the source document but it was genuinely absent. This is distinct from
 *     null (never looked) and from zero (a real value of 0).
 *   - Later catalogue edits NEVER mutate a historical holding's snapshot.
 *   - The AI NEVER invents values for fields it cannot find — it marks them missing.
 */

// ─── Source Classification ───────────────────────────────────────────────────

export const SOURCE_CLASSES = [
  "mmf_factsheet",
  "mmf_benchmark",
  "bank_product_page",
  "bank_rate_card",
  "cbk_tbill_auction",
  "cbk_tbill_auction_result",
  "cbk_bond_prospectus",
  "cbk_bond_reopening",
  "market_asset_factsheet",
  "market_asset_price",
  "unknown",
] as const;

export type SourceClass = (typeof SOURCE_CLASSES)[number];

export function isSourceClass(v: string): v is SourceClass {
  return (SOURCE_CLASSES as readonly string[]).includes(v);
}

/** Human-readable label for each source class. */
export const SOURCE_CLASS_LABELS: Record<SourceClass, string> = {
  mmf_factsheet: "MMF Factsheet",
  mmf_benchmark: "MMF Benchmark / Market Data",
  bank_product_page: "Bank Product Page",
  bank_rate_card: "Bank Rate Card",
  cbk_tbill_auction: "CBK T-bill Auction",
  cbk_tbill_auction_result: "CBK T-bill Auction Result",
  cbk_bond_prospectus: "CBK Bond Prospectus",
  cbk_bond_reopening: "CBK Bond Reopening",
  market_asset_factsheet: "Market Asset Factsheet",
  market_asset_price: "Market Asset Price",
  unknown: "Unknown / Needs Manager Guidance",
};

// ─── Verification Status (catalogue-level, distinct from per-figure provenance) ─

export const CATALOGUE_VERIFICATION_STATUSES = [
  "ai_extracted",
  "source_imported",
  "manager_verified",
  "archived",
  "stale",
] as const;

export type CatalogueVerificationStatus = (typeof CATALOGUE_VERIFICATION_STATUSES)[number];

// ─── Missing-Field Sentinel ──────────────────────────────────────────────────

/**
 * When the AI cannot find a field in the source, it stores this sentinel string
 * instead of null (which means "not applicable / not looked for") or a numeric
 * zero (which is a real value). The UI renders this as a badge "Missing from source."
 */
export const MISSING_FROM_SOURCE = "missing_from_source" as const;
export type MissingFromSource = typeof MISSING_FROM_SOURCE;

/** A field value that may be a real value, null, or explicitly missing. */
export type ProfileField<T> = T | null | MissingFromSource;

// ─── 1. Shared Fields ────────────────────────────────────────────────────────

export interface SharedProfileFields {
  /** Which catalogue this profile belongs to. */
  catalogueType: "mmf" | "bank" | "cbk" | "market_asset";
  /** Primary instrument name (may duplicate the table's own name column). */
  instrumentName?: string | null;
  /** Issuer / manager / bank. */
  issuer?: string | null;
  /** Asset class taxonomy. */
  assetClass?: string | null;
  /** ISO currency code. */
  currency?: string | null;
  /** Human-readable source label. */
  sourceLabel?: string | null;
  /** Direct URL to the authoritative source document. */
  sourceUrl?: string | null;
  /** Date the source data is as-of (ISO date string YYYY-MM-DD). */
  sourceAsOfDate?: string | null;
  /** Who verified this profile. */
  verifiedBy?: string | null;
  /** When verified (epoch ms UTC). */
  verifiedAt?: number | null;
  /** Catalogue-level verification status. */
  verificationStatus?: CatalogueVerificationStatus | null;
  /** General notes. */
  notes?: string | null;
  /** Risk-specific notes. */
  riskNotes?: string | null;
  /** Liquidity-specific notes. */
  liquidityNotes?: string | null;
  /** Tax-specific notes. */
  taxNotes?: string | null;
}

// ─── 2a. CBK Securities Profile ──────────────────────────────────────────────

export interface CbkSecurityProfile extends SharedProfileFields {
  catalogueType: "cbk";
  /** Security type enum. */
  securityType?: ProfileField<"tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd" | "zero_coupon" | "floating_rate">;
  /** Issue number, e.g. "FXD1/2022/010". */
  issueNumber?: ProfileField<string>;
  /** ISIN code. */
  isin?: ProfileField<string>;
  /** Human-readable tenor label, e.g. "10 years". */
  tenorLabel?: ProfileField<string>;
  /** Tenor in months (for bonds). */
  tenorMonths?: ProfileField<number>;
  /** Tenor in days (for T-bills). */
  tenorDays?: ProfileField<number>;
  /** Annual coupon rate (%). */
  couponRate?: ProfileField<number>;
  /** Yield to maturity / discount rate (%). */
  yieldRate?: ProfileField<number>;
  /** Clean price per KES 100 face. */
  cleanPrice?: ProfileField<number>;
  /** Accrued interest per KES 100 face. */
  accruedInterestPer100?: ProfileField<number>;
  /** Dirty price per KES 100 face (clean + accrued). */
  dirtyPrice?: ProfileField<number>;
  /** Withholding tax rate (%). */
  withholdingTaxRate?: ProfileField<number>;
  /** Whether the instrument is tax-exempt (IFB). */
  taxExempt?: ProfileField<boolean>;
  /** Maturity date (ISO date string). */
  maturityDate?: ProfileField<string>;
  /** Sale period start (ISO date string). */
  salePeriodStart?: ProfileField<string>;
  /** Sale period end (ISO date string). */
  salePeriodEnd?: ProfileField<string>;
  /** Bid submission deadline (ISO date string or datetime string). */
  bidSubmissionDeadline?: ProfileField<string>;
  /** Auction date (ISO date string). */
  auctionDate?: ProfileField<string>;
  /** Settlement date (ISO date string). */
  settlementDate?: ProfileField<string>;
  /** Amount on offer (KES). */
  amountOnOffer?: ProfileField<number>;
  /** Purpose of the issue. */
  purpose?: ProfileField<string>;
  /** Non-competitive bid minimum (KES). */
  nonCompetitiveMin?: ProfileField<number>;
  /** Non-competitive bid maximum (KES). */
  nonCompetitiveMax?: ProfileField<number>;
  /** Competitive bid minimum (KES). */
  competitiveMin?: ProfileField<number>;
  /** Secondary trading lot size (KES). */
  secondaryTradingLotSize?: ProfileField<number>;
  /** Rediscounting rule description. */
  rediscountingRule?: ProfileField<string>;
  /** Whether pledging is allowed. */
  pledgeAllowed?: ProfileField<boolean>;
  /** Whether this is a reopening of an existing issue. */
  reopeningAllowed?: ProfileField<boolean>;
  /** Liquidity eligibility description. */
  liquidityEligibility?: ProfileField<string>;
  /** Coupon payment dates (array of ISO date strings). */
  couponPaymentDates?: ProfileField<string[]>;
  /** Clean price table (array of rows with tenor/price pairs). */
  cleanPriceTable?: ProfileField<Array<{ label: string; price: number }>>;
}

// ─── 2b. MMF Profile ─────────────────────────────────────────────────────────

export interface MmfProfile extends SharedProfileFields {
  catalogueType: "mmf";
  /** Fund name. */
  fundName?: ProfileField<string>;
  /** Fund manager / company. */
  fundManager?: ProfileField<string>;
  /** Gross yield (% p.a.) before fees. */
  grossYield?: ProfileField<number>;
  /** Effective Annual Rate net of fees (% p.a.). */
  effectiveAnnualRate?: ProfileField<number>;
  /** Annual management fee (%). */
  managementFee?: ProfileField<number>;
  /** Minimum investment amount (KES). */
  minimumInvestment?: ProfileField<number>;
  /** Assets under management (KES millions). */
  aum?: ProfileField<number>;
  /** Day-count basis (365 or 360). */
  dayCountBasis?: ProfileField<number>;
  /** Crediting / compounding frequency. */
  creditingFrequency?: ProfileField<"daily" | "monthly" | "quarterly">;
  /** Withholding tax rate on interest (%). */
  whtRate?: ProfileField<number>;
  /** Withdrawal notice period description. */
  withdrawalNoticePeriod?: ProfileField<string>;
  /** Fund composition buckets (% of total). */
  fundComposition?: ProfileField<{
    governmentSecurities?: number | null;
    bankDeposits?: number | null;
    corporatePaper?: number | null;
    cash?: number | null;
    offshoreRegional?: number | null;
    other?: number | null;
  }>;
  /** Factsheet date (ISO date string). */
  factsheetDate?: ProfileField<string>;
}

// ─── 2c. Bank Instrument Profile ─────────────────────────────────────────────

export interface BankInstrumentProfile extends SharedProfileFields {
  catalogueType: "bank";
  /** Bank name. */
  bankName?: ProfileField<string>;
  /** Product name. */
  productName?: ProfileField<string>;
  /** Product type. */
  productType?: ProfileField<
    "call_deposit" | "fixed_deposit" | "ordinary_savings" | "target_goal_savings" | "tiered_high_yield_savings"
  >;
  /** Indicative rate (% p.a.). */
  indicativeRate?: ProfileField<number>;
  /** Confirmed / negotiated rate (% p.a.). */
  confirmedRate?: ProfileField<number>;
  /** Rate type. */
  rateType?: ProfileField<"indicative" | "negotiated" | "confirmed">;
  /** Minimum amount (KES). */
  minimumAmount?: ProfileField<number>;
  /** Tenor description. */
  tenor?: ProfileField<string>;
  /** Notice period for withdrawal. */
  noticePeriod?: ProfileField<string>;
  /** Payout frequency. */
  payoutFrequency?: ProfileField<"maturity" | "monthly" | "quarterly" | "on_call">;
  /** Compounding frequency. */
  compoundingFrequency?: ProfileField<"daily" | "monthly" | "quarterly" | "annually">;
  /** Early withdrawal penalty (% of interest forfeited). */
  earlyWithdrawalPenalty?: ProfileField<number>;
  /** Whether the rate is negotiable. */
  negotiable?: ProfileField<boolean>;
  /** Liquidity class. */
  liquidityClass?: ProfileField<string>;
  /** Withholding tax rate (%). */
  whtRate?: ProfileField<number>;
}

// ─── 2d. Market Asset Profile ────────────────────────────────────────────────

export interface MarketAssetProfile extends SharedProfileFields {
  catalogueType: "market_asset";
  /** Asset type. */
  assetType?: ProfileField<
    "equity" | "reit" | "etf" | "offshore_fund" | "property" | "sacco" | "pension" | "other"
  >;
  /** Ticker / symbol. */
  ticker?: ProfileField<string>;
  /** Exchange name. */
  exchange?: ProfileField<string>;
  /** Market price. */
  marketPrice?: ProfileField<number>;
  /** Net Asset Value. */
  nav?: ProfileField<number>;
  /** Dividend yield (%). */
  dividendYield?: ProfileField<number>;
  /** Distribution yield (%). */
  distributionYield?: ProfileField<number>;
  /** Trailing 12-month return (%). */
  trailingReturn?: ProfileField<number>;
  /** Expense ratio / fee (%). */
  fee?: ProfileField<number>;
  /** Whether there is FX risk. */
  fxRisk?: ProfileField<boolean>;
  /** Liquidity descriptor. */
  liquidity?: ProfileField<string>;
}

// ─── Union Type ──────────────────────────────────────────────────────────────

export type InstrumentProfile =
  | CbkSecurityProfile
  | MmfProfile
  | BankInstrumentProfile
  | MarketAssetProfile;

// ─── 3. Holding Snapshot ─────────────────────────────────────────────────────

/**
 * When a user records a holding from a reference catalogue row, the holding
 * stores an immutable snapshot of the catalogue terms AT PURCHASE TIME. Later
 * catalogue changes never silently rewrite this snapshot.
 */
export interface HoldingSnapshot {
  /** Which catalogue type the holding was created from. */
  referenceCatalogueType: "mmf" | "bank" | "cbk" | "market_asset";
  /** The ID of the reference row in its catalogue table. */
  referenceInstrumentId: number;
  /** The full extended-fields profile as it existed at purchase time. */
  copiedTerms: InstrumentProfile;
  /** Any purchase-specific terms entered by the user (rate negotiated, amount, etc.). */
  purchaseTerms?: Record<string, unknown> | null;
  /** Epoch ms UTC when the snapshot was taken. */
  snapshotAt: number;
  /** Source URL at the time of snapshot. */
  sourceUrl?: string | null;
  /** Source as-of date at the time of snapshot. */
  sourceAsOfDate?: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Check if a field value is the "missing from source" sentinel. */
export function isMissingFromSource(v: unknown): v is MissingFromSource {
  return v === MISSING_FROM_SOURCE;
}

/** Get the display value for a profile field, handling missing sentinel. */
export function profileFieldDisplay<T>(
  v: ProfileField<T> | undefined,
  formatter?: (val: T) => string,
): string {
  if (v === undefined || v === null) return "—";
  if (isMissingFromSource(v)) return "Missing from source";
  return formatter ? formatter(v) : String(v);
}

/**
 * Fields that the AI must NEVER invent — if not found in the source, they must
 * be marked as MISSING_FROM_SOURCE rather than guessed or set to zero.
 */
export const NEVER_INVENT_FIELDS: readonly string[] = [
  "issueNumber",
  "isin",
  "couponRate",
  "maturityDate",
  "withholdingTaxRate",
  "cleanPrice",
  "accruedInterestPer100",
  "auctionDate",
  "settlementDate",
  "salePeriodStart",
  "salePeriodEnd",
  "bidSubmissionDeadline",
  "amountOnOffer",
  "couponPaymentDates",
];

/**
 * The catalogue field keys that are required for a CBK bond prospectus extraction
 * to be considered complete (the acceptance criteria).
 */
export const CBK_BOND_REQUIRED_FIELDS: readonly string[] = [
  "securityType",
  "issueNumber",
  "tenorLabel",
  "couponRate",
  "withholdingTaxRate",
  "maturityDate",
  "salePeriodStart",
  "salePeriodEnd",
  "bidSubmissionDeadline",
  "auctionDate",
  "settlementDate",
  "amountOnOffer",
];
