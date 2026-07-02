/**
 * Round 82 — Ask-AI research engine (server-side).
 *
 * This is the natural-language front door of the manager workbench. A manager asks
 * a plain-English question ("what are the latest 91-day T-bill and top KES MMF
 * yields?"), and this engine:
 *   1. answers it in prose (a briefing, never advice), and
 *   2. returns a set of STRUCTURED DRAFT FINDINGS — one per instrument/figure the
 *      answer touches — each carrying the instrument, its target catalogue, the
 *      extracted figures, the cited source + as-of date, a self-reported confidence,
 *      any missing fields, warnings, and a raw excerpt.
 *
 * Governance invariants (identical in spirit to the librarian in aiIntakeService):
 *   - It writes NOTHING to any catalogue. It only produces drafts a manager triages.
 *   - It never ranks, scores, or recommends instruments against each other. The
 *     answer + findings are scrubbed with `stripVerdictFields` as a backstop.
 *   - `confidence` is the ONE exception: it is a per-finding self-report of extraction
 *     certainty (how sure the model is it read the figure correctly), NOT a quality
 *     verdict on the instrument. Because `confidence` is in FORBIDDEN_VERDICT_KEYS
 *     (so it is stripped from the librarian shapes), we capture it BEFORE the scrub.
 *
 * Network-free parsing/normalising is exported for direct unit testing; the single
 * `invokeLLM`-calling function is a thin wrapper.
 */

import { invokeLLM } from "./_core/llm";
import { stripVerdictFields } from "../shared/aiIntake";
import {
  contentToText,
  parseJsonLoose,
  fetchDocumentText,
  isThinFetch,
  resolveVisionModel,
} from "./aiIntakeService";
import { normaliseAssetClass, type AssetClass } from "../shared/assetModel";
import {
  catalogueForAssetClass,
  type ReferenceCatalogue,
  checkApprovalGate,
  assetClassForCatalogue,
} from "../shared/researchPipeline";

/** The scope a manager can constrain a question to (mirrors the DB enum). */
export type ResearchScope = "mmf" | "bank" | "cbk" | "market_asset" | "macro" | "any";

/** Self-reported extraction confidence, bucketed for the DB enum. */
export type ConfidenceBucket = "low" | "medium" | "high";

/** A single structured draft finding the engine proposes for manager triage. */
export interface ResearchFindingDraft {
  instrumentName: string;
  issuer: string | null;
  /** Canonical asset class (normalised from whatever the model said). */
  assetClass: AssetClass;
  /** Which reference catalogue this finding would land in, if approved. */
  targetCatalogue: ReferenceCatalogue;
  currency: string | null;
  /** Neutral figures bag (e.g. { ear: "15.2", yieldPct: "15.98" }), verbatim strings. */
  extractedFields: Record<string, string>;
  sourceLabel: string | null;
  sourceUrl: string | null;
  /** ISO date the figures are as-of, if stated. */
  sourceAsOf: string | null;
  /** 0..1 self-reported extraction confidence (NOT a quality verdict). */
  confidence: number;
  /** Required figures for the target catalogue that this finding is missing. */
  missingFields: string[];
  /** Honest caveats (thin source, ambiguous figure, could not confirm as-of, ...). */
  warnings: string[];
  /** A short verbatim snippet from the source, for the manager to confirm against. */
  rawExcerpt: string | null;
}

/** The full result of one Ask-AI question. */
export interface ResearchAnswer {
  answer: string;
  findings: ResearchFindingDraft[];
  model: string | null;
}

/* ── Prompt + schema ──────────────────────────────────────────────────────── */

