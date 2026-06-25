import { useMemo, useState } from "react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { trpc } from "@/lib/trpc";
import { formatKES } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { isSecurityImmatureOn } from "@shared/securityTenor";
import {
  ArrowUpCircle,
  Wallet,
  PiggyBank,
  Building2,
  TrendingUp,
  ShieldCheck,
  Landmark,
  Trash2,
  AlertTriangle,
  Info,
  PlusCircle,
} from "lucide-react";

/** A concrete place real money can be withdrawn FROM. */
type Source = {
  value: string;
  label: string;
  sublabel?: string;
  group: "MMF funds" | "Bank instruments" | "Government securities";
  icon: React.ReactNode;
  color: string;
  available: number;
  isFixedDeposit?: boolean;
  maturityDate?: string | null;
  payload: {
    sourceType: "mmf_fund" | "bank_instrument" | "government_security";
    mmfFundId?: number;
    bankHoldingId?: number;
    securityId?: number;
  };
};

const GOV_META = {
  tbill: { label: "CBK T-Bills", icon: <TrendingUp className="w-4 h-4" />, color: "text-blue-400" },
  ifb: { label: "IFB Bonds", icon: <ShieldCheck className="w-4 h-4" />, color: "text-violet-400" },
  fxd: { label: "FXD Bonds", icon: <Landmark className="w-4 h-4" />, color: "text-orange-400" },
} as const;

