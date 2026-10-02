"use strict";

/**
 * UNFOLDIQ deep-attempt provenance (PHASE 1G.1 Prompt 05, §63-65).
 * Minimal structured state under research/deep-attempts/<attempt-id>.json.
 * No parallel evidence tree. Secret config values never recorded.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { stableStringify, redactSecrets } = require("./provider-interface.js");

const ATTEMPTS_REL = "research/deep-attempts";

function hashOf(value) {
  return crypto.createHash("sha256").update(stableStringify(value), "utf8").digest("hex").slice(0, 16);
}

function newAttemptId() {
  return `deep-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;
}

function buildAttemptRecord(input = {}) {
  const attemptId = input.attemptId || newAttemptId();
  return {
    attemptId,
    providerId: input.providerId || "gpt-researcher",
    providerVersion: input.providerVersion || null,
    adapterVersion: "1.0.0",
    requestHash: input.request ? hashOf(redactSecrets(input.request)) : null,
    researchPlanHash: input.plan ? hashOf({ topic: input.plan.topic, goal: input.plan.researchGoal, questions: input.plan.criticalQuestions }) : null,
    gapHash: input.gaps ? hashOf(input.gaps) : null,
    configHash: input.config ? hashOf(input.config) : null,
    escalation: input.escalation || null,
    startedAt: input.startedAt || new Date().toISOString(),
    completedAt: input.completedAt || null,
    status: input.status || "UNKNOWN",
    candidateUrlCount: input.candidateUrlCount ?? 0,
    reacquiredUrlCount: input.reacquiredUrlCount ?? 0,
    sufficiencyBefore: input.sufficiencyBefore || null,
    sufficiencyAfter: input.sufficiencyAfter || null,
    warnings: Array.isArray(input.warnings) ? input.warnings.slice(0, 20) : [],
    errors: Array.isArray(input.errors) ? input.errors.slice(0, 20) : [],
  };
}

function attemptFilePath(projectDir, attemptId) {
  return path.join(projectDir, ATTEMPTS_REL, `${attemptId}.json`);
}

function saveAttempt(projectDir, record) {
  const filePath = attemptFilePath(projectDir, record.attemptId);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, filePath);
  return { saved: true, path: filePath };
}

module.exports = {
  ATTEMPTS_REL,
  hashOf,
  newAttemptId,
  buildAttemptRecord,
  attemptFilePath,
  saveAttempt,
};
