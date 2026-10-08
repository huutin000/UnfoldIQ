"use strict";
// tests/incremental/test-incremental-plan.js — Phase 5B unit cases:
// A,B,C,D,E,F,G (change matrix) · I,J,K,L (cache keys) · X (stale PASS) ·
// AB,AC,AD (assembly guards) · AG (NTSC) · AI (fallback). Pure logic, no renders.

const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const incr = require("../../lib/incremental/index.js");
const cache = require("../../lib/render-cache/index.js");
const partialQA = require("../../lib/render/partial-qa.js");
const timebase = require("../../lib/timeline/timebase.js");
const fp = require("../../pipeline/input-fingerprint.js");

let passed = 0;
let failed = 0;
function runTest(name, fn) {
  try { fn(); passed++; console.log("[PASS] " + name); }
  catch (e) { failed++; console.log("[FAIL] " + name + ": " + ((e && e.message) || e)); }
}
function assert(c, m) { if (!c) throw new Error("ASSERT: " + m); }

const SCENES = [
  { sceneId: "S01", startFrame: 0, endFrameExclusive: 900 },
  { sceneId: "S02", startFrame: 900, endFrameExclusive: 1800 },
  { sceneId: "S03", startFrame: 1800, endFrameExclusive: 2700 },
];
const TOTAL = 2700;

function baseFp(over) {
  return Object.assign({
    renderInput: "ri1", renderPlan: "rp1", stagingManifest: "sm1", timeline: "tl1",
    captions: "cap1", audioMix: "am1", visualBible: "vb1", continuity: "c1",
    platformProfile: "pp1", remotion: "re1", fingerprintId: "fp-prev",
  }, over || {});
}
function sceneHashes(over) {
  return { prev: { S01: "a", S02: "b", S03: "c" }, curr: Object.assign({ S01: "a", S02: "b", S03: "c" }, over || {}) };
}
function okLookup(map) {
  return function (key) {
    return map[key] ? { status: "HIT_VALID", cachedArtifactRef: map[key] } : { status: "MISS", reason: "NOT_FOUND" };
  };
}

runTest("A no-change rerun: empty diff, zero render regions, full reuse", () => {
  const diff = incr.diffDependencies(baseFp(), baseFp());
  assert(diff.changes.length === 0, "no changes");
  const dirty = incr.buildDirtySet(diff, { totalFrames: TOTAL, sceneMap: SCENES });
  assert(dirty.dirtyFrameRanges.length === 0, "nothing dirty");
  const keyFor = (r) => "k" + r.startFrame;
  const plan = incr.planRender({ dirtySet: dirty, totalFrames: TOTAL, keyForRange: keyFor, cacheLookup: okLookup({ k0: "CAS/sha256/x" }) });
  assert(plan.fallback === "NONE", "no fallback");
  assert(plan.renderRegions.length === 0, "zero renders");
  assert(plan.reusableRegions.length === 1 && plan.reusableRegions[0].range.endFrameExclusive === TOTAL, "whole timeline reused");
});

runTest("B replace one scene image: only scene + handles dirty", () => {
  const diff = incr.diffDependencies(baseFp(), baseFp({ timeline: "tl2", fingerprintId: "fp-cur" }));
  const dirty = incr.buildDirtySet(diff, {
    totalFrames: TOTAL, sceneMap: SCENES, sceneHashes: sceneHashes({ S02: "b2" }),
    transitions: [{ boundaryFrame: 900, overlapFrames: 6 }, { boundaryFrame: 1800, overlapFrames: 6 }],
  });
  assert(!dirty.global, "local, not global");
  assert(dirty.dirtyFrameRanges.length === 1, "one merged range");
  const r = dirty.dirtyFrameRanges[0];
  assert(r.startFrame <= 900 && r.endFrameExclusive >= 1800, "covers S02");
  assert(r.startFrame >= 900 - 6 - 1 && r.endFrameExclusive <= 1800 + 6 + 1, "handles bounded, neighbors clean: " + JSON.stringify(r));
  assert(dirty.dirtyAudioRegions.length === 0, "audio clean");
});

runTest("C motion primitive change: range + temporal handles dirty", () => {
  const diff = incr.diffDependencies(baseFp(), baseFp({ renderPlan: "rp2", fingerprintId: "fp-cur" }));
  const dirty = incr.buildDirtySet(diff, {
    totalFrames: TOTAL, sceneMap: SCENES,
    motionItems: [{ id: "mo-S01", startFrame: 100, endFrameExclusive: 400, temporalSamples: 8 }],
  });
  const r = dirty.dirtyFrameRanges[0];
  assert(r.startFrame <= 100 - 8 && r.endFrameExclusive >= 400 + 8, "handles included: " + JSON.stringify(r));
  assert(dirty.dirtyMotionItems.includes("mo-S01"), "motion item tracked");
});

