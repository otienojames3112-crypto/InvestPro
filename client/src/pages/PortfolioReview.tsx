import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
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
} from "lucide-react";

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

  // ─── Net worth allocation ───────────────────────────────────────────────
  // MMF bucket = primary-MMF deposit rows only. Bank- and secondary-MMF
  // deposits are represented by their own balances (secondaryTotal / holdings),
  // and government securities are valued from the REGISTER (source of truth),
  // so those deposit rows are excluded here to avoid double-counting.
  const buckets = useMemo(() => {
    const acc = { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };
    (deposits ?? []).forEach((d) => {
      const inst = (d as { institutionType?: string | null }).institutionType;
      if (inst === "government_security" || inst === "bank_instrument") return;
      if (d.bucket === "mmf") acc.mmf += Number(d.amount);
    });
    (securities ?? []).forEach((s) => {
      if (s.isMatured) return;
      const face = Number(s.faceValue);
      if (s.securityType.startsWith("tbill")) acc.tbill += face;
      else if (s.securityType === "ifb") acc.ifb += face;
      else acc.fxd += face;
    });
    return acc;
  }, [deposits, securities]);

  const secondaryTotal = useMemo(
    () =>
      (secondary ?? []).reduce(
        (s: number, m: { currentBalance: number }) => s + Number(m.currentBalance ?? 0),
        0
      ),
    [secondary]
  );

  const allocation = useMemo(() => {
    const items: { label: string; value: number }[] = [];
    const fixedIncome =
      buckets.mmf + buckets.tbill + buckets.ifb + buckets.fxd + secondaryTotal;
    if (fixedIncome > 0)
      items.push({ label: "Fixed Income (MMF + CBK)", value: fixedIncome });
    const byClass: Record<string, number> = {};
    (holdings ?? []).forEach((h) => {
      byClass[h.assetClass] = (byClass[h.assetClass] ?? 0) + h.currentValue;
    });
    Object.entries(byClass).forEach(([k, v]) =>
      items.push({ label: ASSET_LABELS[k] ?? k, value: v })
    );
    return items.sort((a, b) => b.value - a.value);
  }, [buckets, holdings, secondaryTotal]);

  const netWorth = allocation.reduce((s, a) => s + a.value, 0);

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
    const parts: { bal: number; rate: number }[] = [];
    const primaryMmfBal = buckets.mmf;
    if (primaryMmfBal > 0) parts.push({ bal: primaryMmfBal, rate: fund.fundEar });
    (secondary ?? []).forEach((s) => {
      const bal = Number(s.currentBalance ?? 0);
      if (bal > 0) parts.push({ bal, rate: Number(s.ear ?? 0) });
    });
    (bankHoldings ?? []).forEach((b) => {
      if (!b.isActive) return;
      const bal = Number(b.principal ?? 0);
      if (bal > 0) parts.push({ bal, rate: Number(b.interestRate ?? 0) });
    });
    (securities ?? []).forEach((s) => {
      if (s.isMatured) return;
      const bal = Number(s.faceValue ?? 0);
      if (bal <= 0) return;
      // Approximate each security's gross yield from its type.
      let rate = 0;
      if (s.securityType === "ifb") rate = bench["ifb_coupon"]?.value ?? 12.5;
      else if (s.securityType === "fxd") rate = bench["fxd_coupon"]?.value ?? 12.35;
      else rate = bench["tbill_91"]?.value ?? 8.82;
      parts.push({ bal, rate });
    });
    const totalBal = parts.reduce((s, p) => s + p.bal, 0);
    if (totalBal <= 0) return { yield: fund.fundEar, totalBal: 0, parts };
    const weighted = parts.reduce((s, p) => s + p.bal * p.rate, 0) / totalBal;
    return { yield: weighted, totalBal, parts };
  }, [buckets.mmf, secondary, bankHoldings, securities, fund.fundEar, bench]);

  const yourYield = blended.yield;
  const benchRows = [
    { key: "your", label: blended.parts.length > 1 ? "Your Portfolio (blended)" : `Your Fund (${fund.fundLabel})`, value: yourYield, highlight: true },
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
    // Fixed deposits lock until their maturity date — that is the free-up date.
    const fromFixedDeposits: LiquidityEvent[] = activeBank
      .filter((b) => b.instrumentType === "fixed_deposit" && b.maturityDate)
      .map((b) => ({
        id: `bank-${b.id}`,
        label: `${b.label || b.bankName} (FD)`,
        kind: "Fixed deposit",
        value: Number(b.currentValue ?? b.principal ?? 0),
        maturityDate: b.maturityDate as string | Date,
        days: daysUntil(b.maturityDate as string | Date),
        liquid: false,
      }));
    // Call deposits (and any open-ended bank instrument) are accessible on short
    // notice — they have no fixed maturity, so they are listed as already liquid.
    const fromCallDeposits: LiquidityEvent[] = activeBank
      .filter((b) => b.instrumentType !== "fixed_deposit" || !b.maturityDate)
      .map((b) => ({
        id: `bank-${b.id}`,
        label: `${b.label || b.bankName}${b.instrumentType === "call_deposit" ? " (call)" : ""}`,
        kind: b.instrumentType === "call_deposit" ? "Call deposit" : "Bank deposit",
        value: Number(b.currentValue ?? b.principal ?? 0),
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
          <Button
            variant="outline"
            className="shrink-0 print:hidden bg-background"
            onClick={() => window.print()}
          >
            <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
          </Button>
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
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-primary" /> Liquidity Calendar
            </CardTitle>
            <CardDescription>
              When your cash frees up — CBK security maturities and bank fixed
              deposits show their free-up date, while call deposits are accessible
              on short notice. (MMF balances are liquid within 1–3 days and are
              not listed here.)
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                    {upcoming.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">
                          {s.label}
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
                    ))}
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
