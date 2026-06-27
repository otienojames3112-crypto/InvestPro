import { describe, it, expect } from "vitest";
import {
  describeStepTarget,
  parseStepLog,
  popLastStep,
  type SimStep,
} from "../shared/timeMachine";

describe("R74 · Time Machine history log helpers", () => {
  describe("describeStepTarget", () => {
    it("labels a single-unit step", () => {
      const s: SimStep = { fromMs: 0, toMs: 1, mode: "accrue_only", depositIds: [], targetKind: "step", stepUnit: "day", stepCount: 1 };
      expect(describeStepTarget(s)).toBe("+1 day");
    });

    it("pluralises a multi-unit step", () => {
      const s: SimStep = { fromMs: 0, toMs: 1, mode: "accrue_only", depositIds: [], targetKind: "step", stepUnit: "month", stepCount: 3 };
      expect(describeStepTarget(s)).toBe("+3 months");
    });

    it("defaults stepCount to 1 when omitted", () => {
      const s: SimStep = { fromMs: 0, toMs: 1, mode: "accrue_only", depositIds: [], targetKind: "step", stepUnit: "year" };
      expect(describeStepTarget(s)).toBe("+1 year");
    });

    it("labels a next-event jump", () => {
      const s: SimStep = { fromMs: 0, toMs: 1, mode: "accrue_only", depositIds: [], targetKind: "nextEvent" };
      expect(describeStepTarget(s)).toBe("Jump to next event");
    });

    it("labels a date jump", () => {
      const s: SimStep = { fromMs: 0, toMs: 1, mode: "accrue_only", depositIds: [], targetKind: "date" };
      expect(describeStepTarget(s)).toBe("Jump to date");
    });

    it("falls back to 'Advance' for legacy entries without targetKind", () => {
      const s: SimStep = { fromMs: 0, toMs: 1, mode: "accept_plan", depositIds: [5] };
      expect(describeStepTarget(s)).toBe("Advance");
    });
  });

  describe("parseStepLog back-compat", () => {
    it("parses legacy entries that omit the new display fields", () => {
      const raw = JSON.stringify([
        { fromMs: 100, toMs: 200, mode: "accrue_only", depositIds: [] },
        { fromMs: 200, toMs: 300, mode: "accept_plan", depositIds: [1, 2] },
      ]);
      const log = parseStepLog(raw);
      expect(log).toHaveLength(2);
      expect(log[1].depositIds).toEqual([1, 2]);
      expect(log[0].createdAt).toBeUndefined();
    });

    it("preserves rich display fields when present", () => {
      const rich: SimStep = {
        fromMs: 1,
        toMs: 2,
        mode: "inject_variance",
        depositIds: [9],
        createdAt: 1_700_000_000_000,
        monthsElapsed: 2,
        contributionsWritten: 2,
        contributionTotal: 50_000,
        targetKind: "date",
        rateShock: { effectiveDate: "2026-01-01", deltaPct: -2 },
      };
      const log = parseStepLog(JSON.stringify([rich]));
      expect(log).toHaveLength(1);
      expect(log[0].contributionTotal).toBe(50_000);
      expect(log[0].rateShock).toEqual({ effectiveDate: "2026-01-01", deltaPct: -2 });
    });

    it("drops malformed entries but keeps valid ones", () => {
      const raw = JSON.stringify([
        { fromMs: 1, toMs: 2, mode: "accrue_only", depositIds: [] },
        { nope: true },
        { fromMs: "x", toMs: 2, mode: "accrue_only", depositIds: [] },
      ]);
      expect(parseStepLog(raw)).toHaveLength(1);
    });

    it("returns [] for null/garbage", () => {
      expect(parseStepLog(null)).toEqual([]);
      expect(parseStepLog("not json")).toEqual([]);
      expect(parseStepLog("{}")).toEqual([]);
    });
  });

  describe("popLastStep ordering (drives 'next undo' marker)", () => {
    it("pops the most recent step, leaving the rest", () => {
      const log: SimStep[] = [
        { fromMs: 1, toMs: 2, mode: "accrue_only", depositIds: [] },
        { fromMs: 2, toMs: 3, mode: "accept_plan", depositIds: [7] },
      ];
      const { step, rest } = popLastStep(log);
      expect(step?.toMs).toBe(3);
      expect(rest).toHaveLength(1);
      expect(rest[0].toMs).toBe(2);
    });

    it("returns null step on an empty log", () => {
      expect(popLastStep([]).step).toBeNull();
    });
  });
});
