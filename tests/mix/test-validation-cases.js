"use strict";

/**
 * Phase 2.8-I — Minimum validation scenarios (spec §12, Cases A–I) on a
 * ~2.5-minute synthetic audio production. Real bytes, real decode, real mix,
 * real QA — no mocks. Proves: music optional (A), instrumental bed + ducking
 * (B), multi-cue (C), short-asset loop (D), long-track region selection (E),
 * featured SFX priority (F), rights fail-closed (G), local repair (H),
 * mix-only change invalidation semantics (I).
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

// ---- ~150s canonical production --------------------------------------------
// s1 hook 0–30 (narration, EMOTION → BED)
// s2 explanation 30–60 (narration, EMOTION → same BED cue)
// s3 dramatic pause 60–70 (NONE, intentional silence)
// s4 montage 70–100 (no narration, ENERGY → FEATURED)
// s5 tension build 100–130 (narration, TENSION → new BED cue)
// s6 outro 130–150 (no narration, IDENTITY → FEATURED)
const SEGMENTS = [
  { segmentId: "s1", startMs: 0, endMs: 30000 },
  { segmentId: "s2", startMs: 30000, endMs: 60000 },
  { segmentId: "s3", startMs: 60000, endMs: 70000 },
  { segmentId: "s4", startMs: 70000, endMs: 100000 },
  { segmentId: "s5", startMs: 100000, endMs: 130000 },
  { segmentId: "s6", startMs: 130000, endMs: 150000 },
];
const INTENTS_SIGNALS = [
  { segmentId: "s1", narrationActive: true, creativePurpose: "EMOTION", mood: ["calm"], energy: 0.4 },
  { segmentId: "s2", narrationActive: true, creativePurpose: "EMOTION", mood: ["calm"], energy: 0.4 },
  { segmentId: "s3", dramaticPause: true, intentionalSilence: true },
  { segmentId: "s4", narrationActive: false, sceneType: "montage", creativePurpose: "ENERGY", mood: ["calm"], energy: 0.8 },
  { segmentId: "s5", narrationActive: true, creativePurpose: "TENSION", mood: ["calm"], energy: 0.6 },
  { segmentId: "s6", narrationActive: false, sceneType: "outro", creativePurpose: "IDENTITY", mood: ["calm"], energy: 0.5 },
];

function ingest(repo, bytes, meta, rights) {
  const r = library.ingestMusicAsset({ bytes, repoRoot: repo, metadata: meta, rights: rights || H.APPROVED_RIGHTS });
  if (!r.ok) throw new Error("ingest failed: " + r.message);
  return r;
}

/** Full production: library (bed 180s + energetic 25s + ambience + sfx), locked plan, mix plan. */
function buildProduction({ musicBoostDb = 0 } = {}) {
  const repo = H.makeTempRepo();
  // Low-energy intro section forces Case E region selection away from 00:00.
  const bedBytes = H.makeMusicWav({ durationMs: 180000, segments: [{ untilMs: 30000, energy: 0.08 }, { untilMs: 90000, energy: 0.45 }, { untilMs: 180000, energy: 0.6 }] });
  const bed = ingest(repo, bedBytes, { title: "bed-180s", sourceType: "USER_IMPORTED_LICENSED_ASSET", mood: ["calm"], energyProfile: "MEDIUM", vocalType: "INSTRUMENTAL" });
  const bedAnalysis = analysis.analyzeMusicAsset({ bytes: bedBytes, assetId: bed.assetId }).analysis;
  const shortBytes = H.makeMusicWav({ durationMs: 25000, segments: [{ untilMs: 25000, energy: 0.75 }] });
  const short = ingest(repo, shortBytes, { title: "energetic-25s", sourceType: "USER_IMPORTED_LICENSED_ASSET", mood: ["calm"], energyProfile: "HIGH", vocalType: "INSTRUMENTAL" });
  const shortAnalysis = analysis.analyzeMusicAsset({ bytes: shortBytes, assetId: short.assetId }).analysis;
  const ambBytes = H.makeAmbienceWav({ durationMs: 160000 });
  const amb = ingest(repo, ambBytes, { title: "forest-ambience", sourceType: "USER_IMPORTED_LICENSED_ASSET" });
  const sfxBytes = H.makeSfxWav({ durationMs: 1200 });
  const sfx = ingest(repo, sfxBytes, { title: "roar", sourceType: "USER_IMPORTED_LICENSED_ASSET" });

  const intents = intent.buildMusicIntents({ projectId: "validation", segments: INTENTS_SIGNALS }).artifact.intents;
  const plan = planLib.buildMusicPlan({
    projectId: "validation",
    intents,
    segments: SEGMENTS,
    repoRoot: repo,
    analyses: { [bed.assetId]: bedAnalysis, [short.assetId]: shortAnalysis },
    targetPlatforms: ["youtube"],
    commercialContext: "STANDARD",
    ambienceInputs: [{ assetId: amb.assetId, startMs: 0, endMs: 150000, association: "forest", layer: "BACKGROUND", usageDecisionRef: `${amb.assetId}:APPROVED_FOR_PROJECT` }],
    sfxInputs: [{ kind: "ONE_SHOT_SFX", priority: "FEATURED", assetId: sfx.assetId, timelineStartMs: 85000, durationMs: 1200, purpose: "reveal hit in narration-free montage", duckMusic: true, usageDecisionRef: `${sfx.assetId}:APPROVED_FOR_PROJECT` }],
  });
  if (!plan.ok) throw new Error(plan.message);
  const qa = planLib.semanticQA(plan.plan, { repoRoot: repo });
  if (!qa.ok) throw new Error("semantic QA: " + JSON.stringify(qa.findings));
  for (const c of plan.plan.cues) {
    const r = planLib.lockCue(plan.plan, c.cueId, { semanticResult: qa });
    if (!r.ok) throw new Error("lock failed: " + r.message);
  }
  const narrationDir = path.join(repo, "narration");
  fs.mkdirSync(narrationDir, { recursive: true });
  const narrationSegments = [];
  for (const id of ["s1", "s2", "s5"]) {
    const seg = SEGMENTS.find((s) => s.segmentId === id);
    const p = path.join(narrationDir, `${id}.wav`);
    fs.writeFileSync(p, H.makeSpeechWav({ durationMs: seg.endMs - seg.startMs }));
    narrationSegments.push({ segmentId: id, path: p, startMs: seg.startMs, endMs: seg.endMs });
  }
  const profile = mix.LOUDNESS_PROFILES["youtube-standard@1.0.0"];
  const mp = mix.buildMixPlan({
    projectId: "validation", repoRoot: repo, musicPlan: plan.plan, profile, narrationSegments,
    ambienceAssets: { [amb.assetId]: path.join(repo, amb.record.audioRef || amb.record.audioRef) },
    sfxAssets: { [sfx.assetId]: path.join(repo, sfx.record.audioRef) },
  });
  if (!mp.ok) throw new Error(mp.message);
  if (musicBoostDb) for (const c of mp.mixPlan.tracks.music) c.gainDb += musicBoostDb;
  return {
    repo, plan: plan.plan, mixPlan: mp.mixPlan, profile, narrationSegments, qa,
    assetIds: { bed: bed.assetId, short: short.assetId, amb: amb.assetId, sfx: sfx.assetId },
  };
}

