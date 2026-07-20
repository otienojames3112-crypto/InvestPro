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
  extractPdfText,
  looksLikeRawBlob,
} from "./aiIntakeService";
import { normaliseAssetClass, type AssetClass } from "../shared/assetModel";
import {
  catalogueForAssetClass,
  type ReferenceCatalogue,
  checkApprovalGate,
  assetClassForCatalogue,
  canonicalizeBankInstrumentType,
} from "../shared/researchPipeline";
import {
  SOURCE_CLASSES,
  type SourceClass,
  isSourceClass,
  SOURCE_CLASS_LABELS,
  MISSING_FROM_SOURCE,
  NEVER_INVENT_FIELDS,
  CBK_BOND_REQUIRED_FIELDS,
} from "../shared/instrumentProfile";
import { searchAuthoritativeSource, type SearchSourceResult } from "./_core/webSearch";
import { findCandidatePhrases, registeredFieldsForCatalogue, type CandidateMatch } from "../shared/candidatePhrases";

// Stage 4.2b-i — extractPdfText/looksLikeRawBlob now live in aiIntakeService.ts (so
// fetchDocumentText there can reuse them for a directly-fetched PDF URL without a
// circular import back into this file). Re-exported here so existing importers of
// these two names FROM this module (e.g. routers.ts) keep working unchanged.
export { extractPdfText, looksLikeRawBlob };

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
  /** Round 91 — the KIND of source this finding was read from (url/text/pdf/image),
   * or null when the answer was not grounded in a readable source. */
  sourceKind: SourceKind | null;
  /** Round 91 — when the source was READ (epoch ms UTC). Distinct from sourceAsOf. */
  checkedAt: number | null;
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

/**
 * Round 92 — a compact, durable summary of a finding ALREADY established earlier in
 * the same enquiry thread, fed back into a follow-up so the AI reuses prior facts,
 * honours the manager's corrections, and does not re-emit an identical finding.
 */
export interface PriorFindingContext {
  instrument: string;
  assetClass: string | null;
  /** Verbatim figures already recorded (key -> value). */
  figures: Record<string, string>;
  sourceLabel: string | null;
  sourceUrl: string | null;
  asOf: string | null;
  /** Triage state so the model knows what the manager did with it. */
  status: "new" | "drafted" | "dismissed" | "superseded";
  /** Present when this finding is a manager correction of an earlier value. */
  correction: { field: string; oldValue: string | null; newValue: string; reason: string | null } | null;
}

/** The full result of one Ask-AI question. */
/** Round 103 — extraction diagnostic returned when extraction was expected but produced
 * zero findings, so the UI can show a clear reason instead of silently leaving old findings. */
export interface ExtractionDiagnostic {
  /** Whether extraction was attempted. */
  attempted: boolean;
  /** Why it produced zero findings (null when findings > 0). */
  reason: string | null;
  /** The source class detected (null when classification failed). */
  sourceClass: SourceClass | null;
  /** Characters read from the source (0 when unreadable). */
  charsRead: number;
  /** Whether extraction was forced by intent detection. */
  forcedByIntent: boolean;
}

export interface ResearchAnswer {
  answer: string;
  findings: ResearchFindingDraft[];
  model: string | null;
  /** Round 102 — the detected source class (null when generic/no structured extraction). */
  sourceClass?: SourceClass | null;
  /** Round 103 — diagnostic when extraction was expected but produced nothing. */
  extractionDiagnostic?: ExtractionDiagnostic | null;
}

/* ── Round 103 — Server-side extraction-intent detection ─────────────────── */

/**
 * Detect whether the user's question implies they want structured extraction,
 * regardless of the UI mode selector. Returns true when a readable source is
 * available (or reused) AND the question contains extraction-intent language.
 */
const EXTRACTION_INTENT_PATTERNS: RegExp[] = [
  /\bextract\b/i,
  /\badd\s+(to|these|them|the)\s+(the\s+)?(findings|catalogue|catalog)/i,
  /\buse\s+(this|the|previous|that)\s+source/i,
  /\breview\s+(this|the)\s+source/i,
  /\bcompare\s+(this|with|against)/i,
  /\bupdate\s+the\s+rates/i,
  /\bidentify\s+(changed|new|missing)/i,
  /\blist\s+the\s+instruments/i,
  /\bdraft\s+findings/i,
  /\bpopulate\s+the\s+(reference\s+)?catalogue/i,
  /\badd\s+(any\s+)?missing\s+(funds|instruments|rows)/i,
  /\buse\s+it\s+to\s+add/i,
  /\badd\s+to\s+the\s+findings/i,
  /\bextract\s+(all|the|every)/i,
];

export function shouldForceExtraction(
  question: string,
  hasReadableSource: boolean,
): boolean {
  if (!hasReadableSource) return false;
  return EXTRACTION_INTENT_PATTERNS.some((p) => p.test(question));
}

/* ── Round 103 — Field normalization (extraction schema → catalogue canonical) ── */

/** Map extraction-schema field names to catalogue-canonical field names.
 * The extraction schemas use descriptive names (effectiveAnnualRate, minimumInvestment)
 * while the catalogue approval gate expects short canonical keys (ear, minInvestment).
 * This normalizer runs AFTER structuredInstrumentToDraft builds the figures bag. */
const FIELD_NORMALIZATION_MAP: Record<string, Record<string, string>> = {
  mmf: {
    effectiveAnnualRate: "ear",
    minimumInvestment: "minInvestment",
    aum: "aumMillions",
    grossYield: "yieldPct",
  },
  bank: {
    minimumAmount: "minAmount",
    negotiable: "isNegotiable",
  },
  cbk: {
    couponRate: "coupon",
    withholdingTaxRate: "whtRate",
  },
  market_asset: {
    marketPrice: "lastPrice",
    nav: "navPerUnit",
  },
};

/** Normalize extraction field names to catalogue canonical names for a given catalogue. */
export function normaliseExtractionFields(
  figures: Record<string, string>,
  catalogue: string,
): Record<string, string> {
  const map = FIELD_NORMALIZATION_MAP[catalogue];
  if (!map) return figures;
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(figures)) {
    const canonical = map[k];
    if (canonical) {
      // Add both the canonical AND the original (so profile preview still works)
      result[canonical] = v;
      if (!(k in result)) result[k] = v; // keep original for display
    } else {
      result[k] = v;
    }
  }
  return result;
}

export const TIERED_SAVINGS_RATE_SCHEDULE_WARNING =
  "Tiered savings product has no rate schedule / balance bands in the source; verify tiers before relying on the headline rate.";

function hasRealExtractedValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  if (text === "") return false;
  const key = text.toLowerCase().replace(/[\s-]+/g, "_");
  return ![
    MISSING_FROM_SOURCE,
    "unavailable",
    "not_available",
    "n/a",
    "na",
    "none",
    "unknown",
    "not_applicable",
    "not_published",
    "unpublished",
    "not_disclosed",
    "not_reported",
    "not_stated",
    "not_provided",
    "not_specified",
  ].includes(key);
}

export function isTieredSavingsProduct(figures: Record<string, unknown> | null | undefined): boolean {
  if (!figures) return false;
  return (
    canonicalizeBankInstrumentType(figures.instrumentType) === "tiered_savings" ||
    canonicalizeBankInstrumentType(figures.productType) === "tiered_savings"
  );
}

