"use strict";

/**
 * Phase 1H.7 — Storage inventory, retention, lineage-safe cleanup (CORE).
 *
 * Classification is rule-based and inspectable; the safe default for
 * anything unrecognized is RETAIN (never auto-delete unknown). Cleanup is
 * DRY_RUN by default; execution needs an explicit EXECUTE plan + fresh
 * fingerprint + unchanged storage revision (else CLEANUP_PLAN_STALE).
 * Deletion writes tombstones; history/golden/evidence/registry records are
 * never edited by cleanup. Dedup only reports candidates — it never
 * overrides a RETAIN verdict. Locked/final/evidence/Golden/recovery
 * references block deletion through retention reasons.
 *
 * Readers (registry/history/golden/recovery/compliance/evidence refs) are
 * injected — this module never requires sibling owners (no cycles).
 *
 * Store: projects/<pid>/governance/storage.json
 * { policy, inventory: {ref: entry}, plans: {id: plan}, tombstones: {} }
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const costShared = require("../output-cost/shared.js");
const manifestLib = require("../project-manifest/index.js");
const historyLib = require("../generation-history/index.js");

const STORAGE_SCHEMA_VERSION = "1.0.0";
const STORE_REL = "governance/storage.json";
const STORAGE_POLICY_VERSION = "1.0.0";

const STORAGE_CLASSES = ["SOURCE_ASSET", "RESEARCH_RAW", "RESEARCH_FIT", "GENERATED_VARIANT", "SELECTED_ASSET", "RENDERED_PROXY", "CACHE", "FINAL_DELIVERABLE", "EVIDENCE", "TEMPORARY"];
const DURABILITY = ["DURABLE", "RETENTION_MANAGED", "REGENERABLE", "EPHEMERAL"];
const REJECTED_RETENTION = ["KEEP_DURABLE", "KEEP_FOR_PROJECT", "KEEP_UNTIL_RELEASE", "ELIGIBLE_AFTER_EVIDENCE_EXTRACTED"];
const VERDICTS = ["SAFE_TO_DELETE", "SAFE_AFTER_MIGRATION", "RETAIN", "BLOCKED", "REVIEW_REQUIRED"];

const ERRORS = {
  STORAGE_INVENTORY_INVALID: "storage record fails validation",
  STORAGE_CLASS_INVALID: "unknown storage/durability class",
  CLEANUP_PLAN_STALE: "state drifted since planning — refuse execution",
  CLEANUP_PLAN_STALE: "state drifted since planning — refuse execution",
  CLEANUP_BLOCKED: "plan contains blocked candidates",
  CLEANUP_REVIEW_REQUIRED: "plan needs human review before execution",
  CLEANUP_REVIEW_REQUIRED: "plan needs human review before execution",
  ARTIFACT_IN_USE: "active reference blocks deletion",
  MISSING_DURABLE_ARTIFACT: "durable metadata ref has no backing file",
  MISSING_REGENERABLE_ARTIFACT: "regenerable ref has no backing file",
  ORPHAN_CANDIDATE: "unreferenced file detected (never auto-deleted)",
  DELETE_FAILED: "physical deletion failed",
};

// Classification rules in priority order. First match wins; the fallthrough
// retains unknowns (safe default). `match` tests the project-relative path.
const CLASS_RULES = [
  { match: /^assets\//, cls: "SELECTED_ASSET", durability: "DURABLE", why: "managed asset bytes" },
  { match: /^(qa|case|budget|budget-plans|telemetry|history|manifest|governance|recovery|golden)\//, cls: "EVIDENCE", durability: "DURABLE", why: "evidence / canonical state" },
  { match: /^decision\//, cls: "EVIDENCE", durability: "DURABLE", why: "production decision record" },
  { match: /^prompts\//, cls: "SELECTED_ASSET", durability: "DURABLE", why: "compiled production input" },
  { match: /^scene\//, cls: "EVIDENCE", durability: "DURABLE", why: "scene contract" },
  { match: /^render\//, cls: "RENDERED_PROXY", durability: "RETENTION_MANAGED", why: "render input/staging (final outputs elevate separately)" },
  { match: /^timing\//, cls: "EVIDENCE", durability: "DURABLE", why: "measured timing evidence" },
  { match: /^preflight\//, cls: "EVIDENCE", durability: "DURABLE", why: "preflight gate evidence" },
  { match: /^downloads\//, cls: "CACHE", durability: "REGENERABLE", why: "provider download staging (re-downloadable)" },
  { match: /\.tmp$|\.bak$|~$/, cls: "TEMPORARY", durability: "EPHEMERAL", why: "scratch naming" },
];

let ajvValidator = null;
function validator() {
  if (!ajvValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const root = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "governance.schema.json"), "utf8"));
    ajvValidator = ajv.compile({ ...root, $ref: "#/definitions/storageDoc" });
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

function validateDoc(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: [{ code: "STORAGE_INVENTORY_INVALID", message: "doc must be an object" }] };
  }
  const valid = validator()(doc);
  if (!valid) {
    for (const e of validator().errors || []) {
      errors.push({ code: "STORAGE_INVENTORY_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
    }
  }
  const secrets = [...manifestLib.findSecretKeys(doc), ...historyLib.findSecretPastes(doc)];
  if (secrets.length > 0) {
    errors.push({ code: "STORAGE_INVENTORY_INVALID", message: `secret material must never persist: ${secrets.join(", ")}` });
  }
  if (errors.length === 0 && doc.fingerprint !== fingerprintOf(doc)) {
    errors.push({ code: "STORAGE_INVENTORY_INVALID", message: "fingerprint mismatch: mutated outside the canonical path" });
  }
  return { ok: errors.length === 0, errors };
}

function exists(root, projectId) {
  return artifactStore.artifactExists(root, projectId, STORE_REL);
}

function defaultPolicy(now) {
  return {
    policyVersion: STORAGE_POLICY_VERSION,
    createdAt: now,
    rules: CLASS_RULES.map((r) => ({ match: String(r.match), class: r.cls, durability: r.durability, why: r.why })),
    defaultRejectedRetention: "KEEP_FOR_PROJECT",
  };
}

function loadStorage(root, projectId) {
  if (!exists(root, projectId)) {
    return { ok: false, code: "STORAGE_INVENTORY_INVALID", message: "storage store absent" };
  }
  let raw;
  try {
    raw = JSON.parse(artifactStore.readArtifact(root, projectId, STORE_REL).toString("utf8"));
  } catch (e) {
    return { ok: false, code: "STORAGE_INVENTORY_INVALID", message: `unparseable storage store: ${String((e && e.message) || e)}` };
  }
  const v = validateDoc(raw);
  if (!v.ok) return { ok: false, code: "STORAGE_INVENTORY_INVALID", message: v.errors[0].message, errors: v.errors };
  return { ok: true, doc: raw };
}

function ensureDoc(root, projectId, opts = {}) {
  const loaded = loadStorage(root, projectId);
  if (loaded.ok) return loaded;
  if (!exists(root, projectId)) {
    const createdAt = nowIso(opts.now);
    const doc = { schemaVersion: STORAGE_SCHEMA_VERSION, projectId, revision: 1, createdAt, updatedAt: createdAt, policy: defaultPolicy(createdAt), inventory: {}, plans: {}, tombstones: {}, fingerprint: null };
    doc.fingerprint = fingerprintOf(doc);
    const text = JSON.stringify(doc, null, 2) + "\n";
    try {
      artifactStore.writeArtifactAtomic(root, projectId, STORE_REL, text);
    } catch (e) {
      return { ok: false, code: "STORAGE_INVENTORY_INVALID", message: `atomic persist failed: ${String((e && e.message) || e)}` };
    }
    return { ok: true, doc };
  }
  return loaded;
}

function commitDoc(root, projectId, doc, opts = {}) {
  doc.revision += 1;
  doc.updatedAt = nowIso(opts.now);
  return saveDoc(root, projectId, doc);
}

// Fingerprint + validate + atomic write WITHOUT a revision bump (second
// phase of a single logical mutation whose revision was already counted).
function saveDoc(root, projectId, doc) {
  doc.fingerprint = fingerprintOf(doc);
  const text = JSON.stringify(doc, null, 2) + "\n";
  JSON.parse(text);
  const v = validateDoc(doc);
  if (!v.ok) return { ok: false, code: "STORAGE_INVENTORY_INVALID", message: v.errors[0].message, errors: v.errors };
  try {
    artifactStore.writeArtifactAtomic(root, projectId, STORE_REL, text);
  } catch (e) {
    return { ok: false, code: "STORAGE_INVENTORY_INVALID", message: `atomic persist failed: ${String((e && e.message) || e)}` };
  }
  return { ok: true };
}

function classifyRel(rel) {
  for (const r of CLASS_RULES) {
    if (r.match.test(rel)) return { storageClass: r.cls, durability: r.durability, why: r.why };
  }
  return { storageClass: "TEMPORARY", durability: "RETENTION_MANAGED", why: "unrecognized path — safe default retains" };
}

function fileHash(abs, maxBytes = 256 * 1024 * 1024) {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile() || st.size > maxBytes) return { hash: null, size: st.isFile() ? st.size : null };
    return { hash: crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"), size: st.size };
  } catch {
    return { hash: null, size: null };
  }
}

function projectBase(root, projectId) {
  try {
    const ws = require("../workspace/index.js");
    const r = ws.resolveProjectRoot(root, projectId);
    if (r.ok) return path.resolve(r.path);
  } catch { /* fall through to legacy layout */ }
  return path.join(root, "projects", projectId);
}

