// One-off codemod: give a page component an optional `embedded` prop and
// forward it to its top-level <AppShell>. Only touches pages that take NO
// route params (zero-arg default export). Idempotent: skips files already done.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const pages = [
  "Scenarios", "AllocationPlan", "Ledger", "Withdrawals", "Contributions",
  "MmfFunds", "Securities", "BankInstruments", "OtherAssets", "Explore",
  "MmfStrategy", "AiIntake", "AiReview", "SourceConflicts", "PortfolioReview",
  "Reconciliation", "MmfAccrual", "TaxSummary",
];

const root = resolve(process.cwd(), "client/src/pages");
const results = [];

for (const name of pages) {
  const file = resolve(root, `${name}.tsx`);
  let src = readFileSync(file, "utf8");
  const before = src;

  if (src.includes("embedded")) {
    results.push(`${name}: SKIP (already has embedded)`);
    continue;
  }

  // 1) Signature: `export default function Name() {`  →  accept embedded prop.
  const sigRe = new RegExp(`export default function ${name}\\(\\)\\s*\\{`);
  if (!sigRe.test(src)) {
    results.push(`${name}: FAIL (signature not matched)`);
    continue;
  }
  src = src.replace(
    sigRe,
    `export default function ${name}({ embedded = false }: { embedded?: boolean } = {}) {`,
  );

  // 2) Opening <AppShell> (with no existing props) → <AppShell embedded={embedded}>.
  //    Handle both `<AppShell>` and `<AppShell >`.
  const shellCount = (src.match(/<AppShell>/g) || []).length;
  if (shellCount < 1) {
    results.push(`${name}: FAIL (no bare <AppShell> found)`);
    continue;
  }
  src = src.replace(/<AppShell>/g, "<AppShell embedded={embedded}>");

  if (src !== before) {
    writeFileSync(file, src, "utf8");
    results.push(`${name}: OK (${shellCount} AppShell tag(s) updated)`);
  } else {
    results.push(`${name}: NOCHANGE`);
  }
}

console.log(results.join("\n"));
