/**
 * Stage 4, Step 4.1 — authoritative-source routing table (PURE, framework-free).
 *
 * `authoritativeSourcesFor()` is a static, data-only lookup with NO search/fetch/
 * LLM call — this suite locks its routing decisions only. It does not exercise
 * `runResearchQuestion`, source classification, extraction, the approval gate, or
 * promotion, because Step 4.1 changes none of them.
 */
import { describe, expect, it } from "vitest";
import { authoritativeSourcesFor } from "../shared/authoritativeSources";

describe("Stage 4 · Step 4.1 · authoritativeSourcesFor", () => {
  it("1. CBK routes to official CBK / DhowCSD-style sources", () => {
    const route = authoritativeSourcesFor("cbk");
    expect(route).not.toBeNull();
    expect(route!.catalogue).toBe("cbk");
    const labels = route!.sources.map((s) => s.label);
    expect(labels.some((l) => /central bank of kenya/i.test(l))).toBe(true);
    expect(labels.some((l) => /dhowcsd/i.test(l))).toBe(true);
    const domains = route!.sources.flatMap((s) => s.domains);
    expect(domains.some((d) => d.includes("centralbank.go.ke"))).toBe(true);
    // Every registered CBK source is a primary — there's no secondary cross-check
    // source for gov securities in this table.
    expect(route!.sources.every((s) => s.role === "primary")).toBe(true);
  });

  it("CBK routing is unaffected by sub-type (T-bill / FXD / IFB share one route)", () => {
    const base = authoritativeSourcesFor("cbk");
    expect(authoritativeSourcesFor("cbk", "tbill")).toEqual(base);
    expect(authoritativeSourcesFor("cbk", "fxd")).toEqual(base);
    expect(authoritativeSourcesFor("cbk", "ifb")).toEqual(base);
  });

  it("2. MMF routes to fund-manager-factsheet-first, CMA as cross-check", () => {
    const route = authoritativeSourcesFor("mmf");
    expect(route).not.toBeNull();
    const primary = route!.sources.find((s) => s.role === "primary");
    const secondary = route!.sources.find((s) => s.role === "secondary");
    expect(primary?.label).toMatch(/fund manager/i);
    expect(primary?.domains).toEqual([]); // varies per fund manager — no fixed domain
    expect(secondary?.label).toMatch(/CMA|Capital Markets Authority/i);
    expect(secondary?.domains).toContain("cma.or.ke");
  });

  it("3. Bank routes to the official bank source preference", () => {
    const route = authoritativeSourcesFor("bank");
    expect(route).not.toBeNull();
    expect(route!.sources).toHaveLength(1);
    expect(route!.sources[0].role).toBe("primary");
    expect(route!.sources[0].label).toMatch(/bank/i);
    expect(route!.sources[0].domains).toEqual([]); // varies per bank
  });

  it("4. Listed equity and REIT route to NSE first, issuer IR page as secondary", () => {
    const equity = authoritativeSourcesFor("market_asset", "equity");
    const reit = authoritativeSourcesFor("market_asset", "reit");
    for (const route of [equity, reit]) {
      expect(route).not.toBeNull();
      expect(route!.catalogue).toBe("market_asset");
      const primary = route!.sources.find((s) => s.role === "primary");
      const secondary = route!.sources.find((s) => s.role === "secondary");
      expect(primary?.label).toMatch(/nairobi securities exchange|nse/i);
      expect(primary?.domains).toContain("nse.co.ke");
      expect(secondary?.label).toMatch(/issuer/i);
    }
  });

  it("5. Offshore fund routes to the fund manager's factsheet / NAV page", () => {
    const route = authoritativeSourcesFor("market_asset", "offshore_fund");
    expect(route).not.toBeNull();
    expect(route!.sources).toHaveLength(1);
    expect(route!.sources[0].role).toBe("primary");
    expect(route!.sources[0].label).toMatch(/fund manager/i);
    expect(route!.sources[0].label).toMatch(/factsheet|nav/i);
    expect(route!.sources[0].domains).toEqual([]); // varies per fund
  });

  it("6. SACCO routes to the SACCO's own official page, SASRA as regulatory cross-check", () => {
    const route = authoritativeSourcesFor("market_asset", "sacco");
    expect(route).not.toBeNull();
    const primary = route!.sources.find((s) => s.role === "primary");
    const secondary = route!.sources.find((s) => s.role === "secondary");
    expect(primary?.label).toMatch(/sacco/i);
    expect(primary?.domains).toEqual([]); // varies per sacco
    expect(secondary?.label).toMatch(/sasra/i);
    expect(secondary?.domains).toContain("sasra.go.ke");
    expect(secondary?.note).toMatch(/regulatory/i);
  });

  it("7. an unsupported market-asset sub-type (or none) returns a safe null — never a guess", () => {
    expect(authoritativeSourcesFor("market_asset")).toBeNull();
    expect(authoritativeSourcesFor("market_asset", null)).toBeNull();
    expect(authoritativeSourcesFor("market_asset", "pension")).toBeNull();
    expect(authoritativeSourcesFor("market_asset", "etf")).toBeNull();
    expect(authoritativeSourcesFor("market_asset", "unknown_future_type")).toBeNull();
  });

  it("every registered source has a non-empty label and note (no silent placeholders)", () => {
    const routes = [
      authoritativeSourcesFor("cbk"),
      authoritativeSourcesFor("mmf"),
      authoritativeSourcesFor("bank"),
      authoritativeSourcesFor("market_asset", "equity"),
      authoritativeSourcesFor("market_asset", "reit"),
      authoritativeSourcesFor("market_asset", "offshore_fund"),
      authoritativeSourcesFor("market_asset", "sacco"),
    ];
    for (const route of routes) {
      expect(route).not.toBeNull();
      for (const source of route!.sources) {
        expect(source.label.trim()).not.toBe("");
        expect(source.note.trim()).not.toBe("");
        expect(["primary", "secondary"]).toContain(source.role);
      }
    }
  });
});
