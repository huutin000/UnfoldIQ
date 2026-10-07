"use strict";

/**
 * Phase 1G.12 hardening (Task 02, §5.1 + A-21): canonical-source gate tests.
 * A false asset (operator avatar shape: source "existing", no provider/job
 * lineage, QA not APPROVED) must never pass reference/source selection.
 * Deterministic, zero credits, filesystem-free (pure record shapes).
 */

const assetLib = require("../../lib/asset-library/index.js");

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

// Shape of as-1186233d1af6 (operator account avatar, never a generation result).
function avatarRecord() {
  return {
    assetId: "as-1186233d1af6", type: "image", role: "BROLL", source: "existing",
    provider: null, jobId: null, modelVersion: null,
    provenance: { source: "existing", detail: "byte-identical reuse" },
    qualityStatus: "REJECTED",
  };
}

function generatedFrame() {
  return {
    assetId: "as-fe697fd1fef8", type: "image", role: "BROLL", source: "generated",
    provider: "google-flow", jobId: "FLOW-COMPANION-LIVE-GEN-01", modelVersion: "google--nano-banana-2",
    provenance: { source: "generated", detail: "provider generation" },
    qualityStatus: "APPROVED",
  };
}

async function main() {
  await runTest("avatar-shaped record is refused as a canonical source", () => {
    const r = assetLib.validateCanonicalSource(avatarRecord(), { mediaType: "image" });
    assert(r.ok === false, `avatar refused (${r.code})`);
  });

  await runTest("generated + QA-APPROVED frame passes", () => {
    const r = assetLib.validateCanonicalSource(generatedFrame(), { mediaType: "image" });
    assert(r.ok === true, "canonical frame passes");
  });

  await runTest("character-ref shape (provider set, jobId null) passes", () => {
    const rec = {
      assetId: "as-a7801df9bf0f", type: "image", role: "CHARACTER_IDENTITY",
      source: "generated", provider: "google-flow", jobId: null,
      provenance: { source: "generated", detail: "mascot guide" },
      qualityStatus: "APPROVED",
    };
    assert(assetLib.validateCanonicalSource(rec, { mediaType: "image" }).ok === true, "mascot ref passes");
  });

  await runTest("QA-APPROVED is required even with generation lineage", () => {
    const rec = { ...generatedFrame(), qualityStatus: "UNREVIEWED" };
    const r = assetLib.validateCanonicalSource(rec, { mediaType: "image" });
    assert(r.ok === false && r.code === "SOURCE_QA_NOT_APPROVED", "unreviewed frame refused");
  });

  await runTest("media type mismatch is refused", () => {
    const r = assetLib.validateCanonicalSource({ ...generatedFrame(), type: "video" }, { mediaType: "image" });
    assert(r.ok === false && r.code === "SOURCE_TYPE_MISMATCH", "video-as-frame refused");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
