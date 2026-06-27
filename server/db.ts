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
  withdrawalEntries,
  rateHistory,
  accountStatus,
  type InsertPortfolio,
  type Portfolio,
  type InsertRateSettings,
  type InsertLedgerEntry,
  type InsertSecurity,
  type InsertContributionOverride,
  type InsertDepositEntry,
  type InsertWithdrawalEntry,
  type InsertRateHistory,
  type InsertAccountStatus,
  portfolioSecondaryMmfs,
  bankInstrumentHoldings,
  type InsertBankInstrumentHolding,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { computeActualsTotals, estInterestToDate, govAccruedInterestTotal } from "../shared/actuals";

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

export async function getPortfolios(userId: number, isSandbox?: boolean): Promise<Portfolio[]> {
  const db = await getDb();
  if (!db) return [];
  const where =
    isSandbox === undefined
      ? eq(portfolios.userId, userId)
      : and(eq(portfolios.userId, userId), eq(portfolios.isSandbox, isSandbox));
  return db.select().from(portfolios).where(where).orderBy(portfolios.createdAt);
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
  await db.delete(portfolioSecondaryMmfs).where(eq(portfolioSecondaryMmfs.portfolioId, portfolioId));
  await db.delete(bankInstrumentHoldings).where(eq(bankInstrumentHoldings.portfolioId, portfolioId));
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

export async function getSecurityById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(securities).where(eq(securities.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getDepositBySecurityId(securityId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(depositEntries)
    .where(eq(depositEntries.securityId, securityId))
    .limit(1);
  return rows[0] ?? null;
}

export async function addSecurity(data: InsertSecurity) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(securities).values(data);
  const rows = await db
    .select()
    .from(securities)
    .where(eq(securities.portfolioId, data.portfolioId))
    .orderBy(desc(securities.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateSecurity(id: number, data: Partial<InsertSecurity>) {
  const db = await getDb();
  if (!db) return;
  await db.update(securities).set({ ...data, updatedAt: new Date() }).where(eq(securities.id, id));
}

export async function deleteSecurity(id: number) {
  const db = await getDb();
  if (!db) return;
  // Symmetric cascade (Round 43, Fix #2): a gov-security register row may be linked
  // to the deposit entry that created it (depositEntries.securityId). Deleting the
  // security must also remove that deposit so it cannot become an orphan that still
  // shows in the contribution history while its register holding is gone. Without
  // this, the two sides drift and reconcileGov reports a phantom gap.
  //
  // Round 45 (recon-after-delete fix): a redeemed gov security also owns a
  // withdrawal_entries row (withdrawalEntries.securityId) recorded when it was
  // cashed out. If we drop the security + its deposit but leave that withdrawal
  // behind, the gov sub-check nets (gone deposit) − (surviving withdrawal) and
  // reports a phantom negative gap that turns the Reconciliation page red. So the
  // cascade must remove BOTH linked sides — deposit and withdrawal.
  await db.delete(securities).where(eq(securities.id, id));
  await db.delete(depositEntries).where(eq(depositEntries.securityId, id));
  await db.delete(withdrawalEntries).where(eq(withdrawalEntries.securityId, id));
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

export async function updateDepositEntry(
  id: number,
  portfolioId: number,
  data: Partial<InsertDepositEntry>,
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(depositEntries)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(depositEntries.id, id), eq(depositEntries.portfolioId, portfolioId)));
}

export async function deleteDepositEntry(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return;
  // Cascade: a government-security deposit owns a register row; remove it too so
  // the register stays the single source of truth (no orphaned holdings).
  const existing = await db
    .select()
    .from(depositEntries)
    .where(and(eq(depositEntries.id, id), eq(depositEntries.portfolioId, portfolioId)))
    .limit(1);
  const linkedSecurityId = (existing[0] as { securityId?: number | null } | undefined)?.securityId;
  await db
    .delete(depositEntries)
    .where(and(eq(depositEntries.id, id), eq(depositEntries.portfolioId, portfolioId)));
  if (linkedSecurityId) {
    await db.delete(securities).where(eq(securities.id, linkedSecurityId));
  }
}

// ─── Withdrawals (money OUT) ─────────────────────────────────────────────────

export async function getWithdrawalEntries(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(withdrawalEntries)
    .where(eq(withdrawalEntries.portfolioId, portfolioId))
    .orderBy(desc(withdrawalEntries.withdrawalDate));
}

export async function addWithdrawalEntry(data: InsertWithdrawalEntry) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(withdrawalEntries).values(data);
  const [row] = await db
    .select()
    .from(withdrawalEntries)
    .where(eq(withdrawalEntries.portfolioId, data.portfolioId))
    .orderBy(desc(withdrawalEntries.createdAt))
    .limit(1);
  return row ?? null;
}

export async function deleteWithdrawalEntry(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(withdrawalEntries)
    .where(and(eq(withdrawalEntries.id, id), eq(withdrawalEntries.portfolioId, portfolioId)));
}

/** Net withdrawn amount per source bucket (positive = money out). */
export async function getWithdrawalsForActuals(portfolioId: number) {
  const rows = await getWithdrawalEntries(portfolioId);
  return rows.map((w) => ({
    sourceType: w.sourceType as "mmf_fund" | "bank_instrument" | "government_security",
    mmfFundId: (w as { mmfFundId?: number | null }).mmfFundId ?? null,
    amount: parseFloat(String(w.amount ?? "0")) || 0,
  }));
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

  const secondaries = await getSecondaryMmfs(portfolioId);
  const bankHoldings = await getBankInstrumentHoldings(portfolioId);
  const securityRows = await getSecurities(portfolioId);
  const withdrawals = await getWithdrawalsForActuals(portfolioId);

  // Delegate the (double-counting-safe) aggregation to the pure, unit-tested helper.
  const agg = computeActualsTotals(
    rows.map((row) => ({
      amount: parseFloat(row.amount) || 0,
      bucket: row.bucket as "mmf" | "tbill" | "ifb" | "fxd",
      institutionType: (row as { institutionType?: string | null }).institutionType ?? null,
      mmfFundId: (row as { mmfFundId?: number | null }).mmfFundId ?? null,
    })),
    secondaries.map((s) => ({
      mmfFundId: s.mmfFundId ?? null,
      currentBalance: parseFloat(String(s.currentBalance ?? "0")) || 0,
      ear: parseFloat(String(s.ear ?? "0")) || 0,
      whtRate: parseFloat(String(s.whtRate ?? "15")) || 15,
    })),
    bankHoldings.map((b) => ({
      principal: parseFloat(String(b.principal ?? "0")) || 0,
      interestRate: parseFloat(String(b.interestRate ?? "0")) || 0,
      whtRate: parseFloat(String(b.whtRate ?? "15")) || 15,
      isActive: !!b.isActive,
    })),
    { withholdingTax, mmfYield, tbillRate, fxdCouponRate },
    securityRows.map((s) => ({
      securityType: String(s.securityType),
      faceValue: parseFloat(String(s.faceValue ?? "0")) || 0,
      couponRate: parseFloat(String(s.couponRate ?? "0")) || 0,
      isTaxExempt: !!s.isTaxExempt,
      isMatured: !!s.isMatured,
      tenorYears: (s as { tenorYears?: string | null }).tenorYears != null
        ? parseFloat(String((s as { tenorYears?: string | null }).tenorYears))
        : null,
      purchasePrice: (s as { purchasePrice?: string | null }).purchasePrice != null
        ? parseFloat(String((s as { purchasePrice?: string | null }).purchasePrice))
        : null,
      discountRate: (s as { discountRate?: string | null }).discountRate != null
        ? parseFloat(String((s as { discountRate?: string | null }).discountRate))
        : null,
    })),
    withdrawals,
  );

  const annualFxdCouponIncome = agg.byBucket.fxd * (fxdCouponRate / 100);
  const remainingToTarget = Math.max(0, targetAmount - agg.totalContributed);

  // ── Estimated NET interest earned to date ───────────────────────────────────
  // Accrue each primary-MMF deposit from its deposit date to today at the fund
  // EAR (geometric daily compounding, after WHT). Secondary MMFs and bank
  // holdings accrue from their own start dates where available. This is a
  // display estimate; the accrual ledger holds the authoritative day-by-day run.
  const todayISO = new Date().toISOString().slice(0, 10);
  const secondaryFundIdSet = new Set(
    secondaries.map((s) => s.mmfFundId).filter((id): id is number => typeof id === "number"),
  );
  let estInterestEarned = 0;
  for (const row of rows) {
    const instType = (row as { institutionType?: string | null }).institutionType ?? null;
    const fundId = (row as { mmfFundId?: number | null }).mmfFundId ?? null;
    // Only primary-MMF deposits accrue here; secondary/bank/gov are handled below.
    if (instType === "bank_instrument" || instType === "government_security") continue;
    if (instType === "mmf_fund" && fundId != null && secondaryFundIdSet.has(fundId)) continue;
    const amt = parseFloat(row.amount) || 0;
    const dateISO = String((row as { depositDate?: unknown }).depositDate ?? todayISO).slice(0, 10);
    estInterestEarned += estInterestToDate(amt, mmfYield, withholdingTax, dateISO, todayISO);
  }
  for (const s of secondaries) {
    const bal = parseFloat(String(s.currentBalance ?? "0")) || 0;
    const ear = parseFloat(String(s.ear ?? "0")) || 0;
    const wht = parseFloat(String(s.whtRate ?? "15")) || 15;
    const startISO = String((s as { startDate?: unknown; createdAt?: unknown }).startDate ?? (s as { createdAt?: unknown }).createdAt ?? todayISO).slice(0, 10);
    estInterestEarned += estInterestToDate(bal, ear, wht, startISO, todayISO);
  }
  for (const b of bankHoldings) {
    if (!b.isActive) continue;
    const principal = parseFloat(String(b.principal ?? "0")) || 0;
    const rate = parseFloat(String(b.interestRate ?? "0")) || 0;
    const wht = parseFloat(String(b.whtRate ?? "15")) || 15;
    const startISO = String((b as { startDate?: unknown; createdAt?: unknown }).startDate ?? (b as { createdAt?: unknown }).createdAt ?? todayISO).slice(0, 10);
    estInterestEarned += estInterestToDate(principal, rate, wht, startISO, todayISO);
  }
  // Government securities (T-bill / IFB / FXD): pro-rata coupon accrued from issue
  // date to today (capped at maturity), net of tiered WHT. This makes the
  // Dashboard estimate cover ALL income-earning assets and tie to Daily Accrual.
  estInterestEarned += govAccruedInterestTotal(
    securityRows.map((s) => ({
      securityType: String(s.securityType) as "tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd" | "zero_coupon" | "floating_rate",
      faceValue: parseFloat(String(s.faceValue ?? "0")) || 0,
      couponRate: parseFloat(String(s.couponRate ?? "0")) || 0,
      issueDate: (s as { issueDate?: unknown }).issueDate as string | Date | null | undefined,
      maturityDate: (s as { maturityDate?: unknown }).maturityDate as string | Date | null | undefined,
      isMatured: !!s.isMatured,
      isTaxExempt: !!s.isTaxExempt,
      tenorYears: (s as { tenorYears?: string | null }).tenorYears != null
        ? parseFloat(String((s as { tenorYears?: string | null }).tenorYears))
        : null,
      purchasePrice: (s as { purchasePrice?: string | null }).purchasePrice != null
        ? parseFloat(String((s as { purchasePrice?: string | null }).purchasePrice))
        : null,
    })),
    todayISO,
  );
  estInterestEarned = Math.round(estInterestEarned * 100) / 100;

  return {
    totalContributed: agg.totalContributed,
    depositsContributed: agg.depositsContributed,
    securitiesValue: agg.securitiesValue,
    secondaryMmfBalance: agg.secondaryMmfBalance,
    bankBalance: agg.bankBalance,
    remainingToTarget,
    taxLiability: agg.taxLiability,
    taxBreakdown: agg.taxBreakdown,
    annualFxdCouponIncome,
    byBucket: agg.byBucket,
    secondaryCount: secondaries.length,
    bankHoldingCount: bankHoldings.filter((b) => b.isActive).length,
    entryCount: rows.length,
    withdrawalCount: withdrawals.length,
    totalWithdrawn: withdrawals.reduce((s, w) => s + w.amount, 0),
    estInterestEarned,
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
      whtRate: mmfFunds.whtRate,
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
      govTbills: mmfComposition.govTbills,
      govTbonds: mmfComposition.govTbonds,
      govIfb: mmfComposition.govIfb,
      bankInstruments: mmfComposition.bankInstruments,
      corporateDebt: mmfComposition.corporateDebt,
      cashEquivalents: mmfComposition.cashEquivalents,
      offshoreRegional: mmfComposition.offshoreRegional,
      realEstate: mmfComposition.realEstate,
      otherAssets: mmfComposition.otherAssets,
      bankNote: mmfComposition.bankNote,
      corporateNote: mmfComposition.corporateNote,
      cashNote: mmfComposition.cashNote,
      offshoreNote: mmfComposition.offshoreNote,
      realEstateNote: mmfComposition.realEstateNote,
      otherNote: mmfComposition.otherNote,
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

/** ---------------- Bank Instrument Holdings (per-portfolio LIVE actuals) ---------------- */

export async function getBankInstrumentHoldings(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(bankInstrumentHoldings)
    .where(eq(bankInstrumentHoldings.portfolioId, portfolioId))
    .orderBy(bankInstrumentHoldings.createdAt);
}

export async function addBankInstrumentHolding(data: InsertBankInstrumentHolding) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(bankInstrumentHoldings).values(data);
  const rows = await db
    .select()
    .from(bankInstrumentHoldings)
    .where(eq(bankInstrumentHoldings.portfolioId, data.portfolioId))
    .orderBy(desc(bankInstrumentHoldings.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateBankInstrumentHolding(
  id: number,
  portfolioId: number,
  data: Partial<InsertBankInstrumentHolding>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(bankInstrumentHoldings)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(bankInstrumentHoldings.id, id), eq(bankInstrumentHoldings.portfolioId, portfolioId)));
}

export async function deleteBankInstrumentHolding(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(bankInstrumentHoldings)
    .where(and(eq(bankInstrumentHoldings.id, id), eq(bankInstrumentHoldings.portfolioId, portfolioId)));
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

/**
 * Round 70: list acknowledged concentration-cap breaches for a portfolio.
 * Breach acks are stored as audit_log rows with entity = "concentration_breach".
 * The `field` column holds the cap kind ("issuer" | "type"); `newValue` holds the
 * "X% vs Y% cap" snapshot; `summary` holds the human-readable line.
 */
export async function getBreachAcks(portfolioId: number, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.portfolioId, portfolioId), eq(auditLog.entity, "concentration_breach")))
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

/** ---------------- Round 64: actual liquid-home balances ---------------- */
import { liquidHomeBalances, liquidDriftHistory } from "../drizzle/schema";

/** All user-recorded actual balances for a portfolio's liquid homes. */
export async function getLiquidHomeBalances(portfolioId: number) {
  const db = await getDb();
  if (!db) return [] as { homeId: string; actualBalance: string; updatedAt: Date | null }[];
  return db
    .select({
      homeId: liquidHomeBalances.homeId,
      actualBalance: liquidHomeBalances.actualBalance,
      updatedAt: liquidHomeBalances.updatedAt,
    })
    .from(liquidHomeBalances)
    .where(eq(liquidHomeBalances.portfolioId, portfolioId));
}

/**
 * Upsert one actual balance for a (portfolio, homeId). Relies on the unique
 * constraint on (portfolioId, homeId) so a repeat save updates in place.
 */
export async function upsertLiquidHomeBalance(
  portfolioId: number,
  homeId: string,
  actualBalance: number,
) {
  const db = await getDb();
  if (!db) return;
  const value = actualBalance.toFixed(2);
  await db
    .insert(liquidHomeBalances)
    .values({ portfolioId, homeId, actualBalance: value })
    .onDuplicateKeyUpdate({ set: { actualBalance: value, updatedAt: new Date() } });
}

/** Clear a recorded actual balance (revert that home to its computed balance). */
export async function clearLiquidHomeBalance(portfolioId: number, homeId: string) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(liquidHomeBalances)
    .where(
      and(
        eq(liquidHomeBalances.portfolioId, portfolioId),
        eq(liquidHomeBalances.homeId, homeId),
      ),
    );
}


/** ---------------- Round 67: liquid drift history ---------------- */

/**
 * Record a point-in-time drift snapshot. De-duplicates: skips the insert when
 * the most recent snapshot has the same rounded totalDrift AND breached flag, so
 * repeated reconciles that don't move drift don't bloat the sparkline.
 */
export async function recordDriftSnapshot(args: {
  portfolioId: number;
  totalDrift: number;
  netWorth: number;
  thresholdValue: number;
  breached: boolean;
}) {
  const db = await getDb();
  if (!db) return;
  const last = await db
    .select({
      totalDrift: liquidDriftHistory.totalDrift,
      breached: liquidDriftHistory.breached,
    })
    .from(liquidDriftHistory)
    .where(eq(liquidDriftHistory.portfolioId, args.portfolioId))
    .orderBy(desc(liquidDriftHistory.createdAt))
    .limit(1);
  const newDrift = args.totalDrift.toFixed(2);
  if (
    last.length > 0 &&
    last[0].totalDrift === newDrift &&
    Boolean(last[0].breached) === args.breached
  ) {
    return; // no meaningful change since the last snapshot
  }
  await db.insert(liquidDriftHistory).values({
    portfolioId: args.portfolioId,
    totalDrift: newDrift,
    netWorth: args.netWorth.toFixed(2),
    thresholdValue: args.thresholdValue.toFixed(2),
    breached: args.breached,
  });
}

/** Recent drift snapshots (oldest → newest) for the sparkline, capped at `limit`. */
export async function getDriftHistory(portfolioId: number, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      totalDrift: liquidDriftHistory.totalDrift,
      netWorth: liquidDriftHistory.netWorth,
      thresholdValue: liquidDriftHistory.thresholdValue,
      breached: liquidDriftHistory.breached,
      createdAt: liquidDriftHistory.createdAt,
    })
    .from(liquidDriftHistory)
    .where(eq(liquidDriftHistory.portfolioId, portfolioId))
    .orderBy(desc(liquidDriftHistory.createdAt))
    .limit(limit);
  // Return chronological order for charting.
  return rows.reverse();
}


/** R67 — set/clear the drift-alert snooze (Unix ms) for a portfolio. */
export async function setDriftSnoozeUntil(portfolioId: number, until: number | null) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(portfolios)
    .set({ driftSnoozeUntil: until })
    .where(eq(portfolios.id, portfolioId));
}

