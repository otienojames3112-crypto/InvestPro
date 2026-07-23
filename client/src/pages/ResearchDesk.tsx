import { useState, useEffect } from "react";
import { useSearchParams } from "wouter";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  Inbox,
  ClipboardCheck,
  GitCompareArrows,
  Sparkles,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Clock,
  AlertTriangle,
  ShieldCheck,
  ExternalLink,
  Bot,
  PencilLine,
  ListChecks,
} from "lucide-react";
import { InfoHint } from "@/components/InfoHint";
import { ASSET_PROFILES } from "@shared/assetModel";
import type { AssetClass } from "@shared/assetModel";
import {
  promotionTargetForAssetClass,
  type PromotionTarget,
  catalogueForAssetClass,
  catalogueLabel,
  type ReferenceCatalogue,
  bankInstrumentTypeLabel,
  cbkSecurityTypeLabel,
  cbkTaxExemptLabel,
  cbkNetYieldAfterWht,
} from "@shared/researchPipeline";
import {
  resolveContractCatalogueForUpdate,
  resolveApprovalFigureLabel,
  isInternalRoutingFigureKey,
  getCatalogueFieldContract,
  projectFindingToContractDisplayRows,
  type CatalogueKey,
  type MarketAssetSubtype,
} from "@shared/catalogueFieldContracts";
import { useLocation } from "wouter";
import { formatRelativeTime } from "@/lib/format";
import { formatUtcYmd } from "@/lib/format";
import { looksLikeOwnAppUrl, displayContractRowValue } from "@/lib/format";
import AiIntake from "./AiIntake";
import AiReview from "./AiReview";
import SourceConflicts from "./SourceConflicts";
import AskAI from "./AskAI";
import RecentlyApproved from "./RecentlyApproved";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { CatalogueSourceReviewButton, type CatalogueKind } from "@/components/CatalogueSourceReview";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Plus } from "lucide-react";

/** Human label for an asset class, falling back to the raw class. */
function classLabel(ac: string): string {
  const p = (ASSET_PROFILES as Record<string, { label?: string }>)[ac];
  return p?.label ?? ac;
}

/** Which live catalogue an approval promotes into, in plain words. */
const TARGET_LABELS: Record<PromotionTarget, string> = {
  mmf: "MMF Market",
  bank: "Bank Product Catalogue",
  opportunity: "Securities / Market Assets catalogue",
};

