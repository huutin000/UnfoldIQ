"use strict";

/** Shared Phase 4A fixtures: content truth + asset registry (no mocks of contracts). */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const packaging = require(REPO + "/lib/packaging/index.js");

const hash = (s) => s.padEnd(64, "0");

function makeRegistry(extra = {}) {
  const assets = {
    "as-thumb1": { assetId: "as-thumb1", hash: hash("th1"), type: "image", width: 1920, height: 1080 },
    "as-thumb2": { assetId: "as-thumb2", hash: hash("th2"), type: "image", width: 1920, height: 1080 },
    "as-thumb3": { assetId: "as-thumb3", hash: hash("th3"), type: "image", width: 1920, height: 1080 },
    "as-music1": { assetId: "as-music1", hash: hash("mu1"), type: "audio" },
    ...extra,
  };
  return { assets, resolver: (id) => assets[id] || null };
}

const EVIDENCE = [
  { claimId: "c-shelter", text: "Early humans used sheltered sleeping arrangements", supportType: "BOTH", sources: ["doi:10.0000/shelter"] },
  { claimId: "c-fire", text: "Fire kept predators away at night", supportType: "EVIDENCE", sources: ["doi:10.0000/fire"] },
  { claimId: "c-group", text: "Group vigilance protected the young", supportType: "VIDEO_CONTENT", sources: [] },
];

const VIDEO_SUPPORT = { claimIds: ["c-shelter", "c-group"] };

function thumbFor(assetId, claim, over = {}) {
  return {
    assetId, concept: `concept-${assetId}`, visualClaim: `scene showing ${claim}`,
    sourceType: "FRAME", width: 1920, height: 1080, format: "JPG", fileSizeBytes: 800000,
    claimRefs: [claim], provenanceRef: `provenance:${assetId}`, ...over,
  };
}

function concept(n, titleText, claim, assetId, over = {}) {
  return {
    concept: `concept-angle-${n}`,
    audience: `audience-${n}`,
    hypothesis: `hypothesis-${n}: distinct testable appeal with content-match quality focus`,
    semanticAngle: `ANGLE_${n}`,
    noveltyAxis: [`axis-${n}`],
    expectedTradeoff: `tradeoff-${n}`,
    title: { text: titleText, angle: "CURIOSITY", primaryClaim: claim, claimRefs: [claim] },
    thumbnail: thumbFor(assetId, claim),
    ...over,
  };
}

function baseConcepts() {
  return [
    concept(1, "How Early Humans Kept Babies Safe at Night", "c-shelter", "as-thumb1"),
    concept(2, "Fire: The Ancient Predator Shield", "c-fire", "as-thumb2"),
    concept(3, "It Took a Tribe to Raise a Child", "c-group", "as-thumb3"),
  ];
}

function buildSet(concepts = baseConcepts(), projectId = "pack-validation", contentHashes = { script: "s1", timeline: "t1" }) {
  const reg = makeRegistry();
  const r = packaging.experiment.buildPublishExperimentSet(
    { projectId, contentHashes, concepts },
    { assetResolver: reg.resolver });
  if (!r.ok) throw new Error("fixture set failed: " + (r.message || JSON.stringify(r.errors)));
  return { set: r.set, registry: reg };
}

function qaContext(reg, over = {}) {
  return {
    assetResolver: reg.resolver,
    evidenceClaims: EVIDENCE,
    videoSupport: VIDEO_SUPPORT,
    ...over,
  };
}

module.exports = { REPO, packaging, hash, makeRegistry, EVIDENCE, VIDEO_SUPPORT, thumbFor, concept, baseConcepts, buildSet, qaContext };
