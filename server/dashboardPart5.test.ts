import { describe, it, expect } from "vitest";
import { computeActualsTotals, type ActualsRates } from "@shared/actuals";

const RATES: ActualsRates = {
  withholdingTax: 15,
  mmfYield: 14,
  tbillRate: 16,
  fxdCouponRate: 13,
};

describe("Part 5 — earnings cards share a forward-12-month basis (line-item #8)", () => {
  it("forward gross income on a primary-MMF balance equals balance × yield", () => {
    const t = computeActualsTotals(
      [{ amount: 1_000_000, bucket: "mmf" }],
      [],
      [],
      RATES,
      [],
      [],
    );
    // 1,000,000 × 14% = 140,000 gross forward income
    expect(t.forwardGrossIncome12mo).toBeCloseTo(140_000, 0);
  });

  it("forward NET income equals forward gross income minus the forward tax (same basis)", () => {
    const t = computeActualsTotals(
      [{ amount: 1_000_000, bucket: "mmf" }],
      [],
      [],
      RATES,
      [],
      [],
    );
    // The two earnings cards must reconcile: net = gross − tax, on one basis.
    expect(t.forwardNetIncome12mo).toBeCloseTo(t.forwardGrossIncome12mo - t.taxLiability, 2);
  });

  it("the forward tax is exactly the WHT on the forward gross income (cards are comparable)", () => {
    const t = computeActualsTotals(
      [{ amount: 500_000, bucket: "mmf" }],
      [],
      [],
      RATES,
      [],
      [],
    );
    // 500,000 × 14% = 70,000 gross; 15% WHT = 10,500.
    expect(t.forwardGrossIncome12mo).toBeCloseTo(70_000, 0);
    expect(t.taxLiability).toBeCloseTo(10_500, 0);
    expect(t.forwardNetIncome12mo).toBeCloseTo(59_500, 0);
  });

  it("forward income aggregates across MMF, secondary MMF and bank on one basis", () => {
    const t = computeActualsTotals(
      [{ amount: 1_000_000, bucket: "mmf" }],
      [{ currentBalance: 400_000, ear: 12 }],
      [{ principal: 200_000, interestRate: 10, isActive: true }],
      RATES,
      [],
      [],
    );
    // gross = 1,000,000×14% + 400,000×12% + 200,000×10% = 140,000 + 48,000 + 20,000
    expect(t.forwardGrossIncome12mo).toBeCloseTo(208_000, 0);
    expect(t.forwardNetIncome12mo).toBeCloseTo(t.forwardGrossIncome12mo - t.taxLiability, 2);
  });

  it("forward net income is never negative", () => {
    const t = computeActualsTotals([], [], [], RATES, [], []);
    expect(t.forwardNetIncome12mo).toBeGreaterThanOrEqual(0);
    expect(t.forwardGrossIncome12mo).toBeGreaterThanOrEqual(0);
  });
});

describe("Part 5 — MMF net-of-fee convention guardrail (strategic #H)", () => {
  // The engine must NOT deduct a manager fee on top of an already-net EAR.
  // We assert here that a secondary MMF's forward income is driven purely by its
  // published `ear` (net of fee) with only WHT applied — no extra fee haircut.
  it("secondary-MMF forward gross income uses the published EAR directly (no fee deducted on top)", () => {
    const ear = 13.9; // published, net-of-fee EAR
    const t = computeActualsTotals(
      [],
      [{ currentBalance: 1_000_000, ear }],
      [],
      RATES,
      [],
      [],
    );
    // gross forward income must be exactly balance × ear, NOT balance × (ear − fee)
    expect(t.forwardGrossIncome12mo).toBeCloseTo(1_000_000 * (ear / 100), 2);
  });

  it("only WHT (not a manager fee) separates gross from net for a secondary MMF", () => {
    const ear = 13.9;
    const wht = 15;
    const t = computeActualsTotals(
      [],
      [{ currentBalance: 1_000_000, ear, whtRate: wht }],
      [],
      RATES,
      [],
      [],
    );
    const gross = 1_000_000 * (ear / 100);
    const expectedNet = gross - gross * (wht / 100);
    expect(t.forwardNetIncome12mo).toBeCloseTo(expectedNet, 2);
  });
});
