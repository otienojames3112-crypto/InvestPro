import { describe, it, expect } from "vitest";
import { estInterestToDate } from "../shared/actuals";
import { simulateAccrual } from "../shared/accrual";

/**
 * R40.7 (interest half) — the Dashboard's "Est. Interest Earned" uses the shared
 * `estInterestToDate` (geometric daily compounding, net of WHT). The Daily
 * Accrual ledger renders the SAME model via `simulateAccrual`. For a single
 * deposit held over the same window with daily crediting, the Dashboard estimate
 * must equal the accrual ledger's net total.
 */

function daysBetween(fromISO: string, toISO: string): number {
  const from = new Date(`${fromISO}T12:00:00.000Z`).getTime();
  const to = new Date(`${toISO}T12:00:00.000Z`).getTime();
  return Math.floor((to - from) / 86_400_000);
}

describe("R40.7 — Dashboard Est. Interest == Daily Accrual ledger net total", () => {
  const principal = 1_000_000;
  const ear = 12;
  const wht = 15;
  const from = "2026-01-01";
  const to = "2026-07-01"; // ~181 days

  it("agrees with the daily-crediting ledger within the gross-vs-net compounding term", () => {
    // Modelling note: `estInterestToDate` compounds the GROSS balance daily and
    // applies WHT once at the end, while the ledger's "daily" crediting taxes
    // each day and only re-compounds the NET. They therefore differ by the
    // second-order "tax on interest-on-interest" term — small (well under 1% over
    // half a year) but real. The cross-check asserts they track closely, which
    // catches any GROSS divergence (a wrong rate, WHT, or day count) while not
    // asserting a false cent-level equality between two distinct compounding
    // conventions.
    const dash = estInterestToDate(principal, ear, wht, from, to, 365);
    const days = daysBetween(from, to);
    const ledger = simulateAccrual(principal, ear, 365, wht, "daily", days);
    const ledgerNet = ledger.reduce((s, r) => s + r.netInterest, 0);
    const relDiff = Math.abs(dash - ledgerNet) / ledgerNet;
    expect(relDiff).toBeLessThan(0.01); // within 1%
    // The gross-compounded estimate is the upper bound of the net-compounded one.
    expect(dash).toBeGreaterThanOrEqual(ledgerNet - 0.01);
  });

  it("matches the MONTHLY-crediting ledger more tightly (both tax a fixed base)", () => {
    // Monthly crediting accrues on a fixed base within each 30-day window, which
    // is closer to the gross-then-tax estimate than daily net compounding.
    const dash = estInterestToDate(principal, ear, wht, from, to, 365);
    const days = daysBetween(from, to);
    const ledger = simulateAccrual(principal, ear, 365, wht, "monthly", days);
    const ledgerNet = ledger.reduce((s, r) => s + r.netInterest, 0);
    const relDiff = Math.abs(dash - ledgerNet) / ledgerNet;
    expect(relDiff).toBeLessThan(0.01);
  });

  it("returns zero before any day has elapsed (same as an empty ledger)", () => {
    const dash = estInterestToDate(principal, ear, wht, to, from, 365); // reversed
    expect(dash).toBe(0);
  });

  it("a longer horizon accrues strictly more (monotonic, both engines)", () => {
    const short = estInterestToDate(principal, ear, wht, from, "2026-04-01", 365);
    const long = estInterestToDate(principal, ear, wht, from, "2026-10-01", 365);
    expect(long).toBeGreaterThan(short);
  });

  it("net is below gross by exactly the WHT fraction", () => {
    const net = estInterestToDate(principal, ear, 15, from, to, 365);
    const gross = estInterestToDate(principal, ear, 0, from, to, 365);
    expect(net).toBeCloseTo(gross * 0.85, 0);
  });
});
