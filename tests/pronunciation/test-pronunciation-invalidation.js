"use strict";

/**
 * Phase 2.3 tests — Localized invalidation / dirty propagation (T23, T24,
 * G16, G17 + DAG scoping T26-partial). Isolated tmp roots; identity transport.
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const pron = require(path.join(REPO, "lib", "pronunciation", "index.js"));
const dagLib = require(path.join(REPO, "lib", "dependency-dag", "index.js"));
const H = require(path.join(REPO, "tests", "fixtures", "phase223", "helpers.js"));

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

/** Multi-consumer script: "Kokoro" appears in S3 and S7 only. */
const MULTI_SCRIPT = {
  ...H.SCRIPT,
  segments: [
    { segmentId: "S1", ordinal: 0, text: "Voice AI moved fast." },
    { segmentId: "S2", ordinal: 1, text: "Nothing else changed here." },
    { segmentId: "S3", ordinal: 2, text: "Kokoro is the first piece." },
    { segmentId: "S4", ordinal: 3, text: "Still nothing here." },
    { segmentId: "S7", ordinal: 4, text: "But Kokoro came back later." },
  ],
};

async function main() {
  await runTest("T23+G16 one-term fix produces a localized invalidation plan", () => {
    const { root, projectId } = H.makeRoot();
    const profile = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    const pass = pron.runPronunciationPass(root, projectId, { scriptDoc: H.SCRIPT, voiceBibleRef: "vb-0123456789ab", profileId: profile.profile.pronunciationProfileId }, { transport: H.identityTransport });
    assert(pass.ok, "pass ok");
    const kokoroEntry = profile.profile.entries.find((e) => e.displayTerm === "Kokoro");
    const plan = pron.planInvalidation(root, projectId, { passId: pass.pass.pronunciationPassId, changedEntryId: kokoroEntry.entryId, reason: "operator corrected reading" });
    assert(plan.ok, "plan ok");
    assertEq(plan.plan.affectedSegmentIds, ["S2"], "exactly the consuming segment affected");
    assertEq(plan.plan.unaffectedSegmentIds.sort(), ["S1", "S3", "S4", "S5", "S6"], "all others unaffected");
    assertEq(plan.plan.futureDownstreamTarget, "VOICE", "future downstream target is the VOICE/TTS layer (no fabricated audio nodes)");
    assert(plan.plan.invalidationPlanId.startsWith("pinv-") || plan.plan.invalidationPlanId.length > 0, "machine-readable plan id");
    assert(plan.plan.fingerprint && plan.plan.fingerprint.length === 16, "plan fingerprinted");
  });

  await runTest("T24+G17 multi-consumer term invalidates exactly its consumers", () => {
    const { root, projectId } = H.makeRoot();
    const profile = pron.createPronunciationProfile(root, projectId, { ...H.CANONICAL_PROFILE_INPUT, entries: [{ displayTerm: "Kokoro", language: "en-us", category: "FOREIGN_TERM", reading: { notation: "READ_AS", value: "koh-koh-roh" }, scope: { level: "GLOBAL_LANGUAGE" }, source: "OPERATOR_OVERRIDE", quality: "VERIFIED" }] });
    const pass = pron.runPronunciationPass(root, projectId, { scriptDoc: MULTI_SCRIPT, voiceBibleRef: "vb-0123456789ab", profileId: profile.profile.pronunciationProfileId }, { transport: H.identityTransport });
    assert(pass.ok, "pass ok");
    const kokoroEntry = profile.profile.entries.find((e) => e.displayTerm === "Kokoro");
    const plan = pron.planInvalidation(root, projectId, { passId: pass.pass.pronunciationPassId, changedEntryId: kokoroEntry.entryId });
    assert(plan.ok, "plan ok");
    assertEq(plan.plan.affectedSegmentIds.sort(), ["S3", "S7"], "S3 + S7 affected, nothing else");
    assertEq(plan.plan.unaffectedSegmentIds.sort(), ["S1", "S2", "S4"], "S1/S2/S4 stay CLEAN/unaffected");
  });

  await runTest("Changed-entry unknown or pass-less change fails closed", () => {
    const { root, projectId } = H.makeRoot();
    const profile = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    const pass = pron.runPronunciationPass(root, projectId, { scriptDoc: H.SCRIPT, voiceBibleRef: "vb-0123456789ab", profileId: profile.profile.pronunciationProfileId }, { transport: H.identityTransport });
    const bad = pron.planInvalidation(root, projectId, { passId: pass.pass.pronunciationPassId, changedEntryId: "pe-000000000000" });
    assert(!bad.ok && bad.code === "PRONUNCIATION_CHANGED_ENTRY_UNKNOWN", "unknown entry structured");
    const missing = pron.planInvalidation(root, projectId, { passId: "prp-000000000000", changedEntryId: profile.profile.entries[0].entryId });
    assert(!missing.ok && missing.code === "PRONUNCIATION_PASS_NOT_FOUND", "missing pass structured");
  });

  await runTest("T26(partial) DAG dirty propagation is scoped: profile change dirties only its pass", () => {
    const { root, projectId } = H.makeRoot();
    const profile = pron.createPronunciationProfile(root, projectId, H.CANONICAL_PROFILE_INPUT);
    const pass = pron.runPronunciationPass(root, projectId, { scriptDoc: H.SCRIPT, voiceBibleRef: "vb-0123456789ab", profileId: profile.profile.pronunciationProfileId }, { transport: H.identityTransport });
    const created = dagLib.createDag(root, projectId);
    assert(created.ok, "dag created");
    const scriptNode = dagLib.addNode(root, projectId, { artifactKey: "FINAL_SPOKEN_SCRIPT", artifactType: "FINAL_SPOKEN_SCRIPT", versionRef: "fss@1", state: "CLEAN", provenance: "LIVE", inputRefs: [] });
    assert(scriptNode.ok, "script node");
    const reg = pron.registerDagNodes(root, projectId, { profileId: profile.profile.pronunciationProfileId, passId: pass.pass.pronunciationPassId });
    assert(reg.ok && reg.added.includes("PRONUNCIATION_PROFILE") && reg.added.includes("PRONUNCIATION_RUNTIME_PASS"), "both nodes registered");
    const mark = dagLib.markDirty(root, projectId, "PRONUNCIATION_PROFILE", { reason: "reading changed" });
    assert(mark.ok, "markDirty ok");
    const dag = dagLib.loadDag(root, projectId).dag;
    assertEq(dag.nodes.PRONUNCIATION_RUNTIME_PASS.state, "DIRTY", "consuming pass DIRTY");
    assertEq(dag.nodes.FINAL_SPOKEN_SCRIPT.state, "CLEAN", "script node untouched");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
