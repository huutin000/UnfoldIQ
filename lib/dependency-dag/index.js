"use strict";

/**
 * Phase 1H.3 — Artifact Dependency DAG + dirty propagation (UNFOLDIQ CORE).
 *
 * One canonical graph: nodes keyed by artifactKey, edges = inputRefs
 * (upstream keys + optional dependency type). Version/hash-aware
 * fingerprints; deterministic forward invalidation; lock-aware
 * BLOCKED-instead-of-regenerate; selective rebuild planning; bounded
 * partial rerun with an injected executor (no real provider calls here).
 *
 * Store: projects/<pid>/dependency-dag.json (single atomic JSON).
 * References manifest artifact versions by value (versionRef strings),
 * never bodies. 1H.2 locks are consulted through an injected reader —
 * never duplicated.
 *
 * Deliberately NOT here (G37): 1H.4 observability product, golden
 * projects, scheduler. Minimal forward hooks only.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const costShared = require("../output-cost/shared.js");
const manifestLib = require("../project-manifest/index.js");
const historyLib = require("../generation-history/index.js");

const DAG_SCHEMA_VERSION = "1.0.0";
const DAG_REL = "dependency-dag.json";

const ARTIFACT_TYPES = ["CREATIVE_BRIEF", "RESEARCH_PACK", "FINAL_SPOKEN_SCRIPT", "SPOKEN_HUMANIZATION", "EVIDENCE_FIDELITY_DECISION", "NATURALNESS_QA", "VOICE_BIBLE", "VOICE", "NARRATION_DIRECTION", "PRONUNCIATION_PROFILE", "PRONUNCIATION_RUNTIME_PASS", "TTS_READY_PLAN", "TTS_SEGMENT_AUDIO", "SPEECH_RATE_QA", "PERFORMANCE_QA", "FINAL_NARRATION_TRACK", "DIALOGUE_ROUTING_DECISION", "FINAL_AUDIO", "FORCED_ALIGNMENT", "CAPTIONS", "SHOT_PLAN", "PROMPT_PACKAGE", "GENERATED_ASSET", "QA_RESULT", "MASTER_TIMELINE", "SCENE_TIMING", "VISUAL_TIMING", "ANIMATION_TIMING", "RENDER", "THUMBNAIL", "PUBLISH_PACKAGE", "POLICY_SNAPSHOT", "COMPLIANCE_DECISION", "PROVENANCE_REF"];
const NODE_STATES = ["NOT_CREATED_YET", "CLEAN", "DIRTY", "BUILDING", "FAILED", "BLOCKED"];

const ERRORS = {
  DAG_NOT_FOUND: "dependency graph store does not exist for this project",
  DAG_STATE_INVALID: "graph store fails validation",
  DAG_NODE_NOT_FOUND: "unknown artifact node",
  DAG_EDGE_INVALID: "dependency edge invalid (unknown node or bad shape)",
  DAG_VERSION_CONFLICT: "stale writer on the graph",
  DAG_CYCLE_DETECTED: "edge would create a dependency cycle",
  ARTIFACT_DIRTY: "artifact is dirty; rebuild explicitly",
  LOCKED_DIRTY_ARTIFACT: "locked downstream is dirty-blocked; unlock/revise first",
  REBUILD_BLOCKED: "rebuild plan contains blocked nodes",
};

let ajvValidator = null;
function validator() {
  if (!ajvValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const root = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "recovery-state.schema.json"), "utf8"));
    ajvValidator = ajv.compile({ ...root, $ref: "#/definitions/dagDoc" });
  }
  return ajvValidator;
}

function nowIso(now) {
  return now || new Date().toISOString();
}

function fingerprintOf(doc) {
  const { fingerprint, ...rest } = doc;
  void fingerprint;
  return costShared.hash16(JSON.parse(costShared.stableStringify(rest)));
}

// A node's dependency fingerprint binds the exact upstream versionRefs it
// was built against. Any upstream change → mismatch → dirty (even if the
// stored state is stale-CLEAN, e.g. crash between mutation + propagation).
function nodeFingerprint(node, nodes) {
  const parts = (node.inputRefs || [])
    .map((r) => [r.key, (nodes[r.key] && nodes[r.key].versionRef) || null, r.type || null])
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  return costShared.hash16({ inputs: parts });
}

function validateDag(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: [{ code: "DAG_STATE_INVALID", message: "doc must be an object" }] };
  }
  const valid = validator()(doc);
  if (!valid) {
    for (const e of validator().errors || []) {
      errors.push({ code: "DAG_STATE_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
    }
  }
  const secrets = [...manifestLib.findSecretKeys(doc), ...historyLib.findSecretPastes(doc)];
  if (secrets.length > 0) {
    errors.push({ code: "DAG_STATE_INVALID", message: `secret material must never persist: ${secrets.join(", ")}` });
  }
  if (errors.length === 0 && doc.fingerprint !== fingerprintOf(doc)) {
    errors.push({ code: "DAG_STATE_INVALID", message: "fingerprint mismatch: mutated outside the canonical path" });
  }
  return { ok: errors.length === 0, errors };
}

function exists(root, projectId) {
  return artifactStore.artifactExists(root, projectId, DAG_REL);
}

function loadDag(root, projectId) {
  if (!exists(root, projectId)) {
    return { ok: false, code: "DAG_NOT_FOUND", message: ERRORS.DAG_NOT_FOUND };
  }
  let raw;
  try {
    raw = JSON.parse(artifactStore.readArtifact(root, projectId, DAG_REL).toString("utf8"));
  } catch (e) {
    return { ok: false, code: "DAG_STATE_INVALID", message: `unparseable graph store: ${String((e && e.message) || e)}` };
  }
  const v = validateDag(raw);
  if (!v.ok) return { ok: false, code: "DAG_STATE_INVALID", message: v.errors[0].message, errors: v.errors };
  return { ok: true, dag: raw };
}

function persistValidated(root, projectId, dag) {
  const text = JSON.stringify(dag, null, 2) + "\n";
  JSON.parse(text);
  const v = validateDag(dag);
  if (!v.ok) return { ok: false, code: "DAG_STATE_INVALID", message: v.errors[0].message, errors: v.errors };
  try {
    artifactStore.writeArtifactAtomic(root, projectId, DAG_REL, text);
  } catch (e) {
    return { ok: false, code: "DAG_STATE_INVALID", message: `atomic persist failed: ${String((e && e.message) || e)}` };
  }
  return { ok: true };
}

function createDag(root, projectId, opts = {}) {
  if (!root || !projectId) {
    return { ok: false, code: "DAG_STATE_INVALID", message: "root + projectId are required" };
  }
  if (exists(root, projectId)) {
    return { ok: false, code: "DAG_VERSION_CONFLICT", message: "graph already exists; mutate, never recreate" };
  }
  const createdAt = nowIso(opts.now);
  const dag = { schemaVersion: DAG_SCHEMA_VERSION, projectId, revision: 1, createdAt, updatedAt: createdAt, nodes: {}, fingerprint: null };
  dag.fingerprint = fingerprintOf(dag);
  const saved = persistValidated(root, projectId, dag);
  if (!saved.ok) return saved;
  return { ok: true, dag, changed: true };
}

function commitDag(root, projectId, dag, opts = {}) {
  dag.revision += 1;
  dag.updatedAt = nowIso(opts.now);
  dag.fingerprint = fingerprintOf(dag);
  const saved = persistValidated(root, projectId, dag);
  if (!saved.ok) return saved;
  return { ok: true, dag, changed: true };
}

function checkRevision(dag, expectedRevision) {
  if (expectedRevision !== undefined && expectedRevision !== null && dag.revision !== expectedRevision) {
    return { ok: false, code: "DAG_VERSION_CONFLICT", message: `stale writer: expected revision ${expectedRevision}, current is ${dag.revision}` };
  }
  return { ok: true };
}

function descendants(dag, key) {
  // Forward edges: every node listing `key` in inputRefs.
  const out = [];
  for (const n of Object.values(dag.nodes)) {
    if ((n.inputRefs || []).some((r) => r.key === key)) out.push(n.artifactKey);
  }
  return out.sort();
}

function reaches(dag, from, to, seen = new Set()) {
  if (from === to) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const next of descendants(dag, from)) {
    if (reaches(dag, next, to, seen)) return true;
  }
  return false;
}

/**
 * Add (or complete) a node. Re-adding an identical node is a no-op;
 * re-adding with different shape is DAG_VERSION_CONFLICT (explicit update
 * path: setNodeVersion / setNodeState / addDependency).
 */
