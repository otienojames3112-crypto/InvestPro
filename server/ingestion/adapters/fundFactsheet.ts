/**
 * Part 7.2 — Fund fact-sheet adapter.
 *
 * Parses a manager fact-sheet feed (modelled as the CSV managers commonly publish
 * for daily prices/yields) into pure facts: MMF effective yields, fund expense
 * ratios, offshore fund prices and 7-day yields, and an FX rate where the sheet
 * expresses a foreign figure. It NEVER emits a ranking, "top fund," star rating,
 * or quality signal — the return type has no slot for one.
 *
 * Layout source of truth: `server/ingestion/fixtures/fund_factsheet.csv`. A
 * required column going missing makes `parse` THROW so the test fails loudly.
 */
import {
  type AdapterResult,
  type ScrapedInstrument,
  type SourceAdapter,
  mkFigure,
} from "../../../shared/ingestion";

const SOURCE_URL = "https://www.sanlaminvestments.com/daily-prices";

/** Which catalog ref + class each fund code maps to. Only tracked funds are kept. */
const KNOWN: Record<string, { ref: string; assetClass: string; name: string; issuer: string; currency: string }> = {
  "SANLAM-MMF": { ref: "MMF:SANLAM-MMF", assetClass: "cash_mmf", name: "SanlamAllianz Money Market Fund", issuer: "Sanlam Allianz Investments", currency: "KES" },
  "CIC-MMF": { ref: "MMF:CIC-MMF", assetClass: "cash_mmf", name: "CIC Money Market Fund", issuer: "CIC Asset Management", currency: "KES" },
  "VWRA": { ref: "OFF:VWRA", assetClass: "offshore_fund", name: "Vanguard FTSE All-World UCITS ETF (USD)", issuer: "Vanguard", currency: "USD" },
  "SPY-MMF-USD": { ref: "OFF:SPY-MMF-USD", assetClass: "offshore_fund", name: "USD Money Market Fund (offshore)", issuer: "Offshore manager", currency: "USD" },
};

/** Minimal, dependency-free CSV row splitter (handles simple quoted cells). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function clean(v: string | undefined): string | null {
  if (v == null) return null;
  const c = v.replace(/,/g, "").trim();
  if (c === "" || c === "-" || /^n\/?a$/i.test(c)) return null;
  return c;
}

function parse(raw: string, _fetchedAt: number): AdapterResult {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) {
    throw new Error("Fund fact-sheet adapter: CSV has no data rows — feed may have changed.");
  }
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name: string): number => header.findIndex((h) => h === name);

  const codeCol = idx("code");
  const asOfCol = idx("as_of");
  const yieldCol = idx("yield");
  const yieldKindCol = idx("yield_kind");
  const priceCol = idx("price");
  const feeCol = idx("expense_ratio");
  const fxCol = idx("fx_kes");

  if (codeCol < 0 || asOfCol < 0) {
    throw new Error(
      "Fund fact-sheet adapter: required columns `code`/`as_of` missing — feed schema may have changed.",
    );
  }
  // A fact sheet with no figure columns at all is a layout break, not an empty feed.
  if (yieldCol < 0 && priceCol < 0 && feeCol < 0) {
    throw new Error(
      "Fund fact-sheet adapter: no figure columns (yield/price/expense_ratio) found — feed schema may have changed.",
    );
  }

  const instruments: ScrapedInstrument[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const code = (cells[codeCol] ?? "").trim().toUpperCase();
    if (!code) continue;
    const known = KNOWN[code];
    if (!known) continue;

    const asOfRaw = clean(cells[asOfCol]);
    const asOf = asOfRaw ? asOfRaw : null;
    const dateLabel = asOf ? new Date(asOf).toISOString().slice(0, 10) : "indicative";
    const source = `${known.issuer} fact sheet (${dateLabel})`;

    const yieldKind = yieldKindCol >= 0 ? (clean(cells[yieldKindCol]) ?? "").toLowerCase() : "";
    const yieldVal = yieldCol >= 0 ? clean(cells[yieldCol]) : null;
    // A REIT-style distribution yield is recorded as a distribution figure; an MMF/
    // offshore headline yield is recorded as a yield. (No fund in this feed is a REIT,
    // but the branch keeps the mapping honest if one is added.)
    const isDistribution = yieldKind.includes("distribution");

    const figures = [
      mkFigure({ key: "price", value: priceCol >= 0 ? clean(cells[priceCol]) : null, source, sourceUrl: SOURCE_URL, asOf }),
      isDistribution
        ? mkFigure({ key: "distribution", value: yieldVal, source, sourceUrl: SOURCE_URL, asOf })
        : mkFigure({ key: "yield", value: yieldVal, source, sourceUrl: SOURCE_URL, asOf }),
      mkFigure({ key: "expense", value: feeCol >= 0 ? clean(cells[feeCol]) : null, source, sourceUrl: SOURCE_URL, asOf }),
      mkFigure({ key: "fx", value: fxCol >= 0 ? clean(cells[fxCol]) : null, source, sourceUrl: SOURCE_URL, asOf }),
    ].filter((f): f is NonNullable<typeof f> => f !== null);

    if (figures.length === 0) continue;
    instruments.push({
      ref: known.ref,
      name: known.name,
      assetClass: known.assetClass,
      issuer: known.issuer,
      currency: known.currency,
      market: known.assetClass === "offshore_fund" ? "Offshore" : "Unit trust",
      figures,
    });
  }

  return { sourceId: "fund_factsheet", instruments };
}

export const fundFactsheetAdapter: SourceAdapter = {
  id: "fund_factsheet",
  label: "Fund manager fact sheets (daily prices & yields)",
  payloadKind: "csv",
  sourceUrl: SOURCE_URL,
  parse,
};
