#!/usr/bin/env node
"use strict";

/**
 * Phase 1H.6 — compliance CLI (smallest machine-readable interface).
 * JSON to stdout; exit 0 on ok, 2 on handled error, 1 on fatal.
 *
 *   compliance.js snapshot --project PID --platform P --type T --url U --checked ISO
 *     [--title T --effective DATE --hash H --review-after-days N --rules <json>]
 *   compliance.js decide --project PID --platform P --type T --characteristics <json>
 *     [--asset A --unit U --evidence R1,R2]
 *   compliance.js freshness --project PID --id ccd-H
 *   compliance.js stale --project PID --id ccd-H --reason R
 *   compliance.js override --project PID --id ccd-H --new DECISION --reason R --actor A
 */

const path = require("path");
const comp = require("../../lib/compliance/index.js");

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
  console.error("usage: compliance.js <command> --project <pid> [options]");
  process.exit(2);
}

try {
  if (cmd === "snapshot") {
    out(comp.recordPolicySnapshot(ROOT, projectId, {
      platform: arg("--platform"), policyType: arg("--type"),
      sourceUrl: arg("--url"), sourceTitle: arg("--title", null),
      checkedAt: arg("--checked"), effectiveDate: arg("--effective", null),
      contentHash: arg("--hash", null),
      reviewAfterDays: arg("--review-after-days", null) === null ? null : Number(arg("--review-after-days")),
      rules: JSON.parse(arg("--rules", "[]")),
    }));
  } else if (cmd === "decide") {
    out(comp.decideCompliance(ROOT, projectId, {
      platform: arg("--platform"), policyType: arg("--type"),
      assetId: arg("--asset", null), publishUnitId: arg("--unit", null),
      characteristics: JSON.parse(arg("--characteristics", "{}")),
      evidenceRefs: (arg("--evidence", "") || "").split(",").filter(Boolean),
    }));
  } else if (cmd === "freshness") {
    out(comp.checkDecisionFreshness(ROOT, projectId, arg("--id", "")));
  } else if (cmd === "stale") {
    out(comp.markComplianceStale(ROOT, projectId, arg("--id", ""), arg("--reason", "")));
  } else if (cmd === "override") {
    out(comp.overrideDecision(ROOT, projectId, arg("--id", ""), {
      newDecision: arg("--new"), reason: arg("--reason", ""), actor: arg("--actor", ""),
    }));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
}
