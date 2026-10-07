"use strict";

/**
 * Phase 1H.3 — Recovery: idempotent operations, checkpoints, resume.
 * (UNFOLDIQ CORE. Dependency DAG lives in lib/dependency-dag/.)
 *
 * One canonical operation identity: idempotencyKey + inputFingerprint
 * (hash of canonical input — never timestamps alone). Same key + same
 * input replays the original outcome with zero duplicate side effects;
 * same key + changed input fails closed (IDEMPOTENCY_CONFLICT).
 *
 * Retry layering rule (§43): Core recovery is the ONLY owner that repeats a
 * MUTATING action. Bridge/extension/provider retries are transport-only
 * (1G semantics: submit-issued record, single-use approvals) and never
 * re-issue a mutation on their own.
 *
 * Stores (atomic JSON, no database):
 *   projects/<pid>/recovery/operations.json
 *   projects/<pid>/recovery/checkpoints.json
 * Checkpoints are forward-only per operation; regression is refused unless
 * a new attempt begins (new operation with parentOperationId lineage).
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const costShared = require("../output-cost/shared.js");
const manifestLib = require("../project-manifest/index.js");
const historyLib = require("../generation-history/index.js");

const RECOVERY_SCHEMA_VERSION = "1.0.0";
const OPS_REL = "recovery/operations.json";
const CHECKPOINTS_REL = "recovery/checkpoints.json";

const OP_STATUS = ["PENDING", "IN_PROGRESS", "WAITING_EXTERNAL", "SUCCEEDED", "FAILED_RETRYABLE", "FAILED_TERMINAL", "UNKNOWN_OUTCOME", "CANCEL_REQUESTED", "CANCELLED", "BLOCKED"];
const TERMINAL_OP = ["SUCCEEDED", "FAILED_TERMINAL", "CANCELLED", "BLOCKED"];

// §9 retry taxonomy. Only RETRYABLE_CLASSES may auto-retry; everything else
// needs a new operation (new attempt) or human/reconcile input.
const FAILURE_CLASSES = ["TRANSIENT_TRANSPORT", "TIMEOUT", "EXTENSION_UNAVAILABLE", "PROVIDER_BUSY", "UNKNOWN_SUBMIT_OUTCOME", "PROVIDER_REJECTED", "DOWNLOAD_FAILED", "IMPORT_FAILED", "QA_FAILED", "STATE_CONFLICT", "LOCKED_TARGET", "NON_RETRYABLE_INPUT", "CANCELLED"];
const RETRYABLE_CLASSES = ["TRANSIENT_TRANSPORT", "TIMEOUT", "EXTENSION_UNAVAILABLE", "PROVIDER_BUSY", "DOWNLOAD_FAILED", "IMPORT_FAILED"];

const STAGES = ["PLANNED", "AUTHORIZED", "SUBMIT_ISSUED", "PROVIDER_ACCEPTED", "RESULT_DETECTED", "DOWNLOADED", "IMPORTED", "QA_COMPLETE", "READY"];
const stageIndex = (s) => STAGES.indexOf(s);

const DEFAULT_RETRY_POLICY = { maxAttempts: 3, maxElapsedMs: 10 * 60 * 1000, baseBackoffMs: 1000, maxBackoffMs: 30000 };

const ERRORS = {
  OPERATION_NOT_FOUND: "unknown operationId",
  IDEMPOTENCY_CONFLICT: "same key, changed payload — fail closed",
  OPERATION_ALREADY_TERMINAL: "terminal operations never change state",
  INVALID_CHECKPOINT_TRANSITION: "checkpoint regression refused without a new attempt",
  CHECKPOINT_CONFLICT: "stale writer on recovery state",
  UNKNOWN_OPERATION_OUTCOME: "external outcome uncertain — reconcile, never blind-retry",
  RETRY_NOT_ALLOWED: "failure class is not safe to retry",
  RETRY_BUDGET_EXHAUSTED: "bounded attempts/elapsed exceeded",
  RECOVERY_STATE_INVALID: "recovery/checkpoint store fails validation",
  RESUME_PLAN_UNAVAILABLE: "no proven state to resume from",
  CANCEL_CONFLICT: "cancel requires a cancellable state or explicit reconcile path",
};

let validators = {};
function validatorFor(kind) {
  if (!validators[kind]) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const root = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "recovery-state.schema.json"), "utf8"));
    const def = kind === "operations" ? "operationsDoc" : "checkpointsDoc";
    validators[kind] = ajv.compile({ ...root, $ref: `#/definitions/${def}` });
  }
  return validators[kind];
}

function nowIso(now) {
  return now || new Date().toISOString();
}

function fingerprintOf(doc) {
  const { fingerprint, ...rest } = doc;
  void fingerprint;
  return costShared.hash16(JSON.parse(costShared.stableStringify(rest)));
}

function scanSecrets(doc) {
  const hits = manifestLib.findSecretKeys(doc);
  const pastes = historyLib.findSecretPastes(doc);
  return [...hits, ...pastes];
}

function validateDoc(kind, doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: [{ code: "RECOVERY_STATE_INVALID", message: "doc must be an object" }] };
  }
  const valid = validatorFor(kind)(doc);
  if (!valid) {
    for (const e of validatorFor(kind).errors || []) {
      errors.push({ code: "RECOVERY_STATE_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
    }
  }
  const secrets = scanSecrets(doc);
  if (secrets.length > 0) {
    errors.push({ code: "RECOVERY_STATE_INVALID", message: `secret material must never persist: ${secrets.join(", ")}` });
  }
  if (errors.length === 0 && doc.fingerprint !== fingerprintOf(doc)) {
    errors.push({ code: "RECOVERY_STATE_INVALID", message: "fingerprint mismatch: mutated outside the canonical path" });
  }
  return { ok: errors.length === 0, errors };
}

function blankDoc(kind, projectId, createdAt) {
  const base = { schemaVersion: RECOVERY_SCHEMA_VERSION, projectId, revision: 1, createdAt, updatedAt: createdAt, fingerprint: null };
  if (kind === "operations") return { ...base, operations: {} };
  return { ...base, checkpoints: {} };
}

function docRel(kind) {
  return kind === "operations" ? OPS_REL : CHECKPOINTS_REL;
}

function loadDoc(kind, root, projectId) {
  const rel = docRel(kind);
  if (!artifactStore.artifactExists(root, projectId, rel)) {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: `${kind} store absent` };
  }
  let raw;
  try {
    raw = JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8"));
  } catch (e) {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: `unparseable ${kind} store: ${String((e && e.message) || e)}` };
  }
  const v = validateDoc(kind, raw);
  if (!v.ok) return { ok: false, code: "RECOVERY_STATE_INVALID", message: v.errors[0].message, errors: v.errors };
  return { ok: true, doc: raw };
}

function saveDoc(kind, root, projectId, doc) {
  const text = JSON.stringify(doc, null, 2) + "\n";
  JSON.parse(text);
  const v = validateDoc(kind, doc);
  if (!v.ok) return { ok: false, code: "RECOVERY_STATE_INVALID", message: v.errors[0].message, errors: v.errors };
  try {
    artifactStore.writeArtifactAtomic(root, projectId, docRel(kind), text);
  } catch (e) {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: `atomic persist failed: ${String((e && e.message) || e)}` };
  }
  return { ok: true };
}

function ensureDoc(kind, root, projectId, opts = {}) {
  const loaded = loadDoc(kind, root, projectId);
  if (loaded.ok) return loaded;
  if (!artifactStore.artifactExists(root, projectId, docRel(kind))) {
    const createdAt = nowIso(opts.now);
    const doc = blankDoc(kind, projectId, createdAt);
    doc.fingerprint = fingerprintOf(doc);
    const saved = saveDoc(kind, root, projectId, doc);
    if (!saved.ok) return saved;
    return { ok: true, doc };
  }
  return loaded;
}

function commitDoc(kind, root, projectId, doc, opts = {}) {
  doc.revision += 1;
  doc.updatedAt = nowIso(opts.now);
  doc.fingerprint = fingerprintOf(doc);
  return saveDoc(kind, root, projectId, doc);
}

function findByKey(doc, idempotencyKey) {
  for (const op of Object.values(doc.operations)) {
    if (op.idempotencyKey === idempotencyKey) return op;
  }
  return null;
}

/**
 * Begin (or replay) an operation. Same key + same input → original outcome,
 * zero new side effects. Same key + changed input → IDEMPOTENCY_CONFLICT.
 * Terminal operations never reopen. FAILED_RETRYABLE with a retriable class
 * resumes in place (attemptCount+1); otherwise a new operation is required.
 */
