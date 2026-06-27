/**
 * Pure interest-accrual breakdowns for NON-MMF income sources (Round 34).
 *
 * The Daily Accrual page historically only modelled MMF accrual. These helpers
 * extend the same "gross / WHT / net" treatment to:
 *   - Government securities (T-Bills discount, IFB coupon [tax-exempt], FXD coupon)
 *   - Bank instruments (fixed / call / savings deposits)
 *
 * Everything here is framework-free and unit-tested. Money figures are KES.
 * "Horizon" interest is a simple (non-compounding) pro-rata of the annual gross
 * over `days`, which matches how coupon/discount instruments actually pay — they
 * do NOT compound intra-period like a daily-credited MMF.
 */

export type SecurityType = "tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd";
export type BankInstrumentType =
  | "call_deposit"
  | "fixed_deposit"
  | "ordinary_savings"
  | "target_savings"
  | "tiered_savings";

export interface SecurityIncomeInput {
  id: number;
  securityType: SecurityType;
  faceValue: number;
  couponRate: number; // % p.a. (for t-bills this is the discount/annualised yield)
  isTaxExempt: boolean;
  maturityDate?: string | Date | null;
  isMatured?: boolean;
}

export interface BankIncomeInput {
  id: number;
  bankName: string;
  label?: string | null;
  instrumentType: BankInstrumentType;
  principal: number;
  interestRate: number; // % p.a.
  whtRate: number; // % (usually 15)
  dayCountBasis?: number; // 360 / 365
  maturityDate?: string | Date | null;
  isActive?: boolean;
}

export interface IncomeRow {
  id: number;
  label: string;
  /** Sub-label, e.g. instrument kind or security type. */
  kind: string;
  base: number; // face value / principal the interest is earned on
  ratePct: number; // annual gross rate applied
  grossAnnual: number;
  whtAnnual: number;
  netAnnual: number;
  grossHorizon: number;
  whtHorizon: number;
  netHorizon: number;
  taxExempt: boolean;
  /**
   * Tense-aware lifecycle status relative to the effective "now" (simulated when
   * the Time Machine is active). Present for government securities; bank rows
   * leave it undefined. Powers the Daily Accrual status badge.
   */
  status?: SecurityRowStatus;
  statusLabel?: string;
}

export interface IncomeSummary {
  rows: IncomeRow[];
  grossAnnual: number;
  whtAnnual: number;
  netAnnual: number;
  grossHorizon: number;
  whtHorizon: number;
  netHorizon: number;
  base: number;
}

/** Standard WHT on government paper: T-bills & FXD coupons 15%, IFB exempt. */
const GOV_WHT_PCT = 15;

const SECURITY_LABELS: Record<SecurityType, string> = {
  tbill_91: "91-day T-Bill",
  tbill_182: "182-day T-Bill",
  tbill_364: "364-day T-Bill",
  ifb: "Infrastructure Bond (IFB)",
  fxd: "Fixed-coupon Bond (FXD)",
};

function proRata(annual: number, days: number): number {
  return (annual * days) / 365;
}

function isLiveSecurity(s: SecurityIncomeInput, now: number = Date.now()): boolean {
  if (s.isMatured) return false;
  if (!s.maturityDate) return true;
  const m = new Date(s.maturityDate);
  m.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return m.getTime() >= today.getTime();
}

/**
 * Tense-aware status of a security relative to the effective "now" (the
 * simulated clock when the Time Machine is active, otherwise the real clock).
 *
 * This powers the Daily Accrual per-holding labels so that, once a maturity
 * date has passed in the active (possibly simulated) timeline, the row reads in
 * the PAST tense ("Matured") instead of pretending it is still accruing.
 *
 *  - "matured"  : flagged matured, OR maturity date is strictly before today.
 *  - "maturing" : maturity date is today (settles today).
 *  - "accruing" : still live and accruing toward a future maturity (or open-ended).
 */
export type SecurityRowStatus = "matured" | "maturing" | "accruing";

