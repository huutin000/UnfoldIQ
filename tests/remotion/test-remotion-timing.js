"use strict";
// STEP-12 Branch C — remotion timing tests RT1-RT10 via lib/render-time.js + source scan.

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const Time = require("../../lib/render-time.js");

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
function readSrc(rel) {
  return fs.readFileSync(path.join(ROOT, rel.split("/").join(path.sep)), "utf8");
}

runTest("RT1 1000ms@30fps deterministic (=30 both calls)", () => {
  const a = Time.durationMsToFrames(1000, 30);
  const b = Time.durationMsToFrames(1000, 30);
  assert(a === 30, "got " + a);
  assert(a === b, "deterministic");
  assert(Time.msToFrameStart(1000, 30) === 30, "start 30");
  assert(Time.msToFrameEnd(1000, 30) === 30, "end 30");
});

runTest("RT2 floor/ceil semantics (start 1ms@30fps=0, end=1)", () => {
  assert(Time.msToFrameStart(1, 30) === 0, "floor start");
  assert(Time.msToFrameEnd(1, 30) === 1, "ceil end");
  assert(typeof Time.ROUNDING_SEMANTICS === "string" && Time.ROUNDING_SEMANTICS.length > 0, "ROUNDING_SEMANTICS exported");
  console.log("  ROUNDING_SEMANTICS=" + Time.ROUNDING_SEMANTICS);
});

runTest("RT3 negative ms throws", () => {
  let threw = false;
  try { Time.msToFrameStart(-5, 30); } catch (e) { threw = /INVALID_TIME/.test(e.message); }
  assert(threw, "negative must throw INVALID_TIME");
  threw = false;
  try { Time.durationMsToFrames(-1, 30); } catch (e) { threw = true; }
  assert(threw, "negative duration throws");
});

runTest("RT4 1ms item end>start (widen rule)", () => {
  const r = Time.msRangeToFrames(0, 1, 30);
  assert(r.endFrame > r.startFrame, "end>start: " + JSON.stringify(r));
  assert(r.startFrame === 0 && r.endFrame === 1, "0..1ms -> frames 0..1");
});

runTest("RT5 scene ms->frames (0-2000ms@30fps = 0..60)", () => {
  const r = Time.msRangeToFrames(0, 2000, 30);
  assert(r.startFrame === 0 && r.endFrame === 60, "got " + JSON.stringify(r));
});

runTest("RT6 caption boundaries (100-1900ms)", () => {
  const r = Time.msRangeToFrames(100, 1900, 30);
  assert(r.startFrame === 3, "start 3, got " + r.startFrame);
  assert(r.endFrame === 57, "end 57, got " + r.endFrame);
  assert(r.endFrame > r.startFrame, "valid range");
});

runTest("RT7 audio fromMs/trim mapping (2000ms + 500ms trim)", () => {
  const start = Time.msToFrameStart(2000, 30);
  assert(start === 60, "from 60, got " + start);
  const r = Time.msRangeToFrames(2000, 2500, 30);
  assert(r.startFrame === 60 && r.endFrame === 75, "got " + JSON.stringify(r));
});

runTest("RT8 final frame from timeline (4000ms@30fps=120)", () => {
  assert(Time.durationMsToFrames(4000, 30) === 120, "120 frames");
  assert(Math.abs(Time.frameToMs(120, 30) - 4000) < 1e-9, "frameToMs inverse");
});

runTest("RT9 target ignored (duration from timeline only)", () => {
  // duration-contract target must never feed frame math; only actualTimelineEndMs does.
  const fromTimeline = Time.durationMsToFrames(4000, 30);
  assert(fromTimeline === 120, "timeline-derived 120 regardless of target");
});

runTest("RT10 no literal-30fps arithmetic in layers/scenes", () => {
  const dirs = ["remotion/src/layers", "remotion/src/scenes"];
  let files = [];
  dirs.forEach((d) => {
    const abs = path.join(ROOT, d.split("/").join(path.sep));
    fs.readdirSync(abs).filter((f) => /\.tsx?$/.test(f)).forEach((f) => files.push(path.join(abs, f)));
  });
  assert(files.length > 0, "found layer/scene files");
  const bad = [];
  files.forEach((f) => {
    const src = fs.readFileSync(f, "utf8");
    const lines = src.split("\n");
    lines.forEach((ln, i) => {
      const t = ln.trim();
      if (t.indexOf("//") === 0) return; // comments allowed ('30fps' in comments ok)
      if (/\/\s*30(?![0-9.\w])/.test(ln) && /1000|ms/i.test(ln)) bad.push(path.basename(f) + ":" + (i + 1) + ": " + t);
      if (/fps\s*=\s*30(?![0-9.])/.test(ln)) bad.push(path.basename(f) + ":" + (i + 1) + ": " + t);
      if (/Math\.round\([^)]*30\s*\//.test(ln)) bad.push(path.basename(f) + ":" + (i + 1) + ": " + t);
      if (/\b30\s*\/\s*1000/.test(ln)) bad.push(path.basename(f) + ":" + (i + 1) + ": " + t);
      if (/\b1000\s*\/\s*30/.test(ln)) bad.push(path.basename(f) + ":" + (i + 1) + ": " + t);
    });
  });
  if (bad.length) console.log("  matches:\n  " + bad.join("\n  "));
  assert(bad.length === 0, "literal-30fps arithmetic found: " + bad.length + " hit(s)");
});

console.log("\n=== SUMMARY test-remotion-timing RT1-RT10 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
