"use strict";
// STEP-13 Branch C — render-retry tests RR1-RR12 via the real classifier +
// render-config (+ orchestrator retry helpers). No renders, no production data.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__13_rr__";
const Classifier = require("../../pipeline/render-error-classifier.js");
const Cfg = require("../../pipeline/render-config.js");
const Orch = require("../../pipeline/render-orchestrator.js");
const Store = require("../../pipeline/state-store.js");
const Cleanup = require("../../pipeline/cleanup.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  console.log("[TEST] " + name);
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      return r.then(() => { console.log("[PASS] " + name); passed++; })
        .catch((e) => { console.log("[FAIL] " + name + ": " + ((e && e.stack) || String(e))); failed++; });
    }
    console.log("[PASS] " + name);
    passed++;
  } catch (e) {
    console.log("[FAIL] " + name + ": " + ((e && e.stack) || (e && e.message) || String(e)));
    failed++;
  }
  return Promise.resolve();
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
function projDir() { return path.join(ROOT, "projects", PID); }
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
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
function setupProject() {
  const DUR = 3000;
  fs.mkdirSync(path.join(projDir(), "assets"), { recursive: true });
  fs.writeFileSync(path.join(projDir(), "assets", "img.png"), Buffer.from(PNG_B64, "base64"));
  fs.writeFileSync(path.join(projDir(), "assets", "voice.wav"), wavBuffer(DUR, 440));
  fs.writeFileSync(path.join(projDir(), "assets", "music.wav"), wavBuffer(1500, 330));
  fs.writeFileSync(path.join(projDir(), "assets", "sfx.wav"), wavBuffer(500, 880));
  wjson("scene-script.json", { platform: "youtube", scenes: [
    { sceneId: "S01", order: 1, narration: "Retry line", onScreenText: "Hi",
      timing: { startMs: 0, endMs: DUR }, purpose: "hook" }
  ]});
  wjson("asset-manifest.json", { assets: [
    { assetId: "IMG01", type: "image", path: "assets/img.png", status: "READY", sceneIds: ["S01"] },
    { assetId: "AUD_V1", type: "voice", path: "assets/voice.wav", status: "READY", durationMs: DUR },
    { assetId: "AUD_M1", type: "music", path: "assets/music.wav", status: "READY", durationMs: 1500 },
    { assetId: "AUD_S1", type: "sfx", path: "assets/sfx.wav", status: "READY", durationMs: 500 }
  ]});
  wjson("preflight/media-preflight.json", { status: "READY", version: "1.0.0", blockingIssues: [],
    warnings: [], timelineSummary: { missingRequired: 0 },
    assets: [{ assetId: "IMG01", type: "image", sceneId: "S01", rightsStatus: "CLEAR", required: true }] });
  wjson("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: DUR,
    sources: ["voice-measured:wav-header"] });
  wjson("audio/audio-mix-plan.json", { tracks: {
    voice: [{ clipId: "clip_v01", path: "assets/voice.wav", fromMs: 0, trimStartMs: 0, trimEndMs: DUR,
      timingStatus: "MEASURED", gainDb: 0, fadeInMs: 50, fadeOutMs: 150, loop: false }],
    music: [{ clipId: "clip_m01", path: "assets/music.wav", fromMs: 0, trimStartMs: 0, trimEndMs: 1500,
      gainDb: -12, fadeInMs: 100, fadeOutMs: 200, loop: false }],
    sfx: [{ clipId: "clip_s01", path: "assets/sfx.wav", fromMs: 1000, trimStartMs: 0,
      trimEndMs: 500, gainDb: -6, fadeInMs: 10, fadeOutMs: 100, loop: false }]
  }});
  wjson("captions/captions.json", { mode: "BOTH", items: [
    { captionId: "cap_001", startMs: 100, endMs: DUR - 100, text: "Retry line", sceneId: "S01" }
  ]});
}
function cleanup() {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  try {
    const Stager = require("../../lib/asset-stager.js");
    Stager.cleanStale({ projectRoot: ROOT, projectId: PID });
  } catch (e) {}
  try { fs.rmSync(path.join(ROOT, "out", PID), { recursive: true, force: true }); } catch (e) {}
}

