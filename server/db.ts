import { and, eq, desc, asc, sql, inArray, lte, isNotNull } from "drizzle-orm";
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
  opportunities,
  type Opportunity,
  type InsertOpportunity,
  ingestionConflicts,
  type IngestionConflict,
  type InsertIngestionConflict,
  aiCandidates,
  type AiCandidate,
  type InsertAiCandidate,
  aiIntakeAudit,
  type AiIntakeAuditRow,
  type InsertAiIntakeAudit,
  allocationTemplates,
  type AllocationTemplateRow,
  allocationGlideParams,
  type AllocationGlideParamsRow,
  allocationProbabilityThresholds,
  type AllocationProbabilityThresholdsRow,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { computeActualsTotals, estInterestToDate, govAccruedInterestTotal } from "../shared/actuals";
import { normaliseAssetClass } from "../shared/assetModel";
import {
  applyVerification,
  summariseState,
  reconcileScrape,
  reconcileAiExtraction,
  type FieldKey,
  type FieldProvenance,
  type FieldProvenanceMap,
  type VerifyAction,
} from "../shared/provenance";

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
  // Government securities (T-bill / IFB / FXD), net of tiered WHT, so the Dashboard
  // estimate covers ALL income-earning assets and ties to Daily Accrual. Note the
  // accrual basis differs by instrument (see govAccruedInterestToDate):
  //   - T-bills / zero-coupon: the DISCOUNT (face - price) accreted pro-rata over
  //     the holding window (capped at maturity) - not a coupon.
  //   - Coupon bonds (FXD / IFB / floating): only the CURRENT coupon period's
  //     accrual (resets at each ~182.5-day coupon date), NOT issue->today, so it
  //     excludes coupons already paid out before tracking began.
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
    forwardGrossIncome12mo: agg.forwardGrossIncome12mo,
    forwardNetIncome12mo: agg.forwardNetIncome12mo,
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

/**
 * List ALL income records across a portfolio's holdings, joined to the owning
 * holding's name + behaviour class, ordered newest-first. Used by the Month
 * Ledger to surface recorded dividend / distribution payments alongside the
 * projected core flows. Filtered by portfolioId on the holdings side so a user
 * only ever sees their own records.
 */
export async function getPortfolioHoldingIncome(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: holdingIncome.id,
      holdingId: holdingIncome.holdingId,
      amount: holdingIncome.amount,
      incomeDate: holdingIncome.incomeDate,
      incomeType: holdingIncome.incomeType,
      notes: holdingIncome.notes,
      createdAt: holdingIncome.createdAt,
      holdingName: otherHoldings.name,
      behaviorClass: otherHoldings.behaviorClass,
      assetClass: otherHoldings.assetClass,
    })
    .from(holdingIncome)
    .innerJoin(otherHoldings, eq(holdingIncome.holdingId, otherHoldings.id))
    .where(eq(otherHoldings.portfolioId, portfolioId))
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
      holdingSnapshot: portfolioSecondaryMmfs.holdingSnapshot,
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

/**
 * Part A1 — the single inflation rate (% p.a.) used across the app. This is the
 * SAME `benchmark_inputs.inflation` row that powers the Dashboard/Portfolio
 * Review real-yield line, so the inflated-goal default can never disagree with
 * the inflation figure the user already sees. Returns `fallback` when unset.
 */
export async function getInflationBenchmarkPct(fallback = 0): Promise<number> {
  const rows = await getBenchmarkInputs();
  const row = rows.find((r) => r.metricKey === "inflation");
  const v = row ? Number(row.value) : NaN;
  return Number.isFinite(v) ? v : fallback;
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

/**
 * Time Machine — delete a specific set of deposit entries by id (used by
 * Undo-last-step to remove ONLY the rows that step materialised, leaving every
 * earlier step's rows intact). Reuses deleteDepositEntry so any linked gov
 * security register row cascades away too. Returns the count actually removed.
 */
export async function deleteDepositEntriesByIds(
  portfolioId: number,
  ids: number[],
): Promise<number> {
  const db = await getDb();
  if (!db || ids.length === 0) return 0;
  let removed = 0;
  for (const id of ids) {
    await deleteDepositEntry(id, portfolioId);
    removed += 1;
  }
  return removed;
}

// ─── Expansion Part 2: Opportunity Catalog (reference data) ──────────────────

/**
 * List active opportunities in a NEUTRAL default order (asset class, then name —
 * never by yield/return/price). The catalog is a screener: the SERVER never
 * applies a quality ranking or a performance-first default; ordering by a metric
 * only happens when the user explicitly asks for it (handled in the router via an
 * allow-listed sort the user selects). Returns raw rows.
 */
export async function listOpportunities(): Promise<Opportunity[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.active, true))
    .orderBy(asc(opportunities.assetClass), asc(opportunities.name));
  // Defensive: recover the canonical class for any legacy/AI row whose stored
  // `assetClass` is a human label or snake_case variant, so it never renders as
  // a misleading "Alternative asset". Valid codes pass through untouched.
  return rows.map((r) => ({ ...r, assetClass: normaliseAssetClass(r.assetClass) }));
}

/** Fetch a single opportunity by its stable reference key (for the detail view). */
export async function getOpportunityByRef(ref: string): Promise<Opportunity | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.ref, ref))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, assetClass: normaliseAssetClass(row.assetClass) };
}

/** Fetch a single opportunity by its numeric id. */
export async function getOpportunityById(id: number): Promise<Opportunity | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return { ...row, assetClass: normaliseAssetClass(row.assetClass) };
}

/** Count rows (used by the seed/ingestion guard). */
export async function countOpportunities(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select({ n: sql<number>`count(*)` }).from(opportunities);
  return Number(rows[0]?.n ?? 0);
}

/**
 * Idempotent upsert of a reference row by `ref`. Ingestion writes facts +
 * provenance; it NEVER writes a ranking/score because no such column exists.
 */
export async function upsertOpportunity(data: InsertOpportunity): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select({ id: opportunities.id })
    .from(opportunities)
    .where(eq(opportunities.ref, data.ref))
    .limit(1);
  if (existing[0]) {
    await db.update(opportunities).set(data).where(eq(opportunities.ref, data.ref));
  } else {
    await db.insert(opportunities).values(data);
  }
}

/**
 * Part 7.1: apply a single human verification action (confirm | override) to ONE
 * figure of an opportunity, then persist the updated per-figure map and the
 * derived row-level summary state. This is the only write path that changes a
 * figure's verification state, and it goes through the pure `applyVerification`
 * helper so the invariants (human action raises trust; an override changes BOTH
 * value AND state; a confirm never lowers an already-entered figure) hold.
 *
 * Returns the updated FieldProvenance for the affected figure, or null when the
 * row/figure does not exist.
 */
export async function verifyOpportunityField(args: {
  ref: string;
  fieldKey: FieldKey;
  action: VerifyAction;
}): Promise<FieldProvenance | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.ref, args.ref))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const map: FieldProvenanceMap = { ...((row.fieldProvenance as FieldProvenanceMap | null) ?? {}) };
  const existing = map[args.fieldKey];
  if (!existing) return null; // never invent a figure that the instrument doesn't expose
  const updated = applyVerification(existing, args.action);
  map[args.fieldKey] = updated;
  await db
    .update(opportunities)
    .set({ fieldProvenance: map, verificationState: summariseState(map) })
    .where(eq(opportunities.ref, args.ref));
  return updated;
}

/**
 * Part 8 (deeper spec) — REJECT a single AI-extracted figure (a maintainer judged it
 * a misread/hallucination). This DROPS the figure from the provenance map entirely so
 * it stops appearing as a provisional value. It is deliberately narrow: it will ONLY
 * remove a figure whose state is `ai_extracted`. It refuses to delete a human-verified,
 * human-entered, or scraped figure (returning `{ removed: false }`), because those are
 * real data a reject must never destroy — correcting those goes through verifyField.
 *
 * Returns whether a figure was removed and whether the whole row became empty (caller
 * may then deactivate an AI-only row that the human rejected wholesale).
 */
export async function rejectAiField(args: {
  ref: string;
  fieldKey: FieldKey;
}): Promise<{ removed: boolean; emptied: boolean }> {
  const db = await getDb();
  if (!db) return { removed: false, emptied: false };
  const rows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.ref, args.ref))
    .limit(1);
  const row = rows[0];
  if (!row) return { removed: false, emptied: false };
  const map: FieldProvenanceMap = { ...((row.fieldProvenance as FieldProvenanceMap | null) ?? {}) };
  const existing = map[args.fieldKey];
  // Only AI-extracted, never-human-touched figures may be rejected/dropped.
  if (!existing || existing.verificationState !== "ai_extracted") {
    return { removed: false, emptied: false };
  }
  delete map[args.fieldKey];
  const emptied = Object.keys(map).length === 0;
  await db
    .update(opportunities)
    .set({
      fieldProvenance: map,
      verificationState: summariseState(map),
      // If the human rejected the LAST AI figure on an AI-only row, deactivate it so it
      // never lingers as an empty provisional shell in the catalog or the queue.
      ...(emptied ? { active: false } : {}),
    })
    .where(eq(opportunities.ref, args.ref));
  return { removed: true, emptied };
}

/**
 * Part 7.2 — ingest a freshly scraped per-figure map for one instrument WITHOUT
 * ever clobbering a human-checked figure.
 *
 * If the row does not yet exist, it is inserted from the provided base columns
 * (all figures land as scraped_unverified). If it exists, the scrape is reconciled
 * against the stored map via the pure `reconcileScrape`:
 *  - unverified figures are refreshed with the scraped value/asOf/fetchedAt;
 *  - human_verified / human_entered figures keep their value+state (only fetchedAt
 *    is refreshed to record that we re-checked);
 *  - any disagreement with a human value becomes an `ingestion_conflicts` row
 *    (status=open) instead of overwriting the number.
 *
 * Returns the conflicts detected for this instrument so the runner can report them.
 * Never writes a ranking — there is no such column.
 */
export async function ingestScrapedInstrument(args: {
  base: InsertOpportunity;
  scraped: FieldProvenanceMap;
  sourceId: string;
}): Promise<{ ref: string; conflicts: number; changed: boolean }> {
  const db = await getDb();
  if (!db) return { ref: args.base.ref, conflicts: 0, changed: false };

  const rows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.ref, args.base.ref))
    .limit(1);
  const existingRow = rows[0];

  // New instrument: insert with the scraped map straight in as unverified.
  if (!existingRow) {
    await db.insert(opportunities).values({
      ...args.base,
      fieldProvenance: args.scraped,
      verificationState: summariseState(args.scraped),
    });
    return { ref: args.base.ref, conflicts: 0, changed: true };
  }

  const existingMap: FieldProvenanceMap = (existingRow.fieldProvenance as FieldProvenanceMap | null) ?? {};
  const { merged, conflicts, changed } = reconcileScrape(existingMap, args.scraped);

  if (changed) {
    await db
      .update(opportunities)
      .set({ fieldProvenance: merged, verificationState: summariseState(merged) })
      .where(eq(opportunities.ref, args.base.ref));
  }

  // Persist any conflicts (idempotently: skip if an identical open conflict exists).
  for (const c of conflicts) {
    const dupe = await db
      .select({ id: ingestionConflicts.id })
      .from(ingestionConflicts)
      .where(
        and(
          eq(ingestionConflicts.opportunityRef, args.base.ref),
          eq(ingestionConflicts.field, c.field),
          eq(ingestionConflicts.status, "open"),
        ),
      )
      .limit(1);
    if (dupe[0]) {
      // Refresh the latest scraped value/source on the existing open conflict.
      await db
        .update(ingestionConflicts)
        .set({
          scrapedValue: c.scrapedValue,
          scrapedSource: c.scrapedSource,
          scrapedAsOf: c.scrapedAsOf,
          sourceId: args.sourceId,
        })
        .where(eq(ingestionConflicts.id, dupe[0].id));
      continue;
    }
    const insert: InsertIngestionConflict = {
      opportunityRef: args.base.ref,
      field: c.field,
      humanValue: c.humanValue,
      humanState: c.humanState,
      scrapedValue: c.scrapedValue,
      scrapedSource: c.scrapedSource,
      sourceId: args.sourceId,
      scrapedAsOf: c.scrapedAsOf,
      status: "open",
    };
    await db.insert(ingestionConflicts).values(insert);
  }

  return { ref: args.base.ref, conflicts: conflicts.length, changed };
}

/**
 * Part 8 — ingest an AI-extracted per-figure map for one instrument. AI enters at
 * the LOWEST trust tier and can NEVER clobber anything:
 *  - a NEW instrument is inserted with every figure as ai_extracted (provisional);
 *  - an EXISTING instrument keeps all stored figures untouched — AI only fills blanks
 *    (via reconcileAiExtraction). Any disagreement with a stored value becomes an
 *    `ingestion_conflicts` row (status=open) for human review, never an overwrite.
 *
 * Returns how many figures were newly filled and how many conflicts were raised.
 * There is no ranking column to write, and this never marks a row human-checked.
 */
