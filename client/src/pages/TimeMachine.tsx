import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import { invalidatePortfolioMoney } from "@/lib/invalidatePortfolioMoney";
import { formatKES } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Clock,
  FlaskConical,
  CalendarClock,
  SkipForward,
  RotateCcw,
  Undo2,
  Zap,
  Loader2,
  TrendingUp,
  ArrowRight,
  Sparkles,
  Layers,
  Activity,
  History,
  HelpCircle,
  CornerUpLeft,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Mode = "accrue_only" | "accept_plan" | "inject_variance";

type AdvanceSummary = {
  fromDate: string;
  toDate: string;
  monthsElapsed: number;
  contributionsWritten: number;
  contributionTotal: number;
  maturitiesSettled: number;
  todayValueBefore: number;
  todayValueAfter: number;
  endValueBefore: number;
  endValueAfter: number;
  mode: Mode;
};

const MODE_COPY: Record<Mode, { title: string; blurb: string; icon: typeof Sparkles }> = {
  accrue_only: {
    title: "Accrue only",
    blurb: "Move the clock and let balances grow through the projection. Nothing is written — purely reversible.",
    icon: Activity,
  },
  accept_plan: {
    title: "Accept plan as actual",
    blurb: "Record each elapsed month's planned contribution as a real deposit, so the ledger fills in as you travel.",
    icon: Layers,
  },
  inject_variance: {
    title: "Inject variance",
    blurb: "Like accept-plan, but scale the realised contribution to stress-test under- or over-funding.",
    icon: TrendingUp,
  },
};

