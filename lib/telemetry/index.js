"use strict";

/**
 * Phase 1H.4 — Structured telemetry (UNFOLDIQ CORE).
 *
 * Append-only event/span/evidence stores under projects/<pid>/telemetry/.
 * Single atomic JSON docs with revision + fingerprint (same V1-safe
 * conventions as manifest/history/recovery). Refs/hashes/ids only — never
 * raw artifact bodies, prompt payloads, or secrets.
 *
 * Identity: eventId/spanId/evidenceId caller-supplied or deterministic
 * (id12 over stable content). Same id + same bytes replays as a no-op;
 * same id + different bytes is TELEMETRY_CONFLICT (evidence is never
 * overwritten; corrections are new records).
 *
 * Canonical correctness classes are NEVER sampled (§47). Sampling is only
 * expressible on DEBUG_EPHEMERAL records, explicitly flagged.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const costShared = require("../output-cost/shared.js");
const manifestLib = require("../project-manifest/index.js");
const historyLib = require("../generation-history/index.js");

const TELEMETRY_SCHEMA_VERSION = "1.0.0";
const EVENTS_REL = "telemetry/events.json";
const SPANS_REL = "telemetry/spans.json";
const EVIDENCE_REL = "telemetry/evidence.json";

const SEVERITIES = ["DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

// §7 typed event classes (no giant untyped LOG).
const EVENT_CLASSES = ["PROJECT_STATE", "JOB_STATE", "OPERATION_STATE", "CHECKPOINT", "PROVIDER_DECISION", "MODEL_DECISION", "PROMPT_PACKAGE", "SUBMIT", "RESULT_DETECTION", "CORRELATION", "DOWNLOAD", "IMPORT", "ASSET_REGISTRATION", "QA", "LOCK", "DIRTY_PROPAGATION", "REBUILD_PLAN", "RETRY", "RECOVERY", "CANCEL", "COST", "SECURITY", "ERROR", "GOLDEN_RUN", "CANARY", "PROVENANCE", "COMPLIANCE", "STORAGE",
// Phase 2.1 voice identity lifecycle (create/validate/revise/selection review).
// §7 keeps typed classes so voice decisions stay queryable without a giant
// untyped LOG; the values are decisions, not log lines.
"VOICE_BIBLE_CREATED", "VOICE_BIBLE_VALIDATED", "VOICE_BIBLE_REVISED", "VOICE_SELECTION_RESOLVED", "VOICE_SELECTION_REVIEW_REQUIRED",
// Phase 2.2 + 2.3 pre-TTS lifecycle (narration direction + pronunciation runtime).
"NARRATION_DIRECTION_CREATED", "NARRATION_DIRECTION_VALIDATED", "NARRATION_DIRECTION_REVISED", "PRONUNCIATION_PROFILE_RESOLVED", "PRONUNCIATION_RUNTIME_VALIDATED", "PRONUNCIATION_REVIEW_REQUIRED", "PRONUNCIATION_OVERRIDE_REVISED", "PRONUNCIATION_INVALIDATION_PLANNED",
// FIX PRE-2.4 spoken-script pipeline (humanizer → fidelity → naturalness → canonical FSS).
"SPOKEN_HUMANIZATION_CREATED", "SPOKEN_HUMANIZATION_REVISED", "EVIDENCE_FIDELITY_EVALUATED", "NATURALNESS_QA_EVALUATED", "FINAL_SPOKEN_SCRIPT_CREATED", "FINAL_SPOKEN_SCRIPT_REVISED", "FINAL_SPOKEN_SCRIPT_CANONICALIZED", "TTS_PRODUCTION_BLOCK_CLEARED",
// Phase 2.4-2.6 narration synthesis + QA lifecycle.
"TTS_SEGMENT_SYNTHESIS_STARTED", "TTS_SEGMENT_SYNTHESIS_SUCCEEDED", "TTS_SEGMENT_SYNTHESIS_FAILED", "TTS_SEGMENT_SELECTED", "SPEECH_RATE_QA_EVALUATED", "PERFORMANCE_QA_EVALUATED", "TTS_SEGMENT_REGENERATION_PLANNED", "FINAL_NARRATION_TRACK_ASSEMBLED", "DIALOGUE_ROUTING_VALIDATED"];

// Expected control-flow states: never ERROR/FATAL unless an operational
// failure (which uses a different code). Fail fast at record time.
const EXPECTED_FLOW_CODES = ["TARGET_LOCKED", "RETRY_REQUIRES_REVIEW", "NOT_CREATED_YET", "ALREADY_APPROVED", "ALREADY_REJECTED", "ALREADY_LOCKED", "IDEMPOTENT_REPLAY", "REVIEW_REQUIRED", "CANARY_REVIEW_REQUIRED"];

// Canonical-durable classes (§47: decisions, cost, errors, locks, retries,
// submits, correlations, QA verdicts, golden verdicts).
const DURABLE_CLASSES = ["PROVIDER_DECISION", "MODEL_DECISION", "SUBMIT", "CORRELATION", "QA", "LOCK", "RETRY", "COST", "SECURITY", "ERROR", "GOLDEN_RUN", "CANARY", "PROVENANCE", "COMPLIANCE",
  "VOICE_BIBLE_CREATED", "VOICE_BIBLE_REVISED", "VOICE_SELECTION_RESOLVED", "VOICE_SELECTION_REVIEW_REQUIRED",
  "NARRATION_DIRECTION_CREATED", "NARRATION_DIRECTION_REVISED", "PRONUNCIATION_PROFILE_RESOLVED", "PRONUNCIATION_OVERRIDE_REVISED", "PRONUNCIATION_INVALIDATION_PLANNED",
  "SPOKEN_HUMANIZATION_CREATED", "SPOKEN_HUMANIZATION_REVISED", "EVIDENCE_FIDELITY_EVALUATED", "NATURALNESS_QA_EVALUATED", "FINAL_SPOKEN_SCRIPT_CREATED", "FINAL_SPOKEN_SCRIPT_REVISED", "FINAL_SPOKEN_SCRIPT_CANONICALIZED", "TTS_PRODUCTION_BLOCK_CLEARED",
  "TTS_SEGMENT_SYNTHESIS_SUCCEEDED", "TTS_SEGMENT_SYNTHESIS_FAILED", "TTS_SEGMENT_SELECTED", "SPEECH_RATE_QA_EVALUATED", "PERFORMANCE_QA_EVALUATED", "FINAL_NARRATION_TRACK_ASSEMBLED", "DIALOGUE_ROUTING_VALIDATED"];

// Cost evidence strength taxonomy (1G.12 §5.6 — stable set, duplicated here
// rather than requiring scripts/cli from lib).
const COST_STRENGTH = ["LIVE_UI_OBSERVED", "PROVIDER_BALANCE_OBSERVED", "CANONICAL_COST_TABLE_RECONCILED", "INFERRED_UPPER_BOUND", "UNKNOWN"];

const RETENTIONS = ["CANONICAL_DURABLE", "DERIVED_REGENERABLE", "DEBUG_EPHEMERAL"];

// Cardinality control (§13): attribute keys that would explode dimensions
// or leak payloads. promptVersion/promptFingerprint/artifactRef stay legal.
const FORBIDDEN_ATTRIBUTE_KEYS = ["prompt", "prompttext", "fullprompt", "rawurl", "stacktrace", "usertext", "filename", "filepath"];
const MAX_ATTRIBUTE_STRING = 256;

const ERRORS = {
  TELEMETRY_SCHEMA_INVALID: "telemetry record fails schema/semantic validation",
  TELEMETRY_WRITE_FAILED: "atomic persist failed; previous state untouched",
  TELEMETRY_QUERY_INVALID: "query filter invalid",
  TELEMETRY_CONFLICT: "same identity with different bytes; evidence is append-only",
  TRACE_CORRELATION_INVALID: "span parent unknown and not declared external",
  EVIDENCE_NOT_FOUND: "unknown evidenceId",
};

let validators = {};
function validatorFor(kind) {
  if (!validators[kind]) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const root = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "telemetry.schema.json"), "utf8"));
    const def = kind === "events" ? "eventsDoc" : kind === "spans" ? "spansDoc" : "evidenceDoc";
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
  return [...manifestLib.findSecretKeys(doc), ...historyLib.findSecretPastes(doc)];
}

function validateDoc(kind, doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: [{ code: "TELEMETRY_SCHEMA_INVALID", message: "doc must be an object" }] };
  }
  const valid = validatorFor(kind)(doc);
  if (!valid) {
    for (const e of validatorFor(kind).errors || []) {
      errors.push({ code: "TELEMETRY_SCHEMA_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
    }
  }
  const secrets = scanSecrets(doc);
  if (secrets.length > 0) {
    errors.push({ code: "TELEMETRY_SCHEMA_INVALID", message: `secret material must never persist: ${secrets.join(", ")}` });
  }
  if (errors.length === 0 && doc.fingerprint !== fingerprintOf(doc)) {
    errors.push({ code: "TELEMETRY_SCHEMA_INVALID", message: "fingerprint mismatch: mutated outside the canonical path" });
  }
  return { ok: errors.length === 0, errors };
}

function relFor(kind) {
  return kind === "events" ? EVENTS_REL : kind === "spans" ? SPANS_REL : EVIDENCE_REL;
}

function collFor(kind) {
  return kind === "events" ? "events" : kind === "spans" ? "spans" : "items";
}

function blankDoc(kind, projectId, createdAt) {
  const base = { schemaVersion: TELEMETRY_SCHEMA_VERSION, projectId, revision: 1, createdAt, updatedAt: createdAt, fingerprint: null };
  base[collFor(kind)] = {};
  return base;
}

function loadDoc(kind, root, projectId) {
  const rel = relFor(kind);
  if (!artifactStore.artifactExists(root, projectId, rel)) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `${kind} store absent` };
  }
  let raw;
  try {
    raw = JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8"));
  } catch (e) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `unparseable ${kind} store: ${String((e && e.message) || e)}` };
  }
  const v = validateDoc(kind, raw);
  if (!v.ok) return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  return { ok: true, doc: raw };
}

function ensureDoc(kind, root, projectId, opts = {}) {
  const loaded = loadDoc(kind, root, projectId);
  if (loaded.ok) return loaded;
  if (!artifactStore.artifactExists(root, projectId, relFor(kind))) {
    const createdAt = nowIso(opts.now);
    const doc = blankDoc(kind, projectId, createdAt);
    doc.fingerprint = fingerprintOf(doc);
    const text = JSON.stringify(doc, null, 2) + "\n";
    try {
      artifactStore.writeArtifactAtomic(root, projectId, relFor(kind), text);
    } catch (e) {
      return { ok: false, code: "TELEMETRY_WRITE_FAILED", message: `${ERRORS.TELEMETRY_WRITE_FAILED}: ${String((e && e.message) || e)}` };
    }
    return { ok: true, doc };
  }
  return loaded;
}

function commitDoc(kind, root, projectId, doc, opts = {}) {
  doc.revision += 1;
  doc.updatedAt = nowIso(opts.now);
  doc.fingerprint = fingerprintOf(doc);
  const text = JSON.stringify(doc, null, 2) + "\n";
  JSON.parse(text);
  const v = validateDoc(kind, doc);
  if (!v.ok) return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  try {
    artifactStore.writeArtifactAtomic(root, projectId, relFor(kind), text);
  } catch (e) {
    return { ok: false, code: "TELEMETRY_WRITE_FAILED", message: `${ERRORS.TELEMETRY_WRITE_FAILED}: ${String((e && e.message) || e)}` };
  }
  return { ok: true };
}

function defaultRetention(eventName, severity) {
  if (DURABLE_CLASSES.includes(eventName)) return "CANONICAL_DURABLE";
  if (severity === "DEBUG") return "DEBUG_EPHEMERAL";
  return "DERIVED_REGENERABLE";
}

function checkAttributes(attributes) {
  if (attributes === undefined || attributes === null) return { ok: true };
  if (typeof attributes !== "object" || Array.isArray(attributes)) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: "attributes must be a flat string-keyed object" };
  }
  for (const [k, v] of Object.entries(attributes)) {
    if (FORBIDDEN_ATTRIBUTE_KEYS.includes(k.toLowerCase())) {
      return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `attribute key ${k} would explode cardinality or leak payloads (use ids/fingerprints)` };
    }
    if (v !== null && typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") {
      return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `attribute ${k} must be scalar (no nested objects)` };
    }
    if (typeof v === "string" && v.length > MAX_ATTRIBUTE_STRING) {
      return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `attribute ${k} exceeds ${MAX_ATTRIBUTE_STRING} chars (evidence belongs in the evidence ledger)` };
    }
  }
  return { ok: true };
}

function replayOrConflict(existing, incoming, ignore = []) {
  if (!existing) return { action: "append" };
  const strip = (o) => {
    const c = { ...o };
    for (const k of ignore) delete c[k];
    return c;
  };
  // Emission timestamps are record metadata (first write wins); business
  // bytes decide replay vs conflict.
  const a = costShared.stableStringify(strip(existing));
  const b = costShared.stableStringify(strip(incoming));
  if (a === b) return { action: "noop" };
  return { action: "conflict" };
}

// Fail fast on secret-like caller fields (never silently dropped or kept).
function checkInputSecrets(input) {
  for (const k of Object.keys(input || {})) {
    if (/password|passwd|secret|token|cookie|bearer|authorization|api[_-]?key|sessionid|private[_-]?key/i.test(k)) {
      return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `secret-like input field ${k} must never reach telemetry` };
    }
  }
  return { ok: true };
}

/**
 * Record one structured event. eventId deterministic when omitted
 * (id12 over stable content → natural replay dedupe).
 */
