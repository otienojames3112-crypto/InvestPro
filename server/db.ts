import { and, eq, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  portfolios,
  rateSettings,
  ledgerEntries,
  securities,
  contributionOverrides,
  depositEntries,
  rateHistory,
  accountStatus,
  type InsertPortfolio,
  type Portfolio,
  type InsertRateSettings,
  type InsertLedgerEntry,
  type InsertSecurity,
  type InsertContributionOverride,
  type InsertDepositEntry,
  type InsertRateHistory,
  type InsertAccountStatus,
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

// ─── Portfolios ───────────────────────────────────────────────────────────────

export async function getPortfolios(userId: number): Promise<Portfolio[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, userId))
    .orderBy(portfolios.createdAt);
}

export async function getPortfolio(portfolioId: number, userId: number): Promise<Portfolio | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createPortfolio(data: InsertPortfolio): Promise<Portfolio | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(portfolios).values(data);
  const rows = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, data.userId))
    .orderBy(desc(portfolios.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function updatePortfolio(
  portfolioId: number,
  userId: number,
  data: Partial<InsertPortfolio>
): Promise<Portfolio | null> {
  const db = await getDb();
  if (!db) return null;
  await db
    .update(portfolios)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));
  return getPortfolio(portfolioId, userId);
}

export async function deletePortfolio(portfolioId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Cascade: delete all child records first
  await db.delete(rateSettings).where(eq(rateSettings.portfolioId, portfolioId));
  await db.delete(ledgerEntries).where(eq(ledgerEntries.portfolioId, portfolioId));
  await db.delete(securities).where(eq(securities.portfolioId, portfolioId));
  await db.delete(contributionOverrides).where(eq(contributionOverrides.portfolioId, portfolioId));
  await db.delete(depositEntries).where(eq(depositEntries.portfolioId, portfolioId));
  await db.delete(rateHistory).where(eq(rateHistory.portfolioId, portfolioId));
  await db.delete(accountStatus).where(eq(accountStatus.portfolioId, portfolioId));
  await db.delete(portfolios).where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));
}

/**
 * Ensure a portfolio has a rate_settings row. Creates one with defaults if missing.
 * Returns the existing or newly created rate_settings row.
 */
export async function ensureRateSettings(portfolioId: number) {
  const db = await getDb();
  if (!db) return null;
  const existing = await getRateSettings(portfolioId);
  if (existing) return existing;
  await db.insert(rateSettings).values({ portfolioId });
  return getRateSettings(portfolioId);
}

// ─── Rate Settings ─────────────────────────────────────────────────────────────

export async function getRateSettings(portfolioId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(rateSettings)
    .where(eq(rateSettings.portfolioId, portfolioId))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertRateSettings(data: InsertRateSettings) {
  const db = await getDb();
  if (!db) return;
  const existing = await getRateSettings(data.portfolioId);
  if (existing) {
    await db
      .update(rateSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(rateSettings.portfolioId, data.portfolioId));
  } else {
    await db.insert(rateSettings).values(data);
  }
  return getRateSettings(data.portfolioId);
}

// ─── Ledger Entries ─────────────────────────────────────────────────────────────

export async function getLedgerEntries(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.portfolioId, portfolioId))
    .orderBy(ledgerEntries.monthNumber);
}

export async function upsertLedgerEntry(data: InsertLedgerEntry) {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.portfolioId, data.portfolioId), eq(ledgerEntries.monthNumber, data.monthNumber)))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(ledgerEntries)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(ledgerEntries.portfolioId, data.portfolioId), eq(ledgerEntries.monthNumber, data.monthNumber)));
  } else {
    await db.insert(ledgerEntries).values(data);
  }
}

export async function bulkUpsertLedgerEntries(entries: InsertLedgerEntry[]) {
  const db = await getDb();
  if (!db || entries.length === 0) return;
  const portfolioId = entries[0].portfolioId;
  await db.delete(ledgerEntries).where(eq(ledgerEntries.portfolioId, portfolioId));
  await db.insert(ledgerEntries).values(entries);
}

// ─── Securities ─────────────────────────────────────────────────────────────────

export async function getSecurities(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(securities)
    .where(eq(securities.portfolioId, portfolioId))
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

export async function getContributionOverrides(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(contributionOverrides)
    .where(eq(contributionOverrides.portfolioId, portfolioId))
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
        eq(contributionOverrides.portfolioId, data.portfolioId),
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
          eq(contributionOverrides.portfolioId, data.portfolioId),
          eq(contributionOverrides.monthNumber, data.monthNumber)
        )
      );
  } else {
    await db.insert(contributionOverrides).values(data);
  }
}

