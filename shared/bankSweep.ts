/**
 * Safe bank-instrument sweep allocation (Audit item #6).
 *
 * When investable cash builds up in the MMF, the plan sweeps it into higher-
 * yielding instruments. Government securities (T-bills, FXD, IFB) are the default
 * destination because they carry sovereign credit risk (effectively risk-free in
 * KES terms). A bank fixed/call deposit can out-yield them, but it also carries
 * BANK credit risk and (above the KDIC-insured limit) is not protected. So the
 * sweep must NOT chase the highest headline rate blindly.
 *
 * This module is the single, pure, framework-free source of truth for that
 * decision. It:
 *
 *   1. ELIGIBILITY — filters out bank instruments that cannot legitimately absorb
 *      a sweep this month (inactive, matured, below their own minimum, or a type
 *      that is not a term/call deposit).
 *   2. RISK-ADJUSTED SCORING — scores every candidate on NET-OF-TAX yield minus a
 *      credit-risk penalty. Government paper has a zero penalty; a bank instrument
 *      is penalised by a per-issuer risk premium AND by the share of its balance
 *      that would sit ABOVE the KDIC-insured cap (uninsured money is penalised
 *      harder).
 *   3. GOVERNMENT-PREFERENCE THRESHOLD — a bank instrument is only preferred over
 *      the best government option when its risk-adjusted net yield beats the best
 *      government option by at least `govPreferenceMarginPct`. Ties and near-ties
 *      always go to government paper.
 *   4. LEDGER EXPLANATIONS — every decision returns a plain-English sentence the
 *      Month Ledger can render verbatim, including the phrase "Swept → Securities"
 *      when the sweep goes to government paper.
 *
 * All money figures are KES; all rates are percentages (e.g. 15 = 15%).
 */

export type BankSweepInstrumentType =
  | "call_deposit"
  | "fixed_deposit"
  | "ordinary_savings"
  | "target_savings"
  | "tiered_savings";

/** KDIC deposit-insurance cap per depositor per bank (KES). */
export const KDIC_INSURED_CAP_KES = 500_000;

/** Default extra net-yield (percentage points) a bank must beat gov by to win. */
export const DEFAULT_GOV_PREFERENCE_MARGIN_PCT = 1.0;

/** Default per-issuer credit-risk penalty (percentage points) for a bank deposit. */
export const DEFAULT_BANK_RISK_PENALTY_PCT = 0.75;

/** Extra penalty (percentage points) applied to the UNINSURED share of a deposit. */
export const UNINSURED_RISK_PENALTY_PCT = 1.5;

/** Default per-issuer concentration cap as a share of the portfolio (0..1). */
export const DEFAULT_ISSUER_CONCENTRATION_CAP = 0.2;

/** Penalty (percentage points) applied to the OVER-CAP concentration share. */
export const CONCENTRATION_PENALTY_PCT = 2.0;

/** A government option the sweep can choose (already net-of-tax scored upstream). */
export interface GovSweepOption {
  bucket: "tbill" | "ifb" | "fxd";
  label: string;
  /** Net-of-tax yield (%). */
  netPct: number;
}

/** A bank instrument the sweep could place cash into. */
export interface BankSweepCandidate {
  id: number;
  bankName: string;
  label?: string | null;
  instrumentType: BankSweepInstrumentType;
  /** Current principal already in this instrument (KES). */
  principal: number;
  /** Gross interest rate (% p.a.). */
  interestRate: number;
  /** Withholding tax rate on interest (%). Defaults to 15. */
  whtRate?: number | null;
  /** Minimum balance/top-up this instrument accepts (KES). */
  minimumBalance?: number | null;
  /** Whether the instrument is currently active. */
  isActive?: boolean;
  /** Whether the instrument has matured (term deposits). */
  isMatured?: boolean;
  /** Per-issuer risk penalty override (percentage points). */
  riskPenaltyPct?: number | null;
  /**
   * Months until this term deposit matures. When the goal has a fixed horizon,
   * a term instrument maturing AFTER the goal cannot be relied on for the plan,
   * so it is ruled ineligible (the cash stays liquid in the MMF instead).
   */
  monthsToMaturity?: number | null;
}

export interface BankSweepConfig {
  /** Extra net yield a bank must beat the best gov option by to be chosen. */
  govPreferenceMarginPct?: number;
  /** Base per-issuer risk penalty when a candidate does not override it. */
  bankRiskPenaltyPct?: number;
  /** KDIC insured cap (override for tests / rule changes). */
  insuredCapKes?: number;
  /** Goal horizon in months; term deposits maturing later are ineligible. */
  goalHorizonMonths?: number | null;
  /** Total portfolio value (KES), used to size the concentration penalty. */
  portfolioValueKes?: number | null;
  /** Per-issuer concentration cap as a share of the portfolio (0..1). */
  issuerConcentrationCap?: number;
}

export interface BankEligibility {
  id: number;
  eligible: boolean;
  /** Why it was excluded (empty when eligible). */
  reason: string;
}

