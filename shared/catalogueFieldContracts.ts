/**
 * Catalogue field contract — Slice 8a (foundation only, 2026-07-16).
 *
 * Ask AI now scans broadly (MMFs, CBK securities, bank products, market assets,
 * macro/context) and can extract far more detail from a source than the Reference
 * Catalogue should ever store as first-class columns. This module is the single,
 * shared, framework-free definition of the FIXED "quick-decision" field set for
 * each catalogue category and market-asset subtype — the established fields a
 * manager maps an AI finding INTO, not whatever keys a given extraction happened to
 * produce. It is descriptive/documentary in this slice: nothing here is imported by
 * `buildPromotionPlan`, `checkApprovalGate`, the Review Queue, or any catalogue UI
 * yet. Wiring it in is later, staged work (see the design report this slice
 * followed) — this slice only establishes the contract itself, verified against the
 * CURRENT schema/promotion/UI reality, so later slices have one place to work from
 * instead of re-deriving it.
 *
 * Two different kinds of truth live on each field entry — don't conflate them:
 *   - `storageStatus` is a FACT about the code as it exists today (verified against
 *     drizzle/schema.ts, shared/instrumentProfile.ts, and
 *     shared/researchPipeline.ts's `buildPromotionPlan`/`CATALOGUE_FIELD_RULES` at
 *     the time this file was written). It says where the value actually lives now.
 *   - `required` / `managerEditable` / `showInTable` / `promoteToCatalogueRow` are
 *     this CONTRACT's intended/target design for the field — what a manager
 *     mapping a finding should be able to do with it once later slices wire this
 *     contract into the real workflow. They do NOT assert that today's code
 *     already behaves this way. Where today's code falls short of the target, the
 *     field's `note` says so explicitly (e.g. "column exists but
 *     `buildPromotionPlan` does not set it yet").
 *
 * `storageStatus` values:
 *   - "column"                 — a real, already-promoted column on the catalogue
 *                                 table (`mmf_funds` | `bank_instruments` |
 *                                 `opportunities`).
 *   - "extendedFields"         — lives today only inside the row's
 *                                 `extendedFields: json` (`InstrumentProfile`)
 *                                 column, not a first-class column.
 *   - "computed"                — never stored; derivable from other fields at
 *                                 display time (e.g. net return after WHT).
 *   - "sourceOnly"              — deliberately never a catalogue column; stays
 *                                 visible only via the attached source document.
 *                                 Unused by the fixed field lists in THIS slice
 *                                 (every field below was explicitly requested as an
 *                                 established quick-decision field), but kept in
 *                                 the type for fields added to a contract later
 *                                 that genuinely should stay source-only.
 *   - "missingRequiresMigration" — no column and no `extendedFields` home today; a
 *                                 later DB (and often extraction-schema) migration
 *                                 would be needed before this field can be
 *                                 populated at all.
 *
 * Desired field lists are taken verbatim (as the literal source of truth) from the
 * approved product requirement. One normalization: "Occupancy rate, if available"
 * became label "Occupancy rate" + `required: false` (the ", if available" describes
 * optionality, not the label text itself) — noted on that field.
 *
 * GLOBAL PROVENANCE RULE (added on review, before this slice was approved): every
 * Reference Catalogue row must carry an openable source link so a user can open the
 * supporting document, plus its as-of date. This overrides any per-category desired
 * list that happened to omit one — CBK's desired list did not separately list a
 * source field at all, and MMF's list named only "Source link" (no as-of). But
 * `CATALOGUE_FIELD_RULES` (shared/researchPipeline.ts) already requires BOTH
 * `source` and `asOf` today for ALL FOUR base catalogues (mmf/bank/cbk/
 * market_asset), so omitting either here — for any catalogue — would have made
 * this contract WEAKER than the existing approval gate. Every one of the 7 active
 * contracts below therefore carries a `sourceLink` field (the openable document/
 * link) and a `sourceAsOf` field (its as-of date), applying the same reasoning
 * uniformly rather than only to the catalogue explicitly called out.
 *
 * Canonical key: `sourceLink` is used for the openable-source field on every
 * contract (MMF's desired list already named it "Source link"; Bank's own
 * `research_updates`/DB-column convention just calls it `source` — this contract
 * picks ONE consistent key across all seven and documents each catalogue's real
 * underlying storage name via `aliases` instead of letting the key vary per
 * catalogue). Bank's field's `key` changed from `source` to `sourceLink` for this
 * consistency; its display `label` stays "Source" exactly as the product
 * requirement gave it — only the internal key was unified.
 *
 * SACCO structural note: `opportunities.assetClass` has no distinct "sacco" value
 * (SACCOs fall under the generic "alt" bucket, detected only via
 * `shared/researchPipeline.ts`'s `detectMarketAssetSacco()` heuristic or
 * `extendedFields.assetType === "sacco"`). This is a bigger gap than any single
 * missing field — a manager cannot reliably filter/find SACCO rows in the
 * catalogue today — and is called out again on `saccoName` below rather than
 * silently assumed away.
 */