export async function deleteContributionOverride(portfolioId: number, monthNumber: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(contributionOverrides)
    .where(
      and(
        eq(contributionOverrides.portfolioId, portfolioId),
        eq(contributionOverrides.monthNumber, monthNumber)
      )
    );
}

// ─── Rate History ──────────────────────────────────────────────────────────────

export async function addRateHistorySnapshot(data: InsertRateHistory) {
  const db = await getDb();
  if (!db) return;
  await db.insert(rateHistory).values(data);
}

export async function getRateHistory(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(rateHistory)
    .where(eq(rateHistory.portfolioId, portfolioId))
    .orderBy(rateHistory.effectiveDate);
}

export async function getRateForDate(portfolioId: number, targetDate: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(rateHistory)
    .where(and(eq(rateHistory.portfolioId, portfolioId), sql`${rateHistory.effectiveDate} <= ${targetDate}`))
    .orderBy(desc(rateHistory.effectiveDate))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Deposit Entries ────────────────────────────────────────────────────────────

export async function getDepositEntries(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(depositEntries)
    .where(eq(depositEntries.portfolioId, portfolioId))
    .orderBy(desc(depositEntries.depositDate));
}

export async function addDepositEntry(data: InsertDepositEntry) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(depositEntries).values(data);
  const rows = await db
    .select()
    .from(depositEntries)
    .where(eq(depositEntries.portfolioId, data.portfolioId))
    .orderBy(desc(depositEntries.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function deleteDepositEntry(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(depositEntries)
    .where(and(eq(depositEntries.id, id), eq(depositEntries.portfolioId, portfolioId)));
}

export async function getActualsSummary(
  portfolioId: number,
  targetAmount: number,
  withholdingTax: number,
  fxdCouponRate = 12.35,
  mmfYield = 8.78,
  tbillRate = 8.97
) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(depositEntries)
    .where(eq(depositEntries.portfolioId, portfolioId));

  let totalContributed = 0;
  const byBucket = { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };

  for (const row of rows) {
    const amt = parseFloat(row.amount);
    totalContributed += amt;
    byBucket[row.bucket as keyof typeof byBucket] += amt;
  }

  const wht = withholdingTax / 100;

  const annualMmfInterest = byBucket.mmf * (mmfYield / 100);
  const mmfTax = annualMmfInterest * wht;

  const annualTbillDiscount = byBucket.tbill * (tbillRate / 100);
  const tbillTax = annualTbillDiscount * wht;

  const ifbTax = 0;

  const annualFxdCouponIncome = byBucket.fxd * (fxdCouponRate / 100);
  const fxdTax = annualFxdCouponIncome * wht;

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

// ─── Account Status ───────────────────────────────────────────────────────────

export async function getAccountStatuses(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(accountStatus).where(eq(accountStatus.portfolioId, portfolioId));
}

export async function upsertAccountStatus(data: InsertAccountStatus) {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(accountStatus)
    .where(and(eq(accountStatus.portfolioId, data.portfolioId), eq(accountStatus.accountType, data.accountType)))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(accountStatus)
      .set({
        isOpened: data.isOpened,
        accountNumber: data.accountNumber ?? null,
        accountName: data.accountName ?? null,
        dateOpened: data.dateOpened ?? null,
        phoneNumber: data.phoneNumber ?? null,
        notes: data.notes ?? null,
      })
      .where(and(eq(accountStatus.portfolioId, data.portfolioId), eq(accountStatus.accountType, data.accountType)));
  } else {
    await db.insert(accountStatus).values(data);
  }
}

// ─── MMF Funds ────────────────────────────────────────────────────────────────

import {
  mmfFunds,
  otherHoldings,
  holdingIncome,
  type InsertMmfFund,
  type InsertOtherHolding,
  type InsertHoldingIncome,
} from "../drizzle/schema";

/** List all active MMF funds, ordered by EAR descending. */
export async function getMmfFunds() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(mmfFunds).where(eq(mmfFunds.isActive, true)).orderBy(desc(mmfFunds.ear));
}

/** Get a single MMF fund by ID. */
export async function getMmfFund(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(mmfFunds).where(eq(mmfFunds.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Insert a new MMF fund (admin/owner use). */
export async function addMmfFund(data: InsertMmfFund) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(mmfFunds).values(data);
  return result;
}

/** Update an existing MMF fund. */
export async function updateMmfFund(id: number, data: Partial<InsertMmfFund>) {
  const db = await getDb();
  if (!db) return;
  await db.update(mmfFunds).set(data).where(eq(mmfFunds.id, id));
}

/** Soft-delete (deactivate) an MMF fund. */
export async function deactivateMmfFund(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(mmfFunds).set({ isActive: false }).where(eq(mmfFunds.id, id));
}

/** Set the selected MMF fund for a portfolio (null = use manual rate). */
export async function setPortfolioMmfFund(portfolioId: number, mmfFundId: number | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(portfolios).set({ mmfFundId }).where(eq(portfolios.id, portfolioId));
}

// ─── Other Holdings ───────────────────────────────────────────────────────────

/** List all holdings for a portfolio, ordered by asset class then name. */
export async function getOtherHoldings(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(otherHoldings)
    .where(eq(otherHoldings.portfolioId, portfolioId))
    .orderBy(otherHoldings.assetClass, otherHoldings.name);
}

/** Get a single holding by ID. */
export async function getOtherHolding(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(otherHoldings)
    .where(and(eq(otherHoldings.id, id), eq(otherHoldings.portfolioId, portfolioId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Add a new holding. */
export async function addOtherHolding(data: InsertOtherHolding) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(otherHoldings).values(data);
  return result;
}

/** Update a holding. */
export async function updateOtherHolding(id: number, portfolioId: number, data: Partial<InsertOtherHolding>) {
  const db = await getDb();
  if (!db) return;
  await db.update(otherHoldings).set(data).where(and(eq(otherHoldings.id, id), eq(otherHoldings.portfolioId, portfolioId)));
}

/** Delete a holding and its income records. */
export async function deleteOtherHolding(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(holdingIncome).where(eq(holdingIncome.holdingId, id));
  await db.delete(otherHoldings).where(and(eq(otherHoldings.id, id), eq(otherHoldings.portfolioId, portfolioId)));
}

/** List income records for a holding. */
export async function getHoldingIncome(holdingId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(holdingIncome)
    .where(eq(holdingIncome.holdingId, holdingId))
    .orderBy(desc(holdingIncome.incomeDate));
}

/** Add an income record for a holding. */
export async function addHoldingIncome(data: InsertHoldingIncome) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(holdingIncome).values(data);
  return result;
}

/** Delete an income record. */
export async function deleteHoldingIncome(id: number, holdingId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(holdingIncome).where(and(eq(holdingIncome.id, id), eq(holdingIncome.holdingId, holdingId)));
}

// ─── Secondary MMF Accounts ───────────────────────────────────────────────────
import {
  portfolioSecondaryMmfs,
  type InsertPortfolioSecondaryMmf,
} from "../drizzle/schema";

/** List all secondary MMF accounts for a portfolio, joined with fund info. */
export async function getSecondaryMmfs(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: portfolioSecondaryMmfs.id,
      portfolioId: portfolioSecondaryMmfs.portfolioId,
      mmfFundId: portfolioSecondaryMmfs.mmfFundId,
      label: portfolioSecondaryMmfs.label,
      currentBalance: portfolioSecondaryMmfs.currentBalance,
      monthlyContribution: portfolioSecondaryMmfs.monthlyContribution,
      notes: portfolioSecondaryMmfs.notes,
      createdAt: portfolioSecondaryMmfs.createdAt,
      updatedAt: portfolioSecondaryMmfs.updatedAt,
      fundName: mmfFunds.fundName,
      company: mmfFunds.company,
      ear: mmfFunds.ear,
    })
    .from(portfolioSecondaryMmfs)
    .innerJoin(mmfFunds, eq(portfolioSecondaryMmfs.mmfFundId, mmfFunds.id))
    .where(eq(portfolioSecondaryMmfs.portfolioId, portfolioId))
    .orderBy(portfolioSecondaryMmfs.createdAt);
  return rows;
}

/** Add a secondary MMF account. */
export async function addSecondaryMmf(data: InsertPortfolioSecondaryMmf) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(portfolioSecondaryMmfs).values(data);
  return result;
}

/** Update a secondary MMF account. */
export async function updateSecondaryMmf(
  id: number,
  portfolioId: number,
  data: Partial<InsertPortfolioSecondaryMmf>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(portfolioSecondaryMmfs)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(portfolioSecondaryMmfs.id, id),
        eq(portfolioSecondaryMmfs.portfolioId, portfolioId)
      )
    );
}

