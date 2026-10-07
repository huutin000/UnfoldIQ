"use strict";

/**
 * Phase 1H.1 — Versioned Project Manifest (UNFOLDIQ CORE state contract).
 *
 * The single canonical owner of "which versions belong to a production run".
 * Location: projects/<projectId>/manifest/project-manifest.json.
 * Not Flow Companion / browser / provider / session state (see §4 ownership).
 *
 * One canonical mutation path: createProjectManifest / updateProjectManifest
 * (+ setArtifactVersion / setProviderSelection / setProjectStage delegates).
 * No arbitrary direct JSON mutation: every write validates (JSON Schema via
 * Ajv + secret scan + fingerprint), persists atomically through the Core
 * artifact store, and bumps revision/projectVersion only on real change.
 *
 * Version semantics (§8): same canonical state → no write, no bump.
 * Canonical mutation → revision+1 and (for artifacts/providers/state/
 * content changes) projectVersion+1. Schema migration → schemaVersion
 * changes explicitly (unsupported versions are rejected, never coerced).
 * Timestamps are metadata, never version identity.
 *
 * Deliberately NOT here (H20): 1H.2 locks/history, 1H.3 DAG/dirty
 * propagation, observability expansion. This module stays a dumb,
 * conflict-safe version ledger.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const costShared = require("../output-cost/shared.js");

const SCHEMA_VERSION = "1.0.0";
const CURRENT_SCHEMA_VERSION = "1.6.0";
const SUPPORTED_SCHEMA_VERSIONS = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0", "1.5.0", "1.6.0"];
const MANIFEST_REL = "manifest/project-manifest.json";

const ARTIFACT_KEYS = [
  "creativeBriefVersion",
  "channelBibleVersion",
  "storyBibleVersion",
  "characterBibleVersion",
  "worldBibleVersion",
  "visualBibleVersion",
  "researchPackVersion",
  "finalSpokenScriptVersion",
  "voiceBibleVersion",
  "shotPlanVersion",
  "promptCompilerVersion",
  "agentInstructionsVersion",
  "assetRegistryVersion",
  "finalAudioVersion",
  "alignmentVersion",
  "timelineVersion",
  "renderVersion",
  // Phase 2.2 + 2.3 pre-TTS slots (schema 1.5.0): index refs only, never bodies.
  "narrationDirectionVersion",
  "pronunciationProfileVersion",
  "pronunciationRuntimePassVersion",
  "ttsReadyPlanVersion",
  // Phase 2.4-2.6 narration/QA slots (schema 1.6.0). finalAudioVersion stays
  // RESERVED for the Phase 2.8 post-mix master.
  "narrationAudioVersion",
  "speechRateQaVersion",
  "performanceQaVersion",
  "dialogueRoutingVersion",
];

const ARTIFACT_STATUS = ["VERIFIED", "MIGRATED", "UNRESOLVED", "NOT_CREATED_YET"];
const STATE_STATUS = ["DRAFT", "ACTIVE", "READY", "COMPLETE", "BLOCKED"];

// Manifest must never persist secret material (§19). Key-name scan only:
// content hashes (sha256 etc.) are NOT secrets and are allowed as values.
const SECRET_KEY_PATTERN = /password|passwd|secret|token|cookie|bearer|authorization|api[_-]?key|sessionid|private[_-]?key/i;

const ERRORS = {
  MANIFEST_NOT_FOUND: "manifest file does not exist for this project",
  MANIFEST_SCHEMA_INVALID: "manifest fails schema/semantic validation",
  MANIFEST_VERSION_UNSUPPORTED: "schemaVersion is not supported by this code",
  MANIFEST_WRITE_FAILED: "atomic persist failed; previous state untouched",
  MANIFEST_MIGRATION_FAILED: "evidence-based bootstrap failed without writing",
  MANIFEST_CONFLICT: "stale writer or duplicate create; current state survives",
  MANIFEST_SECRET_REJECTED: "secret-like field must never be persisted",
  ARTIFACT_VERSION_NOT_FOUND: "unknown artifact key",
  ARTIFACT_VERSION_INVALID: "artifact version entry invalid",
  PROVIDER_VERSION_INVALID: "provider selection entry invalid",
  STATE_TRANSITION_INVALID: "stage/status value invalid",
};

let ajvValidators = {};
function validatorFor(schemaVersion) {
  if (!ajvValidators[schemaVersion]) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const files = { "1.0.0": "project-manifest.schema.json", "1.1.0": "project-manifest-1.1.0.schema.json", "1.2.0": "project-manifest-1.2.0.schema.json", "1.3.0": "project-manifest-1.3.0.schema.json", "1.4.0": "project-manifest-1.4.0.schema.json", "1.5.0": "project-manifest-1.5.0.schema.json", "1.6.0": "project-manifest-1.6.0.schema.json" };
    const file = files[schemaVersion];
    if (!file) throw new Error(`unsupported schemaVersion ${schemaVersion}`);
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", file), "utf8"));
    ajvValidators[schemaVersion] = ajv.compile(schema);
  }
  return ajvValidators[schemaVersion];
}
// Back-compat alias (1H.1 callers).
function validator() {
  return validatorFor(CURRENT_SCHEMA_VERSION);
}

function nowIso(now) {
  return now || new Date().toISOString();
}

// Semver gate for additive slots: a slot introduced in schema X stays writable
// on every later version (1.2.0 recovery, 1.3.0 governance, 1.4.0 voice bible,
// 1.5.0 pre-TTS narration/pronunciation slots).
function schemaAtLeast(version, min) {
  const p = (s) => String(s).split(".").map((n) => Number(n) || 0);
  const a = p(version);
  const b = p(min);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

function emptyArtifacts() {
  const out = {};
  for (const k of ARTIFACT_KEYS) out[k] = { version: null, status: "NOT_CREATED_YET", ref: null, detail: null };
  return out;
}

// Fingerprint covers everything except itself (timestamps included: they are
// metadata, and any effective write sets updatedAt → new fingerprint).
function fingerprintOf(m) {
  const { fingerprint, ...rest } = m;
  void fingerprint;
  return costShared.hash16(JSON.parse(costShared.stableStringify(rest)));
}

function findSecrets(node, trail = "$", hits = []) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => findSecrets(v, `${trail}[${i}]`, hits));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (SECRET_KEY_PATTERN.test(k)) hits.push(`${trail}.${k}`);
      findSecrets(v, `${trail}.${k}`, hits);
    }
  }
  return hits;
}

/**
 * Pure validation: JSON Schema shape + fingerprint integrity + secret scan.
 * Returns { ok, errors: [{ code, message }] }.
 */
function validateProjectManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, errors: [{ code: "MANIFEST_SCHEMA_INVALID", message: "manifest must be an object" }] };
  }
  const valid = SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schemaVersion)
    ? validatorFor(manifest.schemaVersion)(manifest)
    : false;
  if (!valid) {
    if (!SUPPORTED_SCHEMA_VERSIONS.includes(manifest.schemaVersion)) {
      errors.push({ code: "MANIFEST_VERSION_UNSUPPORTED", message: `schemaVersion ${manifest.schemaVersion} unsupported (code supports ${SUPPORTED_SCHEMA_VERSIONS.join("|")})` });
    } else {
      for (const e of (validatorFor(manifest.schemaVersion).errors || [])) {
        errors.push({ code: "MANIFEST_SCHEMA_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
      }
    }
  }
  const secrets = findSecrets(manifest);
  if (secrets.length > 0) {
    errors.push({ code: "MANIFEST_SECRET_REJECTED", message: `secret-like fields: ${secrets.join(", ")}` });
  }
  if (errors.length === 0 && manifest.fingerprint !== fingerprintOf(manifest)) {
    errors.push({ code: "MANIFEST_SCHEMA_INVALID", message: "fingerprint mismatch: content was mutated outside the canonical path" });
  }
  return { ok: errors.length === 0, errors };
}

function manifestPath(root, projectId) {
  return path.join(root, "projects", projectId, MANIFEST_REL);
}

function exists(root, projectId) {
  return artifactStore.artifactExists(root, projectId, MANIFEST_REL);
}

function readRaw(root, projectId) {
  return JSON.parse(artifactStore.readArtifact(root, projectId, MANIFEST_REL).toString("utf8"));
}

/**
 * Load + validate. Missing → MANIFEST_NOT_FOUND; corrupt/invalid →
 * MANIFEST_SCHEMA_INVALID (never auto-repairs).
 */
function loadProjectManifest(root, projectId) {
  if (!exists(root, projectId)) {
    return { ok: false, code: "MANIFEST_NOT_FOUND", message: ERRORS.MANIFEST_NOT_FOUND };
  }
  let raw;
  try {
    raw = readRaw(root, projectId);
  } catch (e) {
    return { ok: false, code: "MANIFEST_SCHEMA_INVALID", message: `unparseable manifest: ${String((e && e.message) || e)}` };
  }
  const v = validateProjectManifest(raw);
  if (!v.ok) return { ok: false, code: "MANIFEST_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  return { ok: true, manifest: raw };
}

function persistValidated(root, projectId, manifest) {
  const text = JSON.stringify(manifest, null, 2) + "\n";
  JSON.parse(text); // serialized output must round-trip
  const v = validateProjectManifest(manifest);
  if (!v.ok) return { ok: false, code: "MANIFEST_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  try {
    artifactStore.writeArtifactAtomic(root, projectId, MANIFEST_REL, text);
  } catch (e) {
    return { ok: false, code: "MANIFEST_WRITE_FAILED", message: `${ERRORS.MANIFEST_WRITE_FAILED}: ${String((e && e.message) || e)}` };
  }
  return { ok: true };
}

/**
 * Create a new manifest. Refuses when one already exists (MANIFEST_CONFLICT:
 * use update/migrate, never silent overwrite).
 */
function createProjectManifest(input = {}) {
  const { root, projectId } = input;
  if (!root || !projectId) {
    return { ok: false, code: "MANIFEST_SCHEMA_INVALID", message: "root + projectId are required" };
  }
  if (exists(root, projectId)) {
    return { ok: false, code: "MANIFEST_CONFLICT", message: "manifest already exists; update or migrate instead of recreating" };
  }
  const createdAt = nowIso(input.now);
  const manifest = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    manifestId: costShared.id12("pm", { project: projectId, created: createdAt }),
    projectId,
    projectVersion: 1,
    revision: 1,
    pipelineVersion: input.pipelineVersion || null,
    contentMode: input.contentMode || null,
    contentClass: input.contentClass || null,
    createdAt,
    updatedAt: createdAt,
    artifacts: { ...emptyArtifacts(), ...(input.artifacts || {}) },
    providers: {
      registryVersion: (input.providers && input.providers.registryVersion) || null,
      selections: ((input.providers && input.providers.selections) || []).map(normalizeSelection),
    },
    state: { stage: (input.state && input.state.stage) || null, status: (input.state && input.state.status) || "DRAFT" },
    history: input.history !== undefined ? input.history : null,
    recovery: input.recovery !== undefined ? input.recovery : null,
    governance: input.governance !== undefined ? input.governance : null,
    lineage: { previousManifestId: null, previousProjectVersion: null },
    fingerprint: null,
  };
  manifest.fingerprint = fingerprintOf(manifest);
  const saved = persistValidated(root, projectId, manifest);
  if (!saved.ok) return saved;
  return { ok: true, manifest, changed: true };
}

function normalizeSelection(s) {
  return {
    modelId: s.modelId,
    providerId: s.providerId || null,
    resolutionRef: s.resolutionRef || null,
    detail: s.detail || null,
  };
}

function selectionKey(s) {
  return `${s.modelId}||${s.resolutionRef || ""}||${s.providerId || ""}`;
}

function checkArtifactEntry(key, entry) {
  if (!ARTIFACT_KEYS.includes(key)) {
    return { ok: false, code: "ARTIFACT_VERSION_NOT_FOUND", message: `unknown artifact key ${key}` };
  }
  if (!entry || typeof entry !== "object") {
    return { ok: false, code: "ARTIFACT_VERSION_INVALID", message: `entry for ${key} must be an object` };
  }
  if (!ARTIFACT_STATUS.includes(entry.status)) {
    return { ok: false, code: "ARTIFACT_VERSION_INVALID", message: `status must be ${ARTIFACT_STATUS.join("|")}` };
  }
  const version = entry.version === undefined ? null : entry.version;
  if (version !== null && (typeof version !== "string" || !version)) {
    return { ok: false, code: "ARTIFACT_VERSION_INVALID", message: `version for ${key} must be a non-empty string or null` };
  }
  if (version === null && (entry.status === "VERIFIED" || entry.status === "MIGRATED")) {
    return { ok: false, code: "ARTIFACT_VERSION_INVALID", message: `${entry.status} requires a version for ${key}` };
  }
  if (entry.ref !== undefined && entry.ref !== null && typeof entry.ref !== "string") {
    return { ok: false, code: "ARTIFACT_VERSION_INVALID", message: `ref for ${key} must be a string or null` };
  }
  return { ok: true };
}

function checkSelectionEntry(s) {
  if (!s || typeof s.modelId !== "string" || !s.modelId) {
    return { ok: false, code: "PROVIDER_VERSION_INVALID", message: "each selection needs a non-empty modelId" };
  }
  const allowed = ["modelId", "providerId", "resolutionRef", "detail"];
  for (const k of Object.keys(s)) {
    if (!allowed.includes(k)) {
      return { ok: false, code: "PROVIDER_VERSION_INVALID", message: `unknown selection field ${k} (contract is ${allowed.join("|")})` };
    }
  }
  for (const f of ["providerId", "resolutionRef", "detail"]) {
    if (s[f] !== undefined && s[f] !== null && typeof s[f] !== "string") {
      return { ok: false, code: "PROVIDER_VERSION_INVALID", message: `${f} must be a string or null` };
    }
  }
  return { ok: true };
}

/**
 * The ONE write path. patch: { artifacts?, providers?, state?, contentMode?,
 * contentClass?, pipelineVersion? }. Idempotent: an equivalent patch writes
 * nothing and bumps nothing. Stale writers: pass expectedRevision; mismatch
 * → MANIFEST_CONFLICT and revision 6 (or whatever is current) survives.
 */
function updateProjectManifest(root, projectId, patch = {}, opts = {}) {
  const loaded = loadProjectManifest(root, projectId);
  if (!loaded.ok) return loaded;
  const current = loaded.manifest;
  if (opts.expectedRevision !== undefined && opts.expectedRevision !== null
    && current.revision !== opts.expectedRevision) {
    return { ok: false, code: "MANIFEST_CONFLICT", message: `stale writer: expected revision ${opts.expectedRevision}, current is ${current.revision}`, manifest: current };
  }
  const next = JSON.parse(JSON.stringify(current));
  // Validate patch entries before touching state.
  if (patch.artifacts) {
    for (const [k, e] of Object.entries(patch.artifacts)) {
      const c = checkArtifactEntry(k, e);
      if (!c.ok) return c;
    }
    for (const [k, e] of Object.entries(patch.artifacts)) {
      next.artifacts[k] = {
        version: e.version === undefined ? null : e.version,
        status: e.status,
        ref: e.ref === undefined ? null : e.ref,
        detail: e.detail === undefined ? null : e.detail,
      };
    }
  }
  if (patch.providers) {
    if (patch.providers.registryVersion !== undefined) {
      if (patch.providers.registryVersion !== null) {
        const c = checkArtifactEntry("promptCompilerVersion", patch.providers.registryVersion);
        if (!c.ok) return { ok: false, code: "PROVIDER_VERSION_INVALID", message: `registryVersion invalid: ${c.message}` };
      }
      next.providers.registryVersion = patch.providers.registryVersion;
    }
    if (patch.providers.selections !== undefined) {
      if (!Array.isArray(patch.providers.selections)) {
        return { ok: false, code: "PROVIDER_VERSION_INVALID", message: "selections must be an array" };
      }
      for (const s of patch.providers.selections) {
        const c = checkSelectionEntry(s);
        if (!c.ok) return c;
      }
      const seen = new Map();
      for (const s of patch.providers.selections.map(normalizeSelection)) seen.set(selectionKey(s), s);
      next.providers.selections = [...seen.values()].sort((a, b) => (selectionKey(a) < selectionKey(b) ? -1 : 1));
    }
  }
  if (patch.state) {
    if (patch.state.status !== undefined) {
      if (!STATE_STATUS.includes(patch.state.status)) {
        return { ok: false, code: "STATE_TRANSITION_INVALID", message: `status must be ${STATE_STATUS.join("|")}` };
      }
      next.state.status = patch.state.status;
    }
    if (patch.state.stage !== undefined) next.state.stage = patch.state.stage;
  }
  for (const f of ["contentMode", "contentClass", "pipelineVersion"]) {
    if (patch[f] !== undefined) next[f] = patch[f];
  }
  if (patch.history !== undefined) {
    const h = patch.history;
    if (h !== null && (!h || h.historySchemaVersion !== "1.0.0" || typeof h.ref !== "string" || !h.ref)) {
      return { ok: false, code: "MANIFEST_SCHEMA_INVALID", message: "history must be null or { historySchemaVersion: '1.0.0', ref: string }" };
    }
    next.history = h;
  }
  if (patch.recovery !== undefined) {
    const r = patch.recovery;
    if (r !== null && (!r || r.recoverySchemaVersion !== "1.0.0" || r.dagSchemaVersion !== "1.0.0" || typeof r.ref !== "string" || !r.ref)) {
      return { ok: false, code: "MANIFEST_SCHEMA_INVALID", message: "recovery must be null or { recoverySchemaVersion: '1.0.0', dagSchemaVersion: '1.0.0', ref: string }" };
    }
    if (!schemaAtLeast(next.schemaVersion, "1.2.0") && r !== null) {
      return { ok: false, code: "MANIFEST_VERSION_UNSUPPORTED", message: "recovery slot requires schema 1.2.0+ — migrate first" };
    }
    next.recovery = r;
  }
  if (patch.governance !== undefined) {
    const g = patch.governance;
    if (g !== null && (!g || g.provenanceSchemaVersion !== "1.0.0" || g.complianceSchemaVersion !== "1.0.0" || g.storageSchemaVersion !== "1.0.0" || typeof g.ref !== "string" || !g.ref)) {
      return { ok: false, code: "MANIFEST_SCHEMA_INVALID", message: "governance must be null or { provenanceSchemaVersion/complianceSchemaVersion/storageSchemaVersion: '1.0.0', ref: string }" };
    }
    if (!schemaAtLeast(next.schemaVersion, "1.3.0") && g !== null) {
      return { ok: false, code: "MANIFEST_VERSION_UNSUPPORTED", message: "governance slot requires schema 1.3.0+ — migrate first" };
    }
    next.governance = g;
  }
  // Idempotency: same canonical state → no write, no bump, no lineage entry.
  const normSlot = (v) => (v === undefined ? null : v);
  const before = costShared.stableStringify({
    artifacts: current.artifacts, providers: current.providers, state: current.state,
    contentMode: current.contentMode, contentClass: current.contentClass, pipelineVersion: current.pipelineVersion,
    history: normSlot(current.history), recovery: normSlot(current.recovery), governance: normSlot(current.governance),
  });
  const after = costShared.stableStringify({
    artifacts: next.artifacts, providers: next.providers, state: next.state,
    contentMode: next.contentMode, contentClass: next.contentClass, pipelineVersion: next.pipelineVersion,
    history: normSlot(next.history), recovery: normSlot(next.recovery), governance: normSlot(next.governance),
  });
  if (before === after) return { ok: true, manifest: current, changed: false };
  next.revision = current.revision + 1;
  next.projectVersion = current.projectVersion + 1;
  next.updatedAt = nowIso(opts.now);
  next.fingerprint = fingerprintOf(next);
  const saved = persistValidated(root, projectId, next);
  if (!saved.ok) return saved;
  void opts.actor;
  return { ok: true, manifest: next, changed: true };
}

function setArtifactVersion(root, projectId, key, entry, opts = {}) {
  return updateProjectManifest(root, projectId, { artifacts: { [key]: entry } }, opts);
}

function setProviderSelection(root, projectId, selections, opts = {}) {
  return updateProjectManifest(root, projectId, { providers: { selections } }, opts);
}

function setProjectStage(root, projectId, stage, opts = {}) {
  return updateProjectManifest(root, projectId, { state: stage }, opts);
}

/**
 * Explicit schema migration 1.0.0 → 1.1.0 (1H.2 history slot).
 * Adds `history: null`, bumps revision+projectVersion (canonical bytes
 * change), preserves manifestId/lineage. Refuses non-1.0.0 input and
 * refuses to run twice. Returns the standard result shape.
 */
function migrateSchema1_0_0_to_1_1_0(root, projectId, opts = {}) {
  return migrateSchemaTo(root, projectId, "1.0.0", "1.1.0", { history: null }, opts);
}

/**
 * Explicit schema migration 1.1.0 → 1.2.0 (1H.3 recovery slot).
 * Same contract: adds `recovery: null`, bumps revision+projectVersion,
 * preserves manifestId. Refuses wrong input and repeat runs.
 */
function migrateSchema1_1_0_to_1_2_0(root, projectId, opts = {}) {
  return migrateSchemaTo(root, projectId, "1.1.0", "1.2.0", { recovery: null }, opts);
}

/**
 * Explicit schema migration 1.2.0 → 1.3.0 (1H.6/1H.7 governance slot).
 * Adds `governance: null`, bumps revision+projectVersion.
 */
function migrateSchema1_2_0_to_1_3_0(root, projectId, opts = {}) {
  return migrateSchemaTo(root, projectId, "1.2.0", "1.3.0", { governance: null }, opts);
}

/**
 * Explicit schema migration 1.3.0 → 1.4.0 (Phase 2.1 voice bible slot).
 * Adds the `voiceBibleVersion` artifact entry as NOT_CREATED_YET: 2.1 must not
 * claim a Voice Bible exists where none was provable. Same contract: explicit,
 * refuses wrong input and repeat runs, bumps revision+projectVersion.
 */
function migrateSchema1_3_0_to_1_4_0(root, projectId, opts = {}) {
  return migrateSchemaTo(root, projectId, "1.3.0", "1.4.0", (_current, next) => {
    if (!next.artifacts.voiceBibleVersion) {
      next.artifacts.voiceBibleVersion = { version: null, status: "NOT_CREATED_YET", ref: null, detail: null };
    }
  }, opts);
}

/**
 * Explicit schema migration 1.4.0 → 1.5.0 (Phase 2.2+2.3 pre-TTS slots).
 * Adds the four pre-TTS artifact entries as NOT_CREATED_YET: 2.2/2.3 must not
 * claim artifacts exist where none were provable. Same contract: explicit,
 * refuses wrong input and repeat runs, bumps revision+projectVersion.
 */
function migrateSchema1_4_0_to_1_5_0(root, projectId, opts = {}) {
  return migrateSchemaTo(root, projectId, "1.4.0", "1.5.0", (_current, next) => {
    for (const key of ["narrationDirectionVersion", "pronunciationProfileVersion", "pronunciationRuntimePassVersion", "ttsReadyPlanVersion"]) {
      if (!next.artifacts[key]) {
        next.artifacts[key] = { version: null, status: "NOT_CREATED_YET", ref: null, detail: null };
      }
    }
  }, opts);
}

function migrateSchema1_5_0_to_1_6_0(root, projectId, opts = {}) {
  return migrateSchemaTo(root, projectId, "1.5.0", "1.6.0", (_current, next) => {
    for (const key of ["narrationAudioVersion", "speechRateQaVersion", "performanceQaVersion", "dialogueRoutingVersion"]) {
      if (!next.artifacts[key]) {
        next.artifacts[key] = { version: null, status: "NOT_CREATED_YET", ref: null, detail: null };
      }
    }
  }, opts);
}

function migrateSchemaTo(root, projectId, from, to, additions, opts = {}) {
  const loaded = loadProjectManifest(root, projectId);
  if (!loaded.ok) return loaded;
  const current = loaded.manifest;
  if (current.schemaVersion !== from) {
    return { ok: false, code: "MANIFEST_CONFLICT", message: `migration ${from}→${to} requires schemaVersion ${from} (got ${current.schemaVersion})` };
  }
  const next = JSON.parse(JSON.stringify(current));
  next.schemaVersion = to;
  // Additive slots either set top-level keys (object) or patch in place
  // (function, e.g. 1.4.0 inserting an artifact entry).
  if (typeof additions === "function") additions(current, next);
  else Object.assign(next, additions);
  next.revision = current.revision + 1;
  next.projectVersion = current.projectVersion + 1;
  next.updatedAt = nowIso(opts.now);
  next.fingerprint = fingerprintOf(next);
  const saved = persistValidated(root, projectId, next);
  if (!saved.ok) return saved;
  return { ok: true, manifest: next, changed: true };
}

function findSecretKeys(node) {
  return findSecrets(node);
}

module.exports = {
  SCHEMA_VERSION,
  CURRENT_SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  MANIFEST_REL,
  ARTIFACT_KEYS,
  ARTIFACT_STATUS,
  STATE_STATUS,
  ERRORS,
  fingerprintOf,
  findSecretKeys,
  validateProjectManifest,
  loadProjectManifest,
  createProjectManifest,
  updateProjectManifest,
  setArtifactVersion,
  setProviderSelection,
  setProjectStage,
  migrateSchema1_0_0_to_1_1_0,
  migrateSchema1_1_0_to_1_2_0,
  migrateSchema1_2_0_to_1_3_0,
  migrateSchema1_3_0_to_1_4_0,
  migrateSchema1_4_0_to_1_5_0,
  migrateSchema1_5_0_to_1_6_0,
  manifestPath,
};