export interface SecurityRowStatusInfo {
  status: SecurityRowStatus;
  /** True when the event is in the past (settled) relative to `now`. */
  isPast: boolean;
  /** Short tense-aware label suitable for a badge. */
  label: string;
}

export function securityRowStatus(
  s: Pick<SecurityIncomeInput, "maturityDate" | "isMatured" | "securityType">,
  now: number = Date.now(),
): SecurityRowStatusInfo {
  const isCoupon = s.securityType === "ifb" || s.securityType === "fxd";
  const maturedLabel = isCoupon ? "Matured (coupons paid)" : "Matured";
  if (s.isMatured) {
    return { status: "matured", isPast: true, label: maturedLabel };
  }
  if (!s.maturityDate) {
    return { status: "accruing", isPast: false, label: "Accruing" };
  }
  const m = new Date(s.maturityDate);
  m.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (m.getTime() < today.getTime()) {
    return { status: "matured", isPast: true, label: maturedLabel };
  }
  if (m.getTime() === today.getTime()) {
    return { status: "maturing", isPast: false, label: "Maturing today" };
  }
  return { status: "accruing", isPast: false, label: "Accruing" };
}

/** Build the government-securities income breakdown over `days`. */
export function buildSecurityIncome(
  securities: SecurityIncomeInput[],
  days: number,
  now: number = Date.now(),
): IncomeSummary {
  const rows: IncomeRow[] = [];
  for (const s of securities) {
    if (!isLiveSecurity(s, now)) continue;
    const base = Math.max(0, s.faceValue);
    const ratePct = Math.max(0, s.couponRate);
    const grossAnnual = base * (ratePct / 100);
    // IFBs are tax-exempt in Kenya; T-bills and FXD coupons attract 15% WHT.
    const taxExempt = s.isTaxExempt || s.securityType === "ifb";
    const whtAnnual = taxExempt ? 0 : grossAnnual * (GOV_WHT_PCT / 100);
    const netAnnual = grossAnnual - whtAnnual;
    const { status, label: statusLabel } = securityRowStatus(s, now);
    rows.push({
      id: s.id,
      label: SECURITY_LABELS[s.securityType] ?? s.securityType,
      kind: s.securityType.startsWith("tbill") ? "Treasury Bill (discount)" : s.securityType === "ifb" ? "Tax-exempt coupon" : "Taxable coupon",
      base,
      ratePct,
      grossAnnual,
      whtAnnual,
      netAnnual,
      grossHorizon: proRata(grossAnnual, days),
      whtHorizon: proRata(whtAnnual, days),
      netHorizon: proRata(netAnnual, days),
      taxExempt,
      status,
      statusLabel,
    });
  }
  return summarize(rows);
}

const BANK_LABELS: Record<BankInstrumentType, string> = {
  call_deposit: "Call deposit",
  fixed_deposit: "Fixed deposit",
  ordinary_savings: "Ordinary savings",
  target_savings: "Target / goal savings",
  tiered_savings: "Tiered savings",
};

/**
 * Tense-aware status of a bank instrument relative to the effective "now". Call
 * deposits, ordinary/target/tiered savings have no fixed maturity, so they are
 * always "Accruing". Fixed deposits follow the same matured/maturing/accruing
 * rule as securities, reading "Matured (returned to cash)" once settled.
 */
export function bankRowStatus(
  h: Pick<BankIncomeInput, "maturityDate" | "instrumentType">,
  now: number = Date.now(),
): SecurityRowStatusInfo {
  if (!h.maturityDate) {
    return { status: "accruing", isPast: false, label: "Accruing" };
  }
  const m = new Date(h.maturityDate);
  m.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  if (m.getTime() < today.getTime()) {
    return { status: "matured", isPast: true, label: "Matured (returned to cash)" };
  }
  if (m.getTime() === today.getTime()) {
    return { status: "maturing", isPast: false, label: "Maturing today" };
  }
  return { status: "accruing", isPast: false, label: "Accruing" };
}

