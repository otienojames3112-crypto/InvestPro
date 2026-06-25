import { describe, it, expect } from "vitest";
import { currentSecurityValue, accretedValue, type CurrentValueSecurity } from "../shared/discount";

// ─────────────────────────────────────────────────────────────────────────────
// R48 — currentSecurityValue is the single source of truth for the Dashboard
// Holdings "Current Value" toggle. It must mirror the engine's treatment of each
// instrument: discount paper accretes price→face; coupon bonds sit at par plus
// pro-rata accrued coupon; matured lots are worth face.
// ─────────────────────────────────────────────────────────────────────────────

const ISO = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
};
const daysAhead = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
};

describe("currentSecurityValue — discount instruments (accretion)", () => {
  it("a freshly-issued T-bill is worth ~its purchase price", () => {
    const today = new Date();
    const s: CurrentValueSecurity = {
      securityType: "tbill_364",
      faceValue: 100_000,
      purchasePrice: 87_000,
      couponRate: 0,
      issueDate: ISO(today),
      maturityDate: ISO(daysAhead(364)),
      isMatured: false,
    };
    const v = currentSecurityValue(s, today);
    // Essentially the purchase price on day zero.
    expect(v).toBeGreaterThanOrEqual(87_000);
    expect(v).toBeLessThan(87_500);
  });

  it("a T-bill halfway through its life sits halfway between price and face", () => {
    const today = new Date();
    const s: CurrentValueSecurity = {
      securityType: "tbill_364",
      faceValue: 100_000,
      purchasePrice: 80_000,
      issueDate: ISO(daysAgo(182)),
      maturityDate: ISO(daysAhead(182)),
      isMatured: false,
    };
    const v = currentSecurityValue(s, today);
    const expected = accretedValue(100_000, 80_000, 182 / 364);
    // Real-timestamp fraction includes time-of-day, so allow a small tolerance.
    expect(Math.abs(v - expected)).toBeLessThan(150);
    expect(v).toBeGreaterThan(89_000);
    expect(v).toBeLessThan(91_000);
  });

  it("never exceeds face value even right before maturity", () => {
    const today = new Date();
    const s: CurrentValueSecurity = {
      securityType: "zero_coupon",
      faceValue: 100_000,
      purchasePrice: 60_000,
      issueDate: ISO(daysAgo(1820)),
      maturityDate: ISO(daysAhead(1)),
      isMatured: false,
    };
    const v = currentSecurityValue(s, today);
    expect(v).toBeLessThanOrEqual(100_000);
    expect(v).toBeGreaterThan(99_000);
  });

  it("falls back to face when a discount lot has no purchase price", () => {
    const today = new Date();
    const s: CurrentValueSecurity = {
      securityType: "tbill_91",
      faceValue: 50_000,
      purchasePrice: null,
      issueDate: ISO(daysAgo(30)),
      maturityDate: ISO(daysAhead(61)),
      isMatured: false,
    };
    expect(currentSecurityValue(s, today)).toBe(50_000);
  });
});

describe("currentSecurityValue — coupon bonds (par + accrued)", () => {
  it("an FXD bond at issue is worth ~face", () => {
    const today = new Date();
    const s: CurrentValueSecurity = {
      securityType: "fxd",
      faceValue: 200_000,
      purchasePrice: 200_000,
      couponRate: 13,
      issueDate: ISO(today),
      maturityDate: ISO(daysAhead(3650)),
      isMatured: false,
    };
    const v = currentSecurityValue(s, today);
    expect(v).toBeGreaterThanOrEqual(200_000);
    expect(v).toBeLessThan(200_100);
  });

  it("an FXD bond one year in has accrued ~one year of coupon over face", () => {
    const today = new Date();
    const s: CurrentValueSecurity = {
      securityType: "fxd",
      faceValue: 100_000,
      couponRate: 12,
      issueDate: ISO(daysAgo(365)),
      maturityDate: ISO(daysAhead(365 * 9)),
      isMatured: false,
    };
    const v = currentSecurityValue(s, today);
    // ~12% of 100k accrued = ~12,000 over face.
    expect(v).toBeGreaterThan(111_000);
    expect(v).toBeLessThan(113_000);
  });

  it("an IFB with zero coupon stays at face", () => {
    const today = new Date();
    const s: CurrentValueSecurity = {
      securityType: "ifb",
      faceValue: 100_000,
      couponRate: 0,
      issueDate: ISO(daysAgo(100)),
      maturityDate: ISO(daysAhead(1000)),
      isMatured: false,
    };
    expect(currentSecurityValue(s, today)).toBe(100_000);
  });
});

describe("currentSecurityValue — matured / edge cases", () => {
  it("a matured lot is worth its face", () => {
    const s: CurrentValueSecurity = {
      securityType: "tbill_364",
      faceValue: 100_000,
      purchasePrice: 80_000,
      issueDate: ISO(daysAgo(400)),
      maturityDate: ISO(daysAgo(36)),
      isMatured: true,
    };
    expect(currentSecurityValue(s)).toBe(100_000);
  });

  it("a lot past its maturity date redeems at face even if not flagged", () => {
    const s: CurrentValueSecurity = {
      securityType: "tbill_364",
      faceValue: 100_000,
      purchasePrice: 80_000,
      issueDate: ISO(daysAgo(400)),
      maturityDate: ISO(daysAgo(1)),
      isMatured: false,
    };
    expect(currentSecurityValue(s)).toBe(100_000);
  });

  it("a zero or negative face is worth zero", () => {
    const s: CurrentValueSecurity = {
      securityType: "tbill_91",
      faceValue: 0,
      purchasePrice: 0,
      issueDate: ISO(new Date()),
      maturityDate: ISO(daysAhead(91)),
      isMatured: false,
    };
    expect(currentSecurityValue(s)).toBe(0);
  });
});
