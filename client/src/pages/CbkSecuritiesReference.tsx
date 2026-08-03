import { useMemo, useState, useEffect } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/AppShell";
import { useRefFocus } from "@/hooks/useRefFocus";
import type { RefFocus } from "@/hooks/useRefFocus";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CBK_CATALOGUE_FIELD_GUIDE, HOW_TO_READ_CATALOGUE_LABEL, catalogueReadGuide } from "@/lib/catalogueReadGuides";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { InfoHint } from "@/components/InfoHint";
import {
  Search,
  Info,
  Clock,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  Building2,
  PlusCircle,
  ShieldCheck,
  ExternalLink,
  FileText,
} from "lucide-react";
import { profileFor, type AssetClass } from "@shared/assetModel";
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
import { getCatalogueFieldContract } from "@shared/catalogueFieldContracts";
import { cbkSecurityTypeLabel, cbkTaxExemptLabel, cbkNetYieldAfterWht, normalizeDateToYmd } from "@shared/researchPipeline";
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

// Stage 10b-2 — the SAME CBK contract every other display layer (Ask AI,
// review queue, approval modal, the multi-field edit dialog) already uses,
// so the table/drawer's field list/order/labels can never drift.
const CBK_CONTRACT = getCatalogueFieldContract("cbk");
const cbkFieldByKey = (key: string) => CBK_CONTRACT?.fields.find((f) => f.key === key);

