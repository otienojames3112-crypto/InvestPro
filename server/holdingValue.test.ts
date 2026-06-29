import { describe, it, expect } from "vitest";
import {
  valueHolding,
  holdingMarketValue,
  isPriceDriven,
  resolveBehaviorClass,
  behaviorClassFromRegister,
  bucketHoldingsByInstrument,
  type ValuedHolding,
} from "../shared/holdingValue";
import { reconcileHoldings, RECON_TOLERANCE_KES } from "../shared/reconciliation";

/**
 * Expansion Brief Part 5 — propagation tests.
 *
 * These lock the invariants the brief calls non-negotiable:
 *  - every price-driven class is valued ONCE as units × price × FX,
 *  - the precise class survives the coarse register collapse,
 *  - offshore carries BOTH currencies + FX + provenance,
 *  - the phantom-holding guard fails when a held row is unvalued or mis-valued,
 *  - we never invent value: a row with no units/price falls back to stored value
 *    and is flagged NOT mark-to-model.
 */

describe("holdingValue — mark-to-model valuation", () => {
  it("re-derives equity value as units × price (no FX)", () => {
    const v = valueHolding({
      behaviorClass: "equity",
      assetClass: "equity",
      units: 1000,
      unitPrice: 45.5,
      currency: "KES",
      currentValue: 1, // stale — must be ignored
    });
    expect(v.valueKes).toBe(45500);
    expect(v.markToModel).toBe(true);
    expect(v.priceDriven).toBe(true);
    expect(v.fxExposed).toBe(false);
    expect(v.behaviorClass).toBe("equity");
    expect(v.native).toBeNull();
  });

  it("re-derives offshore value as units × price × FX and carries dual currency", () => {
    const v = valueHolding({
      behaviorClass: "offshore_fund",
      assetClass: "etf",
      units: 100,
      unitPrice: 500, // USD
      currency: "USD",
      fxRateToKes: 129,
      dataSource: "Manual entry",
      dataAsOf: "2026-06-01",
      currentValue: 0,
    });
    // 100 × 500 × 129 = 6,450,000
    expect(v.valueKes).toBe(6_450_000);
    expect(v.markToModel).toBe(true);
    expect(v.fxExposed).toBe(true);
    expect(v.native).not.toBeNull();
    expect(v.native?.currency).toBe("USD");
    expect(v.native?.amount).toBe(50_000); // 100 × 500 in USD
    expect(v.native?.fxRateToKes).toBe(129);
    expect(v.provenance.source).toBe("Manual entry");
    expect(v.provenance.asOf).not.toBeNull();
  });

  it("holdingMarketValue returns null without units/price (never invents value)", () => {
    expect(holdingMarketValue({ behaviorClass: "equity", units: 0, unitPrice: 45 })).toBeNull();
    expect(holdingMarketValue({ behaviorClass: "equity", units: 100 })).toBeNull();
  });

  it("falls back to stored currentValue and flags NOT mark-to-model for legacy rows", () => {
    const v = valueHolding({
      behaviorClass: "equity",
      assetClass: "equity",
      currentValue: 250000,
      // no units/price persisted
    });
    expect(v.valueKes).toBe(250000);
    expect(v.markToModel).toBe(false);
    expect(v.priceDriven).toBe(true); // class is still price-driven by nature
  });

  it("uses stored value for non-price-driven classes (pension/sacco/etc.)", () => {
    const v = valueHolding({
      assetClass: "pension",
      currentValue: 1_200_000,
    });
    expect(v.valueKes).toBe(1_200_000);
    expect(v.markToModel).toBe(false);
    expect(v.priceDriven).toBe(false);
    expect(v.behaviorClass).toBeNull();
  });
});

