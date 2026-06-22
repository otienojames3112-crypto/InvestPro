import { useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarClock,
  Coins,
  Percent,
  TrendingUp,
  Info,
  Receipt,
} from "lucide-react";
import { simulateAccrual } from "@shared/accrual";

/** Format a number as KES currency. */
function kes(n: number, dp = 2): string {
  return n.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export default function MmfAccrual() {
  const { portfolioId } = usePortfolio();
  const fund = useSelectedFund();

  // Pull the selected fund's full record (for accrual settings) from the funds list
  const { data: funds } = trpc.mmfFunds.list.useQuery(undefined, {
    enabled: true,
  });
  const fundRecord = useMemo(
    () => funds?.find((f) => f.id === fund.fundId) ?? null,
    [funds, fund.fundId]
  );

  // Pull current MMF deposits to suggest a starting balance
  const { data: deposits } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const mmfBalance = useMemo(() => {
    if (!deposits) return 0;
    return deposits
      .filter((d) => d.bucket === "mmf")
      .reduce((s, d) => s + Number(d.amount), 0);
  }, [deposits]);

  // Editable inputs (default to live values)
  const [principal, setPrincipal] = useState<string>("");
  const [horizon, setHorizon] = useState<string>("30");

  const dayCount = (fundRecord?.dayCountBasis as number) ?? 365;
  const crediting = (fundRecord?.creditingFrequency as "daily" | "monthly") ?? "daily";
  const whtRate = fundRecord ? Number(fundRecord.whtRate) : 15;
  const annualEar = fund.fundEar;

  const effectivePrincipal =
    principal === "" ? mmfBalance : Math.max(0, Number(principal) || 0);
  const days = Math.max(1, Math.min(366, Number(horizon) || 30));

  const rows = useMemo(
    () => simulateAccrual(effectivePrincipal, annualEar, dayCount, whtRate, crediting, days),
    [effectivePrincipal, annualEar, dayCount, whtRate, crediting, days]
  );

  const totalGross = rows.reduce((s, r) => s + r.grossInterest, 0);
  const totalWht = rows.reduce((s, r) => s + r.wht, 0);
  const totalNet = rows.reduce((s, r) => s + r.netInterest, 0);
  const finalBalance = rows.length ? rows[rows.length - 1].closingBalance : effectivePrincipal;

  // "If you withdrew today" — one full day of net interest plus principal
  const oneDayGross = effectivePrincipal * (annualEar / 100 / dayCount);
  const oneDayWht = oneDayGross * (whtRate / 100);
  const oneDayNet = oneDayGross - oneDayWht;

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" />
            <h1
              className="text-2xl font-bold"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Daily MMF Accrual Ledger
            </h1>
          </div>
          <p className="text-muted-foreground text-sm max-w-3xl">
            Money market funds accrue interest <strong>every day</strong> and
            quote a net yield after the manager's fee. This ledger shows exactly
            how interest builds on your{" "}
            <span className="text-foreground font-medium">{fund.fundName}</span>{" "}
            balance day by day, how much withholding tax (WHT) is deducted, and
            what you would actually receive if you withdrew.
          </p>
        </div>

        {/* Fund parameters banner */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Selected Fund</p>
                <p className="font-semibold text-sm">{fund.fundName}</p>
                {!fund.hasFund && (
                  <p className="text-xs text-amber-500 mt-0.5">
                    No fund selected — using fallback rate. Pick one on MMF Funds.
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Net Yield (EAR)</p>
                <p className="font-semibold text-sm flex items-center gap-1">
                  <Percent className="w-3 h-3 text-primary" />
                  {annualEar.toFixed(2)}% p.a.
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Day-Count Basis</p>
                <p className="font-semibold text-sm">Actual / {dayCount}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Crediting</p>
                <p className="font-semibold text-sm capitalize">{crediting}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inputs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accrual Inputs</CardTitle>
            <CardDescription>
              Defaults to your current MMF deposits balance. Adjust to model any
              amount or horizon. All figures are deterministic — no forecasts.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="principal">Starting Balance (KES)</Label>
              <Input
                id="principal"
                type="number"
                inputMode="decimal"
                placeholder={mmfBalance ? String(mmfBalance) : "e.g. 100000"}
                value={principal}
                onChange={(e) => setPrincipal(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {principal === "" && mmfBalance > 0
                  ? `Using your tracked MMF balance: ${kes(mmfBalance)}`
                  : "Enter the amount currently in the fund."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="horizon">Days to Project</Label>
              <Select value={horizon} onValueChange={setHorizon}>
                <SelectTrigger id="horizon">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days (1 week)</SelectItem>
                  <SelectItem value="30">30 days (1 month)</SelectItem>
                  <SelectItem value="90">90 days (1 quarter)</SelectItem>
                  <SelectItem value="180">180 days (6 months)</SelectItem>
                  <SelectItem value="365">365 days (1 year)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Withholding Tax Rate</Label>
              <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/30 text-sm">
                {whtRate.toFixed(2)}% (final tax on interest)
              </div>
              <p className="text-xs text-muted-foreground">
                Editable per-fund on MMF Funds → fund settings.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Coins className="w-3.5 h-3.5" /> Gross Interest ({days}d)
              </div>
              <p className="text-xl font-bold">{kes(totalGross)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Receipt className="w-3.5 h-3.5" /> WHT Deducted
              </div>
              <p className="text-xl font-bold text-red-500">−{kes(totalWht)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <TrendingUp className="w-3.5 h-3.5" /> Net Interest
              </div>
              <p className="text-xl font-bold text-primary">{kes(totalNet)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Coins className="w-3.5 h-3.5" /> Balance After {days}d
              </div>
              <p className="text-xl font-bold">{kes(finalBalance)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Withdraw today readout */}
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" /> If you withdrew today
            </CardTitle>
            <CardDescription>
              One full day of accrual on {kes(effectivePrincipal)}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground">Gross / day</span>
                <span className="font-semibold">{kes(oneDayGross, 4)}</span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground">WHT / day</span>
                <span className="font-semibold text-red-500">
                  −{kes(oneDayWht, 4)}
                </span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2">
                <span className="text-muted-foreground">Net / day</span>
                <span className="font-semibold text-primary">
                  {kes(oneDayNet, 4)}
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Most Kenyan MMFs allow withdrawal within 1–3 business days and you
              keep all net interest accrued up to the withdrawal date. There is
              no penalty for withdrawing — unlike a fixed deposit.
            </p>
          </CardContent>
        </Card>

        {/* Daily breakdown table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Day-by-Day Breakdown</CardTitle>
            <CardDescription>
              {crediting === "daily"
                ? "Net interest is added to the balance each day, so tomorrow's interest is calculated on a slightly larger balance (daily compounding)."
                : "Interest accrues daily on the period's opening balance and is credited (compounded) every 30 days."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto max-h-[480px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-16">Day</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">WHT</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.day}>
                      <TableCell className="font-medium">{r.day}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {kes(r.openingBalance)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {kes(r.grossInterest, 4)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-red-500">
                        −{kes(r.wht, 4)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-primary">
                        {kes(r.netInterest, 4)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium">
                        {kes(r.closingBalance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Tax explainer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" /> How MMF interest is taxed in Kenya
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Interest earned on a money market fund is subject to a{" "}
              <strong className="text-foreground">
                {whtRate.toFixed(0)}% withholding tax
              </strong>
              , which the fund manager deducts at source before crediting your
              account. For most individuals this is a{" "}
              <strong className="text-foreground">final tax</strong> — you do not
              pay any further income tax on it and it does not need to be
              declared as additional taxable income.
            </p>
            <p>
              The yield (EAR) quoted by the fund is typically the{" "}
              <strong className="text-foreground">net-of-fee</strong> figure but{" "}
              <strong className="text-foreground">before</strong> withholding
              tax. That is why the "Net Interest" you actually keep in the table
              above is lower than a naive balance × yield calculation.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="secondary">15% WHT — final tax on interest</Badge>
              <Badge variant="secondary">No early-withdrawal penalty</Badge>
              <Badge variant="secondary">Daily accrual</Badge>
            </div>
            <p className="text-xs pt-2">
              Source: PwC Worldwide Tax Summaries (Kenya), withholding tax on
              "interest — other" = 15%. Rates are user-editable; confirm current
              rules with KRA or a tax adviser. This tool is for tracking and
              education, not tax advice.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
