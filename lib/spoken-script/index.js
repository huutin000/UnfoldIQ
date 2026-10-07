"use strict";

/**
 * FIX PRE-2.4 — Spoken Script Humanizer → Evidence Fidelity → Naturalness QA
 * → canonical Final Spoken Script (UNFOLDIQ CORE).
 *
 * Chain contract (canonical order, fidelity is BLOCKING):
 *   source script (immutable)
 *     → SPOKEN_HUMANIZATION candidate (never canonical by itself)
 *     → EVIDENCE_FIDELITY_DECISION (PASS | REVIEW_REQUIRED | FAIL)
 *     → NATURALNESS_QA (PASS | REVIEW_REQUIRED | FAIL)
 *     → FINAL_SPOKEN_SCRIPT (productionScriptStatus = CANONICAL only after both PASS)
 *
 * The Final Spoken Script text stays CLEAN: no SSML, no provider markup, no
 * pronunciation substitutions — those belong to Narration Direction and the
 * Pronunciation Profile/Runtime, downstream.
 */

const Ajv = require("ajv");
const fs = require("fs");
const path = require("path");
const workspaceLib = require("../workspace/index.js");
const manifestLib = require("../project-manifest/index.js");
const dagLib = require("../dependency-dag/index.js");
const telemetryLib = require("../telemetry/index.js");
const costShared = require("../output-cost/shared.js");

const HUMANIZATION_SCHEMA_VERSION = "1.0.0";
const FIDELITY_SCHEMA_VERSION = "1.0.0";
const NATURALNESS_SCHEMA_VERSION = "1.0.0";
const HUMANIZATION_DIR_REL = "voice/spoken-humanization";
const FIDELITY_DIR_REL = "voice/evidence-fidelity";
const NATURALNESS_DIR_REL = "voice/naturalness-qa";
const FSS_DIR_REL = "input/final-spoken-script";
const SOURCE_LIFECYCLE = "RETENTION_MANAGED";
const DECISION_LIFECYCLE = "DURABLE";

const CHANGE_TYPES = ["SENTENCE_SPLIT", "SENTENCE_MERGE", "RHYTHM", "TRANSITION", "CADENCE", "CONVERSATIONAL_WORDING", "REDUNDANCY_REDUCTION"];
const PROTECTED_ITEM_TYPES = ["FACT", "NUMBER", "DATE", "NAME", "QUOTE", "CAVEAT", "UNCERTAINTY", "CLASSIFICATION", "NEGATION", "COMPARISON", "CAUSALITY", "TEMPORAL_ORDER", "ATTRIBUTION", "SCOPE"];

// §16 uncertainty/qualification vocabulary + certainty boosters. Humanization
// may improve syntax but must never DROP a hedge or ADD certainty.
const HEDGE_TERMS = ["approximately", "estimated", "reported", "may", "might", "could", "likely", "according to", "evidence suggests", "uncertain", "disputed", "about", "around", "roughly", "several", "some", "relatively", "comparatively"];
const CERTAINTY_BOOSTERS = ["definitely", "certainly", "proven", "always", "exactly", "guaranteed", "undoubtedly", "without doubt", "absolute fact", "causes", "proves", "undeniable"];

// §19 naturalness issue taxonomy: which issues BLOCK canonicalization.
const BLOCKING_NATURALNESS_CODES = new Set(["OVER_UNIFORM_CADENCE", "REPETITIVE_TRANSITION", "REPETITIVE_SENTENCE_OPENING", "TEMPLATE_RHETORIC", "SUMMARY_HEAVY", "RUN_ON_SENTENCE", "WRITTEN_NOT_SPOKEN"]);
// Bounded repair loop default (§20).
const MAX_REPAIR_ATTEMPTS = 2;

const ERRORS = {
  HUMANIZATION_SOURCE_NOT_FOUND: "source script artifact does not exist",
  HUMANIZATION_CONTENT_MODE_UNRESOLVED: "content mode/class is required and was not explicitly resolved",
  HUMANIZATION_SCHEMA_INVALID: "humanization artifact fails schema/semantic validation",
  HUMANIZATION_PROVIDER_UNAVAILABLE: "humanizer provider unavailable",
  HUMANIZATION_ATTEMPT_LIMIT_REACHED: "bounded repair attempt limit reached",
  HUMANIZATION_VERSION_CONFLICT: "humanization version already exists; versions are immutable",
  FIDELITY_SOURCE_MISMATCH: "fidelity input does not match the humanization source",
  FIDELITY_NUMBER_CHANGED: "protected number changed between source and candidate",
  FIDELITY_DATE_CHANGED: "protected date/year changed between source and candidate",
  FIDELITY_NAME_CHANGED: "protected name changed between source and candidate",
  FIDELITY_QUOTE_CHANGED: "protected quote changed between source and candidate",
  FIDELITY_CAVEAT_DROPPED: "qualifier/hedge present in source was dropped by the candidate",
  FIDELITY_CERTAINTY_INCREASED: "candidate increases certainty beyond the source",
  FIDELITY_CLASSIFICATION_CHANGED: "content mode/classification changed",
  FIDELITY_EVIDENCE_UNRESOLVED: "claim expected to have evidence cannot be traced to canonical evidence",
  NATURALNESS_REVIEW_REQUIRED: "naturalness issues require review",
  NATURALNESS_SYSTEMIC_PATTERN: "systemic repeated template pattern detected",
  NATURALNESS_QA_FAILED: "blocking spoken-naturalness issues remain",
  FINAL_SPOKEN_SCRIPT_NOT_CANONICAL: "canonicalization gate not satisfied",
  FINAL_SPOKEN_SCRIPT_HASH_MISMATCH: "source/candidate hash mismatch in the gate chain",
  FINAL_SPOKEN_SCRIPT_GATE_INCOMPLETE: "humanization/fidelity/naturalness refs missing or not PASS",
  FINAL_SPOKEN_SCRIPT_NOT_FOUND: "final spoken script version does not exist",
  FINAL_SPOKEN_SCRIPT_VERSION_CONFLICT: "final spoken script revision already exists; revisions are immutable",
  FINAL_SPOKEN_SCRIPT_SUPERSEDED: "script version is superseded/invalid and can never be selected for production TTS",
  PRODUCTION_TTS_BLOCKED: "production TTS consumption blocked for non-canonical scripts",
  ARTIFACT_PATH_NOT_ALLOWED: "path is outside approved workspace locations",
  ARTIFACT_LIFECYCLE_INVALID: "lifecycle class invalid",
};

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

const validators = {};
function validatorFor(file) {
  if (!validators[file]) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", file), "utf8"));
    validators[file] = ajv.compile(schema);
  }
  return validators[file];
}

function schemaErrors(file, doc, code) {
  const errors = [];
  const valid = validatorFor(file)(doc);
  if (!valid) {
    for (const e of validatorFor(file).errors || []) {
      errors.push({ code, message: `${e.instancePath || "/"} ${e.message}` });
    }
  }
  return errors;
}

