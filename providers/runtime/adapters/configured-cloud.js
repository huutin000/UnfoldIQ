"use strict";

/**
 * UNFOLDIQ operator-configured cloud slots (STEP-10C Branch C).
 *
 * Generic providerIds: configured-cloud-image / configured-cloud-video /
 * configured-cloud-tts / configured-cloud-stt, one capability each.
 * costClass UNKNOWN — never claims FREE_TIER; unknown cost stays UNKNOWN.
 *
 * Enabled only when ALL hold:
 *   1. env UNFOLDIQ_CONFIGURED_CLOUD_<CAP>_ENDPOINT + _KEY both set
 *      (<CAP> = IMAGE | VIDEO | TTS | STT), env-only secrets;
 *   2. ctx.enableCloud === true;
 *   3. request.costConstraints.allowPaidCloud === true.
 * Missing endpoint/key → unavailable NOT_CONFIGURED.
 * Mock transport for tests via ctx.configuredCloudTransport
 * ({ providerId, capability, input }, no secrets).
 * Result metadata always { costClass:'UNKNOWN', verifiedAt:null,
 * source:'operator-configured' }. HTTP errors classified
 * transient/permanent. Safety-like error text returns
 * { status:'FAILED', safetyRefusal } with no auto-retry and no prompt rewrite.
 */

const { registerProvider, getProvider } = require("../registry");
const store = require("../artifact-store");
const { fingerprintRequest } = require("../request-fingerprint");
const { transient, permanent, unavailable } = require("../errors");

const SLOTS = [
  { providerId: "configured-cloud-image", capability: "image", envCap: "IMAGE" },
  { providerId: "configured-cloud-video", capability: "video", envCap: "VIDEO" },
  { providerId: "configured-cloud-tts", capability: "tts", envCap: "TTS" },
  { providerId: "configured-cloud-stt", capability: "stt", envCap: "STT" },
];

const OPERATOR_METADATA = { costClass: "UNKNOWN", verifiedAt: null, source: "operator-configured" };

function slotEnv(slot) {
  return {
    endpoint: process.env[`UNFOLDIQ_CONFIGURED_CLOUD_${slot.envCap}_ENDPOINT`] || null,
    key: process.env[`UNFOLDIQ_CONFIGURED_CLOUD_${slot.envCap}_KEY`] || null,
  };
}

function slotAttemptAllowed(slot, request, ctx) {
  const { endpoint, key } = slotEnv(slot);
  return (
    !!endpoint &&
    !!key &&
    !!ctx &&
    ctx.enableCloud === true &&
    !!request &&
    !!request.costConstraints &&
    request.costConstraints.allowPaidCloud === true
  );
}

function makeAvailabilityCheck(slot) {
  return async function availabilityCheck(request, ctx = {}) {
    try {
      if (request && request.capability && request.capability !== slot.capability) return false;
      return slotAttemptAllowed(slot, request, ctx);
    } catch {
      return false;
    }
  };
}

function isSafetyLike(text) {
  return /block|refus|policy|safety|moderat|content.?filter|prohibited|disallowed|restricted/i.test(
    String(text || "")
  );
}

function httpsPostJson(urlString, headers, payload, timeoutMs) {
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
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.on("data", (c) => {
          data += c;
        });
        res.on("end", () => resolvePromise({ statusCode: res.statusCode || 0, body: data }));
      }
    );
    req.on("error", (e) => reject(transient("CLOUD_NETWORK_ERROR", `Cloud network error: ${e.message}`)));
    req.on("timeout", () => req.destroy(transient("CLOUD_TIMEOUT", "Cloud request timed out")));
    req.write(body);
    req.end();
  });
}

function safetyFailed(slot, request, message) {
  return {
    version: "1.0.0",
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: slot.capability,
    providerId: slot.providerId,
    status: "FAILED",
    sourceType: "generated",
    provenanceNote: `${slot.providerId} refused generation (safety/policy). No prompt rewrite attempted.`,
    rightsStatus: "NOT_APPLICABLE",
    costClass: "UNKNOWN",
    metadata: { ...OPERATOR_METADATA },
    safetyRefusal: {
      refusalClass: "UNKNOWN_SAFETY",
      message: String(message || "provider safety refusal").slice(0, 500),
    },
    error: {
      errorCode: "PROVIDER_SAFETY_REFUSAL",
      errorSummary: "Provider refused generation (safety/policy). No auto-retry, no prompt rewrite.",
      errorClass: "permanent",
    },
  };
}

