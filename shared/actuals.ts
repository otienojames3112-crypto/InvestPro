/**
 * Pure, framework-free aggregation of a portfolio's LIVE actuals (net worth)
 * across every destination the user owns: government-security + primary-MMF
 * deposit rows, secondary MMF account balances, and bank instrument principals.
 *
 * This is the single source of truth used by `getActualsSummary` (server/db.ts)
 * and is unit-tested directly so the "deposit reflects everywhere" guarantee is
 * locked in without needing a live database.
 *
 * Double-counting rule: a deposit attributed to a secondary MMF fund or a bank
 * instrument is represented by that destination's running balance/principal, so
 * its deposit row must be EXCLUDED from the primary contribution sum.
 */

export type DepositRow = {
  amount: number;
  bucket: "mmf" | "tbill" | "ifb" | "fxd";
  institutionType?: string | null;
  mmfFundId?: number | null;
};

export type SecondaryMmfActual = {
  mmfFundId?: number | null;
  currentBalance: number;
  ear: number;
  whtRate?: number | null;
};

export type BankHoldingActual = {
  principal: number;
  interestRate: number;
  whtRate?: number | null;
  isActive?: boolean;
};

export type ActualsRates = {
  withholdingTax: number; // percent, e.g. 15
  mmfYield: number; // percent gross
  tbillRate: number; // percent gross
  fxdCouponRate: number; // percent gross
};

export function computeActualsTotals(
  deposits: DepositRow[],
  secondaries: SecondaryMmfActual[],
  bankHoldings: BankHoldingActual[],
  rates: ActualsRates,
) {
  const secondaryFundIds = new Set(
    secondaries.map((s) => s.mmfFundId).filter((id): id is number => typeof id === "number"),
  );

  let depositsContributed = 0;
  const byBucket = { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };

  for (const row of deposits) {
    if (row.institutionType === "bank_instrument") continue;
    if (
      row.institutionType === "mmf_fund" &&
      row.mmfFundId != null &&
      secondaryFundIds.has(row.mmfFundId)
    ) {
      continue;
    }
    depositsContributed += row.amount;
    byBucket[row.bucket] += row.amount;
  }

  let secondaryMmfBalance = 0;
  let secondaryMmfTax = 0;
  for (const s of secondaries) {
    const sWht = (s.whtRate ?? 15) / 100;
    secondaryMmfBalance += s.currentBalance;
    secondaryMmfTax += s.currentBalance * (s.ear / 100) * sWht;
  }

  let bankBalance = 0;
  let bankTax = 0;
  for (const b of bankHoldings) {
    if (b.isActive === false) continue;
    const bWht = (b.whtRate ?? 15) / 100;
    bankBalance += b.principal;
    bankTax += b.principal * (b.interestRate / 100) * bWht;
  }

  const wht = rates.withholdingTax / 100;
  const mmfTax = byBucket.mmf * (rates.mmfYield / 100) * wht;
  const tbillTax = byBucket.tbill * (rates.tbillRate / 100) * wht;
  const fxdTax = byBucket.fxd * (rates.fxdCouponRate / 100) * wht;
  const ifbTax = 0; // IFB coupons are tax-exempt in Kenya

  const totalContributed = depositsContributed + secondaryMmfBalance + bankBalance;
  const taxLiability = mmfTax + tbillTax + ifbTax + fxdTax + secondaryMmfTax + bankTax;

  return {
    totalContributed,
    depositsContributed,
    secondaryMmfBalance,
    bankBalance,
    byBucket,
    taxBreakdown: {
      mmf: Math.round(mmfTax * 100) / 100,
      tbill: Math.round(tbillTax * 100) / 100,
      ifb: 0,
      fxd: Math.round(fxdTax * 100) / 100,
      secondaryMmf: Math.round(secondaryMmfTax * 100) / 100,
      bank: Math.round(bankTax * 100) / 100,
    },
    taxLiability,
  };
}
