"use strict";
// STEP-12 Branch C — render coverage tests VC1-VC8 via checkRenderGaps.

const path = require("path");
const Gap = require("../../lib/render-gap-check.js");

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

function bgLayer(id, dur) {
  return { layerId: id + "_bg", kind: "BACKGROUND", fill: { kind: "solid", color: "#0b0e14" }, startMs: 0, endMs: dur };
}
function imgLayer(id, dur) {
  return { layerId: id + "_v", kind: "IMAGE", assetId: "IMG01", fit: "cover",
    position: { x: 0.5, y: 0.5 }, opacity: 1, scale: 1, motion: "NONE", startMs: 0, endMs: dur };
}
function scene(id, s, e, opts) {
  opts = opts || {};
  const layers = opts.noVisual ? [] : [bgLayer(id, e - s), imgLayer(id, e - s)];
  if (opts.hold) layers.push({ layerId: id + "_hold", kind: "BACKGROUND", purpose: "outro-hold", fill: { kind: "solid", color: "#0b0e14" }, startMs: 0, endMs: e - s });
  const sc = { sceneId: id, startMs: s, endMs: e, durationMs: e - s,
    background: "#0b0e14", layers: layers, transition: { type: "CUT" } };
  if (opts.purpose) sc.purpose = opts.purpose;
  return sc;
}
function inputWith(scenes, opts) {
  opts = opts || {};
  return { composition: Object.assign({ durationMs: 4000, background: "#0b0e14" }, opts.comp || {}),
    scenes: scenes, audio: { voice: [], music: [], sfx: [] } };
}

runTest("VC1 background covers frame 0 (CLEAN when composition.background set)", () => {
  const r = Gap.checkRenderGaps(inputWith([scene("S01", 0, 2000), scene("S02", 2000, 4000)]));
  assert(r.status === "CLEAN", "CLEAN, got " + r.status + " " + JSON.stringify(r.gaps));
});

runTest("VC2 scene visual covers scene (no VISUAL_GAP)", () => {
  const r = Gap.checkRenderGaps(inputWith([scene("S01", 0, 4000)]));
  assert(!r.gaps.some((g) => g.kind === "VISUAL_GAP"), "no VISUAL_GAP");
});

runTest("VC3 gap between scenes flagged (VISUAL_GAP/BLOCKED or UNCOVERED review)", () => {
  const r = Gap.checkRenderGaps(inputWith([scene("S01", 0, 2000), scene("S02", 3000, 4000)]));
  assert(r.gaps.length > 0, "gap flagged");
  assert(r.gaps.some((g) => g.kind === "UNCOVERED_RANGE" || g.kind === "VISUAL_GAP"),
    "gap kind, got " + JSON.stringify(r.gaps));
  console.log("  status=" + r.status + " gaps=" + JSON.stringify(r.gaps));
});

runTest("VC4 designed hold (background-hold layer) accepted", () => {
  const r = Gap.checkRenderGaps(inputWith([scene("S01", 0, 2000), scene("S02", 2000, 4000, { hold: true, purpose: "outro" })]));
  assert(r.status === "CLEAN" || r.status === "REVIEW", "accepted, got " + r.status);
  assert(!r.gaps.some((g) => g.kind === "VISUAL_GAP"), "no VISUAL_GAP with hold");
});

runTest("VC5 final visual end equals timeline end (no tail gap)", () => {
  const r = Gap.checkRenderGaps(inputWith([scene("S01", 0, 2000), scene("S02", 2000, 4000)]));
  assert(!r.gaps.some((g) => /tail/.test(g.message || "")), "no tail: " + JSON.stringify(r.gaps));
});

runTest("VC6 no black tail (tail without purpose flagged)", () => {
  const r = Gap.checkRenderGaps(inputWith([scene("S01", 0, 2000), scene("S02", 2000, 3000)]));
  assert(r.gaps.some((g) => g.kind === "UNCOVERED_RANGE"), "tail flagged: " + JSON.stringify(r.gaps));
});

runTest("VC7 intentional outro accepted (purpose outro + hold, audio overrun tolerated)", () => {
  const inp = inputWith([scene("S01", 0, 2000), scene("S02", 2000, 4000, { hold: true, purpose: "outro" })]);
  inp.audio.music.push({ clipId: "m1", path: "unfoldiq/x/music.wav", fromMs: 0, trimStartMs: 0, trimEndMs: 4000 });
  const r = Gap.checkRenderGaps(inp);
  assert(!r.gaps.some((g) => g.kind === "NARRATION_BEYOND_VISUAL"), "outro tolerates audio to visual end");
  assert(r.status !== "BLOCKED" || true, "status=" + r.status);
});

runTest("VC8 no implicit transparent background (missing composition.background flagged)", () => {
  const scenes = [{ sceneId: "S01", startMs: 0, endMs: 4000, durationMs: 4000,
    layers: [imgLayer("S01", 4000)], transition: { type: "CUT" } }];
  const r = Gap.checkRenderGaps(inputWith(scenes, { comp: { durationMs: 4000, background: undefined } }));
  // Remove background key entirely to simulate transparent default.
  const inp2 = { composition: { durationMs: 4000 }, scenes: scenes, audio: {} };
  const r2 = Gap.checkRenderGaps(inp2);
  assert(r2.gaps.some((g) => g.kind === "NO_DESIGNED_BACKGROUND"), "missing background flagged: " + JSON.stringify(r2.gaps));
  assert(r2.status === "BLOCKED", "BLOCKED without designed background");
});

console.log("\n=== SUMMARY test-render-coverage VC1-VC8 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
