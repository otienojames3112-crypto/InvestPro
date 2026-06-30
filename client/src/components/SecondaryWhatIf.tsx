/**
 * SecondaryWhatIf
 *
 * Interactive "what-if" overlay for the Scenarios page. Lets the user adjust:
 *   - the monthly contribution of any tracked secondary MMF account, and
 *   - the PRIMARY starting monthly contribution + step-up amount,
 * and instantly see the projected impact on the portfolio's ending value
 * (baseline vs what-if) without changing any saved data.
 *
 * A one-click "Apply this what-if" button persists the explored values back to
 * the live accounts/portfolio via `projection.applyWhatIf`.
 *
 * The math is the projection engine (server `projection.whatIf`); this
 * component only sends overrides and renders the comparison.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { invalidatePortfolioMoney } from "@/lib/invalidatePortfolioMoney";
import { formatKES, formatKESCompact } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { FlaskConical, ArrowRight, RotateCcw, TrendingUp, TrendingDown, Info, Save, Check } from "lucide-react";
import { toast } from "sonner";

interface Props {
  portfolioId: number;
  /** Current primary starting monthly contribution (KES). */
  primaryContribution: number;
  /** Current primary step-up amount (KES). */
  primaryStepUp: number;
  /** How often the step-up applies, in months (for copy only). */
  stepUpMonths: number;
  /** Called after a successful apply so the parent can refetch the plan. */
  onApplied?: () => void;
}

