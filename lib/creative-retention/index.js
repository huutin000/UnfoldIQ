"use strict";

/**
 * Phase 6A — Creative Retention facade (UNFOLDIQ CORE).
 *
 * Pre-publish CREATIVE_RETENTION_RISK is NOT actual audience retention
 * (RULE 1). Nothing here produces a retention/watch-time figure; the risk
 * report is a structured, finding-driven assessment with stable anchors that
 * a future analytics phase (Phase 10) can map real INTRO / TOP MOMENTS /
 * SPIKES / DIPS onto — that ingestion is NOT implemented here.
 */

const artifactStore = require("../../providers/runtime/artifact-store.js");
const contract = require("./contract.js");
const policy = require("./policy.js");
const inputLib = require("./input.js");
const beats = require("./beats.js");
const hook = require("./hook.js");
const rhythm = require("./rhythm.js");
const watch = require("./watch.js");
const repair = require("./repair.js");
const adapter = require("./adapter.js");

const { countBySeverity, dedupeFindings, assertNoFabricatedRetention } = contract;

const ARTIFACT_FILES = Object.freeze({
  hook: "creative/hook-quality-report.json",
  beats: "creative/narrative-beat-quality-report.json",
  rhythm: "creative/visual-rhythm-report.json",
  risk: "creative/creative-retention-risk-report.json",
  watch: "creative/multimodal-watch-report.json",
  fingerprint: "creative/creative-fingerprint.json",
  repairPlan: "creative/creative-repair-plan.json",
});

const isOpen = (f) => f.status === "OPEN" || f.status === "REVIEW_REQUIRED";

/** Deterministic analysis: Hook + Beat + Rhythm + Fingerprint (no model calls). */
function analyzeCreativeRetention(raw, opts = {}) {
  const n = raw && raw.inputFingerprint && raw.beats ? { ok: true, input: raw } : inputLib.normalizeInput(raw);
  if (!n.ok) return n;
  const input = n.input;
  const t0 = Date.now();
  const beatReport = beats.analyzeBeats(input);
  const t1 = Date.now();
  const hookReport = hook.analyzeHook(input, { beatReport });
  const t2 = Date.now();
  const rhythmReport = rhythm.analyzeRhythm(input, { beatReport });
  const t3 = Date.now();
  const fingerprint = rhythmReport.fingerprint;
  const findings = dedupeFindings([...hookReport.findings, ...beatReport.findings, ...rhythmReport.findings]);
  const analysis = {
    ok: true, input, beatReport, hookReport, rhythmReport, fingerprint, findings,
    cost: { modelCalls: 0, tokens: 0, costUsd: 0 },
    latencyMs: { beats: t1 - t0, hook: t2 - t1, rhythm: t3 - t2, total: t3 - t0 },
  };
  analysis.riskReport = buildCreativeRetentionRiskReport(analysis, opts);
  return analysis;
}

function riskLevelOf(findings, hookReport) {
  const open = findings.filter(isOpen);
  const c = countBySeverity(findings);
  if (open.some((f) => f.status === "REVIEW_REQUIRED")) return "REVIEW_REQUIRED";
  if (c.P0 > 0 || c.P1 > 0) return "HIGH";
  const hookFail = hookReport.checkpoints.some((cp) => cp.verdict === "FAIL");
  if (c.P2 >= 3 || hookFail) return "MEDIUM";
  return "LOW";
}

