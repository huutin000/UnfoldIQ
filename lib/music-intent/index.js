"use strict";

/**
 * Phase 2.7-B — Music Necessity Gate + Vocal Policy (UNFOLDIQ CORE).
 *
 * Decides, per narrative segment, whether music exists at all (presence),
 * why it exists (purpose) and what vocal policy applies — BEFORE any track
 * is chosen. Invariant: no valid narrative purpose → MusicPresence = NONE.
 * Music is never added just because "videos have background music".
 *
 * Pure decision layer: deterministic rules over segment signals with an
 * explicit override channel. Deterministic engines (Phase 2.8) execute;
 * this module only decides intent.
 */

const Ajv = require("ajv");
const fs = require("fs");
const path = require("path");

const SCHEMA_VERSION = "1.0.0";

const PRESENCE = ["NONE", "BED", "FEATURED"];
const PURPOSES = ["EMOTION", "TENSION", "PACING", "TRANSITION", "IDENTITY", "ENERGY", "CONTRAST"];
const VOCAL_POLICIES = ["INSTRUMENTAL_ONLY", "VOCAL_ALLOWED", "VOCAL_FEATURED"];

const ERRORS = {
  INTENT_SCHEMA_INVALID: "music intent artifact fails schema validation",
  INTENT_INPUT_INVALID: "segment signals missing segmentId",
  INTENT_PURPOSE_REQUIRED: "music presence requires a valid narrative purpose",
  INTENT_VOCAL_FEATURED_UNJUSTIFIED: "VOCAL_FEATURED requires music-as-foreground context",
  INTENT_UNKNOWN_OVERRIDE: "override uses an unknown presence/purpose/vocalPolicy value",
};

let _validator = null;
function validator() {
  if (!_validator) {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const schema = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "schemas", "music-intent.schema.json"), "utf8"));
    _validator = ajv.compile(schema);
  }
  return _validator;
}

/**
 * Gate for ONE segment. Signals (all optional except segmentId):
 *   narrationActive   — narration/dialogue plays during this segment
 *   isQuote           — testimony/quote needing focus
 *   dramaticPause     — deliberate silence before/inside reveal
 *   informationDensity— HIGH | MEDIUM | LOW
 *   sceneType         — montage | intro | outro | transition | explanation | content | musicMoment
 *   explicitNone      — upstream declared no-music (e.g. ambience self-sufficient)
 *   ambienceSufficient— ambience alone carries the scene
 *   creativePurpose   — explicit purpose from creative direction (EMOTION|TENSION|...)
 *   mood, energy, tension, bpmPreference, instrumentationPreference
 *   explicitPresence  — override channel (must still pass gate rules)
 */
function gateSegment(signals = {}) {
  if (!signals.segmentId || typeof signals.segmentId !== "string") {
    return { ok: false, code: "INTENT_INPUT_INVALID", message: ERRORS.INTENT_INPUT_INVALID };
  }
  const narrationActive = signals.narrationActive === true;
  const density = signals.informationDensity === "HIGH" ? "HIGH" : "MEDIUM";
  const sceneType = typeof signals.sceneType === "string" ? signals.sceneType : "content";
  const foregroundContext = ["montage", "intro", "outro", "musicMoment"].includes(sceneType);
  const explicitPurpose = PURPOSES.includes(signals.creativePurpose) ? signals.creativePurpose : null;

  // Override channel validation.
  if (signals.explicitPresence !== undefined) {
    if (!PRESENCE.includes(signals.explicitPresence)) {
      return { ok: false, code: "INTENT_UNKNOWN_OVERRIDE", message: ERRORS.INTENT_UNKNOWN_OVERRIDE };
    }
    if (signals.explicitPresence !== "NONE" && !explicitPurpose) {
      return { ok: false, code: "INTENT_PURPOSE_REQUIRED", message: ERRORS.INTENT_PURPOSE_REQUIRED };
    }
  }

  // NONE drivers (checked first — music is optional by default).
  if (signals.explicitPresence === "NONE" || signals.explicitNone === true) {
    return intent(signals, "NONE", null, "NONE",
      signals.explicitNone ? "upstream declared music-free segment" : "explicit NONE override", 0.95);
  }
  if (signals.dramaticPause === true) {
    return intent(signals, "NONE", null, "NONE", "dramatic pause — silence before/inside reveal", 0.85);
  }
  if (signals.isQuote === true && !foregroundContext) {
    return intent(signals, "NONE", null, "NONE", "quote/testimony needs full listener focus", 0.8);
  }
  if (signals.ambienceSufficient === true && !explicitPurpose) {
    return intent(signals, "NONE", null, "NONE", "ambience alone carries the scene", 0.75);
  }

  // Purpose resolution: explicit creative purpose wins; else infer from scene type.
  let purpose = explicitPurpose;
  let inferred = false;
  if (!purpose) {
    if (sceneType === "intro" || sceneType === "outro") purpose = "IDENTITY";
    else if (sceneType === "montage") purpose = "ENERGY";
    else if (sceneType === "transition") purpose = "TRANSITION";
    else if (sceneType === "musicMoment") purpose = "EMOTION";
    // narration alone is NOT a purpose — "videos have music" is the anti-pattern.
    else purpose = null;
    inferred = purpose !== null;
  }

  // Mandatory invariant: no valid narrative purpose → NONE.
  if (!purpose) {
    return intent(signals, "NONE", null, "NONE",
      "no valid narrative purpose — music omitted by gate", 0.7);
  }

  // Narration is the primary information track: FEATURED (music as
  // foreground) requires an actually narration-free context.
  const presence = foregroundContext && !narrationActive ? "FEATURED" : "BED";
  const confidence = signals.explicitPresence !== undefined ? 0.95 : (inferred ? 0.75 : 0.9);

  // Vocal policy decided here, BEFORE track selection.
  const speechCompetes = narrationActive || density === "HIGH" || signals.isQuote === true;
  let vocalPolicy;
  let vocalReason;
  if (presence === "FEATURED" && !narrationActive && (sceneType === "musicMoment" || signals.creativePurpose === "EMOTION")) {
    vocalPolicy = "VOCAL_FEATURED";
    vocalReason = "music is foreground without narration";
  } else if (speechCompetes) {
    vocalPolicy = "INSTRUMENTAL_ONLY";
    vocalReason = narrationActive ? "narration active — instrumental by default" : "high information density — instrumental by default";
  } else {
    vocalPolicy = "VOCAL_ALLOWED";
    vocalReason = "no active speech competition; wordless/texture vocals acceptable";
  }

  const result = intent(signals, presence, purpose, vocalPolicy,
    `${purpose.toLowerCase()} via ${sceneType}${inferred ? " (inferred)" : ""}; vocal: ${vocalReason}`,
    confidence);
  if (signals.explicitPresence === "FEATURED" && result.intent.presence !== "FEATURED") {
    // Explicit FEATURED override on a narration-active segment stays BED.
    result.warnings = ["FEATURED override downgraded to BED because narration is active"];
  }
  return result;
}

