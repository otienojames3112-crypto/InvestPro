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
import { Landmark, Plus, Trash2, CheckCircle2, Clock } from "lucide-react";
import { useState } from "react";
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
  const updateMutation = trpc.securities.update.useMutation({
    onSuccess: () => {
      toast.success("Security updated");
      utils.securities.list.invalidate();
    },
  });

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
                            <Badge variant="outline" className="text-xs">
                              {getSecurityLabel(s.securityType)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-foreground kes-amount">
                            {formatKES(parseFloat(String(s.faceValue)))}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(s.issueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(s.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <span className={days < 30 ? "text-destructive font-semibold" : days < 90 ? "text-primary font-medium" : "text-muted-foreground"}>
                              {days > 0 ? `${days}d` : "Matured"}
                            </span>
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
                    </tr>
                  </thead>
                  <tbody>
                    {matured.map((s) => (
                      <tr key={s.id} className="border-b border-border/40 opacity-60">
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