function beginOperation(root, projectId, input = {}, opts = {}) {
  if (typeof input.idempotencyKey !== "string" || !input.idempotencyKey) {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: "idempotencyKey is required" };
  }
  if (typeof input.operationType !== "string" || !input.operationType) {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: "operationType is required" };
  }
  if (input.input === undefined || input.input === null || typeof input.input !== "object") {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: "input object is required (fingerprint source)" };
  }
  const ensured = ensureDoc("operations", root, projectId, opts);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  if (opts.expectedRevision !== undefined && opts.expectedRevision !== null && doc.revision !== opts.expectedRevision) {
    return { ok: false, code: "CHECKPOINT_CONFLICT", message: `stale writer: expected revision ${opts.expectedRevision}, current is ${doc.revision}` };
  }
  const fp = costShared.hash16(JSON.parse(costShared.stableStringify(input.input)));
  const existing = findByKey(doc, input.idempotencyKey);
  if (existing) {
    if (existing.inputFingerprint !== fp) {
      return { ok: false, code: "IDEMPOTENCY_CONFLICT", message: `${ERRORS.IDEMPOTENCY_CONFLICT}: key ${input.idempotencyKey} already used with different input`, operation: existing };
    }
    if (existing.status === "SUCCEEDED") {
      return { ok: true, operation: existing, duplicate: true, replayedResultRef: existing.resultRef };
    }
    if (existing.status === "IN_PROGRESS" || existing.status === "WAITING_EXTERNAL" || existing.status === "PENDING") {
      return { ok: true, operation: existing, duplicate: true, inFlight: true };
    }
    if (existing.status === "UNKNOWN_OUTCOME") {
      return { ok: true, operation: existing, duplicate: true, mustReconcile: true };
    }
    if (TERMINAL_OP.includes(existing.status)) {
      return { ok: false, code: "OPERATION_ALREADY_TERMINAL", message: `${ERRORS.OPERATION_ALREADY_TERMINAL}: ${existing.status}`, operation: existing };
    }
    // FAILED_RETRYABLE / CANCEL_REQUESTED: resume in place when safe.
    if (existing.status === "FAILED_RETRYABLE") {
      if (!canRetry(existing.failureClass, { reconciledAbsence: existing.reconciledAbsence === true })) {
        return { ok: false, code: "RETRY_NOT_ALLOWED", message: `${ERRORS.RETRY_NOT_ALLOWED}: ${existing.failureClass}`, operation: existing };
      }
      existing.attemptCount += 1;
      existing.status = "IN_PROGRESS";
      existing.updatedAt = nowIso(opts.now);
      const c = commitDoc("operations", root, projectId, doc, opts);
      if (!c.ok) return c;
      return { ok: true, operation: existing, resumed: true };
    }
    return { ok: false, code: "OPERATION_ALREADY_TERMINAL", message: `state ${existing.status} cannot begin again`, operation: existing };
  }
  const createdAt = nowIso(opts.now);
  const op = {
    operationId: costShared.id12("op", { project: projectId, key: input.idempotencyKey, at: createdAt }),
    projectId,
    runId: input.runId || null,
    jobId: input.jobId || null,
    attemptId: input.attemptId || null,
    artifactId: input.artifactId || null,
    operationType: input.operationType,
    idempotencyKey: input.idempotencyKey,
    inputFingerprint: fp,
    status: "PENDING",
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
    resultRef: null,
    errorCode: null,
    failureClass: null,
    attemptCount: 1,
    parentOperationId: input.parentOperationId || null,
    retryDecisionRef: input.retryDecisionRef || null,
    generationId: input.generationId || null,
    cancelReason: null,
  };
  doc.operations[op.operationId] = op;
  const c = commitDoc("operations", root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, operation: op, changed: true };
}

