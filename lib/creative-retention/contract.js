"use strict";

/**
 * Phase 6A — Creative Retention contracts (UNFOLDIQ CORE).
 *
 * CreativeFinding is the single machine-readable defect shape for Hook /
 * Narrative Beat / Visual Rhythm / Multimodal Watch analysis. Every finding
 * carries where (range/ids), why (reason + reasonClass), evidence, repair
 * class and dependency impact — never a score-only verdict (RULE 15).
 *
 * Terminology guard (RULE 1/2): pre-publish CREATIVE_RETENTION_RISK is not
 * ACTUAL_RETENTION. assertNoFabricatedRetention() rejects any artifact that
 * carries a retention / watch-time number before viewer data exists.
 */

const crypto = require("crypto");

const CONTRACT_VERSION = "1.0.0";

const SEVERITIES = ["P0", "P1", "P2", "P3"];
const SCOPES = ["HOOK", "BEAT", "SCENE", "SHOT", "AUDIO", "CAPTION", "PACKAGING", "GLOBAL"];
const CONFIDENCE = ["LOW", "MEDIUM", "HIGH"];
const STATUSES = ["OPEN", "REPAIRED", "ACCEPTED_INTENTIONAL", "REVIEW_REQUIRED"];

const TERMINOLOGY = Object.freeze({
  ACTUAL_RETENTION: "post-publish viewer data",
  CREATIVE_RETENTION_RISK: "pre-publish structured assessment",
  HOOK_QUALITY: "opening creative assessment",
  BEAT_QUALITY: "narrative progress/payoff assessment",
  VISUAL_RHYTHM: "purposeful temporal variation assessment",
});

