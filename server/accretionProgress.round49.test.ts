import { describe, it, expect } from "vitest";
import { accretionProgress, type CurrentValueSecurity } from "../shared/discount";

// ─────────────────────────────────────────────────────────────────────────────
// R49 — accretionProgress drives the per-lot progress bar on the CBK Securities
// register. It returns a [0,1] fraction of how far a DISCOUNT lot has moved from
// its purchase price toward face (by VALUE, so it ties out with currentValue),
// or null for coupon bonds / lots with no usable price.
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

describe("accretionProgress — discount lots", () => {
  it("a freshly-issued T-bill is near 0% progress", () => {
    const today = new Date();
    const s: CurrentValueSecurity = {
      securityType: "tbill_364",
      faceValue: 100_000,
      purchasePrice: 87_000,
      issueDate: ISO(today),
      maturityDate: ISO(daysAhead(364)),
      isMatured: false,
    };
    const p = accretionProgress(s, today)!;
    expect(p).toBeGreaterThanOrEqual(0);
    expect(p).toBeLessThan(0.01);
  });

  it("a T-bill halfway through its life is ~50% progress", () => {
    const today = new Date();
    const s: CurrentValueSecurity = {
      securityType: "tbill_364",
      faceValue: 100_000,
      purchasePrice: 80_000,
      issueDate: ISO(daysAgo(182)),
      maturityDate: ISO(daysAhead(182)),
      isMatured: false,
    };
    const p = accretionProgress(s, today)!;
    expect(p).toBeGreaterThan(0.45);
    expect(p).toBeLessThan(0.55);
  });

  it("a matured discount lot is 100% progress", () => {
    const s: CurrentValueSecurity = {
      securityType: "tbill_91",
      faceValue: 50_000,
      purchasePrice: 48_000,
      issueDate: ISO(daysAgo(120)),
      maturityDate: ISO(daysAgo(29)),
      isMatured: true,
    };
    expect(accretionProgress(s)).toBe(1);
  });

  it("a lot past maturity (not flagged) is 100% progress", () => {
    const s: CurrentValueSecurity = {
      securityType: "tbill_91",
      faceValue: 50_000,
      purchasePrice: 48_000,
      issueDate: ISO(daysAgo(120)),
      maturityDate: ISO(daysAgo(1)),
      isMatured: false,
    };
    expect(accretionProgress(s)).toBe(1);
  });

  it("progress is clamped to [0,1]", () => {
    const today = new Date();
    const s: CurrentValueSecurity = {
      securityType: "zero_coupon",
      faceValue: 100_000,
      purchasePrice: 60_000,
      issueDate: ISO(daysAgo(1820)),
      maturityDate: ISO(daysAhead(1)),
      isMatured: false,
    };
    const p = accretionProgress(s, today)!;
    expect(p).toBeGreaterThan(0.95);
    expect(p).toBeLessThanOrEqual(1);
  });
});

describe("accretionProgress — non-applicable lots return null", () => {
  it("coupon bonds (FXD) return null", () => {
    const s: CurrentValueSecurity = {
      securityType: "fxd",
      faceValue: 200_000,
      purchasePrice: 200_000,
      couponRate: 13,
      issueDate: ISO(daysAgo(100)),
      maturityDate: ISO(daysAhead(1000)),
      isMatured: false,
    };
    expect(accretionProgress(s)).toBeNull();
  });

  it("IFB bonds return null", () => {
    const s: CurrentValueSecurity = {
      securityType: "ifb",
      faceValue: 100_000,
      couponRate: 12,
      issueDate: ISO(daysAgo(100)),
      maturityDate: ISO(daysAhead(1000)),
      isMatured: false,
    };
    expect(accretionProgress(s)).toBeNull();
  });

  it("a discount lot with no purchase price returns null (cannot draw a bar)", () => {
    const s: CurrentValueSecurity = {
      securityType: "tbill_91",
      faceValue: 50_000,
      purchasePrice: null,
      issueDate: ISO(daysAgo(30)),
      maturityDate: ISO(daysAhead(61)),
      isMatured: false,
    };
    expect(accretionProgress(s)).toBeNull();
  });
});
