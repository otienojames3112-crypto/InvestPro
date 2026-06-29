import { describe, it, expect } from "vitest";
import {
  scrapedField,
  applyVerification,
  effectiveState,
  isStaleForDisplay,
  mergeScrape,
  summariseState,
  humanCheckedCount,
  figureCount,
  buildSeedProvenance,
  trustRank,
  isAtLeastAsTrusted,
  isHumanChecked,
  stateLabel,
  STALE_AFTER_DAYS,
  type FieldProvenance,
} from "../shared/provenance";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 5, 29, 12, 0, 0); // 29-Jun-2026

function fresh(value = "8.45", asOf = NOW): FieldProvenance {
  return scrapedField({ value, source: "NSE close", sourceUrl: "https://x", asOf });
}

describe("trust ranking", () => {
  it("orders ai_extracted < stale < scraped < verified < entered", () => {
    expect(trustRank("ai_extracted")).toBeLessThan(trustRank("stale"));
    expect(trustRank("stale")).toBeLessThan(trustRank("scraped_unverified"));
    expect(trustRank("scraped_unverified")).toBeLessThan(trustRank("human_verified"));
    expect(trustRank("human_verified")).toBeLessThan(trustRank("human_entered"));
  });
  it("ai_extracted is the absolute lowest trust of all states", () => {
    const others = ["stale", "scraped_unverified", "human_verified", "human_entered"] as const;
    for (const s of others) {
      expect(trustRank("ai_extracted")).toBeLessThan(trustRank(s));
    }
  });
  it("isAtLeastAsTrusted is reflexive and correct", () => {
    expect(isAtLeastAsTrusted("human_entered", "human_verified")).toBe(true);
    expect(isAtLeastAsTrusted("scraped_unverified", "human_verified")).toBe(false);
    expect(isAtLeastAsTrusted("human_verified", "human_verified")).toBe(true);
  });
});

describe("scrapedField", () => {
  it("starts unverified with no human stamps", () => {
    const p = fresh();
    expect(p.verificationState).toBe("scraped_unverified");
    expect(p.verifiedBy).toBeNull();
    expect(p.verifiedAt).toBeNull();
    expect(isHumanChecked(p.verificationState)).toBe(false);
    expect(p.fetchedAt).toBe(NOW); // defaults to asOf when not given
  });
});

describe("applyVerification — confirm raises trust", () => {
  it("confirm moves scraped -> human_verified and stamps who/when, value unchanged", () => {
    const p = fresh("8.45");
    const out = applyVerification(p, { kind: "confirm", by: "James", at: NOW });
    expect(out.verificationState).toBe("human_verified");
    expect(out.value).toBe("8.45"); // number not changed by a confirm
    expect(out.verifiedBy).toBe("James");
    expect(out.verifiedAt).toBe(NOW);
    expect(isHumanChecked(out.verificationState)).toBe(true);
  });
});

describe("applyVerification — override raises trust AND changes the number", () => {
  it("override moves to human_entered, updates value, asOf and stamps", () => {
    const p = fresh("8.45");
    const out = applyVerification(p, { kind: "override", by: "James", at: NOW + DAY, value: "8.60" });
    expect(out.verificationState).toBe("human_entered");
    expect(out.value).toBe("8.60"); // value changed
    expect(out.asOf).toBe(NOW + DAY); // re-stamped to the human's action time
    expect(out.verifiedBy).toBe("James");
    expect(out.verifiedAt).toBe(NOW + DAY);
  });

  it("a confirm after an override keeps the higher human_entered state", () => {
    const entered = applyVerification(fresh("8.45"), {
      kind: "override",
      by: "James",
      at: NOW,
      value: "8.60",
    });
    const confirmed = applyVerification(entered, { kind: "confirm", by: "Mary", at: NOW + DAY });
    // Trust never goes down: entered (3) stays above verified (2).
    expect(confirmed.verificationState).toBe("human_entered");
    expect(confirmed.value).toBe("8.60");
    // but the latest human attention is still recorded
    expect(confirmed.verifiedBy).toBe("Mary");
    expect(confirmed.verifiedAt).toBe(NOW + DAY);
  });

  it("human action never lowers trust", () => {
    const verified = applyVerification(fresh(), { kind: "confirm", by: "A", at: NOW });
    const out = applyVerification(verified, { kind: "confirm", by: "B", at: NOW + DAY });
    expect(trustRank(out.verificationState)).toBeGreaterThanOrEqual(trustRank(verified.verificationState));
  });
});

