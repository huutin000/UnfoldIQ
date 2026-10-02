"use strict";

/**
 * UNFOLDIQ evidence persistence (Prompt 03).
 *
 * Layout follows the project-artifact convention (projects/<id>/research/):
 *   research/creative-brief.json   (V6, optional)
 *   research/source-index.json     (1G.1G)
 *   research/sources/<src-id>/content-<hash>.md (+ fit-<hash>.md)
 *   research/claims.json           (1G.1I)
 *   research/contradictions.json   (1G.1K)
 *   research/unknowns.json         (1G.1K)
 *   research/sufficiency.json      (1G.1L)
 *
 * All writes are atomic (tmp + rename via artifact-store): on failure the
 * old valid artifact remains readable. No Prompt-04 Research Pack is produced
 * here — structured evidence/sufficiency artifacts only.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");

const EVIDENCE_VERSION = "1.0.0";

const FILES = {
  brief: "research/creative-brief.json",
  index: "research/source-index.json",
  claims: "research/claims.json",
  contradictions: "research/contradictions.json",
  unknowns: "research/unknowns.json",
  sufficiency: "research/sufficiency.json",
};

function envelope(projectId, payload) {
  return { version: EVIDENCE_VERSION, projectId, ...payload };
}

function persistEvidenceState(root, projectId, state = {}) {
  const written = [];
  try {
    const jobs = [
      [state.index, FILES.index],
      [state.claimsLedger ? envelope(projectId, { claims: state.claimsLedger.claims || [] }) : null, FILES.claims],
      [state.contradictionStore ? envelope(projectId, { contradictions: state.contradictionStore.contradictions || [] }) : null, FILES.contradictions],
      [state.unknownStore ? envelope(projectId, { unknowns: state.unknownStore.unknowns || [] }) : null, FILES.unknowns],
      [state.sufficiency ? envelope(projectId, { evaluation: state.sufficiency.evaluation || state.sufficiency }) : null, FILES.sufficiency],
      [state.brief, FILES.brief],
    ];
    for (const [doc, rel] of jobs) {
      if (doc === undefined || doc === null) continue;
      artifactStore.writeArtifactAtomic(root, projectId, rel, JSON.stringify(doc, null, 2));
      written.push(rel);
    }
    return { ok: true, written };
  } catch (e) {
    return { ok: false, code: "EVIDENCE_PERSIST_FAILED", message: String((e && e.message) || e), written };
  }
}

function loadEvidenceFile(root, projectId, rel) {
  try {
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: true, doc: null };
    return { ok: true, doc: JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8")) };
  } catch (e) {
    return { ok: false, code: "EVIDENCE_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

function validateEvidenceFile(kind, doc) {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  let schema;
  const dir = path.join(__dirname, "..", "..", "schemas");
  if (kind === "brief") {
    schema = JSON.parse(fs.readFileSync(path.join(dir, "creative-brief.schema.json"), "utf8").replace(/^\uFEFF/, ""));
  } else if (kind === "index") {
    schema = JSON.parse(fs.readFileSync(path.join(dir, "source-index.schema.json"), "utf8").replace(/^\uFEFF/, ""));
  } else {
    schema = JSON.parse(fs.readFileSync(path.join(dir, "evidence-state.schema.json"), "utf8").replace(/^\uFEFF/, ""));
  }
  const valid = ajv.compile(schema)(doc);
  return valid;
}

module.exports = {
  EVIDENCE_VERSION,
  FILES,
  persistEvidenceState,
  loadEvidenceFile,
  validateEvidenceFile,
};
