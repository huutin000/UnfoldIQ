"use strict";

/**
 * Phase 1H.5 — Golden Projects / quality regression (UNFOLDIQ CORE).
 *
 * Versioned golden definitions (immutable by version; changes supersede),
 * append-only baselines (never overwritten; promotion creates a new
 * version), deterministic comparison (PASS/REVIEW_REQUIRED/FAIL/
 * NOT_COMPARABLE), and bounded canaries (PROMOTE only on all-PASS +
 * explicit actor + reason).
 *
 * Metrics come from lib/golden/metrics.js (direction + method + policy).
 * Golden runs emit correlated telemetry through an injected `emit`
 * callback (dependency inversion — this module never requires telemetry).
 * Emit contract: { eventName, goldenProjectId?, baselineVersion?,
 * canaryId?, status?, goldenSubset?, note? }; canaryId+goldenProjectId is
 * the natural idempotency nonce so verdict replays dedupe instead of
 * duplicating. Recorders map these fields onto telemetry records.
 * Storage: golden/{definitions,baselines,comparisons,canaries}.json
 * (atomic JSON, no database, no binaries — artifacts by id/hash/path).
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const costShared = require("../output-cost/shared.js");
const manifestLib = require("../project-manifest/index.js");
const historyLib = require("../generation-history/index.js");
const metricsLib = require("./metrics.js");

const GOLDEN_SCHEMA_VERSION = "1.0.0";
const METRIC_SCHEMA_VERSION = "1.0.0";

const GOLDEN_STATUS = ["DRAFT", "ACTIVE", "RETIRED"];
const VERDICTS = ["PASS", "REVIEW_REQUIRED", "FAIL", "NOT_COMPARABLE"];
const CANARY_STATUS = ["OPEN", "PROMOTE_ALLOWED", "BLOCKED", "REVIEW_REQUIRED", "PROMOTED"];

// Roadmap coverage dimensions (§22). Golden `categories` map onto these.
const DIMENSIONS = ["FACTUAL", "FICTION", "HYBRID", "CHARACTER_CONTINUITY", "ASPECT_16_9", "ASPECT_9_16", "IMAGE_ONLY", "SELECTIVE_VEO", "RESEARCH_HEAVY", "SPOKEN_HUMANIZATION", "VOICE_CAPTION", "VISUAL_FACTUALITY", "ORIGINALITY"];

// Canary selection: change kind → golden categories exercised (smallest
// subset that covers the changed dimension; §38).
const CANARY_SUBSET_RULES = [
  { match: { changeType: "MODEL", affects: "image-to-video" }, categories: ["character-continuity", "selective-veo"] },
  { match: { changeType: "MODEL", affects: "image" }, categories: ["character-continuity", "image-only"] },
  { match: { changeType: "PROVIDER" }, categories: ["research-heavy", "selective-veo"] },
  { match: { changeType: "PROMPT_POLICY" }, categories: ["fiction", "factual", "originality"] },
  { match: { changeType: "INSTRUCTIONS_POLICY" }, categories: ["character-continuity", "factual-grounding"] },
  { match: { changeType: "QUALITY_POLICY" }, categories: null }, // all ACTIVE
  { match: { changeType: "RESEARCH_PROVIDER" }, categories: ["research-heavy", "factual-grounding"] },
  { match: { changeType: "CAPTION_ALGORITHM" }, categories: ["voice-caption"] },
];

const ERRORS = {
  GOLDEN_NOT_FOUND: "unknown golden project",
  GOLDEN_SCHEMA_INVALID: "golden record fails validation",
  GOLDEN_WRITE_FAILED: "atomic persist failed",
  GOLDEN_CONFLICT: "stale writer or duplicate version",
  BASELINE_NOT_FOUND: "no baseline for this golden",
  BASELINE_VERSION_CONFLICT: "baseline version must advance; same version replays only when identical",
  BASELINE_NOT_COMPARABLE: "baseline incompatible with current metric schema or candidate",
  METRIC_NOT_DEFINED: "unknown metric key",
  METRIC_NOT_APPLICABLE: "metric does not govern this content class",
  GOLDEN_REGRESSION: "candidate regresses beyond policy",
  CANARY_BLOCKED: "failing canary blocks promotion",
  CANARY_REVIEW_REQUIRED: "review-required canary blocks automatic promotion",
};

function defaultGoldenDir(repoRoot) {
  return repoRoot || path.join(__dirname, "..", "..");
}

function docPath(repoRoot, kind) {
  const files = { definitions: "definitions.json", baselines: "baselines.json", comparisons: "comparisons.json", canaries: "canaries.json" };
  return path.join(defaultGoldenDir(repoRoot), "golden", files[kind]);
}

function collFor(kind) {
  return kind === "definitions" ? "definitions" : kind === "baselines" ? "baselines" : kind === "comparisons" ? "comparisons" : "canaries";
}

let validators = {};
function validatorFor(kind) {
  if (!validators[kind]) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const root = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "golden.schema.json"), "utf8"));
    const def = kind === "definitions" ? "definitionsDoc" : kind === "baselines" ? "baselinesDoc" : kind === "comparisons" ? "comparisonsDoc" : "canariesDoc";
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
    return { ok: false, errors: [{ code: "GOLDEN_SCHEMA_INVALID", message: "doc must be an object" }] };
  }
  const valid = validatorFor(kind)(doc);
  if (!valid) {
    for (const e of validatorFor(kind).errors || []) {
      errors.push({ code: "GOLDEN_SCHEMA_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
    }
  }
  const secrets = scanSecrets(doc);
  if (secrets.length > 0) {
    errors.push({ code: "GOLDEN_SCHEMA_INVALID", message: `secret material must never persist: ${secrets.join(", ")}` });
  }
  if (errors.length === 0 && doc.fingerprint !== fingerprintOf(doc)) {
    errors.push({ code: "GOLDEN_SCHEMA_INVALID", message: "fingerprint mismatch: mutated outside the canonical path" });
  }
  return { ok: errors.length === 0, errors };
}

function blankDoc(kind) {
  const at = new Date().toISOString();
  const base = { schemaVersion: GOLDEN_SCHEMA_VERSION, revision: 1, createdAt: at, updatedAt: at, fingerprint: null };
  base[collFor(kind)] = {};
  return base;
}

function loadDoc(kind, repoRoot) {
  const p = docPath(repoRoot, kind);
  if (!fs.existsSync(p)) {
    return { ok: false, code: kind === "definitions" ? "GOLDEN_NOT_FOUND" : "BASELINE_NOT_FOUND", message: `${kind} store absent` };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (e) {
    return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: `unparseable ${kind} store: ${String((e && e.message) || e)}` };
  }
  const v = validateDoc(kind, raw);
  if (!v.ok) return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  return { ok: true, doc: raw };
}

function ensureDoc(kind, repoRoot) {
  const loaded = loadDoc(kind, repoRoot);
  if (loaded.ok) return loaded;
  if (!fs.existsSync(docPath(repoRoot, kind))) {
    const dir = path.join(defaultGoldenDir(repoRoot), "golden");
    fs.mkdirSync(dir, { recursive: true });
    const doc = blankDoc(kind);
    doc.fingerprint = fingerprintOf(doc);
    try {
      fs.writeFileSync(docPath(repoRoot, kind) + ".tmp", JSON.stringify(doc, null, 2) + "\n");
      fs.renameSync(docPath(repoRoot, kind) + ".tmp", docPath(repoRoot, kind));
    } catch (e) {
      return { ok: false, code: "GOLDEN_WRITE_FAILED", message: `${ERRORS.GOLDEN_WRITE_FAILED}: ${String((e && e.message) || e)}` };
    }
    return { ok: true, doc };
  }
  return loaded;
}

function commitDoc(kind, repoRoot, doc, opts = {}) {
  doc.revision += 1;
  doc.updatedAt = nowIso(opts.now);
  doc.fingerprint = fingerprintOf(doc);
  const text = JSON.stringify(doc, null, 2) + "\n";
  JSON.parse(text);
  const v = validateDoc(kind, doc);
  if (!v.ok) return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  try {
    fs.writeFileSync(docPath(repoRoot, kind) + ".tmp", text);
    fs.renameSync(docPath(repoRoot, kind) + ".tmp", docPath(repoRoot, kind));
  } catch (e) {
    return { ok: false, code: "GOLDEN_WRITE_FAILED", message: `${ERRORS.GOLDEN_WRITE_FAILED}: ${String((e && e.message) || e)}` };
  }
  return { ok: true };
}

function emit(opts, payload) {
  if (opts && typeof opts.emit === "function") {
    try { opts.emit(payload); } catch { /* telemetry emission never breaks the verdict path */ }
  }
}

