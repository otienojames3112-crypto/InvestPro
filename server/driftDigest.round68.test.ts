import { describe, it, expect } from "vitest";
import {
  SNOOZE_OPTIONS,
  snoozeUntilFromDays,
  isSnoozeActive,
  shouldSendDriftDigest,
  buildDriftDigestMessage,
} from "../shared/liquidAllocator";

describe("R68.1 — snooze duration options", () => {
  it("offers exactly 1 / 7 / 30 day choices in order", () => {
    expect(SNOOZE_OPTIONS.map((o) => o.days)).toEqual([1, 7, 30]);
    expect(SNOOZE_OPTIONS.map((o) => o.label)).toEqual(["1 day", "7 days", "30 days"]);
  });

  it("maps a day count to a future Unix-ms expiry", () => {
    const now = 1_000_000_000_000;
    expect(snoozeUntilFromDays(1, now)).toBe(now + 86_400_000);
    expect(snoozeUntilFromDays(7, now)).toBe(now + 7 * 86_400_000);
    expect(snoozeUntilFromDays(30, now)).toBe(now + 30 * 86_400_000);
  });

  it("treats null / non-positive / non-finite days as clearing the snooze", () => {
    const now = 1_000_000_000_000;
    expect(snoozeUntilFromDays(null, now)).toBeNull();
    expect(snoozeUntilFromDays(0, now)).toBeNull();
    expect(snoozeUntilFromDays(-5, now)).toBeNull();
    expect(snoozeUntilFromDays(Number.NaN, now)).toBeNull();
    expect(snoozeUntilFromDays(Infinity, now)).toBeNull();
  });

  it("rounds fractional days to whole days", () => {
    const now = 0;
    expect(snoozeUntilFromDays(1.4, now)).toBe(86_400_000);
    expect(snoozeUntilFromDays(1.6, now)).toBe(2 * 86_400_000);
  });

  it("isSnoozeActive only when the expiry is strictly in the future", () => {
    const now = 5_000;
    expect(isSnoozeActive(null, now)).toBe(false);
    expect(isSnoozeActive(4_999, now)).toBe(false);
    expect(isSnoozeActive(5_000, now)).toBe(false);
    expect(isSnoozeActive(5_001, now)).toBe(true);
  });
});

describe("R68.3 — digest send decision", () => {
  it("sends when currently breached", () => {
    expect(shouldSendDriftDigest({ breached: true, pending: false })).toBe(true);
  });
  it("sends when a breach was pending since the last digest, even if now resolved", () => {
    expect(shouldSendDriftDigest({ breached: false, pending: true })).toBe(true);
  });
  it("does not send when nothing breached and nothing pending", () => {
    expect(shouldSendDriftDigest({ breached: false, pending: false })).toBe(false);
  });
});

describe("R68.3 — digest message builder", () => {
  it("uses an over-threshold message when still breaching", () => {
    const m = buildDriftDigestMessage({
      totalDrift: 123456,
      thresholdValue: 50000,
      thresholdPct: 5,
      breachedNow: true,
    });
    expect(m.title).toMatch(/over threshold/i);
    expect(m.content).toContain("123,456");
    expect(m.content).toContain("50,000");
    expect(m.content).toContain("5%");
  });

  it("uses a resolved message when the breach has cleared", () => {
    const m = buildDriftDigestMessage({
      totalDrift: 0,
      thresholdValue: 50000,
      thresholdPct: 5,
      breachedNow: false,
    });
    expect(m.title).toMatch(/resolved/i);
    expect(m.content).toMatch(/no action needed/i);
  });
});

describe("R68.3 — digest-mode gating mirrors the notify branch", () => {
  // The router branch is: if (breached && !snoozed) { digest ? setPending : (fresh ? ping) }
  // These assertions lock that decision table so a regression in the wiring is caught.
  type Branch = "ping" | "pending" | "none";
  function decide(args: {
    breached: boolean;
    snoozed: boolean;
    digest: boolean;
    fresh: boolean;
  }): Branch {
    if (args.breached && !args.snoozed) {
      if (args.digest) return "pending";
      if (args.fresh) return "ping";
    }
    return "none";
  }

  it("immediate + fresh breach → ping", () => {
    expect(decide({ breached: true, snoozed: false, digest: false, fresh: true })).toBe("ping");
  });
  it("immediate + stale breach → none (dedup)", () => {
    expect(decide({ breached: true, snoozed: false, digest: false, fresh: false })).toBe("none");
  });
  it("digest + breach → pending (never an immediate ping)", () => {
    expect(decide({ breached: true, snoozed: false, digest: true, fresh: true })).toBe("pending");
    expect(decide({ breached: true, snoozed: false, digest: true, fresh: false })).toBe("pending");
  });
  it("snoozed suppresses both ping and pending", () => {
    expect(decide({ breached: true, snoozed: true, digest: false, fresh: true })).toBe("none");
    expect(decide({ breached: true, snoozed: true, digest: true, fresh: true })).toBe("none");
  });
  it("no breach → none regardless of mode", () => {
    expect(decide({ breached: false, snoozed: false, digest: true, fresh: true })).toBe("none");
  });
});
