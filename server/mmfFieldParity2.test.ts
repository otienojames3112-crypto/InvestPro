/**
 * Stage 10a-2 — fix remaining MMF field parity issues found in live
 * verification of Stage 10a.
 *
 * Reproduces the exact live-screenshot bugs and proves each is fixed:
 *
 *   1. WHT/Withdrawal period appeared in the top figures summary (fmtFigures,
 *      which reads the raw figures bag directly) but showed "Missing" in the
 *      "Catalogue fields" block (projectFindingToContractDisplayRows, via
 *      readAliasValue). Root cause: readAliasValue only ever checked a
 *      field's `aliases` array, never its own canonical `key` — and the mmf
 *      contract's `wht` field has `aliases: ["whtRate"]` (no "wht") and
 *      `withdrawalPeriod` has `aliases: ["withdrawalNoticePeriod"]` (no
 *      "withdrawalPeriod") — so a value saved under the canonical key
 *      (exactly what EditCatalogueFieldsDialog/updatePendingFields both
 *      write) could never be found again. Fixed by checking `field.key`
 *      first, matching the already-correct convention `readContractFieldValue`
 *      (client/src/lib/format.ts) already used.
 *   2. Source-as-of rendered as a raw epoch number (e.g. "1784073600000")
 *      inside the "Catalogue fields" block. Root cause: readAliasValue is a
 *      generic opaque-string reader with no concept of "this field is a
 *      date" — the raw epoch-ms string survived verbatim into the row's
 *      value. Fixed by a new `displayContractRowValue` (client/src/lib/
 *      format.ts) that formats the sourceAsOf row via formatUtcYmd (NOT
 *      formatLocalYmd — see that function's own doc comment for why: this
 *      pipeline's asOf/sourceAsOf values are UTC-anchored via Date.parse of
 *      a date-only string, and formatLocalYmd's local getters would drift a
 *      day backward for viewers behind UTC) at every render site.
 *   3. Source link could show this app's own URL instead of the pasted
 *      source's label. Fixed by a new `looksLikeOwnAppUrl` guard
 *      (client/src/lib/format.ts), applied both when seeding the edit
 *      dialog's Source link input and when displaying the sourceLink row —
 *      falls back to "Pasted source text" (the same fallback label
 *      server/aiResearchService.ts already uses for an unsourced pasted-text
 *      finding).
 *
 * Also redesigns the MMF Reference Catalogue table (client/src/pages/
 * MmfFunds.tsx) to group EAR/Gross/Net yield into one "Yield" cell and
 * Management fee/WHT into one "Cost & tax" cell, so the established
 * quick-decision fields are visible in the main table without adding two
 * more full-width columns.
 *
 * Three layers of test (established convention — no jsdom in this repo):
 *   A. Pure/behavioural — projectFindingToContractDisplayRows,
 *      looksLikeOwnAppUrl, displayContractRowValue — no DB, no React.
 *   B. Static source-text scan — ResearchDesk.tsx / MmfFunds.tsx wiring.
 *   C. Full edit → save → re-render path via the real tRPC caller — requires
 *      DATABASE_URL, `describe.skipIf`'d out otherwise (same established
 *      pattern as mmfFieldParity.test.ts / mmfBankPromotionAsOfDate.test.ts).
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCatalogueFieldContract, projectFindingToContractDisplayRows } from "../shared/catalogueFieldContracts";
import { looksLikeOwnAppUrl, displayContractRowValue, formatUtcYmd } from "../client/src/lib/format";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const hasDb = Boolean(process.env.DATABASE_URL);

type AuthedUser = NonNullable<TrpcContext["user"]>;
function ctxFor(role: "admin" | "user"): TrpcContext {
  const user: AuthedUser = {
    id: role === "admin" ? 1 : 2,
    openId: `sample-${role}`,
    email: `${role}@example.com`,
    name: role === "admin" ? "Admin Person" : "Plain User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

const mmfContract = getCatalogueFieldContract("mmf")!;

// ── A. Pure/behavioural — no DB, no React ───────────────────────────────────

describe("Stage 10a-2 · A — WHT/Withdrawal period saved under their canonical key are no longer 'Missing'", () => {
  it("1. WHT saved as '15%' (the edit modal's own key/value shape) shows up in the full field block", () => {
    const rows = projectFindingToContractDisplayRows(mmfContract, {
      instrumentName: "Test MMF Fund (Stage 9f-1 QA)",
      issuer: "Test Asset Managers Kenya Ltd",
      extractedFields: { wht: "15%" },
    });
    const whtRow = rows.find((r) => r.key === "wht")!;
    expect(whtRow.value).toBe("15%");
    expect(whtRow.value).not.toBeNull();
  });

  it("2. Withdrawal period saved as '3 months' shows up in the full field block", () => {
    const rows = projectFindingToContractDisplayRows(mmfContract, {
      instrumentName: "Test MMF Fund (Stage 9f-1 QA)",
      issuer: "Test Asset Managers Kenya Ltd",
      extractedFields: { withdrawalPeriod: "3 months" },
    });
    const row = rows.find((r) => r.key === "withdrawalPeriod")!;
    expect(row.value).toBe("3 months");
    expect(row.value).not.toBeNull();
  });

  it("regression: values saved under the OLD alias key still work too (e.g. an AI extraction that used whtRate/withdrawalNoticePeriod)", () => {
    const rows = projectFindingToContractDisplayRows(mmfContract, {
      instrumentName: "Example",
      extractedFields: { whtRate: "15%", withdrawalNoticePeriod: "24 hours" },
    });
    expect(rows.find((r) => r.key === "wht")!.value).toBe("15%");
    expect(rows.find((r) => r.key === "withdrawalPeriod")!.value).toBe("24 hours");
  });

  it("regression: a field genuinely absent under both key and aliases still correctly shows null (never fabricated)", () => {
    const rows = projectFindingToContractDisplayRows(mmfContract, {
      instrumentName: "Example",
      extractedFields: {},
    });
    expect(rows.find((r) => r.key === "wht")!.value).toBeNull();
    expect(rows.find((r) => r.key === "withdrawalPeriod")!.value).toBeNull();
  });

  it("canonical key wins when both the key and an alias are present (key-first, not alias-first)", () => {
    const rows = projectFindingToContractDisplayRows(mmfContract, {
      instrumentName: "Example",
      extractedFields: { wht: "15%", whtRate: "20%" },
    });
    expect(rows.find((r) => r.key === "wht")!.value).toBe("15%");
  });

  it("regression guard: SACCO's productType (aliases: [], the ONE field this fix must NOT start resolving) still always returns null, even when raw data happens to carry that exact key — an empty aliases array is a deliberate 'no reliable source exists' marker, not an oversight", () => {
    const saccoContract = getCatalogueFieldContract("market_asset", "sacco")!;
    const productTypeField = saccoContract.fields.find((f) => f.key === "productType")!;
    expect(productTypeField.aliases).toEqual([]);
    const rows = projectFindingToContractDisplayRows(saccoContract, {
      instrumentName: "Example SACCO",
      extractedFields: { productType: "Ordinary savings" },
    });
    expect(rows.find((r) => r.key === "productType")!.value).toBeNull();
  });
});

describe("Stage 10a-2 · A — looksLikeOwnAppUrl", () => {
  it("5. detects this app's own origin as not a real source", () => {
    expect(looksLikeOwnAppUrl("https://kes5m-tracker.onrender.com/research?desk=queue", "https://kes5m-tracker.onrender.com")).toBe(true);
  });

  it("detects a bare app-relative path even without a known origin", () => {
    expect(looksLikeOwnAppUrl("/research?desk=queue")).toBe(true);
    expect(looksLikeOwnAppUrl("/explore/some-ref")).toBe(true);
  });

  it("a genuine external source URL is never flagged", () => {
    expect(looksLikeOwnAppUrl("https://www.sanlamallianz.co.ke/mmf-factsheet.pdf", "https://kes5m-tracker.onrender.com")).toBe(false);
  });

  it("a plain pasted-text label is never flagged", () => {
    expect(looksLikeOwnAppUrl("Manually entered for Stage 9f-1 QA testing — not a live published source.")).toBe(false);
  });

  it("null/undefined/empty are never flagged", () => {
    expect(looksLikeOwnAppUrl(null)).toBe(false);
    expect(looksLikeOwnAppUrl(undefined)).toBe(false);
    expect(looksLikeOwnAppUrl("")).toBe(false);
  });
});

describe("Stage 10a-2 · A — displayContractRowValue", () => {
  it("7. sourceAsOf renders as a human date, never a raw epoch number", () => {
    const out = displayContractRowValue({ key: "sourceAsOf", value: "1784073600000" });
    expect(out).not.toBe("1784073600000");
    expect(out).toBe(formatUtcYmd(1784073600000));
  });

  it("8. 17 July 2026's epoch-ms value displays as 2026-07-17, not shifted", () => {
    const asOf = Date.UTC(2026, 6, 17);
    const out = displayContractRowValue({ key: "sourceAsOf", value: String(asOf) });
    expect(out).toBe("2026-07-17");
  });

  it("6. sourceLink resolving to this app's own URL falls back to 'Pasted source text'", () => {
    const out = displayContractRowValue({ key: "sourceLink", value: "/research?desk=queue" });
    expect(out).toBe("Pasted source text");
  });

  it("a real sourceLink value (label or URL) passes through unchanged", () => {
    expect(displayContractRowValue({ key: "sourceLink", value: "Sanlam Allianz factsheet" })).toBe(
      "Sanlam Allianz factsheet",
    );
  });

  it("a non-date, non-source field passes through unchanged", () => {
    expect(displayContractRowValue({ key: "ear", value: "12.5" })).toBe("12.5");
  });

  it("null stays null (never fabricates a value for a missing field)", () => {
    expect(displayContractRowValue({ key: "wht", value: null })).toBeNull();
  });
});

// ── B. Static source-text scan — ResearchDesk.tsx / MmfFunds.tsx ───────────

const researchDeskPage = read("client/src/pages/ResearchDesk.tsx");
const mmfFundsPage = read("client/src/pages/MmfFunds.tsx");
const formatPage = read("client/src/lib/format.ts");

describe("Stage 10a-2 · B — ResearchDesk.tsx renders every contract row through displayContractRowValue", () => {
  it("3/4/11. both the pending-card block and the approval-modal block use displayContractRowValue, never raw row.value", () => {
    expect(researchDeskPage).toContain("displayContractRowValue(row)");
    // Neither remaining block interpolates the raw row.value directly as text.
    expect(researchDeskPage).not.toContain("<span className=\"font-medium\">{row.value}</span>");
  });

  it("imports the new format.ts helpers rather than re-implementing them locally", () => {
    expect(researchDeskPage).toContain('import { looksLikeOwnAppUrl, displayContractRowValue } from "@/lib/format";');
  });

  it("the edit dialog's Source link seed also guards against this app's own URL", () => {
    const idx = researchDeskPage.indexOf("function EditCatalogueFieldsDialog(");
    const nextIdx = researchDeskPage.indexOf("/* ── Pending update review queue");
    const block = researchDeskPage.slice(idx, nextIdx);
    expect(block).toContain("looksLikeOwnAppUrl(row.value, origin)");
    expect(block).toContain('"Pasted source text"');
  });
});

describe("Stage 10a-2 · B — client/src/lib/format.ts owns the two new pure helpers", () => {
  it("looksLikeOwnAppUrl and displayContractRowValue are exported from format.ts, not duplicated in ResearchDesk.tsx", () => {
    expect(formatPage).toContain("export function looksLikeOwnAppUrl(");
    expect(formatPage).toContain("export function displayContractRowValue(");
    expect(researchDeskPage).not.toContain("function looksLikeOwnAppUrl(");
    expect(researchDeskPage).not.toContain("function displayContractRowValue(");
  });
});

describe("Stage 10a-2 · B — MMF Reference Catalogue table redesign", () => {
  it("9. the main table groups EAR/Gross/Net yield into one Yield cell and Fee/WHT into one Cost & tax cell", () => {
    expect(mmfFundsPage).toContain("Yield (EAR/Gross/Net)");
    expect(mmfFundsPage).toContain("Cost &amp; tax (Fee/WHT)");
    expect(mmfFundsPage).toContain("Gross {fund.grossYield.toFixed(2)}% · Net {netYield.toFixed(2)}%");
    expect(mmfFundsPage).toContain("WHT {whtRate.toFixed(2)}%");
  });

  it("Net yield is computed the same way the detail drawer already computes it (EAR net of WHT)", () => {
    expect(mmfFundsPage).toContain("const netYield = fund.ear * (1 - whtRate / 100);");
  });

  it("Minimum investment, AUM, and Source & freshness remain their own visible columns", () => {
    expect(mmfFundsPage).toContain("Min (KES)");
    expect(mmfFundsPage).toContain("AUM (M)");
    expect(mmfFundsPage).toContain("Source &amp; freshness");
  });

  it("10. the detail drawer still shows the full established field set (unaffected by the table redesign)", () => {
    expect(mmfFundsPage).toContain("function MmfDetailDrawer(");
    const idx = mmfFundsPage.indexOf("function MmfDetailDrawer(");
    const nextIdx = mmfFundsPage.indexOf("export default function MmfFunds(");
    const block = mmfFundsPage.slice(idx, nextIdx);
    expect(block).toContain('fieldByKey("netYield")');
    expect(block).toContain('fieldByKey("wht")');
    expect(block).toContain('fieldByKey("withdrawalPeriod")');
    expect(block).toContain('fieldByKey("riskProfile")');
  });

  it("11. no raw camelCase keys or epoch-shaped values appear in the redesigned table cells", () => {
    const idx = mmfFundsPage.indexOf("const whtRate = fund.whtRate");
    const nextIdx = mmfFundsPage.indexOf("</tr>", idx);
    const block = mmfFundsPage.slice(idx, nextIdx);
    expect(block).not.toContain("{fund.whtRate}"); // raw, unlabeled — must go through the "WHT " prefix
    expect(block).toContain("WHT {whtRate.toFixed(2)}%");
  });
});

// ── C. Full edit → save → re-render path (requires DATABASE_URL) ───────────

describe.skipIf(!hasDb)("Stage 10a-2 · C — WHT/Withdrawal period survive a real edit → save → re-read round trip (requires DATABASE_URL)", () => {
  const TEST_FUND = `ZZ Stage10a2 MMF ${Date.now()}`;
  let pendingId: number | null = null;

  afterAll(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(schema.mmfFunds).set({ isActive: false }).where(eq(schema.mmfFunds.fundName, TEST_FUND));
  });

  it("saving WHT/Withdrawal period via updatePendingFields makes them readable again via the SAME contract projection the UI renders", async () => {
    const { enqueueResearchUpdate } = await import("./db");
    pendingId = await enqueueResearchUpdate({
      changeKind: "create",
      name: TEST_FUND,
      assetClass: "cash_mmf",
      issuer: "Test Asset Managers Kenya Ltd",
      currency: "KES",
      figures: { ear: "12.50%", grossYield: "14.20%", managementFee: "2.00%", minInvestment: "1000" },
      source: "Manually entered for Stage 10a-2 QA testing — not a live published source.",
      asOf: Date.UTC(2026, 6, 17),
      origin: "manual",
    });
    expect(typeof pendingId).toBe("number");

    const caller = appRouter.createCaller(ctxFor("admin"));
    // Exactly what EditCatalogueFieldsDialog's handleSave sends: canonical
    // contract keys, not the old alias names.
    await caller.researchPipeline.updatePendingFields({
      id: pendingId as number,
      figures: { wht: "15%", withdrawalPeriod: "3 months" },
    });

    const { getResearchUpdate } = await import("./db");
    const updated = await getResearchUpdate(pendingId as number);
    expect(updated).toBeTruthy();

    // The SAME projection ResearchDesk.tsx's pending card and approval modal
    // use to render "Catalogue fields" — proving the UI-visible bug is fixed,
    // not just the raw figures bag.
    const rows = projectFindingToContractDisplayRows(mmfContract, {
      instrumentName: updated!.name,
      issuer: updated!.issuer,
      sourceLabel: updated!.source,
      sourceUrl: updated!.sourceUrl,
      sourceAsOf: updated!.asOf,
      extractedFields: updated!.figures as Record<string, unknown> | null,
    });
    expect(rows.find((r) => r.key === "wht")!.value).toBe("15%");
    expect(rows.find((r) => r.key === "withdrawalPeriod")!.value).toBe("3 months");

    // Source-as-of renders as a clean date via displayContractRowValue, not
    // the raw epoch this test's asOf produces.
    const sourceAsOfRow = rows.find((r) => r.key === "sourceAsOf")!;
    expect(displayContractRowValue(sourceAsOfRow)).toBe("2026-07-17");
  });
});
