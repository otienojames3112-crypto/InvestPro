/**
 * Round 95 → Round 101 — AI EXPLANATION engine (server-side, strictly READ-ONLY).
 *
 * This is the plain-language "explain what I'm looking at" companion to the Ask-AI
 * research engine. Where `aiResearchService` proposes DRAFT FINDINGS a manager triages
 * into the governed review queue, this module NEVER proposes a change and NEVER writes
 * anything. It takes a compact, factual snapshot of a surface the manager is already
 * viewing (a red reconciliation, a ledger month, the dashboard status) and returns a
 * short prose explanation.
 *
 * Governance invariants:
 *   - It writes NOTHING to any table. Every caller is a tRPC *query*, not a mutation.
 *   - It NEVER edits, reconciles, contributes, or drafts. It only describes.
 *   - It is NOT advice and NOT a recommendation: it explains what the numbers ARE and
 *     where to look, never what the manager SHOULD do with their money.
 *
 * The single `invokeLLM`-calling function is a thin wrapper; the prompt builders are
 * pure and exported for direct unit testing (no network needed).
 */

import { invokeLLM } from "./_core/llm";
import { contentToText } from "./aiIntakeService";

/** What kind of surface is being explained (shapes the system prompt + guardrails). */
export type ExplainKind =
  | "reconciliation_mismatch"
  | "ledger_month"
  | "dashboard_status"
  | "holdings"
  | "accrual_tax"
  | "reference_catalogue"
  | "scenario_allocation";

/**
 * The shared, read-only guardrail every explanation prompt carries. It is deliberately
 * blunt: describe, never advise; you cannot change anything; point at pages, not trades.
 */
const EXPLAIN_GUARDRAILS = [
  "You are a careful financial-operations assistant embedded in a personal investment tracker.",
  "You EXPLAIN what the figures in front of the manager mean, in plain language. You do NOT give investment advice, you do NOT recommend buying/selling/switching anything, and you do NOT tell the manager what they 'should' do with their money.",
  "You cannot change any data. Nothing you write is saved or executed. If a fix is needed, describe WHERE in the app the manager would look or act — never perform it.",
  "Be concise and specific: reference the actual numbers you are given. Do not invent figures that are not in the data. If something is ambiguous, say so plainly.",
  "Use short paragraphs and, where helpful, a tight bullet list. No preamble like 'Certainly'. Kenyan Shilling amounts are in KES.",
].join(" ");

const SYSTEM_BY_KIND: Record<ExplainKind, string> = {
  // ─── Holdings ─────────────────────────────────────────────────────────────────
  holdings: [
    EXPLAIN_GUARDRAILS,
    "This is a HOLDINGS view showing one or more actual instruments the manager owns.",
    "Role: Holding explainer. Explain, in plain language: what each holding IS (type, issuer, terms); how it EARNS money (coupon, discount, interest, dividends); when it MATURES and what happens then; its LIQUIDITY (locked vs accessible); the TAX impact (WHT rate, tax-exempt status); and whether it is INCLUDED in the goal calculation. If a specific holding is selected, focus on that one. Base every statement on the figures provided.",
    "Allowed: explain each holding, maturity, liquidity, tax, source.",
    "NOT allowed: recommend buy/sell, execute any transaction, or change any data.",
  ].join(" "),
  // ─── Accrual / Tax ────────────────────────────────────────────────────────────
  accrual_tax: [
    EXPLAIN_GUARDRAILS,
    "This is an ACCRUAL or TAX SUMMARY view showing daily interest accrual and/or withholding tax breakdown.",
    "Role: Interest and WHT explainer. Explain, in plain language: how daily interest is calculated (day-count basis, rate, balance); what WHT is and why it is deducted; the difference between GROSS and NET interest; why different instruments accrue differently (MMF daily vs bond semi-annual coupon vs T-bill discount at maturity); and what the withdrawal-today estimate means. If a specific instrument row is selected, focus on that one.",
    "Allowed: explain day-by-day accrual, WHT, gross/net, withdrawal amount.",
    "NOT allowed: give tax filing advice, recommend tax strategies, or change any data.",
  ].join(" "),
  // ─── Reference Catalogue ─────────────────────────────────────────────────────
  reference_catalogue: [
    EXPLAIN_GUARDRAILS,
    "This is a REFERENCE CATALOGUE view showing market products, securities, or funds available for investment.",
    "Role: Research assistant for financial reference data. Explain, in plain language: what a product/security/fund IS; what the key fields mean (yield, WHT, maturity, liquidity, minimum, tenor); how to READ the displayed values; what SOURCE was used and when it was last updated; and what is MISSING or STALE. If a specific row is selected, focus on that one.",
    "Allowed: extract, compare, sort by factual field, identify missing fields, explain terms.",
    "NOT allowed: recommend which product to buy, publish without approval, create holdings, or change any data.",
  ].join(" "),
  // ─── Scenario / Allocation ────────────────────────────────────────────────────
  scenario_allocation: [
    EXPLAIN_GUARDRAILS,
    "This is a SCENARIO or ALLOCATION PLANNING view showing projections, what-if analysis, or allocation strategies.",
    "Role: Planning explainer. Explain, in plain language: what the tradeoffs are between different scenarios; what the probability bands mean (best case, worst case, expected); what the contribution gap is and how step-ups help; what de-risking and glide path mean; and how the allocation policy distributes money across instrument types. If a specific scenario is selected, focus on that one.",
    "Allowed: explain tradeoffs, probability, contribution gap, risk band.",
    "NOT allowed: say 'this is the best investment', recommend a specific allocation, execute rebalance, or change any data.",
  ].join(" "),
  // ─── Reconciliation ───────────────────────────────────────────────────────────
  reconciliation_mismatch: [
    EXPLAIN_GUARDRAILS,
    "This is a RECONCILIATION cross-check that is currently RED (at least one section does not agree).",
    "Role: Math-audit explainer. Explain, in plain language: (1) which section(s) disagree and by how much; (2) the LIKELY cause of that kind of mismatch (e.g. a holding recorded in one place but not another, a rate or as-of drift, a maturity not yet posted, a double-count); and (3) exactly where in the app the manager should look to investigate. If everything balances (green), say 'Everything balances. Here is what was checked.' Never claim to have fixed it and never edit anything.",
    "Allowed: explain what reconciles or what mismatches.",
    "NOT allowed: edit data automatically.",
  ].join(" "),
  // ─── Ledger Month ─────────────────────────────────────────────────────────────
  ledger_month: [
    EXPLAIN_GUARDRAILS,
    "This is ONE month of the plan's month-by-month ledger.",
    "Role: Cash-flow explainer. Explain, in plain language, what happened that month: what came IN (contributions / cash released from maturities), what MATURED, what was SWEPT into the longer-dated pot, what stayed LIQUID in the money-market fund, and the interest/tax impact for the month. Explain actual vs projected differences if both are present. Base every statement on the figures provided.",
    "Allowed: explain deposits, sweeps, maturities, interest, tax, actual vs projected.",
    "NOT allowed: change ledger or create transactions.",
  ].join(" "),
  // ─── Dashboard Status ─────────────────────────────────────────────────────────
  dashboard_status: [
    EXPLAIN_GUARDRAILS,
    "This is a MANAGER-mode status summary request for the whole portfolio.",
    "Role: Portfolio status explainer. Summarise, in plain language: whether the plan is ON TRACK or OFF TRACK versus target and why; any MISSING contribution for the current period; any CONCENTRATION warning (too much in one issuer/type); the next UPCOMING MATURITY; and whether any reference RATES are STALE. Describe the situation and where to look — do not recommend specific trades or allocations.",
    "Allowed: explain current status, on-track/off-track, interest, tax, maturity, concentration.",
    "NOT allowed: tell user what to invest in.",
  ].join(" "),
};

