import { describe, it, expect } from "vitest";
import { OPPORTUNITY_SEED } from "./opportunitySeed";
import { ASSET_CLASSES, type AssetClass } from "../shared/assetModel";
import {
  FIELD_KEYS,
  type FieldKey,
  type FieldProvenance,
  type FieldProvenanceMap,
  scrapedField,
  applyVerification,
  reconcileScrape,
  effectiveStateForClass,
  staleDaysForClass,
  STALE_AFTER_DAYS,
  modelFreshnessPrompt,
  isHumanChecked,
} from "../shared/provenance";

/**
 * Expansion Brief — Part 7.4–7.6 guardrail tests.
 *
 * Part 7.4 expanded the catalog toward a representative universe. These tests
 * lock the invariants the brief restates in 7.6 so breadth never dilutes the
 * product's honesty promises, AT ANY catalog size:
 *
 *   1. Facts only — every seeded figure carries source + asOf + fetchedAt + a
 *      verification state, and starts scraped_unverified. There is NO field
 *      anywhere a ranking/score/quality signal could live.
 *   2. Neutral default order (asset class, then name) holds at large size — a
 *      longer list is never tempted into a "top/popular" sort.
 *   3. Human values are never silently overwritten by a scrape (7.5 reconcile).
 *   4. Per-asset-type staleness thresholds drive the freshness display, and the
 *      Model-step prompt fires (non-blocking) on stale/unverified driving figures.
 */

const DAY = 86_400_000;

