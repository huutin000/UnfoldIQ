"use strict";
// STEP-13 Branch C — render technical-QA tests QA1-QA12 via qa/technical-qa.js
// (ffmpeg available). Fixture media under projects/__13_qa__/, cleaned up.

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__13_qa__";
const TQ = require("../../qa/technical-qa.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  console.log("[TEST] " + name);
  try {
    fn();
    console.log("[PASS] " + name);
    passed++;
  } catch (e) {
    console.log("[FAIL] " + name + ": " + ((e && e.stack) || (e && e.message) || String(e)));
    failed++;
  }
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
function mediaDir() { return path.join(ROOT, "projects", PID, "media"); }
function media(name) { return path.join(mediaDir(), name); }
function ff(args) {
  const r = child_process.spawnSync("ffmpeg", args, { encoding: "utf8", timeout: 120000 });
  assert(r.status === 0, "ffmpeg " + args.slice(0, 4).join(" ") + " exit 0, stderr=" + (r.stderr || "").slice(-300));
  return r;
}
function att(outAbs, cfg) {
  return {
    attemptId: "attempt-001", projectId: PID, outputPath: outAbs,
    renderConfig: Object.assign({ codec: "h264", concurrency: 2 }, cfg || {})
  };
}
function checkOf(res, name) {
  return (res.checks || []).filter((c) => c.check === name)[0];
}
function cleanup() {
  try { fs.rmSync(path.join(ROOT, "projects", PID), { recursive: true, force: true }); } catch (e) {}
  try { fs.rmSync(path.join(ROOT, "out", PID), { recursive: true, force: true }); } catch (e) {}
}

cleanup();
fs.mkdirSync(mediaDir(), { recursive: true });

runTest("QA1 valid mp4 (2s 640x360 30fps + audio) -> PASS", () => {
  ff(["-y", "-f", "lavfi", "-i", "color=c=0x1a2b3c:s=640x360:r=30:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("valid.mp4")]);
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("valid.mp4"), { expectedWidth: 640, expectedHeight: 360,
      expectedFps: 30, expectedDurationMs: 2000, expectedAudio: true }) });
  assert(res.status === "PASS", "status PASS, got " + res.status + " " + JSON.stringify(res.checks));
  assert(res.reviewState === "MACHINE_CHECKED", "machine review state");
});

runTest("QA2 missing file -> FAIL", () => {
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("nope.mp4"), { expectedDurationMs: 2000 }) });
  assert(res.status === "FAIL", "status FAIL, got " + res.status);
  assert(checkOf(res, "file-exists").result === "FAIL", "file-exists FAIL");
});

runTest("QA3 zero-byte file -> FAIL", () => {
  fs.writeFileSync(media("empty.mp4"), Buffer.alloc(0));
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("empty.mp4"), { expectedDurationMs: 2000 }) });
  assert(res.status === "FAIL", "status FAIL");
  assert(checkOf(res, "non-zero-size").result === "FAIL", "non-zero FAIL");
});

runTest("QA4 audio-only (no video stream) -> FAIL no-video", () => {
  ff(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "aac", media("audio.m4a")]);
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("audio.m4a"), { expectedDurationMs: 2000, expectedAudio: true }) });
  assert(res.status === "FAIL", "status FAIL, got " + res.status);
  assert(checkOf(res, "video-stream").result === "FAIL", "no video stream");
});

runTest("QA5 wrong dims (320x240 vs 640x360) -> FAIL", () => {
  ff(["-y", "-f", "lavfi", "-i", "color=c=0x1a2b3c:s=320x240:r=30:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("small.mp4")]);
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("small.mp4"), { expectedWidth: 640, expectedHeight: 360,
      expectedFps: 30, expectedDurationMs: 2000, expectedAudio: true }) });
  assert(res.status === "FAIL", "status FAIL, got " + res.status);
  assert(checkOf(res, "dims-match").result === "FAIL", "dims FAIL");
});

runTest("QA6 wrong fps (15 vs 30) -> handled, never PASS", () => {
  ff(["-y", "-f", "lavfi", "-i", "color=c=0x1a2b3c:s=640x360:r=15:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", media("fps15.mp4")]);
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("fps15.mp4"), { expectedWidth: 640, expectedHeight: 360,
      expectedFps: 30, expectedDurationMs: 2000, expectedAudio: true }) });
  assert(res.status !== "PASS", "must not PASS, got " + res.status);
  assert(checkOf(res, "fps-match").result !== "PASS", "fps check not PASS");
});

