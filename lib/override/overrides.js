"use strict";

/**
 * Phase 3C §6–§13 — Manual Override Layer (UNFOLDIQ CORE).
 *
 * Versioned, durable operator intent with explicit precedence, stale
 * detection, and undo/redo/reset as first-class state transitions.
 * Precedence: SAFETY > OPERATOR > LOCKED > SYSTEM_REPAIR > AGENT > DEFAULT.
 * Overrides replay onto fresh agent builds (survive rerun) until
 * reset/superseded/conflicted. No free-form code mutation.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const OVERRIDE_VERSION = "1.0.0";

const TARGET_TYPES = ["TIMELINE_ITEM", "SCENE", "MOTION", "TRANSITION", "CAPTION_STYLE", "RESPONSIVE_VARIANT"];
const OPERATIONS = [
  "REPLACE_ASSET", "ADJUST_VISUAL_TIMING",
  "LOCK_ITEM", "UNLOCK_ITEM", "LOCK_SCENE", "UNLOCK_SCENE",
  "FORCE_VISUAL_MODALITY", "FORCE_STATIC", "FORCE_MOTION_PRIMITIVE",
  "CHANGE_TRANSITION", "CHANGE_MOTION_TIMING", "CHANGE_CAPTION_STYLE",
  "REQUEST_REGENERATE_SCENE", "REQUEST_REGENERATE_ASSET",
  "SET_LAYOUT", "SET_CROP", "SET_SCALE", "SET_POSITION", "SET_SUBJECT_ANCHOR",
  "RESET_OVERRIDE", "RESET_OVERRIDE_SCOPE",
];
const SCOPES = ["GLOBAL", "BASE_TIMELINE", "VARIANT_ONLY"];
const SOURCES = ["OPERATOR", "AGENT", "SYSTEM_REPAIR"];
const STATUSES = ["ACTIVE", "SUPERSEDED", "RESET", "CONFLICT"];
const KNOWN_MODALITIES = ["MAP", "TIMELINE", "CHART", "DIAGRAM", "TYPOGRAPHY", "COMPARISON", "RECONSTRUCTION", "CHARACTER_MOMENT", "ATMOSPHERE", "METAPHOR", "ANNOTATION", "SPLIT_SCREEN", "MOTION_GRAPHIC"];
const SPEECH_TRACKS = new Set(["NARRATION", "CAPTION"]);

function sha12(v) {
  return crypto.createHash("sha256").update(JSON.stringify(v), "utf8").digest("hex").slice(0, 12);
}
function nowIso() { return new Date().toISOString(); }

function finding(code, extra = {}) {
  return { code, severity: extra.severity || "REVIEW", target: extra.target || null, reason: extra.reason || code, correctiveAction: extra.correctiveAction || null };
}

function targetKey(target) {
  if (!target || !target.type) return "unknown";
  return [target.type, target.timelineItemId || target.sceneId || target.motionItemId || target.transitionId || target.variantId || target.profileRef || ""].join(":");
}

function clone(o) { return JSON.parse(JSON.stringify(o)); }

// ---------- record ----------

function validateOverrideInput(input = {}) {
  const errors = [];
  if (!input.target || !TARGET_TYPES.includes(input.target.type)) errors.push(`OVERRIDE_TARGET_MISSING: target.type must be ${TARGET_TYPES.join("|")}`);
  if (!OPERATIONS.includes(input.operation)) errors.push(`invalid operation ${input.operation}`);
  if (input.scope && !SCOPES.includes(input.scope)) errors.push(`invalid scope ${input.scope}`);
  if (input.operation === "CHANGE_CAPTION_STYLE" && input.payload) {
    if (input.payload.text !== undefined || input.payload.timing !== undefined || input.payload.words !== undefined) {
      errors.push("OVERRIDE_BREAKS_TIMING: caption style override must not carry text/timing");
    }
  }
  return errors;
}

/**
 * Apply (record) a manual override against current canonical state.
 * context: { timelineManifest?, motionPlan?, assetResolver?, baseRevision?,
 *   variantId? (for VARIANT_ONLY scope), policyCheck?(override) → {ok, reason} }
 */
