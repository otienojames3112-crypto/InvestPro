import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
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
  Globe,
  FlaskConical,
  ShieldCheck,
  PlusCircle,
  Bot,
} from "lucide-react";
import { ASSET_CLASSES, profileFor, type AssetClass } from "@shared/assetModel";
import {
  humanCheckedCount,
  figureCount,
  effectiveState,
  type FieldProvenance,
  type FieldProvenanceMap,
} from "@shared/provenance";
import { rateStaleness } from "@/lib/rateStaleness";
import { usePortfolio } from "@/contexts/PortfolioContext";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

const ROW_NOW = Date.now();

type Opportunity = inferRouterOutputs<AppRouter>["opportunities"]["list"][number];

/**
 * Expansion Brief — Part 2: the "Explore" Opportunity Catalog.
 *
 * Design intent (encoded so the tool INFORMS, never RECOMMENDS):
 *  - The default order is NEUTRAL — by asset class, then name. It is NEVER sorted
 *    by yield/return/price unless the USER clicks that column header.
 *  - There is no "best/top/strong/recommended", no medals, no green=good heat
 *    colouring. Every figure is a plain fact with its source + as-of date.
 *  - Each row carries a provenance line and a staleness badge (reusing the same
 *    rateStaleness thresholds the Dashboard uses).
 *  - A persistent disclaimer states the data is informational and must be
 *    verified before acting. There is NO buy/invest/brokerage path.
 *  - The only forward action is hypothetical: "Model in my plan" (Part 3),
 *    which respects the current Live/Test mode just like the deposit CTA.
 */

type SortKey = "name" | "assetClass" | "currency" | "yieldPct" | "trailingReturnPct";
type SortDir = "asc" | "desc";

const LIQUIDITY_LABELS: Record<string, string> = {
  daily: "Daily",
  t_plus_settlement: "T+settlement",
  term: "Term (locked)",
  illiquid: "Illiquid",
};

function classLabel(c: string): string {
  return ASSET_CLASSES.includes(c as AssetClass) ? profileFor(c as AssetClass).label : c;
}

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

