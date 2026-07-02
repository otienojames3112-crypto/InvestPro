import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression: InfoHint is placed inside other interactive elements (sortable
 * table headers, row action buttons). If its tooltip trigger is a native
 * <button>, React throws "<button> cannot contain a nested <button>" and the
 * page logs a hydration/validation error.
 *
 * The trigger must therefore be a focusable non-button element
 * (span role="button" tabIndex=0) so it is valid inside any container.
 */
describe("InfoHint trigger is not a nested button", () => {
  const src = readFileSync(
    join(__dirname, "..", "client", "src", "components", "InfoHint.tsx"),
    "utf8",
  );

  it("does not render a native <button> as the tooltip trigger", () => {
    // The TooltipTrigger child must not be a <button ...> element.
    expect(src).not.toMatch(/<button[\s\r\n]/);
  });

  it("uses a focusable span with role=button and tabIndex for accessibility", () => {
    expect(src).toMatch(/<span/);
    expect(src).toMatch(/role="button"/);
    expect(src).toMatch(/tabIndex=\{0\}/);
  });

  it("keeps an accessible label on the trigger", () => {
    expect(src).toMatch(/aria-label=/);
  });
});
