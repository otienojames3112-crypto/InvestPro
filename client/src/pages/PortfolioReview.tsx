import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { bankHoldingValue, buildAllocation, blendedYield } from "@shared/actuals";
import { bankInstrumentLabel } from "@shared/const";
import { Link } from "wouter";
import {
  currentSecurityValue,
  classifyDurationRisk,
  largestConcentration,
  classifyConcentration,
  amountToShiftUnderCap,
  buildDiversifyLink,
  DEFAULT_LIQUIDITY_HORIZON_DAYS,
  type CurrentValueSecurity,
} from "@shared/discount";
import {
  useMaturingWindow,
  MATURING_WINDOW_ALL,
  maturingWindowLabel,
} from "@/hooks/useMaturingWindow";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Briefcase,
  Printer,
  TrendingUp,
  TrendingDown,
  CalendarClock,
  History,
  Target,
  Gauge,
  Download,
  ShieldCheck,
  Shield,
  AlertTriangle,
  Layers,
  Lightbulb,
} from "lucide-react";
import { toCsv, downloadCsv, slugify } from "@shared/csv";

function kes(n: number, dp = 0): string {
  return n.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

const ASSET_LABELS: Record<string, string> = {
  real_estate: "Real Estate",
  equity: "Equities",
  etf: "ETFs",
  pension: "Pension",
  sacco: "SACCO",
  business: "Business",
  crypto: "Crypto",
  insurance: "Insurance",
  other: "Other",
};

const ALLOC_COLORS = [
  "bg-primary",
  "bg-sky-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-emerald-500",
  "bg-cyan-500",
  "bg-orange-500",
];

function daysUntil(d: string | Date): number {
  const t = new Date(d).getTime();
  return Math.ceil((t - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function PortfolioReview() {
  const { portfolioId, portfolio } = usePortfolio();
  const fund = useSelectedFund();
  // R55.2 — read the same maturing-soon window the CBK Securities Register uses
  // (shared via localStorage) so both views report the same lookahead horizon.
  const [maturingWindow] = useMaturingWindow();

  const { data: deposits } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: holdings } = trpc.otherHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: securities } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: benchmarks } = trpc.benchmarks.list.useQuery();
  const { data: secondary } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: bankHoldings } = trpc.bankHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: audit } = trpc.audit.list.useQuery(
    { portfolioId: portfolioId!, limit: 25 },
    { enabled: !!portfolioId }
  );
  const { data: pSettings } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  // ─── Net worth allocation (Round 32: single shared path) ────────────────
  // `buildAllocation` is the ONE net-worth builder shared with Reconciliation.
  // It excludes secondary-MMF and bank/government deposit ROWS from the
  // primary-MMF bucket, fixing the prior double-count of secondary deposits.
  const alloc = useMemo(
    () =>
      buildAllocation({
        deposits: (deposits ?? []) as never,
        securities: (securities ?? []) as never,
        secondaryMmfs: (secondary ?? []) as never,
        bankHoldings: (bankHoldings ?? []) as never,
        otherHoldings: (holdings ?? []) as never,
        assetLabels: ASSET_LABELS,
        primaryFundId: fund.fundId,
      }),
    [deposits, securities, secondary, bankHoldings, holdings, fund.fundId]
  );
  const buckets = { mmf: alloc.primaryMmf, tbill: alloc.tbill, ifb: alloc.ifb, fxd: alloc.fxd };
  const allocation = alloc.items;
  const netWorth = alloc.netWorth;

  // ─── Benchmark comparison ───────────────────────────────────────────────
  const bench = useMemo(() => {
    const map: Record<string, { label: string; value: number }> = {};
    (benchmarks ?? []).forEach((b) => {
      map[b.metricKey] = { label: b.label, value: b.value };
    });
    return map;
  }, [benchmarks]);

  // ─── Blended portfolio yield ────────────────────────────────────────────
  // Balance-weighted gross yield across every tracked interest-bearing asset:
  // primary MMF, secondary MMFs, bank instruments and CBK securities. This is
  // the actual portfolio yield, not just the primary fund's quoted rate.
  const blended = useMemo(() => {
    const result = blendedYield({
      primaryMmf: buckets.mmf,
      primaryMmfRate: fund.fundEar,
      secondaryMmfs: (secondary ?? []).map((s) => ({ balance: Number(s.currentBalance ?? 0), rate: Number(s.ear ?? 0) })),
      bankHoldings: (bankHoldings ?? [])
        .filter((b) => b.isActive)
        .map((b) => ({ value: bankHoldingValue({ principal: Number(b.principal ?? 0), interestRate: Number(b.interestRate ?? 0), isActive: b.isActive, currentValue: Number(b.currentValue ?? 0) }), rate: Number(b.interestRate ?? 0) })),
      securities: (securities ?? [])
        .filter((s) => !s.isMatured && Number(s.faceValue ?? 0) > 0)
        .map((s) => {
          let rate: number;
          if (s.securityType === "ifb") rate = bench["ifb_coupon"]?.value ?? 12.5;
          else if (s.securityType === "fxd") rate = bench["fxd_coupon"]?.value ?? 12.35;
          else rate = bench["tbill_91"]?.value ?? 8.82;
          return { value: Number(s.faceValue ?? 0), rate, taxExempt: s.securityType === "ifb" };
        }),
      whtRate: pSettings?.withholdingTax ?? 15,
    });
    const partCount =
      (buckets.mmf > 0 ? 1 : 0) +
      (secondary ?? []).filter((s) => Number(s.currentBalance ?? 0) > 0).length +
      (bankHoldings ?? []).filter((b) => b.isActive && Number(b.principal ?? 0) > 0).length +
      (securities ?? []).filter((s) => !s.isMatured && Number(s.faceValue ?? 0) > 0).length;
    return { yield: result.base > 0 ? result.grossYield : fund.fundEar, netYield: result.netYield, totalBal: result.base, partCount };
  }, [buckets.mmf, secondary, bankHoldings, securities, fund.fundEar, bench, pSettings?.withholdingTax]);

  const yourYield = blended.yield;
  const benchRows = [
    { key: "your", label: blended.partCount > 1 ? "Your Portfolio (blended)" : `Your Fund (${fund.fundLabel})`, value: yourYield, highlight: true },
    bench["mmf_market_avg"] && { key: "mmf_market_avg", ...bench["mmf_market_avg"], highlight: false },
    bench["mmf_leaders_avg"] && { key: "mmf_leaders_avg", ...bench["mmf_leaders_avg"], highlight: false },
    bench["deposit_rate_avg"] && { key: "deposit_rate_avg", ...bench["deposit_rate_avg"], highlight: false },
    bench["tbill_91"] && { key: "tbill_91", ...bench["tbill_91"], highlight: false },
    bench["cbr"] && { key: "cbr", ...bench["cbr"], highlight: false },
    bench["inflation"] && { key: "inflation", ...bench["inflation"], highlight: false },
  ].filter(Boolean) as { key: string; label: string; value: number; highlight: boolean }[];

  const maxBench = Math.max(...benchRows.map((b) => b.value), 1);
  const inflation = bench["inflation"]?.value ?? 0;
  const realYield = yourYield - inflation;

  // ─── Liquidity calendar ─────────────────────────────────────────────────
  // Every upcoming maturity that turns into available cash: CBK securities
  // (T-bill/IFB/FXD) AND bank fixed deposits with a maturity date.
  const upcoming = useMemo(() => {
    type LiquidityEvent = {
      id: string;
      label: string;
      kind: string;
      value: number;
      maturityDate: string | Date | null;
      days: number;
      liquid: boolean; // true = already liquid / on-notice (no fixed maturity)
    };
    const fromSecurities: LiquidityEvent[] = (securities ?? [])
      .filter((s) => !s.isMatured && s.maturityDate)
      .map((s) => ({
        id: `sec-${s.id}`,
        label: s.securityType.replace("_", "-").toUpperCase(),
        kind: "CBK security",
        value: Number(s.faceValue),
        maturityDate: s.maturityDate as string | Date,
        days: daysUntil(s.maturityDate),
        liquid: false,
      }));
    const activeBank = (bankHoldings ?? []).filter((b) => b.isActive);
    // Round 30 fix: value EVERY bank instrument from its accrued value (max of
    // currentValue and principal). currentValue defaults to 0 in the DB, so the
    // old `currentValue ?? principal` showed KES 0 because 0 is not nullish.
    const bankVal = (b: { principal?: unknown; interestRate?: unknown; isActive?: boolean; currentValue?: unknown }) =>
      bankHoldingValue({
        principal: Number(b.principal ?? 0),
        interestRate: Number(b.interestRate ?? 0),
        isActive: b.isActive,
        currentValue: Number(b.currentValue ?? 0),
      });
    // TERM deposits (fixed + target/goal savings) lock until their maturity date —
    // that is the free-up date listed on the calendar.
    const isTermKind = (t: string) => t === "fixed_deposit" || t === "target_savings";
    const fromFixedDeposits: LiquidityEvent[] = activeBank
      .filter((b) => isTermKind(b.instrumentType) && b.maturityDate)
      .map((b) => ({
        id: `bank-${b.id}`,
        label: `${b.label || b.bankName} (${b.instrumentType === "target_savings" ? "goal" : "FD"})`,
        kind: b.instrumentType === "target_savings" ? "Goal/target savings" : "Fixed deposit",
        value: bankVal(b),
        maturityDate: b.maturityDate as string | Date,
        days: daysUntil(b.maturityDate as string | Date),
        liquid: false,
      }));
    // Liquid deposits (call / ordinary / tiered savings, or any term deposit
    // without a maturity date) are accessible on short notice — listed as liquid.
    const fromCallDeposits: LiquidityEvent[] = activeBank
      .filter((b) => !isTermKind(b.instrumentType) || !b.maturityDate)
      .map((b) => ({
        id: `bank-${b.id}`,
        label: `${b.label || b.bankName}`,
        kind: bankInstrumentLabel(b.instrumentType),
        value: bankVal(b),
        maturityDate: null,
        days: 0,
        liquid: true,
      }))
      .filter((b) => b.value > 0);
    const dated = [...fromSecurities, ...fromFixedDeposits]
      .filter((s) => s.days >= 0)
      .sort((a, b) => a.days - b.days);
    // Liquid bank deposits first (available now), then dated maturities by soonest.
    return [...fromCallDeposits, ...dated].slice(0, 30);
  }, [securities, bankHoldings]);

  // R53: portfolio duration-risk one-liner — value-weighted average
  // days-to-maturity across active CBK securities, classified against the
  // investor's configured liquidity horizon (Rate Settings).
  const durationRisk = useMemo(() => {
    const horizonDays = pSettings?.liquidityHorizonDays ?? DEFAULT_LIQUIDITY_HORIZON_DAYS;
    const now = new Date();
    const lots = (securities ?? []).filter(
      (s) => !s.isMatured && Number(s.faceValue ?? 0) > 0 && s.maturityDate,
    );
    if (lots.length === 0) return null;
    let weightSum = 0;
    let weightedDaySum = 0;
    for (const s of lots) {
      const cv = currentSecurityValue(s as unknown as CurrentValueSecurity, now);
      const days = Math.max(0, daysUntil(s.maturityDate as string | Date));
      weightSum += cv;
      weightedDaySum += cv * days;
    }
    if (weightSum <= 0) return null;
    const wAvgDays = weightedDaySum / weightSum;
    const level = classifyDurationRisk(wAvgDays, horizonDays);
    return { wAvgDays, horizonDays, level, lots: lots.length };
  }, [securities, pSettings?.liquidityHorizonDays]);

  // R57 — per-issuer (instrument-type) concentration: which single CBK paper
  // type dominates the book by current value. Government of Kenya is the sole
  // issuer for all CBK paper, so the meaningful diversification axis here is
  // instrument TYPE / tenor profile rather than issuer.
  const concentration = useMemo(() => {
    const now = new Date();
    const lots = (securities ?? []).filter(
      (s) => !s.isMatured && Number(s.faceValue ?? 0) > 0,
    ) as unknown as CurrentValueSecurity[];
    return largestConcentration(lots, now);
  }, [securities]);

  // R58 — configurable per-type concentration cap (Rate Settings). The snapshot
  // line + bar flip to a warning colour when the dominant type breaches it.
  const typeCapPct = portfolio?.typeConcentrationCapPct ?? 60;
  const concentrationBreached = concentration
    ? classifyConcentration(concentration.topShare, typeCapPct) === "breached"
    : false;
  // R59 — when breached, how much current value to move OUT of the dominant type
  // to get its share back to the cap. Drives the diversification-suggestion line.
  const shiftToUnderCap = concentration
    ? amountToShiftUnderCap(concentration.topValue, concentration.totalValue, typeCapPct)
    : 0;

  // CSV export: net-worth allocation, benchmark comparison and the liquidity
  // calendar, written as labelled sections in one file. Raw numbers so it opens
  // cleanly in spreadsheets.
  const handleExportCsv = () => {
    const sections: (string | number)[][] = [];
    sections.push(["Portfolio Review", portfolio?.name ?? ""]);
    sections.push(["Generated", new Date().toISOString()]);
    sections.push(["Net worth", Math.round(netWorth)]);
    sections.push([]);
    // R57 — risk snapshot: duration risk + concentration so it travels with the
    // shared report instead of living only on screen.
    sections.push(["RISK SNAPSHOT"]);
    if (durationRisk) {
      const horizonLabel =
        durationRisk.horizonDays % 365 === 0 ? `${durationRisk.horizonDays / 365}yr`
        : durationRisk.horizonDays % 30 === 0 ? `${durationRisk.horizonDays / 30}mo`
        : `${durationRisk.horizonDays}d`;
      const levelWord = { low: "Low", moderate: "Moderate", elevated: "Elevated" }[durationRisk.level];
      sections.push(["Duration risk", levelWord]);
      sections.push(["Value-weighted avg maturity (days)", Math.round(durationRisk.wAvgDays)]);
      sections.push(["Liquidity horizon", horizonLabel]);
      sections.push(["Active CBK lots", durationRisk.lots]);
    } else {
      sections.push(["Duration risk", "No active CBK lots"]);
    }
    if (concentration) {
      sections.push(["Largest instrument type", concentration.topLabel]);
      sections.push(["Concentration share %", Number((concentration.topShare * 100).toFixed(2))]);
      sections.push(["Distinct instrument types", concentration.typeCount]);
      sections.push(["Single-type cap %", Number(typeCapPct.toFixed(2))]);
      sections.push(["Cap status", concentrationBreached ? "BREACHED" : "Within cap"]);
      if (concentrationBreached && shiftToUnderCap > 0) {
        sections.push(["Suggested shift out of top type (KES)", Math.round(shiftToUnderCap)]);
      }
    }
    sections.push([]);
    sections.push(["NET-WORTH ALLOCATION"]);
    sections.push(["Bucket", "Value (KES)", "Share %"]);
    allocation.forEach((a) =>
      sections.push([
        a.label,
        Math.round(a.value),
        netWorth > 0 ? Number(((a.value / netWorth) * 100).toFixed(2)) : 0,
      ])
    );
    sections.push([]);
    sections.push(["BENCHMARK COMPARISON"]);
    sections.push(["Metric", "Yield/Rate %"]);
    benchRows.forEach((b) => sections.push([b.label, Number(b.value.toFixed(2))]));
    sections.push(["Real yield (after inflation) %", Number(realYield.toFixed(2))]);
    sections.push([]);
    sections.push(["LIQUIDITY CALENDAR"]);
    sections.push(["Instrument", "Kind", "Value (KES)", "Maturity", "Days to free-up", "Status"]);
    upcoming.forEach((u) =>
      sections.push([
        u.label,
        u.kind,
        Math.round(u.value),
        u.maturityDate ? new Date(u.maturityDate).toISOString().split("T")[0] : "",
        u.liquid ? "" : u.days,
        u.liquid ? "Liquid / on-notice" : "Locked until maturity",
      ])
    );
    const csv = toCsv(sections[0], sections.slice(1));
    const stamp = new Date().toISOString().split("T")[0];
    downloadCsv(csv, `portfolio-review-${slugify(portfolio?.name)}-${stamp}.csv`);
  };

  return (
    <AppShell>
      <div className="space-y-6 print:space-y-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-primary" />
              <h1
                className="text-2xl font-bold"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Portfolio Review
              </h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-3xl">
              A money-manager's one-page review of{" "}
              <strong>{portfolio?.name ?? "your portfolio"}</strong>: net-worth
              allocation, how your fund stacks up against market benchmarks,
              upcoming liquidity events, and a full change history.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 print:hidden">
            <Button
              variant="outline"
              className="bg-background"
              onClick={handleExportCsv}
            >
              <Download className="w-4 h-4 mr-2" /> Download CSV
            </Button>
            <Button
              variant="outline"
              className="bg-background"
              onClick={() => window.print()}
            >
              <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
            </Button>
          </div>
        </div>

        {/* Net worth */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> Net-Worth Allocation
            </CardTitle>
            <CardDescription>
              Total tracked net worth:{" "}
              <span className="text-foreground font-semibold">
                {kes(netWorth)}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {netWorth === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No assets recorded yet.
              </p>
            ) : (
              <>
                <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
                  {allocation.map((a, i) => (
                    <div
                      key={a.label}
                      className={ALLOC_COLORS[i % ALLOC_COLORS.length]}
                      style={{ width: `${(a.value / netWorth) * 100}%` }}
                      title={`${a.label}: ${((a.value / netWorth) * 100).toFixed(1)}%`}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                  {allocation.map((a, i) => (
                    <div
                      key={a.label}
                      className="flex items-center justify-between"
                    >
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span
                          className={`w-2.5 h-2.5 rounded-sm ${ALLOC_COLORS[i % ALLOC_COLORS.length]}`}
                        />
                        {a.label}
                      </span>
                      <span className="font-medium tabular-nums">
                        {((a.value / netWorth) * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Benchmark comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="w-4 h-4 text-primary" /> Benchmark Comparison
            </CardTitle>
            <CardDescription>
              Your fund's net yield vs the market. Real yield (after inflation):{" "}
              <span
                className={
                  realYield >= 0
                    ? "text-primary font-semibold"
                    : "text-red-500 font-semibold"
                }
              >
                {realYield >= 0 ? "+" : ""}
                {realYield.toFixed(2)}%
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {benchRows.map((b) => (
              <div key={b.key} className="flex items-center gap-3">
                <div className="w-44 shrink-0 text-sm truncate">
                  {b.label}
                </div>
                <div className="flex-1 h-6 rounded bg-muted overflow-hidden relative">
                  <div
                    className={
                      b.highlight ? "h-full bg-primary" : "h-full bg-muted-foreground/40"
                    }
                    style={{ width: `${(b.value / maxBench) * 100}%` }}
                  />
                </div>
                <div
                  className={`w-16 text-right text-sm tabular-nums ${
                    b.highlight ? "font-bold text-primary" : "font-medium"
                  }`}
                >
                  {b.value.toFixed(2)}%
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground pt-2">
              Benchmarks are editable in the data layer and dated to their source
              (Serrari comparator, CBK, KNBS). Beating the market average and
              staying above inflation are the two key tests for a cash fund.
            </p>
          </CardContent>
        </Card>

        {/* Liquidity calendar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <CalendarClock className="w-4 h-4 text-primary" /> Liquidity Calendar
              <Badge variant="outline" className="ml-auto font-normal text-xs gap-1">
                <CalendarClock className="w-3 h-3" />
                Maturing-soon window:{" "}
                {maturingWindow === MATURING_WINDOW_ALL ? "All" : maturingWindowLabel(maturingWindow)}
              </Badge>
            </CardTitle>
            <CardDescription>
              When your cash frees up — CBK security maturities and bank fixed
              deposits show their free-up date, while call deposits are accessible
              on short notice. (MMF balances are liquid within 1–3 days and are
              not listed here.)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {durationRisk && (() => {
              const horizonLabel =
                durationRisk.horizonDays % 365 === 0 ? `${durationRisk.horizonDays / 365}yr`
                : durationRisk.horizonDays % 30 === 0 ? `${durationRisk.horizonDays / 30}mo`
                : `${durationRisk.horizonDays}d`;
              const dtm = durationRisk.wAvgDays;
              const dtmLabel = dtm >= 365 ? `${(dtm / 365).toFixed(1)} yr` : dtm >= 30 ? `${Math.round(dtm / 30)} mo` : `${Math.round(dtm)} d`;
              const meta = {
                low: { Icon: ShieldCheck, cls: "text-emerald-600 dark:text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/30", word: "Low" },
                moderate: { Icon: Shield, cls: "text-amber-600 dark:text-amber-400", bg: "bg-amber-500/10 border-amber-500/30", word: "Moderate" },
                elevated: { Icon: AlertTriangle, cls: "text-red-600 dark:text-red-400", bg: "bg-red-500/10 border-red-500/30", word: "Elevated" },
              }[durationRisk.level];
              const RiskIcon = meta.Icon;
              return (
                <div className={`mb-4 rounded-lg border px-3.5 py-2.5 text-sm ${meta.bg}`}>
                  <div className="flex items-center gap-2.5">
                    <RiskIcon className={`w-4 h-4 shrink-0 ${meta.cls}`} />
                    <span className="text-foreground">
                      <strong className={meta.cls}>{meta.word} duration risk</strong>
                      {" — "}
                      value-weighted average maturity of <strong>{dtmLabel}</strong>
                      {" "}across {durationRisk.lots} active {durationRisk.lots === 1 ? "lot" : "lots"}, against a{" "}
                      {horizonLabel} liquidity horizon.
                    </span>
                  </div>
                  {/* R57 — per-instrument-type concentration one-liner, sitting with
                      the duration-risk line for a complete risk snapshot.
                      R58 — flips to a warning colour when the dominant type breaches
                      the configured cap, and is followed by a per-type bar. */}
                  {concentration && (
                    <div className="mt-2 flex items-start gap-2.5 border-t border-current/10 pt-2">
                      <Layers className={`w-4 h-4 shrink-0 mt-0.5 ${concentrationBreached ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`} />
                      <span className={concentrationBreached ? "text-red-600 dark:text-red-400" : "text-foreground"}>
                        {concentration.typeCount === 1 ? (
                          <>
                            <strong>Single-instrument book</strong> {" — "}
                            100% of current value sits in <strong>{concentration.topLabel}</strong>.
                          </>
                        ) : (
                          <>
                            <strong>Top concentration:</strong>{" "}
                            <strong>{(concentration.topShare * 100).toFixed(0)}%</strong> in{" "}
                            <strong>{concentration.topLabel}</strong>{" "}
                            across {concentration.typeCount} instrument types.
                          </>
                        )}
                        {concentrationBreached && (
                          <> Exceeds your <strong>{typeCapPct.toFixed(0)}%</strong> single-type cap — consider diversifying.</>
                        )}
                      </span>
                    </div>
                  )}
                  {/* R59 — diversification suggestion: how much value to move out of
                      the dominant type to get back under the cap. */}
                  {concentration && concentrationBreached && shiftToUnderCap > 0 && (
                    <div className="mt-2 flex items-start gap-2.5 text-sm">
                      <Lightbulb className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                      <span className="text-foreground">
                        <strong>Suggestion:</strong> shift about{" "}
                        <strong>{kes(Math.round(shiftToUnderCap))}</strong>{" "}
                        out of <strong>{concentration.topLabel}</strong> (into other instruments or MMF)
                        to bring it to the {typeCapPct.toFixed(0)}% cap.
                        {/* R61 — Diversify now offers a quick target choice: a liquid
                            364-day T-bill (booked in the register) or a money-market
                            top-up (recorded as a lump-sum contribution). Both deep-link
                            with the suggested shift amount pre-filled. */}
                        <span className="mt-1 inline-flex flex-wrap items-center gap-x-3 gap-y-1 print:hidden">
                          <span className="text-xs text-muted-foreground">Diversify into:</span>
                          <Link
                            href={buildDiversifyLink(shiftToUnderCap, "tbill_364")}
                            className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
                          >
                            364-day T-bill →
                          </Link>
                          <Link
                            href={buildDiversifyLink(shiftToUnderCap, "mmf")}
                            className="font-medium text-primary underline underline-offset-2 hover:opacity-80"
                          >
                            Money Market Fund →
                          </Link>
                        </span>
                      </span>
                    </div>
                  )}
                  {/* R58 — per-type concentration bar: a compact stacked view of how
                      current value splits across instrument types. */}
                  {concentration && concentration.breakdown.length > 0 && (
                    <div className="mt-2.5">
                      {/* R59 — each slice deep-links to the CBK Securities register
                          pre-filtered to that instrument type. */}
                      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted print:pointer-events-none">
                        {concentration.breakdown.map((slice, i) => {
                          const isTop = i === 0;
                          const palette = [
                            "#3b82f6", "#10b981", "#fb923c", "#a78bfa", "#f472b6", "#94a3b8",
                          ];
                          const colour = isTop && concentrationBreached ? "#ef4444" : palette[i % palette.length];
                          return (
                            <Link
                              key={slice.type}
                              href={`/securities?type=${encodeURIComponent(slice.type)}`}
                              className="h-full block transition-opacity hover:opacity-80"
                              style={{ width: `${Math.max(slice.share * 100, 1.5)}%`, backgroundColor: colour }}
                              title={`${slice.label}: ${(slice.share * 100).toFixed(1)}% — view in register`}
                            />
                          );
                        })}
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                        {concentration.breakdown.map((slice, i) => {
                          const isTop = i === 0;
                          const palette = [
                            "#3b82f6", "#10b981", "#fb923c", "#a78bfa", "#f472b6", "#94a3b8",
                          ];
                          const colour = isTop && concentrationBreached ? "#ef4444" : palette[i % palette.length];
                          return (
                            <Link
                              key={slice.type}
                              href={`/securities?type=${encodeURIComponent(slice.type)}`}
                              className="inline-flex items-center gap-1 rounded px-1 -mx-1 hover:bg-muted hover:text-foreground transition-colors print:hover:bg-transparent"
                              title={`View ${slice.label} in the register`}
                            >
                              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colour }} />
                              {slice.label} {(slice.share * 100).toFixed(0)}%
                            </Link>
                          );
                        })}
                        <span className="inline-flex items-center gap-1 opacity-70">
                          · cap {typeCapPct.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No upcoming maturities. Add CBK securities or bank deposits to see
                your liquidity schedule.
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Instrument</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Value</TableHead>
                      <TableHead>Matures</TableHead>
                      <TableHead className="text-right">In</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upcoming.map((s) => {
                      // A dated CBK/term lot is "in window" when its free-up date
                      // falls within the shared maturing-soon window — the same rule
                      // the Securities Register uses, so both views agree.
                      const inWindow =
                        !s.liquid &&
                        s.maturityDate != null &&
                        s.days <= maturingWindow;
                      return (
                      <TableRow
                        key={s.id}
                        className={inWindow ? "bg-amber-500/5" : undefined}
                      >
                        <TableCell className="font-medium">
                          {s.label}
                          {inWindow && (
                            <Badge
                              variant="outline"
                              className="ml-2 text-[10px] font-normal border-amber-500/40 text-amber-600 dark:text-amber-400 align-middle"
                            >
                              in window
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-xs">
                          {s.kind}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {kes(s.value)}
                        </TableCell>
                        <TableCell>
                          {s.liquid || !s.maturityDate
                            ? "On call / short notice"
                            : new Date(s.maturityDate).toLocaleDateString("en-KE")}
                        </TableCell>
                        <TableCell className="text-right">
                          {s.liquid ? (
                            <Badge variant="default" className="text-[10px] bg-emerald-600 hover:bg-emerald-600">
                              Liquid
                            </Badge>
                          ) : (
                            <Badge
                              variant={s.days <= 30 ? "default" : "secondary"}
                              className="text-[10px]"
                            >
                              {s.days} {s.days === 1 ? "day" : "days"}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Audit trail */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4 text-primary" /> Change History
            </CardTitle>
            <CardDescription>
              Recent edits to rates, composition and benchmarks for this account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!audit || audit.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No changes recorded yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {audit.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start gap-3 text-sm border-b border-border/50 pb-2 last:border-0"
                  >
                    <span className="mt-0.5">
                      {a.action === "create" ? (
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                      ) : a.action === "delete" ? (
                        <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                      ) : (
                        <Pencil2 />
                      )}
                    </span>
                    <div className="flex-1">
                      <p>{a.summary ?? `${a.action} on ${a.entity}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.changedByName ? `${a.changedByName} · ` : ""}
                        {new Date(a.createdAt).toLocaleString("en-KE")}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Pencil2() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-amber-500"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
