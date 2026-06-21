import { useState } from "react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import { formatKES } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
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
  ChevronRight,
} from "lucide-react";

type Bucket = "mmf" | "tbill" | "ifb" | "fxd";

const BUCKET_META: Record<Bucket, { label: string; color: string; icon: React.ReactNode; description: string; taxNote: string }> = {
  mmf: {
    label: "SanlamAllianz MMF",
    color: "text-emerald-400",
    icon: <Wallet className="w-4 h-4" />,
    description: "Money Market Fund — daily accrual, 8.78% p.a. gross",
    taxNote: "15% WHT deducted at source (final tax)",
  },
  tbill: {
    label: "CBK T-Bills",
    color: "text-blue-400",
    icon: <TrendingUp className="w-4 h-4" />,
    description: "Treasury Bills — 91/182/364-day discount instruments",
    taxNote: "15% WHT on discount (final tax)",
  },
  ifb: {
    label: "IFB Bonds",
    color: "text-violet-400",
    icon: <ShieldCheck className="w-4 h-4" />,
    description: "Infrastructure Bonds — semi-annual coupons, tax-exempt",
    taxNote: "Tax-exempt (IFB)",
  },
  fxd: {
    label: "FXD Bonds",
    color: "text-orange-400",
    icon: <Landmark className="w-4 h-4" />,
    description: "Fixed Coupon Bonds — semi-annual coupons, 15% WHT",
    taxNote: "15% withholding tax on coupons",
  },
};

interface DepositDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function DepositDrawer({ open, onClose }: DepositDrawerProps) {
  const { portfolioId, portfolio } = usePortfolio();
  const utils = trpc.useUtils();
  const { data: deposits = [], isLoading } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: summary } = trpc.deposits.summary.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const liveTarget = portfolio?.targetAmount ?? 5000000;

  const addMutation = trpc.deposits.add.useMutation({
    onSuccess: () => {
      utils.deposits.list.invalidate();
      utils.deposits.summary.invalidate();
      utils.deposits.summary.invalidate();
      toast.success("Deposit recorded");
      setFormOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.deposits.delete.useMutation({
    onSuccess: () => {
      utils.deposits.list.invalidate();
      utils.deposits.summary.invalidate();
      toast.success("Deposit removed");
      setDeleteId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const [formOpen, setFormOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({
    bucket: "mmf" as Bucket,
    amount: "",
    depositDate: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  function resetForm() {
    setForm({ bucket: "mmf", amount: "", depositDate: new Date().toISOString().slice(0, 10), notes: "" });
  }

  function handleSubmit() {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { toast.error("Please enter a valid amount"); return; }
    if (!portfolioId) return;
    addMutation.mutate({ portfolioId, bucket: form.bucket, amount, depositDate: form.depositDate, notes: form.notes || undefined });
  }

  const totalContributed = summary?.totalContributed ?? 0;
  const remainingToTarget = summary?.remainingToTarget ?? liveTarget;
  const progressPct = liveTarget > 0 ? Math.min(100, (totalContributed / liveTarget) * 100) : 0;
  const taxBreakdown = summary?.taxBreakdown ?? { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };
  const byBucket = summary?.byBucket ?? { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };

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
              <p className="text-xs text-muted-foreground">Log real money into each bucket</p>
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

          {/* Bucket breakdown */}
          <div className="rounded-xl bg-white/5 border border-white/10 p-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">By Bucket</p>
            <div className="grid grid-cols-2 gap-3">
              {(Object.entries(BUCKET_META) as [Bucket, typeof BUCKET_META[Bucket]][]).map(([key, meta]) => (
                <div key={key} className="flex items-center gap-2">
                  <span className={meta.color}>{meta.icon}</span>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground truncate">{meta.label}</p>
                    <p className="text-sm font-bold text-foreground kes-amount">{formatKES(byBucket[key])}</p>
                  </div>
                </div>
              ))}
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
                {taxBreakdown.mmf > 0 && <p>MMF: {formatKES(taxBreakdown.mmf)}</p>}
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

              {/* Bucket */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Investment Bucket</Label>
                <Select value={form.bucket} onValueChange={(v) => setForm((f) => ({ ...f, bucket: v as Bucket }))}>
                  <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1117] border-white/10">
                    {(Object.entries(BUCKET_META) as [Bucket, typeof BUCKET_META[Bucket]][]).map(([key, meta]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <span className={meta.color}>{meta.icon}</span>
                          <span>{meta.label}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{BUCKET_META[form.bucket].description}</p>
                {form.bucket === "fxd" && (
                  <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-300">
                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>FXD coupon income is subject to 15% WHT — reflected in your tax estimate.</span>
                  </div>
                )}
                {form.bucket === "ifb" && (
                  <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-xs text-emerald-300">
                    <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>IFB bond coupons are fully tax-exempt.</span>
                  </div>
                )}
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Amount (KES)</Label>
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
                disabled={addMutation.isPending}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {addMutation.isPending ? "Saving…" : "Record Deposit"}
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
                  const meta = BUCKET_META[d.bucket as Bucket];
                  const amount = parseFloat(String(d.amount));
                  return (
                    <div key={d.id} className="flex items-center gap-3 rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
                      <span className={meta.color}>{meta.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground kes-amount">{formatKES(amount)}</span>
                          <Badge className={`text-xs px-1.5 py-0 h-4 ${d.bucket === "ifb" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}`}>
                            {d.bucket === "ifb" ? "Tax-Free" : "15% WHT"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {meta.label} · {new Date(d.depositDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
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
