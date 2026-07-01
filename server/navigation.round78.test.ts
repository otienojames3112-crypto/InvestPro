import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AREA_TABS,
  isValidAreaTab,
  areaTab,
  dashboardHref,
  type AreaName,
} from "@shared/navigation";

/**
 * Round 78 — route/link integrity.
 *
 * Two guarantees are locked here so the Dashboard's "click a card → 404" class
 * of bug can never come back:
 *
 *   1. AREA_TABS (the single source of truth used by dashboardHref) actually
 *      matches the tab ids each area file declares in its `const tabs`.
 *   2. Every internal `/area?tab=id` link written anywhere in client source
 *      points at a tab that really exists in that area.
 *
 * The scan is static (reads the .tsx source), so it needs no DOM/render.
 */

const CLIENT_SRC = join(__dirname, "..", "client", "src");

/** Recursively collect every .ts/.tsx file under client/src. */
function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Extract the tab-id string literals from an area file's `const tabs`. */
function tabIdsFromAreaFile(fileName: string): string[] {
  const src = readFileSync(join(CLIENT_SRC, "pages", fileName), "utf8");
  // Match `id: "xxx"` occurrences (each AreaTab entry declares one).
  const ids: string[] = [];
  const re = /\bid:\s*"([a-z0-9-]+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) ids.push(m[1]);
  return ids;
}

const AREA_FILES: Record<AreaName, string> = {
  plan: "PlanArea.tsx",
  cashflows: "CashflowsArea.tsx",
  holdings: "HoldingsArea.tsx",
  research: "ResearchArea.tsx",
  review: "ReviewArea.tsx",
};

describe("Round 78 — navigation map matches area files", () => {
  for (const area of Object.keys(AREA_FILES) as AreaName[]) {
    it(`AREA_TABS.${area} matches the tab ids declared in ${AREA_FILES[area]}`, () => {
      const declared = tabIdsFromAreaFile(AREA_FILES[area]);
      // Every id the area file declares must be registered in AREA_TABS…
      for (const id of declared) {
        expect(AREA_TABS[area], `"${id}" missing from AREA_TABS.${area}`).toContain(id);
      }
      // …and every id in AREA_TABS must really exist in the area file.
      for (const id of AREA_TABS[area]) {
        expect(declared, `AREA_TABS.${area} lists "${id}" but the file does not`).toContain(id);
      }
    });
  }
});

describe("Round 78 — link-integrity scanner", () => {
  it("no internal /area?tab=id link points at a non-existent tab", () => {
    const files = collectSourceFiles(CLIENT_SRC);
    const linkRe = /\/(plan|cashflows|holdings|research|review)\?tab=([a-z0-9-]+)/g;
    const offenders: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      let m: RegExpExecArray | null;
      while ((m = linkRe.exec(src)) !== null) {
        const area = m[1] as AreaName;
        const tab = m[2];
        if (!isValidAreaTab(area, tab)) {
          offenders.push(`${file.replace(CLIENT_SRC, "client/src")}: /${area}?tab=${tab}`);
        }
      }
    }

    expect(offenders, `Invalid tab links found:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("areaTab throws in dev for an unknown tab, and builds a valid path for a known one", () => {
    expect(() => areaTab("holdings", "nope")).toThrow(/invalid tab/);
    expect(areaTab("holdings", "overview")).toBe("/holdings?tab=overview");
  });
});

describe("Round 78 — dashboardHref destinations are all valid", () => {
  it("every dashboardHref value is either /settings or a valid /area?tab= path", () => {
    const tabLink = /^\/(plan|cashflows|holdings|research|review)\?tab=([a-z0-9-]+)$/;
    for (const [key, href] of Object.entries(dashboardHref)) {
      if (href === "/settings") continue;
      const m = tabLink.exec(href);
      expect(m, `dashboardHref.${key} = "${href}" is not a valid tab link`).not.toBeNull();
      if (m) {
        expect(isValidAreaTab(m[1] as AreaName, m[2])).toBe(true);
      }
    }
  });

  it("Full Net Worth points at the new Holdings Overview tab", () => {
    expect(dashboardHref.fullNetWorth).toBe("/holdings?tab=overview");
  });

  it("rate-related destinations use the canonical /settings redirect (not a stale /setup)", () => {
    expect(dashboardHref.rates).toBe("/settings");
  });
});
