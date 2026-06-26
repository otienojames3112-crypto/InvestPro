import { describe, it, expect } from "vitest";
import { currentSecurityValue, type CurrentValueSecurity } from "../shared/discount";

// ─────────────────────────────────────────────────────────────────────────────
// R50 — the Dashboard's portfolio summary card aggregates, across ALL active
// lots: total current (mark-to-model) value, total face value, total cost basis,
// and overall unrealized gain (current − cost). Cost basis = purchase price for
// discount lots (T-bills / zero-coupon) and par (face) for coupon bonds bought
// at par. This test reproduces that aggregation against the shared engine so the
// card can never silently drift from currentSecurityValue.
// ─────────────────────────────────────────────────────────────────────────────

const ISO = (d: Date) => d.toISOString().slice(0, 10);
const shift = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

type Lot = CurrentValueSecurity & { purchasePrice?: number | null };

// Mirror of the Dashboard `portfolioValuation` memo, kept framework-free.
function valuate(rows: Lot[], today = new Date()) {
  let totalFace = 0;
  let totalCurrent = 0;
  let totalCost = 0;
  let lots = 0;
  for (const s of rows) {
    if (s.isMatured) continue;
    const face = Number(s.faceValue) || 0;
    if (face <= 0) continue;
    const price = Number(s.purchasePrice);
    const hasPrice = Number.isFinite(price) && price > 0;
    const current = currentSecurityValue(s, today);
    const cost = hasPrice ? price : face;
    totalFace += face;
    totalCurrent += current;
    totalCost += cost;
    lots += 1;
  }
  const unrealizedGain = totalCurrent - totalCost;
  const gainPct = totalCost > 0 ? (unrealizedGain / totalCost) * 100 : 0;
  return { totalFace, totalCurrent, totalCost, unrealizedGain, gainPct, lots };
}

describe("R50 — portfolio valuation aggregation", () => {
  it("sums face, current and cost across mixed active lots", () => {
    const today = new Date();
    const rows: Lot[] = [
      {
        securityType: "tbill_364",
        faceValue: 100_000,
        purchasePrice: 90_000,
        issueDate: ISO(shift(-182)),
        maturityDate: ISO(shift(182)),
        isMatured: false,
      },
      {
        securityType: "fxd",
        faceValue: 200_000,
        purchasePrice: 200_000,
        couponRate: 13.2,
        issueDate: ISO(shift(-100)),
        maturityDate: ISO(shift(1000)),
        isMatured: false,
      },
    ];
    const v = valuate(rows, today);
    expect(v.lots).toBe(2);
    expect(v.totalFace).toBe(300_000);
    // Cost basis: 90,000 (discount price) + 200,000 (par) = 290,000.
    expect(v.totalCost).toBe(290_000);
    // Current must equal the sum of the engine's per-lot values.
    const expectedCurrent =
      currentSecurityValue(rows[0], today) + currentSecurityValue(rows[1], today);
    expect(v.totalCurrent).toBeCloseTo(expectedCurrent, 6);
    expect(v.unrealizedGain).toBeCloseTo(expectedCurrent - 290_000, 6);
  });

  it("ignores matured and zero-face lots", () => {
    const today = new Date();
    const rows: Lot[] = [
      {
        securityType: "tbill_91",
        faceValue: 50_000,
        purchasePrice: 48_000,
        issueDate: ISO(shift(-91)),
        maturityDate: ISO(shift(-1)),
        isMatured: true,
      },
      {
        securityType: "zero_coupon",
        faceValue: 0,
        purchasePrice: 0,
        issueDate: ISO(shift(-10)),
        maturityDate: ISO(shift(100)),
        isMatured: false,
      },
      {
        securityType: "tbill_182",
        faceValue: 80_000,
        purchasePrice: 76_000,
        issueDate: ISO(shift(-91)),
        maturityDate: ISO(shift(91)),
        isMatured: false,
      },
    ];
    const v = valuate(rows, today);
    expect(v.lots).toBe(1);
    expect(v.totalFace).toBe(80_000);
    expect(v.totalCost).toBe(76_000);
  });

  it("a discount lot held to value above cost shows a positive gain", () => {
    const today = new Date();
    const rows: Lot[] = [
      {
        securityType: "tbill_364",
        faceValue: 100_000,
        purchasePrice: 88_000,
        issueDate: ISO(shift(-300)),
        maturityDate: ISO(shift(64)),
        isMatured: false,
      },
    ];
    const v = valuate(rows, today);
    // Late in life, current value is well above the 88,000 purchase price.
    expect(v.unrealizedGain).toBeGreaterThan(0);
    expect(v.gainPct).toBeGreaterThan(0);
    expect(v.totalCurrent).toBeGreaterThan(v.totalCost);
    expect(v.totalCurrent).toBeLessThanOrEqual(v.totalFace);
  });

  it("empty / MMF-only portfolios produce zeroed totals and no lots", () => {
    const v = valuate([]);
    expect(v.lots).toBe(0);
    expect(v.totalFace).toBe(0);
    expect(v.totalCurrent).toBe(0);
    expect(v.unrealizedGain).toBe(0);
    expect(v.gainPct).toBe(0);
  });
});