function defKey(id, version) {
  return `${id}:v${version}`;
}

/** Create a golden definition (immutable: later edits supersede by version). */
function createGoldenDefinition(repoRoot, input = {}, opts = {}) {
  if (typeof input.goldenProjectId !== "string" || !/^gold-[0-9a-z-]{1,64}$/.test(input.goldenProjectId)) {
    return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: "goldenProjectId gold-<slug> is required" };
  }
  if (!["FACTUAL", "FICTION", "HYBRID"].includes(input.contentClass)) {
    return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: "contentClass must be FACTUAL|FICTION|HYBRID" };
  }
  if (!Array.isArray(input.categories) || input.categories.length === 0) {
    return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: "categories[] must be non-empty" };
  }
  const allowedKeys = ["goldenProjectId", "name", "contentClass", "categories", "fixture", "platform", "aspectRatio", "requiredCapabilities", "expectedArtifacts", "evaluationProfile", "status"];
  for (const k of Object.keys(input)) {
    if (!allowedKeys.includes(k)) {
      return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: `unknown definition field ${k} (contract is fixed; migrate schema for new fields)` };
    }
  }
  const ensured = ensureDoc("definitions", repoRoot);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  const key = defKey(input.goldenProjectId, 1);
  if (doc.definitions[key]) {
    return { ok: false, code: "GOLDEN_CONFLICT", message: `definition ${key} exists; create a new version instead` };
  }
  const record = {
    goldenProjectId: input.goldenProjectId,
    version: 1,
    name: input.name || input.goldenProjectId,
    categories: input.categories.map(String),
    fixture: { projectId: (input.fixture && input.fixture.projectId) || null, kind: (input.fixture && input.fixture.kind) || "evidence", detail: (input.fixture && input.fixture.detail) || null },
    contentClass: input.contentClass,
    platform: input.platform || "youtube",
    aspectRatio: input.aspectRatio || "16:9",
    requiredCapabilities: Array.isArray(input.requiredCapabilities) ? input.requiredCapabilities.map(String) : [],
    expectedArtifacts: Array.isArray(input.expectedArtifacts) ? input.expectedArtifacts.map(String) : [],
    evaluationProfile: input.evaluationProfile || "v1-local-evidence",
    baselineRef: null,
    status: input.status || "DRAFT",
    supersedes: null,
  };
  if (!record.fixture.projectId) {
    return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: "fixture.projectId is required (goldens reuse canonical evidence)" };
  }
  if (!GOLDEN_STATUS.includes(record.status)) {
    return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: `status must be ${GOLDEN_STATUS.join("|")}` };
  }
  doc.definitions[key] = record;
  const c = commitDoc("definitions", repoRoot, doc, opts);
  if (!c.ok) return c;
  emit(opts, { eventName: "GOLDEN_RUN", note: "definition created", goldenProjectId: record.goldenProjectId });
  return { ok: true, doc, changed: true, definition: record, key };
}

