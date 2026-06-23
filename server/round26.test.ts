import { describe, it, expect } from "vitest";
import {
  reconcile,
  reconcileMmf,
  RECON_TOLERANCE_KES,
  type ReconInputs,
} from "../shared/reconciliation";

function baseInputs(over: Partial<ReconInputs> = {}): ReconInputs {
  const primaryMmfBalance = 1_000_000;
  const secondaryMmfBalances = [200_000, 50_000];
  const bankHoldingPrincipals = [300_000];
  const securityFaceValues = [400_000, 100_000];
  const otherAssetValues = [150_000];
  const sumParts =
    primaryMmfBalance +
    secondaryMmfBalances.reduce((a, b) => a + b, 0) +
    bankHoldingPrincipals.reduce((a, b) => a + b, 0) +
    securityFaceValues.reduce((a, b) => a + b, 0) +
    otherAssetValues.reduce((a, b) => a + b, 0);
  return {
    primaryMmfBalance,
    secondaryMmfBalances,
    bankHoldingPrincipals,
    securityFaceValues,
    otherAssetValues,
    projectionTodayValue: sumParts,
    dashboardActualsTotal: sumParts,
    accrualLedgerMmfTotal:
      primaryMmfBalance + secondaryMmfBalances.reduce((a, b) => a + b, 0),
    dashboardNetWorth: sumParts,
    ...over,
  };
}

describe("Round 26 — reconciliation module", () => {
  it("reconciles when every source equals the sum of parts (within tolerance)", () => {
    const r = reconcile(baseInputs());
    expect(r.reconciled).toBe(true);
    expect(r.mismatches).toHaveLength(0);
    expect(r.maxDiff).toBeLessThanOrEqual(RECON_TOLERANCE_KES);
    // reference is the sum of parts
    expect(r.reference).toBe(2_200_000);
  });

  it("tolerates sub-KES-5 rounding drift", () => {
    const r = reconcile(
      baseInputs({
        projectionTodayValue: 2_200_004.99,
        dashboardActualsTotal: 2_199_996.5,
      }),
    );
    expect(r.reconciled).toBe(true);
  });

  it("flags a source that diverges beyond tolerance", () => {
    const r = reconcile(
      baseInputs({ projectionTodayValue: 2_250_000 }),
    );
    expect(r.reconciled).toBe(false);
    expect(r.mismatches.map((m) => m.key)).toContain("projection");
    const proj = r.mismatches.find((m) => m.key === "projection")!;
    expect(proj.diff).toBe(50_000);
    expect(r.maxDiff).toBe(50_000);
  });

  it("excludes the MMF-only accrual source from the whole-portfolio check", () => {
    // accrual base is MMF-only (1.25M) and far below the 2.2M reference,
    // but it must NOT count as a full-portfolio mismatch.
    const r = reconcile(baseInputs());
    expect(r.mismatches.find((m) => m.key === "accrual")).toBeUndefined();
    // it is still listed as a source for display
    expect(r.sources.find((s) => s.key === "accrual")).toBeDefined();
  });

  it("net-worth card mismatch is detected", () => {
    const r = reconcile(baseInputs({ dashboardNetWorth: 2_100_000 }));
    expect(r.reconciled).toBe(false);
    expect(r.mismatches.map((m) => m.key)).toContain("netWorth");
  });
});

describe("Round 26 — MMF base check", () => {
  it("passes when accrual base equals primary + secondaries", () => {
    const m = reconcileMmf(1_250_000, 1_000_000, [200_000, 50_000]);
    expect(m.mmfSubtotal).toBe(1_250_000);
    expect(m.diff).toBe(0);
    expect(m.ok).toBe(true);
  });

  it("fails when accrual base drifts from the MMF subtotal", () => {
    const m = reconcileMmf(1_300_000, 1_000_000, [200_000, 50_000]);
    expect(m.diff).toBe(50_000);
    expect(m.ok).toBe(false);
  });

  it("handles no secondary MMFs", () => {
    const m = reconcileMmf(1_000_000, 1_000_000, []);
    expect(m.mmfSubtotal).toBe(1_000_000);
    expect(m.ok).toBe(true);
  });
});

// ── Integration: sample-like portfolio reconciles across all five sources ──
import {
  runProjection,
  type EngineSettings,
  type ActualDeposit,
  type ActualSecurity,
  type SecondaryMmfInput,
  type ActualBankHolding,
} from "./engine";

