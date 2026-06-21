/**
 * Test: what if T-bills are valued at face + FULL net discount (not accrued)?
 * This would represent the total return if all T-bills were held to maturity.
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

// The engine currently uses accrued discount. Let's see what the spec's
// KES 5,279,234 implies about T-bill valuation.
// At M120: MMF=82,872, T-Bill(accrued)=4,680,514, IFB=0, FXD=0, Total=4,763,385
// Spec: 5,279,234
// Implied T-bill value in spec: 5,279,234 - 82,872 = 5,196,362
// Our T-bill face value at M120: 4,650,000 (from earlier diagnostic)
// Implied extra: 5,196,362 - 4,650,000 = 546,362

// T-bill face value at M120 = 4,650,000
// Full net discount on 3-month T-bills at 8.9746% gross, 15% WHT:
// Net rate = 8.9746 * 0.85 = 7.6284%
// Per KES 50,000 lot, 3-month tenor: discount = 50000 * 0.076284 * (3/12) = 953.55
// Number of lots: 4,650,000 / 50,000 = 93 lots
// Total full discount: 93 * 953.55 = 88,680
// But accrued discount (partial) is less than full discount

// The spec's extra KES 546,362 is much larger than the full discount on 3-month T-bills.
// This suggests the spec is using a different approach entirely.

// Let me check: what if the spec uses 12-month T-bills throughout (not switching to 3-month)?
// With 12-month T-bills: full net discount per KES 50,000 = 50000 * 0.076284 = 3,814
// 93 lots * 3,814 = 354,702 — still not enough

// What if the spec doesn't switch to 3-month T-bills in the final phase?
// Let me run the engine without the final-phase tenor switch and see what happens.

// Patch: temporarily override getSweepTargetForMonth to always use 12-month T-bills
// Actually, let's just check what the spec's PDF says about the final phase tenor.

// From the spec: "Set tenor by phase per the PDF's Rule 3: 364-day (12-month) bills in the 
// growth years, 182-day (6-month) in de-risking, 91-day (3-month) near the end."
// So 3-month is correct for the final phase.

// The real question: does the spec include T-bill interest in the portfolio value 
// BEFORE maturity, or does it only count face value?

// Let me check: at M108 our engine = 3,750,940, spec = 3,734,412.
// Our engine is HIGHER at M108 (because we include accrued discount).
// So the spec does NOT include accrued discount at M108!
// But at M120 our engine = 4,763,385, spec = 5,279,234.
// The spec is HIGHER at M120.

// This is contradictory unless the spec uses a completely different model for the final year.
// The spec might be computing M120 as: sum of all maturity proceeds received in M121-M123
// (i.e. the T-bills bought in M118-M120 mature in M121-M123, but the spec counts them NOW).

// OR: the spec's M120 value includes the maturity value of all T-bills that will mature
// within the next 3 months (since they're 3-month T-bills, they all mature by M123).

// Let's compute: what is the total maturity value of all T-bills outstanding at M120?
// Face value = 4,650,000
// Full net discount on all lots (3-month tenor):
// = 4,650,000 * (8.9746/100 * 0.85 * 3/12)
// = 4,650,000 * 0.019063
// = 88,643

// Total maturity value = 4,650,000 + 88,643 = 4,738,643
// Still not 5,196,362.

// The gap of 546,362 is too large to be explained by T-bill discount alone.
// Let me check: what if the spec uses 12-month T-bills in the final phase?

console.log("Analysis of T-bill valuation approaches:");
const faceValue = 4650000;
const grossRate = 8.9746 / 100;
const wht = 0.15;
const netRate = grossRate * (1 - wht);

// 3-month tenor
const fullDiscount3m = faceValue * netRate * (3/12);
console.log(`3-month T-bills: face=${faceValue.toLocaleString()}, full net discount=${Math.round(fullDiscount3m).toLocaleString()}, total=${Math.round(faceValue + fullDiscount3m).toLocaleString()}`);

// 12-month tenor  
const fullDiscount12m = faceValue * netRate * (12/12);
console.log(`12-month T-bills: face=${faceValue.toLocaleString()}, full net discount=${Math.round(fullDiscount12m).toLocaleString()}, total=${Math.round(faceValue + fullDiscount12m).toLocaleString()}`);

// What the spec implies
const specImpliedTbill = 5279234 - 82872;
console.log(`Spec implied T-bill value: ${Math.round(specImpliedTbill).toLocaleString()}`);
console.log(`Implied extra over face: ${Math.round(specImpliedTbill - faceValue).toLocaleString()}`);

// What if the spec uses MMF compounding on the whole portfolio?
// i.e. the spec's "simplified planning model" just compounds everything at MMF rate?
const result = runProjection(SETTINGS);
const m108 = result[107].totalEnd;
const mmfNetAnnual = 8.78 * 0.85;
const mmfMonthly = Math.pow(1 + mmfNetAnnual/100, 1/12) - 1;
let specSimple = m108;
for (let i = 108; i < 120; i++) {
  specSimple = specSimple * (1 + mmfMonthly) + result[i].contribution;
}
console.log(`\nIf spec compounds everything at MMF rate from M108: ${Math.round(specSimple).toLocaleString()}`);
console.log(`Spec target: 5,279,234`);
