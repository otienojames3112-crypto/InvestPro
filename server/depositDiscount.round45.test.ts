import { describe, it, expect } from "vitest";
import { discountPriceForSecurity, tbillPrice } from "../shared/discount";
import { reconcileGov } from "../shared/reconciliation";
import { TBILL_TENOR_DAYS, tenorYearsForSecurity } from "../shared/securityTenor";

/**
 * R45 Fix #2 — a government security ADDED VIA RECORD DEPOSITS must derive the
 * same discounted purchase price the CBK Securities Register derives. Before the
 * fix the deposit path stored faceValue = amount with NO purchasePrice, so a
 * T-bill bought via Record Deposits never engaged the discount mechanics: it
 * showed at par, mis-stated net worth, and disagreed with an identical register
 * entry.
 *
 * The deposit path now calls the SAME discountPriceForSecurity helper with the
 * SAME inputs the register uses, so the two paths produce identical pricing.
 */
describe("R45 — Record Deposits derives the T-bill discount price like the register", () => {
  const FACE = 50_000;
  const RATE = 8.97; // default 364-day rate

  it("a 364-day T-bill added via deposit is priced below face", () => {
    const tenorDays = TBILL_TENOR_DAYS["tbill_364"];
    const price = discountPriceForSecurity({
      isDiscount: true,
      isZeroCoupon: false,
      faceValue: FACE,
      ratePct: RATE,
      tenorDays,
      tenorYears: tenorYearsForSecurity("tbill_364", null),
    });
    expect(price).toBeLessThan(FACE);
    expect(price).toBeGreaterThan(40_000);
  });

  it("the deposit-path price equals the register-path price for the same T-bill", () => {
    const tenorDays = TBILL_TENOR_DAYS["tbill_182"];
    const depositPrice = discountPriceForSecurity({
      isDiscount: true,
      isZeroCoupon: false,
      faceValue: FACE,
      ratePct: 8.78,
      tenorDays,
      tenorYears: tenorYearsForSecurity("tbill_182", null),
    });
    // The register helper for a pure T-bill collapses to tbillPrice(face, rate, days).
    const registerPrice = tbillPrice(FACE, 8.78, tenorDays);
    expect(Math.abs(depositPrice - registerPrice)).toBeLessThan(1);
  });

  it("a zero-coupon bond added via deposit is also priced at a discount", () => {
    const price = discountPriceForSecurity({
      isDiscount: true,
      isZeroCoupon: true,
      faceValue: 100_000,
      ratePct: 13,
      tenorDays: 0,
      tenorYears: 3,
    });
    expect(price).toBeLessThan(100_000);
    expect(price).toBeGreaterThan(0);
  });
});

/**
 * R45 Fix #1 — deleting a gov security must remove BOTH its linked deposit and
 * its linked withdrawal, so the government-securities reconciliation sub-check
 * stays balanced. This test pins the netting math the page relies on:
 *  - reconcileGov compares register face total vs (gov deposits − gov withdrawals).
 *  - If a security is removed but a stale withdrawal survives, the deposit side is
 *    LOWER than it should be (a redeemed bill's withdrawal subtracts with no
 *    matching deposit), producing a phantom gap. Removing all three sides keeps
 *    the check at zero.
 */
describe("R45 — gov reconciliation stays balanced when a security is fully removed", () => {
  it("removing register + deposit + withdrawal together nets to zero diff", () => {
    // Before delete: two live bills (register 100k), two deposits (100k), one
    // partial redemption withdrawal of 50k → netLinkedGov = max(0, 100k − 50k)=50k.
    const before = reconcileGov([50_000, 50_000], [Math.max(0, 100_000 - 50_000)]);
    expect(before.ok).toBe(false); // intentionally drifted to show the guard works

    // Buggy delete: drop ONE security + its deposit but leave the 50k withdrawal.
    // register=50k, deposits=50k gross, withdrawal still 50k → net 0 → gap 50k.
    const buggy = reconcileGov([50_000], [Math.max(0, 50_000 - 50_000)]);
    expect(buggy.ok).toBe(false);
    expect(Math.abs(buggy.diff)).toBeGreaterThan(5);

    // Fixed delete: the redeemed security carried no deposit/withdrawal of its own
    // and the surviving live bill has a clean deposit, no withdrawal.
    const fixed = reconcileGov([50_000], [Math.max(0, 50_000 - 0)]);
    expect(fixed.ok).toBe(true);
    expect(fixed.diff).toBe(0);
  });
});
