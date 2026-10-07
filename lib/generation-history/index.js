"use strict";

/**
 * Phase 1H.2 — Generation History + Locking (UNFOLDIQ CORE).
 *
 * One canonical owner of generation/variant/decision/lock truth.
 * Store: projects/<projectId>/history/history.json (single atomic JSON:
 * { generations, variants, decisions, locks, revision, fingerprint }).
 * References — never copies — GenerationJob, Asset Registry, QA, Budget,
 * and Project Manifest records.
 *
 * Append-only by default: generations and decisions are immutable once
 * recorded (same id + same bytes replays as a no-op; same id + different
 * bytes is HISTORY_CONFLICT/DECISION_CONFLICT). The only lifecycle
 * transitions are: generation SUBMITTED→terminal (once, via
 * completeGeneration), variant PROPOSED→SELECTED→SUPERSEDED/REJECTED (via
 * selectVariant/recordDecision), and lock LOCKED↔UNLOCKED (explicit,
 * reasoned, versioned events — prior events are preserved, never edited).
 *
 * Enforcement (§12): guard functions refuse prohibited Core actions with
 * structured TARGET_LOCKED / REJECTED_* errors. The expensive provider path
 * is additionally gated by injecting `lockGate` into the 1G.8 authorizers
 * (optional, backward-compatible — absent means current behavior).
 *
 * Deliberately NOT here (H20/G24): 1H.3 DAG, dirty propagation, and resume
 * orchestration. Minimal forward hooks only: stable targetKey addressing
 * and per-target event trails that 1H.3 can consume.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const costShared = require("../output-cost/shared.js");
const manifestLib = require("../project-manifest/index.js");

const HISTORY_SCHEMA_VERSION = "1.0.0";
const STORE_REL = "history/history.json";

const TARGET_TYPES = ["SCENE", "SEGMENT", "ASSET", "VOICE_PARAGRAPH", "SHOT", "VOICE_BIBLE"];
const GEN_STATUS = ["SUBMITTED", "SUCCEEDED", "FAILED", "CANCELLED"];
const TERMINAL_GEN = ["SUCCEEDED", "FAILED", "CANCELLED"];
const VARIANT_STATUS = ["PROPOSED", "SELECTED", "SUPERSEDED", "REJECTED"];
const DECISION_VALUES = ["APPROVED", "REJECTED"];
const LOCK_STATUS = ["LOCKED", "UNLOCKED"];

const ERRORS = {
  HISTORY_NOT_FOUND: "history store does not exist for this project",
  HISTORY_SCHEMA_INVALID: "history store fails schema/semantic validation",
  HISTORY_WRITE_FAILED: "atomic persist failed; previous state untouched",
  HISTORY_CONFLICT: "same identity with different bytes; history is append-only",
  DECISION_INVALID: "decision needs target + identity + reason + evidence",
  DECISION_CONFLICT: "same decision id with different bytes",
  ALREADY_APPROVED: "target already approved for this variant; no state change",
  ALREADY_REJECTED: "target already rejected for this variant; no state change",
  ALREADY_LOCKED: "target already locked; existing protection stands",
  LOCK_NOT_FOUND: "no lock record for this target",
  TARGET_LOCKED: "locked target refuses regenerate/replace/delete/retry/select",
  TARGET_NOT_LOCKED: "unlock requires a currently locked target",
  LOCK_CONFLICT: "stale lock version; current lock state survives",
  UNLOCK_REASON_REQUIRED: "unlocking is destructive-to-protection and needs a reason",
  VARIANT_NOT_FOUND: "unknown variant",
  VARIANT_SELECTION_CONFLICT: "another variant is already selected for this target; fail closed",
  REJECTED_VARIANT_NOT_SELECTABLE: "rejected variant can never become selected",
  REJECTED_ASSET_NOT_SELECTABLE: "rejected asset can never become selected or a reference",
  STATE_DIVERGENCE: "history and registry disagree; detected, never silently resolved",
  GENERATION_NOT_FOUND: "unknown generation",
};

let ajvValidator = null;
function validator() {
  if (!ajvValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    ajvValidator = ajv.compile(JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "generation-history.schema.json"), "utf8")
    ));
  }
  return ajvValidator;
}

function nowIso(now) {
  return now || new Date().toISOString();
}

function targetKey(targetType, targetId) {
  return `${targetType}::${targetId}`;
}

function checkTarget(targetType, targetId) {
  if (!TARGET_TYPES.includes(targetType)) return { ok: false, code: "DECISION_INVALID", message: `targetType must be ${TARGET_TYPES.join("|")}` };
  if (typeof targetId !== "string" || !targetId) return { ok: false, code: "DECISION_INVALID", message: "targetId is required" };
  return { ok: true };
}

function fingerprintOf(store) {
  const { fingerprint, ...rest } = store;
  void fingerprint;
  return costShared.hash16(JSON.parse(costShared.stableStringify(rest)));
}

function validateHistory(store) {
  const errors = [];
  if (!store || typeof store !== "object") {
    return { ok: false, errors: [{ code: "HISTORY_SCHEMA_INVALID", message: "store must be an object" }] };
  }
  const valid = validator()(store);
  if (!valid) {
    for (const e of validator().errors || []) {
      errors.push({ code: "HISTORY_SCHEMA_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
    }
  }
  const secrets = manifestLib.findSecretKeys(store);
  if (secrets.length > 0) {
    errors.push({ code: "HISTORY_SCHEMA_INVALID", message: `secret-like fields must never persist: ${secrets.join(", ")}` });
  }
  // Decision reasons/notes are free text where operators paste context: refuse
  // explicit secret assignments (key=value pastes), while content hashes and
  // ordinary prose stay allowed.
  const pastes = findSecretPastes(store);
  if (pastes.length > 0) {
    errors.push({ code: "HISTORY_SCHEMA_INVALID", message: `secret-value paste must never persist: ${pastes.join(", ")}` });
  }
  if (errors.length === 0 && store.fingerprint !== fingerprintOf(store)) {
    errors.push({ code: "HISTORY_SCHEMA_INVALID", message: "fingerprint mismatch: content was mutated outside the canonical path" });
  }
  return { ok: errors.length === 0, errors };
}

function exists(root, projectId) {
  return artifactStore.artifactExists(root, projectId, STORE_REL);
}

function loadHistory(root, projectId) {
  if (!exists(root, projectId)) {
    return { ok: false, code: "HISTORY_NOT_FOUND", message: ERRORS.HISTORY_NOT_FOUND };
  }
  let raw;
  try {
    raw = JSON.parse(artifactStore.readArtifact(root, projectId, STORE_REL).toString("utf8"));
  } catch (e) {
    return { ok: false, code: "HISTORY_SCHEMA_INVALID", message: `unparseable history store: ${String((e && e.message) || e)}` };
  }
  const v = validateHistory(raw);
  if (!v.ok) return { ok: false, code: "HISTORY_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  return { ok: true, store: raw };
}

function persistValidated(root, projectId, store) {
  const text = JSON.stringify(store, null, 2) + "\n";
  JSON.parse(text);
  const v = validateHistory(store);
  if (!v.ok) return { ok: false, code: "HISTORY_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  try {
    artifactStore.writeArtifactAtomic(root, projectId, STORE_REL, text);
  } catch (e) {
    return { ok: false, code: "HISTORY_WRITE_FAILED", message: `${ERRORS.HISTORY_WRITE_FAILED}: ${String((e && e.message) || e)}` };
  }
  return { ok: true };
}

function blankStore(projectId, createdAt) {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    projectId,
    revision: 1,
    createdAt,
    updatedAt: createdAt,
    generations: {},
    variants: {},
    decisions: {},
    locks: {},
    fingerprint: null,
  };
}

function createHistoryStore(root, projectId, opts = {}) {
  if (!root || !projectId) {
    return { ok: false, code: "HISTORY_SCHEMA_INVALID", message: "root + projectId are required" };
  }
  if (exists(root, projectId)) {
    return { ok: false, code: "HISTORY_CONFLICT", message: "history store already exists; append, never recreate" };
  }
  const createdAt = nowIso(opts.now);
  const store = blankStore(projectId, createdAt);
  store.fingerprint = fingerprintOf(store);
  const saved = persistValidated(root, projectId, store);
  if (!saved.ok) return saved;
  return { ok: true, store, changed: true };
}

// Same identity + same bytes → idempotent replay (no duplicate, no bump).
// Same identity + different bytes → conflict (append-only).
// Volatile record metadata (emission timestamps) is excluded from the replay
// comparison: first write wins, replays with fresh timestamps still dedupe.
function replayOrConflict(existing, incoming, conflictCode, ignore = []) {
  if (!existing) return { action: "append" };
  const strip = (o) => {
    const c = { ...o };
    for (const k of ignore) delete c[k];
    return c;
  };
  const a = costShared.stableStringify(strip(existing));
  const b = costShared.stableStringify(strip(incoming));
  if (a === b) return { action: "noop" };
  return { action: "conflict", code: conflictCode };
}

function commit(root, projectId, store, opts = {}) {
  store.revision += 1;
  store.updatedAt = nowIso(opts.now);
  store.fingerprint = fingerprintOf(store);
  const saved = persistValidated(root, projectId, store);
  if (!saved.ok) return saved;
  return { ok: true, store, changed: true };
}

function checkRevision(store, expectedRevision) {
  if (expectedRevision !== undefined && expectedRevision !== null && store.revision !== expectedRevision) {
    return { ok: false, code: "HISTORY_CONFLICT", message: `stale writer: expected revision ${expectedRevision}, current is ${store.revision}` };
  }
  return { ok: true };
}

/**
 * Record one generation event (SUBMITTED/SUCCEEDED/FAILED/CANCELLED).
 * Requires generationId + jobId + attemptId. Completed generations carry
 * completedAt + resultAssetIds at record time.
 */