function addNode(root, projectId, node = {}, opts = {}) {
  const loaded = loadDag(root, projectId);
  if (!loaded.ok) return loaded;
  const dag = loaded.dag;
  const rev = checkRevision(dag, opts.expectedRevision);
  if (!rev.ok) return { ...rev, dag };
  if (typeof node.artifactKey !== "string" || !node.artifactKey) {
    return { ok: false, code: "DAG_EDGE_INVALID", message: "artifactKey is required", dag };
  }
  if (!ARTIFACT_TYPES.includes(node.artifactType)) {
    return { ok: false, code: "DAG_EDGE_INVALID", message: `artifactType must be ${ARTIFACT_TYPES.join("|")}`, dag };
  }
  const record = {
    artifactKey: node.artifactKey,
    artifactType: node.artifactType,
    versionRef: node.versionRef || null,
    state: node.state || "NOT_CREATED_YET",
    inputRefs: Array.isArray(node.inputRefs) ? node.inputRefs.map((r) => (typeof r === "string" ? { key: r, type: null } : { key: r.key, type: r.type || null })) : [],
    dependencyFingerprint: null,
    producedBy: node.producedBy || null,
    lockTarget: node.lockTarget || null,
    blockedReason: node.blockedReason || null,
    provenance: node.provenance || null,
  };
  if (!NODE_STATES.includes(record.state)) {
    return { ok: false, code: "DAG_EDGE_INVALID", message: `state must be ${NODE_STATES.join("|")}`, dag };
  }
  for (const r of record.inputRefs) {
    if (!dag.nodes[r.key]) {
      return { ok: false, code: "DAG_EDGE_INVALID", message: `${ERRORS.DAG_EDGE_INVALID}: unknown upstream ${r.key} (add nodes first)`, dag };
    }
  }
  record.dependencyFingerprint = nodeFingerprint(record, dag.nodes);
  const existing = dag.nodes[record.artifactKey];
  if (existing) {
    if (costShared.stableStringify(existing) === costShared.stableStringify(record)) {
      return { ok: true, dag, changed: false, deduped: true };
    }
    return { ok: false, code: "DAG_VERSION_CONFLICT", message: "node exists with different shape; use setNodeVersion/setNodeState/addDependency", dag };
  }
  if (reachesVia(record, dag)) {
    return { ok: false, code: "DAG_CYCLE_DETECTED", message: `${ERRORS.DAG_CYCLE_DETECTED}: ${record.artifactKey} reaches itself`, dag };
  }
  dag.nodes[record.artifactKey] = record;
  return { ...commitDag(root, projectId, dag, opts), node: record };
}

