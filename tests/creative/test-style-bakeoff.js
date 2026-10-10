"use strict";

/** Phase 6B / 6.4 — Style Bake-off (S01-S08). No render, no provider call. */

const fs = require("fs");
const os = require("os");
const path = require("path");
const fx = require("../fixtures/creative-fixture.js");
const { dif } = require("../fixtures/differentiation-fixture.js");
const { assert, assertEq, runTest, done } = fx.harness("creative/style-bakeoff");
const bo = dif.bakeoff;

const SHARED = { narrativeClaim: "c-rayleigh", evidence: "ev-1", audioTiming: "timing-1", outputProfile: "1920x1080@30" };
const mk = (over = {}) => ({
  projectId: "p-bo", decisionScope: { beatId: "b1" }, reasonToRun: "Hook visual sequence is high impact and can be expressed two ways",
  sharedInputs: SHARED, candidates: [{ creativeDecision: "static diagram with slow push-in on the sun" }, { creativeDecision: "animated ray fan sweeping across the blue sky" }],
  lockedArtifact: { path: "/p/out/final.mp4", sha256: "aa".repeat(32) }, ...over,
});
const good = { factualFidelity: 4, clarity: 3, storyPurpose: 3, visualReadability: 3, pacing: 3, styleConsistency: 3, originalityContribution: 3, costLatency: 3, accessibility: 3 };
const ev = (id, r, extra = {}) => ({ candidateId: id, ratings: { ...good, ...r }, rationale: "rubric comparison on shared inputs", evidenceRefs: ["frame:b1"], ...extra });

runTest("S01: no meaningful decision -> NO_BAKE_OFF with zero variants", () => {
  const alts = [{ creativeDecision: "bigger font" }, { creativeDecision: "slightly larger typeface" }];
  for (const d of [
    { kind: "FONT_MICRO_ADJUSTMENT", impact: "LOW", alternatives: alts },
    { kind: "HOOK_VISUAL_SEQUENCE", impact: "HIGH", currentVerdict: "PASS", knownIssue: false, alternatives: [{ creativeDecision: "a" }, { creativeDecision: "completely different treatment" }] },
    { kind: "HOOK_VISUAL_SEQUENCE", impact: "HIGH", massTest: true, alternatives: [{ creativeDecision: "x one" }, { creativeDecision: "y two" }] },
    { kind: "DENSE_DIAGRAM", impact: "MEDIUM", knownIssue: true, alternatives: [{ creativeDecision: "split into steps" }, { creativeDecision: "single dense overlay" }] },
  ]) { const r = bo.shouldBakeOff(d); assertEq([r.run, r.outcome, r.variants], [false, "NO_BAKE_OFF", 0], `${d.kind}/${d.impact}: ${r.reason}`); }
});

runTest("S02: meaningful decision -> exactly two genuinely distinct candidates (synonym/permutation variants are rejected)", () => {
  const r = bo.shouldBakeOff({ kind: "PAYOFF_DELIVERY", impact: "HIGH", knownIssue: true, alternatives: [{ creativeDecision: "still image with slow motion reveal" }, { creativeDecision: "animated sequence showing the sunset path" }, { creativeDecision: "motion reveal with still image slow" }] });
  assert(r.run && r.variants === 2, "run with 2 variants (third is a token permutation of the first)");
  assertEq(bo.distinctAlternatives([{ creativeDecision: "still image slow motion reveal" }, { creativeDecision: "reveal slow motion still image" }]).length, 1, "permutation collapses to one");
  const doc = bo.createBakeoff(mk());
  assertEq(doc.candidates.length, 2, "two candidates");
  assertEq(doc.decision, "REVIEW_REQUIRED", "no automatic winner at creation");
  let threw = null;
  try { bo.createBakeoff(mk({ candidates: [{ creativeDecision: "push in on sun" }, { creativeDecision: "sun on push in" }] })); } catch (e) { threw = e.code; }
  assertEq(threw, "BAKEOFF_CANDIDATES_NOT_DISTINCT", "synonym/permutation candidates refused");
});

