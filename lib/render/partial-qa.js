"use strict";
// lib/render/partial-qa.js — Phase 5B (5.3): QA dependency registry +
// PartialQAPlan + QA-result cache + stale-PASS protection. Executes range
// checks by reusing lib/render/qc.js detectors and probe.js passes on chunk
// files; global invariants always run on the final artifact (RULE 15).

var renderCache = require("../render-cache/index.js");
var qc = require("./qc.js");

var VERSION = "1.0.0";

// QA rule dependency contract (spec §34). contextBefore/After in frames.
// invalidatedBy: fingerprint keys whose change dirties cached results.
var QA_RULES = {
  black: { version: "1.0.0", scope: "LOCALIZABLE", dependsOn: ["chunkBytes"], contextBeforeFrames: 0, contextAfterFrames: 0, invalidatedBy: ["timeline", "renderInput", "renderPlan"], cacheable: true },
  freeze: { version: "1.0.0", scope: "LOCALIZABLE", dependsOn: ["chunkBytes"], contextBeforeFrames: 0, contextAfterFrames: 0, invalidatedBy: ["timeline", "renderInput", "renderPlan"], cacheable: true },
  silence: { version: "1.0.0", scope: "LOCALIZABLE", dependsOn: ["chunkBytes", "finalAudio"], contextBeforeFrames: 0, contextAfterFrames: 0, invalidatedBy: ["audioMix", "timeline"], cacheable: true },
  volume: { version: "1.0.0", scope: "LOCALIZABLE", dependsOn: ["chunkBytes", "finalAudio"], contextBeforeFrames: 0, contextAfterFrames: 0, invalidatedBy: ["audioMix"], cacheable: true },
  safeZone: { version: "1.0.0", scope: "LOCALIZABLE", dependsOn: ["layoutRects", "profileZones"], contextBeforeFrames: 0, contextAfterFrames: 0, invalidatedBy: ["timeline", "platformProfile", "renderPlan"], cacheable: true },
  captions: { version: "1.0.0", scope: "LOCALIZABLE", dependsOn: ["captionEvents", "safeZone"], contextBeforeFrames: 5, contextAfterFrames: 5, invalidatedBy: ["captions", "platformProfile"], cacheable: true },
  duplicates: { version: "1.0.0", scope: "BOUNDARY_SENSITIVE", dependsOn: ["timelineItems"], contextBeforeFrames: 0, contextAfterFrames: 0, invalidatedBy: ["timeline", "renderInput"], cacheable: true },
  avSync: { version: "1.0.0", scope: "BOUNDARY_SENSITIVE", dependsOn: ["videoStream", "finalAudio"], contextBeforeFrames: 15, contextAfterFrames: 15, invalidatedBy: ["audioMix", "timeline"], cacheable: true },
  flash: { version: "1.0.0", scope: "BOUNDARY_SENSITIVE", dependsOn: ["luma"], contextBeforeFrames: 30, contextAfterFrames: 30, invalidatedBy: ["timeline", "renderInput", "motionPlan"], cacheable: true },
  outro: { version: "1.0.0", scope: "LOCALIZABLE", dependsOn: ["tailFrames"], contextBeforeFrames: 0, contextAfterFrames: 0, invalidatedBy: ["timeline"], cacheable: true },
  decode: { version: "1.0.0", scope: "GLOBAL_MANDATORY", dependsOn: ["finalBytes"], contextBeforeFrames: 0, contextAfterFrames: 0, invalidatedBy: ["*"], cacheable: false },
  duration: { version: "1.0.0", scope: "GLOBAL_MANDATORY", dependsOn: ["finalBytes", "canonicalDuration"], contextBeforeFrames: 0, contextAfterFrames: 0, invalidatedBy: ["*"], cacheable: false },
  profile: { version: "1.0.0", scope: "GLOBAL_MANDATORY", dependsOn: ["finalBytes", "exportProfile"], contextBeforeFrames: 0, contextAfterFrames: 0, invalidatedBy: ["*"], cacheable: false },
  audioStream: { version: "1.0.0", scope: "GLOBAL_MANDATORY", dependsOn: ["finalBytes", "finalAudio"], contextBeforeFrames: 0, contextAfterFrames: 0, invalidatedBy: ["*"], cacheable: false },
};

var GLOBAL_MANDATORY = Object.keys(QA_RULES).filter(function (k) { return QA_RULES[k].scope === "GLOBAL_MANDATORY"; });

// Expand a range by rule context handles.
function withContext(range, rule, totalFrames) {
  var before = rule.contextBeforeFrames || 0;
  var after = rule.contextAfterFrames || 0;
  return {
    startFrame: Math.max(0, range.startFrame - before),
    endFrameExclusive: Math.min(totalFrames, range.endFrameExclusive + after),
  };
}

