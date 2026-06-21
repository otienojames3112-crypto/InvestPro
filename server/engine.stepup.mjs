import { runProjection } from "./engine.ts";

const BASE = {
  mmfYield: 8.78,
  tbill91Rate: 8.8206,
  tbill182Rate: 8.7782,
  tbill364Rate: 8.9746,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  startDate: "2026-07-01",
};

console.log("Step-up | M120 Total | Hits 5M?");
console.log("--------|-----------|--------");

for (const stepUp of [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000]) {
  const result = runProjection({ ...BASE, stepUpAmount: stepUp });
  const last = result[119];
  const hits = last.totalEnd >= 5000000;
  console.log(`KES ${String(stepUp).padStart(5)} | ${Math.round(last.totalEnd).toLocaleString("en-KE").padStart(11)} | ${hits ? "YES ✓" : "no"}`);
}