function applyManualOverride(store, input = {}, context = {}) {
  const errs = validateOverrideInput(input);
  if (errs.length) return { ok: false, code: "OVERRIDE_INVALID_LAYOUT", findings: errs.map((e) => finding("OVERRIDE_INVALID_LAYOUT", { severity: "BLOCK", reason: e, correctiveAction: "REPLACE" })) };
  const source = input.source || "OPERATOR";

  // Safety / correctness hard block (beats operator intent, RULE 2).
  const safety = checkSafety(input, context);
  if (!safety.ok) return { ok: false, code: safety.code, findings: [safety.finding] };

  const record = {
    overrideId: input.overrideId || `ovr-${sha12({ t: targetKey(input.target), op: input.operation, p: input.payload || {}, s: store.revision })}`,
    version: OVERRIDE_VERSION,
    projectId: store.projectId,
    target: clone(input.target),
    operation: input.operation,
    payload: clone(input.payload || {}),
    scope: input.scope || (input.target.type === "RESPONSIVE_VARIANT" ? "VARIANT_ONLY" : "GLOBAL"),
    source,
    priority: source === "OPERATOR" ? 100 : source === "SYSTEM_REPAIR" ? 40 : 10,
    reason: input.reason || null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    baseRevision: context.baseRevision !== undefined ? context.baseRevision : (context.timelineManifest ? context.timelineManifest.revision || 0 : 0),
    dependencyHashes: dependencyHashesFor(input, context),
    status: "ACTIVE",
    variantId: input.variantId || context.variantId || null,
  };
  // Supersede older ACTIVE records on the same target+operation family.
  for (const r of store.records) {
    if (r.status === "ACTIVE" && targetKey(r.target) === targetKey(record.target) && r.operation === record.operation
      && (r.variantId || null) === (record.variantId || null)) {
      r.status = "SUPERSEDED";
      r.updatedAt = nowIso();
    }
  }
  const prev = store.records.find((r) => r.overrideId === record.overrideId);
  if (prev && prev.status === "ACTIVE") {
    return { ok: true, record: prev, idempotent: true, commit: null };
  }
  store.records.push(record);
  const commit = appendHistory(store, { operation: record.operation, target: record.target, before: null, after: { status: "ACTIVE" }, source, reason: record.reason, overrideId: record.overrideId });
  store.revision += 1;
  return { ok: true, record, commit };
}

function dependencyHashesFor(input, context) {
  const h = {};
  const man = context.timelineManifest;
  if (man && input.target && input.target.timelineItemId) {
    const item = man.items.find((i) => i.timelineItemId === input.target.timelineItemId);
    if (item) {
      h.asset = (item.dependencyHashes && item.dependencyHashes.asset) || "unknown";
      h.timelineRange = sha12(item.timelineRange);
    }
  }
  if (input.target && input.target.type === "SCENE" && man) {
    h.scene = sha12(man.items.filter((i) => i.sceneId === input.target.sceneId).map((i) => i.timelineItemId).sort());
  }
  if (context.motionPlan) h.motionPlanRevision = String(context.motionPlan.revision || 0);
  return h;
}