function walkProjectFiles(root, projectId) {
  const base = projectBase(root, projectId);
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch { return; }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) { walk(abs); continue; }
      if (!e.isFile()) continue;
      out.push(path.relative(base, abs).split(path.sep).join("/"));
    }
  };
  if (fs.existsSync(base)) walk(base);
  return out.sort();
}

/**
 * Build (or rebuild) the inventory. Pure filesystem walk + rule
 * classification + retention reasons from injected readers:
 * readers = { lockedAssets(): string[], protectedRefs(): {ref, reason}[],
 *   dagDependents(): {ref, dependents[]} , recoveryActiveRefs(): string[] }
 * Rebuilding is idempotent: same files + same readers → same bytes.
 */
function buildInventory(root, projectId, readers = {}, opts = {}) {
  const ensured = ensureDoc(root, projectId, opts);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  const files = walkProjectFiles(root, projectId);
  const inventory = {};
  const locked = new Set((readers.lockedAssets && readers.lockedAssets()) || []);
  const protectedRefs = (readers.protectedRefs && readers.protectedRefs()) || [];
  const protectedBy = new Map();
  for (const p of protectedRefs) {
    if (!protectedBy.has(p.ref)) protectedBy.set(p.ref, []);
    protectedBy.get(p.ref).push(p.reason);
  }
  for (const rel of files) {
    const cls = classifyRel(rel);
    const abs = path.join(projectBase(root, projectId), rel);
    const prev = doc.inventory[rel] || null;
    let probed = null;
    try {
      probed = fileHash(abs);
    } catch { probed = { hash: null, size: null }; }
    const present = probed.size !== null;
    const reasons = [];
    if (cls.durability === "DURABLE" || cls.storageClass === "EVIDENCE") reasons.push(cls.storageClass === "EVIDENCE" ? "QA_EVIDENCE" : "FINAL_OUTPUT");
    if (locked.has(rel)) reasons.push("LOCKED");
    if (protectedBy.has(rel)) reasons.push(...protectedBy.get(rel));
    if (cls.storageClass === "TEMPORARY" && cls.durability === "RETENTION_MANAGED") reasons.push("NEEDS_CLASSIFICATION");
    inventory[rel] = {
      artifactRef: rel,
      path: rel,
      // Missing backing file: RETAIN the last known hash/size (never silently
      // drop metadata — missing-scan reports it, §38).
      size: present ? probed.size : (prev ? prev.size : null),
      hash: present ? probed.hash : (prev ? prev.hash : null),
      storageClass: cls.storageClass,
      durability: cls.durability,
      retentionReasons: [...new Set(reasons)],
      createdAt: null,
      dependencyRefs: [],
      provenanceRef: null,
    };
  }
  doc.inventory = inventory;
  const c = commitDoc(root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, doc, changed: true, files: files.length };
}

