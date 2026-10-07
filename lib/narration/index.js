"use strict";

/**
 * Phase 2.2 — Narration Direction (UNFOLDIQ CORE).
 *
 * Versioned, machine-readable, SEGMENT-SCOPED delivery direction applied
 * before final TTS. Sparse by design: only segments that need explicit
 * direction are stored; every other segment inherits Voice Bible defaults.
 * The Voice Bible remains authoritative for voice identity, emotional range
 * and prohibited delivery traits. Source text is never mutated.
 *
 * Segment identity (§4): segmentId + segmentOrdinal + sourceTextHash bind a
 * direction to the exact spoken bytes of one script version. A script text or
 * version change makes the dependent direction stale (fail-closed), never
 * silently re-applied.
 */

const Ajv = require("ajv");
const fs = require("fs");
const path = require("path");
const workspaceLib = require("../workspace/index.js");
const manifestLib = require("../project-manifest/index.js");
const dagLib = require("../dependency-dag/index.js");
const telemetryLib = require("../telemetry/index.js");
const costShared = require("../output-cost/shared.js");

const ND_SCHEMA_VERSION = "1.0.0";
const ND_DIR_REL = "voice/narration-direction";
const LIFECYCLE = "DURABLE";

const ENERGIES = ["LOW", "BALANCED", "ELEVATED"];
const PACES = ["SLOWER", "MODERATE", "FASTER"];
const PAUSE_KINDS = ["MICRO", "CLAUSE", "BEAT", "SECTION"];
const EMPHASIS_STRENGTHS = ["LIGHT", "MODERATE", "STRONG"];

// Over-direction review threshold (§6.7): measured, never auto-failed.
const OVER_DIRECTION_COVERAGE_PERCENT = 80;

const ERRORS = {
  NARRATION_DIRECTION_NOT_FOUND: "narration direction version does not exist",
  NARRATION_DIRECTION_SCHEMA_INVALID: "narration direction fails schema validation",
  NARRATION_DIRECTION_SCRIPT_MISMATCH: "direction does not belong to the current script version/text",
  NARRATION_DIRECTION_SEGMENT_NOT_FOUND: "directed segmentId does not exist in the script",
  NARRATION_DIRECTION_EMPHASIS_AMBIGUOUS: "emphasis target text/occurrence is ambiguous for the segment",
  NARRATION_DIRECTION_EMOTION_NOT_ALLOWED: "emotion is outside the Voice Bible emotional range",
  NARRATION_DIRECTION_SPEAKER_INVALID: "speakerId is not the narrator and not a Voice Bible character voice",
  NARRATION_DIRECTION_CONFLICT: "direction requests a delivery pattern prohibited by the Voice Bible",
  NARRATION_DIRECTION_PAUSE_TARGET_INVALID: "pause anchor text/occurrence not found in the segment",
  NARRATION_DIRECTION_VERSION_CONFLICT: "direction version already exists; versions are immutable",
  NARRATION_DIRECTION_WRITE_FAILED: "atomic persist failed; previous state untouched",
  NARRATION_DIRECTION_PATH_NOT_ALLOWED: "path outside approved workspace locations",
  ARTIFACT_PATH_NOT_ALLOWED: "path is outside approved workspace locations",
  ARTIFACT_LIFECYCLE_INVALID: "lifecycle class invalid",
};

let ajvValidator = null;
function validator() {
  if (!ajvValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "narration-direction.schema.json"), "utf8"));
    ajvValidator = ajv.compile(schema);
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

function segmentHash(text) {
  return costShared.hash16(String(text));
}

// ---------------------------------------------------------------------------
// Path approval + immutable persistence (mirrors lib/voice-bible)
// ---------------------------------------------------------------------------

function ndRel(ndId) {
  return `${ND_DIR_REL}/${ndId}.json`;
}

function approveNdPath(root, projectId, ndId) {
  const lifecycle = workspaceLib.classifyNewArtifact({ artifactType: "VOICE", lifecycleClass: LIFECYCLE });
  if (!lifecycle.ok || lifecycle.reviewRequired) {
    return { ok: false, code: "ARTIFACT_LIFECYCLE_INVALID", message: "Narration Direction must be explicitly DURABLE, never defaulted" };
  }
  const rel = ndRel(ndId);
  const guard = workspaceLib.validateWorkspacePath(root, path.posix.join("projects", projectId, rel), { projectId });
  if (!guard.ok) return { ok: false, code: "ARTIFACT_PATH_NOT_ALLOWED", message: guard.message };
  return { ok: true, rel, lifecycleClass: lifecycle.lifecycleClass };
}