// code -> { severity, scope, reasonClass, repairClass }. severity is the
// DEFAULT; detectors may escalate/de-escalate with a recorded reason.
const C = (severity, scope, reasonClass, repairClass) => ({ severity, scope, reasonClass, repairClass });
const FINDING_CATALOG = Object.freeze({
  // ---- Hook (§14)
  HOOK_NO_CLEAR_VALUE: C("P2", "HOOK", "VALUE_ABSENT", "OPENING_EDIT"),
  HOOK_SETUP_TOO_LONG: C("P2", "HOOK", "SETUP_DELAY", "OPENING_EDIT"),
  HOOK_REPEATS_PACKAGING: C("P2", "HOOK", "PACKAGING_ECHO", "OPENING_EDIT"),
  HOOK_PROMISE_DELAYED: C("P3", "HOOK", "PROMISE_LATE", "OPENING_EDIT"),
  HOOK_PROMISE_MISMATCH: C("P1", "PACKAGING", "PROMISE_NOT_DELIVERED", "PACKAGING_REVISION"),
  HOOK_OVERLOADED: C("P2", "HOOK", "OPENING_DENSITY", "SCRIPT_TRIM"),
  HOOK_CONFUSING: C("P2", "HOOK", "SUBJECT_UNCLEAR", "OPENING_EDIT"),
  HOOK_NO_FORWARD_QUESTION: C("P3", "HOOK", "NO_ANTICIPATION", "OPENING_EDIT"),
  HOOK_TOO_MANY_OPEN_LOOPS: C("P2", "HOOK", "OPEN_LOOP_OVERLOAD", "OPENING_EDIT"),
  HOOK_PAYOFF_GIVEN_TOO_EARLY: C("P2", "HOOK", "EARLY_PAYOFF", "OPENING_EDIT"),
  PACKAGING_PROMISE_DELAYED: C("P1", "PACKAGING", "PROMISE_LATE", "OPENING_EDIT"),
  // ---- Narrative beats (§15–§21)
  BEAT_NO_PROGRESS: C("P2", "BEAT", "NO_PROGRESS", "SCRIPT_TRIM"),
  BEAT_TOO_LONG: C("P2", "BEAT", "DURATION_EXCESS", "BEAT_RETIME_OR_SPLIT"),
  BEAT_TOO_SHORT: C("P3", "BEAT", "DURATION_DEFICIT", "BEAT_RETIME_OR_SPLIT"),
  DROPPED_PAYOFF: C("P2", "BEAT", "LOOP_NEVER_RESOLVED", "SCRIPT_REWRITE"),
  NARRATIVE_REDUNDANCY: C("P2", "BEAT", "SEMANTIC_REPEAT", "SCRIPT_TRIM"),
  DEAD_TIME_RISK: C("P2", "BEAT", "NO_USEFUL_CONTENT", "BEAT_RETIME_OR_SPLIT"),
  // ---- Visual rhythm (§22–§29)
  VISUAL_TOO_REPETITIVE: C("P2", "GLOBAL", "DURATION_PATTERN", "VISUAL_TIMING_PATCH"),
  MOTION_TOO_REPETITIVE: C("P2", "SHOT", "MOTION_PATTERN", "MOTION_PATCH"),
  REPETITIVE_MOTION_RHYTHM: C("P2", "SHOT", "MOTION_PATTERN", "MOTION_PATCH"),
  MOTION_WITHOUT_EDITORIAL_VALUE: C("P3", "SHOT", "MOTION_PURPOSE_ABSENT", "MOTION_PATCH"),
  FRAMING_REPETITION: C("P3", "SHOT", "FRAMING_PATTERN", "FRAMING_LAYOUT_PATCH"),
  MODALITY_MONOTONY: C("P3", "GLOBAL", "MODALITY_PATTERN", "ASSET_MODALITY_REPLACE"),
  UNNECESSARY_GENERATIVE_MOTION: C("P3", "SHOT", "GENERATIVE_NOT_NEEDED", "ASSET_MODALITY_REPLACE"),
  // ---- Audio / caption rhythm (§30–§31)
  MUSIC_ENERGY_MISMATCH: C("P2", "AUDIO", "ENERGY_MISMATCH", "MUSIC_MIX_PATCH"),
  OVER_SCORED_SECTION: C("P3", "AUDIO", "ENERGY_EXCESS", "MUSIC_MIX_PATCH"),
  UNDER_SCORED_PAYOFF: C("P3", "AUDIO", "ENERGY_DEFICIT", "MUSIC_MIX_PATCH"),
  SFX_DISTRACTION: C("P3", "AUDIO", "SFX_DENSITY", "MUSIC_MIX_PATCH"),
  CAPTION_MOTION_OVERLOAD: C("P2", "CAPTION", "READING_LOAD", "CAPTION_MOTION_REDUCTION"),
  // ---- Multimodal watch (§32–§37)
  OPENING_PROMISE_WEAK: C("P2", "HOOK", "PROMISE_NOT_ESTABLISHED", "OPENING_EDIT"),
  OPENING_TOO_SLOW: C("P2", "HOOK", "SETUP_DELAY", "OPENING_EDIT"),
  OPENING_OVERLOADED: C("P2", "HOOK", "OPENING_DENSITY", "SCRIPT_TRIM"),
  AUDIO_VISUAL_ENERGY_MISMATCH: C("P2", "SCENE", "ENERGY_MISMATCH", "MOTION_PATCH"),
  MULTIMODAL_REDUNDANCY: C("P3", "SCENE", "CHANNEL_REPEAT", "CHANNEL_DEDUP"),
  MULTIMODAL_CONTRADICTION: C("P1", "SCENE", "CHANNEL_CONFLICT", "TECHNICAL_QC_ROUTE"),
  MULTIMODAL_COGNITIVE_OVERLOAD: C("P2", "SCENE", "CHANNEL_LOAD", "COGNITIVE_LOAD_REDUCTION"),
  PAYOFF_UNDER_EMPHASIZED: C("P2", "BEAT", "EMPHASIS_DEFICIT", "PAYOFF_EMPHASIS_PATCH"),
  TRANSITION_CREATIVE_BREAK: C("P3", "SCENE", "TRANSITION_MISMATCH", "TRANSITION_PATCH"),
  OUTRO_LOSES_MOMENTUM: C("P3", "BEAT", "OUTRO_ENERGY_LOSS", "SCRIPT_TRIM"),
  // ---- Cross-source
  MODEL_DISAGREEMENT: C("P2", "GLOBAL", "EVIDENCE_CONFLICT", "REVIEW_ONLY"),
  CREATIVE_REPAIR_BUDGET_EXHAUSTED: C("P2", "GLOBAL", "BUDGET_EXHAUSTED", "REVIEW_ONLY"),
});

function sha16(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex").slice(0, 16);
}

/**
 * Build a validated CreativeFinding. Throws on contract violations so a
 * detector bug can never emit a score-only / unrepairable finding.
 */
function makeFinding(code, extra = {}) {
  const cat = FINDING_CATALOG[code];
  if (!cat) throw new Error(`UNKNOWN_FINDING_CODE:${code}`);
  const severity = extra.severity || cat.severity;
  const scope = extra.scope || cat.scope;
  const repairClass = extra.repairClass || cat.repairClass;
  const reasonClass = extra.reasonClass || cat.reasonClass;
  if (!SEVERITIES.includes(severity)) throw new Error(`INVALID_SEVERITY:${severity}`);
  if (!SCOPES.includes(scope)) throw new Error(`INVALID_SCOPE:${scope}`);
  const confidence = extra.confidence || "MEDIUM";
  if (!CONFIDENCE.includes(confidence)) throw new Error(`INVALID_CONFIDENCE:${confidence}`);
  const status = extra.status || "OPEN";
  if (!STATUSES.includes(status)) throw new Error(`INVALID_STATUS:${status}`);
  if (!extra.reason || typeof extra.reason !== "string") throw new Error(`FINDING_WITHOUT_REASON:${code}`);
  if (!Array.isArray(extra.evidenceRefs) || extra.evidenceRefs.length === 0) throw new Error(`FINDING_WITHOUT_EVIDENCE:${code}`);
  const where = {
    startMs: extra.startMs === undefined ? null : extra.startMs,
    endMs: extra.endMs === undefined ? null : extra.endMs,
    beatId: extra.beatId || null,
    sceneId: extra.sceneId || null,
    shotId: extra.shotId || null,
  };
  return {
    findingId: `cf-${sha16({ code, ...where, key: extra.key || null, reasonClass })}`,
    code,
    severity,
    scope,
    ...(where.startMs !== null ? { startMs: where.startMs } : {}),
    ...(where.endMs !== null ? { endMs: where.endMs } : {}),
    ...(where.beatId ? { beatId: where.beatId } : {}),
    ...(where.sceneId ? { sceneId: where.sceneId } : {}),
    ...(where.shotId ? { shotId: where.shotId } : {}),
    reason: extra.reason,
    reasonClass,
    evidenceRefs: extra.evidenceRefs,
    correctiveAction: extra.correctiveAction || `${repairClass}:${reasonClass}`,
    repairClass,
    confidence,
    status,
    ...(extra.relatedFindingIds ? { relatedFindingIds: extra.relatedFindingIds } : {}),
    ...(extra.checkpoints ? { checkpoints: extra.checkpoints } : {}),
    ...(extra.statusReason ? { statusReason: extra.statusReason } : {}),
    source: extra.source || "DETERMINISTIC",
  };
}

