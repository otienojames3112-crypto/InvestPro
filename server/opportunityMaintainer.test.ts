import { afterAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { NOT_ADMIN_ERR_MSG } from "../shared/const";
import { getOpportunityByRef, getResearchUpdate } from "./db";
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

// Unique ref so the test never collides with seeded rows.
const TEST_REF = `TEST:MAINTAINER-${Date.now()}`;
let queuedUpdateId: number | null = null;

afterAll(async () => {
  // Round 82: addOpportunity no longer writes a live row, so there is nothing to
  // deactivate. The only artefact is a PENDING research_update; leave it pending
  // (it never reached a catalogue) — there is no hard-delete helper by design.
  void queuedUpdateId;
});

describe("Part 7.3 maintainer gating", () => {
  it("rejects addOpportunity for a non-admin user with the permission error", async () => {
    const caller = appRouter.createCaller(ctxFor("user"));
    await expect(
      caller.opportunities.addOpportunity({
        ref: `${TEST_REF}-denied`,
        name: "Should not be created",
        assetClass: "cash_mmf",
        currency: "KES",
        source: "Manual test",
        figures: {},
      }),
    ).rejects.toMatchObject({ message: NOT_ADMIN_ERR_MSG });
    // And nothing was written to the live catalogue.
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

describe("Part 7.3 addOpportunity (admin) — Round 82 governed contract", () => {
  it("ENQUEUES a pending research_update instead of writing a live catalogue row", async () => {
    const caller = appRouter.createCaller(ctxFor("admin"));
    const asOf = Date.UTC(2026, 2, 31);
    const res = await caller.opportunities.addOpportunity({
      ref: TEST_REF,
      name: "Hand-Entered Test Fund",
      assetClass: "cash_mmf",
      issuer: "Test Manager",
      currency: "KES",
      source: "ILAM fact sheet Q1-2026",
      sourceUrl: "https://example.com/ilam.pdf",
      asOf,
      figures: { yieldPct: 9.25, yieldKind: "effective annual yield" },
    });

    // The governed shape: queued, with a pending-update id — NOT a live opportunity.
    expect(res.ref).toBe(TEST_REF);
    expect(res.queued).toBe(true);
    expect(typeof res.pendingUpdateId).toBe("number");
    queuedUpdateId = res.pendingUpdateId;

    // The live catalogue is untouched until a manager approves on the Research Desk.
    expect(await getOpportunityByRef(TEST_REF)).toBeNull();

    // The pending update carries the maintainer's figures + citation + manual origin.
    const pending = await getResearchUpdate(res.pendingUpdateId);
    expect(pending).toBeTruthy();
    expect(pending?.status).toBe("pending");
    expect(pending?.origin).toBe("manual");
    expect(pending?.source).toBe("ILAM fact sheet Q1-2026");
  });

  it("refuses a create for a ref that already exists live (edit it instead)", async () => {
    // Seed a real live row via the low-level helper, then confirm addOpportunity
    // rejects a create against that ref with a CONFLICT.
    const { upsertOpportunity } = await import("./db");
    const liveRef = `${TEST_REF}-LIVE`;
    await upsertOpportunity({
      ref: liveRef,
      name: "Already Live Fund",
      assetClass: "cash_mmf",
      currency: "KES",
      dataSource: "seed",
      dataAsOf: new Date(),
      active: true,
    });
    const caller = appRouter.createCaller(ctxFor("admin"));
    await expect(
      caller.opportunities.addOpportunity({
        ref: liveRef,
        name: "Duplicate",
        assetClass: "cash_mmf",
        currency: "KES",
        source: "Manual test",
        figures: {},
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining("already exists") });
    // Teardown: deactivate the seeded live row.
    await upsertOpportunity({
      ref: liveRef,
      name: "Already Live Fund",
      assetClass: "cash_mmf",
      currency: "KES",
      dataSource: "seed",
      dataAsOf: new Date(),
      active: false,
    });
  });
});