export default function Explore({ embedded = false }: { embedded?: boolean } = {}) {
  const { mode } = usePortfolio();
  const { user } = useAuth();
  const isMaintainer = user?.role === "admin";
  const [, navigate] = useLocation();
  const { data: rows = [], isLoading } = trpc.opportunities.list.useQuery();

  // ── User-controlled filters (the user narrows; the tool never pre-filters) ──
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [currencyFilter, setCurrencyFilter] = useState<string>("all");
  const [liquidityFilter, setLiquidityFilter] = useState<string>("all");
  const [minYield, setMinYield] = useState<string>("");
  const [maxYield, setMaxYield] = useState<string>("");

  // ── User-controlled sort. Default is the NEUTRAL order returned by the server
  //    (assetClass, then name). A metric sort only applies once the user clicks. ──
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const currencies = useMemo(
    () => Array.from(new Set(rows.map((r) => r.currency))).sort(),
    [rows],
  );

  // One-time deep link: the Allocation Plan page routes here with ?class=<assetClass>
  // to pre-narrow the screener to the bucket the user chose to look at. The user
  // still chooses what (if anything) to do; we only set the same filter they could
  // set by hand, then clean the URL so a refresh doesn't re-apply it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const c = params.get("class");
    if (c && (ASSET_CLASSES as readonly string[]).includes(c)) {
      setClassFilter(c);
      params.delete("class");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}${qs ? `?${qs}` : ""}`,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const minY = minYield.trim() === "" ? null : Number(minYield);
    const maxY = maxYield.trim() === "" ? null : Number(maxYield);
    const q = search.trim().toLowerCase();
    let out = rows.filter((r) => {
      if (classFilter !== "all" && r.assetClass !== classFilter) return false;
      if (currencyFilter !== "all" && r.currency !== currencyFilter) return false;
      if (liquidityFilter !== "all" && (r.liquidity ?? "") !== liquidityFilter) return false;
      if (q && !(`${r.name} ${r.issuer ?? ""} ${r.ref}`.toLowerCase().includes(q))) return false;
      const y = num(r.yieldPct);
      if (minY !== null && !isNaN(minY) && (y === null || y < minY)) return false;
      if (maxY !== null && !isNaN(maxY) && (y === null || y > maxY)) return false;
      return true;
    });

    // The server already returns neutral order. Re-sort ONLY on explicit click.
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        let av: string | number | null;
        let bv: string | number | null;
        if (sortKey === "yieldPct" || sortKey === "trailingReturnPct") {
          av = num(a[sortKey]);
          bv = num(b[sortKey]);
          // Nulls always sort last regardless of direction (no implied ranking).
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
        av = (a[sortKey] ?? "").toString().toLowerCase();
        bv = (b[sortKey] ?? "").toString().toLowerCase();
        return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
      });
    }
    return out;
  }, [rows, search, classFilter, currencyFilter, liquidityFilter, minYield, maxYield, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
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
    setSearch(""); setClassFilter("all"); setCurrencyFilter("all");
    setLiquidityFilter("all"); setMinYield(""); setMaxYield("");
    setSortKey(null); setSortDir("asc");
  };

  return (
    <AppShell embedded={embedded}>
      <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
              Explore Opportunities
            </h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              A neutral catalog of investable instruments with publicly sourced facts.
              Nothing here is ranked, scored, or recommended — you decide what to look at,
              filter, and compare.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isMaintainer && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/explore/new")}
                className="active:scale-[0.97] transition-transform"
              >
                <PlusCircle className="w-4 h-4 mr-1.5" /> Add instrument
              </Button>
            )}
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
              Figures are gathered from public sources, may be delayed or inaccurate, and can
              change without notice. Verify every number with the issuer or a licensed adviser
              before acting. This tool does not sell, broker, or execute any investment.
            </p>
          </CardContent>
        </Card>

        {/* Filters — the user narrows the universe */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="w-4 h-4" /> Filter the catalog
            </CardTitle>
            <CardDescription className="text-xs">
              All facets are yours to set. The list starts in a neutral order (by asset class,
              then name) and only re-sorts when you click a column.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Search</Label>
                <Input
                  placeholder="Name, issuer, or ticker"
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
                    <SelectItem value="all">All classes</SelectItem>
                    {ASSET_CLASSES.map((c) => (
                      <SelectItem key={c} value={c}>{profileFor(c).label}</SelectItem>
                    ))}
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
                <Label className="text-xs">Liquidity</Label>
                <Select value={liquidityFilter} onValueChange={setLiquidityFilter}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Any liquidity</SelectItem>
                    {Object.entries(LIQUIDITY_LABELS).map(([v, l]) => (
                      <SelectItem key={v} value={v}>{l}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Min yield (%)</Label>
                <Input type="number" inputMode="decimal" value={minYield}
                  onChange={(e) => setMinYield(e.target.value)} className="h-9" placeholder="e.g. 8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Max yield (%)</Label>
                <Input type="number" inputMode="decimal" value={maxYield}
                  onChange={(e) => setMaxYield(e.target.value)} className="h-9" placeholder="e.g. 15" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {rows.length}
              </p>
              <Button variant="outline" size="sm" onClick={resetFilters} className="h-8 text-xs">
                Reset filters &amp; sort
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Catalog table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading catalog…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No instruments match your filters. Try widening them.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><SortHead k="name">Instrument</SortHead></TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          <SortHead k="assetClass">Class</SortHead>
                          <InfoHint>The kind of investment — e.g. a money market fund, a Treasury bill, a bank deposit or a bond. It determines how the instrument earns and what risks apply.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          <SortHead k="currency">Ccy</SortHead>
                          <InfoHint>Currency the instrument is held in (e.g. KES for Kenyan shillings, USD for US dollars). “Ccy” is shorthand for currency.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1 w-full">
                          <SortHead k="yieldPct" numeric>Yield / coupon</SortHead>
                          <InfoHint side="left">The annual interest rate the instrument pays. “Yield” is the headline rate for funds and deposits; “coupon” is the fixed rate a bond pays. This is before tax.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1 w-full">
                          <SortHead k="trailingReturnPct" numeric>Trailing 1Y</SortHead>
                          <InfoHint side="left">The actual return the instrument delivered over the past 12 months. It describes what already happened and does not predict the future.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="text-right">Price</TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Source &amp; freshness
                          <InfoHint>Where each figure came from and how recently it was updated. “May be stale” means the data is older than expected and should be re-checked before relying on it.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <OpportunityRow key={r.ref} r={r} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Mode note — same Live/Test framing as the rest of the app */}
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          {mode === "sandbox" ? <FlaskConical className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
          The catalog is the same in Live and Test. Choosing “Model in my plan” only ever runs a
          hypothetical projection{mode === "sandbox" ? " in your sandbox" : ""} — it never moves real money.
        </p>
      </div>
    </AppShell>
  );
}

/** A single catalog row. Kept neutral: facts + provenance, one hypothetical action. */
function OpportunityRow({ r }: { r: Opportunity }) {
  const profile = profileFor(r.assetClass as AssetClass);
  const stale = rateStaleness(r.dataAsOf);
  const trailing = num(r.trailingReturnPct);
  const fp = (r.fieldProvenance ?? {}) as FieldProvenanceMap;
  const total = figureCount(fp);
  const checked = humanCheckedCount(fp);
  // Part 8: how many figures are AI-extracted (lowest-trust, provisional). Surfaced
  // distinctly so a row carrying any AI figure visibly reads as not-yet-checked.
  const aiCount = Object.values(fp).filter(
    (p): p is FieldProvenance => !!p && effectiveState(p, ROW_NOW) === "ai_extracted",
  ).length;
  return (
    <TableRow className="align-top">
      <TableCell>
        <Link href={`/explore/${encodeURIComponent(r.ref)}`} className="font-medium text-foreground hover:text-primary hover:underline">
          {r.name}
        </Link>
        <div className="text-xs text-muted-foreground mt-0.5">{r.issuer ?? r.market ?? r.ref}</div>
        <div className="flex flex-wrap gap-1 mt-1">
          {profile.fxExposed && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400 cursor-help">
                  <Globe className="w-2.5 h-2.5" /> FX risk
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                Foreign-exchange risk: this instrument is in a foreign currency, so its value in shillings rises and falls with the exchange rate — you can gain or lose money on currency moves alone.
              </TooltipContent>
            </Tooltip>
          )}
          {profile.priceDriven && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 cursor-help">Price-driven</Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                Its value moves with a market price (like a bond or share), so it can go up or down day to day — unlike a fund or deposit that simply accrues interest.
              </TooltipContent>
            </Tooltip>
          )}
          {profile.insured === "none" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-amber-500/30 text-amber-600 dark:text-amber-400 cursor-help">
                  Not insured
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                Not covered by deposit insurance (KDIC). If the provider failed, the money is not guaranteed — unlike a bank deposit, which is insured up to a limit.
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{profile.label}</TableCell>
      <TableCell className="text-sm whitespace-nowrap">{r.currency}</TableCell>
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
      <TableCell className="text-right tabular-nums text-sm">{fmtPrice(r.lastPrice, r.currency)}</TableCell>
      <TableCell>
        <div className="text-xs text-muted-foreground max-w-[200px]">{r.dataSource ?? "Source not recorded"}</div>
        <div className="flex items-center gap-1 mt-0.5">
          <Clock className="w-3 h-3 text-muted-foreground" />
          <span className={`text-[10px] font-medium ${stale.isVeryStale ? "text-red-500" : stale.isStale ? "text-amber-500" : "text-muted-foreground"}`}>
            {stale.label}{stale.isStale ? " · may be stale" : ""}
          </span>
        </div>
        {total > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={`inline-flex items-center gap-1 mt-1 text-[10px] font-medium cursor-help ${checked > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}
              >
                <ShieldCheck className="w-3 h-3" />
                {checked}/{total} checked
              </span>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs text-xs">
              {checked > 0
                ? `A person has confirmed or entered ${checked} of ${total} figures. Open the instrument to see which.`
                : `None of these ${total} figures have been checked by a person yet — they are scraped from public sources. Open the instrument to confirm or edit them.`}
            </TooltipContent>
          </Tooltip>
        )}
        {aiCount > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center gap-1 mt-1 text-[10px] font-medium cursor-help text-orange-700 dark:text-orange-300">
                  <Bot className="w-3 h-3" />
                  {aiCount} AI-extracted
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs text-xs">
                {aiCount} of these figures were pulled from a document by AI and have not been
                checked by a person or a parser. Treat them as provisional and confirm against the
                cited source before relying on them.
              </TooltipContent>
          </Tooltip>
        )}
      </TableCell>
      <TableCell>
        <Link href={`/explore/${encodeURIComponent(r.ref)}`}>
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`View ${r.name}`}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </Link>
      </TableCell>
    </TableRow>
  );
}
