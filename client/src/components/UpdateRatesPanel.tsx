/**
 * UpdateRatesPanel
 *
 * Replaces the old auto-scraper panel with a fully manual flow:
 *  1. Shows editable source URL fields for CBK and SanlamAllianz.
 *  2. Each URL opens in a new tab so the user can read the current rate.
 *  3. User types the new rates into the input fields and clicks "Save Rates".
 *  4. On save, writes a rate_history snapshot (via rateUpdate.save) and updates
 *     ratesLastUpdatedAt so the staleness indicator stays accurate.
 *  5. Staleness indicator shows how long ago rates were last updated.
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ExternalLink,
  Clock,
  Save,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Pencil,
} from "lucide-react";

// ─── Staleness helpers ────────────────────────────────────────────────────────

function formatStaleness(updatedAt: Date | string | null | undefined): {
  label: string;
  isStale: boolean;
  isVeryStale: boolean;
} {
  if (!updatedAt) return { label: "Never updated", isStale: true, isVeryStale: true };
  const ms = Date.now() - new Date(updatedAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000);

  let label: string;
  if (minutes < 2) label = "Just now";
  else if (minutes < 60) label = `${minutes} minutes ago`;
  else if (hours < 24) label = `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  else label = `${days} day${days !== 1 ? "s" : ""} ago`;

  return {
    label,
    isStale: days >= 7,
    isVeryStale: days >= 30,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function UpdateRatesPanel() {
  const utils = trpc.useUtils();
  const { data: settings, isLoading } = trpc.settings.get.useQuery();

  // ── Local form state ──────────────────────────────────────────────────────
  const [mmfYield, setMmfYield] = useState("");
  const [tbill91Rate, setTbill91Rate] = useState("");
  const [tbill182Rate, setTbill182Rate] = useState("");
  const [tbill364Rate, setTbill364Rate] = useState("");
  const [ifbCouponRate, setIfbCouponRate] = useState("");
  const [fxdCouponRate, setFxdCouponRate] = useState("");
  const [withholdingTax, setWithholdingTax] = useState("");
  const [cbkSourceUrl, setCbkSourceUrl] = useState("");
  const [sanlamSourceUrl, setSanlamSourceUrl] = useState("");
  const [changeNote, setChangeNote] = useState("");

  // UI state
  const [editingUrls, setEditingUrls] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Seed form when settings load
  useEffect(() => {
    if (!settings) return;
    setMmfYield(String(settings.mmfYield ?? "8.78"));
    setTbill91Rate(String(settings.tbill91Rate ?? "8.8206"));
    setTbill182Rate(String(settings.tbill182Rate ?? "8.7782"));
    setTbill364Rate(String(settings.tbill364Rate ?? "8.9746"));
    setIfbCouponRate(String(settings.ifbCouponRate ?? "12.5"));
    setFxdCouponRate(String(settings.fxdCouponRate ?? "12.35"));
    setWithholdingTax(String(settings.withholdingTax ?? "15"));
    setCbkSourceUrl(
      settings.cbkSourceUrl ||
        "https://www.centralbank.go.ke/bills-bonds/treasury-bills/"
    );
    setSanlamSourceUrl(
      settings.sanlamSourceUrl ||
        "https://www.sanlamallianz.co.ke/products/savings-and-investments/money-market-fund/"
    );
  }, [settings]);

  // ── Mutations ─────────────────────────────────────────────────────────────
  const saveRates = trpc.rateUpdate.save.useMutation({
    onSuccess: () => {
      toast.success("Rates saved and history snapshot recorded.");
      setChangeNote("");
      utils.settings.get.invalidate();
      utils.rateHistory.invalidate();
      utils.projection.invalidate();
    },
    onError: (err) => toast.error(`Failed to save rates: ${err.message}`),
  });

  const saveUrls = trpc.rateUpdate.saveSourceUrls.useMutation({
    onSuccess: () => {
      toast.success("Source URLs updated.");
      setEditingUrls(false);
      utils.settings.get.invalidate();
    },
    onError: (err) => toast.error(`Failed to save URLs: ${err.message}`),
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const parseRate = (v: string) => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  const handleSaveRates = () => {
    const rates = {
      mmfYield: parseRate(mmfYield),
      tbill91Rate: parseRate(tbill91Rate),
      tbill182Rate: parseRate(tbill182Rate),
      tbill364Rate: parseRate(tbill364Rate),
      ifbCouponRate: parseRate(ifbCouponRate),
      fxdCouponRate: parseRate(fxdCouponRate),
      withholdingTax: parseRate(withholdingTax),
    };

    for (const [key, val] of Object.entries(rates)) {
      if (val === null) {
        toast.error(`Invalid value for ${key}`);
        return;
      }
    }

    // Validate URLs
    try {
      new URL(cbkSourceUrl);
      new URL(sanlamSourceUrl);
    } catch {
      toast.error("One or more source URLs are invalid.");
      return;
    }

    saveRates.mutate({
      mmfYield: rates.mmfYield!,
      tbill91Rate: rates.tbill91Rate!,
      tbill182Rate: rates.tbill182Rate!,
      tbill364Rate: rates.tbill364Rate!,
      ifbCouponRate: rates.ifbCouponRate!,
      fxdCouponRate: rates.fxdCouponRate!,
      withholdingTax: rates.withholdingTax!,
      cbkSourceUrl,
      sanlamSourceUrl,
      changeNote: changeNote.trim() || undefined,
    });
  };

  const handleSaveUrls = () => {
    try {
      new URL(cbkSourceUrl);
      new URL(sanlamSourceUrl);
    } catch {
      toast.error("One or more source URLs are invalid.");
      return;
    }
    saveUrls.mutate({ cbkSourceUrl, sanlamSourceUrl });
  };

  // ── Staleness ─────────────────────────────────────────────────────────────
  const staleness = formatStaleness(settings?.ratesLastUpdatedAt);

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-base font-semibold text-amber-300">
              Update Rates
            </CardTitle>
            {/* Staleness badge */}
            <Badge
              variant="outline"
              className={
                staleness.isVeryStale
                  ? "border-red-500/50 text-red-400"
                  : staleness.isStale
                    ? "border-amber-500/50 text-amber-400"
                    : "border-emerald-500/50 text-emerald-400"
              }
            >
              {staleness.isVeryStale ? (
                <AlertTriangle className="mr-1 h-3 w-3" />
              ) : staleness.isStale ? (
                <Clock className="mr-1 h-3 w-3" />
              ) : (
                <CheckCircle2 className="mr-1 h-3 w-3" />
              )}
              {staleness.label}
            </Badge>
          </div>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Open the official source, read the current rate, type it in, and click
          Save. Rates are never fetched automatically.
        </p>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-6 pt-0">
          {/* ── Source URLs ─────────────────────────────────────────────── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Official Sources
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingUrls((v) => !v);
                }}
              >
                <Pencil className="mr-1 h-3 w-3" />
                {editingUrls ? "Cancel" : "Edit URLs"}
              </Button>
            </div>

            {/* CBK */}
            <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">CBK Treasury Bills</p>
                  <p className="text-xs text-muted-foreground">
                    91-day, 182-day, 364-day auction results
                  </p>
                </div>
                <a
                  href={cbkSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                    Open <ExternalLink className="h-3 w-3" />
                  </Button>
                </a>
              </div>
              {editingUrls && (
                <Input
                  value={cbkSourceUrl}
                  onChange={(e) => setCbkSourceUrl(e.target.value)}
                  placeholder="https://www.centralbank.go.ke/..."
                  className="h-8 text-xs font-mono"
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>

            {/* SanlamAllianz */}
            <div className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">SanlamAllianz MMF</p>
                  <p className="text-xs text-muted-foreground">
                    Effective annual yield (gross, before WHT)
                  </p>
                </div>
                <a
                  href={sanlamSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">
                    Open <ExternalLink className="h-3 w-3" />
                  </Button>
                </a>
              </div>
              {editingUrls && (
                <Input
                  value={sanlamSourceUrl}
                  onChange={(e) => setSanlamSourceUrl(e.target.value)}
                  placeholder="https://www.sanlamallianz.co.ke/..."
                  className="h-8 text-xs font-mono"
                  onClick={(e) => e.stopPropagation()}
                />
              )}
            </div>

            {editingUrls && (
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={(e) => {
                  e.stopPropagation();
                  handleSaveUrls();
                }}
                disabled={saveUrls.isPending}
              >
                {saveUrls.isPending ? "Saving…" : "Save URLs Only"}
              </Button>
            )}
          </div>

          <Separator />

          {/* ── Rate Entry Fields ────────────────────────────────────────── */}
          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Enter New Rates (% per annum, gross before WHT)
            </p>

            {/* MMF */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">MMF Yield (SanlamAllianz)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={mmfYield}
                    onChange={(e) => setMmfYield(e.target.value)}
                    className="h-8 text-sm pr-8"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Withholding Tax</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={withholdingTax}
                    onChange={(e) => setWithholdingTax(e.target.value)}
                    className="h-8 text-sm pr-8"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
            </div>

            {/* T-Bills */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "T-Bill 91d", value: tbill91Rate, setter: setTbill91Rate },
                { label: "T-Bill 182d", value: tbill182Rate, setter: setTbill182Rate },
                { label: "T-Bill 364d", value: tbill364Rate, setter: setTbill364Rate },
              ].map(({ label, value, setter }) => (
                <div key={label} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={value}
                      onChange={(e) => setter(e.target.value)}
                      className="h-8 text-sm pr-8"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      %
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Bonds */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">IFB Coupon Rate</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={ifbCouponRate}
                    onChange={(e) => setIfbCouponRate(e.target.value)}
                    className="h-8 text-sm pr-8"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">FXD Coupon Rate</Label>
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={fxdCouponRate}
                    onChange={(e) => setFxdCouponRate(e.target.value)}
                    className="h-8 text-sm pr-8"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
              </div>
            </div>

            {/* Optional change note */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Change note (optional — e.g. "CBK auction 19 Jun 2026")
              </Label>
              <Input
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                placeholder="e.g. CBK auction 19 Jun 2026"
                className="h-8 text-xs"
                maxLength={200}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          </div>

          <Button
            className="w-full"
            onClick={(e) => {
              e.stopPropagation();
              handleSaveRates();
            }}
            disabled={saveRates.isPending}
          >
            <Save className="mr-2 h-4 w-4" />
            {saveRates.isPending ? "Saving…" : "Save Rates & Record History"}
          </Button>

          <p className="text-xs text-muted-foreground text-center">
            Saving writes a rate history snapshot. Past months already recorded
            will not be retroactively changed.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
