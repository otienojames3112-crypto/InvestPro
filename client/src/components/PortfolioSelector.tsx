import { useState } from "react";
import { ChevronDown, Plus, Briefcase, Check } from "lucide-react";
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
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * The create-portfolio dialog. Extracted so it can be opened either from the
 * sidebar dropdown or from an empty-state onboarding screen.
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

  const utils = trpc.useUtils();
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
  }

  function handleCreate() {
    if (!name.trim()) return toast.error("Portfolio name is required");
    const target = parseFloat(targetAmount);
    const horizon = parseInt(horizonMonths);
    const month1 = parseFloat(startingContribution);
    const stepUp = parseFloat(stepUpAmount);
    if (!target || target < 100000) return toast.error("Enter a target of at least KES 100,000");
    if (!horizon || horizon < 12 || horizon > 240) return toast.error("Enter a horizon between 12 and 240 months");
    if (Number.isNaN(month1) || month1 < 0) return toast.error("Enter a valid Month 1 contribution");
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      targetAmount: target,
      startDate,
      horizonMonths: horizon,
      startingContribution: month1,
      stepUpAmount: Number.isNaN(stepUp) ? 0 : stepUp,
      stepUpMonths: 6,
      safetyFloor: 50000,
      isSandbox: mode === "sandbox",
    });
  }

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
          <div className="space-y-1.5">
            <Label>Step-up amount (KES / period)</Label>
            <Input type="number" placeholder="Optional — increase every 6 months" value={stepUpAmount} onChange={(e) => setStepUpAmount(e.target.value)} />
          </div>
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