/**
 * A bank instrument is "live" (still earning, shown in the breakdown) unless it
 * is a fixed deposit whose maturity date has strictly passed in the effective
 * timeline. Open-ended deposits (call/savings) are always live.
 */
function isLiveBank(h: BankIncomeInput, now: number = Date.now()): boolean {
  if (h.isActive === false) return false;
  if (!h.maturityDate) return true;
  const m = new Date(h.maturityDate);
  m.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return m.getTime() >= today.getTime();
}

/** Build the bank-instrument income breakdown over `days`. */
export function buildBankIncome(
  holdings: BankIncomeInput[],
  days: number,
  now: number = Date.now(),
): IncomeSummary {
  const rows: IncomeRow[] = [];
  for (const h of holdings) {
    if (!isLiveBank(h, now)) continue;
    const base = Math.max(0, h.principal);
    const ratePct = Math.max(0, h.interestRate);
    const dayCount = h.dayCountBasis && h.dayCountBasis > 0 ? h.dayCountBasis : 365;
    // Annual gross on a 365-equivalent basis (so pro-rata uses the same denom).
    const grossAnnual = base * (ratePct / 100) * (365 / dayCount);
    const whtPct = Math.max(0, h.whtRate ?? GOV_WHT_PCT);
    const whtAnnual = grossAnnual * (whtPct / 100);
    const netAnnual = grossAnnual - whtAnnual;
    rows.push({
      id: h.id,
      label: h.label?.trim() ? h.label : h.bankName,
      kind: BANK_LABELS[h.instrumentType] ?? h.instrumentType,
      base,
      ratePct,
      grossAnnual,
      whtAnnual,
      netAnnual,
      grossHorizon: proRata(grossAnnual, days),
      whtHorizon: proRata(whtAnnual, days),
      netHorizon: proRata(netAnnual, days),
      taxExempt: false,
      status: bankRowStatus(h, now).status,
      statusLabel: bankRowStatus(h, now).label,
    });
  }
  return summarize(rows);
}

function summarize(rows: IncomeRow[]): IncomeSummary {
  return {
    rows,
    grossAnnual: rows.reduce((s, r) => s + r.grossAnnual, 0),
    whtAnnual: rows.reduce((s, r) => s + r.whtAnnual, 0),
    netAnnual: rows.reduce((s, r) => s + r.netAnnual, 0),
    grossHorizon: rows.reduce((s, r) => s + r.grossHorizon, 0),
    whtHorizon: rows.reduce((s, r) => s + r.whtHorizon, 0),
    netHorizon: rows.reduce((s, r) => s + r.netHorizon, 0),
    base: rows.reduce((s, r) => s + r.base, 0),
  };
}

// ─── Reinvest hint (Round 34) ───────────────────────────────────────────────

export type Phase = "foundation" | "growth" | "de-risking" | "final-liquidity";

/**
 * Phase boundaries as month numbers, from proportional fractions of the horizon.
 * Mirrors the engine's getPhaseBoundaries so the client can compute the active
 * phase without importing server code.
 */
export function phaseForMonth(
  monthIntoPlan: number,
  horizonMonths: number,
  fractions?: { foundationFrac: number; growthFrac: number; deRiskingFrac: number },
): Phase {
  const f = fractions ?? { foundationFrac: 0.2, growthFrac: 0.5, deRiskingFrac: 0.15 };
  const foundationEnd = Math.round(horizonMonths * f.foundationFrac);
  const growthEnd = Math.round(horizonMonths * (f.foundationFrac + f.growthFrac));
  const deRiskingEnd = Math.round(horizonMonths * (f.foundationFrac + f.growthFrac + f.deRiskingFrac));
  if (monthIntoPlan <= foundationEnd) return "foundation";
  if (monthIntoPlan <= growthEnd) return "growth";
  if (monthIntoPlan <= deRiskingEnd) return "de-risking";
  return "final-liquidity";
}

