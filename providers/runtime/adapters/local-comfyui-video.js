"use strict";

/**
 * Local ComfyUI video adapter (STEP-10C Branch A).
 * Hardware-policy gate FIRST; UNSUITABLE_BY_POLICY skips to next provider.
 */

const path = require("path");
const fs = require("fs");

const providerId = "local-comfyui-video";

function resolveRoot(ctx) {
  if (ctx && typeof ctx.projectRoot === "string") return ctx.projectRoot;
  return path.join(__dirname, "..", "..", "..");
}

function rejectUnsafeName(name) {
  const s = String(name || "");
  if (/^https?:\/\//i.test(s)) throw new Error(`OUTPUT_PATH_URL_REJECTED: ${s}`);
  if (path.isAbsolute(s)) throw new Error(`OUTPUT_PATH_ABSOLUTE_REJECTED: ${s}`);
  if (s.split(/[\\/]/).includes("..")) throw new Error(`OUTPUT_PATH_TRAVERSAL_REJECTED: ${s}`);
  return s;
}

function pickWorkflow(ctx, projectRoot) {
  const loader = require("../../local/comfyui/workflow-loader");
  if (ctx && typeof ctx.comfyuiWorkflowId === "string" && ctx.comfyuiWorkflowId.length > 0) {
    const found = loader.getWorkflow(ctx.comfyuiWorkflowId, projectRoot);
    if (!found) {
      const { permanent } = require("../errors");
      throw permanent("UNKNOWN_WORKFLOW", `unknown ComfyUI workflow: ${ctx.comfyuiWorkflowId}`);
    }
    if (found.capability !== "video") {
      const { permanent } = require("../errors");
      throw permanent("UNKNOWN_WORKFLOW", `workflow ${found.workflowId} is not a video workflow`);
    }
    return { entry: found, registry: loader.loadRegistry(projectRoot) };
  }
  const enabled = loader.listWorkflows({ capability: "video", enabledOnly: true }, projectRoot);
  if (enabled.length === 0) {
    const { unavailable } = require("../errors");
    throw unavailable("NOT_AVAILABLE", "no enabled local-comfyui video workflow");
  }
  return { entry: enabled[0], registry: loader.loadRegistry(projectRoot) };
}

function checkModels(entry, ctx, projectRoot) {
  const { unavailable } = require("../errors");
  const required = Array.isArray(entry.requiredModels) ? entry.requiredModels : [];
  const modelRoot =
    (ctx && typeof ctx.comfyuiModelRoot === "string" && ctx.comfyuiModelRoot) ||
    path.join(projectRoot, "providers", "local", "comfyui");
  const missing = [];
  for (const m of required) {
    const rel = typeof m === "string" ? m : m.path;
    const must = typeof m === "string" ? true : m.required !== false;
    if (!must) continue;
    if (!rel) continue;
    rejectUnsafeName(rel);
    const abs = path.resolve(modelRoot, rel);
    const relCheck = path.relative(path.resolve(modelRoot), abs);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
      missing.push(rel);
      continue;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) missing.push(rel);
  }
  if (missing.length > 0) {
    throw unavailable("MODEL_MISSING", `missing required model(s): ${missing.join(", ")}`);
  }
}

async function serverReachable(registry, ctx) {
  if (ctx && typeof ctx.comfyuiReachable === "boolean") return ctx.comfyuiReachable;
  if (ctx && ctx.comfyuiTransport && typeof ctx.comfyuiTransport.health === "function") {
    try {
      return (await ctx.comfyuiTransport.health()) === true;
    } catch {
      return false;
    }
  }
  if (ctx && ctx.comfyuiTransport && typeof ctx.comfyuiTransport.queuePrompt === "function") {
    return true;
  }
  try {
    const { Client } = require("../../local/comfyui/client");
    const server = (registry && registry.server) || { host: "127.0.0.1", port: 8188 };
    const client = new Client({ host: server.host, port: server.port, timeoutMs: 1500 });
    return await client.health();
  } catch {
    return false;
  }
}