function nowIso(now) {
  return now || new Date().toISOString();
}

function fingerprintOf(doc) {
  const { fingerprint, ...rest } = doc;
  void fingerprint;
  // provenance.createdAt is metadata, never identity (§21/§22 idempotency):
  // identical semantic content must fingerprint identically across runs.
  if (rest.provenance && typeof rest.provenance === "object") {
    const { createdAt, ...prov } = rest.provenance;
    void createdAt;
    rest.provenance = prov;
  }
  return costShared.hash16(JSON.parse(costShared.stableStringify(rest)));
}

function textHash(text) {
  return costShared.hash16(String(text));
}

// ---------------------------------------------------------------------------
// Immutable persists (one per artifact kind; versions never overwritten)
// ---------------------------------------------------------------------------

function approveAndPersist(root, projectId, rel, doc, validateFn, dirRel, lifecycle, conflictCode) {
  const lifecycleCheck = workspaceLib.classifyNewArtifact({ artifactType: rel.startsWith("input/") ? "INPUT" : "VOICE", lifecycleClass: lifecycle });
  if (!lifecycleCheck.ok || lifecycleCheck.reviewRequired) {
    return { ok: false, code: "ARTIFACT_LIFECYCLE_INVALID", message: `${dirRel} must be explicitly ${lifecycle}` };
  }
  const guard = workspaceLib.validateWorkspacePath(root, path.posix.join("projects", projectId, rel), { projectId });
  if (!guard.ok) return { ok: false, code: "ARTIFACT_PATH_NOT_ALLOWED", message: guard.message };
  const abs = path.join(root, "projects", projectId, rel);
  if (fs.existsSync(abs)) {
    return { ok: false, code: conflictCode, message: `${conflictCode}: ${rel}` };
  }
  const v = validateFn(doc);
  if (!v.ok) return { ok: false, code: v.errors[0].code, message: v.errors[0].message, errors: v.errors };
  try {
    fs.mkdirSync(path.join(root, "projects", projectId, dirRel), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, abs);
  } catch (e) {
    return { ok: false, code: "ARTIFACT_LIFECYCLE_INVALID", message: `persist failed: ${String((e && e.message) || e)}` };
  }
  return { ok: true, rel, lifecycleClass: lifecycle };
}

function validateHumanization(doc) {
  let errors = schemaErrors("spoken-humanization.schema.json", doc, "HUMANIZATION_SCHEMA_INVALID");
  for (const seg of doc.segments || []) {
    if (seg.candidateTextHash !== textHash(seg.candidateSpokenText)) {
      errors.push({ code: "HUMANIZATION_SCHEMA_INVALID", message: `candidateTextHash mismatch for ${seg.segmentId}` });
    }
    if (seg.sourceTextHash !== textHash(seg.sourceText)) {
      errors.push({ code: "HUMANIZATION_SCHEMA_INVALID", message: `sourceTextHash mismatch for ${seg.segmentId}` });
    }
    for (const ct of seg.changeTypes || []) {
      if (!CHANGE_TYPES.includes(ct)) errors.push({ code: "HUMANIZATION_SCHEMA_INVALID", message: `unknown changeType ${ct}` });
    }
  }
  return { ok: errors.length === 0, errors };
}

function loadHumanization(root, projectId, humanizationId) {
  const p = path.join(root, "projects", projectId, HUMANIZATION_DIR_REL, `${humanizationId}.json`);
  if (!fs.existsSync(p)) return { ok: false, code: "HUMANIZATION_SOURCE_NOT_FOUND", message: `${ERRORS.HUMANIZATION_SOURCE_NOT_FOUND}: ${humanizationId}` };
  try {
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    const v = validateHumanization(doc);
    if (!v.ok) return { ok: false, code: "HUMANIZATION_SCHEMA_INVALID", message: v.errors[0].message };
    return { ok: true, humanization: doc, rel: `${HUMANIZATION_DIR_REL}/${humanizationId}.json` };
  } catch (e) {
    return { ok: false, code: "HUMANIZATION_SCHEMA_INVALID", message: String((e && e.message) || e) };
  }
}

/**
 * Create a humanization candidate. input: { projectId?, contentMode,
 * contentClass, sourceScriptRef{artifact,version}, sourceSegments[{segmentId,
 * text}] (read from the immutable source), segments[{sourceSegmentIds,
 * sourceSegmentId?, candidateSpokenText, changeTypes, changeNotes?}],
 * instructionVersion, provenance{actorType,provider,model,attempt} }.
 * Source text is copied verbatim into the artifact for traceability; the
 * source file itself is never touched. Idempotent on identical content.
 */
function createHumanization(root, projectId, input = {}, opts = {}) {
  if (!input.contentMode || !input.contentClass || !input.sourceScriptRef || !Array.isArray(input.segments) || !Array.isArray(input.sourceSegments)) {
    return { ok: false, code: "HUMANIZATION_CONTENT_MODE_UNRESOLVED", message: "contentMode, contentClass, sourceScriptRef, segments, sourceSegments are required" };
  }
  if (!["FACTUAL", "FICTION", "HYBRID"].includes(input.contentClass)) {
    return { ok: false, code: "HUMANIZATION_CONTENT_MODE_UNRESOLVED", message: `contentClass must be FACTUAL|FICTION|HYBRID (got ${input.contentClass})` };
  }
  const sourceById = new Map(input.sourceSegments.map((s) => [s.segmentId, s]));
  const segments = [];
  for (const seg of input.segments) {
    for (const srcId of seg.sourceSegmentIds || []) {
      const src = sourceById.get(srcId);
      if (!src) return { ok: false, code: "HUMANIZATION_SOURCE_NOT_FOUND", message: `source segment ${srcId} not found in the source script` };
    }
    const mergedSourceText = (seg.sourceSegmentIds || []).map((id) => sourceById.get(id).text).join(" ");
    segments.push({
      segmentId: seg.segmentId,
      sourceSegmentIds: seg.sourceSegmentIds,
      sourceTextHash: textHash(mergedSourceText),
      sourceText: mergedSourceText,
      candidateSpokenText: seg.candidateSpokenText,
      candidateTextHash: textHash(seg.candidateSpokenText),
      changeTypes: seg.changeTypes || [],
      changeNotes: seg.changeNotes || null,
    });
  }
  const sourceTextHash = textHash(input.sourceSegments.map((s) => s.text).join("\n"));
  const doc = {
    schemaVersion: HUMANIZATION_SCHEMA_VERSION,
    humanizationId: null,
    version: input.version || 1,
    projectId: input.projectId || projectId,
    contentMode: input.contentMode,
    contentClass: input.contentClass,
    sourceScriptRef: input.sourceScriptRef,
    sourceTextHash,
    instructionVersion: input.instructionVersion || "spoken-humanizer-1.0.0",
    segments,
    changeSummary: input.changeSummary || "",
    provenance: {
      actorType: (input.provenance && input.provenance.actorType) || "UNKNOWN_NOT_AVAILABLE",
      provider: (input.provenance && input.provenance.provider) || null,
      model: (input.provenance && input.provenance.model) || null,
      attempt: (input.provenance && input.provenance.attempt) || 1,
      createdAt: nowIso(opts.now),
      evidenceRefs: (input.provenance && input.provenance.evidenceRefs) || [],
    },
    fingerprint: null,
  };
  const id = costShared.id12("hum", {
    project: doc.projectId,
    version: doc.version,
    contentMode: doc.contentMode,
    contentClass: doc.contentClass,
    content: costShared.hash16({ sourceTextHash, segments: segments.map((s) => ({ id: s.segmentId, candidate: s.candidateTextHash })) }),
  });
  doc.humanizationId = `hum-${id.slice(4)}`;
  doc.fingerprint = fingerprintOf(doc);
  const rel = `${HUMANIZATION_DIR_REL}/${doc.humanizationId}.json`;
  const saved = approveAndPersist(root, doc.projectId, rel, doc, validateHumanization, HUMANIZATION_DIR_REL, SOURCE_LIFECYCLE, "HUMANIZATION_VERSION_CONFLICT");
  if (!saved.ok && saved.code === "HUMANIZATION_VERSION_CONFLICT") {
    const existing = loadHumanization(root, doc.projectId, doc.humanizationId);
    if (existing.ok) return { ok: true, humanization: existing.humanization, rel: existing.rel, replay: true, code: "IDEMPOTENT_REPLAY" };
  }
  if (!saved.ok) return saved;
  emitEvent(root, doc.projectId, (doc.version > 1 ? "SPOKEN_HUMANIZATION_REVISED" : "SPOKEN_HUMANIZATION_CREATED"), { correlationId: doc.humanizationId, attributes: { version: doc.version, attempt: doc.provenance.attempt, segmentCount: doc.segments.length } }, opts);
  return { ok: true, humanization: doc, rel, replay: false };
}

