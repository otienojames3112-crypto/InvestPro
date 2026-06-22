/**
 * SecondaryWhatIf
 *
 * Interactive "what-if" overlay for the Scenarios page. Lets the user adjust
 * the monthly contribution of any tracked secondary MMF account and instantly
 * see the projected impact on the portfolio's ending value — baseline vs
 * what-if — without changing any saved data.
 *
 * The math is the projection engine (server `projection.whatIf`); this
 * component only sends contribution overrides and renders the comparison.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatKES, formatKESCompact } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { FlaskConical, ArrowRight, RotateCcw, TrendingUp, TrendingDown, Info } from "lucide-react";

interface Props {
  portfolioId: number;
}

export function SecondaryWhatIf({ portfolioId }: Props) {
  const { data: secondaries, isLoading } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId },
    { enabled: !!portfolioId }
  );

  // Local edits keyed by secondary id -> contribution string.
  const [edits, setEdits] = useState<Record<number, string>>({});
  // Overrides that have been "applied" (drive the query).
  const [applied, setApplied] = useState<Array<{ secondaryMmfId: number; monthlyContribution: number }>>([]);

  const hasAccounts = (secondaries?.length ?? 0) > 0;

  const whatIf = trpc.projection.whatIf.useQuery(
    { portfolioId, overrides: applied },
    { enabled: !!portfolioId && applied.length > 0 }
  );

  const baselineContribOf = (id: number) =>
    Number(secondaries?.find((s) => s.id === id)?.monthlyContribution ?? 0);

  const dirty = useMemo(() => {
    if (!secondaries) return false;
    return secondaries.some((s) => {
      const raw = edits[s.id];
      if (raw === undefined || raw === "") return false;
      return Number(raw) !== baselineContribOf(s.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, secondaries]);

  const handleApply = () => {
    if (!secondaries) return;
    const overrides = secondaries
      .map((s) => {
        const raw = edits[s.id];
        if (raw === undefined || raw === "") return null;
        const v = Number(raw);
        if (Number.isNaN(v) || v < 0) return null;
        if (v === baselineContribOf(s.id)) return null;
        return { secondaryMmfId: s.id, monthlyContribution: v };
      })
      .filter((x): x is { secondaryMmfId: number; monthlyContribution: number } => x !== null);
    setApplied(overrides);
  };

  const handleReset = () => {
    setEdits({});
    setApplied([]);
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

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary" />
          What-if: Secondary MMF contributions
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Try a different monthly contribution for any tracked MMF account and see the projected impact on your
          ending value. Nothing is saved — this is a sandbox for exploring "what if I put more into fund X?".
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-xs text-muted-foreground">Loading accounts…</p>}

        {!isLoading && !hasAccounts && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Info className="w-4 h-4 shrink-0" />
            No secondary MMF accounts yet. Add one on the <strong>MMF Funds</strong> page to use the what-if tool.
          </div>
        )}

        {hasAccounts && (
          <>
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

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={handleApply} disabled={!dirty || whatIf.isFetching}>
                {whatIf.isFetching ? "Calculating…" : "Apply what-if"}
                {!whatIf.isFetching && <ArrowRight className="w-3.5 h-3.5 ml-1" />}
              </Button>
              {applied.length > 0 && (
                <Button size="sm" variant="outline" onClick={handleReset}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
                </Button>
              )}
            </div>

            {result && applied.length > 0 && (
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
                  highlighted secondary MMF contribution(s) differ. This is an exploration only — to make it real, update
                  the account's monthly contribution on the MMF Funds page.
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
