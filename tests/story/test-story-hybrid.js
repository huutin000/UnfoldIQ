"use strict";

/**
 * HYBRID route tests H1-H6 (Prompt 04, §36).
 * 1 fact + 1 folklore + 1 testimony + 1 speculation + 1 fictionalized beat.
 */

const nbLib = require("../../lib/research-story/narrative-brief.js");
const packLib = require("../../lib/research-story/research-pack.js");
const gateLib = require("../../lib/research-story/script-evidence-gate.js");
const draftLib = require("../../lib/research-story/story-draft.js");
const auditLib = require("../../lib/research-story/story-audit.js");
const fx = require("../fixtures/story-fixtures.js");

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

function pipeline() {
  const s = fx.hybridState();
  const pack = packLib.buildPack({
    projectId: "story-hybrid", plan: s.plan, ledger: s.ledger, records: s.index.sources,
    contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
    hybridLabels: s.hybridLabels,
  }).pack;
  const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
  const brief = nbLib.buildNarrativeBrief({
    contentClass: "HYBRID", contentMode: "urban-legend-documentary", pack, policy,
    brief: { audience: "general", platform: "youtube" },
    angle: "What the records say versus what the village remembers.",
    coreViewerQuestion: "What really happened at the villa?",
    mainInsight: "Records and memory tell different stories.",
    payoff: "The villa stands; the truth stays layered.",
    planQuestions: ["What is documented about the villa?"],
    hookBasis: { type: "folklore mystery" },
    fictionalizationBoundary: s.boundary,
  }).brief;
  return { s, pack, policy, brief };
}

function labelOf(s, want) {
  const c = s.ledger.claims.find((x) => s.hybridLabels[x.claimId] === want);
  return c.claimId;
}

async function main() {
  console.log("=== HYBRID TESTS (H1-H6) ===\n");

  await runTest("H1 FACT remains FACT", async () => {
    const { s, pack } = pipeline();
    const fact = pack.verifiedFacts.concat(pack.derivedContext).find((e) => e.classification === "FACT");
    assert(!!fact, "documented fact present with FACT label");
    assert(fact.statement.includes("1922"), "factual content intact, no promotion needed");
  });

  await runTest("H2 FOLKLORE not promoted", async () => {
    const { s, pack, policy, brief } = pipeline();
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy }).draft;
    const folkId = labelOf(s, "FOLKLORE");
    const folkSecs = gen.sections.filter((x) => x.claimRefs.includes(folkId));
    assert(folkSecs.length > 0, "folklore section rendered");
    for (const sec of folkSecs) {
      assert(!/is proven|confirmed|documented fact|really happened/i.test(sec.draftText), `no fact-promotion in ${sec.sectionId}`);
    }
    const audit = auditLib.auditStoryDraft(gen, { pack, policy });
    assert(!audit.issues.some((i) => i.code === "CLASSIFICATION_VIOLATION"), "classification intact");
  });

  await runTest("H3 TESTIMONY attributed", async () => {
    const { s, pack, policy, brief } = pipeline();
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy }).draft;
    const testId = labelOf(s, "TESTIMONY");
    const secs = gen.sections.filter((x) => x.claimRefs.includes(testId));
    assert(secs.length > 0, "testimony rendered");
    assert(secs.every((x) => /According to/i.test(x.draftText)), "witness attribution present, never bare verified fact");
  });

  await runTest("H4 SPECULATION qualified", async () => {
    const { s, pack, policy, brief } = pipeline();
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy }).draft;
    const specId = labelOf(s, "SPECULATION");
    const secs = gen.sections.filter((x) => x.claimRefs.includes(specId));
    assert(secs.length > 0, "speculation rendered");
    assert(secs.every((x) => /suggests|may|might|possibly|uncertain/i.test(x.draftText)), "qualified wording, never certainty");
  });

  await runTest("H5 FICTIONALIZED_ELEMENT boundary preserved", async () => {
    const { s, pack, policy, brief } = pipeline();
    const beatId = labelOf(s, "FICTIONALIZED_ELEMENT");
    const use = gateLib.usageFor(policy, beatId);
    assert(use.verdict === "forbid", "fictional beat forbidden as documented fact");
    assert(brief.fictionalizationBoundary && brief.fictionalizationBoundary.mayFictionalize.includes("doorway beat"), "boundary explicit in brief");
  });

  await runTest("H6 factual section still traceable", async () => {
    const { s, pack, policy, brief } = pipeline();
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy }).draft;
    const factId = labelOf(s, "FACT");
    const audit = auditLib.auditStoryDraft(gen, { pack, policy });
    assert(audit.state !== "BLOCKED", `no blocking violation (${audit.state})`);
    const factSecs = gen.sections.filter((x) => x.claimRefs.includes(factId));
    assert(factSecs.length > 0 && factSecs.every((x) => (x.classificationRefs.find((c) => c.claimId === factId) || {}).classification === "FACT"), "FACT classification carried per section");
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