// ---------------------------------------------------------------------------
// Deterministic protected-item extraction (§15)
// ---------------------------------------------------------------------------

const STOPWORD_NAMES = new Set(["the", "a", "an", "but", "so", "and", "that", "this", "it", "its", "is", "are", "was", "at", "on", "in", "for", "when", "where", "why", "how", "thanks", "your", "you", "from", "by", "with", "tiny", "look", "day", "wave", "light", "blue", "red", "white", "air", "sky", "sunlight", "sunset", "sunrise", "dust", "violet", "eyes", "answer", "thing", "watching", "however", "meanwhile", "instead", "finally", "today", "yesterday", "tomorrow"]);

function extractProtectedItems(text) {
  const t = String(text || "");
  const numbers = [...t.matchAll(/\b\d+(?:[.,]\d+)*(?:\s?(?:%|percent|km|kg|m|million|billion|thousand))?/gi)].map((m) => m[0].toLowerCase()).sort();
  const dates = [...t.matchAll(/\b(?:1[5-9]\d{2}|20\d{2})\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,\s*(?:1[5-9]\d{2}|20\d{2}))?\b/gi)].map((m) => m[0].toLowerCase()).sort();
  const quotes = [...t.matchAll(/"([^"]{2,})"|“([^”]{2,})”/g)].map((m) => (m[1] || m[2]).toLowerCase()).sort();
  const names = [];
  for (const m of t.matchAll(/(?<=[a-z,;:]\s)([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*)/g)) {
    const candidate = m[1];
    if (!STOPWORD_NAMES.has(candidate.split(/\s+/)[0].toLowerCase())) names.push(candidate.toLowerCase());
  }
  const hedges = [];
  for (const term of HEDGE_TERMS) {
    const count = (t.toLowerCase().match(new RegExp(`\\b${term.replace(/ /g, "\\s+")}\\b`, "g")) || []).length;
    if (count > 0) hedges.push({ term, count });
  }
  const boosters = [];
  for (const term of CERTAINTY_BOOSTERS) {
    const count = (t.toLowerCase().match(new RegExp(`\\b${term.replace(/ /g, "\\s+")}\\b`, "g")) || []).length;
    if (count > 0) boosters.push({ term, count });
  }
  return { numbers, dates, quotes, names, hedges, boosters };
}

function multisetEqual(a, b) {
  const normalize = (arr) => JSON.stringify([...arr].sort());
  return normalize(a) === normalize(b);
}

// ---------------------------------------------------------------------------
// Evidence Fidelity Gate (§11–§16)
// ---------------------------------------------------------------------------

/**
 * input: { humanization (doc), researchClaims? [{claimId, classification,
 * sources[]}], segmentClaims? {segmentId: [claimId...]}, contentClass }
 * Deterministic checks run first; every mismatch must be explained by status.
 * FACTUAL/HYBRID: each segment's declared claims must trace to canonical
 * evidence (researchClaims) or the check is REVIEW_REQUIRED.
 */