function recordGeneration(root, projectId, event = {}, opts = {}) {
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const store = loaded.store;
  const rev = checkRevision(store, opts.expectedRevision);
  if (!rev.ok) return { ...rev, store };
  if (!event.generationId || !/^gen-[0-9a-f]{12}$/.test(event.generationId)) {
    return { ok: false, code: "HISTORY_SCHEMA_INVALID", message: "generationId gen-<12hex> is required" };
  }
  if (!event.jobId || !event.attemptId) {
    return { ok: false, code: "HISTORY_SCHEMA_INVALID", message: "jobId + attemptId are required" };
  }
  if (!GEN_STATUS.includes(event.status)) {
    return { ok: false, code: "HISTORY_SCHEMA_INVALID", message: `status must be ${GEN_STATUS.join("|")}` };
  }
  const record = {
    generationId: event.generationId,
    projectId,
    runId: event.runId || null,
    jobId: event.jobId,
    attemptId: event.attemptId,
    shotId: event.shotId || null,
    sceneId: event.sceneId || null,
    segmentId: event.segmentId || null,
    paragraphId: event.paragraphId || null,
    generationUnitId: event.generationUnitId || null,
    provider: event.provider || null,
    model: event.model || null,
    modelResolutionRef: event.modelResolutionRef || null,
    promptVersion: event.promptVersion || null,
    agentInstructionsVersion: event.agentInstructionsVersion || null,
    referenceIds: Array.isArray(event.referenceIds) ? event.referenceIds.map(String) : [],
    createdAt: event.createdAt || nowIso(opts.now),
    completedAt: event.completedAt || null,
    status: event.status,
    resultAssetIds: Array.isArray(event.resultAssetIds) ? event.resultAssetIds.map(String) : [],
    costEvidence: event.costEvidence !== undefined ? (event.costEvidence || null) : null,
    parentGenerationId: event.parentGenerationId || null,
    retryOf: event.retryOf || null,
    provenance: event.provenance || null,
  };
  const rc = replayOrConflict(store.generations[record.generationId], record, "HISTORY_CONFLICT", ["createdAt"]);
  if (rc.action === "noop") return { ok: true, store, changed: false, deduped: true };
  if (rc.action === "conflict") {
    return { ok: false, code: rc.code, message: `${ERRORS.HISTORY_CONFLICT}: generation ${record.generationId} already recorded differently`, store };
  }
  store.generations[record.generationId] = record;
  return commit(root, projectId, store, opts);
}

