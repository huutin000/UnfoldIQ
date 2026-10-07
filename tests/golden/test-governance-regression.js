"use strict";

/**
 * Phase 1H.6/1H.7 — Golden governance regressions (§60, deterministic).
 * A provider/model update must not silently strip provenance fields, and
 * Golden evidence must survive cleanup planning. Uses live read-only
 * evidence plus tmp fixtures; never mutates canonical stores.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const prov = require("../../lib/provenance/index.js");
const gold = require("../../lib/golden/index.js");
const storage = require("../../lib/storage/index.js");

const REPO = path.join(__dirname, "..", "..");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

async function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
  }
}

async function main() {
  await runTest("final asset traceability (registry → provenance → parents)", () => {
    const t = prov.traceLineage(REPO, "phase1g12-case-a", "as-6182cea3f996");
    assert(t.ok && t.chain.length >= 2, "C-end-frame traces to its video parent and beyond");
    assert(t.chain.every((c) => c.originType && c.status), "every hop carries origin + status");
  });

  await runTest("provenance completeness (required fields on live records)", () => {
    const loaded = prov.loadProvenance(REPO, "phase1g12-case-a");
    assert(loaded.ok, "live provenance loads");
    for (const [id, chain] of Object.entries(loaded.doc.provenance)) {
      const r = chain.versions[chain.current];
      assert(r.provenanceId && r.originType && r.rights && r.provenanceStatus, `${id} complete`);
      assert(r.rights.ownershipStatus !== undefined, `${id} rights categorized (never boolean)`);
    }
  });

  await runTest("compliance decision reproducibility (same characteristics → same verdict)", () => {
    const comp = require("../../lib/compliance/index.js");
    const doc = comp.loadCompliance(REPO, "phase1g12-case-a").doc;
    const snap = Object.values(doc.snapshots)[0];
    const first = Object.values(doc.decisions).find((d) => d.assetId === "as-fafd1ac4c96b");
    const again = comp.evaluateRules(snap, first.contentCharacteristics);
    assert(again.decision === first.decision, "re-evaluation reproduces the recorded decision");
  });

  await runTest("Golden evidence retention (golden refs block cleanup)", () => {
    const b = gold.latestBaseline(REPO, "gold-fiction-continuity").baseline;
    assert(b.evidenceRefs.length > 0, "baseline carries evidence refs");
    const entry = { artifactRef: b.evidenceRefs[0], storageClass: "EVIDENCE", durability: "DURABLE", retentionReasons: ["GOLDEN_BASELINE"] };
    assert(storage.verdictFor(entry, {}).verdict === "RETAIN", "golden-referenced evidence retained");
  });

  await runTest("cleanup lineage safety (golden asset never deletable by plan)", () => {
    const b = gold.latestBaseline(REPO, "gold-image-only").baseline;
    assert(b.ok !== false, "baseline loads");
    const entry = { artifactRef: "projects/phase1g12-case-a/render/render-input-case-a.json", storageClass: "EVIDENCE", durability: "DURABLE", retentionReasons: ["GOLDEN_BASELINE", "QA_EVIDENCE"] };
    const v = storage.verdictFor(entry, {});
    assert(v.verdict === "RETAIN" && v.blockingRefs.includes("GOLDEN_BASELINE"), "lineage-safe verdict for golden evidence");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