function persistNdVersion(root, projectId, doc) {
  const approved = approveNdPath(root, projectId, doc.narrationDirectionId);
  if (!approved.ok) return approved;
  const abs = path.join(root, "projects", projectId, approved.rel);
  if (fs.existsSync(abs)) {
    return { ok: false, code: "NARRATION_DIRECTION_VERSION_CONFLICT", message: `${ERRORS.NARRATION_DIRECTION_VERSION_CONFLICT}: ${doc.narrationDirectionId}` };
  }
  const v = validateSchemaOnly(doc);
  if (!v.ok) return { ok: false, code: "NARRATION_DIRECTION_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  try {
    fs.mkdirSync(path.join(root, "projects", projectId, ND_DIR_REL), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, abs);
  } catch (e) {
    return { ok: false, code: "NARRATION_DIRECTION_WRITE_FAILED", message: `${ERRORS.NARRATION_DIRECTION_WRITE_FAILED}: ${String((e && e.message) || e)}` };
  }
  return { ok: true, rel: approved.rel, lifecycleClass: approved.lifecycleClass };
}

function validateSchemaOnly(doc) {
  const valid = validator()(doc);
  if (valid) return { ok: true, errors: [] };
  const errors = [];
  for (const e of validator().errors || []) {
    errors.push({ code: "NARRATION_DIRECTION_SCHEMA_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
  }
  return { ok: false, errors };
}

function loadNarrationDirection(root, projectId, ndId) {
  const p = path.join(root, "projects", projectId, ndRel(ndId));
  if (!fs.existsSync(p)) {
    return { ok: false, code: "NARRATION_DIRECTION_NOT_FOUND", message: `${ERRORS.NARRATION_DIRECTION_NOT_FOUND}: ${ndId}` };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    const v = validateSchemaOnly(doc);
    if (!v.ok) return { ok: false, code: "NARRATION_DIRECTION_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
    return { ok: true, narrationDirection: doc, rel: ndRel(ndId) };
  } catch (e) {
    return { ok: false, code: "NARRATION_DIRECTION_SCHEMA_INVALID", message: String((e && e.message) || e) };
  }
}

function listNarrationDirections(root, projectId) {
  const dir = path.join(root, "projects", projectId, ND_DIR_REL);
  if (!fs.existsSync(dir)) return { ok: true, narrationDirections: [] };
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".json")) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      out.push({ narrationDirectionId: doc.narrationDirectionId, version: doc.version, fingerprint: doc.fingerprint });
    } catch { /* listing never validates away unparseable files */ }
  }
  out.sort((a, b) => a.version - b.version);
  return { ok: true, narrationDirections: out };
}

function latestNarrationDirection(root, projectId) {
  const listed = listNarrationDirections(root, projectId);
  if (!listed.ok) return listed;
  if (listed.narrationDirections.length === 0) {
    return { ok: false, code: "NARRATION_DIRECTION_NOT_FOUND", message: ERRORS.NARRATION_DIRECTION_NOT_FOUND };
  }
  return loadNarrationDirection(root, projectId, listed.narrationDirections[listed.narrationDirections.length - 1].narrationDirectionId);
}

// ---------------------------------------------------------------------------
// Semantics (§6) + verification (§7)
// ---------------------------------------------------------------------------

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  let count = 0;
  let i = haystack.toLowerCase().indexOf(needle.toLowerCase());
  while (i >= 0) {
    count += 1;
    i = haystack.toLowerCase().indexOf(needle.toLowerCase(), i + needle.length);
  }
  return count;
}

/**
 * Prohibited delivery patterns (§6.5/§7): deterministic direction-level
 * predicates for the traits the Voice Bible declares. Traits with no
 * deterministic direction-level predicate are skipped honestly (documented).
 */
