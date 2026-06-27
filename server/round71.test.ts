import { describe, it, expect } from "vitest";
import { filterBreachAcks, type BreachAckFilterRow } from "../shared/discount";
import { GLOSSARY } from "../client/src/lib/glossary";

const DAY = 24 * 60 * 60 * 1000;
const JAN1 = new Date("2026-01-01T00:00:00Z").getTime();

type Row = BreachAckFilterRow & { id: number };

const rows: Row[] = [
  { id: 1, capKind: "issuer", at: JAN1 },
  { id: 2, capKind: "type", at: JAN1 + 10 * DAY },
  { id: 3, capKind: "issuer", at: JAN1 + 20 * DAY },
  { id: 4, capKind: "type", at: JAN1 + 30 * DAY },
];

describe("R71.1 — filterBreachAcks", () => {
  it("passes everything through with the default/all filter", () => {
    expect(filterBreachAcks(rows, {}).length).toBe(4);
    expect(filterBreachAcks(rows, { capKind: "all" }).length).toBe(4);
  });

  it("filters by cap kind", () => {
    expect(filterBreachAcks(rows, { capKind: "issuer" }).map((r) => r.id)).toEqual([1, 3]);
    expect(filterBreachAcks(rows, { capKind: "type" }).map((r) => r.id)).toEqual([2, 4]);
  });

  it("respects an inclusive fromMs lower bound", () => {
    expect(
      filterBreachAcks(rows, { fromMs: JAN1 + 10 * DAY }).map((r) => r.id),
    ).toEqual([2, 3, 4]);
  });

  it("respects an inclusive toMs upper bound", () => {
    expect(
      filterBreachAcks(rows, { toMs: JAN1 + 20 * DAY }).map((r) => r.id),
    ).toEqual([1, 2, 3]);
  });

  it("combines kind + date range", () => {
    expect(
      filterBreachAcks(rows, {
        capKind: "issuer",
        fromMs: JAN1 + 5 * DAY,
        toMs: JAN1 + 25 * DAY,
      }).map((r) => r.id),
    ).toEqual([3]);
  });

  it("handles Date-typed `at` fields (superjson revival)", () => {
    const dateRows: Row[] = rows.map((r) => ({ ...r, at: new Date(r.at as number) }));
    expect(
      filterBreachAcks(dateRows, { fromMs: JAN1 + 10 * DAY, toMs: JAN1 + 20 * DAY }).map(
        (r) => r.id,
      ),
    ).toEqual([2, 3]);
  });

  it("returns an empty array for empty input", () => {
    expect(filterBreachAcks([], { capKind: "type" })).toEqual([]);
  });

  it("null bounds leave that side unbounded", () => {
    expect(filterBreachAcks(rows, { fromMs: null, toMs: null }).length).toBe(4);
  });
});

describe("R71.3 — Reconciliation glossary deep-link ids exist", () => {
  const ids = new Set(GLOSSARY.map((g) => g.id));
  it("every id referenced in the Reconciliation help text is a real glossary entry", () => {
    for (const id of [
      "accrued-interest",
      "liquid-reserve-diversification",
      "allocation-policy",
      "per-issuer-cap",
      "per-type-cap",
    ]) {
      expect(ids.has(id), `glossary missing "${id}"`).toBe(true);
    }
  });
});
