import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, TrendingUp, BookOpen, AlertTriangle, Info, ChevronDown, ChevronUp } from "lucide-react";
import { formatKES } from "@/lib/format";

const ASSET_CLASSES = [
  { value: "real_estate", label: "Real Estate" },
  { value: "equity", label: "Equities / Stocks" },
  { value: "pension", label: "Pension / NSSF" },
  { value: "sacco", label: "SACCO Shares" },
  { value: "business", label: "Business / Enterprise" },
  { value: "crypto", label: "Crypto / Digital Assets" },
  { value: "insurance", label: "Insurance / Endowment" },
  { value: "other", label: "Other" },
];

const INCOME_TYPES = [
  { value: "dividend", label: "Dividend" },
  { value: "rental", label: "Rental Income" },
  { value: "interest", label: "Interest" },
  { value: "bonus", label: "Bonus / Distribution" },
  { value: "sale", label: "Proceeds from Sale" },
  { value: "other", label: "Other" },
];

// Types matching the router's return shape
type Holding = {
  id: number;
  portfolioId: number;
  assetClass: string;
  name: string;
  description: string | null;
  currentValue: number;
  purchaseValue: number | null;
  purchaseDate: string | null;
  assumedReturnConservative: number | null;
  assumedReturnBase: number | null;
  assumedReturnOptimistic: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type IncomeRecord = {
  id: number;
  holdingId: number;
  amount: number;
  incomeDate: string;
  incomeType: string;
  notes: string | null;
  createdAt: Date;
};

function HoldingFormDialog({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Partial<Holding>;
  onSave: (data: {
    assetClass: string;
    name: string;
    description?: string;
    currentValue: number;
    purchaseValue?: number;
    purchaseDate?: string;
    assumedReturnConservative?: number;
    assumedReturnBase?: number;
    assumedReturnOptimistic?: number;
    notes?: string;
  }) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    assetClass: initial?.assetClass ?? "real_estate",
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    currentValue: String(initial?.currentValue ?? ""),
    purchaseValue: String(initial?.purchaseValue ?? ""),
    purchaseDate: initial?.purchaseDate ?? "",
    assumedReturnConservative: String(initial?.assumedReturnConservative ?? ""),
    assumedReturnBase: String(initial?.assumedReturnBase ?? ""),
    assumedReturnOptimistic: String(initial?.assumedReturnOptimistic ?? ""),
    notes: initial?.notes ?? "",
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("Asset name is required."); return; }
    const currentValue = parseFloat(form.currentValue);
    if (isNaN(currentValue) || currentValue < 0) { toast.error("Current value must be a non-negative number."); return; }
    onSave({
      assetClass: form.assetClass,
      name: form.name.trim(),
      description: form.description || undefined,
      currentValue,
      purchaseValue: form.purchaseValue ? parseFloat(form.purchaseValue) : undefined,
      purchaseDate: form.purchaseDate || undefined,
      assumedReturnConservative: form.assumedReturnConservative ? parseFloat(form.assumedReturnConservative) : undefined,
      assumedReturnBase: form.assumedReturnBase ? parseFloat(form.assumedReturnBase) : undefined,
      assumedReturnOptimistic: form.assumedReturnOptimistic ? parseFloat(form.assumedReturnOptimistic) : undefined,
      notes: form.notes || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Asset" : "Add Asset"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2">
            <Label>Asset Class</Label>
            <Select value={form.assetClass} onValueChange={(v) => setForm((f) => ({ ...f, assetClass: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ASSET_CLASSES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Asset Name *</Label>
            <Input value={form.name} onChange={set("name")} placeholder="e.g. Nairobi Apartment, Safaricom shares" />
          </div>
          <div className="col-span-2">
            <Label>Description</Label>
            <Input value={form.description} onChange={set("description")} placeholder="optional notes" />
          </div>
          <div>
            <Label>Current Value (KES) *</Label>
            <Input type="number" step="1" value={form.currentValue} onChange={set("currentValue")} placeholder="0" />
          </div>
          <div>
            <Label>Purchase Value (KES)</Label>
            <Input type="number" step="1" value={form.purchaseValue} onChange={set("purchaseValue")} placeholder="optional" />
          </div>
          <div>
            <Label>Purchase Date</Label>
            <Input type="date" value={form.purchaseDate} onChange={set("purchaseDate")} />
          </div>
          <div className="col-span-2">
            <Separator className="my-1" />
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              Scenario returns are for planning only — not investment advice. All figures are assumed, not guaranteed.
            </p>
          </div>
          <div>
            <Label>Conservative return (% p.a.)</Label>
            <Input type="number" step="0.1" value={form.assumedReturnConservative} onChange={set("assumedReturnConservative")} placeholder="e.g. 3.0" />
          </div>
          <div>
            <Label>Base return (% p.a.)</Label>
            <Input type="number" step="0.1" value={form.assumedReturnBase} onChange={set("assumedReturnBase")} placeholder="e.g. 6.0" />
          </div>
          <div>
            <Label>Optimistic return (% p.a.)</Label>
            <Input type="number" step="0.1" value={form.assumedReturnOptimistic} onChange={set("assumedReturnOptimistic")} placeholder="e.g. 10.0" />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={set("notes")} placeholder="optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IncomeFormDialog({
  open,
  onClose,
  holdingId,
  portfolioId,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  holdingId: number;
  portfolioId: number;
  onSave: (data: { holdingId: number; portfolioId: number; incomeType: string; amount: number; incomeDate: string; notes?: string }) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    incomeType: "dividend",
    amount: "",
    incomeDate: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = () => {
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) { toast.error("Amount must be a positive number."); return; }
    if (!form.incomeDate) { toast.error("Date is required."); return; }
    onSave({ holdingId, portfolioId, incomeType: form.incomeType, amount, incomeDate: form.incomeDate, notes: form.notes || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Log Income</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Income Type</Label>
            <Select value={form.incomeType} onValueChange={(v) => setForm((f) => ({ ...f, incomeType: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INCOME_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Amount (KES) *</Label>
            <Input type="number" step="1" value={form.amount} onChange={set("amount")} placeholder="0" />
          </div>
          <div>
            <Label>Date Received *</Label>
            <Input type="date" value={form.incomeDate} onChange={set("incomeDate")} />
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={form.notes} onChange={set("notes")} placeholder="optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HoldingCard({
  holding,
  portfolioId,
  horizonYears,
  onEdit,
  onDelete,
}: {
  holding: Holding;
  portfolioId: number;
  horizonYears: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showIncome, setShowIncome] = useState(false);
  const [addIncomeOpen, setAddIncomeOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data: incomeList = [] } = trpc.otherHoldings.listIncome.useQuery(
    { holdingId: holding.id, portfolioId },
    { enabled: showIncome }
  );

  const addIncomeMutation = trpc.otherHoldings.addIncome.useMutation({
    onSuccess: () => {
      utils.otherHoldings.listIncome.invalidate({ holdingId: holding.id, portfolioId });
      utils.otherHoldings.list.invalidate();
      setAddIncomeOpen(false);
      toast.success("Income logged.");
    },
    onError: (e) => toast.error(e.message),
  });

  const assetLabel = ASSET_CLASSES.find((c) => c.value === holding.assetClass)?.label ?? holding.assetClass;
  const gain = holding.purchaseValue != null ? holding.currentValue - holding.purchaseValue : null;
  const gainPct = gain != null && holding.purchaseValue ? (gain / holding.purchaseValue) * 100 : null;

  const totalIncome = incomeList.reduce((sum, i) => sum + i.amount, 0);

  const hasScenarios = holding.assumedReturnConservative != null || holding.assumedReturnBase != null || holding.assumedReturnOptimistic != null;
  const scenarioYears = horizonYears;
  const scenarioYearsLabel = Number.isInteger(scenarioYears) ? `${scenarioYears}` : scenarioYears.toFixed(1);
  const scenarioValue = (rate: number | null) =>
    rate != null ? holding.currentValue * Math.pow(1 + rate / 100, scenarioYears) : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold truncate">{holding.name}</span>
              <Badge variant="outline" className="text-xs shrink-0">{assetLabel}</Badge>
            </div>
            {holding.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{holding.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit}>
              <Pencil className="w-3 h-3" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Current Value</p>
            <p className="font-semibold text-sm">{formatKES(holding.currentValue)}</p>
          </div>
          {holding.purchaseValue != null && (
            <div>
              <p className="text-xs text-muted-foreground">Purchase Value</p>
              <p className="text-sm">{formatKES(holding.purchaseValue)}</p>
            </div>
          )}
          {gain != null && (
            <div>
              <p className="text-xs text-muted-foreground">Unrealised G/L</p>
              <p className={`text-sm font-medium ${gain >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                {gain >= 0 ? "+" : ""}{formatKES(gain)}
                {gainPct != null && <span className="text-xs ml-1">({gainPct >= 0 ? "+" : ""}{gainPct.toFixed(1)}%)</span>}
              </p>
            </div>
          )}
        </div>

        {hasScenarios && (
          <div className="rounded-md bg-muted/40 p-3 space-y-1.5">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              Assumed {scenarioYearsLabel}-year scenario — not a forecast or advice
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {[
                { label: "Conservative", rate: holding.assumedReturnConservative, color: "text-muted-foreground" },
                { label: "Base", rate: holding.assumedReturnBase, color: "text-foreground" },
                { label: "Optimistic", rate: holding.assumedReturnOptimistic, color: "text-emerald-600 dark:text-emerald-400" },
              ].map(({ label, rate, color }) => {
                const val = scenarioValue(rate);
                return (
                  <div key={label} className="text-center">
                    <p className="text-muted-foreground">{label}</p>
                    <p className={`font-medium ${color}`}>
                      {val != null ? formatKES(val) : "—"}
                    </p>
                    {rate != null && <p className="text-muted-foreground">{rate}% p.a.</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Income section */}
        <div>
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowIncome((v) => !v)}
          >
            {showIncome ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Income log {showIncome && incomeList.length > 0 && `(${incomeList.length} entries · ${formatKES(totalIncome)} total)`}
          </button>
          {showIncome && (
            <div className="mt-2 space-y-1.5">
              {incomeList.length === 0 && (
                <p className="text-xs text-muted-foreground">No income logged yet.</p>
              )}
              {incomeList.map((inc) => (
                <div key={inc.id} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                  <div>
                    <span className="font-medium">{INCOME_TYPES.find((t) => t.value === inc.incomeType)?.label ?? inc.incomeType}</span>
                    {inc.notes && <span className="text-muted-foreground ml-1">· {inc.notes}</span>}
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatKES(inc.amount)}</span>
                    <span className="text-muted-foreground ml-2">{inc.incomeDate}</span>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs mt-1"
                onClick={() => setAddIncomeOpen(true)}
              >
                <Plus className="w-3 h-3 mr-1" /> Log Income
              </Button>
            </div>
          )}
        </div>
      </CardContent>

      {addIncomeOpen && (
        <IncomeFormDialog
          open={addIncomeOpen}
          onClose={() => setAddIncomeOpen(false)}
          holdingId={holding.id}
          portfolioId={portfolioId}
          onSave={(data) => addIncomeMutation.mutate(data)}
          saving={addIncomeMutation.isPending}
        />
      )}
    </Card>
  );
}

export default function OtherAssets() {
  const { portfolioId, portfolio } = usePortfolio();
  const portfolioLabel = portfolio?.name?.trim() || "your investment portfolio";
  const utils = trpc.useUtils();

  const { data: holdings = [], isLoading } = trpc.otherHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  const [addOpen, setAddOpen] = useState(false);
  const [editHolding, setEditHolding] = useState<Holding | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const addMutation = trpc.otherHoldings.add.useMutation({
    onSuccess: () => { utils.otherHoldings.list.invalidate(); setAddOpen(false); toast.success("Asset added."); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.otherHoldings.update.useMutation({
    onSuccess: () => { utils.otherHoldings.list.invalidate(); setEditHolding(null); toast.success("Asset updated."); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.otherHoldings.delete.useMutation({
    onSuccess: () => { utils.otherHoldings.list.invalidate(); setDeleteId(null); toast.success("Asset removed."); },
    onError: (e) => toast.error(e.message),
  });

  const totalValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
  const byClass = ASSET_CLASSES.map((c) => ({
    ...c,
    total: holdings.filter((h) => h.assetClass === c.value).reduce((s, h) => s + h.currentValue, 0),
  })).filter((c) => c.total > 0);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Other Assets</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track holdings outside {portfolioLabel} — real estate, equities, pension, SACCO, and more.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} size="sm" disabled={!portfolioId}>
          <Plus className="w-4 h-4 mr-1" /> Add Asset
        </Button>
      </div>

      {/* Education banner */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="py-3 px-4 space-y-1">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Why track other assets here?</p>
          </div>
          <p className="text-xs text-blue-700 dark:text-blue-400 pl-6">
            {portfolioLabel} (T-bills, IFBs, FXDs, MMF) is your liquid, fixed-income savings plan.
            Other assets — property, equities, pension — form the rest of your net worth.
            Tracking them together gives you a complete picture without mixing the projection math.
            Scenario returns entered here are <strong>your own assumptions</strong>, not forecasts.
          </p>
        </CardContent>
      </Card>

      {/* Net worth summary */}
      {holdings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Net Worth Snapshot</CardTitle>
            <CardDescription className="text-xs">Current values as you have entered them — not market-linked or auto-updated.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{formatKES(totalValue)}</span>
              <span className="text-muted-foreground text-sm">total across {holdings.length} holding{holdings.length !== 1 ? "s" : ""}</span>
            </div>
            {byClass.length > 1 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {byClass.map((c) => (
                  <div key={c.value} className="rounded-md bg-muted/40 p-2">
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                    <p className="text-sm font-semibold">{formatKES(c.total)}</p>
                    <p className="text-xs text-muted-foreground">{((c.total / totalValue) * 100).toFixed(1)}%</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Holdings list */}
      {isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {!isLoading && holdings.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-2">
            <TrendingUp className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">No assets tracked yet.</p>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> Add your first asset
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        {holdings.map((h) => (
          <HoldingCard
            key={h.id}
            holding={h}
            portfolioId={portfolioId!}
            horizonYears={(portfolio?.horizonMonths ?? 120) / 12}
            onEdit={() => setEditHolding(h)}
            onDelete={() => setDeleteId(h.id)}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground flex items-start gap-1">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        All values are entered manually and are not connected to live market data.
        Scenario projections use simple compound interest on your entered return assumptions.
        Nothing here constitutes financial advice.
      </p>

      {/* Add dialog */}
      {addOpen && portfolioId && (
        <HoldingFormDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onSave={(data) => addMutation.mutate({ portfolioId, ...data, assetClass: data.assetClass as "real_estate" | "equity" | "etf" | "pension" | "sacco" | "business" | "crypto" | "insurance" | "other" })}
          saving={addMutation.isPending}
        />
      )}

      {/* Edit dialog */}
      {editHolding && portfolioId && (
        <HoldingFormDialog
          open={!!editHolding}
          onClose={() => setEditHolding(null)}
          initial={editHolding}
          onSave={(data) => updateMutation.mutate({ id: editHolding.id, portfolioId, ...data })}
          saving={updateMutation.isPending}
        />
      )}

      {/* Delete confirm */}
      <Dialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Asset?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the asset and all its income records.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId !== null && portfolioId && deleteMutation.mutate({ id: deleteId, portfolioId })}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
