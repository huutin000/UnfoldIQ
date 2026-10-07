"use strict";

/**
 * POST-PHASE-2 D4 — runtime storage cleanup CLI (dry-run default).
 * Usage:
 *   node scripts/maintenance/runtime-storage-cleanup.js            (dry-run)
 *   node scripts/maintenance/runtime-storage-cleanup.js --execute  (real)
 * Only CACHE/EPHEMERAL lifecycle classes are ever removed. Skips entirely
 * while an active session lock (.session-active) exists.
 */

const fs = require("fs");
const path = require("path");
const store = require("../../lib/runtime-storage/index.js");

const execute = process.argv.includes("--execute");
const result = store.cleanup({ dryRun: !execute });

const mb = (n) => (n / 1024 / 1024).toFixed(1) + " MB";
console.log(`RUNTIME STORAGE CLEANUP — mode: ${result.mode} (policy ${result.policyVersion})`);
console.log(`root: ${result.root}`);
if (result.skippedActiveSession) console.log("SKIPPED: active session lock present (.session-active)");
console.log(`candidates: ${result.candidates.length}, reclaimable: ${mb(result.reclaimableBytes)}`);
for (const c of result.candidates) console.log(`  ~ ${c.path.padEnd(45)} ${mb(c.sizeBytes || 0).padStart(10)}  [${c.lifecycle}]`);
if (!result.dryRun) {
  for (const r of result.removed) console.log(`  removed: ${r.path} (+${mb(r.reclaimedBytes)})`);
  for (const s of result.skipped) console.log(`  skipped: ${s.path} — ${s.reason}`);
  console.log(`RECLAIMED: ${mb(result.reclaimedBytes)}`);
  const outDir = path.join(__dirname, "..", "..", "Report", "hardening");
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `cleanup-report-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(`report: ${out}`);
}
process.exit(result.ok ? 0 : 1);