// ── 7.4: the expanded universe is broad AND fully sourced ────────────────────
describe("Part 7.4 — expanded catalog is broad and fully provenanced", () => {
  it("grew into a representative universe across the target classes", () => {
    expect(OPPORTUNITY_SEED.length).toBeGreaterThanOrEqual(25);
    const byClass = new Map<string, number>();
    for (const r of OPPORTUNITY_SEED) byClass.set(r.assetClass, (byClass.get(r.assetClass) ?? 0) + 1);
    // A fuller slice of each headline class the brief calls for.
    expect(byClass.get("equity") ?? 0).toBeGreaterThanOrEqual(5);
    expect(byClass.get("gov_coupon") ?? 0).toBeGreaterThanOrEqual(3);
    expect(byClass.get("gov_discount") ?? 0).toBeGreaterThanOrEqual(2);
    expect(byClass.get("cash_mmf") ?? 0).toBeGreaterThanOrEqual(3);
    expect(byClass.get("reit") ?? 0).toBeGreaterThanOrEqual(2);
    expect(byClass.get("offshore_fund") ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("every row maps to a known asset class and has a unique ref", () => {
    const refs = OPPORTUNITY_SEED.map((r) => r.ref);
    expect(new Set(refs).size).toBe(refs.length);
    for (const r of OPPORTUNITY_SEED) {
      expect(ASSET_CLASSES).toContain(r.assetClass as AssetClass);
    }
  });

  it("EVERY built figure carries source + asOf + fetchedAt + scraped_unverified (not a placeholder)", () => {
    for (const row of OPPORTUNITY_SEED) {
      const fp = (row.fieldProvenance ?? {}) as FieldProvenanceMap;
      const entries = Object.entries(fp) as Array<[FieldKey, FieldProvenance]>;
      // A real-sourced instrument has at least one factual figure with provenance.
      expect(entries.length, `${row.ref} must carry at least one figure`).toBeGreaterThan(0);
      for (const [key, p] of entries) {
        expect(FIELD_KEYS, `${row.ref}.${key} is a known field`).toContain(key);
        expect(p.source, `${row.ref}.${key} source`).toBeTruthy();
        expect(p.asOf, `${row.ref}.${key} asOf`).toBeTypeOf("number");
        expect(p.fetchedAt, `${row.ref}.${key} fetchedAt`).toBeTypeOf("number");
        // Seeded figures are raw scrapes — no human has checked them yet.
        expect(p.verificationState, `${row.ref}.${key} state`).toBe("scraped_unverified");
        expect(p.verifiedBy).toBeNull();
        expect(p.verifiedAt).toBeNull();
      }
    }
  });

  it("the per-figure provenance value never disagrees with the row's stored figure", () => {
    for (const row of OPPORTUNITY_SEED) {
      const fp = (row.fieldProvenance ?? {}) as FieldProvenanceMap;
      if (fp.price && row.lastPrice != null) {
        expect(Number(fp.price.value), `${row.ref} price`).toBeCloseTo(Number(row.lastPrice), 4);
      }
      // gov_coupon records the headline figure as a coupon, everything else as yield.
      if (row.assetClass === "gov_coupon" && fp.coupon && row.yieldPct != null) {
        expect(Number(fp.coupon.value), `${row.ref} coupon`).toBeCloseTo(Number(row.yieldPct), 4);
        expect(fp.yield, `${row.ref} must not double-count yield`).toBeUndefined();
      }
    }
  });
});

// ── 7.6: facts only — no path to a score/rank/recommendation anywhere ────────
describe("Part 7.6 — facts only, no ranking field can exist", () => {
  const BANNED = [
    "rank", "ranking", "score", "rating", "stars", "medal", "performer",
    "recommended", "recommendation", "isbest", "istop", "tier", "grade", "quality",
  ];

  it("no row column is a ranking/score/quality signal", () => {
    for (const row of OPPORTUNITY_SEED) {
      const keys = Object.keys(row).map((k) => k.toLowerCase());
      for (const b of BANNED) expect(keys, `${row.ref} exposes "${b}"`).not.toContain(b);
    }
  });

  it("no per-figure provenance key is a ranking/score signal (FieldKey is a closed factual set)", () => {
    // FIELD_KEYS is the only place a figure can live; assert it is purely factual.
    for (const k of FIELD_KEYS) {
      for (const b of BANNED) expect(k.toLowerCase()).not.toContain(b);
    }
    // And every built map only uses those keys.
    for (const row of OPPORTUNITY_SEED) {
      const fp = (row.fieldProvenance ?? {}) as FieldProvenanceMap;
      for (const k of Object.keys(fp)) expect(FIELD_KEYS).toContain(k as FieldKey);
    }
  });
});

// ── 7.6: neutral order holds at ANY size ─────────────────────────────────────
describe("Part 7.6 — neutral default order survives a large catalog", () => {
  function neutralSort<T extends { assetClass: string; name: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) =>
      a.assetClass < b.assetClass ? -1
      : a.assetClass > b.assetClass ? 1
      : a.name < b.name ? -1
      : a.name > b.name ? 1
      : 0,
    );
  }

  it("a 500-row synthetic catalog still orders by class then name, never by yield", () => {
    // Build a large catalog with DESCENDING yields in insertion order to make a
    // yield-ranked sort detectable.
    const big = Array.from({ length: 500 }, (_, i) => ({
      assetClass: ASSET_CLASSES[i % ASSET_CLASSES.length],
      name: `Instrument ${String(1000 - i).padStart(4, "0")}`,
      yieldPct: String(50 - i * 0.05),
    }));
    const ordered = neutralSort(big);
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      if (prev.assetClass === cur.assetClass) {
        expect(prev.name.localeCompare(cur.name)).toBeLessThanOrEqual(0);
      } else {
        expect(prev.assetClass.localeCompare(cur.assetClass)).toBeLessThanOrEqual(0);
      }
    }
    // It is NOT monotonic by yield (i.e. not secretly ranked by performance).
    const ys = ordered.map((r) => Number(r.yieldPct));
    const yieldRanked = ys.every((y, i) => i === 0 || ys[i - 1] >= y);
    expect(yieldRanked).toBe(false);
  });
});