function needsTieredSavingsRateScheduleNudge(figures: Record<string, unknown>): boolean {
  return isTieredSavingsProduct(figures) && !hasRealExtractedValue(figures.rateSchedule);
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
- Never treat a reference figure as if it were a holding, and never let a source's example balance become a finding.

HOW THIS TRACKER USES YOUR WORK (be tool-aware — say this plainly when a question touches it):
- Reference catalogues are NOT holdings. A catalogue row is a published market fact about an instrument; it is not money the manager owns.
- Holdings are the actual money. Balances, positions, cost, coupon receipts and this portfolio's performance live on the holdings side, which you never see or change.
- Your findings do NOT affect any portfolio maths until a human APPROVES them. Nothing you output moves a number in the tracker on its own; a finding must be drafted into the review queue and approved by the manager first.
- Once approved, a catalogue change may affect FUTURE PROJECTIONS ONLY — the forward-looking assumptions the tracker uses. It does not, and must not, rewrite HISTORICAL ACTUALS: past recorded balances, past coupons and realised performance are never restated by a catalogue edit.
- Because of this, frame answers as "here is the current published figure; if you approve it, future projections would use it" — never as "your portfolio is now worth X" or "this changes your returns".

PER-ASSET-CLASS FIELDS & RISKS (each catalogue type is different — use the right fields and name the relevant risk):
- MMFs: key fields are the EFFECTIVE ANNUAL RATE (ear) and/or gross yield (yieldPct), plus the management fee. Risks/caveats: EAR vs simple-yield confusion, whether a fee is already netted, and that a quote is a snapshot that changes daily.
- Bank products (fixed/call deposits): key fields are the indicative rate, tenor and any tier/minimum. Risks/caveats: rates are INDICATIVE and NEGOTIABLE and usually quoted GROSS of the 15% withholding tax — flag pre-tax vs net.
- CBK securities (T-bills / T-bonds): key fields are the auction/annualised yield and tenor (91/182/364-day for bills) or coupon + yield-to-maturity (bonds). Risks/caveats: an auction yield is a point-in-time result; a bond's coupon is not its YTM; and reopened issues carry a specific issue number.
- Market assets (equities/ETFs/other): key fields are the last price and its as-of date/currency. Risks/caveats: prices are volatile and stale quickly, and currency must be explicit.`;

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
    assetClass?: AssetClass | null;
  },
): string[] {
  const gate = checkApprovalGate({
    assetClass: envelope?.assetClass ?? assetClassForCatalogue(targetCatalogue),
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
 * Stage 5 — sibling of `missingFieldsForFinding` that surfaces the STRUCTURED
 * missing rules (key + label) instead of just labels, for the follow-up-question
 * generator. Computed fresh from the SAME gate call each time it's read — never
 * persisted (research_findings.missingFields stays label-only on disk, exactly as
 * before; no schema migration). Same inputs, same gate, only the output differs.
 */
export function missingRulesForFinding(
  targetCatalogue: ReferenceCatalogue,
  figures: Record<string, string>,
  envelope?: {
    name?: string | null;
    issuer?: string | null;
    currency?: string | null;
    source?: string | null;
    asOf?: number | null;
    assetClass?: AssetClass | null;
  },
): { key: string; label: string }[] {
  const gate = checkApprovalGate({
    assetClass: envelope?.assetClass ?? assetClassForCatalogue(targetCatalogue),
    changeKind: "create",
    figures,
    name: envelope?.name ?? null,
    issuer: envelope?.issuer ?? null,
    currency: envelope?.currency ?? null,
    source: envelope?.source ?? null,
    asOf: envelope?.asOf ?? null,
  });
  return gate.missingRules ?? [];
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
    assetClass,
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
    // Round 91 — provenance kind/checkedAt are stamped by runResearchQuestion once the
    // source has actually been read; the parser leaves them null.
    sourceKind: null,
    checkedAt: null,
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
    sourceKind: d.sourceKind ?? null,
    // Schema stores as-of as an epoch-ms UTC bigint; parse the ISO string the model gave.
    sourceAsOf: d.sourceAsOf ? (Number.isFinite(Date.parse(d.sourceAsOf)) ? Date.parse(d.sourceAsOf) : null) : null,
    checkedAt: d.checkedAt ?? now,
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
        "Compare each against the CURRENT catalogue rows below and propose findings for ALL of: (a) NEW funds not in the current rows; (b) EAR/gross-yield RATE changes; (c) management-FEE changes; (d) MINIMUM-investment changes; (e) AUM changes; and (f) STALE rows. When a current fund is clearly absent from a comprehensive benchmark (e.g. delisted or no longer quoted), emit a finding with proposalType='stale'. Only emit a finding when something is new or actually changed versus the current row, or the source/as-of date is newer.",
        "For EVERY finding, set proposalType to 'create' (new fund), 'update' (existing row changed), or 'stale' (current row absent from source). For 'update' and 'stale', set matchedCurrentRow to the exact fund name from the CURRENT CATALOGUE ROWS list, list the changedFields, and provide currentValues (the OLD values from the current row). For 'create', set matchedCurrentRow to null and changedFields/currentValues to empty arrays.",
      ].join("\n");
    case "bank":
      return [
        "You are reviewing a source for the manager's BANK PRODUCT catalogue (call/fixed/savings deposits).",
        "For every bank product the source mentions, extract, verbatim with units: the indicative rate (% p.a.) as `indicativeRate`; the minimum amount (KES) as `minAmount`; the typical tenor / notice period as `typicalTenor`; and whether the rate is negotiable as `isNegotiable` (\"true\"/\"false\"). Capture any early-break / liquidity terms in the finding's rawExcerpt. Bank rates are INDICATIVE and usually quoted GROSS of the 15% WHT — say so in warnings when the source does.",
        "Compare each against the CURRENT catalogue rows below and propose findings for ALL of: NEW products; indicative-RATE changes; TENOR / notice-period changes; and NEGOTIABLE-flag changes (plus minimum-amount or liquidity-term changes). Emit a finding only when a product is new or a value actually CHANGED versus the current row, or the as-of date is newer.",
        "For EVERY finding, set proposalType to 'create' (new product), 'update' (existing row changed), or 'stale' (current row absent from source). For 'update' and 'stale', set matchedCurrentRow to the exact product name from the CURRENT CATALOGUE ROWS list, list the changedFields, and provide currentValues (the OLD values from the current row). For 'create', set matchedCurrentRow to null and changedFields/currentValues to empty arrays.",
      ].join("\n");
    case "cbk":
      return [
        "You are reviewing a CBK / Treasury source: Treasury bills on offer, weekly auction results, or a bond auction/re-opening notice.",
        "For Treasury BILLS, emit ONE finding per tenor actually present — the 91-day, 182-day and 364-day bills are SEPARATE instruments. For each, extract verbatim: the annualised rate as `yieldPct`; the previous auction average rate as `prevAvgRate` when shown; the tenor in days as `tenorDays` (91/182/364); the issue number as `issueNumber`; the auction date as `auctionDate` and the value/settlement date as `valueDate`. For BONDS, extract the coupon as `coupon`, the yield-to-maturity as `yieldPct`, and the tenor.",
        "Name each bill finding clearly by tenor (e.g. \"91-Day Treasury Bill\"). Compare against the CURRENT rows below and propose findings for ALL of: 91/182/364-day bill RATE updates; new ISSUE NUMBERS; AUCTION-date and VALUE-date updates; and any bond RE-OPENING. Emit a finding when a tenor's rate/issue/dates changed or a new issue is on offer.",
        "For EVERY finding, set proposalType to 'create' (new issue), 'update' (existing row changed), or 'stale' (current row absent from source). For 'update' and 'stale', set matchedCurrentRow to the exact name from the CURRENT CATALOGUE ROWS list, list the changedFields, and provide currentValues (the OLD values from the current row). For 'create', set matchedCurrentRow to null and changedFields/currentValues to empty arrays.",
      ].join("\n");
    case "market_asset":
      return [
        "You are reviewing a market source for the manager's MARKET ASSETS catalogue: an NSE price board, a REIT factsheet, an ETF factsheet, or an offshore-fund factsheet.",
        "For every instrument the source mentions, extract, verbatim with units: the last price / NAV as `lastPrice`; the headline yield or distribution as `yieldPct` (and what it represents as `yieldKind`); the trailing 12-month return as `trailingReturnPct`; and the expense ratio as `expenseRatioPct` where shown. Trailing returns are PAST performance — say so in warnings.",
        "Compare each against the CURRENT rows below and propose findings for ALL of: NEW instruments; PRICE / NAV changes; YIELD changes; and TRAILING-RETURN changes (plus expense-ratio updates). Emit a finding only when an instrument is new or a value actually CHANGED versus the current row, or the as-of date is newer.",
        "For EVERY finding, set proposalType to 'create' (new instrument), 'update' (existing row changed), or 'stale' (current row absent from source). For 'update' and 'stale', set matchedCurrentRow to the exact name from the CURRENT CATALOGUE ROWS list, list the changedFields, and provide currentValues (the OLD values from the current row). For 'create', set matchedCurrentRow to null and changedFields/currentValues to empty arrays.",
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

/** The kind of source a finding was read from (for provenance + UI status). */
export type SourceKind = "url" | "text" | "pdf" | "image";

/**
 * Round 91 — the OUTCOME of trying to READ a source, kept STRICTLY separate from any
 * AI-engine outcome. `readSource()` runs BEFORE the LLM, so a URL fetch failure, a
 * thin (JS-rendered) page, an unreadable PDF/screenshot, or a storage error each
 * surface as a TYPED read failure with an actionable retry hint — never as a generic
 * "failed to fetch" tangled up with an LLM/timeout error.
 *
 *   ok:true  → we have grounding `text` (+ char count via text.length), a display
 *              `label`, the optional `url`, the source `kind`, and any non-fatal
 *              `warnings` (e.g. "thin fetch", "transcribed by AI").
 *   ok:false → a `reason` the UI can branch on, a human `message`, and a `retryHint`
 *              telling the manager exactly what to do (paste text / upload a PDF /
 *              upload a screenshot).
 */
export type SourceReadResult =
  | {
      ok: true;
      kind: SourceKind;
      text: string;
      label: string;
      url?: string;
      /** Non-fatal caveats (thin page, AI transcription) to show + stamp on findings. */
      warnings: string[];
      /** True when the fetch succeeded but returned implausibly little text. */
      thin: boolean;
    }
  | {
      ok: false;
      kind: SourceKind;
      reason: "url_unreadable" | "thin_fetch" | "pdf_unreadable" | "image_unreadable" | "storage_error";
      message: string;
      retryHint: string;
    };

const PASTE_OR_UPLOAD_HINT =
  "Paste the text, upload a PDF, or upload a screenshot.";

/**
 * Read an attached source to grounding text, classifying every failure. This is the
 * single choke point both Ask AI and Review call BEFORE the LLM. For `text` it is a
 * pure pass-through; for `url` it fetches + strips HTML (flagging a thin result); for
 * `pdf`/`image` it OCR-transcribes via the model. A thin URL fetch is returned as a
 * NON-fatal `ok:true` with `thin:true` (Ask AI can still answer, Review must decide),
 * except when the page is so thin it is effectively empty, which is a hard failure.
 */
export async function readSource(
  source: ResearchSource,
  opts?: { label?: string | null; thinIsFatal?: boolean },
): Promise<SourceReadResult> {
  const label = opts?.label && opts.label.trim() !== "" ? opts.label.trim() : null;

  if (source.kind === "text") {
    const text = source.text.trim();
    if (text === "") {
      return {
        ok: false,
        kind: "text",
        reason: "thin_fetch",
        message: "The pasted text was empty.",
        retryHint: "Paste the figures or the page text you want me to read.",
      };
    }
    return { ok: true, kind: "text", text, label: label ?? "Pasted source text", warnings: [], thin: false };
  }

  if (source.kind === "url") {
    const hostLabel = (() => {
      try {
        return new URL(source.url).hostname.replace(/^www\./, "");
      } catch {
        return source.url;
      }
    })();
    let text: string;
    try {
      text = await fetchDocumentText(source.url);
    } catch (err) {
      return {
        ok: false,
        kind: "url",
        reason: "url_unreadable",
        message: `I could not read this link (${err instanceof Error ? err.message : String(err)}).`,
        retryHint: PASTE_OR_UPLOAD_HINT,
      };
    }
    const thin = isThinFetch(text);
    if (thin && opts?.thinIsFatal) {
      return {
        ok: false,
        kind: "url",
        reason: "thin_fetch",
        message: `Only ${text.trim().length} characters were readable from this page (it may be JavaScript-rendered).`,
        retryHint: "Paste the page text or upload a screenshot for better extraction.",
      };
    }
    const warnings = thin
      ? [
          `Only ${text.trim().length} characters were readable from the linked page (it may be JavaScript-rendered), so figures may be incomplete. Paste the page text or upload a screenshot for better extraction.`,
        ]
      : [];
    return { ok: true, kind: "url", text, label: label ?? hostLabel, url: source.url, warnings, thin };
  }

  // pdf → text extracted server-side (deterministic); image → OCR-transcribed by a vision model.
  const isPdf = source.kind === "pdf";
  const displayLabel = label ?? (isPdf ? "Uploaded PDF" : "Uploaded screenshot");
  let transcript: { text: string; model: string | null };
  try {
    transcript = await transcribeSourceToText(source);
  } catch (err) {
    return {
      ok: false,
      kind: source.kind,
      reason: isPdf ? "pdf_unreadable" : "image_unreadable",
      message: `I could not read this ${isPdf ? "PDF" : "image"} (${err instanceof Error ? err.message : String(err)}).`,
      retryHint: isPdf
        ? "Paste the text, or upload a clearer PDF or a screenshot."
        : "Paste the text, or upload a clearer screenshot.",
    };
  }
  const text = transcript.text.trim();
  // Refuse an empty read OR a read that is really an un-decoded base64/data blob — the
  // latter is what surfaced as scrambled base64 in the answer. Base64 must NEVER become
  // grounding text handed to the model.
  if (text === "" || looksLikeRawBlob(text)) {
    if (text !== "") {
      console.error(
        `[readSource] ${source.kind} transcript looks like a raw blob (len=${text.length}) — refusing to ground on it`,
      );
    }
    return {
      ok: false,
      kind: source.kind,
      reason: isPdf ? "pdf_unreadable" : "image_unreadable",
      message: `The ${isPdf ? "PDF" : "image"} produced no readable text.`,
      retryHint: isPdf
        ? "Paste the text, or upload a clearer PDF or a screenshot."
        : "Paste the text, or upload a clearer screenshot.",
    };
  }
  return {
    ok: true,
    kind: source.kind,
    text,
    label: displayLabel,
    warnings: [
      isPdf
        ? "Text was read directly from the uploaded PDF — confirm each figure against the original before acting."
        : "Figures were transcribed by AI from an uploaded screenshot — confirm each against the original before acting.",
    ],
    thin: false,
  };
}

/**
 * Read a PDF or screenshot into plain grounding text. A PDF is read deterministically via
 * server-side text extraction (no model call); an image is OCR-transcribed by the default
 * model (gpt-4o is vision-capable), transcribing ONLY what is printed (no inference).
 */
export async function transcribeSourceToText(
  source: { kind: "pdf"; fileUrl: string } | { kind: "image"; imageUrl: string },
): Promise<{ text: string; model: string | null }> {
  // PDF: read the embedded text ourselves (deterministic, storage-free, no LLM call).
  if (source.kind === "pdf") {
    const text = await extractPdfText(source.fileUrl);
    return { text, model: null };
  }

  // IMAGE: OCR-transcribe with the DEFAULT model. We do NOT pick a model from the provider's
  // catalogue — that risked selecting one that rejects image input in chat-completions (a
  // 400). invokeLLM's default (OPENAI_MODEL / gpt-4o) is vision-capable and reads a data URI.
  const instruction =
    "Transcribe ONLY the text and figures visibly printed in the attached image (a screenshot or photo of a quote board, fact sheet, or notice). Preserve numbers, labels, dates and units verbatim. Never infer a value that is not shown.";

  const userContent = [
    { type: "text", text: instruction },
    { type: "image_url", image_url: { url: source.imageUrl, detail: "high" as const } },
  ] as const;

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
    temperature: 0,
  });
  return { text: contentToText(res.choices?.[0]?.message?.content).trim(), model: res.model ?? null };
}

/* ── Stage 4, Step 4.2b-ii — AI SEARCH source resolution (CBK, MMF, bank, ────
 *          market_asset/REIT, market_asset/equity, market_asset/offshore_fund,
 *                                                          market_asset/sacco)
 *
 * When a manager asks a question with NO manual source attached and opts into
 * `allowSearch`, the caller (routers.ts) looks up an authoritative source via
 * `searchAuthoritativeSource()` (Step 4.2a) instead of answering from memory. A
 * found citation becomes an ORDINARY `url` source, handed to the EXACT SAME
 * `readSource()` / `runResearchQuestion` pipeline a manually-pasted URL would use
 * (including the Step 4.2b-i PDF-URL fix) — search only ever FINDS a source, it
 * never becomes the answer by itself.
 *
 * Deliberately scoped to CBK, MMF, bank, and market_asset/REIT + market_asset/equity
 * + market_asset/offshore_fund + market_asset/sacco (Stage 7e added mmf, Stage 7f
 * added bank; the market-asset search design's REIT slice added the first
 * market_asset case, equity the second, offshore_fund the third, sacco the fourth
 * and final one — every subtype `authoritativeSourcesFor("market_asset", ...)`
 * registers a route for is now enabled; ETF/property/pension/other still have NO
 * route at all and cannot be enabled without a Step-4.1-equivalent routing-table
 * change first). Unlike MMF/bank (no fixed domain at all), BOTH REIT's and equity's
 * primary source (NSE, `nse.co.ke`) IS a fixed domain — same safety tier as CBK —
 * but the UI still carries an explicit "verify the cited source" caveat per the
 * approved design. Offshore fund and SACCO are like MMF/bank, NOT like REIT/equity:
 * no fixed domain — `authoritativeSourcesFor("market_asset", "offshore_fund")` and
 * `authoritativeSourcesFor("market_asset", "sacco")` both deliberately leave
 * `domains: []` on their PRIMARY source, because the real source varies per fund
 * manager / per SACCO, same reasoning as `authoritativeSourcesFor("bank")` leaving
 * `domains: []` because the real source varies per bank (KCB, Equity, NCBA, Absa,
 * ...). SACCO carries the HIGHEST source-trust risk of the four market_asset
 * subtypes: thousands of small, thinly-indexed SACCOs raise real domain-trust /
 * impersonation risk that REIT/equity (one exchange) and even offshore funds
 * (larger, better-indexed managers) don't share to the same degree — the UI's SACCO
 * copy is deliberately the strongest-worded verify caveat of the four, and SACCO's
 * SASRA secondary route is a regulatory-status CROSS-CHECK only, never a source of
 * dividend/rebate figures (the copy must not imply otherwise). A found bank,
 * offshore-fund, or SACCO citation is real and grounded (the `no_citations`
 * guardrail in webSearch.ts still applies — an uncited answer is never treated as a
 * source), but it is NOT guaranteed to come from one known, pre-vetted domain the
 * way a CBK, REIT, or equity citation is. The UI copy for MMF, bank, offshore fund,
 * and SACCO must stay honest about that difference — see AskAI.tsx's Step 4.2b-iii
 * block.
 *
 * A search-found citation is stamped with `sourceKind: "url"` — NOT a new "search"
 * kind — because `source_kind` is a fixed-value MySQL ENUM on three tables
 * (research_tasks, research_messages, research_findings), and widening it would be
 * a schema migration this slice deliberately avoids. The "found by AI search"
 * provenance is instead carried in the existing free-text `sourceLabel` (see
 * `searchFoundLabel`), so it is visible on the task, the message, and every
 * finding, with zero schema change.
 */

/** Manual source always wins: search is only ever attempted when nothing was
 *  manually attached AND the manager explicitly opted in. */
export function shouldAttemptSearch(args: { hasManualSource: boolean; allowSearch: boolean }): boolean {
  return !args.hasManualSource && Boolean(args.allowSearch);
}

/** Human message for a search that failed to produce a grounded citation. */
export function searchFailureMessage(result: Extract<SearchSourceResult, { ok: false }>): string {
  switch (result.reason) {
    case "no_route":
      return "AI search has no authoritative source registered for this scope yet.";
    case "no_citations":
      return "AI search did not find a source it could cite, so there is nothing to ground an answer in.";
    case "search_failed":
      return `AI search could not complete (${result.message}).`;
  }
}

/** Human message when `allowSearch` was requested outside the scopes it supports. */
export const UNSUPPORTED_SEARCH_SCOPE_MESSAGE =
  'AI search is only available for the CBK, MMF, and bank-product scopes right now (or Market assets with Asset type = REIT, Equity, Offshore fund, or SACCO). Switch Focus to one of those, or attach a source manually.';

/** Human message when `allowSearch` was requested for market_asset but the manager's
 *  explicit subtype selection isn't one of the market-asset subtypes enabled
 *  (REIT, equity, offshore fund, or SACCO — the full set with a registered route).
 *  Distinct from `UNSUPPORTED_SEARCH_SCOPE_MESSAGE` because market_asset itself IS a
 *  supported scope now; it's the subtype gate that blocks here, which deserves its
 *  own clearer message. */
export const MARKET_ASSET_SEARCH_SUBTYPE_REQUIRED_MESSAGE =
  'AI search for market assets is only available when Asset type = REIT, Equity, Offshore fund, or SACCO right now. Select one of those, or attach a source manually.';

/** Market-asset subtypes AI search is enabled for — the market-asset search design's
 *  full staged rollout (REIT, then equity, then offshore fund, then SACCO). This is
 *  every subtype `authoritativeSourcesFor("market_asset", ...)` has a registered
 *  route for; ETF/property/pension/other have no route at all and cannot be enabled
 *  without a routing-table change first. Kept as one list so `resolveSearchSource`
 *  and its tests agree on exactly what's enabled without duplicating the check
 *  inline. */
const SEARCHABLE_MARKET_ASSET_SUBTYPES = ["reit", "equity", "offshore_fund", "sacco"] as const;

/** A display label that makes a search-found source visibly distinct from a
 *  manually-attached one, without inventing a new persisted source kind. */
export function searchFoundLabel(args: { sourceLabel: string; citationTitle: string }): string {
  const title = args.citationTitle.trim();
  const combined = title && title !== args.sourceLabel ? `${args.sourceLabel} — ${title}` : args.sourceLabel;
  return `AI search: ${combined}`.slice(0, 200);
}

/** The outcome of trying to resolve an `allowSearch` opt-in into a usable source. */
export type SearchSourceResolution =
  | { outcome: "found"; source: { kind: "url"; url: string }; label: string }
  | { outcome: "unsupported_scope"; message: string }
  /** Search failed and the manager did NOT pre-authorise an unsourced answer — the
   *  caller must stop, never silently fall back to general model memory. */
  | { outcome: "search_failed_blocked"; message: string }
  /** Search failed but the manager pre-authorised an unsourced answer — the caller
   *  proceeds exactly as it already does for "no source attached at all". */
  | { outcome: "search_failed_unsourced" };

/**
 * Resolve an `allowSearch` opt-in into a source — CBK, MMF, bank, and market_asset
 * (REIT, equity, offshore fund, or SACCO) — see the market-asset search design's
 * REIT, equity, offshore-fund, and SACCO slices (the full staged rollout). Callers
 * should only invoke this after confirming `shouldAttemptSearch(...)` — this
 * function does not re-check for a manual source, only the scope (and, for
 * market_asset, subtype) restriction.
 */
export async function resolveSearchSource(args: {
  scope: ResearchScope;
  question: string;
  allowUnsourced: boolean;
  /** The manager's EXPLICITLY selected market-asset subtype (never inferred).
   *  Ignored for every scope other than "market_asset". Only the subtypes in
   *  `SEARCHABLE_MARKET_ASSET_SUBTYPES` (reit, equity, offshore_fund, sacco) are
   *  enabled — any other value (or none) blocks with a distinct, clearer message
   *  than a genuinely unsupported scope. */
  marketAssetSubtype?: string | null;
  /** Injected for tests — defaults to the real Step 4.2a wrapper. */
  searchImpl?: typeof searchAuthoritativeSource;
}): Promise<SearchSourceResolution> {
  if (args.scope !== "cbk" && args.scope !== "mmf" && args.scope !== "bank" && args.scope !== "market_asset") {
    return { outcome: "unsupported_scope", message: UNSUPPORTED_SEARCH_SCOPE_MESSAGE };
  }
  if (
    args.scope === "market_asset" &&
    !(SEARCHABLE_MARKET_ASSET_SUBTYPES as readonly string[]).includes(args.marketAssetSubtype ?? "")
  ) {
    return { outcome: "unsupported_scope", message: MARKET_ASSET_SEARCH_SUBTYPE_REQUIRED_MESSAGE };
  }
  const search = args.searchImpl ?? searchAuthoritativeSource;
  const result = await search(
    args.scope === "market_asset"
      ? { catalogue: "market_asset", subtype: args.marketAssetSubtype, question: args.question }
      : { catalogue: args.scope, question: args.question },
  );
  if (!result.ok) {
    if (args.allowUnsourced) return { outcome: "search_failed_unsourced" };
    return { outcome: "search_failed_blocked", message: searchFailureMessage(result) };
  }
  const citation = result.citations[0];
  return {
    outcome: "found",
    source: { kind: "url", url: citation.url },
    label: searchFoundLabel({ sourceLabel: result.sourceLabel, citationTitle: citation.title }),
  };
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
  /**
   * Round 92 — durable STRUCTURED context from earlier in the SAME enquiry thread:
   * the findings already established (their values, source, triage status, and any
   * correction), not just prose. Feeding these lets a follow-up reuse prior facts,
   * respect the manager's corrections, and AVOID re-emitting an identical finding.
   * The engine renders them into a "WHAT YOU ALREADY ESTABLISHED" block and applies a
   * duplicate-suppression guard after parsing.
   */
  priorFindings?: PriorFindingContext[] | null;
  /**
   * Round 91 — a source that has ALREADY been read via `readSource()` (the single
   * choke point, run BEFORE this function so a read failure is classified distinctly).
   * When supplied AND ok:true, we ground on its text + carry its warnings + provenance
   * and DO NOT fetch/transcribe again. When supplied AND ok:false, the caller must have
   * already decided whether to proceed (Ask AI may, with a warning); we simply answer
   * WITHOUT grounding and record that it was not grounded in the failed source. When
   * omitted, the legacy self-read path below runs (kept for backward compatibility).
   */
  preRead?: SourceReadResult | null;
  /**
   * Round 102 — intake mode. When "extract", the manager explicitly wants
   * catalogue-ready structured findings even on a follow-up (overrides the
   * priorTurns.length === 0 gate). When "ask" or omitted, the legacy behaviour
   * applies (structured extraction only on the opening turn).
   */
  intakeMode?: "ask" | "extract" | null;
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

  // Round 91 — the derived source KIND + LABEL used for provenance stamping. Defined
  // here so both the pre-read and legacy paths feed the same fallback below.
  let sourceKind: SourceKind | null = args.preRead?.ok ? args.preRead.kind : source?.kind ?? null;
  let provenanceLabel: string | null =
    args.preRead?.ok ? args.preRead.label : args.sourceLabel && args.sourceLabel.trim() !== "" ? args.sourceLabel.trim() : null;

  if (args.preRead) {
    // A source was read ahead of time. Trust that outcome; never re-read here.
    if (args.preRead.ok) {
      const s = args.preRead;
      grounding = `\n\nGROUND YOUR FINDINGS ONLY IN THIS SOURCE (${s.label}${s.url ? ` — ${s.url}` : ""}); extract only what it states and do not fill from general knowledge:\n${s.text.slice(0, 40000)}`;
      groundingWarnings.push(...s.warnings);
    } else {
      // The source could not be read. The caller (Ask AI) chose to proceed anyway, so
      // we answer from general knowledge and say so LOUDLY on every finding + the note.
      groundingWarnings.push(
        `This answer was NOT grounded in the attached source (${args.preRead.message}) — it draws on general knowledge and must be verified before acting.`,
      );
      sourceKind = null;
      provenanceLabel = null;
    }
  } else if (source) {
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

  // Round 92 — render the DURABLE structured facts already established in this enquiry
  // (values, source, triage state, corrections) so the follow-up reuses them, respects
  // the manager's corrections, and does NOT re-emit an identical finding.
  const established = (args.priorFindings ?? []).filter((f) => f.status !== "dismissed").slice(0, 40);
  const establishedBlock = established.length
    ? "\n\nWHAT YOU ALREADY ESTABLISHED IN THIS ENQUIRY (durable facts — treat as known; do NOT re-emit a finding that merely repeats one of these unless a value has CHANGED; when the manager corrected a value, use the CORRECTED value and never revert to the old one):\n" +
      established
        .map((f, i) => {
          const figs = Object.entries(f.figures)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ");
          const src = f.sourceLabel ? ` [source: ${f.sourceLabel}${f.sourceUrl ? ` — ${f.sourceUrl}` : ""}${f.asOf ? `, as-of ${f.asOf}` : ""}]` : "";
          const corr = f.correction
            ? ` (manager CORRECTED ${f.correction.field}: ${f.correction.oldValue ?? "—"} → ${f.correction.newValue}${f.correction.reason ? `; reason: ${f.correction.reason}` : ""})`
            : "";
          const state = f.status === "drafted" ? " {drafted to review queue}" : f.status === "superseded" ? " {superseded by a later correction}" : "";
          return `${i + 1}. ${f.instrument}${f.assetClass ? ` (${f.assetClass})` : ""}: ${figs || "no figures"}${src}${corr}${state}`;
        })
        .join("\n")
    : "";

  // Round 97 — INSTRUMENT-AWARE EXTRACTION. When we have grounding text from a
  // readable source and this is NOT a follow-up (no prior turns), try the structured
  // per-catalogue extraction first. If it succeeds (source is classified and yields
  // findings), use those instead of the generic schema. Otherwise fall through.
  const groundingText = grounding.replace(/^\n\nGROUND YOUR FINDINGS[^:]*:\n/, "");
  let answer: string = "";
  let findings: ResearchFindingDraft[] = [];
  let usedModel: string | null = null;
  // Round 103 — EXTRACTION INTENT DETECTION. Server-side detection of extraction
  // intent from the question text, independent of the UI mode selector. This ensures
  // that follow-ups like "Use this source to add to the findings" trigger extraction
  // even when the UI is in "Ask" mode or the source is reused.
  const hasReadableSource = Boolean(grounding) && groundingText.length > 100;
  const intentForced = shouldForceExtraction(args.question, hasReadableSource);
  const canTryStructured = hasReadableSource && (
    priorTurns.length === 0 ||
    args.intakeMode === "extract" ||
    intentForced
  );
  let usedStructured = false;
  let extractionDiag: ExtractionDiagnostic | null = null;
  if (canTryStructured) {
    const structured = await tryInstrumentAwareExtraction(groundingText, args.question);
    if (structured && structured.findings.length > 0) {
      answer = structured.answer;
      findings = structured.findings;
      usedStructured = true;
    } else if (intentForced || args.intakeMode === "extract") {
      // Extraction was expected but produced nothing — build diagnostic
      const detectedClass = structured?.sourceClass ?? null;
      let reason: string;
      if (!structured) {
        reason = "Source could not be classified into any known instrument category.";
      } else if (structured.findings.length === 0) {
        reason = detectedClass
          ? `Source was classified as ${SOURCE_CLASS_LABELS[detectedClass] ?? detectedClass}, but no instrument rows could be extracted from the text.`
          : "Source was read but did not match any extraction schema.";
      } else {
        reason = "Unknown extraction failure.";
      }
      extractionDiag = {
        attempted: true,
        reason,
        sourceClass: detectedClass,
        charsRead: groundingText.length,
        forcedByIntent: intentForced,
      };
    }
  } else if (intentForced && !hasReadableSource) {
    // Intent detected but no readable source
    extractionDiag = {
      attempted: false,
      reason: "Extraction intent detected but no readable source was available.",
      sourceClass: null,
      charsRead: 0,
      forcedByIntent: true,
    };
  }
  if (!usedStructured) {
    const llmRes = await invokeLLM({
      messages: [
        { role: "system", content: RESEARCH_SYSTEM_PROMPT },
        ...priorTurns,
        { role: "user", content: `QUESTION: ${args.question}${scopeLine}${grounding}${establishedBlock}${followUpNote}` },
      ],
      temperature: 0,
      response_format: { type: "json_schema", json_schema: RESEARCH_SCHEMA },
    });
    usedModel = llmRes.model ?? null;
    const text = contentToText(llmRes.choices?.[0]?.message?.content);
    const parsed = parseResearchResponse(text);
    answer = parsed.answer;
    findings = parsed.findings;
  }

  // Round 90 — PROVENANCE FALLBACK. When a manager attached a real source but the
  // model forgot to echo it onto a finding, back-fill the finding's provenance from
  // the ACTUAL attached source (never inventing an as-of date). This stops a finding
  // extracted from a genuine upload/paste/URL from being mislabelled "no source" and
  // wrongly capped to a hint — and, because provenance now satisfies the gate's
  // `source` rule, its missing-fields list is recomputed to match.
  const fallbackLabel = ((): string | null => {
    // Round 91 — when the source was pre-read, its resolved label wins (and a failed
    // read intentionally produced a null provenanceLabel so we stamp nothing).
    if (provenanceLabel !== null || args.preRead) return provenanceLabel;
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
  const fallbackUrl =
    args.preRead?.ok && args.preRead.url
      ? args.preRead.url
      : source && source.kind === "url"
        ? source.url
        : null;

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
        assetClass: f.assetClass,
      }),
    };
  });

  // Round 91 — stamp the source KIND + read time onto every finding. checkedAt is set
  // whenever we had a readable source (pre-read ok, or the legacy self-read produced
  // grounding); it stays null when the answer was ungrounded.
  const grounded = Boolean(grounding);
  const checkedAt = grounded ? Date.now() : null;
  const kindStamped = stamped.map((f) => ({
    ...f,
    sourceKind: f.sourceKind ?? (grounded ? sourceKind : null),
    checkedAt: f.checkedAt ?? checkedAt,
  }));

  // Attach any grounding warnings to every finding so the manager sees the caveat.
  const withWarnings = groundingWarnings.length
    ? kindStamped.map((f) => ({ ...f, warnings: [...f.warnings, ...groundingWarnings] }))
    : kindStamped;

  // Round 103 — UNSOURCED FINDING RESTRICTION. When no readable source was attached
  // and the answer came from general knowledge, findings should not be one-click
  // draftable. Mark them as low-trust hints so the UI can warn before drafting.
  const trustTagged = grounded
    ? withWarnings
    : withWarnings.map((f) => ({
        ...f,
        confidence: Math.min(f.confidence, 0.3),
        warnings: [
          ...f.warnings,
          "This finding is based on general knowledge (no source attached). Verify with a primary source before drafting to the catalogue.",
        ],
        extractedFields: { ...f.extractedFields, _unsourced: "true" },
      }));

  // Round 92 — DUPLICATE SUPPRESSION. A follow-up must not spawn a fresh finding that
  // merely restates something already established in this enquiry with the SAME values.
  // We only drop a candidate when an earlier (non-dismissed) finding for the same
  // instrument carries an identical figures bag; if ANY value differs (or a new figure
  // appears), the finding is kept so the change is captured for triage.
  const deduped = suppressDuplicateFindings(trustTagged, established);

  // Round 103 — surface the detected sourceClass so the frontend can show the panel.
  // Also surface it from the diagnostic when extraction was attempted but yielded nothing.
  let detectedSourceClass: SourceClass | null = extractionDiag?.sourceClass ?? null;
  if (usedStructured && grounding && !detectedSourceClass) {
    // The structured path already classified; re-derive from the first finding's _extendedFields.
    try {
      const ext = deduped[0]?.extractedFields?._extendedFields;
      if (ext) {
        const parsed = typeof ext === "string" ? JSON.parse(ext) : ext;
        if (parsed?.sourceClass && isSourceClass(parsed.sourceClass)) {
          detectedSourceClass = parsed.sourceClass;
        }
      }
    } catch { /* ignore */ }
  }
  return { answer, findings: deduped, model: usedModel, sourceClass: detectedSourceClass, extractionDiagnostic: extractionDiag };
}

/** Case/space-insensitive key for matching an instrument across turns. */
function instrumentKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Normalise a figures bag to a comparable, order-independent shape (verbatim values,
 *  trimmed; keys lower-cased). Used to decide whether a follow-up finding actually
 *  CHANGED anything versus a prior established finding. */
function normaliseFigures(figures: Record<string, string>): string {
  const entries = Object.entries(figures)
    .filter(([, v]) => v != null && String(v).trim() !== "")
    .map(([k, v]) => [k.trim().toLowerCase(), String(v).trim()] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return JSON.stringify(entries);
}

/**
 * Round 92 — drop candidate findings that are exact restatements (same instrument +
 * identical figures) of a still-valid prior finding. A candidate whose values differ
 * from every prior finding for that instrument is always kept.
 */
export function suppressDuplicateFindings<T extends { instrumentName: string; extractedFields: Record<string, string> }>(
  candidates: T[],
  priorFindings: PriorFindingContext[],
): T[] {
  if (priorFindings.length === 0) return candidates;
  const priorByInstrument = new Map<string, Set<string>>();
  for (const p of priorFindings) {
    if (p.status === "dismissed") continue;
    const key = instrumentKey(p.instrument);
    const set = priorByInstrument.get(key) ?? new Set<string>();
    set.add(normaliseFigures(p.figures));
    priorByInstrument.set(key, set);
  }
  return candidates.filter((c) => {
    const priorSigs = priorByInstrument.get(instrumentKey(c.instrumentName));
    if (!priorSigs) return true; // never seen this instrument before → keep
    // Keep only if the values are NOT an exact repeat of a prior established finding.
    return !priorSigs.has(normaliseFigures(c.extractedFields));
  });
}

/* ══════════════════════════════════════════════════════════════════════════════
 * Round 97 — INSTRUMENT-AWARE EXTRACTION ENGINE
 *
 * When Ask AI is given a source (PDF, URL, text, image), the pipeline now:
 *   1. classifySource() — fast LLM call to detect the source class
 *   2. If classified to a known catalogue → runStructuredExtraction() with a
 *      per-catalogue JSON schema that extracts the FULL profile fields
 *   3. If "unknown" → falls through to the generic RESEARCH_SCHEMA (current behavior)
 *
 * The structured extraction returns an ARRAY of instruments (multi-instrument
 * splitting for prospectuses with multiple bonds). Each is mapped back to the
 * standard ResearchFindingDraft shape so the rest of the pipeline (provenance
 * fallback, kind stamp, dedup, approval gate) is unchanged.
 *
 * Missing-field handling: the prompt instructs the model to use "missing_from_source"
 * for any field it cannot find. Post-processing enforces NEVER_INVENT_FIELDS.
 * ══════════════════════════════════════════════════════════════════════════════ */

/* ── Source Classification ─────────────────────────────────────────────────── */

const CLASSIFICATION_SCHEMA = {
  name: "source_classification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      sourceClass: {
        type: "string",
        description: `One of: ${SOURCE_CLASSES.join(", ")}`,
      },
      reasoning: {
        type: "string",
        description: "One sentence explaining why this classification was chosen.",
      },
    },
    required: ["sourceClass", "reasoning"],
  },
} as const;

/**
 * Fast LLM call to classify a source document into one of the known instrument
 * source classes. Uses the first ~6000 chars of the source text for speed.
 * Returns "unknown" if the model is unsure or the source doesn't match any class.
 */
export async function classifySource(sourceText: string): Promise<{ sourceClass: SourceClass; reasoning: string }> {
  const snippet = sourceText.slice(0, 6000);
  const res = await invokeLLM({
    messages: [
      {
        role: "system",
        content: `You are a document classifier for a Kenyan investment tracker. Given the beginning of a source document, classify it into exactly ONE of these categories:\n${SOURCE_CLASSES.map((c) => `- ${c}: ${SOURCE_CLASS_LABELS[c]}`).join("\n")}\n\nChoose "unknown" only if the document genuinely does not fit any other category. Be decisive.`,
      },
      {
        role: "user",
        content: `Classify this source document:\n\n${snippet}`,
      },
    ],
    temperature: 0,
    response_format: { type: "json_schema", json_schema: CLASSIFICATION_SCHEMA },
  });
  const text = contentToText(res.choices?.[0]?.message?.content);
  const parsed = parseJsonLoose(text) as { sourceClass?: string; reasoning?: string } | null;
  const sc = parsed?.sourceClass?.trim() ?? "unknown";
  return {
    sourceClass: isSourceClass(sc) ? sc : "unknown",
    reasoning: parsed?.reasoning ?? "",
  };
}

/* ── Per-Catalogue Extraction Schemas ──────────────────────────────────────── */

/** The extraction prompt preamble shared by all structured extractions. */
const STRUCTURED_EXTRACTION_PREAMBLE = `You are a financial-data extraction assistant for a Kenyan investment tracker.
Extract ONLY what is explicitly printed in the source document. For any field you cannot find in the source, set its value to "missing_from_source" — never guess, infer, or invent.
Do NOT recommend buying, selling, or holding. Do NOT rank instruments. Do NOT say which is "best".
Return one entry per distinct instrument found in the source.`;

/** CBK Bond Prospectus / Reopening extraction schema. */
const CBK_BOND_EXTRACTION_SCHEMA = {
  name: "cbk_bond_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string", description: "Brief summary of what the prospectus contains." },
      sharedAuctionFields: {
        type: "object",
        additionalProperties: false,
        description: "Fields that apply to ALL bonds in this prospectus (auction-level).",
        properties: {
          salePeriodStart: { type: ["string", "null"], description: "ISO date or descriptive string" },
          salePeriodEnd: { type: ["string", "null"] },
          bidSubmissionDeadline: { type: ["string", "null"] },
          auctionDate: { type: ["string", "null"] },
          settlementDate: { type: ["string", "null"] },
          purpose: { type: ["string", "null"] },
          nonCompetitiveMin: { type: ["string", "null"], description: "KES amount or 'missing_from_source'" },
          nonCompetitiveMax: { type: ["string", "null"] },
          competitiveMin: { type: ["string", "null"] },
          secondaryTradingRule: { type: ["string", "null"] },
          rediscountingRule: { type: ["string", "null"] },
          reopeningFlag: { type: ["string", "null"], description: "'true'/'false' or 'missing_from_source'" },
          liquidityEligibility: { type: ["string", "null"] },
        },
        required: ["salePeriodStart", "salePeriodEnd", "bidSubmissionDeadline", "auctionDate", "settlementDate", "purpose", "nonCompetitiveMin", "nonCompetitiveMax", "competitiveMin", "secondaryTradingRule", "rediscountingRule", "reopeningFlag", "liquidityEligibility"],
      },
      instruments: {
        type: "array",
        description: "One entry per distinct bond/security in the prospectus.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            instrumentName: { type: "string", description: "e.g. 'FXD1/2022/010'" },
            issueNumber: { type: ["string", "null"] },
            securityType: { type: ["string", "null"], description: "e.g. 'fxd', 'ifb', 'zero_coupon'" },
            isin: { type: ["string", "null"] },
            tenorLabel: { type: ["string", "null"], description: "e.g. '10 years'" },
            tenorMonths: { type: ["number", "null"] },
            couponRate: { type: ["string", "null"], description: "% p.a. or 'missing_from_source'" },
            withholdingTaxRate: { type: ["string", "null"], description: "% or 'missing_from_source'" },
            maturityDate: { type: ["string", "null"] },
            amountOnOffer: { type: ["string", "null"], description: "KES amount or 'missing_from_source'" },
            cleanPrice: { type: ["string", "null"], description: "Per KES 100 face or 'missing_from_source'" },
            accruedInterestPer100: { type: ["string", "null"] },
            dirtyPrice: { type: ["string", "null"] },
            couponPaymentDates: { type: ["array", "null"], items: { type: "string" }, description: "Array of date strings or null" },
            cleanPriceTable: { type: ["array", "null"], items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, price: { type: "string" } }, required: ["label", "price"] } },
            rawExcerpt: { type: ["string", "null"] },
            warnings: { type: "array", items: { type: "string" } },
            confidence: { type: ["number", "null"] },
            proposalType: { type: "string", description: "'create' if new, 'update' if existing row changed, 'stale' if current row not in source" },
            matchedCurrentRow: { type: ["string", "null"], description: "Name/issue number of the matched current catalogue row, or null for new" },
            changedFields: { type: "array", items: { type: "string" }, description: "List of field names that differ from current row" },
            currentValues: { type: "array", items: { type: "object", additionalProperties: false, properties: { field: { type: "string" }, value: { type: "string" } }, required: ["field", "value"] }, description: "Current values for each changed field" },
          },
          required: ["instrumentName", "issueNumber", "securityType", "isin", "tenorLabel", "tenorMonths", "couponRate", "withholdingTaxRate", "maturityDate", "amountOnOffer", "cleanPrice", "accruedInterestPer100", "dirtyPrice", "couponPaymentDates", "cleanPriceTable", "rawExcerpt", "warnings", "confidence", "proposalType", "matchedCurrentRow", "changedFields", "currentValues"],
        },
      },
    },
    required: ["answer", "sharedAuctionFields", "instruments"],
  },
} as const;

/** CBK T-bill auction / result extraction schema. */
const CBK_TBILL_EXTRACTION_SCHEMA = {
  name: "cbk_tbill_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      auctionDate: { type: ["string", "null"] },
      valueDate: { type: ["string", "null"] },
      // Stage 10b-2 — the bid submission / application deadline, mirroring
      // the bond schema's sharedAuctionFields.bidSubmissionDeadline (same
      // established CBK field, different schema shape since T-bills don't
      // have a sharedAuctionFields wrapper). Before this, a T-bill source's
      // stated application deadline had nowhere to go.
      applicationDeadline: { type: ["string", "null"], description: "Bid submission / application deadline, if stated" },
      instruments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            instrumentName: { type: "string", description: "e.g. '91-Day Treasury Bill'" },
            issueNumber: { type: ["string", "null"] },
            tenorDays: { type: ["number", "null"], description: "91, 182, or 364" },
            // Stage 10b-2 — explicit securityType so a source that names its
            // own type verbatim is captured directly, not left entirely to
            // applyCbkRuleFill's tenor/keyword convention-based guess.
            securityType: { type: ["string", "null"], description: "e.g. 'treasury_bill'" },
            yieldPct: { type: ["string", "null"], description: "Annualised yield %" },
            prevAvgRate: { type: ["string", "null"] },
            amountOnOffer: { type: ["string", "null"] },
            amountReceived: { type: ["string", "null"] },
            amountAccepted: { type: ["string", "null"] },
            weightedAvgRate: { type: ["string", "null"] },
            // Stage 10b-2 — established CBK fields the T-bill schema never
            // captured: a source's stated tax treatment / tax-exempt flag /
            // maturity date / minimum investment were previously discarded
            // (falling back entirely to applyCbkRuleFill's convention-based
            // fill, which never sets a literal maturityDate for a T-bill at
            // all — only the generic maturityRule text).
            whtRule: { type: ["string", "null"], description: "Tax treatment description, e.g. '15% withholding tax on the discount'" },
            taxExempt: { type: ["string", "null"], description: "'true' or 'false'" },
            maturityDate: { type: ["string", "null"], description: "The bill's redemption date, if stated" },
            minInvestment: { type: ["string", "null"], description: "KES minimum (non-competitive) bid amount" },
            rawExcerpt: { type: ["string", "null"] },
            warnings: { type: "array", items: { type: "string" } },
            confidence: { type: ["number", "null"] },
            proposalType: { type: "string", description: "'create' if new, 'update' if existing row changed, 'stale' if current row not in source" },
            matchedCurrentRow: { type: ["string", "null"], description: "Name of the matched current catalogue row, or null for new" },
            changedFields: { type: "array", items: { type: "string" }, description: "List of field names that differ from current row" },
            currentValues: { type: "array", items: { type: "object", additionalProperties: false, properties: { field: { type: "string" }, value: { type: "string" } }, required: ["field", "value"] }, description: "Current values for each changed field" },
          },
          required: ["instrumentName", "issueNumber", "tenorDays", "securityType", "yieldPct", "prevAvgRate", "amountOnOffer", "amountReceived", "amountAccepted", "weightedAvgRate", "whtRule", "taxExempt", "maturityDate", "minInvestment", "rawExcerpt", "warnings", "confidence", "proposalType", "matchedCurrentRow", "changedFields", "currentValues"],
        },
      },
    },
    required: ["answer", "auctionDate", "valueDate", "applicationDeadline", "instruments"],
  },
} as const;

/** MMF factsheet / benchmark extraction schema. */
const MMF_EXTRACTION_SCHEMA = {
  name: "mmf_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      benchmarkDate: { type: ["string", "null"], description: "As-of date for the benchmark/factsheet" },
      instruments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            instrumentName: { type: "string", description: "Fund name" },
            fundManager: { type: ["string", "null"] },
            effectiveAnnualRate: { type: ["string", "null"], description: "EAR % net of fees" },
            grossYield: { type: ["string", "null"], description: "Gross/quoted yield %" },
            managementFee: { type: ["string", "null"], description: "Annual fee %" },
            minimumInvestment: { type: ["string", "null"], description: "KES amount" },
            aum: { type: ["string", "null"], description: "KES millions" },
            dayCountBasis: { type: ["string", "null"] },
            creditingFrequency: { type: ["string", "null"] },
            whtRate: { type: ["string", "null"] },
            withdrawalNoticePeriod: { type: ["string", "null"] },
            rawExcerpt: { type: ["string", "null"] },
            warnings: { type: "array", items: { type: "string" } },
            confidence: { type: ["number", "null"] },
            proposalType: { type: "string", description: "'create' if new, 'update' if existing row changed, 'stale' if current row not in source" },
            matchedCurrentRow: { type: ["string", "null"], description: "Name of the matched current catalogue row, or null for new" },
            changedFields: { type: "array", items: { type: "string" }, description: "List of field names that differ from current row" },
            currentValues: { type: "array", items: { type: "object", additionalProperties: false, properties: { field: { type: "string" }, value: { type: "string" } }, required: ["field", "value"] }, description: "Current values for each changed field" },
          },
          required: ["instrumentName", "fundManager", "effectiveAnnualRate", "grossYield", "managementFee", "minimumInvestment", "aum", "dayCountBasis", "creditingFrequency", "whtRate", "withdrawalNoticePeriod", "rawExcerpt", "warnings", "confidence", "proposalType", "matchedCurrentRow", "changedFields", "currentValues"],
        },
      },
    },
    required: ["answer", "benchmarkDate", "instruments"],
  },
} as const;

/** Bank product page / rate card extraction schema. */
const BANK_EXTRACTION_SCHEMA = {
  name: "bank_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      // Stage 10b-1b — a single as-of / effective date for the whole source
      // (e.g. a rate card's "As of: 17 July 2026"), mirroring MMF_EXTRACTION_
      // SCHEMA's benchmarkDate. Bank had no equivalent field at all before
      // this, so a source-stated as-of date was never captured anywhere —
      // every bank finding's sourceAsOf fell through to null regardless of
      // what the source said.
      asOfDate: { type: ["string", "null"], description: "As-of / effective date for the rates and terms in this source, if stated, e.g. 'As of: 17 July 2026'" },
      instruments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            instrumentName: { type: "string", description: "Bank + product name" },
            bankName: { type: ["string", "null"] },
            // Stage 10b-1b — the product's own distinguishing name/label
            // (e.g. "90-Day Fixed Deposit"), distinct from bankName and from
            // instrumentName (which combines the two for display). Before
            // this field existed, a source's "Product name: ..." line had
            // nowhere to go — instrumentName is metadata, dropped before it
            // ever reaches the figures bag.
            productName: { type: ["string", "null"], description: "The product's own name, distinct from the bank name, e.g. '90-Day Fixed Deposit'" },
            productType: { type: ["string", "null"], description: "call_deposit, fixed_deposit, ordinary_savings, target_goal_savings, tiered_high_yield_savings" },
            indicativeRate: { type: ["string", "null"], description: "% p.a." },
            rateType: { type: ["string", "null"], description: "indicative, negotiated, confirmed" },
            minimumAmount: { type: ["string", "null"], description: "KES" },
            tenor: { type: ["string", "null"] },
            noticePeriod: { type: ["string", "null"] },
            payoutFrequency: { type: ["string", "null"] },
            earlyWithdrawalPenalty: { type: ["string", "null"] },
            // Stage 10b-1b — established Bank contract fields with nowhere to
            // land in the schema before this: a source's "Fees / charges: ..."
            // and "Access speed: ..." lines were simply never extracted.
            feesCharges: { type: ["string", "null"], description: "Fees or charges, e.g. a monthly maintenance fee, or 'no fee' if the source says so" },
            accessSpeed: { type: ["string", "null"], description: "How quickly funds become available/withdrawable, e.g. 'available at maturity within 1 business day'" },
            negotiable: { type: ["string", "null"], description: "'true' or 'false'" },
            whtRate: { type: ["string", "null"] },
            rateSchedule: { type: ["string", "null"], description: "Verbatim tiered savings balance-band/rate schedule, or 'missing_from_source'" },
            rawExcerpt: { type: ["string", "null"] },
            warnings: { type: "array", items: { type: "string" } },
            confidence: { type: ["number", "null"] },
            proposalType: { type: "string", description: "'create' if new, 'update' if existing row changed, 'stale' if current row not in source" },
            matchedCurrentRow: { type: ["string", "null"], description: "Name of the matched current catalogue row, or null for new" },
            changedFields: { type: "array", items: { type: "string" }, description: "List of field names that differ from current row" },
            currentValues: { type: "array", items: { type: "object", additionalProperties: false, properties: { field: { type: "string" }, value: { type: "string" } }, required: ["field", "value"] }, description: "Current values for each changed field" },
          },
          required: ["instrumentName", "bankName", "productName", "productType", "indicativeRate", "rateType", "minimumAmount", "tenor", "noticePeriod", "payoutFrequency", "earlyWithdrawalPenalty", "feesCharges", "accessSpeed", "negotiable", "whtRate", "rateSchedule", "rawExcerpt", "warnings", "confidence", "proposalType", "matchedCurrentRow", "changedFields", "currentValues"],
        },
      },
    },
    required: ["answer", "asOfDate", "instruments"],
  },
} as const;

/** Market asset extraction schema. */
const MARKET_ASSET_EXTRACTION_SCHEMA = {
  name: "market_asset_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      answer: { type: "string" },
      instruments: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            instrumentName: { type: "string" },
            assetType: { type: ["string", "null"], description: "equity, reit, etf, offshore_fund, property, sacco, pension, other" },
            ticker: { type: ["string", "null"] },
            exchange: { type: ["string", "null"] },
            marketPrice: { type: ["string", "null"] },
            nav: { type: ["string", "null"] },
            dividendYield: { type: ["string", "null"] },
            distributionYield: { type: ["string", "null"] },
            trailingReturn: { type: ["string", "null"] },
            fee: { type: ["string", "null"] },
            shareCapitalDividendRate: { type: ["string", "null"], description: "SACCO share-capital dividend rate, % p.a." },
            depositRebateRate: { type: ["string", "null"], description: "SACCO deposit rebate / deposit interest rate, % p.a." },
            minimumShareCapital: { type: ["string", "null"], description: "Minimum SACCO share capital amount, usually KES" },
            minimumMonthlyDeposit: { type: ["string", "null"], description: "Minimum SACCO monthly deposit / contribution amount, usually KES" },
            regulatoryStatus: { type: ["string", "null"], description: "SASRA-regulated / regulatory status, verbatim from source" },
            withdrawalTerms: { type: ["string", "null"], description: "SACCO withdrawal, exit, or liquidity terms" },
            currency: { type: ["string", "null"] },
            rawExcerpt: { type: ["string", "null"] },
            warnings: { type: "array", items: { type: "string" } },
            confidence: { type: ["number", "null"] },
            proposalType: { type: "string", description: "'create' if new, 'update' if existing row changed, 'stale' if current row not in source" },
            matchedCurrentRow: { type: ["string", "null"], description: "Name of the matched current catalogue row, or null for new" },
            changedFields: { type: "array", items: { type: "string" }, description: "List of field names that differ from current row" },
            currentValues: { type: "array", items: { type: "object", additionalProperties: false, properties: { field: { type: "string" }, value: { type: "string" } }, required: ["field", "value"] }, description: "Current values for each changed field" },
          },
          required: ["instrumentName", "assetType", "ticker", "exchange", "marketPrice", "nav", "dividendYield", "distributionYield", "trailingReturn", "fee", "shareCapitalDividendRate", "depositRebateRate", "minimumShareCapital", "minimumMonthlyDeposit", "regulatoryStatus", "withdrawalTerms", "currency", "rawExcerpt", "warnings", "confidence", "proposalType", "matchedCurrentRow", "changedFields", "currentValues"],
        },
      },
    },
    required: ["answer", "instruments"],
  },
} as const;

/* ── Schema Selection ──────────────────────────────────────────────────────── */

/** Map a detected source class to its extraction schema + prompt, or null for generic. */
function extractionSchemaForClass(sc: SourceClass): { schema: object; prompt: string } | null {
  switch (sc) {
    case "cbk_bond_prospectus":
    case "cbk_bond_reopening":
      return {
        schema: CBK_BOND_EXTRACTION_SCHEMA,
        prompt: `${STRUCTURED_EXTRACTION_PREAMBLE}\n\nThis is a CBK BOND PROSPECTUS or REOPENING notice. Extract every distinct bond/security listed.\nFor each bond, extract: issue number, security type, ISIN, tenor, coupon rate, WHT rate, maturity date, amount on offer, clean price, accrued interest per KES 100, dirty price, coupon payment dates, and a clean price table if present.\nShared auction-level fields (sale period, bid deadline, auction date, settlement date, purpose, bid minimums, secondary trading rule, rediscounting rule, reopening flag, liquidity eligibility) apply to ALL bonds — extract them once.\n\nCRITICAL: Do NOT invent issue numbers, coupon rates, maturity dates, WHT rates, clean prices, accrued interest, or auction dates. If a field is not printed in the document, set it to "missing_from_source".`,
      };
    case "cbk_tbill_auction":
    case "cbk_tbill_auction_result":
      return {
        schema: CBK_TBILL_EXTRACTION_SCHEMA,
        prompt: `${STRUCTURED_EXTRACTION_PREAMBLE}\n\nThis is a CBK TREASURY BILL auction notice or result. Extract one entry per tenor (91-day, 182-day, 364-day) that appears.\nFor each, extract: issue number, SECURITY TYPE (e.g. "treasury_bill"), tenor in days, annualised yield %, previous average rate, amount on offer/received/accepted, weighted average rate, TAX TREATMENT (e.g. "15% withholding tax on the discount"), whether TAX-EXEMPT ("true"/"false"), MATURITY DATE (the bill's redemption date, if stated), and MINIMUM INVESTMENT (KES minimum non-competitive bid amount).\nIf the source states an APPLICATION or BID SUBMISSION DEADLINE, extract it as applicationDeadline at the top level, alongside auctionDate and valueDate.\n\nCRITICAL: Do NOT invent issue numbers or rates. If a field is not printed, set it to "missing_from_source".`,
      };
    case "mmf_factsheet":
    case "mmf_benchmark":
      return {
        schema: MMF_EXTRACTION_SCHEMA,
        prompt: `${STRUCTURED_EXTRACTION_PREAMBLE}\n\nThis is an MMF FACTSHEET or BENCHMARK table. Extract ONE ENTRY PER MONEY MARKET FUND mentioned — extract ALL funds in the source, up to 50 entries. Do NOT stop at a few; if the source lists 30 funds, return 30 entries.\nFor each, extract: fund name, fund manager, effective annual rate (EAR), gross yield, management fee, minimum investment, AUM, day-count basis, crediting frequency, WHT rate, and withdrawal notice period.\nEAR and gross yield are DIFFERENT numbers — keep both as the source prints them.\nFor benchmark tables: preserve the fund name exactly as printed (including the manager’s name if part of the fund name). If the table has a date header, use it as benchmarkDate.\n\nIf a field is not printed, set it to "missing_from_source".`,
      };
    case "bank_product_page":
    case "bank_rate_card":
      return {
        schema: BANK_EXTRACTION_SCHEMA,
        prompt: `${STRUCTURED_EXTRACTION_PREAMBLE}\n\nThis is a BANK PRODUCT PAGE or RATE CARD. Extract one entry per distinct product (call deposit, fixed deposit, savings account).\nFor each, extract: bank name, PRODUCT NAME (the product's own distinguishing name/label, e.g. "90-Day Fixed Deposit" — distinct from the bank name), product type, indicative rate, rate type, minimum amount, tenor, notice period, payout frequency, early withdrawal penalty, FEES / CHARGES (e.g. a monthly maintenance fee, or "no fee" if the source says so), ACCESS SPEED (how quickly funds become available/withdrawable, e.g. "at maturity within 1 business day"), whether negotiable, and WHT rate. For tiered savings products, also extract the full rate schedule / balance bands verbatim.\nIf the source states a single AS-OF or EFFECTIVE date for these rates and terms (e.g. "As of: 17 July 2026"), extract it as asOfDate at the top level, alongside the products.\nBank rates are typically INDICATIVE and quoted GROSS of the 15% WHT — note this in warnings.\n\nIf a field is not printed, set it to "missing_from_source".`,
      };
    case "market_asset_factsheet":
    case "market_asset_price":
      return {
        schema: MARKET_ASSET_EXTRACTION_SCHEMA,
        prompt: `${STRUCTURED_EXTRACTION_PREAMBLE}\n\nThis is a MARKET ASSET factsheet or price board. Extract one entry per distinct instrument (equity, REIT, ETF, offshore fund, SACCO).\nFor each, extract: asset type, ticker, exchange, market price, NAV, dividend yield, distribution yield, trailing 12-month return, expense ratio/fee, and currency. For SACCO entries, also extract the share-capital dividend rate, deposit rebate / deposit interest rate, minimum share capital, minimum monthly deposit / contribution, SASRA-regulated or other regulatory status, and withdrawal / liquidity terms.\n\nIf a field is not printed, set it to "missing_from_source".`,
      };
    case "unknown":
      return null;
  }
}

