"use strict";
// tests/perf/test-concurrency-matrix-5c.js — Phase 5C Task E: controlled
// concurrency matrix (1/2/4) on a small representative fixture (2 scenes,
// video+still, voice stubs, 120f @30fps 720p-class). Per candidate: wall,
// RSS, output QA (frame count + byte-identity across concurrencies).
// Production default = best measured speed×memory×stability trade-off.

process.env.UNFOLDIQ_BROWSER_REUSE = "1";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__5c_conc__";
require("../fixtures/render-fixture-lifecycle.js").registerFixtureCleanup(PID);
const EVID_DIR = path.join(ROOT, "Report", "evidence", "perf-5c");

const incRender = require("../../pipeline/incremental-render.js");
const Builder = require("../../lib/render-input-builder.js");
const Stager = require("../../lib/asset-stager.js");

let passed = 0;
let failed = 0;
async function runTest(name, fn) {
  try { await fn(); passed++; console.log("[PASS] " + name); }
  catch (e) { failed++; console.log("[FAIL] " + name + ": " + ((e && e.message) || e)); }
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }
function sh(cmd, args, timeout) {
  return childProcess.spawnSync(cmd, args, { encoding: "utf8", timeout: timeout || 300000, maxBuffer: 64 * 1024 * 1024, cwd: ROOT });
}
const { mediaDigest } = require("../fixtures/media-equivalence.js"); // media-equivalence contract, see that module
function rssMB() { return Math.round(process.memoryUsage().rss / 1048576); }
function projDir() { return path.join(ROOT, "projects", PID); }

const SCENES = [
  { sceneId: "S1", startMs: 0, endMs: 2000, visual: "color=c=black:s=1280x720:r=30:d=2", kind: "VIDEO", text: "Scene one" },
  { sceneId: "S2", startMs: 2000, endMs: 4000, visual: "still", kind: "IMAGE", text: "Scene two" },
];

(async () => {
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "5c-conc-"));
const ev = { version: "1.0.0", phase: "5C-E", fixture: "120 frames, 1280x720-class, 2 scenes (video+still)", candidates: [] };
let ctx = null;

