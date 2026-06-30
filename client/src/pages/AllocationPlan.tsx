import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { usePortfolio } from "@/contexts/PortfolioContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoHint } from "@/components/InfoHint";
import { toast } from "sonner";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  ALLOCATION_TIERS,
  ALLOCATION_BUCKETS,
  ALLOCATION_BUCKET_LABELS,
  ALLOCATION_TIER_SPECS,
  tierSpec,
  tierRank,
  BUCKET_RISK_CLASS,
  type AllocationTier,
  type AllocationBucket,
} from "@shared/allocationModel";
import { getPhasePlainLabel } from "@/lib/format";
import { formatKES, formatKESCompact } from "@/lib/format";
import {
  ShieldCheck,
  TrendingUp,
  AlertTriangle,
  ArrowRight,
  Clock,
  Wallet,
  Layers,
  Info,
  CheckCircle2,
  Lock,
} from "lucide-react";

/* ───────────────────────── presentation helpers ───────────────────────── */

// Stable, color-blind-aware palette for the five behavior buckets. Cash safest
// (cool/calm) → offshore riskiest (warm). Used by both the chart and legends.
const BUCKET_COLOR: Record<AllocationBucket, string> = {
  cash: "#0ea5e9", // sky
  gov: "#10b981", // emerald
  equity: "#f59e0b", // amber
  reit: "#8b5cf6", // violet
  offshore: "#ef4444", // red
};

// Plain-language, jargon-free explanation of each bucket for the layman tooltip.
const BUCKET_PLAIN: Record<AllocationBucket, string> = {
  cash: "Money-market funds and bank deposits. Easiest to access, smallest ups and downs.",
  gov: "Government paper (T-bills, bonds). Backed by the government; held to maturity it is steady.",
  equity: "Company shares (the stock market). Bigger long-run growth, bigger swings along the way.",
  reit: "Property funds (REITs). Earns from real estate without you buying a building.",
  offshore: "Foreign / hard-currency funds. Spreads you outside Kenya, adds currency swings.",
};

function pct(n: number, dp = 0): string {
  if (!isFinite(n)) return "0%";
  return `${n.toFixed(dp)}%`;
}

/* ───────────────────────────── the page ───────────────────────────────── */

export default function AllocationPlan({ embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId, portfolio } = usePortfolio();
  const [, navigate] = useLocation();

  if (portfolioId == null) {
    return (
      <AppShell embedded={embedded}>
        <div className="container py-10">
          <EmptyGoalState />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell embedded={embedded}>
      <div className="container max-w-5xl py-8 space-y-6">
        <PageHeader goalName={portfolio?.name ?? "this goal"} />
        <PlanBody
          portfolioId={portfolioId}
          goalName={portfolio?.name ?? "this goal"}
          targetAmount={Number((portfolio as { targetAmount?: number } | null)?.targetAmount) || 0}
          navigate={navigate}
        />
      </div>
    </AppShell>
  );
}

function PageHeader({ goalName }: { goalName: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Layers className="w-5 h-5 text-primary" />
        <h1 className="text-2xl font-semibold tracking-tight">Allocation Plan</h1>
      </div>
      <p className="text-sm text-muted-foreground max-w-3xl">
        A target mix for <span className="font-medium text-foreground">{goalName}</span> and how it is
        designed to shift over time. Everything here is a{" "}
        <InfoHint label="plan, not advice">
          This shows a modeled target and the odds it implies under assumed returns. It is not financial
          advice, not a promise of any return, and nothing moves your money. You decide what to do.
        </InfoHint>{" "}
        — nothing changes your holdings until you choose to act.
      </p>
    </div>
  );
}

function PlanBody({
  portfolioId,
  goalName,
  targetAmount,
  navigate,
}: {
  portfolioId: number;
  goalName: string;
  /** The portfolio's REAL goal target (KES) — same field the Dashboard reads. */
  targetAmount: number;
  navigate: (to: string) => void;
}) {
  const tierQ = trpc.allocation.goalTier.useQuery({ portfolioId });
  const utils = trpc.useUtils();

  const setTier = trpc.allocation.setTier.useMutation({
    onSuccess: () => {
      utils.allocation.goalTier.invalidate({ portfolioId });
      utils.allocation.holdingsGap.invalidate();
      toast.success("Target tier updated", {
        description: "This changes the plan only — none of your holdings moved.",
      });
    },
    onError: (e) => toast.error("Could not update tier", { description: e.message }),
  });

  if (tierQ.isLoading) return <LoadingState />;
  if (tierQ.error || !tierQ.data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Could not load the plan for this goal. {tierQ.error?.message}
        </CardContent>
      </Card>
    );
  }

  const { suggestion, selection, horizonRemainingMonths } = tierQ.data;
  const selectedTier = selection.selectedTier;

  return (
    <div className="space-y-6">
      <TierCard
        suggestion={suggestion}
        selection={selection}
        horizonRemainingMonths={horizonRemainingMonths}
        saving={setTier.isPending}
        onPick={(tier) => setTier.mutate({ portfolioId, tier })}
      />

      <CommitPlanBar portfolioId={portfolioId} selectedTier={selectedTier} />

      <ProbabilityCard
        portfolioId={portfolioId}
        goal={targetAmount}
        tier={selectedTier}
        horizonRemainingMonths={horizonRemainingMonths}
      />

      <GlideJourneyCard tier={selectedTier} horizonMonths={horizonRemainingMonths} />

      <HoldingsGapCard portfolioId={portfolioId} goalName={goalName} onExplore={navigate} />
    </div>
  );
}

