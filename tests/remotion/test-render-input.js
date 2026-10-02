"use strict";
// STEP-12 Branch C — render-input tests RI1-RI12.
// Uses real buildRenderInput on constructed projects/__12_ri*__/ fixtures.
// Adapts: builder builds INPUT only; plan derived via render-plan-cli.derivePlan.

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const Builder = require("../../lib/render-input-builder.js");
const InputCheck = require("../../lib/render-input-check.js");
const PlanCheck = require("../../lib/render-plan-check.js");
const PlanCLI = require("../../scripts/cli/render-plan-cli.js");
const RenderErrors = require("../../lib/render-errors.js");
const Stager = require("../../lib/asset-stager.js");

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
function assert(c, m) {
  if (!c) throw new Error("ASSERT: " + m);
}

function projDir(pid) { return path.join(ROOT, "projects", pid); }
function rmPid(pid) {
  try { fs.rmSync(projDir(pid), { recursive: true, force: true }); } catch (e) {}
  try { Stager.cleanStale({ projectRoot: ROOT, projectId: pid }); } catch (e) {}
}
function teardownAll() {
  let entries = [];
  try { entries = fs.readdirSync(path.join(ROOT, "projects")); } catch (e) {}
  entries.filter((n) => n.indexOf("__12_ri") === 0).forEach(rmPid);
}
function wjson(pid, rel, obj) {
  const abs = path.join(projDir(pid), rel.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
}
function wbin(pid, rel, buf) {
  const abs = path.join(projDir(pid), rel.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buf);
}

// Base valid project. opts: {platform, preflightStatus, noTimeline, widthOverride, fpsOverride,
// orphanLayerAsset, blockedRights, durationContractTarget, visualBible, platform2}
function makeBase(pid, opts) {
  opts = opts || {};
  const platform = opts.platform || "youtube";
  rmPid(pid);
  fs.mkdirSync(projDir(pid), { recursive: true });
  const scenes = [
    { sceneId: "S01", order: 1, narration: "Hello world narration", onScreenText: "Hello",
      timing: { startMs: 0, endMs: 2000 }, purpose: "hook" },
    { sceneId: "S02", order: 2, timing: { startMs: 2000, endMs: 4000 }, purpose: "evidence" }
  ];
  wjson(pid, "scene-script.json", { platform: platform, scenes: scenes });
  wbin(pid, "assets/img1.png", Buffer.from(PNG_B64, "base64"));
  wbin(pid, "assets/voice.wav", Buffer.from([82, 73, 70, 70, 1, 2, 3, 4]));
  wjson(pid, "asset-manifest.json", { assets: [
    { assetId: "IMG01", type: "image", path: "assets/img1.png", status: "READY",
      sceneIds: ["S01"], width: 64, height: 64 },
    { assetId: "IMG02", type: "image", path: "assets/img1.png", status: "READY",
      sceneIds: ["S02"], width: 64, height: 64 },
    { assetId: "AUD_V1", type: "voice", path: "assets/voice.wav", status: "READY", durationMs: 4000 }
  ]});
  const preAssets = [
    { assetId: "IMG01", type: "image", sceneId: "S01", rightsStatus: "CLEAR", required: true },
    { assetId: "IMG02", type: "image", sceneId: "S02", rightsStatus: "CLEAR", required: true }
  ];
  if (opts.blockedRights) {
    preAssets.push({ assetId: "BAD01", type: "image", sceneId: "S01", rightsStatus: "BLOCKED", required: true });
  }
  wjson(pid, "preflight/media-preflight.json", {
    status: opts.preflightStatus || "READY", version: "1.0.0",
    blockingIssues: [], warnings: [], timelineSummary: { missingRequired: 0 },
    assets: preAssets, generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO"
  });
  if (!opts.noTimeline) {
    wjson(pid, "timing/timeline-measured.json", {
      status: "MEASURED", actualTimelineEndMs: 4000, sources: ["voice-measured:wav-header"]
    });
  }
  wjson(pid, "audio/audio-mix-plan.json", { tracks: {
    voice: [{ clipId: "clip_v01", path: "assets/voice.wav", fromMs: 0, trimStartMs: 0,
      trimEndMs: 4000, timingStatus: "MEASURED", gainDb: 0, fadeInMs: 0, fadeOutMs: 0, loop: false }],
    music: [], sfx: []
  }, generatedClipAudioPolicy: "MUTE_GENERATED_CLIP_AUDIO" });
  wjson(pid, "captions/captions.json", { mode: "BOTH", items: [
    { captionId: "cap_001", startMs: 100, endMs: 1900, text: "Hello world", sceneId: "S01" },
    { captionId: "cap_002", startMs: 2100, endMs: 3900, text: "Second line", sceneId: "S02" }
  ]});
  if (opts.durationContractTarget) {
    wjson(pid, "planning/duration-contract.json", { version: "1.0.0", targetMs: opts.durationContractTarget });
  }
  if (opts.widthOverride !== undefined || opts.fpsOverride !== undefined) {
    const comp = {};
    if (opts.widthOverride !== undefined) { comp.width = opts.widthOverride; comp.height = 1080; }
    if (opts.fpsOverride !== undefined) { comp.fps = opts.fpsOverride; }
    wjson(pid, "video-spec.json", { composition: comp });
  }
  if (opts.visualBible) {
    wjson(pid, "visual-bible.json", { version: "vb-9.9.9", tokens: { background: "#0b0e14" } });
    wjson(pid, "continuity-registry.json", { version: "cr-2.0.0", visualBibleVersion: "vb-9.9.9" });
  }
}

function expectBlocked(fn, label) {
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert(err, label + ": expected throw, got success");
  assert(RenderErrors.isRenderError(err) && err.code === "RENDER_INPUT_BLOCKED",
    label + ": expected RENDER_INPUT_BLOCKED, got " + (err && (err.code || err.message)));
  return err;
}

teardownAll();

runTest("RI1 valid project builds READY input + derivable READY plan", () => {
  const pid = "__12_ri1__";
  makeBase(pid);
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid });
  assert(input.status === "READY", "input status READY, got " + input.status);
  assert(input.composition && input.composition.durationInFrames === 120, "duration 120 frames");
  const ic = InputCheck.checkRenderInput(input);
  assert(ic.status === "READY" || ic.status === "REVIEW_REQUIRED", "input check ok, got " + ic.status + " " + JSON.stringify(ic.issues));
  // Plan derived via the real CLI derivation (builder only builds input — adapted).
  const plan = PlanCLI.derivePlan(input, { sourcePathById: {}, preflightStatus: "READY", timelineStatus: "MEASURED" });
  assert(plan.status === "READY" || plan.status === "REVIEW_REQUIRED", "plan derivable, got " + plan.status);
  const pc = PlanCheck.checkRenderPlan(plan, { checkExists: false, projectRoot: ROOT });
  assert(pc.status !== "BLOCKED", "plan check not BLOCKED: " + JSON.stringify(pc.issues));
  console.log("  input status=" + input.status + " planHash=" + plan.planHash);
});

