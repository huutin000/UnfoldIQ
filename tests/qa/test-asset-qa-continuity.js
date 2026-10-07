"use strict";

/**
 * Phase 1G.11 — continuity tests CO1–CO17 (+ MO7–MO12, MO15, N1–N3 layer gates).
 * Project truth is passed in (never hard-coded): the mustard-overshirt host
 * below is a TEST FIXTURE standing in for a Character Bible entry.
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

// Fixture "truth" (stands in for Character/World/Visual Bible + locked refs).
function sources(strictness) {
  return {
    characterBible: { version: "cb-test-1" },
    worldBible: { version: "wb-test-1" },
    visualBible: { version: "vb-test-1" },
    instructionVersion: "iv-test-1",
    continuityStrictness: strictness || "STRICT",
  };
}

function expectation(over = {}) {
  return {
    characterId: "HOST_A",
    hair: "short black hair",
    clothing: "mustard-yellow overshirt, dark trousers",
    location: "studio-day",
    requiredProps: ["notebook"],
    timeOfDay: "day",
    paletteStyle: "flat-vector-sky",
    startState: "door-closed",
    endState: "door-open",
    ...over,
  };
}

function observation(over = {}) {
  return {
    source: "MANUAL_REVIEW",
    identity: "HOST_A",
    hair: "short black hair",
    clothing: "mustard-yellow overshirt, dark trousers",
    location: "studio-day",
    propsPresent: ["notebook"],
    timeOfDay: "day",
    paletteStyle: "flat-vector-sky",
    startState: "door-closed",
    endState: "door-open",
    confidence: "high",
    ...over,
  };
}

function motionObs(over = {}) {
  return qa.buildMotionObservation({
    observedMotion: { source: "STATE_COMPARISON", confidence: "high", ...over },
  });
}

async function main() {
  await runTest("CO1 same identity PASS", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation() });
    assert(r.status === "PASS", "matching continuity PASSes");
  });

  await runTest("CO2/N1 wrong character FAIL", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation({ identity: "HOST_B" }) });
    assert(r.checks.find((c) => c.check === "faceIdentity").status === "FAIL", "WRONG_CHARACTER FAILs");
    assert(r.reasons.some((x) => /WRONG_CHARACTER/.test(x)), "WRONG_CHARACTER reason recorded");
  });

  await runTest("CO3 face mutation FAIL", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation({ identity: "HOST_A-mutated-face" }) });
    assert(r.checks.find((c) => c.check === "faceIdentity").status === "FAIL", "mutated face FAILs");
  });

  await runTest("CO4 hair mutation FAIL", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation({ hair: "long blond hair" }) });
    assert(r.checks.find((c) => c.check === "hair").status === "FAIL", "hair mutation FAILs");
  });

  await runTest("CO5/N2 unapproved outfit FAIL", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation({ clothing: "red jacket, jeans" }) });
    assert(r.checks.find((c) => c.check === "clothing").status === "FAIL", "unapproved outfit FAILs");
  });

  await runTest("CO6 approved outfit change PASS", () => {
    const r = qa.evaluateContinuity({
      sources: sources(),
      expectation: expectation({ approvedOutfitChange: "red jacket, jeans" }),
      observation: observation({ clothing: "red jacket, jeans" }),
    });
    assert(r.checks.find((c) => c.check === "clothing").status === "PASS", "approved outfit change PASSes");
  });

  await runTest("CO7/N3 wrong location FAIL", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation({ location: "beach-night" }) });
    assert(r.checks.find((c) => c.check === "location").status === "FAIL", "WRONG_LOCATION FAILs");
  });

  await runTest("CO8 intended location transition PASS", () => {
    const r = qa.evaluateContinuity({
      sources: sources(),
      expectation: expectation({ sceneTransitionTo: "beach-night" }),
      observation: observation({ location: "beach-night" }),
    });
    assert(r.checks.find((c) => c.check === "location").status === "PASS", "declared transition PASSes");
  });

  await runTest("CO9 required prop disappears FAIL", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation({ propsPresent: [] }) });
    assert(r.checks.find((c) => c.check === "props").status === "FAIL", "missing locked notebook FAILs");
  });

  await runTest("CO10 irrelevant background variation non-blocker", () => {
    const r = qa.evaluateContinuity({
      sources: sources(),
      expectation: expectation({ requiredProps: [] }),
      observation: observation({ propsPresent: ["other-chair"] }),
    });
    assert(!r.checks.some((c) => c.status === "FAIL"), "irrelevant prop variation does not FAIL");
  });

  await runTest("CO11 unexpected time-of-day shift FAIL", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation({ timeOfDay: "night" }) });
    assert(r.checks.find((c) => c.check === "timeOfDay").status === "FAIL", "day→night without transition FAILs");
  });

  await runTest("CO12 explicit time jump PASS", () => {
    const r = qa.evaluateContinuity({
      sources: sources(),
      expectation: expectation({ timeJumpDeclared: true }),
      observation: observation({ timeOfDay: "night" }),
    });
    assert(r.checks.find((c) => c.check === "timeOfDay").status === "PASS", "declared time jump PASSes");
  });

  await runTest("CO13 style mutation WARN (non-blocking)", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation({ paletteStyle: "noir-live-action" }) });
    const c = r.checks.find((x) => x.check === "paletteStyle");
    assert(c.status === "WARN" && c.severity === "WARNING" && c.blocking === false, "style mutation is WARN-level, non-blocking");
  });

  await runTest("CO14 aspect reframe not style failure", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation({ reframedOnly: true, paletteStyle: "flat-vector-sky" }) });
    assert(r.checks.find((c) => c.check === "paletteStyle").status === "PASS", "reframe alone PASSes");
  });

  await runTest("CO15 wrong start state FAIL", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation({ startState: "door-open" }) });
    assert(r.checks.find((c) => c.check === "startState").status === "FAIL", "wrong start state FAILs");
  });

  await runTest("CO16 wrong end state FAIL", () => {
    const r = qa.evaluateContinuity({ sources: sources(), expectation: expectation(), observation: observation({ endState: "door-closed" }) });
    assert(r.checks.find((c) => c.check === "endState").status === "FAIL", "wrong end state FAILs");
  });

  await runTest("CO17/MO4 motion discontinuity FAIL when continuity-required", () => {
    const r = qa.evaluateContinuity({
      sources: sources(),
      expectation: expectation({ expectedMotion: { actionOccurs: true, direction: "left-to-right" } }),
      observation: observation({ motionObservation: motionObs({ actionCompleted: true, movementDirection: "right-to-left" }) }),
    });
    assert(r.status === "FAIL", "reversed continuity-required direction FAILs");
  });

  await runTest("MO7 object trajectory continuity preserved PASS", () => {
    const r = qa.evaluateContinuity({
      sources: sources(),
      expectation: expectation({ expectedMotion: { trajectory: "exits-right" } }),
      observation: observation({ motionObservation: motionObs({ objectTrajectory: "exits-right" }) }),
    });
    assert(r.checks.some((c) => c.check === "motion:motion-trajectory" && c.status === "PASS"), "preserved trajectory PASSes");
  });

  await runTest("MO8 object trajectory discontinuity FAIL", () => {
    const r = qa.evaluateContinuity({
      sources: sources(),
      expectation: expectation({ expectedMotion: { trajectory: "exits-right" } }),
      observation: observation({ motionObservation: motionObs({ objectTrajectory: "exits-left" }) }),
    });
    assert(r.status === "FAIL", "broken trajectory FAILs");
  });

  await runTest("MO9/MO11 locked start/end match opening/ending PASS", () => {
    const r = qa.evaluateContinuity({
      sources: sources(),
      expectation: expectation({ expectedMotion: { openingState: "door-closed", endingState: "door-open" } }),
      observation: observation({ motionObservation: motionObs({ openingState: "door-closed", endingState: "door-open" }) }),
    });
    assert(r.checks.some((c) => c.check === "motion:motion-start-end" && c.status === "PASS"), "matched start/end PASSes");
  });

  await runTest("MO10 wrong opening state FAIL", () => {
    const r = qa.evaluateContinuity({
      sources: sources(),
      expectation: expectation({ expectedMotion: { openingState: "door-closed" } }),
      observation: observation({ motionObservation: motionObs({ openingState: "window-open" }) }),
    });
    assert(r.status === "FAIL", "wrong opening state FAILs");
  });

  await runTest("MO12 wrong ending state FAIL", () => {
    const r = qa.evaluateContinuity({
      sources: sources(),
      expectation: expectation({ expectedMotion: { endingState: "door-open" } }),
      observation: observation({ motionObservation: motionObs({ endingState: "door-closed" }) }),
    });
    assert(r.status === "FAIL", "wrong ending state FAILs");
  });

  await runTest("MO15 explicit story-directed motion change does not false-fail", () => {
    const r = qa.evaluateContinuity({
      sources: sources(),
      expectation: expectation({ expectedMotion: { actionOccurs: true, direction: "left-to-right" } }),
      observation: observation({ storyDirectedMotionChange: true }),
    });
    assert(r.checks.find((c) => c.check === "motionContinuity").status === "PASS", "story-directed change PASSes");
  });

  await runTest("reference supplied != continuity PASS (locked ref without observation)", () => {
    const r = qa.evaluateContinuity({ sources: { ...sources(), lockedReferences: ["ref-1"] }, expectation: expectation(), observation: null });
    assert(r.status === "UNKNOWN", "locked reference alone cannot PASS continuity");
  });

  console.log(`\n=== DONE: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
});
