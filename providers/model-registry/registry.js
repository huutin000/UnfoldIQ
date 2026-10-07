"use strict";

/**
 * 1G.6 provider/model capability registry (PHASE 1G.6, Prompt 01, §§6–11).
 *
 * What this is: normalized, provenance-bound FACTS about provider surfaces
 * and concrete models — capability rules with constraints (not bare
 * booleans), availability kept separate from documented capability, cost as
 * sourced observations, freshness per observation type, conflicts preserved.
 *
 * What this is not: an execution path (providers/runtime/resolver.js stays
 * the execution owner), a model picker (resolver.js picks), or permanent
 * product truth (seed snapshots are dated observations).
 *
 * Deterministic: same normalized input → same snapshot fingerprint.
 * Zero network, zero generation, zero credits.
 */

const shared = require("./shared.js");

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function normalizeSourceRef(src, index) {
  if (!isObject(src)) return { ok: false, code: "SOURCE_INVALID", message: `source #${index} must be an object` };
  const out = {
    sourceId: src.sourceId || `src-${index}`,
    sourceType: src.sourceType || null,
    url: src.url || src.urlOrReference || null,
    publisher: src.publisher || null,
    scope: src.scope || null,
    retrievedAt: src.retrievedAt || src.observedAt || null,
    locale: src.locale || null,
    fieldAuthority: Array.isArray(src.fieldAuthority) ? [...src.fieldAuthority] : [],
    contentFingerprint: src.contentFingerprint || null,
    notes: src.notes || null,
  };
  if (!shared.SOURCE_TYPES.includes(out.sourceType)) {
    return { ok: false, code: "SOURCE_TYPE_INVALID", message: `source ${out.sourceId} has non-canonical sourceType ${out.sourceType}` };
  }
  if (!out.retrievedAt) {
    return { ok: false, code: "SOURCE_TIMESTAMP_REQUIRED", message: `source ${out.sourceId} needs retrievedAt/observedAt` };
  }
  return { ok: true, source: out };
}

function normalizeCapabilityRule(rule, index, sourceById) {
  if (!isObject(rule)) return { ok: false, code: "RULE_INVALID", message: `rule #${index} must be an object` };
  const capability = rule.capability;
  if (!shared.CANONICAL_CAPABILITIES.includes(capability)) {
    return { ok: false, code: "CAPABILITY_UNKNOWN", message: `rule #${index} names non-canonical capability ${capability} (no silent renames)` };
  }
  if (!shared.SUPPORT_STATES.includes(rule.support)) {
    return { ok: false, code: "SUPPORT_INVALID", message: `rule ${capability} needs SUPPORTED|UNSUPPORTED|UNKNOWN|CONFLICT` };
  }
  const c = isObject(rule.constraints) ? rule.constraints : {};
  const out = {
    capability,
    support: rule.support,
    constraints: {
      mediaKind: c.mediaKind || null,
      workflow: c.workflow || null, // provider workflow label, DATA only
      orientations: Array.isArray(c.orientations) ? [...c.orientations] : [],
      durations: Array.isArray(c.durations) ? [...c.durations] : [],
      resolutions: Array.isArray(c.resolutions) ? [...c.resolutions] : [],
      inputRoles: Array.isArray(c.inputRoles) ? [...c.inputRoles] : [],
      outputKinds: Array.isArray(c.outputKinds) ? [...c.outputKinds] : [],
      subscription: c.subscription || null,
      region: c.region || null,
      notes: c.notes || null,
    },
    sourceRefs: [],
    observedAt: rule.observedAt || null,
    freshness: shared.FRESHNESS_STATES.includes(rule.freshness) ? rule.freshness : "UNKNOWN",
    conflict: Array.isArray(rule.conflict) ? rule.conflict : [],
  };
  for (const ref of rule.sourceRefs || []) {
    const id = isObject(ref) ? ref.sourceId : ref;
    if (!id || !sourceById.has(id)) {
      return { ok: false, code: "RULE_PROVENANCE_MISSING", message: `rule ${capability} references unknown source ${id}` };
    }
    out.sourceRefs.push(id);
  }
  if (out.sourceRefs.length === 0) {
    return { ok: false, code: "RULE_PROVENANCE_MISSING", message: `rule ${capability} carries no source provenance` };
  }
  return { ok: true, rule: out };
}

