"use strict";

/**
 * Phase 2.7-C/D — Approved Local Music Library + Rights/Provenance
 * + Bootstrap Acquisition Brief (UNFOLDIQ CORE).
 *
 * The local library is the canonical V1 production source. LOCAL ≠ PERMANENTLY
 * LICENSED: every record carries fail-closed rights and a per-project usage
 * decision is required before production use. Acquisition is human-in-the-loop:
 * the agent produces a brief, the operator licenses/downloads at official
 * providers; the agent never scrapes licensed-music websites.
 *
 * Storage: assets/music/library-index.json (records) + assets/music/audio/
 * (WAV bytes, content-hash addressed). No secrets are ever stored here.
 */

const Ajv = require("ajv");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const wav = require("../audio-wav.js");

const SCHEMA_VERSION = "1.0.0";
const LIBRARY_INDEX_REL = path.join("assets", "music", "library-index.json");
const LIBRARY_AUDIO_DIR_REL = path.join("assets", "music", "audio");
const RIGHTS_POLICY_VERSION = "music-rights-1.0.0";

const REUSE_SCOPES = ["MULTI_PROJECT", "SINGLE_PROJECT", "CHANNEL_BOUND", "SUBSCRIPTION_BOUND", "UNKNOWN"];
const RIGHTS_STATUS = ["APPROVED", "REVIEW_REQUIRED", "REJECTED"];
const USAGE_DECISIONS = ["APPROVED_FOR_PROJECT", "REVIEW_REQUIRED", "REJECTED"];
const VOCAL_TYPES = ["INSTRUMENTAL", "WORDLESS_VOCAL", "LYRICAL_VOCAL", "UNKNOWN"];

// §3.5 canonical V1 provider priority. REJECT_BY_DEFAULT sources never ingest
// without an explicit operator rights verification record.
const PROVIDER_POLICY = {
  LOCAL_APPROVED_LIBRARY: { priority: 1, productionAllowed: true },
  USER_IMPORTED_LICENSED_ASSET: { priority: 2, productionAllowed: true },
  YOUTUBE_AUDIO_LIBRARY: { priority: 3, productionAllowed: true, note: "manual acquisition; platform scope preserved" },
  AUDIUS: { priority: 4, productionAllowed: true, note: "P1 discovery; NOT auto-trusted for commercial reuse" },
  AI_MUSIC_PROVIDER: { priority: 5, productionAllowed: true, note: "only after commercial/platform rights verified" },
  RANDOM_WEB: { priority: 99, productionAllowed: false },
  YOUTUBE_UPLOAD: { priority: 99, productionAllowed: false },
  UNKNOWN_REPO: { priority: 99, productionAllowed: false },
};

const ERRORS = {
  ASSET_SCHEMA_INVALID: "music asset record fails schema validation",
  ASSET_NOT_WAV: "music asset bytes are not a decodable PCM16 WAV",
  ASSET_DUPLICATE: "identical audio bytes already exist in the library",
  ASSET_NOT_FOUND: "assetId does not exist in the library",
  PROVIDER_NOT_ALLOWED: "sourceType/provider is rejected by policy for ingestion",
  RIGHTS_FAIL_CLOSED: "rights decision failed closed — REVIEW_REQUIRED",
  USAGE_DECISION_FAIL_CLOSED: "usage decision failed closed — REVIEW_REQUIRED",
};

let _assetValidator = null;
function assetValidator() {
  if (!_assetValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "music-asset.schema.json"), "utf8"));
    _assetValidator = ajv.compile(schema);
  }
  return _assetValidator;
}
let _briefValidator = null;
function briefValidator() {
  if (!_briefValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "music-acquisition-brief.schema.json"), "utf8"));
    _briefValidator = ajv.compile(schema);
  }
  return _briefValidator;
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function nowIso() {
  return new Date().toISOString();
}

// ---------- storage ----------

function libraryIndexPath(repoRoot) {
  return path.join(repoRoot, LIBRARY_INDEX_REL);
}

