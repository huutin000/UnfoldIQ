"use strict";
// tests/incremental/test-pilot-repair-a.js — Phase 5B pilot-scale baseline (A).
// 5 scenes x 30s = 150s/4500 frames @1080p30 (mirrors 4B pilot visuals).
// Produces: full reference wall, 5 cached range chunks, cache-filled assembly,
// no-change reassembly (concat determinism at scale). Part B (repair +
// oracle + compare) lives in test-pilot-repair-b.js and requires A's outputs.

process.env.UNFOLDIQ_INCREMENTAL_RENDER = "1";
process.env.UNFOLDIQ_PARTIAL_QA = "1";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__5b_pilot__";
const EVID_DIR = path.join(ROOT, "Report", "evidence", "perf-5b");
const OUT_DIR = path.join(ROOT, "out", "incremental-5b");

const incr = require("../../lib/incremental/index.js");
const renderCache = require("../../lib/render-cache/index.js");
const incRender = require("../../pipeline/incremental-render.js");
const Builder = require("../../lib/render-input-builder.js");
const Stager = require("../../lib/asset-stager.js");

let passed = 0;
let failed = 0;
function framesOf(abs) {
  try {
    const p = incRender.probeChunk(abs);
    return p.video.nbFrames || Math.round(p.format.duration * incRender.parseFps(p.video.fps));
  } catch (e) { return -1; }
}

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