function reachesVia(record, dag) {
  // Would any inputRef path lead back to record.artifactKey?
  const visit = (key, seen = new Set()) => {
    if (key === record.artifactKey) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    const n = key === record.artifactKey ? record : dag.nodes[key];
    if (!n) return false;
    return (n.inputRefs || []).some((r) => visit(r.key, seen));
  };
  return (record.inputRefs || []).some((r) => visit(r.key));
}

/**
 * Add one dependency edge (downstream inputRefs += upstream). Idempotent for
 * the same edge; rejects unknown nodes, self-cycles, and any cycle.
 */
function addDependency(root, projectId, upstream, downstream, type = null, opts = {}) {
  const loaded = loadDag(root, projectId);
  if (!loaded.ok) return loaded;
  const dag = loaded.dag;
  const rev = checkRevision(dag, opts.expectedRevision);
  if (!rev.ok) return { ...rev, dag };
  const up = dag.nodes[upstream];
  const down = dag.nodes[downstream];
  if (!up || !down) {
    return { ok: false, code: "DAG_NODE_NOT_FOUND", message: `${ERRORS.DAG_NODE_NOT_FOUND}: ${!up ? upstream : downstream}`, dag };
  }
  if (upstream === downstream) {
    return { ok: false, code: "DAG_CYCLE_DETECTED", message: `${ERRORS.DAG_CYCLE_DETECTED}: self-cycle on ${upstream}`, dag };
  }
  if ((down.inputRefs || []).some((r) => r.key === upstream && (r.type || null) === (type || null))) {
    return { ok: true, dag, changed: false, deduped: true };
  }
  const trial = { ...down, inputRefs: [...(down.inputRefs || []), { key: upstream, type: type || null }] };
  if (reachesVia(trial, dag)) {
    return { ok: false, code: "DAG_CYCLE_DETECTED", message: `${ERRORS.DAG_CYCLE_DETECTED}: ${upstream} → ${downstream} closes a loop`, dag };
  }
  down.inputRefs = trial.inputRefs;
  down.dependencyFingerprint = nodeFingerprint(down, dag.nodes);
  return commitDag(root, projectId, dag, opts);
}

