import { useMemo, useState } from "react";
import { Link } from "wouter";
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
  Building2,
  PlusCircle,
  ShieldCheck,
} from "lucide-react";
import { profileFor, type AssetClass } from "@shared/assetModel";
import { useAuth } from "@/_core/hooks/useAuth";
import { CatalogueRowControls } from "@/components/CatalogueRowControls";
import { humanCheckedCount, figureCount, type FieldProvenanceMap } from "@shared/provenance";
import { rateStaleness } from "@/lib/rateStaleness";
import { dashboardHref } from "@shared/navigation";
import { useDepositDrawer, type DepositPrefill } from "@/contexts/DepositDrawerContext";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";

/**
 * CBK Securities Reference — the Government of Kenya fixed-income catalogue.
 *
 * A read-only reference over the `gov_discount` (T-bills / zero-coupon) and
 * `gov_coupon` (IFB / FXD / floating) rows of the shared opportunity catalog.
 * It mirrors Explore's neutral, source-cited table (no ranking, no advice) but
 * scopes to CBK paper and adds ONE forward action that writes a real holding:
 * "Record purchase", which opens the same confirmation-gated deposit drawer used
 * everywhere else, pre-seeded to the matching gov-security bucket. Securities you
 * actually hold live under Holdings → Government; nothing here is written until
 * the user confirms every figure in that drawer.
 */

type Opportunity = inferRouterOutputs<AppRouter>["opportunities"]["list"][number];
type SortKey = "name" | "yieldPct" | "tenorYears" | "maturityDate";
type SortDir = "asc" | "desc";

const GOV_CLASSES = ["gov_discount", "gov_coupon"] as const;

