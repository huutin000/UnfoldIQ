"use strict";

/**
 * Narrative Brief tests NB1-NB10 (Prompt 04, 1G.1O).
 * Deterministic fixtures. No network.
 */

const nbLib = require("../../lib/research-story/narrative-brief.js");
const packLib = require("../../lib/research-story/research-pack.js");
const gateLib = require("../../lib/research-story/script-evidence-gate.js");
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

function factualKit() {
  const s = fx.factualState();
  const pack = packLib.buildPack({
    projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
    contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
  }).pack;
  const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
  return { s, pack, policy };
}

const BASE = {
  contentClass: "FACTUAL", contentMode: "technical-explainer",
  angle: "Method preservation is the whole point of 308.",
  coreViewerQuestion: "Why does 308 exist when 301 already redirects permanently?",
  mainInsight: "308 exists to remove method-rewrite ambiguity.",
  payoff: "Use 308 when the method must survive the redirect.",
  planQuestions: ["Does 308 preserve method?", "Which RFC standardizes 308?"],
  hookBasis: { type: "surprising documented fact" },
};

async function main() {
  console.log("=== NARRATIVE BRIEF TESTS (NB1-NB10) ===\n");

  await runTest("NB1 viewerPromise preserved", async () => {
    const { pack, policy } = factualKit();
    const r = nbLib.buildNarrativeBrief({
      ...BASE, pack, policy,
      brief: { audience: "developers", platform: "youtube", viewerPromise: "grasp 308 in 90 seconds", targetDuration: "60-90s", contentDensity: "lean" },
    });
    assert(r.ok && r.brief.viewerPromise === "grasp 308 in 90 seconds", "promise preserved verbatim");
    const rewrite = nbLib.buildNarrativeBrief({
      ...BASE, pack, policy, viewerPromise: "something else entirely",
      brief: { audience: "developers", platform: "youtube", viewerPromise: "grasp 308 in 90 seconds" },
    });
    assert(!rewrite.ok, "rewriting the brief promise rejected");
  });

  await runTest("NB2/NB3/NB4 question + angle + insight present", async () => {
    const { pack, policy } = factualKit();
    const r = nbLib.buildNarrativeBrief({ ...BASE, pack, policy, brief: { audience: "d", platform: "youtube" } });
    assert(r.ok && r.brief.coreViewerQuestion.length > 0, "core viewer question defined");
    assert(r.brief.editorialAngle.length > 0, "editorial angle defined");
    assert(r.brief.mainInsight.length > 0, "main insight defined");
    assert(r.brief.hookBasis.type === "surprising documented fact", "hook basis defined");
    assert(r.brief.narrativeProgression.length >= 3, "progression has hook, questions, payoff");
  });

  await runTest("NB5/NB6 selection is evidence-linked", async () => {
    const { pack, policy } = factualKit();
    const good = nbLib.buildNarrativeBrief({ ...BASE, pack, policy, brief: { audience: "d", platform: "youtube" } });
    assert(good.ok && good.brief.selectedClaimIds.length > 0, "default selection from pack");
    const bad = nbLib.buildNarrativeBrief({
      ...BASE, pack, policy, brief: { audience: "d", platform: "youtube" },
      selectedClaimIds: ["clm-000000000000"],
    });
    assert(!bad.ok && bad.code === "EDITORIAL_STRATEGY_INVALID", "unsupported claim cannot be selected");
  });

  await runTest("NB7 material dispute preserved, silent omission rejected", async () => {
    const s = fx.factualState();
    const cid = s.ledger.claims[0].claimId;
    const pack = packLib.buildPack({
      projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
      contradictionsStore: { contradictions: [{ contradictionId: "ctr-aaaabbbbcccc", claimIds: [cid, s.ledger.claims[1].claimId], sourceIds: ["x"], description: "d", materiality: "critical", status: "OPEN" }] },
      unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
    }).pack;
    const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
    const omit = nbLib.buildNarrativeBrief({ ...BASE, pack, policy, brief: { audience: "d", platform: "youtube" }, omitClaimIds: [cid] });
    assert(!omit.ok, "silently omitting a material conflict rejected");
    const keep = nbLib.buildNarrativeBrief({ ...BASE, pack, policy, brief: { audience: "d", platform: "youtube" } });
    assert(keep.ok && keep.brief.disputesToPreserve.includes(cid), "dispute auto-preserved");
  });

  await runTest("NB8 duration/density influence scope only", async () => {
    const { pack, policy } = factualKit();
    const lean = nbLib.buildNarrativeBrief({ ...BASE, pack, policy, brief: { audience: "d", platform: "youtube", targetDuration: "15s", contentDensity: "lean" } });
    const dense = nbLib.buildNarrativeBrief({ ...BASE, pack, policy, brief: { audience: "d", platform: "tiktok", targetDuration: "10min", contentDensity: "dense" } });
    assert(lean.ok && dense.ok, "both build");
    assert(lean.brief.scopeEstimate.sections <= dense.brief.scopeEstimate.sections, "density scales section estimate");
    assert(/estimate|planning only/.test(lean.brief.scopeEstimate.note), "marked as estimate, no word counts");
    assert(!("wordCount" in lean.brief) && !("wordCount" in dense.brief), "no hard word counts");
  });

  await runTest("NB9 platform overlay does not change evidence", async () => {
    const { pack, policy } = factualKit();
    const yt = nbLib.buildNarrativeBrief({ ...BASE, pack, policy, brief: { audience: "d", platform: "youtube" } });
    const tt = nbLib.buildNarrativeBrief({ ...BASE, pack, policy, brief: { audience: "d", platform: "tiktok" } });
    assert(yt.ok && tt.ok, "both platforms build from shared pack");
    assert(JSON.stringify(yt.brief.selectedClaimIds) === JSON.stringify(tt.brief.selectedClaimIds), "same evidence selection");
    assert(yt.brief.platform === "youtube" && tt.brief.platform === "tiktok", "presentation differs, truth identical");
  });

  await runTest("NB10 factual truth unchanged by angle", async () => {
    const { pack, policy } = factualKit();
    const a = nbLib.buildNarrativeBrief({ ...BASE, pack, policy, brief: { audience: "d", platform: "youtube" } });
    const b = nbLib.buildNarrativeBrief({ ...BASE, pack, policy, angle: "A completely different viewer-relevant angle.", brief: { audience: "d", platform: "youtube" } });
    assert(a.ok && b.ok, "different angles both build");
    assert(JSON.stringify(a.brief.selectedClaimIds) === JSON.stringify(b.brief.selectedClaimIds), "angle changes emphasis path, not the evidence set");
    assert(a.brief.editorialAngle !== b.brief.editorialAngle, "angles actually differ");
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