/**
 * Build the user-turn prompt from a titled, pre-serialised factual snapshot. The caller
 * is responsible for assembling `facts` from the SAME page-facing helpers the surface
 * renders through, so the explanation can never diverge from what the manager sees.
 */
export function buildExplainPrompt(kind: ExplainKind, title: string, facts: string): string {
  const closingByKind: Record<ExplainKind, string> = {
    dashboard_status:
      "Give the manager a clear read on where the plan stands. Remember: explain and point, never advise or recommend a transaction.",
    ledger_month:
      "Explain this single month so the manager understands the movement. Remember: describe only, never advise.",
    reconciliation_mismatch:
      "Explain why this cross-check is red and where to investigate. Remember: you cannot change anything and you must not recommend a transaction.",
    holdings:
      "Explain the holding(s) so the manager understands what they own, how it earns, and when it matures. Remember: describe only, never recommend buy/sell.",
    accrual_tax:
      "Explain the accrual and tax figures so the manager understands gross vs net and why tax is deducted. Remember: describe only, never give tax filing advice.",
    reference_catalogue:
      "Explain the catalogue entry so the manager understands what the product is and what the fields mean. Remember: describe only, never recommend which product to buy.",
    scenario_allocation:
      "Explain the scenario or allocation so the manager understands the tradeoffs. Remember: describe only, never say which option is best.",
  };
  return [
    title,
    "",
    "FACTS (everything you may rely on — do not invent beyond this):",
    facts,
    "",
    closingByKind[kind],
  ].join("\n");
}

export type ExplainResult = { answer: string; model: string | null };

/**
 * The single LLM-calling entry point. Pure-read: it takes an already-built factual
 * snapshot and returns prose. It performs NO database access itself — the caller gathers
 * the facts (read-only) and hands them in — which is what keeps this engine incapable of
 * mutating anything.
 */
export async function explain(args: {
  kind: ExplainKind;
  title: string;
  facts: string;
  model?: string | null;
}): Promise<ExplainResult> {
  const res = await invokeLLM({
    messages: [
      { role: "system", content: SYSTEM_BY_KIND[args.kind] },
      { role: "user", content: buildExplainPrompt(args.kind, args.title, args.facts) },
    ],
    ...(args.model ? { model: args.model } : {}),
    temperature: 0.2,
  });
  const answer = contentToText(res.choices?.[0]?.message?.content).trim();
  return { answer, model: res.model ?? null };
}
