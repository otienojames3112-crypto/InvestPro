import { useMemo, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { AppShell } from "@/components/AppShell";
import { useRefFocus } from "@/hooks/useRefFocus";
import type { RefFocus } from "@/hooks/useRefFocus";
import { trpc } from "@/lib/trpc";
import { HOW_TO_READ_CATALOGUE_LABEL, MARKET_ASSETS_CATALOGUE_FIELD_GUIDE, catalogueReadGuide } from "@/lib/catalogueReadGuides";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InfoHint } from "@/components/InfoHint";
import {
  Search,
  Info,
  Clock,
  ChevronRight,
  LineChart,
  PlusCircle,
  Globe,
  ShieldCheck,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { CatalogueRowControls } from "@/components/CatalogueRowControls";
import { AiExplainDialog } from "@/components/AiExplainDialog";
import { Sparkles } from "lucide-react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { ArchivedRowsPanel, CatalogueScopeFilter, type CatalogueRowScope } from "@/components/ArchivedRowsPanel";
import { humanCheckedCount, figureCount, type FieldProvenanceMap } from "@shared/provenance";
import { rateStaleness } from "@/lib/rateStaleness";
import { resolveCatalogueSource, firstFieldProvenanceSourceUrl } from "@/lib/format";
import { readContractFieldValue } from "@/lib/format";
import { invalidatePortfolioMoney } from "@/lib/invalidatePortfolioMoney";
import { getCatalogueFieldContract, type CatalogueFieldContract } from "@shared/catalogueFieldContracts";
import { detectMarketAssetSacco } from "@shared/researchPipeline";
import { dashboardHref } from "@shared/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { toast } from "sonner";

/**
 * Market Assets Reference — the listed/market instrument catalogue.
 *
 * A read-only reference over the price-driven / market classes (`equity`,
 * `reit`, `offshore_fund`, `alt`) of the shared opportunity catalog. Mirrors the
 * neutral, source-cited Explore table (no ranking, no advice) and adds ONE
 * forward action that creates a real holding: "Track holding", which deep-links
 * to Holdings → Other with the instrument pre-seeded into the Add-asset form.
 * Assets you actually hold live under Holdings → Other; nothing is written until
 * the user confirms every figure there.
 *
 * Stage 10b-3 — previously Equity/REIT/Offshore fund were all forced into ONE
 * generic price/yield/trailing-return/fee table (SACCO already got its own
 * table in Stage 9c, since those columns are meaningless for a SACCO's
 * dividend-rate/share-capital model — the SAME reasoning now applies to the
 * other three: a REIT's NAV/occupancy and an offshore fund's currency/fees
 * are just as poorly served by one generic shape). Each subtype now gets its
 * own tab with its own explicit-column table, built from the SAME per-subtype
 * contract (shared/catalogueFieldContracts.ts) every other display layer
 * already uses.
 */

type Opportunity = inferRouterOutputs<AppRouter>["opportunities"]["list"][number];
type HoldingsDialogSubtype = "equity" | "reit";
type HoldingsDialogTarget = {
  row: Opportunity;
  subtype: HoldingsDialogSubtype;
  contract: CatalogueFieldContract | null;
};

// Map catalog asset class → the Other-holdings asset-class enum used by the
// Holdings → Other Add-asset form. Anything unmapped falls back to "other".
const CATALOG_TO_OTHER_CLASS: Record<string, string> = {
  equity: "equity",
  reit: "real_estate",
  offshore_fund: "etf",
  alt: "other",
};

function num(v: string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function fmtPct(v: string | null): string {
  const n = num(v);
  return n === null ? "—" : `${n.toFixed(2)}%`;
}
function fmtPrice(v: string | null, currency: string): string {
  const n = num(v);
  return n === null ? "—" : `${currency} ${n.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;
}
function fmtPlainNumber(v: string | null): string {
  const n = num(v);
  return n === null ? "—" : n.toLocaleString("en-KE", { maximumFractionDigits: 2 });
}
function toIsoDate(value: string | number | Date | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
function formatAsOf(value: string | number | Date | null | undefined): string {
  if (!value) return "Not recorded";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Not recorded";
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Stage 9c — SACCOs have no distinct `assetClass` (they share "alt" with ETF/
 * property/pension/other), so they need their own detection to split out of
 * the generic price/yield/fee table. Reuses `detectMarketAssetSacco` — the
 * SAME safe detection `checkApprovalGate`/`reviewResearchUpdate` already use —
 * against the row's `extendedFields` (which Slice 8g-2 stamps under the same
 * canonical keys `detectMarketAssetSacco`'s own alias table recognizes:
 * dividendRate, minimumShareCapital, minimumMonthlyDeposit, withdrawalTerms,
 * regulatoryStatus). This reliably detects SACCO rows promoted via 8g-2;
 * older "alt" rows without any of these extendedFields keys fall through to
 * neither table — the same pre-existing, already-documented "SACCO row
 * identity" gap the contract module's own header describes, not something
 * this display-only slice claims to fully solve.
 */
function isSaccoRow(r: Opportunity): boolean {
  if (r.assetClass !== "alt") return false;
  return detectMarketAssetSacco({
    catalogue: "market_asset",
    assetClass: "alt",
    figures: r.extendedFields as Record<string, unknown> | null,
    name: r.name,
    issuer: r.issuer,
  });
}

/** The Source & freshness cell every subtype table shares. */
function SourceCell({ r }: { r: Opportunity }) {
  const fp = (r.fieldProvenance ?? {}) as FieldProvenanceMap;
  const catSource = resolveCatalogueSource(r.dataSource, r.extendedFields, r.dataAsOf, firstFieldProvenanceSourceUrl(fp));
  const stale = rateStaleness(catSource.asOf);
  const total = figureCount(fp);
  const checked = humanCheckedCount(fp);
  return (
    <>
      {catSource.label ? (
        catSource.url ? (
          <a
            href={catSource.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-primary underline underline-offset-2 inline-flex items-center gap-1 max-w-[200px] truncate"
          >
            {catSource.label} <ExternalLink className="w-2.5 h-2.5 shrink-0" />
          </a>
        ) : (
          <div className="text-xs text-muted-foreground max-w-[200px] truncate">{catSource.label}</div>
        )
      ) : (
        <div className="text-xs text-amber-600 dark:text-amber-400">Source not recorded</div>
      )}
      <div className="flex items-center gap-1 mt-0.5">
        <Clock className="w-3 h-3 text-muted-foreground" />
        <span className={`text-[10px] font-medium ${stale.isVeryStale ? "text-red-500" : stale.isStale ? "text-amber-500" : "text-muted-foreground"}`}>
          {stale.label}{stale.isStale ? " · may be stale" : ""}
        </span>
      </div>
      {total > 0 && (
        <span className={`inline-flex items-center gap-1 mt-1 text-[10px] font-medium ${checked > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
          <ShieldCheck className="w-3 h-3" />
          {checked}/{total} checked
        </span>
      )}
    </>
  );
}

