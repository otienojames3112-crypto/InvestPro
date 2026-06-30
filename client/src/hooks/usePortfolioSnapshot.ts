import { trpc } from "@/lib/trpc";
import { usePortfolio } from "@/contexts/PortfolioContext";

/**
 * Phase 1 — the ONE client entry point to the canonical portfolio snapshot.
 *
 * Every surface that needs live money truth (net worth, goal progress, ledger,
 * tax, accrual, allocation gap, reconciliation) should read it through this hook
 * so they all share the exact same query (one cache key, one refetch path) rather
 * than each page calling `trpc.portfolios.snapshot.useQuery` with its own options.
 *
 * It resolves the active portfolio id from PortfolioContext and disables the query
 * until one is known, so callers never have to special-case the "no portfolio yet"
 * bootstrap state. Pair the returned `snapshot` with the pure selectors in
 * `shared/snapshot.ts` (selectNetWorth, selectGoalProgress, …) to read figures.
 */
export function usePortfolioSnapshot(options?: { portfolioId?: number | null }) {
  const ctx = usePortfolio();
  const portfolioId = options?.portfolioId ?? ctx.portfolioId;

  const query = trpc.portfolios.snapshot.useQuery(
    { portfolioId: portfolioId ?? 0 },
    { enabled: typeof portfolioId === "number" && portfolioId > 0 },
  );

  return {
    /** The canonical snapshot, or `undefined` until loaded / no portfolio selected. */
    snapshot: query.data,
    portfolioId,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
    /** The underlying tRPC query, for callers that need full react-query control. */
    query,
  };
}
