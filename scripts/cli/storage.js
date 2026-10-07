#!/usr/bin/env node
"use strict";

/**
 * Phase 1H.7 — storage CLI (inventory + lineage-safe cleanup, dry-run first).
 * JSON to stdout; exit 0 on ok, 2 on handled error, 1 on fatal.
 * Destructive execution requires an explicit EXECUTE plan + fresh state.
 *
 *   storage.js inventory --project PID
 *   storage.js stats --project PID
 *   storage.js plan [--project PID] [--execute] [--only R1,R2]
 *   storage.js execute --project PID --plan cln-H
 *   storage.js orphans --project PID
 *   storage.js duplicates --project PID
 */

const path = require("path");
const storage = require("../../lib/storage/index.js");

const ROOT = path.join(__dirname, "..", "..");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function out(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

const cmd = process.argv[2];
const projectId = arg("--project", null);
if (!cmd || !projectId) {
  console.error("usage: storage.js <command> --project <pid> [options]");
  process.exit(2);
}

try {
  if (cmd === "inventory") {
    out(storage.buildInventory(ROOT, projectId, {}));
  } else if (cmd === "stats") {
    out(storage.storageStats(ROOT, projectId));
  } else if (cmd === "plan") {
    const only = arg("--only", null);
    out(storage.planCleanup(ROOT, projectId, {
      mode: arg("--execute", null) === null ? "DRY_RUN" : "EXECUTE",
      onlyRefs: only ? only.split(",").filter(Boolean) : null,
    }));
  } else if (cmd === "execute") {
    out(storage.executeCleanup(ROOT, projectId, arg("--plan", "")));
  } else if (cmd === "orphans") {
    const inv = storage.loadStorage(ROOT, projectId);
    if (!inv.ok) out(inv);
    const known = Object.keys(inv.doc.inventory);
    out(storage.findOrphans(ROOT, projectId, known));
  } else if (cmd === "duplicates") {
    out(storage.findDuplicates(ROOT, projectId));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
}
