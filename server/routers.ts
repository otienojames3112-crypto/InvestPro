import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getPortfolios,
  getPortfolio,
  createPortfolio,
  updatePortfolio,
  deletePortfolio,
  ensureRateSettings,
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
  addRateHistorySnapshot,
  getRateHistory,
  getAccountStatuses,
  upsertAccountStatus,
  getMmfFunds,
  getMmfFund,
  addMmfFund,
  updateMmfFund,
  deactivateMmfFund,
  setPortfolioMmfFund,
  getOtherHoldings,
  addOtherHolding,
  updateOtherHolding,
  deleteOtherHolding,
  getHoldingIncome,
  addHoldingIncome,
  deleteHoldingIncome,
} from "./db";
import {
  runProjection,
  runScenarios,
  checkMilestones,
  getScheduledContribution,
  generateMilestones,
  solveForContribution,
  SCENARIO_STEPUPS,
  type EngineSettings,
  type ActualDeposit,
  type ActualSecurity,
} from "./engine";
import { COOKIE_NAME } from "../shared/const";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.8206,
  tbill182Rate: 8.7782,
  tbill364Rate: 8.9746,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  horizonMonths: 120,
};

/**
 * Convert a DB rate_settings row + portfolio row into an EngineSettings object.
 * Plan-level fields (contribution schedule, target, horizon) come from the portfolio;
 * rate fields come from rate_settings.
 */
function dbToEngine(
  rates: Awaited<ReturnType<typeof getRateSettings>>,
  portfolio: Awaited<ReturnType<typeof getPortfolio>>,
  selectedFundEar?: number | null
): EngineSettings {
  const r = rates;
  const p = portfolio;
  // If a fund is selected, use its EAR as the MMF gross yield (WHT applied in engine).
  // Otherwise fall back to the manually-entered mmfYield from rate_settings.
  const mmfYield = selectedFundEar != null
    ? selectedFundEar
    : (r ? parseFloat(String(r.mmfYield)) : DEFAULT_SETTINGS.mmfYield);
  return {
    mmfYield,
    tbill91Rate: r ? parseFloat(String(r.tbill91Rate)) : DEFAULT_SETTINGS.tbill91Rate,
    tbill182Rate: r ? parseFloat(String(r.tbill182Rate)) : DEFAULT_SETTINGS.tbill182Rate,
    tbill364Rate: r ? parseFloat(String(r.tbill364Rate)) : DEFAULT_SETTINGS.tbill364Rate,
    ifbCouponRate: r ? parseFloat(String(r.ifbCouponRate)) : DEFAULT_SETTINGS.ifbCouponRate,
    fxdCouponRate: r ? parseFloat(String(r.fxdCouponRate)) : DEFAULT_SETTINGS.fxdCouponRate,
    withholdingTax: r ? parseFloat(String(r.withholdingTax)) : DEFAULT_SETTINGS.withholdingTax,
    startingContribution: p ? parseFloat(String(p.startingContribution)) : DEFAULT_SETTINGS.startingContribution,
    stepUpAmount: p ? parseFloat(String(p.stepUpAmount)) : DEFAULT_SETTINGS.stepUpAmount,
    stepUpMonths: p ? p.stepUpMonths : DEFAULT_SETTINGS.stepUpMonths,
    safetyFloor: p ? parseFloat(String(p.safetyFloor)) : DEFAULT_SETTINGS.safetyFloor,
    targetAmount: p ? parseFloat(String(p.targetAmount)) : DEFAULT_SETTINGS.targetAmount,
    horizonMonths: p ? p.horizonMonths : DEFAULT_SETTINGS.horizonMonths,
    startDate: p ? normaliseDate(p.startDate) : "2026-07-01",
    phaseFractions: p ? {
      foundationFrac: parseFloat(String(p.foundationFrac)),
      growthFrac: parseFloat(String(p.growthFrac)),
      deRiskingFrac: parseFloat(String(p.deRiskingFrac)),
    } : undefined,
  };
}

function normaliseDate(d: Date | string | null | undefined): string {
  if (!d) return "2026-07-01";
  if (d instanceof Date) return d.toISOString().split("T")[0];
  return String(d).split("T")[0];
}

/** Fetch the EAR of the portfolio's selected MMF fund, or null if none is set. */
async function getSelectedFundEar(portfolio: Awaited<ReturnType<typeof getPortfolio>>): Promise<number | null> {
  if (!portfolio?.mmfFundId) return null;
  const fund = await getMmfFund(portfolio.mmfFundId);
  return fund ? parseFloat(String(fund.ear)) : null;
}

