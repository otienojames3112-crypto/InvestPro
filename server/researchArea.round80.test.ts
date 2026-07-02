/**
 * Round 80 — Research area completion & role-enforcement acceptance tests.
 *
 * These are static-source + pure-logic tests (no DB) that lock in the Round-80
 * contract so it cannot silently regress:
 *
 *   1. The Research area exposes the full, renamed tab set and each tab renders
 *      the correct page component.
 *   2. The two new reference pages (CBK Securities, Market Assets) source ONLY
 *      their own asset classes from the shared opportunity catalogue, carry the
 *      mandatory "not advice" disclaimer, and expose a reference -> actual
 *      holding action (never a fabricated dataset).
 *   3. `holdingsRouteForAssetClass` maps every catalog class to the register it
 *      actually belongs to, so "Model in my plan" / reference record flows route
 *      by asset class instead of always landing in Other Holdings.
 *   4. The allocation/sweep engine still sources its bank candidates from the
 *      live catalogue (getBankInstruments), never a hardcoded list.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  holdingsRouteForAssetClass,
  registerClassForAssetClass,
} from "../shared/modeling";
import type { AssetClass } from "../shared/assetModel";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const research = read("client/src/pages/ResearchArea.tsx");
// Round 83: the four reference catalogues moved out of ResearchArea into their
// own nested module (selected via `?cat=` under the reference-catalogues tab).
const catalogueTabs = read("client/src/pages/referenceCatalogueTabs.tsx");

/** Extract the component rendered for a given tab id in an area file. */
function renderedFor(areaSrc: string, tabId: string): string | null {
  const re = new RegExp(
    `id:\\s*["']${tabId}["'][\\s\\S]*?render:\\s*\\(\\)\\s*=>\\s*<([A-Za-z0-9_]+)`,
  );
  const m = areaSrc.match(re);
  return m ? m[1] : null;
}

