"use strict";

/**
 * PHASE 1G.1 Prompt 05 Fix 3 — root .env bootstrap regression.
 * Proves (hermetically, via temp .env files — the operator's real .env is
 * never touched) that a fresh process with NO provider variables in its shell
 * environment picks up the full Gemini-only DEEP configuration from the root
 * .env through the central bootstrap, that real shell values override .env,
 * and that no secret VALUE ever reaches stdout — names and presence only.
 */

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO_ROOT = path.join(__dirname, "..", "..");
const DUMMY = "DUMMY-NOT-A-SECRET-0123456789";
const SHELL_ONLY = "SHELL-WINS-NOT-A-SECRET-9876543210";
// Minimal Windows-viable child env WITHOUT any provider variables.
const BASE_ENV = {
  PATH: process.env.PATH || "",
  SystemRoot: process.env.SystemRoot || "",
  SystemDrive: process.env.SystemDrive || "C:",
  TEMP: process.env.TEMP || "",
  TMP: process.env.TMP || "",
  APPDATA: process.env.APPDATA || "",
};

const CONFIG_ENV = {
  GOOGLE_API_KEY: DUMMY,
  FAST_LLM: "google_genai:gemini-3.5-flash-lite",
  SMART_LLM: "google_genai:gemini-3.8-flash",
  STRATEGIC_LLM: "google_genai:gemini-3.8-flash",
  EMBEDDING: "google_genai:gemini-embedding-001",
  RETRIEVER: "duckduckgo",
};

let passed = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log(`ok ${passed} - ${label}`);
}

function writeTempEnv(extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-env-"));
  const file = path.join(dir, ".env");
  const lines = Object.entries({ ...CONFIG_ENV, ...(extra || {}) }).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return { dir, file };
}