function mapRateHistory(rows: Awaited<ReturnType<typeof getRateHistory>>) {
  return rows.map((r) => ({
    effectiveDate: normaliseDate(r.effectiveDate),
    mmfYield: parseFloat(String(r.mmfYield)),
    tbill91Rate: parseFloat(String(r.tbill91Rate)),
    tbill182Rate: parseFloat(String(r.tbill182Rate)),
    tbill364Rate: parseFloat(String(r.tbill364Rate)),
    ifbCouponRate: parseFloat(String(r.ifbCouponRate)),
    fxdCouponRate: parseFloat(String(r.fxdCouponRate)),
    withholdingTax: parseFloat(String(r.withholdingTax)),
  }));
}

function mapActualDeposits(rows: Awaited<ReturnType<typeof getDepositEntries>>): ActualDeposit[] {
  return rows.map((d) => ({
    bucket: d.bucket as "mmf" | "tbill" | "ifb" | "fxd",
    amount: parseFloat(String(d.amount)),
    depositDate: normaliseDate(d.depositDate),
  }));
}

function mapActualSecurities(rows: Awaited<ReturnType<typeof getSecurities>>): ActualSecurity[] {
  return rows.map((s) => ({
    securityType: s.securityType as ActualSecurity["securityType"],
    faceValue: parseFloat(String(s.faceValue)),
    issueDate: normaliseDate(s.issueDate),
    maturityDate: normaliseDate(s.maturityDate),
    couponRate: parseFloat(String(s.couponRate)),
    isTaxExempt: s.isTaxExempt,
    isMatured: s.isMatured,
  }));
}

/** Verify the portfolio belongs to the requesting user. Throws FORBIDDEN if not. */
async function requirePortfolio(portfolioId: number, userId: number) {
  const p = await getPortfolio(portfolioId, userId);
  if (!p) throw new TRPCError({ code: "FORBIDDEN", message: "Portfolio not found or access denied." });
  return p;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const portfolioIdInput = z.object({ portfolioId: z.number().int().positive() });

const portfolioCreateInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  targetAmount: z.number().min(1),
  startDate: z.string(),
  horizonMonths: z.number().int().min(12).max(240),
  startingContribution: z.number().min(0),
  stepUpAmount: z.number().min(0),
  stepUpMonths: z.number().int().min(1).max(24),
  safetyFloor: z.number().min(0),
  foundationFrac: z.number().min(0.05).max(0.5).optional(),
  growthFrac: z.number().min(0.1).max(0.7).optional(),
  deRiskingFrac: z.number().min(0.05).max(0.4).optional(),
});

