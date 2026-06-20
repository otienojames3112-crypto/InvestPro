import { useState } from "react";
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
} from "lucide-react";

type Bucket = "mmf" | "tbill" | "ifb" | "fxd";

const BUCKET_META: Record<
  Bucket,
  { label: string; color: string; icon: React.ReactNode; description: string; taxNote: string }
> = {
  mmf: {
    label: "SanlamAllianz MMF",
    color: "text-[#4ade80]",
    icon: <Wallet className="w-4 h-4" />,
    description: "Money Market Fund — daily accrual, 8.78% p.a. gross",
    taxNote: "15% WHT deducted at source (final tax)",
  },
  tbill: {
    label: "CBK T-Bills",
    color: "text-[#60a5fa]",
    icon: <TrendingUp className="w-4 h-4" />,
    description: "Treasury Bills — 91/182/364-day discount instruments",
    taxNote: "15% WHT on discount (final tax)",
  },
  ifb: {
    label: "IFB Bonds",
    color: "text-[#a78bfa]",
    icon: <ShieldCheck className="w-4 h-4" />,
    description: "Infrastructure Bonds — semi-annual coupons, tax-exempt",
    taxNote: "Tax-exempt (IFB)",
  },
  fxd: {
    label: "FXD Bonds",
    color: "text-[#fb923c]",
    icon: <Landmark className="w-4 h-4" />,
    description: "Fixed Coupon Bonds — semi-annual coupons, 15% WHT",
    taxNote: "15% withholding tax on coupons",
  },
};

