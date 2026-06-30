import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
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
  getOtherHolding,
  addOtherHolding,
  updateOtherHolding,
  deleteOtherHolding,
  getHoldingIncome,
  getPortfolioHoldingIncome,
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
  getInflationBenchmarkPct,
  upsertBenchmarkInput,
  addAuditLog,
  getAuditLog,
  getBreachAcks,
  updateMmfFundAccrualSettings,
  getLiquidHomeBalances,
  upsertLiquidHomeBalance,
  clearLiquidHomeBalance,
  recordDriftSnapshot,
  getDriftHistory,
  setDriftSnoozeUntil,
  setDriftLastNotifiedAt,
  setDriftDigestConfig,
  setDriftDigestPending,
  deleteSimSessionRecords,
  deleteDepositEntriesByIds,
  countSimSessionRecords,
  listOpportunities,
  getOpportunityByRef,
  countOpportunities,
  upsertOpportunity,
  verifyOpportunityField,
  rejectAiField,
  listIngestionConflicts,
  countOpenConflicts,
  resolveIngestionConflict,
  ingestAiExtractedInstrument,
  attachAiSourceImageKey,
  insertAiCandidates,
  listAiCandidates,
  countPendingCandidates,
  getAiCandidate,
  reviewAiCandidate,
  insertAiIntakeAudit,
  listAiIntakeAudit,
  listAllocationTemplates,
  getGlideParams,
  getProbabilityThresholds,
} from "./db";
import { OPPORTUNITY_SEED } from "./opportunitySeed";
import {
  aiExtractInstrument,
  aiDiscoverCandidates,
  fetchDocumentText,
  isThinFetch,
  type ExtractionSource,
} from "./aiIntakeService";
import { extractionToAdapterResult, aiInstrumentToProvenanceMap } from "../shared/aiAdapter";
import {
  ALLOCATION_TIERS,
  type AllocationTier,
  sampleGlidePath,
  resolveBucketAssumptions,
  glideGoalProbability,
  computeLevers,
  probabilityInsight,
  ALLOCATION_BUCKETS,
  suggestTier,
  resolveTierSelection,
  glidedAllocation,
  computeBucketGaps,
  type GoalNature,
  type ActualBucketValues,
} from "../shared/allocationModel";
import { storagePut, storageGetSignedUrl } from "./storage";
import { stripVerdictFields } from "../shared/aiIntake";
import {
  FIELD_KEYS,
  isFieldKey,
  humanField,
  type VerifyAction,
  type FieldKey,
  type FieldProvenance,
  type FieldProvenanceMap,
} from "../shared/provenance";
import {
  summariseState,
  isAiProvisionalRow,
  countAiFigures,
} from "../shared/provenance";
import type { InsertOpportunity, InsertAiIntakeAudit } from "../drizzle/schema";
import { runAdapter } from "./ingestion/runner";
import { ADAPTERS } from "./ingestion/adapters";
import { SOURCE_IDS, AI_INTAKE_SOURCE_ID } from "../shared/ingestion";
import { notifyOwner } from "./_core/notification";
import { createHeartbeatJob, updateHeartbeatJob, deleteHeartbeatJob } from "./_core/heartbeat";
import { parse as parseCookie } from "cookie";
import {
  runProjection,
  runScenarios,
  projectedLiquidSplit,
  type ProjectedLiquidHomeInput,
  deriveStepUps,
  checkMilestones,
  getScheduledContribution,
  computeCurrentMonth,
  generateMilestones,
  solveForContribution,
  solveForStepUp,
  projectEndingValue,
  deriveSafetyFloor,
  SWEEP_LOT_SIZE,
  SCENARIO_STEPUPS,
  detectIssuerConcentration,
  ISSUER_CONCENTRATION_CAP,
  type EngineSettings,
  type ActualDeposit,
  type ActualSecurity,
  type ActualBankHolding,
  type SecondaryMmfInput,
} from "./engine";
import { COOKIE_NAME } from "../shared/const";
import {
  reconcile,
  reconcileMmf,
  reconcileGov,
  reconcileBank,
  reconcileAccrual,
  reconcileHoldings,
  type AccrualReconItem,
} from "../shared/reconciliation";
import { valueHolding } from "../shared/holdingValue";
import {
  resolveRiskAssumption,
  buildEndValueDistribution,
  goalProbability,
  assessToleranceMismatch,
  assessVolatileConcentration,
  type RiskPosition,
  type RiskTolerance,
} from "../shared/riskModel";
import {
  buildSecurityDailySchedule,
  buildBankDailySchedule,
  type SecurityIncomeInput,
  type BankIncomeInput,
} from "../shared/incomeBreakdown";
import {
  computeMaturityDate,
  defaultRateForSecurity,
  whtRateForSecurity,
  isDiscountInstrument,
  tenorYearsForSecurity,
  TBILL_TENOR_DAYS,
  type SecurityType as GovSecurityType,
} from "../shared/securityTenor";
import { assetClassForSecurityType, assetGuardIssues, type AssetClass, profileFor } from "../shared/assetModel";
import { taxFor } from "../shared/assetTax";
import {
  type ModelingInputs,
  modelingIssues,
  deriveAmountKes,
  buildHoldingDraft,
  previewModelImpact,
  computeExit,
  registerClassForAssetClass,
} from "../shared/modeling";
import { buildAllocation, blendedYield } from "../shared/actuals";
import { buildPortfolioSnapshot } from "./snapshot";
import {
  buildProjectionRange,
  assessPace,
  assessBackloading,
  assessLiquidityCushion,
  computeInflationAdjustedGoal,
  computeSavingsLedSplit,
} from "../shared/decisionSurface";
import { discountPriceForSecurity, tbillPrice, parseBreachAckRow } from "../shared/discount";
import {
  advance as advanceClock,
  toUtcMidnight,
  todayUtcMidnight,
  nextEventAfter,
  clampTarget,
  parseDateToUtcMidnight,
  formatUtcDate,
  parseStepLog,
  popLastStep,
  describeStepTarget,
  type SimEvent,
  type SimStep,
  type StepUnit,
  type MaterializeMode,
} from "../shared/timeMachine";
import { buildMaterializePlan } from "./timeMachineEngine";
import { randomUUID } from "crypto";
import {
  allocateLiquidReserve,
  isLiquidBankKind,
  evaluateDriftThreshold,
  type LiquidHome,
  type LiquidAllocationSlice,
  type LiquidAllocationResult,
} from "../shared/liquidAllocator";

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
    // Round 40: per-tenor bond rate maps (null when unset).
    ifbTenorRates: (r?.ifbTenorRates as Record<string, number> | null | undefined) ?? null,
    fxdTenorRates: (r?.fxdTenorRates as Record<string, number> | null | undefined) ?? null,
    // Round 62: per-portfolio concentration caps + allocation policy. Defaults
    // (issuer 25% / type 60% / balanced) preserve prior engine behaviour.
    issuerCapFrac: p
      ? (parseFloat(String((p as { concentrationCapPct?: string }).concentrationCapPct ?? "25")) || 25) / 100
      : 0.25,
    typeCapFrac: p
      ? (parseFloat(String((p as { typeConcentrationCapPct?: string }).typeConcentrationCapPct ?? "60")) || 60) / 100
      : 0.6,
    allocationPolicy:
      ((p as { allocationPolicy?: string } | null)?.allocationPolicy as
        | "balanced"
        | "yield_first"
        | "custom"
        | undefined) ?? "balanced",
    // Time Machine (sandbox only): a simulated "today" overrides the real clock
    // for the whole projection (actual/projected boundary, lot ages, maturity &
    // coupon timing). Only honoured for sandbox portfolios; Live always real.
    nowOverride: simulatedNow(p),
    // Time Machine rate-shock (sandbox only): persisted on the portfolio so EVERY
    // projection read (dashboard, ledger, reconciliation) reflects the stress.
    rateShock: simulatedRateShock(p),
  };
}

/**
 * Time Machine rate-shock source of truth. Returns the parsed shock when the
 * portfolio is a SANDBOX portfolio with a valid `simRateShock` JSON, else
 * undefined. Live portfolios never honour it.
 */
function simulatedRateShock(
  p: Awaited<ReturnType<typeof getPortfolio>>,
): { effectiveDate: string; deltaPct: number } | undefined {
  if (!p) return undefined;
  if ((p as { isSandbox?: boolean }).isSandbox !== true) return undefined;
  const raw = (p as { simRateShock?: string | null }).simRateShock;
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.effectiveDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(parsed.effectiveDate) &&
      typeof parsed.deltaPct === "number" &&
      Number.isFinite(parsed.deltaPct)
    ) {
      return { effectiveDate: parsed.effectiveDate, deltaPct: parsed.deltaPct };
    }
  } catch {
    /* ignore malformed */
  }
  return undefined;
}

/**
 * Time Machine source of truth for "now" (Unix-ms). Returns the portfolio's
 * simulatedDate when it is a SANDBOX portfolio with the clock set, otherwise
 * undefined (engine falls back to the real clock). Live portfolios always read
 * the real clock, even if a stray simulatedDate were ever present.
 */
function simulatedNow(
  p: Awaited<ReturnType<typeof getPortfolio>>,
): number | undefined {
  if (!p) return undefined;
  const sandbox = (p as { isSandbox?: boolean }).isSandbox === true;
  const sim = (p as { simulatedDate?: number | null }).simulatedDate;
  return sandbox && sim != null ? sim : undefined;
}

/** As {@link simulatedNow} but always returns a concrete ms (real clock fallback). */
export function getNow(
  p: Awaited<ReturnType<typeof getPortfolio>>,
): number {
  return simulatedNow(p) ?? Date.now();
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
    label: (b as { label?: string | null }).label ?? null,
    bankName: (b as { bankName?: string | null }).bankName ?? null,
    principal: parseFloat(String(b.principal ?? "0")) || 0,
    interestRate: parseFloat(String(b.interestRate ?? "0")) || 0,
    whtRate: b.whtRate != null ? parseFloat(String(b.whtRate)) : null,
    dayCountBasis: (b as { dayCountBasis?: number | null }).dayCountBasis ?? 365,
    startDate: normaliseDate((b as { startDate?: Date | string | null }).startDate),
    isActive: !!b.isActive,
    // Round 30: term/maturity metadata drives forward maturity + redeployment.
    instrumentType: (b as { instrumentType?: ActualBankHolding["instrumentType"] }).instrumentType ?? null,
    tenorMonths: (b as { tenorMonths?: number | null }).tenorMonths ?? null,
    maturityDate: normaliseDate((b as { maturityDate?: Date | string | null }).maturityDate),
    payoutFrequency: (b as { payoutFrequency?: ActualBankHolding["payoutFrequency"] }).payoutFrequency ?? null,
    // Round 31: maturity behaviour (rollover vs redeploy) + early-break penalty.
    maturityAction: (b as { maturityAction?: ActualBankHolding["maturityAction"] }).maturityAction ?? "redeploy",
    earlyBreakPenaltyPct: (b as { earlyBreakPenaltyPct?: string | number | null }).earlyBreakPenaltyPct != null
      ? parseFloat(String((b as { earlyBreakPenaltyPct?: string | number | null }).earlyBreakPenaltyPct))
      : null,
  }));
}

function mapActualSecurities(rows: Awaited<ReturnType<typeof getSecurities>>): ActualSecurity[] {
  return rows.map((s) => {
    const num = (v: unknown): number | null =>
      v != null && String(v) !== "" && Number.isFinite(parseFloat(String(v)))
        ? parseFloat(String(v))
        : null;
    return {
      securityType: s.securityType as ActualSecurity["securityType"],
      faceValue: parseFloat(String(s.faceValue)),
      issueDate: normaliseDate(s.issueDate),
      maturityDate: normaliseDate(s.maturityDate),
      couponRate: parseFloat(String(s.couponRate)),
      isTaxExempt: s.isTaxExempt,
      isMatured: s.isMatured,
      // Round 42 — discount + floating-rate fields.
      purchasePrice: num((s as { purchasePrice?: unknown }).purchasePrice),
      discountRate: num((s as { discountRate?: unknown }).discountRate),
      marginRate: num((s as { marginRate?: unknown }).marginRate),
      resetMonths: num((s as { resetMonths?: unknown }).resetMonths),
    };
  });
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

/**
 * R67 — shared liquid-drift context. Rebuilds the eligible liquid homes exactly
 * like the `liquidAllocation` query, overlays user-recorded actuals, runs the
 * allocator, and evaluates the drift threshold. Returned to the query for the UI
 * and reused by the reconcile mutations to snapshot drift + decide whether to
 * notify the owner. Single source of truth so the two never diverge.
 */
type DriftSlice = LiquidAllocationSlice & {
  currentBalance: number;
  reconciled: boolean;
  reconciledAt: number | null;
  drift: number;
};
function emptyAllocResult(): LiquidAllocationResult {
  return {
    state: "too_small",
    liquidPot: 0,
    netWorth: 0,
    effectiveIssuerCapFrac: 0,
    homeCount: 0,
    issuerCount: 0,
    slices: [],
    message: "No eligible liquid homes yet.",
  };
}
async function computeLiquidDriftContext(
  p: Awaited<ReturnType<typeof getPortfolio>>,
): Promise<{
  netWorth: number;
  slices: DriftSlice[];
  result: LiquidAllocationResult;
  hasActuals: boolean;
  reconciledCount: number;
  driftThresholdPct: number;
  drift: { totalDrift: number; thresholdValue: number; breached: boolean };
}> {
  if (!p) {
    return {
      netWorth: 0,
      slices: [],
      result: emptyAllocResult(),
      hasActuals: false,
      reconciledCount: 0,
      driftThresholdPct: 5,
      drift: { totalDrift: 0, thresholdValue: 0, breached: false },
    };
  }
  const rates = await getRateSettings(p.id);
  const fundEar = await getSelectedFundEar(p);
  const settings = dbToEngine(rates, p, fundEar);
  const summary = await getActualsSummary(
    p.id,
    settings.targetAmount,
    settings.withholdingTax,
    settings.fxdCouponRate,
    settings.mmfYield,
    settings.tbill364Rate,
  );
  const netWorth = summary ? summary.totalContributed : 0;
  const primaryMmfBalance = summary ? summary.depositsContributed : 0;

  const homes: LiquidHome[] = [];
  const primaryFund = p.mmfFundId ? await getMmfFund(p.mmfFundId) : null;
  if (primaryFund) {
    homes.push({
      id: `mmf:${primaryFund.id}`,
      label: primaryFund.fundName,
      kind: "primary_mmf",
      issuer: primaryFund.company || primaryFund.fundName,
      grossYieldPct: parseFloat(String(primaryFund.grossYield)) || 0,
      whtRatePct: parseFloat(String(primaryFund.whtRate)) || 15,
      currentBalance: primaryMmfBalance,
      minBalance: parseFloat(String(primaryFund.minInvestment)) || 0,
    });
  }
  const secs = await getSecondaryMmfs(p.id);
  for (const s of secs) {
    homes.push({
      id: `mmf:${s.mmfFundId}`,
      label: s.label || s.fundName || "Secondary MMF",
      kind: "secondary_mmf",
      issuer: s.company || s.fundName || s.label || `fund-${s.mmfFundId}`,
      grossYieldPct: parseFloat(String(s.ear)) || 0,
      whtRatePct: parseFloat(String(s.whtRate)) || 15,
      currentBalance: parseFloat(String(s.currentBalance)) || 0,
      minBalance: 0,
    });
  }
  const bank = await getBankInstrumentHoldings(p.id);
  for (const b of bank) {
    if (!b.isActive) continue;
    if (!isLiquidBankKind(String(b.instrumentType))) continue;
    homes.push({
      id: `bank:${b.id}`,
      label: b.label || `${b.bankName} ${String(b.instrumentType).replace(/_/g, " ")}`,
      kind: String(b.instrumentType) as LiquidHome["kind"],
      issuer: b.bankName,
      grossYieldPct: parseFloat(String(b.interestRate)) || 0,
      whtRatePct: parseFloat(String(b.whtRate)) || 15,
      currentBalance: Math.max(
        parseFloat(String(b.currentValue)) || 0,
        parseFloat(String(b.principal)) || 0,
      ),
      minBalance: 0,
    });
  }

  const issuerCapPct = parseFloat(
    String((p as { concentrationCapPct?: string }).concentrationCapPct ?? "25"),
  );
  const issuerCapFrac =
    (Number.isFinite(issuerCapPct) && issuerCapPct > 0 ? issuerCapPct : 25) / 100;
  const allocationPolicy =
    ((p as { allocationPolicy?: string }).allocationPolicy as
      | "balanced"
      | "yield_first"
      | "custom"
      | undefined) ?? "balanced";

  const recorded = await getLiquidHomeBalances(p.id);
  const actualById = new Map(
    recorded.map((r) => [r.homeId, parseFloat(String(r.actualBalance)) || 0]),
  );
  const reconciledAtById = new Map<string, number>(
    recorded
      .filter((r) => r.updatedAt instanceof Date)
      .map((r) => [r.homeId, (r.updatedAt as Date).getTime()]),
  );
  const reconciledIds: string[] = [];
  for (const h of homes) {
    if (actualById.has(h.id)) {
      h.currentBalance = actualById.get(h.id) ?? 0;
      reconciledIds.push(h.id);
    }
  }
  const hasActuals = reconciledIds.length > 0;
  const liquidPot = homes.reduce((sum, h) => sum + h.currentBalance, 0);

  const result = allocateLiquidReserve({
    homes,
    netWorth,
    liquidPot,
    issuerCapFrac,
    safetyFloor: settings.safetyFloor,
    allocationPolicy,
  });

  const currentById = new Map(homes.map((h) => [h.id, h.currentBalance]));
  const slices = result.slices.map((s) => {
    const current = currentById.get(s.id) ?? 0;
    return {
      ...s,
      currentBalance: Math.round(current * 100) / 100,
      reconciled: actualById.has(s.id),
      reconciledAt: reconciledAtById.get(s.id) ?? null,
      drift: Math.round((current - s.targetBalance) * 100) / 100,
    };
  });
  const driftThresholdPct = parseFloat(
    String((p as { driftAlertThresholdPct?: string }).driftAlertThresholdPct ?? "5"),
  );
  const drift = evaluateDriftThreshold({
    drifts: slices.map((s) => s.drift ?? 0),
    netWorth,
    thresholdPct: driftThresholdPct,
    hasActuals,
  });
  return {
    netWorth,
    slices,
    result,
    hasActuals,
    reconciledCount: reconciledIds.length,
    driftThresholdPct,
    drift,
  };
}

/**
 * R68 — exported drift snapshot for the scheduled digest handler. Re-reads the
 * portfolio (by owner) and returns just the numbers the digest needs.
 */
export async function computeDriftForPortfolio(portfolioId: number, userId: number) {
  const p = await requirePortfolio(portfolioId, userId);
  const c = await computeLiquidDriftContext(p);
  return {
    totalDrift: c.drift.totalDrift,
    thresholdValue: c.drift.thresholdValue,
    thresholdPct: c.driftThresholdPct,
    breached: c.drift.breached,
  };
}

/**
 * R67 — after a reconcile changes balances, snapshot the new drift for the
 * sparkline and notify the owner ONCE on a fresh transition into breach
 * (respecting the drift snooze). Re-reads the portfolio so freshly-saved
 * balances and notify timestamps are seen.
 */
async function snapshotAndMaybeNotifyDrift(
  portfolioId: number,
  userId: number,
) {
  const p = await requirePortfolio(portfolioId, userId);
  const ctx = await computeLiquidDriftContext(p);
  await recordDriftSnapshot({
    portfolioId,
    totalDrift: ctx.drift.totalDrift,
    netWorth: ctx.netWorth,
    thresholdValue: ctx.drift.thresholdValue,
    breached: ctx.drift.breached,
  });

  const now = Date.now();
  const snoozeUntil =
    (p as { driftSnoozeUntil?: number | null }).driftSnoozeUntil ?? null;
  const snoozed = typeof snoozeUntil === "number" && snoozeUntil > now;
  const lastNotified =
    (p as { driftLastNotifiedAt?: number | null }).driftLastNotifiedAt ?? null;
  const digestMode =
    (p as { driftDigestMode?: string }).driftDigestMode === "digest";
  // Notify only on a fresh transition: breached now, not snoozed, and either
  // never notified or the previous snapshot was within threshold. We treat
  // "last notified more than 6h ago" as a fresh event to avoid duplicate pings.
  const freshEvent =
    !lastNotified || now - lastNotified > 6 * 60 * 60 * 1000;
  if (ctx.drift.breached && !snoozed) {
    if (digestMode) {
      // R68 — in digest mode we suppress the per-event ping and just flag a
      // pending breach; the daily Heartbeat cron sends one summary.
      await setDriftDigestPending(portfolioId, true);
    } else if (freshEvent) {
      try {
        await notifyOwner({
          title: "Liquid drift exceeds your rebalancing threshold",
          content: `Your recorded liquid balances have drifted KES ${Math.round(
            ctx.drift.totalDrift,
          ).toLocaleString()} from the recommended split (threshold KES ${Math.round(
            ctx.drift.thresholdValue,
          ).toLocaleString()}, ${ctx.driftThresholdPct}% of net worth). Open the dashboard to review the suggested transfers.`,
        });
      } catch {
        // Notification is best-effort; never block the reconcile.
      }
      await setDriftLastNotifiedAt(portfolioId, now);
    }
  }
  return ctx.drift;
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
  // Round 34: editable per-issuer concentration cap (%). 5–100.
  concentrationCapPct: z.number().min(5).max(100).optional(),
  // Round 58: editable per-instrument-type concentration cap (%). 10–100.
  typeConcentrationCapPct: z.number().min(10).max(100).optional(),
  // Round 62: allocation policy governing sweep/allocator/warnings.
  allocationPolicy: z.enum(["balanced", "yield_first", "custom"]).optional(),
  // Round 66: total-liquid-drift alert threshold (% of net worth). 1–50.
  driftAlertThresholdPct: z.number().min(1).max(50).optional(),
  // Part A1: inflation-link this goal (the liability). Default off.
  inflationLinked: z.boolean().optional(),
  // Part A1: optional override for the goal inflation rate (% p.a.); null/omitted
  // = use the global inflation benchmark already shown on the Dashboard.
  inflationOverrideRate: z.number().min(0).max(50).nullable().optional(),
  // Part 6: optional stated risk tolerance (comfort band). Informs defaults +
  // warns on mismatch only; never auto-allocates. null/omitted = not stated.
  riskTolerance: z
    .enum(["capital_preservation", "conservative", "balanced", "growth", "aggressive"])
    .nullable()
    .optional(),
});