/** R67 — record when the owner was last notified of a drift breach (Unix ms). */
export async function setDriftLastNotifiedAt(portfolioId: number, at: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(portfolios)
    .set({ driftLastNotifiedAt: at })
    .where(eq(portfolios.id, portfolioId));
}

/** R68 — set the drift digest mode ("immediate" | "digest") and cron task uid. */
export async function setDriftDigestConfig(
  portfolioId: number,
  patch: { mode?: string; cronTaskUid?: string | null },
) {
  const db = await getDb();
  if (!db) return;
  const set: Record<string, unknown> = {};
  if (patch.mode !== undefined) set.driftDigestMode = patch.mode;
  if (patch.cronTaskUid !== undefined) set.driftDigestCronTaskUid = patch.cronTaskUid;
  if (Object.keys(set).length === 0) return;
  await db.update(portfolios).set(set).where(eq(portfolios.id, portfolioId));
}

/** R68 — mark (or clear) a pending digest breach for a portfolio. */
export async function setDriftDigestPending(portfolioId: number, pending: boolean) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(portfolios)
    .set({ driftDigestPending: pending })
    .where(eq(portfolios.id, portfolioId));
}

/** R68 — look up a portfolio by its drift-digest cron task uid (for the handler). */
export async function getPortfolioByDriftDigestTaskUid(taskUid: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.driftDigestCronTaskUid, taskUid))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Time Machine (sandbox only) ────────────────────────────────────────────────

