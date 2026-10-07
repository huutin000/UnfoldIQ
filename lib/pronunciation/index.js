"use strict";

/**
 * Phase 2.3 — Pronunciation Profile + Runtime Pass (UNFOLDIQ CORE).
 *
 * Canonical, PROVIDER-AGNOSTIC pronunciation state (term + reading notation +
 * reading value + scope + provenance). Provider markup is always derived by
 * the provider compiler (providers/runtime/kokoro-phonemize.js) and never the
 * only persisted record. The runtime pass is executable, not a passive
 * dictionary: every pass runs the REAL configured pre-TTS runtime in quiet
 * phonemization mode (graphemes/phonemes, no audio, no Phase 2.4 synthesis).
 *
 * Versioning/immutability mirror the Voice Bible: version files are immutable,
 * a semantic change creates a new version, and localized override changes
 * invalidate exactly the consuming segments (machine-readable invalidation
 * plan) — never the whole script by default.
 */

const Ajv = require("ajv");
const fs = require("fs");
const path = require("path");
const workspaceLib = require("../workspace/index.js");
const manifestLib = require("../project-manifest/index.js");
const dagLib = require("../dependency-dag/index.js");
const telemetryLib = require("../telemetry/index.js");
const costShared = require("../output-cost/shared.js");
const kokoroPhonemize = require("../../providers/runtime/kokoro-phonemize.js");

const PROFILE_SCHEMA_VERSION = "1.0.0";
const PASS_SCHEMA_VERSION = "1.0.0";
const PROFILE_DIR_REL = "voice/pronunciation-profile";
const PASS_DIR_REL = "voice/pronunciation-pass";
const LIFECYCLE = "DURABLE";

const CATEGORIES = ["NAME", "FOREIGN_TERM", "ACRONYM", "PLACE_NAME", "DOMAIN_TERM", "CUSTOM"];
const NOTATIONS = ["IPA", "PROVIDER_NATIVE", "READ_AS"];
const ACRONYM_MODES = ["LETTER_BY_LETTER", "WORD", "CUSTOM"];
const SOURCES = ["RUNTIME_G2P", "CANONICAL_LEXICON", "OPERATOR_OVERRIDE", "PROJECT_OVERRIDE", "VERIFIED_SOURCE"];
const QUALITIES = ["AUTO", "VERIFIED", "REVIEW_REQUIRED", "REJECTED"];
const SCOPE_LEVELS = ["GLOBAL_LANGUAGE", "PROJECT", "SCRIPT", "SEGMENT"];
const SCOPE_PRECEDENCE = { SEGMENT: 4, SCRIPT: 3, PROJECT: 2, GLOBAL_LANGUAGE: 1 };
// Sources that may back a human-verified reading (never runtime G2P output).
const VERIFIED_ELIGIBLE_SOURCES = ["OPERATOR_OVERRIDE", "VERIFIED_SOURCE"];

const ERRORS = {
  PRONUNCIATION_PROFILE_NOT_FOUND: "pronunciation profile version does not exist",
  PRONUNCIATION_PROFILE_INVALID: "pronunciation profile fails schema/semantic validation",
  PRONUNCIATION_PROFILE_VERSION_CONFLICT: "profile version already exists; versions are immutable",
  PRONUNCIATION_PROFILE_WRITE_FAILED: "atomic profile persist failed; previous state untouched",
  PRONUNCIATION_PROFILE_PATH_NOT_ALLOWED: "profile path outside approved workspace locations",
  PRONUNCIATION_PROFILE_LIFECYCLE_INVALID: "profile must be explicitly DURABLE, never defaulted",
  PRONUNCIATION_ENTRY_INVALID: "profile entry fails validation",
  PRONUNCIATION_ENTRY_CONFLICT: "two equally specific active overrides conflict; no silent winner",
  PRONUNCIATION_READING_INVALID: "reading notation/value invalid or fabricated verification attempted",
  PRONUNCIATION_REVIEW_REQUIRED: "ambiguous or unverified reading requires human review",
  PRONUNCIATION_RUNTIME_UNAVAILABLE: "configured runtime unavailable; never silently degraded",
  PRONUNCIATION_RUNTIME_FAILED: "runtime phonemization failed",
  PRONUNCIATION_RUNTIME_MISMATCH: "runtime output does not match the expected override",
  PRONUNCIATION_OVERRIDE_NOT_APPLIED: "override cannot be consumed by this provider compiler",
  PRONUNCIATION_SCRIPT_MISMATCH: "pass input does not match the current script version/text",
  PRONUNCIATION_PASS_NOT_FOUND: "pronunciation runtime pass version does not exist",
  PRONUNCIATION_PASS_INVALID: "pronunciation pass fails schema/semantic validation",
  PRONUNCIATION_PASS_NOT_CREATED: "no runtime pass exists for the requested change",
  PRONUNCIATION_CHANGED_ENTRY_UNKNOWN: "changed entryId not present in the profile",
  ARTIFACT_PATH_NOT_ALLOWED: "path is outside approved workspace locations",
  ARTIFACT_LIFECYCLE_INVALID: "lifecycle class invalid",
};

let ajvValidator = null;
function validator() {
  if (!ajvValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "pronunciation-profile.schema.json"), "utf8"));
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