runTest("RI2 preflight BLOCKED status rejects with RENDER_INPUT_BLOCKED", () => {
  const pid = "__12_ri2__";
  makeBase(pid, { preflightStatus: "BLOCKED" });
  expectBlocked(() => Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid }), "RI2");
});

runTest("RI3 missing timeline-measured rejects BLOCKED", () => {
  const pid = "__12_ri3__";
  makeBase(pid, { noTimeline: true });
  expectBlocked(() => Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid }), "RI3");
});

runTest("RI4 invalid width (0) via video-spec override rejected", () => {
  const pid = "__12_ri4__";
  makeBase(pid, { widthOverride: 0 });
  expectBlocked(() => Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid }), "RI4");
});

runTest("RI5 invalid fps (0) via video-spec override rejected", () => {
  const pid = "__12_ri5__";
  makeBase(pid, { fpsOverride: 0 });
  expectBlocked(() => Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid }), "RI5");
});

runTest("RI6 durationInFrames matches timeline 4000ms@30fps=120", () => {
  const pid = "__12_ri6__";
  makeBase(pid);
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid });
  assert(input.composition.durationMs === 4000, "durationMs 4000");
  assert(input.composition.durationInFrames === 120, "120 frames, got " + input.composition.durationInFrames);
  assert(input.timeline.actualTimelineEndMs === 4000, "timeline end 4000");
});