export default function Deposits() {
  const utils = trpc.useUtils();

  const { data: deposits = [], isLoading } = trpc.deposits.list.useQuery();
  const { data: summary } = trpc.deposits.summary.useQuery();

  const addMutation = trpc.deposits.add.useMutation({
    onSuccess: () => {
      utils.deposits.list.invalidate();
      utils.deposits.summary.invalidate();
      toast.success("Deposit recorded successfully");
      setDialogOpen(false);
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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const [form, setForm] = useState({
    bucket: "mmf" as Bucket,
    amount: "",
    depositDate: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  function resetForm() {
    setForm({
      bucket: "mmf",
      amount: "",
      depositDate: new Date().toISOString().slice(0, 10),
      notes: "",
    });
  }

  function handleSubmit() {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }
    addMutation.mutate({
      bucket: form.bucket,
      amount,
      depositDate: form.depositDate,
      notes: form.notes || undefined,
    });
  }

  const totalContributed = summary?.totalContributed ?? 0;
  const remainingToTarget = summary?.remainingToTarget ?? 5000000;
  const taxLiability = summary?.taxLiability ?? 0;
  const taxBreakdown = summary?.taxBreakdown ?? { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };
  const byBucket = summary?.byBucket ?? { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };
  const targetAmount = totalContributed + remainingToTarget;
  const progressPct = targetAmount > 0 ? Math.min(100, (totalContributed / targetAmount) * 100) : 0;

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Live Deposit Tracker</h1>
          <p className="text-muted-foreground mt-1">
            Record every real deposit you make — this drives your live actuals on the dashboard.
          </p>
        </div>
        <Button
          onClick={() => setDialogOpen(true)}
          className="bg-[#c9a84c] hover:bg-[#b8943f] text-black font-semibold gap-2"
        >
          <PlusCircle className="w-4 h-4" />
          Record Deposit
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Total Contributed */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Total Contributed
          </p>
          <p className="text-2xl font-serif font-bold text-[#c9a84c]">
            {formatKES(totalContributed)}
          </p>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#c9a84c] transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {progressPct.toFixed(1)}% of KES 5,000,000 target
          </p>
        </div>

        {/* Remaining to Target */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Remaining to Target
          </p>
          <p className="text-2xl font-serif font-bold text-foreground">
            {formatKES(remainingToTarget)}
          </p>
          <p className="text-xs text-muted-foreground">
            Based on KES 5,000,000 goal
          </p>
        </div>

        {/* Estimated Tax Liability */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
              Est. Tax Liability
            </p>
            <div className="group relative">
              <Info className="w-3 h-3 text-muted-foreground cursor-help" />
              <div className="absolute bottom-5 left-0 z-10 hidden group-hover:block w-56 rounded-lg bg-popover border border-border p-3 text-xs text-muted-foreground shadow-xl">
15% WHT is deducted at source on MMF interest, T-Bill discount, and FXD coupons — all are final taxes for resident individuals. IFB bonds are fully tax-exempt.
              </div>
            </div>
          </div>
          <p className="text-2xl font-serif font-bold text-red-400">
            {formatKES(taxLiability)}
          </p>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {taxBreakdown.mmf > 0 && <p>MMF: {formatKES(taxBreakdown.mmf)}</p>}
            {taxBreakdown.tbill > 0 && <p>T-Bill: {formatKES(taxBreakdown.tbill)}</p>}
            {taxBreakdown.fxd > 0 && <p>FXD: {formatKES(taxBreakdown.fxd)}</p>}
            {taxLiability === 0 && <p>No deposits recorded yet</p>}
          </div>
        </div>
      </div>

      {/* Bucket Breakdown */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          Deposits by Bucket
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {(Object.entries(BUCKET_META) as [Bucket, typeof BUCKET_META[Bucket]][]).map(
            ([key, meta]) => (
              <div key={key} className="space-y-1">
                <div className={`flex items-center gap-2 ${meta.color}`}>
                  {meta.icon}
                  <span className="text-xs font-medium">{meta.label}</span>
                </div>
                <p className="text-lg font-serif font-bold text-foreground">
                  {formatKES(byBucket[key])}
                </p>
                <p className="text-xs text-muted-foreground">{meta.taxNote}</p>
              </div>
            )
          )}
        </div>
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
            <p className="text-muted-foreground text-xs">
              Click "Record Deposit" to log your first real contribution.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-muted-foreground text-xs">Date</TableHead>
                <TableHead className="text-muted-foreground text-xs">Bucket</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Amount</TableHead>
                <TableHead className="text-muted-foreground text-xs">Tax Treatment</TableHead>
                <TableHead className="text-muted-foreground text-xs">Notes</TableHead>
                <TableHead className="text-muted-foreground text-xs w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deposits.map((d) => {
                const meta = BUCKET_META[d.bucket as Bucket];
                const amount = parseFloat(String(d.amount));
                return (
                  <TableRow key={d.id} className="border-white/10 hover:bg-white/5">
                    <TableCell className="text-sm text-foreground">
                      {new Date(d.depositDate).toLocaleDateString("en-KE", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </TableCell>
                    <TableCell>
                      <div className={`flex items-center gap-2 ${meta.color}`}>
                        {meta.icon}
                        <span className="text-sm font-medium">{meta.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-foreground">
                      {formatKES(amount)}
                    </TableCell>
                    <TableCell>
                      {d.bucket === "ifb" ? (
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
                          Tax-Exempt
                        </Badge>
                      ) : d.bucket === "fxd" ? (
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                          15% WHT
                        </Badge>
                      ) : (
                        <Badge className="bg-white/10 text-muted-foreground border-white/10 text-xs">
                          No WHT
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">
                      {d.notes ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-400"
                        onClick={() => setDeleteId(d.id)}
                      >
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

      {/* Add Deposit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="bg-[#0f1117] border-white/10 text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">Record a Deposit</DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-2">
            {/* Bucket */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Investment Bucket</Label>
              <Select
                value={form.bucket}
                onValueChange={(v) => setForm((f) => ({ ...f, bucket: v as Bucket }))}
              >
                <SelectTrigger className="bg-white/5 border-white/10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0f1117] border-white/10">
                  {(Object.entries(BUCKET_META) as [Bucket, typeof BUCKET_META[Bucket]][]).map(
                    ([key, meta]) => (
                      <SelectItem key={key} value={key}>
                        <div className="flex items-center gap-2">
                          <span className={meta.color}>{meta.icon}</span>
                          <span>{meta.label}</span>
                        </div>
                      </SelectItem>
                    )
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {BUCKET_META[form.bucket].description}
              </p>
              {form.bucket === "fxd" && (
                <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-300">
                  <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>
                    FXD bond coupon income is subject to 15% withholding tax. This will be
                    reflected in your tax liability estimate.
                  </span>
                </div>
              )}
              {form.bucket === "ifb" && (
                <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-300">
                  <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                  <span>IFB bond coupons are fully tax-exempt.</span>
                </div>
              )}
            </div>

            {/* Amount */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Amount (KES)</Label>
              <Input
                type="number"
                min="1"
                step="100"
                placeholder="e.g. 50000"
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                className="bg-white/5 border-white/10 font-mono"
              />
            </div>

            {/* Date */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Deposit Date</Label>
              <Input
                type="date"
                value={form.depositDate}
                onChange={(e) => setForm((f) => ({ ...f, depositDate: e.target.value }))}
                className="bg-white/5 border-white/10"
              />
            </div>

            {/* Notes */}
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Notes (optional)</Label>
              <Textarea
                placeholder="e.g. July 2026 monthly contribution"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                className="bg-white/5 border-white/10 resize-none h-20"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setDialogOpen(false); resetForm(); }}
              className="border-white/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={addMutation.isPending}
              className="bg-[#c9a84c] hover:bg-[#b8943f] text-black font-semibold"
            >
              {addMutation.isPending ? "Saving…" : "Record Deposit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent className="bg-[#0f1117] border-white/10 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this deposit?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This will permanently remove the deposit record and update your actuals summary.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMutation.mutate({ id: deleteId })}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