/**
 * Assemble the full input bundle runProjection needs for a portfolio. Centralised
 * so the projection.run procedure AND the Time Machine share one identical path —
 * any divergence would let a fast-forward disagree with the live projection.
 */
async function loadProjectionInputs(
  portfolioId: number,
  p: Awaited<ReturnType<typeof getPortfolio>>,
) {
  const [rates, fundEar] = await Promise.all([getRateSettings(portfolioId), getSelectedFundEar(p)]);
  const settings = dbToEngine(rates, p, fundEar);
  const overrides = await getContributionOverrides(portfolioId);
  const mappedOverrides = overrides.map((o) => ({
    monthNumber: o.monthNumber,
    overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
    lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
  }));
  const rh = mapRateHistory(await getRateHistory(portfolioId));
  const depositRows = await getDepositEntries(portfolioId);
  const withdrawalRows = await getWithdrawalEntries(portfolioId);
  const actualDeposits = [
    ...mapActualDeposits(depositRows),
    ...mapPrimaryMmfWithdrawalsAsDeposits(withdrawalRows, p?.mmfFundId ?? null),
  ];
  const actualSecurities = mapActualSecurities(await getSecurities(portfolioId));
  const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(portfolioId));
  const bankHoldings = mapActualBankHoldings(await getBankInstrumentHoldings(portfolioId));
  return { settings, mappedOverrides, rh, actualDeposits, actualSecurities, secondaryMmfs, bankHoldings };
}

/**
 * Build the EXACT `buildAllocation` input from a portfolio's live rows. This is
 * the single loader shared by the Reconciliation cross-check and the Part-3
 * modeling preview, so "current net worth + allocation" has one source of truth.
 */
async function loadAllocationInput(
  portfolioId: number,
  p: Awaited<ReturnType<typeof getPortfolio>>,
): Promise<import("../shared/actuals").AllocationInput> {
  const [deposits, securities, secondaries, bank, other] = await Promise.all([
    getDepositEntries(portfolioId),
    getSecurities(portfolioId),
    getSecondaryMmfs(portfolioId),
    getBankInstrumentHoldings(portfolioId),
    getOtherHoldings(portfolioId),
  ]);
  return {
    deposits: deposits.map((d) => ({
      amount: parseFloat(String(d.amount ?? "0")) || 0,
      bucket: d.bucket,
      institutionType: d.institutionType,
      mmfFundId: d.mmfFundId,
    })),
    securities: securities.map((s) => ({
      securityType: s.securityType,
      faceValue: parseFloat(String(s.faceValue ?? "0")) || 0,
      isMatured: s.isMatured,
    })),
    secondaryMmfs: secondaries.map((s) => ({
      mmfFundId: s.mmfFundId ?? null,
      currentBalance: parseFloat(String(s.currentBalance ?? "0")) || 0,
      ear: parseFloat(String(s.ear ?? "0")) || 0,
    })),
    bankHoldings: bank.map((b) => ({
      principal: parseFloat(String(b.principal ?? "0")) || 0,
      interestRate: parseFloat(String(b.interestRate ?? "0")) || 0,
      isActive: b.isActive,
      currentValue: parseFloat(String(b.currentValue ?? "0")) || 0,
    })),
    otherHoldings: other.map((h) => ({
      assetClass: h.assetClass,
      currentValue: parseFloat(String(h.currentValue ?? "0")) || 0,
      // Part 5: carry the structured mark-to-model + provenance fields so the
      // shared valuation source can RE-DERIVE units × price × FX downstream.
      behaviorClass: h.behaviorClass ?? null,
      units: h.units ?? null,
      unitPrice: h.unitPrice ?? null,
      currency: h.currency ?? null,
      fxRateToKes: h.fxRateToKes ?? null,
      dataSource: h.dataSource ?? null,
      dataAsOf: h.dataAsOf ?? null,
    })),
    primaryFundId: p?.mmfFundId ?? null,
  };
}

/** Run the projection for a portfolio with an OPTIONAL explicit clock override and rate-shock. */
async function projectAt(
  portfolioId: number,
  p: Awaited<ReturnType<typeof getPortfolio>>,
  nowOverride?: number,
  rateShock?: { effectiveDate: string; deltaPct: number },
) {
  const inp = await loadProjectionInputs(portfolioId, p);
  let settings = inp.settings;
  if (nowOverride != null) settings = { ...settings, nowOverride };
  if (rateShock) settings = { ...settings, rateShock };
  const months = runProjection(
    settings,
    inp.mappedOverrides,
    inp.rh,
    inp.actualDeposits,
    inp.actualSecurities,
    inp.secondaryMmfs,
    inp.bankHoldings,
    p?.mmfFundId ?? null,
  );
  return { months, settings };
}

/**
 * Build the list of upcoming simulated events (maturities + future contributions)
 * the Time Machine can "jump to next". Maturities come from the live securities;
 * contributions come from the engine's projected months strictly after the
 * current boundary. All instants are UTC-midnight.
 */
function buildUpcomingEvents(
  securities: Awaited<ReturnType<typeof getSecurities>>,
  startDateIso: string,
  currentMonthIdx: number,
  horizonMonths: number,
): SimEvent[] {
  const events: SimEvent[] = [];
  for (const s of securities) {
    if ((s as { isMatured?: boolean }).isMatured) continue;
    const md = (s as { maturityDate?: Date | string | null }).maturityDate;
    if (!md) continue;
    const at = toUtcMidnight(new Date(md as string | Date).getTime());
    const face = parseFloat(String((s as { faceValue?: unknown }).faceValue ?? "0")) || 0;
    events.push({
      at,
      kind: "maturity",
      label: `${String((s as { securityType?: string }).securityType ?? "security").toUpperCase()} matures (KES ${face.toLocaleString()})`,
    });
  }
  // Next few month-boundary contributions (cap at +24 for a tidy menu).
  const start = new Date(startDateIso + "T00:00:00Z");
  for (let m = currentMonthIdx + 1; m <= Math.min(currentMonthIdx + 24, horizonMonths); m++) {
    const at = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + (m - 1), start.getUTCDate());
    events.push({ at: toUtcMidnight(at), kind: "contribution", label: `Month ${m} contribution` });
  }
  return events.sort((a, b) => a.at - b.at);
}

