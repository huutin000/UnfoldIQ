"use strict";

/**
 * PHASE 2.1 — Voice Bible + Narrator Persona (UNFOLDIQ CORE).
 *
 * The canonical, versioned voice identity that every later audio capability
 * consumes WITHOUT hidden agent/session memory:
 *
 *   Final Spoken Script
 *     ↓
 *   [2.1] Voice Bible + Narrator Persona   ← this module
 *     ↓
 *   [2.2] Narration Direction (per segment — NOT here)
 *   [2.3] Pronunciation Runtime Pass (NOT here)
 *   [2.4] TTS + measured Speech Rate QA (NOT here)
 *
 * WHAT THIS MODULE OWNS: provider/model/voiceId identity, narrator persona,
 * language/locale, synthesis speed DEFAULT, bounded prosody/style defaults,
 * emotional range, pronunciation profile REFERENCE, character voice mappings,
 * provenance/rights, immutable version semantics, and the normalized
 * VoiceSelection contract that the Kokoro adapter translates.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN (fail-closed by absence):
 * per-segment emphasis/pause/energy, pronunciation runtime validation, measured
 * words-per-minute, mixing/mastering, forced alignment, captions, synthesis.
 *
 * HONESTY RULES THAT ARE ENFORCED, NOT ADVISED:
 * - A voice selection is never invented. With no provable canonical choice the
 *   bible carries provenance.source = PENDING_OPERATOR and production readiness
 *   stays blocked (isProductionReady).
 * - Rights are never guessed. UNRESOLVED / REVIEW_REQUIRED stays visible and
 *   blocks production readiness (VOICE_RIGHTS_REVIEW_REQUIRED).
 * - speedDefault is a provider rate FACTOR in [0.5,2.0]. A measured wpm value
 *   (e.g. 145) is structurally rejected, so it can never be mistaken for
 *   measured speech rate (that measurement belongs to 2.4).
 * - Language is validated against the provider, never inferred from a voice
 *   name. Mismatch fails closed (VOICE_LANGUAGE_UNSUPPORTED /
 *   VOICE_LOCALE_UNSUPPORTED).
 * - Versions are immutable files. Same semantic content → no bump; meaningful
 *   change → a new voiceBibleId, old versions stay loadable.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");
const costShared = require("../output-cost/shared.js");
const kokoro = require("../../providers/runtime/adapters/local-kokoro.js");
const workspaceLib = require("../workspace/index.js");
const manifestLib = require("../project-manifest/index.js");
const historyLib = require("../generation-history/index.js");
const dagLib = require("../dependency-dag/index.js");
const telemetryLib = require("../telemetry/index.js");

const VOICE_BIBLE_SCHEMA_VERSION = "1.0.0";

// §3/§4: Kokoro is the current V1 synthesis provider. VoiceStudio stays
// POST-V1 / FUTURE EVALUATION — deliberately absent from this catalog, so any
// request for it fails closed with VOICE_PROVIDER_UNSUPPORTED.
const V1_TTS_PROVIDER = kokoro.providerId;
const V1_TTS_MODEL = kokoro.KOKORO_MODEL;

// Lifecycle-at-creation (§20): the schema, an approved version, and migration
// evidence are DURABLE. Test fixtures / provider smoke audio are classified by
// the caller, never here.
const VOICE_BIBLE_LIFECYCLE = "DURABLE";
const VOICE_BIBLE_DIR_REL = "voice/voice-bible";

// Phase 2.1 may validate provider/model/voice/language CONFIGURATION identity.
// Synthesis availability is deliberately NOT probed here: proving the CLI
// exists means running it, and running it means synthesizing (2.4 territory).
const RUNTIME_PROBE_STATUS = "NOT_PROBED";

const ERRORS = {
  VOICE_BIBLE_NOT_FOUND: "no Voice Bible version exists for this project/id",
  VOICE_BIBLE_SCHEMA_INVALID: "Voice Bible fails schema or semantic validation",
  VOICE_BIBLE_VERSION_CONFLICT: "same version already exists with different content, or stale writer",
  VOICE_BIBLE_LOCKED: "approved/locked voice config requires an explicit unlock before revision",
  VOICE_PROVIDER_UNSUPPORTED: "provider is not a configured TTS provider",
  VOICE_MODEL_UNSUPPORTED: "model is not available for this provider",
  VOICE_NOT_FOUND: "voiceId is not a known voice for the selected language",
  VOICE_LANGUAGE_UNSUPPORTED: "provider/model does not support the selected language",
  VOICE_LOCALE_UNSUPPORTED: "locale is incompatible with the selected language",
  VOICE_CONFIGURATION_INVALID: "voice configuration is structurally invalid",
  NARRATOR_PERSONA_INVALID: "narrator persona violates the persona contract",
  CHARACTER_VOICE_CONFLICT: "character voice mapping conflicts with another mapping",
  PRONUNCIATION_PROFILE_INVALID: "pronunciationProfileRef is malformed or self-contradictory",
  VOICE_RIGHTS_REVIEW_REQUIRED: "voice rights or selection approval cannot be proven; production readiness blocked",
  VOICE_BIBLE_WRITE_FAILED: "atomic persist failed; previous version untouched",
  VOICE_BIBLE_PATH_NOT_ALLOWED: "workspace guard refused the Voice Bible path",
  VOICE_BIBLE_LIFECYCLE_INVALID: "Voice Bible must be created DURABLE",
};

let ajvValidator = null;
function validator() {
  if (!ajvValidator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const root = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "voice-bible.schema.json"), "utf8"));
    ajvValidator = ajv.compile(root);
  }
  return ajvValidator;
}

function nowIso(now) {
  return now || new Date().toISOString();
}

function nullIfUndefined(v) {
  return v === undefined ? null : v;
}

function stripUndefined(node) {
  if (Array.isArray(node)) {
    node.forEach(stripUndefined);
  } else if (node && typeof node === "object") {
    for (const k of Object.keys(node)) {
      if (node[k] === undefined) delete node[k];
      else stripUndefined(node[k]);
    }
  }
  return node;
}

function fingerprintOf(doc) {
  const { fingerprint, ...rest } = doc;
  void fingerprint;
  return costShared.hash16(JSON.parse(costShared.stableStringify(rest)));
}

/**
 * §14 version identity. Metadata that must NOT fake a version bump
 * (createdAt, source, approvalRef, the identity of the version itself) is
 * excluded; voice identity, defaults, persona, rights and evidence are NOT
 * (a rights change must never be silently dropped).
 */
