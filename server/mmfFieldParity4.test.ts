/**
 * Stage 10a-4 — MMF Reference Catalogue responsive table UX.
 *
 * Stage 10a-3 made the established MMF fields actual visible table columns
 * (14 of them), closing the field-parity gap — but live verification found
 * the resulting table was too wide to scan: too many equal-width columns
 * made the catalogue hard to read at a glance. This slice replaces the
 * one-column-per-field layout with:
 *   1. A compact grouped PRIMARY row (Fund / Yield / Cost & tax / Entry &
 *      liquidity / Size / Source & freshness / Actions) — the quick-decision
 *      summary that stays visible without any interaction.
 *   2. A per-row EXPAND control ("View fields" text link + chevron) that
 *      reveals the full established MMF field set in a clean grid below
 *      that row, reusing the SAME `DrawerFact` component the detail drawer
 *      already uses — so the two views can never drift apart.
 *   3. The existing `MmfDetailDrawer` unchanged, remaining a deeper
 *      supplementary view (unaffected by this slice).
 *
 * No established field is lost — every one Stage 10a-3 added a column for
 * is still reachable, either directly in the primary row's grouped cells
 * (EAR/Gross/Net yield, Fee/WHT, Min investment/Withdrawal period, AUM,
 * Source/as-of) or in the expand grid (all of the above plus Daily
 * yield/Risk profile, which have no room in the compact primary row).
 * Fund and Actions are sticky (`position: sticky`) so identity and the
 * ability to act are never lost while scrolling.
 *
 * Display-only: no promotion/gate/schema change. MMF-only.
 *
 * Established convention — no jsdom in this repo: static source-text scan of
 * `MmfFunds.tsx`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const mmfFundsPage = read("client/src/pages/MmfFunds.tsx");

const tableIdx = mmfFundsPage.indexOf("{/* Table */}");
const tableEndIdx = mmfFundsPage.indexOf("{/* Reference-vs-holdings separation");
const tableBlock = mmfFundsPage.slice(tableIdx, tableEndIdx);

describe("Stage 10a-4 · A — the primary row uses compact grouped quick-decision columns", () => {
  it("1. the header row has exactly the 7 grouped categories, not one column per established field", () => {
    for (const header of [
      "Fund <SortIcon",
      "Yield <SortIcon",
      "Cost &amp; tax <SortIcon",
      "Entry &amp; liquidity <SortIcon",
      "Size <SortIcon",
      "Source &amp; freshness",
      ">Actions<",
    ]) {
      expect(tableBlock).toContain(header);
    }
    // The one-column-per-field headers Stage 10a-3 introduced are gone.
    expect(tableBlock).not.toContain("Daily yield<");
    expect(tableBlock).not.toContain("Net yield<");
    expect(tableBlock).not.toContain(">WHT<");
    expect(tableBlock).not.toContain("Withdrawal period<");
    expect(tableBlock).not.toContain("Risk profile<");
  });
});

describe("Stage 10a-4 · B — expand/collapse control exists per row", () => {
  it("2. each row has a chevron button and a 'View fields'/'Hide fields' text toggle wired to per-row expand state", () => {
    expect(mmfFundsPage).toContain("const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());");
    expect(mmfFundsPage).toContain("const toggleExpanded = (id: number) =>");
    expect(tableBlock).toContain("onClick={() => toggleExpanded(fund.id)}");
    expect(tableBlock).toContain('{isExpanded ? "Hide fields" : "View fields"}');
    expect(tableBlock).toContain("isExpanded ? <ChevronDown");
    expect(tableBlock).toContain("aria-expanded={isExpanded}");
  });
});

