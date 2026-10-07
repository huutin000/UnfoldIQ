"use strict";

/**
 * UNFOLDIQ structural planning validator (1G.3, Prompt 01, §39).
 *
 * Deterministic, structured results. The validator is the FINAL AUTHORITY:
 * exchange/provider candidates are rejected when invalid — never silently
 * auto-corrected and passed.
 */

const Ajv = require("ajv");
const addFormats = require("ajv-formats");
const fs = require("fs");
const path = require("path");
const shared = require("./shared.js");
const { normalizeText } = shared;

function loadSchema(file) {
  const p = path.join(__dirname, "..", "..", "schemas", file);
  return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
}

function schemaErrors(file, doc, ajv) {
  const validate = ajv.compile(loadSchema(file));
  const ok = validate(doc);
  if (ok) return [];
  return (validate.errors || []).map((e) => ({
    dimension: "schema",
    code: `SCHEMA_${file.replace(".schema.json", "").toUpperCase()}`,
    message: `${e.instancePath} ${e.message}`,
  }));
}

function createAjv() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

// --- Structural duplicate detection (§44): adjacent shots matching on
// multiple independent signals at once; one matching field alone is never
// enough. visualObjective is scene-inherited (constant within a scene) and is
// therefore NOT counted as a distinguishing duplicate signal.
const DUPLICATE_SIGNALS = ["shotPurpose", "startState"];

/**
 * Validate a full structural plan.
 * Input: { storyDraft, beatMap, sceneGraph, shotPlan }
 * Returns { valid, errors[], warnings[] } with structured entries
 * { dimension, code, message }.
 */
