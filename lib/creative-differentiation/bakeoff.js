"use strict";

/**
 * Phase 6B / 6.4 — Style Bake-off (UNFOLDIQ CORE).
 *
 * Default is NO_BAKE_OFF. A bake-off runs only for a high-impact editorial
 * decision with genuinely distinct alternatives, capped at 2 candidates (hard 3).
 * Candidates share the same facts/audio/evidence/rubric; comparison is rubric +
 * evidence based — never viewer metrics. A selected candidate stays an
 * UNAPPROVED CANDIDATE until the owner approves; it can never overwrite the
 * locked approved final artifact.
 */

const fs = require("fs");
const path = require("path");
const text = require("../creative-retention/text.js");
const { BAKEOFF_POLICY: P, BAKEOFF_CRITERIA, RUBRIC_VERSION } = require("./policy.js");
const { sha16, assertSafeDoc } = require("./guard.js");

const BAKEOFF_VERSION = "1.0.0";
const err = (code, msg) => Object.assign(new Error(`${code}: ${msg}`), { code });

/**
 * decision: { kind, impact: HIGH|MEDIUM|LOW, knownIssue?: bool, currentVerdict?: PASS|WEAK|FAIL,
 *             massTest?: bool, alternatives: [{ creativeDecision, axis? }] }
 */
function shouldBakeOff(decision = {}) {
  const alts = Array.isArray(decision.alternatives) ? decision.alternatives : [];
  const no = (reason) => ({ run: false, outcome: "NO_BAKE_OFF", variants: 0, reason });
  if (decision.massTest) return no("MASS_TESTING_NOT_ALLOWED");
  if (!P.materialKinds.includes(decision.kind)) return no(`NON_MATERIAL_DECISION:${decision.kind || "UNSPECIFIED"}`);
  if (decision.impact !== "HIGH") return no("IMPACT_NOT_HIGH");
  if (decision.currentVerdict === "PASS" && !decision.knownIssue) return no("STRONG_PASS_WITHOUT_KNOWN_ISSUE");
  const distinct = distinctAlternatives(alts);
  if (distinct.length < 2) return no("NO_GENUINELY_DISTINCT_ALTERNATIVE");
  return { run: true, outcome: "BAKE_OFF", variants: Math.min(distinct.length, P.maxCandidateVariantsPerDecision), reason: "HIGH_IMPACT_DECISION_WITH_DISTINCT_ALTERNATIVES" };
}

const decisionTokens = (s) => new Set([...text.contentTokens(String(s || ""))]);

/** Drop alternatives that are synonyms / token permutations of an earlier one or share the same editorial axis value. */
function distinctAlternatives(alts) {
  const kept = [];
  for (const a of alts) {
    const t = decisionTokens(a.creativeDecision);
    if (t.size === 0) continue;
    const clash = kept.some((k) => text.jaccard(decisionTokens(k.creativeDecision), t) >= P.distinctnessJaccardMax || (a.axis && k.axis && a.axis === k.axis && a.axisValue !== undefined && a.axisValue === k.axisValue));
    if (!clash) kept.push(a);
  }
  return kept;
}

/**
 * input: { projectId, decisionScope, reasonToRun, sharedInputs: {name: hash|string}, rubricVersion?,
 *          candidates: [{ candidateId?, creativeDecision, previewArtifactHash?, previewPath?, findings?,
 *                         estimatedCostVnd?, renderWallMs? }],
 *          activeDecisionsInPilot?, extraCandidateJustification?, lockedArtifact?: { path, sha256 } }
 */
