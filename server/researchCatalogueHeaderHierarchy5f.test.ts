import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

const pages = {
  mmf: read("client/src/pages/MmfFunds.tsx"),
  bank: read("client/src/pages/BankInstruments.tsx"),
  cbk: read("client/src/pages/CbkSecuritiesReference.tsx"),
  market: read("client/src/pages/MarketAssetsReference.tsx"),
};

const headerAnchors = {
  mmf: { title: "MMF Market", nextSection: "Selected fund banner" },
  bank: { title: "Bank Product Catalogue", nextSection: "{/* Filters */}" },
  cbk: { title: "CBK Securities Reference", nextSection: "{/* Filters */}" },
  market: { title: "Market Assets Reference", nextSection: "{/* Search + scope */}" },
};

function headerBlock(key: keyof typeof pages): string {
  const src = pages[key];
  const anchors = headerAnchors[key];
  const componentStart = src.indexOf("export default function");
  expect(componentStart).toBeGreaterThan(-1);
  const start = src.indexOf(anchors.title, componentStart);
  const end = src.indexOf(anchors.nextSection, start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return src.slice(start, end);
}

function expectOrder(src: string, first: string, second: string): void {
  const a = src.indexOf(first);
  const b = src.indexOf(second);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
}

describe("Stage 10b-5f - category catalogue headers and action hierarchy", () => {
  it("uses the same header governance boundary on every category catalogue", () => {
    for (const key of Object.keys(pages) as Array<keyof typeof pages>) {
      const header = headerBlock(key);
      const copy = header.replace(/\s+/g, " ");
      expect(copy).toContain("Approved reference data only");
      expect(copy).toContain("recorded separately");
      expect(header).not.toContain("Information only");
      expect(header).not.toContain("For information only");
    }
  });

  it("puts manager catalogue review before the secondary Explain action", () => {
    for (const key of Object.keys(pages) as Array<keyof typeof pages>) {
      const header = headerBlock(key);
      expectOrder(header, "CatalogueSourceReviewButton", "Explain catalogue");
    }
  });

  it("keeps manual add/correct actions only on catalogues that support them", () => {
    const mmf = headerBlock("mmf");
    const bank = headerBlock("bank");
    const cbk = headerBlock("cbk");
    const market = headerBlock("market");

    expectOrder(mmf, "CatalogueSourceReviewButton", "Add / correct fund");
    expectOrder(mmf, "Add / correct fund", "Explain catalogue");
    expectOrder(bank, "CatalogueSourceReviewButton", "Add / correct product");
    expectOrder(bank, "Add / correct product", "Explain catalogue");

    expect(cbk).not.toContain("Add / correct");
    expect(market).not.toContain("Add / correct");
  });

  it("does not keep duplicated disclaimer cards on CBK or Market Assets", () => {
    for (const src of [pages.cbk, pages.market]) {
      expect(src).not.toContain("Persistent disclaimer");
      expect(src).not.toContain("ShieldAlert");
      expect(src).not.toContain("Information only");
      expect(src).not.toContain("For information only");
    }
  });
});
