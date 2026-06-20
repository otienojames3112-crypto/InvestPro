import { and, eq, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  rateSettings,
  ledgerEntries,
  securities,
  contributionOverrides,
  depositEntries,
  rateHistory,
  type InsertRateSettings,
  type InsertLedgerEntry,
  type InsertSecurity,
  type InsertContributionOverride,
  type InsertDepositEntry,
  type InsertRateHistory,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  // Determine role: explicit > admin email list > owner openId > default
  const isAdminEmail = user.email && ENV.adminEmails.includes(user.email);
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (isAdminEmail || user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Rate Settings ─────────────────────────────────────────────────────────────

export async function getRateSettings(userId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(rateSettings)
    .where(eq(rateSettings.userId, userId))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertRateSettings(data: InsertRateSettings) {
  const db = await getDb();
  if (!db) return;
  const existing = await getRateSettings(data.userId);
  if (existing) {
    await db
      .update(rateSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(rateSettings.userId, data.userId));
  } else {
    await db.insert(rateSettings).values(data);
  }
  return getRateSettings(data.userId);
}

// ─── Ledger Entries ─────────────────────────────────────────────────────────────

export async function getLedgerEntries(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.userId, userId))
    .orderBy(ledgerEntries.monthNumber);
}

export async function upsertLedgerEntry(data: InsertLedgerEntry) {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.userId, data.userId), eq(ledgerEntries.monthNumber, data.monthNumber)))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(ledgerEntries)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(ledgerEntries.userId, data.userId), eq(ledgerEntries.monthNumber, data.monthNumber)));
  } else {
    await db.insert(ledgerEntries).values(data);
  }
}

export async function bulkUpsertLedgerEntries(entries: InsertLedgerEntry[]) {
  const db = await getDb();
  if (!db || entries.length === 0) return;
  // Delete existing and re-insert for simplicity
  if (entries.length > 0) {
    const userId = entries[0].userId;
    await db.delete(ledgerEntries).where(eq(ledgerEntries.userId, userId));
    await db.insert(ledgerEntries).values(entries);
  }
}

// ─── Securities ─────────────────────────────────────────────────────────────────

export async function getSecurities(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(securities)
    .where(eq(securities.userId, userId))
    .orderBy(securities.issueDate);
}

export async function addSecurity(data: InsertSecurity) {
  const db = await getDb();
  if (!db) return;
  await db.insert(securities).values(data);
}

export async function updateSecurity(id: number, data: Partial<InsertSecurity>) {
  const db = await getDb();
  if (!db) return;
  await db.update(securities).set({ ...data, updatedAt: new Date() }).where(eq(securities.id, id));
}

export async function deleteSecurity(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(securities).where(eq(securities.id, id));
}

// ─── Contribution Overrides ─────────────────────────────────────────────────────

export async function getContributionOverrides(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(contributionOverrides)
    .where(eq(contributionOverrides.userId, userId))
    .orderBy(contributionOverrides.monthNumber);
}

