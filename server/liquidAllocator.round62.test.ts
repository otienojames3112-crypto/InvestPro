import { describe, it, expect } from "vitest";
import {
  allocateLiquidReserve,
  netYield,
  isLiquidBankKind,
  type LiquidHome,
} from "@shared/liquidAllocator";

/**
 * Round 62 — liquid-reserve diversification allocator.
 *
 * These tests pin the spec's allocation rules so the engine and the Dashboard
 * card stay honest: 1/n cap floor, MMF-fills-first ordering, same-institution
 * grouping, minimum-balance folding, the single-home nudge, the "too small"
 * state, the no-churn drift threshold, and the Yield-first override.
 */

function mmf(id: string, issuer: string, gross: number, bal = 0, min = 0): LiquidHome {
  return {
    id,
    label: `${issuer} MMF`,
    kind: "primary_mmf",
    issuer,
    grossYieldPct: gross,
    whtRatePct: 15,
    currentBalance: bal,
    minBalance: min,
  };
}

function bank(
  id: string,
  issuer: string,
  gross: number,
  bal = 0,
  min = 0,
  kind: LiquidHome["kind"] = "call_deposit",
): LiquidHome {
  return {
    id,
    label: `${issuer} ${kind}`,
    kind,
    issuer,
    grossYieldPct: gross,
    whtRatePct: 15,
    currentBalance: bal,
    minBalance: min,
  };
}

describe("netYield + isLiquidBankKind helpers", () => {
  it("nets a gross yield by its WHT rate", () => {
    expect(netYield(10, 15)).toBeCloseTo(8.5, 6);
    expect(netYield(8.78, 15)).toBeCloseTo(7.463, 3);
    // Tax-exempt (IFB-style) keeps the full gross.
    expect(netYield(12, 0)).toBeCloseTo(12, 6);
  });

  it("classifies only liquid bank kinds as liquid", () => {
    expect(isLiquidBankKind("call_deposit")).toBe(true);
    expect(isLiquidBankKind("ordinary_savings")).toBe(true);
    expect(isLiquidBankKind("tiered_savings")).toBe(true);
    expect(isLiquidBankKind("fixed_deposit")).toBe(false);
    expect(isLiquidBankKind("target_savings")).toBe(false);
  });
});

describe("allocateLiquidReserve — degenerate cases", () => {
  it("returns too_small with no homes", () => {
    const r = allocateLiquidReserve({ homes: [], netWorth: 1_000_000, liquidPot: 100_000 });
    expect(r.state).toBe("too_small");
    expect(r.slices).toHaveLength(0);
  });

  it("nudges to add a second account when only one issuer exists", () => {
    const r = allocateLiquidReserve({
      homes: [mmf("mmf:1", "Sanlam", 8.78, 400_000)],
      netWorth: 400_000,
      liquidPot: 400_000,
    });
    expect(r.state).toBe("single_home");
    expect(r.slices).toHaveLength(1);
    expect(r.slices[0].targetBalance).toBeCloseTo(400_000, 2);
    expect(r.message).toMatch(/one place/i);
  });

  it("treats accounts at the SAME institution as one issuer (still single_home)", () => {
    const r = allocateLiquidReserve({
      homes: [
        mmf("mmf:1", "Equity", 9, 200_000),
        bank("bank:1", "Equity", 7, 200_000), // same institution
      ],
      netWorth: 400_000,
      liquidPot: 400_000,
    });
    expect(r.issuerCount).toBe(1);
    expect(r.state).toBe("single_home");
  });
});