function semanticFingerprint(doc) {
  const { voiceBibleId, version, fingerprint, provenance, ...rest } = doc;
  void voiceBibleId; void version; void fingerprint;
  const semantic = {
    ...rest,
    rights: (provenance && provenance.rights) || null,
    evidenceRefs: (provenance && provenance.evidenceRefs) || [],
  };
  return costShared.hash16(JSON.parse(costShared.stableStringify(semantic)));
}

// ---------------------------------------------------------------------------
// Workspace governance (§19/§20) — paths resolve through the registry, guard,
// and lifecycle-at-creation. No ad-hoc root/project concatenation.
// ---------------------------------------------------------------------------

function voiceBibleDir(root, projectId) {
  const resolved = workspaceLib.resolveArtifactPath(root, projectId, "VOICE", VOICE_BIBLE_LIFECYCLE);
  if (!resolved.ok) return resolved;
  return { ok: true, path: path.join(resolved.path, "voice-bible") };
}

function voiceBibleRel(voiceBibleId) {
  return `${VOICE_BIBLE_DIR_REL}/${voiceBibleId}.json`;
}

/** Guard + lifecycle gate. Returns the project-relative path or a refusal. */
function approveVoiceBiblePath(root, projectId, voiceBibleId) {
  const lifecycle = workspaceLib.classifyNewArtifact({ artifactType: "VOICE", lifecycleClass: VOICE_BIBLE_LIFECYCLE });
  if (!lifecycle.ok) return { ok: false, code: "VOICE_BIBLE_LIFECYCLE_INVALID", message: lifecycle.message };
  if (lifecycle.reviewRequired) {
    return { ok: false, code: "VOICE_BIBLE_LIFECYCLE_INVALID", message: "Voice Bible must be explicitly DURABLE, never defaulted" };
  }
  const rel = voiceBibleRel(voiceBibleId);
  const guard = workspaceLib.validateWorkspacePath(root, path.posix.join("projects", projectId, rel), { projectId });
  if (!guard.ok) return { ok: false, code: "VOICE_BIBLE_PATH_NOT_ALLOWED", message: guard.message };
  return { ok: true, rel, lifecycleClass: lifecycle.lifecycleClass };
}

// ---------------------------------------------------------------------------
// Provider contract (§22) — ONE normalized VoiceSelection shape. Kokoro
// specifics stay inside toKokoroRuntimeConfig; Core never sees them.
// ---------------------------------------------------------------------------

