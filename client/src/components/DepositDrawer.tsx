import { useMemo, useState } from "react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { trpc } from "@/lib/trpc";
import { formatKES } from "@/lib/format";
import { BANK_INSTRUMENT_TYPES, isTermBankInstrument, bankInstrumentLabel, type BankInstrumentType } from "@shared/const";
import {
  computeMaturityDate,
  whtRateForSecurity,
  defaultRateForSecurity,
  tenorYearsForSecurity,
  IFB_TENORS,
  FXD_TENORS,
  DEFAULT_IFB_TENOR_YEARS,
  DEFAULT_FXD_TENOR_YEARS,
  DEFAULT_ZERO_COUPON_TENOR_YEARS,
  DEFAULT_FLOATING_TENOR_YEARS,
  TBILL_TENOR_DAYS,
  type SecurityType,
} from "@shared/securityTenor";
import { tbillPrice, zeroCouponPrice } from "@shared/discount";
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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
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
  X,
  Building2,
  PiggyBank,
  Coins,
  Activity,
} from "lucide-react";

/**
 * A destination is a concrete place real money can go:
 *  - a primary MMF fund
 *  - a secondary MMF fund
 *  - a live bank instrument holding
 *  - a government-security bucket (T-bill / IFB / FXD)
 * Each carries the exact payload `deposits.add` needs.
 */
type Destination = {
  value: string; // unique key for the Select
  label: string;
  sublabel?: string;
  group: "MMF funds" | "Bank instruments" | "Government securities";
  icon: React.ReactNode;
  color: string;
  taxNote: string;
  payload: {
    institutionType: "mmf_fund" | "bank_instrument" | "government_security";
    mmfFundId?: number;
    bankHoldingId?: number;
    bucket?: "mmf" | "tbill" | "ifb" | "fxd" | "zero" | "floating";
    // Round 46: precise gov security type carried for the new instrument kinds
    // (zero-coupon / floating-rate) whose coarse bucket maps onto tbill / fxd.
    govSecurityType?: SecurityType;
  };
};

/** The five government-security kinds selectable in the deposit drawer. */
type GovKind = "tbill" | "ifb" | "fxd" | "zero" | "floating";

const GOV_META = {
  tbill: { label: "CBK T-Bills", icon: <TrendingUp className="w-4 h-4" />, color: "text-blue-400", taxNote: "15% WHT on discount (final tax)" },
  ifb: { label: "IFB Bonds", icon: <ShieldCheck className="w-4 h-4" />, color: "text-violet-400", taxNote: "Tax-exempt (IFB)" },
  fxd: { label: "FXD Bonds", icon: <Landmark className="w-4 h-4" />, color: "text-orange-400", taxNote: "15% WHT on coupons" },
  zero: { label: "Zero-Coupon Bonds", icon: <Coins className="w-4 h-4" />, color: "text-amber-400", taxNote: "15% WHT on discount (final tax)" },
  floating: { label: "Floating-Rate Bonds", icon: <Activity className="w-4 h-4" />, color: "text-cyan-400", taxNote: "15% / 10% WHT on coupons" },
} as const;

interface DepositDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function DepositDrawer({ open, onClose }: DepositDrawerProps) {
  const { portfolioId, portfolio } = usePortfolio();
  const { fundName, fundLabel, fundEar } = useSelectedFund();
  const utils = trpc.useUtils();

