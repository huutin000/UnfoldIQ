"use strict";

/**
 * UNFOLDIQ Creative Memory runtime (1G.2, Prompt 01).
 *
 * ONE canonical owner for creative-history / anti-repetition. Advisory only:
 * it remembers USED/APPROVED/AVOID/REPEATED creative signals derived from
 * artifacts that already exist (Creative Brief, Narrative Brief, Story Draft)
 * and informs the NEXT Creative Brief / editorial strategy.
 *
 * Hard boundaries:
 * - NOT evidence: never becomes a claim, citation, source, or Pack verdict.
 * - NOT topics: Topic Registry stays canonical (memory only refs topicRef).
 * - NOT current intent: Creative Brief stays canonical (explicit input wins).
 * - Data, not instructions: retrieved memory text is untrusted context.
 *
 * Deterministic: same canonical inputs → same fingerprint/hash/repetition
 * result (timestamps and usage metadata excepted).
 *
 * Persistence: projects/creative-memory/records/<memoryId>.json via the
 * atomic artifact store. Records store IDs/hashes/refs, never artifact
 * bodies, never provider prompts, never research source bodies.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const { stableStringify } = require("../providers/runtime/request-fingerprint.js");
const artifactStore = require("../providers/runtime/artifact-store.js");

const MEMORY_VERSION = "1.0.0";
const MEMORY_PROJECT = "creative-memory";
const RECORDS_REL = "records";

const SCOPES = ["CHANNEL", "NICHE", "PLATFORM", "PROJECT"];
const STATUSES = ["DRAFT", "REVIEWED", "APPROVED", "REJECTED", "SUPERSEDED"];
/** Only these statuses are eligible for retrieval / promotion (§16). */
const DURABLE_STATUSES = ["APPROVED"];
const CONTENT_CLASSES = ["FACTUAL", "FICTION", "HYBRID"];
const PLATFORMS = ["youtube", "tiktok"];

const DIMENSIONS = [
  "openingPattern",
  "narrativeShape",
  "viewerPromisePattern",
  "transitionPatterns",
  "rhetoricalPatterns",
  "phrasePatterns",
];

// Context budget (§19): advisory memory must stay compact.
const LIMITS = {
  maxRecords: 8,
  maxPhraseExamples: 6,
  maxAvoidSignals: 10,
  maxSerializedChars: 4000,
  fingerprintDimLimit: { transitions: 8, rhetorical: 8, phrases: 12 },
};

const REPETITION = {
  OK: "REPETITION_OK",
  WARNING: "REPETITION_WARNING",
  HIGH: "HIGH_TEMPLATE_REUSE",
};

/** Secret-like strings never enter memory records (§32). */
const SECRET_PATTERN = /(api[_-]?key|apikey|bearer\s|authorization|cookie|password|secret|sk-[a-z0-9]{8,}|-----begin [a-z ]*private key-----|eyJ[a-z0-9_-]{10,}\.|\.env\b)/i;

function containsSecretLike(value) {
  if (typeof value === "string") return SECRET_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsSecretLike);
  if (value && typeof value === "object") return Object.values(value).some(containsSecretLike);
  return false;
}