/** New definition version (status changes travel by version, never in place). */
function createGoldenVersion(repoRoot, goldenProjectId, version, changes = {}, opts = {}) {
  const ensured = ensureDoc("definitions", repoRoot);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  const prevKey = defKey(goldenProjectId, version - 1);
  const prev = doc.definitions[prevKey];
  if (!prev) return { ok: false, code: "GOLDEN_NOT_FOUND", message: `previous version ${prevKey} not found` };
  const key = defKey(goldenProjectId, version);
  if (doc.definitions[key]) {
    const same = costShared.stableStringify(doc.definitions[key]) === costShared.stableStringify({ ...prev, version, supersedes: prevKey, ...(changes || {}) });
    if (same) return { ok: true, doc, changed: false, deduped: true, definition: doc.definitions[key], key };
    return { ok: false, code: "GOLDEN_CONFLICT", message: `definition ${key} exists with different content` };
  }
  const record = { ...JSON.parse(JSON.stringify(prev)), ...JSON.parse(JSON.stringify(changes || {})), goldenProjectId, version, supersedes: prevKey };
  if (record.status && !GOLDEN_STATUS.includes(record.status)) {
    return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: `status must be ${GOLDEN_STATUS.join("|")}` };
  }
  doc.definitions[key] = record;
  const c = commitDoc("definitions", repoRoot, doc, opts);
  if (!c.ok) return c;
  return { ok: true, doc, changed: true, definition: record, key };
}

