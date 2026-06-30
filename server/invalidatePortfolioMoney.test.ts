import { describe, it, expect, vi } from "vitest";
import {
  invalidatePortfolioMoney,
  MONEY_INVALIDATION_NAMESPACES,
} from "../client/src/lib/invalidatePortfolioMoney";

/**
 * Coverage + behaviour tests for the system-wide live-sync helper.
 *
 * The helper invalidates whole tRPC namespaces (utils.<ns>.invalidate()) so that
 * after ANY money-changing mutation, every dependent surface refetches. These
 * tests build a fake `utils` object with a vi.fn() per namespace and assert the
 * helper calls each one, and that it never throws when an optional namespace is
 * absent.
 */

type FakeNs = { invalidate: ReturnType<typeof vi.fn> };

function makeUtils(namespaces: readonly string[]): Record<string, FakeNs> {
  const u: Record<string, FakeNs> = {};
  for (const ns of namespaces) {
    u[ns] = { invalidate: vi.fn().mockResolvedValue(undefined) };
  }
  return u;
}

describe("invalidatePortfolioMoney", () => {
  it("invalidates every money-dependent namespace exactly once", async () => {
    const utils = makeUtils(MONEY_INVALIDATION_NAMESPACES);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await invalidatePortfolioMoney(utils as any, 42);
    for (const ns of MONEY_INVALIDATION_NAMESPACES) {
      expect(utils[ns].invalidate, `namespace ${ns} should be invalidated`).toHaveBeenCalledTimes(1);
    }
  });

  it("invalidates with no input filter (global, not narrowed by portfolioId)", async () => {
    const utils = makeUtils(MONEY_INVALIDATION_NAMESPACES);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await invalidatePortfolioMoney(utils as any, 7);
    for (const ns of MONEY_INVALIDATION_NAMESPACES) {
      // called with zero args -> invalidates all cache entries in the namespace
      expect(utils[ns].invalidate).toHaveBeenCalledWith();
    }
  });

  it("covers the namespaces the live-sync spec requires", () => {
    // The acceptance spec named these query families explicitly; the helper must
    // refresh the namespace that owns each one. This guards against a regression
    // silently dropping a required surface.
    const required = [
      "portfolios", // snapshot, get, list
      "deposits", // list, summary
      "withdrawals", // list
      "secondaryMmfs", // list
      "bankHoldings", // list, concentration, liquidAllocation
      "securities", // list
      "otherHoldings", // list
      "projection", // run, scenarios, milestones, solve, endStateLiquidSplit, reconciliation
      "allocation", // goalTier, holdingsGap, goalProbability
      "settings", // tax/accrual inputs (rate settings)
      "mmfFunds", // selected fund / rate
      "contributions", // schedule overrides
      "timeMachine", // test-mode materialisations
    ];
    for (const ns of required) {
      expect(MONEY_INVALIDATION_NAMESPACES, `spec namespace ${ns} must be covered`).toContain(ns);
    }
  });

  it("does not throw when an optional namespace is missing", async () => {
    // Simulate a build that lacks some optional routers.
    const partial = makeUtils(["portfolios", "deposits"]);
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invalidatePortfolioMoney(partial as any, null),
    ).resolves.toBeUndefined();
    expect(partial.portfolios.invalidate).toHaveBeenCalledTimes(1);
    expect(partial.deposits.invalidate).toHaveBeenCalledTimes(1);
  });

  it("does not reject when one namespace's invalidate rejects", async () => {
    const utils = makeUtils(MONEY_INVALIDATION_NAMESPACES);
    utils.projection.invalidate.mockRejectedValueOnce(new Error("network blip"));
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invalidatePortfolioMoney(utils as any, 1),
    ).resolves.toBeUndefined();
    // siblings still fire
    expect(utils.deposits.invalidate).toHaveBeenCalledTimes(1);
  });

  it("tolerates a null/undefined utils object without throwing", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(invalidatePortfolioMoney(undefined as any, 1)).resolves.toBeUndefined();
  });
});
