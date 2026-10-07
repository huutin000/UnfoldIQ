#!/usr/bin/env node
"use strict";

/**
 * Phase 1H.5 — golden CLI (bounded runner + canary gate).
 * JSON to stdout; exit 0 on ok, 2 on handled error, 1 on fatal.
 * No paid generation on any path here.
 *
 *   golden.js list
 *   golden.js coverage
 *   golden.js compare --golden ID --label CANDIDATE --metrics <json>
 *   golden.js canary-open --change <json: {changeType,...}>
 *   golden.js canary-run --canary can-H --golden ID --label CANDIDATE --metrics <json>
 *   golden.js canary-promote --canary can-H --actor NAME --reason R --candidates <json: {goldenId: metrics}>
 */

const path = require("path");
const gold = require("../../lib/golden/index.js");

const REPO = path.join(__dirname, "..", "..");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function out(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

const cmd = process.argv[2];
if (!cmd) {
  console.error("usage: golden.js list|coverage|compare|canary-open|canary-run|canary-promote [options]");
  process.exit(2);
}

try {
  if (cmd === "list") {
    const loaded = gold.loadDoc("definitions", REPO);
    out(loaded.ok ? { ok: true, definitions: loaded.doc.definitions } : loaded);
  } else if (cmd === "coverage") {
    out(gold.coverageMatrix(REPO));
  } else if (cmd === "compare") {
    out(gold.compareToBaseline(REPO, arg("--golden"), { label: arg("--label", "candidate"), metrics: JSON.parse(arg("--metrics", "{}")) }));
  } else if (cmd === "canary-open") {
    out(gold.openCanary(REPO, JSON.parse(arg("--change", "{}"))));
  } else if (cmd === "canary-run") {
    out(gold.runCanaryGolden(REPO, arg("--canary"), arg("--golden"), { label: arg("--label", "candidate"), metrics: JSON.parse(arg("--metrics", "{}")) }));
  } else if (cmd === "canary-promote") {
    out(gold.promoteCanary(REPO, arg("--canary"), { actor: arg("--actor", ""), reason: arg("--reason", "") }, { candidates: JSON.parse(arg("--candidates", "{}")) }));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
}
