import { usePortfolio } from "@/contexts/PortfolioContext";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, formatKESCompact } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, CheckCircle2, XCircle, Info, AlertTriangle, Lightbulb, Wallet, ClipboardList, Sparkles } from "lucide-react";
import { SecondaryWhatIf } from "@/components/SecondaryWhatIf";
import { ScenarioLevers } from "@/components/ScenarioLevers";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { AiExplainDialog } from "@/components/AiExplainDialog";

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-2">Step-Up: +KES {label?.toLocaleString()}/period</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground kes-amount">{formatKES(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

type ScenarioBasis = "actual" | "clean";

export default function Scenarios({ embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId, portfolio } = usePortfolio();

  // R-Scenarios: the basis is explicit and user-selectable. "actual" projects
  // forward from real recorded history (matches Dashboard/Ledger); "clean"
  // projects the scheduled plan only. Default to "actual".
  const [basis, setBasis] = useState<ScenarioBasis>("actual");

  const { data: scenarioData, isLoading } = trpc.projection.scenarios.useQuery(
    { portfolioId: portfolioId!, basis },
    { enabled: !!portfolioId }
  );
  const scenarios = scenarioData?.scenarios;
  const meta = scenarioData?.meta;
  // The user's CURRENT plan projection — single source of truth for surplus/shortfall.
  const { data: projection, isLoading: projLoading } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // The solver, run at the portfolio's own step-up cadence. Same engine, same inputs.
  const { data: solver, isLoading: solverLoading } = trpc.projection.solve.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  const targetAmount = Number(portfolio?.targetAmount ?? 0);
  const horizonMonths = portfolio?.horizonMonths ?? 120;
  const stepUpMonths = portfolio?.stepUpMonths ?? 6;
  const currentStepUp = Number(portfolio?.stepUpAmount ?? 0);
  const currentStart = Number(portfolio?.startingContribution ?? 0);

  // Baseline projected ending value. Under the "actual" basis this comes from the
  // scenario meta (the scenario at the portfolio's own step-up), which equals the
  // Dashboard/Ledger projection. Under "clean" it is the schedule-only baseline.
  // We fall back to the run() projection while the scenario query is loading.
  const runEndingValue = projection?.length ? projection[projection.length - 1].totalEnd : 0;
  const currentEndingValue = meta?.baselineProjectedEndingValue ?? runEndingValue;
  const currentGap = currentEndingValue - targetAmount;
  const currentHits = currentGap >= 0;

  // Derive the recommended step-up dynamically: the LOWEST step-up in the scenario
  // set whose projection reaches the target. Never hardcoded.
  const recommendedScenario = scenarios
    ?.slice()
    .sort((a, b) => a.stepUp - b.stepUp)
    .find((s) => s.hitsTarget);
  const recommendedStepUp = recommendedScenario?.stepUp ?? null;

  const chartData = scenarios?.map((s) => ({
    stepUp: s.stepUp,
    "Projected Value": s.projectedEndingValue,
    hitsTarget: s.hitsTarget,
    isRecommended: s.stepUp === recommendedStepUp,
  }));

  const everythingLoading = isLoading || projLoading || solverLoading;

  const [scenExplainOpen, setScenExplainOpen] = useState(false);
  const scenFacts = useMemo(() => {
    const l: string[] = [`Target: ${formatKES(targetAmount)} over ${horizonMonths} months.`];
    if (scenarioData?.scenarios?.length) l.push(`Scenarios: ${scenarioData.scenarios.length} step-up variants computed.`);
    l.push(`Basis: ${basis}.`);
    return l.join("\n");
  }, [targetAmount, horizonMonths, scenarioData, basis]);
  const scenExplainQuery = trpc.aiExplain.scenarioAllocation.useQuery(
    { portfolioId: portfolioId!, scenarioSummary: scenFacts },
    { enabled: scenExplainOpen && !!portfolioId, refetchOnWindowFocus: false, retry: false },
  );

  return (
    <AppShell embedded={embedded}>
      <div className="p-6 lg:p-8 space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Scenario Comparison
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Side-by-side projections for different step-up amounts — see which path reaches {formatKES(targetAmount)} over {horizonMonths} months
          </p>
          <p className="text-xs text-muted-foreground/80 mt-1.5 max-w-3xl">
            These are <strong>forward-looking</strong> projections over the full {horizonMonths}-month horizon. Every scenario uses the same engine,
            target and accounts, so the only thing that differs between them is the step-up. What they <strong>start</strong> from depends on the
            basis you choose below.
          </p>
          <p className="text-xs text-muted-foreground/80 mt-1.5 max-w-3xl">
            Each line here is a single contribution-and-interest path for your fixed-income core, so it is shown as one number. If you hold
            market-priced investments (equities, REITs, offshore funds), their value rises and falls — the <strong>goal-probability range</strong> on the
            Dashboard reflects that uncertainty, which these step-up lines deliberately do not.
          </p>
        </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setScenExplainOpen(true)}
            className="h-7 gap-1.5 text-xs font-medium hover:text-violet-500 hover:border-violet-500/40 active:scale-[0.97] transition-transform"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Explain scenarios
          </Button>
        </div>

        {/* ── Scenario basis toggle (R-Scenarios) ── */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-foreground">Scenario basis</p>
                  <p className="text-xs text-muted-foreground">Choose what every scenario below starts from.</p>
                </div>
                <div className="inline-flex rounded-lg border border-border bg-muted/30 p-0.5" role="tablist" aria-label="Scenario basis">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={basis === "actual"}
                    onClick={() => setBasis("actual")}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      basis === "actual" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Wallet className="w-3.5 h-3.5" />
                    From actual portfolio today
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={basis === "clean"}
                    onClick={() => setBasis("clean")}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      basis === "clean" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <ClipboardList className="w-3.5 h-3.5" />
                    Clean scheduled plan
                  </button>
                </div>
              </div>

              {basis === "actual" ? (
                <div className="rounded-md bg-emerald-500/10 border border-emerald-500/25 p-3 text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">From actual portfolio today.</strong> Starts from your real current balances and replays your
                  recorded deposits, missed contributions, secondary MMFs, bank instruments, government securities, and Other Assets tagged to the
                  goal — then projects forward using your committed strategy. This matches your <strong>Dashboard</strong> and <strong>Ledger</strong> baseline.
                </div>
              ) : (
                <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-amber-300">Clean schedule — not your recorded actuals.</strong> Ignores your messy history and projects a
                  fresh plan from your target, horizon, planned contribution and selected fund/rates. Useful for planning “what should happen” from a
                  clean start; it does <strong>not</strong> reflect your real balances and will not match the Dashboard or Ledger.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Your current plan: real status from the solver/projection ── */}
        <Card className={currentHits ? "border-emerald-500/30" : "border-amber-500/30"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              {currentHits ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              )}
              Your Current Plan
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {everythingLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Month 1 saving</p>
                    <p className="text-sm font-bold text-foreground kes-amount">{formatKES(currentStart)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Step-up / {stepUpMonths} mo</p>
                    <p className="text-sm font-bold text-foreground kes-amount">
                      {currentStepUp > 0 ? `+${formatKES(currentStepUp)}` : "None"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Projected at Month {horizonMonths}</p>
                    <p className="text-sm font-bold text-foreground kes-amount">{formatKES(currentEndingValue)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">vs {formatKESCompact(targetAmount)} target</p>
                    <p className={`text-sm font-bold kes-amount ${currentHits ? "status-on-track" : "status-behind"}`}>
                      {currentHits ? "+" : "−"}{formatKES(Math.abs(currentGap))}
                    </p>
                  </div>
                </div>

                {currentHits ? (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    On your current settings, the projection reaches {formatKES(currentEndingValue)} at Month {horizonMonths} —
                    a surplus of {formatKES(currentGap)} above your {formatKES(targetAmount)} target. You can adjust your
                    target, horizon, contribution, or step-up at any time on the Rate Settings page; this page updates
                    automatically.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    On your current settings, the projection reaches {formatKES(currentEndingValue)} at Month {horizonMonths} —
                    a shortfall of {formatKES(Math.abs(currentGap))} below your {formatKES(targetAmount)} target. See the
                    options below to close the gap.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Target already met: say so plainly instead of a confusing "how to reach" solver ── */}
        {!everythingLoading && currentHits && (
          <Card className="border-emerald-500/25">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                You're on track to reach {formatKES(targetAmount)}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <p className="text-sm text-foreground leading-relaxed">
                Your current settings already project to <strong>{formatKES(currentEndingValue)}</strong> at Month {horizonMonths} —
                a surplus of <strong className="text-emerald-400">{formatKES(currentGap)}</strong> above target. No change is required.
                If you want a bigger cushion or a faster finish, the table below shows how higher step-ups move the ending value;
                you can also lower the target or shorten the horizon on the Rate Settings page.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── How to reach your target (solver-driven) — only when the current plan falls short ── */}
        {!everythingLoading && !currentHits && solver && (
          <Card className="border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-primary" />
                How to Reach {formatKES(targetAmount)}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 space-y-3">
              {solver.feasible ? (
                <>
                  <p className="text-sm text-foreground leading-relaxed">
                    To reach <strong>{formatKES(targetAmount)}</strong> in {horizonMonths} months
                    {solver.stepUpAmount > 0 ? (
                      <> with a <strong>{formatKES(solver.stepUpAmount)}</strong> step-up every {stepUpMonths} months</>
                    ) : (
                      <> with flat contributions (no step-up)</>
                    )}
                    , start at <strong className="text-primary">{formatKES(solver.requiredStartingContribution)}/month</strong>.
                    That path is projected to end at {formatKES(solver.projectedEndingValue)} (total contributed
                    {" "}{formatKES(solver.totalContributed)}).
                  </p>

                  {currentStart < solver.requiredStartingContribution && (
                    <div className="rounded-md bg-amber-500/10 border border-amber-500/25 p-3 text-xs text-muted-foreground leading-relaxed">
                      Your current Month-1 saving of {formatKES(currentStart)} is below the {formatKES(solver.requiredStartingContribution)} this
                      plan needs. Options to close the gap: <strong className="text-foreground">raise your starting contribution</strong> to
                      {" "}{formatKES(solver.requiredStartingContribution)}, <strong className="text-foreground">increase the step-up</strong> (see the table below),
                      add a <strong className="text-foreground">one-off lump sum</strong> on the Contributions page, <strong className="text-foreground">extend the horizon</strong>,
                      or <strong className="text-foreground">lower the target</strong>.
                    </div>
                  )}

                  {recommendedStepUp !== null && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Holding your Month-1 saving at {formatKES(currentStart)}, the smallest step-up in the table below that still
                      reaches {formatKESCompact(targetAmount)} is <strong className="text-foreground">+{formatKES(recommendedStepUp)}</strong> every
                      {" "}{stepUpMonths} months.
                    </p>
                  )}

                  {solver.isShortHorizon && (
                    <p className="text-xs text-amber-300/90 leading-relaxed">
                      This is a short-horizon plan ({horizonMonths} months). The strategy uses MMF + 91-day T-bills only, so
                      returns are limited and the result is primarily contribution-driven.
                    </p>
                  )}
                </>
              ) : (
                <div className="rounded-md bg-destructive/10 border border-destructive/25 p-3 flex gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {solver.message}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Projected Value at Month {horizonMonths} by Step-Up Amount
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.03 250)" vertical={false} />
                  <XAxis
                    dataKey="stepUp"
                    tick={{ fontSize: 10, fill: "oklch(0.60 0.02 250)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `+${v.toLocaleString()}`}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "oklch(0.60 0.02 250)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatKESCompact(v).replace("KES ", "")}
                    width={55}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="Projected Value" radius={[6, 6, 0, 0]}>
                    <LabelList
                      dataKey="Projected Value"
                      position="top"
                      formatter={(v: number) => formatKESCompact(v).replace("KES ", "")}
                      style={{ fontSize: 10, fill: "oklch(0.60 0.02 250)" }}
                    />
                    {chartData?.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.hitsTarget
                            ? entry.isRecommended
                              ? "oklch(0.78 0.14 85)"
                              : "oklch(0.70 0.12 160)"
                            : "oklch(0.40 0.05 250)"
                        }
                        fillOpacity={entry.isRecommended ? 1 : 0.75}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
              <div className="w-3 h-3 rounded-sm" style={{ background: "oklch(0.78 0.14 85)" }} />
              <span>{recommendedStepUp !== null ? `Smallest step-up that reaches ${formatKESCompact(targetAmount)} (+${recommendedStepUp.toLocaleString()})` : "No step-up reaches target"}</span>
              <div className="w-3 h-3 rounded-sm ml-3" style={{ background: "oklch(0.70 0.12 160)" }} />
              <span>Reaches target</span>
              <div className="w-3 h-3 rounded-sm ml-3" style={{ background: "oklch(0.40 0.05 250)" }} />
              <span>Below target</span>
            </div>
          </CardContent>
        </Card>

        {/* Comparison Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Detailed Comparison</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Step-Up / Period</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Final Monthly Saving</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Total Contributed</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Projected End Value</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">vs {formatKESCompact(targetAmount)} Target</th>
                      <th className="text-center px-4 py-3 text-muted-foreground font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios?.map((s) => {
                      const gap = s.projectedEndingValue - targetAmount;
                      const isRecommended = s.stepUp === recommendedStepUp;
                      return (
                        <tr
                          key={s.stepUp}
                          className={`border-b border-border/40 transition-colors ${
                            isRecommended
                              ? "bg-primary/5 hover:bg-primary/10"
                              : "hover:bg-muted/20"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">
                                +KES {s.stepUp.toLocaleString()}
                              </span>
                              {isRecommended && (
                                <Badge className="text-xs bg-primary/20 text-primary border-primary/30 border">
                                  Smallest that reaches target
                                </Badge>
                              )}
                              {s.stepUp === currentStepUp && (
                                <Badge variant="outline" className="text-xs text-muted-foreground">
                                  Your plan
                                </Badge>
                              )}
                              {s.stepUp === 0 && (
                                <Badge variant="outline" className="text-xs text-muted-foreground">
                                  No step-up
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-foreground kes-amount">
                            {formatKES(s.finalMonthlySaving)}
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground kes-amount">
                            {formatKES(s.totalContributed)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold kes-amount">
                            <span className={s.hitsTarget ? "text-primary" : "text-muted-foreground"}>
                              {formatKES(s.projectedEndingValue)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right kes-amount">
                            <span className={gap >= 0 ? "status-on-track font-medium" : "status-behind font-medium"}>
                              {gap >= 0 ? "+" : ""}{formatKES(Math.abs(gap))} {gap >= 0 ? "surplus" : "shortfall"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {s.hitsTarget ? (
                              <CheckCircle2 className="w-4 h-4 status-on-track mx-auto" />
                            ) : (
                              <XCircle className="w-4 h-4 text-destructive mx-auto" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Other levers: more time, lump sum, risk tier — same engine + basis */}
        {portfolioId && <ScenarioLevers portfolioId={portfolioId} basis={basis} />}

        {/* What-if overlay for secondary MMF contributions */}
        {portfolioId && (
          <SecondaryWhatIf
            portfolioId={portfolioId}
            primaryContribution={currentStart}
            primaryStepUp={currentStepUp}
            stepUpMonths={stepUpMonths}
          />
        )}

        {/* Methodology note */}
        <Card className="border-border/60">
          <CardContent className="p-5">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Info className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">How these figures are produced</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Every number on this page comes from the same projection engine used across the app, applied to this
                  portfolio's own target, horizon, start date, selected fund, rates, and contribution schedule. The
                  "How to reach" guidance and the green/red table are computed from that single engine — they will always
                  agree. Change any setting on the Rate Settings or Contributions page and this page recalculates
                  automatically.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      <AiExplainDialog
        open={scenExplainOpen}
        onOpenChange={setScenExplainOpen}
        title="Explain Scenario Comparison"
        description="A plain-language explanation of how scenario comparison works, what step-up amounts mean, how the basis (actual vs clean) affects projections, and how to interpret the results."
        answer={scenExplainQuery.data?.answer}
        isLoading={scenExplainQuery.isLoading || scenExplainQuery.isFetching}
        isError={scenExplainQuery.isError}
        errorMessage={scenExplainQuery.error?.message}
        onRetry={() => scenExplainQuery.refetch()}
      />
    </AppShell>
  );
}