/**
 * Set a node's versionRef (upstream change). The node itself stays CLEAN —
 * invalidation is explicit via markDirty so the change reason is recorded.
 * Returns the affected fingerprint preview (downstream mismatches).
 */
function setNodeVersion(root, projectId, artifactKey, versionRef, opts = {}) {
  const loaded = loadDag(root, projectId);
  if (!loaded.ok) return loaded;
  const dag = loaded.dag;
  const rev = checkRevision(dag, opts.expectedRevision);
  if (!rev.ok) return { ...rev, dag };
  const node = dag.nodes[artifactKey];
  if (!node) return { ok: false, code: "DAG_NODE_NOT_FOUND", message: ERRORS.DAG_NODE_NOT_FOUND, dag };
  if (node.versionRef === (versionRef || null)) {
    return { ok: true, dag, changed: false, deduped: true };
  }
  node.versionRef = versionRef || null;
  const c = commitDag(root, projectId, dag, opts);
  if (!c.ok) return c;
  return { ...c, staleDependents: staleDependents(dag, artifactKey) };
}

/** CLEAN nodes whose stored fingerprint no longer matches current upstream. */
function staleDependents(dag, upstreamKey) {
  const out = [];
  const visit = (key) => {
    for (const d of descendants(dag, key)) {
      const n = dag.nodes[d];
      if (n.state === "CLEAN" && n.dependencyFingerprint !== nodeFingerprint(n, dag.nodes)) out.push(d);
      visit(d);
    }
  };
  visit(upstreamKey);
  return [...new Set(out)].sort();
}

/**
 * Deterministic forward invalidation: BFS from upstream through dependency
 * edges only. CLEAN/FAILED/BUILDING → DIRTY; locked → BLOCKED with explicit
 * reason (never auto-regenerated); NOT_CREATED_YET untouched (nothing to
 * invalidate); already DIRTY/BLOCKED keep prior reason unless this run adds
 * a lock block. locksReader: ({targetType,targetId}) → "LOCKED"|"UNLOCKED"|null.
 */
function markDirty(root, projectId, artifactKey, input = {}, opts = {}, locksReader = null) {
  const loaded = loadDag(root, projectId);
  if (!loaded.ok) return loaded;
  const dag = loaded.dag;
  const rev = checkRevision(dag, opts.expectedRevision);
  if (!rev.ok) return { ...rev, dag };
  if (!dag.nodes[artifactKey]) {
    return { ok: false, code: "DAG_NODE_NOT_FOUND", message: ERRORS.DAG_NODE_NOT_FOUND, dag };
  }
  const reason = input.reason || `upstream ${artifactKey} changed`;
  const queue = [artifactKey];
  const visited = new Set();
  const dirtied = [];
  const blocked = [];
  while (queue.length > 0) {
    const key = queue.shift();
    for (const d of descendants(dag, key)) {
      if (visited.has(d)) continue;
      visited.add(d);
      const n = dag.nodes[d];
      if (n.state === "NOT_CREATED_YET") continue;
      let locked = false;
      if (locksReader && n.lockTarget) {
        try {
          locked = locksReader(n.lockTarget) === "LOCKED";
        } catch { locked = false; }
      }
      if (locked) {
        if (n.state !== "BLOCKED") {
          n.state = "BLOCKED";
          n.blockedReason = `upstream ${artifactKey} changed while locked (${reason}); requires unlock/revision decision`;
          blocked.push(d);
        }
        queue.push(d); // propagate THROUGH blocked nodes to their dependents
        continue;
      }
      if (n.state === "CLEAN" || n.state === "FAILED" || n.state === "BUILDING") {
        n.state = "DIRTY";
        n.blockedReason = null;
        dirtied.push(d);
      }
      queue.push(d);
    }
  }
  dirtied.sort();
  blocked.sort();
  if (dirtied.length === 0 && blocked.length === 0) {
    return { ok: true, dag, changed: false, dirtied, blocked };
  }
  const c = commitDag(root, projectId, dag, opts);
  if (!c.ok) return c;
  return { ...c, dirtied, blocked };
}

