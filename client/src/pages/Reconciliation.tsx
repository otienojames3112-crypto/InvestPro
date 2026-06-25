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
import { Scale, CheckCircle2, AlertTriangle, Info } from "lucide-react";
import { formatKES } from "@/lib/format";

export default function Reconciliation() {
  const { portfolioId, portfolio } = usePortfolio();

  const { data, isLoading } = trpc.projection.reconciliation.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId },
  );

  const full = data?.full;
  const mmf = data?.mmf;
  const gov = data?.gov;
  const bank = data?.bank;
  const govAccrual = data?.govAccrual;
  const bankAccrual = data?.bankAccrual;
  const reconciled =
    !!full?.reconciled &&
    !!mmf?.ok &&
    (gov?.ok ?? true) &&
    (bank?.ok ?? true) &&
    (govAccrual?.ok ?? true) &&
    (bankAccrual?.ok ?? true);

  return (
    <AppShell>
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
                        Every valuation path agrees within{" "}
                        {formatKES(full.maxDiff, 2)} (tolerance is KES 5). The
                        portfolio&rsquo;s recorded holdings, the engine&rsquo;s
                        &ldquo;today&rdquo; figure, and the dashboard totals are
                        consistent.
                      </>
                    ) : (
                      <>
                        The largest gap is {formatKES(full.maxDiff, 2)} against
                        the &ldquo;sum of holdings&rdquo; reference of{" "}
                        {formatKES(full.reference, 2)}. See the breakdown below.
                      </>
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>

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
                  The day-by-day accrual schedule for CBK securities must match an
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
                    register securities (valued at face). The projection
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