/** Delete a secondary MMF account. */
export async function deleteSecondaryMmf(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(portfolioSecondaryMmfs)
    .where(
      and(
        eq(portfolioSecondaryMmfs.id, id),
        eq(portfolioSecondaryMmfs.portfolioId, portfolioId)
      )
    );
}


// ============================================================================
// Round 12 — Knowledge & Accuracy Layer helpers
// ============================================================================
import {
  mmfComposition,
  bankInstruments,
  benchmarkInputs,
  auditLog,
  type InsertMmfComposition,
  type InsertBankInstrument,
  type InsertBenchmarkInput,
  type InsertAuditLog,
} from "../drizzle/schema";

/** ---------------- MMF Composition (global reference) ---------------- */

/** List all MMF compositions joined with fund name/company/ear. */
export async function getMmfCompositions() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: mmfComposition.id,
      mmfFundId: mmfComposition.mmfFundId,
      govSecurities: mmfComposition.govSecurities,
      bankInstruments: mmfComposition.bankInstruments,
      corporateDebt: mmfComposition.corporateDebt,
      cashEquivalents: mmfComposition.cashEquivalents,
      offshoreRegional: mmfComposition.offshoreRegional,
      notes: mmfComposition.notes,
      asOfDate: mmfComposition.asOfDate,
      source: mmfComposition.source,
      isEstimate: mmfComposition.isEstimate,
      updatedAt: mmfComposition.updatedAt,
      fundName: mmfFunds.fundName,
      company: mmfFunds.company,
      ear: mmfFunds.ear,
      grossYield: mmfFunds.grossYield,
      managementFee: mmfFunds.managementFee,
    })
    .from(mmfComposition)
    .innerJoin(mmfFunds, eq(mmfComposition.mmfFundId, mmfFunds.id))
    .orderBy(desc(mmfFunds.ear));
}

