/**
 * Part 7.2 — NSE adapter.
 *
 * Parses an NSE-style daily price table (listed equities + the I-REIT) into pure
 * facts: last price, an indicative dividend/distribution yield, and a trailing
 * 12-month return where the source publishes one. It NEVER emits a ranking — the
 * shared `SourceAdapter` return type has no field for one.
 *
 * Source of truth for layout: the fixture in
 * `server/ingestion/fixtures/nse_prices.html`. If NSE changes its table structure
 * the required columns will be missing and `parse` THROWS, so the regression test
 * fails loudly rather than silently importing garbage.
 *
 * This adapter is a PURE parser: it receives already-fetched HTML and returns
 * facts. Fetching, caching, rate-limiting and back-off live in the runner.
 */
import { parse as parseHtml } from "node-html-parser";
import {
  type AdapterResult,
  type ScrapedInstrument,
  type SourceAdapter,
  mkFigure,
} from "../../../shared/ingestion";

const SOURCE_URL = "https://www.nse.co.ke/share-price/";

/** Map an NSE ticker to its catalog ref + asset class. Only refs we track are kept. */
const KNOWN: Record<string, { ref: string; assetClass: string; name: string; issuer: string }> = {
  SCOM: { ref: "NSE:SCOM", assetClass: "equity", name: "Safaricom PLC", issuer: "Safaricom PLC" },
  KCB: { ref: "NSE:KCB", assetClass: "equity", name: "KCB Group PLC", issuer: "KCB Group PLC" },
  EQTY: { ref: "NSE:EQTY", assetClass: "equity", name: "Equity Group Holdings PLC", issuer: "Equity Group Holdings PLC" },
  FAHR: { ref: "NSE:FAHR", assetClass: "reit", name: "ILAM Fahari I-REIT", issuer: "ICEA Lion Asset Management" },
};

/** Parse a number from a cell, tolerating thousands separators and blanks. */
function num(text: string | undefined): string | null {
  if (text == null) return null;
  const cleaned = text.replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === "-" || /^n\/?a$/i.test(cleaned)) return null;
  const m = cleaned.match(/-?\d+(\.\d+)?/);
  return m ? m[0] : null;
}

function parseAsOf(root: ReturnType<typeof parseHtml>): number | null {
  // The fixture exposes the as-of date in a <meta name="as-of"> or a data attribute.
  const meta = root.querySelector('meta[name="as-of"]');
  const content = meta?.getAttribute("content");
  if (content) {
    const t = new Date(content).getTime();
    if (Number.isFinite(t)) return t;
  }
  const stamped = root.querySelector("[data-as-of]")?.getAttribute("data-as-of");
  if (stamped) {
    const t = new Date(stamped).getTime();
    if (Number.isFinite(t)) return t;
  }
  return null;
}

function parse(raw: string, fetchedAt: number): AdapterResult {
  const root = parseHtml(raw);
  const table = root.querySelector("table.price-list, table#prices, table");
  if (!table) {
    throw new Error("NSE adapter: no price table found — layout may have changed.");
  }

  // Resolve the column order from the header so a reorder doesn't silently shift data.
  const headerCells = table.querySelectorAll("thead th, thead td");
  if (headerCells.length === 0) {
    throw new Error("NSE adapter: price table has no header row — layout may have changed.");
  }
  const headers = headerCells.map((c) => c.text.trim().toLowerCase());
  const col = (names: string[]): number => {
    for (const n of names) {
      const idx = headers.findIndex((h) => h.includes(n));
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const tickerCol = col(["ticker", "code", "symbol"]);
  const priceCol = col(["price", "close", "last"]);
  const yieldCol = col(["yield", "div"]);
  const returnCol = col(["1y", "12m", "trailing", "return"]);

  if (tickerCol < 0 || priceCol < 0) {
    throw new Error(
      `NSE adapter: required columns missing (ticker=${tickerCol}, price=${priceCol}) — layout may have changed.`,
    );
  }

  const asOf = parseAsOf(root);
  const source = `NSE daily price list${asOf ? ` (${new Date(asOf).toISOString().slice(0, 10)})` : ""}`;

  const rows = table.querySelectorAll("tbody tr");
  if (rows.length === 0) {
    throw new Error("NSE adapter: price table body is empty — layout may have changed.");
  }

  const instruments: ScrapedInstrument[] = [];
  for (const tr of rows) {
    const cells = tr.querySelectorAll("td");
    if (cells.length <= priceCol) continue;
    const ticker = cells[tickerCol]?.text.trim().toUpperCase();
    if (!ticker) continue;
    const known = KNOWN[ticker];
    if (!known) continue; // only ingest instruments we actually track

    const price = num(cells[priceCol]?.text);
    const yld = yieldCol >= 0 ? num(cells[yieldCol]?.text) : null;
    const trailing = returnCol >= 0 ? num(cells[returnCol]?.text) : null;

    const figures = [
      mkFigure({ key: "price", value: price, source, sourceUrl: SOURCE_URL, asOf }),
      // A REIT's headline payout is a distribution; an equity's is a dividend yield.
      known.assetClass === "reit"
        ? mkFigure({ key: "distribution", value: yld, source, sourceUrl: SOURCE_URL, asOf })
        : mkFigure({ key: "yield", value: yld, source, sourceUrl: SOURCE_URL, asOf }),
      mkFigure({ key: "trailingReturn", value: trailing, source, sourceUrl: SOURCE_URL, asOf }),
    ].filter((f): f is NonNullable<typeof f> => f !== null);

    if (figures.length === 0) continue;
    instruments.push({
      ref: known.ref,
      name: known.name,
      assetClass: known.assetClass,
      issuer: known.issuer,
      currency: "KES",
      market: "NSE",
      figures,
    });
  }

  return { sourceId: "nse", instruments };
}

export const nseAdapter: SourceAdapter = {
  id: "nse",
  label: "Nairobi Securities Exchange (daily prices)",
  payloadKind: "html",
  sourceUrl: SOURCE_URL,
  parse,
};
