/**
 * Stage 5 — gap-driven follow-up question CHIPS on the Ask AI finding card. This
 * repo has no jsdom/testing-library for client components (vitest runs
 * `environment: "node"`); the established convention for asserting AskAI.tsx
 * behaviour (round85, askAiSearchCheckbox, sourcesUsedPanel, etc.) is a static read
 * of the source file plus targeted string/regex assertions. No DB, no network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf8");
const catalogueSourceReview = readFileSync(
  join(ROOT, "client/src/components/CatalogueSourceReview.tsx"),
  "utf8",
);

const findingCardIdx = askAi.indexOf("export function FindingCard(");
const findingCard = askAi.slice(findingCardIdx, askAi.indexOf("export function", findingCardIdx + 1));
const conversationIdx = askAi.indexOf("function Conversation(");
const conversation = askAi.slice(conversationIdx, askAi.indexOf("/* ── The opening enquiry box"));

describe("Stage 5 · FindingCard suggestion chips", () => {
  it("accepts an OPTIONAL onSuggestQuestion prop (other call sites have no composer to fill)", () => {
    expect(findingCard).toMatch(/onSuggestQuestion\?:\s*\(text: string\) => void/);
  });

  it("computes suggestions from finding.missingRules via the shared pure generator", () => {
    expect(findingCard).toContain("suggestFollowUpQuestions(finding.missingRules ?? [], finding.instrumentName)");
    expect(askAi).toContain(
      'import { catalogueLabel, suggestFollowUpQuestions, type ReferenceCatalogue } from "@shared/researchPipeline";',
    );
  });

  it("chips render ONLY when a composer is available AND there are suggestions", () => {
    expect(findingCard).toMatch(/\{onSuggestQuestion && suggestedFollowUps\.length > 0 && \(/);
  });

  it("clicking a chip calls onSuggestQuestion with the generated question text — nothing else", () => {
    expect(findingCard).toMatch(/onClick=\{\(\) => onSuggestQuestion\(s\.question\)\}/);
  });

  it("the chip click handler never calls a mutation or sends anything itself", () => {
    const chipsBlockIdx = findingCard.indexOf("suggestedFollowUps.length > 0 && (");
    const chipsBlock = findingCard.slice(chipsBlockIdx, chipsBlockIdx + 700);
    expect(chipsBlock).not.toMatch(/mutateAsync|useMutation|startTask|draft\.mutate|dismiss\.mutate/);
  });

  it("the existing missing-fields badge list is unchanged", () => {
    expect(findingCard).toContain(
      "{missing.length} field{missing.length === 1 ? \"\" : \"s\"} missing for a complete{\" \"}",
    );
    expect(findingCard).toMatch(/\{missing\.map\(\(m\) => \(/);
  });

  it("the existing 'vouch at approval' copy is unchanged", () => {
    expect(findingCard).toContain("You can still draft it and vouch a value at approval.");
  });
});

describe("Stage 5 · Conversation wires suggestion chips to the follow-up composer", () => {
  it("onSuggestQuestion populates the question textarea and switches sourceMode to reuse_previous", () => {
    const idx = conversation.indexOf("function onSuggestQuestion(text: string) {");
    expect(idx).toBeGreaterThan(-1);
    const fn = conversation.slice(idx, idx + 300);
    expect(fn).toContain("setQuestion(text);");
    expect(fn).toContain('setSourceMode("reuse_previous");');
  });

  it("onSuggestQuestion never calls Send / startTask / mutateAsync — it only fills the composer", () => {
    const idx = conversation.indexOf("function onSuggestQuestion(text: string) {");
    const fn = conversation.slice(idx, idx + 300);
    expect(fn).not.toMatch(/mutateAsync|submitFollowUp\(\)|startTask/);
  });

  it("only the LIVE findings map passes onSuggestQuestion — superseded findings do not get suggestion chips", () => {
    const liveIdx = conversation.indexOf("liveFindings.map((f) =>");
    const liveSlice = conversation.slice(liveIdx, liveIdx + 150);
    expect(liveSlice).toContain("onSuggestQuestion={onSuggestQuestion}");

    const supersededIdx = conversation.indexOf("supersededFindings.map((f) =>");
    const supersededSlice = conversation.slice(supersededIdx, supersededIdx + 150);
    expect(supersededSlice).not.toContain("onSuggestQuestion");
  });
});

describe("Stage 5 · client Finding type carries missingRules (already on the wire; typed here only)", () => {
  it("Finding.missingRules is typed as {key,label}[] | null", () => {
    const idx = askAi.indexOf("export type Finding = {");
    const block = askAi.slice(idx, askAi.indexOf("};", idx));
    expect(block).toContain("missingRules: { key: string; label: string }[] | null;");
  });
});

describe("Stage 5 · unrelated FindingCard call sites are untouched", () => {
  it("CatalogueSourceReview's FindingCard usage does not pass onSuggestQuestion (no chips there)", () => {
    const idx = catalogueSourceReview.indexOf("<FindingCard");
    const call = catalogueSourceReview.slice(idx, catalogueSourceReview.indexOf("/>", idx));
    expect(call).not.toContain("onSuggestQuestion");
  });
});

describe("Stage 5 · no guardrails were violated in the wiring", () => {
  it("no auto-send: submitFollowUp is never invoked from the chip or onSuggestQuestion path", () => {
    expect(findingCard).not.toContain("submitFollowUp");
  });

  it("no LLM call in the question generator itself (checked at the shared module, not here) — AskAI.tsx never imports an LLM client for this feature", () => {
    expect(findingCard).not.toMatch(/invokeLLM|openai/i);
  });
});
