import { useMemo, useState } from "react";
import { Link } from "wouter";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import { invalidatePortfolioMoney } from "@/lib/invalidatePortfolioMoney";
import { formatKES } from "@/lib/format";
import { earlyBreakWhatIf } from "@shared/actuals";
import {
  isTermBankInstrument,
  bankInstrumentLabel,
  type BankInstrumentType,
} from "@shared/const";
import { dashboardHref } from "@shared/navigation";
import { Button } from "@/components/ui/button";
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
  Building2,
  PlusCircle,
  Pencil,
  Trash2,
  Info,
  Landmark,
  TrendingUp,
  CalendarClock,
} from "lucide-react";
import { useDepositDrawer } from "@/contexts/DepositDrawerContext";

/**
 * BankHoldings — the ACTUAL money held at commercial banks (Holdings → Bank).
 *
 * This is a live-holdings surface, NOT the reference product catalogue. The
 * catalogue of indicative bank products lives in Research → Bank Product Catalogue
 * (BankInstruments.tsx). Both read distinct data: this page reads
 * `bankHoldings.*` (what you own); the catalogue reads `bankInstruments.*`.
 *
 * No money math is duplicated: principal comes straight from the holding rows,
 * accrued interest + WHT are derived with the shared `earlyBreakWhatIf` helper
 * (the same one the Deposit Tracker uses), and the "record new" action opens
 * the shared Deposit drawer so entry stays single-sourced.
 */
