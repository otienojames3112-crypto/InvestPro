import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { useDepositDrawer } from "@/contexts/DepositDrawerContext";
import { useMemo, useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { invalidatePortfolioMoney } from "@/lib/invalidatePortfolioMoney";
import { formatKES } from "@/lib/format";
import { earlyBreakWhatIf } from "@shared/actuals";
import { BANK_INSTRUMENT_TYPES, isTermBankInstrument, bankInstrumentLabel, type BankInstrumentType } from "@shared/const";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  PlusCircle,
  Trash2,
  Wallet,
  TrendingUp,
  ShieldCheck,
  Landmark,
  Info,
  ArrowDownCircle,
  Building2,
  PiggyBank,
  Pencil,
  Zap,
  AlertTriangle,
} from "lucide-react";

type Bucket = "mmf" | "tbill" | "ifb" | "fxd";

const GOV_META = {
  tbill: { label: "CBK T-Bills", color: "text-[#60a5fa]", icon: <TrendingUp className="w-4 h-4" /> },
  ifb: { label: "IFB Bonds", color: "text-[#a78bfa]", icon: <ShieldCheck className="w-4 h-4" /> },
  fxd: { label: "FXD Bonds", color: "text-[#fb923c]", icon: <Landmark className="w-4 h-4" /> },
} as const;

const EMPTY_BANK = {
  id: null as number | null,
  bankName: "",
  label: "",
  instrumentType: "call_deposit" as BankInstrumentType,
  principal: "",
  interestRate: "",
  rateAsOfDate: new Date().toISOString().slice(0, 10),
  isNegotiable: true,
  tenorMonths: "",
  maturityDate: "",
  earlyBreakPenaltyPct: "",
  maturityAction: "redeploy" as "redeploy" | "rollover",
  notes: "",
};