function validateStructure(input = {}) {
  const errors = [];
  const warnings = [];
  const push = (dimension, code, message) => errors.push({ dimension, code, message });
  const warn = (dimension, code, message) => warnings.push({ dimension, code, message });

  const ajv = createAjv();
  errors.push(...schemaErrors("beat-map.schema.json", input.beatMap, ajv));
  errors.push(...schemaErrors("scene-graph.schema.json", input.sceneGraph, ajv));
  errors.push(...schemaErrors("shot-plan.schema.json", input.shotPlan, ajv));

  const beatMap = input.beatMap;
  const sceneGraph = input.sceneGraph || { scenes: [] };
  const shotPlan = input.shotPlan || { shots: [] };
  const draft = input.storyDraft || { sections: [] };
  const draftSectionIds = new Set((draft.sections || []).map((s) => s.sectionId));
  const draftClaims = new Set((draft.sections || []).flatMap((s) => s.claimRefs || []));
  const beatById = new Map((beatMap.beats || []).map((b) => [b.beatId, b]));

  // --- Story / beat coverage (§9): every narrative section >= 1 beat.
  const sectionsCovered = new Set((beatMap.beats || []).map((b) => b.storySectionRef));
  for (const section of draft.sections || []) {
    if (!sectionsCovered.has(section.sectionId)) {
      push("storyCoverage", "STORY_SECTION_UNCOVERED", `story section ${section.sectionId} has no beat`);
    }
  }
  for (const beat of beatMap.beats || []) {
    if (!draftSectionIds.has(beat.storySectionRef)) {
      push("beatCoverage", "BEAT_UNKNOWN_SECTION", `beat ${beat.beatId} references unknown section ${beat.storySectionRef}`);
    }
  }

  // --- Claim / evidence lineage (§10): claims only inherited, never invented.
  for (const beat of beatMap.beats || []) {
    for (const id of beat.claimRefs || []) {
      if (!draftClaims.has(id)) {
        push("claimLineage", "CLAIM_INVENTED", `beat ${beat.beatId} carries claim ${id} absent from the Story Draft`);
      }
    }
  }
  const beatClaims = new Set((beatMap.beats || []).flatMap((b) => b.claimRefs || []));
  for (const scene of sceneGraph.scenes || []) {
    for (const id of scene.claimRefs || []) {
      if (!beatClaims.has(id)) push("claimLineage", "CLAIM_INVENTED", `scene ${scene.sceneId} carries claim ${id} absent from its beats`);
    }
    for (const id of scene.beatIds || []) {
      if (!beatById.has(id)) push("sceneLineage", "ORPHAN_SCENE", `scene ${scene.sceneId} references unknown beat ${id}`);
    }
    if (!scene.beatIds || scene.beatIds.length === 0) {
      push("sceneLineage", "ORPHAN_SCENE", `scene ${scene.sceneId} has no beats`);
    }
  }

  // --- FICTION / HYBRID boundaries (§11, §12).
  if (beatMap.contentClass === "FICTION") {
    const fake = (beatMap.beats || []).filter((b) => (b.claimRefs || []).length > 0);
    if (fake.length > 0) {
      push("fictionBoundary", "FICTION_FAKE_EVIDENCE", `fiction beats carry claim refs: ${fake.map((b) => b.beatId).join(", ")}`);
    }
  }

  // --- Shot parent mapping / coverage (§18, §21, §23).
  const sceneIds = new Set((sceneGraph.scenes || []).map((s) => s.sceneId));
  const shotsByScene = new Map();
  for (const shot of shotPlan.shots || []) {
    if (!shot.parentSceneId || !sceneIds.has(shot.parentSceneId)) {
      push("shotParent", "ORPHAN_SHOT", `shot ${shot.shotId} points to unknown parentSceneId ${shot.parentSceneId}`);
      continue;
    }
    if (!shotsByScene.has(shot.parentSceneId)) shotsByScene.set(shot.parentSceneId, []);
    shotsByScene.get(shot.parentSceneId).push(shot);
    for (const id of shot.beatIds || []) {
      if (!beatById.has(id)) push("shotCoverage", "SHOT_UNKNOWN_BEAT", `shot ${shot.shotId} references unknown beat ${id}`);
    }
    for (const id of shot.claimRefs || []) {
      if (!beatClaims.has(id)) push("claimLineage", "CLAIM_INVENTED", `shot ${shot.shotId} carries claim ${id} absent from beats`);
    }
  }
  for (const scene of sceneGraph.scenes || []) {
    if (!shotsByScene.has(scene.sceneId) || shotsByScene.get(scene.sceneId).length === 0) {
      push("shotCoverage", "SCENE_UNCOVERED", `scene ${scene.sceneId} has no shot`);
    }
  }

  // --- Structural duplicate detection (§44): adjacent shots matching on
  // multiple signals at once; one matching field alone is never enough.
  for (const [sceneId, list] of shotsByScene) {
    const ordered = list.slice().sort((a, b) => a.orderWithinScene - b.orderWithinScene);
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1];
      const b = ordered[i];
      const matches = DUPLICATE_SIGNALS.filter((k) => a[k] && a[k] === b[k]);
      const sameSubject = JSON.stringify(a.subjectRefs || []) === JSON.stringify(b.subjectRefs || []) && (a.subjectRefs || []).length > 0;
      const sameContinuity = JSON.stringify(a.continuityRefs || []) === JSON.stringify(b.continuityRefs || []) && (a.continuityRefs || []).length > 0;
      if (sameSubject) matches.push("subjectRefs");
      if (sameContinuity) matches.push("continuityRefs");
      if (matches.length >= 4) {
        push("duplicateShots", "PATHOLOGICAL_DUPLICATE_SHOTS", `adjacent shots ${a.shotId}/${b.shotId} in ${sceneId} match ${matches.length} signals: ${matches.join(", ")}`);
      } else if (matches.length >= 2) {
        warn("duplicateShots", "NEAR_DUPLICATE_SHOTS", `adjacent shots ${a.shotId}/${b.shotId} in ${sceneId} share: ${matches.join(", ")}`);
      }
    }
  }

  // --- Cardinality guards (§45): fixed ratios are never encoded as rules.
  // The validator only records counts; it must never enforce equality.

  const valid = errors.length === 0;
  return { valid, errors, warnings };
}

module.exports = { validateStructure, createAjv };
