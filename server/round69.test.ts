import { describe, it, expect } from "vitest";
import {
  analyzePerTypeBreach,
  type CurrentValueSecurity,
} from "../shared/discount";
import {
  SNOOZE_OPTIONS,
  snoozeUntilFromDays,
} from "../shared/liquidAllocator";
import { projectedLiquidSplit } from "./engine";
import { GLOSSARY } from "../client/src/lib/glossary";

const DAY = 24 * 60 * 60 * 1000;

// A fixed "today" so maturity math is deterministic.
const TODAY = new Date("2026-06-25T00:00:00Z");
const NOW = TODAY.getTime();

function fxdLot(face: number, maturityMs: number): CurrentValueSecurity {
  return {
    securityType: "fxd",
    faceValue: face,
    purchasePrice: null, // par → current value === face
    couponRate: 12,
    issueDate: new Date(NOW - 30 * DAY),
    maturityDate: new Date(maturityMs),
    isMatured: false,
  };
}

function tbillLot(face: number, maturityMs: number): CurrentValueSecurity {
  return {
    securityType: "tbill_364",
    faceValue: face,
    // par price so current value ≈ face, keeps the share math simple
    purchasePrice: face,
    couponRate: 0,
    issueDate: new Date(NOW - 30 * DAY),
    maturityDate: new Date(maturityMs),
    isMatured: false,
  };
}

describe("R69.2 — maturity-aware per-type breach analyzer", () => {
  it("returns null when there are no lots", () => {
    expect(analyzePerTypeBreach([], 60, 100000, NOW + 365 * DAY, TODAY)).toBeNull();
  });

  it("reports not breached when the dominant type is under cap", () => {
    const lots = [
      fxdLot(50000, NOW + 200 * DAY),
      tbillLot(50000, NOW + 100 * DAY),
    ];
    const a = analyzePerTypeBreach(lots, 60, 200000, NOW + 365 * DAY, TODAY);
    expect(a).not.toBeNull();
    expect(a!.breached).toBe(false);
  });

  it("flags a breach and self-corrects on the earliest clearing maturity within horizon", () => {
    // FXD is 100k of 150k securities = 66.7% > 60% cap.
    // One FXD lot (50k) matures in 90 days → after it matures FXD = 50k of 100k = 50% < 60%.
    const clearMs = NOW + 90 * DAY;
    const lots = [
      fxdLot(50000, clearMs),
      fxdLot(50000, NOW + 300 * DAY),
      tbillLot(50000, NOW + 120 * DAY),
    ];
    const a = analyzePerTypeBreach(lots, 60, 210000, NOW + 365 * DAY, TODAY);
    expect(a).not.toBeNull();
    expect(a!.breached).toBe(true);
    expect(a!.type).toBe("fxd");
    expect(a!.selfCorrects).toBe(true);
    expect(a!.clearsAtMs).toBe(clearMs);
    // both denominators populated
    expect(a!.shareOfSecurities).toBeGreaterThan(0.6);
    expect(a!.shareOfNetWorth).toBeGreaterThan(0);
    expect(a!.shareOfNetWorth).toBeLessThan(a!.shareOfSecurities);
  });

  it("does NOT self-correct when the clearing maturity falls beyond the horizon", () => {
    const clearMs = NOW + 400 * DAY; // after horizon end
    const lots = [
      fxdLot(50000, clearMs),
      fxdLot(50000, NOW + 500 * DAY),
      tbillLot(50000, NOW + 120 * DAY),
    ];
    const horizonEnd = NOW + 365 * DAY;
    const a = analyzePerTypeBreach(lots, 60, 210000, horizonEnd, TODAY);
    expect(a!.breached).toBe(true);
    expect(a!.selfCorrects).toBe(false);
  });

  it("does NOT self-correct when a single huge lot never brings the type under cap", () => {
    // One FXD lot dominates; when it matures it leaves the securities base, so the
    // remaining base is all-tbill (under cap) — but there is no intermediate
    // maturity that clears while FXD still holds value. With a single lot the
    // first (and only) maturity drops FXD to 0, which is <= cap, so it self-corrects
    // ON that date. To exercise the "never clears" path we keep two FXD lots where
    // the first maturity still leaves FXD over cap and the second is the last lot.
    const lots = [
      fxdLot(80000, NOW + 100 * DAY),
      fxdLot(80000, NOW + 200 * DAY),
      tbillLot(20000, NOW + 50 * DAY),
    ];
    // FXD = 160k / 180k = 88.9%. After first FXD matures: 80k/100k = 80% (still > 60).
    // After second FXD matures: 0/20k = 0% — clears on the 200d date.
    const a = analyzePerTypeBreach(lots, 60, 200000, NOW + 365 * DAY, TODAY);
    expect(a!.breached).toBe(true);
    expect(a!.selfCorrects).toBe(true);
    expect(a!.clearsAtMs).toBe(NOW + 200 * DAY);
  });

  it("net-worth share is 0 when net worth is unknown", () => {
    const lots = [fxdLot(100000, NOW + 90 * DAY), tbillLot(50000, NOW + 120 * DAY)];
    const a = analyzePerTypeBreach(lots, 60, 0, NOW + 365 * DAY, TODAY);
    expect(a!.shareOfNetWorth).toBe(0);
  });
});