function recordEvent(root, projectId, input = {}, opts = {}) {
  const secretKey = checkInputSecrets(input);
  if (!secretKey.ok) return secretKey;
  if (typeof input.eventName !== "string" || !EVENT_CLASSES.includes(input.eventName)) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `eventName must be ${EVENT_CLASSES.join("|")}` };
  }
  if (!SEVERITIES.includes(input.severity || "INFO")) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `severity must be ${SEVERITIES.join("|")}` };
  }
  const severity = input.severity || "INFO";
  if ((severity === "ERROR" || severity === "FATAL") && EXPECTED_FLOW_CODES.includes(input.errorCode)) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `${input.errorCode} is expected control flow — use WARN or below (ERROR is for operational failure)` };
  }
  const attr = checkAttributes(input.attributes);
  if (!attr.ok) return attr;
  if (input.sampled === true) {
    const forcedDurable = DURABLE_CLASSES.includes(input.eventName);
    if (forcedDurable || (input.retention || defaultRetention(input.eventName, severity)) === "CANONICAL_DURABLE") {
      return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: "canonical correctness events are never sampled" };
    }
  }
  if (input.cost && input.cost.strength !== undefined && input.cost.strength !== null && !COST_STRENGTH.includes(input.cost.strength)) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `cost.strength must be ${COST_STRENGTH.join("|")}` };
  }
  const ensured = ensureDoc("events", root, projectId, opts);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  if (opts.expectedRevision !== undefined && opts.expectedRevision !== null && doc.revision !== opts.expectedRevision) {
    return { ok: false, code: "TELEMETRY_CONFLICT", message: `stale writer: expected revision ${opts.expectedRevision}, current is ${doc.revision}` };
  }
  const timestamp = input.timestamp || nowIso(opts.now);
  const record = {
    eventId: input.eventId || costShared.id12("eve", { project: projectId, name: input.eventName, at: timestamp, corr: input.correlationId || input.jobId || "", nonce: input.nonce || "" }),
    eventName: input.eventName,
    timestamp,
    severity,
    projectId,
    runId: input.runId || null,
    jobId: input.jobId || null,
    attemptId: input.attemptId || null,
    operationId: input.operationId || null,
    correlationId: input.correlationId || null,
    generationUnitId: input.generationUnitId || null,
    assetId: input.assetId || null,
    stage: input.stage || null,
    component: input.component || null,
    provider: input.provider || null,
    model: input.model || null,
    modelResolutionRef: input.modelResolutionRef || null,
    stateFrom: input.stateFrom || null,
    stateTo: input.stateTo || null,
    durationMs: input.durationMs !== undefined ? input.durationMs : null,
    cost: input.cost !== undefined ? input.cost : null,
    outputCount: input.outputCount !== undefined ? input.outputCount : null,
    resultRef: input.resultRef || null,
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map(String) : [],
    errorCode: input.errorCode || null,
    errorClass: input.errorClass || null,
    retryable: input.retryable !== undefined ? input.retryable : null,
    attributes: input.attributes !== undefined ? (input.attributes || null) : null,
    retention: input.retention || defaultRetention(input.eventName, severity),
    provenance: input.provenance || null,
  };
  if (!/^eve-[0-9a-f]{12}$/.test(record.eventId)) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: "eventId eve-<12hex> is required" };
  }
  const rc = replayOrConflict(doc.events[record.eventId], record, ["timestamp"]);
  if (rc.action === "noop") return { ok: true, doc, changed: false, deduped: true, event: record };
  if (rc.action === "conflict") {
    return { ok: false, code: "TELEMETRY_CONFLICT", message: `${ERRORS.TELEMETRY_CONFLICT}: event ${record.eventId} (issue a correction record instead)` };
  }
  doc.events[record.eventId] = record;
  const c = commitDoc("events", root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, doc, changed: true, event: record };
}

