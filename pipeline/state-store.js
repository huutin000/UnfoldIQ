"use strict";
// pipeline/state-store.js — STEP-13 Branch A.
// Durable pipeline state at projects/<id>/pipeline/state.json.
// Plain Node.js CommonJS, no network, no AI. Deterministic.

var fs = require("fs");
var path = require("path");
var artifactStore = require("../providers/runtime/artifact-store.js");
var renderErrors = require("../lib/render-errors.js");

var STATE_VERSION = "1.0.0";
var STATE_REL = "pipeline/state.json";
var STATE_PREV_REL = "pipeline/state.prev.json";

var STATUSES = [
  "NEW",
  "PREPARING",
  "READY_TO_RENDER",
  "RENDERING",
  "RENDER_INTERRUPTED",
  "RENDERED",
  "QA_RUNNING",
  "QA_REVIEW_REQUIRED",
  "FIX_REQUIRED",
  "RE_RENDERING",
  "FINAL_RENDER_READY",
  "BLOCKED",
  "CANCELLED",
  "FAILED"
];

var STAGES = [
  "VALIDATE_INPUTS",
  "STAGE_ASSETS",
  "BUILD_RENDER_PLAN",
  "PRE_RENDER_QA",
  "RENDER",
  "POST_RENDER_TECHNICAL_QA",
  "GENERATE_VISUAL_QA_EVIDENCE",
  "VISUAL_QA",
  "FIX_CLASSIFICATION",
  "AUTO_FIX",
  "RE_RENDER",
  "FINAL_ACCEPTANCE"
];

// Allowlist of legal status transitions. Missing key = terminal (no outgoing).
var TRANSITIONS = {
  NEW: ["PREPARING", "CANCELLED", "FAILED"],
  PREPARING: ["READY_TO_RENDER", "BLOCKED", "CANCELLED", "FAILED"],
  READY_TO_RENDER: ["RENDERING", "BLOCKED", "CANCELLED", "FAILED"],
  RENDERING: ["RENDER_INTERRUPTED", "RENDERED", "FAILED", "CANCELLED"],
  RENDER_INTERRUPTED: ["RENDERING", "RE_RENDERING", "CANCELLED", "FAILED"],
  RENDERED: ["QA_RUNNING", "BLOCKED", "CANCELLED", "FAILED"],
  QA_RUNNING: ["QA_REVIEW_REQUIRED", "FIX_REQUIRED", "FINAL_RENDER_READY", "BLOCKED", "FAILED"],
  QA_REVIEW_REQUIRED: ["FIX_REQUIRED", "RE_RENDERING", "FINAL_RENDER_READY", "QA_RUNNING", "BLOCKED", "CANCELLED"],
  FIX_REQUIRED: ["RE_RENDERING", "BLOCKED", "CANCELLED", "FAILED"],
  RE_RENDERING: ["RENDERING", "RENDERED", "FAILED", "CANCELLED"],
  FINAL_RENDER_READY: [],
  BLOCKED: ["PREPARING", "READY_TO_RENDER", "FIX_REQUIRED", "RE_RENDERING", "CANCELLED", "FAILED"],
  CANCELLED: [],
  FAILED: ["PREPARING", "RE_RENDERING", "CANCELLED"]
};

// Attempt fields updateAttempt is allowed to touch. Everything else is
// append-only history: old attempt fields (ids, hashes, config, output path)
// must never be rewritten after creation.
var MUTABLE_ATTEMPT_KEYS = [
  "status",
  "progress",
  "endedAt",
  "error",
  "technicalQa",
  "visualQa",
  "fixPlan",
  "artifacts"
];

var _ajv = null;
var _stateValidator = null;

function nowIso() {
  return new Date().toISOString();
}

