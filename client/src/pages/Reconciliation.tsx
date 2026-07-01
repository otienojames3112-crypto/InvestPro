import { AppShell } from "@/components/AppShell";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Scale, CheckCircle2, AlertTriangle, Info, Activity, TrendingDown, TrendingUp } from "lucide-react";
import { formatKES, formatRelativeTime } from "@/lib/format";
import { Sparkline } from "@/components/Sparkline";
import { GlossaryTerm } from "@/components/GlossaryTerm";

export default function Reconciliation({ embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId, portfolio } = usePortfolio();

  const { data, isLoading } = trpc.projection.reconciliation.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId },
  );

  // R68.2 — full drift history for the drill-down panel (drt over time).
  const { data: driftHistory } = trpc.bankHoldings.driftHistory.useQuery(
    { portfolioId: portfolioId!, limit: 90 },
    { enabled: !!portfolioId },
  );

  const full = data?.full;
  const mmf = data?.mmf;
  const gov = data?.gov;
  const bank = data?.bank;
  const govAccrual = data?.govAccrual;
  const bankAccrual = data?.bankAccrual;
  const planPolicy = data?.planPolicy;
  const basis = data?.basis;
  const sections = data?.sections ?? [];
  const sectionsOk = data?.sectionsOk ?? true;
  const reconciled =
    !!full?.reconciled &&
    !!mmf?.ok &&
    (gov?.ok ?? true) &&
    (bank?.ok ?? true) &&
    (govAccrual?.ok ?? true) &&
    (bankAccrual?.ok ?? true) &&
    (planPolicy?.ok ?? true) &&
    (basis?.fullOk ?? true) &&
    sectionsOk;

  // Round 43 (Fix #3): the banner's "largest gap" must span EVERY check, not just
  // the six whole-portfolio sources. Previously it read only full.maxDiff, so a
  // 50,000 gap in the government-securities sub-check showed as "disagree / gap
  // KES 0.00" — a self-contradiction that trains users to distrust the page.
  // Here we gather the absolute diff of each check (whole-portfolio + every
  // sub-check) and surface the worst one with its name.
  const gapCandidates: Array<{ label: string; diff: number }> = [];
  if (full) gapCandidates.push({ label: "Whole-portfolio sources", diff: Math.abs(full.maxDiff) });
  if (mmf) gapCandidates.push({ label: "MMF accrual-base check", diff: Math.abs(mmf.diff) });
  if (gov) gapCandidates.push({ label: "Government securities check", diff: Math.abs(gov.diff) });
  if (bank) gapCandidates.push({ label: "Bank instruments check", diff: Math.abs(bank.diff) });
  if (govAccrual)
    gapCandidates.push({
      label: "Government accrued-interest check",
      diff: Math.max(Math.abs(govAccrual.grossDiff), Math.abs(govAccrual.whtDiff)),
    });
  if (bankAccrual)
    gapCandidates.push({
      label: "Bank accrued-interest check",
      diff: Math.max(Math.abs(bankAccrual.grossDiff), Math.abs(bankAccrual.whtDiff)),
    });
  const worstGap = gapCandidates.reduce(
    (worst, c) => (c.diff > worst.diff ? c : worst),
    { label: "Whole-portfolio sources", diff: 0 },
  );

  return (
    <AppShell embedded={embedded}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Scale className="w-5 h-5 text-primary" />
            <h1
              className="text-2xl font-bold"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Reconciliation
            </h1>
          </div>
          <p className="text-muted-foreground text-sm max-w-3xl">
            An independent cross-check that the &ldquo;today&rdquo; value of{" "}
            <strong>{portfolio?.name ?? "your portfolio"}</strong> agrees across
            every subsystem &mdash; the sum of individual holdings, the
            projection engine, the Dashboard actuals total, the daily-accrual
            base, and the headline net-worth card. When these disagree, the
            mismatch is shown here so the cause can be traced.
          </p>
        </div>

        {isLoading || !full || !mmf || !gov || !bank || !govAccrual || !bankAccrual ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            {/* Verdict banner */}
            <Card
              className={
                reconciled
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-amber-500/40 bg-amber-500/5"
              }
            >
              <CardContent className="flex items-start gap-3 py-5">
                {reconciled ? (
                  <CheckCircle2 className="w-6 h-6 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-6 h-6 text-amber-500 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <p className="font-semibold">
                    {reconciled
                      ? "All sources reconcile"
                      : "Sources disagree"}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {reconciled ? (
                      <>
                        Every valuation path and sub-check agrees within{" "}
                        {formatKES(worstGap.diff, 2)} (tolerance is KES 5). The
                        portfolio&rsquo;s recorded holdings, the engine&rsquo;s
                        &ldquo;today&rdquo; figure, the dashboard totals, and the
                        gov/bank/accrual sub-checks are all consistent.
                      </>
                    ) : (
                      <>
                        The largest gap is {formatKES(worstGap.diff, 2)} &mdash;{" "}
                        <strong>{worstGap.label}</strong>. See the breakdown below
                        to trace it (sum-of-holdings reference is{" "}
                        {formatKES(full.reference, 2)}).
                      </>
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Plan-policy check — the projection's in-force tier MUST equal the
                committed tier on the Allocation Plan, or the Ledger and the plan
                disagree about which strategy is running. */}
            {planPolicy && (
              <Card className={planPolicy.ok ? undefined : "border-amber-500/40 bg-amber-500/5"}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Plan policy check
                    {planPolicy.ok ? (
                      <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 border-0">
                        In agreement
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Mismatch</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    The strategy the projection engine (Ledger, Dashboard,
                    Scenarios) actually runs must match the tier committed on the
                    Allocation Plan. Otherwise the goal odds and the projected path
                    would follow different models.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-md border p-4">
                      <p className="text-xs text-muted-foreground">
                        Committed tier (Allocation Plan)
                      </p>
                      <p className="text-lg font-semibold mt-1">
                        {planPolicy.committedLabel}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {planPolicy.committed
                          ? "Recorded as the plan in force."
                          : "No plan committed yet — the default path is used."}
                      </p>
                    </div>
                    <div className="rounded-md border p-4">
                      <p className="text-xs text-muted-foreground">
                        Tier the projection is running
                      </p>
                      <p className="text-lg font-semibold mt-1">
                        {planPolicy.activeLabel}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {planPolicy.ok
                          ? "Matches the committed plan."
                          : "Does not match — re-commit on the Allocation Plan to realign."}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Audit item #4 — three self-contained reconciliation SECTIONS. Each
                section reconciles peers on the SAME basis, so the income/tax base
                is never measured against full net worth, and goal-plan exclusions
                are verified as an expected basis difference, not a false red. */}
            {sections.length > 0 && (
              <div className="grid gap-4 lg:grid-cols-3">
                {sections.map((sec) => (
                  <Card
                    key={sec.key}
                    className={sec.ok ? undefined : "border-red-500/40 bg-red-500/5"}
                  >
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        {sec.label}
                        {sec.ok ? (
                          <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 border-0">
                            Consistent
                          </Badge>
                        ) : (
                          <Badge variant="destructive">Mismatch</Badge>
                        )}
                      </CardTitle>
                      <CardDescription>
                        Reference {formatKES(sec.reference, 2)} · largest gap{" "}
                        {formatKES(sec.maxDiff, 2)}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {sec.sources.map((src) => (
                          <div
                            key={src.key}
                            className="flex items-center justify-between gap-2 text-sm"
                          >
                            <span className="text-muted-foreground">{src.label}</span>
                            <span className="tabular-nums flex items-center gap-2">
                              {formatKES(src.value, 2)}
                              {src.ok ? (
                                <span className="text-emerald-600">✓</span>
                              ) : (
                                <span className="text-red-500">
                                  {src.diff > 0 ? "+" : ""}
                                  {formatKES(src.diff, 2)}
                                </span>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Net-worth basis (pasted Part 3/4) — the three canonical bases every
                surface reads through shared selectors. Full Net Worth must equal
                the sum-of-parts reference; Goal-plan and Income/Tax are narrower
                views of the SAME valuation, shown so a manager can see exactly
                which pockets each page is summing. */}
            {basis && (
              <Card className={basis.fullOk ? undefined : "border-amber-500/40 bg-amber-500/5"}>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Net-worth basis
                    {basis.fullOk ? (
                      <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 border-0">
                        Consistent
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Mismatch</Badge>
                    )}
                  </CardTitle>
                  <CardDescription>
                    The same valuation, three sanctioned views. Every page reads
                    these through one shared selector, so no surface can show a
                    &ldquo;net worth&rdquo; this check does not also see.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-md border p-4">
                      <p className="text-xs text-muted-foreground">
                        Full Net Worth
                      </p>
                      <p className="text-lg font-semibold tabular-nums mt-1">
                        {formatKES(basis.fullNetWorth, 2)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Every pocket incl. all other assets. Used by the Dashboard
                        headline and Portfolio Review. {basis.fullOk
                          ? `Matches sum-of-parts (${formatKES(basis.reference, 2)}).`
                          : `Differs from sum-of-parts (${formatKES(basis.reference, 2)}).`}
                      </p>
                    </div>
                    <div className="rounded-md border p-4">
                      <p className="text-xs text-muted-foreground">
                        Goal-Plan Assets
                      </p>
                      <p className="text-lg font-semibold tabular-nums mt-1">
                        {formatKES(basis.goalPlanAssets, 2)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Core instruments + only other assets tagged into the goal.
                        {basis.otherAssetsExcludedFromGoal > 0
                          ? ` Excludes ${formatKES(basis.otherAssetsExcludedFromGoal, 0)} of other assets.`
                          : " Nothing excluded."}
                      </p>
                    </div>
                    <div className="rounded-md border p-4">
                      <p className="text-xs text-muted-foreground">
                        Income / Tax Base
                      </p>
                      <p className="text-lg font-semibold tabular-nums mt-1">
                        {formatKES(basis.incomeTaxBase, 2)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Income-producing assets the Tax Summary blends yield across
                        &mdash; not whole-portfolio net worth.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Full-portfolio sources */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Whole-portfolio &ldquo;today&rdquo; value, by source
                </CardTitle>
                <CardDescription>
                  Each row is computed from its own data path and compared to the
                  sum-of-holdings reference.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Source</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                        <TableHead className="text-right">
                          Δ vs reference
                        </TableHead>
                        <TableHead className="text-right">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {full.sources
                        .filter((s) => s.key !== "accrual")
                        .map((s) => {
                          const diff = Math.round((s.value - full.reference) * 100) / 100;
                          const ok = Math.abs(diff) <= 5;
                          return (
                            <TableRow key={s.key}>
                              <TableCell>
                                <div className="font-medium">{s.label}</div>
                                <div className="text-xs text-muted-foreground">
                                  {s.detail}
                                </div>
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {formatKES(s.value, 2)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {diff === 0
                                  ? "—"
                                  : `${diff > 0 ? "+" : ""}${formatKES(diff, 2)}`}
                              </TableCell>
                              <TableCell className="text-right">
                                {ok ? (
                                  <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 border-0">
                                    Match
                                  </Badge>
                                ) : (
                                  <Badge variant="destructive">Mismatch</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            {/* MMF-only check */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  MMF base check (daily-accrual ledger)
                </CardTitle>
                <CardDescription>
                  The daily-accrual ledger starts from the MMF balance. It must
                  equal the primary MMF plus all secondary-MMF balances.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">
                      MMF subtotal (primary + secondaries)
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatKES(mmf.mmfSubtotal, 2)}
                    </p>
                  </div>
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">
                      Accrual ledger base
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatKES(mmf.accrual, 2)}
                    </p>
                  </div>
                  <div
                    className={`rounded-md border p-4 ${
                      mmf.ok ? "border-emerald-500/40" : "border-destructive/40"
                    }`}
                  >
                    <p className="text-xs text-muted-foreground">Difference</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatKES(mmf.diff, 2)}{" "}
                      {mmf.ok ? (
                        <span className="text-emerald-600 text-sm">✓</span>
                      ) : (
                        <span className="text-destructive text-sm">✗</span>
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Round 39: government-securities sub-check */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Government securities check (register vs deposits)
                </CardTitle>
                <CardDescription>
                  Every government-security deposit auto-creates one CBK register
                  row at the same face value. The live register total must equal
                  the gov-security deposits (net of any redemptions).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">
                      CBK register face total
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatKES(gov.registerFaceTotal, 2)}
                    </p>
                  </div>
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">
                      Linked gov deposits (net)
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatKES(gov.linkedDepositTotal, 2)}
                    </p>
                  </div>
                  <div
                    className={`rounded-md border p-4 ${
                      gov.ok ? "border-emerald-500/40" : "border-destructive/40"
                    }`}
                  >
                    <p className="text-xs text-muted-foreground">Difference</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatKES(gov.diff, 2)}{" "}
                      {gov.ok ? (
                        <span className="text-emerald-600 text-sm">✓</span>
                      ) : (
                        <span className="text-destructive text-sm">✗</span>
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Round 39: bank-instruments sub-check */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Bank instruments check (holdings vs deposits)
                </CardTitle>
                <CardDescription>
                  Active bank-instrument principals must equal bank-instrument
                  deposits net of bank withdrawals.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">
                      Active bank principals
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatKES(bank.holdingPrincipalTotal, 2)}
                    </p>
                  </div>
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">
                      Bank deposits (net of withdrawals)
                    </p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatKES(bank.netDepositTotal, 2)}
                    </p>
                  </div>
                  <div
                    className={`rounded-md border p-4 ${
                      bank.ok ? "border-emerald-500/40" : "border-destructive/40"
                    }`}
                  >
                    <p className="text-xs text-muted-foreground">Difference</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatKES(bank.diff, 2)}{" "}
                      {bank.ok ? (
                        <span className="text-emerald-600 text-sm">✓</span>
                      ) : (
                        <span className="text-destructive text-sm">✗</span>
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Round 40: government-securities accrued-interest + WHT check */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Government securities &mdash; accrued interest &amp; WHT (1-year window)
                </CardTitle>
                <CardDescription>
                  The day-by-day <GlossaryTerm id="accrued-interest">accrued interest</GlossaryTerm> schedule for CBK securities must match an
                  independent closed-form expectation (annual gross &times; days &divide;
                  365, with 15% WHT on T-Bills/FXD coupons and 0% on IFBs). A drift in
                  either path turns this red.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">Expected gross</p>
                    <p className="text-lg font-semibold tabular-nums">{formatKES(govAccrual.expectedGross, 2)}</p>
                  </div>
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">Schedule gross</p>
                    <p className="text-lg font-semibold tabular-nums">{formatKES(govAccrual.scheduleGross, 2)}</p>
                  </div>
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">Expected WHT</p>
                    <p className="text-lg font-semibold tabular-nums">{formatKES(govAccrual.expectedWht, 2)}</p>
                  </div>
                  <div
                    className={`rounded-md border p-4 ${govAccrual.ok ? "border-emerald-500/40" : "border-destructive/40"}`}
                  >
                    <p className="text-xs text-muted-foreground">Gross / WHT drift</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatKES(govAccrual.grossDiff, 2)} / {formatKES(govAccrual.whtDiff, 2)}{" "}
                      {govAccrual.ok ? (
                        <span className="text-emerald-600 text-sm">✓</span>
                      ) : (
                        <span className="text-destructive text-sm">✗</span>
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Round 40: bank-instruments accrued-interest + WHT check */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Bank instruments &mdash; accrued interest &amp; WHT (1-year window)
                </CardTitle>
                <CardDescription>
                  The simple daily-interest schedule for bank deposits must match an
                  independent closed-form expectation at each holding&rsquo;s own rate,
                  WHT and day-count basis. A drift turns this red.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">Expected gross</p>
                    <p className="text-lg font-semibold tabular-nums">{formatKES(bankAccrual.expectedGross, 2)}</p>
                  </div>
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">Schedule gross</p>
                    <p className="text-lg font-semibold tabular-nums">{formatKES(bankAccrual.scheduleGross, 2)}</p>
                  </div>
                  <div className="rounded-md border p-4">
                    <p className="text-xs text-muted-foreground">Expected WHT</p>
                    <p className="text-lg font-semibold tabular-nums">{formatKES(bankAccrual.expectedWht, 2)}</p>
                  </div>
                  <div
                    className={`rounded-md border p-4 ${bankAccrual.ok ? "border-emerald-500/40" : "border-destructive/40"}`}
                  >
                    <p className="text-xs text-muted-foreground">Gross / WHT drift</p>
                    <p className="text-lg font-semibold tabular-nums">
                      {formatKES(bankAccrual.grossDiff, 2)} / {formatKES(bankAccrual.whtDiff, 2)}{" "}
                      {bankAccrual.ok ? (
                        <span className="text-emerald-600 text-sm">✓</span>
                      ) : (
                        <span className="text-destructive text-sm">✗</span>
                      )}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* R68.2: Liquid drift over time — drill-down for the Dashboard sparkline */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  <CardTitle className="text-base">Liquid drift over time</CardTitle>
                </div>
                <CardDescription>
                  Every time you reconcile a liquid home (set, bulk-set, or clear a
                  balance) the tracker records the total drift from the recommended
                  split, as governed by your <GlossaryTerm id="liquid-reserve-diversification">liquid-reserve diversification</GlossaryTerm> rules and your <GlossaryTerm id="allocation-policy">allocation policy</GlossaryTerm>. This is the history behind the Dashboard sparkline &mdash; a
                  downward trend means your balances are converging back to target.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!driftHistory || driftHistory.length < 2 ? (
                  <p className="text-sm text-muted-foreground">
                    Not enough history yet. Reconcile your liquid homes a few times
                    (on the Dashboard) and the drift trend will appear here.
                  </p>
                ) : (
                  (() => {
                    const first = driftHistory[0].totalDrift;
                    const last = driftHistory[driftHistory.length - 1].totalDrift;
                    const converging = last <= first;
                    const breachCount = driftHistory.filter((d) => d.breached).length;
                    const recent = [...driftHistory].slice(-12).reverse();
                    return (
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-4">
                          <Sparkline
                            values={driftHistory.map((d) => d.totalDrift)}
                            threshold={driftHistory[driftHistory.length - 1].thresholdValue}
                            tone={converging ? "emerald" : "amber"}
                            width={220}
                            height={56}
                          />
                          <div className="min-w-0 text-sm">
                            <p className="flex items-center gap-1.5 font-medium">
                              {converging ? (
                                <TrendingDown className="w-4 h-4 text-emerald-500" />
                              ) : (
                                <TrendingUp className="w-4 h-4 text-amber-500" />
                              )}
                              {converging ? "Converging toward target" : "Drifting further from target"}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Latest drift {formatKES(last, 0)} · {driftHistory.length} snapshots ·{" "}
                              {breachCount} over threshold
                            </p>
                          </div>
                        </div>
                        <div className="rounded-md border">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>When</TableHead>
                                <TableHead className="text-right">Total drift</TableHead>
                                <TableHead className="text-right">Threshold</TableHead>
                                <TableHead className="text-right">Status</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {recent.map((d, i) => (
                                <TableRow key={`${d.at ?? i}-${i}`}>
                                  <TableCell className="text-sm">
                                    {d.at ? formatRelativeTime(d.at) : "—"}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {formatKES(d.totalDrift, 0)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums text-muted-foreground">
                                    {formatKES(d.thresholdValue, 0)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {d.breached ? (
                                      <Badge variant="destructive">Over</Badge>
                                    ) : (
                                      <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15 border-0">
                                        Within
                                      </Badge>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    );
                  })()
                )}
              </CardContent>
            </Card>

            {/* How this is computed */}
            <Card className="border-sky-500/30 bg-sky-500/5">
              <CardContent className="flex items-start gap-3 py-5">
                <Info className="w-5 h-5 text-sky-500 shrink-0 mt-0.5" />
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">
                    How the &ldquo;today&rdquo; value is reconciled
                  </p>
                  <p>
                    The sum-of-holdings figure adds the primary MMF balance, every
                    secondary MMF, all active bank deposits and all un-matured CBK
                    register securities (valued at face). Liquid balances stay within
                    your <GlossaryTerm id="per-issuer-cap">per-issuer cap</GlossaryTerm> (KDIC) and{" "}
                    <GlossaryTerm id="per-type-cap">per-type cap</GlossaryTerm>. The projection
                    engine&rsquo;s &ldquo;today&rdquo; figure is the value of the
                    most recent actual-seeded month; before any month has elapsed
                    it equals the sum of holdings. The dashboard total and
                    net-worth card both read the same actuals aggregation, so any
                    drift between them points at a double-count or a missing
                    holding rather than a rounding artefact.
                  </p>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
