"use strict";

/**
 * Phase 6B / 6.6 — Explainable Quality Scoring (UNFOLDIQ CORE).
 *
 * A decision AID, never a permission bypass. Thirteen dimensions, each with a
 * versioned anchored 0..4 scale, evidence refs, confidence and assessor type.
 * NOT_APPLICABLE (absent by design) and NOT_MEASURED (no evidence) are never
 * scored; the gate decision (PASS/FAIL/REVIEW_REQUIRED) is stored separately
 * from the aesthetic ordinal summary, and no score cutoff exists that could waive
 * a hard blocker (factual / rights / security / technical P0-P1 / missing artifact
 * / required owner approval).
 */

const { RUBRIC_VERSION, POLICY_VERSION } = require("./policy.js");
const { sha16, assertSafeDoc } = require("./guard.js");
const repair = require("../creative-retention/repair.js");

const ASSESSMENT_VERSION = "1.0.0";
const ANCHORS = Object.freeze({ 0: "critical weakness", 1: "weak", 2: "adequate", 3: "good", 4: "strong" });
const STATUS_RANK = { PASS: 1, REVIEW_REQUIRED: 2, FAIL: 3 };
const CONF_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const CONF_NAME = ["LOW", "MEDIUM", "HIGH"];

// key -> { owner (routing, Q10), anchor text for 0/2/4, contentClasses }
const D = (owner, a0, a2, a4, extra = {}) => ({ owner, anchors: { 0: a0, 2: a2, 4: a4 }, contentClasses: "ALL", requiresNonModel: false, ...extra });
const DIMENSIONS = Object.freeze({
  narration: D("NARRATION_TTS", "unintelligible/clipped/wrong text spoken", "intelligible, text matches script, no defects", "natural, expressive, exact", { requiresNonModel: true }),
  scriptNaturalness: D("STORY_SCRIPT", "robotic, repeated openers/patterns", "readable, minor repetition", "spoken-natural, varied rhythm"),
  evidenceFidelity: D("RESEARCH_EVIDENCE", "unsupported/contradicted claims", "claims traceable to approved script/evidence", "every claim traced and calibrated", { requiresNonModel: true }),
  imagery: D("ASSET_GENERATION", "irrelevant/placeholder visuals", "relevant, readable visuals", "distinctive, purposeful visuals"),
  visualFactuality: D("ASSET_QA", "visuals misstate facts", "accurate, illustration labelled where simplified", "accurate and instructive"),
  continuity: D("CONTINUITY", "style/identity breaks between scenes", "consistent style", "consistent identity and style"),
  motion: D("MOTION_PLAN", "unsafe/flashing/frozen motion", "safe, purposeful motion", "motion reinforces meaning"),
  sound: D("AUDIO_MIX", "silence gaps/clipping/distortion", "clean mix, no defects", "balanced mix with purposeful design", { requiresNonModel: true }),
  captions: D("CAPTIONS", "wrong text or badly out of sync", "accurate, readable, in sync", "accurate, well-phrased, comfortable CPS", { requiresNonModel: true }),
  pacing: D("MASTER_TIMELINE", "dead time / overload", "steady progress, no dead time", "purposeful variation"),
  semanticAlignment: D("STORY_SCRIPT", "visuals/audio contradict narration", "visuals support narration", "visuals sharpen the explanation"),
  originality: D("CREATIVE_ORIGINALITY", "duplicate / templated substance", "distinct substance for its evidenced scope", "distinct substance and treatment"),
  packaging: D("PUBLISH_PACKAGE", "misleading title/thumbnail", "truthful, delivered promise", "truthful and compelling"),
});
const DIMENSION_KEYS = Object.freeze(Object.keys(DIMENSIONS));

const HARD_BLOCKER_CATEGORIES = ["FACTUAL", "RIGHTS", "SECURITY", "TECHNICAL_QA", "MISSING_ARTIFACT", "OWNER_APPROVAL"];

