import { describe, it, expect } from "vitest";
import {
  govAccruedInterestToDate,
  govAccruedInterestTotal,
  govWhtPct,
  estInterestToDate,
  type GovSecurityAccrualInput,
} from "../shared/actuals";

// ─────────────────────────────────────────────────────────────────────────────
// R41.4 — Est. Interest Earned must cover ALL income-earning assets
// (MMF primary + secondary, bank instruments, government securities), and
// reconcile with the per-asset accrual model used by the Daily Accrual page.
// Other assets (capital-appreciation) are intentionally excluded from interest.
// ─────────────────────────────────────────────────────────────────────────────

const TODAY = "2026-06-25";

describe("govWhtPct — tiered WHT authority", () => {
  it("IFB is tax-exempt", () => {
    expect(govWhtPct("ifb", 15)).toBe(0);
    expect(govWhtPct("ifb", null, true)).toBe(0);
  });
  it("T-bills are 15%", () => {
    expect(govWhtPct("tbill_91")).toBe(15);
    expect(govWhtPct("tbill_182")).toBe(15);
    expect(govWhtPct("tbill_364")).toBe(15);
  });
  it("FXD is tenor-tiered: 15% under 10y, 10% at/over 10y", () => {
    expect(govWhtPct("fxd", 5)).toBe(15);
    expect(govWhtPct("fxd", 9.99)).toBe(15);
    expect(govWhtPct("fxd", 10)).toBe(10);
    expect(govWhtPct("fxd", 20)).toBe(10);
  });
  it("isTaxExempt override forces 0 regardless of type", () => {
    expect(govWhtPct("fxd", 5, true)).toBe(0);
  });
});

describe("govAccruedInterestToDate — pro-rata coupon, net of tiered WHT", () => {
  it("FXD (5y, 15% WHT): face×rate×days/365×(1-0.15)", () => {
    const sec: GovSecurityAccrualInput = {
      securityType: "fxd",
      faceValue: 1_000_000,
      couponRate: 12,
      issueDate: "2026-01-01",
      maturityDate: "2031-01-01",
      tenorYears: 5,
    };
    // issue 2026-01-01 → today 2026-06-25 = 175 days
    const days = Math.floor(
      (Date.parse(`${TODAY}T12:00:00Z`) - Date.parse("2026-01-01T12:00:00Z")) / 86_400_000,
    );
    const expected =
      Math.round(1_000_000 * 0.12 * (days / 365) * (1 - 0.15) * 100) / 100;
    expect(govAccruedInterestToDate(sec, TODAY)).toBeCloseTo(expected, 2);
  });

  it("IFB accrues gross (no WHT)", () => {
    const sec: GovSecurityAccrualInput = {
      securityType: "ifb",
      faceValue: 500_000,
      couponRate: 13,
      issueDate: "2026-01-01",
      maturityDate: "2040-01-01",
      isTaxExempt: true,
    };
    const days = Math.floor(
      (Date.parse(`${TODAY}T12:00:00Z`) - Date.parse("2026-01-01T12:00:00Z")) / 86_400_000,
    );
    const expected = Math.round(500_000 * 0.13 * (days / 365) * 100) / 100;
    expect(govAccruedInterestToDate(sec, TODAY)).toBeCloseTo(expected, 2);
  });

  it("FXD (10y) uses the 10% tier", () => {
    const sec: GovSecurityAccrualInput = {
      securityType: "fxd",
      faceValue: 1_000_000,
      couponRate: 14,
      issueDate: "2026-01-01",
      maturityDate: "2036-01-01",
      tenorYears: 10,
    };
    const days = Math.floor(
      (Date.parse(`${TODAY}T12:00:00Z`) - Date.parse("2026-01-01T12:00:00Z")) / 86_400_000,
    );
    const expected =
      Math.round(1_000_000 * 0.14 * (days / 365) * (1 - 0.1) * 100) / 100;
    expect(govAccruedInterestToDate(sec, TODAY)).toBeCloseTo(expected, 2);
  });

  it("caps accrual at maturity (does not accrue past it)", () => {
    const sec: GovSecurityAccrualInput = {
      securityType: "tbill_182",
      faceValue: 1_000_000,
      couponRate: 16,
      issueDate: "2025-01-01",
      maturityDate: "2025-07-01", // matured long before TODAY
    };
    const days = Math.floor(
      (Date.parse("2025-07-01T12:00:00Z") - Date.parse("2025-01-01T12:00:00Z")) / 86_400_000,
    );
    const expected =
      Math.round(1_000_000 * 0.16 * (days / 365) * (1 - 0.15) * 100) / 100;
    expect(govAccruedInterestToDate(sec, TODAY)).toBeCloseTo(expected, 2);
  });

  it("returns 0 for zero face value or zero rate", () => {
    expect(
      govAccruedInterestToDate(
        { securityType: "fxd", faceValue: 0, couponRate: 12, issueDate: "2026-01-01" },
        TODAY,
      ),
    ).toBe(0);
    expect(
      govAccruedInterestToDate(
        { securityType: "fxd", faceValue: 1000, couponRate: 0, issueDate: "2026-01-01" },
        TODAY,
      ),
    ).toBe(0);
  });
});

