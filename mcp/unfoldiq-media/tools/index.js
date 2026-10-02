"use strict";

/**
 * UNFOLDIQ media MCP tools (STEP-10C Branch C).
 * Single module exporting TOOL_DEFS + dispatch(toolName, args, ctx).
 * All generation paths delegate to the provider runtime resolver —
 * resolver logic is never duplicated here. ctx: { projectRoot }.
 */

const path = require("path");

const TOOL_DEFS = [
  {
    name: "media_capabilities",
    description: "List provider capability matrix with availability, cost class, and approval flags.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { projectId: { type: "string", minLength: 1 } },
    },
  },
  {
    name: "resolve_media_request",
    description: "Dry-run provider selection for a media request. No generation performed.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: { request: { type: "object" } },
    },
  },
  {
    name: "generate_image",
    description: "Resolve and execute an image request via the provider runtime.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: {
        request: { type: "object" },
        enableCloud: { type: "boolean" },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "generate_video",
    description: "Resolve and execute a video request via the provider runtime.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: {
        request: { type: "object" },
        enableCloud: { type: "boolean" },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "generate_tts",
    description: "Resolve and execute a TTS request via the provider runtime.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: {
        request: { type: "object" },
        enableCloud: { type: "boolean" },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "transcribe_media",
    description: "Resolve and execute an STT/timing request via the provider runtime.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["request"],
      properties: {
        request: { type: "object" },
        enableCloud: { type: "boolean" },
        timeoutMs: { type: "number" },
      },
    },
  },
  {
    name: "submit_media_result",
    description: "Validate and import an agent-produced media result as a READY artifact.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["submission"],
      properties: { submission: { type: "object" } },
    },
  },
  {
    name: "get_media_job",
    description: "Look up a Flow media job or provider fingerprint record by jobId.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["projectId", "jobId"],
      properties: {
        projectId: { type: "string", minLength: 1 },
        jobId: { type: "string", minLength: 1 },
      },
    },
  },
];

const SECRET_KEY_PATTERN = /secret|token|api[_-]?key|password|credential|auth/i;

function stripSecrets(value) {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_PATTERN.test(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out;
  }
  if (typeof value === "string" && /^(sk-|xox|ghp_|Bearer\s)/.test(value)) return "[REDACTED]";
  return value;
}

function promptSummaryOf(request) {
  const p = request && request.input && (request.input.prompt || request.input.text);
  return String(p || "").slice(0, 200);
}

function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label || "MCP"}_TIMEOUT after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).then(
    (v) => {
      clearTimeout(timer);
      return v;
    },
    (e) => {
      clearTimeout(timer);
      throw e;
    }
  );
}

let runtimeReady = false;
function ensureRuntime() {
  if (runtimeReady) return;
  const { registerCoreProviders } = require("../../../providers/runtime/bootstrap");
  registerCoreProviders();
  const guarded = [
    () => require("../../../providers/runtime/adapters/flow-web").registerFlowWeb(),
    () => require("../../../providers/runtime/adapters/local-comfyui-image").registerLocalComfyuiImage(),
    () => require("../../../providers/runtime/adapters/local-comfyui-video").registerLocalComfyuiVideo(),
    () => require("../../../providers/runtime/adapters/local-kokoro").registerLocalKokoro(),
    () => require("../../../providers/runtime/adapters/local-whisper").registerLocalWhisper(),
    () => require("../../../providers/runtime/adapters/cloud-openai-image").registerOpenaiImage(),
    () => require("../../../providers/runtime/adapters/cloud-google-veo").registerGoogleVeo(),
    () => require("../../../providers/runtime/adapters/cloud-elevenlabs-tts").registerElevenlabsTts(),
    () => require("../../../providers/runtime/adapters/cloud-elevenlabs-stt").registerElevenlabsStt(),
    () => require("../../../providers/runtime/adapters/configured-cloud").registerConfiguredCloud(),
  ];
  for (const fn of guarded) {
    try {
      fn();
    } catch {
      // Optional provider stays unregistered; resolver skips unknown IDs safely.
    }
  }
  runtimeReady = true;
}

function projectRootOf(ctx) {
  return (ctx && ctx.projectRoot) || path.join(__dirname, "..", "..", "..");
}