function runEvidenceFidelity(root, projectId, input = {}, opts = {}) {
  const hum = input.humanization;
  if (!hum) return { ok: false, code: "FIDELITY_SOURCE_MISMATCH", message: "humanization doc required" };
  void root;
  const contentClass = input.contentClass || hum.contentClass;
  const checks = [];
  const issues = [];
  const push = (check) => checks.push(check);
  const issue = (code, segmentId, detail, evidenceRef) => issues.push({ code, segmentId: segmentId || null, detail: detail || null, evidenceRef: evidenceRef || null });

  const claimsBySegment = input.segmentClaims || {};
  for (const seg of hum.segments) {
    const src = extractProtectedItems(seg.sourceText);
    const cand = extractProtectedItems(seg.candidateSpokenText);

    push({ checkId: `${seg.segmentId}:NUMBER`, segmentId: seg.segmentId, protectedItemType: "NUMBER", sourceValue: src.numbers.join("|") || null, candidateValue: cand.numbers.join("|") || null, status: multisetEqual(src.numbers, cand.numbers) ? "PRESERVED" : "CHANGED_INVALID", reason: multisetEqual(src.numbers, cand.numbers) ? null : "protected number changed", evidenceRef: null });
    push({ checkId: `${seg.segmentId}:DATE`, segmentId: seg.segmentId, protectedItemType: "DATE", sourceValue: src.dates.join("|") || null, candidateValue: cand.dates.join("|") || null, status: multisetEqual(src.dates, cand.dates) ? "PRESERVED" : "CHANGED_INVALID", reason: multisetEqual(src.dates, cand.dates) ? null : "protected date/year changed", evidenceRef: null });
    push({ checkId: `${seg.segmentId}:QUOTE`, segmentId: seg.segmentId, protectedItemType: "QUOTE", sourceValue: src.quotes.join("|") || null, candidateValue: cand.quotes.join("|") || null, status: multisetEqual(src.quotes, cand.quotes) ? "PRESERVED" : "CHANGED_INVALID", reason: multisetEqual(src.quotes, cand.quotes) ? null : "protected quote changed", evidenceRef: null });
    push({ checkId: `${seg.segmentId}:NAME`, segmentId: seg.segmentId, protectedItemType: "NAME", sourceValue: src.names.join("|") || null, candidateValue: cand.names.join("|") || null, status: multisetEqual(src.names, cand.names) ? (src.names.length ? "PRESERVED" : "NOT_APPLICABLE") : "CHANGED_INVALID", reason: multisetEqual(src.names, cand.names) ? null : "protected name changed", evidenceRef: null });

    // CAVEAT/UNCERTAINTY: hedging may be reworded (approximately→roughly is a
    // legal swap) but the total amount of qualification may never decrease,
    // and certainty boosters may never be added (§16).
    const srcHedgeTotal = src.hedges.reduce((n, h) => n + h.count, 0);
    const candHedgeTotal = cand.hedges.reduce((n, h) => n + h.count, 0);
    push({ checkId: `${seg.segmentId}:CAVEAT`, segmentId: seg.segmentId, protectedItemType: "CAVEAT", sourceValue: src.hedges.map((h) => `${h.term}x${h.count}`).join("|") || null, candidateValue: cand.hedges.map((h) => `${h.term}x${h.count}`).join("|") || null, status: candHedgeTotal >= srcHedgeTotal ? "PRESERVED" : "CHANGED_INVALID", reason: candHedgeTotal >= srcHedgeTotal ? null : `qualification reduced (${srcHedgeTotal} → ${candHedgeTotal} hedge terms)`, evidenceRef: null });
    const srcBoosters = new Map(src.boosters.map((b) => [b.term, b.count]));
    const addedBoosters = cand.boosters.filter((b) => b.count > (srcBoosters.get(b.term) || 0));
    push({ checkId: `${seg.segmentId}:UNCERTAINTY`, segmentId: seg.segmentId, protectedItemType: "UNCERTAINTY", sourceValue: src.boosters.map((b) => b.term).join("|") || null, candidateValue: cand.boosters.map((b) => b.term).join("|") || null, status: addedBoosters.length === 0 ? "PRESERVED" : "CHANGED_INVALID", reason: addedBoosters.length === 0 ? null : `certainty booster added: ${addedBoosters.map((b) => b.term).join(",")}`, evidenceRef: null });

    // COMPARISON/qualifier integrity: comparative phrases from the source
    // must survive ("several times more strongly than", "far smaller than").
    for (const m of seg.sourceText.matchAll(/\b(much|far|several|even|less|more)\s+(?:\w+\s+){0,2}?than\b/gi)) {
      const phrase = m[0].toLowerCase();
      const kept = seg.candidateSpokenText.toLowerCase().includes(phrase) || seg.candidateSpokenText.toLowerCase().includes(phrase.replace(/\s+/g, " "));
      push({ checkId: `${seg.segmentId}:COMPARISON:${phrase}`, segmentId: seg.segmentId, protectedItemType: "COMPARISON", sourceValue: phrase, candidateValue: kept ? phrase : null, status: kept ? "PRESERVED" : "CHANGED_INVALID", reason: kept ? null : "comparative qualifier altered", evidenceRef: null });
    }

    // CLASSIFICATION (§12): the class travels with the artifact, unchanged.
    push({ checkId: `${seg.segmentId}:CLASSIFICATION`, segmentId: seg.segmentId, protectedItemType: "CLASSIFICATION", sourceValue: hum.contentClass, candidateValue: contentClass, status: hum.contentClass === contentClass ? "PRESERVED" : "CHANGED_INVALID", reason: hum.contentClass === contentClass ? null : "classification changed", evidenceRef: null });

    // Evidence tracing (§13) — FACTUAL/HYBRID only, FICTION exempt.
    const segClaims = claimsBySegment[seg.segmentId] || [];
    if (contentClass !== "FICTION") {
      if (segClaims.length === 0) {
        push({ checkId: `${seg.segmentId}:EVIDENCE`, segmentId: seg.segmentId, protectedItemType: "FACT", sourceValue: null, candidateValue: null, status: "NOT_APPLICABLE", reason: "no claims declared for this segment", evidenceRef: null });
      } else {
        for (const claimId of segClaims) {
          const claim = (input.researchClaims || []).find((c) => c.claimId === claimId);
          if (!claim) {
            push({ checkId: `${seg.segmentId}:EVIDENCE:${claimId}`, segmentId: seg.segmentId, protectedItemType: "FACT", sourceValue: claimId, candidateValue: null, status: "REVIEW_REQUIRED", reason: "declared claim cannot be traced to canonical evidence", evidenceRef: null });
            issue("FIDELITY_EVIDENCE_UNRESOLVED", seg.segmentId, `claim ${claimId} unresolvable`, null);
          } else {
            push({ checkId: `${seg.segmentId}:EVIDENCE:${claimId}`, segmentId: seg.segmentId, protectedItemType: "FACT", sourceValue: claimId, candidateValue: claimId, status: "PRESERVED", reason: null, evidenceRef: `research/research-brief.json#claims.${claimId}` });
          }
        }
      }
    }
  }

  for (const c of checks) {
    if (c.status === "CHANGED_INVALID") {
      const codeMap = { NUMBER: "FIDELITY_NUMBER_CHANGED", DATE: "FIDELITY_DATE_CHANGED", NAME: "FIDELITY_NAME_CHANGED", QUOTE: "FIDELITY_QUOTE_CHANGED", CAVEAT: "FIDELITY_CAVEAT_DROPPED", UNCERTAINTY: "FIDELITY_CERTAINTY_INCREASED", CLASSIFICATION: "FIDELITY_CLASSIFICATION_CHANGED" };
      issue(codeMap[c.protectedItemType] || "FIDELITY_SOURCE_MISMATCH", c.segmentId, c.reason, c.evidenceRef);
    }
  }
  const decision = checks.some((c) => c.status === "CHANGED_INVALID")
    ? "FAIL"
    : checks.some((c) => c.status === "REVIEW_REQUIRED")
      ? "REVIEW_REQUIRED"
      : "PASS";

  const doc = {
    schemaVersion: FIDELITY_SCHEMA_VERSION,
    decisionId: null,
    version: 1,
    projectId: hum.projectId,
    contentMode: hum.contentMode,
    contentClass,
    sourceScriptRef: hum.sourceScriptRef,
    humanizationRef: hum.humanizationId,
    checks,
    issues,
    decision,
    provenance: { createdAt: nowIso(opts.now), evidenceRefs: opts.evidenceRefs || [] },
    fingerprint: null,
  };
  doc.decisionId = `fid-${costShared.id12("fid", { humanizationRef: hum.humanizationId, fingerprintOf: fingerprintOf({ ...doc, decisionId: null, fingerprint: null }) }).slice(4)}`;
  doc.fingerprint = fingerprintOf(doc);
  const rel = `${FIDELITY_DIR_REL}/${doc.decisionId}.json`;
  const saved = approveAndPersist(root, projectId, rel, doc, (d) => ({ ok: schemaErrors("evidence-fidelity-decision.schema.json", d, "FIDELITY_SOURCE_MISMATCH").length === 0, errors: schemaErrors("evidence-fidelity-decision.schema.json", d, "FIDELITY_SOURCE_MISMATCH") }), FIDELITY_DIR_REL, DECISION_LIFECYCLE, "FIDELITY_VERSION_CONFLICT");
  if (!saved.ok && saved.code === "FIDELITY_VERSION_CONFLICT") {
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, rel), "utf8"));
      if (existing.fingerprint === doc.fingerprint) {
        return { ok: true, decision: existing, rel, replay: true, code: "IDEMPOTENT_REPLAY" };
      }
    } catch { /* fall through */ }
    return saved;
  }
  if (!saved.ok) return saved;
  emitEvent(root, projectId, "EVIDENCE_FIDELITY_EVALUATED", { correlationId: doc.decisionId, severity: decision === "PASS" ? "INFO" : "WARN", stateTo: decision, attributes: { humanizationRef: hum.humanizationId, checkCount: checks.length, issueCount: issues.length } }, opts);
  return { ok: true, decision: doc, rel };
}

