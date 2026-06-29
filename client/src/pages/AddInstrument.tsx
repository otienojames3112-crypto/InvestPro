import { useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
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
import { toast } from "sonner";
import { PlusCircle, ShieldAlert, Info, ArrowLeft } from "lucide-react";
import { ASSET_PROFILES, ASSET_CLASSES, type AssetClass } from "@shared/assetModel";

/**
 * Expansion Brief — Part 7.3: add an instrument BY HAND.
 *
 * The catalog must not be gated on a scraper existing for every source. A
 * maintainer can author an instrument directly here. Every figure they supply is
 * recorded as `human_entered` (a person authored it) with the authoritative
 * source they cite. This page neither ranks nor scores anything — it only records
 * facts + provenance. It is maintainer-only (the backend mutation is admin-gated).
 */

const LIQUIDITY_OPTIONS = [
  { value: "daily", label: "Daily" },
  { value: "t_plus_settlement", label: "T+settlement" },
  { value: "term", label: "Term (locked to maturity)" },
  { value: "illiquid", label: "Illiquid" },
];

/** Controlled numeric field that yields `undefined` when blank. */
function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

export default function AddInstrument() {
  const { isAuthenticated, user } = useAuth();
  const isMaintainer = user?.role === "admin";
  const [, navigate] = useLocation();

  const [ref, setRef] = useState("");
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState<AssetClass>("cash_mmf");
  const [issuer, setIssuer] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [market, setMarket] = useState("");
  const [liquidity, setLiquidity] = useState("");
  const [factNote, setFactNote] = useState("");

  const [source, setSource] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [asOfDate, setAsOfDate] = useState("");

  const [yieldPct, setYieldPct] = useState("");
  const [yieldKind, setYieldKind] = useState("");
  const [lastPrice, setLastPrice] = useState("");
  const [trailingReturnPct, setTrailingReturnPct] = useState("");
  const [tenorYears, setTenorYears] = useState("");
  const [maturityDate, setMaturityDate] = useState("");
  const [expenseRatioPct, setExpenseRatioPct] = useState("");

  const add = trpc.opportunities.addOpportunity.useMutation({
    onSuccess: (res) => {
      toast.success(`Added "${res.ref}" — every figure is marked as entered by you.`);
      navigate(`/explore/${encodeURIComponent(res.ref)}`);
    },
    onError: (e) => toast.error(e.message),
  });

  if (!isMaintainer) {
    return (
      <AppShell>
        <div className="container py-10 max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PlusCircle className="w-5 h-5 text-primary" /> Add an instrument
              </CardTitle>
              <CardDescription>
                {isAuthenticated
                  ? "Adding instruments by hand is a maintainer-only task. Ask an administrator for access."
                  : "Sign in as a maintainer to add an instrument to the catalog by hand."}
              </CardDescription>
            </CardHeader>
            {!isAuthenticated && (
              <CardContent>
                <Button onClick={() => (window.location.href = getLoginUrl())}>Sign in</Button>
              </CardContent>
            )}
          </Card>
        </div>
      </AppShell>
    );
  }

  const canSubmit = ref.trim() !== "" && name.trim() !== "" && source.trim() !== "" && !add.isPending;

  const submit = () => {
    const asOfMs = asOfDate.trim() !== "" ? new Date(asOfDate).getTime() : undefined;
    add.mutate({
      ref: ref.trim(),
      name: name.trim(),
      assetClass,
      issuer: issuer.trim() || undefined,
      currency: currency.trim() || "KES",
      market: market.trim() || undefined,
      liquidity: liquidity || undefined,
      factNote: factNote.trim() || undefined,
      source: source.trim(),
      sourceUrl: sourceUrl.trim() || undefined,
      asOf: asOfMs && Number.isFinite(asOfMs) ? asOfMs : undefined,
      figures: {
        yieldPct: numOrUndef(yieldPct),
        yieldKind: yieldKind.trim() || undefined,
        lastPrice: numOrUndef(lastPrice),
        trailingReturnPct: numOrUndef(trailingReturnPct),
        tenorYears: numOrUndef(tenorYears),
        maturityDate: maturityDate.trim() || undefined,
        expenseRatioPct: numOrUndef(expenseRatioPct),
      },
    });
  };

  return (
    <AppShell>
      <div className="container py-8 max-w-3xl space-y-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("/explore")} className="-ml-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Explore
        </Button>

        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <PlusCircle className="w-6 h-6 text-primary" /> Add an instrument by hand
          </h1>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            For instruments no scraper covers yet. Enter the facts and the authoritative
            source you took them from. Every figure you supply is recorded as{" "}
            <strong className="text-foreground">entered by you</strong> and stamped with your name.
          </p>
        </div>

        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>
            Enter facts only — price, yield, coupon, tenor, distribution, fee. This catalog
            never ranks, scores or recommends instruments.
          </span>
        </div>

        {/* Identity */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Identity</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="ref">Reference key *</Label>
              <Input id="ref" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. NSE:SCOM or ISIN" />
              <p className="text-[10px] text-muted-foreground">Stable unique key; also used in the detail URL.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="name">Name *</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
            </div>
            <div className="space-y-1.5">
              <Label>Asset class *</Label>
              <Select value={assetClass} onValueChange={(v) => setAssetClass(v as AssetClass)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ASSET_CLASSES.map((ac) => (
                    <SelectItem key={ac} value={ac}>{ASSET_PROFILES[ac].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issuer">Issuer / manager</Label>
              <Input id="issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="e.g. Safaricom PLC" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currency">Currency</Label>
              <Input id="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} placeholder="KES" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="market">Market / segment</Label>
              <Input id="market" value={market} onChange={(e) => setMarket(e.target.value)} placeholder="e.g. NSE, CBK, Offshore" />
            </div>
            <div className="space-y-1.5">
              <Label>Liquidity</Label>
              <Select value={liquidity} onValueChange={setLiquidity}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {LIQUIDITY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Source — required, applies to every figure */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Authoritative source *</CardTitle>
            <CardDescription className="text-xs">
              Where you took these figures from. Applied to every figure you enter below.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="source">Source *</Label>
              <Input id="source" value={source} onChange={(e) => setSource(e.target.value)} placeholder='e.g. "ILAM fact sheet Q1-2026"' />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sourceUrl">Source URL</Label>
              <Input id="sourceUrl" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asOf">As-of date</Label>
              <Input id="asOf" type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} />
            </div>
          </CardContent>
        </Card>

        {/* Factual figures */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Facts</CardTitle>
            <CardDescription className="text-xs">
              Fill only the figures that apply to this asset class. All optional.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="yieldPct">Yield / coupon (%)</Label>
              <Input id="yieldPct" inputMode="decimal" value={yieldPct} onChange={(e) => setYieldPct(e.target.value)} placeholder="e.g. 12.50" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="yieldKind">What the yield is</Label>
              <Input id="yieldKind" value={yieldKind} onChange={(e) => setYieldKind(e.target.value)} placeholder='e.g. "net annual yield"' />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lastPrice">Last price</Label>
              <Input id="lastPrice" inputMode="decimal" value={lastPrice} onChange={(e) => setLastPrice(e.target.value)} placeholder="e.g. 18.45" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="trailing">Trailing 12-month return (%)</Label>
              <Input id="trailing" inputMode="decimal" value={trailingReturnPct} onChange={(e) => setTrailingReturnPct(e.target.value)} placeholder="e.g. 8.20" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tenor">Tenor (years)</Label>
              <Input id="tenor" inputMode="decimal" value={tenorYears} onChange={(e) => setTenorYears(e.target.value)} placeholder="e.g. 10" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maturity">Maturity date</Label>
              <Input id="maturity" type="date" value={maturityDate} onChange={(e) => setMaturityDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="expense">Expense ratio / fee (%)</Label>
              <Input id="expense" inputMode="decimal" value={expenseRatioPct} onChange={(e) => setExpenseRatioPct(e.target.value)} placeholder="e.g. 2.00" />
            </div>
          </CardContent>
        </Card>

        {/* Note */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Neutral note</CardTitle>
            <CardDescription className="text-xs">
              Optional factual note (e.g. "Infrastructure bond, tax-exempt coupon"). Not a rating or opinion.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea value={factNote} onChange={(e) => setFactNote(e.target.value)} rows={2} placeholder="Factual note…" />
          </CardContent>
        </Card>

        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={!canSubmit} className="active:scale-[0.97] transition-transform">
            <PlusCircle className="w-4 h-4 mr-2" />
            {add.isPending ? "Adding…" : "Add instrument"}
          </Button>
          <Button variant="ghost" onClick={() => navigate("/explore")}>Cancel</Button>
        </div>

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <ShieldAlert className="w-3.5 h-3.5" />
          A later scrape can never silently overwrite a figure you entered — it raises a reviewable conflict instead.
        </p>
      </div>
    </AppShell>
  );
}
