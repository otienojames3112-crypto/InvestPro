import { usePortfolio } from "@/contexts/PortfolioContext";
import { AppShell } from "@/components/AppShell";
import { SimulatedDateChip } from "@/components/SimulatedDateChip";
import { trpc } from "@/lib/trpc";
import { formatKES, getMonthLabel, getPhaseName, getPhaseColorClass } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, RefreshCw, Search, Info, Download, ChevronDown, MessageSquareText } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { explainLedgerRow } from "@shared/ledgerExplain";
import { AiExplainDialog } from "@/components/AiExplainDialog";
import { Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useMemo, useEffect, useRef } from "react";
import { toast } from "sonner";
import { toCsv, downloadCsv, slugify } from "@shared/csv";
import { LEDGER_CSV_HEADERS } from "@shared/ledgerColumns";

/** Read the ?focus=<month> query param once on mount (deep-link from the Dashboard timeline). */
function useFocusMonth(): number | null {
  return useMemo(() => {
    if (typeof window === "undefined") return null;
    const v = new URLSearchParams(window.location.search).get("focus");
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n >= 1 ? n : null;
  }, []);
}

type LedgerReconData = {
  hasActuals: boolean;
  lastActualMonth: number;
  ledgerActualValue: number | null;
  ledgerComparable: number;
  dashboardNetWorth: number;
  portfolioReviewNetWorth: number;
  goalPlanAssets: number;
  otherAssetsExcludedFromGoal: number;
  fullVsGoalGap: number;
  expectedGap: number;
  gapExplained: boolean;
  ledgerMatchesGoalBasis: boolean;
  dashboardMatchesReview: boolean;
};

/**
 * "Ledger value basis" reconciliation card. Explains why the Ledger's actual
 * current value (goal-plan scope, engine basis) can differ from the Dashboard's
 * live net worth (full net worth) — the gap is the value of Other Assets tagged
 * OUT of the goal. Reads only the figures the server derives from the shared
 * snapshot selectors; it invents no new valuation.
 */