function prohibitedTraitPredicates() {
  return {
    UNNATURALLY_SLOW_CINEMATIC: (d) => d.paceIntent === "SLOWER" && d.energy === "LOW",
    EXCESSIVE_PAUSES: (d) => (d.pauseIntent || []).length >= 3,
    CONSTANT_DRAGMATIC_EMPHASIS: (d) => (d.emphasis || []).length >= 4,
    OVERACTING: (d) => d.energy === "ELEVATED" && (d.emphasis || []).length >= 2,
    // MONOTONE_CADENCE / ROBOTIC_CLAUSE_RHYTHM / ANNOUNCER_BOMBAST: measurable
    // only on synthesized audio (Phase 2.4); never guessed here.
  };
}

/**
 * Full semantic verification against the current script + Voice Bible.
 * Returns per-segment VALID / REVIEW_REQUIRED / INVALID plus doc-level state.
 * One invalid segment never invalidates unrelated segments (§7), only a
 * script/version mismatch marks the whole artifact stale.
 */
function validateNarrationDirection(doc, ctx = {}) {
  const script = ctx.scriptDoc;
  const voiceBible = ctx.voiceBible;
  const errors = [];
  const segmentResults = [];
  if (!script) {
    return { ok: false, stale: false, allValid: false, segmentResults: [], errors: [{ code: "NARRATION_DIRECTION_SCRIPT_MISMATCH", message: "scriptDoc context required" }] };
  }
  if (!voiceBible) {
    return { ok: false, stale: false, allValid: false, segmentResults: [], errors: [{ code: "NARRATION_DIRECTION_CONFLICT", message: "voiceBible context required" }] };
  }
  const scriptSegments = new Map(script.segments.map((s) => [s.segmentId, s]));
  if (doc.scriptRef.scriptArtifactId !== script.scriptArtifactId || doc.scriptRef.scriptVersion !== script.scriptVersion) {
    errors.push({ code: "NARRATION_DIRECTION_SCRIPT_MISMATCH", message: `direction targets ${doc.scriptRef.scriptArtifactId}@v${doc.scriptRef.scriptVersion}, current is ${script.scriptArtifactId}@v${script.scriptVersion}` });
  }
  const emotionalRange = (voiceBible.narrator && voiceBible.narrator.emotionalRange) || [];
  const prohibited = new Set((voiceBible.narrator && voiceBible.narrator.prohibitedTraits) || []);
  const characterVoices = new Set((voiceBible.characterVoices || []).map((c) => c.voiceId).filter(Boolean));
  const predicates = prohibitedTraitPredicates();
  const anyStale = errors.length > 0;

  for (const d of doc.segments || []) {
    const issues = [];
    let status = "VALID";
    const seg = scriptSegments.get(d.segmentId);
    if (!seg) {
      issues.push({ code: "NARRATION_DIRECTION_SEGMENT_NOT_FOUND", detail: d.segmentId });
      segmentResults.push({ segmentId: d.segmentId, status: "INVALID", issues });
      continue;
    }
    if (d.sourceTextHash !== segmentHash(seg.text)) {
      issues.push({ code: "NARRATION_DIRECTION_SCRIPT_MISMATCH", detail: `sourceTextHash mismatch for ${d.segmentId} (stale direction)` });
      segmentResults.push({ segmentId: d.segmentId, status: "INVALID", issues });
      continue;
    }
    if (d.speakerId && d.speakerId !== "narrator" && !characterVoices.has(d.speakerId)) {
      issues.push({ code: "NARRATION_DIRECTION_SPEAKER_INVALID", detail: String(d.speakerId) });
      status = "INVALID";
    }
    if (d.emotion && !emotionalRange.includes(d.emotion)) {
      issues.push({ code: "NARRATION_DIRECTION_EMOTION_NOT_ALLOWED", detail: `${d.emotion} not in Voice Bible emotionalRange` });
      status = "INVALID";
    }
    for (const e of d.emphasis || []) {
      const n = countOccurrences(seg.text, e.text);
      if (n === 0 || e.occurrence > n) {
        issues.push({ code: "NARRATION_DIRECTION_EMPHASIS_AMBIGUOUS", detail: `"${e.text}" occurrence ${e.occurrence} of ${n}` });
        status = "INVALID";
      }
    }
    for (const p of d.pauseIntent || []) {
      const n = countOccurrences(seg.text, p.afterText);
      const occ = p.occurrence || 1;
      if (n === 0 || occ > n) {
        issues.push({ code: "NARRATION_DIRECTION_PAUSE_TARGET_INVALID", detail: `"${p.afterText}" occurrence ${occ} of ${n}` });
        status = "INVALID";
      }
    }
    if (status === "VALID") {
      for (const trait of prohibited) {
        const pred = predicates[trait];
        if (pred && pred(d)) {
          issues.push({ code: "NARRATION_DIRECTION_CONFLICT", detail: `prohibited Voice Bible trait requested: ${trait}` });
          status = "INVALID";
          break;
        }
      }
    }
    segmentResults.push({ segmentId: d.segmentId, status, issues });
  }
  const allValid = segmentResults.length > 0 && segmentResults.every((r) => r.status === "VALID");
  return { ok: allValid && errors.length === 0, stale: anyStale, allValid, segmentResults, errors };
}

