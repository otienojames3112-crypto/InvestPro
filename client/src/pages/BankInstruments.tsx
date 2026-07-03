import { useMemo, useState, useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { useRefFocus } from "@/hooks/useRefFocus";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  Landmark,
  Plus,
  Info,
  Search,
  X,
  ExternalLink,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react";
import { useDepositDrawer } from "@/contexts/DepositDrawerContext";
import { CatalogueRowControls } from "@/components/CatalogueRowControls";
import { CatalogueSourceReviewButton } from "@/components/CatalogueSourceReview";
import { AiExplainDialog } from "@/components/AiExplainDialog";
import { Sparkles } from "lucide-react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { ArchivedRowsPanel, CatalogueScopeFilter, type CatalogueRowScope } from "@/components/ArchivedRowsPanel";

type BankInstrumentType =
  | "call_deposit"
  | "fixed_deposit"
  | "ordinary_savings"
  | "target_savings"
  | "tiered_savings";

const TYPE_LABEL: Record<BankInstrumentType, string> = {
  fixed_deposit: "Fixed deposit",
  call_deposit: "Call deposit",
  ordinary_savings: "Ordinary savings",
  target_savings: "Target savings",
  tiered_savings: "Tiered savings",
};

const TYPE_LIQUIDITY: Record<BankInstrumentType, string> = {
  fixed_deposit: "Locked for the tenor; early break usually forfeits interest.",
  call_deposit: "Instant access; fully liquid — closest bank equivalent to an MMF.",
  ordinary_savings: "Instant or near-instant access; variable rate.",
  target_savings: "Locked for a chosen period; early break usually carries a penalty.",
  tiered_savings: "Rate rises with the balance band; needs a larger minimum for the top tier.",
};

interface BankRow {
  id: number;
  bankName: string;
  instrumentType: BankInstrumentType;
  minAmount: number;
  typicalTenor: string | null;
  indicativeRate: number | null;
  isNegotiable: boolean;
  notes: string | null;
  asOfDate: string | Date | null;
  source: string | null;
  isActive: boolean;
  extendedFields: Record<string, unknown> | null; // widened from InstrumentProfile for rendering
}

function kes(n: number): string {
  return n.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function asOfLabel(d: string | Date | null): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
}

const EMPTY = {
  id: 0,
  bankName: "",
  instrumentType: "fixed_deposit" as BankInstrumentType,
  minAmount: "0",
  typicalTenor: "",
  indicativeRate: "",
  isNegotiable: true,
  notes: "",
  source: "",
  reason: "",
};

export default function BankInstruments({ embedded = false }: { embedded?: boolean } = {}) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { openDrawer } = useDepositDrawer();
  const { portfolioId } = usePortfolio();
  const isManager = user?.role === "admin";

  const { data: rows, isLoading } = trpc.bankInstruments.list.useQuery();
  const { data: metaData } = trpc.catalogue.rowMeta.useQuery(
    { catalogue: "bank" },
    { enabled: isManager },
  );
  const staleByRef = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const row of Object.values(metaData?.meta ?? {})) m.set(row.targetRef, !!row.stale);
    return m;
  }, [metaData]);

  const refFocus = useRefFocus();

  // Filters (search prefilled from a deep-link ?ref= so the row is easy to spot).
  // Round 90: bank rows are keyed by the stable `bank:<id>` ref, which is NOT a
  // human-readable name — so never prefill it into the free-text search (the row is
  // still scrolled-to + highlighted via refFocus.registerRow). Only prefill a plain
  // name/text ref.
  const [search, setSearch] = useState(() =>
    refFocus.focusRef && !/^bank:\d+$/.test(refFocus.focusRef) ? refFocus.focusRef : "",
  );

  // Round 86: drop a stale foreign ?ref= (and its prefill) once rows load, so a ref
  // from another catalogue can't filter this one down to nothing.
  useEffect(() => {
    if (isLoading || !refFocus.focusRef) return;
    refFocus.clearIfMissing(
      (rows ?? []).map((r) => `bank:${r.id}`),
      () => setSearch((s) => (s === refFocus.focusRef ? "" : s)),
    );
  }, [isLoading, rows, refFocus]);
  // Round 90 — manager-only Active/Archived/All view. Non-managers stay on "active".
  const [scope, setScope] = useState<CatalogueRowScope>("active");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [bankFilter, setBankFilter] = useState<string>("all");
  const [rateOnly, setRateOnly] = useState(false);
  const [negotiableOnly, setNegotiableOnly] = useState(false);

  // Detail drawer + governed edit dialog
  const [drawerRow, setDrawerRow] = useState<BankRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });
  const [catExplainOpen, setCatExplainOpen] = useState(false);

  const add = trpc.bankInstruments.add.useMutation({
    onSuccess: () => {
      utils.bankInstruments.list.invalidate();
      setEditOpen(false);
      toast.success("Correction recorded in the Bank Product Catalogue.");
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.bankInstruments.update.useMutation({
    onSuccess: () => {
      utils.bankInstruments.list.invalidate();
      setEditOpen(false);
      toast.success("Correction recorded in the Bank Product Catalogue.");
    },
    onError: (e) => toast.error(e.message),
  });

  const banks = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows ?? []) set.add(r.bankName);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) => {
      if (typeFilter !== "all" && r.instrumentType !== typeFilter) return false;
      if (bankFilter !== "all" && r.bankName !== bankFilter) return false;
      if (rateOnly && r.indicativeRate === null) return false;
      if (negotiableOnly && !r.isNegotiable) return false;
      if (q) {
        const hay = `${r.bankName} ${TYPE_LABEL[r.instrumentType]} ${r.notes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, typeFilter, bankFilter, rateOnly, negotiableOnly]);

  const activeFilters =
    (typeFilter !== "all" ? 1 : 0) +
    (bankFilter !== "all" ? 1 : 0) +
    (rateOnly ? 1 : 0) +
    (negotiableOnly ? 1 : 0) +
    (search.trim() ? 1 : 0);

  const catFacts = useMemo(() => {
    const l: string[] = [`Catalogue: Bank Product Catalogue. ${filtered.length} products shown (${(rows ?? []).length} total).`];
    const bankNames = banks.slice(0, 5).join(", ");
    if (bankNames) l.push(`Banks represented: ${bankNames}${banks.length > 5 ? ` and ${banks.length - 5} more` : ""}.`);
    return l.join("\n");
  }, [filtered, rows, banks]);
  const catExplainQuery = trpc.aiExplain.referenceCatalogue.useQuery(
    { portfolioId: portfolioId!, catalogueSummary: catFacts },
    { enabled: catExplainOpen && !!portfolioId, refetchOnWindowFocus: false, retry: false },
  );

  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setBankFilter("all");
    setRateOnly(false);
    setNegotiableOnly(false);
  }

  function openAdd() {
    setForm({ ...EMPTY });
    setEditOpen(true);
  }
  function openEdit(r: BankRow) {
    setForm({
      id: r.id,
      bankName: r.bankName,
      instrumentType: r.instrumentType,
      minAmount: String(r.minAmount),
      typicalTenor: r.typicalTenor ?? "",
      indicativeRate: r.indicativeRate === null ? "" : String(r.indicativeRate),
      isNegotiable: r.isNegotiable,
      notes: r.notes ?? "",
      source: r.source ?? "",
      reason: "",
    });
    setEditOpen(true);
  }

  function save() {
    if (!form.bankName.trim()) {
      toast.error("Bank name is required.");
      return;
    }
    if (!form.source.trim()) {
      toast.error("A source is required for a governed reference correction.");
      return;
    }
    const payload = {
      bankName: form.bankName.trim(),
      instrumentType: form.instrumentType,
      minAmount: Number(form.minAmount) || 0,
      typicalTenor: form.typicalTenor || undefined,
      indicativeRate: form.indicativeRate === "" ? undefined : Number(form.indicativeRate),
      isNegotiable: form.isNegotiable,
      notes: form.notes || undefined,
      source: form.source.trim(),
    };
    if (form.id) update.mutate({ id: form.id, ...payload });
    else add.mutate(payload);
  }

  return (
    <AppShell embedded={embedded}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-primary" />
              <h1 className="text-2xl font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>
                Bank Product Catalogue
              </h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-3xl">
              A neutral reference of Kenyan bank deposit and savings products. Posted rates are indicative and almost
              always <strong>negotiable</strong> for larger balances — a starting point for your own rate conversation,
              not a recommendation. Recording a real deposit happens in Holdings.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCatExplainOpen(true)}
              className="h-7 gap-1.5 text-xs font-medium hover:text-violet-500 hover:border-violet-500/40 active:scale-[0.97] transition-transform"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Explain catalogue
            </Button>
            {isManager && (
              <>
                <CatalogueSourceReviewButton catalogue="bank" isManager={isManager} size="default" />
                <Button onClick={openAdd}>
                  <Plus className="w-4 h-4 mr-2" /> Add / correct product
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="py-4 space-y-3">
            <div className="flex flex-col lg:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search bank or product…"
                  className="pl-9"
                />
              </div>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="lg:w-52"><SelectValue placeholder="Product type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All product types</SelectItem>
                  {(Object.keys(TYPE_LABEL) as BankInstrumentType[]).map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={bankFilter} onValueChange={setBankFilter}>
                <SelectTrigger className="lg:w-44"><SelectValue placeholder="Bank" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All banks</SelectItem>
                  {banks.map((b) => (
                    <SelectItem key={b} value={b}>{b}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-5 flex-wrap">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Switch checked={rateOnly} onCheckedChange={setRateOnly} />
                Rate available only
              </label>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <Switch checked={negotiableOnly} onCheckedChange={setNegotiableOnly} />
                Negotiable only
              </label>
              {activeFilters > 0 && (
                <Button variant="ghost" size="sm" onClick={clearFilters}>
                  <X className="w-3.5 h-3.5 mr-1" /> Clear filters
                </Button>
              )}
              <div className="ml-auto">
                <CatalogueScopeFilter value={scope} onChange={setScope} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Archived rows (manager-only, when viewing Archived or All) */}
        {isManager && scope !== "active" && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="text-sm font-medium">Archived bank products</div>
              <ArchivedRowsPanel catalogue="bank" />
            </CardContent>
          </Card>
        )}

        {/* Compact table */}
        {scope !== "archived" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {isLoading ? "Loading…" : `${filtered.length} product${filtered.length === 1 ? "" : "s"}`}
            </CardTitle>
            <CardDescription>Click any row for the full detail and safe next steps.</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-56 w-full rounded-lg" />
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No products match these filters.</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Bank</TableHead>
                      <TableHead>Product / type</TableHead>
                      <TableHead className="text-right">Min amount</TableHead>
                      <TableHead>Tenor / notice</TableHead>
                      <TableHead className="text-right">Indic. rate</TableHead>
                      <TableHead>Negotiable</TableHead>
                      <TableHead>As of</TableHead>
                      {isManager && <TableHead className="w-12" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => {
                      // Round 90 — lifecycle + focus key off the STABLE per-product ref
                      // `bank:<id>`, never the shared bank name, so two products at the same
                      // bank never collide.
                      const bankRef = `bank:${r.id}`;
                      const stale = staleByRef.get(bankRef);
                      return (
                        <TableRow
                          key={r.id}
                          ref={refFocus.registerRow(bankRef)}
                          data-ref={bankRef}
                          className={`cursor-pointer ${refFocus.isFocused(bankRef) ? "bg-primary/5" : ""}`}
                          onClick={() => setDrawerRow({ ...r, extendedFields: r.extendedFields as Record<string, unknown> | null })}
                        >
                          <TableCell>
                            <div className="font-medium flex items-center gap-1.5">
                              {r.bankName}
                              {!r.isActive && <Badge variant="outline" className="text-[10px]">Archived</Badge>}
                              {stale && (
                                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                                  <AlertTriangle className="w-2.5 h-2.5 mr-0.5" /> Stale
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className="text-[10px] font-normal">
                              {TYPE_LABEL[r.instrumentType]}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{kes(r.minAmount)}</TableCell>
                          <TableCell>{r.typicalTenor ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.indicativeRate === null ? (
                              <span className="text-muted-foreground">Rate unavailable</span>
                            ) : (
                              `${r.indicativeRate.toFixed(2)}%`
                            )}
                          </TableCell>
                          <TableCell>
                            {r.isNegotiable ? (
                              <Badge variant="secondary" className="text-[10px]">Negotiable</Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px]">Fixed</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{asOfLabel(r.asOfDate)}</TableCell>
                          {isManager && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <CatalogueRowControls
                                catalogue="bank"
                                targetRef={bankRef}
                                instrumentName={`${r.bankName} · ${TYPE_LABEL[r.instrumentType]}`}
                                isActive={r.isActive}
                                isStale={stale}
                              />
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        )}

        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Interest on bank deposits is subject to 15% withholding tax (final tax), same as MMF interest. This is
          reference data — it never affects portfolio math until you record an actual deposit in Holdings.
        </p>
      </div>

      {/* Detail drawer */}
      <Sheet open={drawerRow !== null} onOpenChange={(o) => !o && setDrawerRow(null)}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {drawerRow && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Landmark className="w-4 h-4 text-primary" /> {drawerRow.bankName}
                </SheetTitle>
                <SheetDescription>{TYPE_LABEL[drawerRow.instrumentType]}</SheetDescription>
              </SheetHeader>
              <div className="mt-5 space-y-4">
                <DrawerFact label="How it works" value={TYPE_LIQUIDITY[drawerRow.instrumentType]} />
                <div className="grid grid-cols-2 gap-3">
                  <DrawerFact
                    label="Indicative rate"
                    value={drawerRow.indicativeRate === null ? "Rate unavailable" : `${drawerRow.indicativeRate.toFixed(2)}%`}
                  />
                  <DrawerFact label="Negotiable" value={drawerRow.isNegotiable ? "Yes — for larger balances" : "No"} />
                  <DrawerFact label="Minimum" value={kes(drawerRow.minAmount)} />
                  <DrawerFact label="Tenor / notice" value={drawerRow.typicalTenor ?? "—"} />
                </div>
                {drawerRow.notes && <DrawerFact label="Notes" value={drawerRow.notes} />}
                <div className="grid grid-cols-2 gap-3">
                  <DrawerFact label="Source" value={drawerRow.source ?? "—"} />
                  <DrawerFact label="As of" value={asOfLabel(drawerRow.asOfDate)} />
                </div>

                {/* Round 97 — Extended profile fields from structured extraction */}
                {drawerRow.extendedFields && Object.keys(drawerRow.extendedFields).length > 0 && (
                  <div className="border-t pt-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Full profile</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      {Object.entries(drawerRow.extendedFields)
                        .filter(([k]) => !k.startsWith("_") && k !== "catalogueType" && k !== "instrumentName" && k !== "sourceClass")
                        .map(([k, v]) => (
                          <div key={k} className="text-sm">
                            <span className="text-muted-foreground text-xs">{k}: </span>
                            {String(v) === "missing_from_source" ? (
                              <span className="italic text-amber-600 text-xs">Missing from source</span>
                            ) : (
                              <span className="font-medium">{String(v)}</span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* Safe actions — never "invest now" / "recommended".
                    Round 93: opening a deposit now goes through the confirm-first
                    DepositDrawer (seeded from this catalogue row) instead of the
                    old invalid /holdings/bank deep-link. Nothing is written until
                    the user confirms amount / rate / start / tenor in the drawer,
                    and the created holding links back to this row via
                    bankInstrumentId. */}
                <div className="border-t pt-4 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Next steps</p>
                  <Button
                    className="w-full justify-start"
                    variant="outline"
                    onClick={() => {
                      const r = drawerRow;
                      setDrawerRow(null);
                      // Round 99: extract richer terms from extendedFields for snapshot
                      const ext = r.extendedFields as Record<string, unknown> | null;
                      const pfVal = (k: string): unknown => {
                        const v = ext?.[k];
                        if (v == null) return undefined;
                        if (typeof v === "object" && !Array.isArray(v) && "value" in (v as Record<string, unknown>)) return (v as { value: unknown }).value;
                        return v;
                      };
                      openDrawer({
                        kind: "bank",
                        bankInstrumentId: r.id,
                        bankName: r.bankName,
                        instrumentType: r.instrumentType,
                        indicativeRate: r.indicativeRate,
                        typicalTenor: r.typicalTenor,
                        minAmount: r.minAmount,
                        source: r.source,
                        asOfDate: typeof r.asOfDate === "string" ? r.asOfDate : r.asOfDate ? r.asOfDate.toISOString().slice(0, 10) : null,
                        // Round 99: additional catalogue terms
                        whtRate: (pfVal("whtRate") as number) ?? null,
                        payoutFrequency: (pfVal("payoutFrequency") as "maturity" | "monthly" | "quarterly" | "on_call") ?? null,
                        earlyWithdrawalPenalty: (pfVal("earlyWithdrawalPenalty") as number) ?? null,
                        noticePeriod: (pfVal("noticePeriod") as string) ?? null,
                      });
                    }}
                  >
                    Record a deposit into this product
                  </Button>
                  <p className="text-[11px] text-muted-foreground pt-1">
                    Indicative reference only. This opens the deposit drawer pre-filled from this row — you still confirm
                    the current rate, amount and terms (negotiate directly with the bank) before any holding is created.
                  </p>
                </div>

                {isManager && (
                  <div className="border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                      Manager controls
                    </p>
                    <div className="flex items-center gap-2">
                      <Button size="sm" variant="outline" className="bg-background" onClick={() => { const r = drawerRow; setDrawerRow(null); openEdit(r); }}>
                        Edit / correct
                      </Button>
                      <CatalogueRowControls
                        catalogue="bank"
                        targetRef={`bank:${drawerRow.id}`}
                        instrumentName={`${drawerRow.bankName} · ${TYPE_LABEL[drawerRow.instrumentType]}`}
                        isActive={drawerRow.isActive}
                        isStale={staleByRef.get(`bank:${drawerRow.id}`)}
                        size="sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Governed add / correct dialog (manager-only, source required) */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" />
              {form.id ? "Correct bank product" : "Add bank product"}
            </DialogTitle>
            <DialogDescription>
              A source-backed manager correction to global reference data. It is recorded with your name; a source is
              required.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Bank name</Label>
                <Input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="e.g. Equity Bank" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select value={form.instrumentType} onValueChange={(v) => setForm((f) => ({ ...f, instrumentType: v as BankInstrumentType }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(TYPE_LABEL) as BankInstrumentType[]).map((t) => (
                      <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Min amount (KES)</Label>
                <Input type="number" value={form.minAmount} onChange={(e) => setForm((f) => ({ ...f, minAmount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Indicative rate (%)</Label>
                <Input type="number" inputMode="decimal" value={form.indicativeRate} onChange={(e) => setForm((f) => ({ ...f, indicativeRate: e.target.value }))} placeholder="leave blank if unavailable" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Typical tenor / notice period</Label>
              <Input value={form.typicalTenor} onChange={(e) => setForm((f) => ({ ...f, typicalTenor: e.target.value }))} placeholder="e.g. 3, 6, 12 months" />
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={form.isNegotiable} onCheckedChange={(v) => setForm((f) => ({ ...f, isNegotiable: v }))} />
              <Label className="text-xs">Rate is negotiable for larger balances</Label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Source (URL or note) — required</Label>
              <Input value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} placeholder="e.g. bank product page URL, factsheet date" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={form.notes} rows={2} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="bg-background" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={add.isPending || update.isPending}>
              {add.isPending || update.isPending ? "Saving…" : "Save correction"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AiExplainDialog
        open={catExplainOpen}
        onOpenChange={setCatExplainOpen}
        title="Explain Bank Product Catalogue"
        description="A plain-language explanation of how the Bank Product Catalogue works, what the key terms mean (indicative rate, tenor, notice period, negotiability, early-withdrawal penalty), and how to evaluate bank deposit products for your plan."
        answer={catExplainQuery.data?.answer}
        isLoading={catExplainQuery.isLoading || catExplainQuery.isFetching}
        isError={catExplainQuery.isError}
        errorMessage={catExplainQuery.error?.message}
        onRetry={() => catExplainQuery.refetch()}
      />
    </AppShell>
  );
}

function DrawerFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}
