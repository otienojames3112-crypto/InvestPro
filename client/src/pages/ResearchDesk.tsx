import { useState } from "react";
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
import { promotionTargetForAssetClass, type PromotionTarget } from "@shared/researchPipeline";
import { formatRelativeTime } from "@/lib/format";
import AiIntake from "./AiIntake";
import AiReview from "./AiReview";
import SourceConflicts from "./SourceConflicts";
import AskAI from "./AskAI";
import RecentlyApproved from "./RecentlyApproved";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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

function fmtFigures(figures: Record<string, unknown> | null | undefined): { key: string; label: string; value: string }[] {
  if (!figures) return [];
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
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => ({ key: k, label: LABELS[k] ?? k, value: String(v) }));
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
  busy,
}: {
  updateId: number | null;
  portfolioId: number | null;
  managerValue: string;
  setManagerValue: (v: string) => void;
  onClose: () => void;
  onApprove: (overrideGate: boolean) => void;
  busy: boolean;
}) {
  const { data, isLoading } = trpc.researchPipeline.impactOf.useQuery(
    updateId != null ? { id: updateId, portfolioId: portfolioId ?? undefined } : (undefined as never),
    { enabled: updateId != null, refetchOnWindowFocus: false },
  );

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

/* ── Pending update review queue ───────────────────────────────────────────── */

function PendingQueue() {
  const utils = trpc.useUtils();
  const { portfolioId } = usePortfolio();
  const { data, isLoading } = trpc.researchPipeline.listUpdates.useQuery({ status: "pending" });
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  // The update currently being approved through the confirmation dialog.
  const [approveId, setApproveId] = useState<number | null>(null);
  const [managerValue, setManagerValue] = useState("");

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
        toast.success(
          res.promotedRef
            ? `Approved — promoted into the live catalogue as "${res.promotedRef}".`
            : "Approved and promoted.",
        );
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
        const figures = fmtFigures(u.figures as Record<string, unknown> | null);
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
                    <Badge variant="secondary" className="font-normal text-[11px]">
                      {u.changeKind === "edit" ? "Edits existing" : "New instrument"}
                    </Badge>
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Approving promotes this into <strong className="text-foreground">{TARGET_LABELS[target]}</strong>
                    {u.issuer ? ` · ${u.issuer}` : ""} · {u.currency}
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
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
                {u.asOf && <span>· as of {new Date(u.asOf).toLocaleDateString()}</span>}
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
              </div>
            </CardContent>
          </Card>
        );
      })}

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

function SourceRegistryPanel() {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.researchPipeline.listSources.useQuery({ includeInactive: false });
  const markReviewed = trpc.researchPipeline.markSourceReviewed.useMutation({
    onSuccess: () => {
      toast.success("Marked as reviewed — cadence clock reset.");
      utils.researchPipeline.listSources.invalidate();
      utils.researchPipeline.digest.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;
  const sources = data?.sources ?? [];

  if (sources.length === 0) {
    return (
      <Empty className="py-12">
        <div className="flex flex-col items-center gap-2 text-center">
          <Clock className="w-9 h-9 text-muted-foreground/60" />
          <p className="font-medium">No sources registered yet.</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Register the data sources this desk draws from (CBK auctions, the NSE price board, fund fact-sheets) with a
            review cadence, and the digest will flag which are due.
          </p>
        </div>
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground leading-relaxed">
        Operational metadata only — this tracks when each source was last reviewed and how often it should be. It never
        stores figures or ranks a source by quality.
      </p>
      {sources.map((s) => {
        const dayMs = 24 * 60 * 60 * 1000;
        const nextDue = s.lastReviewedAt != null ? s.lastReviewedAt + s.cadenceDays * dayMs : null;
        const isDue = s.lastReviewedAt == null || (nextDue != null && Date.now() >= nextDue);
        return (
          <div
            key={s.key}
            className="flex items-center justify-between gap-3 rounded-lg border p-3 flex-wrap"
          >
            <div className="min-w-0">
              <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                {s.label}
                <Badge variant="outline" className="font-normal text-[11px]">
                  every {s.cadenceDays}d
                </Badge>
                {isDue ? (
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
            <Button
              size="sm"
              variant="outline"
              className="bg-background"
              onClick={() => markReviewed.mutate({ key: s.key })}
              disabled={markReviewed.isPending}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Mark reviewed
            </Button>
          </div>
        );
      })}
    </div>
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

      <Tabs defaultValue="ask" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="ask">
            <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Ask AI
          </TabsTrigger>
          <TabsTrigger value="queue">
            <Inbox className="w-3.5 h-3.5 mr-1.5" /> Review queue
            <PendingBadge />
          </TabsTrigger>
          <TabsTrigger value="import">
            <ClipboardCheck className="w-3.5 h-3.5 mr-1.5" /> Import &amp; conflicts
          </TabsTrigger>
          <TabsTrigger value="approved">
            <ShieldCheck className="w-3.5 h-3.5 mr-1.5" /> Recently approved
          </TabsTrigger>
          <TabsTrigger value="sources">
            <Clock className="w-3.5 h-3.5 mr-1.5" /> Sources
            <InfoHint side="bottom" iconClassName="ml-1.5">
              The registry of data sources this desk draws from, each with a review cadence so the digest can flag which
              are due for a refresh.
            </InfoHint>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ask" className="mt-5">
          <AskAI embedded />
        </TabsContent>
        <TabsContent value="queue" className="mt-5">
          <PendingQueue />
        </TabsContent>
        <TabsContent value="import" className="mt-5">
          <Tabs defaultValue="doc" className="w-full">
            <TabsList>
              <TabsTrigger value="doc">
                <Sparkles className="w-3.5 h-3.5 mr-1.5" /> Import a document
              </TabsTrigger>
              <TabsTrigger value="ai-review">
                <ClipboardCheck className="w-3.5 h-3.5 mr-1.5" /> AI figure review
              </TabsTrigger>
              <TabsTrigger value="conflicts">
                <GitCompareArrows className="w-3.5 h-3.5 mr-1.5" /> Conflicts
              </TabsTrigger>
            </TabsList>
            <TabsContent value="doc" className="mt-5">
              <AiIntake embedded />
            </TabsContent>
            <TabsContent value="ai-review" className="mt-5">
              <AiReview embedded />
            </TabsContent>
            <TabsContent value="conflicts" className="mt-5">
              <SourceConflicts embedded />
            </TabsContent>
          </Tabs>
        </TabsContent>
        <TabsContent value="approved" className="mt-5">
          <RecentlyApproved embedded />
        </TabsContent>
        <TabsContent value="sources" className="mt-5">
          <SourceRegistryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