function setNodeState(root, projectId, artifactKey, state, opts = {}) {  const loaded = loadDag(root, projectId);
  if (!loaded.ok) return loaded;
  const dag = loaded.dag;
  const rev = checkRevision(dag, opts.expectedRevision);
  if (!rev.ok) return { ...rev, dag };
  const node = dag.nodes[artifactKey];
  if (!node) return { ok: false, code: "DAG_NODE_NOT_FOUND", message: ERRORS.DAG_NODE_NOT_FOUND, dag };
  if (!NODE_STATES.includes(state)) {
    return { ok: false, code: "DAG_STATE_INVALID", message: `state must be ${NODE_STATES.join("|")}`, dag };
  }
  if (node.state === state) return { ok: true, dag, changed: false, deduped: true };
  node.state = state;
  if (state !== "BLOCKED") node.blockedReason = null;
  if (state === "CLEAN") node.dependencyFingerprint = nodeFingerprint(node, dag.nodes);
  return commitDag(root, projectId, dag, opts);
}

/**
 * Attach (or detach with null) a 1H.2 lock target to a node, so
 * lock-aware invalidation can consult live lock state. Canonical path —
 * same revision/conflict rules as every mutation.
 */
function setNodeLockTarget(root, projectId, artifactKey, lockTarget, opts = {}) {
  const loaded = loadDag(root, projectId);
  if (!loaded.ok) return loaded;
  const dag = loaded.dag;
  const rev = checkRevision(dag, opts.expectedRevision);
  if (!rev.ok) return { ...rev, dag };
  const node = dag.nodes[artifactKey];
  if (!node) return { ok: false, code: "DAG_NODE_NOT_FOUND", message: ERRORS.DAG_NODE_NOT_FOUND, dag };
  if (lockTarget !== null && lockTarget !== undefined) {
    if (!["SCENE", "SEGMENT", "ASSET", "VOICE_PARAGRAPH", "SHOT", "VOICE_BIBLE"].includes(lockTarget.targetType)
      || typeof lockTarget.targetId !== "string" || !lockTarget.targetId) {
      return { ok: false, code: "DAG_EDGE_INVALID", message: "lockTarget needs { targetType, targetId }", dag };
    }
  }
  const next = lockTarget || null;
  const same = JSON.stringify(node.lockTarget || null) === JSON.stringify(next);
  if (same) return { ok: true, dag, changed: false, deduped: true };
  node.lockTarget = next;
  return commitDag(root, projectId, dag, opts);
}

/**
 * Effective state: stored state, except fingerprint-mismatched CLEAN nodes
 * read as DIRTY (crash between artifact mutation + markDirty can never leave
 * a stale downstream CLEAN — covers resume without a second code path).
 */
function effectiveState(dag, key) {
  const n = dag.nodes[key];
  if (!n) return null;
  if (n.state === "CLEAN" && n.dependencyFingerprint !== nodeFingerprint(n, dag.nodes)) return "DIRTY";
  return n.state;
}

/**
 * Selective rebuild planner: DAG + effective states + locks →
 * { rebuild, reuse, blocked, unaffected, needsDecision }.
 * A DIRTY node with a BLOCKED upstream dependency is itself blocked
 * (rebuilding it would bake the blocked input) — computed transitively in
 * topological order so a locked node shields its whole downstream branch.
 */