runTest("QA7 duration within tolerance -> PASS", () => {
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("valid.mp4"), { expectedWidth: 640, expectedHeight: 360,
      expectedFps: 30, expectedDurationMs: 2000, expectedAudio: true }) });
  assert(res.duration.result === "PASS", "duration PASS: " + JSON.stringify(res.duration));
  assert(res.status === "PASS", "overall PASS");
});

runTest("QA8 duration outside tolerance -> FAIL", () => {
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("valid.mp4"), { expectedWidth: 640, expectedHeight: 360,
      expectedFps: 30, expectedDurationMs: 10000, expectedAudio: true }) });
  assert(res.duration.result === "FAIL", "duration FAIL: " + JSON.stringify(res.duration));
  assert(res.status === "FAIL", "overall FAIL");
});

runTest("QA9 expected audio but none (video-only) -> FAIL", () => {
  ff(["-y", "-f", "lavfi", "-i", "color=c=0x1a2b3c:s=640x360:r=30:d=2",
    "-pix_fmt", "yuv420p", "-an", media("silent.mp4")]);
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("silent.mp4"), { expectedWidth: 640, expectedHeight: 360,
      expectedFps: 30, expectedDurationMs: 2000, expectedAudio: true }) });
  assert(checkOf(res, "audio-expected").result === "FAIL", "audio FAIL");
  assert(res.status === "FAIL", "overall FAIL");
});

runTest("QA10 no audio expected + none -> PASS", () => {
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("silent.mp4"), { expectedWidth: 640, expectedHeight: 360,
      expectedFps: 30, expectedDurationMs: 2000, expectedAudio: false }) });
  assert(checkOf(res, "audio-expected").result === "PASS", "audio PASS");
  assert(res.status === "PASS", "overall PASS, got " + res.status);
});

runTest("QA11 corrupt file (random bytes) -> FAIL probe", () => {
  const buf = Buffer.alloc(4096);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 37 + 11) % 256;
  fs.writeFileSync(media("corrupt.mp4"), buf);
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("corrupt.mp4"), { expectedDurationMs: 2000 }) });
  assert(res.status === "FAIL", "status FAIL, got " + res.status);
  assert(checkOf(res, "readable-container").result === "FAIL", "container FAIL");
});

runTest("QA12 output/attempt correlation stored (attemptId+outputPath+size)", () => {
  const res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
    attempt: att(media("valid.mp4"), { expectedWidth: 640, expectedHeight: 360,
      expectedFps: 30, expectedDurationMs: 2000, expectedAudio: true }) });
  assert(res.attemptId === "attempt-001", "attemptId recorded");
  assert(res.outputPath === media("valid.mp4"), "outputPath recorded");
  assert(typeof res.sizeBytes === "number" && res.sizeBytes > 0, "sizeBytes recorded");
  assert(checkOf(res, "output-correlation").result === "PASS", "correlation PASS");
});

runTest("QA13 ffprobe unavailable -> UNKNOWN + REVIEW_REQUIRED (never fabricated PASS)", () => {
  const emptyPath = path.join(ROOT, "projects", PID, "empty-bin");
  fs.mkdirSync(emptyPath, { recursive: true });
  const saved = process.env.PATH;
  process.env.PATH = emptyPath;
  let res;
  try {
    res = TQ.runTechnicalQa({ projectRoot: ROOT, projectId: PID,
      attempt: att(media("valid.mp4"), { expectedDurationMs: 2000 }) });
  } finally {
    process.env.PATH = saved;
  }
  const probe = TQ.readProbe(media("valid.mp4"));
  assert(probe.ok, "ffprobe back on PATH");
  assert(res.status === "REVIEW_REQUIRED", "REVIEW_REQUIRED, got " + res.status);
  assert(checkOf(res, "readable-container").result === "UNKNOWN", "container UNKNOWN");
});

cleanup();

console.log("\n=== SUMMARY test-render-qa QA1-QA12 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