function stamp(m) { console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`); }

const FPS = 30;
const SCENES = [
  { sceneId: "S01", startMs: 0, endMs: 30000, visual: "testsrc2", kind: "VIDEO", text: "Night was the most dangerous time" },
  { sceneId: "S02", startMs: 30000, endMs: 60000, visual: "still", kind: "IMAGE", text: "Shelter: rock at your back" },
  { sceneId: "S03", startMs: 60000, endMs: 90000, visual: "yuvtestsrc", kind: "VIDEO", text: "Fire kept predators away" },
  { sceneId: "S04", startMs: 90000, endMs: 120000, visual: "testsrc", kind: "VIDEO", text: "From nine in a hundred to two" },
  { sceneId: "S05", startMs: 120000, endMs: 150000, visual: "rgbtestsrc", kind: "VIDEO", text: "Shelter Fire Tribe" },
];
const TOTAL_FRAMES = 4500;
const RANGES = [0, 900, 1800, 2700, 3600].map((s) => ({ startFrame: s, endFrameExclusive: s + 900 }));

function buildAssets() {
  const dir = path.join(projDir(), "assets");
  fs.mkdirSync(dir, { recursive: true });
  for (const s of SCENES) {
    if (s.kind === "IMAGE") {
      assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x14202e:s=1920x1080:d=0.1", "-frames:v", "1", path.join(dir, "still.png")]).status === 0, "still ok");
    } else {
      assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", `${s.visual}=s=1920x1080:r=30:d=30`, "-pix_fmt", "yuv420p", path.join(dir, `${s.sceneId.toLowerCase()}.mp4`)]).status === 0, `clip ok ${s.sceneId}`);
    }
    const wav = path.join(dir, `${s.sceneId.toLowerCase()}-voice.wav`);
    assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-ar", "48000", "-ac", "2", wav]).status === 0, "voice stub ok");
  }
}

function writeDocs() {
  wjson("scene-script.json", {
    platform: "youtube",
    scenes: SCENES.map((s) => ({ sceneId: s.sceneId, order: SCENES.indexOf(s) + 1, narration: s.text, onScreenText: s.text, timing: { startMs: s.startMs, endMs: s.endMs }, purpose: "bench" })),
  });
  const vAssets = SCENES.map((s) => s.kind === "IMAGE"
    ? { assetId: "as-pilot-still", type: "image", path: "assets/still.png", status: "READY", sceneIds: ["S02"], width: 1920, height: 1080 }
    : { assetId: `as-pilot-${s.visual}`, type: "video", path: `assets/${s.sceneId.toLowerCase()}.mp4`, status: "READY", sceneIds: [s.sceneId], width: 1920, height: 1080, durationMs: 30000 });
  const aAssets = SCENES.map((s) => ({ assetId: `AUD_${s.sceneId}`, type: "voice", path: `assets/${s.sceneId.toLowerCase()}-voice.wav`, status: "READY", durationMs: 5000 }));
  wjson("asset-manifest.json", { assets: [...vAssets, ...aAssets] });
  wjson("preflight/media-preflight.json", {
    status: "READY", version: "1.0.0", blockingIssues: [], warnings: [],
    assets: vAssets.map((a) => ({ assetId: a.assetId, type: a.type, sceneId: a.sceneIds[0], rightsStatus: "CLEAR", required: true })),
  });
  wjson("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: 150000, sources: ["bench"] });
  wjson("audio/audio-mix-plan.json", {
    tracks: { voice: SCENES.map((s) => ({ clipId: `clip_${s.sceneId}`, path: `assets/${s.sceneId.toLowerCase()}-voice.wav`, fromMs: s.startMs, trimStartMs: 0, trimEndMs: 5000, timingStatus: "MEASURED", gainDb: 0, fadeInMs: 50, fadeOutMs: 150, loop: false })) },
    generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO",
  });
}

(async () => {
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(EVID_DIR, { recursive: true });
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "5b-pilot-"));
const cacheRoot = path.join(OUT_DIR, "cache");
const metrics = renderCache.newMetrics();
const ev = { version: "1.0.0", scale: "pilot (4500 frames, 1920x1080@30)", ranges: RANGES };

await runTest("A1 setup + bundle + full reference render", async () => {
  const refAbs = path.join(OUT_DIR, "ref-v1.mp4");
  if (fs.existsSync(path.join(OUT_DIR, "input-v1.json")) && framesOf(refAbs) === TOTAL_FRAMES) {
    stamp("A1 resume: valid ref-v1.mp4 present, skipping rebuild+render");
    ev.fullReferenceMs = null;
    ev.fullReferenceNote = "resumed existing ref-v1.mp4 (4500 frames verified)";
    return;
  }
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  buildAssets();
  writeDocs();
  const stageList = [];
  for (const s of SCENES) {
    stageList.push(s.kind === "IMAGE"
      ? { assetId: "as-pilot-still", sourcePath: "assets/still.png", type: "image" }
      : { assetId: `as-pilot-${s.visual}`, sourcePath: `assets/${s.sceneId.toLowerCase()}.mp4`, type: "video" });
    stageList.push({ assetId: `AUD_${s.sceneId}`, sourcePath: `assets/${s.sceneId.toLowerCase()}-voice.wav`, type: "audio" });
  }
  const entries = Stager.stageAssets({ projectRoot: ROOT, projectId: PID, assets: stageList });
  fs.mkdirSync(path.join(projDir(), "render"), { recursive: true });
  fs.writeFileSync(path.join(projDir(), "render", "staging-manifest.json"), JSON.stringify({ version: "1.0.0", projectId: PID, entries }, null, 1));
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
  fs.writeFileSync(path.join(OUT_DIR, "input-v1.json"), JSON.stringify(input));
  const b = await incRender.bundleOnce(ROOT);
  const comp = await incRender.selectComposition(b.libs, b.serveUrl, "UNFOLDIQVideo", input);
  assert(comp.durationInFrames === TOTAL_FRAMES, "4500 frames");
  const t0 = Date.now();
  await b.libs.renderer.renderMedia({
    codec: "h264", pixelFormat: "yuv420p", composition: comp, serveUrl: b.serveUrl,
    inputProps: input, outputLocation: path.join(OUT_DIR, "ref-v1.mp4"), muted: true,
  });
  ev.fullReferenceMs = Date.now() - t0;
  ev.bundleSkipped = false;
  assert(fs.existsSync(path.join(OUT_DIR, "ref-v1.mp4")), "reference exists");
  fs.writeFileSync(path.join(OUT_DIR, "ctx-a.json"), JSON.stringify({ serveUrl: b.serveUrl }));
  // serveUrl is in-memory; part B re-bundles (bundle cost recorded separately).
});

await runTest("A2 chunked v1 render (5 ranges) + CAS publish", async () => {
  const input = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "input-v1.json"), "utf8"));
  const b = await incRender.bundleOnce(ROOT);
  const comp = await incRender.selectComposition(b.libs, b.serveUrl, "UNFOLDIQVideo", input);
  ev.bundleMs = ev.bundleMs || 0;
  const chunks = [];
  const keyOf = (r) => renderCache.sceneRenderKey({
    sourceAssetHashes: Object.fromEntries(SCENES.map((s) => [s.sceneId, s.kind === "IMAGE" ? "still-v1" : s.visual])),
    timelineRange: [r.startFrame, r.endFrameExclusive], fps: FPS, width: 1920, height: 1080,
    remotionVersion: "4.0.529", frameRange: r,
  });
  const ensurePublished = (out, key, r) => {
    const tH = Date.now();
    const blob = renderCache.writeBlob(cacheRoot, fs.readFileSync(out));
    metrics.hashingMs += Date.now() - tH;
    metrics.bytesWritten += blob.bytes;
    renderCache.publishAction(cacheRoot, {
      actionKey: key, actionType: "scene-render", schemaVersion: "1.0.0",
      inputs: [{ name: "timelineRange", hash: `${r.startFrame}-${r.endFrameExclusive}` }],
      toolVersions: { remotion: "4.0.529" }, policyVersions: {}, outputContentHashes: [blob.hash],
    });
  };
  for (const r of RANGES) {
    const fd = path.join(scratch, `frames-${r.startFrame}-${r.endFrameExclusive}`);
    const out = path.join(OUT_DIR, `chunk-v1-${r.startFrame}-${r.endFrameExclusive}.mp4`);
    const key = keyOf(r);
    if (framesOf(out) === r.endFrameExclusive - r.startFrame) {
      stamp(`A2 resume: chunk ${r.startFrame}-${r.endFrameExclusive} valid, ensuring record`);
      ensurePublished(out, key, r);
      chunks.push({ range: r, chunkFile: out, actionKey: key, renderMs: 0, resumed: true });
      continue;
    }
    stamp(`A2 rendering range ${r.startFrame}-${r.endFrameExclusive}...`);
    const t0 = Date.now();
    const res = await incRender.renderRange({
      libs: b.libs, serveUrl: b.serveUrl, composition: comp, inputProps: input,
      range: r, framesDir: fd, outFile: out, fps: FPS, width: comp.width, height: comp.height,
    });
    const wall = Date.now() - t0;
    metrics.framesRendered += res.frameCount;
    ensurePublished(out, key, r);
    chunks.push({ range: r, chunkFile: out, actionKey: key, renderMs: wall });
    try { fs.rmSync(fd, { recursive: true, force: true }); } catch (e) {}
  }
  ev.chunkedV1Ms = chunks.reduce((a, c) => a + c.renderMs, 0);
  ev.chunksV1 = chunks.map((c) => ({ range: c.range, actionKey: c.actionKey, renderMs: c.renderMs, bytes: fs.statSync(c.chunkFile).size }));
  fs.writeFileSync(path.join(OUT_DIR, "chunks-v1.json"), JSON.stringify(chunks.map((c) => ({ range: c.range, chunkFile: c.chunkFile, actionKey: c.actionKey })), null, 1));
});

await runTest("A3 no-change reassembly from cache (zero renders)", async () => {
  const chunks = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "chunks-v1.json"), "utf8"));
  const fp = { renderInput: "x", renderPlan: "x", stagingManifest: "x", timeline: "x", captions: "x", audioMix: "x", visualBible: "x", continuity: "x", platformProfile: "x", remotion: "x", fingerprintId: "same" };
  const d2 = incr.diffDependencies(fp, Object.assign({}, fp));
  assert(d2.changes.length === 0, "no changes");
  const dirty = incr.buildDirtySet(d2, { totalFrames: TOTAL_FRAMES, sceneMap: SCENES.map((s) => ({ sceneId: s.sceneId, startFrame: (s.startMs / 1000) * FPS, endFrameExclusive: (s.endMs / 1000) * FPS })) });
  const keyFor = (r) => renderCache.sceneRenderKey({
    sourceAssetHashes: Object.fromEntries(SCENES.map((s) => [s.sceneId, s.kind === "IMAGE" ? "still-v1" : s.visual])),
    timelineRange: [r.startFrame, r.endFrameExclusive], fps: FPS, width: 1920, height: 1080,
    remotionVersion: "4.0.529", frameRange: r,
  });
  const lookup = (key) => {
    const c = chunks.find((x) => x.actionKey === key);
    metrics.lookups++;
    if (!c) { metrics.misses++; return { status: "MISS", reason: "NOT_FOUND" }; }
    metrics.validHits++;
    const h = renderCache.loadRecord(cacheRoot, key).outputContentHashes[0];
    metrics.bytesReused += fs.statSync(path.join(cacheRoot, "CAS", "sha256", h)).size;
    return { status: "HIT_VALID", cachedArtifactRef: "CAS/sha256/" + h };
  };
  const plan = incr.planRender({
    dirtySet: dirty, totalFrames: TOTAL_FRAMES, keyForRange: keyFor, cacheLookup: lookup,
    knownKeys: chunks.map((c) => ({ range: c.range, actionKey: c.actionKey })),
  });
  assert(plan.fallback === "NONE" && plan.renderRegions.length === 0, "A: zero renders at pilot scale");
  assert(plan.reusableRegions.length === 5, "A: all 5 ranges tiled from cache");
  const t0 = Date.now();
  const asmChunks = plan.reusableRegions.map((r) => {
    const h = renderCache.loadRecord(cacheRoot, r.actionKey).outputContentHashes[0];
    const dest = path.join(scratch, `asm-${r.range.startFrame}.mp4`);
    fs.writeFileSync(dest, renderCache.readBlob(cacheRoot, h).bytes);
    return { range: r.range, chunkFile: dest };
  });
  const asm = incRender.assemble({
    chunks: asmChunks, totalFrames: TOTAL_FRAMES,
    expected: { totalFrames: TOTAL_FRAMES, fps: FPS, width: 1920, height: 1080, pixelFormat: "yuv420p" },
    outFile: path.join(OUT_DIR, "inc-v1.mp4"),
  });
  ev.reassemblyMs = Date.now() - t0;
  metrics.framesReused += TOTAL_FRAMES;
  assert(fs.existsSync(asm.outFile), "A: pilot-scale assembly from cache only");
  // Concat determinism at scale: reassemble again, byte-identical output.
  const asm2 = incRender.assemble({
    chunks: asmChunks, totalFrames: TOTAL_FRAMES,
    expected: { totalFrames: TOTAL_FRAMES, fps: FPS, width: 1920, height: 1080, pixelFormat: "yuv420p" },
    outFile: path.join(OUT_DIR, "inc-v1-repeat.mp4"),
  });
  void asm;
  const h1 = crypto.createHash("sha256").update(fs.readFileSync(path.join(OUT_DIR, "inc-v1.mp4"))).digest("hex");
  const h2 = crypto.createHash("sha256").update(fs.readFileSync(asm2.outFile)).digest("hex");
  assert(h1 === h2, "concat deterministic at pilot scale");
  try { fs.rmSync(path.join(OUT_DIR, "inc-v1-repeat.mp4"), { force: true }); } catch (e) {}
});

ev.cache = { lookups: metrics.lookups, validHits: metrics.validHits, misses: metrics.misses, bytesReused: metrics.bytesReused, bytesWritten: metrics.bytesWritten, hashingMs: metrics.hashingMs };
fs.writeFileSync(path.join(EVID_DIR, "repair-benchmark-a.json"), JSON.stringify(ev, null, 1));
try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
console.log("\n=== pilot-repair-a: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