function getOperation(root, projectId, operationId) {
  const loaded = loadDoc("operations", root, projectId);
  if (!loaded.ok) {
    if (!artifactStore.artifactExists(root, projectId, OPS_REL)) {
      return { ok: false, code: "OPERATION_NOT_FOUND", message: "no operations store: no proven state" };
    }
    return loaded;
  }
  const op = loaded.doc.operations[operationId];
  if (!op) return { ok: false, code: "OPERATION_NOT_FOUND", message: ERRORS.OPERATION_NOT_FOUND };
  return { ok: true, operation: op };
}

/**
 * Move operation state. Terminal states are final. SUCCEEDED requires a
 * resultRef (the persisted outcome needed for replay). FAILED_* requires a
 * taxonomy failureClass.
 */
function transitionOperation(root, projectId, operationId, to, opts = {}) {
  const loaded = loadDoc("operations", root, projectId);
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;
  if (opts.expectedRevision !== undefined && opts.expectedRevision !== null && doc.revision !== opts.expectedRevision) {
    return { ok: false, code: "CHECKPOINT_CONFLICT", message: `stale writer: expected revision ${opts.expectedRevision}, current is ${doc.revision}` };
  }
  const op = doc.operations[operationId];
  if (!op) return { ok: false, code: "OPERATION_NOT_FOUND", message: ERRORS.OPERATION_NOT_FOUND };
  if (TERMINAL_OP.includes(op.status)) {
    return { ok: false, code: "OPERATION_ALREADY_TERMINAL", message: `${ERRORS.OPERATION_ALREADY_TERMINAL}: ${op.status}`, operation: op };
  }
  if (!OP_STATUS.includes(to)) {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: `unknown status ${to}` };
  }
  if (to === "SUCCEEDED" && (typeof opts.resultRef !== "string" || !opts.resultRef)) {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: "SUCCEEDED requires a resultRef (replay outcome)" };
  }
  if ((to === "FAILED_RETRYABLE" || to === "FAILED_TERMINAL") && !FAILURE_CLASSES.includes(opts.failureClass)) {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: `failureClass must be ${FAILURE_CLASSES.join("|")}` };
  }
  if (op.status === "CANCEL_REQUESTED" && to !== "CANCELLED" && to !== "UNKNOWN_OUTCOME") {
    return { ok: false, code: "CANCEL_CONFLICT", message: "cancel-requested operations only confirm cancel (or reconcile to unknown)" };
  }
  op.status = to;
  op.updatedAt = nowIso(opts.now);
  if (TERMINAL_OP.includes(to)) op.completedAt = op.updatedAt;
  if (opts.resultRef !== undefined) op.resultRef = opts.resultRef;
  if (opts.errorCode !== undefined) op.errorCode = opts.errorCode;
  if (opts.failureClass !== undefined) op.failureClass = opts.failureClass;
  if (opts.reconciledAbsence === true) op.reconciledAbsence = true;
  if (opts.cancelReason !== undefined) op.cancelReason = opts.cancelReason;
  const c = commitDoc("operations", root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, operation: op, changed: true };
}

