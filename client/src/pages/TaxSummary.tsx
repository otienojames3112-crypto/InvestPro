import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
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
import { Receipt, Percent, ShieldCheck, TrendingDown, Info } from "lucide-react";

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
  note: string;
}

export default function TaxSummary() {
  const { portfolioId } = usePortfolio();
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

  // Bucket balances
  const buckets = useMemo(() => {
    const acc = { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };
    (deposits ?? []).forEach((d) => {
      const k = d.bucket as keyof typeof acc;
      if (k in acc) acc[k] += Number(d.amount);
    });
    return acc;
  }, [deposits]);

  const whtRate = settings?.withholdingTax ?? 15;
  const mmfYield = fund.fundEar || settings?.mmfYield || 8.78;
  const tbillRate = settings?.tbill364Rate ?? 8.97;
  const ifbRate = settings?.ifbCouponRate ?? 12.5;
  const fxdRate = settings?.fxdCouponRate ?? 12.35;

  // Build tax lines (annualised, based on current balances)
  const lines: TaxLine[] = useMemo(() => {
    const result: TaxLine[] = [];

    // MMF interest — 15% WHT, final
    if (buckets.mmf > 0) {
      const basis = buckets.mmf * (mmfYield / 100);
      const tax = basis * (whtRate / 100);
      result.push({
        source: `${fund.fundLabel} interest`,
        basis,
        rate: whtRate,
        tax,
        net: basis - tax,
        exempt: false,
        note: "Withheld at source by fund manager; final tax.",
      });
    }

    // T-bill discount income — 15% WHT
    if (buckets.tbill > 0) {
      const basis = buckets.tbill * (tbillRate / 100);
      const tax = basis * (whtRate / 100);
      result.push({
        source: "Treasury Bill discount income",
        basis,
        rate: whtRate,
        tax,
        net: basis - tax,
        exempt: false,
        note: "15% WHT on T-bill interest (discount).",
      });
    }

    // IFB coupon — exempt
    if (buckets.ifb > 0) {
      const basis = buckets.ifb * (ifbRate / 100);
      result.push({
        source: "Infrastructure Bond (IFB) coupon",
        basis,
        rate: 0,
        tax: 0,
        net: basis,
        exempt: true,
        note: "Infrastructure bonds are tax-exempt under the Income Tax Act.",
      });
    }

    // FXD coupon — 15% WHT (10% if tenor >= 10 years; user can adjust)
    if (buckets.fxd > 0) {
      const basis = buckets.fxd * (fxdRate / 100);
      const tax = basis * (whtRate / 100);
      result.push({
        source: "Fixed-Coupon Treasury Bond (FXD) coupon",
        basis,
        rate: whtRate,
        tax,
        net: basis - tax,
        exempt: false,
        note: "15% WHT (10% applies to bonds of 10+ year tenor).",
      });
    }

    // Equity dividends — 5% WHT, final (estimate using assumedReturnBase as dividend yield proxy if present)
    (holdings ?? [])
      .filter((h) => h.assetClass === "equity")
      .forEach((h) => {
        const divYield = h.assumedReturnBase ?? 0;
        if (divYield > 0) {
          const basis = h.currentValue * (divYield / 100);
          const tax = basis * 0.05;
          result.push({
            source: `Dividends — ${h.name}`,
            basis,
            rate: 5,
            tax,
            net: basis - tax,
            exempt: false,
            note: "5% WHT on dividends (final tax for resident individuals).",
          });
        }
      });

    return result;
  }, [buckets, mmfYield, tbillRate, ifbRate, fxdRate, whtRate, fund.fundLabel, holdings]);

  const totalGross = lines.reduce((s, l) => s + l.basis, 0);
  const totalTax = lines.reduce((s, l) => s + l.tax, 0);
  const totalNet = lines.reduce((s, l) => s + l.net, 0);
  const effectiveTaxRate = totalGross > 0 ? (totalTax / totalGross) * 100 : 0;

  const fixedIncomeTotal =
    buckets.mmf + buckets.tbill + buckets.ifb + buckets.fxd;
  const grossYieldBlended =
    fixedIncomeTotal > 0
      ? ((buckets.mmf * mmfYield +
          buckets.tbill * tbillRate +
          buckets.ifb * ifbRate +
          buckets.fxd * fxdRate) /
          fixedIncomeTotal)
      : 0;
  const netYieldBlended =
    fixedIncomeTotal > 0
      ? (lines
          .filter((l) =>
            ["interest", "discount", "coupon"].some((k) => l.source.toLowerCase().includes(k))
          )
          .reduce((s, l) => s + l.net, 0) /
          fixedIncomeTotal) *
        100
      : 0;

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
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
            An annualised, whole-portfolio view of the withholding tax (WHT)
            applied to each income source at current balances and rates, and a
            reconciliation of your <strong>gross</strong> quoted yield against
            the <strong>net-of-tax</strong> return you actually keep.
          </p>
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
              Blended across your MMF, T-bill, IFB and FXD balances
              ({kes(fixedIncomeTotal)} total).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">
                  Blended Gross Yield
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
                  Tax Drag
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
                  Blended Net Yield
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