/** Bytes grouped by class/durability (quota observability, §39). */
function storageStats(root, projectId) {
  const loaded = loadStorage(root, projectId);
  if (!loaded.ok) return loaded;
  const byClass = {};
  const byDurability = {};
  let total = 0;
  for (const e of Object.values(loaded.doc.inventory)) {
    const s = e.size || 0;
    total += s;
    byClass[e.storageClass] = (byClass[e.storageClass] || 0) + s;
    byDurability[e.durability] = (byDurability[e.durability] || 0) + s;
  }
  return { ok: true, totalBytes: total, byClass, byDurability, entries: Object.keys(loaded.doc.inventory).length };
}

/** Same bytes → duplicate storage candidate (metadata/lineage preserved). */
function findDuplicates(root, projectId) {
  const loaded = loadStorage(root, projectId);
  if (!loaded.ok) return loaded;
  const byHash = new Map();
  for (const e of Object.values(loaded.doc.inventory)) {
    if (!e.hash) continue;
    if (!byHash.has(e.hash)) byHash.set(e.hash, []);
    byHash.get(e.hash).push(e.artifactRef);
  }
  const duplicates = [];
  for (const [hash, refs] of byHash) {
    if (refs.length > 1) {
      const sizes = refs.map((r) => loaded.doc.inventory[r].size || 0);
      duplicates.push({ hash, refs: refs.sort(), totalBytes: sizes.reduce((a, b) => a + b, 0), note: "candidates only — deletion follows normal verdicts; aliases/lineage preserved" });
    }
  }
  return { ok: true, duplicates: duplicates.sort((a, b) => b.totalBytes - a.totalBytes) };
}