function planRebuild(root, projectId, opts = {}, locksReader = null) {
  const loaded = loadDag(root, projectId);
  if (!loaded.ok) return loaded;
  const dag = loaded.dag;
  const isLocked = (n) => {
    if (!locksReader || !n.lockTarget) return false;
    try { return locksReader(n.lockTarget) === "LOCKED"; } catch { return false; }
  };
  const effOf = (key) => effectiveState(dag, key);
  const order = topoOrder(dag, Object.keys(dag.nodes));
  const blockedSet = new Set();
  const blockedReason = {};
  for (const key of order) {
    const n = dag.nodes[key];
    const eff = effOf(key);
    if (eff === "BLOCKED" || (eff === "DIRTY" && isLocked(n))) {
      blockedSet.add(key);
      blockedReason[key] = eff === "BLOCKED"
        ? (n.blockedReason || "blocked")
        : "locked dirty node; requires unlock/revision decision";
      continue;
    }
    if (eff === "DIRTY" || eff === "BUILDING") {
      const badUp = (n.inputRefs || []).map((r) => r.key).filter((u) => blockedSet.has(u));
      if (badUp.length > 0) {
        blockedSet.add(key);
        blockedReason[key] = `upstream blocked: ${badUp.join(",")}`;
      }
    }
  }
  const rebuild = [];
  const reuse = [];
  const blocked = [];
  const unaffected = [];
  const needsDecision = [];
  for (const n of Object.values(dag.nodes)) {
    const eff = effOf(n.artifactKey);
    if (eff === "CLEAN") { reuse.push(n.artifactKey); continue; }
    if (eff === "NOT_CREATED_YET") { unaffected.push(n.artifactKey); continue; }
    if (eff === "FAILED") { needsDecision.push({ key: n.artifactKey, reason: "failed; needs explicit retry/new attempt" }); continue; }
    if (blockedSet.has(n.artifactKey)) { blocked.push({ key: n.artifactKey, reason: blockedReason[n.artifactKey] }); continue; }
    if (eff === "DIRTY") { rebuild.push(n.artifactKey); continue; }
    if (eff === "BUILDING") { needsDecision.push({ key: n.artifactKey, reason: "interrupted build; resume or restart explicitly" }); continue; }
  }
  for (const arr of [rebuild, reuse, unaffected]) arr.sort();
  blocked.sort((a, b) => (a.key < b.key ? -1 : 1));
  needsDecision.sort((a, b) => (a.key < b.key ? -1 : 1));
  return { ok: true, plan: { rebuild, reuse, blocked, unaffected, needsDecision } };
}

function topoOrder(dag, keys) {
  // Kahn over the induced subgraph (upstream first). Deterministic by key.
  const inSet = new Set(keys);
  const indeg = new Map(keys.map((k) => [k, 0]));
  for (const k of keys) {
    for (const r of (dag.nodes[k].inputRefs || [])) {
      if (inSet.has(r.key)) indeg.set(k, indeg.get(k) + 1);
    }
  }
  const ready = keys.filter((k) => indeg.get(k) === 0).sort();
  const out = [];
  while (ready.length > 0) {
    const k = ready.shift();
    out.push(k);
    for (const d of descendants(dag, k)) {
      if (!inSet.has(d)) continue;
      indeg.set(d, indeg.get(d) - 1);
      if (indeg.get(d) === 0) {
        ready.push(d);
        ready.sort();
      }
    }
  }
  return out;
}

/**
 * Bounded partial rerun: executes ONLY the affected closure (DIRTY,
 * topologically ordered), reusing everything else. executor(key, node) is
 * injected (tests simulate provider work and count side effects). Locked /
 * blocked nodes are skipped as blocked (never auto-regenerated). On success
 * the node is marked CLEAN with its fresh fingerprint.
 */