function computeStats(directions, totalSegments) {
  const directedSegments = directions.length;
  const emphasisCount = directions.reduce((n, d) => n + (d.emphasis || []).length, 0);
  const explicitPauseCount = directions.reduce((n, d) => n + (d.pauseIntent || []).length, 0);
  const directionCoveragePercent = totalSegments === 0 ? 0 : Number(((directedSegments / totalSegments) * 100).toFixed(2));
  return {
    totalSegments,
    directedSegments,
    directionCoveragePercent,
    emphasisCount,
    explicitPauseCount,
    overDirectionReview: directionCoveragePercent >= OVER_DIRECTION_COVERAGE_PERCENT,
  };
}

function ndSemantic(doc) {
  return costShared.hash16({
    scriptRef: doc.scriptRef,
    voiceBibleRef: doc.voiceBibleRef,
    language: doc.language,
    segments: doc.segments,
  });
}

function nextIdentity(previous, semantic) {
  const version = previous ? previous.version + 1 : 1;
  return { narrationDirectionId: costShared.id12("nd", { project: previous ? previous.projectId : null, version, semantic }), version };
}

/**
 * Create v1. Refuses duplicate creation (use revise). Fails closed when any
 * directed segment is semantically INVALID; REVIEW_REQUIRED segments are
 * surfaced in the result but do not block persistence (they are honest state).
 */
function createNarrationDirection(root, projectId, input = {}, opts = {}) {
  if (!root || !projectId || !input.scriptDoc || !input.voiceBible) {
    return { ok: false, code: "NARRATION_DIRECTION_SCHEMA_INVALID", message: "root, projectId, scriptDoc, voiceBible are required" };
  }
  const existing = listNarrationDirections(root, projectId);
  if (!existing.ok) return existing;
  if (existing.narrationDirections.length > 0) {
    const latest = latestNarrationDirection(root, projectId);
    if (!latest.ok) return latest;
    return buildAndPersist(root, projectId, input, latest.narrationDirection, { ...opts, mode: "create" });
  }
  return buildAndPersist(root, projectId, input, null, opts);
}

function reviseNarrationDirection(root, projectId, input = {}, opts = {}) {
  const current = input.baseDirectionId
    ? loadNarrationDirection(root, projectId, input.baseDirectionId)
    : latestNarrationDirection(root, projectId);
  if (!current.ok) return current;
  return buildAndPersist(root, projectId, input, current.narrationDirection, { ...opts, mode: "revise" });
}

