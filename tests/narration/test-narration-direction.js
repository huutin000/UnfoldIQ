"use strict";

/**
 * Phase 2.2 tests — Narration Direction (T1–T10 + G1–G6 + over-direction).
 * All negative cases run against isolated tmp roots; no production state.
 */

const fs = require("fs");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const narr = require(REPO + "/lib/narration/index.js");
const H = require(REPO + "/tests/fixtures/phase223/helpers.js");

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
  try {
    await fn();
    passed += 1;
    console.log("[PASS] " + name);
  } catch (e) {
    failed += 1;
    console.log("[FAIL] " + name + " — " + e.message);
  }
}

const D2 = [
  { segmentId: "S2", emphasis: [{ text: "Kokoro", occurrence: 1, strength: "MODERATE" }], pauseIntent: [{ kind: "BEAT", afterText: "Kokoro.", occurrence: 1 }], energy: "BALANCED", emotion: "CURIOSITY", paceIntent: "MODERATE", directionReason: "key term intro" },
  { segmentId: "S3", emphasis: [], pauseIntent: [], energy: "BALANCED", emotion: "INSTRUCTIVE", paceIntent: "SLOWER", directionReason: "name/place walkthrough" },
];

async function main() {
  await runTest("T1 valid Narration Direction persists", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    assert(r.ok, "create ok");
    const abs = path.join(root, "projects", projectId, r.rel);
    assert(fs.existsSync(abs), "artifact file exists");
    const doc = JSON.parse(fs.readFileSync(abs, "utf8"));
    assertEq(doc.narrationDirectionId, r.narrationDirection.narrationDirectionId, "id matches");
    assert(/^nd-[0-9a-f]{12}$/.test(doc.narrationDirectionId), "id pattern");
    assert(doc.scriptRef.scriptArtifactId === H.SCRIPT.scriptArtifactId, "scriptRef bound");
    assert(doc.voiceBibleRef === H.VOICE_BIBLE.voiceBibleId, "voiceBibleRef bound");
  });

  await runTest("T2 invalid schema rejected", () => {
    const bad = { ...structuredClone(H.SCRIPT) };
    const doc = {
      schemaVersion: "1.0.0", narrationDirectionId: "nd-0123456789ab", version: 1, projectId: "p1",
      scriptRef: { scriptArtifactId: H.SCRIPT.scriptArtifactId, scriptVersion: 1 },
      voiceBibleRef: H.VOICE_BIBLE.voiceBibleId, language: "en-us",
      segments: [{ segmentId: "S1", segmentOrdinal: 0, sourceTextHash: narr.segmentHash(H.SCRIPT.segments[0].text), pauseIntent: [{ kind: "HYPER", afterText: "x", occurrence: 1 }] }],
      stats: { totalSegments: 6, directedSegments: 1, directionCoveragePercent: 16.67, emphasisCount: 0, explicitPauseCount: 1 },
      provenance: null, fingerprint: "0123456789abcdef",
    };
    void bad;
    const v = narr.validateSchemaOnly(doc);
    assert(!v.ok, "bad pause kind rejected by schema");
    assert(v.errors[0].code === "NARRATION_DIRECTION_SCHEMA_INVALID", "structured schema code");
  });

  await runTest("T3 script mismatch rejected (fail closed, stale)", () => {
    const { root, projectId } = H.makeRoot();
    const created = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    assert(created.ok, "create ok");
    const changedScript = { ...H.SCRIPT, scriptVersion: 2, segments: H.SCRIPT.segments.map((s, i) => (i === 1 ? { ...s, text: "That threshold was Kokoro, and it changed everything." } : s)) };
    const stale = narr.checkScriptStaleness(root, projectId, created.narrationDirection.narrationDirectionId, changedScript);
    assert(stale.ok && stale.stale === true, "direction is stale after script change");
    const v = narr.validateNarrationDirection(created.narrationDirection, { scriptDoc: changedScript, voiceBible: H.VOICE_BIBLE });
    assert(v.stale === true, "validate flags stale");
    assert(v.errors.some((e) => e.code === "NARRATION_DIRECTION_SCRIPT_MISMATCH"), "script mismatch code");
  });

  await runTest("T4 sparse direction valid", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    assert(r.ok, "create ok");
    assertEq(r.narrationDirection.stats.directedSegments, 2, "2 of 6 segments directed");
    assertEq(r.narrationDirection.stats.totalSegments, 6, "total = script length");
    assertEq(r.narrationDirection.stats.directionCoveragePercent, 33.33, "coverage 33.33%");
    assertEq(r.narrationDirection.stats.overDirectionReview, false, "no over-direction flag");
  });

  await runTest("T5 default/no-direction segment valid (inherits Voice Bible)", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    assert(r.ok, "create ok");
    const directed = new Set(r.narrationDirection.segments.map((s) => s.segmentId));
    for (const seg of H.SCRIPT.segments) {
      if (!directed.has(seg.segmentId)) {
        const results = r.verification.segmentResults;
        void results;
      }
    }
    assert(r.verification.allValid === true, "verification passes with untouched neutral segments");
    assert(r.narrationDirection.segments.every((s) => s.speakerId === null), "directed segments default to narrator (no duplicated voice id)");
  });

  await runTest("T6 ambiguous emphasis rejected", () => {
    const { root, projectId } = H.makeRoot();
    const missing = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "S2", emphasis: [{ text: "Nonexistent", occurrence: 1 }] }] });
    assert(!missing.ok && missing.code === "NARRATION_DIRECTION_EMPHASIS_AMBIGUOUS", "unknown emphasis text rejected");
    const { root: root2, projectId: pid2 } = H.makeRoot();
    const beyond = narr.createNarrationDirection(root2, pid2, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "S2", emphasis: [{ text: "Kokoro", occurrence: 5 }] }] });
    assert(!beyond.ok && beyond.code === "NARRATION_DIRECTION_EMPHASIS_AMBIGUOUS", "occurrence beyond count rejected");
    const { root: root3, projectId: pid3 } = H.makeRoot();
    const unknownSeg = narr.createNarrationDirection(root3, pid3, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "SZ", emphasis: [] }] });
    assert(!unknownSeg.ok && unknownSeg.code === "NARRATION_DIRECTION_SEGMENT_NOT_FOUND", "unknown segment rejected");
  });

  await runTest("T7 emotion outside Voice Bible rejected", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "S2", emotion: "SEXY_ANNOUNCER" }] });
    assert(!r.ok && r.code === "NARRATION_DIRECTION_EMOTION_NOT_ALLOWED", "prohibited emotion rejected");
    // A failed create persists nothing, so a valid create afterwards succeeds.
    const r2 = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "S2", emotion: "CONFIDENT" }] });
    assert(r2.ok, "valid emotion accepted after failed attempt (fail-closed left no partial state)");
  });

  await runTest("T8 speaker mismatch rejected", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "S2", speakerId: "robot-voice" }] });
    assert(!r.ok && r.code === "NARRATION_DIRECTION_SPEAKER_INVALID", "unsupported character speaker rejected");
  });

  await runTest("T9 same semantic direction idempotent", () => {
    const { root, projectId } = H.makeRoot();
    const a = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    const b = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    assert(a.ok && b.ok, "both calls ok");
    assertEq(b.code, "IDEMPOTENT_REPLAY", "second call replays");
    assertEq(b.narrationDirection.narrationDirectionId, a.narrationDirection.narrationDirectionId, "same id");
    const listed = narr.listNarrationDirections(root, projectId);
    assertEq(listed.narrationDirections.length, 1, "exactly one durable version");
  });

  await runTest("T10 revision creates immutable new version", () => {
    const { root, projectId } = H.makeRoot();
    const v1 = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    const changed = D2.map((d) => ({ ...d, energy: d.energy === "ELEVATED" ? "ELEVATED" : "ELEVATED" }));
    const v2 = narr.reviseNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: changed, baseDirectionId: v1.narrationDirection.narrationDirectionId });
    assert(v2.ok && v2.replay === false, "revision persisted");
    assert(v2.narrationDirection.version === 2, "version bumped");
    assert(v2.narrationDirection.narrationDirectionId !== v1.narrationDirection.narrationDirectionId, "new identity");
    const old = narr.loadNarrationDirection(root, projectId, v1.narrationDirection.narrationDirectionId);
    assert(old.ok, "old version still loadable");
    assertEq(old.narrationDirection.fingerprint, v1.narrationDirection.fingerprint, "old version byte-identical");
    // Re-revise with identical semantic content → replay, never v3.
    const replay = narr.reviseNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: changed, baseDirectionId: v2.narrationDirection.narrationDirectionId });
    assert(replay.ok && replay.replay === true, "identical revision replays");
    const listed = narr.listNarrationDirections(root, projectId);
    assertEq(listed.narrationDirections.length, 2, "still exactly two versions");
  });

  await runTest("G1 neutral segment: no unnecessary direction required", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [] });
    assert(r.ok && r.narrationDirection.segments.length === 0, "zero-direction document is valid");
    assertEq(r.narrationDirection.stats.directionCoveragePercent, 0, "coverage 0%");
    assertEq(r.narrationDirection.stats.overDirectionReview, false, "no over-direction flag");
  });

  await runTest("G2+G3 deliberate emphasis and semantic pause persist", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    assert(r.ok, "create ok");
    const s2 = r.narrationDirection.segments.find((s) => s.segmentId === "S2");
    assertEq(s2.emphasis[0].text, "Kokoro", "emphasis term kept verbatim (no text mutation)");
    assertEq(s2.pauseIntent[0].kind, "BEAT", "semantic pause kind stored (not provider ms)");
  });

  await runTest("G4 allowed emotional intent accepted", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "S6", emotion: "FRIENDLY" }] });
    assert(r.ok, "FRIENDLY within Voice Bible range accepted");
  });

  await runTest("G5 prohibited delivery pattern rejected", () => {
    const { root, projectId } = H.makeRoot();
    const pauses = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "S2", pauseIntent: [{ kind: "MICRO", afterText: "That" }, { kind: "CLAUSE", afterText: "threshold" }, { kind: "BEAT", afterText: "Kokoro." }] }] });
    assert(!pauses.ok && pauses.code === "NARRATION_DIRECTION_CONFLICT", "EXCESSIVE_PAUSES pattern rejected");
    const { root: root2, projectId: pid2 } = H.makeRoot();
    const overact = narr.createNarrationDirection(root2, pid2, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "S2", energy: "ELEVATED", emphasis: [{ text: "Kokoro", occurrence: 1 }, { text: "everything", occurrence: 1 }] }] });
    assert(!overact.ok && overact.code === "NARRATION_DIRECTION_CONFLICT", "OVERACTING pattern rejected");
    const { root: root3, projectId: pid3 } = H.makeRoot();
    const slow = narr.createNarrationDirection(root3, pid3, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "S2", paceIntent: "SLOWER", energy: "LOW" }] });
    assert(!slow.ok && slow.code === "NARRATION_DIRECTION_CONFLICT", "UNNATURALLY_SLOW_CINEMATIC pattern rejected");
  });

  await runTest("G6 narrator inheritance from Voice Bible", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    assert(r.ok, "create ok");
    assert(r.narrationDirection.voiceBibleRef === H.VOICE_BIBLE.voiceBibleId, "voice identity resolves through the Voice Bible, not per-segment literals");
    assert(r.narrationDirection.segments.every((s) => !s.speakerId || s.speakerId === "narrator"), "no character voices invented");
  });

  await runTest("Over-direction is measured, not rewarded", () => {
    const { root, projectId } = H.makeRoot();
    const all = H.SCRIPT.segments.map((s) => ({ segmentId: s.segmentId, energy: "BALANCED" }));
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: all });
    assert(r.ok, "full coverage is legal");
    assertEq(r.narrationDirection.stats.directionCoveragePercent, 100, "coverage measured");
    assertEq(r.narrationDirection.stats.overDirectionReview, true, "over-direction review flag set (measured, never auto-fail)");
  });

  await runTest("Sparse directional segments carry sourceTextHash identity", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    for (const s of r.narrationDirection.segments) {
      const seg = H.SCRIPT.segments.find((x) => x.segmentId === s.segmentId);
      assertEq(s.sourceTextHash, narr.segmentHash(seg.text), `sourceTextHash binds ${s.segmentId} to exact text`);
      assertEq(s.segmentOrdinal, seg.ordinal, "ordinal preserved (array position never identity)");
    }
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
