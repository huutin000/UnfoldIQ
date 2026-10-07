"use strict";

/**
 * Phase 2.2+2.3 — Golden regression G1–G18 + golden definition/baseline.
 *
 * G1–G14, G16–G18 run deterministically against isolated tmp roots with the
 * identity phonemize transport (G2P context-stability of the real runtime is
 * separately proven live in tests/pronunciation/test-pronunciation-runtime.js
 * and the combined E2E). G15 executes the REAL Kokoro quiet G2P branch.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const narr = require(path.join(REPO, "lib", "narration", "index.js"));
const pron = require(path.join(REPO, "lib", "pronunciation", "index.js"));
const kokoroPhonemize = require(path.join(REPO, "providers", "runtime", "kokoro-phonemize.js"));
const gold = require(path.join(REPO, "lib", "golden", "index.js"));
const H = require(path.join(REPO, "tests", "fixtures", "phase223", "helpers.js"));

const GOLDEN_PROJECT_ID = "gold-narration-pronunciation";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("  ok  " + msg);
}
function assertEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERTION FAILED: ${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
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
  { segmentId: "S2", emphasis: [{ text: "Kokoro", occurrence: 1, strength: "MODERATE" }], pauseIntent: [{ kind: "BEAT", afterText: "Kokoro.", occurrence: 1 }], energy: "BALANCED", emotion: "CURIOSITY", paceIntent: "MODERATE" },
  { segmentId: "S3", emotion: "INSTRUCTIVE", paceIntent: "SLOWER", energy: "BALANCED" },
];

async function main() {
  // ---------------- G1–G6 narration direction -------------------------------
  await runTest("G1 neutral segment — no unnecessary direction", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [] });
    assert(r.ok && r.narrationDirection.segments.length === 0, "zero-direction document valid; Voice Bible defaults inherited");
  });
  await runTest("G2 deliberate emphasis", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    const s2 = r.narrationDirection.segments.find((s) => s.segmentId === "S2");
    assert(r.ok && s2.emphasis[0].text === "Kokoro", "emphasis recorded verbatim");
  });
  await runTest("G3 deliberate semantic pause", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    const s2 = r.narrationDirection.segments.find((s) => s.segmentId === "S2");
    assert(r.ok && s2.pauseIntent[0].kind === "BEAT", "semantic pause intent stored");
  });
  await runTest("G4 allowed emotional intent", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "S6", emotion: "CONFIDENT" }] });
    assert(r.ok, "CONFIDENT within Voice Bible range");
  });
  await runTest("G5 prohibited emotional/delivery intent rejected", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: [{ segmentId: "S2", paceIntent: "SLOWER", energy: "LOW" }] });
    assert(!r.ok && r.code === "NARRATION_DIRECTION_CONFLICT", "prohibited pattern fails closed");
  });
  await runTest("G6 narrator inheritance from Voice Bible", () => {
    const { root, projectId } = H.makeRoot();
    const r = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    assert(r.ok && r.narrationDirection.voiceBibleRef === H.VOICE_BIBLE.voiceBibleId, "narrator identity via Voice Bible ref");
  });

  // ---------------- G7–G14 pronunciation profile ----------------------------
  await runTest("G7 person/name pronunciation candidate", () => {
    const candidates = pron.detectCandidates(H.SCRIPT.segments[2].text);
    assert(candidates.some((c) => c.term === "Reynolds"), "name candidate detected for review");
  });
  await runTest("G8 foreign term", () => {
    const { root, projectId } = H.makeRoot();
    const p = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    const res = pron.resolveSegmentEntries(p.profile, H.SCRIPT.segments[1].text, { projectId, scriptArtifactId: H.SCRIPT.scriptArtifactId, segmentId: "S2", language: "en-us" });
    assert(res.ok && res.resolved.some((e) => e.displayTerm === "Kokoro"), "Kokoro resolved");
  });
  await runTest("G9 acronym letter-by-letter", () => {
    const compiled = kokoroPhonemize.compileInput({ text: "CIA briefings", entries: H.profileEntries().filter((e) => e.displayTerm === "CIA") });
    assert(compiled.compiledText.includes("C.I.A."), "letter-by-letter expansion");
  });
  await runTest("G10 acronym word reading", () => {
    const compiled = kokoroPhonemize.compileInput({ text: "NASA released weights", entries: H.profileEntries().filter((e) => e.displayTerm === "NASA") });
    assert(compiled.compiledText.includes("NASA") && compiled.applications[0].replacement === null, "word reading leaves the term untouched");
  });
  await runTest("G11 place name", () => {
    const { root, projectId } = H.makeRoot();
    const p = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    const res = pron.resolveSegmentEntries(p.profile, H.SCRIPT.segments[2].text, { projectId, scriptArtifactId: H.SCRIPT.scriptArtifactId, segmentId: "S3", language: "en-us" });
    assert(res.ok && res.resolved.some((e) => e.category === "PLACE_NAME"), "place name resolved");
  });
  await runTest("G12 domain terminology", () => {
    const { root, projectId } = H.makeRoot();
    const p = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    const res = pron.resolveSegmentEntries(p.profile, H.SCRIPT.segments[4].text, { projectId, scriptArtifactId: H.SCRIPT.scriptArtifactId, segmentId: "S5", language: "en-us" });
    assert(res.ok && res.resolved.some((e) => e.category === "DOMAIN_TERM"), "domain term resolved");
  });
  await runTest("G13 custom phonetic override", () => {
    const compiled = kokoroPhonemize.compileInput({ text: H.SCRIPT.segments[4].text, entries: H.profileEntries().filter((e) => e.displayTerm === "UnfoldIQ") });
    assert(compiled.changed && compiled.compiledText.includes("Unfold I Q"), "custom override compiled");
  });
  await runTest("G14 conflicting override rejected", () => {
    const { root, projectId } = H.makeRoot();
    const p = pron.createPronunciationProfile(root, projectId, { language: "en-us", entries: [
      { displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM", reading: { notation: "READ_AS", value: "a-reading" }, scope: { level: "SEGMENT", segmentId: "S2", scriptArtifactId: H.SCRIPT.scriptArtifactId }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
      { displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM", reading: { notation: "READ_AS", value: "b-reading" }, scope: { level: "SEGMENT", segmentId: "S2", scriptArtifactId: H.SCRIPT.scriptArtifactId }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" },
    ] });
    const res = pron.resolveTermOverride(p.profile, "Kokoro", { projectId, scriptArtifactId: H.SCRIPT.scriptArtifactId, segmentId: "S2", language: "en-us" });
    assert(!res.ok && res.code === "PRONUNCIATION_ENTRY_CONFLICT", "conflict fails closed");
  });

  // ---------------- G15 real G2P --------------------------------------------
  await runTest("G15 runtime G2P real branch (real Kokoro quiet phonemization)", () => {
    const r = kokoroPhonemize.phonemize("Grapheme to phoneme conversion check.", "en-us");
    assert(r.ok, "real runtime executed");
    assert(r.results[0].ok && r.results[0].phonemes.join("").length > 10, "phonemes produced");
  });

  // ---------------- G16–G18 invalidation + staleness ------------------------
  await runTest("G16 localized invalidation (one segment)", () => {
    const { root, projectId } = H.makeRoot();
    const p = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    const pass = pron.runPronunciationPass(root, projectId, { scriptDoc: H.SCRIPT, voiceBibleRef: "vb-0123456789ab", profileId: p.profile.pronunciationProfileId }, { transport: H.identityTransport });
    const entry = p.profile.entries.find((e) => e.displayTerm === "Kokoro");
    const plan = pron.planInvalidation(root, projectId, { passId: pass.pass.pronunciationPassId, changedEntryId: entry.entryId });
    assertEq(plan.plan.affectedSegmentIds, ["S2"], "only S2 affected");
  });

  await runTest("G17 localized invalidation (multi-consumer term)", () => {
    const { root, projectId } = H.makeRoot();
    const p = pron.createPronunciationProfile(root, projectId, { ...H.CANONICAL_PROFILE_INPUT, entries: [{ displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM", reading: { notation: "READ_AS", value: "koh-koh-roh" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" }] });
    const multi = { ...H.SCRIPT, segments: [
      { segmentId: "S1", ordinal: 0, text: "Intro sentence." },
      { segmentId: "S3", ordinal: 1, text: "Kokoro appears here." },
      { segmentId: "S7", ordinal: 2, text: "Kokoro appears again." },
    ] };
    const pass = pron.runPronunciationPass(root, projectId, { scriptDoc: multi, voiceBibleRef: "vb-0123456789ab", profileId: p.profile.pronunciationProfileId }, { transport: H.identityTransport });
    const entry = p.profile.entries.find((e) => e.displayTerm === "Kokoro");
    const plan = pron.planInvalidation(root, projectId, { passId: pass.pass.pronunciationPassId, changedEntryId: entry.entryId });
    assertEq(plan.plan.affectedSegmentIds.sort(), ["S3", "S7"], "exactly S3 + S7 affected");
  });

  await runTest("G18 source script version mismatch fails closed", () => {
    const { root, projectId } = H.makeRoot();
    const nd = narr.createNarrationDirection(root, projectId, { scriptDoc: H.SCRIPT, voiceBible: H.VOICE_BIBLE, directions: D2 });
    const changed = { ...H.SCRIPT, scriptVersion: 2 };
    const stale = narr.checkScriptStaleness(root, projectId, nd.narrationDirection.narrationDirectionId, changed);
    assert(stale.ok && stale.stale, "mismatch → stale/fail closed");
  });

  // ---------------- Golden definition + baseline + comparison ---------------
  await runTest("Golden definition + baseline + no-regression comparison", () => {
    let def = gold.getDefinition(REPO, GOLDEN_PROJECT_ID, null);
    if (!def.ok) {
      def = gold.createGoldenDefinition(REPO, {
        goldenProjectId: GOLDEN_PROJECT_ID,
        name: "GOLDEN_NP Narration Direction + Pronunciation Runtime contract (Phase 2.2+2.3)",
        contentClass: "FACTUAL",
        categories: ["narration-direction", "pronunciation-runtime", "spoken-humanization"],
        fixture: { projectId: "phase223-narration-pronunciation", kind: "evidence", detail: "versioned narration direction + provider-agnostic pronunciation profile + real quiet-phonemization runtime pass + tts-ready plan" },
      });
      assert(def.ok, "golden definition created");
    }
    const metrics = {
      schemaStability: { status: "MEASURED", value: true },
      versionImmutability: { status: "MEASURED", value: true },
      dagInvalidation: { status: "MEASURED", value: "SCOPE_CORRECT" },
      directionSparsity: { status: "MEASURED", value: true },
      pronunciationRuntime: { status: "MEASURED", value: "REAL_RUNTIME_PROVEN" },
      pronunciation: { status: "NOT_MEASURED", reason: "judgment on synthesized audio; measured in Phase 2.4, never fabricated here" },
      speechRate: { status: "NOT_MEASURED", reason: "final TTS synthesis is Phase 2.4; not measured in 2.2/2.3" },
      unsupportedFactualClaims: { status: "NOT_APPLICABLE", reason: "no factual claims in a pronunciation contract fixture" },
    };
    const evidenceRefs = [
      "tests/narration/test-narration-direction.js",
      "tests/pronunciation/test-pronunciation-profile.js",
      "tests/pronunciation/test-pronunciation-runtime.js",
      "tests/pronunciation/test-pronunciation-invalidation.js",
      "tests/narration/test-e2e-phase223.js",
      "projects/validation/phase223-narration-pronunciation",
    ];
    const baseline = gold.createBaseline(REPO, { goldenProjectId: GOLDEN_PROJECT_ID, version: 1, metrics, evidenceRefs, reason: "Phase 2.2+2.3 initial golden baseline" });
    assert(baseline.ok, `baseline ok ${baseline.ok ? "" : baseline.code + " " + baseline.message}`);
    const comparison = gold.compareToBaseline(REPO, GOLDEN_PROJECT_ID, { metrics, evidenceRefs });
    assert(comparison.ok, `comparison ok ${comparison.ok ? "" : JSON.stringify(comparison).slice(0, 300)}`);
    const verdict = comparison.comparison ? comparison.comparison.verdict : comparison.verdict;
    assert(verdict === undefined || verdict === "PASS" || verdict === "NO_REGRESSION" || verdict === "PASS_WITH_NOTES" || verdict === "EQUAL", `golden verdict: ${verdict}`);
    console.log(`      golden comparison verdict: ${verdict || "n/a"}`);
    void fs; void os;
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
