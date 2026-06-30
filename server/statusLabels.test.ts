import { describe, it, expect } from "vitest";
import { statusDescriptor, type StatusTone } from "@shared/statusLabels";
import { VERIFICATION_STATES, viewerStateLabel, type VerificationState } from "@shared/provenance";

describe("statusDescriptor — one canonical descriptor per state", () => {
  it("covers every verification state", () => {
    for (const s of VERIFICATION_STATES) {
      const d = statusDescriptor(s);
      expect(d.state).toBe(s);
      expect(d.label.length).toBeGreaterThan(0);
      expect(d.description.length).toBeGreaterThan(0);
    }
  });

  it("reuses the provenance viewer label verbatim (single source of truth)", () => {
    for (const s of VERIFICATION_STATES) {
      expect(statusDescriptor(s).label).toBe(viewerStateLabel(s));
    }
  });

  it("only ai_extracted is emphatic (filled chip)", () => {
    for (const s of VERIFICATION_STATES) {
      expect(statusDescriptor(s).emphatic).toBe(s === "ai_extracted");
    }
  });

  it("maps each state to its expected tone", () => {
    const expected: Record<VerificationState, StatusTone> = {
      human_verified: "positive",
      human_entered: "info",
      scraped_unverified: "caution",
      ai_extracted: "ai",
      stale: "danger",
    };
    for (const s of VERIFICATION_STATES) {
      expect(statusDescriptor(s).tone).toBe(expected[s]);
    }
  });

  it("is deterministic", () => {
    expect(statusDescriptor("stale")).toEqual(statusDescriptor("stale"));
  });
});
