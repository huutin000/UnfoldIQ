"use strict";

/**
 * Phase 6B shared fixtures: synthetic/golden episodes for the originality gate and
 * quality-scoring tests. Everything here is SYNTHETIC (origin GOLDEN_FIXTURE) — it proves
 * the mechanics, never real channel-level originality.
 */

const path = require("path");
const REPO = path.join(__dirname, "..", "..");
const fx = require("./creative-fixture.js");
const cr = fx.cr;
const dif = require(REPO + "/lib/creative-differentiation/index.js");

const TEXTS = {
  sky: [
    "Look up on a clear day and the sky is blue, yet sunlight itself is white, so where does that blue come from?",
    "Air is full of tiny nitrogen and oxygen molecules, each far smaller than a wavelength of visible light.",
    "These molecules scatter short blue wavelengths in every direction several times more strongly than red light.",
    "Scattered blue light reaches your eyes from everywhere overhead, which is why the whole sky glows blue.",
    "Violet scatters even more, but sunlight contains less of it and human eyes respond weakly to violet.",
    "At sunset the light crosses far more air, the blue is scattered away, and only reds and oranges remain.",
  ],
  skyHistory: [
    "Why the sky is blue puzzled scientists for centuries, and Leonardo da Vinci already suspected that air itself played a role.",
    "In 1859 John Tyndall shone light through smoky tubes and watched a faint blue haze appear beside the beam.",
    "Lord Rayleigh then calculated in 1871 that scattering strength grows with the fourth power of frequency.",
    "Albert Einstein later showed in 1910 that random density fluctuations in the air explain the measured intensity.",
    "These experiments turned a poetic question into a quantitative theory that still guides atmospheric optics today.",
    "Modern satellites confirm the same wavelength dependence when they measure sunlight scattered by the thin upper atmosphere.",
  ],
  bridge: [
    "Every suspension bridge hangs a heavy road from two enormous cables, but why do those cables never snap under the load?",
    "Each main cable is spun from thousands of steel wires bundled together, so a single flaw cannot break the whole rope.",
    "The cables pass over tall towers and anchor deep inside massive concrete blocks buried at both ends of the span.",
    "Vertical hangers carry the deck weight upward into the main cable, which turns that weight into pure tension.",
    "Tension is the ideal load for steel because the metal stretches slightly yet returns to its original length.",
    "Engineers also add stiffening trusses so wind cannot twist the deck into the dangerous flutter that destroyed older bridges.",
  ],
  sleep: [
    "Most people believe sleep is simply rest, yet the brain stays remarkably busy through the entire night.",
    "During deep sleep slow waves wash across the cortex and help move fresh memories into long term storage.",
    "Later in the night rapid eye movement sleep brings vivid dreams and strong emotional processing.",
    "Between cycles the brain flushes metabolic waste through channels that widen while you lie still.",
    "Skipping sleep disrupts this cleaning routine, so thoughts feel foggy and mistakes become more frequent.",
    "A consistent bedtime keeps the cycles intact and protects both memory and mood over the years.",
  ],
  serialA: [
    "Mira found a brass key beneath the old lighthouse stairs and Tobi insisted it belonged to the keeper.",
    "They followed scratches on the wall that led down to a flooded cellar full of glittering sea glass.",
    "Tobi dared to wade in while Mira held the lantern high above the cold black water.",
    "A hidden door swung open and revealed a map pinned beneath a rusted compass.",
    "Mira recognised the coastline on the map as the cove behind her grandmother's house.",
    "They ran home through the storm, certain the next clue waited in the attic.",
  ],
  serialB: [
    "Mira and Tobi climbed the attic ladder, where a dusty trunk had waited for decades beside the chimney.",
    "Inside lay a violin missing three strings and a letter written in faded violet ink.",
    "Tobi read the letter aloud and it warned them about a tide that returns only at midnight.",
    "They waited on the pier while the moon dragged the water far beyond its usual line.",
    "A stone staircase emerged from the mud and descended toward a lantern flickering below.",
    "Mira took the first step, and Tobi followed, whispering the old keeper's rhyme.",
  ],
};

const swapWords = { tiny: "minute", molecules: "particles", scatter: "diffuse", strongly: "intensely", wavelengths: "frequencies", enormous: "massive", thousands: "many thousands", remarkably: "surprisingly", simply: "just", brings: "delivers", flushes: "clears", intact: "unbroken" };
/** Same story and claims, ~lightly reworded: shares meaning but not exact wording. */
const reword = (arr) => arr.map((s) => s.split(" ").map((w) => swapWords[w.toLowerCase().replace(/[^a-z]/g, "")] || w).join(" ").replace(/^Look up/, "Glance up").replace(/Every/, "Each"));