/** Security events without secret payloads (attributes still scanned). */
function recordSecurityEvent(root, projectId, kind, input = {}, opts = {}) {
  const KINDS = ["SECRET_REJECTED", "ORIGIN_REJECTED", "PATH_TRAVERSAL_REJECTED", "UNAUTHORIZED_BRIDGE_REQUEST"];
  if (!KINDS.includes(kind)) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `security kind must be ${KINDS.join("|")}` };
  }
  return recordEvent(root, projectId, {
    eventName: "SECURITY", severity: "WARN", errorCode: kind,
    errorClass: "security", retryable: false,
    component: input.component || null, stage: input.stage || null,
    jobId: input.jobId || null, attemptId: input.attemptId || null,
    operationId: input.operationId || null, correlationId: input.correlationId || null,
    attributes: input.attributes || null, evidenceRefs: input.evidenceRefs || [],
    provenance: input.provenance || null,
  }, opts);
}

/** Cost event: provenance/strength preserved per strength (never collapsed). */
function recordCostEvent(root, projectId, input = {}, opts = {}) {
  return recordEvent(root, projectId, {
    eventName: "COST", severity: input.severity || "INFO",
    jobId: input.jobId || null, attemptId: input.attemptId || null,
    operationId: input.operationId || null, correlationId: input.correlationId || null,
    generationUnitId: input.generationUnitId || null,
    provider: input.provider || null, model: input.model || null,
    cost: {
      planned: input.planned !== undefined ? input.planned : null,
      authorized: input.authorized !== undefined ? input.authorized : null,
      observed: input.observed !== undefined ? input.observed : null,
      reconciled: input.reconciled !== undefined ? input.reconciled : null,
      strength: input.strength || "UNKNOWN",
    },
    evidenceRefs: input.evidenceRefs || [],
    attributes: input.attributes || null,
    provenance: input.provenance || null,
  }, opts);
}