/**
 * One-way completion: SUBMITTED → terminal exactly once. Terminal records
 * never change (attempt-1 FAIL stays FAIL forever). Same-values replay is a
 * no-op.
 */
function completeGeneration(root, projectId, generationId, completion = {}, opts = {}) {
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const store = loaded.store;
  const rev = checkRevision(store, opts.expectedRevision);
  if (!rev.ok) return { ...rev, store };
  const rec = store.generations[generationId];
  if (!rec) return { ok: false, code: "GENERATION_NOT_FOUND", message: ERRORS.GENERATION_NOT_FOUND, store };
  if (TERMINAL_GEN.includes(rec.status)) {
    const same = (completion.status === undefined || completion.status === rec.status)
      && (completion.completedAt === undefined || completion.completedAt === rec.completedAt)
      && (completion.resultAssetIds === undefined || costShared.stableStringify([...completion.resultAssetIds].sort()) === costShared.stableStringify([...rec.resultAssetIds].sort()));
    if (same) return { ok: true, store, changed: false, deduped: true };
    return { ok: false, code: "HISTORY_CONFLICT", message: `${ERRORS.HISTORY_CONFLICT}: generation ${generationId} is terminal (${rec.status})`, store };
  }
  if (!TERMINAL_GEN.includes(completion.status)) {
    return { ok: false, code: "HISTORY_SCHEMA_INVALID", message: `completion status must be ${TERMINAL_GEN.join("|")}` };
  }
  rec.status = completion.status;
  rec.completedAt = completion.completedAt || nowIso(opts.now);
  if (completion.resultAssetIds !== undefined) rec.resultAssetIds = completion.resultAssetIds.map(String);
  if (completion.costEvidence !== undefined) rec.costEvidence = completion.costEvidence;
  return commit(root, projectId, store, opts);
}

