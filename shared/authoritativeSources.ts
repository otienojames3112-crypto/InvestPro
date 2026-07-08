/**
 * Stage 4, Step 4.1 — Authoritative-source routing table (PURE, framework-free).
 *
 * This is a STATIC, DATA-ONLY lookup: given a catalogue (and, where it actually
 * changes the answer, a finer sub-type), which official/primary source should the
 * "search & find" mode (Stage 4, Step 4.2+) prefer, and which should it treat as a
 * secondary cross-check. It does NOT perform any search, fetch, or LLM call — it is
 * intentionally isolated from `runResearchQuestion`, source classification, the
 * extraction schemas, the approval gate, and promotion, so this step changes NO
 * runtime behaviour anywhere in the app. It exists purely so a future search step
 * has one place to ask "where should I look first for this kind of instrument."
 *
 * `domains` is a best-effort, non-exhaustive hint list for a LATER step to prefer
 * matching search results — it is NOT validated, fetched, or relied on by anything
 * yet. Where an instrument's real source varies per-issuer/per-fund/per-bank (no
 * single fixed domain), `domains` is deliberately left empty and `note` explains
 * why — never a guessed or invented domain standing in for "we don't know."
 *
 * Never guesses: `authoritativeSourcesFor()` returns `null` for any catalogue/
 * sub-type combination this table does not explicitly cover, rather than falling
 * back to a plausible-sounding default.
 */

import type { ReferenceCatalogue } from "./researchPipeline";

/** One source's role: the first place to look, or a cross-check once you have a figure. */
export type SourceRole = "primary" | "secondary";

export interface AuthoritativeSourceRef {
  /** Plain-language label for UI/logs, e.g. "Central Bank of Kenya". */
  label: string;
  role: SourceRole;
  /**
   * Best-effort domain hints (lowercase, no scheme, no path) a later search step
   * could prefer when this source has one fixed, known domain. Empty when the real
   * source varies per instrument (e.g. "the fund manager's own site") — see `note`.
   */
  domains: string[];
  /** One-sentence plain-language note: what this source is, or why it varies. */
  note: string;
}

export interface AuthoritativeSourceRoute {
  catalogue: ReferenceCatalogue;
  /** The finer key this route applies to, when sub-type routing actually differs
   *  (e.g. market-asset "reit" vs "sacco"). Null when one route covers the whole
   *  catalogue (e.g. CBK — T-bill/FXD/IFB are all published through the same
   *  CBK/DhowCSD channels, so sub-type routing wouldn't add anything real). */
  subtype: string | null;
  sources: AuthoritativeSourceRef[];
}

/**
 * CBK Securities — ONE route covers T-bill, FXD, and IFB: all are published
 * through the same Central Bank of Kenya / DhowCSD channels, so a sub-type-specific
 * override would be duplication, not a real routing difference.
 */
const CBK_ROUTE: AuthoritativeSourceRoute = {
  catalogue: "cbk",
  subtype: null,
  sources: [
    {
      label: "Central Bank of Kenya",
      role: "primary",
      domains: ["centralbank.go.ke"],
      note: "Official Treasury bill/bond auction results, prospectuses, and weekly/periodic notices.",
    },
    {
      label: "DhowCSD (CBK's auction & CDS platform)",
      role: "primary",
      domains: ["dhowcsd.centralbank.go.ke"],
      note: "CBK's own bidding/settlement platform for T-bills and bonds — the auction-of-record. Domain should be spot-checked when Step 4.2 wires a live search call.",
    },
  ],
};

/** MMF — fund manager's own factsheet is the primary (varies per fund, no fixed
 *  domain); CMA published data is a cross-check. */
const MMF_ROUTE: AuthoritativeSourceRoute = {
  catalogue: "mmf",
  subtype: null,
  sources: [
    {
      label: "The fund manager's own factsheet",
      role: "primary",
      domains: [],
      note: "Varies per fund manager (e.g. CIC, Sanlam, Britam, Cytonn) — no single fixed domain; use the manager's own published factsheet/rate page.",
    },
    {
      label: "Capital Markets Authority (CMA)",
      role: "secondary",
      domains: ["cma.or.ke"],
      note: "Regulator-published MMF performance data — a cross-check against the fund manager's own figures, not the primary source.",
    },
  ],
};