/**
 * Result-correlation observability (§17): ambiguity can only resolve to
 * BLOCKED_AMBIGUOUS / REVIEW_REQUIRED — a null selection with a CORRELATED
 * outcome is refused (never silently choose a weak candidate).
 */
function recordCorrelation(root, projectId, input = {}, opts = {}) {
  const OUTCOMES = ["CORRELATED", "BLOCKED_AMBIGUOUS", "REVIEW_REQUIRED"];
  if (!OUTCOMES.includes(input.outcome)) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: `outcome must be ${OUTCOMES.join("|")}` };
  }
  if (!input.selectedRef && input.outcome === "CORRELATED") {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: "CORRELATED requires a selectedRef (ambiguity → BLOCKED_AMBIGUOUS/REVIEW_REQUIRED)" };
  }
  return recordEvent(root, projectId, {
    eventName: "CORRELATION", severity: input.outcome === "CORRELATED" ? "INFO" : "WARN",
    jobId: input.jobId || null, attemptId: input.attemptId || null,
    operationId: input.operationId || null, correlationId: input.correlationId || null,
    generationUnitId: input.generationUnitId || null,
    provider: input.provider || null, model: input.model || null,
    resultRef: input.selectedRef || null, evidenceRefs: input.evidenceRefs || [],
    errorCode: input.outcome === "CORRELATED" ? null : input.outcome,
    attributes: {
      candidateCount: input.candidateCount !== undefined ? input.candidateCount : null,
      method: input.method || null,
      confidence: input.confidence || null,
      hash: input.hash || null,
      promptFingerprint: input.promptFingerprint || null,
    },
    provenance: input.provenance || null,
  }, opts);
}

