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
] as const;

function AllocationBar({ row }: { row: CompositionRow }) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
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

export default function MmfStrategy() {
  const fund = useSelectedFund();
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.mmfComposition.list.useQuery();
  const { data: funds } = trpc.mmfFunds.list.useQuery();

  const [editOpen, setEditOpen] = useState(false);
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

  const sorted = useMemo(
    () => [...(rows ?? [])].sort((a, b) => b.ear - a.ear),
    [rows]
  );

  const govSubTotal =
    Number(form.govTbills) + Number(form.govTbonds) + Number(form.govIfb);

  const formTotal =
    Number(form.govSecurities) +
    Number(form.bankInstruments) +
    Number(form.corporateDebt) +
    Number(form.cashEquivalents) +
    Number(form.offshoreRegional);

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

        {/* Composition cards */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No composition data yet. Click "Edit Composition" to add one.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {sorted.map((row) => {
              const isSelected = row.mmfFundId === fund.fundId;
              return (
                <Card
                  key={row.id}
                  className={isSelected ? "border-primary/50 ring-1 ring-primary/20" : ""}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <CardTitle className="text-base flex items-center gap-2">
                          {row.fundName}
                          {isSelected && (
                            <Badge className="text-[10px]">Your Fund</Badge>
                          )}
                        </CardTitle>
                        <CardDescription>{row.company}</CardDescription>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-primary">
                          {row.ear.toFixed(2)}%
                        </p>
                        <p className="text-[10px] text-muted-foreground">net EAR</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <AllocationBar row={row} />
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
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
                    {row.notes && (
                      <p className="text-xs text-muted-foreground border-t pt-2">
                        {row.notes}
                      </p>
                    )}
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
                      <span>
                        {row.isEstimate ? (
                          <Badge variant="outline" className="text-[10px]">
                            Estimate
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-[10px]">
                            From factsheet
                          </Badge>
                        )}
                      </span>
                      <button
                        onClick={() => openEdit(row)}
                        className="hover:text-foreground flex items-center gap-1"
                      >
                        <Pencil className="w-3 h-3" /> Edit
                      </button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