function mapInput(slot, request) {
  const out = request.outputRequirements || {};
  const input = request.input || {};
  if (slot.capability === "image") {
    return { prompt: input.prompt || input.text || null, size: out.size || input.size || "1024x1024" };
  }
  if (slot.capability === "video") {
    // generationLength is a provider render hint only; never feeds the Stage duration contract.
    return {
      prompt: input.prompt || input.text || null,
      aspectRatio: out.aspectRatio || input.aspectRatio || "16:9",
      generationLength: out.generationLength || input.generationLength || null,
    };
  }
  if (slot.capability === "tts") {
    return { text: input.text || input.prompt || null, voice: input.voice || out.voice || "default", speed: input.speed || out.speed || 1.0 };
  }
  return { audioRelPath: input.audioPath || input.existingArtifactPath || null };
}

function artifactRelPath(slot, request, ext) {
  const scene = store.sanitizeFilename(request.sceneId);
  const id = store.sanitizeFilename(request.requestId);
  if (slot.capability === "image") return `assets/image/${scene}/${id}.${ext}`;
  if (slot.capability === "video") return `assets/video/${scene}/${id}.${ext}`;
  if (slot.capability === "tts") return `assets/voice/${scene}/${id}.${ext}`;
  return `timing/${scene}/${id}.json`;
}