describe("holdingValue — class identity preserved through register collapse", () => {
  it("prefers explicit behaviorClass over the coarse register class", () => {
    // register collapses REIT→real_estate, but the precise class must survive
    expect(resolveBehaviorClass({ behaviorClass: "reit", assetClass: "real_estate" })).toBe("reit");
    expect(resolveBehaviorClass({ behaviorClass: "offshore_fund", assetClass: "etf" })).toBe("offshore_fund");
  });

  it("infers the precise class from the register class for legacy rows", () => {
    expect(behaviorClassFromRegister("real_estate")).toBe("reit");
    expect(behaviorClassFromRegister("etf")).toBe("offshore_fund");
    expect(behaviorClassFromRegister("equity")).toBe("equity");
    expect(behaviorClassFromRegister("pension")).toBeNull();
  });

  it("isPriceDriven reflects the precise class", () => {
    expect(isPriceDriven("equity")).toBe(true);
    expect(isPriceDriven("reit")).toBe(true);
    expect(isPriceDriven("offshore_fund")).toBe(true);
    expect(isPriceDriven("cash_mmf")).toBe(false);
    expect(isPriceDriven("bank_deposit")).toBe(false);
    expect(isPriceDriven("gov_coupon")).toBe(false);
    expect(isPriceDriven(null)).toBe(false);
  });
});

describe("holdingValue — bucketing by instrument", () => {
  it("buckets price-driven classes under their own labels, shares sum correctly", () => {
    const valued: ValuedHolding[] = [
      valueHolding({ behaviorClass: "equity", units: 1000, unitPrice: 100, currency: "KES" }), // 100k
      valueHolding({ behaviorClass: "reit", units: 1000, unitPrice: 50, currency: "KES" }), // 50k
      valueHolding({ behaviorClass: "offshore_fund", units: 10, unitPrice: 100, currency: "USD", fxRateToKes: 130 }), // 130k
      valueHolding({ assetClass: "pension", currentValue: 20000 }), // other
    ];
    const denom = 100000 + 50000 + 130000 + 20000;
    const buckets = bucketHoldingsByInstrument(valued, denom);
    const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
    expect(byKey.equity.valueKes).toBe(100000);
    expect(byKey.reit.valueKes).toBe(50000);
    expect(byKey.offshore.valueKes).toBe(130000);
    expect(byKey.other.valueKes).toBe(20000);
    const shareSum = buckets.reduce((s, b) => s + b.share, 0);
    expect(Math.abs(shareSum - 1)).toBeLessThan(1e-6);
  });
});

describe("reconcileHoldings — phantom-holding guard", () => {
  it("passes when every held row is valued and totals agree", () => {
    const perHolding = [100000, 50000, 130000];
    const r = reconcileHoldings(perHolding, 280000, 3);
    expect(r.ok).toBe(true);
    expect(r.markToModelTotal).toBe(280000);
    expect(r.diff).toBe(0);
    expect(r.valuedCount).toBe(3);
    expect(r.heldCount).toBe(3);
  });

  it("fails when a held row is missing from the valued set (phantom)", () => {
    // 3 held, only 2 valued → valuedCount !== heldCount
    const r = reconcileHoldings([100000, 50000], 150000, 3);
    expect(r.ok).toBe(false);
    expect(r.valuedCount).toBe(2);
    expect(r.heldCount).toBe(3);
  });

  it("fails when the allocation total drifts from mark-to-model beyond tolerance", () => {
    const r = reconcileHoldings([100000, 50000], 130000, 2); // allocation 20k short
    expect(r.ok).toBe(false);
    expect(Math.abs(r.diff)).toBeGreaterThan(RECON_TOLERANCE_KES);
  });

  it("tolerates sub-tolerance rounding slack", () => {
    const r = reconcileHoldings([100000.0, 50000.0], 150003, 2); // 3 KES off
    expect(r.ok).toBe(true);
  });

  it("passes trivially with no other holdings", () => {
    const r = reconcileHoldings([], 0, 0);
    expect(r.ok).toBe(true);
    expect(r.markToModelTotal).toBe(0);
  });
});
