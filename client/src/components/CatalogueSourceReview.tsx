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
import { FindingCard, useSourceAttachment, type Finding } from "@/pages/AskAI";

/**
 * Round 89 — the per-catalogue "Review source with AI" workflow, mounted INSIDE each
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

const COPY: Record<CatalogueKind, { button: string; title: string; blurb: string }> = {
  mmf: {
    button: "Review MMF source with AI",
    title: "Review an MMF source with AI",
    blurb:
      "Attach a Serrari benchmark, a fund fact sheet, a screenshot, a PDF, or a URL. The assistant compares it against your current MMF Market rows and proposes new funds, EAR / gross-yield / fee / minimum / AUM changes, and source or as-of updates.",
  },
  bank: {
    button: "Review bank source with AI",
    title: "Review a bank source with AI",
    blurb:
      "Attach a rate sheet, a term-deposit schedule, a screenshot, a PDF, or a URL. The assistant compares it against your current Bank Product rows and proposes new products, rate / minimum / tenor / negotiable-flag / liquidity-term changes.",
  },
  cbk: {
    button: "Review CBK source with AI",
    title: "Review a CBK source with AI",
    blurb:
      "Attach Treasury bills on offer, weekly auction results, or a bond auction / re-opening notice. The assistant extracts the 91 / 182 / 364-day bills (rate, issue number, auction & value dates) and proposes updates to your CBK Securities Reference.",
  },
  market_asset: {
    button: "Review market source with AI",
    title: "Review a market source with AI",
    blurb:
      "Attach an NSE price board, a REIT fact sheet, an ETF fact sheet, or an offshore-fund fact sheet. The assistant proposes price / NAV, yield, and trailing-return changes, source / as-of updates, and new reference rows.",
  },
};

function ReviewDialog({
  catalogue,
  open,
  onOpenChange,
}: {
  catalogue: CatalogueKind;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const copy = COPY[catalogue];
  const attach = useSourceAttachment();
  const [result, setResult] = useState<{ answer: string; taskId: number; findings: Finding[] } | null>(null);
  const utils = trpc.useUtils();

  // Findings for the current review task; re-fetched after a draft/dismiss so the
  // card badges update. Only enabled once a review has produced a task.
  const findingsQuery = trpc.research.listFindings.useQuery(
    { taskId: result?.taskId ?? 0 },
    { enabled: result != null },
  );

  const review = trpc.research.reviewCatalogueSource.useMutation({
    onSuccess: (data) => {
      setResult({
        answer: data.answer,
        taskId: data.taskId,
        // The mutation already returns the freshly-created findings; seed the panel
        // with them so the first render never depends on the follow-up query.
        findings: Array.isArray(data.findings) ? (data.findings as unknown as Finding[]) : [],
      });
      toast.success("Source reviewed — review each proposal below and send the ones you want to the queue.");
      // Refresh the desk's pending/new-finding counts in the background.
      utils.research.listFindings.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  async function runReview() {
    const { source, label } = await attach.resolve();
    if (!source) {
      toast.error("Attach a source first — a URL, pasted text, a PDF, or a screenshot.");
      return;
    }
    review.mutate({ catalogue, source, sourceLabel: label ?? undefined });
  }

  function close() {
    onOpenChange(false);
    // Reset for the next open so a stale result isn't shown.
    setTimeout(() => {
      setResult(null);
      attach.reset();
    }, 200);
  }

  const busy = review.isPending || attach.uploading;
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
          <DialogDescription>{copy.blurb}</DialogDescription>
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-primary/25 bg-primary/[0.05] px-3 py-2 text-xs text-foreground">
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
          <span>
            Nothing here changes a catalogue. Every proposal is a draft you send to the Review Queue, where it only
            publishes when you approve it — and approvals never rewrite past actuals.
          </span>
        </div>

        {!result && (
          <div className="space-y-3">
            {attach.node}
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
                {attach.uploading ? "Uploading…" : review.isPending ? "Reviewing…" : "Review source"}
              </Button>
            </DialogFooter>
          </div>
        )}

        {result && (
          <div className="space-y-4">
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
                The source didn&rsquo;t surface any changes against your current rows.
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
}: {
  catalogue: CatalogueKind;
  isManager: boolean;
  size?: "sm" | "default";
}) {
  const [open, setOpen] = useState(false);
  if (!isManager) return null;
  return (
    <>
      <Button variant="outline" size={size} className="bg-background" onClick={() => setOpen(true)}>
        <Sparkles className="w-4 h-4 mr-2 text-violet-500" />
        {COPY[catalogue].button}
      </Button>
      <ReviewDialog catalogue={catalogue} open={open} onOpenChange={setOpen} />
    </>
  );
}