function rerunBranch(root, projectId, fromKey, executor, opts = {}, locksReader = null) {
  if (typeof executor !== "function") {
    return { ok: false, code: "DAG_STATE_INVALID", message: "executor(key, node) is required" };
  }
  const loaded = loadDag(root, projectId);
  if (!loaded.ok) return loaded;
  const dag = loaded.dag;
  if (!dag.nodes[fromKey]) {
    return { ok: false, code: "DAG_NODE_NOT_FOUND", message: ERRORS.DAG_NODE_NOT_FOUND, dag };
  }
  const closure = new Set();
  const queue = [fromKey];
  while (queue.length > 0) {
    const k = queue.shift();
    if (closure.has(k)) continue;
    closure.add(k);
    for (const d of descendants(dag, k)) queue.push(d);
  }
  const plan = planRebuild(root, projectId, opts, locksReader);
  if (!plan.ok) return plan;
  const blockedKeys = new Set(plan.plan.blocked.map((b) => b.key));
  const skippedBlocked = [...closure].filter((k) => blockedKeys.has(k)).sort();
  const toRun = topoOrder(dag, [...closure].filter((k) => plan.plan.rebuild.includes(k)));
  const executed = [];
  for (const k of toRun) {
    const node = dag.nodes[k];
    const r = executor(k, { ...node });
    executed.push(k);
    if (r && r.ok === false) {
      node.state = "FAILED";
      const c = commitDag(root, projectId, dag, opts);
      if (!c.ok) return c;
      return { ok: false, code: "REBUILD_BLOCKED", message: `executor failed on ${k}; branch halted`, executed, skippedBlocked, dag };
    }
    if (r && r.versionRef !== undefined) node.versionRef = r.versionRef;
    node.state = "CLEAN";
    node.dependencyFingerprint = nodeFingerprint(node, dag.nodes);
  }
  const c = commitDag(root, projectId, dag, opts);
  if (!c.ok) return c;
  return { ...c, executed, skippedBlocked };
}

/**
 * Evidence-based DAG bootstrap: only nodes/edges current contracts prove.
 * Prompt packages reference their frame assets; QA results reference their
 * asset; shot plan + render input are content-hash versioned; future
 * pipeline classes exist as NOT_CREATED_YET without invented edges.
 */
