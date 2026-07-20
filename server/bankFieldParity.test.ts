/**
 * Stage 10b-1 — Bank Product Catalogue field parity.
 *
 * Applies the same product philosophy the MMF path went through (Stage 10a/
 * 10a-2/10a-3/10a-5) to Bank products: established catalogue fields as
 * explicit table columns, a clean contract-labeled drawer (no raw
 * Object.entries dump), a multi-field edit path before approval, and a
 * closed promotion gap so extendedFields-tier fields actually survive
 * approval.
 *
 * Two real gaps this slice closes:
 *   1. Bank's promotion write (server/db.ts) never merged the
 *      extendedFields-only tier of the bank contract (productName,
 *      earlyWithdrawalRule) into the promoted row's `extendedFields` — CBK/
 *      market_asset got this fix in Slice 8g-2, Bank never did. Fixed the
 *      same way: `projectContractFiguresToExtendedFields("bank", undefined,
 *      figuresIn)`, merged before the (always-wins) source envelope.
 *   2. `EditCatalogueFieldsDialog` (ResearchDesk.tsx) was hard-gated to
 *      catalogue === "mmf" only. Generalized to also support "bank" — with
 *      its own per-catalogue envelope-key routing table, since Bank's
 *      "bankName" field routes to the update's `issuer` column (mirrors
 *      buildContractRawValueBag's own `bankName: finding.issuer` mapping),
 *      not `name` like MMF's "fundName" does — a naive shared mapping would
 *      have silently mis-routed one of the two.
 *
 * The review queue and approval modal already showed Bank's full contract
 * field block generically (Stage 10a's `resolveContractCatalogueForUpdate`/
 * `getCatalogueFieldContract(data.catalogue)` never special-cased MMF) — no
 * code change was needed there, only verification.
 *
 * Three layers of test (established convention — no jsdom in this repo):
 *   A. Pure/behavioural — projectContractFiguresToExtendedFields — no DB.
 *   B. Static source-text scan — BankInstruments.tsx / ResearchDesk.tsx wiring.
 *   C. Full edit → approve → published-row path via the real tRPC caller —
 *      requires DATABASE_URL, `describe.skipIf`'d out otherwise (same
 *      established pattern as mmfFieldParity.test.ts).
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getCatalogueFieldContract, projectContractFiguresToExtendedFields } from "../shared/catalogueFieldContracts";
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

const bankContract = getCatalogueFieldContract("bank")!;

// ── A. Pure/behavioural — no DB ─────────────────────────────────────────────

describe("Stage 10b-1 · A — projectContractFiguresToExtendedFields (bank)", () => {
  it("1. productName is extracted for extendedFields promotion", () => {
    const result = projectContractFiguresToExtendedFields("bank", undefined, { productName: "90-Day Fixed Deposit Special" });
    expect(result.productName).toBe("90-Day Fixed Deposit Special");
  });

  it("2. earlyWithdrawalRule is extracted under its canonical key, and via its alias earlyWithdrawalPenalty", () => {
    const viaCanonical = projectContractFiguresToExtendedFields("bank", undefined, {
      earlyWithdrawalRule: "Forfeits all accrued interest if broken before maturity.",
    });
    expect(viaCanonical.earlyWithdrawalRule).toBe("Forfeits all accrued interest if broken before maturity.");
    const viaAlias = projectContractFiguresToExtendedFields("bank", undefined, { earlyWithdrawalPenalty: "10% of accrued interest forfeited." });
    expect(viaAlias.earlyWithdrawalRule).toBe("10% of accrued interest forfeited.");
  });

  it("bankName/sourceLink/sourceAsOf are correctly EXCLUDED — envelope-routed, never duplicated into extendedFields", () => {
    const result = projectContractFiguresToExtendedFields("bank", undefined, {
      bankName: "Example Bank",
      productName: "Example Product",
      source: "Example source",
      asOf: "2026-07-17",
    });
    expect(result.bankName).toBeUndefined();
    expect(result.sourceLink).toBeUndefined();
    expect(result.sourceAsOf).toBeUndefined();
    expect(result.productName).toBe("Example Product");
  });

  it("fields with no storage (fees, accessSpeed) never appear — nothing real to persist", () => {
    const result = projectContractFiguresToExtendedFields("bank", undefined, { fees: "1% arrangement fee", accessSpeed: "instant" });
    expect(result.fees).toBeUndefined();
    expect(result.accessSpeed).toBeUndefined();
  });

  it("an empty/absent figures bag produces an empty object, never a throw", () => {
    expect(() => projectContractFiguresToExtendedFields("bank", undefined, {})).not.toThrow();
    expect(projectContractFiguresToExtendedFields("bank", undefined, {})).toEqual({});
  });
});

// ── B. Static source-text scan — BankInstruments.tsx / ResearchDesk.tsx ────

const bankPage = read("client/src/pages/BankInstruments.tsx");
const researchDeskPage = read("client/src/pages/ResearchDesk.tsx");

describe("Stage 10b-1 · B — Bank Product Catalogue table has explicit columns for every established field", () => {
  it("6. every established Bank field has its own header", () => {
    const headers = [
      ">Bank<",
      "Product name",
      "Product type",
      "Indicative rate",
      "Net return after WHT",
      ">WHT<",
      "Minimum deposit",
      "Tenor / notice",
      "Early withdrawal rule",
      "Fees / charges",
      "Access speed",
      "Negotiable",
      "Source &amp; freshness",
    ];
    for (const header of headers) {
      expect(bankPage).toContain(header);
    }
  });

  it("the table reuses the bank contract for Product name / Early withdrawal rule, not a hand-typed label", () => {
    expect(bankPage).toContain('const BANK_CONTRACT = getCatalogueFieldContract("bank");');
    expect(bankPage).toContain('const bankFieldByKey = (key: string) => BANK_CONTRACT?.fields.find((f) => f.key === key);');
    expect(bankPage).toContain('readContractFieldValue(extendedFields, bankFieldByKey("productName")!)');
    expect(bankPage).toContain('readContractFieldValue(extendedFields, bankFieldByKey("earlyWithdrawalRule")!)');
  });

  it("7. Net return after WHT is computed from indicative rate at 15% WHT", () => {
    expect(bankPage).toContain("const BANK_WHT_RATE = 15;");
    expect(bankPage).toContain("function netReturnAfterWht(indicativeRate: number | null): number | null {");
    expect(bankPage).toContain("return indicativeRate === null ? null : indicativeRate * (1 - BANK_WHT_RATE / 100);");
  });

  it("8. Source label/link/as-of render cleanly via the established resolveCatalogueSource helper (8h)", () => {
    expect(bankPage).toContain("const catSource = resolveCatalogueSource(r.source, extendedFields, r.asOfDate);");
    const idx = bankPage.indexOf("const catSource = resolveCatalogueSource(r.source");
    const nextIdx = bankPage.indexOf("{isManager && (", idx);
    const block = bankPage.slice(idx, nextIdx);
    expect(block).toContain("catSource.url ? (");
    expect(block).toContain("href={catSource.url}");
    expect(block).toContain("No source");
    expect(block).toContain("as of ${asOfLabel(catSource.asOf)}");
  });

  it("9. Fees/charges and Access speed show a clean 'Not available', never a raw key or fabricated value", () => {
    const idx = bankPage.indexOf("filtered.map((r) => {");
    const nextIdx = bankPage.indexOf("{/* Detail drawer */}");
    const block = bankPage.slice(idx, nextIdx);
    const occurrences = block.split("Not available").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe("Stage 10b-1 · B — Bank drawer no longer exposes a raw extendedFields dump", () => {
  it("10. the Object.entries raw-dump block is gone; Product name and Early withdrawal rule are clean DrawerFacts instead", () => {
    expect(bankPage).not.toContain("Object.entries(drawerRow.extendedFields)");
    expect(bankPage).toContain('label={bankFieldByKey("productName")?.label ?? "Product name"}');
    expect(bankPage).toContain('label={bankFieldByKey("earlyWithdrawalRule")?.label ?? "Early withdrawal rule"}');
  });

  it("Net return after WHT and WHT are also shown in the drawer, not only the table", () => {
    expect(bankPage).toContain('label={bankFieldByKey("netReturnAfterWht")?.label ?? "Net return after WHT"}');
    expect(bankPage).toContain('<DrawerFact label="WHT" value={`${BANK_WHT_RATE.toFixed(2)}%`} />');
  });
});