function getDefinition(repoRoot, goldenProjectId, version = null) {
  const loaded = loadDoc("definitions", repoRoot);
  if (!loaded.ok) return loaded;
  if (version !== null) {
    const rec = loaded.doc.definitions[defKey(goldenProjectId, version)];
    if (!rec) return { ok: false, code: "GOLDEN_NOT_FOUND", message: ERRORS.GOLDEN_NOT_FOUND };
    return { ok: true, definition: rec, key: defKey(goldenProjectId, version) };
  }
  let best = null;
  let bestKey = null;
  for (const [k, rec] of Object.entries(loaded.doc.definitions)) {
    if (rec.goldenProjectId === goldenProjectId && (!best || rec.version > best.version)) { best = rec; bestKey = k; }
  }
  if (!best) return { ok: false, code: "GOLDEN_NOT_FOUND", message: ERRORS.GOLDEN_NOT_FOUND };
  return { ok: true, definition: best, key: bestKey };
}

function latestBaseline(repoRoot, goldenProjectId) {
  const loaded = loadDoc("baselines", repoRoot);
  if (!loaded.ok) return { ok: false, code: "BASELINE_NOT_FOUND", message: ERRORS.BASELINE_NOT_FOUND };
  let best = null;
  for (const b of Object.values(loaded.doc.baselines)) {
    if (b.goldenProjectId === goldenProjectId && (!best || b.version > best.version)) best = b;
  }
  if (!best) return { ok: false, code: "BASELINE_NOT_FOUND", message: ERRORS.BASELINE_NOT_FOUND };
  return { ok: true, baseline: best };
}

/**
 * Create a baseline version. Append-only: version must exceed the latest;
 * same version replays only when byte-identical. Every metric value is
 * validated (judgment metrics need reviewer/method/confidence/evidence).
 */
function createBaseline(repoRoot, input = {}, opts = {}) {
  const def = getDefinition(repoRoot, input.goldenProjectId, input.goldenVersion || null);
  if (!def.ok) return def;
  for (const [k, mv] of Object.entries(input.metrics || {})) {
    const v = metricsLib.validateMetricValue(k, mv, def.definition.contentClass);
    if (!v.ok) return { ok: false, code: v.code, message: v.message };
  }
  const ensured = ensureDoc("baselines", repoRoot);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  const latest = latestBaseline(repoRoot, input.goldenProjectId);
  const version = input.version || ((latest.ok ? latest.baseline.version : 0) + 1);
  if (latest.ok && version < latest.baseline.version) {
    return { ok: false, code: "BASELINE_VERSION_CONFLICT", message: "baseline versions only advance (old versions are preserved, never rewritten)" };
  }
  const record = {
    baselineId: input.baselineId || costShared.id12("base", { golden: input.goldenProjectId, version }),
    goldenProjectId: input.goldenProjectId,
    goldenVersion: def.definition.version,
    version,
    metrics: JSON.parse(JSON.stringify(input.metrics || {})),
    pipelineVersion: input.pipelineVersion || null,
    providerVersions: Array.isArray(input.providerVersions) ? input.providerVersions.map(String) : [],
    promptPolicyVersion: input.promptPolicyVersion || null,
    instructionsVersion: input.instructionsVersion || null,
    artifactVersions: input.artifactVersions || {},
    perf: input.perf || null,
    cost: input.cost || null,
    evidenceRefs: Array.isArray(input.evidenceRefs) ? input.evidenceRefs.map(String) : [],
    createdAt: input.createdAt || nowIso(opts.now),
    reason: input.reason || "initial baseline",
    metricSchemaVersion: METRIC_SCHEMA_VERSION,
  };
  if (!/^base-[0-9a-f]{12}$/.test(record.baselineId)) {
    return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: "baselineId base-<12hex> is required" };
  }
  const dupKey = Object.keys(doc.baselines).find((k) => {
    const b = doc.baselines[k];
    return b.goldenProjectId === record.goldenProjectId && b.version === record.version;
  });
  if (dupKey) {
    // Same version replays only when the metric content is identical.
    const a = costShared.stableStringify(doc.baselines[dupKey].metrics);
    const b = costShared.stableStringify(record.metrics);
    if (a === b) return { ok: true, doc, changed: false, deduped: true, baseline: doc.baselines[dupKey] };
    return { ok: false, code: "BASELINE_VERSION_CONFLICT", message: "same baseline version with different metrics — advance the version instead" };
  }
  const key = `${record.goldenProjectId}:b${record.version}`;
  doc.baselines[key] = record;
  const c = commitDoc("baselines", repoRoot, doc, opts);
  if (!c.ok) return c;
  emit(opts, { eventName: "GOLDEN_RUN", note: "baseline recorded", goldenProjectId: record.goldenProjectId, baselineVersion: record.version });
  return { ok: true, doc, changed: true, baseline: record, key };
}

