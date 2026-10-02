"use strict";

/**
 * ComfyUI provider tests (STEP 10C): CI1–CI12.
 * Mock transport only; no ComfyUI install, no model download, no network.
 * Fixtures under projects/__10c_comfy__/ (removed in teardown).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__10c_comfy__";

const { registerAllProviders } = require("../../providers/runtime/bootstrap.js");
const { resolve } = require("../../providers/runtime/resolver.js");
const { ProviderError } = require("../../providers/runtime/errors.js");

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

function baseRequest(over = {}) {
  return {
    version: "1.0.0",
    requestId: `CI-${Math.random().toString(36).slice(2, 8)}`,
    projectId: PROJECT,
    sceneId: "S01",
    capability: "image",
    input: { prompt: "a quiet mountain lake at dawn" },
    outputRequirements: { width: 1024, height: 1024, format: "png" },
    ...over,
  };
}

function mockTransport(bytes = Buffer.from("PNG-MOCK-BYTES"), filename = "out.png") {
  return {
    queuePrompt: async () => ({ promptId: "MOCK-P1" }),
    pollHistory: async () => ({ done: true }),
    getOutput: async () => ({ bytes, filename }),
  };
}

async function codeOf(promise) {
  try {
    await promise;
    return null;
  } catch (e) {
    return e instanceof ProviderError ? `${e.errorClass}:${e.errorCode}` : `THROWN:${e.message}`;
  }
}

async function main() {
  console.log("=== COMFYUI PROVIDER TESTS (CI1-CI12) ===\n");
  registerAllProviders();
  const img = require("../../providers/runtime/adapters/local-comfyui-image.js");
  const vid = require("../../providers/runtime/adapters/local-comfyui-video.js");

  await runTest("CI1 Doctor absent server → NOT_AVAILABLE", async () => {
    const code = await codeOf(img.execute(baseRequest(), { projectRoot: ROOT, comfyuiReachable: false }));
    assert(code && /NOT_AVAILABLE/.test(code), `expected NOT_AVAILABLE, got ${code}`);
  });

  await runTest("CI2 Mock image server/workflow → READY", async () => {
    const r = await img.execute(baseRequest({ requestId: "CI2-IMG" }), { projectRoot: ROOT, comfyuiTransport: mockTransport() });
    assert(r.status === "READY", "mock image must be READY");
    assert(r.artifactPath && r.artifactPath.endsWith(".png"), "artifact must be a png path");
    assert(fs.existsSync(path.join(ROOT, "projects", PROJECT, r.artifactPath)), "artifact file must exist");
  });

  await runTest("CI3 Missing required model → MODEL_MISSING", async () => {
    const code = await codeOf(
      img.execute(baseRequest(), { projectRoot: ROOT, comfyuiReachable: true, comfyuiWorkflowId: "example-image-sdxl", comfyuiModelRoot: path.join(ROOT, "projects", PROJECT, "empty-models") })
    );
    assert(code && /MODEL_MISSING/.test(code), `expected MODEL_MISSING, got ${code}`);
  });

  await runTest("CI4 Traversal output rejected", async () => {
    const bad = mockTransport(Buffer.from("x"), "../../evil.png");
    const code = await codeOf(img.execute(baseRequest(), { projectRoot: ROOT, comfyuiTransport: bad }));
    assert(code && /TRAVERSAL|ABSOLUTE|URL_REJECTED|REJECTED/.test(code), `expected traversal rejection, got ${code}`);
  });

  await runTest("CI5 Unknown workflow rejected", async () => {
    const code = await codeOf(img.execute(baseRequest(), { projectRoot: ROOT, comfyuiReachable: true, comfyuiWorkflowId: "nope-workflow" }));
    assert(code && /UNKNOWN_WORKFLOW/.test(code), `expected UNKNOWN_WORKFLOW, got ${code}`);
  });

  await runTest("CI6 Parameter mapping deterministic", async () => {
    const { mapImageParams } = require("../../providers/local/comfyui/parameter-mapper.js");
    const loader = require("../../providers/local/comfyui/workflow-loader.js");
    const entry = loader.getWorkflow("mock-image-test", ROOT);
    const req = baseRequest({ requestId: "CI6-FIXED" });
    const a = mapImageParams(req, entry);
    const b = mapImageParams(req, entry);
    assert(JSON.stringify(a) === JSON.stringify(b), "same request must map identically");
  });

  await runTest("CI7 Timeout explicit", async () => {
    const hanging = {
      queuePrompt: async () => ({ promptId: "HANG" }),
      pollHistory: async () => ({ done: true }),
      getOutput: async () => new Promise(() => {}),
    };
    const tp = require("../../providers/runtime/timeout-policy.js");
    const keepAlive = setInterval(() => {}, 500);
    let code;
    try {
      code = await codeOf(tp.withTimeout(hanging.getOutput(), 50, "TIMEOUT"));
    } finally {
      clearInterval(keepAlive);
    }
    assert(code && /TIMEOUT/.test(code), `expected explicit TIMEOUT, got ${code}`);
  });

  await runTest("CI8 No auto model download", async () => {
    const src = fs.readFileSync(path.join(ROOT, "providers", "runtime", "adapters", "local-comfyui-image.js"), "utf8")
      + fs.readFileSync(path.join(ROOT, "providers", "local", "comfyui", "client.js"), "utf8");
    assert(!/\bcurl\b|\bwget\b|huggingface_hub|pip install|createWriteStream|\.pipe\s*\(/i.test(src), "adapters must contain no model-download code");
    assert(/never.*download|no.*auto.*download|MODEL_MISSING/i.test(src), "adapters must document no-auto-download / MODEL_MISSING instead");
  });

  await runTest("CI9 Video unsuitable by project policy → UNSUITABLE_BY_POLICY", async () => {
    const code = await codeOf(
      vid.execute(
        { ...baseRequest(), capability: "video", requestId: "CI9-VID", input: { prompt: "a river" }, outputRequirements: { width: 1280, height: 720 } },
        { projectRoot: ROOT, comfyuiReachable: true, comfyuiTransport: mockTransport(Buffer.from("MP4"), "out.mp4"), comfyuiWorkflowId: "example-video-wan" }
      )
    );
    assert(code && /UNSUITABLE_BY_POLICY/.test(code), `expected UNSUITABLE_BY_POLICY, got ${code}`);
  });

  await runTest("CI10 Resolver falls to next video provider", async () => {
    const r = await resolve(
      { ...baseRequest(), capability: "video", requestId: "CI10-VID", providerPreference: ["local-comfyui-video"], input: { prompt: "a river" }, outputRequirements: {} },
      { projectRoot: ROOT, comfyuiReachable: true, comfyuiWorkflowId: "example-video-wan", manualAssist: true, flowBridgeReachable: false }
    );
    assert(r.providerId !== "local-comfyui-video", `must fall through, got ${r.providerId}`);
    assert(["HANDOFF_REQUIRED", "AWAITING_USER_APPROVAL", "READY"].includes(r.status), `must land on fallback, got ${r.status}`);
  });

  await runTest("CI11 Provenance includes workflowId", async () => {
    const r = await img.execute(baseRequest({ requestId: "CI11-IMG" }), { projectRoot: ROOT, comfyuiTransport: mockTransport() });
    assert(/mock-image-test/.test(r.provenanceNote || "") || (r.metadata && r.metadata.workflowId === "mock-image-test"), "provenance must name workflowId");
  });

  await runTest("CI12 Continuity references pass through generic bindings", async () => {
    const { mapImageParams } = require("../../providers/local/comfyui/parameter-mapper.js");
    const loader = require("../../providers/local/comfyui/workflow-loader.js");
    const entry = loader.getWorkflow("mock-image-test", ROOT);
    const patch = mapImageParams(baseRequest({ continuityContext: { requiredReferences: ["REF_A"], continuityStrictness: "STRICT" } }), entry);
    const s = JSON.stringify(patch);
    assert(/REF_A/.test(s), "continuity ref must survive parameter mapping");
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