describe("Stage 10a-4 · C — the expanded row shows the full established MMF field set", () => {
  const expandIdx = tableBlock.indexOf("isExpanded && (");
  const expandBlock = tableBlock.slice(expandIdx);

  it("3. the expand grid renders when isExpanded, spanning the full 8-column table width", () => {
    expect(tableBlock).toContain('<td colSpan={8} className="px-4 py-4">');
    expect(expandBlock).toContain('<div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3">');
  });

  it("4/5. every established field is present: Fund name, Fund manager, EAR, Daily yield, Gross yield, Net yield, WHT, Management fee, Minimum investment, Withdrawal period, AUM, Risk profile, Source label/link, Source-as-of date", () => {
    expect(expandBlock).toContain('<DrawerFact label="Fund name" value={fund.fundName} />');
    expect(expandBlock).toContain('<DrawerFact label="Fund manager" value={fund.company} />');
    expect(expandBlock).toContain('<DrawerFact label="EAR" value={`${fund.ear.toFixed(2)}%`} />');
    expect(expandBlock).toContain('<DrawerFact label="Daily yield" value={dailyYield ?? "—"} />');
    expect(expandBlock).toContain('<DrawerFact label="Gross yield" value={`${fund.grossYield.toFixed(2)}%`} />');
    expect(expandBlock).toContain('<DrawerFact label="Net yield" value={`${netYield.toFixed(2)}%`} />');
    expect(expandBlock).toContain('<DrawerFact label="WHT" value={`${whtRate.toFixed(2)}%`} />');
    expect(expandBlock).toContain('<DrawerFact label="Management fee" value={`${fund.managementFee.toFixed(2)}%`} />');
    expect(expandBlock).toContain('<DrawerFact label="Minimum investment" value={`KES ${fund.minInvestment.toLocaleString("en-KE")}`} />');
    expect(expandBlock).toContain('<DrawerFact label="Withdrawal period" value={withdrawalPeriod ?? "—"} />');
    expect(expandBlock).toContain(
      '{fund.aumMillions != null ? `KES ${fund.aumMillions.toLocaleString("en-KE", { maximumFractionDigits: 0 })}M` : "—"}',
    );
    expect(expandBlock).toContain('<DrawerFact label="Risk profile" value="Not available" />');
    expect(expandBlock).toContain("Source label/link</p>");
    expect(expandBlock).toContain('label="Source-as-of date"');
  });

  it("reuses the SAME DrawerFact component the detail drawer already uses, not a second hand-typed fact renderer", () => {
    expect(mmfFundsPage).toContain("function DrawerFact({ label, value }: { label: string; value: string }) {");
    // Only one DrawerFact definition exists in the whole file.
    const occurrences = mmfFundsPage.split("function DrawerFact(").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("Stage 10a-4 · D/E — key fields stay visible in the primary row too (not expand-only)", () => {
  it("EAR/Gross/Net yield remain visible in the compact primary Yield cell", () => {
    expect(tableBlock).toContain("{fund.ear.toFixed(2)}%");
    expect(tableBlock).toContain("Gross {fund.grossYield.toFixed(2)}% · Net {netYield.toFixed(2)}%");
  });

  it("Management fee/WHT remain visible in the compact primary Cost & tax cell — WHT is never lost after being saved/edited", () => {
    expect(tableBlock).toContain("{fund.managementFee.toFixed(2)}% fee</div>");
    expect(tableBlock).toContain("WHT {whtRate.toFixed(2)}%</div>");
  });

  it("Minimum investment/Withdrawal period remain visible in the compact primary Entry & liquidity cell — Withdrawal period is never lost after being saved/edited", () => {
    expect(tableBlock).toContain('KES {fund.minInvestment.toLocaleString("en-KE")}');
    expect(tableBlock).toContain('{withdrawalPeriod ?? "—"} withdrawal');
  });

  it("AUM remains visible in the compact primary Size cell", () => {
    expect(tableBlock).toContain(
      '{fund.aumMillions != null ? `KES ${fund.aumMillions.toLocaleString("en-KE", { maximumFractionDigits: 0 })}M` : "—"}',
    );
  });

  it("6. Source-as-of is readable in the primary Source & freshness cell, never a raw epoch number", () => {
    expect(tableBlock).toContain("String(catSource.asOf).slice(0, 10)");
  });

  it("7. Source label/link behavior (clickable when a URL is on record, 'No source' otherwise) is unchanged from 8h/10a", () => {
    expect(tableBlock).toContain(
      "const catSource = resolveCatalogueSource(fund.source, fund.extendedFields, fund.asOfDate);",
    );
    expect(tableBlock).toContain("catSource.url ? (");
    expect(tableBlock).toContain("href={catSource.url}");
    expect(tableBlock).toContain("No source</span>");
  });
});

describe("Stage 10a-4 · F — sticky Fund/Actions columns for horizontal-scroll safety", () => {
  it("3. Fund column is sticky on both header and body cells", () => {
    expect(tableBlock).toContain('sticky left-0 z-10 bg-muted/30');
    expect(tableBlock).toContain('sticky left-0 z-10 bg-background');
  });

  it("Actions column is sticky on both header and body cells", () => {
    expect(tableBlock).toContain('sticky right-0 z-10 bg-muted/30');
    expect(tableBlock).toContain('sticky right-0 z-10 bg-background');
  });

  it("the table still scrolls horizontally as a fallback for anything that doesn't fit", () => {
    expect(mmfFundsPage).toContain('<CardContent className="p-0 overflow-x-auto">');
  });
});

describe("Stage 10a-4 · the drawer remains supplementary and untouched", () => {
  it("8. MmfDetailDrawer still exists, unaffected by the primary/expand-row redesign", () => {
    expect(mmfFundsPage).toContain("function MmfDetailDrawer(");
    const idx = mmfFundsPage.indexOf("function MmfDetailDrawer(");
    const nextIdx = mmfFundsPage.indexOf("export default function MmfFunds(");
    const block = mmfFundsPage.slice(idx, nextIdx);
    expect(block).toContain('fieldByKey("riskProfile")');
  });

  it("the 'View full details' action opening the drawer is still present, distinct from the new 'View fields' expand toggle", () => {
    expect(mmfFundsPage).toContain("onClick={() => setDetailFund(fund)}");
    expect(mmfFundsPage).toContain("View full details");
  });
});

describe("Stage 10a-4 · no raw JSON or raw camelCase keys anywhere in the redesigned table", () => {
  it("9. the table block never dumps extendedFields or a raw Object.entries listing", () => {
    expect(tableBlock).not.toContain("Object.entries(fund.extendedFields");
    expect(tableBlock).not.toContain("JSON.stringify");
  });

  it("no raw camelCase field name is interpolated as literal display text (every value goes through a labeled cell or DrawerFact)", () => {
    expect(tableBlock).not.toContain("{fund.whtRate}");
    expect(tableBlock).not.toContain("{fund.extendedFields}");
  });
});

describe("Stage 10a-4 · sorting preserved for every grouped category with a stable underlying sort key", () => {
  it("Fund/Yield(EAR)/Cost & tax(fee)/Entry & liquidity(min investment)/Size(AUM) each keep their sort button", () => {
    for (const key of ["fundName", "ear", "managementFee", "minInvestment", "aumMillions"]) {
      expect(tableBlock).toContain(`handleSort("${key}")`);
    }
  });
});
