/**
 * Part 7.2 — per-adapter fixture tests.
 *
 * Each adapter is exercised against its committed fixture so that:
 *   1. It extracts the correct FACTUAL fields (price/yield/coupon/tenor/maturity/
 *      distribution/fx/expense) with the right keys and as-of dates.
 *   2. It skips instruments we don't track rather than inventing rows.
 *   3. A layout change FAILS LOUDLY: a corrupted fixture makes `parse` throw,
 *      instead of silently importing nothing/garbage.
 *   4. The bright line holds: no figure key is ever a ranking/score/grade, and
 *      every emitted figure key is a member of the closed FIELD_KEYS set.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { nseAdapter, cbkAdapter, fundFactsheetAdapter } from "./adapters";
import { FIELD_KEYS, type FieldKey } from "../../shared/provenance";
import type { AdapterResult } from "../../shared/ingestion";

const FETCHED_AT = Date.parse("2026-06-29T18:00:00Z");

function fixture(name: string): string {
  return readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

/** A figure key set every figure in a result must be drawn from (the bright line). */
const FORBIDDEN_KEYS = ["score", "rating", "rank", "grade", "tier", "stars", "recommended", "isBest", "performer", "quality"];

function assertOnlyFactualKeys(result: AdapterResult) {
  for (const inst of result.instruments) {
    for (const fig of inst.figures) {
      // Structurally, fig.key is typed as FieldKey; assert it at runtime too.
      expect(FIELD_KEYS).toContain(fig.key as FieldKey);
      expect(FORBIDDEN_KEYS).not.toContain(fig.key as string);
    }
    // No instrument-level ranking sneaked in via an extra property.
    for (const k of Object.keys(inst)) {
      expect(FORBIDDEN_KEYS).not.toContain(k.toLowerCase());
    }
  }
}

const figByKey = (result: AdapterResult, ref: string, key: FieldKey) =>
  result.instruments.find((i) => i.ref === ref)?.figures.find((f) => f.key === key);

describe("NSE adapter", () => {
  const result = nseAdapter.parse(fixture("nse_prices.html"), FETCHED_AT);

  it("parses only tracked tickers (skips untracked XYZ)", () => {
    const refs = result.instruments.map((i) => i.ref).sort();
    expect(refs).toEqual(["NSE:EQTY", "NSE:FAHR", "NSE:KCB", "NSE:SCOM"]);
  });

  it("extracts equity price + dividend yield + trailing return", () => {
    expect(figByKey(result, "NSE:SCOM", "price")?.value).toBe("19.05");
    expect(figByKey(result, "NSE:SCOM", "yield")?.value).toBe("6.10");
    expect(figByKey(result, "NSE:SCOM", "trailingReturn")?.value).toBe("13.80");
  });

  it("maps a REIT's headline payout to a distribution, not a dividend yield", () => {
    expect(figByKey(result, "NSE:FAHR", "distribution")?.value).toBe("6.30");
    expect(figByKey(result, "NSE:FAHR", "yield")).toBeUndefined();
    // Negative trailing return is preserved verbatim (a fact, not a judgement).
    expect(figByKey(result, "NSE:FAHR", "trailingReturn")?.value).toBe("-4.90");
  });

  it("stamps the source as-of from the page meta", () => {
    expect(figByKey(result, "NSE:SCOM", "price")?.asOf).toBe(Date.parse("2026-06-29T13:30:00Z"));
  });

  it("emits only factual keys (no ranking anywhere)", () => assertOnlyFactualKeys(result));

  it("throws loudly when the price table is gone (layout drift)", () => {
    expect(() => nseAdapter.parse("<html><body><p>maintenance</p></body></html>", FETCHED_AT)).toThrow(
      /no price table/i,
    );
  });

  it("throws loudly when required columns disappear", () => {
    const broken = `<table><thead><tr><th>Company</th><th>Volume</th></tr></thead><tbody><tr><td>x</td><td>1</td></tr></tbody></table>`;
    expect(() => nseAdapter.parse(broken, FETCHED_AT)).toThrow(/required columns missing/i);
  });
});

