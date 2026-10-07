#!/usr/bin/env node
"use strict";

/**
 * Phase 1H.4 — telemetry CLI (LOG-FIRST inspection).
 * JSON to stdout; exit 0 on ok, 2 on handled error, 1 on fatal.
 *
 *   telemetry.js list --project PID [--event NAME --job J --attempt A --operation O
 *     --correlation C --since ISO --until ISO --error CODE --provider P --model M
 *     --severity S --limit N]
 *   telemetry.js trace --project PID --correlation C
 *   telemetry.js errors --project PID [--component C --stage S]
 *   telemetry.js costs --project PID [--job J]
 *   telemetry.js evidence-get --project PID --id evi-H
 */

const path = require("path");
const tel = require("../../lib/telemetry/index.js");

const ROOT = path.join(__dirname, "..", "..");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}

function out(result) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 2);
}

function filters() {
  const f = {};
  for (const [flag, key] of [["--event", "eventName"], ["--job", "jobId"], ["--attempt", "attemptId"], ["--operation", "operationId"], ["--correlation", "correlationId"], ["--since", "since"], ["--until", "until"], ["--error", "errorCode"], ["--provider", "provider"], ["--model", "model"], ["--severity", "severity"], ["--component", "component"], ["--stage", "stage"], ["--limit", "limit"]]) {
    const v = arg(flag, null);
    if (v !== null) f[key] = v;
  }
  return f;
}

const cmd = process.argv[2];
const projectId = arg("--project", null);
if (!cmd || !projectId) {
  console.error("usage: telemetry.js list|trace|errors|costs|evidence-get --project <pid> [filters]");
  process.exit(2);
}

try {
  if (cmd === "list") {
    out(tel.listEvents(ROOT, projectId, filters()));
  } else if (cmd === "trace") {
    out(tel.getTrace(ROOT, projectId, arg("--correlation", "")));
  } else if (cmd === "errors") {
    out(tel.errorSummary(ROOT, projectId, filters()));
  } else if (cmd === "costs") {
    out(tel.costSummary(ROOT, projectId, filters()));
  } else if (cmd === "evidence-get") {
    out(tel.getEvidence(ROOT, projectId, arg("--id", "")));
  } else {
    console.error(`unknown command ${cmd}`);
    process.exit(2);
  }
} catch (e) {
  console.error(`FATAL: ${(e && e.stack) || e}`);
  process.exit(1);
}
