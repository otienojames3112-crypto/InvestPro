/**
 * Trace the engine state at month 120 to understand the gap vs spec.
 * Temporarily expose lot state.
 */
import { runProjection, getScheduledContribution } from "./engine.ts";

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

// Print months 108-120 in detail
console.log("Month | MMF End | T-Bill | IFB | FXD | Total | CBK Cash | Sweep");
for (let i = 107; i < 120; i++) {
  const r = result[i];
  const fmt = (n) => Math.round(n).toLocaleString("en-KE");
  console.log(`M${r.monthNumber} | ${fmt(r.mmfEnd)} | ${fmt(r.tbillEnd)} | ${fmt(r.ifbEnd)} | ${fmt(r.fxdEnd)} | ${fmt(r.totalEnd)} | ${fmt(r.cbkCashIn)} | ${fmt(r.mmfToDhow)}`);
}

const last = result[119];
console.log("\nMonth 120 breakdown:");
console.log(`  MMF: ${Math.round(last.mmfEnd).toLocaleString("en-KE")}`);
console.log(`  T-Bill (incl accrued): ${Math.round(last.tbillEnd).toLocaleString("en-KE")}`);
console.log(`  IFB: ${Math.round(last.ifbEnd).toLocaleString("en-KE")}`);
console.log(`  FXD: ${Math.round(last.fxdEnd).toLocaleString("en-KE")}`);
console.log(`  Total: ${Math.round(last.totalEnd).toLocaleString("en-KE")}`);
console.log(`  Spec: 5,279,234`);
console.log(`  Gap: ${Math.round(5279234 - last.totalEnd).toLocaleString("en-KE")}`);

// The spec says M120 ≈ 5,279,234.
// Our M108 = 3,734,412 (matches spec).
// From M108 to M120 we need to grow by 5,279,234 - 3,734,412 = 1,544,822
// Our engine grows from M108 to M120 by: last.totalEnd - result[107].totalEnd
const m108 = result[107].totalEnd;
const m120 = last.totalEnd;
console.log(`\nGrowth M108→M120: engine = ${Math.round(m120 - m108).toLocaleString("en-KE")}, spec = ${Math.round(5279234 - 3734412).toLocaleString("en-KE")}`);

// What contributions were made in M109-M120?
let contribs = 0;
for (let i = 108; i < 120; i++) contribs += result[i].contribution;
console.log(`Contributions M109-M120: ${Math.round(contribs).toLocaleString("en-KE")}`);

// What CBK cash-in was received?
let cbk = 0;
for (let i = 108; i < 120; i++) cbk += result[i].cbkCashIn;
console.log(`CBK cash-in M109-M120: ${Math.round(cbk).toLocaleString("en-KE")}`);
