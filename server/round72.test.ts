import { describe, it, expect } from "vitest";
import {
  toUtcMidnight,
  advance,
  daysBetween,
  nextEventAfter,
  eventsInWindow,
  clampTarget,
  parseDateToUtcMidnight,
  formatUtcDate,
  applyVariance,
  type SimEvent,
} from "../shared/timeMachine";
import { buildMaterializePlan, monthStartDate } from "./timeMachineEngine";
import type { MonthResult } from "./engine";

const DAY = 24 * 60 * 60 * 1000;
const D = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));

describe("R72 Time Machine — pure date/step math", () => {
  it("normalises any instant to UTC midnight", () => {
    const noon = Date.UTC(2026, 0, 15, 12, 30, 45, 123);
    expect(toUtcMidnight(noon)).toBe(D("2026-01-15"));
  });

  it("steps days and weeks additively", () => {
    const base = D("2026-01-01");
    expect(advance(base, "day", 1)).toBe(D("2026-01-02"));
    expect(advance(base, "day", 10)).toBe(D("2026-01-11"));
    expect(advance(base, "week", 1)).toBe(D("2026-01-08"));
    expect(advance(base, "week", 2)).toBe(D("2026-01-15"));
  });

  it("steps whole calendar months with day clamping", () => {
    expect(advance(D("2026-01-31"), "month", 1)).toBe(D("2026-02-28")); // clamp to Feb
    expect(advance(D("2024-01-31"), "month", 1)).toBe(D("2024-02-29")); // leap year
    expect(advance(D("2026-01-15"), "month", 1)).toBe(D("2026-02-15"));
    expect(advance(D("2026-12-15"), "month", 1)).toBe(D("2027-01-15")); // year rollover
  });

  it("steps years (12-month multiples) with leap clamping", () => {
    expect(advance(D("2026-03-10"), "year", 1)).toBe(D("2027-03-10"));
    expect(advance(D("2024-02-29"), "year", 1)).toBe(D("2025-02-28")); // leap -> non-leap clamp
  });

  it("count<=0 is a no-op returning the midnight base", () => {
    expect(advance(D("2026-05-05"), "month", 0)).toBe(D("2026-05-05"));
  });

  it("daysBetween counts whole UTC days", () => {
    expect(daysBetween(D("2026-01-01"), D("2026-01-11"))).toBe(10);
    expect(daysBetween(D("2026-01-11"), D("2026-01-01"))).toBe(-10);
    expect(daysBetween(D("2026-03-01"), D("2026-03-01"))).toBe(0);
  });
});

const events: SimEvent[] = [
  { at: D("2026-02-01"), kind: "contribution", label: "Feb contribution" },
  { at: D("2026-03-15"), kind: "maturity", label: "T-bill matures" },
  { at: D("2026-06-30"), kind: "coupon", label: "IFB coupon" },
];

describe("R72 Time Machine — event navigation", () => {
  it("finds the soonest event strictly after the cursor", () => {
    expect(nextEventAfter(D("2026-01-01"), events)?.label).toBe("Feb contribution");
    expect(nextEventAfter(D("2026-02-01"), events)?.label).toBe("T-bill matures"); // strictly after
    expect(nextEventAfter(D("2026-07-01"), events)).toBeNull();
  });

  it("returns events strictly after cur and up to/including target, sorted", () => {
    const win = eventsInWindow(D("2026-01-15"), D("2026-03-15"), events);
    expect(win.map((e) => e.label)).toEqual(["Feb contribution", "T-bill matures"]);
  });

  it("excludes the current instant but includes the exact target", () => {
    const win = eventsInWindow(D("2026-02-01"), D("2026-06-30"), events);
    expect(win.map((e) => e.label)).toEqual(["T-bill matures", "IFB coupon"]);
  });
});

describe("R72 Time Machine — clamp & parse", () => {
  const anchor = D("2026-01-01");
  it("never lets the clock move before the anchor", () => {
    expect(clampTarget(D("2025-06-01"), anchor)).toBe(anchor);
  });
  it("caps at the horizon maximum", () => {
    expect(clampTarget(D("2200-01-01"), anchor, 60)).toBe(D("2086-01-01"));
  });
  it("passes through a valid in-range target", () => {
    expect(clampTarget(D("2030-05-05"), anchor)).toBe(D("2030-05-05"));
  });
  it("parses valid YYYY-MM-DD and rejects impossible dates", () => {
    expect(parseDateToUtcMidnight("2026-02-28")).toBe(D("2026-02-28"));
    expect(parseDateToUtcMidnight("2026-02-31")).toBeNull(); // round-trip guard
    expect(parseDateToUtcMidnight("2026-13-01")).toBeNull();
    expect(parseDateToUtcMidnight("garbage")).toBeNull();
  });
  it("formats UTC date back to YYYY-MM-DD", () => {
    expect(formatUtcDate(D("2026-07-04"))).toBe("2026-07-04");
  });
});