describe("allocateLiquidReserve — balanced spread", () => {
  it("with two issuers the effective cap is 50% (1/n floor) and the pot splits", () => {
    const r = allocateLiquidReserve({
      homes: [
        mmf("mmf:1", "Sanlam", 9.0), // higher net yield → filled first
        bank("bank:1", "Equity", 7.0),
      ],
      netWorth: 1_000_000,
      liquidPot: 1_000_000,
      issuerCapFrac: 0.25,
    });
    expect(r.effectiveIssuerCapFrac).toBeCloseTo(0.5, 6);
    expect(r.state).toBe("diversified");
    const sanlam = r.slices.find((s) => s.issuer === "Sanlam")!;
    const equity = r.slices.find((s) => s.issuer === "Equity")!;
    // MMF fills to the 50% cap first, overflow to the bank.
    expect(sanlam.targetBalance).toBeCloseTo(500_000, 2);
    expect(equity.targetBalance).toBeCloseTo(500_000, 2);
  });

  it("with four issuers a true 25% cap binds and overflow cascades by yield", () => {
    const r = allocateLiquidReserve({
      homes: [
        mmf("mmf:1", "Sanlam", 9.5),
        mmf("mmf:2", "CIC", 9.0),
        bank("bank:1", "Equity", 8.0),
        bank("bank:2", "KCB", 7.0),
      ],
      netWorth: 1_000_000,
      liquidPot: 1_000_000,
      issuerCapFrac: 0.25,
    });
    expect(r.effectiveIssuerCapFrac).toBeCloseTo(0.25, 6);
    expect(r.state).toBe("diversified");
    // Each issuer capped at 250k; all four full.
    for (const s of r.slices) {
      expect(s.targetBalance).toBeCloseTo(250_000, 2);
    }
  });

  it("fills the highest net-yield home first (MMF over a lower call deposit)", () => {
    const r = allocateLiquidReserve({
      homes: [
        bank("bank:1", "Equity", 6.0),
        mmf("mmf:1", "Sanlam", 10.0),
      ],
      netWorth: 1_000_000,
      liquidPot: 300_000, // less than one cap (500k) → goes entirely to top yield
      issuerCapFrac: 0.25,
    });
    // 300k < 500k cap → all in the MMF, so only one home funded → too_small.
    const sanlam = r.slices.find((s) => s.issuer === "Sanlam")!;
    expect(sanlam.targetBalance).toBeCloseTo(300_000, 2);
    expect(r.state).toBe("too_small");
  });

  it("labels too_small when the whole pot fits under one issuer's cap", () => {
    const r = allocateLiquidReserve({
      homes: [
        mmf("mmf:1", "Sanlam", 9.0),
        bank("bank:1", "Equity", 7.0),
      ],
      netWorth: 1_000_000,
      liquidPot: 100_000, // under the 500k effective cap
      issuerCapFrac: 0.25,
    });
    expect(r.state).toBe("too_small");
    expect(r.message).toMatch(/too small/i);
  });

  it("folds a sub-minimum overflow slice into the next home", () => {
    // Top issuer capped at 250k; overflow 50k, but the only other home needs a
    // 100k minimum, so the overflow folds back to the top home.
    const r = allocateLiquidReserve({
      homes: [
        mmf("mmf:1", "Sanlam", 9.5),
        mmf("mmf:2", "CIC", 9.0),
        bank("bank:1", "Equity", 8.0),
        bank("bank:2", "KCB", 7.0, 0, 100_000),
      ],
      netWorth: 1_000_000,
      liquidPot: 800_000,
      issuerCapFrac: 0.25,
    });
    // Sanlam 250k, CIC 250k, Equity 250k = 750k; remaining 50k < KCB min(100k)
    // → folds into top-yield Sanlam (overflow), which then exceeds its cap.
    const sanlam = r.slices.find((s) => s.issuer === "Sanlam")!;
    expect(sanlam.targetBalance).toBeCloseTo(300_000, 2);
    const kcb = r.slices.find((s) => s.issuer === "KCB")!;
    expect(kcb.targetBalance).toBeCloseTo(0, 2);
  });

  it("places 100% of the pot regardless of branch", () => {
    const r = allocateLiquidReserve({
      homes: [
        mmf("mmf:1", "Sanlam", 9.5),
        mmf("mmf:2", "CIC", 9.0),
        bank("bank:1", "Equity", 8.0),
      ],
      netWorth: 1_000_000,
      liquidPot: 1_000_000,
      issuerCapFrac: 0.25,
    });
    const placed = r.slices.reduce((s, x) => s + x.targetBalance, 0);
    expect(placed).toBeCloseTo(1_000_000, 1);
  });
});

describe("allocateLiquidReserve — no-churn drift", () => {
  it("does not flag a home whose move is under the drift threshold", () => {
    // Already roughly at target → small deltas, no rebalance.
    const r = allocateLiquidReserve({
      homes: [
        mmf("mmf:1", "Sanlam", 9.0, 500_000),
        bank("bank:1", "Equity", 7.0, 500_000),
      ],
      netWorth: 1_000_000,
      liquidPot: 1_000_000,
      issuerCapFrac: 0.25,
      driftThresholdFrac: 0.05, // 50k threshold
    });
    // Targets equal current (500k each) → zero move → no rebalance.
    for (const s of r.slices) expect(s.rebalance).toBe(false);
  });

  it("flags a home when the required move exceeds the drift threshold", () => {
    const r = allocateLiquidReserve({
      homes: [
        mmf("mmf:1", "Sanlam", 9.0, 0),
        bank("bank:1", "Equity", 7.0, 1_000_000), // way over → must move out
      ],
      netWorth: 1_000_000,
      liquidPot: 1_000_000,
      issuerCapFrac: 0.25,
      driftThresholdFrac: 0.05,
    });
    const equity = r.slices.find((s) => s.issuer === "Equity")!;
    expect(Math.abs(equity.delta)).toBeGreaterThan(50_000);
    expect(equity.rebalance).toBe(true);
  });
});

describe("allocateLiquidReserve — Yield-first override", () => {
  it("concentrates the whole pot in the single highest net-yield home", () => {
    const r = allocateLiquidReserve({
      homes: [
        mmf("mmf:1", "Sanlam", 9.0),
        mmf("mmf:2", "CIC", 9.5), // highest net yield
        bank("bank:1", "Equity", 7.0),
      ],
      netWorth: 1_000_000,
      liquidPot: 1_000_000,
      issuerCapFrac: 0.25,
      allocationPolicy: "yield_first",
    });
    expect(r.state).toBe("concentrated_by_policy");
    expect(r.effectiveIssuerCapFrac).toBe(1);
    const cic = r.slices.find((s) => s.issuer === "CIC")!;
    expect(cic.targetBalance).toBeCloseTo(1_000_000, 2);
    // Everyone else gets nothing.
    for (const s of r.slices) {
      if (s.issuer !== "CIC") expect(s.targetBalance).toBeCloseTo(0, 2);
    }
    expect(r.message).toMatch(/within your chosen policy/i);
  });
});