export default function Deposits({ embedded: _embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId, portfolio } = usePortfolio();
  const { fundName, fundLabel } = useSelectedFund();
  const { openDrawer } = useDepositDrawer();
  const utils = trpc.useUtils();

  const { data: deposits = [], isLoading } = trpc.deposits.list.useQuery({ portfolioId: portfolioId! }, { enabled: !!portfolioId });
  const { data: summary } = trpc.deposits.summary.useQuery({ portfolioId: portfolioId! }, { enabled: !!portfolioId });
  const { data: secondaries = [] } = trpc.secondaryMmfs.list.useQuery({ portfolioId: portfolioId! }, { enabled: !!portfolioId });
  const { data: bankHoldings = [] } = trpc.bankHoldings.list.useQuery({ portfolioId: portfolioId! }, { enabled: !!portfolioId });

  // Issuer drill-down: arriving with ?issuer=<bank> (from the Dashboard
  // concentration warning) highlights and scrolls to that issuer's holdings.
  const [issuerFilter, setIssuerFilter] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("issuer");
  });
  const bankSectionRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (issuerFilter && bankHoldings.length > 0 && bankSectionRef.current) {
      bankSectionRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [issuerFilter, bankHoldings.length]);
  const issuerMatches = (name: string) =>
    !!issuerFilter && name.trim().toLowerCase() === issuerFilter.trim().toLowerCase();

  const liveTarget = portfolio?.targetAmount ?? 0;

  const deleteMutation = trpc.deposits.delete.useMutation({
    onSuccess: () => {
      invalidatePortfolioMoney(utils, portfolioId);
      toast.success("Deposit removed");
      setDeleteId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const addBank = trpc.bankHoldings.add.useMutation({
    onSuccess: () => {
      invalidatePortfolioMoney(utils, portfolioId);
      toast.success("Bank instrument saved");
      setBankDialogOpen(false);
      setBankForm(EMPTY_BANK);
    },
    onError: (err) => toast.error(err.message),
  });
  const updateBank = trpc.bankHoldings.update.useMutation({
    onSuccess: () => {
      invalidatePortfolioMoney(utils, portfolioId);
      toast.success("Bank instrument updated");
      setBankDialogOpen(false);
      setBankForm(EMPTY_BANK);
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteBank = trpc.bankHoldings.remove.useMutation({
    onSuccess: () => {
      invalidatePortfolioMoney(utils, portfolioId);
      toast.success("Bank instrument removed");
      setDeleteBankId(null);
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [bankForm, setBankForm] = useState(EMPTY_BANK);
  const [deleteBankId, setDeleteBankId] = useState<number | null>(null);

  // ─── Per-deposit "Break now" (Round 33) ─────────────────────────────────
  // Realize a term deposit's early-break what-if as an ACTUAL withdrawal: the
  // full accrued value (principal + retained interest) is withdrawn today, the
  // forfeited-interest penalty is recorded, and the emptied holding is closed.
  const [breakHolding, setBreakHolding] = useState<
    | {
        id: number;
        label: string;
        principal: number;
        netNow: number;
        penalty: number;
        accrued: number;
      }
    | null
  >(null);
  // Round 34: amount to break (defaults to full principal; user can break part).
  const [breakAmount, setBreakAmount] = useState<string>("");

  // Prorated figures for the currently-entered break amount. The row's what-if
  // (accrued/penalty) is computed for the FULL principal; the broken portion's
  // figures scale linearly with the fraction broken, matching the server, which
  // forfeits interest only on `amount`.
  const breakCalc = useMemo(() => {
    if (!breakHolding) return null;
    const principal = breakHolding.principal;
    const amt = Math.min(Math.max(parseFloat(breakAmount) || 0, 0), principal);
    const frac = principal > 0 ? amt / principal : 0;
    const accruedOnPortion = Math.round(breakHolding.accrued * frac * 100) / 100;
    const penalty = Math.round(breakHolding.penalty * frac * 100) / 100;
    const netKept = Math.max(0, accruedOnPortion - penalty);
    const isFull = amt >= principal - 0.005;
    return { amt, frac, accruedOnPortion, penalty, netKept, isFull, principal };
  }, [breakHolding, breakAmount]);
  const breakNow = trpc.withdrawals.add.useMutation({
    onSuccess: (res) => {
      invalidatePortfolioMoney(utils, portfolioId);
      const forfeited = Number((res as { forfeitedInterest?: number }).forfeitedInterest ?? 0);
      toast.success(
        forfeited > 0
          ? `Deposit broken early — KES ${forfeited.toLocaleString(undefined, { maximumFractionDigits: 0 })} interest forfeited`
          : "Deposit broken and recorded as a withdrawal",
      );
      setBreakHolding(null);
    },
    onError: (err) => toast.error(err.message),
  });

  function confirmBreakNow() {
    if (!portfolioId || !breakHolding || !breakCalc) return;
    if (breakCalc.amt <= 0) {
      toast.error("Enter an amount greater than zero to break.");
      return;
    }
    const kind = breakCalc.isFull ? "full" : "partial";
    breakNow.mutate({
      portfolioId,
      sourceType: "bank_instrument",
      bankHoldingId: breakHolding.id,
      // Withdraw the chosen amount of PRINCIPAL. A full break empties and closes
      // the holding; a partial break leaves the remaining balance active and
      // continuing to accrue. The server forfeits interest only on this portion.
      amount: breakCalc.amt,
      withdrawalDate: new Date().toISOString().slice(0, 10),
      reason: "Early break",
      notes: `${kind === "full" ? "Fully broke" : "Partially broke"} term deposit early via Break now (broke KES ${breakCalc.amt.toLocaleString(undefined, { maximumFractionDigits: 0 })} of KES ${breakHolding.principal.toLocaleString(undefined, { maximumFractionDigits: 0 })}; kept KES ${breakCalc.netKept.toLocaleString(undefined, { maximumFractionDigits: 0 })} interest, forfeited KES ${breakCalc.penalty.toLocaleString(undefined, { maximumFractionDigits: 0 })} penalty)`,
    });
  }

  function openBankEdit(h: (typeof bankHoldings)[number]) {
    setBankForm({
      id: h.id,
      bankName: h.bankName,
      label: h.label ?? "",
      instrumentType: h.instrumentType as BankInstrumentType,
      principal: String(h.principal),
      interestRate: String(h.interestRate),
      rateAsOfDate: h.rateAsOfDate ? new Date(h.rateAsOfDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      isNegotiable: h.isNegotiable,
      tenorMonths: h.tenorMonths != null ? String(h.tenorMonths) : "",
      maturityDate: h.maturityDate ? new Date(h.maturityDate).toISOString().slice(0, 10) : "",
      earlyBreakPenaltyPct: (h as { earlyBreakPenaltyPct?: number }).earlyBreakPenaltyPct != null ? String((h as { earlyBreakPenaltyPct?: number }).earlyBreakPenaltyPct) : "",
      maturityAction: ((h as { maturityAction?: "redeploy" | "rollover" }).maturityAction ?? "redeploy"),
      notes: h.notes ?? "",
    });
    setBankDialogOpen(true);
  }

  function submitBank() {
    if (!portfolioId) return;
    if (!bankForm.bankName.trim()) { toast.error("Bank name is required"); return; }
    const principal = parseFloat(bankForm.principal) || 0;
    const interestRate = parseFloat(bankForm.interestRate) || 0;
    const isTerm = isTermBankInstrument(bankForm.instrumentType);
    const common = {
      portfolioId,
      bankName: bankForm.bankName.trim(),
      label: bankForm.label.trim() || undefined,
      instrumentType: bankForm.instrumentType,
      interestRate,
      rateAsOfDate: bankForm.rateAsOfDate || undefined,
      isNegotiable: bankForm.isNegotiable,
      tenorMonths: isTerm && bankForm.tenorMonths ? parseInt(bankForm.tenorMonths) : undefined,
      maturityDate: isTerm && bankForm.maturityDate ? bankForm.maturityDate : undefined,
      payoutFrequency: isTerm ? ("maturity" as const) : ("on_call" as const),
      earlyBreakPenaltyPct: isTerm && bankForm.earlyBreakPenaltyPct ? parseFloat(bankForm.earlyBreakPenaltyPct) : undefined,
      maturityAction: isTerm ? bankForm.maturityAction : undefined,
      notes: bankForm.notes.trim() || undefined,
    };
    if (bankForm.id) {
      updateBank.mutate({ id: bankForm.id, ...common, principal });
    } else {
      addBank.mutate({ ...common, principal });
    }
  }

  // Resolve a deposit row to a destination label for the history table.
  function destLabelFor(d: { institutionType?: string | null; mmfFundId?: number | null; bankHoldingId?: number | null; bucket: string }) {
    if (d.institutionType === "bank_instrument" && d.bankHoldingId) {
      const h = bankHoldings.find((x) => x.id === d.bankHoldingId);
      return { label: h ? (h.label || `${h.bankName}`) : "Bank deposit", icon: <Building2 className="w-4 h-4" />, color: "text-sky-300", taxFree: false };
    }
    if (d.institutionType === "mmf_fund" && d.mmfFundId) {
      if (portfolio?.mmfFundId === d.mmfFundId) return { label: fundName, icon: <Wallet className="w-4 h-4" />, color: "text-emerald-400", taxFree: false };
      const s = secondaries.find((x) => x.mmfFundId === d.mmfFundId);
      return { label: s ? (s.label || s.fundName) : "MMF fund", icon: <PiggyBank className="w-4 h-4" />, color: "text-emerald-300", taxFree: false };
    }
    if (d.bucket === "ifb") return { label: GOV_META.ifb.label, icon: GOV_META.ifb.icon, color: GOV_META.ifb.color, taxFree: true };
    if (d.bucket === "tbill") return { label: GOV_META.tbill.label, icon: GOV_META.tbill.icon, color: GOV_META.tbill.color, taxFree: false };
    if (d.bucket === "fxd") return { label: GOV_META.fxd.label, icon: GOV_META.fxd.icon, color: GOV_META.fxd.color, taxFree: false };
    return { label: fundLabel, icon: <Wallet className="w-4 h-4" />, color: "text-emerald-400", taxFree: false };
  }

  const totalContributed = summary?.totalContributed ?? 0;
  const remainingToTarget = summary?.remainingToTarget ?? liveTarget;
  const taxLiability = summary?.taxLiability ?? 0;
  const taxBreakdown = summary?.taxBreakdown ?? { mmf: 0, tbill: 0, ifb: 0, fxd: 0, secondaryMmf: 0, bank: 0 };
  const byBucket = summary?.byBucket ?? { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };
  const bankBalance = summary?.bankBalance ?? 0;
  const secondaryMmfBalance = summary?.secondaryMmfBalance ?? 0;
  const progressPct = liveTarget > 0 ? Math.min(100, (totalContributed / liveTarget) * 100) : 0;

  const bankTotal = useMemo(() => bankHoldings.reduce((s, h) => s + h.principal, 0), [bankHoldings]);

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Live Deposit Tracker</h1>
          <p className="text-muted-foreground mt-1">
            Record every real deposit into the exact account it went to — this drives your live actuals on the dashboard.
          </p>
        </div>
        <Button
          onClick={openDrawer}
          className="bg-[#c9a84c] hover:bg-[#b8943f] text-black font-semibold gap-2"
        >
          <PlusCircle className="w-4 h-4" />
          Record Deposit
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Total Contributed</p>
          <p className="text-2xl font-serif font-bold text-[#c9a84c]">{formatKES(totalContributed)}</p>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-[#c9a84c] transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {liveTarget > 0 ? `${progressPct.toFixed(1)}% of ${formatKES(liveTarget)} goal` : "No target set"}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Remaining to Target</p>
          <p className="text-2xl font-serif font-bold text-foreground">{formatKES(remainingToTarget)}</p>
          <p className="text-xs text-muted-foreground">
            {liveTarget > 0 ? `Based on ${formatKES(liveTarget)} goal` : "Set a target in Settings"}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Est. Tax Liability</p>
            <div className="group relative">
              <Info className="w-3 h-3 text-muted-foreground cursor-help" />
              <div className="absolute bottom-5 left-0 z-10 hidden group-hover:block w-56 rounded-lg bg-popover border border-border p-3 text-xs text-muted-foreground shadow-xl">
                15% WHT is deducted at source on MMF interest, bank deposit interest, T-Bill discount, and FXD coupons — all final taxes for resident individuals. IFB bonds are fully tax-exempt.
              </div>
            </div>
          </div>
          <p className="text-2xl font-serif font-bold text-red-400">{formatKES(taxLiability)}</p>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {taxBreakdown.mmf > 0 && <p>MMF: {formatKES(taxBreakdown.mmf)}</p>}
            {(taxBreakdown.bank ?? 0) > 0 && <p>Bank: {formatKES(taxBreakdown.bank)}</p>}
            {taxBreakdown.tbill > 0 && <p>T-Bill: {formatKES(taxBreakdown.tbill)}</p>}
            {taxBreakdown.fxd > 0 && <p>FXD: {formatKES(taxBreakdown.fxd)}</p>}
            {byBucket.ifb > 0 && <p className="text-emerald-400">IFB: Tax-exempt</p>}
            {taxLiability === 0 && byBucket.ifb === 0 && <p>No deposits recorded yet</p>}
          </div>
        </div>
      </div>

      {/* Destination Breakdown */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          Where your money is
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-400"><Wallet className="w-4 h-4" /><span className="text-xs font-medium">{fundLabel}</span></div>
            <p className="text-lg font-serif font-bold text-foreground">{formatKES(byBucket.mmf)}</p>
            <p className="text-xs text-muted-foreground">Primary MMF</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-300"><PiggyBank className="w-4 h-4" /><span className="text-xs font-medium">Other MMFs</span></div>
            <p className="text-lg font-serif font-bold text-foreground">{formatKES(secondaryMmfBalance)}</p>
            <p className="text-xs text-muted-foreground">{secondaries.length} account{secondaries.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sky-300"><Building2 className="w-4 h-4" /><span className="text-xs font-medium">Bank</span></div>
            <p className="text-lg font-serif font-bold text-foreground">{formatKES(bankBalance)}</p>
            <p className="text-xs text-muted-foreground">{bankHoldings.length} instrument{bankHoldings.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-blue-400"><TrendingUp className="w-4 h-4" /><span className="text-xs font-medium">T-Bills</span></div>
            <p className="text-lg font-serif font-bold text-foreground">{formatKES(byBucket.tbill)}</p>
            <p className="text-xs text-muted-foreground">15% WHT</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-violet-400"><ShieldCheck className="w-4 h-4" /><span className="text-xs font-medium">IFB / FXD</span></div>
            <p className="text-lg font-serif font-bold text-foreground">{formatKES(byBucket.ifb + byBucket.fxd)}</p>
            <p className="text-xs text-muted-foreground">Bonds</p>
          </div>
        </div>
      </div>

      {/* Bank Instruments */}
      <div ref={bankSectionRef} className={`rounded-xl border bg-white/5 overflow-hidden transition-colors ${issuerFilter ? "border-amber-400/40" : "border-white/10"}`}>
        {issuerFilter ? (
          <div className="px-5 py-2.5 bg-amber-500/10 border-b border-amber-400/30 flex items-center gap-2 text-xs">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="text-amber-100">
              Showing holdings flagged for concentration at <span className="font-semibold">{issuerFilter}</span>.
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-xs text-amber-200 hover:text-amber-50 hover:bg-amber-500/20 ml-auto"
              onClick={() => {
                setIssuerFilter(null);
                if (typeof window !== "undefined") window.history.replaceState(null, "", "/deposits");
              }}
            >
              Clear
            </Button>
          </div>
        ) : null}
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-sky-300" />
          <h2 className="text-sm font-semibold text-foreground">Bank Instruments</h2>
          <span className="text-xs text-muted-foreground">— call, fixed, goal, ordinary & tiered savings ({formatKES(bankTotal)})</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto border-white/10 bg-white/5 gap-1.5 h-7 text-xs"
            onClick={() => { setBankForm(EMPTY_BANK); setBankDialogOpen(true); }}
          >
            <PlusCircle className="w-3.5 h-3.5" /> Add Instrument
          </Button>
        </div>
        {bankHoldings.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Building2 className="w-8 h-8 text-muted-foreground mx-auto opacity-30" />
            <p className="text-muted-foreground text-sm">No bank instruments tracked.</p>
            <p className="text-muted-foreground text-xs">Add a call, fixed, goal/target, ordinary or tiered savings deposit to record money held at a commercial bank.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-muted-foreground text-xs">Instrument</TableHead>
                <TableHead className="text-muted-foreground text-xs">Type</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Principal</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Rate</TableHead>
                <TableHead className="text-muted-foreground text-xs">Rate as-of</TableHead>
                <TableHead className="text-muted-foreground text-xs">Maturity / action</TableHead>
                <TableHead className="text-muted-foreground text-xs w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankHoldings.map((h) => {
                const isTerm = isTermBankInstrument(h.instrumentType);
                const penaltyPct = Number((h as { earlyBreakPenaltyPct?: number }).earlyBreakPenaltyPct ?? 0);
                const startISO = h.startDate ? new Date(h.startDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
                const whatIf = isTerm && penaltyPct > 0
                  ? earlyBreakWhatIf({
                      principal: Number(h.principal) || 0,
                      interestRate: Number(h.interestRate) || 0,
                      whtRate: Number(h.whtRate ?? 15),
                      startISO,
                      earlyBreakPenaltyPct: penaltyPct,
                    })
                  : null;
                const action = (h as { maturityAction?: "redeploy" | "rollover" }).maturityAction ?? "redeploy";
                return (
                <TableRow key={h.id} className={`border-white/10 transition-colors ${issuerMatches(h.bankName) ? "bg-amber-500/15 hover:bg-amber-500/20" : "hover:bg-white/5"}`}>
                  <TableCell className="text-sm text-foreground">
                    <div className="font-medium">{h.label || h.bankName}</div>
                    <div className="text-xs text-muted-foreground">{h.bankName}{h.isNegotiable ? " · negotiable" : ""}</div>
                  </TableCell>
                  <TableCell>
                    <Badge className="bg-sky-500/15 text-sky-300 border-sky-500/30 text-xs">
                      {bankInstrumentLabel(h.instrumentType)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-foreground">{formatKES(h.principal)}</TableCell>
                  <TableCell className="text-right font-mono text-foreground">{h.interestRate.toFixed(2)}%</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {h.rateAsOfDate ? new Date(h.rateAsOfDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {isTerm ? (
                      <div className="space-y-0.5">
                        <div className="text-foreground">
                          {h.maturityDate ? new Date(h.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "No maturity set"}
                        </div>
                        <Badge variant="outline" className={action === "rollover" ? "text-[10px] border-amber-500/40 text-amber-300" : "text-[10px] border-emerald-500/40 text-emerald-300"}>
                          {action === "rollover" ? "Auto-rollover" : "Redeploy to best yield"}
                        </Badge>
                        {whatIf ? (
                          <div className="text-[10px] text-muted-foreground leading-tight pt-0.5">
                            Break now → keep {formatKES(whatIf.netIfBrokenNow)}
                            <span className="text-red-400"> (−{formatKES(whatIf.penaltyAmount)} penalty)</span>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">On call · fully liquid</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {/* Break now: only for active term deposits before maturity. */}
                      {h.isActive && isTerm && h.maturityDate && new Date(h.maturityDate) > new Date() ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-amber-300 hover:text-amber-200 hover:bg-amber-500/10"
                          title="Break now — record an early withdrawal"
                          onClick={() => {
                            setBreakHolding({
                              id: h.id,
                              label: h.label || h.bankName,
                              principal: Number(h.principal) || 0,
                              netNow: whatIf ? whatIf.netIfBrokenNow : Number(h.principal) || 0,
                              penalty: whatIf ? whatIf.penaltyAmount : 0,
                              accrued: whatIf ? whatIf.accruedInterest : 0,
                            });
                            setBreakAmount(String(Number(h.principal) || 0));
                          }}
                        >
                          <Zap className="w-3.5 h-3.5" />
                        </Button>
                      ) : null}
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => openBankEdit(h)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400" onClick={() => setDeleteBankId(h.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Deposit History Table */}
      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <ArrowDownCircle className="w-4 h-4 text-[#c9a84c]" />
          <h2 className="text-sm font-semibold text-foreground">Deposit History</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {deposits.length} record{deposits.length !== 1 ? "s" : ""}
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading deposits…</div>
        ) : deposits.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <ArrowDownCircle className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
            <p className="text-muted-foreground text-sm">No deposits recorded yet.</p>
            <p className="text-muted-foreground text-xs">Click "Record Deposit" to log your first real contribution.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-muted-foreground text-xs">Date</TableHead>
                <TableHead className="text-muted-foreground text-xs">Destination</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Amount</TableHead>
                <TableHead className="text-muted-foreground text-xs">Tax Treatment</TableHead>
                <TableHead className="text-muted-foreground text-xs">Notes</TableHead>
                <TableHead className="text-muted-foreground text-xs w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deposits.map((d) => {
                const dest = destLabelFor(d as never);
                const amount = parseFloat(String(d.amount));
                return (
                  <TableRow key={d.id} className="border-white/10 hover:bg-white/5">
                    <TableCell className="text-sm text-foreground">
                      {new Date(d.depositDate).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })}
                    </TableCell>
                    <TableCell>
                      <div className={`flex items-center gap-2 ${dest.color}`}>
                        {dest.icon}
                        <span className="text-sm font-medium">{dest.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-foreground">{formatKES(amount)}</TableCell>
                    <TableCell>
                      {dest.taxFree ? (
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Tax-Exempt</Badge>
                      ) : (
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">15% WHT</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{d.notes ?? "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400" onClick={() => setDeleteId(d.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Bank instrument dialog */}
      <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
        <DialogContent className="bg-[#0f1117] border-white/10 text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">{bankForm.id ? "Edit" : "Add"} Bank Instrument</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Bank name</Label>
                <Input value={bankForm.bankName} onChange={(e) => setBankForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="e.g. KCB" className="bg-white/5 border-white/10 h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Label (optional)</Label>
                <Input value={bankForm.label} onChange={(e) => setBankForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Emergency fund" className="bg-white/5 border-white/10 h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select value={bankForm.instrumentType} onValueChange={(v) => setBankForm((f) => ({ ...f, instrumentType: v as BankInstrumentType }))}>
                  <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#0f1117] border-white/10">
                    {BANK_INSTRUMENT_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Principal (KES)</Label>
                <Input type="number" min="0" step="1000" value={bankForm.principal} onChange={(e) => setBankForm((f) => ({ ...f, principal: e.target.value }))} placeholder="e.g. 200000" className="bg-white/5 border-white/10 font-mono h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Interest rate (% p.a.)</Label>
                <Input type="number" min="0" step="0.01" value={bankForm.interestRate} onChange={(e) => setBankForm((f) => ({ ...f, interestRate: e.target.value }))} placeholder="e.g. 9.50" className="bg-white/5 border-white/10 font-mono h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Rate as-of date</Label>
                <Input type="date" value={bankForm.rateAsOfDate} onChange={(e) => setBankForm((f) => ({ ...f, rateAsOfDate: e.target.value }))} className="bg-white/5 border-white/10 h-9 text-sm" />
              </div>
            </div>
            {isTermBankInstrument(bankForm.instrumentType) && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Tenor (months)</Label>
                    <Input type="number" min="0" value={bankForm.tenorMonths} onChange={(e) => setBankForm((f) => ({ ...f, tenorMonths: e.target.value }))} placeholder="e.g. 6" className="bg-white/5 border-white/10 font-mono h-9 text-sm" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Maturity date</Label>
                    <Input type="date" value={bankForm.maturityDate} onChange={(e) => setBankForm((f) => ({ ...f, maturityDate: e.target.value }))} className="bg-white/5 border-white/10 h-9 text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Early-break penalty (% of interest forfeited if withdrawn early)</Label>
                  <Input type="number" min="0" max="100" step="0.5" value={bankForm.earlyBreakPenaltyPct} onChange={(e) => setBankForm((f) => ({ ...f, earlyBreakPenaltyPct: e.target.value }))} placeholder="e.g. 25" className="bg-white/5 border-white/10 font-mono h-9 text-sm" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">At maturity</Label>
                  <Select value={bankForm.maturityAction} onValueChange={(v) => setBankForm((f) => ({ ...f, maturityAction: v as "redeploy" | "rollover" }))}>
                    <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="redeploy">Redeploy to best yield (return to MMF, let the engine reinvest)</SelectItem>
                      <SelectItem value="rollover">Auto-rollover (renew the same deposit at the same rate)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground leading-tight">
                    Controls how the projection handles this deposit when it matures: send principal + interest back to the money-market fund for the yield-max allocator to reinvest, or renew it in place.
                  </p>
                </div>
              </>
            )}
            <div className="flex items-center justify-between rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
              <div>
                <Label className="text-xs text-foreground">Negotiated rate</Label>
                <p className="text-xs text-muted-foreground">This rate was individually negotiated with the bank</p>
              </div>
              <Switch checked={bankForm.isNegotiable} onCheckedChange={(c) => setBankForm((f) => ({ ...f, isNegotiable: c }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
              <Textarea value={bankForm.notes} onChange={(e) => setBankForm((f) => ({ ...f, notes: e.target.value }))} className="bg-white/5 border-white/10 resize-none h-14 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-white/10" onClick={() => setBankDialogOpen(false)}>Cancel</Button>
            <Button className="bg-[#c9a84c] hover:bg-[#b8943f] text-black font-semibold" onClick={submitBank} disabled={addBank.isPending || updateBank.isPending}>
              {addBank.isPending || updateBank.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete deposit confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent className="bg-[#0d1117] border-white/10 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this deposit?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This will permanently remove the deposit record and update your actuals summary.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId !== null && portfolioId && deleteMutation.mutate({ portfolioId, id: deleteId })} className="bg-red-600 hover:bg-red-700 text-white">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete bank instrument confirmation */}
      <AlertDialog open={deleteBankId !== null} onOpenChange={(o) => !o && setDeleteBankId(null)}>
        <AlertDialogContent className="bg-[#0d1117] border-white/10 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this bank instrument?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This removes the instrument and its principal from your actuals. Deposit history rows that referenced it will remain but show as a generic bank deposit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteBankId !== null && portfolioId && deleteBank.mutate({ id: deleteBankId, portfolioId })} className="bg-red-600 hover:bg-red-700 text-white">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Break now confirmation (Round 33) */}
      <AlertDialog open={breakHolding !== null} onOpenChange={(o) => !o && setBreakHolding(null)}>
        <AlertDialogContent className="bg-[#0d1117] border-white/10 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-300" /> Break “{breakHolding?.label}” now?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              Records an actual early withdrawal today. Break the whole deposit, or just part of it — the remainder keeps accruing. It cannot auto-reverse.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {breakHolding && breakCalc ? (
            <div className="space-y-3">
              {/* Amount to break */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Amount to break (KES)</Label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"
                      onClick={() => setBreakAmount(String(Math.round(breakHolding.principal / 2)))}
                    >
                      Half
                    </button>
                    <button
                      type="button"
                      className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-muted-foreground hover:text-foreground hover:bg-white/5"
                      onClick={() => setBreakAmount(String(breakHolding.principal))}
                    >
                      Full
                    </button>
                  </div>
                </div>
                <Input
                  type="number"
                  min={0}
                  max={breakHolding.principal}
                  step={1000}
                  value={breakAmount}
                  onChange={(e) => setBreakAmount(e.target.value)}
                  className="bg-white/5 border-white/10 h-9 text-sm font-mono"
                />
                <Slider
                  value={[Math.min(breakCalc.amt, breakHolding.principal)]}
                  min={0}
                  max={breakHolding.principal}
                  step={Math.max(1, Math.round(breakHolding.principal / 100))}
                  onValueChange={(v: number[]) => setBreakAmount(String(Math.round(v[0])))}
                  className="py-1"
                />
                <p className="text-[11px] text-muted-foreground">
                  Breaking <span className="font-mono text-foreground">{formatKES(breakCalc.amt)}</span>{" "}
                  of <span className="font-mono">{formatKES(breakHolding.principal)}</span>{" "}
                  ({(breakCalc.frac * 100).toFixed(0)}%).{" "}
                  {breakCalc.isFull ? (
                    <span className="text-amber-300">Full break — the deposit will close.</span>
                  ) : (
                    <span className="text-emerald-300">{formatKES(breakHolding.principal - breakCalc.amt)} stays invested and keeps accruing.</span>
                  )}
                </p>
              </div>

              <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Principal freed up</span>
                  <span className="font-mono font-semibold">{formatKES(breakCalc.amt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Interest accrued on broken portion</span>
                  <span className="font-mono">{formatKES(breakCalc.accruedOnPortion)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Early-break penalty</span>
                  <span className="font-mono text-red-400">−{formatKES(breakCalc.penalty)}</span>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-1.5">
                  <span className="text-foreground">Net interest kept</span>
                  <span className="font-mono font-semibold text-emerald-300">{formatKES(breakCalc.netKept)}</span>
                </div>
                <div className="flex justify-between border-t border-white/10 pt-1.5">
                  <span className="text-foreground">Cash you receive today</span>
                  <span className="font-mono font-semibold">{formatKES(breakCalc.amt + breakCalc.netKept)}</span>
                </div>
              </div>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmBreakNow} disabled={breakNow.isPending || !breakCalc || breakCalc.amt <= 0} className="bg-amber-600 hover:bg-amber-700 text-white">
              {breakNow.isPending ? "Breaking…" : breakCalc?.isFull ? "Break in full" : "Break this amount"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
