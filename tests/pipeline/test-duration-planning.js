"use strict";

/**
 * UNFOLDIQ duration planning tests (STEP 10A-FIX): DU1–DU18.
 * Executable, deterministic, TEST-ONLY data. No web/LLM/randomness.
 * No fixture leftovers (all in-memory).
 */

const { resolveDurationContract, estimateScriptBudget } = require("../../lib/duration-planner.js");
const {
  validateDurationContract,
  validateTimeline,
  validateFinalDuration,
  validateVideoSpecDuration,
  checkAiVideoBoundary,
} = require("../../lib/duration-check.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  try {
    fn();
    console.log(`[PASS] ${name}`);
    return true;
  } catch (e) {
    console.log(`[FAIL] ${name}: ${e.message}`);
    failed++;
    return false;
  }
}

function logOut(label, obj) {
  console.log(`  output: ${label} = ${JSON.stringify(obj)}`);
}

function capacity(minMs, maxMs, extra = {}) {
  return {
    status: "SUFFICIENT",
    recommendedMinMs: minMs,
    recommendedMaxMs: maxMs,
    basis: "core claims, causal mechanism, evidence walkthrough, case example, implication",
    coverage: "TEST-ONLY capacity fixture",
    ...extra,
  };
}

console.log("=== DURATION PLANNING TESTS (DU1-DU18) ===\n");

// DU1 — FIT: target 8–12, capacity 9–11.
runTest("DU1 FIT target-capacity overlap", () => {
  const c = resolveDurationContract({
    projectId: "DU1", platform: "youtube", durationMode: "FLEXIBLE_TARGET",
    userTarget: { minMs: 480000, preferredMs: 600000, maxMs: 720000 },
    contentCapacity: capacity(540000, 660000),
  });
  logOut("contract", { status: c.status, working: c.workingDuration });
  assert(c.status === "FIT", "overlapping target/capacity must be FIT");
  assert(c.workingDuration.minMs === 540000 && c.workingDuration.maxMs === 660000, "working range must be the overlap");
  const v = validateDurationContract(c);
  assert(v.valid === true, "FIT contract must validate");
});

// DU2 — content too short: target 8–12, capacity 5–6 → no filler.
runTest("DU2 Content too short → no filler", () => {
  const c = resolveDurationContract({
    projectId: "DU2", platform: "youtube", durationMode: "FLEXIBLE_TARGET",
    userTarget: { minMs: 480000, preferredMs: 600000, maxMs: 720000 },
    contentCapacity: capacity(300000, 390000, { status: "INSUFFICIENT" }),
  });
  logOut("contract", { status: c.status, working: c.workingDuration, resolution: c.resolution });
  assert(c.status === "TARGET_TOO_LONG_FOR_CONTENT", "must flag target-too-long");
  assert(c.workingDuration.maxMs === 390000, "working duration must stay within capacity (shorter final)");
  assert(c.resolution && /shorter|filler/i.test(c.resolution.note), "resolution must document shorter-final, not filler");
  const fakeFit = { ...c, status: "FIT" };
  const v = validateDurationContract(fakeFit);
  assert(v.valid === false && v.errors.some((e) => e.code === "TOO_LONG_UNRESOLVED"), "FIT at requested duration with short content must be rejected");
});

// DU3 — evidence-backed expansion can resolve short capacity.
runTest("DU3 Evidence-backed expansion resolves short capacity", () => {
  const c = resolveDurationContract({
    projectId: "DU3", platform: "youtube", durationMode: "FLEXIBLE_TARGET",
    userTarget: { minMs: 480000, preferredMs: 540000, maxMs: 600000 },
    contentCapacity: capacity(300000, 390000, { status: "INSUFFICIENT", expansionOpportunities: ["adjacent sub-question with evidence"] }),
    allowScopeExpansion: true,
    expandedCapacity: { recommendedMinMs: 420000, recommendedMaxMs: 540000 },
  });
  logOut("contract", { status: c.status, working: c.workingDuration });
  assert(c.status === "FIT", "evidence-backed expansion may restore FIT");
  assert(c.workingDuration.minMs >= 420000, "working range must reflect expanded capacity");
});

