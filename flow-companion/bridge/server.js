"use strict";

/**
 * Flow Companion local bridge server (STEP 10B).
 * Loopback-only, token-gated, narrow API:
 *   GET  /health
 *   GET  /capabilities
 *   POST /jobs
 *   GET  /jobs/:jobId
 *   POST /jobs/:jobId/approve
 *   POST /jobs/:jobId/cancel
 *   POST /jobs/:jobId/result
 * Never exposed: /exec, /shell, /write-anywhere.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { assertLoopbackBind, validateOrigin, tokenMatches, findSecrets, stripSecrets } = require("./security");
const instructionSync = require("./instruction-sync");
const agentInstructions = require("../../lib/agent-instructions/index.js");
const { resolveProjectPath, sanitizeFilename } = require("./path-policy");
const store = require("./job-store");
const jobContract = require("../extension/src/contracts/job-contract.js");
const { checkGeneratedImage, checkCorrelation } = require("./media-quality");

const ALLOWED_ROUTES = ["GET /health", "GET /capabilities", "POST /jobs", "GET /jobs/:jobId", "POST /jobs/:jobId/await-approval", "POST /jobs/:jobId/approve", "POST /jobs/:jobId/submit-issued", "POST /jobs/:jobId/generate", "POST /jobs/:jobId/cancel", "POST /jobs/:jobId/result", "POST /jobs/:jobId/result-candidates", "POST /jobs/:jobId/artifact", "POST /instruction/apply", "POST /instruction/evidence"];

// POST-v1B live-run completion: narrow artifact-receive endpoint.
// The extension content script fetches the generated media in-page context
// (same-origin/blob readable there), posts bytes here; the bridge confines,
// validates, QA-checks, and imports — no manual file handling by the user.
// Guards: token (outer), job+project match, live state (GENERATING /
// RESULT_DETECTED / DOWNLOADING only), MIME allowlist + extension match +
// magic-byte sniff, 60MB cap, sanitized filename, project-confined paths.
const ARTIFACT_MIME_ALLOWLIST = new Set(["image/png", "image/jpeg", "image/webp", "video/mp4", "video/webm"]);
const ARTIFACT_MAX_BYTES = 60 * 1024 * 1024;

function sniffArtifactKind(buf, mime) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  const isWebp = buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
  const isMp4 = buf.subarray(4, 8).toString("ascii") === "ftyp";
  const isWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
  if (mime === "image/png" && isPng) return "image";
  if (mime === "image/jpeg" && isJpeg) return "image";
  if (mime === "image/webp" && isWebp) return "image";
  if (mime === "video/mp4" && isMp4) return "video";
  if (mime === "video/webm" && isWebm) return "video";
  return null;
}

const DEFAULT_BODY_MAX_BYTES = 256 * 1024;
// Artifact bodies carry base64 (4/3 overhead) of media up to ARTIFACT_MAX_BYTES.
const ARTIFACT_BODY_MAX_BYTES = ARTIFACT_MAX_BYTES * 4 / 3 + 1024 * 1024;

function readBody(req, { maxBytes = DEFAULT_BODY_MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    // Buffer chunks and concat once: string += coerces Buffers via UTF-8 and
    // corrupts multi-byte characters split across chunk boundaries.
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) {
        done = true;
        req.removeAllListeners("data");
        req.removeAllListeners("end");
        // Drain the remaining request body so the socket can deliver the 400
        // response instead of being destroyed mid-upload (client hang-up).
        req.resume();
        reject(new Error("PAYLOAD_TOO_LARGE"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      if (chunks.length === 0) return resolve({});
      const data = Buffer.concat(chunks).toString("utf8");
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("SCHEMA_INVALID: body must be JSON"));
      }
    });
    req.on("error", reject);
  });
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function requireFields(obj, fields) {
  for (const f of fields) {
    if (obj[f] === undefined) throw new Error(`SCHEMA_INVALID: missing field ${f}`);
  }
}

function createBridgeServer({ projectRoot, token, host = "127.0.0.1", allowedOrigins } = {}) {
  const bindHost = assertLoopbackBind(host);
  if (!token) throw new Error("BRIDGE_TOKEN_REQUIRED");

  const server = http.createServer(async (req, res) => {
    try {
      const origin = req.headers.origin || "";
      if (origin && !validateOrigin(origin, allowedOrigins)) {
        return send(res, 403, { error: "ORIGIN_REJECTED" });
      }
      if (!tokenMatches(String(req.headers["x-bridge-token"] || ""), token)) {
        return send(res, 401, { error: "TOKEN_REJECTED" });
      }
      const url = new URL(req.url, "http://127.0.0.1");
      const parts = url.pathname.split("/").filter(Boolean);

      if (req.method === "GET" && parts.length === 1 && parts[0] === "health") {
        return send(res, 200, { ok: true, routes: ALLOWED_ROUTES });
      }
      if (req.method === "GET" && parts.length === 1 && parts[0] === "capabilities") {
        return send(res, 200, { capabilities: ["image", "video"], modes: ["ASSISTED_APPROVAL", "MANUAL_ASSIST"], liveGeneration: false });
      }
      if (req.method === "POST" && parts.length === 1 && parts[0] === "jobs") {
        const raw = await readBody(req);
        const secretHits = findSecrets(raw);
        if (secretHits.length > 0) return send(res, 400, { error: "CREDENTIAL_PAYLOAD_REJECTED", fields: secretHits });
        const body = stripSecrets(raw);
        requireFields(body, ["projectId", "job"]);
        // Harden: validate the persisted job against the canonical contract
        // before any state exists (late failures at import time are too late).
        jobContract.checkJobShape({ status: "PENDING", attempt: 1, ...body.job });
        const job = store.createJob(projectRoot, body.job);
        return send(res, 201, { jobId: job.jobId, status: job.status });
      }
      // Jobs sub-routes + FIX 02 instruction routes (shared projectId-query
      // gate; instruction handlers match parts[1] explicitly below).
      if (parts.length >= 2 && (parts[0] === "jobs" || parts[0] === "instruction")) {
        const jobId = parts[1];
        const projectId = url.searchParams.get("projectId");
        if (!projectId) return send(res, 400, { error: "SCHEMA_INVALID: projectId query required" });
        if (req.method === "GET" && parts.length === 2) {
          const job = store.getJob(projectRoot, projectId, jobId);
          if (!job) return send(res, 404, { error: "JOB_NOT_FOUND" });
          return send(res, 200, { job: stripSecrets(job) });
        }
        // POST-v1E: explicit preparation gate. The extension calls this after
        // GENERATION_READY is verified live (zero-credit). Moves PREPARED →
        // AWAITING_USER_APPROVAL; already-awaiting is idempotent. Never
        // consumes approval and never touches Generate.
        if (req.method === "POST" && parts.length === 3 && parts[2] === "await-approval") {
          stripSecrets(await readBody(req));
          let job = store.getJob(projectRoot, projectId, jobId);
          if (!job) return send(res, 404, { error: "JOB_NOT_FOUND" });
          if (job.projectId !== projectId) return send(res, 400, { error: "JOB_PROJECT_MISMATCH" });
          if (job.status === "AWAITING_USER_APPROVAL") return send(res, 200, { jobId, status: job.status });
          job = store.transitionJob(projectRoot, projectId, jobId, "AWAITING_USER_APPROVAL", { actor: "extension" });
          return send(res, 200, { jobId, status: job.status });
        }
        // POST-v1F: approval is RECORDED but does NOT start the generation.
        // Clicking Start proves nothing (the click can be absorbed by an
        // overlay), so the job must not sit in GENERATING until Google Flow has
        // positively accepted the request. AWAITING_USER_APPROVAL is the
        // canonical "approved, not yet generating" state; /generate moves on
        // and the state machine still enforces a fresh unused approval.
        if (req.method === "POST" && parts.length === 3 && parts[2] === "approve") {
          const body = stripSecrets(await readBody(req));
          const existing = store.getJob(projectRoot, projectId, jobId);
          if (!existing) return send(res, 404, { error: "JOB_NOT_FOUND" });
          if (existing.projectId !== projectId) return send(res, 400, { error: "JOB_PROJECT_MISMATCH" });
          if (existing.status !== "AWAITING_USER_APPROVAL") return send(res, 400, { error: `APPROVAL_STATE_REJECTED: job is ${existing.status}` });
          // Approval binding: when the extension sends the frozen snapshot's
          // nonce, the fingerprint must ride with it (settings-tuple binding).
          if (body.nonce !== undefined && body.nonce !== null && !body.fingerprint) {
            return send(res, 400, { error: "APPROVAL_FINGERPRINT_REQUIRED: nonce without fingerprint" });
          }
          const job = store.recordApproval(projectRoot, projectId, jobId, { ...body, jobId });
          return send(res, 200, { jobId, status: job.status, approvalRecorded: true, approvalNonce: job.approval.nonce || null });
        }
        // Hardening sweep (C-2/C-3): durable "submit issued" record. Called by
        // the extension right before it relays SUBMIT_GENERATE. Idempotent for
        // the same approval nonce; a DIFFERENT nonce while a submit is
        // unresolved is rejected — a second credit action must never be armed
        // while the first one's outcome is unknown.
        if (req.method === "POST" && parts.length === 3 && parts[2] === "submit-issued") {
          const body = stripSecrets(await readBody(req));
          const existing = store.getJob(projectRoot, projectId, jobId);
          if (!existing) return send(res, 404, { error: "JOB_NOT_FOUND" });
          if (existing.projectId !== projectId) return send(res, 400, { error: "JOB_PROJECT_MISMATCH" });
          requireFields(body, ["approvalNonce"]);
          if (!["AWAITING_USER_APPROVAL", "AWAITING_PROVIDER_ACCEPTANCE"].includes(existing.status)) {
            return send(res, 400, { error: `SUBMIT_STATE_REJECTED: job is ${existing.status}` });
          }
          if (existing.approval && existing.approval.nonce && existing.approval.nonce !== body.approvalNonce) {
            return send(res, 400, { error: "APPROVAL_NONCE_MISMATCH: submit must carry the recorded approval nonce" });
          }
          const job = await store.markSubmitIssued(projectRoot, projectId, jobId, body.approvalNonce);
          return send(res, 200, { jobId, status: job.status, submitIssuedAt: job.submitIssuedAt || null });
        }
        // POST-v1F: the real generation starts HERE, after browser-side proof
        // that Flow accepted the submit.
        if (req.method === "POST" && parts.length === 3 && parts[2] === "generate") {
          const body = stripSecrets(await readBody(req));
          let job = store.getJob(projectRoot, projectId, jobId);
          if (!job) return send(res, 404, { error: "JOB_NOT_FOUND" });
          if (job.projectId !== projectId) return send(res, 400, { error: "JOB_PROJECT_MISMATCH" });
          if (job.status === "GENERATING") return send(res, 200, { jobId, status: job.status });
          // Approval→submit binding: when the recorded approval carries a
          // nonce, the submit claiming acceptance must be the same one.
          if (job.approval && job.approval.nonce && body.approvalNonce !== job.approval.nonce) {
            return send(res, 400, { error: "APPROVAL_NONCE_MISMATCH: acceptance evidence does not match the recorded approval" });
          }
          job = store.transitionJob(projectRoot, projectId, jobId, "GENERATING", { actor: "extension" });
          return send(res, 200, { jobId, status: job.status, generationCount: job.generationCount });
        }
        // FIX 02 §15: instruction-apply intent registration. This route NEVER
        // touches the browser tab (the bridge cannot reach it) — it validates
        // schema + forbidden payload + local binding, loads the canonical set
        // from disk (single text owner), and opens a sync record. The
        // extension content command performs VERIFY_PROJECT + the actual apply.
        if (req.method === "POST" && parts.length === 2 && parts[0] === "instruction" && parts[1] === "apply") {
          const raw = await readBody(req);
          const secretHits = findSecrets(raw);
          if (secretHits.length > 0) return send(res, 400, { error: "CREDENTIAL_PAYLOAD_REJECTED", fields: secretHits });
          const body = stripSecrets(raw);
          const check = instructionSync.validateApplyPayload({ ...body, projectId });
          if (!check.ok) return send(res, 400, { error: check.blockers[0], blockers: check.blockers });
          const setRes = body.instructionVersion
            ? agentInstructions.loadInstructionSet(projectRoot, projectId, body.instructionVersion)
            : agentInstructions.loadLatestInstructionSet(projectRoot, projectId);
          if (!setRes.ok) return send(res, 500, { error: `INSTRUCTION_SET_LOAD_FAILED: ${setRes.code}` });
          if (!setRes.set) return send(res, 404, { error: "INSTRUCTION_SET_NOT_FOUND" });
          const set = setRes.set;
          let bindingState = "UNBOUND_FIRST_RUN";
          try {
            const b = agentInstructions.loadProjectBinding(projectRoot, projectId);
            if (b.ok && b.binding) {
              if (b.binding.providerProjectRef !== body.providerProjectRef) {
                return send(res, 400, { error: "BLOCKED_PROJECT_MISMATCH: local binding refuses this provider ref" });
              }
              bindingState = "BOUND";
            }
          } catch {
            bindingState = "UNBOUND_FIRST_RUN";
          }
          // FIX 03 §19: lineage pointer — operator may pass the superseded
          // sync id; otherwise the newest VERIFIED record for this project
          // becomes previousSyncRef automatically (never invented).
          let previousSyncRef = null;
          if (typeof body.previousSyncRef === "string" && /^sy-[0-9a-f]{12}$/.test(body.previousSyncRef)) {
            previousSyncRef = body.previousSyncRef;
          } else {
            const prior = agentInstructions.latestVerifiedSync(projectRoot, projectId);
            if (prior.ok && prior.sync && prior.sync.syncId) previousSyncRef = prior.sync.syncId;
          }
          const started = agentInstructions.startInstructionSync(
            projectRoot,
            projectId,
            set,
            { name: "GOOGLE_FLOW", projectRef: body.providerProjectRef },
            { automationMode: "HANDS_FREE", previousSyncRef }
          );
          if (!started.ok) return send(res, 500, { error: `SYNC_START_FAILED: ${started.code}` });
          return send(res, 201, {
            applyAttemptId: started.sync.syncId,
            syncId: started.sync.syncId,
            syncStatus: started.sync.syncStatus,
            instructionSetId: set.instructionSetId,
            instructionVersion: set.instructionVersion,
            desiredFingerprint: set.compiledFingerprint,
            compiledText: set.compiledText,
            referenceBindings: set.referenceBindings || [],
            bindingState,
            previousSyncRef,
          });
        }
        // FIX 02 §§16–19: instruction evidence intake. Records apply/readback
        // evidence, runs the canonical semantic compare against the canonical
        // set from disk, and transitions the sync record (APPLIED →
        // READBACK_PENDING → VERIFIED/DRIFT). No secrets persistable.
        if (req.method === "POST" && parts.length === 2 && parts[0] === "instruction" && parts[1] === "evidence") {
          const raw = await readBody(req);
          const secretHits = findSecrets(raw);
          if (secretHits.length > 0) return send(res, 400, { error: "CREDENTIAL_PAYLOAD_REJECTED", fields: secretHits });
          const body = stripSecrets(raw);
          requireFields(body, ["syncId"]);
          const evCheck = instructionSync.validateSyncEvidence({ ...(body.applyResult || {}), ...(body.readback || {}) });
          if (!evCheck.ok) return send(res, 400, { error: "FORBIDDEN_SYNC_EVIDENCE", blockers: evCheck.blockers });
          const syncRes = agentInstructions.loadSync(projectRoot, projectId, body.syncId);
          if (!syncRes.ok) return send(res, 500, { error: `SYNC_LOAD_FAILED: ${syncRes.code}` });
          if (!syncRes.sync) return send(res, 404, { error: "SYNC_NOT_FOUND" });
          let sync = syncRes.sync;
          if (body.applyResult) {
            const r = agentInstructions.recordSyncEvidence(projectRoot, projectId, sync.syncId, {
              applyAttemptId: body.applyResult.applyAttemptId || sync.syncId,
              applyStatus: body.applyResult.status || "APPLIED",
              appliedAt: body.applyResult.appliedAt || new Date().toISOString(),
              // FIX 03 §19–20: non-secret hands-free metadata (transport
              // class only — never debugger ids, cookies, tokens, profiles).
              automationMode: body.applyResult.automationMode === "HANDS_FREE" ? "HANDS_FREE" : "OPERATOR_ASSISTED",
              writeTransport: typeof body.applyResult.writeTransport === "string" ? body.applyResult.writeTransport : null,
              operatorTextEntry: body.applyResult.operatorTextEntry !== true ? false : true,
            });
            if (!r.ok) return send(res, 500, { error: `SYNC_UPDATE_FAILED: ${r.code}` });
            sync = r.sync;
          }
          if (body.readback) {
            const setRes = agentInstructions.loadInstructionSet(projectRoot, projectId, sync.instructionVersion);
            if (!setRes.ok || !setRes.set) return send(res, 404, { error: "INSTRUCTION_SET_NOT_FOUND" });
            const rb = body.readback;
            const compare = agentInstructions.compareInstructionReadback(
              { compiledText: setRes.set.compiledText, referenceIds: setRes.set.referenceIds || [] },
              { text: rb.visibleGuidelines || rb.text || "", referenceIds: rb.providerReferences || rb.referenceIds || [] }
            );
            const r = agentInstructions.recordSyncEvidence(projectRoot, projectId, sync.syncId, {
              readbackStatus: (rb.visibleGuidelines || rb.text) ? "RECEIVED" : "MISSING",
              readbackFingerprint: compare.fingerprint,
              readbackAt: rb.readbackAt || new Date().toISOString(),
              semanticCompareStatus: compare.status,
              differences: compare.differences || [],
            });
            if (!r.ok) return send(res, 500, { error: `SYNC_UPDATE_FAILED: ${r.code}` });
            sync = r.sync;
          }
          const next = instructionSync.transitionSync(sync, {
            applyStatus: sync.applyStatus,
            readback: body.readback
              ? { available: !!((body.readback.visibleGuidelines || body.readback.text) || "").trim(), referenceIds: body.readback.providerReferences || body.readback.referenceIds || [] }
              : (sync.readbackFingerprint ? { available: true, referenceIds: [] } : undefined),
            compare: sync.semanticCompareStatus && sync.semanticCompareStatus !== "PENDING"
              ? { status: sync.semanticCompareStatus, differences: sync.differences || [] }
              : undefined,
          });
          const fin = agentInstructions.recordSyncEvidence(projectRoot, projectId, sync.syncId, { syncStatus: next.syncStatus });
          if (!fin.ok) return send(res, 500, { error: `SYNC_UPDATE_FAILED: ${fin.code}` });
          return send(res, 200, {
            syncId: fin.sync.syncId,
            syncStatus: fin.sync.syncStatus,
            applyStatus: fin.sync.applyStatus,
            readbackStatus: fin.sync.readbackStatus,
            semanticCompareStatus: fin.sync.semanticCompareStatus,
            differences: fin.sync.differences || [],
            verifiedAt: fin.sync.verifiedAt,
          });
        }
        if (req.method === "POST" && parts.length === 3 && parts[2] === "cancel") {
          const next = store.transitionJob(projectRoot, projectId, jobId, "CANCELLED", { actor: "user" });
          return send(res, 200, { jobId, status: next.status });
        }
        if (req.method === "POST" && parts.length === 3 && parts[2] === "result") {
          const body = stripSecrets(await readBody(req));
          requireFields(body, ["artifactRelativePath"]);
          resolveProjectPath(projectRoot, projectId, body.artifactRelativePath);
          let job = store.getJob(projectRoot, projectId, jobId);
          if (!job) return send(res, 404, { error: "JOB_NOT_FOUND" });
          if (job.projectId !== projectId) return send(res, 400, { error: "JOB_PROJECT_MISMATCH" });
          job.deliveredArtifact = body.artifactRelativePath;
          const { transitionJob } = store;
          if (job.status === "GENERATING") job = transitionJob(projectRoot, projectId, jobId, "RESULT_DETECTED", { actor: "bridge" });
          return send(res, 200, { jobId, status: job.status });
        }
        // POST-v1F §5: persist the EXACT candidate set the moment
        // RESULT_DETECTED is observed, so correlation survives extension
        // reload, browser refresh, bridge restart and resume. Resume must never
        // re-derive candidates from whatever happens to be on the page.
        if (req.method === "POST" && parts.length === 3 && parts[2] === "result-candidates") {
          const body = stripSecrets(await readBody(req));
          requireFields(body, ["candidates"]);
          if (!Array.isArray(body.candidates)) return send(res, 400, { error: "RESULT_CANDIDATES_INVALID: candidates must be an array" });
          let job = store.getJob(projectRoot, projectId, jobId);
          if (!job) return send(res, 404, { error: "JOB_NOT_FOUND" });
          if (job.projectId !== projectId) return send(res, 400, { error: "JOB_PROJECT_MISMATCH" });
          const detectedAt = body.detectedAt || new Date().toISOString();
          const candidates = body.candidates.map((c, i) => ({
            candidateId: String(c && c.candidateId != null ? c.candidateId : `c${i + 1}`),
            url: String((c && c.url) || ""),
            assetId: (c && c.assetId) || null,
            mediaType: String((c && c.mediaType) || "UNKNOWN").toUpperCase(),
            naturalWidth: Number(c && c.naturalWidth) || null,
            naturalHeight: Number(c && c.naturalHeight) || null,
            isNew: !!(c && c.isNew),
            sameAgentTurn: !!(c && c.sameAgentTurn),
            container: (c && c.container) || null,
            alt: (c && c.alt) || null,
            srcset: (c && c.srcset) || null,
            detectedAt,
          }));
          job = store.updateJob(projectRoot, projectId, jobId, {
            resultCandidates: candidates,
            detectedAt,
            submitAcceptedAt: body.submitAcceptedAt || job.submitAcceptedAt || null,
          });
          if (job.status === "GENERATING") job = store.transitionJob(projectRoot, projectId, jobId, "RESULT_DETECTED", { actor: "extension" });
          return send(res, 200, { jobId, status: job.status, detectedAt, persisted: candidates.length });
        }
        if (req.method === "POST" && parts.length === 3 && parts[2] === "artifact") {
          const body = stripSecrets(await readBody(req, { maxBytes: ARTIFACT_BODY_MAX_BYTES }));
          requireFields(body, ["filename", "mime", "contentBase64"]);
          let job = store.getJob(projectRoot, projectId, jobId);
          if (!job) return send(res, 404, { error: "JOB_NOT_FOUND" });
          if (job.projectId !== projectId) return send(res, 400, { error: "JOB_PROJECT_MISMATCH" });
          // POST-v1F: MANUAL_ASSIST_REQUIRED is the canonical credit-free
          // reconciliation route (PREPARED → MANUAL_ASSIST_REQUIRED →
          // IMPORTED → READY): an already-generated result supplied outside the
          // automated submit path. It still has to clear the correlation gate.
          if (!["GENERATING", "RESULT_DETECTED", "DOWNLOADING", "MANUAL_ASSIST_REQUIRED"].includes(job.status)) {
            return send(res, 400, { error: `ARTIFACT_STATE_REJECTED: job is ${job.status}, needs GENERATING/RESULT_DETECTED/DOWNLOADING/MANUAL_ASSIST_REQUIRED` });
          }
          const mime = String(body.mime).toLowerCase();
          if (!ARTIFACT_MIME_ALLOWLIST.has(mime)) return send(res, 400, { error: `ARTIFACT_MIME_REJECTED: ${body.mime}` });
          let bytes;
          try {
            bytes = Buffer.from(String(body.contentBase64), "base64");
          } catch {
            return send(res, 400, { error: "ARTIFACT_DECODE_FAILED" });
          }
          if (bytes.length === 0 || bytes.length > ARTIFACT_MAX_BYTES) {
            return send(res, 400, { error: `ARTIFACT_SIZE_REJECTED: ${bytes.length} bytes` });
          }
          const kind = sniffArtifactKind(bytes, mime);
          if (!kind) return send(res, 400, { error: "ARTIFACT_MAGIC_MISMATCH: bytes do not match declared MIME" });
          if (kind !== job.capability) {
            return send(res, 400, { error: `ARTIFACT_CAPABILITY_MISMATCH: ${kind} bytes for ${job.capability} job` });
          }
          // POST-v1F §4/§6/§10: the artifact must be attributable to a
          // candidate persisted at RESULT_DETECTED. Without that record the
          // only alternative would be adopting whatever is currently visible.
          const persisted = Array.isArray(job.resultCandidates) ? job.resultCandidates : [];
          if (persisted.length === 0) {
            return send(res, 400, { error: "RESULT_CORRELATION_REQUIRED: no candidates were persisted at RESULT_DETECTED" });
          }
          const candidate = persisted.find((c) => c.candidateId === String(body.candidateId)) || null;          const correlation = checkCorrelation(candidate);
          if (!correlation.ok) return send(res, 400, { error: correlation.reason });
          // POST-v1F §7/§9: full-resolution selection + quality policy are
          // enforced against the candidate as measured at detection time.
          if (kind === "image") {
            const declared = checkGeneratedImage(
              { width: candidate.naturalWidth, height: candidate.naturalHeight },
              { expectedAspectRatio: body.expectedAspectRatio ?? job.expectedAspectRatio ?? null }
            );
            if (!declared.ok) return send(res, 400, { error: `RESULT_CANDIDATE_REJECTED: ${declared.reason}` });
          }
          const safeName = sanitizeFilename(`${jobId}-${body.filename}`);
          const stagedRel = `downloads/${safeName}`;
          const staged = resolveProjectPath(projectRoot, projectId, stagedRel);
          fs.mkdirSync(path.dirname(staged.abs), { recursive: true });
          const tmp = `${staged.abs}.${process.pid}.tmp`;
          fs.writeFileSync(tmp, bytes);
          fs.renameSync(tmp, staged.abs);
          const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
          if (job.status === "GENERATING") job = store.transitionJob(projectRoot, projectId, jobId, "RESULT_DETECTED", { actor: "extension" });
          if (job.status === "RESULT_DETECTED") job = store.transitionJob(projectRoot, projectId, jobId, "DOWNLOADING", { actor: "extension" });
          const { importResult } = require("./importer");
          const imported = importResult({
            projectRoot,
            job: store.getJob(projectRoot, projectId, jobId),
            sourceAbsPath: staged.abs,
            fingerprint: body.promptFingerprint ? { sha256: body.promptFingerprint, downloadId: body.downloadId ?? null } : null,
          });
          const artifactPath = imported.artifactPath;
          store.updateJob(projectRoot, projectId, jobId, {
            deliveredArtifact: artifactPath,
            stagedDownload: stagedRel,
            artifactSha256: sha256,
            artifactBytes: bytes.length,
            artifactMime: mime,
            downloadId: body.downloadId ?? null,
          });
          // POST-v1E §36 + POST-v1F §9/§10: structural QA is EVIDENCE, not a
          // rubber stamp, and READY is gated on it. A decodable 32x32 avatar
          // decodes fine and is still not a generated asset.
          const qaMeta = (imported.result && imported.result.metadata) || {};
          const measured = kind === "image"
            ? checkGeneratedImage(
                { width: qaMeta.width ?? candidate.naturalWidth, height: qaMeta.height ?? candidate.naturalHeight },
                { expectedAspectRatio: body.expectedAspectRatio ?? job.expectedAspectRatio ?? null }
              )
            : { ok: true, reason: null };
          const qaRecord = {
            status: measured.ok ? "PASS" : "FAIL",
            reason: measured.reason,
            jobId,
            attempt: job.attempt,
            artifactPath,
            sha256,
            bytes: bytes.length,
            mime,
            width: qaMeta.width ?? candidate.naturalWidth ?? null,
            height: qaMeta.height ?? candidate.naturalHeight ?? null,
            candidateId: candidate.candidateId,
            resultBelongsToCurrentAttempt: correlation.resultBelongsToCurrentAttempt,
            correlationSignals: correlation.signals,
            downloadId: body.downloadId ?? null,
            promptFingerprint: body.promptFingerprint ?? null,
            checkedAt: new Date().toISOString(),
          };
          const qaFile = resolveProjectPath(projectRoot, projectId, "qa/structural-qa.json");
          fs.mkdirSync(path.dirname(qaFile.abs), { recursive: true });
          const qaTmp = `${qaFile.abs}.${process.pid}.tmp`;
          fs.writeFileSync(qaTmp, JSON.stringify(qaRecord, null, 2));
          fs.renameSync(qaTmp, qaFile.abs);
          if (!measured.ok) {
            store.updateJob(projectRoot, projectId, jobId, { structuralQaStatus: "FAIL", structuralQaReason: measured.reason });
            return send(res, 400, { error: measured.reason, qa: qaRecord });
          }
          job = store.transitionJob(projectRoot, projectId, jobId, "IMPORTED", { actor: "extension" });
          job = store.transitionJob(projectRoot, projectId, jobId, "READY", { actor: "extension" });
          return send(res, 200, { jobId, status: job.status, artifactPath, sha256, bytes: bytes.length, mime });
        }
      }
      return send(res, 404, { error: "UNKNOWN_ROUTE" });
    } catch (e) {
      const code = /NOT_FOUND/.test(e.message) ? 404 : /REJECTED|INVALID|MISMATCH|DUPLICATE|TRAVERSAL|BLOCKED|ABSOLUTE|EMPTY_PATH|PAYLOAD_TOO_LARGE/.test(e.message) ? 400 : 500;
      return send(res, code, { error: e.message });
    }
  });

  return {
    server,
    listen: (port = 0) => new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, bindHost, () => resolve(server.address()));
    }),
    close: () => new Promise((resolve) => server.close(resolve)),
    host: bindHost,
  };
}

module.exports = { createBridgeServer, ALLOWED_ROUTES };