export async function ingestAiExtractedInstrument(args: {
  base: InsertOpportunity;
  ai: FieldProvenanceMap;
  sourceId: string;
}): Promise<{ ref: string; filled: number; conflicts: number; changed: boolean; created: boolean }> {
  const db = await getDb();
  if (!db) return { ref: args.base.ref, filled: 0, conflicts: 0, changed: false, created: false };

  const rows = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.ref, args.base.ref))
    .limit(1);
  const existingRow = rows[0];

  // New instrument: insert with the AI map straight in as ai_extracted (provisional).
  if (!existingRow) {
    const filled = Object.values(args.ai).filter((p) => !!p && p.value != null).length;
    await db.insert(opportunities).values({
      ...args.base,
      unverified: true, // nobody has checked it; it is AI-provisional
      fieldProvenance: args.ai,
      verificationState: summariseState(args.ai),
    });
    return { ref: args.base.ref, filled, conflicts: 0, changed: true, created: true };
  }

  const existingMap: FieldProvenanceMap = (existingRow.fieldProvenance as FieldProvenanceMap | null) ?? {};
  const before = Object.values(existingMap).filter((p) => !!p && p.value != null).length;
  const { merged, conflicts, changed } = reconcileAiExtraction(existingMap, args.ai);
  const after = Object.values(merged).filter((p) => !!p && p.value != null).length;
  const filled = Math.max(0, after - before);

  if (changed) {
    await db
      .update(opportunities)
      .set({ fieldProvenance: merged, verificationState: summariseState(merged) })
      .where(eq(opportunities.ref, args.base.ref));
  }

  // Persist any AI-vs-stored disagreements as open conflicts (idempotently).
  for (const c of conflicts) {
    const dupe = await db
      .select({ id: ingestionConflicts.id })
      .from(ingestionConflicts)
      .where(
        and(
          eq(ingestionConflicts.opportunityRef, args.base.ref),
          eq(ingestionConflicts.field, c.field),
          eq(ingestionConflicts.status, "open"),
        ),
      )
      .limit(1);
    if (dupe[0]) {
      await db
        .update(ingestionConflicts)
        .set({ scrapedValue: c.scrapedValue, scrapedSource: c.scrapedSource, scrapedAsOf: c.scrapedAsOf, sourceId: args.sourceId })
        .where(eq(ingestionConflicts.id, dupe[0].id));
      continue;
    }
    const insert: InsertIngestionConflict = {
      opportunityRef: args.base.ref,
      field: c.field,
      humanValue: c.humanValue,
      humanState: c.humanState,
      scrapedValue: c.scrapedValue,
      scrapedSource: c.scrapedSource,
      sourceId: args.sourceId,
      scrapedAsOf: c.scrapedAsOf,
      status: "open",
    };
    await db.insert(ingestionConflicts).values(insert);
  }

  return { ref: args.base.ref, filled, conflicts: conflicts.length, changed, created: false };
}

/**
 * Part 8.1 — record the storage key of a screenshot/image that was uploaded as the SOURCE
 * for an AI image extraction on a row, so the review queue can render a thumbnail next to
 * the figures. Append-only and de-duplicated; stores keys only, never file bytes. No-op if
 * the row is missing or the key is already recorded.
 */
export async function attachAiSourceImageKey(ref: string, key: string): Promise<void> {
  const db = await getDb();
  if (!db || !key) return;
  const rows = await db
    .select({ keys: opportunities.aiSourceImageKeys })
    .from(opportunities)
    .where(eq(opportunities.ref, ref))
    .limit(1);
  if (!rows[0]) return;
  const current = Array.isArray(rows[0].keys) ? (rows[0].keys as string[]) : [];
  if (current.includes(key)) return;
  const next = [...current, key].slice(-8); // cap to the 8 most recent screenshots
  await db.update(opportunities).set({ aiSourceImageKeys: next }).where(eq(opportunities.ref, ref));
}

/* ── Part 8: AI universe-discovery candidates (suggestions only) ──────────── */

/** Insert a batch of AI-proposed candidates (status=pending). De-dupes by name within the call. */
export async function insertAiCandidates(rows: InsertAiCandidate[]): Promise<number> {
  const db = await getDb();
  if (!db || rows.length === 0) return 0;
  // Skip names that already have a pending/approved candidate so re-running discovery
  // doesn't pile up duplicates.
  const existing = await db
    .select({ name: aiCandidates.name, status: aiCandidates.status })
    .from(aiCandidates);
  const blocked = new Set(
    existing.filter((r) => r.status !== "dismissed").map((r) => r.name.trim().toLowerCase()),
  );
  const fresh = rows.filter((r) => !blocked.has(r.name.trim().toLowerCase()));
  if (fresh.length === 0) return 0;
  await db.insert(aiCandidates).values(fresh);
  return fresh.length;
}

/** List candidates (newest first), optionally filtered by status. */
export async function listAiCandidates(status?: "pending" | "approved" | "dismissed"): Promise<AiCandidate[]> {
  const db = await getDb();
  if (!db) return [];
  const base = db.select().from(aiCandidates);
  return status
    ? await base.where(eq(aiCandidates.status, status)).orderBy(desc(aiCandidates.createdAt))
    : await base.orderBy(desc(aiCandidates.createdAt));
}

/** Count pending candidates (for a review badge). */
export async function countPendingCandidates(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(aiCandidates)
    .where(eq(aiCandidates.status, "pending"));
  return Number(rows[0]?.n ?? 0);
}

/** Fetch one candidate by id. */
export async function getAiCandidate(id: number): Promise<AiCandidate | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(aiCandidates).where(eq(aiCandidates.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Mark a candidate reviewed. approvedRef is set only when the human created an instrument from it. */
export async function reviewAiCandidate(args: {
  id: number;
  status: "approved" | "dismissed";
  reviewedBy: string;
  approvedRef?: string | null;
}): Promise<AiCandidate | null> {
  const db = await getDb();
  if (!db) return null;
  await db
    .update(aiCandidates)
    .set({
      status: args.status,
      reviewedBy: args.reviewedBy,
      reviewedAt: Date.now(),
      approvedRef: args.status === "approved" ? (args.approvedRef ?? null) : null,
    })
    .where(eq(aiCandidates.id, args.id));
  return getAiCandidate(args.id);
}

/* ── Part 8 (item 6): AI intake audit trail ─────────────────────────────────
 * Append-only: one row per AI intake call, written by the procedure regardless of
 * success, so every billable LLM call and every figure that enters the catalog can be
 * traced to its document, model, timestamp, and the maintainer who triggered it.
 */

/** Append one audit entry. Best-effort: never throws into the caller (audit must not break intake). */
export async function insertAiIntakeAudit(entry: InsertAiIntakeAudit): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(aiIntakeAudit).values(entry);
  } catch (err) {
    // Logging the audit must never fail the intake itself; surface to server logs only.
    console.error("[ai-intake-audit] failed to write audit entry", err);
  }
}

/** List audit entries, newest first, capped (maintainer-only viewer). */
export async function listAiIntakeAudit(limit = 100): Promise<AiIntakeAuditRow[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(aiIntakeAudit).orderBy(desc(aiIntakeAudit.createdAt)).limit(limit);
}

/** List ingestion conflicts (newest first), optionally only open ones. */
export async function listIngestionConflicts(openOnly = true): Promise<IngestionConflict[]> {
  const db = await getDb();
  if (!db) return [];
  const base = db.select().from(ingestionConflicts);
  const rows = openOnly
    ? await base.where(eq(ingestionConflicts.status, "open")).orderBy(desc(ingestionConflicts.createdAt))
    : await base.orderBy(desc(ingestionConflicts.createdAt));
  return rows;
}

/** Count open ingestion conflicts (for a review badge). */
export async function countOpenConflicts(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(ingestionConflicts)
    .where(eq(ingestionConflicts.status, "open"));
  return Number(rows[0]?.n ?? 0);
}

/**
 * Resolve a conflict. `dismiss` keeps the human value (the scrape is discarded).
 * `apply` records the resolution here; the caller is responsible for writing the
 * scraped value through the normal verify/override path so the human-attention
 * invariant still holds (an applied scrape becomes human_entered by the reviewer).
 */
export async function resolveIngestionConflict(args: {
  id: number;
  status: "dismissed" | "applied";
  resolvedBy: string;
}): Promise<IngestionConflict | null> {
  const db = await getDb();
  if (!db) return null;
  await db
    .update(ingestionConflicts)
    .set({ status: args.status, resolvedBy: args.resolvedBy, resolvedAt: Date.now() })
    .where(eq(ingestionConflicts.id, args.id));
  const rows = await db.select().from(ingestionConflicts).where(eq(ingestionConflicts.id, args.id)).limit(1);
  return rows[0] ?? null;
}


/* ── Allocation Model Part 1: editable target allocation templates ─────────── */

import {
  type AllocationTier,
  type AllocationTemplate,
  type AllocationWeights,
  ALLOCATION_TIERS,
  ALLOCATION_BUCKETS,
  defaultTemplateFor,
  validateAllocationWeights,
  type GlideParams,
  DEFAULT_GLIDE_PARAMS,
  validateGlideParams,
  type ProbabilityThresholds,
  DEFAULT_PROBABILITY_THRESHOLDS,
  validateProbabilityThresholds,
} from "../shared/allocationModel";

/** Parse a YYYY-MM-DD provenance date into a Date, or null when absent/invalid. */
function parseAsOfDate(asOf: string | null | undefined): Date | null {
  if (!asOf) return null;
  const d = new Date(asOf);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Coerce a stored JSON weights blob into a clean AllocationWeights (numbers per bucket). */
function coerceWeights(raw: unknown): AllocationWeights {
  const src = (raw ?? {}) as Record<string, unknown>;
  const out = {} as AllocationWeights;
  for (const b of ALLOCATION_BUCKETS) out[b] = Number(src[b]) || 0;
  return out;
}

/** Map a stored row to the shared AllocationTemplate shape. */
function rowToTemplate(row: AllocationTemplateRow): AllocationTemplate {
  return {
    tier: row.tier as AllocationTier,
    weights: coerceWeights(row.weights),
    source: row.source ?? null,
    asOf: row.asOfDate ? String(row.asOfDate) : null,
    notes: row.notes ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : null,
  };
}

/**
 * List the target allocation template for every tier, in tier order. Any tier
 * not yet present in the table falls back to its seeded default, so the engine
 * always sees a complete, valid set even before the table is populated. Read
 * helper only — never writes.
 */
export async function listAllocationTemplates(): Promise<AllocationTemplate[]> {
  const db = await getDb();
  const stored = new Map<AllocationTier, AllocationTemplate>();
  if (db) {
    const rows = await db.select().from(allocationTemplates);
    for (const r of rows) {
      if ((ALLOCATION_TIERS as readonly string[]).includes(r.tier)) {
        stored.set(r.tier as AllocationTier, rowToTemplate(r));
      }
    }
  }
  return ALLOCATION_TIERS.map((tier) => stored.get(tier) ?? defaultTemplateFor(tier));
}

/** Read one tier's template (stored, else the seeded default). */
export async function getAllocationTemplate(tier: AllocationTier): Promise<AllocationTemplate> {
  const db = await getDb();
  if (db) {
    const rows = await db
      .select()
      .from(allocationTemplates)
      .where(eq(allocationTemplates.tier, tier))
      .limit(1);
    if (rows[0]) return rowToTemplate(rows[0]);
  }
  return defaultTemplateFor(tier);
}

/**
 * Save (upsert) a tier's allocation template. The weights are VALIDATED first
 * (sum to 100, cash floor, in-range) — a non-conforming template is REJECTED and
 * never written. Returns the validation result so the caller can surface the
 * specific failures; on success the stored template is returned via the `ok`
 * path. Provenance (source/asOf/notes) is recorded alongside the weights.
 */
export async function saveAllocationTemplate(args: {
  tier: AllocationTier;
  weights: AllocationWeights;
  source?: string | null;
  asOf?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; errors: string[] }> {
  const validation = validateAllocationWeights(args.weights);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const db = await getDb();
  if (!db) return { ok: false, errors: ["Database unavailable."] };

  // Normalise to whole-number weights over exactly the known buckets.
  const weights = {} as AllocationWeights;
  for (const b of ALLOCATION_BUCKETS) weights[b] = Number(args.weights[b]) || 0;

  // The date column expects a Date (or null). Parse a YYYY-MM-DD string; an
  // unparseable/empty value becomes null rather than an Invalid Date.
  const asOfDate = parseAsOfDate(args.asOf);

  const existing = await db
    .select({ id: allocationTemplates.id })
    .from(allocationTemplates)
    .where(eq(allocationTemplates.tier, args.tier))
    .limit(1);

  if (existing[0]) {
    await db
      .update(allocationTemplates)
      .set({
        weights,
        source: args.source ?? null,
        asOfDate,
        notes: args.notes ?? null,
      })
      .where(eq(allocationTemplates.tier, args.tier));
  } else {
    await db.insert(allocationTemplates).values({
      tier: args.tier,
      weights,
      source: args.source ?? null,
      asOfDate,
      notes: args.notes ?? null,
    });
  }
  return { ok: true, errors: [] };
}

/* ── Allocation Model Part 2: editable glide-curve shape parameters ────────── */

/** The sentinel key for the single global glide-params row. */
const GLIDE_PARAMS_KEY = "global";

/** Coerce a stored params blob into a clean GlideParams, defaulting any missing field. */
function coerceGlideParams(raw: unknown): GlideParams {
  const src = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    steepness: num(src.steepness, DEFAULT_GLIDE_PARAMS.steepness),
    foundationEnd: num(src.foundationEnd, DEFAULT_GLIDE_PARAMS.foundationEnd),
    growthEnd: num(src.growthEnd, DEFAULT_GLIDE_PARAMS.growthEnd),
    deRiskingEnd: num(src.deRiskingEnd, DEFAULT_GLIDE_PARAMS.deRiskingEnd),
  };
}

/** The stored glide params with their provenance, for an editor/display. */
export interface StoredGlideParams {
  params: GlideParams;
  source: string | null;
  asOf: string | null;
  notes: string | null;
  updatedAt: number | null;
}

/** Map a stored row to the StoredGlideParams shape. */
function rowToGlideParams(row: AllocationGlideParamsRow): StoredGlideParams {
  return {
    params: coerceGlideParams(row.params),
    source: row.source ?? null,
    asOf: row.asOfDate ? String(row.asOfDate) : null,
    notes: row.notes ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : null,
  };
}

/**
 * Read the global glide-curve shape. Falls back to the documented defaults
 * (DEFAULT_GLIDE_PARAMS) when no row is present, so the glide always has a valid,
 * complete shape. Read-only.
 */
export async function getGlideParams(): Promise<StoredGlideParams> {
  const db = await getDb();
  if (db) {
    const rows = await db
      .select()
      .from(allocationGlideParams)
      .where(eq(allocationGlideParams.singletonKey, GLIDE_PARAMS_KEY))
      .limit(1);
    if (rows[0]) return rowToGlideParams(rows[0]);
  }
  return {
    params: { ...DEFAULT_GLIDE_PARAMS },
    source: "Default glide shape (illustrative; editable)",
    asOf: null,
    notes: null,
    updatedAt: null,
  };
}

/**
 * Save (upsert) the global glide-curve shape. The params are VALIDATED first
 * (steepness ≥ 1 so the curve stays convex/linear — never concave; phase
 * thresholds strictly ascending within (0,1)); a non-conforming shape is REJECTED
 * and never written. Provenance (source/asOf/notes) is recorded alongside.
 */
export async function saveGlideParams(args: {
  params: GlideParams;
  source?: string | null;
  asOf?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; errors: string[] }> {
  const validation = validateGlideParams(args.params);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const db = await getDb();
  if (!db) return { ok: false, errors: ["Database unavailable."] };

  const params = {
    steepness: Number(args.params.steepness),
    foundationEnd: Number(args.params.foundationEnd),
    growthEnd: Number(args.params.growthEnd),
    deRiskingEnd: Number(args.params.deRiskingEnd),
  };
  const asOfDate = parseAsOfDate(args.asOf);

  const existing = await db
    .select({ id: allocationGlideParams.id })
    .from(allocationGlideParams)
    .where(eq(allocationGlideParams.singletonKey, GLIDE_PARAMS_KEY))
    .limit(1);

  if (existing[0]) {
    await db
      .update(allocationGlideParams)
      .set({ params, source: args.source ?? null, asOfDate, notes: args.notes ?? null })
      .where(eq(allocationGlideParams.singletonKey, GLIDE_PARAMS_KEY));
  } else {
    await db.insert(allocationGlideParams).values({
      singletonKey: GLIDE_PARAMS_KEY,
      params,
      source: args.source ?? null,
      asOfDate,
      notes: args.notes ?? null,
    });
  }
  return { ok: true, errors: [] };
}

/* ── Allocation Model Part 3: editable two-sided probability thresholds ─────── */

/** The sentinel key for the single global probability-thresholds row. */
const PROBABILITY_THRESHOLDS_KEY = "global";

/** Coerce a stored thresholds blob into a clean ProbabilityThresholds. */
function coerceThresholds(raw: unknown): ProbabilityThresholds {
  const src = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    highPct: num(src.highPct, DEFAULT_PROBABILITY_THRESHOLDS.highPct),
    lowPct: num(src.lowPct, DEFAULT_PROBABILITY_THRESHOLDS.lowPct),
  };
}

/** The stored thresholds with provenance, for an editor/display. */
export interface StoredProbabilityThresholds {
  thresholds: ProbabilityThresholds;
  source: string | null;
  asOf: string | null;
  notes: string | null;
  updatedAt: number | null;
}

function rowToThresholds(row: AllocationProbabilityThresholdsRow): StoredProbabilityThresholds {
  return {
    thresholds: coerceThresholds(row.thresholds),
    source: row.source ?? null,
    asOf: row.asOfDate ? String(row.asOfDate) : null,
    notes: row.notes ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).getTime() : null,
  };
}