function createBakeoff(input = {}) {
  if (!input.projectId) throw err("BAKEOFF_INVALID", "projectId required");
  const scope = input.decisionScope || {};
  if (!scope.beatId && !scope.sceneId && !scope.frameRange) throw err("BAKEOFF_INVALID", "decisionScope needs beatId, sceneId or frameRange");
  if (!input.reasonToRun || String(input.reasonToRun).length < 10) throw err("BAKEOFF_INVALID", "reasonToRun required");
  if ((input.activeDecisionsInPilot || 0) >= P.maxActiveDecisionsPerPilot && !input.extraDecisionEvidence) throw err("BAKEOFF_ACTIVE_DECISION_CAP", `max ${P.maxActiveDecisionsPerPilot} active decision(s) per pilot without measured evidence`);
  const cands = input.candidates || [];
  if (cands.length > P.maxCandidateVariantsHard) throw err("BAKEOFF_CAP_EXCEEDED", `hard cap ${P.maxCandidateVariantsHard}`);
  if (cands.length > P.maxCandidateVariantsPerDecision && !input.extraCandidateJustification) throw err("BAKEOFF_CAP_EXCEEDED", `default cap ${P.maxCandidateVariantsPerDecision}; a 3rd candidate needs extraCandidateJustification`);
  if (cands.length < 2) throw err("BAKEOFF_INVALID", "a bake-off compares at least 2 candidates");
  const distinct = distinctAlternatives(cands);
  if (distinct.length !== cands.length) throw err("BAKEOFF_CANDIDATES_NOT_DISTINCT", "candidates are synonyms/permutations of each other");
  const shared = input.sharedInputs || {};
  for (const need of ["narrativeClaim", "evidence", "audioTiming", "outputProfile"]) if (!shared[need]) throw err("BAKEOFF_SHARED_INPUT_MISSING", need);
  const sharedInputHashes = Object.fromEntries(Object.entries(shared).map(([k, v]) => [k, /^[0-9a-f]{16,64}$/.test(String(v)) ? String(v) : sha16(v)]));
  const locked = input.lockedArtifact || null;
  const candidates = cands.map((c, i) => {
    if (Number(c.estimatedCostVnd || 0) > 0 || c.paidMediaCall || c.paidMediaCalls) throw err("PAID_COST_GUARD", `candidate ${i} requests paid media/cost`);
    if (locked && c.previewPath && path.resolve(c.previewPath) === path.resolve(locked.path)) throw err("LOCKED_ARTIFACT_OVERWRITE", "candidate preview targets the approved final artifact");
    return {
      candidateId: c.candidateId || `cand-${sha16({ d: c.creativeDecision, i })}`,
      creativeDecision: String(c.creativeDecision),
      ...(c.previewArtifactHash ? { previewArtifactHash: c.previewArtifactHash } : {}),
      findings: c.findings || [],
      estimatedCostVnd: 0,
      ...(Number.isFinite(c.renderWallMs) ? { renderWallMs: c.renderWallMs } : {}),
    };
  });
  const doc = {
    kind: "STYLE_BAKEOFF",
    bakeoffId: `bo-${sha16({ p: input.projectId, s: scope, c: candidates.map((c) => c.creativeDecision), sh: sharedInputHashes })}`,
    version: BAKEOFF_VERSION,
    projectId: input.projectId,
    decisionScope: scope,
    reasonToRun: input.reasonToRun,
    sharedInputHashes,
    rubricVersion: input.rubricVersion || RUBRIC_VERSION,
    criteria: BAKEOFF_CRITERIA,
    candidates,
    evaluation: [],
    decision: "REVIEW_REQUIRED",
    approvalStatus: "UNAPPROVED_CANDIDATE",
    lockedArtifact: locked ? { path: locked.path, sha256: locked.sha256 } : null,
    comparisonBasis: "RUBRIC_AND_EVIDENCE_ONLY (no viewer metrics, no actual retention)",
    policy: { maxCandidateVariantsPerDecision: P.maxCandidateVariantsPerDecision, maxCandidateVariantsHard: P.maxCandidateVariantsHard, paidMediaCalls: 0 },
  };
  assertSafeDoc(doc);
  return doc;
}

/**
 * evaluations: [{ candidateId, ratings: {criterion: 0..4}, rationale, evidenceRefs[] }]
 * Selection requires dominance (>= everywhere, strictly better on >=2 criteria) and factual fidelity >= 2.
 * Anything else is NO_WINNER (trade-off) or REVIEW_REQUIRED (insufficient evidence) — never forced.
 */
function evaluateBakeoff(bakeoff, evaluations = []) {
  const ids = bakeoff.candidates.map((c) => c.candidateId);
  const ev = [];
  let insufficient = false;
  for (const id of ids) {
    const e = evaluations.find((x) => x.candidateId === id);
    if (!e || !e.rationale || !Array.isArray(e.evidenceRefs) || e.evidenceRefs.length === 0) { insufficient = true; continue; }
    const missing = BAKEOFF_CRITERIA.filter((k) => !Number.isInteger(e.ratings && e.ratings[k]) || e.ratings[k] < 0 || e.ratings[k] > 4);
    if (missing.length) { insufficient = true; continue; }
    ev.push({ candidateId: id, ratings: e.ratings, rationale: e.rationale, evidenceRefs: e.evidenceRefs });
  }
  const out = { ...bakeoff, evaluation: ev };
  delete out.selectedCandidateId;
  if (insufficient) { out.decision = "REVIEW_REQUIRED"; out.decisionReason = "INCOMPLETE_RATINGS_OR_EVIDENCE"; assertSafeDoc(out); return out; }
  const eligible = ev.filter((e) => e.ratings.factualFidelity >= 2);
  const dominates = (a, b) => BAKEOFF_CRITERIA.every((k) => a.ratings[k] >= b.ratings[k]) && BAKEOFF_CRITERIA.filter((k) => a.ratings[k] > b.ratings[k]).length >= 2;
  const winner = eligible.find((a) => ev.filter((b) => b !== a).every((b) => dominates(a, b)));
  if (winner) { out.decision = "SELECT"; out.selectedCandidateId = winner.candidateId; out.decisionReason = "DOMINATES_ON_RUBRIC"; }
  else { out.decision = "NO_WINNER"; out.decisionReason = eligible.length === 0 ? "NO_CANDIDATE_MEETS_FACTUAL_FIDELITY" : "TRADE_OFFS_NO_DOMINANT_CANDIDATE"; }
  assertSafeDoc(out);
  return out;
}