/** Hard safety/correctness gates. Operator intent never bypasses these. */
function checkSafety(input, context) {
  const block = (code, reason, correctiveAction) => ({ ok: false, code, finding: finding(code, { severity: "BLOCK", target: targetKey(input.target), reason, correctiveAction }) });
  const man = context.timelineManifest;
  const resolve = context.assetResolver;
  if (input.operation === "REPLACE_ASSET") {
    if (!resolve) return block("OVERRIDE_INVALID_ASSET", "assetResolver required to validate replacement", "REPLACE");
    const asset = resolve(input.payload && input.payload.assetId);
    if (!asset || !asset.hash) return block("OVERRIDE_INVALID_ASSET", `replacement asset ${input.payload && input.payload.assetId} unresolvable`, "REPLACE");
  }
  if (input.operation === "ADJUST_VISUAL_TIMING" && man) {
    const item = man.items.find((i) => i.timelineItemId === (input.target && input.target.timelineItemId));
    if (!item) return block("OVERRIDE_TARGET_MISSING", "timing target not on timeline", "REPLACE");
    if (SPEECH_TRACKS.has(item.trackType)) return block("OVERRIDE_BREAKS_TIMING", "speech-bound timing owned by Final Audio — route upstream via Phase 2", "REVIEW");
    const r = input.payload && input.payload.timelineRange;
    if (!r || r.endTime <= r.startTime || r.startTime < 0 || r.endTime > man.canonicalDuration.time) {
      return block("OVERRIDE_BREAKS_TIMING", "visual retime outside canonical audio duration", "REPLACE");
    }
  }
  if (input.operation === "CHANGE_TRANSITION" && context.motionPlan) {
    const mp = require("../motion/motion-plan.js");
    const flashes = (input.payload && input.payload.flashes) || [];
    const prim = input.payload && input.payload.primitiveRef;
    const primDef = prim ? require("../motion/primitives.js").getPrimitive(prim) : null;
    if (prim && !primDef) return block("OVERRIDE_INVALID_TRANSITION", `unknown transition primitive ${prim}`, "REPLACE");
    if (primDef && primDef.safety.mayFlash && flashes.length > 0) {
      const rate = { numerator: 30, denominator: 1 };
      const g = require("../motion/grammar.js");
      const fs = g.validateFlashSafety({ flashes, frameRate: rate, mayFlash: true });
      if (fs.decision === "BLOCK") return block("OVERRIDE_BREAKS_SAFETY", fs.reason, "REPLACE_TRANSITION");
    }
  }
  if (input.operation === "FORCE_MOTION_PRIMITIVE") {
    const primDef = require("../motion/primitives.js").getPrimitive(input.payload && input.payload.primitiveRef);
    if (!primDef) return block("OVERRIDE_INVALID_TRANSITION", `unknown motion primitive ${input.payload && input.payload.primitiveRef}`, "REPLACE");
  }
  if (input.operation === "FORCE_VISUAL_MODALITY") {
    const m = input.payload && input.payload.visualModality;
    if (!KNOWN_MODALITIES.includes(m)) return block("OVERRIDE_INVALID_LAYOUT", `unknown visual modality ${m}`, "REPLACE");
  }
  if (typeof context.policyCheck === "function") {
    const pc = context.policyCheck(input);
    if (!pc.ok) return block("OVERRIDE_BREAKS_SAFETY", pc.reason || "policy check refused the override", "REVIEW");
  }
  return { ok: true };
}

// ---------- reset ----------

function resetManualOverride(store, overrideId, reason) {
  const rec = store.records.find((r) => r.overrideId === overrideId);
  if (!rec) return { ok: false, code: "OVERRIDE_TARGET_MISSING", message: "overrideId not found" };
  if (rec.status === "RESET") return { ok: true, record: rec, idempotent: true, commit: null };
  const before = { status: rec.status };
  rec.status = "RESET";
  rec.updatedAt = nowIso();
  const commit = appendHistory(store, { operation: "RESET_OVERRIDE", target: rec.target, before, after: { status: "RESET" }, source: "OPERATOR", reason: reason || "operator reset", overrideId });
  store.revision += 1;
  return { ok: true, record: rec, commit };
}

function resetOverrideScope(store, scope, reason) {
  if (!SCOPES.includes(scope)) return { ok: false, code: "OVERRIDE_INVALID_LAYOUT", message: "unknown scope" };
  const touched = [];
  for (const rec of store.records) {
    if (rec.status === "ACTIVE" && rec.scope === scope) {
      rec.status = "RESET";
      rec.updatedAt = nowIso();
      touched.push(rec.overrideId);
    }
  }
  const commit = appendHistory(store, { operation: "RESET_OVERRIDE_SCOPE", target: { type: "RESPONSIVE_VARIANT", scope }, before: { count: touched.length }, after: { reset: touched }, source: "OPERATOR", reason: reason || "scope reset", overrideId: null });
  store.revision += 1;
  return { ok: true, reset: touched, commit };
}

// ---------- history / undo / redo ----------

function appendHistory(store, entry) {
  const commit = { commitId: `cm-${sha12({ r: store.revision, e: entry })}`, revision: store.revision, timestamp: nowIso(), undone: false, ...clone(entry) };
  store.history.push(commit);
  return commit;
}