/* ── Structured Extraction Runner ──────────────────────────────────────────── */

/**
 * Run the per-catalogue structured extraction. Returns an answer + an array of
 * raw instrument objects (not yet normalised to ResearchFindingDraft).
 */
async function runStructuredExtraction(
  sourceClass: SourceClass,
  sourceText: string,
  question: string,
): Promise<{ answer: string; rawInstruments: Record<string, unknown>[]; sharedFields?: Record<string, unknown> }> {
  const config = extractionSchemaForClass(sourceClass);
  if (!config) return { answer: "", rawInstruments: [] };

  const res = await invokeLLM({
    messages: [
      { role: "system", content: config.prompt },
      {
        role: "user",
        content: `MANAGER'S QUESTION: ${question}\n\nSOURCE DOCUMENT:\n${sourceText.slice(0, 40000)}`,
      },
    ],
    temperature: 0,
    response_format: { type: "json_schema", json_schema: config.schema as unknown as { name: string; schema: Record<string, unknown>; strict?: boolean } },
  });

  const text = contentToText(res.choices?.[0]?.message?.content);
  const parsed = parseJsonLoose(text) as Record<string, unknown> | null;
  if (!parsed) return { answer: "", rawInstruments: [] };

  const answer = typeof parsed.answer === "string" ? parsed.answer : "";
  const instruments = Array.isArray(parsed.instruments) ? parsed.instruments : [];

  // Collect shared fields (CBK bond prospectus has sharedAuctionFields)
  const sharedFields: Record<string, unknown> = {};
  if (parsed.sharedAuctionFields && typeof parsed.sharedAuctionFields === "object") {
    Object.assign(sharedFields, parsed.sharedAuctionFields);
  }
  // T-bill auction date/value date/application deadline
  if (parsed.auctionDate) sharedFields.auctionDate = parsed.auctionDate;
  if (parsed.valueDate) sharedFields.valueDate = parsed.valueDate;
  if (parsed.applicationDeadline) sharedFields.applicationDeadline = parsed.applicationDeadline;
  // MMF benchmark date
  if (parsed.benchmarkDate) sharedFields.benchmarkDate = parsed.benchmarkDate;
  // Stage 10b-1b — Bank source-wide as-of date (BANK_EXTRACTION_SCHEMA.asOfDate)
  if (parsed.asOfDate) sharedFields.asOfDate = parsed.asOfDate;

  return { answer, rawInstruments: instruments as Record<string, unknown>[], sharedFields };
}

