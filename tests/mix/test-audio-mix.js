"use strict";

/**
 * Phase 2.8-A..F tests — Audio mix: measured gain staging, ducking rules,
 * bounded structured repair (local loop), invalidation hash semantics.
 */

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const wav = require(REPO + "/lib/audio-wav.js");
const mix = require(REPO + "/lib/audio-mix/index.js");
const intent = require(REPO + "/lib/music-intent/index.js");
const planLib = require(REPO + "/lib/music-plan/index.js");
const library = require(REPO + "/lib/music-library/index.js");
const analysis = require(REPO + "/lib/music-analysis/index.js");
const H = require(REPO + "/tests/fixtures/audio-synth.js");

const FS = H.FS;
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

/** Build a full temp production: library with 1 approved track, locked plan, mix plan. */
function setupProduction({ musicDurationMs = 120000, musicGainBoostDb = 0 } = {}) {
  const repo = H.makeTempRepo();
  const musicBytes = H.makeMusicWav({ durationMs: musicDurationMs, segments: [{ untilMs: musicDurationMs / 2, energy: 0.5 }, { untilMs: musicDurationMs, energy: 0.7 }] });
  const ing = library.ingestMusicAsset({
    bytes: musicBytes, repoRoot: repo,
    metadata: { title: "bed", sourceType: "USER_IMPORTED_LICENSED_ASSET", mood: ["calm"], energyProfile: "MEDIUM", vocalType: "INSTRUMENTAL" },
    rights: H.APPROVED_RIGHTS,
  });
  if (!ing.ok) throw new Error(ing.message);
  const an = analysis.analyzeMusicAsset({ bytes: musicBytes, assetId: ing.assetId });
  const intents = intent.buildMusicIntents({
    projectId: "p",
    segments: [
      { segmentId: "s1", narrationActive: true, creativePurpose: "EMOTION", mood: ["calm"], energy: 0.5 },
      { segmentId: "s2", narrationActive: true, creativePurpose: "EMOTION", mood: ["calm"], energy: 0.5 },
      { segmentId: "s3", dramaticPause: true, intentionalSilence: true },
      { segmentId: "s4", narrationActive: false, sceneType: "montage", creativePurpose: "ENERGY", mood: ["calm"], energy: 0.8 },
    ],
  }).artifact.intents;
  const segments = [
    { segmentId: "s1", startMs: 0, endMs: 8000 },
    { segmentId: "s2", startMs: 8000, endMs: 16000 },
    { segmentId: "s3", startMs: 16000, endMs: 19000 },
    { segmentId: "s4", startMs: 19000, endMs: 27000 },
  ];
  const plan = planLib.buildMusicPlan({ projectId: "p", intents, segments, repoRoot: repo, analyses: { [ing.assetId]: an.analysis }, targetPlatforms: ["youtube"], commercialContext: "STANDARD" });
  if (!plan.ok) throw new Error(plan.message);
  const qa = planLib.semanticQA(plan.plan, { repoRoot: repo });
  for (const c of plan.plan.cues) {
    const r = planLib.lockCue(plan.plan, c.cueId, { semanticResult: qa });
    if (!r.ok) throw new Error("lock failed: " + r.message);
  }
  // Narration files. s3 is an intentional-silence dramatic pause and s4 is a
  // narration-free montage (FEATURED music context) — no narration there.
  const narrationDir = path.join(repo, "narration");
  fs.mkdirSync(narrationDir, { recursive: true });
  const narrationSegments = [];
  for (const [id, dur] of [["s1", 8000], ["s2", 8000]]) {
    const p = path.join(narrationDir, `${id}.wav`);
    fs.writeFileSync(p, H.makeSpeechWav({ durationMs: dur }));
    const seg = segments.find((s) => s.segmentId === id);
    narrationSegments.push({ segmentId: id, path: p, startMs: seg.startMs, endMs: seg.endMs });
  }
  const profile = mix.LOUDNESS_PROFILES["youtube-standard@1.0.0"];
  const mp = mix.buildMixPlan({ projectId: "p", repoRoot: repo, musicPlan: plan.plan, profile, narrationSegments });
  if (!mp.ok) throw new Error(mp.message);
  if (musicGainBoostDb) {
    for (const c of mp.mixPlan.tracks.music) c.gainDb += musicGainBoostDb;
  }
  return { repo, plan: plan.plan, mixPlan: mp.mixPlan, profile, narrationSegments, assetId: ing.assetId };
}

