/**
 * Round 94 — retire the old "screener / score" vocabulary from the
 * All Approved Instruments surface and the Research → Reference Catalogues hint.
 *
 * Static-source guards (no DB) that lock in the requested wording so it cannot
 * silently regress:
 *
 *   1. The Research area "reference-catalogues" hint no longer calls the surface
 *      a "screener" and instead reads "approved reference universe across every
 *      approved catalogue row".
 *   2. The All Approved Instruments intro is the exact approved sentence and no
 *      longer uses "screener" language in visible copy.
 *   3. No user-facing copy (JSX text or hint/label string literals) in these
 *      files uses "screener" or a standalone "Score"/"scored" label. Internal
 *      variable access like `fit.score` and sort keys are allowed.
 *   4. Plan Fit is never presented as a recommendation.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const allApproved = read("client/src/pages/AllApprovedInstruments.tsx");
const research = read("client/src/pages/ResearchArea.tsx");
const catalogueTabs = read("client/src/pages/referenceCatalogueTabs.tsx");

/**
 * Strip block/line comments so wording assertions only look at real code +
 * visible copy, not the explanatory doc-comments that legitimately discuss the
 * old vocabulary while describing the migration.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("Round 94 — Plan Fit wording on the approved reference universe", () => {
  it("ResearchArea reference-catalogues hint uses the approved reference universe phrasing", () => {
    expect(research).toContain(
      "approved reference universe across every approved catalogue row",
    );
    // The old screener phrasing must be gone from the hint.
    expect(research).not.toContain("read-only screener across every approved row");
  });

  it("All Approved Instruments shows the exact approved intro sentence", () => {
    // The JSX wraps this sentence across lines; collapse whitespace before matching.
    const collapsed = allApproved.replace(/\s+/g, " ");
    expect(collapsed).toContain(
      "All instruments shown here have been approved into one of the reference catalogues. Reference data does not affect portfolio math until a holding is recorded.",
    );
  });

  it("no user-facing copy in the approved-universe surface says 'screener'", () => {
    for (const src of [allApproved, research, catalogueTabs]) {
      const code = stripComments(src);
      expect(code.toLowerCase()).not.toContain("screener");
    }
  });

  it("no visible 'Score' or 'scored' label survives (internal fit.score access is allowed)", () => {
    const code = stripComments(allApproved);
    // Any remaining "score" token must be a property access on an object
    // (e.g. fit.score / .score) — never a standalone user-facing label.
    const badScore = /(?<![.\w])[Ss]core(?!\s*[:.]|\w)/g;
    const matches = code.match(badScore) ?? [];
    // Filter out legitimate property reads like `.score` (handled by lookbehind)
    // and the sort-key/identifier usages which include a following word char.
    expect(matches).toEqual([]);
    // "scored" as a user-facing verb must not appear in visible copy.
    expect(code).not.toMatch(/\bscored\b/);
  });

  it("labels the Plan Fit column and its tooltip, and never calls it a recommendation", () => {
    // The column + tooltip use Plan Fit language.
    expect(allApproved).toContain("Plan Fit");
    expect(allApproved).toContain("Plan Fit diagnostic");
    // Plan Fit is explicitly framed as NOT a recommendation.
    expect(allApproved).toMatch(/not a recommendation/);
    // The referenceCatalogueTabs sub-hint uses "Plan Fit diagnostics".
    expect(catalogueTabs).toContain("Plan Fit diagnostics");
  });
});
