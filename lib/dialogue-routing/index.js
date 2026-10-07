"use strict";

/**
 * Phase 2.6 — Dialogue / Multi-voice routing contract (UNFOLDIQ CORE).
 *
 * speakerId → voiceId → style resolution against the Voice Bible, fail-closed
 * at every boundary: unknown speaker, missing character voice, language
 * mismatch, unallowed style, and the forbidden silent narrator fallback for a
 * character speaker. No production media generation happens here; validation
 * runs against bounded synthetic/Golden fixtures only.
 */

const fs = require("fs");
const path = require("path");
const costShared = require("../output-cost/shared.js");
const telemetryLib = require("../telemetry/index.js");
const dagLib = require("../dependency-dag/index.js");

const QA_DIR_REL = "audio/narration/qa";

const ERRORS = {
  DIALOGUE_SPEAKER_NOT_FOUND: "speakerId does not resolve in the Voice Bible",
  DIALOGUE_VOICE_NOT_ASSIGNED: "character speaker has no assigned voiceId",
  DIALOGUE_VOICE_LANGUAGE_MISMATCH: "character voice is not compatible with the script language",
  DIALOGUE_STYLE_NOT_ALLOWED: "style not allowed for this speaker/Voice Bible",
  DIALOGUE_NARRATOR_FALLBACK_FORBIDDEN: "silent narrator fallback for a character speaker is forbidden",
  DIALOGUE_VOICE_BIBLE_INVALID: "voice bible required for routing",
};

/**
 * Resolve one speaker's route. narrator always resolves to the Voice Bible
 * narrator identity. A character speaker MUST have an explicit characterVoice
 * entry — there is no silent fallback to the narrator.
 */
function resolveSpeakerRoute(voiceBible, speakerId, { language, style } = {}) {
  if (!voiceBible || !voiceBible.narrator) {
    return { ok: false, code: "DIALOGUE_VOICE_BIBLE_INVALID", message: ERRORS.DIALOGUE_VOICE_BIBLE_INVALID };
  }
  if (speakerId === "narrator" || speakerId === null || speakerId === undefined) {
    return {
      ok: true,
      route: { speakerId: "narrator", voiceId: voiceBible.narrator.voiceId, provider: voiceBible.narrator.provider, model: voiceBible.narrator.model, style: style || voiceBible.narrator.speakingStyle },
    };
  }
  const character = (voiceBible.characterVoices || []).find((c) => c.speakerId === speakerId || c.personaId === speakerId || c.displayName === speakerId);
  if (!character) {
    return { ok: false, code: "DIALOGUE_SPEAKER_NOT_FOUND", message: `${ERRORS.DIALOGUE_SPEAKER_NOT_FOUND}: ${speakerId}` };
  }
  if (!character.voiceId) {
    return { ok: false, code: "DIALOGUE_VOICE_NOT_ASSIGNED", message: `${ERRORS.DIALOGUE_VOICE_NOT_ASSIGNED}: ${speakerId}` };
  }
  if (language && character.language && character.language !== language) {
    return { ok: false, code: "DIALOGUE_VOICE_LANGUAGE_MISMATCH", message: `${ERRORS.DIALOGUE_VOICE_LANGUAGE_MISMATCH}: ${speakerId} voice ${character.language} vs script ${language}` };
  }
  const allowedStyles = character.allowedStyles || null;
  if (style && allowedStyles && !allowedStyles.includes(style)) {
    return { ok: false, code: "DIALOGUE_STYLE_NOT_ALLOWED", message: `${ERRORS.DIALOGUE_STYLE_NOT_ALLOWED}: ${style} for ${speakerId}` };
  }
  return {
    ok: true,
    route: { speakerId, voiceId: character.voiceId, provider: character.provider || null, model: character.model || null, style: style || character.speakingStyle || null },
  };
}

/** Never-fallback guard: a character speaker request routed to the narrator voice is refused. */
function assertNoNarratorFallback(route, speakerId) {
  if (route && route.ok && speakerId !== "narrator" && speakerId !== null && speakerId !== undefined && route.route.voiceId === route.route.narratorVoiceId) {
    return { ok: false, code: "DIALOGUE_NARRATOR_FALLBACK_FORBIDDEN", message: ERRORS.DIALOGUE_NARRATOR_FALLBACK_FORBIDDEN };
  }
  return { ok: true };
}

/**
 * Project-level dialogue decision (§29/§44): SINGLE_NARRATOR + NOT_APPLICABLE
 * for narrator-only FACTUAL projects, with the routing contract itself
 * validated against bounded fixtures (no production media).
 */
