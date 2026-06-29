/**
 * Part 8 — server-side AI intake service.
 *
 * Wraps the LLM as a LIBRARIAN: it reads a messy source document and returns FACTS
 * (with confirming quotes) for a human to verify, or proposes candidate instruments
 * to track. It never ranks, scores, or recommends — the JSON schemas have no such
 * field, and every parsed result is run through `stripVerdictFields` as a backstop.
 *
 * The network-free parsing/mapping functions are exported so they can be unit-tested
 * directly; the `invokeLLM`-calling functions are thin wrappers around them.
 */

import { parse as parseHtml } from "node-html-parser";
import { invokeLLM } from "./_core/llm";
import {
  AI_EXTRACTABLE_FIELDS,
  stripVerdictFields,
  isUsableExtraction,
  type AiInstrumentExtraction,
  type AiExtractedFigure,
  type AiCandidateInstrument,
} from "../shared/aiIntake";
import { aiExtractedField, type FieldKey, type FieldProvenanceMap } from "../shared/provenance";

/* ── Document sources ─────────────────────────────────────────────────────────
 * The librarian can read from three kinds of source, all converging on the same
 * grounded extraction: pasted text, a fetched URL (HTML stripped to text), or an
 * uploaded PDF (handed to the model as a file so it reads the real document). In every
 * case the model is told to extract ONLY what is present — never to fill from general
 * knowledge — so the source is the sole ground truth.
 */

/** Strip an HTML document down to readable text (drop script/style/nav chrome). */
export function htmlToText(html: string): string {
  const root = parseHtml(html, { comment: false });
  root.querySelectorAll("script,style,noscript,svg,head,nav,footer,header").forEach((n) => n.remove());
  const text = root.text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

/**
 * Politely fetch a URL server-side and return its text content. Caps the body so a
 * huge page cannot blow the request budget. Throws a friendly error on failure so the
 * procedure can surface it.
 */
export async function fetchDocumentText(url: string, maxChars = 40000): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "text/html,text/plain", "User-Agent": "kes5m-tracker/ai-intake (contact: owner)" },
      redirect: "follow",
    });
  } catch (err) {
    throw new Error(`Could not fetch the URL: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`The source URL returned HTTP ${res.status}.`);
  const ctype = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const text = ctype.includes("html") ? htmlToText(body) : body;
  const trimmed = text.trim();
  if (trimmed.length < 20) throw new Error("The fetched page had no readable text to extract from.");
  return trimmed.slice(0, maxChars);
}

/* ── Prompts ──────────────────────────────────────────────────────────────── */

export const EXTRACTION_SYSTEM_PROMPT = `You are a meticulous financial-data LIBRARIAN, not an analyst or adviser.
Your ONLY job is to read the supplied source document and extract FACTUAL fields about ONE financial instrument, exactly as written.

Hard rules:
- Extract only what is literally stated in the document. If a figure is not present, omit it. NEVER guess, infer, annualise, or compute a value.
- For every figure you return, include the exact verbatim "quote" (a short snippet of the source text) the value came from, so a human can confirm it.
- Do NOT rank, score, rate, grade, or recommend anything. Do NOT say whether the instrument is good, safe, suitable, or worth buying. Do NOT compare it to anything.
- Do NOT invent an instrument. If the document does not describe a specific instrument, return an empty figures array and say so in notes.
- Values must be copied verbatim as strings (keep the source's units/precision, e.g. "9.25", "13.50%", "2041-03-01").`;

export const DISCOVERY_SYSTEM_PROMPT = `You are a financial-data LIBRARIAN compiling a CANDIDATE LIST of instruments that MIGHT belong in a tracking universe.
Your output is a list of SUGGESTIONS only. Nothing you return is added to any catalog — a human reviews every candidate first.

Hard rules:
- Propose instruments that match the requested universe (asset class / market / currency). For each, give a NEUTRAL one-line "scopeReason" stating WHY it matches the universe (e.g. "Regulated Kenyan money-market fund, KES-denominated").
- Do NOT rank, score, rate, order by quality, or recommend. Do NOT say which is best/safest/highest-yielding. Do NOT imply any candidate is preferable to another.
- Only propose instruments you are reasonably sure actually exist; never fabricate a name to fill the list.
- scopeReason describes FIT WITH THE UNIVERSE, never QUALITY.`;

/* ── JSON schemas (facts only; no verdict fields exist in them) ───────────── */

export const EXTRACTION_SCHEMA = {
  name: "instrument_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      name: { type: "string", description: "Instrument name exactly as written" },
      issuer: { type: ["string", "null"], description: "Issuer/manager if stated" },
      assetClass: { type: ["string", "null"], description: "Asset class as described" },
      currency: { type: ["string", "null"], description: "Currency code if stated" },
      market: { type: ["string", "null"], description: "Listing market/venue if stated" },
      notes: { type: ["string", "null"], description: "What could not be found / uncertainties (NOT a judgement)" },
      figures: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            field: { type: "string", enum: [...AI_EXTRACTABLE_FIELDS] },
            value: { type: "string", description: "Verbatim value as written" },
            quote: { type: "string", description: "Exact source snippet the value came from" },
            asOf: { type: ["string", "null"], description: "ISO date the figure is as-of, if stated" },
          },
          required: ["field", "value", "quote", "asOf"],
        },
      },
    },
    required: ["name", "issuer", "assetClass", "currency", "market", "notes", "figures"],
  },
} as const;