function lastCheckpointStage(root, projectId, operationId) {
  const loaded = loadDoc("checkpoints", root, projectId);
  if (!loaded.ok) return null;
  const list = loaded.doc.checkpoints[operationId] || [];
  let lastKnown = null;
  for (const cp of list) {
    if (stageIndex(cp.stage) >= 0) lastKnown = cp.stage;
  }
  return lastKnown;
}

/**
 * Record a proven milestone. Forward-only among known STAGES: regression
 * (e.g. IMPORTED → SUBMIT_ISSUED) is refused unless a new attempt begins.
 * Unknown custom stages are recorded but do not move the known pointer.
 */
function checkpoint(root, projectId, operationId, input = {}, opts = {}) {
  if (typeof input.stage !== "string" || !input.stage) {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: "stage is required" };
  }
  const opsLoaded = loadDoc("operations", root, projectId);
  if (!opsLoaded.ok) return opsLoaded;
  if (!opsLoaded.doc.operations[operationId]) {
    return { ok: false, code: "OPERATION_NOT_FOUND", message: ERRORS.OPERATION_NOT_FOUND };
  }
  const ensured = ensureDoc("checkpoints", root, projectId, opts);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  if (opts.expectedRevision !== undefined && opts.expectedRevision !== null) {
    const rev = checkpointRevision(root, projectId);
    if (rev !== opts.expectedRevision) {
      return { ok: false, code: "CHECKPOINT_CONFLICT", message: `stale writer: expected revision ${opts.expectedRevision}, current is ${rev}` };
    }
  }
  const list = doc.checkpoints[operationId] || [];
  const idx = stageIndex(input.stage);
  if (idx >= 0) {
    let lastIdx = -1;
    for (const cp of list) {
      const i = stageIndex(cp.stage);
      if (i >= 0 && i > lastIdx) lastIdx = i;
    }
    if (idx < lastIdx) {
      return { ok: false, code: "INVALID_CHECKPOINT_TRANSITION", message: `${ERRORS.INVALID_CHECKPOINT_TRANSITION}: ${input.stage} after ${STAGES[lastIdx]} (start a new attempt for rework)` };
    }
    if (idx === lastIdx) {
      const last = list[list.length - 1];
      if (last && last.stage === input.stage && (last.stateRef || null) === (input.stateRef || null)) {
        return { ok: true, checkpoints: list, changed: false, deduped: true };
      }
    }
  }
  list.push({ stage: input.stage, at: nowIso(opts.now), note: input.note || null, stateRef: input.stateRef || null });
  doc.checkpoints[operationId] = list;
  const c = commitDoc("checkpoints", root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, checkpoints: list, changed: true };
}