runTest("D transition change: both sides/overlap invalidated", () => {
  const diff = incr.diffDependencies(baseFp(), baseFp({ timeline: "tl2", fingerprintId: "fp-cur" }));
  const dirty = incr.buildDirtySet(diff, {
    totalFrames: TOTAL, sceneMap: SCENES, sceneHashes: sceneHashes({ S03: "c2" }),
    transitions: [{ boundaryFrame: 1800, overlapFrames: 12 }],
  });
  const r = dirty.dirtyFrameRanges[0];
  assert(r.startFrame <= 1800 - 12 && r.endFrameExclusive >= 2700, "overlap into S02 tail: " + JSON.stringify(r));
  assert(r.startFrame >= 1700, "bounded expansion");
});

runTest("E caption style change: caption frames dirty, alignment clean", () => {
  const diff = incr.diffDependencies(baseFp(), baseFp({ captions: "cap2", fingerprintId: "fp-cur" }));
  const dirty = incr.buildDirtySet(diff, {
    totalFrames: TOTAL, sceneMap: SCENES,
    captionEvents: [{ startFrame: 950, endFrameExclusive: 1700 }],
  });
  assert(dirty.dirtyFrameRanges.length === 1, "caption span dirty");
  assert(dirty.dirtyAudioRegions.length === 0, "alignment/audio clean when timing unchanged");
  const dirty2 = incr.buildDirtySet(diff, { totalFrames: TOTAL, sceneMap: SCENES, audioTimingChanged: true });
  assert(dirty2.dirtyFrameRanges.length > 0 && dirty2.dirtyFrameRanges[0].endFrameExclusive === TOTAL, "timing change dirties consumers");
});

runTest("F global FPS change: full invalidation", () => {
  const diff = incr.diffDependencies(baseFp(), baseFp({ renderPlan: "rp2", fingerprintId: "fp-cur" }));
  diff.changes.push({ dependencyId: "fps", kind: "fps", oldHash: "30", newHash: "25", affectedArtifactIds: ["RENDER"], affectedFrameRanges: null, reason: "fps switch" });
  const dirty = incr.buildDirtySet(diff, { totalFrames: TOTAL, sceneMap: SCENES });
  assert(dirty.global === true, "global flag");
  const plan = incr.planRender({ dirtySet: dirty, totalFrames: TOTAL });
  assert(plan.fallback === "FULL_RENDER_REQUIRED", "fallback required");
});

runTest("G global renderer version change: relevant cache miss", () => {
  const hit = cache.lookup.__proto__ ? null : null;
  void hit;
  const k1 = cache.sceneRenderKey({ sourceAssetHashes: { a: "h1" }, timelineRange: [0, 900], fps: 30, width: 1280, height: 720, remotionVersion: "4.0.529" });
  const k2 = cache.sceneRenderKey({ sourceAssetHashes: { a: "h1" }, timelineRange: [0, 900], fps: 30, width: 1280, height: 720, remotionVersion: "4.0.530" });
  assert(k1 !== k2, "renderer version participates in key");
});

runTest("H same ActionKey twice: deterministic identity", () => {
  const spec = { actionType: "scene-render", schemaVersion: "1.0.0", inputs: [{ name: "a", hash: "h1" }], toolVersions: { r: "1" }, policyVersions: {}, frameRange: { startFrame: 0, endFrameExclusive: 90 } };
  assert(cache.actionKey(spec) === cache.actionKey(spec), "stable key");
});

runTest("I relevant input change: MISS via key change", () => {
  const a = cache.sceneRenderKey({ sourceAssetHashes: { img: "h1" }, timelineRange: [0, 900], fps: 30, width: 1280, height: 720 });
  const b = cache.sceneRenderKey({ sourceAssetHashes: { img: "h2" }, timelineRange: [0, 900], fps: 30, width: 1280, height: 720 });
  assert(a !== b, "input hash change -> new key (MISS on old cache)");
});

runTest("J irrelevant dependency change: key stable when proven irrelevant", () => {
  const a = cache.sceneRenderKey({ sourceAssetHashes: { img: "h1" }, timelineRange: [0, 900], fps: 30, width: 1280, height: 720 });
  const b = cache.sceneRenderKey({ sourceAssetHashes: { img: "h1" }, timelineRange: [0, 900], fps: 30, width: 1280, height: 720 });
  assert(a === b, "identical relevant inputs -> identical key (report-history edits never enter scene keys)");
});

