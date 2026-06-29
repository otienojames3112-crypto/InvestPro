import { describe, it, expect } from "vitest";

/**
 * Part 8.1 (review thumbnail) — the review queue surfaces the screenshot a maintainer
 * uploaded as the SOURCE for an AI image extraction, so a reviewer can confirm each
 * AI-extracted figure against the original picture. Two pure pieces of logic back that
 * feature and are unit-tested here in isolation (no DB / no network):
 *   1) keysToUrls — stored storage keys → ready-to-render /manus-storage/{key} URLs.
 *   2) appendImageKey — the append-only, de-duplicated, capped accumulation of keys.
 * Both mirror exactly what routers.aiReviewQueue and db.attachAiSourceImageKey do.
 */

/** Mirrors routers.aiReviewQueue: keys[] → served URLs[] (the template serves a signed redirect). */
function keysToUrls(keys: unknown): string[] {
  const arr = Array.isArray(keys) ? (keys as string[]) : [];
  return arr.map((k) => `/manus-storage/${k}`);
}

/** Mirrors db.attachAiSourceImageKey: append a key, de-dupe, keep only the 8 most recent. */
function appendImageKey(current: unknown, key: string): string[] {
  const arr = Array.isArray(current) ? (current as string[]) : [];
  if (!key || arr.includes(key)) return arr;
  return [...arr, key].slice(-8);
}

describe("Part 8.1 — review-queue source screenshot URLs", () => {
  it("maps each stored key to a served /manus-storage/ URL", () => {
    expect(keysToUrls(["abc-files/shot_1.png", "abc-files/shot_2.png"])).toEqual([
      "/manus-storage/abc-files/shot_1.png",
      "/manus-storage/abc-files/shot_2.png",
    ]);
  });

  it("treats a null/undefined/non-array column as no screenshots (never throws)", () => {
    expect(keysToUrls(null)).toEqual([]);
    expect(keysToUrls(undefined)).toEqual([]);
    expect(keysToUrls("not-an-array")).toEqual([]);
    expect(keysToUrls([])).toEqual([]);
  });
});

describe("Part 8.1 — attachAiSourceImageKey accumulation", () => {
  it("appends a new key to an empty/absent column", () => {
    expect(appendImageKey(null, "k1.png")).toEqual(["k1.png"]);
    expect(appendImageKey([], "k1.png")).toEqual(["k1.png"]);
  });

  it("is idempotent — re-recording the same key does not duplicate it", () => {
    expect(appendImageKey(["k1.png"], "k1.png")).toEqual(["k1.png"]);
  });

  it("accumulates multiple distinct screenshots in order", () => {
    let keys = appendImageKey(null, "k1.png");
    keys = appendImageKey(keys, "k2.png");
    keys = appendImageKey(keys, "k3.png");
    expect(keys).toEqual(["k1.png", "k2.png", "k3.png"]);
  });

  it("caps the list to the 8 most recent screenshots (oldest drop off)", () => {
    let keys: string[] = [];
    for (let i = 1; i <= 11; i++) keys = appendImageKey(keys, `k${i}.png`);
    expect(keys).toHaveLength(8);
    expect(keys[0]).toBe("k4.png"); // k1..k3 dropped
    expect(keys[7]).toBe("k11.png");
  });

  it("ignores an empty key (nothing to record)", () => {
    expect(appendImageKey(["k1.png"], "")).toEqual(["k1.png"]);
  });
});