function checkpointRevision(root, projectId) {
  const loaded = loadDoc("checkpoints", root, projectId);
  return loaded.ok ? loaded.doc.revision : null;
}

function checkpointsFor(root, projectId, operationId) {
  const loaded = loadDoc("checkpoints", root, projectId);
  if (!loaded.ok) return loaded;
  return { ok: true, checkpoints: loaded.doc.checkpoints[operationId] || [] };
}

/**
 * Deterministic resume planner: proven state → next safe action.
 * Never returns "restart from zero" when proven checkpoints exist.
 * Cancelled operations require a NEW operation (no auto-resume).
 */
function planResume(root, projectId, operationId, context = {}) {
  if (!artifactStore.artifactExists(root, projectId, OPS_REL)) {
    return { ok: false, code: "RESUME_PLAN_UNAVAILABLE", message: ERRORS.RESUME_PLAN_UNAVAILABLE };
  }
  const opR = getOperation(root, projectId, operationId);
  if (!opR.ok) return opR;
  const op = opR.operation;
  if (TERMINAL_OP.includes(op.status)) {
    if (op.status === "CANCELLED") {
      return { ok: true, plan: { next: null, finished: false, requiresNewOperation: true, reason: "cancelled operations never auto-resume" } };
    }
    if (op.status === "BLOCKED") {
      return { ok: true, plan: { next: null, finished: false, blockedByLock: true, reason: op.errorCode || "blocked" } };
    }
    return { ok: true, plan: { next: null, finished: true, reason: `terminal ${op.status}` } };
  }
  if (op.status === "UNKNOWN_OUTCOME") {
    return { ok: true, plan: { next: "RECONCILE", finished: false, reason: "external outcome uncertain — reconcile provider/Core evidence first" } };
  }
  if (op.status === "FAILED_RETRYABLE") {
    if (canRetry(op.failureClass, { reconciledAbsence: op.reconciledAbsence === true })) {
      return { ok: true, plan: { next: "RETRY", finished: false, failureClass: op.failureClass, reason: `retriable ${op.failureClass}` } };
    }
    return { ok: true, plan: { next: "NEW_OPERATION", finished: false, reason: `${op.failureClass} needs a new attempt with lineage` } };
  }
  const last = lastCheckpointStage(root, projectId, operationId);
  const NEXT = {
    null: "START", PLANNED: "AUTHORIZE", AUTHORIZED: "SUBMIT", SUBMIT_ISSUED: "AWAIT_ACCEPTANCE",
    PROVIDER_ACCEPTED: "AWAIT_RESULT", RESULT_DETECTED: "DOWNLOAD", DOWNLOADED: "IMPORT",
    IMPORTED: "QA", QA_COMPLETE: "FINALIZE", READY: null,
  };
  if (op.status === "WAITING_EXTERNAL") {
    return { ok: true, plan: { next: "AWAIT_EXTERNAL", finished: false, afterCheckpoint: last, reason: "waiting on external side" } };
  }
  const next = last === "READY" ? null : (NEXT[last === undefined ? "null" : last] || "START");
  if (next === null) {
    return { ok: true, plan: { next: null, finished: true, reason: "READY checkpoint reached" } };
  }
  if (context.lockedTargets && context.lockedTargets.length > 0 && ["SUBMIT", "RETRY"].includes(next)) {
    return { ok: true, plan: { next: null, finished: false, blockedByLock: true, reason: `locked: ${context.lockedTargets.join(",")}` } };
  }
  return { ok: true, plan: { next, finished: false, afterCheckpoint: last, reason: `resume after ${last || "no proven state"}` } };
}

