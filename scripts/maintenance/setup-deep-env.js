"use strict";

/**
 * UNFOLDIQ DEEP provider env setup (PHASE 1G.1 Prompt 05).
 * Creates research/.venv-deep and installs pinned gpt-researcher.
 * Never touches the Crawl4AI venv. Never stores keys, never runs paid jobs.
 * Usage: npm run research:deep:setup
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.join(__dirname, "..", "..");
const VENV_DIR = path.join(PROJECT_ROOT, "research", ".venv-deep");
const REQUIREMENTS = path.join(PROJECT_ROOT, "research", "deep-requirements.txt");

function findSystemPython() {
  if (process.env.UNFOLDIQ_PYTHON && fs.existsSync(process.env.UNFOLDIQ_PYTHON)) return { cmd: process.env.UNFOLDIQ_PYTHON, args: [] };
  const probe = (cmd, args) => {
    const r = spawnSync(cmd, [...args, "--version"], { encoding: "utf8" });
    return r.status === 0 ? { cmd, args } : null;
  };
  return probe("python", []) || (process.platform === "win32" ? probe("py", ["-3"]) : null);
}

function run(cmd, args, timeout) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { encoding: "utf8", cwd: PROJECT_ROOT, timeout: timeout || 10 * 60 * 1000 });
  if (r.stdout) console.log(String(r.stdout).slice(-2000));
  if (r.stderr) console.error(String(r.stderr).slice(-2000));
  return r.status === 0;
}

function venvBin(name) {
  return process.platform === "win32"
    ? path.join(VENV_DIR, "Scripts", `${name}.exe`)
    : path.join(VENV_DIR, "bin", name);
}

function main() {
  console.log("=== UNFOLDIQ DEEP ENV SETUP (isolated from Crawl4AI env) ===");
  const found = findSystemPython();
  if (!found) {
    console.error("SETUP_BLOCKED: no system Python found (need >=3.12 for gpt-researcher).");
    process.exit(1);
  }
  if (!fs.existsSync(VENV_DIR)) {
    console.log("creating dedicated venv at research/.venv-deep ...");
    if (!run(found.cmd, [...found.args, "-m", "venv", VENV_DIR])) {
      console.error("SETUP_FAILED: venv creation failed.");
      process.exit(1);
    }
  } else {
    console.log("venv exists; reusing research/.venv-deep (Crawl4AI env untouched).");
  }
  console.log(`pinned requirements: ${REQUIREMENTS}`);
  if (!run(venvBin("python"), ["-m", "pip", "install", "-r", REQUIREMENTS], 15 * 60 * 1000)) {
    console.error("SETUP_FAILED: pinned provider install failed.");
    process.exit(1);
  }
  if (!run(venvBin("python"), ["-c", "import gpt_researcher; print('gpt_researcher import OK')"], 120000)) {
    console.error("SETUP_FAILED: provider import check failed.");
    process.exit(1);
  }
  console.log("\nSETUP_OK: deep venv ready. No keys stored, no paid job run. Next: npm run research:deep:doctor");
}

main();
