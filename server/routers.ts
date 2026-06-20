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
} from "./db";
import {
  runProjection,
  runScenarios,
  checkMilestones,
  getScheduledContribution,
  YEAR_MILESTONES,
  SCENARIO_STEPUPS,
  type EngineSettings,
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
      return {
        ...dbSettingsToEngine(s),
        startDate: s.startDate ?? "2026-07-01",
      };
    }),

    save: protectedProcedure.input(rateSettingsInput).mutation(async ({ ctx, input }) => {
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
        startDate: new Date(input.startDate ?? "2026-07-01"),
      });
      return { success: true };
    }),
  }),

  // ─── Projection Engine ────────────────────────────────────────────────────────
  projection: router({
    run: protectedProcedure.query(async ({ ctx }) => {
      const dbSettings = await getRateSettings(ctx.user.id);
      const settings = dbSettingsToEngine(dbSettings);
      const overrides = await getContributionOverrides(ctx.user.id);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      const results = runProjection(settings, mappedOverrides);
      return results;
    }),

    scenarios: protectedProcedure.query(async ({ ctx }) => {
      const dbSettings = await getRateSettings(ctx.user.id);
      const settings = dbSettingsToEngine(dbSettings);
      return runScenarios(settings, SCENARIO_STEPUPS);
    }),

    milestones: publicProcedure.query(() => YEAR_MILESTONES),

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
      const results = runProjection(settings, mappedOverrides);

      // Build start date
      const startDate = new Date(dbSettings?.startDate ?? "2026-07-01");

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
      const summary = await getActualsSummary(
        ctx.user.id,
        settings.targetAmount,
        settings.withholdingTax,
        settings.fxdCouponRate,
        settings.mmfYield,
        settings.tbill364Rate
      );
      return summary ?? {
        totalContributed: 0,
        remainingToTarget: settings.targetAmount,
        taxLiability: 0,
        taxBreakdown: { mmf: 0, tbill: 0, ifb: 0, fxd: 0 },
        annualFxdCouponIncome: 0,
        byBucket: { mmf: 0, tbill: 0, ifb: 0, fxd: 0 },
        entryCount: 0,
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
});

export type AppRouter = typeof appRouter;
