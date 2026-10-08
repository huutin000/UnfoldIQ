"use strict";

/**
 * Phase 6A shared fixtures: a clean 90s explainer (BASE) plus targeted
 * mutations. Golden assertions check finding code / scope / reason class /
 * corrective-action class — never model prose (§48).
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const cr = require(REPO + "/lib/creative-retention/index.js");

const clone = (o) => JSON.parse(JSON.stringify(o));

const PACKAGING = {
  titleText: "How Early Humans Kept Babies Safe at Night",
  thumbnailText: "SAFE AT NIGHT?",
  titleClaimRefs: ["c-shelter"],
  thumbnailClaimRefs: ["c-shelter"],
  expectedViewerPromise: ["how early humans protected babies at night"],
  openingMustEstablish: ["babies safe night", "early humans"],
  mustNotImply: ["alien visitors"],
};

const T = {
  b1: "Every night, early human parents faced one question: how do you keep a baby safe from predators in the dark?",
  b2: "Archaeologists studying shelter sites found that families slept in tight groups beside rock walls, with the youngest placed in the middle.",
  b3: "Charred hearths at these sites show that fires burned through the night, and animal tracks stop well outside the ring of ashes.",
  b4: "Fire gave warmth and light, but it also served as a boundary that most predators learned to avoid.",
  b5: "But fire alone could not explain everything, because some sites show no hearths at all.",
  b6: "At those sites, researchers found evidence of rotating watches, where one adult stayed awake while the group slept.",
  b7: "Skeletal studies suggest adults of different ages shared this duty, protecting the young in turns.",
  b8: "So the answer was not one trick but a system: fire, shelter, and a watchful tribe working together.",
  b9: "Raising a child really did take a village, even in the dark.",
};

const BEATS = [
  ["b1", "HOOK", 0, 7000, { narrativeEnergy: 0.5, opensLoops: [{ loopId: "L1", question: "how do you keep a baby safe from predators in the dark?", packaging: true }] }],
  ["b2", "EXPLANATION", 7000, 17000, { narrativeEnergy: 0.3 }],
  ["b3", "EVIDENCE", 17000, 28000, { narrativeEnergy: 0.35 }],
  ["b4", "EXPLANATION", 28000, 40000, { narrativeEnergy: 0.4 }],
  ["b5", "CONTRAST", 40000, 50000, { narrativeEnergy: 0.55 }],
  ["b6", "EXPLANATION", 50000, 62000, { narrativeEnergy: 0.4 }],
  ["b7", "EVIDENCE", 62000, 72000, { narrativeEnergy: 0.45 }],
  ["b8", "PAYOFF", 72000, 82000, { narrativeEnergy: 0.75, resolvesLoops: ["L1"] }],
  ["b9", "REFLECTION", 82000, 90000, { narrativeEnergy: 0.3 }],
];

// [id, beat, start, end, modality, primitive, purpose, direction, timing, framing, intensity, extra]
const SHOTS = [
  ["s1", "b1", 0, 3800, "IMAGE", "ZOOM", "DIRECT_ATTENTION", "IN", "ease-in-out", "WIDE", 0.25, { visualMeaning: "cave mouth at night" }],
  ["s2", "b1", 3800, 7000, "VEO", null, null, null, null, "CLOSE", 0.6, { generativeMotionNeeded: true }],
  ["s3", "b2", 7000, 13500, "IMAGE", "PAN", "REVEAL_INFORMATION", "RIGHT", "linear", "MEDIUM", 0.25, {}],
  ["s4", "b2", 13500, 17000, "DIAGRAM", "DIAGRAM_STEP_REVEAL", "EXPLAIN_STRUCTURE", null, "ease-out", "TOP", 0.25, {}],
  ["s5", "b3", 17000, 22500, "IMAGE", null, null, null, null, "CLOSE", 0, {}],
  ["s6", "b3", 22500, 28000, "CHART", "CHART_REVEAL", "REVEAL_INFORMATION", null, "ease-in-out", "FLAT", 0.25, {}],
  ["s7", "b4", 28000, 34000, "VEO", null, null, null, null, "CLOSE", 0.6, { generativeMotionNeeded: true }],
  ["s8", "b4", 34000, 40000, "IMAGE", "PUSH", "BUILD_ENERGY", "IN", "ease-out", "MEDIUM", 0.45, {}],
  ["s9", "b5", 40000, 45000, "IMAGE", null, null, null, null, "WIDE", 0, {}],
  ["s10", "b5", 45000, 50000, "MAP", "PATH_DRAW", "EXPLAIN_STRUCTURE", "RIGHT", "linear", "TOP", 0.25, {}],
  ["s11", "b6", 50000, 56500, "IMAGE", "PAN", "FOLLOW_SUBJECT", "LEFT", "ease-in-out", "MEDIUM", 0.25, {}],
  ["s12", "b6", 56500, 62000, "IMAGE", null, null, null, null, "CLOSE", 0, {}],
  ["s13", "b7", 62000, 67000, "CHART", "CHART_HIGHLIGHT", "EMPHASIZE", null, "ease-out", "FLAT", 0.25, {}],
  ["s14", "b7", 67000, 72000, "IMAGE", null, null, null, null, "WIDE", 0, {}],
  ["s15", "b8", 72000, 77500, "IMAGE", "REVEAL", "REVEAL_INFORMATION", "UP", "ease-in-out", "WIDE", 0.45, {}],
  ["s16", "b8", 77500, 82000, "DIAGRAM", "DIAGRAM_STEP_REVEAL", "EXPLAIN_STRUCTURE", null, "linear", "TOP", 0.25, {}],
  ["s17", "b9", 82000, 90000, "IMAGE", "PULL", "DIRECT_ATTENTION", "OUT", "ease-out", "MEDIUM", 0.25, {}],
];

function baseRaw() {
  return {
    projectId: "creative-validation",
    contentClass: "FACTUAL",
    contentMode: "educational-explainer",
    durationMs: 90000,
    packaging: clone(PACKAGING),
    beats: BEATS.map(([beatId, role, startMs, endMs, x], i) => ({ beatId, order: i, role, startMs, endMs, text: T[beatId], sceneId: `sc-${beatId}`, ...clone(x) })),
    shots: SHOTS.map(([shotId, beatId, startMs, endMs, modality, motionPrimitive, motionPurpose, motionDirection, timingPreset, framing, motionIntensity, extra]) => ({
      shotId, beatId, sceneId: `sc-${beatId}`, startMs, endMs, modality,
      ...(motionPrimitive ? { motionPrimitive, motionPurpose, motionDirection: motionDirection || undefined, timingPreset, isStatic: false } : { isStatic: true }),
      framing, motionIntensity, ...clone(extra),
    })),
    captions: BEATS.map(([beatId, , startMs, endMs]) => ({ startMs, endMs, text: T[beatId] })),
    onScreen: [
      { startMs: 1000, endMs: 4000, text: "EARLY HUMANS" },
      { startMs: 28500, endMs: 33500, text: "FIRE = BOUNDARY" },
      { startMs: 72500, endMs: 77000, text: "THE ANSWER: A SYSTEM" },
    ],
    music: [
      { startMs: 0, endMs: 30000, energy: 0.35 },
      { startMs: 30000, endMs: 62000, energy: 0.45 },
      { startMs: 62000, endMs: 72000, energy: 0.55 },
      { startMs: 72000, endMs: 82000, energy: 0.7 },
      { startMs: 82000, endMs: 90000, energy: 0.3 },
    ],
    sfx: [],
    intentionalSilence: [],
  };
}

const beat = (raw, id) => raw.beats.find((b) => b.beatId === id);
const shot = (raw, id) => raw.shots.find((s) => s.shotId === id);
function setText(raw, id, text) {
  beat(raw, id).text = text;
  const c = raw.captions.find((x) => x.startMs === beat(raw, id).startMs);
  if (c) c.text = text;
}

function analyze(raw, opts) {
  const a = cr.analyzeCreativeRetention(raw, opts);
  if (!a.ok) throw new Error("fixture analysis failed: " + JSON.stringify(a.errors || a.code));
  return a;
}

/** Small custom input for hook-focused cases. beats: [[id, role, start, end, text, extra?]] */
function mini({ beats, packaging, durationMs, contentMode = "educational-explainer", shots = null, music = [] }) {
  const raw = {
    projectId: "creative-mini", contentClass: "FACTUAL", contentMode,
    durationMs: durationMs || beats[beats.length - 1][3],
    packaging: { ...clone(PACKAGING), ...(packaging || {}) },
    beats: beats.map(([beatId, role, startMs, endMs, text, x], i) => ({ beatId, order: i, role, startMs, endMs, text, ...(x || {}) })),
    captions: beats.map(([, , startMs, endMs, text]) => ({ startMs, endMs, text })),
    music,
  };
  raw.shots = shots || raw.beats.map((b, i) => ({
    shotId: `m${i}`, beatId: b.beatId, startMs: b.startMs, endMs: b.endMs, modality: ["IMAGE", "CHART", "MAP", "DIAGRAM"][i % 4], isStatic: true, framing: ["WIDE", "CLOSE", "MEDIUM", "TOP"][i % 4],
  }));
  return raw;
}