/**
 * Read the global two-sided probability thresholds. Falls back to the documented
 * defaults when no row is present. Read-only.
 */
export async function getProbabilityThresholds(): Promise<StoredProbabilityThresholds> {
  const db = await getDb();
  if (db) {
    const rows = await db
      .select()
      .from(allocationProbabilityThresholds)
      .where(eq(allocationProbabilityThresholds.singletonKey, PROBABILITY_THRESHOLDS_KEY))
      .limit(1);
    if (rows[0]) return rowToThresholds(rows[0]);
  }
  return {
    thresholds: { ...DEFAULT_PROBABILITY_THRESHOLDS },
    source: "Default thresholds (illustrative; editable)",
    asOf: null,
    notes: null,
    updatedAt: null,
  };
}

/**
 * Save (upsert) the global probability thresholds. VALIDATED first (both in
 * [1,99], high strictly greater than low); a non-conforming pair is REJECTED and
 * never written. Provenance recorded alongside.
 */
export async function saveProbabilityThresholds(args: {
  thresholds: ProbabilityThresholds;
  source?: string | null;
  asOf?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; errors: string[] }> {
  const validation = validateProbabilityThresholds(args.thresholds);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  const db = await getDb();
  if (!db) return { ok: false, errors: ["Database unavailable."] };

  const thresholds = {
    highPct: Number(args.thresholds.highPct),
    lowPct: Number(args.thresholds.lowPct),
  };
  const asOfDate = parseAsOfDate(args.asOf);

  const existing = await db
    .select({ id: allocationProbabilityThresholds.id })
    .from(allocationProbabilityThresholds)
    .where(eq(allocationProbabilityThresholds.singletonKey, PROBABILITY_THRESHOLDS_KEY))
    .limit(1);

  if (existing[0]) {
    await db
      .update(allocationProbabilityThresholds)
      .set({ thresholds, source: args.source ?? null, asOfDate, notes: args.notes ?? null })
      .where(eq(allocationProbabilityThresholds.singletonKey, PROBABILITY_THRESHOLDS_KEY));
  } else {
    await db.insert(allocationProbabilityThresholds).values({
      singletonKey: PROBABILITY_THRESHOLDS_KEY,
      thresholds,
      source: args.source ?? null,
      asOfDate,
      notes: args.notes ?? null,
    });
  }
  return { ok: true, errors: [] };
}


/* ── Round 81: Research pipeline governance — pending updates + source registry ──
 *
 * These helpers implement the pending-change queue and the typed promotion. The
 * ONLY way an AI/scrape/manual proposal becomes a live catalogue figure is:
 *   enqueueResearchUpdate(...)  → status "pending"
 *   reviewResearchUpdate({ approve })  → buildPromotionPlan → write to the matching
 *                                        catalogue table → status "approved"
 * Rejection changes nothing in the catalogues. This keeps every catalogue change
 * human-approved, sourced, and reversible on paper (the pending row is retained).
 */

import {
  researchUpdates,
  sourceRegistry,
  researchTasks,
  researchFindings,
  researchThreads,
  researchMessages,
  catalogueAuditLog,
  mmfRateHistory,
  cbkRateHistory,
  bankProductRateHistory,
  referenceRowMeta,
  type ResearchUpdate,
  type InsertResearchUpdate,
  type SourceRegistryRow,
  type InsertSourceRegistry,
  type ResearchTask,
  type InsertResearchTask,
  type ResearchFinding,
  type InsertResearchFinding,
  type ResearchThread,
  type InsertResearchThread,
  type ResearchMessage,
  type InsertResearchMessage,
  type CatalogueAuditLog,
  type InsertCatalogueAuditLog,
  type ReferenceRowMeta,
} from "../drizzle/schema";
import {
  validatePendingUpdate,
  buildPromotionPlan,
  sourceDueStatus,
  checkApprovalGate,
  catalogueForAssetClass,
  catalogueLabel,
  describePortfolioImpact,
  agentCheckDue,
  type PendingUpdateInput,
  type SourceDueStatus,
  type ReferenceCatalogue,
} from "../shared/researchPipeline";
import { type AssetClass } from "../shared/assetModel";
import { humanField } from "../shared/provenance";
// NOTE: summariseState, FieldProvenanceMap, and FieldKey are already imported at
// the top of this file (used by the opportunity ingestion helpers).

/**
 * Enqueue a proposed pending update. Validates through the shared governance rules
 * and ALWAYS lands as status "pending" — no origin (ai/scrape/manual) may be born
 * approved. Returns the created row id, or throws with the validation errors.
 */
export async function enqueueResearchUpdate(input: PendingUpdateInput): Promise<number | null> {
  const v = validatePendingUpdate(input);
  if (!v.ok || !v.target || !v.assetClass) {
    throw new Error(`Invalid research update: ${v.errors.join(" ")}`);
  }
  const db = await getDb();
  if (!db) return null;
  const row: InsertResearchUpdate = {
    target: v.target,
    targetRef: input.targetRef ?? null,
    changeKind: input.changeKind,
    name: input.name.trim(),
    assetClass: v.assetClass,
    issuer: input.issuer ?? null,
    currency: (input.currency ?? "KES").trim() || "KES",
    figures: input.figures ?? {},
    source: input.source.trim(),
    sourceUrl: input.sourceUrl ?? null,
    asOf: input.asOf ?? null,
    origin: input.origin,
    aiModel: input.aiModel ?? null,
    sourceKey: input.sourceKey ?? null,
    status: "pending", // invariant: always pending on creation
    // Round 82/88 — carry the single-field EDIT detail + finding linkage so the
    // review queue and the audit trail can show old → (proposed) new on the figure.
    findingId: input.findingId ?? null,
    field: input.field ?? null,
    oldValue: input.oldValue ?? null,
    managerValue: input.managerValue ?? null,
  };
  const res = await db.insert(researchUpdates).values(row);
  return extractInsertId(res);
}

/**
 * Pull the auto-increment id out of a mysql2/drizzle insert result. Depending on
 * driver version the OkPacket is either the result itself or its first element
 * (`res[0]`), so we check both. Returns null when neither carries an insertId.
 */
export function extractInsertId(res: unknown): number | null {
  const header =
    (Array.isArray(res) ? (res[0] as { insertId?: number } | undefined) : (res as { insertId?: number } | undefined)) ??
    undefined;
  const id = header?.insertId;
  return typeof id === "number" && id > 0 ? id : null;
}

/** List research updates (newest first), optionally filtered by status/target. */
export async function listResearchUpdates(filter?: {
  status?: "pending" | "approved" | "rejected";
  target?: "mmf" | "bank" | "opportunity";
}): Promise<ResearchUpdate[]> {
  const db = await getDb();
  if (!db) return [];
  const clauses = [] as ReturnType<typeof eq>[];
  if (filter?.status) clauses.push(eq(researchUpdates.status, filter.status));
  if (filter?.target) clauses.push(eq(researchUpdates.target, filter.target));
  const base = db.select().from(researchUpdates);
  const q = clauses.length ? base.where(and(...clauses)) : base;
  return q.orderBy(desc(researchUpdates.createdAt));
}

/** Count pending updates (for the Research Desk badge/digest). */
export async function countPendingResearchUpdates(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(researchUpdates)
    .where(eq(researchUpdates.status, "pending"));
  return Number(rows[0]?.n ?? 0);
}

/** Fetch a single research update by id. */
export async function getResearchUpdate(id: number): Promise<ResearchUpdate | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(researchUpdates).where(eq(researchUpdates.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Build a human-entered per-figure provenance map for a promoted opportunity row. */
function promotionProvenance(args: {
  fields: Partial<Record<FieldKey, number | string | null>>;
  source: string;
  sourceUrl?: string | null;
  asOf?: number | null;
  by: string;
  at: number;
}): FieldProvenanceMap {
  const map: FieldProvenanceMap = {};
  for (const [k, v] of Object.entries(args.fields)) {
    if (v === null || v === undefined || v === "") continue;
    map[k as FieldKey] = humanField({
      value: String(v),
      source: args.source,
      sourceUrl: args.sourceUrl ?? null,
      asOf: args.asOf ?? null,
      by: args.by,
      at: args.at,
    });
  }
  return map;
}

/**
 * Review a pending research update. When `approve` is true, performs the typed
 * promotion into the matching catalogue table (mmf_funds | bank_instruments |
 * opportunities) using the shared `buildPromotionPlan`, then marks the update
 * "approved". When false, marks it "rejected" and changes NOTHING in the
 * catalogues. The promoted opportunity carries human_entered provenance (the
 * approver vouches for the figures), satisfying the human-attention invariant.
 *
 * Returns the updated row + the ref/identity that was written (for invalidation).
 */
export async function reviewResearchUpdate(args: {
  id: number;
  approve: boolean;
  reviewedBy: string;
  reviewNote?: string | null;
  /**
   * Round 82 — an explicit manager-vouched value supplied at approval time. When
   * present it satisfies the catalogue approval gate for the catalogue's primary
   * figure and is injected into the promoted figures (the manager takes
   * responsibility for the number). Ignored on reject.
   */
  managerValue?: string | number | null;
  /**
   * Round 82 — override the gate entirely (manager explicitly accepts an
   * incomplete row). Auditable via the review note.
   */
  overrideGate?: boolean;
}): Promise<{
  update: ResearchUpdate | null;
  promotedRef: string | null;
  target: string | null;
  /** Round 82 — present when approval was blocked by the gate (no catalogue change). */
  blocked?: { missing: string[]; reason: string };
}> {
  const db = await getDb();
  if (!db) return { update: null, promotedRef: null, target: null };
  const current = await getResearchUpdate(args.id);
  if (!current) return { update: null, promotedRef: null, target: null };
  if (current.status !== "pending" && current.status !== "conflict") {
    // Idempotent: an already-resolved update is returned unchanged.
    return { update: current, promotedRef: current.targetRef ?? null, target: current.target };
  }

  const now = Date.now();

  if (!args.approve) {
    await db
      .update(researchUpdates)
      .set({ status: "rejected", reviewedBy: args.reviewedBy, reviewedAt: now, reviewNote: args.reviewNote ?? null })
      .where(eq(researchUpdates.id, args.id));
    return { update: await getResearchUpdate(args.id), promotedRef: null, target: current.target };
  }

  // ── Round 82: catalogue approval gate ──
  // A `create` must carry every required figure for its catalogue unless the
  // manager supplies an override value (or explicitly overrides the gate). A
  // blocked approval changes NOTHING and stays pending, surfacing the gap.
  const figuresIn: Record<string, unknown> = {
    ...((current.figures as Record<string, unknown> | null) ?? {}),
  };
  const gate = checkApprovalGate({
    assetClass: current.assetClass as AssetClass,
    changeKind: current.changeKind,
    figures: figuresIn,
    name: current.name,
    issuer: current.issuer,
    currency: current.currency,
    source: current.source,
    asOf: current.asOf,
    managerValue: args.managerValue ?? null,
  });
  if (!gate.ok && !args.overrideGate) {
    return {
      update: current,
      promotedRef: current.targetRef ?? null,
      target: current.target,
      blocked: { missing: gate.missing, reason: gate.reason ?? "Incomplete for its catalogue." },
    };
  }

  // If a manager override value was supplied, inject it into the promoted figures
  // for the catalogue's primary figure key (and the update's declared `field`).
  const cat: ReferenceCatalogue = catalogueForAssetClass(current.assetClass as AssetClass);
  const primaryKey = { mmf: "ear", bank: "indicativeRate", cbk: "yieldPct", market_asset: "lastPrice" }[cat];
  const hasOverride =
    args.managerValue !== undefined && args.managerValue !== null && String(args.managerValue).trim() !== "";
  if (hasOverride) {
    figuresIn[primaryKey] = String(args.managerValue);
    if (current.field && current.field !== primaryKey) figuresIn[current.field] = String(args.managerValue);
  }

  // ── APPROVE → typed promotion ──
  const plan = buildPromotionPlan({
    target: current.target,
    targetRef: current.targetRef,
    name: current.name,
    assetClass: current.assetClass,
    issuer: current.issuer,
    currency: current.currency,
    figures: figuresIn,
    source: current.source,
  });

  let promotedRef: string | null = current.targetRef ?? null;
  // Round 83 — remember the promoted catalogue row so we can (a) VERIFY it exists
  // after promotion (no fake audit) and (b) append the date-effective rate-history.
  let promotedMmfId: number | null = null;
  let promotedBankId: number | null = null;
  const effectiveAt = current.asOf && Number(current.asOf) > 0 ? Number(current.asOf) : now;

  if (plan.target === "mmf") {
    const p = plan.payload;
    // Find an existing fund by name to edit, else insert.
    const existing = await db
      .select({ id: mmfFunds.id })
      .from(mmfFunds)
      .where(eq(mmfFunds.fundName, p.fundName))
      .limit(1);
    const values = {
      fundName: p.fundName,
      company: p.company,
      grossYield: String(p.grossYield ?? p.ear ?? 0),
      ear: String(p.ear ?? p.grossYield ?? 0),
      ...(p.managementFee != null ? { managementFee: String(p.managementFee) } : {}),
      ...(p.minInvestment != null ? { minInvestment: String(p.minInvestment) } : {}),
      source: p.source,
      isActive: true as const,
    };
    // Round 97 — persist extendedFields from structured extraction if present.
    const mmfExtRaw = figuresIn._extendedFields;
    if (mmfExtRaw) {
      const mmfExtended = typeof mmfExtRaw === "string" ? JSON.parse(mmfExtRaw) : mmfExtRaw;
      (values as Record<string, unknown>).extendedFields = mmfExtended;
    }
    if (existing[0]) {
      await db.update(mmfFunds).set(values).where(eq(mmfFunds.id, existing[0].id));
      promotedMmfId = existing[0].id;
    } else {
      await db.insert(mmfFunds).values(values);
    }
    promotedRef = p.fundName;
  } else if (plan.target === "bank") {
    const p = plan.payload;
    // Round 90 — resolve the exact product being edited via the stable `bank:<id>`
    // ref (falling back to a legacy bank-name lookup) so an edit updates ONLY that
    // product, never a namesake at the same bank.
    const resolvedBank = current.targetRef ? await resolveBankRef(current.targetRef) : null;
    const existing = resolvedBank ? [{ id: resolvedBank.id }] : [];
    const values = {
      bankName: p.bankName,
      instrumentType: (p.instrumentType ?? "fixed_deposit") as
        | "call_deposit" | "fixed_deposit" | "ordinary_savings" | "target_savings" | "tiered_savings",
      ...(p.minAmount != null ? { minAmount: String(p.minAmount) } : {}),
      typicalTenor: p.typicalTenor,
      ...(p.indicativeRate != null ? { indicativeRate: String(p.indicativeRate) } : {}),
      isNegotiable: p.isNegotiable,
      notes: p.notes,
      source: p.source,
      isActive: true as const,
    };
    // Round 97 — persist extendedFields from structured extraction if present.
    const bankExtRaw = figuresIn._extendedFields;
    if (bankExtRaw) {
      const bankExtended = typeof bankExtRaw === "string" ? JSON.parse(bankExtRaw) : bankExtRaw;
      (values as Record<string, unknown>).extendedFields = bankExtended;
    }
    if (existing[0]) {
      await db.update(bankInstruments).set(values).where(eq(bankInstruments.id, existing[0].id));
      promotedBankId = existing[0].id;
    } else {
      const insertRes = await db.insert(bankInstruments).values(values);
      promotedBankId = extractInsertId(insertRes);
    }
    // The catalogue row's stable identity is `bank:<id>` — audit + lifecycle key off it.
    promotedRef = promotedBankId != null ? `bank:${promotedBankId}` : p.bankName;
  } else {
    // opportunity — write through the same upsert-by-ref path, with human_entered provenance.
    const p = plan.payload;
    const prov = promotionProvenance({
      fields: {
        yield: p.yieldPct,
        price: p.lastPrice,
        trailingReturn: p.trailingReturnPct,
        tenor: p.tenorYears,
        maturity: p.maturityDate,
        expense: p.expenseRatioPct,
      },
      source: p.source,
      sourceUrl: current.sourceUrl,
      asOf: current.asOf,
      by: args.reviewedBy,
      at: now,
    });
    const insert = {
      ref: p.ref,
      name: p.name,
      assetClass: p.assetClass,
      issuer: p.issuer,
      currency: p.currency,
      market: p.market,
      yieldPct: p.yieldPct != null ? String(p.yieldPct) : null,
      yieldKind: p.yieldKind,
      lastPrice: p.lastPrice != null ? String(p.lastPrice) : null,
      trailingReturnPct: p.trailingReturnPct != null ? String(p.trailingReturnPct) : null,
      tenorYears: p.tenorYears != null ? String(p.tenorYears) : null,
      maturityDate: p.maturityDate,
      expenseRatioPct: p.expenseRatioPct != null ? String(p.expenseRatioPct) : null,
      liquidity: p.liquidity,
      factNote: p.factNote,
      dataSource: p.source,
      dataAsOf: current.asOf ? new Date(current.asOf) : null,
      unverified: false, // a human approved these figures
      fieldProvenance: prov,
      verificationState: summariseState(prov),
      active: true as const,
    } as unknown as InsertOpportunity;
    // Round 97 — persist extendedFields from structured extraction if present.
    const oppExtRaw = figuresIn._extendedFields;
    if (oppExtRaw) {
      const oppExtended = typeof oppExtRaw === "string" ? JSON.parse(oppExtRaw) : oppExtRaw;
      (insert as Record<string, unknown>).extendedFields = oppExtended;
    }
    await upsertOpportunity(insert);
    promotedRef = p.ref;
  }

  // ── Round 83: POST-PROMOTION VERIFICATION (no fake audit) ──
  // Confirm the catalogue row actually exists after promotion. If it does not, the
  // approval did NOT publish: leave the update pending and return the error rather
  // than writing an "approved" audit entry that points at nothing.
  const published = await verifyCataloguePublished(cat, promotedRef);
  if (!published) {
    // Ensure the update is still pending (it never left pending here, but be explicit).
    await db
      .update(researchUpdates)
      .set({ status: "pending" })
      .where(eq(researchUpdates.id, args.id));
    return {
      update: await getResearchUpdate(args.id),
      promotedRef: null,
      target: current.target,
      blocked: {
        missing: [],
        reason: `Promotion into ${catalogueLabel(cat)} could not be verified — the catalogue row was not found after write. The update stays pending; nothing was published.`,
      },
    };
  }

  await db
    .update(researchUpdates)
    .set({
      status: "approved",
      reviewedBy: args.reviewedBy,
      reviewedAt: now,
      reviewNote: args.reviewNote ?? null,
      targetRef: promotedRef,
      ...(hasOverride ? { managerValue: String(args.managerValue) } : {}),
    })
    .where(eq(researchUpdates.id, args.id));

  // ── Round 83: DATE-EFFECTIVE RATE HISTORY ──
  // Record the approved rate with an effective date so future accrual/projection
  // reads the rate that applied from `effectiveAt` forward, and past accrual is
  // never restated. Reference-only; holds no per-holding money.
  try {
    if (plan.target === "mmf") {
      const p = plan.payload;
      const fundId = promotedMmfId ?? (await db.select({ id: mmfFunds.id }).from(mmfFunds).where(eq(mmfFunds.fundName, p.fundName)).limit(1))[0]?.id ?? 0;
      await db.insert(mmfRateHistory).values({
        mmfFundId: fundId,
        fundName: p.fundName,
        grossYield: p.grossYield != null ? String(p.grossYield) : (p.ear != null ? String(p.ear) : null),
        ear: p.ear != null ? String(p.ear) : (p.grossYield != null ? String(p.grossYield) : null),
        managementFee: p.managementFee != null ? String(p.managementFee) : null,
        effectiveAt,
        source: p.source,
        sourceUrl: current.sourceUrl ?? null,
        researchUpdateId: current.id,
        approvedBy: args.reviewedBy,
      });
    } else if (plan.target === "bank") {
      const p = plan.payload;
      if (p.indicativeRate != null) {
        const instId = promotedBankId ?? (await db.select({ id: bankInstruments.id }).from(bankInstruments).where(eq(bankInstruments.bankName, p.bankName)).limit(1))[0]?.id ?? 0;
        await db.insert(bankProductRateHistory).values({
          bankInstrumentId: instId,
          bankName: p.bankName,
          instrumentType: p.instrumentType ?? null,
          indicativeRate: String(p.indicativeRate),
          effectiveAt,
          source: p.source,
          sourceUrl: current.sourceUrl ?? null,
          researchUpdateId: current.id,
          approvedBy: args.reviewedBy,
        });
      }
    } else if (cat === "cbk") {
      const p = plan.payload as { ref: string; name: string; yieldPct: number | null; yieldKind: string | null };
      if (p.yieldPct != null) {
        await db.insert(cbkRateHistory).values({
          opportunityRef: p.ref,
          instrumentName: p.name,
          securityType: cbkSecurityTypeFor(current.assetClass, figuresIn),
          yieldPct: String(p.yieldPct),
          yieldKind: p.yieldKind ?? null,
          effectiveAt,
          source: current.source,
          sourceUrl: current.sourceUrl ?? null,
          researchUpdateId: current.id,
          approvedBy: args.reviewedBy,
        });
      }
    }
  } catch (err) {
    // Rate-history is additive bookkeeping; a failure here must never unpublish an
    // already-verified catalogue row. Log and continue.
    console.error("[reviewResearchUpdate] rate-history write failed:", (err as Error).message);
  }

  // ── Round 82: immutable catalogue audit-log entry ("Recently Approved") ──
  // The audit catalogue speaks the four manager-facing catalogues (cbk/market_asset
  // split), NOT the db promotion vocabulary (opportunity), so map via asset class.
  const auditCatalogue = catalogueForAssetClass(current.assetClass as AssetClass);
  // Resolve the originating research task via the linked finding, if any.
  let researchTaskId: number | null = null;
  if (current.findingId != null) {
    const f = await getResearchFinding(current.findingId);
    researchTaskId = f?.taskId ?? null;
  }
  const newValue =
    hasOverride
      ? String(args.managerValue)
      : current.field
        ? cleanAuditValue(figuresIn[current.field])
        : null;
  await insertCatalogueAuditLog({
    catalogue: auditCatalogue,
    targetRef: promotedRef,
    instrumentName: current.name,
    changeKind: current.changeKind,
    field: current.field ?? null,
    oldValue: current.oldValue ?? null,
    newValue,
    source: current.source,
    sourceUrl: current.sourceUrl ?? null,
    researchUpdateId: current.id,
    researchTaskId,
    approvedBy: args.reviewedBy,
    approvedAt: now,
    note: args.reviewNote ?? null,
  });

  // If this update was drafted from a finding, close the loop on that finding.
  if (current.findingId != null) {
    await updateFindingStatus(current.findingId, "drafted", {
      reviewedBy: args.reviewedBy,
      draftedUpdateId: current.id,
    });
  }

  return { update: await getResearchUpdate(args.id), promotedRef, target: current.target };
}

/** Coerce a figures-bag value into a short audit string (<=300 chars), or null. */
function cleanAuditValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s.slice(0, 300);
}

/**
 * Round 83 — POST-PROMOTION VERIFICATION. Confirm that an approved update actually
 * produced a live catalogue row before the update is marked approved. Returns true
 * only if the expected row exists in the catalogue the asset class maps to. Used to
 * prevent a "fake audit" — an approved entry that points at a row that was never
 * written.
 */
export async function verifyCataloguePublished(
  catalogue: ReferenceCatalogue,
  ref: string | null,
): Promise<boolean> {
  const db = await getDb();
  if (!db || !ref) return false;
  if (catalogue === "mmf") {
    const r = await db.select({ id: mmfFunds.id }).from(mmfFunds).where(eq(mmfFunds.fundName, ref)).limit(1);
    return r.length > 0;
  }
  if (catalogue === "bank") {
    // Accept a stable `bank:<id>` ref or a legacy bank name.
    const resolved = await resolveBankRef(ref);
    return resolved != null;
  }
  // cbk + market_asset both live in the opportunities catalogue, keyed by ref.
  const r = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.ref, ref)).limit(1);
  return r.length > 0;
}

