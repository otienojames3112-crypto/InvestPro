import { usePortfolio } from "@/contexts/PortfolioContext";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, formatKESCompact, formatPct, getPhaseName, getPhaseColorClass } from "@/lib/format";
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
  Target,
  ArrowDownCircle,
  PiggyBank,
  Receipt,
  ArrowRight,
  HelpCircle,
  Pencil,
  Info,
  Clock,
} from "lucide-react";
import { Link } from "wouter";
import { useDepositDrawer } from "@/contexts/DepositDrawerContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { CreatePortfolioDialog } from "@/components/PortfolioSelector";
import { Plus, Compass } from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { rateStaleness } from "@/lib/rateStaleness";
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

export default function Dashboard() {
  const { portfolioId, portfolio, portfolios, isLoading: portfoliosLoading } = usePortfolio();
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
          </div>
          <Badge variant="outline" className={`text-xs px-3 py-1 border ${getPhaseColorClass(currentPhase)}`}>
            {getPhaseName(currentPhase)} Phase
          </Badge>
        </div>

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
                      <span className="text-emerald-400 inline-flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Lands fully liquid at goal —
                        {" "}{liquidPctAtGoal.toFixed(0)}% in cash/MMF, withdrawable on the goal date
                      </span>
                    ) : (
                      <span className="text-amber-400 inline-flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> {liquidPctAtGoal.toFixed(0)}% liquid at goal —
                        {" "}{formatKES(lockedAtGoal)} still in securities at Month {horizonMonths}
                      </span>
                    )}
                  </p>
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
                ...(usesBankInstruments ? [{ title: "Bank Deposits", key: "bankEnd" as const, subtitle: "Call / fixed deposits", icon: Landmark, accent: false, tooltip: `Your recorded bank call and fixed deposits, projected forward at their own rates (net of WHT) at Year ${horizonYearsLabel}. Call deposits are liquid like the MMF; fixed deposits lock for a tenor and forfeit interest if broken early.` }] : []),
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
                  <p className="text-xs text-muted-foreground mt-2">
                    15% WHT on MMF, T-Bill &amp; FXD income. Deducted at source — you never pay this separately.
                  </p>
                  <p className="text-xs text-emerald-400 mt-1">
                    IFB bonds: fully tax-exempt
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
                  <p className="text-xs text-muted-foreground mt-2">
                    Net of WHT, accrued from each deposit&rsquo;s date to today at the current fund yield (geometric daily compounding).
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
              {(() => {
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

    </AppShell>
  );
}
