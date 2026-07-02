import { useState, useMemo, useEffect } from "react";
import { Link } from "wouter";
import { dashboardHref } from "@shared/navigation";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { invalidatePortfolioMoney } from "@/lib/invalidatePortfolioMoney";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRefFocus } from "@/hooks/useRefFocus";
import { CatalogueRowControls } from "@/components/CatalogueRowControls";
import { CatalogueSourceReviewButton } from "@/components/CatalogueSourceReview";
import { ArchivedRowsPanel, CatalogueScopeFilter, type CatalogueRowScope } from "@/components/ArchivedRowsPanel";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Plus, Pencil, CheckCircle2, Circle, Info, Star, AlertTriangle, ExternalLink } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Fund = {
  id: number;
  fundName: string;
  company: string;
  grossYield: number;
  ear: number;
  managementFee: number;
  minInvestment: number;
  aumMillions: number | null;
  asOfDate: string | null;
  source: string | null;
  isActive: boolean;
};

type SortKey = "fundName" | "ear" | "grossYield" | "managementFee" | "minInvestment" | "aumMillions";
type SortDir = "asc" | "desc";

/** Shorten a source string/URL into a readable label (host, or the raw text). */
function sourceLabel(source: string | null): string | null {
  if (!source) return null;
  const s = source.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return s.length > 32 ? `${s.slice(0, 30)}…` : s;
  }
}

