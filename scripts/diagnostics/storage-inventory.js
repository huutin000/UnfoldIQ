"use strict";

/**
 * POST-PHASE-2 D1 — runtime storage inventory (SCAN + REPORT).
 * Usage: node scripts/diagnostics/storage-inventory.js [--json <outPath>]
 * Read-only. Never logs secret material — sizes/paths/lifecycle only.
 */

const fs = require("fs");
const path = require("path");
const store = require("../../lib/runtime-storage/index.js");

const args = process.argv.slice(2);
const jsonIdx = args.indexOf("--json");
const outPath = jsonIdx >= 0 ? args[jsonIdx + 1] : null;

const result = store.scan();
const mb = (n) => (n === null ? "n/a" : (n / 1024 / 1024).toFixed(1) + " MB");

console.log(`RUNTIME STORAGE INVENTORY (policy ${result.policyVersion})`);
console.log(`root: ${result.root}`);
console.log(`measured: ${result.measuredAt}`);
console.log(`total: ${mb(result.totalBytes)}`);
console.log("");
for (const i of result.inventory) {
  console.log(
    `${i.path.padEnd(40)} ${mb(i.sizeBytes).padStart(10)}  ${String(i.fileCount ?? "n/a").padStart(6)} files  ${i.lifecycle.padEnd(18)} ${i.sensitivity.padEnd(16)} ${i.cleanupEligible ? "cleanable" : "keep"}${i.readable ? "" : "  [UNREADABLE]"}`
  );
}
const dominant = result.inventory[0];
if (dominant) console.log(`\nDOMINANT OWNER: ${dominant.path} (${mb(dominant.sizeBytes)}, ${dominant.lifecycle})`);

if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(`\nJSON report written: ${outPath}`);
}
