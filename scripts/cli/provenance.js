#!/usr/bin/env node
"use strict";

/**
 * Phase 1H.6 — provenance CLI (smallest machine-readable interface).
 * JSON to stdout; exit 0 on ok, 2 on handled error, 1 on fatal.
 *
 *   provenance.js migrate --project PID
 *   provenance.js show --project PID --asset ASSETID
 *   provenance.js trace --project PID --asset ASSETID
 *   provenance.js record --project PID --asset ASSETID --origin TYPE
 *     [--provider P --model M --hash H --parent A,B --ref A,B --status S --detail D --evidence R1,R2]
 */

const path = require("path");
const prov = require("../../lib/provenance/index.js");
const migrate = require("../../lib/provenance/migrate.js");

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
  console.error("usage: provenance.js migrate|show|trace|record --project <pid> [options]");
  process.exit(2);
}

try {
  if (cmd === "migrate") {
    const assetLib = require("../../lib/asset-library/index.js");
    out(migrate.bootstrapProvenance(ROOT, projectId, { assetLib }));
  } else if (cmd === "show") {
    out(prov.getProvenance(ROOT, projectId, arg("--asset", "")));
  } else if (cmd === "trace") {
    out(prov.traceLineage(ROOT, projectId, arg("--asset", "")));
  } else if (cmd === "record") {
    const split = (v) => (v ? v.split(",").filter(Boolean) : []);
    out(prov.recordProvenance(ROOT, projectId, {
      assetId: arg("--asset"), originType: arg("--origin"),
      provider: arg("--provider", null), model: arg("--model", null),
      assetHash: arg("--hash", null),
      parentAssetIds: split(arg("--parent", null)),
      referenceAssetIds: split(arg("--ref", null)),
      provenanceStatus: arg("--status", null),
      detail: arg("--detail", null),
      evidenceRefs: split(arg("--evidence", null)),
      rights: { ownershipStatus: "UNRESOLVED", referenceRightsStatus: "UNRESOLVED" },
    }));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
}
