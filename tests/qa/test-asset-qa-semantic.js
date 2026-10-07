"use strict";

/**
 * Phase 1G.11 — semantic QA tests SE1–SE10 (+ MO1–MO6, MO14, MO16).
 * Deterministic structured observations; no vision claimed without evidence.
 */

const qa = require("../../lib/asset-qa/index.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

async function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    await fn();
    console.log(`[PASS] ${name}`);
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
  }
}

function baseExpectation(over = {}) {
  return {
    sceneId: "S01",
    shotId: "S01-SH01",
    expectedSubject: ["host"],
    expectedAction: ["walks left-to-right"],
    expectedEnvironment: ["studio"],
    expectedMediaType: "video",
    textPolicy: { allowText: false },
    ...over,
  };
}

function baseObservation(over = {}) {
  return {
    source: "MANUAL_REVIEW",
    sceneId: "S01",
    subjects: ["host"],
    actions: ["walks left-to-right"],
    environment: "studio",
    mediaType: "video",
    hasText: false,
    compositionUsable: true,
    confidence: "high",
    ...over,
  };
}

function motionObs(over = {}) {
  return qa.buildMotionObservation({
    assetId: "as-test",
    shotId: "S01-SH01",
    expectedMotion: null,
    observedMotion: { source: "MANUAL_REVIEW", confidence: "high", ...over },
  });
}

