import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  rateSettings,
  ledgerEntries,
  securities,
  contributionOverrides,
  type InsertRateSettings,
  type InsertLedgerEntry,
  type InsertSecurity,
  type InsertContributionOverride,
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
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (user.openId === ENV.ownerOpenId) {
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
