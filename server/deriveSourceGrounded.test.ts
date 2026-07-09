/**
 * Stage 4 remaining scope — sources-used panel. `deriveSourceGrounded` is the pure
 * function `getThread` uses to turn a task's persisted `sourceStatus` JSON into the
 * boolean the client renders as "grounded" / "attached but not read" / "no source".
 * Pure, no DB — importing it alone from ./routers does not touch the database.
 */
import { describe, expect, it } from "vitest";
import { deriveSourceGrounded } from "./routers";

describe("Stage 4 · sources-used panel · deriveSourceGrounded (pure)", () => {
  it("a successful read (ok:true) is grounded", () => {
    expect(deriveSourceGrounded({ ok: true, kind: "url", label: "CBK", url: "https://x", chars: 100, thin: false, warnings: [] })).toBe(
      true,
    );
  });

  it("a failed read (ok:false) is NOT grounded", () => {
    expect(
      deriveSourceGrounded({ ok: false, reason: "url_unreadable", message: "could not fetch", retryHint: "paste text instead" }),
    ).toBe(false);
  });

  it("no sourceStatus at all (no source attached) is null, not false and not true", () => {
    expect(deriveSourceGrounded(null)).toBeNull();
    expect(deriveSourceGrounded(undefined)).toBeNull();
  });

  it("a malformed/unexpected shape is null (never silently treated as grounded)", () => {
    expect(deriveSourceGrounded("not an object")).toBeNull();
    expect(deriveSourceGrounded(42)).toBeNull();
    expect(deriveSourceGrounded({})).toBeNull();
    expect(deriveSourceGrounded({ reason: "x" })).toBeNull(); // no `ok` key at all
  });

  it("ok is coerced to a strict boolean even from a truthy/falsy non-boolean", () => {
    expect(deriveSourceGrounded({ ok: 1 })).toBe(true);
    expect(deriveSourceGrounded({ ok: 0 })).toBe(false);
  });
});