const rateOnlyInput = z.object({
  portfolioId: z.number().int().positive(),
  mmfYield: z.number().min(0).max(100),
  tbill91Rate: z.number().min(0).max(100),
  tbill182Rate: z.number().min(0).max(100),
  tbill364Rate: z.number().min(0).max(100),
  ifbCouponRate: z.number().min(0).max(100),
  fxdCouponRate: z.number().min(0).max(100),
  withholdingTax: z.number().min(0).max(100),
  cbkSourceUrl: z.string().url().max(500).optional(),
  sanlamSourceUrl: z.string().url().max(500).optional(),
  changeNote: z.string().max(500).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

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

  // ─── Portfolios ─────────────────────────────────────────────────────────────
  portfolios: router({
    /** List all portfolios owned by the current user. */
    list: protectedProcedure.query(async ({ ctx }) => {
      const rows = await getPortfolios(ctx.user.id);
      return rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        targetAmount: parseFloat(String(p.targetAmount)),
        startDate: normaliseDate(p.startDate),
        horizonMonths: p.horizonMonths,
        startingContribution: parseFloat(String(p.startingContribution)),
        stepUpAmount: parseFloat(String(p.stepUpAmount)),
        stepUpMonths: p.stepUpMonths,
        safetyFloor: parseFloat(String(p.safetyFloor)),
        foundationFrac: parseFloat(String(p.foundationFrac)),
        growthFrac: parseFloat(String(p.growthFrac)),
        deRiskingFrac: parseFloat(String(p.deRiskingFrac)),
        cbkSourceUrl: p.cbkSourceUrl,
        sanlamSourceUrl: p.sanlamSourceUrl,
        ratesLastUpdatedAt: p.ratesLastUpdatedAt ?? null,
        mmfFundId: p.mmfFundId ?? null,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      }));
    }),

    /** Get a single portfolio by ID (must belong to current user). */
    get: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        targetAmount: parseFloat(String(p.targetAmount)),
        startDate: normaliseDate(p.startDate),
        horizonMonths: p.horizonMonths,
        startingContribution: parseFloat(String(p.startingContribution)),
        stepUpAmount: parseFloat(String(p.stepUpAmount)),
        stepUpMonths: p.stepUpMonths,
        safetyFloor: parseFloat(String(p.safetyFloor)),
        foundationFrac: parseFloat(String(p.foundationFrac)),
        growthFrac: parseFloat(String(p.growthFrac)),
        deRiskingFrac: parseFloat(String(p.deRiskingFrac)),
        cbkSourceUrl: p.cbkSourceUrl,
        sanlamSourceUrl: p.sanlamSourceUrl,
        ratesLastUpdatedAt: p.ratesLastUpdatedAt ?? null,
        mmfFundId: p.mmfFundId ?? null,
        createdAt: p.createdAt,
      };
    }),

    /** Create a new portfolio. Also creates a default rate_settings row for it. */
    create: protectedProcedure.input(portfolioCreateInput).mutation(async ({ ctx, input }) => {
      const p = await createPortfolio({
        userId: ctx.user.id,
        name: input.name,
        description: input.description,
        targetAmount: String(input.targetAmount),
        startDate: new Date(`${input.startDate}T12:00:00.000Z`),
        horizonMonths: input.horizonMonths,
        startingContribution: String(input.startingContribution),
        stepUpAmount: String(input.stepUpAmount),
        stepUpMonths: input.stepUpMonths,
        safetyFloor: String(input.safetyFloor),
        foundationFrac: String(input.foundationFrac ?? 0.20),
        growthFrac: String(input.growthFrac ?? 0.50),
        deRiskingFrac: String(input.deRiskingFrac ?? 0.15),
      });
      if (!p) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create portfolio." });
      // Ensure a rate_settings row exists
      await ensureRateSettings(p.id);
      return { success: true, portfolioId: p.id };
    }),

    /** Update plan-level settings for a portfolio. */
    update: protectedProcedure
      .input(portfolioCreateInput.extend({ portfolioId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await updatePortfolio(input.portfolioId, ctx.user.id, {
          name: input.name,
          description: input.description,
          targetAmount: String(input.targetAmount),
          startDate: new Date(`${input.startDate}T12:00:00.000Z`),
          horizonMonths: input.horizonMonths,
          startingContribution: String(input.startingContribution),
          stepUpAmount: String(input.stepUpAmount),
          stepUpMonths: input.stepUpMonths,
          safetyFloor: String(input.safetyFloor),
          foundationFrac: String(input.foundationFrac ?? 0.20),
          growthFrac: String(input.growthFrac ?? 0.50),
          deRiskingFrac: String(input.deRiskingFrac ?? 0.15),
        });
        return { success: true };
      }),

    /** Delete a portfolio and all its child data. */
    delete: protectedProcedure.input(portfolioIdInput).mutation(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      await deletePortfolio(input.portfolioId, ctx.user.id);
      return { success: true };
    }),
  }),

  // ─── Rate Settings (per-portfolio) ──────────────────────────────────────────
  settings: router({
    /** Get rate settings for a portfolio. */
    get: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const r = await getRateSettings(input.portfolioId);
      return {
        // Rate fields
        mmfYield: r ? parseFloat(String(r.mmfYield)) : DEFAULT_SETTINGS.mmfYield,
        tbill91Rate: r ? parseFloat(String(r.tbill91Rate)) : DEFAULT_SETTINGS.tbill91Rate,
        tbill182Rate: r ? parseFloat(String(r.tbill182Rate)) : DEFAULT_SETTINGS.tbill182Rate,
        tbill364Rate: r ? parseFloat(String(r.tbill364Rate)) : DEFAULT_SETTINGS.tbill364Rate,
        ifbCouponRate: r ? parseFloat(String(r.ifbCouponRate)) : DEFAULT_SETTINGS.ifbCouponRate,
        fxdCouponRate: r ? parseFloat(String(r.fxdCouponRate)) : DEFAULT_SETTINGS.fxdCouponRate,
        withholdingTax: r ? parseFloat(String(r.withholdingTax)) : DEFAULT_SETTINGS.withholdingTax,
        // Source URLs (from portfolio)
        cbkSourceUrl: p.cbkSourceUrl,
        sanlamSourceUrl: p.sanlamSourceUrl,
        ratesLastUpdatedAt: p.ratesLastUpdatedAt ?? null,
      };
    }),

    /** Get rate history for a portfolio. */
    getRateHistory: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      const rows = await getRateHistory(input.portfolioId);
      return rows.map((r) => ({
        id: r.id,
        effectiveDate: normaliseDate(r.effectiveDate),
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

  // ─── Projection Engine ────────────────────────────────────────────────────────
  projection: router({
    run: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const overrides = await getContributionOverrides(input.portfolioId);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      const rateHistoryRows = await getRateHistory(input.portfolioId);
      const rh = mapRateHistory(rateHistoryRows);
      const depositRows = await getDepositEntries(input.portfolioId);
      const actualDeposits = mapActualDeposits(depositRows);
      const securityRows = await getSecurities(input.portfolioId);
      const actualSecurities = mapActualSecurities(securityRows);
      return runProjection(settings, mappedOverrides, rh, actualDeposits, actualSecurities);
    }),

    scenarios: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const rateHistoryRows = await getRateHistory(input.portfolioId);
      const rh = mapRateHistory(rateHistoryRows);
      return runScenarios(settings, SCENARIO_STEPUPS, rh);
    }),

    milestones: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      return generateMilestones(settings);
    }),

    contributionSchedule: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const horizonMonths = settings.horizonMonths ?? 120;
      const schedule = [];
      for (let m = 1; m <= horizonMonths; m += settings.stepUpMonths) {
        const end = Math.min(m + settings.stepUpMonths - 1, horizonMonths);
        const amount = getScheduledContribution(m, settings);
        const periodTotal = amount * (end - m + 1);
        schedule.push({
          startMonth: m,
          endMonth: end,
          monthlyAmount: amount,
          sixMonthTotal: periodTotal,
        });
      }
      return schedule;
    }),

    /**
     * Backwards solver: compute the required starting contribution to reach the portfolio target.
     * @param stepUpAmount - Step-up amount to use (0 = flat contributions). Defaults to portfolio setting.
     */
    solve: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        stepUpAmount: z.number().min(0).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
        const settings = dbToEngine(rates, p, fundEar);
        const rateHistoryRows = await getRateHistory(input.portfolioId);
        const rh = mapRateHistory(rateHistoryRows);
        const stepUp = input.stepUpAmount ?? settings.stepUpAmount;
        return solveForContribution(settings, stepUp, rh);
      }),
  }),

  // ─── Ledger ───────────────────────────────────────────────────────────────────
  ledger: router({
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      return getLedgerEntries(input.portfolioId);
    }),

    sync: protectedProcedure.input(portfolioIdInput).mutation(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const overrides = await getContributionOverrides(input.portfolioId);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      const rateHistoryRows = await getRateHistory(input.portfolioId);
      const rh = mapRateHistory(rateHistoryRows);
      const results = runProjection(settings, mappedOverrides, rh);

      const startDate = new Date(`${settings.startDate}T12:00:00.000Z`);
      const entries = results.map((r) => {
        const entryDate = new Date(startDate);
        entryDate.setMonth(entryDate.getMonth() + r.monthNumber - 1);
        return {
          portfolioId: input.portfolioId,
          monthNumber: r.monthNumber,
          entryDate,
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
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      return getSecurities(input.portfolioId);
    }),

    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        securityType: z.enum(["tbill_91", "tbill_182", "tbill_364", "ifb", "fxd"]),
        faceValue: z.number().min(50000),
        issueDate: z.string(),
        maturityDate: z.string(),
        couponRate: z.number().min(0).max(50),
        isTaxExempt: z.boolean(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addSecurity({
          portfolioId: input.portfolioId,
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
      .input(z.object({
        id: z.number(),
        isMatured: z.boolean().optional(),
        notes: z.string().optional(),
      }))
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
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      return getDepositEntries(input.portfolioId);
    }),

    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        bucket: z.enum(["mmf", "tbill", "ifb", "fxd"]),
        amount: z.number().positive(),
        depositDate: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const entry = await addDepositEntry({
          portfolioId: input.portfolioId,
          bucket: input.bucket,
          amount: String(input.amount),
          depositDate: new Date(input.depositDate),
          notes: input.notes,
        });
        return { success: true, entry };
      }),

    delete: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteDepositEntry(input.id, input.portfolioId);
        return { success: true };
      }),

    summary: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const rateHistoryRows = await getRateHistory(input.portfolioId);
      const rh = mapRateHistory(rateHistoryRows);
      const depositRows = await getDepositEntries(input.portfolioId);
      const actualDeposits = mapActualDeposits(depositRows);
      const securityRows = await getSecurities(input.portfolioId);
      const actualSecurities = mapActualSecurities(securityRows);
      const overrides = await getContributionOverrides(input.portfolioId);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      const projResults = runProjection(settings, mappedOverrides, rh, actualDeposits, actualSecurities);
      const annualWHT = projResults.reduce((sum, r) => sum + r.whtThisMonth, 0);
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
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      return getContributionOverrides(input.portfolioId);
    }),

    upsert: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        monthNumber: z.number().int().min(1).max(240),
        overrideAmount: z.number().min(0).optional(),
        lumpSum: z.number().min(0).optional(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await upsertContributionOverride({
          portfolioId: input.portfolioId,
          monthNumber: input.monthNumber,
          overrideAmount: input.overrideAmount !== undefined ? String(input.overrideAmount) : "0",
          lumpSum: input.lumpSum !== undefined ? String(input.lumpSum) : "0",
          reason: input.reason,
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), monthNumber: z.number().int().min(1).max(240) }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteContributionOverride(input.portfolioId, input.monthNumber);
        return { success: true };
      }),
  }),

  // ─── Rate History ──────────────────────────────────────────────────────────────
  rateHistory: router({
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      const rows = await getRateHistory(input.portfolioId);
      return rows.map((r) => ({
        id: r.id,
        effectiveDate: normaliseDate(r.effectiveDate),
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
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      const rows = await getAccountStatuses(input.portfolioId);
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
        portfolioId: z.number().int().positive(),
        accountType: z.enum(["mmf", "dhowcsd"]),
        isOpened: z.boolean(),
        accountNumber: z.string().optional(),
        accountName: z.string().optional(),
        dateOpened: z.string().optional(),
        phoneNumber: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await upsertAccountStatus({
          portfolioId: input.portfolioId,
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

  // ─── Manual Rate Update ("Update Rates" panel) ──────────────────────────────
  rateUpdate: router({
    save: protectedProcedure
      .input(rateOnlyInput)
      .mutation(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const now = new Date();

        await upsertRateSettings({
          portfolioId: input.portfolioId,
          mmfYield: String(input.mmfYield),
          tbill91Rate: String(input.tbill91Rate),
          tbill182Rate: String(input.tbill182Rate),
          tbill364Rate: String(input.tbill364Rate),
          ifbCouponRate: String(input.ifbCouponRate),
          fxdCouponRate: String(input.fxdCouponRate),
          withholdingTax: String(input.withholdingTax),
        });

        // Update source URLs and ratesLastUpdatedAt on the portfolio
        await updatePortfolio(input.portfolioId, ctx.user.id, {
          cbkSourceUrl: input.cbkSourceUrl ?? p.cbkSourceUrl,
          sanlamSourceUrl: input.sanlamSourceUrl ?? p.sanlamSourceUrl,
          ratesLastUpdatedAt: now,
        });

        const today = now.toISOString().split("T")[0];
        await addRateHistorySnapshot({
          portfolioId: input.portfolioId,
          effectiveDate: new Date(`${today}T12:00:00.000Z`),
          mmfYield: String(input.mmfYield),
          tbill91Rate: String(input.tbill91Rate),
          tbill182Rate: String(input.tbill182Rate),
          tbill364Rate: String(input.tbill364Rate),
          ifbCouponRate: String(input.ifbCouponRate),
          fxdCouponRate: String(input.fxdCouponRate),
          withholdingTax: String(input.withholdingTax),
          changeNote: input.changeNote ?? "Manual rate update",
        });

        return { success: true, updatedAt: now };
      }),

    saveSourceUrls: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        cbkSourceUrl: z.string().url().max(500),
        sanlamSourceUrl: z.string().url().max(500),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await updatePortfolio(input.portfolioId, ctx.user.id, {
          cbkSourceUrl: input.cbkSourceUrl,
          sanlamSourceUrl: input.sanlamSourceUrl,
        });
        return { success: true };
      }),
  }),

  // ─── MMF Funds ──────────────────────────────────────────────────────────────
  mmfFunds: router({
    /** List all active MMF funds ordered by EAR descending. */
    list: protectedProcedure.query(async () => {
      const rows = await getMmfFunds();
      return rows.map((f) => ({
        id: f.id,
        fundName: f.fundName,
        company: f.company,
        grossYield: parseFloat(String(f.grossYield)),
        ear: parseFloat(String(f.ear)),
        managementFee: parseFloat(String(f.managementFee)),
        minInvestment: parseFloat(String(f.minInvestment)),
        aumMillions: f.aumMillions ? parseFloat(String(f.aumMillions)) : null,
        asOfDate: f.asOfDate ? normaliseDate(f.asOfDate) : null,
        source: f.source ?? null,
        isActive: f.isActive,
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }));
    }),

    /** Add a new MMF fund. */
    add: protectedProcedure
      .input(z.object({
        fundName: z.string().min(1).max(200),
        company: z.string().min(1).max(200),
        grossYield: z.number().min(0).max(100),
        ear: z.number().min(0).max(100),
        managementFee: z.number().min(0).max(10).optional(),
        minInvestment: z.number().min(0).optional(),
        aumMillions: z.number().min(0).optional(),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        await addMmfFund({
          fundName: input.fundName,
          company: input.company,
          grossYield: String(input.grossYield),
          ear: String(input.ear),
          managementFee: input.managementFee != null ? String(input.managementFee) : undefined,
          minInvestment: input.minInvestment != null ? String(input.minInvestment) : undefined,
          aumMillions: input.aumMillions != null ? String(input.aumMillions) : undefined,
          asOfDate: input.asOfDate ? new Date(input.asOfDate) : undefined,
          source: input.source,
          isActive: true,
        });
        return { success: true };
      }),

    /** Update an MMF fund's yield / fee data. */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        fundName: z.string().min(1).max(200).optional(),
        company: z.string().min(1).max(200).optional(),
        grossYield: z.number().min(0).max(100).optional(),
        ear: z.number().min(0).max(100).optional(),
        managementFee: z.number().min(0).max(10).optional(),
        minInvestment: z.number().min(0).optional(),
        aumMillions: z.number().min(0).optional(),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...rest } = input;
        await updateMmfFund(id, {
          ...(rest.fundName !== undefined && { fundName: rest.fundName }),
          ...(rest.company !== undefined && { company: rest.company }),
          ...(rest.grossYield !== undefined && { grossYield: String(rest.grossYield) }),
          ...(rest.ear !== undefined && { ear: String(rest.ear) }),
          ...(rest.managementFee !== undefined && { managementFee: String(rest.managementFee) }),
          ...(rest.minInvestment !== undefined && { minInvestment: String(rest.minInvestment) }),
          ...(rest.aumMillions !== undefined && { aumMillions: String(rest.aumMillions) }),
          ...(rest.asOfDate !== undefined && { asOfDate: new Date(rest.asOfDate) }),
          ...(rest.source !== undefined && { source: rest.source }),
        });
        return { success: true };
      }),

    /** Deactivate (soft-delete) an MMF fund. */
    deactivate: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deactivateMmfFund(input.id);
        return { success: true };
      }),

    /** Set the selected MMF fund for a portfolio (null = use manual rate). */
    selectFund: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        mmfFundId: z.number().int().positive().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await setPortfolioMmfFund(input.portfolioId, input.mmfFundId);
        return { success: true };
      }),
  }),

  // ─── Other Holdings ─────────────────────────────────────────────────────────
  otherHoldings: router({
    /** List all holdings for a portfolio. */
    list: protectedProcedure
      .input(portfolioIdInput)
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getOtherHoldings(input.portfolioId);
        return rows.map((h) => ({
          id: h.id,
          portfolioId: h.portfolioId,
          assetClass: h.assetClass,
          name: h.name,
          description: h.description ?? null,
          purchaseValue: parseFloat(String(h.purchaseValue)),
          currentValue: parseFloat(String(h.currentValue)),
          purchaseDate: h.purchaseDate ? normaliseDate(h.purchaseDate) : null,
          notes: h.notes ?? null,
          assumedReturnConservative: h.assumedReturnConservative ? parseFloat(String(h.assumedReturnConservative)) : null,
          assumedReturnBase: h.assumedReturnBase ? parseFloat(String(h.assumedReturnBase)) : null,
          assumedReturnOptimistic: h.assumedReturnOptimistic ? parseFloat(String(h.assumedReturnOptimistic)) : null,
          createdAt: h.createdAt,
          updatedAt: h.updatedAt,
        }));
      }),

    /** Add a new holding. */
    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        assetClass: z.enum(["real_estate", "equity", "etf", "pension", "sacco", "business", "crypto", "insurance", "other"]),
        name: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        purchaseValue: z.number().min(0).optional(),
        currentValue: z.number().min(0),
        purchaseDate: z.string().optional(),
        notes: z.string().max(2000).optional(),
        assumedReturnConservative: z.number().min(0).max(100).optional(),
        assumedReturnBase: z.number().min(0).max(100).optional(),
        assumedReturnOptimistic: z.number().min(0).max(100).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addOtherHolding({
          portfolioId: input.portfolioId,
          assetClass: input.assetClass,
          name: input.name,
          description: input.description,
          purchaseValue: String(input.purchaseValue),
          currentValue: String(input.currentValue),
          purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : undefined,
          notes: input.notes,
          assumedReturnConservative: input.assumedReturnConservative != null ? String(input.assumedReturnConservative) : undefined,
          assumedReturnBase: input.assumedReturnBase != null ? String(input.assumedReturnBase) : undefined,
          assumedReturnOptimistic: input.assumedReturnOptimistic != null ? String(input.assumedReturnOptimistic) : undefined,
        });
        return { success: true };
      }),

    /** Update a holding's current value and other fields. */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        portfolioId: z.number().int().positive(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(1000).optional(),
        currentValue: z.number().min(0).optional(),
        notes: z.string().max(2000).optional(),
        assumedReturnConservative: z.number().min(0).max(100).nullable().optional(),
        assumedReturnBase: z.number().min(0).max(100).nullable().optional(),
        assumedReturnOptimistic: z.number().min(0).max(100).nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const { id, portfolioId, ...rest } = input;
        await updateOtherHolding(id, portfolioId, {
          ...(rest.name !== undefined && { name: rest.name }),
          ...(rest.description !== undefined && { description: rest.description }),
          ...(rest.currentValue !== undefined && { currentValue: String(rest.currentValue) }),
          ...(rest.notes !== undefined && { notes: rest.notes }),
          ...(rest.assumedReturnConservative !== undefined && { assumedReturnConservative: rest.assumedReturnConservative != null ? String(rest.assumedReturnConservative) : null }),
          ...(rest.assumedReturnBase !== undefined && { assumedReturnBase: rest.assumedReturnBase != null ? String(rest.assumedReturnBase) : null }),
          ...(rest.assumedReturnOptimistic !== undefined && { assumedReturnOptimistic: rest.assumedReturnOptimistic != null ? String(rest.assumedReturnOptimistic) : null }),
        });
        return { success: true };
      }),

    /** Delete a holding and all its income records. */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), portfolioId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteOtherHolding(input.id, input.portfolioId);
        return { success: true };
      }),

    /** List income records for a holding. */
    listIncome: protectedProcedure
      .input(z.object({ holdingId: z.number().int().positive(), portfolioId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getHoldingIncome(input.holdingId);
        return rows.map((r) => ({
          id: r.id,
          holdingId: r.holdingId,
          amount: parseFloat(String(r.amount)),
          incomeDate: normaliseDate(r.incomeDate),
          incomeType: r.incomeType,
          notes: r.notes ?? null,
          createdAt: r.createdAt,
        }));
      }),

    /** Add an income record. */
    addIncome: protectedProcedure
      .input(z.object({
        holdingId: z.number().int().positive(),
        portfolioId: z.number().int().positive(),
        amount: z.number().min(0),
        incomeDate: z.string(),
        incomeType: z.string().max(50).optional(),
        notes: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addHoldingIncome({
          holdingId: input.holdingId,
          amount: String(input.amount),
          incomeDate: new Date(input.incomeDate),
          incomeType: input.incomeType ?? "other",
          notes: input.notes,
        });
        return { success: true };
      }),

    /** Delete an income record. */
    deleteIncome: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), holdingId: z.number().int().positive(), portfolioId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteHoldingIncome(input.id, input.holdingId);
        return { success: true };
      }),
  }),
});

export type AppRouter = typeof appRouter;
