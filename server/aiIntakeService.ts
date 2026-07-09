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
import { extractText, getDocumentProxy } from "unpdf";
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
 * Below this many characters of stripped text, a fetched financial page is almost
 * certainly JS-rendered (NSE quote boards, fact-sheet portals): the real figures load
 * in the browser AFTER the HTML arrives, so a server-side fetch sees almost nothing.
 * Rather than silently extract zero figures and confuse the user, we surface an honest
 * nudge to paste or upload an image. This is a UX honesty threshold, NOT a scraper knob.
 */
export const THIN_FETCH_MIN_CHARS = 600;

/** True when fetched text is implausibly thin for a financial page (likely JS-rendered). */
export function isThinFetch(text: string): boolean {
  return text.trim().length < THIN_FETCH_MIN_CHARS;
}

/**
 * Defensive guard: true when a string is (almost) entirely a base64/data blob rather than
 * real prose. Used so a PDF/image whose bytes could not be decoded can NEVER be sent to the
 * model as "grounding text" (which is what surfaced as scrambled base64 in the answer).
 * Real document text is full of spaces/newlines; a base64 blob is a long unbroken run.
 */
export function looksLikeRawBlob(s: string): boolean {
  const t = s.trim();
  if (t.startsWith("data:")) return true;
  if (t.length < 200) return false;
  const sample = t.slice(0, 2000);
  const whitespace = (sample.match(/\s/g) ?? []).length;
  const b64chars = (sample.match(/[A-Za-z0-9+/=]/g) ?? []).length;
  return whitespace / sample.length < 0.02 && b64chars / sample.length > 0.9;
}

/**
 * Extract a PDF's embedded text SERVER-SIDE from a base64 `data:` URI (the storage-free
 * upload path) or raw base64. Deterministic and free — no LLM/vision round-trip. Stock
 * OpenAI's inline-PDF (`file`) reading proved unreliable (it leaked the base64 back as
 * text), so we read the text ourselves. Returns "" for a scanned/image-only PDF that has
 * no embedded text; the caller then reports it as unreadable (upload a screenshot instead).
 */
export async function extractPdfText(fileUrlOrDataUri: string): Promise<string> {
  console.log(
    `[pdf] extractPdfText in: len=${fileUrlOrDataUri.length} prefix=${JSON.stringify(fileUrlOrDataUri.slice(0, 24))}`,
  );
  // A non-data reference (e.g. a legacy signed URL) can't be decoded here; treat as empty.
  if (!fileUrlOrDataUri.startsWith("data:") && /^https?:\/\//i.test(fileUrlOrDataUri)) {
    console.log("[pdf] non-data reference — returning empty");
    return "";
  }
  const base64 = fileUrlOrDataUri.startsWith("data:")
    ? fileUrlOrDataUri.slice(fileUrlOrDataUri.indexOf(",") + 1)
    : fileUrlOrDataUri;
  try {
    const bytes = Buffer.from(base64, "base64");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    const merged = Array.isArray(text) ? text.join("\n") : text;
    const out = (merged ?? "").trim();
    console.log(`[pdf] extracted chars=${out.length} sample=${JSON.stringify(out.slice(0, 80))}`);
    // Never let an un-decoded blob masquerade as extracted text.
    return looksLikeRawBlob(out) ? "" : out;
  } catch (err) {
    console.error("[pdf] extraction FAILED:", err instanceof Error ? err.message : String(err));
    // Return empty (not a throw) so callers report a clean "unreadable" message rather
    // than surfacing an error that might echo the raw bytes.
    return "";
  }
}

/**
 * Stage 4.2b-i — is this fetched response a PDF? Trusts an explicit `application/pdf`
 * content-type outright. Trusts a `.pdf` URL extension ONLY when the content-type did
 * NOT explicitly say something else non-PDF (html is the one type this function actively
 * parses, so an explicit html content-type always wins even if the URL contains ".pdf" —
 * e.g. an article ABOUT a PDF). This covers a server that serves a real PDF with a
 * missing/generic/incorrect content-type (common for government/bank sites) without
 * misrouting a genuine HTML page whose URL happens to mention "pdf".
 */
