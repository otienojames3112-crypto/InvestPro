/**
 * Slice 8h-1 — UI catalogue source display cleanup for MMF and Bank.
 *
 * Slice 8f preserved a manager's captured `sourceLabel`/`sourceUrl`/`sourceAsOfDate`
 * onto `extendedFields` at promotion time, but the MMF/Bank catalogue PAGES never
 * looked at `extendedFields` for source display at all — MMF's table only checked
 * whether the top-level `source` column happened to itself be a URL, and Bank's
 * drawer never rendered a clickable link anywhere, plus its raw "Full profile" dump
 * would have shown the newly-stamped source keys a second time as ugly `key: value`
 * text. This slice adds one shared pure helper, `resolveCatalogueSource()`
 * (client/src/lib/format.ts), and wires it into both pages.
 *
 * Two layers of test:
 *   A. `resolveCatalogueSource` — genuinely pure, dependency-free (just `URL`/
 *      `Date`/string methods) — imported and called directly for real behavioural
 *      proof, the same way Slice 8f's `buildSourceEnrichment` was.
 *   B. MmfFunds.tsx / BankInstruments.tsx wiring — this repo has no jsdom/
 *      testing-library for client components (vitest runs `environment: "node"`);
 *      the established convention (askAiSearchCheckbox, holdingsSourceProvenance,
 *      round85/86/97/98/102, etc.) is a static read of the source file plus
 *      targeted string/regex assertions. No DB, no network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveCatalogueSource } from "@/lib/format";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

// ── A. resolveCatalogueSource — pure, real behavioural tests ──────────────────

describe("Slice 8h-1 · A — resolveCatalogueSource (pure, no DB)", () => {
  it("1. MMF-shaped row: source='Factsheet' + extendedFields.sourceUrl set — url resolves to the extendedFields link, label to the source label", () => {
    const result = resolveCatalogueSource("Factsheet", { sourceUrl: "https://cytonn.com/factsheet.pdf" }, "2026-07-01");
    expect(result.url).toBe("https://cytonn.com/factsheet.pdf");
    expect(result.label).toBe("Factsheet");
    expect(result.asOf).toBe("2026-07-01");
  });

  it("2. MMF-shaped row: no extendedFields.sourceUrl, source itself is plain text — existing fallback behaviour is kept (no link, label shown)", () => {
    const result = resolveCatalogueSource("Cytonn factsheet, June 2026", null, "2026-06-15");
    expect(result.url).toBeNull();
    expect(result.label).toBe("Cytonn factsheet, June 2026");
  });

  it("2b. pre-8f behaviour preserved: no extendedFields at all, but source itself IS a URL — still resolves as a clickable link (the original isUrl(fund.source) fallback)", () => {
    const result = resolveCatalogueSource("https://cytonn.com/factsheet", undefined, "2026-06-15");
    expect(result.url).toBe("https://cytonn.com/factsheet");
    expect(result.label).toBe("cytonn.com");
  });

  it("3. Bank-shaped row: source='Product page' + extendedFields.sourceUrl set — url resolves to the extendedFields link", () => {
    const result = resolveCatalogueSource("Product page", { sourceUrl: "https://equitybank.co.ke/products/fd" }, null);
    expect(result.url).toBe("https://equitybank.co.ke/products/fd");
    expect(result.label).toBe("Product page");
  });

  it("4. Bank-shaped row: no extendedFields.sourceUrl, source is plain text — no link, existing fallback text label kept", () => {
    const result = resolveCatalogueSource("Bank product page, June 2026", { sourceLabel: "Bank product page, June 2026" }, null);
    expect(result.url).toBeNull();
    expect(result.label).toBe("Bank product page, June 2026");
  });

  it("5. extendedFields.sourceUrl wins over source-as-URL when BOTH are URLs (the trusted envelope link is preferred)", () => {
    const result = resolveCatalogueSource(
      "https://stale.example.com/old",
      { sourceUrl: "https://fresh.example.com/new" },
      null,
    );
    expect(result.url).toBe("https://fresh.example.com/new");
  });

  it("6. source-as-of: prefers the top-level asOfDate when present", () => {
    const result = resolveCatalogueSource("Source", null, "2026-05-01");
    expect(result.asOf).toBe("2026-05-01");
  });

  it("6b. source-as-of: falls back to extendedFields.sourceAsOfDate when asOfDate is null", () => {
    const result = resolveCatalogueSource("Source", { sourceAsOfDate: "2026-04-01" }, null);
    expect(result.asOf).toBe("2026-04-01");
  });

  it("7. label falls back to extendedFields.sourceLabel when the top-level source column is empty", () => {
    const result = resolveCatalogueSource(null, { sourceLabel: "CBK website" }, null);
    expect(result.label).toBe("CBK website");
  });

  it("8. returns null label/url/asOf when nothing is present anywhere — never fabricates a fake source", () => {
    const result = resolveCatalogueSource(null, null, null);
    expect(result.label).toBeNull();
    expect(result.url).toBeNull();
    expect(result.asOf).toBeNull();
  });

  it("9. non-http(s) protocols are never treated as a clickable URL", () => {
    const result = resolveCatalogueSource("mailto:manager@example.com", null, null);
    expect(result.url).toBeNull();
    expect(result.label).toBe("mailto:manager@example.com");
  });

  it("10. a long non-URL label is truncated to a readable length, never shown as raw unbounded text", () => {
    const long = "A very long source description that goes on and on past thirty-two characters";
    const result = resolveCatalogueSource(long, null, null);
    expect(result.label!.length).toBeLessThanOrEqual(31);
    expect(result.label).toContain("…");
  });

  it("11. a URL label is shortened to its hostname (www. stripped), not shown as the full raw URL", () => {
    const result = resolveCatalogueSource("https://www.centralbank.go.ke/some/deep/path?x=1", null, null);
    expect(result.label).toBe("centralbank.go.ke");
  });
});

// ── B. MmfFunds.tsx / BankInstruments.tsx wiring — static source scan ─────────

const mmfFunds = read("client/src/pages/MmfFunds.tsx");
const bankInstruments = read("client/src/pages/BankInstruments.tsx");

describe("Slice 8h-1 · B — MmfFunds.tsx wiring", () => {
  it("imports the shared resolveCatalogueSource helper", () => {
    expect(mmfFunds).toContain('import { resolveCatalogueSource, type CatalogueSourceExtendedFields } from "@/lib/format";');
  });

  it("the Fund type now carries extendedFields for source display", () => {
    expect(mmfFunds).toContain("extendedFields?: CatalogueSourceExtendedFields | null;");
  });

  it("the per-row source cell resolves via resolveCatalogueSource, not the old source-only isUrl check", () => {
    expect(mmfFunds).toContain(
      "const catSource = resolveCatalogueSource(fund.source, fund.extendedFields, fund.asOfDate);",
    );
    // The old standalone isUrl() helper (source-only URL check) is gone — its logic
    // now lives inside resolveCatalogueSource, shared with Bank.
    expect(mmfFunds).not.toContain("function isUrl(source: string | null): boolean {");
  });

  it("renders a clickable <a> when catSource.url is present, plain text when it isn't, and 'No source' when there's no label at all", () => {
    const idx = mmfFunds.indexOf("{catSource.label ? (");
    const cellBlock = mmfFunds.slice(idx, idx + 900);
    expect(cellBlock).toContain("catSource.url ? (");
    expect(cellBlock).toContain("href={catSource.url}");
    expect(cellBlock).toContain("{catSource.label}");
    expect(cellBlock).toContain("No source");
  });

  it("as-of freshness display uses the resolved catSource.asOf, not just the raw asOfDate column", () => {
    expect(mmfFunds).toContain(
      'catSource.asOf ? `as of ${String(catSource.asOf).slice(0, 10)} · ${fresh.label}` : "no as-of date"',
    );
  });

  it("table structure outside the source cell — Stage 10a-3 replaced Stage 10a-2's grouped 'Yield'/'Cost & tax' captions with one explicit column per established MMF field (see server/mmfFieldParity3.test.ts for the full column-parity proof); same underlying sort keys throughout", () => {
    for (const header of [
      "Fund <SortIcon",
      "EAR <SortIcon",
      "Gross yield <SortIcon",
      "Management fee <SortIcon",
      "Minimum investment <SortIcon",
      "AUM <SortIcon",
    ]) {
      expect(mmfFunds).toContain(header);
    }
    expect(mmfFunds).toContain('<th className="text-left px-4 py-3 font-medium">Source &amp; freshness</th>');
  });
});

describe("Slice 8h-1 · B — BankInstruments.tsx wiring", () => {
  it("imports the shared resolveCatalogueSource helper", () => {
    expect(bankInstruments).toContain('import { resolveCatalogueSource } from "@/lib/format";');
  });

  it("the drawer's Source fact resolves via resolveCatalogueSource and renders a clickable link when a URL is available", () => {
    expect(bankInstruments).toContain(
      "const catSource = resolveCatalogueSource(drawerRow.source, drawerRow.extendedFields, drawerRow.asOfDate);",
    );
    const idx = bankInstruments.indexOf("const catSource = resolveCatalogueSource(drawerRow.source");
    const nextIdx = bankInstruments.indexOf("Stage 10b-1", idx);
    const block = bankInstruments.slice(idx, nextIdx);
    expect(block).toContain("catSource.url ? (");
    expect(block).toContain("href={catSource.url}");
    expect(block).toContain("No source");
  });

  it("the drawer's As-of fact uses the resolved catSource.asOf, falling back through the same helper as MMF", () => {
    expect(bankInstruments).toContain('value={catSource.asOf ? asOfLabel(catSource.asOf) : "—"}');
  });

  // Stage 10b-1 note: the raw 'Full profile' Object.entries dump this test
  // originally checked is REMOVED entirely (not just re-filtered) — every
  // established Bank field it could show (Product name, Early withdrawal
  // rule) is now a clean, contract-labeled DrawerFact instead, same
  // convention CBK's drawer (Stage 9c) already established. See
  // server/bankFieldParity.test.ts test 10 for the replacement proof.
  it("the raw 'Full profile' dump no longer exists — replaced by clean contract-labeled DrawerFacts (Stage 10b-1)", () => {
    expect(bankInstruments).not.toContain("Full profile");
    expect(bankInstruments).not.toContain("Object.entries(drawerRow.extendedFields)");
  });

  // Stage 10b-1 note: the table gained explicit columns for every established
  // Bank field (Product name, Net return after WHT, WHT, Early withdrawal
  // rule, Fees/charges, Access speed, Source & freshness) — see
  // server/bankFieldParity.test.ts test 6 for the full column-parity proof.
  // This test now asserts the CURRENT structure so it stays a real
  // regression guard rather than a stale pin.
  it("table structure reflects the Stage 10b-1 explicit-column redesign — same underlying data, more established fields visible", () => {
    expect(bankInstruments).toContain("<TableHead>Bank</TableHead>");
    expect(bankInstruments).toContain("<TableHead>Product name</TableHead>");
    expect(bankInstruments).toContain("<TableHead>Product type</TableHead>");
    expect(bankInstruments).toContain('<TableHead className="text-right">Minimum deposit</TableHead>');
    expect(bankInstruments).toContain("<TableHead>Tenor / notice</TableHead>");
    expect(bankInstruments).toContain('<TableHead className="text-right">Indicative rate</TableHead>');
    expect(bankInstruments).toContain("<TableHead>Negotiable</TableHead>");
    expect(bankInstruments).toContain("<TableHead>Source &amp; freshness</TableHead>");
  });
});
