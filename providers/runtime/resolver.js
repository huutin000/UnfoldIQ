"use strict";

/**
 * UNFOLDIQ universal provider resolver (STEP 10A).
 *
 * validate request
 * → rights/policy precondition (BLOCKED never bypassed)
 * → continuity precondition for STRICT requests
 * → fingerprint reuse of READY artifacts
 * → explicit existing artifact
 * → capability priority → cost filter → availability → execute
 * → validate result → READY / next / handoff / blocked
 *
 * Rules: BLOCKED never bypassed; NOT_AVAILABLE tries next; FAILED retries
 * only transient errors (bounded); no infinite retry; no regeneration of a
 * READY artifact with unchanged fingerprint; paid cloud disabled by default.
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const registry = require("./registry");
const store = require("./artifact-store");
const costPolicy = require("./cost-policy");
const { fingerprintRequest } = require("./request-fingerprint");
const { ProviderError } = require("./errors");
const { validateProviderResult } = require("../../lib/provider-result-check.js");

const MAX_TRANSIENT_ATTEMPTS = 2;
const VALID_CAPABILITIES = ["image", "video", "tts", "stt", "music", "sfx"];

function loadConfig(projectRoot) {
  try {
    const raw = fs.readFileSync(path.join(projectRoot, "providers", "CONFIG.yaml"), "utf8");
    return yaml.load(raw) || {};
  } catch {
    return { capabilities: {} };
  }
}

function validateRequestShape(request) {
  const missing = ["requestId", "projectId", "sceneId", "capability", "input", "outputRequirements"].filter(
    (k) => request[k] === undefined
  );
  if (missing.length > 0) return `missing fields: ${missing.join(",")}`;
  if (!VALID_CAPABILITIES.includes(request.capability)) return `invalid capability: ${request.capability}`;
  return null;
}

function blockedResult(request, errorCode, errorSummary, providerId = "resolver") {
  return {
    version: "1.0.0",
    requestId: request.requestId,
    projectId: request.projectId,
    sceneId: request.sceneId,
    capability: request.capability,
    providerId,
    status: "BLOCKED",
    sourceType: "existing",
    provenanceNote: `Resolver blocked: ${errorSummary}`,
    rightsStatus: "NOT_APPLICABLE",
    costClass: "ZERO_LOCAL",
    error: { errorCode, errorSummary, errorClass: "policy" },
  };
}

function candidateProviders(request, config) {
  const capCfg = (config.capabilities && config.capabilities[request.capability]) || {};
  const ordered = [];
  const seen = new Set();
  for (const id of request.providerPreference || []) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  for (const id of capCfg.preferredOrder || []) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }
  if (!ordered.includes("external-handoff")) ordered.push("external-handoff");
  return { ordered, enabled: capCfg.enabled !== false };
}

async function runAdapter(meta, request, ctx, tried) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt++) {
    try {
      const result = await meta.adapter.execute(request, { ...ctx, attempt });
      tried.push({ providerId: meta.providerId, attempt, outcome: result.status });
      return { result, retryable: false };
    } catch (e) {
      const errorClass = e instanceof ProviderError ? e.errorClass : "permanent";
      tried.push({ providerId: meta.providerId, attempt, outcome: `ERROR:${e.errorCode || e.message}`, errorClass });
      if (errorClass === "policy") return { blocked: true, error: e };
      if (errorClass === "transient" && attempt < MAX_TRANSIENT_ATTEMPTS) {
        lastError = e;
        continue;
      }
      return { failed: true, error: e };
    }
  }
  return { failed: true, error: lastError };
}

async function resolve(request, ctx = {}) {
  const projectRoot = ctx.projectRoot || path.join(__dirname, "..", "..");
  const tried = [];

  // 1. Validate request.
  const shapeError = validateRequestShape(request);
  if (shapeError) return blockedResult(request, "INVALID_REQUEST", shapeError);

  // 2. Rights/policy precondition — never bypassed.
  const rights = request.rightsContext || {};
  if (rights.blocked === true || rights.rightsStatus === "BLOCKED") {
    return blockedResult(request, "RIGHTS_POLICY_BLOCKED", "Rights/policy precondition forbids this request");
  }

  // 3. Continuity precondition for STRICT requests.
  const continuity = request.continuityContext || {};
  if (continuity.continuityStrictness === "STRICT" && (continuity.requiredEntities || []).length > 0) {
    const { checkContinuityPrecondition } = require("../../lib/continuity-check.js");
    const pre = checkContinuityPrecondition(
      { requiredEntities: continuity.requiredEntities, strictness: "STRICT" },
      continuity.registryPath
        ? store.readArtifact(projectRoot, request.projectId, continuity.registryPath).toString("utf8")
        : null,
      { projectRoot, projectId: request.projectId }
    );
    if (!pre.ok) {
      return {
        ...blockedResult(request, "CONTINUITY_PRECONDITION_UNMET", pre.reasons.join("; ")),
        continuityPrecondition: false,
      };
    }
  }

  const fingerprint = fingerprintRequest(request);

  // 4. Fingerprint reuse: same request + READY artifact → REUSE.
  const reuseHit = store.findByFingerprint(projectRoot, request.projectId, fingerprint);
  if (reuseHit) {
    return {
      version: "1.0.0",
      requestId: request.requestId,
      projectId: request.projectId,
      sceneId: request.sceneId,
      capability: request.capability,
      providerId: "existing",
      status: "READY",
      artifactPath: reuseHit,
      sourceType: "existing",
      provenanceNote: `Reused READY artifact with matching fingerprint ${fingerprint.slice(0, 12)}`,
      rightsStatus: rights.rightsStatus || "NOT_APPLICABLE",
      costClass: "ZERO_LOCAL",
      metadata: { reused: true, fingerprint },
    };
  }

  const config = loadConfig(projectRoot);
  const policy = costPolicy.loadCostPolicy(projectRoot);
  const allowPaid = (request.costConstraints && request.costConstraints.allowPaidCloud) === true || policy.allowPaidCloud;

  // 5. Explicit existing artifact (plain validity check; fingerprint-gated
  // reuse already happened in step 4 via the fingerprint index).
  if (request.input && request.input.existingArtifactPath) {
    const existing = registry.getProvider("existing");
    if (existing) {
      try {
        const result = await existing.adapter.execute(request, { ...ctx, projectRoot });
        const check = validateProviderResult(result, { projectRoot, checkExists: true });
        if (check.valid) return result;
      } catch (e) {
        if (e instanceof ProviderError && e.errorClass === "policy") {
          return blockedResult(request, e.errorCode, e.message, "existing");
        }
        if (e instanceof ProviderError && e.errorCode === "PATH_TRAVERSAL_BLOCKED") {
          return blockedResult(request, "PATH_TRAVERSAL_BLOCKED", e.message, "existing");
        }
        tried.push({ providerId: "existing", attempt: 1, outcome: `ERROR:${e.errorCode || e.message}` });
        // OUTDATED/missing → fall through to regenerate (never silently overwrite).
      }
    }
  }

  // 6-8. Priority → cost → availability → execute.
  const { ordered, enabled } = candidateProviders(request, config);
  if (!enabled) {
    return blockedResult(request, "CAPABILITY_DISABLED", `Capability ${request.capability} disabled in CONFIG.yaml`);
  }

  for (const providerId of ordered) {
    if (providerId === "existing" && request.input && request.input.existingArtifactPath) continue; // already tried
    const meta = registry.getProvider(providerId);
    if (!meta) continue; // unregistered future provider → skip safely
    if (!meta.capabilities.includes(request.capability)) continue;
    const cost = costPolicy.isProviderAllowed(meta, { allowPaidCloud: allowPaid });
    if (!cost.allowed) {
      tried.push({ providerId, attempt: 0, outcome: "SKIPPED_COST_POLICY" });
      continue;
    }
    if (meta.availabilityCheck) {
      let available = false;
      try {
        available = await meta.availabilityCheck(request, { ...ctx, projectRoot });
      } catch {
        available = false;
      }
      if (!available) {
        tried.push({ providerId, attempt: 0, outcome: "NOT_AVAILABLE" });
        continue;
      }
    }
    const run = await runAdapter(meta, request, { ...ctx, projectRoot }, tried);
    if (run.blocked) {
      return blockedResult(request, run.error.errorCode || "PROVIDER_BLOCKED", run.error.message, providerId);
    }
    if (run.failed) {
      // A failed attempt carrying structured safety-refusal evidence must be
      // surfaced honestly — never silently converted into a generic retry on
      // the next provider (STEP 10B-FIX / 10C §35A).
      const safetyEvidence = run.error && (run.error.safetyRefusal || run.error.refusalClass);
      if (safetyEvidence) {
        return {
          version: "1.0.0",
          requestId: request.requestId,
          projectId: request.projectId,
          sceneId: request.sceneId,
          capability: request.capability,
          providerId,
          status: "PROVIDER_SAFETY_REFUSED",
          sourceType: "generated",
          provenanceNote: `Provider safety refusal from ${providerId}: ${run.error.message}`,
          rightsStatus: rights.rightsStatus || "NOT_APPLICABLE",
          costClass: "UNKNOWN",
          safetyRefusal: run.error.safetyRefusal || { refusalClass: run.error.refusalClass || "UNKNOWN_SAFETY", message: run.error.message },
          error: { errorCode: run.error.errorCode || "PROVIDER_SAFETY_REFUSED", errorSummary: run.error.message, errorClass: "policy" },
        };
      }
      continue; // next provider; transient already retried bounded
    }
    const result = run.result;
    // Safety states are terminal for this request: surface them honestly,
    // never fall through to another provider as a silent technical retry.
    if (
      result.status === "PROVIDER_SAFETY_REFUSED" ||
      result.status === "SAFETY_ADAPTATION_REQUIRED" ||
      result.status === "SAFETY_ADAPTATION_PREPARED" ||
      result.status === "SAFE_FALLBACK_REQUIRED" ||
      (result.safetyRefusal && result.status !== "READY")
    ) {
      if (result.status === "FAILED" && result.safetyRefusal) {
        return { ...result, status: "PROVIDER_SAFETY_REFUSED", providerId: result.providerId || providerId };
      }
      return result;
    }
    if (result.status === "NOT_AVAILABLE") continue;
    const check = validateProviderResult(result, { projectRoot, checkExists: true });
    if (!check.valid && result.status === "READY") continue; // invalid READY → next provider
    if (result.status === "READY" || result.status === "HANDOFF_REQUIRED" || result.status === "AWAITING_USER_APPROVAL") {
      return result;
    }
  }

  // 9. No automated provider left → external handoff.
  const handoff = registry.getProvider("external-handoff");
  if (handoff) {
    const result = await handoff.adapter.execute(request, { ...ctx, projectRoot });
    tried.push({ providerId: "external-handoff", attempt: 1, outcome: result.status });
    return result;
  }
  return blockedResult(request, "NO_PROVIDER_AVAILABLE", "No automated provider and no handoff adapter");
}

module.exports = { resolve, candidateProviders, validateRequestShape, MAX_TRANSIENT_ATTEMPTS };
