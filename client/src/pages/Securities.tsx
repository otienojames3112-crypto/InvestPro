import { usePortfolio } from "@/contexts/PortfolioContext";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, formatPct, getSecurityLabel } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Landmark, Plus, Trash2, CheckCircle2, Clock, Pencil, Link2, Info, RefreshCw, Wallet, RotateCcw } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { useForm, Controller } from "react-hook-form";

interface SecurityForm {
  securityType: "tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd";
  faceValue: number;
  issueDate: string;
  maturityDate: string;
  couponRate: number;
  isTaxExempt: boolean;
  notes: string;
}

function daysUntil(dateStr: string | Date): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function nextCouponDate(issueDate: string | Date, maturityDate: string | Date): string {
  const issue = new Date(issueDate);
  const maturity = new Date(maturityDate);
  const now = new Date();
  // Semi-annual coupons: every 6 months from issue
  let next = new Date(issue);
  while (next <= now && next < maturity) {
    next.setMonth(next.getMonth() + 6);
  }
  if (next >= maturity) return "At maturity";
  return next.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export default function Securities() {
  const { portfolioId } = usePortfolio();
  const utils = trpc.useUtils();
  const { data: securities, isLoading } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const addMutation = trpc.securities.add.useMutation({
    onSuccess: () => {
      toast.success("Security added to register");
      utils.securities.list.invalidate();
      setOpen(false);
    },
    onError: () => toast.error("Failed to add security"),
  });
  const deleteMutation = trpc.securities.delete.useMutation({
    onSuccess: () => {
      toast.success("Security removed");
      utils.securities.list.invalidate();
    },
    onError: () => toast.error("Failed to remove security"),
  });
  function invalidateAll() {
    utils.securities.list.invalidate();
    utils.deposits.list.invalidate({ portfolioId: portfolioId! });
    utils.deposits.summary.invalidate({ portfolioId: portfolioId! });
    utils.projection.run.invalidate({ portfolioId: portfolioId! });
    utils.projection.milestones.invalidate({ portfolioId: portfolioId! });
  }
  const updateMutation = trpc.securities.update.useMutation({
    onSuccess: (res) => {
      toast.success(
        res?.linkedDepositSynced
          ? "Security updated — linked deposit synced"
          : "Security updated"
      );
      invalidateAll();
      setEditId(null);
    },
    onError: () => toast.error("Failed to update security"),
  });
  const recycleMutation = trpc.securities.recycle.useMutation({
    onSuccess: (res) => {
      toast.success(
        res?.mode === "mmf"
          ? `Rolled KES ${Math.round(res.amount).toLocaleString()} into your primary MMF`
          : `Re-bought KES ${Math.round(res?.amount ?? 0).toLocaleString()} on rollover`
      );
      invalidateAll();
      setRecycleFor(null);
    },
    onError: () => toast.error("Failed to recycle security"),
  });

  // ── Maturity-recycling prompt state ────────────────────────────────────
  const [recycleFor, setRecycleFor] = useState<NonNullable<typeof securities>[number] | null>(null);

  // Deposits list lets us flag which register rows have a linked deposit that
  // will be synced automatically when the security is edited.
  const { data: depositList } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const linkedSecurityIds = useMemo(
    () =>
      new Set(
        (depositList ?? [])
          .map((d) => (d as { securityId?: number | null }).securityId)
          .filter((id): id is number => typeof id === "number")
      ),
    [depositList]
  );

  // ── Edit dialog state ──────────────────────────────────────────────────
  const [editId, setEditId] = useState<number | null>(null);
  const editForm = useForm<SecurityForm>({
    defaultValues: {
      securityType: "tbill_364",
      faceValue: 50000,
      issueDate: new Date().toISOString().split("T")[0],
      maturityDate: "",
      couponRate: 0,
      isTaxExempt: false,
      notes: "",
    },
  });
  const editType = editForm.watch("securityType");
  const editIsBond = editType === "ifb" || editType === "fxd";

  function openEdit(s: NonNullable<typeof securities>[number]) {
    editForm.reset({
      securityType: s.securityType as SecurityForm["securityType"],
      faceValue: parseFloat(String(s.faceValue)) || 50000,
      issueDate: new Date(s.issueDate).toISOString().split("T")[0],
      maturityDate: new Date(s.maturityDate).toISOString().split("T")[0],
      couponRate: parseFloat(String(s.couponRate)) || 0,
      isTaxExempt: !!s.isTaxExempt,
      notes: s.notes ?? "",
    });
    setEditId(s.id);
  }

  function onEditSubmit(data: SecurityForm) {
    if (editId == null) return;
    updateMutation.mutate({
      id: editId,
      securityType: data.securityType,
      faceValue: data.faceValue,
      issueDate: data.issueDate,
      maturityDate: data.maturityDate,
      couponRate: editIsBond ? data.couponRate : 0,
      isTaxExempt: data.securityType === "ifb" ? true : data.isTaxExempt,
      notes: data.notes,
    });
  }

  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset, control, watch } = useForm<SecurityForm>({
    defaultValues: {
      securityType: "tbill_364",
      faceValue: 50000,
      issueDate: new Date().toISOString().split("T")[0],
      maturityDate: "",
      couponRate: 0,
      isTaxExempt: false,
      notes: "",
    },
  });

  const secType = watch("securityType");
  const isBond = secType === "ifb" || secType === "fxd";

  function onSubmit(data: SecurityForm) {
    if (!portfolioId) return;
      addMutation.mutate({
        portfolioId: portfolioId!,
      ...data,
      couponRate: isBond ? data.couponRate : 0,
      isTaxExempt: secType === "ifb" ? true : data.isTaxExempt,
    });
  }

  // Group by type
  const active = securities?.filter((s) => !s.isMatured) ?? [];
  const matured = securities?.filter((s) => s.isMatured) ?? [];

  const totalFaceValue = active.reduce((sum, s) => sum + parseFloat(String(s.faceValue)), 0);

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              CBK Securities Register
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Track individual T-bill and bond purchases with coupon and maturity schedules
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="w-3.5 h-3.5" />
                Add Security
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add CBK Security</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Security Type</Label>
                  <Controller
                    name="securityType"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tbill_91">91-Day T-Bill</SelectItem>
                          <SelectItem value="tbill_182">182-Day T-Bill</SelectItem>
                          <SelectItem value="tbill_364">364-Day T-Bill</SelectItem>
                          <SelectItem value="ifb">Infrastructure Bond (IFB) — Tax Exempt</SelectItem>
                          <SelectItem value="fxd">Fixed Coupon Bond (FXD) — 15% WHT</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Face Value (KES)</Label>
                    <Input type="number" step="50000" min="50000" {...register("faceValue", { valueAsNumber: true })} />
                  </div>
                  {isBond && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Coupon Rate (%)</Label>
                      <Input type="number" step="0.01" min="0" {...register("couponRate", { valueAsNumber: true })} />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Issue Date</Label>
                    <Input type="date" {...register("issueDate")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Maturity Date</Label>
                    <Input type="date" {...register("maturityDate")} required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Notes (optional)</Label>
                  <Input placeholder="e.g. IFB/2026/10Y" {...register("notes")} />
                </div>
                <Button type="submit" className="w-full" disabled={addMutation.isPending}>
                  {addMutation.isPending ? "Adding..." : "Add to Register"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Active Holdings", value: active.length, suffix: "securities" },
            { label: "Total Face Value", value: formatKES(totalFaceValue), suffix: "" },
            { label: "T-Bills", value: active.filter((s) => s.securityType.startsWith("tbill")).length, suffix: "active" },
            { label: "Bonds (IFB+FXD)", value: active.filter((s) => !s.securityType.startsWith("tbill")).length, suffix: "active" },
          ].map(({ label, value, suffix }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
                <p className="text-xl font-bold text-foreground kes-amount">{value}</p>
                {suffix && <p className="text-xs text-muted-foreground">{suffix}</p>}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Active Securities */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Landmark className="w-4 h-4 text-primary" />
              Active Holdings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : active.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No active securities. Add your first T-bill or bond purchase above.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Type</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Face Value</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Issue Date</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Maturity Date</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Days Left</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Coupon Rate</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Next Coupon</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Tax</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((s) => {
                      const days = daysUntil(s.maturityDate);
                      const isBondType = !s.securityType.startsWith("tbill");
                      return (
                        <tr key={s.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className="text-xs">
                                {getSecurityLabel(s.securityType)}
                              </Badge>
                              {linkedSecurityIds.has(s.id) && (
                                <span title="Linked to a recorded deposit — edits sync automatically">
                                  <Link2 className="w-3 h-3 text-primary/70" />
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-foreground kes-amount">
                            {formatKES(parseFloat(String(s.faceValue)))}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(s.issueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(s.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                            {s.updatedAt && (
                              <span className="block text-[10px] text-muted-foreground/60 mt-0.5">
                                edited {new Date(s.updatedAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {days > 0 ? (
                              <span className={days < 30 ? "text-destructive font-semibold" : days < 90 ? "text-primary font-medium" : "text-muted-foreground"}>
                                {days}d
                              </span>
                            ) : (
                              <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-400 gap-1">
                                <Clock className="w-3 h-3" /> Due
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-foreground">
                            {isBondType ? formatPct(parseFloat(String(s.couponRate))) : "Discount"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {isBondType ? nextCouponDate(s.issueDate, s.maturityDate) : "–"}
                          </td>
                          <td className="px-4 py-3">
                            {s.isTaxExempt ? (
                              <Badge variant="outline" className="text-xs phase-growth border">Tax-Exempt</Badge>
                            ) : isBondType ? (
                              <Badge variant="outline" className="text-xs phase-de-risking border">15% WHT</Badge>
                            ) : (
                              <span className="text-muted-foreground">–</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {days <= 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="w-7 h-7 text-amber-400 hover:text-amber-300"
                                  title="Recycle proceeds (roll into MMF or re-buy)"
                                  onClick={() => setRecycleFor(s)}
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-7 h-7 text-muted-foreground hover:text-primary"
                                title="Edit security"
                                onClick={() => openEdit(s)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-7 h-7 text-muted-foreground hover:text-primary"
                                title="Mark as matured"
                                onClick={() => updateMutation.mutate({ id: s.id, isMatured: true })}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-7 h-7 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteMutation.mutate({ id: s.id })}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Matured */}
        {matured.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                Matured / Closed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Type</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Face Value</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Maturity Date</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Coupon Rate</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matured.map((s) => (
                      <tr key={s.id} className="border-b border-border/40">
                        <td className="px-4 py-2.5">
                          <Badge variant="outline" className="text-xs opacity-60">
                            {getSecurityLabel(s.securityType)}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                          {formatKES(parseFloat(String(s.faceValue)))}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {new Date(s.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {!s.securityType.startsWith("tbill") ? formatPct(parseFloat(String(s.couponRate))) : "Discount"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 gap-1.5 text-xs"
                            onClick={() => setRecycleFor(s)}
                          >
                            <RefreshCw className="w-3 h-3" /> Roll over
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Edit Security Dialog ─────────────────────────────────────── */}
        <Dialog open={editId != null} onOpenChange={(o) => !o && setEditId(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit CBK Security</DialogTitle>
            </DialogHeader>
            {editId != null && linkedSecurityIds.has(editId) && (
              <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <span>
                  This entry is linked to a recorded deposit. Changing the face value or
                  issue date will update that deposit automatically so your live actuals,
                  accrual ledger, and tax summary stay in sync.
                </span>
              </div>
            )}
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Security Type</Label>
                <Controller
                  name="securityType"
                  control={editForm.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tbill_91">91-Day T-Bill</SelectItem>
                        <SelectItem value="tbill_182">182-Day T-Bill</SelectItem>
                        <SelectItem value="tbill_364">364-Day T-Bill</SelectItem>
                        <SelectItem value="ifb">Infrastructure Bond (IFB) — Tax Exempt</SelectItem>
                        <SelectItem value="fxd">Fixed Coupon Bond (FXD) — 15% WHT</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Face Value (KES)</Label>
                  <Input type="number" step="50000" min="50000" {...editForm.register("faceValue", { valueAsNumber: true })} />
                </div>
                {editIsBond && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Coupon Rate (%)</Label>
                    <Input type="number" step="0.01" min="0" {...editForm.register("couponRate", { valueAsNumber: true })} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Issue Date</Label>
                  <Input type="date" {...editForm.register("issueDate")} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Maturity Date</Label>
                  <Input type="date" {...editForm.register("maturityDate")} required />
                </div>
              </div>
              {editType !== "ifb" && editIsBond && (
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <Label className="text-xs">Tax-exempt</Label>
                  <Controller
                    name="isTaxExempt"
                    control={editForm.control}
                    render={({ field }) => (
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    )}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Notes (optional)</Label>
                <Input placeholder="e.g. IFB/2026/10Y" {...editForm.register("notes")} />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setEditId(null)}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* ── Maturity Recycling Dialog ──────────────────────────────── */}
        <RecycleDialog
          security={recycleFor}
          onClose={() => setRecycleFor(null)}
          onConfirm={(mode, amount, depositDate) =>
            recycleFor && recycleMutation.mutate({ id: recycleFor.id, mode, amount, depositDate })
          }
          isPending={recycleMutation.isPending}
        />
      </div>
    </AppShell>
  );
}

// ── Maturity-recycling prompt ───────────────────────────────────────────────
function RecycleDialog({
  security,
  onClose,
  onConfirm,
  isPending,
}: {
  security: { id: number; securityType: string; faceValue: string } | null;
  onClose: () => void;
  onConfirm: (mode: "mmf" | "rebuy", amount: number, depositDate: string) => void;
  isPending: boolean;
}) {
  const face = security ? parseFloat(String(security.faceValue)) || 0 : 0;
  const [amount, setAmount] = useState<number>(face);
  const [depositDate, setDepositDate] = useState<string>(new Date().toISOString().split("T")[0]);

  // Reset the form whenever a new security is selected.
  useEffect(() => {
    if (security) {
      setAmount(parseFloat(String(security.faceValue)) || 0);
      setDepositDate(new Date().toISOString().split("T")[0]);
    }
  }, [security]);

  const typeLabel = security ? getSecurityLabel(security.securityType) : "";
  const isGov = true; // every register row is a CBK security
  void isGov;

  return (
    <Dialog open={security != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-amber-400" /> Recycle Matured Proceeds
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-1">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
            Your <span className="font-medium text-foreground">{typeLabel}</span> has reached
            maturity. Choose where the redeemed cash goes — this marks the old lot closed and
            records the redeployment so your live actuals stay accurate.
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Amount (KES)</Label>
              <Input
                type="number"
                step="1000"
                min="1"
                value={Number.isFinite(amount) ? amount : 0}
                onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Redeploy date</Label>
              <Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            <button
              type="button"
              disabled={isPending || amount <= 0}
              onClick={() => onConfirm("mmf", amount, depositDate)}
              className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
            >
              <Wallet className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <span>
                <span className="block text-sm font-medium text-foreground">Roll into primary MMF</span>
                <span className="block text-xs text-muted-foreground">
                  Park the cash in your money-market fund as a liquid deposit.
                </span>
              </span>
            </button>
            <button
              type="button"
              disabled={isPending || amount <= 0}
              onClick={() => onConfirm("rebuy", amount, depositDate)}
              className="flex items-start gap-3 rounded-lg border border-border bg-card px-3 py-3 text-left transition-colors hover:border-primary/50 hover:bg-primary/5 disabled:opacity-50"
            >
              <RotateCcw className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <span>
                <span className="block text-sm font-medium text-foreground">Re-buy the same instrument</span>
                <span className="block text-xs text-muted-foreground">
                  Create a fresh {typeLabel} for the same tenor, issued on the redeploy date.
                </span>
              </span>
            </button>
          </div>

          <Button type="button" variant="outline" className="w-full" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
