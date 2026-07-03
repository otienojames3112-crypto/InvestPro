import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Sparkles, Loader2, ShieldCheck, AlertCircle } from "lucide-react";
import { Streamdown } from "streamdown";

/**
 * Round 95 — shared, READ-ONLY "explain what I'm looking at" dialog.
 *
 * This is the presentation shell for the three governed AI EXPLANATION surfaces
 * (reconciliation mismatch, ledger month, dashboard status). It NEVER writes and
 * NEVER proposes a change — it renders prose returned by an `aiExplain.*` query.
 * The parent owns the tRPC query (so it can pass page-computed facts and control
 * `enabled`), and passes the answer / loading / error state down here.
 *
 * A persistent governance note makes the non-advice framing explicit: this is an
 * explanation of the numbers on screen, not a recommendation to buy/sell/switch.
 */
export function AiExplainDialog({
  open,
  onOpenChange,
  title,
  description,
  answer,
  isLoading,
  isError,
  errorMessage,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  answer: string | null | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onRetry?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            {title}
          </DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>

        <div className="flex items-start gap-2 rounded-md border border-primary/25 bg-primary/[0.05] px-3 py-2 text-xs text-foreground">
          <ShieldCheck className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
          <span>
            This is a plain-language explanation of the figures already on screen. It changes nothing and is not
            investment advice — it explains what the numbers mean and where to look, never what to buy, sell, or switch.
          </span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" />
            Reading the figures…
          </div>
        ) : isError ? (
          <div className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/[0.06] px-3 py-2 text-sm text-foreground">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0 text-destructive" />
              <span>{errorMessage || "The explanation couldn’t be generated just now. Please try again."}</span>
            </div>
            {onRetry ? (
              <DialogFooter>
                <Button onClick={onRetry}>Try again</Button>
              </DialogFooter>
            ) : null}
          </div>
        ) : answer ? (
          <div className="rounded-lg border border-border bg-card px-3 py-2">
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
              <Streamdown>{answer}</Streamdown>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-6 text-center">No explanation yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