/** Files on disk referenced by nothing known (detection only, never delete). */
function findOrphans(root, projectId, knownRefs = []) {
  const known = new Set(knownRefs);
  const files = walkProjectFiles(root, projectId);
  const orphans = files.filter((f) => !known.has(f)).map((f) => ({ ref: f, code: "ORPHAN_CANDIDATE" }));
  return { ok: true, orphans };
}

/**
 * Metadata refs whose backing file is missing. Severity follows durability:
 * DURABLE → MISSING_DURABLE_ARTIFACT (serious); regenerable/ephemeral →
 * MISSING_REGENERABLE_ARTIFACT. Never silently removes the metadata.
 */
function findMissing(root, projectId, refs = []) {
  const missing = [];
  for (const r of refs) {
    const abs = path.join(projectBase(root, projectId), r.ref);
    if (!fs.existsSync(abs)) {
      const serious = r.durability === "DURABLE" || r.durability === "RETENTION_MANAGED";
      missing.push({ ref: r.ref, code: serious ? "MISSING_DURABLE_ARTIFACT" : "MISSING_REGENERABLE_ARTIFACT", durability: r.durability || null });
    }
  }
  return { ok: true, missing: missing.sort((a, b) => (a.ref < b.ref ? -1 : 1)) };
}

function verdictFor(entry, context = {}) {
  // Locked / final / evidence / protected → never routine-cleaned.
  if (entry.retentionReasons.includes("LOCKED")) {
    return { verdict: "BLOCKED", reason: "locked target — explicit unlock/revision first", blockingRefs: ["lock"] };
  }
  if (entry.retentionReasons.length > 0 && !(entry.retentionReasons.length === 1 && entry.retentionReasons[0] === "NEEDS_CLASSIFICATION")) {
    return { verdict: "RETAIN", reason: `retention: ${entry.retentionReasons.join(",")}`, blockingRefs: entry.retentionReasons };
  }
  if (context.recoveryActiveRefs && context.recoveryActiveRefs.includes(entry.artifactRef)) {
    return { verdict: "BLOCKED", reason: "active recovery input — no cleanup of unfinished work", blockingRefs: ["recovery"] };
  }
  if (context.dagDependents && (context.dagDependents[entry.artifactRef] || []).length > 0) {
    return { verdict: "BLOCKED", reason: `active dependents: ${context.dagDependents[entry.artifactRef].join(",")}`, blockingRefs: context.dagDependents[entry.artifactRef] };
  }
  if (entry.storageClass === "CACHE") {
    if (context.rebuildable && context.rebuildable.includes(entry.artifactRef)) {
      return { verdict: "SAFE_TO_DELETE", reason: "cache with known rebuild path and live canonical source", blockingRefs: [] };
    }
    return { verdict: "REVIEW_REQUIRED", reason: "cache rebuildability unproven", blockingRefs: [] };
  }
  if (entry.storageClass === "TEMPORARY" && entry.durability === "EPHEMERAL") {
    if (context.activeCheckpointRefs && context.activeCheckpointRefs.includes(entry.artifactRef)) {
      return { verdict: "BLOCKED", reason: "referenced by an active checkpoint", blockingRefs: ["checkpoint"] };
    }
    return { verdict: "SAFE_TO_DELETE", reason: "ephemeral temporary with no active references", blockingRefs: [] };
  }
  return { verdict: "REVIEW_REQUIRED", reason: "no safe rule matched — human decides", blockingRefs: [] };
}

