import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, getMonthLabel } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TrendingUp, Plus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";

interface OverrideForm {
  monthNumber: number;
  overrideAmount: number;
  lumpSum: number;
  reason: string;
}

export default function Contributions() {
  const utils = trpc.useUtils();
  const { data: schedule, isLoading: schedLoading } = trpc.projection.contributionSchedule.useQuery();
  const { data: overrides, isLoading: overLoading } = trpc.contributions.list.useQuery();
  const { data: settings } = trpc.settings.get.useQuery();

  const upsertMutation = trpc.contributions.upsert.useMutation({
    onSuccess: () => {
      toast.success("Contribution override saved");
      utils.contributions.list.invalidate();
      utils.projection.run.invalidate();
      setOpen(false);
    },
    onError: () => toast.error("Failed to save override"),
  });

  const deleteMutation = trpc.contributions.delete.useMutation({
    onSuccess: () => {
      toast.success("Override removed");
      utils.contributions.list.invalidate();
      utils.projection.run.invalidate();
    },
    onError: () => toast.error("Failed to remove override"),
  });

  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset, setValue } = useForm<OverrideForm>({
    defaultValues: { monthNumber: 1, overrideAmount: 0, lumpSum: 0, reason: "" },
  });

  const startDate = settings?.startDate ? String(settings.startDate) : "2026-07-01";

  const overrideMap = new Map(overrides?.map((o) => [o.monthNumber, o]) ?? []);

  function onSubmit(data: OverrideForm) {
    upsertMutation.mutate({
      monthNumber: data.monthNumber,
      overrideAmount: data.overrideAmount > 0 ? data.overrideAmount : undefined,
      lumpSum: data.lumpSum > 0 ? data.lumpSum : undefined,
      reason: data.reason || undefined,
    });
  }

  function openEdit(monthNumber: number, existing?: { overrideAmount?: string | number | null; lumpSum?: string | number | null; reason?: string | null }) {
    reset({
      monthNumber,
      overrideAmount: existing?.overrideAmount ? parseFloat(String(existing.overrideAmount)) : 0,
      lumpSum: existing?.lumpSum ? parseFloat(String(existing.lumpSum)) : 0,
      reason: existing?.reason ?? "",
    });
    setOpen(true);
  }

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              Contribution Schedule
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Starting at KES 2,500 with automatic +KES 3,000 step-up every 6 months
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" onClick={() => reset({ monthNumber: 1, overrideAmount: 0, lumpSum: 0, reason: "" })}>
                <Plus className="w-3.5 h-3.5" />
                Add Override
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Contribution Override</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Month Number (1–120)</Label>
                  <Input type="number" min={1} max={120} {...register("monthNumber", { valueAsNumber: true })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Override Monthly Amount (KES)</Label>
                  <Input type="number" min={0} step={100} {...register("overrideAmount", { valueAsNumber: true })} />
                  <p className="text-xs text-muted-foreground">Leave 0 to keep the scheduled amount</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">One-off Lump Sum (KES)</Label>
                  <Input type="number" min={0} step={1000} {...register("lumpSum", { valueAsNumber: true })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Reason (optional)</Label>
                  <Input placeholder="e.g. Bonus received" {...register("reason")} />
                </div>
                <Button type="submit" className="w-full" disabled={upsertMutation.isPending}>
                  {upsertMutation.isPending ? "Saving..." : "Save Override"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Contribution Ladder */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Contribution Ladder (Auto Step-Up)
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {schedLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Months</th>
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Period</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Monthly Amount</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">6-Month Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule?.map((s) => (
                      <tr key={s.startMonth} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 pr-4 font-medium text-foreground">
                          {s.startMonth}–{s.endMonth}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">
                          {getMonthLabel(startDate, s.startMonth)} – {getMonthLabel(startDate, s.endMonth)}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-bold text-primary kes-amount">
                          {formatKES(s.monthlyAmount)}
                        </td>
                        <td className="py-2.5 text-right text-muted-foreground kes-amount">
                          {formatKES(s.sixMonthTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border">
                      <td colSpan={2} className="py-2.5 text-xs text-muted-foreground font-medium">Total contributions</td>
                      <td className="py-2.5 text-right font-bold text-foreground kes-amount" colSpan={2}>
                        {formatKES(schedule?.reduce((s, r) => s + r.sixMonthTotal, 0) ?? 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Overrides */}
        {(overrides?.length ?? 0) > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Manual Overrides & Lump Sums</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Month</th>
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Date</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Override Amount</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Lump Sum</th>
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Reason</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overrides?.map((o) => (
                      <tr key={o.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 pr-4 font-semibold text-foreground">{o.monthNumber}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground">
                          {getMonthLabel(startDate, o.monthNumber)}
                        </td>
                        <td className="py-2.5 pr-4 text-right kes-amount text-foreground">
                          {parseFloat(String(o.overrideAmount)) > 0 ? formatKES(parseFloat(String(o.overrideAmount))) : "–"}
                        </td>
                        <td className="py-2.5 pr-4 text-right kes-amount text-primary font-medium">
                          {parseFloat(String(o.lumpSum)) > 0 ? formatKES(parseFloat(String(o.lumpSum))) : "–"}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{o.reason ?? "–"}</td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-7 h-7"
                              onClick={() => openEdit(o.monthNumber, o as any)}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-7 h-7 text-destructive hover:text-destructive"
                              onClick={() => deleteMutation.mutate({ monthNumber: o.monthNumber })}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
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