async function main() {
  cleanup();

  await runTest("RR1 TARGET_CLOSED retryable", () => {
    const c = Classifier.classify(new Error("Target closed while rendering frames"));
    assert(c.class === "TARGET_CLOSED", "class " + c.class);
    assert(c.retryable === true, "retryable");
    assert(Classifier.CLASSES.indexOf("TARGET_CLOSED") !== -1, "in CLASSES");
  });

  await runTest("RR2 CHROME_CRASH retryable", () => {
    const c = Classifier.classify(new Error("Chrome crash: browser disconnected"));
    assert(c.class === "CHROME_CRASH", "class " + c.class);
    assert(c.retryable === true, "retryable");
  });

  await runTest("RR3 OOM retryable", () => {
    const c = Classifier.classify(new Error("JavaScript heap out of memory"));
    assert(c.class === "OUT_OF_MEMORY", "class " + c.class);
    assert(c.retryable === true, "retryable");
  });

  await runTest("RR4 ASSET_MISSING + UNKNOWN classes", () => {
    const a = Classifier.classify({ code: "ENOENT", message: "ENOENT: no such file, open 'unfoldiq/x/img.png'" });
    assert(a.class === "ASSET_MISSING", "class " + a.class);
    assert(a.retryable === false, "asset missing never blind-retried");
    const u = Classifier.classify(new Error("something completely unrecognized happened here xyz"));
    assert(u.class === "UNKNOWN", "class " + u.class);
    assert(u.retryable === false, "unknown not retried");
    // Remotion aborts failed asset loads as CancelledError: the 404/image
    // signature must win over the error name (else terminal, no fix path).
    const abort = new Error("Error loading image with src: http://localhost:3000/public/x/img.png");
    abort.name = "CancelledError";
    const ab = Classifier.classify(abort);
    assert(ab.class === "ASSET_MISSING", "asset abort classified, got " + ab.class);
    assert(ab.retryable === false, "not blind-retried");
  });

  await runTest("RR5 resource failure lowers concurrency (halves)", () => {
    const base = Cfg.resolveConfig({ concurrency: 4 });
    const lowered = Cfg.lowerConcurrencyForRetry(base, "TARGET_CLOSED");
    assert(lowered.config.concurrency === 2, "4 -> 2, got " + lowered.config.concurrency);
    assert(typeof lowered.note === "string" && lowered.note.length > 0, "note recorded");
    const same = Cfg.lowerConcurrencyForRetry(base, "UNKNOWN");
    assert(same.config.concurrency === 4, "non-pressure class unchanged");
  });

  await runTest("RR6 asset missing -> retry policy says no blind retry", () => {
    const c = Classifier.classify(new Error("asset_stage_failed for IMG01 source missing"));
    assert(c.class === "ASSET_MISSING", "class " + c.class);
    assert(c.retryable === false, "retryable false: fix the asset first, never blind-retry");
  });

  await runTest("RR7 max attempts enforced (3 recorded -> 4th refused, no render)", async () => {
    // Real prepared project so renderOp reaches the attempt-count gate
    // (instead of prepare): 3 recorded attempts -> 4th refused pre-render.
    setupProject();
    const prep = await Orch.prepareOp({ projectRoot: ROOT, projectId: PID, opts: {} });
    assert(prep.ok, "prepare ok");
    assert(Cfg.RENDER_RETRY_POLICY.maxTotalAttempts === 3, "policy maxTotalAttempts===3");
    const s = Store.loadState(ROOT, PID);
    const plan = JSON.parse(fs.readFileSync(path.join(projDir(), "render", "render-plan.json"), "utf8"));
    for (let i = 1; i <= 3; i++) {
      Store.addAttempt(s, {
        attemptId: "attempt-00" + i, projectId: PID, number: i,
        inputFingerprint: s.inputFingerprint, renderPlanHash: plan.planHash,
        startedAt: new Date().toISOString(), status: "FAILED",
        outputPath: path.join(projDir(), "render", "attempts", "attempt-00" + i, "output.mp4"),
        renderConfig: { codec: "h264", concurrency: 2 }, progress: { fraction: 0 }, artifacts: []
      });
    }
    Store.saveState(ROOT, PID, s);
    const res = await Orch.renderOp({ projectRoot: ROOT, projectId: PID, opts: {} });
    assert(res.reason === "MAX_ATTEMPTS" || /MAX_ATTEMPTS/.test(JSON.stringify(res)),
      "4th refused: " + JSON.stringify(res).slice(0, 200));
    const back = Store.loadState(ROOT, PID);
    assert(back.attempts.length === 3, "still 3 attempts, got " + back.attempts.length);
    assert(!fs.existsSync(path.join(projDir(), "render", "attempts", "attempt-004")),
      "no attempt-004 dir created (refused before rendering)");
  });

  await runTest("RR8 each retry is a new dir (attempt-001/002 distinct)", () => {
    const s = Store.loadState(ROOT, PID);
    const dirs = s.attempts.map((a) => String(a.outputPath).split(path.sep).join("/"));
    assert(dirs[0] !== dirs[1], "distinct output paths: " + dirs[0] + " vs " + dirs[1]);
    assert(/attempt-001/.test(dirs[0]) && /attempt-002/.test(dirs[1]), "attempt-NNN scheme");
  });

  await runTest("RR9 old evidence preserved (cleanup never touches attempts)", () => {
    const attFile = path.join(projDir(), "render", "attempts", "attempt-001", "evidence.txt");
    fs.mkdirSync(path.dirname(attFile), { recursive: true });
    fs.writeFileSync(attFile, "attempt evidence");
    const tmpDir = path.join(projDir(), "render", "tmp");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "scratch.bin"), "tmp");
    const res = Cleanup.cleanManaged({ projectRoot: ROOT, projectId: PID });
    assert(fs.existsSync(attFile), "attempt evidence retained");
    assert(!fs.existsSync(path.join(tmpDir, "scratch.bin")), "temp cleaned");
    void res;
  });

  await runTest("RR10 Remotion frame retry is not a pipeline attempt (single dir per run)", () => {
    const src = fs.readFileSync(path.join(ROOT, "pipeline", "remotion-render-runner.js"), "utf8");
    assert(src.indexOf("attempt-") === -1, "runner never mints attempt dirs (no 'attempt-' in source)");
    assert(src.indexOf("progress.jsonl") !== -1, "single progress file per attemptDir");
  });

  await runTest("RR11 cancellation is not retried", () => {
    const c = Classifier.classify(new Error("render cancelled via CancelSignal"));
    assert(c.class === "CANCELLED", "class " + c.class);
    assert(c.retryable === false, "cancel never retried");
  });

  await runTest("RR12 no provider generation in retry path (source scan)", () => {
    const re = /openai|veo|elevenlabs|kokoro|comfyui/i;
    ["pipeline/render-orchestrator.js", "pipeline/remotion-render-runner.js",
     "pipeline/render-error-classifier.js", "pipeline/render-config.js"].forEach((rel) => {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      assert(!re.test(src), "no provider tokens in " + rel);
    });
  });

  cleanup();

  console.log("\n=== SUMMARY test-render-retry RR1-RR12 ===");
  console.log("passed=" + passed + " failed=" + failed);
  console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log("[FAIL] harness: " + ((e && e.stack) || String(e)));
  try { cleanup(); } catch (x) {}
  process.exit(1);
});