function envVoiceOverride() {
  if (!process.env.KOKORO_VOICES) return [];
  return String(process.env.KOKORO_VOICES).split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Voices discovered from the INSTALLED runtime, persisted as license evidence.
 *
 * The adapter's DEFAULT_VOICES table is a per-language resolution default, not
 * an inventory. Treating it as the complete voice list makes any voice the
 * runtime can actually serve (there are 54) look nonexistent, so a legitimate
 * operator-approved narrator is rejected as VOICE_NOT_FOUND. Reading the
 * discovered inventory keeps validation stable in a fresh process with no
 * python probe and no KOKORO_VOICES env override. Absent evidence -> the default
 * table alone, exactly as before.
 */
function runtimeVoiceInventory() {
  try {
    const lic = require("./license.js");
    const loaded = lic.loadLicenseEvidence(path.join(__dirname, "..", ".."), "local-kokoro");
    const inv = loaded.ok && loaded.evidence && Array.isArray(loaded.evidence.runtimeVoiceInventory)
      ? loaded.evidence.runtimeVoiceInventory
      : null;
    const out = {};
    for (const row of inv || []) {
      if (!row || !row.voiceId || !row.language) continue;
      if (!out[row.language]) out[row.language] = [];
      out[row.language].push(row.voiceId);
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * The single provider catalog. Provider-specific fields never spread into
 * Core; adapters are reached only through this descriptor.
 */
function providerCatalog() {
  const discovered = runtimeVoiceInventory();
  const inventoryLangs = Object.keys(discovered);
  return {
    [V1_TTS_PROVIDER]: {
      provider: V1_TTS_PROVIDER,
      models: [V1_TTS_MODEL],
      voiceSource: envVoiceOverride().length > 0
        ? "PROVIDER_DEFAULT+RUNTIME_INVENTORY+ENV_OVERRIDE"
        : (inventoryLangs.length > 0 ? "PROVIDER_DEFAULT+RUNTIME_INVENTORY" : "PROVIDER_DEFAULT"),
      languages: kokoro.SUPPORTED_LANGUAGES.slice(),
      voicesByLanguage: Object.fromEntries(
        kokoro.SUPPORTED_LANGUAGES
          .filter((lang) => Boolean(kokoro.DEFAULT_VOICES[lang]) || (discovered[lang] || []).length > 0)
          .map((lang) => [lang, [...new Set([
            kokoro.DEFAULT_VOICES[lang],
            ...(discovered[lang] || []),
            ...envVoiceOverride(),
          ].filter(Boolean))].sort()]),
      ),
      runtimeProbe: { status: RUNTIME_PROBE_STATUS, reason: "Phase 2.1 validates configuration identity only; synthesis availability belongs to 2.4" },
    },
  };
}

/** Isolated translation of the normalized selection into Kokoro runtime config. */
function toKokoroRuntimeConfig(selection, speedDefault) {
  return {
    capability: "tts",
    provider: V1_TTS_PROVIDER,
    model: selection.model,
    input: {
      text: null,
      voice: selection.voiceId,
      language: selection.providerLanguageCode,
      speed: speedDefault,
    },
    outputRequirements: { format: "wav" },
  };
}

/**
 * Resolve ONE normalized VoiceSelection (provider, model, voiceId, language,
 * options). Fail-closed on provider / model / voice / language / locale. The
 * returned `runtimeConfig` is provider-specific and belongs to the adapter
 * layer only.
 */
function resolveVoiceSelection(input = {}) {
  const catalog = providerCatalog();
  const providerId = input.provider;
  if (typeof providerId !== "string" || !providerId) {
    return { ok: false, code: "VOICE_CONFIGURATION_INVALID", message: `${ERRORS.VOICE_CONFIGURATION_INVALID}: provider is required` };
  }
  const entry = catalog[providerId];
  if (!entry) {
    return { ok: false, code: "VOICE_PROVIDER_UNSUPPORTED", message: `${ERRORS.VOICE_PROVIDER_UNSUPPORTED}: ${providerId} (V1 provider is ${V1_TTS_PROVIDER}; VoiceStudio is POST-V1 and not integrated)` };
  }

  const requestedLanguage = input.language;
  if (typeof requestedLanguage !== "string" || !requestedLanguage) {
    return { ok: false, code: "VOICE_CONFIGURATION_INVALID", message: `${ERRORS.VOICE_CONFIGURATION_INVALID}: language is required and never inferred from the voice name` };
  }
  const language = kokoro.normalizeLanguage(requestedLanguage);
  if (!entry.languages.includes(language)) {
    return { ok: false, code: "VOICE_LANGUAGE_UNSUPPORTED", message: `${ERRORS.VOICE_LANGUAGE_UNSUPPORTED}: ${requestedLanguage} is not supported by ${providerId} (supported: ${entry.languages.join(", ")}); never fallback to another language` };
  }

  if (input.locale) {
    const base = String(input.locale).replace(/_/g, "-").split("-")[0].toLowerCase();
    const normalizedBase = kokoro.normalizeLanguage(base);
    if (normalizedBase !== language) {
      return { ok: false, code: "VOICE_LOCALE_UNSUPPORTED", message: `${ERRORS.VOICE_LOCALE_UNSUPPORTED}: locale ${input.locale} (${normalizedBase}) is incompatible with language ${language}` };
    }
  }

  const model = input.model;
  if (typeof model !== "string" || !model) {
    return { ok: false, code: "VOICE_CONFIGURATION_INVALID", message: `${ERRORS.VOICE_CONFIGURATION_INVALID}: model is required` };
  }
  if (!entry.models.includes(model)) {
    return { ok: false, code: "VOICE_MODEL_UNSUPPORTED", message: `${ERRORS.VOICE_MODEL_UNSUPPORTED}: ${model} (available: ${entry.models.join(", ")})` };
  }

  const voiceId = input.voiceId;
  if (typeof voiceId !== "string" || !voiceId) {
    return { ok: false, code: "VOICE_CONFIGURATION_INVALID", message: `${ERRORS.VOICE_CONFIGURATION_INVALID}: voiceId is required` };
  }
  const known = entry.voicesByLanguage[language] || [];
  if (!known.includes(voiceId)) {
    return { ok: false, code: "VOICE_NOT_FOUND", message: `${ERRORS.VOICE_NOT_FOUND}: ${voiceId} is not a ${language} voice of ${providerId} (known: ${known.join(", ") || "none"})` };
  }

  const options = input.options && typeof input.options === "object" ? { ...input.options } : {};
  const selection = {
    provider: providerId,
    model,
    voiceId,
    language,
    options,
    providerLanguageCode: language,
    voiceSource: entry.voiceSource,
  };
  selection.runtimeConfig = providerId === V1_TTS_PROVIDER
    ? toKokoroRuntimeConfig(selection, input.speedDefault)
    : null;
  return { ok: true, selection };
}

// ---------------------------------------------------------------------------
// Validation (§23) — schema shape first, then cross-field semantics, then
// secrets. Fail closed: every problem is reported, none is coerced.
// ---------------------------------------------------------------------------

function speedDefaultOf(doc) {
  return doc && doc.narrator ? doc.narrator.speedDefault : undefined;
}

function validateVoiceBible(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") {
    return { ok: false, errors: [{ code: "VOICE_BIBLE_SCHEMA_INVALID", message: "Voice Bible must be an object" }] };
  }
  const valid = validator()(doc);
  if (!valid) {
    for (const e of validator().errors || []) {
      errors.push({ code: "VOICE_BIBLE_SCHEMA_INVALID", message: `${e.instancePath || "/"} ${e.message}` });
    }
  }

  const narrator = doc.narrator;

  // §23 identity resolution runs FIRST: an unsupported language or unknown
  // voice is the root cause, and the persona/locale symptom it causes must not
  // mask it.
  if (narrator && narrator.provider && narrator.model && narrator.voiceId) {
    for (const [label, sel] of [
      ["narrator", { provider: narrator.provider, model: narrator.model, voiceId: narrator.voiceId, language: doc.language, locale: doc.locale, speedDefault: narrator.speedDefault }],
      // A character may legitimately speak another language than the delivery
      // locale, so the bible locale constrains the narrator only.
      ...(doc.characterVoices || []).map((cv) => [`character ${cv.speakerId}`, { provider: cv.provider, model: cv.model, voiceId: cv.voiceId, language: cv.language || doc.language }]),
    ]) {
      const r = resolveVoiceSelection(sel);
      if (!r.ok) errors.push({ code: r.code, message: `${label}: ${r.message}` });
    }
  }

  // §6 persona contract: the persona is semantic identity, and the narrator's
  // personaId must actually BE the persona it points at.
  if (narrator && narrator.persona) {
    if (narrator.personaId !== narrator.persona.personaId) {
      errors.push({ code: "NARRATOR_PERSONA_INVALID", message: `narrator.personaId ${narrator.personaId} does not match narrator.persona.personaId ${narrator.persona.personaId}` });
    }
    if (narrator.persona.language !== doc.language) {
      errors.push({ code: "NARRATOR_PERSONA_INVALID", message: `persona.language ${narrator.persona.language} does not match bible language ${doc.language}` });
    }
    // §11: segment direction must not mutate identity — the persona baseline
    // stays inside the emotional range the narrator is allowed to reach.
    const outside = (narrator.persona.emotionalRange || []).filter((e) => !(narrator.emotionalRange || []).includes(e));
    if (outside.length > 0) {
      errors.push({ code: "NARRATOR_PERSONA_INVALID", message: `persona baseline uses emotions outside the narrator range: ${outside.join(", ")}` });
    }
  }

  // §13: speakerIds unique, and a character voice may not claim the narrator's voice.
  const seen = new Set();
  for (const cv of doc.characterVoices || []) {
    if (!cv || !cv.speakerId) continue;
    if (seen.has(cv.speakerId)) {
      errors.push({ code: "CHARACTER_VOICE_CONFLICT", message: `duplicate speakerId ${cv.speakerId}` });
    }
    seen.add(cv.speakerId);
    if (narrator && cv.voiceId === narrator.voiceId && cv.provider === narrator.provider) {
      errors.push({ code: "CHARACTER_VOICE_CONFLICT", message: `character ${cv.speakerId} reuses the narrator voice ${cv.voiceId}` });
    }
  }

  // §12 pronunciation profile is a REFERENCE contract only. Shape is checked
  // by the schema; semantics (a ref, not a bare language code) here.
  if (typeof doc.pronunciationProfileRef === "string" && doc.pronunciationProfileRef && !doc.pronunciationProfileRef.startsWith("pron-")) {
    errors.push({ code: "PRONUNCIATION_PROFILE_INVALID", message: `${ERRORS.PRONUNCIATION_PROFILE_INVALID}: ${doc.pronunciationProfileRef} is not a pron-<slug> reference` });
  }

  // §23/§31 secret safety: never persist provider credentials.
  const secrets = [...manifestLib.findSecretKeys(doc), ...historyLib.findSecretPastes(doc)];
  if (secrets.length > 0) {
    errors.push({ code: "VOICE_BIBLE_SCHEMA_INVALID", message: `secret material must never persist: ${secrets.join(", ")}` });
  }

  if (errors.length === 0 && doc.fingerprint !== fingerprintOf(doc)) {
    errors.push({ code: "VOICE_BIBLE_SCHEMA_INVALID", message: "fingerprint mismatch: mutated outside the canonical write path" });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * FIX 01 — production readiness needs BOTH an operator-approved selection AND
 * every required rights claim proven. Neither alone is sufficient:
 * verified licences do not make an unapproved voice approved, and an operator
 * decision does not manufacture voice-asset rights.
 *
 * FIX 02 — the voice/output pair may additionally be RISK_ACCEPTED under an
 * explicit, versioned operator decision (ACCEPT_RESIDUAL_RIGHTS_RISK). Risk
 * acceptance is never inferred and never relabelled VERIFIED: pass the result
 * of license.isRiskAcceptanceValid() as input.riskAcceptance.
 */
function productionReadinessGate(input = {}) {
  try {
    const lic = require("./license.js");
    if (typeof lic.evaluateProductionReadiness === "function") {
      return lic.evaluateProductionReadiness(input);
    }
  } catch { /* fall through to the strict gate below */ }
  const blockers = [];
  const selectionStatus = input.selectionStatus || "PENDING_OPERATOR";
  if (selectionStatus !== "OPERATOR_APPROVED") {
    blockers.push({
      code: selectionStatus === "PROVIDER_DEFAULT" ? "VOICE_SELECTION_PROVIDER_DEFAULT" : "VOICE_SELECTION_PENDING_OPERATOR",
      detail: `selectionStatus=${selectionStatus} is not an explicit operator approval`,
    });
  }
  const states = input.states || {};
  const need = [
    ["modelLicense", "MODEL_LICENSE_REVIEW_REQUIRED"],
    ["voiceAssetRights", "VOICE_ASSET_RIGHTS_REVIEW_REQUIRED"],
    ["outputUsageStatus", "OUTPUT_USAGE_STATUS_REVIEW_REQUIRED"],
  ];
  for (const [key, code] of need) {
    const s = states[key];
    if (!s || s.status !== "VERIFIED") {
      blockers.push({ code, detail: `${key} is ${s ? s.status : "MISSING"} (not VERIFIED)` });
    }
  }
  return {
    productionReady: blockers.length === 0,
    reviewRequired: blockers.length > 0,
    selectionStatus,
    blockerCodes: blockers.map((b) => b.code),
    blockers: blockers.map((b) => `${b.code}: ${b.detail}`),
  };
}

/**
 * §15/§18/§26 production readiness. A structurally valid bible can still be
 * NOT production-ready: an unapproved selection or unproven rights is a
 * legitimate blocker, and is reported as such instead of being papered over.
 */
function readinessOf(doc, opts = {}) {
  const blockers = [];
  const p = doc.provenance || {};
  const rights = (p.rights || {}).status;
  if (p.source === "PENDING_OPERATOR") {
    blockers.push({ code: "VOICE_SELECTION_PENDING_OPERATOR", detail: "no canonical or operator-approved selection exists for this voice" });
  }
  if (p.source === "PROVIDER_DEFAULT") {
    blockers.push({ code: "VOICE_SELECTION_PROVIDER_DEFAULT", detail: "voice came from the provider per-language default, not an operator decision" });
  }
  if (rights === "UNRESOLVED" || rights === "REVIEW_REQUIRED") {
    blockers.push({ code: "VOICE_RIGHTS_REVIEW_REQUIRED", detail: `rights status is ${rights}` });
  } else if (rights === "RISK_ACCEPTED") {
    // FIX 02: RISK_ACCEPTED is production-eligible ONLY with a valid explicit
    // operator decision. Without proof it stays blocked — never inferred.
    if (opts.rightsDecisionValid !== true) {
      blockers.push({ code: "VOICE_RIGHTS_RISK_ACCEPTANCE_INVALID", detail: "rights status is RISK_ACCEPTED without a valid explicit operator decision" });
    }
  }
  // Rights outrank selection: an unproven license blocks harder than an
  // unapproved pick.
  const rightsBlocker = blockers.find((b) => b.code === "VOICE_RIGHTS_REVIEW_REQUIRED");
  return {
    productionReady: blockers.length === 0,
    reviewRequired: blockers.length > 0,
    code: blockers.length === 0 ? null : (rightsBlocker ? rightsBlocker.code : "VOICE_SELECTION_REVIEW_REQUIRED"),
    blockers: blockers.map((b) => `${b.code}: ${b.detail}`),
    blockerCodes: blockers.map((b) => b.code),
    rightsStatus: rights || null,
    source: p.source || null,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function loadVoiceBible(root, projectId, voiceBibleId) {
  const dir = voiceBibleDir(root, projectId);
  if (!dir.ok) return dir;
  const rel = voiceBibleRel(voiceBibleId);
  let raw;
  try {
    raw = JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8"));
  } catch (e) {
    const missing = e && (e.code === "ENOENT" || /ENOENT/.test(String(e.message || e)));
    return {
      ok: false,
      code: missing ? "VOICE_BIBLE_NOT_FOUND" : "VOICE_BIBLE_SCHEMA_INVALID",
      message: missing ? `${ERRORS.VOICE_BIBLE_NOT_FOUND}: ${voiceBibleId}` : `unparseable Voice Bible: ${String((e && e.message) || e)}`,
    };
  }
  const v = validateVoiceBible(raw);
  if (!v.ok) return { ok: false, code: "VOICE_BIBLE_SCHEMA_INVALID", message: v.errors[0].message, errors: v.errors };
  return { ok: true, voiceBible: raw, readiness: readinessOf(raw) };
}

function listVoiceBibles(root, projectId) {
  const dir = voiceBibleDir(root, projectId);
  if (!dir.ok) return dir;
  if (!fs.existsSync(dir.path)) return { ok: true, voiceBibles: [] };
  const files = fs.readdirSync(dir.path).filter((f) => /^vb-[0-9a-f]{12}\.json$/.test(f)).sort();
  const out = [];
  for (const f of files) {
    const id = f.replace(/\.json$/, "");
    const loaded = loadVoiceBible(root, projectId, id);
    if (!loaded.ok) continue;
    const d = loaded.voiceBible;
    out.push({
      voiceBibleId: d.voiceBibleId,
      version: d.version,
      language: d.language,
      provider: d.narrator.provider,
      model: d.narrator.model,
      voiceId: d.narrator.voiceId,
      personaId: d.narrator.personaId,
      characterVoiceCount: (d.characterVoices || []).length,
      semanticFingerprint: semanticFingerprint(d),
      provenanceSource: d.provenance.source,
      rightsStatus: d.provenance.rights.status,
      productionReady: loaded.readiness.productionReady,
    });
  }
  out.sort((a, b) => a.version - b.version || (a.voiceBibleId < b.voiceBibleId ? -1 : 1));
  return { ok: true, voiceBibles: out };
}

function latestVoiceBible(root, projectId) {
  const listed = listVoiceBibles(root, projectId);
  if (!listed.ok) return listed;
  if (listed.voiceBibles.length === 0) {
    return { ok: false, code: "VOICE_BIBLE_NOT_FOUND", message: `${ERRORS.VOICE_BIBLE_NOT_FOUND} for project ${projectId}` };
  }
  const latest = listed.voiceBibles[listed.voiceBibles.length - 1];
  const loaded = loadVoiceBible(root, projectId, latest.voiceBibleId);
  if (!loaded.ok) return loaded;
  return { ...loaded, summary: latest };
}

/** Shared immutability write. Never overwrites an existing version file. */
function persistVersion(root, projectId, doc) {
  const approved = approveVoiceBiblePath(root, projectId, doc.voiceBibleId);
  if (!approved.ok) return approved;
  if (artifactStore.artifactExists(root, projectId, approved.rel)) {
    return { ok: false, code: "VOICE_BIBLE_VERSION_CONFLICT", message: `${ERRORS.VOICE_BIBLE_VERSION_CONFLICT}: ${doc.voiceBibleId} already exists; versions are immutable` };
  }
  const text = JSON.stringify(doc, null, 2) + "\n";
  JSON.parse(text);
  const v = validateVoiceBible(doc);
  if (!v.ok) return { ok: false, code: v.errors[0].code, message: v.errors[0].message, errors: v.errors };
  try {
    artifactStore.writeArtifactAtomic(root, projectId, approved.rel, text);
  } catch (e) {
    return { ok: false, code: "VOICE_BIBLE_WRITE_FAILED", message: `${ERRORS.VOICE_BIBLE_WRITE_FAILED}: ${String((e && e.message) || e)}` };
  }
  artifactStore.recordFingerprint(root, projectId, approved.rel, semanticFingerprint(doc));
  return { ok: true, rel: approved.rel, lifecycleClass: approved.lifecycleClass };
}

// ---------------------------------------------------------------------------
// Observability (§29) — safe ids/refs only, never credentials. Emission never
// breaks the artifact path.
// ---------------------------------------------------------------------------

function emitVoiceEvent(root, projectId, eventName, fields = {}, opts = {}) {
  try {
    const r = telemetryLib.recordEvent(root, projectId, {
      eventName,
      severity: fields.severity || "INFO",
      stage: "phase-2.1",
      component: "voice-bible",
      correlationId: fields.correlationId || null,
      operationId: fields.voiceBibleId || null,
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

/**
 * 1H.2 lock reader (injected into the DAG, never duplicated): a Voice Bible
 * revision must not silently replace an approved/locked voice config.
 */
function voiceBibleLockReader(root, projectId) {
  return (lockTarget) => {
    if (!lockTarget || lockTarget.targetType !== "VOICE_BIBLE") return null;
    const r = historyLib.checkRerunAllowed(root, projectId, {
      targetType: "VOICE_BIBLE",
      targetId: lockTarget.targetId,
      action: "voice-bible-revise",
    });
    if (!r.ok && r.code === "TARGET_LOCKED") return "LOCKED";
    if (!r.ok && r.code && r.code !== "HISTORY_NOT_FOUND" && r.code !== "NO_HISTORY_STORE") {
      // A history store that cannot answer must never be read as "unlocked".
      return "LOCKED";
    }
    return "UNLOCKED";
  };
}

// ---------------------------------------------------------------------------
// Integration: Manifest index (§15), DAG (§16), History (§17)
// ---------------------------------------------------------------------------

/**
 * The manifest artifact entry for a voice bible. ONE construction site, so the
 * perf probe can never measure (or write) a status that disagrees with the real
 * attach path. Status is honest: an unresolved rights/approval state is
 * UNRESOLVED, never VERIFIED.
 */
function manifestReferenceFor(doc, readiness) {
  const r = readiness || readinessOf(doc);
  return {
    version: doc.voiceBibleId,
    status: r.productionReady ? "VERIFIED" : "UNRESOLVED",
    ref: voiceBibleRel(doc.voiceBibleId),
    detail: r.productionReady
      ? `v${doc.version} ${doc.narrator.provider}/${doc.narrator.voiceId}`
      : `v${doc.version} NOT production-ready: ${r.blockers.join(" | ")}`,
  };
}

/**
 * The Manifest is an INDEX: it records which voice bible version is current,
 * never the bible body.
 */
function attachManifestReference(root, projectId, voiceBibleId, opts = {}) {
  const loaded = loadVoiceBible(root, projectId, voiceBibleId);
  if (!loaded.ok) return loaded;
  // FIX 02: a RISK_ACCEPTED bible carries its decision proof via opts — the
  // load path stays fail-closed (blocked) unless the caller proves validity.
  const readiness = (loaded.voiceBible.provenance.rights.status === "RISK_ACCEPTED" && opts.rightsDecisionValid === true)
    ? readinessOf(loaded.voiceBible, { rightsDecisionValid: true })
    : loaded.readiness;
  const ref = manifestReferenceFor(loaded.voiceBible, readiness);
  const r = manifestLib.setArtifactVersion(root, projectId, "voiceBibleVersion", ref, opts);
  if (!r.ok) return r;
  emitVoiceEvent(root, projectId, "VOICE_SELECTION_RESOLVED", {
    correlationId: voiceBibleId,
    voiceBibleId,
    provider: loaded.voiceBible.narrator.provider,
    model: loaded.voiceBible.narrator.model,
    stateTo: ref.status,
    errorCode: readiness.code,
    attributes: {
      productionReady: readiness.productionReady,
      rightsStatus: readiness.rightsStatus,
      provenanceSource: readiness.source,
      bibleVersion: loaded.voiceBible.version,
    },
  }, opts);
  return { ...r, readiness, manifestStatus: ref.status };
}

/**
 * §16 DAG: register the real VOICE_BIBLE node and only the real dependency
 * VOICE_BIBLE → VOICE (TTS audio). No invented FINAL_AUDIO / narration /
 * caption nodes: 2.1 must not pre-build 2.2+ artifacts.
 */
function registerDagNode(root, projectId, voiceBibleId, opts = {}) {
  const loaded = loadVoiceBible(root, projectId, voiceBibleId);
  if (!loaded.ok) return loaded;
  const existing = dagLib.loadDag(root, projectId);
  if (!existing.ok && existing.code !== "DAG_NOT_FOUND") return existing;

  const added = [];
  if (!existing.ok) {
    const boot = dagLib.bootstrapDag(root, projectId, opts);
    if (!boot.ok) return boot;
  }
  const dag = dagLib.loadDag(root, projectId).dag;
  if (!dag.nodes.VOICE_BIBLE) {
    const n = dagLib.addNode(root, projectId, {
      artifactKey: "VOICE_BIBLE",
      artifactType: "VOICE_BIBLE",
      versionRef: voiceBibleId,
      state: "CLEAN",
      producedBy: "phase-2.1:voice-bible",
      lockTarget: { targetType: "VOICE_BIBLE", targetId: voiceBibleId },
      provenance: "LIVE",
    }, opts);
    if (!n.ok) return n;
    added.push("VOICE_BIBLE");
  } else {
    // The node may pre-exist as a bare future-class placeholder (bootstrap ran
    // before the bible existed). Completing it is mandatory: a node with a real
    // versionRef but NOT_CREATED_YET and no lockTarget would misreport the DAG
    // and silently opt out of lock-aware invalidation.
    const existing = dag.nodes.VOICE_BIBLE;
    if (existing.versionRef !== voiceBibleId) {
      const v = dagLib.setNodeVersion(root, projectId, "VOICE_BIBLE", voiceBibleId, opts);
      if (!v.ok) return v;
      added.push("VOICE_BIBLE.version");
    }
    if (dagLib.effectiveState(dagLib.loadDag(root, projectId).dag, "VOICE_BIBLE") !== "CLEAN") {
      const s = dagLib.setNodeState(root, projectId, "VOICE_BIBLE", "CLEAN", opts);
      if (!s.ok) return s;
      added.push("VOICE_BIBLE.state=CLEAN");
    }
    const lockTarget = { targetType: "VOICE_BIBLE", targetId: voiceBibleId };
    if (JSON.stringify(dag.nodes.VOICE_BIBLE.lockTarget || null) !== JSON.stringify(lockTarget)) {
      const t = dagLib.setNodeLockTarget(root, projectId, "VOICE_BIBLE", lockTarget, opts);
      if (!t.ok) return t;
      added.push("VOICE_BIBLE.lockTarget");
    }
  }
  const now = dagLib.loadDag(root, projectId).dag;
  if (now.nodes.VOICE && !(now.nodes.VOICE.inputRefs || []).some((r) => r.key === "VOICE_BIBLE")) {
    const d = dagLib.addDependency(root, projectId, "VOICE_BIBLE", "VOICE", "VOICE_IDENTITY", opts);
    if (!d.ok) return d;
    added.push("VOICE_BIBLE->VOICE");
  }
  return { ok: true, added, versionRef: voiceBibleId };
}

/**
 * §16 revision propagation: the Voice Bible version changes → dependents on
 * the audio branch go DIRTY (or BLOCKED when locked). Unrelated research and
 * visual branches are untouched because they are not descendants.
 */
function propagateRevision(root, projectId, opts = {}) {
  const loaded = dagLib.loadDag(root, projectId);
  if (!loaded.ok) return loaded;
  if (!loaded.dag.nodes.VOICE_BIBLE) {
    return { ok: false, code: "VOICE_BIBLE_NOT_FOUND", message: "DAG has no VOICE_BIBLE node; register it before propagating a revision" };
  }
  const r = dagLib.markDirty(root, projectId, "VOICE_BIBLE", { reason: "voice bible revised" }, opts, voiceBibleLockReader(root, projectId));
  if (!r.ok) return r;
  return { ok: true, dirtied: r.dirtied, blocked: r.blocked, changed: r.changed === true };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function buildVoiceBible(input, createdAt) {
  const narrator = input.narrator;
  const voice = {
    schemaVersion: VOICE_BIBLE_SCHEMA_VERSION,
    version: input.version || 1,
    language: input.language,
    locale: nullIfUndefined(input.locale),
    narrator: {
      personaId: narrator.personaId,
      displayName: nullIfUndefined(narrator.displayName),
      provider: narrator.provider,
      model: narrator.model,
      voiceId: narrator.voiceId,
      speakingStyle: narrator.speakingStyle,
      prosodyDefaults: narrator.prosodyDefaults,
      speedDefault: narrator.speedDefault,
      pitchDefault: nullIfUndefined(narrator.pitchDefault),
      energyDefault: nullIfUndefined(narrator.energyDefault),
      emotionalRange: narrator.emotionalRange,
      prohibitedTraits: narrator.prohibitedTraits,
      persona: narrator.persona,
    },
    characterVoices: Array.isArray(input.characterVoices) ? input.characterVoices : [],
    pronunciationProfileRef: nullIfUndefined(input.pronunciationProfileRef),
    providerOptions: nullIfUndefined(input.providerOptions),
    provenance: {
      source: input.provenance.source,
      createdAt,
      rights: {
        status: input.provenance.rights.status,
        licenseType: input.provenance.rights.licenseType,
        detail: nullIfUndefined(input.provenance.rights.detail),
        cloning: false,
      },
      evidenceRefs: Array.isArray(input.provenance.evidenceRefs) ? input.provenance.evidenceRefs : [],
      approvalRef: nullIfUndefined(input.provenance.approvalRef),
    },
  };
  // A caller that passes an explicit `undefined` means "not supplied", not
  // "persist an undefined". Never let undefined reach a persisted doc.
  stripUndefined(voice);
  return voice;
}

function nextIdentity(previous, semantic) {
  const version = previous ? previous.version + 1 : 1;
  const voiceBibleId = costShared.id12("vb", {
    project: previous ? previous.projectId : null,
    version,
    semantic,
  });
  return { voiceBibleId, version };
}

/** Create the first version. Refuses when one already exists (never silently replace). */
function createVoiceBible(root, projectId, input = {}, opts = {}) {
  if (!root || !projectId) {
    return { ok: false, code: "VOICE_BIBLE_SCHEMA_INVALID", message: "root + projectId are required" };
  }
  const existing = listVoiceBibles(root, projectId);
  if (!existing.ok) return existing;
  if (existing.voiceBibles.length > 0) {
    return { ok: false, code: "VOICE_BIBLE_VERSION_CONFLICT", message: "a Voice Bible already exists; use reviseVoiceBible (versions are immutable)" };
  }
  const createdAt = nowIso(opts.now);
  const doc = buildVoiceBible({ ...input, projectId: input.projectId || projectId, version: 1 }, createdAt);
  const semantic = semanticFingerprint(doc);
  const identity = nextIdentity(null, semantic);
  doc.voiceBibleId = identity.voiceBibleId;
  doc.version = identity.version;
  doc.fingerprint = fingerprintOf(doc);

  const saved = persistVersion(root, projectId, doc);
  if (!saved.ok) return saved;
  const validated = validateVoiceBible(doc);
  emitVoiceEvent(root, projectId, "VOICE_BIBLE_CREATED", {
    correlationId: doc.voiceBibleId,
    voiceBibleId: doc.voiceBibleId,
    provider: doc.narrator.provider,
    model: doc.narrator.model,
    stateTo: "CREATED",
    attributes: {
      bibleVersion: doc.version,
      language: doc.language,
      personaId: doc.narrator.personaId,
      provenanceSource: doc.provenance.source,
      rightsStatus: doc.provenance.rights.status,
    },
    evidenceRefs: doc.provenance.evidenceRefs,
  }, opts);
  if (!validated.ok) {
    return { ok: false, code: "VOICE_BIBLE_SCHEMA_INVALID", message: validated.errors[0].message, errors: validated.errors, voiceBible: doc };
  }
  const readiness = readinessOf(doc);
  if (!readiness.productionReady) {
    emitVoiceEvent(root, projectId, "VOICE_SELECTION_REVIEW_REQUIRED", {
      correlationId: doc.voiceBibleId,
      voiceBibleId: doc.voiceBibleId,
      severity: "WARN",
      errorCode: readiness.code,
      attributes: { blockers: readiness.blockers.join(" | ").slice(0, 256) },
    }, opts);
  }
  return { ok: true, voiceBible: doc, changed: true, rel: saved.rel, readiness, semanticFingerprint: semantic };
}

/**
 * §14 revise. Same semantic content → no bump, no write (idempotent replay).
 * Meaningful change → a NEW immutable version; the previous one stays
 * loadable. §17: a locked voice config is never silently replaced.
 */
function reviseVoiceBible(root, projectId, patch = {}, opts = {}) {
  const current = latestVoiceBible(root, projectId);
  if (!current.ok) return current;
  const base = current.voiceBible;

  const lock = historyLib.checkRerunAllowed(root, projectId, {
    targetType: "VOICE_BIBLE",
    targetId: base.voiceBibleId,
    action: "voice-bible-revise",
  });
  if (!lock.ok && lock.code === "TARGET_LOCKED") {
    return {
      ok: false,
      code: "VOICE_BIBLE_LOCKED",
      message: `${ERRORS.VOICE_BIBLE_LOCKED}: unlock/revise explicitly — ${lock.message}`,
      lock: lock.lock,
    };
  }
  if (!lock.ok && lock.code !== "HISTORY_NOT_FOUND" && lock.code !== "NO_HISTORY_STORE" && lock.code !== "TARGET_NOT_FOUND") {
    return { ok: false, code: "VOICE_BIBLE_LOCKED", message: `${ERRORS.VOICE_BIBLE_LOCKED}: lock state cannot be proven (${lock.code})` };
  }

  const createdAt = nowIso(opts.now);
  const draft = buildVoiceBible({ ...base, ...patch, narrator: { ...base.narrator, ...(patch.narrator || {}) }, projectId: base.projectId, version: 1 }, createdAt);
  const semantic = semanticFingerprint(draft);
  if (semantic === semanticFingerprint(base)) {
    emitVoiceEvent(root, projectId, "VOICE_BIBLE_VALIDATED", {
      correlationId: base.voiceBibleId,
      voiceBibleId: base.voiceBibleId,
      stateTo: "NO_CHANGE",
      attributes: { reason: "same semantic content; no version bump" },
    }, opts);
    return { ok: true, voiceBible: base, changed: false, deduped: true, semanticFingerprint: semantic };
  }

  const identity = nextIdentity(base, semantic);
  draft.voiceBibleId = identity.voiceBibleId;
  draft.version = identity.version;
  draft.fingerprint = fingerprintOf(draft);
  const validated = validateVoiceBible(draft);
  if (!validated.ok) {
    return { ok: false, code: validated.errors[0].code, message: validated.errors[0].message, errors: validated.errors };
  }
  const saved = persistVersion(root, projectId, draft);
  if (!saved.ok) return saved;

  const dag = registerDagNode(root, projectId, draft.voiceBibleId, opts);
  if (dag.ok) propagateRevision(root, projectId, opts);

  emitVoiceEvent(root, projectId, "VOICE_BIBLE_REVISED", {
    correlationId: draft.voiceBibleId,
    voiceBibleId: draft.voiceBibleId,
    provider: draft.narrator.provider,
    model: draft.narrator.model,
    stateTo: "REVISED",
    attributes: {
      previousVersion: base.version,
      bibleVersion: draft.version,
      semanticChanged: true,
    },
  }, opts);
  const readiness = readinessOf(draft);
  if (!readiness.productionReady) {
    emitVoiceEvent(root, projectId, "VOICE_SELECTION_REVIEW_REQUIRED", {
      correlationId: draft.voiceBibleId,
      voiceBibleId: draft.voiceBibleId,
      severity: "WARN",
      errorCode: readiness.code,
      attributes: { blockers: readiness.blockers.join(" | ").slice(0, 256) },
    }, opts);
  }
  return {
    ok: true,
    voiceBible: draft,
    changed: true,
    previousVoiceBibleId: base.voiceBibleId,
    previousVersion: base.version,
    rel: saved.rel,
    readiness,
    semanticFingerprint: semantic,
  };
}

/**
 * §30 performance baseline for 2.1 configuration operations only. No TTS
 * synthesis benchmark here (that is 2.4).
 */
function measureBaseline(root, projectId, opts = {}) {
  const iterations = Math.max(1, Number(opts.iterations) || 20);
  const time = (fn) => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < iterations; i += 1) fn();
    return Number(process.hrtime.bigint() - t0) / 1e6 / iterations;
  };
  const latest = latestVoiceBible(root, projectId);
  const ops = {};
  if (latest.ok) {
    ops.voiceBibleLoadLatencyMs = time(() => loadVoiceBible(root, projectId, latest.voiceBible.voiceBibleId));
    ops.voiceBibleValidateLatencyMs = time(() => validateVoiceBible(latest.voiceBible));
    ops.voiceBibleWriteLatencyMs = time(() => artifactStore.writeArtifactAtomic(root, projectId, "voice/voice-bible/.perf-probe.tmp", Buffer.from("perf")));
  } else {
    ops.voiceBibleLoadLatencyMs = null;
    ops.voiceBibleValidateLatencyMs = null;
    ops.voiceBibleWriteLatencyMs = null;
  }
  ops.voiceSelectionResolveLatencyMs = time(() => resolveVoiceSelection({
    provider: V1_TTS_PROVIDER,
    model: V1_TTS_MODEL,
    voiceId: kokoro.DEFAULT_VOICES["en-us"],
    language: "en-us",
    speedDefault: 1,
  }));
  if (latest.ok) {
    // Measure the manifest index write with the SAME status/readiness the real
    // attach path would compute. A hardcoded VERIFIED here would silently
    // upgrade an UNRESOLVED (unapproved / unproven-rights) reference — and a
    // recomputed UNRESOLVED must never downgrade an attached VERIFIED /
    // RISK_ACCEPTED reference either. Resolve readiness exactly as the attach
    // path does, including the explicit risk-acceptance proof.
    let readiness = latest.readiness;
    if (latest.voiceBible.provenance.rights.status === "RISK_ACCEPTED") {
      try {
        const lic = require("./license.js");
        const check = lic.isRiskAcceptanceValid(root, latest.voiceBible.narrator.provider, { voiceId: latest.voiceBible.narrator.voiceId });
        if (check.ok) readiness = readinessOf(latest.voiceBible, { rightsDecisionValid: true });
      } catch { /* fail-closed: keep the blocked readiness */ }
    }
    const ref = manifestReferenceFor(latest.voiceBible, readiness);
    ops.manifestReferenceUpdateLatencyMs = time(() => manifestLib.setArtifactVersion(root, projectId, "voiceBibleVersion", ref, {
      now: latest.voiceBible.provenance.createdAt,
    }));
  } else {
    ops.manifestReferenceUpdateLatencyMs = null;
  }
  try { fs.rmSync(path.join(root, "projects", projectId, "voice", "voice-bible", ".perf-probe.tmp"), { force: true }); } catch { /* probe cleanup is best effort */ }
  return {
    ok: true,
    iterations,
    unit: "milliseconds",
    scope: "phase-2.1 configuration operations only; no TTS synthesis benchmark (2.4)",
    provider: V1_TTS_PROVIDER,
    ops,
    manifestMutation: "none — every measured write is byte-identical to current state (idempotent no-op)",
  };
}

module.exports = {
  VOICE_BIBLE_SCHEMA_VERSION,
  VOICE_BIBLE_LIFECYCLE,
  VOICE_BIBLE_DIR_REL,
  RUNTIME_PROBE_STATUS,
  V1_TTS_PROVIDER,
  V1_TTS_MODEL,
  ERRORS,
  voiceBibleRel,
  voiceBibleDir,
  approveVoiceBiblePath,
  providerCatalog,
  resolveVoiceSelection,
  validateVoiceBible,
  readinessOf,
  productionReadinessGate,
  semanticFingerprint,
  fingerprintOf,
  loadVoiceBible,
  latestVoiceBible,
  listVoiceBibles,
  createVoiceBible,
  reviseVoiceBible,
  attachManifestReference,
  manifestReferenceFor,
  registerDagNode,
  propagateRevision,
  voiceBibleLockReader,
  emitVoiceEvent,
  measureBaseline,
};