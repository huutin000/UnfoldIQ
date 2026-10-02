"use strict";

/**
 * UNFOLDIQ Step 10 final readiness (STEP 10C §48).
 * Reports Architecture / Live Availability / Safe Fallback SEPARATELY.
 * Never collapses architecture PASS with live environment availability.
 * Exit 0 always (readiness reports; build gates read the JSON).
 */

const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..", "..");

function fileExists(rel) {
  return fs.existsSync(path.join(PROJECT_ROOT, rel));
}

function safeRequire(rel) {
  try {
    return require(path.join(PROJECT_ROOT, rel));
  } catch (e) {
    return { __error: e.message };
  }
}

function main() {
  const architecture = {};
  const live = {};
  const fallback = {};

  // ---- Architecture: implementation presence ----
  const { registerAllProviders } = safeRequire("providers/runtime/bootstrap.js");
  let registered = [];
  if (typeof registerAllProviders === "function") {
    try {
      registered = registerAllProviders();
    } catch {
      registered = [];
    }
  }
  const { getProvider } = safeRequire("providers/runtime/registry.js");
  const has = typeof getProvider === "function" ? (id) => !!getProvider(id) : () => false;

  architecture.coreRuntime = has("existing") && has("approved-local") && has("external-handoff") ? "PASS" : "FAIL";
  architecture.continuity = fileExists("lib/continuity-check.js") ? "PASS" : "FAIL";
  architecture.duration = fileExists("lib/duration-planner.js") && fileExists("lib/duration-check.js") ? "PASS" : "FAIL";
  architecture.flowCompanion = has("flow-web") && fileExists("flow-companion/bridge/server.js") ? "PASS" : "FAIL";
  architecture.localProviders =
    has("local-comfyui-image") && has("local-comfyui-video") && has("local-kokoro") && has("local-whisper") ? "PASS" : "FAIL";
  architecture.mcp = fileExists("mcp/unfoldiq-media/server.js") && fileExists("mcp/unfoldiq-media/tools/index.js") ? "PASS" : "FAIL";
  architecture.cloudFallback =
    has("openai-image") && has("google-veo") && has("elevenlabs-tts") && has("elevenlabs-stt") ? "PASS" : "FAIL";
  architecture.registeredProviders = registered;

  // ---- Live Availability: environment truth (NOT_VERIFIED unless proven) ----
  live.flowLiveUI = "NOT_VERIFIED (no browser check from CLI; see scripts/diagnostics/flow-companion-doctor.js)";
  live.flowLiveGeneration = "NOT_VERIFIED (no credits consumed by readiness)";
  try {
    const fw = safeRequire("providers/runtime/adapters/flow-web.js");
    const manifest = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "flow-companion/extension/manifest.json"), "utf8"));
    if (fw && fw.checkFlowOriginCoverage) {
      const r = fw.checkFlowOriginCoverage(manifest, "https://labs.google/fx");
      live.flowOriginCoverage = r.status;
    } else live.flowOriginCoverage = "ORIGIN_NOT_VERIFIED";
  } catch {
    live.flowOriginCoverage = "ORIGIN_NOT_VERIFIED";
  }
  // ComfyUI / Kokoro / whisper: best-effort synchronous probes only.
  live.comfyuiInstalled = "NOT_VERIFIED (run `node scripts/diagnostics/local-media-doctor.js` for live probe)";
  live.kokoroInstalled = "NOT_VERIFIED (run `node scripts/diagnostics/local-media-doctor.js` for live probe)";
  live.whisperInstalled = "NOT_VERIFIED (run `node scripts/diagnostics/local-media-doctor.js`; no model auto-download)";
  const cloudKeys = {
    openaiImage: !!process.env.OPENAI_API_KEY,
    googleVeo: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
    elevenlabs: !!process.env.ELEVENLABS_API_KEY,
  };
  live.cloudKeysConfigured = { openaiImage: cloudKeys.openaiImage ? "set (hidden)" : "not-set", googleVeo: cloudKeys.googleVeo ? "set (hidden)" : "not-set", elevenlabs: cloudKeys.elevenlabs ? "set (hidden)" : "not-set" };

  // ---- Safe Fallback: can the system still complete a handoff? ----
  fallback.externalHandoff = has("external-handoff") ? "PASS" : "FAIL";
  fallback.flowManualAssist = fileExists("flow-companion/bridge/manual-assist.js") ? "PASS" : "FAIL";
  fallback.agentNativeHandoff = has("agent-native") ? "PASS" : "FAIL";
  fallback.overall = fallback.externalHandoff === "PASS" ? "PASS (handoff packet always available)" : "FAIL";

  const architecturePass = Object.entries(architecture)
    .filter(([k]) => k !== "registeredProviders")
    .every(([, v]) => v === "PASS");

  const out = {
    version: "1.0.0",
    step: "10C",
    architecture,
    architectureOverall: architecturePass ? "PASS" : "FAIL",
    liveAvailability: live,
    safeFallback: fallback,
    note: "Architecture PASS does not imply live provider availability. Live tools/models/keys are reported truthfully above.",
  };
  console.log(JSON.stringify(out, null, 2));
}

main();
