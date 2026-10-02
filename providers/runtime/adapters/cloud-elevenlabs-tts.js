"use strict";

/**
 * UNFOLDIQ cloud elevenlabs-tts adapter (STEP-10C Branch C).
 *
 * providerId 'elevenlabs-tts', capability tts, costClass PAID.
 * Config-disabled by default: BOTH request.costConstraints.allowPaidCloud===true
 * AND ctx.enableCloud===true are required to attempt. Without request-level
 * allowPaidCloud the resolver skips this PAID provider (SKIPPED_COST_POLICY).
 * Secrets from env ELEVENLABS_API_KEY only — never logged, never persisted.
 * Missing key → unavailable NOT_CONFIGURED. Mock transport for tests via
 * ctx.elevenlabsTtsTransport ({ text, voice, speed }, no secrets).
 * HTTP errors classified transient/permanent. Safety-like error text returns
 * { status:'FAILED', safetyRefusal } with no auto-retry and no prompt rewrite.
 */

const { registerProvider } = require("../registry");
const store = require("../artifact-store");
const { fingerprintRequest } = require("../request-fingerprint");
const { transient, permanent, unavailable } = require("../errors");

const PROVIDER_ID = "elevenlabs-tts";
const CAPABILITY = "tts";
const DEFAULT_VOICE = "elevenlabs-default-voice";

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

function httpsPostBinary(urlString, headers, payload, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (e) {
      reject(permanent("CLOUD_BAD_URL", `Invalid cloud URL: ${e.message}`));
      return;
    }
    const lib = url.protocol === "https:" ? require("https") : require("http");
    const body = JSON.stringify(payload);
    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolvePromise({ statusCode: res.statusCode || 0, bytes: Buffer.concat(chunks) })
        );
      }
    );
    req.on("error", (e) => reject(transient("CLOUD_NETWORK_ERROR", `Cloud network error: ${e.message}`)));
    req.on("timeout", () => req.destroy(transient("CLOUD_TIMEOUT", "Cloud request timed out")));
    req.write(body);
    req.end();
  });
}

function throwClassified(statusCode, bodyText) {
  const msg = `ElevenLabs TTS request failed (http ${statusCode}): ${String(bodyText || "").slice(0, 300)}`;
  if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
    throw transient("ELEVENLABS_TTS_TRANSIENT", msg);
  }
  throw permanent("ELEVENLABS_TTS_PERMANENT", msg);
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
    provenanceNote: "ElevenLabs TTS provider refused synthesis (safety/policy). No prompt rewrite attempted.",
    rightsStatus: "NOT_APPLICABLE",
    costClass: "PAID",
    safetyRefusal: {
      refusalClass: "UNKNOWN_SAFETY",
      message: String(message || "provider safety refusal").slice(0, 500),
    },
    error: {
      errorCode: "PROVIDER_SAFETY_REFUSAL",
      errorSummary: "Provider refused synthesis (safety/policy). No auto-retry, no prompt rewrite.",
      errorClass: "permanent",
    },
  };
}

function extractBytes(mockRes) {
  if (!mockRes || typeof mockRes !== "object") return null;
  if (Buffer.isBuffer(mockRes.bytes)) return mockRes.bytes;
  if (typeof mockRes.bytesBase64 === "string" && mockRes.bytesBase64) {
    return Buffer.from(mockRes.bytesBase64, "base64");
  }
  return null;
}