/** Start one span (bounded, parent-linked). Same open span replays as-is. */
function startSpan(root, projectId, input = {}, opts = {}) {
  if (typeof input.name !== "string" || !input.name) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: "span name is required" };
  }
  const secretKey = checkInputSecrets(input);
  if (!secretKey.ok) return secretKey;
  const attr = checkAttributes(input.attributes);
  if (!attr.ok) return attr;
  const ensured = ensureDoc("spans", root, projectId, opts);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  if (input.parentSpanId && !doc.spans[input.parentSpanId] && !opts.allowExternalParent) {
    return { ok: false, code: "TRACE_CORRELATION_INVALID", message: `${ERRORS.TRACE_CORRELATION_INVALID}: ${input.parentSpanId}` };
  }
  const startedAt = input.startedAt || nowIso(opts.now);
  const record = {
    spanId: input.spanId || costShared.id12("spi", { project: projectId, name: input.name, at: startedAt, parent: input.parentSpanId || "" }),
    traceId: input.traceId || costShared.id12("trs", { project: projectId, corr: input.correlationId || input.jobId || startedAt }),
    parentSpanId: input.parentSpanId || null,
    name: input.name,
    startedAt,
    endedAt: null,
    status: "OPEN",
    projectId,
    jobId: input.jobId || null,
    operationId: input.operationId || null,
    correlationId: input.correlationId || null,
    attributes: input.attributes !== undefined ? (input.attributes || null) : null,
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map(String) : [],
    errorCode: null,
  };
  if (!/^spi-[0-9a-f]{12}$/.test(record.spanId) || !/^trs-[0-9a-f]{12}$/.test(record.traceId)) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: "spanId spi-<12hex> and traceId trs-<12hex> required" };
  }
  const existing = doc.spans[record.spanId];
  if (existing) {
    // Same open span → return as-is. Same identity with same business bytes
    // (ignoring emission time) → noop. Anything else → conflict.
    if (existing.status === "OPEN" && existing.name === record.name
      && (existing.parentSpanId || null) === (record.parentSpanId || null)
      && (existing.traceId || null) === (record.traceId || null)) {
      return { ok: true, doc, changed: false, deduped: true, span: existing };
    }
    const rc = replayOrConflict(existing, record, ["startedAt", "endedAt"]);
    if (rc.action === "noop") return { ok: true, doc, changed: false, deduped: true, span: existing };
    return { ok: false, code: "TELEMETRY_CONFLICT", message: `${ERRORS.TELEMETRY_CONFLICT}: span ${record.spanId}` };
  }
  doc.spans[record.spanId] = record;
  const c = commitDoc("spans", root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, doc, changed: true, span: record };
}

