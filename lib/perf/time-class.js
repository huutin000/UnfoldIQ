"use strict";
// lib/perf/time-class.js — Phase 7 efficiency: split time into AUTHORING / COMPUTE /
// PROVIDER_WAIT / HUMAN_REVIEW on top of the 5A stage taxonomy (no second trace store)
// and keep MEASURED apart from ESTIMATED so an estimate is never reported as proof.

const { STAGES } = require("./trace");

const TIME_CLASSES = ["AUTHORING", "COMPUTE", "PROVIDER_WAIT", "HUMAN_REVIEW"];
const PROVIDER = new Set(["PROVIDER_SUBMIT", "PROVIDER_WAIT", "PROVIDER_RESULT", "DOWNLOAD", "EXTENSION_WAKE", "EXTENSION_ACTION", "EXTENSION_DOM_SCAN", "RESULT_DETECTION", "QUEUE_WAIT"]);
const AUTHORING = new Set(["CORE_PLAN", "MODEL_CALL", "TOOL_CALL", "RESEARCH"]);

function classify(category) {
  if (TIME_CLASSES.includes(category)) return category; // pseudo-stages recorded by hand
  if (!STAGES.includes(category)) throw new Error("SCHEMA_INVALID: unknown stage " + category);
  if (PROVIDER.has(category)) return "PROVIDER_WAIT";
  if (AUTHORING.has(category)) return "AUTHORING";
  return "COMPUTE";
}

/** entries: [{ category, durationMs, evidence: MEASURED_REAL|ESTIMATED, basis? }] */
function summarize(entries) {
  const out = {};
  for (const c of TIME_CLASSES) out[c] = { measuredMs: 0, estimatedMs: 0, count: 0 };
  for (const e of entries) {
    if (!Number.isFinite(e.durationMs) || e.durationMs < 0) throw new Error("SCHEMA_INVALID: durationMs");
    const bucket = out[classify(e.category)];
    if (e.evidence === "MEASURED_REAL") bucket.measuredMs += e.durationMs;
    else if (e.evidence === "ESTIMATED") {
      if (!e.basis) throw new Error("SCHEMA_INVALID: ESTIMATED entry needs a basis");
      bucket.estimatedMs += e.durationMs;
    } else throw new Error("SCHEMA_INVALID: evidence must be MEASURED_REAL or ESTIMATED");
    bucket.count += 1;
  }
  return out;
}

module.exports = { TIME_CLASSES, classify, summarize };