function normalizeTerm(term) {
  return String(term || "").trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Path approval + immutable persistence (mirrors lib/voice-bible)
// ---------------------------------------------------------------------------

function profileRel(profileId) {
  return `${PROFILE_DIR_REL}/${profileId}.json`;
}

function approveProfilePath(root, projectId, profileId) {
  const lifecycle = workspaceLib.classifyNewArtifact({ artifactType: "VOICE", lifecycleClass: LIFECYCLE });
  if (!lifecycle.ok || lifecycle.reviewRequired) {
    return { ok: false, code: "PRONUNCIATION_PROFILE_LIFECYCLE_INVALID", message: ERRORS.PRONUNCIATION_PROFILE_LIFECYCLE_INVALID };
  }
  const rel = profileRel(profileId);
  const guard = workspaceLib.validateWorkspacePath(root, path.posix.join("projects", projectId, rel), { projectId });
  if (!guard.ok) return { ok: false, code: "ARTIFACT_PATH_NOT_ALLOWED", message: guard.message };
  return { ok: true, rel, lifecycleClass: lifecycle.lifecycleClass };
}

function persistProfileVersion(root, projectId, doc) {
  const approved = approveProfilePath(root, projectId, doc.pronunciationProfileId);
  if (!approved.ok) return approved;
  if (fs.existsSync(path.join(root, "projects", projectId, approved.rel))) {
    return { ok: false, code: "PRONUNCIATION_PROFILE_VERSION_CONFLICT", message: `${ERRORS.PRONUNCIATION_PROFILE_VERSION_CONFLICT}: ${doc.pronunciationProfileId}` };
  }
  const v = validatePronunciationProfile(doc);
  if (!v.ok) return { ok: false, code: v.errors[0].code, message: v.errors[0].message, errors: v.errors };
  try {
    fs.mkdirSync(path.join(root, "projects", projectId, PROFILE_DIR_REL), { recursive: true });
    const tmp = `${path.join(root, "projects", projectId, approved.rel)}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, path.join(root, "projects", projectId, approved.rel));
  } catch (e) {
    return { ok: false, code: "PRONUNCIATION_PROFILE_WRITE_FAILED", message: `${ERRORS.PRONUNCIATION_PROFILE_WRITE_FAILED}: ${String((e && e.message) || e)}` };
  }
  return { ok: true, rel: approved.rel, lifecycleClass: approved.lifecycleClass };
}

function loadPronunciationProfile(root, projectId, profileId) {
  const p = path.join(root, "projects", projectId, profileRel(profileId));
  if (!fs.existsSync(p)) {
    return { ok: false, code: "PRONUNCIATION_PROFILE_NOT_FOUND", message: `${ERRORS.PRONUNCIATION_PROFILE_NOT_FOUND}: ${profileId}` };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(p, "utf8"));
    const v = validatePronunciationProfile(doc);
    if (!v.ok) return { ok: false, code: "PRONUNCIATION_PROFILE_INVALID", message: v.errors[0].message, errors: v.errors };
    return { ok: true, profile: doc, rel: profileRel(profileId) };
  } catch (e) {
    return { ok: false, code: "PRONUNCIATION_PROFILE_INVALID", message: String((e && e.message) || e) };
  }
}

function listPronunciationProfiles(root, projectId) {
  const dir = path.join(root, "projects", projectId, PROFILE_DIR_REL);
  if (!fs.existsSync(dir)) return { ok: true, profiles: [] };
  const out = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".json")) continue;
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      out.push({ pronunciationProfileId: doc.pronunciationProfileId, version: doc.version, fingerprint: doc.fingerprint, entryCount: (doc.entries || []).length });
    } catch { /* unparseable version files are skipped by the listing, never validated away */ }
  }
  out.sort((a, b) => a.version - b.version);
  return { ok: true, profiles: out };
}

function latestPronunciationProfile(root, projectId) {
  const listed = listPronunciationProfiles(root, projectId);
  if (!listed.ok) return listed;
  if (listed.profiles.length === 0) {
    return { ok: false, code: "PRONUNCIATION_PROFILE_NOT_FOUND", message: ERRORS.PRONUNCIATION_PROFILE_NOT_FOUND };
  }
  return loadPronunciationProfile(root, projectId, listed.profiles[listed.profiles.length - 1].pronunciationProfileId);
}

// ---------------------------------------------------------------------------
// Entry + profile validation (honest quality rules, §9)
// ---------------------------------------------------------------------------

function validateEntry(entry) {
  const errors = [];
  const push = (code, message) => errors.push({ code, message: `PRONUNCIATION_ENTRY_INVALID: ${message}` });
  if (!CATEGORIES.includes(entry.category)) push("PRONUNCIATION_ENTRY_INVALID", `category must be ${CATEGORIES.join("|")}`);
  if (!SOURCES.includes(entry.source)) push("PRONUNCIATION_ENTRY_INVALID", `source must be ${SOURCES.join("|")}`);
  if (!QUALITIES.includes(entry.quality)) push("PRONUNCIATION_ENTRY_INVALID", `quality must be ${QUALITIES.join("|")}`);
  const reading = entry.reading || {};
  if (!NOTATIONS.includes(reading.notation)) push("PRONUNCIATION_READING_INVALID", `reading.notation must be ${NOTATIONS.join("|")}`);
  if (typeof reading.value !== "string" || !reading.value.trim()) push("PRONUNCIATION_READING_INVALID", "reading.value must be a nonempty string");
  if (entry.category === "ACRONYM" && !ACRONYM_MODES.includes(entry.acronymMode)) {
    push("PRONUNCIATION_ENTRY_INVALID", `ACRONYM entries require acronymMode ${ACRONYM_MODES.join("|")}`);
  }
  if (entry.category !== "ACRONYM" && entry.acronymMode) {
    push("PRONUNCIATION_ENTRY_INVALID", "acronymMode only applies to ACRONYM entries");
  }
  // Scope coherence: a scoped entry must carry the ids its level requires.
  const scope = entry.scope || {};
  if (!SCOPE_LEVELS.includes(scope.level)) push("PRONUNCIATION_ENTRY_INVALID", `scope.level must be ${SCOPE_LEVELS.join("|")}`);
  if (scope.level === "PROJECT" && !scope.projectId) push("PRONUNCIATION_ENTRY_INVALID", "PROJECT scope requires scope.projectId");
  if (scope.level === "SCRIPT" && !scope.scriptArtifactId) push("PRONUNCIATION_ENTRY_INVALID", "SCRIPT scope requires scope.scriptArtifactId");
  if (scope.level === "SEGMENT" && (!scope.segmentId || !scope.scriptArtifactId)) push("PRONUNCIATION_ENTRY_INVALID", "SEGMENT scope requires scope.segmentId + scope.scriptArtifactId");

  // Honest quality rules (§9): runtime G2P is never human-verified; ambiguous
  // proper names fail to REVIEW_REQUIRED; verified IPA must be operator-backed.
  if (entry.quality === "VERIFIED" && !VERIFIED_ELIGIBLE_SOURCES.includes(entry.source)) {
    push("PRONUNCIATION_REVIEW_REQUIRED", `VERIFIED requires source ${VERIFIED_ELIGIBLE_SOURCES.join("|")}; runtime G2P output stays AUTO`);
  }
  if ((entry.category === "NAME" || entry.category === "PLACE_NAME") && entry.source === "RUNTIME_G2P" && entry.quality === "VERIFIED") {
    push("PRONUNCIATION_REVIEW_REQUIRED", "ambiguous proper-name readings from spelling alone are REVIEW_REQUIRED, never VERIFIED");
  }
  if (reading.notation === "IPA" && entry.source === "RUNTIME_G2P") {
    push("PRONUNCIATION_READING_INVALID", "fabricated IPA from runtime G2P is forbidden; IPA requires OPERATOR_OVERRIDE or VERIFIED_SOURCE");
  }
  return { ok: errors.length === 0, errors };
}

function validatePronunciationProfile(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return { ok: false, errors: [{ code: "PRONUNCIATION_PROFILE_INVALID", message: "doc must be an object" }] };
  const valid = validator()(doc);
  if (!valid) {
    for (const e of validator().errors || []) {
      errors.push({ code: "PRONUNCIATION_PROFILE_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
    }
  }
  const seenIds = new Set();
  for (const entry of doc.entries || []) {
    const v = validateEntry(entry);
    if (!v.ok) errors.push(...v.errors);
    if (seenIds.has(entry.entryId)) errors.push({ code: "PRONUNCIATION_ENTRY_INVALID", message: `duplicate entryId ${entry.entryId}` });
    seenIds.add(entry.entryId);
  }
  return { ok: errors.length === 0, errors };
}

function buildEntry(input, createdAt) {
  const scope = input.scope || { level: "GLOBAL_LANGUAGE" };
  const normalized = {
    entryId: input.entryId || costShared.id12("pe", { term: normalizeTerm(input.displayTerm), category: input.category, reading: input.reading, scope, source: input.source }),
    normalizedTerm: normalizeTerm(input.displayTerm),
    displayTerm: input.displayTerm,
    language: input.language,
    locale: input.locale || null,
    category: input.category,
    reading: { notation: input.reading.notation, value: input.reading.value },
    acronymMode: input.acronymMode || null,
    scope: {
      level: scope.level,
      projectId: scope.projectId || null,
      scriptArtifactId: scope.scriptArtifactId || null,
      segmentId: scope.segmentId || null,
    },
    source: input.source,
    quality: input.quality,
    notes: input.notes || null,
    provenance: { createdAt, origin: input.provenance && input.provenance.origin || null, evidenceRefs: (input.provenance && input.provenance.evidenceRefs) || [] },
  };
  return normalized;
}

function profileSemantic(entries, language) {
  // Semantic identity excludes provenance metadata (timestamps, origins):
  // identical readings remain the same version, per §21/§22 idempotency.
  const semanticEntries = [...entries]
    .sort((a, b) => a.entryId.localeCompare(b.entryId))
    .map(({ provenance, ...rest }) => {
      void provenance;
      return rest;
    });
  return costShared.hash16({ language, entries: semanticEntries });
}

function nextProfileIdentity(previous, semantic) {
  const version = previous ? previous.version + 1 : 1;
  return { pronunciationProfileId: costShared.id12("pron", { project: previous ? previous.projectId : null, version, semantic }), version };
}

/** Create the first profile version. Refuses when one already exists. */
function createPronunciationProfile(root, projectId, input = {}, opts = {}) {
  if (!root || !projectId || !input.language || !Array.isArray(input.entries)) {
    return { ok: false, code: "PRONUNCIATION_PROFILE_INVALID", message: "root, projectId, language, entries[] are required" };
  }
  const existing = listPronunciationProfiles(root, projectId);
  if (!existing.ok) return existing;
  if (existing.profiles.length > 0) {
    return { ok: false, code: "PRONUNCIATION_PROFILE_VERSION_CONFLICT", message: "a profile already exists; use revisePronunciationProfile (versions are immutable)" };
  }
  const createdAt = nowIso(opts.now);
  const doc = {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    pronunciationProfileId: null,
    version: 1,
    projectId: input.projectId || projectId,
    language: input.language,
    entries: input.entries.map((e) => buildEntry(e, createdAt)),
    provenance: { source: input.provenance && input.provenance.source || "phase-2.3", createdAt, evidenceRefs: (input.provenance && input.provenance.evidenceRefs) || [] },
    fingerprint: null,
  };
  const semantic = profileSemantic(doc.entries, doc.language);
  const identity = nextProfileIdentity(null, semantic);
  doc.pronunciationProfileId = identity.pronunciationProfileId;
  doc.fingerprint = fingerprintOf(doc);
  const saved = persistProfileVersion(root, projectId, doc);
  if (!saved.ok) return saved;
  emitPronEvent(root, projectId, "PRONUNCIATION_PROFILE_RESOLVED", { correlationId: doc.pronunciationProfileId, stateTo: "CREATED", attributes: { profileVersion: doc.version, entryCount: doc.entries.length } }, opts);
  return { ok: true, profile: doc, rel: saved.rel };
}

/** New immutable version. Old versions stay loadable (§21). */
function revisePronunciationProfile(root, projectId, patch = {}, opts = {}) {
  const current = patch.baseProfileId
    ? loadPronunciationProfile(root, projectId, patch.baseProfileId)
    : latestPronunciationProfile(root, projectId);
  if (!current.ok) return current;
  const prev = current.profile;
  let entries = prev.entries.map((e) => ({ ...e }));
  if (patch.upsertEntries && patch.upsertEntries.length) {
    for (const e of patch.upsertEntries) {
      const built = buildEntry(e, nowIso(opts.now));
      const i = entries.findIndex((x) => x.normalizedTerm === built.normalizedTerm && x.scope.level === built.scope.level && JSON.stringify(x.scope) === JSON.stringify(built.scope));
      if (i >= 0) entries[i] = built; else entries.push(built);
    }
  }
  if (patch.rejectEntryIds && patch.rejectEntryIds.length) {
    for (const id of patch.rejectEntryIds) {
      const i = entries.findIndex((x) => x.entryId === id);
      if (i >= 0) entries[i] = { ...entries[i], quality: "REJECTED" };
    }
  }
  const semantic = profileSemantic(entries, prev.language);
  const prevSemantic = profileSemantic(prev.entries, prev.language);
  if (semantic === prevSemantic) {
    return { ok: true, profile: prev, rel: current.rel, changed: false, code: "IDEMPOTENT_REPLAY" };
  }
  const identity = nextProfileIdentity(prev, semantic);
  const doc = { ...prev, pronunciationProfileId: identity.pronunciationProfileId, version: identity.version, entries, provenance: { ...prev.provenance, createdAt: nowIso(opts.now), revisedFrom: prev.pronunciationProfileId, evidenceRefs: [...(prev.provenance.evidenceRefs || []), ...(patch.evidenceRefs || [])] }, fingerprint: null };
  doc.fingerprint = fingerprintOf(doc);
  const saved = persistProfileVersion(root, projectId, doc);
  if (!saved.ok) return saved;
  emitPronEvent(root, projectId, "PRONUNCIATION_OVERRIDE_REVISED", { correlationId: doc.pronunciationProfileId, stateTo: "REVISED", attributes: { profileVersion: doc.version, previousVersion: prev.version, previousProfileId: prev.pronunciationProfileId } }, opts);
  return { ok: true, profile: doc, rel: saved.rel, changed: true, previousProfileId: prev.pronunciationProfileId };
}

// ---------------------------------------------------------------------------
// Scope resolution (§16): SEGMENT > SCRIPT > PROJECT > GLOBAL_LANGUAGE
// ---------------------------------------------------------------------------

function scopeApplies(entry, ctx) {
  const s = entry.scope;
  if (s.level === "GLOBAL_LANGUAGE") return entry.language === ctx.language;
  if (s.level === "PROJECT") return s.projectId === ctx.projectId && entry.language === ctx.language;
  if (s.level === "SCRIPT") return s.scriptArtifactId === ctx.scriptArtifactId && entry.language === ctx.language;
  if (s.level === "SEGMENT") return s.segmentId === ctx.segmentId && s.scriptArtifactId === ctx.scriptArtifactId && entry.language === ctx.language;
  return false;
}

function readingIdentity(entry) {
  return JSON.stringify({ notation: entry.reading.notation, value: entry.reading.value, acronymMode: entry.acronymMode || null });
}

/**
 * Resolve ONE term in ONE context. Highest specificity wins; two equally
 * specific conflicting active overrides fail closed (no arbitrary winner).
 */
function resolveTermOverride(profile, term, ctx) {
  const normalized = normalizeTerm(term);
  const candidates = (profile.entries || []).filter((e) => e.quality !== "REJECTED" && e.normalizedTerm === normalized && scopeApplies(e, ctx));
  if (candidates.length === 0) return { ok: true, entry: null, matched: [] };
  const top = Math.max(...candidates.map((e) => SCOPE_PRECEDENCE[e.scope.level]));
  const winners = candidates.filter((e) => SCOPE_PRECEDENCE[e.scope.level] === top);
  const distinct = new Set(winners.map(readingIdentity));
  if (distinct.size > 1) {
    return { ok: false, code: "PRONUNCIATION_ENTRY_CONFLICT", message: `${ERRORS.PRONUNCIATION_ENTRY_CONFLICT}: ${term} @ ${SCOPE_PRECEDENCE[top] === 4 ? "SEGMENT" : top === 3 ? "SCRIPT" : top === 2 ? "PROJECT" : "GLOBAL_LANGUAGE"}`, matched: winners };
  }
  return { ok: true, entry: winners[0], matched: winners };
}

/**
 * Resolve all profile terms that actually occur in one segment's text.
 * Deterministic order: by normalizedTerm. Conflicts surface as
 * { ok:false, conflicts[] } — the caller decides the segment status.
 */
function resolveSegmentEntries(profile, segmentText, ctx) {
  const lower = String(segmentText || "").toLowerCase();
  const conflicts = [];
  const resolved = [];
  for (const term of [...new Set((profile.entries || []).map((e) => e.normalizedTerm))].sort()) {
    const bare = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`(^|[^a-z0-9'])${bare}([^a-z0-9']|$)`, "i").test(lower)) continue;
    const r = resolveTermOverride(profile, term, ctx);
    if (!r.ok) {
      conflicts.push({ term, code: r.code, matched: r.matched.map((m) => m.entryId) });
      continue;
    }
    if (r.entry) resolved.push(r.entry);
  }
  return { ok: conflicts.length === 0, resolved, conflicts };
}

// ---------------------------------------------------------------------------
// Candidate detection (§14) — assists review, never claims certainty
// ---------------------------------------------------------------------------

const SENTENCE_CONNECTORS = new Set(["the", "a", "an", "and", "but", "or", "if", "then", "however", "meanwhile", "today", "yesterday", "tomorrow", "instead", "finally", "additionally", "because"]);

function detectCandidates(text) {
  const t = String(text || "");
  const found = [];
  const push = (term, kind, reason) => {
    if (!found.some((c) => c.term.toLowerCase() === term.toLowerCase())) found.push({ term, kind, reason });
  };
  for (const m of t.matchAll(/\b[A-Z]{2,6}\b/g)) push(m[0], "ACRONYM", "all-caps token");
  for (const m of t.matchAll(/(?<=[a-z,;:]\s)([A-Z][a-zA-Z]+)/g)) {
    if (!SENTENCE_CONNECTORS.has(m[1].toLowerCase())) push(m[1], "UNKNOWN_NAME", "capitalized token mid-sentence");
  }
  for (const m of t.matchAll(/\b[a-z]+[A-Z][A-Za-z]*\b/g)) push(m[0], "TECHNICAL_TERM", "mixed-case technical term");
  return found;
}

function candidateStats(segments, knownTrueTerms = []) {
  const trueSet = new Set(knownTrueTerms.map((t) => t.toLowerCase()));
  let candidates = 0;
  let truePositives = 0;
  for (const seg of segments) {
    for (const c of detectCandidates(seg.text)) {
      candidates += 1;
      if (trueSet.has(c.term.toLowerCase())) truePositives += 1;
    }
  }
  return { candidates, truePositives, falsePositives: candidates - truePositives, falsePositiveRate: candidates === 0 ? 0 : Number(((candidates - truePositives) / candidates).toFixed(4)) };
}

// ---------------------------------------------------------------------------
// Runtime pass (§13) — real quiet phonemization, no audio
// ---------------------------------------------------------------------------

function segmentHash(text) {
  return costShared.hash16(String(text));
}

function normalizePhonemes(s) {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Run one pass. input: { scriptDoc, profileId?, voiceBibleRef, provider,
 * providerModel }. opts.transport injects the phonemization transport (tests);
 * the default is the REAL python/KPipeline quiet path. Idempotent: identical
 * inputs return the existing pass (IDEMPOTENT_REPLAY), never a duplicate.
 */
function runPronunciationPass(root, projectId, input = {}, opts = {}) {
  if (!input.scriptDoc || !input.voiceBibleRef) {
    return { ok: false, code: "PRONUNCIATION_PASS_INVALID", message: "scriptDoc + voiceBibleRef are required" };
  }
  const script = input.scriptDoc;
  const profileLoaded = input.profileId
    ? loadPronunciationProfile(root, projectId, input.profileId)
    : latestPronunciationProfile(root, projectId);
  if (!profileLoaded.ok) return profileLoaded;
  const profile = profileLoaded.profile;
  const provider = input.provider || "local-kokoro";
  const providerModel = input.providerModel || "kokoro-v1";
  const language = script.language;

  const segments = [];
  const batchItems = [];
  const ctxBase = { projectId, scriptArtifactId: script.scriptArtifactId, language };
  for (const seg of script.segments) {
    const sourceTextHash = segmentHash(seg.text);
    const ctx = { ...ctxBase, segmentId: seg.segmentId };
    const resolution = resolveSegmentEntries(profile, seg.text, ctx);
    const compiled = kokoroPhonemize.compileInput({ text: seg.text, entries: resolution.resolved });
    const matchedEntries = resolution.resolved.map((e) => ({ entryId: e.entryId, term: e.displayTerm, applied: false, notAppliedReason: null }));
    const record = { seg, sourceTextHash, ctx, resolution, compiled, matchedEntries, issues: [] };
    segments.push(record);
    batchItems.push({ index: segments.length - 1, text: compiled.compiledText, language });
    for (const c of resolution.conflicts) {
      record.issues.push({ code: c.code, detail: `term "${c.term}" has equally specific conflicting overrides: ${c.matched.join(",")}` });
    }
  }
  // Expected phonemes come from the ACTUAL compiled replacement text (what the
  // runtime will speak), joined into the same batch — one runtime process for
  // segments + expectations.
  const expectationKeys = [];
  for (const rec of segments) {
    for (const app of rec.compiled.applications) {
      if (app.replacement === null) continue;
      if (!expectationKeys.some((k) => k.entryId === app.entryId)) expectationKeys.push({ entryId: app.entryId, text: app.replacement });
    }
  }
  for (const k of expectationKeys) {
    batchItems.push({ index: `exp:${k.entryId}`, text: k.text, language });
  }

  const runtime = kokoroPhonemize.phonemizeBatch(batchItems, opts);
  if (!runtime.ok) return runtime;
  const expectedByEntry = new Map();
  for (const k of expectationKeys) {
    const res = runtime.results.find((r) => r.index === `exp:${k.entryId}`);
    if (res && res.ok) expectedByEntry.set(k.entryId, normalizePhonemes(res.phonemes.join(" ")));
  }

  const passId = costShared.id12("prp", {
    project: projectId,
    scriptArtifactId: script.scriptArtifactId,
    scriptVersion: script.scriptVersion,
    profileId: profile.pronunciationProfileId,
    provider,
    model: providerModel,
  });
  const existingRel = path.join(root, "projects", projectId, PASS_DIR_REL, `${passId}.json`);
  if (fs.existsSync(existingRel)) {
    try {
      const doc = JSON.parse(fs.readFileSync(existingRel, "utf8"));
      return { ok: true, pass: doc, rel: `${PASS_DIR_REL}/${passId}.json`, code: "IDEMPOTENT_REPLAY" };
    } catch {
      return { ok: false, code: "PRONUNCIATION_PASS_INVALID", message: "existing pass unparseable" };
    }
  }

  const outSegments = [];
  for (let i = 0; i < segments.length; i += 1) {
    const rec = segments[i];
    const res = runtime.results.find((r) => r.index === i);
    const matched = [...rec.matchedEntries];
    let status;
    if (!res || !res.ok) {
      status = "FAILED";
      rec.issues.push({ code: "PRONUNCIATION_RUNTIME_FAILED", detail: res && res.error ? String(res.error) : "runtime returned no result for segment" });
    } else {
      const compiledPhonemes = normalizePhonemes(res.phonemes.join(" "));
      rec.resolution.resolved.forEach((e, idx) => {
        const app = rec.compiled.applications.find((a) => a.entryId === e.entryId);
        const notApp = rec.compiled.notApplied.find((a) => a.entryId === e.entryId);
        const m = matched[idx];
        if (notApp) {
          m.applied = false;
          m.notAppliedReason = notApp.code;
          rec.issues.push({ code: notApp.code, detail: `${e.displayTerm}: ${notApp.detail || "provider compiler cannot consume this notation"}` });
        } else if (app) {
          const expected = expectedByEntry.get(e.entryId);
          if (app.replacement !== null && !expected) {
            m.applied = false;
            m.notAppliedReason = "PRONUNCIATION_RUNTIME_FAILED";
            rec.issues.push({ code: "PRONUNCIATION_RUNTIME_FAILED", detail: "expected reading phonemes unavailable from runtime" });
          } else if (app.replacement !== null && !compiledPhonemes.includes(expected)) {
            m.applied = false;
            m.notAppliedReason = "PRONUNCIATION_RUNTIME_MISMATCH";
            rec.issues.push({ code: "PRONUNCIATION_RUNTIME_MISMATCH", detail: `override for "${e.displayTerm}" not proven in runtime phonemes` });
          } else {
            m.applied = true;
          }
        } else {
          m.applied = true; // WORD-mode acronym: compiled text intentionally unchanged
        }
      });
      const appliedChange = rec.compiled.applications.some((a) => a.replacement !== null);
      const anyNotApplied = matched.some((m) => !m.applied);
      const needsReview = rec.resolution.resolved.some((e) => e.quality === "REVIEW_REQUIRED");
      if (needsReview) rec.issues.push({ code: "PRONUNCIATION_REVIEW_REQUIRED", detail: "segment consumes an entry whose reading still requires human review" });
      if (anyNotApplied || needsReview || rec.issues.some((iss) => iss.code === "PRONUNCIATION_ENTRY_CONFLICT")) status = "REVIEW_REQUIRED";
      else if (appliedChange) status = "OVERRIDE_APPLIED";
      else status = "CLEAN";
    }
    outSegments.push({
      segmentId: rec.seg.segmentId,
      sourceTextHash: rec.sourceTextHash,
      matchedEntries: matched,
      compiledInputHash: res && res.ok ? costShared.hash16(rec.compiled.compiledText) : null,
      runtimeGraphemeHash: res && res.ok ? costShared.hash16(res.graphemes.join("\n")) : null,
      runtimePhonemeHash: res && res.ok ? costShared.hash16(res.phonemes.join("\n")) : null,
      issues: rec.issues,
      status,
    });
  }

  const doc = {
    schemaVersion: PASS_SCHEMA_VERSION,
    pronunciationPassId: passId,
    version: 1,
    projectId,
    scriptRef: { scriptArtifactId: script.scriptArtifactId, scriptVersion: script.scriptVersion },
    voiceBibleRef: input.voiceBibleRef,
    profileRef: profile.pronunciationProfileId,
    provider,
    providerModel,
    providerLanguageCode: kokoroPhonemize.kokoroLangCode(language),
    runtimeMode: "QUIET_PHONEMIZATION",
    language,
    segments: outSegments,
    provenance: { source: "phase-2.3-runtime-pass", createdAt: nowIso(opts.now), runtimeEvidenceRef: opts.runtimeEvidenceRef || null, evidenceRefs: opts.evidenceRefs || [] },
    fingerprint: null,
  };
  doc.fingerprint = fingerprintOf(doc);
  try {
    fs.mkdirSync(path.join(root, "projects", projectId, PASS_DIR_REL), { recursive: true });
    const tmp = `${existingRel}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, existingRel);
  } catch (e) {
    return { ok: false, code: "PRONUNCIATION_PASS_INVALID", message: `persist failed: ${String((e && e.message) || e)}` };
  }
  emitPronEvent(root, projectId, "PRONUNCIATION_RUNTIME_VALIDATED", { correlationId: passId, stateTo: "VALIDATED", provider, model: providerModel, attributes: { segmentCount: outSegments.length, reviewRequired: outSegments.filter((s) => s.status === "REVIEW_REQUIRED").length, overrideApplied: outSegments.filter((s) => s.status === "OVERRIDE_APPLIED").length } }, opts);
  for (const s of outSegments.filter((x) => x.status === "REVIEW_REQUIRED")) {
    emitPronEvent(root, projectId, "PRONUNCIATION_REVIEW_REQUIRED", { correlationId: passId, severity: "WARN", stateTo: "REVIEW_REQUIRED", attributes: { segmentId: s.segmentId, issueCodes: s.issues.map((i) => i.code).join("|") } }, opts);
  }
  return { ok: true, pass: doc, rel: `${PASS_DIR_REL}/${passId}.json` };
}