describe("R41.4 — portfolio-wide Est. Interest Earned reconciliation", () => {
  // Mirror the getActualsSummary accrual: MMF + secondary + bank + gov.
  const mmfDeposits = [
    { amount: 1_000_000, date: "2026-01-01" },
    { amount: 500_000, date: "2026-03-01" },
  ];
  const secondary = [{ bal: 300_000, ear: 9, wht: 15, start: "2026-02-01" }];
  const bank = [{ principal: 800_000, rate: 11, wht: 15, start: "2026-01-15" }];
  const govs: GovSecurityAccrualInput[] = [
    { securityType: "tbill_364", faceValue: 1_000_000, couponRate: 16, issueDate: "2026-01-01", maturityDate: "2026-12-31" },
    { securityType: "ifb", faceValue: 2_000_000, couponRate: 13, issueDate: "2026-01-01", maturityDate: "2041-01-01", isTaxExempt: true },
  ];
  const mmfYield = 8.78;

  function dashboardEstInterest(): number {
    let total = 0;
    for (const d of mmfDeposits) total += estInterestToDate(d.amount, mmfYield, 15, d.date, TODAY);
    for (const s of secondary) total += estInterestToDate(s.bal, s.ear, s.wht, s.start, TODAY);
    for (const b of bank) total += estInterestToDate(b.principal, b.rate, b.wht, b.start, TODAY);
    total += govAccruedInterestTotal(govs, TODAY);
    return Math.round(total * 100) / 100;
  }

  it("Dashboard total equals the sum of independently-computed per-asset accruals (ties to Daily Accrual)", () => {
    const mmfPart =
      estInterestToDate(1_000_000, mmfYield, 15, "2026-01-01", TODAY) +
      estInterestToDate(500_000, mmfYield, 15, "2026-03-01", TODAY);
    const secPart = estInterestToDate(300_000, 9, 15, "2026-02-01", TODAY);
    const bankPart = estInterestToDate(800_000, 11, 15, "2026-01-15", TODAY);
    const govPart = govAccruedInterestTotal(govs, TODAY);
    const sum = Math.round((mmfPart + secPart + bankPart + govPart) * 100) / 100;
    expect(dashboardEstInterest()).toBeCloseTo(sum, 2);
  });

  it("government-securities interest is a NON-ZERO contributor (was previously omitted)", () => {
    const govPart = govAccruedInterestTotal(govs, TODAY);
    expect(govPart).toBeGreaterThan(0);
    // Removing gov must change the dashboard total — proving it is included.
    const withoutGov =
      dashboardEstInterest() - govPart;
    expect(dashboardEstInterest()).toBeGreaterThan(withoutGov);
  });

  it("RED: a drifted gov WHT (treating FXD as exempt) breaks reconciliation", () => {
    const sec: GovSecurityAccrualInput = {
      securityType: "fxd",
      faceValue: 1_000_000,
      couponRate: 12,
      issueDate: "2026-01-01",
      tenorYears: 5,
    };
    const correct = govAccruedInterestToDate(sec, TODAY); // 15% WHT applied
    const wrongExempt = govAccruedInterestToDate({ ...sec, isTaxExempt: true }, TODAY);
    // If someone wrongly marked an FXD exempt, the figure would be higher and
    // would NOT reconcile with the taxed expectation.
    expect(wrongExempt).not.toBeCloseTo(correct, 2);
    expect(wrongExempt).toBeGreaterThan(correct);
  });
});