function lastEligibleCommit(store, source) {
  for (let i = store.history.length - 1; i >= 0; i--) {
    const c = store.history[i];
    if (!c.undone && (!source || c.source === source) && c.operation !== "RESET_OVERRIDE" && c.operation !== "RESET_OVERRIDE_SCOPE") return c;
  }
  return null;
}

function targetTouchedSince(store, key, revision) {
  // UNDO/REDO bookkeeping commits are not substantive touches.
  return store.history.some((c) => c.revision > revision && !c.undone && c.target && targetKey(c.target) === key
    && c.operation !== "UNDO" && c.operation !== "REDO");
}

function undoOverride(store, reason) {
  const c = lastEligibleCommit(store, "OPERATOR");
  if (!c) return { ok: false, code: "UNDO_CONFLICT", message: "nothing eligible to undo" };
  const key = c.target ? targetKey(c.target) : null;
  if (key && targetTouchedSince(store, key, c.revision)) {
    return { ok: false, code: "UNDO_CONFLICT", message: `target ${key} changed after commit ${c.commitId}` };
  }
  c.undone = true;
  const rec = c.overrideId ? store.records.find((r) => r.overrideId === c.overrideId) : null;
  if (rec && rec.status === "ACTIVE") { rec.status = "SUPERSEDED"; rec.updatedAt = nowIso(); }
  const commit = appendHistory(store, { operation: "UNDO", target: c.target, before: { undoneCommit: c.commitId }, after: { undone: true }, source: "OPERATOR", reason: reason || "undo", overrideId: c.overrideId || null });
  store.revision += 1;
  return { ok: true, undone: c.commitId, commit };
}

function redoOverride(store, reason) {
  for (let i = store.history.length - 1; i >= 0; i--) {
    const c = store.history[i];
    if (c.undone && c.source === "OPERATOR" && c.operation !== "UNDO" && c.operation !== "REDO") {
      const key = c.target ? targetKey(c.target) : null;
      if (key && targetTouchedSince(store, key, c.revision)) {
        return { ok: false, code: "REDO_CONFLICT", message: `target ${key} changed since undo` };
      }
      c.undone = false;
      const rec = c.overrideId ? store.records.find((r) => r.overrideId === c.overrideId) : null;
      if (rec && rec.status !== "RESET") { rec.status = "ACTIVE"; rec.updatedAt = nowIso(); }
      const commit = appendHistory(store, { operation: "REDO", target: c.target, before: { redoneCommit: c.commitId }, after: { undone: false }, source: "OPERATOR", reason: reason || "redo", overrideId: c.overrideId || null });
      store.revision += 1;
      return { ok: true, redone: c.commitId, commit };
    }
  }
  return { ok: false, code: "REDO_CONFLICT", message: "nothing undone to redo" };
}

function getOverrideHistory(store) {
  return { ok: true, revision: store.revision, history: clone(store.history) };
}

// ---------- staleness ----------

function checkOverrideFreshness(record, current) {
  // current: { timelineRevision, assetHash?, timelineRangeHash?, sceneHash?, motionPlanRevision? }
  if (!current) return { ok: true };
  if (current.timelineRevision !== undefined && current.timelineRevision !== record.baseRevision) {
    const dep = record.dependencyHashes || {};
    const sameAsset = current.assetHash === undefined || current.assetHash === dep.asset;
    const sameRange = current.timelineRangeHash === undefined || current.timelineRangeHash === dep.timelineRange;
    const sameScene = current.sceneHash === undefined || current.sceneHash === dep.scene;
    if (sameAsset && sameRange && sameScene) {
      return { ok: true, rebased: true }; // target semantics identical — safe rebase
    }
    return { ok: false, code: "OVERRIDE_CONFLICT", reason: `override ${record.overrideId} created at base revision ${record.baseRevision}, target now ${current.timelineRevision} with changed semantics` };
  }
  return { ok: true };
}

// ---------- replay onto fresh builds (survives rerun) ----------

