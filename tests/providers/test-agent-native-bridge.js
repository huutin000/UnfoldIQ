"use strict";

/**
 * Agent-native bridge tests (STEP 10C): AN1–AN10.
 * No assumption that any agent product has media tools.
 * Fixtures under projects/__10c_agent__/ (removed in teardown).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const PROJECT = "__10c_agent__";

const { registerAllProviders } = require("../../providers/runtime/bootstrap.js");
const { ProviderError } = require("../../providers/runtime/errors.js");
const store = require("../../providers/runtime/artifact-store.js");
const nativeReg = require("../../providers/runtime/adapters/agent-native-registry.js");

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
    requestId: `AN-${Math.random().toString(36).slice(2, 8)}`,
    projectId: PROJECT,
    sceneId: "S01",
    capability: "image",
    input: { prompt: "a test image" },
    outputRequirements: {},
    continuityContext: { requiredEntities: ["CHAR_A"], requiredReferences: ["REF_A"], continuityStrictness: "NORMAL" },
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
  console.log("=== AGENT-NATIVE BRIDGE TESTS (AN1-AN10) ===\n");
  registerAllProviders();
  const an = require("../../providers/runtime/adapters/agent-native.js");

  await runTest("AN1 No declared capability → NOT_AVAILABLE", async () => {
    const code = await codeOf(an.execute(baseRequest(), { projectRoot: ROOT }));
    assert(code && /NOT_AVAILABLE|NOT_CONFIGURED|BRIDGE_NOT_CONFIGURED/.test(code), `expected NOT_AVAILABLE family, got ${code}`);
  });

  await runTest("AN2 Declared image capability → action handoff packet", async () => {
    nativeReg.declareCapabilities({ sessionId: "SES-IMG", agentName: "TestAgent", toolName: "native-image", capabilities: ["image"] });
    const r = await an.execute(baseRequest(), { projectRoot: ROOT, agentSessionId: "SES-IMG" });
    assert(r.status === "HANDOFF_REQUIRED", "must be HANDOFF_REQUIRED");
    assert(r.agentAction && r.agentAction.action === "AGENT_NATIVE_GENERATE", "must carry agent action packet");
    nativeReg.clearSession("SES-IMG");
  });

  await runTest("AN3 Declared video absent → no video assumption", async () => {
    nativeReg.declareCapabilities({ sessionId: "SES-IMG2", agentName: "TestAgent", toolName: "native-image", capabilities: ["image"] });
    const code = await codeOf(an.execute(baseRequest({ capability: "video" }), { projectRoot: ROOT, agentSessionId: "SES-IMG2" }));
    assert(code && /NOT_AVAILABLE/.test(code), `video must not be assumed, got ${code}`);
    nativeReg.clearSession("SES-IMG2");
  });

  await runTest("AN4 Submitted valid image result imports READY", async () => {
    const { execFileSync } = require("child_process");
    store.writeArtifactAtomic(ROOT, PROJECT, "uploads/agent-img.png", Buffer.from("PNG-AGENT"));
    const sub = {
      version: "1.0.0", requestId: "AN4-REQ", projectId: PROJECT, sceneId: "S01", capability: "image",
      agentName: "TestAgent", toolName: "native-image", artifactSourcePath: "uploads/agent-img.png",
      safetyAttestation: { step09Decision: "ALLOW", notSafetyRefused: true },
      continuityMetadata: { entitiesUsed: ["CHAR_A"], referenceAssetIds: ["REF_A"] },
    };
    const subPath = path.join(ROOT, "projects", PROJECT, "an4.json");
    fs.mkdirSync(path.dirname(subPath), { recursive: true });
    fs.writeFileSync(subPath, JSON.stringify(sub));
    const out = execFileSync("node", [path.join(ROOT, "scripts/cli/provider-cli.js"), "--submit-agent-result", subPath, "--project-root", ROOT], { encoding: "utf8" });
    const res = JSON.parse(out.slice(out.indexOf("{")));
    assert(res.status === "READY" && res.providerId === "agent-native", "valid submission must import READY");
  });

  await runTest("AN5 Wrong request/job rejected", async () => {
    const { execFileSync } = require("child_process");
    const sub = {
      version: "1.0.0", requestId: "AN5-REQ", projectId: PROJECT, sceneId: "S01", capability: "image",
      agentName: "TestAgent", toolName: "native-image", artifactSourcePath: "uploads/missing.png",
      safetyAttestation: { step09Decision: "ALLOW", notSafetyRefused: true },
    };
    const subPath = path.join(ROOT, "projects", PROJECT, "an5.json");
    fs.writeFileSync(subPath, JSON.stringify(sub));
    let rejected = false;
    try {
      execFileSync("node", [path.join(ROOT, "scripts/cli/provider-cli.js"), "--submit-agent-result", subPath, "--project-root", ROOT], { encoding: "utf8", stdio: "pipe" });
    } catch { rejected = true; }
    assert(rejected, "missing artifact path must be rejected");
  });

  await runTest("AN6 External path rejected", async () => {
    const { execFileSync } = require("child_process");
    const sub = {
      version: "1.0.0", requestId: "AN6-REQ", projectId: PROJECT, sceneId: "S01", capability: "image",
      agentName: "TestAgent", toolName: "native-image", artifactSourcePath: "../../evil.png",
      safetyAttestation: { step09Decision: "ALLOW", notSafetyRefused: true },
    };
    const subPath = path.join(ROOT, "projects", PROJECT, "an6.json");
    fs.writeFileSync(subPath, JSON.stringify(sub));
    let rejected = false;
    try {
      execFileSync("node", [path.join(ROOT, "scripts/cli/provider-cli.js"), "--submit-agent-result", subPath, "--project-root", ROOT], { encoding: "utf8", stdio: "pipe" });
    } catch { rejected = true; }
    assert(rejected, "traversal path must be rejected");
  });

  await runTest("AN7 Provenance names agent/native tool", async () => {
    const { execFileSync } = require("child_process");
    store.writeArtifactAtomic(ROOT, PROJECT, "uploads/agent-img7.png", Buffer.from("PNG7"));
    const sub = {
      version: "1.0.0", requestId: "AN7-REQ", projectId: PROJECT, sceneId: "S01", capability: "image",
      agentName: "TestAgent", toolName: "native-image-7", artifactSourcePath: "uploads/agent-img7.png",
      safetyAttestation: { step09Decision: "ALLOW", notSafetyRefused: true },
    };
    const subPath = path.join(ROOT, "projects", PROJECT, "an7.json");
    fs.writeFileSync(subPath, JSON.stringify(sub));
    const out = execFileSync("node", [path.join(ROOT, "scripts/cli/provider-cli.js"), "--submit-agent-result", subPath, "--project-root", ROOT], { encoding: "utf8" });
    assert(/TestAgent\/native-image-7/.test(out), "provenance must name agent/tool");
  });

  await runTest("AN8 Continuity metadata preserved", async () => {
    const pkt = nativeReg.buildHandoffPacket(baseRequest(), (() => {
      nativeReg.declareCapabilities({ sessionId: "SES-C", agentName: "A", toolName: "t", capabilities: ["image"] });
      return { sessionId: "SES-C", agentName: "A", toolName: "t" };
    })());
    assert(pkt.agentAction.continuity.requiredEntities.includes("CHAR_A"), "continuity entities must survive handoff");
    nativeReg.clearSession("SES-C");
  });

  await runTest("AN9 Rejected artifact not READY", async () => {
    const { execFileSync } = require("child_process");
    store.writeArtifactAtomic(ROOT, PROJECT, "uploads/empty.png", Buffer.alloc(0));
    const sub = {
      version: "1.0.0", requestId: "AN9-REQ", projectId: PROJECT, sceneId: "S01", capability: "image",
      agentName: "TestAgent", toolName: "t", artifactSourcePath: "uploads/empty.png",
      safetyAttestation: { step09Decision: "ALLOW", notSafetyRefused: true },
    };
    const subPath = path.join(ROOT, "projects", PROJECT, "an9.json");
    fs.writeFileSync(subPath, JSON.stringify(sub));
    let rejected = false;
    try {
      execFileSync("node", [path.join(ROOT, "scripts/cli/provider-cli.js"), "--submit-agent-result", subPath, "--project-root", ROOT], { encoding: "utf8", stdio: "pipe" });
    } catch { rejected = true; }
    assert(rejected, "empty artifact must not become READY");
  });

  await runTest("AN10 Capability declaration is session/runtime scoped, not eternal", async () => {
    nativeReg.declareCapabilities({ sessionId: "SES-T", agentName: "A", capabilities: ["image"], ttlMs: 1 });
    await new Promise((r) => setTimeout(r, 10));
    const code = await codeOf(an.execute(baseRequest(), { projectRoot: ROOT, agentSessionId: "SES-T" }));
    assert(code && /NOT_AVAILABLE/.test(code), `expired session must not be capable, got ${code}`);
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
