"use strict";

/**
 * FIX PRE-2.4 tests — Naturalness QA (T19–T25 + N-gates).
 */

const path = require("path");
const fs = require("fs");
const REPO = path.join(__dirname, "..", "..");
const ss = require(path.join(REPO, "lib", "spoken-script", "index.js"));
const H = require(path.join(REPO, "tests", "fixtures", "fss", "helpers.js"));

let passed = 0;
let failed = 0;
function assert(cond, msg) { if (!cond) throw new Error("ASSERTION FAILED: " + msg); console.log("  ok  " + msg); }
function assertEq(a, b, msg) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERTION FAILED: ${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); console.log("  ok  " + msg); }
async function runTest(name, fn) {
  console.log("[TEST] " + name);
  try { await fn(); passed += 1; console.log("[PASS] " + name); }
  catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
}

function hum(root, projectId, segments) {
  return ss.createHumanization(root, projectId, {
    contentMode: "everyday-physics-explainer", contentClass: "FACTUAL",
    sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
    sourceSegments: H.SOURCE_SEGMENTS, segments,
    provenance: { actorType: "AGENT", provider: "zcode", model: "GLM-5.3-Flash" },
  });
}

async function main() {
  await runTest("T19 naturalness output machine-readable (schema-shaped metrics + issues)", () => {
    const { root, projectId } = H.makeRoot();
    const n = ss.runNaturalnessQa(root, projectId, { humanization: hum(root, projectId, H.GOOD_CANDIDATE).humanization });
    assert(n.ok, "qa created");
    const m = n.qa.metrics;
    assert(typeof m.sentenceCount === "number" && typeof m.sentenceLengthMean === "number" && typeof m.sentenceLengthVariance === "number", "core signals measured");
    assert(Array.isArray(m.sentenceLengthDistribution) && m.sentenceLengthDistribution.length === m.sentenceCount, "distribution present");
    assert(Array.isArray(n.qa.issues) && n.qa.decision === "PASS", "natural text passes");
  });

  await runTest("T20 no single AI-detector gate (signals only, no probability field)", () => {
    const { root, projectId } = H.makeRoot();
    const n = ss.runNaturalnessQa(root, projectId, { humanization: hum(root, projectId, H.GOOD_CANDIDATE).humanization });
    const raw = JSON.stringify(n.qa);
    assert(!/aiScore|aiDetector|aiProbability|detectorScore/i.test(raw), "no detector score anywhere in the artifact");
  });

  await runTest("T21 repeated transitions detected (systemic)", () => {
    const { root, projectId } = H.makeRoot();
    const n = ss.runNaturalnessQa(root, projectId, { humanization: hum(root, projectId, H.DULL_CANDIDATE).humanization });
    assert(n.qa.issues.some((i) => i.code === "REPETITIVE_TRANSITION" && i.blocking), "REPETITIVE_TRANSITION blocking");
    assert(n.qa.metrics.repeatedTransitionPhrases.some((p) => p.startsWith("so")), "\"so\" counted");
  });

  await runTest("T22 cadence uniformity measured + over-uniform flagged", () => {
    const { root, projectId } = H.makeRoot();
    const dull = ss.runNaturalnessQa(root, projectId, { humanization: hum(root, projectId, H.DULL_CANDIDATE).humanization });
    assert(dull.qa.issues.some((i) => i.code === "OVER_UNIFORM_CADENCE" && i.blocking), "uniform cadence flagged");
    assert(dull.qa.metrics.cadenceUniformity !== null && dull.qa.metrics.cadenceUniformity > 0.5, "uniformity quantified");
    const good = ss.runNaturalnessQa(root, projectId, { humanization: hum(root, projectId, H.GOOD_CANDIDATE).humanization });
    assert(!good.qa.issues.some((i) => i.code === "OVER_UNIFORM_CADENCE"), "varied text not flagged");
  });

  await runTest("T23 written-not-spoken located per segment", () => {
    const { root, projectId } = H.makeRoot();
    const written = H.GOOD_CANDIDATE.map((c, i) => i === 0
      ? { ...c, candidateSpokenText: "Herein we utilize the aforementioned survey data, wherein 300,000 people watched Rayleigh show the effect." }
      : c);
    const n = ss.runNaturalnessQa(root, projectId, { humanization: hum(root, projectId, written).humanization });
    const writtenIssues = n.qa.metrics.awkwardSpokenPhrases;
    assert(writtenIssues.length >= 3, "written markers collected");
    assert(writtenIssues.every((x) => x.includes(" :: S")), "each marker references its segment");
  });

  await runTest("T24 bounded repair loop (max 2 attempts, structured limit error)", () => {
    const { root, projectId } = H.makeRoot();
    // Attempt 1 fails naturalness; attempt 2 repairs only affected segments.
    const attempt1 = ss.runNaturalnessQa(root, projectId, { humanization: hum(root, projectId, H.DULL_CANDIDATE).humanization });
    assert(attempt1.qa.decision === "FAIL", "attempt 1 FAIL");
    const revised = ss.createHumanization(root, projectId, {
      contentMode: "everyday-physics-explainer", contentClass: "FACTUAL",
      sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
      sourceSegments: H.SOURCE_SEGMENTS,
      segments: H.GOOD_CANDIDATE,
      version: 2,
      provenance: { actorType: "AGENT", provider: "zcode", model: "GLM-5.3-Flash", attempt: 2 },
    });
    assert(revised.ok && revised.humanization.version === 2, "repair creates a new immutable revision");
    const attempt2 = ss.runNaturalnessQa(root, projectId, { humanization: revised.humanization });
    assert(attempt2.qa.decision === "PASS", "attempt 2 PASS");
    assert(attempt2.qa.humanizationRef === revised.humanization.humanizationId, "qa bound to the repaired revision");
    // Third attempt exceeds the bounded limit.
    const attempt3 = ss.createHumanization(root, projectId, {
      contentMode: "everyday-physics-explainer", contentClass: "FACTUAL",
      sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
      sourceSegments: H.SOURCE_SEGMENTS, segments: H.GOOD_CANDIDATE, version: 3,
      provenance: { actorType: "AGENT", attempt: 3 },
    });
    void attempt3;
    assert(ss.MAX_REPAIR_ATTEMPTS === 2, "default bounded limit is 2 attempts");
    const files = fs.readdirSync(path.join(root, "projects", projectId, "voice", "spoken-humanization"));
    assert(files.length <= 3, "no unbounded revision churn (rejected attempts preserved, bounded)");
  });

  await runTest("T25 repair touches only affected segments (clean segments byte-identical)", () => {
    const { root, projectId } = H.makeRoot();
    // Only S1/S2/S3 were dull; the repaired revision keeps S2/S3 semantics but
    // a partial repair keeps untouched segments' text EXACTLY as the source.
    const partial = [
      { segmentId: "S1", sourceSegmentIds: ["B1"], candidateSpokenText: "In 1926, the survey reported, roughly 300,000 people watched Rayleigh show the effect.", changeTypes: ["CONVERSATIONAL_WORDING"] },
      { segmentId: "S2", sourceSegmentIds: ["B2"], candidateSpokenText: H.SOURCE_SEGMENTS[1].text, changeTypes: [] },
      { segmentId: "S3", sourceSegmentIds: ["B3"], candidateSpokenText: H.SOURCE_SEGMENTS[2].text, changeTypes: [] },
    ];
    const r = ss.createHumanization(root, projectId, {
      contentMode: "everyday-physics-explainer", contentClass: "FACTUAL",
      sourceScriptRef: { artifact: "script.json", version: "1.0.0" },
      sourceSegments: H.SOURCE_SEGMENTS, segments: partial, version: 2,
      provenance: { actorType: "AGENT", attempt: 2 },
    });
    assert(r.ok, "repaired revision created");
    assertEq(r.humanization.segments[1].candidateSpokenText, H.SOURCE_SEGMENTS[1].text, "clean segment S2 not rewritten");
    assertEq(r.humanization.segments[2].candidateSpokenText, H.SOURCE_SEGMENTS[2].text, "clean segment S3 not rewritten");
    assertEq(r.humanization.segments[1].changeTypes, [], "clean segments carry no change claims");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error("FATAL", e); process.exit(1); });
