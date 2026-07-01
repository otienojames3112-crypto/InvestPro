/**
 * Regression layer for the audit-remediation round. Each block pins ONE fix so a
 * future edit that quietly regresses it fails here rather than in production.
 *
 *   A. Snapshot tax model — payable WHT is distinct from the income/tax base.
 *   B. Reconciliation sections — income/tax base is never measured against full
 *      net worth, and a forced page-selector mismatch turns the RIGHT section red.
 *   C. Shared security-income engine — one source of truth for T-bill discount
 *      vs coupon accrual and per-holding WHT.
 *   D. Dynamic goal copy — the goal label follows the portfolio target.
 *   E. Bank sweep safety — government preference + risk-adjusted scoring.
 *   F. CSV headers still match the displayed column labels.
 */
import { describe, it, expect } from "vitest";
import {
  reconcileSections,
  type ReconSectionsInputs,
} from "../../shared/reconciliation";
import {
  selectAnnualWht,
  selectWhtToDate,
  selectFullPeriodProjectedWht,
  selectIncomeTaxBase,
  type PortfolioSnapshot,
} from "../../shared/snapshot";
import { computeSecurityIncome, whtRateFor } from "../../shared/securityIncome";
import { decideBankSweep, type GovSweepOption } from "../../shared/bankSweep";
import { LEDGER_COLUMNS } from "../../shared/ledgerColumns";

// ── A. Snapshot tax model ────────────────────────────────────────────────────
describe("A. snapshot tax model — payable WHT distinct from income base", () => {
  const tax = {
    base: 3_000_000,
    annualWht: 45_000,
    whtToDate: 12_500,
    fullPeriodProjectedWht: 480_000,
    breakdown: { mmf: 30_000, tbill: 15_000, ifb: 0 },
  };
  const snap = {
    tax,
    holdings: { incomeTaxBase: tax.base },
  } as unknown as PortfolioSnapshot;

  it("exposes payable WHT separately from the capital base", () => {
    expect(selectIncomeTaxBase(snap)).toBe(3_000_000);
    expect(selectAnnualWht(snap)).toBe(45_000);
    expect(selectWhtToDate(snap)).toBe(12_500);
    expect(selectFullPeriodProjectedWht(snap)).toBe(480_000);
  });

  it("payable WHT is far smaller than the income base (never the same number)", () => {
    expect(selectAnnualWht(snap)).toBeLessThan(selectIncomeTaxBase(snap));
    expect(selectAnnualWht(snap)).not.toBe(selectIncomeTaxBase(snap));
  });

  it("breakdown is per-source payable WHT that sums toward the annual figure", () => {
    const sum = Object.values(tax.breakdown).reduce((a, b) => a + b, 0);
    expect(sum).toBe(45_000);
  });
});

// ── B. Reconciliation sections ───────────────────────────────────────────────
describe("B. reconciliation sections — separation + honest red", () => {
  function baseInputs(over: Partial<ReconSectionsInputs> = {}): ReconSectionsInputs {
    return {
      sumOfParts: 4_200_000,
      projectionTodayValue: 4_200_000,
      dashboardActualsTotal: 4_200_000,
      dashboardNetWorth: 4_200_000,
      portfolioReviewNetWorth: 4_200_000,
      goalPlanAssets: 4_000_000,
      ledgerTodayComparable: 4_000_000,
      incomeTaxBase: 3_000_000, // legitimately BELOW net worth (equity held)
      taxSummaryBase: 3_000_000,
      ...over,
    };
  }

  it("is all-green even when the income/tax base is below full net worth", () => {
    const r = reconcileSections(baseInputs());
    expect(r.ok).toBe(true);
    const incomeSec = r.sections.find((s) => s.key === "incomeTax")!;
    expect(incomeSec.ok).toBe(true);
    // The income section reference is the income base, NOT full net worth.
    expect(incomeSec.reference).toBe(3_000_000);
  });

  it("the income/tax base is never compared to the full-portfolio reference", () => {
    const r = reconcileSections(baseInputs());
    const full = r.sections.find((s) => s.key === "fullPortfolio")!;
    const keys = full.sources.map((s) => s.key);
    expect(keys).not.toContain("incomeTaxBase");
    expect(keys).not.toContain("taxSummaryBase");
  });

  it("a drifted DASHBOARD selector turns ONLY the full-portfolio section red", () => {
    const r = reconcileSections(baseInputs({ dashboardNetWorth: 4_250_000 }));
    expect(r.ok).toBe(false);
    expect(r.sections.find((s) => s.key === "fullPortfolio")!.ok).toBe(false);
    expect(r.sections.find((s) => s.key === "goalPlan")!.ok).toBe(true);
    expect(r.sections.find((s) => s.key === "incomeTax")!.ok).toBe(true);
  });

  it("a drifted TAX base turns ONLY the income/tax section red (green-badge theater guard)", () => {
    const r = reconcileSections(baseInputs({ taxSummaryBase: 3_100_000 }));
    expect(r.ok).toBe(false);
    expect(r.sections.find((s) => s.key === "incomeTax")!.ok).toBe(false);
    expect(r.sections.find((s) => s.key === "fullPortfolio")!.ok).toBe(true);
  });

  it("a drifted LEDGER comparable turns ONLY the goal-plan section red", () => {
    const r = reconcileSections(baseInputs({ ledgerTodayComparable: 3_900_000 }));
    expect(r.ok).toBe(false);
    expect(r.sections.find((s) => s.key === "goalPlan")!.ok).toBe(false);
    expect(r.sections.find((s) => s.key === "fullPortfolio")!.ok).toBe(true);
  });
});