export const DISCOVERY_SCHEMA = {
  name: "universe_discovery",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      candidates: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            issuer: { type: ["string", "null"] },
            assetClass: { type: ["string", "null"] },
            currency: { type: ["string", "null"] },
            scopeReason: { type: ["string", "null"], description: "Neutral reason it fits the universe (not quality)" },
            sourceUrl: { type: ["string", "null"] },
          },
          required: ["name", "issuer", "assetClass", "currency", "scopeReason", "sourceUrl"],
        },
      },
    },
    required: ["candidates"],
  },
} as const;

/* ── Pure parsing (network-free, unit-testable) ───────────────────────────── */

/** Pull the assistant text content out of an LLM result, tolerating array content. */
export function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text ?? "") : ""))
      .join("");
  }
  return "";
}

/** Tolerant JSON parse: handles a bare object or one wrapped in ```json fences. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(body);
  } catch {
    // Last-ditch: grab the outermost {...}
    const first = body.indexOf("{");
    const last = body.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(body.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Parse + sanitize a raw extraction response into a safe AiInstrumentExtraction.
 * Drops verdict fields, keeps only known figure keys, and requires a confirming
 * quote on every figure (a figure with no quote cannot be confirmed, so it is
 * dropped — the librarian must show its work). Returns null when unusable.
 */
export function parseExtractionResponse(rawText: string): AiInstrumentExtraction | null {
  const parsed = stripVerdictFields(parseJsonLoose(rawText));
  if (!isUsableExtraction(parsed)) return null;

  const allowed = new Set<string>(AI_EXTRACTABLE_FIELDS as readonly string[]);
  const seen = new Set<string>();
  const figures: AiExtractedFigure[] = [];
  for (const f of parsed.figures as unknown[]) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const field = typeof o.field === "string" ? o.field : "";
    const value = typeof o.value === "string" ? o.value.trim() : "";
    const quote = typeof o.quote === "string" ? o.quote.trim() : "";
    if (!allowed.has(field) || value === "" || quote === "") continue; // facts must cite a quote
    if (seen.has(field)) continue; // one figure per key; first wins
    seen.add(field);
    figures.push({
      field: field as AiExtractedFigure["field"],
      value,
      quote,
      asOf: typeof o.asOf === "string" && o.asOf.trim() !== "" ? o.asOf : null,
    });
  }

  return {
    name: parsed.name.trim(),
    issuer: typeof parsed.issuer === "string" ? parsed.issuer : null,
    assetClass: typeof parsed.assetClass === "string" ? parsed.assetClass : null,
    currency: typeof parsed.currency === "string" ? parsed.currency : null,
    market: typeof parsed.market === "string" ? parsed.market : null,
    notes: typeof parsed.notes === "string" ? parsed.notes : null,
    figures,
  };
}

