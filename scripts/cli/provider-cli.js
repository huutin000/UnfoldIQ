"use strict";

/**
 * UNFOLDIQ provider CLI — core only (STEP 10A).
 *   node scripts/cli/provider-cli.js --validate <request.json>
 *   node scripts/cli/provider-cli.js --dry-run <request.json>
 *   node scripts/cli/provider-cli.js --execute <request.json> [--project-root <dir>]
 * --execute runs only currently implemented safe providers
 * (existing, approved-local, injected agent-native bridge, external-handoff).
 * No remote vendor calls.
 */

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const { registerCoreProviders } = require("../../providers/runtime/bootstrap.js");
const { resolve, candidateProviders } = require("../../providers/runtime/resolver.js");

function loadJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function loadRequestSchema() {
  const raw = fs.readFileSync(path.join(PROJECT_ROOT, "schemas", "provider-request.schema.json"), "utf8");
  return JSON.parse(raw);
}

function validateRequest(request) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(loadRequestSchema());
  const valid = validate(request);
  return { valid, errors: validate.errors || [] };
}

function registerStep10CProviders() {
  const candidates = [
    "./providers/runtime/adapters/local-comfyui-image",
    "./providers/runtime/adapters/local-comfyui-video",
    "./providers/runtime/adapters/local-kokoro",
    "./providers/runtime/adapters/local-whisper",
    "./providers/runtime/adapters/cloud-openai-image",
    "./providers/runtime/adapters/cloud-google-veo",
    "./providers/runtime/adapters/cloud-elevenlabs-tts",
    "./providers/runtime/adapters/cloud-elevenlabs-stt",
    "./providers/runtime/adapters/configured-cloud",
  ];
  for (const modPath of candidates) {
    try {
      const mod = require(modPath);
      const fns = Object.keys(mod)
        .filter((k) => /^register/i.test(k) && typeof mod[k] === "function")
        .map((k) => mod[k]);
      for (const fn of fns) {
        try {
          fn();
        } catch {
          // individual register failure must not break the CLI
        }
      }
    } catch {
      // adapter file absent (other branch / not implemented) → skip safely
    }
  }
}

const AGENT_SUBMIT_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".mp4", ".wav", ".mp3", ".json", ".txt"];

function validateAgentSubmission(doc) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const schema = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "providers", "agent-native", "result-submission.schema.json"), "utf8")
  );
  const validate = ajv.compile(schema);
  const valid = validate(doc);
  return { valid, errors: validate.errors || [] };
}

