"use strict";

/**
 * Persistence + staleness for 1G.3 structural artifacts (§35, §36, §38).
 *
 * Layout (existing project artifact convention, atomic tmp+rename):
 *   projects/<projectId>/planning/beat-map.json
 *   projects/<projectId>/planning/scene-graph.json
 *   projects/<projectId>/planning/shot-plan.json
 *
 * Staleness dependency graph:
 *   Story Draft changed -> Beat Map stale -> Scene Graph stale -> Shot Plan stale
 *   Beat Map changed    -> Scene Graph stale -> Shot Plan stale
 *   Scene Graph changed -> Shot Plan stale
 * Upstream evidence artifacts are never invalidated here.
 *
 * Manual override contract (§38): GENERATED | REVIEWED | APPROVED | STALE.
 * Approved artifacts are not silently overwritten — a re-planning run against
 * APPROVED artifacts returns PLANNING_LOCKED unless force: true.
 */

const fs = require("fs");
const path = require("path");
const artifactStore = require("../../providers/runtime/artifact-store.js");

const FILES = {
  beatMap: "planning/beat-map.json",
  sceneGraph: "planning/scene-graph.json",
  shotPlan: "planning/shot-plan.json",
};

function persistPlanning(root, projectId, artifacts = {}) {
  const written = [];
  try {
    for (const [key, rel] of Object.entries(FILES)) {
      const doc = artifacts[key];
      if (!doc) continue;
      const existing = loadPlanningFile(root, projectId, rel);
      if (existing.ok && existing.doc && existing.doc.status === "APPROVED" && artifacts.force !== true) {
        return { ok: false, code: "PLANNING_LOCKED", message: `${rel} is APPROVED; use force to re-plan`, written };
      }
      artifactStore.writeArtifactAtomic(root, projectId, rel, JSON.stringify(doc, null, 2));
      written.push(rel);
    }
    return { ok: true, written };
  } catch (e) {
    return { ok: false, code: "PLANNING_PERSIST_FAILED", message: String((e && e.message) || e), written };
  }
}

function loadPlanningFile(root, projectId, rel) {
  try {
    if (!artifactStore.artifactExists(root, projectId, rel)) return { ok: true, doc: null };
    return { ok: true, doc: JSON.parse(artifactStore.readArtifact(root, projectId, rel).toString("utf8")) };
  } catch (e) {
    return { ok: false, code: "PLANNING_LOAD_FAILED", message: String((e && e.message) || e) };
  }
}

function loadPlanning(root, projectId) {
  const out = {};
  for (const [key, rel] of Object.entries(FILES)) {
    const loaded = loadPlanningFile(root, projectId, rel);
    if (!loaded.ok) return loaded;
    out[key] = loaded.doc;
  }
  return { ok: true, ...out };
}

/**
 * Detect staleness of persisted structural artifacts against the CURRENT
 * story draft. Returns { stale, staleLayers[], chain } — the dependency graph
 * never invalidates unrelated upstream evidence.
 */
function checkStructureStaleness(root, projectId, currentStoryDraft) {
  const loaded = loadPlanning(root, projectId);
  if (!loaded.ok) return { stale: false, staleLayers: [], chain: {} };
  const chain = {
    beatMap: false,
    sceneGraph: false,
    shotPlan: false,
  };
  const staleLayers = [];
  const bm = loaded.beatMap;
  if (!bm) return { stale: false, staleLayers, chain };
  if (!bm.sourceStoryDraftRef || bm.sourceStoryDraftRef.draftId !== currentStoryDraft.draftId) {
    chain.beatMap = true;
    staleLayers.push("beatMap");
  }
  const sg = loaded.sceneGraph;
  if (sg) {
    const bmStale = chain.beatMap || (sg.sourceBeatMapRef && sg.sourceBeatMapRef.fingerprint !== bm.fingerprint);
    if (bmStale || (sg.sourceBeatMapRef && sg.sourceBeatMapRef.beatMapId !== bm.beatMapId)) {
      chain.sceneGraph = true;
      staleLayers.push("sceneGraph");
    }
  }
  const sp = loaded.shotPlan;
  if (sp) {
    const sgStale = chain.sceneGraph || (sp.sourceSceneGraphRef && sg && sp.sourceSceneGraphRef.fingerprint !== sg.fingerprint);
    if (sgStale || (sp.sourceSceneGraphRef && sg && sp.sourceSceneGraphRef.sceneGraphId !== sg.sceneGraphId)) {
      chain.shotPlan = true;
      staleLayers.push("shotPlan");
    }
  }
  return { stale: staleLayers.length > 0, staleLayers, chain };
}

/** Mark persisted artifacts STALE (explicit invalidation, §38). */
function markStale(root, projectId, layers) {
  for (const [key, rel] of Object.entries(FILES)) {
    if (layers && !layers.includes(key)) continue;
    const loaded = loadPlanningFile(root, projectId, rel);
    if (loaded.ok && loaded.doc) {
      loaded.doc.status = "STALE";
      loaded.doc.updatedAt = new Date().toISOString();
      artifactStore.writeArtifactAtomic(root, projectId, rel, JSON.stringify(loaded.doc, null, 2));
    }
  }
  return { ok: true };
}

module.exports = { FILES, persistPlanning, loadPlanning, loadPlanningFile, checkStructureStaleness, markStale };
