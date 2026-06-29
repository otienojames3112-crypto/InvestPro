/**
 * Expansion Brief — Part 8 (deeper spec), item 3: numeric sanity gates.
 *
 * The brief: "Numeric sanity gates on the way out: implausible values (e.g. an MMF
 * yield >25%, a negative price, a fee >5%) are flagged for review rather than saved
 * clean." This module is the deterministic, pure plausibility check applied to every
 * figure an AI extracts BEFORE it is written.
 *
 * The posture is deliberately CONSERVATIVE and NEUTRAL:
 *  - It does NOT judge whether a value is good/bad/cheap/attractive — that would be a
 *    quality signal, which the whole Part 8 wall forbids. It only asks "is this number
 *    even physically possible for this kind of figure?".
 *  - A flag does NOT discard the value or correct it. It marks the figure as
 *    `needs-review` so it is kept OUT of the clean ai_extracted map and surfaced to the
 *    human verifier with the reason, exactly like Part 7 flags anomalies for review
 *    rather than silently trusting or silently dropping them.
 *  - Bounds are wide on purpose: the gate catches obvious extraction defects
 *    (a misread decimal, a percent sign dropped, a negative price) — not borderline
 *    market values. When in doubt, it passes (a human still confirms everything).
 *
 * Pure + shared so it is unit-testable and reused by both server extraction and any
 * future client-side preview.
 */
import type { FieldKey } from "./provenance";

/** A plausibility verdict for one figure. */
export interface SanityVerdict {
  /** False when the value is implausible for its field (and must be flagged for review). */
  ok: boolean;
  /** Neutral, factual reason when not ok (e.g. "MMF yield above 25% is implausible"). */
  reason?: string;
  /** The numeric value we parsed out of the verbatim string, when we could. */
  parsed?: number | null;
}

/**
 * Pull a number out of a verbatim source string like "9.25", "13.50%", "KES 1,024.50",
 * "USD 1.07". Returns null when there is no parseable number (e.g. a date or free text),
 * in which case the gate does not apply (dates/text are checked elsewhere).
 */
export function parseNumeric(value: string): number | null {
  if (typeof value !== "string") return null;
  // Strip currency words/symbols and thousands separators, keep sign + decimal + percent.
  const cleaned = value
    .replace(/[, ]+/g, "")
    .replace(/(kes|usd|eur|gbp|ksh|sh)/gi, "")
    .replace(/[^0-9.\-%]/g, "");
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** True when the verbatim string carried an explicit percent sign. */
function hasPercent(value: string): boolean {
  return value.includes("%");
}

/**
 * Per-field plausibility bounds. These are intentionally generous outer limits that only
 * reject physically impossible / obviously-misread values, NOT a judgement of quality.
 * `assetClass` lets us tighten the rate gate for cash-like instruments (an MMF paying
 * 40% is almost certainly a misread, whereas a frontier equity dividend yield could be
 * higher — so we only hard-cap rate fields, and we treat all rate-like fields uniformly
 * with a wide ceiling).
 */
const RATE_CEILING_PCT = 25; // yields/coupons/distributions above this are implausible
const FEE_CEILING_PCT = 5; // an expense ratio / management fee above 5% is implausible
const MAX_TENOR_YEARS = 100; // a tenor beyond a century is a misread

/**
 * Check one extracted figure for physical plausibility. Returns ok=true when the value
 * is either plausible or not numeric (the gate only governs numeric fields). Never throws.
 */
export function checkFigureSanity(field: FieldKey, value: string): SanityVerdict {
  const n = parseNumeric(value);
  if (n === null) return { ok: true, parsed: null }; // non-numeric (e.g. maturity date) — not this gate's job

  switch (field) {
    case "price":
      // A traded/quoted price cannot be negative or zero.
      if (n <= 0) return { ok: false, reason: "A price of zero or below is not possible.", parsed: n };
      return { ok: true, parsed: n };

    case "yield":
    case "coupon":
    case "distribution":
    case "trailingReturn": {
      // Rate-like figures. A negative coupon/yield is implausible; an absurdly high one
      // is almost always a dropped decimal or a misread (e.g. "925" instead of "9.25").
      if (n < 0) return { ok: false, reason: "A negative rate is implausible.", parsed: n };
      if (n > RATE_CEILING_PCT) {
        return {
          ok: false,
          reason: `A ${field} above ${RATE_CEILING_PCT}% is implausible — check for a misread decimal.`,
          parsed: n,
        };
      }
      return { ok: true, parsed: n };
    }

    case "expense": {
      if (n < 0) return { ok: false, reason: "A negative fee is impossible.", parsed: n };
      if (n > FEE_CEILING_PCT) {
        return {
          ok: false,
          reason: `A fee/expense above ${FEE_CEILING_PCT}% is implausible.`,
          parsed: n,
        };
      }
      return { ok: true, parsed: n };
    }

    case "tenor": {
      if (n < 0) return { ok: false, reason: "A negative tenor is impossible.", parsed: n };
      if (n > MAX_TENOR_YEARS) {
        return { ok: false, reason: `A tenor beyond ${MAX_TENOR_YEARS} years is implausible.`, parsed: n };
      }
      return { ok: true, parsed: n };
    }

    case "fx": {
      // An FX rate to express a foreign figure in KES must be positive; a "rate" that is
      // actually a percent (carries %) is a misread.
      if (n <= 0) return { ok: false, reason: "An FX rate must be positive.", parsed: n };
      if (hasPercent(value)) return { ok: false, reason: "An FX rate should not be a percentage.", parsed: n };
      return { ok: true, parsed: n };
    }

    case "maturity":
      // Maturity is a date; numeric parse is incidental — leave to date handling.
      return { ok: true, parsed: n };

    default:
      return { ok: true, parsed: n };
  }
}
