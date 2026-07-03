/**
 * Round 95 — AI EXPLANATION engine (server-side, strictly READ-ONLY).
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
export type ExplainKind = "reconciliation_mismatch" | "ledger_month" | "dashboard_status";

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
  reconciliation_mismatch: [
    EXPLAIN_GUARDRAILS,
    "This is a RECONCILIATION cross-check that is currently RED (at least one section does not agree).",
    "Explain, in plain language: (1) which section(s) disagree and by how much; (2) the LIKELY cause of that kind of mismatch (e.g. a holding recorded in one place but not another, a rate or as-of drift, a maturity not yet posted, a double-count); and (3) exactly where in the app the manager should look to investigate. Never claim to have fixed it and never edit anything.",
  ].join(" "),
  ledger_month: [
    EXPLAIN_GUARDRAILS,
    "This is ONE month of the plan's month-by-month ledger.",
    "Explain, in plain language, what happened that month: what came IN (contributions / cash released from maturities), what MATURED, what was SWEPT into the longer-dated pot, what stayed LIQUID in the money-market fund, and the interest/tax impact for the month. Base every statement on the figures provided.",
  ].join(" "),
  dashboard_status: [
    EXPLAIN_GUARDRAILS,
    "This is a MANAGER-mode status summary request for the whole portfolio.",
    "Summarise, in plain language: whether the plan is ON TRACK or OFF TRACK versus target and why; any MISSING contribution for the current period; any CONCENTRATION warning (too much in one issuer/type); the next UPCOMING MATURITY; and whether any reference RATES are STALE. Describe the situation and where to look — do not recommend specific trades or allocations.",
  ].join(" "),
};

/**
 * Build the user-turn prompt from a titled, pre-serialised factual snapshot. The caller
 * is responsible for assembling `facts` from the SAME page-facing helpers the surface
 * renders through, so the explanation can never diverge from what the manager sees.
 */
export function buildExplainPrompt(kind: ExplainKind, title: string, facts: string): string {
  const closing =
    kind === "dashboard_status"
      ? "Give the manager a clear read on where the plan stands. Remember: explain and point, never advise or recommend a transaction."
      : kind === "ledger_month"
        ? "Explain this single month so the manager understands the movement. Remember: describe only, never advise."
        : "Explain why this cross-check is red and where to investigate. Remember: you cannot change anything and you must not recommend a transaction.";
  return [
    title,
    "",
    "FACTS (everything you may rely on — do not invent beyond this):",
    facts,
    "",
    closing,
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
