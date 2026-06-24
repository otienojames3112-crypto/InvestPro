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
  /** Accrued current value if tracked; falls back to principal when absent. */
  currentValue?: number | null;
};

/**
 * The value a single bank holding contributes to net worth: its accrued
 * `currentValue` when present and positive, otherwise its `principal`.
 * Inactive holdings contribute nothing.
 */
export function bankHoldingValue(b: BankHoldingActual): number {
  if (b.isActive === false) return 0;
  const cv = Number(b.currentValue ?? 0);
  if (cv > 0) return cv;
  return Number(b.principal ?? 0);
}

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

/**
 * CANONICAL SUM-OF-PARTS NET WORTH (Round 30).
 *
 * Every page that displays a portfolio total MUST derive net worth from this one
 * function so no page can silently omit a pocket (the Round-30 bug was Portfolio
 * Review and Tax Summary excluding bank-instrument holdings, showing KES 46,000
 * while the Dashboard correctly showed KES 143,500).
 *
 * Net worth = primary-MMF principal + every secondary-MMF balance + every active
 * bank-instrument value (accrued currentValue, else principal) + every un-matured
 * CBK security face value + every other-asset current value.
 *
 * This is intentionally pure and framework-free so it is shared verbatim between
 * the Dashboard, Portfolio Review, Tax Summary and the Reconciliation page.
 */
export interface NetWorthParts {
  primaryMmf: number;
  secondaryMmf: number[]; // each secondary MMF balance
  bank: number[]; // each active bank-instrument value (currentValue || principal)
  securities: number[]; // each un-matured CBK security face value
  other: number[]; // each other-asset current value
}

export interface NetWorthBreakdown {
  primaryMmf: number;
  secondaryMmf: number;
  bank: number;
  securities: number;
  other: number;
  total: number;
}

export function sumOfPartsNetWorth(parts: NetWorthParts): NetWorthBreakdown {
  const sum = (xs: number[]) => xs.reduce((a, b) => a + (Number(b) || 0), 0);
  const primaryMmf = Number(parts.primaryMmf) || 0;
  const secondaryMmf = sum(parts.secondaryMmf);
  const bank = sum(parts.bank);
  const securities = sum(parts.securities);
  const other = sum(parts.other);
  const total = primaryMmf + secondaryMmf + bank + securities + other;
  return { primaryMmf, secondaryMmf, bank, securities, other, total };
}


/**
 * EARLY-BREAK "WHAT-IF" (Round 31) — shared, framework-free, used by the
 * holding card and unit tests.
 *
 * Breaking a TERM deposit (fixed / goal savings) before maturity forfeits a
 * share of the interest accrued so far — the bank's early-break penalty,
 * expressed as a % of accrued interest. This helper estimates:
 *   - accruedInterest:  net interest earned from `startISO` to today, and
 *   - netIfBrokenNow:   principal + interest retained after the penalty.
 *
 * It deliberately mirrors `estInterestToDate` so the accrued figure matches the
 * Dashboard's estimated-interest line. Pure: no React/DOM/Date-locale deps.
 */
export interface EarlyBreakWhatIfInput {
  principal: number;
  interestRate: number; // % p.a. gross
  whtRate?: number | null; // % WHT on interest, default 15
  startISO: string; // placement date (YYYY-MM-DD)
  earlyBreakPenaltyPct: number; // % of accrued interest forfeited
  asOfISO?: string; // defaults to today
  dayCount?: number; // 365 or 360
}

export interface EarlyBreakWhatIfResult {
  accruedInterest: number; // net interest earned to date (after WHT)
  penaltyAmount: number; // interest forfeited by breaking now
  retainedInterest: number; // interest you keep if you break now
  netIfBrokenNow: number; // principal + retained interest
}