function runNode(script, env) {
  const res = spawnSync(process.execPath, ["-e", script], {
    encoding: "utf8",
    cwd: REPO_ROOT,
    env,
    timeout: 120000,
  });
  return { status: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

// T1 — fresh process, no provider vars in shell, root(-like) .env present:
// bootstrap loads the full config; names reported, values never printed.
{
  const { dir, file } = writeTempEnv();
  const script = `
    const { loadRootEnv } = require(${JSON.stringify(path.join(REPO_ROOT, "lib", "env-bootstrap.js"))});
    const r = loadRootEnv(${JSON.stringify(file)});
    const dummy = ${JSON.stringify(DUMMY)};
    console.log(JSON.stringify({
      loaded: r.loaded,
      names: r.names,
      keyEqualsDummy: process.env.GOOGLE_API_KEY === dummy,
      fastOk: process.env.FAST_LLM === "google_genai:gemini-3.5-flash-lite",
      smartOk: process.env.SMART_LLM === "google_genai:gemini-3.8-flash",
      strategicOk: process.env.STRATEGIC_LLM === "google_genai:gemini-3.8-flash",
      embeddingOk: process.env.EMBEDDING === "google_genai:gemini-embedding-001",
      retrieverOk: process.env.RETRIEVER === "duckduckgo",
    }));
  `;
  const r = runNode(script, { ...BASE_ENV });
  ok(r.status === 0, "T1: bootstrap child exits clean");
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  ok(out.loaded === true, "T1: .env loaded");
  ok(["GOOGLE_API_KEY", "FAST_LLM", "SMART_LLM", "STRATEGIC_LLM", "EMBEDDING", "RETRIEVER"].every((n) => out.names.includes(n)),
    "T1: all DEEP variable names reported as loaded");
  ok(out.keyEqualsDummy && out.fastOk && out.smartOk && out.strategicOk && out.embeddingOk && out.retrieverOk,
    "T1: fresh process sees GOOGLE_API_KEY + FAST/SMART/STRATEGIC + EMBEDDING + RETRIEVER from .env");
  ok(!r.stdout.includes(DUMMY), "T1: dummy secret value never printed to stdout");
  fs.rmSync(dir, { recursive: true, force: true });
}

// T2 — shell environment overrides .env.
{
  const { dir, file } = writeTempEnv();
  const script = `
    const { loadRootEnv } = require(${JSON.stringify(path.join(REPO_ROOT, "lib", "env-bootstrap.js"))});
    const r = loadRootEnv(${JSON.stringify(file)});
    const shell = ${JSON.stringify(SHELL_ONLY)};
    console.log(JSON.stringify({
      loaded: r.loaded,
      shellWon: process.env.GOOGLE_API_KEY === shell,
      nameNotReloaded: !r.names.includes("GOOGLE_API_KEY"),
    }));
  `;
  const r = runNode(script, { ...BASE_ENV, GOOGLE_API_KEY: SHELL_ONLY });
  ok(r.status === 0, "T2: override child exits clean");
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  ok(out.loaded && out.shellWon && out.nameNotReloaded, "T2: shell GOOGLE_API_KEY wins over .env and is not reported as .env-loaded");
  fs.rmSync(dir, { recursive: true, force: true });
}

// T3 — doctor wiring end-to-end: fresh process + temp .env -> doctor reports
// the Gemini-only config READY (no live approval), without leaking the value.
{
  const { dir, file } = writeTempEnv();
  const script = `
    require(${JSON.stringify(path.join(REPO_ROOT, "lib", "env-bootstrap.js"))}).loadRootEnv(${JSON.stringify(file)});
    require(${JSON.stringify(path.join(REPO_ROOT, "scripts", "diagnostics", "deep-provider-doctor.js"))});
  `;
  const r = runNode(script, { ...BASE_ENV });
  ok(r.status === 0, "T3: doctor child exits clean");
  ok(/llmConfigured: yes/.test(r.stdout), "T3: doctor llmConfigured yes via .env");
  ok(/searchConfigured: yes/.test(r.stdout), "T3: doctor searchConfigured yes via .env");
  ok(/embeddingConfigured: yes/.test(r.stdout), "T3: doctor embeddingConfigured yes via .env");
  ok(/embedding selected: google_genai:gemini-embedding-001 \(explicit EMBEDDING\)/.test(r.stdout),
    "T3: doctor reports explicit google_genai embedding");
  ok(/status: READY_NO_LIVE_APPROVAL/.test(r.stdout), "T3: doctor READY_NO_LIVE_APPROVAL (live flag absent, correct)");
  ok(/GOOGLE_API_KEY/.test(r.stdout) && !r.stdout.includes(DUMMY), "T3: key NAME shown, key VALUE never printed");
  fs.rmSync(dir, { recursive: true, force: true });
}

// T4/T5 — missing file and lenient parsing never throw.
{
  const script = `
    const { loadRootEnv } = require(${JSON.stringify(path.join(REPO_ROOT, "lib", "env-bootstrap.js"))});
    const missing = loadRootEnv(${JSON.stringify(path.join(os.tmpdir(), "unfoldiq-definitely-missing-" + Date.now() + ".env"))});
    console.log(JSON.stringify({ missingLoaded: missing.loaded, missingNames: missing.names.length }));
  `;
  const r = runNode(script, { ...BASE_ENV });
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  ok(r.status === 0 && out.missingLoaded === false && out.missingNames === 0, "T4: missing .env -> loaded:false, no throw");

  const { dir, file } = writeTempEnv({ GARBAGE_LINE: undefined });
  fs.appendFileSync(file, "just-a-garbage-line-without-equals\n");
  const script2 = `
    const { loadRootEnv } = require(${JSON.stringify(path.join(REPO_ROOT, "lib", "env-bootstrap.js"))});
    const r = loadRootEnv(${JSON.stringify(file)});
    console.log(JSON.stringify({ loaded: r.loaded, retrieverOk: process.env.RETRIEVER === "duckduckgo" }));
  `;
  const r2 = runNode(script2, { ...BASE_ENV });
  const out2 = JSON.parse(r2.stdout.trim().split("\n").pop());
  ok(r2.status === 0 && out2.loaded && out2.retrieverOk, "T5: lenient parser — garbage line ignored, valid lines still load");
  fs.rmSync(dir, { recursive: true, force: true });
}

// T6 — UTF-8 BOM in .env fails loudly (first variable would otherwise be
// silently corrupted into "\uFEFFNAME" and never match).
{
  const { dir, file } = writeTempEnv();
  const raw = fs.readFileSync(file);
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), raw]));
  const script = `
    const { loadRootEnv } = require(${JSON.stringify(path.join(REPO_ROOT, "lib", "env-bootstrap.js"))});
    const r = loadRootEnv(${JSON.stringify(file)});
    console.log(JSON.stringify({ loaded: r.loaded, bomError: /BOM/.test(r.error || "") }));
  `;
  const r = runNode(script, { ...BASE_ENV });
  const out = JSON.parse(r.stdout.trim().split("\n").pop());
  ok(r.status === 0 && out.loaded === false && out.bomError === true, "T6: BOM .env -> loaded:false with explicit BOM diagnostic");
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\nRESULT: ALL TESTS PASSED (${passed} assertions)`);
