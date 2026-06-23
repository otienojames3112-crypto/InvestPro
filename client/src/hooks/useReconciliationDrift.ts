import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Shared reconciliation-drift calculation. Compares the projection engine's
 * "today" value (the ending total of the last month the engine seeded from
 * real deposits, i.e. isActual) against the live actuals total from
 * deposits.summary. Both the Dashboard reconciliation card and the sidebar
 * drift badge consume this so the two stay perfectly in step.
 *
 * Returns null while data is loading or when there are no actuals yet (no
 * engine "today" value exists to reconcile against).
 */
export type ReconciliationDrift = {
  engineToday: number;
  actualsTotal: number;
  delta: number;
  deltaPct: number;
  absPct: number;
  /** Severity tier mirroring the Dashboard thresholds. */
  level: "match" | "minor" | "major";
};

export function useReconciliationDrift(
  portfolioId: number | null | undefined
): ReconciliationDrift | null {
  const { data: projection } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId as number },
    { enabled: !!portfolioId }
  );
  const { data: summary } = trpc.deposits.summary.useQuery(
    { portfolioId: portfolioId as number },
    { enabled: !!portfolioId }
  );

  return useMemo(() => {
    if (!portfolioId || !projection?.length || !summary) return null;
    let engineToday: number | null = null;
    for (const r of projection) {
      if (r.isActual) engineToday = r.totalEnd;
    }
    if (engineToday == null) return null;

    const actualsTotal = summary.totalContributed ?? 0;
    // No actuals recorded yet → nothing to reconcile.
    if (actualsTotal <= 0 && engineToday <= 0) return null;

    const delta = actualsTotal - engineToday;
    const denom = engineToday > 0 ? engineToday : actualsTotal || 1;
    const deltaPct = (delta / denom) * 100;
    const absPct = Math.abs(deltaPct);
    const level: ReconciliationDrift["level"] =
      absPct <= 1 ? "match" : absPct <= 5 ? "minor" : "major";

    return { engineToday, actualsTotal, delta, deltaPct, absPct, level };
  }, [portfolioId, projection, summary]);
}
