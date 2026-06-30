import type { trpc } from "@/lib/trpc";

export type TrpcUtils = ReturnType<typeof trpc.useUtils>;

/**
 * System-wide live-sync helper.
 *
 * Any action that changes portfolio money — deposits, withdrawals, securities,
 * bank holdings, secondary MMFs, other assets, rate settings, contribution
 * overrides, the committed allocation tier, or time-machine materialisations —
 * MUST call this after the mutation succeeds (in `onSuccess` / `onSettled`). It
 * marks every query whose result can move when money changes as stale, so the
 * Dashboard, Allocation Plan, Ledger, Scenarios, Review, Tax, Accrual,
 * Reconciliation and the canonical snapshot all refetch immediately instead of
 * showing stale numbers until a window refocus or route navigation.
 *
 * Why namespace-level invalidation:
 *   `utils.<namespace>.invalidate()` invalidates EVERY cached query in that
 *   namespace regardless of the input params (portfolioId, ref, etc.). That is
 *   exactly the behaviour we want for a global "money changed" event — narrow
 *   `{ portfolioId }` filters were the original bug, leaving sibling cache
 *   entries stale. We accept `portfolioId` for call-site clarity but do not use
 *   it to narrow the invalidation.
 *
 * Each access is defensive (optional chaining + typeof guard) so a build that
 * lacks an optional router never throws. Returns a Promise that resolves once
 * all invalidations settle, so callers may `await` it when gating UI on refetch.
 */

// Namespaces whose queries can ALL move when portfolio money changes. Invalidating
// the whole namespace is cheaper to maintain than enumerating every procedure and
// is naturally future-proof as new money-dependent queries are added.
const MONEY_NAMESPACES = [
  "portfolios", // snapshot, get, list (page shells + canonical money)
  "deposits", // list, summary
  "withdrawals", // list
  "mmfFunds", // list (primary MMF set + selected fund)
  "secondaryMmfs", // list
  "bankHoldings", // list, concentration, liquidAllocation, driftHistory
  "securities", // list (government securities)
  "otherHoldings", // list, listIncome
  "projection", // run, scenarios, milestones, solve, endStateLiquidSplit, reconciliation, decisionSurface, contributionSchedule
  "ledger", // month ledger rows
  "allocation", // goalTier, holdingsGap, goalProbability, glidePath
  "settings", // get, getRateHistory, derivedSafetyFloor (rate/horizon driven)
  "rateHistory", // list
  "accountStatus", // list (per-account freshness)
  "contributions", // list (schedule + overrides)
  "timeMachine", // status, upcomingEvents (test-mode materialisations)
] as const;

export async function invalidatePortfolioMoney(
  utils: TrpcUtils,
  // Accepted for call-site clarity / future use; invalidation is intentionally
  // global (not narrowed by portfolioId) so no sibling cache entry stays stale.
  _portfolioId?: number | null,
): Promise<void> {
  const u = utils as unknown as Record<
    string,
    { invalidate?: (input?: unknown) => Promise<void> } | undefined
  >;

  const jobs: Array<Promise<unknown>> = [];

  for (const ns of MONEY_NAMESPACES) {
    const nsObj = u?.[ns];
    if (nsObj && typeof nsObj.invalidate === "function") {
      jobs.push(Promise.resolve(nsObj.invalidate()).catch(() => undefined));
    }
  }

  await Promise.all(jobs);
}

/**
 * The list of namespaces this helper refreshes. Exported for coverage tests so a
 * regression that drops a money-dependent namespace fails loudly.
 */
export const MONEY_INVALIDATION_NAMESPACES = MONEY_NAMESPACES;