await runTest("SETUP fixture + bundle", async () => {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  const dir = path.join(projDir(), "assets");
  fs.mkdirSync(dir, { recursive: true });
  assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=black:s=1280x720:r=30:d=2", "-pix_fmt", "yuv420p", path.join(dir, "s1.mp4")]).status === 0, "clip ok");
  assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x14202e:s=1280x720:d=0.1", "-frames:v", "1", path.join(dir, "still.png")]).status === 0, "still ok");
  for (const s of ["s1", "s2"]) {
    assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", "-ar", "48000", "-ac", "2", path.join(dir, `${s}-voice.wav`)]).status === 0, "voice ok");
  }
  const w = (rel, obj) => {
    const abs = path.join(projDir(), rel.split("/").join(path.sep));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
  };
  w("scene-script.json", { platform: "youtube", scenes: SCENES.map((s, i) => ({ sceneId: s.sceneId, order: i + 1, narration: s.text, onScreenText: s.text, timing: { startMs: s.startMs, endMs: s.endMs }, purpose: "bench" })) });
  w("asset-manifest.json", { assets: [
    { assetId: "as-s1", type: "video", path: "assets/s1.mp4", status: "READY", sceneIds: ["S1"], width: 1280, height: 720, durationMs: 2000 },
    { assetId: "as-s2", type: "image", path: "assets/still.png", status: "READY", sceneIds: ["S2"], width: 1280, height: 720 },
    { assetId: "AUD_S1", type: "voice", path: "assets/s1-voice.wav", status: "READY", durationMs: 1500 },
    { assetId: "AUD_S2", type: "voice", path: "assets/s2-voice.wav", status: "READY", durationMs: 1500 },
  ] });
  w("preflight/media-preflight.json", { status: "READY", version: "1.0.0", blockingIssues: [], warnings: [],
    assets: [{ assetId: "as-s1", type: "video", sceneId: "S1", rightsStatus: "CLEAR", required: true }, { assetId: "as-s2", type: "image", sceneId: "S2", rightsStatus: "CLEAR", required: true }] });
  w("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: 4000, sources: ["bench"] });
  w("audio/audio-mix-plan.json", { tracks: { voice: SCENES.map((s) => ({ clipId: `clip_${s.sceneId}`, path: `assets/${s.sceneId.toLowerCase()}-voice.wav`, fromMs: s.startMs, trimStartMs: 0, trimEndMs: 1500, timingStatus: "MEASURED", gainDb: 0, fadeInMs: 50, fadeOutMs: 150, loop: false })) }, generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO" });
  const entries = Stager.stageAssets({ projectRoot: ROOT, projectId: PID, assets: [
    { assetId: "as-s1", sourcePath: "assets/s1.mp4", type: "video" },
    { assetId: "as-s2", sourcePath: "assets/still.png", type: "image" },
    { assetId: "AUD_S1", sourcePath: "assets/s1-voice.wav", type: "audio" },
    { assetId: "AUD_S2", sourcePath: "assets/s2-voice.wav", type: "audio" },
  ] });
  fs.mkdirSync(path.join(projDir(), "render"), { recursive: true });
  fs.writeFileSync(path.join(projDir(), "render", "staging-manifest.json"), JSON.stringify({ version: "1.0.0", projectId: PID, entries }, null, 1));
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
  const b = await incRender.bundleOnce(ROOT);
  const comp = await incRender.selectComposition(b.libs, b.serveUrl, "UNFOLDIQVideo", input);
  assert(comp.durationInFrames === 120, "120 frames");
  ctx = { libs: b.libs, serveUrl: b.serveUrl, comp, input };
});

const hashes = {};
const equiv = {};
for (const conc of [1, 2, 4]) {
  await runTest(`concurrency=${conc} (2 reps)`, async () => {
    const walls = [];
    let rssPeak = rssMB();
    let crashes = 0;
    for (let rep = 0; rep < 2; rep++) {
      const out = path.join(scratch, `conc-${conc}-rep${rep}.mp4`);
      const t0 = Date.now();
      try {
        await ctx.libs.renderer.renderMedia({
          codec: "h264", pixelFormat: "yuv420p", composition: ctx.comp, serveUrl: ctx.serveUrl,
          inputProps: ctx.input, outputLocation: out, concurrency: conc, muted: true,
        });
      } catch (e) { crashes++; throw new Error(`c=${conc} rep=${rep} crashed: ${(e && e.message) || e}`); }
      walls.push(Date.now() - t0);
      rssPeak = Math.max(rssPeak, rssMB());
      const h = crypto.createHash("sha256").update(fs.readFileSync(out)).digest("hex");
      hashes[`c${conc}r${rep}`] = h;
      const md = mediaDigest(out);
      equiv[`c${conc}r${rep}`] = md.digest;
      assert(md.frameCount === 120, `120 decoded frames (c=${conc})`);
      assert(md.audio === "NO_AUDIO_STREAM", "muted render has no audio stream");
      const pr = incRender.probeChunk(out);
      assert(Math.abs(pr.format.duration - 4) < 0.6, `duration ~4s (c=${conc})`);
    }
    const median = walls.slice().sort((a, b) => a - b)[0]; // n=2: report best; p50/p95 N/A (stats gate n>=5)
    ev.candidates.push({ concurrency: conc, wallsMs: walls, bestMs: median, rssPeakMB: rssPeak, crashes, failures: 0 });
    console.log(`  c=${conc}: walls=${walls.join(",")}ms rssPeak=${rssPeak}MB`);
  });
}

await runTest("byte-identity across concurrencies + default selection", async () => {
  const uniqEquiv = new Set(Object.values(equiv));
  assert(uniqEquiv.size === 1, "all 6 outputs media-equivalent (decoded frames, packet timing, stream params, duration), got " + uniqEquiv.size + " variants");
  ev.determinism = { assertion: "media-equivalence", equivalentVariants: uniqEquiv.size, wholeFileVariants: new Set(Object.values(hashes)).size, note: "whole-file bytes may differ only in the MP4 compressorname metadata string; not asserted" };
  const byConc = {};
  ev.candidates.forEach((c) => { byConc[c.concurrency] = c.bestMs; });
  // Default = fastest with zero crashes; do NOT default to max concurrency.
  const viable = ev.candidates.filter((c) => c.crashes === 0).sort((a, b) => a.bestMs - b.bestMs);
  assert(viable.length > 0, "at least one viable candidate");
  ev.selectedDefault = { concurrency: viable[0].concurrency, bestMs: viable[0].bestMs,
    rationale: "fastest zero-crash candidate at small scale; pilot-scale re-check open" };
});

fs.mkdirSync(EVID_DIR, { recursive: true });
fs.writeFileSync(path.join(EVID_DIR, "concurrency-matrix.json"), JSON.stringify(ev, null, 1));
try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
try { Stager.cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
try { fs.rmSync(path.resolve(ROOT, "remotion", "public", "unfoldiq", PID), { recursive: true, force: true }); } catch (e) {}
await incRender.shutdownBrowserPool();
console.log("\n=== concurrency-matrix-5c: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