export async function getMmfCompositionByFund(mmfFundId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(mmfComposition)
    .where(eq(mmfComposition.mmfFundId, mmfFundId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertMmfComposition(data: InsertMmfComposition) {
  const db = await getDb();
  if (!db) return null;
  const existing = await getMmfCompositionByFund(data.mmfFundId);
  if (existing) {
    await db
      .update(mmfComposition)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mmfComposition.id, existing.id));
    return existing.id;
  }
  await db.insert(mmfComposition).values(data);
  return null;
}

export async function deleteMmfComposition(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(mmfComposition).where(eq(mmfComposition.id, id));
}

/** ---------------- Bank Instruments (global reference) ---------------- */

export async function getBankInstruments() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(bankInstruments)
    .orderBy(bankInstruments.bankName);
}

export async function addBankInstrument(data: InsertBankInstrument) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(bankInstruments).values(data);
  return true;
}

export async function updateBankInstrument(
  id: number,
  data: Partial<InsertBankInstrument>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(bankInstruments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(bankInstruments.id, id));
}

export async function deleteBankInstrument(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(bankInstruments).where(eq(bankInstruments.id, id));
}

/** ---------------- Benchmark Inputs (global reference) ---------------- */

export async function getBenchmarkInputs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(benchmarkInputs).orderBy(benchmarkInputs.id);
}

export async function upsertBenchmarkInput(data: InsertBenchmarkInput) {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(benchmarkInputs)
    .where(eq(benchmarkInputs.metricKey, data.metricKey))
    .limit(1);
  if (existing[0]) {
    await db
      .update(benchmarkInputs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(benchmarkInputs.id, existing[0].id));
  } else {
    await db.insert(benchmarkInputs).values(data);
  }
}

/** ---------------- Audit Log ---------------- */

export async function addAuditLog(data: InsertAuditLog) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLog).values(data);
}

export async function getAuditLog(portfolioId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.portfolioId, portfolioId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

/** ---------------- MMF fund accrual settings ---------------- */

export async function updateMmfFundAccrualSettings(
  id: number,
  data: { dayCountBasis?: number; creditingFrequency?: "daily" | "monthly"; whtRate?: string }
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(mmfFunds)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(mmfFunds.id, id));
}
