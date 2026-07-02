import { useMemo, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePortfolio } from "@/contexts/PortfolioContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InfoHint } from "@/components/InfoHint";
import { CatalogueRowControls, type CatalogueKind } from "@/components/CatalogueRowControls";
import {
  Search,
  Info,
  ShieldAlert,
  Clock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FlaskConical,
  Calculator,
  ExternalLink,
  ShieldCheck,
  Wrench,
  Trash2,
  RotateCcw,
  Archive,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { rateStaleness } from "@/lib/rateStaleness";
import { catalogueLabel, type ReferenceCatalogue } from "@shared/researchPipeline";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

/**
 * All Approved Instruments (Round 86)
 * ───────────────────────────────────
 * A dedicated, read-only screener over the APPROVED reference universe — the
 * union of every governed, published row across the four reference catalogues
 * (MMF, bank, CBK securities, market assets).
 *
 * What makes this different from the old Explore screener it replaces:
 *  - It reads a single server view (`explore.approvedList`) whose eligibility gate
 *    already excludes unverified / AI-only / archived rows. Seed or scraped rows
 *    that were never approved (e.g. an unverified NSE:EABL) DO NOT appear here.
 *  - "Plan Fit" is a transparent, auditable composite of the published facts
 *    (net yield after tax, liquidity, fees, issuer concentration, freshness,
 *    verification). It is OFF by default, it never reorders the list unless the
 *    user explicitly clicks the column, and it is labelled a calculation — never
 *    a recommendation. There is no "best/top/buy" language anywhere.
 *  - Reference data shown here does not affect portfolio math until a holding is
 *    actually recorded — stated plainly in the header so it is never mistaken for
 *    the user's own positions.
 *  - Managers get the same governed lifecycle controls (deactivate / mark stale /
 *    audit / rate history) inline, plus a one-click "Open in catalogue" deep link.
 */

type ApprovedResult = inferRouterOutputs<AppRouter>["explore"]["approvedList"];
type ApprovedRow = ApprovedResult["instruments"][number];
type PlanFitEntry = ApprovedResult["planFit"][string];

const CAT_ORDER: Record<string, number> = { mmf: 0, bank: 1, cbk: 2, market_asset: 3 };

/** Catalogue badge palette — neutral hues, no good/bad colouring. */
const CAT_BADGE: Record<ReferenceCatalogue, string> = {
  mmf: "border-sky-500/30 text-sky-600 dark:text-sky-400",
  bank: "border-violet-500/30 text-violet-600 dark:text-violet-400",
  cbk: "border-teal-500/30 text-teal-600 dark:text-teal-400",
  market_asset: "border-amber-500/30 text-amber-600 dark:text-amber-400",
};

type SortKey = "planFit" | null;
type SortDir = "asc" | "desc";

function catParamFor(cat: ReferenceCatalogue): string {
  return cat === "mmf"
    ? "mmf-market"
    : cat === "bank"
      ? "bank-catalogue"
      : cat === "cbk"
        ? "cbk-securities"
        : "market-assets";
}

/** The deep link back into the owning catalogue tab, scrolled-to + highlighted. */
function catalogueHref(r: ApprovedRow): string {
  const cat = r.catalogue as ReferenceCatalogue;
  const refValue = cat === "mmf" || cat === "bank" ? r.name : r.ref;
  return `/research?tab=reference-catalogues&cat=${catParamFor(cat)}&ref=${encodeURIComponent(refValue)}`;
}

function fmtFigure(r: ApprovedRow): string {
  if (r.headlineFigure === null) return "—";
  return r.headlineLabel.toLowerCase().includes("price")
    ? `${r.currency ?? ""} ${r.headlineFigure.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`.trim()
    : `${r.headlineFigure.toFixed(2)}%`;
}

export default function AllApprovedInstruments({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const isManager = user?.role === "admin";
  const { data, isLoading } = trpc.explore.approvedList.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(() => data?.instruments ?? [], [data]);
  const planFit = data?.planFit ?? {};
  const weights = data?.weights;

  // User-controlled filters — the user narrows the universe; the tool never pre-filters.
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [currencyFilter, setCurrencyFilter] = useState<string>("all");
  const [minFigure, setMinFigure] = useState<string>("");
  const [maxFigure, setMaxFigure] = useState<string>("");

  // Plan Fit is OFF by default so the list opens in its neutral order.
  const [showPlanFit, setShowPlanFit] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>(null);
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const currencies = useMemo(
    () => Array.from(new Set(rows.map((r) => r.currency).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const minY = minFigure.trim() === "" ? null : Number(minFigure);
    const maxY = maxFigure.trim() === "" ? null : Number(maxFigure);
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (catFilter !== "all" && r.catalogue !== catFilter) return false;
      if (currencyFilter !== "all" && (r.currency ?? "") !== currencyFilter) return false;
      if (q && !`${r.name} ${r.issuer ?? ""} ${r.ref}`.toLowerCase().includes(q)) return false;
      const y = r.headlineFigure;
      if (minY !== null && !isNaN(minY) && (y === null || y < minY)) return false;
      if (maxY !== null && !isNaN(maxY) && (y === null || y > maxY)) return false;
      return true;
    });

    // Neutral default order: catalogue, then name. A Plan-Fit sort applies ONLY on
    // an explicit user click; ineligible/absent rows always sort last regardless of
    // direction (so a missing score never reads as "avoid").
    if (sortKey === "planFit") {
      const dir = sortDir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        const sa = planFit[a.ref];
        const sb = planFit[b.ref];
        const av = sa && sa.eligible && Number.isFinite(sa.score) ? sa.score : null;
        const bv = sb && sb.eligible && Number.isFinite(sb.score) ? sb.score : null;
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return (av - bv) * dir;
      });
    } else {
      out = [...out].sort((a, b) => {
        const c = (CAT_ORDER[a.catalogue] ?? 9) - (CAT_ORDER[b.catalogue] ?? 9);
        return c !== 0 ? c : a.name.localeCompare(b.name);
      });
    }
    return out;
  }, [rows, search, catFilter, currencyFilter, minFigure, maxFigure, sortKey, sortDir, planFit]);

  function togglePlanFitSort() {
    if (sortKey === "planFit") {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey("planFit");
      setSortDir("desc");
    }
  }

  const resetFilters = () => {
    setSearch("");
    setCatFilter("all");
    setCurrencyFilter("all");
    setMinFigure("");
    setMaxFigure("");
    setSortKey(null);
    setSortDir("desc");
  };

  return (
    <AppShell embedded={embedded}>
      <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
              All Approved Instruments
            </h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Every instrument here has been <span className="font-medium text-foreground">approved into one of the
              four reference catalogues</span> through governed review, with its figures sourced and audited. This is a
              neutral, read-only screener: you decide what to look at, filter and compare. Nothing is recommended, and
              nothing shown here affects your portfolio math until you actually record a holding.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={showPlanFit ? "default" : "outline"}
              onClick={() => {
                const next = !showPlanFit;
                setShowPlanFit(next);
                // Turning Plan Fit off also drops a Plan-Fit sort so the list returns
                // to its neutral order; turning it on never auto-sorts.
                if (!next && sortKey === "planFit") {
                  setSortKey(null);
                  setSortDir("desc");
                }
              }}
              className="active:scale-[0.97] transition-transform"
              aria-pressed={showPlanFit}
            >
              <Calculator className="w-4 h-4 mr-1.5" /> {showPlanFit ? "Hide Plan Fit" : "Show Plan Fit"}
            </Button>
            <Badge variant="outline" className="text-xs px-2.5 py-1 gap-1.5">
              <Info className="w-3 h-3" /> Information only
            </Badge>
          </div>
        </div>

        {/* Persistent disclaimer — always visible, not dismissible */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              <strong>For information only — this is not advice or a recommendation.</strong>{" "}
              Figures are gathered from public sources, may be delayed or inaccurate, and can change without notice.
              Verify every number with the issuer or a licensed adviser before acting. This tool does not sell, broker,
              or execute any investment.
            </p>
          </CardContent>
        </Card>

        {/* Filters — the user narrows the universe */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="w-4 h-4" /> Filter the approved universe
            </CardTitle>
            <CardDescription className="text-xs">
              All facets are yours to set. The list starts in a neutral order (by catalogue, then name) and only
              re-sorts when you click the Plan Fit column. Only approved, active catalogue rows appear here — unverified
              AI findings never do.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Search</Label>
                <Input
                  placeholder="Name, issuer, or reference"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Catalogue</Label>
                <Select value={catFilter} onValueChange={setCatFilter}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All catalogues</SelectItem>
                    <SelectItem value="mmf">Money-market funds</SelectItem>
                    <SelectItem value="bank">Bank products</SelectItem>
                    <SelectItem value="cbk">CBK securities</SelectItem>
                    <SelectItem value="market_asset">Market assets</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Currency</Label>
                <Select value={currencyFilter} onValueChange={setCurrencyFilter}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All currencies</SelectItem>
                    {currencies.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Min headline figure</Label>
                <Input type="number" inputMode="decimal" value={minFigure}
                  onChange={(e) => setMinFigure(e.target.value)} className="h-9" placeholder="e.g. 8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max headline figure</Label>
                <Input type="number" inputMode="decimal" value={maxFigure}
                  onChange={(e) => setMaxFigure(e.target.value)} className="h-9" placeholder="e.g. 15" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {rows.length} approved
              </p>
              <Button variant="outline" size="sm" onClick={resetFilters} className="h-8 text-xs">
                Reset filters &amp; sort
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Approved universe table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading approved instruments…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                {rows.length === 0
                  ? "No instruments have been approved into the reference catalogues yet."
                  : "No approved instruments match your filters. Try widening them."}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Instrument</TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Catalogue
                          <InfoHint>Which of the four reference catalogues this approved entry lives in — Money-market funds, Bank products, CBK securities, or Market assets.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead>Ccy</TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1 w-full">
                          Headline figure
                          <InfoHint side="left">Each catalogue's own headline number: effective annual rate for funds, indicative rate for bank products, and yield or last price for securities. They are not directly comparable — this view lists, it never ranks.</InfoHint>
                        </span>
                      </TableHead>
                      {showPlanFit && (
                        <TableHead className="text-right">
                          <span className="inline-flex items-center justify-end gap-1 w-full">
                            <button
                              onClick={togglePlanFitSort}
                              className={`inline-flex items-center gap-1 font-semibold transition-colors hover:text-foreground ${sortKey === "planFit" ? "text-foreground" : "text-muted-foreground"}`}
                            >
                              Plan Fit
                              {sortKey === "planFit" ? (
                                sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-50" />
                              )}
                            </button>
                            <InfoHint side="left">A transparent, factual composite: net yield (after tax) minus point penalties for term lock-ups, issuer concentration, stale or unverified figures, and fees. Click any value to audit the exact points — it is a calculation, not a recommendation. Rows missing a usable figure show no Plan Fit.</InfoHint>
                          </span>
                        </TableHead>
                      )}
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Source &amp; freshness
                          <InfoHint>Where each figure came from and how recently it was updated. "May be stale" means the data is older than expected and should be re-checked before relying on it.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <ApprovedInstrumentRow
                        key={`${r.catalogue}:${r.ref}`}
                        r={r}
                        showPlanFit={showPlanFit}
                        fit={planFit[r.ref]}
                        weights={weights}
                        isManager={isManager}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Manager-only reference-data maintenance (governed cleanup) */}
        {isManager && <ReferenceDataMaintenance />}

        {/* Mode note */}
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <FlaskConical className="w-3.5 h-3.5" />
          This screener is the same in Live and Test. Reference data does not move real money — it only becomes part
          of your plan when you record a holding under Holdings.
        </p>
      </div>
    </AppShell>
  );
}

/**
 * ReferenceDataMaintenance — manager-only governed cleanup for the reference layer.
 *
 * Two safety tiers:
 *  - Always available (Live-safe): ARCHIVE all reference rows (soft — deactivates
 *    + archives, history preserved, reversible from each catalogue), CLEAR the
 *    pending research queue, and CLEAR the approval audit log. None of these hard-
 *    delete a live catalogue row.
 *  - Test mode only: a HARD reset-to-seed that truncates the three catalogues and
 *    their rate history, then re-seeds from code. Hidden entirely in Live so it can
 *    never be reached against real tracking data, and still gated behind a typed
 *    confirm dialog.
 *
 * Every action goes through an AlertDialog confirm and reports what it changed.
 */
function ReferenceDataMaintenance() {
  const { mode } = usePortfolio();
  const isTestMode = mode === "sandbox";
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);

  const invalidateAll = async () => {
    await Promise.all([
      utils.explore.approvedList.invalidate(),
      utils.explore.federatedUniverse.invalidate(),
      utils.mmfFunds.list.invalidate(),
      utils.bankInstruments.list.invalidate(),
      utils.researchPipeline.recentlyApproved.invalidate(),
      utils.researchPipeline.listUpdates.invalidate(),
      utils.catalogue.rowMeta.invalidate(),
    ]);
  };

  const archiveAll = trpc.researchAdmin.archiveAllReferenceRows.useMutation({
    onSuccess: async (r) => {
      await invalidateAll();
      toast.success(`Archived ${r.archived} reference row${r.archived === 1 ? "" : "s"}`, {
        description: "Rows were deactivated and archived — history is kept and each row can be reactivated from its catalogue.",
      });
    },
    onError: (e) => toast.error("Could not archive reference rows", { description: e.message }),
  });
  const clearPending = trpc.researchAdmin.clearPendingQueue.useMutation({
    onSuccess: async (r) => {
      await invalidateAll();
      toast.success(`Cleared ${r.deleted} pending item${r.deleted === 1 ? "" : "s"}`);
    },
    onError: (e) => toast.error("Could not clear the pending queue", { description: e.message }),
  });
  const clearAudit = trpc.researchAdmin.clearApprovalAuditLog.useMutation({
    onSuccess: async (r) => {
      await invalidateAll();
      toast.success(`Cleared ${r.deleted} approval log entr${r.deleted === 1 ? "y" : "ies"}`);
    },
    onError: (e) => toast.error("Could not clear the approval log", { description: e.message }),
  });
  const resetToSeed = trpc.researchAdmin.resetToSeed.useMutation({
    onSuccess: async (r) => {
      await invalidateAll();
      toast.success("Reference catalogues reset to seed", {
        description: `Re-seeded ${r.opportunitiesSeeded} opportunity row${r.opportunitiesSeeded === 1 ? "" : "s"}. MMF & bank catalogues are now empty until re-approved.`,
      });
    },
    onError: (e) => toast.error("Could not reset to seed", { description: e.message }),
  });

  const busy =
    archiveAll.isPending || clearPending.isPending || clearAudit.isPending || resetToSeed.isPending;

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between gap-2 text-left cursor-pointer"
          aria-expanded={open}
        >
          <CardTitle className="text-sm flex items-center gap-2">
            <Wrench className="w-4 h-4 text-muted-foreground" /> Reference-data maintenance
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
              <ShieldCheck className="w-3 h-3" /> Manager
            </Badge>
          </CardTitle>
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
        </button>
        <CardDescription className="text-xs">
          Governed cleanup for the reference layer. Live-safe actions only archive or clear working data; the
          destructive reset-to-seed is available in Test mode only.
        </CardDescription>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <MaintenanceAction
              icon={<Archive className="w-4 h-4" />}
              label="Archive all reference rows"
              description="Deactivate + archive every active row across all four catalogues. History is kept and each row can be reactivated from its catalogue. Nothing is hard-deleted."
              confirmTitle="Archive all reference rows?"
              confirmBody="This deactivates and archives every active row in the MMF, bank, CBK and market-asset catalogues. It is reversible — you can reactivate rows from each catalogue — and it does not touch any recorded holdings or portfolio math."
              actionLabel="Archive all"
              pending={archiveAll.isPending}
              disabled={busy}
              onConfirm={() => archiveAll.mutate({})}
            />
            <MaintenanceAction
              icon={<Trash2 className="w-4 h-4" />}
              label="Clear pending queue"
              description="Delete every item currently waiting in the research review queue. Approved rows and catalogues are untouched."
              confirmTitle="Clear the pending research queue?"
              confirmBody="This permanently deletes all pending (not-yet-reviewed) research updates. Already-approved rows and your catalogues are not affected."
              actionLabel="Clear queue"
              pending={clearPending.isPending}
              disabled={busy}
              onConfirm={() => clearPending.mutate()}
            />
            <MaintenanceAction
              icon={<Trash2 className="w-4 h-4" />}
              label="Clear approval log"
              description="Empty the 'Recently approved' audit trail. Catalogue rows themselves stay exactly as they are."
              confirmTitle="Clear the approval audit log?"
              confirmBody="This permanently deletes the catalogue approval history shown in Recently Approved. The catalogue rows that were approved are not changed or removed."
              actionLabel="Clear log"
              pending={clearAudit.isPending}
              disabled={busy}
              onConfirm={() => clearAudit.mutate()}
            />
          </div>

          {isTestMode ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-destructive mb-1">
                <FlaskConical className="w-3.5 h-3.5" /> Test mode only — destructive
              </div>
              <p className="text-xs text-muted-foreground mb-2">
                Hard-reset the three reference catalogues to their seed state. This truncates every MMF, bank, CBK and
                market-asset row plus their rate history, then re-seeds the opportunity catalogue from code. There is no
                undo.
              </p>
              <MaintenanceAction
                icon={<RotateCcw className="w-4 h-4" />}
                label="Reset catalogues to seed"
                description=""
                inline
                destructive
                confirmTitle="Reset all reference catalogues to seed?"
                confirmBody="This permanently deletes ALL reference rows (MMF, bank, CBK, market assets) and their rate history, then re-seeds the opportunity catalogue from code. It cannot be undone. Only proceed in Test mode."
                actionLabel="Reset to seed"
                pending={resetToSeed.isPending}
                disabled={busy}
                onConfirm={() => resetToSeed.mutate({ confirm: true })}
              />
            </div>
          ) : (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              You are in Live mode — the destructive reset-to-seed is hidden. Switch to Test mode to reset seeded data.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

function MaintenanceAction({
  icon,
  label,
  description,
  confirmTitle,
  confirmBody,
  actionLabel,
  pending,
  disabled,
  onConfirm,
  destructive,
  inline,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  confirmTitle: string;
  confirmBody: string;
  actionLabel: string;
  pending: boolean;
  disabled: boolean;
  onConfirm: () => void;
  destructive?: boolean;
  inline?: boolean;
}) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant={destructive ? "destructive" : "outline"}
          disabled={disabled}
          className={inline ? "active:scale-[0.97] transition-transform" : "h-auto flex-col items-start gap-1 p-3 text-left active:scale-[0.99] transition-transform"}
        >
          <span className="flex items-center gap-1.5 text-sm font-medium">
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : icon} {label}
          </span>
          {!inline && description && (
            <span className="text-xs text-muted-foreground font-normal whitespace-normal leading-snug">{description}</span>
          )}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
          <AlertDialogDescription>{confirmBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
          >
            {actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The Plan-Fit cell — plain number with a click-to-open, itemised breakdown. */
function PlanFitCell({
  fit,
  weights,
}: {
  fit?: PlanFitEntry;
  weights?: ApprovedResult["weights"];
}) {
  if (!fit) return <span className="text-muted-foreground">—</span>;
  if (!fit.eligible) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-muted-foreground cursor-help underline decoration-dotted underline-offset-2">—</span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs text-xs leading-relaxed">
          No Plan Fit: {fit.ineligibleReasons.join(", ") || "excluded from the calculation"}. This is an exclusion from
          the calculation, not a low rating.
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary underline decoration-dotted underline-offset-2 active:scale-[0.97] transition-transform">
          {fit.score.toFixed(1)}
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-80 text-left">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold">Plan Fit breakdown</p>
            <span className="text-lg font-bold tabular-nums">{fit.score.toFixed(1)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            A transparent sum of the facts below. Positive points come from net yield; negative points are penalties for
            risk/quality factors. This is a calculation you can audit — it is not a recommendation.
          </p>
          <div className="divide-y divide-border rounded-md border">
            {fit.components.map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="text-xs font-medium">{c.label}</p>
                  <p className="text-[10px] text-muted-foreground leading-snug">{c.detail}</p>
                </div>
                <span
                  className={`text-xs font-semibold tabular-nums shrink-0 ${
                    c.points > 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : c.points < 0
                        ? "text-red-600 dark:text-red-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {c.points > 0 ? "+" : ""}{c.points.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
          {weights && (
            <p className="text-[10px] text-muted-foreground">
              Net yield is scored at {weights.netYieldPerPct} point(s) per percentage point. The same weights apply to
              every instrument.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One approved-universe row: facts + provenance + governed lifecycle + catalogue link. */
function ApprovedInstrumentRow({
  r,
  showPlanFit,
  fit,
  weights,
  isManager,
}: {
  r: ApprovedRow;
  showPlanFit: boolean;
  fit?: PlanFitEntry;
  weights?: ApprovedResult["weights"];
  isManager: boolean;
}) {
  const cat = r.catalogue as ReferenceCatalogue;
  const stale = rateStaleness(r.dataAsOf ? new Date(r.dataAsOf) : null);
  return (
    <TableRow className="align-top">
      <TableCell>
        <Link href={catalogueHref(r)} className="font-medium text-foreground hover:text-primary hover:underline">
          {r.name}
        </Link>
        {r.issuer && <div className="text-xs text-muted-foreground mt-0.5">{r.issuer}</div>}
        {r.verificationState === "human_verified" && (
          <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
            <ShieldCheck className="w-2.5 h-2.5" /> Verified
          </Badge>
        )}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CAT_BADGE[cat] ?? ""}`}>
          {catalogueLabel(cat)}
        </Badge>
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap">{r.currency ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums">
        <div>{fmtFigure(r)}</div>
        <div className="text-[10px] text-muted-foreground">{r.headlineLabel}</div>
      </TableCell>
      {showPlanFit && (
        <TableCell className="text-right">
          <PlanFitCell fit={fit} weights={weights} />
        </TableCell>
      )}
      <TableCell>
        <div className="text-xs text-muted-foreground max-w-[220px]">{r.source ?? "Source not recorded"}</div>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="w-2.5 h-2.5" /> {stale.label}
          </span>
          {(r.stale || stale.isStale) && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-600 dark:text-amber-400">
              May be stale
            </Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Link
                href={catalogueHref(r)}
                className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Open in catalogue"
              >
                <ExternalLink className="w-4 h-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">Open in catalogue</TooltipContent>
          </Tooltip>
          {isManager && (
            <CatalogueRowControls
              catalogue={cat as CatalogueKind}
              targetRef={r.targetRef}
              instrumentName={r.name}
              isActive
              isStale={r.stale}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

