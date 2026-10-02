"use strict";

/**
 * UNFOLDIQ research environment setup (PHASE 1G.1 Prompt 02).
 * One-command fresh-machine setup: venv -> pinned Crawl4AI -> setup -> doctor.
 *
 * Safe by design: no credentials stored, no global execution-policy change,
 * no silent system-software install. If a step needs admin/user action, the
 * script reports it instead of proceeding silently.
 *
 * Usage: npm run research:setup
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const RESEARCH_DIR = path.join(PROJECT_ROOT, "research");
const VENV_DIR = path.join(RESEARCH_DIR, ".venv");
const REQUIREMENTS = path.join(RESEARCH_DIR, "requirements.txt");

function findSystemPython() {
  if (process.env.UNFOLDIQ_PYTHON && fs.existsSync(process.env.UNFOLDIQ_PYTHON)) {
    return process.env.UNFOLDIQ_PYTHON;
  }
  const probe = (cmd, args) => {
    const r = spawnSync(cmd, [...args, "--version"], { encoding: "utf8" });
    return r.status === 0 ? { cmd, args } : null;
  };
  return probe("python", []) || (process.platform === "win32" ? probe("py", ["-3"]) : null);
}

function run(cmd, args, opts = {}) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    cwd: opts.cwd || PROJECT_ROOT,
    timeout: opts.timeout || 10 * 60 * 1000,
  });
  if (r.stdout) console.log(r.stdout.slice(-2000));
  if (r.stderr) console.error(String(r.stderr).slice(-2000));
  return r.status === 0;
}

function venvBin(name) {
  return process.platform === "win32"
    ? path.join(VENV_DIR, "Scripts", `${name}.exe`)
    : path.join(VENV_DIR, "bin", name);
}

function main() {
  console.log("=== UNFOLDIQ RESEARCH ENV SETUP ===");
  const found = findSystemPython();
  if (!found) {
    console.error("SETUP_BLOCKED: no system Python found (need >=3.10). Install Python 3.10+ and rerun.");
    process.exit(1);
  }
  if (!fs.existsSync(VENV_DIR)) {
    console.log(`creating dedicated venv at research/.venv ...`);
    if (!run(found.cmd, [...found.args, "-m", "venv", VENV_DIR])) {
      console.error("SETUP_FAILED: venv creation failed.");
      process.exit(1);
    }
  } else {
    console.log("venv exists: research/.venv (reuse; delete it for a clean reinstall)");
  }
  const venvPython = venvBin("python");
  if (!fs.existsSync(venvPython)) {
    console.error(`SETUP_FAILED: venv python missing at ${venvPython}`);
    process.exit(1);
  }
  if (!fs.existsSync(REQUIREMENTS)) {
    console.error(`SETUP_FAILED: missing ${REQUIREMENTS}`);
    process.exit(1);
  }
  if (!run(venvPython, ["-m", "pip", "install", "-r", REQUIREMENTS], { timeout: 15 * 60 * 1000 })) {
    console.error("SETUP_FAILED: pip install failed (network or build issue; rerun when fixed).");
    process.exit(1);
  }
  const setupBin = venvBin("crawl4ai-setup");
  if (fs.existsSync(setupBin)) {
    if (!run(setupBin, [], { timeout: 15 * 60 * 1000 })) {
      console.error("SETUP_WARNING: crawl4ai-setup reported failure. If it needs admin/user action, do that and rerun.");
      process.exit(1);
    }
  }
  const doctorBin = venvBin("crawl4ai-doctor");
  if (fs.existsSync(doctorBin)) {
    run(doctorBin, [], { timeout: 10 * 60 * 1000 });
  }
  console.log("\nSETUP_DONE: verify with `npm run research:verify` (no credentials, no paid API).");
}

main();
