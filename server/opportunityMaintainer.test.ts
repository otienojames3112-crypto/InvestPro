import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { NOT_ADMIN_ERR_MSG } from "../shared/const";
import { getOpportunityByRef, upsertOpportunity } from "./db";
import { isHumanChecked } from "../shared/provenance";
import type { TrpcContext } from "./_core/context";

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

// Unique ref so the test never collides with seeded rows; cleaned up after.
const TEST_REF = `TEST:MAINTAINER-${Date.now()}`;

afterAll(async () => {
  // Best-effort teardown: deactivate the hand-added row so it doesn't linger in
  // the live catalog. (There is no hard-delete helper by design.)
  const row = await getOpportunityByRef(TEST_REF);
  if (row) {
    await upsertOpportunity({
      ref: TEST_REF,
      name: row.name,
      assetClass: row.assetClass,
      currency: row.currency,
      dataSource: row.dataSource,
      dataAsOf: row.dataAsOf,
      active: false,
    });
  }
});

describe("Part 7.3 maintainer gating", () => {
  it("rejects addOpportunity for a non-admin user with the permission error", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    await expect(
      caller.opportunities.addOpportunity({
        ref: `${TEST_REF}-denied`,
        name: "Should not be created",
        assetClass: "money_market_fund",
        currency: "KES",
        source: "Manual test",
        figures: {},
      }),
    ).rejects.toMatchObject({ message: NOT_ADMIN_ERR_MSG });
    // And nothing was written.
    expect(await getOpportunityByRef(`${TEST_REF}-denied`)).toBeNull();
  });

  it("rejects verifyField for a non-admin user", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    await expect(
      caller.opportunities.verifyField({
        ref: "anything",
        fieldKey: "yield",
        action: { kind: "confirm" },
      }),
    ).rejects.toMatchObject({ message: NOT_ADMIN_ERR_MSG });
  });

  it("lets a non-admin still READ the public open-conflict count", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    const res = await caller.opportunities.openConflictCount();
    expect(typeof res.count).toBe("number");
  });
});

describe("Part 7.3 addOpportunity (admin)", () => {
  it("creates a hand-authored instrument whose figures are human_entered with citation", async () => {
    const caller = appRouter.createCaller(ctxFor("admin"));
    const asOf = Date.UTC(2026, 2, 31);
    const res = await caller.opportunities.addOpportunity({
      ref: TEST_REF,
      name: "Hand-Entered Test Fund",
      assetClass: "money_market_fund",
      issuer: "Test Manager",
      currency: "KES",
      source: "ILAM fact sheet Q1-2026",
      sourceUrl: "https://example.com/ilam.pdf",
      asOf,
      figures: { yieldPct: 9.25, yieldKind: "effective annual yield" },
    });

    expect(res.ref).toBe(TEST_REF);
    const saved = res.opportunity;
    expect(saved).toBeTruthy();
    expect(saved?.name).toBe("Hand-Entered Test Fund");
    // The decimal column normalises scale ("9.2500"); compare numerically.
    expect(Number(saved?.yieldPct)).toBe(9.25);

    const fp = (saved?.fieldProvenance ?? {}) as Record<string, { value: string | null; verificationState: string; source: string | null; verifiedBy?: string | null }>;
    const y = fp.yield;
    expect(y).toBeTruthy();
    expect(y?.value).toBe("9.25");
    expect(isHumanChecked(y!.verificationState as never)).toBe(true);
    expect(y?.verificationState).toBe("human_entered");
    expect(y?.source).toBe("ILAM fact sheet Q1-2026");
    expect(y?.verifiedBy).toBe("Admin Person");
    // Row-level summary reflects the human attention.
    expect(saved?.verificationState).toBe("human_entered");
  });

  it("refuses a duplicate ref (edit it instead of re-adding)", async () => {
    const caller = appRouter.createCaller(ctxFor("admin"));
    await expect(
      caller.opportunities.addOpportunity({
        ref: TEST_REF,
        name: "Duplicate",
        assetClass: "money_market_fund",
        currency: "KES",
        source: "Manual test",
        figures: {},
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("already exists") });
  });
});
