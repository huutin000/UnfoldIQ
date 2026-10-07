"use strict";

/**
 * FIX 01 Gap C — Kokoro-82M local model identity (F15–F17).
 *
 * Hashes the exact local kokoro-v1_0.pth bytes loaded by `python -m kokoro`
 * and compares to the official upstream LFS SHA256. Never copies an upstream
 * hash into metadata without hashing local bytes. Mismatch fails closed.
 * Persists providers/model-registry/kokoro-v1-identity.json as the separate
 * immutable provenance artifact (production segment JSONs are NOT rewritten).
 */

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const kokoro = require(path.join(REPO, "providers", "runtime", "adapters", "local-kokoro.js"));

// Official upstream SHA256 (Git LFS oid) for hexgrad/Kokoro-82M kokoro-v1_0.pth,
// retrieved 2026-10-06 from https://huggingface.co/api/models/hexgrad/Kokoro-82M/paths-info/main
// (paths: ["kokoro-v1_0.pth"]). Size 327212226 bytes must also match.
const OFFICIAL_SHA256 = "496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4";
const OFFICIAL_SIZE = 327212226;
const SOURCE_REF = "https://huggingface.co/api/models/hexgrad/Kokoro-82M/paths-info/main (lfs.oid, retrieved 2026-10-06)";

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed += 1; console.log("[FAIL] " + msg); }
  else console.log("  ok  " + msg);
}

function main() {
  const resolved = kokoro.resolveLocalModelFile();
  assert(resolved.ok, "F15-prep: local model file resolves (" + (resolved.modelFile || resolved.message) + ")");
  if (!resolved.ok) { console.log(`\n=== DONE: 0 passed, 1 failed ===`); process.exit(1); }
  assert(resolved.sizeBytes === OFFICIAL_SIZE, `local size ${resolved.sizeBytes} == upstream ${OFFICIAL_SIZE}`);

  const t0 = Date.now();
  const verified = kokoro.verifyLocalModel(OFFICIAL_SHA256);
  console.log(`  info sha256 computed in ${Date.now() - t0}ms`);
  assert(verified.ok && verified.match === true, "F15+F16: local SHA256 matches official upstream hash");
  if (!verified.ok) {
    console.log("MODEL_HASH_MISMATCH: " + verified.message);
    console.log(`\n=== DONE: 0 passed, 1 failed ===`);
    process.exit(1);
  }

  // F17: mismatch branch fails closed (wrong expected hash, no mutation).
  const bad = kokoro.verifyLocalModel("0".repeat(64));
  assert(!bad.ok && bad.code === "MODEL_HASH_MISMATCH", "F17: wrong expected hash fails closed with MODEL_HASH_MISMATCH");

  const evidence = {
    schemaVersion: "1.0.0",
    provider: "local-kokoro",
    modelRepo: verified.modelRepo,
    modelFile: verified.modelFile,
    snapshot: verified.snapshot,
    sizeBytes: verified.sizeBytes,
    localSha256: verified.localSha256,
    officialExpectedSha256: OFFICIAL_SHA256,
    officialSizeBytes: OFFICIAL_SIZE,
    match: true,
    verifiedAt: new Date().toISOString(),
    sourceRef: SOURCE_REF,
    note: "Production segment artifacts keep their recorded runtime identity; this file is the separate immutable provenance artifact (FIX 01 Gap C). Wiring per-synthesis modelHash is deferred — see report.",
  };
  const dir = path.join(REPO, "providers", "model-registry");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "kokoro-v1-identity.json"), JSON.stringify(evidence, null, 2) + "\n", "utf8");
  console.log("  ok  evidence: providers/model-registry/kokoro-v1-identity.json");

  console.log(`\n=== DONE: ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
