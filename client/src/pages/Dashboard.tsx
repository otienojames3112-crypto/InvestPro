import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSimulatedNow } from "@/hooks/useSimulatedNow";
import { AppShell } from "@/components/AppShell";
import { SimulatedDateChip } from "@/components/SimulatedDateChip";
import { DashboardCommandCentre, type CommandAlert } from "@/components/DashboardCommandCentre";
import { DashboardDiagnostics } from "@/components/DashboardDiagnostics";
import { trpc } from "@/lib/trpc";
import { formatKES, formatKESCompact, formatPct, getPhaseName, getPhasePlainLabel, getPhasePlainHint, getPhaseColorClass, formatRelativeTime, isReconcileStale } from "@/lib/format";
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
  DialogDescription,
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
import { useBlendedYield } from "@/hooks/useBlendedYield";
import { CreatePortfolioDialog } from "@/components/PortfolioSelector";
import { MaturityTimeline } from "@/components/MaturityTimeline";
import { Plus, Compass, ArrowUpRight } from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { rateStaleness } from "@/lib/rateStaleness";
import { dashboardHref } from "@shared/navigation";
import { currentSecurityValue, securityYieldContribution, isDiscountSecurityType, classifyDurationRisk, largestConcentration, classifyConcentration, analyzePerTypeBreach, isConcentrationSnoozed, formatConcentrationPct, splitEndStateBuckets, DEFAULT_LIQUIDITY_HORIZON_DAYS, type CurrentValueSecurity } from "@shared/discount";
import { whtRateForSecurity } from "@shared/securityTenor";
import { Layers, TrendingDown, BellOff, Bell, Scale, ArrowRightLeft, Copy, Check, ChevronUp, ChevronDown, ShieldAlert, Activity } from "lucide-react";
import { buildTransferPlan, SNOOZE_OPTIONS, snoozeUntilFromDays } from "@shared/liquidAllocator";
import {
  classifyBreachSeverity,
  classifyRateRisk,
  classifyContributionRisk,
  classifyLiquidityTimingRisk,
  severityRank,
  type RiskSeverity,
} from "@shared/decisionSurface";
import { Sparkline } from "@/components/Sparkline";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

// ── Part 4: severity → styling map (one place so colour matches the message) ──
// "action" = red (a decision is genuinely needed); "caution" = amber
// (self-correcting, acknowledged, or modelled downside — worth knowing, no
// action right now); "ok" = neutral/green.
const RISK_SEVERITY_STYLES: Record<
  RiskSeverity,
  { dot: string; text: string; border: string; bg: string; chip: string; label: string }
> = {
  action: {
    dot: "bg-red-500",
    text: "text-red-600 dark:text-red-400",
    border: "border-red-500/40",
    bg: "bg-red-500/5",
    chip: "bg-red-500/15 text-red-300 border-red-500/30",
    label: "Action needed",
  },
  caution: {
    dot: "bg-amber-500",
    text: "text-amber-600 dark:text-amber-400",
    border: "border-amber-500/40",
    bg: "bg-amber-500/5",
    chip: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    label: "Monitor",
  },
  ok: {
    dot: "bg-emerald-500",
    text: "text-emerald-600 dark:text-emerald-400",
    border: "border-border",
    bg: "bg-card",
    chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    label: "OK",
  },
};

