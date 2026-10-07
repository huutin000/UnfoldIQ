"use strict";

/**
 * Canonical Prompt Spec builder (1G.4 §7, §8). Provider-neutral structured
 * visual intent derived deterministically from the canonical planning chain:
 * Shot -> parent Scene -> Beats -> Story Draft.
 *
 * The compiler NEVER invents content: cinematic fields stay null unless a
 * canonical source (shot fields, analyst overrides, continuity locks)
 * supplies them.
 */

const shared = require("./shared.js");
const { COMPILER_VERSION, hash16, id12, readPlatformComposition } = shared;
const referenceResolver = require("./reference-resolver.js");
const continuity = require("./continuity.js");

/**
 * Input: {
 *   projectId, shot, scene, beatMap, storyDraft, platform, contentClass,
 *   overrides? {style, lightingAmbiance, composition, camera, focusLens,
 *               historicalConstraints, scientificConstraints, mustAvoid[],
 *               actionIntent, wardrobe, identity, ...},
 *   referenceAssets? [{assetId, kind, version, locks}],
 *   now?
 * }
 */
function buildPromptSpec(input = {}) {
  const { shot, scene, beatMap, storyDraft } = input;
  if (!shot || !shot.shotId || !scene || !scene.sceneId) {
    return { ok: false, code: "PROMPT_SPEC_SOURCE_INVALID", message: "shot and scene are required" };
  }
  if (!beatMap || !Array.isArray(beatMap.beats)) {
    return { ok: false, code: "PROMPT_SPEC_SOURCE_INVALID", message: "beatMap is required for lineage" };
  }
  // Orphan-shot guard: the shot's beats must resolve inside the beat map.
  const beatsById = new Map(beatMap.beats.map((b) => [b.beatId, b]));
  const shotBeats = (shot.beatIds || []).map((id) => beatsById.get(id)).filter(Boolean);
  if (shotBeats.length === 0) {
    return { ok: false, code: "ORPHAN_SHOT", message: `shot ${shot.shotId} has no resolvable beats` };
  }

  const overrides = input.overrides || {};
  const refs = referenceResolver.resolveReferenceRefs(input.referenceAssets, shot, scene);
  const locks = continuity.locksFromAssets(input.referenceAssets);
  const conflicts = continuity.checkContinuityConflicts(locks, overrides);
  if (!conflicts.ok) {
    return { ok: false, code: "CONTINUITY_CONFLICT", conflicts: conflicts.conflicts, message: "compile-time intent conflicts with locked canonical identity" };
  }

  const hasFrame = referenceResolver.hasReferenceFrame(refs.referenceRefs);
  const preserve = continuity.buildPreserveList(locks, refs.referenceRefs, overrides.mustPreserve || []);

  // Reference-first subject: a locked character/asset is referenced by ID, not
  // re-described. Otherwise the subject descriptor is the beat's own summary.
  const lockedSubjects = refs.referenceRefs.filter((r) => r.kind === "CHARACTER" || r.kind === "ENVIRONMENT");
  const subjectDescriptor = lockedSubjects.length > 0
    ? lockedSubjects.map((r) => `established ${r.kind.toLowerCase()} [${r.assetId}]`).join("; ")
    : shotBeats[0].summary || scene.narrativePurpose || null;

  const beatClaims = shotBeats.flatMap((b) => b.claimRefs || []);
  const classificationRefs = shotBeats.flatMap((b) => b.classificationRefs || []);

  const spec = {
    version: COMPILER_VERSION,
    promptSpecId: null, // assigned after fingerprint below
    projectId: input.projectId,
    sceneId: scene.sceneId,
    shotId: shot.shotId,
    targetKind: null, // set at compile time by the CALLER (1G.4 never infers)
    platform: input.platform || null,
    contentClass: input.contentClass,

    sourceRefs: {
      shotId: shot.shotId,
      sceneId: scene.sceneId,
      beatIds: (shot.beatIds || []).slice(),
      storySectionRefs: [...new Set(shotBeats.map((b) => b.storySectionRef))],
      storyDraftRef: { draftId: storyDraft ? storyDraft.draftId : null },
      beatMapFingerprint: beatMap.fingerprint,
      sourceShotFingerprint: shared.hash16(shot),
      sourceSceneFingerprint: shared.hash16(scene),
    },
    referenceRefs: refs.referenceRefs,
    unknownReferences: refs.unknown,
    continuityRefs: shot.continuityRefs || [],

    subject: {
      refs: shot.subjectRefs || [],
      descriptor: subjectDescriptor,
      referenceFirst: lockedSubjects.length > 0,
    },
    action: overrides.actionIntent !== undefined ? overrides.actionIntent : (shot.actionIntent || null),
    environment: { refs: scene.environmentRefs || [], descriptor: overrides.environment || null },
    composition: overrides.composition || null,
    camera: typeof overrides.camera === "string" ? { motion: overrides.camera } : (overrides.camera || null),
    focusLens: overrides.focusLens || null,
    lightingAmbiance: overrides.lightingAmbiance || null,
    style: overrides.style || null,
    environmentMotion: overrides.environmentMotion || null,
    historicalConstraints: overrides.historicalConstraints || null,
    scientificConstraints: overrides.scientificConstraints || null,
    narrativeIntent: `${scene.visualObjective}/${shot.shotPurpose}`,
    shot: { startState: shot.startState || null, endState: shot.endState || null },

    mustPreserve: preserve,
    mustAvoid: (overrides.mustAvoid || []).slice(0, 8),

    claimRefs: [...new Set(shot.claimRefs || beatClaims)].filter((id) => beatClaims.includes(id) || (shot.claimRefs || []).includes(id)),
    classificationRefs,

    unknownReferencesCount: refs.unknown.length,
    fingerprint: null,
    status: "DRAFT",
  };
  spec.fingerprint = hash16({
    sourceRefs: spec.sourceRefs,
    subject: spec.subject,
    action: spec.action,
    environment: spec.environment,
    composition: spec.composition,
    camera: spec.camera,
    focusLens: spec.focusLens,
    lightingAmbiance: spec.lightingAmbiance,
    style: spec.style,
    environmentMotion: spec.environmentMotion,
    historicalConstraints: spec.historicalConstraints,
    scientificConstraints: spec.scientificConstraints,
    narrativeIntent: spec.narrativeIntent,
    shot: spec.shot,
    mustPreserve: spec.mustPreserve,
    mustAvoid: spec.mustAvoid,
    claimRefs: spec.claimRefs,
    classificationRefs: spec.classificationRefs,
  });
  spec.promptSpecId = id12("ps", { projectId: input.projectId, shotId: shot.shotId, fingerprint: spec.fingerprint });
  return { ok: true, spec };
}

module.exports = { buildPromptSpec };
module.exports.shared = shared;