export interface ReinvestHint {
  phase: Phase;
  /** Recommended next bucket for freed-up cash. */
  bucket: "mmf" | "tbill" | "ifb" | "fxd";
  bucketLabel: string;
  /** Short human rationale. */
  rationale: string;
}

const PHASE_TARGETS: Record<Phase, { mmf: number; tbill: number; ifb: number; fxd: number }> = {
  foundation: { mmf: 0.5, tbill: 0.5, ifb: 0, fxd: 0 },
  growth: { mmf: 0.2, tbill: 0.2, ifb: 0.45, fxd: 0.15 },
  "de-risking": { mmf: 0.25, tbill: 0.35, ifb: 0.3, fxd: 0.1 },
  "final-liquidity": { mmf: 0.4, tbill: 0.45, ifb: 0.1, fxd: 0.05 },
};

const BUCKET_LABELS = { mmf: "Money Market Fund", tbill: "T-Bills", ifb: "IFB bond", fxd: "FXD bond" } as const;

/**
 * Suggest where freed-up cash from a maturing instrument should go, given the
 * phase the plan is in on the maturity date and which bucket is currently most
 * UNDER its phase target. If `currentWeights` is omitted, we fall back to the
 * phase's single largest non-MMF target bucket (the "growth engine" of that phase).
 */
export function suggestReinvestBucket(
  monthIntoPlan: number,
  horizonMonths: number,
  isShortHorizon = false,
  fractions?: { foundationFrac: number; growthFrac: number; deRiskingFrac: number },
  currentWeights?: { mmf: number; tbill: number; ifb: number; fxd: number },
): ReinvestHint {
  if (isShortHorizon) {
    return {
      phase: "foundation",
      bucket: "tbill",
      bucketLabel: BUCKET_LABELS.tbill,
      rationale: "Short-horizon plan — keep it simple with MMF + 91-day T-Bills only.",
    };
  }
  const phase = phaseForMonth(monthIntoPlan, horizonMonths, fractions);
  const target = PHASE_TARGETS[phase];

  let bucket: "mmf" | "tbill" | "ifb" | "fxd";
  if (currentWeights) {
    // Pick the bucket with the largest (target − current) gap, ignoring MMF
    // unless every other bucket is at/over target (then park in MMF).
    const gaps: { b: "tbill" | "ifb" | "fxd"; gap: number }[] = (["tbill", "ifb", "fxd"] as const).map((b) => ({
      b,
      gap: target[b] - (currentWeights[b] ?? 0),
    }));
    gaps.sort((a, b) => b.gap - a.gap);
    bucket = gaps[0].gap > 0 ? gaps[0].b : "mmf";
  } else {
    // No weights given: pick the single largest non-MMF target for this phase.
    const order: ("tbill" | "ifb" | "fxd")[] = ["ifb", "tbill", "fxd"];
    bucket = order.reduce((best, b) => (target[b] > target[best] ? b : best), order[0]);
    if (target[bucket] === 0) bucket = "tbill";
  }

  const rationaleByPhase: Record<Phase, string> = {
    foundation: "Foundation phase — build the safe base with MMF and short T-Bills.",
    growth: "Growth phase — tilt new cash toward IFB/FXD bonds for higher long-run yield.",
    "de-risking": "De-risking phase — rebalance toward shorter T-Bills and trim long bonds.",
    "final-liquidity": "Final-liquidity phase — keep new cash short and liquid for the goal date.",
  };

  return {
    phase,
    bucket,
    bucketLabel: BUCKET_LABELS[bucket],
    rationale: rationaleByPhase[phase],
  };
}

// ─── Day-by-day accrual schedules (Round 39) ────────────────────────────────
//
// The MMF tab shows a true day-by-day table where interest compounds daily.
// Government securities and bank instruments do NOT compound intra-period — a
// T-bill accretes its discount on a straight line to par, and a coupon/fixed
// deposit pays simple interest on its (constant) face/principal. These helpers
// produce a per-day schedule with the CORRECT method for each instrument so the
// Daily Accrual page can render an honest day-by-day breakdown.