function buildAndPersist(root, projectId, input, previous, opts) {
  const script = input.scriptDoc;
  const voiceBible = input.voiceBible;
  const directions = (input.directions || []).map((d) => ({
    segmentId: d.segmentId,
    segmentOrdinal: d.segmentOrdinal !== undefined ? d.segmentOrdinal : (script.segments.find((s) => s.segmentId === d.segmentId) || {}).ordinal,
    sourceTextHash: segmentHash((script.segments.find((s) => s.segmentId === d.segmentId) || {}).text),
    speakerId: d.speakerId || null,
    emphasis: d.emphasis || [],
    pauseIntent: d.pauseIntent || [],
    energy: d.energy || null,
    emotion: d.emotion || null,
    paceIntent: d.paceIntent || null,
    directionReason: d.directionReason || null,
  }));
  // Fail closed on unknown segmentIds before hashing.
  const scriptIds = new Set(script.segments.map((s) => s.segmentId));
  for (const d of directions) {
    if (!scriptIds.has(d.segmentId)) {
      return { ok: false, code: "NARRATION_DIRECTION_SEGMENT_NOT_FOUND", message: `${ERRORS.NARRATION_DIRECTION_SEGMENT_NOT_FOUND}: ${d.segmentId}` };
    }
  }
  const doc = {
    schemaVersion: ND_SCHEMA_VERSION,
    narrationDirectionId: null,
    version: 1,
    projectId: input.projectId || projectId,
    scriptRef: { scriptArtifactId: script.scriptArtifactId, scriptVersion: script.scriptVersion },
    voiceBibleRef: voiceBible.voiceBibleId,
    language: script.language,
    segments: directions,
    stats: computeStats(directions, script.segments.length),
    provenance: { source: input.provenance && input.provenance.source || "phase-2.2", createdAt: nowIso(opts.now), evidenceRefs: (input.provenance && input.provenance.evidenceRefs) || [] },
    fingerprint: null,
  };
  const verification = validateNarrationDirection(doc, { scriptDoc: script, voiceBible });
  const invalid = verification.segmentResults.filter((r) => r.status === "INVALID");
  if (invalid.length > 0) {
    return { ok: false, code: invalid[0].issues[0].code, message: invalid[0].issues[0].detail, segmentResults: verification.segmentResults };
  }
  const semantic = ndSemantic(doc);
  // Idempotency (§22): identical semantic content replays the existing
  // version — never a duplicate durable version, never a new history entry.
  if (previous && ndSemantic(previous) === semantic) {
    return { ok: true, narrationDirection: previous, rel: ndRel(previous.narrationDirectionId), verification, replay: true, code: "IDEMPOTENT_REPLAY" };
  }
  if ((!opts.mode || opts.mode !== "revise") && previous) {
    return { ok: false, code: "NARRATION_DIRECTION_VERSION_CONFLICT", message: "a Narration Direction already exists with different content; use reviseNarrationDirection (versions are immutable)" };
  }
  const identity = nextIdentity(previous, semantic);
  doc.version = identity.version;
  doc.narrationDirectionId = identity.narrationDirectionId;
  doc.fingerprint = fingerprintOf(doc);
  const saved = persistNdVersion(root, projectId, doc);
  if (!saved.ok) return saved;
  emitNarrEvent(root, projectId, previous ? "NARRATION_DIRECTION_REVISED" : "NARRATION_DIRECTION_CREATED", {
    correlationId: doc.narrationDirectionId,
    stateTo: "VALID",
    attributes: { version: doc.version, directedSegments: doc.stats.directedSegments, coveragePercent: doc.stats.directionCoveragePercent, overDirectionReview: doc.stats.overDirectionReview },
  }, opts);
  return { ok: true, narrationDirection: doc, rel: saved.rel, verification, replay: false };
}

/** Staleness (§21): script text/version changed → direction must fail closed. */
function checkScriptStaleness(root, projectId, ndId, scriptDoc) {
  const loaded = loadNarrationDirection(root, projectId, ndId);
  if (!loaded.ok) return loaded;
  const nd = loaded.narrationDirection;
  const mismatches = [];
  if (nd.scriptRef.scriptArtifactId !== scriptDoc.scriptArtifactId || nd.scriptRef.scriptVersion !== scriptDoc.scriptVersion) {
    mismatches.push({ segmentId: "*", code: "NARRATION_DIRECTION_SCRIPT_MISMATCH", detail: "script version changed" });
  } else {
    for (const d of nd.segments) {
      const seg = scriptDoc.segments.find((s) => s.segmentId === d.segmentId);
      if (!seg || d.sourceTextHash !== segmentHash(seg.text)) {
        mismatches.push({ segmentId: d.segmentId, code: "NARRATION_DIRECTION_SCRIPT_MISMATCH", detail: "sourceTextHash mismatch" });
      }
    }
  }
  return { ok: true, stale: mismatches.length > 0, mismatches };
}

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

function emitNarrEvent(root, projectId, eventName, fields = {}, opts = {}) {
  try {
    const r = telemetryLib.recordEvent(root, projectId, {
      eventName,
      severity: fields.severity || "INFO",
      stage: "phase-2.2",
      component: "narration-direction",
      correlationId: fields.correlationId || null,
      operationId: fields.operationId || null,
      provider: fields.provider || null,
      model: fields.model || null,
      errorCode: fields.errorCode || null,
      stateTo: fields.stateTo || null,
      attributes: fields.attributes || null,
      evidenceRefs: fields.evidenceRefs || [],
      provenance: "LIVE",
    }, opts);
    if (!r.ok && opts.strictTelemetry) return r;
    return { ok: true, emitted: r.ok === true, event: r.event || null, code: r.code || null };
  } catch (e) {
    return { ok: true, emitted: false, error: String((e && e.message) || e) };
  }
}