function activeOverrides(store, variantId = null) {
  return store.records.filter((r) => {
    if (r.status !== "ACTIVE") return false;
    if (r.scope === "VARIANT_ONLY") return (r.variantId || null) === (variantId || null);
    return true; // GLOBAL + BASE_TIMELINE apply to base and (GLOBAL) to variants
  });
}

/**
 * Replay ACTIVE overrides onto a fresh timeline manifest + motion plan.
 * Returns { manifest, motionPlan, applied[], conflicts[], findings[] }.
 * Conflicts never silently apply (RULE 6).
 */
function rebaseOntoBuild(store, fresh, context = {}) {
  const manifest = clone(fresh.manifest);
  const motionPlan = fresh.motionPlan ? clone(fresh.motionPlan) : null;
  const applied = [];
  const conflicts = [];
  const findings = [];
  for (const rec of store.records) {
    if (rec.status !== "ACTIVE") continue;
    if (rec.scope === "VARIANT_ONLY") continue; // variant layer consumes these
    const current = currentTargetState(rec, manifest, motionPlan);
    const fresh2 = checkOverrideFreshness(rec, current);
    if (!fresh2.ok) {
      rec.status = "CONFLICT";
      rec.updatedAt = nowIso();
      conflicts.push(rec.overrideId);
      findings.push(finding("OVERRIDE_CONFLICT", { severity: "BLOCK", target: targetKey(rec.target), reason: fresh2.reason, correctiveAction: "REBASE" }));
      continue;
    }
    const r = applyRecordToBuild(rec, manifest, motionPlan, context);
    if (!r.ok) {
      findings.push(finding(r.code || "OVERRIDE_CONFLICT", { severity: "BLOCK", target: targetKey(rec.target), reason: r.message, correctiveAction: "REVIEW" }));
      continue;
    }
    if (fresh2.rebased) { rec.baseRevision = manifest.revision || rec.baseRevision; rec.updatedAt = nowIso(); }
    applied.push(rec.overrideId);
  }
  return { manifest, motionPlan, applied, conflicts, findings };
}

function currentTargetState(rec, manifest, motionPlan) {
  const t = rec.target || {};
  const state = { timelineRevision: manifest.revision || 0 };
  if (t.timelineItemId) {
    const item = manifest.items.find((i) => i.timelineItemId === t.timelineItemId);
    if (!item) return { ...state, missing: true };
    state.assetHash = (item.dependencyHashes && item.dependencyHashes.asset) || "unknown";
    state.timelineRangeHash = sha12(item.timelineRange);
  }
  if (t.type === "SCENE") {
    state.sceneHash = sha12(manifest.items.filter((i) => i.sceneId === t.sceneId).map((i) => i.timelineItemId).sort());
  }
  if (motionPlan) state.motionPlanRevision = motionPlan.revision;
  if (t.timelineItemId && !manifest.items.some((i) => i.timelineItemId === t.timelineItemId)) return { ...state, missing: true };
  return state;
}