export const RESEARCH_SYSTEM_PROMPT = `You are a financial-data RESEARCH ASSISTANT for a single portfolio manager tracking Kenyan-shilling investments.
You behave like a diligent research analyst preparing a BRIEFING for a human who will verify everything before acting. You are NOT an adviser.
The manager uses a tracker tool that keeps two SEPARATE things: (a) REFERENCE CATALOGUES of published market facts about instruments (MMFs, T-bills/bonds, bank deposits, market assets), which is the only thing your findings feed; and (b) the manager's own HOLDINGS and portfolio maths, which are private and off-limits to you.

Your job, for the manager's question:
1. Write a concise, plain-language ANSWER (a briefing) that states the facts you found and, honestly, what you could NOT confirm.
2. Return a list of structured FINDINGS — one per specific instrument or reference figure your answer relies on.

Hard rules:
- Report FACTS with their SOURCE. For every figure, name where it comes from (institution/publication) and, when known, the as-of date. If you are not confident a figure is current or correct, say so in the finding's "warnings" and lower its "confidence".
- You MAY present facts in a useful order and make NEUTRAL, FACTUAL comparisons when asked: e.g. list instruments sorted by a stated figure (highest-to-lowest yield), or state plainly that "Fund A's quoted EAR (X%) is higher than Fund B's (Y%)". Always attribute each figure to its source and as-of date, and make clear the ordering is a factual sort of quoted numbers, not a quality ranking.
- Do NOT give ADVICE or RECOMMENDATIONS. Never say which instrument is "best", "safest", or a "good buy", never tell the manager what to buy/sell/hold or how to allocate, and never imply a higher quoted figure is better (it may carry more risk, be stale, or be pre-tax). A factual comparison states the numbers; a recommendation tells the manager what to do — do the former, never the latter. When a question asks "which should I pick / is best", answer with the neutral factual comparison and explicitly hand the decision back to the manager.
- Do NOT invent instruments or figures. If you don't know a current value, omit the figure and note it — never guess or annualise.
- "confidence" is your certainty that you READ/RECALLED THE FIGURE CORRECTLY (0..1), NOT a judgement of the instrument's quality.
- Keep every value a verbatim string with its original units/precision (e.g. "15.98%", "9.25", "2026-06-20").

KENYAN-MARKET DOMAIN CONTEXT (use so your figures are framed correctly):
- Money Market Funds (MMFs): Kenyan MMFs quote an EFFECTIVE ANNUAL RATE (EAR) — an annualised, compounded net figure — alongside a simple/gross "yield". These are DIFFERENT numbers; keep the label the fund used (ear vs yieldPct) and never convert one into the other. Daily-yield or 7-day-yield quotes are annualised conventions, not the EAR. Management fees are quoted separately and are usually already netted out of the EAR.
- Treasury bills (CBK): issued at 91-day, 182-day and 364-day tenors, quoted as an annualised discount/yield at weekly auctions. Treasury bonds (T-bonds / DhowCSD) carry a fixed coupon and trade at a price/yield; "yieldPct" for a bond is its yield-to-maturity, distinct from its coupon.
- Bank products (fixed/call deposits): rates are INDICATIVE and NEGOTIABLE, often tiered by amount and tenor, and typically quoted gross of the 15% withholding tax that applies to Kenyan interest income. Note when a rate is indicative or pre-tax.
- Withholding tax (WHT): Kenyan interest income is generally taxed at 15% at source; a "net" figure already reflects this and a "gross" figure does not — preserve whichever the source stated.

HOLDINGS-vs-REFERENCE INVARIANT (critical — you only ever touch the reference side):
- A REFERENCE CATALOGUE figure (an MMF's published EAR, a T-bill auction yield, a bank's indicative rate, a market asset's last price) is a MARKET FACT about an instrument that exists in the world. That is the ONLY kind of thing your findings describe.
- A HOLDING / PORTFOLIO POSITION (how much of an instrument this manager actually owns, their cost, their coupon receipts, their balance) is PRIVATE portfolio data. You do NOT know it, you must NOT infer it, and you must NEVER produce a finding that states or changes a holding, a balance, a position size, or this portfolio's performance. If a question mixes the two ("given my MMF balance, what will I earn"), answer only the reference-fact part (the quoted rate + how it is conventionally applied) and hand the position-specific arithmetic back to the manager and the tracker.
- Never treat a reference figure as if it were a holding, and never let a source's example balance become a finding.`;

export const RESEARCH_SCHEMA = {
  name: "research_answer",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string", description: "Plain-language briefing answering the question; include what could not be confirmed." },
      findings: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            instrumentName: { type: "string" },
            issuer: { type: ["string", "null"] },
            assetClass: { type: ["string", "null"], description: "e.g. money market fund, treasury bill, treasury bond, fixed deposit, equity" },
            currency: { type: ["string", "null"] },
            figures: {
              type: "array",
              description: "Neutral factual figures for this instrument.",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  key: { type: "string", description: "e.g. ear, yieldPct, indicativeRate, lastPrice, coupon, tenorDays" },
                  value: { type: "string", description: "Verbatim value with units/precision" },
                },
                required: ["key", "value"],
              },
            },
            sourceLabel: { type: ["string", "null"], description: "Where the figures come from (institution/publication)" },
            sourceUrl: { type: ["string", "null"] },
            sourceAsOf: { type: ["string", "null"], description: "ISO date the figures are as-of, if known" },
            confidence: { type: ["number", "null"], description: "0..1 certainty you read/recalled the figures correctly" },
            warnings: { type: "array", items: { type: "string" }, description: "Honest caveats about currency/accuracy" },
            rawExcerpt: { type: ["string", "null"], description: "Short verbatim snippet supporting the figures, if from a document" },
          },
          required: ["instrumentName", "issuer", "assetClass", "currency", "figures", "sourceLabel", "sourceUrl", "sourceAsOf", "confidence", "warnings", "rawExcerpt"],
        },
      },
    },
    required: ["answer", "findings"],
  },
} as const;

