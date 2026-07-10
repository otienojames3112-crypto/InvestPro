/**
 * Stage 6b — source/as-of visibility on the Holdings tabs (MMF, Government, Bank).
 * This repo has no jsdom/testing-library for client components (vitest runs
 * `environment: "node"`); the established convention for asserting page behaviour
 * (round85, askAiSearchCheckbox, sourcesUsedPanel, gapFollowUpChips, etc.) is a
 * static read of the source file plus targeted string/regex assertions. No DB, no
 * network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const mmfAccounts = read("client/src/pages/MmfAccounts.tsx");
const securities = read("client/src/pages/Securities.tsx");
const bankHoldings = read("client/src/pages/BankHoldings.tsx");
const otherAssets = read("client/src/pages/OtherAssets.tsx");
const format = read("client/src/lib/format.ts");

describe("Stage 6b · MmfAccounts.tsx", () => {
  it("imports the shared formatSourceProvenance helper", () => {
    expect(mmfAccounts).toContain('import { formatKES, formatSourceProvenance } from "@/lib/format";');
  });

  it("the primary fund is cross-referenced by fundId against the already-fetched funds array (no new query)", () => {
    expect(mmfAccounts).toContain("const primaryFund = funds.find((f) => f.id === fundId) ?? null;");
    expect(mmfAccounts).toContain("useSelectedFund();");
    expect(mmfAccounts).toMatch(/hasFund,\s*fundId\s*}\s*=\s*useSelectedFund\(\)/);
  });

  it("renders the primary fund's source/as-of line inside the hasFund branch, computed from the catalogue lookup", () => {
    expect(mmfAccounts).toContain("const primaryProvenance = formatSourceProvenance(primaryFund?.source, primaryFund?.asOfDate);");
    const idx = mmfAccounts.indexOf("Primary fund card");
    const block = mmfAccounts.slice(idx, mmfAccounts.indexOf("Secondary accounts"));
    expect(block).toContain("{primaryProvenance}");
  });

  it("renders each secondary account's source/as-of from its holdingSnapshot", () => {
    const idx = mmfAccounts.indexOf("Secondary accounts");
    const block = mmfAccounts.slice(idx, mmfAccounts.indexOf("Add / Edit dialog") !== -1 ? mmfAccounts.indexOf("Add / Edit dialog") : mmfAccounts.length);
    expect(block).toContain("formatSourceProvenance(s.holdingSnapshot?.sourceUrl, s.holdingSnapshot?.sourceAsOfDate)");
  });

  it("does not fetch any new query for this feature (uses the existing mmfFunds.list / secondaryMmfs.list)", () => {
    expect(mmfAccounts).not.toMatch(/trpc\.\w+\.\w*[Ss]ource\w*\.useQuery/);
  });
});

describe("Stage 6b · Securities.tsx (Government)", () => {
  it("imports the shared formatSourceProvenance helper", () => {
    expect(securities).toContain(
      'import { formatKES, formatPct, getSecurityLabel, formatSourceProvenance } from "@/lib/format";',
    );
  });

  it("prefers dataSource/dataAsOf first, falling back to the holdingSnapshot, then to a manual-entry fallback", () => {
    expect(securities).toContain("s.dataSource ?? snapProv?.sourceUrl,");
    expect(securities).toContain("s.dataAsOf ?? snapProv?.sourceAsOfDate,");
    expect(securities).toContain('formatSourceProvenance(');
    expect(securities).toContain('"manual entry",');
  });

  it("renders as a compact icon+tooltip (title/aria-label), matching the row's existing Link2 tooltip convention — not a big inline line", () => {
    expect(securities).toContain("<span title={provenanceLabel} aria-label={provenanceLabel}>");
    const iconIdx = securities.indexOf("<span title={provenanceLabel}");
    const block = securities.slice(iconIdx, iconIdx + 100);
    expect(block).toContain("<Info");
  });

  it("the provenance tooltip text is distinct from the simulation 'Valued as of' badge — never the same string/meaning", () => {
    expect(securities).toContain("Valued as of {simLabel}");
    expect(securities).toContain('title="Current values are computed as of the simulated date, not the real clock."');
    // The two badges must never share their computation: provenance from
    // dataSource/dataAsOf/holdingSnapshot, simulation from simLabel/effectiveNowMs.
    const provIdx = securities.indexOf("const provenanceLabel");
    const provBlock = securities.slice(provIdx, provIdx + 400);
    expect(provBlock).not.toContain("simLabel");
  });

  it("the tooltip icon is placed in the Type column, alongside the existing 'linked to a recorded deposit' icon", () => {
    const idx = securities.indexOf("linkedSecurityIds.has(s.id)");
    const block = securities.slice(idx, idx + 500);
    expect(block).toContain("<Info");
    expect(block).toContain("provenanceLabel");
  });
});

describe("Stage 6b · BankHoldings.tsx", () => {
  it("imports the shared formatSourceProvenance helper", () => {
    expect(bankHoldings).toContain('import { formatKES, formatSourceProvenance } from "@/lib/format";');
  });

  it("uses holdingSnapshot.sourceUrl/sourceAsOfDate, falling back to rateAsOfDate for the date and 'manual entry' for the source", () => {
    const idx = bankHoldings.indexOf("Stage 6b — compact source/as-of provenance line");
    expect(idx).toBeGreaterThan(-1);
    const block = bankHoldings.slice(idx, idx + 500);
    expect(block).toContain("sourceUrl");
    expect(block).toContain("sourceAsOfDate ?? h.rateAsOfDate");
    expect(block).toContain('"manual entry"');
  });

  it("renders per holding, inside the same table cell as the existing Terms-at-purchase block", () => {
    const termsIdx = bankHoldings.indexOf("Terms at purchase");
    const provIdx = bankHoldings.indexOf("Stage 6b — compact source/as-of provenance line");
    expect(termsIdx).toBeGreaterThan(-1);
    expect(provIdx).toBeGreaterThan(termsIdx);
    // Still inside the same </TableCell> as the instrument name/badges — no new column.
    const cellCloseIdx = bankHoldings.indexOf("</TableCell>", termsIdx);
    expect(provIdx).toBeLessThan(cellCloseIdx);
  });
});

describe("Stage 6b · OtherAssets.tsx is unchanged (regression)", () => {
  it("the existing source/as-of line is byte-for-byte the same as before Stage 6b", () => {
    expect(otherAssets).toContain("Source: {holding.provenance.source ?? \"manual entry\"}");
    expect(otherAssets).toContain(
      "const asOfLabel = holding.provenance.asOf ? new Date(holding.provenance.asOf).toLocaleDateString() : null;",
    );
  });

  it("does not import or use the new shared formatSourceProvenance helper (untouched, own inline logic)", () => {
    expect(otherAssets).not.toContain("formatSourceProvenance");
  });
});

describe("Stage 6b · shared helper exists and is exported once", () => {
  it("formatSourceProvenance is defined in client/src/lib/format.ts and never returns blank", () => {
    expect(format).toContain("export function formatSourceProvenance(");
    expect(format).toContain('fallbackSource = "No source on record"');
  });
});

describe("Stage 6b · no behavior change outside display", () => {
  it("Securities.tsx: no calculation/valuation function was touched (currentSecurityValue/accretionProgress calls unchanged)", () => {
    expect(securities).toContain("const currentValue = currentSecurityValue(cvLot, new Date(effectiveNowMs));");
    expect(securities).toContain("const progress = accretionProgress(cvLot, new Date(effectiveNowMs));");
  });

  it("no new server router file or mutation was touched by this slice (grep-level sanity: no trpc mutation call added for provenance)", () => {
    for (const src of [mmfAccounts, securities, bankHoldings]) {
      expect(src).not.toMatch(/source[Pp]rovenance.*\.useMutation/);
    }
  });
});
