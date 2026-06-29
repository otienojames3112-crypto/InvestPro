import { useParams, Link, useLocation } from "wouter";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ArrowLeft,
  ShieldAlert,
  Clock,
  Globe,
  Info,
  FlaskConical,
  LineChart,
  Sparkles,
} from "lucide-react";
import { profileFor, type AssetClass } from "@shared/assetModel";
import { rateStaleness } from "@/lib/rateStaleness";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { toast } from "sonner";

/**
 * Expansion Brief — Part 2: opportunity detail.
 *
 * Shows the FULL sourced profile of one instrument — every field carries its
 * source and as-of date. There is exactly ONE forward action: "Model in my plan",
 * which is explicitly HYPOTHETICAL (it will run a what-if projection in Part 3),
 * framed and badged with the current Live/Test mode just like the deposit CTA.
 * No buy / invest / brokerage path exists.
 */

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function fmtPct(v: string | null | undefined): string {
  const n = num(v);
  return n === null ? "—" : `${n.toFixed(2)}%`;
}

/** A labelled fact with its own provenance/timestamp line. */
function Fact({
  label,
  value,
  source,
  asOf,
  caution,
}: {
  label: string;
  value: React.ReactNode;
  source?: string | null;
  asOf?: Date | string | null;
  caution?: string;
}) {
  const stale = asOf !== undefined ? rateStaleness(asOf ?? null) : null;
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium text-foreground tabular-nums text-right">{value}</span>
      </div>
      {caution && <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-1">{caution}</p>}
      {(source || stale) && (
        <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
          {source && <span>{source}</span>}
          {source && stale && <span>·</span>}
          {stale && (
            <span className="inline-flex items-center gap-1">
              <Clock className="w-2.5 h-2.5" />
              <span className={stale.isVeryStale ? "text-red-500" : stale.isStale ? "text-amber-500" : ""}>
                {stale.label}{stale.isStale ? " · may be stale" : ""}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function OpportunityDetail() {
  const params = useParams();
  const ref = decodeURIComponent(params.ref ?? "");
  const [, navigate] = useLocation();
  const { mode } = usePortfolio();

  const { data: r, isLoading, error } = trpc.opportunities.byRef.useQuery(
    { ref },
    { enabled: !!ref, retry: false },
  );

  if (isLoading) {
    return (
      <AppShell>
        <div className="p-6 lg:p-8 max-w-3xl">
          <div className="text-sm text-muted-foreground">Loading…</div>
        </div>
      </AppShell>
    );
  }

  if (error || !r) {
    return (
      <AppShell>
        <div className="p-6 lg:p-8 max-w-3xl space-y-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/explore")} className="-ml-2">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Explore
          </Button>
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            This instrument is no longer in the catalog.
          </CardContent></Card>
        </div>
      </AppShell>
    );
  }

  const profile = profileFor(r.assetClass as AssetClass);
  const trailing = num(r.trailingReturnPct);

  return (
    <AppShell>
      <div className="p-6 lg:p-8 max-w-3xl space-y-5">
        {/* Back link — always present so the detail view is never a dead-end */}
        <Button variant="ghost" size="sm" onClick={() => navigate("/explore")} className="-ml-2">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Explore
        </Button>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" style={{ fontFamily: "'Playfair Display', serif" }}>
              {r.name}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {r.issuer ?? "—"} · {profile.label} · {r.market ?? r.currency}
            </p>
            <div className="flex flex-wrap gap-1.5 mt-2">
              <Badge variant="outline" className="text-xs">{r.currency}</Badge>
              {profile.priceDriven && <Badge variant="outline" className="text-xs">Price-driven</Badge>}
              {profile.fxExposed && (
                <Badge variant="outline" className="text-xs gap-1 border-blue-500/30 text-blue-600 dark:text-blue-400">
                  <Globe className="w-3 h-3" /> FX risk
                </Badge>
              )}
              {profile.insured === "none" ? (
                <Badge variant="outline" className="text-xs border-amber-500/30 text-amber-600 dark:text-amber-400">
                  Not insured
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">KDIC-insured (to limit)</Badge>
              )}
            </div>
          </div>
          <Badge variant="outline" className="text-xs px-2.5 py-1 gap-1.5">
            <Info className="w-3 h-3" /> Information only
          </Badge>
        </div>

        {/* Persistent disclaimer */}
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
              <strong>For information only — not advice or a recommendation.</strong>{" "}
              These figures come from public sources and may be delayed or inaccurate.
              {r.unverified ? " They are unverified. " : " "}
              Confirm with the issuer or a licensed adviser before acting.
            </p>
          </CardContent>
        </Card>

        {/* Sourced profile */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sourced facts</CardTitle>
            <CardDescription className="text-xs">Each figure is shown with where it came from and when.</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {r.yieldPct !== null && (
              <Fact
                label={r.yieldKind ?? "Yield"}
                value={fmtPct(r.yieldPct)}
                source={r.dataSource}
                asOf={r.dataAsOf}
              />
            )}
            {r.lastPrice !== null && (
              <Fact
                label="Last price"
                value={`${r.currency} ${Number(r.lastPrice).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`}
                source={r.dataSource}
                asOf={r.dataAsOf}
              />
            )}
            {trailing !== null && (
              <Fact
                label="Trailing 12-month return"
                value={`${trailing.toFixed(2)}%`}
                source={r.dataSource}
                asOf={r.dataAsOf}
                caution="Past performance — describes what already happened and does not predict future results."
              />
            )}
            {r.expenseRatioPct !== null && (
              <Fact label="Expense ratio / fee" value={fmtPct(r.expenseRatioPct)} source={r.dataSource} asOf={r.dataAsOf} />
            )}
            {r.tenorYears !== null && (
              <Fact label="Tenor" value={`${Number(r.tenorYears)} yr`} />
            )}
            {r.maturityDate && (
              <Fact label="Maturity" value={new Date(r.maturityDate).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })} />
            )}
            {r.liquidity && <Fact label="Liquidity" value={r.liquidity.replace(/_/g, " ")} />}
            {r.factNote && (
              <div className="py-3 text-xs text-muted-foreground leading-relaxed">{r.factNote}</div>
            )}
          </CardContent>
        </Card>

        {/* Single hypothetical action — respects Live/Test mode */}
        <Card>
          <CardContent className="py-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-2">
              <LineChart className="w-4 h-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">See how this could fit — hypothetically</p>
                <p className="text-xs text-muted-foreground max-w-md">
                  Runs a what-if projection only. It does not buy anything, move money, or change your tracked plan.
                </p>
              </div>
            </div>
            <Button
              onClick={() =>
                toast.info("Hypothetical modeling is coming next", {
                  description: "This will run a what-if projection — never a purchase.",
                })
              }
              className="active:scale-[0.97] transition-transform"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Model in my plan
              <span className={`ml-2 inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${mode === "sandbox" ? "bg-amber-500/25 text-amber-100" : "bg-primary-foreground/20"}`}>
                {mode === "sandbox" ? "Hypothetical · Test" : "Hypothetical"}
              </span>
            </Button>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          {mode === "sandbox" ? <FlaskConical className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
          Modeling never moves real money{mode === "sandbox" ? " and stays inside your sandbox" : ""}.
        </p>

        <div>
          <Link href="/explore">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to all opportunities
            </Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
}
