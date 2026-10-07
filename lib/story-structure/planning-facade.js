"use strict";

/**
 * Internal planning sequencer: Beat Map -> Scene Graph -> Shot Plan ->
 * validate. No rules of its own; the deterministic validator is the final
 * authority over any exchange candidate.
 */

const beatMapLib = require("./beat-map.js");
const sceneGraphLib = require("./scene-graph.js");
const shotPlanLib = require("./shot-plan.js");
const validator = require("./validator.js");

function planStructure(input = {}, options = {}) {
  const beat = beatMapLib.buildBeatMap({
    projectId: input.projectId,
    storyDraft: input.storyDraft,
    narrativeBrief: input.narrativeBrief,
    contentClass: input.contentClass,
    platform: input.platform,
    now: options.now,
  });
  if (!beat.ok) return beat;

  const scene = sceneGraphLib.buildSceneGraph({
    beatMap: beat.beatMap,
    storyDraft: input.storyDraft,
    exchange: options.beatExchange || options.sceneExchange,
    now: options.now,
  });
  if (!scene.ok) return scene;

  const shot = shotPlanLib.buildShotPlan({
    beatMap: beat.beatMap,
    sceneGraph: scene.sceneGraph,
    exchange: options.shotExchange,
    now: options.now,
  });
  if (!shot.ok) return shot;

  const validation = validator.validateStructure({
    storyDraft: input.storyDraft,
    beatMap: beat.beatMap,
    sceneGraph: scene.sceneGraph,
    shotPlan: shot.shotPlan,
  });
  return {
    ok: true,
    beatMap: beat.beatMap,
    sceneGraph: scene.sceneGraph,
    shotPlan: shot.shotPlan,
    validation,
  };
}

module.exports = {
  planStructure,
  validateStructure: validator.validateStructure,
  buildBeatMap: beatMapLib.buildBeatMap,
  buildSceneGraph: sceneGraphLib.buildSceneGraph,
  buildShotPlan: shotPlanLib.buildShotPlan,
  beatShapeSignature: beatMapLib.beatShapeSignature,
};