function isUrl(source: string | null): boolean {
  if (!source) return false;
  try {
    const u = new URL(source.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Days since an ISO/date string, or null when unparseable. */
function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr).getTime();
  if (isNaN(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

function freshnessTone(days: number | null): { label: string; cls: string } {
  if (days == null) return { label: "No date", cls: "text-muted-foreground" };
  if (days <= 7) return { label: `${days}d ago`, cls: "text-emerald-600 dark:text-emerald-400" };
  if (days <= 30) return { label: `${days}d ago`, cls: "text-foreground" };
  if (days <= 90) return { label: `${days}d ago`, cls: "text-amber-600 dark:text-amber-400" };
  return { label: `${days}d ago`, cls: "text-red-600 dark:text-red-400" };
}

function FundFormDialog({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Partial<Fund>;
  onSave: (data: Omit<Fund, "id" | "isActive"> & { reason?: string }) => void;
  saving: boolean;
}) {
  const isEdit = !!initial;
  const [form, setForm] = useState({
    fundName: initial?.fundName ?? "",
    company: initial?.company ?? "",
    grossYield: String(initial?.grossYield ?? ""),
    ear: String(initial?.ear ?? ""),
    managementFee: String(initial?.managementFee ?? "2.0"),
    minInvestment: String(initial?.minInvestment ?? "1000"),
    aumMillions: String(initial?.aumMillions ?? ""),
    asOfDate: initial?.asOfDate ?? "",
    source: initial?.source ?? "",
    reason: "",
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = () => {
    if (!form.fundName.trim() || !form.company.trim()) {
      toast.error("Fund name and company are required.");
      return;
    }
    const ear = parseFloat(form.ear);
    const grossYield = parseFloat(form.grossYield);
    if (isNaN(ear) || ear <= 0) { toast.error("EAR must be a positive number."); return; }
    if (isNaN(grossYield) || grossYield <= 0) { toast.error("Gross yield must be a positive number."); return; }
    if (!form.source.trim()) { toast.error("A source URL / reference is required for governed catalogue edits."); return; }
    onSave({
      fundName: form.fundName.trim(),
      company: form.company.trim(),
      grossYield,
      ear,
      managementFee: parseFloat(form.managementFee) || 2.0,
      minInvestment: parseFloat(form.minInvestment) || 1000,
      aumMillions: form.aumMillions ? parseFloat(form.aumMillions) : null,
      asOfDate: form.asOfDate || null,
      source: form.source || null,
      reason: form.reason.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Fund" : "Add MMF Fund"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2">
            <Label>Fund Name *</Label>
            <Input value={form.fundName} onChange={set("fundName")} placeholder="e.g. Cytonn Money Market Fund" />
          </div>
          <div className="col-span-2">
            <Label>Fund Manager / Company *</Label>
            <Input value={form.company} onChange={set("company")} placeholder="e.g. Cytonn Investments" />
          </div>
          <div>
            <Label>Gross Yield (% p.a.) *</Label>
            <Input type="number" step="0.01" value={form.grossYield} onChange={set("grossYield")} placeholder="e.g. 16.0" />
          </div>
          <div>
            <Label>Published EAR — net of fee (% p.a.) *</Label>
            <Input type="number" step="0.01" value={form.ear} onChange={set("ear")} placeholder="e.g. 13.9" />
            <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
              Enter the <strong>daily/effective yield the fund publishes</strong> — Kenyan MMF yields are
              <strong> already net of the manager&rsquo;s fee</strong>. This is the figure the engine compounds (it does
              <strong> not</strong> deduct a fee on top). It should be <strong>below</strong> the gross yield above. WHT is applied separately.
            </p>
            {(() => {
              const ear = parseFloat(form.ear);
              const gross = parseFloat(form.grossYield);
              if (isNaN(ear) || isNaN(gross) || gross <= 0) return null;
              if (ear > gross + 0.05) {
                return (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1 leading-snug">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    This net-of-fee EAR is higher than the gross yield, which isn&rsquo;t possible — net = gross minus the manager&rsquo;s fee. Check you haven&rsquo;t entered a pre-fee gross rate here (that would overstate returns).
                  </p>
                );
              }
              return null;
            })()}
          </div>
          <div>
            <Label>Management Fee (% p.a.)</Label>
            <Input type="number" step="0.01" value={form.managementFee} onChange={set("managementFee")} placeholder="2.0" />
          </div>
          <div>
            <Label>Min. Investment (KES)</Label>
            <Input type="number" step="1" value={form.minInvestment} onChange={set("minInvestment")} placeholder="1000" />
          </div>
          <div>
            <Label>AUM (KES millions)</Label>
            <Input type="number" step="0.01" value={form.aumMillions} onChange={set("aumMillions")} placeholder="optional" />
          </div>
          <div>
            <Label>Data as of Date</Label>
            <Input type="date" value={form.asOfDate} onChange={set("asOfDate")} />
          </div>
          <div className="col-span-2">
            <Label>Source URL / Reference *</Label>
            <Input value={form.source} onChange={set("source")} placeholder="e.g. https://cytonn.com/..." />
            <p className="text-[11px] text-muted-foreground mt-1">Required — every catalogue correction is recorded in the audit trail with its source.</p>
          </div>
          {isEdit && (
            <div className="col-span-2">
              <Label>Reason for correction (optional)</Label>
              <Textarea
                value={form.reason}
                onChange={set("reason")}
                rows={2}
                placeholder="e.g. Corrected EAR after the fund republished its June factsheet."
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Recorded verbatim in the immutable audit trail alongside the old &rarr; new value.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MmfFunds({ embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId, portfolio } = usePortfolio();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isManager = user?.role === "admin";
  const refFocus = useRefFocus();

  const { data: funds = [], isLoading } = trpc.mmfFunds.list.useQuery();
  const { data: metaData } = trpc.catalogue.rowMeta.useQuery(
    { catalogue: "mmf" },
    { enabled: isManager },
  );
  const staleByRef = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const row of Object.values(metaData?.meta ?? {})) m.set(row.targetRef, !!row.stale);
    return m;
  }, [metaData]);

  // Prefill the search box from a deep-link ?ref= so the row is easy to spot even
  // before the highlight fades.
  const [search, setSearch] = useState(() => refFocus.focusRef ?? "");
  // Round 90 — manager-only Active/Archived/All view. Non-managers stay on "active".
  const [scope, setScope] = useState<CatalogueRowScope>("active");

  // Round 86: if the ?ref= belongs to another catalogue (a stale link), clear the
  // prefilled search and drop the ref so this catalogue doesn't filter to nothing.
  useEffect(() => {
    if (isLoading || !refFocus.focusRef) return;
    refFocus.clearIfMissing(
      funds.map((f) => f.fundName),
      () => setSearch((s) => (s === refFocus.focusRef ? "" : s)),
    );
  }, [isLoading, funds, refFocus]);
  const [sortKey, setSortKey] = useState<SortKey>("ear");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [addOpen, setAddOpen] = useState(false);
  const [editFund, setEditFund] = useState<Fund | null>(null);

  const addMutation = trpc.mmfFunds.add.useMutation({
    onSuccess: () => { invalidatePortfolioMoney(utils, portfolioId); setAddOpen(false); toast.success("Fund added."); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.mmfFunds.update.useMutation({
    onSuccess: () => { invalidatePortfolioMoney(utils, portfolioId); setEditFund(null); toast.success("Fund updated — recorded in the audit trail."); },
    onError: (e) => toast.error(e.message),
  });
  const selectFundMutation = trpc.mmfFunds.selectFund.useMutation({
    onSuccess: () => {
      invalidatePortfolioMoney(utils, portfolioId);
      toast.success("Fund selection saved. Projection updated.");
    },
    onError: (e) => toast.error(e.message),
  });

  const selectedFundId = portfolio?.mmfFundId ?? null;

  const [confirmFund, setConfirmFund] = useState<{ id: number; name: string } | null>(null);
  const currentPrimaryName = funds.find((f) => f.id === selectedFundId)?.fundName ?? null;
  const requestSetPrimary = (id: number, name: string) => setConfirmFund({ id, name });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  // ── Computed, source-of-truth statistics (item 4) ────────────────────────────
  // Every headline number below is derived from the live catalogue rows, NOT a
  // hardcoded constant. This keeps the copy honest whatever the data provider is.
  const stats = useMemo(() => {
    const active = funds.filter((f) => f.isActive !== false);
    const count = active.length;
    const avgEar = count ? active.reduce((s, f) => s + f.ear, 0) / count : null;
    const top5 = [...active].sort((a, b) => b.ear - a.ear).slice(0, 5);
    const top5AvgEar = top5.length ? top5.reduce((s, f) => s + f.ear, 0) / top5.length : null;
    const sources = new Set(active.map((f) => sourceLabel(f.source)).filter(Boolean) as string[]);
    // Latest as-of date across the catalogue (freshness of the whole set).
    let latestAsOf: string | null = null;
    for (const f of active) {
      if (f.asOfDate && (!latestAsOf || new Date(f.asOfDate) > new Date(latestAsOf))) latestAsOf = f.asOfDate;
    }
    // Completeness: how many rows carry BOTH a source and an as-of date.
    const complete = active.filter((f) => !!f.source && !!f.asOfDate).length;
    return { count, avgEar, top5AvgEar, sources: Array.from(sources), latestAsOf, complete };
  }, [funds]);

  const top5Ids = useMemo(
    () => [...funds].filter((f) => f.isActive !== false).sort((a, b) => b.ear - a.ear).slice(0, 5).map((f) => f.id),
    [funds],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return funds.filter(
      (f) =>
        f.fundName.toLowerCase().includes(q) ||
        f.company.toLowerCase().includes(q)
    );
  }, [funds, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string" && typeof bv === "string")
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [filtered, sortKey, sortDir]);

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="w-3 h-3 opacity-40 ml-1" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  const selectedFund = funds.find((f) => f.id === selectedFundId);
  const avgEar = stats.avgEar;

  // Source-aware provider phrase: names the distinct source(s) actually present in
  // the data instead of assuming a single hardcoded provider.
  const providerPhrase = useMemo(() => {
    if (stats.sources.length === 0) return "the sources recorded against each fund";
    if (stats.sources.length === 1) return stats.sources[0];
    if (stats.sources.length === 2) return `${stats.sources[0]} and ${stats.sources[1]}`;
    return `${stats.sources[0]}, ${stats.sources[1]} and ${stats.sources.length - 2} other source${stats.sources.length - 2 > 1 ? "s" : ""}`;
  }, [stats.sources]);

  return (
    <AppShell embedded={embedded}>
    <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MMF Market</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
            {stats.count > 0 ? (
              <>
                {stats.count} CMA-regulated Kenyan money market fund{stats.count === 1 ? "" : "s"} currently in the
                catalogue, sourced from {providerPhrase}. Select one to use its published EAR in your projection.
              </>
            ) : (
              <>No funds in the catalogue yet. Approved research proposals appear here once published.</>
            )}
          </p>
        </div>
        {isManager && (
          <div className="flex items-center gap-2 flex-wrap">
            <CatalogueSourceReviewButton catalogue="mmf" isManager={isManager} />
            <Button onClick={() => setAddOpen(true)} size="sm">
              <Plus className="w-4 h-4 mr-1" /> Add Fund
            </Button>
          </div>
        )}
      </div>

      {/* Selected fund banner */}
      {selectedFund ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="py-3 px-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">
                Projection uses <strong>{selectedFund.fundName}</strong> ({selectedFund.ear.toFixed(2)}% EAR)
              </span>
              <Badge variant="secondary" className="text-xs">WHT applied by engine</Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => portfolioId && selectFundMutation.mutate({ portfolioId, mmfFundId: null })}
              disabled={selectFundMutation.isPending}
            >
              Switch to manual rate
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              No fund selected — projection uses the manual MMF yield from Rate Settings.
              Select a fund below to use its published EAR instead.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Computed stat strip — every figure is derived from the live rows */}
      {stats.count > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card>
            <CardContent className="py-3 px-4">
              <div className="text-xs text-muted-foreground">Funds tracked</div>
              <div className="text-xl font-bold tabular-nums">{stats.count}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4">
              <div className="text-xs text-muted-foreground">Average EAR</div>
              <div className="text-xl font-bold tabular-nums">{avgEar != null ? `${avgEar.toFixed(2)}%` : "—"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4">
              <div className="text-xs text-muted-foreground">Top-5 avg EAR</div>
              <div className="text-xl font-bold tabular-nums">{stats.top5AvgEar != null ? `${stats.top5AvgEar.toFixed(2)}%` : "—"}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-3 px-4">
              <div className="text-xs text-muted-foreground">With source + date</div>
              <div className="text-xl font-bold tabular-nums">
                {stats.complete}/{stats.count}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Freshness / completeness note — dynamic, no hardcoded provider or date */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <Info className="w-3 h-3 shrink-0" />
        {stats.latestAsOf ? (
          <>Most recent data point: <strong>{stats.latestAsOf}</strong>.</>
        ) : (
          <>No as-of dates recorded yet.</>
        )}
        {stats.complete < stats.count && (
          <span className="text-amber-600 dark:text-amber-400">
            {stats.count - stats.complete} fund{stats.count - stats.complete === 1 ? "" : "s"} missing a source or date —
            complete them via Edit for a fully sourced catalogue.
          </span>
        )}
      </div>

      {/* Search + manager-only Active/Archived/All scope filter */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search by name or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <CatalogueScopeFilter value={scope} onChange={setScope} />
      </div>

      {/* Archived rows (manager-only, when viewing Archived or All) */}
      {isManager && scope !== "active" && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="text-sm font-medium">Archived funds</div>
            <ArchivedRowsPanel catalogue="mmf" onChanged={() => utils.mmfFunds.list.invalidate()} />
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {scope !== "archived" && (
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-3 font-medium w-8">#</th>
                <th className="text-left px-4 py-3 font-medium">
                  <button className="flex items-center" onClick={() => handleSort("fundName")}>
                    Fund <SortIcon k="fundName" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("ear")}>
                    EAR (%) <SortIcon k="ear" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("grossYield")}>
                    Gross (%) <SortIcon k="grossYield" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("managementFee")}>
                    Fee (%) <SortIcon k="managementFee" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("minInvestment")}>
                    Min (KES) <SortIcon k="minInvestment" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("aumMillions")}>
                    AUM (M) <SortIcon k="aumMillions" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium">Source &amp; freshness</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && sorted.length === 0 && (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">No funds found.</td></tr>
              )}
              {sorted.map((fund, idx) => {
                const isSelected = fund.id === selectedFundId;
                const isTop5 = top5Ids.includes(fund.id);
                const vsAvg = avgEar != null ? fund.ear - avgEar : null;
                const focused = refFocus.isFocused(fund.fundName);
                const src = sourceLabel(fund.source);
                const fresh = freshnessTone(daysSince(fund.asOfDate));
                return (
                  <tr
                    key={fund.id}
                    ref={refFocus.registerRow(fund.fundName)}
                    data-ref={fund.fundName}
                    className={`border-b transition-colors ${
                      isSelected ? "bg-primary/8" : focused ? "bg-primary/5" : "hover:bg-muted/30"
                    }`}
                  >
                    <td className="px-4 py-3 text-muted-foreground text-xs">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium flex items-center gap-1.5 flex-wrap">
                            {fund.fundName}
                            {staleByRef.get(fund.fundName) && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-amber-600 border-amber-300">
                                <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Stale
                              </Badge>
                            )}
                            {isTop5 && (
                              <Badge className="text-[10px] py-0 px-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                                Top 5
                              </Badge>
                            )}
                            {isSelected && (
                              <Badge className="text-[10px] py-0 px-1.5 bg-primary/15 text-primary border-primary/30">
                                Selected
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{fund.company}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${avgEar != null && fund.ear >= avgEar ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        {fund.ear.toFixed(2)}%
                      </span>
                      {vsAvg != null && (
                        <div className="text-[10px] text-muted-foreground">
                          {vsAvg >= 0 ? "+" : ""}{vsAvg.toFixed(1)}% vs avg
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{fund.grossYield.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{fund.managementFee.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {fund.minInvestment.toLocaleString("en-KE")}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {fund.aumMillions != null ? fund.aumMillions.toLocaleString("en-KE", { maximumFractionDigits: 0 }) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-0.5">
                        {src ? (
                          isUrl(fund.source) ? (
                            <a
                              href={fund.source as string}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary underline underline-offset-2 inline-flex items-center gap-1 max-w-[160px] truncate"
                            >
                              {src} <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                            </a>
                          ) : (
                            <span className="text-xs text-foreground max-w-[160px] truncate">{src}</span>
                          )
                        ) : (
                          <span className="text-xs text-amber-600 dark:text-amber-400">No source</span>
                        )}
                        <span className={`text-[10px] ${fresh.cls}`}>
                          {fund.asOfDate ? `as of ${fund.asOfDate} · ${fresh.label}` : "no as-of date"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {isSelected ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs border-primary/40 text-primary"
                            onClick={() => portfolioId && selectFundMutation.mutate({ portfolioId, mmfFundId: null })}
                            disabled={selectFundMutation.isPending}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Selected
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => requestSetPrimary(fund.id, fund.fundName)}
                            disabled={selectFundMutation.isPending}
                          >
                            <Circle className="w-3 h-3 mr-1" /> Select
                          </Button>
                        )}
                        {isManager && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => setEditFund(fund)}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <CatalogueRowControls
                              catalogue="mmf"
                              targetRef={fund.fundName}
                              instrumentName={fund.fundName}
                              isActive={fund.isActive}
                              isStale={staleByRef.get(fund.fundName)}
                            />
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>
      )}

      {/* Reference-vs-holdings separation — account management lives in Holdings. */}
      <Card className="border-primary/20 bg-primary/3">
        <CardContent className="py-4 px-4 flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-2 min-w-0">
            <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">
              This is the <strong className="text-foreground">market reference</strong> — the CMA-regulated MMF
              universe you compare and choose a primary fund from. The MMF <strong className="text-foreground">accounts you actually hold</strong>
              {" "}(balances, monthly contributions, additional funds) are managed under{" "}
              <Link href={dashboardHref.mmf} className="text-primary underline underline-offset-2">Holdings → MMF</Link>.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link href={dashboardHref.mmf}>Go to Holdings → MMF</Link>
          </Button>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        EAR = Effective Annual Rate net of management fee, before 15% WHT. WHT is applied by the projection engine.
        Every figure above (fund count, average and top-5 EAR, freshness) is computed from the live catalogue rows —
        each fund carries its own source and as-of date. Managers correct a figure via Edit; each correction is
        recorded in the audit trail with its source and reason.
      </p>

      {/* Add dialog */}
      {addOpen && (
        <FundFormDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onSave={(data) => addMutation.mutate({ ...data, aumMillions: data.aumMillions ?? undefined, asOfDate: data.asOfDate ?? undefined, source: data.source ?? "" })}
          saving={addMutation.isPending}
        />
      )}

      {/* Edit dialog */}
      {editFund && (
        <FundFormDialog
          open={!!editFund}
          onClose={() => setEditFund(null)}
          initial={editFund}
          onSave={(data) => updateMutation.mutate({
            id: editFund.id,
            fundName: data.fundName,
            company: data.company,
            grossYield: data.grossYield,
            ear: data.ear,
            managementFee: data.managementFee,
            minInvestment: data.minInvestment,
            aumMillions: data.aumMillions ?? undefined,
            asOfDate: data.asOfDate ?? undefined,
            source: data.source ?? "",
            reason: data.reason,
          })}
          saving={updateMutation.isPending}
        />
      )}

      {/* Set-primary confirmation — switching the primary fund re-drives the projection */}
      <AlertDialog open={confirmFund !== null} onOpenChange={(v) => !v && setConfirmFund(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400" /> Make this your primary fund?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-medium text-foreground">{confirmFund?.name}</span> will become the
              fund this plan runs on. Its effective annual rate will drive every future money-market
              month in the headline projection
              {currentPrimaryName ? (
                <>, replacing <span className="font-medium text-foreground">{currentPrimaryName}</span></>
              ) : null}
              . Your recorded balances and history don't change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (portfolioId && confirmFund) {
                  selectFundMutation.mutate({ portfolioId, mmfFundId: confirmFund.id });
                }
                setConfirmFund(null);
              }}
            >
              Set as primary
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </AppShell>
  );
}
