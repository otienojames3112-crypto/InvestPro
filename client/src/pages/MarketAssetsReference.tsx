import { useMemo, useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { AppShell } from "@/components/AppShell";
import { useRefFocus } from "@/hooks/useRefFocus";
import type { RefFocus } from "@/hooks/useRefFocus";
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
import { InfoHint } from "@/components/InfoHint";
import {
  Search,
  Info,
  ShieldAlert,
  Clock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  LineChart,
  PlusCircle,
  Globe,
  ShieldCheck,
} from "lucide-react";
import { profileFor, type AssetClass } from "@shared/assetModel";
import { useAuth } from "@/_core/hooks/useAuth";
import { CatalogueRowControls } from "@/components/CatalogueRowControls";
import { CatalogueSourceReviewButton } from "@/components/CatalogueSourceReview";
import { ArchivedRowsPanel, CatalogueScopeFilter, type CatalogueRowScope } from "@/components/ArchivedRowsPanel";
import { humanCheckedCount, figureCount, type FieldProvenanceMap } from "@shared/provenance";
import { rateStaleness } from "@/lib/rateStaleness";
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
 */

type Opportunity = inferRouterOutputs<AppRouter>["opportunities"]["list"][number];
type SortKey = "name" | "yieldPct" | "trailingReturnPct" | "lastPrice" | "expenseRatioPct";
type SortDir = "asc" | "desc";

const MARKET_CLASSES = ["equity", "reit", "offshore_fund", "alt"] as const;

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

export default function MarketAssetsReference({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: rows = [], isLoading } = trpc.opportunities.list.useQuery();
  const [, navigate] = useLocation();
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
  const [classFilter, setClassFilter] = useState<string>("all");
  const [currencyFilter, setCurrencyFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const marketRows = useMemo(
    () => rows.filter((r) => (MARKET_CLASSES as readonly string[]).includes(r.assetClass)),
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

  const currencies = useMemo(
    () => Array.from(new Set(marketRows.map((r) => r.currency))).sort(),
    [marketRows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = marketRows.filter((r) => {
      if (classFilter !== "all" && r.assetClass !== classFilter) return false;
      if (currencyFilter !== "all" && r.currency !== currencyFilter) return false;
      if (q && !`${r.name} ${r.issuer ?? ""} ${r.ref}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        if (sortKey === "name") {
          const an = (a.name ?? "").toLowerCase();
          const bn = (b.name ?? "").toLowerCase();
          return an < bn ? -1 * dir : an > bn ? 1 * dir : 0;
        }
        const av = num(a[sortKey]);
        const bv = num(b[sortKey]);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return (av - bv) * dir;
      });
    }
    return out;
  }, [marketRows, search, classFilter, currencyFilter, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function SortHead({ k, children, numeric }: { k: SortKey; children: React.ReactNode; numeric?: boolean }) {
    const active = sortKey === k;
    return (
      <button
        onClick={() => toggleSort(k)}
        className={`inline-flex items-center gap-1 font-semibold transition-colors hover:text-foreground ${active ? "text-foreground" : "text-muted-foreground"} ${numeric ? "justify-end w-full" : ""}`}
      >
        {children}
        {active ? (
          sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ArrowUpDown className="w-3 h-3 opacity-50" />
        )}
      </button>
    );
  }

  const resetFilters = () => {
    setSearch("");
    setClassFilter("all");
    setCurrencyFilter("all");
    setSortKey(null);
    setSortDir("asc");
  };

  /** Deep-link to Holdings → Other with the instrument pre-seeded. */
  function trackHolding(r: Opportunity) {
    const cls = CATALOG_TO_OTHER_CLASS[r.assetClass] ?? "other";
    const price = num(r.lastPrice);
    const params = new URLSearchParams({
      track: "1",
      name: r.name,
      class: cls,
      value: price != null ? String(price) : "",
      notes: `Tracked from Market Assets Reference (${r.ref})`,
    });
    navigate(`${dashboardHref.other}${dashboardHref.other.includes("?") ? "&" : "?"}${params.toString()}`);
  }

  return (
    <AppShell embedded={embedded}>
      <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" style={{ fontFamily: "'Playfair Display', serif" }}>
              <LineChart className="w-6 h-6 text-primary" /> Market Assets Reference
            </h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Listed equities, REITs and offshore funds with prices, yields and trailing returns
              sourced from public market data. Reference only — nothing is ranked or recommended.
              The assets you actually hold live under{" "}
              <Link href={dashboardHref.other} className="text-primary underline underline-offset-2">
                Holdings → Other
              </Link>
              .
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CatalogueSourceReviewButton catalogue="market_asset" isManager={isManager} />
            <Badge variant="outline" className="text-xs px-2.5 py-1 gap-1.5">
              <Info className="w-3 h-3" /> Information only
            </Badge>
          </div>
        </div>

        {/* Persistent disclaimer */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              <strong>For information only — this is not advice or a recommendation.</strong>{" "}
              Market prices and returns are historical, may be delayed, and can fall as well as rise.
              Past performance does not predict the future. Verify every figure before acting. This
              tool does not sell, broker, or execute any investment.
            </p>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="w-4 h-4" /> Filter market assets
            </CardTitle>
            <CardDescription className="text-xs">
              The list starts in a neutral order (by name) and only re-sorts when you click a column.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Search</Label>
                <Input
                  placeholder="Name, issuer or ticker"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Asset class</Label>
                <Select value={classFilter} onValueChange={setClassFilter}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All market assets</SelectItem>
                    <SelectItem value="equity">Equities</SelectItem>
                    <SelectItem value="reit">REITs</SelectItem>
                    <SelectItem value="offshore_fund">Offshore funds</SelectItem>
                    <SelectItem value="alt">Alternatives</SelectItem>
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
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {marketRows.length}
              </p>
              <div className="flex items-center gap-2">
                <CatalogueScopeFilter value={scope} onChange={setScope} />
                <Button variant="outline" size="sm" onClick={resetFilters} className="h-8 text-xs">
                  Reset filters &amp; sort
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

        {/* Table */}
        {scope !== "archived" && (
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading market assets…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No market assets match your filters. Try widening them.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><SortHead k="name">Instrument</SortHead></TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead className="text-right"><SortHead k="lastPrice" numeric>Price</SortHead></TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1 w-full">
                          <SortHead k="yieldPct" numeric>Yield</SortHead>
                          <InfoHint side="left">Distribution / dividend yield where published. Before tax; may be trailing.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1 w-full">
                          <SortHead k="trailingReturnPct" numeric>Trailing 1Y</SortHead>
                          <InfoHint side="left">The actual return over the past 12 months. It describes what already happened and does not predict the future.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="text-right"><SortHead k="expenseRatioPct" numeric>Fee</SortHead></TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Source &amp; freshness
                          <InfoHint>Where each figure came from and how recently it was updated.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="text-right">Action</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <MarketRow key={r.ref} r={r} onTrack={() => trackHolding(r)} isManager={isManager} staleByRef={staleByRef} refFocus={refFocus} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        )}

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          "Track holding" opens the Holdings → Other add form pre-set to this instrument — you
          confirm the amount held and figures there before anything is saved.
        </p>
      </div>
    </AppShell>
  );
}

function MarketRow({ r, onTrack, isManager, staleByRef, refFocus }: { r: Opportunity; onTrack: () => void; isManager: boolean; staleByRef: Map<string, boolean>; refFocus: RefFocus }) {
  const profile = profileFor(r.assetClass as AssetClass);
  const stale = rateStaleness(r.dataAsOf);
  const markedStale = staleByRef.get(r.ref);
  const trailing = num(r.trailingReturnPct);
  const fp = (r.fieldProvenance ?? {}) as FieldProvenanceMap;
  const total = figureCount(fp);
  const checked = humanCheckedCount(fp);
  return (
    <TableRow
      ref={refFocus.registerRow(r.ref, r.name)}
      data-ref={r.ref}
      className={`align-top ${refFocus.isFocused(r.ref, r.name) ? "bg-primary/5" : ""}`}
    >
      <TableCell>
        <Link href={`/explore/${encodeURIComponent(r.ref)}`} className="font-medium text-foreground hover:text-primary hover:underline">
          {r.name}
        </Link>
        <div className="text-xs text-muted-foreground mt-0.5">{r.issuer ?? r.market ?? r.ref}</div>
        {markedStale && (
          <Badge variant="outline" className="mt-1 mr-1 text-[10px] px-1.5 py-0 border-amber-300 text-amber-600">Stale</Badge>
        )}
        {profile.fxExposed && (
          <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400">
            <Globe className="w-2.5 h-2.5" /> FX risk
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{profile.label}</TableCell>
      <TableCell className="text-right tabular-nums text-sm">{fmtPrice(r.lastPrice, r.currency)}</TableCell>
      <TableCell className="text-right tabular-nums">
        <div>{fmtPct(r.yieldPct)}</div>
        {r.yieldKind && <div className="text-[10px] text-muted-foreground">{r.yieldKind}</div>}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {trailing === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-help underline decoration-dotted underline-offset-2 text-foreground">
                {trailing.toFixed(2)}%
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs text-xs">
              Past performance. Trailing returns describe what already happened and do not predict
              future results.
            </TooltipContent>
          </Tooltip>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm">{fmtPct(r.expenseRatioPct)}</TableCell>
      <TableCell>
        <div className="text-xs text-muted-foreground max-w-[200px]">{r.dataSource ?? "Source not recorded"}</div>
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
      </TableCell>
      <TableCell className="text-right">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              onClick={onTrack}
              className="h-8 gap-1.5 active:scale-[0.97] transition-transform"
            >
              <PlusCircle className="w-3.5 h-3.5" /> Track holding
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-xs text-xs">
            Opens the Holdings → Other add form seeded to this instrument. You confirm the amount and
            figures before anything is saved — nothing is bought or moved automatically.
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
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