/** Manifest index entry: VERIFIED only when every directed segment is VALID. */
function attachManifestReference(root, projectId, ndId, ctx = {}, opts = {}) {
  const loaded = loadNarrationDirection(root, projectId, ndId);
  if (!loaded.ok) return loaded;
  const nd = loaded.narrationDirection;
  let status = "VERIFIED";
  let detail = `v${nd.version} coverage=${nd.stats.directionCoveragePercent}%`;
  if (ctx.scriptDoc && ctx.voiceBible) {
    const v = validateNarrationDirection(nd, ctx);
    if (v.stale) {
      status = "UNRESOLVED";
      detail += " STALE_SCRIPT";
    } else if (!v.allValid) {
      status = "UNRESOLVED";
      detail += " INVALID_SEGMENTS";
    }
  }
  const ref = { version: nd.narrationDirectionId, status, ref: loaded.rel, detail };
  const r = manifestLib.setArtifactVersion(root, projectId, "narrationDirectionVersion", ref, opts);
  if (!r.ok) return r;
  return { ok: true, manifestStatus: status };
}

/**
 * DAG (§18): only real dependencies —
 * FINAL_SPOKEN_SCRIPT → NARRATION_DIRECTION ← VOICE_BIBLE.
 */
function registerDagNode(root, projectId, ndId, opts = {}) {
  const loaded = loadNarrationDirection(root, projectId, ndId);
  if (!loaded.ok) return loaded;
  const existing = dagLib.loadDag(root, projectId);
  if (!existing.ok && existing.code !== "DAG_NOT_FOUND") return existing;
  if (!existing.ok) {
    const boot = dagLib.bootstrapDag(root, projectId, opts);
    if (!boot.ok) return boot;
  }
  const cur = dagLib.loadDag(root, projectId);
  if (!cur.ok) return cur;
  if (cur.dag.nodes.NARRATION_DIRECTION) {
    if (cur.dag.nodes.NARRATION_DIRECTION.versionRef !== ndId) {
      const v = dagLib.setNodeVersion(root, projectId, "NARRATION_DIRECTION", ndId, opts);
      if (!v.ok) return v;
    }
    // Re-registration of the current validated direction converges to CLEAN.
    if (dagLib.effectiveState(cur.dag, "NARRATION_DIRECTION") !== "CLEAN") {
      const s = dagLib.setNodeState(root, projectId, "NARRATION_DIRECTION", "CLEAN", opts);
      if (!s.ok) return s;
      return { ok: true, added: ["NARRATION_DIRECTION.state=CLEAN"] };
    }
    return { ok: true, added: [] };
  }
  const n = dagLib.addNode(root, projectId, {
    artifactKey: "NARRATION_DIRECTION",
    artifactType: "NARRATION_DIRECTION",
    versionRef: ndId,
    state: "CLEAN",
    producedBy: "phase-2.2:narration-direction",
    provenance: "LIVE",
    inputRefs: [
      { key: "FINAL_SPOKEN_SCRIPT", type: "SPOKEN_TEXT" },
      { key: "VOICE_BIBLE", type: "VOICE_IDENTITY" },
    ],
  }, opts);
  if (!n.ok) return n;
  return { ok: true, added: ["NARRATION_DIRECTION"] };
}

module.exports = {
  ERRORS,
  ENERGIES,
  PACES,
  PAUSE_KINDS,
  EMPHASIS_STRENGTHS,
  OVER_DIRECTION_COVERAGE_PERCENT,
  ND_DIR_REL,
  segmentHash,
  validateSchemaOnly,
  validateNarrationDirection,
  computeStats,
  createNarrationDirection,
  reviseNarrationDirection,
  loadNarrationDirection,
  listNarrationDirections,
  latestNarrationDirection,
  checkScriptStaleness,
  attachManifestReference,
  registerDagNode,
  emitNarrEvent,
};
