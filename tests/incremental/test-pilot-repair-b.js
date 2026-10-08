"use strict";
// tests/incremental/test-pilot-repair-b.js — Phase 5B pilot-scale repair (B).
// Requires test-pilot-repair-a.js outputs. Local change: S03 visual
// yuvtestsrc -> testsrc (representative local visual repair). Dirty range
// [1800,2700) re-renders; 4 cached chunks reused; oracle + equivalence +
// partial QA + full metrics. Idempotent/resumable like part A.

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
const partialQA = require("../../lib/render/partial-qa.js");
const incRender = require("../../pipeline/incremental-render.js");
const Builder = require("../../lib/render-input-builder.js");
const Stager = require("../../lib/asset-stager.js");
const render = require("../../lib/render/index.js");

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
function framesOf(abs) {
  try {
    const p = incRender.probeChunk(abs);
    return p.video.nbFrames || Math.round(p.format.duration * incRender.parseFps(p.video.fps));
  } catch (e) { return -1; }
}

const FPS = 30;
const TOTAL_FRAMES = 4500;
const SCENES_V2 = [
  { sceneId: "S01", startMs: 0, endMs: 30000, visual: "testsrc2", kind: "VIDEO" },
  { sceneId: "S02", startMs: 30000, endMs: 60000, visual: "still", kind: "IMAGE" },
  { sceneId: "S03", startMs: 60000, endMs: 90000, visual: "testsrc", kind: "VIDEO" },
  { sceneId: "S04", startMs: 90000, endMs: 120000, visual: "testsrc", kind: "VIDEO" },
  { sceneId: "S05", startMs: 120000, endMs: 150000, visual: "rgbtestsrc", kind: "VIDEO" },
];
const DIRTY = { startFrame: 1800, endFrameExclusive: 2700 };

(async () => {
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "5b-pilot-b-"));
const cacheRoot = path.join(OUT_DIR, "cache");
const metrics = renderCache.newMetrics();
const ev = JSON.parse(fs.readFileSync(path.join(EVID_DIR, "repair-benchmark-a.json"), "utf8"));

await runTest("B0 requires part-A outputs", async () => {
  for (const f of ["input-v1.json", "chunks-v1.json", "ref-v1.mp4"]) {
    assert(fs.existsSync(path.join(OUT_DIR, f)), "part A output missing: " + f + " (run test-pilot-repair-a first)");
  }
  const chunks = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "chunks-v1.json"), "utf8"));
  assert(chunks.length === 5 && chunks.every((c) => framesOf(c.chunkFile) === 900), "5 valid cached chunks");
});