/** Owner picks a candidate (any, incl. over NO_WINNER). Records provenance; never touches the locked final. */
function approveCandidate(bakeoff, { candidateId, ownerRef, rationale }) {
  if (!ownerRef || !rationale) throw err("BAKEOFF_APPROVAL_INVALID", "ownerRef and rationale required");
  if (!bakeoff.candidates.some((c) => c.candidateId === candidateId)) throw err("BAKEOFF_APPROVAL_INVALID", "unknown candidate");
  const out = { ...bakeoff, decision: "SELECT", selectedCandidateId: candidateId, approvalRef: ownerRef, approvalStatus: "OWNER_SELECTED_CANDIDATE", approvalRationale: rationale };
  assertSafeDoc(out);
  return out;
}

/** A candidate artifact must live inside creative/bakeoff/<id>/ and may never equal the locked approved final. */
function assertCandidatePathSafe(bakeoff, projectDir, candidatePath) {
  const dir = path.resolve(projectDir, "creative", "bakeoff", bakeoff.bakeoffId);
  const abs = path.resolve(candidatePath);
  if (bakeoff.lockedArtifact && abs === path.resolve(bakeoff.lockedArtifact.path)) throw err("LOCKED_ARTIFACT_OVERWRITE", "target is the approved final artifact");
  if (!(abs === dir || abs.startsWith(dir + path.sep))) throw err("CANDIDATE_PATH_OUTSIDE_BAKEOFF_DIR", abs);
  return abs;
}

/** Locked-artifact integrity: hash must still match the recorded approval. */
function verifyLockedUnchanged(bakeoff, actualSha256) {
  return !bakeoff.lockedArtifact || bakeoff.lockedArtifact.sha256 === actualSha256;
}

const previewCacheKey = ({ sharedInputHashes, creativeDecision, frameRange, rubricVersion }) =>
  sha16({ s: sharedInputHashes, d: creativeDecision, f: frameRange || null, r: rubricVersion || RUBRIC_VERSION });

/** A preview must be a short segment, rendered at most once per candidate (cache hit = zero render). */
function assertSegmentPreview(frameRange, totalFrames) {
  if (!Array.isArray(frameRange) || frameRange.length !== 2 || !(frameRange[1] > frameRange[0])) throw err("PREVIEW_RANGE_INVALID", "frameRange [start,end) required");
  if ((frameRange[1] - frameRange[0]) / totalFrames > P.maxPreviewShareOfVideo) throw err("PREVIEW_TOO_LONG", `preview must cover <= ${P.maxPreviewShareOfVideo * 100}% of the video (no full second render)`);
  return true;
}

/** produce() runs only on a cache miss; stats feed the runtime cost report. */
function getOrCreatePreview(cacheDir, key, produce, stats = { hits: 0, renders: 0 }) {
  const file = path.join(cacheDir, `${key}.json`);
  if (fs.existsSync(file)) { stats.hits += 1; return { cached: true, ...JSON.parse(fs.readFileSync(file, "utf8")), stats }; }
  if (stats.renders >= P.maxSegmentPreviewRenders) throw err("PREVIEW_RENDER_CAP", `max ${P.maxSegmentPreviewRenders} segment preview render(s)`);
  const made = produce();
  stats.renders += 1;
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(made, null, 2) + "\n");
  return { cached: false, ...made, stats };
}

module.exports = {
  BAKEOFF_VERSION, shouldBakeOff, distinctAlternatives, createBakeoff, evaluateBakeoff, approveCandidate,
  assertCandidatePathSafe, verifyLockedUnchanged, previewCacheKey, assertSegmentPreview, getOrCreatePreview,
};
