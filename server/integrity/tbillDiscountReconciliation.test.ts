import { describe, it, expect } from "vitest";
import {
  reconcile,
  RECON_TOLERANCE_KES,
  type ReconInputs,
} from "../../shared/reconciliation";
import { accretedValue } from "../../shared/discount";
import {
  runProjection,
  type EngineSettings,
  type ActualDeposit,
  type ActualSecurity,
  type SecondaryMmfInput,
  type ActualBankHolding,
} from "../engine";

/**
 * Regression for the live-reported bug (account otienojames3112@gmail.com, TEST
 * env): the Reconciliation "Full portfolio value" section showed a Mismatch
 * because "Engine projection value (today)" read KES 208,924.11 while every
 * other source (sum-of-holdings reference, Dashboard, Portfolio Review) read
 * KES 210,000.00 — a -1,075.89 gap that is exactly the un-accreted discount on a
 * freshly purchased 91-day T-bill (face 150,000 bought at ~148,924.11).
 *
 * Root cause: the engine values a live discount T-bill at its ACCRETED cost
 * (price -> face over its life), which for a new lot sits near purchase price,
 * below face; the reference values it at FACE. The two conventions must be put
 * on ONE footing. The fix adds the un-accreted discount (face - accretedValue)
 * back to the engine "today" figure, mirroring the engine's own integer-month
 * accretion basis, so the section reconciles to the cent.
 *
 * This suite reproduces the exact portfolio and pins the fix.
 */

function pastStartISO(monthsBack: number): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1, 12, 0, 0),
  );
  return d.toISOString().split("T")[0];
}
function monthsAfter(startISO: string, k: number, day: number): string {
  const s = new Date(startISO + "T12:00:00Z");
  const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + k, day, 12, 0, 0));
  return d.toISOString().split("T")[0];
}

// Replicate the router's face-basis add-back so the test asserts the SAME math
// the live reconciliation now uses (integer-month accretion fraction).
function unaccretedTbillDiscount(
  securities: ActualSecurity[],
  startISO: string,
  nowMs: number,
): number {
  const start = new Date(startISO + "T12:00:00Z");
  const currentMonth = Math.max(
    0,
    Math.floor(
      (new Date(nowMs).getFullYear() - start.getFullYear()) * 12 +
        (new Date(nowMs).getMonth() - start.getMonth()),
    ),
  );
  return securities
    .filter((s) => !s.isMatured)
    .reduce((sum, s) => {
      const face = s.faceValue || 0;
      const price = Number(s.purchasePrice ?? 0) || 0;
      if (!(price > 0 && price < face)) return sum;
      const issue = new Date(String(s.issueDate) + "T12:00:00Z");
      const mat = new Date(String(s.maturityDate) + "T12:00:00Z");
      const issueMonth =
        Math.floor(
          (issue.getFullYear() - start.getFullYear()) * 12 +
            (issue.getMonth() - start.getMonth()),
        ) + 1;
      const tenorMonths = Math.round(
        (mat.getFullYear() - issue.getFullYear()) * 12 +
          (mat.getMonth() - issue.getMonth()),
      );
      const age = currentMonth - issueMonth;
      const fraction = tenorMonths > 0 ? age / tenorMonths : 1;
      return sum + (face - accretedValue(face, price, fraction));
    }, 0);
}