function requireRequestFields(request) {
  const missing = ["requestId", "projectId", "sceneId", "capability", "input", "outputRequirements"].filter(
    (k) => !request || request[k] === undefined
  );
  if (missing.length > 0) throw new Error(`INVALID_REQUEST: missing fields ${missing.join(",")}`);
}

function safetyPrecheck(request) {
  const rights = request.rightsContext || {};
  if (rights.blocked === true || rights.rightsStatus === "BLOCKED") {
    return { status: "BLOCKED", reason: "RIGHTS_POLICY_BLOCKED" };
  }
  const att = request.safetyAttestation || {};
  if (att.step09Decision === "BLOCKED" || att.step09Decision === "BLOCK") {
    return { status: "BLOCKED", reason: "STEP09_BLOCKED_TERMINAL" };
  }
  return null;
}

async function mediaCapabilities(args, ctx) {
  ensureRuntime();
  const registry = require("../../../providers/runtime/registry");
  const projectRoot = projectRootOf(ctx);
  const rows = [];
  for (const p of registry.listProviders()) {
    const meta = registry.getProvider(p.providerId);
    for (const cap of p.capabilities) {
      let availability = "UNKNOWN";
      if (typeof meta.availabilityCheck === "function") {
        const probe = {
          version: "1.0.0",
          requestId: "MCP-PROBE",
          projectId: (args && args.projectId) || "probe",
          sceneId: "probe",
          capability: cap,
          input: {},
          outputRequirements: {},
          costConstraints: { allowPaidCloud: false },
        };
        try {
          const ok = await withTimeout(
            Promise.resolve(meta.availabilityCheck(probe, { projectRoot })),
            1200,
            "AVAILABILITY"
          );
          availability = ok === true ? "AVAILABLE" : "UNAVAILABLE";
        } catch {
          availability = "UNKNOWN";
        }
      } else if (p.providerId === "existing" || p.providerId === "approved-local" || p.providerId === "external-handoff") {
        availability = "AVAILABLE";
      }
      const row = {
        provider: p.providerId,
        capability: cap,
        availability,
        costClass: p.costClass,
        approvalRequired: p.providerId === "flow-web" || p.costClass === "PAID" || p.costClass === "UNKNOWN",
      };
      if (cap === "tts" || cap === "stt") {
        if (p.providerId === "elevenlabs-tts" || p.providerId === "elevenlabs-stt") {
          row.languages = "multi-language (see ElevenLabs docs)";
        }
      }
      if (p.providerId === "flow-web") row.hardwareOrPolicy = "Google subscription/credits; user approval required";
      if (p.providerId === "agent-native") row.hardwareOrPolicy = "bridge-injected only; BRIDGE_NOT_CONFIGURED by default";
      rows.push(row);
    }
  }
  return stripSecrets({ status: "READY", providers: rows });
}

async function resolveMediaRequest(args, ctx) {
  ensureRuntime();
  const request = args.request;
  requireRequestFields(request);
  const blocked = safetyPrecheck(request);
  if (blocked) {
    return { status: "BLOCKED", reason: blocked.reason, requestId: request.requestId, dryRun: true, generated: false };
  }
  const fs = require("fs");
  const yaml = require("js-yaml");
  const { candidateProviders } = require("../../../providers/runtime/resolver");
  const projectRoot = projectRootOf(ctx);
  const config = yaml.load(fs.readFileSync(path.join(projectRoot, "providers", "CONFIG.yaml"), "utf8"));
  const { ordered, enabled } = candidateProviders(request, config);
  return stripSecrets({
    status: "DRY_RUN",
    dryRun: true,
    generated: false,
    requestId: request.requestId,
    capability: request.capability,
    enabled,
    candidateOrder: ordered,
    promptSummary: promptSummaryOf(request),
    note: "Dry run only: candidate order previewed, no provider executed, no generation performed.",
  });
}

function resolveTimeoutMs(args) {
  const t = args && args.timeoutMs;
  if (typeof t === "number" && t > 0 && t <= 120000) return t;
  return 60000;
}

function resolveEnableCloud(args) {
  return (args && args.enableCloud) === true || process.env.UNFOLDIQ_ENABLE_CLOUD === "1";
}