/* ─────────────────────────── 1. Tier + suggestion ─────────────────────── */

function TierCard({
  suggestion,
  selection,
  horizonRemainingMonths,
  saving,
  onPick,
}: {
  suggestion: { tier: AllocationTier; baseTier: AllocationTier; reason: string };
  selection: { selectedTier: AllocationTier; userOverrode: boolean; conflictsWithHorizon: boolean };
  horizonRemainingMonths: number;
  saving: boolean;
  onPick: (tier: AllocationTier) => void;
}) {
  const years = (horizonRemainingMonths / 12).toFixed(1);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <CardTitle className="text-base">Your risk tier</CardTitle>
          </div>
          <Badge variant="outline" className="gap-1 font-normal">
            <Clock className="w-3 h-3" />
            ~{years} yrs to go
          </Badge>
        </div>
        <CardDescription>
          A{" "}
          <InfoHint label="risk tier">
            How much short-term ups and downs you accept in exchange for higher expected long-run growth.
            Safer tiers hold more cash and government paper; riskier tiers hold more shares and offshore
            funds.
          </InfoHint>{" "}
          sets the target mix. We suggest one from your time horizon; you can change it freely.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* The suggestion + plain reason */}
        <div className="rounded-lg border bg-muted/40 p-3 text-sm flex gap-2">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
          <p className="text-muted-foreground">{suggestion.reason}</p>
        </div>

        {/* Tier picker — every tier always selectable (override always wins) */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {ALLOCATION_TIERS.map((tier) => {
            const spec = ALLOCATION_TIER_SPECS[tier];
            const isSelected = tier === selection.selectedTier;
            const isSuggested = tier === suggestion.tier;
            return (
              <button
                key={tier}
                type="button"
                disabled={saving}
                onClick={() => onPick(tier)}
                className={[
                  "text-left rounded-lg border p-3 transition-all duration-150 active:scale-[0.98]",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected
                    ? "border-primary ring-1 ring-primary bg-primary/5"
                    : "hover:border-muted-foreground/40",
                  saving ? "opacity-60 cursor-wait" : "",
                ].join(" ")}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{spec.label}</span>
                  {isSuggested && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                      Suggested
                    </Badge>
                  )}
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground mt-1">
                  {spec.description}
                </p>
              </button>
            );
          })}
        </div>

        {/* Consequence flag — never a block */}
        {selection.conflictsWithHorizon && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-600" />
            <p className="text-amber-900 dark:text-amber-200">
              You picked a tier riskier than your time horizon suggests. That is allowed — this is your
              plan. It means larger swings close to your goal date, when there is less time to recover
              from a bad year. The probability below already reflects this choice.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ────────────────────── 1b. Commit plan to the ledger ──────────────────── */

/**
 * CommitPlanBar — turns the chosen tier into the *committed* plan.
 *
 * The selected tier already persists on every pick (allocation.setTier). This
 * bar adds the explicit, dated commitment the rest of the app reads through the
 * canonical snapshot's `planStatus`: once committed, the Dashboard, Ledger and
 * Review all agree "this is the plan in force". It changes no holdings and moves
 * no money — it only records the decision.
 */
function CommitPlanBar({
  portfolioId,
  selectedTier,
}: {
  portfolioId: number;
  selectedTier: AllocationTier;
}) {
  const utils = trpc.useUtils();
  const snapQ = trpc.portfolios.snapshot.useQuery({ portfolioId });
  const commit = trpc.allocation.commitPlan.useMutation({
    onSuccess: () => {
      utils.portfolios.snapshot.invalidate({ portfolioId });
      utils.allocation.goalTier.invalidate({ portfolioId });
      toast.success("Plan committed", {
        description:
          "Recorded as the plan in force. No holdings moved — you still act when you choose.",
      });
    },
    onError: (e) => toast.error("Could not commit plan", { description: e.message }),
  });

  const committedAt = snapQ.data?.identity.planCommittedAt ?? null;
  const isCommitted = (snapQ.data?.identity.planStatus ?? "draft") === "committed";

  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-2.5 min-w-0">
            {isCommitted ? (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-600 mt-0.5" />
            ) : (
              <Lock className="w-5 h-5 shrink-0 text-muted-foreground mt-0.5" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {isCommitted ? "Plan committed" : "Plan not committed yet"}{" "}
                <InfoHint label="">
                  Committing records the chosen tier as the plan in force, so the Dashboard, Ledger and
                  Review all read the same strategy. It never moves money or changes a holding.
                </InfoHint>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isCommitted && committedAt
                  ? `Last committed ${new Date(committedAt).toLocaleString()}. Re-commit to record a changed tier.`
                  : "Recording the plan keeps every screen in agreement. Nothing changes your holdings."}
              </p>
            </div>
          </div>
          <Button
            onClick={() => commit.mutate({ portfolioId, tier: selectedTier })}
            disabled={commit.isPending}
            variant={isCommitted ? "outline" : "default"}
            className={isCommitted ? "bg-background" : ""}
          >
            {commit.isPending ? "Saving…" : isCommitted ? "Re-commit plan" : "Commit this plan"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────── 2. Probability + range + levers ───────────────── */

function ProbabilityCard({
  portfolioId,
  goal,
  tier,
  horizonRemainingMonths,
}: {
  portfolioId: number;
  /** The portfolio's REAL goal target (KES) — identical to the Dashboard's. */
  goal: number;
  tier: AllocationTier;
  horizonRemainingMonths: number;
}) {
  // The probability is only honest if all three inputs come from the REAL
  // portfolio: (1) goal target — passed in as `goal` (= portfolio.targetAmount);
  // (2) horizon — `horizonRemainingMonths`; (3) the plan's own projected end
  // value (driven by the real contribution schedule + rates), which we read from
  // the SAME projection engine the Dashboard uses (`projection.run`) rather than
  // any default. We then split that projected end value into the price-volatile
  // part (classified holdings that follow the glided mix → modeled stochastically)
  // and the deterministic remainder (contributions + fixed income → folded in as
  // `extraCertainEndValue`). This keeps the page consistent with the Dashboard.
  const gapQ = trpc.allocation.holdingsGap.useQuery({ portfolioId, tier });
  const projQ = trpc.projection.run.useQuery({ portfolioId });

  // The price-volatile pot that follows the glided risky mix today.
  const riskyValue = Math.max(0, gapQ.data?.readout.rollup.classifiedKes ?? 0);
  // The plan's projected end value at the goal date (last projected month),
  // exactly the figure the Dashboard shows as "Projected ≈ …".
  const projectedEndValue = (() => {
    const rows = projQ.data;
    if (!rows || rows.length === 0) return 0;
    return Math.max(0, Number(rows[rows.length - 1]?.totalEnd) || 0);
  })();
  // Everything the plan reaches that ISN'T the modeled risky pot arrives with
  // (modeled) certainty — contributions compounded + fixed-income growth.
  const extraCertainEndValue = Math.max(0, projectedEndValue - riskyValue);

  const probQ = trpc.allocation.goalProbability.useQuery(
    {
      tier,
      horizonMonths: Math.max(1, horizonRemainingMonths),
      goal: Math.max(0, goal),
      riskyValue,
      extraCertainEndValue,
    },
    { enabled: gapQ.isSuccess && projQ.isSuccess },
  );

  if (gapQ.isLoading || projQ.isLoading || probQ.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Chance of reaching your goal</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (!probQ.data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Not enough data to model the odds yet. Add some holdings to this goal first.
        </CardContent>
      </Card>
    );
  }

  const d = probQ.data;
  const probPct = d.probability.probabilityPct;
  const toneColor =
    d.insight.tone === "comfortable"
      ? "text-emerald-600"
      : d.insight.tone === "low"
        ? "text-amber-600"
        : "text-foreground";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <CardTitle className="text-base">Chance of reaching your goal</CardTitle>
        </div>
        <CardDescription>
          A{" "}
          <InfoHint label="modeled probability">
            An estimate from running many simulated futures using assumed average returns and typical
            swings for each asset. Real markets will differ — treat it as a guide, not a guarantee.
          </InfoHint>{" "}
          of finishing at or above {formatKESCompact(goal)} on this plan.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <div className={`text-5xl font-bold tabular-nums ${toneColor}`}>{pct(probPct)}</div>
            <div className="text-xs text-muted-foreground mt-1">modeled chance</div>
          </div>
          <div className="flex-1 min-w-[200px]">
            {/* p10–p90 outcome range */}
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <span>Likely range of outcomes</span>
              <InfoHint>
                The middle 80% of simulated results: about 1-in-10 land below the low figure, and
                1-in-10 above the high. The gap shows how uncertain the outcome is.
              </InfoHint>
            </div>
            <div className="flex items-center justify-between text-sm font-medium tabular-nums">
              <span className="text-amber-600">{formatKES(d.distribution.p10)}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-emerald-600">{formatKES(d.distribution.p90)}</span>
            </div>
            <div className="h-2 mt-1 rounded-full bg-gradient-to-r from-amber-400 via-sky-400 to-emerald-400" />
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-0.5">
              <span>worse 10%</span>
              <span>midpoint {formatKESCompact(d.distribution.p50)}</span>
              <span>better 10%</span>
            </div>
          </div>
        </div>

        {/* Two-sided factual insight */}
        <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          {d.insight.message}
        </div>

        {/* The three neutral levers */}
        <div>
          <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
            What moves this number
            <InfoHint>
              Each option is shown on its own, with no ranking and nothing pre-selected. They are facts
              about the math, not suggestions about what you should do.
            </InfoHint>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {d.levers.map((lv, i) => (
              <LeverChip key={`${lv.kind}-${i}`} lever={lv} basePct={probPct} />
            ))}
          </div>
        </div>

        <p className="text-[11px] text-muted-foreground italic">{d.caveat}</p>
      </CardContent>
    </Card>
  );
}

function LeverChip({
  lever,
  basePct,
}: {
  lever: {
    kind: "more_time" | "more_contribution" | "more_risk";
    label: string;
    probabilityPct: number;
    deltaPct: number;
    downsideP10?: number;
    baselineP10?: number;
  };
  basePct: number;
}) {
  const up = lever.deltaPct >= 0;
  const kindLabel =
    lever.kind === "more_time"
      ? "More time"
      : lever.kind === "more_contribution"
        ? "Save more"
        : "More risk";
  return (
    <div className="rounded-lg border p-3 space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{kindLabel}</span>
        <Badge variant="outline" className="font-normal text-[11px]">
          {lever.label}
        </Badge>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">{pct(lever.probabilityPct)}</span>
        <span className={`text-xs tabular-nums ${up ? "text-emerald-600" : "text-amber-600"}`}>
          {up ? "+" : ""}
          {lever.deltaPct.toFixed(0)} pts
        </span>
      </div>
      {/* For the risk lever, always show the worsened downside alongside */}
      {lever.kind === "more_risk" && lever.downsideP10 != null && lever.baselineP10 != null && (
        <div className="text-[11px] text-muted-foreground">
          Worse-case (1-in-10){" "}
          <span className="text-amber-600 font-medium">{formatKESCompact(lever.downsideP10)}</span>{" "}
          vs now {formatKESCompact(lever.baselineP10)} — more risk widens the downside too.
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── 3. The glide journey ───────────────────────── */

function GlideJourneyCard({
  tier,
  horizonMonths,
}: {
  tier: AllocationTier;
  horizonMonths: number;
}) {
  const pathQ = trpc.allocation.glidePath.useQuery({
    tier,
    horizonMonths: Math.max(1, horizonMonths),
  });

  // Scrub position: index into the sampled points (0 = today, last = goal date).
  const [scrub, setScrub] = useState<number | null>(null);

  const points = pathQ.data?.points ?? [];
  const idx = scrub == null ? 0 : Math.min(scrub, Math.max(0, points.length - 1));
  const current = points[idx];

  const chartData = useMemo(
    () =>
      points.map((p, i) => ({
        i,
        month: p.monthIndex ?? i,
        phase: p.phase,
        ...ALLOCATION_BUCKETS.reduce(
          (acc, b) => {
            acc[b] = Math.round((p.weights[b] ?? 0) * 10) / 10;
            return acc;
          },
          {} as Record<AllocationBucket, number>,
        ),
      })),
    [points],
  );

  if (pathQ.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How your mix shifts over time</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-64 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <CardTitle className="text-base">How your mix shifts over time</CardTitle>
        </div>
        <CardDescription>
          This is a deliberate{" "}
          <InfoHint label="glide path">
            A planned, gradual shift from growth assets toward cash as your goal date nears — so a bad
            market right before you need the money can't undo years of saving. It is by design, not
            drift.
          </InfoHint>
          : more growth early, steadily safer near the end.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Stacked-area glide chart */}
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 11 }}
                tickFormatter={(m) => `M${m}`}
                minTickGap={24}
              />
              <YAxis
                tick={{ fontSize: 11 }}
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
                width={40}
              />
              <RTooltip content={<GlideTooltip />} />
              {ALLOCATION_BUCKETS.map((b) => (
                <Area
                  key={b}
                  type="monotone"
                  dataKey={b}
                  stackId="mix"
                  stroke={BUCKET_COLOR[b]}
                  fill={BUCKET_COLOR[b]}
                  fillOpacity={0.85}
                  isAnimationActive={false}
                />
              ))}
              {current && (
                <ReferenceLine
                  x={current.monthIndex ?? idx}
                  stroke="hsl(var(--foreground))"
                  strokeDasharray="4 2"
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-3">
          {ALLOCATION_BUCKETS.map((b) => (
            <div key={b} className="flex items-center gap-1.5 text-xs">
              <span
                className="inline-block w-3 h-3 rounded-sm"
                style={{ background: BUCKET_COLOR[b] }}
              />
              <InfoHint label={ALLOCATION_BUCKET_LABELS[b]}>{BUCKET_PLAIN[b]}</InfoHint>
            </div>
          ))}
        </div>

        {/* Scrubber */}
        {points.length > 1 && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Drag to see the target mix at any point</span>
              {current && (
                <Badge variant="secondary" className="font-normal">
                  {getPhasePlainLabel(current.phase)}
                </Badge>
              )}
            </div>
            <Slider
              value={[idx]}
              min={0}
              max={points.length - 1}
              step={1}
              onValueChange={(v) => setScrub(v[0])}
            />
            {current && (
              <div className="grid grid-cols-5 gap-2 pt-1">
                {ALLOCATION_BUCKETS.map((b) => (
                  <div key={b} className="text-center">
                    <div
                      className="text-sm font-semibold tabular-nums"
                      style={{ color: BUCKET_COLOR[b] }}
                    >
                      {pct(current.weights[b] ?? 0)}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {ALLOCATION_BUCKET_LABELS[b]}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function GlideTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover text-popover-foreground p-2 text-xs shadow-md">
      <div className="font-medium mb-1">Month {label}</div>
      {payload
        .slice()
        .reverse()
        .map((p: any) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1">
              <span
                className="inline-block w-2 h-2 rounded-sm"
                style={{ background: p.color }}
              />
              {ALLOCATION_BUCKET_LABELS[p.dataKey as AllocationBucket]}
            </span>
            <span className="tabular-nums font-medium">{pct(p.value)}</span>
          </div>
        ))}
    </div>
  );
}

/* ───────────────────────── 4. Gap vs current holdings ─────────────────── */

function HoldingsGapCard({
  portfolioId,
  goalName,
  onExplore,
}: {
  portfolioId: number;
  goalName: string;
  onExplore: (to: string) => void;
}) {
  const gapQ = trpc.allocation.holdingsGap.useQuery({ portfolioId });

  if (gapQ.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Target vs what you hold now</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (!gapQ.data) return null;

  const { readout } = gapQ.data;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Wallet className="w-4 h-4 text-primary" />
          <CardTitle className="text-base">Target vs what you hold now</CardTitle>
        </div>
        <CardDescription>
          A factual comparison of your goal's target mix against your current holdings. These are
          observations, not instructions — you choose whether to act on any of them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {readout.isEmpty ? (
          <div className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
            You don't hold anything classified into these buckets yet for {goalName}. The target mix
            above is your starting blueprint.
          </div>
        ) : (
          readout.gaps.map((g) => {
            const assetClass = BUCKET_RISK_CLASS[g.bucket];
            const dirLabel =
              g.direction === "aligned"
                ? "On target"
                : g.direction === "over"
                  ? "More than target"
                  : "Less than target";
            const dirColor =
              g.direction === "aligned"
                ? "text-emerald-600"
                : g.direction === "over"
                  ? "text-sky-600"
                  : "text-amber-600";
            return (
              <div
                key={g.bucket}
                className="flex items-center justify-between gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                      style={{ background: BUCKET_COLOR[g.bucket] }}
                    />
                    <span className="text-sm font-medium">
                      {ALLOCATION_BUCKET_LABELS[g.bucket]}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                    Now {pct(g.actualPct, 1)} · Target {pct(g.templatePct, 1)}
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <div className={`text-xs font-medium ${dirColor}`}>{dirLabel}</div>
                    {g.direction !== "aligned" && (
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {g.gapPp > 0 ? "+" : ""}
                        {g.gapPp.toFixed(1)} pts
                      </div>
                    )}
                  </div>
                  {g.direction === "under" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="bg-background gap-1"
                      onClick={() => onExplore(`/explore?class=${encodeURIComponent(assetClass)}`)}
                    >
                      Explore options
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}

        {readout.rollup.otherKes > 0 && (
          <div className="text-[11px] text-muted-foreground">
            {formatKES(readout.rollup.otherKes)} of your holdings doesn't map to these target buckets
            (e.g. property, SACCO, pension) and is excluded from the comparison above.
          </div>
        )}

        <div className="rounded-lg border border-dashed p-3 text-[11px] text-muted-foreground">
          "Explore options" just opens the instrument screener filtered to that class. It never buys,
          sells, or moves anything — you review and decide. {readout.caveat}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─────────────────────────── states ───────────────────────────────────── */

function LoadingState() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function EmptyGoalState() {
  return (
    <Card>
      <CardContent className="py-12 text-center space-y-2">
        <Layers className="w-8 h-8 mx-auto text-muted-foreground" />
        <h2 className="text-lg font-medium">No goal selected</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          Pick or create a goal first, then come back here to see its target mix, glide path, and the
          modeled odds of reaching it.
        </p>
      </CardContent>
    </Card>
  );
}

// Keep an unused-import guard friendly: tierRank/tierSpec are part of the public
// shared API used elsewhere; referenced here to avoid accidental tree-shake in
// type-only contexts.
void tierRank;
void tierSpec;