// DU4 — content too long: target 8–12, capacity 16–18 → prioritize/split.
runTest("DU4 Content too long → prioritize/split", () => {
  const c = resolveDurationContract({
    projectId: "DU4", platform: "youtube", durationMode: "FLEXIBLE_TARGET",
    userTarget: { minMs: 480000, preferredMs: 600000, maxMs: 720000 },
    contentCapacity: capacity(960000, 1080000, { status: "OVER_CAPACITY", omissionCandidates: ["secondary example → future video"] }),
  });
  logOut("contract", { status: c.status, resolution: c.resolution });
  assert(c.status === "TARGET_TOO_SHORT_FOR_CONTENT", "must flag target-too-short");
  assert(c.resolution && c.resolution.prioritization === true, "resolution must require prioritization");
  const v = validateDurationContract(c);
  assert(v.valid === true, "prioritized/split resolution must validate");
});

// DU5 — AUTO derives working range from capacity.
runTest("DU5 AUTO derives working range", () => {
  const c = resolveDurationContract({
    projectId: "DU5", platform: "tiktok", durationMode: "AUTO",
    contentCapacity: capacity(45000, 60000),
  });
  logOut("contract", { status: c.status, working: c.workingDuration });
  assert(c.status === "FIT", "AUTO with sufficient capacity must be FIT");
  assert(c.workingDuration.minMs === 45000 && c.workingDuration.maxMs === 60000, "AUTO working range must equal capacity range");
  assert(c.workingDuration.derivedFrom === "content-capacity", "AUTO must derive from capacity");
});

// DU6 — approximate 10 min ±10%.
runTest("DU6 Approximate target tolerance", () => {
  const c = resolveDurationContract({
    projectId: "DU6", platform: "youtube", durationMode: "APPROXIMATE_TARGET",
    userTarget: { preferredMs: 600000, tolerancePercent: 10 },
    contentCapacity: capacity(500000, 700000),
  });
  logOut("contract", { status: c.status, working: c.workingDuration });
  assert(c.workingDuration.minMs === 540000 && c.workingDuration.maxMs === 660000, "10% tolerance must yield 540k–660k");
  assert(c.status === "FIT", "approximate overlap must be FIT");
});

// DU7 — invalid min/max rejected.
runTest("DU7 Invalid min/max rejected", () => {
  let code = null;
  try {
    resolveDurationContract({
      projectId: "DU7", platform: "youtube", durationMode: "FLEXIBLE_TARGET",
      userTarget: { minMs: 720000, preferredMs: 600000, maxMs: 480000 },
      contentCapacity: capacity(500000, 700000),
    });
  } catch (e) {
    code = e.message.split(":")[0];
  }
  logOut("planner rejection", code);
  assert(code === "TARGET_ORDER_INVALID", "planner must reject invalid ordering");
  const v = validateDurationContract({
    version: "1.0.0", projectId: "DU7", platform: "youtube", durationMode: "FLEXIBLE_TARGET",
    userTarget: { minMs: 720000, maxMs: 480000 },
    contentCapacity: capacity(500000, 700000),
    workingDuration: { minMs: 500000, preferredMs: 600000, maxMs: 700000, derivedFrom: "x", confidence: "HIGH" },
    scriptBudget: { estimatedWordsMin: 1, estimatedWordsMax: 2, estimatedNarrationMs: 600000, speakingRateAssumption: "140-160 wpm", rateSource: "x", timingStatus: "PLANNED" },
    policy: { allowScopeExpansion: false, fillerForbidden: true },
    status: "FIT",
  });
  assert(v.valid === false && v.errors.some((e) => e.code === "TARGET_ORDER_INVALID"), "validator must reject invalid ordering");
});

// DU8 — negative rejected.
runTest("DU8 Negative duration rejected", () => {
  let code = null;
  try {
    resolveDurationContract({
      projectId: "DU8", platform: "youtube", durationMode: "FLEXIBLE_TARGET",
      userTarget: { minMs: -1000, preferredMs: 600000, maxMs: 720000 },
      contentCapacity: capacity(500000, 700000),
    });
  } catch (e) {
    code = e.message.split(":")[0];
  }
  logOut("planner rejection", code);
  assert(code === "NEGATIVE_DURATION", "planner must reject negatives");
});