/**
 * Deterministic comparison. Drift (unknown metric keys, missing keys,
 * metric-schema mismatch) → NOT_COMPARABLE, never a silent pass.
 */
function compareToBaseline(repoRoot, goldenProjectId, candidate = {}, opts = {}) {
  const base = latestBaseline(repoRoot, goldenProjectId);
  if (!base.ok) return base;
  const baseline = base.baseline;
  if (baseline.metricSchemaVersion !== METRIC_SCHEMA_VERSION) {
    return persistComparison(repoRoot, { goldenProjectId, baselineVersion: baseline.version, candidateLabel: candidate.label || "candidate", metricResults: [], regressions: [], improvements: [], verdict: "NOT_COMPARABLE", note: "metric schema drift" }, opts);
  }
  const candMetrics = candidate.metrics || {};
  const baseKeys = Object.keys(baseline.metrics).sort();
  const candKeys = Object.keys(candMetrics).sort();
  const unknown = candKeys.filter((k) => !metricsLib.metricDef(k));
  const missing = baseKeys.filter((k) => !(k in candMetrics));
  if (unknown.length > 0 || missing.length > 0) {
    return persistComparison(repoRoot, {
      goldenProjectId, baselineVersion: baseline.version, candidateLabel: candidate.label || "candidate",
      metricResults: [], regressions: [], improvements: [],
      verdict: "NOT_COMPARABLE",
      note: `drift: unknown=[${unknown}] missing=[${missing}]`,
    }, opts);
  }
  // Candidate-only MEASURED keys are new measurements the baseline cannot
  // judge: REVIEW_REQUIRED (baseline extension is a human decision), never
  // silently dropped.
  const extra = candKeys.filter((k) => !(k in baseline.metrics) && candMetrics[k] && candMetrics[k].status === "MEASURED");
  const metricResults = [];
  const regressions = [];
  const improvements = [];
  for (const k of extra) {
    metricResults.push({ metric: k, baseline: "absent", candidate: "MEASURED", verdict: "REVIEW_REQUIRED", reason: "new measurement needs a baseline-extension decision" });
    regressions.push({ metric: k, baseline: null, candidate: candMetrics[k].value !== undefined ? candMetrics[k].value : null, reason: "new measurement needs a baseline-extension decision", review: true });
  }
  for (const k of baseKeys) {
    const bm = baseline.metrics[k];
    const cm = candMetrics[k];
    if (bm.status !== "MEASURED" || cm.status !== "MEASURED") {
      metricResults.push({ metric: k, baseline: bm.status, candidate: cm.status, verdict: "SKIP", reason: "needs MEASURED on both sides" });
      continue;
    }
    if (cm.value !== undefined && typeof cm.value === "object") {
      metricResults.push({ metric: k, verdict: "REVIEW_REQUIRED", reason: "complex values need human comparison" });
      continue;
    }
    const r = metricsLib.compareMetric(k, bm.value, cm.value);
    metricResults.push({ metric: k, baseline: bm.value, candidate: cm.value, verdict: r.verdict, delta: r.delta !== undefined ? r.delta : null, reason: r.reason });
    if (r.verdict === "FAIL") regressions.push({ metric: k, baseline: bm.value, candidate: cm.value, reason: r.reason });
    else if (r.verdict === "REVIEW_REQUIRED") regressions.push({ metric: k, baseline: bm.value, candidate: cm.value, reason: r.reason, review: true });
    else if (r.reason === "improvement") improvements.push({ metric: k, baseline: bm.value, candidate: cm.value });
  }
  // Hard budget gate (§30): candidate cost above a declared hardBudget FAILs.
  if (candidate.hardBudget !== undefined && candidate.hardBudget !== null
    && candMetrics.cost && candMetrics.cost.status === "MEASURED" && typeof candMetrics.cost.value === "number"
    && candMetrics.cost.value > candidate.hardBudget) {
    regressions.push({ metric: "cost", baseline: baseline.metrics.cost && baseline.metrics.cost.value, candidate: candMetrics.cost.value, reason: `exceeds hard budget ${candidate.hardBudget}` });
    metricResults.push({ metric: "cost:hardBudget", verdict: "FAIL", reason: `cost ${candMetrics.cost.value} > hard budget ${candidate.hardBudget}` });
  }
  let verdict = "PASS";
  if (metricResults.some((m) => m.verdict === "FAIL") || regressions.some((r) => !r.review)) verdict = "FAIL";
  else if (metricResults.some((m) => m.verdict === "REVIEW_REQUIRED") || regressions.some((r) => r.review)) verdict = "REVIEW_REQUIRED";
  return persistComparison(repoRoot, {
    goldenProjectId, baselineVersion: baseline.version, candidateLabel: candidate.label || "candidate",
    metricResults, regressions, improvements, verdict,
  }, opts);
}