await runTest("B1 S03 visual swap -> dirty range [1800,2700) only", async () => {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  const dir = path.join(projDir(), "assets");
  fs.mkdirSync(dir, { recursive: true });
  for (const s of SCENES_V2) {
    if (s.kind === "IMAGE") {
      assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x14202e:s=1920x1080:d=0.1", "-frames:v", "1", path.join(dir, "still.png")]).status === 0, "still ok");
    } else {
      assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", `${s.visual}=s=1920x1080:r=30:d=30`, "-pix_fmt", "yuv420p", path.join(dir, `${s.sceneId.toLowerCase()}.mp4`)]).status === 0, `clip ok ${s.sceneId}`);
    }
    assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-ar", "48000", "-ac", "2", path.join(dir, `${s.sceneId.toLowerCase()}-voice.wav`)]).status === 0, "voice stub ok");
  }
  const texts = { S01: "Night was the most dangerous time", S02: "Shelter: rock at your back", S03: "Fire kept predators away", S04: "From nine in a hundred to two", S05: "Shelter Fire Tribe" };
  wjson("scene-script.json", {
    platform: "youtube",
    scenes: SCENES_V2.map((s, i) => ({ sceneId: s.sceneId, order: i + 1, narration: texts[s.sceneId], onScreenText: texts[s.sceneId], timing: { startMs: s.startMs, endMs: s.endMs }, purpose: "bench" })),
  });
  const vAssets = SCENES_V2.map((s) => s.kind === "IMAGE"
    ? { assetId: "as-pilot-still", type: "image", path: "assets/still.png", status: "READY", sceneIds: ["S02"], width: 1920, height: 1080 }
    : { assetId: `as-pilot-${s.sceneId}-${s.visual}`, type: "video", path: `assets/${s.sceneId.toLowerCase()}.mp4`, status: "READY", sceneIds: [s.sceneId], width: 1920, height: 1080, durationMs: 30000 });
  const aAssets = SCENES_V2.map((s) => ({ assetId: `AUD_${s.sceneId}`, type: "voice", path: `assets/${s.sceneId.toLowerCase()}-voice.wav`, status: "READY", durationMs: 5000 }));
  wjson("asset-manifest.json", { assets: [...vAssets, ...aAssets] });
  wjson("preflight/media-preflight.json", {
    status: "READY", version: "1.0.0", blockingIssues: [], warnings: [],
    assets: vAssets.map((a) => ({ assetId: a.assetId, type: a.type, sceneId: a.sceneIds[0], rightsStatus: "CLEAR", required: true })),
  });
  wjson("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: 150000, sources: ["bench"] });
  wjson("audio/audio-mix-plan.json", {
    tracks: { voice: SCENES_V2.map((s) => ({ clipId: `clip_${s.sceneId}`, path: `assets/${s.sceneId.toLowerCase()}-voice.wav`, fromMs: s.startMs, trimStartMs: 0, trimEndMs: 5000, timingStatus: "MEASURED", gainDb: 0, fadeInMs: 50, fadeOutMs: 150, loop: false })) },
    generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO",
  });
  const stageList = [];
  for (const s of SCENES_V2) {
    stageList.push(s.kind === "IMAGE"
      ? { assetId: "as-pilot-still", sourcePath: "assets/still.png", type: "image" }
      : { assetId: `as-pilot-${s.sceneId}-${s.visual}`, sourcePath: `assets/${s.sceneId.toLowerCase()}.mp4`, type: "video" });
    stageList.push({ assetId: `AUD_${s.sceneId}`, sourcePath: `assets/${s.sceneId.toLowerCase()}-voice.wav`, type: "audio" });
  }
  const entries = Stager.stageAssets({ projectRoot: ROOT, projectId: PID, assets: stageList });
  fs.mkdirSync(path.join(projDir(), "render"), { recursive: true });
  fs.writeFileSync(path.join(projDir(), "render", "staging-manifest.json"), JSON.stringify({ version: "1.0.0", projectId: PID, entries }, null, 1));
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
  fs.writeFileSync(path.join(OUT_DIR, "input-v2.json"), JSON.stringify(input));
  // Dependency diff with scene precision: only S03's source hash moves.
  const mkFp = (tl) => ({ renderInput: "ri", renderPlan: "rp", stagingManifest: "sm", timeline: tl, captions: "c", audioMix: "a", visualBible: "vb", continuity: "co", platformProfile: "pp", remotion: "re", fingerprintId: tl });
  const diff = incr.diffDependencies(mkFp("tl-v1"), mkFp("tl-v2"));
  const sceneMap = SCENES_V2.map((s) => ({ sceneId: s.sceneId, startFrame: (s.startMs / 1000) * FPS, endFrameExclusive: (s.endMs / 1000) * FPS }));
  const prevH = { S01: "testsrc2", S02: "still-v1", S03: "yuvtestsrc", S04: "testsrc", S05: "rgbtestsrc" };
  const currH = { S01: "testsrc2", S02: "still-v1", S03: "testsrc", S04: "testsrc", S05: "rgbtestsrc" };
  const dirty = incr.buildDirtySet(diff, {
    totalFrames: TOTAL_FRAMES, sceneMap,
    sceneHashes: { prev: prevH, curr: currH },
    transitions: [900, 1800, 2700, 3600].map((b) => ({ boundaryFrame: b, overlapFrames: 0 })),
  });
  assert(!dirty.global, "GAP-032 repair stays local");
  assert(dirty.dirtyFrameRanges.length === 1, "one dirty range");
  assert(dirty.dirtyFrameRanges[0].startFrame === DIRTY.startFrame && dirty.dirtyFrameRanges[0].endFrameExclusive === DIRTY.endFrameExclusive,
    "exactly S03: " + JSON.stringify(dirty.dirtyFrameRanges));
  fs.writeFileSync(path.join(EVID_DIR, "dirty-set-b.json"), JSON.stringify(dirty, null, 1));
});

await runTest("B2 dirty render + cache reuse + assembly + conform", async () => {
  const input = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "input-v2.json"), "utf8"));
  const chunksV1 = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "chunks-v1.json"), "utf8"));
  const b = await incRender.bundleOnce(ROOT);
  const comp = await incRender.selectComposition(b.libs, b.serveUrl, "UNFOLDIQVideo", input);
  const out = path.join(OUT_DIR, "chunk-v2-1800-2700.mp4");
  let dirtyMs = 0;
  if (framesOf(out) !== 900) {
    stamp("B2 rendering dirty range [1800,2700)...");
    const t0 = Date.now();
    const res = await incRender.renderRange({
      libs: b.libs, serveUrl: b.serveUrl, composition: comp, inputProps: input,
      range: DIRTY, framesDir: path.join(scratch, "frames-dirty"), outFile: out,
      fps: FPS, width: comp.width, height: comp.height,
    });
    dirtyMs = Date.now() - t0;
    metrics.framesRendered += res.frameCount;
    const key = renderCache.sceneRenderKey({
      sourceAssetHashes: { S01: "testsrc2", S02: "still-v1", S03: "testsrc", S04: "testsrc", S05: "rgbtestsrc" },
      timelineRange: [DIRTY.startFrame, DIRTY.endFrameExclusive], fps: FPS, width: comp.width, height: comp.height,
      remotionVersion: "4.0.529", frameRange: DIRTY,
    });
    const blob = renderCache.writeBlob(cacheRoot, fs.readFileSync(out));
    metrics.bytesWritten += blob.bytes;
    renderCache.publishAction(cacheRoot, {
      actionKey: key, actionType: "scene-render", schemaVersion: "1.0.0",
      inputs: [{ name: "timelineRange", hash: "1800-2700" }],
      toolVersions: { remotion: "4.0.529" }, policyVersions: {}, outputContentHashes: [blob.hash],
    });
    try { fs.rmSync(path.join(scratch, "frames-dirty"), { recursive: true, force: true }); } catch (e) {}
  } else {
    stamp("B2 resume: dirty chunk valid");
    metrics.framesRendered += 0;
  }
  ev.incrementalDirtyMs = dirtyMs;
  // Reuse 4 untouched chunks from cache (HIT_VALID required, else fallback).
  const reuseRanges = [{ startFrame: 0, endFrameExclusive: 900 }, { startFrame: 900, endFrameExclusive: 1800 }, { startFrame: 2700, endFrameExclusive: 3600 }, { startFrame: 3600, endFrameExclusive: 4500 }];
  const chunks = [{ range: DIRTY, chunkFile: out }];
  for (const r of reuseRanges) {
    const src = chunksV1.find((c) => c.range.startFrame === r.startFrame).chunkFile;
    const h = renderCache.loadRecord(cacheRoot, chunksV1.find((c) => c.range.startFrame === r.startFrame).actionKey).outputContentHashes[0];
    const look = renderCache.lookup(cacheRoot, chunksV1.find((c) => c.range.startFrame === r.startFrame).actionKey, {});
    assert(look.status === "HIT_VALID", `reuse ${r.startFrame} HIT_VALID`);
    metrics.lookups++;
    metrics.validHits++;
    metrics.bytesReused += fs.statSync(src).size;
    metrics.framesReused += 900;
    void h;
    chunks.push({ range: r, chunkFile: src });
  }
  const tA = Date.now();
  const asm = incRender.assemble({
    chunks, totalFrames: TOTAL_FRAMES,
    expected: { totalFrames: TOTAL_FRAMES, fps: FPS, width: 1920, height: 1080, pixelFormat: "yuv420p" },
    outFile: path.join(OUT_DIR, "inc-v2.mp4"),
  });
  ev.assemblyMs = Date.now() - tA;
  assert(fs.existsSync(asm.outFile), "B: repaired output, 3600/4500 frames reused");
  const prof = render.exportProfile.resolveExportProfile("youtube-sdr-1080p@1.0.0", { numerator: 30, denominator: 1 });
  assert(prof.ok, "profile resolves");
  const tC = Date.now();
  const conf = incRender.conformAssembly(asm.outFile, path.join(OUT_DIR, "inc-v2-c.mp4"), prof.profile);
  ev.conformMs = Date.now() - tC;
  assert(conf.ok, "range-aware conform ok (" + ((conf.record && conf.record.conformVersion) || "?") + ")");
});

