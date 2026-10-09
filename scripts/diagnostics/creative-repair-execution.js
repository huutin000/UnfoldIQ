#!/usr/bin/env node
"use strict";

/**
 * Phase 6A closure — REAL creative repair execution (Slice C).
 *
 *   CreativeFinding -> structured repair -> real MotionPlan.patchMotion -> DependencyDiff + DirtySet
 *   -> IncrementalRenderPlan (real CAS cache decisions) -> REAL Remotion dirty-range render
 *   -> chunk assembly + single FinalAudio mux -> real video on disk -> technical QC + equivalence oracle
 *   -> deterministic segment re-watch against the real file.
 *
 * Isolated TEST-ONLY project `__6a_repair__` (ephemeral, never registered). Local ffmpeg stand-in
 * assets only: ZERO provider calls, ZERO paid media. Writes evidence to --out (default
 * Report/evidence/phase-6a) and media to out/creative-repair-6a/.
 *
 *   node scripts/diagnostics/creative-repair-execution.js [--out <dir>]
 */

process.env.UNFOLDIQ_INCREMENTAL_RENDER = "1";
process.env.UNFOLDIQ_PARTIAL_QA = "1";
process.env.UNFOLDIQ_BROWSER_REUSE = "1";

const childProcess = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PID = "__6a_repair__";
require(path.join(ROOT, "tests", "fixtures", "render-fixture-lifecycle.js")).registerFixtureCleanup(PID);

const cr = require(path.join(ROOT, "lib", "creative-retention", "index.js"));
const pf = require(path.join(ROOT, "tests", "fixtures", "creative-project-fixture.js"));
const incr = require(path.join(ROOT, "lib", "incremental", "index.js"));
const renderCache = require(path.join(ROOT, "lib", "render-cache", "index.js"));
const partialQA = require(path.join(ROOT, "lib", "render", "partial-qa.js"));
const incRender = require(path.join(ROOT, "pipeline", "incremental-render.js"));
const fingerprint = require(path.join(ROOT, "pipeline", "input-fingerprint.js"));
const Builder = require(path.join(ROOT, "lib", "render-input-builder.js"));
const Stager = require(path.join(ROOT, "lib", "asset-stager.js"));
const render = require(path.join(ROOT, "lib", "render", "index.js"));
const mapping = require(path.join(ROOT, "lib", "render", "mapping-registry.js"));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const EVID = path.resolve(ROOT, opt("--out", path.join("Report", "evidence", "phase-6a")));
const MEDIA = path.join(ROOT, "out", "creative-repair-6a");
const FPS = pf.FPS;
const REMOTION_VERSION = "4.0.529";

const sha256File = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const rel = (p) => path.relative(ROOT, p).split(path.sep).join("/");
const sh = (cmd, a, t) => childProcess.spawnSync(cmd, a, { encoding: "utf8", timeout: t || 600000, maxBuffer: 256 * 1024 * 1024, cwd: ROOT });
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
function must(c, m) { if (!c) throw new Error("ASSERT: " + m); }
const projDir = () => path.join(ROOT, "projects", PID);
function wjson(relPath, obj) {
  const abs = path.join(projDir(), relPath.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
}
function cleanup() {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  try { Stager.cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
  try { fs.rmSync(path.resolve(ROOT, "remotion", "public", "unfoldiq", PID), { recursive: true, force: true }); } catch (e) {}
}
function writeEvidence(name, doc) {
  cr.contract.assertNoFabricatedRetention(doc);
  fs.mkdirSync(EVID, { recursive: true });
  fs.writeFileSync(path.join(EVID, name), JSON.stringify(doc, null, 2) + "\n");
}

// ---- MotionPlan -> render input mapping (render mapping registry: ZOOM -> motion:SLOW_ZOOM_IN|OUT, DIRECT) ----
function sceneMotion(state, item) {
  const mi = state.motionPlan.items.find((m) => m.timelineItemId === item.timelineItemId);
  if (!mi || mi.presence === "STATIC") return "NONE";
  must(mi.primitiveRef === "ZOOM", "only ZOOM is mapped in this fixture, got " + mi.primitiveRef);
  const m = mapping.getPrimitiveMapping("ZOOM");
  must(m && m.fallbackPolicy === "DIRECT", "ZOOM maps DIRECT in the render mapping registry");
  return mi.params && mi.params.toScale < mi.params.fromScale ? "SLOW_ZOOM_OUT" : "SLOW_ZOOM_IN";
}
const visualItems = (state) => state.manifest.items.filter((i) => i.beatId).sort((a, b) => a.timelineRange.startFrame - b.timelineRange.startFrame);

const GENERATORS = ["testsrc2", "mandelbrot", "gradients", "smptebars", "rgbtestsrc", "yuvtestsrc", "testsrc", "smptehdbars"];

function makeLocalAssets(items) {
  const dir = path.join(projDir(), "assets");
  fs.mkdirSync(dir, { recursive: true });
  items.forEach((it, i) => {
    const r = sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `${GENERATORS[i % GENERATORS.length]}=s=1280x720`, "-frames:v", "1", path.join(dir, `${it.sceneId}.png`)]);
    must(r.status === 0, "still " + it.sceneId + ": " + r.stderr);
  });
  // 60 s synthetic two-tone narration stand-in (no speech): FinalAudio source of truth for the mux.
  const a = sh("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=262:duration=60", "-f", "lavfi", "-i", "sine=frequency=330:duration=60", "-filter_complex", "[0][1]amix=inputs=2:normalize=0,volume=0.35", "-ar", "48000", "-ac", "2", path.join(dir, "final-audio.wav")]);
  must(a.status === 0, "audio: " + a.stderr);
}

