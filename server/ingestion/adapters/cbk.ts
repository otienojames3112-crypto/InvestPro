/**
 * Part 7.2 — CBK / DhowCSD adapter.
 *
 * Parses a CBK/DhowCSD auction-results payload (modelled as the JSON the DhowCSD
 * results endpoint returns) into pure facts: T-bill discount yields and tenors,
 * and bond coupons, tenors and maturities (IFB / FXD). It NEVER emits a ranking,
 * "best auction," or quality signal — the return type cannot hold one.
 *
 * Layout source of truth: `server/ingestion/fixtures/cbk_auction.json`. If CBK
 * changes the field names, the required keys are absent and `parse` THROWS so the
 * test fails loudly instead of importing nothing.
 */
import {
  type AdapterResult,
  type ScrapedInstrument,
  type SourceAdapter,
  mkFigure,
} from "../../../shared/ingestion";

const URL_TBILLS = "https://www.centralbank.go.ke/securities/treasury-bills/";
const URL_TBONDS = "https://www.centralbank.go.ke/securities/treasury-bonds/";

/** Shape of one auction result row in the CBK/DhowCSD payload. */
interface RawAuctionRow {
  securityType?: string; // "TBILL" | "IFB" | "FXD"
  ref?: string;
  name?: string;
  tenorYears?: number | string;
  couponRate?: number | string; // bonds
  discountYield?: number | string; // bills
  maturityDate?: string; // ISO date
  auctionDate?: string; // ISO date — the figure's as-of
}

interface RawPayload {
  source?: string;
  results?: RawAuctionRow[];
}

function isFiniteNum(v: unknown): v is number | string {
  if (v === null || v === undefined || v === "") return false;
  return Number.isFinite(typeof v === "number" ? v : Number(v));
}

function parse(raw: string, _fetchedAt: number): AdapterResult {
  let payload: RawPayload;
  try {
    payload = JSON.parse(raw) as RawPayload;
  } catch {
    throw new Error("CBK adapter: payload is not valid JSON — endpoint may have changed.");
  }
  if (!payload || !Array.isArray(payload.results)) {
    throw new Error("CBK adapter: missing `results` array — payload schema may have changed.");
  }

  const instruments: ScrapedInstrument[] = [];
  for (const row of payload.results) {
    const type = (row.securityType ?? "").toUpperCase();
    if (!type) {
      throw new Error("CBK adapter: a result row is missing `securityType` — schema may have changed.");
    }
    if (!row.ref || !row.name) {
      throw new Error(`CBK adapter: result row for ${type} missing ref/name — schema may have changed.`);
    }

    const asOf = row.auctionDate ?? null;
    const auctionLabel = row.auctionDate ? new Date(row.auctionDate).toISOString().slice(0, 10) : "indicative";

    if (type === "TBILL") {
      const source = `CBK T-bill auction ${auctionLabel}`;
      const figures = [
        mkFigure({ key: "yield", value: isFiniteNum(row.discountYield) ? row.discountYield! : null, source, sourceUrl: URL_TBILLS, asOf }),
        mkFigure({ key: "tenor", value: isFiniteNum(row.tenorYears) ? row.tenorYears! : null, source, sourceUrl: URL_TBILLS, asOf }),
      ].filter((f): f is NonNullable<typeof f> => f !== null);
      if (figures.length === 0) continue;
      instruments.push({
        ref: row.ref,
        name: row.name,
        assetClass: "gov_discount",
        issuer: "Central Bank of Kenya",
        currency: "KES",
        market: "CBK",
        figures,
      });
    } else if (type === "IFB" || type === "FXD") {
      const source = `CBK ${type} auction ${auctionLabel}`;
      const figures = [
        mkFigure({ key: "coupon", value: isFiniteNum(row.couponRate) ? row.couponRate! : null, source, sourceUrl: URL_TBONDS, asOf }),
        mkFigure({ key: "tenor", value: isFiniteNum(row.tenorYears) ? row.tenorYears! : null, source, sourceUrl: URL_TBONDS, asOf }),
        mkFigure({ key: "maturity", value: row.maturityDate ?? null, source, sourceUrl: URL_TBONDS, asOf }),
      ].filter((f): f is NonNullable<typeof f> => f !== null);
      if (figures.length === 0) continue;
      instruments.push({
        ref: row.ref,
        name: row.name,
        assetClass: "gov_coupon",
        issuer: "Central Bank of Kenya",
        currency: "KES",
        market: "CBK",
        factNote: type === "IFB" ? "Infrastructure bond; coupon is tax-exempt for qualifying holders." : null,
        figures,
      });
    } else {
      throw new Error(`CBK adapter: unknown securityType "${type}" — schema may have changed.`);
    }
  }

  return { sourceId: "cbk_dhowcsd", instruments };
}

export const cbkAdapter: SourceAdapter = {
  id: "cbk_dhowcsd",
  label: "Central Bank of Kenya / DhowCSD (auction results)",
  payloadKind: "json",
  sourceUrl: URL_TBONDS,
  parse,
};