/** The four top-level catalogue categories a manager reviews findings into. */
export type CatalogueKey = "mmf" | "bank" | "cbk" | "market_asset";

/** Market-asset subtypes with an ACTIVE field contract (and, not coincidentally,
 *  the same four subtypes with a registered AI-search route — see
 *  shared/authoritativeSources.ts and the market-asset search design's staged
 *  rollout). */
export type MarketAssetSubtype = "equity" | "reit" | "offshore_fund" | "sacco";

/** Market-asset subtypes that exist in the extraction/search vocabulary (see
 *  MARKET_ASSET_EXTRACTION_SCHEMA's `assetType` enum in server/aiResearchService.ts)
 *  but do NOT have an active field contract, and do not have a registered
 *  authoritative-source search route either. Listed explicitly so "not yet
 *  designed" is a documented fact, not a silent omission — do not add contracts
 *  for these without a fresh product decision, per this slice's scope. */
export const UNSUPPORTED_MARKET_ASSET_SUBTYPES = ["etf", "property", "pension", "other"] as const;
export type UnsupportedMarketAssetSubtype = (typeof UNSUPPORTED_MARKET_ASSET_SUBTYPES)[number];

export type FieldStorageStatus =
  | "column"
  | "extendedFields"
  | "computed"
  | "sourceOnly"
  | "missingRequiresMigration";

export interface CatalogueFieldContractEntry {
  /** Which top-level catalogue this field belongs to. */
  catalogue: CatalogueKey;
  /** Only set when `catalogue === "market_asset"`. */
  subtype?: MarketAssetSubtype;
  /** Canonical, stable field key — camelCase, unique within this contract. */
  key: string;
  /** Fixed display label a manager sees — verbatim from the product requirement
   *  (see the file header's one normalization note). */
  label: string;
  /** Target design: should this field be required before a row is considered
   *  complete? (Not yet enforced by `checkApprovalGate` in this slice — see the
   *  file header.) */
  required: boolean;
  /** Known extraction-schema / DB-column / synonym-dictionary key(s) this field
   *  can be read from today. Empty when no extraction path is known yet (typically
   *  alongside `storageStatus: "missingRequiresMigration"`). */
  aliases: string[];
  /** Current factual reality — see the file header. */
  storageStatus: FieldStorageStatus;
  /** Target design: should a manager be able to edit this value while mapping a
   *  finding? */
  managerEditable: boolean;
  /** Target design: should this field appear as a column in the compact
   *  Reference Catalogue table (as opposed to only a detail/drawer view)? */
  showInTable: boolean;
  /** Target design: should approving a finding write this field onto the live
   *  catalogue row? */
  promoteToCatalogueRow: boolean;
  /** Short note explaining a calculation formula, current-vs-target gap, or
   *  migration caveat — omitted when the field is already fully wired. */
  note?: string;
}

export interface CatalogueFieldContract {
  catalogue: CatalogueKey;
  subtype?: MarketAssetSubtype;
  /** Human label for the contract itself, e.g. "MMF", "Market assets — REIT". */
  label: string;
  fields: CatalogueFieldContractEntry[];
}

/* ── MMF ──────────────────────────────────────────────────────────────────── */