runTest("S03: candidates share the same narrative claim, evidence, audio timing and output profile (required, hashed)", () => {
  const doc = bo.createBakeoff(mk());
  assertEq(Object.keys(doc.sharedInputHashes).sort(), ["audioTiming", "evidence", "narrativeClaim", "outputProfile"], "shared input hashes recorded once for all candidates");
  for (const need of Object.keys(SHARED)) {
    let code = null;
    try { bo.createBakeoff(mk({ sharedInputs: { ...SHARED, [need]: undefined } })); } catch (e) { code = e.code; }
    assertEq(code, "BAKEOFF_SHARED_INPUT_MISSING", `missing ${need} refused`);
  }
  assertEq(doc.rubricVersion, dif.policy.RUBRIC_VERSION, "same rubric version for every candidate");
});

runTest("S04: comparison carries rationale + evidence and never viewer metrics", () => {
  const doc = bo.createBakeoff(mk());
  const [a, b] = doc.candidates;
  const out = bo.evaluateBakeoff(doc, [ev(a.candidateId, { clarity: 4, pacing: 4 }), ev(b.candidateId, {})]);
  assertEq(out.decision, "SELECT", "dominant candidate selected");
  assert(out.evaluation.every((e) => e.rationale && e.evidenceRefs.length), "every evaluation has rationale + evidence");
  assert(/RUBRIC_AND_EVIDENCE_ONLY/.test(out.comparisonBasis), "basis states no viewer metrics");
  let code = null;
  try { bo.evaluateBakeoff(doc, [ev(a.candidateId, {}, { rationale: "viewers prefer B by 23%" }), ev(b.candidateId, {})]); } catch (e) { code = e.code; }
  assertEq(code, "FABRICATED_VIEWER_OR_CERTIFICATION_CLAIM", "fabricated viewer preference claim is rejected");
});

runTest("S05: no dominant candidate -> NO_WINNER / REVIEW_REQUIRED, never a forced pick", () => {
  const doc = bo.createBakeoff(mk());
  const [a, b] = doc.candidates;
  const tradeoff = bo.evaluateBakeoff(doc, [ev(a.candidateId, { clarity: 4, pacing: 2 }), ev(b.candidateId, { clarity: 2, pacing: 4 })]);
  assertEq([tradeoff.decision, tradeoff.selectedCandidateId], ["NO_WINNER", undefined], "trade-offs -> NO_WINNER");
  const unsafe = bo.evaluateBakeoff(doc, [ev(a.candidateId, { factualFidelity: 1, clarity: 4, pacing: 4 }), ev(b.candidateId, { factualFidelity: 1 })]);
  assertEq(unsafe.decision, "NO_WINNER", "no candidate meeting factual fidelity -> NO_WINNER");
  const partial = bo.evaluateBakeoff(doc, [ev(a.candidateId, {})]);
  assertEq(partial.decision, "REVIEW_REQUIRED", "incomplete evidence -> REVIEW_REQUIRED");
  const owner = bo.approveCandidate(tradeoff, { candidateId: a.candidateId, ownerRef: "owner-1", rationale: "owner prefers clarity for the hook" });
  assertEq([owner.decision, owner.approvalStatus, owner.approvalRef], ["SELECT", "OWNER_SELECTED_CANDIDATE", "owner-1"], "owner choice persists with provenance + rationale");
});