/* ── Mapping Structured Results to ResearchFindingDraft ────────────────────── */

/** Map a source class to the target reference catalogue. */
function catalogueForSourceClass(sc: SourceClass): ReferenceCatalogue {
  switch (sc) {
    case "cbk_bond_prospectus":
    case "cbk_bond_reopening":
    case "cbk_tbill_auction":
    case "cbk_tbill_auction_result":
      return "cbk";
    case "mmf_factsheet":
    case "mmf_benchmark":
      return "mmf";
    case "bank_product_page":
    case "bank_rate_card":
      return "bank";
    case "market_asset_factsheet":
    case "market_asset_price":
      return "market_asset";
    case "unknown":
      return "cbk"; // fallback, shouldn't be reached
  }
}

/**
 * Stage 3b.2 — map a market asset's raw extracted `assetType` (equity, reit, etf,
 * offshore_fund, property, sacco, pension, other — per MARKET_ASSET_EXTRACTION_SCHEMA;
 * a free string, not a hard enum, so the model's wording can vary) to the CANONICAL
 * AssetClass taxonomy. Only "equity", "reit" and "offshore_fund" have a DEDICATED
 * class today, and those three are mapped directly ONLY when the source stated them
 * unambiguously — never guessed onto a lookalike:
 *   - etf and property BOTH fall to "alt", NOT to offshore_fund/reit, because those
 *     classes actively DRIVE downstream behaviour that would be actively WRONG for a
 *     mismatched instrument, not merely imprecise:
 *       · offshore_fund is fxExposed:true, which assetGuardIssues() (enforced at
 *         holding-creation time, shared/modeling.ts → server/routers.ts) REJECTS
 *         unless the currency is non-KES with a positive FX rate — a locally-listed,
 *         KES-denominated ETF would be blocked or forced to fabricate FX data.
 *       · reit's distribution tax path (shared/assetTax.ts taxFor()) cites Kenya's
 *         SPECIFIC REIT trust-level exemption (ITA s.20) — applying that citation to
 *         a property product that isn't legally a registered REIT is a wrong tax/
 *         legal claim, not just an imprecise label.
 *   - sacco, pension, other → alt (no dedicated class; the SAME fallback the
 *     GENERIC/non-structured extraction path already uses via normaliseAssetClass).
 * "alt" makes NO claim (no tax citation, no FX requirement, no assumed liquidity),
 * so it is the conservative choice whenever the source's own instrument type isn't
 * one of the three classes this app actually models distinctly.
 * Falls back to "equity" — the PRE-EXISTING default — for anything missing, the
 * "missing_from_source" sentinel, or genuinely unrecognised, so behaviour for an
 * ambiguous instrument is unchanged from before this fix.
 */