async function submitAgentResult(resultFile, projectRoot) {
  const store = require("../../providers/runtime/artifact-store.js");
  const doc = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  const check = validateAgentSubmission(doc);
  console.log(`schema: ${check.valid ? "VALID" : "INVALID"}`);
  if (!check.valid) {
    console.log(JSON.stringify(check.errors, null, 2));
    process.exit(1);
  }
  const att = doc.safetyAttestation;
  if (att.step09Decision === "BLOCKED") {
    console.log(JSON.stringify({ status: "BLOCKED", requestId: doc.requestId, errorCode: "SAFETY_BLOCKED" }, null, 2));
    process.exit(2);
  }
  if (att.notSafetyRefused === false && !att.refusalReason) {
    console.error("SUBMIT_REJECTED: notSafetyRefused=false requires refusalReason or a new valid path");
    process.exit(1);
  }
  const src = doc.artifactSourcePath;
  if (typeof src !== "string" || src.startsWith("..") || path.isAbsolute(src) || /^https?:\/\//i.test(src) || src.includes("..")) {
    console.error(`SUBMIT_REJECTED: unsafe artifactSourcePath: ${src}`);
    process.exit(1);
  }
  // Verify projectId/sceneId dirs resolve safely (reject traversal/absolute/http).
  try {
    store.resolveProjectPath(projectRoot, doc.projectId, `assets/${doc.capability}/${doc.sceneId}/.probe`);
  } catch (e) {
    console.error(`SUBMIT_REJECTED: invalid project/scene path: ${e.message}`);
    process.exit(1);
  }
  if (!store.artifactExists(projectRoot, doc.projectId, src)) {
    console.error(`SUBMIT_REJECTED: artifactSourcePath not found in project: ${src}`);
    process.exit(1);
  }
  const ext = path.extname(src).toLowerCase();
  if (!AGENT_SUBMIT_EXTS.includes(ext)) {
    console.error(`SUBMIT_REJECTED: extension not allowed: ${ext}`);
    process.exit(1);
  }
  const bytes = store.readArtifact(projectRoot, doc.projectId, src);
  if (!bytes || bytes.length === 0) {
    console.error("SUBMIT_REJECTED: artifact is empty");
    process.exit(1);
  }
  const destRel = `assets/${doc.capability}/${store.sanitizeFilename(doc.sceneId)}/${store.sanitizeFilename(doc.requestId)}-agent${ext}`;
  store.writeArtifactAtomic(projectRoot, doc.projectId, destRel, bytes);
  const submittedAt = new Date().toISOString();
  try {
    const { fingerprintRequest } = require("../../providers/runtime/request-fingerprint.js");
    store.recordFingerprint(projectRoot, doc.projectId, destRel, `${doc.agentName}/${doc.toolName}/${submittedAt}`);
    void fingerprintRequest;
  } catch {
    // fingerprint best-effort
  }
  const out = {
    version: "1.0.0",
    requestId: doc.requestId,
    projectId: doc.projectId,
    sceneId: doc.sceneId,
    capability: doc.capability,
    providerId: "agent-native",
    status: "READY",
    artifactPath: destRel,
    sourceType: "generated",
    provenanceNote: `Agent-native submission by ${doc.agentName}/${doc.toolName} submittedAt ${submittedAt}`,
    generationDate: submittedAt,
    rightsStatus: "NOT_APPLICABLE",
    costClass: "ZERO_LOCAL",
    metadata: { agentName: doc.agentName, toolName: doc.toolName, submittedAt },
    ...(doc.continuityMetadata
      ? { continuity: { entitiesUsed: doc.continuityMetadata.entitiesUsed || [], referenceAssetIds: doc.continuityMetadata.referenceAssetIds || [] } }
      : { continuity: null }),
  };
  console.log(JSON.stringify(out, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (mode === "--submit-agent-result") {
    const file = args[1];
    if (!file) {
      console.error("Usage: node scripts/cli/provider-cli.js --submit-agent-result <result.json> [--project-root <dir>]");
      process.exit(1);
    }
    const rootIdx = args.indexOf("--project-root");
    const projectRoot = rootIdx >= 0 && args[rootIdx + 1] ? path.resolve(args[rootIdx + 1]) : PROJECT_ROOT;
    await submitAgentResult(path.resolve(file), projectRoot);
    return;
  }
  const file = args[1];
  if (!["--validate", "--dry-run", "--execute"].includes(mode) || !file) {
    console.error("Usage: node scripts/cli/provider-cli.js --validate|--dry-run|--execute <request.json> [--project-root <dir>]");
    console.error("       node scripts/cli/provider-cli.js --submit-agent-result <result.json> [--project-root <dir>]");
    process.exit(1);
  }
  const rootIdx = args.indexOf("--project-root");
  const projectRoot = rootIdx >= 0 && args[rootIdx + 1] ? path.resolve(args[rootIdx + 1]) : PROJECT_ROOT;

  const request = loadJson(file);
  const check = validateRequest(request);
  console.log(`schema: ${check.valid ? "VALID" : "INVALID"}`);
  if (!check.valid) {
    console.log(JSON.stringify(check.errors, null, 2));
    process.exit(1);
  }
  if (mode === "--validate") return;

  registerCoreProviders();
  try {
    require("../../providers/runtime/adapters/flow-web.js").registerFlowWeb();
  } catch {
    // flow-web optional for dry-run preview; resolver skips unregistered IDs safely
  }
  registerStep10CProviders();
  if (mode === "--dry-run") {
    const yaml = require("js-yaml");
    const config = yaml.load(fs.readFileSync(path.join(projectRoot, "providers", "CONFIG.yaml"), "utf8"));
    const { ordered, enabled } = candidateProviders(request, config);
    const out = { requestId: request.requestId, capability: request.capability, enabled, plannedOrder: ordered };
    const cc = request.continuityContext || {};
    if ((cc.requiredEntities || []).length > 0 || (cc.requiredReferences || []).length > 0) {
      out.continuity = {
        strictness: cc.continuityStrictness || "NOT_APPLICABLE",
        requiredEntities: cc.requiredEntities || [],
        requiredReferences: cc.requiredReferences || [],
      };
    }
    if (ordered.includes("flow-web") && (request.capability === "image" || request.capability === "video")) {
      out.flowJobPreview = {
        mode: "ASSISTED_APPROVAL (default; MANUAL_ASSIST when bridge unreachable)",
        expectedOutputPath: `assets/${request.capability}/${request.sceneId}/${request.sceneId}_attempt-01.${request.capability === "video" ? "mp4" : "png"}`,
        approvalRequired: true,
        note: "Dry run only: no job created, no generation performed.",
      };
    }
    console.log(JSON.stringify(out, null, 2));
    return;
  }

  const result = await resolve(request, { projectRoot });
  console.log(JSON.stringify(result, null, 2));
  if (result.status === "BLOCKED" || result.status === "FAILED") process.exit(2);
}

main().catch((e) => {
  console.error(`CLI_ERROR: ${e.message}`);
  process.exit(1);
});
