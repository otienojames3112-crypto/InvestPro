import { WHT_RATES, whtOn } from "./accrual";

/**
 * Pure, framework-free aggregation of a portfolio's LIVE actuals (net worth)
 * across every destination the user owns: primary-MMF deposit rows, the
 * government-securities REGISTER (the single source of truth for T-bill/IFB/FXD),
 * secondary MMF account balances, and bank instrument principals.
 *
 * This is the single source of truth used by `getActualsSummary` (server/db.ts)
 * and is unit-tested directly so the "deposit reflects everywhere" guarantee is
 * locked in without needing a live database.
 *
 * Double-counting rule: a deposit attributed to a secondary MMF fund, a bank
 * instrument, OR a government security is represented by that destination's
 * own running balance (secondary balance, bank principal) or register row
 * (gov securities), so its deposit row must be EXCLUDED from the primary
 * contribution sum. Only primary-MMF deposits feed `depositsContributed`.
 */

export type DepositRow = {
  amount: number;
  bucket: "mmf" | "tbill" | "ifb" | "fxd";
  institutionType?: string | null;
  mmfFundId?: number | null;
};

export type SecurityActual = {
  /** "tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd" */
  securityType: string;
  faceValue: number;
  couponRate: number; // annual %, gross
  isTaxExempt: boolean;
  isMatured?: boolean;
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

/** A recorded withdrawal (money OUT). Mirrors the deposit source taxonomy. */
export type WithdrawalRow = {
  sourceType: "mmf_fund" | "bank_instrument" | "government_security";
  /** null = primary MMF; a secondary fund id otherwise. */
  mmfFundId?: number | null;
  amount: number;
};

/** Net withdrawals by source bucket, classifying primary vs secondary MMF. */
function sumWithdrawals(
  withdrawals: WithdrawalRow[],
  secondaryFundIds: Set<number>,
) {
  let primaryMmf = 0;
  let secondaryMmf = 0;
  let bank = 0;
  let gov = 0;
  for (const w of withdrawals) {
    const amt = Math.max(0, w.amount);
    if (w.sourceType === "bank_instrument") bank += amt;
    else if (w.sourceType === "government_security") gov += amt;
    else if (w.sourceType === "mmf_fund" && w.mmfFundId != null && secondaryFundIds.has(w.mmfFundId)) {
      secondaryMmf += amt;
    } else {
      primaryMmf += amt;
    }
  }
  return { primaryMmf, secondaryMmf, bank, gov };
}

/**
 * Estimate the NET interest (after WHT) earned on a single MMF principal between
 * `fromISO` and `toISO`, using the same geometric daily-compounding model as the
 * accrual ledger. Returns 0 for non-positive principal or zero/negative elapsed
 * days. This is an estimate for display only — the authoritative day-by-day
 * figures live in the accrual ledger.
 */
export function estInterestToDate(
  principal: number,
  annualEar: number,
  whtRate: number,
  fromISO: string,
  toISO: string,
  dayCount = 365,
): number {
  if (!(principal > 0) || !(annualEar > 0)) return 0;
  const from = new Date(`${String(fromISO).slice(0, 10)}T12:00:00.000Z`).getTime();
  const to = new Date(`${String(toISO).slice(0, 10)}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  const days = Math.floor((to - from) / 86_400_000);
  if (days <= 0) return 0;
  const dailyRate = Math.pow(1 + annualEar / 100, 1 / dayCount) - 1;
  const grossFactor = Math.pow(1 + dailyRate, days);
  const gross = principal * (grossFactor - 1);
  const net = gross * (1 - (whtRate || 0) / 100);
  return Math.max(0, Math.round(net * 100) / 100);
}

export function computeActualsTotals(
  deposits: DepositRow[],
  secondaries: SecondaryMmfActual[],
  bankHoldings: BankHoldingActual[],
  rates: ActualsRates,
  securities: SecurityActual[] = [],
  withdrawals: WithdrawalRow[] = [],
) {
  const secondaryFundIds = new Set(
    secondaries.map((s) => s.mmfFundId).filter((id): id is number => typeof id === "number"),
  );

  // ── Primary-MMF deposits only ──────────────────────────────────────────────
  // Government-security, bank-instrument, and secondary-MMF deposits are each
  // represented by their own destination state (register / principal / balance),
  // so they are excluded here to avoid double-counting.
  let depositsContributed = 0;
  for (const row of deposits) {
    if (row.institutionType === "bank_instrument") continue;
    if (row.institutionType === "government_security") continue;
    if (
      row.institutionType === "mmf_fund" &&
      row.mmfFundId != null &&
      secondaryFundIds.has(row.mmfFundId)
    ) {
      continue;
    }
    depositsContributed += row.amount;
  }

  // ── Government securities: valued from the REGISTER (source of truth) ────────
  // All withholding tax flows through the shared `whtOn` helper and the
  // `WHT_RATES` table in shared/accrual.ts, so there is one tax authority.
  const govWht = rates.withholdingTax || WHT_RATES.tbill;
  const byBucket = { mmf: depositsContributed, tbill: 0, ifb: 0, fxd: 0 };
  let securitiesValue = 0;
  let tbillTax = 0;
  let fxdTax = 0;
  for (const s of securities) {
    if (s.isMatured) continue;
    securitiesValue += s.faceValue;
    const isTbill = s.securityType.startsWith("tbill");
    const isIfb = s.securityType === "ifb";
    if (isTbill) {
      byBucket.tbill += s.faceValue;
      // T-bill return is the discount; approximate annual interest = face * rate.
      tbillTax += whtOn(s.faceValue * (rates.tbillRate / 100), govWht);
    } else if (isIfb) {
      byBucket.ifb += s.faceValue; // IFB coupons are tax-exempt in Kenya
    } else {
      // FXD bond
      byBucket.fxd += s.faceValue;
      const coupon = s.couponRate > 0 ? s.couponRate : rates.fxdCouponRate;
      fxdTax += whtOn(s.faceValue * (coupon / 100), govWht);
    }
  }

  // ── Secondary MMF accounts ───────────────────────────────────────────────────
  let secondaryMmfBalance = 0;
  let secondaryMmfTax = 0;
  for (const s of secondaries) {
    const sWht = s.whtRate ?? WHT_RATES.mmfInterest;
    secondaryMmfBalance += s.currentBalance;
    secondaryMmfTax += whtOn(s.currentBalance * (s.ear / 100), sWht);
  }

  // ── Bank instruments ─────────────────────────────────────────────────────────
  let bankBalance = 0;
  let bankTax = 0;
  for (const b of bankHoldings) {
    if (b.isActive === false) continue;
    const bWht = b.whtRate ?? WHT_RATES.bankInterest;
    bankBalance += b.principal;
    bankTax += whtOn(b.principal * (b.interestRate / 100), bWht);
  }

  // ── Apply recorded withdrawals (money OUT), netted by source bucket ──────────
  // Each bucket is floored at 0 so an over-withdrawal can never produce a
  // negative balance in the aggregation (the router validates available funds).
  const wd = sumWithdrawals(withdrawals, secondaryFundIds);
  const netPrimaryMmf = Math.max(0, depositsContributed - wd.primaryMmf);
  const netSecondaryMmf = Math.max(0, secondaryMmfBalance - wd.secondaryMmf);
  const netBank = Math.max(0, bankBalance - wd.bank);
  const netSecurities = Math.max(0, securitiesValue - wd.gov);

  // Recompute primary-MMF bucket and tax on the post-withdrawal base.
  byBucket.mmf = netPrimaryMmf;

  const mmfTax = whtOn(netPrimaryMmf * (rates.mmfYield / 100), rates.withholdingTax || WHT_RATES.mmfInterest);
  const ifbTax = 0; // IFB coupons are tax-exempt in Kenya

  // Tax bases for secondary/bank scale down proportionally to the remaining balance.
  const secScale = secondaryMmfBalance > 0 ? netSecondaryMmf / secondaryMmfBalance : 0;
  const bankScale = bankBalance > 0 ? netBank / bankBalance : 0;
  secondaryMmfTax = secondaryMmfTax * secScale;
  bankTax = bankTax * bankScale;

  const totalContributed =
    netPrimaryMmf + netSecurities + netSecondaryMmf + netBank;
  const taxLiability = mmfTax + tbillTax + ifbTax + fxdTax + secondaryMmfTax + bankTax;

  return {
    totalContributed,
    depositsContributed: netPrimaryMmf,
    securitiesValue: netSecurities,
    secondaryMmfBalance: netSecondaryMmf,
    bankBalance: netBank,
    /** Gross figures before withdrawals, for audit/debug. */
    grossDepositsContributed: depositsContributed,
    withdrawalsByBucket: wd,
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
