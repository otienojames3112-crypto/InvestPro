import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  GitCompareArrows,
  ShieldCheck,
  ExternalLink,
  Check,
  Download,
  Info,
} from "lucide-react";
import { InfoHint } from "@/components/InfoHint";
import { isVerificationState, viewerStateLabel } from "@shared/provenance";
/** Friendly label for a figure key (falls back to the key itself). */
const FIELD_LABELS: Record<string, string> = {
  price: "Price",
  yield: "Yield",
  coupon: "Coupon",
  tenor: "Tenor",
  maturity: "Maturity",
  distribution: "Distribution",
  fx: "FX rate",
  expense: "Expense ratio",
  trailingReturn: "Trailing return",
};
function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function fmtAsOf(ms: number | null): string {
  if (!ms) return "date unknown";
  return new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function SourceConflicts({ embedded = false }: { embedded?: boolean } = {}) {
  const { isAuthenticated, user } = useAuth();
  const isMaintainer = user?.role === "admin";
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.opportunities.conflicts.useQuery(undefined, {
    enabled: isMaintainer,
  });

  const resolve = trpc.opportunities.resolveConflict.useMutation({
    onSuccess: (_res, vars) => {
      toast.success(
        vars.resolution === "apply"
          ? "Scraped value applied — the figure is now marked as entered by you."
          : "Kept your value — the scraped figure was dismissed.",
      );
      utils.opportunities.conflicts.invalidate();
      utils.opportunities.openConflictCount.invalidate();
      utils.opportunities.byRef.invalidate();
      utils.opportunities.list.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!isMaintainer) {
    return (
      <AppShell embedded={embedded}>
        <div className="container py-10 max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <GitCompareArrows className="w-5 h-5 text-primary" /> Source Conflicts
              </CardTitle>
              <CardDescription>
                {isAuthenticated
                  ? "Reviewing and resolving source conflicts is a maintainer-only task. Ask an administrator for access."
                  : "Sign in as a maintainer to review figures where a fresh data pull disagrees with a checked value."}
              </CardDescription>
            </CardHeader>
            {!isAuthenticated && (
              <CardContent>
                <Button onClick={() => (window.location.href = getLoginUrl())}>Sign in</Button>
              </CardContent>
            )}
          </Card>
        </div>
      </AppShell>
    );
  }

  const conflicts = data?.conflicts ?? [];

  return (
    <AppShell embedded={embedded}>
      <div className="container py-8 max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <GitCompareArrows className="w-6 h-6 text-primary" /> Source Conflicts
          </h1>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            When the automated data pull finds a number that disagrees with a figure{" "}
            <strong className="text-foreground">you</strong> verified or entered, it never overwrites your value —
            it flags the disagreement here. Your number stays in place until you decide.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            <strong className="text-foreground">Keep mine</strong> dismisses the scrape and keeps your value.{" "}
            <strong className="text-foreground">Use scraped value</strong> records the new number as{" "}
            <em>entered by you</em> — applying it is itself a deliberate human action, not a silent overwrite.
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : conflicts.length === 0 ? (
          <Empty className="border rounded-xl py-16">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <ShieldCheck className="w-6 h-6 text-emerald-500" />
              </div>
              <div>
                <p className="font-medium">No open conflicts</p>
                <p className="text-sm text-muted-foreground">
                  Every checked figure agrees with the latest pull, or hasn't been re-checked yet.
                </p>
              </div>
            </div>
          </Empty>
        ) : (
          <div className="space-y-3">
            {conflicts.map((c) => {
              const busy = resolve.isPending && resolve.variables?.id === c.id;
              return (
                <Card key={c.id} className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <CardTitle className="text-base flex items-center gap-2">
                        <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {c.opportunityRef}
                        </span>
                        <span>{fieldLabel(c.field)}</span>
                      </CardTitle>
                      <Badge variant="outline" className="text-amber-500 border-amber-500/40 inline-flex items-center gap-1">
                        Needs review
                        <InfoHint side="left" iconClassName="normal-case">A fresh automated data pull found a number that disagrees with the figure you verified or entered. Nothing was changed — you decide which value to keep.</InfoHint>
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-emerald-500 font-semibold flex items-center gap-1">
                          <ShieldCheck className="w-3 h-3" /> Your value
                          <InfoHint side="top" iconClassName="normal-case">The figure a person checked or typed in. It is the trusted value and is never overwritten automatically.</InfoHint>
                        </p>
                        <p className="text-lg font-semibold tabular-nums mt-1">{c.humanValue ?? "—"}</p>
                        <p className="text-xs text-muted-foreground mt-1">{stateLabelSafe(c.humanState)}</p>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1">
                          <Download className="w-3 h-3" /> Latest scraped value
                          <InfoHint side="top" iconClassName="normal-case">The number an automated pull read from the source most recently. “Scraped” means collected by a program, not yet checked by a person.</InfoHint>
                        </p>
                        <p className="text-lg font-semibold tabular-nums mt-1">{c.scrapedValue ?? "—"}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {c.scrapedSource ?? "Unknown source"} · as of {fmtAsOf(c.scrapedAsOf)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => resolve.mutate({ id: c.id, resolution: "dismiss" })}
                      >
                        <Check className="w-3.5 h-3.5 mr-1" /> Keep mine
                      </Button>
                      <InfoHint side="bottom">“Keep mine” dismisses the scraped number and leaves your value untouched. “Use scraped value” adopts the new number and records it as entered by you — a deliberate choice, never a silent overwrite.</InfoHint>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => resolve.mutate({ id: c.id, resolution: "apply" })}
                      >
                        <Download className="w-3.5 h-3.5 mr-1" /> Use scraped value
                      </Button>
                      <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                        <ExternalLink className="w-3 h-3" /> from {c.sourceId}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/**
 * Safe state label without leaning on the typed enum at the call site. Phase 8c:
 * delegates to the shared provenance vocabulary so it can never drift from the
 * labels every other surface shows; only falls back to the raw string for an
 * unrecognised value.
 */
function stateLabelSafe(s: string): string {
  return isVerificationState(s) ? viewerStateLabel(s) : s;
}
