/**
 * Round 79 — page-role separation acceptance test.
 *
 * Contract: Holdings = "what you actually own"; Research = "market reference".
 * The bug this locks out: Holdings → Bank / MMF were wired to the *catalogue*
 * components (BankInstruments, MmfFunds market table) instead of the actual
 * holdings views. This static test reads the area files and asserts each tab
 * renders the correct component, so the two roles can never be re-swapped.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const holdings = read("client/src/pages/HoldingsArea.tsx");
const research = read("client/src/pages/ResearchArea.tsx");
// Round 83: the reference catalogues are declared in their own nested module.
const catalogueTabs = read("client/src/pages/referenceCatalogueTabs.tsx");

/** Extract the component rendered for a given tab id in an area file. */
function renderedFor(areaSrc: string, tabId: string): string | null {
  // Find the tab block { id: "<tabId>", ... render: () => <Component ... /> }
  const re = new RegExp(
    `id:\\s*["']${tabId}["'][\\s\\S]*?render:\\s*\\(\\)\\s*=>\\s*<([A-Za-z0-9_]+)`,
  );
  const m = areaSrc.match(re);
  return m ? m[1] : null;
}

describe("Holdings area renders ACTUAL holdings, not market catalogues", () => {
  it("Holdings → Bank renders BankHoldings (owned deposits), not the catalogue", () => {
    expect(renderedFor(holdings, "bank")).toBe("BankHoldings");
  });

  it("Holdings → MMF renders MmfAccounts (owned accounts), not the market table", () => {
    expect(renderedFor(holdings, "mmf")).toBe("MmfAccounts");
  });

  it("Holdings never imports the market-catalogue components", () => {
    // BankInstruments = bank product catalogue; MmfFunds = MMF market comparison.
    expect(holdings).not.toMatch(/\bimport\s+BankInstruments\b/);
    expect(holdings).not.toMatch(/\bimport\s+MmfFunds\b/);
  });
});

describe("Research area renders MARKET reference, not owned holdings", () => {
  it("Research → Bank Catalogue renders BankInstruments (products)", () => {
    expect(renderedFor(catalogueTabs, "bank-catalogue")).toBe("BankInstruments");
  });

  it("Research → MMF Market renders the MMF market table (MmfFunds)", () => {
    expect(renderedFor(catalogueTabs, "mmf-market")).toBe("MmfFunds");
  });

  it("Research MMF Market no longer manages secondary MMF accounts", () => {
    const mmf = read("client/src/pages/MmfFunds.tsx");
    expect(mmf).not.toMatch(/secondaryMmfs\./);
    expect(mmf).not.toMatch(/Additional MMF Accounts/);
    expect(mmf).not.toMatch(/Add Account/);
    // But the confirmation-gated primary-fund selection stays.
    expect(mmf).toMatch(/AlertDialog/);
    expect(mmf).toMatch(/confirmFund/);
  });

  it("Research never imports the owned-holdings components", () => {
    expect(research).not.toMatch(/\bimport\s+BankHoldings\b/);
    expect(research).not.toMatch(/\bimport\s+MmfAccounts\b/);
  });
});

describe("The four components read the correct data sources (no divergence)", () => {
  const bankHoldings = read("client/src/pages/BankHoldings.tsx");
  const mmfAccounts = read("client/src/pages/MmfAccounts.tsx");
  const bankInstruments = read("client/src/pages/BankInstruments.tsx");
  const mmfFunds = read("client/src/pages/MmfFunds.tsx");

  it("BankHoldings reads actual bankHoldings.* procedures", () => {
    expect(bankHoldings).toMatch(/trpc\.bankHoldings\.(list|add|update|remove)/);
  });

  it("MmfAccounts reads actual balances (deposits.summary / secondaryMmfs)", () => {
    expect(mmfAccounts).toMatch(/secondaryMmfs\.|deposits\.summary|useSelectedFund/);
  });

  it("BankInstruments (catalogue) reads the indicative product list", () => {
    expect(bankInstruments).toMatch(/trpc\.bankInstruments\.list/);
  });

  it("MmfFunds (market table) reads the fund market list + selectFund", () => {
    expect(mmfFunds).toMatch(/trpc\.mmfFunds\.list/);
    expect(mmfFunds).toMatch(/selectFund/);
  });
});

describe("Set-primary is a deliberate, confirmed action (market table)", () => {
  const mmfFunds = read("client/src/pages/MmfFunds.tsx");
  it("MmfFunds gates set-primary behind a confirmation dialog", () => {
    // A confirm state + AlertDialog must guard the projection-changing switch.
    expect(mmfFunds).toMatch(/AlertDialog/);
    expect(mmfFunds).toMatch(/confirmFund|requestSelectFund/);
  });
});