function rubric() {
  return {
    kind: "QUALITY_RUBRIC",
    rubricVersion: RUBRIC_VERSION,
    policyVersion: POLICY_VERSION,
    scale: { type: "ORDINAL_0_4", anchors: ANCHORS, statusFromOrdinal: { 0: "FAIL", 1: "REVIEW_REQUIRED", "2-4": "PASS" }, note: "No aggregate cutoff is used for any decision; calibrated bands live in the golden set." },
    statuses: { NOT_APPLICABLE: "feature absent by design (never scored)", NOT_MEASURED: "no evidence available (never 0, never PASS)", REVIEW_REQUIRED: "ambiguous/insufficient/weak evidence", FAIL: "demonstrated requirement failure", PASS: "sufficient relevant evidence" },
    assessors: { DETERMINISTIC: "rule/measurement", MODEL: "model judgment (cannot override deterministic or human failures)", HUMAN: "explicit reviewer/owner judgment" },
    hardBlockerCategories: HARD_BLOCKER_CATEGORIES,
    hardBlockerRule: "Any P0/P1 hard blocker forces finalDecision=FAIL regardless of any score; owner overrides apply to P2/P3 subjective warnings only.",
    dimensions: Object.fromEntries(DIMENSION_KEYS.map((k) => [k, { applicability: DIMENSIONS[k].contentClasses, owner: DIMENSIONS[k].owner, anchors: DIMENSIONS[k].anchors, requiresNonModelEvidenceForPass: DIMENSIONS[k].requiresNonModel, requiredFields: ["rubricVersion", "evidenceRefs", "confidence", "assessor", "findings", "actionableImprovement"] }])),
    evidencePriority: ["canonical deterministic QA", "validated Phase 6A reports", "script/research/claim evidence", "approved storyboard + CreativeFingerprint", "cached model watch evidence (with limitations)", "explicit human approvals"],
  };
}

const minConf = (list) => CONF_NAME[Math.min(...list.map((c) => CONF_RANK[c || "LOW"]))] || "LOW";
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor((s.length - 1) / 2)]; };

function assessDimension(key, signals, ctx) {
  const def = DIMENSIONS[key];
  const base = { key, applicability: "APPLICABLE", rubricVersion: RUBRIC_VERSION, owner: def.owner };
  const na = ctx.applicability && ctx.applicability[key];
  if (na && na.applicable === false) {
    return { ...base, applicability: "NOT_APPLICABLE", status: "NOT_MEASURED", rationale: `Not applicable by design: ${na.reason}`, evidenceRefs: na.evidenceRefs || [], confidence: "HIGH", assessor: "DETERMINISTIC", findings: [], actionableImprovement: "none" };
  }
  const usable = signals.filter((s) => s.status !== "NOT_MEASURED");
  if (usable.length === 0) {
    return { ...base, status: "NOT_MEASURED", rationale: "No evidence available for this dimension.", evidenceRefs: [], confidence: "LOW", assessor: "DETERMINISTIC", findings: ["EVIDENCE_MISSING"], actionableImprovement: `Produce ${def.owner} evidence (never assume PASS).` };
  }
  const det = usable.filter((s) => s.assessor === "DETERMINISTIC");
  const hum = usable.filter((s) => s.assessor === "HUMAN");
  const mod = usable.filter((s) => s.assessor === "MODEL");
  const findings = [];
  let rank = 1;
  const bump = (st) => { rank = Math.max(rank, STATUS_RANK[st] || 2); };
  if (det.some((s) => s.status === "FAIL")) { bump("FAIL"); if (mod.some((s) => s.status === "PASS")) findings.push("MODEL_DISAGREEMENT_WITH_DETERMINISTIC_QA"); }
  if (hum.some((s) => s.status === "FAIL")) bump("FAIL");
  if (mod.some((s) => s.status === "FAIL")) { bump("REVIEW_REQUIRED"); findings.push("MODEL_REPORTS_FAILURE_NEEDS_CONFIRMATION"); }
  if (usable.some((s) => s.status === "REVIEW_REQUIRED")) bump("REVIEW_REQUIRED");
  if (det.concat(hum).some((s) => s.status === "PASS") && mod.some((s) => s.status === "FAIL")) findings.push("MODEL_DISAGREEMENT_WITH_DETERMINISTIC_QA");
  const nonModel = det.length + hum.length > 0;
  if (!nonModel && def.requiresNonModel) { bump("REVIEW_REQUIRED"); findings.push("MODEL_ONLY_EVIDENCE_INSUFFICIENT"); }
  const ordSrc = (det.concat(hum).filter((s) => Number.isInteger(s.ordinal)).length ? det.concat(hum) : mod).filter((s) => Number.isInteger(s.ordinal));
  const ordinal = ordSrc.length ? (nonModel ? Math.min(...ordSrc.map((s) => s.ordinal)) : median(ordSrc.map((s) => s.ordinal))) : undefined;
  if (ordinal === 0) bump("FAIL"); else if (ordinal === 1) bump("REVIEW_REQUIRED");
  const status = Object.keys(STATUS_RANK).find((k) => STATUS_RANK[k] === rank);
  let confidence = minConf(usable.map((s) => s.confidence));
  if (!nonModel && CONF_RANK[confidence] > CONF_RANK.MEDIUM) confidence = "MEDIUM";
  const assessor = det.length ? "DETERMINISTIC" : hum.length ? "HUMAN" : "MODEL";
  for (const s of usable) if (s.findingId) findings.push(s.findingId);
  return {
    ...base, status, ...(ordinal !== undefined ? { ordinalScore: ordinal } : {}),
    rationale: usable.map((s) => `[${s.assessor}/${s.status}] ${s.note || s.source}`).join(" | "),
    evidenceRefs: [...new Set(usable.map((s) => s.evidenceRef).filter(Boolean))],
    confidence, assessor, findings: [...new Set(findings)],
    actionableImprovement: status === "PASS" ? "none required" : `Route to ${def.owner}: ${usable.filter((s) => s.status !== "PASS").map((s) => s.note || s.source).join("; ") || "obtain stronger evidence"}`,
  };
}