function num(v: string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
/** Tolerates a currency prefix/commas (e.g. "KES 50,000"), same fix as
 *  shared/researchPipeline.ts's num() — minInvestment is free text, not
 *  guaranteed to already be a clean number. */
function parseAmount(v: string | null): number | null {
  if (v === null) return null;
  const m = v.replace(/,/g, "").trim().match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}
function kes(n: number): string {
  return n.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
function fmtPct(v: string | null): string {
  const n = num(v);
  return n === null ? "—" : `${n.toFixed(2)}%`;
}
/**
 * Map a catalog gov instrument to the deposit drawer's gov bucket + (for T-bills)
 * a tenor in days. We read the tenor from the factNote/name where present but
 * always fall back to a safe default the user can change in the drawer.
 */
function govPrefill(r: Opportunity): DepositPrefill {
  const hay = `${r.name} ${r.ref} ${r.factNote ?? ""}`.toLowerCase();
  let bucket: "tbill" | "ifb" | "fxd" | "zero" | "floating" = "fxd";
  let tbillTenorDays: 91 | 182 | 364 | undefined;
  if (r.assetClass === "gov_discount") {
    if (hay.includes("zero")) {
      bucket = "zero";
    } else {
      bucket = "tbill";
      tbillTenorDays = hay.includes("91") ? 91 : hay.includes("182") ? 182 : 364;
    }
  } else if (hay.includes("ifb") || hay.includes("infrastructure")) {
    bucket = "ifb";
  } else if (hay.includes("float")) {
    bucket = "floating";
  }

  // Round 99: extract rich terms from extendedFields for snapshot + prefill
  const ext = r.extendedFields as (import("@shared/instrumentProfile").CbkSecurityProfile) | null;
  const pf = (k: string): unknown => {
    const v = ext?.[k as keyof typeof ext];
    if (v == null) return undefined;
    // ProfileField<T> is either T directly or { value: T, ... }
    if (typeof v === "object" && !Array.isArray(v) && "value" in (v as Record<string, unknown>)) return (v as { value: unknown }).value;
    return v;
  };

  return {
    kind: "gov",
    bucket,
    ...(tbillTenorDays ? { tbillTenorDays } : {}),
    // Round 99: full CBK catalogue terms
    opportunityId: r.id,
    securityType: (pf("securityType") ?? undefined) as DepositPrefill extends { kind: "gov" } ? DepositPrefill["securityType"] : never,
    issueNumber: (pf("issueNumber") as string) ?? null,
    isin: (pf("isin") as string) ?? null,
    couponRate: (pf("couponRate") as number) ?? (r.yieldPct != null ? Number(r.yieldPct) : null),
    whtRate: (pf("withholdingTaxRate") as number) ?? null,
    taxExempt: (pf("taxExempt") as boolean) ?? null,
    maturityDate: (pf("maturityDate") as string) ?? (r.maturityDate ? String(r.maturityDate) : null),
    settlementDate: (pf("settlementDate") as string) ?? null,
    couponPaymentDates: (pf("couponPaymentDates") as string[]) ?? null,
    cleanPrice: (pf("cleanPrice") as number) ?? null,
    accruedInterest: (pf("accruedInterestPer100") as number) ?? null,
    dirtyPrice: (pf("dirtyPrice") as number) ?? null,
    secondaryTradingLotSize: (pf("secondaryTradingLotSize") as number) ?? null,
    rediscountingRule: (pf("rediscountingRule") as string) ?? null,
    tenorYears: r.tenorYears != null ? Number(r.tenorYears) : (pf("tenorMonths") != null ? (pf("tenorMonths") as number) / 12 : null),
    yieldRate: (pf("yieldRate") as number) ?? (r.yieldPct != null ? Number(r.yieldPct) : null),
  };
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

  const refFocus = useRefFocus();
  const [search, setSearch] = useState(() => refFocus.focusRef ?? "");
  // Round 90 — manager-only Active/Archived/All view. Non-managers stay on "active".
  const [scope, setScope] = useState<CatalogueRowScope>("active");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  // Stage 9c — the CBK-specific detail drawer, separate from the generic
  // /explore/:ref page every opportunity row also links to.
  const [drawerRow, setDrawerRow] = useState<Opportunity | null>(null);

  const govRows = useMemo(
    () => rows.filter((r) => (GOV_CLASSES as readonly string[]).includes(r.assetClass)),
    [rows],
  );

  // Round 86: a ?ref= that matches no CBK security is a stale cross-catalogue link;
  // clear it (and its prefill) once rows load so this catalogue isn't filtered to nothing.
  useEffect(() => {
    if (isLoading || !refFocus.focusRef) return;
    refFocus.clearIfMissing(
      govRows.flatMap((r) => [r.ref, r.name]),
      () => setSearch((s) => (s === refFocus.focusRef ? "" : s)),
    );
  }, [isLoading, govRows, refFocus]);

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

  const { portfolioId } = usePortfolio();
  const [catExplainOpen, setCatExplainOpen] = useState(false);
  const catFacts = useMemo(() => {
    const l: string[] = [`Catalogue: CBK Securities Reference. ${filtered.length} securities shown.`];
    l.push("Purpose: approved reference data for Government of Kenya securities.");
    const tbills = filtered.filter(r => (r.assetClass as string) === "tbill").length;
    const bonds = filtered.filter(r => (r.assetClass as string) !== "tbill").length;
    if (tbills) l.push(`T-bills: ${tbills}.`);
    if (bonds) l.push(`Bonds/IFBs: ${bonds}.`);
    return catalogueReadGuide("CBK Securities Reference", CBK_CATALOGUE_FIELD_GUIDE, l.join("\n"));
  }, [filtered]);
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
              <Building2 className="w-6 h-6 text-primary" /> CBK Securities Reference
            </h1>
            <p className="text-muted-foreground text-sm mt-1 max-w-2xl">
              Government of Kenya Treasury bills and bonds, with tenors, coupons and indicative
              yields sourced from CBK auction data. Approved reference data only; securities you
              actually hold are recorded separately under{" "}
              <Link href={dashboardHref.gov} className="text-primary underline underline-offset-2">
                Holdings → Government
              </Link>. To propose new or updated catalogue facts, use Research Desk → Ask AI. This is not advice or a recommendation.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {isManager && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button size="sm" disabled className="h-7 gap-1.5 text-xs font-medium">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Maintain records
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  Maintain CBK security records is not enabled here yet. CBK manual maintenance must create a
                  source-supported pending update that preserves T-bill, FXD, and IFB subtype validation before manager
                  approval. For now, use Research Desk → Ask AI for source extraction; purchases and holdings are
                  recorded separately.
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
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground">
                Showing <span className="font-semibold text-foreground">{filtered.length}</span> of {govRows.length}
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
              <div className="text-sm font-medium">Archived CBK securities</div>
              <ArchivedRowsPanel catalogue="cbk" />
            </CardContent>
          </Card>
        )}

        {/* Table */}
        {scope !== "archived" && (
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
                      <TableHead>Security type</TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1 w-full">
                          <SortHead k="yieldPct" numeric>Yield / rate</SortHead>
                          <InfoHint side="left">For T-bills this is the discount / annualised yield; for bonds it is the auction/yield-to-maturity figure. Indicative, before tax.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead className="text-right">Coupon rate</TableHead>
                      <TableHead className="text-right">
                        <span className="inline-flex items-center justify-end gap-1 w-full">
                          Net yield after WHT
                          <InfoHint side="left">Yield after withholding tax, computed from the tax treatment stated for this security. Shown as a dash when the WHT rate can't be read reliably.</InfoHint>
                        </span>
                      </TableHead>
                      <TableHead>Tax treatment</TableHead>
                      <TableHead>Tax-exempt</TableHead>
                      <TableHead className="text-right"><SortHead k="tenorYears" numeric>Tenor</SortHead></TableHead>
                      <TableHead>Auction date</TableHead>
                      <TableHead>Value date</TableHead>
                      <TableHead className="text-right"><SortHead k="maturityDate" numeric>Maturity</SortHead></TableHead>
                      <TableHead className="text-right">Minimum investment</TableHead>
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
                      <GovRow
                        key={r.ref}
                        r={r}
                        onRecord={() => openDrawer(govPrefill(r))}
                        onViewDetails={() => setDrawerRow(r)}
                        isManager={isManager}
                        staleByRef={staleByRef}
                        refFocus={refFocus}
                      />
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
          "Record purchase" opens the deposit drawer pre-set to this instrument — you confirm the
          face value, price and dates there before anything is written to your Government holdings.
        </p>
      </div>
      <AiExplainDialog
        open={catExplainOpen}
        onOpenChange={setCatExplainOpen}
        title="How to read CBK Securities Reference"
        description="Educational guide to CBK security fields, source as-of dates, tax treatment, and where recorded Government holdings live."
        answer={catExplainQuery.data?.answer}
        isLoading={catExplainQuery.isLoading || catExplainQuery.isFetching}
        isError={catExplainQuery.isError}
        errorMessage={catExplainQuery.error?.message}
        onRetry={() => catExplainQuery.refetch()}
      />
      <CbkDetailDrawer row={drawerRow} onOpenChange={(open) => !open && setDrawerRow(null)} isManager={isManager} staleByRef={staleByRef} />
    </AppShell>
  );
}

function GovRow({
  r,
  onRecord,
  onViewDetails,
  isManager,
  staleByRef,
  refFocus,
}: {
  r: Opportunity;
  onRecord: () => void;
  onViewDetails: () => void;
  isManager: boolean;
  staleByRef: Map<string, boolean>;
  refFocus: RefFocus;
}) {
  const fp = (r.fieldProvenance ?? {}) as FieldProvenanceMap;
  const catSource = resolveCatalogueSource(r.dataSource, r.extendedFields, r.dataAsOf, firstFieldProvenanceSourceUrl(fp));
  const stale = rateStaleness(catSource.asOf);
  const markedStale = staleByRef.get(r.ref);
  const total = figureCount(fp);
  const checked = humanCheckedCount(fp);

  // Stage 10b-2 — established CBK fields, read the SAME way Bank/MMF read
  // their extendedFields-tier fields (readContractFieldValue against the
  // shared contract), never a raw camelCase key.
  const extendedFields = r.extendedFields as Record<string, unknown> | null;
  const securityType = readContractFieldValue(extendedFields, cbkFieldByKey("securityType")!);
  const couponRate = readContractFieldValue(extendedFields, cbkFieldByKey("couponRate")!);
  const whtRule = readContractFieldValue(extendedFields, cbkFieldByKey("whtRule")!);
  const taxExemptRaw = readContractFieldValue(extendedFields, cbkFieldByKey("taxExempt")!);
  const auctionDate = readContractFieldValue(extendedFields, cbkFieldByKey("auctionDate")!);
  const valueDate = readContractFieldValue(extendedFields, cbkFieldByKey("valueDate")!);
  const minInvestment = readContractFieldValue(extendedFields, cbkFieldByKey("minInvestment")!);
  const netYield = cbkNetYieldAfterWht(r.yieldPct, whtRule, taxExemptRaw);
  // Stage 10b-2 — replaces the previous name/factNote REGEX guess (flagged in
  // the contract's own whtRule note as "fragile") with the real structured
  // taxExempt figure Slice 8g-2 already persists.
  const isTaxExempt = (taxExemptRaw ?? "").trim().toLowerCase() === "true";
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
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
        {cbkSecurityTypeLabel(securityType) ?? "—"}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <div>{fmtPct(r.yieldPct)}</div>
        {r.yieldKind && <div className="text-[10px] text-muted-foreground">{r.yieldKind}</div>}
      </TableCell>
      <TableCell className="text-right tabular-nums text-sm">{couponRate === null ? "—" : `${couponRate}%`}</TableCell>
      <TableCell className="text-right tabular-nums text-sm text-muted-foreground">
        {netYield === null ? "—" : `${netYield.toFixed(2)}%`}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={whtRule ?? undefined}>
        {whtRule ?? "—"}
      </TableCell>
      <TableCell className="text-sm">{cbkTaxExemptLabel(taxExemptRaw) ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums text-sm">
        {num(r.tenorYears) === null ? "—" : `${Number(r.tenorYears)} yr`}
      </TableCell>
      {/* Stage 10b-2b — YYYY-MM-DD via normalizeDateToYmd, not the locale-
          formatted fmtDate: these are now normalized at promotion time, and
          a stable ISO date reads unambiguously across every source format
          the source text originally used ("17 July 2026", "2026-07-17", …). */}
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{normalizeDateToYmd(auctionDate) ?? "—"}</TableCell>
      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{normalizeDateToYmd(valueDate) ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums text-sm whitespace-nowrap">{normalizeDateToYmd(r.maturityDate) ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums text-sm whitespace-nowrap">
        {(() => {
          const amt = parseAmount(minInvestment);
          return amt === null ? "—" : kes(amt);
        })()}
      </TableCell>
      <TableCell>
        {catSource.label ? (
          catSource.url ? (
            <a
              href={catSource.url}
              target="_blank"
              rel="noopener noreferrer"
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`CBK details for ${r.name}`}
                onClick={onViewDetails}
              >
                <FileText className="w-4 h-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs text-xs">
              Security type, tenor, tax treatment, issue number, coupon, auction/value dates and
              source — the established CBK quick-decision fields for this security.
            </TooltipContent>
          </Tooltip>
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

/** Same compact label/value block Bank's catalogue drawer already uses. */
function DrawerFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

/** Formats a raw extendedFields boolean-ish string ("true"/"false") as Yes/No,
 *  passing anything else through unchanged (never fabricates a value). */
function fmtYesNo(v: string | null): string | null {
  if (v === null) return null;
  const t = v.trim().toLowerCase();
  if (t === "true") return "Yes";
  if (t === "false") return "No";
  return v;
}

/**
 * Stage 9c — the CBK-specific detail drawer, closing Stage 9a's audit finding
 * that CBK's extendedFields-tier fields (tax treatment, tax-exempt flag,
 * issue number, coupon rate, auction/value dates — the ones Slice 8g-2 made
 * persist) had nowhere to be seen cleanly after approval, only as raw
 * `key: value` text in the generic /explore/:ref page's "Full instrument
 * profile" dump. Reads each field's value from the row's typed columns first
 * (tenor/yield/maturity — already reach real columns via buildPromotionPlan),
 * falling back to `extendedFields` for the fields 8g-2 persists there. Labels
 * come directly from the SAME CBK contract (shared/catalogueFieldContracts.ts)
 * every other layer already uses — never a second, hand-typed label copy.
 */
function CbkDetailDrawer({
  row,
  onOpenChange,
  isManager,
  staleByRef,
}: {
  row: Opportunity | null;
  onOpenChange: (open: boolean) => void;
  isManager: boolean;
  staleByRef: Map<string, boolean>;
}) {
  const contract = getCatalogueFieldContract("cbk");
  const fieldByKey = (key: string) => contract?.fields.find((f) => f.key === key);
  const extendedFields = row?.extendedFields as Record<string, unknown> | null | undefined;

  const securityType = row ? readContractFieldValue(extendedFields, fieldByKey("securityType")!) : null;
  const issueNumber = row ? readContractFieldValue(extendedFields, fieldByKey("issueNumber")!) : null;
  const applicationDeadline = row ? readContractFieldValue(extendedFields, fieldByKey("applicationDeadline")!) : null;
  const auctionDate = row ? readContractFieldValue(extendedFields, fieldByKey("auctionDate")!) : null;
  const valueDate = row ? readContractFieldValue(extendedFields, fieldByKey("valueDate")!) : null;
  const couponRate = row ? readContractFieldValue(extendedFields, fieldByKey("couponRate")!) : null;
  const whtRule = row ? readContractFieldValue(extendedFields, fieldByKey("whtRule")!) : null;
  const taxExemptRaw = row ? readContractFieldValue(extendedFields, fieldByKey("taxExempt")!) : null;
  const taxExempt = fmtYesNo(taxExemptRaw);
  const minInvestment = row ? readContractFieldValue(extendedFields, fieldByKey("minInvestment")!) : null;
  // Stage 10b-2b — moved to shared/researchPipeline.ts's cbkNetYieldAfterWht
  // (see its doc comment) so the review queue/approval modal/Ask AI card can
  // reuse the SAME math; null renders as a clean dash, never a guess.
  const netYield = row ? cbkNetYieldAfterWht(row.yieldPct, whtRule, taxExemptRaw) : null;

  const fp = (row?.fieldProvenance ?? {}) as FieldProvenanceMap;
  const catSource = row
    ? resolveCatalogueSource(row.dataSource, row.extendedFields, row.dataAsOf, firstFieldProvenanceSourceUrl(fp))
    : null;

  return (
    <Sheet open={row !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" /> {row.name}
              </SheetTitle>
              <SheetDescription>{profileFor(row.assetClass as AssetClass).label}</SheetDescription>
            </SheetHeader>
            <div className="mt-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <DrawerFact label={fieldByKey("securityType")!.label} value={cbkSecurityTypeLabel(securityType) ?? "—"} />
                <DrawerFact
                  label="Tenor"
                  value={num(row.tenorYears) === null ? "—" : `${Number(row.tenorYears)} yr`}
                />
                <DrawerFact label={fieldByKey("yieldPct")?.label ?? "Yield"} value={fmtPct(row.yieldPct)} />
                <DrawerFact label="Maturity date" value={normalizeDateToYmd(row.maturityDate) ?? "—"} />
              </div>

              <div className="border-t pt-3 grid grid-cols-2 gap-3">
                <DrawerFact label={fieldByKey("whtRule")!.label} value={whtRule ?? "—"} />
                <DrawerFact label={fieldByKey("taxExempt")!.label} value={taxExempt ?? "—"} />
                <DrawerFact
                  label={fieldByKey("netYieldAfterWht")?.label ?? "Net yield after WHT"}
                  value={netYield === null ? "—" : `${netYield.toFixed(2)}%`}
                />
              </div>

              {(applicationDeadline || auctionDate || valueDate) && (
                <div className="border-t pt-3 grid grid-cols-2 gap-3">
                  {applicationDeadline && (
                    <DrawerFact label={fieldByKey("applicationDeadline")!.label} value={normalizeDateToYmd(applicationDeadline) ?? applicationDeadline} />
                  )}
                  {auctionDate && <DrawerFact label={fieldByKey("auctionDate")!.label} value={normalizeDateToYmd(auctionDate) ?? auctionDate} />}
                  {valueDate && <DrawerFact label={fieldByKey("valueDate")!.label} value={normalizeDateToYmd(valueDate) ?? valueDate} />}
                </div>
              )}

              {(issueNumber || couponRate || minInvestment) && (
                <div className="border-t pt-3 grid grid-cols-2 gap-3">
                  {issueNumber && <DrawerFact label={fieldByKey("issueNumber")!.label} value={issueNumber} />}
                  {couponRate && <DrawerFact label={fieldByKey("couponRate")!.label} value={`${couponRate}%`} />}
                  {minInvestment && <DrawerFact label={fieldByKey("minInvestment")!.label} value={minInvestment} />}
                </div>
              )}

              <div className="border-t pt-3">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide mb-1">Source</p>
                {catSource?.label ? (
                  catSource.url ? (
                    <a
                      href={catSource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary underline underline-offset-2 inline-flex items-center gap-1"
                    >
                      {catSource.label} <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : (
                    <p className="text-sm">{catSource.label}</p>
                  )
                ) : (
                  <p className="text-sm text-amber-600 dark:text-amber-400">No source</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {/* Stage 10b-2b — normalizeDateToYmd, not fmtDate: catSource.asOf
                      can be a UTC-anchored Date (DB column) or an ISO string, and
                      fmtDate's local toLocaleDateString reinterpretation risked a
                      day shift for either — the same class of bug Stage 10a-2 fixed
                      for MMF/Bank via formatUtcYmd. */}
                  {catSource?.asOf ? `As of ${normalizeDateToYmd(catSource.asOf) ?? "—"}` : "No as-of date"}
                </p>
              </div>

              {isManager && (
                <div className="border-t pt-4">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                    Manager controls
                  </p>
                  <CatalogueRowControls
                    catalogue="cbk"
                    targetRef={row.ref}
                    instrumentName={row.name}
                    isActive={row.active ?? true}
                    isStale={staleByRef.get(row.ref)}
                    size="sm"
                  />
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
