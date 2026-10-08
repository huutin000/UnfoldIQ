"use strict";

/**
 * Phase 6A — CreativeInput adapters (UNFOLDIQ CORE).
 *
 * Adapters READ canonical artifacts; they never author new truth.
 *   fromCanonical      Beat Map / Scene Graph / Shot Plan / Master Timeline /
 *                      MotionPlan / Captions / Music Plan (Phase 1G–3)
 *   fromLegacyProject  pre-Phase-3 projects (scene-script + render-plan +
 *                      captions) — e.g. the published pilot-sky-blue
 */

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { normalizeInput } = require("./input.js");

const INTENSITY_BY_PRESENCE = { STATIC: 0, SUBTLE: 0.25, ACTIVE: 0.55, FEATURED: 0.85 };
const ENERGY_LABEL = { LOW: 0.25, MEDIUM: 0.5, MED: 0.5, HIGH: 0.8 };
const MODALITY_BY_TRACK = { VIDEO: "VIDEO", IMAGE: "IMAGE", CHART: "CHART", MAP: "MAP", DIAGRAM: "DIAGRAM", OVERLAY: "OVERLAY", TITLE: "TITLE" };

function numEnergy(v) {
  if (Number.isFinite(v)) return Math.max(0, Math.min(1, v));
  if (typeof v === "string" && ENERGY_LABEL[v.toUpperCase()] !== undefined) return ENERGY_LABEL[v.toUpperCase()];
  return 0.5;
}

function directionOf(item) {
  const p = item.params || {};
  if (p.direction) return String(p.direction).toUpperCase();
  if (Number.isFinite(p.fromX) && Number.isFinite(p.toX) && p.fromX !== p.toX) return p.toX > p.fromX ? "RIGHT" : "LEFT";
  if (Number.isFinite(p.fromScale) && Number.isFinite(p.toScale) && p.fromScale !== p.toScale) return p.toScale > p.fromScale ? "IN" : "OUT";
  return null;
}

/**
 * fromCanonical({
 *   projectId, contentClass, contentMode?, packaging, durationMs?,
 *   beatMap, sceneGraph?, shotPlan?, timelineManifest, motionPlan?,
 *   beatTexts?: {beatId: fullSpokenText}, captions?, onScreen?, musicPlan?, sfx?,
 *   intentionalSilence?, beatIntents?: {beatId: intent}, loops?: {beatId: {opensLoops, resolvesLoops}},
 *   assetInfo?: (assetId) => ({ generator?: "VEO"|"IMAGE"|..., visualMeaning?, chartComplexity?, trend? }),
 *   video?
 * })
 */
function fromCanonical(a) {
  const tl = a.timelineManifest;
  if (!a.beatMap || !tl || !Array.isArray(tl.items)) return { ok: false, code: "CREATIVE_INPUT_INVALID", errors: ["beatMap + timelineManifest required"] };
  const motionByItem = new Map(((a.motionPlan && a.motionPlan.items) || []).map((m) => [m.timelineItemId, m]));
  const transByTo = new Map(((a.motionPlan && a.motionPlan.transitions) || []).map((t) => [t.toTimelineItemId, t]));
  const shotById = new Map(((a.shotPlan && a.shotPlan.shots) || []).map((s) => [s.shotId, s]));
  const sceneOfBeat = new Map();
  for (const sc of ((a.sceneGraph && a.sceneGraph.scenes) || [])) for (const b of sc.beatIds) if (!sceneOfBeat.has(b)) sceneOfBeat.set(b, sc.sceneId);
  const info = a.assetInfo || (() => ({}));

  const visual = tl.items.filter((i) => MODALITY_BY_TRACK[i.trackType]);
  const beats = [];
  for (const b of a.beatMap.beats) {
    const own = tl.items.filter((i) => i.beatId === b.beatId);
    if (own.length === 0) continue;
    const startMs = Math.min(...own.map((i) => i.timelineRange.startTime));
    const endMs = Math.max(...own.map((i) => i.timelineRange.endTime));
    const extra = (a.loops && a.loops[b.beatId]) || {};
    beats.push({
      beatId: b.beatId, order: b.order, role: b.narrativeRole, startMs, endMs,
      text: (a.beatTexts && a.beatTexts[b.beatId]) || b.summary || "",
      claimRefs: b.claimRefs, sceneId: sceneOfBeat.get(b.beatId) || null,
      intent: (a.beatIntents && a.beatIntents[b.beatId]) || {},
      ...extra,
    });
  }
  const shots = [];
  for (const it of visual) {
    const m = motionByItem.get(it.timelineItemId);
    const sp = it.shotId ? shotById.get(it.shotId) : null;
    const ai = info(it.assetId) || {};
    const moving = m && m.presence !== "STATIC" && m.primitiveRef;
    const tr = transByTo.get(it.timelineItemId);
    shots.push({
      shotId: it.shotId || it.timelineItemId,
      timelineItemId: it.timelineItemId,
      beatId: it.beatId || null,
      sceneId: it.sceneId || (sp && sp.parentSceneId) || null,
      startMs: it.timelineRange.startTime, endMs: it.timelineRange.endTime,
      modality: ai.generator === "VEO" ? "VEO" : MODALITY_BY_TRACK[it.trackType],
      framing: sp && sp.framingIntent ? String(sp.framingIntent) : ai.framing || undefined,
      motionPrimitive: moving ? m.primitiveRef : undefined,
      motionDirection: moving ? directionOf(m) || undefined : undefined,
      timingPreset: moving ? m.timingPresetRef : undefined,
      motionPurpose: m ? (m.purpose || undefined) : undefined,
      motionLayer: m ? m.layer : undefined,
      motionIntensity: m ? INTENSITY_BY_PRESENCE[m.presence] : undefined,
      isStatic: m ? m.presence === "STATIC" : undefined,
      restIntent: m && m.purpose === "VISUAL_REST" ? true : undefined,
      visualMeaning: ai.visualMeaning, chartComplexity: ai.chartComplexity, trend: ai.trend,
      generativeMotionNeeded: ai.generativeMotionNeeded, visualNeed: ai.visualNeed,
      transitionIn: tr ? tr.primitiveRef : undefined, cutMotivation: tr ? tr.cutMotivation || undefined : undefined,
    });
  }
  const music = ((a.musicPlan && a.musicPlan.cues) || []).map((c) => ({ startMs: c.timelineStartMs, endMs: c.timelineEndMs, energy: numEnergy(c.energy) }));
  return normalizeInput({
    projectId: a.projectId, contentClass: a.contentClass, contentMode: a.contentMode, hookClass: a.hookClass,
    durationMs: a.durationMs || (tl.canonicalDuration && tl.canonicalDuration.time),
    packaging: a.packaging, beats, shots, captions: a.captions, onScreen: a.onScreen, music, sfx: a.sfx, intentionalSilence: a.intentionalSilence, video: a.video,
  });
}