function RiskRow({
  icon: Icon,
  title,
  severity,
  detail,
  okLabel,
}: {
  icon: React.ElementType;
  title: string;
  severity: RiskSeverity;
  detail: React.ReactNode;
  okLabel?: string;
}) {
  const s = RISK_SEVERITY_STYLES[severity];
  return (
    <div className={cn("rounded-lg border p-3 flex gap-3 transition-colors", s.border, s.bg)}>
      <span className={cn("mt-0.5 shrink-0 w-7 h-7 rounded-lg flex items-center justify-center", severity === "ok" ? "bg-muted" : s.bg)}>
        <Icon className={cn("w-4 h-4", severity === "ok" ? "text-muted-foreground" : s.text)} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <span className={cn("shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium", s.chip)}>
            <span className={cn("w-1.5 h-1.5 rounded-full", s.dot)} />
            {severity === "ok" && okLabel ? okLabel : s.label}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}

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
  const { portfolioId, portfolio, portfolios, mode, userMode, isLoading: portfoliosLoading } = usePortfolio();
  // The Simple/Manager toggle lives in the sidebar (app-wide userMode). Manager
  // diagnostics and the command-centre manager band follow it directly, so the
  // sidebar switch is the single source of truth (no separate Dashboard toggle).
  const isManager = userMode === "manager";
  // R75 — the app's effective "now": the Time Machine's simulated date when a
  // sandbox session is active, else the real clock. Threading this into every
  // client-side security valuation keeps these cards in lock-step with the
  // server's reconciliation (which uses getNow), so no client/server drift.
  const { simulatedDate, active: simActive, label: simLabel } = useSimulatedNow();
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
  // Part 3 — decision surface: projection range, pace/lever, back-loading, goal-date liquidity.
  const { data: decision } = trpc.projection.decisionSurface.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // Canonical snapshot — the single source of money truth the command centre and
  // every consolidated tab read through the pure selectors in shared/snapshot.ts.
  const { data: snapshot } = trpc.portfolios.snapshot.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // Reconciliation verdict — drives the Dashboard health badge so the badge can
  // never disagree with the Reconciliation page (same procedure, same checks).
  const { data: recon } = trpc.projection.reconciliation.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // Part 3 — front-page net & real yield (same computation as Portfolio Review).
  const yieldSummary = useBlendedYield(portfolioId);
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
  // Part 5: other holdings (equities / REITs / offshore / property) valued once
  // via the shared mark-to-model source on the server, surfaced here so the Live
  // Net Worth strip shows the COMPLETE picture (core liquid plan + other assets).
  const { data: otherHoldings = [] } = trpc.otherHoldings.list.useQuery(
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
  // Part 5 (line-item #14): the "Record a Deposit" CTA writes into LIVE tracking.
  // On a Test/sandbox dashboard, intercept the click with a deliberate confirm
  // step so a user exploring sample data cannot accidentally record real money.
  const [liveDepositConfirmOpen, setLiveDepositConfirmOpen] = useState(false);
  // Simple vs Manager mode is driven by the app-wide sidebar toggle (userMode).
  // A normal user sees the focused command centre; a manager additionally sees
  // the compact diagnostics band. No separate Dashboard-local toggle.
  const handleRecordDeposit = () => {
    if (mode === "sandbox") {
      setLiveDepositConfirmOpen(true);
      return;
    }
    openDrawer();
  };

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
  const surplusOrShortfall = projectedFinalValue - targetAmount;
  const willHitTarget = projectedFinalValue >= targetAmount;
  // Part 2 fix #5: the bar must be honest on its own when the plan overshoots.
  // We scale the bar to the LARGER of target and projected so the goal line sits
  // at a real position and any surplus is shown as a distinct overshoot segment
  // beyond it (instead of silently clamping the fill at 100%).
  const rawProgressFrac = targetAmount > 0 ? projectedFinalValue / targetAmount : 0;
  const barMaxFrac = Math.max(1, rawProgressFrac); // 1 = exactly on target
  // Goal line position (%) within the bar; <100 only when overshooting.
  const goalLinePct = barMaxFrac > 0 ? (1 / barMaxFrac) * 100 : 100;
  // Width of the "to target" fill (capped at the goal line).
  const progressPct = Math.min(rawProgressFrac, 1) / barMaxFrac * 100;
  // Width of the overshoot fill, measured from the goal line to the projected end.
  const overshootPct = willHitTarget ? (rawProgressFrac - 1) / barMaxFrac * 100 : 0;

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

  // ── Part 2 Fix #1: policy-aware end-state bucket split ──────────────────────
  // The projection's final-month mmfEnd/bankEnd are RAW un-split balances (the
  // engine pools the swept liquid pot in the primary MMF), so the bucket cards
  // read ~96% MMF while the callout/split-bar say e.g. 50/50. projectedLiquidSplit
  // already computes the real policy-aware split; here we reallocate the FINAL
  // month's liquid pot across MMF vs Bank from those same slices so the cards,
  // the growth-chart endpoint and the callout all tell one story. This is a
  // presentation-only reallocation of the goal-date pot — earlier months and the
  // Month Ledger are untouched.
  const endStateBuckets = useMemo(() => {
    if (!lastData) return null;
    const rawMmf = (lastData.mmfEnd ?? 0) + (lastData.secondaryMmfEnd ?? 0);
    const rawBank = lastData.bankEnd ?? 0;
    return splitEndStateBuckets(
      rawMmf,
      rawBank,
      endStateSplit?.slices,
      !!endStateSplit?.isSplit,
    );
  }, [lastData, endStateSplit]);

  const chartData = useMemo(() => {
    if (!projection) return [];
    const lastIdx = projection.length - 1;
    return projection.map((r, i) => {
      // Final point: show the policy-aware split so the chart endpoint matches
      // the bucket cards and callout (chart MMF = primary + secondary MMF).
      const isLast = i === lastIdx;
      const useSplit = isLast && endStateBuckets?.applied;
      // endStateBuckets.mmf already folds in secondary MMF; the raw per-month
      // series stays r.mmfEnd so non-final months are visually unchanged.
      const mmf = useSplit ? endStateBuckets!.mmf : r.mmfEnd;
      const bank = useSplit ? endStateBuckets!.bank : r.bankEnd ?? 0;
      return {
        month: r.monthNumber,
        total: r.totalEnd,
        mmf,
        tbill: r.tbillEnd,
        ifb: r.ifbEnd,
        fxd: r.fxdEnd,
        bank,
      };
    });
  }, [projection, endStateBuckets]);

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

  // Part 5: goal date label (start + horizon months) for the investor strip.
  const goalDateLabel = useMemo(() => {
    if (!portfolio?.startDate || !horizonMonths) return null;
    const start = new Date(String(portfolio.startDate));
    const goal = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + horizonMonths, 1));
    return goal.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  }, [portfolio?.startDate, horizonMonths]);

  // Part 5: maturities falling within the next 90 days (manager exceptions band).
  // Derived from the SAME canonical liquidity feed the command centre and the
  // diagnostics "Next 3 Cash Events" card read (snapshot.liquidity), so the
  // "N maturities in next 90 days" alert can never disagree with them. This
  // counts gov + bank redemptions (kind "maturity") within the window; it does
  // NOT count scheduled contributions (money in) or coupons.
  const maturitiesNext90 = useMemo(() => {
    const events = snapshot?.liquidity ?? [];
    const now = snapshot?.asOfMs ?? effectiveNowMs;
    const horizon = now + 90 * 86_400_000;
    let count = 0;
    let faceTotal = 0;
    for (const e of events) {
      if (e.kind !== "maturity") continue;
      if (e.atMs < now || e.atMs > horizon) continue;
      count += 1;
      faceTotal += e.amount ?? 0;
    }
    return { count, faceTotal };
  }, [snapshot?.liquidity, snapshot?.asOfMs, effectiveNowMs]);

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
    let ytmWeighted = 0; // sum of (yieldFraction * currentValue)
    let ytmWeight = 0; // sum of current values that contributed a yield
    // Part 1: split the book so the value-vs-face bar reflects DISCOUNT lots only
    // (they accrete price -> face), while coupon bonds (which sit ~par and pay
    // coupons out) are reported via a separately-signed coupon-accrued figure.
    let discountFace = 0; // face of discount lots only (tbill / zero)
    let discountCurrent = 0; // current value of those discount lots
    let couponAccrued = 0; // sum of (current - face) for coupon bonds (the accrued dirty premium)
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

      if (isDiscountSecurityType(t)) {
        discountFace += face;
        discountCurrent += current;
      } else {
        // Coupon bond: the part of current value above face is accrued coupon
        // (the dirty-price premium). Floored at 0 so a clean coupon bond at par
        // contributes nothing rather than a spurious negative.
        couponAccrued += Math.max(0, current - face);
      }

      if (s?.maturityDate) {
        const mt = new Date(String(s.maturityDate)).getTime();
        const days = Math.max(0, Math.round((mt - now) / DAY));
        if (current > 0) {
          dtmWeight += current;
          dtmWeighted += days * current;
          // Part 1: value-weighted blended yield via the SHARED single source of
          // truth. Coupon bonds (fxd/ifb/floating) contribute their NET COUPON
          // yield (couponRate x (1 - whtFrac)); discount lots (tbill/zero) keep
          // accretion-to-face. This removes the negative-FXD-yield bug that
          // collapsed the blend to 1.40%.
          const yld = securityYieldContribution({
            securityType: t,
            faceValue: face,
            currentValue: current,
            couponRate: parseFloat(String(s?.couponRate ?? "0")) || 0,
            whtRatePct: whtRateForSecurity(
              t as never,
              parseFloat(String(s?.tenorYears ?? "")) || null,
            ),
            daysToMaturity: days,
          });
          if (yld != null) {
            ytmWeighted += yld * current;
            ytmWeight += current;
          }
        }
      }
    }
    const unrealizedGain = totalCurrent - totalCost;
    const gainPct = totalCost > 0 ? (unrealizedGain / totalCost) * 100 : 0;
    const wAvgDays = dtmWeight > 0 ? Math.round(dtmWeighted / dtmWeight) : 0;
    const wAvgYtmPct = ytmWeight > 0 ? (ytmWeighted / ytmWeight) * 100 : 0;
    // Discount accretion still owed to maturity (never negative): the gap between
    // discount-lot face and their current accreted value.
    const discountToAccrue = Math.max(0, discountFace - discountCurrent);
    return {
      totalFace,
      totalCurrent,
      totalCost,
      unrealizedGain,
      gainPct,
      lots,
      wAvgDays,
      wAvgYtmPct,
      discountFace,
      discountCurrent,
      discountToAccrue,
      couponAccrued,
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

  // ── Part 4: Key-risks model ──────────────────────────────────────────────
  // Lead the risk section with the risks that actually matter for a ladder of
  // sovereign paper matched to a dated goal, in priority order:
  //   (1) rate / reinvestment risk — the ladder re-rolls; falling CBK rates lower
  //       each reinvestment and the projection's downside band shows the gap.
  //   (2) contribution shortfall — behind on pace (action) or a back-loaded plan
  //       that leans on future escalation (caution).
  //   (3) liquidity-timing — cash locked at/after the goal date.
  // Concentration is demoted to a secondary, correctly-scoped duration/liquidity
  // note below — for single-issuer sovereign paper it is NOT credit risk.
  // `acknowledged` here = the user has snoozed/accepted the cap breach.
  const breachAcknowledged = concentrationSnoozed;
  const keyRisks = useMemo(() => {
    if (!decision) return null;
    const target = decision.target ?? 0;

    // (1) Rate / reinvestment risk — from the modelled downside band.
    const rateSeverity = classifyRateRisk({
      base: decision.range.base,
      low: decision.range.low,
      target,
    });
    const rateDownsideGap = Math.max(0, decision.range.base - decision.range.low);

    // (2) Contribution shortfall — pace + back-loading.
    const contributionSeverity = classifyContributionRisk({
      paceStatus: decision.pace.status,
      isBackloaded: decision.backloading.isBackloaded,
    });

    // (3) Liquidity-timing — goal-date cushion.
    const liquiditySeverity = classifyLiquidityTimingRisk({
      cushionDays: decision.liquidity.cushionDays,
      maturesNearOrAfterGoal: decision.liquidity.maturesNearOrAfterGoal,
    });

    return {
      rate: { severity: rateSeverity, downsideGap: rateDownsideGap },
      contribution: { severity: contributionSeverity },
      liquidity: { severity: liquiditySeverity, cushionDays: decision.liquidity.cushionDays },
    };
  }, [decision]);

  // Concentration severity — amber once self-correcting OR acknowledged.
  const issuerBreachActive = !!concentration && concentration.breaches.length > 0;
  const issuerSeverity: RiskSeverity = classifyBreachSeverity({
    breached: issuerBreachActive,
    acknowledged: breachAcknowledged,
  });
  const typeSeverity: RiskSeverity = classifyBreachSeverity({
    breached: !!typeBreach?.breached,
    selfCorrects: !!typeBreach?.selfCorrects,
    acknowledged: breachAcknowledged,
  });

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
              onClick={handleRecordDeposit}
              size="lg"
              className="font-semibold shadow-lg shadow-primary/20 bg-primary text-primary-foreground hover:bg-primary/90 active:scale-[0.97] transition-transform"
            >
              <ArrowDownCircle className="w-4 h-4 mr-2" />
              Record a Deposit
              <span className={`ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${mode === "sandbox" ? "bg-amber-500/25 text-amber-100" : "bg-primary-foreground/20"}`}>
                {mode === "sandbox" ? "Writes to Live" : "Live"}
              </span>
            </Button>
            {/* Part C2 — always-on chrome speaks plain language; the precise
                phase name + meaning sit one hover away in the tooltip. */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className={`text-xs px-3 py-1 border cursor-help ${getPhaseColorClass(currentPhase)}`}>
                  {getPhasePlainLabel(currentPhase)}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs text-xs">
                <span className="font-semibold">{getPhaseName(currentPhase)} phase.</span> {getPhasePlainHint(currentPhase)}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* ── Command centre (pasted Part 10): the focused, 30-second top.
            Every figure reads from the canonical snapshot selectors the
            Reconciliation trust-check also reads, so no card can disagree
            with the Ledger or with Reconciliation. ──────────────────────── */}
        {snapshot && (() => {
          const inc = snapshot.income;
          const incomeBase = snapshot.holdings.incomeTaxBase;
          // Expected interest THIS month = income base × net yield ÷ 12.
          const expectedInterest = Math.round((incomeBase * (inc.blendedNetYieldPct / 100)) / 12);
          // This-month planned/actual from the contribution plan at the elapsed month.
          const elapsed = snapshot.goal.elapsedMonths;
          const thisPoint =
            snapshot.contributions.points.find((p) => p.monthNumber === elapsed + 1) ??
            snapshot.contributions.points.find((p) => p.monthNumber === elapsed) ??
            null;
          const plannedThis = thisPoint?.planned ?? snapshot.contributions.startingContribution;
          // Money contributed this month across EVERY destination (primary MMF,
          // secondary MMF, bank instruments, gov securities). The "needs
          // attention" alert and next-action use THIS so recording a contribution
          // into any destination clears the alert — not only the primary MMF.
          const actualThis =
            thisPoint?.actualAllDestinations ?? thisPoint?.actual ?? 0;
          // Next maturity from the canonical liquidity events.
          const nextMat =
            snapshot.liquidity
              .filter((e) => e.kind === "maturity" && e.atMs >= snapshot.asOfMs)
              .sort((a, b) => a.atMs - b.atMs)[0] ?? null;
          // Next action — reuse the single most-important action text.
          const rateStaleCc = (settings as any)?.ratesLastUpdatedAt
            ? rateStaleness((settings as any).ratesLastUpdatedAt)
            : null;
          const ccBehind = decision?.pace.status === "behind";
          const nextActionText = ccBehind && decision?.stepUp?.feasible
            ? `Raise step-up by ${formatKES(decision.stepUp.recommendedStepUp)}/mo to stay on pace`
            : rateStaleCc?.isStale
              ? "Refresh your CBK rate snapshot"
              : plannedThis > 0 && actualThis <= 0
                ? "Record this month's contribution"
                : "Nothing today — you're on track";
          const nextActionHref = ccBehind
            ? dashboardHref.changeContribution
            : rateStaleCc?.isStale
              ? dashboardHref.rates
              : dashboardHref.recordDeposit;
          // Live actuals pockets.
          const mmfTotal = (actualsSummary?.byBucket?.mmf ?? 0) + (actualsSummary?.secondaryMmfBalance ?? 0);
          const govSecurities =
            (actualsSummary?.byBucket?.tbill ?? 0) +
            (actualsSummary?.byBucket?.ifb ?? 0) +
            (actualsSummary?.byBucket?.fxd ?? 0);
          const bankInstruments = actualsSummary?.bankBalance ?? 0;
          const otherAssets = snapshot.holdings.otherAssetsTotal;
          const interestToDate = inc.accruedNetInterest;
          // Audit item #1: the Dashboard tax card shows WHT PAYABLE, never the
          // income BASE. `whtToDate` is realised withholding on interest earned so
          // far; `annualWht` is the forward 12-month withholding on the mix.
          const taxToDate = snapshot.tax.whtToDate > 0 ? Math.round(snapshot.tax.whtToDate) : 0;
          const annualisedTax = snapshot.tax.annualWht > 0 ? Math.round(snapshot.tax.annualWht) : 0;
          // Priority alerts (red first), each deep-linked to where it's resolved.
          const ccAlerts: CommandAlert[] = [];
          if (plannedThis > 0 && actualThis <= 0)
            ccAlerts.push({ id: "missed", label: "This month's contribution not recorded", detail: `${formatKES(plannedThis)} planned`, tone: "amber", href: dashboardHref.recordDeposit });
          if (maturitiesNext90.count > 0)
            ccAlerts.push({ id: "mat", label: `${maturitiesNext90.count} maturit${maturitiesNext90.count === 1 ? "y" : "ies"} in next 90 days`, detail: formatKESCompact(maturitiesNext90.faceTotal), tone: "amber", href: dashboardHref.gov });
          if (rateStaleCc?.isVeryStale)
            ccAlerts.push({ id: "rates", label: `Rates outdated — ${rateStaleCc.label}`, tone: "red", href: dashboardHref.rates });
          if (typeBreach?.breached)
            ccAlerts.push({ id: "conc", label: "Concentration cap breach", tone: "amber", href: dashboardHref.risk });
          if (snapshot.reconciliation && !snapshot.reconciliation.ok)
            ccAlerts.push({ id: "recon", label: "Reconciliation mismatch", detail: "Sources disagree on today's value", tone: "red", href: dashboardHref.reconciliation });
          if (ccBehind)
            ccAlerts.push({ id: "pace", label: `Behind pace by ${formatKESCompact(decision!.pace.shortfall)}`, tone: "red", href: dashboardHref.changeContribution });
          // Sort red before amber.
          ccAlerts.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "red" ? -1 : 1));
          // Mirror the Reconciliation page's verdict EXACTLY (same procedure, same
          // checks) so the Dashboard badge can never disagree with that page.
          const reconVerdict = recon
            ? {
                reconciled:
                  !!recon.full?.reconciled &&
                  !!recon.mmf?.ok &&
                  (recon.gov?.ok ?? true) &&
                  (recon.bank?.ok ?? true) &&
                  (recon.govAccrual?.ok ?? true) &&
                  (recon.bankAccrual?.ok ?? true) &&
                  (recon.planPolicy?.ok ?? true) &&
                  (recon.basis?.fullOk ?? true),
                basisOk: recon.basis ? !!recon.basis.fullOk : true,
              }
            : snapshot.reconciliation
              ? { reconciled: snapshot.reconciliation.ok, basisOk: true }
              : null;
          return (
            <DashboardCommandCentre
              snapshot={snapshot}
              decision={decision ? {
                range: decision.range,
                probabilityPct: decision.risk?.probability?.probabilityPct ?? null,
                hasMaterialRisk: !!decision.risk?.hasMaterialRisk,
                pace: { status: (decision as any).effectivePace?.status ?? decision.pace.status, shortfall: decision.pace.shortfall },
              } : null}
              reconciliation={reconVerdict}
              alerts={ccAlerts}
              actuals={{ mmfTotal, govSecurities, bankInstruments, otherAssets, interestToDate, taxToDate, annualisedTax }}
              thisMonth={{ planned: plannedThis, actual: actualThis, expectedInterest, nextAction: nextActionText, nextActionHref, nextMaturity: nextMat ? { label: nextMat.label, atMs: nextMat.atMs, amount: nextMat.amount, href: nextMat.href } : null }}
              projection={{
                projectedAtGoal: decision?.range.base ?? snapshot.goal.projectedFinalValue,
                target: targetAmount,
                liquidAtGoalPct: decision?.liquidity ? Math.round((decision.liquidity.liquidShare ?? 0) * 100) : (endStateSplit ? Math.round(((endStateSplit.liquidPot ?? 0) > 0 ? 1 : 0) * 100) : null),
                worst: decision?.range.low ?? 0,
                best: decision?.range.high ?? 0,
              }}
              goalDateLabel={goalDateLabel}
              managerMode={isManager}
            />
          );
        })()}

        {/* ── Manager diagnostics (Manager mode only) ──────────────────────── */}
        {isManager && snapshot && settings && (() => {
          const dReconVerdict = recon
            ? {
                reconciled:
                  !!recon.full?.reconciled &&
                  !!recon.mmf?.ok &&
                  (recon.gov?.ok ?? true) &&
                  (recon.bank?.ok ?? true) &&
                  (recon.govAccrual?.ok ?? true) &&
                  (recon.bankAccrual?.ok ?? true) &&
                  (recon.planPolicy?.ok ?? true) &&
                  (recon.basis?.fullOk ?? true),
                basisOk: recon.basis ? !!recon.basis.fullOk : true,
              }
            : snapshot.reconciliation
              ? { reconciled: snapshot.reconciliation.ok, basisOk: true }
              : null;
          return (
          <div className="pt-1 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Manager diagnostics
              <span className="h-px flex-1 bg-border" />
            </div>
            <DashboardDiagnostics
              snapshot={snapshot}
              concentration={concentration}
              typeBreach={typeBreach}
              reconVerdict={dReconVerdict}
              settings={{
                ratesLastUpdatedAt: (settings as any)?.ratesLastUpdatedAt ?? null,
                mmfYield: settings.mmfYield,
                selectedFundEar: (settings as any)?.selectedFundEar ?? null,
                tbill91Rate: settings.tbill91Rate,
                withholdingTax: settings.withholdingTax,
              }}
              liquidPctAtGoal={liquidPctAtGoal}
              landsFullyLiquid={landsFullyLiquid}
              secondaryMmfCount={secondaryMmfs.length}
            />
          </div>
          );
        })()}

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

      {/* Part 5 (line-item #14): Test → Live deposit safety gate. */}
      <Dialog open={liveDepositConfirmOpen} onOpenChange={setLiveDepositConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              Record into LIVE tracking?
            </DialogTitle>
            <DialogDescription className="pt-1 leading-relaxed">
              You're currently on the <strong className="text-amber-600 dark:text-amber-400">Test (sandbox)</strong> dashboard,
              but “Record a Deposit” writes into your <strong className="text-foreground">real, live</strong> portfolio tracking —
              not the sandbox. Sample data you're exploring here will not be affected, but the deposit you enter
              <strong className="text-foreground"> will be recorded as real money</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
            If you only want to experiment, cancel and use the Time Machine on the sandbox instead. Continue only if you
            intend to log an actual deposit.
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLiveDepositConfirmOpen(false)}>Cancel — stay in Test</Button>
            <Button
              onClick={() => { setLiveDepositConfirmOpen(false); openDrawer(); }}
              className="bg-amber-600 text-white hover:bg-amber-600/90"
            >
              Continue to Live deposit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      </TooltipProvider>
    </AppShell>
  );
}