/* ── Pure parsing / normalising (network-free, unit-testable) ─────────────── */

/** Clamp a self-reported confidence into [0,1]; non-numbers → 0. */
export function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** Bucket a 0..1 confidence into the DB enum. Unsourced findings are capped at low. */
export function confidenceBucket(confidence: number, hasSource: boolean): ConfidenceBucket {
  if (!hasSource) return "low"; // a figure with no source is never more than a hint
  if (confidence >= 0.75) return "high";
  if (confidence >= 0.45) return "medium";
  return "low";
}

function cleanStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * Round 90 — the required fields for the finding's target catalogue that this draft is
 * still MISSING, computed against the SAME `checkApprovalGate` a manager will hit at
 * approval time (not a looser local subset). This closes the audited gap where a
 * finding looked "complete" in the card yet was blocked at Approve because the real
 * gate wants the full envelope (identity + figures + provenance + as-of).
 *
 * The finding carries: figures (`extractedFields`), an identity (`instrumentName`,
 * `issuer`, `currency`), a provenance label (`sourceLabel`/`sourceUrl`) and an as-of
 * (`sourceAsOf`). We map those onto the gate's inputs for a `create` and surface the
 * gate's own `missing` labels verbatim, so the card and the Approve dialog agree.
 *
 * Escapable fields (a genuinely unpublished bank rate/tenor, an unquoted market
 * figure) are NOT auto-escaped here: without an explicit "unavailable" flag the gate
 * lists them, and that is the honest thing to show the manager up front.
 */
export function missingFieldsForFinding(
  targetCatalogue: ReferenceCatalogue,
  figures: Record<string, string>,
  envelope?: {
    name?: string | null;
    issuer?: string | null;
    currency?: string | null;
    source?: string | null;
    asOf?: number | null;
  },
): string[] {
  const gate = checkApprovalGate({
    assetClass: assetClassForCatalogue(targetCatalogue),
    changeKind: "create",
    figures,
    name: envelope?.name ?? null,
    issuer: envelope?.issuer ?? null,
    currency: envelope?.currency ?? null,
    source: envelope?.source ?? null,
    asOf: envelope?.asOf ?? null,
  });
  return gate.missing;
}

/**
 * Round 90 — deterministic CBK rule-fill. For a Treasury finding whose TENOR/type the
 * source already stated, back-fill the CONVENTIONAL, non-numeric regulatory fields the
 * approval gate needs (security type, tenor-in-days, WHT rule, tax-exempt flag,
 * maturity rule) from KENYAN MARKET RULES — never a rate or price (those must come
 * from the source). This is a pure lookup, not an inference of market data: it only
 * fires when the tenor/type is unambiguous, and it never overwrites a value the model
 * already extracted. A bill still needs its `yieldPct` from the source to clear the
 * gate, so an incomplete finding stays flagged.
 */
export function applyCbkRuleFill(figures: Record<string, string>): Record<string, string> {
  const out = { ...figures };
  const set = (k: string, v: string) => {
    if (out[k] === undefined || String(out[k]).trim() === "") out[k] = v;
  };
  // Determine the tenor in days from any of the common signals.
  const blob = `${out.tenorDays ?? ""} ${out.tenor ?? ""} ${out.securityType ?? ""} ${out.instrumentType ?? ""} ${out.name ?? ""}`.toLowerCase();
  const tbillDays = /\b364\b/.test(blob) ? 364 : /\b182\b/.test(blob) ? 182 : /\b91\b/.test(blob) ? 91 : null;
  const isTBill = tbillDays !== null || /t-?bill|treasury bill/.test(blob);
  const isIfb = /\bifb\b|infrastructure bond/.test(blob);
  const isFxd = /\bfxd\b|fixed coupon|treasury bond|t-?bond/.test(blob) && !isIfb;

  if (isTBill && tbillDays) {
    set("securityType", "treasury_bill");
    set("tenorDays", String(tbillDays));
    set("tenor", `${tbillDays}-day`);
    set("whtRule", "15% withholding tax on the discount");
    set("taxExempt", "false");
    set("maturityRule", `value date + ${tbillDays} days`);
  } else if (isIfb) {
    set("securityType", "infrastructure_bond");
    set("whtRule", "0% — infrastructure bonds are tax-exempt");
    set("taxExempt", "true");
    set("maturityRule", "fixed maturity date per prospectus");
  } else if (isFxd) {
    set("securityType", "treasury_bond");
    set("whtRule", "15% withholding tax on coupon (10% for bonds of 10+ years)");
    set("taxExempt", "false");
    set("maturityRule", "fixed maturity date per prospectus");
  }
  return out;
}