function num(v: string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function fmtPct(v: string | null): string {
  const n = num(v);
  return n === null ? "—" : `${n.toFixed(2)}%`;
}
function fmtDate(v: string | Date | null): string {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime())
    ? "—"
    : d.toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Map a catalog gov instrument to the deposit drawer's gov bucket + (for T-bills)
 * a tenor in days. We read the tenor from the factNote/name where present but
 * always fall back to a safe default the user can change in the drawer.
 */
function govPrefill(r: Opportunity): DepositPrefill {
  const hay = `${r.name} ${r.ref} ${r.factNote ?? ""}`.toLowerCase();
  if (r.assetClass === "gov_discount") {
    if (hay.includes("zero")) return { kind: "gov", bucket: "zero" };
    const days = hay.includes("91") ? 91 : hay.includes("182") ? 182 : 364;
    return { kind: "gov", bucket: "tbill", tbillTenorDays: days as 91 | 182 | 364 };
  }
  if (hay.includes("ifb") || hay.includes("infrastructure")) return { kind: "gov", bucket: "ifb" };
  if (hay.includes("float")) return { kind: "gov", bucket: "floating" };
  return { kind: "gov", bucket: "fxd" };
}

export default function CbkSecuritiesReference({ embedded = false }: { embedded?: boolean } = {}) {
  const { data: rows = [], isLoading } = trpc.opportunities.list.useQuery();
  const { openDrawer } = useDepositDrawer();
  const { user } = useAuth();
  const isManager = user?.role === "admin";
  const { data: metaData } = trpc.catalogue.rowMeta.useQuery(
    { catalogue: "cbk" },
    { enabled: isManager },
  );
  const staleByRef = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const row of Object.values(metaData?.meta ?? {})) m.set(row.targetRef, !!row.stale);
    return m;
  }, [metaData]);

  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const govRows = useMemo(
    () => rows.filter((r) => (GOV_CLASSES as readonly string[]).includes(r.assetClass)),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = govRows.filter((r) => {
      if (classFilter !== "all" && r.assetClass !== classFilter) return false;
      if (q && !`${r.name} ${r.issuer ?? ""} ${r.ref}`.toLowerCase().includes(q)) return false;
      return true;
    });
    if (sortKey) {
      const dir = sortDir === "asc" ? 1 : -1;
      out = [...out].sort((a, b) => {
        if (sortKey === "yieldPct" || sortKey === "tenorYears") {
          const av = num(a[sortKey]);
          const bv = num(b[sortKey]);
          if (av === null && bv === null) return 0;
          if (av === null) return 1;
          if (bv === null) return -1;
          return (av - bv) * dir;
        }
        if (sortKey === "maturityDate") {
          const av = a.maturityDate ? new Date(a.maturityDate).getTime() : null;
          const bv = b.maturityDate ? new Date(b.maturityDate).getTime() : null;
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
  }, [govRows, search, classFilter, sortKey, sortDir]);

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
    setSortKey(null);
    setSortDir("asc");
  };

  return (
    <AppShell embedded={embedded}>
      <div className="p-6 lg:p-8 space-y-6 max-w-6xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2" style={{ fontFamily: "'Playfair Display', serif" }}>
              <Building2 className="w-6 h-6 text-primary" /> CBK Securities Reference
            </h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Government of Kenya Treasury bills and bonds, with tenors, coupons and indicative
              yields sourced from CBK auction data. Reference only — nothing is ranked or
              recommended. The securities you actually hold live under{" "}
              <Link href={dashboardHref.gov} className="text-primary underline underline-offset-2">
                Holdings → Government
              </Link>
              .
            </p>
          </div>
          <Badge variant="outline" className="text-xs px-2.5 py-1 gap-1.5">
            <Info className="w-3 h-3" /> Information only
          </Badge>
        </div>

        {/* Persistent disclaimer */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              <strong>For information only — this is not advice or a recommendation.</strong>{" "}
              Auction figures are indicative, may be delayed, and change at each auction. Verify the
              current tender and cut-off with CBK / DhowCSD before acting. This tool does not sell or
              broker securities.
            </p>
          </CardContent>
        </Card>

        {/* Filters */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="w-4 h-4" /> Filter CBK securities
            </CardTitle>
            <CardDescription className="text-xs">
              The list starts in a neutral order (by name) and only re-sorts when you click a column.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Search</Label>
                <Input
                  placeholder="Name, issue or reference"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Instrument type</Label>
                <Select value={classFilter} onValueChange={setClassFilter}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All GoK securities</SelectItem>
                    <SelectItem value="gov_discount">Discount (T-bills / zero-coupon)</SelectItem>
                    <SelectItem value="gov_coupon">Coupon bonds (IFB / FXD / floating)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {govRows.length}
              </p>
              <Button variant="outline" size="sm" onClick={resetFilters} className="h-8 text-xs">
                Reset filters &amp; sort
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center text-sm text-muted-foreground">Loading CBK securities…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No CBK securities match your filters. Try widening them.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead><SortHead k="name">Security</SortHead></TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1 w-full">
                          <SortHead k="yieldPct" numeric>Yield / coupon</SortHead>
                          <InfoHint side="left">For T-bills this is the discount / annualised yield; for bonds it is the coupon rate. Figures are indicative and before tax (IFB coupons are tax-exempt).</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="text-right"><SortHead k="tenorYears" numeric>Tenor</SortHead></TableHead>
                      <TableHead className="text-right"><SortHead k="maturityDate" numeric>Maturity</SortHead></TableHead>
                      <TableHead>
                        <span className="inline-flex items-center gap-1">
                          Source &amp; freshness
                          <InfoHint>Where each figure came from and how recently it was updated. Auction data moves at each tender.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="text-right">Action</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => (
                      <GovRow key={r.ref} r={r} onRecord={() => openDrawer(govPrefill(r))} isManager={isManager} staleByRef={staleByRef} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          "Record purchase" opens the deposit drawer pre-set to this instrument — you confirm the
          face value, price and dates there before anything is written to your Government holdings.
        </p>
      </div>
    </AppShell>
  );
}

function GovRow({ r, onRecord, isManager, staleByRef }: { r: Opportunity; onRecord: () => void; isManager: boolean; staleByRef: Map<string, boolean> }) {
  const profile = profileFor(r.assetClass as AssetClass);
  const stale = rateStaleness(r.dataAsOf);
  const markedStale = staleByRef.get(r.ref);
  const fp = (r.fieldProvenance ?? {}) as FieldProvenanceMap;
  const total = figureCount(fp);
  const checked = humanCheckedCount(fp);
  const isTaxExempt = /ifb|infrastructure/i.test(`${r.name} ${r.factNote ?? ""}`);
  return (
    <TableRow className="align-top">
      <TableCell>
        <Link href={`/explore/${encodeURIComponent(r.ref)}`} className="font-medium text-foreground hover:text-primary hover:underline">
          {r.name}
        </Link>
        <div className="text-xs text-muted-foreground mt-0.5">{r.issuer ?? r.market ?? "CBK / DhowCSD"}</div>
        {markedStale && (
          <Badge variant="outline" className="mt-1 mr-1 text-[10px] px-1.5 py-0 border-amber-300 text-amber-600">Stale</Badge>
        )}
        {isTaxExempt && (
          <Badge variant="outline" className="mt-1 text-[10px] px-1.5 py-0 border-emerald-500/30 text-emerald-600 dark:text-emerald-400">
            Tax-exempt coupon
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{profile.label}</TableCell>
      <TableCell className="text-right tabular-nums">
        <div>{fmtPct(r.yieldPct)}</div>
        {r.yieldKind && <div className="text-[10px] text-muted-foreground">{r.yieldKind}</div>}
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm">
        {num(r.tenorYears) === null ? "—" : `${Number(r.tenorYears)} yr`}
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm whitespace-nowrap">{fmtDate(r.maturityDate)}</TableCell>
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
              onClick={onRecord}
              className="h-8 gap-1.5 active:scale-[0.97] transition-transform"
            >
              <PlusCircle className="w-3.5 h-3.5" /> Record purchase
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" className="max-w-xs text-xs">
            Opens the deposit drawer seeded to this security. You confirm every figure before it is
            written to your Government holdings — nothing is bought or moved automatically.
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
        <div className="flex items-center justify-end gap-1">
          {isManager && (
            <CatalogueRowControls
              catalogue="cbk"
              targetRef={r.ref}
              instrumentName={r.name}
              isActive={r.active ?? true}
              isStale={markedStale}
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
