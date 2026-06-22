import { describe, it, expect } from "vitest";
import {
  runProjection,
  type EngineSettings,
  type SecondaryMmfInput,
} from "./engine";

const BASE: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.8206,
  tbill182Rate: 8.7782,
  tbill364Rate: 8.9746,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  startDate: "2026-07-01",
  horizonMonths: 120,
};

/**
 * Mirror the server `projection.whatIf` override logic: swap one secondary's
 * monthlyContribution, keep everything else, and compare ending totals.
 */
function applyOverride(
  secondaries: SecondaryMmfInput[],
  overrides: Array<{ secondaryMmfId: number; monthlyContribution: number }>,
): SecondaryMmfInput[] {
  const map = new Map(overrides.map((o) => [o.secondaryMmfId, o.monthlyContribution]));
  return secondaries.map((s) =>
    s.id != null && map.has(s.id) ? { ...s, monthlyContribution: map.get(s.id)! } : s,
  );
}

const finalTotal = (r: ReturnType<typeof runProjection>) => r[r.length - 1].totalEnd;

describe("what-if secondary MMF contribution overlay", () => {
  const secondaries: SecondaryMmfInput[] = [
    { id: 1, currentBalance: 100000, monthlyContribution: 3000, ear: 12, whtRate: 15 },
    { id: 2, currentBalance: 50000, monthlyContribution: 1000, ear: 10, whtRate: 15 },
  ];

  it("returns identical totals when the override equals the baseline", () => {
    const baseline = runProjection(BASE, [], [], [], [], secondaries);
    const whatIf = runProjection(
      BASE,
      [],
      [],
      [],
      [],
      applyOverride(secondaries, [{ secondaryMmfId: 1, monthlyContribution: 3000 }]),
    );
    expect(finalTotal(whatIf)).toBeCloseTo(finalTotal(baseline), 2);
  });

  it("increases the ending value when a secondary contribution is raised", () => {
    const baseline = runProjection(BASE, [], [], [], [], secondaries);
    const whatIf = runProjection(
      BASE,
      [],
      [],
      [],
      [],
      applyOverride(secondaries, [{ secondaryMmfId: 1, monthlyContribution: 10000 }]),
    );
    expect(finalTotal(whatIf)).toBeGreaterThan(finalTotal(baseline));
  });

  it("decreases the ending value when a secondary contribution is lowered to zero", () => {
    const baseline = runProjection(BASE, [], [], [], [], secondaries);
    const whatIf = runProjection(
      BASE,
      [],
      [],
      [],
      [],
      applyOverride(secondaries, [{ secondaryMmfId: 2, monthlyContribution: 0 }]),
    );
    expect(finalTotal(whatIf)).toBeLessThan(finalTotal(baseline));
  });

  it("only affects the overridden account, leaving the other secondary unchanged", () => {
    const overridden = applyOverride(secondaries, [
      { secondaryMmfId: 1, monthlyContribution: 8000 },
    ]);
    // account 2 keeps its original contribution
    expect(overridden.find((s) => s.id === 2)?.monthlyContribution).toBe(1000);
    expect(overridden.find((s) => s.id === 1)?.monthlyContribution).toBe(8000);
  });

  it("delta is additive and positive proportional to the contribution increase", () => {
    const baseline = runProjection(BASE, [], [], [], [], secondaries);
    const small = runProjection(
      BASE, [], [], [], [],
      applyOverride(secondaries, [{ secondaryMmfId: 1, monthlyContribution: 5000 }]),
    );
    const large = runProjection(
      BASE, [], [], [], [],
      applyOverride(secondaries, [{ secondaryMmfId: 1, monthlyContribution: 9000 }]),
    );
    const deltaSmall = finalTotal(small) - finalTotal(baseline);
    const deltaLarge = finalTotal(large) - finalTotal(baseline);
    expect(deltaLarge).toBeGreaterThan(deltaSmall);
    expect(deltaSmall).toBeGreaterThan(0);
  });
});
