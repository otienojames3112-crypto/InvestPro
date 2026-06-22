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
  securityType: mysqlEnum("securityType", ["tbill_91", "tbill_182", "tbill_364", "ifb", "fxd"]).notNull(),
  faceValue: decimal("faceValue", { precision: 14, scale: 2 }).notNull(),
  issueDate: date("issueDate").notNull(),
  maturityDate: date("maturityDate").notNull(),
  couponRate: decimal("couponRate", { precision: 8, scale: 4 }).notNull().default("0.0000"),
  isTaxExempt: boolean("isTaxExempt").notNull().default(false),
  isMatured: boolean("isMatured").notNull().default(false),
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
  bucket: mysqlEnum("bucket", ["mmf", "tbill", "ifb", "fxd"]).notNull(),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  depositDate: date("depositDate").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DepositEntry = typeof depositEntries.$inferSelect;
export type InsertDepositEntry = typeof depositEntries.$inferInsert;

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
  instrumentType: mysqlEnum("instrumentType", ["call_deposit", "fixed_deposit"]).notNull(),
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
