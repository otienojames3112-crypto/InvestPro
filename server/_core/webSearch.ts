/**
 * Stage 4, Step 4.2a — `searchAuthoritativeSource()` (PURE-ISH, fully isolated).
 *
 * A standalone wrapper around OpenAI's Responses API `web_search` tool. NOT wired
 * into `runResearchQuestion`, `routers.ts`, or the UI — this file is reachable only
 * by direct calls (today: only its own tests). See CODEX_HANDOFF_ASK_AI_RESEARCH.md
 * and the Stage 4.2 design report for why this endpoint, not Chat Completions:
 * the Chat-Completions web-search path requires the `gpt-4o-search-preview` /
 * `gpt-4o-mini-search-preview` models, which OpenAI has scheduled for shutdown on
 * 2026-07-23 — building on them now would ship something already set to break.
 *
 * DELIBERATELY DOES NOT import or modify `./llm.ts` (`invokeLLM`). Chat Completions
 * is a completely different endpoint/request/response shape from the Responses API
 * used here, and `invokeLLM` is called by dozens of existing sites throughout the
 * app — this module reads only the already-exported `ENV` (endpoint/key/model
 * configuration) and implements its own minimal fetch, so it can be reasoned about,
 * tested, and mocked in complete isolation with zero risk to any existing caller.
 *
 * Guardrail this whole module exists to enforce: a search "succeeding" with an
 * answer but NO real URL citation is NOT grounding. `searchAuthoritativeSource`
 * returns `ok:false` in that case — it is structurally impossible for a caller to
 * mistake an uncited answer for a real, checkable source.
 */

import { ENV } from "./env";
import { authoritativeSourcesFor, type AuthoritativeSourceRef } from "../../shared/authoritativeSources";
import type { ReferenceCatalogue } from "../../shared/researchPipeline";

/** A single source citation the model's search actually returned. */
export interface SearchCitation {
  url: string;
  title: string;
}

/** The result of one authoritative-source search attempt. Mirrors the existing
 *  `SourceReadResult` shape-family in `aiResearchService.ts` (typed ok:true grounded
 *  outcome vs. a typed, reasoned ok:false) rather than inventing new vocabulary. */
export type SearchSourceResult =
  | {
      ok: true;
      kind: "search";
      /** The model's answer text, grounded by the cited sources below. */
      text: string;
      /** Real URL citations the search actually returned. Never empty when ok:true. */
      citations: SearchCitation[];
      /** Human label for the route that was searched, e.g. "CBK Securities". */
      sourceLabel: string;
      catalogue: ReferenceCatalogue;
      subtype: string | null;
      /** Epoch ms UTC when the search was performed. */
      searchedAt: number;
    }
  | {
      ok: false;
      /** no_route: Step 4.1's table has no entry for this catalogue/sub-type — search
       *  is never attempted (no fetch call is made) rather than searching blind.
       *  no_citations: the model answered but cited no real URL — never grounded.
       *  search_failed: no API key configured, a network error, or a non-2xx response. */
      reason: "no_route" | "no_citations" | "search_failed";
      message: string;
    };

/** Default model for the search call. Same default `invokeLLM` already uses
 *  elsewhere in this app (`gpt-4o`) when `OPENAI_MODEL` isn't set — NOT yet
 *  confirmed compatible with the Responses API `web_search` tool specifically;
 *  verify with a real/sandboxed call before wiring this into the live flow
 *  (Step 4.2b). Callers may override via `args.model`. */
const DEFAULT_SEARCH_MODEL = "gpt-4o";

const RESPONSES_API_PATH = "/v1/responses";

function resolveSearchEndpoint(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = ENV.openaiApiKey?.trim() ?? "";
  const baseUrl =
    ENV.openaiBaseUrl && ENV.openaiBaseUrl.trim().length > 0
      ? ENV.openaiBaseUrl.trim().replace(/\/$/, "")
      : "https://api.openai.com";
  const model =
    ENV.openaiModel && ENV.openaiModel.trim().length > 0 ? ENV.openaiModel.trim() : DEFAULT_SEARCH_MODEL;
  return { apiKey, baseUrl, model };
}

/** Build the search instruction text: names each registered source by role, and for
 *  a variable-domain source (no fixed domain — "varies per fund/bank/issuer/sacco")
 *  describes it in words rather than a fake/invented domain filter. */
