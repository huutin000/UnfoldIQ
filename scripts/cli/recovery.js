#!/usr/bin/env node
"use strict";

/**
 * Phase 1H.3 — recovery CLI (smallest machine-readable interface).
 * JSON to stdout; exit 0 on ok, 2 on handled error, 1 on fatal.
 *
 *   recovery.js begin --project PID --key K --type T --input <json> [--run R --job J --attempt A --parent op-H]
 *   recovery.js transition --project PID --id op-H --to STATUS [--result R --error E --class C]
 *   recovery.js checkpoint --project PID --id op-H --stage S [--note N --ref R]
 *   recovery.js checkpoints --project PID --id op-H
 *   recovery.js resume --project PID --id op-H
 *   recovery.js reconcile --project PID --id op-H --found true|false [--result R]
 *   recovery.js cancel-request --project PID --id op-H --reason R
 *   recovery.js cancel-confirm --project PID --id op-H
 */

const path = require("path");
const rec = require("../../lib/recovery/index.js");

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
  console.error("usage: recovery.js <command> --project <pid> [options]");
  process.exit(2);
}

try {
  if (cmd === "begin") {
    out(rec.beginOperation(ROOT, projectId, {
      idempotencyKey: arg("--key"), operationType: arg("--type"),
      input: JSON.parse(arg("--input", "{}")),
      runId: arg("--run", null), jobId: arg("--job", null), attemptId: arg("--attempt", null),
      parentOperationId: arg("--parent", null), generationId: arg("--generation", null),
    }));
  } else if (cmd === "transition") {
    out(rec.transitionOperation(ROOT, projectId, arg("--id"), arg("--to"), {
      resultRef: arg("--result", undefined), errorCode: arg("--error", undefined), failureClass: arg("--class", undefined),
    }));
  } else if (cmd === "checkpoint") {
    out(rec.checkpoint(ROOT, projectId, arg("--id"), {
      stage: arg("--stage"), note: arg("--note", null), stateRef: arg("--ref", null),
    }));
  } else if (cmd === "checkpoints") {
    out(rec.checkpointsFor(ROOT, projectId, arg("--id")));
  } else if (cmd === "resume") {
    out(rec.planResume(ROOT, projectId, arg("--id")));
  } else if (cmd === "reconcile") {
    out(rec.reconcileUnknownOutcome(ROOT, projectId, arg("--id"), {
      found: arg("--found", "false") === "true", resultRef: arg("--result", undefined),
    }));
  } else if (cmd === "cancel-request") {
    out(rec.requestCancel(ROOT, projectId, arg("--id"), arg("--reason", "")));
  } else if (cmd === "cancel-confirm") {
    out(rec.confirmCancel(ROOT, projectId, arg("--id")));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
}
