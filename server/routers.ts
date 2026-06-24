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
  getSecurityById,
  getDepositBySecurityId,
  addSecurity,
  updateSecurity,
  deleteSecurity,
  getContributionOverrides,
  upsertContributionOverride,
  deleteContributionOverride,
  getDepositEntries,
  addDepositEntry,
  updateDepositEntry,
  deleteDepositEntry,
  getWithdrawalEntries,
  addWithdrawalEntry,
  deleteWithdrawalEntry,
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
  getSecondaryMmfs,
  addSecondaryMmf,
  updateSecondaryMmf,
  deleteSecondaryMmf,
  getMmfCompositions,
  upsertMmfComposition,
  deleteMmfComposition,
  getBankInstruments,
  addBankInstrument,
  updateBankInstrument,
  deleteBankInstrument,
  getBankInstrumentHoldings,
  addBankInstrumentHolding,
  updateBankInstrumentHolding,
  deleteBankInstrumentHolding,
  getActualsSummary,
  getBenchmarkInputs,
  upsertBenchmarkInput,
  addAuditLog,
  getAuditLog,
  updateMmfFundAccrualSettings,
} from "./db";
import {
  runProjection,
  runScenarios,
  deriveStepUps,
  checkMilestones,
  getScheduledContribution,
  generateMilestones,
  solveForContribution,
  deriveSafetyFloor,
  SWEEP_LOT_SIZE,
  SCENARIO_STEPUPS,
  type EngineSettings,
  type ActualDeposit,
  type ActualSecurity,
  type ActualBankHolding,
  type SecondaryMmfInput,
} from "./engine";
import { COOKIE_NAME } from "../shared/const";
import { reconcile, reconcileMmf } from "../shared/reconciliation";

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
    institutionType:
      (d as { institutionType?: string | null }).institutionType as ActualDeposit["institutionType"] ?? null,
    mmfFundId: (d as { mmfFundId?: number | null }).mmfFundId ?? null,
    bankHoldingId: (d as { bankHoldingId?: number | null }).bankHoldingId ?? null,
  }));
}

/**
 * Map primary-MMF withdrawals into NEGATIVE primary-MMF deposit rows so the
 * engine's actual-seeding loop reduces the seeded "today" MMF balance on the
 * withdrawal date (mirrors how positive deposits raise it). Only primary-fund
 * withdrawals are modelled here — bank / secondary / government-security
 * withdrawals are already reflected by their decremented principal / balance /
 * matured-flag in their own tables.
 */
function mapPrimaryMmfWithdrawalsAsDeposits(
  rows: Awaited<ReturnType<typeof getWithdrawalEntries>>,
  primaryFundId: number | null,
): ActualDeposit[] {
  return rows
    .filter((w) => {
      if (w.sourceType !== "mmf_fund") return false;
      const fid = (w as { mmfFundId?: number | null }).mmfFundId ?? null;
      // Primary fund: either no fund id recorded, or it matches the portfolio's primary.
      return fid == null || primaryFundId == null || fid === primaryFundId;
    })
    .map((w) => ({
      bucket: "mmf" as const,
      amount: -(parseFloat(String(w.amount ?? "0")) || 0),
      depositDate: normaliseDate(w.withdrawalDate),
      institutionType: "mmf_fund" as ActualDeposit["institutionType"],
      mmfFundId: (w as { mmfFundId?: number | null }).mmfFundId ?? null,
      bankHoldingId: null,
    }));
}

