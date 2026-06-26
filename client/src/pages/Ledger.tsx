import { usePortfolio } from "@/contexts/PortfolioContext";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, getMonthLabel, getPhaseName, getPhaseColorClass } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, RefreshCw, Search, Info, Download, ChevronDown } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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

/** Read the ?focus=<month> query param once on mount (deep-link from the Dashboard timeline). */
function useFocusMonth(): number | null {
  return useMemo(() => {
    if (typeof window === "undefined") return null;
    const v = new URLSearchParams(window.location.search).get("focus");
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n >= 1 ? n : null;
  }, []);
}

export default function Ledger() {
  const { portfolioId, portfolio } = usePortfolio();
  const { data: projection, isLoading } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const syncMutation = trpc.ledger.sync.useMutation({
    onSuccess: () => toast.success("Ledger synced with latest projection"),
    onError: () => toast.error("Failed to sync ledger"),
  });
  const handleSync = () => { if (portfolioId) syncMutation.mutate({ portfolioId }); };

  const focusMonth = useFocusMonth();
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
    const headers = [
      "Month", "Basis", "Date", "Save", "CBK In", "Bank In", "MMF->Securities",
      "Main Action", "MMF End", "T-Bill 91d", "T-Bill 182d", "T-Bill 364d", "IFB", "FXD", "Bank", "Total", "Phase",
    ];
    const rows = rowsSrc.map((r) => [
      r.monthNumber,
      r.isActual ? "Actual" : "Projected",
      getMonthLabel(startDate, r.monthNumber),
      r.contribution,
      r.cbkCashIn,
      r.bankCashIn,
      r.mmfToDhow,
      r.mainAction ?? "",
      r.mmfEnd,
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
      "TOTAL", "", `${rowsSrc.length} months`,
      flowSum((r) => r.contribution),
      flowSum((r) => r.cbkCashIn),
      flowSum((r) => r.bankCashIn),
      flowSum((r) => r.mmfToDhow),
      `Ending balances at month ${last.monthNumber}`,
      last.mmfEnd, last.tbill91End, last.tbill182End, last.tbill364End, last.ifbEnd, last.fxdEnd, last.bankEnd, last.totalEnd,
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
    Mth: "Which month of the plan this row covers (Month 1 is your start). Months up to the last recorded month reflect your real holdings; later months are a forward projection.",
    Basis: "Whether this row is an Actual (built from money you've actually recorded) or a Projection (the model's forward estimate).",
    Date: "The calendar month this row maps to.",
    Save: "The cash you put in that month — your own contribution / new savings.",
    "CBK In": "Cash coming back into your MMF because a government security (T-bill/bond) matured and paid out.",
    "Bank In": "Cash coming back from a matured bank deposit. Stays “–” while your bank holding is a call deposit, which never locks up.",
    "Swept → Securities": "Cash leaving the MMF to buy new T-bills / bonds that month.",
    "Main Action": "The headline move for the month — e.g. which security was bought or rolled over.",
    "MMF End": "What's sitting in your money-market fund at month-end — your liquid pot.",
    "T-Bill 91d": "Money held in 91-day Treasury bills at month-end.",
    "T-Bill 182d": "Money held in 182-day Treasury bills at month-end.",
    "T-Bill 364d": "Money held in 364-day Treasury bills at month-end.",
    IFB: "Money held in Infrastructure Bonds (tax-free government bonds) at month-end.",
    FXD: "Money held in Fixed-coupon Treasury Bonds at month-end.",
    Bank: "Your bank deposit balance at month-end.",
    Total: "Everything added together — your whole portfolio value at month-end.",
    Phase: "Which stage of the strategy you're in for that month.",
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
    <AppShell>
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
                    <ColHead label="Mth" align="left" />
                    <ColHead label="Basis" align="left" />
                    <ColHead label="Date" align="left" />
                    <ColHead label="Save" />
                    <ColHead label="CBK In" />
                    <ColHead label="Bank In" />
                    <ColHead label="Swept&nbsp;&rarr;&nbsp;Securities" />
                    <ColHead label="Main Action" align="left" nowrap={false} />
                    <ColHead label="MMF End" />
                    <ColHead label="T-Bill 91d" />
                    <ColHead label="T-Bill 182d" />
                    <ColHead label="T-Bill 364d" />
                    <ColHead label="IFB" />
                    <ColHead label="FXD" />
                    <ColHead label="Bank" />
                    <ColHead label="Total" />
                    <ColHead label="Phase" align="left" />
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 10 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          {Array.from({ length: 13 }).map((_, j) => (
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
                            {r.isActual ? (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-emerald-500/40 text-emerald-300">Actual</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-border text-muted-foreground">Proj.</Badge>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                            {getMonthLabel(startDate, r.monthNumber)}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-foreground">
                            {r.contribution > 0 ? formatKES(r.contribution) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount">
                            {r.cbkCashIn > 0 ? (
                              <span className="status-on-track font-medium">{formatKES(r.cbkCashIn)}</span>
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
                            {formatKES(r.mmfEnd)}
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
                            {formatKES(r.totalEnd)}
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
      </div>
      </TooltipProvider>
    </AppShell>
  );
}
