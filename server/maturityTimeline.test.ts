import { describe, it, expect } from "vitest";
import {
  buildMaturityEvents,
  type SecurityLike,
  type BankHoldingLike,
} from "../client/src/components/MaturityTimeline";

/** Helper: ISO date string `days` from today at local midnight. */
function inDays(days: number): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe("Round 33 — Dashboard 90-day maturity timeline", () => {
  it("includes CBK securities and term bank deposits maturing within 90 days", () => {
    const securities: SecurityLike[] = [
      { securityType: "tbill_91", faceValue: 100000, maturityDate: inDays(30), isMatured: false },
      { securityType: "ifb", faceValue: 200000, maturityDate: inDays(80), isMatured: false },
    ];
    const banks: BankHoldingLike[] = [
      { bankName: "KCB", instrumentType: "fixed_deposit", principal: 50000, maturityDate: inDays(10), isActive: true },
    ];
    const events = buildMaturityEvents(securities, banks);
    expect(events).toHaveLength(3);
    // Sorted soonest-first.
    expect(events[0].days).toBe(10);
    expect(events[0].kind).toBe("bank");
    expect(events[1].days).toBe(30);
    expect(events[2].days).toBe(80);
  });

  it("excludes events beyond the 90-day window and already-past/matured ones", () => {
    const securities: SecurityLike[] = [
      { securityType: "tbill_364", faceValue: 100000, maturityDate: inDays(120), isMatured: false }, // too far
      { securityType: "fxd", faceValue: 100000, maturityDate: inDays(-5), isMatured: false }, // past
      { securityType: "tbill_91", faceValue: 100000, maturityDate: inDays(40), isMatured: true }, // matured
    ];
    const events = buildMaturityEvents(securities, []);
    expect(events).toHaveLength(0);
  });

  it("excludes on-call (non-term) bank deposits and inactive holdings", () => {
    const banks: BankHoldingLike[] = [
      { bankName: "Equity", instrumentType: "call_deposit", principal: 80000, maturityDate: inDays(20), isActive: true },
      { bankName: "Co-op", instrumentType: "fixed_deposit", principal: 40000, maturityDate: inDays(20), isActive: false },
      { bankName: "NCBA", instrumentType: "target_savings", principal: 30000, maturityDate: inDays(45), isActive: true },
    ];
    const events = buildMaturityEvents(securities__none(), banks);
    expect(events).toHaveLength(1);
    expect(events[0].label).toBe("NCBA");
    expect(events[0].amount).toBe(30000);
  });

  it("includes an event maturing exactly today (day 0) and exactly at day 90", () => {
    const securities: SecurityLike[] = [
      { securityType: "tbill_91", faceValue: 10000, maturityDate: inDays(0), isMatured: false },
      { securityType: "tbill_182", faceValue: 20000, maturityDate: inDays(90), isMatured: false },
    ];
    const events = buildMaturityEvents(securities, []);
    expect(events).toHaveLength(2);
    expect(events[0].days).toBe(0);
    expect(events[1].days).toBe(90);
  });
});

function securities__none(): SecurityLike[] {
  return [];
}