export function TimeMachine() {
  const { mode: appMode, portfolioId } = usePortfolio();
  const utils = trpc.useUtils();
  const [matMode, setMatMode] = useState<Mode>("accrue_only");
  const [contribFactor, setContribFactor] = useState<number>(100);
  const [jumpDate, setJumpDate] = useState<string>("");
  const [summary, setSummary] = useState<AdvanceSummary | null>(null);
  const [shockDelta, setShockDelta] = useState<number>(-2);
  const [shockDate, setShockDate] = useState<string>("");

  const isSandbox = appMode === "sandbox";

  const statusQ = trpc.timeMachine.status.useQuery(
    { portfolioId: portfolioId as number },
    { enabled: isSandbox && !!portfolioId },
  );
  const status = statusQ.data;

  const refresh = async () => {
    await Promise.all([
      // Every money-dependent surface (snapshot, holdings, projection, ledger,
      // tax, accrual, reconciliation, allocation) re-reads the moved boundary.
      invalidatePortfolioMoney(utils, portfolioId),
      // Time-machine-only views + the audit trail are not in the money helper.
      utils.audit.invalidate(),
    ]);
  };

  const advance = trpc.timeMachine.advance.useMutation({
    onSuccess: async (res) => {
      setSummary(res as AdvanceSummary);
      await refresh();
      toast.success(`Advanced to ${res.toDate}`, {
        description:
          res.contributionsWritten > 0
            ? `${res.contributionsWritten} contribution(s) materialised (${formatKES(res.contributionTotal)})`
            : `${res.monthsElapsed} month(s) elapsed`,
      });
    },
    onError: (e) => toast.error("Could not advance", { description: e.message }),
  });

  const undo = trpc.timeMachine.undoStep.useMutation({
    onSuccess: async (res) => {
      setSummary(null);
      await refresh();
      toast.success(`Rewound to ${res.rewoundTo}`, {
        description:
          res.removedDeposits > 0
            ? `Undid the step to ${res.undoneFrom}; removed ${res.removedDeposits} contribution(s)`
            : `Undid the step to ${res.undoneFrom}`,
      });
    },
    onError: (e) => toast.error("Could not undo", { description: e.message }),
  });

  const reset = trpc.timeMachine.reset.useMutation({
    onSuccess: async (res) => {
      setSummary(null);
      await refresh();
      const r = res.removed;
      toast.success("Reset to today", {
        description:
          r.deposits + r.securities + r.withdrawals > 0
            ? `Removed ${r.deposits} deposit(s), ${r.securities} security(ies), ${r.withdrawals} withdrawal(s)`
            : "Cleared the simulated clock",
      });
    },
    onError: (e) => toast.error("Could not reset", { description: e.message }),
  });

  const setRateShock = trpc.timeMachine.setRateShock.useMutation({
    onSuccess: async (res) => {
      await refresh();
      toast.success(res.shock ? "Rate-shock applied" : "Rate-shock cleared", {
        description: res.shock
          ? `${res.shock.deltaPct >= 0 ? "+" : ""}${res.shock.deltaPct}% to all yields from ${res.shock.effectiveDate}`
          : "Yields restored to base rates",
      });
    },
    onError: (e) => toast.error("Could not update rate-shock", { description: e.message }),
  });

  const applyShock = () => {
    if (!portfolioId) return;
    const effectiveDate = shockDate || (status?.simulatedDateLabel ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      toast.error("Pick an effective date (YYYY-MM-DD)");
      return;
    }
    setRateShock.mutate({ portfolioId, shock: { effectiveDate, deltaPct: shockDelta } });
  };

  const clearShock = () => {
    if (!portfolioId) return;
    setRateShock.mutate({ portfolioId, shock: null });
  };

  const doStep = (unit: "day" | "week" | "month" | "year", count = 1) => {
    if (!portfolioId) return;
    advance.mutate({
      portfolioId,
      target: { type: "step", unit, count },
      mode: matMode,
      contributionFactor: matMode === "inject_variance" ? contribFactor / 100 : undefined,
    });
  };

  const doNextEvent = () => {
    if (!portfolioId) return;
    advance.mutate({
      portfolioId,
      target: { type: "nextEvent" },
      mode: matMode,
      contributionFactor: matMode === "inject_variance" ? contribFactor / 100 : undefined,
    });
  };

  const doJumpToDate = () => {
    if (!portfolioId || !jumpDate) return;
    advance.mutate({
      portfolioId,
      target: { type: "date", date: jumpDate },
      mode: matMode,
      contributionFactor: matMode === "inject_variance" ? contribFactor / 100 : undefined,
    });
  };

  const busy = advance.isPending || reset.isPending || undo.isPending || setRateShock.isPending;

  // ── Live-mode guard ───────────────────────────────────────────────────────
  if (!isSandbox) {
    return (
      <AppShell>
      <div className="container max-w-3xl py-10">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center text-center gap-4 py-14">
            <div className="rounded-full bg-amber-500/15 p-4">
              <FlaskConical className="w-8 h-8 text-amber-500" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-semibold">The Time Machine lives in Test mode</h2>
              <p className="text-sm text-muted-foreground max-w-md">
                Fast-forwarding the clock writes simulated records, so it is sandbox-only and never
                touches your live tracking. Switch to <span className="font-medium text-foreground">Test mode</span> from
                the sidebar to simulate the future, then come back here.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
      </AppShell>
    );
  }

  const active = status?.active ?? false;
  const dateLabel = status?.simulatedDateLabel ?? "—";
  const anchorLabel = status?.anchorDate ? new Date(status.anchorDate).toISOString().split("T")[0] : "—";
  const mat = status?.materialised ?? { securities: 0, deposits: 0, withdrawals: 0 };

  return (
    <AppShell>
    <div className="container max-w-5xl py-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-primary/10 p-2.5">
            <Clock className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Time Machine</h1>
            <p className="text-sm text-muted-foreground">
              Advance a simulated clock and watch projected rows settle into actuals — fully sandboxed, fully reversible.
            </p>
          </div>
        </div>
        {active && (
          <div className="flex items-center gap-2">
          {status?.canUndo && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => portfolioId && undo.mutate({ portfolioId })}
                >
                  <Undo2 className="w-4 h-4" /> Undo last step
                </Button>
              </TooltipTrigger>
              <TooltipContent className="max-w-[16rem] text-xs leading-relaxed">
                Rewinds only the most recent jump{status?.lastStep ? ` (${status.lastStep.fromLabel} → ${status.lastStep.toLabel})` : ""} and deletes just the records that step created. Earlier steps stay intact.
              </TooltipContent>
            </Tooltip>
          )}
          <AlertDialog>
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" disabled={busy} className="text-destructive border-destructive/30 hover:bg-destructive/10">
                    <RotateCcw className="w-4 h-4" /> Reset to today
                  </Button>
                </AlertDialogTrigger>
              </TooltipTrigger>
              <TooltipContent className="max-w-[16rem] text-xs leading-relaxed">
                Clears the simulated clock, deletes every record this session created, and restores the exact pre-simulation state. Hand-entered data is untouched.
              </TooltipContent>
            </Tooltip>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Reset the simulation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This clears the simulated clock and deletes every record the Time Machine created this session
                  ({mat.deposits} deposit{mat.deposits === 1 ? "" : "s"}, {mat.securities} security
                  {mat.securities === 1 ? "" : "ies"}). Records you entered by hand are kept untouched.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-white hover:bg-destructive/90"
                  onClick={() => portfolioId && reset.mutate({ portfolioId })}
                >
                  Reset to today
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          </div>
        )}
      </div>

      {/* Current clock */}
      <Card className={cn(active && "border-primary/40 bg-primary/[0.03]")}>
        <CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
              Simulated today
              <InfoHint
                label="What is simulated today?"
                text="The pretend 'current date' the whole app reads while you simulate. Dashboards, the ledger and reconciliation all behave as if this were today. It never affects your Live portfolio."
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold tabular-nums">{dateLabel}</span>
              {active ? (
                <Badge className="bg-primary/15 text-primary hover:bg-primary/20">Simulating</Badge>
              ) : (
                <Badge variant="secondary">Real clock</Badge>
              )}
            </div>
            {active && (
              <div className="text-xs text-muted-foreground">
                Anchored to real today: <span className="tabular-nums">{anchorLabel}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-center cursor-help">
                  <div className="font-semibold tabular-nums">{mat.deposits}</div>
                  <div className="text-xs text-muted-foreground">deposits</div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-[15rem] text-xs leading-relaxed">
                Simulated deposit records created this session (e.g. materialised monthly contributions). All are removed on Reset.
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="text-center cursor-help">
                  <div className="font-semibold tabular-nums">{mat.securities}</div>
                  <div className="text-xs text-muted-foreground">securities</div>
                </div>
              </TooltipTrigger>
              <TooltipContent className="max-w-[15rem] text-xs leading-relaxed">
                Simulated securities created this session. All are removed on Reset.
              </TooltipContent>
            </Tooltip>
            {status?.nextEvent && (
              <div className="text-left max-w-[14rem]">
                <div className="text-xs text-muted-foreground">Next event</div>
                <div className="text-xs font-medium truncate">
                  {new Date(status.nextEvent.at).toISOString().split("T")[0]} · {status.nextEvent.label}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-[1fr_1.1fr]">
        {/* Materialization mode */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-1.5">
              How elapsed months settle
              <InfoHint
                label="About settle modes"
                text="Controls what the clock does to months it passes. Accrue only just lets balances grow (no records). Accept plan writes each month's planned contribution as a real deposit. Inject variance does the same but scaled, to stress under- or over-funding."
              />
            </CardTitle>
            <CardDescription>Choose what happens to projected rows as the clock passes them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {(Object.keys(MODE_COPY) as Mode[]).map((m) => {
              const C = MODE_COPY[m].icon;
              const selected = matMode === m;
              return (
                <button
                  key={m}
                  onClick={() => setMatMode(m)}
                  className={cn(
                    "w-full text-left rounded-lg border p-3 transition-all duration-150 flex gap-3",
                    selected ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary/40",
                  )}
                >
                  <div className={cn("rounded-md p-1.5 h-fit", selected ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground")}>
                    <C className="w-4 h-4" />
                  </div>
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold">{MODE_COPY[m].title}</div>
                    <div className="text-xs text-muted-foreground leading-snug">{MODE_COPY[m].blurb}</div>
                  </div>
                </button>
              );
            })}
            {matMode === "inject_variance" && (
              <div className="pt-2 space-y-1.5">
                <Label htmlFor="cf" className="text-xs flex items-center gap-1.5">
                  Contribution realised (% of plan)
                  <InfoHint
                    label="About contribution factor"
                    text="Scales each materialised contribution. 100% records the full planned amount; 50% models under-funding; 150% models topping up. Yields and maturities still follow the plan."
                  />
                </Label>
                <Input
                  id="cf"
                  type="number"
                  min={0}
                  max={300}
                  value={contribFactor}
                  onChange={(e) => setContribFactor(Math.max(0, Math.min(300, Number(e.target.value) || 0)))}
                  className="h-9 w-32 tabular-nums"
                />
                <p className="text-xs text-muted-foreground">100% = on plan · 80% = under-funded · 120% = ahead of plan.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Rate-shock stress test */}
        <Card className={cn(status?.rateShock && "border-amber-500/40 bg-amber-500/[0.04]")}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <CardTitle className="text-base">Rate-shock stress test</CardTitle>
              <InfoHint
                label="About rate-shock"
                text="Shifts every yield (MMF + all CBK families) by a fixed number of percentage points from a chosen date, so you can model a CBK rate cut or hike. Withholding tax is unchanged and rates never go below 0%. The shock applies across the whole app until you clear it."
              />
            </div>
            <CardDescription>
              Shift every yield (MMF + all CBK families) by a fixed amount from a chosen date to stress projected returns. WHT is unchanged; rates floor at 0%.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {status?.rateShock ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <div className="text-sm">
                  <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                    {status.rateShock.deltaPct >= 0 ? "+" : ""}{status.rateShock.deltaPct}%
                  </span>{" "}
                  to all yields from <span className="tabular-nums">{status.rateShock.effectiveDate}</span>
                </div>
                <Button variant="outline" size="sm" disabled={busy} onClick={clearShock}>
                  Clear shock
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="shockDelta" className="text-xs">Rate change (pp)</Label>
                  <Input
                    id="shockDelta"
                    type="number"
                    step={0.25}
                    min={-20}
                    max={20}
                    value={shockDelta}
                    onChange={(e) => setShockDelta(Math.max(-20, Math.min(20, Number(e.target.value) || 0)))}
                    className="h-9 w-28 tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shockDate" className="text-xs">Effective from</Label>
                  <Input
                    id="shockDate"
                    type="date"
                    value={shockDate}
                    onChange={(e) => setShockDate(e.target.value)}
                    className="h-9 w-44"
                  />
                </div>
                <Button variant="outline" size="sm" disabled={busy} onClick={applyShock} className="border-amber-500/40">
                  <Zap className="w-4 h-4" /> Apply shock
                </Button>
                <p className="w-full text-xs text-muted-foreground">
                  Leave the date blank to apply from the current simulated date ({status?.simulatedDateLabel ?? "today"}). Example: −2 pp models a CBK rate cut.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Advance controls */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Advance the clock</CardTitle>
            <CardDescription>Step forward, jump to the next event, or pick a date.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([
                ["day", "+1 day"],
                ["week", "+1 week"],
                ["month", "+1 month"],
                ["year", "+1 year"],
              ] as const).map(([unit, lbl]) => (
                <Tooltip key={unit}>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => doStep(unit)} className="h-9">
                      {lbl}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent className="text-xs">
                    Move the clock forward one {unit}, settling any months it crosses under the selected mode.
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>

            <Tooltip>
              <TooltipTrigger asChild>
                <span className="block">
                  <Button variant="secondary" disabled={busy || !status?.nextEvent} onClick={doNextEvent} className="w-full">
                    <SkipForward className="w-4 h-4" />
                    {status?.nextEvent
                      ? `Jump to next event · ${status.nextEvent.label}`
                      : "No upcoming events"}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-[16rem] text-xs leading-relaxed">
                Skips straight to the next scheduled milestone — the soonest security maturity or planned contribution — instead of stepping day by day.
              </TooltipContent>
            </Tooltip>

            <div className="space-y-1.5">
              <Label htmlFor="jd" className="text-xs flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5" /> Jump to a specific date
                <InfoHint
                  label="About jump to date"
                  text="Advances the simulated clock to any future calendar date in one move, settling every month in between. You can't travel earlier than the current simulated date — use Undo or Reset for that."
                />
              </Label>
              <div className="flex gap-2">
                <Input id="jd" type="date" value={jumpDate} onChange={(e) => setJumpDate(e.target.value)} className="h-9" />
                <Button disabled={busy || !jumpDate} onClick={doJumpToDate} className="h-9 shrink-0">
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  Go
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Post-advance summary */}
      {summary && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Jump summary · {summary.fromDate} → {summary.toDate}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <SummaryStat label="Months elapsed" value={String(summary.monthsElapsed)} />
              <SummaryStat
                label="Contributions added"
                value={summary.contributionsWritten > 0 ? `${summary.contributionsWritten} · ${formatKES(summary.contributionTotal)}` : "None"}
              />
              <SummaryStat label="Maturities passed" value={String(summary.maturitiesSettled)} />
              <SummaryStat
                label="Projected end value"
                value={formatKES(summary.endValueAfter)}
                delta={summary.endValueAfter - summary.endValueBefore}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Mode: <span className="font-medium text-foreground">{MODE_COPY[summary.mode].title}</span>. The projection,
              reconciliation and ledger have been re-computed at the new date. Use <span className="font-medium">Reset to today</span> to
              undo everything this session created.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Simulation history log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <History className="w-4 h-4 text-muted-foreground" />
              <CardTitle className="text-base">Simulation history</CardTitle>
              <InfoHint
                label="About the history log"
                text="Every clock advance this session, newest first. The most recent step is marked 'next undo' — that's the one Undo last step will rewind. Reset to today clears the whole log."
              />
            </div>
            {status?.history && status.history.length > 0 && (
              <Badge variant="secondary" className="tabular-nums">
                {status.history.length} step{status.history.length === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
          <CardDescription>A step-by-step trail of how this simulation reached the current date.</CardDescription>
        </CardHeader>
        <CardContent>
          {status?.history && status.history.length > 0 ? (
            <ScrollArea className={cn(status.history.length > 6 && "h-[20rem] pr-3")}>
              <div>
                {(status.history as HistoryItem[]).map((item) => (
                  <HistoryRow key={item.index} item={item} stepNumber={item.index + 1} />
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="flex flex-col items-center text-center gap-2 py-8 text-muted-foreground">
              <History className="w-7 h-7 opacity-40" />
              <p className="text-sm">No steps yet. Advance the clock above and each jump will be logged here.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </AppShell>
  );
}

/** Small inline "?" icon that reveals an explanation on hover/focus/tap. */
function InfoHint({ text, label }: { text: string; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label ?? "More information"}
          className="inline-flex items-center text-muted-foreground/70 hover:text-foreground focus-visible:text-foreground focus-visible:outline-none transition-colors"
          onClick={(e) => e.preventDefault()}
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[16rem] text-xs leading-relaxed">{text}</TooltipContent>
    </Tooltip>
  );
}

type HistoryItem = {
  index: number;
  fromLabel: string;
  toLabel: string;
  mode: Mode;
  targetLabel: string;
  monthsElapsed: number | null;
  contributionsWritten: number;
  contributionTotal: number | null;
  rateShock: { effectiveDate: string; deltaPct: number } | null;
  createdAt: number | null;
  isNextUndoable: boolean;
};

const MODE_SHORT: Record<Mode, string> = {
  accrue_only: "Accrue only",
  accept_plan: "Accept plan",
  inject_variance: "Inject variance",
};

function HistoryRow({ item, stepNumber }: { item: HistoryItem; stepNumber: number }) {
  return (
    <div className="relative pl-6 pb-4 last:pb-0">
      {/* timeline rail + dot */}
      <span className="absolute left-[5px] top-1.5 bottom-0 w-px bg-border" aria-hidden />
      <span
        className={cn(
          "absolute left-0 top-1 w-[11px] h-[11px] rounded-full border-2",
          item.isNextUndoable ? "border-primary bg-primary/30" : "border-muted-foreground/40 bg-background",
        )}
        aria-hidden
      />
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-medium text-muted-foreground">#{stepNumber}</span>
        <span className="text-sm font-semibold tabular-nums">{item.fromLabel}</span>
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-sm font-semibold tabular-nums">{item.toLabel}</span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{MODE_SHORT[item.mode]}</Badge>
        {item.isNextUndoable && (
          <Badge className="text-[10px] px-1.5 py-0 bg-primary/15 text-primary hover:bg-primary/20">
            <CornerUpLeft className="w-3 h-3 mr-0.5" /> next undo
          </Badge>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span>{item.targetLabel}</span>
        {item.monthsElapsed != null && item.monthsElapsed > 0 && (
          <span>· {item.monthsElapsed} month{item.monthsElapsed === 1 ? "" : "s"} elapsed</span>
        )}
        {item.contributionsWritten > 0 && (
          <span className="text-foreground">
            · {item.contributionsWritten} contribution{item.contributionsWritten === 1 ? "" : "s"}
            {item.contributionTotal != null ? ` (${formatKES(item.contributionTotal)})` : ""}
          </span>
        )}
        {item.rateShock && (
          <span className="text-amber-600 dark:text-amber-400">
            · shock {item.rateShock.deltaPct >= 0 ? "+" : ""}{item.rateShock.deltaPct}% from {item.rateShock.effectiveDate}
          </span>
        )}
        {item.createdAt && (
          <span className="opacity-70">· {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        )}
      </div>
    </div>
  );
}

function SummaryStat({ label, value, delta }: { label: string; value: string; delta?: number }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-bold tabular-nums mt-0.5">{value}</div>
      {delta != null && delta !== 0 && (
        <div className={cn("text-xs font-medium tabular-nums mt-0.5", delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
          {delta > 0 ? "+" : ""}{formatKES(delta)}
        </div>
      )}
    </div>
  );
}