export interface ScoredBankCandidate {
  id: number;
  bankName: string;
  label: string | null;
  instrumentType: BankSweepInstrumentType;
  /** Net-of-tax headline yield (%). */
  netPct: number;
  /** Credit-risk penalty applied (percentage points). */
  riskPenaltyPct: number;
  /** Net yield AFTER the risk penalty (%). This is what the sweep compares. */
  riskAdjustedNetPct: number;
  /** Share of the target balance that would be uninsured (0..1). */
  uninsuredFraction: number;
  /** Share of the portfolio this issuer would hold after the sweep (0..1). */
  concentrationFraction: number;
}

export type SweepDestinationKind = "government" | "bank" | "none";

export interface BankSweepDecision {
  destination: SweepDestinationKind;
  /** The winning bank candidate id (only when destination === "bank"). */
  bankId: number | null;
  /** The winning government bucket (only when destination === "government"). */
  govBucket: GovSweepOption["bucket"] | null;
  /** The best government option considered (for transparency). */
  bestGov: GovSweepOption | null;
  /** The best (already risk-adjusted) bank candidate considered. */
  bestBank: ScoredBankCandidate | null;
  /** Eligibility verdicts for every bank candidate. */
  eligibility: BankEligibility[];
  /** Every scored (eligible) bank candidate, best first. */
  scored: ScoredBankCandidate[];
  /** Plain-English sentence the Month Ledger renders verbatim. */
  ledgerExplanation: string;
}

const TERM_TYPES: BankSweepInstrumentType[] = ["call_deposit", "fixed_deposit"];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Net-of-tax yield for a gross rate and WHT (%). */
export function netOfTax(grossPct: number, whtPct: number): number {
  const wht = Math.min(100, Math.max(0, whtPct));
  return Math.max(0, grossPct) * (1 - wht / 100);
}

/**
 * Eligibility gate: a bank instrument can only absorb a sweep when it is a
 * term/call deposit, active, not matured, and the placement would clear its own
 * minimum. Savings-style products are excluded — the sweep targets locked/termed
 * money, not an ordinary savings sweep-back.
 */
export function bankSweepEligibility(
  c: BankSweepCandidate,
  placementKes: number,
  goalHorizonMonths?: number | null,
): BankEligibility {
  if (c.isActive === false) return { id: c.id, eligible: false, reason: "Instrument is inactive" };
  if (c.isMatured === true) return { id: c.id, eligible: false, reason: "Instrument has matured" };
  if (!TERM_TYPES.includes(c.instrumentType))
    return { id: c.id, eligible: false, reason: "Only fixed/call deposits accept a sweep" };
  if (!(c.interestRate > 0)) return { id: c.id, eligible: false, reason: "No positive interest rate" };
  const min = Math.max(0, c.minimumBalance ?? 0);
  if (placementKes + Math.max(0, c.principal) < min)
    return { id: c.id, eligible: false, reason: `Below instrument minimum (${min.toLocaleString()})` };
  // A term deposit that matures AFTER the goal horizon cannot be relied on for
  // the plan (call deposits are liquid, so they are exempt from this gate).
  if (
    typeof goalHorizonMonths === "number" &&
    goalHorizonMonths > 0 &&
    c.instrumentType === "fixed_deposit" &&
    typeof c.monthsToMaturity === "number" &&
    c.monthsToMaturity > goalHorizonMonths
  ) {
    return { id: c.id, eligible: false, reason: `Matures after the goal (${c.monthsToMaturity}mo > ${goalHorizonMonths}mo)` };
  }
  return { id: c.id, eligible: true, reason: "" };
}

/**
 * Score one eligible bank candidate on RISK-ADJUSTED net-of-tax yield.
 * Penalty = base/issuer risk premium + an extra premium on the UNINSURED share
 * of the resulting balance (money above the KDIC cap).
 */
export function scoreBankCandidate(
  c: BankSweepCandidate,
  placementKes: number,
  cfg: Required<Pick<BankSweepConfig, "bankRiskPenaltyPct" | "insuredCapKes">> & {
    portfolioValueKes?: number | null;
    issuerConcentrationCap?: number;
  },
): ScoredBankCandidate {
  const netPct = netOfTax(c.interestRate, c.whtRate ?? 15);
  const resultingBalance = Math.max(0, c.principal) + Math.max(0, placementKes);
  const insured = Math.min(resultingBalance, cfg.insuredCapKes);
  const uninsured = Math.max(0, resultingBalance - insured);
  const uninsuredFraction = resultingBalance > 0 ? uninsured / resultingBalance : 0;

  // Concentration: how big this issuer becomes as a share of the portfolio.
  const pv = typeof cfg.portfolioValueKes === "number" && cfg.portfolioValueKes > 0
    ? cfg.portfolioValueKes + Math.max(0, placementKes)
    : 0;
  const concentrationFraction = pv > 0 ? Math.min(1, resultingBalance / pv) : 0;
  const cap = cfg.issuerConcentrationCap ?? DEFAULT_ISSUER_CONCENTRATION_CAP;
  const overCap = Math.max(0, concentrationFraction - cap);

  const basePenalty = c.riskPenaltyPct ?? cfg.bankRiskPenaltyPct;
  const riskPenaltyPct = round2(
    basePenalty +
      UNINSURED_RISK_PENALTY_PCT * uninsuredFraction +
      CONCENTRATION_PENALTY_PCT * (cap > 0 ? overCap / cap : overCap),
  );
  return {
    id: c.id,
    bankName: c.bankName,
    label: c.label ?? null,
    instrumentType: c.instrumentType,
    netPct: round2(netPct),
    riskPenaltyPct,
    riskAdjustedNetPct: round2(netPct - riskPenaltyPct),
    uninsuredFraction: round2(uninsuredFraction),
    concentrationFraction: round2(concentrationFraction),
  };
}

