import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Link } from "wouter";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import {
  Sparkles,
  Bot,
  Loader2,
  ShieldCheck,
  ArrowRight,
  ExternalLink,
} from "lucide-react";
import {
  FindingCard,
  useSourceAttachment,
  SourceStatusPanel,
  useResearchTaskPoller,
  TaskStageProgress,
  STAGE_LABELS,
  type Finding,
  type SourceStatus,
} from "@/pages/AskAI";

/**
 * Round 89 — the per-catalogue "Review a source with AI" workflow, mounted INSIDE each
 * reference-catalogue page (no new page). A manager attaches a source (URL / pasted
 * text / PDF / screenshot) from the catalogue they are looking at; the AI compares it
 * against that catalogue's CURRENT rows and proposes create/edit/stale FINDINGS.
 *
 * This deliberately reuses the SAME building blocks as the Ask-AI desk:
 *   • `useSourceAttachment` — the identical URL/text/PDF/image picker + upload flow.
 *   • `FindingCard` — the identical proposal card whose "Draft into review queue"
 *     button calls `research.draftFromFinding`.
 * So there is exactly ONE governed path: source → findings → review queue → approval
 * → catalogue update → Recently Approved audit. Nothing here writes a catalogue, and
 * nothing publishes without the manager approving it on the Research Desk.
 */

export type CatalogueKind = "mmf" | "bank" | "cbk" | "market_asset";

export const SOURCE_REVIEW_BUTTON_LABEL = "Review a source with AI";

const SOURCE_REVIEW_WORKFLOW_STEPS = [
  "Attach source",
  "AI extracts facts",
  "Draft findings",
  "Review Queue approval",
  "Catalogue updates only after approval",
] as const;

const ATTACHED_SOURCE_HELPER =
  "Attach a URL, pasted text, PDF, or image. AI will extract reference facts and prepare findings for review. Approved catalogue rows change only after manager approval.";

const SOURCE_LIBRARY_NOTE =
  "Approved source decisions help Source Library learn reusable patterns for future refresh workflows. Today, attach the source you want AI to review.";

const COPY: Record<CatalogueKind, { title: string; categoryHelp: string; blurb: string }> = {
  mmf: {
    title: "Review a source for MMF Market",
    categoryHelp: "Use this for factsheets, fund pages, or official rate publications.",
    blurb:
      "AI compares the attached source against your current MMF Market rows and prepares findings for new funds, EAR, gross yield, fee, minimum, AUM, source, or as-of updates.",
  },
  bank: {
    title: "Review a source for Bank Product Catalogue",
    categoryHelp: "Use this for official product pages, tariff sheets, or rate sheets.",
    blurb:
      "AI compares the attached source against your current Bank Product rows and prepares findings for new products, indicative rate, minimum, tenor, negotiable flag, or liquidity-term updates.",
  },
  cbk: {
    title: "Review a source for CBK Securities Reference",
    categoryHelp: "Use this for CBK notices, auction results, DhowCSD references, or official security details.",
    blurb:
      "AI compares the attached source against your current CBK Securities Reference rows and prepares findings for 91 / 182 / 364-day Treasury bill tenors, bond notices, yields, issue numbers, auction dates, value dates, or official security details.",
  },
  market_asset: {
    title: "Review a source for Market Assets Reference",
    categoryHelp:
      "Use this for issuer, exchange, fund manager, REIT, offshore fund, or SACCO source documents.",
    blurb:
      "AI compares the attached source against your current Equity, REIT, Offshore fund, and SACCO reference rows and prepares findings for price, NAV, yield, trailing return, subtype, source, or as-of updates.",
  },
};

