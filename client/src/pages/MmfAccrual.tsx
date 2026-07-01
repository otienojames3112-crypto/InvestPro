import { useMemo, useState } from "react";
import { useSimulatedNow } from "@/hooks/useSimulatedNow";
import { SimulatedDateChip } from "@/components/SimulatedDateChip";
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
import {
  buildSecurityIncome,
  buildBankIncome,
  buildSecurityDailySchedule,
  buildBankDailySchedule,
  type SecurityIncomeInput,
  type BankIncomeInput,
  type IncomeSummary,
  type DailyAccrualSchedule,
} from "@shared/incomeBreakdown";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Landmark, Building2 } from "lucide-react";

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

export default function MmfAccrual({ embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId } = usePortfolio();
  const fund = useSelectedFund();

  // Time Machine parity: when a simulated clock is active, the Daily Accrual
  // breakdowns must reckon "today" from the simulated date so matured paper
  // drops out and live rows read in the correct tense.
  const { now: simulatedNow } = useSimulatedNow();
  const effectiveNow = simulatedNow();

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

  // Round 34: asset-class tab — MMF (existing behaviour) / Govt securities / Bank instruments.
  const [assetClass, setAssetClass] = useState<"mmf" | "securities" | "bank">("mmf");

  // Data for the non-MMF breakdowns.
  const { data: securitiesData = [] } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId },
  );
  const { data: bankHoldingsData = [] } = trpc.bankHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId },
  );

  const securityIncome: IncomeSummary = useMemo(
    () =>
      buildSecurityIncome(
        (securitiesData as unknown[]).map((s) => {
          const r = s as Record<string, unknown>;
          return {
            id: Number(r.id),
            securityType: String(r.securityType) as SecurityIncomeInput["securityType"],
            faceValue: Number(r.faceValue) || 0,
            couponRate: Number(r.couponRate) || 0,
            isTaxExempt: !!r.isTaxExempt,
            maturityDate: (r.maturityDate as string | null) ?? null,
            isMatured: !!r.isMatured,
            issueDate: (r.issueDate as string | null) ?? null,
            purchasePrice: r.purchasePrice != null ? Number(r.purchasePrice) : null,
            tenorYears: r.tenorYears != null ? Number(r.tenorYears) : null,
            whtRateOverride: r.whtRate != null ? Number(r.whtRate) : null,
          } satisfies SecurityIncomeInput;
        }),
        days,
        effectiveNow,
      ),
    [securitiesData, days, effectiveNow],
  );

  const bankIncome: IncomeSummary = useMemo(
    () =>
      buildBankIncome(
        (bankHoldingsData as unknown[]).map((b) => {
          const r = b as Record<string, unknown>;
          return {
            id: Number(r.id),
            bankName: String(r.bankName ?? ""),
            label: (r.label as string | null) ?? null,
            instrumentType: String(r.instrumentType) as BankIncomeInput["instrumentType"],
            principal: Number(r.principal) || 0,
            interestRate: Number(r.interestRate) || 0,
            whtRate: Number(r.whtRate) || 15,
            dayCountBasis: Number(r.dayCountBasis) || 365,
            maturityDate: (r.maturityDate as string | null) ?? null,
            isActive: r.isActive !== false,
          } satisfies BankIncomeInput;
        }),
        days,
        effectiveNow,
      ),
    [bankHoldingsData, days, effectiveNow],
  );

  const securityDaily = useMemo(
    () =>
      buildSecurityDailySchedule(
        (securitiesData as unknown[]).map((s) => {
          const r = s as Record<string, unknown>;
          return {
            id: Number(r.id),
            securityType: String(r.securityType) as SecurityIncomeInput["securityType"],
            faceValue: Number(r.faceValue) || 0,
            couponRate: Number(r.couponRate) || 0,
            isTaxExempt: !!r.isTaxExempt,
            maturityDate: (r.maturityDate as string | null) ?? null,
            isMatured: !!r.isMatured,
            issueDate: (r.issueDate as string | null) ?? null,
            purchasePrice: r.purchasePrice != null ? Number(r.purchasePrice) : null,
            tenorYears: r.tenorYears != null ? Number(r.tenorYears) : null,
            whtRateOverride: r.whtRate != null ? Number(r.whtRate) : null,
          } satisfies SecurityIncomeInput;
        }),
        days,
        effectiveNow,
      ),
    [securitiesData, days, effectiveNow],
  );

  const bankDaily = useMemo(
    () =>
      buildBankDailySchedule(
        (bankHoldingsData as unknown[]).map((b) => {
          const r = b as Record<string, unknown>;
          return {
            id: Number(r.id),
            bankName: String(r.bankName ?? ""),
            label: (r.label as string | null) ?? null,
            instrumentType: String(r.instrumentType) as BankIncomeInput["instrumentType"],
            principal: Number(r.principal) || 0,
            interestRate: Number(r.interestRate) || 0,
            whtRate: Number(r.whtRate) || 15,
            dayCountBasis: Number(r.dayCountBasis) || 365,
            maturityDate: (r.maturityDate as string | null) ?? null,
            isActive: r.isActive !== false,
          } satisfies BankIncomeInput;
        }),
        days,
        effectiveNow,
      ),
    [bankHoldingsData, days, effectiveNow],
  );

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
    <AppShell embedded={embedded}>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>
              Daily Income & Accrual Ledger
            </h1>
            <SimulatedDateChip className="ml-1" />
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

        {/* Round 34: asset-class selector */}
        <Tabs value={assetClass} onValueChange={(v) => setAssetClass(v as "mmf" | "securities" | "bank")}>
          <TabsList>
            <TabsTrigger value="mmf" className="gap-1.5"><Coins className="w-3.5 h-3.5" /> MMF</TabsTrigger>
            <TabsTrigger value="securities" className="gap-1.5"><Landmark className="w-3.5 h-3.5" /> Govt securities</TabsTrigger>
            <TabsTrigger value="bank" className="gap-1.5"><Building2 className="w-3.5 h-3.5" /> Bank instruments</TabsTrigger>
          </TabsList>
        </Tabs>

        {assetClass === "mmf" && (
        <>
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
        </>
        )}

        {assetClass === "securities" && (
          <IncomeBreakdownSection
            title="Government Securities — interest breakdown"
            blurb="T-Bills earn a discount and Treasury bonds (FXD) pay a coupon, both taxed at 15% WHT. Infrastructure Bonds (IFB) are tax-exempt in Kenya. Figures are simple pro-rata of the annual gross over the chosen horizon (coupons/discounts do not compound intra-period like an MMF)."
            summary={securityIncome}
            schedule={securityDaily}
            days={days}
            emptyHint="No live government securities in this portfolio. Add T-Bills, IFB, or FXD on the CBK Securities page."
            baseLabel="Face value"
            scheduleNote="Government paper accretes on a STRAIGHT LINE — each day earns an identical slice (no intra-period compounding). T-bill discount accretes to par; coupons accrue evenly."
            horizon={horizon}
            setHorizon={setHorizon}
          />
        )}

        {assetClass === "bank" && (
          <IncomeBreakdownSection
            title="Bank Instruments — interest breakdown"
            blurb="Fixed, call, and savings deposits earn simple interest at their quoted rate, taxed at each holding's WHT rate (usually 15%). Figures are pro-rata of the annual gross over the chosen horizon on a 365-day-equivalent basis."
            summary={bankIncome}
            schedule={bankDaily}
            days={days}
            emptyHint="No active bank instruments in this portfolio. Add fixed/call/target deposits on the Record Deposits → Bank page."
            baseLabel="Principal"
            scheduleNote="Bank deposits pay SIMPLE daily interest on a constant principal (no intra-period compounding in this tracker)."
            horizon={horizon}
            setHorizon={setHorizon}
            groupByBank
            groupLabel="Per-bank"
          />
        )}
      </div>
    </AppShell>
  );
}

