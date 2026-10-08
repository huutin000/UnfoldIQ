"use strict";

/**
 * Lifecycle for TEST-ONLY render fixtures (__5b_pilot__, __5c_long__, __5c_conc__, …).
 * The renderer contract requires `projects/<id>` + `remotion/public/unfoldiq/<id>` during a run, so the
 * fixture lives there ONLY while the suite executes and is removed on every exit path (pass, fail,
 * process.exit). Fixtures are never registered in projects/registry.json (production registry).
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");

function cleanupProjectFixture(projectId) {
  if (!/^__[A-Za-z0-9_]+__$/.test(projectId)) throw new Error(`refusing to clean non-fixture id ${projectId}`);
  for (const dir of [path.join(ROOT, "projects", projectId), path.join(ROOT, "remotion", "public", "unfoldiq", projectId)]) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* best effort */ }
  }
}

function registerFixtureCleanup(...projectIds) {
  process.on("exit", () => { for (const id of projectIds) cleanupProjectFixture(id); });
}

module.exports = { cleanupProjectFixture, registerFixtureCleanup };