function assetClassForMarketAssetType(assetType: unknown): AssetClass {
  if (typeof assetType !== "string") return "equity";
  switch (assetType.trim().toLowerCase()) {
    case "equity":
      return "equity";
    case "reit":
      return "reit";
    case "offshore_fund":
      return "offshore_fund";
    case "etf":
    case "property":
    case "sacco":
    case "pension":
    case "other":
      return "alt";
    default:
      return "equity";
  }
}

/** Map a source class to a canonical AssetClass code. `marketAssetType` is the raw
 *  `assetType` figure a market-asset extraction produced (ignored for every other
 *  source class), so a REIT/offshore-fund/sacco is no longer flattened to "equity". */
function assetClassForSourceClass(sc: SourceClass, marketAssetType?: unknown): AssetClass {
  switch (sc) {
    case "cbk_bond_prospectus":
    case "cbk_bond_reopening":
      return "gov_coupon";
    case "cbk_tbill_auction":
    case "cbk_tbill_auction_result":
      return "gov_discount";
    case "mmf_factsheet":
    case "mmf_benchmark":
      return "cash_mmf";
    case "bank_product_page":
    case "bank_rate_card":
      return "bank_deposit";
    case "market_asset_factsheet":
    case "market_asset_price":
      return assetClassForMarketAssetType(marketAssetType);
    case "unknown":
      return "alt";
  }
}

