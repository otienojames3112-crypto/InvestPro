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

const SPEC = {
  12:  49590,
  24:  177186,
  36:  389825,
  48:  692299,   // not in spec, using engine value
  60:  1058666,  // not in spec
  72:  1570478,  // not in spec
  84:  2184581,  // not in spec
  96:  2866647,  // not in spec
  108: 3734412,  // not in spec
  120: 5279234,
};

const result = runProjection(SETTINGS);

console.log("Year | Month | Engine Total | Spec Target | Delta%");
console.log("-----|-------|-------------|-------------|-------");
for (let y = 1; y <= 10; y++) {
  const m = y * 12;
  const row = result[m - 1];
  const spec = SPEC[m];
  const delta = spec ? ((row.totalEnd / spec - 1) * 100).toFixed(2) + "%" : "N/A";
  const fmt = (n) => Math.round(n).toLocaleString("en-KE");
  console.log(
    `Y${y}   | M${String(m).padStart(3)} | ${fmt(row.totalEnd).padStart(13)} | ${spec ? fmt(spec).padStart(11) : "N/A".padStart(11)} | ${delta}`
  );
}

// Also print the spec checkpoints from the document
console.log("\nSpec checkpoints from document:");
console.log("M12 ≈ 49,590, M24 ≈ 177,186, M36 ≈ 389,825, M120 ≈ 5,279,234");
