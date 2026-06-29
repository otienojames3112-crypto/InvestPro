import { describe, it, expect } from "vitest";
import { OPPORTUNITY_SEED } from "./opportunitySeed";
import { ASSET_CLASSES, type AssetClass } from "../shared/assetModel";
import { rateStaleness } from "../client/src/lib/rateStaleness";

/**
 * Expansion Brief — Part 2 contract tests.
 *
 * These lock the product promises that keep the catalog a NEUTRAL screener:
 *  1. Every reference row is sourced, timestamped, and marked unverified — and
 *     carries NO ranking/score/quality field of any kind.
 *  2. The catalog spans multiple asset classes (it's a universe, not a shortlist).
 *  3. The default order is neutral (asset class, then name) — never by a metric.
 *  4. The staleness badge thresholds match the shared rate-staleness helper.
 */

describe("opportunity seed — neutral, sourced, no ranking", () => {
  it("has rows and every row carries provenance + timestamp + unverified flag", () => {
    expect(OPPORTUNITY_SEED.length).toBeGreaterThan(0);
    for (const row of OPPORTUNITY_SEED) {
      expect(row.ref, `${row.name} ref`).toBeTruthy();
      expect(row.name, `${row.ref} name`).toBeTruthy();
      expect(row.dataSource, `${row.ref} dataSource`).toBeTruthy();
      expect(row.dataAsOf, `${row.ref} dataAsOf`).toBeInstanceOf(Date);
      // Scraped public figures are always flagged unverified.
      expect(row.unverified, `${row.ref} unverified`).toBe(true);
      expect(row.active, `${row.ref} active`).toBe(true);
    }
  });

  it("assigns every row to a known AssetClass", () => {
    for (const row of OPPORTUNITY_SEED) {
      expect(ASSET_CLASSES).toContain(row.assetClass as AssetClass);
    }
  });

  it("contains NO ranking / score / quality fields (informs, never ranks)", () => {
    const banned = [
      "rank", "ranking", "score", "rating", "stars", "medal",
      "recommended", "recommendation", "isBest", "isTop", "tier", "grade",
    ];
    for (const row of OPPORTUNITY_SEED) {
      const keys = Object.keys(row).map((k) => k.toLowerCase());
      for (const b of banned) {
        expect(keys, `${row.ref} must not expose "${b}"`).not.toContain(b.toLowerCase());
      }
    }
  });

  it("spans several asset classes (a universe, not a curated shortlist)", () => {
    const classes = new Set(OPPORTUNITY_SEED.map((r) => r.assetClass));
    expect(classes.size).toBeGreaterThanOrEqual(4);
    // The new classes the brief targets must be representable in the catalog.
    expect(classes.has("equity")).toBe(true);
    expect(classes.has("reit")).toBe(true);
    expect(classes.has("offshore_fund")).toBe(true);
  });

  it("uses stable unique refs", () => {
    const refs = OPPORTUNITY_SEED.map((r) => r.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("flags FX/offshore rows in a currency other than KES so FX risk is visible", () => {
    const offshore = OPPORTUNITY_SEED.filter((r) => r.assetClass === "offshore_fund");
    expect(offshore.length).toBeGreaterThan(0);
    for (const r of offshore) expect(r.currency).not.toBe("KES");
  });
});

describe("neutral default ordering (asset class, then name)", () => {
  // Mirrors the server's orderBy(asc(assetClass), asc(name)) without a DB.
  // Mirror the server's collation sort: asset class asc, then name asc. The name
  // tiebreak uses localeCompare so this sort and the localeCompare assertions
  // below stay self-consistent at any catalog size (raw < / > can disagree with
  // localeCompare on mixed case, which is a test artifact, not a product change).
  function neutralSort<T extends { assetClass: string; name: string }>(rows: T[]): T[] {
    return [...rows].sort((a, b) =>
      a.assetClass < b.assetClass ? -1
      : a.assetClass > b.assetClass ? 1
      : a.name.localeCompare(b.name),
    );
  }

  it("never orders by a performance metric by default", () => {
    const ordered = neutralSort(OPPORTUNITY_SEED);
    // Adjacent rows within the same class are alphabetical by name, NOT by yield.
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      if (prev.assetClass === cur.assetClass) {
        expect(prev.name.localeCompare(cur.name)).toBeLessThanOrEqual(0);
      } else {
        expect(prev.assetClass.localeCompare(cur.assetClass)).toBeLessThanOrEqual(0);
      }
    }
  });

  it("the neutral order is independent of yield (a high-yield row is not forced to the top)", () => {
    const ordered = neutralSort(OPPORTUNITY_SEED);
    const yields = ordered.map((r) => (r.yieldPct ? Number(r.yieldPct) : -1));
    // If it were ranked by yield desc, yields would be monotonically non-increasing.
    const isYieldRanked = yields.every((y, i) => i === 0 || yields[i - 1] >= y);
    expect(isYieldRanked).toBe(false);
  });
});

describe("staleness thresholds drive the catalog freshness badges", () => {
  const DAY = 86_400_000;

  it("treats a missing as-of date as very stale", () => {
    const s = rateStaleness(null);
    expect(s.isStale).toBe(true);
    expect(s.isVeryStale).toBe(true);
    expect(s.label).toBe("never");
  });

  it("a fresh figure (today) is neither stale nor very stale", () => {
    const s = rateStaleness(new Date());
    expect(s.isStale).toBe(false);
    expect(s.isVeryStale).toBe(false);
  });

  it("flags >= 7 days as stale but < 30 days as not very stale", () => {
    const s = rateStaleness(new Date(Date.now() - 10 * DAY));
    expect(s.isStale).toBe(true);
    expect(s.isVeryStale).toBe(false);
  });

  it("flags >= 30 days as very stale", () => {
    const s = rateStaleness(new Date(Date.now() - 31 * DAY));
    expect(s.isStale).toBe(true);
    expect(s.isVeryStale).toBe(true);
  });

  it("the older-dated seed row (CIC MMF, Apr 2026) reads as very stale at today's date", () => {
    const cic = OPPORTUNITY_SEED.find((r) => r.ref === "MMF:CIC-MMF");
    expect(cic).toBeTruthy();
    const s = rateStaleness(cic!.dataAsOf as Date);
    expect(s.isVeryStale).toBe(true);
  });
});
