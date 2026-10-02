"use strict";

/**
 * Safety provider-integration tests (STEP 10C §35B): SAFE-E2E1–SAFE-E2E8.
 * Preserves SR1–SR20 semantics across runtime, MCP, doctor, cloud,
 * agent-native submission, and external handoff. No live calls.
 * Fixtures under projects/__10c_safe__/ (removed in teardown).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__10c_safe__";
const CTX = { projectRoot: ROOT };

const { registerAllProviders } = require("../../providers/runtime/bootstrap.js");
const { resolve } = require("../../providers/runtime/resolver.js");
const tools = require("../../mcp/unfoldiq-media/tools/index.js");

let passed = 0;
let failed = 0;

function assert(c, m) {
  if (!c) throw new Error(`ASSERTION FAILED: ${m}`);
  console.log(`  ok ${m}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => {
      console.log(`[FAIL] ${name}: ${e.message}`);
      failed++;
    });
}

function teardown() {
  fs.rmSync(path.join(ROOT, "projects", PROJECT), { recursive: true, force: true });
}

function base(over = {}) {
  return {
    version: "1.0.0",
    requestId: `SE-${Math.random().toString(36).slice(2, 8)}`,
    projectId: PROJECT,
    sceneId: "S05",
    capability: "image",
    input: { prompt: "safe test image" },
    outputRequirements: {},
    ...over,
  };
}

async function main() {
  console.log("=== SAFETY PROVIDER INTEGRATION (SAFE-E2E1-8) ===\n");
  registerAllProviders();

  await runTest("SAFE-E2E1 Flow safety refusal surfaced via MCP as provider-safety state", async () => {
    const cloud = require("../../providers/runtime/adapters/cloud-openai-image.js");
    process.env.OPENAI_API_KEY = "sk-fake-safe-key";
    const failing = {
      ...cloud,
      execute: async (req) => ({
        version: "1.0.0", requestId: req.requestId, projectId: req.projectId, sceneId: req.sceneId,
        capability: req.capability, providerId: "openai-image", status: "FAILED", sourceType: "generated",
        provenanceNote: "refused", rightsStatus: "NOT_APPLICABLE", costClass: "PAID",
        safetyRefusal: { refusalClass: "MINOR_SAFETY", message: "blocked: child safety policy violation" },
        error: { errorCode: "PROVIDER_SAFETY_REFUSAL", errorSummary: "refused", errorClass: "permanent" },
      }),
    };
    const reg = require("../../providers/runtime/registry.js");
    const prev = reg.getProvider("openai-image");
    reg.registerProvider({ providerId: "openai-image", capabilities: ["image"], costClass: "PAID", adapter: failing });
    const r = await resolve(base({ providerPreference: ["openai-image"], costConstraints: { allowPaidCloud: true } }), { projectRoot: ROOT, enableCloud: true });
    assert(r.status === "PROVIDER_SAFETY_REFUSED", `must surface safety state, got ${r.status}`);
    assert(!["READY", "HANDOFF_REQUIRED"].includes(r.status) || r.status === "PROVIDER_SAFETY_REFUSED", "never generic FAILED retry");
    if (prev) reg.registerProvider({ providerId: "openai-image", capabilities: ["image"], costClass: "PAID", adapter: prev.adapter, availabilityCheck: prev.availabilityCheck });
    delete process.env.OPENAI_API_KEY;
  });

  await runTest("SAFE-E2E2 Step 09 BLOCKED remains BLOCKED through MCP/provider resolution", async () => {
    const r = await resolve(base({ rightsContext: { blocked: true } }), { projectRoot: ROOT });
    assert(r.status === "BLOCKED", `resolver must stay BLOCKED, got ${r.status}`);
    const m = await tools.dispatch("generate_image", { request: base({ rightsContext: { blocked: true } }) }, CTX);
    assert(m.status === "BLOCKED", `MCP must stay BLOCKED, got ${m.status}`);
  });

  await runTest("SAFE-E2E3 Adapted retry cannot execute through MCP without fresh approval", async () => {
    const store = require("../../flow-companion/bridge/job-store.js");
    const safety = require("../../flow-companion/bridge/safety-refusal.js");
    const job = store.createJob(ROOT, {
      projectId: PROJECT, jobId: "SAFE-E2E3", requestId: "R", sceneId: "S05", capability: "video",
      mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" },
      outputRequirements: {}, creativeContext: {}, expectedOutputPath: "assets/video/S05/x.mp4", attempt: 1,
    });
    for (const s of ["VALIDATED", "PREPARED", "AWAITING_USER_APPROVAL"]) store.transitionJob(ROOT, PROJECT, job.jobId, s, { actor: "test" });
    store.recordApproval(ROOT, PROJECT, job.jobId, { jobId: job.jobId, attempt: 1, approvedBy: "t" });
    store.transitionJob(ROOT, PROJECT, job.jobId, "GENERATING", { actor: "t" });
    safety.recordSafetyRefusal(ROOT, PROJECT, job.jobId, { message: "blocked: graphic violence, blood" });
    const plan = safety.planAdaptation({ refusalClass: "GRAPHIC_VIOLENCE", scene: { sceneId: "S05", originalSceneIntent: "protect", originalPrompt: "x" } });
    safety.prepareAdaptation(ROOT, PROJECT, job.jobId, { ...plan, jobId: job.jobId });
    store.transitionJob(ROOT, PROJECT, job.jobId, "AWAITING_USER_APPROVAL", { actor: "agent" });
    let code = null;
    try { store.transitionJob(ROOT, PROJECT, job.jobId, "GENERATING", { actor: "rogue-agent" }); }
    catch (e) { code = e.message; }
    assert(code && /APPROVAL_REQUIRED/.test(code), `adapted retry without approval must be rejected, got ${code}`);
  });

  await runTest("SAFE-E2E4 Retry limit → SAFE_FALLBACK_REQUIRED visible via MCP", async () => {
    const store = require("../../flow-companion/bridge/job-store.js");
    const safety = require("../../flow-companion/bridge/safety-refusal.js");
    const job = store.createJob(ROOT, {
      projectId: PROJECT, jobId: "SAFE-E2E4", requestId: "R", sceneId: "S05", capability: "video",
      mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" },
      outputRequirements: {}, creativeContext: {}, expectedOutputPath: "assets/video/S05/y.mp4", attempt: 1,
    });
    for (const s of ["VALIDATED", "PREPARED", "AWAITING_USER_APPROVAL"]) store.transitionJob(ROOT, PROJECT, job.jobId, s, { actor: "test" });
    const toGenerating = () => {
      const cur = store.getJob(ROOT, PROJECT, job.jobId);
      store.recordApproval(ROOT, PROJECT, job.jobId, { jobId: job.jobId, attempt: cur.attempt, approvedBy: "t" });
      store.transitionJob(ROOT, PROJECT, job.jobId, "GENERATING", { actor: "t" });
    };
    const adaptRound = (msg) => {
      safety.recordSafetyRefusal(ROOT, PROJECT, job.jobId, { message: msg });
      const plan = safety.planAdaptation({ refusalClass: "MINOR_SAFETY", scene: { sceneId: "S05", originalSceneIntent: "protect", originalPrompt: "x" } });
      safety.prepareAdaptation(ROOT, PROJECT, job.jobId, { ...plan, jobId: job.jobId });
      store.transitionJob(ROOT, PROJECT, job.jobId, "AWAITING_USER_APPROVAL", { actor: "agent" });
    };
    toGenerating(); adaptRound("blocked: child safety (1)");
    toGenerating(); adaptRound("blocked: child safety (2)");
    toGenerating();
    const r3 = safety.recordSafetyRefusal(ROOT, PROJECT, job.jobId, { message: "blocked: child safety (3)" });
    assert(r3.job.status === "SAFE_FALLBACK_REQUIRED", "budget exhaustion must force safe fallback");
    const viaMcp = await tools.dispatch("get_media_job", { projectId: PROJECT, jobId: "SAFE-E2E4" }, CTX);
    assert(viaMcp.status === "FOUND" && /SAFE_FALLBACK_REQUIRED/.test(JSON.stringify(viaMcp)), "fallback state must be visible via MCP");
  });

  await runTest("SAFE-E2E5 External/manual fallback packet preserves intent, claims, continuity, refusal", async () => {
    const r = await resolve(
      base({
        providerPreference: ["external-handoff"],
        safetyContext: { refusalReason: "blocked: graphic violence", refusalClass: "GRAPHIC_VIOLENCE", originalSceneIntent: "the group protects vulnerable members", preservedClaims: ["CLM-001"], step09Decision: "ALLOW" },
        continuityContext: { requiredEntities: ["CHAR_MOTHER_01"], continuityStrictness: "NORMAL", requiredReferences: [] },
      }),
      { projectRoot: ROOT }
    );
    assert(r.status === "HANDOFF_REQUIRED", "must produce handoff");
    const pkt = JSON.parse(fs.readFileSync(path.join(ROOT, "projects", PROJECT, r.handoffPath), "utf8"));
    assert(pkt.safetyContext && /graphic violence/.test(pkt.safetyContext.refusalReason || ""), "refusal reason preserved");
    assert((pkt.safetyContext.preservedClaims || []).includes("CLM-001"), "claims preserved");
    assert((pkt.continuityRequirements.requiredEntities || []).includes("CHAR_MOTHER_01"), "continuity preserved");
  });

  await runTest("SAFE-E2E6 Agent-native submission cannot convert refused job to READY without valid result", async () => {
    let rejected = false;
    try {
      await tools.dispatch("submit_media_result", {
        submission: {
          version: "1.0.0", requestId: "SE6", projectId: PROJECT, sceneId: "S05", capability: "image",
          providerId: "agent-native", artifactPath: "uploads/ghost-se6.png", provenanceNote: "x",
          rightsStatus: "NOT_APPLICABLE", safetyAttestation: { notSafetyRefused: false },
        },
      }, CTX);
    } catch (e) { rejected = /SAFETY_REFUSAL_UNRESOLVED|MISSING/.test(e.message); }
    assert(rejected, "refused job without valid new result must not become READY");
  });

  await runTest("SAFE-E2E7 Mock cloud safety response classified without auto-retry", async () => {
    const veo = require("../../providers/runtime/adapters/cloud-google-veo.js");
    process.env.GEMINI_API_KEY = "fake-safe-veo";
    const r = await veo.execute(base({ capability: "video", requestId: "SE7", costConstraints: { allowPaidCloud: true } }), {
      projectRoot: ROOT,
      enableCloud: true,
      googleVeoTransport: async () => { const e = new Error("blocked by safety policy: minor safety"); e.code = "SAFETY_REFUSAL"; throw e; },
    });
    assert(r.safetyRefusal || /SAFETY|REFUS/.test(JSON.stringify(r)), "mock cloud safety response must classify");
    assert(r.status !== "READY", "safety refusal must never be READY");
    delete process.env.GEMINI_API_KEY;
  });

  await runTest("SAFE-E2E8 No safety-evasion helper added by Step 10C", async () => {
    const { execSync } = require("child_process");
    const newFiles = [
      "scripts/diagnostics/local-media-doctor.js", "scripts/checks/step10-readiness.js",
      "providers/runtime/hardware-policy.js", "providers/runtime/timeout-policy.js",
      "providers/runtime/adapters/local-comfyui-image.js", "providers/runtime/adapters/local-comfyui-video.js",
      "providers/runtime/adapters/local-kokoro.js", "providers/runtime/adapters/local-whisper.js",
      "providers/runtime/adapters/cloud-openai-image.js", "providers/runtime/adapters/cloud-google-veo.js",
      "providers/runtime/adapters/cloud-elevenlabs-tts.js", "providers/runtime/adapters/cloud-elevenlabs-stt.js",
      "providers/runtime/adapters/configured-cloud.js", "providers/runtime/adapters/agent-native-registry.js",
      "mcp/unfoldiq-media/server.js", "mcp/unfoldiq-media/tools/index.js",
    ];
    const hits = [];
    for (const f of newFiles) {
      try {
        const src = fs.readFileSync(path.join(ROOT, f), "utf8");
        if (/bypass.*filter|filter.*evasion|ignore.*safety|disregard.*safety|jailbreak|prompt.zone-part|ch1ld|bl00d/i.test(src)) hits.push(f);
      } catch {}
    }
    void execSync;
    assert(hits.length === 0, `no evasion helper allowed (${hits.join(",")})`);
  });

  teardown();
  console.log(`\n=== SUMMARY: passed assertions ${passed}, failed tests ${failed} ===`);
  console.log(failed > 0 ? "RESULT: SOME TESTS FAILED" : "RESULT: ALL TESTS PASSED");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  try { teardown(); } catch {}
  process.exit(1);
});