/**
 * Normalise one raw finding object from the model into a safe ResearchFindingDraft.
 * IMPORTANT: reads `confidence` from the RAW object first, then scrubs verdict fields
 * (which would otherwise delete `confidence`), then maps the remaining safe fields.
 * Returns null for a finding with no usable name.
 */
export function normaliseFinding(raw: unknown): ResearchFindingDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const rawObj = raw as Record<string, unknown>;
  // Capture confidence BEFORE the verdict scrub removes it.
  const confidence = clampConfidence(rawObj.confidence);

  const o = stripVerdictFields(rawObj) as Record<string, unknown>;
  const name = cleanStr(o.instrumentName);
  if (!name) return null;

  const assetClass = normaliseAssetClass(o.assetClass);
  const targetCatalogue = catalogueForAssetClass(assetClass);

  let figures: Record<string, string> = {};
  if (Array.isArray(o.figures)) {
    for (const f of o.figures) {
      if (!f || typeof f !== "object") continue;
      const fo = f as Record<string, unknown>;
      const key = cleanStr(fo.key);
      const value = cleanStr(fo.value);
      if (key && value && !(key in figures)) figures[key] = value;
    }
  }

  // Round 90 — for CBK findings, deterministically back-fill the conventional
  // regulatory fields (security type, tenor-in-days, WHT rule, tax-exempt, maturity
  // rule) the gate needs, from the tenor/type the source stated. Never fills a rate.
  if (targetCatalogue === "cbk") {
    figures = applyCbkRuleFill({ ...figures, name });
    delete (figures as Record<string, string>).name; // `name` was only a rule-fill signal
  }

  const warnings: string[] = Array.isArray(o.warnings)
    ? o.warnings.map((w) => cleanStr(w)).filter((w): w is string => w !== null)
    : [];

  const sourceLabel = cleanStr(o.sourceLabel);
  const sourceUrl = cleanStr(o.sourceUrl);
  const hasSource = Boolean(sourceLabel || sourceUrl);
  const sourceAsOfStr = cleanStr(o.sourceAsOf);
  const asOfMs = sourceAsOfStr && Number.isFinite(Date.parse(sourceAsOfStr)) ? Date.parse(sourceAsOfStr) : null;
  // Round 90 — missing fields now mirror the REAL approval gate (identity + figures
  // + provenance + as-of), so the card and the Approve dialog can never disagree.
  const missingFields = missingFieldsForFinding(targetCatalogue, figures, {
    name,
    issuer: cleanStr(o.issuer),
    currency: cleanStr(o.currency),
    source: sourceLabel ?? sourceUrl,
    asOf: asOfMs,
  });

  // A finding with no source is inherently uncertain — force its warnings to say so.
  const finalWarnings = hasSource
    ? warnings
    : [...warnings, "No source was cited for this figure — treat as an unverified hint."];

  return {
    instrumentName: name,
    issuer: cleanStr(o.issuer),
    assetClass,
    targetCatalogue,
    currency: cleanStr(o.currency),
    extractedFields: figures,
    sourceLabel,
    sourceUrl,
    sourceAsOf: sourceAsOfStr,
    confidence: hasSource ? confidence : Math.min(confidence, 0.3),
    missingFields,
    warnings: finalWarnings,
    rawExcerpt: cleanStr(o.rawExcerpt),
  };
}

/** Parse + sanitize a raw research response into an answer + normalised findings. */
export function parseResearchResponse(rawText: string): { answer: string; findings: ResearchFindingDraft[] } {
  const parsed = parseJsonLoose(rawText) as { answer?: unknown; findings?: unknown } | null;
  if (!parsed || typeof parsed !== "object") {
    return { answer: "", findings: [] };
  }
  const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
  const findings: ResearchFindingDraft[] = [];
  if (Array.isArray(parsed.findings)) {
    for (const f of parsed.findings) {
      const norm = normaliseFinding(f); // reads confidence pre-scrub internally
      if (norm) findings.push(norm);
    }
  }
  return { answer, findings };
}

/* ── DB-row mapping (shared by the live Ask-AI path and the scheduled agent) ── */

/**
 * Map normalised drafts to research_findings insert rows for a given task. Extracted
 * one place so the interactive `ask` procedure and the scheduled source-check handler
 * persist findings through the exact same governed shape (status always "new").
 */