function ReviewDialog({
  catalogue,
  open,
  onOpenChange,
  initialUrl,
}: {
  catalogue: CatalogueKind;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialUrl?: string;
}) {
  const copy = COPY[catalogue];
  const attach = useSourceAttachment({ initialUrl });
  const [result, setResult] = useState<{
    answer: string;
    taskId: number;
    findings: Finding[];
    stage: string;
    sourceStatus: SourceStatus | null;
  } | null>(null);
  const utils = trpc.useUtils();

  // Round 96 — the review runs as a POLLABLE task (start → process → poll) exactly like
  // Ask AI, so a slow source read shows a live stage instead of holding one long
  // request open. Strict gating is unchanged server-side (unreadable source ⇒
  // needs_source_fix, zero findings).
  const startReview = trpc.research.startReviewTask.useMutation();
  const poller = useResearchTaskPoller();
  const [submitting, setSubmitting] = useState(false);

  // Findings for the current review task; re-fetched after a draft/dismiss so the
  // card badges update. Only enabled once a review has produced a task.
  const findingsQuery = trpc.research.listFindings.useQuery(
    { taskId: result?.taskId ?? 0 },
    { enabled: result != null },
  );

  async function runReview() {
    const { source, label } = await attach.resolve();
    if (!source) {
      toast.error("Attach a source first — a URL, pasted text, a PDF, or a screenshot.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await poller.run(async () => {
        const started = await startReview.mutateAsync({
          catalogue,
          source,
          sourceLabel: label ?? undefined,
        });
        return { taskId: started.taskId, threadId: started.threadId };
      });
      setResult({
        answer: res.answer,
        taskId: res.taskId,
        findings: res.findings,
        stage: res.stage,
        sourceStatus: res.sourceStatus,
      });
      if (res.stage === "needs_source_fix") {
        // The SOURCE could not be read — this is NOT an AI failure, and NO proposals
        // were generated. Tell the manager exactly how to fix the source and retry.
        toast.error("I couldn’t read that source, so I didn’t propose any changes. Fix the source and try again.");
      } else if (res.stage === "failed") {
        toast.error("The review failed. Please try again.");
      } else {
        toast.success("Source reviewed — review each proposal below and send the ones you want to the queue.");
      }
      utils.research.listFindings.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    onOpenChange(false);
    // Reset for the next open so a stale result isn't shown.
    setTimeout(() => {
      setResult(null);
      attach.reset();
    }, 200);
  }

  const needsSourceFix = result?.stage === "needs_source_fix";
  const busy = submitting || poller.running || attach.uploading;
  const runningLabel = poller.stage ? STAGE_LABELS[poller.stage] : "Reviewing…";
  // `research.listFindings` returns `{ findings: [...] }`, NOT a bare array. Unwrap it
  // defensively (Array.isArray guard) and fall back to the findings the mutation
  // already returned so the result panel renders even before the query resolves.
  const queried = findingsQuery.data?.findings;
  const findings: Finding[] = Array.isArray(queried)
    ? (queried as unknown as Finding[])
    : (result?.findings ?? []);

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            {copy.title}
          </DialogTitle>
          <DialogDescription>
            {ATTACHED_SOURCE_HELPER} {copy.categoryHelp}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border border-border bg-muted/30 px-3 py-3">
          <p className="text-xs font-medium text-foreground">Current workflow</p>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
            {SOURCE_REVIEW_WORKFLOW_STEPS.map((step, index) => (
              <div key={step} className="flex items-center gap-2">
                <span className="rounded-full border border-border bg-background px-2 py-0.5 font-medium text-foreground">
                  {index + 1}. {step}
                </span>
                {index < SOURCE_REVIEW_WORKFLOW_STEPS.length - 1 && (
                  <ArrowRight className="h-3 w-3 text-muted-foreground/70" />
                )}
              </div>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {copy.blurb} {SOURCE_LIBRARY_NOTE}
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-md border border-primary/25 bg-primary/[0.05] px-3 py-2 text-xs text-foreground">
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
          <span>
            Nothing here changes a catalogue. Every proposal is a draft you send to the Review Queue, where it only
            publishes when you approve it — and approvals never rewrite past actuals. AI does not find the source for
            you, refresh rows by itself, or approve changes automatically.
          </span>
        </div>

        {!result && (
          <div className="space-y-3">
            {attach.node}
            {poller.running && <TaskStageProgress stage={poller.stage} />}
            <DialogFooter>
              <Button variant="outline" className="bg-background" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={runReview} disabled={busy || !attach.provided}>
                {busy ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Bot className="w-4 h-4 mr-2" />
                )}
                {attach.uploading ? "Uploading…" : poller.running ? runningLabel : "Review attached source"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {result && needsSourceFix && (
          <div className="space-y-4">
            <SourceStatusPanel status={result.sourceStatus} />
            <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-sm text-foreground">
              I didn&rsquo;t propose any changes because I couldn&rsquo;t read the source. This is a source problem,
              not an AI answer &mdash; nothing was compared against your catalogue.
            </div>
            <div className="flex flex-col gap-3">
              {attach.node}
              {poller.running && <TaskStageProgress stage={poller.stage} />}
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  variant="outline"
                  className="bg-background"
                  onClick={() => {
                    setResult(null);
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button onClick={runReview} disabled={busy || !attach.provided}>
                  {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Bot className="w-4 h-4 mr-2" />}
                  {attach.uploading ? "Uploading…" : poller.running ? runningLabel : "Retry review"}
                </Button>
              </DialogFooter>
            </div>
          </div>
        )}

        {result && !needsSourceFix && (
          <div className="space-y-4">
            <SourceStatusPanel status={result.sourceStatus} />
            <div className="rounded-lg border border-border bg-card px-3 py-2">
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <Streamdown>{result.answer}</Streamdown>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Proposed changes{findings.length ? ` (${findings.length})` : ""}
              </p>
              <Link href="/research" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                Open Research Desk <ExternalLink className="w-3 h-3" />
              </Link>
            </div>

            {findingsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading proposals…</p>
            ) : findings.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">
                The attached source did not produce any draft findings against your current catalogue rows.
              </p>
            ) : (
              <div className="space-y-3">
                {findings.map((f) => (
                  <FindingCard key={f.id} finding={f} onChanged={() => findingsQuery.refetch()} />
                ))}
              </div>
            )}

            <DialogFooter className="gap-2 sm:gap-2">
              <Button
                variant="outline"
                className="bg-background"
                onClick={() => {
                  setResult(null);
                  attach.reset();
                }}
                disabled={busy}
              >
                <ArrowRight className="w-4 h-4 mr-2" /> Review another source
              </Button>
              <Button onClick={close}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The manager-only trigger button + its dialog. Drop this into a catalogue page's
 * header action area; it renders nothing for non-managers.
 */
export function CatalogueSourceReviewButton({
  catalogue,
  isManager,
  size = "sm",
  initialUrl,
  label,
  variant = "outline",
  className,
}: {
  catalogue: CatalogueKind;
  isManager: boolean;
  size?: "sm" | "default";
  /** Seed the URL picker (e.g. a Rate Settings source URL or a Source Registry row). */
  initialUrl?: string;
  /** Override the button label for row-level actions that seed a specific source URL. */
  label?: string;
  variant?: "outline" | "ghost";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!isManager) return null;
  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className ?? "bg-background"}
        onClick={() => setOpen(true)}
      >
        <Sparkles className="w-4 h-4 mr-2 text-violet-500" />
        {label ?? SOURCE_REVIEW_BUTTON_LABEL}
      </Button>
      {/* Remount the dialog per-open so the seeded URL is re-applied each time. */}
      {open && (
        <ReviewDialog catalogue={catalogue} open={open} onOpenChange={setOpen} initialUrl={initialUrl} />
      )}
    </>
  );
}