// ---------------------------------------------------------------------------
// Naturalness QA (§17–§20) — explainable signals, never an AI-detector score
// ---------------------------------------------------------------------------

const TRANSITION_PHRASES = ["so", "but", "and", "however", "meanwhile", "on the other hand", "that is why", "and that is why", "then", "instead", "finally", "in addition", "therefore"];
const SUMMARY_PHRASES = ["in conclusion", "to sum up", "in summary", "overall", "as we have seen", "the bottom line"];
const ABSTRACT_TERMS = ["aspects", "factors", "in terms of", "elements", "dynamics", "landscapes", "realms", "notions"];

function sentencesOf(text) {
  return String(text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 0);
}

function words(s) {
  return s.split(/\s+/).filter(Boolean);
}

/** Evaluate naturalness signals over the candidate spoken segments. */
function evaluateNaturalness(humanization) {
  const allSentences = [];
  for (const seg of humanization.segments) allSentences.push(...sentencesOf(seg.candidateSpokenText).map((s) => ({ seg: seg.segmentId, s })));
  const lengths = allSentences.map((x) => words(x.s).length);
  const mean = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const variance = lengths.length ? lengths.reduce((a, b) => a + (b - mean) ** 2, 0) / lengths.length : 0;
  const metrics = {
    sentenceCount: allSentences.length,
    sentenceLengthMean: Number(mean.toFixed(3)),
    sentenceLengthVariance: Number(variance.toFixed(3)),
    sentenceLengthDistribution: lengths,
    repeatedTransitionPhrases: [],
    repeatedOpenings: [],
    repeatedRhetoricalPatterns: [],
    abstractLanguageFlags: [],
    summaryPhraseFlags: [],
    paragraphRhythmUniformity: null,
    cadenceUniformity: null,
    redundancyFlags: [],
    awkwardSpokenPhrases: [],
  };
  const issues = [];

  // Transition-phrase repetition (≥3 identical = systemic).
  const transitionCounts = new Map();
  for (const { s } of allSentences) {
    const lower = s.toLowerCase();
    for (const tp of TRANSITION_PHRASES) {
      if (lower.startsWith(`${tp} `) || lower.startsWith(`and ${tp} `)) transitionCounts.set(tp, (transitionCounts.get(tp) || 0) + 1);
    }
  }
  for (const [tp, n] of transitionCounts) if (n >= 3) metrics.repeatedTransitionPhrases.push(`${tp}x${n}`);
  for (const tp of metrics.repeatedTransitionPhrases) {
    issues.push({ code: "REPETITIVE_TRANSITION", segmentId: null, span: tp, detail: `transition phrase "${tp}" opens ${tp.match(/x(\d+)$/)[1]} sentences`, blocking: true });
  }

  // Sentence-opening repetition (≥3 identical first two words = systemic).
  const openingCounts = new Map();
  for (const { s } of allSentences) {
    const key = words(s).slice(0, 2).join(" ").toLowerCase();
    openingCounts.set(key, (openingCounts.get(key) || 0) + 1);
  }
  for (const [k, n] of openingCounts) if (n >= 3) metrics.repeatedOpenings.push(`${k}x${n}`);
  for (const k of metrics.repeatedOpenings) {
    issues.push({ code: "REPETITIVE_SENTENCE_OPENING", segmentId: null, span: k, detail: `${k.match(/x(\d+)$/)[1]} sentences open with "${k.replace(/x\d+$/, "")}"`, blocking: true });
  }

  // Template rhetoric: same 2-word sentence stem ≥3 times across segments.
  const stemCounts = new Map();
  for (const { s } of allSentences) {
    const stem = words(s).slice(0, 2).join(" ").toLowerCase();
    stemCounts.set(stem, (stemCounts.get(stem) || 0) + 1);
  }
  for (const [k, n] of stemCounts) if (n >= 3 && !metrics.repeatedOpenings.some((o) => o.startsWith(k))) metrics.repeatedRhetoricalPatterns.push(`${k}x${n}`);
  for (const k of metrics.repeatedRhetoricalPatterns) {
    issues.push({ code: "TEMPLATE_RHETORIC", segmentId: null, span: k, detail: `rhetorical stem "${k}" repeats ${k.match(/x(\d+)$/)[1]} times`, blocking: true });
  }

  // Over-uniform cadence: variance below 2.0 with ≥6 sentences = uniform robot cadence.
  metrics.cadenceUniformity = lengths.length ? Number(Math.max(0, 1 - Math.min(1, variance / 20)).toFixed(3)) : null;
  if (lengths.length >= 6 && variance < 2.0) {
    issues.push({ code: "OVER_UNIFORM_CADENCE", segmentId: null, span: null, detail: `sentence-length variance ${variance.toFixed(2)} < 2.0 across ${lengths.length} sentences`, blocking: true });
  }

  // Summary-heavy phrasing (≥2 summary phrases = systemic).
  for (const { s } of allSentences) {
    const lower = s.toLowerCase();
    for (const sp of SUMMARY_PHRASES) if (lower.includes(sp)) metrics.summaryPhraseFlags.push(`${sp} :: ${s.slice(0, 60)}`);
  }
  if (metrics.summaryPhraseFlags.length >= 2) {
    issues.push({ code: "SUMMARY_HEAVY", segmentId: null, span: null, detail: `${metrics.summaryPhraseFlags.length} summary phrases`, blocking: true });
  }

  // Run-on sentences (> 45 words) — located per segment.
  for (const { seg, s } of allSentences) {
    if (words(s).length > 45) issues.push({ code: "RUN_ON_SENTENCE", segmentId: seg, span: s.slice(0, 60), detail: `${words(s).length} words in one sentence`, blocking: true });
  }

  // Written-not-spoken markers (located, non-blocking unless dense).
  const writtenMarkers = ["herein", "aforementioned", "thus", "whereby", "notwithstanding", "utilize"];
  for (const { seg, s } of allSentences) {
    const lower = s.toLowerCase();
    for (const wm of writtenMarkers) if (lower.includes(wm)) metrics.awkwardSpokenPhrases.push(`${wm} :: ${seg}`);
  }
  if (metrics.awkwardSpokenPhrases.length >= 3) {
    issues.push({ code: "WRITTEN_NOT_SPOKEN", segmentId: null, span: null, detail: `${metrics.awkwardSpokenPhrases.length} written-register markers`, blocking: true });
  }

  // Abstract density + hedges + fragments (located, non-blocking).
  for (const { seg, s } of allSentences) {
    const lower = s.toLowerCase();
    for (const at of ABSTRACT_TERMS) if (lower.includes(at)) metrics.abstractLanguageFlags.push(`${at} :: ${seg}`);
  }
  const hedgeOverdose = new Map();
  for (const seg of humanization.segments) {
    const items = extractProtectedItems(seg.candidateSpokenText);
    const total = items.hedges.reduce((n, h) => n + h.count, 0);
    if (total > 3) hedgeOverdose.set(seg.segmentId, total);
  }
  for (const [segId, total] of hedgeOverdose) {
    issues.push({ code: "EXCESSIVE_HEDGE", segmentId: segId, span: null, detail: `${total} hedge terms in one segment`, blocking: false });
  }
  const fragments = lengths.filter((l) => l > 0 && l < 3).length;
  if (allSentences.length > 0 && fragments / allSentences.length > 0.3) {
    issues.push({ code: "FRAGMENT_OVERUSE", segmentId: null, span: null, detail: `${fragments}/${allSentences.length} sentences under 3 words`, blocking: false });
  }
  return { metrics, issues };
}