function loadPronunciationPass(root, projectId, passId) {
  const p = path.join(root, "projects", projectId, PASS_DIR_REL, `${passId}.json`);
  if (!fs.existsSync(p)) return { ok: false, code: "PRONUNCIATION_PASS_NOT_FOUND", message: `${ERRORS.PRONUNCIATION_PASS_NOT_FOUND}: ${passId}` };
  try {
    return { ok: true, pass: JSON.parse(fs.readFileSync(p, "utf8")), rel: `${PASS_DIR_REL}/${passId}.json` };
  } catch (e) {
    return { ok: false, code: "PRONUNCIATION_PASS_INVALID", message: String((e && e.message) || e) };
  }
}

// ---------------------------------------------------------------------------
// Localized invalidation (§17) — exactly the consuming segments, never all
// ---------------------------------------------------------------------------

/**
 * Machine-readable invalidation plan for one changed pronunciation entry.
 * Uses the LAST runtime pass as the consumer map; no TTS/audio nodes are
 * fabricated (future downstream target is the VOICE segment layer, Phase 2.4).
 */
function planInvalidation(root, projectId, { passId, changedEntryId, reason }) {
  const loaded = loadPronunciationPass(root, projectId, passId);
  if (!loaded.ok) return loaded;
  const pass = loaded.pass;
  const profile = loadPronunciationProfile(root, projectId, pass.profileRef);
  if (!profile.ok) return profile;
  const changed = (profile.profile.entries || []).find((e) => e.entryId === changedEntryId);
  if (!changed) {
    return { ok: false, code: "PRONUNCIATION_CHANGED_ENTRY_UNKNOWN", message: `${ERRORS.PRONUNCIATION_CHANGED_ENTRY_UNKNOWN}: ${changedEntryId}` };
  }
  const affected = [];
  const unaffected = [];
  for (const seg of pass.segments) {
    if ((seg.matchedEntries || []).some((m) => m.entryId === changedEntryId)) affected.push(seg.segmentId);
    else unaffected.push(seg.segmentId);
  }
  const plan = {
    invalidationPlanId: costShared.id12("pinv", { passId, changedEntryId, profileRef: pass.profileRef }),
    changedEntryId,
    normalizedTerm: changed.normalizedTerm,
    displayTerm: changed.displayTerm,
    profileRef: pass.profileRef,
    passRef: pass.pronunciationPassId,
    scriptRef: pass.scriptRef,
    affectedSegmentIds: affected,
    unaffectedSegmentIds: unaffected,
    futureDownstreamTarget: "VOICE",
    reason: reason || null,
    createdAt: nowIso(),
    fingerprint: null,
  };
  plan.fingerprint = costShared.hash16({ ...plan, fingerprint: null });
  emitPronEvent(root, projectId, "PRONUNCIATION_INVALIDATION_PLANNED", { correlationId: plan.invalidationPlanId, stateTo: "PLANNED", attributes: { changedEntryId, affectedCount: affected.length, unaffectedCount: unaffected.length, passId } }, {});
  return { ok: true, plan };
}

