/**
 * Single source of truth for the Month Ledger's columns.
 *
 * Both the on-screen table header (client/src/pages/Ledger.tsx) and the CSV
 * export read this list, so the two can never silently drift apart. The
 * cross-page integrity test (`ledgerCsvHeaders.test.ts`) asserts the CSV header
 * row equals `LEDGER_COLUMNS.map(c => c.csvHeader)` and that every visible
 * label normalises to its CSV header.
 *
 * Two columns intentionally show a richer on-screen label than the flat CSV
 * header, and the test encodes exactly that expectation:
 *   - "Swept → Securities": the table renders it with non-breaking spaces and a
 *     `&rarr;` entity for layout; the CSV keeps the plain unicode arrow.
 *   - "Total" (CSV) is shown as "Projected / Actual Value" on screen, because a
 *     row is Actual or Projected depending on `isActual` (see the value-basis
 *     work). The CSV keeps the short, stable "Total" key for spreadsheets.
 */
export interface LedgerColumn {
  /** Stable identifier (also the CSV header text). */
  key: string;
  /** Header text written to the CSV export. Plain, spreadsheet-friendly. */
  csvHeader: string;
  /** Label shown in the on-screen table header (may be richer than csvHeader). */
  displayLabel: string;
  /**
   * True when the on-screen label deliberately differs from the CSV header
   * (so the test asserts the difference instead of treating it as drift).
   */
  displayDiffersFromCsv?: boolean;
}

export const LEDGER_COLUMNS: LedgerColumn[] = [
  { key: "Month", csvHeader: "Month", displayLabel: "Month" },
  { key: "Basis", csvHeader: "Basis", displayLabel: "Basis" },
  // "Off-plan" exists in the CSV as a per-row flag column; the table folds it
  // into the Basis cell, so it has no standalone visible header.
  { key: "Off-plan", csvHeader: "Off-plan", displayLabel: "Off-plan" },
  { key: "Date", csvHeader: "Date", displayLabel: "Date" },
  { key: "Save", csvHeader: "Save", displayLabel: "Save" },
  { key: "CBK In", csvHeader: "CBK In", displayLabel: "CBK In" },
  { key: "Bank In", csvHeader: "Bank In", displayLabel: "Bank In" },
  {
    key: "Swept → Securities",
    csvHeader: "Swept → Securities",
    displayLabel: "Swept\u00a0\u2192\u00a0Securities",
    displayDiffersFromCsv: true,
  },
  { key: "Main Action", csvHeader: "Main Action", displayLabel: "Main Action" },
  { key: "MMF End", csvHeader: "MMF End", displayLabel: "MMF End" },
  { key: "MMF Interest", csvHeader: "MMF Interest", displayLabel: "MMF Interest" },
  { key: "T-Bill 91d", csvHeader: "T-Bill 91d", displayLabel: "T-Bill 91d" },
  { key: "T-Bill 182d", csvHeader: "T-Bill 182d", displayLabel: "T-Bill 182d" },
  { key: "T-Bill 364d", csvHeader: "T-Bill 364d", displayLabel: "T-Bill 364d" },
  { key: "IFB", csvHeader: "IFB", displayLabel: "IFB" },
  { key: "FXD", csvHeader: "FXD", displayLabel: "FXD" },
  { key: "Bank", csvHeader: "Bank", displayLabel: "Bank" },
  {
    key: "Total",
    csvHeader: "Total",
    displayLabel: "Projected / Actual Value",
    displayDiffersFromCsv: true,
  },
  { key: "Phase", csvHeader: "Phase", displayLabel: "Phase" },
];

/** The exact header row the CSV export must emit, in column order. */
export const LEDGER_CSV_HEADERS: string[] = LEDGER_COLUMNS.map((c) => c.csvHeader);

/**
 * Normalise a visible header label to its comparable plain-text form: collapse
 * non-breaking spaces to regular spaces and decode the few HTML entities the
 * table uses for layout. Used by the integrity test to prove a richer visible
 * label is still "the same column" as its CSV header.
 */
export function normaliseLedgerLabel(label: string): string {
  return label
    .replace(/&nbsp;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/&rarr;/g, "\u2192")
    .replace(/\s+/g, " ")
    .trim();
}
