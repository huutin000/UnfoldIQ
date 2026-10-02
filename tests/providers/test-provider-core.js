"use strict";

/**
 * UNFOLDIQ provider core tests (STEP 10A): PC1–PC15.
 * Executable, deterministic, TEST-ONLY fixtures under projects/__test10a__/
 * (removed in teardown) plus runtime-generated WAV fixtures under
 * assets/approved-local/ (TEST-ONLY names, removed in teardown).
 * No network calls. No production media. No vendor APIs.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const TEST_PROJECT = "__test10a__";

const store = require("../../providers/runtime/artifact-store.js");
const { registerCoreProviders } = require("../../providers/runtime/bootstrap.js");
const registry = require("../../providers/runtime/registry.js");
const { resolve } = require("../../providers/runtime/resolver.js");
const { validateProviderResult } = require("../../lib/provider-result-check.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
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

function logOut(label, obj) {
  console.log(`  output: ${label} = ${JSON.stringify(obj)}`);
}

/** Deterministic silent WAV bytes (8000 Hz mono 16-bit, 800 samples). */
function silentWavBytes() {
  const dataSize = 1600;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(8000, 24);
  buf.writeUInt32LE(16000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

function mkRequest(overrides = {}) {
  return {
    version: "1.0.0",
    requestId: overrides.requestId || "REQ-TEST",
    projectId: TEST_PROJECT,
    sceneId: overrides.sceneId || "S01",
    capability: overrides.capability || "image",
    input: overrides.input || { prompt: "TEST-ONLY prompt" },
    outputRequirements: overrides.outputRequirements || { format: "png" },
    ...(overrides.creativeContext ? { creativeContext: overrides.creativeContext } : {}),
    ...(overrides.continuityContext ? { continuityContext: overrides.continuityContext } : {}),
    ...(overrides.rightsContext ? { rightsContext: overrides.rightsContext } : {}),
    ...(overrides.costConstraints ? { costConstraints: overrides.costConstraints } : {}),
    ...(overrides.providerPreference ? { providerPreference: overrides.providerPreference } : {}),
  };
}

const FIXTURE_WAVS = [
  "assets/approved-local/music/test-only-ambient.wav",
  "assets/approved-local/sfx/test-only-click.wav",
  "assets/approved-local/music/test-only-unknown.wav",
];

function setup() {
  registerCoreProviders();
  for (const rel of FIXTURE_WAVS) {
    const abs = path.join(REPO_ROOT, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, silentWavBytes());
  }
}

function teardown() {
  fs.rmSync(path.join(REPO_ROOT, "projects", TEST_PROJECT), { recursive: true, force: true });
  for (const rel of FIXTURE_WAVS) {
    fs.rmSync(path.join(REPO_ROOT, rel), { force: true });
  }
  registerCoreProviders();
}

async function main() {
  setup();
  console.log("=== PROVIDER CORE TESTS (PC1-PC15) ===\n");

  // PC1 — existing valid artifact → READY.
  await runTest("PC1 Existing valid artifact → READY", async () => {
    const rel = store.writeArtifactAtomic(REPO_ROOT, TEST_PROJECT, "assets/image/S01/existing.png", Buffer.from("TEST-ONLY-PNG"));
    const r = await resolve(mkRequest({ requestId: "PC1", input: { existingArtifactPath: rel } }), { projectRoot: REPO_ROOT });
    logOut("result.status", r.status);
    assert(r.status === "READY", "valid existing artifact must be READY");
    assert(r.artifactPath === rel, "READY must carry the artifact path");
    assert(store.artifactExists(REPO_ROOT, TEST_PROJECT, r.artifactPath), "READY artifact must exist");
  });

  // PC2 — path traversal → BLOCKED/REJECT.
  await runTest("PC2 Path traversal → BLOCKED", async () => {
    const existing = require("../../providers/runtime/adapters/existing.js");
    let code = null;
    try {
      await existing.execute(mkRequest({ requestId: "PC2", input: { existingArtifactPath: "../../evil.png" } }), { projectRoot: REPO_ROOT });
    } catch (e) {
      code = e.errorCode || e.message;
    }
    logOut("adapter rejection", code);
    assert(code === "PATH_TRAVERSAL_BLOCKED", "adapter must reject traversal");
    const r = await resolve(mkRequest({ requestId: "PC2R", input: { existingArtifactPath: "../../evil.png" } }), { projectRoot: REPO_ROOT });
    logOut("resolver.status", r.status);
    assert(r.status === "BLOCKED", "traversal must be BLOCKED, never laundered into handoff");
  });

  // PC3 — approved-local VERIFIED → READY.
  await runTest("PC3 Approved-local VERIFIED → READY", async () => {
    const r = await resolve(
      mkRequest({ requestId: "PC3", capability: "music", sceneId: "S01", input: { approvedAssetId: "LIB-MUSIC-001" } }),
      { projectRoot: REPO_ROOT }
    );
    logOut("result", { status: r.status, providerId: r.providerId, artifactPath: r.artifactPath });
    assert(r.status === "READY", "verified approved-local asset must be READY");
    assert(r.providerId === "approved-local", "provider must be approved-local");
    assert(store.artifactExists(REPO_ROOT, TEST_PROJECT, r.artifactPath), "copied artifact must exist in project");
  });

  // PC4 — approved-local UNKNOWN rights → not READY.
  await runTest("PC4 Approved-local UNKNOWN rights → not READY", async () => {
    const r = await resolve(
      mkRequest({ requestId: "PC4", capability: "music", sceneId: "S01", input: { approvedAssetId: "LIB-MUSIC-UNKNOWN" } }),
      { projectRoot: REPO_ROOT }
    );
    logOut("result.status", r.status);
    assert(r.status !== "READY", "UNKNOWN rights must never be READY for final use");
  });

  // PC5 — agent native without bridge → NOT_AVAILABLE.
  await runTest("PC5 Agent-native no bridge → NOT_AVAILABLE", async () => {
    const native = require("../../providers/runtime/adapters/agent-native.js");
    let code = null;
    try {
      await native.execute(mkRequest({ requestId: "PC5", capability: "tts", input: { text: "hello" } }), { projectRoot: REPO_ROOT });
    } catch (e) {
      code = e.errorCode;
    }
    logOut("adapter rejection", code);
    assert(code === "AGENT_NATIVE_BRIDGE_NOT_CONFIGURED", "must report bridge not configured");
    const r = await resolve(
      mkRequest({ requestId: "PC5R", capability: "tts", sceneId: "S01", input: { text: "hello" }, providerPreference: ["agent-native"] }),
      { projectRoot: REPO_ROOT }
    );
    logOut("resolver.status", r.status);
    assert(r.status === "HANDOFF_REQUIRED", "NOT_AVAILABLE must fall through to handoff, not get stuck");
  });

  // PC6/PC7 — no automated provider → external handoff with persistent JSON.
  await runTest("PC6/PC7 External handoff created + persists", async () => {
    const r = await resolve(mkRequest({ requestId: "PC6", capability: "video", sceneId: "S02", input: { prompt: "TEST-ONLY video" } }), {
      projectRoot: REPO_ROOT,
    });
    logOut("result", { status: r.status, handoffPath: r.handoffPath });
    assert(r.status === "HANDOFF_REQUIRED", "no automated provider must yield HANDOFF_REQUIRED");
    assert(r.handoffPath, "handoff must carry handoffPath");
    assert(store.artifactExists(REPO_ROOT, TEST_PROJECT, r.handoffPath), "handoff JSON must persist");
    const doc = JSON.parse(store.readArtifact(REPO_ROOT, TEST_PROJECT, r.handoffPath).toString("utf8"));
    for (const k of ["requestId", "projectId", "sceneId", "capability", "outputRequirements", "expectedOutputPath", "returnInstructions", "continuityRequirements", "referenceAssetPaths"]) {
      assert(doc[k] !== undefined, `handoff JSON must contain ${k}`);
    }
  });

  // PC8 — handoff file can resume through existing.
  await runTest("PC8 Handoff resume via existing", async () => {
    const rel = "assets/image/S02/PC6.bin";
    store.writeArtifactAtomic(REPO_ROOT, TEST_PROJECT, rel, Buffer.from("TEST-ONLY-RESUMED"));
    const r = await resolve(mkRequest({ requestId: "PC8", capability: "image", sceneId: "S02", input: { existingArtifactPath: rel } }), {
      projectRoot: REPO_ROOT,
    });
    logOut("result.status", r.status);
    assert(r.status === "READY", "delivered handoff file must resume through existing");
  });

  // PC9 — paid provider disabled by cost policy (and explicit enable works).
  await runTest("PC9 Paid cloud disabled by default", async () => {
    registry.registerProvider({
      providerId: "test-paid-cloud",
      capabilities: ["image"],
      costClass: "PAID",
      adapter: {
        execute: async (req) => {
          const rel = store.writeArtifactAtomic(REPO_ROOT, req.projectId, `assets/image/${req.sceneId}/paid.png`, Buffer.from("PAID"));
          return { version: "1.0.0", requestId: req.requestId, projectId: req.projectId, sceneId: req.sceneId, capability: req.capability, providerId: "test-paid-cloud", status: "READY", artifactPath: rel, sourceType: "generated", provenanceNote: "TEST-ONLY paid", rightsStatus: "NOT_APPLICABLE", costClass: "PAID", generationDate: new Date().toISOString() };
        },
      },
    });
    const blocked = await resolve(
      mkRequest({ requestId: "PC9A", input: { prompt: "x" }, providerPreference: ["test-paid-cloud"] }),
      { projectRoot: REPO_ROOT }
    );
    logOut("default.status", `${blocked.status}/${blocked.providerId}`);
    assert(blocked.providerId !== "test-paid-cloud", "paid provider must be skipped when allowPaidCloud=false");
    const allowed = await resolve(
      mkRequest({ requestId: "PC9B", input: { prompt: "x" }, providerPreference: ["test-paid-cloud"], costConstraints: { allowPaidCloud: true } }),
      { projectRoot: REPO_ROOT }
    );
    logOut("explicit.status", `${allowed.status}/${allowed.providerId}`);
    assert(allowed.status === "READY" && allowed.providerId === "test-paid-cloud", "explicit allowPaidCloud=true must enable paid");
    registerCoreProviders();
  });

  // PC10 — unregistered planned providers safely skipped.
  await runTest("PC10 Planned providers skipped safely", async () => {
    const r = await resolve(mkRequest({ requestId: "PC10", capability: "image", input: { prompt: "x" } }), { projectRoot: REPO_ROOT });
    logOut("result", `${r.status}/${r.providerId}`);
    assert(r.status === "HANDOFF_REQUIRED", "flow-web/comfyui/openai unregistered → safe skip to handoff, no crash");
  });

  // PC11 — BLOCKED rights/policy has no fallback bypass.
  await runTest("PC11 BLOCKED rights not bypassed", async () => {
    const rel = store.writeArtifactAtomic(REPO_ROOT, TEST_PROJECT, "assets/image/S03/valid.png", Buffer.from("VALID"));
    const r = await resolve(
      mkRequest({ requestId: "PC11", input: { existingArtifactPath: rel }, rightsContext: { blocked: true } }),
      { projectRoot: REPO_ROOT }
    );
    logOut("result", `${r.status}/${r.error && r.error.errorCode}`);
    assert(r.status === "BLOCKED", "blocked rights must stay BLOCKED despite valid artifact");
    assert(r.error && r.error.errorCode === "RIGHTS_POLICY_BLOCKED", "must carry RIGHTS_POLICY_BLOCKED");
  });

  // PC12 — matching fingerprint reuses READY artifact.
  await runTest("PC12 Fingerprint reuse works", async () => {
    const first = await resolve(
      mkRequest({ requestId: "PC12A", capability: "music", sceneId: "S04", input: { approvedAssetId: "LIB-MUSIC-001" } }),
      { projectRoot: REPO_ROOT }
    );
    assert(first.status === "READY", "first run must be READY");
    const second = await resolve(
      mkRequest({ requestId: "PC12B", capability: "music", sceneId: "S04", input: { approvedAssetId: "LIB-MUSIC-001" } }),
      { projectRoot: REPO_ROOT }
    );
    logOut("reuse", { status: second.status, reused: second.metadata && second.metadata.reused, artifactPath: second.artifactPath });
    assert(second.status === "READY", "reuse must be READY");
    assert(second.metadata && second.metadata.reused === true, "reuse must be flagged");
    assert(second.artifactPath === first.artifactPath, "reuse must return the same artifact");
  });

  // PC13 — changed fingerprint marks asset outdated (new file, old preserved).
  await runTest("PC13 Changed fingerprint → outdated, no silent overwrite", async () => {
    const oldPath = store.findByFingerprint(REPO_ROOT, TEST_PROJECT, require("../../providers/runtime/request-fingerprint.js").fingerprintRequest(
      mkRequest({ requestId: "PC12A", capability: "music", sceneId: "S04", input: { approvedAssetId: "LIB-MUSIC-001" } })
    ));
    assert(oldPath, "baseline fingerprint must be indexed");
    const r = await resolve(
      mkRequest({ requestId: "PC13", capability: "music", sceneId: "S04", input: { approvedAssetId: "LIB-MUSIC-001" }, creativeContext: { visualBibleVersion: "v2-changed" } }),
      { projectRoot: REPO_ROOT }
    );
    logOut("result", { status: r.status, artifactPath: r.artifactPath });
    assert(r.status === "READY", "changed request must regenerate READY");
    assert(r.artifactPath !== oldPath, "changed fingerprint must not reuse the old artifact");
    assert(store.artifactExists(REPO_ROOT, TEST_PROJECT, oldPath), "old accepted artifact must still exist (no silent overwrite)");
    // Adapter-level: strict fingerprint demand marks the old file outdated, not reusable.
    const existing = require("../../providers/runtime/adapters/existing.js");
    let outdatedCode = null;
    let outdatedFlag = false;
    try {
      await existing.execute(
        mkRequest({ requestId: "PC13X", capability: "music", sceneId: "S04", input: { existingArtifactPath: oldPath, expectedFingerprint: "deadbeef" } }),
        { projectRoot: REPO_ROOT }
      );
    } catch (e) {
      outdatedCode = e.errorCode;
      outdatedFlag = e.outdated === true;
    }
    logOut("outdated", `${outdatedCode}/flag=${outdatedFlag}`);
    assert(outdatedCode === "OUTDATED_FINGERPRINT", "stale fingerprint must be marked OUTDATED");
    assert(outdatedFlag === true, "outdated flag must be set");
  });

  // PC14 — READY without artifact rejected.
  await runTest("PC14 Fake READY rejected", async () => {
    const v = validateProviderResult(
      { version: "1.0.0", requestId: "PC14", projectId: TEST_PROJECT, sceneId: "S01", capability: "image", providerId: "x", status: "READY", sourceType: "generated", provenanceNote: "fake", rightsStatus: "NOT_APPLICABLE", costClass: "ZERO_LOCAL" },
      { projectRoot: REPO_ROOT, checkExists: true }
    );
    logOut("semantic", { valid: v.valid, codes: v.errors.map((e) => e.code) });
    assert(v.valid === false, "READY without artifactPath must be rejected");
    assert(v.errors.some((e) => e.code === "READY_WITHOUT_ARTIFACT"), "must carry READY_WITHOUT_ARTIFACT");
  });

  // PC15 — secret-like serialized result rejected.
  await runTest("PC15 Secret serialization rejected", async () => {
    const v = validateProviderResult(
      { version: "1.0.0", requestId: "PC15", projectId: TEST_PROJECT, sceneId: "S01", capability: "image", providerId: "x", status: "FAILED", sourceType: "existing", provenanceNote: "x", rightsStatus: "NOT_APPLICABLE", costClass: "ZERO_LOCAL", metadata: { apiKey: "sk-test-secret-value", note: "leak" }, error: { errorCode: "X", errorSummary: "x" } },
      { projectRoot: REPO_ROOT }
    );
    logOut("semantic", { valid: v.valid, codes: v.errors.map((e) => e.code) });
    assert(v.valid === false, "secret-like serialized values must be rejected");
    assert(v.errors.some((e) => e.code === "SECRET_SERIALIZED"), "must carry SECRET_SERIALIZED");
  });

  teardown();
  console.log(`\n=== SUMMARY ===`);
  console.log(`Passed assertions: ${passed}, Failed tests: ${failed}`);
  if (failed > 0) {
    console.log("RESULT: SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("RESULT: ALL TESTS PASSED");
}

main().catch((e) => {
  console.log(`FATAL: ${e.stack || e.message}`);
  try {
    teardown();
  } catch {}
  process.exit(1);
});