const codes = (a) => a.findings.map((f) => f.code);
const open = (a) => a.findings.filter((f) => f.status === "OPEN");

// ---------------------------------------------------------------- golden set (§48)
const NEUTRAL = {
  b1: "Welcome back to the channel everyone, before we start please like and subscribe and ring the bell for more.",
  b2: "Archaeologists studying shelter sites found that families slept in tight groups beside rock walls, with the youngest placed in the middle.",
  b3: "Charred hearths at these sites show that fires burned until dawn, and animal tracks stop well outside the ring of ashes.",
  b4: "Fire gave warmth and light, but it also served as a boundary that most predators learned to avoid.",
  b5: "But fire alone could not explain everything, because some sites show no hearths at all.",
};

const GOLDEN = [
  {
    name: "good-hook",
    build: () => baseRaw(),
    expect: { present: [], absent: ["HOOK_NO_CLEAR_VALUE", "HOOK_SETUP_TOO_LONG", "HOOK_REPEATS_PACKAGING", "HOOK_PROMISE_DELAYED", "HOOK_PROMISE_MISMATCH", "HOOK_OVERLOADED", "HOOK_CONFUSING", "PACKAGING_PROMISE_DELAYED", "DROPPED_PAYOFF", "BEAT_NO_PROGRESS", "DEAD_TIME_RISK"] },
  },
  {
    name: "delayed-hook",
    build: () => {
      const r = baseRaw();
      beat(r, "b1").role = "BRAND_INTRO";
      beat(r, "b1").opensLoops = [];
      beat(r, "b8").resolvesLoops = [];
      for (const k of ["b1", "b2", "b3", "b4", "b5"]) setText(r, k, NEUTRAL[k]);
      setText(r, "b6", "Researchers studying early humans found evidence of rotating watches that kept babies safe at night, where one adult stayed awake while the group slept.");
      return r;
    },
    expect: { present: [{ code: "HOOK_SETUP_TOO_LONG", scope: "HOOK", reasonClass: "BRAND_PREAMBLE", repairClass: "OPENING_EDIT" }, { code: "PACKAGING_PROMISE_DELAYED", scope: "PACKAGING", reasonClass: "PROMISE_LATE", repairClass: "OPENING_EDIT" }], absent: [] },
  },
  {
    name: "packaging-promise-mismatch",
    build: () => {
      const r = baseRaw();
      r.packaging.openingMustEstablish = ["volcano eruption survival", "early humans"];
      return r;
    },
    expect: { present: [{ code: "HOOK_PROMISE_MISMATCH", scope: "PACKAGING", reasonClass: "PROMISE_NOT_DELIVERED", repairClass: "PACKAGING_REVISION" }], absent: ["PACKAGING_PROMISE_DELAYED"] },
  },
  {
    name: "redundant-beats",
    build: () => {
      const r = baseRaw();
      setText(r, "b4", T.b3);
      return r;
    },
    expect: { present: [{ code: "NARRATIVE_REDUNDANCY", scope: "BEAT", reasonClass: "SEMANTIC_REPEAT", repairClass: "SCRIPT_TRIM" }], absent: [] },
  },
  {
    name: "dropped-payoff",
    build: () => {
      const r = baseRaw();
      beat(r, "b8").resolvesLoops = [];
      return r;
    },
    expect: { present: [{ code: "DROPPED_PAYOFF", scope: "BEAT", reasonClass: "LOOP_NEVER_RESOLVED", repairClass: "SCRIPT_REWRITE" }], absent: [] },
  },
  {
    name: "intentional-slow-beat",
    build: () => {
      const r = baseRaw();
      setText(r, "b5", "The fire burned.");
      Object.assign(beat(r, "b5"), { role: "REFLECTION", intent: { slow: true, atmosphere: true } });
      return r;
    },
    expect: { present: [], absent: ["DEAD_TIME_RISK", "BEAT_NO_PROGRESS", "BEAT_TOO_LONG", "NARRATIVE_REDUNDANCY"] },
  },
  {
    name: "true-dead-time",
    build: () => {
      const r = baseRaw();
      setText(r, "b5", "The fire burned.");
      beat(r, "b5").role = "CONTEXT";
      delete beat(r, "b5").narrativeEnergy;
      r.music = [];
      return r;
    },
    expect: { present: [{ code: "DEAD_TIME_RISK", scope: "BEAT", reasonClass: "NO_USEFUL_CONTENT", repairClass: "BEAT_RETIME_OR_SPLIT" }], absent: [] },
  },
  {
    name: "repetitive-zoom",
    build: () => {
      const r = baseRaw();
      ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].forEach((id, i) => {
        Object.assign(shot(r, id), { modality: "IMAGE", motionPrimitive: i % 2 ? "ZOOM" : "PUSH", motionPurpose: "DIRECT_ATTENTION", motionDirection: "IN", isStatic: false, motionIntensity: 0.3, generativeMotionNeeded: undefined });
      });
      return r;
    },
    expect: { present: [{ code: "REPETITIVE_MOTION_RHYTHM", scope: "SHOT", reasonClass: "CONSTANT_ZOOM", repairClass: "MOTION_PATCH" }], absent: [] },
  },
  {
    name: "purposeful-static-rest",
    build: () => {
      const r = baseRaw();
      // three quiet static shots across b5–b7, distinct durations/framing, declared rest
      [["s9", "WIDE"], ["s12", "CLOSE"], ["s14", "MEDIUM"]].forEach(([id, f]) => { Object.assign(shot(r, id), { restIntent: true, isStatic: true, framing: f }); });
      return r;
    },
    expect: { present: [], absent: ["REPETITIVE_MOTION_RHYTHM", "MOTION_TOO_REPETITIVE", "VISUAL_TOO_REPETITIVE", "MOTION_WITHOUT_EDITORIAL_VALUE", "DEAD_TIME_RISK", "FRAMING_REPETITION"] },
  },
  {
    name: "modality-monotony",
    build: () => {
      const r = baseRaw();
      ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"].forEach((id) => { Object.assign(shot(r, id), { modality: "IMAGE", generativeMotionNeeded: undefined }); });
      return r;
    },
    expect: { present: [{ code: "MODALITY_MONOTONY", scope: "GLOBAL", reasonClass: "MODALITY_PATTERN", repairClass: "ASSET_MODALITY_REPLACE" }], absent: [] },
  },
  {
    name: "caption-motion-overload",
    build: () => {
      const r = baseRaw();
      Object.assign(r.captions.find((c) => c.startMs === 17000), { endMs: 21000, text: "Charred hearths at these sites show that fires burned through the night and animal tracks stop outside the ash ring." });
      Object.assign(shot(r, "s5"), { motionPrimitive: "HANDHELD", motionPurpose: "BUILD_ENERGY", isStatic: false, motionIntensity: 0.85 });
      return r;
    },
    expect: { present: [{ code: "CAPTION_MOTION_OVERLOAD", scope: "CAPTION", reasonClass: "READING_LOAD", repairClass: "CAPTION_MOTION_REDUCTION" }], absent: [] },
  },
  {
    name: "music-energy-mismatch",
    build: () => {
      const r = baseRaw();
      r.music = r.music.map((m) => (m.startMs === 0 ? { startMs: 0, endMs: 30000, energy: 0.95 } : m));
      return r;
    },
    expect: { present: [{ code: "MUSIC_ENERGY_MISMATCH", scope: "AUDIO", reasonClass: "ENERGY_MISMATCH", repairClass: "MUSIC_MIX_PATCH" }], absent: [] },
  },
];

/** Minimal runner matching the repo's custom suites (exit 1 on any failure). */
function harness(domainName) {
  let passed = 0;
  let failed = 0;
  const assert = (c, m) => { if (!c) throw new Error("ASSERTION FAILED: " + m); console.log("  ok  " + m); };
  const assertEq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`ASSERTION FAILED: ${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); console.log("  ok  " + m); };
  const queue = [];
  const runTest = (name, fn) => queue.push([name, fn]);
  const done = async () => {
    for (const [name, fn] of queue) {
      console.log("[TEST] " + name);
      try { await fn(); passed += 1; console.log("[PASS] " + name); } catch (e) { failed += 1; console.log("[FAIL] " + name + " — " + e.message); }
    }
    console.log(`
=== ${domainName}: ${failed} failed, ${passed} passed ===`);
    process.exit(failed > 0 ? 1 : 0);
  };
  return { assert, assertEq, runTest, done };
}

module.exports = { harness, REPO, cr, clone, PACKAGING, T, BEATS, SHOTS, baseRaw, beat, shot, setText, analyze, mini, codes, open, GOLDEN, NEUTRAL };
