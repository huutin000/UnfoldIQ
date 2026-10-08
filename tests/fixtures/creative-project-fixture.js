"use strict";

/**
 * Phase 6A shared REAL-lib project fixture: Master Timeline (Phase 3A) + MotionPlan (Phase 3B)
 * built with the production libs, adapted to CreativeInput, with the owning-subsystem
 * executor (real patchMotion) and a Dependency-DAG chain. Used by the repair suite and by
 * scripts/diagnostics/creative-retention-evidence.js — one definition, no drift.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const fx = require("./creative-fixture.js");
const tlfx = require("./timeline-control-fixture.js");
const dag = require("../../lib/dependency-dag/index.js");
const cr = fx.cr;

const DURS = [6000, 9000, 7000, 8000, 5500, 9500, 7500, 7500]; // = 60000ms, 8 beats x 1 shot
const TYPES = [["IMAGE", "as-img1"], ["CHART", "as-cht1"], ["IMAGE", "as-img2"], ["MAP", "as-map1"], ["IMAGE", "as-img1"], ["CHART", "as-cht1"], ["IMAGE", "as-img2"], ["MAP", "as-map1"]];
const ROLES = ["HOOK", "EXPLANATION", "EVIDENCE", "EXPLANATION", "CONTRAST", "EXPLANATION", "EVIDENCE", "PAYOFF"];
const TEXTS = ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8"].map((k) => fx.T[k]);

function buildProject() {
  const reg = tlfx.makeRegistry();
  let t = 0;
  const visualItems = DURS.map((d, i) => {
    const it = { trackType: TYPES[i][0], assetId: TYPES[i][1], startTime: t, endTime: t + d, beatId: `bt${i + 1}`, shotId: `sh${i + 1}`, sceneId: `sc${i + 1}` };
    t += d;
    return it;
  });
  const built = tlfx.tl.buildTimeline({
    projectId: "creative-repair-6a",
    finalAudio: { artifactId: "fa-1", durationMs: 60000, narrationTimingHash: "nth-1", finalMixHash: "fmh-1" },
    narrationSegments: [{ segmentId: "s0", assetId: "as-nar1", startTime: 0, endTime: 60000 }],
    visualItems,
    assetResolver: reg.resolver,
  });
  if (!built.ok) throw new Error("timeline: " + built.message);
  const manifest = built.manifest;
  const intents = {};
  for (const it of manifest.items.filter((i) => i.beatId)) {
    intents[it.timelineItemId] = { purpose: "EMPHASIZE", hasMotionPurpose: true, primitiveRef: "ZOOM", params: { fromScale: 1, toScale: 1.15 }, timingPresetRef: "ease-in-out@1.0.0" };
  }
  const m = tlfx.motion.buildMotionPlan({ projectId: "creative-repair-6a", timelineManifest: manifest, intentsByItem: intents });
  if (!m.ok) throw new Error("motion: " + m.message);
  return { manifest, motionPlan: m.plan };
}

const beatMap = {
  beats: ROLES.map((r, i) => ({ beatId: `bt${i + 1}`, order: i, narrativeRole: r === "PAYOFF" ? "RESOLUTION" : r, summary: TEXTS[i], claimRefs: [] })),
};
const beatTexts = Object.fromEntries(TEXTS.map((t, i) => [`bt${i + 1}`, t]));
const loops = { bt1: { opensLoops: [{ loopId: "L1", question: "how do you keep a baby safe from predators in the dark?", packaging: true }] }, bt8: { resolvesLoops: ["L1"] } };

function adapt(state, extra = {}) {
  const r = cr.adapter.fromCanonical({
    projectId: "creative-repair-6a", contentClass: "FACTUAL", contentMode: "educational-explainer",
    packaging: fx.PACKAGING, beatMap, beatTexts, loops, timelineManifest: state.manifest, motionPlan: state.motionPlan, ...extra,
  });
  if (!r.ok) throw new Error("adapter: " + JSON.stringify(r.errors));
  return r.input;
}
const analyze = (state, extra) => cr.analyzeCreativeRetention(adapt(state, extra));

function chain(root, pid) {
  const N = (key, type, e = {}) => ({ artifactKey: key, artifactType: type, versionRef: "v1", state: "CLEAN", ...e });
  dag.createDag(root, pid);
  dag.addNode(root, pid, N("SCRIPT", "FINAL_SPOKEN_SCRIPT"));
  dag.addNode(root, pid, N("AUDIO", "FINAL_AUDIO", { inputRefs: [{ key: "SCRIPT", type: "reads" }] }));
  dag.addNode(root, pid, N("ALIGN", "FORCED_ALIGNMENT", { inputRefs: [{ key: "AUDIO", type: "aligns" }] }));
  dag.addNode(root, pid, N("CAPTIONS", "CAPTIONS", { inputRefs: [{ key: "AUDIO", type: "transcribes" }, { key: "ALIGN", type: "times" }] }));
  dag.addNode(root, pid, N("SCENE_T", "SCENE_TIMING", { inputRefs: [{ key: "ALIGN", type: "times" }] }));
  dag.addNode(root, pid, N("VIS_T", "VISUAL_TIMING", { inputRefs: [{ key: "ALIGN", type: "times" }] }));
  dag.addNode(root, pid, N("ANIM_T", "ANIMATION_TIMING", { inputRefs: [{ key: "ALIGN", type: "times" }, { key: "VIS_T", type: "syncs" }] }));
  dag.addNode(root, pid, N("TIMELINE", "MASTER_TIMELINE", { inputRefs: [{ key: "CAPTIONS", type: "lays" }, { key: "SCENE_T", type: "lays" }, { key: "VIS_T", type: "lays" }, { key: "ANIM_T", type: "lays" }] }));
  dag.addNode(root, pid, N("RENDER", "RENDER", { inputRefs: [{ key: "TIMELINE", type: "renders" }] }));
}
const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "unfoldiq-6a-repair-"));
const eff = (root, pid, key) => dag.effectiveState(dag.loadDag(root, pid).dag, key);
const states = (root, pid, keys) => Object.fromEntries(keys.map((k) => [k, eff(root, pid, k)]));
const ALL = ["SCRIPT", "AUDIO", "ALIGN", "CAPTIONS", "SCENE_T", "VIS_T", "ANIM_T", "TIMELINE", "RENDER"];

/** Owning-subsystem executor for MOTION_PATCH: real Phase 3B patchMotion, local to the zoom run. */
function applyMotion(plan, state) {
  let motionPlan = state.motionPlan;
  let patched = 0;
  const touched = [];
  for (const step of plan.steps.filter((s) => s.repairClass === "MOTION_PATCH")) {
    const moving = motionPlan.items.filter((i) => i.presence !== "STATIC");
    moving.forEach((item, idx) => {
      if (idx % 3 !== 2) return; // break the streak: every third move becomes static
      const r = tlfx.motion.patchMotion(motionPlan, { patchId: `p-${step.stepId}-${idx}`, op: "SET_STATIC", targetId: item.motionItemId, expectedRevision: motionPlan.revision }, { timelineManifest: state.manifest });
      if (!r.ok) throw new Error("patchMotion: " + r.code);
      motionPlan = r.plan;
      patched += 1;
      touched.push(item.timelineItemId);
    });
  }
  return { state: { ...state, motionPlan, touched: [...(state.touched || []), ...touched] }, renders: patched > 0 ? 1 : 0 };
}

const FPS = 30;
const sceneMapOf = (manifest) => manifest.items.filter((i) => i.beatId).map((i) => ({ sceneId: i.sceneId, startFrame: i.timelineRange.startFrame, endFrameExclusive: i.timelineRange.endFrameExclusive }));


module.exports = { DURS, buildProject, adapt, analyze, chain, tmpRoot, eff, states, ALL, applyMotion, FPS, sceneMapOf, beatMap, beatTexts, loops };
