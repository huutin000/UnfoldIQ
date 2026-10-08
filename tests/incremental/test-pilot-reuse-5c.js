"use strict";
// tests/incremental/test-pilot-reuse-5c.js — Phase 5C Task A: pilot-scale
// browser-reuse proof. Same 150s/4500f pilot, same 5 ranges, same policies.
// BASELINE: UNFOLDIQ_BROWSER_REUSE=0 (browser per range, 5B behavior).
// CANDIDATE: UNFOLDIQ_BROWSER_REUSE=1 (RendererBrowserPool).
// Compares browserStarts, rangeRenderWall, equivalence vs the 5B ref-v1
// oracle (range-aware conformed both sides, 5B §25 lesson), byte-identity
// across modes, and pool leak check. Resumable per-range under
// out/incremental-5c/ (probe-verified, like pilot-a).

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const OUT_DIR = path.join(ROOT, "out", "incremental-5b");
const OUT5C = path.join(ROOT, "out", "incremental-5c");
const EVID_DIR = path.join(ROOT, "Report", "evidence", "perf-5c");

const incRender = require("../../pipeline/incremental-render.js");
const Builder = require("../../lib/render-input-builder.js");

const FPS = 30;
const TOTAL_FRAMES = 4500;
const RANGES = [0, 900, 1800, 2700, 3600].map((s) => ({ startFrame: s, endFrameExclusive: s + 900 }));
// Pilot scenes identical to test-pilot-repair-a.js (5 x 30s @30fps).
const SCENES = [
  { sceneId: "S01", startMs: 0, endMs: 30000, visual: "testsrc2", kind: "VIDEO", text: "Night was the most dangerous time" },
  { sceneId: "S02", startMs: 30000, endMs: 60000, visual: "still", kind: "IMAGE", text: "Shelter: rock at your back" },
  { sceneId: "S03", startMs: 60000, endMs: 90000, visual: "yuvtestsrc", kind: "VIDEO", text: "Fire kept predators away" },
  { sceneId: "S04", startMs: 90000, endMs: 120000, visual: "testsrc", kind: "VIDEO", text: "From nine in a hundred to two" },
  { sceneId: "S05", startMs: 120000, endMs: 150000, visual: "rgbtestsrc", kind: "VIDEO", text: "Shelter Fire Tribe" },
];
const PILOT_PID = "__5b_pilot__";
require("../fixtures/render-fixture-lifecycle.js").registerFixtureCleanup(PILOT_PID);

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
function rssMB() { return Math.round(process.memoryUsage().rss / 1048576); }
function framesOf(abs) {
  try {
    const p = incRender.probeChunk(abs);
    return p.video.nbFrames || Math.round(p.format.duration * incRender.parseFps(p.video.fps));
  } catch (e) { return -1; }
}

