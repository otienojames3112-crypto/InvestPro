/**
 * Format a number as a KES currency string.
 */
export function formatKES(value: number, decimals = 0): string {
  if (!isFinite(value)) return "KES 0";
  return `KES ${value.toLocaleString("en-KE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Format a number as a compact KES string (e.g. KES 1.2M).
 */
export function formatKESCompact(value: number): string {
  if (value >= 1_000_000) return `KES ${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `KES ${(value / 1_000).toFixed(1)}K`;
  return `KES ${value.toFixed(0)}`;
}

/**
 * Format a percentage.
 */
export function formatPct(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Get the month name and year from a start date and month offset.
 */
export function getMonthLabel(startDate: string, monthNumber: number): string {
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + monthNumber - 1);
  return d.toLocaleDateString("en-KE", { month: "short", year: "numeric" });
}

/**
 * Get the phase label for display.
 */
export function getPhaseName(phase: string): string {
  switch (phase) {
    case "foundation": return "Foundation";
    case "growth": return "Growth Engine";
    case "de-risking": return "De-risking";
    case "final-liquidity": return "Final Liquidity";
    default: return phase;
  }
}

/**
 * Part C2 — plain-language phase label for always-on chrome. The dashboard's
 * persistent badge should say what the phase MEANS, not just name it; the
 * technical phase name (from {@link getPhaseName}) is kept one hover away.
 */
export function getPhasePlainLabel(phase: string): string {
  switch (phase) {
    case "foundation": return "Building your base";
    case "growth": return "Growing your savings";
    case "de-risking": return "Locking in gains";
    case "final-liquidity": return "Getting ready to cash out";
    default: return getPhaseName(phase);
  }
}

/**
 * Part C2 — one-line explanation of what the current phase does, for the badge
 * tooltip. Pairs the plain label with the precise technical term.
 */
export function getPhasePlainHint(phase: string): string {
  switch (phase) {
    case "foundation":
      return "Foundation phase: the early stage where you build a cash base in money-market funds before laddering into government paper.";
    case "growth":
      return "Growth Engine phase: contributions and reinvested interest compound through a ladder of Treasury bills and bonds to grow the balance.";
    case "de-risking":
      return "De-risking phase: as the goal nears, the plan shifts toward shorter, safer holdings so a late rate move can't derail the target.";
    case "final-liquidity":
      return "Final Liquidity phase: holdings are timed to mature into cash by the goal date so the money is available when you need it.";
    default:
      return "";
  }
}

/**
 * Get the phase color class.
 */
export function getPhaseColorClass(phase: string): string {
  switch (phase) {
    case "foundation": return "phase-foundation";
    case "growth": return "phase-growth";
    case "de-risking": return "phase-de-risking";
    case "final-liquidity": return "phase-final-liquidity";
    default: return "";
  }
}

/**
 * Build a "Mon YYYY – Mon YYYY" date range from a start date and horizon in months.
 * The end is the month in which the horizon completes (start + horizonMonths - 1).
 */
export function formatDateRange(startDate: string | null | undefined, horizonMonths: number | null | undefined): string {
  if (!startDate || !horizonMonths || horizonMonths < 1) return "";
  const start = new Date(startDate);
  if (isNaN(start.getTime())) return "";
  const end = new Date(start);
  end.setMonth(end.getMonth() + horizonMonths - 1);
  const fmt = (d: Date) => d.toLocaleDateString("en-KE", { month: "short", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Get security type label.
 */
export function getSecurityLabel(type: string): string {
  switch (type) {
    case "tbill_91": return "91-Day T-Bill";
    case "tbill_182": return "182-Day T-Bill";
    case "tbill_364": return "364-Day T-Bill";
    case "ifb": return "Infrastructure Bond (IFB)";
    case "fxd": return "Fixed Coupon Bond (FXD)";
    case "zero_coupon": return "Zero-Coupon Bond";
    case "floating_rate": return "Floating-Rate Bond";
    default: return type;
  }
}

/**
 * How old a reconciled balance can be (in days) before it is considered stale
 * and worth flagging to the user. R66.
 */
export const RECONCILE_STALE_DAYS = 30;

/**
 * Format an epoch-ms timestamp as a short, human-friendly relative time
 * (e.g. "just now", "3 days ago", "2 months ago"). Returns "" for nullish input.
 */
export function formatRelativeTime(epochMs: number | null | undefined): string {
  if (epochMs == null || !isFinite(epochMs)) return "";
  const diffMs = Date.now() - epochMs;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

/**
 * Whether a reconciled timestamp is older than the staleness threshold.
 */
export function isReconcileStale(epochMs: number | null | undefined): boolean {
  if (epochMs == null || !isFinite(epochMs)) return false;
  return Date.now() - epochMs > RECONCILE_STALE_DAYS * 24 * 60 * 60 * 1000;
}

/**
 * Format an epoch-ms timestamp (or ISO/Date) as a stable LOCAL `YYYY-MM-DD`.
 *
 * Why not `toISOString().slice(0,10)`? That renders in UTC, so for users behind
 * UTC a maturity at (say) local midnight prints as the *previous* day — the same
 * event then shows two different calendar dates across the app. The rest of the
 * UI displays dates in the user's local zone (`toLocaleDateString`), so this
 * helper keeps date-only labels (Time Machine anchor / next-event) consistent
 * with those and free of the off-by-one drift. R78.
 */
export function formatLocalYmd(input: number | string | Date | null | undefined): string {
  if (input == null) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Stage 10a-2 — format an epoch-ms timestamp as a stable UTC `YYYY-MM-DD`.
 *
 * `formatLocalYmd` (above) is deliberately LOCAL-based because it's the right
 * tool for a value constructed via LOCAL-time construction (e.g. a maturity
 * date built from local `year/month/day` parts). The Research Desk pipeline's
 * `sourceAsOf`/`asOf` values are a DIFFERENT construction: they come from
 * `Date.parse("YYYY-MM-DD")` (an HTML `<input type="date">`'s value, or a
 * source's own printed date string) — and a date-only ISO string parses to
 * UTC MIDNIGHT per the ECMAScript spec, not local midnight. Formatting a
 * UTC-anchored value with LOCAL getters drifts a day backward for any viewer
 * behind UTC — the exact opposite bug `formatLocalYmd` exists to prevent for
 * its own (locally-anchored) inputs. Use this one for `sourceAsOf`/`asOf`
 * specifically; use `formatLocalYmd` for locally-constructed date-only values.
 */
export function formatUtcYmd(input: number | string | Date | null | undefined): string {
  if (input == null) return "—";
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

/**
 * Stage 6b — a compact "Source: X · as of Y" provenance line for a Holdings row,
 * shared across MMF/Government/Bank so wording and date formatting can never drift
 * between tabs (mirrors the pattern OtherAssets.tsx originated). Never returns a
 * blank source — falls back to `fallbackSource` (e.g. "manual entry" or "No source
 * on record") when there is none, so a figure never reads as sourced when it isn't.
 */
export function formatSourceProvenance(
  source: string | null | undefined,
  asOf: string | number | Date | null | undefined,
  fallbackSource = "No source on record",
): string {
  const src = source && String(source).trim() !== "" ? String(source).trim() : fallbackSource;
  const asOfLabel = asOf ? new Date(asOf).toLocaleDateString() : null;
  return asOfLabel ? `Source: ${src} · as of ${asOfLabel}` : `Source: ${src}`;
}

/** The subset of a catalogue row's extendedFields this app cares about for source display. */
export interface CatalogueSourceExtendedFields {
  sourceLabel?: string | null;
  sourceUrl?: string | null;
  sourceAsOfDate?: string | null;
}

export interface CatalogueSourceDisplay {
  /** Human-readable label — never a raw JSON blob, always trimmed/shortened. */
  label: string | null;
  /** Clickable URL, or null when nothing on record is a real http(s) URL. */
  url: string | null;
  /** Resolved as-of value (raw — caller formats with its own existing date formatter). */
  asOf: string | Date | null;
}

function isHttpUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const u = new URL(value.trim());
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Shorten a source string/URL into a compact, readable label (hostname, or the raw text, truncated). */
function shortenSourceLabel(raw: string): string {
  const s = raw.trim();
  if (isHttpUrl(s)) {
    try {
      return new URL(s).hostname.replace(/^www\./, "");
    } catch {
      // fall through to the plain-text truncation below
    }
  }
  return s.length > 32 ? `${s.slice(0, 30)}…` : s;
}

/**
 * Slice 8h-1 — resolves a catalogue row's source label/link/as-of for display,
 * shared by the MMF and Bank catalogue pages so the logic (and any future fix to
 * it) can't drift between them. Prefers the row's own top-level columns (always
 * populated, authoritative for label/as-of) and layers in the Slice-8f-stamped
 * `extendedFields` provenance for whatever the top-level columns can't carry
 * (mmf_funds/bank_instruments have no sourceUrl column at all).
 *
 * Slice 8h-2 — extended with an optional 4th argument, `fieldProvenanceUrl`, for
 * opportunity-backed rows (CBK/equity/REIT/offshore fund/SACCO): a caller-resolved
 * URL from that row's per-figure `fieldProvenance` map (see
 * `firstFieldProvenanceSourceUrl` below), tried after `extendedFields.sourceUrl`
 * but before the "top-level source is itself a URL" fallback. Omitted entirely,
 * this behaves exactly as it did for MMF/Bank in 8h-1 — fully backward compatible.
 */
export function resolveCatalogueSource(
  source: string | null | undefined,
  extendedFields: CatalogueSourceExtendedFields | null | undefined,
  asOfDate: string | Date | null | undefined,
  fieldProvenanceUrl?: string | null,
): CatalogueSourceDisplay {
  const rawLabel =
    (source && source.trim()) || (extendedFields?.sourceLabel && extendedFields.sourceLabel.trim()) || "";
  const label = rawLabel ? shortenSourceLabel(rawLabel) : null;

  const url = isHttpUrl(extendedFields?.sourceUrl)
    ? extendedFields!.sourceUrl!.trim()
    : isHttpUrl(fieldProvenanceUrl)
      ? fieldProvenanceUrl!.trim()
      : isHttpUrl(source)
        ? source!.trim()
        : null;

  const asOf = asOfDate ?? extendedFields?.sourceAsOfDate ?? null;

  return { label, url, asOf };
}

/**
 * Slice 8h-2 — scans an opportunity row's per-figure `fieldProvenance` map (Part
 * 7.1) for the first entry carrying a real http(s) `sourceUrl`, for use as
 * `resolveCatalogueSource`'s `fieldProvenanceUrl` fallback. This is ONLY a
 * fallback for when `extendedFields.sourceUrl` (Slice 8f) isn't present — most
 * opportunity rows already carry both, stamped from the same envelope value at
 * promotion time, so this mainly helps rows that predate Slice 8f but were
 * already governed through the older Part 7.1 provenance system. Scans in a
 * fixed, deterministic key order so the resolved URL never depends on object
 * iteration order.
 */
export function firstFieldProvenanceSourceUrl(
  fieldProvenance: Partial<Record<string, { sourceUrl?: string | null } | undefined>> | null | undefined,
): string | null {
  if (!fieldProvenance) return null;
  const KEY_ORDER = ["yield", "price", "distribution", "trailingReturn", "expense", "tenor", "maturity", "coupon", "fx"];
  for (const key of KEY_ORDER) {
    const url = fieldProvenance[key]?.sourceUrl;
    if (isHttpUrl(url)) return url.trim();
  }
  return null;
}

/**
 * Stage 9c — reads a value from a catalogue row's `extendedFields` JSON for a
 * given contract field, trying its canonical `key` first then each of its
 * `aliases` (structurally typed so any contract field entry from the shared
 * catalogue-contract module can be passed directly, without this client-only
 * lib importing that shared module itself). Going forward, Slice 8g-2
 * always persists under the canonical key; the alias fallback only matters
 * for rows that predate 8g-2 or were populated through the older raw
 * `_extendedFields` blob mechanism, which used the AI-extraction-schema's own
 * field names instead. Tolerates the `missing_from_source` sentinel and
 * empty strings. Never fabricates a value — returns null when nothing real
 * is found under any of the tried keys.
 */
export function readContractFieldValue(
  extendedFields: Record<string, unknown> | null | undefined,
  field: { key: string; aliases: string[] },
): string | null {
  if (!extendedFields) return null;
  for (const k of [field.key, ...field.aliases]) {
    const v = extendedFields[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s === "" || s === "missing_from_source") continue;
    return s;
  }
  return null;
}

/**
 * Stage 10a-2 — a plain source string that's actually THIS app's own URL/path
 * (e.g. a manager pasted the browser's current address bar as a stand-in
 * "source" while testing a pending update) is never a real source. Takes
 * `origin` explicitly (rather than reading `window.location.origin`
 * internally) so it's directly unit-testable without a DOM; callers pass
 * `window.location.origin` at the real render/seed site. The path-only check
 * (`/research`, `/explore`) still applies even when no origin is known, since
 * a bare app-relative path is never a real external citation either way.
 */
export function looksLikeOwnAppUrl(value: string | null | undefined, origin?: string): boolean {
  if (!value) return false;
  const v = value.trim();
  if (v === "") return false;
  if (origin && v.startsWith(origin)) return true;
  return /^\/(research|explore)(\?|\/|$)/.test(v);
}

/**
 * Stage 10a-2 — a contract row's raw `value` string (from the shared
 * catalogue-contract module's display-row projection) isn't always
 * display-ready: `sourceAsOf` is a raw epoch-ms string (that module
 * deliberately has no concept of "this field is a date", it only reads
 * opaque strings), and `sourceLink` can end up holding this app's own URL
 * (see `looksLikeOwnAppUrl`). Neither is something the generic,
 * catalogue-agnostic shared module should special-case — resolved here so
 * every render site (review queue card, approval modal, edit dialog) goes
 * through the same fix and can never show a raw epoch number or a
 * self-referential URL.
 */
export function displayContractRowValue(row: { key: string; value: string | null }): string | null {
  if (row.value == null) return null;
  if (row.key === "sourceAsOf") {
    const ms = Number(row.value);
    return Number.isFinite(ms) && ms > 0 ? formatUtcYmd(ms) : row.value;
  }
  if (row.key === "sourceLink") {
    const origin = typeof window !== "undefined" ? window.location.origin : undefined;
    if (looksLikeOwnAppUrl(row.value, origin)) return "Pasted source text";
  }
  return row.value;
}