/** The trailing Actions cells (track holding + manager controls + explore link) every subtype table shares. */
function ActionsCells({
  r,
  onTrack,
  isManager,
  staleByRef,
  refFocus,
  actionLabel,
  actionTooltip,
}: {
  r: Opportunity;
  onTrack: () => void;
  isManager: boolean;
  staleByRef: Map<string, boolean>;
  refFocus: RefFocus;
  actionLabel: string;
  actionTooltip: string;
}) {
  const markedStale = staleByRef.get(r.ref);
  return (
    <>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={onTrack} className="h-8 gap-1.5 active:scale-[0.97] transition-transform">
              <PlusCircle className="w-3.5 h-3.5" /> {actionLabel}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-xs text-xs">
            {actionTooltip}
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          {isManager && (
            <CatalogueRowControls
              catalogue="market_asset"
              targetRef={r.ref}
              instrumentName={r.name}
              isActive={r.active ?? true}
              isStale={markedStale}
              showRateHistory={false}
            />
          )}
          <Link href={`/explore/${encodeURIComponent(r.ref)}`}>
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`View ${r.name}`}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </TableCell>
    </>
  );
}

function useTrackHolding() {
  const [, navigate] = useLocation();
  return (r: Opportunity, priceField?: string | null) => {
    const cls = CATALOG_TO_OTHER_CLASS[r.assetClass] ?? "other";
    const price = priceField != null ? num(priceField) : num(r.lastPrice);
    const params = new URLSearchParams({
      track: "1",
      name: r.name,
      class: cls,
      value: price != null ? String(price) : "",
      notes: `Tracked from Market Assets Reference (${r.ref})`,
    });
    navigate(`${dashboardHref.other}${dashboardHref.other.includes("?") ? "&" : "?"}${params.toString()}`);
  };
}