/** Parse + sanitize a discovery response into a list of suggestion-only candidates. */
export function parseDiscoveryResponse(rawText: string): AiCandidateInstrument[] {
  const parsed = stripVerdictFields(parseJsonLoose(rawText)) as { candidates?: unknown } | null;
  if (!parsed || !Array.isArray(parsed.candidates)) return [];
  const out: AiCandidateInstrument[] = [];
  const seenNames = new Set<string>();
  for (const c of parsed.candidates) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    if (name === "") continue;
    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    out.push({
      name,
      issuer: typeof o.issuer === "string" ? o.issuer : null,
      assetClass: typeof o.assetClass === "string" ? o.assetClass : null,
      currency: typeof o.currency === "string" ? o.currency : null,
      scopeReason: typeof o.scopeReason === "string" ? o.scopeReason : null,
      sourceUrl: typeof o.sourceUrl === "string" ? o.sourceUrl : null,
    });
  }
  return out;
}

/**
 * Convert AI-extracted figures into a per-figure provenance map, each at the lowest
 * trust tier (ai_extracted) and carrying the cited source + the confirming quote (as
 * the source label) so a human can confirm against it. The instrument's own page URL
 * is recorded as the sourceUrl. Maps the value verbatim — no arithmetic.
 */
export function extractionToProvenanceMap(args: {
  extraction: AiInstrumentExtraction;
  sourceLabel: string;
  sourceUrl: string | null;
  model: string | null;
  at: number;
}): FieldProvenanceMap {
  const map: FieldProvenanceMap = {};
  for (const f of args.extraction.figures) {
    const asOf = f.asOf ? Date.parse(f.asOf) : null;
    map[f.field as FieldKey] = aiExtractedField({
      value: f.value,
      // The cited source plus the verbatim quote, so the confirm UI shows exactly
      // what to check against the document.
      source: `${args.sourceLabel} — “${truncate(f.quote, 140)}”`,
      sourceUrl: args.sourceUrl,
      asOf: Number.isFinite(asOf) ? (asOf as number) : null,
      at: args.at,
      model: args.model,
    });
  }
  return map;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/* ── LLM-calling wrappers (thin) ──────────────────────────────────────────── */

/**
 * A document source for extraction: either raw pasted/fetched TEXT, or a PDF FILE the
 * model reads directly (via a `file_url`). Both converge on the same grounded schema.
 */
export type ExtractionSource =
  | { kind: "text"; text: string }
  | { kind: "pdf"; fileUrl: string };

export async function aiExtractInstrument(args: {
  source: ExtractionSource;
  hintName?: string | null;
}): Promise<{ extraction: AiInstrumentExtraction | null; model: string | null }> {
  const hint = args.hintName ? `The document is about: ${args.hintName}\n\n` : "";
  const userContent =
    args.source.kind === "text"
      ? `${hint}SOURCE DOCUMENT:\n${args.source.text}`
      : ([
          { type: "text" as const, text: `${hint}Extract the facts from the attached source document (PDF).` },
          { type: "file_url" as const, file_url: { url: args.source.fileUrl, mime_type: "application/pdf" as const } },
        ]);

  const res = await invokeLLM({
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    response_format: { type: "json_schema", json_schema: EXTRACTION_SCHEMA },
  });
  const text = contentToText(res.choices?.[0]?.message?.content);
  return { extraction: parseExtractionResponse(text), model: res.model ?? null };
}

export async function aiDiscoverCandidates(args: {
  universeDescription: string;
}): Promise<{ candidates: AiCandidateInstrument[]; model: string | null }> {
  const res = await invokeLLM({
    messages: [
      { role: "system", content: DISCOVERY_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Propose candidate instruments for this tracking universe (suggestions only):\n${args.universeDescription}`,
      },
    ],
    response_format: { type: "json_schema", json_schema: DISCOVERY_SCHEMA },
  });
  const text = contentToText(res.choices?.[0]?.message?.content);
  return { candidates: parseDiscoveryResponse(text), model: res.model ?? null };
}
