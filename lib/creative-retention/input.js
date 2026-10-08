"use strict";

/**
 * Phase 6A — CreativeInput normalization (UNFOLDIQ CORE).
 *
 * One normalized, serializable view over the existing artifacts (Beat Map /
 * Scene Graph / Shot Plan / Master Timeline / MotionPlan / Captions / Music
 * Plan / Packaging claims). It carries NO new source of truth: every field is
 * derived by an adapter from canonical state or supplied directly by a caller.
 *
 *   CreativeInput {
 *     projectId, contentClass, contentMode?, hookClass, durationMs,
 *     packaging { titleText, thumbnailText?, titleClaimRefs[], thumbnailClaimRefs[],
 *                 expectedViewerPromise[], openingMustEstablish[], mustNotImply[] },
 *     beats[]    { beatId, order, role, startMs, endMs, text, claimRefs?, sceneId?, shotIds?,
 *                  opensLoops?[{loopId,question,packaging?,deferTo?,deferReason?}], resolvesLoops?[],
 *                  emotion?, narrativeEnergy?(0..1), visualMeaning?, newInfoCount?,
 *                  intent?{recap,slow,rest,atmosphere,previewPayoff} },
 *     shots[]    { shotId, beatId?, sceneId?, startMs, endMs, modality, framing?, motionPrimitive?,
 *                  motionDirection?, timingPreset?, motionPurpose?, motionLayer?, motionIntensity?(0..1),
 *                  isStatic?, restIntent?, visualMeaning?, transitionIn?, generativeMotionNeeded?,
 *                  chartComplexity?(0..1), overlayCount?, onScreenText? },
 *     captions[] / onScreen[] { startMs, endMs, text },
 *     narration[] { startMs, endMs, text },         // defaults to captions, then beats
 *     music[] { startMs, endMs, energy(0..1) }, sfx[] { atMs, kind },
 *     intentionalSilence[] { startMs, endMs },
 *     video? { path, sha256, durationMs }
 *   }
 */

const { sha16 } = require("./contract.js");

const BEAT_ROLES = ["HOOK", "SETUP", "CONTEXT", "QUESTION", "ESCALATION", "EVIDENCE", "EXPLANATION", "REVEAL", "PAYOFF", "CONTRAST", "TRANSITION", "REFLECTION", "CTA", "OUTRO", "BRAND_INTRO"];
const ROLE_ALIASES = { RESOLUTION: "PAYOFF", DISPUTE: "CONTRAST", INTRO: "SETUP", CONCLUSION: "PAYOFF", CLOSING: "OUTRO", RECAP: "REFLECTION" };

const HOOK_CLASSES = ["DOCUMENTARY", "EXPLAINER", "TUTORIAL", "STORY", "COMPARISON", "HYBRID", "FICTION"];

const MODE_TO_HOOK_CLASS = {
  "historical-documentary": "DOCUMENTARY",
  "urban-legend-documentary": "DOCUMENTARY",
  "paranormal-documentary": "DOCUMENTARY",
  "educational-explainer": "EXPLAINER",
  "technical-explainer": "EXPLAINER",
  "news-explainer": "EXPLAINER",
  "data-explainer": "EXPLAINER",
  commentary: "EXPLAINER",
  tutorial: "TUTORIAL",
  comparison: "COMPARISON",
  listicle: "COMPARISON",
  "product-review": "COMPARISON",
  "original-story": "STORY",
  "cinematic-fiction": "FICTION",
  "horror-fiction": "FICTION",
};

function resolveHookClass(contentClass, contentMode, explicit) {
  if (explicit && HOOK_CLASSES.includes(explicit)) return explicit;
  if (contentMode && MODE_TO_HOOK_CLASS[contentMode]) return MODE_TO_HOOK_CLASS[contentMode];
  if (contentClass === "FICTION") return "FICTION";
  if (contentClass === "HYBRID") return "HYBRID";
  return "EXPLAINER";
}

function normalizeRole(role) {
  const r = String(role || "").toUpperCase();
  if (BEAT_ROLES.includes(r)) return r;
  if (ROLE_ALIASES[r]) return ROLE_ALIASES[r];
  return "CONTEXT";
}

const num = (v, d) => (Number.isFinite(v) ? v : d);

