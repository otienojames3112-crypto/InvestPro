import { describe, it, expect } from "vitest";
import { reconcileGov, reconcileBank } from "@shared/reconciliation";

/**
 * Round 39 — government-security and bank-instrument reconciliation sub-checks.
 *
 * These parallel the existing reconcileMmf: each independently verifies that an
 * asset class's principal (as the Dashboard/Portfolio Review value it) ties out
 * to the deposits that created it. The red-test proves a drifted gov value
 * flips the gov row to NOT ok, so the Reconciliation page surfaces the cause.
 */

describe("reconcileGov — register vs linked gov deposits", () => {
  it("passes when the register face total equals the linked gov deposit total", () => {
    const r = reconcileGov([500000, 250000], [500000, 250000]);
    expect(r.registerFaceTotal).toBe(750000);
    expect(r.linkedDepositTotal).toBe(750000);
    expect(r.diff).toBe(0);
    expect(r.ok).toBe(true);
  });

  it("tolerates sub-KES5 rounding noise", () => {
    const r = reconcileGov([500000.002], [500000]);
    expect(r.ok).toBe(true);
  });

  it("RED TEST: a broken gov register value turns the gov row red", () => {
    // The register says 600k but only 500k of gov deposits back it — drift.
    const r = reconcileGov([600000], [500000]);
    expect(r.diff).toBe(100000);
    expect(r.ok).toBe(false);
  });
});

describe("reconcileBank — holdings vs net bank deposits", () => {
  it("passes when holding principals equal deposits minus withdrawals", () => {
    const r = reconcileBank([100000], [120000], [20000]);
    expect(r.holdingPrincipalTotal).toBe(100000);
    expect(r.netDepositTotal).toBe(100000);
    expect(r.ok).toBe(true);
  });

  it("RED TEST: a drifted bank holding turns the bank row red", () => {
    const r = reconcileBank([100000], [50000], [0]);
    expect(r.diff).toBe(50000);
    expect(r.ok).toBe(false);
  });
});
