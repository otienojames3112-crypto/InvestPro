import { describe, it, expect } from "vitest";
import {
  buildSecurityIncome,
  buildBankIncome,
  suggestReinvestBucket,
  phaseForMonth,
  type SecurityIncomeInput,
  type BankIncomeInput,
} from "../shared/incomeBreakdown";

describe("Round 34 — government securities income breakdown", () => {
  const secs: SecurityIncomeInput[] = [
    // FXD bond: 100,000 @ 13% coupon, taxable (15% WHT)
    { id: 1, securityType: "fxd", faceValue: 100_000, couponRate: 13, isTaxExempt: false },
    // IFB: 100,000 @ 14%, tax-exempt
    { id: 2, securityType: "ifb", faceValue: 100_000, couponRate: 14, isTaxExempt: true },
    // T-bill: 50,000 @ 16% discount, taxable
    { id: 3, securityType: "tbill_91", faceValue: 50_000, couponRate: 16, isTaxExempt: false },
  ];

  it("computes gross/net annual with correct WHT treatment", () => {
    const s = buildSecurityIncome(secs, 365);
    // Gross annual = 13,000 + 14,000 + 8,000 = 35,000
    expect(Math.round(s.grossAnnual)).toBe(35_000);
    // WHT: FXD 13,000*15%=1,950 ; IFB exempt ; T-bill 8,000*15%=1,200 → 3,150
    expect(Math.round(s.whtAnnual)).toBe(3_150);
    expect(Math.round(s.netAnnual)).toBe(31_850);
    expect(Math.round(s.base)).toBe(250_000);
  });

  it("prorates the horizon linearly (half a year = half the income)", () => {
    const full = buildSecurityIncome(secs, 365);
    const half = buildSecurityIncome(secs, 182.5);
    expect(half.grossHorizon).toBeCloseTo(full.grossAnnual / 2, 0);
  });

  it("IFB row is flagged tax-exempt and incurs no WHT", () => {
    const s = buildSecurityIncome(secs, 365);
    const ifb = s.rows.find((r) => r.id === 2)!;
    expect(ifb.taxExempt).toBe(true);
    expect(ifb.whtAnnual).toBe(0);
  });
});

describe("Round 34 — bank instrument income breakdown", () => {
  const banks: BankIncomeInput[] = [
    { id: 1, bankName: "KCB", instrumentType: "fixed_deposit", principal: 100_000, interestRate: 10, whtRate: 15 },
    { id: 2, bankName: "Equity", instrumentType: "call_deposit", principal: 50_000, interestRate: 8, whtRate: 15 },
  ];

  it("computes gross/net annual interest at each holding's WHT", () => {
    const b = buildBankIncome(banks, 365);
    // Gross = 10,000 + 4,000 = 14,000 ; WHT 15% = 2,100 ; net = 11,900
    expect(Math.round(b.grossAnnual)).toBe(14_000);
    expect(Math.round(b.whtAnnual)).toBe(2_100);
    expect(Math.round(b.netAnnual)).toBe(11_900);
    expect(Math.round(b.base)).toBe(150_000);
  });

  it("skips inactive holdings", () => {
    const b = buildBankIncome(
      [...banks, { id: 3, bankName: "X", instrumentType: "fixed_deposit", principal: 999_999, interestRate: 99, whtRate: 15, isActive: false }],
      365,
    );
    expect(Math.round(b.base)).toBe(150_000);
  });
});

describe("Round 34 — reinvest hint by phase", () => {
  it("short-horizon plans recommend T-Bills", () => {
    const h = suggestReinvestBucket(2, 12, true);
    expect(h.bucket).toBe("tbill");
  });

  it("growth phase tilts toward bonds (ifb/fxd), not MMF", () => {
    // 120-month horizon, month 40 → growth phase
    const phase = phaseForMonth(40, 120);
    expect(phase).toBe("growth");
    const h = suggestReinvestBucket(40, 120, false);
    expect(["ifb", "fxd"]).toContain(h.bucket);
  });

  it("foundation phase (early months) favors safe base buckets", () => {
    const phase = phaseForMonth(3, 120);
    expect(phase).toBe("foundation");
    const h = suggestReinvestBucket(3, 120, false);
    expect(["mmf", "tbill"]).toContain(h.bucket);
  });

  it("respects custom phase fractions", () => {
    // With a tiny foundation, month 3 is already past it.
    const phase = phaseForMonth(3, 120, { foundationFrac: 0.01, growthFrac: 0.5, deRiskingFrac: 0.15 });
    expect(phase).not.toBe("foundation");
  });
});

describe("Round 34 — partial break math (proportional to fraction broken)", () => {
  // Mirror the client breakCalc: figures scale linearly with the broken fraction.
  function partial(accrued: number, penalty: number, principal: number, amt: number) {
    const frac = principal > 0 ? amt / principal : 0;
    const accruedOnPortion = Math.round(accrued * frac * 100) / 100;
    const pen = Math.round(penalty * frac * 100) / 100;
    return { accruedOnPortion, penalty: pen, netKept: Math.max(0, accruedOnPortion - pen) };
  }

  it("breaking half forfeits half the penalty and keeps half the interest", () => {
    const r = partial(4_000, 1_000, 100_000, 50_000);
    expect(r.accruedOnPortion).toBe(2_000);
    expect(r.penalty).toBe(500);
    expect(r.netKept).toBe(1_500);
  });

  it("breaking the full principal equals the full what-if", () => {
    const r = partial(4_000, 1_000, 100_000, 100_000);
    expect(r.accruedOnPortion).toBe(4_000);
    expect(r.penalty).toBe(1_000);
    expect(r.netKept).toBe(3_000);
  });
});