/**
 * Record one variant (PROPOSED). Variants make attempts explicit: why
 * created (generation source), asset result, QA/decision state.
 */
function recordVariant(root, projectId, event = {}, opts = {}) {
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const store = loaded.store;
  const rev = checkRevision(store, opts.expectedRevision);
  if (!rev.ok) return { ...rev, store };
  const t = checkTarget(event.targetType, event.targetId);
  if (!t.ok) return { ...t, store };
  if (!event.variantId || !/^var-[0-9a-f]{12}$/.test(event.variantId)) {
    return { ok: false, code: "HISTORY_SCHEMA_INVALID", message: "variantId var-<12hex> is required" };
  }
  if (!event.generationId || !store.generations[event.generationId]) {
    return { ok: false, code: "GENERATION_NOT_FOUND", message: "variant must reference a recorded generation" };
  }
  const record = {
    variantId: event.variantId,
    targetType: event.targetType,
    targetId: event.targetId,
    generationId: event.generationId,
    assetId: event.assetId || null,
    createdAt: event.createdAt || nowIso(opts.now),
    status: "PROPOSED",
    decisionId: null,
    decidedAt: null,
  };
  const rc = replayOrConflict(store.variants[record.variantId], record, "HISTORY_CONFLICT", ["createdAt"]);
  if (rc.action === "noop") return { ok: true, store, changed: false, deduped: true };
  if (rc.action === "conflict") {
    return { ok: false, code: rc.code, message: `${ERRORS.HISTORY_CONFLICT}: variant ${record.variantId} already recorded differently`, store };
  }
  store.variants[record.variantId] = record;
  return commit(root, projectId, store, opts);
}

/**
 * Structured APPROVED/REJECTED decision. Requires identity + reason +
 * non-empty evidence. Same id + same bytes replays as no-op. Same
 * target+variant+value under a NEW id is ALREADY_APPROVED/ALREADY_REJECTED
 * (no state change). A differing value is a new event (revision path §11).
 * APPROVED auto-selects the variant and auto-locks the target unless
 * opts.lockOnApprove === false (explicit, recorded).
 */
function recordDecision(root, projectId, event = {}, opts = {}) {
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const store = loaded.store;
  const rev = checkRevision(store, opts.expectedRevision);
  if (!rev.ok) return { ...rev, store };
  const t = checkTarget(event.targetType, event.targetId);
  if (!t.ok) return { ...t, store };
  if (!DECISION_VALUES.includes(event.decision)) {
    return { ok: false, code: "DECISION_INVALID", message: `decision must be ${DECISION_VALUES.join("|")}` };
  }
  if (typeof event.reason !== "string" || !event.reason) {
    return { ok: false, code: "DECISION_INVALID", message: "reason is required (no opaque boolean-only approval)" };
  }
  if (!Array.isArray(event.evidenceRefs) || event.evidenceRefs.length === 0) {
    return { ok: false, code: "DECISION_INVALID", message: "evidenceRefs[] must be non-empty" };
  }
  if (event.variantId !== undefined && event.variantId !== null && !store.variants[event.variantId]) {
    return { ok: false, code: "VARIANT_NOT_FOUND", message: ERRORS.VARIANT_NOT_FOUND };
  }
  const record = {
    decisionId: event.decisionId || costShared.id12("dec", { target: targetKey(event.targetType, event.targetId), value: event.decision, at: event.decidedAt || nowIso(opts.now) }),
    targetType: event.targetType,
    targetId: event.targetId,
    variantId: event.variantId || null,
    decision: event.decision,
    reason: event.reason,
    evidenceRefs: event.evidenceRefs.map(String),
    decidedAt: event.decidedAt || nowIso(opts.now),
    actorType: event.actorType || null,
    provenance: event.provenance || null,
  };
  if (!/^dec-[0-9a-f]{12}$/.test(record.decisionId)) {
    return { ok: false, code: "DECISION_INVALID", message: "decisionId dec-<12hex> is required" };
  }
  const rc = replayOrConflict(store.decisions[record.decisionId], record, "DECISION_CONFLICT", ["decidedAt"]);
  if (rc.action === "noop") return { ok: true, store, changed: false, deduped: true, decision: record };
  if (rc.action === "conflict") {
    return { ok: false, code: rc.code, message: `${ERRORS.DECISION_CONFLICT}: decision ${record.decisionId}`, store };
  }
  // Same effective verdict already in force → no state change, no write.
  const key = targetKey(record.targetType, record.targetId);
  const current = latestDecision(store, record.targetType, record.targetId);
  if (current && current.decision === record.decision
    && (current.variantId || null) === (record.variantId || null)) {
    return { ok: true, store, changed: false, code: record.decision === "APPROVED" ? "ALREADY_APPROVED" : "ALREADY_REJECTED", decision: current };
  }
  // Revision path (§11) is unlock-first: a NEW approval that would move the
  // projection on a LOCKED target is refused. Explicit, never automatic.
  if (record.decision === "APPROVED") {
    const existingLock = store.locks[key];
    if (existingLock && existingLock.status === "LOCKED") {
      return { ok: false, code: "TARGET_LOCKED", message: `${ERRORS.TARGET_LOCKED}: ${key} holds lock v${existingLock.lockVersion}; unlock first, then re-approve (revision path)`, store, lock: lockSummary(existingLock) };
    }
  }
  store.decisions[record.decisionId] = record;
  if (record.variantId) applyVariantDecision(store, record);
  if (record.decision === "APPROVED" && opts.lockOnApprove !== false) {
    const lk = lockTargetInner(store, {
      targetType: record.targetType, targetId: record.targetId,
      reason: `approved content protection (${record.decisionId})`,
      sourceDecisionId: record.decisionId, at: record.decidedAt,
    });
    if (!lk.ok && lk.code !== "ALREADY_LOCKED") return { ...lk, store };
  }
  const committed = commit(root, projectId, store, opts);
  if (!committed.ok) return committed;
  return { ...committed, decision: record };
}