function persistComparison(repoRoot, comp, opts = {}) {
  const ensured = ensureDoc("comparisons", repoRoot);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  const record = {
    comparisonId: comp.comparisonId || costShared.id12("cmp", { golden: comp.goldenProjectId, base: comp.baselineVersion, cand: comp.candidateLabel }),
    goldenProjectId: comp.goldenProjectId,
    baselineVersion: comp.baselineVersion,
    candidateLabel: comp.candidateLabel,
    metricResults: comp.metricResults || [],
    regressions: comp.regressions || [],
    improvements: comp.improvements || [],
    verdict: comp.verdict,
    comparedAt: nowIso(opts.now),
    canaryId: comp.canaryId || null,
  };
  if (!VERDICTS.includes(record.verdict)) {
    return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: `verdict must be ${VERDICTS.join("|")}` };
  }
  if (doc.comparisons[record.comparisonId]) {
    return { ok: true, doc, changed: false, deduped: true, comparison: doc.comparisons[record.comparisonId] };
  }
  if (record.verdict === "FAIL") emit(opts, { eventName: "GOLDEN_RUN", note: "regression detected", errorCode: "GOLDEN_REGRESSION", goldenProjectId: record.goldenProjectId });
  doc.comparisons[record.comparisonId] = record;
  const c = commitDoc("comparisons", repoRoot, doc, opts);
  if (!c.ok) return c;
  return { ok: true, doc, changed: true, comparison: record };
}

/** Smallest golden subset exercising the changed dimension (§38). */
function selectCanary(repoRoot, change = {}) {
  const loaded = loadDoc("definitions", repoRoot);
  if (!loaded.ok) return loaded;
  const rule = CANARY_SUBSET_RULES.find((r) => {
    if (r.match.changeType !== change.changeType) return false;
    if (r.match.affects && change.affects !== r.match.affects) return false;
    return true;
  });
  if (!rule) return { ok: false, code: "GOLDEN_NOT_FOUND", message: `no canary rule for change ${change.changeType}` };
  const subset = [];
  for (const rec of Object.values(loaded.doc.definitions)) {
    if (rec.status !== "ACTIVE") continue;
    if (rule.categories === null) { subset.push(rec.goldenProjectId); continue; }
    if (rec.categories.some((c) => rule.categories.includes(c))) subset.push(rec.goldenProjectId);
  }
  return { ok: true, subset: [...new Set(subset)].sort() };
}