(async () => {
fs.mkdirSync(OUT5C, { recursive: true });
fs.mkdirSync(EVID_DIR, { recursive: true });
if (process.env.PILOT_REUSE_FORCE === "1") {
  for (const f of fs.readdirSync(OUT5C)) {
    if (/-chunk-\d+-\d+\.mp4$/.test(f)) try { fs.rmSync(path.join(OUT5C, f), { force: true }); } catch (e) {}
  }
  stamp("PILOT_REUSE_FORCE=1: chunk outputs cleared, full re-render");
}
const ev = { version: "1.0.0", phase: "5C-A", scale: "pilot (4500 frames, 1920x1080@30)", ranges: RANGES };
let ctx = null;

await runTest("SETUP bundle + composition from existing pilot project", async () => {
  assert(fs.existsSync(path.join(OUT_DIR, "ref-v1.mp4")), "5B ref-v1 oracle present");
  // Self-sufficient fixture: test-pilot-repair-b cleans projects/__5b_pilot__
  // on every incremental-suite run, so rebuild docs+assets deterministically
  // (identical lavfi bytes to pilot-a) when missing.
  if (!fs.existsSync(path.join(ROOT, "projects", PILOT_PID, "asset-manifest.json"))) {
    stamp("SETUP rebuilding pilot fixture (repair-b cleanup removed it)...");
    const Stager = require("../../lib/asset-stager.js");
    const dir = path.join(ROOT, "projects", PILOT_PID, "assets");
    fs.mkdirSync(dir, { recursive: true });
    for (const s of SCENES) {
      if (s.kind === "IMAGE") {
        assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x14202e:s=1920x1080:d=0.1", "-frames:v", "1", path.join(dir, "still.png")]).status === 0, "still ok");
      } else {
        assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", `${s.visual}=s=1920x1080:r=30:d=30`, "-pix_fmt", "yuv420p", path.join(dir, `${s.sceneId.toLowerCase()}.mp4`)]).status === 0, `clip ok ${s.sceneId}`);
      }
      assert(sh("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=5", "-ar", "48000", "-ac", "2", path.join(dir, `${s.sceneId.toLowerCase()}-voice.wav`)]).status === 0, "voice ok");
    }
    const wjson = (rel, obj) => {
      const abs = path.join(ROOT, "projects", PILOT_PID, rel.split("/").join(path.sep));
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
    };
    wjson("scene-script.json", { platform: "youtube", scenes: SCENES.map((s) => ({ sceneId: s.sceneId, order: SCENES.indexOf(s) + 1, narration: s.text, onScreenText: s.text, timing: { startMs: s.startMs, endMs: s.endMs }, purpose: "bench" })) });
    const vAssets = SCENES.map((s) => s.kind === "IMAGE"
      ? { assetId: "as-pilot-still", type: "image", path: "assets/still.png", status: "READY", sceneIds: ["S02"], width: 1920, height: 1080 }
      : { assetId: `as-pilot-${s.visual}`, type: "video", path: `assets/${s.sceneId.toLowerCase()}.mp4`, status: "READY", sceneIds: [s.sceneId], width: 1920, height: 1080, durationMs: 30000 });
    const aAssets = SCENES.map((s) => ({ assetId: `AUD_${s.sceneId}`, type: "voice", path: `assets/${s.sceneId.toLowerCase()}-voice.wav`, status: "READY", durationMs: 5000 }));
    wjson("asset-manifest.json", { assets: [...vAssets, ...aAssets] });
    wjson("preflight/media-preflight.json", { status: "READY", version: "1.0.0", blockingIssues: [], warnings: [],
      assets: vAssets.map((a) => ({ assetId: a.assetId, type: a.type, sceneId: a.sceneIds[0], rightsStatus: "CLEAR", required: true })) });
    wjson("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: 150000, sources: ["bench"] });
    wjson("audio/audio-mix-plan.json", { tracks: { voice: SCENES.map((s) => ({ clipId: `clip_${s.sceneId}`, path: `assets/${s.sceneId.toLowerCase()}-voice.wav`, fromMs: s.startMs, trimStartMs: 0, trimEndMs: 5000, timingStatus: "MEASURED", gainDb: 0, fadeInMs: 50, fadeOutMs: 150, loop: false })) }, generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO" });
    const stageList = [];
    for (const s of SCENES) {
      stageList.push(s.kind === "IMAGE"
        ? { assetId: "as-pilot-still", sourcePath: "assets/still.png", type: "image" }
        : { assetId: `as-pilot-${s.visual}`, sourcePath: `assets/${s.sceneId.toLowerCase()}.mp4`, type: "video" });
      stageList.push({ assetId: `AUD_${s.sceneId}`, sourcePath: `assets/${s.sceneId.toLowerCase()}-voice.wav`, type: "audio" });
    }
    const entries = Stager.stageAssets({ projectRoot: ROOT, projectId: PILOT_PID, assets: stageList });
    fs.mkdirSync(path.join(ROOT, "projects", PILOT_PID, "render"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "projects", PILOT_PID, "render", "staging-manifest.json"), JSON.stringify({ version: "1.0.0", projectId: PILOT_PID, entries }, null, 1));
  }
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PILOT_PID });
  const t0 = Date.now();
  const b = await incRender.bundleOnce(ROOT);
  ev.bundleMs = Date.now() - t0;
  const comp = await incRender.selectComposition(b.libs, b.serveUrl, "UNFOLDIQVideo", input);
  assert(comp.durationInFrames === TOTAL_FRAMES, "4500 frames, got " + comp.durationInFrames);
  ctx = { libs: b.libs, serveUrl: b.serveUrl, comp, input };
  stamp(`bundle ${ev.bundleMs}ms, RSS ${rssMB()}MB`);
});

async function renderAllRanges(tag, reuseFlag) {
  process.env.UNFOLDIQ_BROWSER_REUSE = reuseFlag;
  const walls = [];
  const files = [];
  let rssPeak = rssMB();
  for (const r of RANGES) {
    const out = path.join(OUT5C, `${tag}-chunk-${r.startFrame}-${r.endFrameExclusive}.mp4`);
    const fd = path.join(OUT5C, `${tag}-frames-${r.startFrame}-${r.endFrameExclusive}`);
    if (framesOf(out) === r.endFrameExclusive - r.startFrame) {
      stamp(`${tag} resume: chunk ${r.startFrame}-${r.endFrameExclusive} valid, skipping render`);
      walls.push({ range: r, wallMs: 0, resumed: true });
      files.push(out);
      continue;
    }
    stamp(`${tag} rendering range ${r.startFrame}-${r.endFrameExclusive} (reuse=${reuseFlag})...`);
    const t0 = Date.now();
    await incRender.renderRange({
      libs: ctx.libs, serveUrl: ctx.serveUrl, composition: ctx.comp, inputProps: ctx.input,
      range: r, framesDir: fd, outFile: out, fps: FPS,
      projectRoot: ROOT,
    });
    const wall = Date.now() - t0;
    walls.push({ range: r, wallMs: wall });
    files.push(out);
    rssPeak = Math.max(rssPeak, rssMB());
    try { fs.rmSync(fd, { recursive: true, force: true }); } catch (e) {}
    stamp(`${tag} range done in ${wall}ms, RSS ${rssMB()}MB`);
  }
  return { walls, files, rssPeakMB: rssPeak };
}

let base = null;
await runTest("BASELINE 5 ranges, browser per range (reuse=0)", async () => {
  base = await renderAllRanges("base", "0");
  base.totalMs = base.walls.reduce((a, w) => a + w.wallMs, 0);
  base.browserStarts = RANGES.length; // one renderMedia call = one browser start, no pool
  ev.baseline = { browserStarts: base.browserStarts, rangeWallsMs: base.walls, totalMs: base.totalMs, rssPeakMB: base.rssPeakMB };
  stamp(`BASELINE total ${base.totalMs}ms`);
});

let cand = null;
await runTest("CANDIDATE 5 ranges, pooled browser (reuse=1)", async () => {
  cand = await renderAllRanges("cand", "1");
  cand.totalMs = cand.walls.reduce((a, w) => a + w.wallMs, 0);
  const fullyResumed = cand.walls.every((w) => w.resumed);
  const snap = incRender.poolSnapshot(ROOT);
  if (!snap && fullyResumed) {
    // Full resume: no range re-rendered, so no pool exists in this process.
    // Inputs unchanged → carry the already-proven pool metrics forward.
    const prev = JSON.parse(fs.readFileSync(path.join(EVID_DIR, "pilot-reuse-benchmark.json"), "utf8"));
    assert(prev.candidate && prev.candidate.browserStarts === 1, "prior proof recorded");
    cand.pool = prev.candidate.pool;
    cand.fullyResumed = true;
    stamp("CANDIDATE fully resumed; carrying recorded pool metrics (starts=1, reuses=4)");
    return;
  }
  assert(snap, "pool exists after reuse=1 renders");
  cand.pool = { created: snap.metrics.created, reused: snap.metrics.reused, retired: snap.metrics.retired,
    live: snap.browsers.length, startupAvoidedMs: snap.metrics.startupAvoidedMs,
    policy: snap.policy, browsers: snap.browsers.map((b) => ({ jobsCompleted: b.jobsCompleted, startupMs: b.startupMs, ageMs: b.ageMs })) };
  ev.candidate = { browserStarts: snap.metrics.created, reusedLeases: snap.metrics.reused,
    rangeWallsMs: cand.walls, totalMs: cand.totalMs, rssPeakMB: cand.rssPeakMB, pool: cand.pool };
  assert(snap.metrics.created === 1, "exactly one browser for all 5 ranges, got " + snap.metrics.created);
  assert(snap.metrics.reused === 4, "4 reuses, got " + snap.metrics.reused);
  stamp(`CANDIDATE total ${cand.totalMs}ms, starts=${snap.metrics.created}`);
});

await runTest("startup demonstrably removed + chunks byte-identical", async () => {
  assert(cand.pool.created < base.browserStarts, "starts reduced 5 -> " + cand.pool.created);
  const avoided = cand.pool.startupAvoidedMs.reduce((a, b) => a + b, 0);
  assert(avoided > 0, "startup avoided recorded");
  ev.startupAvoidedTotalMs = avoided;
  ev.startsAvoided = base.browserStarts - cand.pool.created;
  for (let i = 0; i < RANGES.length; i++) {
    const a = fs.readFileSync(base.files[i]);
    const b2 = fs.readFileSync(cand.files[i]);
    assert(a.equals(b2), `range ${RANGES[i].startFrame} byte-identical (${a.length}B)`);
  }
});

await runTest("equivalence vs 5B ref-v1 oracle remains PASS (structural)", async () => {
  const chunks = RANGES.map((r, i) => ({ range: r, chunkFile: cand.files[i] }));
  const asm = incRender.assemble({ chunks, totalFrames: TOTAL_FRAMES,
    expected: { totalFrames: TOTAL_FRAMES, fps: FPS, width: 1920, height: 1080, pixelFormat: "yuv420p" },
    outFile: path.join(OUT5C, "inc-5c.mp4") });
  // 5B lesson (§25): raw chunk assembly is tv-range, direct renderMedia
  // output is full-range — conform BOTH sides range-aware before compare.
  const render = require("../../lib/render/index.js");
  const prof = render.exportProfile.resolveExportProfile("youtube-sdr-1080p@1.0.0", { numerator: 30, denominator: 1 });
  assert(prof.ok, "export profile resolves");
  const t0 = Date.now();
  const cRef = incRender.conformAssembly(path.join(OUT_DIR, "ref-v1.mp4"), path.join(OUT5C, "ref-5c-c.mp4"), prof.profile);
  const cInc = incRender.conformAssembly(asm.outFile, path.join(OUT5C, "inc-5c-c.mp4"), prof.profile);
  ev.conformMs = Date.now() - t0;
  assert(cRef.ok && cInc.ok, "range-aware conform ok");
  const cmp = incRender.compareOutputs(path.join(OUT5C, "ref-5c-c.mp4"), path.join(OUT5C, "inc-5c-c.mp4"), {});
  const byName = {};
  cmp.findings.forEach((f) => { byName[f.check] = f; });
  ev.equivalence = { status: cmp.status, findings: cmp.findings.map((f) => ({ check: f.check, ok: f.ok, detail: f.detail })) };
  assert(byName.container.ok && byName.resolution.ok && byName.fps.ok && byName.pixfmt.ok && byName.duration.ok,
    "structural identity: " + JSON.stringify(cmp.findings));
  assert(byName.audioStream.ok, "audio parity");
  stamp("equivalence structural PASS (decodedFramesExact expected-diff, not gated)");
});

await runTest("no browser resource leak", async () => {
  await incRender.shutdownBrowserPool();
  const snap = incRender.poolSnapshot(ROOT);
  const live = snap ? snap.browsers.length : 0;
  assert(live === 0, "pool empty after shutdown, got " + live);
  ev.leakCheck = { liveBrowsersAfterShutdown: live };
});

const anyRendered = base && cand && (base.walls.some((w) => !w.resumed) || cand.walls.some((w) => !w.resumed));
if (!base || !cand) {
  console.log("\n=== pilot-reuse-5c: " + passed + " passed, " + failed + " failed (ABORTED before evidence) ===");
  process.exit(1);
}
if (anyRendered) {
  fs.writeFileSync(path.join(EVID_DIR, "pilot-reuse-benchmark.json"), JSON.stringify(ev, null, 1));
} else {
  stamp("full resume: evidence file untouched (already-proven walls preserved)");
}
console.log("\n=== pilot-reuse-5c: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
})();