/**
 * ev: { projectId, videoSha256, contentClass, applicability?, signals[], hardBlockers[], limitations[],
 *       acceptances?: [{ dimension, ownerRef, reason, ledgerEntryId }], humanReviewRequired?, ownerApprovalRef?, openCreativeFindings? }
 */
function assessQuality(ev) {
  if (!ev || !ev.projectId || !ev.videoSha256) throw Object.assign(new Error("QUALITY_INPUT_INVALID: projectId + videoSha256 required"), { code: "QUALITY_INPUT_INVALID" });
  const accepted = new Map((ev.acceptances || []).map((a) => [a.dimension, a]));
  const dimensions = DIMENSION_KEYS.map((k) => {
    const d = assessDimension(k, (ev.signals || []).filter((s) => s.dimension === k), ev);
    const acc = accepted.get(k);
    if (acc && d.status === "REVIEW_REQUIRED") return { ...d, acceptedByOwner: { ownerRef: acc.ownerRef, reason: acc.reason, ledgerEntryId: acc.ledgerEntryId || null } };
    return d;
  });
  const applicable = dimensions.filter((d) => d.applicability === "APPLICABLE");
  const assessed = applicable.filter((d) => d.status !== "NOT_MEASURED");
  const missing = applicable.filter((d) => d.status === "NOT_MEASURED");
  const hard = (ev.hardBlockers || []).filter((b) => ["P0", "P1"].includes(b.severity) && HARD_BLOCKER_CATEGORIES.includes(b.category));
  const failing = dimensions.filter((d) => d.status === "FAIL");
  const unresolved = dimensions.filter((d) => d.status === "REVIEW_REQUIRED" && !d.acceptedByOwner);
  const blockingFindings = [...hard.map((b) => `${b.category}:${b.id}`), ...failing.map((d) => `DIMENSION_FAIL:${d.key}`)];
  let finalDecision = "PASS";
  const reasons = [];
  if (blockingFindings.length) { finalDecision = "FAIL"; reasons.push("hard blocker or failing dimension"); }
  else if (unresolved.length || missing.length || ev.humanReviewRequired) {
    finalDecision = "REVIEW_REQUIRED";
    if (unresolved.length) reasons.push(`unresolved review: ${unresolved.map((d) => d.key).join(",")}`);
    if (missing.length) reasons.push(`not measured: ${missing.map((d) => d.key).join(",")}`);
    if (ev.humanReviewRequired) reasons.push("human review requested");
  }
  const ords = assessed.filter((d) => Number.isInteger(d.ordinalScore)).map((d) => d.ordinalScore);
  const summary = ords.length
    ? { score: Number((ords.reduce((a, b) => a + b, 0) / ords.length).toFixed(2)), scoreMeaning: `mean ordinal (0-4) over ${ords.length} scored of ${applicable.length} applicable dimensions; aesthetic decision aid only, never gates, never waives a blocker`, partial: ords.length < applicable.length }
    : { scoreMeaning: "NOT_COMPUTED (no ordinal evidence)" };
  const doc = {
    kind: "QUALITY_ASSESSMENT",
    version: ASSESSMENT_VERSION,
    rubricVersion: RUBRIC_VERSION,
    policyVersion: POLICY_VERSION,
    projectId: ev.projectId,
    videoSha256: ev.videoSha256,
    contentClass: ev.contentClass || "FACTUAL",
    dimensions,
    coverage: { applicable: applicable.length, assessed: assessed.length, missing: missing.length, missingDimensions: missing.map((d) => d.key), notApplicable: dimensions.filter((d) => d.applicability === "NOT_APPLICABLE").map((d) => d.key) },
    summary,
    blockingFindings,
    hardBlockers: hard,
    recommendedRepairs: dimensions.filter((d) => d.status !== "PASS" && d.applicability === "APPLICABLE" && !d.acceptedByOwner).map((d) => ({ dimension: d.key, owner: d.owner, action: d.actionableImprovement })),
    acceptedByOwner: dimensions.filter((d) => d.acceptedByOwner).map((d) => ({ dimension: d.key, ...d.acceptedByOwner })),
    limitations: ev.limitations || [],
    finalDecision,
    decisionReasons: reasons,
    gateVsPreference: "finalDecision (gate) and summary.score (preference) are stored separately; the gate never reads the score.",
    ...(ev.ownerApprovalRef ? { ownerApprovalRef: ev.ownerApprovalRef } : {}),
  };
  const parts = qualityCacheParts(ev);
  doc.cache = { key: sha16(parts), parts };
  assertSafeDoc(doc);
  return doc;
}

