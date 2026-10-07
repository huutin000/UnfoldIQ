"use strict";

/**
 * UNFOLDIQ Flow Companion doctor (STEP 10B).
 * Checks bridge files, schemas, extension manifest/build output, selector
 * health fixture, job store, path policy, secret hygiene, permissions,
 * upstream attribution. Never opens/logs into Flow. Prints no secrets.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const lines = [];
let failures = 0;

function check(name, ok, detail = "") {
  lines.push(`${ok ? "OK" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

function exists(p) {
  return fs.existsSync(path.join(ROOT, p));
}

// Bridge files.
for (const f of ["flow-companion/bridge/server.js", "flow-companion/bridge/security.js", "flow-companion/bridge/path-policy.js", "flow-companion/bridge/job-store.js", "flow-companion/bridge/state-machine.js", "flow-companion/bridge/importer.js", "flow-companion/bridge/manual-assist.js"]) {
  check(`bridge file ${f}`, exists(f));
}

// Schema.
check("schemas/flow-job.schema.json", exists("schemas/flow-job.schema.json"));

// Extension manifest + minimal permissions.
let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "flow-companion/extension/manifest.json"), "utf8"));
  check("extension manifest MV3", manifest.manifest_version === 3);
  check("no <all_urls> permission", !(manifest.permissions || []).includes("<all_urls>") && !JSON.stringify(manifest.host_permissions || []).includes("<all_urls>"));
} catch (e) {
  check("extension manifest readable", false, e.message);
}

// Expected build output.
check("extension dist output", exists("flow-companion/extension/.output/chrome-mv3/manifest.json"), "run `npm run build` in flow-companion/extension if missing");

// Selector health fixture (honest placeholder status).
try {
  const adapter = require("../../flow-companion/extension/src/content/flow-page-adapter.js");
  const statuses = Object.values(adapter.SELECTORS).map((s) => s.status);
  check("selector health fixture present", statuses.length > 0, `statuses: ${[...new Set(statuses)].join(",")}`);
  const centralized = Object.keys(adapter).includes("prepareJob");
  check("adapter boundary centralized", centralized);
  // FIX 02 §20 — instruction plumbing presence (static table + pure
  // functions only; live verification stays a live-gate concern, never here).
  const ikeys = ["AGENT_INSTRUCTIONS_BUTTON", "INSTRUCTION_ADD", "INSTRUCTION_EDITOR", "INSTRUCTION_REFERENCE_ATTACH", "INSTRUCTION_DONE", "INSTRUCTION_READBACK"];
  check("instruction selectors table present", ikeys.every((k) => adapter.SELECTORS && adapter.SELECTORS[k]), `statuses: ${[...new Set(ikeys.map((k) => adapter.SELECTORS[k] && adapter.SELECTORS[k].status))].join(",")}`);
  check("instruction diagnostics builder present", typeof adapter.buildInstructionDiagnostics === "function");
  check("instruction identity extractor present", typeof adapter.extractFlowProjectIdentity === "function" && typeof adapter.verifyProjectIdentity === "function");
  check("instruction apply gating present", typeof adapter.ensureAgentOn === "function" && typeof adapter.setInstructionGuidelines === "function");
  try {
    const cmds = require("../../flow-companion/extension/src/content/content-commands.js");
    check("instruction apply command registered", cmds.COMMAND_TYPES.has("APPLY_AGENT_INSTRUCTIONS"));
    check("instruction read command registered", cmds.COMMAND_TYPES.has("READ_AGENT_INSTRUCTIONS"));
  } catch (e) {
    check("instruction commands load", false, e.message);
  }
} catch (e) {
  check("adapter loads", false, e.message);
}

// Job store round-trip (temp project, cleaned up).
try {
  const store = require("../../flow-companion/bridge/job-store.js");
  const proj = "__doctor_check__";
  const job = store.createJob(ROOT, { projectId: proj, jobId: "DOCTOR-1", requestId: "R", sceneId: "S", capability: "image", mode: "ASSISTED_APPROVAL", prompt: "x", platform: "youtube", flowProject: { mode: "REUSE" }, outputRequirements: {}, creativeContext: {}, expectedOutputPath: "x", attempt: 1 });
  check("job store round-trip", store.getJob(ROOT, proj, "DOCTOR-1").jobId === job.jobId);
  fs.rmSync(path.join(ROOT, "projects", proj), { recursive: true, force: true });
} catch (e) {
  check("job store round-trip", false, e.message);
}

// Path policy.
try {
  const pp = require("../../flow-companion/bridge/path-policy.js");
  let blocked = false;
  try {
    pp.resolveProjectPath(ROOT, "p", "../../evil");
  } catch {
    blocked = true;
  }
  check("path policy blocks traversal", blocked);
} catch (e) {
  check("path policy loads", false, e.message);
}

// No secret persistence in companion sources.
{
  const suspects = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".output", "tests"].includes(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".js")) {
        const src = fs.readFileSync(p, "utf8");
        if (/password\s*[:=]\s*["'][^"']+["']|api[_-]?key\s*[:=]\s*["'][^"']+["']|document\.cookie/i.test(src)) suspects.push(path.relative(ROOT, p));
      }
    }
  };
  try {
    walk(path.join(ROOT, "flow-companion"));
    check("no secret persistence patterns", suspects.length === 0, suspects.join(","));
  } catch (e) {
    check("secret scan", false, e.message);
  }
}

// Upstream attribution.
check("upstream attribution file", exists("flow-companion/LICENSES/THIRD_PARTY_NOTICES.md"));

// flow-web registration.
try {
  const { registerCoreProviders } = require("../../providers/runtime/bootstrap.js");
  registerCoreProviders();
  const fw = require("../../providers/runtime/adapters/flow-web.js");
  check("flow-web registers", fw.registerFlowWeb() === "flow-web");
  registerCoreProviders();
} catch (e) {
  check("flow-web registers", false, e.message);
}

console.log(["=== FLOW COMPANION DOCTOR (STEP 10B) ===", ...lines].join("\n"));
process.exit(failures > 0 ? 1 : 0);
