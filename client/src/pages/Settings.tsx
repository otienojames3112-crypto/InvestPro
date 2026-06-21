import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Settings as SettingsIcon, RefreshCw, Info } from "lucide-react";
import { UpdateRatesPanel } from "@/components/UpdateRatesPanel";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { History, TrendingUp } from "lucide-react";
import { format } from "date-fns";

interface SettingsForm {
  mmfYield: number;
  tbill91Rate: number;
  tbill182Rate: number;
  tbill364Rate: number;
  ifbCouponRate: number;
  fxdCouponRate: number;
  withholdingTax: number;
  startingContribution: number;
  stepUpAmount: number;
  stepUpMonths: number;
  safetyFloor: number;
  targetAmount: number;
  startDate: string;
}

function RateField({ label, name, register, description }: {
  label: string;
  name: keyof SettingsForm;
  register: ReturnType<typeof useForm<SettingsForm>>["register"];
  description?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          step="0.01"
          min="0"
          className="pr-8 text-sm"
          {...register(name, { valueAsNumber: true })}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

function RateHistorySection() {
  const { data: history, isLoading } = trpc.rateHistory.list.useQuery();

  if (isLoading) return null;
  if (!history || history.length === 0) {
    return (
      <Card className="mt-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            Rate Change History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <p className="text-xs text-muted-foreground">No rate changes recorded yet. Rate changes will appear here after you save new settings.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          Rate Change History
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Each entry shows the rates that took effect on that date. Only future months are affected by each change.
        </p>
      </CardHeader>
      <CardContent className="p-4 pt-0 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left pb-2 pr-3 font-medium text-muted-foreground">Effective Date</th>
              <th className="text-right pb-2 pr-3 font-medium text-muted-foreground">MMF</th>
              <th className="text-right pb-2 pr-3 font-medium text-muted-foreground">T-Bill 91d</th>
              <th className="text-right pb-2 pr-3 font-medium text-muted-foreground">T-Bill 364d</th>
              <th className="text-right pb-2 pr-3 font-medium text-muted-foreground">IFB</th>
              <th className="text-right pb-2 font-medium text-muted-foreground">FXD</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((row) => (
              <tr key={row.id} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-3 text-foreground font-medium">{row.effectiveDate}</td>
                <td className="py-2 pr-3 text-right text-muted-foreground">{row.mmfYield.toFixed(2)}%</td>
                <td className="py-2 pr-3 text-right text-muted-foreground">{row.tbill91Rate.toFixed(2)}%</td>
                <td className="py-2 pr-3 text-right text-muted-foreground">{row.tbill364Rate.toFixed(2)}%</td>
                <td className="py-2 pr-3 text-right text-muted-foreground">{row.ifbCouponRate.toFixed(2)}%</td>
                <td className="py-2 text-right text-muted-foreground">{row.fxdCouponRate.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.settings.get.useQuery();
  const saveMutation = trpc.settings.save.useMutation({
    onSuccess: () => {
      toast.success("Settings saved — projection recalculated");
      utils.settings.get.invalidate();
      utils.projection.run.invalidate();
      utils.projection.scenarios.invalidate();
      utils.projection.contributionSchedule.invalidate();
      utils.projection.milestones.invalidate();
      utils.deposits.summary.invalidate();
    },
    onError: () => toast.error("Failed to save settings"),
  });

  const { register, handleSubmit, reset } = useForm<SettingsForm>({
    defaultValues: {
      mmfYield: 8.78,
      tbill91Rate: 8.8206,
      tbill182Rate: 8.7782,
      tbill364Rate: 8.9746,
      ifbCouponRate: 12.5,
      fxdCouponRate: 12.35,  // gross; net ≈ 10.5% after 15% WHT
      withholdingTax: 15,
      startingContribution: 2500,
      stepUpAmount: 3000,
      stepUpMonths: 6,
      safetyFloor: 50000,
      targetAmount: 5000000,
      startDate: "2026-07-01",
    },
  });

  useEffect(() => {
    if (settings) {
      reset({
        mmfYield: settings.mmfYield,
        tbill91Rate: settings.tbill91Rate,
        tbill182Rate: settings.tbill182Rate,
        tbill364Rate: settings.tbill364Rate,
        ifbCouponRate: settings.ifbCouponRate,
        fxdCouponRate: settings.fxdCouponRate,
        withholdingTax: settings.withholdingTax,
        startingContribution: settings.startingContribution,
        stepUpAmount: settings.stepUpAmount,
        stepUpMonths: settings.stepUpMonths,
        safetyFloor: settings.safetyFloor,
        targetAmount: settings.targetAmount,
        startDate: settings.startDate ? String(settings.startDate).split("T")[0] : "2026-07-01",
      });
    }
  }, [settings, reset]);

  function onSubmit(data: SettingsForm) {
    saveMutation.mutate(data);
  }

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Rate Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Update rates to reflect current CBK and MMF market conditions. All projections recalculate instantly.
          </p>
        </div>

        <div className="bg-muted/40 border border-border rounded-lg p-4 flex gap-3">
          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Live CBK rates as of June 2026:</strong> 91-day T-bill 8.82%, 182-day 8.78%, 364-day 8.97%.
            IFB bonds offer 12–18% tax-exempt coupons. FXD bonds 10–14% gross (15% WHT deducted at source).
            SanlamAllianz MMF effective annual yield: 8.78% gross (15% WHT deducted at source).
            <br /><strong className="text-foreground">All rates entered here are gross rates.</strong> The engine automatically deducts 15% WHT on MMF, T-Bill, and FXD income. IFB coupons remain tax-exempt.
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* MMF Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <SettingsIcon className="w-4 h-4 text-primary" />
                SanlamAllianz MMF Settings
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">15% WHT is deducted at source — enter the gross yield shown by SanlamAllianz.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <RateField
                label="MMF Annual Yield (Gross)"
                name="mmfYield"
                register={register}
                description="Gross yield before 15% WHT. Default: 8.78% → net ≈ 7.46%"
              />
            </CardContent>
          </Card>

          {/* T-Bill Rates */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">CBK Treasury Bill Rates</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">15% WHT deducted at source on the discount amount — enter the gross auction rate.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <RateField label="91-Day T-Bill (Gross)" name="tbill91Rate" register={register} description="Gross rate. Default: 8.82% → net ≈ 7.50%" />
              <RateField label="182-Day T-Bill (Gross)" name="tbill182Rate" register={register} description="Gross rate. Default: 8.78% → net ≈ 7.46%" />
              <RateField label="364-Day T-Bill (Gross)" name="tbill364Rate" register={register} description="Gross rate. Default: 8.97% → net ≈ 7.62%" />
            </CardContent>
          </Card>

          {/* Bond Rates */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">CBK Bond Rates</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Enter gross coupon rates. IFB coupons are tax-exempt; FXD coupons have 15% WHT deducted.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <RateField
                label="IFB Coupon Rate (Gross = Net)"
                name="ifbCouponRate"
                register={register}
                description="Tax-exempt — no WHT. Default: 12.5%"
              />
              <RateField
                label="FXD Coupon Rate (Gross)"
                name="fxdCouponRate"
                register={register}
                description="Gross rate before 15% WHT. Default: 12.35% → net ≈ 10.5%"
              />
              <RateField
                label="Withholding Tax Rate"
                name="withholdingTax"
                register={register}
                description="Applied to MMF, T-Bill, and FXD income. Default: 15%"
              />
            </CardContent>
          </Card>

          {/* Plan Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Investment Plan Settings</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Starting Monthly Contribution (KES)</Label>
                <Input type="number" step="100" min="0" {...register("startingContribution", { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Step-Up Amount per Period (KES)</Label>
                <Input type="number" step="100" min="0" {...register("stepUpAmount", { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Step-Up Every N Months</Label>
                <Input type="number" step="1" min="1" max="24" {...register("stepUpMonths", { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">MMF Safety Floor (KES)</Label>
                <Input type="number" step="1000" min="0" {...register("safetyFloor", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">Minimum MMF balance before sweeping to DhowCSD</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Target End Value (KES)</Label>
                <Input type="number" step="100000" min="0" placeholder="5000000" {...register("targetAmount", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">The total portfolio value you want to <strong>hold</strong> at Month 120 — not what you put in, but what you will have</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Start Date</Label>
                <Input type="date" {...register("startDate")} />
              </div>
            </CardContent>
          </Card>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex gap-3">
            <TrendingUp className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Rate changes only affect future months.</strong> When you save new rates, a snapshot is recorded with today's date as the effective date. The projection engine uses the rate that was in effect at each month's date — so your historical months are never retroactively changed.
            </div>
          </div>

          <Button type="submit" className="w-full sm:w-auto" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />
                Saving & Recalculating...
              </>
            ) : (
              "Save Settings & Recalculate"
            )}
          </Button>
        </form>

        <UpdateRatesPanel />
        <RateHistorySection />
      </div>
    </AppShell>
  );
}
