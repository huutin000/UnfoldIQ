"use strict";

/**
 * Phase 1G.11 — real existing-asset gate (§50). No new generation.
 * Uses locked 1G.10 asset as-1186233d1af6 (GEN01_attempt-01.png, 32x32):
 * real assetId, real sha256, real lineage/lock fields, real instruction
 * linkage shape. Every layer runs honestly; the outcome is whatever the
 * evidence supports (PASS/WARN/UNKNOWN-REVIEW) — never forced to PASS.
 * Repo state is read-only; QA persistence goes to a tmp root.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const qa = require("../../lib/asset-qa/index.js");
const assetLib = require("../../lib/asset-library/index.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const PROJECT = "postv1b-flow-companion-live";
const ASSET_ID = "as-1186233d1af6";
const REL_PATH = "assets/image/GEN01/GEN01_attempt-01.png";

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
  await runTest("REAL1 real asset bytes + registry hash agree", () => {
    const abs = path.join(REPO_ROOT, "projects", PROJECT, REL_PATH);
    const bytes = fs.readFileSync(abs);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const rec = assetLib.getAsset(REPO_ROOT, PROJECT, ASSET_ID);
    assert(rec.ok === true, "real 1G.10 record resolves");
    assert(rec.record.hash.value === hash, "registry hash matches real file bytes");
    assert(rec.record.lock && rec.record.lock.locked === true, "record is the locked approved reference");
    assert(Array.isArray(rec.record.derivedFrom), "real lineage field present");
    assert("instructionVersion" in rec.record, "real instruction-version linkage field present");
  });

  await runTest("REAL2 structural QA on real bytes PASSes honestly", () => {
    const bytes = fs.readFileSync(path.join(REPO_ROOT, "projects", PROJECT, REL_PATH));
    const r = qa.evaluateStructural({ bytes, fileName: "GEN01_attempt-01.png", expected: { mediaType: "image", width: 32, height: 32, aspect: "1:1" } });
    assert(r.status === "PASS", `real PNG structural PASS (got ${r.status})`);
  });

  await runTest("REAL3 full QA honest outcome (no forced PASS)", () => {
    const bytes = fs.readFileSync(path.join(REPO_ROOT, "projects", PROJECT, REL_PATH));
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const result = qa.evaluateAssetQa({
      projectId: PROJECT,
      assetId: ASSET_ID,
      assetHash: hash,
      shotId: null,
      sceneId: null,
      fingerprintDeps: { assetId: ASSET_ID, assetHash: hash },
      structural: { bytes, fileName: "GEN01_attempt-01.png", expected: { mediaType: "image" } },
      semantic: { expectation: { expectedMediaType: "image" }, observation: null },
      factuality: { contentClass: "UNKNOWN", expectation: {}, observations: {} },
      continuity: { sources: { continuityStrictness: "LOOSE" }, expectation: {}, observation: null },
    });
    assert(["PASS", "UNKNOWN"].includes(result.semantic.status), "semantic honest without observation (UNKNOWN expected)");
    assert(result.aggregate.timelineEligible === false || result.aggregate.status === "READY_FOR_TIMELINE", "outcome is evidence-driven");
    assert(result.aggregate.status !== "READY_FOR_TIMELINE" || result.structural.status === "PASS", "no unearned eligibility");
    console.log(`  … honest aggregate: ${result.aggregate.status} (failed=${result.aggregate.failedLayers} unknown=${result.aggregate.unknownLayers})`);
    const v = qa.validateQaResult(result);
    assert(v.valid === true, "honest result still satisfies validator invariants");
  });

  await runTest("REAL4 QA persist to tmp never mutates locked bytes", () => {
    const abs = path.join(REPO_ROOT, "projects", PROJECT, REL_PATH);
    const before = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-1g11-real-"));
    fs.mkdirSync(path.join(root, "projects", PROJECT), { recursive: true });
    const bytes = fs.readFileSync(abs);
    const out = qa.evaluateAndPersist(root, {
      projectId: PROJECT,
      assetId: ASSET_ID,
      assetHash: before,
      fingerprintDeps: { assetId: ASSET_ID, assetHash: before },
      structural: { bytes, fileName: "GEN01_attempt-01.png", expected: { mediaType: "image" } },
      semantic: { expectation: {}, observation: null },
      factuality: { contentClass: "FICTION", expectation: {}, observations: {} },
      continuity: { sources: {}, expectation: {}, observation: null },
    });
    assert(out.ok === true, "real-asset QA persists to isolated root");
    const after = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    assert(before === after, "locked repo bytes untouched by QA");
    const g = qa.assertAssetReadyForTimeline(root, PROJECT, ASSET_ID, null, { currentDeps: { assetId: ASSET_ID, assetHash: before } });
    assert(typeof g.eligible === "boolean", "timeline gate answers for the real asset");
    console.log(`  … real-asset gate: eligible=${g.eligible} status=${g.status}`);
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
