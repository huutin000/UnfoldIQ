"use strict";

/**
 * FICTION route tests X1-X5 (Prompt 04, §37).
 * Pure fiction needs no pack and no fake refs; targeted facts keep evidence.
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

function fictionBrief(over = {}) {
  const f = fx.fictionState();
  const r = nbLib.buildNarrativeBrief({
    contentClass: "FICTION", contentMode: "horror-fiction",
    brief: f.brief, storyContext: f.storyContext,
    angle: "Dread builds through sound, not spectacle.",
    coreViewerQuestion: "What walks the night corridors?",
    mainInsight: "Fear of the unseen carries the tale.",
    payoff: "Morning comes; the ward keeps its secret.",
    planQuestions: [],
    progressionOverride: [
      { stepId: "hook", purpose: "open on premise", claimIds: [] },
      { stepId: "arrival", purpose: "guard arrives", claimIds: [] },
      { stepId: "payoff", purpose: "closing beat", claimIds: [] },
    ],
    ...over,
  });
  assert(r.ok, `fiction brief builds (${r.code || "ok"})`);
  return r.brief;
}

async function main() {
  console.log("=== FICTION TESTS (X1-X5) ===\n");

  await runTest("X1 pure fiction does not require Research Pack", async () => {
    const need = packLib.packNeeded("FICTION", "NOT_REQUIRED");
    assert(!need.needed, "no pack for fiction");
    const brief = fictionBrief();
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack: null, policy: null });
    assert(gen.ok, "draft generated without pack/policy");
    const audit = auditLib.auditStoryDraft(gen.draft, { pack: null, policy: null });
    assert(audit.state === "PASS", `pure fiction audits PASS (${JSON.stringify(audit.issues)})`);
  });

  await runTest("X2 fictional plot gets no fake claim refs", async () => {
    const brief = fictionBrief();
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack: null, policy: null }).draft;
    const allRefs = gen.sections.flatMap((x) => x.claimRefs);
    assert(allRefs.length === 0, "zero claim refs on invented plot");
    assert(!/\[claim:|\[source:/.test(gen.sections.map((x) => x.draftText).join(" ")), "no citation tokens in fiction text");
  });

  await runTest("X3 targeted factual detail may use evidence refs", async () => {
    const s = fx.factualState();
    const pack = packLib.buildPack({
      projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
      contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
    }).pack;
    const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
    const targetId = pack.verifiedFacts[0].claimId;
    const f = fx.fictionState();
    const r = nbLib.buildNarrativeBrief({
      contentClass: "FICTION", contentMode: "horror-fiction", policy,
      brief: f.brief, storyContext: f.storyContext,
      angle: "Dread builds through sound.", coreViewerQuestion: "What walks?",
      mainInsight: "I.", payoff: "P.",
      targetedFactClaimIds: [targetId],
      progressionOverride: [
        { stepId: "hook", purpose: "open", claimIds: [] },
        { stepId: "detail", purpose: "grounded hospital detail", claimIds: [targetId] },
        { stepId: "payoff", purpose: "close", claimIds: [] },
      ],
    });
    assert(r.ok, "targeted-fact fiction brief builds");
    const gen = draftLib.generateStoryDraft({ narrativeBrief: r.brief, pack, policy }).draft;
    const det = gen.sections.find((x) => x.sectionId === "detail");
    assert(det.claimRefs.includes(targetId), "targeted detail carries its evidence ref");
    const audit = auditLib.auditStoryDraft(gen, { pack, policy });
    assert(audit.state === "PASS", "mixed fiction + targeted fact audits PASS");
  });

  await runTest("X4 unevidenced targeted detail cannot be invented", async () => {
    const f = fx.fictionState();
    const r = nbLib.buildNarrativeBrief({
      contentClass: "FICTION", contentMode: "horror-fiction",
      policy: { allowedClaims: [], restrictedClaims: [], disputedClaims: [], forbiddenAsFact: [], requiredAttributions: [], requiredQualifiers: [], targetedFactClaims: [] },
      brief: f.brief, storyContext: f.storyContext,
      angle: "A.", coreViewerQuestion: "Q?", mainInsight: "I.", payoff: "P.",
      targetedFactClaimIds: ["clm-000000000000"],
    });
    assert(!r.ok && r.code === "EDITORIAL_STRATEGY_INVALID", "targeted fact without evidence standing rejected");
  });

  await runTest("X5 Story Draft still receives Editorial Strategy", async () => {
    const brief = fictionBrief();
    assert(brief.editorialAngle.length > 0 && brief.storytellingConstraints.length > 0, "editorial strategy present");
    assert(brief.storytellingConstraints.some((c) => /1G\.3/.test(c)), "no-humanization constraint recorded");
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack: null, policy: null }).draft;
    assert(gen.sections.length >= 3, "structured beats generated");
    assert(gen.narrativeBriefRef.briefId === brief.briefId, "draft links its brief");
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
