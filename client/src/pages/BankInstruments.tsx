import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Landmark, Plus, Pencil, Trash2, Info, Percent } from "lucide-react";

type BankInstrumentType =
  | "call_deposit"
  | "fixed_deposit"
  | "ordinary_savings"
  | "target_savings"
  | "tiered_savings";

interface BankRow {
  id: number;
  bankName: string;
  instrumentType: BankInstrumentType;
  minAmount: number;
  typicalTenor: string | null;
  indicativeRate: number | null;
  isNegotiable: boolean;
  notes: string | null;
  asOfDate: string | Date | null;
  source: string | null;
  isActive: boolean;
}

function kes(n: number): string {
  return n.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

const EMPTY = {
  id: 0,
  bankName: "",
  instrumentType: "fixed_deposit" as BankInstrumentType,
  minAmount: "0",
  typicalTenor: "",
  indicativeRate: "",
  isNegotiable: true,
  notes: "",
  source: "",
};

export default function BankInstruments() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.bankInstruments.list.useQuery();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const add = trpc.bankInstruments.add.useMutation({
    onSuccess: () => {
      utils.bankInstruments.list.invalidate();
      setEditOpen(false);
      toast.success("Instrument added");
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.bankInstruments.update.useMutation({
    onSuccess: () => {
      utils.bankInstruments.list.invalidate();
      setEditOpen(false);
      toast.success("Instrument updated");
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.bankInstruments.remove.useMutation({
    onSuccess: () => {
      utils.bankInstruments.list.invalidate();
      setDeleteId(null);
      toast.success("Instrument removed");
    },
    onError: (e) => toast.error(e.message),
  });

  const callRows = useMemo(
    () => (rows ?? []).filter((r) => r.instrumentType === "call_deposit"),
    [rows]
  );
  const fixedRows = useMemo(
    () => (rows ?? []).filter((r) => r.instrumentType === "fixed_deposit"),
    [rows]
  );
  const ordinarySavingsRows = useMemo(
    () => (rows ?? []).filter((r) => r.instrumentType === "ordinary_savings"),
    [rows]
  );
  const targetSavingsRows = useMemo(
    () => (rows ?? []).filter((r) => r.instrumentType === "target_savings"),
    [rows]
  );
  const tieredSavingsRows = useMemo(
    () => (rows ?? []).filter((r) => r.instrumentType === "tiered_savings"),
    [rows]
  );

  function openAdd() {
    setForm({ ...EMPTY });
    setEditOpen(true);
  }
  function openEdit(r: BankRow) {
    setForm({
      id: r.id,
      bankName: r.bankName,
      instrumentType: r.instrumentType,
      minAmount: String(r.minAmount),
      typicalTenor: r.typicalTenor ?? "",
      indicativeRate: r.indicativeRate === null ? "" : String(r.indicativeRate),
      isNegotiable: r.isNegotiable,
      notes: r.notes ?? "",
      source: r.source ?? "",
    });
    setEditOpen(true);
  }

  function save() {
    if (!form.bankName.trim()) {
      toast.error("Bank name is required");
      return;
    }
    const payload = {
      bankName: form.bankName.trim(),
      instrumentType: form.instrumentType,
      minAmount: Number(form.minAmount) || 0,
      typicalTenor: form.typicalTenor || undefined,
      indicativeRate: form.indicativeRate === "" ? undefined : Number(form.indicativeRate),
      isNegotiable: form.isNegotiable,
      notes: form.notes || undefined,
      source: form.source || undefined,
    };
    if (form.id) {
      update.mutate({ id: form.id, ...payload });
    } else {
      add.mutate(payload);
    }
  }

  function renderTable(data: BankRow[]) {
    if (data.length === 0) {
      return (
        <p className="text-sm text-muted-foreground py-6 text-center">
          None recorded yet.
        </p>
      );
    }
    return (
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bank</TableHead>
              <TableHead className="text-right">Min Amount</TableHead>
              <TableHead>Tenor</TableHead>
              <TableHead className="text-right">Indic. Rate</TableHead>
              <TableHead>Negotiable</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-medium">{r.bankName}</div>
                  {r.notes && (
                    <div className="text-xs text-muted-foreground">{r.notes}</div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {kes(r.minAmount)}
                </TableCell>
                <TableCell>{r.typicalTenor ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.indicativeRate === null ? (
                    <span className="text-muted-foreground">n/a</span>
                  ) : (
                    `${r.indicativeRate.toFixed(2)}%`
                  )}
                </TableCell>
                <TableCell>
                  {r.isNegotiable ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Negotiable
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      Fixed
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(r)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteId(r.id)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-primary" />
              <h1
                className="text-2xl font-bold"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Banking Sector Instruments
              </h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-3xl">
              Call and fixed deposit products from major Kenyan banks — a
              reference for the cash/deposit and savings alternatives to money market funds.
              Posted rates are indicative and almost always{" "}
              <strong>negotiable</strong> for larger balances; treat them as a
              starting point for your own rate conversation with the bank.
            </p>
          </div>
          <Button onClick={openAdd} className="shrink-0">
            <Plus className="w-4 h-4 mr-2" /> Add Instrument
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Percent className="w-4 h-4 text-primary" /> Fixed Deposits
                </CardTitle>
                <CardDescription>
                  Locked for a set tenor; higher rate but early withdrawal
                  usually forfeits interest.
                </CardDescription>
              </CardHeader>
              <CardContent>{renderTable(fixedRows)}</CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Percent className="w-4 h-4 text-primary" /> Call Deposits
                </CardTitle>
                <CardDescription>
                  Instant-access interest-bearing accounts; lower rate but fully
                  liquid — the closest bank equivalent to an MMF.
                </CardDescription>
              </CardHeader>
              <CardContent>{renderTable(callRows)}</CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Percent className="w-4 h-4 text-primary" /> Ordinary / Regular Savings
                </CardTitle>
                <CardDescription>
                  Instant or near-instant access savings accounts. Lower,
                  variable rates; some limit withdrawals to keep interest.
                </CardDescription>
              </CardHeader>
              <CardContent>{renderTable(ordinarySavingsRows)}</CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Percent className="w-4 h-4 text-primary" /> Target / Goal Savings
                </CardTitle>
                <CardDescription>
                  Locked for a chosen period to enforce discipline. Often higher
                  than ordinary savings; early break usually carries a penalty.
                </CardDescription>
              </CardHeader>
              <CardContent>{renderTable(targetSavingsRows)}</CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Percent className="w-4 h-4 text-primary" /> Tiered / High-Yield Savings
                </CardTitle>
                <CardDescription>
                  Rate rises with the balance band; the strongest savings rates
                  but usually need a larger minimum to reach the top tier.
                </CardDescription>
              </CardHeader>
              <CardContent>{renderTable(tieredSavingsRows)}</CardContent>
            </Card>
          </>
        )}

        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Interest on bank deposits is subject to 15% withholding tax (final
          tax), same as MMF interest. Rates change frequently and are editable
          here — keep them current from each bank's published schedule or your
          relationship manager.
        </p>
      </div>

      {/* Edit/Add dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Edit Instrument" : "Add Instrument"}
            </DialogTitle>
            <DialogDescription>
              Record a bank deposit product and its indicative rate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Bank Name</Label>
                <Input
                  value={form.bankName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, bankName: e.target.value }))
                  }
                  placeholder="e.g. Equity Bank"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select
                  value={form.instrumentType}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      instrumentType: v as BankInstrumentType,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_deposit">Fixed Deposit</SelectItem>
                    <SelectItem value="call_deposit">Call Deposit</SelectItem>
                    <SelectItem value="ordinary_savings">Ordinary / Regular Savings</SelectItem>
                    <SelectItem value="target_savings">Target / Goal Savings</SelectItem>
                    <SelectItem value="tiered_savings">Tiered / High-Yield Savings</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Min Amount (KES)</Label>
                <Input
                  type="number"
                  value={form.minAmount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, minAmount: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Indicative Rate (%)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={form.indicativeRate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, indicativeRate: e.target.value }))
                  }
                  placeholder="optional"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Typical Tenor</Label>
              <Input
                value={form.typicalTenor}
                onChange={(e) =>
                  setForm((f) => ({ ...f, typicalTenor: e.target.value }))
                }
                placeholder="e.g. 3, 6, 12 months"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="negotiable"
                type="checkbox"
                checked={form.isNegotiable}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isNegotiable: e.target.checked }))
                }
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="negotiable" className="text-xs">
                Rate is negotiable for larger balances
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Source (URL or note)</Label>
              <Input
                value={form.source}
                onChange={(e) =>
                  setForm((f) => ({ ...f, source: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={form.notes}
                rows={2}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={add.isPending || update.isPending}>
              {add.isPending || update.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this instrument?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && remove.mutate({ id: deleteId })}
              className="bg-red-500 hover:bg-red-600"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
