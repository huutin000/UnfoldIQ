"use strict";

/**
 * Phase 4B §52–§55 — Pilot E2E trace correlation + time/cost/human baselines.
 *
 * Reuses lib/telemetry (no second trace system): pilot events correlate by
 * projectId/runId/jobId/correlationId/artifact IDs. Baselines feed Phase 5.
 */

const crypto = require("crypto");

function sha12(v) {
  return crypto.createHash("sha256").update(JSON.stringify(v), "utf8").digest("hex").slice(0, 12);
}

/**
 * Record the pilot run correlation. telemetryRoot resolution is the caller's
 * job (telemetry API owns paths); this helper builds the correlation record.
 */
function buildPilotCorrelation({ projectId, runId, jobId, correlationId, artifactIds = {} }) {
  return {
    correlationId: correlationId || `corr-${sha12({ p: projectId, r: runId, j: jobId })}`,
    projectId,
    runId,
    jobId,
    artifactIds,
    stages: ["core", "agent/job", "extension", "bridge", "providers", "storage", "renderer", "qc", "packaging"],
  };
}

function recordPilotEvents(telemetry, root, projectId, correlation, events = []) {
  const results = [];
  for (const e of events) {
    const r = telemetry.recordEvent(root, projectId, {
      eventName: e.eventName || e.eventClass,
      severity: e.severity || "INFO",
      stage: e.stage || "renderer",
      component: e.component || "pilot-4b",
      jobId: correlation.jobId,
      correlationId: correlation.correlationId,
      runId: correlation.runId,
      attributes: e.attrs || {},
    });
    results.push(r);
  }
  return results;
}

function buildPilotBaseline(input = {}) {
  return {
    version: "1.0.0",
    projectId: input.projectId,
    correlationId: input.correlationId,
    wallClockMs: input.wallClockMs || 0,
    activeComputeMs: input.activeComputeMs || 0,
    providerWaitMs: input.providerWaitMs || 0,
    humanWaitMs: input.humanWaitMs || 0,
    llmUsage: input.llmUsage || { tokens: 0, cost: 0 },
    imageCost: input.imageCost || 0,
    videoCost: input.videoCost || 0,
    ttsCost: input.ttsCost || 0,
    musicCost: input.musicCost || 0,
    renderMs: input.renderMs || 0,
    qcMs: input.qcMs || 0,
    repairCount: input.repairCount || 0,
    rerenderCount: input.rerenderCount || 0,
    failureCount: input.failureCount || 0,
    retries: input.retries || 0,
    renderFps: input.renderFps || null,
    outputBytes: input.outputBytes || 0,
    interventions: input.interventions || [],
    createdAt: new Date().toISOString(),
  };
}

module.exports = { buildPilotCorrelation, recordPilotEvents, buildPilotBaseline };