export interface DailyAccrualRow {
  day: number;
  /** Opening accrued-interest balance for the day (excludes principal). */
  openingAccrued: number;
  grossDay: number;
  whtDay: number;
  netDay: number;
  /** Closing accrued-interest balance for the day (cumulative net). */
  closingAccrued: number;
}

export interface DailyAccrualSchedule {
  rows: DailyAccrualRow[];
  grossTotal: number;
  whtTotal: number;
  netTotal: number;
  base: number;
}

/**
 * Government-security day-by-day accrual. Both T-bill discount accretion and
 * coupon accrual are STRAIGHT-LINE (simple, non-compounding): each day earns an
 * identical slice of the annual gross. IFBs are tax-exempt; T-bills and FXD
 * coupons attract 15% WHT.
 */
export function buildSecurityDailySchedule(
  securities: SecurityIncomeInput[],
  days: number,
  now: number = Date.now(),
): DailyAccrualSchedule {
  const n = Math.max(1, Math.floor(days));
  let grossPerDay = 0;
  let whtPerDay = 0;
  let base = 0;
  for (const s of securities) {
    if (!isLiveSecurity(s, now)) continue;
    const faceValue = Math.max(0, s.faceValue);
    const ratePct = Math.max(0, s.couponRate);
    const grossAnnual = faceValue * (ratePct / 100);
    const taxExempt = s.isTaxExempt || s.securityType === "ifb";
    base += faceValue;
    grossPerDay += grossAnnual / 365;
    whtPerDay += taxExempt ? 0 : (grossAnnual * (GOV_WHT_PCT / 100)) / 365;
  }
  return buildStraightLineSchedule(grossPerDay, whtPerDay, base, n);
}

/**
 * Bank-instrument day-by-day accrual. Simple daily interest on the (constant)
 * principal — no intra-period compounding for fixed/call/savings deposits in
 * this tracker. WHT is each holding's own rate (usually 15%).
 */
export function buildBankDailySchedule(
  holdings: BankIncomeInput[],
  days: number,
  now: number = Date.now(),
): DailyAccrualSchedule {
  const n = Math.max(1, Math.floor(days));
  let grossPerDay = 0;
  let whtPerDay = 0;
  let base = 0;
  for (const h of holdings) {
    if (!isLiveBank(h, now)) continue;
    const principal = Math.max(0, h.principal);
    const ratePct = Math.max(0, h.interestRate);
    const dayCount = h.dayCountBasis && h.dayCountBasis > 0 ? h.dayCountBasis : 365;
    const grossAnnual = principal * (ratePct / 100) * (365 / dayCount);
    const whtPct = Math.max(0, h.whtRate ?? GOV_WHT_PCT);
    base += principal;
    grossPerDay += grossAnnual / 365;
    whtPerDay += (grossAnnual * (whtPct / 100)) / 365;
  }
  return buildStraightLineSchedule(grossPerDay, whtPerDay, base, n);
}

/** Shared straight-line builder: identical gross/wht slice every day. */
function buildStraightLineSchedule(
  grossPerDay: number,
  whtPerDay: number,
  base: number,
  days: number,
): DailyAccrualSchedule {
  const rows: DailyAccrualRow[] = [];
  const netPerDay = grossPerDay - whtPerDay;
  let cumulativeNet = 0;
  for (let d = 1; d <= days; d++) {
    const openingAccrued = cumulativeNet;
    cumulativeNet += netPerDay;
    rows.push({
      day: d,
      openingAccrued,
      grossDay: grossPerDay,
      whtDay: whtPerDay,
      netDay: netPerDay,
      closingAccrued: cumulativeNet,
    });
  }
  return {
    rows,
    grossTotal: grossPerDay * days,
    whtTotal: whtPerDay * days,
    netTotal: netPerDay * days,
    base,
  };
}