const resolve = (repo) => (p) => fs.readFileSync(p);
function runMix(prod) {
  return mix.mixWithRepair({
    mixPlan: prod.mixPlan, profile: prod.profile,
    intentionalSilence: prod.plan.intentionalSilence,
    resolveAudio: resolve(prod.repo),
  });
}

(async () => {
await runTest("Case A — no music: narration + ambience + intentional silence is a valid production", async () => {
  const repo = H.makeTempRepo();
  const amb = ingest(repo, H.makeAmbienceWav({ durationMs: 40000 }), { title: "amb", sourceType: "USER_IMPORTED_LICENSED_ASSET" });
  const intents = intent.buildMusicIntents({
    projectId: "caseA",
    segments: [
      { segmentId: "a1", narrationActive: true, explicitNone: true },
      { segmentId: "a2", dramaticPause: true, intentionalSilence: true },
    ],
  }).artifact.intents;
  const segments = [{ segmentId: "a1", startMs: 0, endMs: 20000 }, { segmentId: "a2", startMs: 20000, endMs: 26000 }];
  const plan = planLib.buildMusicPlan({
    projectId: "caseA", intents, segments, repoRoot: repo, analyses: {},
    ambienceInputs: [{ assetId: amb.assetId, startMs: 0, endMs: 26000, association: "room tone", layer: "BACKGROUND", usageDecisionRef: `${amb.assetId}:APPROVED_FOR_PROJECT` }],
  });
  assert(plan.ok, "plan valid");
  assertEq(plan.plan.cues.length, 0, "no music cues — music is optional");
  const nd = path.join(repo, "n");
  fs.mkdirSync(nd, { recursive: true });
  const np = path.join(nd, "a1.wav");
  fs.writeFileSync(np, H.makeSpeechWav({ durationMs: 20000 }));
  const profile = mix.LOUDNESS_PROFILES["youtube-standard@1.0.0"];
  const mp = mix.buildMixPlan({
    projectId: "caseA", repoRoot: repo, musicPlan: plan.plan, profile,
    narrationSegments: [{ segmentId: "a1", path: np, startMs: 0, endMs: 20000 }],
    ambienceAssets: { [amb.assetId]: path.join(repo, amb.record.audioRef) },
  });
  assert(mp.ok, "mix plan ok: " + (mp.message || ""));
  assertEq(mp.mixPlan.tracks.music.length, 0, "no accidental-music assumption");
  const r = mix.mixWithRepair({ mixPlan: mp.mixPlan, profile, intentionalSilence: plan.plan.intentionalSilence, resolveAudio: resolve(repo) });
  assert(r.ok, "mix PASS without music: " + JSON.stringify(r.qa && r.qa.findings));
});

await runTest("Case B — narration + instrumental bed: gate, policy, ducking, intelligibility", async () => {
  const prod = buildProduction();
  const bedCue = prod.plan.cues.find((c) => c.segmentIds.includes("s1"));
  assertEq(bedCue.role, "BED", "hook/explanation = BED");
  assertEq(bedCue.vocalPolicy, "INSTRUMENTAL_ONLY", "instrumental under narration");
  const r = runMix(prod);
  assert(r.ok, "mix QA PASS");
  assert(!r.qa.findings.some((f) => f.code === "MUSIC_MASKS_SPEECH"), "narration intelligible (no mask)");
  assert(prod.mixPlan.duckingRules.length >= 1, "dynamic ducking planned");
});

await runTest("Case C — multi-cue: bed → intentional silence → featured cues with justified transitions", async () => {
  const prod = buildProduction();
  assert(prod.plan.cues.length >= 3, `multiple cues (${prod.plan.cues.length})`);
  assertEq(prod.plan.intentionalSilence.length, 1, "silence between cues declared");
  const purposes = prod.plan.cues.map((c) => c.purpose);
  assert(new Set(purposes).size === purposes.length, "each cue has distinct narrative purpose");
  const r = runMix(prod);
  assert(r.ok, "mix QA PASS with multi-cue + crossfades");
  assert(!r.qa.findings.some((f) => f.code === "BAD_CUE_TRANSITION"), "no bad transitions");
});

await runTest("Case D — short music asset (25s for 30s cue): safe loop, no bad loop", async () => {
  const prod = buildProduction();
  const shortCue = prod.plan.cues.find((c) => c.assetId === prod.assetIds.short);
  assert(shortCue, "short asset assigned");
  assert(shortCue.loopPlan.strategy === "LOOP", "loop strategy: " + JSON.stringify(shortCue.loopPlan));
  const r = runMix(prod);
  assert(r.ok, "mix QA PASS with loop");
});

await runTest("Case E — long music asset (180s): best segment selected, not blindly 00:00", async () => {
  const prod = buildProduction();
  // s5 (TENSION, energy 0.6) matches the mid-energy section of the 180s bed,
  // whose first 30s is a deliberately low-energy intro.
  const bedCue = prod.plan.cues.find((c) => c.segmentIds.includes("s5"));
  assert(bedCue && bedCue.assetId === prod.assetIds.bed, "s5 cue uses the long bed asset");
  assert(bedCue.sourceStartMs > 0, `source region starts at ${bedCue.sourceStartMs}ms (not 0)`);
  assertEq(bedCue.loopPlan.strategy, "SINGLE_PASS", "no loop needed");
  const r = runMix(prod);
  assert(r.ok, "mix QA PASS with selected region");
});

await runTest("Case F — featured SFX: localized music duck + natural recovery", async () => {
  const prod = buildProduction();
  const sfxClip = prod.mixPlan.tracks.sfx.find((c) => c.clipId);
  assert(sfxClip && sfxClip.duckMusic === true, "featured SFX ducks music");
  const r = runMix(prod);
  assert(r.ok, "mix QA PASS");
  // The music stem covering the SFX hit (85s, narration-free montage) must dip there.
  const result = r.mixResult;
  const sfxStem = result.stems.find((s) => s.role === "sfx");
  assert(sfxStem, "sfx stem rendered");
  const coveringClip = prod.mixPlan.tracks.music.find((c) => c.startMs <= 85000 && 85000 < c.startMs + (c.durationMs || 0));
  assert(coveringClip, "a music cue covers the SFX moment");
  const musicStem = result.stems.find((s) => s.role === "music" && s.clipId === coveringClip.clipId);
  const beforeDb = rmsDb(musicStem.samples, result.mixFs, 82000, 84500);
  const duringDb = rmsDb(musicStem.samples, result.mixFs, 85000, 86500);
  assert(duringDb < beforeDb - 2, `music dips under SFX (${beforeDb.toFixed(1)} → ${duringDb.toFixed(1)} dB)`);
});

await runTest("Case G — rights failure: REVIEW_REQUIRED asset cannot lock or reach Final Audio", async () => {
  const repo = H.makeTempRepo();
  const bad = ingest(repo, H.makeMusicWav({ durationMs: 30000 }), { title: "unverified", sourceType: "USER_IMPORTED_LICENSED_ASSET" },
    { ...H.APPROVED_RIGHTS, status: "REVIEW_REQUIRED", licenseEvidenceRef: "" });
  const intents = intent.buildMusicIntents({
    projectId: "caseG",
    segments: [{ segmentId: "g1", narrationActive: true, creativePurpose: "EMOTION" }],
  }).artifact.intents;
  const segments = [{ segmentId: "g1", startMs: 0, endMs: 10000 }];
  const plan = planLib.buildMusicPlan({ projectId: "caseG", intents, segments, repoRoot: repo, analyses: {} });
  assert(plan.ok, "plan builds");
  assertEq(plan.plan.cues[0].assetId, undefined, "review-required asset NOT assigned");
  assertEq(plan.acquisitionNeeds.length, 1, "acquisition/replacement required");
  const qa = planLib.semanticQA(plan.plan, { repoRoot: repo });
  assert(qa.findings.some((f) => f.code === "MUSIC_NEEDED_BUT_MISSING"), "cue cannot proceed");
  const lockAttempt = planLib.lockCue(plan.plan, plan.plan.cues[0].cueId, { semanticResult: qa });
  assertEq(lockAttempt.ok, false, "lock blocked");
  assertEq(lockAttempt.code, "CUE_LOCK_BLOCKED", "canonical code");
});

await runTest("Case H — local repair: mask fixed locally; unrelated tracks untouched", async () => {
  const prod = buildProduction();
  // Inject MUSIC_MASKS_SPEECH by boosting ONLY the music clips that sit
  // under narration by 20 dB (designed separation ≈29 dB → drops below the
  // 10 dB floor). Peak-safe: the featured montage clip is untouched.
  for (const m of prod.mixPlan.tracks.music) {
    const underNarration = prod.mixPlan.tracks.voice.some((v) => v.startMs < m.startMs + (m.durationMs || 0) && v.startMs + (v.durationMs || 0) > m.startMs);
    if (underNarration) m.gainDb += 20;
  }
  const narrationBefore = JSON.stringify(prod.mixPlan.tracks.voice);
  const sfxBefore = JSON.stringify(prod.mixPlan.tracks.sfx);
  const r = runMix(prod);
  assert(r.ok, "repaired to PASS");
  const codes = r.lineage.flatMap((l) => l.findings.map((f) => f.code));
  assert(codes.includes("MUSIC_MASKS_SPEECH"), "mask detected");
  const actions = r.lineage.flatMap((l) => l.applied.map((a) => a.action));
  assert(actions.includes("ADJUST_DUCKING") || actions.includes("ADJUST_MUSIC_GAIN"), "local action");
  // Only the affected music branch changed — narration/sfx plans untouched.
  const r2 = runMix(prod);
  assertEq(JSON.stringify(r2.mixPlan.tracks.voice), narrationBefore, "narration plan unchanged");
  assertEq(JSON.stringify(r2.mixPlan.tracks.sfx), sfxBefore, "sfx plan unchanged");
});

await runTest("Case I — mix-only change: narrationTimingHash stable, finalMixHash changes, no upstream regen", async () => {
  const prod = buildProduction();
  const libIndexBefore = fs.readFileSync(path.join(prod.repo, "assets", "music", "library-index.json"), "utf8");
  const narrationBytesBefore = prod.narrationSegments.map((n) => fs.readFileSync(n.path).toString("base64")).join("|");
  const r1 = runMix(prod);
  const f1 = mix.finalizeFinalAudio({ mixResult: r1.mixResult, mixPlan: r1.mixPlan, qaResult: r1.qa, narrationSegments: prod.narrationSegments, outputDir: path.join(prod.repo, "out1"), sourceDependencies: Object.values(prod.assetIds) });
  assert(r1.ok, "baseline mix PASS");
  // Mix-only change: music gain −1 dB.
  const changed = JSON.parse(JSON.stringify(prod.mixPlan));
  for (const c of changed.tracks.music) c.gainDb -= 1;
  const r2 = mix.mixWithRepair({ mixPlan: changed, profile: prod.profile, intentionalSilence: prod.plan.intentionalSilence, resolveAudio: resolve(prod.repo) });
  assert(r2.ok, "changed mix PASS");
  const f2 = mix.finalizeFinalAudio({ mixResult: r2.mixResult, mixPlan: r2.mixPlan, qaResult: r2.qa, narrationSegments: prod.narrationSegments, outputDir: path.join(prod.repo, "out2") });
  assertEq(f1.artifact.narrationTimingHash, f2.artifact.narrationTimingHash, "narration timing hash unchanged");
  assert(f1.artifact.finalMixHash !== f2.artifact.finalMixHash, "final mix hash changed");
  assertEq(fs.readFileSync(path.join(prod.repo, "assets", "music", "library-index.json"), "utf8"), libIndexBefore, "library untouched (no re-download/re-ingest)");
  assertEq(prod.narrationSegments.map((n) => fs.readFileSync(n.path).toString("base64")).join("|"), narrationBytesBefore, "narration bytes untouched (no TTS regen)");
  assertEq(f2.artifact.durationMs, f1.artifact.durationMs, "timeline stable");
});

function rmsDb(samples, fs, startMs, endMs) {
  const s = Math.max(0, Math.round((startMs / 1000) * fs));
  const e = Math.min(samples.length, Math.round((endMs / 1000) * fs));
  if (e <= s) return -120;
  let sum = 0;
  for (let i = s; i < e; i += 1) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / (e - s));
  return rms > 0 ? 20 * Math.log10(rms) : -120;
}

console.log(`\n=== validation-cases A-I: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