function normalizeCostObservation(obs, index, sourceById) {
  if (!isObject(obs)) return { ok: false, code: "COST_INVALID", message: `cost #${index} must be an object` };
  if (!shared.COST_UNITS.includes(obs.unit)) {
    return { ok: false, code: "COST_UNIT_INVALID", message: `cost unit must be ${shared.COST_UNITS.join("|")}` };
  }
  const out = {
    unit: obs.unit,
    value: obs.value === null || obs.value === undefined ? null : obs.value,
    context: {
      workflow: (obs.context && obs.context.workflow) || null,
      durationSeconds: (obs.context && obs.context.durationSeconds) !== undefined ? obs.context.durationSeconds : null,
      subscriptionTier: (obs.context && obs.context.subscriptionTier) || null,
      resolution: (obs.context && obs.context.resolution) || null,
    },
    sourceRefs: [],
    observedAt: obs.observedAt || null,
    freshness: shared.FRESHNESS_STATES.includes(obs.freshness) ? obs.freshness : "UNKNOWN",
  };
  for (const ref of obs.sourceRefs || []) {
    const id = isObject(ref) ? ref.sourceId : ref;
    if (!id || !sourceById.has(id)) {
      return { ok: false, code: "COST_PROVENANCE_MISSING", message: `cost observation references unknown source ${id}` };
    }
    out.sourceRefs.push(id);
  }
  if (out.sourceRefs.length === 0) {
    return { ok: false, code: "COST_PROVENANCE_MISSING", message: "cost observation carries no source provenance" };
  }
  return { ok: true, observation: out };
}

function normalizeModel(raw, sourceById) {
  if (!isObject(raw)) return { ok: false, code: "MODEL_INVALID", message: "model must be an object" };
  if (!raw.providerId || !raw.surfaceId) {
    return { ok: false, code: "MODEL_SURFACE_REQUIRED", message: "model needs providerId + surfaceId" };
  }
  const modelId = raw.modelId || shared.stableModelId(raw.providerId, raw.modelFamily, raw.modelVersionOrTier);
  const model = {
    modelId,
    providerId: raw.providerId,
    surfaceId: raw.surfaceId,
    providerLabel: raw.providerLabel || null, // external truth, may change
    modelFamily: raw.modelFamily || null,
    modelVersionOrTier: raw.modelVersionOrTier !== undefined ? raw.modelVersionOrTier : null,
    mediaKinds: Array.isArray(raw.mediaKinds) ? [...raw.mediaKinds] : [],
    capabilityRules: [],
    availability: shared.AVAILABILITY_STATES.includes(raw.availability) ? raw.availability : "UNKNOWN",
    availabilitySourceRefs: [],
    availabilityObservedAt: raw.availabilityObservedAt || null,
    providerTier: raw.providerTier || null, // declared label only, never a score
    notes: typeof raw.notes === "string" ? raw.notes : null, // documentary note, never selection logic
    costObservations: [],
    sourceRefs: [],
    observedAt: raw.observedAt || null,
    status: ["ACTIVE", "RETIRED", "UNKNOWN"].includes(raw.status) ? raw.status : "UNKNOWN",
  };
  for (const ref of raw.sourceRefs || []) {
    const id = isObject(ref) ? ref.sourceId : ref;
    if (!id || !sourceById.has(id)) return { ok: false, code: "MODEL_PROVENANCE_MISSING", message: `model ${modelId} references unknown source ${id}` };
    model.sourceRefs.push(id);
  }
  for (const ref of raw.availabilitySourceRefs || []) {
    const id = isObject(ref) ? ref.sourceId : ref;
    if (id && sourceById.has(id)) model.availabilitySourceRefs.push(id);
  }
  let i = 0;
  for (const rule of raw.capabilityRules || []) {
    const n = normalizeCapabilityRule(rule, i++, sourceById);
    if (!n.ok) return { ok: false, code: n.code, message: `${modelId}: ${n.message}` };
    model.capabilityRules.push(n.rule);
  }
  i = 0;
  for (const obs of raw.costObservations || []) {
    const n = normalizeCostObservation(obs, i++, sourceById);
    if (!n.ok) return { ok: false, code: n.code, message: `${modelId}: ${n.message}` };
    model.costObservations.push(n.observation);
  }
  return { ok: true, model };
}