export function findingsToRows(taskId: number, drafts: ResearchFindingDraft[], threadId?: number | null) {
  const now = Date.now();
  return drafts.map((d) => ({
    taskId,
    threadId: threadId ?? null,
    instrumentName: d.instrumentName,
    issuer: d.issuer,
    assetClass: d.assetClass,
    targetCatalogue: d.targetCatalogue,
    currency: d.currency,
    extractedFields: d.extractedFields,
    sourceLabel: d.sourceLabel,
    sourceUrl: d.sourceUrl,
    // Schema stores as-of as an epoch-ms UTC bigint; parse the ISO string the model gave.
    sourceAsOf: d.sourceAsOf ? (Number.isFinite(Date.parse(d.sourceAsOf)) ? Date.parse(d.sourceAsOf) : null) : null,
    checkedAt: now,
    confidence: confidenceBucket(d.confidence, Boolean(d.sourceLabel || d.sourceUrl)),
    missingFields: d.missingFields,
    warnings: d.warnings,
    rawExcerpt: d.rawExcerpt,
    status: "new" as const,
  }));
}

/* ── Round 89: per-catalogue "Review source with AI" prompt builders ─────────
 *
 * These are PURE (network-free) and unit-tested. The per-catalogue review reuses
 * the SAME engine (`runResearchQuestion`) and the SAME findings output — the only
 * difference is (a) the question text tells the model to COMPARE the attached
 * source against the manager's CURRENT rows and (b) which figures matter for that
 * catalogue. Nothing here writes anything: findings still go to the review queue.
 */

/** A minimal shape of a current catalogue row, for the comparison snapshot. */
export type CatalogueRowSnapshot = Record<string, string | number | null | undefined>;

/**
 * The catalogue-specific extraction instruction: which figures the model should look
 * for in the source and how to label them, framed as a NEUTRAL fact-extraction task
 * (never a ranking). Kept in lockstep with the reference catalogues' figure keys so a
 * drafted finding maps cleanly onto the pending-update figures.
 */
export function catalogueReviewInstruction(catalogue: ReferenceCatalogue): string {
  switch (catalogue) {
    case "mmf":
      return [
        "You are reviewing a source (a Serrari-style benchmark table, a fund factsheet, a screenshot, a PDF or a URL) for the manager's MONEY MARKET FUND catalogue.",
        "For every MMF the source mentions, extract, verbatim with units: the published EAR (effective annual rate, net of fee) as `ear`; the gross/quoted yield as `grossYield`; the annual management fee as `managementFee`; the minimum investment (KES) as `minInvestment`; and AUM in KES millions as `aumMillions`. Keep `ear` and `grossYield` as the DIFFERENT numbers the source prints — never convert one into the other.",
        "Compare each against the CURRENT catalogue rows below. Emit a finding when: a fund is NEW (not in the current rows), any figure CHANGED versus the current row, or the source/as-of date is newer. If a current fund is clearly absent from a comprehensive source (e.g. delisted), note it in that finding's warnings as a possible STALE row — do not invent a removal figure.",
      ].join("\n");
    case "bank":
      return [
        "You are reviewing a source for the manager's BANK PRODUCT catalogue (call/fixed/savings deposits).",
        "For every bank product the source mentions, extract, verbatim with units: the indicative rate (% p.a.) as `indicativeRate`; the minimum amount (KES) as `minAmount`; the typical tenor / notice period as `typicalTenor`; and whether the rate is negotiable as `isNegotiable` (\"true\"/\"false\"). Capture any early-break / liquidity terms in the finding's rawExcerpt. Bank rates are INDICATIVE and usually quoted GROSS of the 15% WHT — say so in warnings when the source does.",
        "Compare each against the CURRENT catalogue rows below. Emit a finding when a product is NEW, a rate/minimum/tenor/negotiable flag/liquidity term CHANGED, or the as-of date is newer.",
      ].join("\n");
    case "cbk":
      return [
        "You are reviewing a CBK / Treasury source: Treasury bills on offer, weekly auction results, or a bond auction/re-opening notice.",
        "For Treasury BILLS, emit ONE finding per tenor actually present — the 91-day, 182-day and 364-day bills are SEPARATE instruments. For each, extract verbatim: the annualised rate as `yieldPct`; the previous auction average rate as `prevAvgRate` when shown; the tenor in days as `tenorDays` (91/182/364); the issue number as `issueNumber`; the auction date as `auctionDate` and the value/settlement date as `valueDate`. For BONDS, extract the coupon as `coupon`, the yield-to-maturity as `yieldPct`, and the tenor.",
        "Name each bill finding clearly by tenor (e.g. \"91-Day Treasury Bill\"). Compare against the CURRENT rows below and emit a finding when a tenor's rate/issue/dates changed or a new issue is on offer.",
      ].join("\n");
    case "market_asset":
      return [
        "You are reviewing a market source for the manager's MARKET ASSETS catalogue: an NSE price board, a REIT factsheet, an ETF factsheet, or an offshore-fund factsheet.",
        "For every instrument the source mentions, extract, verbatim with units: the last price / NAV as `lastPrice`; the headline yield or distribution as `yieldPct` (and what it represents as `yieldKind`); the trailing 12-month return as `trailingReturnPct`; and the expense ratio as `expenseRatioPct` where shown. Trailing returns are PAST performance — say so in warnings.",
        "Compare each against the CURRENT rows below and emit a finding when an instrument is NEW, a price/NAV/yield/trailing return CHANGED, or the as-of date is newer.",
      ].join("\n");
  }
}

