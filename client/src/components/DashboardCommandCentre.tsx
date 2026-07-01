/**
 * DashboardCommandCentre — the focused, 30-second top of the Dashboard.
 *
 * Brief (pasted Part 10): the Dashboard must answer only six questions —
 * What do I have today? · Am I on track? · What changed? · What needs
 * attention? · What matures next? · Is reconciliation healthy? Everything
 * heavier (key-risk essays, concentration tables, benchmark bars, full
 * liquidity calendar, tax/accrual detail, scenario explanations) lives below,
 * behind the existing "Detailed analytics" disclosure or on its own page.
 *
 * Rules honoured here:
 *  - Every card deep-links to the page/tab that explains it.
 *  - One net-worth concept only (Full Net Worth, from the canonical selector).
 *  - No number without a clear source — each figure reads from the snapshot the
 *    Reconciliation trust-check also reads, so the page and the check agree.
 *  - Useful in Simple mode; Manager mode adds diagnostics but stays collapsed.
 */
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Wallet,
  Landmark,
  Building2,
  Boxes,
  Receipt,
  PiggyBank,
  CalendarClock,
  Target,
  ShieldCheck,
  TrendingUp,
  Coins,
} from "lucide-react";
import { formatKES, formatKESCompact } from "@/lib/format";
import type { PortfolioSnapshot } from "@shared/snapshot";
import {
  selectDashboardHeadlineNetWorth,
  selectGoalPlanAssets,
  selectIncomeTaxBase,
} from "@shared/snapshot";
import { cn } from "@/lib/utils";
import { dashboardHref } from "@shared/navigation";

/** A priority alert the command centre surfaces (computed by the Dashboard). */
export interface CommandAlert {
  id: string;
  label: string;
  detail?: string;
  tone: "red" | "amber";
  /** Where clicking the alert takes the user to resolve / understand it. */
  href: string;
}

export interface CommandCentreProps {
  snapshot: PortfolioSnapshot;
  /** Decision-surface projection (range, probability, downside band, pace). */
  decision: {
    range: { base: number; low: number; high: number };
    /** Goal-probability % (only meaningful when the plan has material risk). */
    probabilityPct: number | null;
    hasMaterialRisk: boolean;
    pace: { status: string; shortfall: number };
  } | null;
  /** Reconciliation verdict + the same three bases (for the health badge). */
  reconciliation: { reconciled: boolean; basisOk: boolean } | null;
  /** Priority alerts already prioritised by the Dashboard. */
  alerts: CommandAlert[];
  /** Live actuals pockets (KES). */
  actuals: {
    mmfTotal: number;
    govSecurities: number;
    bankInstruments: number;
    otherAssets: number;
    interestToDate: number;
    taxToDate: number;
    annualisedTax: number;
  };
  /** This-month contribution snapshot. */
  thisMonth: {
    planned: number;
    actual: number;
    /** Expected net interest this month (KES). */
    expectedInterest: number;
    /** Next single action text (the most important thing to do). */
    nextAction: string;
    nextActionHref: string;
    /** False when the plan is all-clear — render a calm, non-clickable state. */
    nextActionActionable?: boolean;
    /** Next maturity, if any, within the visible horizon. */
    nextMaturity: { label: string; atMs: number; amount: number | null; href: string } | null;
  };
  /** Projection summary. */
  projection: {
    projectedAtGoal: number;
    target: number;
    liquidAtGoalPct: number | null;
    worst: number;
    best: number;
  };
  goalDateLabel: string | null;
  /** Manager mode shows extra diagnostics inline (still terse). */
  managerMode: boolean;
}

function SectionHeading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
      {action}
    </div>
  );
}

/** A compact, deep-linked metric tile. The whole tile is the link target. */
function MetricTile({
  label,
  value,
  sub,
  icon: Icon,
  href,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  accent?: "primary" | "emerald" | "amber" | "sky" | "violet";
}) {
  const accentClass =
    accent === "primary"
      ? "text-primary"
      : accent === "emerald"
        ? "text-emerald-500"
        : accent === "amber"
          ? "text-amber-500"
          : accent === "sky"
            ? "text-sky-500"
            : accent === "violet"
              ? "text-violet-500"
              : "text-muted-foreground";
  return (
    <Link
      href={href}
      className="group block rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/30 active:scale-[0.99]"
    >
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className={cn("w-4 h-4 shrink-0", accentClass)} />
        <span className="text-xs">{label}</span>
        <ArrowRight className="w-3 h-3 ml-auto opacity-0 -translate-x-1 transition-all group-hover:opacity-60 group-hover:translate-x-0" />
      </div>
      <p className="mt-1.5 text-lg font-semibold tabular-nums text-foreground kes-amount">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </Link>
  );
}

