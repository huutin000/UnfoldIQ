"use strict";

/**
 * Phase 2.7-F/G/H tests — MusicPlan: cue grouping, segment selection,
 * loop strategy, semantic QA, lock policy, idempotent re-plan.
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const intent = require(REPO + "/lib/music-intent/index.js");
const planLib = require(REPO + "/lib/music-plan/index.js");
const library = require(REPO + "/lib/music-library/index.js");
const analysis = require(REPO + "/lib/music-analysis/index.js");
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

/** Ingest one approved instrument track into a temp repo + analyze it. */
function setupTrack(repo, { durationMs, segments, freq = 220, vocalType = "INSTRUMENTAL", title = "t" }) {
  const bytes = H.makeMusicWav({ durationMs, segments, freq });
  const ing = library.ingestMusicAsset({
    bytes, repoRoot: repo,
    metadata: { title, sourceType: "USER_IMPORTED_LICENSED_ASSET", mood: ["calm"], energyProfile: "MEDIUM", vocalType },
    rights: H.APPROVED_RIGHTS,
  });
  if (!ing.ok) throw new Error("setup ingest failed: " + ing.message);
  const an = analysis.analyzeMusicAsset({ bytes, assetId: ing.assetId });
  if (!an.ok) throw new Error("setup analysis failed");
  return { assetId: ing.assetId, analysis: an.analysis };
}

const SEGMENTS = [
  { segmentId: "s1", startMs: 0, endMs: 8000 },
  { segmentId: "s2", startMs: 8000, endMs: 16000 },
  { segmentId: "s3", startMs: 16000, endMs: 19000 },
  { segmentId: "s4", startMs: 19000, endMs: 27000 },
];
const INTENTS_INPUT = [
  { segmentId: "s1", narrationActive: true, creativePurpose: "EMOTION", mood: ["calm"], energy: 0.5 },
  { segmentId: "s2", narrationActive: true, creativePurpose: "EMOTION", mood: ["calm"], energy: 0.5 },
  { segmentId: "s3", dramaticPause: true, intentionalSilence: true },
  { segmentId: "s4", narrationActive: false, sceneType: "montage", creativePurpose: "ENERGY", mood: ["calm"], energy: 0.8 },
];

