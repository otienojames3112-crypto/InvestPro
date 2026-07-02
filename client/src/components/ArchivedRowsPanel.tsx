import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Archive, RotateCcw } from "lucide-react";
import type { CatalogueKind } from "@/components/CatalogueRowControls";

/**
 * Round 90 — archive recoverability. A manager-only panel that lists the ARCHIVED
 * rows of a reference catalogue (hidden from the normal active table) so they can
 * be reviewed and reactivated. Each row shows who archived it, when, and why, plus
 * a one-click Reactivate (governed + audited server-side). Nothing here hard-deletes;
 * reactivation is symmetric with the Deactivate/archive action on the active row.
 *
 * Rendered only when the page's filter is set to "archived" or "all"; a non-admin
 * never sees it (the underlying query is admin-only and the component self-guards).
 */
export function ArchivedRowsPanel({
  catalogue,
  onChanged,
}: {
  catalogue: CatalogueKind;
  /** Called after a successful reactivate so the parent can refresh its active list. */
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const isManager = user?.role === "admin";
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.catalogue.listArchived.useQuery(
    { catalogue },
    { enabled: isManager },
  );
  const [busyRef, setBusyRef] = useState<string | null>(null);

  const setActive = trpc.catalogue.setActive.useMutation({
    onSuccess: () => {
      toast.success("Row reactivated — recorded in the audit log.");
      utils.catalogue.listArchived.invalidate({ catalogue });
      utils.catalogue.rowMeta.invalidate({ catalogue });
      utils.mmfFunds?.list?.invalidate?.();
      utils.bankInstruments?.list?.invalidate?.();
      utils.explore?.federatedUniverse?.invalidate?.();
      onChanged?.();
      setBusyRef(null);
    },
    onError: (e) => {
      toast.error(e.message);
      setBusyRef(null);
    },
  });

  if (!isManager) return null;
  if (isLoading) return <Skeleton className="h-20 w-full rounded-lg" />;

  const rows = data?.rows ?? [];
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        No archived rows in this catalogue. Archived rows are never hard-deleted — when you
        deactivate a row it moves here and can be reactivated at any time.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div
          key={r.targetRef}
          className="flex items-start justify-between gap-3 rounded-lg border bg-muted/30 p-3"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Archive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="font-medium truncate">{r.label}</span>
              {r.sublabel && (
                <span className="text-xs text-muted-foreground truncate">· {r.sublabel}</span>
              )}
              <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                Archived
              </Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {r.archivedBy ? `Archived by ${r.archivedBy}` : "Archived"}
              {r.archivedAt ? ` · ${new Date(r.archivedAt).toLocaleDateString()}` : ""}
              {r.archivedReason ? ` · ${r.archivedReason}` : ""}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="bg-background shrink-0"
            disabled={busyRef === r.targetRef}
            onClick={() => {
              setBusyRef(r.targetRef);
              setActive.mutate({ catalogue, targetRef: r.targetRef, active: true });
            }}
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reactivate
          </Button>
        </div>
      ))}
    </div>
  );
}

export type CatalogueRowScope = "active" | "archived" | "all";

/**
 * Manager-only Active / Archived / All segmented control used above each catalogue
 * table. For a non-admin it renders nothing (the value is pinned to "active" by the
 * caller), so the public view is unchanged.
 */
export function CatalogueScopeFilter({
  value,
  onChange,
}: {
  value: CatalogueRowScope;
  onChange: (v: CatalogueRowScope) => void;
}) {
  const { user } = useAuth();
  if (user?.role !== "admin") return null;
  const opts: { id: CatalogueRowScope; label: string }[] = [
    { id: "active", label: "Active" },
    { id: "archived", label: "Archived" },
    { id: "all", label: "All" },
  ];
  return (
    <div className="inline-flex rounded-lg border p-0.5 text-xs">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={
            "px-2.5 py-1 rounded-md transition-colors " +
            (value === o.id
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground")
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
