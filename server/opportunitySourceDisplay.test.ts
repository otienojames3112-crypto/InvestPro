/**
 * Slice 8h-2 — CBK / opportunities / market-asset (equity/REIT/offshore
 * fund/SACCO) source display cleanup. Extends the 8h-1 pattern (MMF/Bank) to the
 * opportunity-backed catalogue views.
 *
 * Audit summary: `opportunities.list`/`opportunities.byRef` already return full,
 * unfiltered rows (Drizzle `select()`, no field-picking like MMF/Bank's routers
 * do) — `dataSource`, `dataAsOf`, `fieldProvenance`, and `extendedFields` were
 * ALL already on the wire before this slice. The gap was purely display-side:
 *   - CbkSecuritiesReference.tsx's GovRow and MarketAssetsReference.tsx's
 *     MarketRow (which together cover CBK + all four market-asset subtypes —
 *     MarketAssetsReference filters on `["equity","reit","offshore_fund","alt"]`,
 *     a single shared row component for all of them) both rendered `r.dataSource`
 *     as plain, never-clickable text in their "Source & freshness" cell — never
 *     checking `extendedFields.sourceUrl`, `fieldProvenance`, or even whether
 *     `dataSource` itself was a URL.
 *   - OpportunityDetail.tsx's per-figure `Fact` component already had a WORKING
 *     clickable-link path via `provenance.sourceUrl` (Part 7.1, predates Slice
 *     8f) for the 6 figures `promotionProvenance()` covers (yield/price/
 *     trailingReturn/tenor/maturity/expense) — genuinely NOT a gap. The real gap
 *     was figures with NO per-figure provenance entry at all (e.g. "Liquidity",
 *     which previously rendered with no source/as-of line whatsoever) and any
 *     row whose provenance predates a captured URL — neither had a fallback.
 *
 * Fix: `resolveCatalogueSource` (8h-1) extended with an optional 4th arg,
 * `fieldProvenanceUrl`, tried after `extendedFields.sourceUrl` but before the
 * source-is-itself-a-URL fallback — fully backward compatible (MMF/Bank's 3-arg
 * calls are untouched). New `firstFieldProvenanceSourceUrl()` extracts a safe,
 * already-governed URL from an opportunity's fieldProvenance map. Wired into
 * GovRow/MarketRow (row-level clickable source cell, same visual pattern as
 * MMF/Bank) and into OpportunityDetail's `Fact` via a new `fallbackSourceUrl`
 * prop (per-figure provenance URL still wins when present — it's more specific).
 *
 * Deliberately OUT of scope (see audit report shown to the user before this
 * diff): AllApprovedInstruments.tsx is a cross-catalogue table spanning MMF/
 * Bank/CBK/market-asset rows together — adding a source column there would
 * necessarily touch MMF/Bank rendering too, which this slice's own scope
 * excludes ("No MMF changes. No Bank changes."). SourceConflicts/AiReview/
 * ModelDrawer are manager review-workflow tools, not the end-user catalogue
 * display this slice's goal is about.
 *
 * Two layers of test (same convention as 8h-1 — no jsdom/testing-library,
 * `environment: "node"`):
 *   A. `resolveCatalogueSource`'s new 4th arg + `firstFieldProvenanceSourceUrl` —
 *      genuinely pure, imported and called directly for real behavioural proof.
 *   B. CbkSecuritiesReference.tsx / MarketAssetsReference.tsx /
 *      OpportunityDetail.tsx wiring — static source-text scan.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCatalogueSource, firstFieldProvenanceSourceUrl } from "@/lib/format";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// ── A. resolveCatalogueSource (4-arg) + firstFieldProvenanceSourceUrl ─────────

describe("Slice 8h-2 · A — resolveCatalogueSource's fieldProvenanceUrl fallback (pure, no DB)", () => {
  it("1. CBK/opportunity row: dataSource label + extendedFields.sourceUrl set — renders a clickable link from extendedFields, ignoring fieldProvenanceUrl entirely", () => {
    const result = resolveCatalogueSource(
      "CBK auction results",
      { sourceUrl: "https://www.centralbank.go.ke/auction" },
      "2026-07-01",
      "https://ignored.example.com",
    );
    expect(result.url).toBe("https://www.centralbank.go.ke/auction");
    expect(result.label).toBe("CBK auction results");
  });

  it("2. market-asset row: source label + extendedFields.sourceUrl set — renders a clickable link (same as CBK)", () => {
    const result = resolveCatalogueSource("NSE market data", { sourceUrl: "https://www.nse.co.ke/equity" }, "2026-06-15");
    expect(result.url).toBe("https://www.nse.co.ke/equity");
    expect(result.label).toBe("NSE market data");
  });

  it("3. existing label display still works when there is no source URL anywhere", () => {
    const result = resolveCatalogueSource("Public factsheet, June 2026", null, "2026-06-01");
    expect(result.url).toBeNull();
    expect(result.label).toBe("Public factsheet, June 2026");
  });

  it("4. existing source-as-of display still works (prefers dataAsOf, falls back to extendedFields.sourceAsOfDate)", () => {
    expect(resolveCatalogueSource("Source", null, "2026-05-01").asOf).toBe("2026-05-01");
    expect(resolveCatalogueSource("Source", { sourceAsOfDate: "2026-04-01" }, null).asOf).toBe("2026-04-01");
  });

  it("5a. fieldProvenanceUrl fallback fires ONLY when extendedFields.sourceUrl is absent", () => {
    const result = resolveCatalogueSource("CBK auction results", null, null, "https://www.centralbank.go.ke/legacy-source");
    expect(result.url).toBe("https://www.centralbank.go.ke/legacy-source");
  });

  it("5b. fieldProvenanceUrl is ignored when it is not a valid http(s) URL (never trusted blindly)", () => {
    const result = resolveCatalogueSource("Source label", null, null, "not-a-url");
    expect(result.url).toBeNull();
  });

  it("5c. fieldProvenanceUrl still loses to a top-level source-is-itself-a-URL when extendedFields is absent and fieldProvenanceUrl is invalid", () => {
    const result = resolveCatalogueSource("https://direct.example.com/source", null, null, "not-a-url");
    expect(result.url).toBe("https://direct.example.com/source");
  });

  it("6. omitting the 4th argument entirely behaves exactly as it did in 8h-1 (MMF/Bank backward compatibility)", () => {
    const withoutArg = resolveCatalogueSource("Factsheet", { sourceUrl: "https://example.com/a" }, "2026-01-01");
    const withUndefinedArg = resolveCatalogueSource("Factsheet", { sourceUrl: "https://example.com/a" }, "2026-01-01", undefined);
    expect(withoutArg).toEqual(withUndefinedArg);
  });
});

describe("Slice 8h-2 · A — firstFieldProvenanceSourceUrl (pure, no DB)", () => {
  it("returns the first valid http(s) sourceUrl found, in a fixed deterministic key order", () => {
    const fp = {
      maturity: { value: "x", source: "s", sourceUrl: "https://maturity.example.com", asOf: null, fetchedAt: null, verificationState: "ai_extracted" as const },
      yield: { value: "x", source: "s", sourceUrl: "https://yield.example.com", asOf: null, fetchedAt: null, verificationState: "ai_extracted" as const },
    };
    expect(firstFieldProvenanceSourceUrl(fp)).toBe("https://yield.example.com");
  });

  it("skips entries with no sourceUrl or an invalid one, falling through to the next key", () => {
    const fp = {
      yield: { value: "x", source: "s", sourceUrl: null, asOf: null, fetchedAt: null, verificationState: "ai_extracted" as const },
      price: { value: "x", source: "s", sourceUrl: "not-a-url", asOf: null, fetchedAt: null, verificationState: "ai_extracted" as const },
      distribution: { value: "x", source: "s", sourceUrl: "https://distribution.example.com", asOf: null, fetchedAt: null, verificationState: "ai_extracted" as const },
    };
    expect(firstFieldProvenanceSourceUrl(fp)).toBe("https://distribution.example.com");
  });

  it("returns null for an empty, null, or undefined map — never fabricates a URL", () => {
    expect(firstFieldProvenanceSourceUrl({})).toBeNull();
    expect(firstFieldProvenanceSourceUrl(null)).toBeNull();
    expect(firstFieldProvenanceSourceUrl(undefined)).toBeNull();
  });
});

// ── B. CbkSecuritiesReference.tsx / MarketAssetsReference.tsx / OpportunityDetail.tsx wiring ──

const cbkPage = read("client/src/pages/CbkSecuritiesReference.tsx");
const marketAssetsPage = read("client/src/pages/MarketAssetsReference.tsx");
const opportunityDetail = read("client/src/pages/OpportunityDetail.tsx");

describe("Slice 8h-2 · B — CbkSecuritiesReference.tsx (GovRow) wiring", () => {
  it("imports resolveCatalogueSource and firstFieldProvenanceSourceUrl", () => {
    expect(cbkPage).toContain('import { resolveCatalogueSource, firstFieldProvenanceSourceUrl } from "@/lib/format";');
  });

  it("GovRow resolves source via resolveCatalogueSource, using the field-provenance fallback and the resolved as-of for staleness", () => {
    expect(cbkPage).toContain(
      "const catSource = resolveCatalogueSource(r.dataSource, r.extendedFields, r.dataAsOf, firstFieldProvenanceSourceUrl(fp));",
    );
    expect(cbkPage).toContain("const stale = rateStaleness(catSource.asOf);");
  });

  it("renders a clickable link when catSource.url is present, plain text otherwise, and a distinct 'Source not recorded' state", () => {
    const idx = cbkPage.indexOf("{catSource.label ? (");
    const block = cbkPage.slice(idx, idx + 900);
    expect(block).toContain("catSource.url ? (");
    expect(block).toContain("href={catSource.url}");
    expect(block).toContain("{catSource.label}");
    expect(block).toContain("Source not recorded");
  });

  it("the checked/total provenance badge and freshness clock are unchanged outside the source cell", () => {
    expect(cbkPage).toContain("{checked}/{total} checked");
    expect(cbkPage).toContain('{stale.label}{stale.isStale ? " · may be stale" : ""}');
  });

  it("existing table structure (headers, sort keys) is unchanged", () => {
    expect(cbkPage).toContain('<TableHead><SortHead k="name">Security</SortHead></TableHead>');
    expect(cbkPage).toContain('<SortHead k="yieldPct" numeric>Yield / coupon</SortHead>');
    expect(cbkPage).toContain('<SortHead k="tenorYears" numeric>Tenor</SortHead>');
    expect(cbkPage).toContain('<SortHead k="maturityDate" numeric>Maturity</SortHead>');
  });
});

describe("Slice 8h-2 · B — MarketAssetsReference.tsx (MarketRow) wiring — covers equity/REIT/offshore fund/SACCO", () => {
  it("imports resolveCatalogueSource and firstFieldProvenanceSourceUrl", () => {
    expect(marketAssetsPage).toContain('import { resolveCatalogueSource, firstFieldProvenanceSourceUrl } from "@/lib/format";');
  });

  it("covers all four market-asset subtypes through one shared row component (MARKET_CLASSES)", () => {
    expect(marketAssetsPage).toContain('const MARKET_CLASSES = ["equity", "reit", "offshore_fund", "alt"] as const;');
  });

  it("MarketRow resolves source via resolveCatalogueSource, using the field-provenance fallback and the resolved as-of for staleness", () => {
    expect(marketAssetsPage).toContain(
      "const catSource = resolveCatalogueSource(r.dataSource, r.extendedFields, r.dataAsOf, firstFieldProvenanceSourceUrl(fp));",
    );
    expect(marketAssetsPage).toContain("const stale = rateStaleness(catSource.asOf);");
  });

  it("renders a clickable link when catSource.url is present, plain text otherwise, and a distinct 'Source not recorded' state", () => {
    const idx = marketAssetsPage.indexOf("{catSource.label ? (");
    const block = marketAssetsPage.slice(idx, idx + 900);
    expect(block).toContain("catSource.url ? (");
    expect(block).toContain("href={catSource.url}");
    expect(block).toContain("{catSource.label}");
    expect(block).toContain("Source not recorded");
  });

  it("existing table structure (headers, sort keys) is unchanged", () => {
    expect(marketAssetsPage).toContain('<TableHead><SortHead k="name">Instrument</SortHead></TableHead>');
    expect(marketAssetsPage).toContain('<SortHead k="lastPrice" numeric>Price</SortHead>');
    expect(marketAssetsPage).toContain('<SortHead k="yieldPct" numeric>Yield</SortHead>');
    expect(marketAssetsPage).toContain('<SortHead k="trailingReturnPct" numeric>Trailing 1Y</SortHead>');
    expect(marketAssetsPage).toContain('<SortHead k="expenseRatioPct" numeric>Fee</SortHead>');
  });
});

describe("Slice 8h-2 · B — OpportunityDetail.tsx (Fact) wiring", () => {
  it("imports resolveCatalogueSource and firstFieldProvenanceSourceUrl", () => {
    expect(opportunityDetail).toContain('import { resolveCatalogueSource, firstFieldProvenanceSourceUrl } from "@/lib/format";');
  });

  it("Fact gained a fallbackSourceUrl prop, and per-figure provenance.sourceUrl still wins over it (more specific, unchanged priority)", () => {
    expect(opportunityDetail).toContain("fallbackSourceUrl?: string | null;");
    expect(opportunityDetail).toContain("const sourceUrl = provenance?.sourceUrl ?? fallbackSourceUrl ?? null;");
  });

  it("catSource is resolved once per row and passed to every Fact call as fallbackSourceUrl", () => {
    expect(opportunityDetail).toContain(
      "const catSource = resolveCatalogueSource(r.dataSource, r.extendedFields, r.dataAsOf, firstFieldProvenanceSourceUrl(fp));",
    );
    const matches = opportunityDetail.match(/fallbackSourceUrl=\{catSource\.url\}/g) ?? [];
    // 6 provenance-backed figures (yield/price/trailingReturn/expense/tenor/maturity) + Liquidity = 7.
    expect(matches.length).toBe(7);
  });

  it("the Liquidity fact — previously the only Fact with NO source/as-of fallback at all — now gets one, same as every other figure", () => {
    const idx = opportunityDetail.indexOf('label="Liquidity"');
    const block = opportunityDetail.slice(idx, idx + 300);
    expect(block).toContain("fallbackSource={r.dataSource}");
    expect(block).toContain("fallbackAsOf={r.dataAsOf}");
    expect(block).toContain("fallbackSourceUrl={catSource.url}");
  });

  it("the 'Full instrument profile' raw dump excludes sourceLabel/sourceUrl/sourceAsOfDate — already folded into each figure's source line, never duplicated as raw text", () => {
    const idx = opportunityDetail.indexOf("Full instrument profile");
    const block = opportunityDetail.slice(idx, idx + 1200);
    expect(block).toContain('k !== "sourceLabel"');
    expect(block).toContain('k !== "sourceUrl"');
    expect(block).toContain('k !== "sourceAsOfDate"');
  });

  it("the per-figure clickable-link rendering itself (Part 7.1, predates this slice) is untouched", () => {
    expect(opportunityDetail).toContain("href={sourceUrl}");
    expect(opportunityDetail).toContain("target=\"_blank\"");
  });
});