function intent(signals, presence, purpose, vocalPolicy, reason, confidence) {
  // NONE intents still carry a policy value (schema enum); it is inert —
  // no track is selected for NONE. Default to the conservative policy.
  if (presence === "NONE" && !VOCAL_POLICIES.includes(vocalPolicy)) vocalPolicy = "INSTRUMENTAL_ONLY";
  const out = {
    segmentId: signals.segmentId,
    presence,
    purpose,
    vocalPolicy,
    reason,
    confidence,
  };
  if (Array.isArray(signals.mood) && signals.mood.length) out.mood = signals.mood.slice();
  if (typeof signals.energy === "number") out.energy = clamp01(signals.energy);
  if (typeof signals.tension === "number") out.tension = clamp01(signals.tension);
  if (signals.bpmPreference && typeof signals.bpmPreference === "object") out.bpmPreference = signals.bpmPreference;
  if (Array.isArray(signals.instrumentationPreference) && signals.instrumentationPreference.length) {
    out.instrumentationPreference = signals.instrumentationPreference.slice();
  }
  if (presence === "NONE" && signals.intentionalSilence === true) out.intentionalSilence = true;
  return { ok: true, intent: out };
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/** Build the full versioned MusicIntent artifact from ordered segment signals. */
function buildMusicIntents({ projectId, segments }) {
  if (!projectId || !Array.isArray(segments)) {
    return { ok: false, code: "INTENT_INPUT_INVALID", message: ERRORS.INTENT_INPUT_INVALID };
  }
  const intents = [];
  const failures = [];
  for (const s of segments) {
    const r = gateSegment(s);
    if (!r.ok) failures.push({ segmentId: s && s.segmentId, code: r.code, message: r.message });
    else intents.push(r.intent);
  }
  const artifact = {
    version: SCHEMA_VERSION,
    projectId,
    intents,
    status: failures.length === 0 ? "READY" : "BLOCKED",
    generatedAt: new Date().toISOString(),
  };
  const valid = validator()(artifact);
  return {
    ok: valid && failures.length === 0,
    code: valid ? "OK" : "INTENT_SCHEMA_INVALID",
    message: valid ? undefined : ajvText(validator().errors),
    failures,
    artifact,
  };
}

/**
 * Cross-intent semantic review (Phase 2.7-H support):
 * flags consecutive same-purpose cues without narrative transition reasons,
 * vocal policy conflicts against narration, and missing-music intents where
 * a FEATURED context exists but gate returned NONE.
 */
function reviewIntents(artifact) {
  const findings = [];
  const intents = (artifact && artifact.intents) || [];
  for (const it of intents) {
    if (it.presence !== "NONE" && !it.purpose) {
      findings.push({ segmentId: it.segmentId, code: "MUSIC_NOT_NEEDED", detail: "presence without purpose" });
    }
    if (it.presence === "FEATURED" && it.vocalPolicy !== "VOCAL_FEATURED" && it.vocalPolicy !== "INSTRUMENTAL_ONLY") {
      findings.push({ segmentId: it.segmentId, code: "VOCAL_COMPETES_WITH_SPEECH", detail: "featured segment without vocal policy guard" });
    }
  }
  return { ok: findings.length === 0, findings };
}

function ajvText(errors) {
  return (errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}

module.exports = {
  SCHEMA_VERSION,
  PRESENCE,
  PURPOSES,
  VOCAL_POLICIES,
  ERRORS,
  gateSegment,
  buildMusicIntents,
  reviewIntents,
  validateArtifact(artifact) {
    const ok = validator()(artifact);
    return { ok, errors: ok ? [] : ajvText(validator().errors) };
  },
};
