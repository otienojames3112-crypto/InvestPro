// Shared CSV helpers used by the Ledger, Portfolio Review and Tax Summary
// exports. Kept framework-free (no DOM) in `toCsv` so it is unit-testable; the
// browser-only `downloadCsv` lives here too but is only called from the client.

/** A single CSV cell value. */
export type CsvCell = string | number | null | undefined;

/** Escape one cell: quote it when it contains a comma, quote or newline. */
export function escapeCsvCell(v: CsvCell): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV string from a header row plus data rows. Pure — no DOM access —
 * so it can be exercised directly in Vitest.
 */
export function toCsv(headers: CsvCell[], rows: CsvCell[][]): string {
  return [headers, ...rows]
    .map((line) => line.map(escapeCsvCell).join(","))
    .join("\n");
}

/** Slugify a portfolio/page name into a filename-safe token. */
export function slugify(name: string | null | undefined, fallback = "portfolio"): string {
  const slug = (name ? String(name) : fallback)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return slug || fallback;
}

/**
 * Trigger a browser download of `csv` as a UTF-8 file. A BOM is prepended so
 * Excel detects UTF-8 correctly. Browser-only.
 */
export function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