describe("Stage 10b-1 · B — ResearchDesk.tsx: multi-field edit path extended to Bank", () => {
  it("4. EditCatalogueFieldsDialog now supports both mmf and bank, with per-catalogue envelope routing", () => {
    const idx = researchDeskPage.indexOf("function EditCatalogueFieldsDialog(");
    const nextIdx = researchDeskPage.indexOf("/* ── Pending update review queue");
    const block = researchDeskPage.slice(idx, nextIdx);
    expect(block).toContain('const isSupported = catalogue === "mmf" || catalogue === "bank";');
    expect(block).toContain("bankName: \"issuer\",");
    expect(block).toContain("fundName: \"name\",");
  });

  it("the Edit fields entry points (pending card + approval modal) are both gated to mmf OR bank", () => {
    expect(researchDeskPage).toContain('(data?.catalogue === "mmf" || data?.catalogue === "bank")');
    expect(researchDeskPage).toContain('(contract.catalogue === "mmf" || contract.catalogue === "bank")');
  });

  it("3/5. the review-queue card and the approval modal already resolve the full Bank contract field block generically (no MMF-only special case) — verified, not newly added", () => {
    // PendingQueue's contractRows: resolves ANY catalogue via
    // resolveContractCatalogueForUpdate + getCatalogueFieldContract, never
    // special-cased to mmf.
    const idx = researchDeskPage.indexOf("const contract = resolveContractCatalogueForUpdate({");
    const block = researchDeskPage.slice(idx, idx + 1200);
    expect(block).toContain("getCatalogueFieldContract(contract.catalogue)");
    // ApproveDialog's fullContract: only market_asset is excluded (subtype
    // unavailable from impactOf) — bank/cbk/mmf all resolve generically.
    const approveIdx = researchDeskPage.indexOf("const fullContract =");
    const approveBlock = researchDeskPage.slice(approveIdx, approveIdx + 300);
    expect(approveBlock).toContain('data.catalogue === "market_asset"');
    expect(approveBlock).toContain("getCatalogueFieldContract(data.catalogue)");
  });
});

