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
} from "lucide-react";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const PHASE_BANDS = [
  { start: 1, end: 24, label: "Foundation", color: "oklch(0.65 0.15 200 / 0.08)" },
  { start: 25, end: 84, label: "Growth", color: "oklch(0.70 0.12 160 / 0.08)" },
  { start: 85, end: 102, label: "De-risking", color: "oklch(0.78 0.14 85 / 0.08)" },
  { start: 103, end: 120, label: "Final Liquidity", color: "oklch(0.65 0.15 280 / 0.08)" },
];

const YEAR_LABELS = [12, 24, 36, 48, 60, 72, 84, 96, 108, 120];

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
  const utils = trpc.useUtils();
  const { data: projection, isLoading: projLoading } = trpc.projection.run.useQuery();
  const { data: milestones } = trpc.projection.milestones.useQuery();
  const { data: settings, isLoading: settingsLoading } = trpc.settings.get.useQuery();
  const { data: actualsSummary } = trpc.deposits.summary.useQuery();

  const saveMutation = trpc.settings.save.useMutation({
    onSuccess: () => {
      toast.success("Target updated — all projections recalculated");
      utils.settings.get.invalidate();
      utils.projection.run.invalidate();
      utils.projection.scenarios.invalidate();
      utils.projection.contributionSchedule.invalidate();
      utils.projection.milestones.invalidate();
      utils.deposits.summary.invalidate();
      setTargetDialogOpen(false);
    },
    onError: () => toast.error("Failed to update target"),
  });

  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  function openTargetDialog() {
    setTargetInput(String(settings?.targetAmount ?? 5000000));
    setTargetDialogOpen(true);
  }

  function saveTarget() {
    const val = parseFloat(targetInput.replace(/,/g, ""));
    if (!val || val < 100000) {
      toast.error("Please enter a valid target amount (minimum KES 100,000)");
      return;
    }
    if (!settings) return;
    saveMutation.mutate({
      ...settings,
      targetAmount: val,
      startDate: settings.startDate ? String(settings.startDate).split("T")[0] : "2026-07-01",
    });
  }

  const targetAmount = settings?.targetAmount ?? 5000000;
  const lastData = projection?.[119];
  const currentMonth = 1;
  const currentData = projection?.[currentMonth - 1];

  const projectedFinalValue = lastData?.totalEnd ?? 0;
  const progressPct = targetAmount > 0 ? Math.min((projectedFinalValue / targetAmount) * 100, 100) : 0;
  const surplusOrShortfall = projectedFinalValue - targetAmount;
  const willHitTarget = projectedFinalValue >= targetAmount;

  const chartData = useMemo(() => {
    if (!projection) return [];
    return projection.map((r) => ({
      month: r.monthNumber,
      total: r.totalEnd,
      mmf: r.mmfEnd,
      tbill: r.tbillEnd,
      ifb: r.ifbEnd,
      fxd: r.fxdEnd,
    }));
  }, [projection]);

  const currentPhase = currentData ? currentData.phase : "foundation";

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
              10-year journey to {formatKES(targetAmount)} · SanlamAllianz MMF + CBK DhowCSD
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
              <strong className="text-foreground">What does "Projected at Month 120" mean?</strong>{" "}
              This is the computer's best estimate of how much money you will have after exactly 10 years (120 monthly contributions),
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
                  Projected Portfolio Value at Year 10
                </p>
                {projLoading ? (
                  <Skeleton className="h-10 w-52 mt-1" />
                ) : (
                  <p className="text-4xl font-bold gradient-text kes-amount" style={{ fontFamily: "'Playfair Display', serif" }}>
                    {formatKES(projectedFinalValue)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1.5">
                  This is what the engine calculates you will accumulate by Month 120 if you follow the plan exactly.
                </p>
              </div>

              {/* Target amount — editable */}
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground mb-1">Your Goal</p>
                <div className="flex items-center gap-2 justify-end">
                  {settingsLoading ? (
                    <Skeleton className="h-7 w-32" />
                  ) : (
                    <p className="text-xl font-bold text-primary kes-amount">
                      {formatKES(targetAmount)}
                    </p>
                  )}
                  <button
                    onClick={openTargetDialog}
                    className="w-6 h-6 rounded-md bg-muted hover:bg-primary/20 flex items-center justify-center transition-colors"
                    title="Change your target amount"
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
            <p className="text-xs text-muted-foreground mt-2">
              The bar shows how far your projected final value ({formatKESCompact(projectedFinalValue)}) reaches toward your {formatKES(targetAmount)} goal.
              A full bar means the plan hits the target.
            </p>
          </CardContent>
        </Card>

        {/* ── Asset Allocation Cards ──────────────────────────────────────── */}
        <div>
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <Info className="w-3 h-3" />
            These are the <strong className="text-foreground">projected balances in each bucket at Month 120</strong> — how your money is spread across the four investment instruments at the end of the 10-year plan.
          </p>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {projLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}><CardContent className="p-5"><Skeleton className="h-16 w-full" /></CardContent></Card>
              ))
            ) : (
              <>
                <StatCard
                  title="MMF Balance"
                  value={formatKESCompact(lastData?.mmfEnd ?? 0)}
                  subtitle="SanlamAllianz MMF"
                  icon={Wallet}
                  accent
                  tooltip="Your SanlamAllianz Money Market Fund balance at Year 10. This is your liquid cash buffer — money you can access any time. It earns daily interest (net ~7.5% p.a. after 15% WHT)."
                />
                <StatCard
                  title="T-Bills"
                  value={formatKESCompact(lastData?.tbillEnd ?? 0)}
                  subtitle="CBK Treasury Bills"
                  icon={TrendingUp}
                  tooltip="Your total invested in CBK Treasury Bills at Year 10. T-bills are short-term (91–364 days), very safe government instruments. You earn a discount return (net ~7.5% p.a. after 15% WHT deducted at source)."
                />
                <StatCard
                  title="IFB Holdings"
                  value={formatKESCompact(lastData?.ifbEnd ?? 0)}
                  subtitle="Tax-exempt bonds"
                  icon={Shield}
                  tooltip="Your total invested in Infrastructure Finance Bonds at Year 10. IFBs pay a semi-annual coupon (e.g. 12.5% p.a.) and are 100% tax-exempt — you keep every shilling of interest earned."
                />
                <StatCard
                  title="FXD Bonds"
                  value={formatKESCompact(lastData?.fxdEnd ?? 0)}
                  subtitle="Fixed coupon bonds"
                  icon={Landmark}
                  tooltip="Your total invested in Fixed Coupon Bonds at Year 10. FXDs pay a semi-annual coupon (e.g. 12.35% gross, ~10.5% net after 15% WHT). They provide predictable income but the WHT is deducted before you receive the coupon."
                />
              </>
            )}
          </div>
        </div>

        {/* ── Portfolio Growth Chart ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Portfolio Growth Projection (120 Months)
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
                    tickFormatter={(v) => (YEAR_LABELS.includes(v) ? `Yr ${v / 12}` : "")}
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
                  {YEAR_LABELS.map((m) => (
                    <ReferenceLine key={m} x={m} stroke="oklch(0.30 0.03 250)" strokeDasharray="2 4" />
                  ))}
                  <Area type="monotone" dataKey="mmf" name="MMF" stackId="1" stroke="oklch(0.65 0.15 200)" fill="url(#mmfGrad)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="tbill" name="T-Bills" stackId="1" stroke="oklch(0.70 0.12 160)" fill="oklch(0.70 0.12 160 / 0.1)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="ifb" name="IFB" stackId="1" stroke="oklch(0.78 0.14 85)" fill="url(#totalGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="fxd" name="FXD" stackId="1" stroke="oklch(0.65 0.15 280)" fill="oklch(0.65 0.15 280 / 0.1)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            )}
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-border">
              {PHASE_BANDS.map((b) => (
                <div key={b.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-3 h-2 rounded-sm" style={{ background: b.color.replace("0.08", "0.5") }} />
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
              <Link href="/deposits">
                <span className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer">
                  Record a deposit <ArrowRight className="w-3 h-3" />
                </span>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {actualsSummary && actualsSummary.entryCount === 0 ? (
              <div className="flex items-center gap-3 rounded-lg bg-muted/40 border border-border p-4 text-sm text-muted-foreground">
                <PiggyBank className="w-5 h-5 shrink-0 opacity-50" />
                <span>
                  No deposits recorded yet.{" "}
                  <Link href="/deposits">
                    <span className="text-primary underline cursor-pointer">Record your first deposit</span>
                  </Link>{" "}
                  to see your live actuals here.
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
              </div>
            )}
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
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "MMF Yield (gross)", value: formatPct(settings.mmfYield), note: "net ~" + formatPct(settings.mmfYield * 0.85) },
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
            </CardContent>
          </Card>
        )}

      </div>

      {/* ── Change Target Dialog ─────────────────────────────────────────── */}
      <Dialog open={targetDialogOpen} onOpenChange={setTargetDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Change Your Investment Target</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">What changes when you update this?</strong>
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
              <label className="text-xs font-medium text-foreground">New Target Amount (KES)</label>
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
              disabled={saveMutation.isPending}
              className="bg-primary text-primary-foreground"
            >
              {saveMutation.isPending ? "Saving…" : "Update Target & Recalculate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AppShell>
  );
}
