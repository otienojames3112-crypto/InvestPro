import { describe, it, expect } from "vitest";
import { applyRateShock, getRatesForMonth, type EngineSettings } from "./engine";
import { parseStepLog, popLastStep, type SimStep } from "../shared/timeMachine";

/**
 * R73 — Time Machine refinements: rate-shock stress test + undo step log.
 */

const BASE = {
  mmfYield: 10,
  tbill91Rate: 9,
  tbill182Rate: 9.5,
  tbill364Rate: 10,
  ifbCouponRate: 13,
  fxdCouponRate: 12,
  withholdingTax: 15,
};

describe("R73 rate-shock — applyRateShock", () => {
  it("returns the input unchanged when no shock is supplied", () => {
    expect(applyRateShock(BASE, "2026-06-01", undefined)).toEqual(BASE);
  });

  it("leaves months BEFORE the effective date untouched", () => {
    const out = applyRateShock(BASE, "2026-05-31", { effectiveDate: "2026-06-01", deltaPct: -2 });
    expect(out).toEqual(BASE);
  });

  it("shifts every yield by deltaPct on/after the effective date", () => {
    const out = applyRateShock(BASE, "2026-06-01", { effectiveDate: "2026-06-01", deltaPct: -2 });
    expect(out.mmfYield).toBe(8);
    expect(out.tbill91Rate).toBe(7);
    expect(out.tbill182Rate).toBe(7.5);
    expect(out.tbill364Rate).toBe(8);
    expect(out.ifbCouponRate).toBe(11);
    expect(out.fxdCouponRate).toBe(10);
  });

  it("never shocks the withholding tax", () => {
    const out = applyRateShock(BASE, "2026-07-01", { effectiveDate: "2026-06-01", deltaPct: -3 });
    expect(out.withholdingTax).toBe(15);
  });

  it("floors shocked rates at 0 (no negative yields)", () => {
    const out = applyRateShock(BASE, "2026-06-01", { effectiveDate: "2026-06-01", deltaPct: -20 });
    expect(out.mmfYield).toBe(0);
    expect(out.tbill91Rate).toBe(0);
    expect(out.ifbCouponRate).toBe(0); // 13 - 20 floored
    expect(out.fxdCouponRate).toBe(0);
  });

  it("supports positive shocks (rate hike)", () => {
    const out = applyRateShock(BASE, "2026-06-01", { effectiveDate: "2026-06-01", deltaPct: 1.5 });
    expect(out.mmfYield).toBe(11.5);
    expect(out.ifbCouponRate).toBe(14.5);
  });

  it("treats the boundary date as inclusive (>= effectiveDate)", () => {
    const onDate = applyRateShock(BASE, "2026-06-01", { effectiveDate: "2026-06-01", deltaPct: -2 });
    const dayBefore = applyRateShock(BASE, "2026-05-31", { effectiveDate: "2026-06-01", deltaPct: -2 });
    expect(onDate.mmfYield).toBe(8);
    expect(dayBefore.mmfYield).toBe(10);
  });
});

describe("R73 rate-shock — getRatesForMonth honours the shock", () => {
  const settings = { ...BASE, rateShock: { effectiveDate: "2026-06-01", deltaPct: -2 } } as unknown as EngineSettings;

  it("applies the shock for an on/after month with no rate history", () => {
    const after = getRatesForMonth(new Date("2026-06-15T00:00:00Z"), [], settings);
    expect(after.mmfYield).toBe(8);
    expect(after.fxdCouponRate).toBe(10);
  });

  it("does not apply the shock for a month before the effective date", () => {
    const before = getRatesForMonth(new Date("2026-04-15T00:00:00Z"), [], settings);
    expect(before.mmfYield).toBe(10);
  });

  it("returns base rates when no shock is set", () => {
    const plain = getRatesForMonth(new Date("2026-09-15T00:00:00Z"), [], BASE as unknown as EngineSettings);
    expect(plain.mmfYield).toBe(10);
  });
});

describe("R73 undo — parseStepLog / popLastStep", () => {
  const sample: SimStep[] = [
    { fromMs: 100, toMs: 200, mode: "accept_plan", depositIds: [1, 2] },
    { fromMs: 200, toMs: 300, mode: "inject_variance", depositIds: [3] },
  ];

  it("parses a valid JSON log", () => {
    expect(parseStepLog(JSON.stringify(sample))).toEqual(sample);
  });

  it("returns [] for null/empty/garbage", () => {
    expect(parseStepLog(null)).toEqual([]);
    expect(parseStepLog("")).toEqual([]);
    expect(parseStepLog("not json")).toEqual([]);
    expect(parseStepLog("{}")).toEqual([]);
  });

  it("filters out malformed entries", () => {
    const mixed = JSON.stringify([sample[0], { fromMs: "x" }, { nope: true }]);
    expect(parseStepLog(mixed)).toEqual([sample[0]]);
  });

  it("pops the last step and returns the remainder", () => {
    const { step, rest } = popLastStep(sample);
    expect(step).toEqual(sample[1]);
    expect(rest).toEqual([sample[0]]);
  });

  it("returns step: null for an empty log", () => {
    const { step, rest } = popLastStep([]);
    expect(step).toBeNull();
    expect(rest).toEqual([]);
  });

  it("popping every step leaves an empty log (full unwind == reset boundary)", () => {
    let log = [...sample];
    let popped = 0;
    while (true) {
      const { step, rest } = popLastStep(log);
      if (!step) break;
      popped++;
      log = rest;
    }
    expect(popped).toBe(2);
    expect(log).toEqual([]);
  });
});
