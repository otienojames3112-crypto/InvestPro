import { sql } from "drizzle-orm";
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