function assertProjectId(projectId) {
  if (typeof projectId !== "string" || projectId.length === 0 ||
      projectId.indexOf("/") !== -1 || projectId.indexOf("\\") !== -1 ||
      projectId === "." || projectId === ".." || projectId.indexOf("..") !== -1) {
    throw new Error("PATH_TRAVERSAL_BLOCKED: invalid projectId: " + String(projectId));
  }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Recursively drop keys that look like secrets before persisting.
function stripSecrets(value) {
  if (Array.isArray(value)) {
    return value.map(stripSecrets);
  }
  if (value && typeof value === "object") {
    var out = {};
    for (var k of Object.keys(value)) {
      if (/secret|token|apikey/i.test(k)) continue;
      out[k] = stripSecrets(value[k]);
    }
    return out;
  }
  return value;
}

function newSkeleton(projectId) {
  var now = nowIso();
  return {
    version: STATE_VERSION,
    projectId: projectId,
    createdAt: now,
    updatedAt: now,
    status: "NEW",
    currentStage: null,
    inputFingerprint: null,
    checkpoints: {},
    attempts: [],
    qa: null,
    issues: [],
    blockers: [],
    history: [{ at: now, event: "STATE_INITIALIZED" }]
  };
}

function stateAbs(projectRoot, projectId) {
  // Throws PATH_TRAVERSAL_BLOCKED on traversal/escape.
  assertProjectId(projectId);
  return artifactStore.resolveProjectPath(projectRoot, projectId, STATE_REL).abs;
}

function getValidator() {
  if (_stateValidator) return _stateValidator;
  var Ajv = require("ajv");
  var addFormats = require("ajv-formats");
  _ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(_ajv);
  var schemaPath = path.join(__dirname, "..", "schemas", "pipeline-state.schema.json");
  var schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  _stateValidator = _ajv.compile(schema);
  return _stateValidator;
}

function assertValid(state) {
  var validate = getValidator();
  var ok = validate(state);
  if (!ok) {
    throw renderErrors.make(
      "RENDER_PROP_INVALID",
      "pipeline state failed schema validation: " + _ajv.errorsText(validate.errors),
      { projectId: state && state.projectId }
    );
  }
}

// Missing file -> NEW skeleton (not persisted until first saveState).
function loadState(projectRoot, projectId) {
  var abs = stateAbs(projectRoot, projectId);
  var raw;
  try {
    raw = fs.readFileSync(abs, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") return newSkeleton(projectId);
    throw e;
  }
  return JSON.parse(raw);
}

// Validate (Ajv, lazy require), stamp updatedAt, back up previous revision to
// pipeline/state.prev.json, then atomic tmp+rename write.
function saveState(projectRoot, projectId, state) {
  var clean = stripSecrets(clone(state));
  clean.updatedAt = nowIso();
  assertValid(clean);
  var abs = stateAbs(projectRoot, projectId);
  artifactStore.ensureDir(path.dirname(abs));
  try {
    var prev = fs.readFileSync(abs, "utf8");
    artifactStore.writeArtifactAtomic(projectRoot, projectId, STATE_PREV_REL, prev);
  } catch (e) {
    if (!e || e.code !== "ENOENT") throw e;
  }
  artifactStore.writeArtifactAtomic(projectRoot, projectId, STATE_REL, JSON.stringify(clean, null, 2));
  // Reflect persisted shape back to caller.
  for (var k of Object.keys(clean)) state[k] = clean[k];
  for (var k2 of Object.keys(state)) {
    if (!Object.prototype.hasOwnProperty.call(clean, k2)) delete state[k2];
  }
  return state;
}

function appendHistory(state, event, detail) {
  var entry = { at: nowIso(), event: String(event) };
  if (detail !== undefined) entry.detail = detail;
  state.history.push(entry);
  return state;
}

function transition(projectRoot, projectId, to, event, detail) {
  var state = loadState(projectRoot, projectId);
  var allowed = TRANSITIONS[state.status] || [];
  if (allowed.indexOf(to) === -1) {
    throw new Error("INVALID_PIPELINE_TRANSITION: " + state.status + " -> " + to);
  }
  state.status = to;
  appendHistory(state, event || ("TRANSITION_" + to), detail);
  return saveState(projectRoot, projectId, state);
}

function setCheckpoint(state, name, checkpoint) {
  state.checkpoints[String(name)] = checkpoint;
  return state;
}

function addAttempt(state, attempt) {
  state.attempts.push(clone(attempt));
  return state;
}

function updateAttempt(state, attemptId, patch) {
  var found = null;
  for (var a of state.attempts) {
    if (a && a.attemptId === attemptId) { found = a; break; }
  }
  if (!found) throw new Error("ATTEMPT_NOT_FOUND: " + attemptId);
  patch = patch && typeof patch === "object" ? patch : {};
  for (var k of Object.keys(patch)) {
    if (MUTABLE_ATTEMPT_KEYS.indexOf(k) === -1) {
      throw new Error("IMMUTABLE_ATTEMPT_FIELD: " + k);
    }
  }
  for (var k2 of Object.keys(patch)) found[k2] = clone(patch[k2]);
  return found;
}

function setQa(state, kind, qaDoc) {
  if (kind !== "technical" && kind !== "visual") {
    throw new Error("UNKNOWN_QA_KIND: " + kind);
  }
  state.qa = Object.assign({}, state.qa || {});
  state.qa[kind] = qaDoc;
  return state;
}

function addIssue(state, issue) {
  state.issues.push(issue);
  return state;
}

function addBlocker(state, blocker) {
  state.blockers.push(blocker);
  return state;
}

module.exports = {
  STATE_VERSION: STATE_VERSION,
  STATUSES: STATUSES,
  STAGES: STAGES,
  TRANSITIONS: TRANSITIONS,
  MUTABLE_ATTEMPT_KEYS: MUTABLE_ATTEMPT_KEYS,
  loadState: loadState,
  saveState: saveState,
  transition: transition,
  appendHistory: appendHistory,
  setCheckpoint: setCheckpoint,
  addAttempt: addAttempt,
  updateAttempt: updateAttempt,
  setQa: setQa,
  addIssue: addIssue,
  addBlocker: addBlocker
};
