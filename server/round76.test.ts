import { describe, it, expect } from "vitest";
import {
  buildSecurityIncome,
  securityRowStatus,
  type SecurityIncomeInput,
} from "../shared/incomeBreakdown";

// Round 76 — Time Machine consistency polish.
//
// (1) Tense-aware lifecycle status for Daily Accrual security rows, reckoned
//     from the EFFECTIVE "now" (simulated clock when the Time Machine is active).
// (2) buildSecurityIncome now accepts an injected `now` so matured paper drops
//     out of the live breakdown under a simulated clock — parity with the server.

const DAY = 86_400_000;
const ANCHOR = Date.UTC(2026, 0, 15); // 2026-01-15 (UTC midnight)

describe("Round 76 — securityRowStatus (tense-aware Daily Accrual labels)", () => {
  it("reports a future maturity as accruing (present/future tense)", () => {
    const s: Pick<SecurityIncomeInput, "maturityDate" | "isMatured" | "securityType"> = {
      securityType: "tbill_182",
      maturityDate: new Date(ANCHOR + 60 * DAY),
      isMatured: false,
    };
    const info = securityRowStatus(s, ANCHOR);
    expect(info.status).toBe("accruing");
    expect(info.isPast).toBe(false);
    expect(info.label).toBe("Accruing");
  });

  it("reports a past maturity as matured (past tense) — discount paper", () => {
    const s: Pick<SecurityIncomeInput, "maturityDate" | "isMatured" | "securityType"> = {
      securityType: "tbill_91",
      maturityDate: new Date(ANCHOR - 5 * DAY),
      isMatured: false,
    };
    const info = securityRowStatus(s, ANCHOR);
    expect(info.status).toBe("matured");
    expect(info.isPast).toBe(true);
    expect(info.label).toBe("Matured");
  });

  it("uses coupon-aware past-tense wording for matured coupon bonds", () => {
    const fxd = securityRowStatus(
      { securityType: "fxd", maturityDate: new Date(ANCHOR - 1 * DAY), isMatured: false },
      ANCHOR,
    );
    expect(fxd.status).toBe("matured");
    expect(fxd.label).toBe("Matured (coupons paid)");

    const ifb = securityRowStatus(
      { securityType: "ifb", maturityDate: new Date(ANCHOR - 1 * DAY), isMatured: false },
      ANCHOR,
    );
    expect(ifb.label).toBe("Matured (coupons paid)");
  });

  it("reports a same-day maturity as maturing today", () => {
    const info = securityRowStatus(
      { securityType: "tbill_364", maturityDate: new Date(ANCHOR + 6 * 3600_000), isMatured: false },
      ANCHOR,
    );
    expect(info.status).toBe("maturing");
    expect(info.isPast).toBe(false);
    expect(info.label).toBe("Maturing today");
  });

  it("honours the explicit isMatured flag regardless of date", () => {
    const info = securityRowStatus(
      { securityType: "tbill_91", maturityDate: new Date(ANCHOR + 30 * DAY), isMatured: true },
      ANCHOR,
    );
    expect(info.status).toBe("matured");
    expect(info.isPast).toBe(true);
  });

  it("treats an open-ended (no maturity) security as accruing", () => {
    const info = securityRowStatus(
      { securityType: "fxd", maturityDate: null, isMatured: false },
      ANCHOR,
    );
    expect(info.status).toBe("accruing");
    expect(info.isPast).toBe(false);
  });

  it("flips tense as the simulated clock advances past the maturity", () => {
    const s: Pick<SecurityIncomeInput, "maturityDate" | "isMatured" | "securityType"> = {
      securityType: "tbill_182",
      maturityDate: new Date(ANCHOR + 30 * DAY),
      isMatured: false,
    };
    expect(securityRowStatus(s, ANCHOR).status).toBe("accruing");
    expect(securityRowStatus(s, ANCHOR + 31 * DAY).status).toBe("matured");
  });
});

describe("Round 76 — buildSecurityIncome respects the injected effective now", () => {
  const secs: SecurityIncomeInput[] = [
    { id: 1, securityType: "fxd", faceValue: 100_000, couponRate: 13, isTaxExempt: false, maturityDate: new Date(ANCHOR + 200 * DAY) },
    { id: 2, securityType: "tbill_91", faceValue: 50_000, couponRate: 16, isTaxExempt: false, maturityDate: new Date(ANCHOR - 10 * DAY) },
  ];

  it("excludes securities already matured at the simulated now", () => {
    // At ANCHOR the T-bill (matured 10 days ago) drops out; only the FXD is live.
    const s = buildSecurityIncome(secs, 365, ANCHOR);
    expect(s.rows.map((r) => r.id)).toEqual([1]);
    expect(Math.round(s.grossAnnual)).toBe(13_000);
  });

  it("includes a security that was still live at an earlier simulated now", () => {
    // 20 days before ANCHOR, the T-bill had not yet matured → both live.
    const s = buildSecurityIncome(secs, 365, ANCHOR - 20 * DAY);
    expect(s.rows.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it("attaches a tense-aware status label to each live row", () => {
    const s = buildSecurityIncome(secs, 365, ANCHOR);
    const fxd = s.rows.find((r) => r.id === 1);
    expect(fxd?.status).toBe("accruing");
    expect(fxd?.statusLabel).toBe("Accruing");
  });

  it("defaults to the real clock when no now is passed (back-compat)", () => {
    // Security maturing far in the future is always live regardless of clock.
    const future: SecurityIncomeInput[] = [
      { id: 9, securityType: "ifb", faceValue: 100_000, couponRate: 12, isTaxExempt: true, maturityDate: new Date(Date.now() + 400 * DAY) },
    ];
    const s = buildSecurityIncome(future, 365);
    expect(s.rows).toHaveLength(1);
    expect(s.rows[0].status).toBe("accruing");
  });
});