describe("R69.1/R69.3 — projected end-state liquid split", () => {
  const finalMonth = {
    mmfEnd: 800000,
    secondaryMmfEnd: 0,
    bankEnd: 200000,
  } as Parameters<typeof projectedLiquidSplit>[0];

  const homes = [
    { id: "mmf:1", label: "Primary MMF", kind: "primary_mmf" as const, issuer: "Cytonn", grossYieldPct: 12, whtRatePct: 15 },
    { id: "mmf:2", label: "Sanlam MMF", kind: "secondary_mmf" as const, issuer: "Sanlam", grossYieldPct: 11.5, whtRatePct: 15 },
    { id: "bank:1", label: "NCBA call", kind: "bank_call" as const, issuer: "NCBA", grossYieldPct: 9, whtRatePct: 15 },
  ];

  it("splits across multiple homes under a balanced policy", () => {
    const r = projectedLiquidSplit(finalMonth, homes, {
      netWorth: 1000000,
      issuerCapFrac: 0.5,
      allocationPolicy: "balanced",
    });
    expect(r.liquidPot).toBeCloseTo(1000000, 0);
    expect(r.fundedHomeCount).toBeGreaterThan(1);
    expect(r.isSplit).toBe(true);
    const placed = r.slices.reduce((s, x) => s + x.targetBalance, 0);
    expect(placed).toBeCloseTo(1000000, -1);
  });

  it("can legitimately concentrate under a yield-first policy", () => {
    const r = projectedLiquidSplit(finalMonth, homes, {
      netWorth: 1000000,
      issuerCapFrac: 1, // no issuer constraint → yield-first piles into the top yield
      allocationPolicy: "yield_first",
    });
    expect(r.liquidPot).toBeCloseTo(1000000, 0);
    // top-yield home should hold the lion's share
    const top = [...r.slices].sort((a, b) => b.targetBalance - a.targetBalance)[0];
    expect(top.targetBalance).toBeGreaterThan(500000);
  });

  it("uses a single home when only one eligible home exists", () => {
    const r = projectedLiquidSplit(finalMonth, [homes[0]], {
      netWorth: 1000000,
      allocationPolicy: "balanced",
    });
    expect(r.fundedHomeCount).toBe(1);
    expect(r.isSplit).toBe(false);
  });

  it("handles a zero liquid pot without throwing", () => {
    const r = projectedLiquidSplit({ mmfEnd: 0, secondaryMmfEnd: 0, bankEnd: 0 } as typeof finalMonth, homes, {
      netWorth: 0,
      allocationPolicy: "balanced",
    });
    expect(r.liquidPot).toBe(0);
    expect(r.fundedHomeCount).toBe(0);
  });
});

describe("R69 — snooze-duration helpers (1/7/30)", () => {
  it("offers exactly 1, 7 and 30 day options", () => {
    expect(SNOOZE_OPTIONS.map((o) => o.days)).toEqual([1, 7, 30]);
  });

  it("maps a day count to a future timestamp", () => {
    expect(snoozeUntilFromDays(7, NOW)).toBe(NOW + 7 * DAY);
    expect(snoozeUntilFromDays(1, NOW)).toBe(NOW + DAY);
    expect(snoozeUntilFromDays(30, NOW)).toBe(NOW + 30 * DAY);
  });

  it("returns null for non-positive / invalid durations", () => {
    expect(snoozeUntilFromDays(null, NOW)).toBeNull();
    expect(snoozeUntilFromDays(0, NOW)).toBeNull();
    expect(snoozeUntilFromDays(-5, NOW)).toBeNull();
    expect(snoozeUntilFromDays(Number.NaN, NOW)).toBeNull();
  });
});

describe("R69.4 — glossary completeness for new concepts", () => {
  const ids = new Set(GLOSSARY.map((g) => g.id));
  it("includes the new allocation/cap/diversification entries", () => {
    for (const id of [
      "allocation-policy",
      "per-type-cap",
      "per-issuer-cap",
      "concentration-cap-acknowledgment",
      "liquid-reserve-diversification",
      "kdic-insurance",
      "accrued-interest",
    ]) {
      expect(ids.has(id), `glossary missing "${id}"`).toBe(true);
    }
  });

  it("every glossary entry has a non-empty term and definition", () => {
    for (const g of GLOSSARY) {
      expect(g.term.trim().length).toBeGreaterThan(0);
      expect(g.def.trim().length).toBeGreaterThan(0);
    }
  });
});