describe("CBK / DhowCSD adapter", () => {
  const result = cbkAdapter.parse(fixture("cbk_auction.json"), FETCHED_AT);

  it("parses a T-bill as a discount-yield instrument with a tenor", () => {
    expect(figByKey(result, "CBK:TBILL-364", "yield")?.value).toBe("12.15");
    expect(figByKey(result, "CBK:TBILL-364", "tenor")?.value).toBe("1");
    // A bill has no coupon/maturity figure.
    expect(figByKey(result, "CBK:TBILL-364", "coupon")).toBeUndefined();
  });

  it("parses IFB/FXD bonds with coupon, tenor and maturity", () => {
    expect(figByKey(result, "CBK:IFB1-2026", "coupon")?.value).toBe("13.5");
    expect(figByKey(result, "CBK:IFB1-2026", "tenor")?.value).toBe("15");
    expect(figByKey(result, "CBK:IFB1-2026", "maturity")?.value).toBe("2041-03-01");
    expect(figByKey(result, "CBK:FXD-2026-10Y", "coupon")?.value).toBe("14.35");
  });

  it("uses the auction date as each figure's as-of", () => {
    expect(figByKey(result, "CBK:TBILL-364", "yield")?.asOf).toBe(Date.parse("2026-06-25"));
    expect(figByKey(result, "CBK:IFB1-2026", "coupon")?.asOf).toBe(Date.parse("2026-06-18"));
  });

  it("labels the source with the specific auction date", () => {
    expect(figByKey(result, "CBK:TBILL-364", "yield")?.source).toBe("CBK T-bill auction 2026-06-25");
  });

  it("emits only factual keys (no ranking anywhere)", () => assertOnlyFactualKeys(result));

  it("throws loudly on non-JSON payload", () => {
    expect(() => cbkAdapter.parse("<html>not json</html>", FETCHED_AT)).toThrow(/not valid JSON/i);
  });

  it("throws loudly when the results array is missing", () => {
    expect(() => cbkAdapter.parse(JSON.stringify({ foo: 1 }), FETCHED_AT)).toThrow(/missing `results`/i);
  });

  it("throws loudly on an unknown security type (schema drift)", () => {
    const bad = JSON.stringify({ results: [{ securityType: "WARRANT", ref: "X", name: "X" }] });
    expect(() => cbkAdapter.parse(bad, FETCHED_AT)).toThrow(/unknown securityType/i);
  });
});

describe("Fund fact-sheet adapter", () => {
  const result = fundFactsheetAdapter.parse(fixture("fund_factsheet.csv"), FETCHED_AT);

  it("parses MMF effective yields + expense ratios (skips untracked funds)", () => {
    const refs = result.instruments.map((i) => i.ref).sort();
    expect(refs).toEqual(["MMF:CIC-MMF", "MMF:SANLAM-MMF", "OFF:SPY-MMF-USD", "OFF:VWRA"]);
    expect(figByKey(result, "MMF:SANLAM-MMF", "yield")?.value).toBe("8.60");
    expect(figByKey(result, "MMF:SANLAM-MMF", "expense")?.value).toBe("1.20");
  });

  it("parses an offshore fund's price, expense and FX rate", () => {
    expect(figByKey(result, "OFF:VWRA", "price")?.value).toBe("145.20");
    expect(figByKey(result, "OFF:VWRA", "expense")?.value).toBe("0.22");
    expect(figByKey(result, "OFF:VWRA", "fx")?.value).toBe("131.50");
    // No yield column value for VWRA -> no yield figure invented.
    expect(figByKey(result, "OFF:VWRA", "yield")).toBeUndefined();
  });

  it("emits only factual keys (no ranking anywhere)", () => assertOnlyFactualKeys(result));

  it("throws loudly when key columns disappear (layout drift)", () => {
    const broken = "name,volume\nSanlam,100\n";
    expect(() => fundFactsheetAdapter.parse(broken, FETCHED_AT)).toThrow(/required columns/i);
  });

  it("throws loudly when no figure columns are present", () => {
    const broken = "code,as_of\nSANLAM-MMF,2026-06-29\n";
    expect(() => fundFactsheetAdapter.parse(broken, FETCHED_AT)).toThrow(/no figure columns/i);
  });
});

describe("the bright line is structural", () => {
  it("every figure key across every adapter is a member of FIELD_KEYS", () => {
    const results = [
      nseAdapter.parse(fixture("nse_prices.html"), FETCHED_AT),
      cbkAdapter.parse(fixture("cbk_auction.json"), FETCHED_AT),
      fundFactsheetAdapter.parse(fixture("fund_factsheet.csv"), FETCHED_AT),
    ];
    for (const r of results) {
      for (const inst of r.instruments) {
        for (const fig of inst.figures) {
          expect(FIELD_KEYS as readonly string[]).toContain(fig.key);
        }
      }
    }
  });
});
