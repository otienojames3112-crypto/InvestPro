import { describe, it, expect } from "vitest";
import { ledgerMonthForDate, buildMaturityEvents } from "../client/src/components/MaturityTimeline";

describe("Round 38 — timeline deep-link to ledger month", () => {
  it("maps a date in the plan start month to month 1", () => {
    expect(ledgerMonthForDate(new Date("2026-06-24"), "2026-06-01")).toBe(1);
  });

  it("maps later months correctly (Dec maturity, Jun start = month 7)", () => {
    expect(ledgerMonthForDate(new Date("2026-12-24"), "2026-06-01")).toBe(7);
  });

  it("crosses a year boundary correctly (Jan 2027, Jun 2026 start = month 8)", () => {
    expect(ledgerMonthForDate(new Date("2027-01-10"), "2026-06-01")).toBe(8);
  });

  it("returns null when plan start is unknown", () => {
    expect(ledgerMonthForDate(new Date("2026-12-24"), null)).toBeNull();
    expect(ledgerMonthForDate(new Date("2026-12-24"), undefined)).toBeNull();
  });

  it("returns null for invalid start strings", () => {
    expect(ledgerMonthForDate(new Date("2026-12-24"), "not-a-date")).toBeNull();
  });

  it("returns null when the date is before the plan start", () => {
    expect(ledgerMonthForDate(new Date("2026-05-01"), "2026-06-01")).toBeNull();
  });

  it("attaches ledgerMonth to a near-term bank maturity event", () => {
    // A fixed deposit maturing ~30 days out, plan starting this month.
    const today = new Date();
    const maturity = new Date(today.getTime() + 30 * 86_400_000);
    const startISO = new Date(today.getFullYear(), today.getMonth(), 1)
      .toISOString()
      .slice(0, 10);
    const events = buildMaturityEvents(
      [],
      [
        {
          bankName: "NCBA",
          instrumentType: "fixed_deposit",
          principal: 100_000,
          maturityDate: maturity.toISOString(),
          isActive: true,
        },
      ],
      90,
      startISO,
    );
    expect(events).toHaveLength(1);
    expect(events[0].ledgerMonth).not.toBeNull();
    expect(events[0].ledgerMonth!).toBeGreaterThanOrEqual(1);
  });
});