/**
 * Convert a raw extracted instrument object into a ResearchFindingDraft.
 * Flattens all extracted fields into the `extractedFields` string bag.
 * Applies NEVER_INVENT_FIELDS enforcement: null/empty → MISSING_FROM_SOURCE.
 */
export function structuredInstrumentToDraft(
  raw: Record<string, unknown>,
  sourceClass: SourceClass,
  sharedFields?: Record<string, unknown>,
  /** Stage 7b — the full source text this instrument was extracted from, already
   *  loaded in memory for this request. Optional and additive: omitting it simply
   *  skips candidate-phrase detection (existing callers/tests are unaffected). */
  sourceText?: string,
): ResearchFindingDraft | null {
  const name = typeof raw.instrumentName === "string" ? raw.instrumentName.trim() : "";
  if (!name) return null;

  const targetCatalogue = catalogueForSourceClass(sourceClass);
  const assetClass = assetClassForSourceClass(sourceClass, raw.assetType);

  // Build extractedFields from all non-meta fields
  const metaKeys = new Set(["instrumentName", "rawExcerpt", "warnings", "confidence", "proposalType", "matchedCurrentRow", "changedFields", "currentValues"]);
  const figures: Record<string, string> = {};

  // First, add shared fields (auction-level for CBK bonds)
  if (sharedFields) {
    for (const [k, v] of Object.entries(sharedFields)) {
      if (v === null || v === undefined || v === "") continue;
      if (v === MISSING_FROM_SOURCE) {
        figures[k] = MISSING_FROM_SOURCE;
      } else if (typeof v === "string") {
        figures[k] = v;
      } else if (typeof v === "number") {
        figures[k] = String(v);
      }
    }
  }

  // Then add per-instrument fields (override shared if present)
  for (const [k, v] of Object.entries(raw)) {
    if (metaKeys.has(k)) continue;
    if (v === null || v === undefined) {
      // For NEVER_INVENT_FIELDS, null means missing from source
      if (NEVER_INVENT_FIELDS.includes(k)) {
        figures[k] = MISSING_FROM_SOURCE;
      }
      continue;
    }
    if (v === "") {
      if (NEVER_INVENT_FIELDS.includes(k)) {
        figures[k] = MISSING_FROM_SOURCE;
      }
      continue;
    }
    if (v === MISSING_FROM_SOURCE) {
      figures[k] = MISSING_FROM_SOURCE;
      continue;
    }
    if (typeof v === "string") {
      figures[k] = v;
    } else if (typeof v === "number") {
      figures[k] = String(v);
    } else if (Array.isArray(v)) {
      // Arrays (couponPaymentDates, cleanPriceTable) → JSON string
      figures[k] = JSON.stringify(v);
    }
  }

  // Enforce NEVER_INVENT_FIELDS: if still not present, mark as missing
  for (const field of NEVER_INVENT_FIELDS) {
    if (!(field in figures)) {
      // Only mark as missing if this field is relevant to this catalogue
      if (targetCatalogue === "cbk") {
        figures[field] = MISSING_FROM_SOURCE;
      }
    }
  }

  // Stage 4 follow-up — the structured-extraction path (this function) skipped the
  // same deterministic CBK rule-fill `normaliseFinding` already applies (security
  // type, tenor, WHT rule, tax-exempt flag, maturity rule, derived from the tenor the
  // source stated). That gap made a genuinely-grounded CBK T-bill/bond finding fail
  // the approval gate on fields that are conventional, not extractable facts. Apply
  // the SAME helper here — it only fills a field that is still empty, so it never
  // overwrites a value the model actually extracted (e.g. a bond's real securityType).
  if (targetCatalogue === "cbk") {
    const ruleFilled = applyCbkRuleFill({ ...figures, name });
    delete (ruleFilled as Record<string, string>).name; // `name` was only a rule-fill signal
    Object.assign(figures, ruleFilled);
  }

  // Stage 7b — CBK-only candidate-phrase detection (pure, no LLM call). Runs AFTER
  // the rule-fill above so it only looks for what's STILL missing post-rule-fill,
  // scanning the source text already loaded in memory for this request — never a
  // new fetch, never an inferred value (see shared/candidatePhrases.ts's own
  // guardrails). Computed here, not later in getThread like Stage 5's missingRules,
  // because this source text is never persisted — it's only available during THIS
  // extraction call. A candidate is purely informational: it never fills a figure,
  // never affects the approval gate, never auto-drafts anything. missingRules /
  // checkApprovalGate themselves are NOT touched by this block — this only builds a
  // WIDER, separate scan list for candidate detection.
  let candidatePhrases: CandidateMatch[] = [];
  if (targetCatalogue === "cbk" && sourceText) {
    const gateMissing = missingRulesForFinding("cbk", figures, {
      name,
      assetClass,
      currency: typeof raw.currency === "string" ? raw.currency : "KES",
    });
    // ALSO scan every CBK-registered synonym key that's genuinely unfilled in
    // `figures` itself, checked DIRECTLY rather than through the gate's alias-
    // tolerant figurePresent(). Two reasons the gate's own missingRules understates
    // what's actually still needed, neither of which this block changes or fixes:
    //   1. cleanPrice (and others) have no CatalogueFieldRule at all, so they can
    //      never appear in gateMissing regardless of whether they're filled.
    //   2. A field's OWN key can be genuinely absent while one of its GATE ALIASES
    //      (e.g. valueDate's alias "settlementDate") is a NEVER_INVENT_FIELDS key
    //      that got sentinel-filled to "missing_from_source" — the gate's alias
    //      tolerance then treats that non-empty sentinel STRING as satisfying the
    //      field, so it never shows as missing there either. Checking figures[key]
    //      directly (not the alias list) sidesteps this without touching the gate.
    const gateKeys = new Set(gateMissing.map((r) => r.key));
    const extraTargets = registeredFieldsForCatalogue("cbk").filter(({ key }) => {
      if (gateKeys.has(key)) return false;
      const v = figures[key];
      return v === undefined || v === null || String(v).trim() === "" || v === MISSING_FROM_SOURCE;
    });
    candidatePhrases = findCandidatePhrases(sourceText, [...gateMissing, ...extraTargets], "cbk");
  }

  // Stage 7d — MMF-only: the benchmark/factsheet date the extraction schema captured
  // (MMF_EXTRACTION_SCHEMA.benchmarkDate), mirroring the CBK auctionDate→sourceAsOf
  // bridge further below. Narrow and defensive: only a non-empty, non-sentinel string,
  // only for the mmf catalogue, and only ever a CANDIDATE for `sourceAsOf` — never
  // invented. `??` at the final sourceAsOf computation means this never overwrites a
  // stronger sourceAsOf if one is ever added for mmf elsewhere in this function (there
  // isn't one today).
  const mmfBenchmarkAsOf =
    targetCatalogue === "mmf" &&
    typeof sharedFields?.benchmarkDate === "string" &&
    sharedFields.benchmarkDate.trim() !== "" &&
    sharedFields.benchmarkDate !== MISSING_FROM_SOURCE
      ? sharedFields.benchmarkDate.trim()
      : null;
  const mmfBenchmarkAsOfMs =
    mmfBenchmarkAsOf && Number.isFinite(Date.parse(mmfBenchmarkAsOf)) ? Date.parse(mmfBenchmarkAsOf) : null;

  // Stage 10b-1b — Bank-only: the source-wide as-of date the extraction schema
  // captured (BANK_EXTRACTION_SCHEMA.asOfDate), same bridge pattern as MMF's
  // benchmarkDate above and CBK's auctionDate below. Bank had no such bridge at
  // all before this — a source's stated "As of: ..." date was captured nowhere,
  // so every bank finding's sourceAsOf fell through to null regardless of what
  // the source said, and the review queue/approval modal showed it as Missing.
  const bankSourceAsOf =
    targetCatalogue === "bank" &&
    typeof sharedFields?.asOfDate === "string" &&
    sharedFields.asOfDate.trim() !== "" &&
    sharedFields.asOfDate !== MISSING_FROM_SOURCE
      ? sharedFields.asOfDate.trim()
      : null;

  // Round 103 — FIELD NORMALIZATION. Map extraction-schema names to catalogue
  // canonical names so the approval gate recognizes them (e.g. effectiveAnnualRate → ear).
  const normalised = normaliseExtractionFields(figures, targetCatalogue);
  // Merge normalized keys back into figures (canonical keys added alongside originals)
  for (const [k, v] of Object.entries(normalised)) {
    if (!(k in figures)) figures[k] = v;
  }

  // Stage 7d — MMF-only candidate-phrase detection (pure, no LLM call), same
  // established pattern as Stage 7b's CBK block above. Runs AFTER normalisation so
  // `figures` already carries the CANONICAL mmf keys (ear/minInvestment/yieldPct) the
  // gate and the MMF synonym dictionary both key off — scanning the pre-normalisation
  // raw schema names (effectiveAnnualRate/minimumInvestment) would wrongly report an
  // already-extracted field as missing. Unlike CBK, mmf figures are never sentinel-
  // filled by the NEVER_INVENT_FIELDS loop above (that loop only fires for
  // targetCatalogue === "cbk"), so there is no known gap between the gate's own
  // missingRules and what's genuinely still needed — no separate widened scan list is
  // required here, unlike the CBK block's extraTargets. Passing the resolved
  // `mmfBenchmarkAsOfMs` means a benchmark date already bridged to `sourceAsOf` (below)
  // correctly reads as PRESENT here, so it never also produces a redundant "as-of"
  // candidate for the very date that's already being used.
  if (targetCatalogue === "mmf" && sourceText) {
    const gateMissing = missingRulesForFinding("mmf", figures, {
      name,
      assetClass,
      currency: typeof raw.currency === "string" ? raw.currency : "KES",
      asOf: mmfBenchmarkAsOfMs,
    });
    candidatePhrases = findCandidatePhrases(sourceText, gateMissing, "mmf");
  }

  const warnings: string[] = Array.isArray(raw.warnings)
    ? raw.warnings.filter((w): w is string => typeof w === "string")
    : [];
  if (
    targetCatalogue === "bank" &&
    needsTieredSavingsRateScheduleNudge(figures) &&
    !warnings.includes(TIERED_SAVINGS_RATE_SCHEDULE_WARNING)
  ) {
    warnings.push(TIERED_SAVINGS_RATE_SCHEDULE_WARNING);
  }
  const confidence = clampConfidence(raw.confidence);
  const rawExcerpt = typeof raw.rawExcerpt === "string" ? raw.rawExcerpt.trim() || null : null;

  // Compute missing fields: those explicitly set to MISSING_FROM_SOURCE in the figures bag.
  // Note: the approval gate (missingFieldsForFinding) may report ADDITIONAL missing fields
  // beyond these; this list is for the finding card's immediate display.
  const missingFields = Object.entries(figures)
    .filter(([, v]) => v === MISSING_FROM_SOURCE)
    .map(([k]) => k);

  // Build the full structured profile for the _extendedFields key.
  // This carries the rich profile through the draft/approve pipeline into the
  // catalogue row's extendedFields JSON column.
  const extendedProfile: Record<string, unknown> = {
    catalogueType: targetCatalogue === "cbk" || targetCatalogue === "market_asset" ? targetCatalogue : targetCatalogue,
    instrumentName: name,
    sourceClass,
    ...figures,
  };
  // Attach as a hidden key that the publish path reads.
  const extractedFields: Record<string, string> = {
    ...figures,
    _extendedFields: JSON.stringify(extendedProfile),
  };

  // Stage 7b — hidden candidate-phrase key, same established pattern as
  // _proposalType/_extendedFields below. Never read by the approval gate or
  // promotion path; only a future UI surface (Stage 7c) reads it.
  if (candidatePhrases.length > 0) {
    extractedFields._candidatePhrases = JSON.stringify(candidatePhrases);
  }

  // ── Round 98: Inject comparison metadata ──────────────────────────────────
  const proposalType = typeof raw.proposalType === "string" ? raw.proposalType.trim().toLowerCase() : "create";
  extractedFields._proposalType = proposalType; // 'create' | 'update' | 'stale'

  if (raw.matchedCurrentRow && typeof raw.matchedCurrentRow === "string") {
    extractedFields._matchedCurrentRow = raw.matchedCurrentRow.trim();
  }

  if (Array.isArray(raw.changedFields) && raw.changedFields.length > 0) {
    extractedFields._changedFields = JSON.stringify(raw.changedFields);
  }

  if (Array.isArray(raw.currentValues) && raw.currentValues.length > 0) {
    extractedFields._currentValues = JSON.stringify(raw.currentValues);
  }

  if (proposalType === "stale") {
    extractedFields._staleFlag = "true";
  }

  // _targetRef: for update/stale, set to matched row name (used by draftFromFinding to auto-populate targetRef)
  if ((proposalType === "update" || proposalType === "stale") && extractedFields._matchedCurrentRow) {
    extractedFields._targetRef = extractedFields._matchedCurrentRow;
  }

  // _impactNote: human-readable summary of what this proposal does
  if (proposalType === "create") {
    extractedFields._impactNote = `New ${targetCatalogue} instrument: ${name}`;
  } else if (proposalType === "update" && Array.isArray(raw.changedFields)) {
    extractedFields._impactNote = `Updates ${(raw.changedFields as string[]).length} field(s) on existing row: ${extractedFields._matchedCurrentRow || name}`;
  } else if (proposalType === "stale") {
    extractedFields._impactNote = `Row may be stale (absent from source): ${extractedFields._matchedCurrentRow || name}`;
  }

  // Stage 4 follow-up — for a CBK T-BILL AUCTION RESULT, the auction date is the
  // as-of date for the rate/weighted-average figures this finding reports (the
  // provenance fallback in runResearchQuestion never bridges this — it only
  // back-fills sourceLabel/sourceUrl). Deliberately narrow to the T-bill auction
  // classes: settlement/value date is a DIFFERENT field (already carried separately
  // in `figures.valueDate`) and must never be conflated with as-of here.
  // Stage 7d adds the MMF equivalent as a fallback: `mmfBenchmarkAsOf` is only ever
  // non-null for the mmf catalogue (computed above), so the two conditions can never
  // both apply to the same draft.
  const sourceAsOf =
    (sourceClass === "cbk_tbill_auction" || sourceClass === "cbk_tbill_auction_result") &&
    typeof sharedFields?.auctionDate === "string" &&
    sharedFields.auctionDate.trim() !== "" &&
    sharedFields.auctionDate !== MISSING_FROM_SOURCE
      ? sharedFields.auctionDate.trim()
      : (mmfBenchmarkAsOf ?? bankSourceAsOf);

  return {
    instrumentName: name,
    issuer: typeof raw.fundManager === "string" ? raw.fundManager : typeof raw.bankName === "string" ? raw.bankName : null,
    assetClass,
    targetCatalogue,
    currency: typeof raw.currency === "string" ? raw.currency : "KES",
    extractedFields,
    sourceLabel: null, // filled by provenance fallback
    sourceUrl: null,
    sourceKind: null,
    checkedAt: null,
    sourceAsOf,
    confidence,
    missingFields,
    warnings,
    rawExcerpt,
  };
}

