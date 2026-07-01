import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import {
  ShieldCheck,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { formatKESCompact, formatPct } from "@/lib/format";
import { rateStaleness } from "@/lib/rateStaleness";
import { ALLOCATION_TIER_SPECS } from "@shared/allocationModel";
import type { AllocationTier } from "@shared/allocationModel";
import type { PortfolioSnapshot } from "@shared/snapshot";

/**
 * Manager-mode diagnostics: four compact cards that summarise the portfolio's
 * data quality, risk posture, upcoming cash events, and the live assumptions —
 * each deep-linking to the page that owns the detail. This replaces the former
 * ~2,800-line collapsible analysis stack. It performs NO projection math: every
 * figure is read from the already-computed snapshot / concentration / typeBreach
 * selectors and the settings the Dashboard already holds.
 */

interface ConcentrationData {
  cap: number;
  netWorth: number;
  topShare: number;
  breaches: { issuer: string; value: number; share: number }[];
}

interface TypeBreachData {
  label: string;
  shareOfSecurities: number;
  shareOfNetWorth: number;
  breached: boolean;
}

export interface DashboardDiagnosticsProps {
  snapshot: PortfolioSnapshot;
  /** From trpc.bankHoldings.concentration — may be undefined while loading. */
  concentration?: ConcentrationData | null;
  /** From analyzePerTypeBreach — may be null when there are no securities. */
  typeBreach?: TypeBreachData | null;
  /** Reconciliation verdict already computed on the Dashboard. */
  reconVerdict?: { reconciled: boolean; basisOk: boolean } | null;
  /** Effective engine settings the Dashboard already holds. */
  settings: {
    ratesLastUpdatedAt?: number | null;
    mmfYield: number;
    selectedFundEar?: number | null;
    tbill91Rate: number;
    withholdingTax: number;
  };
  /** Fraction (0–1) of the portfolio that is liquid at the goal date. */
  liquidPctAtGoal: number;
  /** Whether the projection lands fully liquid at goal. */
  landsFullyLiquid: boolean;
}

const CARD =
  "p-4 bg-card border border-border rounded-xl hover:border-primary/40 transition-colors group";
const HEAD =
  "flex items-center justify-between mb-3 text-sm font-semibold text-foreground";
const ROW = "flex items-center justify-between text-xs py-1";
const LABEL = "text-muted-foreground";
const VALUE = "font-medium text-foreground tabular-nums";

function LinkArrow() {
  return (
    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-transform" />
  );
}

export function DashboardDiagnostics({
  snapshot,
  concentration,
  typeBreach,
  reconVerdict,
  settings,
  liquidPctAtGoal,
  landsFullyLiquid,
}: DashboardDiagnosticsProps) {
  // ── Data Health ──────────────────────────────────────────────────────────
  const stale =
    settings.ratesLastUpdatedAt != null
      ? rateStaleness(new Date(settings.ratesLastUpdatedAt))
      : null;
  const warnings = snapshot.warnings ?? [];
  const warnCount = warnings.length;
  const reconciled = reconVerdict?.reconciled ?? snapshot.reconciliation?.ok ?? true;
  const dataHealthy = !(stale?.isStale) && warnCount === 0 && reconciled;

  // ── Risk Snapshot ─────────────────────────────────────────────────────────
  const topIssuer =
    concentration?.breaches && concentration.breaches.length > 0
      ? [...concentration.breaches].sort((a, b) => b.share - a.share)[0]
      : null;
  // concentration shares / cap / type share / liquid-at-goal are 0–1 fractions;
  // formatPct expects percent units, so scale by 100.
  const topIssuerShare = (topIssuer?.share ?? concentration?.topShare ?? 0) * 100;
  const capPct = (concentration?.cap ?? 0) * 100;
  const issuerBreached = concentration ? concentration.breaches.length > 0 : false;
  const largestTypeShare = (typeBreach?.shareOfSecurities ?? 0) * 100;
  const typeBreached = typeBreach?.breached ?? false;
  const liquidAtGoalPct = (landsFullyLiquid ? 1 : liquidPctAtGoal) * 100;

  // ── Next 3 Cash Events ────────────────────────────────────────────────────
  const events = (snapshot.liquidity ?? [])
    .filter((e) => e.atMs >= snapshot.asOfMs)
    .sort((a, b) => a.atMs - b.atMs)
    .slice(0, 3);

  // ── Assumption Summary ────────────────────────────────────────────────────
  const mmfEar = settings.selectedFundEar ?? settings.mmfYield;
  const activeTier = snapshot.identity.activePolicyTier as AllocationTier;
  const tierLabel = ALLOCATION_TIER_SPECS[activeTier]?.label ?? activeTier;
  const committed = snapshot.identity.planStatus === "committed";

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {/* 1 — Data Health */}
      <Link href={stale?.isStale ? "/setup?tab=rates" : "/review?tab=reconciliation"} className="block">
        <Card className={CARD}>
          <div className={HEAD}>
            <span className="flex items-center gap-1.5">
              {dataHealthy ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              )}
              Data Health
            </span>
            <LinkArrow />
          </div>
          <div className={ROW}>
            <span className={LABEL}>Rates</span>
            <span className={VALUE}>
              {stale
                ? stale.isStale
                  ? `Stale · ${stale.label}`
                  : "Current"
                : "Not set"}
            </span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Freshness warnings</span>
            <span className={VALUE}>{warnCount === 0 ? "None" : warnCount}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Reconciliation</span>
            <span className={VALUE}>{reconciled ? "Balanced" : "Mismatch"}</span>
          </div>
        </Card>
      </Link>

      {/* 2 — Risk Snapshot */}
      <Link href="/holdings?tab=gov" className="block">
        <Card className={CARD}>
          <div className={HEAD}>
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-sky-500" />
              Risk Snapshot
            </span>
            <LinkArrow />
          </div>
          <div className={ROW}>
            <span className={LABEL}>Top issuer</span>
            <span className={VALUE}>
              {topIssuer ? `${topIssuer.issuer} · ` : ""}
              {formatPct(topIssuerShare, 1)}
              {issuerBreached ? " ⚠" : capPct ? ` / ${formatPct(capPct, 0)} cap` : ""}
            </span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Largest type</span>
            <span className={VALUE}>
              {typeBreach ? formatPct(largestTypeShare, 1) : "—"}
              {typeBreached ? " ⚠" : ""}
            </span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Liquid at goal</span>
            <span className={VALUE}>{formatPct(liquidAtGoalPct, 0)}</span>
          </div>
        </Card>
      </Link>

      {/* 3 — Next 3 Cash Events */}
      <Link href="/holdings?tab=gov" className="block">
        <Card className={CARD}>
          <div className={HEAD}>
            <span className="flex items-center gap-1.5">
              <CalendarClock className="w-4 h-4 text-violet-500" />
              Next 3 Cash Events
            </span>
            <LinkArrow />
          </div>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground py-1">
              No maturities or scheduled contributions ahead.
            </p>
          ) : (
            events.map((e, i) => (
              <div key={`${e.atMs}-${i}`} className={ROW}>
                <span className={LABEL + " truncate pr-2"}>
                  {new Date(e.atMs).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  · {e.label}
                </span>
                <span className={VALUE}>
                  {e.amount != null ? formatKESCompact(e.amount) : "—"}
                </span>
              </div>
            ))
          )}
        </Card>
      </Link>

      {/* 4 — Assumption Summary */}
      <Link href="/setup?tab=rates" className="block">
        <Card className={CARD}>
          <div className={HEAD}>
            <span className="flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-teal-500" />
              Assumption Summary
            </span>
            <LinkArrow />
          </div>
          <div className={ROW}>
            <span className={LABEL}>MMF EAR</span>
            <span className={VALUE}>{formatPct(mmfEar)}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>91-day T-Bill</span>
            <span className={VALUE}>{formatPct(settings.tbill91Rate)}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>WHT</span>
            <span className={VALUE}>{formatPct(settings.withholdingTax)}</span>
          </div>
          <div className={ROW}>
            <span className={LABEL}>Committed tier</span>
            <span className={VALUE}>
              {tierLabel}
              {committed ? "" : " (draft)"}
            </span>
          </div>
        </Card>
      </Link>
    </div>
  );
}

export default DashboardDiagnostics;
