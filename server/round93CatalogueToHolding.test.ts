/**
 * Round 93 — Reference Catalogue → Holdings action flow.
 *
 * Contract locked in here:
 *   - A reference-catalogue row never writes money on click. Every "act on this"
 *     action opens a confirm-first surface (the DepositDrawer or a prefilled Add
 *     dialog) where the user confirms figures before anything is created.
 *   - A bank holding created from the Bank Product Catalogue carries a provenance
 *     link (`bankInstrumentId`) back to the catalogue row, threaded end-to-end
 *     (schema → db insert → router input → list output → prefill type).
 *   - The Bank Product Catalogue no longer uses the invalid `/holdings/bank`
 *     navigation that this round removed.
 *   - MMF Market rows expose confirm-first bridges (add-as-account deep-link,
 *     record-deposit drawer, view-composition route) and the composition page is
 *     a real mounted route.
 *
 * These are static source assertions (fast, no DB) mirroring the Round 79
 * page-role separation guard, so the wiring can't silently regress.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const schema = read("drizzle/schema.ts");
const dbHelpers = read("server/db.ts");
const routers = read("server/routers.ts");
const prefillCtx = read("client/src/contexts/DepositDrawerContext.tsx");
const depositDrawer = read("client/src/components/DepositDrawer.tsx");
const bankCatalogue = read("client/src/pages/BankInstruments.tsx");
const mmfMarket = read("client/src/pages/MmfFunds.tsx");
const mmfAccounts = read("client/src/pages/MmfAccounts.tsx");
const app = read("client/src/App.tsx");
const securities = read("client/src/pages/Securities.tsx");
const otherAssets = read("client/src/pages/OtherAssets.tsx");

describe("bankInstrumentId provenance is threaded end-to-end", () => {
  it("schema: bank_instrument_holdings has a NULLABLE bankInstrumentId column", () => {
    // Nullable = declared with int(...) but WITHOUT .notNull(); manual holdings
    // (no catalogue origin) must be allowed to leave it null.
    const m = schema.match(/bankInstrumentId:\s*int\("bankInstrumentId"\)([^,\n]*)/);
    expect(m, "bankInstrumentId column missing from schema").toBeTruthy();
    // The holdings-table column must not be .notNull() (the OTHER match at the
    // rate-history table is intentionally notNull; ensure at least one nullable one).
    const occurrences = [...schema.matchAll(/bankInstrumentId:\s*int\("bankInstrumentId"\)([^,\n]*)/g)];
    const hasNullable = occurrences.some((o) => !o[1].includes("notNull"));
    expect(hasNullable, "expected a nullable bankInstrumentId on the holdings table").toBe(true);
  });

  it("router: bankHoldings.add accepts optional bankInstrumentId and passes it to the insert", () => {
    expect(routers).toMatch(/bankInstrumentId:\s*z\.number\(\)\.int\(\)\.positive\(\)\.optional\(\)/);
    expect(routers).toMatch(/bankInstrumentId:\s*input\.bankInstrumentId\s*\?\?\s*null/);
  });

  it("router: bankHoldings.list surfaces bankInstrumentId back to the client", () => {
    expect(routers).toMatch(/bankInstrumentId:\s*\(r as[\s\S]*?\)\.bankInstrumentId\s*\?\?\s*null/);
  });

  it("db helper inserts the whole payload (so bankInstrumentId is persisted)", () => {
    expect(dbHelpers).toMatch(/insert\(bankInstrumentHoldings\)\.values\(data\)/);
  });

  it("prefill type carries bankInstrumentId provenance from the catalogue", () => {
    expect(prefillCtx).toMatch(/kind:\s*"bank"/);
    expect(prefillCtx).toMatch(/bankInstrumentId\?:\s*number\s*\|\s*null/);
  });

  it("DepositDrawer forwards the prefilled bankInstrumentId when creating the holding", () => {
    // The created holding must carry the provenance id from the prefill.
    expect(depositDrawer).toMatch(/prefillBankInstrumentId/);
    expect(depositDrawer).toMatch(/setPrefillBankInstrumentId\(prefill\.bankInstrumentId\s*\?\?\s*null\)/);
  });
});

describe("reference rows are confirm-first, never write on click", () => {
  it("Bank Product Catalogue opens the DepositDrawer (confirm-first), not a direct write", () => {
    expect(bankCatalogue).toMatch(/useDepositDrawer/);
    expect(bankCatalogue).toMatch(/openDrawer\(\{[\s\S]*?kind:\s*"bank"[\s\S]*?bankInstrumentId:/);
  });

  it("Bank Product Catalogue no longer uses the invalid /holdings/bank navigation", () => {
    // The whole point of the round: that dead deep-link is gone.
    expect(bankCatalogue).not.toMatch(/navigate\(\s*["'`]\/holdings\/bank/);
    expect(bankCatalogue).not.toMatch(/["'`]\/holdings\/bank\?/);
  });

  it("CBK Securities Reference records a purchase via the drawer (govPrefill)", () => {
    const cbk = read("client/src/pages/CbkSecuritiesReference.tsx");
    expect(cbk).toMatch(/openDrawer\(govPrefill\(/);
  });

  it("Market Assets Reference gives Equity and REIT a confirm-first Add to holdings dialog", () => {
    const market = read("client/src/pages/MarketAssetsReference.tsx");
    expect(market).toContain("Add equity to holdings");
    expect(market).toContain("Add REIT to holdings");
    expect(market).toContain("Approved reference facts");
    expect(market).toContain("Your holding details");
  });

  it("Market Assets Reference keeps the older deep-link only for Offshore fund and SACCO for now", () => {
    const market = read("client/src/pages/MarketAssetsReference.tsx");
    expect(market).toMatch(/navigate\(`?\$\{dashboardHref\.other\}/);
    expect(market).toMatch(/track:\s*"1"/);
  });
});

describe("MMF Market exposes confirm-first bridges to Holdings", () => {
  it("offers add-as-account, record-deposit and view-composition actions", () => {
    expect(mmfMarket).toMatch(/addSecondary=1&fundId=\$\{fund\.id\}/);
    expect(mmfMarket).toMatch(/openDrawer\(\{\s*kind:\s*"mmf"/);
    expect(mmfMarket).toMatch(/navigate\("\/mmf-strategy"\)/);
  });

  it("MmfAccounts consumes the addSecondary deep-link and strips the params", () => {
    expect(mmfAccounts).toMatch(/addSecondary/);
    expect(mmfAccounts).toMatch(/fundId/);
    expect(mmfAccounts).toMatch(/window\.history\.replaceState/);
  });

  it("the drawer only routes MMF deposits into a HELD fund (no invented account)", () => {
    // The mmf prefill branch preselects an existing held destination or leaves it
    // empty with a hint — it must never fabricate a destination for an unheld fund.
    expect(depositDrawer).toMatch(/prefill\.kind === "mmf"/);
    expect(depositDrawer).toMatch(/mmfNotHeldName/);
  });

  it("/mmf-strategy is mounted as a real composition route", () => {
    expect(app).toMatch(/path="\/mmf-strategy">\{\(\)\s*=>\s*<MmfStrategy/);
  });
});

describe("Holdings pages link back to their reference catalogue", () => {
  it("Government holdings link to the CBK Securities catalogue", () => {
    expect(securities).toMatch(/dashboardHref\.cbkSecurities/);
  });

  it("Other assets link to the Market Assets catalogue", () => {
    expect(otherAssets).toMatch(/dashboardHref\.marketAssets/);
  });

  it("Bank + MMF holdings already link to their catalogues", () => {
    expect(read("client/src/pages/BankHoldings.tsx")).toMatch(/dashboardHref\.bankCatalogue/);
    expect(mmfAccounts).toMatch(/dashboardHref\.mmfMarket/);
  });
});
