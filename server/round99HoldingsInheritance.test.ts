/**
 * Round 99 — Holdings Inherit Reference Catalogue Terms.
 *
 * Tests:
 *   A. Government securities: deposits.add with opportunityId builds holdingSnapshot.
 *   B. Bank holdings: bankHoldings.add with bankInstrumentId builds holdingSnapshot.
 *   C. Market assets: modeling.commit with opportunityId builds holdingSnapshot.
 *   D. Holdings are source of truth: reviewResearchUpdate writes only to catalogue
 *      tables (mmf_funds, bank_instruments, opportunities) — never to holding rows.
 *   E. DepositPrefill type accepts full CBK catalogue terms (gov) and bank terms.
 *   F. HoldingSnapshot.copiedTerms preserves catalogue state at purchase time.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");

/* ─────────────────── A. Gov securities: deposits.add accepts opportunityId ──── */
describe("Round 99 · A — deposits.add input schema accepts opportunityId", () => {
  const routerSrc = readFileSync(join(ROOT, "server/routers.ts"), "utf-8");

  it("deposits.add input includes opportunityId field", () => {
    const depositsBlock = routerSrc.slice(
      routerSrc.indexOf("deposits: router({"),
      routerSrc.indexOf("deposits: router({") + 8000,
    );
    expect(depositsBlock).toContain("opportunityId:");
  });

  it("deposits.add builds holdingSnapshot from catalogue row", () => {
    const depositsBlock = routerSrc.slice(
      routerSrc.indexOf("deposits: router({"),
      routerSrc.indexOf("deposits: router({") + 8000,
    );
    expect(depositsBlock).toContain("holdingSnapshot");
    expect(depositsBlock).toContain("referenceCatalogueType");
    expect(depositsBlock).toContain("copiedTerms");
    expect(depositsBlock).toContain("purchaseTerms");
    expect(depositsBlock).toContain("snapshotAt");
  });
});

/* ─────────────────── B. Bank holdings: bankHoldings.add builds snapshot ──────── */
describe("Round 99 · B — bankHoldings.add builds holdingSnapshot", () => {
  const routerSrc = readFileSync(join(ROOT, "server/routers.ts"), "utf-8");

  it("bankHoldings.add builds holdingSnapshot from catalogue row", () => {
    const bankBlock = routerSrc.slice(
      routerSrc.indexOf("bankHoldings: router({"),
      routerSrc.indexOf("bankHoldings: router({") + 20000,
    );
    expect(bankBlock).toContain("holdingSnapshot");
    expect(bankBlock).toContain("referenceCatalogueType: \"bank\"");
    expect(bankBlock).toContain("copiedTerms");
    expect(bankBlock).toContain("purchaseTerms");
  });
});

/* ─────────────────── C. Market assets: modeling.commit builds snapshot ───────── */
describe("Round 99 · C — modeling.commit builds holdingSnapshot from catalogue", () => {
  const routerSrc = readFileSync(join(ROOT, "server/routers.ts"), "utf-8");

  it("modeling.commit input includes opportunityId", () => {
    const modelBlock = routerSrc.slice(
      routerSrc.indexOf("modeling: router({"),
      routerSrc.indexOf("modeling: router({") + 10000,
    );
    expect(modelBlock).toContain("opportunityId:");
  });

  it("modeling.commit builds holdingSnapshot with market_asset type", () => {
    const modelBlock = routerSrc.slice(
      routerSrc.indexOf("modeling: router({"),
      routerSrc.indexOf("modeling: router({") + 10000,
    );
    expect(modelBlock).toContain("referenceCatalogueType: \"market_asset\"");
    expect(modelBlock).toContain("copiedTerms");
    expect(modelBlock).toContain("purchaseTerms");
    expect(modelBlock).toContain("snapshotAt");
  });
});

/* ─────────────────── D. Catalogue approval never writes to holding tables ───── */
describe("Round 99 · D — reviewResearchUpdate writes only to catalogue tables", () => {
  const dbSrc = readFileSync(join(ROOT, "server/db.ts"), "utf-8");

  it("reviewResearchUpdate does NOT reference securities table for writes", () => {
    // Extract the reviewResearchUpdate function body (it's large). Window kept
    // generous (not tight to the function's current length) since this function
    // grows incrementally slice-by-slice — a tight window has already needed
    // widening once (Slice 8f pushed `upsertOpportunity` past the prior 12000).
    const fnStart = dbSrc.indexOf("export async function reviewResearchUpdate");
    const fnBody = dbSrc.slice(fnStart, fnStart + 16000);
    // It should reference mmfFunds, bankInstruments, and opportunities (via upsertOpportunity)
    expect(fnBody).toContain("mmfFunds");
    expect(fnBody).toContain("bankInstruments");
    expect(fnBody).toContain("upsertOpportunity");
    // It should NOT write to securities, bank_instrument_holdings, or portfolio_secondary_mmfs
    expect(fnBody).not.toContain(".update(securities)");
    expect(fnBody).not.toContain(".insert(securities)");
    expect(fnBody).not.toContain("bankInstrumentHoldings");
    expect(fnBody).not.toContain("portfolioSecondaryMmfs");
  });
});