(async () => {
await runTest("P1 groupCues: narrative boundaries, not 1:1 scenes; NONE splits runs", async () => {
  const intents = intent.buildMusicIntents({ projectId: "p", segments: INTENTS_INPUT }).artifact.intents;
  const groups = planLib.groupCues(intents);
  assertEq(groups.length, 2, "EMOTION run + ENERGY montage (NONE pause splits)");
  assertEq(groups[0].segments.length, 2, "s1+s2 one cue despite two segments");
  assertEq(groups[1].segments.length, 1, "s4 separate cue");
});

await runTest("P2 bestSourceRegion: long track picks non-zero region by energy fit", async () => {
  const analysisFake = {
    durationMs: 60000,
    sections: [
      { startMs: 0, endMs: 20000, type: "LOW_ENERGY", energy: 0.2 },
      { startMs: 20000, endMs: 40000, type: "CLIMAX", energy: 0.85 },
      { startMs: 40000, endMs: 60000, type: "OUTRO", energy: 0.4 },
    ],
    energyCurve: Array.from({ length: 300 }, (_, i) => ({ timeMs: i * 200, value: i < 100 ? 0.2 : i < 200 ? 0.85 : 0.4 })),
    safeCutPointsMs: [0, 20000, 40000, 60000],
  };
  const r = planLib.bestSourceRegion(analysisFake, 15000, 0.85);
  assert(r.ok, "region found");
  assertEq(r.sourceStartMs, 20000, "starts at CLIMAX boundary, not 00:00");
});

await runTest("P3 bestSourceRegion: TRACK_TOO_SHORT reported, never fake a region", async () => {
  const r = planLib.bestSourceRegion({ durationMs: 5000, sections: [], energyCurve: [], safeCutPointsMs: [] }, 15000, 0.5);
  assertEq(r.ok, false, "no region");
  assertEq(r.reason, "TRACK_TOO_SHORT", "honest reason");
});

await runTest("P4 decideLoopStrategy decision order", async () => {
  const longTrack = { durationMs: 60000, loopCandidates: [] };
  assertEq(planLib.decideLoopStrategy(longTrack, 30000).strategy, "SINGLE_PASS", "long enough → single pass");
  const shortLoopable = { durationMs: 8000, loopCandidates: [{ startMs: 2000, endMs: 6000, confidence: 0.8 }] };
  const loop = planLib.decideLoopStrategy(shortLoopable, 20000);
  assertEq(loop.strategy, "LOOP", "safe loop preferred");
  assert(loop.repetitions >= 1, "loop repetitions computed");
  assertEq(loop.crossfadeMs > 0, true, "crossfade planned");
  const shortHalf = { durationMs: 6000, loopCandidates: [] };
  assertEq(planLib.decideLoopStrategy(shortHalf, 10000).strategy, "SILENCE_FALLBACK", "≥50% coverage → silence fallback");
  const tiny = { durationMs: 2000, loopCandidates: [] };
  assertEq(planLib.decideLoopStrategy(tiny, 20000).strategy, "NEEDS_NEW_SEGMENT", "too short → upstream");
});

await runTest("P5 buildMusicPlan assigns approved asset + loop plan + rights ref", async () => {
  const repo = H.makeTempRepo();
  const t = setupTrack(repo, { durationMs: 120000, segments: [{ untilMs: 60000, energy: 0.5 }, { untilMs: 120000, energy: 0.7 }] });
  const intents = intent.buildMusicIntents({ projectId: "p", segments: INTENTS_INPUT }).artifact.intents;
  const r = planLib.buildMusicPlan({ projectId: "p", intents, segments: SEGMENTS, repoRoot: repo, analyses: { [t.assetId]: t.analysis }, targetPlatforms: ["youtube"], commercialContext: "STANDARD" });
  assert(r.ok, "plan valid: " + (r.message || ""));
  assertEq(r.plan.cues.length, 2, "two cues");
  assert(r.plan.cues.every((c) => c.assetId === t.assetId), "asset assigned from approved library");
  assert(r.plan.cues.every((c) => (c.usageDecisionRef || "").endsWith("APPROVED_FOR_PROJECT")), "rights ref recorded");
  assert(r.plan.intentionalSilence.length === 1, "intentional silence carried");
  assertEq(r.acquisitionNeeds.length, 0, "no acquisition needs");
});

await runTest("P6 buildMusicPlan: no fitting asset → acquisition need, not a fake cue", async () => {
  const repo = H.makeTempRepo(); // empty library
  const intents = intent.buildMusicIntents({ projectId: "p", segments: INTENTS_INPUT }).artifact.intents;
  const r = planLib.buildMusicPlan({ projectId: "p", intents, segments: SEGMENTS, repoRoot: repo, analyses: {} });
  assert(r.ok, "plan still builds");
  assert(r.plan.cues.every((c) => !c.assetId), "no fake assignment");
  assertEq(r.acquisitionNeeds.length, 2, "acquisition brief needs recorded");
});

await runTest("P7 semanticQA: RIGHTS_NOT_APPROVED for review-required usage ref", async () => {
  const plan = {
    version: "1.0.0", projectId: "p", status: "PLANNED",
    intents: [], cues: [{
      cueId: "c1", segmentIds: ["s1"], role: "BED", purpose: "EMOTION", assetId: "a1",
      timelineStartMs: 0, timelineEndMs: 8000, vocalPolicy: "INSTRUMENTAL_ONLY",
      usageDecisionRef: "a1:REVIEW_REQUIRED", locked: false, reason: "test",
    }], ambience: [], sfx: [], intentionalSilence: [],
  };
  const qa = planLib.semanticQA(plan);
  assertEq(qa.status, "QA_FAIL", "blocked");
  assert(qa.findings.some((f) => f.code === "RIGHTS_NOT_APPROVED"), "canonical code");
});

await runTest("P8 semanticQA: VOCAL_COMPETES_WITH_SPEECH for lyrical asset under instrumental policy", async () => {
  const repo = H.makeTempRepo();
  const t = setupTrack(repo, { durationMs: 30000, segments: [{ untilMs: 30000, energy: 0.5 }], vocalType: "LYRICAL_VOCAL" });
  const plan = {
    version: "1.0.0", projectId: "p", status: "PLANNED",
    intents: [], cues: [{
      cueId: "c1", segmentIds: ["s1"], role: "BED", purpose: "EMOTION", assetId: t.assetId,
      timelineStartMs: 0, timelineEndMs: 8000, vocalPolicy: "INSTRUMENTAL_ONLY",
      usageDecisionRef: `${t.assetId}:APPROVED_FOR_PROJECT`, locked: false, reason: "test",
    }], ambience: [], sfx: [], intentionalSilence: [],
  };
  const qa = planLib.semanticQA(plan, { repoRoot: repo });
  assert(qa.findings.some((f) => f.code === "VOCAL_COMPETES_WITH_SPEECH"), "canonical code");
});

await runTest("P9 lock gate: locked only with QA PASS + APPROVED_FOR_PROJECT", async () => {
  const repo = H.makeTempRepo();
  const t = setupTrack(repo, { durationMs: 120000, segments: [{ untilMs: 60000, energy: 0.5 }, { untilMs: 120000, energy: 0.7 }] });
  const intents = intent.buildMusicIntents({ projectId: "p", segments: INTENTS_INPUT }).artifact.intents;
  const r = planLib.buildMusicPlan({ projectId: "p", intents, segments: SEGMENTS, repoRoot: repo, analyses: { [t.assetId]: t.analysis } });
  const qa = planLib.semanticQA(r.plan, { repoRoot: repo });
  const locked = planLib.lockCue(r.plan, r.plan.cues[0].cueId, { semanticResult: qa });
  assert(locked.ok, "lock succeeds: " + (locked.message || ""));
  assertEq(locked.cue.locked, true, "locked flag");
  assertEq(locked.cue.lockGate.rights, "APPROVED_FOR_PROJECT", "gate recorded");
  const again = planLib.lockCue(r.plan, r.plan.cues[0].cueId, { semanticResult: qa });
  assertEq(again.ok, false, "double lock rejected");
  planLib.unlockCue(r.plan, r.plan.cues[0].cueId);
  assertEq(r.plan.cues[0].locked, false, "unlock works");
});

await runTest("P10 BAD_CUE_TRANSITION: adjacent identical source regions flagged", async () => {
  const plan = {
    version: "1.0.0", projectId: "p", status: "PLANNED", intents: [],
    cues: [
      { cueId: "c1", segmentIds: ["s1"], role: "BED", purpose: "EMOTION", assetId: "a1", sourceStartMs: 0, sourceEndMs: 8000, timelineStartMs: 0, timelineEndMs: 8000, vocalPolicy: "INSTRUMENTAL_ONLY", usageDecisionRef: "a1:APPROVED_FOR_PROJECT", locked: false, reason: "x" },
      { cueId: "c2", segmentIds: ["s2"], role: "BED", purpose: "EMOTION", assetId: "a1", sourceStartMs: 0, sourceEndMs: 8000, timelineStartMs: 8000, timelineEndMs: 16000, vocalPolicy: "INSTRUMENTAL_ONLY", usageDecisionRef: "a1:APPROVED_FOR_PROJECT", locked: false, reason: "x" },
    ], ambience: [], sfx: [], intentionalSilence: [],
  };
  const qa = planLib.semanticQA(plan);
  assert(qa.findings.some((f) => f.code === "BAD_CUE_TRANSITION"), "canonical code");
});

await runTest("P11 mergeLockedCues: locked cues survive re-plan; changed cues do not", async () => {
  const repo = H.makeTempRepo();
  const t = setupTrack(repo, { durationMs: 120000, segments: [{ untilMs: 60000, energy: 0.5 }, { untilMs: 120000, energy: 0.7 }] });
  const intents = intent.buildMusicIntents({ projectId: "p", segments: INTENTS_INPUT }).artifact.intents;
  const r1 = planLib.buildMusicPlan({ projectId: "p", intents, segments: SEGMENTS, repoRoot: repo, analyses: { [t.assetId]: t.analysis } });
  const qa1 = planLib.semanticQA(r1.plan, { repoRoot: repo });
  for (const c of r1.plan.cues) planLib.lockCue(r1.plan, c.cueId, { semanticResult: qa1 });
  const r2 = planLib.buildMusicPlan({ projectId: "p", intents, segments: SEGMENTS, repoRoot: repo, analyses: { [t.assetId]: t.analysis } });
  assert(r2.plan.cues.every((c) => !c.locked), "fresh plan unlocked");
  const merged = planLib.mergeLockedCues(r2.plan, r1.plan);
  assertEq(merged.preserved, 2, "both locked cues preserved");
  assert(merged.plan.cues.every((c) => c.locked), "locks restored");
});

await runTest("P12 SFX without purpose flagged as filler (SFX_EVENT_MISMATCH)", async () => {
  const plan = {
    version: "1.0.0", projectId: "p", status: "PLANNED", intents: [], cues: [],
    ambience: [],
    sfx: [{ cueId: "x1", kind: "ONE_SHOT_SFX", priority: "SUPPORTING", assetId: "a", timelineStartMs: 0, durationMs: 500, locked: false, reason: "" }],
    intentionalSilence: [],
  };
  const qa = planLib.semanticQA(plan);
  assert(qa.findings.some((f) => f.code === "SFX_EVENT_MISMATCH"), "canonical code");
});

console.log(`\n=== music-plan: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