describe("Full-portfolio reconciliation with a discounted T-bill (live bug fix)", () => {
  const START = pastStartISO(3);
  const NOW = Date.now();

  const SETTINGS: EngineSettings = {
    mmfYield: 13.2,
    tbill91Rate: 8.82,
    tbill182Rate: 8.78,
    tbill364Rate: 8.97,
    ifbCouponRate: 12.5,
    fxdCouponRate: 12.35,
    withholdingTax: 15,
    startingContribution: 10000,
    stepUpAmount: 0,
    stepUpMonths: 6,
    safetyFloor: 50000,
    targetAmount: 5000000,
    startDate: START,
    horizonMonths: 120,
  };

  // The reported portfolio: MMF 10,000 + bank 50,000 + T-bill face 150,000 = 210,000.
  const PRIMARY_MMF = 10_000;
  const BANK = [50_000];
  const TBILL_FACE = 150_000;
  const TBILL_PRICE = 148_924.11; // discount = 1,075.89 (the exact reported gap)
  const SECURITIES_FACE = [TBILL_FACE];

  const deposits: ActualDeposit[] = [
    { bucket: "mmf", institutionType: "mmf_fund", amount: PRIMARY_MMF, depositDate: monthsAfter(START, 0, 5), mmfFundId: 1 },
  ];
  // A live 91-day T-bill bought below face LATE in the (past) window, i.e. close
  // to "today", so it is barely accreted — reproducing the freshly-purchased
  // condition from the live report where the full ~1,075.89 discount showed.
  const securities: ActualSecurity[] = [
    {
      securityType: "tbill_91",
      faceValue: TBILL_FACE,
      purchasePrice: TBILL_PRICE,
      issueDate: monthsAfter(START, 3, 1),
      maturityDate: monthsAfter(START, 6, 1),
      couponRate: 0,
      isTaxExempt: false,
    },
  ];
  const secondaries: SecondaryMmfInput[] = [];
  const bank: ActualBankHolding[] = [
    { principal: 50_000, interestRate: 10, whtRate: 15, startDate: monthsAfter(START, 0, 15), tenorMonths: 12, dayCountBasis: 365 },
  ];

  function buildInputs(): { raw: number; fixed: number; sumParts: number } {
    const projection = runProjection(SETTINGS, [], [], deposits, securities, secondaries, bank, 1);
    const lastActual = [...projection].reverse().find((r) => r.isActual)!;
    expect(lastActual).toBeTruthy();
    const rawToday = lastActual.totalEnd - (lastActual.mmfEnd - PRIMARY_MMF);
    const addBack = unaccretedTbillDiscount(securities, START, NOW);
    const fixedToday = rawToday + addBack;
    const sumParts =
      PRIMARY_MMF + BANK.reduce((a, b) => a + b, 0) + SECURITIES_FACE.reduce((a, b) => a + b, 0);
    return { raw: rawToday, fixed: fixedToday, sumParts };
  }

  it("the raw engine 'today' value sits BELOW face by the un-accreted discount (reproduces the bug)", () => {
    const { raw, sumParts } = buildInputs();
    // The engine prices the live T-bill near its purchase price → below the
    // 210,000 face reference. This is the -1,075.89 gap from the screenshot.
    expect(raw).toBeLessThan(sumParts);
    expect(sumParts - raw).toBeGreaterThan(500); // meaningfully below face
    expect(sumParts).toBe(210_000);
  });

  it("the face-basis add-back makes engine 'today' equal the sum-of-holdings reference", () => {
    const { fixed, sumParts } = buildInputs();
    expect(Math.abs(fixed - sumParts)).toBeLessThanOrEqual(RECON_TOLERANCE_KES);
  });

  it("Full-portfolio reconciliation is GREEN after the fix (no projection mismatch)", () => {
    const { fixed, sumParts } = buildInputs();
    const inputs: ReconInputs = {
      primaryMmfBalance: PRIMARY_MMF,
      secondaryMmfBalances: [],
      bankHoldingPrincipals: BANK,
      securityFaceValues: SECURITIES_FACE,
      otherAssetValues: [],
      projectionTodayValue: fixed,
      dashboardActualsTotal: sumParts,
      accrualLedgerMmfTotal: PRIMARY_MMF,
      dashboardNetWorth: sumParts,
    };
    const r = reconcile(inputs);
    expect(r.reconciled).toBe(true);
    expect(r.mismatches.map((m) => m.key)).not.toContain("projection");
    expect(r.maxDiff).toBeLessThanOrEqual(RECON_TOLERANCE_KES);
  });

  it("WITHOUT the fix the section would be RED (guards against regression)", () => {
    const { raw, sumParts } = buildInputs();
    const inputs: ReconInputs = {
      primaryMmfBalance: PRIMARY_MMF,
      secondaryMmfBalances: [],
      bankHoldingPrincipals: BANK,
      securityFaceValues: SECURITIES_FACE,
      otherAssetValues: [],
      projectionTodayValue: raw, // un-fixed engine value
      dashboardActualsTotal: sumParts,
      accrualLedgerMmfTotal: PRIMARY_MMF,
      dashboardNetWorth: sumParts,
    };
    const r = reconcile(inputs);
    expect(r.reconciled).toBe(false);
    expect(r.mismatches.map((m) => m.key)).toContain("projection");
  });
});