async function execute(request, ctx = {}) {
  const path = require("path");
  const projectRoot = ctx.projectRoot || path.join(__dirname, "..", "..", "..");
  if (request.capability !== CAPABILITY) {
    throw permanent("ELEVENLABS_TTS_CAPABILITY_UNSUPPORTED", `elevenlabs-tts supports tts, got ${request.capability}`);
  }
  if (!cloudAttemptAllowed(request, ctx)) {
    throw unavailable(
      "CLOUD_NOT_ENABLED",
      "elevenlabs-tts disabled: requires request.costConstraints.allowPaidCloud=true AND ctx.enableCloud=true"
    );
  }
  const apiKey = getApiKey();
  if (!apiKey) {
    throw unavailable("NOT_CONFIGURED", "elevenlabs-tts unavailable: ELEVENLABS_API_KEY not set");
  }
  const text = request.input && (request.input.text || request.input.prompt);
  if (!text) {
    throw permanent("ELEVENLABS_TTS_TEXT_MISSING", "elevenlabs-tts requires input.text");
  }
  const out = request.outputRequirements || {};
  const voice =
    (request.input && request.input.voice) || out.voice || ctx.elevenlabsVoice || DEFAULT_VOICE;
  const speed =
    (request.input && request.input.speed) || out.speed || ctx.elevenlabsSpeed || 1.0;

  let audioBytes = null;
  const transport = ctx.elevenlabsTtsTransport;
  if (typeof transport === "function") {
    let res;
    try {
      res = await transport({ text, voice, speed });
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      if (isSafetyLike(message) || isSafetyLike(e && e.errorCode)) {
        return safetyFailed(request, message);
      }
      const statusCode = e && e.statusCode;
      if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599) || /timeout|network|econn/i.test(message)) {
        throw transient("ELEVENLABS_TTS_TRANSIENT", `ElevenLabs TTS transport error: ${message.slice(0, 300)}`);
      }
      throw permanent("ELEVENLABS_TTS_PERMANENT", `ElevenLabs TTS transport error: ${message.slice(0, 300)}`);
    }
    if (res && res.ok === false) {
      const message = `${res.errorCode || ""} ${res.message || ""}`;
      if (isSafetyLike(message)) return safetyFailed(request, message);
      throwClassified(res.statusCode || 400, message);
    }
    audioBytes = extractBytes(res);
    if (!audioBytes) {
      throw permanent("ELEVENLABS_TTS_PAYLOAD_UNEXPECTED", "ElevenLabs TTS transport returned no audio bytes");
    }
  } else {
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(String(voice))}`;
    const { statusCode, bytes } = await httpsPostBinary(
      endpoint,
      { "xi-api-key": "[REDACTED]" },
      { text, model_id: ctx.elevenlabsModel || "eleven_multilingual_v2" },
      30000
    );
    void apiKey;
    const asText = bytes.slice(0, 512).toString("utf8");
    if (isSafetyLike(asText)) return safetyFailed(request, asText);
    if (statusCode < 200 || statusCode >= 300) throwClassified(statusCode, asText);
    if (!bytes || bytes.length === 0) {
      throw permanent("ELEVENLABS_TTS_PAYLOAD_UNEXPECTED", "ElevenLabs TTS response carried no audio payload");
    }
    audioBytes = bytes;
  }

  const relPath = `assets/voice/${store.sanitizeFilename(request.sceneId)}/${store.sanitizeFilename(request.requestId)}.mp3`;
  const artifactPath = store.writeArtifactAtomic(projectRoot, request.projectId, relPath, audioBytes);
  store.recordFingerprint(projectRoot, request.projectId, artifactPath, fingerprintRequest(request));

  return {
    version: "1.0.0",
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: CAPABILITY,
    providerId: PROVIDER_ID,
    status: "READY",
    artifactPath,
    mimeType: "audio/mpeg",
    metadata: { voice, speed, transport: typeof transport === "function" ? "mock" : "https" },
    generationDate: new Date().toISOString(),
    modelOrVersion: ctx.elevenlabsModel || "elevenlabs-tts-default",
    sourceType: "generated",
    provenanceNote: `Synthesized via ElevenLabs TTS (voice ${voice})`,
    rightsStatus: "NOT_APPLICABLE",
    costClass: "PAID",
  };
}

function registerElevenlabsTts() {
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

module.exports = { execute, availabilityCheck, registerElevenlabsTts, providerId: PROVIDER_ID };