/**
 * Render the manager's current catalogue rows into a compact, readable snapshot the
 * model can diff the source against. Deliberately small (name + the catalogue's key
 * figures + source/as-of) so it fits comfortably in the prompt for a large catalogue.
 * Returns a friendly placeholder when the catalogue is currently empty.
 */
export function summariseCatalogueRows(
  catalogue: ReferenceCatalogue,
  rows: CatalogueRowSnapshot[],
): string {
  if (!rows.length) return "(The catalogue is currently EMPTY — every instrument in the source is a candidate NEW row.)";
  const fmt = (v: string | number | null | undefined) =>
    v === null || v === undefined || v === "" ? "—" : String(v);
  const lines = rows.slice(0, 200).map((r, i) => {
    switch (catalogue) {
      case "mmf":
        return `${i + 1}. ${fmt(r.fundName)} (${fmt(r.company)}) — EAR ${fmt(r.ear)}%, gross ${fmt(r.grossYield)}%, fee ${fmt(r.managementFee)}%, min KES ${fmt(r.minInvestment)}, AUM ${fmt(r.aumMillions)}m; as-of ${fmt(r.asOfDate)}; src ${fmt(r.source)}`;
      case "bank":
        return `${i + 1}. ${fmt(r.bankName)} — ${fmt(r.instrumentType)}, rate ${fmt(r.indicativeRate)}%, min KES ${fmt(r.minAmount)}, tenor ${fmt(r.typicalTenor)}, negotiable ${fmt(r.isNegotiable)}; as-of ${fmt(r.asOfDate)}; src ${fmt(r.source)}`;
      case "cbk":
        return `${i + 1}. ${fmt(r.name)} (${fmt(r.assetClass)}) — yield ${fmt(r.yieldPct)}%, tenor ${fmt(r.tenorYears)}y; as-of ${fmt(r.dataAsOf)}; src ${fmt(r.dataSource)}`;
      case "market_asset":
        return `${i + 1}. ${fmt(r.name)} (${fmt(r.assetClass)}) — price ${fmt(r.lastPrice)}, yield ${fmt(r.yieldPct)}%, trailing ${fmt(r.trailingReturnPct)}%; as-of ${fmt(r.dataAsOf)}; src ${fmt(r.dataSource)}`;
    }
  });
  const more = rows.length > 200 ? `\n… and ${rows.length - 200} more current rows (not shown).` : "";
  return lines.join("\n") + more;
}

/**
 * Build the full "review this source against my catalogue" QUESTION handed to
 * `runResearchQuestion`. The attached source is supplied separately (as the engine's
 * `source`), so this only carries the instruction + the current-rows snapshot.
 */
export function buildCatalogueReviewQuestion(
  catalogue: ReferenceCatalogue,
  rows: CatalogueRowSnapshot[],
): string {
  return [
    catalogueReviewInstruction(catalogue),
    "",
    "CURRENT CATALOGUE ROWS (compare the attached source against these — do NOT restate a row that is unchanged):",
    summariseCatalogueRows(catalogue, rows),
    "",
    "Return a concise briefing of what the source says versus the current rows, plus one structured FINDING per proposed change (new row, changed figure, or newer source/as-of). Every finding is a PROPOSAL the manager will review and approve — never a catalogue write, never a recommendation.",
  ].join("\n");
}

/* ── LLM-calling wrapper (thin) ───────────────────────────────────────────── */

/**
 * Run one research question. Optionally grounds on a specific source: if `sourceUrl`
 * is given we fetch it server-side and hand the text to the model (and warn if the
 * fetch was thin/JS-rendered); otherwise the model answers from its own knowledge and
 * MUST self-report lower confidence + cite what it relied on.
 */
/**
 * A source a manager can attach to a research question. ONE unified union so the
 * UI does not force a manager to choose "Ask AI" vs "Import a document": whether the
 * source is a URL, pasted text, a PDF, or a screenshot, it becomes grounding text for
 * the SAME briefing prompt and the SAME structured-findings output shape.
 *   - url:   fetched + stripped server-side (thin-fetch nudge preserved as a warning)
 *   - text:  pasted verbatim
 *   - pdf:   read directly by the model via a signed file_url, transcribed to text
 *   - image: read by a vision-capable model via a signed image_url, transcribed to text
 */
