import { usePortfolio } from "@/contexts/PortfolioContext";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, getMonthLabel, getPhaseName, getPhaseColorClass } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, RefreshCw, Search, Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useMemo } from "react";
import { toast } from "sonner";

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

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 24;

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

  const startDate = portfolio?.startDate ? String(portfolio.startDate).split("T")[0] : "2026-07-01";

  // Where do recorded actuals end and the forward projection begin? The engine
  // tags every month it seeded from real holdings with isActual=true.
  const actualMonths = (projection ?? []).filter((r) => r.isActual).length;
  const lastActualMonth = actualMonths > 0
    ? Math.max(...(projection ?? []).filter((r) => r.isActual).map((r) => r.monthNumber))
    : 0;

  return (
    <AppShell>
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
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">Mth</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">Basis</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">Date</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">Save</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">CBK In</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">MMF→Dhow</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Main Action</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">MMF End</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">T-Bill</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">IFB</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">FXD</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">Total</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">Phase</th>
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
                          className={`border-b border-border/40 transition-colors ${
                            r.isActual
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
                            {r.tbillEnd > 0 ? formatKES(r.tbillEnd) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                            {r.ifbEnd > 0 ? formatKES(r.ifbEnd) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                            {r.fxdEnd > 0 ? formatKES(r.fxdEnd) : "–"}
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
    </AppShell>
  );
}