// DU9 — target 600000, actual 469000, forced final 600000 → REJECT.
runTest("DU9 Forced final beyond timeline → REJECT", () => {
  const tl = validateTimeline({ items: [{ id: "n1", endMs: 469000, kind: "narration" }] });
  assert(tl.actualTimelineEndMs === 469000, "timeline end must be 469000");
  const v = validateFinalDuration({ finalDurationMs: 600000, actualTimelineEndMs: tl.actualTimelineEndMs });
  logOut("final", { valid: v.valid, codes: v.errors.map((e) => e.code) });
  assert(v.valid === false && v.errors.some((e) => e.code === "FINAL_EXCEEDS_TIMELINE"), "forced padding to target must be rejected");
});

// DU10 — explicit outro/music tail ending 479000 → PASS.
runTest("DU10 Explicit outro/music tail → PASS", () => {
  const tl = validateTimeline({
    items: [
      { id: "n1", endMs: 458000, kind: "narration" },
      { id: "o1", endMs: 474000, kind: "outro", purpose: "closing reflection + CTA", durationMs: 16000 },
      { id: "m1", endMs: 479000, kind: "musicTail", purpose: "intentional music resolution", durationMs: 5000 },
    ],
  });
  logOut("timeline", { valid: tl.valid, actualTimelineEndMs: tl.actualTimelineEndMs });
  assert(tl.valid === true, "explicit purposeful tails must be accepted");
  assert(tl.actualTimelineEndMs === 479000, "timeline end must be 479000");
  const v = validateFinalDuration({ finalDurationMs: 479000, actualTimelineEndMs: tl.actualTimelineEndMs });
  assert(v.valid === true, "final at measured end must PASS");
});

// DU11 — script estimate too short → REVIEW/CONFLICT.
runTest("DU11 Script estimate too short → CONFLICT", () => {
  const v = validateDurationContract({
    version: "1.0.0", projectId: "DU11", platform: "youtube", durationMode: "FLEXIBLE_TARGET",
    userTarget: { minMs: 480000, maxMs: 720000 },
    contentCapacity: capacity(480000, 720000),
    workingDuration: { minMs: 480000, preferredMs: 600000, maxMs: 720000, derivedFrom: "x", confidence: "HIGH" },
    scriptBudget: { estimatedWordsMin: 500, estimatedWordsMax: 600, estimatedNarrationMs: 240000, speakingRateAssumption: "140-160 wpm", rateSource: "x", timingStatus: "PLANNED" },
    policy: { allowScopeExpansion: false, fillerForbidden: true },
    status: "FIT",
  });
  logOut("contract", { valid: v.valid, codes: v.errors.map((e) => e.code) });
  assert(v.valid === false && v.errors.some((e) => e.code === "SCRIPT_ESTIMATE_CONFLICT"), "short estimate must trigger review/conflict");
});

// DU12 — script estimate too long → REVIEW/CONFLICT.
runTest("DU12 Script estimate too long → CONFLICT", () => {
  const v = validateDurationContract({
    version: "1.0.0", projectId: "DU12", platform: "youtube", durationMode: "FLEXIBLE_TARGET",
    userTarget: { minMs: 480000, maxMs: 720000 },
    contentCapacity: capacity(480000, 720000),
    workingDuration: { minMs: 480000, preferredMs: 600000, maxMs: 720000, derivedFrom: "x", confidence: "HIGH" },
    scriptBudget: { estimatedWordsMin: 2000, estimatedWordsMax: 2200, estimatedNarrationMs: 900000, speakingRateAssumption: "140-160 wpm", rateSource: "x", timingStatus: "PLANNED" },
    policy: { allowScopeExpansion: false, fillerForbidden: true },
    status: "FIT",
  });
  assert(v.valid === false && v.errors.some((e) => e.code === "SCRIPT_ESTIMATE_CONFLICT"), "long estimate must trigger review/conflict");
});

// DU13 — render-ready measured timeline → PASS.
runTest("DU13 Render-ready measured source → PASS", () => {
  const v = validateVideoSpecDuration({ durationMs: 479000, durationSource: "MEASURED_TIMELINE", renderReady: true });
  logOut("spec", v);
  assert(v.valid === true, "measured render-ready spec must PASS");
});