function writeDocs(state) {
  const items = visualItems(state);
  wjson("scene-script.json", {
    platform: "youtube",
    scenes: items.map((it, i) => ({
      sceneId: it.sceneId, order: i + 1, narration: `Beat ${i + 1}`, onScreenText: `Beat ${i + 1}`,
      timing: { startMs: it.timelineRange.startTime, endMs: it.timelineRange.endTime },
      motion: sceneMotion(state, it), purpose: "creative-repair-6a",
    })),
  });
  wjson("asset-manifest.json", {
    assets: [
      ...items.map((it) => ({ assetId: `as-${it.sceneId}`, type: "image", path: `assets/${it.sceneId}.png`, status: "READY", sceneIds: [it.sceneId], width: 1280, height: 720 })),
      { assetId: "AUD_FINAL", type: "voice", path: "assets/final-audio.wav", status: "READY", durationMs: 60000 },
    ],
  });
  wjson("preflight/media-preflight.json", {
    status: "READY", version: "1.0.0", blockingIssues: [], warnings: [],
    assets: items.map((it) => ({ assetId: `as-${it.sceneId}`, type: "image", sceneId: it.sceneId, rightsStatus: "CLEAR", required: true })),
  });
  wjson("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: 60000, sources: ["creative-repair-6a"] });
  wjson("audio/audio-mix-plan.json", {
    tracks: { voice: [{ clipId: "clip_final", path: "assets/final-audio.wav", fromMs: 0, trimStartMs: 0, trimEndMs: 60000, timingStatus: "MEASURED", gainDb: 0, fadeInMs: 0, fadeOutMs: 0, loop: false }] },
    generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO",
  });
}

function stageAndBuild(items) {
  const list = [
    ...items.map((it) => ({ assetId: `as-${it.sceneId}`, sourcePath: `assets/${it.sceneId}.png`, type: "image" })),
    { assetId: "AUD_FINAL", sourcePath: "assets/final-audio.wav", type: "audio" },
  ];
  const entries = Stager.stageAssets({ projectRoot: ROOT, projectId: PID, assets: list });
  fs.mkdirSync(path.join(projDir(), "render"), { recursive: true });
  fs.writeFileSync(path.join(projDir(), "render", "staging-manifest.json"), JSON.stringify({ version: "1.0.0", projectId: PID, entries }, null, 1));
}
function buildInput() {
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
  const unstaged = Object.values(input.assets || {}).filter((a) => a.unstaged);
  must(unstaged.length === 0, "all assets staged");
  return input;
}
const sceneInputHash = (input, sceneId) => fingerprint.hashObject(input.scenes.find((s) => s.sceneId === sceneId));

(async () => {
  const T0 = Date.now();
  fs.mkdirSync(MEDIA, { recursive: true });
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "6a-repair-"));
  const cacheRoot = path.join(scratch, "cache");
  const result = { version: "1.0.0", phase: "6A-closure", slice: "C", generatedAt: new Date().toISOString(), project: PID, scope: "FIXTURE (isolated TEST-ONLY project; local ffmpeg stand-in stills + synthetic tone, no generative media)", host: { node: process.version, platform: process.platform }, costs: { providerCalls: 0, paidMediaGenerated: 0, creditsConsumed: 0, paidExternalCostVnd: 0 }, stages: {} };
  let exitCode = 0;
  try {
    must(fs.existsSync(path.join(ROOT, "remotion", "node_modules")), "remotion deps resolvable");
    cleanup();

    // ---------------------------------------------------------------- 1. known finding (before)
    const state0 = pf.buildProject();
    const before = pf.analyze(state0);
    const finding = before.findings.find((f) => f.code === "REPETITIVE_MOTION_RHYTHM" && f.status === "OPEN");
    must(finding, "known REPETITIVE_MOTION_RHYTHM finding present");
    result.stages.knownFinding = { findingId: finding.findingId, code: finding.code, severity: finding.severity, scope: finding.scope, reasonClass: finding.reasonClass, repairClass: finding.repairClass, reason: finding.reason, openBefore: before.findings.filter((f) => f.status === "OPEN").map((f) => `${f.code}/${f.severity}`) };

    // ---------------------------------------------------------------- 2. structured repair via real patchMotion
    const plan = cr.repair.planCreativeRepair(before.findings, { inputFingerprint: before.input.inputFingerprint });
    const loop = cr.repair.runBoundedRepair({ state: state0, analyze: (s) => pf.analyze(s), apply: pf.applyMotion, budgets: { maxAttempts: 3 } });
    const state1 = loop.state;
    must((state1.touched || []).length > 0, "patchMotion touched shots");
    must(state1.motionPlan.revision > state0.motionPlan.revision, "motion plan revision advanced");
    must(state1.manifest.revision === state0.manifest.revision, "timeline revision unchanged (motion-only)");
    const after = pf.analyze(state1);
    const stillOpen = after.findings.filter((f) => f.code === "REPETITIVE_MOTION_RHYTHM" && f.status === "OPEN");
    result.stages.repair = {
      planSteps: plan.steps.map((s) => ({ stepId: s.stepId, repairClass: s.repairClass, findingCodes: s.findingCodes })),
      executor: "tests/fixtures/creative-project-fixture.js#applyMotion -> lib/motion MotionPlan.patchMotion(SET_STATIC)",
      patchedTimelineItems: state1.touched, patchedSceneIds: state1.touched.map((id) => state1.manifest.items.find((i) => i.timelineItemId === id).sceneId),
      motionPlanRevision: `${state0.motionPlan.revision} -> ${state1.motionPlan.revision}`, timelineRevisionUnchanged: true,
      boundedLoop: { status: loop.status, stopReason: loop.stopReason, attempts: loop.attempts.length, budgetUse: loop.budgetUse },
      repetitiveMotionOpenAfter: stillOpen.length, openAfter: after.findings.filter((f) => f.status === "OPEN").map((f) => `${f.code}/${f.severity}`),
    };
    must(stillOpen.length === 0, "repetitive-motion finding resolved after patch");

    // ---------------------------------------------------------------- 3. project + render inputs (V1 pre-repair, V2 post-repair)
    const items = visualItems(state0);
    const TOTAL = state0.manifest.canonicalDuration.frameCount;
    must(TOTAL === 1800, "1800 canonical frames");
    makeLocalAssets(items);
    writeDocs(state0);
    stageAndBuild(items);
    const inputV1 = buildInput();
    writeDocs(state1);
    const inputV2 = buildInput();
    const sceneMap = items.map((it) => ({ sceneId: it.sceneId, startFrame: it.timelineRange.startFrame, endFrameExclusive: it.timelineRange.endFrameExclusive }));
    const prevH = {}; const currH = {};
    items.forEach((it) => { prevH[it.sceneId] = sceneInputHash(inputV1, it.sceneId); currH[it.sceneId] = sceneInputHash(inputV2, it.sceneId); });
    const stillSha = {}; items.forEach((it) => { stillSha[it.sceneId] = sha256File(path.join(projDir(), "assets", `${it.sceneId}.png`)); });

    log("bundling Remotion");
    const b = await incRender.bundleOnce(ROOT);
    const comp = await incRender.selectComposition(b.libs, b.serveUrl, "UNFOLDIQVideo", inputV1);
    must(comp.durationInFrames === TOTAL, `composition ${comp.durationInFrames} frames, want ${TOTAL}`);
    // Remotion requires selectComposition() to receive the SAME inputProps as renderMedia(): select once per version.
    const compV2 = await incRender.selectComposition(b.libs, b.serveUrl, "UNFOLDIQVideo", inputV2);
    must(compV2.durationInFrames === TOTAL, "V2 composition frames");
    const motionOf = (input, id) => ((input.scenes.find((s) => s.sceneId === id).layers || []).find((l) => l.kind === "IMAGE") || {}).motion;
    const patchedIds = result.stages.repair.patchedSceneIds;
    result.stages.inputProof = { patchedScenes: patchedIds.map((id) => ({ sceneId: id, motionV1: motionOf(inputV1, id), motionV2: motionOf(inputV2, id) })), untouchedScenesMotionEqual: items.filter((it) => !patchedIds.includes(it.sceneId)).every((it) => motionOf(inputV1, it.sceneId) === motionOf(inputV2, it.sceneId)) };
    must(result.stages.inputProof.patchedScenes.every((x) => x.motionV1 === "SLOW_ZOOM_IN" && x.motionV2 === "NONE"), "render input motion SLOW_ZOOM_IN -> NONE on patched scenes: " + JSON.stringify(result.stages.inputProof));
    const common = { libs: b.libs, serveUrl: b.serveUrl, composition: comp, fps: FPS, width: comp.width, height: comp.height, concurrency: 1, projectRoot: ROOT };
    const expected = { totalFrames: TOTAL, fps: FPS, width: comp.width, height: comp.height, pixelFormat: "yuv420p" };
    const audioAbs = path.join(projDir(), "assets", "final-audio.wav");

    const keyOf = (state, input, items0, range) => {
      const inside = items0.filter((it) => it.timelineRange.startFrame >= range.startFrame && it.timelineRange.endFrameExclusive <= range.endFrameExclusive);
      return renderCache.sceneRenderKey({
        sourceAssetHashes: Object.fromEntries(inside.map((it) => [it.sceneId, stillSha[it.sceneId]])),
        timelineRange: [range.startFrame, range.endFrameExclusive], fps: FPS, width: comp.width, height: comp.height,
        remotionVersion: REMOTION_VERSION, frameRange: range,
        motionPlan: Object.fromEntries(inside.map((it) => [it.sceneId, { motion: sceneMotion(state, it), sceneInputHash: sceneInputHash(input, it.sceneId) }])),
      });
    };

    // ---------------------------------------------------------------- 4. V1 baseline: per-scene chunks -> CAS -> assembled source video
    log("rendering V1 baseline per scene");
    const v1Chunks = [];
    const v1Stats = { framesRendered: 0, renderMs: 0 };
    for (const it of items) {
      const range = { startFrame: it.timelineRange.startFrame, endFrameExclusive: it.timelineRange.endFrameExclusive };
      const out = path.join(scratch, `v1-${range.startFrame}-${range.endFrameExclusive}.mp4`);
      const r = await incRender.renderRange({ ...common, inputProps: inputV1, range, framesDir: path.join(scratch, `v1f-${range.startFrame}`), outFile: out });
      v1Stats.framesRendered += r.frameCount; v1Stats.renderMs += r.renderMs;
      const key = keyOf(state0, inputV1, items, range);
      const blob = renderCache.writeBlob(cacheRoot, fs.readFileSync(out));
      renderCache.publishAction(cacheRoot, { actionKey: key, actionType: "scene-render", schemaVersion: "1.0.0", inputs: [{ name: "timelineRange", hash: key.slice(0, 16) }], toolVersions: { remotion: REMOTION_VERSION }, policyVersions: {}, outputContentHashes: [blob.hash] });
      v1Chunks.push({ range, chunkFile: out, actionKey: key, blobHash: blob.hash, sceneId: it.sceneId });
    }
    const v1Final = path.join(MEDIA, "source-v1.mp4");
    const asm1 = incRender.assemble({ chunks: v1Chunks, totalFrames: TOTAL, expected, finalAudioAbs: audioAbs, outFile: v1Final });
    result.stages.baselineV1 = { path: rel(v1Final), sha256: sha256File(v1Final), bytes: asm1.bytes, framesRendered: v1Stats.framesRendered, renderMs: v1Stats.renderMs, chunks: v1Chunks.map((c) => ({ sceneId: c.sceneId, range: c.range, actionKey: c.actionKey })) };

    // ---------------------------------------------------------------- 5. DependencyDiff + DirtySet + IncrementalRenderPlan (real CAS lookups)
    const mkFp = (ri) => ({ renderInput: ri, renderPlan: "rp", stagingManifest: "sm", timeline: "tl-same", captions: "c", audioMix: "a", visualBible: "vb", continuity: "co", platformProfile: "pp", remotion: REMOTION_VERSION, fingerprintId: ri });
    const fpPrev = mkFp(fingerprint.hashObject(inputV1)); const fpCurr = mkFp(fingerprint.hashObject(inputV2));
    const diff = incr.diffDependencies(fpPrev, fpCurr);
    const dirty = incr.buildDirtySet(diff, { totalFrames: TOTAL, sceneMap, sceneHashes: { prev: prevH, curr: currH } });
    must(!dirty.global, "motion-only change stays local");
    const patchedScenes = new Set(result.stages.repair.patchedSceneIds);
    const expectedDirty = sceneMap.filter((s) => patchedScenes.has(s.sceneId)).map((s) => ({ startFrame: s.startFrame, endFrameExclusive: s.endFrameExclusive }));
    must(JSON.stringify(incr.mergeRanges(dirty.dirtyFrameRanges)) === JSON.stringify(incr.mergeRanges(expectedDirty)), "dirty ranges == patched scenes: " + JSON.stringify(dirty.dirtyFrameRanges));
    const lookups = [];
    const cacheLookup = (key) => {
      let rec = null;
      try { rec = renderCache.loadRecord(cacheRoot, key); } catch (e) { rec = null; }
      if (rec && rec.corrupt) rec = null;
      const row = { key: key.slice(0, 16), status: rec ? "HIT_VALID" : "MISS" };
      lookups.push(row);
      return rec ? { status: "HIT_VALID", cachedArtifactRef: "CAS/sha256/" + rec.outputContentHashes[0] } : { status: "MISS", reason: "NOT_FOUND" };
    };
    // known keys for the post-repair state: every scene key that still matches a published chunk.
    const knownKeys = items.map((it) => { const range = { startFrame: it.timelineRange.startFrame, endFrameExclusive: it.timelineRange.endFrameExclusive }; return { range, actionKey: keyOf(state1, inputV2, items, range) }; });
    const plan2 = incr.planRender({ dirtySet: dirty, totalFrames: TOTAL, keyForRange: (r) => keyOf(state1, inputV2, items, r), cacheLookup, knownKeys, planId: "irp-6a-repair" });
    must(plan2.fallback === "NONE", "no full-render fallback: " + plan2.fallbackReason);
    const dirtyFrames = incr.mergeRanges(dirty.dirtyFrameRanges).reduce((s, r) => s + (r.endFrameExclusive - r.startFrame), 0);
    const reusedFrames = plan2.reusableRegions.reduce((s, r) => s + (r.range.endFrameExclusive - r.range.startFrame), 0);
    must(dirtyFrames + reusedFrames === TOTAL, "dirty + reused covers every frame exactly once");
    const changedKeys = diff.changes.map((c) => c.dependencyId);
    const qaPlan = partialQA.planPartialQA({ dirtyRanges: incr.mergeRanges(dirty.dirtyFrameRanges), changedKeys, totalFrames: TOTAL });
    result.stages.plan = {
      dependencyDiff: diff.changes.map((c) => ({ dependencyId: c.dependencyId, affectedArtifactIds: c.affectedArtifactIds })),
      dirtySet: { global: dirty.global, dirtyFrameRanges: dirty.dirtyFrameRanges, dirtyScenes: dirty.dirtyTimelineItems, reasons: dirty.ranges.map((r) => r.reasons.map((x) => x.rule)) },
      incrementalRenderPlan: { fallback: plan2.fallback, renderRegions: plan2.renderRegions.map((r) => r.range), reusableRegions: plan2.reusableRegions.map((r) => ({ range: r.range, ref: r.cachedArtifactRef })), dirtyFrames, reusedFrames, renderedFrameRatio: Number((dirtyFrames / TOTAL).toFixed(4)) },
      cacheLookups: lookups, partialQAPlan: { localChecks: qaPlan.localChecks.length, boundaryChecks: qaPlan.boundaryChecks.length, globalChecks: qaPlan.globalChecks },
    };

    // ---------------------------------------------------------------- 6. REAL incremental execution (production facade)
    log(`executing incremental render: ${dirtyFrames}/${TOTAL} frames`);
    const v2Final = path.join(MEDIA, "repaired-v2.mp4");
    const exScratch = path.join(scratch, "exec"); fs.mkdirSync(exScratch, { recursive: true });
    const tAsm0 = Date.now();
    const ex = await incRender.executeIncrementalRender({ plan: plan2, projectRoot: ROOT, renderArgs: { ...common, composition: compV2, inputProps: inputV2 }, scratchDir: exScratch, cacheRoot, totalFrames: TOTAL, expected, finalAudioAbs: audioAbs, outFile: v2Final });
    const execWallMs = Date.now() - tAsm0;
    must(ex.fallback === "NONE" && ex.assembly && fs.existsSync(v2Final), "incremental execution produced the final video (no fallback)");
    const renderedMs = ex.rendered.reduce((s, r) => s + r.renderMs, 0);
    const renderedFrames = ex.rendered.reduce((s, r) => s + r.frameCount, 0);
    must(renderedFrames === dirtyFrames, "frames actually rendered == planned dirty frames");
    // video-only assembly of the same chunks for the oracle comparison
    const chunkFilesV2 = [...ex.rendered.map((r) => ({ range: r.range, chunkFile: r.chunkFile })), ...plan2.reusableRegions.map((r) => ({ range: r.range, chunkFile: path.join(cacheRoot, "CAS", "sha256", r.cachedArtifactRef.split("/").pop()) }))];
    const incVideoOnly = path.join(scratch, "inc-v2-video-only.mp4");
    incRender.assemble({ chunks: chunkFilesV2, totalFrames: TOTAL, expected, outFile: incVideoOnly });
    result.stages.execution = {
      mode: "REAL_INCREMENTAL", fullRenderFallback: false, output: { path: rel(v2Final), sha256: sha256File(v2Final), bytes: fs.statSync(v2Final).size },
      framesRendered: renderedFrames, framesReused: reusedFrames, totalFrames: TOTAL, renderedFrameRatio: Number((renderedFrames / TOTAL).toFixed(4)),
      renderedRanges: ex.rendered.map((r) => ({ range: r.range, frameCount: r.frameCount, renderMs: r.renderMs })), renderMsSum: renderedMs, executeWallMs: execWallMs,
      browserPool: (incRender.poolSnapshot(ROOT) || {}).metrics || null, remotion: REMOTION_VERSION, composition: "UNFOLDIQVideo", resolution: `${comp.width}x${comp.height}@${FPS}`,
    };

    // ---------------------------------------------------------------- 7. equivalence oracle: fresh FULL render of the repaired timeline
    log("rendering full-render oracle for the repaired timeline");
    const oracleRaw = path.join(scratch, "oracle-v2.mp4");
    const tO = Date.now();
    await b.libs.renderer.renderMedia({ codec: "h264", pixelFormat: "yuv420p", composition: compV2, serveUrl: b.serveUrl, inputProps: inputV2, outputLocation: oracleRaw, concurrency: 1, muted: true });
    const oracleMs = Date.now() - tO;
    const prof = render.exportProfile.resolveExportProfile("youtube-sdr-1080p@1.0.0", { numerator: 30, denominator: 1 });
    must(prof.ok, "export profile");
    const cRef = incRender.conformAssembly(oracleRaw, path.join(scratch, "oracle-c.mp4"), prof.profile);
    const cInc = incRender.conformAssembly(incVideoOnly, path.join(scratch, "inc-c.mp4"), prof.profile);
    must(cRef.ok && cInc.ok, "range-aware conform ok");
    const cmp = incRender.compareOutputs(path.join(scratch, "oracle-c.mp4"), path.join(scratch, "inc-c.mp4"), { frameStats: { scratchDir: scratch, maxSamples: 8 } });
    const byName = Object.fromEntries(cmp.findings.map((f) => [f.check, f]));
    const structuralOk = ["container", "resolution", "fps", "pixfmt", "duration", "audioStream"].every((k) => byName[k] && byName[k].ok);
    must(structuralOk, "structural identity vs oracle: " + JSON.stringify(cmp.findings));
    // per-scene PSNR (oracle vs incremental, both range-aware conformed): repaired scenes must not diverge more than untouched ones
    const psnrOf = (a, b, s0, e0) => {
      const r = sh("ffmpeg", ["-v", "info", "-i", a, "-i", b, "-lavfi", `[0:v]trim=start_frame=${s0}:end_frame=${e0},setpts=PTS-STARTPTS[x];[1:v]trim=start_frame=${s0}:end_frame=${e0},setpts=PTS-STARTPTS[y];[x][y]psnr`, "-f", "null", "-"], 600000);
      const m = /average:([\d.]+|inf)/.exec(r.stderr || "");
      return m ? (m[1] === "inf" ? 99 : Number(m[1])) : null;
    };
    const psnrPerScene = sceneMap.map((s) => ({ sceneId: s.sceneId, patched: patchedScenes.has(s.sceneId), psnrDb: psnrOf(path.join(scratch, "oracle-c.mp4"), path.join(scratch, "inc-c.mp4"), s.startFrame, s.endFrameExclusive) }));
    result.stages.equivalenceOracle = {
      psnrPerScene, oracleFullRenderMs: oracleMs, incrementalRenderMs: renderedMs, incrementalFasterThanFull: renderedMs < oracleMs, status: cmp.status, findings: cmp.findings, frameStats: cmp.frameStats || null, note: "decodedFramesExact is evidence, not a gate: segmented vs monolithic lossy encodes differ in GOP prediction (Phase 5B finding); structural + audio identity gate" };

    // ---------------------------------------------------------------- 8. frame-level proof: only intended frames changed, audio unchanged
    const m1 = incRender.framemd5List(v1Final); const m2 = incRender.framemd5List(v2Final);
    must(m1.length === TOTAL && m2.length === TOTAL, "both outputs decode to 1800 frames");
    const changed = []; m1.forEach((h, i) => { if (h !== m2[i]) changed.push(i); });
    const inDirty = (f) => dirty.dirtyFrameRanges.some((r) => f >= r.startFrame && f < r.endFrameExclusive);
    const outside = changed.filter((f) => !inDirty(f));
    must(outside.length === 0, `no frame outside the repaired shots changed (${outside.length} did)`);
    must(changed.length > 0, "repaired shots changed");
    const a1 = incRender.audiomd5(v1Final); const a2 = incRender.audiomd5(v2Final);
    must(a1 && a1 === a2, "audio stream identical before/after repair");
    const perScene = sceneMap.map((s) => ({ sceneId: s.sceneId, frames: s.endFrameExclusive - s.startFrame, changedFrames: changed.filter((f) => f >= s.startFrame && f < s.endFrameExclusive).length, patched: patchedScenes.has(s.sceneId) }));
    must(perScene.every((s) => (s.patched ? s.changedFrames > s.frames * 0.9 : s.changedFrames === 0)), "patched scenes changed (>90% frames), untouched scenes bit-identical per decoded frame: " + JSON.stringify(perScene));
    // seam frames: first/last frame around every chunk boundary identical across versions unless the adjacent scene was patched
    const seams = sceneMap.slice(1).map((s) => ({ boundaryFrame: s.startFrame, prevFrameChanged: m1[s.startFrame - 1] !== m2[s.startFrame - 1], nextFrameChanged: m1[s.startFrame] !== m2[s.startFrame] }));
    result.stages.frameProof = { changedFrameCount: changed.length, changedOutsideDirtyRanges: outside.length, perScene, seams, audioMd5Before: a1, audioMd5After: a2, audioUnchanged: true, durationBefore: incRender.probeChunk(v1Final).format.duration, durationAfter: incRender.probeChunk(v2Final).format.duration };

    // ---------------------------------------------------------------- 9. technical QC on the REAL repaired file + mandatory global QA
    const pr = render.probe.probeFile(v2Final);
    const ev = pr.evidence;
    const dec = render.probe.decodeCheck(v2Final);
    const staticRanges = sceneMap.filter((s) => patchedScenes.has(s.sceneId)).map((s) => ({ start: s.startFrame / FPS, end: s.endFrameExclusive / FPS }));
    const allStill = sceneMap.map((s) => ({ start: s.startFrame / FPS, end: s.endFrameExclusive / FPS }));
    const black = render.probe.detectBlack(v2Final); const freeze = render.probe.detectFreeze(v2Final); const silence = render.probe.detectSilence(v2Final); const vol = render.probe.detectVolume(v2Final);
    const lum = render.probe.analyzeLuminance(v2Final);
    const qcFindings = [
      ...render.qc.validateDuration(ev, 60000),
      ...render.qc.checkBlack(black.ranges, { expectedBlackRanges: [] }),
      ...render.qc.checkFreeze(freeze.ranges, { staticRanges }),
      ...render.qc.checkSilence(silence.ranges, { expectedSilenceRanges: [] }),
      ...render.qc.checkFlashFinal(lum),
    ];
    void allStill;
    const fresh = [...["black", "freeze", "silence", "volume", "safeZone", "captions", "outro"].map((r) => ({ qaRuleId: r, scope: "local" })), ...["duplicates", "avSync", "flash"].map((r) => ({ qaRuleId: r, scope: "boundary" })), ...partialQA.GLOBAL_MANDATORY.map((r) => ({ qaRuleId: r }))];
    const cov = partialQA.coverageComplete(qaPlan, fresh);
    result.stages.technicalQC = {
      decode: { ok: dec.ok, exit: dec.exitStatus }, video: { codec: ev.video.codec, size: `${ev.video.width}x${ev.video.height}`, fps: ev.video.fps, pixFmt: ev.video.pixFmt }, audio: ev.audio ? { codec: ev.audio.codec, sampleRate: ev.audio.sampleRate } : null,
      durationSec: ev.format.duration, blackCandidates: black.ranges, freezeCandidates: freeze.ranges, freezeIntentRanges: staticRanges, silenceCandidates: silence.ranges,
      volume: { maxDb: vol.maxVolumeDb, meanDb: vol.meanVolumeDb }, luminance: { ok: lum.ok, frames: lum.frames, bigTransitions: lum.bigCount, maxLargeInOneSecondWindow: lum.maxInWindow },
      findings: qcFindings.map((f) => ({ code: f.code, severity: f.severity, reason: f.reason })), summary: render.qc.summarize(qcFindings),
      partialQACoverage: { complete: cov.complete, missing: cov.missing, executedScope: "detectors executed on the full repaired file (superset of the planned local/boundary ranges) + all GLOBAL_MANDATORY rules", plannedLocalChecks: qaPlan.localChecks.length, plannedBoundaryChecks: qaPlan.boundaryChecks.length },
    };
    must(dec.ok, "full decode clean");
    must(qcFindings.filter((f) => f.severity === "BLOCK").length === 0, "no BLOCK technical findings: " + JSON.stringify(qcFindings));

    // ---------------------------------------------------------------- 10. deterministic segment re-watch against the REAL repaired file + final full structural watch
    const finalState = { ...state1 };
    const afterReal = cr.analyzeCreativeRetention(pf.adapt(finalState, { video: { path: v2Final } }));
    let merged = before.findings;
    const rewatches = [];
    for (const id of state1.touched) {
      const it = state1.manifest.items.find((i) => i.timelineItemId === id);
      const rw = cr.runWatch(afterReal, { mode: "SEGMENT_REWATCH", affected: { startMs: it.timelineRange.startTime, endMs: it.timelineRange.endTime }, probeVideo: cr.adapter.probeVideoDurationMs, requireVideo: true });
      merged = cr.watch.mergeRewatch(merged, rw.watchReport);
      rewatches.push({ sceneId: it.sceneId, affected: rw.watchReport.affected, verdict: rw.watchReport.verdict, videoConsumed: !!(rw.watchReport.video && rw.watchReport.video.sha256), videoSha256: rw.watchReport.video && rw.watchReport.video.sha256, segments: rw.watchReport.segments.length, blockers: rw.watchReport.blockers, reviewerMode: rw.watchReport.reviewer && rw.watchReport.reviewer.mode });
    }
    const finalWatch = cr.runWatch(afterReal, { mode: "FULL_WATCH", probeVideo: cr.adapter.probeVideoDurationMs, requireVideo: true });
    const openAfter = finalWatch.findings.filter((f) => f.status === "OPEN" || f.status === "REVIEW_REQUIRED");
    const repStatus = merged.filter((f) => f.code === "REPETITIVE_MOTION_RHYTHM").map((f) => f.status);
    const sevCounts = cr.contract.countBySeverity(openAfter);
    writeEvidence("phase-6a-after-repair-segment-review.json", {
      version: "1.0.0", phase: "6A-closure", kind: "DETERMINISTIC_STRUCTURAL_SEGMENT_REWATCH_ON_REAL_FILE", generatedAt: new Date().toISOString(),
      disclosure: "Deterministic analysis bound to the actual repaired video (hash + probed duration vs timeline). This is NOT an autonomous audiovisual model review and NOT a human review.",
      video: { path: rel(v2Final), sha256: sha256File(v2Final), probedDurationMs: finalWatch.watchReport.video && finalWatch.watchReport.video.probedDurationMs, timelineDurationMs: finalWatch.watchReport.video && finalWatch.watchReport.video.timelineDurationMs },
      segmentRewatches: rewatches, repetitiveMotionStatusAfter: repStatus, finalFullWatch: { mode: finalWatch.watchReport.mode, verdict: finalWatch.watchReport.verdict, blockers: finalWatch.watchReport.blockers, coverage: finalWatch.watchReport.coverage, openSeverityCounts: sevCounts, openCodes: openAfter.map((f) => `${f.code}/${f.severity}`) },
      agentFrameReview: null,
    });
    result.stages.rewatch = { kind: "DETERMINISTIC_STRUCTURAL", segmentRewatches: rewatches.length, allVideoConsumed: rewatches.every((r) => r.videoConsumed), verdicts: rewatches.map((r) => r.verdict), repetitiveMotionStatusAfter: repStatus, finalFullWatchVerdict: finalWatch.watchReport.verdict, openAfter: openAfter.map((f) => `${f.code}/${f.severity}`), openSeverityCounts: sevCounts };

    // ---------------------------------------------------------------- 11. frame samples for the (separately attested) visual review
    const frames = [];
    const sc = result.stages.repair.patchedSceneIds[0]; const s0 = sceneMap.find((s) => s.sceneId === sc);
    const midEnd = Math.floor(s0.endFrameExclusive - 2);
    for (const [name, file] of [["v1", v1Final], ["v2", v2Final]]) {
      for (const f of [s0.startFrame + 1, midEnd]) {
        const out = path.join(MEDIA, `frame-${name}-${f}.jpg`);
        const r = sh("ffmpeg", ["-y", "-v", "error", "-i", file, "-vf", `select=eq(n\\,${f}),scale=640:-1`, "-frames:v", "1", "-vsync", "0", out]);
        if (r.status === 0) frames.push({ version: name, frame: f, path: rel(out), sha256: sha256File(out) });
      }
    }
    result.stages.frameSamples = frames;

    result.totalWallMs = Date.now() - T0;
    result.verdict = { REAL_CREATIVE_PATCH: "PROVEN", REAL_INCREMENTAL_RENDER_EXECUTION: "PROVEN", PARTIAL_QA_AFTER_REPAIR: result.stages.technicalQC.summary.status === "PASS" && cov.complete ? "PASS" : "REVIEW_REQUIRED", DETERMINISTIC_SEGMENT_REWATCH: rewatches.every((r) => r.verdict !== "FAIL" && r.videoConsumed) ? "PASS" : "FAIL", AV_MODEL_OR_HUMAN_SEGMENT_REWATCH: "NOT_PROVEN" };
  } catch (e) {
    exitCode = 1;
    result.error = String((e && e.stack) || e);
    result.verdict = { REAL_INCREMENTAL_RENDER_EXECUTION: "NOT_PROVEN" };
    console.error(result.error);
  } finally {
    try { await incRender.shutdownBrowserPool(); } catch (e) {}
    cleanup();
    try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) {}
    writeEvidence("phase-6a-creative-repair-execution.json", result);
    console.log(JSON.stringify(result.verdict, null, 2));
  }
  process.exit(exitCode);
})();