const ORIGIN_META: Record<string, { label: string; icon: typeof Bot; className: string }> = {
  ai: { label: "AI-extracted", icon: Bot, className: "bg-violet-500/10 text-violet-600 border-violet-500/20" },
  manual: { label: "Manual entry", icon: PencilLine, className: "bg-sky-500/10 text-sky-600 border-sky-500/20" },
  scrape: { label: "Automated source", icon: RefreshCw, className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
};

/* ── Round 98: Diff table for PendingQueue ─────────────────────────────────── */

function PendingDiffTable({
  figures,
  contract,
}: {
  figures: Record<string, unknown> | null | undefined;
  /** Slice 9b — the active catalogue/subtype contract for this update, if
   *  resolved (see resolveContractCatalogueForUpdate). Used ONLY to resolve a
   *  clean display label and to hide internal routing keys — never affects
   *  what's compared or which rows exist otherwise. */
  contract?: { catalogue: CatalogueKey; subtype?: MarketAssetSubtype };
}) {
  if (!figures) return null;
  const proposalType = figures._proposalType as string | undefined;
  if (!proposalType || proposalType === "create") return null;

  let changedFields: string[] = [];
  let currentValues: { field: string; value: string }[] = [];
  try {
    const cf = figures._changedFields;
    changedFields = typeof cf === "string" ? JSON.parse(cf) : Array.isArray(cf) ? cf : [];
    const cv = figures._currentValues;
    currentValues = typeof cv === "string" ? JSON.parse(cv) : Array.isArray(cv) ? cv : [];
  } catch { /* ignore */ }

  if (changedFields.length === 0) return null;

  // Slice 9b — hide internal routing keys (e.g. SACCO's assetType) from the
  // diff table the same way they're hidden from the flat figures list below.
  const visibleChangedFields = changedFields.filter(
    (field) => !isInternalRoutingFigureKey(contract?.catalogue, contract?.subtype, field),
  );
  if (visibleChangedFields.length === 0) return null;

  const currentMap = new Map(currentValues.map((c) => [c.field, c.value]));
  const matchedRow = figures._matchedCurrentRow as string | undefined;
  const impactNote = figures._impactNote as string | undefined;
  const isStale = proposalType === "stale" || figures._staleFlag === "true";

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {isStale ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        ) : (
          <GitCompareArrows className="w-3.5 h-3.5 text-blue-500" />
        )}
        <span>
          {isStale ? "Stale row" : "Changes vs current"}
          {matchedRow && <span className="text-foreground ml-1">— {matchedRow}</span>}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium py-1 pr-3">Field</th>
              <th className="text-left font-medium py-1 pr-3">Current</th>
              <th className="text-left font-medium py-1">Proposed</th>
            </tr>
          </thead>
          <tbody>
            {visibleChangedFields.map((field) => {
              const current = currentMap.get(field) ?? "—";
              const proposed = figures[field];
              const proposedStr = proposed === undefined || proposed === null ? "—" : String(proposed);
              // Slice 9b — `field` here is a raw AI-extraction-schema field
              // name (e.g. "effectiveAnnualRate", "shareCapitalDividendRate"),
              // not the contract's canonical key, so this checks aliases too.
              const label = resolveApprovalFigureLabel(contract?.catalogue, contract?.subtype, field, field);
              return (
                <tr key={field} className="border-t border-border/50">
                  <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{label}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-red-600/80 line-through">{current}</td>
                  <td className="py-1.5 tabular-nums font-medium text-emerald-600">{proposedStr}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {impactNote && (
        <p className="text-[11px] text-muted-foreground italic mt-1">{impactNote}</p>
      )}
    </div>
  );
}

function fmtFigures(
  figures: Record<string, unknown> | null | undefined,
  /** Slice 9b — the active catalogue/subtype contract for this update, if
   *  resolved (see resolveContractCatalogueForUpdate). Used ONLY to resolve a
   *  clean display label and to hide internal routing keys — never affects
   *  which figures exist or what gets approved/promoted. */
  contract?: { catalogue: CatalogueKey; subtype?: MarketAssetSubtype },
): { key: string; label: string; value: string }[] {
  if (!figures) return [];
  // Pre-existing fallback label map, kept exactly as before (Slice 9b doesn't
  // remove it — it's still the fallback for any field the active contract
  // doesn't recognize, e.g. a legacy/manual figures bag outside the 7
  // contracts, or when no contract could be resolved at all).
  const LABELS: Record<string, string> = {
    yieldPct: "Yield %",
    lastPrice: "Price",
    trailingReturnPct: "Trailing 1Y %",
    tenorYears: "Tenor (yrs)",
    maturityDate: "Maturity",
    expenseRatioPct: "Fee %",
    ear: "EAR %",
    grossYield: "Gross yield %",
    managementFee: "Mgmt fee %",
    minInvestment: "Min amount",
    minAmount: "Min amount",
    indicativeRate: "Indicative rate %",
    typicalTenor: "Typical tenor",
    instrumentType: "Product type",
  };
  return Object.entries(figures)
    .filter(
      ([k, v]) =>
        !k.startsWith("_") &&
        v !== undefined &&
        v !== null &&
        v !== "" &&
        // Slice 9b — internal routing signals (SACCO's assetType) are never
        // shown as if they were a real approval figure.
        !isInternalRoutingFigureKey(contract?.catalogue, contract?.subtype, k),
    )
    .map(([k, v]) => {
      const raw = String(v);
      // Stage 10b-1b — Bank's productType/instrumentType figure is still the
      // raw enum ("fixed_deposit") until promotion canonicalizes it; shown
      // through the same label map BankInstruments.tsx's own catalogue table
      // already uses, so a manager reviewing a pending Bank finding never
      // sees a raw underscored value.
      // Stage 10b-2 — same fix for CBK's securityType (raw enum, e.g.
      // "treasury_bill") and taxExempt (raw "true"/"false" boolean-ish string).
      const value =
        contract?.catalogue === "bank" && (k === "productType" || k === "instrumentType")
          ? (bankInstrumentTypeLabel(raw) ?? raw)
          : contract?.catalogue === "cbk" && k === "securityType"
            ? (cbkSecurityTypeLabel(raw) ?? raw)
            : contract?.catalogue === "cbk" && k === "taxExempt"
              ? (cbkTaxExemptLabel(raw) ?? raw)
              : raw;
      return {
        key: k,
        label: resolveApprovalFigureLabel(contract?.catalogue, contract?.subtype, k, LABELS[k]),
        value,
      };
    });
}

/* ── Digest header ─────────────────────────────────────────────────────────── */

function DigestHeader() {
  const { data, isLoading } = trpc.researchPipeline.digest.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  if (isLoading) {
    return <Skeleton className="h-24 w-full rounded-xl" />;
  }
  const d = data;
  const tiles = [
    {
      label: "Changes awaiting review",
      value: d?.pendingUpdates ?? 0,
      icon: Inbox,
      tone: (d?.pendingUpdates ?? 0) > 0 ? "text-amber-600" : "text-muted-foreground",
    },
    {
      label: "Sources due for a refresh",
      value: d?.sourcesDue ?? 0,
      icon: Clock,
      tone: (d?.sourcesDue ?? 0) > 0 ? "text-amber-600" : "text-muted-foreground",
    },
    {
      label: "Open source conflicts",
      value: d?.openConflicts ?? 0,
      icon: GitCompareArrows,
      tone: (d?.openConflicts ?? 0) > 0 ? "text-rose-600" : "text-muted-foreground",
    },
  ];
  return (
    <Card className="border-primary/15 bg-gradient-to-br from-primary/[0.04] to-transparent">
      <CardContent className="py-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <ListChecks className="w-4 h-4 text-primary" /> Research Desk digest
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              A daily snapshot of what needs your attention. Nothing changes the live catalogues until you approve it.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-6">
            {tiles.map((t) => (
              <div key={t.label} className="text-center">
                <div className={`text-2xl font-bold tabular-nums ${t.tone}`}>{t.value}</div>
                <div className="text-[11px] text-muted-foreground leading-tight mt-1 max-w-[7.5rem] mx-auto flex items-center justify-center gap-1">
                  <t.icon className="w-3 h-3 shrink-0" /> {t.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Pending-count badge for the queue tab ─────────────────────────────────── */

function PendingBadge() {
  const { data } = trpc.researchPipeline.pendingCount.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const n = data?.count ?? 0;
  if (n <= 0) return null;
  return (
    <Badge className="ml-1.5 h-4 min-w-4 px-1 text-[10px] bg-amber-500/15 text-amber-700 border-amber-500/30" variant="outline">
      {n}
    </Badge>
  );
}

/* ── Approve confirmation dialog (impact + gate + manager override) ─────────── */

function ApproveDialog({
  updateId,
  portfolioId,
  managerValue,
  setManagerValue,
  onClose,
  onApprove,
  onEditFields,
  busy,
}: {
  updateId: number | null;
  portfolioId: number | null;
  managerValue: string;
  setManagerValue: (v: string) => void;
  onClose: () => void;
  onApprove: (overrideGate: boolean) => void;
  /** Stage 10a — jump to the multi-field edit dialog for this same update. */
  onEditFields: () => void;
  busy: boolean;
}) {
  const { data, isLoading } = trpc.researchPipeline.impactOf.useQuery(
    updateId != null ? { id: updateId, portfolioId: portfolioId ?? undefined } : (undefined as never),
    { enabled: updateId != null, refetchOnWindowFocus: false },
  );
  // Stage 10a — the full established catalogue field set for this update, the
  // SAME reusable pattern as the pending-queue card and EditCatalogueFieldsDialog,
  // so what the manager reviews here before approving is never a subset.
  const { data: updateData } = trpc.researchPipeline.getUpdate.useQuery(
    updateId != null ? { id: updateId } : (undefined as never),
    { enabled: updateId != null, refetchOnWindowFocus: false },
  );
  const update = updateData?.update;
  const fullContract =
    data?.catalogue && update
      ? data.catalogue === "market_asset"
        ? null // market-asset subtype resolution isn't available from impactOf's return; shown on the pending card instead
        : getCatalogueFieldContract(data.catalogue)
      : null;
  const contractRows =
    fullContract && update
      ? projectFindingToContractDisplayRows(fullContract, {
          instrumentName: update.name,
          issuer: update.issuer,
          sourceLabel: update.source,
          sourceUrl: update.sourceUrl,
          sourceAsOf: update.asOf,
          extractedFields: update.figures as Record<string, unknown> | null,
        })
      : [];

  const gate = data?.gate;
  const impact = data?.impact;
  const blocked = gate && !gate.ok;
  const missing = gate?.missing ?? [];
  const overrideSatisfied = managerValue.trim() !== "";

  return (
    <Dialog open={updateId != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" /> Approve this change?
          </DialogTitle>
          <DialogDescription>
            Approving promotes this fact into the live catalogue and records it in the audit trail. Reference facts never
            restate your existing balances.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-24 w-full rounded-lg" />
        ) : (
          <div className="space-y-3">
            {impact && (
              <div
                className={`rounded-lg border p-3 text-sm flex items-start gap-2 ${
                  impact.affectsProjection
                    ? "border-amber-500/30 bg-amber-500/[0.06] text-amber-800"
                    : "border-emerald-500/20 bg-emerald-500/[0.05] text-emerald-800"
                }`}
              >
                {impact.affectsProjection ? (
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                ) : (
                  <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                )}
                <span>{impact.summary}</span>
              </div>
            )}

            {blocked && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/[0.06] p-3 text-sm space-y-2">
                <p className="flex items-start gap-2 text-amber-800">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{gate?.reason}</span>
                </p>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    Vouch a value for {missing.join(", ")} (you take responsibility for the figure)
                  </Label>
                  <Input
                    placeholder="e.g. 15.98"
                    value={managerValue}
                    onChange={(e) => setManagerValue(e.target.value)}
                    className="bg-background"
                  />
                </div>
              </div>
            )}

            {contractRows.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <ListChecks className="w-3.5 h-3.5" /> Catalogue fields
                  </div>
                  {(data?.catalogue === "mmf" || data?.catalogue === "bank" || data?.catalogue === "cbk" || data?.catalogue === "market_asset") && (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onEditFields}>
                      <PencilLine className="w-3 h-3 mr-1" /> Edit
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                  {contractRows.map((row) => {
                    const raw = displayContractRowValue(row);
                    const isCbk = data?.catalogue === "cbk";
                    // Stage 10b-1b/10b-2 — same Bank productType / CBK securityType /
                    // CBK taxExempt label fix as fmtFigures above.
                    // Stage 10b-2b — CBK's netYieldAfterWht is a "computed"
                    // contract field (never a real stored value, always null
                    // from the projection) — compute it here from the SAME
                    // yieldPct/whtRule/taxExempt sibling rows the live
                    // catalogue table already uses, instead of leaving it to
                    // fall through to the generic "Missing" warning below.
                    const displayValue =
                      data?.catalogue === "bank" && row.key === "productType"
                        ? (bankInstrumentTypeLabel(raw) ?? raw)
                        : isCbk && row.key === "securityType"
                          ? (cbkSecurityTypeLabel(raw) ?? raw)
                          : isCbk && row.key === "taxExempt"
                            ? (cbkTaxExemptLabel(raw) ?? raw)
                            : isCbk && row.key === "netYieldAfterWht"
                              ? (() => {
                                  const y = contractRows.find((r) => r.key === "yieldPct")?.value ?? null;
                                  const w = contractRows.find((r) => r.key === "whtRule")?.value ?? null;
                                  const t = contractRows.find((r) => r.key === "taxExempt")?.value ?? null;
                                  const net = cbkNetYieldAfterWht(y, w, t);
                                  return net === null ? null : `${net.toFixed(2)}%`;
                                })()
                              : raw;
                    return (
                      <div key={row.key} className="text-xs">
                        <span className="text-muted-foreground">{row.label}: </span>
                        {displayValue != null ? (
                          <span className="font-medium">{displayValue}</span>
                        ) : isCbk && row.key === "netYieldAfterWht" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="italic text-amber-600 dark:text-amber-400">Missing</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" className="bg-background" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {blocked && !overrideSatisfied ? (
            <Button variant="secondary" onClick={() => onApprove(true)} disabled={busy}>
              {busy ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />}
              Approve anyway (override)
            </Button>
          ) : (
            <Button onClick={() => onApprove(false)} disabled={busy}>
              {busy ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />}
              Approve &amp; promote
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Multi-field catalogue edit (Stage 10a) ──────────────────────────────────
 * Lets a manager correct MULTIPLE MMF catalogue fields on a PENDING update in
 * one place before drafting/approving — closes the gap where Correct Figure
 * (AskAI.tsx) only versions ONE field on a FINDING and then dead-ends, with no
 * path back to correct a second field without starting over. Built from the
 * same catalogue contract every other display layer already uses, so the
 * field list/order/labels can never drift from what the review queue and
 * approval modal show. Edits the PENDING update in place (via
 * updatePendingFields) — distinct from Correct Figure, which versions an
 * already-drafted finding.
 * MMF + Bank + CBK (Stage 10b-1 / 10b-2) — the button that opens this is
 * gated to catalogue === "mmf" || "bank" || "cbk". Stage 10b-3 extended it
 * to Market Assets (Equity/REIT/Offshore fund/SACCO) — unlike the other
 * three, "market_asset" alone isn't enough to resolve a contract; the
 * SUBTYPE (equity/reit/offshore_fund/sacco) is needed too, resolved the SAME
 * way the pending-card/approval-modal already do (resolveContractCatalogueForUpdate).
 */
function EditCatalogueFieldsDialog({ updateId, onClose }: { updateId: number | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.researchPipeline.getUpdate.useQuery(
    updateId != null ? { id: updateId } : (undefined as never),
    { enabled: updateId != null, refetchOnWindowFocus: false },
  );
  const update = data?.update;
  const resolved = update
    ? resolveContractCatalogueForUpdate({
        assetClass: update.assetClass as AssetClass,
        figures: update.figures as Record<string, unknown> | null,
        name: update.name,
        issuer: update.issuer,
      })
    : null;
  const catalogue = resolved?.catalogue ?? null;
  const subtype = resolved?.subtype;
  const isSupported =
    catalogue === "mmf" || catalogue === "bank" || catalogue === "cbk" || (catalogue === "market_asset" && subtype !== undefined);
  const contract = isSupported && catalogue ? getCatalogueFieldContract(catalogue, subtype) : null;
  const rows =
    contract && update
      ? projectFindingToContractDisplayRows(contract, {
          instrumentName: update.name,
          issuer: update.issuer,
          sourceLabel: update.source,
          sourceUrl: update.sourceUrl,
          sourceAsOf: update.asOf,
          extractedFields: update.figures as Record<string, unknown> | null,
        })
      : [];
  const editableRows = rows.filter((row) => contract?.fields.find((f) => f.key === row.key)?.managerEditable === true);

  // Stage 10a (MMF) / Stage 10b-1 (Bank) — the canonical contract keys that
  // route to the update's ENVELOPE columns (name/issuer/source/asOf), not the
  // figures bag — mirrors the SAME routing buildPromotionPlan's MMF/Bank
  // branches and ENVELOPE_ROUTED_CONTRACT_KEYS.mmf/.bank
  // (shared/catalogueFieldContracts.ts) already encode, kept local here
  // rather than exported since this dialog is the only UI consumer today.
  // Per-catalogue because the envelope column differs: MMF's "fundName" maps
  // to the update's `name`, but Bank's "bankName" maps to `issuer` (mirrors
  // buildContractRawValueBag's own `bankName: finding.issuer` mapping) —
  // hardcoding one shared table would have silently mis-routed one of them.
  const ENVELOPE_KEYS_BY_CATALOGUE: Record<string, Record<string, "name" | "issuer" | "source" | "asOf" | "currency">> = {
    mmf: {
      fundName: "name",
      fundManager: "issuer",
      sourceLink: "source",
      sourceAsOf: "asOf",
    },
    bank: {
      bankName: "issuer",
      sourceLink: "source",
      sourceAsOf: "asOf",
    },
    // Stage 10b-2 — CBK has no name-equivalent envelope field at all (see
    // ENVELOPE_ROUTED_CONTRACT_KEYS.cbk, shared/catalogueFieldContracts.ts —
    // the contract itself has no "name" field; a security's identity is just
    // its raw instrument name, never a figures-bag key a manager edits here).
    cbk: {
      sourceLink: "source",
      sourceAsOf: "asOf",
    },
    // Stage 10b-3 — Market Assets: one flat map covers all four subtypes
    // since each contract only ever carries ITS OWN identity key (an equity
    // finding's rows never contain "reitName", etc. — no collision risk),
    // mirroring ENVELOPE_ROUTED_CONTRACT_KEYS.market_asset's own flat Set.
    // "currency" is envelope-routed only for offshore fund (the other three
    // don't have a currency contract field at all) — updatePendingFields
    // already supports it.
    market_asset: {
      companyName: "name",
      reitName: "name",
      fundName: "name",
      saccoName: "name",
      fundManager: "issuer",
      currency: "currency",
      sourceLink: "source",
      sourceAsOf: "asOf",
    },
  };
  const envelopeKeys = catalogue ? (ENVELOPE_KEYS_BY_CATALOGUE[catalogue] ?? {}) : {};

  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!update) return;
    const initial: Record<string, string> = {};
    for (const row of editableRows) {
      if (row.key === "sourceAsOf") {
        initial[row.key] = update.asOf ? formatUtcYmd(update.asOf) : "";
      } else if (row.key === "sourceLink") {
        // Stage 10a-2 — never prefill "Source link" with this app's own URL
        // (e.g. a manager pasted the browser's current address bar as a
        // stand-in while testing); fall back to the same "Pasted source
        // text" label the server already uses for an unsourced pasted-text
        // finding (server/aiResearchService.ts's fallbackLabel).
        const origin = typeof window !== "undefined" ? window.location.origin : undefined;
        initial[row.key] = looksLikeOwnAppUrl(row.value, origin) ? "Pasted source text" : (row.value ?? "");
      } else {
        initial[row.key] = row.value ?? "";
      }
    }
    setValues(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [update?.id]);

  const save = trpc.researchPipeline.updatePendingFields.useMutation({
    onSuccess: () => {
      utils.researchPipeline.listUpdates.invalidate();
      utils.researchPipeline.getUpdate.invalidate();
      utils.researchPipeline.impactOf.invalidate();
      toast.success("Fields saved to the pending update.");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  if (updateId == null) return null;

  const handleSave = () => {
    if (updateId == null) return;
    const figures: Record<string, unknown> = {};
    const envelope: { name?: string; issuer?: string; source?: string; asOf?: number; currency?: string } = {};
    for (const row of editableRows) {
      const v = (values[row.key] ?? "").trim();
      if (v === "") continue;
      const envelopeField = envelopeKeys[row.key];
      if (envelopeField === "asOf") {
        const ms = Date.parse(v);
        if (Number.isFinite(ms)) envelope.asOf = ms;
      } else if (envelopeField) {
        envelope[envelopeField] = v;
      } else {
        figures[row.key] = v;
      }
    }
    save.mutate({ id: updateId, ...(Object.keys(figures).length ? { figures } : {}), ...envelope });
  };

  return (
    <Dialog open={updateId != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PencilLine className="w-5 h-5 text-primary" /> Edit catalogue fields
          </DialogTitle>
          <DialogDescription>
            Correct or fill in any of the established {contract?.label ?? ""} fields below. Saved to this pending
            update only — nothing changes in the live catalogue until you approve it.
          </DialogDescription>
        </DialogHeader>
        {isLoading || !update ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : (
          <div className="space-y-3 py-1">
            {editableRows.map((row) => (
              <div key={row.key}>
                <Label className="text-xs">{row.label}</Label>
                <Input
                  type={row.key === "sourceAsOf" ? "date" : "text"}
                  value={values[row.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [row.key]: e.target.value }))}
                  className="bg-background"
                  placeholder="Not on record"
                />
              </div>
            ))}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="bg-background" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={save.isPending || isLoading}>
            {save.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
            Save fields
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Pending update review queue ───────────────────────────────────────────── */

/** Map a reference catalogue to its Reference Catalogues sub-tab id (shared with
 *  RecentlyApproved). Building the deep-link here lets an approval jump straight to
 *  the freshly-published row, which the catalogue page focuses + highlights. */
const CATALOGUE_TAB_ID: Record<ReferenceCatalogue, string> = {
  mmf: "mmf-market",
  bank: "bank-catalogue",
  cbk: "cbk-securities",
  market_asset: "market-assets",
};

function publishedRowHref(catalogue: ReferenceCatalogue, targetRef: string | null): string {
  const params = new URLSearchParams({ tab: "reference-catalogues", cat: CATALOGUE_TAB_ID[catalogue] });
  if (targetRef) params.set("ref", targetRef);
  return `/research?${params.toString()}`;
}

function PendingQueue() {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const { portfolioId } = usePortfolio();
  const { data, isLoading } = trpc.researchPipeline.listUpdates.useQuery({ status: "pending" });
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  // The update currently being approved through the confirmation dialog.
  const [approveId, setApproveId] = useState<number | null>(null);
  const [managerValue, setManagerValue] = useState("");
  // Stage 10a — the update currently open in the multi-field edit dialog.
  const [editFieldsId, setEditFieldsId] = useState<number | null>(null);

  const review = trpc.researchPipeline.review.useMutation({
    onSuccess: (res, vars) => {
      if (vars.approve) {
        if (res.blocked) {
          // A blocked approval is informative, not a failure: the row stays pending.
          toast.warning(
            res.blocked.reason ??
              "This entry is missing a required figure. Add it, or approve again with a manager-vouched value.",
          );
          return;
        }
        // Item 5: name the exact catalogue it was published into, and offer a one-click
        // jump to the freshly-published row (deep-link ?ref= focuses + highlights it).
        // The catalogue is derived from the promoted update's own asset class.
        void vars;
        const promotedAc = res.update?.assetClass as AssetClass | undefined;
        const cat = promotedAc ? catalogueForAssetClass(promotedAc) : null;
        const label = cat ? catalogueLabel(cat) : "the live catalogue";
        if (res.promotedRef && cat) {
          const href = publishedRowHref(cat, res.promotedRef);
          toast.success(`Approved and published to ${label} as \u201c${res.promotedRef}\u201d.`, {
            action: {
              label: "Open published row",
              onClick: () => navigate(href),
            },
          });
        } else {
          toast.success(`Approved and published to ${label}.`);
        }
      } else {
        toast.success("Rejected — no catalogue change made.");
      }
      // Approval-driven invalidation: refresh every surface the promotion can touch.
      utils.researchPipeline.listUpdates.invalidate();
      utils.researchPipeline.pendingCount.invalidate();
      utils.researchPipeline.digest.invalidate();
      utils.researchPipeline.recentlyApproved.invalidate();
      utils.opportunities.list.invalidate();
      utils.opportunities.byRef.invalidate();
      utils.mmfFunds.invalidate();
      utils.bankInstruments.invalidate();
      setRejectId(null);
      setRejectNote("");
      setApproveId(null);
      setManagerValue("");
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  const updates = data?.updates ?? [];
  if (updates.length === 0) {
    return (
      <Empty className="py-14">
        <div className="flex flex-col items-center gap-2 text-center">
          <CheckCircle2 className="w-10 h-10 text-emerald-500/70" />
          <p className="font-medium">The queue is clear.</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            No proposed changes are waiting. When an AI import, an automated source, or a manual entry proposes a
            figure, it lands here for you to approve before it touches any live catalogue.
          </p>
        </div>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Each card is a <strong className="text-foreground">proposed</strong> change to a reference catalogue. Approving
        promotes it into the correct catalogue by its asset class; rejecting leaves everything untouched. This is a
        record of facts against a cited source — it never ranks or recommends anything.
      </p>
      {updates.map((u) => {
        const target = promotionTargetForAssetClass(u.assetClass as AssetClass);
        // Slice 9b — resolve the active catalogue/subtype contract ONCE per
        // update, purely for display-label purposes (see fmtFigures'/
        // PendingDiffTable's own doc comments). Mirrors the SAME resolution
        // reviewResearchUpdate uses at promotion time (Slice 8g-2).
        const contract = resolveContractCatalogueForUpdate({
          assetClass: u.assetClass as AssetClass,
          figures: u.figures as Record<string, unknown> | null,
          name: u.name,
          issuer: u.issuer,
        });
        const figures = fmtFigures(u.figures as Record<string, unknown> | null, contract);
        // Stage 10a — the FULL established catalogue field set (filled AND
        // missing), not just whichever figures happened to be extracted. Reuses
        // the SAME projectFindingToContractDisplayRows AskAI.tsx's finding card
        // already renders correctly — this update-shaped object is adapted into
        // the same structural ProjectableFinding shape that function expects.
        const fullContract =
          contract.catalogue === "market_asset"
            ? contract.subtype
              ? getCatalogueFieldContract("market_asset", contract.subtype)
              : null
            : getCatalogueFieldContract(contract.catalogue);
        const contractRows = fullContract
          ? projectFindingToContractDisplayRows(fullContract, {
              instrumentName: u.name,
              issuer: u.issuer,
              sourceLabel: u.source,
              sourceUrl: u.sourceUrl,
              sourceAsOf: u.asOf,
              extractedFields: u.figures as Record<string, unknown> | null,
            })
          : null;
        const origin = ORIGIN_META[u.origin] ?? ORIGIN_META.manual;
        const OriginIcon = origin.icon;
        const busy = review.isPending && review.variables?.id === u.id;
        return (
          <Card key={u.id} className="overflow-hidden">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                    {u.name}
                    <Badge variant="outline" className="font-normal text-[11px]">
                      {classLabel(u.assetClass)}
                    </Badge>
                    <Badge variant="outline" className={`font-normal text-[11px] ${origin.className}`}>
                      <OriginIcon className="w-3 h-3 mr-1" /> {origin.label}
                    </Badge>
                    {(() => {
                      const fig = u.figures as Record<string, unknown> | null;
                      const pt = fig?._proposalType as string | undefined;
                      const isStale = pt === "stale" || fig?._staleFlag === "true";
                      if (isStale) return (
                        <Badge variant="secondary" className="font-normal text-[11px] bg-amber-500/10 text-amber-600 border-amber-500/20">
                          <AlertTriangle className="w-3 h-3 mr-0.5" /> Stale row
                        </Badge>
                      );
                      if (pt === "update") return (
                        <Badge variant="secondary" className="font-normal text-[11px] bg-blue-500/10 text-blue-600 border-blue-500/20">
                          <GitCompareArrows className="w-3 h-3 mr-0.5" /> Update
                        </Badge>
                      );
                      return (
                        <Badge variant="secondary" className="font-normal text-[11px]">
                          {u.changeKind === "edit" ? "Edits existing" : "New instrument"}
                        </Badge>
                      );
                    })()}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Approving promotes this into <strong className="text-foreground">{TARGET_LABELS[target]}</strong>
                    {u.issuer ? ` · ${u.issuer}` : ""} · {u.currency}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Round 98: Diff table for update/stale proposals */}
              <PendingDiffTable figures={u.figures as Record<string, unknown> | null} contract={contract} />
              {typeof (u.figures as Record<string, unknown> | null)?._correctionReason === "string" && (
                <div className="rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs">
                  <span className="font-medium text-foreground">Correction reason: </span>
                  <span className="text-muted-foreground">
                    {String((u.figures as Record<string, unknown>)._correctionReason)}
                  </span>
                </div>
              )}

              {figures.length > 0 ? (
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  {figures.map((f) => (
                    <div key={f.key} className="text-sm">
                      <span className="text-muted-foreground">{f.label}: </span>
                      <span className="font-medium tabular-nums">{f.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  Identity only — no figures proposed. Approving authors the catalogue row; figures are added and cited
                  afterwards.
                </p>
              )}

              {/* Stage 10a — the full established catalogue field set (filled AND
                  missing), so a manager reviews against the SAME field list the
                  catalogue itself publishes, not just whichever figures extracted. */}
              {contractRows && contractRows.length > 0 && (
                <div className="rounded-md border border-border bg-muted/20 p-3 space-y-1.5">
                  <div className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                    <ListChecks className="w-3.5 h-3.5" /> Catalogue fields
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                    {contractRows.map((row) => {
                      const raw = displayContractRowValue(row);
                      const isCbk = contract.catalogue === "cbk";
                      // Stage 10b-1b/10b-2 — same Bank productType / CBK securityType /
                      // CBK taxExempt label fix as fmtFigures above.
                      // Stage 10b-2b — CBK's netYieldAfterWht computed from
                      // sibling rows, same as the approval modal above.
                      const displayValue =
                        contract.catalogue === "bank" && row.key === "productType"
                          ? (bankInstrumentTypeLabel(raw) ?? raw)
                          : isCbk && row.key === "securityType"
                            ? (cbkSecurityTypeLabel(raw) ?? raw)
                            : isCbk && row.key === "taxExempt"
                              ? (cbkTaxExemptLabel(raw) ?? raw)
                              : isCbk && row.key === "netYieldAfterWht"
                                ? (() => {
                                    const y = contractRows.find((r) => r.key === "yieldPct")?.value ?? null;
                                    const w = contractRows.find((r) => r.key === "whtRule")?.value ?? null;
                                    const t = contractRows.find((r) => r.key === "taxExempt")?.value ?? null;
                                    const net = cbkNetYieldAfterWht(y, w, t);
                                    return net === null ? null : `${net.toFixed(2)}%`;
                                  })()
                                : raw;
                      return (
                      <div key={row.key} className="text-xs">
                        <span className="text-muted-foreground">{row.label}: </span>
                        {displayValue != null ? (
                          <span className="font-medium">{displayValue}</span>
                        ) : isCbk && row.key === "netYieldAfterWht" ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <span className="italic text-amber-600 dark:text-amber-400">Missing</span>
                        )}
                      </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Source: <span className="text-foreground">{u.source}</span>
                </span>
                {u.sourceUrl && (
                  <a
                    href={u.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    open <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {u.asOf && <span>· as of {formatUtcYmd(u.asOf)}</span>}
                {u.createdAt && <span>· proposed {formatRelativeTime(new Date(u.createdAt).getTime())}</span>}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  onClick={() => {
                    setApproveId(u.id);
                    setManagerValue("");
                  }}
                  disabled={review.isPending}
                >
                  {busy && review.variables?.approve ? (
                    <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Review &amp; approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-background"
                  onClick={() => {
                    setRejectId(u.id);
                    setRejectNote("");
                  }}
                  disabled={review.isPending}
                >
                  <XCircle className="w-3.5 h-3.5 mr-1.5" /> Reject
                </Button>
                {/* Stage 10a (MMF) / Stage 10b-1 (Bank) / Stage 10b-2 (CBK) / Stage
                    10b-3 (Market Assets) — see EditCatalogueFieldsDialog's own doc comment. */}
                {fullContract && (contract.catalogue === "mmf" || contract.catalogue === "bank" || contract.catalogue === "cbk" || contract.catalogue === "market_asset") && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-background"
                    onClick={() => setEditFieldsId(u.id)}
                  >
                    <PencilLine className="w-3.5 h-3.5 mr-1.5" /> Edit fields
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <EditCatalogueFieldsDialog
        updateId={editFieldsId}
        onClose={() => setEditFieldsId(null)}
      />

      <ApproveDialog
        updateId={approveId}
        portfolioId={portfolioId}
        managerValue={managerValue}
        setManagerValue={setManagerValue}
        onClose={() => {
          setApproveId(null);
          setManagerValue("");
        }}
        onApprove={(overrideGate) =>
          approveId != null &&
          review.mutate({
            id: approveId,
            approve: true,
            managerValue: managerValue.trim() === "" ? undefined : managerValue.trim(),
            overrideGate,
          })
        }
        onEditFields={() => {
          if (approveId != null) setEditFieldsId(approveId);
          setApproveId(null);
          setManagerValue("");
        }}
        busy={review.isPending}
      />

      <Dialog open={rejectId != null} onOpenChange={(o) => !o && setRejectId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject this proposed change?</DialogTitle>
            <DialogDescription>
              Nothing in the live catalogue changes. The proposal is filed as rejected with your note, so the decision
              stays auditable.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Optional: why are you rejecting this? (e.g. figure doesn't match the source)"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" className="bg-background" onClick={() => setRejectId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                rejectId != null &&
                review.mutate({ id: rejectId, approve: false, reviewNote: rejectNote || undefined })
              }
              disabled={review.isPending}
            >
              Reject change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Source registry + cadence ─────────────────────────────────────────────── */

type SourceRow = {
  key: string;
  label: string;
  feeds: string;
  url: string | null;
  cadenceDays: number;
  notes: string | null;
  active: boolean;
  lastReviewedAt: number | null;
  lastReviewedBy: string | null;
};

const FEED_OPTIONS: { value: string; label: string }[] = [
  { value: "mixed", label: "Mixed / several catalogues" },
  { value: "mmf", label: "MMF market" },
  { value: "bank", label: "Bank products" },
  { value: "opportunity", label: "CBK & market assets" },
];

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
}

function SourceEditor({
  open,
  onOpenChange,
  existing,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  existing: SourceRow | null;
}) {
  const utils = trpc.useUtils();
  const isEdit = existing != null;
  const [label, setLabel] = useState(existing?.label ?? "");
  const [key, setKey] = useState(existing?.key ?? "");
  const [keyTouched, setKeyTouched] = useState(isEdit);
  const [feeds, setFeeds] = useState(existing?.feeds ?? "mixed");
  const [url, setUrl] = useState(existing?.url ?? "");
  const [cadenceDays, setCadenceDays] = useState(String(existing?.cadenceDays ?? 30));
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [active, setActive] = useState(existing?.active ?? true);

  // Keep local state in sync when the dialog is opened for a different row.
  useEffect(() => {
    if (!open) return;
    setLabel(existing?.label ?? "");
    setKey(existing?.key ?? "");
    setKeyTouched(existing != null);
    setFeeds(existing?.feeds ?? "mixed");
    setUrl(existing?.url ?? "");
    setCadenceDays(String(existing?.cadenceDays ?? 30));
    setNotes(existing?.notes ?? "");
    setActive(existing?.active ?? true);
  }, [open, existing]);

  const save = trpc.researchPipeline.upsertSource.useMutation({
    onSuccess: () => {
      toast.success(isEdit ? "Source updated." : "Source registered.");
      utils.researchPipeline.listSources.invalidate();
      utils.researchPipeline.digest.invalidate();
      onOpenChange(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const effectiveKey = keyTouched ? key.trim() : slugify(label);
  const cadenceNum = Number(cadenceDays);
  const urlValid = url.trim() === "" || /^https?:\/\//.test(url.trim());
  const canSave =
    label.trim().length > 0 &&
    effectiveKey.length > 0 &&
    Number.isFinite(cadenceNum) &&
    cadenceNum >= 1 &&
    cadenceNum <= 365 &&
    urlValid &&
    !save.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit source" : "Register a data source"}</DialogTitle>
          <DialogDescription>
            Operational metadata only — a name, where it lives, and how often it should be re-checked. This never stores
            figures and never ranks a source by quality.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input
              placeholder="e.g. CBK weekly T-bill auction results"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Key *</Label>
              <Input
                placeholder="cbk-tbill-auction"
                value={effectiveKey}
                disabled={isEdit}
                onChange={(e) => {
                  setKeyTouched(true);
                  setKey(e.target.value);
                }}
              />
              {isEdit && <p className="text-[11px] text-muted-foreground">The key is fixed once created.</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Feeds which catalogue</Label>
              <Select value={feeds} onValueChange={setFeeds}>
                <SelectTrigger className="bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FEED_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Link (optional)</Label>
              <Input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
              {!urlValid && <p className="text-[11px] text-rose-600">Must start with http:// or https://</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Review cadence (days) *</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={cadenceDays}
                onChange={(e) => setCadenceDays(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes (optional)</Label>
            <Textarea
              rows={2}
              placeholder="What this source covers, quirks, where to look…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-muted-foreground">Inactive sources are kept for history but hidden from the due-list.</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" className="bg-background" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSave}
            onClick={() =>
              save.mutate({
                key: effectiveKey,
                label: label.trim(),
                feeds: feeds as "mmf" | "bank" | "opportunity" | "mixed",
                url: url.trim() === "" ? "" : url.trim(),
                cadenceDays: cadenceNum,
                notes: notes.trim() === "" ? undefined : notes.trim(),
                active,
              })
            }
          >
            {save.isPending ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : null}
            {isEdit ? "Save changes" : "Register source"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A registry source's `feeds` tag maps onto exactly one review catalogue so the
 *  row-level "Review source with AI" opens the right governed comparison. A
 *  "mixed" source has no single catalogue, so we omit the shortcut there (the
 *  manager still uses the per-catalogue buttons on each catalogue page). */
function catalogueForFeed(feeds: string): CatalogueKind | null {
  switch (feeds) {
    case "mmf":
      return "mmf";
    case "bank":
      return "bank";
    case "opportunity":
      return "cbk";
    default:
      return null;
  }
}

function SourceRegistryPanel() {
  const utils = trpc.useUtils();
  const { userMode } = usePortfolio();
  const isManager = userMode === "manager";
  const [includeInactive, setIncludeInactive] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<SourceRow | null>(null);
  const { data, isLoading } = trpc.researchPipeline.listSources.useQuery({ includeInactive });

  const markReviewed = trpc.researchPipeline.markSourceReviewed.useMutation({
    onSuccess: () => {
      toast.success("Marked as reviewed — cadence clock reset.");
      utils.researchPipeline.listSources.invalidate();
      utils.researchPipeline.digest.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });
  const setActive = trpc.researchPipeline.setSourceActive.useMutation({
    onSuccess: () => {
      utils.researchPipeline.listSources.invalidate();
      utils.researchPipeline.digest.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const openAdd = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (s: SourceRow) => {
    setEditing(s);
    setEditorOpen(true);
  };

  const sources = (data?.sources ?? []) as SourceRow[];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted-foreground leading-relaxed max-w-xl">
          Operational metadata only — this tracks when each source was last reviewed and how often it should be. It
          never stores figures or ranks a source by quality.
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <Switch checked={includeInactive} onCheckedChange={setIncludeInactive} /> Show inactive
          </label>
          <Button size="sm" onClick={openAdd}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add source
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full rounded-lg" />
      ) : sources.length === 0 ? (
        <Empty className="py-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <Clock className="w-9 h-9 text-muted-foreground/60" />
            <p className="font-medium">No sources registered yet.</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              Register the data sources this desk draws from (CBK auctions, the NSE price board, fund fact-sheets) with
              a review cadence, and the digest will flag which are due.
            </p>
            <Button size="sm" className="mt-2" onClick={openAdd}>
              <Plus className="w-3.5 h-3.5 mr-1.5" /> Add your first source
            </Button>
          </div>
        </Empty>
      ) : (
        sources.map((s) => {
          const dayMs = 24 * 60 * 60 * 1000;
          const nextDue = s.lastReviewedAt != null ? s.lastReviewedAt + s.cadenceDays * dayMs : null;
          const isDue = s.active && (s.lastReviewedAt == null || (nextDue != null && Date.now() >= nextDue));
          return (
            <div
              key={s.key}
              className={`flex items-center justify-between gap-3 rounded-lg border p-3 flex-wrap ${s.active ? "" : "opacity-60"}`}
            >
              <div className="min-w-0">
                <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                  {s.label}
                  <Badge variant="outline" className="font-normal text-[11px]">
                    every {s.cadenceDays}d
                  </Badge>
                  {!s.active ? (
                    <Badge variant="outline" className="font-normal text-[11px]">
                      inactive
                    </Badge>
                  ) : isDue ? (
                    <Badge className="text-[11px] bg-amber-500/15 text-amber-700 border-amber-500/30" variant="outline">
                      <AlertTriangle className="w-3 h-3 mr-1" /> due
                    </Badge>
                  ) : (
                    <Badge className="text-[11px] bg-emerald-500/10 text-emerald-700 border-emerald-500/20" variant="outline">
                      up to date
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {s.lastReviewedAt
                    ? `Last reviewed ${formatRelativeTime(s.lastReviewedAt)}${s.lastReviewedBy ? ` by ${s.lastReviewedBy}` : ""}`
                    : "Never reviewed"}
                  {s.url && (
                    <>
                      {" · "}
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                        source <ExternalLink className="w-3 h-3" />
                      </a>
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {(() => {
                  const cat = catalogueForFeed(s.feeds);
                  if (!cat || !s.active) return null;
                  // Governed shortcut: hand the registered source straight into the
                  // per-catalogue AI review (findings only → review queue → approval).
                  // Nothing here writes a rate or a catalogue row.
                  return (
                    <CatalogueSourceReviewButton
                      catalogue={cat}
                      isManager={isManager}
                      initialUrl={s.url ?? undefined}
                      label="Review source with AI"
                    />
                  );
                })()}
                {s.active && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="bg-background"
                    onClick={() => markReviewed.mutate({ key: s.key })}
                    disabled={markReviewed.isPending}
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Mark reviewed
                  </Button>
                )}
                <Button size="sm" variant="outline" className="bg-background" onClick={() => openEdit(s)}>
                  <PencilLine className="w-3.5 h-3.5 mr-1.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="bg-background"
                  onClick={() => setActive.mutate({ key: s.key, active: !s.active })}
                  disabled={setActive.isPending}
                >
                  {s.active ? (
                    <>
                      <XCircle className="w-3.5 h-3.5 mr-1.5" /> Deactivate
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Reactivate
                    </>
                  )}
                </Button>
              </div>
            </div>
          );
        })
      )}

      <SourceEditor open={editorOpen} onOpenChange={setEditorOpen} existing={editing} />
    </div>
  );
}

/* ── Desk sub-tabs (URL-driven via ?desk=) ─────────────────────────────────── */

function ConflictsBadge() {
  const { data } = trpc.opportunities.conflicts.useQuery(undefined, { refetchOnWindowFocus: false });
  const n = data?.conflicts?.length ?? 0;
  if (n <= 0) return null;
  return (
    <Badge className="ml-1.5 h-4 min-w-4 px-1 text-[10px] bg-rose-500/15 text-rose-700 border-rose-500/30" variant="outline">
      {n}
    </Badge>
  );
}

const DESK_TABS = ["ask", "queue", "conflicts", "sources", "approved"] as const;
type DeskTab = (typeof DESK_TABS)[number];

function DeskTabs() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("desk");
  const active: DeskTab = (DESK_TABS as readonly string[]).includes(requested ?? "")
    ? (requested as DeskTab)
    : "ask";
  const select = (v: string) => {
    const next = new URLSearchParams(params);
    next.set("desk", v);
    setParams(next, { replace: false });
  };
  return (
    <Tabs value={active} onValueChange={select} className="w-full">
      <TabsList className="flex-wrap h-auto">
        <TabsTrigger value="ask">
          <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Ask AI
        </TabsTrigger>
        <TabsTrigger value="queue">
          <Inbox className="w-3.5 h-3.5 mr-1.5" /> Review queue
          <PendingBadge />
        </TabsTrigger>
        <TabsTrigger value="conflicts">
          <GitCompareArrows className="w-3.5 h-3.5 mr-1.5" /> Source conflicts
          <ConflictsBadge />
        </TabsTrigger>
        <TabsTrigger value="sources">
          <Clock className="w-3.5 h-3.5 mr-1.5" /> Source registry
          <InfoHint side="bottom" iconClassName="ml-1.5">
            The registry of data sources this desk draws from, each with a review cadence so the digest can flag which
            are due for a refresh.
          </InfoHint>
        </TabsTrigger>
        <TabsTrigger value="approved">
          <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Recently approved
        </TabsTrigger>
      </TabsList>

      <TabsContent value="ask" className="mt-5">
        <AskAI embedded />
      </TabsContent>
      <TabsContent value="queue" className="mt-5">
        <PendingQueue />
      </TabsContent>
      <TabsContent value="conflicts" className="mt-5">
        {/* AI figure review + source-conflict resolution live together as a compact
            "what disagrees" surface. Document/image import now lives inside Ask AI. */}
        <div className="space-y-8">
          <SourceConflicts embedded />
          <div className="border-t border-border/60 pt-6">
            <AiReview embedded />
          </div>
        </div>
      </TabsContent>
      <TabsContent value="sources" className="mt-5">
        <SourceRegistryPanel />
      </TabsContent>
      <TabsContent value="approved" className="mt-5">
        <RecentlyApproved embedded />
      </TabsContent>
    </Tabs>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function ResearchDesk({ embedded = false }: { embedded?: boolean } = {}) {
  void embedded; // rendered inside the Research TabbedArea (already inside AppShell)
  const { isAuthenticated, user } = useAuth();
  const isMaintainer = user?.role === "admin";

  if (!isMaintainer) {
    return (
      <div className="container py-10 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Inbox className="w-5 h-5 text-primary" /> Research Desk
            </CardTitle>
            <CardDescription>
              {isAuthenticated
                ? "The Research Desk is where a maintainer reviews and approves proposed catalogue changes. Ask an administrator for access."
                : "Sign in as a maintainer to review proposed changes, manage data sources, and import outside data."}
            </CardDescription>
          </CardHeader>
          {!isAuthenticated && (
            <CardContent>
              <Button onClick={() => (window.location.href = getLoginUrl())}>Sign in</Button>
            </CardContent>
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="container py-8 max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Inbox className="w-6 h-6 text-primary" /> Research Desk
        </h1>
        <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
          The single governed workbench between raw intake and the live reference catalogues. Import data, review what
          an AI or a source proposed, resolve disagreements, and approve changes — every promotion is an explicit,
          auditable decision that you make.
        </p>
      </div>

      <DigestHeader />

      <DeskTabs />
    </div>
  );
}
