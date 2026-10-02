"use strict";

/**
 * UNFOLDIQ cloud elevenlabs-stt adapter (STEP-10C Branch C).
 *
 * providerId 'elevenlabs-stt', capability stt, costClass PAID.
 * Config-disabled by default: BOTH request.costConstraints.allowPaidCloud===true
 * AND ctx.enableCloud===true are required to attempt. Without request-level
 * allowPaidCloud the resolver skips this PAID provider (SKIPPED_COST_POLICY).
 * Secrets from env ELEVENLABS_API_KEY only — never logged, never persisted.
 * Missing key → unavailable NOT_CONFIGURED. Mock transport for tests via
 * ctx.elevenlabsSttTransport ({ audioRelPath }, no secrets) returning
 * { transcript, segments }. Returns a structured timing artifact under
 * timing/<sceneId>/. HTTP errors classified transient/permanent. Safety-like
 * error text returns { status:'FAILED', safetyRefusal } with no auto-retry
 * and no prompt rewrite.
 */

const { registerProvider } = require("../registry");
const store = require("../artifact-store");
const { fingerprintRequest } = require("../request-fingerprint");
const { transient, permanent, unavailable } = require("../errors");

const PROVIDER_ID = "elevenlabs-stt";
const CAPABILITY = "stt";

function getApiKey() {
  return process.env.ELEVENLABS_API_KEY || null;
}

function cloudAttemptAllowed(request, ctx) {
  return (
    !!ctx &&
    ctx.enableCloud === true &&
    !!request &&
    !!request.costConstraints &&
    request.costConstraints.allowPaidCloud === true
  );
}

async function availabilityCheck(request, ctx = {}) {
  try {
    if (request && request.capability && request.capability !== CAPABILITY) return false;
    if (!cloudAttemptAllowed(request, ctx)) return false;
    if (!getApiKey()) return false;
    return true;
  } catch {
    return false;
  }
}

function isSafetyLike(text) {
  return /block|refus|policy|safety|moderat|content.?filter|prohibited|disallowed|restricted/i.test(
    String(text || "")
  );
}

function safetyFailed(request, message) {
  return {
    version: "1.0.0",
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: CAPABILITY,
    providerId: PROVIDER_ID,
    status: "FAILED",
    sourceType: "generated",
    provenanceNote: "ElevenLabs STT provider refused transcription (safety/policy). No prompt rewrite attempted.",
    rightsStatus: "NOT_APPLICABLE",
    costClass: "PAID",
    safetyRefusal: {
      refusalClass: "UNKNOWN_SAFETY",
      message: String(message || "provider safety refusal").slice(0, 500),
    },
    error: {
      errorCode: "PROVIDER_SAFETY_REFUSAL",
      errorSummary: "Provider refused transcription (safety/policy). No auto-retry, no prompt rewrite.",
      errorClass: "permanent",
    },
  };
}

