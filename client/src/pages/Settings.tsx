import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings as SettingsIcon, RefreshCw, Info, Pencil } from "lucide-react";
import { UpdateRatesPanel } from "@/components/UpdateRatesPanel";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { History, TrendingUp } from "lucide-react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";

// ─── Rate-only form ────────────────────────────────────────────────────────────

interface RateForm {
  mmfYield: number;
  tbill91Rate: number;
  tbill182Rate: number;
  tbill364Rate: number;
  ifbCouponRate: number;
  fxdCouponRate: number;
  withholdingTax: number;
}

// ─── Plan-level form ──────────────────────────────────────────────────────────

interface PlanForm {
  name: string;
  description: string;
  targetAmount: number;
  startDate: string;
  horizonMonths: number;
  startingContribution: number;
  stepUpAmount: number;
  stepUpMonths: number;
  safetyFloor: number;
}

function RateField({ label, name, register, description }: {
  label: string;
  name: keyof RateForm;
  register: ReturnType<typeof useForm<RateForm>>["register"];
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

function RateHistorySection({ portfolioId }: { portfolioId: number }) {
  const { data: history, isLoading } = trpc.settings.getRateHistory.useQuery({ portfolioId });

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
          <p className="text-xs text-muted-foreground">No rate changes recorded yet.</p>
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
  const { portfolioId, portfolio, refetch: refetchPortfolios } = usePortfolio();
  const { fundLabel: selectedFundLabel, fundEar: selectedFundEar } = useSelectedFund();
  const utils = trpc.useUtils();

  // ─── Rate form ──────────────────────────────────────────────────────────────
  const { data: rateSettings } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  const rateForm = useForm<RateForm>({
    defaultValues: {
      mmfYield: 8.78,
      tbill91Rate: 8.8206,
      tbill182Rate: 8.7782,
      tbill364Rate: 8.9746,
      ifbCouponRate: 12.5,
      fxdCouponRate: 12.35,
      withholdingTax: 15,
    },
  });

  useEffect(() => {
    if (rateSettings) {
      rateForm.reset({
        mmfYield: rateSettings.mmfYield,
        tbill91Rate: rateSettings.tbill91Rate,
        tbill182Rate: rateSettings.tbill182Rate,
        tbill364Rate: rateSettings.tbill364Rate,
        ifbCouponRate: rateSettings.ifbCouponRate,
        fxdCouponRate: rateSettings.fxdCouponRate,
        withholdingTax: rateSettings.withholdingTax,
      });
    }
  }, [rateSettings]);

  const saveRatesMutation = trpc.rateUpdate.save.useMutation({
    onSuccess: () => {
      toast.success("Rates saved — projection recalculated");
      utils.settings.get.invalidate({ portfolioId: portfolioId! });
      utils.projection.run.invalidate({ portfolioId: portfolioId! });
      utils.projection.scenarios.invalidate({ portfolioId: portfolioId! });
      utils.projection.milestones.invalidate({ portfolioId: portfolioId! });
      utils.deposits.summary.invalidate({ portfolioId: portfolioId! });
    },
    onError: () => toast.error("Failed to save rates"),
  });

  function onSaveRates(data: RateForm) {
    if (!portfolioId) return;
    saveRatesMutation.mutate({ portfolioId, ...data });
  }

  // ─── Plan form ──────────────────────────────────────────────────────────────
  const planForm = useForm<PlanForm>({
    defaultValues: {
      name: "",
      description: "",
      targetAmount: 5000000,
      startDate: "2026-07-01",
      horizonMonths: 120,
      startingContribution: 2500,
      stepUpAmount: 3000,
      stepUpMonths: 6,
      safetyFloor: 50000,
    },
  });

  useEffect(() => {
    if (portfolio) {
      planForm.reset({
        name: portfolio.name,
        description: portfolio.description ?? "",
        targetAmount: portfolio.targetAmount,
        startDate: portfolio.startDate,
        horizonMonths: portfolio.horizonMonths,
        startingContribution: portfolio.startingContribution,
        stepUpAmount: portfolio.stepUpAmount,
        stepUpMonths: portfolio.stepUpMonths,
        safetyFloor: portfolio.safetyFloor,
      });
    }
  }, [portfolio]);

  const updatePortfolioMutation = trpc.portfolios.update.useMutation({
    onSuccess: () => {
      toast.success("Portfolio plan updated");
      refetchPortfolios();
      utils.portfolios.list.invalidate();
      utils.projection.run.invalidate({ portfolioId: portfolioId! });
      utils.projection.milestones.invalidate({ portfolioId: portfolioId! });
      utils.projection.scenarios.invalidate({ portfolioId: portfolioId! });
    },
    onError: () => toast.error("Failed to update portfolio"),
  });

  function onSavePlan(data: PlanForm) {
    if (!portfolioId) return;
    updatePortfolioMutation.mutate({ portfolioId, ...data });
  }

  if (!portfolioId) {
    return (
      <AppShell>
        <div className="p-8 text-muted-foreground text-sm">Select a portfolio to view settings.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure rates and plan parameters for <strong>{portfolio?.name}</strong>.
          </p>
        </div>

        {/* ── Plan Settings ── */}
        <form onSubmit={planForm.handleSubmit(onSavePlan)} className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Pencil className="w-4 h-4 text-primary" />
                Portfolio Plan
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Change the goal, horizon, or contribution schedule. The projection recalculates immediately.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-xs font-medium">Portfolio Name</Label>
                <Input {...planForm.register("name")} />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-xs font-medium">Description (optional)</Label>
                <Input {...planForm.register("description")} placeholder="Notes about this goal" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Target End Value (KES)</Label>
                <Input type="number" step="100000" min="0" {...planForm.register("targetAmount", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">Total portfolio value to hold at end of horizon</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Horizon (months)</Label>
                <Input type="number" min="12" max="240" {...planForm.register("horizonMonths", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">12–240 months (1–20 years)</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Start Date</Label>
                <Input type="date" {...planForm.register("startDate")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Starting Monthly Contribution (KES)</Label>
                <Input type="number" step="100" min="0" {...planForm.register("startingContribution", { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Step-Up Amount per Period (KES)</Label>
                <Input type="number" step="100" min="0" {...planForm.register("stepUpAmount", { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Step-Up Every N Months</Label>
                <Input type="number" step="1" min="1" max="24" {...planForm.register("stepUpMonths", { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">MMF Safety Floor (KES)</Label>
                <Input type="number" step="1000" min="0" {...planForm.register("safetyFloor", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">Minimum MMF balance before sweeping to DhowCSD</p>
              </div>
            </CardContent>
          </Card>
          <Button type="submit" variant="outline" className="w-full sm:w-auto" disabled={updatePortfolioMutation.isPending}>
            {updatePortfolioMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />Saving…</> : "Save Plan Settings"}
          </Button>
        </form>

        {/* ── Rate Settings ── */}
        <div className="bg-muted/40 border border-border rounded-lg p-4 flex gap-3">
          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">All rates are gross rates.</strong> The engine deducts 15% WHT on MMF, T-Bill, and FXD income automatically. IFB coupons are tax-exempt.
          </div>
        </div>

        <form onSubmit={rateForm.handleSubmit(onSaveRates)} className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <SettingsIcon className="w-4 h-4 text-primary" />
                {selectedFundLabel} Yield
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Enter the gross effective annual yield shown by {selectedFundLabel}. Current fund EAR: {selectedFundEar.toFixed(2)}%.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <RateField label={`${selectedFundLabel} Annual Yield (Gross)`} name="mmfYield" register={rateForm.register} description={`Current EAR: ${selectedFundEar.toFixed(2)}% → net ≈ ${(selectedFundEar * 0.85).toFixed(2)}%`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">CBK Treasury Bill Rates</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Enter the gross auction rate.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <RateField label="91-Day T-Bill (Gross)" name="tbill91Rate" register={rateForm.register} description="Default: 8.82%" />
              <RateField label="182-Day T-Bill (Gross)" name="tbill182Rate" register={rateForm.register} description="Default: 8.78%" />
              <RateField label="364-Day T-Bill (Gross)" name="tbill364Rate" register={rateForm.register} description="Default: 8.97%" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">CBK Bond Rates</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">IFB: tax-exempt. FXD: 15% WHT deducted.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <RateField label="IFB Coupon Rate (Gross = Net)" name="ifbCouponRate" register={rateForm.register} description="Tax-exempt. Default: 12.5%" />
              <RateField label="FXD Coupon Rate (Gross)" name="fxdCouponRate" register={rateForm.register} description="Default: 12.35% → net ≈ 10.5%" />
              <RateField label="Withholding Tax Rate" name="withholdingTax" register={rateForm.register} description="Default: 15%" />
            </CardContent>
          </Card>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex gap-3">
            <TrendingUp className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Rate changes only affect future months.</strong> A snapshot is recorded with today's date as the effective date.
            </div>
          </div>

          <Button type="submit" className="w-full sm:w-auto" disabled={saveRatesMutation.isPending}>
            {saveRatesMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />Saving…</> : "Save Rates & Recalculate"}
          </Button>
        </form>

        <UpdateRatesPanel portfolioId={portfolioId} />
        <RateHistorySection portfolioId={portfolioId} />
      </div>
    </AppShell>
  );
}
