import { useState } from "react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { FlaskConical, Sparkles, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Live / Test (sandbox) mode toggle plus sandbox-only seed & reset controls.
 * Lives in the sidebar. Sandbox data is isolated per-user and never mixes with
 * live tracking data.
 */
export function ModeSwitcher() {
  const { mode, setMode, refetch, setPortfolioId } = usePortfolio();
  const utils = trpc.useUtils();
  const [confirmReset, setConfirmReset] = useState(false);

  const seed = trpc.testMode.seedSample.useMutation({
    onSuccess: async (res) => {
      await utils.portfolios.list.invalidate();
      await refetch();
      if (res?.portfolioId) setPortfolioId(res.portfolioId);
      toast.success("Sample portfolio created", {
        description: "Explore freely — it never touches your live data.",
      });
    },
    onError: (e) => toast.error("Could not create sample", { description: e.message }),
  });

  const reset = trpc.testMode.reset.useMutation({
    onSuccess: async (res) => {
      await utils.portfolios.list.invalidate();
      await refetch();
      toast.success(
        res?.deleted ? `Cleared ${res.deleted} sample portfolio${res.deleted === 1 ? "" : "s"}` : "Sandbox cleared"
      );
      setConfirmReset(false);
    },
    onError: (e) => toast.error("Could not reset sandbox", { description: e.message }),
  });

  return (
    <div className="space-y-2">
      {/* Segmented Live / Test toggle */}
      <div
        role="tablist"
        aria-label="Data mode"
        className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/60 border border-border"
      >
        <button
          role="tab"
          aria-selected={mode === "live"}
          onClick={() => setMode("live")}
          className={cn(
            "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-all duration-150",
            mode === "live"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Live
        </button>
        <button
          role="tab"
          aria-selected={mode === "sandbox"}
          onClick={() => setMode("sandbox")}
          className={cn(
            "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-all duration-150",
            mode === "sandbox"
              ? "bg-amber-500 text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <FlaskConical className="w-3 h-3" />
          Test
        </button>
      </div>

      {/* Sandbox-only controls */}
      {mode === "sandbox" && (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-8 text-xs bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
            onClick={() => seed.mutate()}
            disabled={seed.isPending}
          >
            {seed.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            Sample
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => setConfirmReset(true)}
            disabled={reset.isPending}
            aria-label="Reset sandbox"
          >
            {reset.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset sandbox?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>all</strong> test portfolios and their data for your account.
              Your live data is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => reset.mutate()}
            >
              Delete test data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Slim persistent banner shown across the top of the app while in sandbox mode. */
export function SandboxBanner() {
  const { mode, setMode } = usePortfolio();
  if (mode !== "sandbox") return null;
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-500/15 border-b border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs font-medium">
      <FlaskConical className="w-3.5 h-3.5 shrink-0" />
      <span>
        Test mode — this is sample/sandbox data, isolated from your live tracking.
      </span>
      <button
        onClick={() => setMode("live")}
        className="underline underline-offset-2 hover:no-underline font-semibold"
      >
        Switch to Live
      </button>
    </div>
  );
}