async function execute(request, ctx) {
  const c = ctx || {};
  const projectRoot = resolveRoot(c);
  const { unavailable } = require("../errors");
  const timeoutPolicy = require("../timeout-policy");
  const artifactStore = require("../artifact-store");

  const { entry, registry } = pickWorkflow(c, projectRoot);

  const hwPolicy = require("../hardware-policy");
  const projectPolicy =
    (c && c.projectPolicy) || hwPolicy.loadProjectPolicy(projectRoot);
  const systemInfo = (c && c.systemInfo) || hwPolicy.getSystemInfo();
  const gate = hwPolicy.evaluateLocalVideoEligibility({
    workflowRequirements: entry.hardwareRequirements || {},
    systemInfo,
    projectPolicy,
  });
  if (gate.eligibility === "UNSUITABLE_BY_POLICY") {
    throw unavailable("UNSUITABLE_BY_POLICY", `local video blocked by policy: ${gate.reasons.join("; ")}`);
  }

  const reachable = await serverReachable(registry, c);
  if (!reachable) {
    throw unavailable("NOT_AVAILABLE", "ComfyUI server not reachable on loopback (127.0.0.1:8188)");
  }

  checkModels(entry, c, projectRoot);

  const { mapVideoParams } = require("../../local/comfyui/parameter-mapper");
  const patch = mapVideoParams(request, entry);

  const timeoutMs = timeoutPolicy.getTimeout("comfyui-video");
  let transport = c.comfyuiTransport || null;
  if (!transport) {
    const { Client } = require("../../local/comfyui/client");
    const server = (registry && registry.server) || { host: "127.0.0.1", port: 8188 };
    const client = new Client({ host: server.host, port: server.port, timeoutMs });
    transport = {
      queuePrompt: (p) => client.queuePrompt(p),
      pollHistory: (id, o) => client.pollHistory(id, o),
      getOutput: (id) => client.getOutput(id),
    };
  }

  const queueRes = await timeoutPolicy.withTimeout(
    Promise.resolve().then(() => transport.queuePrompt(patch)),
    timeoutMs,
    "TIMEOUT"
  );
  const promptId = typeof queueRes === "string" ? queueRes : queueRes && (queueRes.promptId || queueRes.prompt_id || queueRes.id);
  if (!promptId) throw unavailable("NOT_AVAILABLE", "ComfyUI queue returned no prompt id");

  if (typeof transport.pollHistory === "function") {
    await timeoutPolicy.withTimeout(
      Promise.resolve().then(() => transport.pollHistory(String(promptId), { timeoutMs, pollMs: 500 })),
      timeoutMs,
      "TIMEOUT"
    );
  } else {
    const { pollWithDeadline } = timeoutPolicy;
    await pollWithDeadline(
      async () => {
        const h = await transport.getOutput(String(promptId));
        if (h && (h.bytes || h.outputs || h[promptId])) return { done: true, value: h };
        return { done: false };
      },
      { timeoutMs, pollMs: 500 }
    );
  }

  const out = await timeoutPolicy.withTimeout(
    Promise.resolve().then(() => transport.getOutput(String(promptId))),
    timeoutMs,
    "TIMEOUT"
  );

  let bytes = null;
  if (out && out.bytes !== undefined) {
    bytes = Buffer.isBuffer(out.bytes) ? out.bytes : Buffer.from(out.bytes);
    if (typeof out.filename === "string" && out.filename.length > 0) rejectUnsafeName(out.filename);
  } else if (typeof out === "string") {
    rejectUnsafeName(out);
    const abs = path.resolve(projectRoot, out);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) bytes = fs.readFileSync(abs);
    else bytes = Buffer.from(out, "utf8");
  } else {
    const { extractOutputPath } = require("../../local/comfyui/client");
    let rel = null;
    try {
      rel = extractOutputPath(out, entry.outputNode);
    } catch (e) {
      throw unavailable("NOT_AVAILABLE", `ComfyUI output not found: ${e.message}`);
    }
    rejectUnsafeName(rel);
    const modelRoot =
      (c && typeof c.comfyuiModelRoot === "string" && c.comfyuiModelRoot) ||
      path.join(projectRoot, "providers", "local", "comfyui");
    const candidates = [path.resolve(modelRoot, rel), path.resolve(projectRoot, rel)];
    let found = null;
    for (const abs of candidates) {
      const base = abs.startsWith(path.resolve(modelRoot)) ? path.resolve(modelRoot) : path.resolve(projectRoot);
      const rc = path.relative(base, abs);
      if (rc.startsWith("..")) continue;
      if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
        found = abs;
        break;
      }
    }
    if (!found) throw unavailable("NOT_AVAILABLE", `ComfyUI output file not accessible: ${rel}`);
    bytes = fs.readFileSync(found);
  }

  const sceneId = String(request.sceneId || "scene");
  const requestId = String(request.requestId || "req");
  const safeScene = sceneId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "scene";
  const safeReq = requestId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64) || "req";
  const relPath = `assets/video/${safeScene}/${safeReq}.mp4`;
  const artifactPath = artifactStore.writeArtifactAtomic(projectRoot, request.projectId, relPath, bytes);
  const crypto = require("crypto");
  const fingerprint = crypto.createHash("sha256").update(bytes).digest("hex");
  artifactStore.recordFingerprint(projectRoot, request.projectId, artifactPath, fingerprint);

  const isMock = /mock/i.test(entry.workflowId);
  const cc = request.continuityContext || {};
  return {
    version: "1.0.0",
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: "video",
    providerId,
    status: "READY",
    artifactPath,
    sourceType: "generated",
    provenanceNote: `local ComfyUI video via workflow ${entry.workflowId}`,
    generationDate: new Date().toISOString(),
    rightsStatus: "NOT_APPLICABLE",
    costClass: "ZERO_LOCAL",
    metadata: { workflowId: entry.workflowId, mock: isMock, live: !isMock },
    continuity: {
      registryVersion: cc.registryVersion || null,
      entitiesUsed: cc.requiredEntities || [],
      referenceAssetIds: cc.requiredReferences || [],
      continuityStatus: ((cc.requiredEntities || []).length > 0 || (cc.requiredReferences || []).length > 0) ? "REVIEW_REQUIRED" : "NOT_APPLICABLE",
    },
  };
}

function registerLocalComfyuiVideo() {
  const { getProvider, registerProvider } = require("../registry");
  if (getProvider(providerId)) return providerId;
  registerProvider({
    providerId,
    capabilities: ["video"],
    costClass: "ZERO_LOCAL",
    adapter: { execute },
  });
  return providerId;
}

module.exports = { execute, providerId, registerLocalComfyuiVideo };