function applyRecordToBuild(rec, manifest, motionPlan, context) {
  const t = rec.target;
  const p = rec.payload || {};
  const findItem = (id) => manifest.items.find((i) => i.timelineItemId === id);
  switch (rec.operation) {
    case "REPLACE_ASSET": {
      const item = findItem(t.timelineItemId);
      if (!item) return { ok: false, code: "OVERRIDE_TARGET_MISSING", message: "target item gone" };
      const asset = context.assetResolver ? context.assetResolver(p.assetId) : null;
      if (!asset || !asset.hash) return { ok: false, code: "OVERRIDE_INVALID_ASSET", message: "replacement unresolvable at replay" };
      item.assetId = p.assetId;
      item.dependencyHashes = { ...(item.dependencyHashes || {}), asset: String(asset.hash) };
      return { ok: true };
    }
    case "ADJUST_VISUAL_TIMING": {
      const item = findItem(t.timelineItemId);
      if (!item) return { ok: false, code: "OVERRIDE_TARGET_MISSING", message: "target item gone" };
      if (SPEECH_TRACKS.has(item.trackType)) return { ok: false, code: "OVERRIDE_BREAKS_TIMING", message: "speech timing protected" };
      item.timelineRange = { ...item.timelineRange, startTime: p.timelineRange.startTime, endTime: p.timelineRange.endTime };
      return { ok: true };
    }
    case "LOCK_ITEM": {
      const item = findItem(t.timelineItemId || (t.motionItemId && motionItemLink(motionPlan, t.motionItemId)));
      if (t.motionItemId && motionPlan) {
        const m = motionPlan.items.find((m2) => m2.motionItemId === t.motionItemId);
        if (!m) return { ok: false, code: "OVERRIDE_TARGET_MISSING", message: "motion target gone" };
        m.locked = true;
        return { ok: true };
      }
      if (!item) return { ok: false, code: "OVERRIDE_TARGET_MISSING", message: "target item gone" };
      item.locked = true;
      return { ok: true };
    }
    case "UNLOCK_ITEM": {
      const item = findItem(t.timelineItemId);
      if (!item) return { ok: false, code: "OVERRIDE_TARGET_MISSING", message: "target item gone" };
      item.locked = false;
      return { ok: true };
    }
    case "LOCK_SCENE":
    case "UNLOCK_SCENE": {
      const lock = rec.operation === "LOCK_SCENE";
      for (const item of manifest.items) {
        if (item.sceneId === t.sceneId) item.locked = lock;
      }
      return { ok: true };
    }
    case "FORCE_STATIC": {
      if (!motionPlan) return { ok: false, code: "OVERRIDE_TARGET_MISSING", message: "no motion plan" };
      const m = motionPlan.items.find((m2) => m2.motionItemId === t.motionItemId || m2.timelineItemId === t.timelineItemId);
      if (!m) return { ok: false, code: "OVERRIDE_TARGET_MISSING", message: "motion target gone" };
      m.presence = "STATIC"; m.primitiveRef = null; m.reason = `operator FORCE_STATIC${rec.reason ? `: ${rec.reason}` : ""}`;
      return { ok: true };
    }
    case "FORCE_MOTION_PRIMITIVE": {
      if (!motionPlan) return { ok: false, code: "OVERRIDE_TARGET_MISSING", message: "no motion plan" };
      const m = motionPlan.items.find((m2) => m2.motionItemId === t.motionItemId || m2.timelineItemId === t.timelineItemId);
      if (!m) return { ok: false, code: "OVERRIDE_TARGET_MISSING", message: "motion target gone" };
      m.primitiveRef = p.primitiveRef;
      if (p.params) m.params = p.params;
      if (m.presence === "STATIC") m.presence = "SUBTLE";
      m.reason = `operator FORCE_MOTION_PRIMITIVE ${p.primitiveRef}`;
      return { ok: true };
    }
    case "FORCE_VISUAL_MODALITY": {
      manifest.operatorModality = manifest.operatorModality || {};
      manifest.operatorModality[t.sceneId || t.timelineItemId || "global"] = p.visualModality;
      return { ok: true };
    }
    case "CHANGE_TRANSITION":
    case "CHANGE_MOTION_TIMING":
    case "CHANGE_CAPTION_STYLE":
    case "SET_LAYOUT":
    case "SET_CROP":
    case "SET_SCALE":
    case "SET_POSITION":
    case "SET_SUBJECT_ANCHOR": {
      // Carried as durable intent; consumed by motion-plan patch / responsive
      // derivation. Recorded + replayed = survives rerun (proven by status).
      manifest.operatorIntents = manifest.operatorIntents || [];
      manifest.operatorIntents.push({ overrideId: rec.overrideId, operation: rec.operation, target: t, payload: p });
      return { ok: true };
    }
    case "REQUEST_REGENERATE_SCENE": {
      return { ok: true, regenerateScope: { sceneId: t.sceneId, branchDirty: true } };
    }
    case "REQUEST_REGENERATE_ASSET": {
      return { ok: true, regenerateScope: { asset: true, branchDirty: true } };
    }
    default:
      return { ok: false, code: "OVERRIDE_INVALID_LAYOUT", message: `no applicator for ${rec.operation}` };
  }
}

function motionItemLink(motionPlan, motionItemId) {
  const m = motionPlan && motionPlan.items.find((x) => x.motionItemId === motionItemId);
  return m ? m.timelineItemId : null;
}

