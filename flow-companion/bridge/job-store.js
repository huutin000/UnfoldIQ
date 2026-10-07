"use strict";

/**
 * Flow Companion bridge job store (STEP 10B).
 * Persistent (JSON per job + index), restart-safe, duplicate-jobId safe.
 * Root: <projectRoot>/projects/<projectId>/flow-jobs/
 */

const fs = require("fs");
const path = require("path");
const { transition } = require("./state-machine");
const { resolveProjectPath } = require("./path-policy");

function jobsDir(projectRoot, projectId) {
  return path.join(path.resolve(projectRoot), "projects", projectId, "flow-jobs");
}

function ensureJobsDir(projectRoot, projectId) {
  fs.mkdirSync(jobsDir(projectRoot, projectId), { recursive: true });
}

function jobPath(projectRoot, projectId, jobId) {
  return path.join(jobsDir(projectRoot, projectId), `${jobId}.json`);
}

function writeJob(projectRoot, projectId, job) {
  ensureJobsDir(projectRoot, projectId);
  const abs = jobPath(projectRoot, projectId, job.jobId);
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(job, null, 2));
  fs.renameSync(tmp, abs);
  return job;
}

function createJob(projectRoot, project) {
  const { projectId, jobId } = project;
  if (!projectId || !jobId) throw new Error("JOB_IDENTITY_REQUIRED: projectId + jobId");
  ensureJobsDir(projectRoot, projectId);
  if (fs.existsSync(jobPath(projectRoot, projectId, jobId))) {
    throw new Error(`DUPLICATE_JOB_ID: ${jobId}`);
  }
  const job = {
    version: "1.0.0",
    status: "PENDING",
    attempt: 1,
    generationCount: 0,
    history: [{ from: null, to: "PENDING", at: new Date().toISOString(), actor: "system" }],
    ...project,
    status: project.status || "PENDING",
  };
  return writeJob(projectRoot, projectId, job);
}

function getJob(projectRoot, projectId, jobId) {
  const abs = jobPath(projectRoot, projectId, jobId);
  if (!fs.existsSync(abs)) return null;
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function listJobs(projectRoot, projectId) {
  ensureJobsDir(projectRoot, projectId);
  return fs
    .readdirSync(jobsDir(projectRoot, projectId))
    .filter((f) => f.endsWith(".json") && f !== "index.json")
    .map((f) => path.basename(f, ".json"));
}

// Atomicity note (hardening sweep C-4): transitionJob/updateJob/recordApproval
// are read-modify-write cycles, but every step is SYNCHRONOUS fs work with no
// await inside, so on Node's single-threaded event loop two HTTP requests can
// never interleave inside a cycle — each request handler completes its whole
// read-modify-write before yielding. A mutex would add async plumbing without
// changing that guarantee. If a mutator ever becomes async, serialize first.

function transitionJob(projectRoot, projectId, jobId, to, opts = {}) {
  const job = getJob(projectRoot, projectId, jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND: ${jobId}`);
  const next = transition(job, to, opts);
  return writeJob(projectRoot, projectId, next);
}

/** Merge a patch into the persisted job (for refusal/adaptation metadata). */
function updateJob(projectRoot, projectId, jobId, patch) {
  const job = getJob(projectRoot, projectId, jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND: ${jobId}`);
  return writeJob(projectRoot, projectId, { ...job, ...patch });
}

function recordApproval(projectRoot, projectId, jobId, approval) {
  const job = getJob(projectRoot, projectId, jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND: ${jobId}`);
  if (!approval || approval.jobId !== jobId || approval.attempt !== job.attempt) {
    throw new Error("APPROVAL_MISMATCH: approval must match jobId+attempt");
  }
  const existing = job.approval;
  let superseded = false;
  if (existing && !existing.used) {
    // A lost-ACK retry must REUSE the still-unused approval or explicitly
    // supersede it by nonce. Silently re-arming the approval gate is the
    // duplicate-credit-spend path.
    const explicitSupersede =
      approval.supersedesNonce && existing.nonce && approval.supersedesNonce === existing.nonce;
    if (!explicitSupersede) {
      throw new Error(
        "DUPLICATE_APPROVAL: an unused approval is already recorded; reuse it or supersede it by nonce"
      );
    }
    superseded = true;
  }
  job.approval = { ...approval, approvedAt: approval.approvedAt || new Date().toISOString(), used: false };
  job.history.push({
    from: job.status,
    to: job.status,
    at: new Date().toISOString(),
    actor: approval.approvedBy || "user",
    note: superseded ? "approval-superseded" : "approval-recorded",
  });
  return writeJob(projectRoot, projectId, job);
}

/**
 * Durable "submit issued to the provider page" record (credit-spend guard,
 * hardening sweep C-2/C-3). Idempotent for the same submit nonce; a DIFFERENT
 * nonce while a submit is unresolved is rejected — a second submit must never
 * be armed while the first one's outcome is unknown.
 */
function markSubmitIssued(projectRoot, projectId, jobId, submitNonce) {
  const job = getJob(projectRoot, projectId, jobId);
  if (!job) throw new Error(`JOB_NOT_FOUND: ${jobId}`);
  if (job.status === "AWAITING_PROVIDER_ACCEPTANCE") {
    if (job.submitNonce && job.submitNonce !== submitNonce) {
      throw new Error(
        "SUBMIT_ALREADY_ISSUED: an unresolved submit with a different approval is outstanding; duplicate credit action blocked"
      );
    }
    return { ...job }; // idempotent same-nonce re-issue (lost ACK retry)
  }
  const next = transition(job, "AWAITING_PROVIDER_ACCEPTANCE", {
    actor: "extension",
    submitNonce,
  });
  return writeJob(projectRoot, projectId, next);
}

module.exports = {
  jobsDir,
  createJob,
  getJob,
  listJobs,
  transitionJob,
  updateJob,
  recordApproval,
  markSubmitIssued,
  resolveProjectPath,
};
