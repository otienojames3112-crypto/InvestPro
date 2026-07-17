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

// Slice 9b — one-directional dependency on researchPipeline.ts (which itself
// only imports ./assetModel, never this module), used by
// resolveContractCatalogueForUpdate below.
import { catalogueForAssetClass, detectMarketAssetSacco } from "./researchPipeline";
import type { AssetClass } from "./assetModel";

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
  /** Slice 8e-2 — the RARE case where the same found value must be written
   *  under MORE THAN ONE output key in `projectFindingToContractFigures`'s
   *  figures bag, because two independently-keyed downstream consumers (e.g. a
   *  live approval-gate rule and buildPromotionPlan's typed payload) each check
   *  a DIFFERENT literal key for the same underlying figure, with no shared
   *  alias covering both. `key` stays the field's own canonical key (what
   *  `projectFindingToContractDisplayRows` shows and what one consumer expects);
   *  `alsoWriteKeys` are additional keys the SAME value is duplicated onto, for
   *  the other consumer. Never affects display — a field still renders as
   *  exactly one row. Omit for the normal case (a single key satisfies every
   *  consumer). */
  alsoWriteKeys?: string[];
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
      key: "indicativeRate",
      label: "Interest rate",
      required: true,
      aliases: ["indicativeRate", "rate"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Key renamed from 'interestRate' to 'indicativeRate' during Slice 8c's pre-approval compatibility check (2026-07-16) — figurePresent's alias table for the gate's indicativeRate rule, and buildPromotionPlan's f.indicativeRate read, do NOT recognise 'interestRate'; submitting under that key would have silently failed the approval gate. Display label unchanged.",
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
      note: "Computed as indicativeRate × (1 − 0.15), Kenya's standard bank-interest WHT; never persisted.",
    },
    {
      catalogue: "bank",
      key: "isNegotiable",
      label: "Negotiable",
      required: true,
      aliases: ["isNegotiable", "negotiable"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Added post-approval (2026-07-16) — omitted from the original 12-field product list, but bank_instruments.isNegotiable is NOT NULL, CATALOGUE_FIELD_RULES.bank has required figures.isNegotiable (non-escapable) at the approval gate since before this initiative, and the extraction schema's `negotiable` field is required on every structured bank finding. Without this field, Slice 8c's contract-based figures projection would silently drop a genuinely-extracted, gate-required value — same class of gap as MMF's managementFee in Slice 8b.",
    },
    {
      catalogue: "bank",
      key: "minAmount",
      label: "Minimum deposit",
      required: true,
      aliases: ["minAmount", "minimumAmount", "minInvestment"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Key renamed from 'minimumDeposit' to 'minAmount' during Slice 8c's pre-approval compatibility check (2026-07-16) — figurePresent's alias table for the gate's minAmount rule, and buildPromotionPlan's f.minAmount read, do NOT recognise 'minimumDeposit'; submitting under that key would have silently failed the approval gate. Display label unchanged.",
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
      key: "issueNumber",
      label: "Issue number",
      required: false,
      aliases: ["issueNumber"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Added post-approval (2026-07-16) — omitted from the original 10-field product list, but CBK_SUBTYPE_FIELD_RULES.fxd/ifb require figures.issueNumber (hard, no escape) at the approval gate once an FXD/IFB is confidently detected, and the field extraction schema requires it. Lives in extendedFields.CbkSecurityProfile.issueNumber. required:false at the contract level because it's subtype-conditional (T-bills don't need it) — the real enforcement is checkApprovalGate's own subtype branch, which doesn't consult this contract.",
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
      key: "auctionDate",
      label: "Auction date",
      required: false,
      aliases: ["auctionDate"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Added post-approval (2026-07-16) — omitted from the original 10-field product list, but CBK_SUBTYPE_FIELD_RULES.tbill requires figures.auctionDate (hard, no escape) at the approval gate once a T-bill is confidently detected, and the field is required by the T-bill extraction schema. Lives in extendedFields.CbkSecurityProfile.auctionDate. Distinct from sourceAsOf below — Stage 4 already bridges a T-bill's auctionDate into the finding's OWN sourceAsOf for provenance purposes, but the raw figure itself is a separate fact the gate checks independently.",
    },
    {
      catalogue: "cbk",
      key: "valueDate",
      label: "Value / settlement date",
      required: false,
      aliases: ["valueDate", "settlementDate"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Added post-approval (2026-07-16) — omitted from the original 10-field product list, but CBK_SUBTYPE_FIELD_RULES.tbill requires figures.valueDate (hard, no escape) at the approval gate once a T-bill is confidently detected. Lives in extendedFields.CbkSecurityProfile.settlementDate (figurePresent's own valueDate alias table already tolerates 'settlementDate').",
    },
    {
      catalogue: "cbk",
      key: "yieldPct",
      label: "Indicative / previous yield",
      required: true,
      aliases: ["yieldPct", "weightedAvgRate", "prevAvgRate", "couponRate"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Key renamed from 'indicativeYield' to 'yieldPct' during Slice 8d's pre-approval compatibility check (2026-07-16) — figurePresent's alias table for the gate's yieldPct rule, and buildPromotionPlan's f.yieldPct read, do NOT recognise 'indicativeYield'; submitting under that key would have silently failed the approval gate. Display label unchanged.",
    },
    {
      catalogue: "cbk",
      key: "couponRate",
      label: "Coupon rate",
      required: false,
      aliases: ["couponRate"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Added post-approval (2026-07-16) — omitted from the original 10-field product list, but CBK_SUBTYPE_FIELD_RULES.fxd/ifb require figures.couponRate (hard, no escape) at the approval gate once an FXD/IFB is confidently detected. Lives in extendedFields.CbkSecurityProfile.couponRate. Distinct from yieldPct above — a bond's fixed coupon and its yield-to-maturity/auction yield are different figures the source states separately.",
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
      note: "Computed from yieldPct and whtRule/taxExempt; never persisted. Requires whtRule/taxExempt to actually be promoted first (see those fields' notes).",
    },
    {
      catalogue: "cbk",
      key: "whtRule",
      label: "Tax treatment",
      required: true,
      aliases: ["whtRule", "withholdingTaxRate", "whtRate"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Key renamed from 'taxTreatment' to 'whtRule' during Slice 8d's pre-approval compatibility check (2026-07-16) — the gate's whtRule and taxExempt rules are TWO SEPARATE, independently-checked figures keys (confirmed via applyCbkRuleFill, which sets them as genuinely distinct values, e.g. whtRule: '15% withholding tax on the discount', taxExempt: 'false'); no single combined key could satisfy both, so this field now covers the free-text WHT-rule description specifically (what a manager actually reads as 'tax treatment'), and the boolean-ish flag is split out into its own 'taxExempt' field below. Lives in extendedFields.CbkSecurityProfile only. Today's CBK catalogue page infers a 'Tax-exempt coupon' badge via a REGEX over the instrument name/factNote text, not this structured field — fragile.",
    },
    {
      catalogue: "cbk",
      key: "taxExempt",
      label: "Tax-exempt flag",
      required: true,
      aliases: ["taxExempt", "taxExemptFlag", "isTaxExempt"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Added post-approval (2026-07-16) — split out of the original single 'Tax treatment' field (see whtRule's note above) because CATALOGUE_FIELD_RULES.cbk requires figures.taxExempt as its own separate, independently-checked gate field, and checkApprovalGate ALSO has an infrastructure-bond-specific value assertion (taxExempt must be literally TRUE for an IFB, checked directly against this exact key). Lives in extendedFields.CbkSecurityProfile.taxExempt.",
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
      aliases: ["maturityDate", "maturityRule"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "'maturityRule' added as a fallback alias during Slice 8d's pre-approval compatibility check (2026-07-16) — a T-bill never gets a literal maturityDate; applyCbkRuleFill instead sets 'maturityRule' as a text description (e.g. 'value date + 91 days'), which is what CATALOGUE_FIELD_RULES.cbk's own baseline maturityRule rule actually checks for every CBK finding (T-bill, FXD or IFB alike). Writing the found value under the canonical 'maturityDate' key is still gate-compatible either way — figurePresent's own maturityRule alias table already tolerates 'maturityDate'. A bond's literal date is preferred first when both are present.",
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
      key: "market",
      label: "Exchange",
      required: true,
      aliases: ["market", "exchange"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Key renamed from 'exchange' to 'market' during Slice 8e-1's pre-approval compatibility check (2026-07-16) — buildPromotionPlan's opportunity branch reads f.market only (no fallback to f.exchange); the gate's OWN market-rule alias table tolerates 'exchange', which made the original key LOOK compatible while the value was actually silently dropped at promotion PRE-fix. storageStatus corrected extendedFields->column during Slice 8g-2 (2026-07-17): opportunities.market IS a real column and buildPromotionPlan writes f.market to it unconditionally for every opportunity-target promotion — the field genuinely reaches a typed column today, it was simply mislabeled 'extendedFields' (a historical artifact of MarketAssetProfile.exchange also existing as the richer, subtype-flavoured concept). Corrected so Slice 8g-2's projectContractFiguresToExtendedFields doesn't duplicate an already-promoted column value into extendedFields too.",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "lastPrice",
      label: "Current price",
      required: true,
      aliases: ["marketPrice", "lastPrice"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Key renamed from 'currentPrice' to 'lastPrice' during Slice 8e-1's pre-approval compatibility check (2026-07-16) — neither figurePresent's lastPrice alias table nor buildPromotionPlan's f.lastPrice ?? f.price read recognised the original key. Display label unchanged.",
    },
    {
      catalogue: "market_asset",
      subtype: "equity",
      key: "yieldPct",
      label: "Dividend yield",
      required: true,
      aliases: ["dividendYield", "yieldPct"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Key renamed from 'dividendYield' to 'yieldPct' during Slice 8e-1's pre-approval compatibility check (2026-07-16) — buildPromotionPlan's opportunity branch reads f.yieldPct ?? f.yield ?? f.coupon only, never f.dividendYield. The gate's OWN lastPrice-rule alias table tolerates 'dividendYield' as an alternate way to satisfy the price/yield/return requirement, which made the original key LOOK compatible while the value was actually silently dropped from the opportunities.yieldPct column at promotion. opportunities.yieldPct is a generic column shared across yield/coupon/dividend concepts for ALL market-asset subtypes, not equity-specific.",
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
      key: "market",
      label: "Exchange",
      required: true,
      aliases: ["market", "exchange"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Added post-approval (2026-07-16) — omitted from the original 12-field product list, but CATALOGUE_FIELD_RULES.market_asset hard-requires figures.market (non-escapable) for EVERY market-asset finding regardless of subtype, and MARKET_ASSET_EXTRACTION_SCHEMA requires 'exchange' on every extraction too — proven directly via a live checkApprovalGate call that still reported 'market' missing with every other REIT field supplied. Same shape as Equity's already-fixed 'market' field: extendedFields.MarketAssetProfile.exchange exists (a generic field shared across all market-asset subtypes); opportunities.market is the generic promoted column. storageStatus corrected extendedFields->column during Slice 8g-2 (2026-07-17) — opportunities.market genuinely IS a real, already-promoted column; the field was mislabeled.",
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "lastPrice",
      label: "Current price / unit price",
      required: true,
      aliases: ["marketPrice", "lastPrice"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Key renamed from 'currentPrice' to 'lastPrice' during Slice 8e-2's pre-approval compatibility check (2026-07-16) — same fix as Equity's currentPrice: neither figurePresent's lastPrice alias table nor buildPromotionPlan's f.lastPrice ?? f.price read recognised the original key. Display label unchanged.",
    },
    {
      catalogue: "market_asset",
      subtype: "reit",
      key: "distributionYield",
      label: "Distribution yield",
      required: true,
      aliases: ["distributionYield"],
      alsoWriteKeys: ["yieldPct"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Gained alsoWriteKeys:['yieldPct'] during Slice 8e-2's pre-approval compatibility check (2026-07-16) — this field genuinely needs to satisfy TWO independently-keyed consumers under two DIFFERENT literal keys, not fixable by a rename either way. MARKET_ASSET_SUBTYPE_FIELD_RULES.reit's own gate rule checks figures.distributionYield specifically (figurePresent's alias table for it is ['distributionYield'] only — no fallback), so the canonical key must stay 'distributionYield'. But buildPromotionPlan's opportunity payload derives yieldPct from f.yieldPct ?? f.yield ?? f.coupon — 'distributionYield' is NOT in that chain — so without also writing 'yieldPct', a gate-satisfying value would still silently fail to reach the promoted opportunities.yieldPct column. alsoWriteKeys duplicates the SAME found value onto 'yieldPct' too, satisfying both.",
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
      note: "The one desired field with real enforced business logic already: MARKET_ASSET_SUBTYPE_FIELD_RULES.offshore_fund requires currency !== \"KES\" (shared/researchPipeline.ts). Envelope-routed (see ENVELOPE_ROUTED_CONTRACT_KEYS) — both the base gate's currency rule and the offshore-fund KES check read args.currency (the envelope parameter, itself sourced server-side from finding.currency), never figures.currency.",
    },
    {
      catalogue: "market_asset",
      subtype: "offshore_fund",
      key: "market",
      label: "Market",
      required: true,
      aliases: ["market", "exchange"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Added post-approval (2026-07-16) — omitted from the original 12-field product list, but CATALOGUE_FIELD_RULES.market_asset hard-requires figures.market (non-escapable) for EVERY market-asset finding regardless of subtype, proven directly via a live checkApprovalGate call that still reported 'market' missing with every other offshore-fund field supplied. Labeled 'Market' rather than reusing Equity/REIT's 'Exchange' — an offshore fund is not exchange-listed the way an NSE equity or REIT is. Same underlying opportunities.market column and extendedFields.MarketAssetProfile.exchange home. storageStatus corrected extendedFields->column during Slice 8g-2 (2026-07-17) — opportunities.market genuinely IS a real, already-promoted column; the field was mislabeled.",
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
      key: "trailingReturnPct",
      label: "Annualized return / performance",
      required: true,
      aliases: ["trailingReturn", "trailingReturnPct"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Key renamed from 'annualizedReturn' to 'trailingReturnPct' during Slice 8e-3's pre-approval compatibility check (2026-07-16) — buildPromotionPlan has a DEDICATED trailingReturnPct payload field (num(f.trailingReturnPct ?? f.trailingReturn)), separate from lastPrice; the original key wasn't recognised by it. This rename also happens to satisfy the base gate's lastPrice OR-requirement, since figurePresent's lastPrice alias table already tolerates 'trailingReturnPct' — no alsoWriteKeys needed, unlike REIT's distributionYield. Display label unchanged.",
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
      key: "expenseRatioPct",
      label: "Fees",
      required: true,
      aliases: ["fee", "expenseRatioPct", "expense"],
      storageStatus: "column",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: true,
      note: "Key renamed from 'fees' to 'expenseRatioPct' during Slice 8e-3's pre-approval compatibility check (2026-07-16) — MARKET_ASSET_SUBTYPE_FIELD_RULES.offshore_fund's own gate rule checks figures.expenseRatioPct specifically (figurePresent's alias table for it is ['expenseRatioPct', 'fee'] — 'fees' plural was never in it), and buildPromotionPlan's f.expenseRatioPct ?? f.expense ?? f.fee read didn't recognise 'fees' either. Display label unchanged.",
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
      key: "minimumShareCapital",
      label: "Minimum share capital",
      required: true,
      aliases: ["minimumShareCapital"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Added post-approval (2026-07-16) — omitted from the original 11-field product list, but SACCO_MARKET_ASSET_FIELD_RULES hard-requires figures.minimumShareCapital (non-escapable, no fallback in SACCO_FIELD_ALIASES) as its OWN distinct requirement, separate from minimumMonthlyDeposit — a real SACCO requires both a one-time share-capital buy-in AND ongoing monthly deposits. Proven directly via a live checkApprovalGate call that still reported it missing with every other SACCO field supplied. Not a first-class column — same tier as the other SACCO-specific figures.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "minimumMonthlyDeposit",
      label: "Minimum contribution",
      required: true,
      aliases: ["minimumMonthlyDeposit"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Key renamed from 'minContribution' to 'minimumMonthlyDeposit' during Slice 8e-4's pre-approval compatibility check (2026-07-16) — SACCO_FIELD_ALIASES.minimumMonthlyDeposit is ['minimumMonthlyDeposit', 'minimumMonthlyContribution'] only; 'minContribution' was never in it, confirmed via a live checkApprovalGate call. Display label unchanged.",
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
      key: "withdrawalTerms",
      label: "Lock-in or withdrawal rule",
      required: true,
      aliases: ["withdrawalTerms"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: true,
      promoteToCatalogueRow: false,
      note: "Key renamed from 'lockInWithdrawalRule' to 'withdrawalTerms' during Slice 8e-4's pre-approval compatibility check (2026-07-16) — confirmed via a live checkApprovalGate call: with only 'lockInWithdrawalRule' filled in (the natural case), the gate failed on 'withdrawal / liquidity terms'. SACCO_FIELD_ALIASES.withdrawalTerms is ['withdrawalTerms', 'liquidity'] — the original key was never in it (it was only coincidentally masked when the separate 'liquidity' field also had a value). Display label unchanged.",
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
      note: "Generic shared enum; SACCO's real liquidity concept is closer to withdrawalTerms above.",
    },
    {
      catalogue: "market_asset",
      subtype: "sacco",
      key: "regulatoryStatus",
      label: "Risk / protection note",
      required: false,
      aliases: ["regulatoryStatus"],
      storageStatus: "extendedFields",
      managerEditable: true,
      showInTable: false,
      promoteToCatalogueRow: false,
      note: "Key renamed from 'riskProtectionNote' to 'regulatoryStatus' during Slice 8e-4's pre-approval compatibility check (2026-07-16) — SACCO_MARKET_ASSET_FIELD_RULES hard-requires figures.regulatoryStatus (SACCO_FIELD_ALIASES tolerance is ['regulatoryStatus'] only, no fallback); the original key was never recognised, confirmed via a live checkApprovalGate call. Closest available proxy is extendedFields.MarketAssetProfile.regulatoryStatus (e.g. \"SASRA-regulated\") — a status flag, not really a risk/protection note; a genuine risk/protection field is still a gap. Display label unchanged.",
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
  // Slice 8c — bankName mirrors MMF's fundName: buildPromotionPlan's bank branch
  // reads `bankName: str(update.issuer) ?? name` from the envelope, never
  // `f.bankName`, even though the raw extraction also happens to carry a
  // `bankName` figures key (it isn't excluded at extraction time). sourceLink/
  // sourceAsOf mirror MMF for the same reason: the gate's bank rules and
  // buildPromotionPlan both read source/asOf from the envelope only.
  bank: new Set(["bankName", "sourceLink", "sourceAsOf"]),
  // Slice 8d — CBK has no name-equivalent envelope field (the contract has no
  // "name" field at all, matching CATALOGUE_FIELD_RULES.cbk, which likewise has
  // no name-sourced rule — validatePendingUpdate already enforces a name
  // universally). sourceLink/sourceAsOf mirror MMF/Bank: buildPromotionPlan's
  // opportunity branch sets `source` from the envelope only, and dataAsOf is
  // written from the pending update's own `asOf` column, never from figures.
  cbk: new Set(["sourceLink", "sourceAsOf"]),
  // Slice 8e-1 (Equity) + Slice 8e-2 (REIT) + Slice 8e-3 (Offshore fund) +
  // Slice 8e-4 (SACCO — the last market-asset subtype). companyName/reitName/
  // fundName/saccoName each mirror MMF's fundName/Bank's bankName:
  // buildPromotionPlan's opportunity branch sets `name` from the envelope
  // (update.name, itself finding.instrumentName) only, never from figures.
  // fundManager mirrors MMF/Bank's fund-manager-equivalent field: the base
  // gate's issuer rule and buildPromotionPlan both read args.issuer/
  // update.issuer from the envelope only, never figures.fundManager (also see
  // the reconfirmed pre-existing gap: finding.issuer is always null for
  // AI-originated market-asset findings, SACCO included — unaffected by
  // envelope-routing either way). currency mirrors the same pattern: both the
  // base gate's currency rule and the offshore-fund KES check read
  // args.currency, never figures.currency. sourceLink/sourceAsOf mirror
  // MMF/Bank/CBK too. SACCO itself does not have a contract field for issuer/
  // currency (neither is in its 11-field product list), so fundManager/
  // currency stay relevant to Equity/Offshore fund only.
  market_asset: new Set([
    "companyName",
    "reitName",
    "fundName",
    "saccoName",
    "fundManager",
    "currency",
    "sourceLink",
    "sourceAsOf",
  ]),
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
    // Slice 8c — bank findings carry the bank's name on the same envelope
    // `issuer` field MMF uses for fund manager (server/aiResearchService.ts's
    // structuredInstrumentToDraft sets `issuer: raw.fundManager ?? raw.bankName`).
    bankName: finding.issuer ?? undefined,
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
    if (value === null) continue;
    result[field.key] = value;
    // Slice 8e-2 — duplicate onto any extra keys a different downstream
    // consumer expects the same value under (see alsoWriteKeys' own doc).
    for (const extraKey of field.alsoWriteKeys ?? []) {
      if (!envelopeRouted.has(extraKey)) result[extraKey] = value;
    }
  }
  // Slice 8e-4 — SACCO only: stamp a fixed assetType marker onto the drafted
  // figures. detectMarketAssetSacco()'s PRIMARY signal is figures.assetType
  // === "sacco", which raw passthrough always carried (the AI extraction
  // schema requires assetType on every market-asset finding). None of
  // SACCO's 12 contract fields map to it — it isn't something a manager
  // edits — so without this, contract-projected figures would silently drop
  // that reliable primary signal and fall back to weaker heuristics (a
  // regulatory-status/name text match, or presence of any SACCO-specific
  // figure). Harmless at promotion time: buildPromotionPlan never reads
  // figures.assetType for anything.
  if (contract.catalogue === "market_asset" && contract.subtype === "sacco") {
    result.assetType = "sacco";
  }
  return result;
}

/* ── Slice 8g-2 — promotion persistence for the extendedFields-only tier ────
 *
 * 8g-1's audit found a bug, not a design gap: contract-drafted findings never
 * carry `_extendedFields` (the draft button submits ONLY
 * `projectFindingToContractFigures`'s output, which never includes that raw
 * key), so every contract field with `storageStatus: "extendedFields"` that is
 * ALSO gate-required (CBK's whtRule/taxExempt/issueNumber/auctionDate/
 * valueDate/couponRate; every one of SACCO's subtype-defining figures) passed
 * `checkApprovalGate` and then vanished forever at promotion — never reaching
 * a column (buildPromotionPlan has no field for any of them) and never
 * reaching `extendedFields` either (nothing merges the figures bag into it
 * except the never-populated `_extendedFields` raw blob).
 *
 * This is the read-side fix: given the SAME `figuresIn` bag `checkApprovalGate`
 * already validated, project out exactly the extendedFields-tier subset a
 * promotion should persist. Deliberately generic across all 7 contracts (not
 * CBK/SACCO-specific) — MMF/Bank/REIT/Offshore fund naturally return `{}` or
 * near-empty today since 8g-1's audit found no gate-required extendedFields-
 * only gaps for them; Equity's `ticker` (extendedFields, not gate-required)
 * will also start persisting as a side effect of using the real contract
 * metadata instead of a hand-picked CBK/SACCO-only list — flagged separately,
 * not a special case.
 */
/**
 * Read a field's value preferring its OWN canonical key first, falling back to
 * its `aliases`. This is the opposite priority from `readAliasValue` above,
 * and deliberately so: `readAliasValue` reads RAW, pre-contract extraction
 * data (which never contains the contract's own output key, only extraction-
 * schema keys/aliases). `projectContractFiguresToExtendedFields` instead reads
 * `figuresIn` at PROMOTION time — for a contract-drafted update this is
 * already `projectFindingToContractFigures`'s OUTPUT, keyed by each field's
 * canonical `key` (not its aliases). Several fields' `aliases` arrays don't
 * happen to include their own key (SACCO's `dividendRate` reads via
 * `shareCapitalDividendRate`/`depositRebateRate` only, CBK's
 * `applicationDeadline`/`minInvestment` via a single differently-named alias,
 * Offshore fund's `fxRiskNote` via `fxRisk`) — checking aliases only would
 * silently miss real, already-gate-validated data for exactly those fields.
 * Checking aliases too (not just the canonical key) keeps this safe for
 * non-contract-drafted figures bags as well (manual edits, legacy raw
 * passthrough), which may still be keyed by an alias instead.
 */
function readCanonicalOrAliasValue(
  field: CatalogueFieldContractEntry,
  figures: Record<string, unknown>,
): string | null {
  const direct = figures[field.key];
  if (direct !== undefined && direct !== null) {
    const s = String(direct).trim();
    if (s !== "" && s !== "missing_from_source") return s;
  }
  return readAliasValue(field, figures);
}

export function projectContractFiguresToExtendedFields(
  catalogue: CatalogueKey,
  subtype: MarketAssetSubtype | undefined,
  figures: Record<string, unknown> | null | undefined,
): Record<string, string> {
  const contract = getCatalogueFieldContract(catalogue, subtype);
  if (!contract || !figures) return {};
  const envelopeRouted = ENVELOPE_ROUTED_CONTRACT_KEYS[catalogue] ?? new Set<string>();
  const result: Record<string, string> = {};
  for (const field of contract.fields) {
    // Only the extendedFields-only tier — never a typed column (already
    // reaches the row via buildPromotionPlan), never computed/sourceOnly/
    // missingRequiresMigration (nothing real to persist for any of those).
    if (field.storageStatus !== "extendedFields") continue;
    // Envelope-routed fields' real value lives on the update envelope, not
    // figures — persisting them here would risk stale duplication of what
    // sourceEnrichment/promotionProvenance already handle correctly.
    if (envelopeRouted.has(field.key)) continue;
    const value = readCanonicalOrAliasValue(field, figures);
    if (value === null) continue;
    result[field.key] = value;
  }
  // Deliberately does NOT stamp `assetType` for SACCO here (unlike
  // projectFindingToContractFigures above). `assetType` is a projector-level
  // routing signal for `detectMarketAssetSacco()`, checked only against the
  // PENDING update's figures bag at gate time — no code anywhere reads a live
  // catalogue row's `extendedFields.assetType` (verified: only the module
  // header's own doc comment mentions it, as an aspirational example, not an
  // implemented check). Persisting it would be extra data with no reader, and
  // the real SACCO-row-identity gap the header describes ("a manager cannot
  // reliably filter/find SACCO rows in the catalogue today") is a separate,
  // already-documented, out-of-scope structural issue this slice does not fix.
  return result;
}

/* ── Slice 9b — approval-screen display helpers (display-only, never wired
 * into the gate, promotion, or projection layers) ──────────────────────────
 *
 * Stage 9a's audit found that ResearchDesk.tsx's actual approval screen
 * (`fmtFigures`/`PendingDiffTable`) has its own small, independent 13-entry
 * label map — completely disconnected from this contract module — so most
 * extendedFields-tier figures (CBK's whtRule/taxExempt/auctionDate/...,
 * SACCO's entire subtype-defining figure set) render with their raw
 * camelCase key as the label, and SACCO's internal `assetType` routing
 * signal is shown to the manager as if it were a real field. These helpers
 * fix exactly that, reusing the SAME contract data every other layer already
 * reads — never mutating figures, never changing what is submitted,
 * approved, or promoted.
 */

/** A pending update's identity fields, sufficient to resolve which contract
 *  (if any) applies — the same subset `reviewResearchUpdate` (server/db.ts,
 *  Slice 8g-2) already has in scope at promotion time. */
export interface ContractResolvableUpdate {
  assetClass: AssetClass;
  figures?: Record<string, unknown> | null;
  name?: string | null;
  issuer?: string | null;
}

/**
 * Resolves which catalogue + (for market_asset) subtype contract applies to
 * a pending update, from data already present on any `research_updates` row.
 * Mirrors the SAME resolution `reviewResearchUpdate` uses at promotion time
 * (Slice 8g-2) — extracted here so the approval-screen display (Slice 9b) and
 * promotion-time persistence (8g-2) read from ONE place instead of two
 * independently-maintained copies of the same equity/reit/offshore_fund/sacco
 * branching logic. Imports `catalogueForAssetClass`/`detectMarketAssetSacco`
 * from `./researchPipeline` directly — a one-directional dependency
 * (researchPipeline.ts has no import of this module), so there is no
 * circular-import risk.
 */
export function resolveContractCatalogueForUpdate(
  update: ContractResolvableUpdate,
): { catalogue: CatalogueKey; subtype?: MarketAssetSubtype } {
  const catalogue = catalogueForAssetClass(update.assetClass);
  if (catalogue !== "market_asset") return { catalogue };
  if (update.assetClass === "equity" || update.assetClass === "reit" || update.assetClass === "offshore_fund") {
    return { catalogue, subtype: update.assetClass };
  }
  const isSacco = detectMarketAssetSacco({
    catalogue,
    assetClass: update.assetClass,
    figures: update.figures,
    name: update.name,
    issuer: update.issuer,
  });
  return { catalogue, subtype: isSacco ? "sacco" : undefined };
}

/**
 * Internal routing/detection signals that must never be shown to a manager
 * as if they were a real approval figure. Currently just SACCO's `assetType`
 * stamp (see `projectFindingToContractFigures`'s own doc comment for why it
 * exists at all). Catalogue/subtype-scoped so the same raw string appearing
 * in a DIFFERENT catalogue's figures bag is never accidentally hidden.
 */
export function isInternalRoutingFigureKey(
  catalogue: CatalogueKey | null | undefined,
  subtype: MarketAssetSubtype | undefined,
  key: string,
): boolean {
  return catalogue === "market_asset" && subtype === "sacco" && key === "assetType";
}

/**
 * Resolves a human-readable label for a raw figures-bag key on the approval
 * screen, using the active catalogue/subtype's contract when one applies.
 * Checks the field's own canonical key first, then its `aliases` — a raw
 * AI-extraction-schema field name (e.g. from `PendingDiffTable`'s
 * `changedFields`, which comes straight from the LLM's structured output
 * before any contract projection) is very likely to be an ALIAS, not the
 * canonical key. Falls back to `fallbackLabel` (or the raw key itself) for
 * anything the active contract doesn't recognize — this function never hides
 * a field on its own; pair it with `isInternalRoutingFigureKey` for that.
 */
export function resolveApprovalFigureLabel(
  catalogue: CatalogueKey | null | undefined,
  subtype: MarketAssetSubtype | undefined,
  key: string,
  fallbackLabel?: string,
): string {
  const contract = catalogue ? getCatalogueFieldContract(catalogue, subtype) : null;
  if (contract) {
    // Two passes, deliberately: some fields list another field's canonical
    // key as one of THEIR OWN aliases (e.g. CBK's yieldPct aliases include
    // "couponRate", which is ALSO its own separate, independently-read
    // contract field — a real alias-purpose overlap 8g-4's audit found). A
    // single combined pass risks matching the WRONG field's alias before
    // ever reaching the right field's own canonical key. Canonical-key
    // matches across every field always win first; aliases are only a
    // fallback once no field claims the key as its own.
    for (const field of contract.fields) {
      if (field.key === key) return field.label;
    }
    for (const field of contract.fields) {
      if (field.aliases.includes(key)) return field.label;
    }
  }
  return fallbackLabel ?? key;
}
