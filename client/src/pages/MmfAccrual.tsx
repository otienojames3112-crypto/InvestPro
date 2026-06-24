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
  Layers,
} from "lucide-react";
import { simulateAccrual, oneDayInterest, geometricDailyRate, type DayRow } from "@shared/accrual";

/** Format a number as KES currency. */
function kes(n: number, dp = 2): string {
  return n.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** A single MMF account to simulate — either the primary fund or a tracked secondary account. */
interface AccrualAccount {
  /** Stable selector key. */
  key: string;
  /** Display name shown in the selector and summaries. */
  name: string;
  /** Fund record id (mmfFunds.id), used to read accrual settings. */
  fundId: number | null;
  /** Starting balance for this account (KES). */
  balance: number;
  /** Net yield (EAR) for this account's fund. */
  ear: number;
  /** Day-count basis (360 / 365). */
  dayCount: number;
  /** Crediting frequency. */
  crediting: "daily" | "monthly";
  /** Withholding tax rate (%). */
  whtRate: number;
}

export default function MmfAccrual() {
  const { portfolioId } = usePortfolio();
  const fund = useSelectedFund();

  // Full fund catalogue (for per-fund accrual settings: day-count, crediting, WHT).
  const { data: funds } = trpc.mmfFunds.list.useQuery(undefined, { enabled: true });
  const fundRecord = useMemo(
    () => funds?.find((f) => f.id === fund.fundId) ?? null,
    [funds, fund.fundId]
  );

  // Tracked secondary MMF accounts for this portfolio.
  const { data: secondaryMmfs = [] } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  // Current MMF deposits → suggested primary starting balance.
  const { data: deposits } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // Primary-MMF balance = primary-MMF deposit rows only. Bank-instrument and
  // secondary-MMF deposits also carry bucket "mmf" but belong to their own
  // accounts (each secondary is simulated separately below), and government
  // securities live in the register, so all of those are excluded here.
  const secondaryFundIds = useMemo(
    () => new Set((secondaryMmfs ?? []).map((s) => s.mmfFundId).filter((id): id is number => typeof id === "number")),
    [secondaryMmfs]
  );
  const mmfBalance = useMemo(() => {
    if (!deposits) return 0;
    return deposits
      .filter((d) => {
        if (d.bucket !== "mmf") return false;
        const inst = (d as { institutionType?: string | null }).institutionType;
        if (inst === "bank_instrument" || inst === "government_security") return false;
        const fundId = (d as { mmfFundId?: number | null }).mmfFundId;
        if (inst === "mmf_fund" && fundId != null && secondaryFundIds.has(fundId)) return false;
        return true;
      })
      .reduce((s, d) => s + Number(d.amount), 0);
  }, [deposits, secondaryFundIds]);

  // Primary fund accrual settings (fall back to sane defaults).
  const primaryDayCount = (fundRecord?.dayCountBasis as number) ?? 365;
  const primaryCrediting = (fundRecord?.creditingFrequency as "daily" | "monthly") ?? "daily";
  const primaryWht = fundRecord ? Number(fundRecord.whtRate) : 15;

  // Build the list of selectable accounts: Primary first, then each secondary.
  const accounts = useMemo<AccrualAccount[]>(() => {
    const list: AccrualAccount[] = [
      {
        key: "primary",
        name: `${fund.fundName} (primary)`,
        fundId: fund.fundId ?? null,
        balance: mmfBalance,
        ear: fund.fundEar,
        dayCount: primaryDayCount,
        crediting: primaryCrediting,
        whtRate: primaryWht,
      },
    ];
    for (const s of secondaryMmfs) {
      const rec = funds?.find((f) => f.id === s.mmfFundId);
      list.push({
        key: `secondary-${s.id}`,
        name: s.label?.trim() ? `${s.label} (${s.fundName})` : s.fundName,
        fundId: s.mmfFundId,
        balance: s.currentBalance,
        ear: s.ear,
        dayCount: (rec?.dayCountBasis as number) ?? 365,
        crediting: (rec?.creditingFrequency as "daily" | "monthly") ?? "daily",
        whtRate: rec ? Number(rec.whtRate) : 15,
      });
    }
    return list;
  }, [fund.fundName, fund.fundId, fund.fundEar, mmfBalance, primaryDayCount, primaryCrediting, primaryWht, secondaryMmfs, funds]);

  const hasSecondary = secondaryMmfs.length > 0;

  // Selection: "primary", "secondary-<id>", or "blended".
  const [selection, setSelection] = useState<string>("primary");
  const [horizon, setHorizon] = useState<string>("30");
  // Per-account principal override (keyed by account key). Empty = use account's own balance.
  const [principal, setPrincipal] = useState<string>("");

  const days = Math.max(1, Math.min(366, Number(horizon) || 30));
  const isBlended = selection === "blended";

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.key === selection) ?? accounts[0],
    [accounts, selection]
  );

  // Reset the principal override whenever the user changes which account is selected.
  // (Kept simple: clearing on change avoids stale per-account overrides.)
  const effectivePrincipal =
    !isBlended && principal !== ""
      ? Math.max(0, Number(principal) || 0)
      : (selectedAccount?.balance ?? 0);

  // Run the (untouched) per-fund accrual engine for each account in scope.
  const perAccountRows = useMemo(() => {
    const scope = isBlended ? accounts : selectedAccount ? [selectedAccount] : [];
    return scope.map((acc) => {
      const startBal =
        !isBlended && principal !== "" ? Math.max(0, Number(principal) || 0) : acc.balance;
      const rows = simulateAccrual(startBal, acc.ear, acc.dayCount, acc.whtRate, acc.crediting, days);
      const gross = rows.reduce((s, r) => s + r.grossInterest, 0);
      const wht = rows.reduce((s, r) => s + r.wht, 0);
      const net = rows.reduce((s, r) => s + r.netInterest, 0);
      const closing = rows.length ? rows[rows.length - 1].closingBalance : startBal;
      return { account: acc, startBal, rows, gross, wht, net, closing };
    });
  }, [isBlended, accounts, selectedAccount, principal, days]);

  // Blended daily rows = element-wise sum across accounts (same day index).
  const blendedRows = useMemo<DayRow[]>(() => {
    if (!isBlended) return perAccountRows[0]?.rows ?? [];
    const out: DayRow[] = [];
    for (let i = 0; i < days; i++) {
      let opening = 0, gross = 0, wht = 0, net = 0, closing = 0;
      for (const pa of perAccountRows) {
        const r = pa.rows[i];
        if (!r) continue;
        opening += r.openingBalance;
        gross += r.grossInterest;
        wht += r.wht;
        net += r.netInterest;
        closing += r.closingBalance;
      }
      out.push({ day: i + 1, openingBalance: opening, grossInterest: gross, wht, netInterest: net, closingBalance: closing });
    }
    return out;
  }, [isBlended, perAccountRows, days]);

  const rows = isBlended ? blendedRows : perAccountRows[0]?.rows ?? [];
  const totalGross = rows.reduce((s, r) => s + r.grossInterest, 0);
  const totalWht = rows.reduce((s, r) => s + r.wht, 0);
  const totalNet = rows.reduce((s, r) => s + r.netInterest, 0);
  const startingTotal = isBlended
    ? accounts.reduce((s, a) => s + a.balance, 0)
    : effectivePrincipal;
  const finalBalance = rows.length ? rows[rows.length - 1].closingBalance : startingTotal;

  // "If you withdrew today" — one full day across the active scope, using the
  // GEOMETRIC daily rate (consistent with the ledger table above).
  const oneDayGross = isBlended
    ? perAccountRows.reduce((s, pa) => s + pa.startBal * geometricDailyRate(pa.account.ear, pa.account.dayCount), 0)
    : oneDayInterest(effectivePrincipal, selectedAccount?.ear ?? 0, selectedAccount?.dayCount ?? 365, selectedAccount?.whtRate ?? 15).gross;
  const oneDayWht = isBlended
    ? perAccountRows.reduce((s, pa) => s + pa.startBal * geometricDailyRate(pa.account.ear, pa.account.dayCount) * (pa.account.whtRate / 100), 0)
    : oneDayGross * ((selectedAccount?.whtRate ?? 15) / 100);
  const oneDayNet = oneDayGross - oneDayWht;

  // Blended weighted-average net yield, for display.
  const blendedEar = useMemo(() => {
    const totalBal = accounts.reduce((s, a) => s + a.balance, 0);
    if (totalBal <= 0) return accounts.length ? accounts.reduce((s, a) => s + a.ear, 0) / accounts.length : 0;
    return accounts.reduce((s, a) => s + a.ear * a.balance, 0) / totalBal;
  }, [accounts]);

  const headerEar = isBlended ? blendedEar : selectedAccount?.ear ?? 0;
  const headerDayCount = isBlended ? null : selectedAccount?.dayCount ?? 365;
  const headerCrediting = isBlended ? null : selectedAccount?.crediting ?? "daily";
  const headerWht = isBlended ? null : selectedAccount?.whtRate ?? 15;

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>
              Daily MMF Accrual Ledger
            </h1>
          </div>
          <p className="text-muted-foreground text-sm max-w-3xl">
            Money market funds accrue interest <strong>every day</strong> and quote a net yield after
            the manager's fee. This ledger shows how interest builds day by day, how much withholding
            tax (WHT) is deducted, and what you would actually receive if you withdrew.
            {hasSecondary ? (
              <> You can view a single MMF account or a <strong>blended view</strong> across all the funds you track.</>
            ) : null}
          </p>
        </div>

        {/* Account selector */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="space-y-1.5 flex-1 min-w-0">
                <Label>MMF Account</Label>
                <Select value={selection} onValueChange={(v) => { setSelection(v); setPrincipal(""); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.key} value={a.key}>
                        {a.name}
                      </SelectItem>
                    ))}
                    {hasSecondary && (
                      <SelectItem value="blended">Blended — all MMF accounts</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {!fund.hasFund && (
                  <p className="text-xs text-amber-500">
                    No primary fund selected — using fallback rate. Pick one on MMF Funds.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">{isBlended ? "Accounts" : "Fund"}</p>
                <p className="font-semibold text-sm flex items-center gap-1">
                  {isBlended && <Layers className="w-3 h-3 text-primary" />}
                  {isBlended ? `${accounts.length} MMF account${accounts.length > 1 ? "s" : ""}` : selectedAccount?.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{isBlended ? "Weighted Net Yield" : "Net Yield (EAR)"}</p>
                <p className="font-semibold text-sm flex items-center gap-1">
                  <Percent className="w-3 h-3 text-primary" />
                  {headerEar.toFixed(2)}% p.a.
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Day-Count Basis</p>
                <p className="font-semibold text-sm">{headerDayCount ? `Actual / ${headerDayCount}` : "Per fund"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Crediting</p>
                <p className="font-semibold text-sm capitalize">{headerCrediting ?? "Per fund"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inputs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accrual Inputs</CardTitle>
            <CardDescription>
              {isBlended
                ? "Blended view uses each account's tracked balance and its own fund's yield/WHT. Adjust per-account balances on MMF Funds."
                : "Defaults to this account's tracked balance. Adjust to model any amount or horizon. All figures are deterministic — no forecasts."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="principal">Starting Balance (KES)</Label>
              <Input
                id="principal"
                type="number"
                inputMode="decimal"
                disabled={isBlended}
                placeholder={selectedAccount?.balance ? String(selectedAccount.balance) : "e.g. 100000"}
                value={isBlended ? String(startingTotal) : principal}
                onChange={(e) => setPrincipal(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {isBlended
                  ? `Sum of all tracked MMF balances: ${kes(startingTotal)}`
                  : principal === "" && (selectedAccount?.balance ?? 0) > 0
                    ? `Using this account's tracked balance: ${kes(selectedAccount?.balance ?? 0)}`
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
                {headerWht !== null ? `${headerWht.toFixed(2)}% (final tax on interest)` : "Per fund (see breakdown)"}
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

        {/* Per-account breakdown (blended only) */}
        {isBlended && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" /> Per-Account Contribution ({days}d)
              </CardTitle>
              <CardDescription>
                Each fund accrues on its own yield, day-count, and WHT rate. The blended totals above are the sum of these rows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Net Yield</TableHead>
                      <TableHead className="text-right">Starting Balance</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">WHT</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Closing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {perAccountRows.map((pa) => (
                      <TableRow key={pa.account.key}>
                        <TableCell className="font-medium">{pa.account.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{pa.account.ear.toFixed(2)}%</TableCell>
                        <TableCell className="text-right tabular-nums">{kes(pa.startBal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{kes(pa.gross)}</TableCell>
                        <TableCell className="text-right tabular-nums text-red-500">−{kes(pa.wht)}</TableCell>
                        <TableCell className="text-right tabular-nums text-primary">{kes(pa.net)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{kes(pa.closing)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Withdraw today readout */}
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" /> If you withdrew today
            </CardTitle>
            <CardDescription>
              One full day of accrual on {kes(startingTotal)}{isBlended ? " across all MMF accounts" : ""}.
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
                <span className="font-semibold text-red-500">−{kes(oneDayWht, 4)}</span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2">
                <span className="text-muted-foreground">Net / day</span>
                <span className="font-semibold text-primary">{kes(oneDayNet, 4)}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Most Kenyan MMFs allow withdrawal within 1–3 business days and you keep all net interest
              accrued up to the withdrawal date. There is no penalty for withdrawing — unlike a fixed deposit.
            </p>
          </CardContent>
        </Card>

        {/* Daily breakdown table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Day-by-Day Breakdown{isBlended ? " (blended)" : ""}</CardTitle>
            <CardDescription>
              {isBlended
                ? "Each day shows the combined opening, gross, WHT, net, and closing across all MMF accounts."
                : (headerCrediting === "daily"
                  ? "Net interest is added to the balance each day, so tomorrow's interest is calculated on a slightly larger balance (daily compounding)."
                  : "Interest accrues daily on the period's opening balance and is credited (compounded) every 30 days.")}
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
                      <TableCell className="text-right tabular-nums">{kes(r.openingBalance)}</TableCell>
                      <TableCell className="text-right tabular-nums">{kes(r.grossInterest, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums text-red-500">−{kes(r.wht, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums text-primary">{kes(r.netInterest, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{kes(r.closingBalance)}</TableCell>
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
              <strong className="text-foreground">withholding tax</strong> (commonly 15%), which the
              fund manager deducts at source before crediting your account. For most individuals this
              is a <strong className="text-foreground">final tax</strong> — you do not pay any further
              income tax on it and it does not need to be declared as additional taxable income.
            </p>
            <p>
              The yield (EAR) quoted by the fund is typically the{" "}
              <strong className="text-foreground">net-of-fee</strong> figure but{" "}
              <strong className="text-foreground">before</strong> withholding tax. That is why the
              "Net Interest" you actually keep in the table above is lower than a naive balance × yield
              calculation.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="secondary">15% WHT — final tax on interest</Badge>
              <Badge variant="secondary">No early-withdrawal penalty</Badge>
              <Badge variant="secondary">Daily accrual</Badge>
            </div>
            <p className="text-xs pt-2">
              Source: PwC Worldwide Tax Summaries (Kenya), withholding tax on "interest — other" = 15%.
              Rates are user-editable; confirm current rules with KRA or a tax adviser. This tool is for
              tracking and education, not tax advice.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
