"use strict";

/**
 * UNFOLDIQ cloud openai-image adapter (STEP-10C Branch C).
 *
 * providerId 'openai-image', capability image, costClass PAID.
 * Config-disabled by default: BOTH request.costConstraints.allowPaidCloud===true
 * AND ctx.enableCloud===true are required to attempt. Without request-level
 * allowPaidCloud the resolver skips this PAID provider (SKIPPED_COST_POLICY).
 * Secrets come from env OPENAI_API_KEY only — never logged, never persisted.
 * Missing key → unavailable NOT_CONFIGURED. Mock transport for tests via
 * ctx.openaiImageTransport (receives { prompt, size, model }, no secrets).
 * HTTP errors classified transient/permanent. Safety-like error text returns
 * { status:'FAILED', safetyRefusal } with no auto-retry and no prompt rewrite.
 */

const { registerProvider } = require("../registry");
const store = require("../artifact-store");
const { fingerprintRequest } = require("../request-fingerprint");
const { transient, permanent, unavailable } = require("../errors");

const PROVIDER_ID = "openai-image";
const CAPABILITY = "image";
const DEFAULT_MODEL = "openai-image-default";

function getApiKey() {
  return process.env.OPENAI_API_KEY || null;
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

function mapSize(request) {
  const out = request.outputRequirements || {};
  if (typeof out.size === "string" && out.size) return out.size;
  if (out.width && out.height) return `${out.width}x${out.height}`;
  if (request.input && typeof request.input.size === "string" && request.input.size) {
    return request.input.size;
  }
  return "1024x1024";
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
  const msg = `OpenAI image request failed (http ${statusCode}): ${String(bodyText || "").slice(0, 300)}`;
  if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599)) {
    throw transient("OPENAI_IMAGE_TRANSIENT", msg);
  }
  throw permanent("OPENAI_IMAGE_PERMANENT", msg);
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
    provenanceNote: "OpenAI image provider refused generation (safety/policy). No prompt rewrite attempted.",
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
  if (typeof mockRes.b64_json === "string" && mockRes.b64_json) {
    return Buffer.from(mockRes.b64_json, "base64");
  }
  return null;
}

async function execute(request, ctx = {}) {
  const projectRoot = ctx.projectRoot || require("path").join(__dirname, "..", "..", "..");
  if (request.capability !== CAPABILITY) {
    throw permanent("OPENAI_IMAGE_CAPABILITY_UNSUPPORTED", `openai-image supports image, got ${request.capability}`);
  }
  if (!cloudAttemptAllowed(request, ctx)) {
    throw unavailable(
      "CLOUD_NOT_ENABLED",
      "openai-image disabled: requires request.costConstraints.allowPaidCloud=true AND ctx.enableCloud=true"
    );
  }
  const apiKey = getApiKey();
  if (!apiKey) {
    throw unavailable("NOT_CONFIGURED", "openai-image unavailable: OPENAI_API_KEY not set");
  }
  const prompt = request.input && (request.input.prompt || request.input.text);
  if (!prompt) {
    throw permanent("OPENAI_IMAGE_PROMPT_MISSING", "openai-image requires input.prompt");
  }
  const size = mapSize(request);
  const model = ctx.openaiImageModel || ctx.model || DEFAULT_MODEL;

  let imageBytes = null;
  const transport = ctx.openaiImageTransport;
  if (typeof transport === "function") {
    let res;
    try {
      res = await transport({ prompt, size, model });
    } catch (e) {
      const message = e && e.message ? e.message : String(e);
      if (isSafetyLike(message) || isSafetyLike(e && e.errorCode)) {
        return safetyFailed(request, message);
      }
      const statusCode = e && e.statusCode;
      if (statusCode === 429 || (statusCode >= 500 && statusCode <= 599) || /timeout|network|econn/i.test(message)) {
        throw transient("OPENAI_IMAGE_TRANSIENT", `OpenAI image transport error: ${message.slice(0, 300)}`);
      }
      throw permanent("OPENAI_IMAGE_PERMANENT", `OpenAI image transport error: ${message.slice(0, 300)}`);
    }
    if (res && res.ok === false) {
      const message = `${res.errorCode || ""} ${res.message || ""}`;
      if (isSafetyLike(message)) return safetyFailed(request, message);
      throwClassified(res.statusCode || 400, message);
    }
    imageBytes = extractBytes(res);
    if (!imageBytes) {
      throw permanent("OPENAI_IMAGE_PAYLOAD_UNEXPECTED", "OpenAI image transport returned no image bytes");
    }
  } else {
    const { statusCode, body } = await httpsPostJson(
      "https://api.openai.com/v1/images/generations",
      { Authorization: "Bearer [REDACTED]" },
      { model, prompt, size, response_format: "b64_json" },
      30000
    );
    void apiKey;
    if (isSafetyLike(body)) return safetyFailed(request, body);
    if (statusCode < 200 || statusCode >= 300) throwClassified(statusCode, body);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw permanent("OPENAI_IMAGE_PAYLOAD_UNEXPECTED", "OpenAI image response was not JSON");
    }
    const b64 = parsed && parsed.data && parsed.data[0] && parsed.data[0].b64_json;
    if (!b64) {
      throw permanent("OPENAI_IMAGE_PAYLOAD_UNEXPECTED", "OpenAI image response carried no image payload");
    }
    imageBytes = Buffer.from(b64, "base64");
  }

  const relPath = `assets/image/${store.sanitizeFilename(request.sceneId)}/${store.sanitizeFilename(request.requestId)}.png`;
  const artifactPath = store.writeArtifactAtomic(projectRoot, request.projectId, relPath, imageBytes);
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
    mimeType: "image/png",
    metadata: { size, transport: typeof transport === "function" ? "mock" : "https" },
    generationDate: new Date().toISOString(),
    modelOrVersion: model,
    sourceType: "generated",
    provenanceNote: `Generated via OpenAI image API (model ${model})`,
    rightsStatus: "NOT_APPLICABLE",
    costClass: "PAID",
  };
}

function registerOpenaiImage() {
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

module.exports = { execute, availabilityCheck, registerOpenaiImage, providerId: PROVIDER_ID };