export type ResearchSource =
  | { kind: "url"; url: string }
  | { kind: "text"; text: string }
  | { kind: "pdf"; fileUrl: string }
  | { kind: "image"; imageUrl: string };

/**
 * Transcribe a PDF or screenshot into plain text the briefing prompt can ground on.
 * The model is instructed to transcribe ONLY what is printed (no inference), mirroring
 * the librarian's OCR-grade faithfulness. Returns the transcript (possibly empty).
 * FAILS LOUDLY for an image when no vision-capable model is available, so a manager is
 * told to paste the text instead of silently getting nothing.
 */
export async function transcribeSourceToText(
  source: { kind: "pdf"; fileUrl: string } | { kind: "image"; imageUrl: string },
): Promise<{ text: string; model: string | null }> {
  let modelOverride: string | undefined;
  if (source.kind === "image") {
    const visionModel = await resolveVisionModel();
    if (!visionModel) {
      throw new Error(
        "The current AI model can't read images. Use 'Paste text' instead and type the figures you can see.",
      );
    }
    modelOverride = visionModel;
  }

  const instruction =
    source.kind === "pdf"
      ? "Transcribe the readable text and figures from the attached PDF document. Preserve numbers, labels, dates and units verbatim. Do not summarise, infer, or add anything not printed in the document."
      : "Transcribe ONLY the text and figures visibly printed in the attached image (a screenshot or photo of a quote board, fact sheet, or notice). Preserve numbers, labels, dates and units verbatim. Never infer a value that is not shown.";

  const userContent =
    source.kind === "pdf"
      ? ([
          { type: "text", text: instruction },
          { type: "file_url", file_url: { url: source.fileUrl, mime_type: "application/pdf" as const } },
        ] as const)
      : ([
          { type: "text", text: instruction },
          { type: "image_url", image_url: { url: source.imageUrl, detail: "high" as const } },
        ] as const);

  const res = await invokeLLM({
    messages: [
      {
        role: "system",
        content:
          "You are an OCR-grade transcription assistant. Return the readable text content of the attached document as plain text, verbatim. Do not add commentary.",
      },
      // Cast: invokeLLM accepts multimodal content arrays at runtime.
      { role: "user", content: userContent as unknown as string },
    ],
    ...(modelOverride ? { model: modelOverride } : {}),
    temperature: 0,
  });
  return { text: contentToText(res.choices?.[0]?.message?.content).trim(), model: res.model ?? null };
}

