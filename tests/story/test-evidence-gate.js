"use strict";

/**
 * Script Evidence Gate tests EG1-EG10 (Prompt 04, 1G.1N).
 * Deterministic fixtures. No network.
 */

const gateLib = require("../../lib/research-story/script-evidence-gate.js");
const packLib = require("../../lib/research-story/research-pack.js");
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

function factualPolicy() {
  const s = fx.factualState();
  const pack = packLib.buildPack({
    projectId: "story-fact", plan: s.plan, ledger: s.ledger, records: s.index.sources,
    contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
  }).pack;
  return gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
}

function hybridPolicy() {
  const s = fx.hybridState();
  const pack = packLib.buildPack({
    projectId: "story-hybrid", plan: s.plan, ledger: s.ledger, records: s.index.sources,
    contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
    hybridLabels: s.hybridLabels,
  }).pack;
  return gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
}

async function main() {
  console.log("=== EVIDENCE GATE TESTS (EG1-EG10) ===\n");

  await runTest("EG1 PRIMARY_CONFIRMED material claim allowed", async () => {
    const s = fx.factualState();
    const pack = packLib.buildPack({
      projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
      contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
    }).pack;
    const prim = pack.primarySourceFacts[0] || pack.verifiedFacts[0];
    const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
    const use = gateLib.usageFor(policy, prim.claimId);
    assert(use.verdict === "allow", `primary-backed claim allowed (${prim.claimId})`);
  });

  await runTest("EG2 MULTI_SOURCE_CONFIRMED material claim allowed", async () => {
    const policy = factualPolicy();
    const multi = policy.allowedClaims;
    assert(multi.length > 0, "allowed claims exist");
    const use = gateLib.usageFor(policy, multi[0].claimId);
    assert(use.verdict === "allow", "multi-source claim allowed as fact");
  });

  await runTest("EG3 SINGLE_SOURCE high-impact gets restriction, not ban", async () => {
    const s = fx.factualState();
    // Demote to single-source high claim.
    s.ledger.claims[0].corroborationStatus = "SINGLE_SOURCE";
    s.ledger.claims[0].materiality = "high";
    s.ledger.claims[0].supportingEvidence = [s.ledger.claims[0].supportingEvidence[0]];
    const pack = packLib.buildPack({
      projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
      contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
    }).pack;
    const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
    const use = gateLib.usageFor(policy, s.ledger.claims[0].claimId);
    assert(use.verdict === "restrict" && use.rule === "SINGLE_SOURCE_ATTRIBUTED", "restricted with attribution, not globally banned");
    assert(use.attribution && use.attribution.publisher, "attribution target present");
  });

  await runTest("EG4 CONFLICTED claim cannot become settled fact", async () => {
    const s = fx.factualState();
    s.ledger.claims[0].corroborationStatus = "CONFLICTED";
    const pack = packLib.buildPack({
      projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
      contradictionsStore: { contradictions: [{ contradictionId: "ctr-aaaabbbbcccc", claimIds: [s.ledger.claims[0].claimId, s.ledger.claims[1].claimId], sourceIds: ["x"], description: "d", materiality: "critical", status: "OPEN" }] },
      unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
    }).pack;
    const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
    const use = gateLib.usageFor(policy, s.ledger.claims[0].claimId);
    assert(use.verdict === "dispute" && use.rule === "FRAME_OR_OMIT", "conflict must be framed or omitted");
  });

  await runTest("EG5 UNSUPPORTED claim forbidden as fact", async () => {
    const s = fx.hybridState();
    const unv = s.ledger.claims.find((c) => c.evidenceStatus === "UNSUPPORTED");
    assert(!!unv, "fixture has an unsupported claim");
    const pack = packLib.buildPack({
      projectId: "p", plan: s.plan, ledger: s.ledger, records: s.index.sources,
      contradictionsStore: { contradictions: [] }, unknownsStore: { unknowns: [] }, sufficiency: s.sufficiency,
      hybridLabels: s.hybridLabels,
    }).pack;
    const policy = gateLib.buildEvidencePolicy({ pack, records: s.index.sources }).policy;
    const use = gateLib.usageFor(policy, unv.claimId);
    assert(use.verdict === "forbid", "unsupported cannot be narrated as fact");
  });

  await runTest("EG6 HYPOTHESIS preserves uncertainty", async () => {
    const policy = hybridPolicy();
    const spec = policy.restrictedClaims.find((c) => c.rule === "SPECULATION_QUALIFIED");
    assert(!!spec, "speculation claim restricted");
    const q = policy.requiredQualifiers.find((x) => x.claimId === spec.claimId);
    assert(q && q.qualifier === "uncertain" && q.level === "must", "uncertainty qualifier mandatory");
  });

  await runTest("EG7 FOLKLORE preserves classification", async () => {
    const policy = hybridPolicy();
    const folk = policy.restrictedClaims.find((c) => c.rule === "FOLKLORE_AS_FOLKLORE");
    assert(!!folk, "folklore kept as folklore");
    const s = fx.hybridState();
    const folkClaim = s.ledger.claims.find((c) => s.hybridLabels[c.claimId] === "FOLKLORE");
    const use = gateLib.usageFor(policy, folkClaim.claimId);
    assert(use.verdict === "restrict", "folklore never allowed-as-fact");
  });

  await runTest("EG8 TESTIMONY requires attribution semantics", async () => {
    const policy = hybridPolicy();
    const test = policy.restrictedClaims.find((c) => c.rule === "TESTIMONY_ATTRIBUTED");
    assert(!!test, "testimony restricted");
    const att = policy.requiredAttributions.find((a) => a.claimId === test.claimId);
    assert(!!att, "witness attribution required, never flattened to verified fact");
  });

  await runTest("EG9 SPECULATION cannot become certainty", async () => {
    const policy = hybridPolicy();
    const s = fx.hybridState();
    const specClaim = s.ledger.claims.find((c) => s.hybridLabels[c.claimId] === "SPECULATION");
    const before = `Wind explanation is certain and confirmed by investigators.`;
    assert(!gateLib.qualifierPresent(before, "uncertain"), "sanity: escalation text lacks qualifier");
    const use = gateLib.usageFor(policy, specClaim.claimId);
    assert(use.verdict === "restrict" && use.qualifier.qualifier === "uncertain", "escalation blocked by required qualifier");
  });

  await runTest("EG10 FICTIONALIZED_ELEMENT cannot masquerade as documented fact", async () => {
    const policy = hybridPolicy();
    const s = fx.hybridState();
    const beat = s.ledger.claims.find((c) => s.hybridLabels[c.claimId] === "FICTIONALIZED_ELEMENT");
    const use = gateLib.usageFor(policy, beat.claimId);
    assert(use.verdict === "forbid", "fictional beat forbidden as documented fact");
  });

  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) { console.log("RESULT: SOME TESTS FAILED"); process.exit(1); }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => { console.log(`[FAIL] harness: ${e.message}`); process.exit(1); });
