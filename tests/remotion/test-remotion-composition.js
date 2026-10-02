"use strict";
// STEP-12 Branch C — remotion composition tests CO1-CO6.

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

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

let compList = null;

runTest("CO1 Root.tsx registers UNFOLDIQVideo", () => {
  const s = src("remotion/src/Root.tsx");
  assert(/id="UNFOLDIQVideo"|id:\s*"UNFOLDIQVideo"|"UNFOLDIQVideo"/.test(s), "composition id present");
  assert(/UnfoldiqVideo/.test(s), "UnfoldiqVideo component referenced");
  assert(/Composition/.test(s), "Composition element present");
});

runTest("CO2 calculateUnfoldiqMetadata wired + UNFOLDIQVideo listed in compositions", () => {
  const s = src("remotion/src/Root.tsx");
  assert(/calculateUnfoldiqMetadata/.test(s), "calculateMetadata wired via calculateUnfoldiqMetadata");
  assert(/calculateMetadata/.test(s), "calculateMetadata prop present");
  const r = child_process.spawnSync("npx", ["remotion", "compositions"],
    { cwd: path.join(ROOT, "remotion"), encoding: "utf8", timeout: 300000, shell: true });
  const out = (r.stdout || "") + (r.stderr || "");
  console.log("  compositions exit=" + r.status + " bytes=" + out.length);
  if (r.status !== 0) {
    console.log("  output tail: " + out.slice(-2000));
  }
  assert(r.status === 0, "compositions listing exit 0, got " + r.status);
  assert(/UNFOLDIQVideo/.test(out), "UNFOLDIQVideo listed in output");
  compList = out;
});

runTest("CO3 portrait fallback dims for tiktok 1080x1920 (source)", () => {
  const s = src("remotion/src/remotion-entry.ts");
  assert(/tiktok/.test(s), "tiktok branch present");
  assert(/1080/.test(s) && /1920/.test(s), "1080x1920 fallback present");
  assert(/platformFallbackDims/.test(s), "platformFallbackDims present");
});

runTest("CO4 landscape fallback youtube 1920x1080 (source)", () => {
  const s = src("remotion/src/remotion-entry.ts");
  assert(/1920/.test(s) && /1080/.test(s), "1920x1080 present");
});

runTest("CO5 duration from timeline (no script-text derivation in remotion-entry)", () => {
  const s = src("remotion/src/remotion-entry.ts");
  assert(/actualTimelineEndMs/.test(s), "reads actualTimelineEndMs");
  const bad = [];
  s.split("\n").forEach((ln, i) => {
    if (/narration|script.*length|text.*duration/i.test(ln)) bad.push((i + 1) + ": " + ln.trim());
  });
  // Allow the 'Never from script text' doc comment itself.
  const real = bad.filter((l) => l.indexOf("Never from script text") === -1);
  if (real.length) console.log("  suspects:\n  " + real.join("\n  "));
  assert(real.length === 0, "script-text duration derivation found");
});

runTest("CO6 invalid dims guarded (source throws on dims<=0)", () => {
  const v = src("remotion/src/UnfoldiqVideo.tsx");
  assert(/width <= 0|width.*> 0/.test(v), "width guard present");
  assert(/height <= 0|height.*> 0/.test(v), "height guard present");
  assert(/fps <= 0|fps.*> 0/.test(v), "fps guard present");
  assert(/RENDER_PROP_INVALID/.test(v), "RENDER_PROP_INVALID thrown");
});

console.log("\n=== SUMMARY test-remotion-composition CO1-CO6 ===");
console.log("passed=" + passed + " failed=" + failed);
console.log(failed === 0 ? "RESULT: PASS" : "RESULT: FAIL");
process.exit(failed === 0 ? 0 : 1);
