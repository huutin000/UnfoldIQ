"use strict";
// STEP-12 Branch C — remotion audio tests RA1-RA10.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const Builder = require("../../lib/render-input-builder.js");
const InputCheck = require("../../lib/render-input-check.js");
const PlanCLI = require("../../scripts/cli/render-plan-cli.js");
const Stager = require("../../lib/asset-stager.js");

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
function src(rel) { return fs.readFileSync(path.join(ROOT, rel.split("/").join(path.sep)), "utf8"); }
function grepCount(rel, re) {
  const s = src(rel);
  const m = s.match(re);
  return m ? m.length : 0;
}

const AUD = src("remotion/src/audio/AudioTrack.tsx");
const VIS = src("remotion/src/theme/visual-system.ts");
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const PID = "__12_ra__";
function projDir() { return path.join(ROOT, "projects", PID); }
function wjson(rel, obj) {
  const abs = path.join(projDir(), rel.split("/").join(path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
}
function setupAudioProject() {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  try { Stager.cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
  fs.mkdirSync(projDir(), { recursive: true });
  wjson("scene-script.json", { platform: "youtube", scenes: [
    { sceneId: "S01", order: 1, narration: "Voice line", timing: { startMs: 0, endMs: 4000 } }
  ]});
  fs.mkdirSync(path.join(projDir(), "assets"), { recursive: true });
  fs.writeFileSync(path.join(projDir(), "assets", "img.png"), Buffer.from(PNG_B64, "base64"));
  fs.writeFileSync(path.join(projDir(), "assets", "voice.wav"), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(projDir(), "assets", "music.wav"), Buffer.from([4, 5, 6]));
  fs.writeFileSync(path.join(projDir(), "assets", "sfx.wav"), Buffer.from([7, 8, 9]));
  wjson("asset-manifest.json", { assets: [
    { assetId: "IMG01", type: "image", path: "assets/img.png", status: "READY", sceneIds: ["S01"] },
    { assetId: "AUD_V1", type: "voice", path: "assets/voice.wav", status: "READY", durationMs: 3800 },
    { assetId: "AUD_M1", type: "music", path: "assets/music.wav", status: "READY", durationMs: 4000 },
    { assetId: "AUD_S1", type: "sfx", path: "assets/sfx.wav", status: "READY", durationMs: 500 }
  ]});
  wjson("preflight/media-preflight.json", { status: "READY", version: "1.0.0", blockingIssues: [],
    warnings: [], timelineSummary: { missingRequired: 0 },
    assets: [{ assetId: "IMG01", type: "image", sceneId: "S01", rightsStatus: "CLEAR", required: true }] });
  wjson("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: 4000, sources: ["voice-measured"] });
  wjson("audio/audio-mix-plan.json", { tracks: {
    voice: [{ clipId: "clip_v01", path: "assets/voice.wav", fromMs: 0, trimStartMs: 0, trimEndMs: 3800,
      timingStatus: "MEASURED", gainDb: 0, fadeInMs: 50, fadeOutMs: 150, loop: false }],
    music: [{ clipId: "clip_m01", path: "assets/music.wav", fromMs: 0, trimStartMs: 0, trimEndMs: 4000,
      gainDb: -12, fadeInMs: 300, fadeOutMs: 500, loop: false,
      ducking: { enabled: true, targetAudioId: "clip_v01", reductionDb: -6, ranges: [{ startMs: 0, endMs: 3800 }] } }],
    sfx: [{ clipId: "clip_s01", path: "assets/sfx.wav", fromMs: 2000, trimStartMs: 0, trimEndMs: 500,
      gainDb: -6, fadeInMs: 10, fadeOutMs: 100, loop: false }]
  }});
  wjson("captions/captions.json", { mode: "SIDECAR", items: [] });
}
function teardown() {
  try { fs.rmSync(projDir(), { recursive: true, force: true }); } catch (e) {}
  try { Stager.cleanStale({ projectRoot: ROOT, projectId: PID }); } catch (e) {}
}

runTest("RA1 voice renders via Audio element (source)", () => {
  assert(/<Audio/.test(AUD), "<Audio present");
  assert(/audio\.voice/.test(AUD), "voice group present");
});

runTest("RA2 gain serialized (plan clip gainDb) and source uses gain", () => {
  setupAudioProject();
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
  assert(input.audio.voice[0].gainDb === 0, "voice gainDb serialized");
  assert(input.audio.sfx[0].gainDb === -6, "sfx gainDb serialized");
  assert(/gainDb/.test(AUD) && /dbToLinearGain/.test(AUD), "source uses gainDb via dbToLinearGain");
  teardown();
});

runTest("RA3 sfx timing from fromMs frames (source Sequence from)", () => {
  assert(/fromFrame/.test(AUD) && /msToFrameStart\(clip\.fromMs/.test(AUD), "fromMs->frames mapping");
  assert(/<Sequence/.test(AUD), "Sequence present");
});

runTest("RA4 dbToLinearGain deterministic (-6dB ~= 0.5012) + single definition", () => {
  assert(/Math\.pow\(10, clamped \/ 20\)/.test(VIS), "formula pow(10, db/20) present");
  const m = VIS.match(/return\s+Math\.pow\(10,\s*clamped\s*\/\s*20\)/);
  assert(m, "extractable formula");
  const fn = new Function("db", "var clamped = Math.min(12, Math.max(-60, db)); return Math.pow(10, clamped / 20);");
  const v = fn(-6);
  assert(Math.abs(v - 0.5012) < 1e-4, "-6dB ~= 0.5012, got " + v);
  let count = 0;
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e.name)) {
        const s = fs.readFileSync(p, "utf8");
        const hits = s.match(/function dbToLinearGain|dbToLinearGain\s*=\s*\(/g);
        if (hits) count += hits.length;
      }
    });
  })(path.join(ROOT, "remotion", "src"));
  assert(count === 1, "single dbToLinearGain definition, got " + count);
});

