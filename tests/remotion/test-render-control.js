"use strict";
// STEP-13 Branch C — render-control tests RC1-RC10 via the real
// remotion-render-runner (runRender/makeSignal/PROGRESS_THROTTLE_MS) +
// render-orchestrator cancel/resume. One real 3s fixture render + one
// cancelled render. TEST-ONLY, cleaned up. Fails loudly if the render
// environment breaks (no silent skips).

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__13_rc__";
const Builder = require("../../lib/render-input-builder.js");
const Runner = require("../../pipeline/remotion-render-runner.js");
const Store = require("../../pipeline/state-store.js");
const Orch = require("../../pipeline/render-orchestrator.js");
const Lock = require("../../pipeline/pipeline-lock.js");
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
    const v = Math.round(16000 * Math.sin((2 * Math.PI * freqHz * i) / sr));
    data.writeInt16LE(v, i * 2);
  }
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + data.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 2, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}
function lockAbs() { return path.join(projDir(), "pipeline", "lock.json"); }
function cleanup() {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  try { Stager.cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
  try { fs.rmSync(path.join(ROOT, "out", PID), { recursive: true, force: true }); } catch (e) {}
}
function readJsonl(abs) {
  if (!fs.existsSync(abs)) return [];
  return fs.readFileSync(abs, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
}

let inputProps = null;
let startInfo = null;
let fullResult = null;

async function main() {
  cleanup();
  fs.mkdirSync(path.join(projDir(), "assets"), { recursive: true });
  fs.writeFileSync(path.join(projDir(), "assets", "img.png"), Buffer.from(PNG_B64, "base64"));
  fs.writeFileSync(path.join(projDir(), "assets", "voice.wav"), wavBuffer(DUR, 440));
  fs.writeFileSync(path.join(projDir(), "assets", "music.wav"), wavBuffer(1500, 330));
  fs.writeFileSync(path.join(projDir(), "assets", "sfx.wav"), wavBuffer(500, 880));
  wjson("scene-script.json", { platform: "youtube", scenes: [
    { sceneId: "S01", order: 1, narration: "Control line", onScreenText: "Hi",
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
    { captionId: "cap_001", startMs: 100, endMs: DUR - 100, text: "Control line", sceneId: "S01" }
  ]});

  await runTest("RC0 stage assets via real render-plan-cli (exit 0)", async () => {
    const r = child_process.spawnSync("node", ["scripts/cli/render-plan-cli.js", "--project", PID, "--stage-assets"],
      { cwd: ROOT, encoding: "utf8", timeout: 120000 });
    assert(r.status === 0, "exit 0, got " + r.status + " stderr=" + (r.stderr || "").slice(0, 500));
    inputProps = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
    assert(inputProps.status === "READY", "input READY");
  });

  await runTest("RC1 onStart metadata recorded (real 3s render)", async () => {
    const attemptDir = path.join(projDir(), "render", "attempts", "rc-full");
    const handle = Runner.runRender({
      projectRoot: ROOT, projectId: PID, attemptDir: attemptDir, inputProps: inputProps,
      renderConfig: { codec: "h264", concurrency: 2, timeoutMs: 300000, logLevel: "error" },
      onStart: (info) => { startInfo = info; },
      onProgress: () => {}
    });
    fullResult = await handle.promise;
    assert(startInfo && typeof startInfo.frameCount === "number" && startInfo.frameCount > 0,
      "onStart frameCount recorded: " + JSON.stringify(startInfo));
    console.log("  frameCount=" + startInfo.frameCount + " output=" + fullResult.outputPath);
    assert(fs.existsSync(fullResult.outputPath), "output mp4 exists");
  });

  await runTest("RC2 progress.jsonl lines written", async () => {
    const lines = readJsonl(path.join(projDir(), "render", "attempts", "rc-full", "progress.jsonl"));
    assert(lines.length >= 1, "at least one progress line, got " + lines.length);
    console.log("  progress lines=" + lines.length);
  });

  await runTest("RC3 fractions monotonic non-decreasing", async () => {
    const lines = readJsonl(path.join(projDir(), "render", "attempts", "rc-full", "progress.jsonl"));
    const fracs = lines.filter((l) => typeof l.fraction === "number").map((l) => l.fraction);
    assert(fracs.length >= 1, "fractions present");
    for (let i = 1; i < fracs.length; i++) {
      assert(fracs[i] + 1e-9 >= fracs[i - 1], "monotonic at " + i + ": " + fracs[i - 1] + " -> " + fracs[i]);
    }
    assert(fracs[fracs.length - 1] >= 1, "ends at 1");
  });

  await runTest("RC4 progress throttled (line count small)", async () => {
    assert(Runner.PROGRESS_THROTTLE_MS === 1000, "throttle constant 1000ms");
    const lines = readJsonl(path.join(projDir(), "render", "attempts", "rc-full", "progress.jsonl"));
    assert(lines.length < 30, "throttled line count, got " + lines.length);
  });

  await runTest("RC5 real cancel rejects CANCELLED after first progress", async () => {
    const attemptDir = path.join(projDir(), "render", "attempts", "rc-cancel");
    let seen = 0;
    const handle = Runner.runRender({
      projectRoot: ROOT, projectId: PID, attemptDir: attemptDir, inputProps: inputProps,
      renderConfig: { codec: "h264", concurrency: 2, timeoutMs: 300000, logLevel: "error" },
      onProgress: () => {
        seen++;
        if (seen === 1) {
          try { handle.cancelSignal.cancel(); } catch (e) {}
        }
      }
    });
    let err = null;
    try {
      await handle.promise;
    } catch (e) {
      err = e;
    }
    assert(err, "cancelled render must reject (no silent success)");
    assert(err.renderErrorClass === "CANCELLED", "class CANCELLED, got " + (err && err.renderErrorClass));
  });

  await runTest("RC6 cancelled output not accepted (CANCELLED never retryable/passed)", async () => {
    const Classifier = require("../../pipeline/render-error-classifier.js");
    const c = Classifier.classify({ message: "render failed [CANCELLED]: CancelSignal cancelled" });
    assert(c.class === "CANCELLED", "classifier maps cancel");
    assert(c.retryable === false, "cancel never retried");
  });

  await runTest("RC7 cancel state persisted (orchestrator cancelOp, no live renderer)", async () => {
    const prep = await Orch.orchestrate({ projectRoot: ROOT, projectId: PID, op: "prepare", opts: {} });
    assert(prep.ok, "prepare ok");
    const s = Store.loadState(ROOT, PID);
    const plan = JSON.parse(fs.readFileSync(path.join(projDir(), "render", "render-plan.json"), "utf8"));
    Store.addAttempt(s, {
      attemptId: "attempt-001", projectId: PID, number: 1,
      inputFingerprint: s.inputFingerprint, renderPlanHash: plan.planHash,
      startedAt: new Date().toISOString(), status: "RUNNING",
      outputPath: path.join(projDir(), "render", "attempts", "attempt-001", "output.mp4"),
      renderConfig: { codec: "h264", concurrency: 2 }, progress: { fraction: 0.2 }, artifacts: []
    });
    Store.saveState(ROOT, PID, s);
    Store.transition(ROOT, PID, "RENDERING", "RC7_RENDERING");
    const canc = Orch.cancelOp({ projectRoot: ROOT, projectId: PID, opts: { reason: "rc7-test" } });
    assert(canc.ok && canc.cancelled, "cancelOp cancelled: " + JSON.stringify(canc).slice(0, 200));
    const back = Store.loadState(ROOT, PID);
    assert(back.status === "CANCELLED", "state CANCELLED persisted, got " + back.status);
    const a = back.attempts.filter((x) => x.attemptId === "attempt-001")[0];
    assert(a.status === "CANCEL_REQUESTED" || a.status === "CANCELLED",
      "attempt cancel status persisted, got " + a.status);
  });

  await runTest("RC8 second run after cancel does not auto-start (resume CANCELLED)", async () => {
    const res = Orch.resumeOp({ projectRoot: ROOT, projectId: PID, opts: {} });
    assert(res.decision === "CANCELLED", "decision " + res.decision);
    assert(res.autoRender === false, "no auto-render after cancel");
  });

  await runTest("RC9 SIGINT handler path (source wiring + file-only cancel)", async () => {
    const src = fs.readFileSync(path.join(ROOT, "pipeline", "remotion-render-runner.js"), "utf8");
    assert(src.indexOf("SIGINT") !== -1, "runner wires SIGINT");
    assert(src.indexOf("signalHandlers") !== -1, "opt-in signalHandlers flag present");
    const s = Store.loadState(ROOT, PID);
    const a = s.attempts.filter((x) => x.attemptId === "attempt-001")[0];
    assert(a && (a.status === "CANCEL_REQUESTED" || a.status === "CANCELLED"),
      "cancel persisted without any live renderer");
  });

  await runTest("RC10 lock released after cancel", async () => {
    assert(!fs.existsSync(lockAbs()), "no lock file remains after orchestrate+cancel");
    const acq = Lock.acquire(ROOT, PID, "rc10-probe");
    assert(acq.stale === false, "lock acquirable again");
    Lock.release(ROOT, PID);
    assert(!fs.existsSync(lockAbs()), "released cleanly");
  });

  cleanup();

  console.log("\n=== SUMMARY test-render-control RC1-RC10 ===");
  console.log("passed=" + passed + " failed=" + failed);
  console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.log("[FAIL] harness: " + ((e && e.stack) || String(e)));
  try { cleanup(); } catch (x) {}
  console.log("\n=== SUMMARY test-render-control RC1-RC10 ===");
  console.log("passed=" + passed + " failed=" + (failed + 1));
  console.log("RESULT: FAIL");
  process.exit(1);
});