const qualityCacheParts = (ev) => ({
  rubricVersion: RUBRIC_VERSION,
  policyVersion: POLICY_VERSION,
  videoSha256: ev.videoSha256,
  contentClass: ev.contentClass || "FACTUAL",
  evidenceHash: sha16({ s: ev.signals || [], b: ev.hardBlockers || [], a: ev.applicability || null, acc: (ev.acceptances || []).map((a) => [a.dimension, a.ledgerEntryId]) }),
});

/** A cached assessment is stale when rubric/policy/evidence/content class moved — independent of video bytes. */
function isQualityStale(assessment, ev) {
  const cur = qualityCacheParts(ev);
  const was = (assessment.cache && assessment.cache.parts) || {};
  const reasons = Object.keys(cur).filter((k) => was[k] !== cur[k]);
  return { stale: reasons.length > 0, reasons };
}

/** Route non-passing dimensions and open creative findings to their owning subsystem (existing repair owners). */
function routeFindings(assessment, creativeFindings = []) {
  const out = assessment.recommendedRepairs.map((r) => ({ source: `dimension:${r.dimension}`, owner: r.owner, action: r.action }));
  for (const f of creativeFindings.filter((x) => x.status === "OPEN")) {
    const rc = repair.REPAIR_CLASSES[f.repairClass];
    out.push({ source: `finding:${f.code}`, owner: rc ? rc.owner : "REVIEW_ONLY", action: f.correctiveAction });
  }
  return out;
}

module.exports = { ASSESSMENT_VERSION, ANCHORS, DIMENSIONS, DIMENSION_KEYS, HARD_BLOCKER_CATEGORIES, rubric, assessDimension, assessQuality, qualityCacheParts, isQualityStale, routeFindings };
