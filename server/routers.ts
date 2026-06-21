import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getRateSettings,
  upsertRateSettings,
  getLedgerEntries,
  bulkUpsertLedgerEntries,
  getSecurities,
  addSecurity,
  updateSecurity,
  deleteSecurity,
  getContributionOverrides,
  upsertContributionOverride,
  deleteContributionOverride,
  getDepositEntries,
  addDepositEntry,
  deleteDepositEntry,
  getActualsSummary,
  addRateHistorySnapshot,
  getRateHistory,
  getAccountStatuses,
  upsertAccountStatus,
  getPendingRateFetches,
  updatePendingRateFetchStatus,
  dismissAllPendingRateFetches,
  getLastFetchAttempts,
  insertRateFetchLog,
  insertPendingRateFetch,
} from "./db";
import { fetchAllRates } from "./rateFetcher";
import {
  runProjection,
  runScenarios,
  checkMilestones,
  getScheduledContribution,
  generateMilestones,
  invalidateMilestoneCache,
  SCENARIO_STEPUPS,
  type EngineSettings,
  type ActualDeposit,
  type ActualSecurity,
} from "./engine";

const DEFAULT_SETTINGS: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.8206,
  tbill182Rate: 8.7782,
  tbill364Rate: 8.9746,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,  // gross; net ≈ 10.5% after 15% WHT
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
};

function dbSettingsToEngine(s: Awaited<ReturnType<typeof getRateSettings>>): EngineSettings {
  if (!s) return DEFAULT_SETTINGS;
  return {
    mmfYield: parseFloat(String(s.mmfYield)),
    tbill91Rate: parseFloat(String(s.tbill91Rate)),
    tbill182Rate: parseFloat(String(s.tbill182Rate)),
    tbill364Rate: parseFloat(String(s.tbill364Rate)),
    ifbCouponRate: parseFloat(String(s.ifbCouponRate)),
    fxdCouponRate: parseFloat(String(s.fxdCouponRate)),
    withholdingTax: parseFloat(String(s.withholdingTax)),
    startingContribution: parseFloat(String(s.startingContribution)),
    stepUpAmount: parseFloat(String(s.stepUpAmount)),
    stepUpMonths: s.stepUpMonths,
    safetyFloor: parseFloat(String(s.safetyFloor)),
    targetAmount: parseFloat(String(s.targetAmount)),
  };
}

