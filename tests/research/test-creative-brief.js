"use strict";

/**
 * V6 Creative Brief compatibility tests CB1-CB10 (Prompt 03 delta).
 * Deterministic. No network.
 */

const planLib = require("../../lib/research-plan.js");
const cb = require("../../lib/research-evidence/creative-brief.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve().then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => { console.log(`[FAIL] ${name}: ${e.message}`); failed++; });
}

function fullBrief() {
  return cb.createBrief({
    channelDefaults: { audience: "channel default audience" },
    platformProfile: { platform: "youtube" },
    overrides: {
      briefId: "cb-full", audience: "beginners", knowledgeLevel: "beginner",
      videoType: "explainer", targetDuration: "60-90s",
      viewerPromise: "grasp 308 quickly", primaryLearningGoal: "understand redirects",
      narratorPersona: "friendly guide", desiredFeeling: "clarity",
      contentDensity: "lean", visualLanguage: "diagrams", ctaGoal: "subscribe",
    },
  }).brief;
}

async function main() {
  console.log("=== CREATIVE BRIEF TESTS (CB1-CB10) ===\n");

  await runTest("CB1 old Prompt-01 project without brief still works", async () => {
    const r = planLib.planResearch({ projectId: "t", topic: "History of Hoi An", contentMode: "historical-documentary", platform: "youtube" });
    assert(r.ok && !("creativeBriefRef" in r.plan), "no brief => no ref key, identical pre-V6 output");
  });

  await runTest("CB2 V6 brief links to Research Plan", async () => {
    const brief = fullBrief();
    const r = planLib.planResearch({ projectId: "t", topic: "HTTP 308 semantics", contentMode: "technical-explainer", creativeBrief: brief });
    assert(r.ok && r.plan.creativeBriefRef.briefId === "cb-full", "plan carries stable brief ref");
    assert(r.plan.creativeBriefRef.briefHash === cb.briefRef(brief).briefHash, "ref hash matches brief content");
  });

  await runTest("CB3 audience preserved", async () => {
    const r = planLib.planResearch({ projectId: "t", topic: "T", contentMode: "tutorial", creativeBrief: fullBrief() });
    assert(r.plan.audience === "beginners", "brief audience fills plan gap");
  });

  await runTest("CB4 knowledge level preserved via linkage", async () => {
    const brief = fullBrief();
    const ctx = cb.researchContextOf(brief);
    assert(ctx.knowledgeLevel === "beginner", "research-relevant subset exposes knowledgeLevel");
    const r = planLib.planResearch({ projectId: "t", topic: "T", contentMode: "tutorial", creativeBrief: brief });
    assert(r.ok && r.plan.creativeBriefRef.briefId === "cb-full", "level retrievable through linked brief, not copied");
  });

  await runTest("CB5 target duration preserved via linkage", async () => {
    const brief = fullBrief();
    assert(cb.researchContextOf(brief).targetDuration === "60-90s", "duration in research context");
  });

  await runTest("CB6/CB7 viewer promise + learning goal preserved", async () => {
    const ctx = cb.researchContextOf(fullBrief());
    assert(ctx.viewerPromise === "grasp 308 quickly", "promise preserved");
    assert(ctx.primaryLearningGoal === "understand redirects", "learning goal preserved");
  });

  await runTest("CB8 content density preserved", async () => {
    assert(cb.researchContextOf(fullBrief()).contentDensity === "lean", "density preserved");
  });

  await runTest("CB9 platform remains canonical", async () => {
    const brief = fullBrief();
    const r = planLib.planResearch({ projectId: "t", topic: "T", contentMode: "tutorial", creativeBrief: brief });
    assert(r.plan.platform === "youtube", "brief platform propagates canonically");
    const explicit = planLib.planResearch({ projectId: "t", topic: "T", contentMode: "tutorial", platform: "tiktok", creativeBrief: brief });
    assert(explicit.plan.platform === "tiktok", "explicit plan input still wins (repo convention)");
    const bad = cb.createBrief({ overrides: { audience: "x", platform: "reels" } });
    assert(!bad.ok && bad.code === "INVALID_BRIEF_PLATFORM", "non-canonical brief platform rejected");
  });

  await runTest("CB10 brief does not alter factual evidence status", async () => {
    const withBrief = planLib.planResearch({ projectId: "t", topic: "T", contentMode: "tutorial", creativeBrief: fullBrief() });
    const without = planLib.planResearch({ projectId: "t", topic: "T", contentMode: "tutorial", platform: "youtube", audience: "beginners" });
    const strip = (p) => ({ ...p, creativeBriefRef: undefined, audience: undefined, platform: undefined });
    assert(JSON.stringify(strip(withBrief.plan)) === JSON.stringify(strip(without.plan)), "same research fields => same plan apart from brief linkage");
    assert(!("evidenceStatus" in withBrief.plan) && !("claims" in withBrief.plan), "plan carries no evidence verdicts");
  });

  await runTest("CB11 layering + invalid brief rejected", async () => {
    const layered = cb.createBrief({
      channelDefaults: { audience: "channel", platform: "tiktok" },
      overrides: { audience: "override-aud" },
    });
    assert(layered.ok && layered.brief.audience === "override-aud" && layered.brief.platform === "tiktok", "override > channel, profile platform kept");
    const noAud = cb.createBrief({ overrides: { platform: "youtube" } });
    assert(!noAud.ok, "missing audience rejected");
    const badPlan = planLib.planResearch({ projectId: "t", topic: "T", contentMode: "tutorial", creativeBrief: { briefId: "x" } });
    assert(!badPlan.ok && badPlan.code === "CREATIVE_BRIEF_INVALID", "invalid brief rejected at plan boundary");
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
