import { useState } from "react";
import { AppShell } from "@/components/AppShell";
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
import { Plus, Pencil, Trash2, TrendingUp, BookOpen, AlertTriangle, Info, ChevronDown, ChevronUp, LogOut, Sparkles } from "lucide-react";
import { formatKES } from "@/lib/format";

const ASSET_CLASSES = [
  { value: "real_estate", label: "Real Estate" },
  { value: "equity", label: "Equities / Stocks" },
  { value: "etf", label: "ETF / Offshore Fund" },
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
  behaviorClass: string | null;
  name: string;
  description: string | null;
  currentValue: number;
  // Part 5: the single mark-to-model figure every surface shows.
  valueKes: number;
  markToModel: boolean;
  priceDriven: boolean;
  fxExposed: boolean;
  classLabel: string | null;
  incomeType: string | null;
  native: {
    currency: string;
    units: number;
    unitPrice: number;
    amount: number;
    fxRateToKes: number;
  } | null;
  provenance: { source: string | null; asOf: number | null };
  incomeRatePct: number | null;
  purchaseValue: number | null;
  purchaseDate: string | null;
  assumedReturnConservative: number | null;
  assumedReturnBase: number | null;
  assumedReturnOptimistic: number | null;
  // Part 6: effective risk assumption (user edits win, else per-class default).
  risk: {
    expectedReturnPct: number;
    volatilityPct: number;
    correlationGroup: string;
    expectedReturnIsDefault: boolean;
    volatilityIsDefault: boolean;
    correlationGroupIsDefault: boolean;
    source: string | null;
    asOf: number | null;
  } | null;
  notes: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

// A modeled-from-Explore holding stamps a provenance line into notes.
const MODELED_PREFIX = "Modeled from Explore";
function isModeled(h: { notes: string | null }): boolean {
  return !!h.notes && h.notes.startsWith(MODELED_PREFIX);
}

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
    expectedReturnPct?: number;
    volatilityPct?: number;
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
    expectedReturnPct: String(initial?.risk && !initial.risk.expectedReturnIsDefault ? initial.risk.expectedReturnPct : ""),
    volatilityPct: String(initial?.risk && !initial.risk.volatilityIsDefault ? initial.risk.volatilityPct : ""),
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
      expectedReturnPct: form.expectedReturnPct ? parseFloat(form.expectedReturnPct) : undefined,
      volatilityPct: form.volatilityPct ? parseFloat(form.volatilityPct) : undefined,
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
            <Separator className="my-1" />
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-amber-500" />
              Risk assumptions (optional) — used for the goal-probability range. Leave blank to use the per-class default.
            </p>
          </div>
          <div>
            <Label>Expected return (% p.a.)</Label>
            <Input type="number" step="0.1" value={form.expectedReturnPct} onChange={set("expectedReturnPct")} placeholder="class default" />
          </div>
          <div>
            <Label>Volatility (% p.a.)</Label>
            <Input type="number" step="0.1" value={form.volatilityPct} onChange={set("volatilityPct")} placeholder="class default" />
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

function ExitDialog({
  open,
  onClose,
  holding,
  portfolioId,
  onConfirm,
  confirming,
}: {
  open: boolean;
  onClose: () => void;
  holding: Holding;
  portfolioId: number;
  onConfirm: () => void;
  confirming: boolean;
}) {
  // Listed NSE shares are CGT-exempt, so gain tax defaults to none; the user can
  // supply a rate if their instrument is taxable. We never invent a rate.
  const [taxRate, setTaxRate] = useState("");
  const parsedRate = taxRate.trim() === "" ? null : parseFloat(taxRate);
  const { data: exit, isLoading } = trpc.modeling.exitPreview.useQuery(
    {
      portfolioId,
      holdingId: holding.id,
      gainTaxRatePct: parsedRate != null && Number.isFinite(parsedRate) ? parsedRate : null,
    },
    { enabled: open },
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut className="w-4 h-4" /> Record exit — {holding.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <p className="text-xs text-muted-foreground">
            Recording an exit returns the holding’s current value as cash and books the
            realised gain or loss. A loss is simply a negative result — it is never charged
            as a fee or penalty. This removes the holding from your register.
          </p>
          <div>
            <Label>Gain tax rate (% — optional)</Label>
            <Input
              type="number"
              step="0.1"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              placeholder="0 — listed NSE shares are CGT-exempt"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Leave blank for none. Applies only to a positive gain. You supply the rate —
              the tool does not assume one.
            </p>
          </div>
          <div className="rounded-md bg-muted/40 p-3 space-y-1.5 text-sm">
            {isLoading || !exit ? (
              <p className="text-xs text-muted-foreground">Calculating…</p>
            ) : (
              <>
                <Row label="Proceeds (current value)" value={formatKES(exit.proceedsGross)} />
                <Row label="Cost basis" value={formatKES(exit.costBasis)} />
                <Row
                  label="Realised gain / loss"
                  value={`${exit.gainLoss >= 0 ? "+" : ""}${formatKES(exit.gainLoss)}`}
                  emphasis={exit.gainLoss >= 0 ? "pos" : "neg"}
                />
                {exit.taxOnGain > 0 && (
                  <Row label="Tax on gain" value={`-${formatKES(exit.taxOnGain)}`} emphasis="neg" />
                )}
                <Separator className="my-1" />
                <Row label="Net proceeds to cash" value={formatKES(exit.proceedsNet)} strong />
              </>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={confirming}>Cancel</Button>
          <Button onClick={onConfirm} disabled={confirming || isLoading}>
            {confirming ? "Recording…" : "Confirm exit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, emphasis, strong }: { label: string; value: string; emphasis?: "pos" | "neg"; strong?: boolean }) {
  const color = emphasis === "pos" ? "text-emerald-600 dark:text-emerald-400" : emphasis === "neg" ? "text-red-500" : "";
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`${strong ? "font-semibold" : "font-medium"} ${color}`}>{value}</span>
    </div>
  );
}

function HoldingCard({
  holding,
  portfolioId,
  horizonYears,
  onEdit,
  onExit,
  onDelete,
}: {
  holding: Holding;
  portfolioId: number;
  horizonYears: number;
  onEdit: () => void;
  onExit: () => void;
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

  // Part 5: prefer the precise behaviour-class label (Equities / REITs / Offshore)
  // over the coarse register label, and value off the single mark-to-model figure.
  const assetLabel =
    holding.classLabel ?? ASSET_CLASSES.find((c) => c.value === holding.assetClass)?.label ?? holding.assetClass;
  const displayValue = holding.valueKes;
  const gain = holding.purchaseValue != null ? displayValue - holding.purchaseValue : null;
  const gainPct = gain != null && holding.purchaseValue ? (gain / holding.purchaseValue) * 100 : null;

  const totalIncome = incomeList.reduce((sum, i) => sum + i.amount, 0);

  const hasScenarios = holding.assumedReturnConservative != null || holding.assumedReturnBase != null || holding.assumedReturnOptimistic != null;
  const scenarioYears = horizonYears;
  const scenarioYearsLabel = Number.isInteger(scenarioYears) ? `${scenarioYears}` : scenarioYears.toFixed(1);
  const scenarioValue = (rate: number | null) =>
    rate != null ? displayValue * Math.pow(1 + rate / 100, scenarioYears) : null;
  const asOfLabel = holding.provenance.asOf ? new Date(holding.provenance.asOf).toLocaleDateString() : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold truncate">{holding.name}</span>
              <Badge variant="outline" className="text-xs shrink-0">{assetLabel}</Badge>
              {isModeled(holding) && (
                <Badge variant="secondary" className="text-xs shrink-0 gap-1">
                  <Sparkles className="w-3 h-3" /> Modeled from Explore
                </Badge>
              )}
            </div>
            {holding.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{holding.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit} title="Edit">
              <Pencil className="w-3 h-3" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onExit} title="Record exit / disposal">
              <LogOut className="w-3 h-3" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">
              {holding.markToModel ? "Market value (mark-to-model)" : "Current Value"}
            </p>
            <p className="font-semibold text-sm">{formatKES(displayValue)}</p>
            {holding.markToModel && holding.native && (
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {holding.native.units} units × {holding.native.currency} {holding.native.unitPrice}
                {holding.native.fxRateToKes > 0 && (
                  <> @ {holding.native.fxRateToKes} KES/{holding.native.currency}</>
                )}
              </p>
            )}
            {holding.markToModel && holding.native && (
              <p className="text-[11px] text-muted-foreground">
                = {holding.native.currency} {holding.native.amount.toLocaleString()} → {formatKES(displayValue)}
              </p>
            )}
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

        {/* Part 6: assumed return & volatility — an assumption, never a forecast. */}
        {holding.priceDriven && holding.risk && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-1">
            <div className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-400">
              <TrendingUp className="w-3 h-3" /> Assumed risk — a market-priced holding swings
            </div>
            <p className="text-[11px] text-muted-foreground">
              ~{holding.risk.expectedReturnPct}% p.a. expected, typical year ±{holding.risk.volatilityPct}%
              {holding.fxExposed && <> + FX</>}.{" "}
              {holding.risk.volatilityIsDefault && holding.risk.expectedReturnIsDefault
                ? "Default for the class — edit to use your own view."
                : "Your own figures."}
            </p>
          </div>
        )}

        {(holding.provenance.source || asOfLabel) && (
          <p className="text-[11px] text-muted-foreground">
            Source: {holding.provenance.source ?? "manual entry"}
            {asOfLabel && <> · as of {asOfLabel}</>}
          </p>
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
  const [exitHolding, setExitHolding] = useState<Holding | null>(null);

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
  // Exit = realise the holding (return-of-capital). We reuse the existing delete
  // path, which cascades its income records, after the user has seen the realised
  // result in the exit preview.
  const exitMutation = trpc.otherHoldings.delete.useMutation({
    onSuccess: () => { utils.otherHoldings.list.invalidate(); setExitHolding(null); toast.success("Exit recorded — holding realised and removed."); },
    onError: (e) => toast.error(e.message),
  });

  // Part 5: every total/breakdown uses the single mark-to-model figure (valueKes).
  // Price-driven holdings are grouped under their PRECISE class label (Equities /
  // REITs / Offshore); non-price-driven rows keep their register label.
  const totalValue = holdings.reduce((sum, h) => sum + h.valueKes, 0);
  const anyMarkToModel = holdings.some((h) => h.markToModel);
  const classTotals = new Map<string, number>();
  for (const h of holdings) {
    const label =
      (h.priceDriven && h.classLabel) ||
      ASSET_CLASSES.find((c) => c.value === h.assetClass)?.label ||
      h.assetClass;
    classTotals.set(label, (classTotals.get(label) ?? 0) + h.valueKes);
  }
  const byClass = Array.from(classTotals.entries())
    .map(([label, total]) => ({ value: label, label, total }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  return (
    <AppShell>
    <div className="p-6 lg:p-8 space-y-6 max-w-4xl">
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
            Holdings you build with <strong>“Model in my plan”</strong> from Explore land here too, tagged as modeled.
          </p>
        </CardContent>
      </Card>

      {/* Net worth summary */}
      {holdings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Net Worth Snapshot</CardTitle>
            <CardDescription className="text-xs">
              {anyMarkToModel
                ? "Price-driven holdings are marked to model from units × price × FX you entered; others use the value you entered. Not a live market feed."
                : "Current values as you have entered them — not market-linked or auto-updated."}
            </CardDescription>
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
            onExit={() => setExitHolding(h)}
            onDelete={() => setDeleteId(h.id)}
          />
        ))}
      </div>

      {/* Exit / disposal dialog */}
      {exitHolding && portfolioId && (
        <ExitDialog
          open={!!exitHolding}
          onClose={() => setExitHolding(null)}
          holding={exitHolding}
          portfolioId={portfolioId}
          onConfirm={() => exitMutation.mutate({ id: exitHolding.id, portfolioId })}
          confirming={exitMutation.isPending}
        />
      )}

      <p className="text-xs text-muted-foreground flex items-start gap-1">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        Values are either marked to model from the units, price and FX you entered, or the
        amount you entered manually — never a live market feed. Scenario projections use simple
        compound interest on your entered return assumptions. Nothing here constitutes financial advice.
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
    </AppShell>
  );
}