export function looksLikePdfResponse(contentType: string, url: string): boolean {
  const ctype = contentType.toLowerCase();
  if (ctype.includes("application/pdf")) return true;
  if (ctype.includes("html")) return false;
  try {
    return /\.pdf$/i.test(new URL(url).pathname);
  } catch {
    return /\.pdf(\?|#|$)/i.test(url);
  }
}

/**
 * Politely fetch a URL server-side and return its text content. Caps the body so a
 * huge page cannot blow the request budget. Throws a friendly error on failure so the
 * procedure can surface it. Note: a successful fetch may still be "thin" (JS-rendered) —
 * callers should run `isThinFetch` and nudge the user rather than extract from nothing.
 *
 * Stage 4.2b-i — a response that is (or looks like) a PDF is routed to the same
 * deterministic `extractPdfText` (unpdf) already used for uploaded PDFs, rather than
 * decoding its raw bytes as text — which would produce unreadable binary "gibberish"
 * (the exact bug already fixed once for the upload path). Benefits BOTH a manually
 * pasted PDF link and a future search-derived PDF citation, since both funnel through
 * this one function.
 */
export async function fetchDocumentText(url: string, maxChars = 40000): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "text/html,text/plain,application/pdf",
        "User-Agent": "kes5m-tracker/ai-intake (contact: owner)",
      },
      redirect: "follow",
    });
  } catch (err) {
    throw new Error(`Could not fetch the URL: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) throw new Error(`The source URL returned HTTP ${res.status}.`);
  const ctype = res.headers.get("content-type") ?? "";

  if (looksLikePdfResponse(ctype, url)) {
    const bytes = await res.arrayBuffer();
    const base64 = Buffer.from(bytes).toString("base64");
    const text = await extractPdfText(`data:application/pdf;base64,${base64}`);
    const trimmed = text.trim();
    if (trimmed.length === 0) throw new Error("The fetched PDF had no readable text to extract from.");
    return trimmed.slice(0, maxChars);
  }

  const body = await res.text();
  const text = ctype.includes("html") ? htmlToText(body) : body;
  const trimmed = text.trim();
  // Note: we deliberately allow a thin-but-nonempty result through (callers decide via
  // isThinFetch). Only a truly empty page is a hard error.
  if (trimmed.length === 0) throw new Error("The fetched page had no readable text to extract from.");
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
  | { kind: "pdf"; fileUrl: string }
  | { kind: "image"; imageUrl: string };

/**
 * Image transcription is stricter than text: the model must read ONLY the digits/labels
 * visibly printed in the screenshot and must never infer a missing field. This reinforces
 * the base extraction prompt for the vision path (OCR-grade faithfulness).
 */
export const IMAGE_EXTRACTION_NOTE = `The source is an IMAGE (a screenshot or photo of a quote board, fact-sheet table, or notice).
Transcribe ONLY figures that are visibly printed in the image. If a field is not shown in the image, omit it — never infer, complete, or compute it.
For each figure, the "quote" must be the exact text you read in the image (e.g. the cell label and the number).`;

/**
 * Vision-capable model families. invokeLLM wraps an OpenAI-compatible gateway; only some
 * model families accept image content. We check the configured/selected model id against
 * this allow-list and FAIL LOUDLY (rather than silently returning empty) when an image is
 * sent to a text-only model. Conservative substring match on the model id.
 */
export const VISION_CAPABLE_MODEL_PATTERNS = [
  "gpt-4o", "gpt-4.1", "gpt-4-turbo", "gpt-5", "o1", "o3", "o4",
  "claude-3", "claude-sonnet", "claude-opus", "claude-haiku", "claude-4",
  "gemini", "vision", "pixtral", "llava", "qwen-vl", "qwen2-vl", "qwen2.5-vl",
];

/** True when the given model id looks vision-capable per the allow-list. */
export function isVisionCapableModel(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const id = modelId.toLowerCase();
  return VISION_CAPABLE_MODEL_PATTERNS.some((p) => id.includes(p));
}

/**
 * Resolve a vision-capable model id, or null if none is available. Asks the gateway for
 * its model catalog and picks the first vision-capable id. Used to (a) pick a model for
 * the image path and (b) decide whether to fail loudly when no vision model exists.
 */
export async function resolveVisionModel(): Promise<string | null> {
  try {
    const { listLLMModels } = await import("./_core/llm");
    const { data } = await listLLMModels();
    const hit = data.find((m) => isVisionCapableModel(m.id));
    return hit?.id ?? null;
  } catch {
    return null;
  }
}

export async function aiExtractInstrument(args: {
  source: ExtractionSource;
  hintName?: string | null;
}): Promise<{ extraction: AiInstrumentExtraction | null; model: string | null }> {
  const hint = args.hintName ? `The document is about: ${args.hintName}\n\n` : "";

  // Images are read by the DEFAULT model (gpt-4o is vision-capable). We do NOT pick a model
  // from the provider's catalogue — that risked selecting one that rejects image input in
  // chat-completions (a 400). invokeLLM's default handles both text and vision.

  const systemContent =
    args.source.kind === "image"
      ? `${EXTRACTION_SYSTEM_PROMPT}\n\n${IMAGE_EXTRACTION_NOTE}`
      : EXTRACTION_SYSTEM_PROMPT;

  let userContent: string | Array<{ type: "text"; text: string } | { type: "file_url"; file_url: { url: string; mime_type: "application/pdf" } } | { type: "image_url"; image_url: { url: string; detail: "high" } }>;
  if (args.source.kind === "text") {
    userContent = `${hint}SOURCE DOCUMENT:\n${args.source.text}`;
  } else if (args.source.kind === "pdf") {
    userContent = [
      { type: "text", text: `${hint}Extract the facts from the attached source document (PDF).` },
      { type: "file_url", file_url: { url: args.source.fileUrl, mime_type: "application/pdf" } },
    ];
  } else {
    userContent = [
      { type: "text", text: `${hint}Transcribe the facts visibly printed in the attached image.` },
      { type: "image_url", image_url: { url: args.source.imageUrl, detail: "high" } },
    ];
  }

  // Accuracy over speed: this is a maintainer tool with no latency pressure, so we run
  // at temperature 0 with structured-output mode — we want the most faithful, repeatable
  // read of the document, not a creative one.
  const res = await invokeLLM({
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ],
    temperature: 0,
    response_format: { type: "json_schema", json_schema: EXTRACTION_SCHEMA },
  });
  const text = contentToText(res.choices?.[0]?.message?.content);
  return { extraction: parseExtractionResponse(text), model: res.model ?? null };
}

export async function aiDiscoverCandidates(args: {
  universeDescription: string;
}): Promise<{ candidates: AiCandidateInstrument[]; model: string | null }> {
  // Same accuracy-first posture as extraction (temperature 0 + structured output).
  const res = await invokeLLM({
    messages: [
      { role: "system", content: DISCOVERY_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Propose candidate instruments for this tracking universe (suggestions only):\n${args.universeDescription}`,
      },
    ],
    temperature: 0,
    response_format: { type: "json_schema", json_schema: DISCOVERY_SCHEMA },
  });
  const text = contentToText(res.choices?.[0]?.message?.content);
  return { candidates: parseDiscoveryResponse(text), model: res.model ?? null };
}
