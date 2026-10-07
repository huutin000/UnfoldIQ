"use strict";

/**
 * FIX PRE-2.4 shared test fixtures (tests/fixtures is NOT a test domain).
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

function makeRoot(projectId = "p1") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fsspre24-"));
  fs.mkdirSync(path.join(root, "projects"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "projects", "registry.json"),
    JSON.stringify({ schemaVersion: "1.0.0", projects: [{ projectId, kind: "ACTIVE", status: "ACTIVE", path: `projects/${projectId}`, manifestRef: null }] }, null, 2),
    "utf8"
  );
  fs.mkdirSync(path.join(root, "projects", projectId), { recursive: true });
  return { root, projectId };
}

/** Source script rich in protected items (numbers, dates, names, quotes, hedges). */
const SOURCE_SEGMENTS = [
  { segmentId: "B1", text: "In 1926, according to the survey, approximately 300,000 people watched Rayleigh demonstrate the effect." },
  { segmentId: "B2", text: "The mayor said, \"we measured everything twice,\" and the number stayed approximately 42 percent." },
  { segmentId: "B3", text: "Blue light scatters several times more strongly than red, which may explain the haze." },
];

/** Faithful humanization: rhythm only, every protected item preserved. */
const GOOD_CANDIDATE = [
  { segmentId: "S1", sourceSegmentIds: ["B1"], candidateSpokenText: "In 1926, the survey reported, roughly 300,000 people watched Rayleigh show the effect.", changeTypes: ["CONVERSATIONAL_WORDING"], changeNotes: "hedge preserved (approximately→roughly), number/date/name intact" },
  { segmentId: "S2", sourceSegmentIds: ["B2"], candidateSpokenText: "The mayor said, \"we measured everything twice,\" and the number stayed roughly 42 percent.", changeTypes: ["RHYTHM"], changeNotes: null },
  { segmentId: "S3", sourceSegmentIds: ["B3"], candidateSpokenText: "Blue light scatters several times more strongly than red — that may explain the haze.", changeTypes: ["RHYTHM", "TRANSITION"], changeNotes: null },
];

/** Systemically dull candidate: uniform cadence + repeated transitions. */
const DULL_CANDIDATE = [
  { segmentId: "S1", sourceSegmentIds: ["B1"], candidateSpokenText: "So the survey reported a number. So the number was large. So the people watched.", changeTypes: ["CADENCE"] },
  { segmentId: "S2", sourceSegmentIds: ["B2"], candidateSpokenText: "So the mayor said a thing. So the number stayed. So the value held.", changeTypes: ["CADENCE"] },
  { segmentId: "S3", sourceSegmentIds: ["B3"], candidateSpokenText: "So the light scatters. So the red stays low. So the haze appears.", changeTypes: ["CADENCE"] },
];

module.exports = { makeRoot, SOURCE_SEGMENTS, GOOD_CANDIDATE, DULL_CANDIDATE };