// ---------------------------------------------------------------------------
// Deterministic normalization / fingerprint builder (§14, §15, §30)

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[0-9]+/g, "#")
    .replace(/[^a-z#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstSentence(text) {
  const m = String(text || "").match(/^[^.!?]+[.!?]?/);
  return m ? m[0] : String(text || "");
}

function headWords(text, n) {
  return normalizeText(text).split(" ").filter(Boolean).slice(0, n).join(" ");
}

function tailWords(text, n) {
  const w = normalizeText(text).split(" ").filter(Boolean);
  return w.slice(Math.max(0, w.length - n)).join(" ");
}

function shingles(text, n) {
  const w = normalizeText(text).split(" ").filter(Boolean);
  const out = [];
  for (let i = 0; i + n <= w.length; i++) out.push(w.slice(i, i + n).join(" "));
  return out;
}

function dedupeBounded(items, limit) {
  return [...new Set(items.filter(Boolean))].slice(0, limit);
}

/**
 * Build a bounded creative fingerprint from EXISTING artifacts.
 * Reads nothing secret, infers no factual truth, mutates nothing.
 * Input: { creativeBrief?, narrativeBrief?, storyDraft?, topicRef? }
 */
function buildCreativeFingerprint(input = {}) {
  const brief = input.narrativeBrief || null;
  const draft = input.storyDraft || null;
  const creativeBrief = input.creativeBrief || null;
  if (!draft || !Array.isArray(draft.sections) || draft.sections.length === 0) {
    return { ok: false, code: "FINGERPRINT_SOURCE_INVALID", message: "storyDraft with sections is required" };
  }

  const texts = draft.sections.map((s) => s.draftText || "").filter((t) => t.trim());
  if (texts.length === 0) {
    return { ok: false, code: "FINGERPRINT_SOURCE_INVALID", message: "storyDraft has no non-empty sections" };
  }

  const openingPattern = headWords(firstSentence(texts[0]), 12);

  const narrativeShape = draft.sections
    .map((s) => s.storyFunction || s.sectionId)
    .join(">");

  const viewerPromise = (creativeBrief && creativeBrief.viewerPromise) ||
    (brief && brief.viewerPromise) || null;

  // Transition classes: how each following section opens (first 5 words).
  const transitionPatterns = texts.slice(1).map((t) => headWords(t, 5));

  // Rhetorical constructions: how each section opens (first 6 words).
  const rhetoricalPatterns = texts.map((t) => headWords(t, 6));

  // Phrase signatures: 5-word shingles repeated within the draft, plus each
  // section-opening 5-gram; bounded. Exact-match base for repetition checks.
  const freq = new Map();
  for (const gram of texts.flatMap((t) => shingles(t, 5))) {
    freq.set(gram, (freq.get(gram) || 0) + 1);
  }
  const phrasePatterns = [
    ...texts.map((t) => shingles(firstSentence(t), 5)).flat(),
    ...[...freq.entries()].filter(([, n]) => n >= 2).map(([g]) => g),
  ];

  const fingerprint = {
    openingPattern,
    narrativeShape,
    viewerPromisePattern: viewerPromise ? normalizeText(viewerPromise) : null,
    transitionPatterns: dedupeBounded(transitionPatterns, LIMITS.fingerprintDimLimit.transitions),
    rhetoricalPatterns: dedupeBounded(rhetoricalPatterns, LIMITS.fingerprintDimLimit.rhetorical),
    phrasePatterns: dedupeBounded(phrasePatterns, LIMITS.fingerprintDimLimit.phrases),
  };
  const fingerprintHash = crypto.createHash("sha256")
    .update(stableStringify(fingerprint), "utf8").digest("hex").slice(0, 16);
  return { ok: true, fingerprint, fingerprintHash };
}

// ---------------------------------------------------------------------------
// Records / persistence (§9, §27, §31)

function schemaValidate(record) {
  const schemaPath = path.join(__dirname, "..", "schemas", "creative-memory.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8").replace(/^\uFEFF/, ""));
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv.compile(schema)(record);
}

function recordFilePath(root, memoryId) {
  if (!/^cm-[0-9a-f]{12}$/.test(String(memoryId || ""))) {
    throw new Error("INVALID_MEMORY_ID");
  }
  return path.join(root, "projects", MEMORY_PROJECT, RECORDS_REL, `${memoryId}.json`);
}

function recordsDir(root) {
  return path.join(root, "projects", MEMORY_PROJECT, RECORDS_REL);
}

/**
 * Create a record object. Identity is stable: scope + identity fields +
 * fingerprintHash + topicRef (same canonical inputs → same memoryId).
 */