/** Round 34: shared breakdown UI for non-MMF income (Govt securities / Bank instruments). */
function IncomeBreakdownSection({
  title,
  blurb,
  summary,
  schedule,
  days,
  emptyHint,
  baseLabel,
  scheduleNote,
  horizon,
  setHorizon,
  groupByBank = false,
  groupLabel = "Per-bank",
}: {
  title: string;
  blurb: string;
  summary: IncomeSummary;
  schedule: DailyAccrualSchedule;
  days: number;
  emptyHint: string;
  baseLabel: string;
  scheduleNote: string;
  horizon: string;
  setHorizon: (v: string) => void;
  groupByBank?: boolean;
  groupLabel?: string;
}) {
  const empty = summary.rows.length === 0;

  // R41.5: group holdings by their issuer/bank for a per-bank subtotal table.
  const groups = (() => {
    if (!groupByBank) return [] as { name: string; gross: number; wht: number; net: number; grossAnnual: number; count: number }[];
    const map = new Map<string, { name: string; gross: number; wht: number; net: number; grossAnnual: number; count: number }>();
    for (const r of summary.rows) {
      // The row label is the bank name (or custom label); group on the kind-agnostic issuer.
      const key = r.label;
      const g = map.get(key) ?? { name: key, gross: 0, wht: 0, net: 0, grossAnnual: 0, count: 0 };
      g.gross += r.grossHorizon;
      g.wht += r.whtHorizon;
      g.net += r.netHorizon;
      g.grossAnnual += r.grossAnnual;
      g.count += 1;
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => b.net - a.net);
  })();

  const HORIZONS: { value: string; label: string }[] = [
    { value: "7", label: "7 days" },
    { value: "30", label: "30 days" },
    { value: "90", label: "90 days" },
    { value: "180", label: "180 days" },
    { value: "365", label: "365 days" },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
          <CardDescription>{blurb}</CardDescription>
        </CardHeader>
      </Card>

      {/* R41.5: Accrual Inputs — horizon selector mirroring the MMF tab so the
          7/30/90/180/365-day interest breakdown is available here too. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accrual Inputs</CardTitle>
          <CardDescription>
            Choose a projection horizon to see interest accrued over 7, 30, 90, 180 or 365 days. Figures use each holding&rsquo;s own {baseLabel.toLowerCase()}, rate and WHT &mdash; deterministic, no forecasts.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="breakdown-horizon">Days to Project</Label>
            <Select value={horizon} onValueChange={setHorizon}>
              <SelectTrigger id="breakdown-horizon">
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
            <Label>Quick pick</Label>
            <div className="flex flex-wrap gap-1.5">
              {HORIZONS.map((h) => (
                <button
                  key={h.value}
                  type="button"
                  onClick={() => setHorizon(h.value)}
                  className={`px-2.5 py-1 rounded-md text-xs border transition-colors ${horizon === h.value ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input hover:bg-muted"}`}
                >
                  {h.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {empty ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{emptyHint}</CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card><CardContent className="py-4"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Coins className="w-3.5 h-3.5" /> Gross ({days}d)</div><p className="text-xl font-bold">{kes(summary.grossHorizon)}</p></CardContent></Card>
            <Card><CardContent className="py-4"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Receipt className="w-3.5 h-3.5" /> WHT</div><p className="text-xl font-bold text-red-500">−{kes(summary.whtHorizon)}</p></CardContent></Card>
            <Card><CardContent className="py-4"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><TrendingUp className="w-3.5 h-3.5" /> Net ({days}d)</div><p className="text-xl font-bold text-primary">{kes(summary.netHorizon)}</p></CardContent></Card>
            <Card><CardContent className="py-4"><div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Percent className="w-3.5 h-3.5" /> Net / yr</div><p className="text-xl font-bold">{kes(summary.netAnnual)}</p></CardContent></Card>
          </div>

          {groupByBank && groups.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{groupLabel} subtotal ({days}-day horizon)</CardTitle>
                <CardDescription>Interest grouped by bank across all that bank&rsquo;s instruments over the chosen horizon.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Bank</TableHead>
                        <TableHead className="text-right">Instruments</TableHead>
                        <TableHead className="text-right">Gross ({days}d)</TableHead>
                        <TableHead className="text-right">WHT</TableHead>
                        <TableHead className="text-right">Net ({days}d)</TableHead>
                        <TableHead className="text-right">Gross / yr</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {groups.map((g) => (
                        <TableRow key={g.name}>
                          <TableCell className="font-medium">{g.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{g.count}</TableCell>
                          <TableCell className="text-right tabular-nums">{kes(g.gross)}</TableCell>
                          <TableCell className="text-right tabular-nums text-red-500">{g.wht > 0 ? `−${kes(g.wht)}` : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-primary">{kes(g.net)}</TableCell>
                          <TableCell className="text-right tabular-nums">{kes(g.grossAnnual)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-holding interest ({days}-day horizon)</CardTitle>
              <CardDescription>Each row earns on its own {baseLabel.toLowerCase()} and rate. Totals above are the sum of these rows.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Holding</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead className="text-right">{baseLabel}</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Gross ({days}d)</TableHead>
                      <TableHead className="text-right">WHT</TableHead>
                      <TableHead className="text-right">Net ({days}d)</TableHead>
                      <TableHead className="text-right">Gross / yr</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.label}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span>{r.kind}</span>
                            {r.taxExempt && <Badge variant="secondary">Tax-exempt</Badge>}
                            {r.statusLabel && (
                              <Badge
                                variant="outline"
                                className={
                                  r.status === "matured"
                                    ? "border-muted-foreground/30 text-muted-foreground"
                                    : r.status === "maturing"
                                      ? "border-amber-500/40 bg-amber-500/10 text-amber-600"
                                      : "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                                }
                                title={
                                  r.status === "matured"
                                    ? "This holding has matured as of the current (simulated) date — its principal has settled and returned to cash."
                                    : r.status === "maturing"
                                      ? "This holding matures on the current (simulated) date."
                                      : "This holding is still live and accruing toward a future maturity."
                                }
                              >
                                {r.statusLabel}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{kes(r.base)}</TableCell>
                        <TableCell className="text-right tabular-nums">{r.ratePct.toFixed(2)}%</TableCell>
                        <TableCell className="text-right tabular-nums">{kes(r.grossHorizon)}</TableCell>
                        <TableCell className="text-right tabular-nums text-red-500">{r.whtHorizon > 0 ? `−${kes(r.whtHorizon)}` : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-primary">{kes(r.netHorizon)}</TableCell>
                        <TableCell className="text-right tabular-nums">{kes(r.grossAnnual)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Round 39: true day-by-day accrual schedule (correct method per instrument) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Day-by-Day Breakdown ({days}-day horizon)</CardTitle>
              <CardDescription>{scheduleNote}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto max-h-[480px] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-card z-10">
                    <TableRow>
                      <TableHead>Day</TableHead>
                      <TableHead className="text-right">Opening accrued</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">WHT</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Closing accrued</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedule.rows.map((d) => (
                      <TableRow key={d.day}>
                        <TableCell className="tabular-nums">{d.day}</TableCell>
                        <TableCell className="text-right tabular-nums">{kes(d.openingAccrued)}</TableCell>
                        <TableCell className="text-right tabular-nums">{kes(d.grossDay)}</TableCell>
                        <TableCell className="text-right tabular-nums text-red-500">{d.whtDay > 0 ? `−${kes(d.whtDay)}` : "—"}</TableCell>
                        <TableCell className="text-right tabular-nums text-primary">{kes(d.netDay)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{kes(d.closingAccrued)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
