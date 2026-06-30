/**
 * Canonical snapshot BUILDER (server-side).
 *
 * Assembles a {@link PortfolioSnapshot} by composing the app's existing,
 * already-tested helpers. It introduces NO new money math: net worth + the
 * allocation roll-up come from `buildAllocation`; the ledger comes from
 * `runProjection`; the reconciliation sources come from the same inputs the
 * `projection.reconciliation` procedure feeds `reconcile()`; income/tax come
 * from `getActualsSummary`; the tier/gap come from the allocation model.
 *
 * The intent is a single composition point so every surface reads identical
 * numbers through the pure selectors in `shared/snapshot.ts`.
 */
import {
  getRateSettings,
  getContributionOverrides,
  getRateHistory,
  getDepositEntries,
  getWithdrawalEntries,
  getSecurities,
  getSecondaryMmfs,
  getBankInstrumentHoldings,
  getOtherHoldings,
  getActualsSummary,
  getMmfFund,
  type getPortfolio,
} from "./db";
import {
  buildAllocation,
  blendedYield,
  type AllocationInput,
} from "../shared/actuals";
import { valueHolding } from "../shared/holdingValue";
import { reconcile } from "../shared/reconciliation";
import {
  suggestTier,
  resolveTierSelection,
  glidedAllocation,
  computeBucketGaps,
  type AllocationTier,
  type GoalNature,
  type ActualBucketValues,
} from "../shared/allocationModel";
import { listAllocationTemplates, getGlideParams } from "./db";
import {
  runProjection,
  getScheduledContribution,
  computeCurrentMonth,
  type EngineSettings,
  type ActualDeposit,
  type ActualSecurity,
  type ActualBankHolding,
  type SecondaryMmfInput,
} from "./engine";
import type {
  PortfolioSnapshot,
  LedgerRow,
  AllocationGapRow,
  ContributionPlanPoint,
  LiquidityEvent,
  FreshnessWarning,
  NextAction,
} from "../shared/snapshot";

type Portfolio = NonNullable<Awaited<ReturnType<typeof getPortfolio>>>;

/**
 * Default engine settings — a local copy of the literal in routers.ts. Used only
 * as a fallback when a portfolio has no rate_settings row yet. Pure data.
 */
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

