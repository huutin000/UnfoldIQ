"use strict";

/**
 * Kokoro provider tests (STEP 10C): KO1–KO10.
 * Mock transport only; no audio synthesis claims beyond mocks.
 * Fixtures under projects/__10c_kokoro__/ (removed in teardown).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__10c_kokoro__";

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
    requestId: `KO-${Math.random().toString(36).slice(2, 8)}`,
    projectId: PROJECT,
    sceneId: "S01",
    capability: "tts",
    input: { text: "Hello world, this is a test.", language: "en-us" },
    outputRequirements: { format: "wav" },
    ...over,
  };
}

function mockKokoro(model = "kokoro-v1-test") {
  return { synthesize: async ({ text }) => ({ bytes: Buffer.from(`WAV:${text.slice(0, 10)}`), model, version: "9.9-test" }) };
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
  console.log("=== KOKORO PROVIDER TESTS (KO1-KO10) ===\n");
  registerAllProviders();
  const koko = require("../../providers/runtime/adapters/local-kokoro.js");

  await runTest("KO1 Package unavailable → NOT_AVAILABLE", async () => {
    const code = await codeOf(koko.execute(baseRequest(), { projectRoot: ROOT }));
    assert(code === null || /NOT_AVAILABLE|KOKORO_NOT_AVAILABLE/.test(code), `expected NOT_AVAILABLE or real READY, got ${code}`);
    if (code !== null) assert(/NOT_AVAILABLE/.test(code), "without mock, missing package must be NOT_AVAILABLE");
  });

  await runTest("KO2 Supported language + mock runtime → READY WAV", async () => {
    const r = await koko.execute(baseRequest({ requestId: "KO2" }), { projectRoot: ROOT, kokoroTransport: mockKokoro() });
    assert(r.status === "READY", "mock kokoro must be READY");
    assert(r.artifactPath.endsWith(".wav"), "artifact must be wav");
    assert(fs.existsSync(path.join(ROOT, "projects", PROJECT, r.artifactPath)), "wav file must exist");
    assert(fs.statSync(path.join(ROOT, "projects", PROJECT, r.artifactPath)).size > 0, "wav must be non-empty");
  });

  await runTest("KO3 Unsupported language → NOT_AVAILABLE, no wrong-language synthesis", async () => {
    const code = await codeOf(koko.execute(baseRequest({ input: { text: "Xin chào", language: "vi" } }), { projectRoot: ROOT, kokoroTransport: mockKokoro() }));
    assert(code && /KOKORO_LANGUAGE_UNSUPPORTED/.test(code), `expected KOKORO_LANGUAGE_UNSUPPORTED, got ${code}`);
  });

  await runTest("KO4 Unknown voice rejected", async () => {
    const code = await codeOf(koko.execute(baseRequest({ input: { text: "hi", language: "en-us", voice: "nope_voice_xyz" } }), { projectRoot: ROOT, kokoroTransport: mockKokoro() }));
    assert(code && /UNKNOWN_VOICE/.test(code), `expected UNKNOWN_VOICE, got ${code}`);
  });

  await runTest("KO5 Zero-byte output rejected", async () => {
    const code = await codeOf(
      koko.execute(baseRequest(), { projectRoot: ROOT, kokoroTransport: { synthesize: async () => ({ bytes: Buffer.alloc(0) }) } })
    );
    assert(code && /KOKORO_EMPTY_OUTPUT/.test(code), `expected KOKORO_EMPTY_OUTPUT, got ${code}`);
  });

  await runTest("KO6 Speed setting passed through", async () => {
    let seen = null;
    const r = await koko.execute(baseRequest({ requestId: "KO6", input: { text: "slow test", language: "en-us", speed: 0.8 } }), {
      projectRoot: ROOT,
      kokoroTransport: { synthesize: async (a) => { seen = a; return { bytes: Buffer.from("WAVDATA") }; } },
    });
    assert(r.status === "READY" && seen && seen.speed === 0.8, "speed must pass through to transport");
  });

  await runTest("KO7 Provenance/model recorded", async () => {
    const r = await koko.execute(baseRequest({ requestId: "KO7" }), { projectRoot: ROOT, kokoroTransport: mockKokoro("kokoro-v1-test") });
    assert(/kokoro-v1-test/.test(r.provenanceNote || ""), "provenance must record model");
    assert(r.metadata && r.metadata.voice && r.metadata.language === "en-us", "metadata must carry voice+language");
  });

  await runTest("KO8 No voice cloning claim", async () => {
    const src = fs.readFileSync(path.join(ROOT, "providers", "runtime", "adapters", "local-kokoro.js"), "utf8");
    assert(!/clone\s+(your|a|the)\s+voice|voice[- ]?cloning\s+(supported|available|enabled)|cloneVoice|clone_voice/i.test(src), "adapter must offer no voice-cloning capability");
    assert(/no voice-clon/i.test(src), "adapter must explicitly disclaim voice cloning");
  });

  await runTest("KO9 No install/download from doctor", async () => {
    const src = fs.readFileSync(path.join(ROOT, "scripts/diagnostics/local-media-doctor.js"), "utf8");
    assert(!/spawnSync\([^)]*\bpip\b|execSync\([^)]*\bpip\b|npm\s+install\s+[a-z]|git\s+clone\s+https?:/i.test(src), "doctor must execute no install command");
    assert(/inspection only|never.*install/i.test(src), "doctor must declare inspection-only");
  });

  await runTest("KO10 Resolver falls through when unsupported", async () => {
    const r = await resolve(baseRequest({ requestId: "KO10", providerPreference: ["local-kokoro"], input: { text: "Xin chào", language: "vi" } }), { projectRoot: ROOT });
    assert(r.providerId !== "local-kokoro" || r.status !== "READY", "unsupported language must not become READY via kokoro");
    assert(["HANDOFF_REQUIRED", "READY", "BLOCKED"].includes(r.status), `must resolve onward, got ${r.status}`);
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