const rateOnlyInput = z.object({
  portfolioId: z.number().int().positive(),
  mmfYield: z.number().min(0).max(100),
  tbill91Rate: z.number().min(0).max(100),
  tbill182Rate: z.number().min(0).max(100),
  tbill364Rate: z.number().min(0).max(100),
  ifbCouponRate: z.number().min(0).max(100),
  fxdCouponRate: z.number().min(0).max(100),
  withholdingTax: z.number().min(0).max(100),
  // Round 40: optional per-tenor bond rate maps keyed by tenor-years string.
  ifbTenorRates: z.record(z.string(), z.number().min(0).max(100)).optional().nullable(),
  fxdTenorRates: z.record(z.string(), z.number().min(0).max(100)).optional().nullable(),
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

  // ─── Expansion Part 2: Opportunity Catalog (neutral screener) ──────────────
  // The catalog is REFERENCE data, identical for everyone, shown in both modes.
  // The server returns rows in a NEUTRAL order (asset class, then name) and never
  // ranks by performance or marks anything "recommended/best." Any ordering by a
  // metric is the user's explicit choice, applied on the client. There is no
  // mutation here that transacts — the only downstream action is hypothetical
  // modeling (Part 3).
  opportunities: router({
    // Self-seeding on first read so the catalog is populated without a separate
    // migration step. Idempotent: existing rows are refreshed, none are ranked.
    list: publicProcedure.query(async () => {
      if ((await countOpportunities()) === 0) {
        for (const row of OPPORTUNITY_SEED) await upsertOpportunity(row);
      }
      const rows = await listOpportunities();
      // Visibility wall (Part 8): hide rows an AI invented whole-cloth (every figure
      // still ai_extracted, no human/scrape has touched any) from the public catalog.
      // They are NOT yet trustworthy enough to display as a tracked instrument; they
      // surface only in the maintainer review queue until at least one human confirms a
      // figure. The moment any figure is confirmed/entered, the row appears here.
      return rows.filter(
        (r) => !isAiProvisionalRow((r.fieldProvenance ?? {}) as FieldProvenanceMap),
      );
    }),

    // Admin-only: the FULL catalog INCLUDING AI-provisional rows hidden from `list`.
    // Used by the maintainer review queue so a maintainer can see and confirm rows that
    // the public never sees. Never ranks; same neutral order.
    listAll: adminProcedure.query(async () => {
      return listOpportunities();
    }),

    // Admin-only: rows awaiting human confirmation (any figure still ai_extracted),
    // for the dedicated review queue. Returns the row plus its provisional status so the
    // UI can group hidden (all-AI) rows separately from partially-confirmed ones.
    aiReviewQueue: adminProcedure.query(async () => {
      const rows = await listOpportunities();
      return rows
        .map((r) => {
          const map = (r.fieldProvenance ?? {}) as FieldProvenanceMap;
          // Part 8.1 — surface the uploaded screenshot(s) a maintainer used as the source
          // for an AI image extraction, as ready-to-render URLs (the template serves stored
          // objects via a signed redirect at /manus-storage/{key}), so the reviewer can see
          // the original picture next to each figure and confirm against it.
          const keys = Array.isArray(r.aiSourceImageKeys) ? (r.aiSourceImageKeys as string[]) : [];
          const sourceImageUrls = keys.map((k) => `/manus-storage/${k}`);
          return {
            row: r,
            aiFigureCount: countAiFigures(map),
            hiddenFromCatalog: isAiProvisionalRow(map),
            sourceImageUrls,
          };
        })
        .filter((x) => x.aiFigureCount > 0);
    }),

    // Part 8 (item 6): maintainer-only audit trail of every AI intake call — what
    // document, what was extracted, which model, when, and by which maintainer.
    aiAuditLog: adminProcedure
      .input(z.object({ limit: z.number().int().positive().max(500).optional() }).optional())
      .query(async ({ input }) => {
        const rows = await listAiIntakeAudit(input?.limit ?? 100);
        return { entries: rows };
      }),
    byRef: publicProcedure
      .input(z.object({ ref: z.string().min(1) }))
      .query(async ({ input }) => {
        const row = await getOpportunityByRef(input.ref);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found" });
        return row;
      }),

    // ── Part 7.1: per-figure human verification ──────────────────────────────
    // A signed-in person can CONFIRM a scraped figure (trust -> human_verified)
    // or OVERRIDE it with their own value (trust -> human_entered). This raises
    // the figure's verification state; it is the ONLY way a figure leaves the
    // scraped_unverified state. An override MUST change both the value and the
    // state — a silent number-only change is rejected. This neither ranks nor
    // recommends anything; it only records who vouched for which number.
    verifyField: adminProcedure
      .input(
        z.object({
          ref: z.string().min(1),
          fieldKey: z.enum(FIELD_KEYS),
          action: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("confirm") }),
            z.object({
              kind: z.literal("override"),
              value: z.string().min(1).max(64),
              // When a maintainer corrects/enters a figure they may record WHERE the
              // authoritative value came from. Optional so a quick correction still works.
              source: z.string().max(200).optional(),
              sourceUrl: z.string().url().max(500).optional().or(z.literal("")),
              asOf: z.number().int().positive().optional(),
            }),
          ]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const row = await getOpportunityByRef(input.ref);
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Opportunity not found" });
        const map = (row.fieldProvenance ?? {}) as Record<string, { value: string | null } | undefined>;
        const existing = map[input.fieldKey];
        if (!existing) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "This instrument does not expose that figure.",
          });
        }
        // Guard: an override must actually CHANGE the number. A no-op value edit
        // that only flips the state would be a silent number-untouched change,
        // which the model forbids; reject it explicitly.
        if (input.action.kind === "override" && input.action.value === (existing.value ?? "")) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "To override, enter a different value. Use Confirm to keep the current value.",
          });
        }
        const by = ctx.user.name ?? ctx.user.email ?? "You";
        const action: VerifyAction =
          input.action.kind === "confirm"
            ? { kind: "confirm", by, at: Date.now() }
            : {
                kind: "override",
                by,
                at: Date.now(),
                value: input.action.value,
                source: input.action.source,
                sourceUrl: input.action.sourceUrl === "" ? null : input.action.sourceUrl,
                asOf: input.action.asOf,
              };
        const updated = await verifyOpportunityField({
          ref: input.ref,
          fieldKey: input.fieldKey,
          action,
        });
        if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Figure not found" });
        return { ref: input.ref, fieldKey: input.fieldKey, provenance: updated };
      }),

    // ── Part 8: reject a single AI-extracted figure ──────────────────────────
    // A maintainer judged an ai_extracted figure to be a misread/hallucination and
    // DROPS it. Narrow on purpose: the DB helper only removes a figure still in the
    // ai_extracted state, never a human/scraped value (those are corrected via
    // verifyField, never destroyed). If the dropped figure was the last AI figure on an
    // AI-only row, the row is deactivated. Confirm/Correct stay in verifyField.
    rejectAiField: adminProcedure
      .input(z.object({ ref: z.string().min(1), fieldKey: z.enum(FIELD_KEYS) }))
      .mutation(async ({ input }) => {
        const res = await rejectAiField({ ref: input.ref, fieldKey: input.fieldKey });
        if (!res.removed) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Only an AI-extracted figure can be rejected. Human or scraped values are corrected, not dropped.",
          });
        }
        return res;
      }),

    // ── Part 7.2: ingestion conflict review ──────────────────────────────────
    // When a fresh scrape disagrees with a figure a human verified/entered, the
    // runner records an `ingestion_conflicts` row rather than clobbering the
    // human's value. These procedures let a signed-in owner SEE and RESOLVE those
    // disagreements. Resolving never silently changes a number: `dismiss` keeps
    // the human value; `apply` writes the scraped value through the SAME verify
    // mutation, so an applied scrape becomes `human_entered` (human attention),
    // not a silent overwrite. There is no ranking anywhere in this surface.
    conflicts: adminProcedure.query(async () => {
      const open = await listIngestionConflicts(true);
      return { conflicts: open, openCount: open.length };
    }),

    openConflictCount: publicProcedure.query(async () => {
      return { count: await countOpenConflicts() };
    }),

    resolveConflict: adminProcedure
      .input(
        z.object({
          id: z.number().int().positive(),
          resolution: z.enum(["dismiss", "apply"]),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const open = await listIngestionConflicts(true);
        const conflict = open.find((c) => c.id === input.id);
        if (!conflict) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Conflict not found or already resolved." });
        }
        const by = ctx.user.name ?? ctx.user.email ?? "You";

        if (input.resolution === "apply") {
          // Apply the scraped value through the human override path so the figure
          // becomes human_entered — a person chose to take this number.
          if (!isFieldKey(conflict.field)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown figure key on conflict." });
          }
          if (conflict.scrapedValue == null || conflict.scrapedValue === "") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Conflict has no scraped value to apply." });
          }
          await verifyOpportunityField({
            ref: conflict.opportunityRef,
            fieldKey: conflict.field,
            action: { kind: "override", by, at: Date.now(), value: conflict.scrapedValue },
          });
        }

        const status = input.resolution === "apply" ? "applied" : "dismissed";
        const resolved = await resolveIngestionConflict({ id: input.id, status, resolvedBy: by });
        return { resolved };
      }),

    // Manual trigger for one source (owner-initiated dry-run / refresh). The cron
    // job runs all sources on cadence; this is for an on-demand pull. It still
    // upserts as scraped_unverified and flags (never applies) conflicts.
    runIngestion: adminProcedure
      .input(z.object({ sourceId: z.enum(SOURCE_IDS) }))
      .mutation(async ({ input }) => {
        const adapter = ADAPTERS[input.sourceId];
        const report = await runAdapter(adapter);
        return report;
      }),

    // ── Part 8: AI document extraction (librarian, not oracle) ───────────────
    // Reads a messy source document (pasted text) and returns FACTUAL figures for
    // ONE instrument, each at the LOWEST trust tier (ai_extracted) and carrying the
    // verbatim quote it was read from so a human can confirm it against the source.
    // It can only FILL BLANKS — it never overwrites a human/scrape figure (a
    // disagreement becomes a conflict). It NEVER ranks, scores, or recommends: the
    // schema has no such field and the result is passed through stripVerdictFields.
    aiExtract: adminProcedure
      .input(
        z.object({
          // The document source. The librarian reads ONE of: pasted/typed text, a URL it
          // fetches and strips to text, or an uploaded PDF (storage key) it reads directly.
          source: z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("text"), text: z.string().min(20).max(40000) }),
            z.object({ kind: z.literal("url"), url: z.string().url().max(500) }),
            z.object({ kind: z.literal("pdf"), fileKey: z.string().min(1).max(300) }),
            // An uploaded screenshot/photo of a quote board, fact-sheet table, or notice.
            // Read by a vision-capable model (OCR-grade transcription, no inference).
            z.object({ kind: z.literal("image"), fileKey: z.string().min(1).max(300) }),
          ]),
          // The cited source document label (for the confirm-against-source UI).
          sourceLabel: z.string().min(1).max(200),
          // Link to the source document, so a human can open and confirm against it.
          sourceUrl: z.string().url().max(500).optional().or(z.literal("")),
          // Optional ref to attach the figures to. If omitted, a provisional ref is
          // derived from the extracted name. Either way the row is AI-provisional.
          ref: z.string().min(1).max(64).optional(),
          // Optional name hint to steer the extractor.
          hintName: z.string().max(200).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // One audit row per call, written regardless of outcome (item 6): every billable
        // LLM call and every figure that enters the catalog is traceable to the document,
        // the model, the timestamp, and the maintainer who triggered it. We build the row
        // incrementally and flush it in a finally block so failures are logged too.
        const audit: InsertAiIntakeAudit = {
          action: "extract",
          maintainerOpenId: ctx.user.openId ?? String(ctx.user.id),
          maintainerName: ctx.user.name ?? null,
          sourceKind: input.source.kind,
          sourceLabel: input.sourceLabel,
          sourceUrl: input.sourceUrl && input.sourceUrl !== "" ? input.sourceUrl : null,
          inputChars: input.source.kind === "text" ? input.source.text.length : null,
          hintName: input.hintName ?? null,
          ok: true,
        };
        try {
          // Resolve the document source into what the model reads, and a default link to
          // the source so a human can open and confirm against it.
          let llmSource: ExtractionSource;
          let defaultUrl: string | null = null;
          // When the source is an uploaded screenshot, we stamp a distinct provenance quote
          // so a human reviewer knows the figures were read off an image (and against what).
          let imageProvenanceLabel: string | null = null;
          // The storage key of an uploaded screenshot, recorded on the row after upsert so
          // the review queue can show a thumbnail of the original beside each figure.
          let imageSourceKey: string | null = null;
          if (input.source.kind === "text") {
            llmSource = { kind: "text", text: input.source.text };
          } else if (input.source.kind === "url") {
            // Fetch + strip server-side (the model never browses; it reads the text we got).
            const text = await fetchDocumentText(input.source.url);
            audit.inputChars = text.length;
            defaultUrl = input.source.url;
            if (!audit.sourceUrl) audit.sourceUrl = input.source.url;
            // HONESTY NUDGE: a JS-rendered page often fetches to a few characters of
            // boilerplate. Rather than send near-nothing to the model and report "nothing
            // found" (which looks like a bug), we return a `thinFetch` SIGNAL so the UI can
            // nudge the maintainer to paste the text or upload a screenshot instead. This is
            // NOT a throw — it is an expected, informative outcome. We still log the call.
            if (isThinFetch(text)) {
              audit.resultName = null;
              audit.figureCount = 0;
              audit.error = `Thin fetch: only ${text.trim().length} chars of readable text (likely JS-rendered).`;
              return {
                thinFetch: true as const,
                fetchedChars: text.trim().length,
                url: input.source.url,
              };
            }
            llmSource = { kind: "text", text };
          } else if (input.source.kind === "pdf") {
            // PDF: hand the stored file to the model directly via a signed URL.
            const signed = await storageGetSignedUrl(input.source.fileKey);
            llmSource = { kind: "pdf", fileUrl: signed };
          } else {
            // IMAGE: hand the stored screenshot to a vision-capable model via a signed URL.
            // aiExtractInstrument resolves a vision model and FAILS LOUDLY if none exists.
            const signed = await storageGetSignedUrl(input.source.fileKey);
            llmSource = { kind: "image", imageUrl: signed };
            const day = new Date(Date.now()).toISOString().slice(0, 10);
            imageProvenanceLabel = `read from an uploaded screenshot of ${input.sourceLabel}, ${day}`;
            // Remember the storage key so we can render a thumbnail in the review queue.
            imageSourceKey = input.source.fileKey;
          }

          const { extraction, model } = await aiExtractInstrument({
            source: llmSource,
            hintName: input.hintName ?? null,
          });
          audit.aiModel = model;
          if (!extraction) {
            audit.ok = false;
            audit.error = "No confirmable instrument/figures found in the document.";
            throw new TRPCError({
              code: "UNPROCESSABLE_CONTENT",
              message:
                "The AI could not read a specific instrument with confirmable figures from this document. Check the source and try again.",
            });
          }
          const sourceUrl =
            input.sourceUrl && input.sourceUrl !== "" ? input.sourceUrl : defaultUrl;
          const at = Date.now();

          // AI extraction is JUST ANOTHER ADAPTER behind the same wall: turn it into the
          // exact AdapterResult shape the scrapers produce, then run the figures through
          // the AI-tier provenance map (which stamps ai_extracted AND applies the numeric
          // sanity gate, flagging implausible values for review rather than saving clean).
          // For an image source, the per-figure provenance label records that the value was
          // transcribed from an uploaded screenshot (and against which cited source/date),
          // so a human reviewer is reminded to confirm against the original.
          const effectiveSourceLabel = imageProvenanceLabel ?? input.sourceLabel;
          const adapterResult = extractionToAdapterResult({
            extraction,
            ref: input.ref ?? null,
            sourceLabel: effectiveSourceLabel,
            sourceUrl,
          });
          const inst = adapterResult.instruments[0];
          const { map: aiMap, flagged } = aiInstrumentToProvenanceMap(inst, { at, model });
          if (Object.keys(aiMap).length === 0) {
            audit.ok = false;
            audit.error = "No confirmable figures (each figure needs a source quote).";
            throw new TRPCError({
              code: "UNPROCESSABLE_CONTENT",
              message: "The AI found no confirmable figures (each figure needs a source quote).",
            });
          }
          const ref = inst.ref;
          const base: InsertOpportunity = {
            ref,
            name: inst.name,
            assetClass: inst.assetClass,
            issuer: inst.issuer ?? null,
            currency: inst.currency ?? "KES",
            market: inst.market ?? null,
            factNote: inst.factNote ?? null,
            dataSource: effectiveSourceLabel,
            dataAsOf: new Date(at),
            unverified: true,
            active: true,
          };
          // Same reconcile/upsert/conflicts machinery as a scrape — AI only fills blanks,
          // never clobbers a human or scraped value (disagreements become conflicts).
          const result = await ingestAiExtractedInstrument({ base, ai: aiMap, sourceId: AI_INTAKE_SOURCE_ID });
          // For image sources, record the screenshot's storage key on the row so a reviewer
          // can see the original picture next to the figures (confirm-against-source).
          if (imageSourceKey) await attachAiSourceImageKey(ref, imageSourceKey);
          const saved = await getOpportunityByRef(ref);
          // Record what entered the catalog for traceability.
          audit.resultName = inst.name;
          audit.extractedFields = Object.keys(aiMap);
          audit.figureCount = Object.keys(aiMap).length;
          audit.flaggedCount = flagged.length;
          return {
            ref,
            created: result.created,
            filled: result.filled,
            conflicts: result.conflicts,
            flagged, // figures that tripped a numeric sanity gate (shown loudly for review)
            extraction, // returned so the UI can show what to confirm against the source
            opportunity: saved,
          };
        } catch (err) {
          if (audit.ok) {
            // An unexpected failure (e.g. URL fetch error) not already recorded above.
            audit.ok = false;
            audit.error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
          }
          throw err;
        } finally {
          await insertAiIntakeAudit(audit);
        }
      }),

    // Upload a source document (PDF or image), returning its storage key for `aiExtract`.
    aiUploadDocument: adminProcedure
      .input(
        z.object({
          // base64-encoded bytes (the client reads the File and base64s it).
          base64: z.string().min(1),
          fileName: z.string().min(1).max(200),
          // Document MIME type: a PDF (read directly) or an image screenshot (read by a
          // vision-capable model). Defaults to PDF for backward compatibility.
          mimeType: z
            .enum(["application/pdf", "image/png", "image/jpeg", "image/webp"])
            .default("application/pdf"),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const bytes = Buffer.from(input.base64, "base64");
        if (bytes.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Empty file." });
        const isPdf = input.mimeType === "application/pdf";
        // Images are typically smaller; cap at 10MB. PDFs may be larger; cap at 15MB.
        const cap = isPdf ? 15 * 1024 * 1024 : 10 * 1024 * 1024;
        if (bytes.length > cap) {
          throw new TRPCError({
            code: "PAYLOAD_TOO_LARGE",
            message: isPdf ? "PDF exceeds 15MB." : "Image exceeds 10MB.",
          });
        }
        const fallbackName = isPdf ? "document.pdf" : "screenshot.png";
        const safe = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || fallbackName;
        const { key } = await storagePut(`ai-intake/${ctx.user.id}/${safe}`, bytes, input.mimeType);
        return { fileKey: key, kind: isPdf ? ("pdf" as const) : ("image" as const) };
      }),

    // ── Part 8: universe discovery (suggestions only) ────────────────────────
    // Asks the AI to PROPOSE candidate instruments that MIGHT belong in a tracking
    // universe. Nothing is inserted into the catalog — candidates land in their own
    // pending table for a human to approve. No ranking is produced or stored.
    aiDiscover: adminProcedure
      .input(z.object({ universe: z.string().min(4).max(500) }))
      .mutation(async ({ ctx, input }) => {
        // Audit row per discovery run (item 6). Discovery writes NOTHING to the catalog;
        // the row records the universe asked for and how many candidates were proposed.
        const audit: InsertAiIntakeAudit = {
          action: "discover",
          maintainerOpenId: ctx.user.openId ?? String(ctx.user.id),
          maintainerName: ctx.user.name ?? null,
          universeDescription: input.universe.slice(0, 500),
          inputChars: input.universe.length,
          ok: true,
        };
        try {
          const { candidates, model } = await aiDiscoverCandidates({ universeDescription: input.universe });
          audit.aiModel = model;
          audit.candidateCount = candidates.length;
          if (candidates.length === 0) {
            return { proposed: 0, inserted: 0 };
          }
          const inserted = await insertAiCandidates(
            candidates.map((c) => ({
              name: c.name,
              issuer: c.issuer ?? null,
              assetClass: c.assetClass ?? null,
              currency: c.currency ?? null,
              scopeReason: c.scopeReason ?? null,
              sourceUrl: c.sourceUrl ?? null,
              universe: input.universe.slice(0, 500),
              aiModel: model,
              status: "pending" as const,
            })),
          );
          return { proposed: candidates.length, inserted };
        } catch (err) {
          audit.ok = false;
          audit.error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
          throw err;
        } finally {
          await insertAiIntakeAudit(audit);
        }
      }),

    // List AI candidates for the review surface (suggestions only, never ranked).
    listCandidates: adminProcedure
      .input(z.object({ status: z.enum(["pending", "approved", "dismissed"]).optional() }).optional())
      .query(async ({ input }) => {
        const rows = await listAiCandidates(input?.status);
        return { candidates: rows };
      }),

    pendingCandidateCount: publicProcedure.query(async () => {
      return { count: await countPendingCandidates() };
    }),

    // Review a candidate. APPROVE creates a normal human-authored instrument from it
    // (the human is now the author/source of record — never the AI) and records the
    // ref on the candidate. DISMISS just files it away. A candidate is NEVER shown
    // as a tracked instrument until this human action runs.
    reviewCandidate: adminProcedure
      .input(
        z.discriminatedUnion("action", [
          z.object({ action: z.literal("dismiss"), id: z.number().int().positive() }),
          z.object({
            action: z.literal("approve"),
            id: z.number().int().positive(),
            // The human confirms/edits the identity before it becomes a real instrument.
            ref: z.string().min(1).max(64),
            name: z.string().min(1).max(200),
            assetClass: z.string().min(1).max(32),
            issuer: z.string().max(200).optional(),
            currency: z.string().min(1).max(8).default("KES"),
            source: z.string().min(1).max(200),
            sourceUrl: z.string().url().max(500).optional().or(z.literal("")),
          }),
        ]),
      )
      .mutation(async ({ ctx, input }) => {
        const candidate = await getAiCandidate(input.id);
        if (!candidate) throw new TRPCError({ code: "NOT_FOUND", message: "Candidate not found." });
        if (candidate.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "This candidate was already reviewed." });
        }
        const by = ctx.user.name ?? ctx.user.email ?? "You";

        if (input.action === "dismiss") {
          const reviewed = await reviewAiCandidate({ id: input.id, status: "dismissed", reviewedBy: by });
          return { reviewed };
        }

        // APPROVE: the human authors a real instrument. No figures are copied from the
        // AI suggestion (it carried none) — the human enters facts via the normal
        // add/verify path afterwards. The created row has an empty provenance map.
        const existing = await getOpportunityByRef(input.ref);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: `An instrument with ref "${input.ref}" already exists.` });
        }
        const sourceUrl = input.sourceUrl === "" ? null : (input.sourceUrl ?? null);
        const at = Date.now();
        const row: InsertOpportunity = {
          ref: input.ref,
          name: input.name,
          assetClass: input.assetClass,
          issuer: input.issuer ?? null,
          currency: input.currency,
          dataSource: input.source,
          dataAsOf: new Date(at),
          unverified: false, // a human authored the instrument
          fieldProvenance: {},
          verificationState: "human_entered",
          active: true,
        };
        void sourceUrl; // recorded on figures when the human adds them later
        await upsertOpportunity(row);
        const reviewed = await reviewAiCandidate({
          id: input.id,
          status: "approved",
          reviewedBy: by,
          approvedRef: input.ref,
        });
        const saved = await getOpportunityByRef(input.ref);
        return { reviewed, opportunity: saved };
      }),

    // ── Part 7.3: add an instrument by hand ──────────────────────────────────
    // The catalog must NOT be gated on a scraper existing for every source. A
    // maintainer can author an instrument directly; every figure they supply is
    // recorded as `human_entered` (a person authored it) with their citation, and
    // the row's numeric columns are kept in lock-step with the per-figure map.
    // This neither ranks nor scores anything; it only records facts + provenance.
    addOpportunity: adminProcedure
      .input(
        z.object({
          ref: z.string().min(1).max(64),
          name: z.string().min(1).max(200),
          assetClass: z.string().min(1).max(32),
          issuer: z.string().max(200).optional(),
          currency: z.string().min(1).max(8).default("KES"),
          market: z.string().max(64).optional(),
          liquidity: z.string().max(32).optional(),
          factNote: z.string().max(2000).optional(),
          // The authoritative origin the maintainer is citing for ALL supplied figures.
          source: z.string().min(1).max(200),
          sourceUrl: z.string().url().max(500).optional().or(z.literal("")),
          asOf: z.number().int().positive().optional(),
          // Factual figures (all optional; only set the ones that apply to the asset).
          figures: z
            .object({
              yieldPct: z.number().optional(),
              yieldKind: z.string().max(48).optional(),
              lastPrice: z.number().optional(),
              trailingReturnPct: z.number().optional(),
              tenorYears: z.number().optional(),
              maturityDate: z.string().max(32).optional(), // ISO date string
              expenseRatioPct: z.number().optional(),
            })
            .default({}),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const existing = await getOpportunityByRef(input.ref);
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `An instrument with ref "${input.ref}" already exists. Edit it instead.`,
          });
        }
        const by = ctx.user.name ?? ctx.user.email ?? "You";
        const at = Date.now();
        const asOf = input.asOf ?? at;
        const sourceUrl = input.sourceUrl === "" ? null : (input.sourceUrl ?? null);
        const mk = (value: string | null): FieldProvenance =>
          humanField({ value, source: input.source, sourceUrl, asOf, by, at });

        // Build the per-figure provenance map from whichever figures were supplied.
        const f = input.figures;
        const map: FieldProvenanceMap = {};
        if (f.yieldPct !== undefined) map.yield = mk(String(f.yieldPct));
        if (f.lastPrice !== undefined) map.price = mk(String(f.lastPrice));
        if (f.trailingReturnPct !== undefined) map.trailingReturn = mk(String(f.trailingReturnPct));
        if (f.tenorYears !== undefined) map.tenor = mk(String(f.tenorYears));
        if (f.maturityDate !== undefined) map.maturity = mk(f.maturityDate);
        if (f.expenseRatioPct !== undefined) map.expense = mk(String(f.expenseRatioPct));

        const row: InsertOpportunity = {
          ref: input.ref,
          name: input.name,
          assetClass: input.assetClass,
          issuer: input.issuer ?? null,
          currency: input.currency,
          market: input.market ?? null,
          liquidity: input.liquidity ?? null,
          factNote: input.factNote ?? null,
          yieldPct: f.yieldPct !== undefined ? String(f.yieldPct) : null,
          yieldKind: f.yieldKind ?? null,
          lastPrice: f.lastPrice !== undefined ? String(f.lastPrice) : null,
          trailingReturnPct: f.trailingReturnPct !== undefined ? String(f.trailingReturnPct) : null,
          tenorYears: f.tenorYears !== undefined ? String(f.tenorYears) : null,
          maturityDate: f.maturityDate ? new Date(f.maturityDate) : null,
          expenseRatioPct: f.expenseRatioPct !== undefined ? String(f.expenseRatioPct) : null,
          dataSource: input.source,
          dataAsOf: new Date(asOf),
          unverified: false, // a person authored it
          fieldProvenance: map,
          verificationState: summariseState(map),
          active: true,
        };
        await upsertOpportunity(row);
        const saved = await getOpportunityByRef(input.ref);
        return { ref: input.ref, opportunity: saved };
      }),
  }),

  // ─── Time Machine (sandbox only) ───────────────────────────────────────────
  // Advances a SIMULATED clock so projected ledger rows materialise into
  // actuals. Every write is tagged with a session id and is fully reversible via
  // `reset`. Hard-guarded to sandbox portfolios so Live data can never be touched.
  timeMachine: router({
    /**
     * Current simulation state: the simulated "today" (or null = real clock),
     * the real-clock anchor, whether a session is active, how many records the
     * session has materialised, and the next jump-to event.
     */
    status: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const isSandbox = (p as { isSandbox?: boolean }).isSandbox === true;
      const sim = (p as { simulatedDate?: number | null }).simulatedDate ?? null;
      const session = (p as { simSessionId?: string | null }).simSessionId ?? null;
      const anchor = todayUtcMidnight();
      const startIso = normaliseDate(p?.startDate);
      const horizon = p?.horizonMonths ?? 120;
      const simNow = sim ?? anchor;
      const currentMonthIdx = computeCurrentMonth(startIso, simNow, horizon);
      let materialised = { securities: 0, deposits: 0, withdrawals: 0 };
      if (session) materialised = await countSimSessionRecords(input.portfolioId, session);
      let next: SimEvent | null = null;
      if (isSandbox) {
        const securities = await getSecurities(input.portfolioId);
        const events = buildUpcomingEvents(securities, startIso, currentMonthIdx, horizon);
        next = nextEventAfter(simNow, events);
      }
      const stepLog = parseStepLog((p as { simStepLog?: string | null }).simStepLog);
      const last = stepLog.length > 0 ? stepLog[stepLog.length - 1] : null;
      const rateShock = simulatedRateShock(p) ?? null;
      // Full audit trail of every advance, newest-first. The last item in the
      // raw (oldest-first) log is the next-undoable step.
      const lastIdx = stepLog.length - 1;
      const history = stepLog
        .map((s, idx) => ({
          index: idx,
          fromLabel: formatUtcDate(s.fromMs),
          toLabel: formatUtcDate(s.toMs),
          mode: s.mode,
          targetLabel: describeStepTarget(s),
          monthsElapsed: s.monthsElapsed ?? null,
          contributionsWritten: s.contributionsWritten ?? s.depositIds.length,
          contributionTotal: s.contributionTotal ?? null,
          rateShock: s.rateShock ?? null,
          createdAt: s.createdAt ?? null,
          isNextUndoable: idx === lastIdx,
        }))
        .reverse();
      return {
        isSandbox,
        active: sim != null,
        rateShock,
        simulatedDate: sim,
        anchorDate: anchor,
        simulatedDateLabel: formatUtcDate(simNow),
        currentMonthIndex: currentMonthIdx,
        materialised,
        nextEvent: next,
        canUndo: stepLog.length > 0,
        stepsRemaining: stepLog.length,
        history,
        lastStep: last
          ? { fromLabel: formatUtcDate(last.fromMs), toLabel: formatUtcDate(last.toMs), deposits: last.depositIds.length }
          : null,
      };
    }),

    /** Upcoming jump-to events for the menu (maturities + contributions). */
    upcomingEvents: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      if ((p as { isSandbox?: boolean }).isSandbox !== true) return [] as SimEvent[];
      const startIso = normaliseDate(p?.startDate);
      const horizon = p?.horizonMonths ?? 120;
      const sim = (p as { simulatedDate?: number | null }).simulatedDate ?? todayUtcMidnight();
      const currentMonthIdx = computeCurrentMonth(startIso, sim, horizon);
      const securities = await getSecurities(input.portfolioId);
      return buildUpcomingEvents(securities, startIso, currentMonthIdx, horizon)
        .filter((e) => e.at > toUtcMidnight(sim))
        .slice(0, 30);
    }),

    /**
     * Begin a simulation session. Stamps a fresh session id and sets the
     * simulated clock to real "today" (the anchor). Idempotent: re-starting keeps
     * the existing session id so prior materialised rows stay owned by it.
     */
    start: protectedProcedure.input(portfolioIdInput).mutation(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      if ((p as { isSandbox?: boolean }).isSandbox !== true) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The Time Machine is available in Test mode only. Switch to a sandbox portfolio to simulate the future.",
        });
      }
      const existingSession = (p as { simSessionId?: string | null }).simSessionId ?? null;
      const session = existingSession ?? randomUUID();
      const anchor = todayUtcMidnight();
      await updatePortfolio(input.portfolioId, ctx.user.id, {
        simulatedDate: anchor,
        simSessionId: session,
      } as never);
      return { ok: true, simulatedDate: anchor, simSessionId: session };
    }),

    /**
     * Advance the simulated clock. Target is one of: a fixed step (unit+count), a
     * jump to the next event, or an explicit YYYY-MM-DD date. Then, per `mode`,
     * materialise the newly-elapsed months' contributions as tagged actuals and
     * re-project. Returns a before/after summary of what changed.
     */
    advance: protectedProcedure
      .input(
        z.object({
          portfolioId: z.number().int().positive(),
          target: z.discriminatedUnion("type", [
            z.object({ type: z.literal("step"), unit: z.enum(["day", "week", "month", "year"]), count: z.number().int().min(1).max(120).optional() }),
            z.object({ type: z.literal("nextEvent") }),
            z.object({ type: z.literal("date"), date: z.string() }),
          ]),
          mode: z.enum(["accrue_only", "accept_plan", "inject_variance"]).optional(),
          contributionFactor: z.number().min(0).max(5).optional(),
          yieldFactor: z.number().min(0).max(5).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        if ((p as { isSandbox?: boolean }).isSandbox !== true) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The Time Machine is available in Test mode only." });
        }
        const mode: MaterializeMode = input.mode ?? "accrue_only";
        const startIso = normaliseDate(p?.startDate);
        const horizon = p?.horizonMonths ?? 120;
        const anchor = todayUtcMidnight();
        // Ensure a session exists (auto-start on first advance).
        let session = (p as { simSessionId?: string | null }).simSessionId ?? null;
        const fromMs = (p as { simulatedDate?: number | null }).simulatedDate ?? anchor;

        // Resolve the requested target instant.
        let targetMs: number;
        if (input.target.type === "step") {
          targetMs = advanceClock(fromMs, input.target.unit as StepUnit, input.target.count ?? 1);
        } else if (input.target.type === "date") {
          const parsed = parseDateToUtcMidnight(input.target.date);
          if (parsed == null) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid date. Use YYYY-MM-DD." });
          }
          targetMs = parsed;
        } else {
          const securities = await getSecurities(input.portfolioId);
          const curIdx = computeCurrentMonth(startIso, fromMs, horizon);
          const events = buildUpcomingEvents(securities, startIso, curIdx, horizon);
          const next = nextEventAfter(fromMs, events);
          if (!next) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "No upcoming events to jump to." });
          }
          targetMs = next.at;
        }
        targetMs = clampTarget(targetMs, anchor);
        if (toUtcMidnight(targetMs) <= toUtcMidnight(fromMs)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "That target is not in the future. Pick a later date or step." });
        }

        // Before snapshot (at the current boundary).
        const before = await projectAt(input.portfolioId, p, fromMs);
        const prevIdx = computeCurrentMonth(startIso, fromMs, horizon);
        const nextIdx = computeCurrentMonth(startIso, targetMs, horizon);

        // Materialise contributions for newly-elapsed months (accept_plan / variance).
        let written = { deposits: 0, totalContribution: 0 };
        const stepDepositIds: number[] = [];
        if (mode !== "accrue_only" && nextIdx > prevIdx) {
          if (!session) session = randomUUID();
          // Project at the NEW boundary so contribution amounts reflect the plan there.
          const plan = buildMaterializePlan(
            (await projectAt(input.portfolioId, p, targetMs)).months,
            startIso,
            prevIdx,
            nextIdx,
            mode,
            { contributionFactor: input.contributionFactor, yieldFactor: input.yieldFactor },
          );
          for (const spec of plan.specs) {
            const row = await addDepositEntry({
              portfolioId: input.portfolioId,
              bucket: "mmf",
              institutionType: "mmf_fund",
              mmfFundId: p?.mmfFundId ?? null,
              bankHoldingId: null,
              amount: String(spec.amount),
              depositDate: new Date(spec.depositDate + "T12:00:00Z"),
              notes: spec.notes,
              simSessionId: session,
            } as never);
            const newId = (row as { id?: number } | null)?.id;
            if (typeof newId === "number") stepDepositIds.push(newId);
          }
          written = { deposits: plan.specs.length, totalContribution: plan.totalContribution };
        }

        // Append this advance to the step log so Undo-last-step can rewind exactly
        // this boundary and delete only the rows it created.
        const priorLog = parseStepLog((p as { simStepLog?: string | null }).simStepLog);
        const activeShock = simulatedRateShock(p) ?? null;
        const newStep: SimStep = {
          fromMs,
          toMs: targetMs,
          mode,
          depositIds: stepDepositIds,
          createdAt: Date.now(),
          monthsElapsed: nextIdx - prevIdx,
          contributionsWritten: written.deposits,
          contributionTotal: written.totalContribution,
          targetKind: input.target.type,
          stepUnit: input.target.type === "step" ? (input.target.unit as StepUnit) : undefined,
          stepCount: input.target.type === "step" ? input.target.count ?? 1 : undefined,
          rateShock: activeShock ? { effectiveDate: activeShock.effectiveDate, deltaPct: activeShock.deltaPct } : null,
        };
        const newLog: SimStep[] = [...priorLog, newStep];

        // Commit the new clock (and session, if just created).
        await updatePortfolio(input.portfolioId, ctx.user.id, {
          simulatedDate: targetMs,
          simSessionId: session,
          simStepLog: JSON.stringify(newLog),
        } as never);

        // After snapshot (re-projected at the new boundary, including any writes).
        const afterP = await getPortfolio(input.portfolioId, ctx.user.id);
        const after = await projectAt(input.portfolioId, afterP, targetMs);
        const beforeFinal = before.months[before.months.length - 1]?.totalEnd ?? 0;
        const afterFinal = after.months[after.months.length - 1]?.totalEnd ?? 0;
        const beforeToday = before.months[prevIdx]?.totalEnd ?? before.months[0]?.totalEnd ?? 0;
        const afterToday = after.months[nextIdx]?.totalEnd ?? 0;

        // Maturities that the jump passed through (for the summary surface).
        const maturedThrough = (await getSecurities(input.portfolioId)).filter((s) => {
          const md = (s as { maturityDate?: Date | string | null }).maturityDate;
          if (!md || (s as { isMatured?: boolean }).isMatured) return false;
          const at = toUtcMidnight(new Date(md as string | Date).getTime());
          return at > toUtcMidnight(fromMs) && at <= toUtcMidnight(targetMs);
        }).length;

        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "portfolio",
          action: "update",
          field: "time_machine_advance",
          newValue: formatUtcDate(targetMs),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Time Machine: advanced ${formatUtcDate(fromMs)} → ${formatUtcDate(targetMs)} (${mode}), ${written.deposits} contribution(s) materialised`,
        });

        return {
          ok: true,
          mode,
          fromDate: formatUtcDate(fromMs),
          toDate: formatUtcDate(targetMs),
          monthsElapsed: nextIdx - prevIdx,
          contributionsWritten: written.deposits,
          contributionTotal: written.totalContribution,
          maturitiesSettled: maturedThrough,
          todayValueBefore: Math.round(beforeToday),
          todayValueAfter: Math.round(afterToday),
          endValueBefore: Math.round(beforeFinal),
          endValueAfter: Math.round(afterFinal),
        };
      }),

    /**
     * Undo the LAST advance step: rewind the simulated clock back to that step's
     * `fromMs` boundary and delete ONLY the deposit rows that step materialised
     * (earlier steps' rows are left intact). This is the fine-grained counterpart
     * to Reset. When the log becomes empty after undo, the clock returns to the
     * anchor (real today) but the session id is kept so any still-present rows
     * stay owned by it.
     */
    undoStep: protectedProcedure.input(portfolioIdInput).mutation(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      if ((p as { isSandbox?: boolean }).isSandbox !== true) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The Time Machine is available in Test mode only." });
      }
      const log = parseStepLog((p as { simStepLog?: string | null }).simStepLog);
      const { step, rest } = popLastStep(log);
      if (!step) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing to undo \u2014 no recorded steps." });
      }
      // Remove only the rows this step created.
      const removedDeposits = await deleteDepositEntriesByIds(input.portfolioId, step.depositIds);
      // Rewind the clock to before this step. If the log is now empty, the clock
      // returns to the anchor (today); keep the session id either way.
      const session = (p as { simSessionId?: string | null }).simSessionId ?? null;
      const newSimDate = rest.length > 0 ? rest[rest.length - 1].toMs : step.fromMs;
      await updatePortfolio(input.portfolioId, ctx.user.id, {
        simulatedDate: newSimDate,
        simSessionId: session,
        simStepLog: rest.length > 0 ? JSON.stringify(rest) : null,
      } as never);
      await addAuditLog({
        portfolioId: input.portfolioId,
        entity: "portfolio",
        action: "update",
        field: "time_machine_undo",
        newValue: formatUtcDate(newSimDate),
        changedByOpenId: ctx.user.openId,
        changedByName: ctx.user.name ?? null,
        summary: `Time Machine: undid step ${formatUtcDate(step.fromMs)} \u2192 ${formatUtcDate(step.toMs)}, removed ${removedDeposits} contribution(s)`,
      });
      return {
        ok: true,
        rewoundTo: formatUtcDate(newSimDate),
        undoneFrom: formatUtcDate(step.toMs),
        removedDeposits,
        stepsRemaining: rest.length,
      };
    }),

    /**
     * Set or clear the Time Machine rate-shock stress test. Pass `shock: null` to
     * clear. Sandbox only. The shock is persisted and honoured by every projection
     * read so the whole app reflects the stressed yields from the chosen date.
     */
    setRateShock: protectedProcedure
      .input(
        z.object({
          portfolioId: z.number().int().positive(),
          shock: z
            .object({
              effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
              deltaPct: z.number().min(-20).max(20),
            })
            .nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        if ((p as { isSandbox?: boolean }).isSandbox !== true) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "The Time Machine is available in Test mode only." });
        }
        await updatePortfolio(input.portfolioId, ctx.user.id, {
          simRateShock: input.shock ? JSON.stringify(input.shock) : null,
        } as never);
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "portfolio",
          action: "update",
          field: "time_machine_rate_shock",
          newValue: input.shock ? `${input.shock.deltaPct >= 0 ? "+" : ""}${input.shock.deltaPct}% from ${input.shock.effectiveDate}` : "cleared",
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: input.shock
            ? `Time Machine: rate-shock ${input.shock.deltaPct >= 0 ? "+" : ""}${input.shock.deltaPct}% applied from ${input.shock.effectiveDate}`
            : "Time Machine: rate-shock cleared",
        });
        return { ok: true, shock: input.shock };
      }),

    /**
     * Reset to today: clear the simulated clock and DELETE every record the
     * session materialised, restoring the exact pre-simulation state. Records the
     * user entered by hand (untagged) are never touched.
     */
    reset: protectedProcedure.input(portfolioIdInput).mutation(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      if ((p as { isSandbox?: boolean }).isSandbox !== true) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "The Time Machine is available in Test mode only." });
      }
      const session = (p as { simSessionId?: string | null }).simSessionId ?? null;
      let removed = { securities: 0, deposits: 0, withdrawals: 0 };
      if (session) {
        removed = await deleteSimSessionRecords(input.portfolioId, session);
      }
      await updatePortfolio(input.portfolioId, ctx.user.id, {
        simulatedDate: null,
        simSessionId: null,
        simStepLog: null,
        simRateShock: null,
      } as never);
      await addAuditLog({
        portfolioId: input.portfolioId,
        entity: "portfolio",
        action: "update",
        field: "time_machine_reset",
        newValue: "today",
        changedByOpenId: ctx.user.openId,
        changedByName: ctx.user.name ?? null,
        summary: `Time Machine: reset to today, removed ${removed.deposits} deposit(s), ${removed.securities} security(ies), ${removed.withdrawals} withdrawal(s)`,
      });
      return { ok: true, removed };
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
          concentrationCapPct: parseFloat(String((p as { concentrationCapPct?: string }).concentrationCapPct ?? "25")),
          typeConcentrationCapPct: parseFloat(String((p as { typeConcentrationCapPct?: string }).typeConcentrationCapPct ?? "60")),
          concentrationSnoozeUntil: (p as { concentrationSnoozeUntil?: number | null }).concentrationSnoozeUntil ?? null,
          allocationPolicy: ((p as { allocationPolicy?: string }).allocationPolicy ?? "balanced") as "balanced" | "yield_first" | "custom",
          driftAlertThresholdPct: parseFloat(String((p as { driftAlertThresholdPct?: string }).driftAlertThresholdPct ?? "5")),
          yieldFirstAckAt: (p as { yieldFirstAckAt?: number | null }).yieldFirstAckAt ?? null,
          cbkSourceUrl: p.cbkSourceUrl,
          sanlamSourceUrl: p.sanlamSourceUrl,
          ratesLastUpdatedAt: p.ratesLastUpdatedAt ?? null,
          mmfFundId: p.mmfFundId ?? null,
          isSandbox: p.isSandbox,
          inflationLinked: !!(p as { inflationLinked?: boolean }).inflationLinked,
          inflationOverrideRate: (p as { inflationOverrideRate?: string | null }).inflationOverrideRate != null
            ? parseFloat(String((p as { inflationOverrideRate?: string | null }).inflationOverrideRate))
            : null,
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
        concentrationCapPct: parseFloat(String((p as { concentrationCapPct?: string }).concentrationCapPct ?? "25")),
        typeConcentrationCapPct: parseFloat(String((p as { typeConcentrationCapPct?: string }).typeConcentrationCapPct ?? "60")),
        concentrationSnoozeUntil: (p as { concentrationSnoozeUntil?: number | null }).concentrationSnoozeUntil ?? null,
        allocationPolicy: ((p as { allocationPolicy?: string }).allocationPolicy ?? "balanced") as "balanced" | "yield_first" | "custom",
        driftAlertThresholdPct: parseFloat(String((p as { driftAlertThresholdPct?: string }).driftAlertThresholdPct ?? "5")),
        yieldFirstAckAt: (p as { yieldFirstAckAt?: number | null }).yieldFirstAckAt ?? null,
        cbkSourceUrl: p.cbkSourceUrl,
        sanlamSourceUrl: p.sanlamSourceUrl,
        ratesLastUpdatedAt: p.ratesLastUpdatedAt ?? null,
        mmfFundId: p.mmfFundId ?? null,
        isSandbox: p.isSandbox,
        inflationLinked: !!(p as { inflationLinked?: boolean }).inflationLinked,
        inflationOverrideRate: (p as { inflationOverrideRate?: string | null }).inflationOverrideRate != null
          ? parseFloat(String((p as { inflationOverrideRate?: string | null }).inflationOverrideRate))
          : null,
        createdAt: p.createdAt,
      };
    }),

    /**
     * CANONICAL SNAPSHOT — the single source of money truth. Composes the same
     * helpers the individual procedures use (buildAllocation for net worth,
     * runProjection for the ledger, the allocation tier/gap model, the
     * reconciliation cross-check, getActualsSummary for income/tax) into ONE
     * object the consolidated tabs read via the pure selectors in
     * `shared/snapshot.ts`. No surface re-derives money locally.
     */
    snapshot: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      return buildPortfolioSnapshot(input.portfolioId, p);
    }),

    /**
     * Round 60: snooze (mute) concentration warnings until a chosen time, or
     * clear the snooze. `until` is a Unix-ms timestamp (UTC); pass null to
     * un-snooze immediately.
     */
    snoozeConcentration: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), until: z.number().int().positive().nullable() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await updatePortfolio(input.portfolioId, ctx.user.id, {
          concentrationSnoozeUntil: input.until,
        } as Record<string, unknown>);
        return { success: true, until: input.until };
      }),

    /**
     * Round 62: record the user's acknowledgment of the Yield-first allocation
     * policy's concentration risk. Stamps yieldFirstAckAt and writes a Change
     * History entry. Pass clear=true to revoke the acknowledgment.
     */
    acknowledgeYieldFirst: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), clear: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const now = input.clear ? null : Date.now();
        await updatePortfolio(input.portfolioId, ctx.user.id, {
          yieldFirstAckAt: now,
        } as Record<string, unknown>);
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "allocation_policy",
          action: "update",
          field: "yieldFirstAckAt",
          newValue: now ? new Date(now).toISOString() : null,
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: input.clear
            ? "Revoked Yield-first risk acknowledgment"
            : "Acknowledged Yield-first concentration risk (gives up KDIC diversification across institutions)",
        });
        return { success: true, yieldFirstAckAt: now };
      }),

    /**
     * Round 62: log that the user acknowledged an ACTUAL (real-money) cap breach.
     * This never fires on projected sweeps — only when recorded holdings exceed a
     * cap. Writes a Change History entry describing the breach the user accepted.
     */
    recordBreachAck: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        capKind: z.enum(["issuer", "type"]),
        label: z.string().max(120),
        sharePct: z.number().min(0).max(100),
        capPct: z.number().min(0).max(100),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const kindLabel = input.capKind === "issuer" ? "per-issuer (KDIC)" : "per-instrument-type";
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "concentration_breach",
          action: "update",
          field: input.capKind,
          newValue: `${input.sharePct.toFixed(1)}% vs ${input.capPct.toFixed(0)}% cap`,
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Acknowledged actual ${kindLabel} concentration breach: ${input.label} at ${input.sharePct.toFixed(1)}% (cap ${input.capPct.toFixed(0)}%)`,
        });
        return { success: true };
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
        concentrationCapPct: String(input.concentrationCapPct ?? 25),
        typeConcentrationCapPct: String(input.typeConcentrationCapPct ?? 60),
        ...(input.allocationPolicy ? { allocationPolicy: input.allocationPolicy } : {}),
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
          ...(input.concentrationCapPct != null ? { concentrationCapPct: String(input.concentrationCapPct) } : {}),
          ...(input.typeConcentrationCapPct != null ? { typeConcentrationCapPct: String(input.typeConcentrationCapPct) } : {}),
          ...(input.allocationPolicy ? { allocationPolicy: input.allocationPolicy } : {}),
          ...(input.driftAlertThresholdPct != null ? { driftAlertThresholdPct: String(input.driftAlertThresholdPct) } : {}),
          ...(input.inflationLinked != null ? { inflationLinked: input.inflationLinked } : {}),
          ...(input.inflationOverrideRate !== undefined
            ? { inflationOverrideRate: input.inflationOverrideRate == null ? null : String(input.inflationOverrideRate) }
            : {}),
          ...(input.riskTolerance !== undefined ? { riskTolerance: input.riskTolerance } : {}),
        } as Record<string, unknown>);
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
        // Round 40: optional per-tenor bond rate maps (null when unset).
        ifbTenorRates: (r?.ifbTenorRates as Record<string, number> | null | undefined) ?? null,
        fxdTenorRates: (r?.fxdTenorRates as Record<string, number> | null | undefined) ?? null,
        // Round 53: investor liquidity horizon (days) driving the duration-risk hint.
        liquidityHorizonDays: r?.liquidityHorizonDays ?? 365,
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
     * Round 53: update the investor's liquidity horizon (days) used by the
     * Dashboard duration-risk hint. Upserts the rate_settings row so a portfolio
     * that has never saved rates still persists the preference.
     */
    updateLiquidityHorizon: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        liquidityHorizonDays: z.number().int().min(7).max(3650),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await upsertRateSettings({
          portfolioId: input.portfolioId,
          liquidityHorizonDays: input.liquidityHorizonDays,
        } as Parameters<typeof upsertRateSettings>[0]);
        return { success: true, liquidityHorizonDays: input.liquidityHorizonDays };
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
      const bankHoldings = mapActualBankHoldings(await getBankInstrumentHoldings(input.portfolioId));
      const currentStepUp = Number(p?.stepUpAmount ?? 0);
      const stepUps = deriveStepUps(currentStepUp);
      return runScenarios(settings, stepUps, rh, secondaryMmfs, bankHoldings, p.mmfFundId ?? null);
    }),

    /**
     * R69.3 — projected END-STATE liquid split. Runs the same liquid-reserve
     * allocator used for today's actuals, but on the PROJECTED horizon liquid pot
     * (mmfEnd + secondaryMmfEnd + bankEnd of the final month). Lets the Dashboard
     * say HOW the fully-liquid end-state is spread (Balanced/Custom diversify;
     * Yield-first may concentrate) instead of assuming 100% primary MMF.
     */
    endStateLiquidSplit: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const overrides = await getContributionOverrides(input.portfolioId);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      const rh = mapRateHistory(await getRateHistory(input.portfolioId));
      const depositRows = await getDepositEntries(input.portfolioId);
      const withdrawalRows = await getWithdrawalEntries(input.portfolioId);
      const actualDeposits = [
        ...mapActualDeposits(depositRows),
        ...mapPrimaryMmfWithdrawalsAsDeposits(withdrawalRows, p.mmfFundId ?? null),
      ];
      const actualSecurities = mapActualSecurities(await getSecurities(input.portfolioId));
      const secondaryRows = await getSecondaryMmfs(input.portfolioId);
      const secondaryMmfs = mapSecondaryMmfs(secondaryRows);
      const bankRows = await getBankInstrumentHoldings(input.portfolioId);
      const bankHoldings = mapActualBankHoldings(bankRows);

      const series = runProjection(
        settings,
        mappedOverrides,
        rh,
        actualDeposits,
        actualSecurities,
        secondaryMmfs,
        bankHoldings,
        p.mmfFundId ?? null,
      );
      const finalMonth = series[series.length - 1];

      // Build the eligible liquid homes (mirrors bankHoldings.liquidAllocation).
      const homes: ProjectedLiquidHomeInput[] = [];
      const primaryFund = p.mmfFundId ? await getMmfFund(p.mmfFundId) : null;
      if (primaryFund) {
        homes.push({
          id: `mmf:${primaryFund.id}`,
          label: primaryFund.fundName,
          kind: "primary_mmf",
          issuer: primaryFund.company || primaryFund.fundName,
          grossYieldPct: parseFloat(String(primaryFund.grossYield)) || 0,
          whtRatePct: parseFloat(String(primaryFund.whtRate)) || 15,
          minBalance: parseFloat(String(primaryFund.minInvestment)) || 0,
        });
      } else {
        // No fund selected — model the primary MMF generically so the pot still has a home.
        homes.push({
          id: "mmf:primary",
          label: "Primary MMF",
          kind: "primary_mmf",
          issuer: "Primary MMF",
          grossYieldPct: settings.mmfYield,
          whtRatePct: settings.withholdingTax,
          minBalance: 0,
        });
      }
      for (const s of secondaryRows) {
        homes.push({
          id: `mmf:${s.mmfFundId}`,
          label: s.label || s.fundName || "Secondary MMF",
          kind: "secondary_mmf",
          issuer: s.company || s.fundName || s.label || `fund-${s.mmfFundId}`,
          grossYieldPct: parseFloat(String(s.ear)) || 0,
          whtRatePct: parseFloat(String(s.whtRate)) || 15,
          minBalance: 0,
        });
      }
      for (const b of bankRows) {
        if (!b.isActive) continue;
        if (!isLiquidBankKind(String(b.instrumentType))) continue;
        homes.push({
          id: `bank:${b.id}`,
          label: b.label || `${b.bankName} ${String(b.instrumentType).replace(/_/g, " ")}`,
          kind: String(b.instrumentType) as ProjectedLiquidHomeInput["kind"],
          issuer: b.bankName,
          grossYieldPct: parseFloat(String(b.interestRate)) || 0,
          whtRatePct: parseFloat(String(b.whtRate)) || 15,
          minBalance: 0,
        });
      }

      const issuerCapPct = parseFloat(
        String((p as { concentrationCapPct?: string }).concentrationCapPct ?? "25"),
      );
      const issuerCapFrac =
        (Number.isFinite(issuerCapPct) && issuerCapPct > 0 ? issuerCapPct : 25) / 100;
      const allocationPolicy =
        ((p as { allocationPolicy?: string }).allocationPolicy as
          | "balanced"
          | "yield_first"
          | "custom"
          | undefined) ?? "balanced";

      const split = projectedLiquidSplit(finalMonth, homes, {
        netWorth: finalMonth?.totalEnd ?? 0,
        issuerCapFrac,
        safetyFloor: settings.safetyFloor,
        allocationPolicy,
      });

      return {
        allocationPolicy,
        liquidPot: split.liquidPot,
        state: split.state,
        isSplit: split.isSplit,
        fundedHomeCount: split.fundedHomeCount,
        homeCount: split.homeCount,
        issuerCount: split.issuerCount,
        effectiveIssuerCapFrac: split.effectiveIssuerCapFrac,
        message: split.message,
        slices: split.slices
          .filter((s) => s.targetBalance >= 1)
          .map((s) => ({
            id: s.id,
            label: s.label,
            kind: s.kind,
            issuer: s.issuer,
            targetBalance: s.targetBalance,
            targetShare: s.targetShare,
            netYieldPct: s.netYieldPct,
          })),
      };
    }),

    milestones: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
      return generateMilestones(settings, secondaryMmfs);
    }),

    /**
     * Part 3 — Dashboard DECISION SURFACE. One query that turns the bare headline
     * number into the investor's real answers, reusing the SAME engine path as
     * projection.run so nothing can disagree:
     *   - range {base, low, high}: base (current rates, on-schedule), low/high
     *     from a -2pp rate shock and a missed-contributions case.
     *   - pace: base vs the goal target band + a concrete step-up lever
     *     (solveForStepUp) to get back on pace when behind.
     *   - backloading: share of total contributions in the final quarter.
     *   - liquidity: liquid+spendable at the goal date, % of total, and the
     *     cushion margin to the latest security maturity.
     */
    decisionSurface: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const inp = await loadProjectionInputs(input.portfolioId, p);
      const settings = inp.settings;
      const horizonMonths = settings.horizonMonths ?? 120;
      const target = settings.targetAmount;
      const mmfFundId = p?.mmfFundId ?? null;

      const startIso = settings.startDate ?? "2026-07-01";
      const project = (override: Partial<EngineSettings>) => {
        const s: EngineSettings = { ...settings, ...override };
        return runProjection(
          s,
          inp.mappedOverrides,
          inp.rh,
          inp.actualDeposits,
          inp.actualSecurities,
          inp.secondaryMmfs,
          inp.bankHoldings,
          mmfFundId,
        );
      };

      // Base case — current rates, contributions on schedule (the headline number).
      const baseMonths = project({});
      const baseFinal = baseMonths[baseMonths.length - 1];
      const base = Math.round(baseFinal?.totalEnd ?? 0);

      // Downside A — a -2pp CBK rate shock effective from the start date.
      const rateShockCase = Math.round(
        project({ rateShock: { effectiveDate: startIso, deltaPct: -2 } }).slice(-1)[0]?.totalEnd ?? 0,
      );

      // Upside — a +1pp CBK rate tailwind, the symmetric counterpart to the shock.
      const rateUpCase = Math.round(
        project({ rateShock: { effectiveDate: startIso, deltaPct: 1 } }).slice(-1)[0]?.totalEnd ?? 0,
      );

      // The headline band is RATE-driven only (a clean, defensible "if CBK rates
      // move" range). Contribution-slip risk is surfaced separately in the
      // back-loading caution, where it can be explained, rather than collapsing
      // the headline band on plans that still depend on future contributions.
      const range = buildProjectionRange(base, rateUpCase, rateShockCase);

      // Downside B — a realistic contribution slip (step-ups never happen) +
      // the rate shock, exposed as a discrete figure for the caution copy.
      const slipCase = Math.round(
        project({
          stepUpAmount: 0,
          rateShock: { effectiveDate: startIso, deltaPct: -2 },
        }).slice(-1)[0]?.totalEnd ?? 0,
      );

      // Pace vs target (1% tolerance band for an explicit "on pace" middle ground).
      const pace = assessPace(base, target, Math.round(target * 0.01));

      // Step-up lever to get back on pace when behind.
      let stepUp: { recommendedStepUp: number; feasible: boolean; projectedEndingValue: number } | null = null;
      if (pace.status === "behind") {
        const solverSettings: EngineSettings = { ...settings, stepUpAmount: 0 };
        const res = solveForStepUp(
          solverSettings,
          settings.startingContribution,
          inp.rh,
          inp.secondaryMmfs,
        );
        stepUp = {
          recommendedStepUp: res.recommendedStepUp,
          feasible: res.feasible,
          projectedEndingValue: res.projectedEndingValue,
        };
      }

      // Back-loading — per-month contributions over the full horizon.
      const monthlyContributions = baseMonths.map((m) => m.contribution ?? 0);
      const backloading = assessBackloading(monthlyContributions, 3);

      // Part B2 — savings-led framing. The plan reaches the goal mostly by SAVING
      // (contributions) and only thinly by INVESTING (return on those savings).
      // The engine already places each ACTUAL primary-MMF deposit into the month
      // it occurred and reports it as that month's `contribution`, so summing the
      // full month series captures ALL principal put in (past + future). There is
      // no separate opening lump outside this series, so startingPrincipal is 0 —
      // adding actual deposits again would double-count. returnEarned is then
      // exactly base − totalContributions. No new source of truth.
      const totalContributions = monthlyContributions.reduce((a, b) => a + b, 0);
      const savingsLed = computeSavingsLedSplit({
        projectedFinalValue: base,
        totalContributions,
        startingPrincipal: 0,
      });

      // Goal-date liquidity — final-month liquid pot vs locked securities.
      const liquidAtGoal =
        (baseFinal?.mmfEnd ?? 0) + (baseFinal?.secondaryMmfEnd ?? 0) + (baseFinal?.bankEnd ?? 0);
      const goalDate = new Date(startIso + "T00:00:00Z");
      const goalDateMs = Date.UTC(
        goalDate.getUTCFullYear(),
        goalDate.getUTCMonth() + (horizonMonths - 1),
        goalDate.getUTCDate(),
      );
      // Latest UN-matured security maturity (the cushion-defining instrument).
      const securityRows = await getSecurities(input.portfolioId);
      let latestMaturityMs: number | null = null;
      for (const s of securityRows) {
        if ((s as { isMatured?: boolean }).isMatured) continue;
        const md = (s as { maturityDate?: Date | string | null }).maturityDate;
        if (!md) continue;
        const ms = new Date(md as string | Date).getTime();
        if (Number.isFinite(ms) && (latestMaturityMs == null || ms > latestMaturityMs)) {
          latestMaturityMs = ms;
        }
      }
      const liquidity = assessLiquidityCushion(liquidAtGoal, base, goalDateMs, latestMaturityMs);

      // Part A1 — inflation-adjusted goal (the liability). When the portfolio is
      // inflation-linked we judge the nominal projection against the FUTURE goal
      // (target inflated to the goal date) and express the surplus in today's
      // shillings. The inflation rate is the per-portfolio override if set, else
      // the SAME global inflation benchmark the real-yield line already uses.
      const inflationLinked = !!(p as { inflationLinked?: boolean }).inflationLinked;
      const overrideRate = (p as { inflationOverrideRate?: string | null }).inflationOverrideRate;
      const benchmarkInflationPct = await getInflationBenchmarkPct(0);
      const inflationRatePct =
        overrideRate != null && Number.isFinite(Number(overrideRate))
          ? Number(overrideRate)
          : benchmarkInflationPct;
      const inflationGoal = computeInflationAdjustedGoal({
        target,
        projectedNominal: base,
        horizonMonths,
        inflationRatePct,
        linked: inflationLinked,
      });
      // The honest on-track test uses the EFFECTIVE goal (inflated when linked).
      const effectivePace = assessPace(
        base,
        inflationGoal.effectiveGoal,
        Math.round(inflationGoal.effectiveGoal * 0.01),
      );

      // ── Part 6 — UNCERTAINTY as a first-class output ───────────────────────
      // The fixed-income core (`base`) is held-to-maturity and near-deterministic,
      // so it is the CERTAIN chunk. Price-driven / FX holdings carry real
      // volatility, so they form the RISKY sleeve whose end value is a
      // distribution. A plan with no risky assets (the car) reports
      // hasMaterialRisk=false and keeps its tight band unchanged. We REUSE the
      // same horizon and the same `base` engine number — no parallel projection.
      const horizonYears = horizonMonths / 12;
      const otherRows = await getOtherHoldings(input.portfolioId);
      const riskPositions: RiskPosition[] = [];
      const concentrationInputs: { name: string; valueKes: number; volatilityPct: number }[] = [];
      for (const h of otherRows) {
        const valued = valueHolding({
          assetClass: h.assetClass,
          behaviorClass: h.behaviorClass ?? null,
          currentValue: h.currentValue,
          units: h.units ?? null,
          unitPrice: h.unitPrice ?? null,
          currency: h.currency ?? null,
          fxRateToKes: h.fxRateToKes ?? null,
        });
        if (!valued.behaviorClass || !valued.priceDriven || valued.valueKes <= 0) continue;
        const r = resolveRiskAssumption(valued.behaviorClass, {
          expectedReturnPct: h.expectedReturnPct != null ? Number(h.expectedReturnPct) : null,
          volatilityPct: h.volatilityPct != null ? Number(h.volatilityPct) : null,
          correlationGroup: h.correlationGroup ?? null,
        });
        riskPositions.push({
          valueKes: valued.valueKes,
          assetClass: valued.behaviorClass,
          assumption: {
            expectedReturnPct: r.expectedReturnPct,
            volatilityPct: r.volatilityPct,
            correlationGroup: r.correlationGroup,
          },
        });
        concentrationInputs.push({ name: h.name, valueKes: valued.valueKes, volatilityPct: r.volatilityPct });
      }
      const distribution = buildEndValueDistribution({
        positions: riskPositions,
        horizonYears,
        extraCertainEndValue: base,
      });
      const probability = goalProbability({
        dist: distribution,
        deterministicEndValue: base,
        goal: inflationGoal.effectiveGoal,
      });
      // Stated comfort vs modeled volatility — a WARNING only, never a block.
      const tolerance = assessToleranceMismatch({
        stated: (p as { riskTolerance?: string | null }).riskTolerance as RiskTolerance | null,
        modeledVolPct: distribution.portfolioVolPct,
      });
      // Risk-aware concentration brake over the volatile sleeve (flag, not block).
      const volatileConcentration = assessVolatileConcentration(concentrationInputs);

      return {
        target,
        horizonMonths,
        goalDateMs,
        range,
        cases: { base, rateShockCase, rateUpCase, slipCase },
        // Part 6 uncertainty block — present on every plan; `hasMaterialRisk`
        // tells the UI whether to widen the band into a distribution.
        risk: {
          hasMaterialRisk: distribution.hasMaterialRisk,
          riskyValueKes: Math.round(riskPositions.reduce((a, r) => a + r.valueKes, 0)),
          distribution,
          probability,
          tolerance,
          volatileConcentration,
        },
        // `pace` stays nominal-vs-stored-target for back-compat; `effectivePace`
        // is the inflation-aware test the headline now reads from.
        pace,
        effectivePace,
        inflation: {
          ratePct: inflationRatePct,
          ...inflationGoal,
        },
        stepUp,
        stepUpMonths: settings.stepUpMonths,
        backloading,
        savingsLed,
        liquidity,
      };
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
      // Time Machine: reconciliation's "today" must follow the simulated clock too.
      const reconNow = getNow(p);

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

      // Round 32: Portfolio Review and Tax Summary sources are now computed by
      // calling the SAME shared functions the pages render with (`buildAllocation`
      // and `blendedYield`), fed from the raw DB rows — NOT by re-stating the
      // reference. If a page's shared math drifts (e.g. a double-count creeps back
      // into buildAllocation, or a pocket is dropped), its source diverges from the
      // principal-basis reference and the row turns red. This makes the cross-check
      // real rather than a tautology.
      const depositRowsForAlloc = await getDepositEntries(input.portfolioId);
      const otherHoldingRows = await getOtherHoldings(input.portfolioId);
      const allocation = buildAllocation({
        deposits: depositRowsForAlloc.map((d) => ({
          amount: parseFloat(String(d.amount ?? "0")) || 0,
          bucket: d.bucket,
          institutionType: d.institutionType,
          mmfFundId: d.mmfFundId,
        })),
        securities: securities.map((s) => ({
          securityType: s.securityType,
          faceValue: parseFloat(String(s.faceValue ?? "0")) || 0,
          isMatured: s.isMatured,
        })),
        secondaryMmfs: secondaries.map((s) => ({
          // Round 33 fix: use the secondary's FUND id (mmfFundId), NOT the row
          // primary key (s.id). Passing s.id meant the secondary-fund set never
          // matched the deposit's mmfFundId, so a secondary-MMF deposit leaked
          // into the primary bucket AND was counted again via the balance
          // (the +KES 2,500 double-count seen on the live Reconciliation page).
          mmfFundId: s.mmfFundId ?? null,
          currentBalance: parseFloat(String(s.currentBalance ?? "0")) || 0,
          ear: parseFloat(String(s.ear ?? "0")) || 0,
        })),
        bankHoldings: bank.map((b) => ({
          principal: parseFloat(String(b.principal ?? "0")) || 0,
          interestRate: parseFloat(String(b.interestRate ?? "0")) || 0,
          isActive: b.isActive,
          // Reconcile on the PRINCIPAL basis (matches the reference): ignore accrued
          // currentValue here so an un-elapsed deposit reconciles to its principal.
          currentValue: 0,
        })),
        otherHoldings: otherHoldingRows.map((h) => ({
          assetClass: h.assetClass,
          currentValue: parseFloat(String(h.currentValue ?? "0")) || 0,
          behaviorClass: h.behaviorClass ?? null,
          units: h.units ?? null,
          unitPrice: h.unitPrice ?? null,
          currency: h.currency ?? null,
          fxRateToKes: h.fxRateToKes ?? null,
          dataSource: h.dataSource ?? null,
          dataAsOf: h.dataAsOf ?? null,
        })),
        // Robust guard: any mmf_fund deposit into a non-primary fund is secondary.
        primaryFundId: p.mmfFundId ?? null,
      });
      // Part 5: other assets (equities / REITs / offshore / property / …) are now
      // a FIRST-CLASS reconciled pocket rather than stripped out. Each row is
      // valued ONCE by the shared mark-to-model source (the same one
      // buildAllocation used above), so the per-holding list and the allocation's
      // other-bucket total are guaranteed to agree (the phantom-holding guard
      // below proves it). We add this same total to every full-portfolio source
      // so the whole proof rises by an identical amount and stays balanced.
      const otherAssetValues = otherHoldingRows.map((h) =>
        valueHolding({
          assetClass: h.assetClass,
          behaviorClass: h.behaviorClass ?? null,
          currentValue: h.currentValue,
          units: h.units ?? null,
          unitPrice: h.unitPrice ?? null,
          currency: h.currency ?? null,
          fxRateToKes: h.fxRateToKes ?? null,
          dataSource: h.dataSource ?? null,
          dataAsOf: h.dataAsOf ?? null,
        }).valueKes,
      );
      const round2 = (n: number) => Math.round(n * 100) / 100;
      const otherTotal = round2(Object.values(allocation.other).reduce((a, b) => a + b, 0));
      // Portfolio Review shows the FULL net worth (incl. other assets) — it must
      // match the dashboard net worth, which we also lift by otherTotal below.
      const portfolioReviewNetWorth = allocation.netWorth;

      const taxBlended = blendedYield({
        primaryMmf: allocation.primaryMmf,
        primaryMmfRate: settings.mmfYield,
        secondaryMmfs: secondaries.map((s) => ({
          balance: parseFloat(String(s.currentBalance ?? "0")) || 0,
          rate: parseFloat(String(s.ear ?? "0")) || 0,
        })),
        bankHoldings: bankHoldingPrincipals.map((v) => ({ value: v, rate: 0 })),
        securities: [
          { value: allocation.tbill, rate: settings.tbill364Rate, taxExempt: false },
          { value: allocation.ifb, rate: settings.ifbCouponRate, taxExempt: true },
          { value: allocation.fxd, rate: settings.fxdCouponRate, taxExempt: false },
        ],
        whtRate: settings.withholdingTax,
      });
      const taxSummaryBase = taxBlended.base;

      const inputs = {
        primaryMmfBalance,
        secondaryMmfBalances,
        bankHoldingPrincipals,
        securityFaceValues,
        // First-class pocket: the reference (sum of parts) now includes other assets.
        otherAssetValues,
        // Lift the core-only sources by the SAME other-assets total so every
        // full-portfolio source reconciles on one footing (core + other assets).
        projectionTodayValue: round2(projectionTodayValue + otherTotal),
        dashboardActualsTotal: round2(dashboardActualsTotal + otherTotal),
        accrualLedgerMmfTotal: primaryMmfBalance + secondaryMmfBalances.reduce((a, b) => a + b, 0),
        dashboardNetWorth: round2(dashboardActualsTotal + otherTotal),
        portfolioReviewNetWorth,
        taxSummaryBase,
      };

      // ── Round 39: government-securities + bank-instruments sub-checks ──────────
      // The register face total must equal the sum of gov-security deposits that
      // created it; the active bank principals must equal bank deposits net of
      // bank withdrawals. These catch orphaned register lots / drifted principals.
      const allDeposits = depositRowsForAlloc;
      const linkedGovDepositAmounts = allDeposits
        .filter((d) => d.institutionType === "government_security")
        .map((d) => parseFloat(String(d.amount ?? "0")) || 0);
      const bankDepositAmounts = allDeposits
        .filter((d) => d.institutionType === "bank_instrument")
        .map((d) => parseFloat(String(d.amount ?? "0")) || 0);
      const withdrawalRows = await getWithdrawalEntries(input.portfolioId);
      const govWithdrawalAmounts = withdrawalRows
        .filter((w) => w.sourceType === "government_security")
        .map((w) => parseFloat(String(w.amount ?? "0")) || 0);
      const bankWithdrawalAmounts = withdrawalRows
        .filter((w) => w.sourceType === "bank_instrument")
        .map((w) => parseFloat(String(w.amount ?? "0")) || 0);
      // Net gov deposits by withdrawals so a partially-redeemed security still
      // reconciles against its remaining register face. Expressed as a single
      // net figure compared to the register total.
      const govWithdrawalTotal = govWithdrawalAmounts.reduce((a, b) => a + b, 0);
      const linkedGovDepositGross = linkedGovDepositAmounts.reduce((a, b) => a + b, 0);
      const netLinkedGov = [Math.max(0, linkedGovDepositGross - govWithdrawalTotal)];

      // ── Round 40 (R40.6): accrued-interest + WHT sub-checks ─────────────────────
      // Compute the day-by-day accrual schedule the Daily Accrual page renders, then
      // reconcile its gross/WHT totals against an INDEPENDENT closed-form expectation
      // (annual gross × days ÷ 365, with the correct WHT tier). A drift in either
      // path — a misread rate or a wrong WHT tier — turns the relevant row red.
      const ACCRUAL_WINDOW_DAYS = 365;
      const govIncomeInputs: SecurityIncomeInput[] = securities
        .filter((s) => !s.isMatured)
        .map((s) => ({
          id: s.id,
          securityType: s.securityType as SecurityIncomeInput["securityType"],
          faceValue: parseFloat(String(s.faceValue ?? "0")) || 0,
          couponRate: parseFloat(String(s.couponRate ?? "0")) || 0,
          isTaxExempt: Boolean(s.isTaxExempt) || s.securityType === "ifb",
          maturityDate: s.maturityDate,
          isMatured: s.isMatured,
        }));
      const govSchedule = buildSecurityDailySchedule(govIncomeInputs, ACCRUAL_WINDOW_DAYS, reconNow);
      // Expectation uses the same tiered WHT model the engine encodes.
      const govReconItems: AccrualReconItem[] = govIncomeInputs
        .filter((s) => {
          // mirror buildSecurityDailySchedule's isLiveSecurity gate
          if (s.isMatured) return false;
          if (!s.maturityDate) return true;
          const m = new Date(s.maturityDate);
          m.setHours(0, 0, 0, 0);
          const today = new Date(reconNow);
          today.setHours(0, 0, 0, 0);
          return m.getTime() >= today.getTime();
        })
        .map((s) => {
          const taxExempt = s.isTaxExempt || s.securityType === "ifb";
          // The schedule uses a flat 15% on all taxable gov paper, so the
          // expectation mirrors that to keep the cross-check on one footing.
          const whtPct = taxExempt ? 0 : 15;
          return { base: s.faceValue, ratePct: s.couponRate, whtPct };
        });
      const govAccrual = reconcileAccrual(
        govReconItems,
        ACCRUAL_WINDOW_DAYS,
        govSchedule.grossTotal,
        govSchedule.whtTotal,
      );

      const bankIncomeInputs: BankIncomeInput[] = bank
        .filter((b) => b.isActive)
        .map((b) => ({
          id: b.id,
          bankName: b.bankName,
          label: b.label ?? null,
          instrumentType: b.instrumentType as BankIncomeInput["instrumentType"],
          principal: parseFloat(String(b.principal ?? "0")) || 0,
          interestRate: parseFloat(String(b.interestRate ?? "0")) || 0,
          whtRate: parseFloat(String(b.whtRate ?? "15")) || 0,
          dayCountBasis: b.dayCountBasis ?? 365,
          maturityDate: b.maturityDate,
          isActive: b.isActive,
        }));
      const bankSchedule = buildBankDailySchedule(bankIncomeInputs, ACCRUAL_WINDOW_DAYS);
      const bankReconItems: AccrualReconItem[] = bankIncomeInputs.map((b) => ({
        base: b.principal,
        ratePct: b.interestRate,
        whtPct: b.whtRate,
        dayCountBasis: b.dayCountBasis,
      }));
      const bankAccrual = reconcileAccrual(
        bankReconItems,
        ACCRUAL_WINDOW_DAYS,
        bankSchedule.grossTotal,
        bankSchedule.whtTotal,
      );

      // Part 5 phantom-holding guard: the per-holding mark-to-model values MUST
      // sum to the other-assets total the allocation engine folded into net
      // worth, and every held row MUST be valued (no class counted in net worth
      // but invisible to the proof).
      const holdings = reconcileHoldings(otherAssetValues, otherTotal, otherHoldingRows.length);

      return {
        full: reconcile(inputs),
        mmf: reconcileMmf(inputs.accrualLedgerMmfTotal, inputs.primaryMmfBalance, inputs.secondaryMmfBalances),
        gov: reconcileGov(securityFaceValues, netLinkedGov),
        bank: reconcileBank(bankHoldingPrincipals, bankDepositAmounts, bankWithdrawalAmounts),
        govAccrual,
        bankAccrual,
        holdings,
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
     * Stateless forward step-up recommendation for the Create-Portfolio dialog.
     * The user fixes the Month-1 contribution; we recommend the step-up/period
     * that reaches the target. No saved portfolio is required — settings are
     * built from the platform default CBK rates (the exact rates a freshly
     * created portfolio is seeded with), so the recommendation matches what the
     * portfolio's Scenarios page will show once it exists.
     */
    recommendStepUp: protectedProcedure
      .input(z.object({
        targetAmount: z.number().positive(),
        horizonMonths: z.number().int().min(1).max(600),
        startingContribution: z.number().min(0),
        startDate: z.string().optional(),
        stepUpMonths: z.number().int().min(1).max(24).optional(),
      }))
      .query(async ({ input }) => {
        // Build engine settings from the platform defaults (same fallbacks
        // dbToEngine uses for a brand-new portfolio) overridden by draft inputs.
        const settings: EngineSettings = {
          ...DEFAULT_SETTINGS,
          targetAmount: input.targetAmount,
          horizonMonths: input.horizonMonths,
          stepUpMonths: input.stepUpMonths ?? DEFAULT_SETTINGS.stepUpMonths,
          startDate: input.startDate ? normaliseDate(input.startDate) : DEFAULT_SETTINGS.startDate,
          // startingContribution/stepUpAmount are supplied/ignored by the solver.
          startingContribution: input.startingContribution,
          stepUpAmount: 0,
        };
        return solveForStepUp(settings, input.startingContribution, [], []);
      }),

    /**
     * Portfolio-aware step-up recommendation for the Settings (Plan) page. Uses
     * the saved portfolio's REAL rates, selected fund, rate history and secondary
     * MMFs, but lets the page override the starting contribution and step-up
     * frequency with the currently-entered (possibly unsaved) values, so the
     * "recommended" figure reflects what the user is editing. Same engine as the
     * Scenarios page, so the two agree.
     */
    recommendStepUpForPortfolio: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        startingContribution: z.number().min(0).optional(),
        stepUpMonths: z.number().int().min(1).max(24).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
        const baseSettings = dbToEngine(rates, p, fundEar);
        const rh = mapRateHistory(await getRateHistory(input.portfolioId));
        const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
        const startingContribution = input.startingContribution ?? baseSettings.startingContribution;
        const settings: EngineSettings = {
          ...baseSettings,
          stepUpMonths: input.stepUpMonths ?? baseSettings.stepUpMonths,
          startingContribution,
          stepUpAmount: 0,
        };
        return solveForStepUp(settings, startingContribution, rh, secondaryMmfs);
      }),

    /**
     * Stateless projection of a SPECIFIC step-up for the Create-Portfolio dialog,
     * so the "projected vs target" delta is exact even when the user types a custom
     * step-up. Uses the same default CBK rates a fresh portfolio is seeded with.
     */
    projectDraft: protectedProcedure
      .input(z.object({
        targetAmount: z.number().positive(),
        horizonMonths: z.number().int().min(1).max(600),
        startingContribution: z.number().min(0),
        stepUpAmount: z.number().min(0),
        startDate: z.string().optional(),
        stepUpMonths: z.number().int().min(1).max(24).optional(),
      }))
      .query(async ({ input }) => {
        const settings: EngineSettings = {
          ...DEFAULT_SETTINGS,
          targetAmount: input.targetAmount,
          horizonMonths: input.horizonMonths,
          stepUpMonths: input.stepUpMonths ?? DEFAULT_SETTINGS.stepUpMonths,
          startDate: input.startDate ? normaliseDate(input.startDate) : DEFAULT_SETTINGS.startDate,
          startingContribution: input.startingContribution,
          stepUpAmount: input.stepUpAmount,
        };
        const projectedEndingValue = projectEndingValue(
          settings,
          input.startingContribution,
          input.stepUpAmount,
          [],
          [],
        );
        return {
          projectedEndingValue,
          target: input.targetAmount,
          delta: projectedEndingValue - input.targetAmount,
        };
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

    // Part 5: recorded income events (dividends / distributions / offshore income)
    // across ALL price-driven holdings, surfaced on the Month Ledger so realised
    // payments sit in the same timeline as the projected core flows — but as a
    // clearly separate, ACTUAL stream (we never synthesise these; only what the
    // user logged appears here).
    incomeEvents: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      const rows = await getPortfolioHoldingIncome(input.portfolioId);
      return rows.map((r) => ({
        id: r.id,
        holdingId: r.holdingId,
        holdingName: r.holdingName,
        behaviorClass: r.behaviorClass ?? null,
        amount: parseFloat(String(r.amount)),
        incomeDate: normaliseDate(r.incomeDate),
        incomeType: r.incomeType ?? null,
        notes: r.notes ?? null,
      }));
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
      const actualDeposits = [
        ...mapActualDeposits(await getDepositEntries(input.portfolioId)),
        ...mapPrimaryMmfWithdrawalsAsDeposits(await getWithdrawalEntries(input.portfolioId), p.mmfFundId ?? null),
      ];
      const actualSecurities = mapActualSecurities(await getSecurities(input.portfolioId));
      const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
      const bankHoldings = mapActualBankHoldings(await getBankInstrumentHoldings(input.portfolioId));
      const results = runProjection(
        settings,
        mappedOverrides,
        rh,
        actualDeposits,
        actualSecurities,
        secondaryMmfs,
        bankHoldings,
        p.mmfFundId ?? null,
      );

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
        securityType: z.enum(["tbill_91", "tbill_182", "tbill_364", "ifb", "fxd", "zero_coupon", "floating_rate"]),
        faceValue: z.number().min(50000),
        issueDate: z.string(),
        // maturityDate is now OPTIONAL — when omitted (or for T-bills) the server
        // derives it from the issue date + tenor via the shared tenor model.
        maturityDate: z.string().optional(),
        // Bond tenor in years (IFB/FXD/zero-coupon/floating). Ignored for T-bills.
        tenorYears: z.number().min(0.1).max(30).optional(),
        // couponRate optional — defaults from Rate Settings for the type.
        couponRate: z.number().min(0).max(50).optional(),
        isTaxExempt: z.boolean().optional(),
        notes: z.string().optional(),
        // Round 42 — discount instruments (T-bill / zero-coupon).
        purchasePrice: z.number().min(0).optional(),
        discountRate: z.number().min(0).max(50).optional(),
        // Round 42 — floating-rate bonds.
        marginRate: z.number().min(0).max(20).optional(),
        resetMonths: z.number().int().min(1).max(24).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const type = input.securityType as GovSecurityType;
        const isTbill = type.startsWith("tbill");
        const isDiscount = isDiscountInstrument(type);
        const isZero = type === "zero_coupon";
        const tenorYears = isTbill ? null : (input.tenorYears ?? null);
        // Maturity: always derive for T-bills; for bonds derive from tenor unless
        // an explicit date was supplied.
        const maturityStr =
          isTbill || !input.maturityDate
            ? computeMaturityDate(type, input.issueDate, tenorYears)
            : input.maturityDate;
        // Coupon/discount rate: use supplied value, else default from settings.
        let couponRate = input.couponRate;
        if (couponRate == null) {
          const rates = await getRateSettings(input.portfolioId);
          couponRate = defaultRateForSecurity(type, rates, tenorYears);
        }
        // Round 42 — discount-instrument pricing. Zero-coupon bonds carry NO
        // coupon; their return is the discount, so force couponRate to 0.
        const discountRate = input.discountRate ?? (isDiscount ? couponRate : undefined);
        let purchasePrice = input.purchasePrice ?? null;
        if (isDiscount && (purchasePrice == null || purchasePrice <= 0) && discountRate != null) {
          const tenorDays = isTbill ? TBILL_TENOR_DAYS[type as "tbill_91" | "tbill_182" | "tbill_364"] : 0;
          const tYears = tenorYearsForSecurity(type, tenorYears);
          purchasePrice = discountPriceForSecurity({
            isDiscount: true,
            isZeroCoupon: isZero,
            faceValue: input.faceValue,
            ratePct: discountRate,
            tenorDays,
            tenorYears: tYears,
          });
        }
        if (isZero) couponRate = 0;
        // Tax-exempt is derived: IFB exempt, everything else taxable.
        const isTaxExempt = input.isTaxExempt ?? type === "ifb";
        // Expansion Brief Part 1: stamp the behavior taxonomy at write time using
        // the shared mapping so the column is never left to a backfill job and
        // there is one source of truth for an asset's class.
        const assetClass = assetClassForSecurityType(input.securityType);
        await addSecurity({
          portfolioId: input.portfolioId,
          securityType: input.securityType,
          assetClass,
          faceValue: String(input.faceValue),
          issueDate: new Date(input.issueDate + "T12:00:00Z"),
          maturityDate: new Date(maturityStr + "T12:00:00Z"),
          couponRate: String(couponRate),
          tenorYears: tenorYears != null ? String(tenorYears) : null,
          isTaxExempt,
          notes: input.notes,
          purchasePrice: purchasePrice != null ? String(Math.round(purchasePrice * 100) / 100) : null,
          discountRate: discountRate != null ? String(discountRate) : null,
          marginRate: input.marginRate != null ? String(input.marginRate) : null,
          resetMonths: input.resetMonths ?? null,
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
        securityType: z.enum(["tbill_91", "tbill_182", "tbill_364", "ifb", "fxd", "zero_coupon", "floating_rate"]).optional(),
        faceValue: z.number().min(50000).optional(),
        issueDate: z.string().optional(),
        maturityDate: z.string().optional(),
        tenorYears: z.number().min(0.1).max(30).nullable().optional(),
        couponRate: z.number().min(0).max(50).optional(),
        isTaxExempt: z.boolean().optional(),
        // Round 42 — discount + floating-rate fields.
        purchasePrice: z.number().min(0).nullable().optional(),
        discountRate: z.number().min(0).max(50).nullable().optional(),
        marginRate: z.number().min(0).max(20).nullable().optional(),
        resetMonths: z.number().int().min(1).max(24).nullable().optional(),
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

        // Resolve the effective type/issue/tenor (post-edit) so we can re-derive
        // the maturity date deterministically via the shared tenor model.
        const effType = (input.securityType ?? existing.securityType) as GovSecurityType;
        const effIsTbill = effType.startsWith("tbill");
        const effIssue = input.issueDate ?? String(existing.issueDate);
        const effTenor = effIsTbill
          ? null
          : input.tenorYears !== undefined
            ? input.tenorYears
            : existing.tenorYears != null
              ? parseFloat(String(existing.tenorYears))
              : null;

        // Build the partial update for the register row.
        const secUpdate: Record<string, unknown> = {};
        if (input.isMatured !== undefined) secUpdate.isMatured = input.isMatured;
        if (input.notes !== undefined) secUpdate.notes = input.notes;
        if (input.securityType !== undefined) {
          secUpdate.securityType = input.securityType;
          // Keep the behavior taxonomy in lockstep with the product type.
          secUpdate.assetClass = assetClassForSecurityType(input.securityType);
        }
        if (input.faceValue !== undefined) secUpdate.faceValue = String(input.faceValue);
        if (input.issueDate !== undefined) secUpdate.issueDate = new Date(input.issueDate + "T12:00:00Z");
        // Persist tenor (bonds only); T-bills always clear it.
        if (effIsTbill) {
          secUpdate.tenorYears = null;
        } else if (input.tenorYears !== undefined) {
          secUpdate.tenorYears = input.tenorYears != null ? String(input.tenorYears) : null;
        }
        // Maturity: if the type/issue/tenor changed and no explicit maturity was
        // supplied, recompute it; otherwise honour the explicit date.
        if (input.maturityDate !== undefined) {
          secUpdate.maturityDate = new Date(input.maturityDate + "T12:00:00Z");
        } else if (
          input.securityType !== undefined ||
          input.issueDate !== undefined ||
          input.tenorYears !== undefined
        ) {
          const m = computeMaturityDate(effType, effIssue, effTenor);
          if (m) secUpdate.maturityDate = new Date(m + "T12:00:00Z");
        }
        if (input.couponRate !== undefined) secUpdate.couponRate = String(input.couponRate);
        // Round 42 — discount + floating-rate fields.
        if (input.purchasePrice !== undefined) {
          secUpdate.purchasePrice = input.purchasePrice != null ? String(input.purchasePrice) : null;
        }
        if (input.discountRate !== undefined) {
          secUpdate.discountRate = input.discountRate != null ? String(input.discountRate) : null;
        }
        if (input.marginRate !== undefined) {
          secUpdate.marginRate = input.marginRate != null ? String(input.marginRate) : null;
        }
        if (input.resetMonths !== undefined) {
          secUpdate.resetMonths = input.resetMonths ?? null;
        }
        // Tax-exempt follows the type: switching to/from IFB resets it unless the
        // caller explicitly overrides.
        if (input.isTaxExempt !== undefined) {
          secUpdate.isTaxExempt = input.isTaxExempt;
        } else if (input.securityType !== undefined) {
          secUpdate.isTaxExempt = effType === "ifb";
        }
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
        // Round 39: precise gov-security type + tenor so the auto-created register
        // row carries the right maturity, rate, and tiered WHT. When a t-bill
        // securityType is given it overrides the coarse "tbill" bucket default.
        govSecurityType: z.enum(["tbill_91", "tbill_182", "tbill_364", "ifb", "fxd", "zero_coupon", "floating_rate"]).optional(),
        bondTenorYears: z.number().min(0.1).max(30).optional(),
        couponRate: z.number().min(0).max(50).optional(),
        // Round 47 — floating-rate notes can capture their benchmark + margin and
        // reset cadence directly from the deposit drawer (previously register-only).
        marginRate: z.number().min(0).max(20).optional(),
        resetMonths: z.number().int().min(1).max(24).optional(),
        // Round 47 — explicit maturity-date override for non-standard tenors
        // (e.g. an off-cycle zero-coupon). When omitted, maturity is derived from
        // type + issue + tenor as before.
        maturityDate: z.string().optional(),
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
          // Resolve the precise security type. A caller-supplied govSecurityType
          // wins; otherwise fall back to the coarse bucket (defaulting t-bill to
          // the 364-day tenor for back-compat).
          const securityType: GovSecurityType =
            input.govSecurityType ??
            (bucket === "tbill" ? "tbill_364" : bucket === "ifb" ? "ifb" : "fxd");
          const isTbill = securityType.startsWith("tbill");
          const tenorYears = isTbill ? null : (input.bondTenorYears ?? null);
          const issue = new Date(input.depositDate + "T12:00:00Z");
          // Maturity: honour an explicit override (Round 47) for non-standard
          // tenors; otherwise derive deterministically from type + issue + tenor.
          const maturityStr =
            input.maturityDate && !isTbill
              ? input.maturityDate
              : computeMaturityDate(securityType, input.depositDate, tenorYears);
          const maturity = new Date(maturityStr + "T12:00:00Z");
          const isFloatingDep = securityType === "floating_rate";
          // Rate: caller override, else the type's default from Rate Settings. For
          // a floating-rate note the effective coupon is benchmark + margin; the
          // caller passes the resolved couponRate, and we also persist the margin.
          let couponRate =
            input.couponRate ?? defaultRateForSecurity(securityType, rates);
          // Round 45 — mirror the Securities Register discount mechanics so a
          // gov security added via Record Deposits behaves identically to one
          // added in the register. For discount instruments (T-bills and
          // zero-coupon bonds) the user pays BELOW face; we derive the
          // purchase price + discount rate here so the engine accretes it to
          // face and charges WHT only on the discount. faceValue stays equal to
          // the entered amount (keeps the gov sub-check face-vs-deposit green).
          const isZeroDep = securityType === "zero_coupon";
          const isDiscountDep = isTbill || isZeroDep;
          const discountRateDep = isDiscountDep ? couponRate : null;
          let purchasePriceDep: number | null = null;
          if (isDiscountDep && discountRateDep != null && discountRateDep > 0) {
            const tenorDaysDep = isTbill
              ? TBILL_TENOR_DAYS[securityType as "tbill_91" | "tbill_182" | "tbill_364"]
              : 0;
            const tYearsDep = tenorYearsForSecurity(securityType, tenorYears);
            purchasePriceDep = discountPriceForSecurity({
              isDiscount: true,
              isZeroCoupon: isZeroDep,
              faceValue: input.amount,
              ratePct: discountRateDep,
              tenorDays: tenorDaysDep,
              tenorYears: tYearsDep,
            });
          }
          // Zero-coupon bonds carry no periodic coupon — the return IS the discount.
          if (isZeroDep) couponRate = 0;
          const sec = await addSecurity({
            portfolioId: input.portfolioId,
            securityType,
            assetClass: assetClassForSecurityType(securityType),
            tenorYears: tenorYears != null ? String(tenorYears) : null,
            faceValue: String(input.amount),
            issueDate: issue,
            maturityDate: maturity,
            purchasePrice:
              purchasePriceDep != null
                ? String(Math.round(purchasePriceDep * 100) / 100)
                : null,
            discountRate: discountRateDep != null ? String(discountRateDep) : null,
            couponRate: String(couponRate),
            // Round 47 — persist the floating-rate margin + reset cadence captured
            // in the deposit drawer so the register row is complete on creation.
            marginRate: isFloatingDep && input.marginRate != null ? String(input.marginRate) : null,
            resetMonths: isFloatingDep ? (input.resetMonths ?? null) : null,
            isTaxExempt: securityType === "ifb",
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
          forwardGrossIncome12mo: 0,
          forwardNetIncome12mo: 0,
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
        forwardGrossIncome12mo: round2(summary.forwardGrossIncome12mo ?? 0),
        forwardNetIncome12mo: round2(summary.forwardNetIncome12mo ?? 0),
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
          // A TERM deposit (fixed deposit OR target/goal savings) broken before
          // its maturity date is an early withdrawal that forfeits accrued interest.
          const isTermDeposit = h && (h.instrumentType === "fixed_deposit" || h.instrumentType === "target_savings");
          if (h && isTermDeposit && h.maturityDate) {
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
          // Reduce the holding principal to keep actuals in sync. When the
          // withdrawal empties the deposit (full break), deactivate the holding
          // so it drops out of net worth, the liquidity calendar and yield blend.
          if (h) {
            const newPrincipal = Math.max(0, (parseFloat(String(h.principal)) || 0) - input.amount);
            await updateBankInstrumentHolding(input.bankHoldingId, input.portfolioId, {
              principal: String(newPrincipal),
              ...(newPrincipal <= 0.005 ? { isActive: false } : {}),
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
          ifbTenorRates: input.ifbTenorRates ?? null,
          fxdTenorRates: input.fxdTenorRates ?? null,
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
        return rows.map((h) => {
          // Part 5: value ONCE via the shared mark-to-model source so the UI shows
          // units × price × FX (price-driven) or stored value (legacy), the precise
          // class, offshore native + KES, and provenance — no UI valuation logic.
          const valued = valueHolding({
            assetClass: h.assetClass,
            behaviorClass: h.behaviorClass ?? null,
            currentValue: h.currentValue,
            units: h.units ?? null,
            unitPrice: h.unitPrice ?? null,
            currency: h.currency ?? null,
            fxRateToKes: h.fxRateToKes ?? null,
            dataSource: h.dataSource ?? null,
            dataAsOf: h.dataAsOf ?? null,
          });
          return {
            id: h.id,
            portfolioId: h.portfolioId,
            assetClass: h.assetClass,
            behaviorClass: valued.behaviorClass,
            name: h.name,
            description: h.description ?? null,
            purchaseValue: parseFloat(String(h.purchaseValue)),
            currentValue: parseFloat(String(h.currentValue)),
            // The figure every surface should display:
            valueKes: valued.valueKes,
            markToModel: valued.markToModel,
            priceDriven: valued.priceDriven,
            fxExposed: valued.fxExposed,
            hasMaturity: valued.hasMaturity,
            isLiquid: valued.isLiquid,
            insured: valued.insured,
            classLabel: valued.profile?.label ?? null,
            incomeType: valued.profile?.incomeType ?? null,
            native: valued.native,
            provenance: valued.provenance,
            purchaseDate: h.purchaseDate ? normaliseDate(h.purchaseDate) : null,
            notes: h.notes ?? null,
            incomeRatePct: h.incomeRatePct ? parseFloat(String(h.incomeRatePct)) : null,
            assumedReturnConservative: h.assumedReturnConservative ? parseFloat(String(h.assumedReturnConservative)) : null,
            assumedReturnBase: h.assumedReturnBase ? parseFloat(String(h.assumedReturnBase)) : null,
            assumedReturnOptimistic: h.assumedReturnOptimistic ? parseFloat(String(h.assumedReturnOptimistic)) : null,
            // Part 6: the EFFECTIVE risk assumption (user edits win, else per-class
            // default). `*IsDefault` lets the UI tag values as "assumed by class".
            risk: valued.behaviorClass
              ? (() => {
                  const r = resolveRiskAssumption(valued.behaviorClass!, {
                    expectedReturnPct: h.expectedReturnPct != null ? parseFloat(String(h.expectedReturnPct)) : null,
                    volatilityPct: h.volatilityPct != null ? parseFloat(String(h.volatilityPct)) : null,
                    correlationGroup: h.correlationGroup ?? null,
                  });
                  return {
                    ...r,
                    source: h.riskSource ?? null,
                    asOf: h.riskAsOf ? new Date(h.riskAsOf).getTime() : null,
                  };
                })()
              : null,
            createdAt: h.createdAt,
            updatedAt: h.updatedAt,
          };
        });
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
        // Part 6: optional per-holding risk assumptions (null = use class default).
        expectedReturnPct: z.number().min(-50).max(100).optional(),
        volatilityPct: z.number().min(0).max(200).optional(),
        correlationGroup: z.enum(["kes_rates", "kes_equity", "property", "offshore_equity", "cash"]).optional(),
        riskSource: z.string().max(200).optional(),
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
          expectedReturnPct: input.expectedReturnPct != null ? String(input.expectedReturnPct) : undefined,
          volatilityPct: input.volatilityPct != null ? String(input.volatilityPct) : undefined,
          correlationGroup: input.correlationGroup,
          riskSource: input.riskSource,
          riskAsOf: (input.expectedReturnPct != null || input.volatilityPct != null || input.correlationGroup) ? new Date() : undefined,
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
        // Part 6: editable risk assumptions (null clears the override → class default).
        expectedReturnPct: z.number().min(-50).max(100).nullable().optional(),
        volatilityPct: z.number().min(0).max(200).nullable().optional(),
        correlationGroup: z.enum(["kes_rates", "kes_equity", "property", "offshore_equity", "cash"]).nullable().optional(),
        riskSource: z.string().max(200).nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const { id, portfolioId, ...rest } = input;
        const riskTouched =
          rest.expectedReturnPct !== undefined ||
          rest.volatilityPct !== undefined ||
          rest.correlationGroup !== undefined;
        await updateOtherHolding(id, portfolioId, {
          ...(rest.name !== undefined && { name: rest.name }),
          ...(rest.description !== undefined && { description: rest.description }),
          ...(rest.currentValue !== undefined && { currentValue: String(rest.currentValue) }),
          ...(rest.notes !== undefined && { notes: rest.notes }),
          ...(rest.assumedReturnConservative !== undefined && { assumedReturnConservative: rest.assumedReturnConservative != null ? String(rest.assumedReturnConservative) : null }),
          ...(rest.assumedReturnBase !== undefined && { assumedReturnBase: rest.assumedReturnBase != null ? String(rest.assumedReturnBase) : null }),
          ...(rest.assumedReturnOptimistic !== undefined && { assumedReturnOptimistic: rest.assumedReturnOptimistic != null ? String(rest.assumedReturnOptimistic) : null }),
          ...(rest.expectedReturnPct !== undefined && { expectedReturnPct: rest.expectedReturnPct != null ? String(rest.expectedReturnPct) : null }),
          ...(rest.volatilityPct !== undefined && { volatilityPct: rest.volatilityPct != null ? String(rest.volatilityPct) : null }),
          ...(rest.correlationGroup !== undefined && { correlationGroup: rest.correlationGroup ?? null }),
          ...(rest.riskSource !== undefined && { riskSource: rest.riskSource ?? null }),
          ...(riskTouched && { riskAsOf: new Date() }),
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

  /**
   * Expansion Part 3 — "Model what I chose". Turns a catalog selection + the
   * user's own inputs into a hypothetical PREVIEW (no writes) and, on commit, a
   * tracked holding written through the EXISTING actuals path (`addOtherHolding`)
   * with provenance + Change History. The engine projection band is untouched:
   * other holdings are net-worth/allocation items, never MMF/gov lots, so we
   * never fabricate an "it hits the goal sooner" engine number. Nothing here
   * ranks, recommends, or auto-selects.
   */
  modeling: router({
    /** Live side-by-side preview. No database writes. */
    preview: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        assetClass: z.enum(["equity", "reit", "offshore_fund", "cash_mmf", "bank_deposit", "gov_discount", "gov_coupon", "alt"]),
        name: z.string().min(1).max(200),
        amountKes: z.number().min(0).nullable().optional(),
        units: z.number().min(0).nullable().optional(),
        unitPrice: z.number().min(0).nullable().optional(),
        currency: z.string().max(8).nullable().optional(),
        fxRateToKes: z.number().min(0).nullable().optional(),
        incomeRatePct: z.number().min(0).max(100).nullable().optional(),
        incomeCadence: z.enum(["annual", "semiannual", "quarterly", "none"]).optional(),
        incomeDisposition: z.enum(["sweep", "reinvest"]).optional(),
        userTaxRatePct: z.number().min(0).max(100).nullable().optional(),
        assumedReturnConservative: z.number().min(-100).max(100).nullable().optional(),
        assumedReturnBase: z.number().min(-100).max(100).nullable().optional(),
        assumedReturnOptimistic: z.number().min(-100).max(100).nullable().optional(),
        fundedFromLiquid: z.boolean().default(false),
      }))
      .query(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const modelingInput: ModelingInputs = {
          assetClass: input.assetClass as AssetClass,
          name: input.name,
          amountKes: input.amountKes ?? null,
          units: input.units ?? null,
          unitPrice: input.unitPrice ?? null,
          currency: input.currency ?? null,
          fxRateToKes: input.fxRateToKes ?? null,
          incomeRatePct: input.incomeRatePct ?? null,
          assumedReturnConservative: input.assumedReturnConservative ?? null,
          assumedReturnBase: input.assumedReturnBase ?? null,
          assumedReturnOptimistic: input.assumedReturnOptimistic ?? null,
        };
        const issues = modelingIssues(modelingInput);
        const amountKes = deriveAmountKes(modelingInput);

        const allocInput = await loadAllocationInput(input.portfolioId, p);
        const profile = profileFor(input.assetClass as AssetClass);
        const horizonMonths = (p as { horizonMonths?: number }).horizonMonths ?? 120;
        const preview = previewModelImpact({
          allocationInput: allocInput,
          registerAssetClass: registerClassForAssetClass(input.assetClass as AssetClass),
          amountKes,
          label: input.name,
          fundedFromLiquid: input.fundedFromLiquid,
          assumedReturnConservative: input.assumedReturnConservative ?? null,
          assumedReturnBase: input.assumedReturnBase ?? null,
          assumedReturnOptimistic: input.assumedReturnOptimistic ?? null,
          horizonYears: horizonMonths / 12,
          // Part 4: route the holding's own scenarios through the single
          // valuation pipeline (capital growth + scheduled net income).
          assetClass: input.assetClass as AssetClass,
          incomeRatePct: input.incomeRatePct ?? null,
          incomeCadence: input.incomeCadence,
          incomeDisposition: input.incomeDisposition,
          userTaxRatePct: input.userTaxRatePct ?? null,
        });
        // Tax treatment for the income stream, via the single decision point.
        const tax = taxFor({
          assetClass: input.assetClass as AssetClass,
          userRatePct: input.userTaxRatePct ?? null,
        });
        return {
          amountKes,
          issues,
          valid: issues.length === 0,
          priceDriven: profile.priceDriven,
          fxExposed: profile.fxExposed,
          incomeType: profile.incomeType,
          tax,
          preview,
        };
      }),

    /**
     * Commit a modeled holding through the EXISTING actuals path. Writes one
     * `other_holdings` row (tagged by class, with provenance in notes) and an
     * audit-log Change History entry. Test/Live is implicit: the row is written
     * to whichever portfolio (sandbox or live) the user is operating.
     */
    commit: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        assetClass: z.enum(["equity", "reit", "offshore_fund", "cash_mmf", "bank_deposit", "gov_discount", "gov_coupon", "alt"]),
        name: z.string().min(1).max(200),
        amountKes: z.number().min(0).nullable().optional(),
        units: z.number().min(0).nullable().optional(),
        unitPrice: z.number().min(0).nullable().optional(),
        currency: z.string().max(8).nullable().optional(),
        fxRateToKes: z.number().min(0).nullable().optional(),
        incomeRatePct: z.number().min(0).max(100).nullable().optional(),
        assumedReturnConservative: z.number().min(-100).max(100).nullable().optional(),
        assumedReturnBase: z.number().min(-100).max(100).nullable().optional(),
        assumedReturnOptimistic: z.number().min(-100).max(100).nullable().optional(),
        entryDate: z.string().optional(),
        catalogRef: z.string().max(120).nullable().optional(),
        dataSource: z.string().max(200).nullable().optional(),
        dataAsOf: z.string().max(40).nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const now = getNow(p);
        const entryIso = input.entryDate ?? formatUtcDate(now);
        const modelingInput: ModelingInputs = {
          assetClass: input.assetClass as AssetClass,
          name: input.name,
          amountKes: input.amountKes ?? null,
          units: input.units ?? null,
          unitPrice: input.unitPrice ?? null,
          currency: input.currency ?? null,
          fxRateToKes: input.fxRateToKes ?? null,
          incomeRatePct: input.incomeRatePct ?? null,
          assumedReturnConservative: input.assumedReturnConservative ?? null,
          assumedReturnBase: input.assumedReturnBase ?? null,
          assumedReturnOptimistic: input.assumedReturnOptimistic ?? null,
          entryDateIso: entryIso,
          catalogRef: input.catalogRef ?? null,
          dataSource: input.dataSource ?? null,
          dataAsOf: input.dataAsOf ?? null,
        };
        const issues = modelingIssues(modelingInput);
        if (issues.length > 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: issues.join(" ") });
        }
        const draft = buildHoldingDraft(modelingInput);
        const amountKes = deriveAmountKes(modelingInput);

        const res = await addOtherHolding({
          portfolioId: input.portfolioId,
          assetClass: draft.registerAssetClass,
          name: draft.name,
          description: draft.description ?? undefined,
          purchaseValue: String(draft.purchaseValue),
          currentValue: String(draft.currentValue),
          purchaseDate: draft.purchaseDate ? new Date(draft.purchaseDate) : undefined,
          notes: draft.notes,
          assumedReturnConservative: draft.assumedReturnConservative != null ? String(draft.assumedReturnConservative) : undefined,
          assumedReturnBase: draft.assumedReturnBase != null ? String(draft.assumedReturnBase) : undefined,
          assumedReturnOptimistic: draft.assumedReturnOptimistic != null ? String(draft.assumedReturnOptimistic) : undefined,
          // Part 5 — structured mark-to-model + provenance so every surface can
          // RE-DERIVE value from units × price × FX and trace the figure.
          behaviorClass: draft.behaviorClass,
          units: draft.units != null ? String(draft.units) : undefined,
          unitPrice: draft.unitPrice != null ? String(draft.unitPrice) : undefined,
          currency: draft.currency ?? undefined,
          fxRateToKes: draft.fxRateToKes != null ? String(draft.fxRateToKes) : undefined,
          incomeRatePct: draft.incomeRatePct != null ? String(draft.incomeRatePct) : undefined,
          dataSource: draft.dataSource ?? undefined,
          dataAsOf: draft.dataAsOf ? new Date(draft.dataAsOf) : undefined,
        });
        const newId = (res as { insertId?: number } | null)?.insertId ?? null;

        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "other_holding",
          entityId: newId ?? undefined,
          action: "create",
          field: "modeled_holding",
          newValue: String(draft.currentValue),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Modeled "${draft.name}" from Explore (${profileFor(input.assetClass as AssetClass).label}) — KES ${amountKes.toLocaleString()} tracked as a holding`,
        });

        return { success: true, id: newId, amountKes };
      }),

    /**
     * Exit/disposal preview for a modeled (or any) holding: proceeds, realised
     * gain/loss and any user-supplied gain tax. Listed NSE shares are CGT-exempt,
     * so the gain tax defaults to 0 unless a rate is supplied. No write.
     */
    exitPreview: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        holdingId: z.number().int().positive(),
        gainTaxRatePct: z.number().min(0).max(100).nullable().optional(),
      }))
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const h = await getOtherHolding(input.holdingId, input.portfolioId);
        if (!h) throw new TRPCError({ code: "NOT_FOUND", message: "Holding not found." });
        const currentValue = parseFloat(String(h.currentValue ?? "0")) || 0;
        const costBasis = parseFloat(String(h.purchaseValue ?? h.currentValue ?? "0")) || 0;
        return computeExit({
          currentValue,
          costBasis,
          gainTaxRatePct: input.gainTaxRatePct ?? 0,
        });
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
          earlyBreakPenaltyPct: Number((r as { earlyBreakPenaltyPct?: string | number }).earlyBreakPenaltyPct ?? 0),
          maturityAction: (r as { maturityAction?: "redeploy" | "rollover" }).maturityAction ?? "redeploy",
          notes: r.notes ?? null,
          isActive: r.isActive,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
      }),
    /**
     * Round 31: per-issuer concentration check for the Dashboard banner. Returns
     * any bank/issuer whose active-deposit value exceeds ISSUER_CONCENTRATION_CAP
     * (25%) of total net worth. Government securities are sovereign and excluded.
     * Server-authoritative: net worth comes from getActualsSummary so the banner
     * cannot drift from the Dashboard total.
     */
    concentration: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const rates = await getRateSettings(input.portfolioId);
        const fundEar = await getSelectedFundEar(p);
        const settings = dbToEngine(rates, p, fundEar);
        const summary = await getActualsSummary(
          input.portfolioId,
          settings.targetAmount,
          settings.withholdingTax,
          settings.fxdCouponRate,
          settings.mmfYield,
          settings.tbill364Rate,
        );
        const netWorth = summary ? summary.totalContributed : 0;
        const rows = await getBankInstrumentHoldings(input.portfolioId);
        const issuerValues = rows
          .filter((r) => r.isActive)
          .map((r) => ({
            issuer: r.bankName,
            // Use the larger of current value vs principal (mirrors net-worth basis).
            value: Math.max(Number(r.currentValue) || 0, Number(r.principal) || 0),
          }));
        const capPct = parseFloat(String((p as { concentrationCapPct?: string }).concentrationCapPct ?? "25"));
        const cap = (Number.isFinite(capPct) && capPct > 0 ? capPct : 25) / 100;
        const breaches = detectIssuerConcentration(issuerValues, netWorth, cap);
        // R60: largest single-issuer share (even when within cap) so the Dashboard
        // Risk-limits progress bar can render in BOTH the within-cap and breached
        // states. Aggregate by issuer name first.
        const byIssuer: Record<string, number> = {};
        for (const iv of issuerValues) {
          byIssuer[iv.issuer] = (byIssuer[iv.issuer] ?? 0) + iv.value;
        }
        const maxIssuerValue = Object.values(byIssuer).reduce((mx, v) => (v > mx ? v : mx), 0);
        const topShare = netWorth > 0 ? Math.round((maxIssuerValue / netWorth) * 10000) / 10000 : 0;
        return {
          cap,
          netWorth: Math.round(netWorth * 100) / 100,
          topShare,
          breaches: breaches.map((b) => ({
            issuer: b.issuer,
            value: Math.round(b.value * 100) / 100,
            share: Math.round(b.share * 10000) / 10000,
          })),
        };
      }),
    /**
     * Round 62: liquid-reserve diversification allocator. Builds the eligible
     * liquid homes (primary MMF + secondary MMFs + LIQUID bank instruments),
     * pulls each home's gross yield + WHT (kept current by the weekly updates),
     * and runs the pure allocator so the Dashboard/Portfolio Review can surface
     * how the residual liquid cash should be spread to keep each issuer under
     * its cap. Government securities are sovereign and never enter the pot.
     */
    liquidAllocation: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const c = await computeLiquidDriftContext(p);
        const now = Date.now();
        const snoozeUntil =
          (p as { driftSnoozeUntil?: number | null }).driftSnoozeUntil ?? null;
        const driftSnoozed =
          typeof snoozeUntil === "number" && snoozeUntil > now;
        return {
          ...c.result,
          slices: c.slices,
          hasActuals: c.hasActuals,
          reconciledCount: c.reconciledCount,
          totalDrift: c.drift.totalDrift,
          driftThresholdPct: c.driftThresholdPct,
          driftThresholdValue: c.drift.thresholdValue,
          // The raw breach (drift > threshold) and the effective alert (breach AND
          // not snoozed). The UI mutes the alert when snoozed but can still show
          // the badge/value.
          driftBreachedRaw: c.drift.breached,
          driftBreached: c.drift.breached && !driftSnoozed,
          driftSnoozed,
          driftSnoozeUntil: driftSnoozed ? snoozeUntil : null,
          driftDigestMode:
            (p as { driftDigestMode?: string }).driftDigestMode === "digest"
              ? "digest"
              : "immediate",
        };
      }),
    // R67 — recent drift snapshots for the sparkline (chronological).
    driftHistory: protectedProcedure
      .input(
        z.object({
          portfolioId: z.number().int().positive(),
          limit: z.number().int().min(2).max(90).optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getDriftHistory(input.portfolioId, input.limit ?? 30);
        return rows.map((r) => ({
          totalDrift: parseFloat(String(r.totalDrift)) || 0,
          netWorth: parseFloat(String(r.netWorth)) || 0,
          thresholdValue: parseFloat(String(r.thresholdValue)) || 0,
          breached: Boolean(r.breached),
          at: r.createdAt instanceof Date ? r.createdAt.getTime() : null,
        }));
      }),
    // R67 — snooze (or clear) the drift-rebalancing alert. Mirrors the
    // concentration snooze: a future Unix-ms timestamp mutes the alert and
    // suppresses owner notifications until it passes. Pass until=null to clear.
    snoozeDrift: protectedProcedure
      .input(
        z.object({
          portfolioId: z.number().int().positive(),
          until: z.number().int().nullable(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await setDriftSnoozeUntil(input.portfolioId, input.until);
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "liquid_home_balance",
          action: "update",
          field: "drift_snooze",
          newValue: input.until ? new Date(input.until).toISOString() : "cleared",
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: input.until
            ? `Snoozed liquid drift alert until ${new Date(input.until).toLocaleDateString()}`
            : "Cleared liquid drift alert snooze",
        });
        return { ok: true };
      }),
    // R68 — switch the drift-breach notification mode. "digest" creates a daily
    // Heartbeat cron that sends one summary; "immediate" deletes the cron and
    // restores per-event pings. The cron task_uid is persisted on the portfolio.
    setDriftDigest: protectedProcedure
      .input(
        z.object({
          portfolioId: z.number().int().positive(),
          mode: z.enum(["immediate", "digest"]),
          // Daily send hour in UTC (0–23). Defaults to 06:00 UTC (~9am EAT).
          hourUtc: z.number().int().min(0).max(23).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        // Time Machine: a sandbox portfolio runs on a SIMULATED clock, so a daily
        // real-clock Heartbeat cron would fire on the wrong day and pollute Live
        // owner notifications. Never schedule digests for sandbox portfolios.
        if ((p as { isSandbox?: boolean }).isSandbox === true) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Drift digests are disabled in Test mode — sandbox portfolios run on the Time Machine's simulated clock, not the real calendar.",
          });
        }
        const existingUid =
          (p as { driftDigestCronTaskUid?: string | null }).driftDigestCronTaskUid ?? null;
        const sessionToken =
          parseCookie(ctx.req.headers.cookie ?? "")[COOKIE_NAME] ?? "";
        const hour = input.hourUtc ?? 6;

        if (input.mode === "digest") {
          // Idempotent: update the existing cron's schedule, or create one.
          let taskUid = existingUid;
          const cron = `0 0 ${hour} * * *`;
          if (taskUid) {
            await updateHeartbeatJob(taskUid, { cron, enable: true }, sessionToken);
          } else {
            const job = await createHeartbeatJob(
              {
                name: `drift-digest-${input.portfolioId}`,
                cron,
                path: "/api/scheduled/driftDigest",
                payload: { portfolioId: input.portfolioId },
                description: `Daily liquid-drift digest for portfolio ${input.portfolioId}`,
              },
              sessionToken,
            );
            taskUid = job.taskUid;
          }
          await setDriftDigestConfig(input.portfolioId, {
            mode: "digest",
            cronTaskUid: taskUid,
          });
        } else {
          if (existingUid) {
            try {
              await deleteHeartbeatJob(existingUid, sessionToken);
            } catch {
              // Best-effort: if the cron is already gone, proceed to clear locally.
            }
          }
          await setDriftDigestConfig(input.portfolioId, {
            mode: "immediate",
            cronTaskUid: null,
          });
          await setDriftDigestPending(input.portfolioId, false);
        }

        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "liquid_home_balance",
          action: "update",
          field: "drift_digest_mode",
          newValue: input.mode,
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary:
            input.mode === "digest"
              ? `Enabled daily drift digest (${String(hour).padStart(2, "0")}:00 UTC)`
              : "Switched drift alerts back to immediate notifications",
        });
        return { ok: true, mode: input.mode };
      }),
    // R64 — record/clear the ACTUAL balance resting in a liquid home so the split
    // shows real drift (actual vs target) and survives reloads.
    // R65 — each change is written to Change History for auditability.
    setLiquidBalance: protectedProcedure
      .input(
        z.object({
          portfolioId: z.number().int().positive(),
          homeId: z.string().min(1).max(64),
          homeLabel: z.string().max(200).optional(),
          actualBalance: z.number().min(0),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await upsertLiquidHomeBalance(input.portfolioId, input.homeId, input.actualBalance);
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "liquid_home_balance",
          action: "update",
          field: input.homeId,
          newValue: String(Math.round(input.actualBalance)),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Reconciled liquid balance: ${input.homeLabel ?? input.homeId} → KES ${Math.round(input.actualBalance).toLocaleString()}`,
        });
        const drift = await snapshotAndMaybeNotifyDrift(input.portfolioId, ctx.user.id);
        return { ok: true, drift };
      }),
    clearLiquidBalance: protectedProcedure
      .input(
        z.object({
          portfolioId: z.number().int().positive(),
          homeId: z.string().min(1).max(64),
          homeLabel: z.string().max(200).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await clearLiquidHomeBalance(input.portfolioId, input.homeId);
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "liquid_home_balance",
          action: "delete",
          field: input.homeId,
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Reverted liquid balance to estimate: ${input.homeLabel ?? input.homeId}`,
        });
        const drift = await snapshotAndMaybeNotifyDrift(input.portfolioId, ctx.user.id);
        return { ok: true, drift };
      }),
    // R65 — Reconcile-all: set every liquid home's actual balance in one action,
    // writing a single batch entry to Change History.
    setLiquidBalancesBulk: protectedProcedure
      .input(
        z.object({
          portfolioId: z.number().int().positive(),
          balances: z
            .array(
              z.object({
                homeId: z.string().min(1).max(64),
                homeLabel: z.string().max(200).optional(),
                actualBalance: z.number().min(0),
              }),
            )
            .min(1)
            .max(64),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        for (const b of input.balances) {
          await upsertLiquidHomeBalance(input.portfolioId, b.homeId, b.actualBalance);
        }
        const total = input.balances.reduce((s, b) => s + b.actualBalance, 0);
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "liquid_home_balance",
          action: "update",
          field: "reconcile_all",
          newValue: String(Math.round(total)),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Reconciled all liquid balances (${input.balances.length} home${input.balances.length === 1 ? "" : "s"}, total KES ${Math.round(total).toLocaleString()})`,
        });
        const drift = await snapshotAndMaybeNotifyDrift(input.portfolioId, ctx.user.id);
        return { ok: true, count: input.balances.length, drift };
      }),
    // R65 — log an applied transfer plan to Change History (audit trail of moves).
    recordAppliedTransfers: protectedProcedure
      .input(
        z.object({
          portfolioId: z.number().int().positive(),
          transfers: z
            .array(
              z.object({
                from: z.string().max(200),
                to: z.string().max(200),
                amount: z.number().min(0),
              }),
            )
            .min(1)
            .max(64),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const total = input.transfers.reduce((s, t) => s + t.amount, 0);
        const lines = input.transfers
          .map((t) => `${t.from} → ${t.to}: KES ${Math.round(t.amount).toLocaleString()}`)
          .join("; ");
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "liquid_transfer",
          action: "create",
          field: "apply_split",
          newValue: String(Math.round(total)),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Applied liquid split (${input.transfers.length} transfer${input.transfers.length === 1 ? "" : "s"}, total KES ${Math.round(total).toLocaleString()}): ${lines}`,
        });
        return { ok: true, count: input.transfers.length };
      }),
    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        bankName: z.string().min(1).max(200),
        label: z.string().max(200).optional(),
        instrumentType: z.enum(["call_deposit", "fixed_deposit", "ordinary_savings", "target_savings", "tiered_savings"]),
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
        earlyBreakPenaltyPct: z.number().min(0).max(100).default(0),
        maturityAction: z.enum(["redeploy", "rollover"]).default("redeploy"),
        notes: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const created = await addBankInstrumentHolding({
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
          earlyBreakPenaltyPct: String(input.earlyBreakPenaltyPct),
          maturityAction: input.maturityAction,
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
        return { success: true, id: created?.id ?? null };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        portfolioId: z.number().int().positive(),
        bankName: z.string().min(1).max(200).optional(),
        label: z.string().max(200).optional(),
        instrumentType: z.enum(["call_deposit", "fixed_deposit", "ordinary_savings", "target_savings", "tiered_savings"]).optional(),
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
        earlyBreakPenaltyPct: z.number().min(0).max(100).optional(),
        maturityAction: z.enum(["redeploy", "rollover"]).optional(),
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
          ...(rest.earlyBreakPenaltyPct !== undefined && { earlyBreakPenaltyPct: String(rest.earlyBreakPenaltyPct) }),
          ...(rest.maturityAction !== undefined && { maturityAction: rest.maturityAction }),
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
    /**
     * Round 70: parsed history of acknowledged concentration-cap breaches.
     * Reads the audit_log rows written by recordBreachAck and parses the
     * "X% vs Y% cap" snapshot into structured fields for an auditable table.
     */
    breachAckHistory: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), limit: z.number().int().min(1).max(200).default(50) }))
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getBreachAcks(input.portfolioId, input.limit);
        return rows.map((r) => {
          const parsed = parseBreachAckRow({
            field: r.field,
            newValue: r.newValue,
            summary: r.summary,
          });
          return {
            id: r.id,
            capKind: parsed.capKind,
            label: parsed.label,
            sharePct: parsed.sharePct,
            capPct: parsed.capPct,
            summary: r.summary ?? null,
            changedByName: r.changedByName ?? null,
            at: r.createdAt,
          };
        });
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
          const securityType: GovSecurityType =
            bucket === "tbill" ? "tbill_364" : bucket === "ifb" ? "ifb" : "fxd";
          const isTbillSeed = securityType.startsWith("tbill");
          // Give the sample FXD a realistic 12-year tenor so it exercises the
          // 10% (>=10y) tiered-WHT path; IFB uses its default tenor.
          const tenorYears = isTbillSeed ? null : securityType === "fxd" ? 12 : null;
          const issue = new Date(`${date}T12:00:00.000Z`);
          const maturityStr = computeMaturityDate(securityType, date, tenorYears);
          const maturity = new Date(`${maturityStr}T12:00:00.000Z`);
          const couponRate = defaultRateForSecurity(securityType, seedRates);
          // Round 42 — for the sample T-bill, record its discount rate and derive
          // the cash paid up front so the demo showcases true discount mechanics
          // (purchase price < face; the discount is the return).
          let discountRate: string | null = null;
          let purchasePrice: string | null = null;
          if (isTbillSeed) {
            const tenorDays = TBILL_TENOR_DAYS[securityType as "tbill_91" | "tbill_182" | "tbill_364"];
            discountRate = String(couponRate);
            purchasePrice = String(Math.round(tbillPrice(amount, couponRate, tenorDays) * 100) / 100);
          }
          const sec = await addSecurity({
            portfolioId: p.id,
            securityType,
            tenorYears: tenorYears != null ? String(tenorYears) : null,
            faceValue: String(amount),
            issueDate: issue,
            maturityDate: maturity,
            couponRate: String(couponRate),
            isTaxExempt: securityType === "ifb",
            discountRate,
            purchasePrice,
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

      // A TARGET/GOAL savings term deposit that MATURES within the elapsed window
      // (opened month 1, 4-month tenor → matures around month 5) so the Month
      // Ledger demonstrates a real maturity + redeployment of principal+interest.
      const goalStart = new Date(Date.UTC(startBase.getUTCFullYear(), startBase.getUTCMonth() + 1, 10, 12, 0, 0));
      const goalMaturity = new Date(Date.UTC(startBase.getUTCFullYear(), startBase.getUTCMonth() + 5, 10, 12, 0, 0));
      await addBankInstrumentHolding({
        portfolioId: p.id,
        bankName: "KCB",
        label: "Goal savings (matured)",
        instrumentType: "target_savings",
        principal: "80000",
        interestRate: "9.0000",
        rateAsOfDate: goalStart,
        isNegotiable: false,
        dayCountBasis: 365,
        whtRate: "15.0000",
        startDate: goalStart,
        tenorMonths: 4,
        maturityDate: goalMaturity,
        payoutFrequency: "maturity",
        earlyBreakPenaltyPct: "25.00",
        currentValue: "80000",
      });

      // A LIQUID tiered / high-yield savings account (accrues in place, no lock).
      await addBankInstrumentHolding({
        portfolioId: p.id,
        bankName: "NCBA",
        label: "Tiered savings",
        instrumentType: "tiered_savings",
        principal: "45000",
        interestRate: "8.0000",
        rateAsOfDate: bankStart,
        isNegotiable: false,
        dayCountBasis: 365,
        whtRate: "15.0000",
        startDate: bankStart,
        payoutFrequency: "on_call",
        currentValue: "45000",
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

  /**
   * Allocation Model (Parts 1–2) — read-only surfaces. The target templates and
   * the glide curve are queryable so the UI (Part 4) can show "your mix today and
   * how it is designed to shift toward safety as your goal approaches" — the
   * whole curve, framed as an intentional plan, never a promise of a return.
   * Editing templates/params goes through dedicated admin paths; these are reads.
   */
  allocation: router({
    /** Every tier's (stored-or-default) target template, in tier order. */
    templates: publicProcedure.query(async () => {
      return await listAllocationTemplates();
    }),

    /** The global glide-curve shape + its provenance (falls back to defaults). */
    glideParams: publicProcedure.query(async () => {
      return await getGlideParams();
    }),

    /**
     * The FULL glide curve for a tier over a horizon: a sampled path of
     * { elapsed, time-remaining, month, phase, weights } the UI charts to show
     * the de-risking over time. Uses the stored (editable) templates + glide
     * shape so edits flow through. Weights/shape only — no return/rate numbers.
     */
    glidePath: publicProcedure
      .input(
        z.object({
          tier: z.enum(
            ALLOCATION_TIERS as readonly [AllocationTier, ...AllocationTier[]],
          ),
          horizonMonths: z.number().int().positive().max(600).optional(),
          steps: z.number().int().positive().max(240).optional(),
        }),
      )
      .query(async ({ input }) => {
        const [templates, glide] = await Promise.all([
          listAllocationTemplates(),
          getGlideParams(),
        ]);
        // Build the stored/edited template map the sampler reads from.
        const templateMap = Object.fromEntries(
          templates.map((t) => [t.tier, t.weights]),
        ) as Record<AllocationTier, (typeof templates)[number]["weights"]>;
        const points = sampleGlidePath({
          tier: input.tier,
          horizonMonths: input.horizonMonths ?? null,
          steps: input.steps,
          params: glide.params,
          templates: templateMap,
        });
        return { tier: input.tier, params: glide.params, points };
      }),

    /** The editable two-sided probability thresholds + provenance. */
    probabilityThresholds: publicProcedure.query(async () => {
      return await getProbabilityThresholds();
    }),

    /**
     * The goal-probability feedback loop (Part 3) for a hypothetical plan under a
     * tier's glide. Given the goal, the KES amount that follows the glided risky
     * allocation, and any deterministic chunk, it returns the time-varying
     * end-value distribution, the floor/ceil-clamped probability, the three
     * neutral levers (more time / more contribution / more risk — the risk lever
     * also reporting its worsened downside), and a strictly factual two-sided
     * insight keyed off the editable thresholds.
     *
     * Read-only and pure: it RESOLVES per-bucket risk assumptions from the sourced
     * riskModel layer (no hardcoded return/vol) and reuses the SAME
     * buildEndValueDistribution / goalProbability machinery the live recompute
     * path uses — there is no parallel probability engine. Optional per-bucket
     * assumption overrides let a caller thread stored edits through unchanged.
     */
    goalProbability: publicProcedure
      .input(
        z.object({
          tier: z.enum(
            ALLOCATION_TIERS as readonly [AllocationTier, ...AllocationTier[]],
          ),
          horizonMonths: z.number().int().positive().max(600),
          goal: z.number().nonnegative(),
          riskyValue: z.number().nonnegative(),
          extraCertainEndValue: z.number().nonnegative().optional(),
          /** Optional per-bucket risk-assumption overrides (sourced upstream). */
          assumptionOverrides: z
            .record(
              z.enum(ALLOCATION_BUCKETS as readonly [string, ...string[]]),
              z.object({
                expectedReturnPct: z.number().nullable().optional(),
                volatilityPct: z.number().nullable().optional(),
                correlationGroup: z.string().nullable().optional(),
              }),
            )
            .optional(),
        }),
      )
      .query(async ({ input }) => {
        const [templates, glide, thresholdsRow] = await Promise.all([
          listAllocationTemplates(),
          getGlideParams(),
          getProbabilityThresholds(),
        ]);
        const templateMap = Object.fromEntries(
          templates.map((t) => [t.tier, t.weights]),
        ) as Record<AllocationTier, (typeof templates)[number]["weights"]>;
        const assumptions = resolveBucketAssumptions(input.assumptionOverrides);
        const common = {
          tier: input.tier,
          horizonMonths: input.horizonMonths,
          goal: input.goal,
          riskyValue: input.riskyValue,
          extraCertainEndValue: input.extraCertainEndValue ?? 0,
          assumptions,
          params: glide.params,
          templates: templateMap,
        };
        const result = glideGoalProbability(common);
        const levers = computeLevers(common);
        const insight = probabilityInsight({
          ...common,
          thresholds: thresholdsRow.thresholds,
        });
        return {
          tier: input.tier,
          horizonMonths: input.horizonMonths,
          goal: input.goal,
          thresholds: thresholdsRow.thresholds,
          effective: result.effective,
          distribution: result.distribution,
          probability: result.probability,
          levers,
          insight,
          caveat: result.caveat,
        };
      }),

    /**
     * Part 4 — the per-goal tier state for the active portfolio: the
     * horizon-derived suggestion (+ plain reason), the resolved selection
     * (defaults to the suggestion until the user overrides), and whether the
     * current choice is RISKIER than the horizon implies (a flag for the
     * consequence readout, never a block). Horizon-remaining is measured from
     * the goal's start date + horizon against the portfolio's effective clock
     * (simulated under the Time Machine, else real) so it matches the rest of
     * the app. Read-only.
     */
    goalTier: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const startIso = normaliseDate(p?.startDate);
        const horizon = p?.horizonMonths ?? 120;
        const nowMs = (p?.simulatedDate as number | null) ?? Date.now();
        const horizonRemainingMonths = Math.max(
          0,
          horizon - computeCurrentMonth(startIso, nowMs, horizon),
        );
        const goalNature: GoalNature = "standard";
        const suggestion = suggestTier(horizonRemainingMonths, goalNature);
        const selection = resolveTierSelection({
          suggestion,
          selected: (p?.allocationSelectedTier ?? null) as AllocationTier | null,
        });
        return {
          portfolioId: input.portfolioId,
          horizonRemainingMonths,
          goalNature,
          suggestion,
          selection,
        };
      }),

    /**
     * Part 4 — choose (override) the tier for the active goal. Overriding to ANY
     * tier is ALWAYS allowed and never blocked; a riskier-than-horizon choice is
     * only FLAGGED (via resolveTierSelection.conflictsWithHorizon) so the UI can
     * show the consequence. Persists the freshly-computed suggestion alongside
     * the user's choice and the override flag. Returns the resolved selection.
     */
    setTier: protectedProcedure
      .input(
        z.object({
          portfolioId: z.number().int().positive(),
          tier: z.enum(
            ALLOCATION_TIERS as readonly [AllocationTier, ...AllocationTier[]],
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const startIso = normaliseDate(p?.startDate);
        const horizon = p?.horizonMonths ?? 120;
        const nowMs = (p?.simulatedDate as number | null) ?? Date.now();
        const horizonRemainingMonths = Math.max(
          0,
          horizon - computeCurrentMonth(startIso, nowMs, horizon),
        );
        const goalNature: GoalNature = "standard";
        const suggestion = suggestTier(horizonRemainingMonths, goalNature);
        const selection = resolveTierSelection({
          suggestion,
          selected: input.tier,
        });
        await updatePortfolio(input.portfolioId, ctx.user.id, {
          allocationSuggestedTier: suggestion.tier,
          allocationSelectedTier: input.tier,
          allocationTierOverridden: selection.userOverrode,
        });
        return { portfolioId: input.portfolioId, suggestion, selection };
      }),

    /**
     * Part 4 — the FACTUAL gap between the goal's glided target mix (at the
     * current journey point) and what the portfolio actually holds right now.
     * Reuses the SINGLE net-worth builder (`buildAllocation` via
     * loadAllocationInput) for the actual mix, maps it into the five behavior
     * buckets, and diffs it in percentage points. Neutral facts only — never a
     * buy/sell instruction. Read-only.
     */
    holdingsGap: protectedProcedure
      .input(
        z.object({
          portfolioId: z.number().int().positive(),
          /** Optional explicit tier; defaults to the goal's resolved selection. */
          tier: z
            .enum(ALLOCATION_TIERS as readonly [AllocationTier, ...AllocationTier[]])
            .optional(),
        }),
      )
      .query(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const startIso = normaliseDate(p?.startDate);
        const horizon = p?.horizonMonths ?? 120;
        const nowMs = (p?.simulatedDate as number | null) ?? Date.now();
        const horizonRemainingMonths = Math.max(
          0,
          horizon - computeCurrentMonth(startIso, nowMs, horizon),
        );
        const goalNature: GoalNature = "standard";
        const suggestion = suggestTier(horizonRemainingMonths, goalNature);
        const selection = resolveTierSelection({
          suggestion,
          selected: (p?.allocationSelectedTier ?? null) as AllocationTier | null,
        });
        const tier = input.tier ?? selection.selectedTier;

        // Time-remaining fraction along the glide (1 at plan start → 0 at the
        // goal date), clamped. Same clock the rest of the app uses.
        const totalHorizon = Math.max(1, Number(p?.horizonMonths) || 0);
        const trf = Math.min(1, Math.max(0, horizonRemainingMonths / totalHorizon));

        const [templates, glide] = await Promise.all([
          listAllocationTemplates(),
          getGlideParams(),
        ]);
        const templateMap = Object.fromEntries(
          templates.map((t) => [t.tier, t.weights]),
        ) as Record<AllocationTier, (typeof templates)[number]["weights"]>;
        const target = glidedAllocation(tier, trf, glide.params, templateMap);

        // Actual mix from the SINGLE shared net-worth builder.
        const alloc = buildAllocation(await loadAllocationInput(input.portfolioId, p));
        const actual: ActualBucketValues = {
          cash: alloc.primaryMmf + alloc.secondaryMmf + alloc.bank,
          gov: alloc.tbill + alloc.ifb + alloc.fxd,
          equity: alloc.other["equity"] ?? 0,
          reit: alloc.other["reit"] ?? 0,
          offshore: alloc.other["offshore_fund"] ?? 0,
          other: Object.entries(alloc.other)
            .filter(([k]) => !["equity", "reit", "offshore_fund"].includes(k))
            .reduce((s, [, v]) => s + (Number(v) || 0), 0),
        };
        const readout = computeBucketGaps({ template: target, actual });
        return {
          portfolioId: input.portfolioId,
          tier,
          timeRemainingFraction: trf,
          horizonRemainingMonths,
          target,
          readout,
        };
      }),
  }),
});
export type AppRouter = typeof appRouter;
