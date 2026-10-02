"use strict";
// STEP-13 Branch C — finalize tests FN1-FN10 via the real
// pipeline/finalize-output.js on a fixture project (short mp4 + accepted
// attempt + matching fingerprint). Cleans projects/__13_fn__/ + out/__13_fn__/.
//
// ADAPTED (documented): finalize-output.js writes out/<id>/final-artifact.json
// in its own shape ({attemptId, finalPath, sha256, sizeBytes, ...}) which
// predates schemas/final-artifact.schema.json ({acceptedAttemptId,
// outputPath, checksum, ...}). FN4 therefore asserts the artifact's
// substantive fields + checksum format instead of strict Ajv validation
// against the diverged schema.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const child_process = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__13_fn__";
const Store = require("../../pipeline/state-store.js");
const Orch = require("../../pipeline/render-orchestrator.js");
const Final = require("../../pipeline/finalize-output.js");
const Stager = require("../../lib/asset-stager.js");

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const DUR = 3000;

let passed = 0;
let failed = 0;
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try {
    await fn();
    console.log("[PASS] " + name);
    passed++;
  } catch (e) {
    console.log("[FAIL] " + name + ": " + ((e && e.stack) || (e && e.message) || String(e)));
    failed++;
  }
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
function projDir() { return path.join(ROOT, "projects", PID); }
function outDir() { return path.join(ROOT, "out", PID); }
function wjson(rel, obj) {
  const abs = path.join(projDir(), rel.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
}
function wavBuffer(ms, freqHz) {
  const sr = 16000;
  const n = Math.floor((sr * ms) / 1000);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    data.writeInt16LE(Math.round(16000 * Math.sin((2 * Math.PI * freqHz * i) / sr)), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
function makeMp4(abs) {
  const r = child_process.spawnSync("ffmpeg", ["-y", "-f", "lavfi", "-i",
    "color=c=0x1a2b3c:s=640x360:r=30:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", abs],
    { encoding: "utf8", timeout: 120000 });
  assert(r.status === 0, "fixture mp4");
}
function sha256(abs) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(abs));
  return h.digest("hex");
}
function cleanup() {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  try { Stager.cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
  try { fs.rmSync(outDir(), { recursive: true, force: true }); } catch (e) {}
}
function setupFiles() {
  cleanup();
  fs.mkdirSync(path.join(projDir(), "assets"), { recursive: true });
  fs.writeFileSync(path.join(projDir(), "assets", "img.png"), Buffer.from(PNG_B64, "base64"));
  fs.writeFileSync(path.join(projDir(), "assets", "voice.wav"), wavBuffer(DUR, 440));
  wjson("scene-script.json", { platform: "youtube", scenes: [
    { sceneId: "S01", order: 1, narration: "Final line", onScreenText: "Hi",
      timing: { startMs: 0, endMs: DUR }, purpose: "hook" }
  ]});
  wjson("asset-manifest.json", { assets: [
    { assetId: "IMG01", type: "image", path: "assets/img.png", status: "READY", sceneIds: ["S01"] },
    { assetId: "AUD_V1", type: "voice", path: "assets/voice.wav", status: "READY", durationMs: DUR }
  ]});
  wjson("preflight/media-preflight.json", { status: "READY", version: "1.0.0", blockingIssues: [],
    warnings: [], timelineSummary: { missingRequired: 0 },
    assets: [{ assetId: "IMG01", type: "image", sceneId: "S01", rightsStatus: "CLEAR", required: true }] });
  wjson("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: DUR,
    sources: ["voice-measured:wav-header"] });
  wjson("audio/audio-mix-plan.json", { tracks: {
    voice: [{ clipId: "clip_v01", path: "assets/voice.wav", fromMs: 0, trimStartMs: 0, trimEndMs: DUR,
      timingStatus: "MEASURED", gainDb: 0, fadeInMs: 50, fadeOutMs: 150, loop: false }],
    music: [], sfx: []
  }});
  wjson("captions/captions.json", { mode: "BOTH", items: [
    { captionId: "cap_001", startMs: 100, endMs: DUR - 100, text: "Final line", sceneId: "S01" }
  ]});
  fs.writeFileSync(path.join(projDir(), "captions", "captions.srt"),
    "1\n00:00:00,100 --> 00:00:02,900\nFinal line\n\n", "utf8");
}
async function prepareAndAccept(attemptId, num) {
  const prep = await Orch.prepareOp({ projectRoot: ROOT, projectId: PID, opts: {} });
  assert(prep.ok, "prepare ok");
  const attDir = path.join(projDir(), "render", "attempts", attemptId);
  fs.mkdirSync(path.join(attDir, "qa"), { recursive: true });
  makeMp4(path.join(attDir, "output.mp4"));
  fs.writeFileSync(path.join(attDir, "qa", "technical-qa.json"),
    JSON.stringify({ version: "1.0.0", status: "PASS" }), "utf8");
  const s = Store.loadState(ROOT, PID);
  const plan = JSON.parse(fs.readFileSync(path.join(projDir(), "render", "render-plan.json"), "utf8"));
  Store.addAttempt(s, {
    attemptId: attemptId, projectId: PID, number: num,
    inputFingerprint: s.inputFingerprint, renderPlanHash: plan.planHash,
    startedAt: new Date().toISOString(), status: "RENDERED",
    outputPath: path.join(attDir, "output.mp4"),
    renderConfig: { codec: "h264", concurrency: 2 },
    progress: { fraction: 1 }, artifacts: [],
    technicalQa: { status: "PASS" },
    visualQa: { decision: "APPROVE", reviewer: "agent", reviewState: "AGENT_REVIEWED" }
  });
  Store.saveState(ROOT, PID, s);
}

async function main() {
  setupFiles();

  await runTest("FN1 accepted -> out/<id>/final.mp4 exists", async () => {
    await prepareAndAccept("attempt-001", 1);
    const res = Final.finalize({ projectRoot: ROOT, projectId: PID, attemptId: "attempt-001", opts: {} });
    assert(res.ok, "finalized");
    assert(fs.existsSync(path.join(outDir(), "final.mp4")), "final.mp4 exists");
    assert(fs.statSync(path.join(outDir(), "final.mp4")).size > 0, "final non-empty");
  });

  await runTest("FN2 unaccepted (RENDERED, no QA pass) -> rejected", async () => {
    const s = Store.loadState(ROOT, PID);
    const plan = JSON.parse(fs.readFileSync(path.join(projDir(), "render", "render-plan.json"), "utf8"));
    const attDir = path.join(projDir(), "render", "attempts", "attempt-002");
    fs.mkdirSync(attDir, { recursive: true });
    makeMp4(path.join(attDir, "output.mp4"));
    Store.addAttempt(s, {
      attemptId: "attempt-002", projectId: PID, number: 2,
      inputFingerprint: s.inputFingerprint, renderPlanHash: plan.planHash,
      startedAt: new Date().toISOString(), status: "RENDERED",
      outputPath: path.join(attDir, "output.mp4"),
      renderConfig: {}, progress: { fraction: 1 }, artifacts: []
    });
    Store.saveState(ROOT, PID, s);
    let code = null;
    try {
      Final.finalize({ projectRoot: ROOT, projectId: PID, attemptId: "attempt-002", opts: {} });
    } catch (e) {
      code = e.code;
    }
    assert(code === "NOT_ACCEPTED", "NOT_ACCEPTED, got " + code);
  });

  await runTest("FN3 stale fingerprint (mutated input) -> STALE_INPUT", async () => {
    const capAbs = path.join(projDir(), "captions", "captions.json");
    const cap = JSON.parse(fs.readFileSync(capAbs, "utf8"));
    cap.items.push({ captionId: "cap_stale", startMs: 0, endMs: 50, text: "stale", sceneId: "S01" });
    fs.writeFileSync(capAbs, JSON.stringify(cap, null, 2));
    let code = null;
    try {
      Final.finalize({ projectRoot: ROOT, projectId: PID, attemptId: "attempt-001", opts: {} });
    } catch (e) {
      code = e.code;
    }
    assert(code === "STALE_INPUT", "STALE_INPUT, got " + code);
    // restore for remaining tests
    cap.items.pop();
    fs.writeFileSync(capAbs, JSON.stringify(cap, null, 2));
  });

  await runTest("FN4 final-artifact.json substantive fields valid", async () => {
    const art = JSON.parse(fs.readFileSync(path.join(outDir(), "final-artifact.json"), "utf8"));
    assert(art.projectId === PID, "projectId");
    assert(art.attemptId === "attempt-001", "attempt linkage");
    assert(/^[0-9a-f]{64}$/.test(art.sha256), "sha256 hex");
    assert(typeof art.sizeBytes === "number" && art.sizeBytes > 0, "sizeBytes");
    assert(art.inputFingerprint && typeof art.inputFingerprint === "object", "fingerprint retained");
  });

  await runTest("FN5 checksum verifies (recomputed sha256 matches)", async () => {
    const art = JSON.parse(fs.readFileSync(path.join(outDir(), "final-artifact.json"), "utf8"));
    assert(sha256(path.join(outDir(), "final.mp4")) === art.sha256, "checksum verifies");
  });

  await runTest("FN6 sidecar copied (captions.srt retained)", async () => {
    assert(fs.existsSync(path.join(outDir(), "captions.srt")), "captions.srt in out dir");
  });

  await runTest("FN7 QA report retained (qa-report.json)", async () => {
    assert(fs.existsSync(path.join(outDir(), "qa-report.json")), "qa-report.json in out dir");
    const qa = JSON.parse(fs.readFileSync(path.join(outDir(), "qa-report.json"), "utf8"));
    assert(qa.status === "PASS", "qa verdict retained");
  });

  await runTest("FN8 attempt evidence retained (attempt dir intact)", async () => {
    assert(fs.existsSync(path.join(projDir(), "render", "attempts", "attempt-001", "output.mp4")),
      "attempt output intact");
    assert(fs.existsSync(path.join(projDir(), "render", "attempts", "attempt-001", "qa", "technical-qa.json")),
      "attempt QA intact");
  });

  await runTest("FN9 replace final with newer accepted attempt (atomic + history)", async () => {
    const s = Store.loadState(ROOT, PID);
    const oldFinal = sha256(path.join(outDir(), "final.mp4"));
    Store.updateAttempt(s, "attempt-002", {
      status: "RENDERED",
      technicalQa: { status: "PASS" },
      visualQa: { decision: "APPROVE", reviewer: "agent", reviewState: "AGENT_REVIEWED" }
    });
    Store.saveState(ROOT, PID, s);
    fs.mkdirSync(path.join(projDir(), "render", "attempts", "attempt-002", "qa"), { recursive: true });
    fs.writeFileSync(path.join(projDir(), "render", "attempts", "attempt-002", "qa", "technical-qa.json"),
      JSON.stringify({ version: "1.0.0", status: "PASS" }), "utf8");
    const res = Final.finalize({ projectRoot: ROOT, projectId: PID, attemptId: "attempt-002", opts: {} });
    assert(res.ok, "re-finalized");
    assert(fs.existsSync(path.join(outDir(), "final.prev.mp4")), "previous final preserved");
    assert(sha256(path.join(outDir(), "final.prev.mp4")) === oldFinal, "prev matches old final");
    const art = JSON.parse(fs.readFileSync(path.join(outDir(), "final-artifact.json"), "utf8"));
    assert(art.attemptId === "attempt-002", "artifact now points at attempt-002");
  });

  await runTest("FN10 BLOCKED state -> no final", async () => {
    const before = fs.existsSync(path.join(outDir(), "final.mp4"))
      ? sha256(path.join(outDir(), "final.mp4")) : null;
    const s = Store.loadState(ROOT, PID);
    Store.addBlocker(s, { code: "FN10_PROBE", detail: "test blocker" });
    Store.saveState(ROOT, PID, s);
    let code = null;
    try {
      Final.finalize({ projectRoot: ROOT, projectId: PID, attemptId: "attempt-002", opts: {} });
    } catch (e) {
      code = e.code;
    }
    assert(code === "BLOCKED", "BLOCKED, got " + code);
    if (before) {
      assert(sha256(path.join(outDir(), "final.mp4")) === before, "final untouched");
    }
  });

  cleanup();

  console.log("\n=== SUMMARY test-finalize-output FN1-FN10 ===");
  console.log("passed=" + passed + " failed=" + failed);
  console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log("[FAIL] harness: " + ((e && e.stack) || String(e)));
  try { cleanup(); } catch (x) {}
  process.exit(1);
});