export default function BankHoldings({ embedded: _embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId } = usePortfolio();
  const { openDrawer } = useDepositDrawer();
  const utils = trpc.useUtils();

  const { data: bankHoldings = [], isLoading } = trpc.bankHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId },
  );

  const [deleteBankId, setDeleteBankId] = useState<number | null>(null);
  const deleteBank = trpc.bankHoldings.remove.useMutation({
    onSuccess: () => {
      invalidatePortfolioMoney(utils, portfolioId);
      setDeleteBankId(null);
    },
    onError: () => setDeleteBankId(null),
  });

  // Derived roll-ups. Each figure reuses the shared helpers, so it matches the
  // dashboard/tax surfaces rather than introducing a second source of truth.
  const rollup = useMemo(() => {
    const active = bankHoldings.filter((h) => h.isActive);
    const totalPrincipal = active.reduce((s, h) => s + (Number(h.principal) || 0), 0);
    let accruedGross = 0;
    let accruedWht = 0;
    let nextMaturity: { label: string; atMs: number } | null = null;
    for (const h of active) {
      const startISO = h.startDate
        ? new Date(h.startDate).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);
      const wi = earlyBreakWhatIf({
        principal: Number(h.principal) || 0,
        interestRate: Number(h.interestRate) || 0,
        whtRate: Number(h.whtRate ?? 15),
        startISO,
        earlyBreakPenaltyPct: Number(
          (h as { earlyBreakPenaltyPct?: number }).earlyBreakPenaltyPct ?? 0,
        ),
      });
      // whatIf.accruedInterest is already NET of WHT. Recover the gross and the
      // WHT withheld from the holding's own WHT rate so the tile matches the
      // tax surface rather than introducing a second interest model.
      const whtFrac = Math.min(0.99, Math.max(0, Number(h.whtRate ?? 15) / 100));
      const net = Math.max(0, wi.accruedInterest);
      const gross = whtFrac < 1 ? net / (1 - whtFrac) : net;
      accruedGross += net;
      accruedWht += Math.max(0, gross - net);
      if (isTermBankInstrument(h.instrumentType) && h.maturityDate) {
        const atMs = new Date(h.maturityDate).getTime();
        if (atMs >= Date.now() && (!nextMaturity || atMs < nextMaturity.atMs)) {
          nextMaturity = { label: h.label || h.bankName, atMs };
        }
      }
    }
    return {
      count: active.length,
      totalPrincipal,
      accruedNet: Math.max(0, accruedGross),
      accruedWht,
      nextMaturity,
    };
  }, [bankHoldings]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-sky-300" />
            <h2 className="text-xl font-semibold text-foreground">Bank deposits you hold</h2>
          </div>
          <p className="text-muted-foreground text-sm max-w-2xl">
            The actual money you keep at commercial banks — call, fixed, goal, ordinary and
            tiered savings. Looking for indicative rates to compare before opening a new one?
            See the{" "}
            <Link href={dashboardHref.bankCatalogue} className="text-primary underline underline-offset-2">
              Bank Product Catalogue
            </Link>{" "}
            under Research.
          </p>
        </div>
        <Button onClick={() => openDrawer()} className="shrink-0 gap-1.5">
          <PlusCircle className="w-4 h-4" /> Record a deposit
        </Button>
      </div>

      {/* Roll-up tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
          <div className="flex items-center gap-2 text-sky-300">
            <Landmark className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Total principal</span>
          </div>
          <p className="text-lg font-semibold text-foreground tabular-nums">
            {formatKES(rollup.totalPrincipal)}
          </p>
          <p className="text-xs text-muted-foreground">
            {rollup.count} active instrument{rollup.count !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
          <div className="flex items-center gap-2 text-emerald-300">
            <TrendingUp className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Accrued interest</span>
          </div>
          <p className="text-lg font-semibold text-foreground tabular-nums">
            {formatKES(rollup.accruedNet)}
          </p>
          <p className="text-xs text-muted-foreground">Net, after WHT so far</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
          <div className="flex items-center gap-2 text-amber-300">
            <Info className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">WHT withheld</span>
          </div>
          <p className="text-lg font-semibold text-foreground tabular-nums">
            {formatKES(rollup.accruedWht)}
          </p>
          <p className="text-xs text-muted-foreground">15% final tax on interest</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
          <div className="flex items-center gap-2 text-violet-300">
            <CalendarClock className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Next maturity</span>
          </div>
          {rollup.nextMaturity ? (
            <>
              <p className="text-lg font-semibold text-foreground">
                {new Date(rollup.nextMaturity.atMs).toLocaleDateString("en-KE", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </p>
              <p className="text-xs text-muted-foreground truncate">{rollup.nextMaturity.label}</p>
            </>
          ) : (
            <>
              <p className="text-lg font-semibold text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground">No term deposits maturing</p>
            </>
          )}
        </div>
      </div>

      {/* Holdings table */}
      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-sky-300" />
          <h3 className="text-sm font-semibold text-foreground">Your instruments</h3>
          <span className="text-xs text-muted-foreground">
            {formatKES(rollup.totalPrincipal)} across {rollup.count}
          </span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto border-white/10 bg-white/5 gap-1.5 h-7 text-xs"
            onClick={() => openDrawer()}
          >
            <PlusCircle className="w-3.5 h-3.5" /> Add
          </Button>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading…</div>
        ) : bankHoldings.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <Building2 className="w-8 h-8 text-muted-foreground mx-auto opacity-30" />
            <p className="text-muted-foreground text-sm">No bank instruments tracked.</p>
            <p className="text-muted-foreground text-xs">
              Record a call, fixed, goal/target, ordinary or tiered savings deposit to track
              money held at a commercial bank. To edit an existing one, open it from Record a
              deposit.
            </p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-muted-foreground text-xs">Instrument</TableHead>
                <TableHead className="text-muted-foreground text-xs">Type</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Principal</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Rate</TableHead>
                <TableHead className="text-muted-foreground text-xs">Maturity / action</TableHead>
                <TableHead className="text-muted-foreground text-xs w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankHoldings.map((h) => {
                const isTerm = isTermBankInstrument(h.instrumentType);
                const action =
                  (h as { maturityAction?: "redeploy" | "rollover" }).maturityAction ?? "redeploy";
                return (
                  <TableRow key={h.id} className="border-white/10 hover:bg-white/5">
                    <TableCell className="text-sm text-foreground">
                      <div className="font-medium">{h.label || h.bankName}</div>
                      <div className="text-xs text-muted-foreground">
                        {h.bankName}
                        {h.isNegotiable ? " · negotiable" : ""}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge className="bg-sky-500/15 text-sky-300 border-sky-500/30 text-xs">
                        {bankInstrumentLabel(h.instrumentType as BankInstrumentType)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-foreground">
                      {formatKES(h.principal)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-foreground">
                      {Number(h.interestRate).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-xs">
                      {isTerm ? (
                        <div className="space-y-0.5">
                          <div className="text-foreground">
                            {h.maturityDate
                              ? new Date(h.maturityDate).toLocaleDateString("en-KE", {
                                  day: "numeric",
                                  month: "short",
                                  year: "numeric",
                                })
                              : "No maturity set"}
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              action === "rollover"
                                ? "text-[10px] border-amber-500/40 text-amber-300"
                                : "text-[10px] border-emerald-500/40 text-emerald-300"
                            }
                          >
                            {action === "rollover" ? "Auto-rollover" : "Redeploy to best yield"}
                          </Badge>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">On call · fully liquid</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          title="Edit via Record a deposit"
                          onClick={() => openDrawer()}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-red-400"
                          onClick={() => setDeleteBankId(h.id)}
                        >
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

      <p className="text-xs text-muted-foreground flex items-start gap-2">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Interest on bank deposits is subject to 15% withholding tax (final tax), the same as MMF
        interest. To add or edit a deposit, use Record a deposit — it writes to your live actuals
        and keeps every dashboard figure in sync.
      </p>

      <AlertDialog open={deleteBankId !== null} onOpenChange={(o) => !o && setDeleteBankId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this bank instrument?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the holding from your live tracking. Recorded deposits already logged
              against it stay in your history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteBankId !== null && portfolioId) {
                  deleteBank.mutate({ id: deleteBankId, portfolioId });
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