/** All tab ids declared in an area file, in order. */
function tabIds(areaSrc: string): string[] {
  return [...areaSrc.matchAll(/id:\s*["']([a-z0-9-]+)["']/g)].map((m) => m[1]);
}

describe("Research area exposes the full renamed tab set", () => {
  const ids = tabIds(research);

  it("contains the Round 83 three top-level Research tabs in order (Desk, Explore, Reference Catalogues)", () => {
    expect(ids).toEqual([
      "research-desk",
      "explore",
      "reference-catalogues",
    ]);
  });

  it("nests the four reference catalogues (with the right components) under reference-catalogues", () => {
    const catIds = tabIds(catalogueTabs);
    expect(catIds).toEqual([
      "mmf-market",
      "bank-catalogue",
      "cbk-securities",
      "market-assets",
    ]);
    expect(renderedFor(catalogueTabs, "mmf-market")).toBe("MmfFunds");
    expect(renderedFor(catalogueTabs, "bank-catalogue")).toBe("BankInstruments");
    expect(renderedFor(catalogueTabs, "cbk-securities")).toBe("CbkSecuritiesReference");
    expect(renderedFor(catalogueTabs, "market-assets")).toBe("MarketAssetsReference");
  });

  it("never renders an owned-holdings component in a Research tab", () => {
    for (const src of [research, catalogueTabs]) {
      expect(src).not.toMatch(/\bimport\s+BankHoldings\b/);
      expect(src).not.toMatch(/\bimport\s+MmfAccounts\b/);
      expect(src).not.toMatch(/\bimport\s+OtherAssets\b/);
    }
  });
});

describe("CBK Securities Reference is a scoped, non-advisory reference", () => {
  const cbk = read("client/src/pages/CbkSecuritiesReference.tsx");

  it("sources rows from the shared opportunity catalogue (no fabricated data)", () => {
    expect(cbk).toMatch(/trpc\.opportunities\.list/);
  });

  it("scopes strictly to the government asset classes", () => {
    expect(cbk).toMatch(/gov_discount/);
    expect(cbk).toMatch(/gov_coupon/);
    // Must NOT pull in market / equity classes.
    expect(cbk).not.toMatch(/"equity"/);
    expect(cbk).not.toMatch(/"offshore_fund"/);
  });

  it("carries the mandatory not-advice disclaimer", () => {
    expect(cbk).toMatch(/not advice or a recommendation/i);
  });

  it("exposes a reference -> actual holding record action (deposit drawer)", () => {
    expect(cbk).toMatch(/openDrawer/);
  });
});

describe("Market Assets Reference is a scoped, non-advisory reference", () => {
  const mkt = read("client/src/pages/MarketAssetsReference.tsx");

  it("sources rows from the shared opportunity catalogue (no fabricated data)", () => {
    expect(mkt).toMatch(/trpc\.opportunities\.list/);
  });

  it("scopes strictly to the price-driven market classes", () => {
    expect(mkt).toMatch(/equity/);
    expect(mkt).toMatch(/reit/);
    expect(mkt).toMatch(/offshore_fund/);
    // Must NOT pull in the government classes.
    expect(mkt).not.toMatch(/gov_discount/);
    expect(mkt).not.toMatch(/gov_coupon/);
  });

  it("carries the mandatory not-advice disclaimer", () => {
    expect(mkt).toMatch(/not advice or a recommendation/i);
  });

  it("deep-links Track holding into Holdings -> Other (real holding creation)", () => {
    expect(mkt).toMatch(/dashboardHref\.other/);
  });
});

describe("holdingsRouteForAssetClass routes every class to its real register", () => {
  const cases: Array<[AssetClass, { tab: string; usesRegisterForm: boolean }]> = [
    ["cash_mmf", { tab: "mmf", usesRegisterForm: true }],
    ["bank_deposit", { tab: "bank", usesRegisterForm: true }],
    ["gov_discount", { tab: "gov", usesRegisterForm: true }],
    ["gov_coupon", { tab: "gov", usesRegisterForm: true }],
    ["equity", { tab: "other", usesRegisterForm: false }],
    ["reit", { tab: "other", usesRegisterForm: false }],
    ["offshore_fund", { tab: "other", usesRegisterForm: false }],
    ["alt", { tab: "other", usesRegisterForm: false }],
  ];

  it.each(cases)("routes %s correctly", (ac, expected) => {
    const r = holdingsRouteForAssetClass(ac);
    expect(r.tab).toBe(expected.tab);
    expect(r.usesRegisterForm).toBe(expected.usesRegisterForm);
    expect(r.registerLabel.length).toBeGreaterThan(0);
  });

  it("fixed-income classes require their dedicated register form", () => {
    // The bug this locks out: a modeled bank deposit / gov bond being written as
    // a flat Other-Holdings row (no maturity ladder / coupon schedule).
    for (const ac of ["bank_deposit", "gov_discount", "gov_coupon"] as AssetClass[]) {
      expect(holdingsRouteForAssetClass(ac).usesRegisterForm).toBe(true);
      expect(holdingsRouteForAssetClass(ac).tab).not.toBe("other");
    }
  });

  it("market classes stay in the Other register (where commit writes them)", () => {
    for (const ac of ["equity", "reit", "offshore_fund", "alt"] as AssetClass[]) {
      expect(holdingsRouteForAssetClass(ac).tab).toBe("other");
      // and the legacy register mapping agrees they are non-"other-collapsed"
      // price-driven buckets (equity/real_estate/etf) except alt.
      const reg = registerClassForAssetClass(ac);
      expect(typeof reg).toBe("string");
    }
  });
});

describe("ModelDrawer routes the commit deep-link by asset class", () => {
  const drawer = read("client/src/components/ModelDrawer.tsx");
  it("uses the shared routing helper instead of a hardcoded /other-assets link", () => {
    expect(drawer).toMatch(/holdingsRouteForAssetClass/);
    // The old always-Other bug: a literal navigate("/other-assets") in onSuccess.
    expect(drawer).not.toMatch(/navigate\("\/other-assets"\)/);
  });
});

describe("Allocation/sweep engine sources candidates from the live catalogue", () => {
  const routers = read("server/routers.ts");
  it("bank sweep candidates come from getBankInstruments (no hardcoded list)", () => {
    // sweepSuggestion must read the real catalogue and filter to active rows.
    const seg = routers.slice(
      routers.indexOf("sweepSuggestion"),
      routers.indexOf("sweepSuggestion") + 4000,
    );
    expect(seg).toMatch(/getBankInstruments\(\)/);
    expect(seg).toMatch(/isActive/);
    expect(seg).toMatch(/decideBankSweep/);
  });
});