// ── C. Full edit → approve → published-row path (requires DATABASE_URL) ────

describe.skipIf(!hasDb)("Stage 10b-1 · C — Bank promotion + multi-field edit round trip (requires DATABASE_URL)", () => {
  const TEST_BANK = `ZZ Stage10b1 Bank ${Date.now()}`;
  let pendingId: number | null = null;

  afterAll(async () => {
    const { getDb } = await import("./db");
    const db = await getDb();
    if (!db) return;
    const schema = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    await db.update(schema.bankInstruments).set({ isActive: false }).where(eq(schema.bankInstruments.bankName, TEST_BANK));
  });

  it("1/2. approving a Bank update with productName/earlyWithdrawalRule publishes them into bank_instruments.extendedFields", async () => {
    const { enqueueResearchUpdate, getBankInstruments } = await import("./db");
    pendingId = await enqueueResearchUpdate({
      changeKind: "create",
      name: TEST_BANK,
      assetClass: "bank_deposit",
      issuer: TEST_BANK,
      currency: "KES",
      figures: {
        instrumentType: "fixed_deposit",
        minAmount: "50000",
        typicalTenor: "12 months",
        indicativeRate: "13.5",
        isNegotiable: "false",
        productName: "12-Month Fixed Deposit Special",
        earlyWithdrawalRule: "Forfeits all accrued interest if broken before maturity.",
      },
      source: "Stage 10b-1 QA testing — not a live published source.",
      asOf: Date.UTC(2026, 6, 17),
      origin: "manual",
    });
    expect(typeof pendingId).toBe("number");

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.researchPipeline.review({ id: pendingId as number, approve: true });
    expect(res.ok).toBe(true);

    const live = await getBankInstruments();
    const published = live.find((b) => b.bankName === TEST_BANK);
    expect(published).toBeTruthy();
    const ext = published?.extendedFields as Record<string, unknown> | null;
    expect(ext?.productName).toBe("12-Month Fixed Deposit Special");
    expect(ext?.earlyWithdrawalRule).toBe("Forfeits all accrued interest if broken before maturity.");
    // Source enrichment still wins for source label/as-of.
    expect(ext?.sourceLabel).toBe("Stage 10b-1 QA testing — not a live published source.");
  });

  it("4. multi-field edit via updatePendingFields works for a Bank pending update, same mutation MMF uses", async () => {
    const { enqueueResearchUpdate } = await import("./db");
    const secondPendingId = await enqueueResearchUpdate({
      changeKind: "create",
      name: `${TEST_BANK} 2`,
      assetClass: "bank_deposit",
      issuer: `${TEST_BANK} 2`,
      currency: "KES",
      figures: { instrumentType: "call_deposit", minAmount: "20000", indicativeRate: "8.0", isNegotiable: "true" },
      source: "Stage 10b-1 QA testing — not a live published source.",
      asOf: Date.UTC(2026, 6, 17),
      origin: "manual",
    });
    expect(typeof secondPendingId).toBe("number");

    const caller = appRouter.createCaller(ctxFor("admin"));
    const res = await caller.researchPipeline.updatePendingFields({
      id: secondPendingId as number,
      figures: { productName: "Instant Access Call Account", earlyWithdrawalRule: "None — fully liquid." },
    });
    expect(res.update.status).toBe("pending");
    const figures = res.update.figures as Record<string, unknown>;
    expect(figures.productName).toBe("Instant Access Call Account");
    expect(figures.earlyWithdrawalRule).toBe("None — fully liquid.");
    // Original figures survive the merge, untouched.
    expect(figures.indicativeRate).toBe("8.0");

    const { getDb } = await import("./db");
    const db = await getDb();
    if (db) {
      const schema = await import("../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      await db.update(schema.researchUpdates).set({ status: "rejected" }).where(eq(schema.researchUpdates.id, secondPendingId as number));
    }
  });
});