export async function upsertContributionOverride(data: InsertContributionOverride) {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(contributionOverrides)
    .where(
      and(
        eq(contributionOverrides.userId, data.userId),
        eq(contributionOverrides.monthNumber, data.monthNumber)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(contributionOverrides)
      .set(data)
      .where(
        and(
          eq(contributionOverrides.userId, data.userId),
          eq(contributionOverrides.monthNumber, data.monthNumber)
        )
      );
  } else {
    await db.insert(contributionOverrides).values(data);
  }
}

export async function deleteContributionOverride(userId: number, monthNumber: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(contributionOverrides)
    .where(
      and(
        eq(contributionOverrides.userId, userId),
        eq(contributionOverrides.monthNumber, monthNumber)
      )
    );
}

// ─── Rate History ──────────────────────────────────────────────────────────────

/**
 * Record a rate snapshot whenever the user saves new rates.
 * effectiveDate is today's date (YYYY-MM-DD) — rates apply from this date onward.
 */
export async function addRateHistorySnapshot(data: InsertRateHistory) {
  const db = await getDb();
  if (!db) return;
  await db.insert(rateHistory).values(data);
}

/**
 * Get all rate history entries for a user, ordered by effectiveDate ascending.
 */
export async function getRateHistory(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(rateHistory)
    .where(eq(rateHistory.userId, userId))
    .orderBy(rateHistory.effectiveDate);
}

/**
 * Get the rate snapshot that was in effect on a given date (YYYY-MM-DD).
 * Returns the most recent snapshot with effectiveDate <= targetDate.
 * Falls back to current settings if no history exists.
 */
export async function getRateForDate(userId: number, targetDate: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(rateHistory)
    .where(and(eq(rateHistory.userId, userId), sql`${rateHistory.effectiveDate} <= ${targetDate}`))
    .orderBy(desc(rateHistory.effectiveDate))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Deposit Entries ────────────────────────────────────────────────────────────

export async function getDepositEntries(userId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(depositEntries)
    .where(eq(depositEntries.userId, userId))
    .orderBy(desc(depositEntries.depositDate));
}

export async function addDepositEntry(data: InsertDepositEntry) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(depositEntries).values(data);
  // Return the last inserted row
  const rows = await db
    .select()
    .from(depositEntries)
    .where(eq(depositEntries.userId, data.userId))
    .orderBy(desc(depositEntries.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteDepositEntry(id: number, userId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(depositEntries)
    .where(and(eq(depositEntries.id, id), eq(depositEntries.userId, userId)));
}

/**
 * Compute actuals summary for a user:
 * - totalContributed: sum of all deposit amounts
 * - byBucket: breakdown per bucket
 * - taxLiability: 15% WHT on estimated annual FXD coupon income
 *   Formula: fxd_principal * (fxdCouponRate / 100) * (withholdingTax / 100)
 *   This reflects the actual WHT deducted from each semi-annual coupon payment.
 * - remainingToTarget: targetAmount - totalContributed
 */
export async function getActualsSummary(
  userId: number,
  targetAmount: number,
  withholdingTax: number,
  fxdCouponRate: number = 12.35,
  mmfYield: number = 8.78,
  tbillRate: number = 8.97
) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(depositEntries)
    .where(eq(depositEntries.userId, userId));

  let totalContributed = 0;
  const byBucket = { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };

  for (const row of rows) {
    const amt = parseFloat(row.amount);
    totalContributed += amt;
    byBucket[row.bucket as keyof typeof byBucket] += amt;
  }

  const wht = withholdingTax / 100;

  // MMF: 15% WHT on annual interest income (final tax for resident individuals)
  const annualMmfInterest = byBucket.mmf * (mmfYield / 100);
  const mmfTax = annualMmfInterest * wht;

  // T-Bills: 15% WHT on the discount amount (final tax for resident individuals)
  const annualTbillDiscount = byBucket.tbill * (tbillRate / 100);
  const tbillTax = annualTbillDiscount * wht;

  // IFB: Tax-exempt — no WHT
  const ifbTax = 0;

  // FXD: 15% WHT on annual coupon income
  const annualFxdCouponIncome = byBucket.fxd * (fxdCouponRate / 100);
  const fxdTax = annualFxdCouponIncome * wht;

  // Total estimated annual WHT across all buckets
  const taxLiability = mmfTax + tbillTax + ifbTax + fxdTax;
  const remainingToTarget = Math.max(0, targetAmount - totalContributed);

  return {
    totalContributed,
    remainingToTarget,
    taxLiability,
    taxBreakdown: {
      mmf: Math.round(mmfTax * 100) / 100,
      tbill: Math.round(tbillTax * 100) / 100,
      ifb: 0,
      fxd: Math.round(fxdTax * 100) / 100,
    },
    annualFxdCouponIncome,
    byBucket,
    entryCount: rows.length,
  };
}
