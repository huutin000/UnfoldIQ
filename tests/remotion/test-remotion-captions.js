"use strict";
// STEP-12 Branch C — remotion captions tests RC1-RC8 (source-behavioral).

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

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

const CAP = src("remotion/src/captions/CaptionTrack.tsx");

runTest("RC1 SIDECAR input returns null path (source contains SIDECAR->null)", () => {
  assert(/SIDECAR/.test(CAP), "SIDECAR branch present");
  assert(/captions\.mode === 'SIDECAR'/.test(CAP) || /mode === "SIDECAR"/.test(CAP), "SIDECAR mode check");
  assert(/return null/.test(CAP), "null return present");
  assert(/NONE/.test(CAP), "NONE branch present");
});

runTest("RC2 BURNED_IN renders items mapping", () => {
  assert(/visible\.map|items\.map|active\.map/.test(CAP), "items mapping present");
  assert(/captionId/.test(CAP), "captionId keyed render");
});

runTest("RC3 BOTH renders + sidecar files untouched (builder preserves captions path)", () => {
  const b = src("lib/render-input-builder.js");
  assert(/BOTH/.test(b), "builder knows BOTH mode");
  assert(/captionMode/.test(b), "builder preserves caption mode");
  assert(/BURNED_IN/.test(CAP) || /visible\.map/.test(CAP), "BOTH/BURNED_IN renders via same mapping");
});

runTest("RC4 phrase ranges from measured startMs/endMs (no word interpolation)", () => {
  assert(/item\.startMs/.test(CAP) && /item\.endMs/.test(CAP), "uses startMs/endMs");
  assert(/frameRangeForInterval/.test(CAP), "frame math from measured range");
});

runTest("RC5 word emphasis gated on words[] presence", () => {
  assert(/item\.words/.test(CAP), "words check present");
  assert(/words\.length/.test(CAP) || /words &&/.test(CAP), "non-empty gate");
});

runTest("RC6 safeZone bottom offset honored", () => {
  assert(/safeZone/.test(CAP), "safeZone referenced");
  assert(/bottomPct/.test(CAP), "bottomPct referenced");
  assert(/bottom/.test(CAP), "bottom style applied");
});

runTest("RC7 item outside composition time returns null (frame-range guard)", () => {
  assert(/durationInFrames/.test(CAP), "composition duration guard");
  assert(/frame < 0 \|\| frame >= durationInFrames/.test(CAP), "out-of-range null guard");
});

runTest("RC8 no fake timing (no even-division/interpolation of text into words)", () => {
  const bad = [];
  CAP.split("\n").forEach((ln, i) => {
    if (/\.text\.length\s*\/|text\.split\(.*\)\.length|evenly|interpolat\w*\s*word/i.test(ln)) bad.push((i + 1) + ": " + ln.trim());
    if (/split\(["' ]\)/.test(ln) && /startMs|endMs/.test(ln)) bad.push((i + 1) + ": " + ln.trim());
  });
  assert(/Words are never interpolated/.test(CAP), "no-interpolation documented");
  if (bad.length) console.log("  suspects:\n  " + bad.join("\n  "));
  assert(bad.length === 0, "fake-timing patterns found");
});

runTest("RC9 caption container stacks above scene layers (scene layers use zIndex: layer index)", () => {
  const scene = src("remotion/src/scenes/Scene.tsx");
  assert(/zIndex:\s*index/.test(scene), "scene layers are stacked by zIndex: index");
  const m = CAP.match(/position:\s*'absolute',[\s\S]{0,200}?zIndex:\s*(\d+)/);
  assert(m, "caption container must set an explicit zIndex");
  assert(Number(m[1]) >= 100, "caption zIndex must exceed any scene layer index, got " + m[1]);
});

runTest("RC10 one-frame boundary overlap of back-to-back cues must not stack two captions (flash)", () => {
  // floor(start)/ceil(end) makes adjacent cues share one frame; the superseded cue must be dropped.
  assert(/superseded/.test(CAP), "boundary-overlap (superseded cue) handling present");
  assert(/range\.end\s*-\s*1|end\s*-\s*1/.test(CAP), "overlap tolerance is exactly the 1-frame rounding artifact");
});

console.log("\n=== SUMMARY test-remotion-captions RC1-RC10 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