export default function MarketAssetsReference({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: rows = [], isLoading } = trpc.opportunities.list.useQuery();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const isManager = user?.role === "admin";
  const { data: metaData } = trpc.catalogue.rowMeta.useQuery(
    { catalogue: "market_asset" },
    { enabled: isManager },
  );
  const staleByRef = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const row of Object.values(metaData?.meta ?? {})) m.set(row.targetRef, !!row.stale);
    return m;
  }, [metaData]);

  const refFocus = useRefFocus();
  const [search, setSearch] = useState(() => refFocus.focusRef ?? "");
  // Round 90 — manager-only Active/Archived/All view. Non-managers stay on "active".
  const [scope, setScope] = useState<CatalogueRowScope>("active");
  const [activeTab, setActiveTab] = useState<"equity" | "reit" | "offshore_fund" | "sacco">("equity");

  const marketRows = useMemo(
    () => rows.filter((r) => (["equity", "reit", "offshore_fund", "alt"] as readonly string[]).includes(r.assetClass)),
    [rows],
  );

  // Round 86: a ?ref= that matches no market asset is a stale cross-catalogue link;
  // clear it (and its prefill) once rows load so this catalogue isn't filtered to nothing.
  useEffect(() => {
    if (isLoading || !refFocus.focusRef) return;
    refFocus.clearIfMissing(
      marketRows.flatMap((r) => [r.ref, r.name]),
      () => setSearch((s) => (s === refFocus.focusRef ? "" : s)),
    );
  }, [isLoading, marketRows, refFocus]);

  // Stage 10b-3 — split by SUBTYPE (tabs), not one generic table. Search
  // applies across whichever tab is active.
  const bySubtype = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matches = (r: Opportunity) => !q || `${r.name} ${r.issuer ?? ""} ${r.ref}`.toLowerCase().includes(q);
    return {
      equity: marketRows.filter((r) => r.assetClass === "equity" && matches(r)),
      reit: marketRows.filter((r) => r.assetClass === "reit" && matches(r)),
      offshore_fund: marketRows.filter((r) => r.assetClass === "offshore_fund" && matches(r)),
      sacco: marketRows.filter((r) => isSaccoRow(r) && matches(r)),
    };
  }, [marketRows, search]);

  // Unfiltered per-subtype counts (ignores search) — lets the empty state tell
  // "the catalogue has no approved rows of this subtype" apart from "your
  // search matched nothing", which are different situations for the user.
  const subtypeTotals = useMemo(
    () => ({
      equity: marketRows.filter((r) => r.assetClass === "equity").length,
      reit: marketRows.filter((r) => r.assetClass === "reit").length,
      offshore_fund: marketRows.filter((r) => r.assetClass === "offshore_fund").length,
      sacco: marketRows.filter((r) => isSaccoRow(r)).length,
    }),
    [marketRows],
  );

  const resetFilters = () => setSearch("");

  const { portfolioId } = usePortfolio();
  const [holdingDialog, setHoldingDialog] = useState<HoldingsDialogTarget | null>(null);
  const [catExplainOpen, setCatExplainOpen] = useState(false);
  const catFacts = useMemo(() => {
    const l: string[] = [`Catalogue: Market Assets Reference. ${marketRows.length} assets shown.`];
    l.push("Purpose: approved reference data for market assets by subtype.");
    l.push(`Equity: ${bySubtype.equity.length}. REIT: ${bySubtype.reit.length}. Offshore funds: ${bySubtype.offshore_fund.length}. SACCO: ${bySubtype.sacco.length}.`);
    return catalogueReadGuide("Market Assets Reference", MARKET_ASSETS_CATALOGUE_FIELD_GUIDE, l.join("\n"));
  }, [marketRows, bySubtype]);
  const catExplainQuery = trpc.aiExplain.referenceCatalogue.useQuery(
    { portfolioId: portfolioId!, catalogueSummary: catFacts },
    { enabled: catExplainOpen && !!portfolioId, refetchOnWindowFocus: false, retry: false },
  );
  const openHoldingsDialog = (subtype: HoldingsDialogSubtype, row: Opportunity, contract: CatalogueFieldContract | null) => {
    setHoldingDialog({ subtype, row, contract });
  };

  return (
    <AppShell embedded={embedded}>
      <div className="p-6 lg:p-8 space-y-6 max-w-[1900px]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" style={{ fontFamily: "'Playfair Display', serif" }}>
              <LineChart className="w-6 h-6 text-primary" /> Market Assets Reference
            </h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Listed equities, REITs, offshore funds and SACCOs, each with the established fields for
              that instrument type. Approved reference data only; assets you actually hold are recorded
              separately under{" "}
              <Link href={dashboardHref.other} className="text-primary underline underline-offset-2">
                Holdings → Other
              </Link>. To propose new or updated catalogue facts, use Research Desk → Ask AI. This is not advice or a recommendation.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isManager && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Badge
                      variant="outline"
                      className="h-7 gap-1.5 rounded-full border-border bg-muted/40 px-2.5 text-xs font-medium text-muted-foreground"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Maintain records unavailable
                    </Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  Manual market-asset maintenance needs governed review so Equity, REIT, Offshore fund, and SACCO field
                  contracts are preserved. Use Research Desk → Ask AI to propose updates for now.
                </TooltipContent>
              </Tooltip>
            )}
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
        </div>

        {/* Search + scope */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="w-4 h-4" /> Search market assets
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="max-w-md space-y-1">
              <Label className="text-xs">Search (applies within the selected tab)</Label>
              <Input
                placeholder="Name, issuer or ticker"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9"
              />
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground">
                {marketRows.length} market assets total.
              </p>
              <div className="flex items-center gap-2">
                <CatalogueScopeFilter value={scope} onChange={setScope} />
                <Button variant="outline" size="sm" onClick={resetFilters} className="h-8 text-xs">
                  Reset search
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Archived rows (manager-only, when viewing Archived or All) */}
        {isManager && scope !== "active" && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-medium">Archived market assets</div>
              <ArchivedRowsPanel catalogue="market_asset" />
            </CardContent>
          </Card>
        )}

        {/* Stage 10b-3 — subtype tabs, each with its own explicit-column table. */}
        {scope !== "archived" && (
          isLoading ? (
            <Card>
              <CardContent className="p-0">
                <div className="p-8 text-center text-sm text-muted-foreground">Loading market assets…</div>
              </CardContent>
            </Card>
          ) : (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)} className="w-full">
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="equity">Equity ({bySubtype.equity.length})</TabsTrigger>
                <TabsTrigger value="reit">REIT ({bySubtype.reit.length})</TabsTrigger>
                <TabsTrigger value="offshore_fund">Offshore funds ({bySubtype.offshore_fund.length})</TabsTrigger>
                <TabsTrigger value="sacco">SACCO ({bySubtype.sacco.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="equity" className="mt-4">
                <SubtypeTable subtype="equity" rows={bySubtype.equity} hasApprovedRows={subtypeTotals.equity > 0} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} onOpenHoldingsDialog={openHoldingsDialog} />
              </TabsContent>
              <TabsContent value="reit" className="mt-4">
                <SubtypeTable subtype="reit" rows={bySubtype.reit} hasApprovedRows={subtypeTotals.reit > 0} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} onOpenHoldingsDialog={openHoldingsDialog} />
              </TabsContent>
              <TabsContent value="offshore_fund" className="mt-4">
                <SubtypeTable subtype="offshore_fund" rows={bySubtype.offshore_fund} hasApprovedRows={subtypeTotals.offshore_fund > 0} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} onOpenHoldingsDialog={openHoldingsDialog} />
              </TabsContent>
              <TabsContent value="sacco" className="mt-4">
                <SubtypeTable subtype="sacco" rows={bySubtype.sacco} hasApprovedRows={subtypeTotals.sacco > 0} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} onOpenHoldingsDialog={openHoldingsDialog} />
              </TabsContent>
            </Tabs>
          )
        )}

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          Equity and REIT rows now use a confirm-first Add to holdings dialog. Offshore fund and
          SACCO rows keep the existing Track holding deep-link for now.
        </p>
      </div>
      <MarketAssetHoldingDialog
        target={holdingDialog}
        portfolioId={portfolioId}
        onOpenChange={(open) => {
          if (!open) setHoldingDialog(null);
        }}
        onCreated={async () => {
          if (!portfolioId) return;
          await invalidatePortfolioMoney(utils, portfolioId);
        }}
      />
      <AiExplainDialog
        open={catExplainOpen}
        onOpenChange={setCatExplainOpen}
        title="How to read Market Assets Reference"
        description="Educational guide to market-asset subtype fields, source as-of dates, freshness, and the boundary between reference data and Holdings."
        answer={catExplainQuery.data?.answer}
        isLoading={catExplainQuery.isLoading || catExplainQuery.isFetching}
        isError={catExplainQuery.isError}
        errorMessage={catExplainQuery.error?.message}
        onRetry={() => catExplainQuery.refetch()}
      />
    </AppShell>
  );
}

function ReferenceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground break-words">{value}</p>
    </div>
  );
}

function MarketAssetHoldingDialog({
  target,
  portfolioId,
  onOpenChange,
  onCreated,
}: {
  target: HoldingsDialogTarget | null;
  portfolioId: number | null | undefined;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const [units, setUnits] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!target) return;
    setUnits("");
    setPurchasePrice("");
    setPurchaseDate(toIsoDate(new Date()) ?? "");
    setNotes("");
  }, [target]);

  const commit = trpc.modeling.commit.useMutation({
    onSuccess: async () => {
      await onCreated();
      toast.success(`${target?.subtype === "reit" ? "REIT" : "Equity"} holding added.`);
      onOpenChange(false);
    },
    onError: (e) => toast.error("Could not add holding", { description: e.message }),
  });

  const open = target !== null;
  const subtypeLabel = target?.subtype === "reit" ? "REIT" : "equity";
  const row = target?.row ?? null;
  const extendedFields = row?.extendedFields as Record<string, unknown> | null;
  const readField = (key: string) => {
    const field = target?.contract?.fields.find((f) => f.key === key);
    return field ? readContractFieldValue(extendedFields, field) : null;
  };
  const sourceMeta = row
    ? resolveCatalogueSource(
        row.dataSource,
        row.extendedFields,
        row.dataAsOf,
        firstFieldProvenanceSourceUrl((row.fieldProvenance ?? {}) as FieldProvenanceMap),
      )
    : null;
  const snapshotSource = row?.dataSource ?? sourceMeta?.url ?? sourceMeta?.label ?? null;
  const snapshotAsOf = toIsoDate(row?.dataAsOf) ?? toIsoDate(sourceMeta?.asOf);
  const canConfirm = !!portfolioId && !!row && !!snapshotSource && !!snapshotAsOf;

  const handleConfirm = () => {
    if (!row || !portfolioId) return;
    const unitsNum = Number(units);
    const priceNum = Number(purchasePrice);
    if (!Number.isFinite(unitsNum) || unitsNum <= 0) {
      toast.error(`Enter a valid number of ${target?.subtype === "reit" ? "units" : "shares"}.`);
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      toast.error(`Enter a valid purchase price per ${target?.subtype === "reit" ? "unit" : "share"}.`);
      return;
    }
    if (!purchaseDate) {
      toast.error("Enter the purchase date.");
      return;
    }
    if (!snapshotSource || !snapshotAsOf) {
      toast.error("This reference row is missing source provenance, so it cannot be added through this governed flow yet.");
      return;
    }
    commit.mutate({
      portfolioId,
      assetClass: row.assetClass as "equity" | "reit",
      name: row.name,
      units: unitsNum,
      unitPrice: priceNum,
      currency: (row.currency ?? "KES").toUpperCase(),
      entryDate: purchaseDate,
      catalogRef: row.ref,
      dataSource: snapshotSource,
      dataAsOf: snapshotAsOf,
      opportunityId: row.id,
      holdingSourceContext: "Market Assets Reference",
      userNotes: notes.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{target?.subtype === "reit" ? "Add REIT to holdings" : "Add equity to holdings"}</DialogTitle>
          <DialogDescription>
            Approved reference facts are shown separately from your own holding details. Nothing is
            saved until you confirm.
          </DialogDescription>
        </DialogHeader>

        {row && (
          <div className="space-y-4 py-1">
            <div className="rounded-lg border border-white/10 bg-muted/20 p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  Approved reference facts
                </Badge>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {row.ref}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Holdings are recorded separately. Later catalogue changes will not automatically
                rewrite this holding.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 rounded-lg border border-white/10 bg-white/5 p-4">
              {target?.subtype === "equity" ? (
                <>
                  <ReferenceFact label="Company" value={row.name} />
                  <ReferenceFact label="Ticker" value={readField("ticker") ?? "—"} />
                  <ReferenceFact label="Exchange" value={row.market ?? readField("market") ?? "—"} />
                  <ReferenceFact label="Latest / reference price" value={fmtPrice(row.lastPrice, row.currency)} />
                  <ReferenceFact label="Dividend yield" value={fmtPct(row.yieldPct)} />
                  <ReferenceFact label="Recent dividend" value={readField("recentDividend") ?? "—"} />
                  <ReferenceFact label="Sector" value={readField("marketSector") ?? "—"} />
                  <ReferenceFact label="Source as-of date" value={formatAsOf(sourceMeta?.asOf)} />
                </>
              ) : (
                <>
                  <ReferenceFact label="REIT" value={row.name} />
                  <ReferenceFact label="REIT type" value={readField("reitType") ?? "—"} />
                  <ReferenceFact label="Unit price" value={fmtPrice(row.lastPrice, row.currency)} />
                  <ReferenceFact label="Distribution yield" value={fmtPct(row.yieldPct)} />
                  <ReferenceFact label="Recent distribution" value={readField("recentDistribution") ?? "—"} />
                  <ReferenceFact label="NAV" value={readField("nav") ? fmtPlainNumber(readField("nav")) : "—"} />
                  <ReferenceFact label="Occupancy" value={readField("occupancyRate") ?? "—"} />
                  <ReferenceFact label="Source as-of date" value={formatAsOf(sourceMeta?.asOf)} />
                </>
              )}
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Source and provenance</p>
                <p className="text-xs text-muted-foreground">
                  This holding will preserve the reference row identity, source, and as-of date in its
                  snapshot terms at purchase.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <ReferenceFact label="Source" value={sourceMeta?.label ?? snapshotSource ?? "Not recorded"} />
                <ReferenceFact label="As-of" value={formatAsOf(sourceMeta?.asOf ?? row.dataAsOf)} />
              </div>
              {sourceMeta?.url && (
                <a
                  href={sourceMeta.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-primary underline underline-offset-2"
                >
                  Open source <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {!canConfirm && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  This row is missing a usable source or source as-of date, so it cannot be added through
                  this governed flow yet.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 p-4 space-y-3">
              <div className="space-y-1">
                <p className="text-sm font-medium">Your holding details</p>
                <p className="text-xs text-muted-foreground">
                  Enter the figures you actually own. This is not investment advice.
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{target?.subtype === "reit" ? "Units held" : "Shares held"}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.0001"
                    value={units}
                    onChange={(e) => setUnits(e.target.value)}
                    placeholder={target?.subtype === "reit" ? "e.g. 100.0" : "e.g. 250"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{target?.subtype === "reit" ? "Purchase price per unit" : "Purchase price per share"} ({(row.currency ?? "KES").toUpperCase()})</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.0001"
                    value={purchasePrice}
                    onChange={(e) => setPurchasePrice(e.target.value)}
                    placeholder={target?.subtype === "reit" ? "Enter your actual unit price" : "Enter your actual share price"}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Purchase date</Label>
                  <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes (optional)</Label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Broker, fees, account nickname, or other ownership notes"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Current value is not seeded from yield, return, dividend, distribution, or NAV figures in
                the reference catalogue.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={commit.isPending}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm || commit.isPending}>
            {commit.isPending ? "Adding…" : "Add to holdings"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Subtype = "equity" | "reit" | "offshore_fund" | "sacco";

// Shown when a search query filters an otherwise non-empty tab down to zero rows.
const EMPTY_SEARCH_LABEL: Record<Subtype, string> = {
  equity: "No equities match your search.",
  reit: "No REITs match your search.",
  offshore_fund: "No offshore funds match your search.",
  sacco: "No SACCOs match your search.",
};

// Shown when the catalogue itself has no approved rows of this subtype yet
// (search is irrelevant). Add to holdings is row-level and tied to an approved
// Equity/REIT reference row, so it explains why the action isn't visible
// instead of leaving the tab looking silently broken.
const EMPTY_CATALOGUE_LABEL: Record<Subtype, string> = {
  equity:
    "No approved Equity records yet. Add to holdings appears after an approved Equity reference row exists. To propose new Equity facts, use Research Desk → Ask AI.",
  reit:
    "No approved REIT records yet. Add to holdings appears after an approved REIT reference row exists. To propose new REIT facts, use Research Desk → Ask AI.",
  offshore_fund: "No approved Offshore fund records yet.",
  sacco: "No approved SACCO records yet.",
};

/**
 * Stage 10b-3 — one table component covering all four subtypes, since the
 * per-column logic is genuinely different per subtype (different contract,
 * different fields) but the surrounding Card/Table/empty-state/row-click
 * plumbing is identical. Column headers/values come from the SAME per-
 * subtype contract every other display layer (Ask AI, review queue,
 * approval modal, the multi-field edit dialog) already uses — never a
 * second, hand-typed field list.
 */
function SubtypeTable({
  subtype,
  rows,
  hasApprovedRows,
  isManager,
  staleByRef,
  refFocus,
  onOpenHoldingsDialog,
}: {
  subtype: Subtype;
  rows: Opportunity[];
  hasApprovedRows: boolean;
  isManager: boolean;
  staleByRef: Map<string, boolean>;
  refFocus: RefFocus;
  onOpenHoldingsDialog: (subtype: HoldingsDialogSubtype, row: Opportunity, contract: CatalogueFieldContract | null) => void;
}) {
  const contract = getCatalogueFieldContract("market_asset", subtype);
  const trackHolding = useTrackHolding();

  if (rows.length === 0) {
    const message = hasApprovedRows ? EMPTY_SEARCH_LABEL[subtype] : EMPTY_CATALOGUE_LABEL[subtype];
    return (
      <Card>
        <CardContent className="p-0">
          <div className="p-8 text-center text-sm text-muted-foreground">{message}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>{headersFor(subtype, contract)}</TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <SubtypeRow
                  key={r.ref}
                  subtype={subtype}
                  r={r}
                  contract={contract}
                  onTrack={() => {
                    if (subtype === "equity" || subtype === "reit") {
                      onOpenHoldingsDialog(subtype, r, contract);
                      return;
                    }
                    trackHolding(r, priceFieldFor(subtype, r, contract));
                  }}
                  isManager={isManager}
                  staleByRef={staleByRef}
                  refFocus={refFocus}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

function priceFieldFor(subtype: Subtype, r: Opportunity, contract: CatalogueFieldContract | null): string | null {
  if (subtype === "equity" || subtype === "reit") return r.lastPrice;
  if (subtype === "offshore_fund") return r.trailingReturnPct;
  const field = contract?.fields.find((f) => f.key === "dividendRate");
  return field ? readContractFieldValue(r.extendedFields as Record<string, unknown> | null, field) : null;
}

function headersFor(subtype: Subtype, contract: CatalogueFieldContract | null) {
  const label = (key: string, fallback: string) => contract?.fields.find((f) => f.key === key)?.label ?? fallback;
  switch (subtype) {
    case "equity":
      return (
        <>
          <TableHead>{label("companyName", "Company")}</TableHead>
          <TableHead>{label("ticker", "Ticker")}</TableHead>
          <TableHead>{label("market", "Exchange")}</TableHead>
          <TableHead className="text-right">{label("lastPrice", "Current price")}</TableHead>
          <TableHead className="text-right">{label("yieldPct", "Dividend yield")}</TableHead>
          <TableHead>{label("recentDividend", "Recent dividend")}</TableHead>
          <TableHead>{label("priceChange", "Price change")}</TableHead>
          <TableHead>{label("marketSector", "Sector")}</TableHead>
          <TableHead>{label("minBuyAmount", "Minimum buy / board lot")}</TableHead>
          <TableHead>{label("liquidity", "Liquidity / trading")}</TableHead>
          <TableHead>{label("riskLevel", "Risk level")}</TableHead>
          <TableHead>
            <span className="inline-flex items-center gap-1">
              Source &amp; freshness
              <InfoHint>Where each figure came from and how recently it was updated.</InfoHint>
            </span>
          </TableHead>
          <TableHead className="text-right">Action</TableHead>
          <TableHead className="w-10"></TableHead>
        </>
      );
    case "reit":
      return (
        <>
          <TableHead>{label("reitName", "REIT")}</TableHead>
          <TableHead>{label("reitType", "REIT type")}</TableHead>
          <TableHead className="text-right">{label("lastPrice", "Unit price")}</TableHead>
          <TableHead className="text-right">{label("distributionYield", "Distribution yield")}</TableHead>
          <TableHead>{label("recentDistribution", "Recent distribution")}</TableHead>
          <TableHead className="text-right">{label("nav", "NAV")}</TableHead>
          <TableHead>{label("occupancyRate", "Occupancy")}</TableHead>
          <TableHead>{label("minInvestment", "Minimum investment")}</TableHead>
          <TableHead>{label("liquidity", "Liquidity / tradability")}</TableHead>
          <TableHead>{label("riskLevel", "Risk")}</TableHead>
          <TableHead>
            <span className="inline-flex items-center gap-1">
              Source &amp; freshness
              <InfoHint>Where each figure came from and how recently it was updated.</InfoHint>
            </span>
          </TableHead>
          <TableHead className="text-right">Action</TableHead>
          <TableHead className="w-10"></TableHead>
        </>
      );
    case "offshore_fund":
      return (
        <>
          <TableHead>{label("fundName", "Fund")}</TableHead>
          <TableHead>{label("fundManager", "Manager / provider")}</TableHead>
          <TableHead>{label("currency", "Currency")}</TableHead>
          <TableHead>{label("fundType", "Fund type")}</TableHead>
          <TableHead className="text-right">{label("trailingReturnPct", "Annualized / trailing return")}</TableHead>
          <TableHead>{label("minInvestment", "Minimum investment")}</TableHead>
          <TableHead className="text-right">{label("expenseRatioPct", "Fees / expense ratio")}</TableHead>
          <TableHead>{label("withdrawalPeriod", "Withdrawal period")}</TableHead>
          <TableHead>{label("fxRiskNote", "FX risk note")}</TableHead>
          <TableHead>{label("riskLevel", "Risk")}</TableHead>
          <TableHead>
            <span className="inline-flex items-center gap-1">
              Source &amp; freshness
              <InfoHint>Where each figure came from and how recently it was updated.</InfoHint>
            </span>
          </TableHead>
          <TableHead className="text-right">Action</TableHead>
          <TableHead className="w-10"></TableHead>
        </>
      );
    case "sacco":
      return (
        <>
          <TableHead>{label("saccoName", "SACCO")}</TableHead>
          <TableHead>{label("productType", "Product type")}</TableHead>
          <TableHead className="text-right">{label("dividendRate", "Dividend / interest rate")}</TableHead>
          <TableHead className="text-right">{label("minimumShareCapital", "Minimum share capital")}</TableHead>
          <TableHead className="text-right">{label("minimumMonthlyDeposit", "Minimum monthly contribution")}</TableHead>
          <TableHead>{label("membershipRequirement", "Membership requirement")}</TableHead>
          <TableHead>{label("withdrawalTerms", "Withdrawal terms")}</TableHead>
          <TableHead>{label("fees", "Fees / charges")}</TableHead>
          <TableHead>{label("liquidity", "Liquidity")}</TableHead>
          <TableHead>{label("regulatoryStatus", "Risk / protection status")}</TableHead>
          <TableHead>
            <span className="inline-flex items-center gap-1">
              Source &amp; freshness
              <InfoHint>Where each figure came from and how recently it was updated.</InfoHint>
            </span>
          </TableHead>
          <TableHead className="text-right">Action</TableHead>
          <TableHead className="w-10"></TableHead>
        </>
      );
  }
}

function SubtypeRow({
  subtype,
  r,
  contract,
  onTrack,
  isManager,
  staleByRef,
  refFocus,
}: {
  subtype: Subtype;
  r: Opportunity;
  contract: CatalogueFieldContract | null;
  onTrack: () => void;
  isManager: boolean;
  staleByRef: Map<string, boolean>;
  refFocus: RefFocus;
}) {
  const markedStale = staleByRef.get(r.ref);
  const extendedFields = r.extendedFields as Record<string, unknown> | null;
  const readField = (key: string) => {
    const field = contract?.fields.find((f) => f.key === key);
    return field ? readContractFieldValue(extendedFields, field) : null;
  };

  const nameCell = (
    <TableCell>
      <Link href={`/explore/${encodeURIComponent(r.ref)}`} className="font-medium text-foreground hover:text-primary hover:underline">
        {r.name}
      </Link>
      <div className="text-xs text-muted-foreground mt-0.5">{r.issuer ?? r.market ?? r.ref}</div>
      {markedStale && (
        <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 border-amber-300 text-amber-600">Stale</Badge>
      )}
    </TableCell>
  );

  const rowClass = `align-top ${refFocus.isFocused(r.ref, r.name) ? "bg-primary/5" : ""}`;

  if (subtype === "equity") {
    const ticker = readField("ticker");
    const recentDividend = readField("recentDividend");
    const priceChange = readField("priceChange");
    const marketSector = readField("marketSector");
    const minBuyAmount = readField("minBuyAmount");
    const riskLevel = readField("riskLevel");
    const liquidity = readField("liquidity") ?? r.liquidity;
    return (
      <TableRow ref={refFocus.registerRow(r.ref, r.name)} data-ref={r.ref} className={rowClass}>
        <TableCell>
          <Link href={`/explore/${encodeURIComponent(r.ref)}`} className="font-medium text-foreground hover:text-primary hover:underline">
            {r.name}
          </Link>
          {ticker && <Badge variant="outline" className="ml-1.5 text-[10px] px-1.5 py-0 font-mono align-middle">{ticker}</Badge>}
          <div className="text-xs text-muted-foreground mt-0.5">{r.issuer ?? r.market ?? r.ref}</div>
          {markedStale && (
            <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 border-amber-300 text-amber-600">Stale</Badge>
          )}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{r.market ?? "—"}</TableCell>
        <TableCell className="text-right tabular-nums text-sm">{fmtPrice(r.lastPrice, r.currency)}</TableCell>
        <TableCell className="text-right tabular-nums text-sm">{fmtPct(r.yieldPct)}</TableCell>
        <TableCell className="text-sm max-w-[160px] truncate">{recentDividend ?? "—"}</TableCell>
        <TableCell className="text-sm max-w-[140px] truncate">{priceChange ?? "—"}</TableCell>
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{marketSector ?? "—"}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{minBuyAmount ?? "—"}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{liquidity ? liquidity.replace(/_/g, " ") : "—"}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{riskLevel ?? "—"}</TableCell>
        <TableCell><SourceCell r={r} /></TableCell>
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={onTrack} className="h-8 gap-1.5 active:scale-[0.97] transition-transform">
                <PlusCircle className="w-3.5 h-3.5" /> Add to holdings
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs text-xs">
              Opens a confirm-first holdings form with approved reference facts shown separately from your
              own share count, purchase price, date, and notes. Nothing is saved until you confirm.
            </TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            {isManager && (
              <CatalogueRowControls
                catalogue="market_asset"
                targetRef={r.ref}
                instrumentName={r.name}
                isActive={r.active ?? true}
                isStale={markedStale}
                showRateHistory={false}
              />
            )}
            <Link href={`/explore/${encodeURIComponent(r.ref)}`}>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`View ${r.name}`}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (subtype === "reit") {
    const reitType = readField("reitType");
    const recentDistribution = readField("recentDistribution");
    const nav = readField("nav");
    const occupancyRate = readField("occupancyRate");
    const minInvestment = readField("minInvestment");
    const riskLevel = readField("riskLevel");
    const liquidity = readField("liquidity") ?? r.liquidity;
    return (
      <TableRow ref={refFocus.registerRow(r.ref, r.name)} data-ref={r.ref} className={rowClass}>
        {nameCell}
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{reitType ?? "—"}</TableCell>
        <TableCell className="text-right tabular-nums text-sm">{fmtPrice(r.lastPrice, r.currency)}</TableCell>
        <TableCell className="text-right tabular-nums text-sm">{fmtPct(r.yieldPct)}</TableCell>
        <TableCell className="text-sm max-w-[160px] truncate">{recentDistribution ?? "—"}</TableCell>
        <TableCell className="text-right tabular-nums text-sm">{nav ?? "—"}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{occupancyRate ?? "—"}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{minInvestment ?? "—"}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{liquidity ? liquidity.replace(/_/g, " ") : "—"}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{riskLevel ?? "—"}</TableCell>
        <TableCell><SourceCell r={r} /></TableCell>
        <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={onTrack} className="h-8 gap-1.5 active:scale-[0.97] transition-transform">
                <PlusCircle className="w-3.5 h-3.5" /> Add to holdings
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs text-xs">
              Opens a confirm-first holdings form with approved reference facts shown separately from your
              own unit count, purchase price, date, and notes. Nothing is saved until you confirm.
            </TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-1">
            {isManager && (
              <CatalogueRowControls
                catalogue="market_asset"
                targetRef={r.ref}
                instrumentName={r.name}
                isActive={r.active ?? true}
                isStale={markedStale}
                showRateHistory={false}
              />
            )}
            <Link href={`/explore/${encodeURIComponent(r.ref)}`}>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`View ${r.name}`}>
                <ChevronRight className="w-4 h-4" />
              </Button>
            </Link>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (subtype === "offshore_fund") {
    const fundType = readField("fundType");
    const minInvestment = readField("minInvestment");
    const withdrawalPeriod = readField("withdrawalPeriod");
    const fxRiskNote = readField("fxRiskNote");
    const riskLevel = readField("riskLevel");
    return (
      <TableRow ref={refFocus.registerRow(r.ref, r.name)} data-ref={r.ref} className={rowClass}>
        <TableCell>
          <Link href={`/explore/${encodeURIComponent(r.ref)}`} className="font-medium text-foreground hover:text-primary hover:underline">
            {r.name}
          </Link>
          <div className="text-xs text-muted-foreground mt-0.5">{r.issuer ?? r.market ?? r.ref}</div>
          {markedStale && (
            <Badge variant="outline" className="mt-1 mr-1 text-[10px] px-1.5 py-0 border-amber-300 text-amber-600">Stale</Badge>
          )}
          {r.currency !== "KES" && (
            fxRiskNote ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400 cursor-help">
                    <Globe className="w-2.5 h-2.5" /> FX risk
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs text-xs">{fxRiskNote}</TooltipContent>
              </Tooltip>
            ) : (
              <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400">
                <Globe className="w-2.5 h-2.5" /> FX risk
              </Badge>
            )
          )}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{r.issuer ?? "—"}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{r.currency}</TableCell>
        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{fundType ?? "—"}</TableCell>
        <TableCell className="text-right tabular-nums text-sm">{fmtPct(r.trailingReturnPct)}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{minInvestment ?? "—"}</TableCell>
        <TableCell className="text-right tabular-nums text-sm">{fmtPct(r.expenseRatioPct)}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{withdrawalPeriod ?? "—"}</TableCell>
        <TableCell className="text-sm max-w-[180px] truncate">{fxRiskNote ?? "—"}</TableCell>
        <TableCell className="text-sm whitespace-nowrap">{riskLevel ?? "—"}</TableCell>
        <TableCell><SourceCell r={r} /></TableCell>
        <ActionsCells r={r} onTrack={onTrack} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} actionLabel="Track holding" actionTooltip="Opens the Holdings → Other add form seeded to this instrument. You confirm the amount and figures before anything is saved — nothing is bought or moved automatically." />
      </TableRow>
    );
  }

  // sacco
  const productType = readField("productType");
  const dividendRate = readField("dividendRate");
  const minimumShareCapital = readField("minimumShareCapital");
  const minimumMonthlyDeposit = readField("minimumMonthlyDeposit");
  const membershipRequirement = readField("membershipRequirement");
  const withdrawalTerms = readField("withdrawalTerms");
  const fees = readField("fees");
  const regulatoryStatus = readField("regulatoryStatus");
  const liquidity = readField("liquidity") ?? r.liquidity;
  return (
    <TableRow ref={refFocus.registerRow(r.ref, r.name)} data-ref={r.ref} className={rowClass}>
      {nameCell}
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{productType ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums text-sm">{dividendRate ? `${dividendRate}%` : "—"}</TableCell>
      <TableCell className="text-right tabular-nums text-sm">{minimumShareCapital ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums text-sm">{minimumMonthlyDeposit ?? "—"}</TableCell>
      <TableCell className="text-sm max-w-[160px] truncate">{membershipRequirement ?? "—"}</TableCell>
      <TableCell className="text-sm max-w-[160px] truncate">{withdrawalTerms ?? "—"}</TableCell>
      <TableCell className="text-sm max-w-[140px] truncate">{fees ?? "—"}</TableCell>
      <TableCell className="text-sm whitespace-nowrap">{liquidity ? liquidity.replace(/_/g, " ") : "—"}</TableCell>
      <TableCell className="text-sm max-w-[160px] truncate">{regulatoryStatus ?? "—"}</TableCell>
      <TableCell><SourceCell r={r} /></TableCell>
      <ActionsCells r={r} onTrack={onTrack} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} actionLabel="Track holding" actionTooltip="Opens the Holdings → Other add form seeded to this instrument. You confirm the amount and figures before anything is saved — nothing is bought or moved automatically." />
    </TableRow>
  );
}
