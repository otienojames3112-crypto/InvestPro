/**
 * Stage 7c — makes Stage 5's suggestFollowUpQuestions() candidate-aware, using
 * Stage 7b's persisted extractedFields._candidatePhrases. Pure, no LLM, no DB, no
 * network. A candidate only ever sharpens the QUESTION WORDING — it never fills a
 * field, never satisfies the approval gate, never auto-drafts or auto-sends
 * anything. The generic (no-candidate) question text is byte-for-byte unchanged
 * from before this slice.
 */
import { describe, expect, it } from "vitest";
import { suggestFollowUpQuestions } from "../shared/researchPipeline";
import { parseCandidatePhrases, type CandidateMatch } from "../shared/candidatePhrases";

describe("Stage 7c · suggestFollowUpQuestions is candidate-aware (additive)", () => {
  it("a candidate with a value produces the sharper 'I found X: Y — should this be used' question", () => {
    const qs = suggestFollowUpQuestions(
      [{ key: "maturityDate", label: "maturity date" }],
      "FXD1/2022/010",
      [{ key: "maturityDate", phrase: "Due Date", value: "15-Jan-2032" }],
    );
    expect(qs).toHaveLength(1);
    expect(qs[0].question).toBe(
      "I found 'Due Date: 15-Jan-2032' in the source. Should this be used as the maturity date for this FXD1/2022/010?",
    );
  });

  it("a candidate for value/settlement date produces the same sharper phrasing", () => {
    const qs = suggestFollowUpQuestions(
      [{ key: "valueDate", label: "value / settlement date" }],
      "91-Day Treasury Bill",
      [{ key: "valueDate", phrase: "payment deadline", value: "14-Jul-2026" }],
    );
    expect(qs[0].question).toBe(
      "I found 'payment deadline: 14-Jul-2026' in the source. Should this be used as the value / settlement date for this 91-Day Treasury Bill?",
    );
  });

  it("a candidate for yield (weighted average) and clean price both work when there's a matching missing rule", () => {
    const qs = suggestFollowUpQuestions(
      [
        { key: "yieldPct", label: "rate / coupon / previous average rate" },
        { key: "cleanPrice", label: "clean price" },
      ],
      "FXD1/2022/010",
      [
        { key: "yieldPct", phrase: "weighted average rate of accepted bids", value: "8.8347%" },
        { key: "cleanPrice", phrase: "Price per Kshs 100", value: "98.75" },
      ],
    );
    expect(qs[0].question).toContain("weighted average rate of accepted bids: 8.8347%");
    expect(qs[0].question).toContain("Should this be used as the rate / coupon / previous average rate");
    expect(qs[1].question).toContain("Price per Kshs 100: 98.75");
    expect(qs[1].question).toContain("Should this be used as the clean price");
  });

  it("a candidate with NO captured value (phrase found, value null) asks to check, not to confirm a specific number", () => {
    const qs = suggestFollowUpQuestions(
      [{ key: "maturityDate", label: "maturity date" }],
      "FXD1/2022/010",
      [{ key: "maturityDate", phrase: "Due Date", value: null }],
    );
    expect(qs[0].question).toBe(
      "I found 'Due Date' in the source, near where the maturity date would be. Can you check whether this is the maturity date for this FXD1/2022/010?",
    );
    // Never asserts a colon-separated "phrase: value" pair when no value was captured.
    expect(qs[0].question).not.toContain("Due Date:");
  });

  it("no candidate at all keeps the EXACT pre-Stage-7c generic question, unchanged", () => {
    const qs = suggestFollowUpQuestions([{ key: "maturityDate", label: "maturity date" }], "FXD1/2022/010");
    expect(qs[0].question).toBe("Can you check the source again for the maturity date for this FXD1/2022/010?");
  });

  it("a missing rule with no MATCHING candidate (candidates list non-empty but for other keys) also keeps the generic question", () => {
    const qs = suggestFollowUpQuestions(
      [{ key: "maturityDate", label: "maturity date" }],
      "FXD1/2022/010",
      [{ key: "couponRate", phrase: "coupon rate", value: "13.5%" }], // different key
    );
    expect(qs[0].question).toBe("Can you check the source again for the maturity date for this FXD1/2022/010?");
  });

  it("a candidate takes priority over the value-assertion ('must be'/'must not') phrasing when both could apply", () => {
    const qs = suggestFollowUpQuestions(
      [{ key: "taxExempt", label: "tax-exempt flag must be TRUE for an infrastructure bond" }],
      "IFB1/2024/017",
      [{ key: "taxExempt", phrase: "tax status", value: "exempt" }],
    );
    expect(qs[0].question).toContain("I found 'tax status: exempt'");
    expect(qs[0].question).not.toContain("doesn't clearly confirm");
  });

  it("the value-assertion phrasing is unchanged when there's no candidate for that rule", () => {
    const qs = suggestFollowUpQuestions(
      [{ key: "taxExempt", label: "tax-exempt flag must be TRUE for an infrastructure bond" }],
      "IFB1/2024/017",
    );
    expect(qs[0].question).toBe(
      "The source doesn't clearly confirm: tax-exempt flag must be TRUE for an infrastructure bond. Can you check IFB1/2024/017 again and confirm?",
    );
  });

  it("phrasing is always a QUESTION that asks the manager to confirm — never states the candidate as settled fact", () => {
    const qs = suggestFollowUpQuestions(
      [{ key: "maturityDate", label: "maturity date" }],
      "FXD1/2022/010",
      [{ key: "maturityDate", phrase: "Due Date", value: "15-Jan-2032" }],
    );
    expect(qs[0].question).toMatch(/\?$/);
    expect(qs[0].question).toMatch(/should this be used|can you check/i);
  });

  it("empty candidates array behaves identically to omitting the parameter entirely", () => {
    const withEmpty = suggestFollowUpQuestions([{ key: "maturityDate", label: "maturity date" }], "X", []);
    const withOmitted = suggestFollowUpQuestions([{ key: "maturityDate", label: "maturity date" }], "X");
    expect(withEmpty).toEqual(withOmitted);
  });
});

