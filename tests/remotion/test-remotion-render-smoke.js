"use strict";
// STEP-12 Branch C — remotion render smoke test (timeout budget 600000ms).
// Builds TEST-ONLY project projects/__12_smoke__/, stages, validates,
// render-tests to <Temp>/step12-smoke.mp4, ffprobes, then cleans up.

const fs = require("fs");
const os = require("os");
const path = require("path");
const child_process = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__12_smoke__";
const Builder = require("../../lib/render-input-builder.js");
const Stager = require("../../lib/asset-stager.js");

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const OUT_MP4 = path.join(os.tmpdir(), "step12-smoke.mp4");

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
function cleanup() {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  try { Stager.cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
  try { if (fs.existsSync(OUT_MP4)) fs.rmSync(OUT_MP4, { force: true }); } catch (e) {}
}

let HAS_VIDEO = false;
let EXPECT_MS = 8000;

runTest("SMOKE setup TEST-ONLY project (ffmpeg-guarded video)", () => {
  cleanup();
  fs.mkdirSync(projDir(), { recursive: true });
  fs.mkdirSync(path.join(projDir(), "assets"), { recursive: true });
  fs.writeFileSync(path.join(projDir(), "assets", "img.png"), Buffer.from(PNG_B64, "base64"));
  fs.writeFileSync(path.join(projDir(), "assets", "voice.wav"), wavBuffer(4000, 440));
  fs.writeFileSync(path.join(projDir(), "assets", "music.wav"), wavBuffer(2000, 330));
  fs.writeFileSync(path.join(projDir(), "assets", "sfx.wav"), wavBuffer(500, 880));
  // Video MP4 via ffmpeg lavfi color source (guarded).
  let ok = false;
  try {
    const r = child_process.spawnSync("ffmpeg",
      ["-y", "-f", "lavfi", "-i", "color=c=0x1a2b3c:s=640x360:r=30:d=4", "-pix_fmt", "yuv420p",
        path.join(projDir(), "assets", "clip.mp4")],
      { encoding: "utf8", timeout: 120000 });
    ok = r.status === 0 && fs.existsSync(path.join(projDir(), "assets", "clip.mp4"));
    if (!ok) console.log("  ffmpeg stderr tail: " + ((r.stderr || "").slice(-500)));
  } catch (e) {
    console.log("  ffmpeg spawn failed: " + (e && e.message));
    ok = false;
  }
  HAS_VIDEO = ok;
  if (!HAS_VIDEO) {
    console.log("  video scene NOT_AVAILABLE (ffmpeg missing/failed) — continuing without video; static architecture tests still cover video layer");
    EXPECT_MS = 4000;
    wjson("scene-script.json", { platform: "youtube", scenes: [
      { sceneId: "S01", order: 1, narration: "Smoke narration line", onScreenText: "Smoke",
        timing: { startMs: 0, endMs: 4000 }, purpose: "hook" }
    ]});
    wjson("asset-manifest.json", { assets: [
      { assetId: "IMG01", type: "image", path: "assets/img.png", status: "READY", sceneIds: ["S01"], width: 64, height: 64 },
      { assetId: "AUD_V1", type: "voice", path: "assets/voice.wav", status: "READY", durationMs: 4000 },
      { assetId: "AUD_M1", type: "music", path: "assets/music.wav", status: "READY", durationMs: 2000 },
      { assetId: "AUD_S1", type: "sfx", path: "assets/sfx.wav", status: "READY", durationMs: 500 }
    ]});
  } else {
    wjson("scene-script.json", { platform: "youtube", scenes: [
      { sceneId: "S01", order: 1, narration: "Smoke narration line", onScreenText: "Smoke",
        timing: { startMs: 0, endMs: 4000 }, purpose: "hook" },
      { sceneId: "S02", order: 2, timing: { startMs: 4000, endMs: 8000 }, purpose: "evidence" }
    ]});
    wjson("asset-manifest.json", { assets: [
      { assetId: "IMG01", type: "image", path: "assets/img.png", status: "READY", sceneIds: ["S01"], width: 64, height: 64 },
      { assetId: "VID01", type: "video", path: "assets/clip.mp4", status: "READY", sceneIds: ["S02"], width: 640, height: 360, durationMs: 4000 },
      { assetId: "AUD_V1", type: "voice", path: "assets/voice.wav", status: "READY", durationMs: 4000 },
      { assetId: "AUD_M1", type: "music", path: "assets/music.wav", status: "READY", durationMs: 2000 },
      { assetId: "AUD_S1", type: "sfx", path: "assets/sfx.wav", status: "READY", durationMs: 500 }
    ]});
  }
  wjson("preflight/media-preflight.json", { status: "READY", version: "1.0.0", blockingIssues: [],
    warnings: [], timelineSummary: { missingRequired: 0 },
    assets: HAS_VIDEO
      ? [{ assetId: "IMG01", type: "image", sceneId: "S01", rightsStatus: "CLEAR", required: true },
         { assetId: "VID01", type: "video", sceneId: "S02", rightsStatus: "CLEAR", required: true }]
      : [{ assetId: "IMG01", type: "image", sceneId: "S01", rightsStatus: "CLEAR", required: true }] });
  wjson("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: EXPECT_MS,
    sources: ["voice-measured:wav-header", "visual-planned:scene-script"] });
  wjson("audio/audio-mix-plan.json", { tracks: {
    voice: [{ clipId: "clip_v01", path: "assets/voice.wav", fromMs: 0, trimStartMs: 0, trimEndMs: 4000,
      timingStatus: "MEASURED", gainDb: 0, fadeInMs: 50, fadeOutMs: 150, loop: false }],
    music: [{ clipId: "clip_m01", path: "assets/music.wav", fromMs: 0, trimStartMs: 0, trimEndMs: 2000,
      gainDb: -12, fadeInMs: 100, fadeOutMs: 200, loop: false,
      ducking: { enabled: true, targetAudioId: "clip_v01", reductionDb: -6, ranges: [{ startMs: 0, endMs: 2000 }] } }],
    sfx: [{ clipId: "clip_s01", path: "assets/sfx.wav", fromMs: HAS_VIDEO ? 4000 : 1000, trimStartMs: 0,
      trimEndMs: 500, gainDb: -6, fadeInMs: 10, fadeOutMs: 100, loop: false }]
  }, generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO" });
  wjson("captions/captions.json", { mode: "BOTH", items: HAS_VIDEO ? [
    { captionId: "cap_001", startMs: 100, endMs: 3900, text: "Smoke line one", sceneId: "S01" },
    { captionId: "cap_002", startMs: 4100, endMs: 7900, text: "Smoke line two", sceneId: "S02" }
  ] : [
    { captionId: "cap_001", startMs: 100, endMs: 3900, text: "Smoke line one", sceneId: "S01" }
  ]});
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
  assert(input.status === "READY", "smoke input READY");
  assert(JSON.stringify(input).indexOf("http://") === -1 && JSON.stringify(input).indexOf("https://") === -1,
    "no provider network: render input has no http URLs");
  console.log("  HAS_VIDEO=" + HAS_VIDEO + " EXPECT_MS=" + EXPECT_MS);
});

runTest("SMOKE stage via render-plan-cli --stage-assets (exit 0)", () => {
  const r = child_process.spawnSync("node", ["scripts/cli/render-plan-cli.js", "--project", PID, "--stage-assets"],
    { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  assert(r.status === 0, "exit 0, got " + r.status + " stderr=" + (r.stderr || "").slice(0, 500));
});

runTest("SMOKE validate via remotion-render-cli --validate (exit 0)", () => {
  const r = child_process.spawnSync("node", ["scripts/cli/remotion-render-cli.js", "--project", PID, "--validate"],
    { cwd: ROOT, encoding: "utf8", timeout: 120000 });
  assert(r.status === 0, "exit 0, got " + r.status + " stderr=" + (r.stderr || "").slice(0, 500));
});

runTest("SMOKE render-test to mp4 (budget 8min)", () => {
  try { if (fs.existsSync(OUT_MP4)) fs.rmSync(OUT_MP4, { force: true }); } catch (e) {}
  const r = child_process.spawnSync("node",
    ["scripts/cli/remotion-render-cli.js", "--project", PID, "--render-test", "--out", OUT_MP4],
    { cwd: ROOT, encoding: "utf8", timeout: 480000, maxBuffer: 64 * 1024 * 1024 });
  console.log("  render exit=" + r.status + " stdout tail=" + (r.stdout || "").slice(-300));
  if (r.status !== 0) console.log("  render stderr tail=" + (r.stderr || "").slice(-2000));
  assert(r.status === 0, "render-test exit 0, got " + r.status);
  assert(fs.existsSync(OUT_MP4), "mp4 exists");
  const st = fs.statSync(OUT_MP4);
  console.log("  mp4 size=" + st.size + " bytes");
  assert(st.size > 0, "mp4 size>0");
});

runTest("SMOKE ffprobe streams/duration/size", () => {
  const r = child_process.spawnSync("ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height",
     "-show_entries", "format=duration,size", "-of", "json", OUT_MP4],
    { encoding: "utf8", timeout: 60000 });
  assert(r.status === 0, "ffprobe exit 0");
  const j = JSON.parse(r.stdout);
  const types = (j.streams || []).map((s) => s.codec_type);
  assert(types.indexOf("video") !== -1, "video stream present");
  assert(types.indexOf("audio") !== -1, "audio stream present");
  const v = (j.streams || []).filter((s) => s.codec_type === "video")[0];
  // Adapted: output canvas follows the youtube platform profile
  // (1920x1080); the 640x360 source clip is scaled to cover. Assert the
  // stream matches the composition canvas + audio present.
  if (HAS_VIDEO) assert(v.width === 1920 && v.height === 1080, "video 1920x1080 canvas, got " + v.width + "x" + v.height);
  const dur = parseFloat(j.format.duration);
  const expectS = EXPECT_MS / 1000;
  assert(Math.abs(dur - expectS) <= 0.6, "duration " + expectS + "s +-0.6, got " + dur);
  assert(parseInt(j.format.size, 10) > 0, "size>0");
  console.log("  duration=" + dur + "s size=" + j.format.size);
});

runTest("SMOKE cleanup removes project, staged dir, mp4", () => {
  const size = fs.existsSync(OUT_MP4) ? fs.statSync(OUT_MP4).size : -1;
  console.log("  mp4 size before delete=" + size);
  cleanup();
  assert(!fs.existsSync(projDir()), "project removed");
  assert(!fs.existsSync(path.resolve(ROOT, "remotion", "public", "unfoldiq", PID)), "staged dir removed");
  assert(!fs.existsSync(OUT_MP4), "mp4 deleted");
});

console.log("\n=== SUMMARY test-remotion-render-smoke ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
