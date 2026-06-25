import { useState, useEffect, useRef } from "react";
import { ChevronDown, Plus, Briefcase, Check, Sparkles, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * The create-portfolio dialog. Extracted so it can be opened either from the
 * sidebar dropdown or from an empty-state onboarding screen.
 *
 * As the user fills in target, horizon, start date, and Month-1 contribution,
 * the dialog calls the stateless `projection.recommendStepUp` query (debounced)
 * and auto-fills the Step-up field with the amount that reaches the target.
 * Because that query uses the SAME projection engine + default CBK rates the
 * Scenarios page uses, the recommendation stays in sync with the Scenarios
 * comparison once the portfolio exists. The user can always override the value.
 */
export function CreatePortfolioDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { setPortfolioId, refetch, mode } = usePortfolio();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [horizonMonths, setHorizonMonths] = useState("");
  const [startingContribution, setStartingContribution] = useState("");
  const [stepUpAmount, setStepUpAmount] = useState("");
  // Step-up frequency (how often the step-up is applied), in months. Feeds the
  // same solver so the recommendation respects the chosen cadence.
  const [stepUpMonths, setStepUpMonths] = useState("6");
  // Tracks whether the user has hand-edited the step-up field. Once they do, we
  // stop auto-overwriting it so we never clobber a deliberate choice.
  const [stepUpTouched, setStepUpTouched] = useState(false);

  const utils = trpc.useUtils();

  // ── Live step-up recommendation ───────────────────────────────────────────
  const target = parseFloat(targetAmount);
  const horizon = parseInt(horizonMonths);
  const month1 = parseFloat(startingContribution);
  const recoInputValid =
    Number.isFinite(target) && target >= 100000 &&
    Number.isFinite(horizon) && horizon >= 12 && horizon <= 240 &&
    Number.isFinite(month1) && month1 >= 0;

  // Debounce the draft inputs so we only query once typing settles.
  const freqMonths = parseInt(stepUpMonths) || 6;
  const [debounced, setDebounced] = useState<{
    targetAmount: number; horizonMonths: number; startingContribution: number; startDate: string; stepUpMonths: number;
  } | null>(null);
  useEffect(() => {
    if (!open || !recoInputValid) {
      setDebounced(null);
      return;
    }
    const t = setTimeout(() => {
      setDebounced({
        targetAmount: target,
        horizonMonths: horizon,
        startingContribution: month1,
        startDate,
        stepUpMonths: freqMonths,
      });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recoInputValid, target, horizon, month1, startDate, freqMonths]);

  const recoQuery = trpc.projection.recommendStepUp.useQuery(
    debounced
      ? debounced
      : { targetAmount: 0, horizonMonths: 0, startingContribution: 0 },
    { enabled: !!debounced, staleTime: 60_000 }
  );
  const reco = debounced ? recoQuery.data : undefined;

  // Auto-fill the step-up field from the recommendation, unless the user has
  // taken control of it. Keeps the field in lock-step with the inputs.
  const lastAppliedRef = useRef<number | null>(null);
  useEffect(() => {
    if (stepUpTouched) return;
    if (!reco || !reco.feasible) return;
    if (lastAppliedRef.current === reco.recommendedStepUp) return;
    lastAppliedRef.current = reco.recommendedStepUp;
    setStepUpAmount(String(reco.recommendedStepUp));
  }, [reco, stepUpTouched]);

  const createMutation = trpc.portfolios.create.useMutation({
    onSuccess: async (data) => {
      await refetch();
      setPortfolioId(data.portfolioId);
      utils.portfolios.list.invalidate();
      toast.success("Portfolio created");
      onOpenChange(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  function resetForm() {
    setName("");
    setDescription("");
    setTargetAmount("");
    setStartDate(new Date().toISOString().split("T")[0]);
    setHorizonMonths("");
    setStartingContribution("");
    setStepUpAmount("");
    setStepUpMonths("6");
    setStepUpTouched(false);
    setDebounced(null);
    lastAppliedRef.current = null;
  }

  function handleCreate() {
    if (!name.trim()) return toast.error("Portfolio name is required");
    const t = parseFloat(targetAmount);
    const h = parseInt(horizonMonths);
    const m1 = parseFloat(startingContribution);
    const stepUp = parseFloat(stepUpAmount);
    if (!t || t < 100000) return toast.error("Enter a target of at least KES 100,000");
    if (!h || h < 12 || h > 240) return toast.error("Enter a horizon between 12 and 240 months");
    if (Number.isNaN(m1) || m1 < 0) return toast.error("Enter a valid Month 1 contribution");
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      targetAmount: t,
      startDate,
      horizonMonths: h,
      startingContribution: m1,
      stepUpAmount: Number.isNaN(stepUp) ? 0 : stepUp,
      stepUpMonths: freqMonths,
      safetyFloor: 50000,
      isSandbox: mode === "sandbox",
    });
  }

  // Build the helper line shown under the step-up field.
  const fmt = (n: number) => `KES ${Math.round(n).toLocaleString()}`;
  const showSpinner = !!debounced && recoQuery.isFetching && !reco;
  let recoHint: { tone: "muted" | "good" | "warn"; text: string } | null = null;
  if (showSpinner) {
    recoHint = { tone: "muted", text: "Calculating the step-up needed to reach your target…" };
  } else if (reco) {
    if (!reco.feasible) {
      recoHint = {
        tone: "warn",
        text: `Even a large step-up won't reach ${fmt(target)} in ${horizon} months from ${fmt(month1)}/month. Try a higher Month 1, a longer horizon, or a lower target.`,
      };
    } else if (reco.alreadyHitsAtZero) {
      recoHint = {
        tone: "good",
        text: `At ${fmt(month1)}/month you already reach ${fmt(target)} — no step-up needed (recommended 0).`,
      };
    } else {
      recoHint = {
        tone: "good",
        text: `Recommended: step up by ${fmt(reco.recommendedStepUp)} every ${freqMonths} months to reach ${fmt(target)} (projected ${fmt(reco.projectedEndingValue)}). Matches the Scenarios page.`,
      };
    }
  }

  // Live projected-vs-target delta, projected at the EXACT step-up that will be
  // saved (manual value when touched, otherwise the recommendation). Debounced
  // and run through projectDraft so the surplus/shortfall is accurate for any
  // step-up the user enters.
  const effectiveStepUp = (() => {
    const v = parseFloat(stepUpAmount);
    if (stepUpTouched) return Number.isFinite(v) && v >= 0 ? v : 0;
    return reco?.feasible ? reco.recommendedStepUp : (Number.isFinite(v) && v >= 0 ? v : 0);
  })();
  const [deltaDebounced, setDeltaDebounced] = useState<{
    targetAmount: number; horizonMonths: number; startingContribution: number; startDate: string; stepUpMonths: number; stepUpAmount: number;
  } | null>(null);
  useEffect(() => {
    if (!open || !recoInputValid) {
      setDeltaDebounced(null);
      return;
    }
    const t = setTimeout(() => {
      setDeltaDebounced({
        targetAmount: target,
        horizonMonths: horizon,
        startingContribution: month1,
        startDate,
        stepUpMonths: freqMonths,
        stepUpAmount: effectiveStepUp,
      });
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recoInputValid, target, horizon, month1, startDate, freqMonths, effectiveStepUp]);

  const draftQuery = trpc.projection.projectDraft.useQuery(
    deltaDebounced
      ? deltaDebounced
      : { targetAmount: 0, horizonMonths: 0, startingContribution: 0, stepUpAmount: 0 },
    { enabled: !!deltaDebounced, staleTime: 60_000 }
  );
  const draft = deltaDebounced ? draftQuery.data : undefined;
  const deltaAmount = draft ? draft.delta : null;
  const deltaIsSurplus = deltaAmount != null && deltaAmount >= 0;
  const draftLoading = !!deltaDebounced && draftQuery.isFetching && !draft;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Portfolio</DialogTitle>
          <DialogDescription>
            Set up a savings goal with its own target, horizon, and contribution schedule.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input placeholder="e.g. Retirement Fund, House Deposit" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              placeholder="Optional — what this portfolio is for (shown as the app subtitle)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target (KES)</Label>
              <Input type="number" placeholder="e.g. 5000000" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Horizon (months)</Label>
              <Input type="number" min={12} max={240} placeholder="e.g. 120" value={horizonMonths} onChange={(e) => setHorizonMonths(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Month 1 contribution</Label>
              <Input type="number" placeholder="e.g. 2500" value={startingContribution} onChange={(e) => setStartingContribution(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Step-up amount (KES)</Label>
                {!stepUpTouched && reco?.feasible && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-primary">
                    <Sparkles className="h-3 w-3" /> Auto
                  </span>
                )}
                {stepUpTouched && recoInputValid && (
                  <button
                    type="button"
                    className="text-[11px] font-medium text-primary hover:underline"
                    onClick={() => {
                      setStepUpTouched(false);
                      lastAppliedRef.current = null;
                      if (reco?.feasible) setStepUpAmount(String(reco.recommendedStepUp));
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>
              <Input
                type="number"
                placeholder={`Optional — every ${freqMonths} months`}
                value={stepUpAmount}
                onChange={(e) => {
                  setStepUpTouched(true);
                  setStepUpAmount(e.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Step-up frequency</Label>
              <Select value={stepUpMonths} onValueChange={setStepUpMonths}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">Every 3 months</SelectItem>
                  <SelectItem value="6">Every 6 months</SelectItem>
                  <SelectItem value="12">Every 12 months</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {recoHint && (
            <p
              className={
                "flex items-start gap-1.5 text-xs " +
                (recoHint.tone === "warn" ? "text-destructive" : "text-muted-foreground")
              }
            >
              {showSpinner ? (
                <Loader2 className="mt-0.5 h-3 w-3 shrink-0 animate-spin" />
              ) : (
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              )}
              <span>{recoHint.text}</span>
            </p>
          )}
          {/* Live projected-vs-target delta */}
          {recoInputValid && (deltaAmount != null || draftLoading) && (
            <div
              className={
                "rounded-lg border p-3 " +
                (draftLoading
                  ? "border-white/10 bg-white/5"
                  : deltaIsSurplus
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-amber-500/30 bg-amber-500/10")
              }
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Projected at Month {horizon}</span>
                <span className="text-sm font-semibold text-foreground">
                  {draftLoading ? "…" : fmt(draft!.projectedEndingValue)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {draftLoading ? "" : deltaIsSurplus ? "Surplus vs target" : "Shortfall vs target"}
                </span>
                <span
                  className={
                    "text-sm font-bold " +
                    (draftLoading ? "text-muted-foreground" : deltaIsSurplus ? "text-emerald-400" : "text-amber-400")
                  }
                >
                  {draftLoading
                    ? ""
                    : `${deltaIsSurplus ? "+" : "−"}${fmt(Math.abs(deltaAmount!))}`}
                </span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PortfolioSelector() {
  const { portfolio, portfolios, setPortfolioId } = usePortfolio();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors text-left">
            <Briefcase className="h-4 w-4 shrink-0 opacity-70" />
            <span className="flex-1 truncate text-sm font-medium">
              {portfolio?.name ?? "Select portfolio"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {portfolios.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => setPortfolioId(p.id)}
              className="flex items-center gap-2"
            >
              <Briefcase className="h-3.5 w-3.5 opacity-60" />
              <span className="flex-1 truncate">{p.name}</span>
              {p.id === portfolio?.id && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
          {portfolios.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => setShowCreate(true)} className="flex items-center gap-2 text-primary">
            <Plus className="h-3.5 w-3.5" />
            <span>New portfolio</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreatePortfolioDialog open={showCreate} onOpenChange={setShowCreate} />
    </>
  );
}