export function earlyBreakWhatIf(input: EarlyBreakWhatIfInput): EarlyBreakWhatIfResult {
  const principal = Math.max(0, Number(input.principal) || 0);
  const wht = input.whtRate == null ? 15 : Number(input.whtRate);
  const asOf = (input.asOfISO ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
  const accruedInterest = estInterestToDate(
    principal,
    Number(input.interestRate) || 0,
    wht,
    input.startISO,
    asOf,
    input.dayCount ?? 365,
  );
  const penaltyFrac = Math.min(1, Math.max(0, (Number(input.earlyBreakPenaltyPct) || 0) / 100));
  const penaltyAmount = Math.round(accruedInterest * penaltyFrac * 100) / 100;
  const retainedInterest = Math.round((accruedInterest - penaltyAmount) * 100) / 100;
  const netIfBrokenNow = Math.round((principal + retainedInterest) * 100) / 100;
  return { accruedInterest, penaltyAmount, retainedInterest, netIfBrokenNow };
}


/**
 * ROUND 32 — ONE SHARED VALUATION PATH
 * ------------------------------------------------------------------------
 * The Dashboard, Portfolio Review, Tax Summary and Reconciliation pages must
 * all derive net worth and blended yield from the SAME code. Previously each
 * page hand-rolled its own bucket math, which let Portfolio Review double-count
 * secondary-MMF deposits (a secondary-fund deposit row is `bucket:"mmf"` AND
 * `institutionType:"mmf_fund"`, so it leaked into the primary-MMF bucket while
 * ALSO being added via the secondary balance) and let Tax Summary compute an
 * impossible net yield. These helpers are the single source of truth; both the
 * pages and the reconciliation cross-check call them with the same raw inputs.
 */

/** Raw deposit row as returned by `trpc.deposits.list`. */
export interface RawDepositRow {
  amount: number | string;
  bucket: string; // "mmf" | "tbill" | "ifb" | "fxd"
  institutionType?: string | null;
  mmfFundId?: number | null;
}

/** Raw security row as returned by `trpc.securities.list`. */
export interface RawSecurityRow {
  securityType: string;
  faceValue: number | string;
  isMatured?: boolean | null;
}

/** Raw secondary-MMF row as returned by `trpc.secondaryMmfs.list`. */
export interface RawSecondaryMmf {
  mmfFundId?: number | null;
  currentBalance: number | string;
  ear: number | string;
}

/** Raw bank-holding row as returned by `trpc.bankHoldings.list`. */
export interface RawBankHolding {
  principal: number | string;
  interestRate?: number | string | null;
  isActive?: boolean | null;
  currentValue?: number | string | null;
}

/** Raw other-asset row as returned by `trpc.otherHoldings.list`. */
export interface RawOtherHolding {
  assetClass: string;
  currentValue: number | string;
}

/**
 * True when a deposit row represents a SECONDARY-MMF contribution rather than
 * the primary fund. A deposit into ANY MMF fund that is not the portfolio's
 * primary fund is, by definition, a secondary contribution — its balance is
 * already represented by that secondary fund's `currentBalance`, so counting
 * the deposit row again is the classic double-count.
 *
 * Detection is deliberately robust against caller mistakes (Round 33): a row is
 * treated as secondary when EITHER its fund id is in the explicit secondary-fund
 * set OR (when a `primaryFundId` is known) its fund id differs from the primary.
 * Relying on the secondary-set alone is fragile — if a caller passes the wrong
 * id (e.g. the secondary ROW id instead of its FUND id) the set never matches
 * and the deposit leaks back into the primary bucket. The primary-fund check is
 * the reliable fallback.
 */
function isSecondaryMmfDeposit(
  d: RawDepositRow,
  secondaryFundIds: Set<number>,
  primaryFundId?: number | null,
): boolean {
  if (d.institutionType !== "mmf_fund" || d.mmfFundId == null) return false;
  if (secondaryFundIds.has(d.mmfFundId)) return true;
  if (primaryFundId != null && d.mmfFundId !== primaryFundId) return true;
  return false;
}

export interface AllocationInput {
  deposits: RawDepositRow[];
  securities: RawSecurityRow[];
  secondaryMmfs: RawSecondaryMmf[];
  bankHoldings: RawBankHolding[];
  otherHoldings: RawOtherHolding[];
  /** Human labels for other-asset classes (e.g. { equity: "Equities" }). */
  assetLabels?: Record<string, string>;
  /**
   * The portfolio's PRIMARY fund id, if known. When provided, any `mmf_fund`
   * deposit whose fund id differs from this is treated as a secondary
   * contribution and excluded from the primary-MMF bucket — a robust guard
   * against the secondary-fund set being mis-populated by the caller.
   */
  primaryFundId?: number | null;
}

export interface AllocationItem {
  label: string;
  value: number;
}

export interface AllocationResult {
  /** Primary-MMF deposit balance (secondary-fund rows excluded). */
  primaryMmf: number;
  /** Sum of secondary-MMF current balances. */
  secondaryMmf: number;
  /** Un-matured CBK securities, split by type. */
  tbill: number;
  ifb: number;
  fxd: number;
  /** Active bank deposits at accrued value. */
  bank: number;
  /** Other tracked assets by class. */
  other: Record<string, number>;
  /** Sorted allocation rows for the donut/bar. */
  items: AllocationItem[];
  /** Total net worth = sum of every part. */
  netWorth: number;
}

/**
 * THE single net-worth + allocation builder. Used by Portfolio Review (render)
 * and Reconciliation (cross-check). Excludes secondary-MMF and bank/government
 * deposit ROWS from the primary-MMF bucket so nothing is counted twice.
 */
export function buildAllocation(input: AllocationInput): AllocationResult {
  const num = (x: unknown) => Number(x) || 0;
  const secondaryFundIds = new Set<number>(
    input.secondaryMmfs
      .map((s) => s.mmfFundId)
      .filter((id): id is number => typeof id === "number"),
  );

  let primaryMmf = 0;
  for (const d of input.deposits) {
    if (d.institutionType === "government_security" || d.institutionType === "bank_instrument") continue;
    if (isSecondaryMmfDeposit(d, secondaryFundIds, input.primaryFundId)) continue; // avoid double count
    if (d.bucket === "mmf") primaryMmf += num(d.amount);
  }

  let tbill = 0, ifb = 0, fxd = 0;
  for (const s of input.securities) {
    if (s.isMatured) continue;
    const face = num(s.faceValue);
    if (String(s.securityType).startsWith("tbill")) tbill += face;
    else if (s.securityType === "ifb") ifb += face;
    else fxd += face;
  }

  const secondaryMmf = input.secondaryMmfs.reduce((a, s) => a + num(s.currentBalance), 0);

  const bank = input.bankHoldings
    .filter((b) => b.isActive !== false)
    .reduce(
      (a, b) =>
        a +
        bankHoldingValue({
          principal: num(b.principal),
          interestRate: num(b.interestRate),
          isActive: b.isActive !== false,
          currentValue: num(b.currentValue),
        }),
      0,
    );

  const other: Record<string, number> = {};
  for (const h of input.otherHoldings) {
    other[h.assetClass] = (other[h.assetClass] ?? 0) + num(h.currentValue);
  }

  const labels = input.assetLabels ?? {};
  const items: AllocationItem[] = [];
  const govAndMmf = primaryMmf + secondaryMmf + tbill + ifb + fxd;
  if (govAndMmf > 0) items.push({ label: "MMF + CBK Securities", value: govAndMmf });
  if (bank > 0) items.push({ label: "Bank Deposits", value: bank });
  for (const [k, v] of Object.entries(other)) {
    if (v > 0) items.push({ label: labels[k] ?? k, value: v });
  }
  items.sort((a, b) => b.value - a.value);

  const netWorth = govAndMmf + bank + Object.values(other).reduce((a, b) => a + b, 0);
  return { primaryMmf, secondaryMmf, tbill, ifb, fxd, bank, other, items, netWorth };
}

export interface BlendedYieldInput {
  /** Primary-MMF balance and its EAR (%). */
  primaryMmf: number;
  primaryMmfRate: number;
  /** Each secondary MMF: balance + EAR (%). */
  secondaryMmfs: { balance: number; rate: number }[];
  /** Each active bank deposit: value + rate (%). */
  bankHoldings: { value: number; rate: number }[];
  /** Each un-matured security: value + gross rate (%) + tax-exempt flag. */
  securities: { value: number; rate: number; taxExempt: boolean }[];
  /** WHT % applied to taxable interest (e.g. 15). */
  whtRate: number;
}

export interface BlendedYieldResult {
  /** Total interest-bearing balance. */
  base: number;
  /** Balance-weighted gross yield (%). */
  grossYield: number;
  /** Net-of-WHT yield (%): gross minus tax on the taxable portion only. */
  netYield: number;
  /** Yield lost to WHT (pp). */
  taxDrag: number;
}

/**
 * THE single blended-yield function. Net yield is computed on the SAME base as
 * gross: net = (sum of net annual income) / base, where each component's net is
 * gross income minus WHT (zero WHT for tax-exempt IFB coupons). This removes the
 * old fragile keyword filter that dropped bank-deposit income from the numerator
 * while keeping its balance in the denominator (the cause of the impossible
 * 3.56% net yield). Pure and unit-testable.
 */
export function blendedYield(input: BlendedYieldInput): BlendedYieldResult {
  const wht = Math.max(0, Number(input.whtRate) || 0) / 100;
  type Part = { bal: number; rate: number; taxExempt: boolean };
  const parts: Part[] = [];
  if (input.primaryMmf > 0) parts.push({ bal: input.primaryMmf, rate: input.primaryMmfRate, taxExempt: false });
  for (const s of input.secondaryMmfs) if (s.balance > 0) parts.push({ bal: s.balance, rate: s.rate, taxExempt: false });
  for (const b of input.bankHoldings) if (b.value > 0) parts.push({ bal: b.value, rate: b.rate, taxExempt: false });
  for (const s of input.securities) if (s.value > 0) parts.push({ bal: s.value, rate: s.rate, taxExempt: s.taxExempt });

  const base = parts.reduce((a, p) => a + p.bal, 0);
  if (base <= 0) return { base: 0, grossYield: 0, netYield: 0, taxDrag: 0 };

  let grossIncome = 0;
  let netIncome = 0;
  for (const p of parts) {
    const gross = p.bal * (p.rate / 100);
    const net = p.taxExempt ? gross : gross * (1 - wht);
    grossIncome += gross;
    netIncome += net;
  }
  const grossYield = (grossIncome / base) * 100;
  const netYield = (netIncome / base) * 100;
  return { base, grossYield, netYield, taxDrag: grossYield - netYield };
}
