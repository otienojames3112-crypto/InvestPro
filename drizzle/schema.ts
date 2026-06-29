import { sql } from "drizzle-orm";
import type { FieldProvenanceMap } from "../shared/provenance";
import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  date,
  json,
  bigint,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Portfolios — one user can own many portfolios.
 * Each portfolio is a self-contained investment plan with its own target,
 * horizon, contribution schedule, phase fractions, and rate sources.
 */
export const portfolios = mysqlTable("portfolios", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** Human-readable label, e.g. "James — 5M Plan" */
  name: varchar("name", { length: 200 }).notNull().default("My Portfolio"),
  /** Optional description / notes */
  description: text("description"),
  /** Target portfolio value to hold at end of horizon */
  targetAmount: decimal("targetAmount", { precision: 14, scale: 2 }).notNull().default("5000000.00"),
  /** Plan start date (YYYY-MM-DD) */
  startDate: date("startDate").notNull().default(sql`'2026-07-01'`),
  /** Total plan duration in months (12–240). Default 120 = 10 years. */
  horizonMonths: int("horizonMonths").notNull().default(120),
  /** Starting monthly contribution (KES) */
  startingContribution: decimal("startingContribution", { precision: 10, scale: 2 }).notNull().default("2500.00"),
  /** Step-up amount added every stepUpMonths */
  stepUpAmount: decimal("stepUpAmount", { precision: 10, scale: 2 }).notNull().default("3000.00"),
  /** How often to step up (months) */
  stepUpMonths: int("stepUpMonths").notNull().default(6),
  /** Minimum MMF balance before sweeping to DhowCSD */
  safetyFloor: decimal("safetyFloor", { precision: 10, scale: 2 }).notNull().default("50000.00"),
  /**
   * Phase fractions (must sum to 1.0). Expressed as decimal fractions of horizonMonths.
   * Defaults match the original PDF: Foundation 20%, Growth 50%, De-risking 15%, Final 15%.
   */
  foundationFrac: decimal("foundationFrac", { precision: 5, scale: 4 }).notNull().default("0.2000"),
  growthFrac: decimal("growthFrac", { precision: 5, scale: 4 }).notNull().default("0.5000"),
  deRiskingFrac: decimal("deRiskingFrac", { precision: 5, scale: 4 }).notNull().default("0.1500"),
  /**
   * Round 34: editable per-issuer concentration cap (%). No single bank/issuer
   * may exceed this share of net worth before the Dashboard banner warns.
   * Government securities are sovereign and exempt. Default 25%.
   */
  concentrationCapPct: decimal("concentrationCapPct", { precision: 5, scale: 2 }).notNull().default("25.00"),
  /**
   * Round 58: editable per-INSTRUMENT-TYPE concentration cap (%). Distinct from
   * concentrationCapPct (which is a per-ISSUER/bank cap for KDIC deposit-insurance
   * risk). This cap flags when a single CBK instrument TYPE (T-bills / IFB / FXD /
   * etc.) dominates more than this share of current portfolio value, surfacing a
   * diversification warning on the Portfolio Review risk snapshot. Default 60%.
   */
  typeConcentrationCapPct: decimal("typeConcentrationCapPct", { precision: 5, scale: 2 }).notNull().default("60.00"),
  /**
   * Round 60: optional snooze for concentration warnings. When set to a future
   * Unix-ms timestamp, the Dashboard concentration banner is muted and the Risk
   * limits cards show a "snoozed until" note until that time passes. Null means
   * not snoozed. Stored as milliseconds since epoch (UTC).
   */
  concentrationSnoozeUntil: bigint("concentrationSnoozeUntil", { mode: "number" }),
  /**
   * Round 62: per-portfolio ALLOCATION POLICY governing how the projection sweep,
   * the liquid-reserve allocator, and the concentration warnings behave.
   *   - balanced (default): respect concentrationCapPct (issuer) and
   *     typeConcentrationCapPct (instrument family); diversify liquid cash.
   *   - yield_first: relax caps toward the user's relaxed ceiling and keep money
   *     in the highest net-yield eligible home; requires a logged risk
   *     acknowledgment (yieldFirstAckAt). Concentration is shown but marked
   *     "within your chosen policy" rather than "over cap".
   *   - custom: user sets their own issuer/type caps (same two columns).
   */
  allocationPolicy: mysqlEnum("allocationPolicy", ["balanced", "yield_first", "custom"]).notNull().default("balanced"),
  /**
   * Round 62: Unix-ms timestamp when the user acknowledged the Yield-first risk
   * ("I understand this concentrates my money in one institution and gives up
   * KDIC diversification"). Null until acknowledged; the acknowledgment is also
   * written to the audit_log (Change History).
   */
  yieldFirstAckAt: bigint("yieldFirstAckAt", { mode: "number" }),
  /**
   * Round 66: when total liquid drift (sum of |actual − target| across reconciled
   * homes) exceeds this percentage of net worth, the Dashboard liquid card shows
   * a rebalancing alert. Default 5%.
   */
  driftAlertThresholdPct: decimal("driftAlertThresholdPct", { precision: 5, scale: 2 }).notNull().default("5.00"),
  /**
   * Round 67: optional snooze for the liquid drift-rebalancing alert. When set to
   * a future Unix-ms timestamp, the Dashboard liquid card mutes the drift alert
   * and the owner notification is suppressed until that time passes. Null means
   * not snoozed. Stored as milliseconds since epoch (UTC).
   */
  driftSnoozeUntil: bigint("driftSnoozeUntil", { mode: "number" }),
  /**
   * Round 67: Unix-ms timestamp of the last drift-breach owner notification, so
   * we only notify on a fresh transition INTO breach (not on every reload).
   */
  driftLastNotifiedAt: bigint("driftLastNotifiedAt", { mode: "number" }),
  /**
   * Round 68: drift-breach notification mode. "immediate" (default) pings the
   * owner on each fresh breach transition; "digest" suppresses per-event pings
   * and instead sends one daily summary via a Heartbeat cron.
   */
  driftDigestMode: varchar("driftDigestMode", { length: 16 }).notNull().default("immediate"),
  /**
   * Round 68: the Heartbeat cron task_uid backing the daily digest, so we can
   * update/delete the job later. Null when digest mode is off. Looked up by
   * task_uid in the /api/scheduled/driftDigest handler, never by name.
   */
  driftDigestCronTaskUid: varchar("driftDigestCronTaskUid", { length: 65 }),
  /**
   * Round 68: set true when a breach occurs while in digest mode (a ping is
   * "pending" for the next daily summary); cleared once the digest fires.
   */
  driftDigestPending: boolean("driftDigestPending").notNull().default(false),
  // finalLiquidityFrac is implied: 1 - foundationFrac - growthFrac - deRiskingFrac
  /** Editable source URL for CBK T-Bills rates page */
  cbkSourceUrl: varchar("cbkSourceUrl", { length: 500 }).notNull().default("https://www.centralbank.go.ke/bills-bonds/treasury-bills/"),
  /** Editable source URL for SanlamAllianz MMF page */
  sanlamSourceUrl: varchar("sanlamSourceUrl", { length: 500 }).notNull().default("https://www.sanlamallianz.co.ke/products/savings-and-investments/money-market-fund/"),
  /** Timestamp of last manual rate update (for staleness indicator) */
  ratesLastUpdatedAt: timestamp("ratesLastUpdatedAt"),
  /**
   * Selected MMF fund for this portfolio (nullable FK to mmf_funds).
   * If set, engine uses this fund's EAR as the MMF return (WHT still applied on top).
   * If null, engine falls back to rate_settings.mmfYield.
   */
  mmfFundId: int("mmfFundId"),
  /**
   * Test/live boundary. When true, this portfolio belongs to the user's
   * sandbox (Test mode) and must never mix with live portfolios.
   * All portfolio-scoped queries filter by the active mode.
   */
  isSandbox: boolean("isSandbox").notNull().default(false),
  /**
   * Time Machine (sandbox only): a simulated "today" as Unix-ms (UTC). When set,
   * every clock read (getNow) returns this instead of the real date, so the user
   * can fast-forward and watch projected ledger rows materialise into actuals.
   * Null = real clock. MUST stay null for Live (non-sandbox) portfolios.
   */
  simulatedDate: bigint("simulatedDate", { mode: "number" }),
  /**
   * Time Machine: the active simulation session id (a random string). Every
   * record the time machine creates is tagged with this id so "Reset to today"
   * can delete exactly the simulated rows for the current session. Null = no
   * active session.
   */
  simSessionId: varchar("simSessionId", { length: 40 }),
  /**
   * Time Machine: an append-only JSON log of each advance "step" so the user can
   * Undo the LAST step precisely (rewind one boundary + delete only that step's
   * materialised rows), distinct from a full Reset. Shape:
   * Array<{ fromMs: number; toMs: number; mode: string; depositIds: number[] }>.
   * Null/empty = nothing to undo.
   */
  simStepLog: text("simStepLog"),
  /**
   * Time Machine rate-shock stress test (sandbox only): JSON
   * `{ effectiveDate: "YYYY-MM-DD"; deltaPct: number }` shifting all yield rates
   * by deltaPct from effectiveDate onward in the projection. Null = no shock.
   * Cleared by Reset to today.
   */
  simRateShock: text("sim_rate_shock"),
  /**
   * Part A1 — Inflation-link the GOAL (the liability), not just the portfolio.
   * When true, the target is treated as today's-shilling price and the engine
   * compares the projection against the FUTURE (nominal) goal
   * `targetAmount * (1 + inflationRate)^horizonYears`, expressing surplus in real
   * (today's-shilling) terms. Default false — the goal stays nominal and the
   * Dashboard labels it "not inflation-adjusted" so the margin is not overstated.
   */
  inflationLinked: boolean("inflationLinked").notNull().default(false),
  /**
   * Part A1 — optional per-portfolio override for the goal inflation rate (% p.a.).
   * Null means "use the global inflation benchmark already shown on the Dashboard"
   * (benchmark_inputs.inflation), so we never introduce a second source of truth.
   * Only consulted when inflationLinked = true.
   */
  inflationOverrideRate: decimal("inflationOverrideRate", { precision: 6, scale: 4 }),
  /**
   * Expansion Brief Part 6 — OPTIONAL stated risk tolerance (comfort band).
   * Null means "not stated". When set it informs sensible defaults and raises a
   * non-blocking WARNING if the modeled mix is more volatile than this comfort.
   * It NEVER auto-allocates, ranks, or transacts. One of:
   * capital_preservation | conservative | balanced | growth | aggressive.
   */
  riskTolerance: varchar("riskTolerance", { length: 24 }),
  /**
   * Allocation Model Part 1 — the per-goal risk-tier selection. These three
   * columns are ADDITIVE and surface nothing to the user yet (Part 4 does the UI).
   *   - allocationSuggestedTier: the tier computed from the goal's horizon (+
   *     nature) by suggestTier(). Recorded so the UI can show "suggested" vs the
   *     user's choice and explain any later override.
   *   - allocationSelectedTier: the user's chosen tier; defaults to the suggested
   *     tier. Overriding to ANY tier is always allowed and never blocked — a
   *     riskier-than-horizon choice is only FLAGGED for a consequence (Part 3).
   *   - allocationTierOverridden: true once the user picks a tier different from
   *     the suggestion (so the UI can show "you changed this from the suggestion").
   * All three are nullable: null means "not yet computed/chosen", which the
   * resolver treats as "default to the suggestion". One of the five tiers:
   * capital_preservation | conservative | balanced | growth | aggressive.
   */
  allocationSuggestedTier: varchar("allocationSuggestedTier", { length: 24 }),
  allocationSelectedTier: varchar("allocationSelectedTier", { length: 24 }),
  allocationTierOverridden: boolean("allocationTierOverridden").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Portfolio = typeof portfolios.$inferSelect;
export type InsertPortfolio = typeof portfolios.$inferInsert;

/**
 * Investment rate settings — one row per portfolio.
 * The plan-level settings (target, horizon, contributions) live in portfolios.
 * This table holds only the market rate inputs.
 */
export const rateSettings = mysqlTable("rate_settings", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  mmfYield: decimal("mmfYield", { precision: 8, scale: 4 }).notNull().default("8.7800"),
  tbill91Rate: decimal("tbill91Rate", { precision: 8, scale: 4 }).notNull().default("8.8206"),
  tbill182Rate: decimal("tbill182Rate", { precision: 8, scale: 4 }).notNull().default("8.7782"),
  tbill364Rate: decimal("tbill364Rate", { precision: 8, scale: 4 }).notNull().default("8.9746"),
  ifbCouponRate: decimal("ifbCouponRate", { precision: 8, scale: 4 }).notNull().default("12.5000"),
  fxdCouponRate: decimal("fxdCouponRate", { precision: 8, scale: 4 }).notNull().default("12.3500"),
  withholdingTax: decimal("withholdingTax", { precision: 8, scale: 4 }).notNull().default("15.0000"),
  // Round 40: optional per-tenor rate maps for IFB/FXD bonds, keyed by tenor
  // years as string (e.g. {"8.5": 14.2, "17": 15.8}). When a tenor has no entry
  // the form/engine falls back to the flat ifbCouponRate / fxdCouponRate above,
  // so existing portfolios keep working unchanged.
  ifbTenorRates: json("ifbTenorRates").$type<Record<string, number>>(),
  fxdTenorRates: json("fxdTenorRates").$type<Record<string, number>>(),
  // Round 53: investor's liquidity horizon in days (default 365). Drives the
  // Dashboard duration-risk hint — when the value-weighted average
  // days-to-maturity approaches/exceeds this, the Avg. Maturity tile escalates.
  liquidityHorizonDays: int("liquidityHorizonDays").notNull().default(365),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RateSettings = typeof rateSettings.$inferSelect;
export type InsertRateSettings = typeof rateSettings.$inferInsert;

/**
 * Month-by-month ledger entries — one row per month per portfolio.
 */
export const ledgerEntries = mysqlTable("ledger_entries", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  monthNumber: int("monthNumber").notNull(),
  entryDate: date("entryDate").notNull(),
  contribution: decimal("contribution", { precision: 10, scale: 2 }).notNull().default("0.00"),
  cbkCashIn: decimal("cbkCashIn", { precision: 10, scale: 2 }).notNull().default("0.00"),
  mmfToDhow: decimal("mmfToDhow", { precision: 10, scale: 2 }).notNull().default("0.00"),
  mainAction: text("mainAction"),
  mmfEndBalance: decimal("mmfEndBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  tbillEndBalance: decimal("tbillEndBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  ifbEndBalance: decimal("ifbEndBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  fxdEndBalance: decimal("fxdEndBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  totalEndBalance: decimal("totalEndBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  isActual: boolean("isActual").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type InsertLedgerEntry = typeof ledgerEntries.$inferInsert;

/**
 * CBK securities register — individual T-bill and bond purchases per portfolio.
 */
export const securities = mysqlTable("securities", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  securityType: mysqlEnum("securityType", [
    "tbill_91",
    "tbill_182",
    "tbill_364",
    "ifb",
    "fxd",
    // Round 42: discount instrument with a long tenor (bought at a deep discount,
    // no coupon, face at maturity) and a coupon bond whose rate resets to a
    // benchmark periodically.
    "zero_coupon",
    "floating_rate",
  ]).notNull(),
  faceValue: decimal("faceValue", { precision: 14, scale: 2 }).notNull(),
  /**
   * Round 42: DISCOUNT INSTRUMENTS (T-bills, zero-coupon bonds) are bought BELOW
   * face. `purchasePrice` is the cash paid up front; `faceValue` is the amount
   * redeemed at maturity. The discount (face − price) is the entire return and
   * the only thing WHT applies to. Coupon bonds (FXD/IFB) are bought at par, so
   * purchasePrice equals faceValue (or is left null and treated as par).
   */
  purchasePrice: decimal("purchasePrice", { precision: 14, scale: 2 }),
  /** The discount/yield rate (% p.a.) used to price a discount instrument. */
  discountRate: decimal("discountRate", { precision: 8, scale: 4 }),
  issueDate: date("issueDate").notNull(),
  maturityDate: date("maturityDate").notNull(),
  couponRate: decimal("couponRate", { precision: 8, scale: 4 }).notNull().default("0.0000"),
  /**
   * Round 42: FLOATING RATE BOND only. The coupon resets every `resetMonths` to
   * (benchmark 91-day T-bill rate + `marginRate`). For fixed instruments these
   * are null.
   */
  marginRate: decimal("marginRate", { precision: 8, scale: 4 }),
  resetMonths: int("resetMonths"),
  /**
   * Round 39: bond tenor in years (e.g. 8.5, 10, 17). Null for T-bills (whose
   * tenor is fixed by type). Drives the maturity date and the tiered FXD WHT
   * rule (15% under 10y, 10% at/over 10y).
   */
  tenorYears: decimal("tenorYears", { precision: 5, scale: 2 }),
  isTaxExempt: boolean("isTaxExempt").notNull().default(false),
  isMatured: boolean("isMatured").notNull().default(false),
  /** When this lot was recycled via re-buy/split, points at the replacement security's id (audit trail). */
  rolledIntoId: int("rolledIntoId"),
  notes: text("notes"),
  /** Time Machine: session id when this lot was materialised by a simulation (sandbox only). Null = real record. */
  simSessionId: varchar("simSessionId", { length: 40 }),
  /**
   * Expansion Brief Part 1 — generic asset abstraction (all ADDITIVE & NULLABLE
   * so existing rows are unaffected; backfilled by migration). The engine reads
   * behavior from the AssetClass profile (shared/assetModel.ts) rather than
   * switching on securityType.
   */
  /** Behavior taxonomy: gov_discount | gov_coupon | cash_mmf | bank_deposit | equity | reit | offshore_fund | alt. */
  assetClass: mysqlEnum("assetClass", [
    "cash_mmf",
    "bank_deposit",
    "gov_discount",
    "gov_coupon",
    "equity",
    "reit",
    "offshore_fund",
    "alt",
  ]),
  /** Price-driven assets (equity/REIT/offshore): value = units × unitPrice. */
  unitPrice: decimal("unitPrice", { precision: 18, scale: 6 }),
  units: decimal("units", { precision: 18, scale: 6 }),
  /** Annual dividend yield (%) for equity income. */
  dividendYieldPct: decimal("dividendYieldPct", { precision: 8, scale: 4 }),
  /** Annual distribution yield (%) for REIT / fund income. */
  distributionYieldPct: decimal("distributionYieldPct", { precision: 8, scale: 4 }),
  /** Denomination currency (default KES; USD etc. for offshore). */
  currency: varchar("currency", { length: 8 }),
  /** FX rate used to convert to KES, with provenance below. */
  fxRateToKes: decimal("fxRateToKes", { precision: 18, scale: 6 }),
  /** Provenance: source of any scraped price/yield/FX figure (mandatory for price-driven). */
  dataSource: varchar("dataSource", { length: 200 }),
  /** Provenance: as-of timestamp for the scraped figure. */
  dataAsOf: timestamp("dataAsOf"),
  /** Annualised expected return (%) — reserved for Part 6 (nullable now). */
  expectedReturnPct: decimal("expectedReturnPct", { precision: 8, scale: 4 }),
  /** Annualised volatility (%) — reserved for Part 6 (nullable now). */
  volatilityPct: decimal("volatilityPct", { precision: 8, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Security = typeof securities.$inferSelect;
export type InsertSecurity = typeof securities.$inferInsert;

/**
 * Contribution overrides — manual overrides or lump sums for specific months per portfolio.
 */
export const contributionOverrides = mysqlTable("contribution_overrides", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  monthNumber: int("monthNumber").notNull(),
  overrideAmount: decimal("overrideAmount", { precision: 10, scale: 2 }).notNull(),
  lumpSum: decimal("lumpSum", { precision: 10, scale: 2 }).notNull().default("0.00"),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ContributionOverride = typeof contributionOverrides.$inferSelect;
export type InsertContributionOverride = typeof contributionOverrides.$inferInsert;

/**
 * Deposit entries — real money deposited into each investment bucket per portfolio.
 */
export const depositEntries = mysqlTable("deposit_entries", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  /**
   * Legacy bucket. Kept for backward compatibility and for government
   * securities (T-bill/IFB/FXD). Derived from the destination where possible.
   */
  bucket: mysqlEnum("bucket", ["mmf", "tbill", "ifb", "fxd"]).notNull(),
  /**
   * Destination institution type. Names WHERE the money actually went:
   * - mmf_fund: an MMF account (mmfFundId set; primary or a secondary fund)
   * - bank_instrument: a live bank holding (bankHoldingId set)
   * - government_security: a CBK T-bill/IFB/FXD bucket (bucket set)
   */
  institutionType: mysqlEnum("institutionType", ["mmf_fund", "bank_instrument", "government_security"]).notNull().default("government_security"),
  /** FK to mmf_funds.id when institutionType = mmf_fund */
  mmfFundId: int("mmfFundId"),
  /** FK to bank_instrument_holdings.id when institutionType = bank_instrument */
  bankHoldingId: int("bankHoldingId"),
  /**
   * FK to securities.id when institutionType = government_security.
   * A government-security deposit auto-creates a register row; this links the
   * two so the register stays the single source of truth (no double-counting)
   * and deleting the deposit can remove its register entry.
   */
  securityId: int("securityId"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  depositDate: date("depositDate").notNull(),
  notes: text("notes"),
  /** Time Machine: session id when this deposit was materialised by a simulation (sandbox only). Null = real record. */
  simSessionId: varchar("simSessionId", { length: 40 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DepositEntry = typeof depositEntries.$inferSelect;
export type InsertDepositEntry = typeof depositEntries.$inferInsert;

/**
 * Withdrawal entries — real money taken OUT of an account, per portfolio.
 *
 * A withdrawal is the money-out counterpart to deposit_entries. It reduces the
 * source account's balance, flows through the actuals aggregation (net worth,
 * dashboard totals, reconciliation), and — for a fixed deposit broken early —
 * records any forfeited interest so the tax/net-worth picture stays honest.
 *
 * The source is identified the same way deposits name their destination:
 * - mmf_fund: pulled from an MMF account (mmfFundId set; primary or secondary)
 * - bank_instrument: pulled from a bank holding (bankHoldingId set)
 * - government_security: matured/redeemed cash from a CBK lot (securityId set)
 */
export const withdrawalEntries = mysqlTable("withdrawal_entries", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  /** Where the money came from. Mirrors deposit_entries.institutionType. */
  sourceType: mysqlEnum("sourceType", ["mmf_fund", "bank_instrument", "government_security"]).notNull().default("mmf_fund"),
  /** FK to mmf_funds.id when sourceType = mmf_fund (null = primary fund). */
  mmfFundId: int("mmfFundId"),
  /** FK to bank_instrument_holdings.id when sourceType = bank_instrument. */
  bankHoldingId: int("bankHoldingId"),
  /** FK to securities.id when sourceType = government_security. */
  securityId: int("securityId"),
  /** Gross amount withdrawn (KES, positive number). */
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  /** Interest forfeited by an early fixed-deposit break (KES). 0 otherwise. */
  forfeitedInterest: decimal("forfeitedInterest", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** True when this was an early break of a fixed deposit before maturity. */
  isEarlyWithdrawal: boolean("isEarlyWithdrawal").notNull().default(false),
  withdrawalDate: date("withdrawalDate").notNull(),
  /** Optional reason / destination note. */
  reason: text("reason"),
  notes: text("notes"),
  /** Time Machine: session id when this withdrawal was materialised by a simulation (sandbox only). Null = real record. */
  simSessionId: varchar("simSessionId", { length: 40 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type WithdrawalEntry = typeof withdrawalEntries.$inferSelect;
export type InsertWithdrawalEntry = typeof withdrawalEntries.$inferInsert;

/**
 * Rate history — per-portfolio rate snapshots for time-locked projection.
 */
export const rateHistory = mysqlTable("rate_history", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  effectiveDate: date("effectiveDate").notNull(),
  mmfYield: decimal("mmfYield", { precision: 8, scale: 4 }).notNull(),
  tbill91Rate: decimal("tbill91Rate", { precision: 8, scale: 4 }).notNull(),
  tbill182Rate: decimal("tbill182Rate", { precision: 8, scale: 4 }).notNull(),
  tbill364Rate: decimal("tbill364Rate", { precision: 8, scale: 4 }).notNull(),
  ifbCouponRate: decimal("ifbCouponRate", { precision: 8, scale: 4 }).notNull(),
  fxdCouponRate: decimal("fxdCouponRate", { precision: 8, scale: 4 }).notNull(),
  withholdingTax: decimal("withholdingTax", { precision: 8, scale: 4 }).notNull(),
  changeNote: text("changeNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RateHistory = typeof rateHistory.$inferSelect;
export type InsertRateHistory = typeof rateHistory.$inferInsert;

/**
 * Account status — tracks whether the user has opened each investment account.
 * Keyed to portfolioId so each plan can track its own account setup progress.
 */
export const accountStatus = mysqlTable("account_status", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  accountType: mysqlEnum("accountType", ["mmf", "dhowcsd"]).notNull(),
  isOpened: boolean("isOpened").notNull().default(false),
  accountNumber: varchar("accountNumber", { length: 100 }),
  accountName: varchar("accountName", { length: 200 }),
  dateOpened: date("dateOpened"),
  phoneNumber: varchar("phoneNumber", { length: 20 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AccountStatus = typeof accountStatus.$inferSelect;
export type InsertAccountStatus = typeof accountStatus.$inferInsert;

// pendingRateFetches and rateFetchLog tables removed — replaced by manual rate entry flow

/**
 * MMF Funds — CMA-regulated Kenyan money market funds.
 * Maintained manually; shared across all portfolios (not per-portfolio).
 */
export const mmfFunds = mysqlTable("mmf_funds", {
  id: int("id").autoincrement().primaryKey(),
  /** Fund name, e.g. "SanlamAllianz Money Market Fund" */
  fundName: varchar("fundName", { length: 200 }).notNull(),
  /** Fund manager / company, e.g. "SanlamAllianz Kenya" */
  company: varchar("company", { length: 200 }).notNull(),
  /** Quoted gross yield (% p.a.) before management fee */
  grossYield: decimal("grossYield", { precision: 8, scale: 4 }).notNull(),
  /** Effective Annual Rate net of management fee (% p.a.) — used by engine */
  ear: decimal("ear", { precision: 8, scale: 4 }).notNull(),
  /** Annual management fee (% p.a.) */
  managementFee: decimal("managementFee", { precision: 6, scale: 4 }).notNull().default("2.0000"),
  /** Minimum investment amount (KES) */
  minInvestment: decimal("minInvestment", { precision: 12, scale: 2 }).notNull().default("1000.00"),
  /** Assets under management (KES millions) — optional */
  aumMillions: decimal("aumMillions", { precision: 12, scale: 2 }),
  /** Date the data was sourced / last verified */
  asOfDate: date("asOfDate"),
  /** Source URL or description */
  source: varchar("source", { length: 500 }),
  /** Whether this fund is active / still available */
  isActive: boolean("isActive").notNull().default(true),
  /** Day-count basis for daily accrual: 365 (actual/365) or 360 */
  dayCountBasis: int("dayCountBasis").notNull().default(365),
  /** Crediting / compounding frequency: "daily" (net joins balance daily) or "monthly" (accrues daily, paid month-end) */
  creditingFrequency: mysqlEnum("creditingFrequency", ["daily", "monthly"]).notNull().default("daily"),
  /** Per-fund withholding tax rate on interest (% ) — default 15 */
  whtRate: decimal("whtRate", { precision: 6, scale: 4 }).notNull().default("15.0000"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MmfFund = typeof mmfFunds.$inferSelect;
export type InsertMmfFund = typeof mmfFunds.$inferInsert;

/**
 * Other holdings — real estate, equities, ETFs, and other assets tracked per portfolio.
 * This is a TRACKING layer only. No recommendations are made.
 */
export const otherHoldings = mysqlTable("other_holdings", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  /** Asset class */
  assetClass: mysqlEnum("assetClass", ["real_estate", "equity", "etf", "pension", "sacco", "business", "crypto", "insurance", "other"]).notNull(),
  /** User-supplied name, e.g. "Nairobi apartment", "Safaricom shares" */
  name: varchar("name", { length: 200 }).notNull(),
  /** Optional description / notes */
  description: text("description"),
  /** Purchase / cost basis (KES) */
  purchaseValue: decimal("purchaseValue", { precision: 14, scale: 2 }).notNull(),
  /** Current estimated value (KES) — updated manually */
  currentValue: decimal("currentValue", { precision: 14, scale: 2 }).notNull(),
  /** Date of purchase / acquisition */
  purchaseDate: date("purchaseDate"),
  /** User's own notes */
  notes: text("notes"),
  /**
   * Optional user-entered assumed annual return (%) for scenario modelling.
   * Conservative / base / optimistic — all three are user-entered assumptions,
   * never engine-generated forecasts.
   */
  assumedReturnConservative: decimal("assumedReturnConservative", { precision: 6, scale: 2 }),
  assumedReturnBase: decimal("assumedReturnBase", { precision: 6, scale: 2 }),
  assumedReturnOptimistic: decimal("assumedReturnOptimistic", { precision: 6, scale: 2 }),
  /**
   * Expansion Brief Part 5 — structured mark-to-model + provenance (all ADDITIVE
   * & NULLABLE so existing rows are unaffected). The register `assetClass` above
   * is a coarse taxonomy (REIT collapses into real_estate, offshore into etf);
   * `behaviorClass` preserves the precise Part-1 behavior identity so every
   * money-counting surface can value, label, tax and risk-classify the holding
   * from ONE source. Price-driven value = units × unitPrice × fxRateToKes, so a
   * holding's value is RE-DERIVED (never trusted from a stale currentValue).
   */
  /** Precise behavior taxonomy: equity | reit | offshore_fund | cash_mmf | bank_deposit | gov_discount | gov_coupon | alt. Null for legacy manual rows. */
  behaviorClass: varchar("behaviorClass", { length: 24 }),
  /** Price-driven units/shares held. */
  units: decimal("units", { precision: 18, scale: 6 }),
  /** Price per unit in the instrument's own currency. */
  unitPrice: decimal("unitPrice", { precision: 18, scale: 6 }),
  /** Denomination currency (default KES; USD etc. for offshore). */
  currency: varchar("currency", { length: 8 }),
  /** FX rate KES per native currency used to convert to KES. */
  fxRateToKes: decimal("fxRateToKes", { precision: 18, scale: 6 }),
  /** User's assumed income (dividend/distribution) rate %/yr. */
  incomeRatePct: decimal("incomeRatePct", { precision: 8, scale: 4 }),
  /** Provenance: source of the price/FX figure (mandatory for price-driven). */
  dataSource: varchar("dataSource", { length: 200 }),
  /** Provenance: as-of timestamp for the price/FX figure. */
  dataAsOf: timestamp("dataAsOf"),
  /**
   * Expansion Brief Part 6 — editable per-holding RISK ASSUMPTIONS (all ADDITIVE
   * & NULLABLE). Null means "use the per-class default in shared/riskModel.ts";
   * a stored value is the user's own assumption and is always labeled as such.
   * These feed the portfolio end-value DISTRIBUTION and goal probability.
   */
  /** Assumed annual return (%/yr) for the distribution mean. */
  expectedReturnPct: decimal("expectedReturnPct", { precision: 8, scale: 4 }),
  /** Assumed annualised volatility (%/yr) — how much the value could swing. */
  volatilityPct: decimal("volatilityPct", { precision: 8, scale: 4 }),
  /** Coarse correlation group: kes_rates | kes_equity | property | offshore_equity | cash. */
  correlationGroup: varchar("correlationGroup", { length: 24 }),
  /** Provenance: where the risk assumption came from (user note / source). */
  riskSource: varchar("riskSource", { length: 200 }),
  /** Provenance: as-of timestamp for the risk assumption. */
  riskAsOf: timestamp("riskAsOf"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OtherHolding = typeof otherHoldings.$inferSelect;
export type InsertOtherHolding = typeof otherHoldings.$inferInsert;

/**
 * Holding income — dividends, rent, and other income per holding.
 */
export const holdingIncome = mysqlTable("holding_income", {
  id: int("id").autoincrement().primaryKey(),
  holdingId: int("holdingId").notNull(),
  /** Income amount (KES) */
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  /** Date received */
  incomeDate: date("incomeDate").notNull(),
  /** Income type, e.g. "dividend", "rent", "interest" */
  incomeType: varchar("incomeType", { length: 50 }).notNull().default("other"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type HoldingIncome = typeof holdingIncome.$inferSelect;
export type InsertHoldingIncome = typeof holdingIncome.$inferInsert;

/**
 * Secondary MMF accounts — additional MMF funds a user is investing in alongside
 * their primary fund. Each row links a portfolio to an mmfFund and stores the
 * user's current balance in that fund.
 *
 * The primary fund is stored on the portfolio row (mmfFundId).
 * This table holds any additional funds the user wants to track.
 */
export const portfolioSecondaryMmfs = mysqlTable("portfolio_secondary_mmfs", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  /** References mmfFunds.id */
  mmfFundId: int("mmfFundId").notNull(),
  /** Optional user label, e.g. "Cytonn MMF (savings)" */
  label: varchar("label", { length: 200 }),
  /** Current balance in this fund (KES) — updated manually */
  currentBalance: decimal("currentBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** Monthly contribution amount allocated to this fund (KES) */
  monthlyContribution: decimal("monthlyContribution", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** Notes */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PortfolioSecondaryMmf = typeof portfolioSecondaryMmfs.$inferSelect;
export type InsertPortfolioSecondaryMmf = typeof portfolioSecondaryMmfs.$inferInsert;


/**
 * MMF composition — editable asset-allocation breakdown per fund.
 * Linked to mmfFunds.id. Buckets stored as percentages (0–100).
 * Seeded from published 2026 factsheets; fully user-editable.
 */
export const mmfComposition = mysqlTable("mmf_composition", {
  id: int("id").autoincrement().primaryKey(),
  /** References mmfFunds.id */
  mmfFundId: int("mmfFundId").notNull(),
  /** % in Government Securities (T-bills, T-bonds, IFBs) — total */
  govSecurities: decimal("govSecurities", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** Sub-breakdown of govSecurities: % of the WHOLE fund in Treasury Bills */
  govTbills: decimal("govTbills", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** Sub-breakdown of govSecurities: % of the WHOLE fund in Treasury Bonds (FXD) */
  govTbonds: decimal("govTbonds", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** Sub-breakdown of govSecurities: % of the WHOLE fund in Infrastructure Bonds (IFB) */
  govIfb: decimal("govIfb", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in Banking Sector Instruments (fixed / call / demand deposits) */
  bankInstruments: decimal("bankInstruments", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in Corporate Short-Term Debt (commercial paper, corporate notes) */
  corporateDebt: decimal("corporateDebt", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in Cash & Cash Equivalents */
  cashEquivalents: decimal("cashEquivalents", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in Collective Investment Schemes / Regional / Offshore */
  offshoreRegional: decimal("offshoreRegional", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in Real Estate / Property (most pure MMFs hold 0; some affiliated funds have exposure) */
  realEstate: decimal("realEstate", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in any other asset class not covered above (structured notes, etc.) */
  otherAssets: decimal("otherAssets", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** Per-segment detail notes (which holdings + indicative rates) */
  bankNote: text("bankNote"),
  corporateNote: text("corporateNote"),
  cashNote: text("cashNote"),
  offshoreNote: text("offshoreNote"),
  realEstateNote: text("realEstateNote"),
  otherNote: text("otherNote"),
  /** Plain-language notes on strategy / how the fund earns its return */
  notes: text("notes"),
  /** "As of" date for this composition snapshot */
  asOfDate: date("asOfDate"),
  /** Source URL or description (factsheet) */
  source: varchar("source", { length: 500 }),
  /** Whether figures are exact (from factsheet) or estimated */
  isEstimate: boolean("isEstimate").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MmfComposition = typeof mmfComposition.$inferSelect;
export type InsertMmfComposition = typeof mmfComposition.$inferInsert;

/**
 * Bank Sector Instruments — editable reference table of Kenyan bank
 * call / fixed deposit products. Global (shared across portfolios).
 */
export const bankInstruments = mysqlTable("bank_instruments", {
  id: int("id").autoincrement().primaryKey(),
  /** Bank name, e.g. "Equity Bank" */
  bankName: varchar("bankName", { length: 200 }).notNull(),
  /** Instrument type */
  instrumentType: mysqlEnum("instrumentType", ["call_deposit", "fixed_deposit", "ordinary_savings", "target_savings", "tiered_savings"]).notNull(),
  /** Minimum amount (KES) */
  minAmount: decimal("minAmount", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** Typical tenor, e.g. "1–12 months" */
  typicalTenor: varchar("typicalTenor", { length: 100 }),
  /** Indicative rate (% p.a.) — negotiated rates vary */
  indicativeRate: decimal("indicativeRate", { precision: 6, scale: 2 }),
  /** Whether the rate is negotiable */
  isNegotiable: boolean("isNegotiable").notNull().default(true),
  /** Notes */
  notes: text("notes"),
  /** "As of" date */
  asOfDate: date("asOfDate"),
  /** Source URL */
  source: varchar("source", { length: 500 }),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BankInstrument = typeof bankInstruments.$inferSelect;
export type InsertBankInstrument = typeof bankInstruments.$inferInsert;

/**
 * Bank Instrument Holdings — LIVE actual money the user has placed in a
 * bank call/fixed deposit, per portfolio. This is the actuals counterpart
 * to the global `bankInstruments` reference catalog.
 *
 * These holdings are real recorded money: they appear in net worth and the
 * allocation breakdown, earn interest in the accrual ledger (rate, day-count,
 * 15% WHT where applicable), and their maturities show in the liquidity calendar.
 * Fixed deposits typically pay at maturity; call deposits accrue and are
 * withdrawable on call. Rates are manually editable with as-of dates.
 */
export const bankInstrumentHoldings = mysqlTable("bank_instrument_holdings", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  /** Bank name, e.g. "Equity Bank" */
  bankName: varchar("bankName", { length: 200 }).notNull(),
  /** Optional user label, e.g. "Equity 3-month FD" */
  label: varchar("label", { length: 200 }),
  /** Instrument type (Round 30: all five bank-deposit kinds). */
  instrumentType: mysqlEnum("instrumentType", [
    "call_deposit",
    "fixed_deposit",
    "ordinary_savings",
    "target_savings",
    "tiered_savings",
  ]).notNull(),
  /** Principal placed (KES) */
  principal: decimal("principal", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** Annual interest rate (% p.a.) — manually editable */
  interestRate: decimal("interestRate", { precision: 6, scale: 4 }).notNull().default("0.0000"),
  /** As-of date for the interest rate */
  rateAsOfDate: date("rateAsOfDate"),
  /** Whether the rate is negotiable */
  isNegotiable: boolean("isNegotiable").notNull().default(true),
  /** Day-count basis for accrual: 365 or 360 */
  dayCountBasis: int("dayCountBasis").notNull().default(365),
  /** Withholding tax rate on interest (%) — default 15 */
  whtRate: decimal("whtRate", { precision: 6, scale: 4 }).notNull().default("15.0000"),
  /** Start / placement date */
  startDate: date("startDate"),
  /** Tenor in months (for fixed deposits); null/0 for open-ended call deposits */
  tenorMonths: int("tenorMonths"),
  /** Maturity date (fixed deposits); null for call deposits */
  maturityDate: date("maturityDate"),
  /** Payout frequency, e.g. "maturity", "monthly", "quarterly" */
  payoutFrequency: mysqlEnum("payoutFrequency", ["maturity", "monthly", "quarterly", "on_call"]).notNull().default("maturity"),
  /** Current accrued value (KES) — updated manually or computed */
  currentValue: decimal("currentValue", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /**
   * Early-break penalty (% of interest forfeited) if a TERM deposit
   * (fixed/target-savings) is withdrawn before maturity. 0 = no penalty.
   * Modelled by the withdrawal flow when breaking a term deposit early.
   */
  earlyBreakPenaltyPct: decimal("earlyBreakPenaltyPct", { precision: 6, scale: 4 }).notNull().default("0.0000"),
  /**
   * Round 31: what the engine does with a TERM deposit's principal+interest at
   * maturity.
   *   - "redeploy"  (default): cash returns to the MMF and the yield-max
   *     allocator re-deploys it per the sweep rules.
   *   - "rollover": the deposit auto-renews for the same tenor at the same rate
   *     (principal+interest rolled into a fresh term), staying in the bank.
   * Ignored for LIQUID kinds (call/ordinary/tiered savings), which never mature.
   */
  maturityAction: mysqlEnum("maturityAction", ["redeploy", "rollover"]).notNull().default("redeploy"),
  notes: text("notes"),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BankInstrumentHolding = typeof bankInstrumentHoldings.$inferSelect;
export type InsertBankInstrumentHolding = typeof bankInstrumentHoldings.$inferInsert;

/**
 * Benchmark inputs — editable macro benchmarks for comparison.
 * Global (one shared set) but each row carries source + as-of.
 * Used by the benchmark-comparison view (blended return vs market / inflation).
 */
export const benchmarkInputs = mysqlTable("benchmark_inputs", {
  id: int("id").autoincrement().primaryKey(),
  /** Stable key, e.g. "mmf_market_avg", "cbr", "inflation", "tbill_91" */
  metricKey: varchar("metricKey", { length: 64 }).notNull().unique(),
  /** Human label, e.g. "MMF Market Average Yield" */
  label: varchar("label", { length: 200 }).notNull(),
  /** Value (% p.a.) */
  value: decimal("value", { precision: 8, scale: 4 }).notNull(),
  /** "As of" date */
  asOfDate: date("asOfDate"),
  /** Source URL or description */
  source: varchar("source", { length: 500 }),
  notes: text("notes"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BenchmarkInput = typeof benchmarkInputs.$inferSelect;
export type InsertBenchmarkInput = typeof benchmarkInputs.$inferInsert;

/**
 * Allocation Model Part 1 — editable TARGET ALLOCATION TEMPLATES, one row per
 * risk tier. Global (one shared set, like benchmark_inputs), each row carrying
 * its weights plus source + as-of + notes provenance so an edit is defensible.
 *
 * The `weights` JSON is a map over the five allocation buckets
 * ({ cash, gov, equity, reit, offshore }) as whole-number percentages that MUST
 * sum to 100 with cash >= the operational floor — enforced by
 * validateAllocationWeights() on every save (shared/allocationModel.ts). This
 * table stores WEIGHTS ONLY; no return/volatility/rate numbers live here (those
 * resolve from the sourced risk layer), so a non-conforming template is rejected
 * before it is ever written.
 */
export const allocationTemplates = mysqlTable("allocation_templates", {
  id: int("id").autoincrement().primaryKey(),
  /** One of the five tiers (capital_preservation | conservative | balanced | growth | aggressive). Unique. */
  tier: varchar("tier", { length: 24 }).notNull().unique(),
  /** Target mix over the five buckets as whole-number percentages, summing to 100. */
  weights: json("weights").$type<Record<string, number>>().notNull(),
  /** Provenance: where this template came from (seed note, methodology, URL). */
  source: varchar("source", { length: 500 }),
  /** "As of" / last-reviewed date (YYYY-MM-DD), provenance only. */
  asOfDate: date("asOfDate"),
  /** Free-text rationale or edit note. */
  notes: text("notes"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AllocationTemplateRow = typeof allocationTemplates.$inferSelect;
export type InsertAllocationTemplateRow = typeof allocationTemplates.$inferInsert;

/**
 * Allocation Model Part 2 — the GLIDE-curve shape parameters, editable and
 * stored with provenance (same pattern as the templates above). A SINGLE global
 * row holds the de-risking aggressiveness (steepness) and the phase-region
 * thresholds; absent ⇒ the documented defaults (DEFAULT_GLIDE_PARAMS) are used.
 * The glide owns only WEIGHTS (templates above) and this SHAPE — no return/rate
 * numbers, which resolve from the sourced risk layer.
 */
export const allocationGlideParams = mysqlTable("allocation_glide_params", {
  id: int("id").autoincrement().primaryKey(),
  /** Sentinel singleton key so there is exactly one global row. */
  singletonKey: varchar("singletonKey", { length: 16 }).notNull().unique(),
  /** { steepness, foundationEnd, growthEnd, deRiskingEnd } — the editable shape. */
  params: json("params").$type<Record<string, number>>().notNull(),
  /** Provenance: methodology note / rationale for the chosen shape. */
  source: varchar("source", { length: 500 }),
  /** "As of" / last-reviewed date (YYYY-MM-DD), provenance only. */
  asOfDate: date("asOfDate"),
  /** Free-text rationale or edit note. */
  notes: text("notes"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AllocationGlideParamsRow = typeof allocationGlideParams.$inferSelect;
export type InsertAllocationGlideParamsRow = typeof allocationGlideParams.$inferInsert;

/**
 * Audit log — change trail for rate and deposit edits (defensibility).
 * Records who changed what, when, and the before/after values.
 */
export const auditLog = mysqlTable("audit_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Portfolio this change relates to (nullable for global edits) */
  portfolioId: int("portfolioId"),
  /** Entity changed, e.g. "rate_settings", "deposit_entry", "mmf_fund" */
  entity: varchar("entity", { length: 64 }).notNull(),
  /** Optional entity row id */
  entityId: int("entityId"),
  /** Action: create | update | delete */
  action: mysqlEnum("action", ["create", "update", "delete"]).notNull(),
  /** Field name changed (for updates) */
  field: varchar("field", { length: 100 }),
  /** Previous value (stringified) */
  oldValue: text("oldValue"),
  /** New value (stringified) */
  newValue: text("newValue"),
  /** User open id who made the change */
  changedByOpenId: varchar("changedByOpenId", { length: 64 }),
  /** User display name who made the change */
  changedByName: varchar("changedByName", { length: 200 }),
  /** Free-text summary */
  summary: text("summary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;

/**
 * Round 64 — user-recorded ACTUAL balances resting in each liquid home, so the
 * liquid-split recommendation can show real drift (actual vs target) instead of
 * being guidance-only. Keyed by the allocator's stable home id (e.g. "mmf:3",
 * "bank:12"). One row per (portfolio, homeId); upserted on save.
 */
export const liquidHomeBalances = mysqlTable("liquid_home_balances", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  /** Allocator home id, e.g. "mmf:3" or "bank:12". */
  homeId: varchar("homeId", { length: 64 }).notNull(),
  /** Actual balance the user has confirmed resting in this home (KES). */
  actualBalance: decimal("actualBalance", { precision: 14, scale: 2 })
    .notNull()
    .default("0.00"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type LiquidHomeBalance = typeof liquidHomeBalances.$inferSelect;
export type InsertLiquidHomeBalance = typeof liquidHomeBalances.$inferInsert;


/**
 * Round 67 — point-in-time snapshots of total liquid drift, captured each time a
 * user reconciles (per-home, bulk, or clear). Powers the drift-history sparkline
 * on the Dashboard liquid card so users can see whether actual placement is
 * converging toward or diverging from the recommended split over time.
 */
export const liquidDriftHistory = mysqlTable("liquid_drift_history", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  /** Total drift = sum of |actual − target| across reconciled homes (KES). */
  totalDrift: decimal("totalDrift", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** Net worth at snapshot time (KES), so drift can be shown as a % later. */
  netWorth: decimal("netWorth", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** Drift-alert threshold value (KES) in effect at snapshot time. */
  thresholdValue: decimal("thresholdValue", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** Whether the drift breached the threshold at snapshot time. */
  breached: boolean("breached").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LiquidDriftHistory = typeof liquidDriftHistory.$inferSelect;
export type InsertLiquidDriftHistory = typeof liquidDriftHistory.$inferInsert;

/**
 * Expansion Brief — Part 2: the Opportunity Catalog (screener) reference data.
 *
 * One row per investable instrument the tool has pulled in from public sources.
 * This is REFERENCE data — global, identical for every user, not portfolio- or
 * user-scoped — so it lives without a portfolioId and is shown in both Live and
 * Test modes (modeling a chosen opportunity respects mode isolation; the catalog
 * itself does not).
 *
 * Hard rule encoded in the SCHEMA: there is NO quality/ranking/score column, no
 * "recommended" flag, no "tier." The tool stores neutral, sourced facts only;
 * any narrowing or ordering is performed by the user at query/display time. Every
 * numeric figure carries its own dataSource + dataAsOf so provenance travels with
 * the value and the UI can badge staleness honestly.
 */
export const opportunities = mysqlTable("opportunities", {
  id: int("id").autoincrement().primaryKey(),
  /** Stable external/reference key (e.g. NSE ticker, ISIN, fund code) — also used for detail routing. */
  ref: varchar("ref", { length: 64 }).notNull().unique(),
  /** Instrument display name. */
  name: varchar("name", { length: 200 }).notNull(),
  /** AssetClass taxonomy value from Part 1 (cash_mmf | bank_deposit | gov_discount | gov_coupon | equity | reit | offshore_fund | alt). */
  assetClass: varchar("assetClass", { length: 32 }).notNull(),
  /** Issuer / fund manager / counterparty. */
  issuer: varchar("issuer", { length: 200 }),
  /** ISO currency code the instrument is denominated in (e.g. KES, USD). */
  currency: varchar("currency", { length: 8 }).notNull().default("KES"),
  /** Market/segment label (e.g. NSE, CBK, Offshore) — neutral descriptor, not a ranking. */
  market: varchar("market", { length: 64 }),

  // ── Income-asset facts (yield/coupon). Nullable; only set where applicable. ──
  /** Headline yield or coupon (%), as published by the source. */
  yieldPct: decimal("yieldPct", { precision: 7, scale: 4 }),
  /** What `yieldPct` represents, e.g. "net annual yield", "coupon", "distribution yield". */
  yieldKind: varchar("yieldKind", { length: 48 }),

  // ── Price-driven facts (last price + trailing return). ──
  /** Last traded / quoted price in the instrument currency. */
  lastPrice: decimal("lastPrice", { precision: 16, scale: 4 }),
  /** Trailing 12-month total return (%), shown with the standard past-performance caution. */
  trailingReturnPct: decimal("trailingReturnPct", { precision: 8, scale: 4 }),

  // ── Term-asset facts (tenor / maturity). ──
  /** Tenor in years for term assets (bonds), null otherwise. */
  tenorYears: decimal("tenorYears", { precision: 6, scale: 2 }),
  /** Maturity date for term assets, null otherwise. */
  maturityDate: date("maturityDate"),

  // ── Fees. ──
  /** Expense ratio / management fee (%) where applicable. */
  expenseRatioPct: decimal("expenseRatioPct", { precision: 6, scale: 4 }),

  // ── Liquidity descriptor (neutral facet for filtering, not a quality signal). ──
  /** Liquidity bucket: daily | t_plus_settlement | term | illiquid. */
  liquidity: varchar("liquidity", { length: 32 }),

  /** Optional neutral factual note (e.g. "Infrastructure bond, tax-exempt coupon"). */
  factNote: text("factNote"),

  // ── Provenance (Part 1 honesty requirements). ──
  /** Where the figures were gathered (e.g. "NSE daily close", "CBK auction results"). */
  dataSource: varchar("dataSource", { length: 200 }),
  /** As-of timestamp for the figures; drives the staleness badge. */
  dataAsOf: timestamp("dataAsOf"),
  /** Whether any figure here was scraped/unverified (vs. an official feed). */
  unverified: boolean("unverified").notNull().default(true),

  // ── Part 7.1: per-figure provenance & verification lifecycle. ──
  /**
   * JSON map keyed by FieldKey (price | yield | coupon | tenor | maturity |
   * distribution | fx | expense | trailingReturn). Each entry is a FieldProvenance
   * (shared/provenance.ts): value, source, sourceUrl, asOf, fetchedAt,
   * verificationState, verifiedBy, verifiedAt. This is where per-figure source and
   * human-verification state live so trust travels with each individual number.
   */
  fieldProvenance: json("fieldProvenance").$type<FieldProvenanceMap>(),
  /**
   * Row-level summary verification state, derived from the figures: the highest
   * human attention any figure has received (or scraped_unverified). Stored for
   * cheap list-level badges; the per-figure map remains the source of truth.
   */
  verificationState: varchar("verificationState", { length: 24 }).notNull().default("scraped_unverified"),

  /**
   * Part 8.1 — storage keys of screenshots/images a maintainer uploaded as the SOURCE
   * for an AI image extraction on this row. Kept so the review queue can render a
   * thumbnail of the original next to each AI-extracted figure (confirm-against-source).
   * Append-only list of storage keys; never file bytes. Null for non-image instruments.
   */
  aiSourceImageKeys: json("aiSourceImageKeys").$type<string[]>(),

  /** Soft-hide a row without deleting it (e.g. delisted) — neutral lifecycle, not curation. */
  active: boolean("active").notNull().default(true),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type Opportunity = typeof opportunities.$inferSelect;
export type InsertOpportunity = typeof opportunities.$inferInsert;

/**
 * Part 7.2 — ingestion conflicts. When a fresh scrape DISAGREES with a figure a
 * human has already verified/entered, the runner records the disagreement here
 * instead of overwriting the human's value. A reviewer can later accept the human
 * value (dismiss) or apply the scraped value through the normal verify/override
 * path. The human's number is NEVER changed by ingestion — only this table grows.
 */
export const ingestionConflicts = mysqlTable("ingestion_conflicts", {
  id: int("id").autoincrement().primaryKey(),
  /** opportunities.ref this conflict belongs to. */
  opportunityRef: varchar("opportunityRef", { length: 64 }).notNull(),
  /** Which figure (FieldKey): price | yield | coupon | tenor | maturity | distribution | fx | expense | trailingReturn. */
  field: varchar("field", { length: 24 }).notNull(),
  /** The value the human vouched for (kept authoritative). */
  humanValue: varchar("humanValue", { length: 64 }),
  /** The human verification state protecting it (human_verified | human_entered). */
  humanState: varchar("humanState", { length: 24 }).notNull(),
  /** The newly scraped value that disagrees (NOT applied). */
  scrapedValue: varchar("scrapedValue", { length: 64 }),
  /** Where the disagreeing scrape came from. */
  scrapedSource: varchar("scrapedSource", { length: 200 }),
  /** Adapter that produced the scrape (sourceId). */
  sourceId: varchar("sourceId", { length: 32 }).notNull(),
  /** When the scraped figure was as-of, epoch ms UTC. */
  scrapedAsOf: bigint("scrapedAsOf", { mode: "number" }),
  /** open = awaiting review; dismissed = human value kept; applied = reviewer took the scrape. */
  status: varchar("status", { length: 16 }).notNull().default("open"),
  /** Who resolved it + when (null while open). */
  resolvedBy: varchar("resolvedBy", { length: 200 }),
  resolvedAt: bigint("resolvedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type IngestionConflict = typeof ingestionConflicts.$inferSelect;
export type InsertIngestionConflict = typeof ingestionConflicts.$inferInsert;

/**
 * Part 8 — AI universe-discovery CANDIDATES. These are SUGGESTIONS ONLY: an AI
 * proposed that an instrument MIGHT be worth tracking. A candidate is NEVER an
 * opportunity and is NEVER shown in the catalog/Explore until a human approves it
 * (at which point it is created as a normal human-authored instrument and the
 * candidate is marked `approved`). There is deliberately NO score/rank/rating
 * column here — a candidate cannot be ordered by quality, only listed for review.
 */
export const aiCandidates = mysqlTable("ai_candidates", {
  id: int("id").autoincrement().primaryKey(),
  /** Proposed instrument name (as the AI wrote it). */
  name: varchar("name", { length: 200 }).notNull(),
  /** Proposed issuer/manager, if known. */
  issuer: varchar("issuer", { length: 200 }),
  /** Proposed asset class (human-confirmed before any insert). */
  assetClass: varchar("assetClass", { length: 32 }),
  /** Proposed currency, if known. */
  currency: varchar("currency", { length: 8 }),
  /** NEUTRAL reason it fits the requested universe (never a quality judgement). */
  scopeReason: text("scopeReason"),
  /** Where the AI saw it, so a human can go look. */
  sourceUrl: varchar("sourceUrl", { length: 500 }),
  /** The universe description the human asked the AI to populate. */
  universe: varchar("universe", { length: 500 }),
  /** The model that proposed it (audit only, never a quality signal). */
  aiModel: varchar("aiModel", { length: 64 }),
  /** pending = awaiting review; approved = a human created the instrument; dismissed = rejected. */
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  /** If approved, the opportunities.ref the human created from it. */
  approvedRef: varchar("approvedRef", { length: 64 }),
  /** Who acted on it + when (null while pending). */
  reviewedBy: varchar("reviewedBy", { length: 200 }),
  reviewedAt: bigint("reviewedAt", { mode: "number" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type AiCandidate = typeof aiCandidates.$inferSelect;
export type InsertAiCandidate = typeof aiCandidates.$inferInsert;

/**
 * Part 8 (item 6): AI INTAKE AUDIT TRAIL.
 *
 * Every AI intake call — a document extraction or a universe-discovery run — writes
 * exactly one row here, BEFORE the result is trusted by anyone. This exists for two
 * reasons the brief calls out: cost visibility (every billable LLM call is logged with
 * its model) and traceability (a wrong figure in the catalog can be traced back to the
 * document, the model, the timestamp, and the maintainer who triggered it).
 *
 * This is an audit log, NOT a source of record: nothing here ranks, scores, or feeds the
 * catalog. It only records what happened. Append-only in practice (no update path).
 */
export const aiIntakeAudit = mysqlTable("ai_intake_audit", {
  id: int("id").autoincrement().primaryKey(),
  /** "extract" (read one document) or "discover" (propose a candidate list). */
  action: varchar("action", { length: 16 }).notNull(),
  /** The maintainer who triggered the call (open id + display name for traceability). */
  maintainerOpenId: varchar("maintainerOpenId", { length: 200 }).notNull(),
  maintainerName: varchar("maintainerName", { length: 200 }),
  /** The model that actually ran (echoed from the LLM response; audit/cost only). */
  aiModel: varchar("aiModel", { length: 64 }),
  /** For extract: "text" | "url" | "pdf" | "image". For discover: null. */
  sourceKind: varchar("sourceKind", { length: 16 }),
  /** The human-cited source label (extract) — what document was read. */
  sourceLabel: varchar("sourceLabel", { length: 300 }),
  /** Link to the source document, if any. */
  sourceUrl: varchar("sourceUrl", { length: 500 }),
  /** Size of the input the model saw (chars of text, or null for a PDF/file). */
  inputChars: int("inputChars"),
  /** Optional instrument-name hint the maintainer supplied (extract). */
  hintName: varchar("hintName", { length: 200 }),
  /** The universe description the maintainer asked to populate (discover). */
  universeDescription: varchar("universeDescription", { length: 500 }),
  /** Extract: the instrument name the AI returned. */
  resultName: varchar("resultName", { length: 200 }),
  /** Extract: which field keys were extracted (e.g. ["yield","expense"]) for at-a-glance audit. */
  extractedFields: json("extractedFields").$type<string[]>(),
  /** Extract: how many figures were returned, and how many were sanity-flagged for review. */
  figureCount: int("figureCount"),
  flaggedCount: int("flaggedCount"),
  /** Discover: how many candidates were proposed (none are written to the catalog). */
  candidateCount: int("candidateCount"),
  /** Whether the call produced a usable result (false on parse failure / fetch error). */
  ok: boolean("ok").notNull().default(true),
  /** A short error reason when ok=false (e.g. "URL returned HTTP 404"). */
  error: varchar("error", { length: 300 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AiIntakeAuditRow = typeof aiIntakeAudit.$inferSelect;
export type InsertAiIntakeAudit = typeof aiIntakeAudit.$inferInsert;