const INTRO = "Welcome to Unfold IQ, where we unfold ideas one clear step at a time.";
const OUTRO = "Thanks for watching, and see you in the next episode of Unfold IQ.";
const CTA = "If this helped, subscribe for one new explainer every week.";

const STYLES = {
  A: { mods: ["DIAGRAM", "CHART", "IMAGE", "MAP"], motions: ["ZOOM", "PAN", "PUSH", "REVEAL"], framings: ["WIDE", "CLOSE", "MEDIUM", "TOP"], timing: ["ease-in-out", "linear", "ease-out", "ease-in-out"] },
  B: { mods: ["IMAGE", "VEO", "DIAGRAM", "CHART"], motions: ["PAN", "REVEAL", "ZOOM", "DIAGRAM_STEP_REVEAL"], framings: ["CLOSE", "FLAT", "WIDE", "MEDIUM"], timing: ["linear", "ease-out", "ease-in-out", "linear"] },
};

/**
 * o: { id, topic|texts, owner='owner-1', channel='chan-1', series?, style='A', title, thumb, claims[], thesis, beatMs=8000,
 *      cta=true, intro=true, outro=true, recapBeats:[idx], assets:[{assetId,sha256,source}], origin, sharedEntities, music:[roles], videoSha256 }
 */
function episode(o) {
  const texts = o.texts || TEXTS[o.topic];
  const beats = [];
  let t = 0;
  const push = (role, text, extra = {}) => { const i = beats.length + 1; beats.push({ beatId: `${o.id}-b${i}`, sceneId: `${o.id}-s${i}`, role, startMs: t, endMs: t + (o.beatMs || 8000), text, ...extra }); t += o.beatMs || 8000; };
  if (o.intro !== false) push("BRAND_INTRO", INTRO);
  texts.forEach((x, i) => push(i === 0 ? "HOOK" : i === texts.length - 1 ? "PAYOFF" : "EXPLANATION", x, (o.recapBeats || []).includes(i) ? { intent: { recap: true } } : {}));
  if (o.cta !== false) push("CTA", CTA);
  if (o.outro !== false) push("OUTRO", OUTRO);
  const S = STYLES[o.style || "A"];
  const shots = beats.map((b, i) => ({
    shotId: `${o.id}-sh${i + 1}`, beatId: b.beatId, sceneId: b.sceneId, startMs: b.startMs, endMs: b.endMs,
    modality: S.mods[i % 4], framing: S.framings[i % 4], motionPrimitive: S.motions[i % 4], motionDirection: ["IN", "RIGHT", "UP", "OUT"][i % 4],
    timingPreset: S.timing[i % 4], motionPurpose: "DIRECT_ATTENTION", motionIntensity: 0.3, isStatic: false, visualMeaning: `visual ${i}`,
  }));
  const raw = {
    projectId: o.id, contentClass: "FACTUAL", contentMode: "educational-explainer", durationMs: t,
    packaging: { titleText: o.title, thumbnailText: o.thumb || "", expectedViewerPromise: [], openingMustEstablish: [], mustNotImply: [] },
    beats, shots, captions: beats.map((b) => ({ startMs: b.startMs, endMs: b.endMs, text: b.text })),
  };
  const a = cr.analyzeCreativeRetention(raw);
  if (!a.ok) throw new Error("fixture analyze failed: " + JSON.stringify(a.errors));
  const fp = dif.originality.buildFingerprintV2(a.input, a.fingerprint, {
    episodeId: o.id, origin: o.origin || "GOLDEN_FIXTURE", scope: { ownerId: o.owner || "owner-1", channelId: o.channel || "chan-1", ...(o.series ? { seriesId: o.series } : {}) },
    editorialBibleVersion: "ebv-1", identity: { palette: "sky", mascot: "owl", voiceId: "v1" }, thesis: o.thesis || (texts[0]), claimRefs: o.claims || [], thumbnail: { layout: o.thumbLayout || "LEFT_SUBJECT_RIGHT_TEXT" },
    musicCueRoles: o.music || [], assets: o.assets || [], sharedEntities: o.sharedEntities || [], videoSha256: o.videoSha256,
  });
  return { raw, analysis: a, fp };
}

const C = {
  sky: ["c-rayleigh", "c-blue-scatter", "c-violet-eyes", "c-sunset-path"],
  skyHistory: ["c-tyndall-1859", "c-rayleigh-1871", "c-einstein-1910", "c-satellite-check"],
  bridge: ["c-cables", "c-anchors", "c-hangers", "c-trusses"],
  sleep: ["c-slow-wave", "c-rem", "c-glymphatic", "c-schedule"],
};

/**
 * Golden originality corpus (SYNTHETIC). expect.risk = band the gate must produce; present/absent = finding codes.
 */