async function execute(request, ctx = {}) {
  const path = require("path");
  const projectRoot = ctx.projectRoot || path.join(__dirname, "..", "..", "..");
  if (request.capability !== CAPABILITY) {
    throw permanent("ELEVENLABS_STT_CAPABILITY_UNSUPPORTED", `elevenlabs-stt supports stt, got ${request.capability}`);
  }
  if (!cloudAttemptAllowed(request, ctx)) {
    throw unavailable(
      "CLOUD_NOT_ENABLED",
      "elevenlabs-stt disabled: requires request.costConstraints.allowPaidCloud=true AND ctx.enableCloud=true"
    );
  }
  const apiKey = getApiKey();
  if (!apiKey) {
    throw unavailable("NOT_CONFIGURED", "elevenlabs-stt unavailable: ELEVENLABS_API_KEY not set");
  }
  void apiKey;
  const audioRelPath =
    (request.input && (request.input.audioPath || request.input.existingArtifactPath)) || null;
  if (!audioRelPath) {
    throw permanent("ELEVENLABS_STT_AUDIO_MISSING", "elevenlabs-stt requires input.audioPath");
  }
  try {
    store.resolveProjectPath(projectRoot, request.projectId, audioRelPath);
  } catch {
    throw permanent("PATH_TRAVERSAL_BLOCKED", `STT audio path escapes project: ${audioRelPath}`);
  }

  const transport = ctx.elevenlabsSttTransport;
  let transcript = null;
  let segments = null;
  if (typeof transport === "function") {
    let res;
    try {
      res = await transport({ audioRelPath });
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      if (isSafetyLike(message) || isSafetyLike(e && e.errorCode)) {
        return safetyFailed(request, message);
      }
      const statusCode = e && e.statusCode;
      if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599) || /timeout|network|econn/i.test(message)) {
        throw transient("ELEVENLABS_STT_TRANSIENT", `ElevenLabs STT transport error: ${message.slice(0, 300)}`);
      }
      throw permanent("ELEVENLABS_STT_PERMANENT", `ElevenLabs STT transport error: ${message.slice(0, 300)}`);
    }
    if (res && res.ok === false) {
      const message = `${res.errorCode || ""} ${res.message || ""}`;
      if (isSafetyLike(message)) return safetyFailed(request, message);
      const statusCode = res.statusCode || 400;
      const msg = `ElevenLabs STT request failed (http ${statusCode}): ${message.slice(0, 300)}`;
      if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
        throw transient("ELEVENLABS_STT_TRANSIENT", msg);
      }
      throw permanent("ELEVENLABS_STT_PERMANENT", msg);
    }
    transcript = res && typeof res.transcript === "string" ? res.transcript : null;
    segments = res && Array.isArray(res.segments) ? res.segments : [];
    if (!transcript) {
      throw permanent("ELEVENLABS_STT_PAYLOAD_UNEXPECTED", "ElevenLabs STT transport returned no transcript");
    }
  } else {
    throw unavailable(
      "CLOUD_TRANSPORT_NOT_CONFIGURED",
      "elevenlabs-stt live multipart upload not wired; inject ctx.elevenlabsSttTransport or use local-whisper"
    );
  }

  const timing = {
    version: "1.0.0",
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: CAPABILITY,
    providerId: PROVIDER_ID,
    sourceAudio: audioRelPath,
    transcript,
    segments,
    generatedAt: new Date().toISOString(),
  };
  const relPath = `timing/${store.sanitizeFilename(request.sceneId)}/${store.sanitizeFilename(request.requestId)}.json`;
  const timingPath = store.writeArtifactAtomic(
    projectRoot,
    request.projectId,
    relPath,
    JSON.stringify(timing, null, 2)
  );
  store.recordFingerprint(projectRoot, request.projectId, timingPath, fingerprintRequest(request));

  return {
    version: "1.0.0",
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: CAPABILITY,
    providerId: PROVIDER_ID,
    status: "READY",
    artifactPath: timingPath,
    timingArtifactPath: timingPath,
    mimeType: "application/json",
    metadata: { segmentCount: segments.length, transport: "mock" },
    generationDate: new Date().toISOString(),
    modelOrVersion: ctx.elevenlabsSttModel || "elevenlabs-stt-default",
    sourceType: "generated",
    provenanceNote: `Transcribed via ElevenLabs STT from ${audioRelPath}`,
    rightsStatus: "NOT_APPLICABLE",
    costClass: "PAID",
  };
}

function registerElevenlabsStt() {
  const { getProvider } = require("../registry");
  if (getProvider(PROVIDER_ID)) return PROVIDER_ID;
  registerProvider({
    providerId: PROVIDER_ID,
    capabilities: [CAPABILITY],
    costClass: "PAID",
    adapter: { execute },
    availabilityCheck,
  });
  return PROVIDER_ID;
}

module.exports = { execute, availabilityCheck, registerElevenlabsStt, providerId: PROVIDER_ID };