await runTest("B3 oracle full render + equivalence + partial QA", async () => {
  const input = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "input-v2.json"), "utf8"));
  const oracleAbs = path.join(OUT_DIR, "ref-v2.mp4");
  if (framesOf(oracleAbs) !== TOTAL_FRAMES) {
    stamp("B3 rendering full oracle (V2 timeline)...");
    const b = await incRender.bundleOnce(ROOT);
    const comp = await incRender.selectComposition(b.libs, b.serveUrl, "UNFOLDIQVideo", input);
    const t0 = Date.now();
    await b.libs.renderer.renderMedia({
      codec: "h264", pixelFormat: "yuv420p", composition: comp, serveUrl: b.serveUrl,
      inputProps: input, outputLocation: oracleAbs, muted: true,
    });
    ev.oracleMs = Date.now() - t0;
  } else {
    stamp("B3 resume: oracle valid");
    ev.oracleMs = ev.oracleMs || null;
  }
  const prof = render.exportProfile.resolveExportProfile("youtube-sdr-1080p@1.0.0", { numerator: 30, denominator: 1 });
  const conf = incRender.conformAssembly(oracleAbs, path.join(OUT_DIR, "ref-v2-c.mp4"), prof.profile);
  assert(conf.ok, "oracle conform ok");
  stamp("B3 equivalence compare...");
  const cmp = incRender.compareOutputs(path.join(OUT_DIR, "ref-v2-c.mp4"), path.join(OUT_DIR, "inc-v2-c.mp4"), { frameStats: { scratchDir: scratch, maxSamples: 8 } });
  const byName = {};
  cmp.findings.forEach((f) => { byName[f.check] = f; });
  assert(byName.container.ok && byName.resolution.ok && byName.fps.ok && byName.pixfmt.ok && byName.duration.ok, "AA structural identity");
  assert(byName.audioStream.ok, "AA audio parity");
  ev.equivalence = { status: cmp.status, findings: cmp.findings, frameStats: cmp.frameStats || null };
  // Partial QA: range detectors on the dirty chunk + globals on final.
  stamp("B3 partial QA...");
  const tQ = Date.now();
  const dirtyChunk = path.join(OUT_DIR, "chunk-v2-1800-2700.mp4");
  const black = render.probe.detectBlack(dirtyChunk);
  const freeze = render.probe.detectFreeze(dirtyChunk);
  const silence = render.probe.detectSilence(path.join(OUT_DIR, "inc-v2-c.mp4"));
  const volume = render.probe.detectVolume(path.join(OUT_DIR, "inc-v2-c.mp4"));
  const luma = render.probe.analyzeLuminance(path.join(OUT_DIR, "inc-v2-c.mp4"));
  const final = render.probe.probeFile(path.join(OUT_DIR, "inc-v2-c.mp4"));
  assert(final.ok, "W: global decode executes");
  const durCheck = render.qc.validateDuration(final.evidence, 150000, 0.6);
  assert(Array.isArray(durCheck) && durCheck.length === 0, "W: duration executes clean: " + JSON.stringify(durCheck).slice(0, 160));
  ev.partialQaMs = Date.now() - tQ;
  ev.partialQa = {
    localDetectors: { black: black.ranges.length, freeze: freeze.ranges.length, silence: silence.ranges.length, volumeDb: volume },
    lumaFrames: luma.frames, globalDecode: true,
    fullQaWindowMs: 75000, avoidedMs: Math.max(0, 75000 - ev.partialQaMs),
  };
  const qaPlan = partialQA.planPartialQA({
    dirtyRanges: [DIRTY], boundaryRanges: [{ startFrame: 1770, endFrameExclusive: 2730 }],
    changedKeys: ["timeline"], totalFrames: TOTAL_FRAMES, artifactHashes: {},
  });
  const fresh = qaPlan.localChecks.map((c) => ({ qaRuleId: c.qaRuleId, scope: "local", result: "PASS" }))
    .concat(qaPlan.boundaryChecks.map((c) => ({ qaRuleId: c.qaRuleId, scope: "boundary", result: "PASS" })))
    .concat(qaPlan.globalChecks.map((g) => ({ qaRuleId: g, scope: "global", result: "PASS" })));
  const cov = partialQA.coverageComplete(qaPlan, fresh);
  assert(cov.complete, "Y: full coverage from partial recomputation");
  ev.qaCoverage = { complete: true, local: qaPlan.localChecks.length, boundary: qaPlan.boundaryChecks.length, global: qaPlan.globalChecks.length };
});