export default function Withdrawals() {
  const { portfolioId, portfolio } = usePortfolio();
  const { fundName, fundEar } = useSelectedFund();
  const utils = trpc.useUtils();

  const { data: summary } = trpc.deposits.summary.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: withdrawals = [], isLoading } = trpc.withdrawals.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: secondaries = [] } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: bankHoldings = [] } = trpc.bankHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: securities = [] } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  const invalidateAll = () => {
    utils.withdrawals.list.invalidate();
    utils.deposits.summary.invalidate();
    utils.deposits.list.invalidate();
    utils.secondaryMmfs.list.invalidate();
    utils.bankHoldings.list.invalidate();
    utils.securities.list.invalidate();
    utils.projection.run.invalidate();
    utils.projection.reconciliation.invalidate();
  };

  const addMutation = trpc.withdrawals.add.useMutation({
    onSuccess: (res) => {
      invalidateAll();
      if (res.isEarlyWithdrawal && res.forfeitedInterest > 0) {
        toast.warning(
          `Early fixed-deposit break — forfeited ${formatKES(res.forfeitedInterest)} of accrued interest.`,
          { duration: 6000 }
        );
      } else {
        toast.success("Withdrawal recorded");
      }
      setFormOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.withdrawals.delete.useMutation({
    onSuccess: () => {
      invalidateAll();
      toast.success("Withdrawal removed");
      setDeleteId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  // Available balances by source from the live actuals summary.
  const primaryAvail = summary?.depositsContributed ?? 0;
  const bankAvail = summary?.bankBalance ?? 0;
  const byBucket = summary?.byBucket ?? { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };
  const govAvail = (byBucket.tbill ?? 0) + (byBucket.ifb ?? 0) + (byBucket.fxd ?? 0);

  const sources = useMemo<Source[]>(() => {
    const list: Source[] = [];
    const primaryFundId = portfolio?.mmfFundId ?? undefined;

    if (primaryFundId && primaryAvail > 0) {
      list.push({
        value: `mmf:${primaryFundId}`,
        label: fundName,
        sublabel: `Primary fund · ${fundEar.toFixed(2)}% p.a.`,
        group: "MMF funds",
        icon: <Wallet className="w-4 h-4" />,
        color: "text-emerald-400",
        available: primaryAvail,
        payload: { sourceType: "mmf_fund", mmfFundId: primaryFundId },
      });
    }
    for (const s of secondaries) {
      const avail = s.currentBalance ?? 0;
      if (avail <= 0) continue;
      list.push({
        value: `smmf:${s.id}`,
        label: s.label || s.fundName,
        sublabel: `${s.company} · ${s.ear.toFixed(2)}% p.a.`,
        group: "MMF funds",
        icon: <PiggyBank className="w-4 h-4" />,
        color: "text-emerald-300",
        available: avail,
        payload: { sourceType: "mmf_fund", mmfFundId: s.mmfFundId },
      });
    }
    for (const h of bankHoldings) {
      const avail = h.principal ?? 0;
      if (avail <= 0) continue;
      const isFd = h.instrumentType === "fixed_deposit";
      list.push({
        value: `bank:${h.id}`,
        label: h.label || `${h.bankName} ${isFd ? "Fixed Deposit" : "Call Deposit"}`,
        sublabel: `${h.bankName} · ${h.interestRate.toFixed(2)}% p.a.${isFd && h.maturityDate ? ` · matures ${new Date(h.maturityDate).toLocaleDateString()}` : ""}`,
        group: "Bank instruments",
        icon: <Building2 className="w-4 h-4" />,
        color: "text-sky-300",
        available: avail,
        isFixedDeposit: isFd,
        maturityDate: h.maturityDate,
        payload: { sourceType: "bank_instrument", bankHoldingId: h.id },
      });
    }
    for (const sec of securities) {
      if (sec.isMatured) continue;
      const face = parseFloat(String(sec.faceValue)) || 0;
      const meta = sec.securityType.startsWith("tbill") ? GOV_META.tbill : sec.securityType === "ifb" ? GOV_META.ifb : GOV_META.fxd;
      list.push({
        value: `gov:${sec.id}`,
        label: `${meta.label} · ${formatKES(face)}`,
        sublabel: `Matures ${new Date(sec.maturityDate).toLocaleDateString()}`,
        group: "Government securities",
        icon: meta.icon,
        color: meta.color,
        available: face,
        maturityDate: String(sec.maturityDate),
        payload: { sourceType: "government_security", securityId: sec.id },
      });
    }
    return list;
  }, [portfolio?.mmfFundId, fundName, fundEar, primaryAvail, secondaries, bankHoldings, securities]);

  const [formOpen, setFormOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({
    source: "",
    amount: "",
    withdrawalDate: new Date().toISOString().slice(0, 10),
    reason: "",
  });

  const selectedSource = sources.find((s) => s.value === form.source);
  const amountNum = parseFloat(form.amount) || 0;
  const overdraw = selectedSource ? amountNum > selectedSource.available + 0.005 : false;
  const earlyBreakWarning =
    selectedSource?.isFixedDeposit &&
    selectedSource.maturityDate &&
    new Date(form.withdrawalDate) < new Date(selectedSource.maturityDate);
  // R40.5: government securities cannot be redeemed early at par — only sold on
  // the secondary market. Warn (and require an explicit acknowledgement) when an
  // immature gov security is the chosen source.
  const isGovSource = selectedSource?.payload.sourceType === "government_security";
  const govImmature = isGovSource
    ? isSecurityImmatureOn(selectedSource?.maturityDate ?? null, form.withdrawalDate)
    : { isImmature: false, daysToMaturity: 0 };
  const immatureGovWarning = isGovSource && govImmature.isImmature;

  const [acknowledgedSecondary, setAcknowledgedSecondary] = useState(false);

  function resetForm() {
    setForm({ source: "", amount: "", withdrawalDate: new Date().toISOString().slice(0, 10), reason: "" });
    setAcknowledgedSecondary(false);
  }

  function handleSubmit() {
    if (!portfolioId) return;
    if (!selectedSource) { toast.error("Choose where the money came from"); return; }
    if (!amountNum || amountNum <= 0) { toast.error("Enter a valid amount"); return; }
    if (overdraw) { toast.error("Amount exceeds the available balance in this source"); return; }
    if (immatureGovWarning && !acknowledgedSecondary) {
      toast.error("This government security has not matured. Confirm you understand it must be sold on the secondary market.");
      return;
    }
    addMutation.mutate({
      portfolioId,
      amount: amountNum,
      withdrawalDate: form.withdrawalDate,
      reason: form.reason || undefined,
      ...selectedSource.payload,
    });
  }

  function sourceLabelFor(w: { sourceType: string; mmfFundId?: number | null; bankHoldingId?: number | null; securityId?: number | null }) {
    if (w.sourceType === "bank_instrument") {
      const h = bankHoldings.find((x) => x.id === w.bankHoldingId);
      return { label: h ? (h.label || `${h.bankName} deposit`) : "Bank deposit", icon: <Building2 className="w-4 h-4" />, color: "text-sky-300" };
    }
    if (w.sourceType === "government_security") {
      return { label: "CBK security", icon: <Landmark className="w-4 h-4" />, color: "text-blue-400" };
    }
    if (w.mmfFundId && portfolio?.mmfFundId !== w.mmfFundId) {
      const s = secondaries.find((x) => x.mmfFundId === w.mmfFundId);
      return { label: s ? (s.label || s.fundName) : "Secondary MMF", icon: <PiggyBank className="w-4 h-4" />, color: "text-emerald-300" };
    }
    return { label: fundName, icon: <Wallet className="w-4 h-4" />, color: "text-emerald-400" };
  }

  const totalWithdrawn = summary?.totalWithdrawn ?? 0;
  const netWorth = summary?.totalContributed ?? 0;

  return (
    <div className="container max-w-5xl py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
          Withdrawals
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Record real money taken OUT of any account. Withdrawals reduce your tracked net worth, feed the projection's
          "today" value, and reconcile across every report. Breaking a fixed deposit early forfeits its accrued interest.
        </p>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 bg-card border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Net Worth Now</p>
          <p className="text-xl font-bold text-foreground kes-amount">{formatKES(netWorth)}</p>
        </Card>
        <Card className="p-4 bg-card border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Total Withdrawn</p>
          <p className="text-xl font-bold text-foreground kes-amount">{formatKES(totalWithdrawn)}</p>
        </Card>
        <Card className="p-4 bg-card border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Liquid (MMF)</p>
          <p className="text-xl font-bold text-emerald-400 kes-amount">{formatKES(primaryAvail + (summary?.secondaryMmfBalance ?? 0))}</p>
        </Card>
        <Card className="p-4 bg-card border-border">
          <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">In Bank + CBK</p>
          <p className="text-xl font-bold text-sky-300 kes-amount">{formatKES(bankAvail + govAvail)}</p>
        </Card>
      </div>

      {/* Record form */}
      {!formOpen ? (
        <Button onClick={() => setFormOpen(true)} className="gap-2">
          <PlusCircle className="w-4 h-4" />
          Record a Withdrawal
        </Button>
      ) : (
        <Card className="p-5 bg-card border-border space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowUpCircle className="w-4 h-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">New Withdrawal</p>
            </div>
            <button onClick={() => { setFormOpen(false); resetForm(); }} className="text-xs text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Where did the money come from?</Label>
            <Select value={form.source} onValueChange={(v) => setForm((f) => ({ ...f, source: v }))}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Choose an account or instrument" />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {(["MMF funds", "Bank instruments", "Government securities"] as const).map((group) => {
                  const items = sources.filter((s) => s.group === group);
                  if (items.length === 0) return null;
                  return (
                    <SelectGroup key={group}>
                      <SelectLabel className="text-xs text-muted-foreground">{group}</SelectLabel>
                      {items.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          <span className="flex items-center gap-2">
                            <span className={s.color}>{s.icon}</span>
                            <span>{s.label}</span>
                            <span className="text-xs text-muted-foreground">· {formatKES(s.available)} available</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  );
                })}
              </SelectContent>
            </Select>
            {sources.length === 0 && (
              <p className="text-xs text-muted-foreground">No funded accounts yet — record a deposit first.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Amount (KES)</Label>
              <Input
                type="number"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0"
                className="h-9 text-sm"
              />
              {selectedSource && (
                <p className={`text-xs ${overdraw ? "text-red-400" : "text-muted-foreground"}`}>
                  {formatKES(selectedSource.available)} available
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Date</Label>
              <Input
                type="date"
                value={form.withdrawalDate}
                onChange={(e) => setForm((f) => ({ ...f, withdrawalDate: e.target.value }))}
                className="h-9 text-sm"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
            <Textarea
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="e.g. Paid car deposit, emergency expense…"
              className="text-sm min-h-[60px]"
            />
          </div>

          {earlyBreakWarning && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-200">
                This fixed deposit has not matured. Breaking it early typically <strong>forfeits all accrued interest</strong> on
                the withdrawn amount. The exact forfeiture will be computed and recorded.
              </p>
            </div>
          )}

          {immatureGovWarning && (
            <div className="rounded-lg bg-orange-500/10 border border-orange-500/40 p-3 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5 shrink-0" />
                <p className="text-xs text-orange-200">
                  This government security has <strong>not matured</strong> ({govImmature.daysToMaturity} day
                  {govImmature.daysToMaturity === 1 ? "" : "s"} to maturity). Unlike a bank fixed deposit, CBK bonds and
                  T-bills <strong>cannot be redeemed early at face value</strong>. To exit before maturity you must
                  <strong> sell it on the secondary market (a rediscount)</strong>, where the price is set by prevailing
                  market yields and may be above or below face value. Record this withdrawal only if you have actually
                  executed (or will execute) a secondary-market sale.
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-orange-200 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={acknowledgedSecondary}
                  onChange={(e) => setAcknowledgedSecondary(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-orange-400/50 bg-transparent"
                />
                I understand this is a secondary-market sale, not an early redemption at par.
              </label>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={handleSubmit} disabled={addMutation.isPending || overdraw || !selectedSource || (immatureGovWarning && !acknowledgedSecondary)} className="flex-1">
              {addMutation.isPending ? "Recording…" : "Record Withdrawal"}
            </Button>
          </div>
        </Card>
      )}

      <Separator />

      {/* History */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Info className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">History ({withdrawals.length})</h2>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : withdrawals.length === 0 ? (
          <Card className="p-8 bg-card border-border text-center">
            <ArrowUpCircle className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">No withdrawals recorded yet.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {withdrawals.map((w) => {
              const meta = sourceLabelFor(w);
              const amt = parseFloat(String(w.amount)) || 0;
              const forfeit = parseFloat(String(w.forfeitedInterest)) || 0;
              return (
                <Card key={w.id} className="p-4 bg-card border-border flex items-center gap-3">
                  <span className={meta.color}>{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-foreground kes-amount">−{formatKES(amt)}</p>
                      {w.isEarlyWithdrawal && (
                        <Badge variant="outline" className="text-amber-400 border-amber-500/40 text-xs">
                          Early FD break
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {meta.label} · {new Date(w.withdrawalDate).toLocaleDateString()}
                      {w.reason ? ` · ${w.reason}` : ""}
                      {forfeit > 0 ? ` · forfeited ${formatKES(forfeit)}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => setDeleteId(w.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    aria-label="Delete withdrawal"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this withdrawal?</AlertDialogTitle>
            <AlertDialogDescription>
              This will restore the withdrawn amount back to your tracked balances. Note: it does not automatically reverse a
              real-world fixed-deposit break — it only corrects your tracking record.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && portfolioId && deleteMutation.mutate({ portfolioId, id: deleteId })}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
