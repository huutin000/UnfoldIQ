"use strict";
// qa/visual-qa.js — STEP-13 Branch C.
// Machine review-packet builder + agent/human review submission.
// buildReviewPacket assembles attempt-XXX/qa/visual-review-packet.json with
// sampled frames, scene/time mapping, machine technical issues and a PENDING
// review checklist. It NEVER marks AGENT_REVIEWED and NEVER claims semantic
// understanding (no aesthetic PASS). submitReview validates the submitted
// verdict against schemas/visual-review.schema.json, checks attemptId match,
// persists qa/visual-review.json and derives the review state from reviewer.

var fs = require("fs");
var path = require("path");

var PACKET_VERSION = "1.0.0";
var REVIEW_STATES = ["MACHINE_CHECKED", "AGENT_REVIEWED", "HUMAN_REVIEWED", "NOT_REVIEWED"];

var CHECKLIST = [
  "caption-readability",
  "safe-zone",
  "text-clipping",
  "continuity-spot",
  "black-silence-regions"
];

function nowIso() {
  return new Date().toISOString();
}

function attemptQaDir(projectRoot, projectId, attemptId) {
  return path.join(projectRoot, "projects", projectId, "render", "attempts", attemptId, "qa");
}

function toForward(p) {
  return String(p).split(path.sep).join("/");
}

function buildReviewPacket(args) {
  args = args || {};
  var projectRoot = args.projectRoot;
  var projectId = args.projectId;
  var attempt = args.attempt || {};
  if (!projectRoot || typeof projectRoot !== "string") throw new Error("buildReviewPacket: projectRoot required");
  if (!projectId || typeof projectId !== "string") throw new Error("buildReviewPacket: projectId required");
  var attemptId = attempt.attemptId || args.attemptId;
  if (!attemptId || typeof attemptId !== "string") throw new Error("buildReviewPacket: attempt.attemptId required");

  var technicalQa = args.technicalQa || attempt.technicalQa || null;
  var technicalIssues = [];
  if (technicalQa && Array.isArray(technicalQa.checks)) {
    technicalQa.checks.forEach(function (c) {
      if (c && (c.result === "FAIL" || c.result === "REVIEW" || c.result === "UNKNOWN")) {
        technicalIssues.push({ check: String(c.check), result: String(c.result), detail: String(c.detail || "") });
      }
    });
  }
  if (args.blackCheck && args.blackCheck.status && args.blackCheck.status !== "PASS") {
    technicalIssues.push({ check: "black-frames", result: String(args.blackCheck.status),
      detail: String(args.blackCheck.detail || "") });
  }
  if (args.silenceCheck && args.silenceCheck.status && args.silenceCheck.status !== "PASS") {
    technicalIssues.push({ check: "silence", result: String(args.silenceCheck.status),
      detail: String(args.silenceCheck.detail || "") });
  }

  var samples = Array.isArray(args.samples) ? args.samples : [];
  var sampledFrames = samples.map(function (s) {
    s = s || {};
    return {
      timestampMs: s.timestampMs !== undefined ? s.timestampMs : null,
      framePath: typeof s.framePath === "string" ? s.framePath : null,
      label: typeof s.label === "string" ? s.label : null,
      method: typeof s.method === "string" ? s.method : null
    };
  });

  var packet = {
    version: PACKET_VERSION,
    projectId: projectId,
    attemptId: attemptId,
    generatedAt: nowIso(),
    contactSheet: args.contactSheet && args.contactSheet.sheetPath
      ? toForward(args.contactSheet.sheetPath) : null,
    contactSheetCount: args.contactSheet && typeof args.contactSheet.count === "number"
      ? args.contactSheet.count : 0,
    sampledFrames: sampledFrames,
    sceneTimeMapping: args.sceneMap !== undefined && args.sceneMap !== null ? args.sceneMap : [],
    technicalIssues: technicalIssues,
    reviewChecklist: CHECKLIST.map(function (item) { return { item: item, status: "PENDING" }; }),
    reviewState: "MACHINE_CHECKED"
  };

  var dir = attemptQaDir(projectRoot, projectId, attemptId);
  fs.mkdirSync(dir, { recursive: true });
  var packetPath = path.join(dir, "visual-review-packet.json");
  fs.writeFileSync(packetPath, JSON.stringify(packet, null, 2), "utf8");
  return { packetPath: packetPath, packet: packet };
}

function getValidator() {
  var Ajv = require("ajv");
  var addFormats = require("ajv-formats");
  var ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  var schemaPath = path.join(__dirname, "..", "schemas", "visual-review.schema.json");
  var schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  return ajv.compile(schema);
}

function reviewStateFor(reviewer) {
  if (reviewer === "agent") return "AGENT_REVIEWED";
  if (reviewer === "human") return "HUMAN_REVIEWED";
  if (reviewer === "system") return "MACHINE_CHECKED";
  return "NOT_REVIEWED";
}

function submitReview(args) {
  args = args || {};
  var projectRoot = args.projectRoot;
  var projectId = args.projectId;
  var attemptId = args.attemptId;
  var review = args.review;
  if (!projectRoot || typeof projectRoot !== "string") throw new Error("submitReview: projectRoot required");
  if (!projectId || typeof projectId !== "string") throw new Error("submitReview: projectId required");
  if (!attemptId || typeof attemptId !== "string") throw new Error("submitReview: attemptId required");
  if (!review || typeof review !== "object") throw new Error("submitReview: review object required");

  var validate = getValidator();
  var ok = validate(review);
  if (!ok) {
    var err = new Error("REVIEW_SCHEMA_INVALID: " + JSON.stringify(validate.errors));
    err.code = "REVIEW_SCHEMA_INVALID";
    err.errors = validate.errors;
    throw err;
  }
  if (review.attemptId !== attemptId) {
    var merr = new Error("ATTEMPT_MISMATCH: review.attemptId " + review.attemptId + " != " + attemptId);
    merr.code = "ATTEMPT_MISMATCH";
    throw merr;
  }
  if (review.projectId !== projectId) {
    var perr = new Error("PROJECT_MISMATCH: review.projectId " + review.projectId + " != " + projectId);
    perr.code = "PROJECT_MISMATCH";
    throw perr;
  }

  var dir = attemptQaDir(projectRoot, projectId, attemptId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "visual-review.json"), JSON.stringify(review, null, 2), "utf8");

  var reviewState = reviewStateFor(review.reviewer);
  return {
    accepted: review.decision === "APPROVE",
    reviewState: reviewState,
    decision: review.decision,
    attemptId: attemptId
  };
}

module.exports = {
  buildReviewPacket: buildReviewPacket,
  submitReview: submitReview,
  REVIEW_STATES: REVIEW_STATES
};