/** Single-scene regenerate routing: only the target branch is dirty. */
function regenerateScopeFor(store, overrideId) {
  const rec = store.records.find((r) => r.overrideId === overrideId);
  if (!rec || rec.operation !== "REQUEST_REGENERATE_SCENE") {
    return { ok: false, code: "OVERRIDE_TARGET_MISSING", message: "not a scene-regenerate request" };
  }
  return {
    ok: true,
    scope: {
      sceneId: rec.target.sceneId,
      sceneBranchDirty: true,
      unrelatedScenesClean: true,
      finalAudioClean: true,
      alignmentClean: true,
      captionsClean: true,
    },
  };
}

// ---------- persistence (workspace governance) ----------

function storeFileNames() {
  return { overrides: "overrides.json" };
}

function persistOverrideStore(root, projectId, store) {
  const ws = require("../workspace/index.js");
  const resolved = ws.resolveArtifactPath(root, projectId, "TIMELINE", "DURABLE", { fileName: storeFileNames().overrides });
  if (!resolved.ok) return resolved;
  const guard = ws.validateWorkspacePath(root, resolved.path, { projectId });
  if (!guard.ok) return guard;
  fs.mkdirSync(path.dirname(resolved.path), { recursive: true });
  const tmp = `${resolved.path}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ version: OVERRIDE_VERSION, projectId, revision: store.revision, records: store.records, history: store.history }, null, 2), "utf8");
  fs.renameSync(tmp, resolved.path);
  return { ok: true, path: resolved.path };
}

function loadOverrideStore(root, projectId) {
  const ws = require("../workspace/index.js");
  const resolved = ws.resolveArtifactPath(root, projectId, "TIMELINE", "DURABLE", { fileName: storeFileNames().overrides });
  if (!resolved.ok) return resolved;
  if (!fs.existsSync(resolved.path)) return { ok: false, code: "NOT_FOUND", message: "no persisted override store" };
  let raw;
  try { raw = JSON.parse(fs.readFileSync(resolved.path, "utf8")); }
  catch (e) { return { ok: false, code: "REGISTRY_INVALID", message: String((e && e.message) || e) }; }
  if (!raw || !Array.isArray(raw.records) || !Array.isArray(raw.history)) {
    return { ok: false, code: "SCHEMA_INVALID", message: "override store shape invalid" };
  }
  return { ok: true, store: createOverrideStore(projectId, { records: raw.records, history: raw.history, revision: raw.revision || 0 }), path: resolved.path };
}

// ---------- store ----------

function createOverrideStore(projectId, seed = {}) {
  const store = {
    projectId,
    revision: seed.revision || 0,
    records: clone(seed.records || []),
    history: clone(seed.history || []),
  };
  return {
    _state: store,
    apply(input, context) { return applyManualOverride(store, input, context || {}); },
    reset(overrideId, reason) { return resetManualOverride(store, overrideId, reason); },
    resetScope(scope, reason) { return resetOverrideScope(store, scope, reason); },
    undo(reason) { return undoOverride(store, reason); },
    redo(reason) { return redoOverride(store, reason); },
    history() { return getOverrideHistory(store); },
    records() { return clone(store.records); },
    active(variantId) { return clone(activeOverrides(store, variantId || null)); },
    rebase(fresh, context) { return rebaseOntoBuild(store, fresh, context || {}); },
    regenerateScope(overrideId) { return regenerateScopeFor(store, overrideId); },
    persist(root) { return persistOverrideStore(root, projectId, store); },
  };
}

module.exports = {
  OVERRIDE_VERSION,
  TARGET_TYPES,
  OPERATIONS,
  SCOPES,
  SOURCES,
  STATUSES,
  applyManualOverride,
  resetManualOverride,
  resetOverrideScope,
  undoOverride,
  redoOverride,
  getOverrideHistory,
  checkOverrideFreshness,
  activeOverrides,
  rebaseOntoBuild,
  regenerateScopeFor,
  persistOverrideStore,
  loadOverrideStore,
  createOverrideStore,
  targetKey,
};
