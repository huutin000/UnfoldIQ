"use strict";

/**
 * Flow Companion download/import tests (STEP 10B): DI1–DI10.
 * TEST-ONLY fixture files under projects/__flow10b_di__/ (removed after).
 * Real PNG bytes (1x1) for dimension checks; zero-byte and wrong-ext negatives.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const TEST_PROJECT = "__flow10b_di__";

const { importResult } = require("../../flow-companion/bridge/importer.js");
const { validateProviderResult } = require("../../lib/provider-result-check.js");

let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ✓ ${m}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => {
      console.log(`[FAIL] ${name}: ${e.message}`);
      failed++;
    });
}

function logOut(label, obj) {
  console.log(`  output: ${label} = ${JSON.stringify(obj)}`);
}

// Minimal valid 1x1 PNG.
function pngBytes() {
  const ihdr = Buffer.alloc(25);
  ihdr.write("IHDR", 4);
  ihdr.writeUInt32BE(13, 8 - 4 + 4); // length at offset 8
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    (() => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(13, 0);
      const type = Buffer.from("IHDR");
      const data = Buffer.alloc(13);
      data.writeUInt32BE(1, 0);
      data.writeUInt32BE(1, 4);
      data[8] = 8;
      data[9] = 2;
      const crc = Buffer.alloc(4);
      return Buffer.concat([len, type, data, crc]);
    })(),
    (() => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(0, 0);
      return Buffer.concat([len, Buffer.from("IEND"), Buffer.alloc(4)]);
    })(),
  ]);
}

function tmpFile(name, bytes) {
  const abs = path.join(REPO_ROOT, "projects", TEST_PROJECT, "_incoming", name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, bytes);
  return abs;
}

function imgJob(overrides = {}) {
  return {
    jobId: overrides.jobId || "DI-JOB", requestId: "DI-REQ", projectId: TEST_PROJECT,
    sceneId: "S03", capability: "image", mode: "ASSISTED_APPROVAL", attempt: overrides.attempt || 1,
    continuityContext: overrides.continuityContext || {},
  };
}

function vidJob(overrides = {}) {
  return { ...imgJob(overrides), jobId: overrides.jobId || "DI-VID", sceneId: "S05", capability: "video" };
}

async function main() {
  console.log("=== FLOW DOWNLOAD/IMPORT TESTS (DI1-DI10) ===\n");

  // DI1 — downloaded image renamed deterministically.
  await runTest("DI1 Image deterministic naming", async () => {
    const src = tmpFile("dl1.png", pngBytes());
    const { artifactPath } = importResult({ projectRoot: REPO_ROOT, job: imgJob({ jobId: "DI1" }), sourceAbsPath: src });
    logOut("artifactPath", artifactPath);
    assert(artifactPath === "assets/image/S03/S03_attempt-01.png", "image must land at deterministic path");
  });

  // DI2 — downloaded video renamed deterministically.
  await runTest("DI2 Video deterministic naming", async () => {
    const src = tmpFile("dl2.mp4", Buffer.from("TEST-ONLY-MP4"));
    const { artifactPath } = importResult({ projectRoot: REPO_ROOT, job: vidJob({ jobId: "DI2" }), sourceAbsPath: src });
    logOut("artifactPath", artifactPath);
    assert(artifactPath === "assets/video/S05/S05_attempt-01.mp4", "video must land at deterministic path");
  });

  // DI3 — old approved attempt not overwritten.
  await runTest("DI3 Approved attempt preserved", async () => {
    const src = tmpFile("dl3.png", pngBytes());
    const first = importResult({ projectRoot: REPO_ROOT, job: imgJob({ jobId: "DI3" }), sourceAbsPath: src });
    const second = importResult({ projectRoot: REPO_ROOT, job: imgJob({ jobId: "DI3", attempt: 2 }), sourceAbsPath: src });
    logOut("paths", { first: first.artifactPath, second: second.artifactPath });
    assert(first.artifactPath !== second.artifactPath, "second attempt must not overwrite the first");
    assert(fs.existsSync(path.join(REPO_ROOT, "projects", TEST_PROJECT, first.artifactPath)), "first attempt must still exist");
  });

  // DI4 — wrong job result rejected.
  await runTest("DI4 Wrong-job correlation enforced", async () => {
    let code = null;
    try {
      importResult({ projectRoot: REPO_ROOT, job: { capability: "image" }, sourceAbsPath: tmpFile("dl4.png", pngBytes()) });
    } catch (e) {
      code = e.message;
    }
    logOut("rejection", code);
    assert(code && /JOB_IDENTITY_REQUIRED/.test(code), "import without job identity must be rejected");
  });

  // DI5 — zero-byte file rejected.
  await runTest("DI5 Zero-byte rejected", async () => {
    let code = null;
    try {
      importResult({ projectRoot: REPO_ROOT, job: imgJob({ jobId: "DI5" }), sourceAbsPath: tmpFile("empty.png", Buffer.alloc(0)) });
    } catch (e) {
      code = e.message;
    }
    logOut("rejection", code);
    assert(code && /ZERO_BYTE/.test(code), "zero-byte file must be rejected");
  });

  // DI6 — unexpected extension rejected.
  await runTest("DI6 Unexpected extension rejected", async () => {
    let code = null;
    try {
      importResult({ projectRoot: REPO_ROOT, job: imgJob({ jobId: "DI6" }), sourceAbsPath: tmpFile("note.exe", Buffer.from("x")) });
    } catch (e) {
      code = e.message;
    }
    logOut("rejection", code);
    assert(code && /UNEXPECTED_EXTENSION/.test(code), "unexpected extension must be rejected");
  });

  // DI7 — valid image imports.
  await runTest("DI7 Valid image imports READY", async () => {
    const src = tmpFile("dl7.png", pngBytes());
    const { result } = importResult({ projectRoot: REPO_ROOT, job: imgJob({ jobId: "DI7" }), sourceAbsPath: src });
    const v = validateProviderResult(result, { projectRoot: REPO_ROOT, checkExists: true });
    logOut("result", { status: result.status, provider: result.providerId, valid: v.valid });
    assert(result.status === "READY" && v.valid === true, "valid image must import READY");
    assert(result.metadata && result.metadata.width === 1 && result.metadata.height === 1, "image dimensions must be recorded");
  });

  // DI8 — valid video imports.
  await runTest("DI8 Valid video imports READY", async () => {
    const src = tmpFile("dl8.mp4", Buffer.from("TEST-ONLY-MP4"));
    const { result } = importResult({ projectRoot: REPO_ROOT, job: vidJob({ jobId: "DI8" }), sourceAbsPath: src });
    const v = validateProviderResult(result, { projectRoot: REPO_ROOT, checkExists: true });
    logOut("result", { status: result.status, valid: v.valid });
    assert(result.status === "READY" && v.valid === true, "valid video must import READY");
  });

  // DI9 — provider result provenance populated.
  await runTest("DI9 Provenance populated", async () => {
    const src = tmpFile("dl9.mp4", Buffer.from("TEST-ONLY-MP4"));
    const { result } = importResult({ projectRoot: REPO_ROOT, job: vidJob({ jobId: "DI9" }), sourceAbsPath: src });
    logOut("provenance", { note: result.provenanceNote, model: result.modelOrVersion, cost: result.costClass, source: result.sourceType });
    assert(/DI9/.test(result.provenanceNote), "provenance must cite the job");
    assert(result.providerId === "flow-web", "provider must be recorded");
    assert(result.sourceType === "generated" && result.costClass === "INCLUDED_SUBSCRIPTION", "source/cost must be recorded");
  });

  // DI10 — continuity metadata REVIEW_REQUIRED for recurring subject.
  await runTest("DI10 Continuity REVIEW_REQUIRED", async () => {
    const src = tmpFile("dl10.mp4", Buffer.from("TEST-ONLY-MP4"));
    const { result } = importResult({
      projectRoot: REPO_ROOT,
      job: vidJob({ jobId: "DI10", continuityContext: { registryVersion: "cr-1", requiredEntities: ["CHAR_MOTHER_01"], referenceAssetIds: ["REF_MOTHER_MASTER"] } }),
      sourceAbsPath: src,
    });
    logOut("continuity", result.continuity);
    assert(result.continuity.continuityStatus === "REVIEW_REQUIRED", "recurring generated subject must be REVIEW_REQUIRED");
    assert(result.continuity.entitiesUsed.includes("CHAR_MOTHER_01"), "entity IDs must survive import");
  });

  fs.rmSync(path.join(REPO_ROOT, "projects", TEST_PROJECT), { recursive: true, force: true });
  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) {
    console.log("RESULT: SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  try {
    fs.rmSync(path.join(REPO_ROOT, "projects", TEST_PROJECT), { recursive: true, force: true });
  } catch {}
  process.exit(1);
});
