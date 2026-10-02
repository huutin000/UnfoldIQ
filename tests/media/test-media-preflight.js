"use strict";

/**
 * UNFOLDIQ STEP-11 Branch C — media preflight tests (MP1-MP15).
 * Covers lib/media-preflight.js runPreflight/checkAsset/STATUS + lib/media-probe.js.
 * Fixtures under projects/__11_preflight__/ (removed in teardown).
 * No network, no installs, no MP4 render. PNG probe is native (deterministic).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__11_preflight__";
const PROJDIR = path.join(ROOT, "projects", PROJECT);

const { runPreflight, STATUS } = require("../../lib/media-preflight.js");
const mediaProbe = require("../../lib/media-probe.js");

let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ok ${m}`);
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

// 1x1 PNG (parsePngHeader-compatible)
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function writeRel(rel, data) {
  const abs = path.join(PROJDIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
  return abs;
}

function writePng(rel) {
  return writeRel(rel, Buffer.from(PNG_1X1_BASE64, "base64"));
}

function setup() {
  fs.rmSync(PROJDIR, { recursive: true, force: true });
  writePng("assets/img1.png");
  writePng("assets/fp.png");
  writePng("assets/ratio.png");
  writePng("assets/letterbox.png");
  writePng("assets/conflict.png");
  writePng("assets/allgood.png");
  writePng("assets/rights.png");
  writePng("assets/strict.png");
  writeRel("assets/empty.png", Buffer.alloc(0));
  writeRel("assets/clip.mp4", Buffer.from("FAKE-MP4-BYTES-NOT-A-REAL-VIDEO"));
  writeRel("assets/blob.xyz", Buffer.from("some-bytes-with-unknown-extension"));
  // Fingerprint index: projects/<proj>/assets/_fingerprints.json
  writeRel("assets/_fingerprints.json", Buffer.from(JSON.stringify({ "assets/fp.png": "fp-old" }, null, 2)));
}

function teardown() {
  fs.rmSync(PROJDIR, { recursive: true, force: true });
}

function baseScenes(extra) {
  const scenes = [{ sceneId: "S01" }, { sceneId: "S10", timing: { durationMs: 18000 } }];
  if (extra) scenes.push(extra);
  return { scenes };
}

function codes(list) {
  return (list || []).map((i) => i.code).join(",");
}

async function main() {
  console.log("=== MEDIA PREFLIGHT TESTS (MP1-MP15) ===\n");
  setup();

  await runTest("MP1 valid image -> READY", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP1-IMG", type: "image", sceneIds: ["S01"], path: "assets/img1.png", required: true, rights: { status: "VERIFIED" }, provenance: { providerId: "existing" }, sourceType: "existing" }] },
      sceneScript: baseScenes()
    });
    console.log(`  output: status=${r.status} codes=[${codes(r.blockingIssues)}]`);
    assert(r.status === "READY", `MP1 status must be READY, got ${r.status}`);
    const rec = r.assets[0];
    assert(rec.metadataStatus === "MEASURED", "PNG header probe is native so metadataStatus MEASURED");
  });

  await runTest("MP2 missing required image -> BLOCKED MISSING_FILE", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP2-IMG", type: "image", sceneIds: ["S01"], path: "assets/nope.png", required: true, rights: { status: "VERIFIED" }, sourceType: "existing" }] },
      sceneScript: baseScenes()
    });
    console.log(`  output: status=${r.status} codes=[${codes(r.blockingIssues)}]`);
    assert(r.status === "BLOCKED", "missing required asset must BLOCK");
    assert(/MISSING_FILE/.test(codes(r.blockingIssues)), "must record MISSING_FILE");
  });

  await runTest("MP3 zero-byte asset -> BLOCKED ZERO_BYTE", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP3-IMG", type: "image", sceneIds: ["S01"], path: "assets/empty.png", required: true, rights: { status: "VERIFIED" }, sourceType: "existing" }] },
      sceneScript: baseScenes()
    });
    console.log(`  output: status=${r.status} codes=[${codes(r.blockingIssues)}]`);
    assert(r.status === "BLOCKED", "zero-byte asset must BLOCK");
    assert(/ZERO_BYTE/.test(codes(r.blockingIssues)), "must record ZERO_BYTE");
  });

  await runTest("MP4 traversal path -> BLOCKED traversal", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP4-IMG", type: "image", sceneIds: ["S01"], path: "../../evil.png", required: true, rights: { status: "VERIFIED" }, sourceType: "existing" }] },
      sceneScript: baseScenes()
    });
    console.log(`  output: status=${r.status} codes=[${codes(r.blockingIssues)}]`);
    assert(r.status === "BLOCKED", "traversal path must BLOCK");
    assert(/TRAVERSAL/.test(codes(r.blockingIssues)), "must record PATH_TRAVERSAL");
  });

  await runTest("MP5 rights BLOCKED -> BLOCKED RIGHTS_BLOCKED", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP5-IMG", type: "image", sceneIds: ["S01"], path: "assets/rights.png", required: true, rights: { status: "BLOCKED" }, sourceType: "existing" }] },
      sceneScript: baseScenes()
    });
    console.log(`  output: status=${r.status} codes=[${codes(r.blockingIssues)}]`);
    assert(r.status === "BLOCKED", "BLOCKED rights must BLOCK");
    assert(/RIGHTS_BLOCKED/.test(codes(r.blockingIssues)), "must record RIGHTS_BLOCKED");
  });

  await runTest("MP6 fingerprint mismatch -> BLOCKED OUTDATED_FINGERPRINT", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP6-IMG", type: "image", sceneIds: ["S01"], path: "assets/fp.png", required: true, rights: { status: "VERIFIED" }, sourceType: "existing", expectedFingerprint: "fp-new" }] },
      sceneScript: baseScenes()
    });
    console.log(`  output: status=${r.status} codes=[${codes(r.blockingIssues)}]`);
    assert(r.status === "BLOCKED", "stale fingerprint must BLOCK");
    assert(/OUTDATED_FINGERPRINT|FINGERPRINT/.test(codes(r.blockingIssues)), "must record OUTDATED_FINGERPRINT");
  });

  await runTest("MP7 STRICT continuity unresolved -> BLOCKED CONTINUITY_UNRESOLVED", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP7-IMG", type: "image", sceneIds: ["S01"], path: "assets/strict.png", required: true, rights: { status: "VERIFIED" }, sourceType: "existing", continuityStrictness: "STRICT", continuityEntities: ["E1"] }] },
      sceneScript: baseScenes(),
      continuityRegistry: { entities: [] }
    });
    console.log(`  output: status=${r.status} codes=[${codes(r.blockingIssues)}]`);
    assert(r.status === "BLOCKED", "unresolved STRICT continuity must BLOCK");
    assert(/CONTINUITY_UNRESOLVED|CONTINUITY/.test(codes(r.blockingIssues)), "must record CONTINUITY_UNRESOLVED");
  });

  await runTest("MP8 aspect ratio differs + contain hint -> READY + aspectTreatment", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP8-IMG", type: "image", sceneIds: ["S01"], path: "assets/ratio.png", required: true, rights: { status: "VERIFIED" }, sourceType: "existing", treatmentHint: "contain" }] },
      sceneScript: baseScenes()
    });
    const rec = r.assets[0];
    console.log(`  output: status=${r.status} aspectTreatment=${JSON.stringify(rec.aspectTreatment)}`);
    assert(r.status === "READY", `MP8 must be READY, got ${r.status}`);
    assert(rec.aspectTreatment && rec.aspectTreatment.treatment === "contain", "aspectTreatment contain must be recorded (1x1 vs 16:9 canvas)");
  });

  await runTest("MP9 letterbox hint without design -> ACCIDENTAL_BLACK_BAR warning", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP9-IMG", type: "image", sceneIds: ["S01"], path: "assets/letterbox.png", required: true, rights: { status: "VERIFIED" }, sourceType: "existing", treatmentHint: "letterbox" }] },
      sceneScript: baseScenes()
    });
    console.log(`  output: status=${r.status} warnings=[${codes(r.warnings)}]`);
    assert(/ACCIDENTAL_BLACK_BAR/.test(codes(r.warnings)), "must warn ACCIDENTAL_BLACK_BAR");
  });

  await runTest("MP10 short video coverage allowed (no duration BLOCK)", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP10-VID", type: "video", sceneIds: ["S10"], path: "assets/clip.mp4", required: true, rights: { status: "VERIFIED" }, sourceType: "existing" }] },
      sceneScript: baseScenes()
    });
    console.log(`  output: status=${r.status} codes=[${codes(r.blockingIssues)}]`);
    assert(!/DURATION|SHORT_CLIP/.test(codes(r.blockingIssues)), "no BLOCKED for duration/coverage (short clips use planned coverage)");
    assert(r.status !== "BLOCKED" || !/DURATION/.test(codes(r.blockingIssues)), "duration must never block here");
  });

  await runTest("MP11 embedded audio policy recorded", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP11-VID", type: "video", sceneIds: ["S01"], path: "assets/clip.mp4", required: true, rights: { status: "VERIFIED" }, sourceType: "existing" }] },
      sceneScript: baseScenes()
    });
    const rec = r.assets[0];
    console.log(`  output: embeddedAudio=${rec.embeddedAudio} clipAudioPolicy=${rec.clipAudioPolicy} global=${r.generatedClipAudioPolicy}`);
    assert(["PRESENT", "ABSENT", "UNKNOWN"].includes(rec.embeddedAudio), "embeddedAudio must be recorded (UNKNOWN without ffprobe video metadata)");
    assert(rec.clipAudioPolicy === "MUTE_GENERATED_CLIP_AUDIO", "default clip-audio policy must be MUTE_GENERATED_CLIP_AUDIO");
    assert(r.generatedClipAudioPolicy === "MUTE_GENERATED_CLIP_AUDIO", "global policy defaults likewise");
  });

  await runTest("MP12 unknown extension -> metadataStatus UNKNOWN, not MEASURED", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP12-BLOB", sceneIds: ["S01"], path: "assets/blob.xyz", required: true, rights: { status: "VERIFIED" }, sourceType: "existing" }] },
      sceneScript: baseScenes()
    });
    const rec = r.assets[0];
    console.log(`  output: status=${r.status} metadataStatus=${rec.metadataStatus} codes=[${codes(r.blockingIssues)}]`);
    assert(rec.metadataStatus === "UNKNOWN", "unknown extension must stay UNKNOWN, never MEASURED");
    assert(rec.metadataStatus !== "MEASURED", "must not fabricate MEASURED");
  });

  await runTest("MP13 conflicting probeCandidates -> REVIEW_REQUIRED + PROBE_CONFLICT", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP13-IMG", type: "image", sceneIds: ["S01"], path: "assets/conflict.png", required: true, rights: { status: "VERIFIED" }, sourceType: "existing", probeCandidates: [{ width: 1920, height: 1080 }] }] },
      sceneScript: baseScenes()
    });
    console.log(`  output: status=${r.status} warnings=[${codes(r.warnings)}]`);
    assert(r.status === "REVIEW_REQUIRED", `conflicting candidates must REVIEW, got ${r.status}`);
    assert(/PROBE_CONFLICT/.test(codes(r.warnings)), "must record PROBE_CONFLICT");
  });

  await runTest("MP14 optional missing asset -> warning only", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP14-IMG", type: "image", sceneIds: ["S01"], path: "assets/optional-absent.png", required: false, rights: { status: "VERIFIED" }, sourceType: "existing" }] },
      sceneScript: baseScenes()
    });
    console.log(`  output: status=${r.status} warnings=[${codes(r.warnings)}] blockers=[${codes(r.blockingIssues)}]`);
    assert(r.status !== "BLOCKED", "optional missing asset must not BLOCK");
    assert(/OPTIONAL_MISSING/.test(codes(r.warnings)), "must warn OPTIONAL_MISSING");
  });

  await runTest("MP15 all required valid -> READY", async () => {
    const r = runPreflight({
      projectRoot: ROOT, projectId: PROJECT, platform: "youtube",
      assetManifest: { assets: [{ assetId: "MP15-IMG", type: "image", sceneIds: ["S01"], path: "assets/allgood.png", required: true, rights: { status: "VERIFIED" }, provenance: { providerId: "existing" }, sourceType: "existing" }] },
      sceneScript: baseScenes()
    });
    console.log(`  output: status=${r.status} STATUS.READY=${STATUS.READY}`);
    assert(r.status === STATUS.READY, "all-valid manifest must be READY");
    assert(r.blockingIssues.length === 0, "no blocking issues");
  });

  teardown();
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
  try { teardown(); } catch {}
  process.exit(1);
});