const PURPOSE_ROLE = [[/hook|question/, "HOOK"], [/setup|context/, "SETUP"], [/misconception|correction|contrast/, "CONTRAST"], [/proof|evidence/, "EVIDENCE"], [/payoff|conclusion|resolution/, "PAYOFF"], [/mechanism|explain/, "EXPLANATION"]];

function readJson(p) { return JSON.parse(fs.readFileSync(p, "utf8")); }

/**
 * Legacy (pre-Phase-3) project: scene-script.json + render/render-plan.json +
 * captions/captions.json. Visuals are what the render plan declares — for
 * pilot-sky-blue: one static title card per scene (no motion plan exists).
 */
function fromLegacyProject(root, projectId, extra = {}) {
  const dir = path.join(root, "projects", projectId);
  const script = readJson(path.join(dir, "scene-script.json"));
  const plan = readJson(path.join(dir, "render", "render-plan.json"));
  const capPath = path.join(dir, "captions", "captions.json");
  const captions = fs.existsSync(capPath) ? readJson(capPath).items.map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: c.text })) : [];
  const fps = plan.composition.fps;
  const f2ms = (f) => Math.round((f / fps) * 1000);
  const beats = script.scenes.map((s, i) => {
    const purpose = String(s.purpose || "").toLowerCase();
    const role = (PURPOSE_ROLE.find(([re]) => re.test(purpose)) || [null, "EXPLANATION"])[1];
    return { beatId: s.sceneId, sceneId: s.sceneId, order: i, role: i === 0 ? "HOOK" : role, startMs: s.timing.startMs, endMs: s.timing.endMs, text: s.narration, emotion: s.emotionIntent, ...(extra.beatPatches && extra.beatPatches[s.sceneId] || {}) };
  });
  // the last scene's captions can outlast the declared scene end; clamp beats to the composition
  const shots = plan.scenes.map((s) => {
    const textLayer = (s.layers || []).find((l) => l.kind === "TEXT");
    const dur = { startMs: f2ms(s.startFrame), endMs: f2ms(s.endFrame) };
    return {
      shotId: `${s.sceneId}-card`, beatId: s.sceneId, sceneId: s.sceneId, ...dur,
      modality: "TITLE", framing: "CENTERED_TITLE_CARD", isStatic: true, motionIntensity: 0,
      onScreenText: textLayer ? textLayer.text : undefined,
      ...(extra.shotPatches && extra.shotPatches[s.sceneId] || {}),
    };
  });
  const video = extra.videoPath ? { path: extra.videoPath } : null;
  return normalizeInput({
    projectId, contentClass: extra.contentClass || "FACTUAL", contentMode: extra.contentMode || "educational-explainer",
    durationMs: plan.composition.durationMs, packaging: extra.packaging, beats, shots, captions, music: extra.music, sfx: extra.sfx, video,
  });
}

/** ffprobe-backed duration probe (injected into the watch pass; read-only). */
function probeVideoDurationMs(file) {
  const r = childProcess.spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8", timeout: 30000 });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${(r.stderr || "").slice(-200)}`);
  return Math.round(parseFloat(r.stdout.trim()) * 1000);
}

module.exports = { fromCanonical, fromLegacyProject, probeVideoDurationMs, numEnergy };