describe("effectiveState — staleness is display-only and never downgrades a human figure", () => {
  it("a scraped figure older than the threshold displays as stale", () => {
    const old = fresh("8.45", NOW - (STALE_AFTER_DAYS + 1) * DAY);
    expect(effectiveState(old, NOW)).toBe("stale");
    expect(isStaleForDisplay(old, NOW)).toBe(true);
  });
  it("a fresh scraped figure is not stale", () => {
    expect(effectiveState(fresh("8.45", NOW - 1 * DAY), NOW)).toBe("scraped_unverified");
  });
  it("a human-verified figure is NEVER shown stale, no matter how old", () => {
    const old = applyVerification(fresh("8.45", NOW - 999 * DAY), { kind: "confirm", by: "J", at: NOW - 999 * DAY });
    expect(effectiveState(old, NOW)).toBe("human_verified");
    expect(isStaleForDisplay(old, NOW)).toBe(false);
  });
  it("a figure with no asOf is never stale", () => {
    const p = scrapedField({ value: "1", source: "s", asOf: null });
    expect(effectiveState(p, NOW)).toBe("scraped_unverified");
  });
});

describe("mergeScrape — re-scrape cannot silently lower a human-checked figure", () => {
  it("keeps the human's value/state and only refreshes fetchedAt", () => {
    const entered = applyVerification(fresh("8.45"), {
      kind: "override",
      by: "James",
      at: NOW,
      value: "8.60",
    });
    const rescrape = scrapedField({ value: "8.10", source: "NSE close", asOf: NOW + 10 * DAY });
    const merged = mergeScrape(entered, rescrape);
    expect(merged.value).toBe("8.60"); // human value preserved
    expect(merged.verificationState).toBe("human_entered");
    expect(merged.fetchedAt).toBe(NOW + 10 * DAY); // but we note we looked again
  });
  it("replaces an unverified figure", () => {
    const old = fresh("8.45");
    const rescrape = scrapedField({ value: "8.10", source: "NSE close", asOf: NOW + DAY });
    expect(mergeScrape(old, rescrape).value).toBe("8.10");
  });
  it("returns the scrape when there is no existing figure", () => {
    const rescrape = scrapedField({ value: "8.10", source: "NSE", asOf: NOW });
    expect(mergeScrape(undefined, rescrape)).toBe(rescrape);
  });
});

describe("map summaries", () => {
  const map = buildSeedProvenance({
    source: "african-markets.com (FAHR)",
    sourceUrl: "https://x",
    asOf: NOW,
    figures: { price: "11.0000", distribution: "6.4000", trailingReturn: "-5.6500", yield: "6.4000" },
  });

  it("buildSeedProvenance creates one unverified entry per present figure only", () => {
    expect(figureCount(map)).toBe(4);
    expect(Object.keys(map).sort()).toEqual(["distribution", "price", "trailingReturn", "yield"]);
    expect(map.price?.verificationState).toBe("scraped_unverified");
    expect(map.price?.value).toBe("11.0000"); // number preserved verbatim
    expect(map.price?.source).toBe("african-markets.com (FAHR)");
    expect(map.fx).toBeUndefined(); // absent figure -> no entry
  });

  it("summariseState reflects the WEAKEST figure (a row is only as trusted as its least-checked number)", () => {
    // All scraped -> row is scraped_unverified.
    expect(summariseState(map)).toBe("scraped_unverified");
    // Confirming ONE figure does not lift the row while others remain scraped.
    const m2 = { ...map, price: applyVerification(map.price!, { kind: "confirm", by: "J", at: NOW }) };
    expect(summariseState(m2)).toBe("scraped_unverified");
    // The row only reaches a human state once EVERY figure is human-checked.
    let m3: typeof map = { ...m2 };
    for (const k of Object.keys(m3) as (keyof typeof m3)[]) {
      m3[k] = applyVerification(m3[k]!, { kind: "confirm", by: "J", at: NOW });
    }
    expect(summariseState(m3)).toBe("human_verified");
  });

  it("humanCheckedCount counts only human-checked figures", () => {
    expect(humanCheckedCount(map)).toBe(0);
    const m2 = { ...map, price: applyVerification(map.price!, { kind: "confirm", by: "J", at: NOW }) };
    expect(humanCheckedCount(m2)).toBe(1);
  });

  it("maturity figure is stored as an ISO string value", () => {
    const m = buildSeedProvenance({
      source: "CBK",
      asOf: NOW,
      figures: { coupon: "13.50", tenor: "15.00", maturity: new Date(Date.UTC(2041, 2, 1)) },
    });
    expect(m.coupon?.value).toBe("13.50");
    expect(m.maturity?.value).toBe(new Date(Date.UTC(2041, 2, 1)).toISOString());
    expect(m.price).toBeUndefined(); // gov coupon paper has no price figure
  });
});

describe("stateLabel", () => {
  it("maps states to human copy", () => {
    expect(stateLabel("scraped_unverified")).toBe("Unverified");
    expect(stateLabel("human_verified")).toBe("Verified by you");
    expect(stateLabel("human_entered")).toBe("Entered by you");
    expect(stateLabel("stale")).toBe("May be stale");
    expect(stateLabel("ai_extracted")).toBe("AI-extracted · unverified — confirm against source");
  });
});
