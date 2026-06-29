/**
 * Part 7.2 — reconcile (no-clobber) tests.
 *
 * `reconcileScrape` is the pure heart of "a fresh scrape never silently overwrites
 * a figure a human checked". These tests pin the three behaviours from the brief:
 *   - unverified figures are refreshed by the scrape;
 *   - a human figure that AGREES with the scrape keeps its value/state (only
 *     fetchedAt is refreshed — we re-looked, trust unchanged);
 *   - a human figure that DISAGREES keeps its value AND raises a conflict (the
 *     scrape is recorded for review, never applied).
 */
import { describe, it, expect } from "vitest";
import {
  reconcileScrape,
  scrapedField,
  applyVerification,
  type FieldProvenanceMap,
} from "../../shared/provenance";

const t0 = Date.parse("2026-06-01T00:00:00Z");
const t1 = Date.parse("2026-06-29T00:00:00Z");

function scrapedMap(value: string, asOf = t0): FieldProvenanceMap {
  return { yield: scrapedField({ value, source: "src A", asOf, fetchedAt: asOf }) };
}

describe("reconcileScrape", () => {
  it("applies a scrape over an UNVERIFIED figure", () => {
    const existing = scrapedMap("8.60");
    const fresh = { yield: scrapedField({ value: "8.75", source: "src B", asOf: t1, fetchedAt: t1 }) };
    const { merged, conflicts, changed } = reconcileScrape(existing, fresh);
    expect(merged.yield?.value).toBe("8.75");
    expect(merged.yield?.verificationState).toBe("scraped_unverified");
    expect(conflicts).toHaveLength(0);
    expect(changed).toBe(true);
  });

  it("keeps a human figure and raises NO conflict when the scrape AGREES", () => {
    const human = { yield: applyVerification(scrapedMap("8.60").yield!, { kind: "confirm", by: "Jane", at: t0 }) };
    const fresh = { yield: scrapedField({ value: "8.60", source: "src B", asOf: t1, fetchedAt: t1 }) };
    const { merged, conflicts } = reconcileScrape(human, fresh);
    expect(merged.yield?.value).toBe("8.60");
    expect(merged.yield?.verificationState).toBe("human_verified");
    expect(merged.yield?.verifiedBy).toBe("Jane");
    expect(merged.yield?.fetchedAt).toBe(t1); // we re-checked
    expect(conflicts).toHaveLength(0);
  });

  it("NEVER clobbers a human figure when the scrape DISAGREES — it flags a conflict", () => {
    const human = { yield: applyVerification(scrapedMap("8.60").yield!, { kind: "override", by: "Jane", at: t0, value: "8.60" }) };
    const fresh = { yield: scrapedField({ value: "9.10", source: "CBK auction 2026-06-29", asOf: t1, fetchedAt: t1 }) };
    const { merged, conflicts } = reconcileScrape(human, fresh);

    // Human value is untouched.
    expect(merged.yield?.value).toBe("8.60");
    expect(merged.yield?.verificationState).toBe("human_entered");

    // The disagreement is recorded for review.
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      field: "yield",
      humanValue: "8.60",
      humanState: "human_entered",
      scrapedValue: "9.10",
      scrapedSource: "CBK auction 2026-06-29",
      scrapedAsOf: t1,
    });
  });

  it("treats numerically-equal values as agreement (8.60 vs 8.600)", () => {
    const human = { yield: applyVerification(scrapedMap("8.60").yield!, { kind: "confirm", by: "J", at: t0 }) };
    const fresh = { yield: scrapedField({ value: "8.600", source: "src", asOf: t1, fetchedAt: t1 }) };
    const { conflicts } = reconcileScrape(human, fresh);
    expect(conflicts).toHaveLength(0);
  });

  it("leaves figures absent from the scrape untouched", () => {
    const existing: FieldProvenanceMap = {
      yield: applyVerification(scrapedMap("8.60").yield!, { kind: "confirm", by: "J", at: t0 }),
      expense: scrapedField({ value: "1.20", source: "src", asOf: t0, fetchedAt: t0 }),
    };
    const fresh = { expense: scrapedField({ value: "1.25", source: "src B", asOf: t1, fetchedAt: t1 }) };
    const { merged, conflicts } = reconcileScrape(existing, fresh);
    expect(merged.yield?.value).toBe("8.60"); // untouched
    expect(merged.expense?.value).toBe("1.25"); // unverified -> refreshed
    expect(conflicts).toHaveLength(0);
  });
});
