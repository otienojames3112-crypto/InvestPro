import { describe, it, expect } from "vitest";
import {
  LEDGER_COLUMNS,
  LEDGER_CSV_HEADERS,
  normaliseLedgerLabel,
} from "../../shared/ledgerColumns";

/**
 * Suite 8 — CSV headers match displayed labels.
 *
 * The Ledger CSV export and the on-screen table header both derive from the
 * single LEDGER_COLUMNS source, so they can never silently drift. This suite
 * locks that contract: the CSV header row is exactly the column csvHeaders in
 * order, the headers a user relies on ("MMF Interest", "Swept → Securities")
 * are present, and every visible label normalises back to its CSV header (with
 * the two intentional richer-label exceptions explicitly allowed).
 */

describe("CSV headers match displayed labels (Ledger export contract)", () => {
  it("LEDGER_CSV_HEADERS is exactly the column csvHeaders, in order", () => {
    expect(LEDGER_CSV_HEADERS).toEqual(LEDGER_COLUMNS.map((c) => c.csvHeader));
  });

  it("every column's csvHeader appears in LEDGER_CSV_HEADERS", () => {
    for (const col of LEDGER_COLUMNS) {
      expect(LEDGER_CSV_HEADERS).toContain(col.csvHeader);
    }
  });

  it("the headers users depend on are present", () => {
    expect(LEDGER_CSV_HEADERS).toContain("MMF Interest");
    expect(LEDGER_CSV_HEADERS).toContain("Swept → Securities");
  });

  it("CSV headers are unique (no duplicate columns)", () => {
    const set = new Set(LEDGER_CSV_HEADERS);
    expect(set.size).toBe(LEDGER_CSV_HEADERS.length);
  });

  it("each visible label normalises to its CSV header (or is a declared exception)", () => {
    for (const col of LEDGER_COLUMNS) {
      const normalisedVisible = normaliseLedgerLabel(col.displayLabel);
      if (col.displayDiffersFromCsv) {
        // The richer on-screen label is intentionally different from the CSV.
        if (col.key === "Swept → Securities") {
          // Layout uses nbsp + arrow entity, but normalises back to the CSV text.
          expect(normalisedVisible).toBe("Swept → Securities");
          expect(normalisedVisible).toBe(col.csvHeader);
        } else if (col.key === "Total") {
          // "Total" (CSV) is shown as "Projected / Actual Value" on screen.
          expect(normalisedVisible).toBe("Projected / Actual Value");
          expect(normalisedVisible).not.toBe(col.csvHeader);
        }
      } else {
        // Ordinary columns: the visible label is exactly the CSV header.
        expect(normalisedVisible).toBe(col.csvHeader);
      }
    }
  });

  it("the 'Swept → Securities' visible label really uses non-breaking spaces", () => {
    const swept = LEDGER_COLUMNS.find((c) => c.key === "Swept → Securities")!;
    // Layout integrity: the on-screen label keeps nbsp around the arrow so it
    // never wraps mid-phrase; the CSV stays plain.
    expect(swept.displayLabel).toContain("\u00a0");
    expect(swept.csvHeader).not.toContain("\u00a0");
  });
});