/** Finalize a span. Same-bytes replay is a no-op (no misleading duplicates). */
function endSpan(root, projectId, spanId, input = {}, opts = {}) {
  const loaded = loadDoc("spans", root, projectId);
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;
  const span = doc.spans[spanId];
  if (!span) {
    return { ok: false, code: "TRACE_CORRELATION_INVALID", message: `unknown span ${spanId}` };
  }
  const next = {
    ...span,
    endedAt: input.endedAt || nowIso(opts.now),
    status: input.status || "OK",
    errorCode: input.errorCode || null,
    evidenceRefs: input.evidenceRefs !== undefined ? input.evidenceRefs.map(String) : span.evidenceRefs,
  };
  if (!["OK", "ERROR"].includes(next.status)) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: "span end status must be OK|ERROR" };
  }
  if (span.status !== "OPEN") {
    const rc = replayOrConflict(span, next, ["endedAt"]);
    if (rc.action === "noop") return { ok: true, doc, changed: false, deduped: true, span };
    return { ok: false, code: "TELEMETRY_CONFLICT", message: `${ERRORS.TELEMETRY_CONFLICT}: span ${spanId} already finalized` };
  }
  doc.spans[spanId] = next;
  const c = commitDoc("spans", root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, doc, changed: true, span: next };
}