/**
 * Plan cleanup (DRY_RUN default — deletes nothing). Candidates carry
 * verdict + blocking refs + sizes. Plan pins policyVersion + fingerprint +
 * storage revision for staleness refusal at execution.
 */
function planCleanup(root, projectId, input = {}, opts = {}) {
  const loaded = loadStorage(root, projectId);
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;
  if (opts.expectedRevision !== undefined && opts.expectedRevision !== null && doc.revision !== opts.expectedRevision) {
    return { ok: false, code: "STORAGE_INVENTORY_INVALID", message: `stale writer: expected revision ${opts.expectedRevision}, current is ${doc.revision}` };
  }
  const context = input.context || {};
  const candidates = [];
  let eligibleBytes = 0;
  for (const entry of Object.values(doc.inventory)) {
    if (input.onlyRefs && !input.onlyRefs.includes(entry.artifactRef)) continue;
    const v = verdictFor(entry, context);
    candidates.push({ ref: entry.artifactRef, size: entry.size || 0, verdict: v.verdict, reason: v.reason, blockingRefs: v.blockingRefs });
    if (v.verdict === "SAFE_TO_DELETE") eligibleBytes += entry.size || 0;
  }
  candidates.sort((a, b) => (a.ref < b.ref ? -1 : 1));
  const mode = input.mode === "EXECUTE" ? "EXECUTE" : "DRY_RUN";
  const plan = {
    planId: input.planId || costShared.id12("cln", { project: projectId, at: nowIso(opts.now) }),
    projectId,
    policyVersion: doc.policy.policyVersion,
    candidates,
    planFingerprint: costShared.hash16({ candidates }),
    storageRevision: doc.revision,
    mode,
    createdAt: nowIso(opts.now),
    executedAt: null,
    status: "PROPOSED",
  };
  if (!/^cln-[0-9a-f]{12}$/.test(plan.planId)) {
    return { ok: false, code: "STORAGE_INVENTORY_INVALID", message: "planId cln-<12hex> is required" };
  }
  if (doc.plans[plan.planId]) {
    const prior = doc.plans[plan.planId];
    if (prior.planFingerprint === plan.planFingerprint && prior.mode === plan.mode) {
      return { ok: true, doc, changed: false, deduped: true, plan: prior, eligibleBytes };
    }
    return { ok: false, code: "CLEANUP_PLAN_STALE", message: `plan ${plan.planId} exists with different content (state drifted)` };
  }
  doc.plans[plan.planId] = plan;
  const c = commitDoc(root, projectId, doc, opts);
  if (!c.ok) return c;
  // Anchor freshness to the POST-commit revision: any later mutation bumps
  // the revision and stale-tests this plan. Second phase reuses the counted
  // revision (single logical mutation).
  plan.storageRevision = doc.revision;
  const s = saveDoc(root, projectId, doc);
  if (!s.ok) return s;
  return { ok: true, doc, changed: true, plan, eligibleBytes };
}

