/**
 * Rate Fetcher — defensive scraper for CBK T-Bill rates and SanlamAllianz MMF yield.
 *
 * Design principles:
 * - Never silently substitute a guess. If a fetch fails or returns an implausible value,
 *   return a structured error — the caller decides what to do.
 * - Plausibility band: 0–50% for all rates. Values outside this band are treated as
 *   parse failures.
 * - Each source has a cadenceNote explaining real publication frequency so the UI can
 *   inform the user that a "daily" check often returns the same number.
 */

export interface FetchedRate {
  rateField: string;
  value: number;
  sourceLabel: string;
  sourceUrl: string;
  cadenceNote: string;
}

export interface FetchResult {
  source: "cbk" | "sanlam";
  success: boolean;
  rates: FetchedRate[];
  errorMessage?: string;
  fetchedAt: string; // ISO timestamp
  rawSnippet?: string; // first 500 chars of scraped text for audit
}

const MIN_PLAUSIBLE = 0.01;
const MAX_PLAUSIBLE = 50;

function isPlausible(v: number): boolean {
  return v >= MIN_PLAUSIBLE && v <= MAX_PLAUSIBLE;
}

/**
 * Parse a percentage number from a string like "8.97", "8.97%", "8.9746 %".
 * Returns null if unparseable or implausible.
 */
function parseRate(raw: string): number | null {
  const cleaned = raw.replace(/%/g, "").trim();
  const n = parseFloat(cleaned);
  if (isNaN(n)) return null;
  if (!isPlausible(n)) return null;
  return n;
}

/**
 * Fetch the CBK Treasury Bills page and extract 91/182/364-day weighted average rates.
 * CBK publishes T-bill results weekly (every Tuesday after the auction).
 * Bond rates are published monthly.
 */
export async function fetchCBKRates(): Promise<FetchResult> {
  const fetchedAt = new Date().toISOString();
  const sourceUrl = "https://www.centralbank.go.ke/bills-bonds/treasury-bills/";

  try {
    const res = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KES5MTracker/1.0; rate-monitor)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      return {
        source: "cbk",
        success: false,
        rates: [],
        errorMessage: `HTTP ${res.status} from CBK`,
        fetchedAt,
      };
    }

    const html = await res.text();
    const rawSnippet = html.slice(0, 1000);

    // CBK page structure: table rows with "91-Day", "182-Day", "364-Day" labels
    // and columns for "Weighted Average Rate" or similar.
    // We use regex patterns that are resilient to minor HTML changes.

    const rates: FetchedRate[] = [];

    // Pattern: find rows containing "91", "182", "364" near a percentage number
    // CBK typically shows: 91-Day | ... | 8.82% or similar
    const tenors: Array<{ label: string; regex: RegExp; field: string; cadence: string }> = [
      {
        label: "CBK 91-Day T-Bill (weighted avg)",
        regex: /91[- ]?[Dd]ay[\s\S]{0,300}?(\d{1,2}\.\d{2,4})\s*%?/,
        field: "tbill91Rate",
        cadence: "Weekly (Tuesday auction results)",
      },
      {
        label: "CBK 182-Day T-Bill (weighted avg)",
        regex: /182[- ]?[Dd]ay[\s\S]{0,300}?(\d{1,2}\.\d{2,4})\s*%?/,
        field: "tbill182Rate",
        cadence: "Weekly (Tuesday auction results)",
      },
      {
        label: "CBK 364-Day T-Bill (weighted avg)",
        regex: /364[- ]?[Dd]ay[\s\S]{0,300}?(\d{1,2}\.\d{2,4})\s*%?/,
        field: "tbill364Rate",
        cadence: "Weekly (Tuesday auction results)",
      },
    ];

    for (const tenor of tenors) {
      const match = html.match(tenor.regex);
      if (match?.[1]) {
        const value = parseRate(match[1]);
        if (value !== null) {
          rates.push({
            rateField: tenor.field,
            value,
            sourceLabel: tenor.label,
            sourceUrl,
            cadenceNote: tenor.cadence,
          });
        }
      }
    }

    if (rates.length === 0) {
      return {
        source: "cbk",
        success: false,
        rates: [],
        errorMessage: "Could not parse any T-bill rates from CBK page. The page structure may have changed.",
        fetchedAt,
        rawSnippet,
      };
    }

    return { source: "cbk", success: true, rates, fetchedAt, rawSnippet };
  } catch (err) {
    return {
      source: "cbk",
      success: false,
      rates: [],
      errorMessage: `Fetch error: ${err instanceof Error ? err.message : String(err)}`,
      fetchedAt,
    };
  }
}