/**
 * Unknown-outcome reconciliation (§8): found → SUCCEEDED reusing the SAME
 * resultRef (zero new side effects); absent → FAILED_RETRYABLE flagged
 * reconciledAbsence (the ONLY path that makes UNKNOWN_SUBMIT_OUTCOME
 * spend-safe to retry). Never blind.
 */
function reconcileUnknownOutcome(root, projectId, operationId, input = {}, opts = {}) {
  const opR = getOperation(root, projectId, operationId);
  if (!opR.ok) return opR;
  const op = opR.operation;
  if (op.status !== "UNKNOWN_OUTCOME") {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: `reconcile requires UNKNOWN_OUTCOME (got ${op.status})`, operation: op };
  }
  if (input.found === true) {
    if (typeof input.resultRef !== "string" || !input.resultRef) {
      return { ok: false, code: "RECOVERY_STATE_INVALID", message: "found=true requires the existing resultRef to reuse" };
    }
    return transitionOperation(root, projectId, operationId, "SUCCEEDED", { ...opts, resultRef: input.resultRef });
  }
  return transitionOperation(root, projectId, operationId, "FAILED_RETRYABLE", { ...opts, failureClass: "UNKNOWN_SUBMIT_OUTCOME", reconciledAbsence: true });
}

function canRetry(failureClass, opts = {}) {
  if (!RETRYABLE_CLASSES.includes(failureClass)) {
    // Reconciled absence is the single spend-safe exception: the provider
    // proved it holds nothing, so the same logical submit may run once.
    if (failureClass === "UNKNOWN_SUBMIT_OUTCOME" && opts.reconciledAbsence === true) return true;
    return false;
  }
  return true;
}

const DEFAULT_POLICY = DEFAULT_RETRY_POLICY;

/**
 * Deterministic backoff: exponential capped + hash-derived jitter (no
 * Math.random — resume plans must be reproducible).
 */
function retryDelayMs(policy, idempotencyKey, attempt) {
  const p = { ...DEFAULT_POLICY, ...(policy || {}) };
  const exp = Math.min(p.baseBackoffMs * 2 ** Math.max(0, attempt - 1), p.maxBackoffMs);
  const jitter = Number(BigInt(`0x${costShared.hash16({ key: idempotencyKey, attempt }).slice(0, 8)}`)) % (p.baseBackoffMs + 1);
  return exp + jitter;
}