function applyVariantDecision(store, decision) {
  const v = store.variants[decision.variantId];
  if (!v) return;
  // Revision path (§11): a new APPROVED supersedes the previously selected
  // variant on the same target. Old records stay intact (SUPERSEDED, never
  // deleted); only the projection moves.
  if (decision.decision === "APPROVED") {
    for (const other of Object.values(store.variants)) {
      if (other.variantId !== v.variantId && other.targetType === v.targetType
        && other.targetId === v.targetId && other.status === "SELECTED") {
        other.status = "SUPERSEDED";
      }
    }
  }
  v.status = decision.decision === "APPROVED" ? "SELECTED" : "REJECTED";
  v.decisionId = decision.decisionId;
  v.decidedAt = decision.decidedAt;
}

/**
 * Select one variant as current. Fail-closed: locked target → TARGET_LOCKED;
 * rejected variant → REJECTED_VARIANT_NOT_SELECTABLE; another SELECTED
 * variant on the same target → VARIANT_SELECTION_CONFLICT. Same variant
 * again → no-op.
 */
function selectVariant(root, projectId, variantId, opts = {}) {
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const store = loaded.store;
  const rev = checkRevision(store, opts.expectedRevision);
  if (!rev.ok) return { ...rev, store };
  const v = store.variants[variantId];
  if (!v) return { ok: false, code: "VARIANT_NOT_FOUND", message: ERRORS.VARIANT_NOT_FOUND, store };
  if (v.status === "REJECTED") {
    return { ok: false, code: "REJECTED_VARIANT_NOT_SELECTABLE", message: `${ERRORS.REJECTED_VARIANT_NOT_SELECTABLE}: ${variantId}`, store };
  }
  const key = targetKey(v.targetType, v.targetId);
  const lock = store.locks[key];
  if (lock && lock.status === "LOCKED") {
    const sel = selectedVariant(store, v.targetType, v.targetId);
    if (!sel || sel.variantId !== variantId) {
      return { ok: false, code: "TARGET_LOCKED", message: `${ERRORS.TARGET_LOCKED}: ${key} (lock v${lock.lockVersion})`, store, lock: lockSummary(lock) };
    }
  }
  if (v.status === "SELECTED") {
    const sel = selectedVariant(store, v.targetType, v.targetId);
    if (sel && sel.variantId === variantId) return { ok: true, store, changed: false, deduped: true };
  }
  const other = selectedVariant(store, v.targetType, v.targetId);
  if (other && other.variantId !== variantId) {
    return { ok: false, code: "VARIANT_SELECTION_CONFLICT", message: `${ERRORS.VARIANT_SELECTION_CONFLICT}: ${other.variantId} already selected for ${key}`, store };
  }
  v.status = "SELECTED";
  return commit(root, projectId, store, opts);
}

function selectedVariant(store, targetType, targetId) {
  for (const v of Object.values(store.variants)) {
    if (v.targetType === targetType && v.targetId === targetId && v.status === "SELECTED") return v;
  }
  return null;
}

function latestDecision(store, targetType, targetId) {
  let best = null;
  for (const d of Object.values(store.decisions)) {
    if (d.targetType !== targetType || d.targetId !== targetId) continue;
    if (!best || d.decidedAt >= best.decidedAt) best = d;
  }
  return best;
}