/**
 * Fetch the SanlamAllianz Money Market Fund page and extract the effective annual yield.
 * SanlamAllianz updates their fund fact sheet monthly.
 *
 * Note on tax: SanlamAllianz quotes a GROSS effective annual yield. The engine applies
 * 15% WHT on top of this rate. We do NOT apply WHT here — we store the gross rate.
 */
export async function fetchSanlamRates(): Promise<FetchResult> {
  const fetchedAt = new Date().toISOString();
  // Primary URL: SanlamAllianz Kenya MMF page
  const sourceUrl = "https://www.sanlamallianz.co.ke/investments/money-market-fund/";

  try {
    const res = await fetch(sourceUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; KES5MTracker/1.0; rate-monitor)",
        "Accept": "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      return {
        source: "sanlam",
        success: false,
        rates: [],
        errorMessage: `HTTP ${res.status} from SanlamAllianz`,
        fetchedAt,
      };
    }

    const html = await res.text();
    const rawSnippet = html.slice(0, 1000);

    // Look for patterns like "8.78%", "effective annual yield: 8.78", "EAY 8.78%"
    // Multiple patterns tried in order of specificity
    const patterns = [
      /[Ee]ffective\s+[Aa]nnual\s+[Yy]ield[\s:]*(\d{1,2}\.\d{2,4})\s*%?/,
      /[Ee]\.?[Aa]\.?[Yy]\.?[\s:]*(\d{1,2}\.\d{2,4})\s*%?/,
      /[Mm]oney\s+[Mm]arket[\s\S]{0,200}?(\d{1,2}\.\d{2,4})\s*%/,
      /[Yy]ield[\s:]*(\d{1,2}\.\d{2,4})\s*%/,
    ];

    let value: number | null = null;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match?.[1]) {
        value = parseRate(match[1]);
        if (value !== null) break;
      }
    }

    if (value === null) {
      return {
        source: "sanlam",
        success: false,
        rates: [],
        errorMessage: "Could not parse MMF yield from SanlamAllianz page. The page structure may have changed.",
        fetchedAt,
        rawSnippet,
      };
    }

    return {
      source: "sanlam",
      success: true,
      rates: [
        {
          rateField: "mmfYield",
          value,
          sourceLabel: "SanlamAllianz MMF Effective Annual Yield (gross, before 15% WHT)",
          sourceUrl,
          cadenceNote: "Monthly (fund fact sheet update)",
        },
      ],
      fetchedAt,
      rawSnippet,
    };
  } catch (err) {
    return {
      source: "sanlam",
      success: false,
      rates: [],
      errorMessage: `Fetch error: ${err instanceof Error ? err.message : String(err)}`,
      fetchedAt,
    };
  }
}

/** Run both fetchers and return combined results. */
export async function fetchAllRates(): Promise<FetchResult[]> {
  const [cbk, sanlam] = await Promise.allSettled([fetchCBKRates(), fetchSanlamRates()]);
  return [
    cbk.status === "fulfilled" ? cbk.value : {
      source: "cbk" as const,
      success: false,
      rates: [],
      errorMessage: cbk.reason instanceof Error ? cbk.reason.message : String(cbk.reason),
      fetchedAt: new Date().toISOString(),
    },
    sanlam.status === "fulfilled" ? sanlam.value : {
      source: "sanlam" as const,
      success: false,
      rates: [],
      errorMessage: sanlam.reason instanceof Error ? sanlam.reason.message : String(sanlam.reason),
      fetchedAt: new Date().toISOString(),
    },
  ];
}
