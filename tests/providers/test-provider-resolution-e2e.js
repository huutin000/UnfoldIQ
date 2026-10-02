"use strict";

/**
 * Provider resolution E2E (STEP 10C): PR-E2E1–PR-E2E10.
 * Resolver-level scenarios with mock transports. No paid calls.
 * Fixtures under projects/__10c_resolve__/ (removed in teardown).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__10c_resolve__";

const { registerAllProviders } = require("../../providers/runtime/bootstrap.js");
const { resolve } = require("../../providers/runtime/resolver.js");
const store = require("../../providers/runtime/artifact-store.js");

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

let sceneCounter = 0;
function base(capability, over = {}) {
  sceneCounter++;
  return {
    version: "1.0.0",
    requestId: `PR-${Math.random().toString(36).slice(2, 8)}`,
    projectId: PROJECT,
    sceneId: `S${String(sceneCounter).padStart(2, "0")}`,
    capability,
    input: capability === "tts" ? { text: "hello world", language: "en-us" } : capability === "stt" ? { audioPath: "assets/voice/S01/in.wav" } : { prompt: "e2e test" },
    outputRequirements: {},
    ...over,
  };
}

function imgTransport() {
  return { queuePrompt: async () => ({ promptId: "E2E" }), pollHistory: async () => ({ done: true }), getOutput: async () => ({ bytes: Buffer.from("PNG-E2E"), filename: "e2e.png" }) };
}

async function main() {
  console.log("=== PROVIDER RESOLUTION E2E (PR-E2E1-10) ===\n");
  registerAllProviders();

  await runTest("PR-E2E1 Existing image present → reuse", async () => {
    store.writeArtifactAtomic(ROOT, PROJECT, "uploads/pool.png", Buffer.from("POOL"));
    const r = await resolve(base("image", { requestId: "PRE1", input: { existingArtifactPath: "uploads/pool.png" } }), { projectRoot: ROOT });
    assert(r.status === "READY" && r.providerId === "existing", `must reuse existing, got ${r.providerId}/${r.status}`);
  });

  await runTest("PR-E2E2 Simple image → local when agent-native unavailable", async () => {
    const r = await resolve(base("image", { requestId: "PRE2" }), { projectRoot: ROOT, comfyuiTransport: imgTransport() });
    assert(r.status === "READY" && r.providerId === "local-comfyui-image", `expected local-comfyui-image, got ${r.providerId}/${r.status}`);
  });

  await runTest("PR-E2E3 Strict Flow reference image → flow-web preferred", async () => {
    const cfg = require("js-yaml").load(fs.readFileSync(path.join(ROOT, "providers", "CONFIG.yaml"), "utf8"));
    assert(cfg.capabilities.image.preferredOrder.includes("flow-web"), "image order must include flow-web");
    const r = await resolve(
      base("image", {
        requestId: "PRE3",
        providerPreference: ["flow-web"],
        continuityContext: { continuityStrictness: "STRICT", requiredEntities: [], requiredReferences: ["REF_MASTER"] },
      }),
      { projectRoot: ROOT, manualAssist: true, flowBridgeReachable: false }
    );
    assert(r.providerId === "flow-web" && r.status === "HANDOFF_REQUIRED", `strict ref must go flow-web, got ${r.providerId}/${r.status}`);
  });

  await runTest("PR-E2E4 Current project video → flow-web", async () => {
    const r = await resolve(base("video", { requestId: "PRE4" }), { projectRoot: ROOT, manualAssist: true, flowBridgeReachable: false });
    assert(r.providerId === "flow-web", `video default must be flow-web, got ${r.providerId}`);
  });

  await runTest("PR-E2E5 Flow unavailable → external handoff (no forced local heavy video)", async () => {
    const r = await resolve(
      base("video", { requestId: "PRE5", providerPreference: ["local-comfyui-video", "external-handoff"] }),
      { projectRoot: ROOT, comfyuiReachable: true, comfyuiWorkflowId: "example-video-wan", comfyuiTransport: imgTransport() }
    );
    assert(r.providerId !== "local-comfyui-video" || r.status !== "READY", "heavy local video must not be forced");
    assert(r.status === "HANDOFF_REQUIRED", `must land on external handoff, got ${r.status}`);
  });

  await runTest("PR-E2E6 TTS English → local-kokoro", async () => {
    const r = await resolve(base("tts", { requestId: "PRE6" }), {
      projectRoot: ROOT, kokoroTransport: { synthesize: async () => ({ bytes: Buffer.from("WAV-E2E") }) },
    });
    assert(r.status === "READY" && r.providerId === "local-kokoro", `expected local-kokoro, got ${r.providerId}/${r.status}`);
  });

  await runTest("PR-E2E7 TTS unsupported language → next provider/handoff", async () => {
    const r = await resolve(base("tts", { requestId: "PRE7", input: { text: "Xin chào", language: "vi" } }), { projectRoot: ROOT });
    assert(r.providerId !== "local-kokoro" || r.status !== "READY", "vi must not synthesize via kokoro");
  });

  await runTest("PR-E2E8 STT → local-whisper when available", async () => {
    store.writeArtifactAtomic(ROOT, PROJECT, "assets/voice/S01/in.wav", Buffer.from("WAV"));
    const r = await resolve(base("stt", { requestId: "PRE8" }), {
      projectRoot: ROOT,
      whisperTransport: { transcribe: async () => ({ text: "hi", segments: [{ startMs: 0, endMs: 500, text: "hi" }] }) },
    });
    assert(r.status === "READY" && r.providerId === "local-whisper", `expected local-whisper, got ${r.providerId}/${r.status}`);
  });

  await runTest("PR-E2E9 Policy blocked → no fallback bypass", async () => {
    const r = await resolve(base("image", { requestId: "PRE9", rightsContext: { blocked: true } }), { projectRoot: ROOT, comfyuiTransport: imgTransport() });
    assert(r.status === "BLOCKED", `blocked must stay blocked, got ${r.status}`);
  });

  await runTest("PR-E2E10 Paid explicitly enabled → mock cloud selectable", async () => {
    process.env.OPENAI_API_KEY = "sk-fake-e2e-key";
    const r = await resolve(base("image", { requestId: "PRE10", providerPreference: ["openai-image"], costConstraints: { allowPaidCloud: true } }), {
      projectRoot: ROOT, enableCloud: true, openaiImageTransport: async () => ({ bytes: Buffer.from("PNG-PAID") }),
    });
    assert(r.status === "READY" && r.providerId === "openai-image", `expected mock openai-image, got ${r.providerId}/${r.status}`);
    delete process.env.OPENAI_API_KEY;
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
