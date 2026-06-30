import { useParams, Link, useLocation } from "wouter";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowLeft,
  ShieldAlert,
  Clock,
  Globe,
  Info,
  FlaskConical,
  LineChart,
  Sparkles,
  CheckCircle2,
  PencilLine,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import { profileFor, type AssetClass } from "@shared/assetModel";
import {
  effectiveState,
  isHumanChecked,
  humanCheckedCount,
  figureCount,
  type FieldKey,
  type FieldProvenance,
  type FieldProvenanceMap,
} from "@shared/provenance";
import { StatusBadge } from "@/components/StatusBadge";
import { rateStaleness } from "@/lib/rateStaleness";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { ModelDrawer } from "@/components/ModelDrawer";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Expansion Brief — Part 2 + Part 7.1: opportunity detail.
 *
 * Shows the FULL sourced profile of one instrument. Part 7.1 makes provenance
 * PER FIGURE: each number carries its own source, link, as-of date and a
 * verification state. A signed-in person can CONFIRM a figure (the scraped value
 * looks right) or EDIT it (enter their own value); either action RAISES the
 * figure's verification state and records who checked it and when. The UI shows
 * which figures a real person has actually looked at. This remains information
 * only — there is exactly one forward action ("Model in my plan"), always
 * hypothetical, and no buy/invest path.
 */

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function fmtPct(v: string | null | undefined): string {
  const n = num(v);
  return n === null ? "—" : `${n.toFixed(2)}%`;
}

const NOW = Date.now();

/**
 * Small coloured badge describing a figure's effective verification state. Phase
 * 8c: now a thin wrapper over the shared <StatusBadge> so every surface renders
 * the same colour, icon and wording. The emphatic ai_extracted filled chip is
 * handled inside StatusBadge's tone map.
 */
function VerificationBadge({ p }: { p: FieldProvenance }) {
  return <StatusBadge state={effectiveState(p, NOW)} />;
}

/**
 * A labelled fact with its OWN per-figure provenance line and (when signed in)
 * inline Confirm / Edit controls. Falls back to the row-level source/asOf when a
 * figure has no per-figure provenance entry (defensive — the seed backfills all).
 */
