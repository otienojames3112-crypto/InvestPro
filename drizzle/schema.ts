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
 * Investment rate settings — one row per user (or a global default row with userId=0).
 */
export const rateSettings = mysqlTable("rate_settings", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  mmfYield: decimal("mmfYield", { precision: 8, scale: 4 }).notNull().default("8.7800"),
  tbill91Rate: decimal("tbill91Rate", { precision: 8, scale: 4 }).notNull().default("8.8206"),
  tbill182Rate: decimal("tbill182Rate", { precision: 8, scale: 4 }).notNull().default("8.7782"),
  tbill364Rate: decimal("tbill364Rate", { precision: 8, scale: 4 }).notNull().default("8.9746"),
  ifbCouponRate: decimal("ifbCouponRate", { precision: 8, scale: 4 }).notNull().default("12.5000"),
  fxdCouponRate: decimal("fxdCouponRate", { precision: 8, scale: 4 }).notNull().default("12.3500"),
  withholdingTax: decimal("withholdingTax", { precision: 8, scale: 4 }).notNull().default("15.0000"),
  startDate: date("startDate").notNull().default(sql`'2026-07-01'`),
  targetAmount: decimal("targetAmount", { precision: 14, scale: 2 }).notNull().default("5000000.00"),
  startingContribution: decimal("startingContribution", { precision: 10, scale: 2 }).notNull().default("2500.00"),
  stepUpAmount: decimal("stepUpAmount", { precision: 10, scale: 2 }).notNull().default("3000.00"),
  stepUpMonths: int("stepUpMonths").notNull().default(6),
  safetyFloor: decimal("safetyFloor", { precision: 10, scale: 2 }).notNull().default("50000.00"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RateSettings = typeof rateSettings.$inferSelect;
export type InsertRateSettings = typeof rateSettings.$inferInsert;

/**
 * Month-by-month ledger entries — one row per month per user.
 */
export const ledgerEntries = mysqlTable("ledger_entries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  monthNumber: int("monthNumber").notNull(), // 1–120
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
  isActual: boolean("isActual").notNull().default(false), // false = projected, true = user-confirmed actual
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type InsertLedgerEntry = typeof ledgerEntries.$inferInsert;

/**
 * CBK securities register — individual T-bill and bond purchases.
 */
export const securities = mysqlTable("securities", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
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
 * Contribution overrides — manual overrides or lump sums for specific months.
 */
export const contributionOverrides = mysqlTable("contribution_overrides", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  monthNumber: int("monthNumber").notNull(), // 1–120
  overrideAmount: decimal("overrideAmount", { precision: 10, scale: 2 }).notNull(),
  lumpSum: decimal("lumpSum", { precision: 10, scale: 2 }).notNull().default("0.00"),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ContributionOverride = typeof contributionOverrides.$inferSelect;
export type InsertContributionOverride = typeof contributionOverrides.$inferInsert;

/**
 * Deposit entries — real money deposited into each investment bucket.
 * This is the "live" record of actual contributions made.
 */
export const depositEntries = mysqlTable("deposit_entries", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
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
 * Rate history — every time the user saves new rates, a snapshot is recorded
 * with the effective date. The engine uses the rate valid at each month's date,
 * so historical months are never retroactively affected by rate changes.
 */
export const rateHistory = mysqlTable("rate_history", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  effectiveDate: date("effectiveDate").notNull(), // YYYY-MM-DD: rates apply from this date onward
  mmfYield: decimal("mmfYield", { precision: 8, scale: 4 }).notNull(),
  tbill91Rate: decimal("tbill91Rate", { precision: 8, scale: 4 }).notNull(),
  tbill182Rate: decimal("tbill182Rate", { precision: 8, scale: 4 }).notNull(),
  tbill364Rate: decimal("tbill364Rate", { precision: 8, scale: 4 }).notNull(),
  ifbCouponRate: decimal("ifbCouponRate", { precision: 8, scale: 4 }).notNull(),
  fxdCouponRate: decimal("fxdCouponRate", { precision: 8, scale: 4 }).notNull(),
  withholdingTax: decimal("withholdingTax", { precision: 8, scale: 4 }).notNull(),
  changeNote: text("changeNote"), // optional note explaining why rates changed
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RateHistory = typeof rateHistory.$inferSelect;
export type InsertRateHistory = typeof rateHistory.$inferInsert;

/**
 * Account status — tracks whether the user has opened each investment account
 * (SanlamAllianz MMF and CBK DhowCSD), and stores their account details.
 */
export const accountStatus = mysqlTable("account_status", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
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

/**
 * Pending rate fetch results awaiting user confirmation.
 * Each row represents one fetched rate that has not yet been accepted or dismissed.
 */
export const pendingRateFetches = mysqlTable("pending_rate_fetches", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** Which rate field this row is for */
  rateField: varchar("rateField", { length: 64 }).notNull(), // e.g. "tbill364Rate", "mmfYield"
  /** The newly fetched value */
  fetchedValue: decimal("fetchedValue", { precision: 8, scale: 4 }).notNull(),
  /** The stored value at the time of fetch (for comparison display) */
  storedValue: decimal("storedValue", { precision: 8, scale: 4 }).notNull(),
  /** Source URL that was scraped */
  sourceUrl: text("sourceUrl").notNull(),
  /** ISO timestamp of when the fetch occurred */
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  /** Human-readable label for the source (e.g. "CBK T-Bills", "SanlamAllianz MMF") */
  sourceLabel: varchar("sourceLabel", { length: 200 }).notNull(),
  /** Publication cadence note (e.g. "weekly", "monthly") */
  cadenceNote: varchar("cadenceNote", { length: 100 }),
  /** Whether this pending fetch has been acted on */
  status: mysqlEnum("status", ["pending", "accepted", "dismissed"]).notNull().default("pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PendingRateFetch = typeof pendingRateFetches.$inferSelect;
export type InsertPendingRateFetch = typeof pendingRateFetches.$inferInsert;

/**
 * Log of rate fetch attempts (success or failure) for staleness tracking.
 */
export const rateFetchLog = mysqlTable("rate_fetch_log", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** "cbk" | "sanlam" */
  source: varchar("source", { length: 64 }).notNull(),
  success: boolean("success").notNull(),
  errorMessage: text("errorMessage"),
  fetchedAt: timestamp("fetchedAt").defaultNow().notNull(),
  /** Serialized JSON of fetched values (for audit) */
  rawPayload: text("rawPayload"),
  /** taskUid if triggered by a cron job */
  taskUid: varchar("taskUid", { length: 65 }),
});

export type RateFetchLog = typeof rateFetchLog.$inferSelect;
export type InsertRateFetchLog = typeof rateFetchLog.$inferInsert;