function inspectDagEvidence(root, projectId) {
  const nodes = [];
  const decisions = [];
  const get = (rel) => {
    try {
      const p = path.join(root, "projects", projectId, rel);
      if (!fs.existsSync(p)) return null;
      return { data: JSON.parse(fs.readFileSync(p, "utf8")), bytes: fs.readFileSync(p) };
    } catch { return { unparseable: true }; }
  };
  const hash = (buf) => costShared.hash16({ sha: require("crypto").createHash("sha256").update(buf).digest("hex") });
  const planFile = get("case/case-d-shot-plan.json") || get("scene-script.json");
  if (planFile && !planFile.unparseable) {
    nodes.push({
      artifactKey: "SHOT_PLAN", artifactType: "SHOT_PLAN", versionRef: hash(planFile.bytes),
      state: "CLEAN", inputRefs: [], producedBy: null, lockTarget: null, provenance: "MIGRATED",
    });
    decisions.push({ key: "SHOT_PLAN", status: "MIGRATED", why: "content-hash versioned plan file" });
  } else {
    nodes.push({ artifactKey: "SHOT_PLAN", artifactType: "SHOT_PLAN", versionRef: null, state: "NOT_CREATED_YET", inputRefs: [], producedBy: null, lockTarget: null, provenance: null });
    decisions.push({ key: "SHOT_PLAN", status: "NOT_CREATED_YET", why: "no plan file" });
  }
  // Prompt packages / generated assets / QA results: their dependency edges
  // (package→frames, QA→asset) are proven per-record, but collapsing them
  // into single DAG nodes would invent granularity the contracts do not
  // define — so only content-hash-versioned files become nodes here.
  const renderInput = get("render/render-input-case-a.json");
  if (renderInput && !renderInput.unparseable) {
    nodes.push({
      artifactKey: "RENDER_INPUT_CASE_A", artifactType: "RENDER", versionRef: hash(renderInput.bytes),
      state: "CLEAN", inputRefs: [], producedBy: null, lockTarget: null, provenance: "MIGRATED",
    });
    decisions.push({ key: "RENDER_INPUT_CASE_A", status: "MIGRATED", why: "content-hash versioned render input; no invented upstream" });
  }
  // Voice Bible — probed from the immutable version files on disk, exactly like
// the shot plan: a project that actually has one gets a real CLEAN node with a
// content identity, never a bare future-class placeholder.
  {
    const dir = path.join(root, "projects", projectId, "voice", "voice-bible");
    let files = [];
    try {
      if (fs.existsSync(dir)) files = fs.readdirSync(dir).filter((f) => /^vb-[0-9a-f]{12}\.json$/.test(f)).sort();
    } catch { files = []; }
    if (files.length > 0) {
      let versionRef = files[files.length - 1].replace(/\.json$/, "");
      let count = files.length;
      try {
        const docs = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))).filter((d) => d && typeof d.version === "number");
        docs.sort((a, b) => a.version - b.version);
        if (docs.length > 0) {
          versionRef = docs[docs.length - 1].voiceBibleId || versionRef;
          count = docs.length;
        }
      } catch { /* keep the filename-derived id */ }
      nodes.push({
        artifactKey: "VOICE_BIBLE", artifactType: "VOICE_BIBLE", versionRef, state: "CLEAN",
        inputRefs: [], producedBy: "phase-2.1:voice-bible",
        lockTarget: { targetType: "VOICE_BIBLE", targetId: versionRef },
        provenance: "LIVE",
      });
      decisions.push({ key: "VOICE_BIBLE", status: "CLEAN", why: `${count} immutable version file(s) on disk; current = ${versionRef}` });
    } else {
      nodes.push({ artifactKey: "VOICE_BIBLE", artifactType: "VOICE_BIBLE", versionRef: null, state: "NOT_CREATED_YET", inputRefs: [], producedBy: null, lockTarget: null, provenance: null });
      decisions.push({ key: "VOICE_BIBLE", status: "NOT_CREATED_YET", why: "no voice/voice-bible/*.json on disk" });
    }
  }
  for (const t of ["FINAL_SPOKEN_SCRIPT", "VOICE", "FINAL_AUDIO", "FORCED_ALIGNMENT", "CAPTIONS", "MASTER_TIMELINE", "SCENE_TIMING", "VISUAL_TIMING", "ANIMATION_TIMING", "THUMBNAIL", "PUBLISH_PACKAGE", "CREATIVE_BRIEF", "RESEARCH_PACK"]) {
    nodes.push({ artifactKey: t, artifactType: t, versionRef: null, state: "NOT_CREATED_YET", inputRefs: [], producedBy: null, lockTarget: null, provenance: null });
    decisions.push({ key: t, status: "NOT_CREATED_YET", why: "future pipeline class; no edges invented" });
  }
  return { nodes, decisions };}

function bootstrapDag(root, projectId, opts = {}) {
  if (exists(root, projectId)) {
    return { ok: false, code: "DAG_VERSION_CONFLICT", message: "graph already exists; mutate, never re-bootstrap" };
  }
  let inspected;
  try {
    inspected = inspectDagEvidence(root, projectId);
  } catch (e) {
    return { ok: false, code: "DAG_STATE_INVALID", message: String((e && e.message) || e) };
  }
  const created = createDag(root, projectId, opts);
  if (!created.ok) return created;
  for (const n of inspected.nodes) {
    const r = addNode(root, projectId, n);
    if (!r.ok) return r;
  }
  const final = loadDag(root, projectId);
  if (!final.ok) return final;
  return { ok: true, dag: final.dag, changed: true, decisions: inspected.decisions };
}

module.exports = {
  DAG_SCHEMA_VERSION,
  DAG_REL,
  ARTIFACT_TYPES,
  NODE_STATES,
  ERRORS,
  nodeFingerprint,
  effectiveState,
  validateDag,
  exists,
  loadDag,
  createDag,
  addNode,
  addDependency,
  setNodeVersion,
  staleDependents,
  markDirty,
  setNodeState,
  setNodeLockTarget,
  planRebuild,
  rerunBranch,
  inspectDagEvidence,
  bootstrapDag,
};
