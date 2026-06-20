import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, formatKESCompact, formatPct, getPhaseName, getPhaseColorClass } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, TrendingUp, Wallet, Landmark, Shield, Target } from "lucide-react";
import { useMemo } from "react";

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
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  accent?: boolean;
}) {
  return (
    <Card className={`card-hover ${accent ? "border-primary/30 gold-glow" : ""}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">{title}</p>
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

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
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
  const { data: projection, isLoading: projLoading } = trpc.projection.run.useQuery();
  const { data: milestones } = trpc.projection.milestones.useQuery();
  const { data: settings } = trpc.settings.get.useQuery();

  const currentMonth = 1; // In a real tracker this would be calculated from today vs startDate
  const currentData = projection?.[currentMonth - 1];
  const lastData = projection?.[119];

  const progressPct = lastData
    ? Math.min((lastData.totalEnd / 5000000) * 100, 100)
    : 0;

  // Build chart data — sample every month but label every year
  const chartData = useMemo(() => {
    if (!projection) return [];
    return projection.map((r, i) => ({
      month: r.monthNumber,
      total: r.totalEnd,
      mmf: r.mmfEnd,
      tbill: r.tbillEnd,
      ifb: r.ifbEnd,
      fxd: r.fxdEnd,
    }));
  }, [projection]);

  // Year-end milestone data
  const milestoneMonths = YEAR_LABELS;

  const currentPhase = currentData ? currentData.phase : "foundation";

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1
              className="text-2xl font-bold text-foreground"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Investment Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              10-year journey to KES 5,000,000 · SanlamAllianz MMF + CBK DhowCSD
            </p>
          </div>
          <Badge
            variant="outline"
            className={`text-xs px-3 py-1 border ${getPhaseColorClass(currentPhase)}`}
          >
            {getPhaseName(currentPhase)} Phase
          </Badge>
        </div>

        {/* Goal Progress */}
        <Card className="border-primary/20 gold-glow">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Progress to KES 5,000,000
                </p>
                {projLoading ? (
                  <Skeleton className="h-8 w-48 mt-1" />
                ) : (
                  <p className="text-3xl font-bold gradient-text kes-amount mt-1" style={{ fontFamily: "'Playfair Display', serif" }}>
                    {formatKES(lastData?.totalEnd ?? 0)}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Projected at Month 120</p>
                <p className="text-lg font-bold text-primary kes-amount">
                  {progressPct.toFixed(1)}%
                </p>
              </div>
            </div>
            {/* Progress bar */}
            <div className="relative h-3 bg-muted rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/80 to-primary rounded-full transition-all duration-1000"
                style={{ width: `${progressPct}%` }}
              />
              {/* Milestone markers */}
              {[20, 40, 60, 80, 100].map((pct) => (
                <div
                  key={pct}
                  className="absolute top-0 bottom-0 w-px bg-border/50"
                  style={{ left: `${pct}%` }}
                />
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
              <span>KES 0</span>
              <span>KES 1.25M</span>
              <span>KES 2.5M</span>
              <span>KES 3.75M</span>
              <span>KES 5M</span>
            </div>
          </CardContent>
        </Card>

        {/* Stats Grid */}
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
              />
              <StatCard
                title="T-Bills"
                value={formatKESCompact(lastData?.tbillEnd ?? 0)}
                subtitle="CBK Treasury Bills"
                icon={TrendingUp}
              />
              <StatCard
                title="IFB Holdings"
                value={formatKESCompact(lastData?.ifbEnd ?? 0)}
                subtitle="Tax-exempt bonds"
                icon={Shield}
              />
              <StatCard
                title="FXD Bonds"
                value={formatKESCompact(lastData?.fxdEnd ?? 0)}
                subtitle="Fixed coupon bonds"
                icon={Landmark}
              />
            </>
          )}
        </div>

        {/* Portfolio Growth Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Portfolio Growth Projection (120 Months)
            </CardTitle>
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
                  <Tooltip content={<CustomTooltip />} />
                  {/* Target line */}
                  <ReferenceLine
                    y={5000000}
                    stroke="oklch(0.78 0.14 85)"
                    strokeDasharray="6 3"
                    strokeOpacity={0.5}
                    label={{ value: "KES 5M Target", fill: "oklch(0.78 0.14 85)", fontSize: 10, position: "insideTopRight" }}
                  />
                  {/* Year-end milestone markers */}
                  {YEAR_LABELS.map((m) => (
                    <ReferenceLine
                      key={m}
                      x={m}
                      stroke="oklch(0.30 0.03 250)"
                      strokeDasharray="2 4"
                    />
                  ))}
                  <Area
                    type="monotone"
                    dataKey="mmf"
                    name="MMF"
                    stackId="1"
                    stroke="oklch(0.65 0.15 200)"
                    fill="url(#mmfGrad)"
                    strokeWidth={1.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="tbill"
                    name="T-Bills"
                    stackId="1"
                    stroke="oklch(0.70 0.12 160)"
                    fill="oklch(0.70 0.12 160 / 0.1)"
                    strokeWidth={1.5}
                  />
                  <Area
                    type="monotone"
                    dataKey="ifb"
                    name="IFB"
                    stackId="1"
                    stroke="oklch(0.78 0.14 85)"
                    fill="url(#totalGrad)"
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="fxd"
                    name="FXD"
                    stackId="1"
                    stroke="oklch(0.65 0.15 280)"
                    fill="oklch(0.65 0.15 280 / 0.1)"
                    strokeWidth={1.5}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
            {/* Phase legend */}
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-border">
              {PHASE_BANDS.map((b) => (
                <div key={b.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-3 h-2 rounded-sm" style={{ background: b.color.replace("0.08", "0.5") }} />
                  <span>
                    {b.label} (M{b.start}–{b.end})
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Year-end Milestones */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Year-End Milestones
            </CardTitle>
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
                    <th className="text-right py-2 text-muted-foreground font-medium">Projected (Engine)</th>
                  </tr>
                </thead>
                <tbody>
                  {milestones?.map((m) => {
                    const engineValue = projection?.[m.month - 1]?.totalEnd ?? 0;
                    const isOnTrack = engineValue >= m.minHealthyCheckpoint;
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
                          <span className={`font-semibold kes-amount ${isOnTrack ? "status-on-track" : "status-behind"}`}>
                            {formatKES(engineValue)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Rate Settings Summary */}
        {settings && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground">Current Rate Assumptions</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: "MMF Yield", value: formatPct(settings.mmfYield) },
                  { label: "91-Day T-Bill", value: formatPct(settings.tbill91Rate) },
                  { label: "364-Day T-Bill", value: formatPct(settings.tbill364Rate) },
                  { label: "IFB Coupon", value: formatPct(settings.ifbCouponRate) },
                  { label: "FXD Coupon", value: formatPct(settings.fxdCouponRate) },
                  { label: "WHT (FXD)", value: formatPct(settings.withholdingTax) },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">{label}</p>
                    <p className="text-sm font-bold text-primary">{value}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