export async function runResearchQuestion(args: {
  question: string;
  scope: ResearchScope;
  sourceUrl?: string | null;
  /** Pre-supplied source text (e.g. pasted by the manager, or a source registry doc). */
  sourceText?: string | null;
  /**
   * The unified attached source. When present it takes precedence over the legacy
   * `sourceUrl`/`sourceText` fields (which are kept for backward compatibility).
   */
  source?: ResearchSource | null;
  /** Human label for the attached source, threaded into findings' provenance. */
  sourceLabel?: string | null;
  /**
   * Round 88 — prior turns of the SAME enquiry thread, oldest-first, so a follow-up
   * ("and the 182-day one?", "what about after the 15% WHT?") is answered WITH the
   * earlier context instead of cold. Prose turns only; durable facts still live in
   * each turn's findings. Capped so a long thread can't blow the context window.
   */
  priorMessages?: Array<{ role: "user" | "assistant"; content: string }> | null;
}): Promise<ResearchAnswer> {
  const scopeLine =
    args.scope === "any" ? "" : `\nConstrain your findings to this scope: ${args.scope}.`;

  let grounding = "";
  const groundingWarnings: string[] = [];

  // Normalise the legacy fields into the unified union so there is a single code path.
  let source: ResearchSource | null = args.source ?? null;
  if (!source) {
    if (args.sourceText && args.sourceText.trim() !== "") {
      source = { kind: "text", text: args.sourceText };
    } else if (args.sourceUrl && args.sourceUrl.trim() !== "") {
      source = { kind: "url", url: args.sourceUrl };
    }
  }

  if (source) {
    if (source.kind === "text") {
      grounding = `\n\nGROUND YOUR FINDINGS IN THIS SOURCE DOCUMENT (extract only what it states):\n${source.text.slice(0, 40000)}`;
    } else if (source.kind === "url") {
      try {
        const text = await fetchDocumentText(source.url);
        if (isThinFetch(text)) {
          groundingWarnings.push(
            "The linked page returned very little readable text (it may be JavaScript-rendered), so figures may be incomplete. Consider pasting the text or uploading a screenshot instead.",
          );
        }
        grounding = `\n\nGROUND YOUR FINDINGS IN THIS SOURCE (${source.url}):\n${text}`;
      } catch (err) {
        groundingWarnings.push(
          `Could not fetch the linked source (${err instanceof Error ? err.message : String(err)}); answered from general knowledge instead.`,
        );
      }
    } else {
      // pdf | image → transcribe to text via the (vision-capable) model, then ground on it.
      const label = source.kind === "pdf" ? "uploaded PDF" : "uploaded screenshot";
      const transcript = await transcribeSourceToText(source);
      if (transcript.text.trim() === "") {
        groundingWarnings.push(
          `The ${label} produced no readable text — figures may be incomplete. Try pasting the text instead.`,
        );
      } else {
        grounding = `\n\nGROUND YOUR FINDINGS IN THIS SOURCE (read from an ${label}${args.sourceLabel ? `: ${args.sourceLabel}` : ""}):\n${transcript.text.slice(0, 40000)}`;
        groundingWarnings.push(
          `Figures were transcribed by AI from an ${label} — confirm each against the original before acting.`,
        );
      }
    }
  }

  // Round 88 — fold prior thread turns in as real conversation messages so a
  // follow-up is grounded in what was already said. Cap to the last 10 turns and
  // clip each so a long thread stays inside the context budget.
  const priorTurns = (args.priorMessages ?? [])
    .slice(-10)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const followUpNote = priorTurns.length
    ? "\n(This is a FOLLOW-UP in an ongoing enquiry. Use the earlier turns for context, but still return standalone FINDINGS for every figure THIS answer relies on — do not assume the manager will re-read prior findings.)"
    : "";

  const res = await invokeLLM({
    messages: [
      { role: "system", content: RESEARCH_SYSTEM_PROMPT },
      ...priorTurns,
      { role: "user", content: `QUESTION: ${args.question}${scopeLine}${grounding}${followUpNote}` },
    ],
    temperature: 0,
    response_format: { type: "json_schema", json_schema: RESEARCH_SCHEMA },
  });

  const text = contentToText(res.choices?.[0]?.message?.content);
  const { answer, findings } = parseResearchResponse(text);

  // Round 90 — PROVENANCE FALLBACK. When a manager attached a real source but the
  // model forgot to echo it onto a finding, back-fill the finding's provenance from
  // the ACTUAL attached source (never inventing an as-of date). This stops a finding
  // extracted from a genuine upload/paste/URL from being mislabelled "no source" and
  // wrongly capped to a hint — and, because provenance now satisfies the gate's
  // `source` rule, its missing-fields list is recomputed to match.
  const fallbackLabel = ((): string | null => {
    if (args.sourceLabel && args.sourceLabel.trim() !== "") return args.sourceLabel.trim();
    if (!source) return null;
    switch (source.kind) {
      case "url":
        try {
          return new URL(source.url).hostname.replace(/^www\./, "");
        } catch {
          return source.url;
        }
      case "pdf":
        return "Uploaded PDF";
      case "image":
        return "Uploaded screenshot";
      case "text":
        return "Pasted source text";
    }
  })();
  const fallbackUrl = source && source.kind === "url" ? source.url : null;

  const stamped = findings.map((f) => {
    const hadSource = Boolean(f.sourceLabel || f.sourceUrl);
    if (hadSource || !fallbackLabel) return f;
    const sourceLabel = f.sourceLabel ?? fallbackLabel;
    const sourceUrl = f.sourceUrl ?? fallbackUrl;
    const asOfMs =
      f.sourceAsOf && Number.isFinite(Date.parse(f.sourceAsOf)) ? Date.parse(f.sourceAsOf) : null;
    return {
      ...f,
      sourceLabel,
      sourceUrl,
      // Drop the "no source cited" self-warning we added when the finding looked unsourced.
      warnings: f.warnings.filter((w) => !w.startsWith("No source was cited")),
      // Recompute against the gate now that provenance is present.
      missingFields: missingFieldsForFinding(f.targetCatalogue, f.extractedFields, {
        name: f.instrumentName,
        issuer: f.issuer,
        currency: f.currency,
        source: sourceLabel ?? sourceUrl,
        asOf: asOfMs,
      }),
    };
  });

  // Attach any grounding warnings to every finding so the manager sees the caveat.
  const withWarnings = groundingWarnings.length
    ? stamped.map((f) => ({ ...f, warnings: [...f.warnings, ...groundingWarnings] }))
    : stamped;

  return { answer, findings: withWarnings, model: res.model ?? null };
}
