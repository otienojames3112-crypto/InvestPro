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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  Calculator,
  Layers,
  Table2,
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
import { catalogueLabel, type ReferenceCatalogue } from "@shared/researchPipeline";
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

type SortKey = "name" | "assetClass" | "currency" | "yieldPct" | "trailingReturnPct" | "score";
type SortDir = "asc" | "desc";

type ScoredResult = inferRouterOutputs<AppRouter>["opportunities"]["scored"];
type ScoreEntry = ScoredResult["scores"][number];

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
  const { mode, portfolioId } = usePortfolio();
  const { user } = useAuth();
  const isMaintainer = user?.role === "admin";
  const [, navigate] = useLocation();
  const { data: rows = [], isLoading } = trpc.opportunities.list.useQuery();

  // Phase 8a — the optional, transparent instrument score. It is OFF by default so
  // the catalog opens in its neutral order; the user turns it on. When a portfolio is
  // active we pass it so the score's issuer-concentration penalty reflects the user's
  // own holdings. The score is a factual composite, never a recommendation.
  const scoredInput = useMemo(
    () => (portfolioId ? { portfolioId } : {}),
    [portfolioId],
  );
  const { data: scored } = trpc.opportunities.scored.useQuery(scoredInput, {
    staleTime: 60_000,
  });
  const scoreByRef = useMemo(() => {
    const m = new Map<string, ScoreEntry>();
    for (const s of scored?.scores ?? []) m.set(s.ref, s);
    return m;
  }, [scored]);
  const [showScore, setShowScore] = useState(false);

  // ── Federation scope: "this" = the rich securities/market screener (opportunities);
  //    "all" = a neutral union across ALL FOUR reference catalogues (MMF, bank, CBK,
  //    market asset), headline figure only. Both are read-only, neither ranks. ──
  const [scopeView, setScopeView] = useState<"this" | "all">("this");
  const { data: fedData, isLoading: fedLoading } = trpc.explore.federatedUniverse.useQuery(undefined, {
    enabled: scopeView === "all",
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

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
        if (sortKey === "yieldPct" || sortKey === "trailingReturnPct") {
          const av = num(a[sortKey]);
          const bv = num(b[sortKey]);
          // Nulls always sort last regardless of direction (no implied ranking).
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
        if (sortKey === "score") {
          // The composite score lives in the scored map. Ineligible/absent rows
          // (no eligible score) always sort last regardless of direction.
          const sa = scoreByRef.get(a.ref);
          const sb = scoreByRef.get(b.ref);
          const av = sa && sa.eligible && Number.isFinite(sa.score) ? sa.score : null;
          const bv = sb && sb.eligible && Number.isFinite(sb.score) ? sb.score : null;
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
        const av = (a[sortKey] ?? "").toString().toLowerCase();
        const bv = (b[sortKey] ?? "").toString().toLowerCase();
        return av < bv ? -1 * dir : av > bv ? 1 * dir : 0;
      });
    }
    return out;
  }, [rows, search, classFilter, currencyFilter, liquidityFilter, minYield, maxYield, sortKey, sortDir, scoreByRef]);

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

  // Federated rows honour the shared search + currency + yield filters (asset-class
  // and liquidity facets don't apply cleanly across four catalogues, so they're
  // ignored in "all" view). Neutral order: catalogue, then name — never by figure.
  const CAT_ORDER: Record<string, number> = { mmf: 0, bank: 1, cbk: 2, market_asset: 3 };
  const fedFiltered = useMemo(() => {
    const rowsF = fedData?.instruments ?? [];
    const minY = minYield.trim() === "" ? null : Number(minYield);
    const maxY = maxYield.trim() === "" ? null : Number(maxYield);
    const q = search.trim().toLowerCase();
    const out = rowsF.filter((r) => {
      if (currencyFilter !== "all" && (r.currency ?? "") !== currencyFilter) return false;
      if (q && !`${r.name} ${r.issuer ?? ""} ${r.ref}`.toLowerCase().includes(q)) return false;
      const y = r.headlineFigure;
      if (minY !== null && !isNaN(minY) && (y === null || y < minY)) return false;
      if (maxY !== null && !isNaN(maxY) && (y === null || y > maxY)) return false;
      return true;
    });
    return [...out].sort((a, b) => {
      const c = (CAT_ORDER[a.catalogue] ?? 9) - (CAT_ORDER[b.catalogue] ?? 9);
      return c !== 0 ? c : a.name.localeCompare(b.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fedData, search, currencyFilter, minYield, maxYield]);

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
              A neutral screener over the <span className="font-medium text-foreground">approved reference catalogues</span> —
              every instrument here has already passed governed review, with its figures sourced and audited.
              Nothing is recommended: you decide what to look at, filter, and compare, and you can optionally
              turn on a transparent factual Score that combines the published facts (it is never advice).
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Federation toggle: this catalogue (rich securities/market screener) vs the
                neutral union across all four reference catalogues. */}
            <div className="inline-flex rounded-lg border p-0.5 bg-muted/40" role="group" aria-label="Catalogue scope">
              <button
                onClick={() => setScopeView("this")}
                aria-pressed={scopeView === "this"}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${scopeView === "this" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Table2 className="w-3.5 h-3.5" /> This catalogue
              </button>
              <button
                onClick={() => setScopeView("all")}
                aria-pressed={scopeView === "all"}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${scopeView === "all" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Layers className="w-3.5 h-3.5" /> All catalogues
              </button>
            </div>
            {scopeView === "this" && (
              <Button
                size="sm"
                variant={showScore ? "default" : "outline"}
                onClick={() => {
                  const next = !showScore;
                  setShowScore(next);
                  // Turning the score off also drops a score-sort so the catalog returns
                  // to its neutral order; turning it on never auto-sorts.
                  if (!next && sortKey === "score") {
                    setSortKey(null);
                    setSortDir("asc");
                  }
                }}
                className="active:scale-[0.97] transition-transform"
                aria-pressed={showScore}
              >
                <Calculator className="w-4 h-4 mr-1.5" /> {showScore ? "Hide score" : "Show score"}
              </Button>
            )}
            {isMaintainer && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => navigate("/explore/new")}
                className="active:scale-[0.97] transition-transform"
                title="Add a new instrument to a reference catalogue (opens the governed editor)"
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
              <Search className="w-4 h-4" /> Filter the approved universe
            </CardTitle>
            <CardDescription className="text-xs">
              All facets are yours to set. The list starts in a neutral order (by asset class,
              then name) and only re-sorts when you click a column. Only approved, active
              catalogue rows appear here.
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
              {scopeView === "this" && (
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
              )}
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
              {scopeView === "this" && (
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
              )}
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
                {scopeView === "this" ? (
                  <>Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {rows.length}</>
                ) : (
                  <>Showing <span className="font-semibold text-foreground">{fedFiltered.length}</span> across all four catalogues</>
                )}
              </p>
              <Button variant="outline" size="sm" onClick={resetFilters} className="h-8 text-xs">
                Reset filters &amp; sort
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Catalog table — This catalogue (rich securities/market screener) */}
        {scopeView === "this" ? (
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
                      {showScore && (
                        <TableHead className="text-right">
                          <span className="inline-flex items-center justify-end gap-1 w-full">
                            <SortHead k="score" numeric>Score</SortHead>
                            <InfoHint side="left">A transparent, factual composite: net yield (after tax) minus point penalties for term lock-ups, issuer concentration against your own holdings, stale or unverified figures, and fees. It is a calculation you can audit by clicking a score — not a recommendation. Rows missing a usable yield show no score.</InfoHint>
                          </span>
                        </TableHead>
                      )}
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
                      <OpportunityRow
                        key={r.ref}
                        r={r}
                        showScore={showScore}
                        score={scoreByRef.get(r.ref)}
                        weights={scored?.weights}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        ) : (
        /* Federated table — a neutral union across ALL FOUR reference catalogues */
        <Card>
          <CardContent className="p-0">
            {fedLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading all catalogues…</div>
            ) : fedFiltered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No published entries match your filters across the four catalogues.
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
                          <InfoHint>Which of the four reference catalogues this published entry lives in — Money-market funds, Bank products, CBK securities, or Market assets.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead>Ccy</TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1 w-full">
                          Headline figure
                          <InfoHint side="left">Each catalogue's own headline number: effective annual rate for funds, indicative rate for bank products, and yield or last price for securities. They are not directly comparable — this view lists, it never ranks.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead>Source</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fedFiltered.map((r) => (
                      <FederatedRow key={r.ref} r={r} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        )}

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

/**
 * The optional Score cell. Shows the composite as a plain number with a click-to-open
 * breakdown that itemises every signed component (the exact facts that moved it) plus a
 * standing reminder that it is a calculation, not advice. Ineligible/absent rows render
 * a neutral dash with the reason — never a low score that could read as "avoid".
 */
function ScoreCell({
  score,
  weights,
}: {
  score?: ScoreEntry;
  weights?: ScoredResult["weights"];
}) {
  const REASON_LABELS: Record<string, string> = {
    inactive: "Not currently active",
    no_yield_figure: "No usable yield figure",
    currency_excluded: "Currency outside the chosen set",
  };
  if (!score) {
    return <span className="text-muted-foreground">—</span>;
  }
  if (!score.eligible) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="text-muted-foreground cursor-help underline decoration-dotted underline-offset-2">—</span>
        </TooltipTrigger>
        <TooltipContent side="left" className="max-w-xs text-xs leading-relaxed">
          No score: {score.ineligibleReasons.map((x) => REASON_LABELS[x] ?? x).join(", ")}.
          This is an exclusion from the calculation, not a low rating.
        </TooltipContent>
      </Tooltip>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 font-semibold text-foreground hover:text-primary underline decoration-dotted underline-offset-2 active:scale-[0.97] transition-transform">
          {score.score.toFixed(1)}
        </button>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-80 text-left">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-semibold">Score breakdown</p>
            <span className="text-lg font-bold tabular-nums">{score.score.toFixed(1)}</span>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            A transparent sum of the facts below. Positive points come from net yield;
            negative points are penalties for risk/quality factors. This is a calculation
            you can audit — it is not a recommendation.
          </p>
          <div className="divide-y divide-border rounded-md border">
            {score.components.map((c) => (
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
              Net yield is scored at {weights.netYieldPerPct} point(s) per percentage point.
              The same weights apply to every instrument.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Catalogue badge palette — neutral hues, no good/bad colouring. */
const CAT_BADGE: Record<ReferenceCatalogue, string> = {
  mmf: "border-sky-500/30 text-sky-600 dark:text-sky-400",
  bank: "border-violet-500/30 text-violet-600 dark:text-violet-400",
  cbk: "border-teal-500/30 text-teal-600 dark:text-teal-400",
  market_asset: "border-amber-500/30 text-amber-600 dark:text-amber-400",
};

type FederatedInstrument = inferRouterOutputs<AppRouter>["explore"]["federatedUniverse"]["instruments"][number];

/**
 * A single federated row — the neutral union view. It shows only the catalogue's own
 * headline figure with its label, never a cross-catalogue ranking. Clicking through
 * routes to the entry in whichever catalogue owns it (MMF/bank open their catalogue
 * tab; opportunities open the instrument detail).
 */
function FederatedRow({ r }: { r: FederatedInstrument }) {
  const cat = r.catalogue as ReferenceCatalogue;
  // Every federated row now routes back into its Reference Catalogue tab with a
  // ?ref= deep link, so the target row is scrolled-to and highlighted there. This
  // keeps the approved universe entirely inside Reference Catalogues (no escape to
  // the standalone /explore/:ref detail route, which no longer has a top-level tab).
  const catParam =
    cat === "mmf"
      ? "mmf-market"
      : cat === "bank"
        ? "bank-catalogue"
        : cat === "cbk"
          ? "cbk-securities"
          : "market-assets";
  const refValue = cat === "mmf" || cat === "bank" ? r.name : r.ref;
  const href = `/research?tab=reference-catalogues&cat=${catParam}&ref=${encodeURIComponent(refValue)}`;
  const figure =
    r.headlineFigure === null
      ? "—"
      : r.headlineLabel.toLowerCase().includes("price")
        ? `${r.currency ?? ""} ${r.headlineFigure.toLocaleString("en-KE", { maximumFractionDigits: 2 })}`.trim()
        : `${r.headlineFigure.toFixed(2)}%`;
  return (
    <TableRow className="align-top">
      <TableCell>
        <Link href={href} className="font-medium text-foreground hover:text-primary hover:underline">
          {r.name}
        </Link>
        {r.issuer && <div className="text-xs text-muted-foreground mt-0.5">{r.issuer}</div>}
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${CAT_BADGE[cat] ?? ""}`}>
          {catalogueLabel(cat)}
        </Badge>
      </TableCell>
      <TableCell className="text-sm whitespace-nowrap">{r.currency ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums">
        <div>{figure}</div>
        <div className="text-[10px] text-muted-foreground">{r.headlineLabel}</div>
      </TableCell>
      <TableCell>
        <div className="text-xs text-muted-foreground max-w-[220px]">{r.source ?? "Source not recorded"}</div>
      </TableCell>
    </TableRow>
  );
}

/** A single catalog row. Kept neutral: facts + provenance, one hypothetical action. */
function OpportunityRow({
  r,
  showScore,
  score,
  weights,
}: {
  r: Opportunity;
  showScore: boolean;
  score?: ScoreEntry;
  weights?: ScoredResult["weights"];
}) {
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
      {showScore && (
        <TableCell className="text-right tabular-nums">
          <ScoreCell score={score} weights={weights} />
        </TableCell>
      )}
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
