import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, formatKESCompact } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { BarChart3, CheckCircle2, XCircle, Info } from "lucide-react";

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

export default function Scenarios() {
  const { data: scenarios, isLoading } = trpc.projection.scenarios.useQuery();
  const { data: settings } = trpc.settings.get.useQuery();
  const targetAmount = settings?.targetAmount ?? 5000000;

  const chartData = scenarios?.map((s) => ({
    stepUp: s.stepUp,
    "Projected Value": s.projectedEndingValue,
    hitsTarget: s.hitsTarget,
  }));

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Scenario Comparison
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Side-by-side projections for different step-up amounts — see which path hits {formatKES(targetAmount)}
          </p>
        </div>

        {/* Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Projected 10-Year Value by Step-Up Amount
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
                            ? entry.stepUp === 3000
                              ? "oklch(0.78 0.14 85)"
                              : "oklch(0.70 0.12 160)"
                            : "oklch(0.40 0.05 250)"
                        }
                        fillOpacity={entry.stepUp === 3000 ? 1 : 0.75}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            {/* Target line annotation */}
            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <div className="w-4 h-0.5 bg-primary" />
              <span>{formatKESCompact(targetAmount)} target</span>
              <div className="w-3 h-3 rounded-sm bg-primary/80 ml-4" />
              <span>Recommended (KES 3,000 step-up)</span>
              <div className="w-3 h-3 rounded-sm bg-muted ml-4" />
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
                      const isRecommended = s.stepUp === 3000;
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
                                  Recommended
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

        {/* Insight */}
        <Card className="border-primary/20">
          <CardContent className="p-5">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                <BarChart3 className="w-4 h-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">Strategy Insight</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  The <strong className="text-foreground">KES 3,000 step-up every 6 months</strong> is the recommended path — it hits the {formatKES(targetAmount)} target with a comfortable surplus while keeping monthly contributions manageable. Starting at KES 2,500 and stepping up every 6 months, the plan leverages the power of compounding through the MMF + DhowCSD velocity loop. If you change your target above, the green/red status in the table above updates automatically to reflect which step-up amounts reach your new goal.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
