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
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

export function PortfolioSelector() {
  const { portfolio, portfolios, setPortfolioId, refetch } = usePortfolio();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetAmount, setTargetAmount] = useState("5000000");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [horizonMonths, setHorizonMonths] = useState("120");
  const [startingContribution, setStartingContribution] = useState("2500");
  const [stepUpAmount, setStepUpAmount] = useState("3000");

  const utils = trpc.useUtils();
  const createMutation = trpc.portfolios.create.useMutation({
    onSuccess: async (data) => {
      await refetch();
      setPortfolioId(data.portfolioId);
      utils.portfolios.list.invalidate();
      toast.success("Portfolio created");
      setShowCreate(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  function resetForm() {
    setName("");
    setDescription("");
    setTargetAmount("5000000");
    setStartDate(new Date().toISOString().split("T")[0]);
    setHorizonMonths("120");
    setStartingContribution("2500");
    setStepUpAmount("3000");
  }

  function handleCreate() {
    if (!name.trim()) return toast.error("Portfolio name is required");
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      targetAmount: parseFloat(targetAmount) || 5000000,
      startDate,
      horizonMonths: parseInt(horizonMonths) || 120,
      startingContribution: parseFloat(startingContribution) || 2500,
      stepUpAmount: parseFloat(stepUpAmount) || 3000,
      stepUpMonths: 6,
      safetyFloor: 50000,
    });
  }

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

      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create Portfolio</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name *</Label>
              <Input placeholder="e.g. KES 5M Goal" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea
                placeholder="Optional notes about this portfolio"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Target (KES)</Label>
                <Input type="number" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Horizon (months)</Label>
                <Input type="number" min={12} max={240} value={horizonMonths} onChange={(e) => setHorizonMonths(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start date</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Month 1 contribution</Label>
                <Input type="number" value={startingContribution} onChange={(e) => setStartingContribution(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Step-up amount (KES / period)</Label>
              <Input type="number" value={stepUpAmount} onChange={(e) => setStepUpAmount(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
