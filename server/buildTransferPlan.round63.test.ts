import { describe, it, expect } from "vitest";
import {
  buildTransferPlan,
  type LiquidAllocationSlice,
} from "../shared/liquidAllocator";

/**
 * Round 63 — tests for buildTransferPlan, which turns allocator slices (each with
 * a delta = target − current and a `rebalance` flag) into a minimal list of
 * concrete "move X from A → B" transfers.
 */

function slice(
  partial: Partial<LiquidAllocationSlice> & { id: string; delta: number; rebalance: boolean },
): LiquidAllocationSlice {
  return {
    id: partial.id,
    label: partial.label ?? partial.id,
    kind: partial.kind ?? "secondary_mmf",
    issuer: partial.issuer ?? partial.id,
    netYieldPct: partial.netYieldPct ?? 10,
    targetBalance: partial.targetBalance ?? 0,
    targetShare: partial.targetShare ?? 0,
    delta: partial.delta,
    rebalance: partial.rebalance,
  };
}

describe("buildTransferPlan", () => {
  it("nets a single source against a single destination", () => {
    const plan = buildTransferPlan({
      slices: [
        slice({ id: "a", label: "MMF A", delta: -100_000, rebalance: true }),
        slice({ id: "b", label: "Call B", delta: 100_000, rebalance: true }),
      ],
    });
    expect(plan).toHaveLength(1);
    expect(plan[0].fromId).toBe("a");
    expect(plan[0].toId).toBe("b");
    expect(plan[0].amount).toBe(100_000);
    expect(plan[0].fromLabel).toBe("MMF A");
    expect(plan[0].toLabel).toBe("Call B");
  });

  it("splits one big source across two destinations (largest-first matching)", () => {
    const plan = buildTransferPlan({
      slices: [
        slice({ id: "src", label: "Big MMF", delta: -300_000, rebalance: true }),
        slice({ id: "d1", label: "Dest 1", delta: 200_000, rebalance: true }),
        slice({ id: "d2", label: "Dest 2", delta: 100_000, rebalance: true }),
      ],
    });
    expect(plan).toHaveLength(2);
    // Total moved equals the source outflow.
    const total = plan.reduce((s, t) => s + t.amount, 0);
    expect(total).toBe(300_000);
    // Largest destination is filled first.
    expect(plan[0].toId).toBe("d1");
    expect(plan[0].amount).toBe(200_000);
    expect(plan[1].toId).toBe("d2");
    expect(plan[1].amount).toBe(100_000);
  });

  it("ignores slices not flagged for rebalancing (no-churn suppression)", () => {
    const plan = buildTransferPlan({
      slices: [
        slice({ id: "a", delta: -50_000, rebalance: false }),
        slice({ id: "b", delta: 50_000, rebalance: false }),
      ],
    });
    expect(plan).toHaveLength(0);
  });

  it("ignores tiny deltas below the rounding floor", () => {
    const plan = buildTransferPlan({
      slices: [
        slice({ id: "a", delta: -0.3, rebalance: true }),
        slice({ id: "b", delta: 0.3, rebalance: true }),
      ],
    });
    expect(plan).toHaveLength(0);
  });

  it("returns no transfers when there are only destinations (no source to pull from)", () => {
    const plan = buildTransferPlan({
      slices: [
        slice({ id: "a", delta: 100_000, rebalance: true }),
        slice({ id: "b", delta: 50_000, rebalance: true }),
      ],
    });
    expect(plan).toHaveLength(0);
  });

  it("matches two sources into two destinations with minimal transfers", () => {
    const plan = buildTransferPlan({
      slices: [
        slice({ id: "s1", delta: -150_000, rebalance: true }),
        slice({ id: "s2", delta: -50_000, rebalance: true }),
        slice({ id: "d1", delta: 120_000, rebalance: true }),
        slice({ id: "d2", delta: 80_000, rebalance: true }),
      ],
    });
    // Sources total 200k, destinations total 200k — fully balanced.
    const total = plan.reduce((s, t) => s + t.amount, 0);
    expect(total).toBe(200_000);
    // Every transfer pulls from a source and lands in a destination.
    for (const t of plan) {
      expect(["s1", "s2"]).toContain(t.fromId);
      expect(["d1", "d2"]).toContain(t.toId);
      expect(t.amount).toBeGreaterThan(0);
    }
  });

  it("produces a clean empty plan for an empty input", () => {
    expect(buildTransferPlan({ slices: [] })).toEqual([]);
  });
});
