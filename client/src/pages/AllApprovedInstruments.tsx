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
import { AiExplainDialog } from "@/components/AiExplainDialog";
import { trpc } from "@/lib/trpc";
import { ALL_APPROVED_CATALOGUE_FIELD_GUIDE, HOW_TO_READ_CATALOGUE_LABEL, catalogueReadGuide } from "@/lib/catalogueReadGuides";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { InfoHint } from "@/components/InfoHint";
import { CatalogueRowControls, type CatalogueKind } from "@/components/CatalogueRowControls";
import {
  Clock,
  ExternalLink,
  ShieldCheck,
  Wrench,
  Trash2,
  RotateCcw,
  Archive,
  Loader2,
  ChevronDown,
  Sparkles,
} from "lucide-react";
import { rateStaleness } from "@/lib/rateStaleness";
import { catalogueLabel, type ReferenceCatalogue } from "@shared/researchPipeline";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

/**
 * All Approved Instruments
 * ───────────────────────────────────
 * The approved reference universe: one searchable, filterable table over the
 * union of every governed, published row across the four reference catalogues
 * (MMF, bank, CBK securities, market assets). This is the first sub-tab under
 * Reference Catalogues.
 *
 * Governance / framing rules:
 *  - It reads a single server view (`explore.approvedList`) whose eligibility gate
 *    already excludes unverified / AI-only / archived rows. Seed or scraped rows
 *    that were never approved (e.g. an unverified NSE:EABL) DO NOT appear here.
 *    Every row here passed the governed review path (Research → Review Queue →
 *    manager approval).
 *  - Reference data shown here does not affect portfolio math until a holding is
 *    actually recorded — stated plainly in the header so it is never mistaken for
 *    the user's own positions.
 *  - Managers get the same governed lifecycle controls (deactivate / mark stale /
 *    audit / rate history) inline, plus a one-click "Open in catalogue" deep link,
 *    and an optional "Include archived rows" toggle (off by default).
 */

type ApprovedResult = inferRouterOutputs<AppRouter>["explore"]["approvedList"];
/** A table row: an approved instrument, plus a Round-90 archived flag for the
 *  manager-only "Include archived rows" merge (false for the normal active universe). */
type ApprovedRow = ApprovedResult["instruments"][number] & { archived: boolean };

const CAT_ORDER: Record<string, number> = { mmf: 0, bank: 1, cbk: 2, market_asset: 3 };

/** Catalogue badge palette — neutral hues, no good/bad colouring. */
const CAT_BADGE: Record<ReferenceCatalogue, string> = {
  mmf: "border-sky-500/30 text-sky-600 dark:text-sky-400",
  bank: "border-violet-500/30 text-violet-600 dark:text-violet-400",
  cbk: "border-teal-500/30 text-teal-600 dark:text-teal-400",
  market_asset: "border-amber-500/30 text-amber-600 dark:text-amber-400",
};


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
  // Round 96 — always deep-link by the row's stable catalogue-focus key `targetRef`,
  // which each catalogue page registers its rows under:
  //   mmf          → fundName        cbk / market_asset → opportunity ref
  //   bank         → `bank:<id>`  (NEVER the shared bank name — two products at the
  //                 same bank share a name, so linking by name highlighted the wrong
  //                 row / filtered the page to nothing).
  const refValue = r.targetRef;
  return `/research?tab=reference-catalogues&cat=${catParamFor(cat)}&ref=${encodeURIComponent(refValue)}`;
}

function fmtFigure(r: ApprovedRow): string {
  if (r.headlineFigure === null) return "—";
  return r.headlineLabel.toLowerCase().includes("price")
    ? `${r.currency ?? ""} ${r.headlineFigure.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`.trim()
    : `${r.headlineFigure.toFixed(2)}%`;
}

function fmtAsOf(value: string | number | Date | null): string {
  if (!value) return "As-of date not recorded";
  return `As of ${new Date(value).toLocaleDateString("en-KE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })}`;
}

