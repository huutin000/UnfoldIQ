"use strict";

/**
 * Phase 2.7-B tests — Music Necessity Gate + Vocal Policy.
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const intent = require(REPO + "/lib/music-intent/index.js");

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
await runTest("T1 mandatory invariant: no purpose → NONE", async () => {
  const r = intent.gateSegment({ segmentId: "s1", narrationActive: true });
  assertEq(r.intent.presence, "NONE", "no purpose defaults to NONE");
  assert(r.intent.confidence > 0, "confidence recorded");
});

await runTest("T2 narration + explicit purpose → BED + INSTRUMENTAL_ONLY", async () => {
  const r = intent.gateSegment({ segmentId: "s2", narrationActive: true, creativePurpose: "EMOTION" });
  assertEq(r.intent.presence, "BED", "narration-active cannot be FEATURED");
  assertEq(r.intent.vocalPolicy, "INSTRUMENTAL_ONLY", "narration active → instrumental");
  assertEq(r.intent.purpose, "EMOTION", "explicit purpose preserved");
});

await runTest("T3 montage without narration → FEATURED", async () => {
  const r = intent.gateSegment({ segmentId: "s3", narrationActive: false, sceneType: "montage" });
  assertEq(r.intent.presence, "FEATURED", "montage is featured context");
  assertEq(r.intent.purpose, "ENERGY", "montage infers ENERGY");
});

await runTest("T4 dramatic pause → NONE + intentionalSilence", async () => {
  const r = intent.gateSegment({ segmentId: "s4", dramaticPause: true, intentionalSilence: true });
  assertEq(r.intent.presence, "NONE", "dramatic pause = no music");
  assertEq(r.intent.intentionalSilence, true, "silence declared intentional");
});

await runTest("T5 quote/testimony → NONE (focus)", async () => {
  const r = intent.gateSegment({ segmentId: "s5", isQuote: true });
  assertEq(r.intent.presence, "NONE", "quote needs focus, no music");
});

await runTest("T6 explicit NONE override wins", async () => {
  const r = intent.gateSegment({ segmentId: "s6", narrationActive: true, creativePurpose: "TENSION", explicitNone: true });
  assertEq(r.intent.presence, "NONE", "explicit none wins over purpose");
});

await runTest("T7 explicit override without purpose blocked", async () => {
  const r = intent.gateSegment({ segmentId: "s7", explicitPresence: "BED" });
  assertEq(r.ok, false, "override without purpose rejected");
  assertEq(r.code, "INTENT_PURPOSE_REQUIRED", "canonical error code");
});

await runTest("T8 VOCAL_FEATURED only for foreground music moments", async () => {
  const r = intent.gateSegment({ segmentId: "s8", narrationActive: false, sceneType: "musicMoment", creativePurpose: "EMOTION" });
  assertEq(r.intent.vocalPolicy, "VOCAL_FEATURED", "music-moment allows featured vocals");
  const r2 = intent.gateSegment({ segmentId: "s9", narrationActive: true, sceneType: "musicMoment", creativePurpose: "EMOTION" });
  assert(r2.intent.vocalPolicy !== "VOCAL_FEATURED", "narration blocks featured vocals");
});

await runTest("T9 missing segmentId rejected", async () => {
  const r = intent.gateSegment({});
  assertEq(r.ok, false, "input validation");
  assertEq(r.code, "INTENT_INPUT_INVALID", "canonical error code");
});

await runTest("T10 full artifact build + schema validation", async () => {
  const r = intent.buildMusicIntents({
    projectId: "p1",
    segments: [
      { segmentId: "a", narrationActive: true, creativePurpose: "EMOTION", mood: ["calm"], energy: 0.4 },
      { segmentId: "b", dramaticPause: true, intentionalSilence: true },
      { segmentId: "c", narrationActive: false, sceneType: "outro" },
    ],
  });
  assert(r.ok, "artifact builds clean: " + (r.message || ""));
  assertEq(r.artifact.intents.length, 3, "one intent per segment");
  assertEq(r.artifact.intents[0].presence, "BED", "a = BED");
  assertEq(r.artifact.intents[1].presence, "NONE", "b = NONE");
  assertEq(r.artifact.intents[2].presence, "FEATURED", "outro = FEATURED (identity)");
  const v = intent.validateArtifact(r.artifact);
  assert(v.ok, "schema valid: " + v.errors);
});

await runTest("T11 reviewIntents flags presence-without-purpose", async () => {
  const r = intent.buildMusicIntents({
    projectId: "p1",
    segments: [{ segmentId: "x", narrationActive: false }],
  });
  r.artifact.intents[0].presence = "BED"; // inject inconsistent state
  const review = intent.reviewIntents(r.artifact);
  assertEq(review.ok, false, "inconsistency detected");
  assertEq(review.findings[0].code, "MUSIC_NOT_NEEDED", "canonical finding code");
});

console.log(`\n=== music-intent: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
})();