function Fact({
  fieldKey,
  opportunityRef,
  label,
  value,
  provenance,
  fallbackSource,
  fallbackAsOf,
  caution,
  canVerify,
  onVerified,
}: {
  fieldKey?: FieldKey;
  opportunityRef: string;
  label: string;
  value: React.ReactNode;
  provenance?: FieldProvenance;
  fallbackSource?: string | null;
  fallbackAsOf?: Date | string | null;
  caution?: string;
  canVerify: boolean;
  onVerified?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(provenance?.value ?? "");
  const [srcDraft, setSrcDraft] = useState("");
  const [srcUrlDraft, setSrcUrlDraft] = useState("");

  const verify = trpc.opportunities.verifyField.useMutation({
    onSuccess: () => {
      toast.success(`${label} updated — trust raised`);
      setEditing(false);
      onVerified?.();
    },
    onError: (e) => toast.error(e.message),
  });

  const source = provenance?.source ?? fallbackSource ?? null;
  const sourceUrl = provenance?.sourceUrl ?? null;
  const asOfMs = provenance?.asOf ?? null;
  const asOfForStale: Date | string | null =
    asOfMs != null ? new Date(asOfMs) : (fallbackAsOf ?? null);
  // Only show a freshness line when the figure actually carries an as-of date.
  // Figures without provenance (e.g. Liquidity) must not render "never".
  const stale = asOfForStale != null ? rateStaleness(asOfForStale) : null;

  const eff = provenance ? effectiveState(provenance, NOW) : null;
  const checked = provenance ? isHumanChecked(provenance.verificationState) : false;

  const canAct = canVerify && !!fieldKey && !!provenance;

  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div className="flex items-center gap-2">
          {provenance && <VerificationBadge p={provenance} />}
          <span className="text-sm font-medium text-foreground tabular-nums text-right">{value}</span>
        </div>
      </div>

      {caution && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{caution}</p>}

      {/* Per-figure provenance line */}
      {(source || stale) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
          {source && (
            sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline decoration-dotted hover:text-foreground"
              >
                {source}
                <ExternalLink className="w-2.5 h-2.5" />
              </a>
            ) : (
              <span>{source}</span>
            )
          )}
          {source && stale && <span>·</span>}
          {stale && (
            <span className="inline-flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              <span className={stale.isVeryStale ? "text-red-500" : stale.isStale ? "text-amber-500" : ""}>
                {stale.label}
                {eff === "stale" ? " · may be stale" : ""}
              </span>
            </span>
          )}
        </div>
      )}

      {/* "checked by a person" line — neutral so end-users can trust it regardless of who they are */}
      {checked && provenance?.verifiedBy && provenance?.verifiedAt && (
        <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-1">
          {provenance.verificationState === "human_entered" ? "Entered" : "Checked"} by{" "}
          {provenance.verifiedBy} on{" "}
          {new Date(provenance.verifiedAt).toLocaleDateString("en-KE", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      )}

      {/* Inline verify controls (signed-in only) */}
      {canAct && !editing && (
        <div className="flex items-center gap-2 mt-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-[11px] active:scale-[0.97] transition-transform"
            disabled={verify.isPending}
            onClick={() =>
              verify.mutate({ ref: opportunityRef, fieldKey: fieldKey!, action: { kind: "confirm" } })
            }
          >
            <CheckCircle2 className="w-3 h-3 mr-1" />
            {checked ? "Re-confirm" : "Confirm"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] active:scale-[0.97] transition-transform"
            onClick={() => {
              setDraft(provenance?.value ?? "");
              setEditing(true);
            }}
          >
            <PencilLine className="w-3 h-3 mr-1" />
            Edit value
          </Button>
        </div>
      )}

      {canAct && editing && (
        <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
          <p className="text-[10px] text-muted-foreground">
            Enter the authoritative value and where it came from. This records it as
            <strong> entered by you</strong> and stamps your name.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="h-7 w-28 text-xs"
              placeholder="New value"
              autoFocus
            />
            <Input
              value={srcDraft}
              onChange={(e) => setSrcDraft(e.target.value)}
              className="h-7 w-52 text-xs"
              placeholder='Source (e.g. "ILAM fact sheet Q1-2026")'
            />
            <Input
              value={srcUrlDraft}
              onChange={(e) => setSrcUrlDraft(e.target.value)}
              className="h-7 w-52 text-xs"
              placeholder="Source URL (optional)"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              className="h-7 px-2 text-[11px] active:scale-[0.97] transition-transform"
              disabled={verify.isPending || draft.trim() === "" || draft.trim() === (provenance?.value ?? "")}
              onClick={() =>
                verify.mutate({
                  ref: opportunityRef,
                  fieldKey: fieldKey!,
                  action: {
                    kind: "override",
                    value: draft.trim(),
                    ...(srcDraft.trim() !== "" ? { source: srcDraft.trim() } : {}),
                    ...(srcUrlDraft.trim() !== "" ? { sourceUrl: srcUrlDraft.trim() } : {}),
                  },
                })
              }
            >
              Save my value
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px]"
              onClick={() => {
                setEditing(false);
                setSrcDraft("");
                setSrcUrlDraft("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OpportunityDetail() {
  const params = useParams();
  const ref = decodeURIComponent(params.ref ?? "");
  const [, navigate] = useLocation();
  const { mode } = usePortfolio();
  const { user } = useAuth();
  const isMaintainer = user?.role === "admin";
  const [modelOpen, setModelOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data: r, isLoading, error } = trpc.opportunities.byRef.useQuery(
    { ref },
    { enabled: !!ref, retry: false },
  );

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-6 lg:p-8 max-w-3xl">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </div>
      </AppShell>
    );
  }

  if (error || !r) {
    return (
      <AppShell>
        <div className="p-6 lg:p-8 max-w-3xl space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/explore")} className="-ml-2">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Explore
          </Button>
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            This instrument is no longer in the catalog.
          </CardContent></Card>
        </div>
      </AppShell>
    );
  }

  const profile = profileFor(r.assetClass as AssetClass);
  const trailing = num(r.trailingReturnPct);
  const fp = (r.fieldProvenance ?? {}) as FieldProvenanceMap;
  const total = figureCount(fp);
  const checkedCount = humanCheckedCount(fp);

  const onVerified = () => {
    void utils.opportunities.byRef.invalidate({ ref });
    void utils.opportunities.list.invalidate();
  };

  // Is the headline yield actually a distribution (REIT/fund)? Then it has its
  // own `distribution` provenance entry and we label it accordingly.
  const yieldIsDistribution = !!fp.distribution;

  return (
    <AppShell>
      <div className="p-6 lg:p-8 max-w-3xl space-y-5">
        {/* Back link — always present so the detail view is never a dead-end */}
        <Button variant="ghost" size="sm" onClick={() => navigate("/explore")} className="-ml-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Explore
        </Button>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
              {r.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {r.issuer ?? "—"} · {profile.label} · {r.market ?? r.currency}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Badge variant="outline" className="text-xs">{r.currency}</Badge>
              {profile.priceDriven && <Badge variant="outline" className="text-xs">Price-driven</Badge>}
              {profile.fxExposed && (
                <Badge variant="outline" className="text-xs gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400">
                  <Globe className="w-3 h-3" /> FX risk
                </Badge>
              )}
              {profile.insured === "none" ? (
                <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-600 dark:text-amber-400">
                  Not insured
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">KDIC-insured (to limit)</Badge>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant="outline" className="text-xs px-2.5 py-1 gap-1.5">
              <Info className="w-3 h-3" /> Information only
            </Badge>
            {total > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={`text-[10px] gap-1 ${checkedCount > 0 ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400" : "border-amber-500/40 text-amber-600 dark:text-amber-400"}`}
                  >
                    <ShieldCheck className="w-2.5 h-2.5" />
                    {checkedCount}/{total} figures checked
                  </Badge>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs text-xs">
                  How many of this instrument's figures a person has confirmed or entered.
                  The rest are scraped from public sources and unverified.
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Persistent disclaimer */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              <strong>For information only — not advice or a recommendation.</strong>{" "}
              These figures come from public sources and may be delayed or inaccurate.
              {r.unverified ? " They start unverified until a person checks them. " : " "}
              Confirm with the issuer or a licensed adviser before acting.
            </p>
          </CardContent>
        </Card>

        {/* Sourced profile */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sourced facts</CardTitle>
            <CardDescription className="text-xs">
              Each figure carries its own source and as-of date.
              {isMaintainer
                ? " As a maintainer you can confirm a figure if it looks right, or edit it to enter the authoritative value and source — either raises its trust."
                : " A green marker means a maintainer has checked that figure; unmarked figures are scraped from public sources."}
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {r.yieldPct !== null && (
              <Fact
                fieldKey={yieldIsDistribution ? "distribution" : "yield"}
                opportunityRef={r.ref}
                label={r.yieldKind ?? "Yield"}
                value={fmtPct(r.yieldPct)}
                provenance={yieldIsDistribution ? fp.distribution : fp.yield}
                fallbackSource={r.dataSource}
                fallbackAsOf={r.dataAsOf}
                canVerify={isMaintainer}
                onVerified={onVerified}
              />
            )}
            {r.lastPrice !== null && (
              <Fact
                fieldKey="price"
                opportunityRef={r.ref}
                label="Last price"
                value={`${r.currency} ${Number(r.lastPrice).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`}
                provenance={fp.price}
                fallbackSource={r.dataSource}
                fallbackAsOf={r.dataAsOf}
                canVerify={isMaintainer}
                onVerified={onVerified}
              />
            )}
            {trailing !== null && (
              <Fact
                fieldKey="trailingReturn"
                opportunityRef={r.ref}
                label="Trailing 12-month return"
                value={`${trailing.toFixed(2)}%`}
                provenance={fp.trailingReturn}
                fallbackSource={r.dataSource}
                fallbackAsOf={r.dataAsOf}
                caution="Past performance — describes what already happened and does not predict future results."
                canVerify={isMaintainer}
                onVerified={onVerified}
              />
            )}
            {r.expenseRatioPct !== null && (
              <Fact
                fieldKey="expense"
                opportunityRef={r.ref}
                label="Expense ratio / fee"
                value={fmtPct(r.expenseRatioPct)}
                provenance={fp.expense}
                fallbackSource={r.dataSource}
                fallbackAsOf={r.dataAsOf}
                canVerify={isMaintainer}
                onVerified={onVerified}
              />
            )}
            {r.tenorYears !== null && (
              <Fact
                fieldKey="tenor"
                opportunityRef={r.ref}
                label="Tenor"
                value={`${Number(r.tenorYears)} yr`}
                provenance={fp.tenor}
                fallbackSource={r.dataSource}
                fallbackAsOf={r.dataAsOf}
                canVerify={isMaintainer}
                onVerified={onVerified}
              />
            )}
            {r.maturityDate && (
              <Fact
                fieldKey="maturity"
                opportunityRef={r.ref}
                label="Maturity"
                value={new Date(r.maturityDate).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })}
                provenance={fp.maturity}
                fallbackSource={r.dataSource}
                fallbackAsOf={r.dataAsOf}
                canVerify={isMaintainer}
                onVerified={onVerified}
              />
            )}
            {r.liquidity && (
              <Fact
                opportunityRef={r.ref}
                label="Liquidity"
                value={r.liquidity.replace(/_/g, " ")}
                canVerify={false}
              />
            )}
            {r.factNote && (
              <div className="py-3 text-xs text-muted-foreground leading-relaxed">{r.factNote}</div>
            )}
          </CardContent>
        </Card>

        {/* Single hypothetical action — respects Live/Test mode */}
        <Card>
          <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-2">
              <LineChart className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">See how this could fit — hypothetically</p>
                <p className="text-xs text-muted-foreground max-w-md">
                  Runs a what-if projection only. It does not buy anything, move money, or change your tracked plan.
                </p>
              </div>
            </div>
            <Button
              onClick={() => setModelOpen(true)}
              className="active:scale-[0.97] transition-transform"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Model in my plan
              <span className={`ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${mode === "sandbox" ? "bg-amber-500/25 text-amber-100" : "bg-primary-foreground/20"}`}>
                {mode === "sandbox" ? "Hypothetical · Test" : "Hypothetical"}
              </span>
            </Button>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          {mode === "sandbox" ? <FlaskConical className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
          Modeling never moves real money{mode === "sandbox" ? " and stays inside your sandbox" : ""}.
        </p>

        <div>
          <Link href="/explore">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to all opportunities
            </Button>
          </Link>
        </div>
      </div>

      <ModelDrawer
        opportunity={{
          ref: r.ref,
          name: r.name,
          assetClass: r.assetClass,
          currency: r.currency,
          lastPrice: r.lastPrice,
          yieldPct: r.yieldPct,
          yieldKind: r.yieldKind,
          trailingReturnPct: r.trailingReturnPct,
          dataSource: r.dataSource,
          dataAsOf: r.dataAsOf,
          fieldProvenance: fp,
        }}
        open={modelOpen}
        onOpenChange={setModelOpen}
      />
    </AppShell>
  );
}