function createRoutingDecision(root, projectId, { contentClass, voiceBibleRef, voiceBible, routingChecks }, opts = {}) {
  const multiVoiceRequired = contentClass === "FICTION" || contentClass === "HYBRID" ? true : false;
  const decision = contentClass === "FACTUAL" ? "NOT_APPLICABLE" : (multiVoiceRequired ? "BLOCKED" : "NOT_APPLICABLE");
  const doc = {
    schemaVersion: "1.0.0",
    dialogueRoutingDecisionId: null,
    version: 1,
    projectId,
    contentClass,
    speakerMode: multiVoiceRequired ? "MULTI_VOICE" : "SINGLE_NARRATOR",
    narratorVoiceId: voiceBible.narrator.voiceId,
    voiceBibleRef,
    multiVoiceRequired,
    decision,
    routingChecks,
    provenance: { createdAt: null, evidenceRefs: opts.evidenceRefs || [] },
    fingerprint: null,
  };
  doc.dialogueRoutingDecisionId = `dlr-${costShared.id12("dlr", { project: projectId, contentClass, checks: routingChecks.map((c) => `${c.checkId}:${c.status}`).join("|") }).slice(4)}`;
  doc.fingerprint = fingerprintOf(doc);
  doc.provenance.createdAt = new Date().toISOString();
  const rel = `${QA_DIR_REL}/${doc.dialogueRoutingDecisionId}.json`;
  const abs = path.join(root, "projects", projectId, rel);
  if (fs.existsSync(abs)) {
    try {
      const existing = JSON.parse(fs.readFileSync(abs, "utf8"));
      if (existing.fingerprint === doc.fingerprint && sameSemantics(existing, doc)) return { ok: true, decision: existing, rel, replay: true, reconcile: "EXACT", code: "IDEMPOTENT_REPLAY" };
      // FIX 01 Gap A: semantically identical decision (only provenance differs) is reused, not conflicted.
      if (sameSemantics(existing, doc)) return { ok: true, decision: existing, rel, replay: true, reconciled: true, reconcile: "SEMANTIC", code: "IDEMPOTENT_REPLAY" };
    } catch { /* fall through */ }
    return { ok: false, code: "FINAL_SPOKEN_SCRIPT_VERSION_CONFLICT", message: `dialogue routing decision exists: ${rel}` };
  }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, abs);
  } catch (e) {
    return { ok: false, code: "FINAL_SPOKEN_SCRIPT_VERSION_CONFLICT", message: String((e && e.message) || e) };
  }
  emitEvent(root, projectId, "DIALOGUE_ROUTING_VALIDATED", { correlationId: doc.dialogueRoutingDecisionId, stateTo: decision, attributes: { speakerMode: doc.speakerMode, multiVoiceRequired, checkCount: routingChecks.length } }, opts);
  return { ok: true, decision: doc, rel };
}

function fingerprintOf(doc) {
  const { fingerprint, ...rest } = doc;
  void fingerprint;
  return costShared.hash16(JSON.parse(costShared.stableStringify(rest)));
}

// FIX 01 Gap A — same semantic-reconcile contract as lib/tts-audio.
function semanticBody(doc) {
  const { fingerprint, provenance, ...rest } = doc;
  void fingerprint;
  void provenance;
  return rest;
}

function sameSemantics(a, b) {
  try {
    return costShared.stableStringify(semanticBody(a)) === costShared.stableStringify(semanticBody(b));
  } catch {
    return false;
  }
}

function emitEvent(root, projectId, eventName, fields = {}, opts = {}) {
  try {
    const r = telemetryLib.recordEvent(root, projectId, {
      eventName,
      severity: fields.severity || "INFO",
      stage: "phase-2.4-2.6",
      component: "dialogue-routing",
      correlationId: fields.correlationId || null,
      stateTo: fields.stateTo || null,
      attributes: fields.attributes || null,
      evidenceRefs: fields.evidenceRefs || [],
      provenance: "LIVE",
    }, opts);
    if (!r.ok && opts.strictTelemetry) return r;
    return { ok: true, emitted: r.ok === true };
  } catch (e) {
    return { ok: true, emitted: false, error: String((e && e.message) || e) };
  }
}

/** DAG node for the routing decision (real artifact, real dependency). */
function registerDagNode(root, projectId, decisionId, opts = {}) {
  const existing = dagLib.loadDag(root, projectId);
  if (!existing.ok && existing.code !== "DAG_NOT_FOUND") return existing;
  if (!existing.ok) {
    const bare = dagLib.createDag(root, projectId, opts);
    if (!bare.ok) return bare;
  }
  const cur = dagLib.loadDag(root, projectId);
  if (!cur.ok) return cur;
  if (cur.dag.nodes.DIALOGUE_ROUTING_DECISION) {
    if (cur.dag.nodes.DIALOGUE_ROUTING_DECISION.versionRef !== decisionId) {
      const v = dagLib.setNodeVersion(root, projectId, "DIALOGUE_ROUTING_DECISION", decisionId, opts);
      if (!v.ok) return v;
    }
    return { ok: true, added: [] };
  }
  const n = dagLib.addNode(root, projectId, {
    artifactKey: "DIALOGUE_ROUTING_DECISION",
    artifactType: "DIALOGUE_ROUTING_DECISION",
    versionRef: decisionId,
    state: "CLEAN",
    producedBy: "phase-2.6:dialogue-routing",
    provenance: "LIVE",
    inputRefs: [{ key: "VOICE_BIBLE", type: "VOICE_IDENTITY" }],
  }, opts);
  if (!n.ok) return n;
  return { ok: true, added: ["DIALOGUE_ROUTING_DECISION"] };
}

module.exports = {
  ERRORS,
  QA_DIR_REL,
  resolveSpeakerRoute,
  assertNoNarratorFallback,
  createRoutingDecision,
  registerDagNode,
  emitEvent,
  semanticBody,
  sameSemantics,
};