function lockSummary(lock) {
  return { targetType: lock.targetType, targetId: lock.targetId, status: lock.status, lockVersion: lock.lockVersion, reason: lock.reason, sourceDecisionId: lock.sourceDecisionId };
}

/** Trails where a string value carries an explicit secret assignment. */
function findSecretPastes(node, trail = "$", hits = []) {
  if (typeof node === "string") {
    if (/(password|passwd|secret|bridge[_-]?token|bearer|authorization)\s*[:=]\s*\S+/i.test(node)) hits.push(trail);
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => findSecretPastes(v, `${trail}[${i}]`, hits));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) findSecretPastes(v, `${trail}.${k}`, hits);
  }
  return hits;
}

// Inner lock (no revision check / no commit — caller owns the write).
function lockTargetInner(store, input) {
  const t = checkTarget(input.targetType, input.targetId);
  if (!t.ok) return t;
  const key = targetKey(input.targetType, input.targetId);
  const at = input.at || new Date().toISOString();
  const existing = store.locks[key];
  if (existing && existing.status === "LOCKED") {
    return { ok: true, code: "ALREADY_LOCKED", lock: lockSummary(existing) };
  }
  const base = existing || { lockVersion: 0, events: [], createdAt: at };
  const lockVersion = base.lockVersion + 1;
  const record = {
    targetType: input.targetType,
    targetId: input.targetId,
    status: "LOCKED",
    reason: input.reason || "approved content protection",
    sourceDecisionId: input.sourceDecisionId || (existing && existing.sourceDecisionId) || null,
    createdAt: existing ? existing.createdAt : at,
    updatedAt: at,
    lockVersion,
    expectedProjectVersion: input.expectedProjectVersion !== undefined ? input.expectedProjectVersion : (existing ? existing.expectedProjectVersion : null),
    events: [...(existing ? existing.events : []), {
      status: "LOCKED", reason: input.reason || "approved content protection",
      sourceDecisionId: input.sourceDecisionId || null, actor: input.actor || null, at, lockVersion,
    }],
  };
  store.locks[key] = record;
  return { ok: true, lock: lockSummary(record) };
}

/**
 * Explicit lock. Already locked → ALREADY_LOCKED no-op (protection stands;
 * new reasons travel through unlock → re-lock).
 */
function lockTarget(root, projectId, input = {}, opts = {}) {
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const store = loaded.store;
  const rev = checkRevision(store, opts.expectedRevision);
  if (!rev.ok) return { ...rev, store };
  if (input.expectedLockVersion !== undefined && input.expectedLockVersion !== null) {
    const cur = store.locks[targetKey(input.targetType, input.targetId)];
    const curV = cur ? cur.lockVersion : 0;
    if (curV !== input.expectedLockVersion) {
      return { ok: false, code: "LOCK_CONFLICT", message: `stale lock version: expected ${input.expectedLockVersion}, current is ${curV}`, store };
    }
  }
  const r = lockTargetInner(store, { ...input, at: nowIso(opts.now), actor: opts.actor || null });
  if (!r.ok) return { ...r, store };
  if (r.code === "ALREADY_LOCKED") return { ok: true, store, changed: false, code: r.code, lock: r.lock };
  return { ...commit(root, projectId, store, opts), lock: r.lock };
}

/**
 * Explicit unlock: reason REQUIRED, expected lock version REQUIRED (stale
 * versions → LOCK_CONFLICT). Appends the unlock event, preserves history,
 * bumps lockVersion + store revision. Never flips silently.
 */
