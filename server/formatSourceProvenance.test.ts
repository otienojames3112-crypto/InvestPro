/**
 * Stage 6b — the shared "Source: X · as of Y" provenance line reused across the
 * Holdings tabs (MMF, Government, Bank), and the one OtherAssets.tsx already had.
 * Pure, no DB, no network.
 */
import { describe, expect, it } from "vitest";
import { formatSourceProvenance } from "../client/src/lib/format";

describe("Stage 6b · formatSourceProvenance (pure)", () => {
  it("renders 'Source: X · as of Y' when both are present", () => {
    expect(formatSourceProvenance("CBK Weekly Bulletin", "2026-06-01")).toBe(
      `Source: CBK Weekly Bulletin · as of ${new Date("2026-06-01").toLocaleDateString()}`,
    );
  });

  it("renders just 'Source: X' when there is no as-of", () => {
    expect(formatSourceProvenance("CBK Weekly Bulletin", null)).toBe("Source: CBK Weekly Bulletin");
  });

  it("never returns blank — falls back to the given fallback source when source is null/undefined/empty", () => {
    expect(formatSourceProvenance(null, null)).toBe("Source: No source on record");
    expect(formatSourceProvenance(undefined, undefined)).toBe("Source: No source on record");
    expect(formatSourceProvenance("   ", null)).toBe("Source: No source on record");
  });

  it("accepts a custom fallback (e.g. 'manual entry')", () => {
    expect(formatSourceProvenance(null, null, "manual entry")).toBe("Source: manual entry");
  });

  it("an as-of can still accompany the fallback source — it's a real caller-supplied date, not fabricated", () => {
    expect(formatSourceProvenance(null, "2026-06-01", "manual entry")).toBe(
      `Source: manual entry · as of ${new Date("2026-06-01").toLocaleDateString()}`,
    );
  });

  it("accepts a Date object or epoch-ms number for as-of, not just a string", () => {
    const d = new Date("2026-06-01");
    expect(formatSourceProvenance("X", d)).toContain(d.toLocaleDateString());
    expect(formatSourceProvenance("X", d.getTime())).toContain(d.toLocaleDateString());
  });

  it("trims whitespace from a real source", () => {
    expect(formatSourceProvenance("  CBK Bulletin  ", null)).toBe("Source: CBK Bulletin");
  });
});
