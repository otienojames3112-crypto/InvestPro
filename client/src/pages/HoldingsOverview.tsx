import { Link } from "wouter";
import { useState, useMemo } from "react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Wallet,
  PiggyBank,
  Landmark,
  Building2,
  Boxes,
  ArrowRight,
  Target,
  CircleSlash,
  Sparkles,
} from "lucide-react";
import { formatKES, formatKESCompact } from "@/lib/format";
import { areaTab } from "@shared/navigation";
import { AiExplainDialog } from "@/components/AiExplainDialog";

/**
 * Holdings → Overview — a single, canonical net-worth summary.
 *
 * This is the landing tab for the Holdings area and the destination of the
 * Dashboard's "Full Net Worth" tile. It performs NO money math: every figure is
 * read straight from the canonical portfolio snapshot (`holdings.*`), the same
 * source the Dashboard command centre and Reconciliation read, so it can never
 * disagree with them. Each pocket row deep-links to the sub-tab that owns its
 * detail.
 */

const CARD = "p-4 bg-card border border-border rounded-xl";
const POCKET =
  "flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-background/40 hover:border-primary/40 transition-colors group";

function PocketRow({
  href,
  icon: Icon,
  label,
  hint,
  value,
  accent,
}: {
  href: string;
  icon: typeof PiggyBank;
  label: string;
  hint: string;
  value: number;
  accent: string;
}) {
  return (
    <Link href={href} className={POCKET}>
      <span className="flex items-center gap-3 min-w-0">
        <span className={`shrink-0 w-9 h-9 rounded-lg grid place-items-center ${accent}`}>
          <Icon className="w-4.5 h-4.5" />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-medium text-foreground">{label}</span>
          <span className="block text-[11px] text-muted-foreground truncate">{hint}</span>
        </span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {formatKESCompact(value)}
        </span>
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-transform" />
      </span>
    </Link>
  );
}

export default function HoldingsOverview() {
  const { portfolioId } = usePortfolio();
  const { data: snapshot, isLoading } = trpc.portfolios.snapshot.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId },
  );
  const [explainOpen, setExplainOpen] = useState(false);

  const holdingsFacts = useMemo(() => {
    if (!snapshot) return null;
    const h = snapshot.holdings;
    const govTotal = h.tbill + h.ifb + h.fxd;
    const mmfTotal = h.primaryMmf + h.secondaryMmf;
    return [
      `Full net worth: ${formatKES(h.fullNetWorth)}.`,
      `Assigned to goal: ${formatKES(h.goalPlanAssets)}; excluded from goal: ${formatKES(h.otherAssetsExcludedFromGoal)}.`,
      `Money market funds total: ${formatKES(mmfTotal)} (primary: ${formatKES(h.primaryMmf)}, secondary: ${formatKES(h.secondaryMmf)}).`,
      `Government securities total: ${formatKES(govTotal)} (T-bills: ${formatKES(h.tbill)}, IFB: ${formatKES(h.ifb)}, FXD: ${formatKES(h.fxd)}).`,
      `Bank instruments: ${formatKES(h.bank)}.`,
      `Other assets: ${formatKES(h.otherAssetsTotal)}.`,
    ].join("\n");
  }, [snapshot]);

  const explainQuery = trpc.aiExplain.holdings.useQuery(
    { portfolioId: portfolioId!, holdingsSummary: holdingsFacts! },
    { enabled: explainOpen && !!portfolioId && !!holdingsFacts, refetchOnWindowFocus: false, retry: false },
  );

  if (isLoading || !snapshot) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  const h = snapshot.holdings;
  const govTotal = h.tbill + h.ifb + h.fxd;
  const mmfTotal = h.primaryMmf + h.secondaryMmf;

  return (
    <div className="space-y-5">
      {/* Net-worth headline */}
      <Card className={CARD}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Wallet className="w-3.5 h-3.5" /> Full Net Worth
            </p>
            <p className="text-3xl font-semibold tabular-nums text-foreground mt-1">
              {formatKES(h.fullNetWorth)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1">
              Every pocket you track today, across all buckets and other assets.
            </p>
          </div>
          <div className="flex gap-6">
            <div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <Target className="w-3 h-3" /> Assigned to goal
              </p>
              <p className="text-lg font-semibold tabular-nums text-foreground mt-0.5">
                {formatKESCompact(h.goalPlanAssets)}
              </p>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                <CircleSlash className="w-3 h-3" /> Excluded from goal
              </p>
              <p className="text-lg font-semibold tabular-nums text-foreground mt-0.5">
                {formatKESCompact(h.otherAssetsExcludedFromGoal)}
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Explain my holdings button */}
      <div className="flex items-center gap-2">
        <span className="h-px flex-1 bg-border" />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExplainOpen(true)}
          disabled={!holdingsFacts}
          className="h-7 gap-1.5 text-xs font-medium hover:text-violet-500 hover:border-violet-500/40 active:scale-[0.97] transition-transform"
        >
          <Sparkles className="w-3.5 h-3.5" />
          Explain my holdings
        </Button>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* Pockets */}
      <div className="grid gap-3 sm:grid-cols-2">
        <PocketRow
          href={areaTab("holdings", "mmf")}
          icon={PiggyBank}
          label="Money market funds"
          hint="Primary + secondary MMF balances"
          value={mmfTotal}
          accent="bg-sky-500/10 text-sky-500"
        />
        <PocketRow
          href={areaTab("holdings", "gov")}
          icon={Landmark}
          label="Government securities"
          hint="T-Bills, IFB and FXD held to maturity"
          value={govTotal}
          accent="bg-emerald-500/10 text-emerald-500"
        />
        <PocketRow
          href={areaTab("holdings", "bank")}
          icon={Building2}
          label="Bank instruments"
          hint="Call, fixed, target and tiered deposits"
          value={h.bank}
          accent="bg-violet-500/10 text-violet-500"
        />
        <PocketRow
          href={areaTab("holdings", "other")}
          icon={Boxes}
          label="Other assets"
          hint="Shares, property, offshore, SACCO and more"
          value={h.otherAssetsTotal}
          accent="bg-amber-500/10 text-amber-500"
        />
      </div>

      {/* AI Explain Dialog */}
      <AiExplainDialog
        open={explainOpen}
        onOpenChange={setExplainOpen}
        title="Explain my holdings"
        description="A plain-language breakdown of your current holdings: what each pocket means, how much is assigned to your goal vs excluded, and what the concentration looks like across asset classes."
        answer={explainQuery.data?.answer}
        isLoading={explainQuery.isLoading || explainQuery.isFetching}
        isError={explainQuery.isError}
        errorMessage={explainQuery.error?.message}
        onRetry={() => explainQuery.refetch()}
      />
    </div>
  );
}