function unlockTarget(root, projectId, input = {}, opts = {}) {
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const store = loaded.store;
  const rev = checkRevision(store, opts.expectedRevision);
  if (!rev.ok) return { ...rev, store };
  const t = checkTarget(input.targetType, input.targetId);
  if (!t.ok) return { ...t, store };
  if (typeof input.reason !== "string" || !input.reason) {
    return { ok: false, code: "UNLOCK_REASON_REQUIRED", message: ERRORS.UNLOCK_REASON_REQUIRED, store };
  }
  if (input.expectedLockVersion === undefined || input.expectedLockVersion === null) {
    return { ok: false, code: "LOCK_CONFLICT", message: "expectedLockVersion is required to unlock (stale writers must fail closed)", store };
  }
  const key = targetKey(input.targetType, input.targetId);
  const cur = store.locks[key];
  if (!cur || cur.status !== "LOCKED") {
    // Idempotent replay: same unlock event already applied → no-op, no bump.
    if (cur && cur.status === "UNLOCKED" && cur.events.length > 0) {
      const last = cur.events[cur.events.length - 1];
      if (last.status === "UNLOCKED" && last.reason === input.reason && (last.actor || null) === (opts.actor || null)) {
        return { ok: true, store, changed: false, deduped: true, lock: lockSummary(cur) };
      }
    }
    return { ok: false, code: "TARGET_NOT_LOCKED", message: ERRORS.TARGET_NOT_LOCKED, store };
  }
  if (cur.lockVersion !== input.expectedLockVersion) {
    return { ok: false, code: "LOCK_CONFLICT", message: `stale lock version: expected ${input.expectedLockVersion}, current is ${cur.lockVersion}`, store };
  }
  const at = nowIso(opts.now);
  const lockVersion = cur.lockVersion + 1;
  store.locks[key] = {
    ...cur,
    status: "UNLOCKED",
    reason: input.reason,
    updatedAt: at,
    lockVersion,
    events: [...cur.events, { status: "UNLOCKED", reason: input.reason, sourceDecisionId: null, actor: opts.actor || null, at, lockVersion }],
  };
  const out = commit(root, projectId, store, opts);
  return { ...out, lock: out.ok ? lockSummary(store.locks[key]) : undefined };
}

/**
 * Rerun/planning gate (§12, §25): locked target refuses automatic
 * regenerate / replace / delete / silent retry with structured evidence.
 */
function checkRerunAllowed(root, projectId, input = {}) {
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const t = checkTarget(input.targetType, input.targetId);
  if (!t.ok) return t;
  const lock = loaded.store.locks[targetKey(input.targetType, input.targetId)];
  if (lock && lock.status === "LOCKED") {
    return { ok: false, code: "TARGET_LOCKED", message: `${ERRORS.TARGET_LOCKED}: ${input.action || "rerun"} refused for ${targetKey(input.targetType, input.targetId)}`, lock: lockSummary(lock) };
  }
  return { ok: true };
}

/**
 * Lock-gate callback for the 1G.8 authorizers (dependency inversion: no
 * cross-module require, fully backward-compatible when absent).
 * Returns { state: "BLOCKED_TARGET_LOCKED", reasons[] } or null (no block).
 */
function lockGateForAuthorizer(root, projectId, targetType, targetId) {
  const r = checkRerunAllowed(root, projectId, { targetType, targetId, action: "generation-authorize" });
  if (r.ok) return null;
  return { state: "BLOCKED_TARGET_LOCKED", reasons: [`${r.code}: ${r.message}`] };
}

/**
 * Deterministic current-state projection (reproducible, never writes):
 * latest decision per target, current selected variant per target, current
 * lock per target. history = past truth; projection = effective now.
 */
function projectHistory(root, projectId) {
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const store = loaded.store;
  const projection = { projectId, revision: store.revision, targets: {} };
  const keys = new Set();
  for (const v of Object.values(store.variants)) keys.add(targetKey(v.targetType, v.targetId));
  for (const d of Object.values(store.decisions)) keys.add(targetKey(d.targetType, d.targetId));
  for (const k of Object.keys(store.locks)) keys.add(k);
  for (const k of keys) {
    const [targetType, targetId] = k.split("::");
    const sel = selectedVariant(store, targetType, targetId);
    const dec = latestDecision(store, targetType, targetId);
    const lock = store.locks[k] || null;
    projection.targets[k] = {
      targetType, targetId,
      selectedVariantId: sel ? sel.variantId : null,
      effectiveDecision: dec ? { decision: dec.decision, decisionId: dec.decisionId, decidedAt: dec.decidedAt } : null,
      lock: lock ? lockSummary(lock) : null,
    };
  }
  return { ok: true, projection };
}

/**
 * G6 acceptance: history LOCKED vs registry UNLOCKED (or reverse) MUST be
 * detected, never silently resolved. Returns { ok, divergent, details[] }.
 * Registry access is read-only; assetLib is injected (no hard require →
 * no module cycle).
 */
function detectLockDivergence(root, projectId, assetLib) {
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const details = [];
  for (const lock of Object.values(loaded.store.locks)) {
    if (lock.targetType !== "ASSET" || lock.status !== "LOCKED") continue;
    const rec = assetLib.getAsset(root, projectId, lock.targetId);
    if (!rec.ok) {
      details.push({ targetId: lock.targetId, code: "STATE_DIVERGENCE", message: "history LOCKED but asset not in registry" });
    } else if (!rec.record.lock || rec.record.lock.locked !== true) {
      details.push({ targetId: lock.targetId, code: "STATE_DIVERGENCE", message: "history LOCKED but registry UNLOCKED" });
    }
  }
  // Reverse direction: registry-locked assets with no history lock.
  const listed = assetLib.listAssets(root, projectId);
  const historyLocked = new Set(Object.values(loaded.store.locks)
    .filter((l) => l.targetType === "ASSET" && l.status === "LOCKED").map((l) => l.targetId));
  if (listed.ok) {
    for (const rec of listed.assets || []) {
      if (rec && rec.lock && rec.lock.locked === true && !historyLocked.has(rec.assetId)) {
        details.push({ targetId: rec.assetId, code: "STATE_DIVERGENCE", message: "registry LOCKED but no history lock (migrate or unlock explicitly)" });
      }
    }
  }
  return { ok: details.length === 0, divergent: details.length > 0, details };
}