/** Canonical evidence index entry (immutable address, never overwritten). */
function recordEvidence(root, projectId, input = {}, opts = {}) {
  const secretKey = checkInputSecrets(input);
  if (!secretKey.ok) return secretKey;
  if (typeof input.kind !== "string" || !input.kind) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: "evidence kind is required" };
  }
  if (typeof input.source !== "string" || !input.source) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: "evidence source is required" };
  }
  const ensured = ensureDoc("evidence", root, projectId, opts);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  const record = {
    evidenceId: input.evidenceId || costShared.id12("evi", { project: projectId, kind: input.kind, ref: input.artifactRef || input.path || input.source }),
    kind: input.kind,
    source: input.source,
    createdAt: input.createdAt || nowIso(opts.now),
    projectId,
    jobId: input.jobId || null,
    attemptId: input.attemptId || null,
    artifactRef: input.artifactRef || null,
    hash: input.hash || null,
    path: input.path || null,
    immutable: input.immutable !== undefined ? input.immutable : true,
    provenance: input.provenance || null,
  };
  if (!/^evi-[0-9a-f]{12}$/.test(record.evidenceId)) {
    return { ok: false, code: "TELEMETRY_SCHEMA_INVALID", message: "evidenceId evi-<12hex> is required" };
  }
  const rc = replayOrConflict(doc.items[record.evidenceId], record, ["createdAt"]);
  if (rc.action === "noop") return { ok: true, doc, changed: false, deduped: true, evidence: record };
  if (rc.action === "conflict") {
    return { ok: false, code: "TELEMETRY_CONFLICT", message: `${ERRORS.TELEMETRY_CONFLICT}: evidence ${record.evidenceId} (new id for new evidence)` };
  }
  doc.items[record.evidenceId] = record;
  const c = commitDoc("evidence", root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, doc, changed: true, evidence: record };
}

function getEvidence(root, projectId, evidenceId) {
  const loaded = loadDoc("evidence", root, projectId);
  if (!loaded.ok) return loaded;
  const item = loaded.doc.items[evidenceId];
  if (!item) return { ok: false, code: "EVIDENCE_NOT_FOUND", message: ERRORS.EVIDENCE_NOT_FOUND };
  return { ok: true, evidence: item };
}

function matchTime(ts, since, until) {
  if (since && ts < since) return false;
  if (until && ts > until) return false;
  return true;
}

/** Minimal machine-readable query (§19). Bounded limit, no full dumps. */
function listEvents(root, projectId, filters = {}) {
  const loaded = loadDoc("events", root, projectId);
  if (!loaded.ok) {
    if (!artifactStore.artifactExists(root, projectId, EVENTS_REL)) return { ok: true, events: [], total: 0 };
    return loaded;
  }
  const allowed = ["eventName", "jobId", "attemptId", "operationId", "correlationId", "since", "until", "errorCode", "provider", "model", "severity", "component", "stage", "limit"];
  for (const k of Object.keys(filters)) {
    if (!allowed.includes(k)) {
      return { ok: false, code: "TELEMETRY_QUERY_INVALID", message: `unknown filter ${k} (allowed: ${allowed.join(",")})` };
    }
  }
  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 1000);
  const all = Object.values(loaded.doc.events).sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
  const out = [];
  for (const e of all) {
    if (filters.eventName && e.eventName !== filters.eventName) continue;
    if (filters.jobId && e.jobId !== filters.jobId) continue;
    if (filters.attemptId && e.attemptId !== filters.attemptId) continue;
    if (filters.operationId && e.operationId !== filters.operationId) continue;
    if (filters.correlationId && e.correlationId !== filters.correlationId) continue;
    if (filters.errorCode && e.errorCode !== filters.errorCode) continue;
    if (filters.provider && e.provider !== filters.provider) continue;
    if (filters.model && e.model !== filters.model) continue;
    if (filters.severity && e.severity !== filters.severity) continue;
    if (filters.component && e.component !== filters.component) continue;
    if (filters.stage && e.stage !== filters.stage) continue;
    if (!matchTime(e.timestamp, filters.since, filters.until)) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return { ok: true, events: out, total: out.length };
}

