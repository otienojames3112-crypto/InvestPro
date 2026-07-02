import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  MoreHorizontal,
  Archive,
  RotateCcw,
  AlertTriangle,
  History,
  LineChart,
  ArrowRight,
  ShieldCheck,
} from "lucide-react";
import { formatRelativeTime } from "@/lib/format";

export type CatalogueKind = "mmf" | "bank" | "cbk" | "market_asset";

/**
 * Manager-only governance controls shared by every reference catalogue row:
 * Deactivate/Archive, Reactivate, Mark stale (or clear), View audit history,
 * and (where a rate exists) View rate history. Reference edits are governed —
 * these are the manager lifecycle actions the Round 83 brief requires on all
 * four catalogues. Nothing here is shown to a non-admin.
 */
export function CatalogueRowControls({
  catalogue,
  targetRef,
  instrumentName,
  isActive,
  isStale,
  showRateHistory = true,
  size = "icon",
}: {
  catalogue: CatalogueKind;
  targetRef: string;
  instrumentName?: string | null;
  isActive: boolean;
  isStale?: boolean;
  showRateHistory?: boolean;
  size?: "icon" | "sm";
}) {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [auditOpen, setAuditOpen] = useState(false);
  const [rateOpen, setRateOpen] = useState(false);
  const [staleOpen, setStaleOpen] = useState(false);
  const [reason, setReason] = useState("");

  const isManager = user?.role === "admin";

  const invalidateAll = () => {
    utils.catalogue.rowMeta.invalidate();
    utils.researchPipeline.recentlyApproved.invalidate();
    // Best-effort refresh of the underlying catalogue lists.
    utils.mmfFunds?.list?.invalidate?.();
    utils.bankInstruments?.list?.invalidate?.();
    // Round 86: also refresh the approved-universe screener so a deactivate /
    // mark-stale action is reflected on the All Approved Instruments view.
    utils.explore?.approvedList?.invalidate?.();
    utils.explore?.federatedUniverse?.invalidate?.();
  };

  const setActive = trpc.catalogue.setActive.useMutation({
    onSuccess: () => {
      toast.success("Catalogue updated — recorded in the audit log.");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });
  const setStale = trpc.catalogue.setStale.useMutation({
    onSuccess: () => {
      toast.success("Row flagged — recorded in the audit log.");
      setStaleOpen(false);
      setReason("");
      invalidateAll();
    },
    onError: (e) => toast.error(e.message),
  });

  if (!isManager) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size={size === "icon" ? "icon" : "sm"} className="shrink-0">
            <MoreHorizontal className="w-4 h-4" />
            {size === "sm" && <span className="ml-1.5">Manage</span>}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {isActive ? (
            <DropdownMenuItem
              onClick={() => setActive.mutate({ catalogue, targetRef, active: false })}
              className="text-amber-600"
            >
              <Archive className="w-3.5 h-3.5 mr-2" /> Deactivate / archive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => setActive.mutate({ catalogue, targetRef, active: true })}>
              <RotateCcw className="w-3.5 h-3.5 mr-2" /> Reactivate
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() =>
              isStale
                ? setStale.mutate({ catalogue, targetRef, instrumentName: instrumentName ?? undefined, stale: false })
                : setStaleOpen(true)
            }
          >
            <AlertTriangle className="w-3.5 h-3.5 mr-2" />
            {isStale ? "Clear stale flag" : "Mark stale"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setAuditOpen(true)}>
            <History className="w-3.5 h-3.5 mr-2" /> View audit history
          </DropdownMenuItem>
          {showRateHistory && catalogue !== "market_asset" && (
            <DropdownMenuItem onClick={() => setRateOpen(true)}>
              <LineChart className="w-3.5 h-3.5 mr-2" /> View rate history
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Mark stale — capture an optional reason (audited). */}
      <Dialog open={staleOpen} onOpenChange={setStaleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark this row stale</DialogTitle>
            <DialogDescription>
              A stale flag warns everyone the figure may be out of date without removing it. It is recorded in the audit
              log. Replace it by approving a newer source-backed change on the Research Desk.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label className="text-xs">Reason (optional)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Fund published a new factsheet; awaiting refresh"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" className="bg-background" onClick={() => setStaleOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={setStale.isPending}
              onClick={() =>
                setStale.mutate({
                  catalogue,
                  targetRef,
                  instrumentName: instrumentName ?? undefined,
                  stale: true,
                  reason: reason.trim() === "" ? undefined : reason.trim(),
                })
              }
            >
              Mark stale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit history for this row. */}
      <Dialog open={auditOpen} onOpenChange={setAuditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-primary" /> Audit history
            </DialogTitle>
            <DialogDescription>{instrumentName ?? targetRef}</DialogDescription>
          </DialogHeader>
          {auditOpen && <AuditList catalogue={catalogue} targetRef={targetRef} />}
        </DialogContent>
      </Dialog>

      {/* Date-effective rate history for this row. */}
      {showRateHistory && catalogue !== "market_asset" && (
        <Dialog open={rateOpen} onOpenChange={setRateOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <LineChart className="w-4 h-4 text-primary" /> Rate history
              </DialogTitle>
              <DialogDescription>{instrumentName ?? targetRef}</DialogDescription>
            </DialogHeader>
            {rateOpen && <RateList catalogue={catalogue as "mmf" | "bank" | "cbk"} refKey={targetRef} />}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function AuditList({ catalogue, targetRef }: { catalogue: CatalogueKind; targetRef: string }) {
  const { data, isLoading } = trpc.catalogue.auditFor.useQuery({ catalogue, targetRef, limit: 50 });
  if (isLoading) return <Skeleton className="h-24 w-full rounded-lg" />;
  const entries = data?.entries ?? [];
  if (entries.length === 0)
    return <p className="text-sm text-muted-foreground py-4 text-center">No audit entries for this row yet.</p>;
  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {entries.map((e) => (
        <div key={e.id} className="rounded-lg border p-2.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{e.changeKind === "create" ? "Added" : "Edited"}{e.field ? ` · ${e.field}` : ""}</span>
            <span className="text-muted-foreground">{formatRelativeTime(e.approvedAt)}</span>
          </div>
          {e.changeKind === "edit" && (
            <div className="mt-1 flex items-center gap-1.5 text-muted-foreground flex-wrap">
              <span className="tabular-nums">{e.oldValue ?? "—"}</span>
              <ArrowRight className="w-3 h-3" />
              <span className="tabular-nums font-medium text-foreground">{e.newValue ?? "—"}</span>
            </div>
          )}
          <div className="mt-1 text-muted-foreground">
            {e.approvedBy}
            {e.source ? ` · source: ${e.source}` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function RateList({ catalogue, refKey }: { catalogue: "mmf" | "bank" | "cbk"; refKey: string }) {
  const { data, isLoading } = trpc.catalogue.rateHistory.useQuery({ catalogue, ref: refKey, limit: 60 });
  if (isLoading) return <Skeleton className="h-24 w-full rounded-lg" />;
  const points = data?.points ?? [];
  if (points.length === 0)
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No rate history yet. Each approved rate change from now on is captured here, date-effective.
      </p>
    );
  return (
    <div className="space-y-1.5 max-h-80 overflow-y-auto">
      {points.map((p, i) => (
        <div key={i} className="flex items-center justify-between rounded-lg border p-2.5 text-xs">
          <span className="tabular-nums font-medium">{p.value != null ? `${Number(p.value).toFixed(2)}%` : "—"}</span>
          {p.secondary != null && (
            <span className="tabular-nums text-muted-foreground">gross {Number(p.secondary).toFixed(2)}%</span>
          )}
          <span className="text-muted-foreground">
            effective {p.effectiveAt ? new Date(p.effectiveAt).toLocaleDateString() : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}