/**
 * Core asset-selection gate (§12, §26): REJECTED assets (registry or history)
 * can never become selected or a reference; non-canonical sources are
 * refused via the 1H.2-era A-21 gate; locked targets refuse replacement.
 * Delegates the actual mutation to assetLib (1G.10 stays the lock writer).
 */
function selectAssetWithHistory(root, projectId, assetId, input = {}, opts = {}, assetLib = null) {
  const lib = assetLib || require("../asset-library/index.js");
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const rec = lib.getAsset(root, projectId, assetId);
  if (!rec.ok) return { ok: false, code: "VARIANT_NOT_FOUND", message: `asset ${assetId} not in registry` };
  const record = rec.record;
  if (record.qualityStatus === "REJECTED" || (record.selection && record.selection.status === "REJECTED")) {
    return { ok: false, code: "REJECTED_ASSET_NOT_SELECTABLE", message: `${ERRORS.REJECTED_ASSET_NOT_SELECTABLE}: ${assetId}` };
  }
  const key = targetKey("ASSET", assetId);
  const dec = latestDecision(loaded.store, "ASSET", assetId);
  if (dec && dec.decision === "REJECTED") {
    return { ok: false, code: "REJECTED_ASSET_NOT_SELECTABLE", message: `${ERRORS.REJECTED_ASSET_NOT_SELECTABLE}: ${assetId} (${dec.decisionId})` };
  }
  const gate = lib.validateCanonicalSource ? lib.validateCanonicalSource(record, { mediaType: input.mediaType || "image" }) : { ok: true };
  if (!gate.ok) {
    return { ok: false, code: "REJECTED_ASSET_NOT_SELECTABLE", message: `canonical-source gate refused ${assetId}: ${gate.code}` };
  }
  const lock = loaded.store.locks[key];
  if (lock && lock.status === "LOCKED") {
    return { ok: false, code: "TARGET_LOCKED", message: `${ERRORS.TARGET_LOCKED}: ${key} (lock v${lock.lockVersion})`, lock: lockSummary(lock) };
  }
  const sel = lib.setSelection(root, projectId, assetId, "SELECTED", input.reason || "history-gated selection");
  if (!sel.ok) return { ok: false, code: "HISTORY_WRITE_FAILED", message: `registry refused selection: ${sel.code || "unknown"}` };
  return { ok: true, record: sel.record };
}

/**
 * Voice-paragraph contract probe (no Phase 2): current projects carry no
 * voice paragraphs → NOT_CREATED_YET, never fabricated records.
 */
function voiceParagraphState(root, projectId, paragraphId) {
  const loaded = loadHistory(root, projectId);
  if (!loaded.ok) return loaded;
  const t = checkTarget("VOICE_PARAGRAPH", paragraphId);
  if (!t.ok) return t;
  const key = targetKey("VOICE_PARAGRAPH", paragraphId);
  const lock = loaded.store.locks[key] || null;
  const dec = latestDecision(loaded.store, "VOICE_PARAGRAPH", paragraphId);
  if (!lock && !dec) return { ok: true, state: "NOT_CREATED_YET", paragraphId };
  return { ok: true, state: lock ? lock.status : "UNLOCKED", paragraphId, lock: lock ? lockSummary(lock) : null, decision: dec ? dec.decision : null };
}

module.exports = {
  HISTORY_SCHEMA_VERSION,
  STORE_REL,
  TARGET_TYPES,
  GEN_STATUS,
  VARIANT_STATUS,
  DECISION_VALUES,
  LOCK_STATUS,
  ERRORS,
  targetKey,
  fingerprintOf,
  findSecretPastes,
  validateHistory,
  exists,
  loadHistory,
  createHistoryStore,
  recordGeneration,
  completeGeneration,
  recordVariant,
  recordDecision,
  selectVariant,
  lockTarget,
  unlockTarget,
  checkRerunAllowed,
  lockGateForAuthorizer,
  projectHistory,
  detectLockDivergence,
  selectAssetWithHistory,
  voiceParagraphState,
};