runTest("S06: candidate cap and paid-generation guard are enforced", () => {
  const three = [{ creativeDecision: "static diagram push in" }, { creativeDecision: "animated ray fan sweep" }, { creativeDecision: "split-screen comparison sunrise sunset" }];
  let c1 = null, c2 = null, c3 = null, c4 = null;
  try { bo.createBakeoff(mk({ candidates: three })); } catch (e) { c1 = e.code; }
  assertEq(c1, "BAKEOFF_CAP_EXCEEDED", "third candidate needs a justification");
  const ok3 = bo.createBakeoff(mk({ candidates: three, extraCandidateJustification: "measured: two candidates tied on the rubric" }));
  assertEq(ok3.candidates.length, 3, "3 allowed only with justification (hard cap)");
  try { bo.createBakeoff(mk({ candidates: [...three, { creativeDecision: "a fourth genuinely different idea" }], extraCandidateJustification: "x" })); } catch (e) { c2 = e.code; }
  assertEq(c2, "BAKEOFF_CAP_EXCEEDED", "hard cap 3");
  try { bo.createBakeoff(mk({ candidates: [{ creativeDecision: "static diagram push in", estimatedCostVnd: 500 }, { creativeDecision: "animated ray fan sweep" }] })); } catch (e) { c3 = e.code; }
  assertEq(c3, "PAID_COST_GUARD", "paid candidate refused");
  try { bo.createBakeoff(mk({ activeDecisionsInPilot: 1 })); } catch (e) { c4 = e.code; }
  assertEq(c4, "BAKEOFF_ACTIVE_DECISION_CAP", "max 1 active decision per pilot without measured evidence");
  assertEq(dif.policy.ZERO_COST.PAID_MEDIA_GENERATION_ALLOWED, false, "policy: paid media generation not allowed");
});

runTest("S07: preview is a short segment, cached, and never a second full render", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bo-prev-"));
  bo.assertSegmentPreview([0, 300], 1713);
  let code = null;
  try { bo.assertSegmentPreview([0, 1713], 1713); } catch (e) { code = e.code; }
  assertEq(code, "PREVIEW_TOO_LONG", "full-length second render refused");
  const doc = bo.createBakeoff(mk());
  const key = bo.previewCacheKey({ sharedInputHashes: doc.sharedInputHashes, creativeDecision: doc.candidates[0].creativeDecision, frameRange: [0, 300] });
  const stats = { hits: 0, renders: 0 };
  let produced = 0;
  const r1 = bo.getOrCreatePreview(dir, key, () => { produced++; return { previewArtifactHash: "ab".repeat(8), frames: 300 }; }, stats);
  const r2 = bo.getOrCreatePreview(dir, key, () => { produced++; return {}; }, stats);
  assertEq([r1.cached, r2.cached, produced, stats.hits, stats.renders], [false, true, 1, 1, 1], "second request is a cache hit, one render total");
  let cap = null;
  try { bo.getOrCreatePreview(dir, key + "x", () => ({}), stats); } catch (e) { cap = e.code; }
  assertEq(cap, "PREVIEW_RENDER_CAP", "at most one segment preview render per bake-off");
});

runTest("S08: an unapproved candidate can never overwrite the approved final artifact", () => {
  const doc = bo.createBakeoff(mk());
  const proj = path.join(os.tmpdir(), "p-bo");
  let c1 = null, c2 = null, c3 = null;
  try { bo.assertCandidatePathSafe(doc, proj, "/p/out/final.mp4"); } catch (e) { c1 = e.code; }
  assertEq(c1, "LOCKED_ARTIFACT_OVERWRITE", "locked final path refused");
  try { bo.assertCandidatePathSafe(doc, proj, path.join(proj, "render", "output.mp4")); } catch (e) { c2 = e.code; }
  assertEq(c2, "CANDIDATE_PATH_OUTSIDE_BAKEOFF_DIR", "candidate must live in creative/bakeoff/<id>/");
  assert(bo.assertCandidatePathSafe(doc, proj, path.join(proj, "creative", "bakeoff", doc.bakeoffId, "cand-1.mp4")), "candidate dir accepted");
  try { bo.createBakeoff(mk({ candidates: [{ creativeDecision: "static diagram push in", previewPath: "/p/out/final.mp4" }, { creativeDecision: "animated ray fan sweep" }] })); } catch (e) { c3 = e.code; }
  assertEq(c3, "LOCKED_ARTIFACT_OVERWRITE", "candidate preview pointing at the final is refused at creation");
  assertEq(doc.approvalStatus, "UNAPPROVED_CANDIDATE", "candidate is unapproved until the owner chooses");
  assert(bo.verifyLockedUnchanged(doc, "aa".repeat(32)) && !bo.verifyLockedUnchanged(doc, "bb".repeat(32)), "locked-hash integrity check detects mutation");
});

done();