const MMF_FIELD_CONTRACT: CatalogueFieldContract = {
  catalogue: "mmf",
  label: "MMF",
  fields: [
    {
      catalogue: "mmf",
      key: "fundName",
      label: "Fund name",
      required: true,
      aliases: ["fundName", "instrumentName"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "mmf",
      key: "fundManager",
      label: "Fund manager",
      required: true,
      aliases: ["fundManager", "company"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Stored as mmf_funds.company; the product label is 'fund manager', the column name predates it.",
    },
    {
      catalogue: "mmf",
      key: "ear",
      label: "EAR",
      required: true,
      aliases: ["ear", "effectiveAnnualRate"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "mmf",
      key: "managementFee",
      label: "Management fee",
      required: true,
      aliases: ["managementFee", "expenseRatioPct", "fee"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Added post-approval (2026-07-16) — omitted from the original 13-field product list, but mmf_funds.managementFee is NOT NULL, CATALOGUE_FIELD_RULES.mmf has required figures.managementFee at the approval gate since before this initiative, and buildPromotionPlan writes it directly to the column. Without this field, Slice 8b's contract-based figures projection would silently drop a genuinely-extracted, gate-required value — see server/mmfContractMapping.test.ts's 'compatibility with the existing MMF approval gate and promotion path' tests.",
    },
    {
      catalogue: "mmf",
      key: "dailyYield",
      label: "Daily yield",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No column and no extraction-schema field. Today's candidate-phrase matcher (shared/candidatePhrases.ts) treats \"daily yield\" as a SYNONYM of EAR for detection purposes, not a distinct figure — extraction would need to separate the two before this could be populated.",
    },
    {
      catalogue: "mmf",
      key: "grossYield",
      label: "Gross yield",
      required: true,
      aliases: ["grossYield"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "mmf",
      key: "netYield",
      label: "Net yield",
      required: false,
      aliases: [],
      storageStatus: "computed",
      managerEditable: false,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Computed as ear × (1 − whtRate) at display time; never persisted.",
    },
    {
      catalogue: "mmf",
      key: "wht",
      label: "WHT",
      required: true,
      aliases: ["whtRate"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "mmf_funds.whtRate exists (default 15%) but buildPromotionPlan's MMF payload does not set it today — an approved update never changes it. Documented here, not fixed in this slice.",
    },
    {
      catalogue: "mmf",
      key: "minInvestment",
      label: "Minimum investment",
      required: true,
      aliases: ["minInvestment", "minimumInvestment"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "mmf",
      key: "withdrawalPeriod",
      label: "Withdrawal period",
      required: false,
      aliases: ["withdrawalNoticePeriod"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Lives in extendedFields.MmfProfile.withdrawalNoticePeriod only; no first-class column.",
    },
    {
      catalogue: "mmf",
      key: "aum",
      label: "AUM",
      required: false,
      aliases: ["aum", "aumMillions"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "mmf_funds.aumMillions exists but buildPromotionPlan's MMF payload does not set it today — only the manual Add/Edit dialog can change it.",
    },
    {
      catalogue: "mmf",
      key: "riskProfile",
      label: "Risk profile",
      required: true,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No structured risk rating anywhere in the schema for MMF — only free-text riskNotes on the shared InstrumentProfile envelope.",
    },
    {
      catalogue: "mmf",
      key: "sourceLink",
      label: "Source link",
      required: true,
      aliases: ["source", "sourceUrl", "sourceLabel"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "MMF is the only catalogue page today that renders this as an actual clickable link.",
    },
    {
      catalogue: "mmf",
      key: "sourceAsOf",
      label: "Source as-of date",
      required: true,
      aliases: ["asOf", "asOfDate", "sourceAsOf"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Global provenance rule (added on review) — CATALOGUE_FIELD_RULES.mmf already requires 'asOf' today, and mmf_funds.asOfDate is already wired via reviewResearchUpdate's Stage-6a fix. Not in the product requirement's original MMF list (only 'Source link' was), added for consistency with the global rule and the other six contracts.",
    },
  ],
};

/* ── Bank products ────────────────────────────────────────────────────────── */

const BANK_FIELD_CONTRACT: CatalogueFieldContract = {
  catalogue: "bank",
  label: "Bank products",
  fields: [
    {
      catalogue: "bank",
      key: "bankName",
      label: "Bank name",
      required: true,
      aliases: ["bankName"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "bank",
      key: "productName",
      label: "Product name",
      required: true,
      aliases: ["productName"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Lives in extendedFields.BankInstrumentProfile.productName only. Row-level identity today is instrumentType (a TYPE, not a distinguishing NAME) — two 'Fixed Deposit' products at one bank cannot be told apart by column alone.",
    },
    {
      catalogue: "bank",
      key: "productType",
      label: "Product type",
      required: true,
      aliases: ["instrumentType", "productType"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "bank",
      key: "interestRate",
      label: "Interest rate",
      required: true,
      aliases: ["indicativeRate", "rate"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "bank",
      key: "netReturnAfterWht",
      label: "Net return after WHT",
      required: false,
      aliases: [],
      storageStatus: "computed",
      managerEditable: false,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Computed as interestRate × (1 − 0.15), Kenya's standard bank-interest WHT; never persisted.",
    },
    {
      catalogue: "bank",
      key: "minimumDeposit",
      label: "Minimum deposit",
      required: true,
      aliases: ["minAmount", "minimumAmount", "minInvestment"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "bank",
      key: "tenor",
      label: "Tenor / lock-in period",
      required: true,
      aliases: ["typicalTenor", "tenor", "noticePeriod"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Stored as free text (bank_instruments.typicalTenor), not structured days/months.",
    },
    {
      catalogue: "bank",
      key: "earlyWithdrawalRule",
      label: "Early withdrawal rule",
      required: false,
      aliases: ["earlyWithdrawalPenalty"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Lives in extendedFields.BankInstrumentProfile.earlyWithdrawalPenalty only.",
    },
    {
      catalogue: "bank",
      key: "fees",
      label: "Fees / charges",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No fee field anywhere for bank products today.",
    },
    {
      catalogue: "bank",
      key: "accessSpeed",
      label: "Access speed",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No liquidity-speed rating field anywhere for bank products today.",
    },
    {
      catalogue: "bank",
      key: "sourceLink",
      label: "Source",
      required: true,
      aliases: ["source", "sourceUrl", "sourceLabel"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "bank_instruments.source exists and is promoted, but today's Bank catalogue table only shows it in the detail drawer, not the main row — a UI gap, not a data gap.",
    },
    {
      catalogue: "bank",
      key: "sourceAsOf",
      label: "Source as-of date",
      required: true,
      aliases: ["asOfDate", "sourceAsOf"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
  ],
};

/* ── CBK securities ───────────────────────────────────────────────────────── */

const CBK_FIELD_CONTRACT: CatalogueFieldContract = {
  catalogue: "cbk",
  label: "CBK securities",
  fields: [
    {
      catalogue: "cbk",
      key: "securityType",
      label: "Security type",
      required: true,
      aliases: ["securityType"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Lives in extendedFields.CbkSecurityProfile.securityType only. The row-level opportunities.assetClass column only distinguishes gov_discount vs. gov_coupon (2 buckets), not T-bill vs. FXD vs. IFB.",
    },
    {
      catalogue: "cbk",
      key: "tenor",
      label: "Tenor",
      required: true,
      aliases: ["tenorYears", "tenorDays", "tenorMonths", "tenorLabel"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "opportunities.tenorYears is coarse (years only); CBK actually quotes 91/182/364-day tenors — the richer day/month breakdown exists only in extendedFields.",
    },
    {
      catalogue: "cbk",
      key: "applicationDeadline",
      label: "Application deadline",
      required: false,
      aliases: ["bidSubmissionDeadline"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Lives in extendedFields.CbkSecurityProfile.bidSubmissionDeadline only.",
    },
    {
      catalogue: "cbk",
      key: "indicativeYield",
      label: "Indicative / previous yield",
      required: true,
      aliases: ["yieldPct", "weightedAvgRate", "prevAvgRate", "couponRate"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "cbk",
      key: "netYieldAfterWht",
      label: "Net yield after WHT",
      required: false,
      aliases: [],
      storageStatus: "computed",
      managerEditable: false,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Computed from indicativeYield and taxTreatment (taxExempt / withholdingTaxRate); never persisted. Requires taxTreatment to actually be promoted first (see that field's note).",
    },
    {
      catalogue: "cbk",
      key: "taxTreatment",
      label: "Tax treatment",
      required: true,
      aliases: ["taxExempt", "withholdingTaxRate", "whtRate"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Lives in extendedFields.CbkSecurityProfile only. Today's CBK catalogue page infers a 'Tax-exempt coupon' badge via a REGEX over the instrument name/factNote text, not this structured field — fragile.",
    },
    {
      catalogue: "cbk",
      key: "minInvestment",
      label: "Minimum investment",
      required: false,
      aliases: ["nonCompetitiveMin"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Closest concept is extendedFields.CbkSecurityProfile.nonCompetitiveMin (minimum non-competitive bid).",
    },
    {
      catalogue: "cbk",
      key: "maturityDate",
      label: "Maturity date",
      required: true,
      aliases: ["maturityDate"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "cbk",
      key: "sourceLink",
      label: "Source link",
      required: true,
      aliases: ["source", "sourceUrl", "sourceLabel", "dataSource"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Global provenance rule (added on review) — CATALOGUE_FIELD_RULES.cbk already requires 'source' today. opportunities.dataSource exists and is promoted via buildPromotionPlan; shown as plain text in the CBK catalogue table today, not yet a clickable link like MMF's (a later UI slice, not this one).",
    },
    {
      catalogue: "cbk",
      key: "sourceAsOf",
      label: "Source as-of date",
      required: true,
      aliases: ["asOf", "dataAsOf", "sourceAsOf"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Global provenance rule (added on review) — CATALOGUE_FIELD_RULES.cbk already requires 'asOf' today. opportunities.dataAsOf exists and is already wired via promotionProvenance().",
    },
  ],
};

/* ── Market assets — Equity ───────────────────────────────────────────────── */

const MARKET_ASSET_EQUITY_FIELD_CONTRACT: CatalogueFieldContract = {
  catalogue: "market_asset",
  subtype: "equity",
  label: "Market assets — Equity",
  fields: [
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "companyName",
      label: "Company name",
      required: true,
      aliases: ["instrumentName", "name"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "ticker",
      label: "Ticker / symbol",
      required: true,
      aliases: ["ticker"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Lives in extendedFields.MarketAssetProfile.ticker only; no first-class column today.",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "exchange",
      label: "Exchange",
      required: true,
      aliases: ["exchange", "market"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "extendedFields.MarketAssetProfile.exchange exists; opportunities.market is a generic free-text column shared across all market-asset subtypes, not exchange-specific.",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "currentPrice",
      label: "Current price",
      required: true,
      aliases: ["marketPrice", "lastPrice"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "dividendYield",
      label: "Dividend yield",
      required: true,
      aliases: ["dividendYield", "yieldPct"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "opportunities.yieldPct is a generic column shared across yield/coupon/dividend concepts for ALL market-asset subtypes, not equity-specific.",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "recentDividend",
      label: "Recent dividend",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No amount/date field for the most recent dividend anywhere today.",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "priceChange",
      label: "Price change",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No price-history table exists to derive this from — needs more than a single column.",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "marketSector",
      label: "Market sector",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No sector/industry classification field anywhere today.",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "minBuyAmount",
      label: "Minimum buy amount or board lot",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "opportunities has no minInvestment-equivalent column at all today (unlike mmf_funds/bank_instruments).",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "liquidity",
      label: "Liquidity / trading activity",
      required: true,
      aliases: ["liquidity"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "opportunities.liquidity is a coarse, generic enum (daily/t_plus_settlement/term/illiquid) shared across all subtypes, not a real trading-activity measure.",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "riskLevel",
      label: "Risk level",
      required: true,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No structured risk rating anywhere in the schema.",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "sourceLink",
      label: "Source link",
      required: true,
      aliases: ["source", "sourceUrl", "sourceLabel", "dataSource"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Global provenance rule (added on review) — every catalogue row must carry an openable source link. opportunities.dataSource exists and is promoted via buildPromotionPlan.",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "sourceAsOf",
      label: "Source as-of date",
      required: true,
      aliases: ["asOf", "dataAsOf", "sourceAsOf"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
  ],
};

/* ── Market assets — REIT ─────────────────────────────────────────────────── */

const MARKET_ASSET_REIT_FIELD_CONTRACT: CatalogueFieldContract = {
  catalogue: "market_asset",
  subtype: "reit",
  label: "Market assets — REIT",
  fields: [
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "reitName",
      label: "REIT name",
      required: true,
      aliases: ["instrumentName", "name"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "reitType",
      label: "REIT type",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No income-REIT/development-REIT (or similar) distinction anywhere today — only the row-level assetClass='reit' umbrella.",
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "currentPrice",
      label: "Current price / unit price",
      required: true,
      aliases: ["marketPrice", "lastPrice"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "distributionYield",
      label: "Distribution yield",
      required: true,
      aliases: ["distributionYield"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Already gate-required for REIT rows (see MARKET_ASSET_SUBTYPE_FIELD_RULES.reit in shared/researchPipeline.ts), but buildPromotionPlan's opportunity payload derives yieldPct from `f.yieldPct ?? f.yield ?? f.coupon` — distributionYield is NOT in that fallback chain, so a gate-satisfying value may still fail to reach the promoted column. Documented here, not fixed in this slice.",
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "recentDistribution",
      label: "Recent distribution",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No amount/date field for the most recent distribution anywhere today.",
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "nav",
      label: "Net asset value / NAV",
      required: false,
      aliases: ["nav"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Lives in extendedFields.MarketAssetProfile.nav only; not in buildPromotionPlan's fallback chain either.",
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "occupancyRate",
      label: "Occupancy rate",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Product requirement listed this as \"if available\" (optional). Not in MarketAssetProfile's shape at all — would need an extraction-schema addition, not just a DB column.",
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "minInvestment",
      label: "Minimum investment",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "opportunities has no minInvestment-equivalent column at all today.",
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "liquidity",
      label: "Liquidity / tradability",
      required: true,
      aliases: ["liquidity"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Generic shared enum, same caveat as Equity's liquidity field.",
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "riskLevel",
      label: "Risk level",
      required: true,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No structured risk rating anywhere in the schema.",
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "sourceLink",
      label: "Source link",
      required: true,
      aliases: ["source", "sourceUrl", "sourceLabel", "dataSource"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Global provenance rule (added on review) — every catalogue row must carry an openable source link. opportunities.dataSource exists and is promoted via buildPromotionPlan.",
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "sourceAsOf",
      label: "Source as-of date",
      required: true,
      aliases: ["asOf", "dataAsOf", "sourceAsOf"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
  ],
};

/* ── Market assets — Offshore fund ────────────────────────────────────────── */

const MARKET_ASSET_OFFSHORE_FUND_FIELD_CONTRACT: CatalogueFieldContract = {
  catalogue: "market_asset",
  subtype: "offshore_fund",
  label: "Market assets — Offshore fund",
  fields: [
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "fundName",
      label: "Fund name",
      required: true,
      aliases: ["instrumentName", "name"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "fundManager",
      label: "Fund manager / provider",
      required: true,
      aliases: ["issuer", "fundManager"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Stored as the generic opportunities.issuer column, not offshore-fund-specific.",
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "currency",
      label: "Currency",
      required: true,
      aliases: ["currency"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "The one desired field with real enforced business logic already: MARKET_ASSET_SUBTYPE_FIELD_RULES.offshore_fund requires currency !== \"KES\" (shared/researchPipeline.ts).",
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "fundType",
      label: "Fund type",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No sub-classification beyond assetClass='offshore_fund' anywhere today.",
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "annualizedReturn",
      label: "Annualized return / performance",
      required: true,
      aliases: ["trailingReturn", "trailingReturnPct"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "minInvestment",
      label: "Minimum investment",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "opportunities has no minInvestment-equivalent column at all today.",
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "fees",
      label: "Fees",
      required: true,
      aliases: ["fee", "expenseRatioPct", "expense"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Already gate-required for offshore-fund rows (MARKET_ASSET_SUBTYPE_FIELD_RULES.offshore_fund).",
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "withdrawalPeriod",
      label: "Withdrawal period",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No withdrawal-period field for offshore funds anywhere today.",
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "fxRiskNote",
      label: "FX risk note",
      required: false,
      aliases: ["fxRisk"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Lives in extendedFields.MarketAssetProfile.fxRisk only. The Market Assets page's \"FX risk\" badge today is derived from currency !== KES, not this field.",
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "riskLevel",
      label: "Risk level",
      required: true,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No structured risk rating anywhere in the schema.",
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "sourceLink",
      label: "Source link",
      required: true,
      aliases: ["source", "sourceUrl", "sourceLabel", "dataSource"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Global provenance rule (added on review) — every catalogue row must carry an openable source link. opportunities.dataSource exists and is promoted via buildPromotionPlan.",
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "sourceAsOf",
      label: "Source as-of date",
      required: true,
      aliases: ["asOf", "dataAsOf", "sourceAsOf"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
    },
  ],
};

/* ── Market assets — SACCO ────────────────────────────────────────────────── */

const MARKET_ASSET_SACCO_FIELD_CONTRACT: CatalogueFieldContract = {
  catalogue: "market_asset",
  subtype: "sacco",
  label: "Market assets — SACCO",
  fields: [
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "saccoName",
      label: "SACCO name",
      required: true,
      aliases: ["instrumentName", "name"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "SACCO has no distinct opportunities.assetClass value — SACCOs fall under the generic 'alt' bucket, detected only via detectMarketAssetSacco() or extendedFields.assetType==='sacco'. A manager cannot reliably filter/find SACCO rows in the catalogue today — a structural gap bigger than any single field.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "productType",
      label: "Product type",
      required: false,
      aliases: [],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Inferred today from which SACCO-specific extendedFields keys are present — no single explicit product-type key exists.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "dividendRate",
      label: "Dividend rate / interest rate",
      required: true,
      aliases: ["shareCapitalDividendRate", "depositRebateRate"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Already gate-required for SACCO rows (SACCO_MARKET_ASSET_FIELD_RULES, shared/researchPipeline.ts) but not a first-class column.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "minContribution",
      label: "Minimum contribution",
      required: true,
      aliases: ["minimumMonthlyDeposit"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Already gate-required (SACCO_MARKET_ASSET_FIELD_RULES) but not a first-class column.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "membershipRequirement",
      label: "Membership requirement",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Not in MarketAssetProfile's shape at all today.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "lockInWithdrawalRule",
      label: "Lock-in or withdrawal rule",
      required: true,
      aliases: ["withdrawalTerms"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Already gate-required (SACCO_MARKET_ASSET_FIELD_RULES) but not a first-class column.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "fees",
      label: "Fees / charges",
      required: false,
      aliases: [],
      storageStatus: "missingRequiresMigration",
      managerEditable: false,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "No fee field in the SACCO-specific gate rules or profile shape today.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "liquidity",
      label: "Liquidity",
      required: true,
      aliases: ["liquidity"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Generic shared enum; SACCO's real liquidity concept is closer to lockInWithdrawalRule above.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "riskProtectionNote",
      label: "Risk / protection note",
      required: false,
      aliases: ["regulatoryStatus"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Closest proxy is extendedFields.MarketAssetProfile.regulatoryStatus (gate-required, e.g. \"SASRA-regulated\") — a status flag, not really a risk/protection note. Real field is a gap.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "sourceLink",
      label: "Source link",
      required: true,
      aliases: ["source", "sourceUrl", "sourceLabel", "dataSource"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Global provenance rule (added on review) — every catalogue row must carry an openable source link. opportunities.dataSource exists and is promoted via buildPromotionPlan. Contingent on the SACCO row-identity gap noted on saccoName above.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "sourceAsOf",
      label: "Source as-of date",
      required: true,
      aliases: ["asOf", "dataAsOf", "sourceAsOf"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Contingent on the SACCO row-identity gap noted on saccoName above.",
    },
  ],
};

/** All active catalogue field contracts — the full set this slice defines. */
export const CATALOGUE_FIELD_CONTRACTS: CatalogueFieldContract[] = [
  MMF_FIELD_CONTRACT,
  BANK_FIELD_CONTRACT,
  CBK_FIELD_CONTRACT,
  MARKET_ASSET_EQUITY_FIELD_CONTRACT,
  MARKET_ASSET_REIT_FIELD_CONTRACT,
  MARKET_ASSET_OFFSHORE_FUND_FIELD_CONTRACT,
  MARKET_ASSET_SACCO_FIELD_CONTRACT,
];

/**
 * Look up the active field contract for a catalogue (and, for market_asset, its
 * subtype). Returns null for `market_asset` with no subtype, an unsupported
 * subtype, or any other combination this slice doesn't define — never guesses.
 */
export function getCatalogueFieldContract(
  catalogue: CatalogueKey,
  subtype?: MarketAssetSubtype,
): CatalogueFieldContract | null {
  if (catalogue === "market_asset") {
    if (!subtype) return null;
    return CATALOGUE_FIELD_CONTRACTS.find((c) => c.catalogue === "market_asset" && c.subtype === subtype) ?? null;
  }
  return CATALOGUE_FIELD_CONTRACTS.find((c) => c.catalogue === catalogue) ?? null;
}

/* ── Slice 8b — projecting a finding into a contract's fixed field shape ────
 *
 * The contract above is pure data. This section is the first (and, in this
 * slice, ONLY — MMF-only) consumer: given an Ask AI finding, project its raw
 * AI-extracted figures (plus its envelope identity/provenance fields) into the
 * contract's fixed shape, so a manager sees and drafts EXACTLY the established
 * quick-decision fields for that catalogue — never an arbitrary AI-extracted
 * key that happens not to be in the contract.
 *
 * Two different projections, for two different jobs:
 *   - `projectFindingToContractDisplayRows` — ALL of a contract's fields, in
 *     contract order, each with its found value (or null) — for showing the
 *     manager the complete fixed field set at a glance, including fields that
 *     are computed or not yet capturable (shown as null, never fabricated).
 *   - `projectFindingToContractFigures` — ONLY the fields that genuinely belong
 *     in a `research_updates.figures` bag: never a computed field (nothing raw
 *     to write), never a `missingRequiresMigration` field (nowhere for a value
 *     to have come from), and never a field whose real value already lives on
 *     the update's ENVELOPE (name/issuer/source/asOf columns) rather than
 *     `figures` itself — `draftFromFinding`/`buildPromotionPlan` already read
 *     those from the envelope, so duplicating them into figures would be
 *     redundant, not protective. This is what a caller should send as the
 *     `figures` override when drafting a finding into the review queue.
 */

/**
 * A minimal, structural shape of an Ask AI finding (or an already-governed
 * pending update) these projections need. Deliberately NOT an import of the
 * real client `Finding` or server `ResearchFindingDraft` types — this module
 * is shared and must stay framework/layer-agnostic; any object with this shape
 * works via TypeScript's structural typing.
 */
export interface ProjectableFinding {
  instrumentName: string;
  issuer?: string | null;
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  sourceAsOf?: string | number | null;
  extractedFields?: Record<string, unknown> | null;
}

/** MMF-only for this slice: canonical contract keys whose real value already
 *  lives on the finding/update ENVELOPE, not the figures bag — see the section
 *  header above. Each later slice (bank/cbk/market-asset) will need its own
 *  small set here when it's wired, since which keys are envelope-routed is
 *  catalogue-specific (see buildPromotionPlan, shared/researchPipeline.ts). */
const ENVELOPE_ROUTED_CONTRACT_KEYS: Record<CatalogueKey, ReadonlySet<string>> = {
  mmf: new Set(["fundName", "fundManager", "sourceLink", "sourceAsOf"]),
  bank: new Set(),
  cbk: new Set(),
  market_asset: new Set(),
};

/** Read a field's value from a raw key/value bag by trying each of its
 *  `aliases` in order, stopping at the first present, non-empty, non-sentinel
 *  value. Never invents a value; returns null when nothing matches. */
function readAliasValue(field: CatalogueFieldContractEntry, raw: Record<string, unknown>): string | null {
  for (const alias of field.aliases) {
    const v = raw[alias];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s === "" || s === "missing_from_source") continue;
    return s;
  }
  return null;
}

/** Merge a finding's raw AI-extracted figures with its envelope identity/
 *  provenance fields under the synthetic keys the contracts' own `aliases`
 *  already expect (e.g. MMF's `fundManager` field lists `"company"` as an
 *  alias because that mirrors `buildPromotionPlan`'s own figures-bag
 *  fallback naming) — so `readAliasValue` above needs no special-casing per
 *  field, only a correctly-built bag to search. Envelope fields are added
 *  AFTER the extractedFields spread so they always win over any raw noise
 *  that happened to reuse the same key. */
function buildContractRawValueBag(finding: ProjectableFinding): Record<string, unknown> {
  return {
    ...(finding.extractedFields ?? {}),
    fundName: finding.instrumentName,
    instrumentName: finding.instrumentName,
    company: finding.issuer ?? undefined,
    fundManager: finding.issuer ?? undefined,
    source: finding.sourceLabel ?? undefined,
    sourceLabel: finding.sourceLabel ?? undefined,
    sourceUrl: finding.sourceUrl ?? undefined,
    asOf: finding.sourceAsOf ?? undefined,
    sourceAsOf: finding.sourceAsOf ?? undefined,
  };
}

/** One row of a contract's fixed field set, projected against a specific
 *  finding — always present (in contract order) whether or not a value was
 *  actually found, so the manager sees the COMPLETE established field set,
 *  not just whichever ones happened to extract. */
export interface CatalogueFieldDisplayRow {
  key: string;
  label: string;
  required: boolean;
  storageStatus: FieldStorageStatus;
  /** The found value, or null — never fabricated. Always null for `computed`
   *  and `missingRequiresMigration` fields (nothing raw to show). */
  value: string | null;
}

/**
 * Project a finding into a contract's COMPLETE fixed field set for display —
 * every field the contract defines, in contract order, each carrying its
 * found value or null. Pure, no I/O, never throws.
 */
export function projectFindingToContractDisplayRows(
  contract: CatalogueFieldContract,
  finding: ProjectableFinding,
): CatalogueFieldDisplayRow[] {
  const raw = buildContractRawValueBag(finding);
  return contract.fields.map((field) => ({
    key: field.key,
    label: field.label,
    required: field.required,
    storageStatus: field.storageStatus,
    value:
      field.storageStatus === "computed" || field.storageStatus === "missingRequiresMigration"
        ? null
        : readAliasValue(field, raw),
  }));
}

/**
 * Project a finding into ONLY the figures a draft into the review queue should
 * carry for this contract — see the section header above for exactly which
 * fields are excluded and why (computed / missingRequiresMigration / envelope-
 * routed). Pure, no I/O, never throws. Any raw AI-extracted key not reachable
 * via a contract field's `aliases` is silently dropped — this is the actual
 * mechanism that keeps arbitrary extraction noise from becoming a catalogue
 * field.
 */
export function projectFindingToContractFigures(
  contract: CatalogueFieldContract,
  finding: ProjectableFinding,
): Record<string, string> {
  const raw = buildContractRawValueBag(finding);
  const envelopeRouted = ENVELOPE_ROUTED_CONTRACT_KEYS[contract.catalogue] ?? new Set<string>();
  const result: Record<string, string> = {};
  for (const field of contract.fields) {
    if (field.storageStatus === "computed" || field.storageStatus === "missingRequiresMigration") continue;
    if (envelopeRouted.has(field.key)) continue;
    const value = readAliasValue(field, raw);
    if (value !== null) result[field.key] = value;
  }
  return result;
}