function newMemoryRecord(input = {}) {
  const scope = input.scope;
  if (!SCOPES.includes(scope)) {
    return { ok: false, code: "INVALID_SCOPE", message: `scope must be ${SCOPES.join("|")}` };
  }
  if (!CONTENT_CLASSES.includes(input.contentClass)) {
    return { ok: false, code: "INVALID_CONTENT_CLASS", message: "contentClass must be FACTUAL|FICTION|HYBRID" };
  }
  if (input.platform !== null && input.platform !== undefined && !PLATFORMS.includes(input.platform)) {
    return { ok: false, code: "INVALID_PLATFORM", message: "platform must be youtube|tiktok|null" };
  }
  const fp = input.fingerprint && input.fingerprintHash
    ? { ok: true, fingerprint: input.fingerprint, fingerprintHash: input.fingerprintHash }
    : buildCreativeFingerprint(input);
  if (!fp.ok) return fp;

  const identity = {
    scope,
    channelId: input.channelId || null,
    nicheId: input.nicheId || null,
    platform: input.platform || null,
    projectId: scope === "PROJECT" ? (input.projectId || null) : null,
    topicRef: input.topicRef || null,
    contentClass: input.contentClass,
    fingerprintHash: fp.fingerprintHash,
  };
  const now = input.now || new Date().toISOString();
  const memoryId = `cm-${crypto.createHash("sha256")
    .update(stableStringify(identity), "utf8").digest("hex").slice(0, 12)}`;

  const record = {
    version: MEMORY_VERSION,
    memoryId,
    scope,
    channelId: identity.channelId,
    nicheId: identity.nicheId,
    platform: identity.platform,
    projectId: identity.projectId,
    topicRef: identity.topicRef,
    contentClass: identity.contentClass,
    status: STATUSES.includes(input.status) ? input.status : "DRAFT",
    fingerprint: fp.fingerprint,
    fingerprintHash: fp.fingerprintHash,
    approvedSignals: (input.approvedSignals || []).slice(0, 20),
    avoidSignals: (input.avoidSignals || []).slice(0, 20),
    sourceArtifactRefs: {
      projectId: input.sourceArtifactRefs && input.sourceArtifactRefs.projectId || input.projectId || null,
      creativeBriefRef: (input.sourceArtifactRefs && input.sourceArtifactRefs.creativeBriefRef) || null,
      narrativeBriefRef: (input.sourceArtifactRefs && input.sourceArtifactRefs.narrativeBriefRef) || null,
      storyDraftRef: (input.sourceArtifactRefs && input.sourceArtifactRefs.storyDraftRef) || null,
    },
    promotedFrom: input.promotedFrom || null,
    supersedeReason: null,
    useCount: 0,
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  };
  if (containsSecretLike({
    f: fp.fingerprint,
    a: record.approvedSignals,
    v: record.avoidSignals,
    refs: record.sourceArtifactRefs,
  })) {
    return { ok: false, code: "MEMORY_SECRET_SUSPECTED", message: "record contains secret-like content; memory never stores credentials" };
  }
  if (!schemaValidate(record)) {
    return { ok: false, code: "MEMORY_RECORD_INVALID", message: "record failed creative-memory schema validation" };
  }
  return { ok: true, record };
}

/**
 * Persist a record atomically. Idempotent: an existing record with the same
 * memoryId and fingerprintHash is updated in place (usage metadata only,
 * unless fields changed) — never duplicated, never truncated.
 */
function saveCreativeMemory(root, record, opts = {}) {
  if (!record || !record.memoryId || !schemaValidate(record)) {
    return { ok: false, code: "MEMORY_RECORD_INVALID", message: "record failed schema validation" };
  }
  const existing = loadCreativeMemory(root, record.memoryId);
  const now = opts.now || new Date().toISOString();
  const next = { ...record };
  if (existing.ok && existing.record) {
    if (existing.record.fingerprintHash !== record.fingerprintHash) {
      return { ok: false, code: "MEMORY_IDENTITY_CONFLICT", message: "same memoryId with different fingerprint" };
    }
    next.useCount = (existing.record.useCount || 0) + (opts.markUsed ? 1 : 0);
    next.createdAt = existing.record.createdAt;
    next.lastUsedAt = opts.markUsed ? now : existing.record.lastUsedAt;
  } else {
    next.useCount = opts.markUsed ? 1 : 0;
    next.lastUsedAt = opts.markUsed ? now : next.lastUsedAt;
  }
  next.updatedAt = now;
  const rel = `${RECORDS_REL}/${next.memoryId}.json`;
  const written = artifactStore.writeArtifactAtomic(root, MEMORY_PROJECT, rel, JSON.stringify(next, null, 2));
  if (!written) return { ok: false, code: "MEMORY_PERSIST_FAILED", message: "atomic write failed" };
  return { ok: true, memoryId: next.memoryId, path: `projects/${MEMORY_PROJECT}/${rel}`, created: !(existing.ok && existing.record), record: next };
}

