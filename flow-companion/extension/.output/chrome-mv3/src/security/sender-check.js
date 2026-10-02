"use strict";

/**
 * UNFOLDIQ Flow Companion sender check (STEP 10B).
 * Content scripts never receive arbitrary filesystem commands;
 * only validated job payloads from allowed origins.
 */

const FLOW_ORIGIN_PREFIXES = ["https://labs.google/fx/", "https://flow.google/", "https://flow.google.com/"];

function checkSender(sender) {
  const url = (sender && (sender.url || sender.origin)) || "";
  const allowed = url.startsWith("chrome-extension://") || FLOW_ORIGIN_PREFIXES.some((p) => url.startsWith(p));
  if (!allowed) throw new Error(`SENDER_REJECTED: ${url}`);
  return true;
}

const FORBIDDEN_JOB_FIELDS = ["exec", "shell", "writePath", "command", "cookie", "token", "password"];

function checkJobPayload(job) {
  if (!job || typeof job !== "object") throw new Error("SCHEMA_INVALID: job must be an object");
  for (const f of FORBIDDEN_JOB_FIELDS) {
    if (job[f] !== undefined) throw new Error(`FORBIDDEN_FIELD: ${f}`);
  }
  return true;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { checkSender, checkJobPayload, FORBIDDEN_JOB_FIELDS, FLOW_ORIGIN_PREFIXES };
}
