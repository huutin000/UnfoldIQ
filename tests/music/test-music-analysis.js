"use strict";

/**
 * Phase 2.7-E tests — Music asset analysis over real decoded PCM.
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const analysis = require(REPO + "/lib/music-analysis/index.js");
const wav = require(REPO + "/lib/audio-wav.js");
const H = require(REPO + "/tests/fixtures/audio-synth.js");

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ok  " + msg);
}
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`ASSERTION FAILED: ${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  console.log("  ok  " + msg);
}
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
}

(async () => {
await runTest("A1 non-WAV bytes rejected with canonical code", async () => {
  const r = analysis.analyzeMusicAsset({ bytes: Buffer.from("junk"), assetId: "x" });
  assertEq(r.ok, false, "rejects junk");
  assertEq(r.code, "ANALYSIS_DECODE_FAILED", "canonical code");
});

await runTest("A2 duration + energy curve measured from real bytes", async () => {
  const r = analysis.analyzeMusicAsset({ bytes: H.makeMusicWav({ durationMs: 20000, segments: [{ untilMs: 10000, energy: 0.3 }, { untilMs: 20000, energy: 0.9 }] }), assetId: "a2" });
  assert(r.ok, "ok");
  assertEq(r.analysis.durationMs, 20000, "duration measured");
  assert(r.analysis.energyCurve.length > 50, "200ms frames curve present");
  const early = r.analysis.energyCurve.filter((c) => c.timeMs < 8000);
  const late = r.analysis.energyCurve.filter((c) => c.timeMs > 12000);
  const earlyMean = early.reduce((s, c) => s + c.value, 0) / early.length;
  const lateMean = late.reduce((s, c) => s + c.value, 0) / late.length;
  assert(lateMean > earlyMean + 0.3, `energy curve tracks sections (${earlyMean.toFixed(2)} → ${lateMean.toFixed(2)})`);
});

await runTest("A3 loudness actually measured via BS.1770", async () => {
  const r = analysis.analyzeMusicAsset({ bytes: H.makeMusicWav({ durationMs: 10000 }), assetId: "a3" });
  assertEq(r.analysis.loudness.status, "MEASURED", "measured, not assumed");
  assert(typeof r.analysis.loudness.integratedLufs === "number", "integrated LUFS present");
  assert(typeof r.analysis.loudness.peakDb === "number", "peak present");
});

await runTest("A4 silence regions detected", async () => {
  const FS = H.FS;
  const gapMs = 1500;
  const totalMs = 8000;
  const n = Math.round((totalMs / 1000) * FS);
  const s = new Int16Array(n);
  const music = H.makeMusicWav({ durationMs: 3000 });
  const d = wav.decodeWav(music);
  s.set(d.samples.slice(0, Math.round(3 * FS)), 0);
  s.set(d.samples.slice(0, Math.round(3.5 * FS)), Math.round((3000 + gapMs) / 1000 * FS));
  const bytes = wav.encodeWav(s, FS, 1);
  const r = analysis.analyzeMusicAsset({ bytes, assetId: "a4" });
  assert(r.analysis.silenceRegions.length >= 1, `gap found (${r.analysis.silenceRegions.length} regions)`);
  assert(r.analysis.silenceRegions.some((g) => g.endMs - g.startMs >= 1000), "gap ≥1s");
});

await runTest("A5 safe cut points exist at section boundaries", async () => {
  const r = analysis.analyzeMusicAsset({ bytes: H.makeMusicWav({ durationMs: 30000, segments: [{ untilMs: 10000, energy: 0.2 }, { untilMs: 20000, energy: 0.8 }, { untilMs: 30000, energy: 0.4 }] }), assetId: "a5" });
  assert(r.analysis.safeCutPointsMs.length >= 3, `cut points present (${r.analysis.safeCutPointsMs.length})`);
  assert(r.analysis.sections.length >= 2, `sections segmented (${r.analysis.sections.length})`);
});

await runTest("A6 loop candidates require boundary similarity ≥0.6 confidence", async () => {
  // Flat constant-energy region → strong loop candidate.
  const r = analysis.analyzeMusicAsset({ bytes: H.makeMusicWav({ durationMs: 40000, segments: [{ untilMs: 40000, energy: 0.5 }] }), assetId: "a6" });
  assert(r.analysis.loopCandidates.length > 0, `loop candidate found (${r.analysis.loopCandidates.length})`);
  for (const l of r.analysis.loopCandidates) {
    assert(l.confidence >= 0.6 && l.confidence <= 1, "confidence in range");
    assert(l.endMs > l.startMs, "valid span");
  }
});

await runTest("A7 BPM omitted (or low confidence) when no rhythmic onset", async () => {
  const r = analysis.analyzeMusicAsset({ bytes: H.makeMusicWav({ durationMs: 15000 }), assetId: "a7" });
  // Smooth AM tone has no sharp onsets: either omitted or below usable confidence.
  if (r.analysis.bpm !== undefined) {
    assert(r.analysis.bpmConfidence < 0.9, "BPM not over-claimed on non-rhythmic material");
  }
});

await runTest("A8 schema-valid analysis artifact shape", async () => {
  const r = analysis.analyzeMusicAsset({ bytes: H.makeMusicWav({ durationMs: 20000, segments: [{ untilMs: 10000, energy: 0.3 }, { untilMs: 20000, energy: 0.8 }] }), assetId: "a8" });
  const a = r.analysis;
  for (const key of ["assetId", "analysisVersion", "durationMs", "sections", "energyCurve", "safeCutPointsMs", "loopCandidates", "silenceRegions", "loudness", "analyzedAt"]) {
    assert(a[key] !== undefined, `${key} present`);
  }
  assertEq(a.analysisVersion, analysis.ANALYSIS_VERSION, "version stamped");
});

console.log(`\n=== music-analysis: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
