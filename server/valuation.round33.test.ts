import { describe, it, expect } from "vitest";
import { buildAllocation, blendedYield } from "../shared/actuals";

/**
 * ROUND 33 — the LIVE "Car Purchase" test-portfolio double-count.
 *
 * Reproduced from the actual DB rows behind the user's screenshot:
 *   deposit  240001: bucket=mmf  institutionType=mmf_fund  mmfFundId=7      amount=41,000  (PRIMARY)
 *   deposit  270001: bucket=mmf  institutionType=bank_instrument  bankHoldingId=180001  amount=100,000
 *   deposit  270002: bucket=mmf  institutionType=mmf_fund  mmfFundId=30007  amount=2,500   (SECONDARY)
 *   secondary 240001: mmfFundId=30007  currentBalance=2,500
 *   bank      180001: principal 100,000 (active)
 *
 * Sum of holdings (reference) = primary 41,000 + secondary 2,500 + bank 100,000 = 143,500.
 * The bug double-counted the 2,500 secondary deposit (once in the primary MMF
 * bucket, once via the secondary balance) → 146,000, the +2,500 mismatch.
 */

const PRIMARY_FUND = 7;
const SECONDARY_FUND = 30007;

const deposits = [
  { amount: 41000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: PRIMARY_FUND },
  { amount: 100000, bucket: "mmf", institutionType: "bank_instrument", mmfFundId: null },
  { amount: 2500, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: SECONDARY_FUND },
];
const securities: never[] = [];
const bankHoldings = [
  { principal: 100000, interestRate: 10.5, isActive: true, currentValue: 0 },
];
const otherHoldings: never[] = [];

describe("Round 33 — live secondary-MMF deposit double-count", () => {
  it("excludes the secondary deposit when the secondary set carries the correct FUND id", () => {
    const a = buildAllocation({
      deposits,
      securities,
      secondaryMmfs: [{ mmfFundId: SECONDARY_FUND, currentBalance: 2500, ear: 8.82 }],
      bankHoldings,
      otherHoldings,
    });
    expect(a.primaryMmf).toBe(41000);
    expect(a.secondaryMmf).toBe(2500);
    expect(a.netWorth).toBe(143500);
  });

  it("STILL excludes it via primaryFundId even if the caller mis-passes the secondary ROW id", () => {
    // This is the exact server bug: secondaryMmfs[].mmfFundId was set to the row
    // primary key (240001), so the secondary-fund set was {240001} and never
    // matched the deposit's 30007. With primaryFundId supplied, the
    // any-non-primary-fund rule still excludes it.
    const a = buildAllocation({
      deposits,
      securities,
      secondaryMmfs: [{ mmfFundId: 240001, currentBalance: 2500, ear: 8.82 }], // WRONG id on purpose
      bankHoldings,
      otherHoldings,
      primaryFundId: PRIMARY_FUND,
    });
    expect(a.primaryMmf).toBe(41000); // NOT 43,500
    expect(a.netWorth).toBe(143500); // NOT 146,000
  });

  it("reproduces the 146,000 bug when BOTH guards are absent (documents the regression)", () => {
    const a = buildAllocation({
      deposits,
      securities,
      secondaryMmfs: [{ mmfFundId: 240001, currentBalance: 2500, ear: 8.82 }], // wrong id
      bankHoldings,
      otherHoldings,
      // no primaryFundId → falls back to the broken behaviour
    });
    expect(a.primaryMmf).toBe(43500); // the leak
    expect(a.netWorth).toBe(146000); // the mismatch the user saw
  });

  it("blended-yield base equals the same 143,500 (no double-count in the denominator)", () => {
    const a = buildAllocation({
      deposits,
      securities,
      secondaryMmfs: [{ mmfFundId: SECONDARY_FUND, currentBalance: 2500, ear: 8.82 }],
      bankHoldings,
      otherHoldings,
      primaryFundId: PRIMARY_FUND,
    });
    const y = blendedYield({
      primaryMmf: a.primaryMmf,
      primaryMmfRate: 11.5,
      secondaryMmfs: [{ balance: 2500, rate: 8.82 }],
      bankHoldings: [{ value: 100000, rate: 10.5 }],
      securities: [],
      whtRate: 15,
    });
    expect(y.base).toBe(143500);
    // net yield must be a sane fraction below gross, never the impossible 3.56%.
    expect(y.netYield).toBeGreaterThan(0);
    expect(y.netYield).toBeLessThan(y.grossYield);
    expect(y.grossYield).toBeGreaterThan(8);
    expect(y.grossYield).toBeLessThan(12);
  });
});
