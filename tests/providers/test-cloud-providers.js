"use strict";

/**
 * Cloud provider tests (STEP 10C): CL1–CL10.
 * No real API calls. Mock transports only. No keys printed.
 * Fixtures under projects/__10c_cloud__/ (removed in teardown).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__10c_cloud__";

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

function base(capability, over = {}) {
  return {
    version: "1.0.0",
    requestId: `CL-${Math.random().toString(36).slice(2, 8)}`,
    projectId: PROJECT,
    sceneId: "S01",
    capability,
    input: capability === "tts" ? { text: "hello", language: "en-us" } : { prompt: "cloud test" },
    outputRequirements: {},
    ...over,
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
  console.log("=== CLOUD PROVIDER TESTS (CL1-CL10) ===\n");
  registerAllProviders();
  const openai = require("../../providers/runtime/adapters/cloud-openai-image.js");
  const veo = require("../../providers/runtime/adapters/cloud-google-veo.js");
  const etts = require("../../providers/runtime/adapters/cloud-elevenlabs-tts.js");
  const estt = require("../../providers/runtime/adapters/cloud-elevenlabs-stt.js");

  const savedEnv = { ...process.env };
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;

  await runTest("CL1 All paid providers disabled by default", async () => {
    for (const [mod, cap] of [[openai, "image"], [veo, "video"], [etts, "tts"], [estt, "stt"]]) {
      const code = await codeOf(mod.execute(base(cap), { projectRoot: ROOT }));
      assert(code && /CLOUD_NOT_ENABLED|NOT_CONFIGURED/.test(code), `${cap} must be disabled by default, got ${code}`);
    }
  });

  await runTest("CL2 Missing API key → NOT_CONFIGURED", async () => {
    process.env.OPENAI_API_KEY = "";
    const code = await codeOf(openai.execute(base("image", { costConstraints: { allowPaidCloud: true } }), { projectRoot: ROOT, enableCloud: true }));
    assert(code && /NOT_CONFIGURED/.test(code), `expected NOT_CONFIGURED, got ${code}`);
  });

  await runTest("CL3 allowPaidCloud:false blocks execution", async () => {
    process.env.OPENAI_API_KEY = "sk-fake-test-key";
    const r = await resolve(base("image", { providerPreference: ["openai-image"] }), { projectRoot: ROOT });
    assert(r.providerId !== "openai-image" || r.status !== "READY", "paid cloud must not execute when blocked");
    delete process.env.OPENAI_API_KEY;
  });

  await runTest("CL4 Explicit enable + mock OpenAI image maps request", async () => {
    process.env.OPENAI_API_KEY = "sk-fake-test-key";
    const r = await openai.execute(base("image", { requestId: "CL4", costConstraints: { allowPaidCloud: true } }), {
      projectRoot: ROOT, enableCloud: true, openaiImageTransport: async () => ({ bytes: Buffer.from("PNG-CLOUD") }),
    });
    assert(r.status === "READY" && r.providerId === "openai-image", "mock openai image must be READY");
    delete process.env.OPENAI_API_KEY;
  });

  await runTest("CL5 Explicit enable + mock Veo maps video request", async () => {
    process.env.GEMINI_API_KEY = "fake-veo-key";
    const r = await veo.execute(base("video", { requestId: "CL5", costConstraints: { allowPaidCloud: true } }), {
      projectRoot: ROOT, enableCloud: true, googleVeoTransport: async () => ({ bytes: Buffer.from("MP4-CLOUD") }),
    });
    assert(r.status === "READY" && r.providerId === "google-veo", "mock veo must be READY");
    delete process.env.GEMINI_API_KEY;
  });

  await runTest("CL6 Explicit enable + mock ElevenLabs TTS maps request", async () => {
    process.env.ELEVENLABS_API_KEY = "fake-el-key";
    const r = await etts.execute(base("tts", { requestId: "CL6", costConstraints: { allowPaidCloud: true } }), {
      projectRoot: ROOT, enableCloud: true, elevenlabsTtsTransport: async () => ({ bytes: Buffer.from("MP3-CLOUD") }),
    });
    assert(r.status === "READY" && r.providerId === "elevenlabs-tts", "mock elevenlabs tts must be READY");
    delete process.env.ELEVENLABS_API_KEY;
  });

  await runTest("CL7 Explicit enable + mock ElevenLabs STT maps request", async () => {
    process.env.ELEVENLABS_API_KEY = "fake-el-key";
    const store = require("../../providers/runtime/artifact-store.js");
    store.writeArtifactAtomic(ROOT, PROJECT, "assets/voice/S01/in.mp3", Buffer.from("FAKE-MP3"));
    const r = await estt.execute(
      base("stt", { requestId: "CL7", costConstraints: { allowPaidCloud: true }, input: { audioPath: "assets/voice/S01/in.mp3" } }),
      { projectRoot: ROOT, enableCloud: true, elevenlabsSttTransport: async () => ({ transcript: "hi", segments: [{ startMs: 0, endMs: 400, text: "hi" }] }) }
    );
    assert(r.status === "READY" && r.providerId === "elevenlabs-stt", "mock elevenlabs stt must be READY");
    delete process.env.ELEVENLABS_API_KEY;
  });

  await runTest("CL8 Secret never persisted", async () => {
    process.env.OPENAI_API_KEY = "sk-fake-persist-check";
    await openai.execute(base("image", { requestId: "CL8", costConstraints: { allowPaidCloud: true } }), {
      projectRoot: ROOT, enableCloud: true, openaiImageTransport: async () => ({ bytes: Buffer.from("X") }),
    });
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (fs.statSync(p).isFile() && fs.statSync(p).size < 5 * 1024 * 1024) {
          try { if (fs.readFileSync(p, "utf8").includes("sk-fake-persist-check")) hits.push(p); } catch {}
        }
      }
    };
    walk(path.join(ROOT, "projects", PROJECT));
    assert(hits.length === 0, `secret must never be written to project files (${hits.join(",")})`);
    delete process.env.OPENAI_API_KEY;
  });

  await runTest("CL9 HTTP error classified", async () => {
    const src = fs.readFileSync(path.join(ROOT, "providers", "runtime", "adapters", "cloud-openai-image.js"), "utf8");
    assert(/CLOUD_NETWORK_ERROR|TRANSIENT|transient/.test(src) && /PERMANENT|permanent/.test(src), "http errors must be classified transient/permanent");
  });

  await runTest("CL10 No free-tier claim fabricated", async () => {
    const cloudSrc = fs.readFileSync(path.join(ROOT, "providers", "runtime", "adapters", "configured-cloud.js"), "utf8");
    assert(/UNKNOWN/.test(cloudSrc), "generic cloud cost must be UNKNOWN");
    assert(!/always free|free forever|FREE_TIER guaranteed/i.test(cloudSrc), "no free-tier guarantee may be claimed");
    const cfg = require("js-yaml").load(fs.readFileSync(path.join(ROOT, "providers", "CONFIG.yaml"), "utf8"));
    assert(!JSON.stringify(cfg).includes("configured-free-cloud"), "generic slots must be renamed without free guarantee");
  });

  Object.assign(process.env, savedEnv);
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
