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
import { catalogueForAssetClass, type ReferenceCatalogue } from "../shared/researchPipeline";

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
 * Which required figures for the finding's target catalogue are absent from its
 * extracted figures. Mirrors CATALOGUE_REQUIRED_FIELDS via the shared gate, but here
 * we surface the list on the draft so the manager sees the gap before drafting an update.
 */
export function missingFieldsForFinding(
  targetCatalogue: ReferenceCatalogue,
  figures: Record<string, string>,
): string[] {
  // Local copy of the minimal required keys (kept in lockstep with researchPipeline).
  const required: Record<ReferenceCatalogue, string[]> = {
    mmf: ["ear"],
    bank: ["indicativeRate"],
    cbk: ["yieldPct"],
    market_asset: ["lastPrice"],
  };
  const aliases: Record<string, string[]> = {
    ear: ["ear", "netYield", "yieldPct", "yield", "grossYield"],
    indicativeRate: ["indicativeRate", "rate", "yieldPct"],
    yieldPct: ["yieldPct", "yield", "coupon", "rate"],
    lastPrice: ["lastPrice", "price", "nav"],
  };
  return required[targetCatalogue].filter((key) => {
    const keys = aliases[key] ?? [key];
    return !keys.some((k) => figures[k] !== undefined && String(figures[k]).trim() !== "");
  });
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

  const figures: Record<string, string> = {};
  if (Array.isArray(o.figures)) {
    for (const f of o.figures) {
      if (!f || typeof f !== "object") continue;
      const fo = f as Record<string, unknown>;
      const key = cleanStr(fo.key);
      const value = cleanStr(fo.value);
      if (key && value && !(key in figures)) figures[key] = value;
    }
  }

  const warnings: string[] = Array.isArray(o.warnings)
    ? o.warnings.map((w) => cleanStr(w)).filter((w): w is string => w !== null)
    : [];

  const sourceLabel = cleanStr(o.sourceLabel);
  const sourceUrl = cleanStr(o.sourceUrl);
  const hasSource = Boolean(sourceLabel || sourceUrl);
  const missingFields = missingFieldsForFinding(targetCatalogue, figures);

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
    sourceAsOf: cleanStr(o.sourceAsOf),
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

  // Attach any grounding warnings to every finding so the manager sees the caveat.
  const withWarnings = groundingWarnings.length
    ? findings.map((f) => ({ ...f, warnings: [...f.warnings, ...groundingWarnings] }))
    : findings;

  return { answer, findings: withWarnings, model: res.model ?? null };
}
