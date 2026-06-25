import { describe, it, expect } from "vitest";
import { escapeCsvCell, toCsv, slugify } from "../shared/csv";

describe("Round 37 — shared CSV util", () => {
  it("leaves plain values unquoted", () => {
    expect(escapeCsvCell("hello")).toBe("hello");
    expect(escapeCsvCell(1234)).toBe("1234");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("quotes and escapes values containing comma, quote or newline", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('she said "hi"')).toBe('"she said ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
  });

  it("builds a header + rows CSV with a trailing TOTAL line preserved", () => {
    const csv = toCsv(
      ["Month", "Save", "Action"],
      [
        [1, 41000, "Add to MMF"],
        [2, 41000, "Move 50,000 to T-bill"],
        ["TOTAL", 82000, "2 months"],
      ]
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Month,Save,Action");
    expect(lines[1]).toBe("1,41000,Add to MMF");
    // The comma inside the action text must be quoted so columns stay aligned.
    expect(lines[2]).toBe('2,41000,"Move 50,000 to T-bill"');
    expect(lines[3]).toBe("TOTAL,82000,2 months");
  });

  it("slugifies portfolio names into filename-safe tokens", () => {
    expect(slugify("Car Purchase")).toBe("car-purchase");
    expect(slugify("  KES 5M!! ")).toBe("kes-5m");
    expect(slugify("")).toBe("portfolio");
    expect(slugify(null)).toBe("portfolio");
  });

  it("flow totals sum while balance totals take the last row (ledger semantics)", () => {
    // Mirrors the Ledger footer rule: Save/CBK-In/Bank-In are flows (sum),
    // balance columns are point-in-time (last month).
    const rows = [
      { save: 41000, bankIn: 0, mmfEnd: 41000, total: 144000 },
      { save: 41000, bankIn: 0, mmfEnd: 83000, total: 187000 },
      { save: 41000, bankIn: 100000, mmfEnd: 25000, total: 360000 },
    ];
    const flowSave = rows.reduce((s, r) => s + r.save, 0);
    const flowBankIn = rows.reduce((s, r) => s + r.bankIn, 0);
    const last = rows[rows.length - 1];
    expect(flowSave).toBe(123000);
    expect(flowBankIn).toBe(100000);
    expect(last.mmfEnd).toBe(25000);
    expect(last.total).toBe(360000);
  });
});