// Local copies of the small private helpers in routers.ts (kept in sync; pure).
function normaliseDate(d: Date | string | null | undefined): string {
  if (!d) return "2026-07-01";
  if (d instanceof Date) return d.toISOString().split("T")[0];
  return String(d).split("T")[0];
}
function effectiveNow(p: Portfolio): number {
  const sandbox = !!(p as { isSandbox?: boolean }).isSandbox;
  const sim = (p as { simulatedDate?: number | null }).simulatedDate;
  return sandbox && sim != null ? sim : Date.now();
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * These mappers mirror the inline ones in routers.ts. They are intentionally
 * small and pure so the snapshot can be built without importing router-private
 * functions. They convert raw DB rows into the engine's actual-input shapes.
 */
function toEngineSettings(
  rates: Awaited<ReturnType<typeof getRateSettings>>,
  p: Portfolio,
  fundEar: number | null,
): EngineSettings {
  const r = rates;
  const mmfYield = fundEar != null
    ? fundEar
    : (r ? parseFloat(String(r.mmfYield)) : DEFAULT_SETTINGS.mmfYield);
  const sandbox = !!(p as { isSandbox?: boolean }).isSandbox;
  const sim = (p as { simulatedDate?: number | null }).simulatedDate;
  const nowOverride = sandbox && sim != null ? sim : undefined;
  return {
    mmfYield,
    tbill91Rate: r ? parseFloat(String(r.tbill91Rate)) : DEFAULT_SETTINGS.tbill91Rate,
    tbill182Rate: r ? parseFloat(String(r.tbill182Rate)) : DEFAULT_SETTINGS.tbill182Rate,
    tbill364Rate: r ? parseFloat(String(r.tbill364Rate)) : DEFAULT_SETTINGS.tbill364Rate,
    ifbCouponRate: r ? parseFloat(String(r.ifbCouponRate)) : DEFAULT_SETTINGS.ifbCouponRate,
    fxdCouponRate: r ? parseFloat(String(r.fxdCouponRate)) : DEFAULT_SETTINGS.fxdCouponRate,
    withholdingTax: r ? parseFloat(String(r.withholdingTax)) : DEFAULT_SETTINGS.withholdingTax,
    startingContribution: parseFloat(String(p.startingContribution)) || DEFAULT_SETTINGS.startingContribution,
    stepUpAmount: parseFloat(String(p.stepUpAmount)) || DEFAULT_SETTINGS.stepUpAmount,
    stepUpMonths: p.stepUpMonths ?? DEFAULT_SETTINGS.stepUpMonths,
    safetyFloor: parseFloat(String(p.safetyFloor)) || DEFAULT_SETTINGS.safetyFloor,
    targetAmount: parseFloat(String(p.targetAmount)) || DEFAULT_SETTINGS.targetAmount,
    horizonMonths: p.horizonMonths ?? DEFAULT_SETTINGS.horizonMonths,
    startDate: normaliseDate(p.startDate),
    phaseFractions: {
      foundationFrac: parseFloat(String(p.foundationFrac)),
      growthFrac: parseFloat(String(p.growthFrac)),
      deRiskingFrac: parseFloat(String(p.deRiskingFrac)),
    },
    ifbTenorRates: (r?.ifbTenorRates as Record<string, number> | null | undefined) ?? null,
    fxdTenorRates: (r?.fxdTenorRates as Record<string, number> | null | undefined) ?? null,
    issuerCapFrac: (parseFloat(String((p as { concentrationCapPct?: string }).concentrationCapPct ?? "25")) || 25) / 100,
    typeCapFrac: (parseFloat(String((p as { typeConcentrationCapPct?: string }).typeConcentrationCapPct ?? "60")) || 60) / 100,
    allocationPolicy:
      ((p as { allocationPolicy?: string }).allocationPolicy as
        | "balanced"
        | "yield_first"
        | "custom"
        | undefined) ?? "balanced",
    // Plan-to-ledger contract: the snapshot ledger executes the COMMITTED tier
    // only (planCommittedAt set + a selected tier). Mirrors dbToEngine in
    // routers.ts so the snapshot can never drift from Ledger/Dashboard/Scenarios.
    strategyTier:
      p.planCommittedAt && p.allocationSelectedTier
        ? (p.allocationSelectedTier as EngineSettings["strategyTier"])
        : undefined,
    nowOverride,
  };
}

// ── Local pure mappers (copies of the ones in routers.ts; no side effects) ────
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
      ((d as { institutionType?: string | null }).institutionType as ActualDeposit["institutionType"]) ?? null,
    mmfFundId: (d as { mmfFundId?: number | null }).mmfFundId ?? null,
    bankHoldingId: (d as { bankHoldingId?: number | null }).bankHoldingId ?? null,
  }));
}
function mapPrimaryMmfWithdrawalsAsDeposits(
  rows: Awaited<ReturnType<typeof getWithdrawalEntries>>,
  primaryFundId: number | null,
): ActualDeposit[] {
  return rows
    .filter((w) => {
      if (w.sourceType !== "mmf_fund") return false;
      const fid = (w as { mmfFundId?: number | null }).mmfFundId ?? null;
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
function mapActualBankHoldings(
  rows: Awaited<ReturnType<typeof getBankInstrumentHoldings>>,
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
    instrumentType: (b as { instrumentType?: ActualBankHolding["instrumentType"] }).instrumentType ?? null,
    tenorMonths: (b as { tenorMonths?: number | null }).tenorMonths ?? null,
    maturityDate: normaliseDate((b as { maturityDate?: Date | string | null }).maturityDate),
    payoutFrequency: (b as { payoutFrequency?: ActualBankHolding["payoutFrequency"] }).payoutFrequency ?? null,
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
      purchasePrice: num((s as { purchasePrice?: unknown }).purchasePrice),
      discountRate: num((s as { discountRate?: unknown }).discountRate),
      marginRate: num((s as { marginRate?: unknown }).marginRate),
      resetMonths: num((s as { resetMonths?: unknown }).resetMonths),
    };
  });
}
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