function LedgerBasisCard({ recon }: { recon: LedgerReconData | undefined }) {
  if (!recon) return null;
  const excluded = recon.otherAssetsExcludedFromGoal;
  const hasExclusion = excluded > 5;
  const allHealthy = recon.gapExplained && recon.ledgerMatchesGoalBasis && recon.dashboardMatchesReview;

  const rows: Array<{ label: string; value: number | null; sub: string }> = [
    {
      label: recon.hasActuals
        ? `Ledger actual value (month ${recon.lastActualMonth})`
        : "Ledger comparable (no actuals yet)",
      value: recon.hasActuals ? recon.ledgerActualValue : recon.ledgerComparable,
      sub: "Goal-plan scope · engine basis",
    },
    {
      label: "Dashboard live net worth",
      value: recon.dashboardNetWorth,
      sub: "Full net worth · every pocket",
    },
    {
      label: "Portfolio Review net worth",
      value: recon.portfolioReviewNetWorth,
      sub: "Full net worth · sum of allocation rows",
    },
  ];

  return (
    <Card className={allHealthy ? "border-border" : "border-amber-500/50"}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Info className={`w-4 h-4 ${allHealthy ? "text-primary" : "text-amber-400"}`} />
          <CardTitle className="text-sm font-semibold">Ledger value basis</CardTitle>
          <Badge
            variant="outline"
            className={`ml-auto text-[10px] ${
              allHealthy
                ? "border-emerald-500/40 text-emerald-300"
                : "border-amber-500/40 text-amber-300"
            }`}
          >
            {allHealthy ? "Bases reconcile" : "Check basis"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {rows.map((r) => (
            <div key={r.label} className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
              <div className="text-[11px] text-muted-foreground leading-tight">{r.label}</div>
              <div className="text-base font-bold text-foreground kes-amount mt-0.5">
                {r.value === null ? "–" : formatKES(r.value)}
              </div>
              <div className="text-[10px] text-muted-foreground/70 mt-0.5">{r.sub}</div>
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-border/60 bg-background/40 px-3 py-2.5 text-xs leading-relaxed">
          {hasExclusion ? (
            <p className="text-muted-foreground">
              The Ledger follows your <span className="text-foreground font-medium">goal-plan</span> scope, so it does
              {" "}<span className="text-foreground font-medium">not</span> include{" "}
              <span className="text-foreground font-medium kes-amount">{formatKES(excluded)}</span> of Other Assets you
              tagged out of this goal. Your Dashboard net worth is higher by that amount — this is a basis difference, not a
              discrepancy.
              {recon.gapExplained ? (
                <span className="text-emerald-400"> The full-vs-goal gap matches the excluded value exactly.</span>
              ) : (
                <span className="text-amber-400">
                  {" "}But the full-vs-goal gap ({formatKES(recon.fullVsGoalGap)}) does not match the excluded value
                  ({formatKES(recon.expectedGap)}) — {formatKES(Math.abs(recon.fullVsGoalGap - recon.expectedGap))} is
                  unexplained.
                </span>
              )}
            </p>
          ) : (
            <p className="text-muted-foreground">
              No Other Assets are tagged out of this goal, so the Ledger actual value and your Dashboard live net worth use
              the same asset scope and{" "}
              {recon.gapExplained ? (
                <span className="text-emerald-400">reconcile within rounding.</span>
              ) : (
                <span className="text-amber-400">
                  should match — but they differ by {formatKES(Math.abs(recon.fullVsGoalGap))}, which is unexplained.
                </span>
              )}
            </p>
          )}
          {!recon.dashboardMatchesReview && (
            <p className="text-amber-400 mt-1.5">
              Dashboard and Portfolio Review disagree by{" "}
              {formatKES(Math.abs(recon.dashboardNetWorth - recon.portfolioReviewNetWorth))} — a page may be omitting a
              pocket.
            </p>
          )}
          {recon.hasActuals && !recon.ledgerMatchesGoalBasis && (
            <p className="text-amber-400 mt-1.5">
              The Ledger actual row drifts from its goal-plan comparable by{" "}
              {formatKES(Math.abs((recon.ledgerActualValue ?? 0) - recon.ledgerComparable))}.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Ledger({ embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId, portfolio, userMode } = usePortfolio();
  const isManager = userMode === "manager";
  const { data: projection, isLoading } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: ledgerRecon } = trpc.projection.ledgerReconciliation.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const syncMutation = trpc.ledger.sync.useMutation({
    onSuccess: () => toast.success("Ledger synced with latest projection"),
    onError: () => toast.error("Failed to sync ledger"),
  });
  const handleSync = () => { if (portfolioId) syncMutation.mutate({ portfolioId }); };

  // R63 — the recommended liquid-home target shares, used to show a per-month
  // breakdown of how each month's MMF balance would be diversified across homes.
  const { data: liquidAlloc } = trpc.bankHoldings.liquidAllocation.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // Part 5 — recorded income events (dividends / distributions / offshore income)
  // across the price-driven holdings. Surfaced as a SEPARATE actual stream below
  // the projected core-flow table — never merged into the projection columns.
  const { data: incomeEvents = [] } = trpc.ledger.incomeEvents.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const incomeTotal = useMemo(
    () => incomeEvents.reduce((s, e) => s + (e.amount || 0), 0),
    [incomeEvents],
  );
  // Stable, ranked share table (only homes with a positive target share).
  const liquidShares = useMemo(() => {
    if (!liquidAlloc || liquidAlloc.liquidPot <= 0) return [];
    const totalShare = liquidAlloc.slices.reduce((s, x) => s + Math.max(0, x.targetShare), 0);
    if (totalShare <= 0) return [];
    return liquidAlloc.slices
      .filter((s) => s.targetShare > 0)
      .map((s) => ({ id: s.id, label: s.label, frac: s.targetShare / totalShare, netYieldPct: s.netYieldPct }))
      .sort((a, b) => b.frac - a.frac);
  }, [liquidAlloc]);

  const focusMonth = useFocusMonth();
  // ── Round 95: "Explain this month" (read-only AI). We open one shared dialog
  // and drive it from whichever row the manager clicked; the facts payload is
  // built from the SAME row fields the table renders. Nothing here writes.
  const [explainMonth, setExplainMonth] = useState<number | null>(null);
  const explainRow = useMemo(
    () => (projection ?? []).find((r) => r.monthNumber === explainMonth) ?? null,
    [projection, explainMonth],
  );
  const ledgerExplainQuery = trpc.aiExplain.ledgerMonth.useQuery(
    {
      portfolioId: portfolioId!,
      month: {
        monthNumber: explainRow?.monthNumber ?? 0,
        isActual: explainRow?.isActual ?? false,
        entryDate: explainRow ? getMonthLabel(portfolio?.startDate ? String(portfolio.startDate).split("T")[0] : "2026-07-01", explainRow.monthNumber) : undefined,
        contribution: explainRow?.contribution ?? 0,
        cbkCashIn: (explainRow?.cbkCashIn ?? 0) + (explainRow?.bankCashIn ?? 0),
        mmfToDhow: explainRow?.mmfToDhow ?? 0,
        mainAction: explainRow?.mainAction ?? null,
        mmfEndBalance: explainRow?.mmfEnd ?? 0,
        tbillEndBalance: (explainRow?.tbill91End ?? 0) + (explainRow?.tbill182End ?? 0) + (explainRow?.tbill364End ?? 0),
        ifbEndBalance: explainRow?.ifbEnd ?? 0,
        fxdEndBalance: explainRow?.fxdEnd ?? 0,
        totalEndBalance: explainRow?.totalEnd ?? 0,
        mmfInterestNet: explainRow?.mmfInterestNet ?? null,
      },
    },
    { enabled: explainMonth != null && !!portfolioId && !!explainRow, refetchOnWindowFocus: false, retry: false },
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [highlightMonth, setHighlightMonth] = useState<number | null>(null);
  const focusRowRef = useRef<HTMLTableRowElement | null>(null);
  const pageSize = 24;

  const startDate = portfolio?.startDate ? String(portfolio.startDate).split("T")[0] : "2026-07-01";

  const filtered = useMemo(() => {
    if (!projection) return [];
    if (!search) return projection;
    const q = search.toLowerCase();
    return projection.filter(
      (r) =>
        String(r.monthNumber).includes(q) ||
        r.mainAction?.toLowerCase().includes(q) ||
        r.phase.toLowerCase().includes(q)
    );
  }, [projection, search]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  // Deep-link: when arriving with ?focus=<month>, jump to the page holding that
  // month (clearing any search filter so the row is reachable) and flash it.
  useEffect(() => {
    if (!focusMonth || !projection || projection.length === 0) return;
    const idx = projection.findIndex((r) => r.monthNumber === focusMonth);
    if (idx < 0) return;
    if (search) setSearch("");
    const targetPage = Math.floor(idx / pageSize) + 1;
    setPage(targetPage);
    setHighlightMonth(focusMonth);
    const t = setTimeout(() => setHighlightMonth(null), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusMonth, projection]);

  // Scroll the highlighted row into view once it is rendered on the active page.
  useEffect(() => {
    if (highlightMonth && focusRowRef.current) {
      focusRowRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightMonth, page]);

  // Column totals over the CURRENTLY FILTERED set (so they track the search box).
  // Save and the two cash-in columns are flows, so they sum across months. The
  // balance columns (MMF/T-Bill/.../Total) are point-in-time, so the meaningful
  // "total" is the balance at the LAST month in view, not a sum of every month.
  const totals = useMemo(() => {
    const sum = (sel: (r: (typeof filtered)[number]) => number) =>
      filtered.reduce((s, r) => s + (sel(r) || 0), 0);
    const last = filtered.length > 0 ? filtered[filtered.length - 1] : undefined;
    return {
      contribution: sum((r) => r.contribution),
      cbkCashIn: sum((r) => r.cbkCashIn),
      bankCashIn: sum((r) => r.bankCashIn),
      mmfToDhow: sum((r) => r.mmfToDhow),
      mmfInterestNet: sum((r) => r.mmfInterestNet),
      endMmf: last?.mmfEnd ?? 0,
      endTbill: last?.tbillEnd ?? 0,
      endTbill91: last?.tbill91End ?? 0,
      endTbill182: last?.tbill182End ?? 0,
      endTbill364: last?.tbill364End ?? 0,
      endIfb: last?.ifbEnd ?? 0,
      endIfbTenor: last?.ifbTenorYears ?? 0,
      endFxd: last?.fxdEnd ?? 0,
      endBank: last?.bankEnd ?? 0,
      endTotal: last?.totalEnd ?? 0,
      lastMonth: last?.monthNumber ?? 0,
    };
  }, [filtered]);

  // CSV export. `scope` chooses the full projection or just the filtered rows.
  // Raw numeric values (no "KES"/thousands formatting) so it opens cleanly in
  // spreadsheets, and a trailing TOTAL line mirrors the on-screen footer.
  const handleExportCsv = (scope: "full" | "filtered") => {
    const rowsSrc = scope === "filtered" ? filtered : projection ?? [];
    if (rowsSrc.length === 0) {
      toast.error("Nothing to export yet");
      return;
    }
    // Header row comes from the shared column definitions so the CSV and the
    // on-screen table can never silently drift (see shared/ledgerColumns.ts and
    // the ledgerCsvHeaders integrity test).
    const headers = LEDGER_CSV_HEADERS;
    const rows = rowsSrc.map((r) => [
      r.monthNumber,
      r.isActual ? "Actual" : "Projected",
      r.isActual && r.offPlan ? "Off-plan" : "",
      getMonthLabel(startDate, r.monthNumber),
      r.contribution,
      r.cbkCashIn,
      r.bankCashIn,
      r.mmfToDhow,
      r.mainAction ?? "",
      r.mmfEnd,
      r.mmfInterestNet,
      r.tbill91End,
      r.tbill182End,
      r.tbill364End,
      r.ifbEnd,
      r.fxdEnd,
      r.bankEnd,
      r.totalEnd,
      getPhaseName(r.phase),
    ]);
    const last = rowsSrc[rowsSrc.length - 1];
    const flowSum = (sel: (r: (typeof rowsSrc)[number]) => number) =>
      rowsSrc.reduce((s, r) => s + (sel(r) || 0), 0);
    const totalRow = [
      "TOTAL", "", "", `${rowsSrc.length} months`,
      flowSum((r) => r.contribution),
      flowSum((r) => r.cbkCashIn),
      flowSum((r) => r.bankCashIn),
      flowSum((r) => r.mmfToDhow),
      `Ending balances at month ${last.monthNumber}`,
      last.mmfEnd, flowSum((r) => r.mmfInterestNet), last.tbill91End, last.tbill182End, last.tbill364End, last.ifbEnd, last.fxdEnd, last.bankEnd, last.totalEnd,
      "",
    ];
    const csv = toCsv(headers, [...rows, totalRow]);
    const stamp = new Date().toISOString().split("T")[0];
    const suffix = scope === "filtered" ? "-filtered" : "";
    downloadCsv(csv, `ledger-${slugify(portfolio?.name)}${suffix}-${stamp}.csv`);
    toast.success(`Exported ${rowsSrc.length} months to CSV`);
  };

  // Where do recorded actuals end and the forward projection begin? The engine
  // tags every month it seeded from real holdings with isActual=true.
  const actualMonths = (projection ?? []).filter((r) => r.isActual).length;
  const lastActualMonth = actualMonths > 0
    ? Math.max(...(projection ?? []).filter((r) => r.isActual).map((r) => r.monthNumber))
    : 0;

  // R55.3 — plain-language explanations for every ledger column, surfaced as a
  // hover tooltip on each header so non-finance users understand what they read.
  const COL_HELP: Record<string, string> = {
    Month: "The month number in your plan, counted from your start date. Month 1 is your first month.",
    "MMF Interest": "Net interest your MMF earned this month, after 15% withholding tax. This amount is already included in the MMF End balance.",
    Basis: "Actual = built from money you've actually recorded. Projected = the engine's forecast for a future month.",
    Date: "The calendar month this row represents.",
    Save: "Your scheduled contribution that month — new money you add. It always lands in your MMF first, then gets invested from there.",
    "CBK In": "Cash flowing back into your MMF from CBK securities this month: a T-bill maturing at face value, or a bond coupon or maturity payment, net of any withholding tax.",
    "Bank In": "Cash returning to your MMF from a maturing bank deposit (e.g. a fixed deposit reaching its term). Stays blank for liquid accounts like call deposits, which never lock up.",
    "Swept → Securities": "Cash leaving your MMF this month to buy new CBK securities. For T-bills this is the discounted purchase price you actually pay, not the face value you'll receive at maturity.",
    "Main Action": "A plain-language summary of the most important thing that happened this month — a contribution, a sweep into securities, a maturity, or a coupon payment.",
    "MMF End": "Your money market fund balance at month-end, after your save, MMF interest, any cash maturing in, and any cash swept out into securities.",
    "T-Bill 91d": "Value held in 91-day Treasury bills at month-end. T-bills are bought below face value and shown accreting toward their full face as maturity approaches — that growth is your return.",
    "T-Bill 182d": "Value held in 182-day Treasury bills at month-end, shown accreting from purchase price toward face value.",
    "T-Bill 364d": "Value held in 364-day Treasury bills at month-end, shown accreting from purchase price toward face value.",
    IFB: "Value held in Infrastructure Bonds at month-end, kept at face value. IFB coupons are paid into your MMF every 6 months and are tax-exempt.",
    FXD: "Value held in Fixed Coupon Treasury Bonds at month-end, kept at face (par) value. FXD coupons are paid into your MMF every 6 months, net of withholding tax.",
    Bank: "Value held in bank instruments at month-end — call deposits, fixed deposits, or savings accounts — including interest accrued so far.",
    Total: "Your entire portfolio value at month-end: MMF + all CBK securities + bank instruments. This is what you'd be worth that month.",
    "Projected / Actual Value": "Actual rows use your recorded holdings; projected rows use the engine's future-value model (securities shown accreting toward face). This column follows your GOAL-PLAN scope, so it excludes Other Assets you've tagged out of the goal. Differences from your live net worth on the Dashboard are expected where market-priced assets sit on a different valuation basis — see the 'Ledger value basis' card above.",
    Phase: "The strategy stage for this month. Foundation: build a cash cushion. Growth: invest surplus into securities for yield. De-risking: stop buying long instruments. Final: let everything mature to cash so you're fully liquid by your goal date.",
  };
  const ColHead = ({
    label,
    align = "right",
    nowrap = true,
  }: {
    label: string;
    align?: "left" | "right";
    nowrap?: boolean;
  }) => (
    <th
      className={`${align === "left" ? "text-left" : "text-right"} px-4 py-3 text-muted-foreground font-medium ${nowrap ? "whitespace-nowrap" : ""}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-4 ${align === "left" ? "" : "justify-end"}`}
          >
            <span dangerouslySetInnerHTML={{ __html: label }} />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
          {COL_HELP[label.replace(/&nbsp;/g, " ").replace(/&rarr;/g, "→").trim()] ?? label}
        </TooltipContent>
      </Tooltip>
    </th>
  );

  return (
    <AppShell embedded={embedded}>
      <TooltipProvider delayDuration={150}>
      <div className="p-6 lg:p-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              Month-by-Month Ledger
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {lastActualMonth > 0
                ? `Months 1–${lastActualMonth} reflect your recorded holdings; later months are a forward projection.`
                : "Complete forward projection of your investment journey. Record deposits to anchor early months to actuals."}
            </p>
            <SimulatedDateChip className="mt-2" />
          </div>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!projection || projection.length === 0}
                  className="gap-2"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download CSV
                  <ChevronDown className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Export scope</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleExportCsv("full")}>
                  Full projection ({projection?.length ?? 0} months)
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleExportCsv("filtered")}
                  disabled={!search || filtered.length === 0}
                >
                  {search
                    ? `Filtered view (${filtered.length} months)`
                    : "Filtered view (no filter active)"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSync}
              disabled={syncMutation.isPending}
              className="gap-2"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
              Sync
            </Button>
          </div>
        </div>

        <LedgerBasisCard recon={ledgerRecon} />

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <BookOpen className="w-4 h-4 text-primary" />
                <CardTitle className="text-sm font-semibold">Transaction Ledger</CardTitle>
              <div className="hidden sm:flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/30 border border-emerald-500/50" />Actual</span>
                <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-2.5 rounded-sm bg-muted border border-border" />Projected</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-8 h-8 text-xs w-48"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <ColHead label="Month" align="left" />
                    <ColHead label="Basis" align="left" />
                    <ColHead label="Date" align="left" />
                    <ColHead label="Save" />
                    <ColHead label="CBK In" />
                    <ColHead label="Bank In" />
                    <ColHead label="Swept&nbsp;&rarr;&nbsp;Securities" />
                    <ColHead label="Main Action" align="left" nowrap={false} />
                    <ColHead label="MMF End" />
                    <ColHead label="MMF Interest" />
                    <ColHead label="T-Bill 91d" />
                    <ColHead label="T-Bill 182d" />
                    <ColHead label="T-Bill 364d" />
                    <ColHead label="IFB" />
                    <ColHead label="FXD" />
                    <ColHead label="Bank" />
                    <ColHead label="Projected / Actual Value" />
                    <ColHead label="Phase" align="left" />
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 10 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          {Array.from({ length: 18 }).map((_, j) => (
                            <td key={j} className="px-4 py-3">
                              <Skeleton className="h-3 w-full" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : paged.map((r) => (
                        <tr
                          key={r.monthNumber}
                          ref={r.monthNumber === highlightMonth ? focusRowRef : undefined}
                          className={`border-b border-border/40 transition-colors ${
                            r.monthNumber === highlightMonth
                              ? "bg-primary/20 ring-1 ring-primary/50"
                              : r.isActual
                              ? "bg-emerald-500/5 hover:bg-emerald-500/10"
                              : "hover:bg-muted/20"
                          } ${r.monthNumber === lastActualMonth ? "border-b-2 border-b-emerald-500/40" : ""}`}
                        >
                          <td className="px-4 py-2.5 font-semibold text-foreground">{r.monthNumber}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-1.5">
                              {r.isActual ? (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/40 text-emerald-300">Actual</Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border text-muted-foreground">Proj.</Badge>
                              )}
                              {r.offPlan && (
                                <TooltipProvider delayDuration={150}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span
                                        className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400 ring-2 ring-amber-400/20"
                                        aria-label="Off-plan month"
                                      />
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="max-w-[220px] text-xs">
                                      Off-plan: this settled month diverged from the plan (skipped, short, over, or a sweep the balance couldn&rsquo;t fund). See Main Action.
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                            {getMonthLabel(startDate, r.monthNumber)}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-foreground">
                            {r.contribution > 0 ? formatKES(r.contribution) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount">
                            {r.cbkCashIn > 0 ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <span className="status-on-track font-medium">{formatKES(r.cbkCashIn)}</span>
                                {r.maturityBreakdown && r.maturityBreakdown.length > 0 && (
                                  <TooltipProvider delayDuration={150}>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <button
                                          type="button"
                                          className="shrink-0 text-muted-foreground/70 hover:text-primary transition-colors"
                                          aria-label="Maturity breakdown"
                                        >
                                          <Info className="w-3.5 h-3.5" />
                                        </button>
                                      </TooltipTrigger>
                                      <TooltipContent side="left" align="start" className="max-w-xs text-xs space-y-2 p-3">
                                        <p className="font-semibold text-foreground">What matured this month</p>
                                        <div className="space-y-2.5">
                                          {r.maturityBreakdown.map((mb, i) => (
                                            <div key={i} className="space-y-0.5">
                                              <p className="font-medium text-foreground">{mb.label}</p>
                                              <div className="flex items-center justify-between gap-4 text-muted-foreground">
                                                <span>{mb.kind === "bank" ? "Principal" : "Principal (face)"}</span>
                                                <span className="tabular-nums text-foreground">{formatKES(mb.principal)}</span>
                                              </div>
                                              {mb.finalCoupon > 0 && (
                                                <div className="flex items-center justify-between gap-4 text-muted-foreground">
                                                  <span>Final coupon <span className="opacity-60">({mb.taxNote})</span></span>
                                                  <span className="tabular-nums text-emerald-400">+{formatKES(mb.finalCoupon)}</span>
                                                </div>
                                              )}
                                              {mb.discount > 0 && (
                                                <div className="flex items-center justify-between gap-4 text-muted-foreground">
                                                  <span>Net discount <span className="opacity-60">({mb.taxNote})</span></span>
                                                  <span className="tabular-nums text-emerald-400">+{formatKES(mb.discount)}</span>
                                                </div>
                                              )}
                                              {mb.interest > 0 && (
                                                <div className="flex items-center justify-between gap-4 text-muted-foreground">
                                                  <span>Net interest <span className="opacity-60">({mb.taxNote})</span></span>
                                                  <span className="tabular-nums text-emerald-400">+{formatKES(mb.interest)}</span>
                                                </div>
                                              )}
                                              <div className="flex items-center justify-between gap-4 border-t border-border/50 pt-0.5 mt-0.5">
                                                <span className="font-medium text-foreground">To the MMF</span>
                                                <span className="tabular-nums font-semibold text-foreground">{formatKES(mb.total)}</span>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                )}
                              </div>
                            ) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount">
                            {r.bankCashIn > 0 ? (
                              <span className="status-on-track font-medium">{formatKES(r.bankCashIn)}</span>
                            ) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount">
                            {r.mmfToDhow > 0 ? (
                              <span className="text-primary font-medium">{formatKES(r.mmfToDhow)}</span>
                            ) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground max-w-xs">
                            <div className="flex items-start gap-1.5">
                              <span className="truncate" title={r.mainAction}>{r.mainAction}</span>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="mt-0.5 shrink-0 text-muted-foreground/70 hover:text-primary transition-colors active:scale-[0.97]"
                                    aria-label="Explain this month in plain language"
                                  >
                                    <MessageSquareText className="w-3.5 h-3.5" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent side="top" align="start" className="w-80 text-xs p-3 space-y-2">
                                  {(() => {
                                    const ex = explainLedgerRow(r);
                                    return (
                                      <>
                                        <div className="flex items-center justify-between gap-2">
                                          <p className="font-semibold text-foreground">{ex.lede}</p>
                                          {ex.offPlan && (
                                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/40 text-amber-500">Off-plan</Badge>
                                          )}
                                        </div>
                                        <div className="space-y-1.5">
                                          {ex.lines.map((l) => (
                                            <div key={l.key} className="flex items-start justify-between gap-3">
                                              <span className="text-muted-foreground leading-snug">{l.detail}</span>
                                              {l.sign !== "neutral" && l.amount > 0 && (
                                                <span className={`tabular-nums shrink-0 font-medium ${l.sign === "in" ? "text-emerald-500" : "text-primary"}`}>
                                                  {l.sign === "in" ? "+" : "\u2212"}{formatKES(l.amount)}
                                                </span>
                                              )}
                                            </div>
                                          ))}
                                        </div>
                                        <p className="text-muted-foreground border-t border-border/50 pt-1.5 leading-snug">{ex.closing}</p>
                                      </>
                                    );
                                  })()}
                                </PopoverContent>
                              </Popover>
                              {isManager && (
                                <button
                                  type="button"
                                  onClick={() => setExplainMonth(r.monthNumber)}
                                  className="mt-0.5 shrink-0 text-muted-foreground/70 hover:text-violet-500 transition-colors active:scale-[0.97]"
                                  aria-label="Explain this month with AI"
                                  title="Explain this month with AI"
                                >
                                  <Sparkles className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {r.sweepRationale && (
                                <TooltipProvider delayDuration={150}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        className="mt-0.5 shrink-0 text-muted-foreground/70 hover:text-primary transition-colors"
                                        aria-label="Why this instrument was chosen"
                                      >
                                        <Info className="w-3.5 h-3.5" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" align="start" className="max-w-sm text-xs space-y-2 p-3">
                                      <p className="font-semibold text-foreground">
                                        Why this instrument? — KES {Math.round(r.sweepRationale.amount).toLocaleString()} swept
                                      </p>
                                      <p className="leading-relaxed text-muted-foreground">{r.sweepRationale.summary}</p>
                                      <div className="pt-1">
                                        <p className="font-medium text-foreground mb-1">Net-of-tax yield ranking</p>
                                        <div className="space-y-0.5">
                                          {r.sweepRationale.candidates.map((c) => (
                                            <div
                                              key={c.bucket}
                                              className={`flex items-center justify-between gap-3 ${c.chosen ? "text-foreground font-medium" : "text-muted-foreground"}`}
                                            >
                                              <span className="flex items-center gap-1.5">
                                                <span className="tabular-nums opacity-60">#{c.rank}</span>
                                                {c.label}
                                                {c.chosen && <span className="text-emerald-500">✓</span>}
                                              </span>
                                              <span className="tabular-nums">
                                                {c.netPct.toFixed(2)}% net
                                                <span className="opacity-50"> ({c.taxNote})</span>
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-foreground font-medium">
                            {liquidShares.length > 1 && r.mmfEnd > 0 ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <span>{formatKES(r.mmfEnd)}</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="shrink-0 text-muted-foreground/70 hover:text-sky-400 transition-colors"
                                      aria-label="Liquid split for this month"
                                    >
                                      <Info className="w-3.5 h-3.5" />
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="left" align="start" className="max-w-xs text-xs space-y-2 p-3">
                                    <p className="font-semibold text-foreground">
                                      Recommended liquid split this month
                                    </p>
                                    <p className="text-muted-foreground">
                                      How this month's {formatKES(r.mmfEnd)} liquid balance would diversify across your
                                      eligible homes (keeping each issuer under its cap):
                                    </p>
                                    <div className="space-y-1">
                                      {liquidShares.map((s) => (
                                        <div key={s.id} className="flex items-center justify-between gap-4">
                                          <span className="text-foreground truncate">
                                            {s.label}
                                            <span className="text-muted-foreground"> · {s.netYieldPct.toFixed(2)}% net</span>
                                          </span>
                                          <span className="tabular-nums font-medium text-sky-300 shrink-0">
                                            {formatKES(r.mmfEnd * s.frac)}
                                            <span className="text-muted-foreground"> ({Math.round(s.frac * 100)}%)</span>
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                    <p className="text-[11px] text-muted-foreground/70 pt-1 border-t border-border/50">
                                      Guidance only — the projection holds this as one MMF balance; the split shows
                                      where to place it to stay diversified.
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            ) : (
                              formatKES(r.mmfEnd)
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-emerald-300/90">
                            {r.mmfInterestNet > 0 ? formatKES(r.mmfInterestNet) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                            {r.tbill91End > 0 ? formatKES(r.tbill91End) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                            {r.tbill182End > 0 ? formatKES(r.tbill182End) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                            {r.tbill364End > 0 ? formatKES(r.tbill364End) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                            {r.ifbEnd > 0 ? (
                              <span className="inline-flex items-center gap-1">
                                {formatKES(r.ifbEnd)}
                                {r.ifbTenorYears > 0 && (
                                  <span className="text-[10px] text-violet-400/80">{r.ifbTenorYears}y</span>
                                )}
                              </span>
                            ) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                            {r.fxdEnd > 0 ? formatKES(r.fxdEnd) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                            {r.bankEnd > 0 ? formatKES(r.bankEnd) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount font-bold text-foreground">
                            <span className="tabular-nums">{formatKES(r.totalEnd)}</span>
                            <span
                              className={`block text-[10px] font-medium uppercase tracking-wide ${
                                r.isActual ? "text-emerald-400/80" : "text-muted-foreground/70"
                              }`}
                              title={
                                r.isActual
                                  ? "Recorded holdings (goal-plan scope)"
                                  : "Engine future-value model"
                              }
                            >
                              {r.isActual ? "Actual" : "Projected"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge
                              variant="outline"
                              className={`text-xs px-2 py-0.5 border ${getPhaseColorClass(r.phase)}`}
                            >
                              {getPhaseName(r.phase).split(" ")[0]}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                </tbody>
                {!isLoading && filtered.length > 0 && (
                  <tfoot>
                    <tr className="border-t-2 border-border bg-muted/40 font-semibold text-foreground">
                      <td className="px-4 py-3" colSpan={3}>
                        Totals ({filtered.length} mo{search ? ", filtered" : ""})
                      </td>
                      <td className="px-4 py-3 text-right kes-amount">{formatKES(totals.contribution)}</td>
                      <td className="px-4 py-3 text-right kes-amount">{totals.cbkCashIn > 0 ? formatKES(totals.cbkCashIn) : "–"}</td>
                      <td className="px-4 py-3 text-right kes-amount">{totals.bankCashIn > 0 ? formatKES(totals.bankCashIn) : "–"}</td>
                      <td className="px-4 py-3 text-right kes-amount">{totals.mmfToDhow > 0 ? formatKES(totals.mmfToDhow) : "–"}</td>
                      <td className="px-4 py-3 text-left text-xs text-muted-foreground font-normal">
                        Ending balances · month {totals.lastMonth}
                      </td>
                      <td className="px-4 py-3 text-right kes-amount">{formatKES(totals.endMmf)}</td>
                      <td className="px-4 py-3 text-right kes-amount text-emerald-300/90">{totals.mmfInterestNet > 0 ? formatKES(totals.mmfInterestNet) : "–"}</td>
                      <td className="px-4 py-3 text-right kes-amount">{totals.endTbill91 > 0 ? formatKES(totals.endTbill91) : "–"}</td>
                      <td className="px-4 py-3 text-right kes-amount">{totals.endTbill182 > 0 ? formatKES(totals.endTbill182) : "–"}</td>
                      <td className="px-4 py-3 text-right kes-amount">{totals.endTbill364 > 0 ? formatKES(totals.endTbill364) : "–"}</td>
                      <td className="px-4 py-3 text-right kes-amount">{totals.endIfb > 0 ? formatKES(totals.endIfb) : "–"}</td>
                      <td className="px-4 py-3 text-right kes-amount">{totals.endFxd > 0 ? formatKES(totals.endFxd) : "–"}</td>
                      <td className="px-4 py-3 text-right kes-amount">{totals.endBank > 0 ? formatKES(totals.endBank) : "–"}</td>
                      <td className="px-4 py-3 text-right kes-amount font-bold">{formatKES(totals.endTotal)}</td>
                      <td className="px-4 py-3" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} months
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Part 5: recorded income events — a separate ACTUAL stream ──────── */}
        {incomeEvents.length > 0 && (
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="w-4 h-4 text-primary" />
                Recorded income events
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Dividends, REIT distributions and offshore income you have logged against your
                holdings — {formatKES(incomeTotal)} received in total. These are <span className="font-medium text-foreground">actual cash receipts</span>,
                kept separate from the projected core-portfolio flows above (which never assume
                this income).
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Holding</th>
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incomeEvents.map((e) => (
                      <tr key={e.id} className="border-b border-border/50 last:border-0">
                        <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                          {new Date(e.incomeDate).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })}
                        </td>
                        <td className="px-3 py-2 text-foreground">{e.holdingName}</td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[11px] font-normal capitalize">
                            {e.incomeType ?? (e.behaviorClass === "equity" ? "dividend" : e.behaviorClass === "reit" ? "distribution" : "income")}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right kes-amount font-medium text-foreground whitespace-nowrap">{formatKES(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-border font-semibold">
                      <td className="px-3 py-2" colSpan={3}>Total received</td>
                      <td className="px-3 py-2 text-right kes-amount whitespace-nowrap">{formatKES(incomeTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <AiExplainDialog
        open={explainMonth != null}
        onOpenChange={(v) => { if (!v) setExplainMonth(null); }}
        title={explainRow ? `Explain month #${explainRow.monthNumber}` : "Explain this month"}
        description="A plain-language read on what came in, what matured, what was swept, what stayed liquid, and the interest/tax impact for this month. It reads the figures already in this row and changes nothing."
        answer={ledgerExplainQuery.data?.answer}
        isLoading={ledgerExplainQuery.isLoading || ledgerExplainQuery.isFetching}
        isError={ledgerExplainQuery.isError}
        errorMessage={ledgerExplainQuery.error?.message}
        onRetry={() => ledgerExplainQuery.refetch()}
      />
      </TooltipProvider>
    </AppShell>
  );
}
