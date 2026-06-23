/**
 * Independent reconciliation of a portfolio's "today" value across all subsystems.
 *
 * Each source is computed from its OWN data path; they must agree within TOLERANCE.
 * The whole point is to catch when the live valuation paths (computeActualsTotals,
 * runProjection, the accrual base) disagree — so this file must NOT invent a new
 * valuation. It only compares numbers the live pages already produce.
 *
 * Keep this free of React / DOM / tRPC imports so it stays trivially testable.
 */

export const RECON_TOLERANCE_KES = 5; // rounding slack

export interface ReconSource {
  key: string;
  label: string;
  value: number;
  detail: string;
}

export interface ReconResult {
  sources: ReconSource[];
  maxDiff: number;
  reconciled: boolean;
  mismatches: Array<{ key: string; label: string; diff: number }>;
  reference: number; // the value all others are compared against
}

export interface ReconInputs {
  // 1. Component holdings (the "sum of parts" net worth)
  primaryMmfBalance: number; // primary MMF balance today
  secondaryMmfBalances: number[]; // each tracked secondary MMF balance
  bankHoldingPrincipals: number[]; // each active bank instrument principal/current value
  securityFaceValues: number[]; // each active CBK register security face/current value
  otherAssetValues: number[]; // equities/real estate current values (if included in net worth)

  // 2. Engine projection value at the current month
  projectionTodayValue: number;

  // 3. Dashboard actuals aggregation (computeActualsTotals "total held today")
  dashboardActualsTotal: number;

  // 4. Daily-accrual ledger MMF base (primary + secondaries), summed
  accrualLedgerMmfTotal: number;

  // 5. Net worth as displayed on the dashboard "Live Net Worth" card
  dashboardNetWorth: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function reconcile(inputs: ReconInputs): ReconResult {
  const sumParts =
    inputs.primaryMmfBalance +
    inputs.secondaryMmfBalances.reduce((a, b) => a + b, 0) +
    inputs.bankHoldingPrincipals.reduce((a, b) => a + b, 0) +
    inputs.securityFaceValues.reduce((a, b) => a + b, 0) +
    inputs.otherAssetValues.reduce((a, b) => a + b, 0);

  const sources: ReconSource[] = [
    {
      key: "sumParts",
      label: "Sum of all holdings (net worth from parts)",
      value: round2(sumParts),
      detail: "Primary MMF + secondary MMFs + bank deposits + CBK securities + other assets",
    },
    {
      key: "projection",
      label: "Engine projection value (today)",
      value: round2(inputs.projectionTodayValue),
      detail: "runProjection totalEnd at the current actual month",
    },
    {
      key: "dashboardActuals",
      label: "Dashboard 'total held today'",
      value: round2(inputs.dashboardActualsTotal),
      detail: "computeActualsTotals aggregation",
    },
    {
      key: "accrual",
      label: "Daily-accrual MMF base (summed)",
      value: round2(inputs.accrualLedgerMmfTotal),
      detail: "Per-fund accrual ledger starting balance — MMF portion only",
    },
    {
      key: "netWorth",
      label: "Dashboard 'Live Net Worth' card",
      value: round2(inputs.dashboardNetWorth),
      detail: "Headline net-worth figure",
    },
  ];

  // Compare everything to the "sum of parts" reference.
  const reference = round2(sumParts);

  // The accrual source is MMF-only; reconcile it against the MMF subtotal
  // separately (see reconcileMmf), not the whole portfolio.
  const fullPortfolioSources = sources.filter((s) => s.key !== "accrual");
  const mismatches = fullPortfolioSources
    .filter((s) => Math.abs(s.value - reference) > RECON_TOLERANCE_KES)
    .map((s) => ({ key: s.key, label: s.label, diff: round2(s.value - reference) }));

  const maxDiff = Math.max(0, ...fullPortfolioSources.map((s) => Math.abs(s.value - reference)));

  return {
    sources,
    maxDiff: round2(maxDiff),
    reconciled: mismatches.length === 0,
    mismatches,
    reference,
  };
}

/**
 * Separate MMF-only check so the accrual ledger base can be validated against the
 * MMF subtotal rather than the whole portfolio.
 */
export function reconcileMmf(
  accrualLedgerMmfTotal: number,
  primaryMmfBalance: number,
  secondaryMmfBalances: number[],
): { mmfSubtotal: number; accrual: number; diff: number; ok: boolean } {
  const mmfSubtotal = primaryMmfBalance + secondaryMmfBalances.reduce((a, b) => a + b, 0);
  const diff = round2(accrualLedgerMmfTotal - mmfSubtotal);
  return {
    mmfSubtotal: round2(mmfSubtotal),
    accrual: round2(accrualLedgerMmfTotal),
    diff,
    ok: Math.abs(diff) <= RECON_TOLERANCE_KES,
  };
}
