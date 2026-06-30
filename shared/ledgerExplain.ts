/**
 * Phase 8b — plain-language ledger row explanation.
 *
 * The engine already produces a one-line `mainAction` narration per month (see
 * `server/engine.ts`: sweep wording, maturities, coupons, contribution-vs-plan,
 * past/future tense). That line is deliberately terse so it fits one table cell.
 *
 * This module turns the SAME row — using only fields the engine already emits —
 * into a slightly fuller, structured "what happened this month" explanation for a
 * click-to-expand panel, WITHOUT re-deriving any money math and WITHOUT inventing
 * any new numbers. It is framework-free and pure so the client renders it and a
 * Vitest can pin it. It reuses, never contradicts, the existing `mainAction` text.
 *
 * Strict rules:
 *   - Every KES figure shown comes verbatim from a row field (rounded for display
 *     only). We never compute a flow the engine didn't already give us.
 *   - Tense follows the row: settled (isActual) months read in the past tense to
 *     match `pastTensifyMainAction`; projected months read as "this month / will".
 *   - Non-advisory: it explains what happened, never what the user should do.
 */

/** The minimal row shape this explainer reads — a structural subset of MonthResult. */
export interface LedgerExplainRow {
  monthNumber: number;
  mainAction: string;
  contribution: number;
  /** Cash returned to the MMF from CBK securities (maturities / coupons), net of tax. */
  cbkCashIn: number;
  /** Cash returned to the MMF from a maturing bank term deposit. */
  bankCashIn: number;
  /** Cash that left the MMF to buy new CBK securities (the price actually paid). */
  mmfToDhow: number;
  /** Net MMF interest earned this month (already in mmfEnd). */
  mmfInterestNet: number;
  /** Money-market balance at month-end. */
  mmfEnd: number;
  /** Whole-portfolio value at month-end. */
  totalEnd: number;
  /** Settled (built from recorded actuals) vs projected. */
  isActual: boolean;
  /** Settled month that diverged from plan (skipped/short/over/unfunded sweep). */
  offPlan: boolean;
  phase: "foundation" | "growth" | "de-risking" | "final-liquidity";
}

/** One labelled leg of the month's cash story. `sign` drives the +/− display. */
export interface ExplainLine {
  /** Stable key for React lists / tests. */
  key: string;
  label: string;
  /** KES amount for this leg (always ≥ 0; `sign` carries direction). */
  amount: number;
  sign: "in" | "out" | "neutral";
  /** Plain-language sentence for this leg, tense-matched to the row. */
  detail: string;
}

export interface LedgerExplanation {
  monthNumber: number;
  /** A single-sentence headline mirroring the engine's mainAction (verbatim). */
  headline: string;
  /** Tense-matched lead-in, e.g. "This month" / "In month 7 (settled)". */
  lede: string;
  /** Itemised cash legs, in a stable reading order. */
  lines: ExplainLine[];
  /** Closing sentence stating the resulting balances (from row fields only). */
  closing: string;
  /** True when this settled month diverged from plan (mirrors row.offPlan). */
  offPlan: boolean;
}

const kes = (n: number) => `KES ${Math.round(Math.max(0, n)).toLocaleString("en-KE")}`;

const PHASE_PLAIN: Record<LedgerExplainRow["phase"], string> = {
  foundation: "building the cash cushion",
  growth: "investing surplus for yield",
  "de-risking": "winding down new long purchases",
  "final-liquidity": "letting everything mature to cash",
};

/** Small tolerance below which a flow is treated as zero (matches engine rounding). */
const EPS = 0.5;

/**
 * Decompose a ledger row into a structured, plain-language explanation.
 *
 * Pure and deterministic: identical input always yields identical output. The
 * `headline` is the engine's own `mainAction` so the panel can never drift from
 * the table cell it expands.
 */
export function explainLedgerRow(row: LedgerExplainRow): LedgerExplanation {
  const past = row.isActual;
  const lines: ExplainLine[] = [];

  // 1. New saving added (the contribution leg).
  if (row.contribution > EPS) {
    lines.push({
      key: "save",
      label: "New saving",
      amount: row.contribution,
      sign: "in",
      detail: past
        ? `You added ${kes(row.contribution)} of new saving, which landed in your MMF.`
        : `${kes(row.contribution)} of new saving is added and lands in your MMF first.`,
    });
  }

  // 2. Cash returning from CBK securities (maturities / coupons).
  if (row.cbkCashIn > EPS) {
    lines.push({
      key: "cbk_in",
      label: "From CBK securities",
      amount: row.cbkCashIn,
      sign: "in",
      detail: past
        ? `${kes(row.cbkCashIn)} came back into the MMF from Treasury securities (a maturity or coupon), net of any tax.`
        : `${kes(row.cbkCashIn)} returns to the MMF from Treasury securities (a maturity or coupon), net of any tax.`,
    });
  }

  // 3. Cash returning from a maturing bank term deposit.
  if (row.bankCashIn > EPS) {
    lines.push({
      key: "bank_in",
      label: "From a bank deposit",
      amount: row.bankCashIn,
      sign: "in",
      detail: past
        ? `${kes(row.bankCashIn)} returned to the MMF from a maturing bank deposit.`
        : `${kes(row.bankCashIn)} returns to the MMF from a maturing bank deposit.`,
    });
  }

  // 4. Cash swept out of the MMF into new securities (the price paid).
  if (row.mmfToDhow > EPS) {
    lines.push({
      key: "swept_out",
      label: "Swept into securities",
      amount: row.mmfToDhow,
      sign: "out",
      detail: past
        ? `${kes(row.mmfToDhow)} left the MMF to buy new Treasury securities (the price paid, not the face value received at maturity).`
        : `${kes(row.mmfToDhow)} leaves the MMF to buy new Treasury securities (the price paid, not the face value received at maturity).`,
    });
  }

  // 5. MMF interest earned (already inside the end balance; shown for completeness).
  if (row.mmfInterestNet > EPS) {
    lines.push({
      key: "mmf_interest",
      label: "MMF interest",
      amount: row.mmfInterestNet,
      sign: "neutral",
      detail: past
        ? `Your MMF earned ${kes(row.mmfInterestNet)} of interest this month, after 15% withholding tax (already inside the end balance).`
        : `Your MMF earns about ${kes(row.mmfInterestNet)} of interest this month, after 15% withholding tax (already inside the end balance).`,
    });
  }

  if (lines.length === 0) {
    lines.push({
      key: "quiet",
      label: "Quiet month",
      amount: 0,
      sign: "neutral",
      detail: past
        ? "No new saving or maturity was recorded; the balance simply stayed in the MMF."
        : "No saving or maturity falls in this month; the balance simply stays in the MMF.",
    });
  }

  const lede = past
    ? `In month ${row.monthNumber} (settled — built from what you actually recorded)`
    : `In month ${row.monthNumber} (projected)`;

  const closing = past
    ? `By month-end your MMF stood at ${kes(row.mmfEnd)} and your whole portfolio at ${kes(row.totalEnd)}. The plan was ${PHASE_PLAIN[row.phase]} this month.`
    : `By month-end your MMF is projected at ${kes(row.mmfEnd)} and your whole portfolio at ${kes(row.totalEnd)}. The plan is ${PHASE_PLAIN[row.phase]} this month.`;

  return {
    monthNumber: row.monthNumber,
    headline: row.mainAction,
    lede,
    lines,
    closing,
    offPlan: row.offPlan,
  };
}
