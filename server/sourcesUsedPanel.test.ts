/**
 * Stage 4 remaining scope — the "sources-used panel" under each assistant answer in
 * Ask AI's Transcript. This repo has no jsdom/testing-library for client components
 * (vitest runs `environment: "node"`); the established convention for asserting
 * AskAI.tsx behaviour (round85, askAiSearchCheckbox, etc.) is a static read of the
 * source file plus targeted string/regex assertions. No DB, no network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const askAi = readFileSync(join(ROOT, "client/src/pages/AskAI.tsx"), "utf8");

const panelIdx = askAi.indexOf("function SourcesUsedPanel(");
const panel = askAi.slice(panelIdx, askAi.indexOf("function Transcript("));
const transcriptIdx = askAi.indexOf("function Transcript(");
const transcript = askAi.slice(transcriptIdx, askAi.indexOf("/* ── The active conversation"));

describe("Stage 4 · SourcesUsedPanel component", () => {
  it("exists as its own function, distinct from the transient SourceStatusPanel", () => {
    expect(panelIdx).toBeGreaterThan(-1);
    expect(askAi).toContain("function SourceStatusPanel(");
    expect(panelIdx).not.toBe(askAi.indexOf("function SourceStatusPanel("));
  });

  it("no source (sourceKind falsy) renders an explicit general-knowledge warning, not silence", () => {
    expect(panel).toMatch(/if \(!sourceKind\)/);
    expect(panel).toContain("No source — general knowledge.");
  });

  it("grounded !== true (failed read OR unknown outcome) renders the not-grounded warning, never the success row", () => {
    expect(panel).toMatch(/if \(grounded !== true\)/);
    expect(panel).toContain("Source attached but not read; answer may be ungrounded.");
    // The not-grounded branch must come before any success-path rendering that shows
    // a label/open-link, so a failed read can never fall through to look grounded.
    const notGroundedIdx = panel.indexOf("if (grounded !== true)");
    const successLabelIdx = panel.indexOf("text-foreground\">{sourceLabel");
    expect(notGroundedIdx).toBeGreaterThan(-1);
    expect(successLabelIdx).toBeGreaterThan(notGroundedIdx);
  });

  it("AI-search provenance is detected from the sourceLabel prefix, not a new source kind", () => {
    expect(panel).toContain('sourceLabel ?? "").startsWith("AI search:")');
    expect(panel).toContain("AI search");
  });

  it("the open link only renders for a URL kind (never for pdf/text/image fileKey/text refs)", () => {
    expect(panel).toMatch(/sourceKind === "url" \? sourceRef : null/);
  });

  it("as-of date renders only when present (asOf != null), omitted cleanly otherwise", () => {
    expect(panel).toMatch(/asOf != null && <span>/);
  });

  it("reuses the shared sourceKindIcon helper, not a third duplicate icon switch", () => {
    expect(panel).toContain("sourceKindIcon(sourceKind");
    // The old Transcript-local duplicate (SOURCE_KIND_ICON) is gone.
    expect(askAi).not.toContain("function SOURCE_KIND_ICON(");
  });
});

describe("Stage 4 · Transcript wires the panel from the paired user turn + task grounding", () => {
  it("Transcript now accepts findings as a prop (needed to borrow a turn's as-of date)", () => {
    expect(transcript).toContain("function Transcript({ messages, findings }: { messages: Message[]; findings: Finding[] })");
  });

  it("looks up the paired user message via pairedUserMessage, not a fresh ad hoc loop", () => {
    expect(transcript).toContain("pairedUserMessage(messages, idx)");
    expect(askAi).toContain("function pairedUserMessage(");
  });

  it("passes the assistant message's own sourceGrounded (not the paired user message's) to the panel", () => {
    expect(transcript).toContain("grounded={m.sourceGrounded}");
  });

  it("derives as-of from a finding sharing the SAME taskId as this assistant message", () => {
    expect(transcript).toMatch(/f\.taskId === m\.taskId/);
  });

  it("the existing user-bubble source badge is unchanged in structure (still gated on m.sourceKind)", () => {
    expect(transcript).toContain("{m.sourceKind && (");
    expect(transcript).toContain("{m.sourceLabel ?? m.sourceKind}");
  });

  it("the existing contextNote narrative line is untouched", () => {
    expect(transcript).toContain("{contextNote(messages, idx) && (");
  });

  it("the call site passes findings through", () => {
    expect(askAi).toContain("<Transcript messages={messages} findings={findings} />");
  });
});

describe("Stage 4 · client types carry what the panel needs, without a schema change", () => {
  it("Message type declares sourceGrounded (server-provided, additive)", () => {
    const msgIdx = askAi.indexOf("type Message = {");
    const msgBlock = askAi.slice(msgIdx, askAi.indexOf("};", msgIdx));
    expect(msgBlock).toContain("sourceGrounded: boolean | null;");
  });

  it("Finding type declares taskId, sourceKind, checkedAt (already in the payload; typed here only)", () => {
    const findIdx = askAi.indexOf("export type Finding = {");
    const findBlock = askAi.slice(findIdx, askAi.indexOf("};", findIdx));
    expect(findBlock).toContain("taskId: number | null;");
    expect(findBlock).toContain('sourceKind: "url" | "text" | "pdf" | "image" | null;');
    expect(findBlock).toContain("checkedAt: number | null;");
  });
});

describe("Stage 4 · existing behaviour is unchanged", () => {
  it("FindingCard's existing per-finding source line is untouched", () => {
    const fcIdx = askAi.indexOf("export function FindingCard(");
    const fc = askAi.slice(fcIdx, askAi.indexOf("export function", fcIdx + 1));
    expect(fc).toContain("Source: <span className=\"text-foreground\">{finding.sourceLabel ?? \"Ask-AI research (unverified)\"}</span>");
    expect(fc).toContain('finding.extractedFields?._unsourced === "true"');
  });

  it("SourceStatusPanel (the live transient submission panel) is untouched", () => {
    const idx = askAi.indexOf("export function SourceStatusPanel(");
    const block = askAi.slice(idx, askAi.indexOf("/* ── Round 96"));
    expect(block).toContain("Source read");
    expect(block).toContain("Couldn&rsquo;t read the source");
  });

  it("no server-affecting keywords appear in the panel (visibility-only, per scope)", () => {
    expect(panel).not.toMatch(/mutateAsync|useMutation|trpc\./);
  });
});
