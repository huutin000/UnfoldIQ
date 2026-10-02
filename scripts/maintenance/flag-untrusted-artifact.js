"use strict";

/**
 * POST-v1F §11: mark the artifact imported under the pre-fix contract as
 * untrusted for this validation, WITHOUT deleting it or any evidence.
 *
 * The 32x32 file is the signed-in ACCOUNT AVATAR
 * (lh3.googleusercontent.com/ogw/...=s32-c-mo), not a generated result. The
 * job is left exactly as it was — READY is terminal and re-driving it would
 * mean faking a state transition — but it is flagged so nothing downstream can
 * mistake it for the correlated output of the generation.
 *
 * Usage: node scripts/maintenance/flag-untrusted-artifact.js <projectId> <jobId> <reason> <ts>
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const [projectId, jobId, reason, ts] = process.argv.slice(2);
if (!projectId || !jobId || !reason) {
  console.error("usage: node scripts/maintenance/flag-untrusted-artifact.js <projectId> <jobId> <reason> <iso-ts>");
  process.exit(1);
}

const jobFile = path.join(ROOT, "projects", projectId, "flow-jobs", `${jobId}.json`);
const job = JSON.parse(fs.readFileSync(jobFile, "utf8"));

if (job.artifactUntrusted === true) {
  console.log(`ALREADY_FLAGGED: ${jobId}`);
  process.exit(0);
}

const flag = {
  artifactUntrusted: true,
  artifactUntrustedReason: reason,
  artifactUntrustedAt: ts || new Date().toISOString(),
  artifactUntrustedEvidence: "Report/evidence/post-v1f-real-execution/",
  correlatedOutput: false,
  reconciledBy: null,
};
// Evidence is preserved: the original sha/path stay on the job untouched.
const next = { ...job, ...flag, status: job.status };
fs.writeFileSync(jobFile, `${JSON.stringify(next, null, 2)}\n`);

// Mirror the flag into the QA record so the artifact file itself is never
// presented as a passing structural check after the fact.
const qaFile = path.join(ROOT, "projects", projectId, "qa", "structural-qa.json");
if (fs.existsSync(qaFile)) {
  const qa = JSON.parse(fs.readFileSync(qaFile, "utf8"));
  const superseded = {
    ...qa,
    status: "SUPERSEDED",
    resultBelongsToCurrentAttempt: false,
    reason: flag.artifactUntrustedReason,
    supersededAt: flag.artifactUntrustedAt,
  };
  const stamped = path.join(ROOT, "Report", "evidence", "post-v1f-real-execution", `${flag.artifactUntrustedAt.replace(/[:.]/g, "-")}-superseded-structural-qa.json`);
  fs.mkdirSync(path.dirname(stamped), { recursive: true });
  fs.writeFileSync(stamped, `${JSON.stringify(qa, null, 2)}\n`);
  fs.writeFileSync(qaFile, `${JSON.stringify(superseded, null, 2)}\n`);
  console.log(`QA_SUPERSEDED: ${qaFile} (original copied to ${path.relative(ROOT, stamped)})`);
}

console.log(`FLAGGED: ${jobId} status=${next.status} artifact=${next.deliveredArtifact} correlatedOutput=false`);