/** Infer a CBK security-family token for rate-history from asset class + figures. */
function cbkSecurityTypeFor(assetClass: string, figures: Record<string, unknown>): string | null {
  const explicit = figures.securityType ?? figures.instrumentType ?? figures.type;
  if (explicit != null && String(explicit).trim() !== "") return String(explicit).trim().slice(0, 48);
  if (assetClass === "gov_discount") return "tbill";
  if (assetClass === "gov_coupon") return "bond";
  return null;
}

/* ── Source registry ────────────────────────────────────────────────────────── */

/** List registered sources (active first, then by label). */
export async function listSources(includeInactive = false): Promise<SourceRegistryRow[]> {
  const db = await getDb();
  if (!db) return [];
  const base = db.select().from(sourceRegistry);
  const rows = includeInactive
    ? await base.orderBy(desc(sourceRegistry.active), sourceRegistry.label)
    : await base.where(eq(sourceRegistry.active, true)).orderBy(sourceRegistry.label);
  return rows;
}

/** Create or update a source by key (maintainer authoring). */
export async function upsertSource(input: InsertSourceRegistry): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select({ id: sourceRegistry.id })
    .from(sourceRegistry)
    .where(eq(sourceRegistry.key, input.key))
    .limit(1);
  if (existing[0]) {
    await db.update(sourceRegistry).set(input).where(eq(sourceRegistry.key, input.key));
  } else {
    await db.insert(sourceRegistry).values(input);
  }
}

