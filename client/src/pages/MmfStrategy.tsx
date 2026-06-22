import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { useSelectedFund } from "@/hooks/useSelectedFund";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  PieChart,
  Pencil,
  Landmark,
  Building2,
  Banknote,
  Globe,
  Wallet,
  Info,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Pin,
} from "lucide-react";

interface CompositionRow {
  id: number;
  mmfFundId: number;
  govSecurities: number;
  govTbills: number;
  govTbonds: number;
  govIfb: number;
  bankInstruments: number;
  corporateDebt: number;
  cashEquivalents: number;
  offshoreRegional: number;
  realEstate: number;
  otherAssets: number;
  bankNote: string | null;
  corporateNote: string | null;
  cashNote: string | null;
  offshoreNote: string | null;
  realEstateNote: string | null;
  otherNote: string | null;
  notes: string | null;
  asOfDate: string | Date | null;
  source: string | null;
  isEstimate: boolean;
  fundName: string;
  company: string;
  ear: number;
  grossYield: number;
  managementFee: number;
}

const GOV_SUB = [
  { key: "govTbills", label: "T-Bills" },
  { key: "govTbonds", label: "T-Bonds" },
  { key: "govIfb", label: "IFB" },
] as const;

const SEGMENTS = [
  { key: "govSecurities", label: "Government Securities", icon: Landmark, color: "bg-emerald-500" },
  { key: "bankInstruments", label: "Bank Deposits & CDs", icon: Banknote, color: "bg-sky-500" },
  { key: "corporateDebt", label: "Corporate Debt / CP", icon: Building2, color: "bg-amber-500" },
  { key: "cashEquivalents", label: "Cash & Equivalents", icon: Wallet, color: "bg-violet-500" },
  { key: "offshoreRegional", label: "Offshore / Regional", icon: Globe, color: "bg-rose-500" },
  { key: "realEstate", label: "Real Estate / Property", icon: Building2, color: "bg-orange-600" },
  { key: "otherAssets", label: "Other", icon: Wallet, color: "bg-slate-500" },
] as const;

// Maps each allocation segment to its detail-note field for the per-segment readout.
const SEGMENT_NOTES = [
  { key: "bankInstruments", noteKey: "bankNote", label: "Bank Deposits & CDs", icon: Banknote, color: "text-sky-600 dark:text-sky-400", bg: "border-sky-500/20 bg-sky-500/5" },
  { key: "corporateDebt", noteKey: "corporateNote", label: "Corporate Debt / Commercial Paper", icon: Building2, color: "text-amber-600 dark:text-amber-400", bg: "border-amber-500/20 bg-amber-500/5" },
  { key: "cashEquivalents", noteKey: "cashNote", label: "Cash & Equivalents", icon: Wallet, color: "text-violet-600 dark:text-violet-400", bg: "border-violet-500/20 bg-violet-500/5" },
  { key: "offshoreRegional", noteKey: "offshoreNote", label: "Offshore / Regional", icon: Globe, color: "text-rose-600 dark:text-rose-400", bg: "border-rose-500/20 bg-rose-500/5" },
  { key: "realEstate", noteKey: "realEstateNote", label: "Real Estate / Property", icon: Building2, color: "text-orange-600 dark:text-orange-400", bg: "border-orange-500/20 bg-orange-500/5" },
  { key: "otherAssets", noteKey: "otherNote", label: "Other Assets", icon: Wallet, color: "text-slate-600 dark:text-slate-400", bg: "border-slate-500/20 bg-slate-500/5" },
] as const;

function AllocationBar({ row, className = "h-3" }: { row: CompositionRow; className?: string }) {
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-muted ${className}`}>
      {SEGMENTS.map((s) => {
        const v = row[s.key] as number;
        if (v <= 0) return null;
        return (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${v}%` }}
            title={`${s.label}: ${v}%`}
          />
        );
      })}
    </div>
  );
}