/**
 * Delete every record tagged with a given simulation session id for one
 * portfolio. This is the single, surgical "Reset to today" cleanup: because the
 * time machine tags every row it creates with the active `simSessionId`, dropping
 * exactly those rows restores the portfolio to its pre-simulation state without
 * touching any record the user entered by hand. Cascades through the same linked
 * deposit/withdrawal rows as a manual delete so no orphans survive.
 *
 * Returns per-table counts so the caller can report what was rolled back.
 */
export async function deleteSimSessionRecords(
  portfolioId: number,
  simSessionId: string,
): Promise<{ securities: number; deposits: number; withdrawals: number }> {
  const db = await getDb();
  if (!db) return { securities: 0, deposits: 0, withdrawals: 0 };

  // Snapshot counts first (mysql2 driver doesn't reliably return affectedRows here).
  const simSecs = await db
    .select()
    .from(securities)
    .where(and(eq(securities.portfolioId, portfolioId), eq(securities.simSessionId, simSessionId)));
  const simDeps = await db
    .select()
    .from(depositEntries)
    .where(and(eq(depositEntries.portfolioId, portfolioId), eq(depositEntries.simSessionId, simSessionId)));
  const simWds = await db
    .select()
    .from(withdrawalEntries)
    .where(and(eq(withdrawalEntries.portfolioId, portfolioId), eq(withdrawalEntries.simSessionId, simSessionId)));

  // Order matters: drop withdrawals + deposits first, then securities, so the
  // generic security cascade can't double-remove a row we already counted.
  await db
    .delete(withdrawalEntries)
    .where(and(eq(withdrawalEntries.portfolioId, portfolioId), eq(withdrawalEntries.simSessionId, simSessionId)));
  await db
    .delete(depositEntries)
    .where(and(eq(depositEntries.portfolioId, portfolioId), eq(depositEntries.simSessionId, simSessionId)));
  await db
    .delete(securities)
    .where(and(eq(securities.portfolioId, portfolioId), eq(securities.simSessionId, simSessionId)));

  return { securities: simSecs.length, deposits: simDeps.length, withdrawals: simWds.length };
}

/** Count records tagged with a session id (for the post-advance summary). */
export async function countSimSessionRecords(
  portfolioId: number,
  simSessionId: string,
): Promise<{ securities: number; deposits: number; withdrawals: number }> {
  const db = await getDb();
  if (!db) return { securities: 0, deposits: 0, withdrawals: 0 };
  const [secs, deps, wds] = await Promise.all([
    db.select().from(securities).where(and(eq(securities.portfolioId, portfolioId), eq(securities.simSessionId, simSessionId))),
    db.select().from(depositEntries).where(and(eq(depositEntries.portfolioId, portfolioId), eq(depositEntries.simSessionId, simSessionId))),
    db.select().from(withdrawalEntries).where(and(eq(withdrawalEntries.portfolioId, portfolioId), eq(withdrawalEntries.simSessionId, simSessionId))),
  ]);
  return { securities: secs.length, deposits: deps.length, withdrawals: wds.length };
}
