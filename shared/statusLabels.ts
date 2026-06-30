/**
 * Phase 8c — one canonical descriptor per verification state.
 *
 * Several surfaces (Explore, the opportunity detail, Holdings, AI Review, Source
 * Conflicts) each used to hand-roll their own colour, icon and wording for the
 * SAME verification states, which let them drift apart. This module is the single
 * source of truth for how an `effectiveState` should LOOK and READ everywhere.
 *
 * It is framework-free: the icon is expressed as a stable string key (`iconKey`)
 * that the client maps to a lucide component, so this file can be imported by both
 * server tests and the browser without pulling in React. Labels are sourced from
 * the existing provenance helpers so we never reword a state in two places.
 */
import { type VerificationState, viewerStateLabel } from "./provenance";

/** Visual tone buckets. The client maps these to its Tailwind token classes. */
export type StatusTone = "positive" | "info" | "caution" | "danger" | "ai";

/** Stable icon identifiers — the client resolves these to lucide-react icons. */
export type StatusIconKey =
  | "shield-check"
  | "user-check"
  | "clock"
  | "info"
  | "bot";

export interface StatusDescriptor {
  state: VerificationState;
  /** End-user-facing label (viewer-neutral), reused from provenance. */
  label: string;
  tone: StatusTone;
  iconKey: StatusIconKey;
  /** One-sentence plain-language meaning, identical across every surface. */
  description: string;
  /**
   * True when this state should read UNMISTAKABLY as provisional with a filled
   * chip (not a thin outline). Only `ai_extracted` qualifies — its provisionality
   * is a stronger caution than mere staleness.
   */
  emphatic: boolean;
}

const DESCRIPTIONS: Record<VerificationState, string> = {
  human_verified:
    "A person checked this figure against its source and confirmed it. It is never overwritten automatically.",
  human_entered:
    "A person typed this figure in directly. It is treated as trusted and never overwritten automatically.",
  scraped_unverified:
    "An automated pull collected this figure from the source. No person has checked it yet.",
  ai_extracted:
    "AI read this figure from a document or image and it has not been confirmed against the source. Treat it as provisional.",
  stale:
    "This figure is older than expected for its instrument type and should be re-checked before relying on it.",
};

const TONES: Record<VerificationState, StatusTone> = {
  human_verified: "positive",
  human_entered: "info",
  scraped_unverified: "caution",
  ai_extracted: "ai",
  stale: "danger",
};

const ICONS: Record<VerificationState, StatusIconKey> = {
  human_verified: "shield-check",
  human_entered: "user-check",
  scraped_unverified: "info",
  ai_extracted: "bot",
  stale: "clock",
};

/**
 * The canonical descriptor for a verification state. Identical input always yields
 * an identical descriptor, so every surface renders the same badge.
 */
export function statusDescriptor(state: VerificationState): StatusDescriptor {
  return {
    state,
    label: viewerStateLabel(state),
    tone: TONES[state],
    iconKey: ICONS[state],
    description: DESCRIPTIONS[state],
    emphatic: state === "ai_extracted",
  };
}