/**
 * Build the canonical snapshot for a portfolio. `p` must already be
 * authorisation-checked by the caller (requirePortfolio).
 */
export async function buildPortfolioSnapshot(
  portfolioId: number,
  p: Portfolio,
): Promise<PortfolioSnapshot> {
  const asOfMs = effectiveNow(p);

  const [rates, fund] = await Promise.all([
    getRateSettings(portfolioId),
    p.mmfFundId ? getMmfFund(p.mmfFundId) : Promise.resolve(null),
  ]);
  const fundEar = fund ? parseFloat(String(fund.ear)) : null;
  const settings = toEngineSettings(rates, p, fundEar);

  // ── Raw rows (one fetch each) ──────────────────────────────────────────────
  const [
    overrides,
    rateHistoryRows,
    depositRows,
    withdrawalRows,
    securityRows,
    secondaryRows,
    bankRows,
    otherRows,
  ] = await Promise.all([
    getContributionOverrides(portfolioId),
    getRateHistory(portfolioId),
    getDepositEntries(portfolioId),
    getWithdrawalEntries(portfolioId),
    getSecurities(portfolioId),
    getSecondaryMmfs(portfolioId),
    getBankInstrumentHoldings(portfolioId),
    getOtherHoldings(portfolioId),
  ]);

  const mappedOverrides = overrides.map((o) => ({
    monthNumber: o.monthNumber,
    overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
    lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
  }));
  const rh = mapRateHistory(rateHistoryRows);
  const actualDeposits = [
    ...mapActualDeposits(depositRows),
    ...mapPrimaryMmfWithdrawalsAsDeposits(withdrawalRows, p.mmfFundId ?? null),
  ];
  const actualSecurities = mapActualSecurities(securityRows);
  const secondaryMmfs = mapSecondaryMmfs(secondaryRows);
  const bankHoldings = mapActualBankHoldings(bankRows);

  // ── Ledger (engine projection) ──────────────────────────────────────────────
  const months = runProjection(
    settings,
    mappedOverrides,
    rh,
    actualDeposits,
    actualSecurities,
    secondaryMmfs,
    bankHoldings,
    p.mmfFundId ?? null,
  );
  const ledger: LedgerRow[] = months.map((m) => ({
    monthNumber: m.monthNumber,
    isActual: m.isActual,
    contribution: round2(m.contribution ?? 0),
    mmfEnd: round2(m.mmfEnd ?? 0),
    mmfInterestNet: round2(m.mmfInterestNet ?? 0),
    totalEnd: round2(m.totalEnd ?? 0),
  }));
  const finalMonth = months[months.length - 1];
  const projectedFinalValue = round2(finalMonth?.totalEnd ?? 0);

  // ── Net worth + allocation roll-up (the SINGLE builder) ─────────────────────
  const allocInput: AllocationInput = {
    deposits: depositRows.map((d) => ({
      amount: parseFloat(String(d.amount ?? "0")) || 0,
      bucket: d.bucket,
      institutionType: d.institutionType,
      mmfFundId: d.mmfFundId,
    })),
    securities: securityRows.map((s) => ({
      securityType: s.securityType,
      faceValue: parseFloat(String(s.faceValue ?? "0")) || 0,
      isMatured: s.isMatured,
    })),
    secondaryMmfs: secondaryRows.map((s) => ({
      mmfFundId: s.mmfFundId ?? null,
      currentBalance: parseFloat(String(s.currentBalance ?? "0")) || 0,
      ear: parseFloat(String(s.ear ?? "0")) || 0,
    })),
    bankHoldings: bankRows.map((b) => ({
      principal: parseFloat(String(b.principal ?? "0")) || 0,
      interestRate: parseFloat(String(b.interestRate ?? "0")) || 0,
      isActive: b.isActive,
      currentValue: parseFloat(String(b.currentValue ?? "0")) || 0,
    })),
    otherHoldings: otherRows.map((h) => ({
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
    primaryFundId: p.mmfFundId ?? null,
  };
  const alloc = buildAllocation(allocInput);
  const netWorth = round2(alloc.netWorth);

  // ── Goal / horizon (effective clock) ────────────────────────────────────────
  const startIso = normaliseDate(p.startDate);
  const horizon = p.horizonMonths ?? 120;
  const elapsedMonths = computeCurrentMonth(startIso, asOfMs, horizon);
  const horizonRemainingMonths = Math.max(0, horizon - elapsedMonths);
  const target = parseFloat(String(p.targetAmount)) || 0;

  // ── Allocation tier + factual gap (reuse allocation model) ─────────────────
  const goalNature: GoalNature = "standard";
  const suggestion = suggestTier(horizonRemainingMonths, goalNature);
  const selection = resolveTierSelection({
    suggestion,
    selected: (p.allocationSelectedTier ?? null) as AllocationTier | null,
  });
  const tier = selection.selectedTier;
  const totalHorizon = Math.max(1, horizon);
  const trf = Math.min(1, Math.max(0, horizonRemainingMonths / totalHorizon));
  const [templates, glide] = await Promise.all([
    listAllocationTemplates(),
    getGlideParams(),
  ]);
  const templateMap = Object.fromEntries(
    templates.map((t: (typeof templates)[number]) => [t.tier, t.weights]),
  ) as Record<AllocationTier, (typeof templates)[number]["weights"]>;
  const targetMix = glidedAllocation(tier, trf, glide.params, templateMap);
  const actualBuckets: ActualBucketValues = {
    cash: alloc.primaryMmf + alloc.secondaryMmf + alloc.bank,
    gov: alloc.tbill + alloc.ifb + alloc.fxd,
    equity: alloc.other["equity"] ?? 0,
    reit: alloc.other["reit"] ?? 0,
    offshore: alloc.other["offshore_fund"] ?? 0,
    other: Object.entries(alloc.other)
      .filter(([k]) => !["equity", "reit", "offshore_fund"].includes(k))
      .reduce((s, [, v]) => s + (Number(v) || 0), 0),
  };
  const gapReadout = computeBucketGaps({ template: targetMix, actual: actualBuckets });
  const allocationRows: AllocationGapRow[] = gapReadout.gaps.map((g) => ({
    bucket: g.bucket,
    targetPct: g.templatePct,
    actualPct: g.actualPct,
    gapPp: g.gapPp,
    direction: g.direction,
  }));

  // ── Income + tax (reuse the canonical actuals summary) ──────────────────────
  const summary = await getActualsSummary(
    portfolioId,
    settings.targetAmount,
    settings.withholdingTax,
    settings.fxdCouponRate,
    settings.mmfYield,
    settings.tbill364Rate,
  );
  const accruedNetInterest = round2(summary?.estInterestEarned ?? 0);
  const blendedNet = blendedYield({
    primaryMmf: alloc.primaryMmf,
    primaryMmfRate: settings.mmfYield,
    secondaryMmfs: secondaryRows.map((s) => ({
      balance: parseFloat(String(s.currentBalance ?? "0")) || 0,
      rate: parseFloat(String(s.ear ?? "0")) || 0,
    })),
    bankHoldings: bankRows
      .filter((b) => b.isActive)
      .map((b) => ({
        value: parseFloat(String(b.principal ?? "0")) || 0,
        rate: parseFloat(String(b.interestRate ?? "0")) || 0,
      })),
    securities: [
      { value: alloc.tbill, rate: settings.tbill364Rate, taxExempt: false },
      { value: alloc.ifb, rate: settings.ifbCouponRate, taxExempt: true },
      { value: alloc.fxd, rate: settings.fxdCouponRate, taxExempt: false },
    ],
    whtRate: settings.withholdingTax,
  });
  const taxBase = blendedNet.base;

  // ── Contribution plan + actual-vs-planned ───────────────────────────────────
  const overrideByMonth = new Map<number, number>();
  for (const o of mappedOverrides) {
    if (o.overrideAmount !== undefined) overrideByMonth.set(o.monthNumber, o.overrideAmount);
  }
  const points: ContributionPlanPoint[] = months.map((m) => {
    const planned = getScheduledContribution(m.monthNumber, {
      startingContribution: settings.startingContribution,
      stepUpAmount: settings.stepUpAmount,
      stepUpMonths: settings.stepUpMonths,
    });
    const actual = m.isActual ? round2(m.contribution ?? 0) : null;
    return { monthNumber: m.monthNumber, planned: round2(planned), actual };
  });
  const totalPlanned = round2(points.reduce((a, b) => a + b.planned, 0));
  const totalActual = round2(
    points.reduce((a, b) => a + (b.actual ?? 0), 0),
  );

  // ── Liquidity calendar (maturities + upcoming contributions) ────────────────
  const liquidity: LiquidityEvent[] = [];
  for (const s of securityRows) {
    if ((s as { isMatured?: boolean }).isMatured) continue;
    const md = (s as { maturityDate?: Date | string | null }).maturityDate;
    if (!md) continue;
    const ms = new Date(md as string | Date).getTime();
    if (!Number.isFinite(ms)) continue;
    const face = parseFloat(String((s as { faceValue?: unknown }).faceValue ?? "0")) || 0;
    liquidity.push({
      atMs: ms,
      kind: "maturity",
      label: `${String((s as { securityType?: string }).securityType ?? "security").toUpperCase()} matures`,
      amount: round2(face),
    });
  }
  liquidity.sort((a, b) => a.atMs - b.atMs);

  // ── Reconciliation (same inputs the dedicated procedure feeds) ──────────────
  const primaryMmfBalance = summary?.depositsContributed ?? 0;
  const secondaryMmfBalances = secondaryRows.map(
    (s) => parseFloat(String(s.currentBalance ?? "0")) || 0,
  );
  const bankHoldingPrincipals = bankRows
    .filter((b) => b.isActive)
    .map((b) => parseFloat(String(b.principal ?? "0")) || 0);
  const securityFaceValues = securityRows
    .filter((s) => !s.isMatured)
    .map((s) => parseFloat(String(s.faceValue ?? "0")) || 0);
  const otherAssetValues = otherRows.map(
    (h) =>
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
  const otherTotal = round2(Object.values(alloc.other).reduce((a, b) => a + b, 0));
  const lastActual = [...months].reverse().find((r) => r.isActual);
  const projectionTodayValue = lastActual
    ? lastActual.totalEnd - (lastActual.mmfEnd - primaryMmfBalance)
    : primaryMmfBalance +
      secondaryMmfBalances.reduce((a, b) => a + b, 0) +
      bankHoldingPrincipals.reduce((a, b) => a + b, 0) +
      securityFaceValues.reduce((a, b) => a + b, 0);
  const dashboardActualsTotal = summary?.totalContributed ?? 0;
  const recon = reconcile({
    primaryMmfBalance,
    secondaryMmfBalances,
    bankHoldingPrincipals,
    securityFaceValues,
    otherAssetValues,
    projectionTodayValue: round2(projectionTodayValue + otherTotal),
    dashboardActualsTotal: round2(dashboardActualsTotal + otherTotal),
    accrualLedgerMmfTotal:
      primaryMmfBalance + secondaryMmfBalances.reduce((a, b) => a + b, 0),
    dashboardNetWorth: round2(dashboardActualsTotal + otherTotal),
    portfolioReviewNetWorth: alloc.netWorth,
    taxSummaryBase: taxBase,
  });

  // ── Freshness warnings ──────────────────────────────────────────────────────
  const warnings: FreshnessWarning[] = [];
  if (!p.mmfFundId) {
    warnings.push({
      field: "mmfFund",
      message: "No primary MMF fund selected — the plan models a generic MMF.",
      severity: "warn",
    });
  }
  if (!p.ratesLastUpdatedAt) {
    warnings.push({
      field: "rates",
      message: "Reference rates have not been confirmed yet.",
      severity: "info",
    });
  }

  // ── Next actions (deep-links the command centre can surface) ────────────────
  const nextActions: NextAction[] = [];
  if (target > 0 && projectedFinalValue < target) {
    nextActions.push({
      id: "behind-plan",
      label: "Plan projects below target — review contributions or tier",
      href: "/plan?tab=scenarios",
    });
  }
  for (const row of allocationRows) {
    if (row.direction === "under" && row.gapPp <= -10) {
      nextActions.push({
        id: `under-${row.bucket}`,
        label: `Holdings are under the ${row.bucket} target — explore instruments`,
        href: `/research?tab=explore&class=${row.bucket}`,
      });
    }
  }

  return {
    identity: {
      portfolioId,
      name: p.name,
      purpose: p.description ?? null,
      isSandbox: !!p.isSandbox,
      allocationPolicy:
        ((p as { allocationPolicy?: string }).allocationPolicy ?? "balanced") as
          | "balanced"
          | "yield_first"
          | "custom",
      committedTier: (p.allocationSelectedTier ?? null) as string | null,
      tierOverridden: !!p.allocationTierOverridden,
      planCommittedAt: ((p as { planCommittedAt?: number | null }).planCommittedAt ?? null),
      planStatus: ((p as { planCommittedAt?: number | null }).planCommittedAt != null
        ? "committed"
        : "draft") as "committed" | "draft",
      // Plan-to-ledger contract: the tier the projection engine ACTUALLY executed
      // for this snapshot's ledger. Equals the selected tier only once committed;
      // before commit the engine runs the default path, surfaced here as
      // "balanced" so the UI/reconciliation can prove the ledger and the
      // Allocation-Plan selection agree (or flag a pending preview).
      activePolicyTier: ((p.planCommittedAt && p.allocationSelectedTier)
        ? (p.allocationSelectedTier as string)
        : "balanced") as string,
    },
    goal: {
      target,
      horizonMonths: horizon,
      elapsedMonths,
      horizonRemainingMonths,
      projectedFinalValue,
      netWorthNow: netWorth,
    },
    holdings: {
      netWorth,
      primaryMmf: round2(alloc.primaryMmf),
      secondaryMmf: round2(alloc.secondaryMmf),
      bank: round2(alloc.bank),
      tbill: round2(alloc.tbill),
      ifb: round2(alloc.ifb),
      fxd: round2(alloc.fxd),
      buckets: {
        cash: round2(actualBuckets.cash),
        gov: round2(actualBuckets.gov),
        equity: round2(actualBuckets.equity),
        reit: round2(actualBuckets.reit),
        offshore: round2(actualBuckets.offshore),
        other: round2(actualBuckets.other),
      },
      other: Object.fromEntries(
        Object.entries(alloc.other).map(([k, v]) => [k, round2(v)]),
      ),
    },
    allocation: {
      tier,
      timeRemainingFraction: trf,
      rows: allocationRows,
      isEmpty: gapReadout.isEmpty,
      caveat: gapReadout.caveat,
    },
    contributions: {
      startingContribution: round2(settings.startingContribution),
      stepUpAmount: round2(settings.stepUpAmount),
      stepUpMonths: settings.stepUpMonths,
      totalPlanned,
      totalActual,
      points,
    },
    ledger,
    income: {
      accruedNetInterest,
      blendedNetYieldPct: round2(blendedNet.netYield),
    },
    tax: {
      base: round2(taxBase),
      breakdown: summary?.taxBreakdown ?? {},
    },
    liquidity,
    reconciliation: {
      ok: recon.reconciled,
      reference: recon.reference,
      sources: recon.sources.map((s) => ({
        label: s.label,
        value: s.value,
        ok: Math.abs(s.value - recon.reference) <= 5 || s.key === "accrual",
      })),
    },
    warnings,
    nextActions,
    asOfMs,
  };
}