function buildInstruction(args: {
  question?: string | null;
  instrumentHint?: string | null;
  sources: AuthoritativeSourceRef[];
}): string {
  const lines: string[] = [
    "You are a financial-data research assistant for a Kenyan investment tracker.",
    "Search for CURRENT, dated information from the following AUTHORITATIVE sources, in preference order:",
  ];
  for (const s of args.sources) {
    const domainNote = s.domains.length > 0 ? ` (prefer results from: ${s.domains.join(", ")})` : "";
    lines.push(`- [${s.role.toUpperCase()}] ${s.label}${domainNote} — ${s.note}`);
  }
  lines.push(
    "Report ONLY figures you can cite with a real URL from your search. Never invent or recall a figure from memory.",
    "State the as-of date and currency for every figure you report, exactly as the source states them.",
  );
  if (args.instrumentHint) lines.push(`Instrument: ${args.instrumentHint}`);
  if (args.question) lines.push(`Question: ${args.question}`);
  return lines.join("\n");
}

/** Raw shape of the pieces of a Responses API reply this module reads. Intentionally
 *  narrow — only the fields `searchAuthoritativeSource` actually consumes. */
interface ResponsesApiReply {
  output?: Array<{
    type?: string;
    role?: string;
    content?: Array<{
      type?: string;
      text?: string;
      annotations?: Array<{ type?: string; url?: string; title?: string }>;
    }>;
  }>;
}

function extractTextAndCitations(reply: ResponsesApiReply): { text: string; citations: SearchCitation[] } {
  const texts: string[] = [];
  const citations: SearchCitation[] = [];
  for (const item of reply.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (typeof part.text === "string" && part.text.trim() !== "") texts.push(part.text.trim());
      for (const ann of part.annotations ?? []) {
        if (ann.type === "url_citation" && ann.url && ann.url.trim() !== "") {
          citations.push({ url: ann.url.trim(), title: (ann.title ?? "").trim() || ann.url.trim() });
        }
      }
    }
  }
  return { text: texts.join("\n\n"), citations };
}

/**
 * Search for the current, authoritative figure(s) for one catalogue/sub-type, using
 * Step 4.1's routing table to decide where to look. Never attempts a search when no
 * route is registered. Never treats an uncited answer as grounded.
 */
export async function searchAuthoritativeSource(args: {
  catalogue: ReferenceCatalogue;
  subtype?: string | null;
  instrumentHint?: string | null;
  question?: string | null;
  /** Override the default search model (see DEFAULT_SEARCH_MODEL's caveat). */
  model?: string | null;
  /** Injected for tests only — defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}): Promise<SearchSourceResult> {
  const route = authoritativeSourcesFor(args.catalogue, args.subtype ?? null);
  if (!route) {
    return {
      ok: false,
      reason: "no_route",
      message: `No authoritative source is registered for ${args.catalogue}${args.subtype ? `/${args.subtype}` : ""}.`,
    };
  }

  const { apiKey, baseUrl, model } = resolveSearchEndpoint();
  if (!apiKey) {
    return { ok: false, reason: "search_failed", message: "No OpenAI API key is configured (OPENAI_API_KEY)." };
  }

  const fixedDomains = route.sources.flatMap((s) => s.domains);
  const instruction = buildInstruction({
    question: args.question,
    instrumentHint: args.instrumentHint,
    sources: route.sources,
  });

  const payload: Record<string, unknown> = {
    model: args.model?.trim() || model,
    input: instruction,
    tools: [
      {
        type: "web_search",
        ...(fixedDomains.length > 0 ? { filters: { allowed_domains: fixedDomains } } : {}),
      },
    ],
  };

  const doFetch = args.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`${baseUrl}${RESPONSES_API_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return {
      ok: false,
      reason: "search_failed",
      message: `Search request failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return {
      ok: false,
      reason: "search_failed",
      message: `Search request failed: ${response.status} ${response.statusText} — ${errorText.slice(0, 300)}`,
    };
  }

  let reply: ResponsesApiReply;
  try {
    reply = (await response.json()) as ResponsesApiReply;
  } catch (err) {
    return {
      ok: false,
      reason: "search_failed",
      message: `Could not parse the search response: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const { text, citations } = extractTextAndCitations(reply);
  if (citations.length === 0) {
    return {
      ok: false,
      reason: "no_citations",
      message: "The search returned no real URL citations, so the answer cannot be treated as a grounded source.",
    };
  }

  return {
    ok: true,
    kind: "search",
    text,
    citations,
    sourceLabel: route.sources.find((s) => s.role === "primary")?.label ?? route.sources[0].label,
    catalogue: args.catalogue,
    subtype: args.subtype ?? null,
    searchedAt: Date.now(),
  };
}