function pastStartISO(monthsBack: number): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1, 12, 0, 0));
  return d.toISOString().split("T")[0];
}
function monthsAfter(startISO: string, k: number, day: number): string {
  const s = new Date(startISO + "T12:00:00Z");
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, day, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

describe("Round 26 — sample portfolio reconciles across all five sources", () => {
  const START = pastStartISO(7);
  const SETTINGS: EngineSettings = {
    mmfYield: 13.2, tbill91Rate: 8.82, tbill182Rate: 8.78, tbill364Rate: 8.97,
    ifbCouponRate: 12.5, fxdCouponRate: 12.35, withholdingTax: 15,
    startingContribution: 30000, stepUpAmount: 3000, stepUpMonths: 6,
    safetyFloor: 50000, targetAmount: 5000000, startDate: START, horizonMonths: 120,
  };

  // Recorded principals (the canonical "held today" basis).
  const PRIMARY_MMF = 90000 + 30000 + 30000; // three primary-fund deposits
  const SECONDARIES = [40000];
  const BANK = [250000];
  const SECURITIES_FACE = [50000, 100000]; // tbill + fxd

  const deposits: ActualDeposit[] = [
    { bucket: "mmf", institutionType: "mmf_fund", amount: 90000, depositDate: monthsAfter(START, 0, 5), mmfFundId: 1 },
    { bucket: "mmf", institutionType: "mmf_fund", amount: 30000, depositDate: monthsAfter(START, 1, 5), mmfFundId: 1 },
    { bucket: "mmf", institutionType: "mmf_fund", amount: 30000, depositDate: monthsAfter(START, 3, 5), mmfFundId: 1 },
  ];
  const securities: ActualSecurity[] = [
    { securityType: "tbill364", faceValue: 50000, issueDate: monthsAfter(START, 1, 15), couponRate: 0, isTaxExempt: false },
    { securityType: "fxd", faceValue: 100000, issueDate: monthsAfter(START, 2, 1), couponRate: 12.35, isTaxExempt: false },
  ];
  const secondaries: SecondaryMmfInput[] = [
    { currentBalance: 40000, monthlyContribution: 0, ear: 12.0, whtRate: 15 },
  ];
  const bank: ActualBankHolding[] = [
    { principal: 250000, interestRate: 10, whtRate: 15, startDate: monthsAfter(START, 2, 19), tenorMonths: 6, dayCountBasis: 365 },
  ];

  it("projection-today on the principal basis equals the sum of recorded parts", () => {
    const projection = runProjection(SETTINGS, [], [], deposits, securities, secondaries, bank, 1);
    const lastActual = [...projection].reverse().find((r) => r.isActual)!;
    expect(lastActual).toBeTruthy();

    // Strip actual-period primary-MMF accrual back to recorded principal.
    const projectionTodayValue = lastActual.totalEnd - (lastActual.mmfEnd - PRIMARY_MMF);

    const sumParts =
      PRIMARY_MMF +
      SECONDARIES.reduce((a, b) => a + b, 0) +
      BANK.reduce((a, b) => a + b, 0) +
      SECURITIES_FACE.reduce((a, b) => a + b, 0);

    const inputs = {
      primaryMmfBalance: PRIMARY_MMF,
      secondaryMmfBalances: SECONDARIES,
      bankHoldingPrincipals: BANK,
      securityFaceValues: SECURITIES_FACE,
      otherAssetValues: [],
      projectionTodayValue,
      dashboardActualsTotal: sumParts,
      accrualLedgerMmfTotal: PRIMARY_MMF + SECONDARIES.reduce((a, b) => a + b, 0),
      dashboardNetWorth: sumParts,
    };

    const full = reconcile(inputs);
    const mmf = reconcileMmf(inputs.accrualLedgerMmfTotal, inputs.primaryMmfBalance, inputs.secondaryMmfBalances);

    expect(full.reconciled).toBe(true);
    expect(mmf.ok).toBe(true);
    expect(full.maxDiff).toBeLessThanOrEqual(RECON_TOLERANCE_KES);
  });

  it("secondaries and bank are held flat through actual months (principal preserved)", () => {
    const projection = runProjection(SETTINGS, [], [], deposits, securities, secondaries, bank, 1);
    const lastActual = [...projection].reverse().find((r) => r.isActual)!;
    expect(lastActual.secondaryMmfEnd).toBeCloseTo(40000, 0);
    expect(lastActual.bankEnd).toBeCloseTo(250000, 0);
    // Securities held at face during actual months.
    expect(lastActual.tbillEnd + lastActual.fxdEnd).toBeCloseTo(150000, 0);
  });
});