runTest("RI7 duration-contract target 60000ms does not change duration (still 120)", () => {
  const pid = "__12_ri7__";
  makeBase(pid, { durationContractTarget: 60000 });
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid });
  assert(input.composition.durationMs === 4000, "durationMs still 4000, got " + input.composition.durationMs);
  assert(input.composition.durationInFrames === 120, "still 120 frames");
  console.log("  provenance durationContractVersion=" + input.provenance.durationContractVersion);
});

runTest("RI8 orphan assetId rejected (layer refs unknown asset -> check BLOCKED)", () => {
  const pid = "__12_ri8__";
  makeBase(pid);
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid });
  // Adapted: builder has no audio-assetId linkage; orphan simulated at layer
  // level (IMAGE layer referencing unknown asset), which checkRenderInput must flag.
  input.scenes[0].layers.push({ layerId: "S01_orphan", kind: "IMAGE", assetId: "NOPE_UNKNOWN",
    fit: "cover", position: { x: 0.5, y: 0.5 }, opacity: 1, scale: 1, motion: "NONE", startMs: 0, endMs: 2000 });
  const ic = InputCheck.checkRenderInput(input);
  assert(ic.status === "BLOCKED", "orphan asset must BLOCK, got " + ic.status);
  assert(ic.issues.some((i) => i.code === "ASSET_NOT_STAGED"), "expect ASSET_NOT_STAGED issue");
  // Audio stray with traversal path is also rejected and never renders.
  const input2 = Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid });
  input2.audio.sfx.push({ clipId: "stray", path: "../evil.wav", fromMs: 0, trimStartMs: 0, trimEndMs: 100, gainDb: 0, fadeInMs: 0, fadeOutMs: 0, loop: false });
  const ic2 = InputCheck.checkRenderInput(input2);
  assert(ic2.status === "BLOCKED", "stray audio path must BLOCK");
});

runTest("RI9 safety-unresolved (rights BLOCKED asset) rejected", () => {
  const pid = "__12_ri9__";
  makeBase(pid, { blockedRights: true });
  expectBlocked(() => Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid }), "RI9");
});

runTest("RI10 youtube platform resolves 1920x1080", () => {
  const pid = "__12_ri10__";
  makeBase(pid, { platform: "youtube" });
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid });
  assert(input.composition.width === 1920 && input.composition.height === 1080,
    "youtube dims, got " + input.composition.width + "x" + input.composition.height);
});

runTest("RI11 tiktok platform resolves 1080x1920", () => {
  const pid = "__12_ri11__";
  makeBase(pid, { platform: "tiktok" });
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid });
  assert(input.composition.width === 1080 && input.composition.height === 1920,
    "tiktok dims, got " + input.composition.width + "x" + input.composition.height);
});

runTest("RI12 provenance records visualBible + profile versions", () => {
  const pid = "__12_ri12__";
  makeBase(pid, { visualBible: true });
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: pid });
  assert(input.provenance.visualBibleVersion === "vb-9.9.9", "visualBibleVersion, got " + input.provenance.visualBibleVersion);
  assert(input.provenance.continuityRegistryVersion === "cr-2.0.0", "continuity version");
  assert(input.provenance.platformProfileVersion === "1.0.0", "profile version, got " + input.provenance.platformProfileVersion);
  assert(typeof input.provenance.timelineHash === "string" && input.provenance.timelineHash.length === 8, "timelineHash hash8");
});

teardownAll();

console.log("\n=== SUMMARY test-render-input RI1-RI12 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