/** Map DB bank instrument holdings into engine actuals inputs. */
function mapActualBankHoldings(
  rows: Awaited<ReturnType<typeof getBankInstrumentHoldings>>
): ActualBankHolding[] {
  return rows.map((b) => ({
    principal: parseFloat(String(b.principal ?? "0")) || 0,
    interestRate: parseFloat(String(b.interestRate ?? "0")) || 0,
    whtRate: b.whtRate != null ? parseFloat(String(b.whtRate)) : null,
    dayCountBasis: (b as { dayCountBasis?: number | null }).dayCountBasis ?? 365,
    startDate: normaliseDate((b as { startDate?: Date | string | null }).startDate),
    isActive: !!b.isActive,
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

/** Map DB secondary MMF rows into engine inputs (fund EAR treated as gross, WHT applied in engine). */
function mapSecondaryMmfs(rows: Awaited<ReturnType<typeof getSecondaryMmfs>>): SecondaryMmfInput[] {
  return rows.map((s) => ({
    id: s.id,
    label: s.label ?? undefined,
    currentBalance: parseFloat(String(s.currentBalance)) || 0,
    monthlyContribution: parseFloat(String(s.monthlyContribution)) || 0,
    ear: parseFloat(String(s.ear)) || 0,
    whtRate: s.whtRate != null ? parseFloat(String(s.whtRate)) : undefined,
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
  // Optional: when omitted, the safety floor is auto-derived from the contribution.
  safetyFloor: z.number().min(0).optional(),
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
    /** List portfolios owned by the current user, optionally scoped by mode (live vs sandbox). */
    list: protectedProcedure
      .input(z.object({ isSandbox: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const rows = await getPortfolios(ctx.user.id, input?.isSandbox);
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
          isSandbox: p.isSandbox,
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
        isSandbox: p.isSandbox,
        createdAt: p.createdAt,
      };
    }),

    /** Create a new portfolio. Also creates a default rate_settings row for it. */
    create: protectedProcedure
      .input(portfolioCreateInput.extend({ isSandbox: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
      const p = await createPortfolio({
        userId: ctx.user.id,
        isSandbox: input.isSandbox ?? false,
        name: input.name,
        description: input.description,
        targetAmount: String(input.targetAmount),
        startDate: new Date(`${input.startDate}T12:00:00.000Z`),
        horizonMonths: input.horizonMonths,
        startingContribution: String(input.startingContribution),
        stepUpAmount: String(input.stepUpAmount),
        stepUpMonths: input.stepUpMonths,
        safetyFloor: String(input.safetyFloor ?? deriveSafetyFloor(input.startingContribution)),
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
          safetyFloor: String(input.safetyFloor ?? deriveSafetyFloor(input.startingContribution)),
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
      // Resolve the selected MMF fund name and EAR
      const selectedFund = p.mmfFundId ? await getMmfFund(p.mmfFundId) : null;
      const selectedFundEar = selectedFund ? parseFloat(String(selectedFund.ear)) : null;
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
        // Selected MMF fund info
        selectedFundId: p.mmfFundId ?? null,
        selectedFundName: selectedFund?.fundName ?? null,
        selectedFundCompany: selectedFund?.company ?? null,
        selectedFundEar: selectedFundEar,
      };
    }),

    /**
     * Auto-derived MMF safety floor for this portfolio, computed from its current
     * monthly contribution and the sweep lot size. Returns the derived value, the
     * value currently stored on the portfolio, and whether the stored value is an
     * explicit override (i.e. differs from the derived default).
     */
    derivedSafetyFloor: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), startingContribution: z.number().min(0).optional() }))
      .query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const monthlyContribution = input.startingContribution ?? (parseFloat(String(p.startingContribution)) || 0);
      const derived = deriveSafetyFloor(monthlyContribution);
      const stored = parseFloat(String(p.safetyFloor)) || 0;
      return {
        derived,
        stored,
        lotSize: SWEEP_LOT_SIZE,
        bufferMonths: 2,
        monthlyContribution,
        isOverridden: Math.abs(stored - derived) > 0.5,
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
      const withdrawalRows = await getWithdrawalEntries(input.portfolioId);
      const actualDeposits = [
        ...mapActualDeposits(depositRows),
        ...mapPrimaryMmfWithdrawalsAsDeposits(withdrawalRows, p.mmfFundId ?? null),
      ];
      const securityRows = await getSecurities(input.portfolioId);
      const actualSecurities = mapActualSecurities(securityRows);
      const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
      const bankHoldings = mapActualBankHoldings(await getBankInstrumentHoldings(input.portfolioId));
      return runProjection(
        settings,
        mappedOverrides,
        rh,
        actualDeposits,
        actualSecurities,
        secondaryMmfs,
        bankHoldings,
        p.mmfFundId ?? null
      );
    }),

    scenarios: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const rateHistoryRows = await getRateHistory(input.portfolioId);
      const rh = mapRateHistory(rateHistoryRows);
      const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
      const currentStepUp = Number(p?.stepUpAmount ?? 0);
      const stepUps = deriveStepUps(currentStepUp);
      return runScenarios(settings, stepUps, rh, secondaryMmfs);
    }),

    milestones: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
      return generateMilestones(settings, secondaryMmfs);
    }),

    /**
     * Reconciliation: independently recompute the portfolio's "today" value from
     * five sources and assert they agree. Reuses the EXACT helpers the live pages
     * use (getActualsSummary + runProjection) so any disagreement surfaces here.
     */
    reconciliation: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);

      // ── Principal-basis sources (the same path the Dashboard uses) ──
      const summary = await getActualsSummary(
        input.portfolioId,
        settings.targetAmount,
        settings.withholdingTax,
        settings.fxdCouponRate,
        settings.mmfYield,
        settings.tbill364Rate,
      );

      const secondaries = await getSecondaryMmfs(input.portfolioId);
      const bank = await getBankInstrumentHoldings(input.portfolioId);
      const securities = await getSecurities(input.portfolioId);

      const primaryMmfBalance = summary?.depositsContributed ?? 0;
      const secondaryMmfBalances = secondaries.map((s) => parseFloat(String(s.currentBalance ?? "0")) || 0);
      const bankHoldingPrincipals = bank
        .filter((b) => b.isActive)
        .map((b) => parseFloat(String(b.principal ?? "0")) || 0);
      const securityFaceValues = securities
        .filter((s) => !s.isMatured)
        .map((s) => parseFloat(String(s.faceValue ?? "0")) || 0);

      const dashboardActualsTotal = summary?.totalContributed ?? 0;

      // ── Engine projection "today" value ──
      // Use the last actual-seeded month's totalEnd (the same figure the Dashboard
      // reconciliation card reads). When there are no elapsed actual months yet,
      // the engine has nothing seeded, so the principal sum-of-parts is the correct
      // "today" basis — fall back to it to keep the comparison on one footing.
      const overrides = await getContributionOverrides(input.portfolioId);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      const rh = mapRateHistory(await getRateHistory(input.portfolioId));
      const projection = runProjection(
        settings,
        mappedOverrides,
        rh,
        [
          ...mapActualDeposits(await getDepositEntries(input.portfolioId)),
          ...mapPrimaryMmfWithdrawalsAsDeposits(
            await getWithdrawalEntries(input.portfolioId),
            p.mmfFundId ?? null,
          ),
        ],
        mapActualSecurities(securities),
        mapSecondaryMmfs(secondaries),
        mapActualBankHoldings(bank),
        p.mmfFundId ?? null,
      );
      const sumParts =
        primaryMmfBalance +
        secondaryMmfBalances.reduce((a, b) => a + b, 0) +
        bankHoldingPrincipals.reduce((a, b) => a + b, 0) +
        securityFaceValues.reduce((a, b) => a + b, 0);
      // The engine intentionally accrues the PRIMARY MMF through elapsed (actual)
      // months so the projected "today" balance matches the daily-accrual ledger
      // (see actualsReconciliation.test.ts). The other four sources are on a
      // recorded-principal basis. To reconcile every source on ONE footing, strip
      // the actual-period primary-MMF accrual back to recorded principal:
      //   principalBasisToday = totalEnd - (mmfEnd_today - recordedMmfPrincipal)
      // Secondary MMFs and bank holdings are already held flat in actual months.
      const lastActual = [...projection].reverse().find((r) => r.isActual);
      const projectionTodayValue = lastActual
        ? lastActual.totalEnd - (lastActual.mmfEnd - primaryMmfBalance)
        : sumParts;

      const inputs = {
        primaryMmfBalance,
        secondaryMmfBalances,
        bankHoldingPrincipals,
        securityFaceValues,
        otherAssetValues: [],
        projectionTodayValue,
        dashboardActualsTotal,
        accrualLedgerMmfTotal: primaryMmfBalance + secondaryMmfBalances.reduce((a, b) => a + b, 0),
        dashboardNetWorth: dashboardActualsTotal,
      };

      return {
        full: reconcile(inputs),
        mmf: reconcileMmf(inputs.accrualLedgerMmfTotal, inputs.primaryMmfBalance, inputs.secondaryMmfBalances),
      };
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
        const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
        return solveForContribution(settings, stepUp, rh, secondaryMmfs);
      }),

    /**
     * What-if overlay: re-run the projection with one or more secondary-MMF
     * monthly contributions replaced, and return both the baseline and the
     * what-if month series + final values so the UI can compare them.
     * Engine math is untouched — we only swap the secondary contribution input.
     */
    whatIf: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        overrides: z.array(z.object({
          secondaryMmfId: z.number().int().positive(),
          monthlyContribution: z.number().min(0),
        })).max(50),
        /** Optional override of the primary starting monthly contribution (KES). */
        primaryContribution: z.number().min(0).max(10000000).optional(),
        /** Optional override of the primary step-up amount (KES). */
        primaryStepUpAmount: z.number().min(0).max(10000000).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
        const settings = dbToEngine(rates, p, fundEar);
        const rateHistoryRows = await getRateHistory(input.portfolioId);
        const rh = mapRateHistory(rateHistoryRows);
        const contribOverrides = (await getContributionOverrides(input.portfolioId)).map((o) => ({
          monthNumber: o.monthNumber,
          overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
          lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
        }));
        const baselineSecondary = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
        const overrideMap = new Map(input.overrides.map((o) => [o.secondaryMmfId, o.monthlyContribution]));
        const whatIfSecondary = baselineSecondary.map((s) =>
          s.id != null && overrideMap.has(s.id)
            ? { ...s, monthlyContribution: overrideMap.get(s.id)! }
            : s,
        );

        // What-if settings: optionally override the PRIMARY contribution and/or step-up.
        const whatIfSettings = {
          ...settings,
          ...(input.primaryContribution !== undefined && { startingContribution: input.primaryContribution }),
          ...(input.primaryStepUpAmount !== undefined && { stepUpAmount: input.primaryStepUpAmount }),
        };

        const baselineSeries = runProjection(settings, contribOverrides, rh, [], [], baselineSecondary);
        const whatIfSeries = runProjection(whatIfSettings, contribOverrides, rh, [], [], whatIfSecondary);
        const last = (arr: typeof baselineSeries) => arr[arr.length - 1];
        const baselineFinal = last(baselineSeries)?.totalEnd ?? 0;
        const whatIfFinal = last(whatIfSeries)?.totalEnd ?? 0;

        return {
          target: settings.targetAmount,
          horizonMonths: settings.horizonMonths ?? baselineSeries.length,
          primaryBaseline: {
            startingContribution: settings.startingContribution,
            stepUpAmount: settings.stepUpAmount,
          },
          baseline: {
            finalValue: baselineFinal,
            series: baselineSeries.map((m) => ({ month: m.monthNumber, total: m.totalEnd })),
          },
          whatIf: {
            finalValue: whatIfFinal,
            series: whatIfSeries.map((m) => ({ month: m.monthNumber, total: m.totalEnd })),
          },
          delta: whatIfFinal - baselineFinal,
        };
      }),

    /**
     * Apply a what-if: persist the explored secondary-MMF monthly contributions
     * (and optionally the primary contribution / step-up) back to the live
     * accounts/portfolio. This turns an exploration into a saved plan change.
     */
    applyWhatIf: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        overrides: z.array(z.object({
          secondaryMmfId: z.number().int().positive(),
          monthlyContribution: z.number().min(0),
        })).max(50),
        primaryContribution: z.number().min(0).max(10000000).optional(),
        primaryStepUpAmount: z.number().min(0).max(10000000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        // Persist secondary MMF contribution changes.
        const secs = await getSecondaryMmfs(input.portfolioId);
        const secIds = new Set(secs.map((s) => s.id));
        let applied = 0;
        for (const o of input.overrides) {
          if (!secIds.has(o.secondaryMmfId)) continue;
          await updateSecondaryMmf(o.secondaryMmfId, input.portfolioId, {
            monthlyContribution: String(o.monthlyContribution),
          });
          applied++;
        }
        // Persist primary contribution / step-up changes.
        const portfolioPatch: { startingContribution?: string; stepUpAmount?: string } = {};
        if (input.primaryContribution !== undefined) portfolioPatch.startingContribution = String(input.primaryContribution);
        if (input.primaryStepUpAmount !== undefined) portfolioPatch.stepUpAmount = String(input.primaryStepUpAmount);
        if (Object.keys(portfolioPatch).length > 0) {
          await updatePortfolio(input.portfolioId, ctx.user.id, portfolioPatch);
        }
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "portfolio",
          entityId: input.portfolioId,
          action: "update",
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? undefined,
          summary: `Applied what-if: ${applied} secondary MMF contribution(s)` +
            (input.primaryContribution !== undefined ? `, primary contribution → ${input.primaryContribution}` : "") +
            (input.primaryStepUpAmount !== undefined ? `, step-up → ${input.primaryStepUpAmount}` : ""),
        });
        return { success: true, appliedSecondaries: applied, portfolioUpdated: Object.keys(portfolioPatch).length > 0 };
      }),
  }),

  // ─── Ledger ─────────────────────────────────────────────────────
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
        // Status / annotation (Round 18+)
        isMatured: z.boolean().optional(),
        notes: z.string().optional(),
        // Full edit (Round 22) — any of these may be supplied.
        securityType: z.enum(["tbill_91", "tbill_182", "tbill_364", "ifb", "fxd"]).optional(),
        faceValue: z.number().min(50000).optional(),
        issueDate: z.string().optional(),
        maturityDate: z.string().optional(),
        couponRate: z.number().min(0).max(50).optional(),
        isTaxExempt: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Verify ownership: the security must belong to a portfolio owned by the
        // requesting user. (The register row is the single source of truth, so
        // we guard it directly rather than trusting a client-supplied portfolioId.)
        const existing = await getSecurityById(input.id);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Security not found." });
        }
        await requirePortfolio(existing.portfolioId, ctx.user.id);

        // Build the partial update for the register row.
        const secUpdate: Record<string, unknown> = {};
        if (input.isMatured !== undefined) secUpdate.isMatured = input.isMatured;
        if (input.notes !== undefined) secUpdate.notes = input.notes;
        if (input.securityType !== undefined) secUpdate.securityType = input.securityType;
        if (input.faceValue !== undefined) secUpdate.faceValue = String(input.faceValue);
        if (input.issueDate !== undefined) secUpdate.issueDate = new Date(input.issueDate + "T12:00:00Z");
        if (input.maturityDate !== undefined) secUpdate.maturityDate = new Date(input.maturityDate + "T12:00:00Z");
        if (input.couponRate !== undefined) secUpdate.couponRate = String(input.couponRate);
        if (input.isTaxExempt !== undefined) secUpdate.isTaxExempt = input.isTaxExempt;
        await updateSecurity(input.id, secUpdate as Partial<typeof existing>);

        // Keep the linked deposit row in sync so the live actuals + accrual
        // ledger never drift from the (now-edited) register entry.
        const linkedDeposit = await getDepositBySecurityId(input.id);
        if (linkedDeposit) {
          const depUpdate: Record<string, unknown> = {};
          if (input.faceValue !== undefined) depUpdate.amount = String(input.faceValue);
          if (input.issueDate !== undefined) depUpdate.depositDate = new Date(input.issueDate + "T12:00:00Z");
          // The deposit bucket follows the register security type so the engine
          // places the lot in the right pocket.
          if (input.securityType !== undefined) {
            depUpdate.bucket =
              input.securityType === "ifb" ? "ifb"
              : input.securityType === "fxd" ? "fxd"
              : "tbill";
          }
          if (Object.keys(depUpdate).length > 0) {
            await updateDepositEntry(linkedDeposit.id, existing.portfolioId, depUpdate as never);
          }
        }
        return { success: true, linkedDepositSynced: !!linkedDeposit };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteSecurity(input.id);
        return { success: true };
      }),

    /**
     * Recycle a matured security. Marks the original register row matured (so it
     * leaves net worth), then redeploys the proceeds in one click:
     *  - mode "mmf": records a primary-MMF deposit for the face value.
     *  - mode "rebuy": records a fresh government-security deposit, which
     *    auto-creates a new linked register row (same single-source-of-truth
     *    flow as deposits.add), letting the user roll the T-bill/bond over.
     */
    recycle: protectedProcedure
      .input(z.object({
        id: z.number(),
        // "split" rolls part of the proceeds into the MMF and re-buys the rest in one action.
        mode: z.enum(["mmf", "rebuy", "split"]),
        // For mmf/rebuy: defaults to the matured security's face value; editable for partial rollovers.
        amount: z.number().positive().optional(),
        // For split: explicit portions. Each must be >= 0 and at least one positive.
        mmfAmount: z.number().min(0).optional(),
        rebuyAmount: z.number().min(0).optional(),
        // Defaults to today; the date the proceeds were redeployed.
        depositDate: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await getSecurityById(input.id);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Security not found." });
        }
        const portfolio = await requirePortfolio(existing.portfolioId, ctx.user.id);
        const portfolioId = existing.portfolioId;
        const depositDateStr = input.depositDate ?? new Date().toISOString().split("T")[0];
        const depositDate = new Date(depositDateStr + "T12:00:00Z");

        // Resolve the MMF and re-buy portions for whichever mode was chosen.
        const face = parseFloat(String(existing.faceValue)) || 0;
        let mmfPortion = 0;
        let rebuyPortion = 0;
        if (input.mode === "mmf") {
          mmfPortion = input.amount ?? face;
        } else if (input.mode === "rebuy") {
          rebuyPortion = input.amount ?? face;
        } else {
          // split — both portions explicit; default to a 50/50 face split if omitted.
          mmfPortion = input.mmfAmount ?? face / 2;
          rebuyPortion = input.rebuyAmount ?? face / 2;
        }
        mmfPortion = Math.round(mmfPortion * 100) / 100;
        rebuyPortion = Math.round(rebuyPortion * 100) / 100;
        const total = mmfPortion + rebuyPortion;
        if (total <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Recycle amount must be positive." });
        }
        if (input.mode === "split" && (mmfPortion <= 0 || rebuyPortion <= 0)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A split rollover needs a positive amount on both the MMF and re-buy sides.",
          });
        }

        // 1) Retire the matured security so it no longer counts toward net worth.
        //    (When there is a re-buy leg, we also stamp rolledIntoId below once the
        //    replacement security exists, so the register can show a "rolled into #N" trail.)
        if (!existing.isMatured) {
          await updateSecurity(input.id, { isMatured: true } as Partial<typeof existing>);
        }

        // 2a) Roll the MMF portion into the primary MMF account.
        if (mmfPortion > 0) {
          await addDepositEntry({
            portfolioId,
            bucket: "mmf",
            institutionType: "mmf_fund",
            mmfFundId: portfolio.mmfFundId ?? null,
            bankHoldingId: null,
            amount: String(mmfPortion),
            depositDate,
            notes: `Recycled from matured ${existing.securityType} (face KES ${Number(existing.faceValue).toLocaleString()})`,
          });
        }

        // 2b) Re-buy: same type/coupon/tax flag, new tenor from the redeploy date.
        if (rebuyPortion > 0) {
          const bucket: "tbill" | "ifb" | "fxd" =
            existing.securityType === "ifb" ? "ifb"
            : existing.securityType === "fxd" ? "fxd"
            : "tbill";
          const entry = await addDepositEntry({
            portfolioId,
            bucket,
            institutionType: "government_security",
            mmfFundId: null,
            bankHoldingId: null,
            amount: String(rebuyPortion),
            depositDate,
            notes: `Re-bought on rollover of matured ${existing.securityType}`,
          });
          // Preserve the original tenor length so the rollover matches the
          // instrument being replaced (e.g. a 364-day bill rolls to 364 days).
          const origIssue = new Date(existing.issueDate);
          const origMaturity = new Date(existing.maturityDate);
          const tenorMs = Math.max(origMaturity.getTime() - origIssue.getTime(), 0);
          const tenorMonths = tenorMs > 0 ? Math.round(tenorMs / (1000 * 60 * 60 * 24 * 30.4375)) : (bucket === "tbill" ? 12 : 24);
          const maturity = new Date(depositDate);
          maturity.setMonth(maturity.getMonth() + Math.max(tenorMonths, 1));
          const sec = await addSecurity({
            portfolioId,
            securityType: existing.securityType,
            faceValue: String(rebuyPortion),
            issueDate: depositDate,
            maturityDate: maturity,
            couponRate: String(parseFloat(String(existing.couponRate)) || 0),
            isTaxExempt: existing.isTaxExempt,
            notes: `Rolled over from security #${existing.id} on ${depositDateStr}`,
          });
          if (sec?.id && entry?.id) {
            await updateDepositEntry(entry.id, portfolioId, { securityId: sec.id } as never);
          }
          // Audit trail: link the matured lot to its replacement so the register
          // can render "rolled into #N" (rebuy + split modes).
          if (sec?.id) {
            await updateSecurity(input.id, { rolledIntoId: sec.id } as Partial<typeof existing>);
          }
        }

        const summary =
          input.mode === "mmf"
            ? `Rolled matured ${existing.securityType} (KES ${mmfPortion.toLocaleString()}) into the primary MMF on ${depositDateStr}`
            : input.mode === "rebuy"
              ? `Re-bought ${existing.securityType} (KES ${rebuyPortion.toLocaleString()}) on rollover on ${depositDateStr}`
              : `Split rollover of matured ${existing.securityType} on ${depositDateStr}: KES ${mmfPortion.toLocaleString()} to MMF + KES ${rebuyPortion.toLocaleString()} re-bought`;

        await addAuditLog({
          portfolioId,
          entity: "security",
          action: "update",
          field: `recycle_${input.mode}`,
          newValue: String(total),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary,
        });

        return { success: true, mode: input.mode, amount: total, mmfPortion, rebuyPortion };
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
        // Destination-aware: where the money actually went.
        institutionType: z.enum(["mmf_fund", "bank_instrument", "government_security"]).optional(),
        mmfFundId: z.number().int().positive().optional(),
        bankHoldingId: z.number().int().positive().optional(),
        // bucket is required for government securities; for MMF/bank it is derived.
        bucket: z.enum(["mmf", "tbill", "ifb", "fxd"]).optional(),
        amount: z.number().positive(),
        depositDate: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        // Resolve destination + legacy bucket.
        const institutionType =
          input.institutionType ??
          (input.mmfFundId ? "mmf_fund" : input.bankHoldingId ? "bank_instrument" : "government_security");
        let bucket: "mmf" | "tbill" | "ifb" | "fxd";
        if (institutionType === "mmf_fund" || institutionType === "bank_instrument") {
          bucket = "mmf"; // bank/MMF cash classified under the liquid (mmf-like) bucket for back-compat
        } else {
          if (!input.bucket) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "A government-security bucket is required." });
          }
          bucket = input.bucket;
        }
        const entry = await addDepositEntry({
          portfolioId: input.portfolioId,
          bucket,
          institutionType,
          mmfFundId: input.mmfFundId ?? null,
          bankHoldingId: input.bankHoldingId ?? null,
          amount: String(input.amount),
          depositDate: new Date(input.depositDate),
          notes: input.notes,
        });
        // If the deposit targets a GOVERNMENT SECURITY, auto-create a register
        // row (the single source of truth) and link it to the deposit so the
        // engine + dashboard value it ONCE, from the register.
        if (institutionType === "government_security" && entry) {
          const [rates, fundEar] = await Promise.all([
            getRateSettings(input.portfolioId),
            getSelectedFundEar(await requirePortfolio(input.portfolioId, ctx.user.id)),
          ]);
          void fundEar;
          // Map the legacy bucket to a register securityType + default tenor.
          const securityType: "tbill_364" | "ifb" | "fxd" =
            bucket === "tbill" ? "tbill_364" : bucket === "ifb" ? "ifb" : "fxd";
          const tenorMonths = bucket === "tbill" ? 12 : 24;
          const issue = new Date(input.depositDate + "T12:00:00Z");
          const maturity = new Date(issue);
          maturity.setMonth(maturity.getMonth() + tenorMonths);
          const couponRate =
            bucket === "ifb"
              ? parseFloat(String(rates?.ifbCouponRate ?? "0")) || 0
              : bucket === "fxd"
                ? parseFloat(String(rates?.fxdCouponRate ?? "0")) || 0
                : 0;
          const sec = await addSecurity({
            portfolioId: input.portfolioId,
            securityType,
            faceValue: String(input.amount),
            issueDate: issue,
            maturityDate: maturity,
            couponRate: String(couponRate),
            isTaxExempt: bucket === "ifb",
            notes: `Auto-created from deposit on ${input.depositDate}`,
          });
          if (sec?.id) {
            await updateDepositEntry(entry.id, input.portfolioId, { securityId: sec.id });
          }
        }
        // If the deposit targets a bank holding, increase its principal to keep actuals in sync.
        if (institutionType === "bank_instrument" && input.bankHoldingId) {
          const holdings = await getBankInstrumentHoldings(input.portfolioId);
          const h = holdings.find((x) => x.id === input.bankHoldingId);
          if (h) {
            const newPrincipal = (parseFloat(String(h.principal)) || 0) + input.amount;
            await updateBankInstrumentHolding(input.bankHoldingId, input.portfolioId, {
              principal: String(newPrincipal),
            });
          }
        }
        // If the deposit targets a secondary MMF account, increase its balance.
        if (institutionType === "mmf_fund" && input.mmfFundId) {
          const p = await getPortfolio(input.portfolioId, ctx.user.id);
          // Only adjust secondary accounts; the primary fund balance is the deposit ledger itself.
          if (p && p.mmfFundId !== input.mmfFundId) {
            const secs = await getSecondaryMmfs(input.portfolioId);
            const sec = secs.find((s) => s.mmfFundId === input.mmfFundId);
            if (sec) {
              const newBal = (parseFloat(String(sec.currentBalance)) || 0) + input.amount;
              await updateSecondaryMmf(sec.id, input.portfolioId, { currentBalance: String(newBal) });
            }
          }
        }
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "deposit",
          action: "create",
          field: institutionType,
          newValue: String(input.amount),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Recorded ${institutionType.replace("_", " ")} deposit of KES ${input.amount.toLocaleString()} on ${input.depositDate}`,
        });
        return { success: true, entry };
      }),

    delete: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteDepositEntry(input.id, input.portfolioId);
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "deposit",
          entityId: input.id,
          action: "delete",
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Deleted deposit entry #${input.id}`,
        });
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
      void mappedOverrides; void actualDeposits; void actualSecurities;

      // Destination-aware live actuals: deposits + secondary MMFs + bank holdings.
      const summary = await getActualsSummary(
        input.portfolioId,
        settings.targetAmount,
        settings.withholdingTax,
        settings.fxdCouponRate,
        settings.mmfYield,
        settings.tbill364Rate,
      );
      const round2 = (n: number) => Math.round(n * 100) / 100;
      if (!summary) {
        return {
          totalContributed: 0,
          depositsContributed: 0,
          secondaryMmfBalance: 0,
          bankBalance: 0,
          remainingToTarget: settings.targetAmount,
          taxLiability: 0,
          taxBreakdown: { mmf: 0, tbill: 0, ifb: 0, fxd: 0, secondaryMmf: 0, bank: 0 },
          annualFxdCouponIncome: 0,
          byBucket: { mmf: 0, tbill: 0, ifb: 0, fxd: 0 },
          secondaryCount: 0,
          bankHoldingCount: 0,
          entryCount: 0,
          withdrawalCount: 0,
          totalWithdrawn: 0,
          estInterestEarned: 0,
        };
      }
      return {
        totalContributed: round2(summary.totalContributed),
        depositsContributed: round2(summary.depositsContributed),
        secondaryMmfBalance: round2(summary.secondaryMmfBalance),
        bankBalance: round2(summary.bankBalance),
        remainingToTarget: round2(summary.remainingToTarget),
        taxLiability: round2(summary.taxLiability),
        taxBreakdown: summary.taxBreakdown,
        annualFxdCouponIncome: round2(summary.annualFxdCouponIncome),
        byBucket: summary.byBucket,
        secondaryCount: summary.secondaryCount,
        bankHoldingCount: summary.bankHoldingCount,
        entryCount: summary.entryCount,
        withdrawalCount: summary.withdrawalCount,
        totalWithdrawn: round2(summary.totalWithdrawn),
        estInterestEarned: round2(summary.estInterestEarned ?? 0),
      };
    }),
  }),

  // ─── Withdrawals (money OUT) ───────────────────────────────────────────────
  withdrawals: router({
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      return getWithdrawalEntries(input.portfolioId);
    }),

    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        sourceType: z.enum(["mmf_fund", "bank_instrument", "government_security"]),
        mmfFundId: z.number().int().positive().optional(),
        bankHoldingId: z.number().int().positive().optional(),
        securityId: z.number().int().positive().optional(),
        amount: z.number().positive(),
        withdrawalDate: z.string(),
        reason: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
        const settings = dbToEngine(rates, p, fundEar);

        // Validate that the source has enough available to cover the withdrawal.
        const summary = await getActualsSummary(
          input.portfolioId,
          settings.targetAmount,
          settings.withholdingTax,
          settings.fxdCouponRate,
          settings.mmfYield,
          settings.tbill364Rate,
        );
        let available = 0;
        if (input.sourceType === "bank_instrument") available = summary?.bankBalance ?? 0;
        else if (input.sourceType === "government_security") available = summary?.securitiesValue ?? 0;
        else if (input.mmfFundId && p.mmfFundId !== input.mmfFundId) available = summary?.secondaryMmfBalance ?? 0;
        else available = summary?.depositsContributed ?? 0;
        if (input.amount > available + 0.005) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Withdrawal of KES ${input.amount.toLocaleString()} exceeds the available balance of KES ${available.toLocaleString(undefined, { maximumFractionDigits: 2 })} in this source.`,
          });
        }

        // Early fixed-deposit break? Detect and compute forfeited interest.
        let isEarlyWithdrawal = false;
        let forfeitedInterest = 0;
        if (input.sourceType === "bank_instrument" && input.bankHoldingId) {
          const holdings = await getBankInstrumentHoldings(input.portfolioId);
          const h = holdings.find((x) => x.id === input.bankHoldingId);
          if (h && h.instrumentType === "fixed_deposit" && h.maturityDate) {
            const maturity = new Date(h.maturityDate);
            const wDate = new Date(input.withdrawalDate + "T12:00:00Z");
            if (wDate < maturity) {
              isEarlyWithdrawal = true;
              // Forfeit interest accrued to date on the withdrawn portion: a fixed
              // deposit broken early typically loses ALL accrued interest on that money.
              const start = h.startDate ? new Date(h.startDate) : new Date(h.createdAt);
              const days = Math.max(0, (wDate.getTime() - start.getTime()) / 86_400_000);
              const rate = parseFloat(String(h.interestRate ?? "0")) / 100;
              const dayCount = h.dayCountBasis || 365;
              forfeitedInterest = Math.round(input.amount * rate * (days / dayCount) * 100) / 100;
            }
          }
          // Reduce the holding principal to keep actuals in sync.
          if (h) {
            const newPrincipal = Math.max(0, (parseFloat(String(h.principal)) || 0) - input.amount);
            await updateBankInstrumentHolding(input.bankHoldingId, input.portfolioId, {
              principal: String(newPrincipal),
            });
          }
        }

        // Reduce a secondary-MMF balance when applicable.
        if (input.sourceType === "mmf_fund" && input.mmfFundId && p.mmfFundId !== input.mmfFundId) {
          const secs = await getSecondaryMmfs(input.portfolioId);
          const sec = secs.find((s) => s.mmfFundId === input.mmfFundId);
          if (sec) {
            const newBal = Math.max(0, (parseFloat(String(sec.currentBalance)) || 0) - input.amount);
            await updateSecondaryMmf(sec.id, input.portfolioId, { currentBalance: String(newBal) });
          }
        }

        // Mark a redeemed government security as matured when fully withdrawn.
        if (input.sourceType === "government_security" && input.securityId) {
          await updateSecurity(input.securityId, { isMatured: true });
        }

        const entry = await addWithdrawalEntry({
          portfolioId: input.portfolioId,
          sourceType: input.sourceType,
          mmfFundId: input.mmfFundId ?? null,
          bankHoldingId: input.bankHoldingId ?? null,
          securityId: input.securityId ?? null,
          amount: String(input.amount),
          forfeitedInterest: String(forfeitedInterest),
          isEarlyWithdrawal,
          withdrawalDate: new Date(input.withdrawalDate),
          reason: input.reason,
          notes: input.notes,
        });

        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "withdrawal",
          action: "create",
          field: input.sourceType,
          newValue: String(input.amount),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Recorded ${input.sourceType.replace("_", " ")} withdrawal of KES ${input.amount.toLocaleString()} on ${input.withdrawalDate}${isEarlyWithdrawal ? ` (early FD break — forfeited KES ${forfeitedInterest.toLocaleString()})` : ""}`,
        });
        return { success: true, entry, isEarlyWithdrawal, forfeitedInterest };
      }),

    delete: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteWithdrawalEntry(input.id, input.portfolioId);
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "withdrawal",
          entityId: input.id,
          action: "delete",
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Deleted withdrawal entry #${input.id}`,
        });
        return { success: true };
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

        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "rate_settings",
          action: "update",
          field: "mmfYield",
          newValue: String(input.mmfYield),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary:
            input.changeNote ??
            `Rates updated — MMF ${input.mmfYield}%, 364d T-bill ${input.tbill364Rate}%, IFB ${input.ifbCouponRate}%, WHT ${input.withholdingTax}%`,
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
        dayCountBasis: f.dayCountBasis ?? 365,
        creditingFrequency: f.creditingFrequency ?? "daily",
        whtRate: parseFloat(String(f.whtRate ?? "15")),
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
  /** Secondary MMF accounts — additional MMF funds tracked per portfolio */
  secondaryMmfs: router({
    /** List all secondary MMF accounts for a portfolio. */
    list: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getSecondaryMmfs(input.portfolioId);
        return rows.map((r) => ({
          id: r.id,
          portfolioId: r.portfolioId,
          mmfFundId: r.mmfFundId,
          label: r.label ?? null,
          currentBalance: Number(r.currentBalance),
          monthlyContribution: Number(r.monthlyContribution),
          notes: r.notes ?? null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          fundName: r.fundName,
          company: r.company,
          ear: Number(r.ear),
        }));
      }),
    /** Add a secondary MMF account. */
    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        mmfFundId: z.number().int().positive(),
        label: z.string().max(200).optional(),
        currentBalance: z.number().min(0).default(0),
        monthlyContribution: z.number().min(0).default(0),
        notes: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addSecondaryMmf({
          portfolioId: input.portfolioId,
          mmfFundId: input.mmfFundId,
          label: input.label,
          currentBalance: String(input.currentBalance),
          monthlyContribution: String(input.monthlyContribution),
          notes: input.notes,
        });
        return { success: true };
      }),
    /** Update a secondary MMF account. */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        portfolioId: z.number().int().positive(),
        mmfFundId: z.number().int().positive().optional(),
        label: z.string().max(200).optional(),
        currentBalance: z.number().min(0).optional(),
        monthlyContribution: z.number().min(0).optional(),
        notes: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const { id, portfolioId, ...rest } = input;
        await updateSecondaryMmf(id, portfolioId, {
          ...(rest.mmfFundId !== undefined && { mmfFundId: rest.mmfFundId }),
          ...(rest.label !== undefined && { label: rest.label }),
          ...(rest.currentBalance !== undefined && { currentBalance: String(rest.currentBalance) }),
          ...(rest.monthlyContribution !== undefined && { monthlyContribution: String(rest.monthlyContribution) }),
          ...(rest.notes !== undefined && { notes: rest.notes }),
        });
        return { success: true };
      }),
    /** Remove a secondary MMF account. */
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), portfolioId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteSecondaryMmf(input.id, input.portfolioId);
        return { success: true };
      }),
  }),

  /** Bank instrument holdings — per-portfolio LIVE call/fixed deposits */
  bankHoldings: router({
    list: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getBankInstrumentHoldings(input.portfolioId);
        return rows.map((r) => ({
          id: r.id,
          portfolioId: r.portfolioId,
          bankName: r.bankName,
          label: r.label ?? null,
          instrumentType: r.instrumentType,
          principal: Number(r.principal),
          interestRate: Number(r.interestRate),
          rateAsOfDate: r.rateAsOfDate ? normaliseDate(r.rateAsOfDate) : null,
          isNegotiable: r.isNegotiable,
          dayCountBasis: r.dayCountBasis,
          whtRate: Number(r.whtRate),
          startDate: r.startDate ? normaliseDate(r.startDate) : null,
          tenorMonths: r.tenorMonths ?? null,
          maturityDate: r.maturityDate ? normaliseDate(r.maturityDate) : null,
          payoutFrequency: r.payoutFrequency,
          currentValue: Number(r.currentValue),
          notes: r.notes ?? null,
          isActive: r.isActive,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
      }),
    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        bankName: z.string().min(1).max(200),
        label: z.string().max(200).optional(),
        instrumentType: z.enum(["call_deposit", "fixed_deposit"]),
        principal: z.number().min(0).default(0),
        interestRate: z.number().min(0).max(100).default(0),
        rateAsOfDate: z.string().optional(),
        isNegotiable: z.boolean().default(true),
        dayCountBasis: z.number().int().default(365),
        whtRate: z.number().min(0).max(100).default(15),
        startDate: z.string().optional(),
        tenorMonths: z.number().int().min(0).optional(),
        maturityDate: z.string().optional(),
        payoutFrequency: z.enum(["maturity", "monthly", "quarterly", "on_call"]).default("maturity"),
        notes: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addBankInstrumentHolding({
          portfolioId: input.portfolioId,
          bankName: input.bankName,
          label: input.label,
          instrumentType: input.instrumentType,
          principal: String(input.principal),
          interestRate: String(input.interestRate),
          rateAsOfDate: input.rateAsOfDate ? new Date(`${input.rateAsOfDate}T12:00:00.000Z`) : null,
          isNegotiable: input.isNegotiable,
          dayCountBasis: input.dayCountBasis,
          whtRate: String(input.whtRate),
          startDate: input.startDate ? new Date(`${input.startDate}T12:00:00.000Z`) : null,
          tenorMonths: input.tenorMonths ?? null,
          maturityDate: input.maturityDate ? new Date(`${input.maturityDate}T12:00:00.000Z`) : null,
          payoutFrequency: input.payoutFrequency,
          currentValue: String(input.principal),
        });
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "bank_holding",
          action: "create",
          field: input.bankName,
          newValue: String(input.principal),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Added ${input.instrumentType.replace("_", " ")} at ${input.bankName} (KES ${input.principal.toLocaleString()})`,
        });
        return { success: true };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        portfolioId: z.number().int().positive(),
        bankName: z.string().min(1).max(200).optional(),
        label: z.string().max(200).optional(),
        instrumentType: z.enum(["call_deposit", "fixed_deposit"]).optional(),
        principal: z.number().min(0).optional(),
        interestRate: z.number().min(0).max(100).optional(),
        rateAsOfDate: z.string().optional(),
        isNegotiable: z.boolean().optional(),
        dayCountBasis: z.number().int().optional(),
        whtRate: z.number().min(0).max(100).optional(),
        startDate: z.string().optional(),
        tenorMonths: z.number().int().min(0).optional(),
        maturityDate: z.string().optional(),
        payoutFrequency: z.enum(["maturity", "monthly", "quarterly", "on_call"]).optional(),
        notes: z.string().max(1000).optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const { id, portfolioId, ...rest } = input;
        await updateBankInstrumentHolding(id, portfolioId, {
          ...(rest.bankName !== undefined && { bankName: rest.bankName }),
          ...(rest.label !== undefined && { label: rest.label }),
          ...(rest.instrumentType !== undefined && { instrumentType: rest.instrumentType }),
          ...(rest.principal !== undefined && { principal: String(rest.principal) }),
          ...(rest.interestRate !== undefined && { interestRate: String(rest.interestRate) }),
          ...(rest.rateAsOfDate !== undefined && { rateAsOfDate: new Date(`${rest.rateAsOfDate}T12:00:00.000Z`) }),
          ...(rest.isNegotiable !== undefined && { isNegotiable: rest.isNegotiable }),
          ...(rest.dayCountBasis !== undefined && { dayCountBasis: rest.dayCountBasis }),
          ...(rest.whtRate !== undefined && { whtRate: String(rest.whtRate) }),
          ...(rest.startDate !== undefined && { startDate: new Date(`${rest.startDate}T12:00:00.000Z`) }),
          ...(rest.tenorMonths !== undefined && { tenorMonths: rest.tenorMonths }),
          ...(rest.maturityDate !== undefined && { maturityDate: new Date(`${rest.maturityDate}T12:00:00.000Z`) }),
          ...(rest.payoutFrequency !== undefined && { payoutFrequency: rest.payoutFrequency }),
          ...(rest.notes !== undefined && { notes: rest.notes }),
          ...(rest.isActive !== undefined && { isActive: rest.isActive }),
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), portfolioId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteBankInstrumentHolding(input.id, input.portfolioId);
        return { success: true };
      }),
  }),

  // ─── Round 12: MMF Composition / Strategy reference (global) ──────────────
  mmfComposition: router({
    list: publicProcedure.query(async () => {
      const rows = await getMmfCompositions();
      return rows.map((r) => ({
        id: r.id,
        mmfFundId: r.mmfFundId,
        govSecurities: Number(r.govSecurities),
        govTbills: Number(r.govTbills),
        govTbonds: Number(r.govTbonds),
        govIfb: Number(r.govIfb),
        bankInstruments: Number(r.bankInstruments),
        corporateDebt: Number(r.corporateDebt),
        cashEquivalents: Number(r.cashEquivalents),
        offshoreRegional: Number(r.offshoreRegional),
        realEstate: Number(r.realEstate),
        otherAssets: Number(r.otherAssets),
        bankNote: r.bankNote ?? null,
        corporateNote: r.corporateNote ?? null,
        cashNote: r.cashNote ?? null,
        offshoreNote: r.offshoreNote ?? null,
        realEstateNote: r.realEstateNote ?? null,
        otherNote: r.otherNote ?? null,
        notes: r.notes ?? null,
        asOfDate: r.asOfDate,
        source: r.source ?? null,
        isEstimate: Boolean(r.isEstimate),
        updatedAt: r.updatedAt,
        fundName: r.fundName,
        company: r.company,
        ear: Number(r.ear),
        grossYield: Number(r.grossYield),
        managementFee: Number(r.managementFee),
      }));
    }),
    upsert: protectedProcedure
      .input(z.object({
        mmfFundId: z.number().int().positive(),
        govSecurities: z.number().min(0).max(100),
        govTbills: z.number().min(0).max(100).default(0),
        govTbonds: z.number().min(0).max(100).default(0),
        govIfb: z.number().min(0).max(100).default(0),
        bankInstruments: z.number().min(0).max(100),
        corporateDebt: z.number().min(0).max(100),
        cashEquivalents: z.number().min(0).max(100),
        offshoreRegional: z.number().min(0).max(100),
        realEstate: z.number().min(0).max(100).default(0),
        otherAssets: z.number().min(0).max(100).default(0),
        bankNote: z.string().max(2000).optional(),
        corporateNote: z.string().max(2000).optional(),
        cashNote: z.string().max(2000).optional(),
        offshoreNote: z.string().max(2000).optional(),
        realEstateNote: z.string().max(2000).optional(),
        otherNote: z.string().max(2000).optional(),
        notes: z.string().max(2000).optional(),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
        isEstimate: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertMmfComposition({
          mmfFundId: input.mmfFundId,
          govSecurities: String(input.govSecurities),
          govTbills: String(input.govTbills),
          govTbonds: String(input.govTbonds),
          govIfb: String(input.govIfb),
          bankInstruments: String(input.bankInstruments),
          corporateDebt: String(input.corporateDebt),
          cashEquivalents: String(input.cashEquivalents),
          offshoreRegional: String(input.offshoreRegional),
          realEstate: String(input.realEstate),
          otherAssets: String(input.otherAssets),
          bankNote: input.bankNote,
          corporateNote: input.corporateNote,
          cashNote: input.cashNote,
          offshoreNote: input.offshoreNote,
          realEstateNote: input.realEstateNote,
          otherNote: input.otherNote,
          notes: input.notes,
          asOfDate: input.asOfDate ? new Date(input.asOfDate) : undefined,
          source: input.source,
          isEstimate: input.isEstimate,
        });
        await addAuditLog({
          entity: "mmf_composition",
          entityId: input.mmfFundId,
          action: "update",
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Updated composition for fund #${input.mmfFundId}`,
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deleteMmfComposition(input.id);
        return { success: true };
      }),
  }),

  // ─── Round 12: Bank Sector Instruments reference (global) ─────────────────
  bankInstruments: router({
    list: publicProcedure.query(async () => {
      const rows = await getBankInstruments();
      return rows.map((r) => ({
        id: r.id,
        bankName: r.bankName,
        instrumentType: r.instrumentType,
        minAmount: Number(r.minAmount),
        typicalTenor: r.typicalTenor ?? null,
        indicativeRate: r.indicativeRate === null ? null : Number(r.indicativeRate),
        isNegotiable: Boolean(r.isNegotiable),
        notes: r.notes ?? null,
        asOfDate: r.asOfDate,
        source: r.source ?? null,
        isActive: Boolean(r.isActive),
      }));
    }),
    add: protectedProcedure
      .input(z.object({
        bankName: z.string().min(1).max(200),
        instrumentType: z.enum(["call_deposit", "fixed_deposit", "ordinary_savings", "target_savings", "tiered_savings"]),
        minAmount: z.number().min(0).default(0),
        typicalTenor: z.string().max(100).optional(),
        indicativeRate: z.number().min(0).max(100).optional(),
        isNegotiable: z.boolean().default(true),
        notes: z.string().max(2000).optional(),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        await addBankInstrument({
          bankName: input.bankName,
          instrumentType: input.instrumentType,
          minAmount: String(input.minAmount),
          typicalTenor: input.typicalTenor,
          indicativeRate: input.indicativeRate === undefined ? null : String(input.indicativeRate),
          isNegotiable: input.isNegotiable,
          notes: input.notes,
          asOfDate: input.asOfDate ? new Date(input.asOfDate) : undefined,
          source: input.source,
        });
        return { success: true };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        bankName: z.string().min(1).max(200).optional(),
        instrumentType: z.enum(["call_deposit", "fixed_deposit", "ordinary_savings", "target_savings", "tiered_savings"]).optional(),
        minAmount: z.number().min(0).optional(),
        typicalTenor: z.string().max(100).optional(),
        indicativeRate: z.number().min(0).max(100).nullable().optional(),
        isNegotiable: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...rest } = input;
        await updateBankInstrument(id, {
          ...(rest.bankName !== undefined && { bankName: rest.bankName }),
          ...(rest.instrumentType !== undefined && { instrumentType: rest.instrumentType }),
          ...(rest.minAmount !== undefined && { minAmount: String(rest.minAmount) }),
          ...(rest.typicalTenor !== undefined && { typicalTenor: rest.typicalTenor }),
          ...(rest.indicativeRate !== undefined && { indicativeRate: rest.indicativeRate === null ? null : String(rest.indicativeRate) }),
          ...(rest.isNegotiable !== undefined && { isNegotiable: rest.isNegotiable }),
          ...(rest.notes !== undefined && { notes: rest.notes }),
          ...(rest.asOfDate !== undefined && { asOfDate: new Date(rest.asOfDate) }),
          ...(rest.source !== undefined && { source: rest.source }),
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deleteBankInstrument(input.id);
        return { success: true };
      }),
  }),

  // ─── Round 12: Benchmark inputs (global) ──────────────────────────────────
  benchmarks: router({
    list: publicProcedure.query(async () => {
      const rows = await getBenchmarkInputs();
      return rows.map((r) => ({
        id: r.id,
        metricKey: r.metricKey,
        label: r.label,
        value: Number(r.value),
        asOfDate: r.asOfDate,
        source: r.source ?? null,
        notes: r.notes ?? null,
        updatedAt: r.updatedAt,
      }));
    }),
    upsert: protectedProcedure
      .input(z.object({
        metricKey: z.string().min(1).max(64),
        label: z.string().min(1).max(200),
        value: z.number().min(0).max(100),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
        notes: z.string().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertBenchmarkInput({
          metricKey: input.metricKey,
          label: input.label,
          value: String(input.value),
          asOfDate: input.asOfDate ? new Date(input.asOfDate) : undefined,
          source: input.source,
          notes: input.notes,
        });
        await addAuditLog({
          entity: "benchmark_inputs",
          action: "update",
          field: input.metricKey,
          newValue: String(input.value),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Updated benchmark ${input.label} to ${input.value}%`,
        });
        return { success: true };
      }),
  }),

  // ─── Round 12: Audit log (per-portfolio) ──────────────────────────────────
  audit: router({
    list: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), limit: z.number().int().min(1).max(500).default(100) }))
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getAuditLog(input.portfolioId, input.limit);
        return rows.map((r) => ({
          id: r.id,
          entity: r.entity,
          entityId: r.entityId,
          action: r.action,
          field: r.field ?? null,
          oldValue: r.oldValue ?? null,
          newValue: r.newValue ?? null,
          changedByName: r.changedByName ?? null,
          summary: r.summary ?? null,
          createdAt: r.createdAt,
        }));
      }),
    record: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        entity: z.string().max(64),
        entityId: z.number().int().optional(),
        action: z.enum(["create", "update", "delete"]),
        field: z.string().max(100).optional(),
        oldValue: z.string().max(2000).optional(),
        newValue: z.string().max(2000).optional(),
        summary: z.string().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: input.entity,
          entityId: input.entityId,
          action: input.action,
          field: input.field,
          oldValue: input.oldValue,
          newValue: input.newValue,
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: input.summary,
        });
        return { success: true };
      }),
  }),

  // ─── Round 12: MMF fund accrual settings ──────────────────────────────────
  mmfAccrual: router({
    updateSettings: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        dayCountBasis: z.union([z.literal(360), z.literal(365)]).optional(),
        creditingFrequency: z.enum(["daily", "monthly"]).optional(),
        whtRate: z.number().min(0).max(100).optional(),
      }))
      .mutation(async ({ input }) => {
        await updateMmfFundAccrualSettings(input.id, {
          ...(input.dayCountBasis !== undefined && { dayCountBasis: input.dayCountBasis }),
          ...(input.creditingFrequency !== undefined && { creditingFrequency: input.creditingFrequency }),
          ...(input.whtRate !== undefined && { whtRate: String(input.whtRate) }),
        });
        return { success: true };
      }),
  }),

  // ─── Test / Sandbox mode ────────────────────────────────────────────
  testMode: router({
    /** Seed a realistic sample sandbox portfolio (isolated from live data). */
    seedSample: protectedProcedure.mutation(async ({ ctx }) => {
      const funds = await getMmfFunds();
      const pickFund = (needle: string) =>
        funds.find((f) => f.fundName.toLowerCase().includes(needle.toLowerCase()));
      const primary = pickFund("nabo") ?? funds[0];
      const secondaryA = pickFund("cytonn") ?? funds[1] ?? primary;
      const secondaryB = pickFund("etica") ?? funds[2] ?? primary;

      // Anchor the demo to a start date ~7 months in the PAST so the sample
      // portfolio actually exercises the elapsed-month (actuals) path. Using a
      // future date would make currentMonth=0 and hide every recorded deposit.
      const now = new Date();
      const startBase = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 7, 1, 12, 0, 0));
      const iso = (year: number, monthIndex: number, day: number) =>
        `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      // Helper: ISO date `k` months after the start month (clamped day 5/15).
      const monthsAfterStart = (k: number, day: number) => {
        const d = new Date(Date.UTC(startBase.getUTCFullYear(), startBase.getUTCMonth() + k, day, 12, 0, 0));
        return iso(d.getUTCFullYear(), d.getUTCMonth(), day);
      };

      const p = await createPortfolio({
        userId: ctx.user.id,
        isSandbox: true,
        name: "Sample Portfolio (Demo)",
        description: "Auto-generated demo data — safe to explore, edit, or reset.",
        targetAmount: "5000000",
        startDate: startBase,
        horizonMonths: 120,
        startingContribution: "30000",
        stepUpAmount: "3000",
        stepUpMonths: 6,
        safetyFloor: "50000",
        foundationFrac: "0.20",
        growthFrac: "0.50",
        deRiskingFrac: "0.15",
        mmfFundId: primary?.id ?? null,
      });
      if (!p) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to seed sample." });
      await ensureRateSettings(p.id);

      // A few primary-fund (MMF) and government-security deposits.
      // For government securities we mirror deposits.add: create the deposit AND a
      // linked register row (the single source of truth) so the sample portfolio
      // reconciles cleanly (deposit ledger ↔ CBK register ↔ engine valuation).
      const seedRates = await getRateSettings(p.id);
      const seedDeposit = async (
        bucket: "mmf" | "tbill" | "ifb" | "fxd",
        institutionType: "mmf_fund" | "government_security",
        amount: number,
        date: string,
        mmfFundId?: number,
      ) => {
        const entry = await addDepositEntry({
          portfolioId: p.id,
          bucket,
          institutionType,
          mmfFundId: mmfFundId ?? null,
          bankHoldingId: null,
          amount: String(amount),
          depositDate: new Date(`${date}T12:00:00.000Z`),
          notes: "Sample data",
        });
        if (institutionType === "government_security" && entry) {
          const securityType: "tbill_364" | "ifb" | "fxd" =
            bucket === "tbill" ? "tbill_364" : bucket === "ifb" ? "ifb" : "fxd";
          const tenorMonths = bucket === "tbill" ? 12 : 24;
          const issue = new Date(`${date}T12:00:00.000Z`);
          const maturity = new Date(issue);
          maturity.setMonth(maturity.getMonth() + tenorMonths);
          const couponRate =
            bucket === "ifb"
              ? parseFloat(String(seedRates?.ifbCouponRate ?? "0")) || 0
              : bucket === "fxd"
                ? parseFloat(String(seedRates?.fxdCouponRate ?? "0")) || 0
                : 0;
          const sec = await addSecurity({
            portfolioId: p.id,
            securityType,
            faceValue: String(amount),
            issueDate: issue,
            maturityDate: maturity,
            couponRate: String(couponRate),
            isTaxExempt: bucket === "ifb",
            notes: `Auto-created from sample deposit on ${date}`,
          });
          if (sec?.id) await updateDepositEntry(entry.id, p.id, { securityId: sec.id });
        }
        return entry;
      };
      // Primary-fund MMF deposits dated across the elapsed months (months 1, 2, 4).
      await seedDeposit("mmf", "mmf_fund", 90000, monthsAfterStart(0, 5), primary?.id);
      await seedDeposit("mmf", "mmf_fund", 30000, monthsAfterStart(1, 5), primary?.id);
      await seedDeposit("mmf", "mmf_fund", 30000, monthsAfterStart(3, 5), primary?.id);
      // Government-security deposits (T-bill + FXD) in elapsed months 2 and 3.
      await seedDeposit("tbill", "government_security", 50000, monthsAfterStart(1, 15));
      await seedDeposit("fxd", "government_security", 100000, monthsAfterStart(2, 1));

      // Two secondary MMF accounts.
      if (secondaryA && secondaryA.id !== primary?.id) {
        await addSecondaryMmf({
          portfolioId: p.id,
          mmfFundId: secondaryA.id,
          label: "Emergency pot",
          currentBalance: "120000",
          monthlyContribution: "5000",
          notes: "Sample data",
        });
      }
      if (secondaryB && secondaryB.id !== primary?.id && secondaryB.id !== secondaryA?.id) {
        await addSecondaryMmf({
          portfolioId: p.id,
          mmfFundId: secondaryB.id,
          label: "Short-term savings",
          currentBalance: "60000",
          monthlyContribution: "0",
          notes: "Sample data",
        });
      }

      // A bank fixed deposit (live actual) opened in elapsed month 3, 6-month tenor.
      const bankStart = new Date(Date.UTC(startBase.getUTCFullYear(), startBase.getUTCMonth() + 2, 19, 12, 0, 0));
      const bankMaturity = new Date(Date.UTC(startBase.getUTCFullYear(), startBase.getUTCMonth() + 8, 19, 12, 0, 0));
      await addBankInstrumentHolding({
        portfolioId: p.id,
        bankName: "Equity Bank",
        label: "6-month fixed deposit",
        instrumentType: "fixed_deposit",
        principal: "200000",
        interestRate: "10.5000",
        rateAsOfDate: bankStart,
        isNegotiable: true,
        dayCountBasis: 365,
        whtRate: "15.0000",
        startDate: bankStart,
        tenorMonths: 6,
        maturityDate: bankMaturity,
        payoutFrequency: "maturity",
        currentValue: "200000",
      });

      return { success: true, portfolioId: p.id };
    }),

    /** Delete ALL sandbox portfolios (and their child data) for the current user. */
    reset: protectedProcedure.mutation(async ({ ctx }) => {
      const sandboxes = await getPortfolios(ctx.user.id, true);
      for (const s of sandboxes) {
        await deletePortfolio(s.id, ctx.user.id);
      }
      return { success: true, deleted: sandboxes.length };
    }),
  }),
});
export type AppRouter = typeof appRouter;