const rateSettingsInput = z.object({
  mmfYield: z.number().min(0).max(50),
  tbill91Rate: z.number().min(0).max(50),
  tbill182Rate: z.number().min(0).max(50),
  tbill364Rate: z.number().min(0).max(50),
  ifbCouponRate: z.number().min(0).max(50),
  fxdCouponRate: z.number().min(0).max(50),
  withholdingTax: z.number().min(0).max(100),
  startingContribution: z.number().min(0),
  stepUpAmount: z.number().min(0),
  stepUpMonths: z.number().int().min(1).max(24),
  safetyFloor: z.number().min(0),
  targetAmount: z.number().min(0),
  startDate: z.string().optional(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Settings ────────────────────────────────────────────────────────────────
  settings: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const s = await getRateSettings(ctx.user.id);
      if (!s) return { ...DEFAULT_SETTINGS, startDate: "2026-07-01" };
      // Normalise startDate: MySQL DATE may come back as a Date object or string
      const rawDate = s.startDate;
      let startDate = "2026-07-01";
      if (rawDate) {
        if (rawDate instanceof Date) {
          startDate = rawDate.toISOString().split("T")[0];
        } else {
          // String like "2026-07-01" or "2026-07-01T00:00:00.000Z"
          startDate = String(rawDate).split("T")[0];
        }
      }
      return {
        ...dbSettingsToEngine(s),
        startDate,
      };
    }),

    save: protectedProcedure.input(rateSettingsInput).mutation(async ({ ctx, input }) => {
      invalidateMilestoneCache();
      await upsertRateSettings({
        userId: ctx.user.id,
        mmfYield: String(input.mmfYield),
        tbill91Rate: String(input.tbill91Rate),
        tbill182Rate: String(input.tbill182Rate),
        tbill364Rate: String(input.tbill364Rate),
        ifbCouponRate: String(input.ifbCouponRate),
        fxdCouponRate: String(input.fxdCouponRate),
        withholdingTax: String(input.withholdingTax),
        startingContribution: String(input.startingContribution),
        stepUpAmount: String(input.stepUpAmount),
        stepUpMonths: input.stepUpMonths,
        safetyFloor: String(input.safetyFloor),
        targetAmount: String(input.targetAmount),
        // Store as a plain Date at noon UTC to avoid timezone-off-by-one issues
        startDate: (() => {
          const d = input.startDate ?? "2026-07-01";
          const clean = d.split("T")[0]; // ensure no time part
          return new Date(`${clean}T12:00:00.000Z`);
        })(),
      });
      // Snapshot the rate-only fields to rate_history with today as effectiveDate
      // This ensures future projections use the new rates only from today onward
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
      await addRateHistorySnapshot({
        userId: ctx.user.id,
        effectiveDate: new Date(`${today}T12:00:00.000Z`),
        mmfYield: String(input.mmfYield),
        tbill91Rate: String(input.tbill91Rate),
        tbill182Rate: String(input.tbill182Rate),
        tbill364Rate: String(input.tbill364Rate),
        ifbCouponRate: String(input.ifbCouponRate),
        fxdCouponRate: String(input.fxdCouponRate),
        withholdingTax: String(input.withholdingTax),
        changeNote: `Rate update on ${today}`,
      });
      return { success: true };
    }),
  }),

  // ─── Projection Engine ────────────────────────────────────────────────────────
  projection: router({
    run: protectedProcedure.query(async ({ ctx }) => {
      const dbSettings = await getRateSettings(ctx.user.id);
      const settings = dbSettingsToEngine(dbSettings);
      // Attach startDate to settings for time-locked rate history
      const rawDate = dbSettings?.startDate;
      if (rawDate) {
        settings.startDate = rawDate instanceof Date
          ? rawDate.toISOString().split("T")[0]
          : String(rawDate).split("T")[0];
      } else {
        settings.startDate = "2026-07-01";
      }
      const overrides = await getContributionOverrides(ctx.user.id);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      // Fetch rate history for time-locked per-month rates
      const rateHistoryRows = await getRateHistory(ctx.user.id);
      const rateHistory = rateHistoryRows.map((r) => ({
        effectiveDate: r.effectiveDate instanceof Date
          ? r.effectiveDate.toISOString().split("T")[0]
          : String(r.effectiveDate).split("T")[0],
        mmfYield: parseFloat(String(r.mmfYield)),
        tbill91Rate: parseFloat(String(r.tbill91Rate)),
        tbill182Rate: parseFloat(String(r.tbill182Rate)),
        tbill364Rate: parseFloat(String(r.tbill364Rate)),
        ifbCouponRate: parseFloat(String(r.ifbCouponRate)),
        fxdCouponRate: parseFloat(String(r.fxdCouponRate)),
        withholdingTax: parseFloat(String(r.withholdingTax)),
      }));
      // Fetch actuals to seed the projection from real data
      const depositRows = await getDepositEntries(ctx.user.id);
      const actualDeposits: ActualDeposit[] = depositRows.map((d) => ({
        bucket: d.bucket as "mmf" | "tbill" | "ifb" | "fxd",
        amount: parseFloat(String(d.amount)),
        depositDate: d.depositDate instanceof Date
          ? d.depositDate.toISOString().split("T")[0]
          : String(d.depositDate).split("T")[0],
      }));
      const securityRows = await getSecurities(ctx.user.id);
      const actualSecurities: ActualSecurity[] = securityRows.map((s) => ({
        securityType: s.securityType as ActualSecurity["securityType"],
        faceValue: parseFloat(String(s.faceValue)),
        issueDate: s.issueDate instanceof Date
          ? s.issueDate.toISOString().split("T")[0]
          : String(s.issueDate).split("T")[0],
        maturityDate: s.maturityDate instanceof Date
          ? s.maturityDate.toISOString().split("T")[0]
          : String(s.maturityDate).split("T")[0],
        couponRate: parseFloat(String(s.couponRate)),
        isTaxExempt: s.isTaxExempt,
        isMatured: s.isMatured,
      }));
      const results = runProjection(settings, mappedOverrides, rateHistory, actualDeposits, actualSecurities);
      return results;
    }),

    scenarios: protectedProcedure.query(async ({ ctx }) => {
      const dbSettings = await getRateSettings(ctx.user.id);
      const settings = dbSettingsToEngine(dbSettings);
      const rateHistoryRows = await getRateHistory(ctx.user.id);
      const rateHistory = rateHistoryRows.map((r) => ({
        effectiveDate: r.effectiveDate instanceof Date
          ? r.effectiveDate.toISOString().split("T")[0]
          : String(r.effectiveDate).split("T")[0],
        mmfYield: parseFloat(String(r.mmfYield)),
        tbill91Rate: parseFloat(String(r.tbill91Rate)),
        tbill182Rate: parseFloat(String(r.tbill182Rate)),
        tbill364Rate: parseFloat(String(r.tbill364Rate)),
        ifbCouponRate: parseFloat(String(r.ifbCouponRate)),
        fxdCouponRate: parseFloat(String(r.fxdCouponRate)),
        withholdingTax: parseFloat(String(r.withholdingTax)),
      }));
      return runScenarios(settings, SCENARIO_STEPUPS, rateHistory);
    }),

    milestones: protectedProcedure.query(async ({ ctx }) => {
      const dbSettings = await getRateSettings(ctx.user.id);
      const settings = dbSettingsToEngine(dbSettings);
      return generateMilestones(settings);
    }),

    contributionSchedule: protectedProcedure.query(async ({ ctx }) => {
      const dbSettings = await getRateSettings(ctx.user.id);
      const settings = dbSettingsToEngine(dbSettings);
      const schedule = [];
      for (let m = 1; m <= 120; m += settings.stepUpMonths) {
        const end = Math.min(m + settings.stepUpMonths - 1, 120);
        const amount = getScheduledContribution(m, settings);
        const sixMonthTotal = amount * (end - m + 1);
        schedule.push({
          startMonth: m,
          endMonth: end,
          monthlyAmount: amount,
          sixMonthTotal,
        });
      }
      return schedule;
    }),
  }),

  // ─── Ledger ───────────────────────────────────────────────────────────────────
  ledger: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getLedgerEntries(ctx.user.id);
    }),

    sync: protectedProcedure.mutation(async ({ ctx }) => {
      const dbSettings = await getRateSettings(ctx.user.id);
      const settings = dbSettingsToEngine(dbSettings);
      const overrides = await getContributionOverrides(ctx.user.id);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      // Wire rateHistory into ledger sync
      const rateHistoryRows2 = await getRateHistory(ctx.user.id);
      const rateHistory2 = rateHistoryRows2.map((r) => ({
        effectiveDate: r.effectiveDate instanceof Date
          ? r.effectiveDate.toISOString().split("T")[0]
          : String(r.effectiveDate).split("T")[0],
        mmfYield: parseFloat(String(r.mmfYield)),
        tbill91Rate: parseFloat(String(r.tbill91Rate)),
        tbill182Rate: parseFloat(String(r.tbill182Rate)),
        tbill364Rate: parseFloat(String(r.tbill364Rate)),
        ifbCouponRate: parseFloat(String(r.ifbCouponRate)),
        fxdCouponRate: parseFloat(String(r.fxdCouponRate)),
        withholdingTax: parseFloat(String(r.withholdingTax)),
      }));
      const results = runProjection(settings, mappedOverrides, rateHistory2);

      // Build start date — normalise to noon UTC to avoid timezone off-by-one
      const rawStartDate = dbSettings?.startDate;
      let startDateStr = "2026-07-01";
      if (rawStartDate) {
        if (rawStartDate instanceof Date) {
          startDateStr = rawStartDate.toISOString().split("T")[0];
        } else {
          startDateStr = String(rawStartDate).split("T")[0];
        }
      }
      const startDate = new Date(`${startDateStr}T12:00:00.000Z`);

      const entries = results.map((r) => {
        const entryDate = new Date(startDate);
        entryDate.setMonth(entryDate.getMonth() + r.monthNumber - 1);
        return {
          userId: ctx.user.id,
          monthNumber: r.monthNumber,
          entryDate: entryDate,
          contribution: String(r.contribution),
          cbkCashIn: String(r.cbkCashIn),
          mmfToDhow: String(r.mmfToDhow),
          mainAction: r.mainAction,
          mmfEndBalance: String(r.mmfEnd),
          tbillEndBalance: String(r.tbillEnd),
          ifbEndBalance: String(r.ifbEnd),
          fxdEndBalance: String(r.fxdEnd),
          totalEndBalance: String(r.totalEnd),
          isActual: false,
        };
      });

      await bulkUpsertLedgerEntries(entries);
      return { success: true, count: entries.length };
    }),
  }),

  // ─── Securities ───────────────────────────────────────────────────────────────
  securities: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getSecurities(ctx.user.id);
    }),

    add: protectedProcedure
      .input(
        z.object({
          securityType: z.enum(["tbill_91", "tbill_182", "tbill_364", "ifb", "fxd"]),
          faceValue: z.number().min(50000),
          issueDate: z.string(),
          maturityDate: z.string(),
          couponRate: z.number().min(0).max(50),
          isTaxExempt: z.boolean(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await addSecurity({
          userId: ctx.user.id,
          securityType: input.securityType,
          faceValue: String(input.faceValue),
          issueDate: new Date(input.issueDate),
          maturityDate: new Date(input.maturityDate),
          couponRate: String(input.couponRate),
          isTaxExempt: input.isTaxExempt,
          notes: input.notes,
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          isMatured: z.boolean().optional(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await updateSecurity(input.id, {
          isMatured: input.isMatured,
          notes: input.notes,
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteSecurity(input.id);
        return { success: true };
      }),
  }),

  // ─── Deposit Entries (Live Actuals) ──────────────────────────────────────────
  deposits: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getDepositEntries(ctx.user.id);
    }),

    add: protectedProcedure
      .input(
        z.object({
          bucket: z.enum(["mmf", "tbill", "ifb", "fxd"]),
          amount: z.number().positive(),
          depositDate: z.string(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const entry = await addDepositEntry({
          userId: ctx.user.id,
          bucket: input.bucket,
          amount: String(input.amount),
          depositDate: new Date(input.depositDate),
          notes: input.notes,
        });
        return { success: true, entry };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteDepositEntry(input.id, ctx.user.id);
        return { success: true };
      }),

    summary: protectedProcedure.query(async ({ ctx }) => {
      const dbSettings = await getRateSettings(ctx.user.id);
      const settings = dbSettingsToEngine(dbSettings);
      if (dbSettings?.startDate) {
        settings.startDate = dbSettings.startDate instanceof Date
          ? dbSettings.startDate.toISOString().split("T")[0]
          : String(dbSettings.startDate).split("T")[0];
      } else {
        settings.startDate = "2026-07-01";
      }
      // Use engine as single source of tax truth (Fix 4)
      const rateHistoryRows = await getRateHistory(ctx.user.id);
      const rateHistory = rateHistoryRows.map((r) => ({
        effectiveDate: r.effectiveDate instanceof Date
          ? r.effectiveDate.toISOString().split("T")[0]
          : String(r.effectiveDate).split("T")[0],
        mmfYield: parseFloat(String(r.mmfYield)),
        tbill91Rate: parseFloat(String(r.tbill91Rate)),
        tbill182Rate: parseFloat(String(r.tbill182Rate)),
        tbill364Rate: parseFloat(String(r.tbill364Rate)),
        ifbCouponRate: parseFloat(String(r.ifbCouponRate)),
        fxdCouponRate: parseFloat(String(r.fxdCouponRate)),
        withholdingTax: parseFloat(String(r.withholdingTax)),
      }));
      const depositRows = await getDepositEntries(ctx.user.id);
      const actualDeposits: ActualDeposit[] = depositRows.map((d) => ({
        bucket: d.bucket as "mmf" | "tbill" | "ifb" | "fxd",
        amount: parseFloat(String(d.amount)),
        depositDate: d.depositDate instanceof Date
          ? d.depositDate.toISOString().split("T")[0]
          : String(d.depositDate).split("T")[0],
      }));
      const securityRows = await getSecurities(ctx.user.id);
      const actualSecurities: ActualSecurity[] = securityRows.map((s) => ({
        securityType: s.securityType as ActualSecurity["securityType"],
        faceValue: parseFloat(String(s.faceValue)),
        issueDate: s.issueDate instanceof Date
          ? s.issueDate.toISOString().split("T")[0]
          : String(s.issueDate).split("T")[0],
        maturityDate: s.maturityDate instanceof Date
          ? s.maturityDate.toISOString().split("T")[0]
          : String(s.maturityDate).split("T")[0],
        couponRate: parseFloat(String(s.couponRate)),
        isTaxExempt: s.isTaxExempt,
        isMatured: s.isMatured,
      }));
      const overrides = await getContributionOverrides(ctx.user.id);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      const projResults = runProjection(settings, mappedOverrides, rateHistory, actualDeposits, actualSecurities);
      // Accumulate WHT from engine output
      const annualWHT = projResults.reduce((sum, r) => sum + r.whtThisMonth, 0);
      // Bucket totals from actuals
      const byBucket = { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };
      let totalContributed = 0;
      for (const d of depositRows) {
        const amt = parseFloat(String(d.amount));
        totalContributed += amt;
        byBucket[d.bucket as keyof typeof byBucket] += amt;
      }
      const remainingToTarget = Math.max(0, settings.targetAmount - totalContributed);
      return {
        totalContributed,
        remainingToTarget,
        taxLiability: Math.round(annualWHT * 100) / 100,
        taxBreakdown: { mmf: 0, tbill: 0, ifb: 0, fxd: Math.round(annualWHT * 100) / 100 },
        annualFxdCouponIncome: byBucket.fxd * (settings.fxdCouponRate / 100),
        byBucket,
        entryCount: depositRows.length,
      };
    }),
  }),

  // ─── Contribution Overrides ───────────────────────────────────────────────────
  contributions: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getContributionOverrides(ctx.user.id);
    }),

    upsert: protectedProcedure
      .input(
        z.object({
          monthNumber: z.number().int().min(1).max(120),
          overrideAmount: z.number().min(0).optional(),
          lumpSum: z.number().min(0).optional(),
          reason: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        await upsertContributionOverride({
          userId: ctx.user.id,
          monthNumber: input.monthNumber,
          overrideAmount: input.overrideAmount !== undefined ? String(input.overrideAmount) : "0",
          lumpSum: input.lumpSum !== undefined ? String(input.lumpSum) : "0",
          reason: input.reason,
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ monthNumber: z.number().int().min(1).max(120) }))
      .mutation(async ({ ctx, input }) => {
        await deleteContributionOverride(ctx.user.id, input.monthNumber);
        return { success: true };
      }),
  }),

  // ─── Rate History ──────────────────────────────────────────────────────────────
  rateHistory: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await getRateHistory(ctx.user.id);
      return rows.map((r) => ({
        id: r.id,
        effectiveDate: r.effectiveDate instanceof Date
          ? r.effectiveDate.toISOString().split("T")[0]
          : String(r.effectiveDate).split("T")[0],
        mmfYield: parseFloat(String(r.mmfYield)),
        tbill91Rate: parseFloat(String(r.tbill91Rate)),
        tbill364Rate: parseFloat(String(r.tbill364Rate)),
        ifbCouponRate: parseFloat(String(r.ifbCouponRate)),
        fxdCouponRate: parseFloat(String(r.fxdCouponRate)),
        withholdingTax: parseFloat(String(r.withholdingTax)),
        changeNote: r.changeNote,
        createdAt: r.createdAt,
      }));
    }),
  }),

  // ─── Account Status (Getting Started) ─────────────────────────────────────────
  accountStatus: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await getAccountStatuses(ctx.user.id);
      return rows.map((r) => ({
        id: r.id,
        accountType: r.accountType,
        isOpened: r.isOpened,
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        dateOpened: r.dateOpened instanceof Date
          ? r.dateOpened.toISOString().split("T")[0]
          : r.dateOpened ? String(r.dateOpened).split("T")[0] : null,
        phoneNumber: r.phoneNumber,
        notes: r.notes,
        updatedAt: r.updatedAt,
      }));
    }),

    upsert: protectedProcedure
      .input(z.object({
        accountType: z.enum(["mmf", "dhowcsd"]),
        isOpened: z.boolean(),
        accountNumber: z.string().optional(),
        accountName: z.string().optional(),
        dateOpened: z.string().optional(),
        phoneNumber: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertAccountStatus({
          userId: ctx.user.id,
          accountType: input.accountType,
          isOpened: input.isOpened,
          accountNumber: input.accountNumber ?? null,
          accountName: input.accountName ?? null,
          dateOpened: input.dateOpened ? new Date(`${input.dateOpened}T12:00:00.000Z`) : null,
          phoneNumber: input.phoneNumber ?? null,
          notes: input.notes ?? null,
        });
        return { success: true };
      }),
  }),
  // ─── Rate Refresh (Confirmed Auto-Fetch) ─────────────────────────────────────
  rateRefresh: router({
    /**
     * Trigger a manual rate fetch from CBK and SanlamAllianz.
     * Writes pending_rate_fetches rows — does NOT save to rate_settings.
     */
    triggerFetch: protectedProcedure.mutation(async ({ ctx }) => {
      const userId = ctx.user.id;
      const results = await fetchAllRates();

      const dbSettings = await getRateSettings(userId);
      const storedRates: Record<string, number> = {
        mmfYield: parseFloat(String(dbSettings?.mmfYield ?? "8.78")),
        tbill91Rate: parseFloat(String(dbSettings?.tbill91Rate ?? "8.8206")),
        tbill182Rate: parseFloat(String(dbSettings?.tbill182Rate ?? "8.7782")),
        tbill364Rate: parseFloat(String(dbSettings?.tbill364Rate ?? "8.9746")),
        ifbCouponRate: parseFloat(String(dbSettings?.ifbCouponRate ?? "12.5")),
        fxdCouponRate: parseFloat(String(dbSettings?.fxdCouponRate ?? "12.35")),
        withholdingTax: parseFloat(String(dbSettings?.withholdingTax ?? "15")),
      };

      await dismissAllPendingRateFetches(userId);

      let totalInserted = 0;
      const errors: string[] = [];

      for (const result of results) {
        await insertRateFetchLog({
          userId,
          source: result.source,
          success: result.success,
          errorMessage: result.errorMessage ?? null,
          fetchedAt: new Date(result.fetchedAt),
          rawPayload: result.rates.length > 0 ? JSON.stringify(result.rates) : null,
          taskUid: null,
        });

        if (!result.success) {
          errors.push(`${result.source}: ${result.errorMessage}`);
          continue;
        }

        for (const rate of result.rates) {
          const storedValue = storedRates[rate.rateField] ?? 0;
          await insertPendingRateFetch({
            userId,
            rateField: rate.rateField,
            fetchedValue: String(rate.value),
            storedValue: String(storedValue),
            sourceUrl: rate.sourceUrl,
            sourceLabel: rate.sourceLabel,
            cadenceNote: rate.cadenceNote ?? null,
            status: "pending",
          });
          totalInserted++;
        }
      }

      return { success: true, inserted: totalInserted, errors };
    }),

    /** List all pending (unconfirmed) rate fetches for the current user. */
    listPending: protectedProcedure.query(async ({ ctx }) => {
      const rows = await getPendingRateFetches(ctx.user.id);
      return rows.map((r) => ({
        id: r.id,
        rateField: r.rateField,
        fetchedValue: parseFloat(String(r.fetchedValue)),
        storedValue: parseFloat(String(r.storedValue)),
        sourceUrl: r.sourceUrl,
        sourceLabel: r.sourceLabel,
        cadenceNote: r.cadenceNote,
        fetchedAt: r.fetchedAt,
        status: r.status,
      }));
    }),

    /** Accept a single pending rate — saves it to rate_settings and rate_history. */
    acceptOne: protectedProcedure
      .input(z.object({ id: z.number(), rateField: z.string(), value: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.user.id;
        // Mark as accepted
        await updatePendingRateFetchStatus(input.id, userId, "accepted");

        // Load current settings and update the specific field
        const dbSettings = await getRateSettings(userId);
        const current = {
          mmfYield: parseFloat(String(dbSettings?.mmfYield ?? "8.78")),
          tbill91Rate: parseFloat(String(dbSettings?.tbill91Rate ?? "8.8206")),
          tbill182Rate: parseFloat(String(dbSettings?.tbill182Rate ?? "8.7782")),
          tbill364Rate: parseFloat(String(dbSettings?.tbill364Rate ?? "8.9746")),
          ifbCouponRate: parseFloat(String(dbSettings?.ifbCouponRate ?? "12.5")),
          fxdCouponRate: parseFloat(String(dbSettings?.fxdCouponRate ?? "12.35")),
          withholdingTax: parseFloat(String(dbSettings?.withholdingTax ?? "15")),
        };
        const updated = { ...current, [input.rateField]: input.value };

        const rawDate = dbSettings?.startDate;
        const startDateStr = rawDate
          ? (rawDate instanceof Date ? rawDate.toISOString().split("T")[0] : String(rawDate).split("T")[0])
          : "2026-07-01";

        await upsertRateSettings({
          userId,
          mmfYield: String(updated.mmfYield),
          tbill91Rate: String(updated.tbill91Rate),
          tbill182Rate: String(updated.tbill182Rate),
          tbill364Rate: String(updated.tbill364Rate),
          ifbCouponRate: String(updated.ifbCouponRate),
          fxdCouponRate: String(updated.fxdCouponRate),
          withholdingTax: String(updated.withholdingTax),
          startDate: new Date(`${startDateStr}T12:00:00.000Z`),
          startingContribution: String(dbSettings?.startingContribution ?? "2500"),
          stepUpAmount: String(dbSettings?.stepUpAmount ?? "3000"),
          stepUpMonths: dbSettings?.stepUpMonths ?? 6,
          safetyFloor: String(dbSettings?.safetyFloor ?? "50000"),
          targetAmount: String(dbSettings?.targetAmount ?? "5000000"),
        });

        // Snapshot to rate_history
        const today = new Date().toISOString().split("T")[0];
        await addRateHistorySnapshot({
          userId,
          effectiveDate: new Date(`${today}T12:00:00.000Z`),
          mmfYield: String(updated.mmfYield),
          tbill91Rate: String(updated.tbill91Rate),
          tbill182Rate: String(updated.tbill182Rate),
          tbill364Rate: String(updated.tbill364Rate),
          ifbCouponRate: String(updated.ifbCouponRate),
          fxdCouponRate: String(updated.fxdCouponRate),
          withholdingTax: String(updated.withholdingTax),
          changeNote: `Rate update: ${input.rateField} → ${input.value} (auto-fetched, user-confirmed)`,
        });

        invalidateMilestoneCache();
        return { success: true };
      }),

    /** Accept all pending rates at once. */
    acceptAll: protectedProcedure.mutation(async ({ ctx }) => {
      const userId = ctx.user.id;
      const pending = await getPendingRateFetches(userId);
      if (pending.length === 0) return { success: true, accepted: 0 };

      const dbSettings = await getRateSettings(userId);
      const current: Record<string, number> = {
        mmfYield: parseFloat(String(dbSettings?.mmfYield ?? "8.78")),
        tbill91Rate: parseFloat(String(dbSettings?.tbill91Rate ?? "8.8206")),
        tbill182Rate: parseFloat(String(dbSettings?.tbill182Rate ?? "8.7782")),
        tbill364Rate: parseFloat(String(dbSettings?.tbill364Rate ?? "8.9746")),
        ifbCouponRate: parseFloat(String(dbSettings?.ifbCouponRate ?? "12.5")),
        fxdCouponRate: parseFloat(String(dbSettings?.fxdCouponRate ?? "12.35")),
        withholdingTax: parseFloat(String(dbSettings?.withholdingTax ?? "15")),
      };

      for (const row of pending) {
        current[row.rateField] = parseFloat(String(row.fetchedValue));
        await updatePendingRateFetchStatus(row.id, userId, "accepted");
      }

      const rawDate = dbSettings?.startDate;
      const startDateStr = rawDate
        ? (rawDate instanceof Date ? rawDate.toISOString().split("T")[0] : String(rawDate).split("T")[0])
        : "2026-07-01";

      await upsertRateSettings({
        userId,
        mmfYield: String(current.mmfYield),
        tbill91Rate: String(current.tbill91Rate),
        tbill182Rate: String(current.tbill182Rate),
        tbill364Rate: String(current.tbill364Rate),
        ifbCouponRate: String(current.ifbCouponRate),
        fxdCouponRate: String(current.fxdCouponRate),
        withholdingTax: String(current.withholdingTax),
        startDate: new Date(`${startDateStr}T12:00:00.000Z`),
        startingContribution: String(dbSettings?.startingContribution ?? "2500"),
        stepUpAmount: String(dbSettings?.stepUpAmount ?? "3000"),
        stepUpMonths: dbSettings?.stepUpMonths ?? 6,
        safetyFloor: String(dbSettings?.safetyFloor ?? "50000"),
        targetAmount: String(dbSettings?.targetAmount ?? "5000000"),
      });

      const today = new Date().toISOString().split("T")[0];
      await addRateHistorySnapshot({
        userId,
        effectiveDate: new Date(`${today}T12:00:00.000Z`),
        mmfYield: String(current.mmfYield),
        tbill91Rate: String(current.tbill91Rate),
        tbill182Rate: String(current.tbill182Rate),
        tbill364Rate: String(current.tbill364Rate),
        ifbCouponRate: String(current.ifbCouponRate),
        fxdCouponRate: String(current.fxdCouponRate),
        withholdingTax: String(current.withholdingTax),
        changeNote: `Bulk rate update from auto-fetch (user-confirmed ${pending.length} rates)`,
      });

      invalidateMilestoneCache();
      return { success: true, accepted: pending.length };
    }),

    /** Dismiss a single pending fetch without saving. */
    dismissOne: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await updatePendingRateFetchStatus(input.id, ctx.user.id, "dismissed");
        return { success: true };
      }),

    /** Dismiss all pending fetches. */
    dismissAll: protectedProcedure.mutation(async ({ ctx }) => {
      await dismissAllPendingRateFetches(ctx.user.id);
      return { success: true };
    }),

    /** Get staleness info: last successful fetch per source. */
    fetchStatus: protectedProcedure.query(async ({ ctx }) => {
      const rows = await getLastFetchAttempts(ctx.user.id);
      return rows.map((r) => ({
        source: r.source,
        success: r.success,
        fetchedAt: r.fetchedAt,
        errorMessage: r.errorMessage,
      }));
    }),
  }),
});

export type AppRouter = typeof appRouter;