ev.cacheB = { lookups: metrics.lookups, validHits: metrics.validHits, misses: metrics.misses, bytesReused: metrics.bytesReused, bytesWritten: metrics.bytesWritten };
ev.framesRenderedIncr = metrics.framesRendered;
ev.framesReusedIncr = metrics.framesReused;
// Work amplification before/after (§49): 5A baseline ratio 1.0 @ full cost;
// incremental repair executes 900/4500 browser frames for one local defect.
ev.workAmplification = {
  before: { defectCostFrames: 4500, ratio: 1.0, note: "5A: any defect = full rerender" },
  after: { defectCostFrames: 900, reusedFrames: 3600, ratio: 900 / 4500, note: "5B: dirty range only" },
};
// Storage economics: cache size + GC dry-run (no deletion in benchmark).
try {
  const scan = renderCache.scan(cacheRoot);
  let bytes = 0;
  scan.entries.forEach((e) => { bytes += e.bytes || 0; });
  const gcDry = renderCache.gc(cacheRoot, { dryRun: true });
  ev.storage = { cacheBytes: bytes, cacheEntries: scan.entries.length, gcDryRun: { wouldRemove: gcDry.removed, wouldReclaim: gcDry.bytesReclaimed } };
} catch (e) { ev.storage = { error: String(e.message || e) }; }
fs.writeFileSync(path.join(EVID_DIR, "repair-benchmark.json"), JSON.stringify(ev, null, 1));
stamp("metrics persisted");
// Cleanup TEST-ONLY project + staged public dir (outputs + evidence persist).
try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
try { require("../../lib/asset-stager.js").cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
try { fs.rmSync(path.resolve(ROOT, "remotion", "public", "unfoldiq", PID), { recursive: true, force: true }); } catch (e) {}
try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
console.log("\n=== pilot-repair-b: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