function makeExecute(slot) {
  return async function execute(request, ctx = {}) {
    const path = require("path");
    const projectRoot = ctx.projectRoot || path.join(__dirname, "..", "..", "..");
    if (request.capability !== slot.capability) {
      throw permanent(
        "CONFIGURED_CLOUD_CAPABILITY_UNSUPPORTED",
        `${slot.providerId} supports ${slot.capability}, got ${request.capability}`
      );
    }
    const { endpoint, key } = slotEnv(slot);
    if (!endpoint || !key) {
      throw unavailable("NOT_CONFIGURED", `${slot.providerId} unavailable: endpoint/key env not both set`);
    }
    if (!ctx || ctx.enableCloud !== true || !request.costConstraints || request.costConstraints.allowPaidCloud !== true) {
      throw unavailable(
        "CLOUD_NOT_ENABLED",
        `${slot.providerId} disabled: requires ctx.enableCloud=true AND request.costConstraints.allowPaidCloud=true`
      );
    }
    void key;
    const mapped = mapInput(slot, request);
    const primary = slot.capability === "tts" ? mapped.text : mapped.prompt || mapped.audioRelPath;
    if (!primary) {
      throw permanent("CONFIGURED_CLOUD_INPUT_MISSING", `${slot.providerId} requires prompt/text/audio input`);
    }
    if (mapped.audioRelPath) {
      try {
        store.resolveProjectPath(projectRoot, request.projectId, mapped.audioRelPath);
      } catch {
        throw permanent("PATH_TRAVERSAL_BLOCKED", `STT audio path escapes project: ${mapped.audioRelPath}`);
      }
    }

    const transport = ctx.configuredCloudTransport;
    let payload = null;
    if (typeof transport === "function") {
      let res;
      try {
        res = await transport({ providerId: slot.providerId, capability: slot.capability, input: mapped });
      } catch (e) {
        const message = e && e.message ? e.message : String(e);
        if (isSafetyLike(message) || isSafetyLike(e && e.errorCode)) {
          return safetyFailed(slot, request, message);
        }
        const statusCode = e && e.statusCode;
        if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599) || /timeout|network|econn/i.test(message)) {
          throw transient("CONFIGURED_CLOUD_TRANSIENT", `Configured cloud error: ${message.slice(0, 300)}`);
        }
        throw permanent("CONFIGURED_CLOUD_PERMANENT", `Configured cloud error: ${message.slice(0, 300)}`);
      }
      if (res && res.ok === false) {
        const message = `${res.errorCode || ""} ${res.message || ""}`;
        if (isSafetyLike(message)) return safetyFailed(slot, request, message);
        const statusCode = res.statusCode || 400;
        const msg = `Configured cloud failed (http ${statusCode}): ${message.slice(0, 300)}`;
        if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
          throw transient("CONFIGURED_CLOUD_TRANSIENT", msg);
        }
        throw permanent("CONFIGURED_CLOUD_PERMANENT", msg);
      }
      payload = res;
    } else {
      const { statusCode, body } = await httpsPostJson(
        endpoint,
        { Authorization: "Bearer [REDACTED]" },
        { capability: slot.capability, input: mapped },
        30000
      );
      if (isSafetyLike(body)) return safetyFailed(slot, request, body);
      if (statusCode < 200 || statusCode >= 300) {
        const msg = `Configured cloud failed (http ${statusCode}): ${String(body || "").slice(0, 300)}`;
        if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
          throw transient("CONFIGURED_CLOUD_TRANSIENT", msg);
        }
        throw permanent("CONFIGURED_CLOUD_PERMANENT", msg);
      }
      try {
        payload = JSON.parse(body);
      } catch {
        throw permanent("CONFIGURED_CLOUD_PAYLOAD_UNEXPECTED", "Configured cloud response was not JSON");
      }
    }

    let bytes = null;
    let timing = null;
    if (slot.capability === "stt") {
      const transcript = payload && typeof payload.transcript === "string" ? payload.transcript : null;
      if (!transcript) {
        throw permanent("CONFIGURED_CLOUD_PAYLOAD_UNEXPECTED", "Configured cloud STT returned no transcript");
      }
      timing = {
        version: "1.0.0",
        requestId: request.requestId,
        projectId: request.projectId,
        sceneId: request.sceneId,
        capability: slot.capability,
        providerId: slot.providerId,
        sourceAudio: mapped.audioRelPath,
        transcript,
        segments: Array.isArray(payload.segments) ? payload.segments : [],
        generatedAt: new Date().toISOString(),
      };
    } else {
      if (Buffer.isBuffer(payload && payload.bytes)) bytes = payload.bytes;
      else if (payload && typeof payload.bytesBase64 === "string" && payload.bytesBase64) {
        bytes = Buffer.from(payload.bytesBase64, "base64");
      } else {
        throw permanent("CONFIGURED_CLOUD_PAYLOAD_UNEXPECTED", "Configured cloud returned no media bytes");
      }
    }

    const ext = slot.capability === "image" ? "png" : slot.capability === "video" ? "mp4" : slot.capability === "tts" ? "mp3" : "json";
    const data = timing ? JSON.stringify(timing, null, 2) : bytes;
    const artifactPath = store.writeArtifactAtomic(projectRoot, request.projectId, artifactRelPath(slot, request, ext), data);
    store.recordFingerprint(projectRoot, request.projectId, artifactPath, fingerprintRequest(request));

    const base = {
      version: "1.0.0",
      requestId: request.requestId,
      projectId: request.projectId,
      sceneId: request.sceneId,
      capability: slot.capability,
      providerId: slot.providerId,
      status: "READY",
      artifactPath,
      metadata: { ...OPERATOR_METADATA, transport: typeof transport === "function" ? "mock" : "https" },
      generationDate: new Date().toISOString(),
      modelOrVersion: (payload && payload.model) || "operator-configured-default",
      sourceType: "generated",
      provenanceNote: `Generated via operator-configured cloud slot ${slot.providerId}`,
      rightsStatus: "NOT_APPLICABLE",
      costClass: "UNKNOWN",
    };
    if (slot.capability === "stt") {
      base.timingArtifactPath = artifactPath;
      base.mimeType = "application/json";
    } else {
      base.mimeType = slot.capability === "image" ? "image/png" : slot.capability === "video" ? "video/mp4" : "audio/mpeg";
    }
    return base;
  };
}

function registerConfiguredCloud() {
  for (const slot of SLOTS) {
    if (getProvider(slot.providerId)) continue;
    registerProvider({
      providerId: slot.providerId,
      capabilities: [slot.capability],
      costClass: "UNKNOWN",
      adapter: { execute: makeExecute(slot) },
      availabilityCheck: makeAvailabilityCheck(slot),
    });
  }
  return SLOTS.map((s) => s.providerId);
}

module.exports = { registerConfiguredCloud, SLOTS, providerIds: SLOTS.map((s) => s.providerId) };
