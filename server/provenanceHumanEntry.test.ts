import { describe, expect, it } from "vitest";
import {
  humanField,
  applyVerification,
  scrapedField,
  viewerStateLabel,
  isHumanChecked,
  type VerifyAction,
} from "../shared/provenance";

/**
 * Part 7.3 — human override & verification workflow (pure layer).
 *
 * These cover the two pure pieces 7.3 adds/extends:
 *  1. `humanField` — a hand-authored figure starts as human_entered with citation.
 *  2. `applyVerification` override now threads an optional authoritative
 *     source/sourceUrl/asOf so a correction records WHERE the value came from,
 *     not just the number. The core invariant (human attention raises trust,
 *     never silently changes only the number) must still hold.
 */
describe("humanField (hand-authored figure)", () => {
  const AT = Date.UTC(2026, 5, 29);

  it("starts at human_entered with verifiedBy/verifiedAt and the cited source", () => {
    const f = humanField({
      value: "9.25",
      source: "ILAM fact sheet Q1-2026",
      sourceUrl: "https://example.com/ilam.pdf",
      asOf: Date.UTC(2026, 2, 31),
      by: "Jane M.",
      at: AT,
    });
    expect(f.value).toBe("9.25");
    expect(f.verificationState).toBe("human_entered");
    expect(isHumanChecked(f.verificationState)).toBe(true);
    expect(f.verifiedBy).toBe("Jane M.");
    expect(f.verifiedAt).toBe(AT);
    expect(f.source).toBe("ILAM fact sheet Q1-2026");
    expect(f.sourceUrl).toBe("https://example.com/ilam.pdf");
    expect(f.asOf).toBe(Date.UTC(2026, 2, 31));
    expect(f.fetchedAt).toBe(AT);
  });

  it("falls back to a labelled source and defaults asOf to entry time when omitted", () => {
    const f = humanField({ value: "100", source: "  ", by: "You", at: AT });
    expect(f.source).toBe("Entered by you");
    expect(f.sourceUrl).toBeNull();
    expect(f.asOf).toBe(AT);
  });
});

describe("applyVerification override threads the human's source", () => {
  const AT = Date.UTC(2026, 5, 29);
  const base = () =>
    scrapedField({
      value: "8.60",
      source: "Sanlam daily prices",
      sourceUrl: "https://sanlam.example/daily",
      asOf: Date.UTC(2026, 5, 1),
    });

  it("records the authoritative source/url/asOf the human cites on override", () => {
    const action: VerifyAction = {
      kind: "override",
      by: "Jane M.",
      at: AT,
      value: "7.77",
      source: "ILAM fact sheet Q1-2026",
      sourceUrl: "https://example.com/ilam.pdf",
      asOf: Date.UTC(2026, 2, 31),
    };
    const out = applyVerification(base(), action);
    expect(out.value).toBe("7.77");
    expect(out.verificationState).toBe("human_entered");
    expect(out.source).toBe("ILAM fact sheet Q1-2026");
    expect(out.sourceUrl).toBe("https://example.com/ilam.pdf");
    expect(out.asOf).toBe(Date.UTC(2026, 2, 31));
    expect(out.verifiedBy).toBe("Jane M.");
  });

  it("keeps the prior source when the human gives a value but no source", () => {
    const out = applyVerification(base(), { kind: "override", by: "You", at: AT, value: "7.50" });
    expect(out.value).toBe("7.50");
    expect(out.verificationState).toBe("human_entered");
    // source was not provided -> keep the prior origin rather than blanking it
    expect(out.source).toBe("Sanlam daily prices");
    // asOf defaults to the action time for a hand override
    expect(out.asOf).toBe(AT);
  });

  it("a blank explicit source falls back to the hand-entered label", () => {
    const out = applyVerification(base(), {
      kind: "override",
      by: "You",
      at: AT,
      value: "7.50",
      source: "   ",
      sourceUrl: "",
    });
    expect(out.source).toBe("Entered by you");
    expect(out.sourceUrl).toBeNull();
  });
});

describe("viewerStateLabel (end-user neutral wording)", () => {
  it("phrases states impersonally for the public catalog view", () => {
    expect(viewerStateLabel("human_verified")).toBe("Verified");
    expect(viewerStateLabel("human_entered")).toBe("Maintainer-entered");
    expect(viewerStateLabel("stale")).toBe("May be stale");
    expect(viewerStateLabel("scraped_unverified")).toBe("Unverified scrape");
  });
});