function loadCreativeMemory(root, memoryId) {
  try {
    const p = recordFilePath(root, memoryId);
    if (!fs.existsSync(p)) return { ok: true, record: null };
    return { ok: true, record: JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch (e) {
    return { ok: false, code: "MEMORY_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

function listCreativeMemory(root, filter = {}) {
  const dir = recordsDir(root);
  if (!fs.existsSync(dir)) return { ok: true, records: [] };
  const records = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      records.push(r);
    } catch { /* corrupt record files are skipped, never crash retrieval */ }
  }
  const match = (r) =>
    (!filter.scope || r.scope === filter.scope) &&
    (!filter.channelId || r.channelId === filter.channelId) &&
    (!filter.nicheId || r.nicheId === filter.nicheId) &&
    (!filter.platform || r.platform === filter.platform) &&
    (!filter.projectId || r.projectId === filter.projectId) &&
    (!filter.contentClass || r.contentClass === filter.contentClass) &&
    (!filter.status || r.status === filter.status);
  return { ok: true, records: records.filter(match) };
}

// ---------------------------------------------------------------------------
// Ingestion lifecycle + promotion (§16, §17)

/**
 * Ingest one fingerprint as durable/reviewable memory. Lifecycle:
 * DRAFT/REVIEWED records are stored but NOT retrievable; only APPROVED
 * (or explicitly status-approved) records become durable channel/niche
 * memory. Rejected work must not be ingested at all.
 */
function ingestCreativeMemory(root, input = {}) {
  const status = input.status || "APPROVED";
  if (status === "REJECTED") {
    return { ok: false, code: "REJECTED_NOT_INGESTED", message: "rejected drafts never become reusable memory" };
  }
  if (!STATUSES.includes(status)) {
    return { ok: false, code: "INVALID_STATUS", message: `status must be ${STATUSES.join("|")}` };
  }
  const built = newMemoryRecord({ ...input, status });
  if (!built.ok) return built;
  return saveCreativeMemory(root, built.record, { markUsed: !!input.markUsed, now: input.now });
}

/**
 * Explicit promotion (§17): PROJECT memory is never automatically global.
 * Only durable (APPROVED) records may be promoted to a wider scope.
 */
function promoteCreativeMemory(root, memoryId, toScope, opts = {}) {
  const loaded = loadCreativeMemory(root, memoryId);
  if (!loaded.ok || !loaded.record) {
    return { ok: false, code: "MEMORY_NOT_FOUND", message: `no record ${memoryId}` };
  }
  const src = loaded.record;
  if (!DURABLE_STATUSES.includes(src.status)) {
    return { ok: false, code: "NOT_DURABLE", message: `status ${src.status} is not eligible for promotion` };
  }
  if (!SCOPES.includes(toScope)) {
    return { ok: false, code: "INVALID_SCOPE", message: `target scope must be ${SCOPES.join("|")}` };
  }
  if (src.scope === "PROJECT" && toScope !== "PROJECT" && src.projectId && !opts.approved) {
    return { ok: false, code: "PROMOTION_NOT_APPROVED", message: "project→wider scope promotion requires explicit approval" };
  }
  const promoted = newMemoryRecord({
    scope: toScope,
    channelId: opts.channelId !== undefined ? opts.channelId : src.channelId,
    nicheId: opts.nicheId !== undefined ? opts.nicheId : src.nicheId,
    platform: opts.platform !== undefined ? opts.platform : src.platform,
    projectId: toScope === "PROJECT" ? src.projectId : null,
    topicRef: null,
    contentClass: src.contentClass,
    status: "APPROVED",
    fingerprint: src.fingerprint,
    fingerprintHash: src.fingerprintHash,
    approvedSignals: src.approvedSignals,
    avoidSignals: src.avoidSignals,
    sourceArtifactRefs: src.sourceArtifactRefs,
    promotedFrom: src.memoryId,
    now: opts.now,
  });
  if (!promoted.ok) return promoted;
  const saved = saveCreativeMemory(root, promoted.record, { now: opts.now });
  if (saved.ok) {
    src.updatedAt = opts.now || new Date().toISOString();
    artifactStore.writeArtifactAtomic(root, MEMORY_PROJECT, `${RECORDS_REL}/${src.memoryId}.json`, JSON.stringify(src, null, 2));
  }
  return saved;
}

// ---------------------------------------------------------------------------
// Retrieval + context budget (§8, §18, §19)

/** Retrieval precedence: channel+niche+platform > channel+niche > channel. */
function queryCreativeMemory(root, input = {}) {
  const durable = listCreativeMemory(root, { status: "APPROVED" });
  if (!durable.ok) return durable;
  const byId = new Map();
  const addAll = (rs) => { for (const r of rs) if (!byId.has(r.memoryId)) byId.set(r.memoryId, r); };
  const chan = input.channelId || null;
  const niche = input.nicheId || null;
  const plat = input.platform || null;
  const notProject = (r) => r.scope !== "PROJECT";
  if (chan) {
    if (niche && plat) {
      addAll(durable.records.filter((r) => notProject(r) && r.channelId === chan && r.nicheId === niche && r.platform === plat));
    }
    if (niche) {
      addAll(durable.records.filter((r) => notProject(r) && r.channelId === chan && r.nicheId === niche && !r.platform));
      addAll(durable.records.filter((r) => r.scope === "NICHE" && r.channelId === chan && r.nicheId === niche && (!r.platform || r.platform === plat)));
    }
    if (plat) {
      addAll(durable.records.filter((r) => r.scope === "PLATFORM" && r.channelId === chan && r.platform === plat));
    }
    addAll(durable.records.filter((r) => r.scope === "CHANNEL" && r.channelId === chan));
  }
  // PROJECT scope memory never leaks across projects (§8, §12).
  if (input.projectId) {
    addAll(durable.records.filter((r) => r.scope === "PROJECT" && r.projectId === input.projectId));
  }
  // Recent first; useCount/lastUsedAt affect priority, never truth (§25).
  const records = [...byId.values()]
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))
    .slice(0, LIMITS.maxRecords);
  const approvedSignals = dedupeBounded(records.flatMap((r) => r.approvedSignals), LIMITS.maxPhraseExamples * 2);
  const avoidSignals = dedupeBounded(records.flatMap((r) => r.avoidSignals), LIMITS.maxAvoidSignals);
  const recentFingerprints = records.map((r) => ({
    memoryId: r.memoryId,
    scope: r.scope,
    contentClass: r.contentClass,
    fingerprintHash: r.fingerprintHash,
    openingPattern: r.fingerprint.openingPattern,
    narrativeShape: r.fingerprint.narrativeShape,
  }));
  return { ok: true, records, approvedSignals, avoidSignals, recentFingerprints, limits: LIMITS };
}

/** Bounded advisory context for prompt assembly (never a full-history dump). */
function getCreativeMemoryContext(root, input = {}) {
  const q = queryCreativeMemory(root, input);
  if (!q.ok) return q;
  const context = {
    version: MEMORY_VERSION,
    advisoryOnly: true,
    approvedSignals: q.approvedSignals,
    avoidSignals: q.avoidSignals,
    recentFingerprints: q.recentFingerprints,
    repetitionWarnings: [],
    limits: LIMITS,
  };
  let serialized = stableStringify(context);
  while (serialized.length > LIMITS.maxSerializedChars && context.recentFingerprints.length > 0) {
    context.recentFingerprints.pop();
    serialized = stableStringify(context);
  }
  if (serialized.length > LIMITS.maxSerializedChars && context.approvedSignals.length > 0) {
    context.approvedSignals.pop();
    serialized = stableStringify(context);
  }
  context._serializedChars = serialized.length;
  return { ok: true, context };
}

// ---------------------------------------------------------------------------
// Anti-repetition detection (§11, §12, §13) — similarity, deterministic.

function setOverlap(a, b) {
  const sb = new Set(b || []);
  return (a || []).filter((x) => sb.has(x));
}

/**
 * Compare a candidate fingerprint against durable memory. Result is
 * explainable: matched memory IDs, matched dimensions, human-readable
 * reason, and suggested dimensions to vary. Never a mystery scalar.
 */
function checkCreativeRepetition(root, fingerprintOrBuilt, scope = {}) {
  const built = fingerprintOrBuilt && fingerprintOrBuilt.fingerprint
    ? (fingerprintOrBuilt.ok
      ? fingerprintOrBuilt
      : { ok: true, fingerprint: fingerprintOrBuilt.fingerprint, fingerprintHash: fingerprintOrBuilt.fingerprintHash })
    : buildCreativeFingerprint(fingerprintOrBuilt || {});
  if (!built.ok) return built;
  const fingerprint = built.fingerprint;

  const q = queryCreativeMemory(root, {
    channelId: scope.channelId,
    nicheId: scope.nicheId,
    platform: scope.platform,
    projectId: scope.projectId,
  });
  if (!q.ok) return q;

  const warnings = [];
  const isList = (d) => Array.isArray(fingerprint[d]);
  const dimMatch = (d, r) => {
    const mine = fingerprint[d];
    const theirs = r.fingerprint[d];
    if (Array.isArray(mine) || Array.isArray(theirs)) return setOverlap(mine, theirs);
    return (mine && theirs && mine === theirs) ? mine : null;
  };
  for (const r of q.records) {
    if (r.memoryId === scope.excludeMemoryId) continue;
    const matchedDimensions = [];
    const matchedValues = {};
    for (const d of DIMENSIONS) {
      const m = dimMatch(d, r);
      if (m && (!isList(d) || (Array.isArray(m) && m.length > 0))) {
        matchedDimensions.push(d);
        matchedValues[d] = m;
      }
    }
    if (matchedDimensions.length === 0) continue;
    const phraseHits = matchedValues.phrasePatterns ? matchedValues.phrasePatterns.length : 0;
    const nonPhraseDims = matchedDimensions.filter((d) => d !== "phrasePatterns");
    warnings.push({
      matchedMemoryIds: [r.memoryId],
      matchedDimensions,
      matchedValues,
      reason: `creative fingerprint repeats ${matchedDimensions.join(", ")} of memory ${r.memoryId}` +
        (phraseHits > 0 ? ` (${phraseHits} exact phrase signature${phraseHits === 1 ? "" : "s"} recur)` : ""),
      suggestedVariationDimensions: matchedDimensions,
    });
    // Downgrade path: a single exact-phrase overlap alone is weaker evidence
    // than a repeated structural dimension.
    if (nonPhraseDims.length === 0 && phraseHits > 0) {
      warnings[warnings.length - 1].severity = phraseHits >= 3 ? "HIGH" : "WARNING";
    } else {
      warnings[warnings.length - 1].severity =
        nonPhraseDims.length >= 2 || phraseHits >= 3 ? "HIGH" : "WARNING";
    }
  }

  const hasHigh = warnings.some((w) => w.severity === "HIGH");
  const status = warnings.length === 0 ? REPETITION.OK : hasHigh ? REPETITION.HIGH : REPETITION.WARNING;
  return {
    ok: true,
    status,
    warnings,
    checkedAgainst: q.records.map((r) => r.memoryId),
    fingerprintHash: built.fingerprintHash,
  };
}

// ---------------------------------------------------------------------------
// Staleness / lineage (§28)

/**
 * A memory record derived from source artifacts stays valid only while the
 * referenced artifacts are the same versions. Changed source versions never
 * silently inherit the old derived fingerprint.
 */
function isMemoryCurrent(record, currentRefs = {}) {
  const refs = (record && record.sourceArtifactRefs) || {};
  for (const key of ["creativeBriefRef", "narrativeBriefRef", "storyDraftRef"]) {
    const stored = refs[key];
    const current = currentRefs[key];
    if (!stored || !current) continue;
    if (stableStringify(stored) !== stableStringify(current)) {
      return { current: false, reason: `${key} changed since memory was derived` };
    }
  }
  return { current: true };
}

/** Explicit supersede: keep history, remove from durable retrieval. */
function supersedeCreativeMemory(root, memoryId, reason, opts = {}) {
  const loaded = loadCreativeMemory(root, memoryId);
  if (!loaded.ok || !loaded.record) return { ok: false, code: "MEMORY_NOT_FOUND", message: `no record ${memoryId}` };
  const rec = { ...loaded.record, status: "SUPERSEDED", supersedeReason: reason || "superseded" };
  rec.updatedAt = opts.now || new Date().toISOString();
  const written = artifactStore.writeArtifactAtomic(root, MEMORY_PROJECT, `${RECORDS_REL}/${memoryId}.json`, JSON.stringify(rec, null, 2));
  return written ? { ok: true, record: rec } : { ok: false, code: "MEMORY_PERSIST_FAILED" };
}

module.exports = {
  MEMORY_VERSION,
  MEMORY_PROJECT,
  SCOPES,
  STATUSES,
  DURABLE_STATUSES,
  LIMITS,
  REPETITION,
  DIMENSIONS,
  normalizeText,
  buildCreativeFingerprint,
  newMemoryRecord,
  saveCreativeMemory,
  loadCreativeMemory,
  listCreativeMemory,
  ingestCreativeMemory,
  promoteCreativeMemory,
  queryCreativeMemory,
  getCreativeMemoryContext,
  checkCreativeRepetition,
  isMemoryCurrent,
  supersedeCreativeMemory,
  schemaValidate,
};
