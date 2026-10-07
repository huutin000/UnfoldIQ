"use strict";

/**
 * UNFOLDIQ Scene Graph runtime (1G.3, Prompt 01).
 *
 * A Scene is a coherent production unit: one stable visual/narrative
 * situation. Scene boundaries follow meaningful narrative/visual turns only
 * (visual-objective bucket change over consecutive beats: ORIENT / EXPLAIN /
 * SHIFT / RESOLVE) — never sentence or paragraph boundaries alone, and never
 * "1 Beat = 1 Scene": multiple beats with the same visual objective stay in
 * one scene.
 *
 * Provider-neutral override seam: options.exchange may supply a candidate
 * scene grouping (agent/LLM structured exchange). The candidate is NEVER the
 * authority — the deterministic validator decides; an invalid candidate is
 * rejected, never silently repaired.
 *
 * No orphan scenes: every scene traces beatIds -> storySectionRefs -> claimRefs.
 * No final timestamps here: timing belongs to the later Stage-8 scene-script /
 * duration owners. Only order + relative structure is produced.
 */

const shared = require("./shared.js");
const { STRUCTURE_VERSION, hash16, id12, ROLE_BUCKETS } = shared;

function beatsById(beatMap) {
  return new Map((beatMap.beats || []).map((b) => [b.beatId, b]));
}

/**
 * Build a deterministic Scene Graph from a Beat Map.
 * Input: { beatMap, storyDraft, options?: { exchange?(req) -> candidate scenes } }
 */
function buildSceneGraph(input = {}) {
  const beatMap = input.beatMap;
  if (!beatMap || !Array.isArray(beatMap.beats) || beatMap.beats.length === 0) {
    return { ok: false, code: "SCENE_SOURCE_INVALID", message: "beatMap with beats is required" };
  }
  const byId = beatsById(beatMap);
  const now = input.now || new Date().toISOString();

  let groups;
  if (typeof input.exchange === "function") {
    const req = {
      requestId: `scene-${beatMap.beatMapId}`,
      type: "SCENE_GROUPING_CANDIDATE",
      beats: beatMap.beats.map((b) => ({ beatId: b.beatId, order: b.order, narrativeRole: b.narrativeRole, storySectionRef: b.storySectionRef })),
      objectiveBuckets: beatMap.beats.map((b) => ROLE_BUCKETS[b.narrativeRole]),
    };
    const candidate = input.exchange(req);
    if (!candidate || !candidate.ok || !Array.isArray(candidate.sceneGroups)) {
      return { ok: false, code: "SCENE_CANDIDATE_INVALID", message: "exchange returned no usable scene grouping" };
    }
    groups = candidate.sceneGroups;
  } else {
    // Deterministic default: cut a new scene only on a STABLE visual-objective
    // turn — the new bucket must persist (next beat agrees, or end of run).
    // This absorbs single-beat bucket flips and prevents sentence-churn from
    // exploding the scene count, while still honoring meaningful turns.
    groups = [];
    let current = null;
    const beats = beatMap.beats;
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i];
      const bucket = ROLE_BUCKETS[beat.narrativeRole];
      const nextBucket = i + 1 < beats.length ? ROLE_BUCKETS[beats[i + 1].narrativeRole] : null;
      if (!current) {
        current = { bucket, beatIds: [beat.beatId] };
      } else if (bucket !== current.bucket && (nextBucket === bucket || nextBucket === null)) {
        groups.push(current);
        current = { bucket, beatIds: [beat.beatId] };
      } else {
        current.beatIds.push(beat.beatId);
      }
    }
    if (current) groups.push(current);
  }

  // Validate grouping invariants (coverage + ordering) for both paths.
  // A beat MAY appear in multiple scenes when visual explanation genuinely
  // requires it (exchange candidates); every beat must appear at least once.
  const seen = new Set();
  let cursor = 0;
  for (const group of groups) {
    if (!Array.isArray(group.beatIds) || group.beatIds.length === 0) {
      return { ok: false, code: "SCENE_CANDIDATE_INVALID", message: "scene group without beats" };
    }
    for (const id of group.beatIds) {
      if (!byId.has(id)) return { ok: false, code: "SCENE_CANDIDATE_INVALID", message: `unknown beatId ${id}` };
      seen.add(id);
    }
    for (const id of group.beatIds) {
      if (byId.get(id).order < cursor) {
        return { ok: false, code: "SCENE_CANDIDATE_INVALID", message: "scene grouping breaks beat order" };
      }
      cursor = byId.get(id).order;
    }
  }
  if (seen.size !== beatMap.beats.length) {
    return { ok: false, code: "SCENE_CANDIDATE_INVALID", message: "scene grouping does not cover all beats" };
  }

  const sectionsOf = new Map();
  for (const beat of beatMap.beats) {
    if (!sectionsOf.has(beat.storySectionRef)) sectionsOf.set(beat.storySectionRef, []);
  }

  const scenes = groups.map((group, index) => {
    const beats = group.beatIds.map((id) => byId.get(id));
    const claimRefs = [...new Set(beats.flatMap((b) => b.claimRefs || []))];
    const bucket = group.bucket || ROLE_BUCKETS[beats[0].narrativeRole];
    const last = beats[beats.length - 1];
    const prev = index > 0 ? groups[index - 1] : null;
    return {
      sceneId: id12("sc", { projectId: beatMap.projectId, beatIds: group.beatIds.slice().sort(), order: index }),
      order: index,
      beatIds: group.beatIds,
      storySectionRefs: [...new Set(beats.map((b) => b.storySectionRef))],
      claimRefs,
      narrativePurpose: beats.map((b) => b.narrativeRole).join("+").slice(0, 240),
      visualObjective: bucket,
      subjectRefs: [],
      environmentRefs: [],
      continuityGroup: "cg-1",
      stateBefore: prev ? null : "INTRO",
      stateAfter: last.narrativeRole,
      transitionReason: prev
        ? `visual objective turns ${prev.bucket || "?"} -> ${bucket}`
        : "opening situation",
      constraints: [],
    };
  });

  // Lightweight edges only when they carry production meaning (§16).
  const edges = [];
  for (let i = 1; i < scenes.length; i++) {
    const prev = scenes[i - 1];
    const cur = scenes[i];
    let type = "SEQUENCE";
    if (cur.visualObjective === "SHIFT" && prev.visualObjective === "EXPLAIN") type = "REVEAL";
    else if (cur.visualObjective === "SHIFT" && prev.visualObjective === "SHIFT") type = "CONTRAST";
    edges.push({ from: prev.sceneId, to: cur.sceneId, type });
  }

  const sceneGraphId = id12("sg", { projectId: beatMap.projectId, beatMapId: beatMap.beatMapId, sceneIds: scenes.map((s) => s.sceneId) });
  const sceneGraph = {
    version: STRUCTURE_VERSION,
    sceneGraphId,
    projectId: beatMap.projectId,
    platform: beatMap.platform || null,
    contentClass: beatMap.contentClass,
    sourceBeatMapRef: { beatMapId: beatMap.beatMapId, fingerprint: beatMap.fingerprint },
    sourceStoryDraftRef: beatMap.sourceStoryDraftRef,
    scenes,
    edges,
    fingerprint: hash16({ sceneGraphId, scenes: scenes.map((s) => [s.sceneId, s.beatIds, s.visualObjective]) }),
    status: "GENERATED",
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, sceneGraph };
}

module.exports = { buildSceneGraph };
