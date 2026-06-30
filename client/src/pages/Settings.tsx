import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Settings as SettingsIcon, RefreshCw, Info, Pencil, Sparkles, ShieldAlert } from "lucide-react";
import { UpdateRatesPanel } from "@/components/UpdateRatesPanel";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { useEffect, useState } from "react";
import { TenorRateGrid, type TenorRateMap } from "@/components/TenorRateGrid";
import { History, TrendingUp } from "lucide-react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { GlossaryTerm } from "@/components/GlossaryTerm";

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
  concentrationCapPct: number;
  typeConcentrationCapPct: number;
  allocationPolicy: "balanced" | "yield_first" | "custom";
  driftAlertThresholdPct: number;
  // Part A1: inflation-link the goal (the liability). Default off.
  inflationLinked: boolean;
  // Part A1: optional override (% p.a.); empty string = use Dashboard inflation benchmark.
  inflationOverrideRate: number | null;
  // Part 6: optional stated risk tolerance (comfort band). "" = not stated.
  riskTolerance: "" | "capital_preservation" | "conservative" | "balanced" | "growth" | "aggressive";
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

export default function Settings({ embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId, portfolio, refetch: refetchPortfolios } = usePortfolio();
  const { fundLabel: selectedFundLabel, fundEar: selectedFundEar, hasFund } = useSelectedFund();
  const utils = trpc.useUtils();

  // Part A1: read the SAME global inflation benchmark the Dashboard real-yield
  // line uses, so the toggle can show the default rate that applies when no
  // per-portfolio override is set.
  const { data: benchmarks } = trpc.benchmarks.list.useQuery();
  const benchmarkInflationPct =
    benchmarks?.find((b) => b.metricKey === "inflation")?.value ?? null;

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
    saveRatesMutation.mutate({
      portfolioId,
      ...data,
      ifbTenorRates: Object.keys(ifbTenorRates).length ? ifbTenorRates : null,
      fxdTenorRates: Object.keys(fxdTenorRates).length ? fxdTenorRates : null,
    });
  }

  // Round 40: per-tenor bond rate maps (local state, merged into the save payload).
  const [ifbTenorRates, setIfbTenorRates] = useState<TenorRateMap>({});
  const [fxdTenorRates, setFxdTenorRates] = useState<TenorRateMap>({});

  // ─── R53: liquidity horizon (days) for the Dashboard duration-risk hint ──
  const [horizonDays, setHorizonDays] = useState<number>(365);
  useEffect(() => {
    if (rateSettings) setHorizonDays(rateSettings.liquidityHorizonDays ?? 365);
  }, [rateSettings]);
  const saveHorizonMutation = trpc.settings.updateLiquidityHorizon.useMutation({
    onSuccess: () => {
      toast.success("Liquidity horizon saved — duration-risk hint updated");
      utils.settings.get.invalidate({ portfolioId: portfolioId! });
    },
    onError: () => toast.error("Failed to save liquidity horizon"),
  });
  const horizonDirty = rateSettings != null && horizonDays !== (rateSettings.liquidityHorizonDays ?? 365);

  useEffect(() => {
    if (rateSettings) {
      setIfbTenorRates(rateSettings.ifbTenorRates ?? {});
      setFxdTenorRates(rateSettings.fxdTenorRates ?? {});
    }
  }, [rateSettings]);

  // Single coherent WHT chain shared by every rate label on this page.
  const whtPct = Number(rateForm.watch("withholdingTax")) || 15;
  const whtFrac = whtPct / 100;

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
      concentrationCapPct: 25,
      typeConcentrationCapPct: 60,
      allocationPolicy: "balanced",
      driftAlertThresholdPct: 5,
      inflationLinked: false,
      inflationOverrideRate: null,
      riskTolerance: "",
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
        concentrationCapPct: (portfolio as { concentrationCapPct?: number }).concentrationCapPct ?? 25,
        typeConcentrationCapPct: (portfolio as { typeConcentrationCapPct?: number }).typeConcentrationCapPct ?? 60,
        allocationPolicy:
          (portfolio as { allocationPolicy?: "balanced" | "yield_first" | "custom" }).allocationPolicy ?? "balanced",
        driftAlertThresholdPct:
          (portfolio as { driftAlertThresholdPct?: number }).driftAlertThresholdPct ?? 5,
        inflationLinked: !!(portfolio as { inflationLinked?: boolean }).inflationLinked,
        inflationOverrideRate:
          (portfolio as { inflationOverrideRate?: number | null }).inflationOverrideRate ?? null,
        riskTolerance:
          ((portfolio as { riskTolerance?: PlanForm["riskTolerance"] | null }).riskTolerance ?? "") || "",
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
    // R69.1 — surface the real server/DB error (e.g. a missing enum value) instead
    // of a generic message, so silent persistence failures are visible.
    onError: (e) =>
      toast.error(e.message ? `Couldn't save settings: ${e.message}` : "Failed to update portfolio"),
  });

  // ── Round 62: Yield-first acknowledgment gate ──────────────────────────────
  // Switching the Allocation Policy to "yield_first" deliberately relaxes the
  // concentration caps, so we require an explicit, recorded acknowledgment of
  // the added concentration risk before saving.
  const [pendingPlan, setPendingPlan] = useState<PlanForm | null>(null);
  const acknowledgeYieldFirst = trpc.portfolios.acknowledgeYieldFirst.useMutation();

  const alreadyAckedYieldFirst =
    !!(portfolio as { yieldFirstAckAt?: number | null } | undefined)?.yieldFirstAckAt;

  function onSavePlan(data: PlanForm) {
    if (!portfolioId) return;
    const switchingToYieldFirst =
      data.allocationPolicy === "yield_first" && !alreadyAckedYieldFirst;
    if (switchingToYieldFirst) {
      // Hold the save until the user acknowledges the concentration risk.
      setPendingPlan(data);
      return;
    }
    updatePortfolioMutation.mutate({ portfolioId, ...normalizePlan(data) });
  }

  // Part A1: an empty / NaN override means "use the Dashboard inflation benchmark".
  function normalizePlan(data: PlanForm) {
    return {
      ...data,
      inflationOverrideRate:
        data.inflationOverrideRate == null || Number.isNaN(data.inflationOverrideRate)
          ? null
          : data.inflationOverrideRate,
      // Part 6: "" → null (not stated). Otherwise the chosen comfort band.
      riskTolerance: data.riskTolerance === "" ? null : data.riskTolerance,
    };
  }

  async function confirmYieldFirst() {
    if (!portfolioId || !pendingPlan) return;
    try {
      await acknowledgeYieldFirst.mutateAsync({ portfolioId });
      updatePortfolioMutation.mutate({ portfolioId, ...normalizePlan(pendingPlan) });
    } finally {
      setPendingPlan(null);
    }
  }

  // Auto-derived MMF safety floor recommendation, recomputed live from the
  // currently-entered starting contribution (falls back to the saved value).
  const watchedContribution = planForm.watch("startingContribution");
  const { data: derivedFloor } = trpc.settings.derivedSafetyFloor.useQuery(
    { portfolioId: portfolioId!, startingContribution: Number(watchedContribution) || undefined },
    { enabled: !!portfolioId }
  );

  // ── Live step-up recommendation (portfolio-aware) ─────────────────────────
  // Mirrors the Create-dialog auto-recommend, but uses the saved portfolio's
  // real rates/balances and the currently-entered contribution + frequency.
  const watchedStepUpMonths = planForm.watch("stepUpMonths");
  const watchedStepUpAmount = planForm.watch("stepUpAmount");
  const [stepUpReco, setStepUpReco] = useState<{ startingContribution: number; stepUpMonths: number } | null>(null);
  useEffect(() => {
    if (!portfolioId) return;
    const sc = Number(watchedContribution);
    const sm = Number(watchedStepUpMonths);
    if (!Number.isFinite(sc) || sc < 0 || !Number.isFinite(sm) || sm < 1) {
      setStepUpReco(null);
      return;
    }
    const t = setTimeout(() => setStepUpReco({ startingContribution: sc, stepUpMonths: sm }), 450);
    return () => clearTimeout(t);
  }, [portfolioId, watchedContribution, watchedStepUpMonths]);
  const stepUpRecoQuery = trpc.projection.recommendStepUpForPortfolio.useQuery(
    stepUpReco ? { portfolioId: portfolioId!, ...stepUpReco } : { portfolioId: portfolioId! },
    { enabled: !!portfolioId && !!stepUpReco, staleTime: 30_000 }
  );
  const stepUpRec = stepUpReco ? stepUpRecoQuery.data : undefined;

  if (!portfolioId) {
    return (
      <AppShell embedded={embedded}>
        <div className="p-8 text-muted-foreground text-sm">Select a portfolio to view settings.</div>
      </AppShell>
    );
  }

  return (
    <AppShell embedded={embedded}>
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
                {stepUpRec && (
                  <div className="flex items-center gap-2 text-xs">
                    <Sparkles className="w-3 h-3 text-primary shrink-0" />
                    {stepUpRec.alreadyHitsAtZero ? (
                      <span className="text-muted-foreground">
                        Already reaches target at this contribution — <strong className="text-foreground">no step-up needed</strong>.
                        {Number(watchedStepUpAmount) > 0 && (
                          <button
                            type="button"
                            className="ml-1 text-primary hover:underline"
                            onClick={() => planForm.setValue("stepUpAmount", 0, { shouldDirty: true })}
                          >
                            Set to 0
                          </button>
                        )}
                      </span>
                    ) : stepUpRec.feasible ? (
                      <span className="text-muted-foreground">
                        Recommended: <strong className="text-foreground">{stepUpRec.recommendedStepUp.toLocaleString("en-KE")}</strong>{" "}
                        <span className="text-muted-foreground/70">to reach target (projected {stepUpRec.projectedEndingValue.toLocaleString("en-KE")})</span>
                        <button
                          type="button"
                          className="ml-1 text-primary hover:underline disabled:opacity-50"
                          disabled={Number(watchedStepUpAmount) === stepUpRec.recommendedStepUp}
                          onClick={() => planForm.setValue("stepUpAmount", stepUpRec.recommendedStepUp, { shouldDirty: true })}
                        >
                          Use recommended
                        </button>
                      </span>
                    ) : (
                      <span className="text-amber-400">
                        Even a large step-up won’t reach the target at this contribution — raise the Month-1 amount, extend the horizon, or lower the target.
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Step-Up Every N Months</Label>
                <Input type="number" step="1" min="1" max="24" {...planForm.register("stepUpMonths", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">Common cadences: 3, 6, or 12 months.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">MMF Safety Floor (KES)</Label>
                <Input type="number" step="1000" min="0" {...planForm.register("safetyFloor", { valueAsNumber: true })} />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">Minimum MMF balance kept before sweeping surplus into government securities (when your plan uses them)</p>
                </div>
                {derivedFloor && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      Recommended: <strong className="text-foreground">{derivedFloor.derived.toLocaleString("en-KE")}</strong>{" "}
                      <span className="text-muted-foreground/70">(auto from your contribution &amp; sweep lot)</span>
                    </span>
                    <button
                      type="button"
                      className="text-primary hover:underline disabled:opacity-50"
                      disabled={Number(planForm.watch("safetyFloor")) === derivedFloor.derived}
                      onClick={() => planForm.setValue("safetyFloor", derivedFloor.derived, { shouldDirty: true })}
                    >
                      Use auto value
                    </button>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  <GlossaryTerm id="per-issuer-vs-per-type-cap">Per-Issuer Concentration Cap (%)</GlossaryTerm>
                </Label>
                <Input type="number" step="1" min="5" max="100" {...planForm.register("concentrationCapPct", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">No single bank/issuer should exceed this share of net worth before the Dashboard warns. Government securities are exempt (sovereign). Default 25%.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Per-Type Concentration Cap (%)</Label>
                <Input type="number" step="1" min="10" max="100" {...planForm.register("typeConcentrationCapPct", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">When a single CBK instrument TYPE (T-Bills / IFB / FXD) exceeds this share of your current portfolio value, the Portfolio Review concentration line and Dashboard maturity tile flip to a warning colour. Default 60%.</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  <GlossaryTerm id="allocation-policy">Allocation Policy</GlossaryTerm>
                </Label>
                <Select
                  value={planForm.watch("allocationPolicy")}
                  onValueChange={(v) =>
                    planForm.setValue("allocationPolicy", v as PlanForm["allocationPolicy"], { shouldDirty: true })
                  }
                >
                  <SelectTrigger className="text-sm">
                    <SelectValue placeholder="Choose a policy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="balanced">Balanced — diversify, respect caps (default)</SelectItem>
                    <SelectItem value="yield_first">Yield-first — chase the highest net yield</SelectItem>
                    <SelectItem value="custom">Custom — use my caps as-is</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  <strong>Balanced</strong> spreads liquid cash across eligible homes so no issuer breaches its cap.{" "}
                  <strong>Yield-first</strong> relaxes the per-type cap toward 100% and concentrates in the highest net-of-tax home — higher return, higher concentration risk (requires acknowledgment).{" "}
                  <strong>Custom</strong> keeps your caps exactly as entered.
                  {alreadyAckedYieldFirst && (
                    <span className="block mt-1 text-[11px] text-muted-foreground/80">Yield-first risk already acknowledged for this portfolio.</span>
                  )}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Drift Alert Threshold (%)</Label>
                <Input type="number" step="0.5" min="1" max="50" {...planForm.register("driftAlertThresholdPct", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">When your reconciled liquid cash drifts from the recommended split by more than this share of net worth (total of all gaps), the Dashboard liquid card shows a rebalancing alert. Default 5%.</p>
              </div>
              {/* Part A1 — Inflation-link the goal (the liability). Default off so the
                  goal stays nominal and the Dashboard labels it as such. */}
              <div className="space-y-2 sm:col-span-2 rounded-lg border border-border bg-muted/30 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <Label className="text-xs font-medium">Inflation-adjust the goal</Label>
                    <p className="text-xs text-muted-foreground">
                      Treat your target as a price in <strong>today's shillings</strong>. The plan is then judged against the goal inflated to the goal date, and the surplus is shown in today's money so the margin isn't overstated. Off by default — the goal stays nominal.
                    </p>
                  </div>
                  <Switch
                    checked={planForm.watch("inflationLinked")}
                    onCheckedChange={(v) => planForm.setValue("inflationLinked", v, { shouldDirty: true })}
                  />
                </div>
                {planForm.watch("inflationLinked") && (
                  <div className="space-y-1.5 pt-1">
                    <Label className="text-xs font-medium">Goal inflation rate (% p.a.) — optional override</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="50"
                      placeholder={benchmarkInflationPct != null ? `Default ${benchmarkInflationPct.toFixed(2)}% (Dashboard benchmark)` : "Uses Dashboard inflation benchmark"}
                      {...planForm.register("inflationOverrideRate", { valueAsNumber: true })}
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave blank to reuse the global inflation benchmark{benchmarkInflationPct != null ? <> (currently <strong>{benchmarkInflationPct.toFixed(2)}%</strong>)</> : null} that drives the Dashboard real-yield line — so this figure never disagrees with the inflation rate shown elsewhere.
                    </p>
                  </div>
                )}
              </div>
              {/* Part 6 — optional stated risk tolerance. This NEVER allocates or
                  blocks: it sets sensible defaults for new holdings and lets the
                  Dashboard warn when the modeled mix swings more than your stated
                  comfort. Leave as "Not set" to skip entirely. */}
              <div className="space-y-1.5 sm:col-span-2 rounded-lg border border-border bg-muted/30 p-3">
                <Label className="text-xs font-medium">Risk tolerance (optional)</Label>
                <Select
                  value={planForm.watch("riskTolerance") || "none"}
                  onValueChange={(v) =>
                    planForm.setValue("riskTolerance", v === "none" ? "" : (v as PlanForm["riskTolerance"]), { shouldDirty: true })
                  }
                >
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    <SelectItem value="capital_preservation">Capital preservation — no capital risk</SelectItem>
                    <SelectItem value="conservative">Conservative — mostly fixed income</SelectItem>
                    <SelectItem value="balanced">Balanced — some equities</SelectItem>
                    <SelectItem value="growth">Growth — equity-tilted</SelectItem>
                    <SelectItem value="aggressive">Aggressive — mostly equities / offshore</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Used only to suggest defaults and to <strong>flag</strong> when your modeled mix is more volatile than you said you're comfortable with. It never changes your holdings, ranks anything, or blocks a choice — you always decide.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Liquidity Horizon (days)</Label>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="1"
                    min="7"
                    max="3650"
                    value={horizonDays}
                    onChange={(e) => setHorizonDays(Number(e.target.value))}
                    className="text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!horizonDirty || !portfolioId || saveHorizonMutation.isPending}
                    onClick={() => portfolioId && saveHorizonMutation.mutate({ portfolioId, liquidityHorizonDays: horizonDays })}
                  >
                    {saveHorizonMutation.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                  </Button>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {[
                    { label: "90d", days: 90 },
                    { label: "180d", days: 180 },
                    { label: "1yr", days: 365 },
                    { label: "2yr", days: 730 },
                    { label: "3yr", days: 1095 },
                  ].map((p) => (
                    <button
                      key={p.days}
                      type="button"
                      onClick={() => setHorizonDays(p.days)}
                      className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${horizonDays === p.days ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground"}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">When your value-weighted average days-to-maturity approaches or exceeds this horizon, the Dashboard's Avg. Maturity tile escalates from green to amber to red. Set it to the point beyond which locking up cash would strain your liquidity. Default 365 days.</p>
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
              <p className="text-xs text-muted-foreground mt-1">
                {hasFund
                  ? `The projection uses ${selectedFundLabel}'s effective annual yield (gross). Change it on the MMF Strategy page by switching funds — this field is informational while a fund is selected.`
                  : "No MMF fund selected — the projection uses this manual gross yield as a fallback. Select a fund on the MMF Strategy page to drive it from the fund's published EAR."}
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {hasFund ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-medium">{selectedFundLabel} Annual Yield (Gross) — authoritative</Label>
                  <div className="flex items-baseline gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                    <span className="text-lg font-semibold text-foreground">{selectedFundEar.toFixed(2)}%</span>
                    <span className="text-xs text-muted-foreground">gross → net ≈ {(selectedFundEar * (1 - whtFrac)).toFixed(2)}% after {whtPct.toFixed(0)}% WHT</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Driven by the selected fund; the manual MMF yield below is ignored while a fund is active.</p>
                </div>
              ) : (
                <RateField label="MMF Annual Yield (Gross, fallback)" name="mmfYield" register={rateForm.register} description={`Used only when no fund is selected. Net ≈ ${(Number(rateForm.watch("mmfYield") || 0) * (1 - whtFrac)).toFixed(2)}% after ${whtPct.toFixed(0)}% WHT`} />
              )}
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
              <RateField label="FXD Coupon Rate (Gross)" name="fxdCouponRate" register={rateForm.register} description={`Default 12.35%. Net ≈ ${(Number(rateForm.watch("fxdCouponRate") || 0) * (1 - whtFrac)).toFixed(2)}% after ${whtPct.toFixed(0)}% WHT`} />
              <RateField label="Withholding Tax Rate" name="withholdingTax" register={rateForm.register} description="Default: 15%" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Per-Tenor Bond Rates (optional)</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Set a distinct gross coupon for each IFB / FXD tenor band. Blank cells fall back to the flat coupon above. These rates auto-populate when you pick a tenor on the Securities or Record Deposit forms.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 space-y-5">
              <div>
                <p className="text-xs font-semibold text-foreground mb-2">IFB tenors (tax-exempt)</p>
                <TenorRateGrid kind="ifb" value={ifbTenorRates} onChange={setIfbTenorRates} />
              </div>
              <div>
                <p className="text-xs font-semibold text-foreground mb-2">FXD tenors (15% WHT &lt; 10y, 10% ≥ 10y)</p>
                <TenorRateGrid kind="fxd" value={fxdTenorRates} onChange={setFxdTenorRates} />
              </div>
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

      <AlertDialog open={!!pendingPlan} onOpenChange={(open) => { if (!open) setPendingPlan(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-500" />
              Switch to Yield-first allocation?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Yield-first deliberately relaxes your per-type concentration cap toward 100% and
                  concentrates liquid cash in the single highest net-of-tax home. This can raise returns
                  but increases <strong>concentration risk</strong> — more of your money rests with one issuer/type.
                </p>
                <p>
                  Government securities remain sovereign-exempt, but bank and MMF concentration warnings
                  will be evaluated <strong>within this chosen policy</strong>. You can switch back to Balanced at any time.
                </p>
                <p className="text-xs text-muted-foreground">
                  We&rsquo;ll record this acknowledgment with a timestamp in your change log.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmYieldFirst(); }}
              disabled={acknowledgeYieldFirst.isPending || updatePortfolioMutation.isPending}
            >
              {acknowledgeYieldFirst.isPending ? "Acknowledging…" : "I understand — enable Yield-first"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
