/**
 * Part 7.2 — runner integration test.
 *
 * Drives the whole pipeline (parse -> provenance map -> upsert) against fixtures
 * with NO network, by passing `rawOverride` to `runAdapter` and stubbing the DB
 * write (`ingestScrapedInstrument`). Confirms the runner:
 *   - stamps `fetchedAt` onto every figure's provenance;
 *   - submits each parsed instrument as scraped_unverified;
 *   - surfaces a failed run (a throwing adapter) as `{ ok: false, error }`
 *     instead of crashing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Stub the DB layer so the runner never touches a real database. `vi.hoisted`
// ensures the spy is constructed before `vi.mock`'s factory runs.
const { ingestSpy } = vi.hoisted(() => ({
  ingestSpy: vi.fn(async (args: { base?: { ref?: string } }) => ({
    ref: args?.base?.ref ?? "?",
    conflicts: 0,
    changed: true,
  })),
}));
vi.mock("../db", () => ({ ingestScrapedInstrument: ingestSpy }));

import { runAdapter } from "./runner";
import { nseAdapter } from "./adapters";
import type { SourceAdapter } from "../../shared/ingestion";

const FETCHED_AT = Date.parse("2026-06-29T18:00:00Z");
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");

beforeEach(() => ingestSpy.mockClear());

describe("runAdapter (fixture-driven, no network)", () => {
  it("parses and upserts every tracked NSE instrument as scraped_unverified", async () => {
    const report = await runAdapter(nseAdapter, fixture("nse_prices.html"), FETCHED_AT);
    expect(report.ok).toBe(true);
    expect(report.instruments).toBe(4);
    expect(ingestSpy).toHaveBeenCalledTimes(4);

    // Every submitted figure carries the runner's fetchedAt and is unverified.
    for (const call of ingestSpy.mock.calls) {
      const { scraped } = call[0] as { scraped: Record<string, { fetchedAt: number; verificationState: string }> };
      for (const fig of Object.values(scraped)) {
        expect(fig.fetchedAt).toBe(FETCHED_AT);
        expect(fig.verificationState).toBe("scraped_unverified");
      }
    }
  });

  it("reports a failed run when the adapter throws (layout drift), without throwing", async () => {
    const report = await runAdapter(nseAdapter, "<html><body>down for maintenance</body></html>", FETCHED_AT);
    expect(report.ok).toBe(false);
    expect(report.error).toMatch(/no price table/i);
    expect(ingestSpy).not.toHaveBeenCalled();
  });

  it("never asks the DB to store a ranking (submitted maps only hold factual keys)", async () => {
    await runAdapter(nseAdapter, fixture("nse_prices.html"), FETCHED_AT);
    const forbidden = ["score", "rating", "rank", "grade", "tier", "performer"];
    for (const call of ingestSpy.mock.calls) {
      const { scraped } = call[0] as { scraped: Record<string, unknown> };
      for (const key of Object.keys(scraped)) {
        expect(forbidden).not.toContain(key);
      }
    }
  });
});

describe("adapter policy wiring", () => {
  it("each adapter declares a distinct payload kind and a source URL", () => {
    const adapters: SourceAdapter[] = [nseAdapter];
    for (const a of adapters) {
      expect(a.sourceUrl).toMatch(/^https?:\/\//);
      expect(["html", "json", "csv"]).toContain(a.payloadKind);
    }
  });
});