// PartialQAPlan (spec §35).
function planPartialQA(args) {
  args = args || {};
  var dirtyRanges = args.dirtyRanges || [];
  var changedKeys = args.changedKeys || [];
  var totalFrames = args.totalFrames;
  if (!Number.isInteger(totalFrames) || totalFrames <= 0) throw new Error("planPartialQA: totalFrames required");
  var lookup = args.qaLookup || function () { return null; };
  var localChecks = [];
  var boundaryChecks = [];
  var reusedQAResults = [];
  var invalidatedQAResults = [];
  var boundaryRanges = args.boundaryRanges || dirtyRanges;

  Object.keys(QA_RULES).forEach(function (ruleId) {
    var rule = QA_RULES[ruleId];
    if (rule.scope === "GLOBAL_MANDATORY") return;
    var ranges = rule.scope === "BOUNDARY_SENSITIVE" ? boundaryRanges : dirtyRanges;
    var stale = changedKeys.some(function (k) { return rule.invalidatedBy.includes(k); });
    ranges.forEach(function (r) {
      var key = rule.cacheable ? renderCache.qaKey({
        artifactContentHash: (args.artifactHashes && args.artifactHashes[ruleId]) || "pending",
        qaRuleId: ruleId, qaRuleVersion: rule.version,
        analyzerVersion: args.analyzerVersion || qc.QC_VERSION,
        policyVersion: args.policyVersion || null,
        range: withContext(r, rule, totalFrames),
        contextBeforeFrames: rule.contextBeforeFrames, contextAfterFrames: rule.contextAfterFrames,
      }) : null;
      var hit = key ? lookup(key) : null;
      if (hit && hit.status === "HIT_VALID" && !stale) {
        reusedQAResults.push({ qaResultRef: hit.cachedArtifactRef, qaKey: key, qaRuleId: ruleId });
      } else {
        if (hit && hit.status === "HIT_VALID" && stale) {
          invalidatedQAResults.push({ qaResultRef: hit.cachedArtifactRef, reason: "dependency changed: " + changedKeys.filter(function (k) { return rule.invalidatedBy.includes(k); }).join(",") });
        }
        (rule.scope === "BOUNDARY_SENSITIVE" ? boundaryChecks : localChecks).push({
          qaRuleId: ruleId, ranges: [withContext(r, rule, totalFrames)], qaKey: key,
        });
      }
    });
  });

  return {
    version: VERSION,
    changedDependencies: changedKeys.slice(),
    localChecks: localChecks,
    boundaryChecks: boundaryChecks,
    reusedQAResults: reusedQAResults,
    globalChecks: GLOBAL_MANDATORY.slice(),
    invalidatedQAResults: invalidatedQAResults,
  };
}

// Stale-PASS protection (§36): a stored PASS is reusable only if its full
// QAKey still validates (artifact bytes + rule/tool/policy versions +
// range/context) AND current rights state permits.
function isPassReusable(stored, current, opts) {
  opts = opts || {};
  if (!stored || stored.result !== "PASS") return { reusable: false, reason: "QA_RESULT_NOT_PASS" };
  if (!current || !current.qaKey) return { reusable: false, reason: "QA_DEPENDENCY_UNKNOWN" };
  if (stored.qaKey !== current.qaKey) return { reusable: false, reason: "QA_STALE_PASS" };
  if (opts.rightsOk && !opts.rightsOk(stored)) return { reusable: false, reason: "QA_RIGHTS_STALE" };
  return { reusable: true, reason: null };
}

// Final QA coverage (§38): every required rule must be covered by valid
// reuse or a fresh run. Partial QA = partial recomputation, full coverage.
function coverageComplete(qaPlan, freshResults) {
  freshResults = freshResults || [];
  var required = {};
  GLOBAL_MANDATORY.forEach(function (r) { required[r] = "global"; });
  (qaPlan.localChecks || []).forEach(function (c) { required[c.qaRuleId + "@local"] = "local"; });
  (qaPlan.boundaryChecks || []).forEach(function (c) { required[c.qaRuleId + "@boundary"] = "boundary"; });
  var covered = {};
  (qaPlan.reusedQAResults || []).forEach(function (r) { covered[r.qaRuleId || "?"] = true; });
  freshResults.forEach(function (r) { covered[r.qaRuleId] = true; (r.scope ? covered[r.qaRuleId + "@" + r.scope] = true : null); });
  var missing = Object.keys(required).filter(function (k) {
    var base = k.split("@")[0];
    return !covered[k] && !covered[base];
  });
  return { complete: missing.length === 0, missing: missing };
}

module.exports = {
  VERSION: VERSION,
  QA_RULES: QA_RULES,
  GLOBAL_MANDATORY: GLOBAL_MANDATORY,
  withContext: withContext,
  planPartialQA: planPartialQA,
  isPassReusable: isPassReusable,
  coverageComplete: coverageComplete,
};