describe("R72 Time Machine — variance", () => {
  it("scales amounts and floors at zero", () => {
    expect(applyVariance(1000, 1)).toBe(1000);
    expect(applyVariance(1000, 0.8)).toBe(800);
    expect(applyVariance(1000, 1.25)).toBe(1250);
    expect(applyVariance(1000, -2)).toBe(0); // never negative
  });
  it("passes through when factor is undefined/NaN", () => {
    expect(applyVariance(500, undefined)).toBe(500);
    expect(applyVariance(500, NaN)).toBe(500);
  });
});

// ── Materialisation planner ───────────────────────────────────────────────────
function months(contribs: number[]): MonthResult[] {
  // Minimal MonthResult stubs — only the fields the planner reads.
  return contribs.map((c, i) => ({ monthNumber: i + 1, contribution: c }) as unknown as MonthResult);
}
const START = "2026-01-01";

describe("R72 Time Machine — materialisation planner", () => {
  const mr = months([10000, 10000, 12000, 12000, 12000, 15000]);

  it("accrue_only writes nothing regardless of elapsed months", () => {
    const plan = buildMaterializePlan(mr, START, 0, 4, "accrue_only");
    expect(plan.specs).toHaveLength(0);
    expect(plan.totalContribution).toBe(0);
    expect(plan.monthsElapsed).toBe(4);
  });

  it("accept_plan writes one contribution per newly elapsed month", () => {
    const plan = buildMaterializePlan(mr, START, 0, 3, "accept_plan");
    expect(plan.specs.map((s) => s.monthNumber)).toEqual([1, 2, 3]);
    expect(plan.specs.map((s) => s.amount)).toEqual([10000, 10000, 12000]);
    expect(plan.totalContribution).toBe(32000);
    expect(plan.specs.map((s) => s.depositDate)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("only materialises the NEW window (prev+1 .. next), not already-elapsed months", () => {
    const plan = buildMaterializePlan(mr, START, 2, 5, "accept_plan");
    expect(plan.specs.map((s) => s.monthNumber)).toEqual([3, 4, 5]);
    expect(plan.totalContribution).toBe(36000);
  });

  it("CRITICAL: one big fast-forward == the union of many single-month steps", () => {
    // Big jump 0 -> 6
    const big = buildMaterializePlan(mr, START, 0, 6, "accept_plan");

    // Day-by-day equivalent: six single-month advances, accumulating specs.
    const stepped: ReturnType<typeof buildMaterializePlan>["specs"] = [];
    let stepTotal = 0;
    for (let m = 0; m < 6; m++) {
      const p = buildMaterializePlan(mr, START, m, m + 1, "accept_plan");
      stepped.push(...p.specs);
      stepTotal += p.totalContribution;
    }

    expect(stepped.map((s) => s.monthNumber)).toEqual(big.specs.map((s) => s.monthNumber));
    expect(stepped.map((s) => s.amount)).toEqual(big.specs.map((s) => s.amount));
    expect(stepped.map((s) => s.depositDate)).toEqual(big.specs.map((s) => s.depositDate));
    expect(stepTotal).toBe(big.totalContribution);
  });

  it("inject_variance scales every contribution by the factor", () => {
    const plan = buildMaterializePlan(mr, START, 0, 2, "inject_variance", { contributionFactor: 0.5 });
    expect(plan.specs.map((s) => s.amount)).toEqual([5000, 5000]);
    expect(plan.totalContribution).toBe(10000);
    expect(plan.specs[0].notes).toContain("variance 50% of plan");
  });

  it("skips zero/blank contribution months", () => {
    const withGap = months([10000, 0, 12000]);
    const plan = buildMaterializePlan(withGap, START, 0, 3, "accept_plan");
    expect(plan.specs.map((s) => s.monthNumber)).toEqual([1, 3]);
  });

  it("monthStartDate offsets calendar months from the plan start", () => {
    expect(monthStartDate("2026-01-01", 1)).toBe("2026-01-01");
    expect(monthStartDate("2026-01-15", 3)).toBe("2026-03-15");
    expect(monthStartDate("2026-11-30", 4)).toBe("2027-02-28"); // clamp + year rollover
  });
});