/**
 * Decide where a lump of investable cash should sweep. Government paper is the
 * default; a bank instrument only wins when its RISK-ADJUSTED net yield beats the
 * best government option by at least the government-preference margin.
 */
export function decideBankSweep(
  placementKes: number,
  govOptions: GovSweepOption[],
  bankCandidates: BankSweepCandidate[],
  config: BankSweepConfig = {},
): BankSweepDecision {
  const cfg = {
    govPreferenceMarginPct: config.govPreferenceMarginPct ?? DEFAULT_GOV_PREFERENCE_MARGIN_PCT,
    bankRiskPenaltyPct: config.bankRiskPenaltyPct ?? DEFAULT_BANK_RISK_PENALTY_PCT,
    insuredCapKes: config.insuredCapKes ?? KDIC_INSURED_CAP_KES,
    portfolioValueKes: config.portfolioValueKes ?? null,
    issuerConcentrationCap: config.issuerConcentrationCap ?? DEFAULT_ISSUER_CONCENTRATION_CAP,
  };

  const bestGov =
    govOptions.length > 0
      ? [...govOptions].sort((a, b) => b.netPct - a.netPct)[0]
      : null;

  const eligibility = bankCandidates.map((c) =>
    bankSweepEligibility(c, placementKes, config.goalHorizonMonths),
  );
  const eligibleIds = new Set(eligibility.filter((e) => e.eligible).map((e) => e.id));
  const scored = bankCandidates
    .filter((c) => eligibleIds.has(c.id))
    .map((c) => scoreBankCandidate(c, placementKes, cfg))
    .sort((a, b) => b.riskAdjustedNetPct - a.riskAdjustedNetPct);
  const bestBank = scored.length > 0 ? scored[0] : null;

  // Nothing to invest, or no destination at all.
  if (placementKes <= 0 || (!bestGov && !bestBank)) {
    return {
      destination: "none",
      bankId: null,
      govBucket: null,
      bestGov,
      bestBank,
      eligibility,
      scored,
      ledgerExplanation:
        placementKes <= 0
          ? "No investable surplus this month; balance kept in the MMF."
          : "No eligible sweep destination this month; balance kept in the MMF.",
    };
  }

  const govNet = bestGov ? bestGov.netPct : -Infinity;
  const bankAdj = bestBank ? bestBank.riskAdjustedNetPct : -Infinity;
  const beatsGov = bestBank != null && bankAdj >= govNet + cfg.govPreferenceMarginPct;

  if (beatsGov && bestBank) {
    const name = bestBank.label ? `${bestBank.bankName} (${bestBank.label})` : bestBank.bankName;
    const govClause = bestGov
      ? ` It clears the ${cfg.govPreferenceMarginPct}pp government-preference margin over ${bestGov.label} (${bestGov.netPct}% net).`
      : "";
    const uninsuredClause =
      bestBank.uninsuredFraction > 0
        ? ` Note: ${Math.round(bestBank.uninsuredFraction * 100)}% of the resulting balance is above the KDIC-insured cap.`
        : "";
    return {
      destination: "bank",
      bankId: bestBank.id,
      govBucket: null,
      bestGov,
      bestBank,
      eligibility,
      scored,
      ledgerExplanation:
        `Swept ${placementKes.toLocaleString()} → ${name} fixed deposit ` +
        `(${bestBank.netPct}% net, ${bestBank.riskAdjustedNetPct}% risk-adjusted).${govClause}${uninsuredClause}`,
    };
  }

  // Default: government paper.
  const govLabel = bestGov ? bestGov.label : "government securities";
  const bankClause =
    bestBank != null
      ? ` The best bank deposit (${bestBank.bankName}, ${bestBank.riskAdjustedNetPct}% risk-adjusted) did not clear the ${cfg.govPreferenceMarginPct}pp margin over government paper.`
      : "";
  return {
    destination: "government",
    bankId: null,
    govBucket: bestGov ? bestGov.bucket : null,
    bestGov,
    bestBank,
    eligibility,
    scored,
    ledgerExplanation:
      `Swept → Securities: ${placementKes.toLocaleString()} into ${govLabel}` +
      `${bestGov ? ` (${bestGov.netPct}% net)` : ""}.${bankClause}`,
  };
}