function buildCreativeRetentionRiskReport(analysis, opts = {}) {
  const { input, hookReport, beatReport, rhythmReport } = analysis;
  const findings = opts.findings || analysis.findings;
  const open = findings.filter(isOpen);
  const dim = (list) => countBySeverity(list);
  const watchFindings = opts.watchReport ? opts.watchReport.findings.filter((f) => !analysis.findings.some((a) => a.findingId === f.findingId)) : [];
  const report = {
    kind: "CREATIVE_RETENTION_RISK",
    version: "1.0.0",
    policyVersion: policy.POLICY_VERSION,
    projectId: input.projectId,
    inputFingerprint: input.inputFingerprint,
    assessmentKind: "PRE_PUBLISH_CREATIVE_RETENTION_RISK",
    actualRetentionStatus: "NOT_AVAILABLE_PRE_PUBLISH",
    actualRetention: null,
    terminology: contract.TERMINOLOGY,
    riskLevel: riskLevelOf(findings, hookReport),
    openFindingCounts: countBySeverity(findings),
    dimensions: {
      hook: { checkpointVerdicts: Object.fromEntries(hookReport.checkpoints.map((c) => [c.checkpoint, c.verdict])), open: dim(hookReport.findings) },
      narrativeBeats: { open: dim(beatReport.findings), loops: { opened: beatReport.metrics.loopsOpened, resolved: beatReport.metrics.loopsResolved, deferred: beatReport.metrics.loopsDeferred, dropped: beatReport.metrics.loopsDropped } },
      visualRhythm: { open: dim(rhythmReport.findings), metrics: { shotCount: rhythmReport.metrics.shotCount, medianMs: rhythmReport.metrics.medianMs, staticShare: rhythmReport.metrics.staticShare } },
      multimodal: { open: dim(watchFindings) },
    },
    drivers: open.filter((f) => ["P0", "P1", "P2"].includes(f.severity)).map((f) => ({ findingId: f.findingId, code: f.code, severity: f.severity, scope: f.scope, status: f.status, reason: f.reason })),
    futureAnalyticsVocabulary: ["INTRO", "TOP_MOMENTS", "SPIKES", "DIPS"],
    analyticsAnchors: {
      hookCheckpointIds: hookReport.checkpoints.map((c) => c.checkpointId),
      beatIds: input.beats.map((b) => b.beatId),
      sceneIds: analysis.fingerprint.anchors.sceneIds,
      shotIds: analysis.fingerprint.anchors.shotIds,
      fingerprintHash: analysis.fingerprint.fingerprintHash,
    },
    reportRefs: { hook: "HOOK_QUALITY", beats: "NARRATIVE_BEAT_QUALITY", rhythm: "VISUAL_RHYTHM", watch: opts.watchReport ? opts.watchReport.watchId : null },
  };
  assertNoFabricatedRetention(report);
  return report;
}

/** Map a future analytics time (ms) onto stable creative anchors (Phase 10 handoff; no analytics ingested). */
function anchorsAt(analysis, startMs, endMs = startMs + 1) {
  const o = (a, b) => Math.min(b, endMs) - Math.max(a, startMs) > 0;
  return {
    hookCheckpoints: analysis.hookReport.checkpoints.filter((c) => o(c.startMs, c.endMs)).map((c) => c.checkpointId),
    beatIds: analysis.input.beats.filter((b) => o(b.startMs, b.endMs)).map((b) => b.beatId),
    shotIds: analysis.input.shots.filter((s) => o(s.startMs, s.endMs)).map((s) => s.shotId),
  };
}

/** FULL_WATCH or SEGMENT_REWATCH over an analysis; returns the watch report + rolled-up risk. */
function runWatch(analysis, opts = {}) {
  const w = watch.runWatchPass({
    input: analysis.input, beatReport: analysis.beatReport, hookReport: analysis.hookReport, rhythmReport: analysis.rhythmReport, ...opts,
  });
  const merged = dedupeFindings([...analysis.findings, ...w.findings]);
  const risk = buildCreativeRetentionRiskReport(analysis, { findings: opts.mode === "SEGMENT_REWATCH" ? w.findings : merged, watchReport: w });
  return { watchReport: w, riskReport: risk, findings: merged };
}

/** A stored report is stale when the CreativeInput fingerprint moved on (no stale PASS). */
function checkReportStale(report, currentInput) {
  if (!report || !currentInput) return { stale: true, reason: "MISSING_INPUT" };
  if (report.inputFingerprint !== currentInput.inputFingerprint) {
    return { stale: true, reason: "INPUT_FINGERPRINT_CHANGED", reportFingerprint: report.inputFingerprint, currentFingerprint: currentInput.inputFingerprint };
  }
  return { stale: false };
}

function persistCreativeArtifacts(root, projectId, artifacts) {
  const written = [];
  for (const [key, rel] of Object.entries(ARTIFACT_FILES)) {
    const doc = artifacts[key];
    if (!doc) continue;
    assertNoFabricatedRetention(doc);
    const text = JSON.stringify(doc, null, 2) + "\n";
    artifactStore.writeArtifactAtomic(root, projectId, rel, text);
    written.push(rel);
  }
  return { ok: true, written };
}

function loadCreativeArtifact(root, projectId, key) {
  const rel = ARTIFACT_FILES[key];
  if (!rel || !artifactStore.artifactExists(root, projectId, rel)) return null;
  return JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8"));
}

module.exports = {
  ARTIFACT_FILES,
  contract, policy, input: inputLib, beats, hook, rhythm, watch, repair, adapter,
  analyzeCreativeRetention, buildCreativeRetentionRiskReport, anchorsAt, runWatch, checkReportStale,
  persistCreativeArtifacts, loadCreativeArtifact,
};
