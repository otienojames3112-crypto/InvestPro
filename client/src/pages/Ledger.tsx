import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, getMonthLabel, getPhaseName, getPhaseColorClass } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, RefreshCw, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

export default function Ledger() {
  const { data: projection, isLoading } = trpc.projection.run.useQuery();
  const { data: settings } = trpc.settings.get.useQuery();
  const syncMutation = trpc.ledger.sync.useMutation({
    onSuccess: () => toast.success("Ledger synced with latest projection"),
    onError: () => toast.error("Failed to sync ledger"),
  });

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

  const startDate = settings?.startDate ? String(settings.startDate).split("T")[0] : "2026-07-01";

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              Month-by-Month Ledger
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Complete 120-month projection of your investment journey
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => syncMutation.mutate()}
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
                          {Array.from({ length: 12 }).map((_, j) => (
                            <td key={j} className="px-4 py-3">
                              <Skeleton className="h-3 w-full" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : paged.map((r) => (
                        <tr
                          key={r.monthNumber}
                          className="border-b border-border/40 hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-4 py-2.5 font-semibold text-foreground">{r.monthNumber}</td>
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
                          <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate" title={r.mainAction}>
                            {r.mainAction}
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