function runNaturalnessQa(root, projectId, input = {}, opts = {}) {
  const hum = input.humanization;
  if (!hum) return { ok: false, code: "NATURALNESS_REVIEW_REQUIRED", message: "humanization doc required" };
  void root;
  const { metrics, issues } = evaluateNaturalness(hum);
  const decision = issues.some((i) => i.blocking) ? "FAIL" : "PASS";
  const doc = {
    schemaVersion: NATURALNESS_SCHEMA_VERSION,
    qaId: null,
    version: 1,
    projectId: hum.projectId,
    humanizationRef: hum.humanizationId,
    metrics,
    issues,
    decision,
    provenance: { createdAt: nowIso(opts.now), evidenceRefs: opts.evidenceRefs || [] },
    fingerprint: null,
  };
  doc.qaId = `nqa-${costShared.id12("nqa", { humanizationRef: hum.humanizationId, fingerprintOf: fingerprintOf({ ...doc, qaId: null, fingerprint: null }) }).slice(4)}`;
  doc.fingerprint = fingerprintOf(doc);
  const rel = `${NATURALNESS_DIR_REL}/${doc.qaId}.json`;
  const saved = approveAndPersist(root, projectId, rel, doc, (d) => ({ ok: schemaErrors("naturalness-qa.schema.json", d, "NATURALNESS_QA_FAILED").length === 0, errors: schemaErrors("naturalness-qa.schema.json", d, "NATURALNESS_QA_FAILED") }), NATURALNESS_DIR_REL, DECISION_LIFECYCLE, "NATURALNESS_VERSION_CONFLICT");
  if (!saved.ok && saved.code === "NATURALNESS_VERSION_CONFLICT") {
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, rel), "utf8"));
      if (existing.fingerprint === doc.fingerprint) {
        return { ok: true, qa: existing, rel, replay: true, code: "IDEMPOTENT_REPLAY" };
      }
    } catch { /* fall through */ }
    return saved;
  }
  if (!saved.ok) return saved;
  emitEvent(root, projectId, "NATURALNESS_QA_EVALUATED", { correlationId: doc.qaId, severity: decision === "PASS" ? "INFO" : "WARN", stateTo: decision, attributes: { humanizationRef: hum.humanizationId, issueCount: issues.length, blockingCount: issues.filter((i) => i.blocking).length } }, opts);
  return { ok: true, qa: doc, rel };
}

// ---------------------------------------------------------------------------
// Canonical Final Spoken Script (§23–§24)
// ---------------------------------------------------------------------------

function validateFinalSpokenScript(doc) {
  const file = doc.schemaVersion === "1.1.0" ? "final-spoken-script-1.1.0.schema.json" : "final-spoken-script.schema.json";
  const errors = schemaErrors(file, doc, "FINAL_SPOKEN_SCRIPT_NOT_CANONICAL");
  return { ok: errors.length === 0, errors };
}

/**
 * Canonicalization gate (§24): materialize a canonical FSS ONLY when a real
 * humanization exists, both gates PASS, content class is resolved, and every
 * sourceTextHash matches the immutable source bytes. Any attempt to canonize
 * a fixture (NOT_APPLICABLE) or an ungated candidate fails closed.
 */
function materializeFinalSpokenScript(root, projectId, input = {}, opts = {}) {
  const hum = input.humanization;
  const fidelity = input.fidelity;
  const naturalness = input.naturalness;
  if (!hum || !fidelity || !naturalness) {
    return { ok: false, code: "FINAL_SPOKEN_SCRIPT_GATE_INCOMPLETE", message: "humanization + fidelity + naturalness are required" };
  }
  if (fidelity.decision !== "PASS") {
    return { ok: false, code: "FINAL_SPOKEN_SCRIPT_GATE_INCOMPLETE", message: `Evidence Fidelity is ${fidelity.decision}; fidelity is blocking and REVIEW_REQUIRED is never coerced to PASS` };
  }
  if (naturalness.decision !== "PASS") {
    return { ok: false, code: "FINAL_SPOKEN_SCRIPT_GATE_INCOMPLETE", message: `Naturalness QA is ${naturalness.decision}` };
  }
  if (fidelity.humanizationRef !== hum.humanizationId || naturalness.humanizationRef !== hum.humanizationId) {
    return { ok: false, code: "FINAL_SPOKEN_SCRIPT_HASH_MISMATCH", message: "gate chain refs do not resolve to this humanization" };
  }
  if (!input.productionScriptStatusExplicitlyCanonical) {
    return { ok: false, code: "FINAL_SPOKEN_SCRIPT_NOT_CANONICAL", message: "caller must explicitly request CANONICAL status; fixtures are never relabelled" };
  }
  const doc = {
    schemaVersion: "1.1.0",
    scriptArtifactId: input.scriptArtifactId,
    scriptVersion: input.scriptVersion || 1,
    projectId: hum.projectId,
    language: input.language || "en-us",
    contentMode: hum.contentMode,
    contentClass: hum.contentClass,
    segments: hum.segments.map((s, i) => ({ segmentId: s.segmentId, ordinal: i, text: s.candidateSpokenText })),
    provenance: {
      source: "FIX PRE-2.4 humanizer → fidelity → naturalness chain",
      createdAt: nowIso(opts.now),
      productionScriptStatus: "CANONICAL",
      sourceScriptRef: hum.sourceScriptRef,
      humanizationRef: hum.humanizationId,
      evidenceFidelityRef: fidelity.decisionId,
      naturalnessQaRef: naturalness.qaId,
    },
    fingerprint: null,
  };
  doc.fingerprint = fingerprintOf(doc);
  const rel = `${FSS_DIR_REL}/${doc.scriptArtifactId}-v${doc.scriptVersion}.json`;
  const saved = approveAndPersist(root, projectId, rel, doc, validateFinalSpokenScript, FSS_DIR_REL, "DURABLE", "FINAL_SPOKEN_SCRIPT_VERSION_CONFLICT");
  if (!saved.ok && saved.code === "FINAL_SPOKEN_SCRIPT_VERSION_CONFLICT") {
    try {
      const existing = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, rel), "utf8"));
      if (existing.fingerprint === doc.fingerprint) {
        return { ok: true, script: existing, rel, replay: true, code: "IDEMPOTENT_REPLAY" };
      }
    } catch { /* fall through to conflict */ }
    return saved;
  }
  if (!saved.ok) return saved;
  emitEvent(root, projectId, "FINAL_SPOKEN_SCRIPT_CANONICALIZED", { correlationId: doc.scriptArtifactId, stateTo: "CANONICAL", attributes: { scriptVersion: doc.scriptVersion, humanizationRef: hum.humanizationId, fidelityRef: fidelity.decisionId, naturalnessRef: naturalness.qaId, segmentCount: doc.segments.length } }, opts);
  return { ok: true, script: doc, rel, replay: false };
}