export default function AllApprovedInstruments({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const { portfolioId } = usePortfolio();
  const isManager = user?.role === "admin";
  const { data, isLoading } = trpc.explore.approvedList.useQuery(undefined, {
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // Round 90 — manager-only "Include archived rows" toggle (OFF by default). When
  // on, archived reference rows are merged into the table with an "Archived" badge
  // so managers can find and recover them without leaving the approved view.
  const [includeArchived, setIncludeArchived] = useState(false);
  const { data: archivedData } = trpc.explore.approvedArchived.useQuery(undefined, {
    enabled: isManager && includeArchived,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const rows = useMemo(() => {
    const active = (data?.instruments ?? []).map((r) => ({ ...r, archived: false }));
    if (!includeArchived || !isManager) return active;
    const archived = (archivedData?.instruments ?? []).map((r) => ({ ...r, archived: true }));
    return [...active, ...archived];
  }, [data, archivedData, includeArchived, isManager]);

  // User-controlled filters — the user narrows the universe; the tool never pre-filters.
  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [currencyFilter, setCurrencyFilter] = useState<string>("all");

  const currencies = useMemo(
    () => Array.from(new Set(rows.map((r) => r.currency).filter(Boolean) as string[])).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (catFilter !== "all" && r.catalogue !== catFilter) return false;
      if (currencyFilter !== "all" && (r.currency ?? "") !== currencyFilter) return false;
      if (q && !`${r.name} ${r.issuer ?? ""} ${r.ref}`.toLowerCase().includes(q)) return false;
      return true;
    });

    out = [...out].sort((a, b) => {
      const c = (CAT_ORDER[a.catalogue] ?? 9) - (CAT_ORDER[b.catalogue] ?? 9);
      return c !== 0 ? c : a.name.localeCompare(b.name);
    });
    return out;
  }, [rows, search, catFilter, currencyFilter]);

  const resetFilters = () => {
    setSearch("");
    setCatFilter("all");
    setCurrencyFilter("all");
  };

  const [catExplainOpen, setCatExplainOpen] = useState(false);
  const catFacts = useMemo(() => {
    const counts = rows.reduce<Record<string, number>>((acc, r) => {
      acc[r.catalogue] = (acc[r.catalogue] ?? 0) + 1;
      return acc;
    }, {});
    const l: string[] = [
      `Catalogue: All Approved Instruments. ${filtered.length} rows visible out of ${rows.length}.`,
      "Purpose: master index for approved reference facts across catalogue families.",
      `Families visible: MMF ${counts.mmf ?? 0}, Bank ${counts.bank ?? 0}, CBK ${counts.cbk ?? 0}, Market Assets ${counts.market_asset ?? 0}.`,
      "Open record links to the detailed category catalogue tab for full fields.",
    ];
    return catalogueReadGuide("All Approved Instruments", ALL_APPROVED_CATALOGUE_FIELD_GUIDE, l.join("\n"));
  }, [filtered.length, rows]);
  const catExplainQuery = trpc.aiExplain.referenceCatalogue.useQuery(
    { portfolioId: portfolioId!, catalogueSummary: catFacts },
    { enabled: catExplainOpen && !!portfolioId, refetchOnWindowFocus: false, retry: false },
  );

  return (
    <AppShell embedded={embedded}>
      <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
              All Approved Instruments
            </h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
              Master index of every approved catalogue row, showing its family, headline fact, source, as-of date, and
              status. Open the category record for full details.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCatExplainOpen(true)}
            className="h-7 gap-1.5 text-xs font-medium hover:text-violet-500 hover:border-violet-500/40 active:scale-[0.97] transition-transform"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {HOW_TO_READ_CATALOGUE_LABEL}
          </Button>
        </div>

        <div
          role="note"
          className="flex items-start gap-2 rounded-lg border border-primary/15 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
        >
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            AI findings remain drafts until approved. This index contains approved reference data only; holdings are
            recorded separately, and reference data does not change holdings or portfolio calculations by itself.
          </span>
        </div>

        {/* Compact filter toolbar */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(220px,1fr)_200px_160px]">
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
            </div>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {rows.length}{" "}
                {includeArchived && isManager ? "rows (approved + archived)" : "approved"}
              </p>
              <div className="flex items-center gap-3">
                {isManager && (
                  <div className="flex items-center gap-2">
                    <Switch
                      id="include-archived"
                      checked={includeArchived}
                      onCheckedChange={setIncludeArchived}
                    />
                    <Label htmlFor="include-archived" className="text-xs font-normal cursor-pointer flex items-center gap-1">
                      Include archived rows
                      <InfoHint>
                        Manager-only. Off by default. Archived catalogue rows remain available for audit and
                        reactivation.
                      </InfoHint>
                    </Label>
                  </div>
                )}
                <Button variant="outline" size="sm" onClick={resetFilters} className="h-8 text-xs">
                  Reset filters
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Approved universe table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading approved instruments…</div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center">
                <p className="text-sm font-medium text-foreground">
                  {rows.length === 0 ? "No approved instruments yet." : "No approved instruments match these filters."}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {rows.length === 0
                    ? "Approved catalogue rows will appear here after findings are reviewed and approved."
                    : "Adjust or reset the filters to view more catalogue rows."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Instrument</TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Catalogue family
                          <InfoHint>Which of the four reference catalogues this approved entry lives in — Money-market funds, Bank products, CBK securities, or Market assets.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead>Ccy</TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1 w-full">
                          Headline fact
                          <InfoHint side="left">Each catalogue's own headline number: effective annual rate for funds, indicative rate for bank products, and yield or last price for securities. They are not directly comparable — this view lists, it never ranks.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Source / as-of
                          <InfoHint>Where each figure came from and how recently it was updated. "May be stale" means the data is older than expected and should be re-checked before relying on it.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="w-10"><span className="sr-only">Open record</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <ApprovedInstrumentRow
                        key={`${r.catalogue}:${r.ref}`}
                        r={r}
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

      </div>
      <AiExplainDialog
        open={catExplainOpen}
        onOpenChange={setCatExplainOpen}
        title="How to read All Approved Instruments"
        description="Educational guide to the approved master index, source as-of dates, row status, and links to full category records."
        answer={catExplainQuery.data?.answer}
        isLoading={catExplainQuery.isLoading || catExplainQuery.isFetching}
        isError={catExplainQuery.isError}
        errorMessage={catExplainQuery.error?.message}
        onRetry={() => catExplainQuery.refetch()}
      />
    </AppShell>
  );
}

/**
 * ReferenceDataMaintenance — manager-only governed cleanup for the reference layer.
 *
 * Archive-all, clear-pending and clear-audit remain available to managers with
 * their existing confirmation dialogs. Reset-to-seed is deliberately unavailable:
 * reference catalogues are global across Live and Test, so a client-side Test-mode
 * selection cannot safely isolate a destructive reset.
 *
 * Every action goes through an AlertDialog confirm and reports what it changed.
 */
function ReferenceDataMaintenance() {
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
  const busy = archiveAll.isPending || clearPending.isPending || clearAudit.isPending;

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
          Governed cleanup for the reference layer. Archive and queue/audit cleanup remain available; catalogue reset
          is disabled until it can be isolated safely from shared approved data.
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

          <div
            role="status"
            className="rounded-md border border-border bg-muted/30 p-3"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <RotateCcw className="w-4 h-4 text-muted-foreground" />
              Reset catalogues to seed
              <Badge variant="outline" className="text-[10px] font-normal">
                Unavailable
              </Badge>
            </div>
            <p className="mt-1 text-xs font-medium text-muted-foreground">
              Disabled until safe sandbox reset is implemented.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Reference catalogues are currently shared across Live and Test. Reset is disabled to protect approved
              reference data; a safe reset-all workflow will be added only after catalogue data can be isolated.
            </p>
          </div>
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

/** One approved-universe row: facts + provenance + governed lifecycle + catalogue link. */
function ApprovedInstrumentRow({
  r,
  isManager,
}: {
  r: ApprovedRow;
  isManager: boolean;
}) {
  const cat = r.catalogue as ReferenceCatalogue;
  const stale = rateStaleness(r.dataAsOf ? new Date(r.dataAsOf) : null);
  return (
    <TableRow className={`align-top ${r.archived ? "bg-muted/30" : ""}`}>
      <TableCell>
        <Link href={catalogueHref(r)} className="font-medium text-foreground hover:text-primary hover:underline">
          {r.name}
        </Link>
        {r.issuer && <div className="text-xs text-muted-foreground mt-0.5">{r.issuer}</div>}
        <div className="mt-1 flex items-center gap-1 flex-wrap">
          {r.archived && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 uppercase tracking-wide">
              <Archive className="w-2.5 h-2.5" /> Archived
            </Badge>
          )}
          {!r.archived && r.verificationState === "human_verified" && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-2.5 h-2.5" /> Verified
            </Badge>
          )}
        </div>
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
      <TableCell>
        <div className="text-xs text-muted-foreground max-w-[220px]">{r.source ?? "Source not recorded"}</div>
        <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="w-2.5 h-2.5" /> {fmtAsOf(r.dataAsOf)} · {stale.label}
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
                aria-label="Open record"
              >
                <ExternalLink className="w-4 h-4" />
              </Link>
            </TooltipTrigger>
            <TooltipContent side="left" className="text-xs">Open record</TooltipContent>
          </Tooltip>
          {isManager && (
            <CatalogueRowControls
              catalogue={cat as CatalogueKind}
              targetRef={r.targetRef}
              instrumentName={r.name}
              isActive={!r.archived}
              isStale={r.stale}
            />
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