function mapResolveResult(result, request) {
  if (result && result.safetyRefusal) {
    return stripSecrets({
      status: "PROVIDER_SAFETY_REFUSED",
      refusal: result.safetyRefusal,
      providerId: result.providerId,
      requestId: result.requestId,
      promptSummary: promptSummaryOf(request),
    });
  }
  if (!result) return { status: "FAILED", error: { errorCode: "MCP_EMPTY_RESULT", errorSummary: "Empty resolver result" } };
  if (result.status === "READY") {
    return stripSecrets({
      status: "READY",
      artifactPath: result.artifactPath,
      timingArtifactPath: result.timingArtifactPath || null,
      providerId: result.providerId,
      requestId: result.requestId,
      promptSummary: promptSummaryOf(request),
    });
  }
  if (result.status === "AWAITING_USER_APPROVAL" || result.status === "HANDOFF_REQUIRED" || result.status === "BLOCKED") {
    return stripSecrets({
      status: result.status,
      providerId: result.providerId,
      requestId: result.requestId,
      approval: result.approval || null,
      handoffPath: result.handoffPath || null,
      error: result.error || null,
      promptSummary: promptSummaryOf(request),
    });
  }
  return stripSecrets({
    status: result.status || "FAILED",
    providerId: result.providerId || null,
    requestId: result.requestId || (request && request.requestId),
    error: result.error || null,
    promptSummary: promptSummaryOf(request),
  });
}

async function runResolveTool(toolName, capability, args, ctx) {
  ensureRuntime();
  const request = args.request;
  requireRequestFields(request);
  if (request.capability !== capability) {
    throw new Error(`INVALID_REQUEST: ${toolName} requires capability ${capability}, got ${request.capability}`);
  }
  const blocked = safetyPrecheck(request);
  if (blocked) {
    return { status: "BLOCKED", reason: blocked.reason, requestId: request.requestId };
  }
  const { resolve } = require("../../../providers/runtime/resolver");
  const projectRoot = projectRootOf(ctx);
  const runCtx = { projectRoot };
  if (resolveEnableCloud(args)) runCtx.enableCloud = true;
  let result;
  try {
    result = await withTimeout(resolve(request, runCtx), resolveTimeoutMs(args), toolName.toUpperCase());
  } catch (e) {
    return {
      status: "FAILED",
      requestId: request.requestId,
      error: { errorCode: /TIMEOUT/.test(e.message) ? "MCP_TIMEOUT" : "MCP_RESOLVE_ERROR", errorSummary: String(e.message).slice(0, 300) },
    };
  }
  return mapResolveResult(result, request);
}

async function submitMediaResult(args, ctx) {
  ensureRuntime();
  const s = args.submission;
  if (!s || typeof s !== "object") throw new Error("INVALID_SUBMISSION: submission object required");
  const missing = ["version", "requestId", "projectId", "sceneId", "capability", "providerId", "artifactPath", "provenanceNote", "rightsStatus"].filter(
    (k) => s[k] === undefined
  );
  if (missing.length > 0) throw new Error(`INVALID_SUBMISSION: missing fields ${missing.join(",")}`);
  if (s.step09Decision === "BLOCKED" || s.step09Decision === "BLOCK") {
    return { status: "BLOCKED", reason: "STEP09_BLOCKED_TERMINAL", requestId: s.requestId };
  }
  if (s.rightsContext && (s.rightsContext.blocked === true || s.rightsContext.rightsStatus === "BLOCKED")) {
    return { status: "BLOCKED", reason: "RIGHTS_POLICY_BLOCKED", requestId: s.requestId };
  }
  // SAFE-E2E6: a safety-refused job cannot convert to READY without a valid
  // new result path + explicit superseding attestation.
  if (s.safetyAttestation && s.safetyAttestation.notSafetyRefused === false && s.supersedesRefusal !== true) {
    throw new Error("SAFETY_REFUSAL_UNRESOLVED: refused job requires supersedesRefusal=true with a valid new artifact");
  }
  const projectRoot = projectRootOf(ctx);
  const store = require("../../../providers/runtime/artifact-store");
  let resolved;
  try {
    resolved = store.resolveProjectPath(projectRoot, s.projectId, s.artifactPath);
  } catch {
    throw new Error(`PATH_TRAVERSAL_BLOCKED: ${s.artifactPath}`);
  }
  void resolved;
  if (!store.artifactExists(projectRoot, s.projectId, s.artifactPath)) {
    throw new Error(`SUBMISSION_ARTIFACT_MISSING: ${s.artifactPath}`);
  }
  if (s.fingerprint) {
    store.recordFingerprint(projectRoot, s.projectId, s.artifactPath, s.fingerprint);
  }
  const result = {
    version: "1.0.0",
    requestId: s.requestId,
    projectId: s.projectId,
    sceneId: s.sceneId,
    capability: s.capability,
    providerId: s.providerId,
    status: "READY",
    artifactPath: s.artifactPath,
    ...(s.timingArtifactPath ? { timingArtifactPath: s.timingArtifactPath } : {}),
    ...(s.mimeType ? { mimeType: s.mimeType } : {}),
    generationDate: new Date().toISOString(),
    ...(s.modelOrVersion ? { modelOrVersion: s.modelOrVersion } : {}),
    sourceType: "generated",
    provenanceNote: s.provenanceNote,
    rightsStatus: s.rightsStatus,
    costClass: s.costClass || "UNKNOWN",
  };
  const { validateProviderResult } = require("../../../lib/provider-result-check.js");
  const check = validateProviderResult(result, { projectRoot, checkExists: true });
  if (!check.valid) {
    throw new Error(`SUBMISSION_INVALID: ${check.errors.map((e) => e.code).join(",")}`);
  }
  return stripSecrets({ status: "READY", requestId: s.requestId, artifactPath: s.artifactPath, providerId: s.providerId });
}

