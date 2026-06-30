/**
 * Cross-page integrity #1 — Money mutation sync.
 *
 * Record a deposit into each instrument type (primary MMF, secondary MMF, bank
 * instrument, 91-day T-bill, FXD) and assert every page's figure moves: the
 * allocation pockets (Holdings / Review), the net-worth bases (Dashboard), the
 * blended income/tax base (Accrual / Tax), and the reconciliation reference.
 */
import { describe, it, expect } from "vitest";
import { buildPortfolioState, type RawRows } from "./fixtures";

function baseRows(): RawRows {
  return {
    deposits: [{ amount: 100_000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: 1 }],
    securities: [],
    secondaryMmfs: [],
    bankHoldings: [],
    otherHoldings: [],
    primaryFundId: 1,
    rates: {
      mmfYield: 15,
      tbill364Rate: 16,
      ifbCouponRate: 14,
      fxdCouponRate: 13,
      withholdingTax: 15,
    },
  };
}

describe("money mutation sync across pages", () => {
  it("a primary-MMF deposit lifts net worth, primary pocket, tax base and reconciliation together", () => {
    const before = buildPortfolioState(baseRows());
    const rows = baseRows();
    rows.deposits.push({ amount: 50_000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: 1 });
    const after = buildPortfolioState(rows);

    expect(after.alloc.primaryMmf).toBeCloseTo(before.alloc.primaryMmf + 50_000, 2);
    expect(after.fullNetWorth).toBeCloseTo(before.fullNetWorth + 50_000, 2);
    expect(after.goalPlanAssets).toBeCloseTo(before.goalPlanAssets + 50_000, 2);
    expect(after.incomeTaxBase).toBeGreaterThan(before.incomeTaxBase); // more MMF in the blend
    expect(after.recon.reference).toBeCloseTo(before.recon.reference + 50_000, 2);
    expect(after.recon.reconciled).toBe(true);
  });

  it("a secondary-MMF balance lifts the secondary pocket and net worth without double-counting", () => {
    const before = buildPortfolioState(baseRows());
    const rows = baseRows();
    rows.secondaryMmfs.push({ mmfFundId: 2, currentBalance: 80_000, ear: 16 });
    const after = buildPortfolioState(rows);

    expect(after.alloc.secondaryMmf).toBeCloseTo(80_000, 2);
    expect(after.alloc.primaryMmf).toBeCloseTo(before.alloc.primaryMmf, 2); // not leaked into primary
    expect(after.fullNetWorth).toBeCloseTo(before.fullNetWorth + 80_000, 2);
    expect(after.recon.reference).toBeCloseTo(before.recon.reference + 80_000, 2);
    expect(after.recon.reconciled).toBe(true);
  });

  it("a bank instrument lifts the bank pocket, net worth and tax base", () => {
    const before = buildPortfolioState(baseRows());
    const rows = baseRows();
    rows.bankHoldings.push({ principal: 200_000, interestRate: 12, isActive: true });
    const after = buildPortfolioState(rows);

    expect(after.alloc.bank).toBeCloseTo(200_000, 2);
    expect(after.fullNetWorth).toBeCloseTo(before.fullNetWorth + 200_000, 2);
    expect(after.incomeTaxBase).toBeGreaterThan(before.incomeTaxBase);
    expect(after.recon.reference).toBeCloseTo(before.recon.reference + 200_000, 2);
    expect(after.recon.reconciled).toBe(true);
  });

  it("a 91-day T-bill (face value) lifts the gov pocket, net worth and tax base", () => {
    const before = buildPortfolioState(baseRows());
    const rows = baseRows();
    rows.securities.push({ securityType: "tbill_91", faceValue: 120_000, isMatured: false });
    const after = buildPortfolioState(rows);

    expect(after.alloc.tbill).toBeCloseTo(120_000, 2);
    expect(after.fullNetWorth).toBeCloseTo(before.fullNetWorth + 120_000, 2);
    expect(after.incomeTaxBase).toBeGreaterThan(before.incomeTaxBase);
    expect(after.recon.reference).toBeCloseTo(before.recon.reference + 120_000, 2);
    expect(after.recon.reconciled).toBe(true);
  });

  it("an FXD bond lifts the fxd pocket, net worth and tax base", () => {
    const before = buildPortfolioState(baseRows());
    const rows = baseRows();
    rows.securities.push({ securityType: "fxd", faceValue: 300_000, isMatured: false });
    const after = buildPortfolioState(rows);

    expect(after.alloc.fxd).toBeCloseTo(300_000, 2);
    expect(after.fullNetWorth).toBeCloseTo(before.fullNetWorth + 300_000, 2);
    expect(after.incomeTaxBase).toBeGreaterThan(before.incomeTaxBase);
    expect(after.recon.reference).toBeCloseTo(before.recon.reference + 300_000, 2);
    expect(after.recon.reconciled).toBe(true);
  });

  it("recording into ALL five instrument types at once keeps every page reconciled", () => {
    const before = buildPortfolioState(baseRows());
    const rows = baseRows();
    rows.deposits.push({ amount: 50_000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: 1 });
    rows.secondaryMmfs.push({ mmfFundId: 2, currentBalance: 80_000, ear: 16 });
    rows.bankHoldings.push({ principal: 200_000, interestRate: 12, isActive: true });
    rows.securities.push({ securityType: "tbill_91", faceValue: 120_000, isMatured: false });
    rows.securities.push({ securityType: "fxd", faceValue: 300_000, isMatured: false });
    const after = buildPortfolioState(rows);

    const expectedDelta = 50_000 + 80_000 + 200_000 + 120_000 + 300_000;
    expect(after.fullNetWorth).toBeCloseTo(before.fullNetWorth + expectedDelta, 2);
    expect(after.recon.reference).toBeCloseTo(before.recon.reference + expectedDelta, 2);
    expect(after.recon.reconciled).toBe(true);
    // Dashboard headline == Review == sum of parts == reconciliation reference.
    expect(after.fullNetWorth).toBeCloseTo(after.recon.reference, 2);
  });
});