/* ── Public Integration Point ──────────────────────────────────────────────── */

/**
 * The instrument-aware extraction entry point. Given source text and a question,
 * classifies the source and runs structured extraction if applicable.
 *
 * Returns null if the source is "unknown" (caller should fall through to generic).
 * Returns { answer, findings, sourceClass } if structured extraction succeeded.
 */
export async function tryInstrumentAwareExtraction(
  sourceText: string,
  question: string,
): Promise<{ answer: string; findings: ResearchFindingDraft[]; sourceClass: SourceClass } | null> {
  // Step 1: Classify
  const { sourceClass } = await classifySource(sourceText);
  if (sourceClass === "unknown") return null;

  // Step 2: Check if we have a schema for this class
  const config = extractionSchemaForClass(sourceClass);
  if (!config) return null;

  // Step 3: Run structured extraction
  const { answer, rawInstruments, sharedFields } = await runStructuredExtraction(
    sourceClass,
    sourceText,
    question,
  );

  // Step 4: Map to ResearchFindingDraft[]
  const findings: ResearchFindingDraft[] = [];
  for (const raw of rawInstruments) {
    const draft = structuredInstrumentToDraft(raw, sourceClass, sharedFields, sourceText);
    if (draft) findings.push(draft);
  }

  return { answer, findings, sourceClass };
}