export function SecondaryWhatIf({
  portfolioId,
  primaryContribution,
  primaryStepUp,
  stepUpMonths,
  onApplied,
}: Props) {
  const utils = trpc.useUtils();
  const { data: secondaries, isLoading } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId },
    { enabled: !!portfolioId }
  );

  // Local edits keyed by secondary id -> contribution string.
  const [edits, setEdits] = useState<Record<number, string>>({});
  // Primary edits (undefined = untouched).
  const [primaryEdit, setPrimaryEdit] = useState<string | undefined>(undefined);
  const [stepUpEdit, setStepUpEdit] = useState<string | undefined>(undefined);

  // Applied overrides that drive the query.
  const [applied, setApplied] = useState<{
    overrides: Array<{ secondaryMmfId: number; monthlyContribution: number }>;
    primaryContribution?: number;
    primaryStepUpAmount?: number;
  } | null>(null);

  const hasAccounts = (secondaries?.length ?? 0) > 0;

  const whatIf = trpc.projection.whatIf.useQuery(
    {
      portfolioId,
      overrides: applied?.overrides ?? [],
      primaryContribution: applied?.primaryContribution,
      primaryStepUpAmount: applied?.primaryStepUpAmount,
    },
    { enabled: !!portfolioId && applied !== null }
  );

  const applyMutation = trpc.projection.applyWhatIf.useMutation({
    onSuccess: async (res) => {
      await invalidatePortfolioMoney(utils, portfolioId);
      onApplied?.();
      toast.success("What-if applied", {
        description:
          `Saved ${res.appliedSecondaries} secondary contribution${res.appliedSecondaries === 1 ? "" : "s"}` +
          (res.portfolioUpdated ? " and your primary plan." : "."),
      });
      // Clear edits — the new baseline now reflects what we just saved.
      setEdits({});
      setPrimaryEdit(undefined);
      setStepUpEdit(undefined);
      setApplied(null);
    },
    onError: (e) => toast.error("Could not apply what-if", { description: e.message }),
  });

  const baselineContribOf = (id: number) =>
    Number(secondaries?.find((s) => s.id === id)?.monthlyContribution ?? 0);

  // Build the set of overrides currently entered (differing from baseline).
  const buildOverrides = () => {
    if (!secondaries) return [];
    return secondaries
      .map((s) => {
        const raw = edits[s.id];
        if (raw === undefined || raw === "") return null;
        const v = Number(raw);
        if (Number.isNaN(v) || v < 0) return null;
        if (v === baselineContribOf(s.id)) return null;
        return { secondaryMmfId: s.id, monthlyContribution: v };
      })
      .filter((x): x is { secondaryMmfId: number; monthlyContribution: number } => x !== null);
  };

  const primaryOverride = useMemo(() => {
    if (primaryEdit === undefined || primaryEdit === "") return undefined;
    const v = Number(primaryEdit);
    if (Number.isNaN(v) || v < 0 || v === primaryContribution) return undefined;
    return v;
  }, [primaryEdit, primaryContribution]);

  const stepUpOverride = useMemo(() => {
    if (stepUpEdit === undefined || stepUpEdit === "") return undefined;
    const v = Number(stepUpEdit);
    if (Number.isNaN(v) || v < 0 || v === primaryStepUp) return undefined;
    return v;
  }, [stepUpEdit, primaryStepUp]);

  const dirty = useMemo(() => {
    const secDirty = buildOverrides().length > 0;
    return secDirty || primaryOverride !== undefined || stepUpOverride !== undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, secondaries, primaryOverride, stepUpOverride]);

  const handleApply = () => {
    setApplied({
      overrides: buildOverrides(),
      primaryContribution: primaryOverride,
      primaryStepUpAmount: stepUpOverride,
    });
  };

  const handleReset = () => {
    setEdits({});
    setPrimaryEdit(undefined);
    setStepUpEdit(undefined);
    setApplied(null);
  };

  const handleSave = () => {
    if (!applied) return;
    applyMutation.mutate({
      portfolioId,
      overrides: applied.overrides,
      primaryContribution: applied.primaryContribution,
      primaryStepUpAmount: applied.primaryStepUpAmount,
    });
  };

  const result = whatIf.data;
  const chartData = useMemo(() => {
    if (!result) return [];
    const map = new Map<number, { month: number; Baseline: number; "What-if": number }>();
    for (const p of result.baseline.series) {
      map.set(p.month, { month: p.month, Baseline: p.total, "What-if": p.total });
    }
    for (const p of result.whatIf.series) {
      const row = map.get(p.month);
      if (row) row["What-if"] = p.total;
      else map.set(p.month, { month: p.month, Baseline: p.total, "What-if": p.total });
    }
    return Array.from(map.values()).sort((a, b) => a.month - b.month);
  }, [result]);

  const primaryShown = primaryEdit === undefined ? String(primaryContribution) : primaryEdit;
  const stepUpShown = stepUpEdit === undefined ? String(primaryStepUp) : stepUpEdit;

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary" />
          What-if: contributions
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Try different monthly contributions — for your primary plan and any tracked secondary MMF — and see the
          projected impact on your ending value. Nothing changes until you choose <strong>Apply this what-if</strong>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Primary contribution + step-up */}
        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="default" className="text-[10px] px-1.5 py-0">Primary plan</Badge>
            <span className="text-xs text-muted-foreground">
              Currently {formatKES(primaryContribution)}/mo
              {primaryStepUp > 0 ? <>, +{formatKES(primaryStepUp)} every {stepUpMonths} mo</> : ", no step-up"}
            </span>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="w-44">
              <Label className="text-[10px] text-muted-foreground">What-if starting monthly (KES)</Label>
              <Input
                type="number"
                min="0"
                step="1000"
                className="mt-1 h-8 text-sm"
                value={primaryShown}
                onChange={(e) => setPrimaryEdit(e.target.value)}
              />
            </div>
            <div className="w-44">
              <Label className="text-[10px] text-muted-foreground">What-if step-up (KES)</Label>
              <Input
                type="number"
                min="0"
                step="500"
                className="mt-1 h-8 text-sm"
                value={stepUpShown}
                onChange={(e) => setStepUpEdit(e.target.value)}
              />
            </div>
          </div>
        </div>

        {isLoading && <p className="text-xs text-muted-foreground">Loading accounts…</p>}

        {!isLoading && !hasAccounts && (
          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
            <Info className="w-4 h-4 shrink-0" />
            No secondary MMF accounts yet — you can still explore primary-plan what-ifs above. Add a secondary fund on
            the <strong>MMF Funds</strong> page to model it here.
          </div>
        )}

        {hasAccounts && (
          <div className="space-y-2">
            {secondaries!.map((s) => {
              const current = baselineContribOf(s.id);
              const raw = edits[s.id];
              const shown = raw === undefined ? String(current) : raw;
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3 flex-wrap rounded-lg border border-border/60 bg-background/60 p-3"
                >
                  <div className="flex-1 min-w-[160px]">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{s.label || s.fundName}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {Number(s.ear).toFixed(2)}% EAR
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Current: {formatKES(current)}/mo
                    </p>
                  </div>
                  <div className="w-40">
                    <Label className="text-[10px] text-muted-foreground">What-if monthly (KES)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="500"
                      className="mt-1 h-8 text-sm"
                      value={shown}
                      onChange={(e) => setEdits((p) => ({ ...p, [s.id]: e.target.value }))}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={handleApply} disabled={!dirty || whatIf.isFetching}>
            {whatIf.isFetching ? "Calculating…" : "Preview what-if"}
            {!whatIf.isFetching && <ArrowRight className="w-3.5 h-3.5 ml-1" />}
          </Button>
          {applied !== null && (
            <Button size="sm" variant="outline" onClick={handleReset}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
            </Button>
          )}

          {/* Apply (persist) — only when there's a previewed result. */}
          {result && applied !== null && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  className="ml-auto bg-emerald-600 hover:bg-emerald-600/90 text-white"
                  disabled={applyMutation.isPending}
                >
                  {applyMutation.isPending ? (
                    <>Applying…</>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5 mr-1" /> Apply this what-if
                    </>
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Apply this what-if to your plan?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-sm">
                      <p>This saves the explored contributions to your live plan:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        {applied.primaryContribution !== undefined && (
                          <li>
                            Primary monthly: {formatKES(primaryContribution)} → <strong>{formatKES(applied.primaryContribution)}</strong>
                          </li>
                        )}
                        {applied.primaryStepUpAmount !== undefined && (
                          <li>
                            Step-up: {formatKES(primaryStepUp)} → <strong>{formatKES(applied.primaryStepUpAmount)}</strong>
                          </li>
                        )}
                        {applied.overrides.map((o) => {
                          const s = secondaries?.find((x) => x.id === o.secondaryMmfId);
                          return (
                            <li key={o.secondaryMmfId}>
                              {s?.label || s?.fundName || `Fund #${o.secondaryMmfId}`}: {formatKES(baselineContribOf(o.secondaryMmfId))} →{" "}
                              <strong>{formatKES(o.monthlyContribution)}</strong>/mo
                            </li>
                          );
                        })}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        Your projection, scenarios, and milestones will update to match.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-emerald-600 hover:bg-emerald-600/90 text-white"
                    onClick={handleSave}
                  >
                    <Check className="w-3.5 h-3.5 mr-1" /> Save to plan
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {result && applied !== null && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Baseline ending value</p>
                <p className="text-lg font-bold text-foreground kes-amount mt-0.5">
                  {formatKES(result.baseline.finalValue)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">What-if ending value</p>
                <p className="text-lg font-bold text-primary kes-amount mt-0.5">
                  {formatKES(result.whatIf.finalValue)}
                </p>
              </div>
              <div
                className={`rounded-lg p-3 ${
                  result.delta >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"
                }`}
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  {result.delta >= 0 ? (
                    <TrendingUp className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-red-400" />
                  )}
                  Difference
                </p>
                <p
                  className={`text-lg font-bold kes-amount mt-0.5 ${
                    result.delta >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {result.delta >= 0 ? "+" : "−"}
                  {formatKES(Math.abs(result.delta))}
                </p>
              </div>
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={(m) => `M${m}`}
                    tick={{ fontSize: 10 }}
                    stroke="currentColor"
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tickFormatter={(v) => formatKESCompact(Number(v))}
                    tick={{ fontSize: 10 }}
                    width={56}
                    stroke="currentColor"
                    className="text-muted-foreground"
                  />
                  <Tooltip
                    formatter={(v: number, name: string) => [formatKES(Number(v)), name]}
                    labelFormatter={(m) => `Month ${m}`}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="Baseline"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="What-if"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Both lines use the same projection engine, target, horizon, and rates as the rest of the app. Only the
              contributions you changed differ. Use <strong>Apply this what-if</strong> to make it your saved plan.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
