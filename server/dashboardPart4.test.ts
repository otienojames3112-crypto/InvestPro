import { describe, it, expect } from "vitest";
import {
  classifyBreachSeverity,
  classifyRateRisk,
  classifyContributionRisk,
  classifyLiquidityTimingRisk,
  severityRank,
} from "../shared/decisionSurface";

describe("Part 4 — breach severity (colour matches the message, line-item #13)", () => {
  it("no breach → ok", () => {
    expect(classifyBreachSeverity({ breached: false })).toBe("ok");
  });

  it("a plain breach with no mitigation → action (red)", () => {
    expect(classifyBreachSeverity({ breached: true })).toBe("action");
  });

  it("a SELF-CORRECTING breach → caution (amber), never red", () => {
    expect(classifyBreachSeverity({ breached: true, selfCorrects: true })).toBe("caution");
  });

  it("an ACKNOWLEDGED breach → caution (amber), never red", () => {
    expect(classifyBreachSeverity({ breached: true, acknowledged: true })).toBe("caution");
  });

  it("acknowledged takes precedence even when not self-correcting", () => {
    expect(
      classifyBreachSeverity({ breached: true, acknowledged: true, selfCorrects: false }),
    ).toBe("caution");
  });

  it("severityRank orders action > caution > ok", () => {
    expect(severityRank("action")).toBeGreaterThan(severityRank("caution"));
    expect(severityRank("caution")).toBeGreaterThan(severityRank("ok"));
  });
});

describe("Part 4 — rate / reinvestment risk", () => {
  it("downside still clears the target → ok (cushioned)", () => {
    expect(classifyRateRisk({ base: 5_200_000, low: 5_050_000, target: 5_000_000 })).toBe("ok");
  });

  it("rate-shock downside misses the target → caution", () => {
    expect(classifyRateRisk({ base: 5_100_000, low: 4_700_000, target: 5_000_000 })).toBe("caution");
  });

  it("rate risk never escalates to action on its own", () => {
    const sev = classifyRateRisk({ base: 5_000_000, low: 3_000_000, target: 5_000_000 });
    expect(sev).not.toBe("action");
    expect(sev).toBe("caution");
  });

  it("no base value → ok", () => {
    expect(classifyRateRisk({ base: 0, low: 0, target: 5_000_000 })).toBe("ok");
  });
});

describe("Part 4 — contribution-shortfall risk", () => {
  it("behind on pace → action", () => {
    expect(classifyContributionRisk({ paceStatus: "behind", isBackloaded: false })).toBe("action");
  });

  it("on pace but back-loaded → caution", () => {
    expect(classifyContributionRisk({ paceStatus: "on_pace", isBackloaded: true })).toBe("caution");
  });

  it("on pace and not back-loaded → ok", () => {
    expect(classifyContributionRisk({ paceStatus: "on_pace", isBackloaded: false })).toBe("ok");
  });

  it("ahead and not back-loaded → ok", () => {
    expect(classifyContributionRisk({ paceStatus: "ahead", isBackloaded: false })).toBe("ok");
  });
});

describe("Part 4 — liquidity-timing risk", () => {
  it("a security matures AFTER the goal (negative cushion) → action", () => {
    expect(
      classifyLiquidityTimingRisk({ cushionDays: -15, maturesNearOrAfterGoal: true }),
    ).toBe("action");
  });

  it("matures near the goal (positive but small cushion) → caution", () => {
    expect(
      classifyLiquidityTimingRisk({ cushionDays: 20, maturesNearOrAfterGoal: true }),
    ).toBe("caution");
  });

  it("comfortable cushion → ok", () => {
    expect(
      classifyLiquidityTimingRisk({ cushionDays: 200, maturesNearOrAfterGoal: false }),
    ).toBe("ok");
  });

  it("no maturities at all → ok", () => {
    expect(
      classifyLiquidityTimingRisk({ cushionDays: null, maturesNearOrAfterGoal: false }),
    ).toBe("ok");
  });
});