/**
 * Execute an EXECUTE-mode plan. Refuses when: mode is DRY_RUN, fingerprint
 * or storage revision drifted (CLEANUP_PLAN_STALE), any candidate is not
 * SAFE_TO_DELETE (CLEANUP_BLOCKED). Deletes files, writes tombstones,
 * prunes inventory entries, marks plan EXECUTED. History and all other
 * canonical records are untouched.
 */
function executeCleanup(root, projectId, planId, opts = {}) {
  const loaded = loadStorage(root, projectId);
  if (!loaded.ok) return loaded;
  const doc = loaded.doc;
  const plan = doc.plans[planId];
  if (!plan) return { ok: false, code: "STORAGE_INVENTORY_INVALID", message: `unknown plan ${planId}` };
  if (plan.status === "EXECUTED") {
    return { ok: true, doc, changed: false, deduped: true, plan };
  }
  if (plan.mode !== "EXECUTE") {
    return { ok: false, code: "CLEANUP_REVIEW_REQUIRED", message: "dry-run plans never execute (explicit EXECUTE plan required)" };
  }
  if (plan.storageRevision !== doc.revision || plan.planFingerprint !== costShared.hash16({ candidates: plan.candidates })) {
    plan.status = "STALE";
    return { ok: false, code: "CLEANUP_PLAN_STALE", message: `${ERRORS.CLEANUP_PLAN_STALE || "stale plan"}: state drifted since planning`, plan };
  }
  const unsafe = plan.candidates.filter((c) => c.verdict !== "SAFE_TO_DELETE");
  if (unsafe.length > 0) {
    return { ok: false, code: "CLEANUP_BLOCKED", message: `plan holds non-deletable candidates: ${unsafe.map((c) => `${c.ref}=${c.verdict}`).join(", ")}` };
  }
  const deleted = [];
  for (const c of plan.candidates) {
    const entry = doc.inventory[c.ref];
    const abs = path.join(projectBase(root, projectId), c.ref);
    let fileExisted = false;
    try {
      fileExisted = fs.existsSync(abs);
      if (fileExisted) fs.unlinkSync(abs);
    } catch (e) {
      return { ok: false, code: "DELETE_FAILED", message: `delete failed for ${c.ref}: ${String((e && e.message) || e)}` };
    }
    doc.tombstones[c.ref] = {
      artifactRef: c.ref,
      hash: (entry && entry.hash) || null,
      formerPath: c.ref,
      reason: c.reason,
      cleanupPlanId: planId,
      deletedAt: nowIso(opts.now),
      generationId: (opts.generationRefs && opts.generationRefs[c.ref]) || null,
    };
    delete doc.inventory[c.ref];
    void fileExisted;
    deleted.push(c.ref);
  }
  plan.status = "EXECUTED";
  plan.executedAt = nowIso(opts.now);
  const c = commitDoc(root, projectId, doc, opts);
  if (!c.ok) return c;
  return { ok: true, doc, changed: true, plan, deleted };
}

module.exports = {
  STORAGE_SCHEMA_VERSION,
  STORE_REL,
  STORAGE_POLICY_VERSION,
  STORAGE_CLASSES,
  DURABILITY,
  REJECTED_RETENTION,
  VERDICTS,
  ERRORS,
  validateDoc,
  exists,
  loadStorage,
  ensureDoc,
  classifyRel,
  buildInventory,
  storageStats,
  findDuplicates,
  findOrphans,
  findMissing,
  verdictFor,
  planCleanup,
  executeCleanup,
};
