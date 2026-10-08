"use strict";
// tests/perf/test-longform-5c.js — Phase 5C Tasks J/K: representative
// long-form fixture + local benchmarks. Deterministic lavfi visuals
// (video scenes + stills + grid-diagram stand-in), sine voice stubs,
// caption docs, audio-mix plan. Durations: 150s reference (5B pilot, cited),
// 10min measured, 20min measured if feasible, 30min estimated from validated
// scaling. Resumable per duration under out/longform-5c/.

const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__5c_long__";
require("../fixtures/render-fixture-lifecycle.js").registerFixtureCleanup(PID);
const OUT_DIR = path.join(ROOT, "out", "longform-5c");
const EVID_DIR = path.join(ROOT, "Report", "evidence", "perf-5c");

const incRender = require("../../pipeline/incremental-render.js");
const Builder = require("../../lib/render-input-builder.js");
const Stager = require("../../lib/asset-stager.js");

const FPS = 30;
const SCENE_S = 30;
const VISUALS = ["testsrc2", "yuvtestsrc", "testsrc", "rgbtestsrc"];
const CONCURRENCY = 4; // 5C-E selected default (small-scale); re-check recorded here

let passed = 0;
let failed = 0;
function stamp(m) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`); }
async function runTest(name, fn) {
  stamp("START " + name);
  try { await fn(); passed++; console.log("[PASS] " + name); }
  catch (e) { failed++; console.log("[FAIL] " + name + ": " + ((e && e.message) || e)); }
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
function sh(cmd, args, timeout) {
  return childProcess.spawnSync(cmd, args, { encoding: "utf8", timeout: timeout || 590000, maxBuffer: 64 * 1024 * 1024, cwd: ROOT });
}
function projDir() { return path.join(ROOT, "projects", PID); }
function wjson(rel, obj) {
  const abs = path.join(projDir(), rel.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
}

function buildFixture(nScenes) {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  const dir = path.join(projDir(), "assets");
  fs.mkdirSync(dir, { recursive: true });
  const scenes = [];
  for (let i = 0; i < nScenes; i++) {
    const kind = i % 5 === 4 ? "IMAGE" : (i % 7 === 6 ? "CHART" : "VIDEO");
    scenes.push({ sceneId: `L${String(i + 1).padStart(2, "0")}`, startMs: i * SCENE_S * 1000, endMs: (i + 1) * SCENE_S * 1000, kind, visual: VISUALS[i % VISUALS.length], text: `Long-form section ${i + 1}` });
  }
  for (const s of scenes) {
    if (s.kind === "IMAGE") {
      assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x14202e:s=1920x1080:d=0.1", "-frames:v", "1", path.join(dir, `${s.sceneId}.png`)]).status === 0, "still ok " + s.sceneId);
    } else if (s.kind === "CHART") {
      assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x0e1a24:s=1920x1080:d=0.1,drawgrid=w=120:h=120:t=2:c=0x2e4a5e", "-frames:v", "1", path.join(dir, `${s.sceneId}.png`)]).status === 0, "chart ok " + s.sceneId);
    } else {
      assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", `${s.visual}=s=1920x1080:r=30:d=${SCENE_S}`, "-pix_fmt", "yuv420p", path.join(dir, `${s.sceneId}.mp4`)]).status === 0, "clip ok " + s.sceneId);
    }
    assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-ar", "48000", "-ac", "2", path.join(dir, `${s.sceneId}-voice.wav`)]).status === 0, "voice ok " + s.sceneId);
  }
  wjson("scene-script.json", { platform: "youtube", scenes: scenes.map((s, i) => ({ sceneId: s.sceneId, order: i + 1, narration: s.text, onScreenText: s.text, timing: { startMs: s.startMs, endMs: s.endMs }, purpose: "longform-bench" })) });
  const vAssets = scenes.map((s) => s.kind === "VIDEO"
    ? { assetId: `as-${s.sceneId}`, type: "video", path: `assets/${s.sceneId}.mp4`, status: "READY", sceneIds: [s.sceneId], width: 1920, height: 1080, durationMs: SCENE_S * 1000 }
    : { assetId: `as-${s.sceneId}`, type: "image", path: `assets/${s.sceneId}.png`, status: "READY", sceneIds: [s.sceneId], width: 1920, height: 1080 });
  const aAssets = scenes.map((s) => ({ assetId: `AUD_${s.sceneId}`, type: "voice", path: `assets/${s.sceneId}-voice.wav`, status: "READY", durationMs: 5000 }));
  wjson("asset-manifest.json", { assets: [...vAssets, ...aAssets] });
  wjson("preflight/media-preflight.json", { status: "READY", version: "1.0.0", blockingIssues: [], warnings: [],
    assets: vAssets.map((a) => ({ assetId: a.assetId, type: a.type, sceneId: a.sceneIds[0], rightsStatus: "CLEAR", required: true })) });
  const totalMs = nScenes * SCENE_S * 1000;
  wjson("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: totalMs, sources: ["bench"] });
  wjson("audio/audio-mix-plan.json", { tracks: { voice: scenes.map((s) => ({ clipId: `clip_${s.sceneId}`, path: `assets/${s.sceneId}-voice.wav`, fromMs: s.startMs, trimStartMs: 0, trimEndMs: 5000, timingStatus: "MEASURED", gainDb: 0, fadeInMs: 50, fadeOutMs: 150, loop: false })) }, generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO" });
  const stageList = [];
  for (const s of scenes) {
    stageList.push(s.kind === "VIDEO"
      ? { assetId: `as-${s.sceneId}`, sourcePath: `assets/${s.sceneId}.mp4`, type: "video" }
      : { assetId: `as-${s.sceneId}`, sourcePath: `assets/${s.sceneId}.png`, type: "image" });
    stageList.push({ assetId: `AUD_${s.sceneId}`, sourcePath: `assets/${s.sceneId}-voice.wav`, type: "audio" });
  }
  const entries = Stager.stageAssets({ projectRoot: ROOT, projectId: PID, assets: stageList });
  fs.mkdirSync(path.join(projDir(), "render"), { recursive: true });
  fs.writeFileSync(path.join(projDir(), "render", "staging-manifest.json"), JSON.stringify({ version: "1.0.0", projectId: PID, entries }, null, 1));
  return { scenes, totalMs, totalFrames: (totalMs / 1000) * FPS };
}

async function renderDuration(label, nScenes, ev) {
  const out = path.join(OUT_DIR, `longform-${label}.mp4`);
  const { totalFrames } = buildFixture(nScenes);
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
  const b = await incRender.bundleOnce(ROOT);
  const comp = await incRender.selectComposition(b.libs, b.serveUrl, "UNFOLDIQVideo", input);
  assert(comp.durationInFrames === totalFrames, `${label}: ${totalFrames} frames, got ${comp.durationInFrames}`);
  let rssPeak = 0;
  const probe = setInterval(() => { rssPeak = Math.max(rssPeak, process.memoryUsage().rss); }, 2000);
  const t0 = Date.now();
  await b.libs.renderer.renderMedia({
    codec: "h264", pixelFormat: "yuv420p", composition: comp, serveUrl: b.serveUrl,
    inputProps: input, outputLocation: out, concurrency: CONCURRENCY, muted: true,
  });
  const wallMs = Date.now() - t0;
  clearInterval(probe);
  const pr = incRender.probeChunk(out);
  const durS = pr.format.duration;
  assert(Math.abs(durS - totalFrames / FPS) < 2, `${label}: duration ~${totalFrames / FPS}s, got ${durS}`);
  const rec = { label, scenes: nScenes, totalFrames, wallMs, fps: totalFrames / (wallMs / 1000),
    rssPeakMB: Math.round(rssPeak / 1048576), outputBytes: fs.statSync(out).size,
    outputDurationS: durS, concurrency: CONCURRENCY, width: comp.width, height: comp.height };
  ev.measured.push(rec);
  stamp(`${label}: wall=${(wallMs / 1000).toFixed(0)}s fps=${rec.fps.toFixed(1)} rssPeak=${rec.rssPeakMB}MB bytes=${rec.outputBytes}`);
  return rec;
}

(async () => {
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(EVID_DIR, { recursive: true });
const ev = { version: "1.0.0", phase: "5C-JK", fixture: "mixed video/still/grid-chart scenes + sine voice stubs, 1920x1080@30", concurrency: CONCURRENCY,
  reference150s: { source: "5B pilot (test-pilot-repair + Task A)", fullReferenceMs: 213800, note: "5B-measured V1 oracle wall; same 150s/4500f scale" }, measured: [] };

const only = process.env.LONGFORM_ONLY || null; // e.g. LONGFORM_ONLY=10min to run one class
if (!only || only === "10min") {
  await runTest("10-min representative render (20x30s)", async () => {
    if (fs.existsSync(path.join(OUT_DIR, "longform-10min.mp4")) && !process.env.LONGFORM_FORCE) {
      stamp("10min resume: output present, skipping render (LONGFORM_FORCE=1 to redo)");
      return;
    }
    await renderDuration("10min", 20, ev);
  });
}
if (!only || only === "20min") {
  await runTest("20-min representative render (40x30s)", async () => {
    if (fs.existsSync(path.join(OUT_DIR, "longform-20min.mp4")) && !process.env.LONGFORM_FORCE) {
      stamp("20min resume: output present, skipping render (LONGFORM_FORCE=1 to redo)");
      return;
    }
    await renderDuration("20min", 40, ev);
  });
}

const prevPath = path.join(EVID_DIR, "longform-benchmark.json");
let prev = { measured: [] };
try { prev = JSON.parse(fs.readFileSync(prevPath, "utf8")); } catch (e) {}
const merged = prev.measured.filter((m) => !ev.measured.find((x) => x.label === m.label)).concat(ev.measured);
ev.measured = merged;
if (ev.measured.length > 0) fs.writeFileSync(prevPath, JSON.stringify(ev, null, 1));
console.log("\n=== longform-5c: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