function readLibrary(repoRoot) {
  const p = libraryIndexPath(repoRoot);
  if (!fs.existsSync(p)) return { version: SCHEMA_VERSION, assets: [] };
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function writeLibraryAtomic(repoRoot, library) {
  const p = libraryIndexPath(repoRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(library, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

function libraryAudioPath(repoRoot, assetId) {
  return path.join(repoRoot, LIBRARY_AUDIO_DIR_REL, `${assetId}.wav`);
}

// ---------- rights (fail-closed) ----------

/**
 * Normalize operator-declared rights into a fail-closed MusicRights object.
 * Unknown/missing safety-relevant fields escalate to REVIEW_REQUIRED.
 */
function normalizeRights(input = {}) {
  const rights = {
    provider: input.provider || "UNKNOWN",
    licenseType: input.licenseType || "UNKNOWN",
    commercialUse: input.commercialUse === true,
    monetization: input.monetization === true,
    allowedPlatforms: Array.isArray(input.allowedPlatforms) ? input.allowedPlatforms.slice() : [],
    allowedRegions: Array.isArray(input.allowedRegions) ? input.allowedRegions.slice() : [],
    clientWork: input.clientWork === true,
    paidAds: input.paidAds === true,
    derivativesAllowed: input.derivativesAllowed === true,
    attributionRequired: input.attributionRequired === true,
    attributionText: input.attributionText,
    reuseScope: REUSE_SCOPES.includes(input.reuseScope) ? input.reuseScope : "UNKNOWN",
    validForNewProjectsUntil: input.validForNewProjectsUntil,
    licenseEvidenceRef: input.licenseEvidenceRef || "",
    sourceUrl: input.sourceUrl,
    verifiedAt: nowIso(),
    policyVersion: RIGHTS_POLICY_VERSION,
    status: RIGHTS_STATUS.includes(input.status) ? input.status : "REVIEW_REQUIRED",
  };
  // Fail-closed escalation.
  if (rights.status === "APPROVED") {
    const safe = rights.licenseType !== "UNKNOWN" && rights.reuseScope !== "UNKNOWN" && rights.licenseEvidenceRef !== "";
    if (!safe) rights.status = "REVIEW_REQUIRED";
  }
  if (rights.status === "REJECTED") return { ok: true, rights, escalated: false };
  if (PROVIDER_POLICY[rights.provider] && PROVIDER_POLICY[rights.provider].productionAllowed === false) {
    rights.status = rights.status === "APPROVED" ? "REJECTED" : rights.status;
  }
  return { ok: true, rights, escalated: false };
}

/**
 * Pure project-usage decision (§3.7): is this asset allowed in THIS project,
 * on THIS platform, under THIS commercial context?
 */
function decideUsage(rights, { assetId, projectId, targetPlatforms = [], commercialContext = "STANDARD" }) {
  const decision = {
    assetId: assetId || "",
    projectId: projectId || "",
    targetPlatforms: targetPlatforms.slice(),
    commercialContext,
    decision: "REVIEW_REQUIRED",
    reason: "",
    rightsPolicyVersion: (rights && rights.policyVersion) || RIGHTS_POLICY_VERSION,
    checkedAt: nowIso(),
  };
  if (!rights) {
    decision.reason = "no rights record — fail closed";
    return decision;
  }
  if (rights.status === "REJECTED") {
    decision.decision = "REJECTED";
    decision.reason = "rights status REJECTED — asset must be replaced";
    return decision;
  }
  if (rights.status === "REVIEW_REQUIRED") {
    decision.reason = "rights REVIEW_REQUIRED — cannot enter Final Audio";
    return decision;
  }
  if (rights.reuseScope === "UNKNOWN") {
    decision.reason = "reuseScope UNKNOWN — fail closed";
    return decision;
  }
  const platforms = targetPlatforms.map((p) => String(p).toLowerCase());
  const allowed = (rights.allowedPlatforms || []).map((p) => String(p).toLowerCase());
  if (allowed.length > 0 && !platforms.every((p) => allowed.includes(p))) {
    decision.reason = `platform scope violation: requested [${platforms.join(",")}] not within allowed [${allowed.join(",")}]`;
    return decision;
  }
  if (commercialContext === "COMMERCIAL" && rights.commercialUse !== true) {
    decision.reason = "commercial context requested but rights do not grant commercial use";
    return decision;
  }
  if (commercialContext === "PAID_ADS" && rights.paidAds !== true) {
    decision.reason = "paid-ads context requested but rights do not grant paid ads usage";
    return decision;
  }
  if (rights.validForNewProjectsUntil) {
    const until = new Date(rights.validForNewProjectsUntil);
    if (!Number.isNaN(until.getTime()) && Date.now() > until.getTime()) {
      decision.reason = `rights expired for new projects at ${rights.validForNewProjectsUntil}`;
      return decision;
    }
  }
  decision.decision = "APPROVED_FOR_PROJECT";
  decision.reason = `rights APPROVED (license=${rights.licenseType}, scope=${rights.reuseScope}) and context matches`;
  return decision;
}

// ---------- ingest ----------

/**
 * Ingest a PCM16 WAV music asset into the Approved Local Library.
 * metadata: title, artist?, sourceType (PROVIDER_POLICY key), provider?,
 *           durationMs? (measured, not trusted), genre?, mood?, tags?, bpm?,
 *           energyProfile?, instrumentation?, vocalType
 * rights:   operator-verified rights (normalizeRights applied)
 */
function ingestMusicAsset({ bytes, metadata = {}, rights = {}, repoRoot }) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    return { ok: false, code: "ASSET_NOT_WAV", message: ERRORS.ASSET_NOT_WAV };
  }
  const policy = PROVIDER_POLICY[metadata.sourceType];
  if (!policy || policy.productionAllowed === false) {
    return { ok: false, code: "PROVIDER_NOT_ALLOWED", message: `${ERRORS.PROVIDER_NOT_ALLOWED}: ${metadata.sourceType}` };
  }
  const decoded = wav.decodeWav(bytes);
  if (!decoded.ok) {
    return { ok: false, code: "ASSET_NOT_WAV", message: ERRORS.ASSET_NOT_WAV };
  }
  const hash = sha256Hex(bytes);
  const library = readLibrary(repoRoot);
  const dupe = library.assets.find((a) => a.audioHash === hash);
  if (dupe) {
    return { ok: false, code: "ASSET_DUPLICATE", message: `${ERRORS.ASSET_DUPLICATE}: ${dupe.assetId}` };
  }
  const assetId = `mus-${hash.slice(0, 12)}`;
  const nr = normalizeRights(rights);
  const record = {
    assetId,
    title: metadata.title || `asset-${assetId}`,
    artist: metadata.artist,
    sourceType: metadata.sourceType,
    provider: metadata.provider,
    providerTrackId: metadata.providerTrackId,
    durationMs: Math.round((decoded.samples.length / decoded.sampleRate) * 1000), // measured from real bytes
    genre: metadata.genre || [],
    mood: metadata.mood || [],
    tags: metadata.tags || [],
    bpm: metadata.bpm,
    energyProfile: metadata.energyProfile,
    instrumentation: metadata.instrumentation || [],
    vocalType: VOCAL_TYPES.includes(metadata.vocalType) ? metadata.vocalType : "UNKNOWN",
    audioRef: path.join(LIBRARY_AUDIO_DIR_REL, `${assetId}.wav`).replace(/\\/g, "/"),
    audioHash: hash,
    rights: nr.rights,
    reuseCount: 0,
    createdAt: nowIso(),
  };
  const valid = assetValidator()(record);
  if (!valid) {
    return { ok: false, code: "ASSET_SCHEMA_INVALID", message: ajvText(assetValidator().errors) };
  }
  const audioPath = libraryAudioPath(repoRoot, assetId);
  fs.mkdirSync(path.dirname(audioPath), { recursive: true });
  fs.writeFileSync(audioPath, bytes);
  library.assets.push(record);
  writeLibraryAtomic(repoRoot, library);
  return { ok: true, assetId, record };
}

function getAsset(repoRoot, assetId) {
  return readLibrary(repoRoot).assets.find((a) => a.assetId === assetId) || null;
}

function readAssetBytes(repoRoot, assetId) {
  const rec = getAsset(repoRoot, assetId);
  if (!rec) return null;
  return fs.readFileSync(path.join(repoRoot, rec.audioRef));
}

/** Record a per-project usage decision on the asset record (traceability §11.7). */
function recordUsageDecision(repoRoot, assetId, usageDecision) {
  const library = readLibrary(repoRoot);
  const rec = library.assets.find((a) => a.assetId === assetId);
  if (!rec) return { ok: false, code: "ASSET_NOT_FOUND", message: ERRORS.ASSET_NOT_FOUND };
  if (!USAGE_DECISIONS.includes(usageDecision.decision)) {
    return { ok: false, code: "USAGE_DECISION_FAIL_CLOSED", message: ERRORS.USAGE_DECISION_FAIL_CLOSED };
  }
  rec.usageDecision = usageDecision;
  writeLibraryAtomic(repoRoot, library);
  return { ok: true, record: rec };
}

/** Mark production use (reuse metrics §8). */
function markUsed(repoRoot, assetId) {
  const library = readLibrary(repoRoot);
  const rec = library.assets.find((a) => a.assetId === assetId);
  if (!rec) return { ok: false, code: "ASSET_NOT_FOUND", message: ERRORS.ASSET_NOT_FOUND };
  rec.reuseCount = (rec.reuseCount || 0) + 1;
  rec.lastUsedAt = nowIso();
  writeLibraryAtomic(repoRoot, library);
  return { ok: true, record: rec };
}

// ---------- search / ranking ----------

/**
 * Rank library candidates for one MusicIntent.
 * vocalPolicy compat: INSTRUMENTAL_ONLY excludes LYRICAL_VOCAL;
 * only APPROVED rights records are returned (fail-closed selection).
 */
function searchLibrary(repoRoot, criteria = {}) {
  const library = readLibrary(repoRoot);
  const vocalPolicy = criteria.vocalPolicy || "INSTRUMENTAL_ONLY";
  const candidates = [];
  for (const a of library.assets) {
    if (!a.rights || a.rights.status !== "APPROVED") continue;
    if (vocalPolicy === "INSTRUMENTAL_ONLY" && a.vocalType === "LYRICAL_VOCAL") continue;
    const score = scoreCandidate(a, criteria);
    candidates.push({ asset: a, score, breakdown: score });
  }
  candidates.sort((x, y) => y.score.total - x.score.total);
  return candidates;
}

function scoreCandidate(a, c) {
  const parts = { mood: 0, energy: 0, bpm: 0, duration: 0, vocal: 0, instrumentation: 0 };
  const wantMood = c.mood || [];
  if (wantMood.length) {
    const have = new Set((a.mood || []).map((m) => String(m).toLowerCase()));
    parts.mood = wantMood.filter((m) => have.has(String(m).toLowerCase())).length / wantMood.length;
  }
  if (typeof c.energy === "number" && a.energyProfile) {
    const prof = { LOW: 0.25, MEDIUM: 0.5, HIGH: 0.8 };
    const aEnergy = typeof prof[a.energyProfile] === "number" ? prof[a.energyProfile] : 0.5;
    parts.energy = 1 - Math.abs(aEnergy - c.energy);
  }
  if (a.bpm && c.bpmRange) {
    const inRange = (!c.bpmRange.min || a.bpm >= c.bpmRange.min) && (!c.bpmRange.max || a.bpm <= c.bpmRange.max);
    parts.bpm = inRange ? 1 : 0;
  } else if (!c.bpmRange) {
    parts.bpm = 0.5;
  }
  if (typeof c.durationMs === "number" && a.durationMs) {
    parts.duration = a.durationMs >= c.durationMs ? 1 : Math.max(0, a.durationMs / c.durationMs);
  }
  parts.vocal = c.vocalPolicy === "VOCAL_FEATURED" && a.vocalType === "LYRICAL_VOCAL" ? 1 : 0.5;
  const wantInstr = c.instrumentationPreference || [];
  if (wantInstr.length) {
    const have = new Set((a.instrumentation || []).map((m) => String(m).toLowerCase()));
    parts.instrumentation = wantInstr.filter((m) => have.has(String(m).toLowerCase())).length / wantInstr.length;
  }
  const total = parts.mood * 2 + parts.energy + parts.bpm + parts.duration * 1.5 + parts.vocal * 0.5 + parts.instrumentation;
  return { ...parts, total: Number(total.toFixed(4)) };
}

// ---------- acquisition brief (2.7-D) ----------

function buildAcquisitionBrief({ projectId, needs, operatorInstructions }) {
  const brief = {
    version: SCHEMA_VERSION,
    projectId,
    briefId: `brief-${crypto.randomBytes(4).toString("hex")}`,
    needs: (needs || []).map((n) => ({
      needId: n.needId || `need-${crypto.randomBytes(3).toString("hex")}`,
      narrativeRole: n.narrativeRole || n.purpose || "BED",
      mood: n.mood || [],
      energy: n.energy,
      tension: n.tension,
      bpmRange: n.bpmRange,
      vocalPolicy: n.vocalPolicy || "INSTRUMENTAL_ONLY",
      targetCueDurationMs: n.targetCueDurationMs || 60000,
      instrumentationPreference: n.instrumentationPreference || [],
      providerCandidates: n.providerCandidates || ["YOUTUBE_AUDIO_LIBRARY", "AI_MUSIC_PROVIDER"],
      candidateTracks: n.candidateTracks || [],
      reason: n.reason,
    })),
    operatorInstructions: operatorInstructions ||
      "Acquire at official providers only; verify license scope (commercial/platform/monetization); download license evidence; do NOT scrape licensed-music websites.",
    disallowedSources: ["RANDOM_WEB", "YOUTUBE_UPLOAD", "UNKNOWN_REPO"],
    createdAt: nowIso(),
  };
  const valid = briefValidator()(brief);
  return {
    ok: valid,
    code: valid ? "OK" : "BRIEF_SCHEMA_INVALID",
    message: valid ? undefined : ajvText(briefValidator().errors),
    brief,
  };
}

function ajvText(errors) {
  return (errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

module.exports = {
  SCHEMA_VERSION,
  LIBRARY_INDEX_REL,
  RIGHTS_POLICY_VERSION,
  PROVIDER_POLICY,
  ERRORS,
  normalizeRights,
  decideUsage,
  ingestMusicAsset,
  getAsset,
  readAssetBytes,
  readLibrary,
  recordUsageDecision,
  markUsed,
  searchLibrary,
  buildAcquisitionBrief,
  validateAssetRecord(record) {
    const ok = assetValidator()(record);
    return { ok, errors: ok ? [] : ajvText(assetValidator().errors) };
  },
};
