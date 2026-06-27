import { trpc } from "@/lib/trpc";
import { usePortfolio } from "@/contexts/PortfolioContext";

/**
 * Single client-side source of truth for the Time Machine clock.
 *
 * In sandbox mode it reads `timeMachine.status` for the active portfolio and
 * surfaces the simulated "today" (a UTC-ms instant) plus convenience flags. In
 * Live mode (or when no session is active) it reports the real clock, so callers
 * can always trust `now()` to be "the date this app currently considers today".
 *
 * Date-sensitive UI (countdowns, "as of" stamps, form defaults) should read
 * `now()` from here instead of calling `Date.now()` directly, so a simulation
 * moves the whole app's notion of today coherently.
 */
export function useSimulatedNow() {
  const { mode, portfolioId } = usePortfolio();
  const enabled = mode === "sandbox" && !!portfolioId;
  const { data } = trpc.timeMachine.status.useQuery(
    { portfolioId: portfolioId as number },
    { enabled, staleTime: 10_000 },
  );

  const simulatedDate = enabled ? data?.simulatedDate ?? null : null;
  const active = simulatedDate != null;

  return {
    /** True when a simulated clock is in effect for the active sandbox portfolio. */
    active,
    /** The simulated "today" as UTC-ms, or null when on the real clock. */
    simulatedDate,
    /** The real-clock anchor (UTC-midnight ms) the session started from. */
    anchorDate: data?.anchorDate ?? null,
    /** YYYY-MM-DD label of the current (simulated or real) today. */
    label: data?.simulatedDateLabel ?? null,
    /** Materialised-record counts for the active session. */
    materialised: data?.materialised ?? { securities: 0, deposits: 0, withdrawals: 0 },
    /** The next event the clock can jump to (maturity / contribution). */
    nextEvent: data?.nextEvent ?? null,
    /** Whether the active portfolio is a sandbox portfolio. */
    isSandbox: data?.isSandbox ?? mode === "sandbox",
    /** The app's current notion of "now" as UTC-ms (simulated when active). */
    now: () => simulatedDate ?? Date.now(),
  };
}