// DU14 — render-ready planned-only source → REJECT.
runTest("DU14 Render-ready planned source → REJECT", () => {
  const v = validateVideoSpecDuration({ durationMs: 600000, durationSource: "PLANNED", renderReady: true });
  logOut("spec", { valid: v.valid, codes: v.errors.map((e) => e.code) });
  assert(v.valid === false && v.errors.some((e) => e.code === "RENDER_SOURCE_NOT_MEASURED"), "planned-only render-ready must be rejected");
});

// DU15 — 18s scene with 6s AI video + other visuals → PASS.
runTest("DU15 AI boundary sane mix → PASS", () => {
  const v = checkAiVideoBoundary({ sceneDurationMs: 18000, aiVideoMs: 6000, treatsAiAsTotal: false });
  logOut("boundary", v);
  assert(v.valid === true, "6s AI within 18s scene must PASS");
  const bad = checkAiVideoBoundary({ sceneDurationMs: 18000, aiVideoMs: 18000, treatsAiAsTotal: true });
  assert(bad.valid === false && bad.errors.some((e) => e.code === "AI_DURATION_EQUALS_TOTAL"), "AI-equals-total inference must be rejected");
});

// DU16 — uncertain research cannot claim FIT.
runTest("DU16 Uncertain capacity cannot FIT", () => {
  const c = resolveDurationContract({
    projectId: "DU16", platform: "youtube", durationMode: "FLEXIBLE_TARGET",
    userTarget: { minMs: 480000, maxMs: 720000 },
    contentCapacity: capacity(400000, 600000, { status: "UNCERTAIN" }),
  });
  logOut("contract", { status: c.status });
  assert(c.status === "RESEARCH_INCOMPLETE", "uncertain research must not resolve FIT");
  const v = validateDurationContract({ ...c, status: "FIT" });
  assert(v.valid === false && v.errors.some((e) => e.code === "UNCERTAIN_FIT"), "forced FIT on uncertain capacity must be rejected");
});

// DU17 — shorter-than-target final accepted with documented no-filler resolution.
runTest("DU17 Shorter final with resolution → accepted", () => {
  const v = validateFinalDuration({
    finalDurationMs: 420000,
    actualTimelineEndMs: 420000,
    target: { minMs: 480000, preferredMs: 600000, maxMs: 720000 },
    durationMode: "FLEXIBLE_TARGET",
    resolution: { decision: "shorter-final", note: "No filler: capacity supports 7 minutes of real value." },
  });
  logOut("final", { valid: v.valid, warnings: v.warnings.map((e) => e.code) });
  assert(v.valid === true, "documented shorter final must be accepted");
});

// DU18 — longer-than-target final accepted under FLEXIBLE_TARGET when core value requires it.
runTest("DU18 Longer final with resolution → accepted", () => {
  const v = validateFinalDuration({
    finalDurationMs: 800000,
    actualTimelineEndMs: 800000,
    target: { minMs: 480000, preferredMs: 600000, maxMs: 720000 },
    durationMode: "FLEXIBLE_TARGET",
    resolution: { decision: "core-value-requires", note: "Strongest mechanism + example need 13 minutes; no padding." },
  });
  logOut("final", { valid: v.valid, warnings: v.warnings.map((e) => e.code) });
  assert(v.valid === true, "documented longer final must be accepted under FLEXIBLE_TARGET");
});

// Budget sanity: mode-appropriate rates, planning-only status.
runTest("Budget rates are mode-appropriate", () => {
  const med = estimateScriptBudget({ workingDuration: { minMs: 60000, preferredMs: 60000, maxMs: 60000 } }, "meditation");
  const doc = estimateScriptBudget({ workingDuration: { minMs: 60000, preferredMs: 60000, maxMs: 60000 } }, "documentary");
  logOut("budgets", { meditation: med.estimatedNarrationMs, documentary: doc.estimatedNarrationMs });
  assert(med.estimatedNarrationMs === 60000 && med.timingStatus === "PLANNED", "meditation budget must be planning-only");
  assert(med.estimatedWordsMax < doc.estimatedWordsMax, "slower meditation rate must yield fewer words for the same minute");
});

console.log(`\n=== SUMMARY ===`);
console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
if (failed > 0) {
  console.log("RESULT: SOME TESTS FAILED");
  process.exit(1);
}
console.log("RESULT: ALL TESTS PASSED");
