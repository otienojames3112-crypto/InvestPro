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
  /** "tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd" | "zero_coupon" | "floating_rate" */
  securityType: string;
  faceValue: number;
  couponRate: number; // annual %, gross
  isTaxExempt: boolean;
  isMatured?: boolean;
  /** Bond tenor in years (IFB/FXD). Used for the ledger IFB band + tiered WHT. */
  tenorYears?: number | null;
  /** Round 42 — cash paid up front for a discount instrument (T-bill / zero-coupon). */
  purchasePrice?: number | null;
  /** Round 42 — discount/yield rate (%) for pricing a discount instrument. */
  discountRate?: number | null;
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
  // Round 39: per-tenor T-bill split + dominant IFB band so the ledger's actual
  // (today) row matches the projected rows' tenor columns.
  const tbillByTenor = { d91: 0, d182: 0, d364: 0 };
  let ifbDominantFace = 0;
  let ifbTenorYears = 0;
  let securitiesValue = 0;
  let tbillTax = 0;
  let fxdTax = 0;
  for (const s of securities) {
    if (s.isMatured) continue;
    securitiesValue += s.faceValue;
    // Round 42: zero-coupon bonds are discount instruments — group with T-bills.
    const isTbill = s.securityType.startsWith("tbill") || s.securityType === "zero_coupon";
    const isIfb = s.securityType === "ifb";
    if (isTbill) {
      byBucket.tbill += s.faceValue;
      if (s.securityType === "tbill_91") tbillByTenor.d91 += s.faceValue;
      else if (s.securityType === "tbill_182") tbillByTenor.d182 += s.faceValue;
      else tbillByTenor.d364 += s.faceValue;
      // Round 42: WHT is charged on the DISCOUNT (face − price), which is the
      // instrument's entire return — NOT on the face value. When the actual
      // purchase price is recorded we use the true discount; otherwise we fall
      // back to the face × tbillRate approximation for legacy rows.
      const price = s.purchasePrice != null && Number(s.purchasePrice) > 0
        ? Number(s.purchasePrice)
        : null;
      const discount = price != null && price < s.faceValue
        ? s.faceValue - price
        : s.faceValue * (rates.tbillRate / 100);
      tbillTax += whtOn(discount, govWht);
    } else if (isIfb) {
      byBucket.ifb += s.faceValue; // IFB coupons are tax-exempt in Kenya
      if (s.faceValue > ifbDominantFace) {
        ifbDominantFace = s.faceValue;
        ifbTenorYears = s.tenorYears != null ? Math.round(Number(s.tenorYears) * 10) / 10 : 0;
      }
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
    /** Round 39: per-tenor T-bill split + dominant IFB band for the ledger. */
    tbillByTenor,
    ifbTenorYears,
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

// ─── Round 40 (R40.7): unified annual-tax line engine ───────────────────────
//
// The Dashboard's "Est. Annual Tax" reads `computeActualsTotals().taxLiability`.
// The Tax Summary page historically rebuilt the same tax arithmetic inline,
// which let the two drift. This engine produces the per-source investment-income
// tax lines AND a `taxLiability` total from the SAME buckets and the SAME
// `whtOn` / `WHT_RATES` authority that `computeActualsTotals` uses, so:
//
//   sum(line.tax)  ===  computeActualsTotals(...).taxLiability
//
// by construction (both consume the post-withdrawal `byBucket` + per-account
// rows). The Tax Summary page builds its displayed investment lines from this
// engine; non-investment items (e.g. equity dividends) remain page-level
// addenda layered on top, clearly outside the reconciled investment total.

export interface AnnualTaxLine {
  /** Stable key for cross-referencing (mmf, secondaryMmf:<i>, tbill, ifb, fxd, bank:<i>). */
  key: string;
  source: string;
  /** Annual gross income before tax. */
  basis: number;
  /** WHT rate applied (%). 0 for tax-exempt. */
  rate: number;
  tax: number;
  net: number;
  exempt: boolean;
  note: string;
}

export interface AnnualTaxResult {
  lines: AnnualTaxLine[];
  /** Sum of all line taxes — equals computeActualsTotals().taxLiability. */
  taxLiability: number;
  totalGross: number;
  totalNet: number;
}

export interface AnnualTaxInput {
  /** Post-withdrawal bucket balances (use computeActualsTotals().byBucket). */
  buckets: { mmf: number; tbill: number; ifb: number; fxd: number };
  primaryMmfRate: number; // % gross
  tbillRate: number; // % gross
  ifbRate: number; // % gross (display only; IFB is exempt)
  fxdRate: number; // % gross
  withholdingTax: number; // % WHT for gov + primary MMF
  primaryMmfLabel?: string;
  /** Each tracked secondary MMF (post any scaling) with its own rate + WHT. */
  secondaryMmfs: { label: string; balance: number; rate: number; whtRate?: number | null }[];
  /** Each active bank deposit with its own rate + WHT. */
  bankHoldings: { label: string; principal: number; rate: number; whtRate?: number | null }[];
  /**
   * Round 43 (Fix #4) — per-security discount detail for T-bills / zero-coupons.
   * When supplied, the T-bill tax LINE is computed on the ACTUAL discount
   * (face − purchasePrice) summed across these rows — the SAME basis
   * computeActualsTotals uses — so the Tax Summary total ties to the Dashboard's
   * "Est. Annual Tax" to the shilling. Rows without a price fall back to
   * face × tbillRate (legacy behaviour). When omitted entirely, the engine keeps
   * the original bucket × rate approximation for backward compatibility.
   */
  tbillSecurities?: { faceValue: number; purchasePrice?: number | null }[];
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build the unified per-source annual-tax lines. The arithmetic mirrors
 * `computeActualsTotals` exactly so the totals reconcile across pages.
 */
export function estimateAnnualTaxLines(input: AnnualTaxInput): AnnualTaxResult {
  const lines: AnnualTaxLine[] = [];
  const govWht = input.withholdingTax || WHT_RATES.tbill;
  const mmfWht = input.withholdingTax || WHT_RATES.mmfInterest;

  // Primary MMF interest — 15% WHT, final.
  if (input.buckets.mmf > 0) {
    const basis = input.buckets.mmf * (input.primaryMmfRate / 100);
    const tax = whtOn(basis, mmfWht);
    lines.push({
      key: "mmf",
      source: `${input.primaryMmfLabel ?? "MMF"} interest (primary)`,
      basis,
      rate: mmfWht,
      tax,
      net: basis - tax,
      exempt: false,
      note: "Withheld at source by fund manager; final tax.",
    });
  }

  // Secondary MMF accounts, each at its own yield/WHT.
  input.secondaryMmfs.forEach((m, i) => {
    if (!(m.balance > 0)) return;
    const wht = m.whtRate ?? WHT_RATES.mmfInterest;
    const basis = m.balance * (m.rate / 100);
    const tax = whtOn(basis, wht);
    lines.push({
      key: `secondaryMmf:${i}`,
      source: `${m.label} interest`,
      basis,
      rate: wht,
      tax,
      net: basis - tax,
      exempt: false,
      note: "Additional tracked MMF account; WHT withheld at source by fund manager.",
    });
  });

  // T-bill discount income — 15% WHT.
  // Round 43 (Fix #4): when per-security discount detail is supplied, the BASIS is
  // the ACTUAL discount (face − purchase price) summed across the recorded bills —
  // identical to computeActualsTotals — so this line ties to the Dashboard's tax to
  // the shilling. Rows without a price fall back to face × tbillRate; if no detail
  // is supplied at all we keep the original bucket × rate approximation.
  if (input.buckets.tbill > 0) {
    let basis: number;
    let note: string;
    if (input.tbillSecurities && input.tbillSecurities.length > 0) {
      basis = input.tbillSecurities.reduce((sum, s) => {
        const price = s.purchasePrice != null && Number(s.purchasePrice) > 0 ? Number(s.purchasePrice) : null;
        const discount = price != null && price < s.faceValue
          ? s.faceValue - price
          : s.faceValue * (input.tbillRate / 100);
        return sum + discount;
      }, 0);
      note = "15% WHT on the actual T-bill discount (face − purchase price).";
    } else {
      basis = input.buckets.tbill * (input.tbillRate / 100);
      note = "15% WHT on T-bill interest (discount).";
    }
    const tax = whtOn(basis, govWht);
    lines.push({
      key: "tbill",
      source: "Treasury Bill discount income",
      basis,
      rate: govWht,
      tax,
      net: basis - tax,
      exempt: false,
      note,
    });
  }

  // IFB coupon — tax-exempt.
  if (input.buckets.ifb > 0) {
    const basis = input.buckets.ifb * (input.ifbRate / 100);
    lines.push({
      key: "ifb",
      source: "Infrastructure Bond (IFB) coupon",
      basis,
      rate: 0,
      tax: 0,
      net: basis,
      exempt: true,
      note: "Infrastructure bonds are tax-exempt under the Income Tax Act.",
    });
  }

  // FXD coupon — 15% WHT (10% for 10y+ tenor; user adjusts via WHT rate).
  if (input.buckets.fxd > 0) {
    const basis = input.buckets.fxd * (input.fxdRate / 100);
    const tax = whtOn(basis, govWht);
    lines.push({
      key: "fxd",
      source: "Fixed-Coupon Treasury Bond (FXD) coupon",
      basis,
      rate: govWht,
      tax,
      net: basis - tax,
      exempt: false,
      note: "15% WHT (10% applies to bonds of 10+ year tenor).",
    });
  }

  // Bank-instrument interest — each at its own rate/WHT, final tax.
  input.bankHoldings.forEach((b, i) => {
    if (!(b.principal > 0) || !(b.rate > 0)) return;
    const wht = b.whtRate ?? WHT_RATES.bankInterest;
    const basis = b.principal * (b.rate / 100);
    const tax = whtOn(basis, wht);
    lines.push({
      key: `bank:${i}`,
      source: b.label,
      basis,
      rate: wht,
      tax,
      net: basis - tax,
      exempt: false,
      note: "Bank-deposit interest: 15% WHT (final tax), same as MMF interest.",
    });
  });

  const taxLiability = r2(lines.reduce((s, l) => s + l.tax, 0));
  const totalGross = r2(lines.reduce((s, l) => s + l.basis, 0));
  const totalNet = r2(lines.reduce((s, l) => s + l.net, 0));
  return { lines, taxLiability, totalGross, totalNet };
}


// ─── R41.4: Government-securities accrued interest to date ─────────────────────
// The Dashboard's "Est. Interest Earned" must cover EVERY income-earning asset,
// including government securities (T-bill / IFB / FXD). Government paper accrues a
// pro-rata coupon (faceValue × couponRate × daysHeld/365), net of the correct
// tiered WHT (IFB exempt; T-bills 15%; FXD 15% under 10y, 10% at/over 10y). This
// mirrors `buildSecurityIncome` in shared/incomeBreakdown.ts so the Dashboard ties
// out to the Daily Accrual government schedule rather than inventing a new model.

export interface GovSecurityAccrualInput {
  securityType:
    | "tbill_91"
    | "tbill_182"
    | "tbill_364"
    | "ifb"
    | "fxd"
    | "zero_coupon"
    | "floating_rate";
  faceValue: number;
  couponRate: number; // % p.a.
  issueDate?: string | Date | null;
  maturityDate?: string | Date | null;
  isMatured?: boolean;
  isTaxExempt?: boolean;
  tenorYears?: number | null;
  /** Round 42 — cash paid up front for a discount instrument (T-bill / zero-coupon). */
  purchasePrice?: number | null;
}

/** Tiered WHT % for a government security (IFB exempt, T-bills 15%, FXD tenor-tiered). */
export function govWhtPct(
  securityType: GovSecurityAccrualInput["securityType"],
  tenorYears?: number | null,
  isTaxExempt?: boolean,
): number {
  if (isTaxExempt || securityType === "ifb") return 0;
  if (securityType.startsWith("tbill") || securityType === "zero_coupon") return 15;
  // FXD — tenor-tiered: 10% for tenor >= 10y, else 15%.
  const y = typeof tenorYears === "number" && tenorYears > 0 ? tenorYears : 10;
  return y >= 10 ? 10 : 15;
}

function isoDay(d: string | Date | null | undefined): string | null {
  if (!d) return null;
  const s = d instanceof Date ? d.toISOString() : String(d);
  return s.slice(0, 10);
}

/**
 * Net accrued coupon interest on a single government security from its issue date
 * to today (capped at maturity). Pro-rata simple coupon, net of tiered WHT.
 */
export function govAccruedInterestToDate(
  sec: GovSecurityAccrualInput,
  todayISO: string,
  dayCount = 365,
): number {
  if (sec.isMatured) {
    // Matured securities have already paid out; their coupon income is realised
    // up to maturity. Accrue the full held window issue→maturity.
  }
  const face = Math.max(0, sec.faceValue || 0);
  const rate = Math.max(0, sec.couponRate || 0);

  // Round 42 — DISCOUNT INSTRUMENTS (T-bill / zero-coupon): the return is the
  // discount (face − price) accreted pro-rata over the holding window, NOT a
  // coupon. WHT applies to the discount only. This makes T-bills (couponRate 0)
  // contribute their real return to the Dashboard estimate.
  const isDiscount =
    sec.securityType.startsWith("tbill") || sec.securityType === "zero_coupon";
  const price =
    sec.purchasePrice != null && Number(sec.purchasePrice) > 0
      ? Number(sec.purchasePrice)
      : null;
  if (isDiscount && price != null && price < face) {
    const issue = isoDay(sec.issueDate) ?? todayISO;
    const maturity = isoDay(sec.maturityDate);
    let endISO = todayISO;
    if (maturity && maturity < todayISO) endISO = maturity;
    const from = new Date(`${issue}T12:00:00.000Z`).getTime();
    const to = new Date(`${endISO}T12:00:00.000Z`).getTime();
    const totalFrom = from;
    const totalTo = maturity
      ? new Date(`${maturity}T12:00:00.000Z`).getTime()
      : to;
    if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
    const elapsed = Math.max(0, Math.floor((to - from) / 86_400_000));
    const tenorDays = Math.max(1, Math.floor((totalTo - totalFrom) / 86_400_000));
    const fraction = Math.min(1, elapsed / tenorDays);
    const grossDiscount = face - price;
    const wht = govWhtPct(sec.securityType, sec.tenorYears, sec.isTaxExempt);
    const net = grossDiscount * fraction * (1 - wht / 100);
    return Math.max(0, Math.round(net * 100) / 100);
  }

  if (!(face > 0) || !(rate > 0)) return 0;

  const issue = isoDay(sec.issueDate) ?? todayISO;
  const maturity = isoDay(sec.maturityDate);
  // End date = min(today, maturity) so we never accrue past maturity.
  let endISO = todayISO;
  if (maturity && maturity < todayISO) endISO = maturity;

  const issueTime = new Date(`${issue}T12:00:00.000Z`).getTime();
  const nowTime = new Date(`${endISO}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(issueTime) || !Number.isFinite(nowTime)) return 0;
  if (nowTime <= issueTime) return 0;
  const MS_PER_DAY = 86_400_000;
  const wht = govWhtPct(sec.securityType, sec.tenorYears, sec.isTaxExempt);

  // Yield-quoted DISCOUNT instruments (T-bill / zero-coupon supplied with a
  // yield in `couponRate` but no explicit purchase price): they earn a single,
  // monotonic discount accretion over the holding window — NOT a resetting
  // coupon. Accrue the simple prorated return face × yield × days/365 (net of
  // WHT), capped at maturity. This is the genuine return on a zero-coupon bill.
  if (isDiscount) {
    const days = Math.floor((nowTime - issueTime) / MS_PER_DAY);
    if (days <= 0) return 0;
    const grossAnnual = face * (rate / 100);
    const gross = (grossAnnual * days) / dayCount;
    const net = gross * (1 - wht / 100);
    return Math.max(0, Math.round(net * 100) / 100);
  }

  // Part 1 (Dashboard brief): COUPON BONDS (FXD / IFB / floating-rate) must scope
  // their accrued interest to the CURRENT coupon period only — the value actually
  // sitting inside the bond today — NOT issue→today, which counts every coupon
  // already PAID OUT before tracking began and inflates the "Est. Interest Earned"
  // figure so it no longer reconciles with tracked net-worth growth.
  //
  // This mirrors `accruedCouponSinceLastCoupon` / `currentSecurityValue` in
  // shared/discount.ts (the single source of truth for a coupon bond's dirty
  // value): accrued resets at each ~182.5-day coupon date and grows linearly to
  // one half-year coupon, capped at a single period. The formula is inlined here
  // (identical to discount.ts) to keep shared/actuals.ts free of an import cycle.
  const maturityTime = maturity
    ? new Date(`${maturity}T12:00:00.000Z`).getTime()
    : Number.POSITIVE_INFINITY;
  const COUPON_PERIOD_DAYS = 182.5;
  const halfYearCoupon = (face * (rate / 100)) / 2;
  let grossAccrued: number;
  if (Number.isFinite(maturityTime) && nowTime >= maturityTime) {
    // At/after maturity the final coupon is paid in full.
    grossAccrued = halfYearCoupon;
  } else {
    const daysSinceIssue = (nowTime - issueTime) / MS_PER_DAY;
    const fractionIntoPeriod =
      (daysSinceIssue % COUPON_PERIOD_DAYS) / COUPON_PERIOD_DAYS;
    grossAccrued = halfYearCoupon * fractionIntoPeriod;
  }

  const net = grossAccrued * (1 - wht / 100);
  return Math.max(0, Math.round(net * 100) / 100);
}

/**
 * Sum of net accrued government-securities interest to date across a portfolio.
 * Used by getActualsSummary so the Dashboard estimate includes gov paper.
 */
export function govAccruedInterestTotal(
  securities: GovSecurityAccrualInput[],
  todayISO: string,
  dayCount = 365,
): number {
  let total = 0;
  for (const s of securities) total += govAccruedInterestToDate(s, todayISO, dayCount);
  return Math.round(total * 100) / 100;
}
