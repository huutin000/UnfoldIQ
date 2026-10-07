"use strict";

/**
 * UNFOLDIQ Story→Visual-Structure facade (1G.3, Prompt 01, §48).
 *
 * runStoryToVisualStructure(input, options):
 *   Story Draft -> Beat Map -> Scene Graph -> Shot Plan -> validate -> persist
 *   -> normalized refs/status.
 *
 * The facade owns NO planning rules — it sequences the canonical planners and
 * the deterministic validator (which is the final authority). Provider-neutral
 * exchange seams may supply candidate groupings; invalid candidates are
 * rejected, never auto-repaired.
 *
 * Terminal statuses:
 *   VISUAL_STRUCTURE_READY | STRUCTURE_BLOCKED | STALE_INPUT |
 *   PLANNING_LOCKED | FAILED
 *
 * Creative Memory (1G.2) is advisory only: warnings and recent patterns may
 * be attached; memory NEVER forces a scene split, a shot count, or any
 * structure change, and never touches evidence truth.
 */

const facade = require("./planning-facade.js");
const store = require("./store.js");
const creativeMemoryLib = require("../creative-memory.js");

const STATUS = {
  VISUAL_STRUCTURE_READY: "VISUAL_STRUCTURE_READY",
  STRUCTURE_BLOCKED: "STRUCTURE_BLOCKED",
  STALE_INPUT: "STALE_INPUT",
  PLANNING_LOCKED: "PLANNING_LOCKED",
  FAILED: "FAILED",
};

/**
 * Input: { projectId, storyDraft, narrativeBrief?, contentClass, platform? }
 * Options: { root?, persist?, beatExchange?, shotExchange?, creativeMemory?,
 *            force?, now? }
 */
async function runStoryToVisualStructure(input = {}, options = {}) {
  const result = {
    ok: false,
    status: STATUS.FAILED,
    projectId: input.projectId || null,
    contentClass: input.contentClass || null,
    platform: input.platform || null,
    counts: { sections: 0, beats: 0, scenes: 0, shots: 0 },
    artifactRefs: {},
    lineage: [],
    memoryAdvisory: null,
    warnings: [],
    blockers: [],
  };
  try {
    if (!input.storyDraft || !Array.isArray(input.storyDraft.sections)) {
      result.status = STATUS.STRUCTURE_BLOCKED;
      result.blockers.push("STORY_DRAFT_REQUIRED");
      return result;
    }
    result.counts.sections = input.storyDraft.sections.length;

    // Staleness first: stale persisted structure is invalidated, never reused.
    if (options.root && options.persist !== false) {
      const staleness = store.checkStructureStaleness(options.root, input.projectId, input.storyDraft);
      if (staleness.stale) {
        store.markStale(options.root, input.projectId, staleness.staleLayers);
        result.warnings.push(`stale structural artifacts invalidated: ${staleness.staleLayers.join(", ")}`);
      }
    }

    // Creative Memory advisory (attached only; never changes the structure).
    if (options.creativeMemory && options.creativeMemory.channelId && options.root) {
      try {
        const mem = creativeMemoryLib.checkCreativeRepetition(options.root, {
          storyDraft: input.storyDraft,
          creativeBrief: input.creativeBrief || null,
        }, {
          channelId: options.creativeMemory.channelId,
          nicheId: options.creativeMemory.nicheId,
          platform: input.platform,
          projectId: input.projectId,
        });
        if (mem.ok) {
          result.memoryAdvisory = { advisoryOnly: true, repetition: mem.status, warnings: mem.warnings };
        }
      } catch (e) {
        result.warnings.push(`creative memory advisory unavailable: ${String((e && e.message) || e).slice(0, 120)}`);
      }
    }

    const built = facade.planStructure(input, options);
    if (!built.ok) {
      result.status = built.code === "CANDIDATE_REJECTED" ? STATUS.STRUCTURE_BLOCKED : STATUS.FAILED;
      result.blockers.push(`${built.code}: ${built.message || ""}`.trim());
      if (built.validation) result.validation = built.validation;
      return result;
    }

    result.validation = built.validation;
    if (!built.validation.valid) {
      result.status = STATUS.STRUCTURE_BLOCKED;
      result.blockers.push(...built.validation.errors.map((e) => `${e.code}: ${e.message}`));
      return result;
    }

    result.beatMap = built.beatMap;
    result.sceneGraph = built.sceneGraph;
    result.shotPlan = built.shotPlan;
    result.counts.beats = built.beatMap.beats.length;
    result.counts.scenes = built.sceneGraph.scenes.length;
    result.counts.shots = built.shotPlan.shots.length;
    result.artifactRefs = {
      beatMap: { artifact: "planning/beat-map.json", beatMapId: built.beatMap.beatMapId, fingerprint: built.beatMap.fingerprint },
      sceneGraph: { artifact: "planning/scene-graph.json", sceneGraphId: built.sceneGraph.sceneGraphId, fingerprint: built.sceneGraph.fingerprint },
      shotPlan: { artifact: "planning/shot-plan.json", shotPlanId: built.shotPlan.shotPlanId, fingerprint: built.shotPlan.fingerprint },
    };
    result.lineage = [
      { layer: "storyDraft", ref: input.storyDraft.draftId, parent: "narrative brief" },
      { layer: "beatMap", ref: built.beatMap.beatMapId, parent: input.storyDraft.draftId },
      { layer: "beats", ref: `${built.beatMap.beats.length} beats`, parent: "story sections/claims" },
      { layer: "sceneGraph", ref: built.sceneGraph.sceneGraphId, parent: built.beatMap.beatMapId },
      { layer: "scenes", ref: `${built.sceneGraph.scenes.length} scenes`, parent: "beatIds" },
      { layer: "shotPlan", ref: built.shotPlan.shotPlanId, parent: built.sceneGraph.sceneGraphId },
      { layer: "shots", ref: `${built.shotPlan.shots.length} shots`, parent: "parentSceneId/beat refs" },
    ];
    result.status = STATUS.VISUAL_STRUCTURE_READY;
    result.ok = true;

    if (options.root && options.persist !== false) {
      const saved = store.persistPlanning(options.root, input.projectId, {
        beatMap: built.beatMap,
        sceneGraph: built.sceneGraph,
        shotPlan: built.shotPlan,
        force: options.force === true,
      });
      if (!saved.ok) {
        result.status = saved.code === "PLANNING_LOCKED" ? STATUS.PLANNING_LOCKED : STATUS.FAILED;
        result.blockers.push(`${saved.code}: ${saved.message || ""}`.trim());
        result.ok = false;
        return result;
      }
    }
    return result;
  } catch (e) {
    result.status = STATUS.FAILED;
    result.blockers.push(`UNEXPECTED: ${String((e && e.message) || e)}`);
    return result;
  }
}

module.exports = {
  STATUS,
  runStoryToVisualStructure,
  checkStaleness: store.checkStructureStaleness,
  markStale: store.markStale,
  loadPlanning: store.loadPlanning,
  persistPlanning: store.persistPlanning,
  validateStructure: facade.validateStructure,
  buildBeatMap: facade.buildBeatMap,
  buildSceneGraph: facade.buildSceneGraph,
  buildShotPlan: facade.buildShotPlan,
};
