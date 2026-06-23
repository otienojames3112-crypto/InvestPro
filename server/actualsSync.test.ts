import { describe, it, expect } from "vitest";
import {
  computeActualsTotals,
  type DepositRow,
  type SecondaryMmfActual,
  type BankHoldingActual,
  type ActualsRates,
  type SecurityActual,
} from "../shared/actuals";

const RATES: ActualsRates = {
  withholdingTax: 15,
  mmfYield: 13.2,
  tbillRate: 8.97,
  fxdCouponRate: 12.35,
};

// Primary fund id = 1; secondary fund id = 2.
const PRIMARY = 1;
const SECONDARY = 2;

describe("destination-aware live actuals sync", () => {
  it("starts at zero net worth with no holdings", () => {
    const r = computeActualsTotals([], [], [], RATES);
    expect(r.totalContributed).toBe(0);
    expect(r.taxLiability).toBe(0);
  });

  it("reflects a PRIMARY MMF deposit in net worth and the mmf bucket", () => {
    const deposits: DepositRow[] = [
      { amount: 100000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: PRIMARY },
    ];
    const r = computeActualsTotals(deposits, [], [], RATES);
    expect(r.totalContributed).toBe(100000);
    expect(r.byBucket.mmf).toBe(100000);
    expect(r.depositsContributed).toBe(100000);
  });

  it("values T-bill and FXD government securities from the REGISTER, not the deposit row", () => {
    // Register is the single source of truth: the deposit rows are excluded from
    // the contribution sum, and the register securities supply the value.
    const deposits: DepositRow[] = [
      { amount: 50000, bucket: "tbill", institutionType: "government_security", mmfFundId: null },
      { amount: 80000, bucket: "fxd", institutionType: "government_security", mmfFundId: null },
    ];
    const securities: SecurityActual[] = [
      { securityType: "tbill_364", faceValue: 50000, couponRate: 0, isTaxExempt: false },
      { securityType: "fxd", faceValue: 80000, couponRate: 12.35, isTaxExempt: false },
    ];
    const r = computeActualsTotals(deposits, [], [], RATES, securities);
    expect(r.totalContributed).toBe(130000);
    expect(r.securitiesValue).toBe(130000);
    expect(r.byBucket.tbill).toBe(50000);
    expect(r.byBucket.fxd).toBe(80000);
    expect(r.depositsContributed).toBe(0); // gov deposit rows excluded from primary sum
    // FXD is taxable at 15% on the gross coupon; T-bill likewise.
    expect(r.taxBreakdown.fxd).toBeCloseTo(80000 * 0.1235 * 0.15, 2);
    expect(r.taxBreakdown.tbill).toBeCloseTo(50000 * 0.0897 * 0.15, 2);
  });

  it("does NOT double-count a government security (register + deposit both present)", () => {
    const deposits: DepositRow[] = [
      { amount: 50000, bucket: "tbill", institutionType: "government_security", mmfFundId: null },
    ];
    const securities: SecurityActual[] = [
      { securityType: "tbill_364", faceValue: 50000, couponRate: 0, isTaxExempt: false },
    ];
    const r = computeActualsTotals(deposits, [], [], RATES, securities);
    expect(r.totalContributed).toBe(50000); // not 100000
    expect(r.securitiesValue).toBe(50000);
  });

  it("does NOT double-count a deposit attributed to a secondary MMF account", () => {
    // The deposit row exists AND the secondary balance already includes that money.
    const deposits: DepositRow[] = [
      { amount: 30000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: SECONDARY },
    ];
    const secondaries: SecondaryMmfActual[] = [
      { mmfFundId: SECONDARY, currentBalance: 30000, ear: 12, whtRate: 15 },
    ];
    const r = computeActualsTotals(deposits, secondaries, [], RATES);
    // Net worth must be 30k, not 60k.
    expect(r.totalContributed).toBe(30000);
    expect(r.depositsContributed).toBe(0); // secondary deposit row excluded from primary sum
    expect(r.secondaryMmfBalance).toBe(30000);
    expect(r.byBucket.mmf).toBe(0);
  });

  it("does NOT double-count a deposit attributed to a bank instrument", () => {
    const deposits: DepositRow[] = [
      { amount: 200000, bucket: "mmf", institutionType: "bank_instrument", mmfFundId: null },
    ];
    const bank: BankHoldingActual[] = [
      { principal: 200000, interestRate: 10.5, whtRate: 15, isActive: true },
    ];
    const r = computeActualsTotals(deposits, [], bank, RATES);
    expect(r.totalContributed).toBe(200000); // not 400000
    expect(r.bankBalance).toBe(200000);
    expect(r.depositsContributed).toBe(0);
    expect(r.taxBreakdown.bank).toBeCloseTo(200000 * 0.105 * 0.15, 2);
  });

  it("aggregates every destination into a single net-worth figure", () => {
    const deposits: DepositRow[] = [
      { amount: 100000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: PRIMARY },
      { amount: 50000, bucket: "tbill", institutionType: "government_security", mmfFundId: null },
      { amount: 80000, bucket: "fxd", institutionType: "government_security", mmfFundId: null },
      // these two are destination rows that must be excluded from the primary sum
      { amount: 30000, bucket: "mmf", institutionType: "mmf_fund", mmfFundId: SECONDARY },
      { amount: 200000, bucket: "mmf", institutionType: "bank_instrument", mmfFundId: null },
    ];
    const secondaries: SecondaryMmfActual[] = [
      { mmfFundId: SECONDARY, currentBalance: 30000, ear: 12, whtRate: 15 },
    ];
    const bank: BankHoldingActual[] = [
      { principal: 200000, interestRate: 10.5, whtRate: 15, isActive: true },
    ];
    const securities: SecurityActual[] = [
      { securityType: "tbill_364", faceValue: 50000, couponRate: 0, isTaxExempt: false },
      { securityType: "fxd", faceValue: 80000, couponRate: 12.35, isTaxExempt: false },
    ];
    const r = computeActualsTotals(deposits, secondaries, bank, RATES, securities);
    // primary 100k + tbill 50k + fxd 80k + secondary 30k + bank 200k = 460k
    expect(r.totalContributed).toBe(460000);
    expect(r.depositsContributed).toBe(100000); // only the primary-MMF deposit
    expect(r.securitiesValue).toBe(130000);
    expect(r.secondaryMmfBalance).toBe(30000);
    expect(r.bankBalance).toBe(200000);
  });

  it("excludes inactive bank holdings from net worth", () => {
    const bank: BankHoldingActual[] = [
      { principal: 200000, interestRate: 10.5, whtRate: 15, isActive: false },
    ];
    const r = computeActualsTotals([], [], bank, RATES);
    expect(r.bankBalance).toBe(0);
    expect(r.totalContributed).toBe(0);
  });

  it("treats IFB coupons as tax-exempt (valued from register)", () => {
    const deposits: DepositRow[] = [
      { amount: 100000, bucket: "ifb", institutionType: "government_security", mmfFundId: null },
    ];
    const securities: SecurityActual[] = [
      { securityType: "ifb", faceValue: 100000, couponRate: 13.5, isTaxExempt: true },
    ];
    const r = computeActualsTotals(deposits, [], [], RATES, securities);
    expect(r.byBucket.ifb).toBe(100000);
    expect(r.securitiesValue).toBe(100000);
    expect(r.taxBreakdown.ifb).toBe(0);
  });
});
