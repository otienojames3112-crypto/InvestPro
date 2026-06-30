import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { bankHoldingValue, blendedYield, buildAllocation, estimateAnnualTaxLines } from "@shared/actuals";
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
import { Receipt, Percent, ShieldCheck, ShieldAlert, TrendingDown, Info, Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toCsv, downloadCsv, slugify } from "@shared/csv";
import { GlossaryTerm } from "@/components/GlossaryTerm";

function kes(n: number, dp = 0): string {
  return n.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

interface TaxLine {
  source: string;
  basis: number; // annual income before tax
  rate: number; // WHT %
  tax: number;
  net: number;
  exempt: boolean;
  /** True when the rate is an UNVERIFIED placeholder (offshore) the user must confirm. */
  unverified?: boolean;
  note: string;
}

export default function TaxSummary({ embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId, portfolio } = usePortfolio();
  const fund = useSelectedFund();

  const { data: deposits } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: settings } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: securities } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: holdings } = trpc.otherHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: secondaryMmfs = [] } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: bankHoldings = [] } = trpc.bankHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: projection } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  // Full-period projected WHT across the entire horizon (engine per-month tax).
  const projectedTotalTax = useMemo(
    () => (projection ?? []).reduce((s, m) => s + Number(m.whtThisMonth ?? 0), 0),
    [projection]
  );
  const projectionMonths = projection?.length ?? 0;

  // Bucket balances.
  // MMF bucket = primary-MMF deposit rows only (gov-security, bank, and
  // secondary-MMF deposits are represented by their own destinations and are
  // excluded here to avoid double-counting). T-bill / IFB / FXD buckets come
  // from the SECURITIES REGISTER — the single source of truth — using unmatured
  // face values, so this page reconciles with the Dashboard's Live Net Worth.
  // Round 33: derive bucket balances from the SAME shared `buildAllocation`
  // helper the Portfolio Review and Reconciliation pages use. Passing
  // `primaryFundId` guarantees a secondary-MMF deposit (an `mmf_fund` row into a
  // non-primary fund) is excluded from the primary-MMF bucket, fixing the
  // page-level +KES 2,500 double-count. The prior inline reducer only skipped
  // gov-security/bank rows and silently leaked secondary deposits into `mmf`.
  const buckets = useMemo(() => {
    const a = buildAllocation({
      deposits: (deposits ?? []) as never,
      securities: (securities ?? []) as never,
      secondaryMmfs: (secondaryMmfs ?? []) as never,
      bankHoldings: (bankHoldings ?? []) as never,
      otherHoldings: (holdings ?? []) as never,
      primaryFundId: fund.fundId,
    });
    return { mmf: a.primaryMmf, tbill: a.tbill, ifb: a.ifb, fxd: a.fxd };
  }, [deposits, securities, secondaryMmfs, bankHoldings, holdings, fund.fundId]);

  const whtRate = settings?.withholdingTax ?? 15;
  // Authoritative: when a fund is selected the engine uses its EAR; otherwise the
  // manual saved mmfYield is the fallback (matches dbToEngine on the server).
  const mmfYield = fund.hasFund ? fund.fundEar : (settings?.mmfYield ?? fund.fundEar);
  const tbillRate = settings?.tbill364Rate ?? 8.97;
  const ifbRate = settings?.ifbCouponRate ?? 12.5;
  const fxdRate = settings?.fxdCouponRate ?? 12.35;

  // Build tax lines (annualised, based on current balances).
  // Round 40 (R40.7): the INVESTMENT-income lines (MMF, secondary MMF, T-bill,
  // IFB, FXD, bank) now come from the SHARED `estimateAnnualTaxLines` engine —
  // the same arithmetic + WHT authority behind the Dashboard's Est. Annual Tax —
  // so the two pages can no longer drift. Equity dividends remain a page-level
  // addendum layered on top (they are not part of the reconciled investment
  // total the Dashboard tracks).
  const lines: TaxLine[] = useMemo(() => {
    const engine = estimateAnnualTaxLines({
      buckets,
      primaryMmfRate: mmfYield,
      tbillRate,
      ifbRate,
      fxdRate,
      withholdingTax: whtRate,
      primaryMmfLabel: fund.fundLabel,
      secondaryMmfs: (secondaryMmfs ?? []).map((m) => ({
        label: `${m.label?.trim() ? `${m.label} — ` : ""}${m.fundName}`,
        balance: Number(m.currentBalance ?? 0),
        rate: Number(m.ear ?? 0),
        whtRate: whtRate,
      })),
      bankHoldings: (bankHoldings ?? [])
        .filter((b) => b.isActive)
        .map((b) => ({
          label: `${b.label || b.bankName} ${b.instrumentType === "fixed_deposit" ? "(fixed deposit)" : "(call deposit)"}`,
          principal: Number(b.principal ?? 0),
          rate: Number(b.interestRate ?? 0),
          whtRate: whtRate,
        })),
      // Round 43 (Fix #4): feed the SAME non-matured T-bill / zero-coupon rows the
      // Dashboard's computeActualsTotals taxes, so the discount basis (face − price)
      // is identical and the two pages' tax totals tie to the shilling.
      tbillSecurities: (securities ?? [])
        .filter(
          (s) =>
            !s.isMatured &&
            (String(s.securityType).startsWith("tbill") || s.securityType === "zero_coupon"),
        )
        .map((s) => ({
          faceValue: Number(s.faceValue ?? 0),
          purchasePrice: s.purchasePrice != null ? Number(s.purchasePrice) : null,
        })),
    });
    const result: TaxLine[] = engine.lines.map((l) => ({
      source: l.source,
      basis: l.basis,
      rate: l.rate,
      tax: l.tax,
      net: l.net,
      exempt: l.exempt,
      unverified: false,
      note: l.note,
    }));

    // Part 5 — income addendum across ALL price-driven classes (equity dividends,
    // REIT distributions, offshore-fund income), valued off the SAME mark-to-model
    // figure (valueKes) the rest of the app uses and the income rate stored on the
    // holding (incomeRatePct). These remain a page-level addendum, clearly outside
    // the reconciled fixed-income investment total. We NEVER invent a rate: a line
    // appears only when the holding actually carries a positive income rate.
    (holdings ?? [])
      .filter((h) => h.priceDriven && (h.incomeRatePct ?? 0) > 0)
      .forEach((h) => {
        const value = h.valueKes ?? h.currentValue;
        const incomeRate = h.incomeRatePct ?? 0;
        const basis = value * (incomeRate / 100);
        if (basis <= 0) return;
        // Resident WHT, sourced per class (Part 7.0): NSE dividends 5% (final);
        // REIT distributions track the sourced resident 5%; offshore income uses
        // an UNVERIFIED 15% benchmark the user must confirm. None nets at an
        // unsourced zero, and offshore is explicitly labelled unverified.
        const cls = h.behaviorClass;
        const isEquity = cls === "equity";
        const isReit = cls === "reit";
        const isOffshore = cls === "offshore_fund";
        const whtPct = isOffshore ? 15 : 5;
        const incomeLabel = isEquity ? "Dividends" : isReit ? "Distributions" : "Income";
        const tax = basis * (whtPct / 100);
        result.push({
          source: `${incomeLabel} — ${h.name}`,
          basis,
          rate: whtPct,
          tax,
          net: basis - tax,
          exempt: false,
          unverified: isOffshore,
          note: isEquity
            ? "5% WHT on NSE dividends (final tax for resident individuals)."
            : isReit
              ? "5% resident WHT — a registered REIT is exempt at trust level (ITA s.20), but WHT on unit-holder dividend/interest income still applies (NSE; TripleOKlaw 2023). Confirm for your circumstances."
              : "15% — UNVERIFIED benchmark. Kenyan residents are taxed on worldwide income; the actual rate is treaty/jurisdiction dependent. Confirm before relying on this figure.",
        });
      });

    return result;
  }, [buckets, mmfYield, tbillRate, ifbRate, fxdRate, whtRate, fund.fundLabel, holdings, secondaryMmfs, bankHoldings, securities]);

  const totalGross = lines.reduce((s, l) => s + l.basis, 0);
  const totalTax = lines.reduce((s, l) => s + l.tax, 0);
  const totalNet = lines.reduce((s, l) => s + l.net, 0);
  const effectiveTaxRate = totalGross > 0 ? (totalTax / totalGross) * 100 : 0;

  // Round 32: blended yield via the ONE shared helper. Net yield is computed on
  // the SAME base as gross (each component's gross minus WHT, IFB exempt), so a
  // bank-deposit line can no longer be dropped from the numerator while staying
  // in the denominator (the cause of the prior impossible ~3.56% net yield).
  const blended = blendedYield({
    primaryMmf: buckets.mmf,
    primaryMmfRate: mmfYield,
    secondaryMmfs: secondaryMmfs.map((m) => ({ balance: m.currentBalance, rate: m.ear })),
    bankHoldings: (bankHoldings ?? [])
      .filter((b) => b.isActive)
      .map((b) => ({
        value: bankHoldingValue({ principal: Number(b.principal ?? 0), interestRate: Number(b.interestRate ?? 0), isActive: b.isActive, currentValue: Number(b.currentValue ?? 0) }),
        rate: Number(b.interestRate ?? 0),
      })),
    securities: [
      { value: buckets.tbill, rate: tbillRate, taxExempt: false },
      { value: buckets.ifb, rate: ifbRate, taxExempt: true },
      { value: buckets.fxd, rate: fxdRate, taxExempt: false },
    ],
    whtRate,
  });
  const fixedIncomeTotal = blended.base;
  const grossYieldBlended = blended.grossYield;
  const netYieldBlended = blended.netYield;

  // CSV export: the per-source tax lines plus the totals + yield reconciliation,
  // as raw numbers for spreadsheets.
  const handleExportCsv = () => {
    const headers = ["Income Source", "Gross/yr (KES)", "WHT Rate %", "Tax (KES)", "Net/yr (KES)", "Exempt", "Note"];
    const rows: (string | number)[][] = lines.map((l) => [
      l.source,
      Math.round(l.basis),
      l.exempt ? 0 : Number(l.rate.toFixed(0)),
      Math.round(l.tax),
      Math.round(l.net),
      l.exempt ? "Yes" : "No",
      l.note,
    ]);
    rows.push(["TOTAL", Math.round(totalGross), "", Math.round(totalTax), Math.round(totalNet), "", `Effective tax rate ${effectiveTaxRate.toFixed(1)}%`]);
    rows.push([]);
    rows.push(["YIELD RECONCILIATION", "", "", "", "", "", ""]);
    rows.push(["Fixed-income base (KES)", Math.round(fixedIncomeTotal), "", "", "", "", ""]);
    rows.push(["Gross blended yield %", Number(grossYieldBlended.toFixed(2)), "", "", "", "", ""]);
    rows.push(["Net blended yield %", Number(netYieldBlended.toFixed(2)), "", "", "", "", ""]);
    rows.push(["Projected total WHT over horizon (KES)", Math.round(projectedTotalTax), "", "", "", "", `${projectionMonths} months`]);
    const csv = toCsv(headers, rows);
    const stamp = new Date().toISOString().split("T")[0];
    downloadCsv(csv, `tax-summary-${slugify(portfolio?.name)}-${stamp}.csv`);
  };

  return (
    <AppShell embedded={embedded}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-primary" />
              <h1
                className="text-2xl font-bold"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Tax Summary &amp; Yield Reconciliation
              </h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-3xl">
              An annualised view of the{" "}
              <GlossaryTerm id="wht">withholding tax (WHT)</GlossaryTerm>{" "}
              applied to each income source at current balances and rates, and a
              reconciliation of your <GlossaryTerm id="gross-yield"><strong>gross</strong> quoted yield</GlossaryTerm> against
              the <GlossaryTerm id="net-yield"><strong>net-of-tax</strong> return</GlossaryTerm> you actually keep.
              This is computed on your <strong>income / tax base</strong> &mdash; the
              income-producing assets (MMF, T-bill, IFB, FXD and bank instruments)
              &mdash; not your whole-portfolio net worth, so non-income assets such
              as equities or property do not dilute the blended yield.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0 print:hidden">
            <Button variant="outline" className="bg-background" onClick={handleExportCsv}>
              <Download className="w-4 h-4 mr-2" /> Download CSV
            </Button>
            <Button variant="outline" className="bg-background" onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
            </Button>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground mb-1">
                Gross Annual Income
              </p>
              <p className="text-xl font-bold">{kes(totalGross)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <TrendingDown className="w-3.5 h-3.5" /> Total Tax (annual)
              </p>
              <p className="text-xl font-bold text-red-500">−{kes(totalTax)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground mb-1">
                Net Annual Income
              </p>
              <p className="text-xl font-bold text-primary">{kes(totalNet)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Percent className="w-3.5 h-3.5" /> Effective Tax Rate
              </p>
              <p className="text-xl font-bold">
                {effectiveTaxRate.toFixed(1)}%
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tax lines table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tax by Income Source</CardTitle>
            <CardDescription>
              Annualised on current balances. Empty buckets are omitted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No income-generating balances recorded yet. Add deposits or
                holdings to see your tax breakdown.
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Income Source</TableHead>
                      <TableHead className="text-right">Gross / yr</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                      <TableHead className="text-right">Net / yr</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <div className="font-medium">{l.source}</div>
                          <div className="text-xs text-muted-foreground">
                            {l.note}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {kes(l.basis)}
                        </TableCell>
                        <TableCell className="text-right">
                          {l.exempt ? (
                            <Badge variant="secondary" className="gap-1">
                              <ShieldCheck className="w-3 h-3" /> Exempt
                            </Badge>
                          ) : l.unverified ? (
                            <span className="inline-flex items-center gap-1 justify-end">
                              {l.rate.toFixed(0)}%
                              <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700 dark:text-amber-300">
                                <ShieldAlert className="w-3 h-3" /> Unverified
                              </Badge>
                            </span>
                          ) : (
                            `${l.rate.toFixed(0)}%`
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-red-500">
                          {l.tax > 0 ? `−${kes(l.tax)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-primary font-medium">
                          {kes(l.net)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Yield reconciliation */}
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">
              Fixed-Income Yield Reconciliation
            </CardTitle>
            <CardDescription>
              Blended across all your MMF account{secondaryMmfs.length > 0 ? "s" : ""}, T-bill, IFB and FXD balances
              &mdash; the income / tax base ({kes(fixedIncomeTotal)} total), which is
              narrower than Full Net Worth by design.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">
                  <GlossaryTerm id="blended-yield">Blended</GlossaryTerm>{" "}<GlossaryTerm id="gross-yield">Gross Yield</GlossaryTerm>
                </p>
                <p className="text-2xl font-bold">
                  {grossYieldBlended.toFixed(2)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Weighted average of quoted rates.
                </p>
              </div>
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">
                  <GlossaryTerm id="tax-drag">Tax Drag</GlossaryTerm>
                </p>
                <p className="text-2xl font-bold text-red-500">
                  −{(grossYieldBlended - netYieldBlended).toFixed(2)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Yield lost to withholding tax.
                </p>
              </div>
              <div className="rounded-lg bg-primary/10 p-4">
                <p className="text-xs text-muted-foreground">
                  <GlossaryTerm id="blended-yield">Blended</GlossaryTerm>{" "}<GlossaryTerm id="net-yield">Net Yield</GlossaryTerm>
                </p>
                <p className="text-2xl font-bold text-primary">
                  {netYieldBlended.toFixed(2)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  What you actually keep after tax.
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Infrastructure bonds (IFB) lift the net yield because their coupon
              is tax-exempt — the more weight in IFBs, the smaller the gap
              between gross and net.
            </p>
          </CardContent>
        </Card>

        {/* Full-period projected tax */}
        {projectionMonths > 0 && (
          <Card className="border-amber-500/25">
            <CardHeader>
              <CardTitle className="text-base">Projected Tax Over the Full Plan</CardTitle>
              <CardDescription>
                Total withholding tax the projection engine expects you to pay across the entire
                {" "}{projectionMonths}-month horizon — computed month by month as balances grow, on MMF
                (primary + secondary), bank deposits, T-bills and FXD coupons (IFB coupons are exempt).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="rounded-lg bg-muted/30 p-4">
                  <p className="text-xs text-muted-foreground">Full-period projected WHT</p>
                  <p className="text-2xl font-bold text-red-500">−{kes(projectedTotalTax)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Sum of monthly WHT over {projectionMonths} months.
                  </p>
                </div>
                <div className="rounded-lg bg-muted/30 p-4">
                  <p className="text-xs text-muted-foreground">Avg WHT / month</p>
                  <p className="text-2xl font-bold">
                    {kes(projectionMonths > 0 ? projectedTotalTax / projectionMonths : 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Deducted at source as it accrues.</p>
                </div>
                <div className="rounded-lg bg-muted/30 p-4">
                  <p className="text-xs text-muted-foreground">Annualised snapshot (above)</p>
                  <p className="text-2xl font-bold">−{kes(totalTax)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Current balances only — grows as the plan builds.
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-4 flex items-start gap-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                The annualised snapshot taxes only what you hold today; the full-period figure tracks tax
                on the growing balance across every month of the plan, so it is the more complete picture
                of the tax you will actually pay on the journey to your goal.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Disclaimer */}
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">
              Estimates are annualised on current balances and the rates in your
              Rate Settings, applying Kenyan WHT rules (15% on most interest, 5%
              on dividends, IFB coupon exempt, 10% on 10+ year bonds). They are
              for tracking and education only and are not tax advice. Confirm
              current rules with KRA or a qualified tax adviser.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