describe("Stage 7c · parseCandidatePhrases (pure, never throws)", () => {
  it("parses a well-formed JSON array back into CandidateMatch[]", () => {
    const raw = JSON.stringify([{ key: "maturityDate", label: "maturity date", phrase: "Due Date", value: "15-Jan-2032" }]);
    const parsed = parseCandidatePhrases(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].key).toBe("maturityDate");
    expect(parsed[0].phrase).toBe("Due Date");
  });

  it("a value of null is preserved correctly (not coerced to a string 'null')", () => {
    const raw = JSON.stringify([{ key: "maturityDate", label: "maturity date", phrase: "Due Date", value: null }]);
    expect(parseCandidatePhrases(raw)[0].value).toBeNull();
  });

  it("undefined, null, and empty-string input all safely return []", () => {
    expect(parseCandidatePhrases(undefined)).toEqual([]);
    expect(parseCandidatePhrases(null)).toEqual([]);
    expect(parseCandidatePhrases("")).toEqual([]);
  });

  it("malformed JSON (syntax error) safely falls back to [], never throws", () => {
    expect(() => parseCandidatePhrases("{not valid json")).not.toThrow();
    expect(parseCandidatePhrases("{not valid json")).toEqual([]);
  });

  it("well-formed JSON that isn't an array safely falls back to []", () => {
    expect(parseCandidatePhrases(JSON.stringify({ key: "x" }))).toEqual([]);
    expect(parseCandidatePhrases(JSON.stringify("just a string"))).toEqual([]);
    expect(parseCandidatePhrases(JSON.stringify(42))).toEqual([]);
  });

  it("an array containing wrongly-shaped entries filters them out rather than throwing or including garbage", () => {
    const raw = JSON.stringify([
      { key: "maturityDate", label: "maturity date", phrase: "Due Date", value: "15-Jan-2032" }, // valid
      { key: "couponRate" }, // missing label/phrase/value
      "not even an object",
      null,
      { key: 123, label: "x", phrase: "y", value: null }, // wrong type for key
    ]);
    const parsed = parseCandidatePhrases(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].key).toBe("maturityDate");
  });

  it("a non-string, non-null value field is rejected (never coerces a number/object into a phrase value)", () => {
    const raw = JSON.stringify([{ key: "maturityDate", label: "maturity date", phrase: "Due Date", value: 12345 }]);
    expect(parseCandidatePhrases(raw)).toEqual([]);
  });

  it("round-trips cleanly with a real Stage 7b CandidateMatch shape", () => {
    const candidate: CandidateMatch = { key: "cleanPrice", label: "clean price", phrase: "Price per Kshs 100", value: "98.75" };
    const raw = JSON.stringify([candidate]);
    expect(parseCandidatePhrases(raw)).toEqual([candidate]);
  });
});

describe("Stage 7c · guardrails — candidate never auto-fills, auto-sends, drafts, or approves", () => {
  it("suggestFollowUpQuestions only ever returns {key,label,question} — no value/figure/status field that could be mistaken for a confirmed fact", () => {
    const qs = suggestFollowUpQuestions(
      [{ key: "maturityDate", label: "maturity date" }],
      "X",
      [{ key: "maturityDate", phrase: "Due Date", value: "15-Jan-2032" }],
    );
    expect(Object.keys(qs[0]).sort()).toEqual(["key", "label", "question"]);
  });

  it("parseCandidatePhrases returns plain data — no side effects, no mutation of its input", () => {
    const raw = JSON.stringify([{ key: "maturityDate", label: "maturity date", phrase: "Due Date", value: "15-Jan-2032" }]);
    const before = raw;
    parseCandidatePhrases(raw);
    expect(raw).toBe(before); // the input string itself is never touched
  });
});
