/**
 * Rate Refresh Panel
 *
 * Shows:
 * - Staleness indicator: when each source was last successfully fetched
 * - Fetch errors with visible warnings
 * - Pending rate rows with current vs fetched values
 * - Per-row Accept / Dismiss buttons + Accept All / Dismiss All
 *
 * NEVER auto-saves. All changes require explicit user confirmation.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ExternalLink,
  CheckCheck,
  X,
} from "lucide-react";

const RATE_FIELD_LABELS: Record<string, string> = {
  mmfYield: "MMF Effective Annual Yield",
  tbill91Rate: "T-Bill 91-Day Rate",
  tbill182Rate: "T-Bill 182-Day Rate",
  tbill364Rate: "T-Bill 364-Day Rate",
  ifbCouponRate: "IFB Coupon Rate",
  fxdCouponRate: "FXD Coupon Rate (gross)",
  withholdingTax: "Withholding Tax Rate",
};

const SOURCE_LABELS: Record<string, string> = {
  cbk: "CBK (Central Bank of Kenya)",
  sanlam: "SanlamAllianz",
};

function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = Date.now() - d.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  if (diffHours < 1) return "less than 1 hour ago";
  if (diffHours < 24) return `${Math.floor(diffHours)} hour${Math.floor(diffHours) !== 1 ? "s" : ""} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays !== 1 ? "s" : ""} ago`;
}

function getDeltaColor(fetched: number, stored: number): string {
  const delta = fetched - stored;
  if (Math.abs(delta) < 0.001) return "text-muted-foreground";
  return delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400";
}

function formatDelta(fetched: number, stored: number): string {
  const delta = fetched - stored;
  if (Math.abs(delta) < 0.001) return "no change";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(4)}%`;
}

export function RateRefreshPanel() {
  const utils = trpc.useUtils();
  const [isFetching, setIsFetching] = useState(false);

  const { data: pending = [], isLoading: pendingLoading } = trpc.rateRefresh.listPending.useQuery();
  const { data: fetchStatus = [] } = trpc.rateRefresh.fetchStatus.useQuery();

  const triggerFetch = trpc.rateRefresh.triggerFetch.useMutation({
    onSuccess: (data) => {
      utils.rateRefresh.listPending.invalidate();
      utils.rateRefresh.fetchStatus.invalidate();
      if (data.inserted > 0) {
        toast.success(`Fetched ${data.inserted} rate${data.inserted !== 1 ? "s" : ""} for review`);
      } else if (data.errors && data.errors.length > 0) {
        toast.error(`Fetch failed: ${data.errors.join("; ")}`);
      } else {
        toast.info("No new rates could be parsed from the sources");
      }
      setIsFetching(false);
    },
    onError: (err) => {
      toast.error(`Fetch error: ${err.message}`);
      setIsFetching(false);
    },
  });

  const acceptOne = trpc.rateRefresh.acceptOne.useMutation({
    onSuccess: () => {
      utils.rateRefresh.listPending.invalidate();
      utils.settings.get.invalidate();
      toast.success("Rate accepted and saved");
    },
    onError: (err) => toast.error(`Failed to accept: ${err.message}`),
  });

  const acceptAll = trpc.rateRefresh.acceptAll.useMutation({
    onSuccess: (data) => {
      utils.rateRefresh.listPending.invalidate();
      utils.settings.get.invalidate();
      toast.success(`Accepted ${data.accepted} rate${data.accepted !== 1 ? "s" : ""}`);
    },
    onError: (err) => toast.error(`Failed to accept all: ${err.message}`),
  });

  const dismissOne = trpc.rateRefresh.dismissOne.useMutation({
    onSuccess: () => utils.rateRefresh.listPending.invalidate(),
    onError: (err) => toast.error(`Failed to dismiss: ${err.message}`),
  });

  const dismissAll = trpc.rateRefresh.dismissAll.useMutation({
    onSuccess: () => {
      utils.rateRefresh.listPending.invalidate();
      toast.info("All pending rates dismissed");
    },
    onError: (err) => toast.error(`Failed to dismiss all: ${err.message}`),
  });

  const handleTrigger = () => {
    setIsFetching(true);
    triggerFetch.mutate();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5" />
              Live Rate Refresh
            </CardTitle>
            <CardDescription className="mt-1">
              Fetch current rates from CBK and SanlamAllianz. Fetched values are shown for your
              review — nothing is saved until you click Accept.
            </CardDescription>
          </div>
          <Button
            onClick={handleTrigger}
            disabled={isFetching || triggerFetch.isPending}
            size="sm"
            className="shrink-0"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            {isFetching ? "Fetching…" : "Refresh Rates"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Staleness indicators */}
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-3">Last fetch status</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {(["cbk", "sanlam"] as const).map((source) => {
              const status = fetchStatus.find((s) => s.source === source);
              return (
                <div
                  key={source}
                  className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30"
                >
                  {status ? (
                    status.success ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-rose-500 shrink-0" />
                    )
                  ) : (
                    <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{SOURCE_LABELS[source]}</p>
                    {status ? (
                      <p className="text-xs text-muted-foreground">
                        {status.success
                          ? `Last fetched ${formatRelativeTime(status.fetchedAt)}`
                          : `Failed ${formatRelativeTime(status.fetchedAt)}: ${status.errorMessage}`}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Never fetched</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Publication cadence note */}
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            <strong>Publication cadence:</strong> CBK publishes T-bill results weekly (after Tuesday
            auctions) and bond rates monthly. SanlamAllianz updates their fund fact sheet monthly.
            A daily check will often return the same number — this is expected.
          </p>
        </div>

        <Separator />

        {/* Pending rates */}
        {pendingLoading ? (
          <div className="text-sm text-muted-foreground py-4 text-center">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            No pending rates. Click "Refresh Rates" to fetch the latest values.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                {pending.length} rate{pending.length !== 1 ? "s" : ""} awaiting confirmation
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => dismissAll.mutate()}
                  disabled={dismissAll.isPending}
                >
                  <X className="h-3.5 w-3.5 mr-1.5" />
                  Dismiss All
                </Button>
                <Button
                  size="sm"
                  onClick={() => acceptAll.mutate()}
                  disabled={acceptAll.isPending}
                >
                  <CheckCheck className="h-3.5 w-3.5 mr-1.5" />
                  Accept All
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {pending.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-3 rounded-lg border p-3 bg-card"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {RATE_FIELD_LABELS[row.rateField] ?? row.rateField}
                      </span>
                      {row.cadenceNote && (
                        <Badge variant="secondary" className="text-xs font-normal">
                          {row.cadenceNote}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-muted-foreground">
                        Stored: <strong>{row.storedValue.toFixed(4)}%</strong>
                      </span>
                      <span className="text-xs">→</span>
                      <span className="text-xs font-semibold">
                        Fetched: {row.fetchedValue.toFixed(4)}%
                      </span>
                      <span className={`text-xs font-medium ${getDeltaColor(row.fetchedValue, row.storedValue)}`}>
                        ({formatDelta(row.fetchedValue, row.storedValue)})
                      </span>
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      <span className="text-xs text-muted-foreground truncate max-w-xs">
                        {row.sourceLabel}
                      </span>
                      <a
                        href={row.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => dismissOne.mutate({ id: row.id })}
                      disabled={dismissOne.isPending}
                      className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        acceptOne.mutate({
                          id: row.id,
                          rateField: row.rateField,
                          value: row.fetchedValue,
                        })
                      }
                      disabled={acceptOne.isPending}
                      className="h-8"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                      Accept
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