export function DashboardCommandCentre(props: CommandCentreProps) {
  const {
    snapshot,
    decision,
    reconciliation,
    alerts,
    actuals,
    thisMonth,
    projection,
    goalDateLabel,
    managerMode,
  } = props;

  // One net-worth concept only: the canonical Full Net Worth selector. Goal-plan
  // and income/tax bases are shown as labelled context, never as a rival total.
  const fullNetWorth = selectDashboardHeadlineNetWorth(snapshot);
  const goalPlanAssets = selectGoalPlanAssets(snapshot);
  const incomeTaxBase = selectIncomeTaxBase(snapshot);

  const target = projection.target;
  const remaining = Math.max(0, target - projection.projectedAtGoal);
  const onTrack = decision ? decision.pace.status !== "behind" : projection.projectedAtGoal >= target;
  const probabilityPct = decision?.hasMaterialRisk ? decision.probabilityPct : null;

  const reconHealthy = reconciliation ? reconciliation.reconciled : null;

  // This-month contribution verdict.
  const contribDelta = thisMonth.actual - thisMonth.planned;
  const contribState: "met" | "short" | "extra" | "none" =
    thisMonth.planned <= 0
      ? "none"
      : thisMonth.actual <= 0
        ? "none"
        : contribDelta < -1
          ? "short"
          : contribDelta > 1
            ? "extra"
            : "met";

  return (
    <div className="space-y-5">
      {/* ── 1. Portfolio status ──────────────────────────────────────────── */}
      <div>
        <SectionHeading
          action={
            <Link href={dashboardHref.onTrack} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
              Open Plan <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          Portfolio status
        </SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href={dashboardHref.fullNetWorth}
            className="group rounded-xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card to-card p-4 transition-colors hover:border-primary/50"
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <Wallet className="w-4 h-4 text-primary shrink-0" />
              <span className="text-xs">Full Net Worth</span>
              <ArrowRight className="w-3 h-3 ml-auto opacity-0 -translate-x-1 transition-all group-hover:opacity-60 group-hover:translate-x-0" />
            </div>
            <p className="mt-1.5 text-2xl font-bold tabular-nums text-foreground kes-amount">{formatKES(fullNetWorth)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Every pocket, today. {formatKESCompact(goalPlanAssets)} assigned to this goal.</p>
          </Link>

          <MetricTile
            label="Goal / Remaining"
            value={formatKESCompact(target)}
            sub={remaining > 0 ? `${formatKESCompact(remaining)} to go (projected)` : "Projected to reach target"}
            icon={Target}
            href={dashboardHref.goalRemaining}
            accent="violet"
          />

          <Link
            href={dashboardHref.onTrack}
            className={cn(
              "group rounded-xl border p-4 transition-colors",
              onTrack
                ? "border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50"
                : "border-amber-500/30 bg-amber-500/5 hover:border-amber-500/50",
            )}
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              {onTrack ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
              <span className="text-xs">{probabilityPct != null ? "Goal probability" : "On track?"}</span>
              <ArrowRight className="w-3 h-3 ml-auto opacity-0 -translate-x-1 transition-all group-hover:opacity-60 group-hover:translate-x-0" />
            </div>
            <p className={cn("mt-1.5 text-lg font-semibold", onTrack ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400")}>
              {probabilityPct != null ? `${probabilityPct.toFixed(0)}% likely` : onTrack ? "On track" : "Needs attention"}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {decision?.pace.status === "behind" ? `Behind by ${formatKESCompact(decision.pace.shortfall)}` : "Based on your committed plan"}
            </p>
          </Link>

          <Link
            href={dashboardHref.reconciliation}
            className={cn(
              "group rounded-xl border p-4 transition-colors",
              reconHealthy === false
                ? "border-red-500/30 bg-red-500/5 hover:border-red-500/50"
                : "border-border bg-card hover:border-primary/40",
            )}
          >
            <div className="flex items-center gap-2 text-muted-foreground">
              <ShieldCheck className={cn("w-4 h-4 shrink-0", reconHealthy === false ? "text-red-500" : "text-emerald-500")} />
              <span className="text-xs">Reconciliation</span>
              <ArrowRight className="w-3 h-3 ml-auto opacity-0 -translate-x-1 transition-all group-hover:opacity-60 group-hover:translate-x-0" />
            </div>
            <div className="mt-1.5">
              {reconHealthy == null ? (
                <Badge variant="outline">Checking…</Badge>
              ) : reconHealthy ? (
                <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 border-0">All sources agree</Badge>
              ) : (
                <Badge variant="destructive">Mismatch — review</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {reconciliation && !reconciliation.basisOk ? "Net-worth basis check failed" : "Sources, accruals & plan policy"}
            </p>
          </Link>
        </div>
      </div>

      {/* ── 2. This month ────────────────────────────────────────────────── */}
      <div>
        <SectionHeading
          action={
            <Link href={dashboardHref.scheduledContributions} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
              Cashflows <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          This month
        </SectionHeading>
        <Card>
          <CardContent className="p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Planned contribution</p>
                <p className="text-base font-semibold tabular-nums mt-0.5">{formatKES(thisMonth.planned)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Recorded so far</p>
                <p className="text-base font-semibold tabular-nums mt-0.5">{formatKES(thisMonth.actual)}</p>
                {contribState === "short" && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Short by {formatKESCompact(Math.abs(contribDelta))}
                  </p>
                )}
                {contribState === "extra" && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5">+{formatKESCompact(contribDelta)} extra</p>
                )}
                {contribState === "met" && (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mt-0.5 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> On plan
                  </p>
                )}
                {contribState === "none" && thisMonth.planned > 0 && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-0.5 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Nothing recorded yet
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Coins className="w-3 h-3" /> Expected interest
                </p>
                <p className="text-base font-semibold tabular-nums mt-0.5">{formatKES(thisMonth.expectedInterest)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Net of WHT, this month</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CalendarClock className="w-3 h-3" /> Next maturity
                </p>
                {thisMonth.nextMaturity ? (
                  <Link href={thisMonth.nextMaturity.href} className="block group">
                    <p className="text-base font-semibold mt-0.5 group-hover:text-primary transition-colors">
                      {new Date(thisMonth.nextMaturity.atMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                      {thisMonth.nextMaturity.label}
                      {thisMonth.nextMaturity.amount != null ? ` · ${formatKESCompact(thisMonth.nextMaturity.amount)}` : ""}
                    </p>
                  </Link>
                ) : (
                  <p className="text-base font-semibold mt-0.5 text-muted-foreground">None scheduled</p>
                )}
              </div>
            </div>
            {/* Next action — the single most important thing to do. When the plan
                is all-clear we render a calm, non-clickable confirmation instead
                of a link that would dead-end on a form with nothing to do. */}
            {thisMonth.nextActionActionable === false ? (
              <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="text-muted-foreground">{thisMonth.nextAction}</span>
              </div>
            ) : (
              <Link
                href={thisMonth.nextActionHref}
                className="mt-4 flex items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm transition-colors hover:bg-primary/10"
              >
                <ArrowRight className="w-4 h-4 text-primary shrink-0" />
                <span className="text-foreground"><span className="font-medium">Next:</span> {thisMonth.nextAction}</span>
              </Link>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── 3. Live actuals ──────────────────────────────────────────────── */}
      <div>
        <SectionHeading
          action={
            <Link href={dashboardHref.mmf} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
              Holdings <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          Live actuals
        </SectionHeading>
        <div className="grid gap-3 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <MetricTile label="MMF total" value={formatKESCompact(actuals.mmfTotal)} icon={PiggyBank} href={dashboardHref.mmf} accent="sky" />
          <MetricTile label="Gov. securities" value={formatKESCompact(actuals.govSecurities)} icon={Landmark} href={dashboardHref.gov} accent="emerald" />
          <MetricTile label="Bank instruments" value={formatKESCompact(actuals.bankInstruments)} icon={Building2} href={dashboardHref.bank} accent="violet" />
          <MetricTile label="Other assets" value={formatKESCompact(actuals.otherAssets)} icon={Boxes} href={dashboardHref.other} />
          <MetricTile
            label="Interest to date"
            value={formatKESCompact(actuals.interestToDate)}
            sub={`Income base ${formatKESCompact(incomeTaxBase)}`}
            icon={TrendingUp}
            href={dashboardHref.interestToDate}
            accent="emerald"
          />
          <MetricTile
            label="WHT to date"
            value={formatKESCompact(actuals.taxToDate)}
            sub={`≈ ${formatKESCompact(actuals.annualisedTax)}/yr payable`}
            icon={Receipt}
            href={dashboardHref.whtToDate}
            accent="amber"
          />
        </div>
      </div>

      {/* ── 4. Priority alerts ───────────────────────────────────────────── */}
      <div>
        <SectionHeading>Needs attention</SectionHeading>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-sm text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> Nothing needs your attention right now.
          </div>
        ) : (
          <ul className="space-y-2">
            {alerts.map((a) => (
              <li key={a.id}>
                <Link
                  href={a.href}
                  className={cn(
                    "group flex items-start gap-2 rounded-xl border p-3 text-sm transition-colors",
                    a.tone === "red"
                      ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300 hover:bg-red-500/15"
                      : "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15",
                  )}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span className="flex-1">
                    <span className="font-medium">{a.label}</span>
                    {a.detail && <span className="block text-xs opacity-80 mt-0.5">{a.detail}</span>}
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-0 -translate-x-1 transition-all group-hover:opacity-70 group-hover:translate-x-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── 5. Projection summary ────────────────────────────────────────── */}
      <div>
        <SectionHeading
          action={
            <Link href={dashboardHref.projectionLedger} className="text-[11px] text-primary hover:underline flex items-center gap-0.5">
              Plan → Ledger <ArrowRight className="w-3 h-3" />
            </Link>
          }
        >
          Projection summary
        </SectionHeading>
        <Card>
          <CardContent className="p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-xs text-muted-foreground">Projected at goal{goalDateLabel ? ` (${goalDateLabel})` : ""}</p>
                <p className="text-lg font-semibold tabular-nums mt-0.5 kes-amount">{formatKES(projection.projectedAtGoal)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  vs {formatKESCompact(target)} target
                  {projection.projectedAtGoal >= target ? " — on/above" : " — below"}
                </p>
              </div>
              {(() => {
                // What the investment ADDS on top of your own contributions:
                // projected finish value minus every shilling you plan to put in.
                // Net of WHT because the engine projection is already net. No new
                // math — both figures come straight from the snapshot.
                const contributed = Math.max(0, snapshot.contributions.totalPlanned);
                const growth = Math.max(0, projection.projectedAtGoal - contributed);
                const growthPctOfContrib =
                  contributed > 0 ? (growth / contributed) * 100 : null;
                return (
                  <div>
                    <p className="text-xs text-muted-foreground">Growth from investing</p>
                    <p className="text-lg font-semibold tabular-nums mt-0.5 kes-amount text-emerald-500">
                      +{formatKES(growth)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatKESCompact(contributed)} contributed + interest earned
                      {growthPctOfContrib != null ? ` (+${growthPctOfContrib.toFixed(0)}%)` : ""}
                    </p>
                  </div>
                );
              })()}
              <div>
                <p className="text-xs text-muted-foreground">Liquid at goal</p>
                <p className="text-lg font-semibold tabular-nums mt-0.5">
                  {projection.liquidAtGoalPct != null ? `${projection.liquidAtGoalPct.toFixed(0)}%` : "—"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">Share spendable at the goal date</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Best / worst range</p>
                <p className="text-lg font-semibold tabular-nums mt-0.5 kes-amount">
                  {formatKESCompact(projection.worst)} – {formatKESCompact(projection.best)}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {decision?.hasMaterialRisk ? "~80% outcome band" : "Rate-ease / missed-contribution band"}
                </p>
              </div>
            </div>
            {managerMode && (
              <div className="mt-3 rounded-lg bg-muted/40 border border-border p-3 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Manager:</span> projection ran the{" "}
                <span className="font-medium">{snapshot.identity.activePolicyTier}</span> policy
                {snapshot.identity.planStatus === "draft" ? " (uncommitted preview — Ledger follows balanced)" : " (committed)"}.
                {" "}                Full scenario explanations and the downside model are on the{" "}
                <Link href={dashboardHref.scenarios} className="text-primary hover:underline">Scenarios</Link> page.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
