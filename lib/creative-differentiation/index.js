"use strict";

/**
 * Phase 6B — Creative Differentiation facade (UNFOLDIQ CORE, headless).
 * Style Bake-off (6.4) + Originality (6.5) + Explainable Quality (6.6) + optional Creator Controls (6.7).
 * Reuses canonical state: Phase 6A creative-retention, Dependency DAG, artifact store. Zero paid calls.
 */

const artifactStore = require("../../providers/runtime/artifact-store.js");
const policy = require("./policy.js");
const guard = require("./guard.js");
const bakeoff = require("./bakeoff.js");
const originality = require("./originality.js");
const quality = require("./quality.js");
const controls = require("./controls.js");
const evidence = require("./evidence.js");

const ARTIFACT_FILES = Object.freeze({
  bakeoff: "creative/style-bakeoff-decisions.json",
  originalityFingerprint: "creative/originality-fingerprint-v2.json",
  originality: "creative/originality-assessment.json",
  qualityAssessment: "creative/quality-assessment.json",
  overrideLedger: "creative/creator-control-override-ledger.json",
  directorPrompts: "creative/director-prompts.json",
});

/** Honest status of the optional 6.7 controls (non-blocking V1). */
const CREATOR_CONTROL_STATUS = Object.freeze({
  directorPrompt: { status: "IMPLEMENTED", where: "lib/creative-differentiation/controls.js" },
  overrideLedger: { status: "IMPLEMENTED", where: "lib/creative-differentiation/controls.js" },
  performanceReference: { status: "DEFERRED_WITH_EVIDENCE", reason: "Needs explicit per-reference rights/provenance capture and an ingestion path that does not exist yet; building it without them would risk unlicensed-reference use. Trigger: first owner request with a licensed reference." },
  representativePreview: { status: "MERGED_INTO_BAKEOFF", reason: "Short local segment preview + content-addressed cache already provided by bakeoff.getOrCreatePreview (<=35% of video, 1 render cap); no separate entity needed." },
  channelEditorialIdentity: { status: "PARTIAL", reason: "Identity enters the originality fingerprint (channelIdentityHash/editorialBibleVersion) so repeatable identity is recognised as intentional; richer authoring controls are deferred until a multi-episode channel exists." },
});

function persist(root, projectId, key, doc) {
  guard.assertSafeDoc(doc);
  artifactStore.writeArtifactAtomic(root, projectId, ARTIFACT_FILES[key], JSON.stringify(doc, null, 2) + "\n");
  return ARTIFACT_FILES[key];
}

function load(root, projectId, key) {
  const rel = ARTIFACT_FILES[key];
  if (!artifactStore.artifactExists(root, projectId, rel)) return null;
  return JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8"));
}

module.exports = { ARTIFACT_FILES, CREATOR_CONTROL_STATUS, policy, guard, bakeoff, originality, quality, controls, evidence, persist, load };
