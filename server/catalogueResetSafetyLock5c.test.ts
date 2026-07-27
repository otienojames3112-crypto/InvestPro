import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const routers = read("server/routers.ts");
const allApproved = read("client/src/pages/AllApprovedInstruments.tsx");
const researchArea = read("client/src/pages/ResearchArea.tsx");
const catalogueTabs = read("client/src/pages/referenceCatalogueTabs.tsx");

function adminContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "reset-safety-admin",
      email: "admin@example.com",
      name: "Admin Person",
      loginMethod: "manus",
      role: "admin",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function resetProcedure(): string {
  const start = routers.indexOf("resetToSeed: adminProcedure");
  expect(start).toBeGreaterThan(-1);
  const end = routers.indexOf("\n      }),", start);
  expect(end).toBeGreaterThan(start);
  return routers.slice(start, end);
}

function maintenancePanel(): string {
  const start = allApproved.indexOf("function ReferenceDataMaintenance()");
  expect(start).toBeGreaterThan(-1);
  const end = allApproved.indexOf("\nfunction MaintenanceAction(", start);
  expect(end).toBeGreaterThan(start);
  return allApproved.slice(start, end);
}

describe("Stage 10b-5c · backend catalogue reset safety lock", () => {
  it("rejects an actual admin reset call with the fail-closed message", async () => {
    const caller = appRouter.createCaller(adminContext());
    await expect(caller.researchAdmin.resetToSeed({ confirm: true })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Catalogue reset is disabled until sandbox-isolated catalogue reset is implemented.",
    });
  });

  it("keeps the procedure admin-gated but rejects every reset request", () => {
    const reset = resetProcedure();
    expect(reset).toContain("resetToSeed: adminProcedure");
    expect(reset).toContain("throw new TRPCError");
    expect(reset).toContain("Catalogue reset is disabled until sandbox-isolated catalogue reset is implemented.");
  });

  it("cannot call the destructive reset helper while the safety lock is active", () => {
    const reset = resetProcedure();
    expect(reset).not.toContain("resetReferenceCataloguesToSeed");
    expect(routers).not.toMatch(/import[\s\S]*resetReferenceCataloguesToSeed[\s\S]*from "\.\/db"/);
  });
});

describe("Stage 10b-5c · frontend catalogue reset safety lock", () => {
  const maintenance = maintenancePanel();

  it("shows an unavailable status instead of an enabled destructive reset action", () => {
    expect(maintenance).toContain("Reset catalogues to seed");
    expect(maintenance).toContain("Disabled until safe sandbox reset is implemented.");
    expect(maintenance).toContain("Reference catalogues are currently shared across Live and Test.");
    expect(maintenance).toContain('role="status"');
    expect(maintenance).not.toContain("researchAdmin.resetToSeed.useMutation");
    expect(maintenance).not.toContain("resetToSeed.mutate");
    expect(maintenance).not.toContain('actionLabel="Reset to seed"');
  });

  it("no longer claims that the current action resets all four catalogues", () => {
    expect(maintenance).not.toContain("permanently deletes ALL reference rows");
    expect(maintenance).not.toContain("Hard-reset the three reference catalogues");
    expect(maintenance).not.toContain("Switch to Test mode to reset seeded data");
  });

  it("leaves the three existing maintenance actions available and unchanged", () => {
    for (const label of [
      "Archive all reference rows",
      "Clear pending queue",
      "Clear approval log",
    ]) {
      expect(maintenance).toContain(label);
    }
    expect(maintenance).toContain("researchAdmin.archiveAllReferenceRows.useMutation");
    expect(maintenance).toContain("researchAdmin.clearPendingQueue.useMutation");
    expect(maintenance).toContain("researchAdmin.clearApprovalAuditLog.useMutation");
  });
});

describe("Stage 10b-5c · Research and catalogue regressions", () => {
  it("keeps the Research shell and all five Reference Catalogue pages wired", () => {
    expect(researchArea).toContain("Research Desk");
    expect(researchArea).toContain("Reference Catalogues");
    for (const id of [
      "all-approved",
      "mmf-market",
      "bank-catalogue",
      "cbk-securities",
      "market-assets",
    ]) {
      expect(catalogueTabs).toContain(`id: "${id}"`);
    }
  });

  it("does not restore visible Plan Fit UI", () => {
    const visibleResearch = `${allApproved}\n${researchArea}\n${catalogueTabs}`;
    expect(visibleResearch).not.toMatch(/Plan Fit|planFit|showPlanFit|PlanFit/);
  });
});