/** Bank products — the bank's own official rates/product page (varies per bank,
 *  no fixed domain). No secondary source is registered — there is no equivalent
 *  regulator-published cross-check table this app currently knows of. */
const BANK_ROUTE: AuthoritativeSourceRoute = {
  catalogue: "bank",
  subtype: null,
  sources: [
    {
      label: "The bank's own official rates / product page",
      role: "primary",
      domains: [],
      note: "Varies per bank (e.g. KCB, Equity, NCBA, Absa) — no single fixed domain; use the bank's own published rates page.",
    },
  ],
};

/** Market assets — deliberately keyed by SUB-TYPE, not one catalogue-level route,
 *  because equity/REIT, offshore fund, and SACCO genuinely have different
 *  authoritative sources (unlike CBK). A bare "market_asset" lookup with no
 *  sub-type is intentionally NOT registered — see the "unknown" guard below. */
const MARKET_ASSET_ROUTES: Record<"equity" | "reit" | "offshore_fund" | "sacco", AuthoritativeSourceRoute> = {
  equity: {
    catalogue: "market_asset",
    subtype: "equity",
    sources: [
      {
        label: "Nairobi Securities Exchange (NSE)",
        role: "primary",
        domains: ["nse.co.ke"],
        note: "Official listed-price board and company announcements.",
      },
      {
        label: "The issuer's own investor-relations page",
        role: "secondary",
        domains: [],
        note: "Varies per listed company — no single fixed domain; used to cross-check dividends/announcements beyond the price board.",
      },
    ],
  },
  reit: {
    catalogue: "market_asset",
    subtype: "reit",
    sources: [
      {
        label: "Nairobi Securities Exchange (NSE)",
        role: "primary",
        domains: ["nse.co.ke"],
        note: "Official listed-price board for exchange-traded REITs.",
      },
      {
        label: "The issuer's own investor-relations page",
        role: "secondary",
        domains: [],
        note: "Varies per REIT manager — no single fixed domain; used to cross-check distribution yield and factsheet detail beyond the price board.",
      },
    ],
  },
  offshore_fund: {
    catalogue: "market_asset",
    subtype: "offshore_fund",
    sources: [
      {
        label: "The fund manager's own factsheet / NAV page",
        role: "primary",
        domains: [],
        note: "Varies per fund manager and fund — no single fixed domain; use the manager's own published NAV/factsheet page.",
      },
    ],
  },
  sacco: {
    catalogue: "market_asset",
    subtype: "sacco",
    sources: [
      {
        label: "The SACCO's own official page",
        role: "primary",
        domains: [],
        note: "Varies per SACCO — no single fixed domain; use the SACCO's own published dividend/rebate announcement.",
      },
      {
        label: "SASRA public register",
        role: "secondary",
        domains: ["sasra.go.ke"],
        note: "SACCO Societies Regulatory Authority — used to confirm regulatory status, not as the source of dividend/rebate figures.",
      },
    ],
  },
};

/**
 * Look up the authoritative-source route for a catalogue, optionally narrowed by
 * sub-type. Returns `null` — never a guessed default — when:
 *   - the catalogue is `market_asset` and no (or an unrecognised) sub-type was
 *     given (equity/REIT/offshore fund/SACCO genuinely differ; there is no single
 *     sensible "market asset in general" source to fall back to), or
 *   - the catalogue itself isn't one this table covers.
 * For `cbk`/`mmf`/`bank`, a sub-type is accepted but has no effect (the SAME route
 * is returned regardless) since sourcing doesn't differ within those catalogues.
 */
export function authoritativeSourcesFor(
  catalogue: ReferenceCatalogue,
  subtype?: string | null,
): AuthoritativeSourceRoute | null {
  switch (catalogue) {
    case "cbk":
      return CBK_ROUTE;
    case "mmf":
      return MMF_ROUTE;
    case "bank":
      return BANK_ROUTE;
    case "market_asset": {
      const key = (subtype ?? "").trim().toLowerCase();
      if (key === "equity" || key === "reit" || key === "offshore_fund" || key === "sacco") {
        return MARKET_ASSET_ROUTES[key];
      }
      return null;
    }
    default:
      return null;
  }
}
