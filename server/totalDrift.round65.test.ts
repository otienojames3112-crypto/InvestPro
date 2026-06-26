import { describe, it, expect } from "vitest";
import { allocateLiquidReserve, type LiquidHome } from "../shared/liquidAllocator";

/**
 * Round 65 — portfolio-level total-drift badge.
 *
 * The Dashboard liquid card sums the absolute per-slice drift
 * (Σ |actual − target|) into a single "total drift from target" figure. These
 * tests reproduce that computation against the pure allocator + reconcile
 * overlay so the badge math is locked down.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

function reconcile(
  homes: LiquidHome[],
  actuals: Record<string, number>,
  opts: { netWorth: number; issuerCapFrac?: number },
) {
  const overlaid = homes.map((h) =>
    h.id in actuals ? { ...h, currentBalance: actuals[h.id] } : h,
  );
  const liquidPot = overlaid.reduce((s, h) => s + h.currentBalance, 0);
  const result = allocateLiquidReserve({
    homes: overlaid,
    netWorth: opts.netWorth,
    liquidPot,
    issuerCapFrac: opts.issuerCapFrac ?? 0.25,
    allocationPolicy: "balanced",
  });
  const currentById = new Map(overlaid.map((h) => [h.id, h.currentBalance]));
  const slices = result.slices.map((s) => {
    const current = currentById.get(s.id) ?? 0;
    return { ...s, currentBalance: round2(current), drift: round2(current - s.targetBalance) };
  });
  return { ...result, slices };
}

/** Mirror of the badge: Σ |drift| across slices. */
function totalDrift(slices: { drift?: number }[]) {
  return slices.reduce((sum, s) => sum + Math.abs(s.drift ?? 0), 0);
}

function home(id: string, issuer: string, gross: number, bal: number): LiquidHome {
  return {
    id,
    label: id,
    kind: id.startsWith("bank") ? "call_deposit" : "secondary_mmf",
    issuer,
    grossYieldPct: gross,
    whtRatePct: 15,
    currentBalance: bal,
    minBalance: 0,
  };
}

describe("R65 total-drift badge", () => {
  it("sums absolute per-home drift across the split", () => {
    const homes = [
      home("mmf:1", "Alpha", 10, 1_000_000),
      home("mmf:2", "Beta", 9, 1_000_000),
      home("bank:3", "Gamma", 8, 1_000_000),
      home("bank:4", "Delta", 7, 1_000_000),
    ];
    // Each issuer caps at 25% of 4M = 1M. Overlay two homes off-target.
    const res = reconcile(
      homes,
      { "mmf:1": 1_500_000, "bank:3": 500_000 },
      { netWorth: 4_000_000 },
    );
    // mmf:1 +500k, bank:3 −500k, others 0 → Σ|drift| = 1,000,000.
    expect(totalDrift(res.slices)).toBeCloseTo(1_000_000, 0);
  });

  it("is zero when every home sits exactly on target", () => {
    const homes = [
      home("mmf:1", "Alpha", 10, 0),
      home("mmf:2", "Beta", 9, 0),
    ];
    const base = reconcile(homes, {}, { netWorth: 2_000_000, issuerCapFrac: 0.6 });
    const actuals: Record<string, number> = {};
    for (const s of base.slices) actuals[s.id] = s.targetBalance;
    const res = reconcile(homes, actuals, { netWorth: 2_000_000, issuerCapFrac: 0.6 });
    expect(totalDrift(res.slices)).toBeLessThanOrEqual(2);
  });

  it("absolute value means over- and under-allocations both add (never cancel)", () => {
    const homes = [
      home("mmf:1", "Alpha", 10, 800_000),
      home("mmf:2", "Beta", 9, 800_000),
    ];
    // Equal yields-ish, 60% cap, pot 1.6M. Push one up, one down by 300k.
    const res = reconcile(
      homes,
      { "mmf:1": 1_100_000, "mmf:2": 500_000 },
      { netWorth: 2_000_000, issuerCapFrac: 0.6 },
    );
    // Net drift cancels to ~0, but absolute drift is strictly positive.
    const net = res.slices.reduce((s, x) => s + (x.drift ?? 0), 0);
    expect(Math.abs(net)).toBeLessThanOrEqual(2);
    expect(totalDrift(res.slices)).toBeGreaterThan(100_000);
  });
});