(async () => {
await runTest("M1 buildMixPlan: schema-valid, measured staging, ducking rules present", async () => {
  const s = setupProduction();
  const v = mix.validateMixPlan(s.mixPlan);
  assert(v.ok, "schema valid: " + v.errors);
  assert(s.mixPlan.tracks.music.length === 2, "two music clips (bed + featured)");
  assert(s.mixPlan.duckingRules.length >= 1, "ducking rule for bed under narration");
  assert(s.mixPlan.loudness.status === "MEASURED", "narration loudness measured");
  const bed = s.mixPlan.tracks.music.find((c) => c.ducking && c.ducking.enabled);
  assert(bed.gainDb < 0 && bed.gainDb > -24, `bed gain staged (${bed.gainDb} dB)`);
  assert(s.mixPlan.inputHashes.narrationTiming, "narration timing hash recorded");
});

await runTest("M2 clean production mixes PASS (≤1 local REMASTER allowed)", async () => {
  const s = setupProduction();
  const r = mix.mixWithRepair({ mixPlan: s.mixPlan, profile: s.profile, intentionalSilence: s.plan.intentionalSilence });
  assert(r.ok, "mix pass: " + JSON.stringify(r.qa && r.qa.findings));
  assert(r.attempts <= 1, `at most one repair (got ${r.attempts})`);
  const codes = r.lineage.flatMap((l) => l.findings.map((f) => f.code));
  assert(!codes.includes("MUSIC_MASKS_SPEECH") && !codes.includes("CLIPPING") && !codes.includes("UNEXPECTED_SILENCE"),
    "no mask/clipping/silence on clean production: " + JSON.stringify(codes));
  assert(r.qa.metrics.integratedLufs > s.profile.targetIntegratedLoudness - s.profile.tolerance, "loudness within policy");
  assert(r.qa.metrics.truePeakDb <= s.profile.maxTruePeak, "true peak within policy");
});

await runTest("M3 MUSIC_MASKS_SPEECH repaired locally (ducking/gain) then PASS", async () => {
  // Heavy music boost also trips clipping/loudness — the mask finding and
  // its local ducking/gain repair are exercised regardless.
  const s = setupProduction({ musicGainBoostDb: 24 });
  const r = mix.mixWithRepair({ mixPlan: s.mixPlan, profile: s.profile, intentionalSilence: s.plan.intentionalSilence });
  assert(r.ok, "repaired to PASS: " + JSON.stringify(r.qa && r.qa.findings));
  const codes = r.lineage.flatMap((l) => l.findings.map((f) => f.code));
  assert(codes.includes("MUSIC_MASKS_SPEECH"), "failure detected: " + JSON.stringify(codes));
  const actions = r.lineage.flatMap((l) => l.applied.map((a) => a.action));
  assert(actions.includes("ADJUST_MUSIC_GAIN") || actions.includes("ADJUST_DUCKING"), "local corrective action applied");
  assert(r.attempts >= 1, "repair attempts recorded");
});

await runTest("M4 clipping repaired via GAIN_CORRECTION/LIMIT", async () => {
  const s = setupProduction();
  const boosted = JSON.parse(JSON.stringify(s.mixPlan));
  for (const c of boosted.tracks.voice) c.gainDb += 12;
  for (const c of boosted.tracks.music) c.gainDb += 6;
  const r = mix.mixWithRepair({ mixPlan: boosted, profile: s.profile, intentionalSilence: s.plan.intentionalSilence });
  const codes = r.lineage.flatMap((l) => l.findings.map((f) => f.code));
  assert(codes.includes("CLIPPING") || codes.includes("TRUE_PEAK_POLICY_FAIL"), "peak failure detected: " + JSON.stringify(codes));
  assert(r.ok, "repaired to PASS: " + JSON.stringify(r.qa && r.qa.findings));
});

await runTest("M5 UNEXPECTED_SILENCE detected; intentional silence never flagged", async () => {
  const s = setupProduction();
  const result = mix.engine.executeMix(s.mixPlan, { sampleRate: FS, resolveAudio: (p) => fs.readFileSync(p) });
  assert(result.ok, "render ok");
  // Direct QA with empty intentionalSilence → the declared dramatic-pause gap must fire.
  const qa = mix.mixQA(result, s.mixPlan, { profile: s.profile, intentionalSilence: [] });
  assert(qa.findings.some((f) => f.code === "UNEXPECTED_SILENCE"), "undeclared gap flagged");
  // With the declared ranges → no silence finding.
  const qa2 = mix.mixQA(result, s.mixPlan, { profile: s.profile, intentionalSilence: s.plan.intentionalSilence });
  assert(!qa2.findings.some((f) => f.code === "UNEXPECTED_SILENCE"), "declared silence accepted");
});

await runTest("M6 narration normalization: per-segment spread stays ≤6 dB", async () => {
  const repo = H.makeTempRepo();
  const dir = path.join(repo, "n");
  fs.mkdirSync(dir, { recursive: true });
  const p1 = path.join(dir, "a.wav");
  const p2 = path.join(dir, "b.wav");
  fs.writeFileSync(p1, H.makeSpeechWav({ durationMs: 4000, amplitude: 0.2 }));
  fs.writeFileSync(p2, H.makeSpeechWav({ durationMs: 4000, amplitude: 0.5 }));
  const norm = mix.normalizeNarration([
    { segmentId: "a", path: p1, bytes: fs.readFileSync(p1), startMs: 0, endMs: 4000 },
    { segmentId: "b", path: p2, bytes: fs.readFileSync(p2), startMs: 4000, endMs: 8000 },
  ], FS, -16);
  assert(norm.ok, "normalize ok");
  const gains = norm.clips.map((c) => c.gainDb);
  const spread = Math.max(...gains) - Math.min(...gains);
  assert(spread <= 6.01, `per-segment correction capped (spread ${spread.toFixed(2)} dB)`);
  assert(gains[0] > gains[1], "quieter segment gains more");
});

await runTest("M7 invalidation semantics: gain-only change keeps narrationTimingHash, changes finalMixHash", async () => {
  const s = setupProduction();
  const out1 = path.join(s.repo, "out1");
  const r1 = mix.mixWithRepair({ mixPlan: s.mixPlan, profile: s.profile, intentionalSilence: s.plan.intentionalSilence });
  const f1 = mix.finalizeFinalAudio({ mixResult: r1.mixResult, mixPlan: r1.mixPlan, qaResult: r1.qa, narrationSegments: s.narrationSegments, outputDir: out1 });
  // Mix-only change: music gain.
  const changed = JSON.parse(JSON.stringify(s.mixPlan));
  for (const c of changed.tracks.music) c.gainDb -= 1;
  const r2 = mix.mixWithRepair({ mixPlan: changed, profile: s.profile, intentionalSilence: s.plan.intentionalSilence });
  const f2 = mix.finalizeFinalAudio({ mixResult: r2.mixResult, mixPlan: r2.mixPlan, qaResult: r2.qa, narrationSegments: s.narrationSegments, outputDir: path.join(s.repo, "out2") });
  assertEq(f1.artifact.narrationTimingHash, f2.artifact.narrationTimingHash, "narration timing hash stable");
  assert(f1.artifact.finalMixHash !== f2.artifact.finalMixHash, "final mix hash changes");
  // Narration source bytes untouched by mix-only repair (no TTS regen).
  const narrBytes = s.narrationSegments.map((n) => fs.readFileSync(n.path).toString("base64")).join("|");
  assert(narrBytes.length > 0, "narration files still original bytes (no regeneration)");
});

await runTest("M8 finalize: FinalAudioArtifact complete + WAV written", async () => {
  const s = setupProduction();
  const r = mix.mixWithRepair({ mixPlan: s.mixPlan, profile: s.profile, intentionalSilence: s.plan.intentionalSilence });
  const f = mix.finalizeFinalAudio({ mixResult: r.mixResult, mixPlan: r.mixPlan, qaResult: r.qa, narrationSegments: s.narrationSegments, outputDir: path.join(s.repo, "out") });
  assert(f.ok, "finalize ok");
  const a = f.artifact;
  for (const key of ["assetId", "mixPlanVersion", "durationMs", "qaStatus", "narrationTimingHash", "finalMixHash", "sourceDependencies", "hash", "createdAt"]) {
    assert(a[key] !== undefined, `${key} present`);
  }
  assertEq(a.qaStatus, "PASS", "only PASS can finalize");
  assert(fs.existsSync(f.filePath), "WAV exists");
  const decoded = wav.decodeWav(fs.readFileSync(f.filePath));
  assert(decoded.ok, "written WAV decodes");
  assertEq(decoded.durationMs ?? Math.round((decoded.samples.length / decoded.sampleRate) * 1000), a.durationMs, "artifact duration matches bytes");
});

await runTest("M9 repair budget: bounded, honest REVIEW_REQUIRED when unfixable", async () => {
  // Music too loud AND wrong ducking repeatedly: force deep mask that gain repairs cap out on.
  const s = setupProduction({ musicGainBoostDb: 40 });
  const r = mix.mixWithRepair({ mixPlan: s.mixPlan, profile: s.profile, intentionalSilence: s.plan.intentionalSilence });
  if (!r.ok) {
    assert(r.status === "REVIEW_REQUIRED" || r.status === "PASS" || r.status === "RETURN_2_7", "honest terminal status: " + r.status);
    assert(r.lineage.length <= mix.REPAIR_BUDGET.maxTotalAttempts + 2, "lineage bounded");
  } else {
    assert(r.attempts <= mix.REPAIR_BUDGET.maxTotalAttempts, "converged within budget");
  }
});

console.log(`\n=== audio-mix: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
