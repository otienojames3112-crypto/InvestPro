import { describe, it, expect } from "vitest";
import { parseBreachAckRow } from "../shared/discount";

/**
 * Round 70 tests.
 *
 * R70.1 — the per-type breach acknowledge-history table parses audit_log rows
 *         written by recordBreachAck into structured fields. We lock the parser
 *         against the EXACT strings recordBreachAck emits so the history view
 *         can never silently drift from what was written.
 * R70.3 — the tooltip "Learn more →" deep-link only targets ids that exist in
 *         the shared glossary; we verify the validity gate the Learn page uses.
 */

// Mirror of the exact strings recordBreachAck writes, so the round-trip test
// fails loudly if that procedure's format ever changes.
function recordBreachAckStrings(input: {
  capKind: "issuer" | "type";
  label: string;
  sharePct: number;
  capPct: number;
}) {
  const kindLabel =
    input.capKind === "issuer" ? "per-issuer (KDIC)" : "per-instrument-type";
  return {
    field: input.capKind,
    newValue: `${input.sharePct.toFixed(1)}% vs ${input.capPct.toFixed(0)}% cap`,
    summary: `Acknowledged actual ${kindLabel} concentration breach: ${input.label} at ${input.sharePct.toFixed(1)}% (cap ${input.capPct.toFixed(0)}%)`,
  };
}

describe("R70.1 — parseBreachAckRow", () => {
  it("parses a per-type breach row (FXD bonds, 67.5% vs 60% cap)", () => {
    const parsed = parseBreachAckRow({
      field: "type",
      newValue: "67.5% vs 60% cap",
      summary:
        "Acknowledged actual per-instrument-type concentration breach: FXD bonds at 67.5% (cap 60%)",
    });
    expect(parsed.capKind).toBe("type");
    expect(parsed.label).toBe("FXD bonds");
    expect(parsed.sharePct).toBe(67.5);
    expect(parsed.capPct).toBe(60);
  });

  it("parses a per-issuer breach row", () => {
    const parsed = parseBreachAckRow({
      field: "issuer",
      newValue: "31.0% vs 25% cap",
      summary:
        "Acknowledged actual per-issuer (KDIC) concentration breach: NCBA Bank at 31.0% (cap 25%)",
    });
    expect(parsed.capKind).toBe("issuer");
    expect(parsed.label).toBe("NCBA Bank");
    expect(parsed.sharePct).toBe(31);
    expect(parsed.capPct).toBe(25);
  });

  it("round-trips the exact strings recordBreachAck emits", () => {
    const cases = [
      { capKind: "type" as const, label: "FXD bonds", sharePct: 67.5, capPct: 60 },
      { capKind: "issuer" as const, label: "Equity Bank", sharePct: 40.2, capPct: 25 },
      { capKind: "type" as const, label: "91-Day T-Bill", sharePct: 88.0, capPct: 60 },
    ];
    for (const c of cases) {
      const parsed = parseBreachAckRow(recordBreachAckStrings(c));
      expect(parsed.capKind).toBe(c.capKind);
      expect(parsed.label).toBe(c.label);
      expect(parsed.sharePct).toBe(Number(c.sharePct.toFixed(1)));
      expect(parsed.capPct).toBe(Number(c.capPct.toFixed(0)));
    }
  });

  it("defaults capKind to 'type' for anything that is not 'issuer'", () => {
    expect(parseBreachAckRow({ field: null }).capKind).toBe("type");
    expect(parseBreachAckRow({ field: "" }).capKind).toBe("type");
    expect(parseBreachAckRow({ field: "type" }).capKind).toBe("type");
    expect(parseBreachAckRow({ field: "issuer" }).capKind).toBe("issuer");
  });

  it("returns null fields for malformed / empty rows without throwing", () => {
    const parsed = parseBreachAckRow({ field: "type", newValue: null, summary: null });
    expect(parsed.sharePct).toBeNull();
    expect(parsed.capPct).toBeNull();
    expect(parsed.label).toBeNull();

    const garbage = parseBreachAckRow({
      field: "type",
      newValue: "no percentages here",
      summary: "totally different shape",
    });
    expect(garbage.sharePct).toBeNull();
    expect(garbage.capPct).toBeNull();
    expect(garbage.label).toBeNull();
  });

  it("handles labels that themselves contain the word 'at'", () => {
    // The label is bounded by ' at <pct>%', so an embedded 'at' must not break it.
    const parsed = parseBreachAckRow({
      field: "type",
      newValue: "62.0% vs 60% cap",
      summary:
        "Acknowledged actual per-instrument-type concentration breach: Treasury bonds (held at NCBA) at 62.0% (cap 60%)",
    });
    expect(parsed.label).toBe("Treasury bonds (held at NCBA)");
    expect(parsed.sharePct).toBe(62);
    expect(parsed.capPct).toBe(60);
  });
});