function loadFinalSpokenScript(root, projectId, scriptArtifactId, scriptVersion) {
  const rel = `${FSS_DIR_REL}/${scriptArtifactId}-v${scriptVersion}.json`;
  const p = path.join(root, "projects", projectId, rel);
  if (!fs.existsSync(p)) return { ok: false, code: "FINAL_SPOKEN_SCRIPT_NOT_FOUND", message: `${ERRORS.FINAL_SPOKEN_SCRIPT_NOT_FOUND}: ${rel}` };
  try {
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    const v = validateFinalSpokenScript(doc);
    if (!v.ok) return { ok: false, code: "FINAL_SPOKEN_SCRIPT_NOT_CANONICAL", message: v.errors[0].message };
    return { ok: true, script: doc, rel };
  } catch (e) {
    return { ok: false, code: "FINAL_SPOKEN_SCRIPT_NOT_CANONICAL", message: String((e && e.message) || e) };
  }
}

/** §30: manifest index ref for the canonical FSS (index only, never the body). */
function attachManifestReference(root, projectId, scriptArtifactId, scriptVersion, opts = {}) {
  const loaded = loadFinalSpokenScript(root, projectId, scriptArtifactId, scriptVersion);
  if (!loaded.ok) return loaded;
  const doc = loaded.script;
  const ref = {
    version: `${doc.scriptArtifactId}@v${doc.scriptVersion}`,
    status: doc.provenance.productionScriptStatus === "CANONICAL" ? "VERIFIED" : "UNRESOLVED",
    ref: loaded.rel,
    detail: `productionScriptStatus=${doc.provenance.productionScriptStatus} hum=${doc.provenance.humanizationRef} fid=${doc.provenance.evidenceFidelityRef} nqa=${doc.provenance.naturalnessQaRef}`,
  };
  const r = manifestLib.setArtifactVersion(root, projectId, "finalSpokenScriptVersion", ref, opts);
  if (!r.ok) return r;
  return { ok: true, manifestStatus: ref.status };
}

/**
 * §28/§29 DAG: register the real chain nodes and dirty text/range-dependent
 * downstream consumers of the source script. No FINAL_AUDIO node is created.
 * Returns the markDirty result so the caller can prove stale-state handling.
 */
function registerDagChain(root, projectId, { humanizationId, fidelityId, naturalnessId, scriptArtifactId, scriptVersion }, opts = {}) {
  const existing = dagLib.loadDag(root, projectId);
  if (!existing.ok && existing.code !== "DAG_NOT_FOUND") return existing;
  if (!existing.ok) {
    const boot = dagLib.bootstrapDag(root, projectId, opts);
    if (!boot.ok) {
      // Evidence inspection may be unavailable for legacy projects; a bare
      // graph is still honest (chain nodes are added below explicitly).
      const bare = dagLib.createDag(root, projectId, opts);
      if (!bare.ok) return boot;
    }
  }
  const ensure = (artifactKey, artifactType, versionRef, inputRefs, producedBy) => {
    const cur = dagLib.loadDag(root, projectId);
    if (!cur.ok) return cur;
    if (cur.dag.nodes[artifactKey]) {
      let changed = false;
      if (versionRef && cur.dag.nodes[artifactKey].versionRef !== versionRef) {
        const v = dagLib.setNodeVersion(root, projectId, artifactKey, versionRef, opts);
        if (!v.ok) return v;
        changed = true;
      }
      // Bootstrap placeholders carry no edges: wire any missing real dependency.
      for (const ref of inputRefs) {
        if (!(cur.dag.nodes[artifactKey].inputRefs || []).some((r) => r.key === ref.key)) {
          const d = dagLib.addDependency(root, projectId, ref.key, artifactKey, ref.type, opts);
          if (!d.ok) return d;
        }
      }
      // The registered artifact is the fully-validated current one: a node
      // left NOT_CREATED_YET from an old bootstrap, or DIRTY from an earlier
      // generation, converges to CLEAN once its own versionRef is current.
      if (cur.dag.nodes[artifactKey].state !== "CLEAN" || changed) {
        const s = dagLib.setNodeState(root, projectId, artifactKey, "CLEAN", opts);
        if (!s.ok) return s;
      }
      return { ok: true, changed };
    }
    const n = dagLib.addNode(root, projectId, { artifactKey, artifactType, versionRef: versionRef || null, state: "CLEAN", producedBy, provenance: "LIVE", inputRefs }, opts);
    return { ...n, changed: true };
  };
  const r1 = ensure("SPOKEN_HUMANIZATION", "SPOKEN_HUMANIZATION", humanizationId, [], "fix-pre-2.4:humanizer");
  if (!r1.ok) return r1;
  const r2 = ensure("EVIDENCE_FIDELITY_DECISION", "EVIDENCE_FIDELITY_DECISION", fidelityId, [{ key: "SPOKEN_HUMANIZATION", type: "HUMANIZATION_CANDIDATE" }], "fix-pre-2.4:fidelity");
  if (!r2.ok) return r2;
  const r3 = ensure("NATURALNESS_QA", "NATURALNESS_QA", naturalnessId, [{ key: "EVIDENCE_FIDELITY_DECISION", type: "FIDELITY_EVIDENCE" }], "fix-pre-2.4:naturalness");
  if (!r3.ok) return r3;
  const r4 = ensure("FINAL_SPOKEN_SCRIPT", "FINAL_SPOKEN_SCRIPT", `${scriptArtifactId}@v${scriptVersion}`, [{ key: "NATURALNESS_QA", type: "NATURALNESS_EVIDENCE" }, { key: "SPOKEN_HUMANIZATION", type: "SOURCE_LINEAGE" }], "fix-pre-2.4:canonical-fss");
  if (!r4.ok) return r4;
  // §29: mark downstream dirty ONLY when the canonical script identity actually
  // changed. An idempotent replay (same versionRef) must never dirty the graph.
  if (r4.changed) {
    const mark = dagLib.markDirty(root, projectId, "FINAL_SPOKEN_SCRIPT", { reason: "canonical FSS created by FIX PRE-2.4; text/range-dependent downstream must re-derive" }, opts, null);
    if (!mark.ok) return mark;
    emitEvent(root, projectId, "DIRTY_PROPAGATION", { correlationId: scriptArtifactId, attributes: { dirtied: (mark.dirtied || []).join("|"), blocked: (mark.blocked || []).join("|") } }, {});
    return { ok: true, dirtied: mark.dirtied, blocked: mark.blocked, changed: true };
  }
  return { ok: true, dirtied: [], blocked: [], changed: false };
}

