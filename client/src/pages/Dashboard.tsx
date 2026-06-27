import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSimulatedNow } from "@/hooks/useSimulatedNow";
import { AppShell } from "@/components/AppShell";
import { SimulatedDateChip } from "@/components/SimulatedDateChip";
import { trpc } from "@/lib/trpc";
import { formatKES, formatKESCompact, formatPct, getPhaseName, getPhaseColorClass, formatRelativeTime, isReconcileStale } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Wallet,
  Landmark,
  Shield,
  ShieldCheck,
  Target,
  ArrowDownCircle,
  PiggyBank,
  Receipt,
  ArrowRight,
  HelpCircle,
  Pencil,
  Info,
  Clock,
  CalendarClock,
} from "lucide-react";
import { Link } from "wouter";
import { GlossaryTerm } from "@/components/GlossaryTerm";
import { useDepositDrawer } from "@/contexts/DepositDrawerContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { CreatePortfolioDialog } from "@/components/PortfolioSelector";
import { MaturityTimeline } from "@/components/MaturityTimeline";
import { Plus, Compass, ArrowUpRight } from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { rateStaleness } from "@/lib/rateStaleness";
import { currentSecurityValue, classifyDurationRisk, largestConcentration, classifyConcentration, analyzePerTypeBreach, isConcentrationSnoozed, DEFAULT_LIQUIDITY_HORIZON_DAYS, type CurrentValueSecurity } from "@shared/discount";
import { whtRateForSecurity } from "@shared/securityTenor";
import { Layers, TrendingDown, BellOff, Bell, Scale, ArrowRightLeft, Copy, Check } from "lucide-react";
import { buildTransferPlan, SNOOZE_OPTIONS, snoozeUntilFromDays } from "@shared/liquidAllocator";
import { Sparkline } from "@/components/Sparkline";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accent = false,
  tooltip,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  accent?: boolean;
  tooltip?: string;
}) {
  return (
    <Card className={`card-hover ${accent ? "border-primary/30 gold-glow" : ""}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
              {tooltip && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-muted-foreground/60 cursor-help shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {tooltip}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <p className={`text-2xl font-bold kes-amount ${accent ? "gradient-text" : "text-foreground"}`}>
              {value}
            </p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ml-3 ${accent ? "bg-primary/15" : "bg-muted"}`}>
            <Icon className={`w-5 h-5 ${accent ? "text-primary" : "text-muted-foreground"}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-2">Month {label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground kes-amount">{formatKES(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// R70.2 — stable color palette for the projected end-state split bar/legend.
const END_STATE_SPLIT_COLORS = [
  "#34d399", // emerald-400
  "#60a5fa", // blue-400
  "#fbbf24", // amber-400
  "#a78bfa", // violet-400
  "#f472b6", // pink-400
  "#22d3ee", // cyan-400
];

export default function Dashboard() {
  const { portfolioId, portfolio, portfolios, mode, isLoading: portfoliosLoading } = usePortfolio();
  // R75 — the app's effective "now": the Time Machine's simulated date when a
  // sandbox session is active, else the real clock. Threading this into every
  // client-side security valuation keeps these cards in lock-step with the
  // server's reconciliation (which uses getNow), so no client/server drift.
  const { simulatedDate } = useSimulatedNow();
  const effectiveNowMs = simulatedDate ?? Date.now();
  const [createOpen, setCreateOpen] = useState(false);
  const utils = trpc.useUtils();
  const { data: projection, isLoading: projLoading } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: milestones } = trpc.projection.milestones.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: endStateSplit } = trpc.projection.endStateLiquidSplit.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
    const { data: actualsSummary } = trpc.deposits.summary.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: settings } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: secondaryMmfs = [] } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const secondaryMmfTotal = secondaryMmfs.reduce((sum, s) => sum + s.currentBalance, 0);
  const { data: bankHoldings = [] } = trpc.bankHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: concentration } = trpc.bankHoldings.concentration.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: securities = [] } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // Round 62: liquid-reserve diversification split (primary MMF + secondary MMFs
  // + liquid bank instruments), spread to keep each issuer under its cap.
  const { data: liquidAlloc } = trpc.bankHoldings.liquidAllocation.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // R63 — concrete transfer plan derived from the recommended split.
  const transferPlan = useMemo(
    () => (liquidAlloc ? buildTransferPlan(liquidAlloc) : []),
    [liquidAlloc],
  );
  // R64 — per-home balance reconcile (actual vs target drift).
  const [reconcileHome, setReconcileHome] = useState<
    { id: string; label: string; current: number } | null
  >(null);
  const [reconcileValue, setReconcileValue] = useState("");
  // R65 — "Reconcile all" quick-entry: a map of homeId → input value string.
  const [reconcileAllOpen, setReconcileAllOpen] = useState(false);
  const [reconcileAllValues, setReconcileAllValues] = useState<Record<string, string>>({});
  const setLiquidBalanceMutation = trpc.bankHoldings.setLiquidBalance.useMutation({
    onSuccess: () => {
      toast.success("Balance recorded");
      utils.bankHoldings.liquidAllocation.invalidate({ portfolioId: portfolioId! });
      setReconcileHome(null);
    },
    onError: (e) => toast.error(e.message || "Could not save balance"),
  });
  const clearLiquidBalanceMutation = trpc.bankHoldings.clearLiquidBalance.useMutation({
    onSuccess: () => {
      toast.success("Reverted to estimated balance");
      utils.bankHoldings.liquidAllocation.invalidate({ portfolioId: portfolioId! });
      setReconcileHome(null);
    },
    onError: (e) => toast.error(e.message || "Could not clear balance"),
  });
  const setLiquidBalancesBulkMutation = trpc.bankHoldings.setLiquidBalancesBulk.useMutation({
    onSuccess: (r) => {
      toast.success(`Reconciled ${r.count} home${r.count === 1 ? "" : "s"}`);
      utils.bankHoldings.liquidAllocation.invalidate({ portfolioId: portfolioId! });
      setReconcileAllOpen(false);
    },
    onError: (e) => toast.error(e.message || "Could not save balances"),
  });
  const recordAppliedTransfersMutation = trpc.bankHoldings.recordAppliedTransfers.useMutation({
    onError: (e) => toast.error(e.message || "Could not log transfers"),
  });
  // R67 — drift-history sparkline + snooze the drift-rebalancing alert.
  const { data: driftHistory } = trpc.bankHoldings.driftHistory.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId },
  );
  const snoozeDriftMutation = trpc.bankHoldings.snoozeDrift.useMutation({
    onSuccess: (_r, vars) => {
      toast.success(vars.until ? "Drift alert snoozed" : "Drift alert resumed");
      utils.bankHoldings.liquidAllocation.invalidate({ portfolioId: portfolioId! });
    },
    onError: (e) => toast.error(e.message || "Could not update snooze"),
  });
  const snoozeDrift = (days: number | null) => {
    if (!portfolioId) return;
    snoozeDriftMutation.mutate({
      portfolioId,
      until: snoozeUntilFromDays(days),
    });
  };
  // R68 — switch drift-breach notifications between immediate pings and a daily digest.
  const setDriftDigestMutation = trpc.bankHoldings.setDriftDigest.useMutation({
    onSuccess: (r) => {
      toast.success(
        r.mode === "digest"
          ? "Daily drift digest enabled"
          : "Switched to immediate drift alerts",
      );
      utils.bankHoldings.liquidAllocation.invalidate({ portfolioId: portfolioId! });
    },
    onError: (e) => toast.error(e.message || "Could not update notification mode"),
  });
  const setDriftDigest = (mode: "immediate" | "digest") => {
    if (!portfolioId) return;
    setDriftDigestMutation.mutate({ portfolioId, mode });
  };
  const updatePortfolioMutation = trpc.portfolios.update.useMutation({
    onSuccess: () => {
      toast.success("Target updated — projection recalculated");
      utils.portfolios.list.invalidate();
      utils.projection.run.invalidate({ portfolioId: portfolioId! });
      utils.projection.milestones.invalidate({ portfolioId: portfolioId! });
      utils.deposits.summary.invalidate({ portfolioId: portfolioId! });
      setTargetDialogOpen(false);
    },
    onError: () => toast.error("Failed to update target"),
  });

  const { openDrawer } = useDepositDrawer();
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  function openTargetDialog() {
    setTargetInput(String(Number(portfolio?.targetAmount) || 0));
    setTargetDialogOpen(true);
  }

  function saveTarget() {
    if (!portfolioId || !portfolio) return;
    const val = parseFloat(targetInput.replace(/,/g, ""));
    if (!val || val < 100000) {
      toast.error("Please enter a valid target end value (minimum KES 100,000)");
      return;
    }
    if (!portfolio) return;
    updatePortfolioMutation.mutate({
      portfolioId,
      name: portfolio.name,
      targetAmount: val,
      startDate: String(portfolio.startDate).split("T")[0],
      horizonMonths: portfolio.horizonMonths,
      startingContribution: Number(portfolio.startingContribution),
      stepUpAmount: Number(portfolio.stepUpAmount),
      stepUpMonths: portfolio.stepUpMonths,
      safetyFloor: Number(portfolio.safetyFloor),
    });
  }

  const { fundName, fundLabel, fundEar } = useSelectedFund();
  const targetAmount = Number(portfolio?.targetAmount) || 0;
  const horizonMonths = portfolio?.horizonMonths ?? 0;
  const horizonYears = Math.round((horizonMonths / 12) * 10) / 10;
  const horizonYearsLabel = Number.isInteger(horizonYears) ? `${horizonYears}` : horizonYears.toFixed(1);
  // Year gridlines/ticks derived from the actual horizon (every 12 months, plus the final month).
  const yearLabels = useMemo(() => {
    const labels: number[] = [];
    for (let m = 12; m <= horizonMonths; m += 12) labels.push(m);
    if (labels[labels.length - 1] !== horizonMonths) labels.push(horizonMonths);
    return labels;
  }, [horizonMonths]);
  const lastData = projection?.length ? projection[projection.length - 1] : undefined;
  const currentMonth = 1;
  const currentData = projection?.[currentMonth - 1];

  // "Today" per the projection engine = the ending total of the last month the
  // engine seeded from real deposits (isActual). If there are no actuals yet,
  // there is no engine "today" value to reconcile against.
  const projectionToday = useMemo(() => {
    if (!projection?.length) return null as number | null;
    let last: number | null = null;
    for (const r of projection) {
      if (r.isActual) last = r.totalEnd;
    }
    return last;
  }, [projection]);

  // Deep-link: when arriving via the sidebar drift badge (/?reconcile=1), scroll
  // the reconciliation card into view and flash a brief highlight, then strip the
  // query param so a refresh doesn't re-trigger it.
  const reconcileRef = useRef<HTMLDivElement | null>(null);
  const [reconcileFlash, setReconcileFlash] = useState(false);

  // R48: Holdings-by-Instrument card can show face value or current (accreted /
  // par + accrued) value of active securities.
  const [holdingsBasis, setHoldingsBasis] = useState<"face" | "current">("face");
  // R49 — Maturity Calendar time-window filter (days, or "all").
  const [maturityWindow, setMaturityWindow] = useState<30 | 90 | 365 | "all">("all");
  // R63 — "Apply this split" dialog showing the prefilled transfer plan.
  const [splitOpen, setSplitOpen] = useState(false);
  // R64 — per-transfer "mark as done" tracking (dialog-local, by transfer key).
  const [doneTransfers, setDoneTransfers] = useState<Set<string>>(new Set());
  const toggleTransferDone = (key: string) =>
    setDoneTransfers((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reconcile") !== "1") return;
    const timer = window.setTimeout(() => {
      reconcileRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setReconcileFlash(true);
      window.setTimeout(() => setReconcileFlash(false), 2200);
    }, 300);
    // Clean the param without adding a history entry.
    window.history.replaceState({}, "", window.location.pathname);
    return () => window.clearTimeout(timer);
  }, []);

  const projectedFinalValue = lastData?.totalEnd ?? 0;
  const progressPct = targetAmount > 0 ? Math.min((projectedFinalValue / targetAmount) * 100, 100) : 0;
  const surplusOrShortfall = projectedFinalValue - targetAmount;
  const willHitTarget = projectedFinalValue >= targetAmount;

  // ── End-state liquidity at the goal date (Fix #1 UI) ──
  // Liquid = cash-equivalent at the horizon: primary MMF + secondary MMFs +
  // bank balances (call deposits are liquid). Locked = CBK securities still
  // held at the final month (these only exist if a tenor fits before the goal).
  const liquidAtGoal =
    (lastData?.mmfEnd ?? 0) + (lastData?.secondaryMmfEnd ?? 0) + (lastData?.bankEnd ?? 0);
  const lockedAtGoal =
    (lastData?.tbillEnd ?? 0) + (lastData?.ifbEnd ?? 0) + (lastData?.fxdEnd ?? 0);
  const liquidPctAtGoal =
    projectedFinalValue > 0 ? (liquidAtGoal / projectedFinalValue) * 100 : 100;
  // "Fully liquid" if <0.5% is locked in securities maturing past the goal.
  const landsFullyLiquid = lockedAtGoal < projectedFinalValue * 0.005;

  // R69.3 — describe HOW the projected liquid end-state is spread, per the
  // active allocation policy (Balanced/Custom diversify; Yield-first may
  // concentrate), matching the liquid-reserve allocator instead of assuming
  // everything lands in the primary MMF.
  const endStateLiquidCopy = useMemo(() => {
    if (!endStateSplit || endStateSplit.liquidPot <= 0) return null;
    const policyLabel =
      endStateSplit.allocationPolicy === "yield_first"
        ? "Yield-first"
        : endStateSplit.allocationPolicy === "custom"
          ? "Custom"
          : "Balanced";
    const funded = endStateSplit.slices;
    if (funded.length === 0) return null;
    // Single home: either only one eligible account, or policy concentrated it.
    if (!endStateSplit.isSplit || funded.length === 1) {
      const only = funded[0];
      if (endStateSplit.homeCount <= 1) {
        // One-home nudge — encourage adding a second liquid account.
        return {
          tone: "nudge" as const,
          text: `spread can't diversify yet — it all sits in ${only.label}. Add a second liquid account (MMF or call deposit) to split it under your ${(endStateSplit.effectiveIssuerCapFrac * 100).toFixed(0)}% issuer cap.`,
        };
      }
      if (endStateSplit.allocationPolicy === "yield_first") {
        return {
          tone: "ok" as const,
          text: `concentrated in ${only.label} (net ${only.netYieldPct.toFixed(2)}%) — your Yield-first policy is intentionally chasing the top net yield.`,
        };
      }
      return {
        tone: "ok" as const,
        text: `held in ${only.label}, within your ${(endStateSplit.effectiveIssuerCapFrac * 100).toFixed(0)}% issuer cap.`,
      };
    }
    // Genuine multi-home split.
    const names = funded
      .slice(0, 3)
      .map((s) => `${s.label} (${(s.targetShare * 100).toFixed(0)}%)`)
      .join(", ");
    const extra = funded.length > 3 ? ` +${funded.length - 3} more` : "";
    return {
      tone: "ok" as const,
      text: `spread across ${names}${extra} per your ${policyLabel} policy, each within your ${(endStateSplit.effectiveIssuerCapFrac * 100).toFixed(0)}% issuer cap.`,
    };
  }, [endStateSplit]);

  const chartData = useMemo(() => {
    if (!projection) return [];
    return projection.map((r) => ({
      month: r.monthNumber,
      total: r.totalEnd,
      mmf: r.mmfEnd,
      tbill: r.tbillEnd,
      ifb: r.ifbEnd,
      fxd: r.fxdEnd,
      bank: r.bankEnd ?? 0,
    }));
  }, [projection]);

  // Whether this portfolio holds any bank instrument (call/fixed deposit). Bank
  // deposits are user-recorded actuals, so the band/card only appear when present.
  const usesBankInstruments = useMemo(
    () => !!projection?.some((r) => (r.bankEnd ?? 0) > 0),
    [projection]
  );

  // Whether this plan ever holds government securities (T-bills / IFB / FXD).
  // Short-horizon or MMF-only plans never do, so we avoid claiming "CBK securities".
  const usesGovSecurities = useMemo(
    () => !!projection?.some((r) => r.tbillEnd > 0 || r.ifbEnd > 0 || r.fxdEnd > 0),
    [projection]
  );
  const strategyDescriptor = usesGovSecurities ? `${fundLabel} + CBK securities` : fundLabel;

  // Phase legend derived from the actual projection so band ranges match this
  // portfolio's horizon and phase fractions (not a hardcoded 120-month layout).
  const phaseLegend = useMemo(() => {
    if (!projection?.length) return [] as { label: string; start: number; end: number; color: string }[];
    const colorFor: Record<string, string> = {
      foundation: "oklch(0.65 0.15 200 / 0.5)",
      growth: "oklch(0.70 0.12 160 / 0.5)",
      "de-risking": "oklch(0.78 0.14 85 / 0.5)",
      derisking: "oklch(0.78 0.14 85 / 0.5)",
      "final-liquidity": "oklch(0.65 0.15 280 / 0.5)",
      liquidity: "oklch(0.65 0.15 280 / 0.5)",
    };
    const bands: { label: string; start: number; end: number; color: string }[] = [];
    for (const r of projection) {
      const label = getPhaseName(r.phase);
      const last = bands[bands.length - 1];
      if (last && last.label === label) {
        last.end = r.monthNumber;
      } else {
        bands.push({ label, start: r.monthNumber, end: r.monthNumber, color: colorFor[r.phase] ?? "oklch(0.65 0.15 200 / 0.5)" });
      }
    }
    return bands;
  }, [projection]);

  const currentPhase = currentData ? currentData.phase : "foundation";

  // R50 — portfolio-level valuation across ALL active CBK lots: total current
  // (mark-to-model) value, total face (redemption) value, total cost basis, and
  // overall unrealized gain. Cost basis = purchase price for discount lots
  // (T-bills / zero-coupon) and par (face) for coupon bonds bought at par.
  const portfolioValuation = useMemo(() => {
    const rows = (securities as Array<Record<string, unknown>>) ?? [];
    const now = effectiveNowMs;
    const nowDate = new Date(now);
    const DAY = 1000 * 60 * 60 * 24;
    let totalFace = 0;
    let totalCurrent = 0;
    let totalCost = 0;
    let lots = 0;
    // Weighted-average days-to-maturity: weight each lot's remaining days by its
    // current value. Value-weighted simple YTM: annualize each lot's remaining
    // gain (face - current) over its remaining life, weighted by current value.
    let dtmWeight = 0; // sum of current values used as DTM weight
    let dtmWeighted = 0; // sum of (days * currentValue)
    let ytmWeighted = 0; // sum of (annualizedYield * currentValue)
    for (const s of rows) {
      if (s?.isMatured) continue;
      const face = parseFloat(String(s?.faceValue ?? "0")) || 0;
      if (face <= 0) continue;
      const t = String(s?.securityType ?? "");
      const price = parseFloat(String(s?.purchasePrice ?? ""));
      const hasPrice = Number.isFinite(price) && price > 0;
      let current = face;
      if (s?.issueDate && s?.maturityDate) {
        current = currentSecurityValue({
          securityType: t,
          faceValue: face,
          purchasePrice: hasPrice ? price : null,
          couponRate: parseFloat(String(s?.couponRate ?? "0")) || 0,
          issueDate: String(s.issueDate),
          maturityDate: String(s.maturityDate),
          isMatured: Boolean(s?.isMatured),
          whtRatePct: whtRateForSecurity(
            t as never,
            parseFloat(String(s?.tenorYears ?? "")) || null,
          ),
        }, nowDate);
      }
      // Cost basis: discount lots use their purchase price; coupon bonds bought
      // at par use face. Fall back to face when no price is recorded.
      const cost = hasPrice ? price : face;
      totalFace += face;
      totalCurrent += current;
      totalCost += cost;
      lots += 1;

      if (s?.maturityDate) {
        const mt = new Date(String(s.maturityDate)).getTime();
        const days = Math.max(0, Math.round((mt - now) / DAY));
        if (current > 0) {
          dtmWeight += current;
          dtmWeighted += days * current;
          // Simple annualized yield-to-maturity from today's value to face.
          if (days > 0 && current > 0) {
            const periodReturn = (face - current) / current;
            const annualized = periodReturn * (365 / days);
            ytmWeighted += annualized * current;
          }
        }
      }
    }
    const unrealizedGain = totalCurrent - totalCost;
    const gainPct = totalCost > 0 ? (unrealizedGain / totalCost) * 100 : 0;
    const wAvgDays = dtmWeight > 0 ? Math.round(dtmWeighted / dtmWeight) : 0;
    const wAvgYtmPct = dtmWeight > 0 ? (ytmWeighted / dtmWeight) * 100 : 0;
    return {
      totalFace,
      totalCurrent,
      totalCost,
      unrealizedGain,
      gainPct,
      lots,
      wAvgDays,
      wAvgYtmPct,
    };
  }, [securities, effectiveNowMs]);

  // R58 — per-instrument-type concentration of the active register, surfaced as a
  // one-line snapshot on the Avg. Maturity tile. Uses the shared helper so the
  // figure matches the Portfolio Review risk snapshot exactly.
  const typeConcentration = useMemo(() => {
    const now = new Date(effectiveNowMs);
    const lots = (securities ?? []).filter(
      (s: Record<string, unknown>) =>
        !(s.isMatured as boolean) && Number(s.faceValue ?? 0) > 0,
    ) as unknown as CurrentValueSecurity[];
    return largestConcentration(lots, now);
  }, [securities, effectiveNowMs]);
  const typeCapPct = portfolio?.typeConcentrationCapPct ?? 60;
  const typeConcentrationBreached = typeConcentration
    ? classifyConcentration(typeConcentration.topShare, typeCapPct) === "breached"
    : false;

  // R69.2 — maturity-aware per-type breach for the Dashboard warning card. The
  // per-type cap is a duration/liquidity guardrail (single sovereign issuer), so a
  // breach from held, un-matured lots self-corrects as they mature. We surface
  // when it clears and whether an early-sale option is even warranted, and (like
  // the per-issuer card) offer an Acknowledge action that logs to Change History.
  const typeBreach = useMemo(() => {
    const lots = (securities ?? []).filter(
      (s: Record<string, unknown>) =>
        !(s.isMatured as boolean) && Number(s.faceValue ?? 0) > 0,
    ) as unknown as CurrentValueSecurity[];
    if (lots.length === 0) return null;
    const nw = concentration?.netWorth ?? 0;
    let horizonEndMs: number | null = null;
    if (portfolio?.startDate && portfolio?.horizonMonths) {
      const start = new Date(portfolio.startDate as unknown as string);
      if (!Number.isNaN(start.getTime())) {
        const end = new Date(start);
        end.setMonth(end.getMonth() + Number(portfolio.horizonMonths));
        horizonEndMs = end.getTime();
      }
    }
    return analyzePerTypeBreach(lots, typeCapPct, nw, horizonEndMs, new Date(effectiveNowMs));
  }, [securities, typeCapPct, concentration?.netWorth, portfolio?.startDate, portfolio?.horizonMonths, effectiveNowMs]);

  const fmtBreachDate = (ms: number) =>
    new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  // R60 — concentration-warning snooze. When the portfolio carries a future
  // snooze timestamp, the per-issuer warning banner is muted and the Risk-limits
  // cards show an "un-snooze" affordance. Re-evaluated each render against now.
  const snoozeUntil = portfolio?.concentrationSnoozeUntil ?? null;
  const concentrationSnoozed = isConcentrationSnoozed(snoozeUntil);
  const snoozeMutation = trpc.portfolios.snoozeConcentration.useMutation({
    onSuccess: () => {
      utils.portfolios.list.invalidate();
      if (portfolioId) utils.portfolios.get.invalidate({ portfolioId });
    },
  });
  const applySnooze = (days: number | null) => {
    if (!portfolioId) return;
    const until = days == null ? null : Date.now() + days * 24 * 60 * 60 * 1000;
    snoozeMutation.mutate({ portfolioId, until });
    toast.success(days == null ? "Concentration warnings un-snoozed" : `Concentration warnings snoozed for ${days} days`);
  };

  // ── Round 62: acknowledge an ACTUAL (real-money) per-issuer cap breach ──────
  // Logs the acceptance to Change History, then snoozes the banner so it stops
  // nagging until a NEW breach appears or the snooze is cleared. This only ever
  // surfaces for recorded holdings (the concentration query is built from real
  // bank holdings), never from projected sweeps.
  const recordBreachAckMutation = trpc.portfolios.recordBreachAck.useMutation();
  const acknowledgeIssuerBreach = async () => {
    if (!portfolioId || !concentration || concentration.breaches.length === 0) return;
    const top = concentration.breaches.reduce((a, b) => (b.share > a.share ? b : a));
    try {
      await recordBreachAckMutation.mutateAsync({
        portfolioId,
        capKind: "issuer",
        label: top.issuer,
        sharePct: top.share * 100,
        capPct: concentration.cap * 100,
      });
      // Snooze for a long window (1 year) — the user has accepted this breach.
      snoozeMutation.mutate({ portfolioId, until: Date.now() + 365 * 24 * 60 * 60 * 1000 });
      toast.success("Breach acknowledged and logged to Change History");
    } catch {
      toast.error("Could not record acknowledgment");
    }
  };

  // ── R69.2: acknowledge an ACTUAL per-instrument-type cap breach ──────────────
  // Parity with the per-issuer flow above: logs acceptance to Change History (as
  // capKind "type") and snoozes the per-type warning card so it stops nagging
  // until a new breach appears or the snooze is cleared.
  const acknowledgeTypeBreach = async () => {
    if (!portfolioId || !typeConcentration || !typeBreach || !typeBreach.breached) return;
    try {
      await recordBreachAckMutation.mutateAsync({
        portfolioId,
        capKind: "type",
        label: typeConcentration.topLabel,
        sharePct: typeBreach.shareOfSecurities * 100,
        capPct: typeCapPct,
      });
      snoozeMutation.mutate({ portfolioId, until: Date.now() + 365 * 24 * 60 * 60 * 1000 });
      toast.success("Breach acknowledged and logged to Change History");
    } catch {
      toast.error("Could not record acknowledgment");
    }
  };

  // ── Onboarding empty state: authenticated but no portfolios yet ──────────
  if (!portfoliosLoading && portfolios.length === 0) {
    return (
      <AppShell>
        <div className="min-h-[70vh] flex items-center justify-center p-6">
          <div className="max-w-lg text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-5">
              <Compass className="w-8 h-8 text-primary" />
            </div>
            <h1
              className="text-2xl font-bold text-foreground mb-2"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Create your first portfolio
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              A portfolio is a single savings goal — its own target amount, time horizon,
              monthly contribution, and Money Market Fund. Once you create one, the dashboard
              will project your journey month by month and track your real deposits against it.
            </p>
            <Button
              size="lg"
              className="font-semibold"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Create a portfolio
            </Button>
            <p className="text-xs text-muted-foreground mt-6">
              New to fixed-income investing in Kenya?{" "}
              <Link href="/getting-started">
                <span className="text-primary underline cursor-pointer">Read the Getting Started guide</span>
              </Link>
              .
            </p>
          </div>
        </div>
        <CreatePortfolioDialog open={createOpen} onOpenChange={setCreateOpen} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <TooltipProvider delayDuration={150}>
      <div className="p-6 lg:p-8 space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              Investment Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {horizonYearsLabel}-year journey to {formatKES(targetAmount)} · {strategyDescriptor}
            </p>
            <SimulatedDateChip className="mt-2" />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <Button
              onClick={openDrawer}
              size="lg"
              className="font-semibold shadow-lg shadow-primary/20 bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-transform"
            >
              <ArrowDownCircle className="w-4 h-4 mr-2" />
              Record a Deposit
              <span className="ml-2 inline-flex items-center rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                Live
              </span>
            </Button>
            <Badge variant="outline" className={`text-xs px-3 py-1 border ${getPhaseColorClass(currentPhase)}`}>
              {getPhaseName(currentPhase)} Phase
            </Badge>
          </div>
        </div>

        {/* ── R50/R51: Securities portfolio summary (current vs face vs gain) ── */}
        {portfolioValuation.lots > 0 && (() => {
          const v = portfolioValuation;
          const positive = v.unrealizedGain >= 0;
          const GainIcon = positive ? TrendingUp : TrendingDown;
          // R51 — Face → Current delta bar. Fraction of total face already
          // realised as current value (how close the book sits to redemption).
          const facePct = v.totalFace > 0 ? Math.min(1, Math.max(0, v.totalCurrent / v.totalFace)) : 0;
          // Friendly weighted-avg days-to-maturity label.
          const d = v.wAvgDays;
          const dtmLabel =
            d >= 365 ? `${(d / 365).toFixed(1)} yr` : d >= 30 ? `${Math.round(d / 30)} mo` : `${d} d`;
          // R52 — duration-risk hint: colour-code the Avg. Maturity tile when the
          // value-weighted DTM approaches / exceeds the liquidity horizon (1 yr).
          const horizonDays = settings?.liquidityHorizonDays ?? DEFAULT_LIQUIDITY_HORIZON_DAYS;
          const risk = classifyDurationRisk(v.wAvgDays, horizonDays);
          const horizonLabel = horizonDays % 365 === 0 ? `${horizonDays / 365}yr` : horizonDays % 30 === 0 ? `${horizonDays / 30}mo` : `${horizonDays}d`;
          const riskMeta = {
            low: { label: "Low duration risk", icon: ShieldCheck, color: "text-emerald-400", value: "text-foreground", iconColor: "text-emerald-400" },
            moderate: { label: "Moderate duration risk", icon: Shield, color: "text-amber-400", value: "text-amber-300", iconColor: "text-amber-400" },
            elevated: { label: `Elevated — locked beyond ${horizonLabel} horizon`, icon: AlertTriangle, color: "text-red-400", value: "text-red-400", iconColor: "text-red-400" },
          }[risk];
          const RiskIcon = riskMeta.icon;
          // R52 — "as of" timestamp so the mark-to-model figures are clearly dated.
          const asOf = new Date().toLocaleString(undefined, {
            dateStyle: "medium",
            timeStyle: "short",
          });
          return (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <TrendingUp className="w-4 h-4 text-sky-400 shrink-0" />
                    <p className="text-[11px] font-medium uppercase tracking-widest">Total Current Value</p>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-sky-300 kes-amount">{formatKES(v.totalCurrent)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Mark-to-model value of {v.lots} active {v.lots === 1 ? "lot" : "lots"} today
                  </p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Layers className="w-4 h-4 text-primary shrink-0" />
                    <p className="text-[11px] font-medium uppercase tracking-widest">Total Face Value</p>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-foreground kes-amount">{formatKES(v.totalFace)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Redemption value paid out at maturity
                  </p>
                </div>
                <Link
                  href="/securities?sort=gain"
                  className="group rounded-xl border border-white/10 bg-white/[0.02] p-4 transition-colors hover:bg-white/[0.05] hover:border-white/20"
                >
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <GainIcon className={cn("w-4 h-4 shrink-0", positive ? "text-emerald-400" : "text-red-400")} />
                    <p className="text-[11px] font-medium uppercase tracking-widest">Unrealized Gain</p>
                    <ArrowUpRight className="w-3.5 h-3.5 ml-auto text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                  </div>
                  <p className={cn("mt-2 text-2xl font-bold kes-amount", positive ? "text-emerald-400" : "text-red-400")}>
                    {positive ? "+" : "−"}{formatKES(Math.abs(v.unrealizedGain))}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {positive ? "+" : "−"}{Math.abs(v.gainPct).toFixed(2)}% vs cost basis ({formatKESCompact(v.totalCost)})
                  </p>
                </Link>
                {(() => {
                  // R57 — when duration risk is "elevated", make the tile a deep-link
                  // to the Portfolio Review page (where the full risk snapshot,
                  // liquidity calendar and concentration line live). Lower-risk
                  // states stay as a plain, non-interactive tile.
                  const isElevated = risk === "elevated";
                  const tileBody = (
                    <>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <CalendarClock className={cn("w-4 h-4 shrink-0", riskMeta.iconColor)} />
                        <p className="text-[11px] font-medium uppercase tracking-widest">Avg. Maturity</p>
                        {/* R61 — surface the snoozed state at the top of the dashboard,
                            not only in the Risk-limits panel, so a muted warning is
                            never silently forgotten. */}
                        {concentrationSnoozed && (
                          <span
                            className="inline-flex items-center gap-0.5 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground"
                            title={snoozeUntil != null ? `Concentration warnings snoozed until ${new Date(snoozeUntil).toLocaleDateString()}` : "Concentration warnings snoozed"}
                          >
                            <BellOff className="w-2.5 h-2.5" /> Snoozed
                          </span>
                        )}
                        {isElevated && (
                          <ArrowUpRight className={cn("w-3.5 h-3.5 text-muted-foreground/50 transition-colors group-hover:text-foreground", concentrationSnoozed ? "" : "ml-auto")} />
                        )}
                      </div>
                      <p className={cn("mt-2 text-2xl font-bold kes-amount", riskMeta.value)}>{dtmLabel}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {v.wAvgDays} days weighted · {v.wAvgYtmPct >= 0 ? "" : "−"}{Math.abs(v.wAvgYtmPct).toFixed(2)}% YTM
                      </p>
                      <p className={cn("text-[11px] mt-1.5 flex items-center gap-1 font-medium", riskMeta.color)}>
                        <RiskIcon className="w-3 h-3 shrink-0" /> {riskMeta.label}
                      </p>
                      {/* R58 — concentration snapshot, visible without leaving the
                          dashboard. Turns red when the dominant type breaches the
                          configured cap (Rate Settings). */}
                      {typeConcentration && (
                        <p className={cn(
                          "text-[11px] mt-1 flex items-center gap-1",
                          typeConcentrationBreached ? "text-red-400 font-medium" : "text-muted-foreground",
                        )}>
                          <Layers className="w-3 h-3 shrink-0" />
                          {typeConcentration.topShare >= 0.999 ? (
                            <>100% {typeConcentration.topLabel}</>
                          ) : (
                            <>{(typeConcentration.topShare * 100).toFixed(0)}% in {typeConcentration.topLabel}</>
                          )}
                          {typeConcentrationBreached && <> · over {typeCapPct.toFixed(0)}% cap</>}
                        </p>
                      )}
                      {isElevated && (
                        <p className="text-[10px] text-red-400/80 mt-1">Review liquidity &rarr;</p>
                      )}
                    </>
                  );
                  const borderCls = risk === "elevated" ? "border-red-500/30" : risk === "moderate" ? "border-amber-500/30" : "border-white/10";
                  return isElevated ? (
                    <Link
                      href="/portfolio-review"
                      className={cn("group rounded-xl border bg-white/[0.02] p-4 transition-colors hover:bg-red-500/[0.06] hover:border-red-500/50", borderCls)}
                    >
                      {tileBody}
                    </Link>
                  ) : (
                    <div className={cn("rounded-xl border bg-white/[0.02] p-4", borderCls)}>
                      {tileBody}
                    </div>
                  );
                })()}
              </div>
              {/* R51 — Face → Current delta bar (book progress toward redemption). */}
              <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1.5">
                  <span>Current value vs face</span>
                  <span className="tabular-nums">{(facePct * 100).toFixed(1)}% of face · {formatKESCompact(v.totalFace - v.totalCurrent)} to accrue</span>
                </div>
                <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-[width] duration-500"
                    style={{ width: `${facePct * 100}%` }}
                    title={`${formatKES(v.totalCurrent)} current of ${formatKES(v.totalFace)} face`}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground/70 mt-2 text-right">
                  Mark-to-model values as of {asOf}
                </p>
              </div>
            </div>
          );
        })()}

        {/* ── R59: Risk limits mini-panel — surfaces the per-issuer (KDIC) and
            per-type caps together with current-vs-cap status. ──────────── */}
        {(concentration || typeConcentration) && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  Risk limits
                </CardTitle>
                {/* R60: snooze / un-snooze concentration warnings. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/50 transition-colors"
                      title={concentrationSnoozed ? "Warnings are snoozed" : "Snooze concentration warnings"}
                    >
                      {concentrationSnoozed ? <BellOff className="w-3 h-3" /> : <Bell className="w-3 h-3" />}
                      {concentrationSnoozed ? "Snoozed" : "Snooze"}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => applySnooze(7)}>Snooze 7 days</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => applySnooze(30)}>Snooze 30 days</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => applySnooze(90)}>Snooze 90 days</DropdownMenuItem>
                    {concentrationSnoozed && (
                      <DropdownMenuItem onClick={() => applySnooze(null)}>Un-snooze now</DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {concentrationSnoozed && snoozeUntil != null && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Warnings snoozed until {new Date(snoozeUntil).toLocaleDateString()}.
                </p>
              )}
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {/* Per-issuer (KDIC) limit */}
              {(() => {
                const issuerBreached = !!concentration && concentration.breaches.length > 0;
                const issuerCapPct = concentration ? Math.round(concentration.cap * 100) : 25;
                return (
                  <Link
                    href="/deposits"
                    className={`group rounded-lg border p-3 transition-colors ${issuerBreached ? "border-red-500/40 bg-red-500/5 hover:bg-red-500/10" : "border-border bg-card hover:bg-muted/40"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Per-issuer cap (KDIC)</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{issuerCapPct}% cap</span>
                    </div>
                    <p className={`mt-1 text-sm font-semibold ${issuerBreached ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
                      {issuerBreached
                        ? `${concentration!.breaches.length} ${concentration!.breaches.length === 1 ? "issuer" : "issuers"} over cap`
                        : "Within cap"}
                    </p>
                    {/* R60: share-vs-cap progress bar. Width = share as a % of
                        net worth; the cap tick marks the {issuerCapPct}% limit. */}
                    <div className="mt-2 relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${issuerBreached ? "bg-red-500" : "bg-primary"}`}
                        style={{ width: `${Math.min(100, Math.round((concentration?.topShare ?? 0) * 100))}%` }}
                      />
                    </div>
                    <div className="relative h-2">
                      <span
                        className="absolute top-0 -translate-x-1/2 h-2 w-px bg-foreground/40"
                        style={{ left: `${Math.min(100, issuerCapPct)}%` }}
                        aria-hidden
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      No single bank above {issuerCapPct}% of net worth.
                    </p>
                  </Link>
                );
              })()}
              {/* Per-instrument-type limit */}
              {(() => {
                const topPct = typeConcentration ? Math.round(typeConcentration.topShare * 100) : 0;
                return (
                  <Link
                    href={typeConcentration ? `/securities?type=${encodeURIComponent(typeConcentration.topType)}` : "/securities"}
                    className={`group rounded-lg border p-3 transition-colors ${typeConcentrationBreached ? "border-red-500/40 bg-red-500/5 hover:bg-red-500/10" : "border-border bg-card hover:bg-muted/40"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">Per-type cap</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{typeCapPct.toFixed(0)}% cap</span>
                    </div>
                    <p className={`mt-1 text-sm font-semibold ${typeConcentrationBreached ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
                      {typeConcentration
                        ? `${topPct}% in ${typeConcentration.topLabel}${typeConcentrationBreached ? " — over cap" : ""}`
                        : "No securities yet"}
                    </p>
                    {/* R60: share-vs-cap progress bar for the per-type limit. */}
                    <div className="mt-2 relative h-1.5 w-full rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-[width] duration-300 ${typeConcentrationBreached ? "bg-red-500" : "bg-primary"}`}
                        style={{ width: `${Math.min(100, topPct)}%` }}
                      />
                    </div>
                    <div className="relative h-2">
                      <span
                        className="absolute top-0 -translate-x-1/2 h-2 w-px bg-foreground/40"
                        style={{ left: `${Math.min(100, typeCapPct)}%` }}
                        aria-hidden
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Largest instrument type vs the {typeCapPct.toFixed(0)}% limit.
                    </p>
                  </Link>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* ── Per-issuer concentration warning (Round 31) ──────────────── */}
        {/* R60: suppressed while concentration warnings are snoozed. */}
        {concentration && concentration.breaches.length > 0 && !concentrationSnoozed && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-200/90 leading-relaxed space-y-1">
              <p>
                <strong className="text-amber-100">Concentration warning —</strong>{" "}
                {concentration.breaches.length === 1 ? "one issuer holds" : `${concentration.breaches.length} issuers each hold`}{" "}
                more than {(concentration.cap * 100).toFixed(0)}% of your net worth. Kenyan deposit insurance (<GlossaryTerm id="kdic-insurance">KDIC</GlossaryTerm>) only covers
                up to KES 500,000 per bank, so spreading large balances across institutions reduces single-bank risk.
              </p>
              <ul className="space-y-0.5">
                {concentration.breaches.map((b) => (
                  <li key={b.issuer}>
                    <Link
                      href={`/deposits?issuer=${encodeURIComponent(b.issuer)}`}
                      className="group inline-flex items-center gap-1 hover:underline decoration-amber-300/50 underline-offset-2 cursor-pointer"
                      title={`View ${b.issuer} holdings`}
                    >
                      <span className="text-amber-100 font-medium">{b.issuer}</span>: {formatKES(b.value)}{" "}
                      (<span className="font-mono">{(b.share * 100).toFixed(1)}%</span> of {formatKES(concentration.netWorth)} net worth)
                      <ArrowUpRight className="w-3 h-3 text-amber-300/70 group-hover:text-amber-200" />
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-amber-200/60">Click an issuer to see its holdings.</p>
              <div className="pt-1">
                <button
                  type="button"
                  onClick={acknowledgeIssuerBreach}
                  disabled={recordBreachAckMutation.isPending || snoozeMutation.isPending}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                  title="Record that you accept this concentration and stop the warning"
                >
                  {recordBreachAckMutation.isPending ? "Recording…" : "Acknowledge this breach"}
                </button>
                <span className="ml-2 text-[10px] text-amber-200/50">Logs your acceptance to Change History and mutes this warning.</span>
              </div>
            </div>
          </div>
        )}

        {/* ── R69.2: Per-instrument-type cap warning (maturity-aware) ────── */}
        {/* Parity with the per-issuer card: a real warning + Acknowledge/log
            action, not just a risk-limit tile. The per-type cap is a duration/
            liquidity guardrail (single sovereign issuer), so a breach from held,
            un-matured lots self-corrects as they mature — we say WHEN it clears and
            never advise selling un-matured paper. Suppressed while snoozed. */}
        {typeConcentrationBreached && typeBreach && typeConcentration && !concentrationSnoozed && (
          <div
            className={
              typeBreach.selfCorrects
                ? "rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 flex gap-3"
                : "rounded-xl border border-red-500/30 bg-red-500/10 p-4 flex gap-3"
            }
          >
            <Layers className={`w-4 h-4 shrink-0 mt-0.5 ${typeBreach.selfCorrects ? "text-amber-400" : "text-red-400"}`} />
            <div className="text-xs leading-relaxed space-y-1">
              <p className={typeBreach.selfCorrects ? "text-amber-200/90" : "text-red-200/90"}>
                <strong className={typeBreach.selfCorrects ? "text-amber-100" : "text-red-100"}>
                  Per-type cap —
                </strong>{" "}
                <GlossaryTerm id="per-type-cap">{typeConcentration.topLabel}</GlossaryTerm> is{" "}
                <span className="font-mono">{(typeBreach.shareOfSecurities * 100).toFixed(1)}%</span> of your
                securities
                {typeBreach.shareOfNetWorth > 0 && (
                  <> (<span className="font-mono">{(typeBreach.shareOfNetWorth * 100).toFixed(1)}%</span> of net worth)</>
                )}
                , above the {typeCapPct.toFixed(0)}% cap. This is a duration/liquidity limit, not credit
                risk — all CBK paper shares one sovereign issuer.
              </p>
              {typeBreach.selfCorrects && typeBreach.clearsAtMs ? (
                <p className="text-amber-200/80">
                  These are held lots maturing within your horizon, so it clears on its own by{" "}
                  <strong className="text-amber-100">{fmtBreachDate(typeBreach.clearsAtMs)}</strong>. Until
                  then the monthly sweep won&rsquo;t buy more {typeConcentration.topLabel}. No action needed.
                </p>
              ) : (
                <p className="text-red-200/80">
                  This won&rsquo;t self-correct within your horizon. The engine has already stopped adding
                  {" "}{typeConcentration.topLabel}; selling early means rediscounting on the secondary
                  market (you may get less than face if rates rose, plus a dealer spread).
                </p>
              )}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={acknowledgeTypeBreach}
                  disabled={recordBreachAckMutation.isPending || snoozeMutation.isPending}
                  className={
                    typeBreach.selfCorrects
                      ? "inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-100 hover:bg-amber-500/20 transition-colors disabled:opacity-50"
                      : "inline-flex items-center gap-1 rounded-md border border-red-400/40 bg-red-500/10 px-2.5 py-1 text-[11px] font-medium text-red-100 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  }
                  title="Record that you accept this concentration and stop the warning"
                >
                  {recordBreachAckMutation.isPending ? "Recording…" : "Acknowledge this breach"}
                </button>
                <span className="ml-2 text-[10px] text-muted-foreground">Logs your acceptance to Change History and mutes this warning.</span>
              </div>
            </div>
          </div>
        )}

        {/* ── Round 62: Liquid Cash Diversification ──────────────────────── */}
        {liquidAlloc && liquidAlloc.slices.length > 0 && liquidAlloc.liquidPot > 0 && (
          <Card className="border-sky-500/20">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start gap-2 mb-3">
                <Scale className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-semibold text-foreground">
                    <GlossaryTerm id="liquid-reserve-diversification">Liquid cash diversification</GlossaryTerm>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{liquidAlloc.message}</p>
                </div>
                <span
                  className={cn(
                    "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium border",
                    liquidAlloc.state === "diversified" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                    liquidAlloc.state === "concentrated_by_policy" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
                    liquidAlloc.state === "single_home" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
                    liquidAlloc.state === "too_small" && "border-border bg-muted/40 text-muted-foreground",
                  )}
                >
                  {liquidAlloc.state === "diversified" && "Diversified"}
                  {liquidAlloc.state === "concentrated_by_policy" && "Yield-first"}
                  {liquidAlloc.state === "single_home" && "Single home"}
                  {liquidAlloc.state === "too_small" && "Too small yet"}
                </span>
              </div>
              {liquidAlloc.driftBreached && !liquidAlloc.driftSnoozed && (
                <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-200">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="min-w-0 text-[11px] leading-relaxed">
                    <p className="font-semibold">Time to rebalance</p>
                    <p className="text-amber-200/85">
                      Your liquid cash is {formatKES(liquidAlloc.totalDrift)} away from the recommended split — above your{" "}
                      {liquidAlloc.driftThresholdPct}% alert threshold ({formatKES(liquidAlloc.driftThresholdValue)} of net worth).
                      Use <span className="font-medium">Apply this split</span> below to bring each home back toward target.
                    </p>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          disabled={snoozeDriftMutation.isPending}
                          className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-amber-200/90 underline underline-offset-2 hover:text-amber-100 disabled:opacity-50"
                        >
                          <BellOff className="w-3 h-3" /> Snooze this alert…
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="min-w-[8rem]">
                        {SNOOZE_OPTIONS.map((opt) => (
                          <DropdownMenuItem key={opt.days} onClick={() => snoozeDrift(opt.days)}>
                            {opt.label}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              )}
              {liquidAlloc.driftBreached && liquidAlloc.driftSnoozed && (
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
                  <BellOff className="w-3.5 h-3.5 shrink-0" />
                  <span className="min-w-0">
                    Drift alert snoozed{liquidAlloc.driftSnoozeUntil ? ` until ${new Date(liquidAlloc.driftSnoozeUntil).toLocaleDateString()}` : ""}.
                  </span>
                  <button
                    type="button"
                    onClick={() => snoozeDrift(null)}
                    disabled={snoozeDriftMutation.isPending}
                    className="ml-auto shrink-0 text-[10px] font-medium text-sky-300 underline underline-offset-2 hover:text-sky-200 disabled:opacity-50"
                  >
                    Resume now
                  </button>
                </div>
              )}
              <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-1.5">
                <span className="text-[11px] text-muted-foreground">
                  Breach alerts:{" "}
                  <span className="font-medium text-foreground">
                    {liquidAlloc.driftDigestMode === "digest" ? "Daily digest" : "Immediate"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setDriftDigest(liquidAlloc.driftDigestMode === "digest" ? "immediate" : "digest")
                  }
                  disabled={setDriftDigestMutation.isPending}
                  className="shrink-0 text-[10px] font-medium text-sky-300 underline underline-offset-2 hover:text-sky-200 disabled:opacity-50"
                >
                  {liquidAlloc.driftDigestMode === "digest"
                    ? "Switch to immediate"
                    : "Batch into a daily digest"}
                </button>
              </div>
              {(() => {
                const totalDrift = liquidAlloc.slices.reduce(
                  (sum, s) => sum + Math.abs(s.drift ?? 0),
                  0,
                );
                const anyReconciled = liquidAlloc.slices.some((s) => s.reconciled);
                return (
                  <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-muted-foreground">Total drift from target</p>
                      <p
                        className={cn(
                          "text-sm font-semibold kes-amount",
                          !anyReconciled
                            ? "text-muted-foreground"
                            : totalDrift > 0.5
                              ? "text-amber-300"
                              : "text-emerald-300",
                        )}
                      >
                        {anyReconciled ? formatKES(totalDrift) : "—"}
                        {anyReconciled && totalDrift <= 0.5 && (
                          <span className="ml-1.5 text-[11px] font-normal text-emerald-300/80">on target</span>
                        )}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70">
                        {anyReconciled
                          ? "Sum of |actual − target| across reconciled homes."
                          : "Reconcile your homes to see real drift vs the recommended split."}
                      </p>
                    </div>
                    {driftHistory && driftHistory.length >= 2 && (
                      <div className="hidden sm:flex flex-col items-end shrink-0">
                        <Sparkline
                          values={driftHistory.map((d) => d.totalDrift)}
                          threshold={liquidAlloc.driftThresholdValue}
                          tone={
                            driftHistory[driftHistory.length - 1].totalDrift >
                            driftHistory[0].totalDrift
                              ? "amber"
                              : "emerald"
                          }
                        />
                        <span className="text-[10px] text-muted-foreground/70 mt-0.5">
                          {driftHistory[driftHistory.length - 1].totalDrift >
                          driftHistory[0].totalDrift
                            ? "drifting further"
                            : "converging"}
                        </span>
                      </div>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20"
                      onClick={() => {
                        const init: Record<string, string> = {};
                        for (const s of liquidAlloc.slices) {
                          init[s.id] = String(Math.round((s.currentBalance ?? 0) * 100) / 100);
                        }
                        setReconcileAllValues(init);
                        setReconcileAllOpen(true);
                      }}
                    >
                      <Scale className="w-3.5 h-3.5 mr-1.5" />
                      Reconcile all
                    </Button>
                  </div>
                );
              })()}
              <div className="space-y-2">
                {liquidAlloc.slices.map((s) => {
                  const pct = Math.round(s.targetShare * 100);
                  const needsMove = s.rebalance && Math.abs(s.delta) > 0.5;
                  const drift = s.drift ?? 0;
                  const hasDrift = Math.abs(drift) > 0.5;
                  return (
                    <div key={s.id} className="space-y-1">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-foreground truncate">{s.label}</span>
                        <span className="text-muted-foreground">· {s.netYieldPct.toFixed(2)}% net</span>
                        {s.reconciled ? (
                          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-px text-[9px] font-medium text-emerald-300">
                            Reconciled
                          </span>
                        ) : (
                          <span className="rounded-full border border-border bg-muted/40 px-1.5 py-px text-[9px] font-medium text-muted-foreground">
                            Estimated
                          </span>
                        )}
                        <span className="ml-auto font-semibold text-foreground kes-amount shrink-0">{formatKES(s.targetBalance)}</span>
                        <span className="text-muted-foreground tabular-nums w-10 text-right shrink-0">{pct}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-sky-500/70 transition-[width] duration-300"
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="text-muted-foreground">
                          Now: <span className="text-foreground/80 kes-amount">{formatKES(s.currentBalance ?? 0)}</span>
                          {hasDrift && (
                            <span className={cn("ml-1.5", drift > 0 ? "text-amber-300/90" : "text-sky-300/90")}>
                              ({drift > 0 ? "+" : "−"}{formatKES(Math.abs(drift))} vs target)
                            </span>
                          )}
                          {s.reconciled && s.reconciledAt != null && (
                            <span
                              className={cn(
                                "ml-1.5",
                                isReconcileStale(s.reconciledAt) ? "text-amber-300/90" : "text-muted-foreground/70",
                              )}
                              title={new Date(s.reconciledAt).toLocaleString("en-KE")}
                            >
                              · reconciled {formatRelativeTime(s.reconciledAt)}
                              {isReconcileStale(s.reconciledAt) && " (stale)"}
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          className="ml-auto text-sky-300/90 hover:text-sky-200 underline-offset-2 hover:underline"
                          onClick={() => {
                            setReconcileHome({ id: s.id, label: s.label, current: s.currentBalance ?? 0 });
                            setReconcileValue(String(Math.round((s.currentBalance ?? 0) * 100) / 100));
                          }}
                        >
                          {s.reconciled ? "Edit balance" : "Reconcile"}
                        </button>
                      </div>
                      {needsMove && (
                        <p className="text-[11px] text-amber-300/80">
                          {s.delta > 0 ? "Move in" : "Move out"} {formatKES(Math.abs(s.delta))} to reach this target.
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
              {transferPlan.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full border-sky-500/40 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20"
                  onClick={() => setSplitOpen(true)}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 mr-1.5" />
                  Apply this split ({transferPlan.length} transfer{transferPlan.length === 1 ? "" : "s"})
                </Button>
              )}
              <p className="text-[11px] text-muted-foreground/70 mt-3">
                Targets keep each issuer at or under {Math.round(liquidAlloc.effectiveIssuerCapFrac * 100)}% of net worth.
                Only liquid homes (MMFs, call/savings deposits) are shown — fixed deposits and government securities are excluded.
              </p>
            </CardContent>
          </Card>
        )}

        {/* R63 — Apply-this-split transfer plan dialog */}
        <Dialog
          open={splitOpen}
          onOpenChange={(o) => {
            setSplitOpen(o);
            if (o) setDoneTransfers(new Set()); // fresh checklist each open
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4 text-sky-400" />
                Apply liquid split
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  To match the recommended diversification, make the following transfers between
                  your liquid homes. Tick each one off as you complete it.
                </p>
              </div>
              {transferPlan.length > 0 && (
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-[width] duration-300"
                      style={{ width: `${(doneTransfers.size / transferPlan.length) * 100}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                    {doneTransfers.size} of {transferPlan.length} done
                  </span>
                </div>
              )}
              <div className="space-y-2">
                {transferPlan.map((t, i) => {
                  const key = `${t.fromId}-${t.toId}-${i}`;
                  const isDone = doneTransfers.has(key);
                  return (
                    <button
                      type="button"
                      key={key}
                      onClick={() => toggleTransferDone(key)}
                      aria-pressed={isDone}
                      className={`flex w-full items-center gap-2 rounded-lg border p-3 text-sm text-left transition-colors ${
                        isDone
                          ? "border-emerald-500/40 bg-emerald-500/10"
                          : "border-border bg-muted/30 hover:bg-muted/50"
                      }`}
                    >
                      <span
                        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                          isDone ? "bg-emerald-500/30 text-emerald-200" : "bg-sky-500/20 text-sky-300"
                        }`}
                      >
                        {isDone ? <Check className="h-3 w-3" /> : i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div
                          className={`flex items-center gap-1.5 ${
                            isDone ? "text-muted-foreground line-through" : "text-foreground"
                          }`}
                        >
                          <span className="truncate font-medium">{t.fromLabel}</span>
                          <ArrowRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate font-medium">{t.toLabel}</span>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 font-semibold kes-amount ${
                          isDone ? "text-muted-foreground line-through" : "text-sky-200"
                        }`}
                      >
                        {formatKES(t.amount)}
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                <span className="text-xs text-muted-foreground">Total cash to move</span>
                <span className="font-semibold text-foreground kes-amount">
                  {formatKES(transferPlan.reduce((s, t) => s + t.amount, 0))}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground/70">
                These are guidance amounts — execute the moves in your MMF and bank apps, then record the
                resulting balances here so the tracker stays in sync. Nothing is moved automatically.
              </p>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const text = transferPlan
                    .map((t, i) => `${i + 1}. ${t.fromLabel} → ${t.toLabel}: ${formatKES(t.amount)}`)
                    .join("\n");
                  navigator.clipboard?.writeText(text).then(
                    () => toast.success("Transfer plan copied to clipboard"),
                    () => toast.error("Could not copy"),
                  );
                }}
              >
                <Copy className="w-3.5 h-3.5 mr-1.5" />
                Copy plan
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  const done = transferPlan.filter((_, i) =>
                    doneTransfers.has(`${transferPlan[i].fromId}-${transferPlan[i].toId}-${i}`),
                  );
                  if (done.length > 0 && portfolioId) {
                    recordAppliedTransfersMutation.mutate({
                      portfolioId,
                      transfers: done.map((t) => ({
                        from: t.fromLabel,
                        to: t.toLabel,
                        amount: t.amount,
                      })),
                    });
                  }
                  setSplitOpen(false);
                }}
              >
                {doneTransfers.size > 0 ? `Done (log ${doneTransfers.size})` : "Done"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* R64 — per-home balance reconcile dialog */}
        <Dialog open={!!reconcileHome} onOpenChange={(o) => !o && setReconcileHome(null)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-sky-400" />
                Reconcile balance
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Enter the actual balance currently resting in{" "}
                <span className="font-medium text-foreground">{reconcileHome?.label}</span>. The
                split will then show real drift (actual vs target) instead of an estimate.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Actual balance (KES)</label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  inputMode="decimal"
                  value={reconcileValue}
                  onChange={(e) => setReconcileValue(e.target.value)}
                  placeholder="0.00"
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (reconcileHome && portfolioId) {
                    clearLiquidBalanceMutation.mutate({ portfolioId, homeId: reconcileHome.id, homeLabel: reconcileHome.label });
                  }
                }}
                disabled={clearLiquidBalanceMutation.isPending}
              >
                Revert to estimate
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (!reconcileHome || !portfolioId) return;
                  const v = parseFloat(reconcileValue);
                  if (!Number.isFinite(v) || v < 0) {
                    toast.error("Enter a valid balance");
                    return;
                  }
                  setLiquidBalanceMutation.mutate({ portfolioId, homeId: reconcileHome.id, homeLabel: reconcileHome.label, actualBalance: v });
                }}
                disabled={setLiquidBalanceMutation.isPending}
              >
                Save balance
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* R65 — Reconcile-all quick-entry dialog */}
        <Dialog open={reconcileAllOpen} onOpenChange={setReconcileAllOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-sky-400" />
                Reconcile all liquid balances
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Enter the actual balance currently resting in each liquid home. Saving updates
                them all at once and recomputes the recommended split and drift.
              </p>
              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {liquidAlloc?.slices.map((s) => (
                  <div key={s.id} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-foreground">{s.label}</p>
                      <p className="text-[10px] text-muted-foreground">
                        Target {formatKES(s.targetBalance)}
                      </p>
                    </div>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      inputMode="decimal"
                      className="w-36 shrink-0"
                      value={reconcileAllValues[s.id] ?? ""}
                      onChange={(e) =>
                        setReconcileAllValues((prev) => ({ ...prev, [s.id]: e.target.value }))
                      }
                      placeholder="0.00"
                    />
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-2">
              <Button variant="outline" size="sm" onClick={() => setReconcileAllOpen(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={setLiquidBalancesBulkMutation.isPending}
                onClick={() => {
                  if (!portfolioId || !liquidAlloc) return;
                  const balances: { homeId: string; homeLabel: string; actualBalance: number }[] = [];
                  for (const s of liquidAlloc.slices) {
                    const raw = reconcileAllValues[s.id];
                    if (raw === undefined || raw === "") continue;
                    const v = parseFloat(raw);
                    if (!Number.isFinite(v) || v < 0) {
                      toast.error(`Enter a valid balance for ${s.label}`);
                      return;
                    }
                    balances.push({ homeId: s.id, homeLabel: s.label, actualBalance: v });
                  }
                  if (balances.length === 0) {
                    toast.error("Enter at least one balance");
                    return;
                  }
                  setLiquidBalancesBulkMutation.mutate({ portfolioId, balances });
                }}
              >
                Save all
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── What the engine projection means ───────────────────────────── */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex gap-3">
          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
            <p>
              <strong className="text-foreground">What does "Projected at Month {horizonMonths}" mean?</strong>{" "}
              This is the computer's best estimate of how much money you will have after {horizonYearsLabel} years ({horizonMonths} monthly contributions),
              assuming you follow the step-up schedule, the current interest rates stay roughly the same, and every month's earnings
              are automatically reinvested. Think of it as your <em className="text-foreground">financial finish line</em> — the number
              the plan is designed to reach.
            </p>
            <p>
              It is <strong className="text-foreground">not a guarantee</strong> — actual returns will vary as CBK rates change.
              Update the rates in <Link href="/settings"><span className="text-primary underline cursor-pointer">Rate Settings</span></Link> whenever
              you see new CBK auction results to keep the projection accurate.
            </p>
          </div>
        </div>

        {/* ── Goal Progress Card ──────────────────────────────────────────── */}
        <Card className="border-primary/20 gold-glow">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Projected Portfolio Value at Year {horizonYearsLabel}
                </p>
                {projLoading ? (
                  <Skeleton className="h-10 w-52 mt-1" />
                ) : (
                  <p className="text-4xl font-bold gradient-text kes-amount" style={{ fontFamily: "'Playfair Display', serif" }}>
                    {formatKES(projectedFinalValue)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1.5">
                  This is the total portfolio value you will <strong className="text-foreground">hold in your accounts</strong> at the end of Month {horizonMonths} — not what you put in, but what you will have.
                </p>
              </div>

              {/* Target amount — editable */}
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground mb-1">Target End Value</p>
                <div className="flex items-center gap-2 justify-end">
                  {false ? (
                    <Skeleton className="h-7 w-32" />
                  ) : (
                    <p className="text-xl font-bold text-primary kes-amount">
                      {formatKES(targetAmount)}
                    </p>
                  )}
                  <button
                    onClick={openTargetDialog}
                    className="w-6 h-6 rounded-md bg-muted hover:bg-primary/20 flex items-center justify-center transition-colors"
                    title={`Change your target end value (the amount you want to hold at Month ${horizonMonths})`}
                  >
                    <Pencil className="w-3 h-3 text-muted-foreground" />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {willHitTarget ? (
                    <span className="text-emerald-400">
                      ✓ On track — surplus of {formatKES(surplusOrShortfall)}
                    </span>
                  ) : (
                    <span className="text-red-400">
                      ✗ Shortfall of {formatKES(Math.abs(surplusOrShortfall))}
                    </span>
                  )}
                </p>
                {!projLoading && projectedFinalValue > 0 && (
                  <p className="text-xs mt-1">
                    {landsFullyLiquid ? (
                      <span className={`inline-flex items-start gap-1 ${endStateLiquidCopy?.tone === "nudge" ? "text-amber-400" : "text-emerald-400"}`}>
                        {endStateLiquidCopy?.tone === "nudge" ? (
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        ) : (
                          <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
                        )}
                        <span>
                          Lands fully liquid at goal — {endStateLiquidCopy
                            ? endStateLiquidCopy.text
                            : `${liquidPctAtGoal.toFixed(0)}% in cash/MMF, withdrawable on the goal date`}
                        </span>
                      </span>
                    ) : (
                      <span className="text-amber-400 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {liquidPctAtGoal.toFixed(0)}% liquid at goal —
                        {" "}{formatKES(lockedAtGoal)} still in securities at Month {horizonMonths}
                      </span>
                    )}
                  </p>
                )}
                {/* R70.2 — visual projected end-state split bar (policy-aware) */}
                {landsFullyLiquid &&
                  endStateSplit &&
                  endStateSplit.slices.length > 1 && (
                    <div className="mt-2">
                      <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                        {endStateSplit.slices.map((s, i) => (
                          <Tooltip key={`${s.label}-${i}`}>
                            <TooltipTrigger asChild>
                              <div
                                className="h-full cursor-help transition-opacity hover:opacity-80"
                                style={{
                                  width: `${(s.targetShare * 100).toFixed(2)}%`,
                                  backgroundColor: END_STATE_SPLIT_COLORS[i % END_STATE_SPLIT_COLORS.length],
                                }}
                              />
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">
                              <div className="font-medium text-foreground">{s.label}</div>
                              <div className="text-muted-foreground">
                                {formatKES(s.targetBalance)} · {(s.targetShare * 100).toFixed(0)}% of pot
                              </div>
                              <div className="text-muted-foreground">{s.netYieldPct.toFixed(2)}% net yield</div>
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                        {endStateSplit.slices.map((s, i) => (
                          <span
                            key={`legend-${s.label}-${i}`}
                            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
                          >
                            <span
                              className="inline-block h-2 w-2 rounded-sm"
                              style={{ backgroundColor: END_STATE_SPLIT_COLORS[i % END_STATE_SPLIT_COLORS.length] }}
                            />
                            {s.label} {(s.targetShare * 100).toFixed(0)}%
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="relative h-3 bg-muted rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/80 to-primary rounded-full transition-all duration-1000"
                style={{ width: `${progressPct}%` }}
              />
              {[25, 50, 75].map((pct) => (
                <div key={pct} className="absolute top-0 bottom-0 w-px bg-border/50" style={{ left: `${pct}%` }} />
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
              <span>KES 0</span>
              <span>{formatKESCompact(targetAmount * 0.25)}</span>
              <span>{formatKESCompact(targetAmount * 0.5)}</span>
              <span>{formatKESCompact(targetAmount * 0.75)}</span>
              <span>{formatKESCompact(targetAmount)}</span>
            </div>
            {/* Surplus / shortfall callout */}
            {!projLoading && projectedFinalValue > 0 && (
              <div className={`mt-3 rounded-lg px-4 py-3 text-xs flex items-start gap-2 ${
                willHitTarget
                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                  : "bg-red-500/10 border border-red-500/20 text-red-300"
              }`}>
                {willHitTarget ? (
                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                )}
                <span>
                  {willHitTarget ? (
                    <>
                      <strong>Your plan overshoots the target by {formatKES(surplusOrShortfall)}.</strong>{" "}
                      This is because your contribution step-ups and compound interest naturally produce more than your {formatKES(targetAmount)} goal.
                      The extra {formatKES(surplusOrShortfall)} is a buffer — it protects you if rates fall or you miss a few contributions.
                      The bucket balances above show where all {formatKES(projectedFinalValue)} will be sitting at Year {horizonYearsLabel}.
                    </>
                  ) : (
                    <>
                      <strong>Your plan is {formatKES(Math.abs(surplusOrShortfall))} short of the target.</strong>{" "}
                      Consider increasing your step-up amount or adjusting your goal. Use the{" "}
                      <Link href="/scenarios"><span className="underline cursor-pointer">Scenarios</span></Link> page to find the right step-up.
                    </>
                  )}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Asset Allocation Cards ──────────────────────────────────────── */}
        <div>
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <Info className="w-3 h-3" />
            These are the <strong className="text-foreground">projected balances in each bucket at Month {horizonMonths}</strong> — how your money is spread across your investment instruments at the end of the {horizonYearsLabel}-year plan. These figures are driven by your contribution schedule and interest rates, not your goal amount. To see how different step-up amounts affect your outcome, visit the <Link href="/scenarios"><span className="text-primary hover:underline cursor-pointer">Scenarios</span></Link> page.
          </p>
            <div className={`grid grid-cols-2 gap-4 ${usesBankInstruments ? "lg:grid-cols-5" : "lg:grid-cols-4"}`}>
            {projLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}><CardContent className="p-5"><Skeleton className="h-20 w-full" /></CardContent></Card>
              ))
            ) : (
              [
                { title: "MMF Balance", key: "mmfEnd" as const, subtitle: secondaryMmfs.length > 0 ? `${fundName} + ${secondaryMmfs.length} more` : fundName, icon: Wallet, accent: true, tooltip: `Your ${fundName} projected balance at Year ${horizonYearsLabel}${secondaryMmfs.length > 0 ? ` (+ ${secondaryMmfs.length} additional MMF account${secondaryMmfs.length > 1 ? "s" : ""} with KES ${secondaryMmfTotal.toLocaleString("en-KE")} current balance)` : ""}. Earns daily interest (net ~${(fundEar * 0.85).toFixed(1)}% p.a. after 15% WHT).` },
                { title: "T-Bills", key: "tbillEnd" as const, subtitle: "CBK Treasury Bills", icon: TrendingUp, accent: false, tooltip: `Your total invested in CBK Treasury Bills at Year ${horizonYearsLabel}. T-bills are short-term (91–364 days), very safe government instruments. You earn a discount return (net ~7.5% p.a. after 15% WHT deducted at source).` },
                { title: "IFB Holdings", key: "ifbEnd" as const, subtitle: "Tax-exempt bonds", icon: Shield, accent: false, tooltip: `Your total invested in Infrastructure Finance Bonds at Year ${horizonYearsLabel}. IFBs pay a semi-annual coupon (e.g. 12.5% p.a.) and are 100% tax-exempt — you keep every shilling of interest earned.` },
                { title: "FXD Bonds", key: "fxdEnd" as const, subtitle: "Fixed coupon bonds", icon: Landmark, accent: false, tooltip: `Your total invested in Fixed Coupon Bonds at Year ${horizonYearsLabel}. FXDs pay a semi-annual coupon (e.g. 12.35% gross, ~10.5% net after 15% WHT). They provide predictable income but the WHT is deducted before you receive the coupon.` },
                ...(usesBankInstruments ? [{ title: "Bank Deposits", key: "bankEnd" as const, subtitle: "All bank instruments", icon: Landmark, accent: false, tooltip: `Your recorded bank deposits of EVERY type — call deposits, fixed deposits, ordinary savings, target/goal savings and tiered savings — projected forward at their own rates (net of WHT) at Year ${horizonYearsLabel}. Liquid kinds (call, ordinary savings, tiered savings) stay withdrawable and accrue in place; term kinds (fixed deposit, target savings) lock for a tenor, then return principal + net interest to the MMF at maturity.` }] : []),
              ].map(({ title, key, subtitle, icon, accent, tooltip }) => {
                const bucketValue = lastData?.[key] ?? 0;
                const pctOfTarget = targetAmount > 0 ? ((bucketValue / targetAmount) * 100).toFixed(1) : "0.0";
                return (
                  <Card key={title} className={`card-hover ${accent ? "border-primary/30 gold-glow" : ""}`}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="w-3 h-3 text-muted-foreground/60 cursor-help shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">{tooltip}</TooltipContent>
                            </Tooltip>
                          </div>
                          <p className={`text-2xl font-bold kes-amount ${accent ? "gradient-text" : "text-foreground"}`}>
                            {formatKESCompact(bucketValue)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
                          <p className="text-xs text-muted-foreground/70 mt-0.5">
                            {pctOfTarget}% of {formatKESCompact(targetAmount)} goal
                          </p>
                        </div>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ml-3 ${accent ? "bg-primary/15" : "bg-muted"}`}>
                          {(() => { const Icon = icon; return <Icon className={`w-5 h-5 ${accent ? "text-primary" : "text-muted-foreground"}`} />; })()}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>

        {/* ── Tracked MMF Accounts (multi-MMF rollup) ─────────────────────── */}
        {secondaryMmfs.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Wallet className="w-4 h-4 text-primary" />
                Tracked MMF Accounts
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Current balances you maintain across multiple money market funds. The projection above models your primary fund; these additional accounts are tracked here and rolled into your tax and accrual views.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="rounded-lg border border-border divide-y divide-border">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{fundName} <span className="text-xs text-muted-foreground">(primary)</span></p>
                    <p className="text-xs text-muted-foreground">Net yield {fundEar.toFixed(2)}% p.a.</p>
                  </div>
                  <p className="text-sm font-semibold kes-amount text-foreground shrink-0">{formatKES(actualsSummary?.byBucket?.mmf ?? 0)}</p>
                </div>
                {secondaryMmfs.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{m.label?.trim() ? `${m.label}` : m.fundName}{m.label?.trim() ? <span className="text-xs text-muted-foreground"> ({m.fundName})</span> : null}</p>
                      <p className="text-xs text-muted-foreground">Net yield {m.ear.toFixed(2)}% p.a.{m.monthlyContribution > 0 ? ` · +${formatKES(m.monthlyContribution)}/mo` : ""}</p>
                    </div>
                    <p className="text-sm font-semibold kes-amount text-foreground shrink-0">{formatKES(m.currentBalance)}</p>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2.5 bg-primary/5">
                  <p className="text-sm font-semibold text-foreground">Total tracked MMF</p>
                  <p className="text-sm font-bold kes-amount gradient-text shrink-0">{formatKES((actualsSummary?.byBucket?.mmf ?? 0) + secondaryMmfTotal)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1.5">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                Manage these accounts on the <Link href="/mmf-funds"><span className="text-primary hover:underline cursor-pointer">MMF Funds</span></Link> page. Balances are entered manually.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Portfolio Growth Chart ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Portfolio Growth Projection ({horizonMonths} Months)
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Each coloured band shows how much money is in each bucket over time. The dashed line is your {formatKES(targetAmount)} goal.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {projLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.78 0.14 85)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="oklch(0.78 0.14 85)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="mmfGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.65 0.15 200)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="oklch(0.65 0.15 200)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.03 250)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: "oklch(0.60 0.02 250)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => (yearLabels.includes(v) ? `Yr ${Math.round((v / 12) * 10) / 10}` : "")}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "oklch(0.60 0.02 250)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatKESCompact(v).replace("KES ", "")}
                    width={50}
                  />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <ReferenceLine
                    y={targetAmount}
                    stroke="oklch(0.78 0.14 85)"
                    strokeDasharray="6 3"
                    strokeOpacity={0.6}
                    label={{ value: `${formatKESCompact(targetAmount)} Target`, fill: "oklch(0.78 0.14 85)", fontSize: 10, position: "insideTopRight" }}
                  />
                  {yearLabels.map((m) => (
                    <ReferenceLine key={m} x={m} stroke="oklch(0.30 0.03 250)" strokeDasharray="2 4" />
                  ))}
                  <Area type="monotone" dataKey="mmf" name="MMF" stackId="1" stroke="oklch(0.65 0.15 200)" fill="url(#mmfGrad)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="tbill" name="T-Bills" stackId="1" stroke="oklch(0.70 0.12 160)" fill="oklch(0.70 0.12 160 / 0.1)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="ifb" name="IFB" stackId="1" stroke="oklch(0.78 0.14 85)" fill="url(#totalGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="fxd" name="FXD" stackId="1" stroke="oklch(0.65 0.15 280)" fill="oklch(0.65 0.15 280 / 0.1)" strokeWidth={1.5} />
                  {usesBankInstruments && (
                    <Area type="monotone" dataKey="bank" name="Bank deposits" stackId="1" stroke="oklch(0.72 0.13 50)" fill="oklch(0.72 0.13 50 / 0.12)" strokeWidth={1.5} />
                  )}
                </AreaChart>
              </ResponsiveContainer>
            )}
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-border">
              {phaseLegend.map((b) => (
                <div key={b.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-3 h-2 rounded-sm" style={{ background: b.color }} />
                  <span>{b.label} (M{b.start}–{b.end})</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Year-End Milestones ─────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Year-End Milestones
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              <strong>Projected Total</strong> = the plan’s expected balance for your {formatKES(targetAmount)} goal at that year-end.{" "}
              <strong>Min. Healthy</strong> = the lowest acceptable balance (90% of projected) — if you fall below this, catch-up action is needed.{" "}
              <strong>Engine Value</strong> = what the simulator calculates with your current rate settings. Both columns scale automatically when you change your goal.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Year</th>
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Month</th>
                    <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Projected Total</th>
                    <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Min. Healthy</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">
                      <span className="flex items-center gap-1 justify-end">
                        Engine Value
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="w-3 h-3 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            This is what the simulator calculates you will have at that month, using your current rate settings. Green = at or above the minimum healthy checkpoint. Red = below the minimum.
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {milestones?.map((m) => {
                    const engineValue = projection?.[m.month - 1]?.totalEnd ?? 0;
                    const isOnTrack = engineValue >= m.minHealthyCheckpoint;
                    const isAhead = engineValue >= m.projectedTotal;
                    return (
                      <tr key={m.year} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 pr-4 font-semibold text-foreground">Year {m.year}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{m.month}</td>
                        <td className="py-2.5 pr-4 text-right font-medium kes-amount text-foreground">
                          {formatKES(m.projectedTotal)}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-muted-foreground kes-amount">
                          {formatKES(m.minHealthyCheckpoint)}
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isAhead ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                            ) : isOnTrack ? (
                              <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                            ) : (
                              <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                            )}
                            <span className={`font-semibold kes-amount ${isAhead ? "text-emerald-400" : isOnTrack ? "status-on-track" : "status-behind"}`}>
                              {formatKES(engineValue)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </CardContent>
        </Card>

        {/* ── Today Snapshot + Reconciliation ─────────────────────────────── */}
        {actualsSummary && actualsSummary.entryCount > 0 && (() => {
          const primaryMmf = actualsSummary.depositsContributed ?? actualsSummary.byBucket?.mmf ?? 0;
          const sec = actualsSummary.secondaryMmfBalance ?? 0;
          const bank = actualsSummary.bankBalance ?? 0;
          const securitiesValue =
            (actualsSummary.byBucket?.tbill ?? 0) +
            (actualsSummary.byBucket?.ifb ?? 0) +
            (actualsSummary.byBucket?.fxd ?? 0);
          const actualsTotal = actualsSummary.totalContributed ?? 0;
          const rows = [
            { key: "pmmf", label: `${fundName} (primary MMF)`, icon: Wallet, amt: primaryMmf },
            { key: "smmf", label: `Other MMF accounts (${actualsSummary.secondaryCount ?? 0})`, icon: PiggyBank, amt: sec },
            { key: "bank", label: `Bank instruments (${actualsSummary.bankHoldingCount ?? 0})`, icon: Landmark, amt: bank },
            { key: "sec", label: "CBK securities (T-Bills / IFB / FXD)", icon: Shield, amt: securitiesValue },
          ];

          // Reconciliation: live actuals vs the engine's seeded "today" value.
          const hasEngineToday = projectionToday != null;
          const delta = hasEngineToday ? actualsTotal - (projectionToday as number) : 0;
          const denom = hasEngineToday && (projectionToday as number) > 0 ? (projectionToday as number) : actualsTotal || 1;
          const deltaPct = (delta / denom) * 100;
          const absPct = Math.abs(deltaPct);
          const tone = absPct <= 1
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
            : absPct <= 5
            ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
            : "bg-red-500/10 text-red-400 border-red-500/30";
          const ReconIcon = absPct <= 1 ? CheckCircle2 : AlertTriangle;

          return (
            <Card
              ref={reconcileRef}
              id="reconciliation-card"
              className={cn(
                "scroll-mt-24 transition-shadow duration-500",
                reconcileFlash && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg"
              )}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-primary" />
                  Today Snapshot &amp; Reconciliation
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  What you hold right now across every instrument, and how that compares with the
                  projection engine&rsquo;s value for today (the last month it seeds from your real deposits).
                </p>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-4">
                {/* Per-instrument breakdown */}
                <div className="rounded-lg border border-border divide-y divide-border">
                  {rows.map((r) => {
                    const Icon = r.icon;
                    const pct = actualsTotal > 0 ? (r.amt / actualsTotal) * 100 : 0;
                    return (
                      <div key={r.key} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{r.label}</p>
                          <p className="text-xs text-muted-foreground">{pct.toFixed(1)}% of holdings</p>
                        </div>
                        <p className="text-sm font-semibold kes-amount text-foreground shrink-0">{formatKES(r.amt)}</p>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between px-3 py-2.5 bg-primary/5">
                    <p className="text-sm font-semibold text-foreground">Total held today</p>
                    <p className="text-sm font-bold kes-amount gradient-text shrink-0">{formatKES(actualsTotal)}</p>
                  </div>
                </div>

                {/* Reconciliation row */}
                <div className={`rounded-lg border px-3 py-3 ${tone}`}>
                  <div className="flex items-start gap-2">
                    <ReconIcon className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">Projection vs Actuals (today)</p>
                      {hasEngineToday ? (
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                          <div>
                            <p className="opacity-80">Engine value (today)</p>
                            <p className="font-semibold kes-amount text-foreground">{formatKES(projectionToday as number)}</p>
                          </div>
                          <div>
                            <p className="opacity-80">Actuals (today)</p>
                            <p className="font-semibold kes-amount text-foreground">{formatKES(actualsTotal)}</p>
                          </div>
                          <div>
                            <p className="opacity-80">Difference</p>
                            <p className="font-semibold kes-amount">
                              {delta >= 0 ? "+" : "−"}{formatKES(Math.abs(delta))} ({delta >= 0 ? "+" : "−"}{absPct.toFixed(2)}%)
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs opacity-90">
                          The engine has no seeded &ldquo;today&rdquo; value yet — your portfolio start date is in the
                          current month, so the projection begins from month 0. Record deposits in earlier months
                          to enable a side-by-side comparison.
                        </p>
                      )}
                      {hasEngineToday && (
                        <p className="mt-2 text-xs opacity-90 leading-relaxed">
                          {absPct <= 1
                            ? "Your real holdings track the plan closely — nicely on course."
                            : delta >= 0
                            ? "You are ahead of the plan for this point in time. The engine assumes a fixed monthly schedule; extra deposits or higher balances push actuals above the modelled curve."
                            : "You are behind the plan for this point in time. This is expected if you started recording mid-journey or skipped some scheduled contributions — the engine assumes every month was funded on schedule."}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* ── Live Actuals Panel ──────────────────────────────────────────── */}
        <Card className="border-emerald-500/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <ArrowDownCircle className="w-4 h-4 text-emerald-400" />
                  Live Actuals — Real Money Deposited
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  These figures are based on the deposits you have actually recorded. They reflect real money, not projections.
                </p>
              </div>
              <button onClick={openDrawer} className="text-xs text-primary hover:underline flex items-center gap-1">
                Record a deposit <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {actualsSummary && actualsSummary.entryCount === 0 ? (
              <div className="flex items-center gap-3 rounded-lg bg-muted/40 border border-border p-4 text-sm text-muted-foreground">
                <PiggyBank className="w-5 h-5 shrink-0 opacity-50" />
                <span>
                  No deposits recorded yet.{" "}
                  <button onClick={openDrawer} className="text-primary underline">Record your first deposit</button>{" "}
                  to see your live actuals here.
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-widest text-emerald-400">Total Contributed</p>
                  <p className="text-2xl font-serif font-bold text-foreground kes-amount">
                    {formatKES(actualsSummary?.totalContributed ?? 0)}
                  </p>
                  <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden mt-2">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all duration-700"
                      style={{ width: `${Math.min(100, ((actualsSummary?.totalContributed ?? 0) / targetAmount) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(((actualsSummary?.totalContributed ?? 0) / targetAmount) * 100).toFixed(2)}% of {formatKES(targetAmount)} goal
                  </p>
                </div>

                <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Remaining to Target</p>
                  <p className="text-2xl font-serif font-bold text-foreground kes-amount">
                    {formatKES(actualsSummary?.remainingToTarget ?? targetAmount)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Based on {formatKES(targetAmount)} goal
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-white/10">
                    {Object.entries(actualsSummary?.byBucket ?? {}).map(([bucket, amt]) => (
                      <div key={bucket} className="text-xs">
                        <span className="text-muted-foreground uppercase">{bucket}:</span>{" "}
                        <span className="font-semibold text-foreground">{formatKESCompact(amt as number)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-red-400" />
                    <p className="text-xs font-medium uppercase tracking-widest text-red-400">Est. Annual Tax</p>
                  </div>
                  <p className="text-2xl font-serif font-bold text-red-300 kes-amount">
                    {formatKES(actualsSummary?.taxLiability ?? 0)}
                  </p>
                  <p className="text-[11px] font-medium text-red-300/80">
                    Forward 12-month estimate on today&rsquo;s balances
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    15% <GlossaryTerm id="wht">WHT</GlossaryTerm> on MMF, T-Bill &amp; FXD income, plus the correct{" "}
                    <GlossaryTerm id="tiered-wht">tiered WHT</GlossaryTerm> on Treasury bonds. Deducted at source — you never pay this separately. T-bill WHT is charged on the discount (face − purchase price), not the face.
                  </p>
                  <p className="text-xs text-emerald-400 mt-1">
                    <GlossaryTerm id="ifb">IFB</GlossaryTerm> bonds: fully tax-exempt
                  </p>
                </div>

                <div className="rounded-xl bg-sky-500/10 border border-sky-500/20 p-4 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5 text-sky-400" />
                    <p className="text-xs font-medium uppercase tracking-widest text-sky-400">Est. Interest Earned</p>
                  </div>
                  <p className="text-2xl font-serif font-bold text-sky-200 kes-amount">
                    {formatKES(actualsSummary?.estInterestEarned ?? 0)}
                  </p>
                  <p className="text-[11px] font-medium text-sky-300/80">
                    Accrued to today (not annualised)
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    <GlossaryTerm id="net-yield">Net of WHT</GlossaryTerm>,{" "}
                    <GlossaryTerm id="accrued-interest">accrued</GlossaryTerm> to today across your MMF (primary + secondary), bank deposits and government securities (T-bill / IFB / FXD coupons). MMF &amp; bank use{" "}
                    <GlossaryTerm id="daily-compounding">geometric daily compounding</GlossaryTerm>; gov paper uses pro-rata coupon.
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    Other assets appreciate in value (shown in Net Worth) and are not counted as interest.
                  </p>
                  <Link href="/mmf-accrual">
                    <span className="text-xs text-sky-400 hover:underline cursor-pointer mt-1 inline-flex items-center gap-1">
                      Day-by-day ledger <ArrowRight className="w-3 h-3" />
                    </span>
                  </Link>
                </div>
              </div>
            )}

            {/* ── Unified live net worth across every destination ──────────── */}
            {actualsSummary && actualsSummary.entryCount > 0 && (() => {
              const primaryMmf = actualsSummary.byBucket?.mmf ?? 0;
              const sec = actualsSummary.secondaryMmfBalance ?? 0;
              const bank = actualsSummary.bankBalance ?? 0;
              const tb = actualsSummary.byBucket?.tbill ?? 0;
              const ifb = actualsSummary.byBucket?.ifb ?? 0;
              const fxd = actualsSummary.byBucket?.fxd ?? 0;
              const net = actualsSummary.totalContributed ?? 0;
              const segs = [
                { key: "pmmf", label: `${fundName} (primary MMF)`, amt: primaryMmf, color: "#34d399" },
                { key: "smmf", label: `Other MMFs (${actualsSummary.secondaryCount ?? 0})`, amt: sec, color: "#6ee7b7" },
                { key: "bank", label: `Bank deposits (${actualsSummary.bankHoldingCount ?? 0})`, amt: bank, color: "#38bdf8" },
                { key: "tb", label: "CBK T-Bills", amt: tb, color: "#60a5fa" },
                { key: "ifb", label: "IFB Bonds", amt: ifb, color: "#a78bfa" },
                { key: "fxd", label: "FXD Bonds", amt: fxd, color: "#fb923c" },
              ].filter((s) => s.amt > 0);
              return (
                <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-3">
                  <div className="flex items-end justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-widest text-emerald-400">Live Net Worth</p>
                      <p className="text-2xl font-serif font-bold text-foreground kes-amount">{formatKES(net)}</p>
                      <p className="text-xs text-muted-foreground">Sum of every account you actually own — separate from the projection above.</p>
                    </div>
                  </div>
                  {net > 0 && (
                    <>
                      <div className="w-full h-2.5 rounded-full overflow-hidden flex bg-white/5">
                        {segs.map((s) => (
                          <div key={s.key} style={{ width: `${(s.amt / net) * 100}%`, backgroundColor: s.color }} title={`${s.label}: ${formatKES(s.amt)}`} />
                        ))}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                        {segs.map((s) => (
                          <div key={s.key} className="flex items-center gap-2 text-xs">
                            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                            <span className="text-muted-foreground truncate">{s.label}</span>
                            <span className="ml-auto font-semibold text-foreground kes-amount shrink-0">{formatKESCompact(s.amt)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}

            {/* ── Round 47/48: holdings split by precise instrument type ────── */}
            {(() => {
              // Active (non-matured) register holdings grouped by precise type,
              // computed directly from the securities list so zero-coupon and
              // floating-rate paper show separately from T-bills / IFB / FXD.
              // R48: each group carries both its FACE value and its CURRENT
              // (accreted / par + accrued) value via the shared engine helper.
              type SecRow = {
                securityType?: string;
                faceValue?: unknown;
                purchasePrice?: unknown;
                couponRate?: unknown;
                issueDate?: unknown;
                maturityDate?: unknown;
                isMatured?: boolean;
                tenorYears?: unknown;
              };
              const rows = (securities as SecRow[]) ?? [];
              const groups: Record<string, { face: number; current: number }> = {};
              for (const s of rows) {
                if (s?.isMatured) continue;
                const face = parseFloat(String(s?.faceValue ?? "0")) || 0;
                if (face <= 0) continue;
                const t = String(s?.securityType ?? "");
                const key = t.startsWith("tbill")
                  ? "tbill"
                  : t === "zero_coupon"
                    ? "zero_coupon"
                    : t === "floating_rate"
                      ? "floating_rate"
                      : t === "ifb"
                        ? "ifb"
                        : t === "fxd"
                          ? "fxd"
                          : "other";
                let current = face;
                if (s?.issueDate && s?.maturityDate) {
                  current = currentSecurityValue({
                    securityType: t,
                    faceValue: face,
                    purchasePrice: parseFloat(String(s?.purchasePrice ?? "")) || null,
                    couponRate: parseFloat(String(s?.couponRate ?? "0")) || 0,
                    issueDate: String(s.issueDate),
                    maturityDate: String(s.maturityDate),
                    isMatured: s?.isMatured ?? false,
                    whtRatePct: whtRateForSecurity(
                      t as never,
                      parseFloat(String(s?.tenorYears ?? "")) || null,
                    ),
                  }, new Date(effectiveNowMs));
                }
                const g = groups[key] ?? { face: 0, current: 0 };
                g.face += face;
                g.current += current;
                groups[key] = g;
              }
              const META: Record<string, { label: string; color: string }> = {
                tbill: { label: "T-Bills", color: "#60a5fa" },
                zero_coupon: { label: "Zero-Coupon Bonds", color: "#2dd4bf" },
                ifb: { label: "IFB Bonds", color: "#a78bfa" },
                fxd: { label: "FXD Bonds", color: "#fb923c" },
                floating_rate: { label: "Floating-Rate Notes", color: "#f472b6" },
                other: { label: "Other securities", color: "#94a3b8" },
              };
              const order = ["tbill", "zero_coupon", "ifb", "fxd", "floating_rate", "other"];
              const segs = order
                .filter((k) => (groups[k]?.face ?? 0) > 0)
                .map((k) => ({
                  key: k,
                  label: META[k].label,
                  color: META[k].color,
                  amt: holdingsBasis === "current" ? groups[k].current : groups[k].face,
                  face: groups[k].face,
                  current: groups[k].current,
                }));
              const totalFace = segs.reduce((sum, s) => sum + s.face, 0);
              const totalCurrent = segs.reduce((sum, s) => sum + s.current, 0);
              const total = holdingsBasis === "current" ? totalCurrent : totalFace;
              // Only worth showing once the user holds at least two instrument
              // kinds, or any of the newer (zero/floating) types.
              const hasExotic = (groups.zero_coupon?.face ?? 0) > 0 || (groups.floating_rate?.face ?? 0) > 0;
              if (totalFace <= 0 || (segs.length < 2 && !hasExotic)) return null;
              const gain = totalCurrent - totalFace;
              return (
                <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Holdings by Instrument</p>
                      <p className="text-2xl font-serif font-bold text-foreground kes-amount">{formatKES(total)}</p>
                      <p className="text-xs text-muted-foreground">
                        {holdingsBasis === "current"
                          ? "Current (accreted / par + accrued) value of your active CBK securities today."
                          : "Face (redemption) value of your active CBK securities, split by precise instrument type."}
                      </p>
                    </div>
                    <div className="flex rounded-lg border border-white/10 bg-white/[0.02] p-0.5 shrink-0">
                      {(["face", "current"] as const).map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setHoldingsBasis(b)}
                          className={cn(
                            "px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors",
                            holdingsBasis === b
                              ? "bg-primary/20 text-primary"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {b === "face" ? "Face" : "Current"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="w-full h-2.5 rounded-full overflow-hidden flex bg-white/5">
                    {segs.map((s) => (
                      <div key={s.key} style={{ width: `${total > 0 ? (s.amt / total) * 100 : 0}%`, backgroundColor: s.color }} title={`${s.label}: ${formatKES(s.amt)}`} />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                    {segs.map((s) => (
                      <div key={s.key} className="flex items-center gap-2 text-xs">
                        <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                        <span className="text-muted-foreground truncate">{s.label}</span>
                        <span className="ml-auto font-semibold text-foreground kes-amount shrink-0">{formatKESCompact(s.amt)}</span>
                      </div>
                    ))}
                  </div>
                  {Math.abs(gain) >= 1 && (
                    <p className="text-[11px] text-muted-foreground/80">
                      {gain >= 0 ? "Accrued so far" : "Below face"}:{" "}
                      <span className={cn("font-semibold", gain >= 0 ? "text-emerald-400" : "text-amber-400")}>
                        {gain >= 0 ? "+" : "−"}{formatKES(Math.abs(gain))}
                      </span>{" "}
                      ({formatKES(totalCurrent)} current vs {formatKES(totalFace)} face). Discount paper accretes toward
                      face; coupon bonds carry pro-rata accrued interest.
                    </p>
                  )}
                  <p className="text-[11px] text-muted-foreground/70">
                    Zero-coupon and floating-rate paper are shown on their own here, even though they sit inside the
                    T-Bill / FXD buckets elsewhere for tax and reconciliation purposes.
                  </p>
                </div>
              );
            })()}

            {/* ── Round 48: maturity calendar — upcoming security redemptions ── */}
            {(() => {
              type SecRow = {
                securityType?: string;
                faceValue?: unknown;
                maturityDate?: unknown;
                isMatured?: boolean;
              };
              const rows = (securities as SecRow[]) ?? [];
              const TYPE_LABEL: Record<string, string> = {
                tbill_91: "91-Day T-Bill",
                tbill_182: "182-Day T-Bill",
                tbill_364: "364-Day T-Bill",
                ifb: "IFB Bond",
                fxd: "FXD Bond",
                zero_coupon: "Zero-Coupon Bond",
                floating_rate: "Floating-Rate Note",
              };
              const now = new Date();
              const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
              const allUpcoming = rows
                .filter((s) => !s?.isMatured && s?.maturityDate)
                .map((s) => {
                  const mt = new Date(String(s.maturityDate)).getTime();
                  const days = Math.round((mt - startOfToday) / (1000 * 60 * 60 * 24));
                  return {
                    type: String(s?.securityType ?? ""),
                    label: TYPE_LABEL[String(s?.securityType ?? "")] ?? "Security",
                    face: parseFloat(String(s?.faceValue ?? "0")) || 0,
                    maturity: mt,
                    days,
                  };
                })
                .filter((e) => Number.isFinite(e.maturity) && e.days >= 0 && e.face > 0)
                .sort((a, b) => a.maturity - b.maturity);
              if (allUpcoming.length === 0) return null;
              // R49 — apply the selected time window, then cap the list length.
              const windowed =
                maturityWindow === "all"
                  ? allUpcoming
                  : allUpcoming.filter((e) => e.days <= maturityWindow);
              const upcoming = windowed.slice(0, 12);
              const WINDOWS: Array<30 | 90 | 365 | "all"> = [30, 90, 365, "all"];
              const windowedFace = windowed.reduce((sum, e) => sum + e.face, 0);
              return (
                <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <CalendarClock className="w-4 h-4 text-primary shrink-0" />
                      <div>
                        <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Maturity Calendar</p>
                        <p className="text-xs text-muted-foreground">Upcoming security redemptions, soonest first. Plan your re-investments around these dates.</p>
                      </div>
                    </div>
                    <div className="flex items-center rounded-lg bg-muted/40 p-0.5">
                      {WINDOWS.map((w) => (
                        <button
                          key={String(w)}
                          type="button"
                          onClick={() => setMaturityWindow(w)}
                          className={cn(
                            "rounded-md px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors",
                            maturityWindow === w
                              ? "bg-card text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {w === "all" ? "All" : w === 365 ? "1y" : `${w}d`}
                        </button>
                      ))}
                    </div>
                  </div>
                  {upcoming.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-3 text-center">
                      No maturities within {maturityWindow === "all" ? "this range" : maturityWindow === 365 ? "1 year" : `${maturityWindow} days`}. Try a wider window.
                    </p>
                  ) : (
                  <div className="divide-y divide-white/5">
                    {upcoming.map((e, i) => {
                      const imminent = e.days <= 30;
                      const soon = e.days <= 90;
                      const dateStr = new Date(e.maturity).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      });
                      return (
                        <Link key={i} href={`/ledger?focus=${e.maturity}`}>
                          <div className="flex items-center gap-3 py-2 cursor-pointer hover:bg-white/[0.02] -mx-2 px-2 rounded-md transition-colors">
                            <span
                              className={cn(
                                "w-2 h-2 rounded-full shrink-0",
                                imminent ? "bg-red-400" : soon ? "bg-amber-400" : "bg-emerald-400",
                              )}
                            />
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">{e.label}</p>
                              <p className="text-[11px] text-muted-foreground">{dateStr}</p>
                            </div>
                            <div className="ml-auto text-right shrink-0">
                              <p className="text-xs font-semibold text-foreground kes-amount">{formatKESCompact(e.face)}</p>
                              <p
                                className={cn(
                                  "text-[11px] font-medium",
                                  imminent ? "text-red-400" : soon ? "text-amber-400" : "text-muted-foreground",
                                )}
                              >
                                {e.days === 0 ? "Today" : e.days === 1 ? "In 1 day" : `In ${e.days} days`}
                              </p>
                            </div>
                          </div>
                        </Link>
                      );
                    })}
                  </div>
                  )}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <p className="text-[11px] text-muted-foreground/70">
                      Red dots mature within 30 days, amber within 90. Click a row to jump to that month in the ledger.
                    </p>
                    {windowed.length > 0 && (
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        {windowed.length} {windowed.length === 1 ? "lot" : "lots"} · {formatKESCompact(windowedFace)} face
                        {windowed.length > upcoming.length ? ` (showing ${upcoming.length})` : ""}
                      </p>
                    )}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* ── Rate Assumptions ────────────────────────────────────────────── */}
        {settings && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-foreground">Current Rate Assumptions</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    These are the gross rates used in the projection. The engine deducts 15% WHT on MMF, T-Bill, and FXD income automatically.
                  </p>
                </div>
                <Link href="/settings">
                  <span className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer">
                    Update rates <ArrowRight className="w-3 h-3" />
                  </span>
                </Link>
              </div>
              {mode === "sandbox" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium">Sample rates (Test mode)</span>
                  <span className="opacity-90">— these are sample figures for trying the tracker; rate freshness is only tracked on your live portfolio.</span>
                </div>
              ) : (() => {
                const s = rateStaleness((settings as any).ratesLastUpdatedAt);
                const tone = s.isVeryStale
                  ? "bg-red-500/10 text-red-400 border-red-500/30"
                  : s.isStale
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
                const Icon = s.isStale ? AlertTriangle : CheckCircle2;
                return (
                  <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${tone}`}>
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-medium">Rates last updated: {s.label}</span>
                    {s.isVeryStale ? (
                      <span className="opacity-90">— more than 30 days old. CBK auction rates change frequently; update them so this projection stays accurate.</span>
                    ) : s.isStale ? (
                      <span className="opacity-90">— over a week old. Consider refreshing from the latest CBK results.</span>
                    ) : (
                      <span className="opacity-90">— recently refreshed.</span>
                    )}
                    {s.isStale && (
                      <Link href="/settings">
                        <span className="underline underline-offset-2 cursor-pointer font-medium ml-auto flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Update now
                        </span>
                      </Link>
                    )}
                  </div>
                );
              })()}
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: `${fundLabel} Yield (gross)`, value: formatPct((settings as any).selectedFundEar ?? settings.mmfYield), note: "net ~" + formatPct(((settings as any).selectedFundEar ?? settings.mmfYield) * 0.85) },
                  { label: "91-Day T-Bill", value: formatPct(settings.tbill91Rate), note: "net ~" + formatPct(settings.tbill91Rate * 0.85) },
                  { label: "364-Day T-Bill", value: formatPct(settings.tbill364Rate), note: "net ~" + formatPct(settings.tbill364Rate * 0.85) },
                  { label: "IFB Coupon", value: formatPct(settings.ifbCouponRate), note: "tax-exempt" },
                  { label: "FXD Coupon (gross)", value: formatPct(settings.fxdCouponRate), note: "net ~" + formatPct(settings.fxdCouponRate * 0.85) },
                  { label: "WHT Rate", value: formatPct(settings.withholdingTax), note: "MMF, T-Bill, FXD" },
                ].map(({ label, value, note }) => (
                  <div key={label} className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">{label}</p>
                    <p className="text-sm font-bold text-primary">{value}</p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">{note}</p>
                  </div>
                ))}
              </div>

              {/* Rates for the specific instruments this portfolio actually holds */}
              {(secondaryMmfs.length > 0 || bankHoldings.some((b) => b.isActive)) && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                    Your held instruments
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {secondaryMmfs.map((s) => (
                      <div key={`smmf-${s.id}`} className="bg-muted/50 rounded-lg p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1 truncate" title={s.fundName}>{s.fundName}</p>
                        <p className="text-sm font-bold text-emerald-400">{formatPct(s.ear)}</p>
                        <p className="text-xs text-muted-foreground/70 mt-0.5">net ~{formatPct(s.ear * 0.85)}</p>
                      </div>
                    ))}
                    {bankHoldings.filter((b) => b.isActive).map((b) => (
                      <div key={`bank-${b.id}`} className="bg-muted/50 rounded-lg p-3 text-center">
                        <p className="text-xs text-muted-foreground mb-1 truncate" title={`${b.bankName} ${b.instrumentType}`}>
                          {b.label || b.bankName}
                        </p>
                        <p className="text-sm font-bold text-sky-400">{formatPct(b.interestRate)}</p>
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          {b.instrumentType === "fixed_deposit" ? "fixed deposit" : "call deposit"}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── 90-day maturity / liquidity strip (Round 33) ───────────────── */}
        <MaturityTimeline
          securities={securities as never}
          bankHoldings={bankHoldings as never}
          startISO={portfolio ? String(portfolio.startDate).split("T")[0] : undefined}
          plan={
            portfolio
              ? {
                  monthIntoPlan: (() => {
                    const start = new Date(String(portfolio.startDate));
                    const now = new Date();
                    const m = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1;
                    return Math.max(1, m);
                  })(),
                  horizonMonths: portfolio.horizonMonths ?? 0,
                }
              : undefined
          }
        />

      </div>

      {/* ── Change Target Dialog ─────────────────────────────────────────── */}
      <Dialog open={targetDialogOpen} onOpenChange={setTargetDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Your Target End Value</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs text-muted-foreground leading-relaxed">
              <p className="mb-2"><strong className="text-foreground">This is the total portfolio value you want to hold at Month {horizonMonths}</strong> — not the sum of what you put in, but the final balance sitting across all your investment buckets at the end of {horizonYearsLabel} years.</p>
              <strong className="text-foreground">What updates when you change this?</strong>
              <ul className="mt-2 space-y-1 list-disc list-inside">
                <li>The progress bar and percentage on the dashboard</li>
                <li>The "Remaining to Target" figure in your live actuals</li>
                <li>The target line on the portfolio growth chart</li>
                <li>The scenario comparison — which step-up amounts hit the new target</li>
                <li>The surplus/shortfall shown next to your goal</li>
              </ul>
              <p className="mt-2">The monthly contribution schedule and rate settings are <strong className="text-foreground">not affected</strong>.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Target End Value (KES) — what you want to hold at Month {horizonMonths}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">KES</span>
                <Input
                  type="number"
                  step="100000"
                  min="100000"
                  className="pl-12 text-sm"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveTarget()}
                  placeholder="5000000"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Common targets: KES 3M, KES 5M, KES 7.5M, KES 10M
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[3000000, 5000000, 7500000, 10000000].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setTargetInput(String(preset))}
                  className={`text-xs py-1.5 px-2 rounded-md border transition-colors ${
                    parseFloat(targetInput) === preset
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {formatKESCompact(preset)}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTargetDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={saveTarget}
              disabled={updatePortfolioMutation.isPending}
              className="bg-primary text-primary-foreground"
            >
              {updatePortfolioMutation.isPending ? "Saving…" : "Update Target & Recalculate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </TooltipProvider>
    </AppShell>
  );
}
