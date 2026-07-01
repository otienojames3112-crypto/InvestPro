import { describe, it, expect } from "vitest";
import {
  scaleShareToPct,
  pickTopIssuer,
  topIssuerSharePct,
  effectiveReconciled,
  nextCashEvents,
  effectiveMmfEar,
  type ConcentrationLike,
} from "@/lib/diagnostics";

describe("scaleShareToPct — 0–1 fraction → percent units for formatPct", () => {
  it("scales a full share to 100", () => {
    expect(scaleShareToPct(1)).toBe(100);
  });
  it("scales a quarter cap to 25", () => {
    expect(scaleShareToPct(0.25)).toBe(25);
  });
  it("treats null/undefined/NaN as 0 (no NaN% leaks into the UI)", () => {
    expect(scaleShareToPct(null)).toBe(0);
    expect(scaleShareToPct(undefined)).toBe(0);
    expect(scaleShareToPct(Number.NaN)).toBe(0);
  });
});

describe("pickTopIssuer / topIssuerSharePct", () => {
  const conc: ConcentrationLike = {
    cap: 0.25,
    netWorth: 1_000_000,
    topShare: 0.4,
    breaches: [
      { issuer: "Bank A", value: 100_000, share: 0.1 },
      { issuer: "Bank C", value: 400_000, share: 0.4 },
      { issuer: "Bank B", value: 300_000, share: 0.3 },
    ],
  };

  it("returns the single worst issuer by share without mutating input", () => {
    const snapshot = JSON.parse(JSON.stringify(conc.breaches));
    const top = pickTopIssuer(conc);
    expect(top?.issuer).toBe("Bank C");
    expect(conc.breaches).toEqual(snapshot); // original order preserved
  });

  it("returns null when there are no breaches", () => {
    expect(pickTopIssuer({ ...conc, breaches: [] })).toBeNull();
    expect(pickTopIssuer(null)).toBeNull();
    expect(pickTopIssuer(undefined)).toBeNull();
  });

  it("top issuer share is scaled to percent", () => {
    expect(topIssuerSharePct(conc)).toBeCloseTo(40, 6);
  });

  it("falls back to aggregate topShare when there are no discrete breaches", () => {
    expect(topIssuerSharePct({ ...conc, breaches: [] })).toBeCloseTo(40, 6);
    expect(topIssuerSharePct(undefined)).toBe(0);
  });
});

describe("effectiveReconciled — verdict precedence", () => {
  it("prefers the explicit Dashboard verdict", () => {
    expect(effectiveReconciled({ reconciled: false, basisOk: true }, true)).toBe(false);
    expect(effectiveReconciled({ reconciled: true, basisOk: true }, false)).toBe(true);
  });
  it("falls back to the snapshot flag when no verdict", () => {
    expect(effectiveReconciled(null, false)).toBe(false);
    expect(effectiveReconciled(undefined, true)).toBe(true);
  });
  it("treats unknown state as reconciled (no false alarm)", () => {
    expect(effectiveReconciled(null, null)).toBe(true);
    expect(effectiveReconciled(undefined, undefined)).toBe(true);
  });
});

describe("nextCashEvents — soonest-first, at-or-after as-of, capped", () => {
  const asOf = 1_000;
  const events = [
    { atMs: 500, kind: "past" },
    { atMs: 2_000, kind: "b" },
    { atMs: 1_000, kind: "now" },
    { atMs: 3_000, kind: "c" },
    { atMs: 1_500, kind: "a" },
  ];

  it("drops past events, sorts ascending, and caps to N", () => {
    const out = nextCashEvents(events, asOf, 3);
    expect(out.map((e) => e.kind)).toEqual(["now", "a", "b"]);
  });

  it("includes events exactly at the as-of instant", () => {
    const out = nextCashEvents(events, asOf, 5);
    expect(out.some((e) => e.atMs === asOf)).toBe(true);
  });

  it("does not mutate the input and handles empty/null", () => {
    const copy = [...events];
    nextCashEvents(events, asOf, 3);
    expect(events).toEqual(copy);
    expect(nextCashEvents(null, asOf)).toEqual([]);
    expect(nextCashEvents([], asOf)).toEqual([]);
  });
});

describe("effectiveMmfEar — selected fund EAR beats manual yield", () => {
  it("uses the selected fund EAR when present", () => {
    expect(effectiveMmfEar(9.12, 8.78)).toBe(9.12);
  });
  it("falls back to the manual MMF yield when no fund selected", () => {
    expect(effectiveMmfEar(null, 8.78)).toBe(8.78);
    expect(effectiveMmfEar(undefined, 8.78)).toBe(8.78);
  });
});
