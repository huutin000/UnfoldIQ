"use strict";

/**
 * UNFOLDIQ Shot Plan runtime (1G.3, Prompt 01).
 *
 * A Shot is a visual view/progression unit inside exactly ONE parent Scene
 * (mandatory parentSceneId — never inferred from array position). Shot count
 * is dynamic: driven by distinct visual micro-objectives inside each scene
 * (deterministic role-run grouping), NOT by fixed per-scene counts and never
 * "1 Beat = 1 Shot". A single evidence-bearing scene can legitimately need an
 * ESTABLISH + EVIDENCE_VISUAL pair; scenes whose beats share one objective
 * stay one shot.
 *
 * Planning semantics only: structured intents (framing/camera) stay null
 * unless an exchange or analyst supplies them — no provider prompts, no Veo
 * decisions, no final timing. Provider-neutral override seam: options.exchange
 * may supply a candidate shot grouping; the deterministic validator decides.
 */

const shared = require("./shared.js");
const { STRUCTURE_VERSION, hash16, id12, ROLE_SHOT_PURPOSE } = shared;

function beatsById(beatMap) {
  return new Map((beatMap.beats || []).map((b) => [b.beatId, b]));
}

/**
 * Build a deterministic Shot Plan from a Scene Graph + Beat Map.
 * Input: { beatMap, sceneGraph, options?: { exchange?(req) } }
 */
function buildShotPlan(input = {}) {
  const beatMap = input.beatMap;
  const sceneGraph = input.sceneGraph;
  if (!sceneGraph || !Array.isArray(sceneGraph.scenes) || sceneGraph.scenes.length === 0) {
    return { ok: false, code: "SHOT_SOURCE_INVALID", message: "sceneGraph with scenes is required" };
  }
  const byId = beatsById(beatMap || { beats: [] });
  const now = input.now || new Date().toISOString();

  let candidateShots = null;
  if (typeof input.exchange === "function") {
    const req = {
      requestId: `shot-${sceneGraph.sceneGraphId}`,
      type: "SHOT_GROUPING_CANDIDATE",
      scenes: sceneGraph.scenes.map((s) => ({ sceneId: s.sceneId, visualObjective: s.visualObjective, beatIds: s.beatIds })),
    };
    const candidate = input.exchange(req);
    if (!candidate || !candidate.ok || !Array.isArray(candidate.shots)) {
      return { ok: false, code: "SHOT_CANDIDATE_INVALID", message: "exchange returned no usable shot grouping" };
    }
    candidateShots = candidate.shots;
  }

  const shots = [];
  for (const scene of sceneGraph.scenes) {
    const sceneBeats = scene.beatIds.map((id) => byId.get(id)).filter(Boolean);
    if (sceneBeats.length === 0) {
      return { ok: false, code: "SHOT_SOURCE_INVALID", message: `scene ${scene.sceneId} has no resolvable beats` };
    }

    let shotGroups;
    if (candidateShots) {
      shotGroups = candidateShots
        .filter((g) => g && g.parentSceneId === scene.sceneId)
        .sort((a, b) => (a.orderWithinScene || 0) - (b.orderWithinScene || 0))
        .map((g) => ({ beatIds: g.beatIds, purpose: g.shotPurpose }));
      console.error("DEBUG shotGroups:", shotGroups.length, JSON.stringify(shotGroups)); if (shotGroups.length === 0) {
        return { ok: false, code: "SHOT_CANDIDATE_INVALID", message: `no candidate shots for scene ${scene.sceneId}` };
      }
    } else {
      // Deterministic default: one shot per run of beats sharing the same
      // narrative role (visual micro-objective). A scene whose beats all
      // share one evidence-bearing role may split into ESTABLISH +
      // EVIDENCE_VISUAL when the evidence run is its only content.
      shotGroups = [];
      let current = null;
      for (const beat of sceneBeats) {
        if (!current || current.role !== beat.narrativeRole) {
          current = { role: beat.narrativeRole, beatIds: [beat.beatId] };
          shotGroups.push(current);
        } else {
          current.beatIds.push(beat.beatId);
        }
      }
      if (shotGroups.length === 1 && sceneBeats.length >= 2 && sceneBeats.every((b) => (b.claimRefs || []).length > 0)) {
        // Evidence-heavy single-objective scene: establish, then show evidence.
        const head = shotGroups[0].beatIds.slice(0, Math.ceil(shotGroups[0].beatIds.length / 2));
        const tail = shotGroups[0].beatIds.slice(head.length);
        shotGroups = [
          { role: "SETUP", beatIds: head },
          { role: "EVIDENCE", beatIds: tail },
        ];
      }
    }

    const totalWeight = sceneBeats.length; // relative weight only — no final timing in 1G.3
    shotGroups.forEach((group, index) => {
      const beats = group.beatIds.map((id) => byId.get(id)).filter(Boolean);
      const purpose = group.purpose || ROLE_SHOT_PURPOSE[group.role] || ROLE_SHOT_PURPOSE[scene.visualObjective] || "DETAIL";
      const shotId = id12("sh", {
        projectId: sceneGraph.projectId,
        parentSceneId: scene.sceneId,
        orderWithinScene: index,
        purpose,
        beatIds: group.beatIds.slice().sort(),
      });
      shots.push({
        shotId,
        parentSceneId: scene.sceneId,
        orderWithinScene: index,
        beatIds: group.beatIds,
        claimRefs: [...new Set(beats.flatMap((b) => (b.claimRefs || [])))],
        shotPurpose: purpose,
        visualObjective: scene.visualObjective,
        subjectRefs: scene.subjectRefs || [],
        actionIntent: null,
        framingIntent: null,
        cameraIntent: null,
        continuityRefs: [scene.continuityGroup],
        startState: index === 0 ? (scene.stateBefore || null) : shotGroups[index - 1].role,
        endState: group.role,
        relativeWeight: Number((group.beatIds.length / Math.max(totalWeight, 1)).toFixed(4)),
      });
    });
  }

  const shotPlanId = id12("sp", { projectId: sceneGraph.projectId, sceneGraphId: sceneGraph.sceneGraphId, shotIds: shots.map((s) => s.shotId) });
  const shotPlan = {
    version: STRUCTURE_VERSION,
    shotPlanId,
    projectId: sceneGraph.projectId,
    platform: sceneGraph.platform || null,
    contentClass: sceneGraph.contentClass,
    sourceSceneGraphRef: { sceneGraphId: sceneGraph.sceneGraphId, fingerprint: sceneGraph.fingerprint },
    shots,
    fingerprint: hash16({ shotPlanId, shots: shots.map((s) => [s.shotId, s.parentSceneId, s.shotPurpose]) }),
    status: "GENERATED",
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, shotPlan };
}

module.exports = { buildShotPlan };
