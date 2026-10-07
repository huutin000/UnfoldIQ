"use strict";

/**
 * POST-1H workspace hygiene gate (`npm run check:workspace`).
 * Machine-readable: prints JSON summary, exit 0 clean, exit 1 on any
 * BLOCKING violation. Checks: registry loads + validates; every direct
 * child of projects/ is registered or a canonical kind dir; no ad-hoc
 * root temp/debug folders; registered manifestRefs resolve; no
 * unregistered project-like directories.
 */

const fs = require("fs");
const path = require("path");
const ws = require("../../lib/workspace/index.js");

const REPO = path.join(__dirname, "..", "..");
const KIND_DIRS = new Set(["active", "validation", "demos", "debug", "archive", "runs"]);
const ROOT_DENY = /^(tmp\d*|temp\d*|debug-new|final-final|test2?|scratch\d*)$/i;

function main() {
  const violations = [];
  const warnings = [];
  const loaded = ws.loadRegistry(REPO);
  if (!loaded.ok) {
    console.log(JSON.stringify({ ok: false, violations: [{ code: loaded.code, message: loaded.message }], warnings: [] }));
    process.exit(1);
  }
  const projectsDir = path.join(REPO, "projects");
  let children = [];
  try {
    children = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) {
    violations.push({ code: "PROJECT_NOT_REGISTERED", message: `projects/ unreadable: ${e.message}` });
  }
  for (const name of children) {
    if (KIND_DIRS.has(name)) continue;
    const rel = `projects/${name}`;
    const registered = loaded.registry.projects.some((p) => rel === p.path || rel.startsWith(p.path + "/"));
    if (!registered) {
      violations.push({ code: "PROJECT_NOT_REGISTERED", message: `unregistered project-like directory: ${rel}` });
    }
  }
  for (const p of loaded.registry.projects) {
    if (p.manifestRef && !fs.existsSync(path.join(REPO, p.manifestRef))) {
      violations.push({ code: "PROJECT_NOT_REGISTERED", message: `manifestRef missing: ${p.manifestRef} (project ${p.projectId})` });
    }
    if (!fs.existsSync(path.join(REPO, p.path))) {
      warnings.push({ code: "PROJECT_PATH_MISSING", message: `registered path absent on disk: ${p.path}` });
    }
  }
  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(REPO, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { /* ignore */ }
  for (const name of rootEntries) {
    if (ROOT_DENY.test(name)) {
      violations.push({ code: "WORKSPACE_PATH_NOT_ALLOWED", message: `ad-hoc root folder forbidden: ${name}/` });
    }
  }
  const ok = violations.length === 0;
  console.log(JSON.stringify({ ok, violations, warnings, projects: loaded.registry.projects.length }));
  process.exit(ok ? 0 : 1);
}

main();