// ── 7.6 / 7.5: scrapes never silently clobber a human value ──────────────────
describe("Part 7.6 — scrapes never silently overwrite human values", () => {
  function humanChecked(value: string): FieldProvenance {
    return applyVerification(
      scrapedField({ value: "1.00", source: "scrape", asOf: 0 }),
      { kind: "override", by: "Asha", at: 1_000, value },
    );
  }

  it("a disagreeing scrape against a human_entered figure raises a conflict, keeps the human value", () => {
    const existing: FieldProvenanceMap = { yield: humanChecked("9.10") };
    const scraped: FieldProvenanceMap = {
      yield: scrapedField({ value: "8.40", source: "fund sheet", asOf: 2_000 }),
    };
    const res = reconcileScrape(existing, scraped, 3_000);
    expect(res.merged.yield?.value).toBe("9.10"); // human value preserved
    expect(isHumanChecked(res.merged.yield!.verificationState)).toBe(true);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0]).toMatchObject({ field: "yield", humanValue: "9.10", scrapedValue: "8.40" });
  });

  it("a fresh scrape DOES refresh an unverified figure (no human attention to protect)", () => {
    const existing: FieldProvenanceMap = {
      yield: scrapedField({ value: "8.40", source: "old", asOf: 1_000 }),
    };
    const scraped: FieldProvenanceMap = {
      yield: scrapedField({ value: "8.55", source: "new", asOf: 2_000 }),
    };
    const res = reconcileScrape(existing, scraped, 3_000);
    expect(res.merged.yield?.value).toBe("8.55");
    expect(res.conflicts).toHaveLength(0);
  });
});

// ── 7.5: per-asset-type staleness thresholds + non-blocking model prompt ─────
describe("Part 7.5 — per-asset-type staleness + model-step prompt", () => {
  it("equities go stale faster than bonds/MMF (per-class thresholds)", () => {
    expect(staleDaysForClass("equity")).toBeLessThan(staleDaysForClass("gov_coupon"));
    expect(staleDaysForClass("equity")).toBeLessThan(staleDaysForClass("cash_mmf"));
    // Unknown class falls back to the generic threshold (never throws).
    expect(staleDaysForClass("totally_new_class")).toBe(STALE_AFTER_DAYS);
    expect(staleDaysForClass(null)).toBe(STALE_AFTER_DAYS);
  });

  it("a 5-day-old equity price reads stale, but the same age MMF yield does not", () => {
    const now = 100 * DAY;
    const fiveDaysOld = scrapedField({ value: "18.5", source: "NSE", asOf: now - 5 * DAY });
    expect(effectiveStateForClass(fiveDaysOld, now, "equity")).toBe("stale");
    expect(effectiveStateForClass(fiveDaysOld, now, "cash_mmf")).toBe("scraped_unverified");
  });

  it("a human-checked figure never reads stale regardless of age or class", () => {
    const now = 1_000 * DAY;
    const old = applyVerification(
      scrapedField({ value: "9.0", source: "s", asOf: 0 }),
      { kind: "confirm", by: "Asha", at: 1 },
    );
    expect(effectiveStateForClass(old, now, "equity")).toBe("human_verified");
  });

  it("modelFreshnessPrompt fires on a stale driving figure but stays advisory (non-blocking)", () => {
    const now = 100 * DAY;
    const map: FieldProvenanceMap = {
      price: scrapedField({ value: "18.5", source: "NSE", asOf: now - 10 * DAY }),
    };
    const prompt = modelFreshnessPrompt({ map, assetClass: "equity", drivingFields: ["price"], nowMs: now });
    expect(prompt.shouldPrompt).toBe(true);
    expect(prompt.message).toMatch(/confirm or update/i);
    expect(prompt.flagged[0]).toMatchObject({ field: "price", state: "stale" });
  });

  it("modelFreshnessPrompt fires on an unverified driving figure", () => {
    const now = 100 * DAY;
    const map: FieldProvenanceMap = {
      yield: scrapedField({ value: "8.4", source: "sheet", asOf: now - 1 * DAY }),
    };
    const prompt = modelFreshnessPrompt({ map, assetClass: "cash_mmf", drivingFields: ["yield"], nowMs: now });
    expect(prompt.shouldPrompt).toBe(true);
    expect(prompt.flagged[0].state).toBe("scraped_unverified");
  });

  it("modelFreshnessPrompt is silent when the driving figure is human-verified", () => {
    const now = 100 * DAY;
    const map: FieldProvenanceMap = {
      price: applyVerification(
        scrapedField({ value: "18.5", source: "NSE", asOf: now - 10 * DAY }),
        { kind: "confirm", by: "Asha", at: now - 9 * DAY },
      ),
    };
    const prompt = modelFreshnessPrompt({ map, assetClass: "equity", drivingFields: ["price"], nowMs: now });
    expect(prompt.shouldPrompt).toBe(false);
    expect(prompt.message).toBeNull();
  });
});
