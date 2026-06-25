import { describe, it, expect } from "vitest";
import {
  computeActualsTotals,
  estimateAnnualTaxLines,
  type DepositRow,
  type SecondaryMmfActual,
  type BankHoldingActual,
  type SecurityActual,
  type ActualsRates,
} from "../shared/actuals";

/**
 * R40.7 — the Dashboard's "Est. Annual Tax" (computeActualsTotals.taxLiability)
 * and the Tax Summary page's per-line tax total (estimateAnnualTaxLines) must
 * agree, because both now derive from the same buckets + WHT authority. These
 * tests feed BOTH engines the same portfolio and assert Dashboard == TaxSummary.
 */

const rates: ActualsRates = {
  withholdingTax: 15,
  mmfYield: 10,
  tbillRate: 9,
  fxdCouponRate: 12,
};

const deposits: DepositRow[] = [
  { amount: 1_000_000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: 1 },
];
const secondaries: SecondaryMmfActual[] = [
  { mmfFundId: 2, currentBalance: 300_000, ear: 11, whtRate: 15 },
];
const bankHoldings: BankHoldingActual[] = [
  { principal: 500_000, interestRate: 8, whtRate: 15, isActive: true },
];
const securities: SecurityActual[] = [
  { securityType: "tbill_364", faceValue: 400_000, couponRate: 9, isTaxExempt: false },
  { securityType: "ifb", faceValue: 600_000, couponRate: 13, isTaxExempt: true },
  { securityType: "fxd", faceValue: 700_000, couponRate: 12, isTaxExempt: false },
];

function dashboardTax() {
  return computeActualsTotals(deposits, secondaries, bankHoldings, rates, securities, []);
}

function taxSummaryEngine(buckets: { mmf: number; tbill: number; ifb: number; fxd: number }) {
  return estimateAnnualTaxLines({
    buckets,
    primaryMmfRate: rates.mmfYield,
    tbillRate: rates.tbillRate,
    ifbRate: 13,
    fxdRate: rates.fxdCouponRate,
    withholdingTax: rates.withholdingTax,
    primaryMmfLabel: "MMF",
    secondaryMmfs: secondaries.map((m, i) => ({
      label: `Secondary ${i}`,
      balance: m.currentBalance,
      rate: m.ear,
      whtRate: m.whtRate,
    })),
    bankHoldings: bankHoldings.map((b, i) => ({
      label: `Bank ${i}`,
      principal: b.principal,
      rate: b.interestRate,
      whtRate: b.whtRate,
    })),
  });
}

describe("R40.7 — Dashboard vs Tax Summary annual-tax cross-check", () => {
  it("the two engines produce the SAME total annual tax", () => {
    const dash = dashboardTax();
    const summary = taxSummaryEngine(dash.byBucket);
    expect(summary.taxLiability).toBeCloseTo(dash.taxLiability, 1);
  });

  it("the Tax Summary per-line sum equals its reported total", () => {
    const dash = dashboardTax();
    const summary = taxSummaryEngine(dash.byBucket);
    const lineSum = summary.lines.reduce((s, l) => s + l.tax, 0);
    expect(lineSum).toBeCloseTo(summary.taxLiability, 1);
  });

  it("IFB contributes zero tax in BOTH engines (tax-exempt)", () => {
    const dash = dashboardTax();
    const summary = taxSummaryEngine(dash.byBucket);
    expect(dash.taxBreakdown.ifb).toBe(0);
    const ifbLine = summary.lines.find((l) => l.key === "ifb");
    expect(ifbLine?.tax).toBe(0);
    expect(ifbLine?.exempt).toBe(true);
  });

  it("per-pocket taxes match between the breakdown and the lines", () => {
    const dash = dashboardTax();
    const summary = taxSummaryEngine(dash.byBucket);
    const get = (k: string) => summary.lines.find((l) => l.key === k)?.tax ?? 0;
    expect(get("mmf")).toBeCloseTo(dash.taxBreakdown.mmf, 1);
    expect(get("tbill")).toBeCloseTo(dash.taxBreakdown.tbill, 1);
    expect(get("fxd")).toBeCloseTo(dash.taxBreakdown.fxd, 1);
    expect(get("secondaryMmf:0")).toBeCloseTo(dash.taxBreakdown.secondaryMmf, 1);
    expect(get("bank:0")).toBeCloseTo(dash.taxBreakdown.bank, 1);
  });

  it("RED: a divergent Tax Summary rate breaks the cross-check", () => {
    const dash = dashboardTax();
    // Feed the Tax Summary engine a wrong MMF rate → its total must diverge.
    const wrong = estimateAnnualTaxLines({
      buckets: dash.byBucket,
      primaryMmfRate: rates.mmfYield + 5, // drift
      tbillRate: rates.tbillRate,
      ifbRate: 13,
      fxdRate: rates.fxdCouponRate,
      withholdingTax: rates.withholdingTax,
      secondaryMmfs: secondaries.map((m, i) => ({ label: `S${i}`, balance: m.currentBalance, rate: m.ear, whtRate: m.whtRate })),
      bankHoldings: bankHoldings.map((b, i) => ({ label: `B${i}`, principal: b.principal, rate: b.interestRate, whtRate: b.whtRate })),
    });
    expect(Math.abs(wrong.taxLiability - dash.taxLiability)).toBeGreaterThan(5);
  });

  it("withdrawals shrink BOTH engines' tax equally (one footing)", () => {
    const withDrawn = computeActualsTotals(
      deposits,
      secondaries,
      bankHoldings,
      rates,
      securities,
      [{ sourceType: "mmf_fund", mmfFundId: 1, amount: 500_000 }],
    );
    const summary = taxSummaryEngine(withDrawn.byBucket);
    // The primary-MMF bucket halved, so the MMF tax line halves too and the
    // totals still tie out.
    expect(summary.taxLiability).toBeCloseTo(withDrawn.taxLiability, 1);
  });
});