function normalizeInput(raw = {}) {
  const errors = [];
  if (!raw.projectId) errors.push("projectId required");
  if (!Array.isArray(raw.beats) || raw.beats.length === 0) errors.push("beats[] required");
  if (errors.length) return { ok: false, code: "CREATIVE_INPUT_INVALID", errors };

  const beats = raw.beats
    .map((b, i) => ({
      ...b,
      order: Number.isFinite(b.order) ? b.order : i,
      role: normalizeRole(b.role),
      text: String(b.text || ""),
      startMs: num(b.startMs, 0),
      endMs: num(b.endMs, 0),
      opensLoops: Array.isArray(b.opensLoops) ? b.opensLoops : [],
      resolvesLoops: Array.isArray(b.resolvesLoops) ? b.resolvesLoops : [],
      intent: b.intent || {},
    }))
    .sort((a, b) => a.startMs - b.startMs || a.order - b.order);
  for (const b of beats) {
    if (!b.beatId) errors.push("beat without beatId");
    if (!(b.endMs > b.startMs)) errors.push(`beat ${b.beatId}: endMs must exceed startMs`);
  }
  const shots = (raw.shots || [])
    .map((s) => ({ ...s, startMs: num(s.startMs, 0), endMs: num(s.endMs, 0), modality: String(s.modality || "IMAGE").toUpperCase() }))
    .sort((a, b) => a.startMs - b.startMs);
  for (const s of shots) {
    if (!s.shotId) errors.push("shot without shotId");
    if (!(s.endMs > s.startMs)) errors.push(`shot ${s.shotId}: endMs must exceed startMs`);
  }
  if (errors.length) return { ok: false, code: "CREATIVE_INPUT_INVALID", errors };

  const captions = (raw.captions || []).map((c) => ({ startMs: c.startMs, endMs: c.endMs, text: String(c.text || "") }));
  const narration = (raw.narration && raw.narration.length ? raw.narration : (captions.length ? captions : beats.map((b) => ({ startMs: b.startMs, endMs: b.endMs, text: b.text }))))
    .map((u) => ({ startMs: u.startMs, endMs: u.endMs, text: String(u.text || "") }));
  const onScreen = [
    ...(raw.onScreen || []),
    ...shots.filter((s) => s.onScreenText).map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.onScreenText })),
  ].map((o) => ({ startMs: o.startMs, endMs: o.endMs, text: String(o.text || "") }));

  const durationMs = num(raw.durationMs, Math.max(...beats.map((b) => b.endMs), ...shots.map((s) => s.endMs)));
  const packaging = {
    titleText: "",
    thumbnailText: "",
    titleClaimRefs: [],
    thumbnailClaimRefs: [],
    expectedViewerPromise: [],
    openingMustEstablish: [],
    mustNotImply: [],
    ...(raw.packaging || {}),
  };
  const input = {
    projectId: raw.projectId,
    contentClass: raw.contentClass || "FACTUAL",
    contentMode: raw.contentMode || null,
    hookClass: resolveHookClass(raw.contentClass || "FACTUAL", raw.contentMode, raw.hookClass),
    durationMs,
    packaging,
    beats,
    shots,
    captions,
    narration,
    onScreen,
    music: (raw.music || []).map((m) => ({ startMs: m.startMs, endMs: m.endMs, energy: num(m.energy, 0) })),
    sfx: raw.sfx || [],
    intentionalSilence: raw.intentionalSilence || [],
    video: raw.video || null,
  };
  input.inputFingerprint = sha16({
    p: input.projectId, d: durationMs, pk: packaging,
    b: beats.map((b) => [b.beatId, b.role, b.startMs, b.endMs, b.text]),
    s: shots.map((s) => [s.shotId, s.startMs, s.endMs, s.modality, s.motionPrimitive || null, s.framing || null, s.isStatic === true, s.timingPreset || null]),
    c: captions.map((c) => [c.startMs, c.endMs, c.text]),
    m: input.music.map((m) => [m.startMs, m.endMs, m.energy]),
  });
  return { ok: true, input };
}

module.exports = { BEAT_ROLES, HOOK_CLASSES, resolveHookClass, normalizeRole, normalizeInput };
