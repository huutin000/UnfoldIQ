"use strict";

/**
 * UNFOLDIQ provider doctor — FINAL (STEP 10C).
 * Sections: Core / Flow / Local / MCP / Cloud / Agent Native.
 * Prints no secrets. Exit 0 always (doctor reports, never fails builds).
 */

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const { registerAllProviders } = require("../../providers/runtime/bootstrap.js");
const { listProviders, getProvider } = require("../../providers/runtime/registry.js");
const { loadCostPolicy } = require("../../providers/runtime/cost-policy.js");

function section(title) {
  console.log(`\n## ${title}`);
}

function line(s) {
  console.log(s);
}

function safeRequire(rel) {
  try {
    return require(path.join(PROJECT_ROOT, rel));
  } catch {
    return null;
  }
}

function main() {
  registerAllProviders();
  console.log("=== UNFOLDIQ PROVIDER DOCTOR (STEP 10C FINAL) ===");

  // ---- Core ----
  section("Core");
  const resolverOk = !!safeRequire("providers/runtime/resolver.js");
  const storeOk = !!safeRequire("providers/runtime/artifact-store.js");
  line(`resolver: ${resolverOk ? "REGISTERED" : "MISSING"}`);
  line(`artifact store: ${storeOk ? "REGISTERED" : "MISSING"}`);
  let configured = [];
  try {
    const cfg = yaml.load(fs.readFileSync(path.join(PROJECT_ROOT, "providers", "CONFIG.yaml"), "utf8"));
    for (const [cap, def] of Object.entries(cfg.capabilities || {})) {
      for (const id of def.preferredOrder || []) configured.push(`${cap}:${id}`);
    }
  } catch (e) {
    line(`CONFIG_READ_FAILED: ${e.message}`);
  }
  line(`configured provider IDs: ${configured.join(" ")}`);
  const policy = loadCostPolicy(PROJECT_ROOT);
  line(`costPolicy.preferZeroMarginalCost=${policy.preferZeroMarginalCost}`);
  line(`costPolicy.allowPaidCloud=${policy.allowPaidCloud} (paid cloud disabled by default)`);

  // ---- Flow ----
  section("Flow");
  const flowRegistered = !!getProvider("flow-web");
  line(`bridge files: ${["flow-companion/bridge/server.js", "flow-companion/bridge/job-store.js", "flow-companion/bridge/state-machine.js", "flow-companion/bridge/manual-assist.js"].every((f) => fs.existsSync(path.join(PROJECT_ROOT, f))) ? "PRESENT" : "MISSING"}`);
  line(`extension manifest: ${fs.existsSync(path.join(PROJECT_ROOT, "flow-companion/extension/manifest.json")) ? "PRESENT" : "MISSING"}`);
  line(`flow-web registered: ${flowRegistered ? "yes" : "no"}`);
  line("uiSelectors: NOT_VERIFIED (placeholders; live UI not verified from CLI)");
  try {
    const adapter = safeRequire("flow-companion/extension/src/content/flow-page-adapter.js");
    const ikeys = ["AGENT_INSTRUCTIONS_BUTTON", "INSTRUCTION_ADD", "INSTRUCTION_EDITOR", "INSTRUCTION_REFERENCE_ATTACH", "INSTRUCTION_DONE", "INSTRUCTION_READBACK"];
    const istatus = [...new Set(ikeys.map((k) => (adapter.SELECTORS[k] || {}).status))].join(",");
    line(`instructionSelectors: ${istatus} (static table; live adoption needs authenticated DOM evidence)`);
    line(`instructionReadback: ${typeof adapter.extractInstructionReadback === "function" ? "EXTRACTOR_PRESENT" : "MISSING"} (read-only; live proof is a live-gate concern)`);
    line(`instructionApply: ${typeof adapter.ensureAgentOn === "function" && typeof adapter.setInstructionGuidelines === "function" ? "GATED_COMMAND_AVAILABLE" : "MISSING"} (preconditions enforced in-dispatcher; doctor never mutates)`);
    line(`projectIdentity: ${typeof adapter.extractFlowProjectIdentity === "function" ? "EXTRACTOR_PRESENT" : "MISSING"} (read-only; no binding invented by doctor)`);
  } catch (e) {
    line(`instructionPlumbing: UNVERIFIABLE (${e.message})`);
  }
  line("live generation: NOT_VERIFIED (no credits consumed by doctor)");
  // §28A origin compatibility
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "flow-companion/extension/manifest.json"), "utf8"));
    const fw = safeRequire("providers/runtime/adapters/flow-web.js");
    if (fw && fw.checkFlowOriginCoverage) {
      const r = fw.checkFlowOriginCoverage(manifest, "https://labs.google/fx");
      line(`flow origin canonical=${r.canonical} observed=https://labs.google/fx status=${r.status}`);
      const r2 = fw.checkFlowOriginCoverage(manifest, "https://flow.google");
      line(`flow origin future-fixture observed=https://flow.google status=${r2.status} (exact-permission policy; no <all_urls>)`);
      const rLive = fw.checkFlowOriginCoverage(manifest, "https://flow.google.com");
      line(`flow origin live-observed observed=https://flow.google.com status=${rLive.status} (exact-permission policy; no <all_urls>)`);
      const r3 = fw.checkFlowOriginCoverage(manifest, "https://evil.example/");
      line(`flow origin unknown-fixture status=${r3.status} (must fail safe)`);
    } else {
      line("flow origin: ORIGIN_NOT_VERIFIED (helper unavailable)");
    }
  } catch (e) {
    line(`flow origin: ORIGIN_NOT_VERIFIED (${e.message})`);
  }

  // ---- Local ----
  section("Local");
  for (const id of ["local-comfyui-image", "local-comfyui-video", "local-kokoro", "local-whisper"]) {
    const p = getProvider(id);
    line(`${id}: ${p ? `REGISTERED [${p.capabilities.join(",")}] cost=${p.costClass}` : "NOT_REGISTERED"}`);
  }
  // Live availability via local-media-doctor modules (guarded, inspection only).
  try {
    const hw = safeRequire("providers/runtime/hardware-policy.js");
    const sys = hw ? hw.getSystemInfo() : null;
    line(`local system: ${sys ? `os=${sys.os} cpus=${sys.cpuCount} ramGB=${sys.ramGB} gpu=${sys.gpu || "none"} vramGB=${sys.vramGB === null || sys.vramGB === undefined ? "unknown" : sys.vramGB}` : "UNKNOWN"}`);
  } catch {
    line("local system: UNKNOWN");
  }
  try {
    const kok = safeRequire("providers/runtime/adapters/local-kokoro.js");
    line(`kokoro languages: ${kok ? kok.SUPPORTED_LANGUAGES.join(",") : "UNKNOWN"} (vietnamese: unsupported)`);
  } catch {
    line("kokoro languages: UNKNOWN");
  }
  line("comfyui server: see `node scripts/diagnostics/local-media-doctor.js` (NOT_VERIFIED here; no network probe in provider-doctor)");
  line("whisper binary/model: see `node scripts/diagnostics/local-media-doctor.js` (no transcription by doctor)");

  // ---- MCP ----
  section("MCP");
  const mcpServer = path.join(PROJECT_ROOT, "mcp", "unfoldiq-media", "server.js");
  line(`server file: ${fs.existsSync(mcpServer) ? "PRESENT" : "MISSING"}`);
  try {
    const tools = safeRequire("mcp/unfoldiq-media/tools/index.js");
    const names = tools && (tools.TOOL_NAMES || (tools.TOOL_DEFS || []).map((t) => t.name)) || [];
    line(`tool catalog (${names.length}): ${names.join(",") || "UNKNOWN"}`);
  } catch {
    line("tool catalog: UNKNOWN (tools/index.js not loadable)");
  }
  line("protocol test: run `node mcp/unfoldiq-media/tests/run.js`");

  // ---- Cloud ----
  section("Cloud");
  const cloudIds = ["openai-image", "google-veo", "elevenlabs-tts", "elevenlabs-stt", "configured-cloud-image", "configured-cloud-video", "configured-cloud-tts", "configured-cloud-stt"];
  const keyEnv = { "openai-image": "OPENAI_API_KEY", "google-veo": "GEMINI_API_KEY|GOOGLE_API_KEY", "elevenlabs-tts": "ELEVENLABS_API_KEY", "elevenlabs-stt": "ELEVENLABS_API_KEY" };
  for (const id of cloudIds) {
    const p = getProvider(id);
    const envSpec = keyEnv[id] || "UNFOLDIQ_CONFIGURED_CLOUD_*";
    const keySet = envSpec.split("|").some((k) => !!process.env[k]);
    line(`${id}: ${p ? "REGISTERED" : "NOT_REGISTERED"} enabled=no (default) key=${keySet ? "set (value hidden)" : "not-set"} paidAllowed=${policy.allowPaidCloud}`);
  }

  // ---- Agent Native ----
  section("Agent Native");
  const an = getProvider("agent-native");
  line(`bridge protocol: ${an ? "REGISTERED" : "MISSING"} (runtime/session-declared capabilities only; no implicit image/video)`);
  try {
    safeRequire("providers/runtime/adapters/agent-native-registry.js");
    line("declared sessions: session-scoped registry loaded (in-memory; not eternal)");
  } catch {
    line("declared sessions: UNKNOWN");
  }

  line("\nsecrets: none printed (by design)");
}

main();