function freshnessRollup(items) {
  // UNKNOWN when nothing is known; STALE when any part is stale; else FRESH.
  // Cost/capability/availability freshness never collapse into each other —
  // the caller rolls up per category.
  if (items.length === 0) return "UNKNOWN";
  if (items.some((f) => f === "STALE")) return "STALE";
  if (items.some((f) => f === "FRESH")) return "FRESH";
  return "UNKNOWN";
}

function modelFreshness(model) {
  return {
    capability: freshnessRollup(model.capabilityRules.map((r) => r.freshness)),
    availability: model.availabilitySourceRefs.length > 0
      ? (model.availability === "UNKNOWN" ? "UNKNOWN" : "FRESH")
      : "UNKNOWN",
    cost: freshnessRollup(model.costObservations.map((o) => o.freshness)),
  };
}

/**
 * Build a normalized registry snapshot from raw input.
 * Input: { snapshotId?, createdAt?, surfaces[], models[], sources[] }
 * Sources are normalized first so every fact can resolve provenance.
 */
function buildSnapshot(input = {}) {
  const blockers = [];
  const sources = [];
  const sourceById = new Map();
  (input.sources || []).forEach((s, i) => {
    const n = normalizeSourceRef(s, i);
    if (!n.ok) blockers.push(`${n.code}: ${n.message}`);
    else { sources.push(n.source); sourceById.set(n.source.sourceId, n.source); }
  });
  const surfaces = [];
  for (const s of input.surfaces || []) {
    if (!isObject(s) || !s.surfaceId || !s.providerId) {
      blockers.push(`SURFACE_INVALID: surface needs surfaceId + providerId`);
      continue;
    }
    surfaces.push({
      surfaceId: s.surfaceId,
      providerId: s.providerId,
      displayName: s.displayName || s.surfaceId,
      status: shared.SURFACE_STATUS.includes(s.status) ? s.status : "UNKNOWN",
      sourceRefs: (s.sourceRefs || []).filter((id) => sourceById.has(isObject(id) ? id.sourceId : id))
        .map((id) => (isObject(id) ? id.sourceId : id)),
      observedAt: s.observedAt || null,
      freshness: shared.FRESHNESS_STATES.includes(s.freshness) ? s.freshness : "UNKNOWN",
      metadata: isObject(s.metadata) ? s.metadata : {},
    });
  }
  const surfaceIds = new Set(surfaces.map((s) => s.surfaceId));
  const models = [];
  for (const m of input.models || []) {
    const n = normalizeModel(m, sourceById);
    if (!n.ok) { blockers.push(`${n.code}: ${n.message}`); continue; }
    if (!surfaceIds.has(n.model.surfaceId)) {
      blockers.push(`MODEL_SURFACE_UNKNOWN: model ${n.model.modelId} references unregistered surface ${n.model.surfaceId}`);
      continue;
    }
    models.push({ ...n.model, freshness: modelFreshness(n.model) });
  }
  models.sort((a, b) => (a.modelId < b.modelId ? -1 : 1));
  if (blockers.length > 0) return { ok: false, blockers };
  const snapshotId = input.snapshotId || shared.id12("rs", { surfaces: surfaces.map((s) => s.surfaceId), models: models.map((m) => m.modelId) });
  const snapshot = {
    version: shared.REGISTRY_VERSION,
    snapshotId,
    createdAt: input.createdAt || new Date().toISOString(),
    surfaces,
    models,
    sources,
    fingerprint: null,
  };
  snapshot.fingerprint = shared.hash16({
    version: snapshot.version, surfaces, models, sources,
  });
  return { ok: true, snapshot };
}

function loadSeedFile(filePath) {
  const fs = require("fs");
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  return buildSnapshot(raw);
}

module.exports = {
  buildSnapshot,
  loadSeedFile,
  normalizeModel,
  normalizeCapabilityRule,
  normalizeCostObservation,
  normalizeSourceRef,
  modelFreshness,
  freshnessRollup,
};