function goldenOriginality() {
  const base = episode({ id: "g-sky", topic: "sky", title: "Why Is the Sky Blue", thumb: "BLUE?", claims: C.sky, thesis: "why the sky is blue" });
  const E = (o) => episode(o).fp;
  return [
    { name: "same-channel-identity-different-substance", subject: E({ id: "g-bridge", topic: "bridge", title: "How Suspension Bridges Hold", claims: C.bridge, thesis: "why bridge cables hold" }), corpus: [base.fp], expect: { risk: "LOW", present: ["CHANNEL_IDENTITY_INTENTIONAL"], absent: ["EXACT_EPISODE_DUPLICATE", "SEMANTIC_NEAR_DUPLICATE", "REPEATED_STORY_ARC_WITHOUT_NEW_SUBSTANCE"] } },
    { name: "same-subject-different-evidence", subject: E({ id: "g-skyh", topic: "skyHistory", title: "The Long History of the Blue Sky", claims: C.skyHistory, thesis: "how scientists explained the blue sky" }), corpus: [base.fp], expect: { risk: "LOW", absent: ["SEMANTIC_NEAR_DUPLICATE", "EXACT_EPISODE_DUPLICATE"] } },
    { name: "near-duplicate-script-new-package", subject: E({ id: "g-sky2", texts: reword(TEXTS.sky), title: "The Real Reason Skies Look Blue", thumb: "WOW", thumbLayout: "CENTER_TEXT", claims: C.sky, thesis: "why the sky is blue" }), corpus: [base.fp], expect: { risk: "HIGH", present: ["SEMANTIC_NEAR_DUPLICATE"] } },
    { name: "exact-duplicate-republished", subject: E({ id: "g-sky-dup", topic: "sky", title: "Sky Blue Again", claims: C.sky, thesis: "why the sky is blue" }), corpus: [base.fp], expect: { risk: "HIGH", present: ["EXACT_EPISODE_DUPLICATE"] } },
    { name: "same-presentation-new-substance", subject: E({ id: "g-sleep", topic: "sleep", title: "Why Is the Sky Blue", thumb: "BLUE?", claims: C.sleep, thesis: "what the brain does during sleep", music: ["BED", "SWELL"] }), corpus: [base.fp], expect: { risk: "LOW", present: ["TITLE_FORMULA_REPETITION", "SHOT_MOTION_TEMPLATE_RISK"], absent: ["SEMANTIC_NEAR_DUPLICATE"] } },
    { name: "serial-shared-characters", subject: E({ id: "g-serB", topic: "serialB", series: "lighthouse", title: "Lighthouse Secrets Part 2", claims: ["c-attic"], sharedEntities: ["Mira", "Tobi"], thesis: "mira and tobi find the trunk" }), corpus: [episode({ id: "g-serA", topic: "serialA", series: "lighthouse", title: "Lighthouse Secrets Part 1", claims: ["c-key"], sharedEntities: ["Mira", "Tobi"], thesis: "mira and tobi find the key" }).fp], expect: { risk: "LOW", absent: ["SEMANTIC_NEAR_DUPLICATE", "EXACT_EPISODE_DUPLICATE"] } },
    { name: "intentional-recap", subject: E({ id: "g-sky-recap", texts: [TEXTS.skyHistory[0], TEXTS.sky[1], TEXTS.skyHistory[2], TEXTS.skyHistory[3], TEXTS.skyHistory[4], TEXTS.skyHistory[5]], recapBeats: [1], title: "Blue Sky Part Two", claims: C.skyHistory, thesis: "how scientists explained the blue sky" }), corpus: [base.fp], expect: { risk: "LOW", absent: ["SEMANTIC_NEAR_DUPLICATE"] } },
    { name: "stock-reuse-with-new-narration", subject: E({ id: "g-stock", topic: "bridge", title: "Inside a Bridge Cable", claims: C.bridge, thesis: "why bridge cables hold", assets: [{ assetId: "a1", sha256: "ff".repeat(8), source: "STOCK" }] }), corpus: [episode({ id: "g-stock0", topic: "sleep", title: "What Sleep Does", claims: C.sleep, thesis: "what the brain does during sleep", assets: [{ assetId: "a1", sha256: "ff".repeat(8), source: "STOCK" }] }).fp], expect: { risk: "LOW", absent: ["SEMANTIC_NEAR_DUPLICATE"] } },
  ];
}