/** Mark a source reviewed now (resets its cadence clock). */
export async function markSourceReviewed(key: string, by: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(sourceRegistry)
    .set({ lastReviewedAt: Date.now(), lastReviewedBy: by })
    .where(eq(sourceRegistry.key, key));
}

/** Compute cadence/due status for every active source (for the daily digest). */
export async function sourceDueList(now = Date.now()): Promise<SourceDueStatus[]> {
  const rows = await listSources(false);
  return rows.map((r) =>
    sourceDueStatus(
      {
        key: r.key,
        label: r.label,
        cadenceDays: r.cadenceDays,
        lastReviewedAt: r.lastReviewedAt ?? null,
        active: r.active,
      },
      now,
    ),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * Round 82 — AI-assisted manager workbench DB helpers.
 *
 * These helpers persist the enquiry → finding → draft → approve trail, the
 * immutable catalogue audit log, the read-only federated universe (approved
 * facts across all four catalogues), and the scheduled agent's source clock.
 *
 * INVARIANTS (enforced here + in shared/researchPipeline):
 *   - A research_task/finding NEVER writes a catalogue; findings are drafts only.
 *   - A finding becomes a catalogue change ONLY via a pending research_update that
 *     a manager approves (reviewResearchUpdate), which writes the audit row.
 *   - The scheduled agent NEVER publishes; it only enqueues pending updates and
 *     updates the source clock/freshness.
 * ══════════════════════════════════════════════════════════════════════════ */

/* ── Research tasks (Ask-AI enquiries) ──────────────────────────────────────── */

/** Create a research task (an enquiry). Returns the new id, or null when DB-less. */
export async function createResearchTask(input: InsertResearchTask): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const res = await db.insert(researchTasks).values(input);
  return extractInsertId(res);
}

/** Mark a task done/error and record the AI answer + finding count. */
export async function completeResearchTask(
  id: number,
  patch: {
    answerSummary?: string | null;
    aiModel?: string | null;
    findingCount?: number;
    error?: string | null;
    /** Round 91 — explicit terminal status. Defaults to done, or error/failed when
     * `error` is set. Pass "needs_source_fix" when the SOURCE (not the engine) failed. */
    status?: "done" | "error" | "failed" | "needs_source_fix";
    /** Round 91 — the terminal stage to record (mirrors status for the UI machine). */
    stage?: "done" | "failed" | "needs_source_fix";
    /** Round 91 — the SourceReadResult JSON to persist for the source-status panel. */
    sourceStatus?: unknown;
  },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const status = patch.status ?? (patch.error ? "error" : "done");
  const stage = patch.stage ?? (status === "done" ? "done" : status === "needs_source_fix" ? "needs_source_fix" : "failed");
  await db
    .update(researchTasks)
    .set({
      status,
      stage,
      answerSummary: patch.answerSummary ?? null,
      aiModel: patch.aiModel ?? null,
      findingCount: patch.findingCount ?? 0,
      error: patch.error ?? null,
      ...(patch.sourceStatus !== undefined ? { sourceStatus: patch.sourceStatus as never } : {}),
      completedAt: Date.now(),
    })
    .where(eq(researchTasks.id, id));
}

/**
 * Round 91 — advance a task's live STAGE (queued → reading_source → asking_ai →
 * extracting) while it is still running, so the client's poll shows real progress.
 * Optionally records the SourceReadResult JSON alongside the stage bump. Does NOT set
 * a terminal status — use completeResearchTask for that.
 */
export async function setResearchTaskStage(
  id: number,
  stage: "queued" | "reading_source" | "asking_ai" | "extracting",
  patch?: { sourceStatus?: unknown },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(researchTasks)
    .set({
      stage,
      status: "running",
      ...(patch?.sourceStatus !== undefined ? { sourceStatus: patch.sourceStatus as never } : {}),
    })
    .where(eq(researchTasks.id, id));
}

/** Fetch a single task by id. */
export async function getResearchTask(id: number): Promise<ResearchTask | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(researchTasks).where(eq(researchTasks.id, id)).limit(1);
  return rows[0] ?? null;
}

/** List recent tasks (newest first), capped. */
export async function listResearchTasks(limit = 50): Promise<ResearchTask[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(researchTasks).orderBy(desc(researchTasks.createdAt)).limit(limit);
}

/**
 * Batch-fetch just the `sourceStatus` column for a set of task ids — the read-only
 * lookup the Ask AI "sources used" panel needs so `getThread` can tell a manager
 * whether a source was actually READ (not merely attached) without a schema change
 * or a per-message round trip. Read-only; never called from a mutation path.
 */
export async function getResearchTasksSourceStatus(taskIds: number[]): Promise<Map<number, unknown>> {
  const db = await getDb();
  if (!db || taskIds.length === 0) return new Map();
  const rows = await db
    .select({ id: researchTasks.id, sourceStatus: researchTasks.sourceStatus })
    .from(researchTasks)
    .where(inArray(researchTasks.id, taskIds));
  return new Map(rows.map((r) => [r.id, r.sourceStatus]));
}

/* ── Research findings (AI draft facts awaiting manager triage) ─────────────── */

/** Insert a batch of findings (from findingsToRows). No-op on empty. */
export async function insertResearchFindings(rows: InsertResearchFinding[]): Promise<void> {
  const db = await getDb();
  if (!db || rows.length === 0) return;
  await db.insert(researchFindings).values(rows);
}

/** Fetch a single finding by id. */
export async function getResearchFinding(id: number): Promise<ResearchFinding | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(researchFindings).where(eq(researchFindings.id, id)).limit(1);
  return rows[0] ?? null;
}

/** List findings (newest first), optionally filtered by task, thread and/or triage status. */
export async function listResearchFindings(filter?: {
  taskId?: number;
  threadId?: number;
  status?: "new" | "drafted" | "dismissed" | "superseded";
}): Promise<ResearchFinding[]> {
  const db = await getDb();
  if (!db) return [];
  const clauses = [] as ReturnType<typeof eq>[];
  if (filter?.taskId != null) clauses.push(eq(researchFindings.taskId, filter.taskId));
  if (filter?.threadId != null) clauses.push(eq(researchFindings.threadId, filter.threadId));
  if (filter?.status) clauses.push(eq(researchFindings.status, filter.status));
  const base = db.select().from(researchFindings);
  const q = clauses.length ? base.where(and(...clauses)) : base;
  return q.orderBy(desc(researchFindings.createdAt));
}

/** Count findings still in the "new" (untriaged) state — for the inbox badge. */
export async function countNewFindings(): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db
    .select({ n: sql<number>`count(*)` })
    .from(researchFindings)
    .where(eq(researchFindings.status, "new"));
  return Number(rows[0]?.n ?? 0);
}

/** Update a finding's triage status (drafted → links its pending update; dismissed; superseded). */
export async function updateFindingStatus(
  id: number,
  status: "new" | "drafted" | "dismissed" | "superseded",
  patch?: { reviewedBy?: string | null; draftedUpdateId?: number | null },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(researchFindings)
    .set({
      status,
      reviewedBy: patch?.reviewedBy ?? null,
      reviewedAt: Date.now(),
      ...(patch?.draftedUpdateId != null ? { draftedUpdateId: patch.draftedUpdateId } : {}),
    })
    .where(eq(researchFindings.id, id));
}

/* ── Round 88 — Research THREADS + MESSAGES (the enquiry conversation) ──────────
 * A thread groups an opening question and its follow-ups. Each turn is a message;
 * each AI answer still spawns its own research_task + findings (traceability). No
 * catalogue figure ever lives here — this is the transcript + prior-context store.
 */

/** Create a new enquiry thread. Returns the new id (or null when DB-less). */
export async function createResearchThread(input: InsertResearchThread): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const res = await db.insert(researchThreads).values(input);
  return extractInsertId(res);
}

/** Fetch a single thread by id. */
export async function getResearchThread(id: number): Promise<ResearchThread | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(researchThreads).where(eq(researchThreads.id, id)).limit(1);
  return rows[0] ?? null;
}

/** List enquiry threads (most-recently-updated first), excluding archived by default. */
export async function listResearchThreads(opts?: { includeArchived?: boolean; limit?: number }): Promise<ResearchThread[]> {
  const db = await getDb();
  if (!db) return [];
  const base = db.select().from(researchThreads);
  const q = opts?.includeArchived ? base : base.where(eq(researchThreads.archived, false));
  return q.orderBy(desc(researchThreads.updatedAt)).limit(opts?.limit ?? 50);
}

/** Touch a thread's updatedAt (called after each new turn) and optionally archive it. */
export async function touchResearchThread(id: number, patch?: { archived?: boolean }): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(researchThreads)
    .set({ updatedAt: new Date(), ...(patch?.archived != null ? { archived: patch.archived } : {}) })
    .where(eq(researchThreads.id, id));
}

/** Insert one transcript message. Returns the new id. */
export async function insertResearchMessage(input: InsertResearchMessage): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const res = await db.insert(researchMessages).values(input);
  return extractInsertId(res);
}

/** List a thread's messages in chronological order (id asc == created order). */
export async function listResearchMessages(threadId: number): Promise<ResearchMessage[]> {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(researchMessages)
    .where(eq(researchMessages.threadId, threadId))
    .orderBy(asc(researchMessages.id));
}

/**
 * Round 88 — VERSIONED FINDING CORRECTION. A manager edits one extracted figure on
 * a finding. We do NOT mutate the original: we write a NEW finding row (the
 * corrected version) carrying the edited figures, link the two (old.supersededById
 * → new, new.supersedesId → old, old.status → 'superseded'), and — crucially —
 * draft a PENDING research_update (a governed catalogue-edit proposal) so the
 * correction flows through the normal review queue with old → new + reason +
 * source. Nothing touches a live catalogue here; only an approval does. Returns the
 * new finding id + the drafted update id.
 */
