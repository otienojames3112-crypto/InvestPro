import { describe, it, expect } from "vitest";
import { isConcentrationSnoozed, buildDiversifyLink } from "../shared/discount";

describe("R60 — isConcentrationSnoozed", () => {
  const now = 1_700_000_000_000; // fixed reference

  it("returns false for null/undefined/zero", () => {
    expect(isConcentrationSnoozed(null, now)).toBe(false);
    expect(isConcentrationSnoozed(undefined, now)).toBe(false);
    expect(isConcentrationSnoozed(0, now)).toBe(false);
  });

  it("returns true when the snooze timestamp is in the future", () => {
    expect(isConcentrationSnoozed(now + 1, now)).toBe(true);
    expect(isConcentrationSnoozed(now + 30 * 24 * 3600 * 1000, now)).toBe(true);
  });

  it("returns false when the snooze timestamp is in the past or exactly now", () => {
    expect(isConcentrationSnoozed(now - 1, now)).toBe(false);
    expect(isConcentrationSnoozed(now, now)).toBe(false);
  });

  it("defaults `now` to Date.now() and treats far-future as snoozed", () => {
    const farFuture = Date.now() + 365 * 24 * 3600 * 1000;
    expect(isConcentrationSnoozed(farFuture)).toBe(true);
    const farPast = Date.now() - 365 * 24 * 3600 * 1000;
    expect(isConcentrationSnoozed(farPast)).toBe(false);
  });
});

describe("R60 — buildDiversifyLink", () => {
  it("includes the rounded face value and default liquid type", () => {
    expect(buildDiversifyLink(1_234_567.8)).toBe(
      "/securities?add=1&addType=tbill_364&face=1234568",
    );
  });

  it("honours a custom add type", () => {
    expect(buildDiversifyLink(500_000, "tbill_182")).toBe(
      "/securities?add=1&addType=tbill_182&face=500000",
    );
  });

  it("omits the face param for non-positive amounts", () => {
    expect(buildDiversifyLink(0)).toBe("/securities?add=1&addType=tbill_364");
    expect(buildDiversifyLink(-100)).toBe("/securities?add=1&addType=tbill_364");
    expect(buildDiversifyLink(0.3)).toBe("/securities?add=1&addType=tbill_364");
  });

  it("rounds half-shilling amounts up", () => {
    expect(buildDiversifyLink(99.5)).toContain("face=100");
  });
});