async function getMediaJob(args, ctx) {
  ensureRuntime();
  const { projectId, jobId } = args;
  if (!projectId || !jobId) throw new Error("INVALID_REQUEST: projectId + jobId required");
  if (typeof jobId !== "string" || jobId.includes("..") || jobId.includes("/") || jobId.includes("\\") || path.isAbsolute(jobId)) {
    throw new Error(`PATH_TRAVERSAL_BLOCKED: ${jobId}`);
  }
  const projectRoot = projectRootOf(ctx);
  const jobStore = require("../../../flow-companion/bridge/job-store");
  let job = null;
  try {
    job = jobStore.getJob(projectRoot, projectId, jobId);
  } catch {
    job = null;
  }
  if (job) {
    return stripSecrets({
      status: "FOUND",
      source: "flow-job-store",
      job: {
        jobId: job.jobId,
        requestId: job.requestId,
        projectId: job.projectId,
        sceneId: job.sceneId,
        capability: job.capability,
        mode: job.mode,
        jobStatus: job.status,
        attempt: job.attempt,
        promptSummary: String(job.prompt || "").slice(0, 200),
      },
    });
  }
  const store = require("../../../providers/runtime/artifact-store");
  const index = store.readFingerprintIndex(projectRoot, projectId);
  const hits = Object.entries(index)
    .filter(([artifactPath]) => artifactPath.includes(jobId))
    .map(([artifactPath, fingerprint]) => ({ artifactPath, fingerprint: String(fingerprint).slice(0, 16) }));
  if (hits.length > 0) {
    return stripSecrets({ status: "FOUND", source: "fingerprint-index", matches: hits });
  }
  return { status: "NOT_FOUND", projectId, jobId };
}

async function dispatch(toolName, args, ctx) {
  const a = args || {};
  switch (toolName) {
    case "media_capabilities":
      return mediaCapabilities(a, ctx);
    case "resolve_media_request":
      return resolveMediaRequest(a, ctx);
    case "generate_image":
      return runResolveTool("generate_image", "image", a, ctx);
    case "generate_video":
      return runResolveTool("generate_video", "video", a, ctx);
    case "generate_tts":
      return runResolveTool("generate_tts", "tts", a, ctx);
    case "transcribe_media":
      return runResolveTool("transcribe_media", "stt", a, ctx);
    case "submit_media_result":
      return submitMediaResult(a, ctx);
    case "get_media_job":
      return getMediaJob(a, ctx);
    default:
      throw new Error(`UNKNOWN_TOOL: ${toolName}`);
  }
}

module.exports = { TOOL_DEFS, dispatch, stripSecrets };