/** Open a canary with a visible cost estimate (C7) — paid stays gated (C8). */
function openCanary(repoRoot, change = {}, opts = {}) {
  const sel = selectCanary(repoRoot, change);
  if (!sel.ok) return sel;
  const ensured = ensureDoc("canaries", repoRoot);
  if (!ensured.ok) return ensured;
  const doc = ensured.doc;
  const record = {
    canaryId: costShared.id12("can", { change: change.changeType, at: nowIso(opts.now) }),
    change,
    goldenSubset: sel.subset,
    status: "OPEN",
    comparisonIds: [],
    promotedBaselineRef: null,
    createdAt: nowIso(opts.now),
    decidedAt: null,
    costEstimate: change.costEstimate || { paidGenerations: 0, note: "local/mock evaluation only" },
  };
  doc.canaries[record.canaryId] = record;
  const c = commitDoc("canaries", repoRoot, doc, opts);
  if (!c.ok) return c;
  emit(opts, { eventName: "CANARY", note: "canary opened", canaryId: record.canaryId, goldenSubset: record.goldenSubset });
  return { ok: true, doc, changed: true, canary: record };
}

/** Run one golden inside a canary (candidate metrics supplied, never paid). */
function runCanaryGolden(repoRoot, canaryId, goldenProjectId, candidate = {}, opts = {}) {
  const loaded = loadDoc("canaries", repoRoot);
  if (!loaded.ok) return loaded;
  const canary = loaded.doc.canaries[canaryId];
  if (!canary) return { ok: false, code: "GOLDEN_NOT_FOUND", message: `unknown canary ${canaryId}` };
  if (!canary.goldenSubset.includes(goldenProjectId)) {
    return { ok: false, code: "GOLDEN_NOT_FOUND", message: `${goldenProjectId} not in this canary subset (no unrelated goldens by default)` };
  }
  const cmp = compareToBaseline(repoRoot, goldenProjectId, candidate, opts);
  if (!cmp.ok) return cmp;
  const doc = loadDoc("canaries", repoRoot).doc;
  const can = doc.canaries[canaryId];
  can.comparisonIds.push(cmp.comparison.comparisonId);
  const cmpDocs = loadDoc("comparisons", repoRoot).doc;
  const withGolden = can.comparisonIds.map((id) => cmpDocs.comparisons[id]).filter(Boolean);
  if (withGolden.some((c) => c.verdict === "FAIL")) can.status = "BLOCKED";
  else if (withGolden.some((c) => c.verdict === "REVIEW_REQUIRED" || c.verdict === "NOT_COMPARABLE")) can.status = "REVIEW_REQUIRED";
  else if (can.comparisonIds.length >= can.goldenSubset.length) can.status = "PROMOTE_ALLOWED";
  can.decidedAt = nowIso(opts.now);
  const c = commitDoc("canaries", repoRoot, doc, opts);
  if (!c.ok) return c;
  // Emit contract (telemetry recorders): eventName is always a valid
  // telemetry class (GOLDEN_RUN / CANARY); verdicts and markers travel in
  // note/errorCode/status. canaryId+goldenProjectId is the natural
  // idempotency nonce so verdict replays dedupe instead of duplicating.
  emit(opts, { eventName: "CANARY", note: `canary verdict: ${can.status}`, canaryId, status: can.status, goldenProjectId });
  return { ok: true, comparison: cmp.comparison, canary: can };
}

/**
 * Explicit promotion (§39/§40): PASS-only + actor + reason. Creates NEW
 * baseline versions from the canary candidates; old baselines preserved.
 * FAIL → CANARY_BLOCKED; REVIEW → CANARY_REVIEW_REQUIRED (no auto-promote).
 */