  const { data: deposits = [], isLoading } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: summary } = trpc.deposits.summary.useQuery(
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
  const { data: bankInstrumentRefs = [] } = trpc.bankInstruments.list.useQuery();
  // Round 45: rate settings power the live T-bill discount-price preview so the
  // user sees the actual cash they'll pay (below face) before recording.
  const { data: rateSettings } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId },
  );
  // Round 46: the linked register securities let the history list label a gov
  // deposit by its PRECISE instrument (zero-coupon / floating-rate), not just the
  // coarse bucket it was mapped onto (tbill/fxd) for server storage.
  const { data: securities = [] } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId },
  );

  const liveTarget = portfolio?.targetAmount ?? 0;

  const addMutation = trpc.deposits.add.useMutation({
    onSuccess: () => {
      utils.deposits.list.invalidate();
      utils.deposits.summary.invalidate();
      utils.secondaryMmfs.list.invalidate();
      utils.bankHoldings.list.invalidate();
      toast.success("Deposit recorded");
      setFormOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  // Inline bank-holding creation: lets the user open a brand-new bank call/fixed
  // deposit straight from the deposit drawer (no need to visit another page first).
  const createBankHolding = trpc.bankHoldings.add.useMutation();

  const deleteMutation = trpc.deposits.delete.useMutation({
    onSuccess: () => {
      utils.deposits.list.invalidate();
      utils.deposits.summary.invalidate();
      toast.success("Deposit removed");
      setDeleteId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  // Build the full destination list from the portfolio's real accounts.
  const destinations = useMemo<Destination[]>(() => {
    const list: Destination[] = [];
    const primaryFundId = portfolio?.mmfFundId ?? undefined;

    // Primary MMF (only routable as a destination if a fund is selected)
    if (primaryFundId) {
      list.push({
        value: `mmf:${primaryFundId}`,
        label: fundName,
        sublabel: `Primary fund · ${fundEar.toFixed(2)}% p.a. gross`,
        group: "MMF funds",
        icon: <Wallet className="w-4 h-4" />,
        color: "text-emerald-400",
        taxNote: "15% WHT deducted at source (final tax)",
        payload: { institutionType: "mmf_fund", mmfFundId: primaryFundId },
      });
    }
    // Secondary MMFs
    for (const s of secondaries) {
      list.push({
        value: `smmf:${s.id}`,
        label: s.label || s.fundName,
        sublabel: `${s.company} · ${s.ear.toFixed(2)}% p.a.`,
        group: "MMF funds",
        icon: <PiggyBank className="w-4 h-4" />,
        color: "text-emerald-300",
        taxNote: "15% WHT deducted at source (final tax)",
        payload: { institutionType: "mmf_fund", mmfFundId: s.mmfFundId },
      });
    }
    // Bank instrument holdings
    for (const h of bankHoldings) {
      list.push({
        value: `bank:${h.id}`,
        label: h.label || `${h.bankName} ${bankInstrumentLabel(h.instrumentType)}`,
        sublabel: `${h.bankName} · ${h.interestRate.toFixed(2)}% p.a.`,
        group: "Bank instruments",
        icon: <Building2 className="w-4 h-4" />,
        color: "text-sky-300",
        taxNote: "15% WHT on interest (final tax)",
        payload: { institutionType: "bank_instrument", bankHoldingId: h.id },
      });
    }
    // "Open a brand-new bank deposit" — always available so a bank instrument can
    // be funded directly from here even when the portfolio has none yet.
    list.push({
      value: "bank:new",
      label: "+ New bank deposit",
      sublabel: "Open a call or fixed deposit at a bank",
      group: "Bank instruments",
      icon: <PlusCircle className="w-4 h-4" />,
      color: "text-sky-400",
      taxNote: "15% WHT on interest (final tax)",
      payload: { institutionType: "bank_instrument" },
    });
    // Government securities buckets
    (["tbill", "ifb", "fxd", "zero", "floating"] as const).forEach((b) => {
      const m = GOV_META[b];
      list.push({
        value: `gov:${b}`,
        label: m.label,
        sublabel: "CBK / DhowCSD",
        group: "Government securities",
        icon: m.icon,
        color: m.color,
        taxNote: m.taxNote,
        payload: { institutionType: "government_security", bucket: b },
      });
    });
    return list;
  }, [portfolio?.mmfFundId, fundName, fundEar, secondaries, bankHoldings]);

  const [formOpen, setFormOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({
    destination: "",
    amount: "",
    depositDate: new Date().toISOString().slice(0, 10),
    notes: "",
  });
  // Fields shown only when opening a brand-new bank deposit inline.
  const [newBank, setNewBank] = useState({
    bankName: "",
    instrumentType: "fixed_deposit" as BankInstrumentType,
    interestRate: "",
    tenorMonths: "12",
  });
  // Round 40: which reference-rate row (if any) was used to quick-fill the new bank deposit.
  const [selectedBankRef, setSelectedBankRef] = useState("");
  // Round 39: precise government-security details. When a gov bucket is chosen we
  // capture the exact T-bill tenor (91/182/364) or bond tenor (years) so the
  // auto-created register row carries the correct maturity + WHT.
  const [govDetail, setGovDetail] = useState({
    tbillTenorDays: 364 as 91 | 182 | 364,
    bondTenorYears: DEFAULT_FXD_TENOR_YEARS as number,
    // Round 46: independent tenors for zero-coupon and floating-rate paper so
    // switching instrument kind doesn't clobber the FXD/IFB tenor choice.
    zeroTenorYears: DEFAULT_ZERO_COUPON_TENOR_YEARS as number,
    floatingTenorYears: DEFAULT_FLOATING_TENOR_YEARS as number,
  });

  const selectedDest = destinations.find((d) => d.value === form.destination);
  const isNewBank = form.destination === "bank:new";
  const govBucket = selectedDest?.payload.institutionType === "government_security"
    ? selectedDest.payload.bucket
    : undefined;
  const isGovTbill = govBucket === "tbill";
  const isGovZero = govBucket === "zero";
  const isGovFloating = govBucket === "floating";
  // Coupon-bond inputs (FXD/IFB/floating) all use the year-tenor picker.
  const isGovBond = govBucket === "ifb" || govBucket === "fxd";
  // A discount instrument is bought below face (T-bill or zero-coupon).
  const isGovDiscount = isGovTbill || isGovZero;
  // The bond-tenor (years) field is shared; pick the right backing state value.
  const govBondTenorYears =
    govBucket === "zero"
      ? govDetail.zeroTenorYears
      : govBucket === "floating"
        ? govDetail.floatingTenorYears
        : govDetail.bondTenorYears;
  // Resolve the precise security type from the bucket + chosen tenor.
  const govSecurityType: SecurityType | undefined = isGovTbill
    ? (`tbill_${govDetail.tbillTenorDays}` as SecurityType)
    : govBucket === "ifb"
      ? "ifb"
      : govBucket === "fxd"
        ? "fxd"
        : govBucket === "zero"
          ? "zero_coupon"
          : govBucket === "floating"
            ? "floating_rate"
            : undefined;
  // Year-tenor is meaningful for every kind except T-bills (which use day count).
  const govTenorYearsArg = isGovTbill ? null : govBondTenorYears;
  const govMaturity = govSecurityType
    ? computeMaturityDate(govSecurityType, form.depositDate, govTenorYearsArg)
    : "";
  const govWht = govSecurityType
    ? whtRateForSecurity(govSecurityType, govTenorYearsArg)
    : 0;

  // Round 45/46: live discount-price preview for DISCOUNT instruments (T-bills
  // AND zero-coupon bonds). Mirrors the server's auto-derivation (deposits.add)
  // and the CBK Securities Register: the user enters the FACE value; we show the
  // discounted purchase price they'll pay and the discount earned at maturity.
  // T-bills price on simple interest over days; zero-coupons compound over years.
  const tbillFace = isGovDiscount ? parseFloat(form.amount) || 0 : 0;
  const tbillRateForPreview = !isGovDiscount || rateSettings == null
    ? 0
    : isGovZero
      ? defaultRateForSecurity("zero_coupon", rateSettings)
      : govDetail.tbillTenorDays === 91
        ? rateSettings.tbill91Rate
        : govDetail.tbillTenorDays === 182
          ? rateSettings.tbill182Rate
          : rateSettings.tbill364Rate;
  const tbillPreviewPrice =
    isGovDiscount && tbillFace > 0 && tbillRateForPreview > 0
      ? isGovZero
        ? zeroCouponPrice(tbillFace, tbillRateForPreview, tenorYearsForSecurity("zero_coupon", govDetail.zeroTenorYears))
        : tbillPrice(
            tbillFace,
            tbillRateForPreview,
            TBILL_TENOR_DAYS[`tbill_${govDetail.tbillTenorDays}` as "tbill_91" | "tbill_182" | "tbill_364"],
          )
      : null;
  const tbillPreviewDiscount =
    tbillPreviewPrice != null ? tbillFace - tbillPreviewPrice : null;

  function resetForm() {
    setForm({ destination: "", amount: "", depositDate: new Date().toISOString().slice(0, 10), notes: "" });
    setNewBank({ bankName: "", instrumentType: "fixed_deposit" as BankInstrumentType, interestRate: "", tenorMonths: "12" });
    setSelectedBankRef("");
    setGovDetail({
      tbillTenorDays: 364,
      bondTenorYears: DEFAULT_FXD_TENOR_YEARS,
      zeroTenorYears: DEFAULT_ZERO_COUPON_TENOR_YEARS,
      floatingTenorYears: DEFAULT_FLOATING_TENOR_YEARS,
    });
  }

  async function handleSubmit() {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { toast.error("Please enter a valid amount"); return; }
    if (!portfolioId) return;
    if (!selectedDest) { toast.error("Please choose where the money went"); return; }

    // Opening a brand-new bank deposit: create the holding first, then record the
    // deposit into the newly created holding so actuals stay in one place.
    if (isNewBank) {
      const bankName = newBank.bankName.trim();
      if (!bankName) { toast.error("Enter the bank name"); return; }
      const rate = parseFloat(newBank.interestRate);
      if (isNaN(rate) || rate < 0) { toast.error("Enter a valid interest rate"); return; }
      const isTerm = isTermBankInstrument(newBank.instrumentType);
      const tenor = isTerm ? Math.max(1, parseInt(newBank.tenorMonths || "12", 10)) : undefined;
      try {
        const start = new Date(form.depositDate + "T12:00:00.000Z");
        let maturity: string | undefined;
        if (isTerm && tenor) {
          const m = new Date(start);
          m.setMonth(m.getMonth() + tenor);
          maturity = m.toISOString().slice(0, 10);
        }
        const res = await createBankHolding.mutateAsync({
          portfolioId,
          bankName,
          label: `${bankName} ${isTerm ? `${tenor}-month ${bankInstrumentLabel(newBank.instrumentType).toLowerCase()}` : bankInstrumentLabel(newBank.instrumentType).toLowerCase()}`,
          instrumentType: newBank.instrumentType,
          principal: 0, // principal is added by the deposit below to avoid double counting
          interestRate: rate,
          rateAsOfDate: form.depositDate,
          startDate: form.depositDate,
          tenorMonths: tenor,
          maturityDate: maturity,
          payoutFrequency: isTerm ? "maturity" : "on_call",
          maturityAction: isTerm ? ("redeploy" as const) : undefined,
        });
        if (!res?.id) { toast.error("Could not open the bank deposit"); return; }
        await utils.bankHoldings.list.invalidate();
        addMutation.mutate({
          portfolioId,
          amount,
          depositDate: form.depositDate,
          notes: form.notes || undefined,
          institutionType: "bank_instrument",
          bankHoldingId: res.id,
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Could not open the bank deposit");
      }
      return;
    }

    // Round 46: the server's deposit bucket enum only accepts the four coarse
    // values (mmf/tbill/ifb/fxd). Zero-coupon is a discount instrument → map to
    // the "tbill" bucket; floating-rate is a coupon bond → map to "fxd". The
    // PRECISE kind is still carried via govSecurityType, which the server uses
    // first when creating the register row, so the mapping never loses fidelity.
    const { govSecurityType: _ignored, bucket: _wideBucket, ...restPayload } = selectedDest.payload;
    const submitBucket: "mmf" | "tbill" | "ifb" | "fxd" | undefined =
      _wideBucket === "zero"
        ? "tbill"
        : _wideBucket === "floating"
          ? "fxd"
          : _wideBucket;
    // The year-tenor we pass: zero uses its own tenor, floating uses its own,
    // FXD/IFB use the shared bond tenor. T-bills carry no year tenor.
    const sendBondTenor =
      isGovBond || isGovZero || isGovFloating ? govBondTenorYears : undefined;
    addMutation.mutate({
      portfolioId,
      amount,
      depositDate: form.depositDate,
      notes: form.notes || undefined,
      ...restPayload,
      ...(submitBucket ? { bucket: submitBucket } : {}),
      // Precise gov-security type + bond tenor so the auto-created register row
      // gets the right maturity + WHT (covers tbill/ifb/fxd/zero/floating).
      ...(govSecurityType ? { govSecurityType } : {}),
      ...(sendBondTenor != null ? { bondTenorYears: sendBondTenor } : {}),
    });
  }

  // Resolve a deposit row to a human destination label for the history list.
  function destLabelFor(d: { institutionType?: string | null; mmfFundId?: number | null; bankHoldingId?: number | null; bucket: string; securityId?: number | null }): { label: string; icon: React.ReactNode; color: string; taxFree: boolean } {
    if (d.institutionType === "bank_instrument" && d.bankHoldingId) {
      const h = bankHoldings.find((x) => x.id === d.bankHoldingId);
      return { label: h ? (h.label || `${h.bankName} deposit`) : "Bank deposit", icon: <Building2 className="w-4 h-4" />, color: "text-sky-300", taxFree: false };
    }
    if (d.institutionType === "mmf_fund" && d.mmfFundId) {
      if (portfolio?.mmfFundId === d.mmfFundId) {
        return { label: fundName, icon: <Wallet className="w-4 h-4" />, color: "text-emerald-400", taxFree: false };
      }
      const s = secondaries.find((x) => x.mmfFundId === d.mmfFundId);
      return { label: s ? (s.label || s.fundName) : "MMF fund", icon: <PiggyBank className="w-4 h-4" />, color: "text-emerald-300", taxFree: false };
    }
    // Round 46: prefer the linked register security's PRECISE type so a
    // zero-coupon (stored under the tbill bucket) or floating-rate (stored under
    // the fxd bucket) deposit is labelled accurately in the history.
    if (d.securityId != null) {
      const sec = securities.find((s) => s.id === d.securityId);
      if (sec?.securityType === "zero_coupon") return { label: GOV_META.zero.label, icon: GOV_META.zero.icon, color: GOV_META.zero.color, taxFree: false };
      if (sec?.securityType === "floating_rate") return { label: GOV_META.floating.label, icon: GOV_META.floating.icon, color: GOV_META.floating.color, taxFree: false };
    }
    if (d.bucket === "ifb") return { label: GOV_META.ifb.label, icon: GOV_META.ifb.icon, color: GOV_META.ifb.color, taxFree: true };
    if (d.bucket === "tbill") return { label: GOV_META.tbill.label, icon: GOV_META.tbill.icon, color: GOV_META.tbill.color, taxFree: false };
    if (d.bucket === "fxd") return { label: GOV_META.fxd.label, icon: GOV_META.fxd.icon, color: GOV_META.fxd.color, taxFree: false };
    // legacy mmf bucket with no destination metadata
    return { label: fundLabel, icon: <Wallet className="w-4 h-4" />, color: "text-emerald-400", taxFree: false };
  }

  const totalContributed = summary?.totalContributed ?? 0;
  const remainingToTarget = summary?.remainingToTarget ?? liveTarget;
  const progressPct = liveTarget > 0 ? Math.min(100, (totalContributed / liveTarget) * 100) : 0;
  const taxBreakdown = summary?.taxBreakdown ?? { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-[480px] bg-[#0d1117] border-l border-white/10 shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Record Deposits panel"
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <ArrowDownCircle className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                Record Deposits
              </h2>
              <p className="text-xs text-muted-foreground">Log real money into a specific account</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-primary/10 border border-primary/20 p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Contributed</p>
              <p className="text-xl font-bold text-primary kes-amount">{formatKES(totalContributed)}</p>
              <div className="mt-2 w-full h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{progressPct.toFixed(1)}% of goal</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Remaining</p>
              <p className="text-xl font-bold text-foreground kes-amount">{formatKES(remainingToTarget)}</p>
              <p className="text-xs text-muted-foreground mt-2">to reach {formatKES(liveTarget)}</p>
            </div>
          </div>

          {/* Tax summary */}
          {(summary?.taxLiability ?? 0) > 0 && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-3.5 h-3.5 text-red-400" />
                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">Est. Annual Tax (WHT)</p>
              </div>
              <p className="text-lg font-bold text-red-300 kes-amount">{formatKES(summary?.taxLiability ?? 0)}</p>
              <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                {taxBreakdown.mmf > 0 && <p>MMF / Bank: {formatKES(taxBreakdown.mmf)}</p>}
                {taxBreakdown.tbill > 0 && <p>T-Bill: {formatKES(taxBreakdown.tbill)}</p>}
                {taxBreakdown.fxd > 0 && <p>FXD: {formatKES(taxBreakdown.fxd)}</p>}
                <p className="text-emerald-400 mt-1">IFB: Tax-exempt</p>
              </div>
            </div>
          )}

          <Separator className="bg-white/10" />

          {/* Add deposit form toggle */}
          {!formOpen ? (
            <Button
              onClick={() => setFormOpen(true)}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-2"
            >
              <PlusCircle className="w-4 h-4" />
              Add New Deposit
            </Button>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">New Deposit</p>
                <button onClick={() => { setFormOpen(false); resetForm(); }} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>

              {/* Destination — pick the account first */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Where did the money go?</Label>
                <Select value={form.destination} onValueChange={(v) => setForm((f) => ({ ...f, destination: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm">
                    <SelectValue placeholder="Choose an account or instrument" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1117] border-white/10 max-h-72">
                    {(["MMF funds", "Bank instruments", "Government securities"] as const).map((group) => {
                      const items = destinations.filter((d) => d.group === group);
                      if (items.length === 0) return null;
                      return (
                        <SelectGroup key={group}>
                          <SelectLabel className="text-xs text-muted-foreground">{group}</SelectLabel>
                          {items.map((d) => (
                            <SelectItem key={d.value} value={d.value}>
                              <div className="flex items-center gap-2">
                                <span className={d.color}>{d.icon}</span>
                                <span>{d.label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      );
                    })}
                  </SelectContent>
                </Select>
                {selectedDest ? (
                  <p className="text-xs text-muted-foreground">{selectedDest.sublabel} · {selectedDest.taxNote}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Choose where the money landed. To open a new bank call/fixed deposit, pick “+ New bank deposit”. Extra MMF funds are added on the MMF Funds page.
                  </p>
                )}
                {/* Round 39: precise gov-security tenor sub-form */}
                {govBucket && (
                  <div className="space-y-3 rounded-lg border border-white/10 bg-white/5 p-3">
                    {isGovTbill && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">T-Bill tenor</Label>
                        <Select
                          value={String(govDetail.tbillTenorDays)}
                          onValueChange={(v) => setGovDetail((g) => ({ ...g, tbillTenorDays: parseInt(v, 10) as 91 | 182 | 364 }))}
                        >
                          <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="91">91-day T-Bill</SelectItem>
                            <SelectItem value="182">182-day T-Bill</SelectItem>
                            <SelectItem value="364">364-day T-Bill</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {isGovBond && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">{govBucket === "ifb" ? "IFB tenor" : "FXD tenor"}</Label>
                        <Select
                          value={String(govDetail.bondTenorYears)}
                          onValueChange={(v) => setGovDetail((g) => ({ ...g, bondTenorYears: parseFloat(v) }))}
                        >
                          <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {(govBucket === "ifb" ? IFB_TENORS : FXD_TENORS).map((o) => (
                              <SelectItem key={o.years} value={String(o.years)}>
                                {o.label}{o.band ? ` · ${o.band}` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {isGovZero && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Zero-coupon tenor (years)</Label>
                        <Select
                          value={String(govDetail.zeroTenorYears)}
                          onValueChange={(v) => setGovDetail((g) => ({ ...g, zeroTenorYears: parseFloat(v) }))}
                        >
                          <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[2, 3, 5, 7, 10, 15, 20].map((y) => (
                              <SelectItem key={y} value={String(y)}>{y} years</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    {isGovFloating && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted-foreground">Floating-rate tenor (years)</Label>
                        <Select
                          value={String(govDetail.floatingTenorYears)}
                          onValueChange={(v) => setGovDetail((g) => ({ ...g, floatingTenorYears: parseFloat(v) }))}
                        >
                          <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[2, 3, 5, 7, 10, 15].map((y) => (
                              <SelectItem key={y} value={String(y)}>{y} years</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Matures</span>
                      <span className="font-semibold text-foreground">
                        {govMaturity ? new Date(`${govMaturity}T12:00:00Z`).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Withholding tax</span>
                      {govWht === 0 ? (
                        <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">Tax-exempt</Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-500/40 text-amber-400">{govWht}% WHT</Badge>
                      )}
                    </div>
                    {govBucket === "fxd" && (
                      <p className="text-[11px] text-muted-foreground">
                        {govDetail.bondTenorYears >= 10 ? "10-year-plus FXD → 10% WHT on coupons." : "FXD under 10 years → 15% WHT on coupons."}
                      </p>
                    )}
                    {govBucket === "ifb" && (
                      <p className="text-[11px] text-emerald-300/80">IFB coupons are tax-exempt (subject to legislative change).</p>
                    )}
                    {isGovDiscount && (
                      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2.5 space-y-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Face value (at maturity)</span>
                          <span className="font-semibold text-foreground kes-amount">
                            {tbillFace > 0 ? formatKES(tbillFace) : "\u2014"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">You pay now (discounted price)</span>
                          <span className="font-semibold text-emerald-300 kes-amount">
                            {tbillPreviewPrice != null ? formatKES(tbillPreviewPrice) : "\u2014"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">Discount earned ({tbillRateForPreview > 0 ? `${tbillRateForPreview.toFixed(2)}%` : "rate"})</span>
                          <span className="font-semibold text-foreground kes-amount">
                            {tbillPreviewDiscount != null ? `+${formatKES(tbillPreviewDiscount)}` : "\u2014"}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground/80 border-t border-white/10 pt-1.5">
                          {isGovZero ? (
                            <>Enter the <span className="text-foreground">face value</span> (redemption amount) above. A
                            zero-coupon bond pays no coupons; it is bought below face and compounds up to face at
                            maturity. We record the discounted price you pay and charge 15% WHT only on the
                            accreted discount — exactly like the Securities register.</>
                          ) : (
                            <>Enter the <span className="text-foreground">face value</span> above. A T-bill is bought
                            below face; we record the discounted price you actually pay and accrete it to face at
                            maturity, charging 15% WHT only on the discount — exactly like the Securities register.</>
                          )}
                        </p>
                      </div>
                    )}
                    {isGovFloating && (
                      <p className="text-[11px] text-muted-foreground/80 border-t border-white/10 pt-1.5">
                        A <span className="text-foreground">floating-rate</span> note pays a coupon that resets each
                        period against a benchmark (e.g. the 91-day T-bill) plus a fixed margin. Enter the amount
                        invested above; projections use the portfolio's floating-rate assumption, and 15% WHT applies
                        to each coupon. Fine-tune the benchmark + margin on the <span className="text-foreground">Securities register</span>.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Inline new-bank-deposit details */}
              {isNewBank && (
                <div className="space-y-3 rounded-lg border border-sky-500/20 bg-sky-500/5 p-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-3.5 h-3.5 text-sky-300" />
                    <p className="text-xs font-semibold text-sky-300">New bank deposit details</p>
                  </div>
                  {bankInstrumentRefs.length > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Quick-fill from reference rates (optional)</Label>
                      <Select
                        value={selectedBankRef}
                        onValueChange={(v) => {
                          setSelectedBankRef(v);
                          const ref = bankInstrumentRefs.find((r) => String(r.id) === v);
                          if (!ref) return;
                          const isTerm = isTermBankInstrument(ref.instrumentType as BankInstrumentType);
                          const tenorMatch = ref.typicalTenor ? ref.typicalTenor.match(/\d+/) : null;
                          setNewBank((b) => ({
                            ...b,
                            bankName: ref.bankName,
                            instrumentType: ref.instrumentType as BankInstrumentType,
                            interestRate: ref.indicativeRate !== null ? String(ref.indicativeRate) : b.interestRate,
                            tenorMonths: isTerm && tenorMatch ? tenorMatch[0] : b.tenorMonths,
                          }));
                        }}
                      >
                        <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm">
                          <SelectValue placeholder="Pick a bank product to auto-fill…" />
                        </SelectTrigger>
                        <SelectContent className="bg-[#0d1117] border-white/10 max-h-72">
                          {bankInstrumentRefs.map((r) => (
                            <SelectItem key={r.id} value={String(r.id)}>
                              {r.bankName} · {bankInstrumentLabel(r.instrumentType as BankInstrumentType)}
                              {r.indicativeRate !== null ? ` · ${r.indicativeRate.toFixed(2)}%` : ""}
                              {r.isNegotiable ? " (negotiable)" : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">Indicative published rates — you can edit any field below. Bank rates are usually negotiable.</p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Bank name</Label>
                    <Input
                      placeholder="e.g. Equity Bank"
                      value={newBank.bankName}
                      onChange={(e) => setNewBank((b) => ({ ...b, bankName: e.target.value }))}
                      className="bg-white/5 border-white/10 h-9 text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Type</Label>
                      <Select
                        value={newBank.instrumentType}
                        onValueChange={(v) => setNewBank((b) => ({ ...b, instrumentType: v as BankInstrumentType }))}
                      >
                        <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-[#0d1117] border-white/10">
                          {BANK_INSTRUMENT_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Rate (% p.a.)</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="e.g. 10.5"
                        value={newBank.interestRate}
                        onChange={(e) => setNewBank((b) => ({ ...b, interestRate: e.target.value }))}
                        className="bg-white/5 border-white/10 font-mono h-9 text-sm"
                      />
                    </div>
                  </div>
                  {isTermBankInstrument(newBank.instrumentType) && (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Tenor (months)</Label>
                      <Input
                        type="number"
                        min="1"
                        step="1"
                        placeholder="e.g. 12"
                        value={newBank.tenorMonths}
                        onChange={(e) => setNewBank((b) => ({ ...b, tenorMonths: e.target.value }))}
                        className="bg-white/5 border-white/10 font-mono h-9 text-sm"
                      />
                      <p className="text-xs text-muted-foreground">Maturity is set automatically from the deposit date. Early withdrawal usually forfeits interest.</p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground">Bank rates are indicative and usually negotiable. You can edit this deposit later on the Other Assets page.</p>
                </div>
              )}

              {/* Amount */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{isGovDiscount ? "Face value (KES)" : "Amount (KES)"}</Label>
                <Input
                  type="number"
                  min="1"
                  step="100"
                  placeholder="e.g. 50000"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="bg-white/5 border-white/10 font-mono h-9 text-sm"
                />
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Deposit Date</Label>
                <Input
                  type="date"
                  value={form.depositDate}
                  onChange={(e) => setForm((f) => ({ ...f, depositDate: e.target.value }))}
                  className="bg-white/5 border-white/10 h-9 text-sm"
                />
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                <Textarea
                  placeholder="e.g. July 2026 monthly contribution"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="bg-white/5 border-white/10 resize-none h-16 text-sm"
                />
              </div>

              <Button
                onClick={handleSubmit}
                disabled={addMutation.isPending || createBankHolding.isPending}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {addMutation.isPending || createBankHolding.isPending ? "Saving…" : isNewBank ? "Open Deposit & Record" : "Record Deposit"}
              </Button>
            </div>
          )}

          {/* Deposit history */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              History ({deposits.length})
            </p>
            {isLoading ? (
              <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
            ) : deposits.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <ArrowDownCircle className="w-8 h-8 text-muted-foreground mx-auto opacity-30" />
                <p className="text-xs text-muted-foreground">No deposits yet. Add your first one above.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {deposits.map((d) => {
                  const dest = destLabelFor(d as never);
                  const amount = parseFloat(String(d.amount));
                  return (
                    <div key={d.id} className="flex items-center gap-3 rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
                      <span className={dest.color}>{dest.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground kes-amount">{formatKES(amount)}</span>
                          <Badge className={`text-xs px-1.5 py-0 h-4 ${dest.taxFree ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}`}>
                            {dest.taxFree ? "Tax-Free" : "15% WHT"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {dest.label} · {new Date(d.depositDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                          {d.notes ? ` · ${d.notes}` : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => setDeleteId(d.id)}
                        className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
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
            <AlertDialogAction
              onClick={() => deleteId !== null && portfolioId && deleteMutation.mutate({ portfolioId, id: deleteId })}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