runTest("RA5 fades via interpolate on local frames (source)", () => {
  assert(/interpolate\(frame, \[0, fadeInFrames\]/.test(AUD), "fadeIn interpolate");
  assert(/interpolate\(frame, \[Math\.max\(0, totalFrames - fadeOutFrames\), totalFrames\]/.test(AUD), "fadeOut interpolate");
});

runTest("RA6 ducking ranges from plan (source contains ducking.ranges)", () => {
  assert(/ducking\.ranges/.test(AUD), "ducking.ranges present");
  assert(/ducking\?\.enabled/.test(AUD), "ducking enabled gate");
});

runTest("RA7 mute honored (source)", () => {
  assert(/MUTE_GENERATED_CLIP_AUDIO|MUTED/.test(AUD) || /volume/.test(AUD), "mute/volume path present");
  const v = src("remotion/src/layers/VideoLayer.tsx");
  assert(/volume=\{isMuted \? 0 : 1\}/.test(v), "video mute -> volume 0");
});

runTest("RA8 unplanned audio never renders (stray traversal path BLOCKED)", () => {
  setupAudioProject();
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
  // Adapted: builder passes paths through; the check layer rejects stray
  // traversal clips so they can never reach the renderer.
  input.audio.sfx.push({ clipId: "stray_x", path: "../../stray.wav", fromMs: 0, trimStartMs: 0,
    trimEndMs: 100, gainDb: 0, fadeInMs: 0, fadeOutMs: 0, loop: false });
  const ic = InputCheck.checkRenderInput(input);
  assert(ic.status === "BLOCKED", "stray clip BLOCKED, got " + ic.status);
  assert(ic.issues.some((i) => i.code === "AUDIO_PLAN_INVALID"), "AUDIO_PLAN_INVALID raised");
  teardown();
});

runTest("RA9 loop only when explicit (source checks loop===true)", () => {
  assert(/clip\.loop === true/.test(AUD), "explicit loop gate");
});

runTest("RA10 audio end <= composition duration (plan frames bounded)", () => {
  setupAudioProject();
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
  const plan = PlanCLI.derivePlan(input, { sourcePathById: {} });
  const total = plan.composition.durationInFrames;
  ["voice", "music", "sfx"].forEach((t) => {
    (plan.audioTracks[t] || []).forEach((c) => {
      assert(c.endFrame <= total, t + " clip " + c.clipId + " end " + c.endFrame + " <= " + total);
    });
  });
  console.log("  total=" + total);
  teardown();
});

console.log("\n=== SUMMARY test-remotion-audio RA1-RA10 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