async function main() {
  await runTest("SE1 correct scene PASS", () => {
    const r = qa.evaluateSemantic(baseExpectation(), baseObservation());
    assert(r.status === "PASS", "matching scene/subject/action PASS");
  });

  await runTest("SE2 wrong scene FAIL", () => {
    const r = qa.evaluateSemantic(baseExpectation(), baseObservation({ sceneId: "S02" }));
    assert(r.status === "FAIL", "wrong scene FAILs");
    assert(r.checks.find((c) => c.check === "scene").status === "FAIL", "scene check FAIL");
  });

  await runTest("SE3 correct subject/action PASS", () => {
    const r = qa.evaluateSemantic(baseExpectation(), baseObservation());
    assert(r.checks.find((c) => c.check === "subject").status === "PASS", "subject PASS");
    assert(r.checks.find((c) => c.check === "action").status === "PASS", "action PASS");
  });

  await runTest("SE4 wrong subject FAIL", () => {
    const r = qa.evaluateSemantic(baseExpectation(), baseObservation({ subjects: ["stranger"] }));
    assert(r.checks.find((c) => c.check === "subject").status === "FAIL", "wrong subject FAILs");
  });

  await runTest("SE5 wrong action FAIL", () => {
    const r = qa.evaluateSemantic(baseExpectation(), baseObservation({ actions: ["sits still"] }));
    assert(r.checks.find((c) => c.check === "action").status === "FAIL", "wrong action FAILs");
  });

  await runTest("SE6 accidental text detected", () => {
    const r = qa.evaluateSemantic(baseExpectation(), baseObservation({ hasText: true, textRegions: ["random watermark"] }));
    assert(r.checks.find((c) => c.check === "text").status === "FAIL", "accidental watermark FAILs");
  });

  await runTest("SE7 expected typography not false-failed", () => {
    const r = qa.evaluateSemantic(
      baseExpectation({ textPolicy: { allowText: true, modality: "TYPOGRAPHY" } }),
      baseObservation({ hasText: true, textRegions: ["title card"] })
    );
    assert(r.checks.find((c) => c.check === "text").status === "PASS", "intentional typography PASSes");
  });

  await runTest("SE8 unusable composition FAIL", () => {
    const r = qa.evaluateSemantic(baseExpectation(), baseObservation({ compositionUsable: false }));
    assert(r.checks.find((c) => c.check === "composition").status === "FAIL", "cropped key action FAILs");
  });

  await runTest("SE9 expected media type mismatch FAIL", () => {
    const r = qa.evaluateSemantic(baseExpectation(), baseObservation({ mediaType: "image" }));
    assert(r.checks.find((c) => c.check === "media-type").status === "FAIL", "VIDEO expected but image observed FAILs");
  });

  await runTest("SE10 platform reframe not identity failure", () => {
    const r = qa.evaluateSemantic(baseExpectation(), baseObservation({ reframedOnly: true, compositionUsable: true }));
    assert(r.status === "PASS", "pure reframe keeps semantic PASS");
  });

  await runTest("MO1 expected motion occurs PASS", () => {
    const r = qa.evaluateSemantic(
      baseExpectation({ expectedMotion: { actionOccurs: true } }),
      baseObservation({ motionObservation: motionObs({ actionCompleted: true }) })
    );
    assert(r.checks.find((c) => c.check === "motion-occurs").status === "PASS", "observed action PASSes");
  });

  await runTest("MO2 expected motion absent FAIL", () => {
    const r = qa.evaluateSemantic(
      baseExpectation({ expectedMotion: { actionOccurs: true } }),
      baseObservation({ motionObservation: motionObs({ actionCompleted: false }) })
    );
    assert(r.checks.find((c) => c.check === "motion-occurs").status === "FAIL", "absent action FAILs");
    assert(r.status === "FAIL", "layer FAILs");
  });

  await runTest("MO3 movement direction matches intent PASS", () => {
    const r = qa.evaluateSemantic(
      baseExpectation({ expectedMotion: { actionOccurs: true, direction: "left-to-right" } }),
      baseObservation({ motionObservation: motionObs({ actionCompleted: true, movementDirection: "left-to-right" }) })
    );
    assert(r.checks.find((c) => c.check === "motion-direction").status === "PASS", "direction match PASSes");
  });

  await runTest("MO4 reversed required movement direction FAIL", () => {
    const r = qa.evaluateSemantic(
      baseExpectation({ expectedMotion: { actionOccurs: true, direction: "left-to-right" } }),
      baseObservation({ motionObservation: motionObs({ actionCompleted: true, movementDirection: "right-to-left" }) })
    );
    assert(r.checks.find((c) => c.check === "motion-direction").status === "FAIL", "reversed direction FAILs");
  });

  await runTest("MO5 required gesture completes PASS", () => {
    const r = qa.evaluateSemantic(
      baseExpectation({ expectedMotion: { gestureCompletes: true } }),
      baseObservation({ motionObservation: motionObs({ gestureState: "complete" }) })
    );
    assert(r.checks.find((c) => c.check === "motion-completion").status === "PASS", "completed gesture PASSes");
  });

  await runTest("MO6 incomplete/contradictory action FAIL", () => {
    const r = qa.evaluateSemantic(
      baseExpectation({ expectedMotion: { gestureCompletes: true } }),
      baseObservation({ motionObservation: motionObs({ gestureState: "contradictory" }) })
    );
    assert(r.checks.find((c) => c.check === "motion-completion").status === "FAIL", "contradictory gesture FAILs");
  });

  await runTest("MO14 unavailable motion observation UNKNOWN never PASS", () => {
    const r = qa.evaluateSemantic(
      baseExpectation({ expectedMotion: { actionOccurs: true, direction: "left-to-right" } }),
      baseObservation({ motionObservation: null })
    );
    assert(r.checks.find((c) => c.check === "motion-occurs").status === "UNKNOWN", "unobservable motion is UNKNOWN");
    assert(r.status !== "PASS", "UNKNOWN never collapses into PASS");
  });

  await runTest("MO16 standalone asset QA does not score editing rhythm", () => {
    const r = qa.evaluateSemantic(baseExpectation({ expectedMotion: { actionOccurs: true } }), baseObservation({ motionObservation: motionObs({ actionCompleted: true }) }));
    const names = r.checks.map((c) => c.check).join("|").toLowerCase();
    assert(!/rhythm|pacing|editing|transition-grammar|cut-motivation/.test(names), "no Phase-3 editing-grammar checks in 1G.11");
  });

  await runTest("missing observation → UNKNOWN not PASS", () => {
    const r = qa.evaluateSemantic(baseExpectation(), null);
    assert(r.status === "UNKNOWN", "no observation is UNKNOWN");
    assert(r.blocking === true, "critical UNKNOWN blocks");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
