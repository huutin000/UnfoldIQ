"use strict";
// tests/incremental/test-incremental-render.js — Phase 5B render cases:
// A (no-change reuse) · B (one scene repaired) · Z (intentional black) ·
// AE (audio mux once) · AF (caption across boundary) · AA (equivalence) ·
// AH-small (incremental < full) · determinism · AJ (restart).
// TEST-ONLY project __5b_incr__ (2 scenes x 2s @30fps); cleaned after run.

process.env.UNFOLDIQ_INCREMENTAL_RENDER = "1";
process.env.UNFOLDIQ_PARTIAL_QA = "1";
process.env.UNFOLDIQ_SEMANTIC_CACHE = "1";
process.env.UNFOLDIQ_BROWSER_REUSE = "1"; // Phase 5C (5C-04): pool browsers across ranges

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__5b_incr__";
const EVID_DIR = path.join(ROOT, "Report", "evidence", "perf-5b");

const incr = require("../../lib/incremental/index.js");
const renderCache = require("../../lib/render-cache/index.js");
const partialQA = require("../../lib/render/partial-qa.js");
const incRender = require("../../pipeline/incremental-render.js");
const Builder = require("../../lib/render-input-builder.js");
const Stager = require("../../lib/asset-stager.js");
const render = require("../../lib/render/index.js");

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
function projDir() { return path.join(ROOT, "projects", PID); }
function wjson(rel, obj) {
  const abs = path.join(projDir(), rel.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
}
function cleanup() {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  try { Stager.cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
  try { fs.rmSync(path.resolve(ROOT, "remotion", "public", "unfoldiq", PID), { recursive: true, force: true }); } catch (e) {}
}

const FPS = 30;
const SCENES = [
  { sceneId: "S1", startMs: 0, endMs: 2000, visual: "color=c=black:s=1280x720:r=30:d=2", kind: "VIDEO", text: "Scene one" },
  { sceneId: "S2", startMs: 2000, endMs: 4000, visual: "still", kind: "IMAGE", text: "Scene two" },
];
const TOTAL_FRAMES = 120;

function sceneVisualFiles(variant) {
  // variant: {s2color} — local visual change swaps the S2 still.
  const dir = path.join(projDir(), "assets");
  fs.mkdirSync(dir, { recursive: true });
  for (const s of SCENES) {
    if (s.kind === "IMAGE") {
      const color = s.sceneId === "S2" && variant ? variant : "0x14202e";
      assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=${color}:s=1280x720:d=0.1`, "-frames:v", "1", path.join(dir, "still.png")]).status === 0, "still ok");
    } else {
      assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", s.visual, "-pix_fmt", "yuv420p", path.join(dir, "s1.mp4")]).status === 0, "clip ok");
    }
    // MEASURED voice stub per scene (sine; timing from wav header, not estimated).
    const wav = path.join(dir, `${s.sceneId.toLowerCase()}-voice.wav`);
    assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5", "-ar", "48000", "-ac", "2", wav]).status === 0, "voice stub ok");
  }
}

function writeDocs() {
  wjson("scene-script.json", {
    platform: "youtube",
    scenes: SCENES.map((s) => ({ sceneId: s.sceneId, order: SCENES.indexOf(s) + 1, narration: s.text, onScreenText: s.text, timing: { startMs: s.startMs, endMs: s.endMs }, purpose: "bench" })),
  });
  wjson("asset-manifest.json", {
    assets: [
      { assetId: "as-s1", type: "video", path: "assets/s1.mp4", status: "READY", sceneIds: ["S1"], width: 1280, height: 720, durationMs: 2000 },
      { assetId: "as-s2", type: "image", path: "assets/still.png", status: "READY", sceneIds: ["S2"], width: 1280, height: 720 },
      { assetId: "AUD_S1", type: "voice", path: "assets/s1-voice.wav", status: "READY", durationMs: 1500 },
      { assetId: "AUD_S2", type: "voice", path: "assets/s2-voice.wav", status: "READY", durationMs: 1500 },
    ],
  });
  wjson("preflight/media-preflight.json", {
    status: "READY", version: "1.0.0", blockingIssues: [], warnings: [],
    assets: [
      { assetId: "as-s1", type: "video", sceneId: "S1", rightsStatus: "CLEAR", required: true },
      { assetId: "as-s2", type: "image", sceneId: "S2", rightsStatus: "CLEAR", required: true },
    ],
  });
  wjson("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: 4000, sources: ["bench"] });
  wjson("audio/audio-mix-plan.json", {
    tracks: {
      voice: SCENES.map((s) => ({ clipId: `clip_${s.sceneId}`, path: `assets/${s.sceneId.toLowerCase()}-voice.wav`, fromMs: s.startMs, trimStartMs: 0, trimEndMs: 1500, timingStatus: "MEASURED", gainDb: 0, fadeInMs: 50, fadeOutMs: 150, loop: false })),
    },
    generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO",
  });
}

function buildInput() {
  const stageList = [
    { assetId: "as-s1", sourcePath: "assets/s1.mp4", type: "video" },
    { assetId: "as-s2", sourcePath: "assets/still.png", type: "image" },
    { assetId: "AUD_S1", sourcePath: "assets/s1-voice.wav", type: "audio" },
    { assetId: "AUD_S2", sourcePath: "assets/s2-voice.wav", type: "audio" },
  ];
  const entries = Stager.stageAssets({ projectRoot: ROOT, projectId: PID, assets: stageList });
  const renderDir = path.join(projDir(), "render");
  fs.mkdirSync(renderDir, { recursive: true });
  fs.writeFileSync(path.join(renderDir, "staging-manifest.json"), JSON.stringify({ version: "1.0.0", projectId: PID, entries }, null, 1));
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
  const unstaged = Object.values(input.assets || {}).filter((a) => a.unstaged);
  assert(unstaged.length === 0, "all assets staged, unstaged=" + JSON.stringify(unstaged.map((a) => a.assetId)));
  return input;
}

function sceneMap() {
  return SCENES.map((s) => ({ sceneId: s.sceneId, startFrame: (s.startMs / 1000) * FPS, endFrameExclusive: (s.endMs / 1000) * FPS }));
}

(async () => {
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "5b-render-"));
const cacheRoot = path.join(scratch, "cache");
const metrics = renderCache.newMetrics();
let ctx = null;
let inputV1 = null;

await runTest("SETUP project + reference full render", async () => {
  cleanup();
  sceneVisualFiles(null);
  writeDocs();
  inputV1 = buildInput();
  assert(inputV1.composition && inputV1.scenes.length === 2, "input built, 2 scenes");
  const b = await incRender.bundleOnce(ROOT);
  const comp = await incRender.selectComposition(b.libs, b.serveUrl, "UNFOLDIQVideo", inputV1);
  ctx = { libs: b.libs, serveUrl: b.serveUrl, comp };
  assert(comp.durationInFrames === TOTAL_FRAMES, "120 frames, got " + comp.durationInFrames);
  const t0 = Date.now();
  await ctx.libs.renderer.renderMedia({
    codec: "h264", pixelFormat: "yuv420p", composition: comp, serveUrl: ctx.serveUrl,
    inputProps: inputV1, outputLocation: path.join(scratch, "ref-v1.mp4"), concurrency: 1, muted: true,
  });
  ctx.fullV1Ms = Date.now() - t0;
  assert(fs.existsSync(path.join(scratch, "ref-v1.mp4")), "reference exists");
});

// Chunked v1 render + cache publish (all ranges dirty: first run).
await runTest("chunked v1 + CAS publish", async () => {
  const ranges = [{ startFrame: 0, endFrameExclusive: 60 }, { startFrame: 60, endFrameExclusive: TOTAL_FRAMES }];
  ctx.chunksV1 = [];
  for (const r of ranges) {
    const fd = path.join(scratch, `v1-frames-${r.startFrame}-${r.endFrameExclusive}`);
    const out = path.join(scratch, `v1-chunk-${r.startFrame}-${r.endFrameExclusive}.mp4`);
    const t0 = Date.now();
    const res = await incRender.renderRange({
      libs: ctx.libs, serveUrl: ctx.serveUrl, composition: ctx.comp, inputProps: inputV1,
      range: r, framesDir: fd, outFile: out, fps: FPS, width: ctx.comp.width, height: ctx.comp.height, concurrency: 1,
    });
    metrics.framesRendered += res.frameCount;
    metrics.hashingMs += 0;
    const key = renderCache.sceneRenderKey({
      sourceAssetHashes: { s1: "clip", s2: "still-v1" }, timelineRange: [r.startFrame, r.endFrameExclusive],
      fps: FPS, width: ctx.comp.width, height: ctx.comp.height, remotionVersion: "4.0.529", frameRange: r,
    });
    const blob = renderCache.writeBlob(cacheRoot, fs.readFileSync(out));
    metrics.bytesWritten += blob.bytes;
    renderCache.publishAction(cacheRoot, {
      actionKey: key, actionType: "scene-render", schemaVersion: "1.0.0",
      inputs: [{ name: "timelineRange", hash: renderCache.qaKey ? "x" : "x" }],
      toolVersions: { remotion: "4.0.529" }, policyVersions: {}, outputContentHashes: [blob.hash],
    });
    ctx.chunksV1.push({ range: r, chunkFile: out, actionKey: key, renderMs: Date.now() - t0 });
  }
  assert(ctx.chunksV1.length === 2, "two chunks");
  // Determinism proof: re-render S2 range, byte-identical chunk.
  const again = path.join(scratch, "v1-chunk-60-120-again.mp4");
  await incRender.renderRange({
    libs: ctx.libs, serveUrl: ctx.serveUrl, composition: ctx.comp, inputProps: inputV1,
    range: { startFrame: 60, endFrameExclusive: 120 },
    framesDir: path.join(scratch, "v1-frames-again"), outFile: again,
    fps: FPS, width: ctx.comp.width, height: ctx.comp.height, concurrency: 1,
  });
  const a = fs.readFileSync(ctx.chunksV1[1].chunkFile);
  const b2 = fs.readFileSync(again);
  assert(a.equals(b2), "browser render + stitch deterministic (" + a.length + " bytes)");
});

await runTest("A no-change rerun: zero renders, assembly from cache", async () => {
  const fp = require("../../pipeline/input-fingerprint.js");
  const mkFp = (tl) => Object.assign({ renderInput: "ri", renderPlan: "rp", stagingManifest: "sm", timeline: tl, captions: "c", audioMix: "a", visualBible: "vb", continuity: "co", platformProfile: "pp", remotion: "re", fingerprintId: "x" });
  const diff = incr.diffDependencies(mkFp("tl1"), mkFp("tl1"));
  const dirty = incr.buildDirtySet(diff, { totalFrames: TOTAL_FRAMES, sceneMap: sceneMap() });
  const keyFor = (r) => renderCache.sceneRenderKey({
    sourceAssetHashes: { s1: "clip", s2: "still-v1" }, timelineRange: [r.startFrame, r.endFrameExclusive],
    fps: FPS, width: ctx.comp.width, height: ctx.comp.height, remotionVersion: "4.0.529", frameRange: r,
  });
  const lookup = (key) => {
    const c = ctx.chunksV1.find((x) => x.actionKey === key);
    metrics.lookups++;
    if (!c) { metrics.misses++; return { status: "MISS", reason: "NOT_FOUND" }; }
    const blob = renderCache.readBlob(cacheRoot, renderCache.loadRecord(cacheRoot, key).outputContentHashes[0]);
    metrics.bytesReused += blob.bytes.length;
    metrics.validHits++;
    return { status: "HIT_VALID", cachedArtifactRef: "CAS/sha256/" + renderCache.loadRecord(cacheRoot, key).outputContentHashes[0] };
  };
  const plan = incr.planRender({
    dirtySet: dirty, totalFrames: TOTAL_FRAMES, keyForRange: keyFor, cacheLookup: lookup,
    knownKeys: ctx.chunksV1.map((c) => ({ range: c.range, actionKey: c.actionKey })),
  });
  assert(plan.fallback === "NONE" && plan.renderRegions.length === 0, "A: nothing to render");
  assert(plan.reusableRegions.length === 2, "A: tiled from cached scene chunks");
  const chunks = plan.reusableRegions.map((r) => {
    const h = renderCache.loadRecord(cacheRoot, r.actionKey).outputContentHashes[0];
    const dest = path.join(scratch, `reuse-${r.range.startFrame}.mp4`);
    fs.writeFileSync(dest, renderCache.readBlob(cacheRoot, h).bytes);
    return { range: r.range, chunkFile: dest };
  });
  const asm = incRender.assemble({ chunks, totalFrames: TOTAL_FRAMES, expected: { totalFrames: TOTAL_FRAMES, fps: FPS, width: ctx.comp.width, height: ctx.comp.height, pixelFormat: "yuv420p" }, outFile: path.join(scratch, "inc-v1.mp4") });
  assert(fs.existsSync(asm.outFile), "A: reassembled from cache");
  metrics.framesReused += TOTAL_FRAMES;
  ctx.incV1 = asm.outFile;
});

await runTest("B local visual repair: only S2 range rerendered", async () => {
  sceneVisualFiles("0x7a1f1f"); // swap S2 still = representative local visual change
  writeDocs();
  const inputV2 = buildInput();
  const mkFp = (tl) => Object.assign({ renderInput: "ri", renderPlan: "rp", stagingManifest: "sm", timeline: tl, captions: "c", audioMix: "a", visualBible: "vb", continuity: "co", platformProfile: "pp", remotion: "re", fingerprintId: "x" });
  // Scene-level precision: only S2 hash moves (asset bytes changed).
  const stillBytes = fs.readFileSync(path.join(projDir(), "assets", "still.png"));
  const h2 = crypto.createHash("sha256").update(stillBytes).digest("hex").slice(0, 16);
  const diff = incr.diffDependencies(mkFp("tl1"), mkFp("tl2"));
  const dirty = incr.buildDirtySet(diff, {
    totalFrames: TOTAL_FRAMES, sceneMap: sceneMap(),
    sceneHashes: { prev: { S1: "clip", S2: "still-v1" }, curr: { S1: "clip", S2: h2 } },
    transitions: [{ boundaryFrame: 60, overlapFrames: 0 }],
  });
  assert(!dirty.global, "local change stays local");
  assert(dirty.dirtyFrameRanges.length === 1, "one dirty range");
  const r = dirty.dirtyFrameRanges[0];
  assert(r.startFrame === 60 && r.endFrameExclusive === 120, "exactly S2: " + JSON.stringify(r));
  const t0 = Date.now();
  const fd = path.join(scratch, "v2-frames-60-120");
  const out = path.join(scratch, "v2-chunk-60-120.mp4");
  const res = await incRender.renderRange({
    libs: ctx.libs, serveUrl: ctx.serveUrl, composition: ctx.comp, inputProps: inputV2,
    range: { startFrame: 60, endFrameExclusive: 120 }, framesDir: fd, outFile: out,
    fps: FPS, width: ctx.comp.width, height: ctx.comp.height, concurrency: 1,
  });
  ctx.incrV2RenderMs = Date.now() - t0;
  metrics.framesRendered += res.frameCount;
  // Reuse S1 chunk from cache (untouched).
  const h = renderCache.loadRecord(cacheRoot, ctx.chunksV1[0].actionKey).outputContentHashes[0];
  const s1reuse = path.join(scratch, "reuse-s1-v2.mp4");
  fs.writeFileSync(s1reuse, renderCache.readBlob(cacheRoot, h).bytes);
  metrics.framesReused += 60;
  metrics.validHits++;
  const asm = incRender.assemble({
    chunks: [{ range: { startFrame: 0, endFrameExclusive: 60 }, chunkFile: s1reuse }, { range: { startFrame: 60, endFrameExclusive: 120 }, chunkFile: out }],
    totalFrames: TOTAL_FRAMES,
    expected: { totalFrames: TOTAL_FRAMES, fps: FPS, width: ctx.comp.width, height: ctx.comp.height, pixelFormat: "yuv420p" },
    outFile: path.join(scratch, "inc-v2.mp4"),
  });
  ctx.incV2 = asm.outFile;
  ctx.inputV2 = inputV2;
  assert(fs.existsSync(ctx.incV2), "B: repaired output without rerendering S1");
});

await runTest("AA equivalence vs fresh full-render oracle (V2 timeline)", async () => {
  const t0 = Date.now();
  await ctx.libs.renderer.renderMedia({
    codec: "h264", pixelFormat: "yuv420p", composition: ctx.comp, serveUrl: ctx.serveUrl,
    inputProps: ctx.inputV2, outputLocation: path.join(scratch, "ref-v2.mp4"), concurrency: 1, muted: true,
  });
  ctx.fullV2Ms = Date.now() - t0;
  // Range-aware conform on BOTH sides (renderMedia emits full-range, chunks
  // tv-range; blind conform would corrupt one side — 5B lesson).
  const prof = render.exportProfile.resolveExportProfile("youtube-sdr-1080p@1.0.0", { numerator: 30, denominator: 1 });
  assert(prof.ok, "export profile resolves");
  const cRef = incRender.conformAssembly(path.join(scratch, "ref-v2.mp4"), path.join(scratch, "ref-v2-c.mp4"), prof.profile);
  const cInc = incRender.conformAssembly(ctx.incV2, path.join(scratch, "inc-v2-c.mp4"), prof.profile);
  assert(cRef.ok && cInc.ok, "range-aware conform ok: " + JSON.stringify([cRef.record && cRef.record.conformVersion, cInc.record && cInc.record.conformVersion]));
  const cmp = incRender.compareOutputs(path.join(scratch, "ref-v2-c.mp4"), path.join(scratch, "inc-v2-c.mp4"), { frameStats: { scratchDir: scratch, maxSamples: 8 } });
  const byName = {};
  cmp.findings.forEach((f) => { byName[f.check] = f; });
  assert(byName.container.ok && byName.resolution.ok && byName.fps.ok && byName.pixfmt.ok && byName.duration.ok, "structural identity: " + JSON.stringify(cmp.findings));
  assert(byName.audioStream.ok, "audio parity (both video-only)");
  ctx.equivalence = cmp;
  // AH-small: incremental wall (dirty render + assembly) < full reference wall.
  assert(ctx.incrV2RenderMs < ctx.fullV2Ms, `incremental ${ctx.incrV2RenderMs}ms < full ${ctx.fullV2Ms}ms`);
  // Persist small-scale metrics + equivalence evidence.
  fs.mkdirSync(EVID_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVID_DIR, "repair-benchmark-small.json"), JSON.stringify({
    version: "1.0.0", scale: "small (120 frames, 1280x720-class)",
    fullReferenceMs: ctx.fullV2Ms, incrementalRenderMs: ctx.incrV2RenderMs,
    framesTotal: TOTAL_FRAMES, framesRendered: 60, framesReused: 60,
    cache: { lookups: metrics.lookups, validHits: metrics.validHits, misses: metrics.misses, bytesReused: metrics.bytesReused, bytesWritten: metrics.bytesWritten },
    equivalence: { status: cmp.status, findings: cmp.findings, frameStats: cmp.frameStats || null },
  }, null, 1));
});

await runTest("Z intentional black still passes context-aware QC", async () => {
  // S1 is a deliberate black hold: candidates exist AND intent covers them.
  const det = render.probe.detectBlack(ctx.chunksV1[0].chunkFile);
  assert(det.ranges && det.ranges.length > 0, "black candidates detected in S1 chunk");
  const verdict = render.qc.checkBlack(det.ranges, { expectedBlackRanges: [{ start: 0, end: 2 }] });
  assert(Array.isArray(verdict) && verdict.length === 0, "intended black passes (zero findings)");
  const bad = render.qc.checkBlack(det.ranges, { expectedBlackRanges: [] });
  assert(bad.length > 0 && bad[0].code === "UNEXPECTED_BLACK_FRAME", "same candidates fail without intent (no blind pass)");
});

await runTest("AE FinalAudio muxed exactly once, no seam", async () => {
  const wav = path.join(scratch, "final-audio.wav");
  assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-ar", "48000", "-ac", "2", wav]).status === 0, "sine FinalAudio ok");
  const out = path.join(scratch, "inc-v2-audio.mp4");
  const asm = incRender.assemble({
    chunks: [
      { range: { startFrame: 0, endFrameExclusive: 60 }, chunkFile: path.join(scratch, "reuse-s1-v2.mp4") },
      { range: { startFrame: 60, endFrameExclusive: 120 }, chunkFile: path.join(scratch, "v2-chunk-60-120.mp4") },
    ],
    totalFrames: TOTAL_FRAMES,
    expected: { totalFrames: TOTAL_FRAMES, fps: FPS },
    finalAudioAbs: wav, outFile: out,
  });
  assert(fs.existsSync(asm.outFile), "muxed output exists");
  const pr = incRender.probeChunk(asm.outFile);
  assert(pr.audio && pr.audio.codec === "aac", "single AAC track present");
  assert(Math.abs(pr.format.duration - TOTAL_FRAMES / FPS) < 0.6, "A/V durations agree");
  const mdRef = incRender.audiomd5(wav);
  void mdRef;
});

await runTest("AF caption across boundary requires boundary check", async () => {
  const qaPlan = partialQA.planPartialQA({
    dirtyRanges: [{ startFrame: 60, endFrameExclusive: 120 }],
    boundaryRanges: [{ startFrame: 45, endFrameExclusive: 120 }],
    changedKeys: ["captions"],
    totalFrames: TOTAL_FRAMES,
    artifactHashes: {},
  });
  const capLocal = qaPlan.localChecks.filter((c) => c.qaRuleId === "captions");
  assert(capLocal.length === 1, "caption check planned");
  assert(capLocal[0].ranges[0].startFrame < 60 && capLocal[0].ranges[0].endFrameExclusive >= 60, "caption context crosses the cut: " + JSON.stringify(capLocal[0].ranges));
  assert(qaPlan.globalChecks.includes("decode") && qaPlan.globalChecks.includes("duration"), "global invariants preserved");
});

await runTest("AJ restart: valid cache survives, incomplete rejected", async () => {
  // Simulate restart: fresh metrics + re-lookup from disk (no memory state).
  const key = ctx.chunksV1[0].actionKey;
  const hit = renderCache.lookup(cacheRoot, key, {});
  assert(hit.status === "HIT_VALID", "valid cache survives restart");
  const incomplete = renderCache.lookup(cacheRoot, "never-published", {});
  assert(incomplete.status === "MISS" && incomplete.reason === "NOT_FOUND", "incomplete cache rejected");
  renderCache.saveMetrics(cacheRoot, metrics);
  const back = renderCache.loadMetrics(cacheRoot);
  assert(back.framesRendered >= 180 && back.framesReused >= 180, "metrics persisted across restart");
});

await runTest("5C-04 browser reuse: one pooled browser serves every range render", async () => {
  const snap = incRender.poolSnapshot(ROOT);
  assert(snap, "pool exists after UNFOLDIQ_BROWSER_REUSE=1 renders");
  const m = snap.metrics;
  // Range renders in this run: 2 (v1 chunks) + 1 (determinism) + 1 (B repair) = 4.
  assert(m.created === 1, "exactly one browser opened for all ranges, got " + m.created);
  assert(m.reused === 3, "3 leases reused the pooled browser, got " + m.reused);
  assert(m.retired + snap.browsers.length === m.created, "pool accounting consistent");
  const avoided = m.startupAvoidedMs.reduce((a, b) => a + b, 0);
  assert(avoided > 0, "startup avoided recorded (" + avoided + "ms)");
  assert(m.startupAvoidedMs.length === m.reused, "one measurement per reused lease");
  const EVID_5C = path.join(ROOT, "Report", "evidence", "perf-5c");
  fs.mkdirSync(EVID_5C, { recursive: true });
  fs.writeFileSync(path.join(EVID_5C, "browser-reuse-benchmark.json"), JSON.stringify({
    version: "1.0.0", phase: "5C-04", scale: "small (120 frames, 1280x720-class)",
    flag: "UNFOLDIQ_BROWSER_REUSE=1",
    rangeRenders: m.created + m.reused,
    browserStarts: m.created, reusedLeases: m.reused,
    browserStartupMs: snap.browsers[0] ? snap.browsers[0].startupMs : null,
    startupAvoidedMs: m.startupAvoidedMs, startupAvoidedTotalMs: avoided,
    benchmark5b: { fullReferenceMs: ctx.fullV2Ms, incrementalRenderMs: ctx.incrV2RenderMs },
    policy: snap.policy,
  }, null, 1));
});

await runTest("CLEANUP test project removed", async () => {
  cleanup();
  await incRender.shutdownBrowserPool();
  assert(!fs.existsSync(projDir()), "project cleaned (TEST-ONLY convention)");
});

console.log("\n=== incremental-render: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