// ---------------------------------------------------------------- quality-scoring goldens
const KEYS = dif.quality.DIMENSION_KEYS;
const S = (dimension, assessor, status, ordinal, extra = {}) => ({ dimension, source: `${dimension} ${assessor}`, assessor, status, note: `${dimension} ${assessor} ${status}`, evidenceRef: `ev/${dimension}`, confidence: assessor === "MODEL" ? "MEDIUM" : "HIGH", ...(ordinal === null ? {} : { ordinal }), ...extra });
const allDet = (ord, over = {}) => KEYS.flatMap((k) => (over[k] === undefined ? [S(k, "DETERMINISTIC", "PASS", ord)] : over[k]));
const bag = (id, signals, extra = {}) => ({ projectId: id, videoSha256: "ab".repeat(32), contentClass: "FACTUAL", signals, hardBlockers: [], limitations: [], ...extra });

/** expect: decision, coverage subset, scoreBand [lo,hi] or null, per-dimension statuses (subset) */
function goldenQuality() {
  const blk = (category, id = "B1") => [{ id, category, severity: "P1", reason: "demonstrated blocker", evidenceRef: "ev/blocker" }];
  return [
    { name: "clear-good", ev: bag("q-good", allDet(3, { narration: [S("narration", "DETERMINISTIC", "PASS", 4)] })), expect: { decision: "PASS", missing: 0, scoreBand: [3, 3.2] } },
    { name: "clear-bad", ev: bag("q-bad", allDet(3, { captions: [S("captions", "DETERMINISTIC", "FAIL", 0)], sound: [S("sound", "DETERMINISTIC", "FAIL", 0)] })), expect: { decision: "FAIL", dims: { captions: "FAIL", sound: "FAIL" }, scoreBand: [2.5, 3] } },
    { name: "borderline-subjective", ev: bag("q-border", allDet(2, { pacing: [S("pacing", "DETERMINISTIC", "PASS", 1)] })), expect: { decision: "REVIEW_REQUIRED", dims: { pacing: "REVIEW_REQUIRED" }, scoreBand: [1.8, 2] } },
    { name: "intentional-silence-and-static", ev: bag("q-silent", allDet(3, { sound: [], motion: [S("motion", "DETERMINISTIC", "PASS", 2, { note: "intentional static beats, no motion needed" })] }), { applicability: { sound: { applicable: false, reason: "intentional silence: no music/SFX by creative intent", evidenceRefs: ["brief"] } } }), expect: { decision: "PASS", dims: { sound: "NOT_MEASURED", motion: "PASS" }, notApplicable: ["sound"], missing: 0 } },
    { name: "missing-evidence", ev: bag("q-missing", KEYS.filter((k) => !["imagery", "continuity"].includes(k)).map((k) => S(k, "DETERMINISTIC", "PASS", 3))), expect: { decision: "REVIEW_REQUIRED", missing: 2, dims: { imagery: "NOT_MEASURED", continuity: "NOT_MEASURED" } } },
    { name: "model-only-on-deterministic-dimension", ev: bag("q-modelonly", allDet(3, { captions: [S("captions", "MODEL", "PASS", 4)] })), expect: { decision: "REVIEW_REQUIRED", dims: { captions: "REVIEW_REQUIRED" } } },
    { name: "model-disagrees-with-deterministic-fail", ev: bag("q-disagree", allDet(3, { captions: [S("captions", "DETERMINISTIC", "FAIL", 0), S("captions", "MODEL", "PASS", 4)] })), expect: { decision: "FAIL", dims: { captions: "FAIL" } } },
    { name: "high-score-but-factual-blocker", ev: bag("q-factual", allDet(4), { hardBlockers: blk("FACTUAL", "UNSUPPORTED_CLAIM") }), expect: { decision: "FAIL", scoreBand: [4, 4], blocked: true } },
    { name: "high-score-but-rights-blocker", ev: bag("q-rights", allDet(4), { hardBlockers: blk("RIGHTS", "UNCLEARED_ASSET") }), expect: { decision: "FAIL", scoreBand: [4, 4], blocked: true } },
    { name: "high-score-but-security-blocker", ev: bag("q-security", allDet(4), { hardBlockers: blk("SECURITY", "SECRET_IN_DOM") }), expect: { decision: "FAIL", scoreBand: [4, 4], blocked: true } },
    { name: "high-score-but-technical-p1", ev: bag("q-tech", allDet(4), { hardBlockers: blk("TECHNICAL_QA", "FROZEN_FRAMES") }), expect: { decision: "FAIL", scoreBand: [4, 4], blocked: true } },
    { name: "high-score-but-owner-approval-missing", ev: bag("q-appr", allDet(4), { hardBlockers: blk("OWNER_APPROVAL", "NO_APPROVAL") }), expect: { decision: "FAIL", scoreBand: [4, 4], blocked: true } },
  ];
}

module.exports = { goldenQuality, quality: { S, bag, allDet, KEYS }, REPO, fx, cr, dif, TEXTS, C, episode, reword, goldenOriginality };
