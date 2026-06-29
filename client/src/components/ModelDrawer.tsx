import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Sparkles,
  Info,
  ShieldAlert,
  FlaskConical,
  ArrowRight,
  Droplets,
  TrendingUp,
  HelpCircle,
} from "lucide-react";
import { profileFor, type AssetClass } from "@shared/assetModel";
import { defaultRiskFor } from "@shared/riskModel";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * Expansion Brief — Part 3: "Model in my plan" drawer.
 *
 * The user supplies every figure that drives their holding; catalog values are
 * only INDICATIVE prefills they can override. A live side-by-side preview shows
 * what the holding does to net worth, allocation, concentration and liquidity —
 * and the holding's OWN assumed-return scenario, explicitly labelled as the
 * user's assumption, never an engine forecast. Committing records a real holding
 * through the existing actuals path (respecting Live/Test). Nothing here buys,
 * recommends, ranks, or auto-selects.
 */

export interface ModelDrawerOpportunity {
  ref: string;
  name: string;
  assetClass: string;
  currency: string | null;
  lastPrice: string | null;
  yieldPct: string | null;
  yieldKind: string | null;
  trailingReturnPct: string | null;
  dataSource: string | null;
  dataAsOf: Date | string | null;
}

function n(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function fmtKes(v: number): string {
  return `KES ${Math.round(v).toLocaleString("en-KE")}`;
}

export function ModelDrawer({
  opportunity,
  open,
  onOpenChange,
}: {
  opportunity: ModelDrawerOpportunity;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { mode, portfolioId } = usePortfolio();
  const [, navigate] = useLocation();
  const profile = profileFor(opportunity.assetClass as AssetClass);

  // ── User inputs (catalog values prefill, but the user owns them all) ─────────
  const indicativePrice = n(opportunity.lastPrice);
  const indicativeYield = n(opportunity.yieldPct);

  const [amountKes, setAmountKes] = useState<string>("");
  const [units, setUnits] = useState<string>("");
  const [unitPrice, setUnitPrice] = useState<string>(
    indicativePrice != null ? String(indicativePrice) : "",
  );
  const [currency, setCurrency] = useState<string>(opportunity.currency ?? "KES");
  const [fxRateToKes, setFxRateToKes] = useState<string>(profile.fxExposed ? "" : "1");
  const [incomeRatePct, setIncomeRatePct] = useState<string>(
    indicativeYield != null ? String(indicativeYield) : "",
  );
  const [retCons, setRetCons] = useState<string>("");
  const [retBase, setRetBase] = useState<string>("");
  const [retOpt, setRetOpt] = useState<string>("");
  const [fundedFromLiquid, setFundedFromLiquid] = useState<boolean>(false);
  // Part 4: income behaviour — cadence, where income goes, and an editable WHT.
  const [incomeCadence, setIncomeCadence] = useState<
    "annual" | "semiannual" | "quarterly" | "none"
  >(profile.incomeType === "coupon" ? "semiannual" : "annual");
  const [incomeDisposition, setIncomeDisposition] = useState<"sweep" | "reinvest">("sweep");
  const [userTaxRatePct, setUserTaxRatePct] = useState<string>("");

  // Build the query input. Stable enough across renders to avoid refetch storms.
  const previewInput = useMemo(() => {
    if (!portfolioId) return null;
    return {
      portfolioId,
      assetClass: opportunity.assetClass as
        | "equity" | "reit" | "offshore_fund" | "cash_mmf"
        | "bank_deposit" | "gov_discount" | "gov_coupon" | "alt",
      name: opportunity.name,
      amountKes: n(amountKes),
      units: n(units),
      unitPrice: n(unitPrice),
      currency: currency || null,
      fxRateToKes: n(fxRateToKes),
      incomeRatePct: n(incomeRatePct),
      incomeCadence,
      incomeDisposition,
      userTaxRatePct: n(userTaxRatePct),
      assumedReturnConservative: n(retCons),
      assumedReturnBase: n(retBase),
      assumedReturnOptimistic: n(retOpt),
      fundedFromLiquid,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    portfolioId, opportunity.assetClass, opportunity.name, amountKes, units,
    unitPrice, currency, fxRateToKes, incomeRatePct, retCons, retBase, retOpt,
    fundedFromLiquid, incomeCadence, incomeDisposition, userTaxRatePct,
  ]);

  const previewQuery = trpc.modeling.preview.useQuery(
    previewInput ?? ({} as NonNullable<typeof previewInput>),
    { enabled: open && !!previewInput, retry: false, placeholderData: (prev) => prev },
  );

  const utils = trpc.useUtils();
  const commit = trpc.modeling.commit.useMutation({
    onSuccess: (res) => {
      toast.success("Modeled holding recorded", {
        description: `${opportunity.name} is now tracked in your ${mode === "sandbox" ? "Test" : "Live"} plan.`,
        action: {
          label: "View",
          onClick: () => navigate("/other-assets"),
        },
      });
      utils.otherHoldings.invalidate();
      utils.projection.decisionSurface.invalidate();
      onOpenChange(false);
    },
    onError: (e) => toast.error("Could not record holding", { description: e.message }),
  });

  const p = previewQuery.data;
  const amount = p?.amountKes ?? 0;
  const issues = p?.issues ?? [];
  const valid = p?.valid ?? false;
  const pv = p?.preview;

  const handleCommit = () => {
    if (!portfolioId || !previewInput) return;
    commit.mutate({
      ...previewInput,
      catalogRef: opportunity.ref,
      dataSource: opportunity.dataSource ?? null,
      dataAsOf: opportunity.dataAsOf ? new Date(opportunity.dataAsOf).toISOString().slice(0, 10) : null,
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto p-0">
        <SheetHeader className="px-5 pt-5 pb-3 sticky top-0 bg-background z-10 border-b">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle className="flex items-center gap-2 text-lg">
              <Sparkles className="w-4 h-4 text-primary" />
              Model in my plan
            </SheetTitle>
            <Badge
              variant="outline"
              className={`text-[10px] font-bold uppercase tracking-wide ${mode === "sandbox" ? "border-amber-500/40 text-amber-600 dark:text-amber-400" : ""}`}
            >
              {mode === "sandbox" ? "Hypothetical · Test" : "Hypothetical"}
            </Badge>
          </div>
          <SheetDescription className="text-xs">
            {opportunity.name} · {profile.label}. A what-if only — it never buys
            anything or moves real money.
          </SheetDescription>
        </SheetHeader>

        <div className="px-5 py-4 space-y-5">
          {/* Indicative banner */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
            <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
              Catalog figures are <strong>indicative</strong> and may be delayed.
              Every input below is yours to set — change anything to match what
              you would actually do.
            </p>
          </div>

          {/* ── Inputs ─────────────────────────────────────────────────── */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Your inputs
            </h3>

            {profile.priceDriven ? (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Units / shares</Label>
                  <Input
                    inputMode="decimal"
                    value={units}
                    onChange={(e) => setUnits(e.target.value)}
                    placeholder="e.g. 1000"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    Price / unit ({currency})
                    {indicativePrice != null && (
                      <span className="text-[10px] text-muted-foreground">· catalog {indicativePrice}</span>
                    )}
                  </Label>
                  <Input
                    inputMode="decimal"
                    value={unitPrice}
                    onChange={(e) => setUnitPrice(e.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Amount (KES)</Label>
                <Input
                  inputMode="decimal"
                  value={amountKes}
                  onChange={(e) => setAmountKes(e.target.value)}
                  placeholder="e.g. 250000"
                />
              </div>
            )}

            {profile.priceDriven && (
              <div className="space-y-1.5">
                <Label className="text-xs">Or override amount directly (KES)</Label>
                <Input
                  inputMode="decimal"
                  value={amountKes}
                  onChange={(e) => setAmountKes(e.target.value)}
                  placeholder="leave blank to use units × price"
                />
              </div>
            )}

            {profile.fxExposed && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Currency</Label>
                  <Input value={currency} onChange={(e) => setCurrency(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    FX rate (KES per {currency || "unit"})
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <HelpCircle className="w-3 h-3 text-muted-foreground" />
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[220px] text-xs">
                        Required for non-KES instruments. Your value, not a live rate —
                        it is part of your assumption.
                      </TooltipContent>
                    </Tooltip>
                  </Label>
                  <Input
                    inputMode="decimal"
                    value={fxRateToKes}
                    onChange={(e) => setFxRateToKes(e.target.value)}
                    placeholder="e.g. 129.5"
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                Assumed income rate (%/yr)
                {indicativeYield != null && (
                  <span className="text-[10px] text-muted-foreground">· catalog {indicativeYield}%</span>
                )}
              </Label>
              <Input
                inputMode="decimal"
                value={incomeRatePct}
                onChange={(e) => setIncomeRatePct(e.target.value)}
                placeholder="dividend / distribution / coupon"
              />
            </div>

            {/* Part 4: income behaviour — cadence + disposition + editable WHT */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Income paid</Label>
                <Select
                  value={incomeCadence}
                  onValueChange={(v) => setIncomeCadence(v as typeof incomeCadence)}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Once a year</SelectItem>
                    <SelectItem value="semiannual">Twice a year</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="none">No income</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">When income arrives</Label>
                <Select
                  value={incomeDisposition}
                  onValueChange={(v) => setIncomeDisposition(v as typeof incomeDisposition)}
                >
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sweep">Take it as cash (sweep)</SelectItem>
                    <SelectItem value="reinvest">Reinvest it (DRIP)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs flex items-center gap-1">
                Withholding tax on income (%)
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-xs">
                    Tax on the income, not the capital. Local dividends/coupons use a
                    known rate (5%). For REITs we apply the sourced resident 5% and for
                    offshore funds an UNVERIFIED 15% benchmark — both depend on your own
                    circumstances, so confirm or override them here.
                  </TooltipContent>
                </Tooltip>
              </Label>
              <Input
                inputMode="decimal"
                value={userTaxRatePct}
                onChange={(e) => setUserTaxRatePct(e.target.value)}
                placeholder="leave blank to use the default for this class"
              />
            </div>

            {/* Assumed return scenarios — explicitly the user's own */}
            <div className="space-y-2">
              <Label className="text-xs flex items-center gap-1">
                Your assumed annual return (%/yr)
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[240px] text-xs">
                    These are <strong>your</strong> assumptions, used only to show this
                    holding's own scenario. The tool never forecasts a return for you,
                    and they do not change the engine's KES 5M projection.
                  </TooltipContent>
                </Tooltip>
              </Label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Input inputMode="decimal" value={retCons} onChange={(e) => setRetCons(e.target.value)} placeholder="Cons." />
                  <p className="text-[10px] text-muted-foreground mt-1 text-center">Conservative</p>
                </div>
                <div>
                  <Input inputMode="decimal" value={retBase} onChange={(e) => setRetBase(e.target.value)} placeholder="Base" />
                  <p className="text-[10px] text-muted-foreground mt-1 text-center">Base</p>
                </div>
                <div>
                  <Input inputMode="decimal" value={retOpt} onChange={(e) => setRetOpt(e.target.value)} placeholder="Opt." />
                  <p className="text-[10px] text-muted-foreground mt-1 text-center">Optimistic</p>
                </div>
              </div>
              {n(opportunity.trailingReturnPct) != null && (
                <p className="text-[10px] text-muted-foreground">
                  For reference only, the catalog shows a trailing 12-month return of{" "}
                  {n(opportunity.trailingReturnPct)!.toFixed(2)}% — past performance, not a prediction.
                </p>
              )}
            </div>

            {/* Funding source */}
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-start gap-2">
                <Droplets className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium">Fund this from my liquid pot</p>
                  <p className="text-[10px] text-muted-foreground max-w-[260px]">
                    On: models moving money out of your primary MMF (shows the liquidity
                    trade-off). Off: treats it as new outside money.
                  </p>
                </div>
              </div>
              <Switch checked={fundedFromLiquid} onCheckedChange={setFundedFromLiquid} />
            </div>
          </div>

          <Separator />

          {/* ── Live side-by-side preview ──────────────────────────────── */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" /> What this does to your picture
            </h3>

            {!valid ? (
              <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
                {issues.length > 0 ? (
                  <ul className="list-disc list-inside space-y-1">
                    {issues.map((i, k) => <li key={k}>{i}</li>)}
                  </ul>
                ) : (
                  "Enter your inputs above to see the hypothetical impact."
                )}
              </div>
            ) : pv ? (
              <div className="space-y-3">
                {/* Net worth before/after */}
                <div className="rounded-lg border p-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Net worth</span>
                    <span className="flex items-center gap-2 font-medium tabular-nums">
                      {fmtKes(pv.netWorthBefore)}
                      <ArrowRight className="w-3 h-3 text-muted-foreground" />
                      {fmtKes(pv.netWorthAfter)}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {fundedFromLiquid
                      ? "Funded from your liquid pot — net worth is unchanged, the mix shifts."
                      : `Adds ${fmtKes(amount)} of new outside money.`}
                  </p>
                </div>

                {/* Allocation share + liquidity */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border p-3">
                    <p className="text-[10px] text-muted-foreground">This holding's share</p>
                    <p className="text-lg font-semibold tabular-nums">{pv.holdingSharePct.toFixed(1)}%</p>
                    <p className="text-[10px] text-muted-foreground">of net worth after</p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-[10px] text-muted-foreground">Liquid pot</p>
                    <p className="text-lg font-semibold tabular-nums">{fmtKes(pv.liquidAfter)}</p>
                    {pv.reducesLiquidity && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400">
                        ↓ from {fmtKes(pv.liquidBefore)}
                      </p>
                    )}
                  </div>
                </div>

                {pv.reducesLiquidity && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
                    <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                      This moves {fmtKes(amount)} out of your liquid, KES-stable pot into a
                      {profile.insured === "none" ? " not-insured," : ""}
                      {profile.priceDriven ? " price-driven" : ""} holding. It reduces money
                      available for near-term goal needs.
                    </p>
                  </div>
                )}

                {/* Holding's own assumed scenario */}
                {(pv.scenario.conservative != null || pv.scenario.base != null || pv.scenario.optimistic != null) && (
                  <div className="rounded-lg border p-3">
                    <p className="text-[10px] text-muted-foreground mb-2">
                      This holding's value in {pv.scenario.years.toFixed(1)} yrs — on{" "}
                      <strong>your</strong> assumed returns (not a forecast):
                    </p>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <ScenarioCell label="Conservative" value={pv.scenario.conservative} />
                      <ScenarioCell label="Base" value={pv.scenario.base} />
                      <ScenarioCell label="Optimistic" value={pv.scenario.optimistic} />
                    </div>
                  </div>
                )}

                {/* Part 6: price-volatility honesty note. For a price-driven /
                    FX holding, a single "value in N years" line understates the
                    swing. We surface the assumed annual volatility for the class
                    so the user reads the scenario as a midpoint, not a promise. */}
                {profile.priceDriven && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
                    <TrendingUp className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-800 dark:text-amber-300 leading-relaxed">
                      This is a market-priced holding, so its value rises and falls.
                      A typical year could swing roughly
                      {" "}±{defaultRiskFor(opportunity.assetClass as AssetClass).volatilityPct}% around the figures above
                      {profile.fxExposed ? ", and the foreign-currency exposure adds exchange-rate movement on top" : ""}.
                      Treat the scenarios as a midpoint of a range, not a forecast — your
                      goal probability on the Dashboard reflects this uncertainty.
                    </p>
                  </div>
                )}

                {/* Part 4: capital vs income decomposition (base scenario) */}
                {pv.income && pv.income.netOverHorizonBase != null && pv.income.netOverHorizonBase > 0 && (
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-[10px] text-muted-foreground">
                      Where the base-case return comes from — capital growth and
                      income are shown separately so income is never counted twice:
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-md bg-muted/40 p-2">
                        <p className="text-[10px] text-muted-foreground">Capital at horizon</p>
                        <p className="text-sm font-semibold tabular-nums">
                          {pv.scenario.base != null ? fmtKes(pv.scenario.base - (pv.income.disposition === "sweep" ? (pv.income.netOverHorizonBase ?? 0) : 0)) : "—"}
                        </p>
                      </div>
                      <div className="rounded-md bg-muted/40 p-2">
                        <p className="text-[10px] text-muted-foreground">
                          Net income {pv.income.disposition === "reinvest" ? "reinvested" : "received"}
                        </p>
                        <p className="text-sm font-semibold tabular-nums">
                          {fmtKes(pv.income.netOverHorizonBase ?? 0)}
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      After {pv.income.taxRatePct != null ? `${pv.income.taxRatePct}%` : "the assumed"} withholding tax on income.{" "}
                      {pv.income.disposition === "reinvest"
                        ? "Reinvested back into the holding (DRIP), so it is already inside the capital figure."
                        : "Swept to cash as it is paid."}
                    </p>
                    {pv.income.taxRequiresReview && (
                      <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-2 flex items-start gap-2">
                        <ShieldAlert className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-[10px] text-amber-800 dark:text-amber-300 leading-relaxed">
                          {pv.income.taxUnverified ? (
                            <>
                              The {pv.income.taxRatePct ?? 15}% rate applied here is an{" "}
                              <strong>unverified benchmark</strong>. Kenyan residents are taxed on
                              worldwide income, but the actual withholding depends on the fund's
                              jurisdiction and any tax treaty. Confirm or override it above before
                              relying on this figure.
                            </>
                          ) : (
                            <>
                              We applied the sourced resident {pv.income.taxRatePct ?? 5}% rate, but the
                              exact treatment depends on your circumstances and the specific REIT.
                              Confirm or override it above.
                            </>
                          )}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Part 4: price-flat caution when no return assumption supplied */}
                {pv.income && pv.income.priceFlat && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
                    No total-return assumption was entered, so the capital value is held
                    flat — only income (if any) accrues. Enter your assumed returns above to
                    model price growth.
                  </p>
                )}

                {/* Engine-projection honesty note */}
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Your KES 5M projection band is unchanged — this holding is tracked as a
                  net-worth asset, not a deterministic engine input. Its future value depends
                  on prices and your assumptions, which the tool does not predict.
                </p>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Calculating…</div>
            )}
          </div>

          {/* ── Actions ────────────────────────────────────────────────── */}
          <div className="flex items-center gap-2 pt-1">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              className="flex-1 active:scale-[0.97] transition-transform"
              disabled={!valid || commit.isPending || !portfolioId}
              onClick={handleCommit}
            >
              {commit.isPending ? "Recording…" : `Track in my ${mode === "sandbox" ? "Test" : "Live"} plan`}
            </Button>
          </div>

          <p className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            {mode === "sandbox" ? <FlaskConical className="w-3 h-3" /> : <Info className="w-3 h-3" />}
            Tracking records a holding you can edit, exit, or delete anytime. It never
            executes a real purchase{mode === "sandbox" ? " and stays in your sandbox" : ""}.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ScenarioCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <p className="text-sm font-semibold tabular-nums">
        {value != null ? fmtKes(value) : "—"}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