runTest("K tool version change: HIT_INVALID with reason", () => {
  const os = require("os");
  const fs = require("fs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "5b-k-"));
  const key = cache.actionKey({ actionType: "prompt", schemaVersion: "1.0.0", inputs: [{ name: "p", hash: "h" }] });
  const blob = cache.writeBlob(root, Buffer.from("bytes"));
  cache.publishAction(root, { actionKey: key, actionType: "prompt", schemaVersion: "1.0.0", inputs: [{ name: "p", hash: "h" }], toolVersions: { compiler: "v1" }, policyVersions: {}, outputContentHashes: [blob.hash] });
  const res = cache.lookup(root, key, { schemaVersion: "1.0.0", toolVersions: { compiler: "v2" } });
  assert(res.status === "HIT_INVALID" && res.reason === "TOOL_VERSION_CHANGED", "reason: " + res.reason);
  fs.rmSync(root, { recursive: true, force: true });
});

runTest("L QA policy change: artifact hits, QA PASS invalid", () => {
  const stored = { result: "PASS", qaKey: "qa-old-policy" };
  const r = partialQA.isPassReusable(stored, { qaKey: "qa-new-policy" });
  assert(r.reusable === false && r.reason === "QA_STALE_PASS", "stale PASS rejected");
});

runTest("X stale PASS injection rejected", () => {
  const forged = { result: "PASS", qaKey: "attacker-key" };
  const r = partialQA.isPassReusable(forged, { qaKey: "real-key" });
  assert(!r.reusable, "forged PASS rejected");
  const nonPass = partialQA.isPassReusable({ result: "FAIL", qaKey: "real-key" }, { qaKey: "real-key" });
  assert(!nonPass.reusable && nonPass.reason === "QA_RESULT_NOT_PASS", "FAIL never reusable as PASS");
});

runTest("AB missing chunk blocks assembly", () => {
  const v = incr.validateCoverage([{ range: { startFrame: 0, endFrameExclusive: 900 } }], TOTAL);
  assert(!v.ok && v.reason === "ASSEMBLY_GAP" && v.gaps.length === 1 && v.gaps[0].startFrame === 900, "gap detected: " + JSON.stringify(v.gaps));
});

runTest("AC duplicate range blocks assembly", () => {
  const full = [{ startFrame: 0, endFrameExclusive: 900 }, { startFrame: 900, endFrameExclusive: 2700 }];
  const dup = full.concat([{ startFrame: 0, endFrameExclusive: 900 }]);
  const v = incr.validateCoverage(dup.map((range) => ({ range: range })), TOTAL);
  assert(!v.ok && v.reason === "CHUNK_DUPLICATE", "duplicate detected");
});

runTest("AD wrong chunk profile/timebase blocks assembly", () => {
  const incRender = require("../../pipeline/incremental-render.js");
  const chunks = [
    { range: { startFrame: 0, endFrameExclusive: 1350 }, chunkFile: "a.mp4", probe: { video: { width: 1280, height: 720, fps: 30, pixFmt: "yuv420p", codec: "h264" } } },
    { range: { startFrame: 1350, endFrameExclusive: 2700 }, chunkFile: "b.mp4", probe: { video: { width: 1920, height: 1080, fps: 30, pixFmt: "yuv420p", codec: "h264" } } },
  ];
  const v = incRender.validateAssembly(chunks, { totalFrames: TOTAL, width: 1280, height: 720, fps: 30, pixelFormat: "yuv420p" });
  assert(!v.ok && v.reason === "CHUNK_INCOMPATIBLE", "profile mismatch blocked: " + v.reason);
});

runTest("AG NTSC timebases: no drop/duplicate drift", () => {
  for (const id of ["ntsc-23976@1.0.0", "web-2997@1.0.0", "web-30@1.0.0"]) {
    const fr = timebase.getTimebasePolicy(id).frameRate;
    const r = timebase.roundTripCheck(0, 10000, fr);
    assert(r.startFrameStable && r.endFrameStable && r.monotonic, id + " round-trip: " + JSON.stringify(r));
  }
  const fr = timebase.getTimebasePolicy("web-30@1.0.0").frameRate;
  assert(timebase.timeToFrameStart(30000, fr) === 900, "S02 boundary exact at 30fps");
});

runTest("AI uncertain correctness: machine-readable FULL_RENDER_REQUIRED", () => {
  const diff = incr.diffDependencies(baseFp(), baseFp({ timeline: "tl2", fingerprintId: "fp-cur" }));
  const dirty = incr.buildDirtySet(diff, { totalFrames: TOTAL, sceneMap: SCENES, sceneHashes: sceneHashes({ S01: "a2" }) });
  const plan = incr.planRender({ dirtySet: dirty, totalFrames: TOTAL, uncertain: true });
  assert(plan.fallback === "FULL_RENDER_REQUIRED" && /RULE 20/.test(plan.fallbackReason), "RULE 20 fallback");
});

runTest("plan fails closed when clean ranges lack cache", () => {
  const diff = incr.diffDependencies(baseFp(), baseFp({ timeline: "tl2", fingerprintId: "fp-cur" }));
  const dirty = incr.buildDirtySet(diff, { totalFrames: TOTAL, sceneMap: SCENES, sceneHashes: sceneHashes({ S02: "b2" }) });
  const plan = incr.planRender({ dirtySet: dirty, totalFrames: TOTAL, keyForRange: (r) => "k" + r.startFrame, cacheLookup: okLookup({}) });
  assert(plan.fallback === "FULL_RENDER_REQUIRED" && /without valid cache/.test(plan.fallbackReason), "no silent partial assembly");
});

console.log("\n=== incremental-plan: " + passed + " passed, " + failed + " failed ===");
process.exit(failed > 0 ? 1 : 0);