/* ─────────────────── E. DepositPrefill type accepts full CBK/bank terms ─────── */
describe("Round 99 · E — DepositPrefill type accepts catalogue terms", () => {
  const ctxSrc = readFileSync(
    join(ROOT, "client/src/contexts/DepositDrawerContext.tsx"),
    "utf-8",
  );

  it("gov prefill includes issueNumber, isin, couponRate, maturityDate, settlementDate", () => {
    expect(ctxSrc).toContain("issueNumber");
    expect(ctxSrc).toContain("isin");
    expect(ctxSrc).toContain("couponRate");
    expect(ctxSrc).toContain("maturityDate");
    expect(ctxSrc).toContain("settlementDate");
  });

  it("gov prefill includes couponPaymentDates, cleanPrice, accruedInterest, dirtyPrice", () => {
    expect(ctxSrc).toContain("couponPaymentDates");
    expect(ctxSrc).toContain("cleanPrice");
    expect(ctxSrc).toContain("accruedInterest");
    expect(ctxSrc).toContain("dirtyPrice");
  });

  it("bank prefill includes whtRate, payoutFrequency, earlyWithdrawalPenalty, noticePeriod", () => {
    expect(ctxSrc).toContain("whtRate");
    expect(ctxSrc).toContain("payoutFrequency");
    expect(ctxSrc).toContain("earlyWithdrawalPenalty");
    expect(ctxSrc).toContain("noticePeriod");
  });
});

/* ─────────────────── F. HoldingSnapshot type preserves catalogue state ──────── */
describe("Round 99 · F — HoldingSnapshot type has required fields", () => {
  const profileSrc = readFileSync(join(ROOT, "shared/instrumentProfile.ts"), "utf-8");

  it("HoldingSnapshot interface includes referenceCatalogueType", () => {
    expect(profileSrc).toContain("referenceCatalogueType");
  });

  it("HoldingSnapshot interface includes copiedTerms", () => {
    expect(profileSrc).toContain("copiedTerms");
  });

  it("HoldingSnapshot interface includes purchaseTerms", () => {
    expect(profileSrc).toContain("purchaseTerms");
  });

  it("HoldingSnapshot interface includes snapshotAt", () => {
    expect(profileSrc).toContain("snapshotAt");
  });

  it("HoldingSnapshot interface includes sourceUrl and sourceAsOfDate", () => {
    expect(profileSrc).toContain("sourceUrl");
    expect(profileSrc).toContain("sourceAsOfDate");
  });
});

/* ─────────────────── G. other_holdings schema has holdingSnapshot column ─────── */
describe("Round 99 · G — other_holdings schema has holdingSnapshot column", () => {
  const schemaSrc = readFileSync(join(ROOT, "drizzle/schema.ts"), "utf-8");

  it("otherHoldings table includes holdingSnapshot JSON column", () => {
    // Find the otherHoldings table definition
    const ohStart = schemaSrc.indexOf("export const otherHoldings");
    const ohBlock = schemaSrc.slice(ohStart, ohStart + 5000);
    expect(ohBlock).toContain("holdingSnapshot");
    expect(ohBlock).toContain("json(\"holdingSnapshot\")");
  });
});

/* ─────────────────── H. CbkSecuritiesReference passes full prefill ──────────── */
describe("Round 99 · H — CbkSecuritiesReference passes full catalogue terms to prefill", () => {
  const cbkSrc = readFileSync(
    join(ROOT, "client/src/pages/CbkSecuritiesReference.tsx"),
    "utf-8",
  );

  it("govPrefill includes opportunityId", () => {
    expect(cbkSrc).toContain("opportunityId");
  });

  it("govPrefill extracts couponPaymentDates from extendedFields", () => {
    expect(cbkSrc).toContain("couponPaymentDates");
  });

  it("govPrefill extracts cleanPrice from extendedFields", () => {
    expect(cbkSrc).toContain("cleanPrice");
  });
});