function validateFinding(f) {
  const errors = [];
  if (!f || typeof f !== "object") return { ok: false, errors: ["not an object"] };
  if (!FINDING_CATALOG[f.code]) errors.push(`unknown code ${f.code}`);
  if (!SEVERITIES.includes(f.severity)) errors.push("bad severity");
  if (!SCOPES.includes(f.scope)) errors.push("bad scope");
  if (!CONFIDENCE.includes(f.confidence)) errors.push("bad confidence");
  if (!STATUSES.includes(f.status)) errors.push("bad status");
  if (!f.reason) errors.push("missing reason");
  if (!Array.isArray(f.evidenceRefs) || f.evidenceRefs.length === 0) errors.push("missing evidenceRefs");
  if (!f.correctiveAction) errors.push("missing correctiveAction");
  if (!f.repairClass) errors.push("missing repairClass");
  if (f.startMs !== undefined && f.endMs !== undefined && f.endMs < f.startMs) errors.push("endMs < startMs");
  return { ok: errors.length === 0, errors };
}

function dedupeFindings(findings) {
  const byId = new Map();
  for (const f of findings) {
    const prev = byId.get(f.findingId);
    if (!prev) byId.set(f.findingId, f);
    else if (SEVERITIES.indexOf(f.severity) < SEVERITIES.indexOf(prev.severity)) byId.set(f.findingId, f);
  }
  return [...byId.values()];
}

function countBySeverity(findings, { openOnly = true } = {}) {
  const out = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of findings) {
    if (openOnly && !(f.status === "OPEN" || f.status === "REVIEW_REQUIRED")) continue;
    out[f.severity] += 1;
  }
  return out;
}

// ---- Terminology guard (RULE 1/2, case AD)
const RETENTION_KEY = /(retention|watch[_-]?time|view[_-]?duration|avg[_-]?view)/i;
const RETENTION_CLAIM = /(predicted|estimated|expected|forecast(ed)?|projected)\s+(youtube\s+)?(audience\s+)?(retention|watch[\s-]?time|average view duration)[^.\n]{0,24}?\d+(\.\d+)?\s*(%|percent|s\b|sec|min)/i;
const BARE_PERCENT_RETENTION = /\b(retention|watch[\s-]?time)\b[^.\n]{0,12}[=:≈~]\s*\d+(\.\d+)?\s*%/i;

/** Returns violations; empty array means no fabricated retention claim. */
function findFabricatedRetention(value, pathStr = "$") {
  const out = [];
  if (value === null || value === undefined) return out;
  if (typeof value === "string") {
    if (RETENTION_CLAIM.test(value) || BARE_PERCENT_RETENTION.test(value)) out.push({ path: pathStr, kind: "RETENTION_CLAIM_TEXT", sample: value.slice(0, 80) });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...findFabricatedRetention(v, `${pathStr}[${i}]`)));
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (RETENTION_KEY.test(k) && typeof v === "number") out.push({ path: `${pathStr}.${k}`, kind: "RETENTION_NUMBER", sample: String(v) });
      out.push(...findFabricatedRetention(v, `${pathStr}.${k}`));
    }
  }
  return out;
}

function assertNoFabricatedRetention(value) {
  const v = findFabricatedRetention(value);
  if (v.length > 0) {
    const e = new Error(`ACTUAL_RETENTION_FABRICATED: ${v.map((x) => x.path).join(", ")}`);
    e.code = "ACTUAL_RETENTION_FABRICATED";
    e.violations = v;
    throw e;
  }
  return true;
}

module.exports = {
  CONTRACT_VERSION, SEVERITIES, SCOPES, CONFIDENCE, STATUSES, TERMINOLOGY, FINDING_CATALOG,
  sha16, makeFinding, validateFinding, dedupeFindings, countBySeverity,
  findFabricatedRetention, assertNoFabricatedRetention,
};
