import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { trpc } from "@/lib/trpc";
import { invalidatePortfolioMoney } from "@/lib/invalidatePortfolioMoney";
import { formatKES, formatSourceProvenance } from "@/lib/format";
import { dashboardHref } from "@shared/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  PiggyBank,
  Star,
  PlusCircle,
  Pencil,
  Trash2,
  Scale,
  Info,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

/**
 * MmfAccounts — the ACTUAL money-market fund accounts you hold (Holdings → MMF).
 *
 * This is a live-holdings surface: the primary fund this plan runs on (its
 * balance comes straight from `deposits.summary.byBucket.mmf`) plus any
 * secondary MMF accounts you also keep. It is deliberately NOT the market
 * comparison table — that reference table (all funds, yields, fees, "set as
 * primary") lives in Research → MMF Market. A prominent CTA links there.
 *
 * No money math is duplicated: balances/interest come from the shared
 * `deposits.summary` selector; per-account EAR comes from the fund catalogue.
 */
export default function MmfAccounts({ embedded: _embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId } = usePortfolio();
  const { fundName, fundCompany, fundEar, hasFund, fundId } = useSelectedFund();
  const utils = trpc.useUtils();

  const { data: summary } = trpc.deposits.summary.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId },
  );
  const { data: secondaries = [] } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId },
  );
  const { data: funds = [] } = trpc.mmfFunds.list.useQuery();

  const primaryBalance = summary?.byBucket?.mmf ?? 0;
  const secondaryBalance = summary?.secondaryMmfBalance ?? 0;

  // Add / edit secondary account dialog state.
  const EMPTY = { id: 0, mmfFundId: 0, label: "", currentBalance: "", monthlyContribution: "" };
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const addMut = trpc.secondaryMmfs.add.useMutation({
    onSuccess: () => {
      invalidatePortfolioMoney(utils, portfolioId);
      setDialogOpen(false);
      toast.success("Secondary MMF added");
    },
    onError: (e) => toast.error(e.message),
  });
  const updateMut = trpc.secondaryMmfs.update.useMutation({
    onSuccess: () => {
      invalidatePortfolioMoney(utils, portfolioId);
      setDialogOpen(false);
      toast.success("Account updated");
    },
    onError: (e) => toast.error(e.message),
  });
  const removeMut = trpc.secondaryMmfs.remove.useMutation({
    onSuccess: () => {
      invalidatePortfolioMoney(utils, portfolioId);
      setDeleteId(null);
      toast.success("Account removed");
    },
    onError: (e) => {
      toast.error(e.message);
      setDeleteId(null);
    },
  });

  const openAdd = () => {
    setForm({ ...EMPTY, mmfFundId: funds[0]?.id ?? 0 });
    setDialogOpen(true);
  };

  // Round 93: MMF Market → "Add as MMF account" deep-links here with
  // ?addSecondary=1&fundId=<id> to open the Add dialog pre-seeded to that fund.
  // Nothing is written until the user confirms balances in the dialog; the params
  // only save typing. We wait until funds have loaded (so the fund id is valid),
  // then clean the URL so a refresh doesn't re-open it.
  useEffect(() => {
    if (funds.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("addSecondary") !== "1") return;
    const fundId = Number(params.get("fundId") ?? "");
    const valid = funds.some((f) => f.id === fundId);
    setForm({ ...EMPTY, mmfFundId: valid ? fundId : (funds[0]?.id ?? 0) });
    setDialogOpen(true);
    for (const k of ["addSecondary", "fundId"]) params.delete(k);
    const qs = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funds]);
  const openEdit = (s: (typeof secondaries)[number]) => {
    setForm({
      id: s.id,
      mmfFundId: s.mmfFundId,
      label: s.label ?? "",
      currentBalance: String(s.currentBalance ?? ""),
      monthlyContribution: String(s.monthlyContribution ?? ""),
    });
    setDialogOpen(true);
  };
  const submit = () => {
    if (!portfolioId || !form.mmfFundId) {
      toast.error("Pick a fund first");
      return;
    }
    const payload = {
      portfolioId,
      mmfFundId: form.mmfFundId,
      label: form.label || undefined,
      currentBalance: Number(form.currentBalance) || 0,
      monthlyContribution: Number(form.monthlyContribution) || 0,
    };
    if (form.id) updateMut.mutate({ id: form.id, ...payload });
    else addMut.mutate(payload);
  };

  const totalMmf = useMemo(() => primaryBalance + secondaryBalance, [primaryBalance, secondaryBalance]);

  // Stage 6b — the primary fund's source/as-of live on the catalogue row (funds is
  // already fetched for the "switch fund" dropdown); cross-reference by id rather
  // than adding a new query.
  const primaryFund = funds.find((f) => f.id === fundId) ?? null;
  const primaryProvenance = formatSourceProvenance(primaryFund?.source, primaryFund?.asOfDate);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <PiggyBank className="w-5 h-5 text-emerald-300" />
            <h2 className="text-xl font-semibold text-foreground">Money-market accounts you hold</h2>
          </div>
          <p className="text-muted-foreground text-sm max-w-2xl">
            The MMF accounts your money actually sits in — the primary fund this plan runs on plus
            any secondary funds you keep. Want to see how your fund ranks against the market, or
            switch the primary fund? Open the{" "}
            <Link href={dashboardHref.mmfMarket} className="text-primary underline underline-offset-2">
              MMF Market
            </Link>{" "}
            under Research.
          </p>
        </div>
        <Button asChild variant="outline" className="shrink-0 gap-1.5 border-white/10 bg-white/5">
          <Link href={dashboardHref.mmfMarket}>
            <Scale className="w-4 h-4" /> Compare the market
          </Link>
        </Button>
      </div>

      {/* Roll-up tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
          <div className="flex items-center gap-2 text-emerald-300">
            <PiggyBank className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Total MMF held</span>
          </div>
          <p className="text-lg font-semibold text-foreground tabular-nums">{formatKES(totalMmf)}</p>
          <p className="text-xs text-muted-foreground">
            {secondaries.length + (hasFund || primaryBalance > 0 ? 1 : 0)} account
            {secondaries.length + (hasFund || primaryBalance > 0 ? 1 : 0) !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
          <div className="flex items-center gap-2 text-amber-300">
            <Star className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Primary balance</span>
          </div>
          <p className="text-lg font-semibold text-foreground tabular-nums">{formatKES(primaryBalance)}</p>
          <p className="text-xs text-muted-foreground truncate">{hasFund ? fundName : "No fund selected"}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
          <div className="flex items-center gap-2 text-sky-300">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Other MMFs</span>
          </div>
          <p className="text-lg font-semibold text-foreground tabular-nums">{formatKES(secondaryBalance)}</p>
          <p className="text-xs text-muted-foreground">
            {secondaries.length} secondary account{secondaries.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Primary fund card */}
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-300 fill-amber-300" />
              <h3 className="text-sm font-semibold text-foreground">Primary fund</h3>
              <Badge className="bg-amber-500/15 text-amber-200 border-amber-500/30 text-xs">
                This plan runs on this fund
              </Badge>
            </div>
            {hasFund ? (
              <>
                <p className="text-base font-medium text-foreground">{fundName}</p>
                <p className="text-xs text-muted-foreground">
                  {fundCompany} · {fundEar.toFixed(2)}% EAR (gross) · {formatKES(primaryBalance)} held
                </p>
                <p className="text-[11px] text-muted-foreground">{primaryProvenance}</p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No primary fund selected yet. Pick one in the MMF Market so projections use a
                real fund's yield.
              </p>
            )}
          </div>
          <Button asChild size="sm" variant="outline" className="border-white/10 bg-white/5 gap-1.5 h-8 text-xs shrink-0">
            <Link href={dashboardHref.mmfMarket}>
              <Scale className="w-3.5 h-3.5" /> {hasFund ? "Change" : "Choose"} fund
            </Link>
          </Button>
        </div>
      </div>

      {/* Secondary accounts */}
      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <PiggyBank className="w-4 h-4 text-emerald-300" />
          <h3 className="text-sm font-semibold text-foreground">Secondary MMF accounts</h3>
          <span className="text-xs text-muted-foreground">{formatKES(secondaryBalance)}</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto border-white/10 bg-white/5 gap-1.5 h-7 text-xs"
            onClick={openAdd}
          >
            <PlusCircle className="w-3.5 h-3.5" /> Add account
          </Button>
        </div>
        {secondaries.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <PiggyBank className="w-8 h-8 text-muted-foreground mx-auto opacity-30" />
            <p className="text-muted-foreground text-sm">No secondary MMF accounts.</p>
            <p className="text-muted-foreground text-xs">
              Add another fund you hold money in — useful for spreading liquid cash across issuers
              to stay under a concentration cap.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {secondaries.map((s) => (
              <div key={s.id} className="px-5 py-3 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">
                    {s.label || s.fundName}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {s.company} · {Number(s.ear).toFixed(2)}% EAR
                    {Number(s.monthlyContribution) > 0
                      ? ` · +${formatKES(s.monthlyContribution)}/mo`
                      : ""}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">
                    {formatSourceProvenance(s.holdingSnapshot?.sourceUrl, s.holdingSnapshot?.sourceAsOfDate)}
                  </p>
                </div>
                <p className="text-sm font-mono font-semibold text-foreground tabular-nums">
                  {formatKES(s.currentBalance)}
                </p>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-foreground"
                    onClick={() => openEdit(s)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-red-400"
                    onClick={() => setDeleteId(s.id)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground flex items-start gap-2">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        MMF interest is paid net of 15% withholding tax. Interest earned to date and forward income
        are shown on Review → Income; this page focuses on the balances you hold.
      </p>

      {/* Add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{form.id ? "Edit" : "Add"} secondary MMF account</DialogTitle>
            <DialogDescription>
              Track another money-market fund you hold. This adds to your MMF total and helps spread
              liquid cash across issuers.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Fund</Label>
              <Select
                value={form.mmfFundId ? String(form.mmfFundId) : undefined}
                onValueChange={(v) => setForm((f) => ({ ...f, mmfFundId: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a fund" />
                </SelectTrigger>
                <SelectContent>
                  {funds.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.fundName} — {Number(f.ear).toFixed(2)}% EAR
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Label (optional)</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Emergency buffer"
              />
            </div>
            {/* Round 99: show catalogue terms from the selected fund */}
            {(() => {
              const selFund = funds.find((f) => f.id === form.mmfFundId);
              if (!selFund) return null;
              return (
                <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2.5 space-y-1">
                  <p className="text-[11px] font-semibold text-emerald-300">Catalogue terms (snapshotted at purchase)</p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px]">
                    <span className="text-muted-foreground">Manager</span><span className="text-foreground">{selFund.company}</span>
                    <span className="text-muted-foreground">EAR</span><span className="text-foreground">{selFund.ear.toFixed(2)}%</span>
                    <span className="text-muted-foreground">Gross yield</span><span className="text-foreground">{selFund.grossYield.toFixed(2)}%</span>
                    <span className="text-muted-foreground">Fee</span><span className="text-foreground">{selFund.managementFee.toFixed(2)}%</span>
                    <span className="text-muted-foreground">Min investment</span><span className="text-foreground">KES {selFund.minInvestment.toLocaleString()}</span>
                    <span className="text-muted-foreground">WHT</span><span className="text-foreground">{selFund.whtRate}%</span>
                    <span className="text-muted-foreground">Day-count</span><span className="text-foreground">{selFund.dayCountBasis}/year</span>
                    <span className="text-muted-foreground">Crediting</span><span className="text-foreground capitalize">{selFund.creditingFrequency}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 pt-0.5">
                    These terms will be saved as an immutable snapshot. Catalogue updates will not rewrite them.
                  </p>
                </div>
              );
            })()}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Current balance (KES)</Label>
                <Input
                  type="number"
                  value={form.currentBalance}
                  onChange={(e) => setForm((f) => ({ ...f, currentBalance: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Monthly top-up (KES)</Label>
                <Input
                  type="number"
                  value={form.monthlyContribution}
                  onChange={(e) => setForm((f) => ({ ...f, monthlyContribution: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={addMut.isPending || updateMut.isPending}>
              {form.id ? "Save" : "Add account"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this secondary account?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the account and its balance from your MMF total. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteId !== null && portfolioId) {
                  removeMut.mutate({ id: deleteId, portfolioId });
                }
              }}
              className="bg-red-600 hover:bg-red-700"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