// Compact label for the single largest allocation segment, for the table row summary.
function topSegment(row: CompositionRow) {
  let best: { label: string; v: number } | null = null;
  for (const s of SEGMENTS) {
    const v = row[s.key] as number;
    if (v > 0 && (!best || v > best.v)) best = { label: s.label, v };
  }
  return best;
}

type SortKey = "ear" | "grossYield" | "managementFee" | "fundName";

// Expanded detail row content for a single fund composition (progressive disclosure).
function CompositionDetail({ row, onEdit }: { row: CompositionRow; onEdit: () => void }) {
  return (
    <div className="px-4 py-4 space-y-4">
      {/* Full-width allocation bar with per-segment percentages */}
      <div className="space-y-2">
        <AllocationBar row={row} className="h-3" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
          {SEGMENTS.map((s) => {
            const v = row[s.key] as number;
            if (v <= 0) return null;
            return (
              <div key={s.key} className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-sm ${s.color}`} />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums">{v}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Yield + fee summary chips */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-md border border-border bg-background px-2 py-1">
          Net EAR <strong className="text-primary tabular-nums">{row.ear.toFixed(2)}%</strong>
        </span>
        <span className="rounded-md border border-border bg-background px-2 py-1">
          Gross <strong className="tabular-nums">{row.grossYield.toFixed(2)}%</strong>
        </span>
        <span className="rounded-md border border-border bg-background px-2 py-1">
          Mgmt fee <strong className="tabular-nums">{row.managementFee.toFixed(2)}%</strong>
        </span>
      </div>

      {/* Government securities breakdown */}
      {row.govSecurities > 0 && (row.govTbills > 0 || row.govTbonds > 0 || row.govIfb > 0) && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Landmark className="w-3 h-3" />
            Government Securities breakdown ({row.govSecurities}% of fund)
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div className="flex flex-col">
              <span className="font-semibold tabular-nums text-foreground">{row.govTbills}%</span>
              <span className="text-muted-foreground">Treasury Bills</span>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold tabular-nums text-foreground">{row.govTbonds}%</span>
              <span className="text-muted-foreground">Treasury Bonds (FXD)</span>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold tabular-nums text-foreground">{row.govIfb}%</span>
              <span className="text-muted-foreground">Infrastructure (IFB)</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground/80 pt-0.5">
            Percentages are of the whole fund. T-bills dominate the short end; IFB coupons are tax-exempt.
          </p>
        </div>
      )}

      {/* Per-segment detail notes */}
      {SEGMENT_NOTES.some((s) => (row[s.key] as number) > 0 && row[s.noteKey]) && (
        <div className="grid sm:grid-cols-2 gap-2">
          {SEGMENT_NOTES.map((s) => {
            const pct = row[s.key] as number;
            const note = row[s.noteKey] as string | null;
            if (pct <= 0 || !note) return null;
            const Icon = s.icon;
            return (
              <div key={s.key} className={`rounded-lg border p-2.5 ${s.bg}`}>
                <div className={`flex items-center gap-1.5 text-xs font-medium ${s.color}`}>
                  <Icon className="w-3 h-3" />
                  {s.label} ({pct}% of fund)
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{note}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Real estate note shown even at 0% to clarify MMFs cannot hold property */}
      {row.realEstate === 0 && row.realEstateNote && (
        <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-orange-600 dark:text-orange-400">
            <Building2 className="w-3 h-3" />
            Real Estate / Property (0%)
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{row.realEstateNote}</p>
        </div>
      )}

      {row.notes && (
        <p className="text-xs text-muted-foreground border-t pt-2">{row.notes}</p>
      )}

      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t">
        <span>{row.source ? `Source: ${row.source}` : row.isEstimate ? "Estimated from fund mandate" : "From published factsheet"}</span>
        <button onClick={onEdit} className="hover:text-foreground flex items-center gap-1">
          <Pencil className="w-3 h-3" /> Edit
        </button>
      </div>
    </div>
  );
}

export default function MmfStrategy() {
  const fund = useSelectedFund();
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.mmfComposition.list.useQuery();
  const { data: funds } = trpc.mmfFunds.list.useQuery();

  const [editOpen, setEditOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("ear");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [form, setForm] = useState({
    mmfFundId: 0,
    govSecurities: "0",
    govTbills: "0",
    govTbonds: "0",
    govIfb: "0",
    bankInstruments: "0",
    corporateDebt: "0",
    cashEquivalents: "0",
    offshoreRegional: "0",
    realEstate: "0",
    otherAssets: "0",
    bankNote: "",
    corporateNote: "",
    cashNote: "",
    offshoreNote: "",
    realEstateNote: "",
    otherNote: "",
    notes: "",
    source: "",
    isEstimate: true,
  });

  const upsert = trpc.mmfComposition.upsert.useMutation({
    onSuccess: () => {
      utils.mmfComposition.list.invalidate();
      setEditOpen(false);
      toast.success("Composition saved");
    },
    onError: (e) => toast.error(e.message),
  });

  // Sort by the chosen column, then always float the user's selected fund to
  // the very top so it is easy to locate when comparing.
  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    list.sort((a, b) => {
      let cmp: number;
      if (sortKey === "fundName") cmp = a.fundName.localeCompare(b.fundName);
      else cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    list.sort((a, b) => {
      const aSel = a.mmfFundId === fund.fundId ? 0 : 1;
      const bSel = b.mmfFundId === fund.fundId ? 0 : 1;
      return aSel - bSel;
    });
    return list;
  }, [rows, sortKey, sortDir, fund.fundId]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "fundName" ? "asc" : "desc");
    }
  }

  const govSubTotal =
    Number(form.govTbills) + Number(form.govTbonds) + Number(form.govIfb);

  const formTotal =
    Number(form.govSecurities) +
    Number(form.bankInstruments) +
    Number(form.corporateDebt) +
    Number(form.cashEquivalents) +
    Number(form.offshoreRegional) +
    Number(form.realEstate) +
    Number(form.otherAssets);

  function openEdit(row?: CompositionRow) {
    if (row) {
      setForm({
        mmfFundId: row.mmfFundId,
        govSecurities: String(row.govSecurities),
        govTbills: String(row.govTbills),
        govTbonds: String(row.govTbonds),
        govIfb: String(row.govIfb),
        bankInstruments: String(row.bankInstruments),
        corporateDebt: String(row.corporateDebt),
        cashEquivalents: String(row.cashEquivalents),
        offshoreRegional: String(row.offshoreRegional),
        realEstate: String(row.realEstate),
        otherAssets: String(row.otherAssets),
        bankNote: row.bankNote ?? "",
        corporateNote: row.corporateNote ?? "",
        cashNote: row.cashNote ?? "",
        offshoreNote: row.offshoreNote ?? "",
        realEstateNote: row.realEstateNote ?? "",
        otherNote: row.otherNote ?? "",
        notes: row.notes ?? "",
        source: row.source ?? "",
        isEstimate: row.isEstimate,
      });
    } else {
      setForm({
        mmfFundId: funds?.[0]?.id ?? 0,
        govSecurities: "0",
        govTbills: "0",
        govTbonds: "0",
        govIfb: "0",
        bankInstruments: "0",
        corporateDebt: "0",
        cashEquivalents: "0",
        offshoreRegional: "0",
        realEstate: "0",
        otherAssets: "0",
        bankNote: "",
        corporateNote: "",
        cashNote: "",
        offshoreNote: "",
        realEstateNote: "",
        otherNote: "",
        notes: "",
        source: "",
        isEstimate: true,
      });
    }
    setEditOpen(true);
  }

  function save() {
    if (!form.mmfFundId) {
      toast.error("Select a fund");
      return;
    }
    if (Math.abs(formTotal - 100) > 0.5) {
      toast.error(`Allocations must sum to 100% (currently ${formTotal.toFixed(1)}%)`);
      return;
    }
    if (govSubTotal > 0 && Math.abs(govSubTotal - Number(form.govSecurities)) > 0.5) {
      toast.error(
        `Gov-securities breakdown (${govSubTotal.toFixed(1)}%) must match the Government Securities total (${Number(form.govSecurities).toFixed(1)}%)`
      );
      return;
    }
    upsert.mutate({
      mmfFundId: form.mmfFundId,
      govSecurities: Number(form.govSecurities),
      govTbills: Number(form.govTbills),
      govTbonds: Number(form.govTbonds),
      govIfb: Number(form.govIfb),
      bankInstruments: Number(form.bankInstruments),
      corporateDebt: Number(form.corporateDebt),
      cashEquivalents: Number(form.cashEquivalents),
      offshoreRegional: Number(form.offshoreRegional),
      realEstate: Number(form.realEstate),
      otherAssets: Number(form.otherAssets),
      bankNote: form.bankNote || undefined,
      corporateNote: form.corporateNote || undefined,
      cashNote: form.cashNote || undefined,
      offshoreNote: form.offshoreNote || undefined,
      realEstateNote: form.realEstateNote || undefined,
      otherNote: form.otherNote || undefined,
      notes: form.notes || undefined,
      source: form.source || undefined,
      isEstimate: form.isEstimate,
    });
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <PieChart className="w-5 h-5 text-primary" />
              <h1
                className="text-2xl font-bold"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                MMF Strategy &amp; Composition
              </h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-3xl">
              What each money market fund actually holds. MMFs invest in
              short-term, high-quality instruments — government securities,
              bank deposits, near-cash and short corporate paper. The mix
              explains why yields differ and how much credit/duration risk a
              fund takes to reach its rate.
            </p>
          </div>
          <Button onClick={() => openEdit()} className="shrink-0">
            <Pencil className="w-4 h-4 mr-2" /> Edit Composition
          </Button>
        </div>

        {/* Legend */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-4">
              {SEGMENTS.map((s) => (
                <div key={s.key} className="flex items-center gap-2 text-sm">
                  <span className={`w-3 h-3 rounded-sm ${s.color}`} />
                  <span className="text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Comparison table (default scannable view) */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No composition data yet. Click "Edit Composition" to add one.
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                    <th className="text-left font-medium py-2.5 px-4">
                      <button onClick={() => toggleSort("fundName")} className="inline-flex items-center gap-1 hover:text-foreground">
                        Fund <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </button>
                    </th>
                    <th className="text-right font-medium py-2.5 px-3 whitespace-nowrap">
                      <button onClick={() => toggleSort("ear")} className="inline-flex items-center gap-1 hover:text-foreground">
                        Net EAR <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </button>
                    </th>
                    <th className="text-right font-medium py-2.5 px-3 whitespace-nowrap hidden sm:table-cell">
                      <button onClick={() => toggleSort("grossYield")} className="inline-flex items-center gap-1 hover:text-foreground">
                        Gross <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </button>
                    </th>
                    <th className="text-right font-medium py-2.5 px-3 whitespace-nowrap hidden sm:table-cell">
                      <button onClick={() => toggleSort("managementFee")} className="inline-flex items-center gap-1 hover:text-foreground">
                        Fee <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </button>
                    </th>
                    <th className="text-left font-medium py-2.5 px-3 w-[34%] hidden md:table-cell">Allocation</th>
                    <th className="py-2.5 px-3 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => {
                    const isSelected = row.mmfFundId === fund.fundId;
                    const isOpen = expandedId === row.id;
                    const top = topSegment(row);
                    return (
                      <>
                        <tr
                          key={row.id}
                          onClick={() => setExpandedId(isOpen ? null : row.id)}
                          className={`border-b border-border cursor-pointer transition-colors hover:bg-muted/40 ${isSelected ? "bg-primary/5" : ""}`}
                        >
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-2">
                              {isSelected && <Pin className="w-3 h-3 text-primary shrink-0" />}
                              <div className="min-w-0">
                                <div className="font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                                  <span className="truncate">{row.fundName}</span>
                                  {isSelected && <Badge className="text-[10px]">Your Fund</Badge>}
                                  {row.isEstimate ? (
                                    <Badge variant="outline" className="text-[9px]">Estimate</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[9px]">Factsheet</Badge>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">{row.company}{top ? ` \u00b7 mostly ${top.label} (${top.v}%)` : ""}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-primary tabular-nums whitespace-nowrap">{row.ear.toFixed(2)}%</td>
                          <td className="py-2.5 px-3 text-right text-muted-foreground tabular-nums whitespace-nowrap hidden sm:table-cell">{row.grossYield.toFixed(2)}%</td>
                          <td className="py-2.5 px-3 text-right text-muted-foreground tabular-nums whitespace-nowrap hidden sm:table-cell">{row.managementFee.toFixed(2)}%</td>
                          <td className="py-2.5 px-3 hidden md:table-cell"><AllocationBar row={row} className="h-2.5" /></td>
                          <td className="py-2.5 px-3 text-muted-foreground">{isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border bg-muted/20">
                            <td colSpan={6} className="p-0">
                              <CompositionDetail row={row} onEdit={() => openEdit(row)} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Allocations are drawn from the most recent published fund factsheets
          where available, otherwise estimated from the fund's mandate. All
          values are editable and should be refreshed as new factsheets are
          released.
        </p>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Fund Composition</DialogTitle>
            <DialogDescription>
              Allocations must sum to 100%. Current total:{" "}
              <span
                className={
                  Math.abs(formTotal - 100) > 0.5
                    ? "text-red-500 font-semibold"
                    : "text-primary font-semibold"
                }
              >
                {formTotal.toFixed(1)}%
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Fund</Label>
              <Select
                value={String(form.mmfFundId)}
                onValueChange={(v) => setForm((f) => ({ ...f, mmfFundId: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a fund" />
                </SelectTrigger>
                <SelectContent>
                  {(funds ?? []).map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.fundName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {SEGMENTS.map((s) => (
                <div key={s.key} className="space-y-1.5">
                  <Label className="text-xs">{s.label} (%)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={form[s.key]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [s.key]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            {/* Government Securities sub-breakdown */}
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <Landmark className="w-3 h-3" /> Government Securities breakdown
                </Label>
                <span
                  className={
                    Math.abs(govSubTotal - Number(form.govSecurities)) > 0.5
                      ? "text-[11px] text-red-500 font-semibold"
                      : "text-[11px] text-muted-foreground"
                  }
                >
                  {govSubTotal.toFixed(1)}% / {Number(form.govSecurities).toFixed(1)}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {GOV_SUB.map((s) => (
                  <div key={s.key} className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">{s.label}</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={form[s.key]}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [s.key]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                These three should add up to the Government Securities total above. Percentages are of the whole fund.
              </p>
            </div>
            {/* Per-segment detail notes */}
            <div className="rounded-lg border p-3 space-y-2">
              <Label className="text-xs font-medium">Segment detail notes (holdings + indicative rates)</Label>
              {SEGMENT_NOTES.map((s) => (
                <div key={s.noteKey} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">{s.label}</Label>
                  <Textarea
                    rows={2}
                    value={form[s.noteKey]}
                    onChange={(e) => setForm((f) => ({ ...f, [s.noteKey]: e.target.value }))}
                    placeholder={`e.g. how this fund uses ${s.label.toLowerCase()}`}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Source (URL or note)</Label>
              <Input
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                placeholder="e.g. fund factsheet Q2 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={form.notes}
                rows={2}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={upsert.isPending}>
              {upsert.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
