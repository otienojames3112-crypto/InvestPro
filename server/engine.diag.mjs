/**
 * Diagnostic script — run with: node --loader tsx server/engine.diag.mjs
 * Traces the engine output at key months to find the gap vs spec.
 */
import { runProjection } from "./engine.ts";

const SETTINGS = {
  mmfYield: 8.78,
  tbill91Rate: 8.8206,
  tbill182Rate: 8.7782,
  tbill364Rate: 8.9746,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  startDate: "2026-07-01",
};

const result = runProjection(SETTINGS);

// Print header
console.log("Month | Contrib | MMF End | T-Bill | IFB | FXD | Total | CBK Cash | Sweep | Action");
console.log("------|---------|---------|--------|-----|-----|-------|----------|-------|-------");

const KEY_MONTHS = [1, 6, 12, 13, 24, 25, 36, 48, 60, 72, 84, 85, 96, 102, 103, 108, 120];
for (const row of result) {
  if (KEY_MONTHS.includes(row.monthNumber)) {
    const fmt = (n) => Math.round(n).toLocaleString("en-KE");
    console.log(
      `M${String(row.monthNumber).padStart(3)} | ${fmt(row.contribution).padStart(7)} | ${fmt(row.mmfEnd).padStart(9)} | ${fmt(row.tbillEnd).padStart(8)} | ${fmt(row.ifbEnd).padStart(9)} | ${fmt(row.fxdEnd).padStart(9)} | ${fmt(row.totalEnd).padStart(9)} | ${fmt(row.cbkCashIn).padStart(8)} | ${fmt(row.mmfToDhow).padStart(7)} | ${row.mainAction.slice(0, 80)}`
    );
  }
}

console.log("\n--- Summary ---");
const last = result[119];
console.log(`Month-120 total: KES ${Math.round(last.totalEnd).toLocaleString("en-KE")}`);
console.log(`  MMF: ${Math.round(last.mmfEnd).toLocaleString("en-KE")}`);
console.log(`  T-Bill: ${Math.round(last.tbillEnd).toLocaleString("en-KE")}`);
console.log(`  IFB: ${Math.round(last.ifbEnd).toLocaleString("en-KE")}`);
console.log(`  FXD: ${Math.round(last.fxdEnd).toLocaleString("en-KE")}`);

const totalContrib = result.reduce((s, r) => s + r.contribution, 0);
const totalCBK = result.reduce((s, r) => s + r.cbkCashIn, 0);
const totalWHT = result.reduce((s, r) => s + r.whtThisMonth, 0);
console.log(`Total contributions: KES ${Math.round(totalContrib).toLocaleString("en-KE")}`);
console.log(`Total CBK cash-in: KES ${Math.round(totalCBK).toLocaleString("en-KE")}`);
console.log(`Total WHT paid: KES ${Math.round(totalWHT).toLocaleString("en-KE")}`);

// Count lots at end
let lotsAtEnd = 0;
let tbillLots = 0, ifbLots = 0, fxdLots = 0;
// Can't access lots directly; use bucket totals
console.log(`\nSpec target: KES 5,279,234`);
console.log(`Gap: KES ${Math.round(5279234 - last.totalEnd).toLocaleString("en-KE")} (${((last.totalEnd/5279234 - 1)*100).toFixed(2)}%)`);
