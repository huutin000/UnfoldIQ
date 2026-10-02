"use strict";

/**
 * UNFOLDIQ cloud google-veo adapter (STEP-10C Branch C).
 *
 * providerId 'google-veo', capability video, costClass PAID.
 * Config-disabled by default: BOTH request.costConstraints.allowPaidCloud===true
 * AND ctx.enableCloud===true are required to attempt. Without request-level
 * allowPaidCloud the resolver skips this PAID provider (SKIPPED_COST_POLICY).
 * Secrets from env GEMINI_API_KEY (also accepts GOOGLE_API_KEY) only — never
 * logged, never persisted. Missing key → unavailable NOT_CONFIGURED.
 * Mock transport for tests via ctx.googleVeoTransport (no secrets).
 * HTTP errors classified transient/permanent. Safety-like error text returns
 * { status:'FAILED', safetyRefusal } with no auto-retry and no prompt rewrite.
 *
 * NOTE: generationLength here is a provider render hint only. It never feeds
 * the Stage duration contract (duration-planner / duration-check own that).
 */

const { registerProvider } = require("../registry");
const store = require("../artifact-store");
const { fingerprintRequest } = require("../request-fingerprint");
const { transient, permanent, unavailable } = require("../errors");

const PROVIDER_ID = "google-veo";
const CAPABILITY = "video";
const DEFAULT_MODEL = "google-veo-default";

function getApiKey() {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null;
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

function throwClassified(statusCode, bodyText) {
  const msg = `Google Veo request failed (http ${statusCode}): ${String(bodyText || "").slice(0, 300)}`;
  if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
    throw transient("GOOGLE_VEO_TRANSIENT", msg);
  }
  throw permanent("GOOGLE_VEO_PERMANENT", msg);
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
    provenanceNote: "Google Veo provider refused generation (safety/policy). No prompt rewrite attempted.",
    rightsStatus: "NOT_APPLICABLE",
    costClass: "PAID",
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
    throw permanent("GOOGLE_VEO_CAPABILITY_UNSUPPORTED", `google-veo supports video, got ${request.capability}`);
  }
  if (!cloudAttemptAllowed(request, ctx)) {
    throw unavailable(
      "CLOUD_NOT_ENABLED",
      "google-veo disabled: requires request.costConstraints.allowPaidCloud=true AND ctx.enableCloud=true"
    );
  }
  const apiKey = getApiKey();
  if (!apiKey) {
    throw unavailable("NOT_CONFIGURED", "google-veo unavailable: GEMINI_API_KEY (or GOOGLE_API_KEY) not set");
  }
  const prompt = request.input && (request.input.prompt || request.input.text);
  if (!prompt) {
    throw permanent("GOOGLE_VEO_PROMPT_MISSING", "google-veo requires input.prompt");
  }
  const out = request.outputRequirements || {};
  // Render hints only — never feed the Stage duration contract.
  const aspectRatio = out.aspectRatio || (request.input && request.input.aspectRatio) || "16:9";
  const generationLength = out.generationLength || (request.input && request.input.generationLength) || null;
  const model = ctx.googleVeoModel || ctx.model || DEFAULT_MODEL;

  let videoBytes = null;
  const transport = ctx.googleVeoTransport;
  if (typeof transport === "function") {
    let res;
    try {
      res = await transport({ prompt, aspectRatio, generationLength, model });
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      if (isSafetyLike(message) || isSafetyLike(e && e.errorCode)) {
        return safetyFailed(request, message);
      }
      const statusCode = e && e.statusCode;
      if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599) || /timeout|network|econn/i.test(message)) {
        throw transient("GOOGLE_VEO_TRANSIENT", `Google Veo transport error: ${message.slice(0, 300)}`);
      }
      throw permanent("GOOGLE_VEO_PERMANENT", `Google Veo transport error: ${message.slice(0, 300)}`);
    }
    if (res && res.ok === false) {
      const message = `${res.errorCode || ""} ${res.message || ""}`;
      if (isSafetyLike(message)) return safetyFailed(request, message);
      throwClassified(res.statusCode || 400, message);
    }
    videoBytes = extractBytes(res);
    if (!videoBytes) {
      throw permanent("GOOGLE_VEO_PAYLOAD_UNEXPECTED", "Google Veo transport returned no video bytes");
    }
  } else {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predict`;
    const { statusCode, body } = await httpsPostJson(
      endpoint,
      { "x-goog-api-key": "[REDACTED]" },
      { prompt, aspectRatio, generationLength },
      30000
    );
    void apiKey;
    if (isSafetyLike(body)) return safetyFailed(request, body);
    if (statusCode < 200 || statusCode >= 300) throwClassified(statusCode, body);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw permanent("GOOGLE_VEO_PAYLOAD_UNEXPECTED", "Google Veo response was not JSON");
    }
    const b64 =
      (parsed && parsed.videoBytesBase64) ||
      (parsed && parsed.video && parsed.video.bytesBase64) ||
      (parsed && parsed.bytesBase64);
    if (!b64) {
      throw permanent(
        "GOOGLE_VEO_PAYLOAD_UNEXPECTED",
        "Google Veo response carried no direct video payload (long-running polling not wired; use Flow path)"
      );
    }
    videoBytes = Buffer.from(b64, "base64");
  }

  const relPath = `assets/video/${store.sanitizeFilename(request.sceneId)}/${store.sanitizeFilename(request.requestId)}.mp4`;
  const artifactPath = store.writeArtifactAtomic(projectRoot, request.projectId, relPath, videoBytes);
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
    mimeType: "video/mp4",
    metadata: {
      aspectRatio,
      transport: typeof transport === "function" ? "mock" : "https",
    },
    generationDate: new Date().toISOString(),
    modelOrVersion: model,
    sourceType: "generated",
    provenanceNote: `Generated via Google Veo API (model ${model})`,
    rightsStatus: "NOT_APPLICABLE",
    costClass: "PAID",
  };
}

function registerGoogleVeo() {
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

module.exports = { execute, availabilityCheck, registerGoogleVeo, providerId: PROVIDER_ID };