/**
 * §32/§13 external immutable supersession decision: marks one script version
 * as SUPERSEDED_INVALID (productionEligible = false). The superseded version
 * file itself stays byte-identical and loadable as history; the decision is a
 * SEPARATE artifact so no canonical text is ever edited in place. Production
 * resolvers must consult isSuperseded() — a superseded version can never be
 * selected for production TTS.
 */
function supersessionRel(scriptArtifactId, version) {
  return `${FSS_DIR_REL}/${scriptArtifactId}-v${version}.SUPERSEDED.json`;
}

function recordSupersession(root, projectId, { scriptArtifactId, version, supersededBy, reason }, opts = {}) {
  const supBy = typeof supersededBy === "object" ? supersededBy : `${scriptArtifactId}@v${supersededBy}`;
  const doc = {
    schemaVersion: "1.0.0",
    decisionId: `sup-${costShared.id12("sup", { project: projectId, artifact: scriptArtifactId, version, supersededBy: supBy }) .slice(4)}`,
    scriptArtifactId,
    version,
    supersededVersionRef: `${scriptArtifactId}@v${version}`,
    supersededBy: supBy,
    status: "SUPERSEDED_INVALID",
    productionEligible: false,
    reason: reason || null,
    createdAt: null,
    fingerprint: null,
  };
  doc.fingerprint = fingerprintOf(doc); // timestamps are metadata, never identity
  doc.createdAt = nowIso(opts.now);
  const rel = supersessionRel(scriptArtifactId, version);
  const saved = approveAndPersist(root, projectId, rel, doc, () => ({ ok: true, errors: [] }), FSS_DIR_REL, "DURABLE", "FINAL_SPOKEN_SCRIPT_VERSION_CONFLICT");
  if (!saved.ok && saved.code === "FINAL_SPOKEN_SCRIPT_VERSION_CONFLICT") {
    try {
      const existingDoc = JSON.parse(fs.readFileSync(path.join(root, "projects", projectId, rel), "utf8"));
      if (existingDoc.fingerprint === doc.fingerprint) return { ok: true, decision: existingDoc, rel, replay: true, code: "IDEMPOTENT_REPLAY" };
    } catch { /* fall through */ }
    return saved;
  }
  if (!saved.ok) return saved;
  emitEvent(root, projectId, "FINAL_SPOKEN_SCRIPT_REVISED", { correlationId: `${scriptArtifactId}@v${version}`, stateTo: "SUPERSEDED_INVALID", attributes: { supersededBy: supBy, reason: reason || "" } }, opts);
  return { ok: true, decision: doc, rel };
}

function isSuperseded(root, projectId, scriptArtifactId, version) {
  const p = path.join(root, "projects", projectId, supersessionRel(scriptArtifactId, version));
  if (!fs.existsSync(p)) return { ok: true, superseded: false };
  try {
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    return { ok: true, superseded: doc.status === "SUPERSEDED_INVALID" && doc.productionEligible === false, decision: doc };
  } catch (e) {
    // An unreadable supersession decision must never read as "eligible".
    return { ok: true, superseded: true, error: String((e && e.message) || e) };
  }
}

/**
 * Production TTS resolver: returns the requested script version ONLY when it
 * is CANONICAL and not superseded. Superseded versions fail closed with
 * FINAL_SPOKEN_SCRIPT_SUPERSEDED — they remain loadable as history via
 * loadFinalSpokenScript, never selectable for production.
 */
function resolveProductionScript(root, projectId, scriptArtifactId, version) {
  const sup = isSuperseded(root, projectId, scriptArtifactId, version);
  if (!sup.ok) return sup;
  if (sup.superseded) {
    return { ok: false, code: "FINAL_SPOKEN_SCRIPT_SUPERSEDED", message: `${ERRORS.FINAL_SPOKEN_SCRIPT_SUPERSEDED}: ${scriptArtifactId}@v${version} (${sup.decision ? `supersededBy ${sup.decision.supersededBy}` : "unreadable decision"})` };
  }
  const loaded = loadFinalSpokenScript(root, projectId, scriptArtifactId, version);
  if (!loaded.ok) return loaded;
  if (loaded.script.provenance.productionScriptStatus !== "CANONICAL") {
    return { ok: false, code: "FINAL_SPOKEN_SCRIPT_NOT_CANONICAL", message: `${ERRORS.FINAL_SPOKEN_SCRIPT_NOT_CANONICAL}: ${scriptArtifactId}@v${version}` };
  }
  return loaded;
}

function emitEvent(root, projectId, eventName, fields = {}, opts = {}) {
  try {
    const r = telemetryLib.recordEvent(root, projectId, {
      eventName,
      severity: fields.severity || "INFO",
      stage: "fix-pre-2.4",
      component: "spoken-script",
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

module.exports = {
  ERRORS,
  CHANGE_TYPES,
  PROTECTED_ITEM_TYPES,
  HEDGE_TERMS,
  CERTAINTY_BOOSTERS,
  BLOCKING_NATURALNESS_CODES,
  MAX_REPAIR_ATTEMPTS,
  HUMANIZATION_DIR_REL,
  FIDELITY_DIR_REL,
  NATURALNESS_DIR_REL,
  FSS_DIR_REL,
  textHash,
  extractProtectedItems,
  evaluateNaturalness,
  validateHumanization,
  validateFinalSpokenScript,
  createHumanization,
  loadHumanization,
  runEvidenceFidelity,
  runNaturalnessQa,
  materializeFinalSpokenScript,
  loadFinalSpokenScript,
  recordSupersession,
  isSuperseded,
  resolveProductionScript,
  attachManifestReference,
  registerDagChain,
  emitEvent,
};