function retryBudgetAllows(policy, op, nowMs) {
  const p = { ...DEFAULT_POLICY, ...(policy || {}) };
  if (op.attemptCount > p.maxAttempts) {
    return { allowed: false, code: "RETRY_BUDGET_EXHAUSTED", message: `${ERRORS.RETRY_BUDGET_EXHAUSTED}: attempt ${op.attemptCount} > max ${p.maxAttempts}` };
  }
  if (nowMs !== undefined && nowMs !== null) {
    const elapsed = nowMs - Date.parse(op.createdAt);
    if (elapsed > p.maxElapsedMs) {
      return { allowed: false, code: "RETRY_BUDGET_EXHAUSTED", message: `${ERRORS.RETRY_BUDGET_EXHAUSTED}: elapsed ${elapsed}ms > max ${p.maxElapsedMs}ms` };
    }
  }
  return { allowed: true, delayMs: retryDelayMs(p, op.idempotencyKey, op.attemptCount) };
}

/**
 * Cancellation (§27): request → confirm. Confirming past SUBMIT_ISSUED
 * without a result does NOT pretend the external work vanished: the
 * operation becomes UNKNOWN_OUTCOME (must reconcile). History/evidence is
 * never deleted by cancel.
 */
function requestCancel(root, projectId, operationId, reason, opts = {}) {
  if (typeof reason !== "string" || !reason) {
    return { ok: false, code: "RECOVERY_STATE_INVALID", message: "cancel needs a reason" };
  }
  const opR = getOperation(root, projectId, operationId);
  if (!opR.ok) return opR;
  const op = opR.operation;
  if (TERMINAL_OP.includes(op.status)) {
    return { ok: false, code: "CANCEL_CONFLICT", message: `terminal ${op.status} cannot be cancelled` };
  }
  if (op.status === "CANCEL_REQUESTED") {
    return { ok: true, operation: op, changed: false, deduped: true };
  }
  return transitionOperation(root, projectId, operationId, "CANCEL_REQUESTED", { ...opts, errorCode: "CANCELLED", cancelReason: reason });
}

function confirmCancel(root, projectId, operationId, opts = {}) {
  const opR = getOperation(root, projectId, operationId);
  if (!opR.ok) return opR;
  const op = opR.operation;
  if (op.status !== "CANCEL_REQUESTED") {
    return { ok: false, code: "CANCEL_CONFLICT", message: `confirm requires CANCEL_REQUESTED (got ${op.status})` };
  }
  const last = lastCheckpointStage(root, projectId, operationId);
  const pastSubmit = last !== null && stageIndex(last) >= stageIndex("SUBMIT_ISSUED") && stageIndex(last) < stageIndex("READY");
  // ponytail: past-submit cancel without a proven result reconciles; the
  // request reason is already persisted on the operation by requestCancel.
  const r = pastSubmit
    ? transitionOperation(root, projectId, operationId, "UNKNOWN_OUTCOME", { ...opts, errorCode: "CANCELLED" })
    : transitionOperation(root, projectId, operationId, "CANCELLED", opts);
  return r;
}

module.exports = {
  RECOVERY_SCHEMA_VERSION,
  OPS_REL,
  CHECKPOINTS_REL,
  OP_STATUS,
  TERMINAL_OP,
  FAILURE_CLASSES,
  RETRYABLE_CLASSES,
  STAGES,
  DEFAULT_RETRY_POLICY: DEFAULT_POLICY,
  ERRORS,
  validateDoc,
  loadDoc,
  beginOperation,
  getOperation,
  transitionOperation,
  checkpoint,
  checkpointsFor,
  lastCheckpointStage,
  planResume,
  reconcileUnknownOutcome,
  canRetry,
  retryDelayMs,
  retryBudgetAllows,
  requestCancel,
  confirmCancel,
};