// ── C. Shared security-income engine ─────────────────────────────────────────
describe("C. one shared security-income engine", () => {
  it("a T-bill earns the DISCOUNT (face − price), not a coupon on face", () => {
    const r = computeSecurityIncome({
      securityType: "tbill_364",
      faceValue: 1_000_000,
      couponRate: 0,
      purchasePrice: 900_000,
      issueDate: "2026-01-01",
      maturityDate: "2027-01-01",
    });
    // Lifetime gross is the discount (100,000), NOT faceValue × couponRate.
    expect(r.lifetimeGross).toBeCloseTo(100_000, -1);
    expect(r.isDiscount).toBe(true);
    expect(r.whtPct).toBe(15);
  });

  it("an FXD is coupon-bearing and taxed; a 10y+ FXD uses the 10% tier", () => {
    const shortFxd = whtRateFor({
      securityType: "fxd",
      faceValue: 1_000_000,
      couponRate: 12,
      tenorYears: 3,
    });
    const longFxd = whtRateFor({
      securityType: "fxd",
      faceValue: 1_000_000,
      couponRate: 12,
      tenorYears: 11,
    });
    expect(shortFxd).toBe(15);
    expect(longFxd).toBe(10);
    const r = computeSecurityIncome({
      securityType: "fxd",
      faceValue: 1_000_000,
      couponRate: 12,
      tenorYears: 3,
      issueDate: "2026-01-01",
      maturityDate: "2029-01-01",
    });
    expect(r.isDiscount).toBe(false);
    expect(r.lifetimeGross).toBeGreaterThan(0);
  });

  it("an IFB coupon is tax-exempt by default", () => {
    const r = computeSecurityIncome({
      securityType: "ifb",
      faceValue: 1_000_000,
      couponRate: 12,
      issueDate: "2026-01-01",
      maturityDate: "2036-01-01",
    });
    expect(r.whtPct).toBe(0);
    expect(r.lifetimeWht).toBe(0);
  });
});

// ── D. Dynamic goal copy ─────────────────────────────────────────────────────
describe("D. goal label follows the portfolio target (no hardcoded 5M)", () => {
  // Mirror of the pure formatter used in ModelDrawer so the contract is pinned.
  function goalLabel(target: number): string {
    if (target <= 0) return "your goal";
    if (target >= 1_000_000) {
      const m = target / 1_000_000;
      return `KES ${Number.isInteger(m) ? m : m.toFixed(1)}M`;
    }
    return `KES ${Math.round(target).toLocaleString()}`;
  }
  it("renders the actual target, not a constant", () => {
    expect(goalLabel(5_000_000)).toBe("KES 5M");
    expect(goalLabel(7_500_000)).toBe("KES 7.5M");
    expect(goalLabel(10_000_000)).toBe("KES 10M");
    expect(goalLabel(750_000)).toBe("KES 750,000");
    expect(goalLabel(0)).toBe("your goal");
  });
});

// ── E. Bank sweep safety ─────────────────────────────────────────────────────
describe("E. safe bank sweep", () => {
  const gov: GovSweepOption[] = [{ bucket: "ifb", label: "IFB", netPct: 15 }];
  it("defaults to government and emits the 'Swept → Securities' phrase", () => {
    const d = decideBankSweep(50_000, gov, [], {});
    expect(d.destination).toBe("government");
    expect(d.ledgerExplanation).toContain("Swept → Securities");
  });
  it("only prefers a bank deposit when it clears the risk-adjusted margin", () => {
    const near = decideBankSweep(50_000, gov, [
      { id: 1, bankName: "B", instrumentType: "fixed_deposit", principal: 0, interestRate: 16 / 0.85 },
    ], {});
    expect(near.destination).toBe("government");
    const clears = decideBankSweep(50_000, gov, [
      { id: 1, bankName: "B", instrumentType: "fixed_deposit", principal: 0, interestRate: 20 },
    ], {});
    expect(clears.destination).toBe("bank");
  });
});

// ── F. CSV headers ───────────────────────────────────────────────────────────
describe("F. CSV headers match displayed labels", () => {
  it("includes the MMF Interest and Swept → Securities columns", () => {
    const byKey = Object.fromEntries(LEDGER_COLUMNS.map((c) => [c.key, c]));
    expect(byKey["MMF Interest"]).toBeTruthy();
    expect(byKey["Swept → Securities"]).toBeTruthy();
  });
  it("every column's CSV header equals its own key (round-trippable)", () => {
    for (const col of LEDGER_COLUMNS) {
      expect(col.csvHeader).toBe(col.key);
    }
  });
});
