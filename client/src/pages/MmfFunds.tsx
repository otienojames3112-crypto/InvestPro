import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Plus, Pencil, Trash2, CheckCircle2, Circle, Info, PlusCircle, X, Star } from "lucide-react";
import { formatKES } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Fund = {
  id: number;
  fundName: string;
  company: string;
  grossYield: number;
  ear: number;
  managementFee: number;
  minInvestment: number;
  aumMillions: number | null;
  asOfDate: string | null;
  source: string | null;
  isActive: boolean;
};

type SortKey = "fundName" | "ear" | "grossYield" | "managementFee" | "minInvestment" | "aumMillions";
type SortDir = "asc" | "desc";

const INDUSTRY_AVG_EAR = 9.24; // Jun 2026 Serrari data (mean of 27 active funds)

function FundFormDialog({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Partial<Fund>;
  onSave: (data: Omit<Fund, "id" | "isActive" | "createdAt" | "updatedAt">) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    fundName: initial?.fundName ?? "",
    company: initial?.company ?? "",
    grossYield: String(initial?.grossYield ?? ""),
    ear: String(initial?.ear ?? ""),
    managementFee: String(initial?.managementFee ?? "2.0"),
    minInvestment: String(initial?.minInvestment ?? "1000"),
    aumMillions: String(initial?.aumMillions ?? ""),
    asOfDate: initial?.asOfDate ?? "",
    source: initial?.source ?? "",
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = () => {
    if (!form.fundName.trim() || !form.company.trim()) {
      toast.error("Fund name and company are required.");
      return;
    }
    const ear = parseFloat(form.ear);
    const grossYield = parseFloat(form.grossYield);
    if (isNaN(ear) || ear <= 0) { toast.error("EAR must be a positive number."); return; }
    if (isNaN(grossYield) || grossYield <= 0) { toast.error("Gross yield must be a positive number."); return; }
    onSave({
      fundName: form.fundName.trim(),
      company: form.company.trim(),
      grossYield,
      ear,
      managementFee: parseFloat(form.managementFee) || 2.0,
      minInvestment: parseFloat(form.minInvestment) || 1000,
      aumMillions: form.aumMillions ? parseFloat(form.aumMillions) : null,
      asOfDate: form.asOfDate || null,
      source: form.source || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Fund" : "Add MMF Fund"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2">
            <Label>Fund Name *</Label>
            <Input value={form.fundName} onChange={set("fundName")} placeholder="e.g. Cytonn Money Market Fund" />
          </div>
          <div className="col-span-2">
            <Label>Fund Manager / Company *</Label>
            <Input value={form.company} onChange={set("company")} placeholder="e.g. Cytonn Investments" />
          </div>
          <div>
            <Label>Gross Yield (% p.a.) *</Label>
            <Input type="number" step="0.01" value={form.grossYield} onChange={set("grossYield")} placeholder="e.g. 16.0" />
          </div>
          <div>
            <Label>EAR net of fee (% p.a.) *</Label>
            <Input type="number" step="0.01" value={form.ear} onChange={set("ear")} placeholder="e.g. 13.9" />
          </div>
          <div>
            <Label>Management Fee (% p.a.)</Label>
            <Input type="number" step="0.01" value={form.managementFee} onChange={set("managementFee")} placeholder="2.0" />
          </div>
          <div>
            <Label>Min. Investment (KES)</Label>
            <Input type="number" step="1" value={form.minInvestment} onChange={set("minInvestment")} placeholder="1000" />
          </div>
          <div>
            <Label>AUM (KES millions)</Label>
            <Input type="number" step="0.01" value={form.aumMillions} onChange={set("aumMillions")} placeholder="optional" />
          </div>
          <div>
            <Label>Data as of Date</Label>
            <Input type="date" value={form.asOfDate} onChange={set("asOfDate")} />
          </div>
          <div className="col-span-2">
            <Label>Source URL / Reference</Label>
            <Input value={form.source} onChange={set("source")} placeholder="e.g. https://cytonn.com/..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MmfFunds() {
  const { portfolioId, portfolio } = usePortfolio();
  const utils = trpc.useUtils();

  const { data: funds = [], isLoading } = trpc.mmfFunds.list.useQuery();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("ear");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [addOpen, setAddOpen] = useState(false);
  const [editFund, setEditFund] = useState<Fund | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // ── Secondary MMF accounts ──
  const { data: secondaryMmfs = [], isLoading: secondaryLoading } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const [addSecondaryOpen, setAddSecondaryOpen] = useState(false);
  const [editSecondary, setEditSecondary] = useState<typeof secondaryMmfs[0] | null>(null);
  const [secondaryForm, setSecondaryForm] = useState({ mmfFundId: "", label: "", currentBalance: "", monthlyContribution: "", notes: "" });

  const addSecondaryMutation = trpc.secondaryMmfs.add.useMutation({
    onSuccess: () => { utils.secondaryMmfs.list.invalidate({ portfolioId: portfolioId! }); setAddSecondaryOpen(false); setSecondaryForm({ mmfFundId: "", label: "", currentBalance: "", monthlyContribution: "", notes: "" }); toast.success("Additional MMF account added."); },
    onError: (e) => toast.error(e.message),
  });
  const updateSecondaryMutation = trpc.secondaryMmfs.update.useMutation({
    onSuccess: () => { utils.secondaryMmfs.list.invalidate({ portfolioId: portfolioId! }); setEditSecondary(null); toast.success("Account updated."); },
    onError: (e) => toast.error(e.message),
  });
  const removeSecondaryMutation = trpc.secondaryMmfs.remove.useMutation({
    onSuccess: () => { utils.secondaryMmfs.list.invalidate({ portfolioId: portfolioId! }); toast.success("Account removed."); },
    onError: (e) => toast.error(e.message),
  });

  function openEditSecondary(item: typeof secondaryMmfs[0]) {
    setEditSecondary(item);
    setSecondaryForm({
      mmfFundId: String(item.mmfFundId),
      label: item.label ?? "",
      currentBalance: String(item.currentBalance),
      monthlyContribution: String(item.monthlyContribution),
      notes: item.notes ?? "",
    });
  }

  function handleSaveSecondary(isEdit: boolean) {
    if (!portfolioId) return;
    const mmfFundId = parseInt(secondaryForm.mmfFundId);
    if (!mmfFundId) { toast.error("Please select a fund."); return; }
    const currentBalance = parseFloat(secondaryForm.currentBalance) || 0;
    const monthlyContribution = parseFloat(secondaryForm.monthlyContribution) || 0;
    if (isEdit && editSecondary) {
      updateSecondaryMutation.mutate({ id: editSecondary.id, portfolioId, mmfFundId, label: secondaryForm.label || undefined, currentBalance, monthlyContribution, notes: secondaryForm.notes || undefined });
    } else {
      addSecondaryMutation.mutate({ portfolioId, mmfFundId, label: secondaryForm.label || undefined, currentBalance, monthlyContribution, notes: secondaryForm.notes || undefined });
    }
  }

  const addMutation = trpc.mmfFunds.add.useMutation({
    onSuccess: () => { utils.mmfFunds.list.invalidate(); setAddOpen(false); toast.success("Fund added."); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.mmfFunds.update.useMutation({
    onSuccess: () => { utils.mmfFunds.list.invalidate(); setEditFund(null); toast.success("Fund updated."); },
    onError: (e) => toast.error(e.message),
  });
  const deactivateMutation = trpc.mmfFunds.deactivate.useMutation({
    onSuccess: () => { utils.mmfFunds.list.invalidate(); setDeleteId(null); toast.success("Fund removed."); },
    onError: (e) => toast.error(e.message),
  });
  const selectFundMutation = trpc.mmfFunds.selectFund.useMutation({
    onSuccess: () => {
      utils.portfolios.list.invalidate();
      if (portfolioId) {
        utils.portfolios.get.invalidate({ portfolioId });
        utils.projection.run.invalidate({ portfolioId });
        utils.projection.milestones.invalidate({ portfolioId });
        utils.projection.scenarios.invalidate({ portfolioId });
      }
      toast.success("Fund selection saved. Projection updated.");
    },
    onError: (e) => toast.error(e.message),
  });

  const selectedFundId = portfolio?.mmfFundId ?? null;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return funds.filter(
      (f) =>
        f.fundName.toLowerCase().includes(q) ||
        f.company.toLowerCase().includes(q)
    );
  }, [funds, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string" && typeof bv === "string")
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [filtered, sortKey, sortDir]);

  const top5Ear = useMemo(() => {
    return [...funds].sort((a, b) => b.ear - a.ear).slice(0, 5).map((f) => f.id);
  }, [funds]);

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="w-3 h-3 opacity-40 ml-1" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  const selectedFund = funds.find((f) => f.id === selectedFundId);

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MMF Fund Tracker</h1>
          <p className="text-muted-foreground text-sm mt-1">
            27 CMA-regulated Kenyan money market funds. Select one to use its EAR in your projection.
            {" "}Data from{" "}
            <a
              href="https://serrarigroup.com/ke/mmf/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-primary hover:text-primary/80 font-medium"
            >
              Serrari Group
            </a>
            {" "}(updated daily).
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" /> Add Fund
        </Button>
      </div>

      {/* Selected fund banner */}
      {selectedFund ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="py-3 px-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">
                Projection uses <strong>{selectedFund.fundName}</strong> ({selectedFund.ear.toFixed(2)}% EAR)
              </span>
              <Badge variant="secondary" className="text-xs">WHT applied by engine</Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => portfolioId && selectFundMutation.mutate({ portfolioId, mmfFundId: null })}
              disabled={selectFundMutation.isPending}
            >
              Switch to manual rate
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              No fund selected — projection uses the manual MMF yield from Rate Settings.
              Select a fund below to use its published EAR instead.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Industry average note */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="w-3 h-3" />
        Industry average EAR (Jun 2026): <strong>{INDUSTRY_AVG_EAR}%</strong> ·{" "}
        <a
          href="https://serrarigroup.com/ke/mmf/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          Verify on Serrari ↗
        </a>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by name or company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-3 font-medium w-8">#</th>
                <th className="text-left px-4 py-3 font-medium">
                  <button className="flex items-center" onClick={() => handleSort("fundName")}>
                    Fund <SortIcon k="fundName" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("ear")}>
                    EAR (%) <SortIcon k="ear" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("grossYield")}>
                    Gross (%) <SortIcon k="grossYield" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("managementFee")}>
                    Fee (%) <SortIcon k="managementFee" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("minInvestment")}>
                    Min (KES) <SortIcon k="minInvestment" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("aumMillions")}>
                    AUM (M) <SortIcon k="aumMillions" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium">As of</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && sorted.length === 0 && (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">No funds found.</td></tr>
              )}
              {sorted.map((fund, idx) => {
                const isSelected = fund.id === selectedFundId;
                const isTop5 = top5Ear.includes(fund.id);
                const vsAvg = fund.ear - INDUSTRY_AVG_EAR;
                return (
                  <tr
                    key={fund.id}
                    className={`border-b transition-colors ${isSelected ? "bg-primary/8" : "hover:bg-muted/30"}`}
                  >
                    <td className="px-4 py-3 text-muted-foreground text-xs">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium flex items-center gap-1.5">
                            {fund.fundName}
                            {isTop5 && (
                              <Badge className="text-[10px] py-0 px-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                                Top 5
                              </Badge>
                            )}
                            {isSelected && (
                              <Badge className="text-[10px] py-0 px-1.5 bg-primary/15 text-primary border-primary/30">
                                Selected
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{fund.company}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${fund.ear >= INDUSTRY_AVG_EAR ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        {fund.ear.toFixed(2)}%
                      </span>
                      <div className="text-[10px] text-muted-foreground">
                        {vsAvg >= 0 ? "+" : ""}{vsAvg.toFixed(1)}% vs avg
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{fund.grossYield.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{fund.managementFee.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {fund.minInvestment.toLocaleString("en-KE")}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {fund.aumMillions != null ? fund.aumMillions.toLocaleString("en-KE", { maximumFractionDigits: 0 }) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {fund.asOfDate ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {isSelected ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs border-primary/40 text-primary"
                            onClick={() => portfolioId && selectFundMutation.mutate({ portfolioId, mmfFundId: null })}
                            disabled={selectFundMutation.isPending}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Selected
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => portfolioId && selectFundMutation.mutate({ portfolioId, mmfFundId: fund.id })}
                            disabled={selectFundMutation.isPending}
                          >
                            <Circle className="w-3 h-3 mr-1" /> Select
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setEditFund(fund)}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(fund.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── Secondary MMF Accounts Section ── */}
      <Card className="border-primary/20 bg-primary/3">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-primary" />
                Additional MMF Accounts
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                Track other MMF funds you invest in alongside your primary fund. Each is projected forward with its own EAR and contribution. Use <strong>Set as primary</strong> to make any account drive the headline projection.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => { setSecondaryForm({ mmfFundId: "", label: "", currentBalance: "", monthlyContribution: "", notes: "" }); setAddSecondaryOpen(true); }} disabled={!portfolioId}>
              <Plus className="w-4 h-4 mr-1" /> Add Account
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {secondaryLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!secondaryLoading && secondaryMmfs.length === 0 && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Info className="w-4 h-4 shrink-0" />
              No additional MMF accounts yet. Click <strong>Add Account</strong> to start tracking another fund.
            </div>
          )}
          {secondaryMmfs.length > 0 && (
            <div className="space-y-3">
              {secondaryMmfs.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/60 bg-background/60 p-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">{item.label || item.fundName}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{item.ear.toFixed(2)}% EAR</Badge>
                      {item.mmfFundId != null && item.mmfFundId === selectedFundId && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-primary text-primary-foreground">
                          <Star className="w-2.5 h-2.5 mr-0.5" /> Primary
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.company}</p>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                      <span>Balance: <strong className="text-foreground kes-amount">{formatKES(item.currentBalance)}</strong></span>
                      <span>Monthly: <strong className="text-foreground kes-amount">{formatKES(item.monthlyContribution)}</strong></span>
                    </div>
                    {item.notes && <p className="text-xs text-muted-foreground mt-1 italic">{item.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {item.mmfFundId != null && item.mmfFundId !== selectedFundId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => portfolioId && item.mmfFundId != null && selectFundMutation.mutate({ portfolioId, mmfFundId: item.mmfFundId })}
                        disabled={selectFundMutation.isPending}
                        title="Use this fund's EAR to drive the projection"
                      >
                        <Star className="w-3 h-3 mr-1" /> Set as primary
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditSecondary(item)}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => portfolioId && removeSecondaryMutation.mutate({ id: item.id, portfolioId })} disabled={removeSecondaryMutation.isPending}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Secondary MMF Dialog */}
      <Dialog open={addSecondaryOpen || !!editSecondary} onOpenChange={(v) => { if (!v) { setAddSecondaryOpen(false); setEditSecondary(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editSecondary ? "Edit MMF Account" : "Add MMF Account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Fund *</Label>
              <Select value={secondaryForm.mmfFundId} onValueChange={(v) => setSecondaryForm((f) => ({ ...f, mmfFundId: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a fund…" />
                </SelectTrigger>
                <SelectContent>
                  {funds.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.fundName} ({f.ear.toFixed(2)}% EAR)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Custom Label (optional)</Label>
              <Input className="mt-1" placeholder="e.g. Cytonn MMF (emergency fund)" value={secondaryForm.label} onChange={(e) => setSecondaryForm((f) => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Current Balance (KES)</Label>
                <Input className="mt-1" type="number" step="100" min="0" placeholder="0" value={secondaryForm.currentBalance} onChange={(e) => setSecondaryForm((f) => ({ ...f, currentBalance: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Monthly Contribution (KES)</Label>
                <Input className="mt-1" type="number" step="100" min="0" placeholder="0" value={secondaryForm.monthlyContribution} onChange={(e) => setSecondaryForm((f) => ({ ...f, monthlyContribution: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea className="mt-1 text-xs" rows={2} placeholder="Any notes about this account…" value={secondaryForm.notes} onChange={(e) => setSecondaryForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddSecondaryOpen(false); setEditSecondary(null); }}>Cancel</Button>
            <Button onClick={() => handleSaveSecondary(!!editSecondary)} disabled={addSecondaryMutation.isPending || updateSecondaryMutation.isPending}>
              {addSecondaryMutation.isPending || updateSecondaryMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-xs text-muted-foreground">
        EAR = Effective Annual Rate net of management fee, before 15% WHT. WHT is applied by the projection engine.
        Data last updated 21 Jun 2026 from{" "}
        <a
          href="https://serrarigroup.com/ke/mmf/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-primary hover:text-primary/80"
        >
          serrarigroup.com/ke/mmf/
        </a>
        {" "}— click to verify current rates, then use the Edit button to update any fund.
      </p>

      {/* Add dialog */}
      <FundFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={(data) => addMutation.mutate({ ...data, aumMillions: data.aumMillions ?? undefined, asOfDate: data.asOfDate ?? undefined, source: data.source ?? undefined })}
        saving={addMutation.isPending}
      />

      {/* Edit dialog */}
      {editFund && (
        <FundFormDialog
          open={!!editFund}
          onClose={() => setEditFund(null)}
          initial={editFund}
          onSave={(data) => updateMutation.mutate({ id: editFund.id, fundName: data.fundName, company: data.company, grossYield: data.grossYield, ear: data.ear, managementFee: data.managementFee, minInvestment: data.minInvestment, aumMillions: data.aumMillions ?? undefined, asOfDate: data.asOfDate ?? undefined, source: data.source ?? undefined })}
          saving={updateMutation.isPending}
        />
      )}

      {/* Delete confirm */}
      <Dialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Fund?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will deactivate the fund and remove it from the list. The fund will no longer appear in the selector.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId !== null && deactivateMutation.mutate({ id: deleteId })}
              disabled={deactivateMutation.isPending}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