// ---------------------------------------------------------------------------
// Integration: Manifest index + DAG (only real artifact types)
// ---------------------------------------------------------------------------

function emitPronEvent(root, projectId, eventName, fields = {}, opts = {}) {
  try {
    const r = telemetryLib.recordEvent(root, projectId, {
      eventName,
      severity: fields.severity || "INFO",
      stage: "phase-2.3",
      component: "pronunciation",
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

function attachManifestReference(root, projectId, what, id, opts = {}) {
  const keyMap = {
    profile: ["pronunciationProfileVersion", (p) => `v${p.version} ${p.entries.length} entries`, () => latestPronunciationProfile(root, projectId)],
    pass: ["pronunciationRuntimePassVersion", (p) => `v${p.version} ${p.provider}/${p.providerModel}`, () => loadPronunciationPass(root, projectId, id)],
  };
  const [key, detailOf, loader] = keyMap[what];
  const loaded = loader();
  if (!loaded.ok) return loaded;
  const doc = loaded.profile || loaded.pass;
  const statuses = doc.segments ? doc.segments.map((s) => s.status) : null;
  const blocked = statuses && (statuses.includes("FAILED") || statuses.includes("REVIEW_REQUIRED"));
  const ref = {
    version: doc.pronunciationProfileId || doc.pronunciationPassId,
    status: blocked ? "UNRESOLVED" : "VERIFIED",
    ref: loaded.rel,
    detail: detailOf(doc) + (statuses ? ` statuses=${statuses.join(",")}` : ""),
  };
  const r = manifestLib.setArtifactVersion(root, projectId, key, ref, opts);
  if (!r.ok) return r;
  return { ok: true, manifestStatus: ref.status };
}

/**
 * DAG: register the real Phase 2.3 nodes and ONLY real dependencies:
 * PRONUNCIATION_PROFILE → PRONUNCIATION_RUNTIME_PASS ← FINAL_SPOKEN_SCRIPT.
 * No future audio/alignment/caption nodes are created here.
 */
function registerDagNodes(root, projectId, { profileId, passId }, opts = {}) {
  const dagNow = dagLib.loadDag(root, projectId);
  if (!dagNow.ok && dagNow.code !== "DAG_NOT_FOUND") return dagNow;
  const added = [];
  const ensureNode = (artifactKey, artifactType, versionRef, deps, producedBy) => {
    const cur = dagLib.loadDag(root, projectId);
    if (!cur.ok) return cur;
    if (cur.dag.nodes[artifactKey]) {
      // A newer immutable version exists: advance the versionRef (never rewrite history).
      if (cur.dag.nodes[artifactKey].versionRef !== versionRef) {
        const v = dagLib.setNodeVersion(root, projectId, artifactKey, versionRef, opts);
        if (!v.ok) return v;
        added.push(`${artifactKey}.version`);
        const s = dagLib.setNodeState(root, projectId, artifactKey, "CLEAN", opts);
        if (!s.ok) return s;
      } else if (cur.dag.nodes[artifactKey].state !== "CLEAN") {
        // Re-registration of the current validated artifact converges to CLEAN.
        const s = dagLib.setNodeState(root, projectId, artifactKey, "CLEAN", opts);
        if (!s.ok) return s;
        added.push(`${artifactKey}.state=CLEAN`);
      }
      return { ok: true };
    }
    const n = dagLib.addNode(root, projectId, {
      artifactKey,
      artifactType,
      versionRef,
      state: "CLEAN",
      producedBy,
      provenance: "LIVE",
      inputRefs: deps.map(([key, type]) => ({ key, type })),
    }, opts);
    return n;
  };
  if (profileId) {
    const n = ensureNode("PRONUNCIATION_PROFILE", "PRONUNCIATION_PROFILE", profileId, [], "phase-2.3:pronunciation");
    if (!n.ok) return n;
    added.push("PRONUNCIATION_PROFILE");
  }
  if (passId) {
    const pass = loadPronunciationPass(root, projectId, passId);
    if (!pass.ok) return pass;
    const deps = [["FINAL_SPOKEN_SCRIPT", "SPOKEN_TEXT"], ["PRONUNCIATION_PROFILE", "PRONUNCIATION_READINGS"]];
    const n = ensureNode("PRONUNCIATION_RUNTIME_PASS", "PRONUNCIATION_RUNTIME_PASS", passId, deps, "phase-2.3:pronunciation");
    if (!n.ok) return n;
    added.push("PRONUNCIATION_RUNTIME_PASS");
  }
  return { ok: true, added };
}

module.exports = {
  ERRORS,
  CATEGORIES,
  NOTATIONS,
  ACRONYM_MODES,
  SOURCES,
  QUALITIES,
  SCOPE_LEVELS,
  SCOPE_PRECEDENCE,
  PROFILE_DIR_REL,
  PASS_DIR_REL,
  normalizeTerm,
  validateEntry,
  validatePronunciationProfile,
  createPronunciationProfile,
  revisePronunciationProfile,
  loadPronunciationProfile,
  listPronunciationProfiles,
  latestPronunciationProfile,
  resolveTermOverride,
  resolveSegmentEntries,
  detectCandidates,
  candidateStats,
  runPronunciationPass,
  loadPronunciationPass,
  planInvalidation,
  attachManifestReference,
  registerDagNodes,
  emitPronEvent,
  segmentHash,
};