function promoteCanary(repoRoot, canaryId, input = {}, opts = {}) {
  const loaded = loadDoc("canaries", repoRoot);
  if (!loaded.ok) return loaded;
  const canary = loaded.doc.canaries[canaryId];
  if (!canary) return { ok: false, code: "GOLDEN_NOT_FOUND", message: `unknown canary ${canaryId}` };
  if (canary.status === "BLOCKED") {
    return { ok: false, code: "CANARY_BLOCKED", message: ERRORS.CANARY_BLOCKED };
  }
  if (canary.status !== "PROMOTE_ALLOWED") {
    return { ok: false, code: "CANARY_REVIEW_REQUIRED", message: `${ERRORS.CANARY_REVIEW_REQUIRED}: status ${canary.status}` };
  }
  if (typeof input.actor !== "string" || !input.actor || typeof input.reason !== "string" || !input.reason) {
    return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: "promotion needs an explicit actor + reason" };
  }
  // Candidate values travel in opts.candidates (CLI contract); accepted from
  // input.candidateMetrics only as a documented alias — never invented here.
  const candidateSets = (opts && opts.candidates) || input.candidateMetrics || null;
  const cmpDocs = loadDoc("comparisons", repoRoot).doc;
  const promoted = [];
  for (const cid of canary.comparisonIds) {
    const cmp = cmpDocs.comparisons[cid];
    if (!cmp || cmp.verdict !== "PASS") {
      return { ok: false, code: "CANARY_BLOCKED", message: `comparison ${cid} is not PASS` };
    }
    // Candidate metric VALUES come from the recorded comparison inputs: the
    // caller re-supplies them here (promote never invents values).
    const candMetrics = (candidateSets && candidateSets[cmp.goldenProjectId]) || null;
    if (!candMetrics) {
      return { ok: false, code: "GOLDEN_SCHEMA_INVALID", message: `candidate metrics required to promote ${cmp.goldenProjectId}` };
    }
    const nb = createBaseline(repoRoot, {
      goldenProjectId: cmp.goldenProjectId,
      metrics: candMetrics,
      reason: `promoted from canary ${canaryId} by ${input.actor}: ${input.reason}`,
    }, opts);
    if (!nb.ok) return nb;
    promoted.push(nb.baseline.baselineId);
  }
  canary.status = "PROMOTED";
  canary.promotedBaselineRef = promoted[0] || null;
  canary.decidedAt = nowIso(opts.now);
  const c = commitDoc("canaries", repoRoot, loadDoc("canaries", repoRoot).doc, opts);
  if (!c.ok) return c;
  return { ok: true, canary, promoted };
}

/** Roadmap coverage: every dimension COVERED/PARTIALLY/DEFERRED (explicit). */
function coverageMatrix(repoRoot) {
  const loaded = loadDoc("definitions", repoRoot);
  if (!loaded.ok) return loaded;
  const actives = Object.values(loaded.doc.definitions).filter((d) => d.status === "ACTIVE");
  const baseLoaded = loadDoc("baselines", repoRoot);
  const hasBaseline = (id) => baseLoaded.ok && Object.values(baseLoaded.doc.baselines).some((b) => b.goldenProjectId === id);
  const matrix = {};
  const aspectOf = (dim) => (dim === "ASPECT_16_9" ? "16:9" : dim === "ASPECT_9_16" ? "9:16" : null);
  for (const dim of DIMENSIONS) {
    // Aspect coverage reads the definition's aspectRatio contract (not a
    // category tag); every other dimension maps via categories.
    const aspect = aspectOf(dim);
    const goldens = aspect
      ? actives.filter((d) => d.aspectRatio === aspect).map((d) => d.goldenProjectId)
      : actives.filter((d) => d.categories.includes(dim.toLowerCase().replace(/_/g, "-"))).map((d) => d.goldenProjectId);
    if (goldens.length === 0) {
      matrix[dim] = { status: "DEFERRED_WITH_REASON", goldens: [], reason: null };
    } else if (goldens.every((g) => hasBaseline(g))) {
      matrix[dim] = { status: "COVERED", goldens };
    } else {
      matrix[dim] = { status: "PARTIALLY_COVERED", goldens, reason: "definition exists without a baseline" };
    }
  }
  return { ok: true, matrix };
}

module.exports = {
  GOLDEN_SCHEMA_VERSION,
  METRIC_SCHEMA_VERSION,
  GOLDEN_STATUS,
  VERDICTS,
  CANARY_STATUS,
  DIMENSIONS,
  ERRORS,
  validateDoc,
  loadDoc,
  createGoldenDefinition,
  createGoldenVersion,
  getDefinition,
  latestBaseline,
  createBaseline,
  compareToBaseline,
  selectCanary,
  openCanary,
  runCanaryGolden,
  promoteCanary,
  coverageMatrix,
};
