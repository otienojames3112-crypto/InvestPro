import { useMemo, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { AppShell } from "@/components/AppShell";
import { useRefFocus } from "@/hooks/useRefFocus";
import type { RefFocus } from "@/hooks/useRefFocus";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { CatalogueSourceReviewButton } from "@/components/CatalogueSourceReview";
import { AiExplainDialog } from "@/components/AiExplainDialog";
import { Sparkles } from "lucide-react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { ArchivedRowsPanel, CatalogueScopeFilter, type CatalogueRowScope } from "@/components/ArchivedRowsPanel";
import { humanCheckedCount, figureCount, type FieldProvenanceMap } from "@shared/provenance";
import { rateStaleness } from "@/lib/rateStaleness";
import { resolveCatalogueSource, firstFieldProvenanceSourceUrl } from "@/lib/format";
import { readContractFieldValue } from "@/lib/format";
import { getCatalogueFieldContract, type CatalogueFieldContract } from "@shared/catalogueFieldContracts";
import { detectMarketAssetSacco } from "@shared/researchPipeline";
import { dashboardHref } from "@shared/navigation";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

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
function ActionsCells({ r, onTrack, isManager, staleByRef, refFocus }: { r: Opportunity; onTrack: () => void; isManager: boolean; staleByRef: Map<string, boolean>; refFocus: RefFocus }) {
  const markedStale = staleByRef.get(r.ref);
  return (
    <>
      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="sm" onClick={onTrack} className="h-8 gap-1.5 active:scale-[0.97] transition-transform">
              <PlusCircle className="w-3.5 h-3.5" /> Track holding
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-xs text-xs">
            Opens the Holdings → Other add form seeded to this instrument. You confirm the amount and
            figures before anything is saved — nothing is bought or moved automatically.
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

  const resetFilters = () => setSearch("");

  const { portfolioId } = usePortfolio();
  const [catExplainOpen, setCatExplainOpen] = useState(false);
  const catFacts = useMemo(() => {
    const l: string[] = [`Catalogue: Market Assets Reference. ${marketRows.length} assets shown.`];
    l.push(`Equity: ${bySubtype.equity.length}. REIT: ${bySubtype.reit.length}. Offshore funds: ${bySubtype.offshore_fund.length}. SACCO: ${bySubtype.sacco.length}.`);
    return l.join("\n");
  }, [marketRows, bySubtype]);
  const catExplainQuery = trpc.aiExplain.referenceCatalogue.useQuery(
    { portfolioId: portfolioId!, catalogueSummary: catFacts },
    { enabled: catExplainOpen && !!portfolioId, refetchOnWindowFocus: false, retry: false },
  );

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
              </Link>
              .
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CatalogueSourceReviewButton catalogue="market_asset" isManager={isManager} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCatExplainOpen(true)}
              className="h-7 gap-1.5 text-xs font-medium hover:text-violet-500 hover:border-violet-500/40 active:scale-[0.97] transition-transform"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Explain catalogue
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
                <SubtypeTable subtype="equity" rows={bySubtype.equity} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} />
              </TabsContent>
              <TabsContent value="reit" className="mt-4">
                <SubtypeTable subtype="reit" rows={bySubtype.reit} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} />
              </TabsContent>
              <TabsContent value="offshore_fund" className="mt-4">
                <SubtypeTable subtype="offshore_fund" rows={bySubtype.offshore_fund} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} />
              </TabsContent>
              <TabsContent value="sacco" className="mt-4">
                <SubtypeTable subtype="sacco" rows={bySubtype.sacco} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} />
              </TabsContent>
            </Tabs>
          )
        )}

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          "Track holding" opens the Holdings → Other add form pre-set to this instrument — you
          confirm the amount held and figures there before anything is saved.
        </p>
      </div>
      <AiExplainDialog
        open={catExplainOpen}
        onOpenChange={setCatExplainOpen}
        title="Explain Market Assets Reference"
        description="A plain-language explanation of how the Market Assets Reference catalogue works, what price/NAV, distribution yield, trailing return, and fees mean, and how to evaluate market assets for your plan."
        answer={catExplainQuery.data?.answer}
        isLoading={catExplainQuery.isLoading || catExplainQuery.isFetching}
        isError={catExplainQuery.isError}
        errorMessage={catExplainQuery.error?.message}
        onRetry={() => catExplainQuery.refetch()}
      />
    </AppShell>
  );
}

type Subtype = "equity" | "reit" | "offshore_fund" | "sacco";

const EMPTY_LABEL: Record<Subtype, string> = {
  equity: "No equities match your search.",
  reit: "No REITs match your search.",
  offshore_fund: "No offshore funds match your search.",
  sacco: "No SACCOs match your search.",
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
  isManager,
  staleByRef,
  refFocus,
}: {
  subtype: Subtype;
  rows: Opportunity[];
  isManager: boolean;
  staleByRef: Map<string, boolean>;
  refFocus: RefFocus;
}) {
  const contract = getCatalogueFieldContract("market_asset", subtype);
  const trackHolding = useTrackHolding();

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-0">
          <div className="p-8 text-center text-sm text-muted-foreground">{EMPTY_LABEL[subtype]}</div>
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
                  onTrack={() => trackHolding(r, priceFieldFor(subtype, r, contract))}
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
        <ActionsCells r={r} onTrack={onTrack} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} />
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
        <ActionsCells r={r} onTrack={onTrack} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} />
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
        <ActionsCells r={r} onTrack={onTrack} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} />
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
      <ActionsCells r={r} onTrack={onTrack} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} />
    </TableRow>
  );
}
