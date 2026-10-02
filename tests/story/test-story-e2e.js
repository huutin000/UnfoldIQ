"use strict";

/**
 * Story-handoff E2E: FACTUAL (§81), HYBRID (§82), FICTION (§83) + persistence.
 * Full chain with traceability. No network.
 */

const os = require("os");
const path = require("path");
const fs = require("fs");
const nbLib = require("../../lib/research-story/narrative-brief.js");
const packLib = require("../../lib/research-story/research-pack.js");
const gateLib = require("../../lib/research-story/script-evidence-gate.js");
const draftLib = require("../../lib/research-story/story-draft.js");
const auditLib = require("../../lib/research-story/story-audit.js");
const storyStore = require("../../lib/research-story/story-store.js");
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

async function main() {
  console.log("=== STORY E2E TESTS ===\n");

  await runTest("E2E-FACTUAL pack -> gate -> brief -> draft -> audit PASS", async () => {
    const s = fx.factualState();
    const pack = packLib.buildPack({
      projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
      contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
    }).pack;
    const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
    const brief = nbLib.buildNarrativeBrief({
      contentClass: "FACTUAL", contentMode: "technical-explainer", pack, policy,
      brief: { audience: "developers", platform: "youtube", viewerPromise: "grasp 308 fast", targetDuration: "60-90s", contentDensity: "balanced" },
      angle: "Method preservation is the whole point of 308.",
      coreViewerQuestion: "Why does 308 exist?",
      mainInsight: "308 removes method-rewrite ambiguity.",
      payoff: "Use 308 when the method must survive.",
      planQuestions: ["Does 308 preserve method?", "Which RFC standardizes 308?"],
      hookBasis: { type: "surprising documented fact" },
    }).brief;
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy, platform: "youtube" });
    assert(gen.ok, "draft generated");
    const audit = auditLib.auditStoryDraft(gen.draft, { pack, policy });
    assert(audit.state === "PASS", `audit PASS (${JSON.stringify(audit.issues)})`);
    // Trace matrix spot-checks.
    for (const sec of gen.draft.sections) {
      for (const id of sec.claimRefs) {
        const inPack = [...pack.verifiedFacts, ...pack.derivedContext, ...pack.primarySourceFacts, ...pack.independentlyCorroboratedFacts].some((e) => e.claimId === id);
        assert(inPack, `section ${sec.sectionId} ref ${id} reachable in pack`);
      }
    }
    // Persist all artifacts atomically.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-story-"));
    try {
      const saved = storyStore.persistStoryHandoff(root, "p", {
        pack, packMarkdown: packLib.renderPackMarkdown(pack), policy,
        narrativeBrief: brief, draft: gen.draft,
        draftMarkdown: draftLib.renderDraftMarkdown(gen.draft),
        audit: { ...audit, draftId: gen.draft.draftId },
      });
      assert(saved.ok && saved.written.length === 7, `7 artifacts persisted (${saved.written.length})`);
      for (const rel of Object.values(storyStore.FILES)) {
        const loaded = storyStore.loadStoryFile(root, "p", rel);
        assert(loaded.ok && loaded.doc, `${rel} reloads`);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await runTest("E2E-HYBRID five classifications preserved to draft", async () => {
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
      angle: "Records versus memory.",
      coreViewerQuestion: "What really happened at the villa?",
      mainInsight: "I.", payoff: "The villa stands.",
      planQuestions: ["What is documented?"],
      hookBasis: { type: "folklore mystery" },
      fictionalizationBoundary: s.boundary,
    }).brief;
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack, policy }).draft;
    const seen = new Set();
    for (const sec of gen.sections) {
      for (const c of sec.classificationRefs) seen.add(c.classification);
    }
    for (const label of ["FACT", "FOLKLORE", "TESTIMONY", "SPECULATION"]) {
      assert(seen.has(label), `${label} survives to draft metadata`);
    }
    const audit = auditLib.auditStoryDraft(gen, { pack, policy });
    assert(audit.state !== "BLOCKED", `no blocking violation (${audit.state})`);
  });

  await runTest("E2E-FICTION pure + targeted routes", async () => {
    const f = fx.fictionState();
    const brief = nbLib.buildNarrativeBrief({
      contentClass: "FICTION", contentMode: "horror-fiction", brief: f.brief, storyContext: f.storyContext,
      angle: "Dread through sound.", coreViewerQuestion: "What walks?",
      mainInsight: "I.", payoff: "Morning comes.",
      planQuestions: [],
      progressionOverride: [
        { stepId: "hook", purpose: "open", claimIds: [] },
        { stepId: "beats", purpose: "middle", claimIds: [] },
        { stepId: "payoff", purpose: "close", claimIds: [] },
      ],
    }).brief;
    const gen = draftLib.generateStoryDraft({ narrativeBrief: brief, pack: null, policy: null }).draft;
    const audit = auditLib.auditStoryDraft(gen, { pack: null, policy: null });
    assert(audit.state === "PASS", "pure fiction handoff ready");
    assert(gen.sections.every((x) => x.claimRefs.length === 0), "no fake sources anywhere");
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