/** LOG-FIRST investigation (§4): one correlationId → full chain, sorted. */
function getTrace(root, projectId, correlationId) {
  if (typeof correlationId !== "string" || !correlationId) {
    return { ok: false, code: "TELEMETRY_QUERY_INVALID", message: "correlationId is required" };
  }
  const ev = listEvents(root, projectId, { correlationId, limit: 1000 });
  if (!ev.ok) return ev;
  const spansLoaded = loadDoc("spans", root, projectId);
  const spans = spansLoaded.ok
    ? Object.values(spansLoaded.doc.spans).filter((s) => s.correlationId === correlationId).sort((a, b) => (a.startedAt < b.startedAt ? -1 : 1))
    : [];
  return { ok: true, correlationId, events: ev.events, spans };
}

/** Error analysis without log-text parsing (§18). */
function errorSummary(root, projectId, filters = {}) {
  const ev = listEvents(root, projectId, { ...filters, limit: 1000 });
  if (!ev.ok) return ev;
  const groups = {};
  for (const e of ev.events) {
    if (e.severity !== "ERROR" && e.severity !== "FATAL" && !e.errorCode) continue;
    const key = `${e.component || "?"}|${e.stage || "?"}|${e.errorCode || "?"}`;
    if (!groups[key]) {
      groups[key] = { component: e.component, stage: e.stage, errorCode: e.errorCode, count: 0, retryable: e.retryable, severities: {} };
    }
    groups[key].count += 1;
    groups[key].severities[e.severity] = (groups[key].severities[e.severity] || 0) + 1;
  }
  return { ok: true, groups: Object.values(groups).sort((a, b) => b.count - a.count) };
}

/** Cost analysis with provenance preserved per strength (never collapsed). */
function costSummary(root, projectId, filters = {}) {
  const ev = listEvents(root, projectId, { ...filters, eventName: "COST", limit: 1000 });
  if (!ev.ok) return ev;
  const byStrength = {};
  let planned = 0;
  let authorized = 0;
  for (const e of ev.events) {
    const c = e.cost || {};
    if (typeof c.planned === "number") planned += c.planned;
    if (typeof c.authorized === "number") authorized += c.authorized;
    const key = c.strength || "UNKNOWN";
    if (!byStrength[key]) byStrength[key] = { observed: 0, reconciled: 0, events: 0 };
    if (typeof c.observed === "number") byStrength[key].observed += c.observed;
    if (typeof c.reconciled === "number") byStrength[key].reconciled += c.reconciled;
    byStrength[key].events += 1;
  }
  return { ok: true, planned, authorized, byStrength };
}

module.exports = {
  TELEMETRY_SCHEMA_VERSION,
  EVENTS_REL,
  SPANS_REL,
  EVIDENCE_REL,
  SEVERITIES,
  EVENT_CLASSES,
  DURABLE_CLASSES,
  COST_STRENGTH,
  RETENTIONS,
  ERRORS,
  validateDoc,
  loadDoc,
  recordEvent,
  recordSecurityEvent,
  recordCostEvent,
  recordCorrelation,
  startSpan,
  endSpan,
  recordEvidence,
  getEvidence,
  listEvents,
  getTrace,
  errorSummary,
  costSummary,
};
