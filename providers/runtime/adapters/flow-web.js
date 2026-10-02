"use strict";

/**
 * flow-web provider adapter (STEP 10B).
 * Human-in-the-loop Google Flow generation through the Flow Companion.
 * Cost class INCLUDED_SUBSCRIPTION: user subscription/credits are consumed —
 * NOT unlimited, NOT permanently free, NOT zero-cost forever.
 *
 * Behavior: validate rights/policy/continuity → create Flow Job → persist →
 * AWAITING_USER_APPROVAL (ASSISTED_APPROVAL) or HANDOFF_REQUIRED with a
 * manual-assist packet (MANUAL_ASSIST / bridge unreachable). No fake READY.
 * No generation before explicit approval (enforced by the job state machine).
 */

const path = require("path");
const { registerProvider } = require("../registry");
const store = require("../../../flow-companion/bridge/job-store");
const { buildManualAssistPacket } = require("../../../flow-companion/bridge/manual-assist");
const { checkContinuityPrecondition } = require("../../../lib/continuity-check.js");
const artifactStore = require("../artifact-store");

function bridgeBaseUrl(ctx) {
  return (ctx && ctx.flowBridgeUrl) || process.env.FLOW_BRIDGE_URL || null;
}

async function bridgeReachable(ctx) {
  if (ctx && ctx.flowBridgeReachable === true) return true; // injected test/operator signal
  if (ctx && ctx.flowBridgeReachable === false) return false;
  const base = bridgeBaseUrl(ctx);
  if (!base) return false;
  try {
    const http = require("http");
    const url = new URL("/health", base);
    const ok = await new Promise((resolve) => {
      const req = http.get({ hostname: url.hostname, port: url.port || 80, path: "/health", timeout: 1500 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.on("timeout", () => {
        req.destroy();
        resolve(false);
      });
    });
    return ok;
  } catch {
    return false;
  }
}

function buildJob(request, ctx = {}) {
  const cc = request.continuityContext || {};
  const refs = [];
  const seen = new Set();
  for (const id of cc.requiredReferences || []) {
    if (!seen.has(id)) {
      seen.add(id);
      refs.push({ assetId: id, path: `continuity/refs/${id}` });
    }
  }
  const manual = ctx.manualAssist === true;
  return {
    version: "1.0.0",
    jobId: request.flowJobId || `FLOW-${request.sceneId}-A${String(request.flowAttempt || 1).padStart(2, "0")}`,
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: request.capability,
    mode: manual ? "MANUAL_ASSIST" : "ASSISTED_APPROVAL",
    prompt: (request.input && (request.input.prompt || request.input.text)) || "",
    platform: request.platform || "youtube",
    flowProject: request.flowProject || { mode: "REUSE", displayName: `UNFOLDIQ — ${request.projectId}` },
    outputRequirements: request.outputRequirements || {},
    creativeContext: {
      contentModeSummary: (request.creativeContext && request.creativeContext.contentModeSummary) || null,
      creativeDirectionSummary: (request.creativeContext && request.creativeContext.creativeDirectionSummary) || null,
    },
    continuityContext: {
      strictness: cc.continuityStrictness || "NOT_APPLICABLE",
      requiredEntities: cc.requiredEntities || [],
      referenceAssetIds: (cc.requiredEntities || []).length > 0 ? [...(cc.requiredEntities || [])] : [],
      registryVersion: cc.registryVersion || null,
    },
    referenceAssets: refs,
    ...(cc.startFrameRef ? { startFrame: { assetId: "START_FRAME", path: cc.startFrameRef } } : {}),
    ...(cc.endFrameRef ? { endFrame: { assetId: "END_FRAME", path: cc.endFrameRef } } : {}),
    ...(request.modelPreference ? { modelPreference: request.modelPreference } : {}),
    ...(request.outputRequirements && request.outputRequirements.aspectRatio ? { aspectRatio: request.outputRequirements.aspectRatio } : {}),
    ...(request.outputRequirements && request.outputRequirements.generationLength ? { generationLength: request.outputRequirements.generationLength } : {}),
    outputCount: (request.outputRequirements && request.outputRequirements.outputCount) || 1,
    expectedOutputPath: `assets/${request.capability}/${request.sceneId}/${request.sceneId}_attempt-${String(request.flowAttempt || 1).padStart(2, "0")}.${request.capability === "video" ? "mp4" : "png"}`,
    status: "PENDING",
    attempt: request.flowAttempt || 1,
    creditMetadata: { source: "FLOW_UI_OR_VERIFIED_POLICY", estimatedCredits: null, stale: false },
  };
}

async function execute(request, ctx = {}) {
  const projectRoot = ctx.projectRoot || path.join(__dirname, "..", "..", "..");
  if (!["image", "video"].includes(request.capability)) {
    const { permanent } = require("../errors");
    throw permanent("FLOW_CAPABILITY_UNSUPPORTED", `flow-web supports image/video, got ${request.capability}`);
  }

  // Continuity precondition re-checked at adapter level (resolver also checks).
  const cc = request.continuityContext || {};
  if (cc.continuityStrictness === "STRICT" && (cc.requiredEntities || []).length > 0) {
    let registryData = null;
    if (cc.registryPath) {
      registryData = artifactStore.readArtifact(projectRoot, request.projectId, cc.registryPath).toString("utf8");
    }
    const pre = checkContinuityPrecondition(
      { requiredEntities: cc.requiredEntities, strictness: "STRICT" },
      registryData,
      { projectRoot, projectId: request.projectId }
    );
    if (!pre.ok) {
      const { policyBlocked } = require("../errors");
      throw policyBlocked("CONTINUITY_PRECONDITION_UNMET", pre.reasons.join("; "));
    }
  }

  const job = buildJob(request, ctx);
  const created = store.createJob(projectRoot, job);
  store.transitionJob(projectRoot, request.projectId, created.jobId, "VALIDATED", { actor: "flow-web" });
  const prepared = store.transitionJob(projectRoot, request.projectId, created.jobId, "PREPARED", { actor: "flow-web" });
  void prepared;

  const reachable = await bridgeReachable(ctx);
  if (ctx.manualAssist === true || !reachable) {
    const packet = buildManualAssistPacket(store.getJob(projectRoot, request.projectId, created.jobId));
    const handoffRel = `handoff/${created.jobId}-manual-assist.json`;
    const handoffPath = artifactStore.writeArtifactAtomic(projectRoot, request.projectId, handoffRel, JSON.stringify(packet, null, 2));
    store.transitionJob(projectRoot, request.projectId, created.jobId, "MANUAL_ASSIST_REQUIRED", { actor: "flow-web" });
    return {
      version: "1.0.0",
      requestId: request.requestId,
      projectId: request.projectId,
      sceneId: request.sceneId,
      capability: request.capability,
      providerId: "flow-web",
      status: "HANDOFF_REQUIRED",
      sourceType: "external-handoff",
      provenanceNote: `Flow manual-assist packet for job ${created.jobId}`,
      rightsStatus: "NOT_APPLICABLE",
      costClass: "INCLUDED_SUBSCRIPTION",
      handoffPath,
      continuity: {
        registryVersion: cc.registryVersion || null,
        entitiesUsed: cc.requiredEntities || [],
        referenceAssetIds: (cc.requiredEntities || []).slice(),
        continuityStatus: (cc.requiredEntities || []).length > 0 ? "REVIEW_REQUIRED" : "NOT_APPLICABLE",
      },
    };
  }

  const awaiting = store.transitionJob(projectRoot, request.projectId, created.jobId, "AWAITING_USER_APPROVAL", { actor: "flow-web" });
  void awaiting;
  const stored = store.getJob(projectRoot, request.projectId, created.jobId);
  const c = stored.continuityContext || {};
  return {
    version: "1.0.0",
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: request.capability,
    providerId: "flow-web",
    status: "AWAITING_USER_APPROVAL",
    sourceType: "generated",
    provenanceNote: `Flow job ${created.jobId} prepared; awaiting user approval (no generation yet)`,
    rightsStatus: "NOT_APPLICABLE",
    costClass: "INCLUDED_SUBSCRIPTION",
    approval: {
      action: "Generate via Google Flow",
      jobId: created.jobId,
      attempt: stored.attempt,
      project: request.projectId,
      scene: request.sceneId,
      capability: request.capability,
      modelPreference: stored.modelPreference || "Flow default / detected",
      aspectRatio: stored.aspectRatio || null,
      generationLength: stored.generationLength || null,
      outputCount: stored.outputCount || 1,
      referenceCount: (stored.referenceAssets || []).length,
      promptSummary: String(stored.prompt).slice(0, 200),
      creditNote: "Cost metadata UNKNOWN until verified in Flow UI — never treated as 0.",
    },
    continuity: {
      registryVersion: c.registryVersion || null,
      entitiesUsed: c.requiredEntities || [],
      referenceAssetIds: c.referenceAssetIds || [],
      continuityStatus: (c.requiredEntities || []).length > 0 ? "REVIEW_REQUIRED" : "NOT_APPLICABLE",
    },
  };
}

async function availabilityCheck(request, ctx = {}) {
  if (!["image", "video"].includes(request.capability)) return false;
  if (ctx.manualAssist === true) return true; // manual-assist path always possible
  return bridgeReachable(ctx);
}

function registerFlowWeb() {
  const { getProvider } = require("../registry");
  if (getProvider("flow-web")) return "flow-web";
  registerProvider({
    providerId: "flow-web",
    capabilities: ["image", "video"],
    costClass: "INCLUDED_SUBSCRIPTION",
    adapter: { execute },
    availabilityCheck,
  });
  return "flow-web";
}

/**
 * Flow origin-compatibility helper (STEP-10C Branch A, appended only).
 * Reads a Flow Companion extension manifest's host_permissions +
 * content_scripts matches and reports whether the canonical entrypoint
 * and/or an observed origin are covered. Fail-safe: unknown origin →
 * ORIGIN_NOT_COVERED; no observed + no manifest info → ORIGIN_NOT_VERIFIED.
 */
const FLOW_CANONICAL_ENTRYPOINT = "https://flow.google.com/";
const FLOW_KNOWN_FINAL_ORIGINS = ["https://labs.google/fx", "https://flow.google", "https://flow.google.com"];

function checkFlowOriginCoverage(manifest, observedOrigin) {
  const m = manifest && typeof manifest === "object" ? manifest : {};
  const patterns = [];
  if (Array.isArray(m.host_permissions)) {
    for (const p of m.host_permissions) {
      if (typeof p === "string") patterns.push(p);
    }
  }
  const cs = Array.isArray(m.content_scripts) ? m.content_scripts : m.contentScripts;
  if (Array.isArray(cs)) {
    for (const entry of cs) {
      const matches = entry && Array.isArray(entry.matches) ? entry.matches : [];
      for (const p of matches) {
        if (typeof p === "string") patterns.push(p);
      }
    }
  }
  const hasAllUrls = patterns.some((p) => p === "<all_urls>");
  const covers = (origin) => {
    if (!origin || typeof origin !== "string") return false;
    if (hasAllUrls) return false; // <all_urls> is not accepted as coverage
    if (patterns.includes(origin)) return true;
    if (patterns.includes(`${origin}/*`)) return true;
    if (patterns.includes(`${origin}/`)) return true;
    return false;
  };
  const canonical = FLOW_CANONICAL_ENTRYPOINT;
  const observed = typeof observedOrigin === "string" && observedOrigin.length > 0 ? observedOrigin : null;
  const canonicalCovered = covers("https://flow.google") || covers(canonical.replace(/\/$/, ""));
  const knownCovered = FLOW_KNOWN_FINAL_ORIGINS.some((o) => covers(o));
  if (!observed && patterns.length === 0) {
    return {
      canonical,
      observed,
      covered: false,
      status: "ORIGIN_NOT_VERIFIED",
      detail: "no observed origin and no manifest host_permissions/content_scripts matches to verify",
    };
  }
  if (observed) {
    const ok = covers(observed);
    return {
      canonical,
      observed,
      covered: ok,
      status: ok ? "ORIGIN_COVERED" : "ORIGIN_NOT_COVERED",
      detail: ok
        ? `observed origin ${observed} covered by manifest`
        : `observed origin ${observed} not covered by manifest (fail-safe)`,
    };
  }
  const ok = canonicalCovered || knownCovered;
  return {
    canonical,
    observed,
    covered: ok,
    status: ok ? "ORIGIN_COVERED" : "ORIGIN_NOT_VERIFIED",
    detail: ok ? "manifest covers a known Flow origin" : "no observed origin; manifest does not confirm coverage",
  };
}

module.exports = {
  execute,
  availabilityCheck,
  registerFlowWeb,
  buildJob,
  providerId: "flow-web",
  FLOW_CANONICAL_ENTRYPOINT,
  FLOW_KNOWN_FINAL_ORIGINS,
  checkFlowOriginCoverage,
};