export async function correctResearchFinding(args: {
  findingId: number;
  field: string;
  newValue: string;
  reason: string;
  by: string;
  byName?: string | null;
  /**
   * A manager-cited source for THIS corrected value, first-class alongside an AI-found
   * one (never inherited silently when supplied). When omitted, the correction reuses
   * the original finding's source — the "same document, mis-read figure" case. When the
   * original finding has NO source, one of these must be supplied (enforced below), so
   * every field — AI-found or manager-entered — always carries a source + as-of.
   */
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  /** ISO date (yyyy-mm-dd) the manager's value is as-of. */
  sourceAsOf?: string | null;
}): Promise<{ newFindingId: number | null; updateId: number | null } | { error: string }> {
  const db = await getDb();
  if (!db) return { newFindingId: null, updateId: null };

  const original = await getResearchFinding(args.findingId);
  if (!original) return { error: "Finding not found." };
  if (original.status === "superseded" || original.supersededById != null) {
    return { error: "This finding has already been corrected; correct its latest version instead." };
  }
  const field = args.field.trim();
  const newValue = args.newValue.trim();
  const reason = args.reason.trim();
  if (field === "") return { error: "A field to correct is required." };
  if (newValue === "") return { error: "A corrected value is required." };
  if (reason === "") return { error: "A plain-English reason for the correction is required." };

  // A manager-cited source for THIS value, if supplied.
  const managerSourceLabel = args.sourceLabel?.trim() || null;
  const managerSourceUrl = args.sourceUrl?.trim() || null;
  const managerAsOfMs =
    args.sourceAsOf && Number.isFinite(Date.parse(args.sourceAsOf)) ? Date.parse(args.sourceAsOf) : null;

  const hadOriginalSource = Boolean(original.sourceLabel || original.sourceUrl);
  if (!hadOriginalSource && !managerSourceLabel && !managerSourceUrl) {
    return {
      error:
        "The original finding has no source. Provide a source for your corrected value — every figure, AI-found or manager-entered, must carry one.",
    };
  }

  // Resolved provenance for the corrected value: the manager's own source when supplied,
  // else the original's (same source, a mis-read figure).
  const resolvedSourceLabel = managerSourceLabel ?? original.sourceLabel;
  const resolvedSourceUrl = managerSourceUrl ?? original.sourceUrl;
  const resolvedAsOf = managerAsOfMs ?? original.sourceAsOf ?? null;

  const oldFigures = (original.extractedFields ?? {}) as Record<string, unknown>;
  const oldValueRaw = oldFigures[field];
  const oldValue = oldValueRaw === undefined || oldValueRaw === null ? null : String(oldValueRaw);
  const nextFigures: Record<string, unknown> = { ...oldFigures, [field]: newValue };

  const now = Date.now();

  // 1) Write the corrected version as a NEW finding row (status 'new' so it can be
  //    triaged like any other, but carrying the correction provenance + a back-link).
  const correctedRow: InsertResearchFinding = {
    taskId: original.taskId,
    threadId: original.threadId ?? null,
    instrumentName: original.instrumentName,
    issuer: original.issuer,
    assetClass: original.assetClass,
    targetCatalogue: original.targetCatalogue,
    currency: original.currency,
    extractedFields: nextFigures,
    sourceLabel: resolvedSourceLabel,
    sourceUrl: resolvedSourceUrl,
    sourceAsOf: resolvedAsOf,
    checkedAt: now,
    // A manager-vouched correction is at least as certain as the original.
    confidence: original.confidence,
    missingFields: original.missingFields,
    warnings: original.warnings,
    rawExcerpt: original.rawExcerpt,
    status: "new",
    supersedesId: original.id,
    correctedBy: args.by,
    correctedAt: now,
    correctionReason: reason,
  };
  const insertRes = await db.insert(researchFindings).values(correctedRow);
  const newFindingId = extractInsertId(insertRes);

  // 2) Point the original at its successor and mark it superseded (never deleted).
  await db
    .update(researchFindings)
    .set({ status: "superseded", supersededById: newFindingId, reviewedBy: args.by, reviewedAt: now })
    .where(eq(researchFindings.id, original.id));

  // 3) Draft a governed PENDING update so the correction goes through review with
  //    old → new + reason + source. This is an EDIT to the target catalogue row.
  //    Source of record: the manager's own citation when supplied, else the finding's
  //    original source — matching what was just written onto the corrected finding row.
  const source = (resolvedSourceLabel ?? "Manager correction").slice(0, 300);
  let updateId: number | null = null;
  try {
    updateId = await enqueueResearchUpdate({
      changeKind: "edit",
      targetRef: original.instrumentName,
      name: original.instrumentName,
      assetClass: original.assetClass ?? "alt",
      issuer: original.issuer,
      currency: original.currency,
      figures: { [field]: newValue },
      source,
      sourceUrl: resolvedSourceUrl,
      asOf: resolvedAsOf,
      origin: "manual",
      findingId: newFindingId,
      field,
      oldValue,
      managerValue: newValue,
    });
  } catch (err) {
    // If the governed enqueue rejects (e.g. an edit lacking a targetRef), surface it
    // but keep the versioned finding — the correction chain is still recorded.
    return { error: `Correction recorded, but could not draft a review item: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 4) Close the loop: the corrected finding is now 'drafted' to that update.
  if (newFindingId != null && updateId != null) {
    await updateFindingStatus(newFindingId, "drafted", { reviewedBy: args.by, draftedUpdateId: updateId });
  }

  return { newFindingId, updateId };
}

/* ── Catalogue audit log (immutable "Recently Approved" trail) ──────────────── */

/** Append one immutable audit entry. Never fails the approval it records. */
export async function insertCatalogueAuditLog(row: InsertCatalogueAuditLog): Promise<void> {
  try {
    const db = await getDb();
    if (!db) return;
    await db.insert(catalogueAuditLog).values(row);
  } catch (err) {
    console.error("[catalogue-audit] failed to write audit entry", err);
  }
}

/** List audit entries (newest first), optionally by catalogue, capped. */
export async function listCatalogueAudit(filter?: {
  catalogue?: ReferenceCatalogue;
  targetRef?: string;
  limit?: number;
}): Promise<CatalogueAuditLog[]> {
  const db = await getDb();
  if (!db) return [];
  const conds = [] as unknown[];
  if (filter?.catalogue) conds.push(eq(catalogueAuditLog.catalogue, filter.catalogue));
  if (filter?.targetRef) conds.push(eq(catalogueAuditLog.targetRef, filter.targetRef));
  const base = db.select().from(catalogueAuditLog);
  const q =
    conds.length > 0
      ? base.where(conds.length === 1 ? (conds[0] as never) : (and(...(conds as never[])) as never))
      : base;
  return q.orderBy(desc(catalogueAuditLog.approvedAt)).limit(filter?.limit ?? 100);
}

/* ── Federated universe (read-only, approved/active facts only) ─────────────── */

/**
 * A single row in the federated screener view. Neutral facts only — no ranking.
 * `catalogue` tells the UI which of the four reference catalogues it came from.
 */
export interface FederatedInstrument {
  catalogue: ReferenceCatalogue;
  ref: string;
  name: string;
  issuer: string | null;
  assetClass: string | null;
  currency: string | null;
  /** The catalogue's headline figure (EAR / indicative rate / yield), when present. */
  headlineFigure: number | null;
  headlineLabel: string;
  source: string | null;
  /** As-of timestamp (epoch ms UTC) for the headline figure, when known — drives freshness. */
  dataAsOf: number | null;
  /** Row-level human-verification state (approved rows are human_verified/human_entered, or curated). */
  verificationState: string;
  /** Neutral liquidity facet (daily | t_plus_settlement | term | illiquid), when known. */
  liquidity: string | null;
  /** Maturity date (epoch ms UTC) for term instruments, when known — feeds maturity-fit diagnostics. */
  maturityDate: number | null;
  /** Expense ratio / management fee (%), when known — feeds the fee-drag diagnostic. */
  expenseRatioPct: number | null;
  /** The catalogue-row identity used by lifecycle governance (fund/bank name or opportunities.ref). */
  targetRef: string;
  /** Manager marked this reference stale (figures may be out of date). */
  stale: boolean;
}

/**
 * Read the approved universe across ALL four catalogues (mmf_funds active,
 * bank_instruments active, opportunities active split into cbk vs market_asset by
 * asset class). This is the source for the Explore "All catalogues" federation
 * toggle. It reads ONLY published/active rows — pending research never appears.
 */
export async function listFederatedUniverse(): Promise<FederatedInstrument[]> {
  const db = await getDb();
  if (!db) return [];
  const out: FederatedInstrument[] = [];

  // The approved universe must show ONLY truly-approved rows. We exclude any row a
  // manager has archived (referenceRowMeta.archivedAt set), and — for the scraped
  // catalogues (opportunities → cbk/market_asset) — we require the row to have
  // passed human verification. Curated catalogues (MMF, bank) are maintained by
  // hand, so an active row there is by definition approved; scraped_unverified /
  // ai_extracted opportunity seed rows (e.g. NSE:EABL) are held back until a human
  // confirms them, exactly like the public opportunities catalog does.
  const APPROVED_STATES = new Set(["human_verified", "human_entered"]);

  // Pre-load archived + stale lifecycle meta per catalogue so we can gate/flag rows
  // without a per-row query.
  const meta = {
    mmf: await listReferenceRowMeta("mmf"),
    bank: await listReferenceRowMeta("bank"),
    cbk: await listReferenceRowMeta("cbk"),
    market_asset: await listReferenceRowMeta("market_asset"),
  } as const;
  const isArchived = (cat: ReferenceCatalogue, targetRef: string): boolean =>
    meta[cat][targetRef]?.archivedAt != null;
  const isStale = (cat: ReferenceCatalogue, targetRef: string): boolean =>
    !!meta[cat][targetRef]?.stale;

  const mmfs = await db.select().from(mmfFunds).where(eq(mmfFunds.isActive, true));
  for (const m of mmfs) {
    if (isArchived("mmf", m.fundName)) continue;
    out.push({
      catalogue: "mmf",
      ref: `mmf:${m.id}`,
      name: m.fundName,
      issuer: m.company,
      assetClass: "cash_mmf",
      currency: "KES",
      headlineFigure: m.ear != null ? Number(m.ear) : null,
      headlineLabel: "EAR %",
      source: m.source ?? null,
      dataAsOf: (m as { updatedAt?: Date }).updatedAt ? new Date((m as { updatedAt: Date }).updatedAt).getTime() : null,
      verificationState: "human_entered",
      liquidity: "daily",
      maturityDate: null,
      expenseRatioPct: (m as { managementFee?: string | null }).managementFee != null ? Number((m as { managementFee: string }).managementFee) : null,
      targetRef: m.fundName,
      stale: isStale("mmf", m.fundName),
    });
  }

  const banks = await db.select().from(bankInstruments).where(eq(bankInstruments.isActive, true));
  for (const b of banks) {
    // Round 90 — lifecycle keys off the STABLE per-product ref `bank:<id>`, never the
    // shared bank name, so two products at the same bank archive/stale independently.
    const bankRef = `bank:${b.id}`;
    if (isArchived("bank", bankRef)) continue;
    out.push({
      catalogue: "bank",
      ref: `bank:${b.id}`,
      name: b.bankName,
      issuer: b.bankName,
      assetClass: "bank_deposit",
      currency: "KES",
      headlineFigure: b.indicativeRate != null ? Number(b.indicativeRate) : null,
      headlineLabel: "Indicative rate %",
      source: b.source ?? null,
      dataAsOf: (b as { updatedAt?: Date }).updatedAt ? new Date((b as { updatedAt: Date }).updatedAt).getTime() : null,
      verificationState: "human_entered",
      // Bank products carry no liquidity column; derive it from the instrument type
      // so the maturity/liquidity diagnostics have something factual to reason with.
      liquidity:
        b.instrumentType === "fixed_deposit" || b.instrumentType === "target_savings"
          ? "term"
          : "daily",
      maturityDate: null,
      expenseRatioPct: null,
      targetRef: bankRef,
      stale: isStale("bank", bankRef),
    });
  }

  const opps = await db.select().from(opportunities).where(eq(opportunities.active, true));
  for (const o of opps) {
    const ac = normaliseAssetClass(o.assetClass);
    const cat = catalogueForAssetClass(ac);
    // opportunities only feeds the cbk + market_asset catalogues.
    if (cat !== "cbk" && cat !== "market_asset") continue;
    // Approval gate: only human-verified/entered rows are part of the approved
    // universe. Scraped-but-unverified or purely AI-extracted seed rows are excluded.
    if (o.unverified) continue;
    if (!APPROVED_STATES.has(o.verificationState)) continue;
    if (isArchived(cat, o.ref)) continue;
    const headline = o.yieldPct != null ? Number(o.yieldPct) : o.lastPrice != null ? Number(o.lastPrice) : null;
    out.push({
      catalogue: cat,
      ref: o.ref,
      name: o.name,
      issuer: o.issuer ?? null,
      assetClass: ac,
      currency: o.currency,
      headlineFigure: headline,
      headlineLabel: o.yieldPct != null ? "Yield %" : "Last price",
      source: o.dataSource ?? null,
      dataAsOf: o.dataAsOf ? new Date(o.dataAsOf).getTime() : null,
      verificationState: o.verificationState,
      liquidity: o.liquidity ?? null,
      maturityDate: o.maturityDate ? new Date(o.maturityDate).getTime() : null,
      expenseRatioPct: o.expenseRatioPct != null ? Number(o.expenseRatioPct) : null,
      targetRef: o.ref,
      stale: isStale(cat, o.ref),
    });
  }

  return out;
}

/**
 * The fund name(s) a portfolio treats as PRIMARY (the fund the projection uses).
 * Used by the portfolio-impact descriptor to know whether an MMF yield change
 * actually moves the projection. Returns [] when no primary fund is set.
 */
export async function primaryMmfFundNames(portfolioId: number): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const p = await db
    .select({ mmfFundId: portfolios.mmfFundId })
    .from(portfolios)
    .where(eq(portfolios.id, portfolioId))
    .limit(1);
  const fundId = p[0]?.mmfFundId ?? null;
  if (fundId == null) return [];
  const f = await db.select({ fundName: mmfFunds.fundName }).from(mmfFunds).where(eq(mmfFunds.id, fundId)).limit(1);
  return f[0]?.fundName ? [f[0].fundName] : [];
}

/* ── Scheduled agent clock (source-check cadence) ───────────────────────────── */

/** Active sources whose agent cadence is due (or never checked) as of `now`. */
export async function sourcesDueForAgentCheck(now = Date.now()): Promise<SourceRegistryRow[]> {
  const rows = await listSources(false);
  return rows.filter((r) => agentCheckDue({ cadenceDays: r.cadenceDays, lastCheckedAt: r.lastCheckedAt ?? null, active: r.active }, now).due);
}

/** Record the outcome of an agent check on a source (clock + freshness). */
export async function markSourceChecked(
  key: string,
  patch: { status: "ok" | "stale" | "error"; lastCheckedAt: number; lastSuccessfulCheckAt?: number | null },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db
    .update(sourceRegistry)
    .set({
      status: patch.status,
      lastCheckedAt: patch.lastCheckedAt,
      ...(patch.lastSuccessfulCheckAt != null ? { lastSuccessfulCheckAt: patch.lastSuccessfulCheckAt } : {}),
    })
    .where(eq(sourceRegistry.key, key));
}

/**
 * Flag long-overdue active sources as stale (agent housekeeping). A source is
 * stale when it is ≥ 3× its cadence past its last agent check. Never publishes.
 */
export async function flagStaleSources(now = Date.now()): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const rows = await listSources(false);
  let flagged = 0;
  for (const r of rows) {
    const { stale } = agentCheckDue(
      { cadenceDays: r.cadenceDays, lastCheckedAt: r.lastCheckedAt ?? null, active: r.active },
      now,
    );
    if (stale && r.status !== "stale") {
      await db.update(sourceRegistry).set({ status: "stale" }).where(eq(sourceRegistry.key, r.key));
      flagged += 1;
    }
  }
  return flagged;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Round 83 — reference-row lifecycle (stale / archive), date-effective rate
 * history reads, governed catalogue deactivation, and source-registry lifecycle.
 *
 * INVARIANTS:
 *   - Marking a row stale or archived is a MANAGER action, always audited via
 *     the catalogue audit log, and never silently deletes data.
 *   - Deactivating a catalogue row hides it from Explore/screener but preserves
 *     its history; reactivation is symmetric.
 *   - Rate history is append-only and date-effective: reads return the row that
 *     applied at a given instant, so past accrual is never restated.
 * ══════════════════════════════════════════════════════════════════════════ */

/* ── Reference-row meta (stale / archive lifecycle) ─────────────────────────── */

/** Read the lifecycle meta for one catalogue row (or null when none recorded). */
export async function getReferenceRowMeta(
  catalogue: ReferenceCatalogue,
  targetRef: string,
): Promise<ReferenceRowMeta | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(referenceRowMeta)
    .where(and(eq(referenceRowMeta.catalogue, catalogue), eq(referenceRowMeta.targetRef, targetRef)))
    .limit(1);
  return rows[0] ?? null;
}

/** Read lifecycle meta for a whole catalogue, keyed by targetRef (for list badges). */
export async function listReferenceRowMeta(
  catalogue: ReferenceCatalogue,
): Promise<Record<string, ReferenceRowMeta>> {
  const db = await getDb();
  if (!db) return {};
  const rows = await db.select().from(referenceRowMeta).where(eq(referenceRowMeta.catalogue, catalogue));
  const out: Record<string, ReferenceRowMeta> = {};
  for (const r of rows) out[r.targetRef] = r;
  return out;
}

/**
 * Round 90 — archive recoverability. Return the ARCHIVED rows for a catalogue so a
 * manager can see, audit, and reactivate them (they are hidden from the normal
 * active lists). Each row is resolved back to a human-readable label + its stable
 * targetRef, joined with the archived-by/at/reason meta. Manager-only at the router.
 */
export type ArchivedCatalogueRow = {
  targetRef: string;
  label: string;
  sublabel: string | null;
  archivedAt: number | null;
  archivedBy: string | null;
  archivedReason: string | null;
};

export async function listArchivedCatalogueRows(
  catalogue: ReferenceCatalogue,
): Promise<ArchivedCatalogueRow[]> {
  const db = await getDb();
  if (!db) return [];
  const metaRows = (
    await db
      .select()
      .from(referenceRowMeta)
      .where(and(eq(referenceRowMeta.catalogue, catalogue), isNotNull(referenceRowMeta.archivedAt)))
  ).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  if (metaRows.length === 0) return [];

  const out: ArchivedCatalogueRow[] = [];
  for (const m of metaRows) {
    let label = m.targetRef;
    let sublabel: string | null = null;
    if (catalogue === "mmf") {
      const row = (await db.select().from(mmfFunds).where(eq(mmfFunds.fundName, m.targetRef)).limit(1))[0];
      if (row) {
        label = row.fundName;
        sublabel = row.company ?? null;
      }
    } else if (catalogue === "bank") {
      const resolved = await resolveBankRef(m.targetRef);
      if (resolved) {
        const row = (await db.select().from(bankInstruments).where(eq(bankInstruments.id, resolved.id)).limit(1))[0];
        if (row) {
          label = row.bankName;
          sublabel = row.instrumentType ?? null;
        }
      }
    } else {
      const row = (await db.select().from(opportunities).where(eq(opportunities.ref, m.targetRef)).limit(1))[0];
      if (row) {
        label = row.name;
        sublabel = row.issuer ?? null;
      }
    }
    out.push({
      targetRef: m.targetRef,
      label,
      sublabel,
      archivedAt: m.archivedAt ?? null,
      archivedBy: m.archivedBy ?? null,
      archivedReason: m.archivedReason ?? null,
    });
  }
  return out;
}

/**
 * Round 90 — archive recoverability for All Approved Instruments. Returns the
 * ARCHIVED reference rows across all four catalogues in the SAME shape as
 * {@link listFederatedUniverse} (a FederatedInstrument each), so the All Approved
 * table can merge them behind the manager-only "Include archived rows" toggle
 * (off by default). Unlike the active universe, this deliberately KEEPS rows a
 * manager archived (referenceRowMeta.archivedAt set). Manager-only at the router.
 */
export async function listArchivedFederatedUniverse(): Promise<FederatedInstrument[]> {
  const db = await getDb();
  if (!db) return [];
  const out: FederatedInstrument[] = [];

  const meta = {
    mmf: await listReferenceRowMeta("mmf"),
    bank: await listReferenceRowMeta("bank"),
    cbk: await listReferenceRowMeta("cbk"),
    market_asset: await listReferenceRowMeta("market_asset"),
  } as const;
  const isArchived = (cat: ReferenceCatalogue, targetRef: string): boolean =>
    meta[cat][targetRef]?.archivedAt != null;
  const isStale = (cat: ReferenceCatalogue, targetRef: string): boolean =>
    !!meta[cat][targetRef]?.stale;

  // MMF — include ANY fund (active or not) whose row is archived.
  const mmfs = await db.select().from(mmfFunds);
  for (const m of mmfs) {
    if (!isArchived("mmf", m.fundName)) continue;
    out.push({
      catalogue: "mmf",
      ref: `mmf:${m.id}`,
      name: m.fundName,
      issuer: m.company,
      assetClass: "cash_mmf",
      currency: "KES",
      headlineFigure: m.ear != null ? Number(m.ear) : null,
      headlineLabel: "EAR %",
      source: m.source ?? null,
      dataAsOf: (m as { updatedAt?: Date }).updatedAt ? new Date((m as { updatedAt: Date }).updatedAt).getTime() : null,
      verificationState: "human_entered",
      liquidity: "daily",
      maturityDate: null,
      expenseRatioPct: (m as { managementFee?: string | null }).managementFee != null ? Number((m as { managementFee: string }).managementFee) : null,
      targetRef: m.fundName,
      stale: isStale("mmf", m.fundName),
    });
  }

  const banks = await db.select().from(bankInstruments);
  for (const b of banks) {
    const bankRef = `bank:${b.id}`;
    if (!isArchived("bank", bankRef)) continue;
    out.push({
      catalogue: "bank",
      ref: `bank:${b.id}`,
      name: b.bankName,
      issuer: b.bankName,
      assetClass: "bank_deposit",
      currency: "KES",
      headlineFigure: b.indicativeRate != null ? Number(b.indicativeRate) : null,
      headlineLabel: "Indicative rate %",
      source: b.source ?? null,
      dataAsOf: (b as { updatedAt?: Date }).updatedAt ? new Date((b as { updatedAt: Date }).updatedAt).getTime() : null,
      verificationState: "human_entered",
      liquidity:
        b.instrumentType === "fixed_deposit" || b.instrumentType === "target_savings"
          ? "term"
          : "daily",
      maturityDate: null,
      expenseRatioPct: null,
      targetRef: bankRef,
      stale: isStale("bank", bankRef),
    });
  }

  const opps = await db.select().from(opportunities);
  for (const o of opps) {
    const ac = normaliseAssetClass(o.assetClass);
    const cat = catalogueForAssetClass(ac);
    if (cat !== "cbk" && cat !== "market_asset") continue;
    if (!isArchived(cat, o.ref)) continue;
    const headline = o.yieldPct != null ? Number(o.yieldPct) : o.lastPrice != null ? Number(o.lastPrice) : null;
    out.push({
      catalogue: cat,
      ref: o.ref,
      name: o.name,
      issuer: o.issuer ?? null,
      assetClass: ac,
      currency: o.currency,
      headlineFigure: headline,
      headlineLabel: o.yieldPct != null ? "Yield %" : "Last price",
      source: o.dataSource ?? null,
      dataAsOf: o.dataAsOf ? new Date(o.dataAsOf).getTime() : null,
      verificationState: o.verificationState,
      liquidity: o.liquidity ?? null,
      maturityDate: o.maturityDate ? new Date(o.maturityDate).getTime() : null,
      expenseRatioPct: o.expenseRatioPct != null ? Number(o.expenseRatioPct) : null,
      targetRef: o.ref,
      stale: isStale(cat, o.ref),
    });
  }

  return out;
}

/** Upsert a meta row (internal). */
async function upsertReferenceRowMeta(
  catalogue: ReferenceCatalogue,
  targetRef: string,
  patch: Partial<{
    stale: boolean;
    staleReason: string | null;
    staleMarkedBy: string | null;
    staleMarkedAt: number | null;
    archivedReason: string | null;
    archivedBy: string | null;
    archivedAt: number | null;
  }>,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await getReferenceRowMeta(catalogue, targetRef);
  if (existing) {
    await db.update(referenceRowMeta).set(patch).where(eq(referenceRowMeta.id, existing.id));
  } else {
    await db.insert(referenceRowMeta).values({ catalogue, targetRef, ...patch });
  }
}

/**
 * Mark a catalogue row stale (data no longer trustworthy) or clear the flag.
 * Manager action; writes a catalogue audit entry so the trail shows who/when/why.
 */
export async function setReferenceRowStale(args: {
  catalogue: ReferenceCatalogue;
  targetRef: string;
  instrumentName: string | null;
  stale: boolean;
  reason?: string | null;
  by: string;
}): Promise<void> {
  const now = Date.now();
  await upsertReferenceRowMeta(args.catalogue, args.targetRef, {
    stale: args.stale,
    staleReason: args.stale ? args.reason ?? null : null,
    staleMarkedBy: args.stale ? args.by : null,
    staleMarkedAt: args.stale ? now : null,
  });
  await insertCatalogueAuditLog({
    catalogue: args.catalogue,
    targetRef: args.targetRef,
    instrumentName: args.instrumentName,
    changeKind: "edit",
    field: "stale",
    oldValue: args.stale ? "false" : "true",
    newValue: args.stale ? "true" : "false",
    source: args.reason ?? null,
    sourceUrl: null,
    researchUpdateId: null,
    researchTaskId: null,
    approvedBy: args.by,
    approvedAt: now,
    note: args.stale ? `Marked stale: ${args.reason ?? "no reason given"}` : "Stale flag cleared",
  });
}

/* ── Governed catalogue deactivation (hide from screener, keep history) ─────── */

/** Deactivate / reactivate an MMF fund by name. Manager action, audited. */
export async function setMmfActive(fundName: string, active: boolean, by: string, reason?: string | null): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const existing = await db.select({ id: mmfFunds.id }).from(mmfFunds).where(eq(mmfFunds.fundName, fundName)).limit(1);
  if (!existing[0]) return false;
  await db.update(mmfFunds).set({ isActive: active }).where(eq(mmfFunds.id, existing[0].id));
  await recordDeactivationAudit("mmf", fundName, fundName, active, by, reason);
  return true;
}

/**
 * Round 90 — resolve a bank reference to its exact row. Two catalogue products at
 * the SAME bank (e.g. NCBA fixed deposit + NCBA call deposit) share a `bankName`,
 * so keying lifecycle actions on the name collides them. The stable reference is
 * `bank:<id>`; we still accept a bare bank name for backward compatibility with any
 * legacy meta / audit rows, resolving it to the first matching instrument.
 */
export async function resolveBankRef(
  ref: string,
): Promise<{ id: number; bankName: string } | null> {
  const db = await getDb();
  if (!db) return null;
  const m = /^bank:(\d+)$/.exec(ref.trim());
  if (m) {
    const id = Number(m[1]);
    const r = await db
      .select({ id: bankInstruments.id, bankName: bankInstruments.bankName })
      .from(bankInstruments)
      .where(eq(bankInstruments.id, id))
      .limit(1);
    return r[0] ?? null;
  }
  // Legacy: a bare bank name. Resolve to the first matching instrument.
  const r = await db
    .select({ id: bankInstruments.id, bankName: bankInstruments.bankName })
    .from(bankInstruments)
    .where(eq(bankInstruments.bankName, ref))
    .limit(1);
  return r[0] ?? null;
}

/**
 * Deactivate / reactivate a bank instrument. Accepts a stable `bank:<id>` ref
 * (preferred) or a legacy bank name. Manager action, audited against the same ref
 * so the audit trail and the row's Manage menu line up per-product.
 */
export async function setBankActive(ref: string, active: boolean, by: string, reason?: string | null): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const resolved = await resolveBankRef(ref);
  if (!resolved) return false;
  await db.update(bankInstruments).set({ isActive: active }).where(eq(bankInstruments.id, resolved.id));
  // Audit + archive-meta are recorded against the STABLE ref so two products at the
  // same bank never share a lifecycle row.
  const stableRef = `bank:${resolved.id}`;
  await recordDeactivationAudit("bank", stableRef, resolved.bankName, active, by, reason);
  return true;
}

/** Deactivate / reactivate an opportunity (cbk or market_asset) by ref. Manager action, audited. */
export async function setOpportunityActive(ref: string, active: boolean, by: string, reason?: string | null): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const existing = await db.select({ id: opportunities.id, name: opportunities.name, assetClass: opportunities.assetClass }).from(opportunities).where(eq(opportunities.ref, ref)).limit(1);
  if (!existing[0]) return false;
  await db.update(opportunities).set({ active }).where(eq(opportunities.id, existing[0].id));
  const cat = catalogueForAssetClass(normaliseAssetClass(existing[0].assetClass));
  await recordDeactivationAudit(cat, ref, existing[0].name, active, by, reason);
  return true;
}

/** Shared audit write for (de)activation. */
async function recordDeactivationAudit(
  catalogue: ReferenceCatalogue,
  targetRef: string,
  instrumentName: string | null,
  active: boolean,
  by: string,
  reason?: string | null,
): Promise<void> {
  const now = Date.now();
  if (!active) {
    await upsertReferenceRowMeta(catalogue, targetRef, {
      archivedReason: reason ?? null,
      archivedBy: by,
      archivedAt: now,
    });
  } else {
    await upsertReferenceRowMeta(catalogue, targetRef, {
      archivedReason: null,
      archivedBy: null,
      archivedAt: null,
    });
  }
  await insertCatalogueAuditLog({
    catalogue,
    targetRef,
    instrumentName,
    changeKind: "edit",
    field: "isActive",
    oldValue: active ? "false" : "true",
    newValue: active ? "true" : "false",
    source: reason ?? null,
    sourceUrl: null,
    researchUpdateId: null,
    researchTaskId: null,
    approvedBy: by,
    approvedAt: now,
    note: active ? "Reactivated" : `Deactivated: ${reason ?? "no reason given"}`,
  });
}

/**
 * Audit a manager's source-backed manual correction to a reference catalogue
 * (item 5). Reference edits are governed: they are admin-only and always leave
 * an immutable trail with the source. Does not touch portfolio math.
 */
export async function recordManualCorrectionAudit(args: {
  catalogue: ReferenceCatalogue;
  targetRef: string;
  instrumentName: string | null;
  changeKind: "create" | "edit";
  field?: string;
  oldValue?: string;
  newValue?: string;
  source: string;
  sourceUrl?: string | null;
  /** Optional manager-supplied justification for the correction (item 5). */
  reason?: string | null;
  by: string;
}): Promise<void> {
  const reason = args.reason?.trim();
  await insertCatalogueAuditLog({
    catalogue: args.catalogue,
    targetRef: args.targetRef,
    instrumentName: args.instrumentName,
    changeKind: args.changeKind,
    field: args.field ?? null,
    oldValue: args.oldValue ?? null,
    newValue: args.newValue ?? null,
    source: args.source,
    sourceUrl: args.sourceUrl ?? null,
    researchUpdateId: null,
    researchTaskId: null,
    approvedBy: args.by,
    approvedAt: Date.now(),
    note: reason ? `Manager manual correction: ${reason}` : "Manager manual correction (source-backed)",
  });
}

/**
 * Append a date-effective MMF rate-history point after a governed manual EAR edit
 * (item 5), so a fund's published-rate timeline reflects manager corrections, not
 * only approvals from the research pipeline. Best-effort: never throws into the
 * caller (a failed history write must not fail the edit).
 */
export async function appendMmfManualRatePoint(args: {
  fundName: string;
  ear: number | null;
  grossYield: number | null;
  source: string;
  by: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const found = await db
      .select({ id: mmfFunds.id })
      .from(mmfFunds)
      .where(eq(mmfFunds.fundName, args.fundName))
      .limit(1);
    await db.insert(mmfRateHistory).values({
      mmfFundId: found[0]?.id ?? 0,
      fundName: args.fundName,
      grossYield: args.grossYield != null ? String(args.grossYield) : (args.ear != null ? String(args.ear) : null),
      ear: args.ear != null ? String(args.ear) : (args.grossYield != null ? String(args.grossYield) : null),
      source: args.source,
      approvedBy: args.by,
      effectiveAt: Date.now(),
    });
  } catch (err) {
    console.error("[appendMmfManualRatePoint] failed:", (err as Error).message);
  }
}

/* ── Date-effective rate history reads ──────────────────────────────────────── */

export interface RateHistoryPoint {
  effectiveAt: number;
  value: number | null;
  secondary: number | null;
  source: string | null;
  approvedBy: string | null;
}

/** MMF rate history for a fund (by name), newest first. */
export async function mmfRateHistoryFor(fundName: string, limit = 60): Promise<RateHistoryPoint[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(mmfRateHistory)
    .where(eq(mmfRateHistory.fundName, fundName))
    .orderBy(desc(mmfRateHistory.effectiveAt))
    .limit(limit);
  return rows.map((r) => ({
    effectiveAt: Number(r.effectiveAt),
    value: r.ear != null ? Number(r.ear) : null,
    secondary: r.grossYield != null ? Number(r.grossYield) : null,
    source: r.source ?? null,
    approvedBy: r.approvedBy ?? null,
  }));
}

/**
 * Bank product indicative-rate history, newest first. Accepts a stable `bank:<id>`
 * ref (preferred — queries by `bankInstrumentId` so two products at the same bank
 * keep separate histories) or a legacy bank name.
 */
export async function bankRateHistoryFor(ref: string, limit = 60): Promise<RateHistoryPoint[]> {
  const db = await getDb();
  if (!db) return [];
  const resolved = await resolveBankRef(ref);
  const where = resolved
    ? eq(bankProductRateHistory.bankInstrumentId, resolved.id)
    : eq(bankProductRateHistory.bankName, ref);
  const rows = await db
    .select()
    .from(bankProductRateHistory)
    .where(where)
    .orderBy(desc(bankProductRateHistory.effectiveAt))
    .limit(limit);
  return rows.map((r) => ({
    effectiveAt: Number(r.effectiveAt),
    value: r.indicativeRate != null ? Number(r.indicativeRate) : null,
    secondary: null,
    source: r.source ?? null,
    approvedBy: r.approvedBy ?? null,
  }));
}

/** CBK yield history (by opportunity ref), newest first. */
export async function cbkRateHistoryFor(ref: string, limit = 60): Promise<RateHistoryPoint[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select()
    .from(cbkRateHistory)
    .where(eq(cbkRateHistory.opportunityRef, ref))
    .orderBy(desc(cbkRateHistory.effectiveAt))
    .limit(limit);
  return rows.map((r) => ({
    effectiveAt: Number(r.effectiveAt),
    value: r.yieldPct != null ? Number(r.yieldPct) : null,
    secondary: null,
    source: r.source ?? null,
    approvedBy: r.approvedBy ?? null,
  }));
}

/**
 * The MMF EAR that applied at a given instant (date-effective lookup). Returns the
 * newest history row with effectiveAt <= `at`, or null if none. This is what future
 * projection/accrual should read so a rate change is never applied retroactively.
 */
export async function mmfEarEffectiveAt(fundName: string, at: number): Promise<number | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ ear: mmfRateHistory.ear, effectiveAt: mmfRateHistory.effectiveAt })
    .from(mmfRateHistory)
    .where(and(eq(mmfRateHistory.fundName, fundName), lte(mmfRateHistory.effectiveAt, at)))
    .orderBy(desc(mmfRateHistory.effectiveAt))
    .limit(1);
  return rows[0]?.ear != null ? Number(rows[0].ear) : null;
}

/* ── Source-registry lifecycle extensions ───────────────────────────────────── */

/** Deactivate / reactivate a source by key (kept for history, hidden from due-list). */
export async function setSourceActive(key: string, active: boolean): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(sourceRegistry).set({ active }).where(eq(sourceRegistry.key, key));
}

/** Fetch a single source by key. */
export async function getSource(key: string): Promise<SourceRegistryRow | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(sourceRegistry).where(eq(sourceRegistry.key, key)).limit(1);
  return rows[0] ?? null;
}

/* ── Round 86: Test-Mode reference-data cleanup (manager-only) ───────────────────
 *
 * These helpers let a manager reset the workspace's REFERENCE data (catalogues,
 * the pending research queue, and the approval audit trail) back to a clean state
 * after exercising the research pipeline with test rows.
 *
 * SAFETY CONTRACT:
 *   - Reference catalogues (mmf/bank/opportunities) are NEVER hard-deleted by the
 *     Live-safe path: `archiveAllReferenceRows` deactivates + archives every row,
 *     preserving history exactly like a per-row deactivate does.
 *   - `resetReferenceCataloguesToSeed` is the ONLY path that hard-deletes catalogue
 *     rows, and it is gated to Test Mode at the router. It truncates the three
 *     catalogue tables + their lifecycle meta and re-seeds the opportunity catalog.
 *   - The pending research queue and the catalogue audit log are working/audit
 *     tables (not tracked money), so clearing them is a plain delete.
 */

/** Soft-archive (deactivate + mark archived) EVERY active reference row. Live-safe. */
export async function archiveAllReferenceRows(by: string, reason: string): Promise<{ archived: number }> {
  const db = await getDb();
  if (!db) return { archived: 0 };
  let archived = 0;
  const mmfs = await db.select({ name: mmfFunds.fundName }).from(mmfFunds).where(eq(mmfFunds.isActive, true));
  for (const m of mmfs) {
    await setMmfActive(m.name, false, by, reason);
    await upsertReferenceRowMeta("mmf", m.name, { archivedReason: reason, archivedBy: by, archivedAt: Date.now() });
    archived += 1;
  }
  const banks = await db.select({ id: bankInstruments.id }).from(bankInstruments).where(eq(bankInstruments.isActive, true));
  for (const b of banks) {
    const bankRef = `bank:${b.id}`;
    await setBankActive(bankRef, false, by, reason);
    await upsertReferenceRowMeta("bank", bankRef, { archivedReason: reason, archivedBy: by, archivedAt: Date.now() });
    archived += 1;
  }
  const opps = await db.select({ ref: opportunities.ref, assetClass: opportunities.assetClass }).from(opportunities).where(eq(opportunities.active, true));
  for (const o of opps) {
    const cat = catalogueForAssetClass(normaliseAssetClass(o.assetClass));
    if (cat !== "cbk" && cat !== "market_asset") continue;
    await setOpportunityActive(o.ref, false, by, reason);
    await upsertReferenceRowMeta(cat, o.ref, { archivedReason: reason, archivedBy: by, archivedAt: Date.now() });
    archived += 1;
  }
  return { archived };
}

/** Clear the pending research queue (delete pending research updates). Working data. */
export async function clearPendingResearchQueue(): Promise<{ deleted: number }> {
  const db = await getDb();
  if (!db) return { deleted: 0 };
  const pending = await db.select({ id: researchUpdates.id }).from(researchUpdates).where(eq(researchUpdates.status, "pending"));
  if (pending.length === 0) return { deleted: 0 };
  await db.delete(researchUpdates).where(eq(researchUpdates.status, "pending"));
  return { deleted: pending.length };
}

/** Clear the catalogue approval audit log (the "recently approved" trail). Audit data. */
export async function clearCatalogueAuditLog(): Promise<{ deleted: number }> {
  const db = await getDb();
  if (!db) return { deleted: 0 };
  const rows = await db.select({ id: catalogueAuditLog.id }).from(catalogueAuditLog);
  if (rows.length === 0) return { deleted: 0 };
  await db.delete(catalogueAuditLog);
  return { deleted: rows.length };
}

/**
 * HARD reset the three reference catalogues to their seed state. TEST-MODE ONLY —
 * the router gates this. Truncates catalogue tables + their rate history + lifecycle
 * meta, then re-seeds the opportunity catalog. MMF/bank are left empty (they have no
 * code seed; a manager re-adds curated rows or approves them via the pipeline).
 */
export async function resetReferenceCataloguesToSeed(
  seed: InsertOpportunity[],
): Promise<{ opportunitiesSeeded: number }> {
  const db = await getDb();
  if (!db) return { opportunitiesSeeded: 0 };
  // Truncate catalogue rows + their history + lifecycle meta.
  await db.delete(mmfRateHistory);
  await db.delete(cbkRateHistory);
  await db.delete(bankProductRateHistory);
  await db.delete(referenceRowMeta);
  await db.delete(mmfFunds);
  await db.delete(bankInstruments);
  await db.delete(opportunities);
  // Re-seed the opportunity catalog from code.
  for (const row of seed) await upsertOpportunity(row);
  return { opportunitiesSeeded: seed.length };
}
