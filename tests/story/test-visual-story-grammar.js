"use strict";

/**
 * Phase 1G.5 FIX 1 — Visual Story Grammar + render-mode alignment (Prompt).
 * Deterministic. No network, no generation, 0 provider calls, 0 credits.
 * Covers VG1-VG13, RM1-RM10, the mixed 10-shot V6 gate, long-form modality /
 * render-mode distributions, Prompt Compiler regression, staleness
 * boundaries, FACTUAL/FICTION/HYBRID, platform neutrality, memory advisory.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const vm = require("../../lib/visual-motion/index.js");
const pc = require("../../lib/prompt-compiler/index.js");
const ss = require("../../lib/story-structure/index.js");

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
  console.log(`  ✓ ${message}`);
  passed++;
}

function runTest(name, fn) {
  console.log(`\n[TEST] ${name}`);
  return Promise.resolve().then(fn)
    .then(() => console.log(`[PASS] ${name}`))
    .catch((e) => { console.log(`[FAIL] ${name}: ${e.message}`); failed++; });
}

const NOW = "2026-10-03T00:00:00.000Z";

function mkScene(id, extra = {}) {
  return {
    sceneId: id, order: 0, beatIds: ["b1"], storySectionRefs: ["sec-1"],
    narrativePurpose: "Test scene purpose", visualObjective: "EXPLAIN",
    subjectRefs: [], environmentRefs: [], continuityGroup: "cg-1",
    stateBefore: null, stateAfter: null, ...extra,
  };
}

function mkShot(id, sceneId, extra = {}) {
  return {
    shotId: id, parentSceneId: sceneId, orderWithinScene: 0, beatIds: ["b1"],
    claimRefs: [], shotPurpose: "DETAIL", visualObjective: "EXPLAIN",
    subjectRefs: [], actionIntent: null, framingIntent: null, cameraIntent: null,
    continuityRefs: ["cg-1"], startState: null, endState: null,
    relativeWeight: 1, ...extra,
  };
}

const MOTION_KEYS = ["subjectMovement", "physicalInteraction", "essentialToUnderstanding", "temporalTransformation", "environmentalDynamics", "revealProgression", "causeEffectOverTime", "cameraMovementNeeded", "turningPoint", "emotionalPayoff"];

function decide(shot, scene, signals, extra = {}) {
  // Closed world: unspecified motion signals are explicitly false so the
  // engine never reviews for missing motion semantics in these fixtures.
  const closed = { ...signals };
  if (!MOTION_KEYS.some((k) => closed[k] !== undefined)) {
    for (const k of MOTION_KEYS) closed[k] = false;
  }
  const r = vm.decideShotProduction({
    projectId: "p-fix1", shot, scene,
    contentClass: "FACTUAL", platform: "youtube", signals: closed, now: NOW, ...extra,
  });
  if (!r.ok) throw new Error(`decision failed: ${r.code} ${r.message || ""}`);
  return r;
}

function beatMapFor(beats) {
  return { beats, fingerprint: "fp-fix1-beatmap" };
}

async function main() {
  // ---------------- VISUAL STORY GRAMMAR (VG1-VG13) ----------------
  const VG = [
    ["VG1 spatial movement → MAP", { visualModality: undefined, spatialMovement: true, visualType: "ENVIRONMENT" }, "MAP"],
    ["VG2 numeric trend → CHART", { visualType: "EVIDENCE", numericTrend: true, subjectMovement: false }, "CHART"],
    ["VG3 mechanism/process → DIAGRAM", { visualType: "DIAGRAM", mechanismProcess: true }, "DIAGRAM"],
    ["VG4 historical sequence → TIMELINE", { visualType: "TIMELINE", historicalSequence: true }, "TIMELINE"],
    ["VG5 evidence labeling → ANNOTATION", { visualType: "EVIDENCE", evidenceLabeling: true, subjectMovement: false }, "ANNOTATION"],
    ["VG6 side-by-side difference → COMPARISON / SPLIT_SCREEN", null, null], // special-cased below
    ["VG7 emotional beat → CHARACTER_MOMENT", { visualType: "CHARACTER_SCENE", emotionalCharacterBeat: true, subjectMovement: true }, "CHARACTER_MOMENT"],
    ["VG8 mood/world beat → ATMOSPHERE", { visualType: "ENVIRONMENT", moodWorld: true, environmentalDynamics: true }, "ATMOSPHERE"],
    ["VG9 conceptual analogy → METAPHOR", { visualType: "ENVIRONMENT", conceptualAnalogy: true }, "METAPHOR"],
    ["VG10 kinetic explanatory graphic → MOTION_GRAPHIC", { visualType: "DIAGRAM", kineticGraphic: true, revealProgression: true }, "MOTION_GRAPHIC"],
    ["VG11 textual emphasis → TYPOGRAPHY", { visualType: "EVIDENCE", textualEmphasis: true, subjectMovement: false }, "TYPOGRAPHY"],
    ["VG12 reconstruction intent → RECONSTRUCTION", { visualType: "CHARACTER_SCENE", reconstructionIntent: true, subjectMovement: false }, "RECONSTRUCTION"],
  ];

  for (const [name, signals, expected] of VG) {
    if (!signals) continue;
    await runTest(name, () => {
      const scene = mkScene("sc-aabbccddeeff");
      const shot = mkShot("sh-aabbccddeeff", scene.sceneId, { shotPurpose: "DEMONSTRATE" });
      const r = decide(shot, scene, signals);
      assert(r.status === "DECISION_READY", "READY, not review");
      assert(r.decision.visualModality === expected, `modality ${r.decision.visualModality} === ${expected}`);
      assert(r.decision.modalityReasons.length > 0, "modality reasons non-empty");
      assert(["HIGH", "MEDIUM", "LOW"].includes(r.decision.modalityConfidence), "explainable confidence tier");
      assert(r.decision.beatLineage && r.decision.beatLineage.shotPurpose === "DEMONSTRATE", "beat→scene→shot lineage recorded");
      const v = vm.validateDecision({ decision: r.decision, context: { shot, scene } });
      assert(v.valid, `validator passes: ${JSON.stringify(v.errors)}`);
    });
  }

  await runTest("VG6 side-by-side difference → COMPARISON / SPLIT_SCREEN", () => {
    const scene = mkScene("sc-001122334455");
    const s1 = mkShot("sh-001122334455", scene.sceneId, { shotPurpose: "CONTRAST" });
    const d1 = decide(s1, scene, { visualType: "COMPARISON", sideBySideDifference: true }).decision;
    assert(d1.visualModality === "COMPARISON", `sequential difference -> ${d1.visualModality}`);
    const s2 = mkShot("sh-001122334456", scene.sceneId, { shotPurpose: "CONTRAST" });
    const d2 = decide(s2, scene, { visualType: "COMPARISON", sideBySideDifference: true, simultaneousPresentation: true }).decision;
    assert(d2.visualModality === "SPLIT_SCREEN", `simultaneous difference -> ${d2.visualModality}`);
    assert(d2.recommendedOutputType === "EDITOR_MOTION", "split-screen stays deterministic composition");
  });

  await runTest("VG13 insufficient semantics → REVIEW, no guess", () => {
    const scene = mkScene("sc-ffeeddccbbaa");
    const shot = mkShot("sh-ffeeddccbbaa", scene.sceneId, { shotPurpose: "DETAIL" });
    const r = decide(shot, scene, { visualType: "CHARACTER_SCENE", requireModalityReview: true });
    assert(r.status === "DECISION_REVIEW_REQUIRED", "review, not a guess");
    assert(r.decision.visualModality === null && r.decision.renderMode === null, "no fabricated modality or renderer");
    const bad = decide(mkShot("sh-ffeeddccbbab", scene.sceneId, { shotPurpose: "DETAIL" }), scene, { visualType: "CHARACTER_SCENE", visualModality: "HOLOGRAM" });
    assert(bad.status === "DECISION_REVIEW_REQUIRED", "unknown modality label rejected, not coerced");
  });

  await runTest("visualType and visualModality are not conflated", () => {
    const scene = mkScene("sc-1234567890ab");
    const shot = mkShot("sh-1234567890ab", scene.sceneId, { shotPurpose: "ESTABLISH" });
    const d = decide(shot, scene, { visualType: "CHARACTER_SCENE", reconstructionIntent: true, subjectMovement: false }).decision;
    assert(d.visualType === "CHARACTER_SCENE" && d.visualModality === "RECONSTRUCTION", "type ≠ modality");
    assert(d.modalityConfidence === "HIGH", "intent-driven confidence is HIGH");
    const d2 = decide(mkShot("sh-1234567890ac", scene.sceneId, { shotPurpose: "ESTABLISH" }), scene, { subjectMovement: false, environmentalDynamics: false }).decision;
    assert(d2.visualType === "ENVIRONMENT" && d2.visualModality === "ATMOSPHERE", "compat default recorded as LOW-confidence");
    assert(d2.modalityConfidence === "LOW", "type-default confidence is LOW (honest)");
  });

  // ---------------- RENDERER TESTS (RM1-RM10) ----------------
  await runTest("RM1 still sufficient → STATIC_IMAGE render mode", () => {
    const scene = mkScene("sc-aa00bb11cc22");
    const d = decide(mkShot("sh-aa00bb11cc22", scene.sceneId, { shotPurpose: "EVIDENCE_VISUAL" }), scene, { evidenceLabeling: true, subjectMovement: false }).decision;
    assert(d.visualModality === "ANNOTATION" && d.renderMode === "STATIC_IMAGE", `annotation still -> ${d.renderMode}`);
  });

  await runTest("RM2 map route → REMOTION_MOTION", () => {
    const scene = mkScene("sc-aa00bb11cc33");
    const d = decide(mkShot("sh-aa00bb11cc33", scene.sceneId, { shotPurpose: "DEMONSTRATE" }), scene, { visualType: "MAP", spatialMovement: true, cameraMovementNeeded: true }).decision;
    assert(d.recommendedOutputType === "EDITOR_MOTION" && d.renderMode === "REMOTION_MOTION", `map -> ${d.renderMode}`);
  });

  await runTest("RM3 chart animation → REMOTION_MOTION (never Veo)", () => {
    const scene = mkScene("sc-aa00bb11cc44");
    const d = decide(mkShot("sh-aa00bb11cc44", scene.sceneId, { shotPurpose: "DEMONSTRATE" }), scene, {
      visualType: "EVIDENCE", numericTrend: true, temporalTransformation: true, essentialToUnderstanding: true, revealProgression: true,
    }).decision;
    assert(d.visualModality === "CHART", "chart modality wins");
    assert(!String(d.renderMode).startsWith("VEO"), `chart capped, got ${d.renderMode}`);
    assert(d.decisionReasons.some((r) => /capped at EDITOR_MOTION/.test(r)), "cap reason recorded");
  });

  await runTest("RM4 diagram mechanism → REMOTION_MOTION", () => {
    const scene = mkScene("sc-aa00bb11cc55");
    const d = decide(mkShot("sh-aa00bb11cc55", scene.sceneId, { shotPurpose: "PROCESS_STEP" }), scene, { visualType: "DIAGRAM", mechanismProcess: true, revealProgression: true }).decision;
    assert(d.renderMode === "REMOTION_MOTION", `diagram -> ${d.renderMode}`);
  });

  await runTest("RM5 established start frame + semantic motion → VEO_FIRST_FRAME", () => {
    const scene = mkScene("sc-aa00bb11cc66", { subjectRefs: ["char-1"] });
    const shot = mkShot("sh-aa00bb11cc66", scene.sceneId, { shotPurpose: "REVEAL", subjectRefs: ["char-1"], actionIntent: "the figure steps forward" });
    const d = decide(shot, scene, {
      visualType: "CHARACTER_SCENE", emotionalCharacterBeat: true, subjectMovement: true,
      physicalInteraction: true, essentialToUnderstanding: true,
      recurringEntities: [{ entityId: "char-1", kind: "CHARACTER", hasApprovedReference: true }],
    }).decision;
    assert(d.recommendedOutputType === "GENERATED_MOTION_RECOMMENDED", "still recommended");
    assert(d.renderMode === "VEO_REFERENCE" || d.renderMode === "VEO_FIRST_FRAME", `identity motion -> ${d.renderMode}`);
  });

  await runTest("RM6 precise A→B transition → VEO_FIRST_LAST", () => {
    const scene = mkScene("sc-aa00bb11cc77");
    const shot = mkShot("sh-aa00bb11cc77", scene.sceneId, { shotPurpose: "REVEAL", actionIntent: "gate swings open" });
    const d = decide(shot, scene, {
      visualType: "CHARACTER_SCENE", emotionalCharacterBeat: true, subjectMovement: true,
      temporalTransformation: true, essentialToUnderstanding: true,
      stateTransition: true, startState: "sealed gate", endState: "open gate",
    }).decision;
    assert(d.renderMode === "VEO_FIRST_LAST", `transition -> ${d.renderMode}`);
    assert(d.requiredCapabilities.includes("FIRST_LAST_FRAME_VIDEO"), "capability required, workflow chosen");
  });

  await runTest("RM7 identity-critical recurring character → VEO_REFERENCE", () => {
    const scene = mkScene("sc-aa00bb11cc88");
    const shot = mkShot("sh-aa00bb11cc88", scene.sceneId, { shotPurpose: "REVEAL", subjectRefs: ["char-7"], actionIntent: "she turns to camera" });
    const d = decide(shot, scene, {
      visualType: "CHARACTER_SCENE", emotionalCharacterBeat: true, subjectMovement: true,
      physicalInteraction: true, essentialToUnderstanding: true,
      recurringEntities: [{ entityId: "char-7", kind: "CHARACTER", hasApprovedReference: true, lockStrength: "STRICT" }],
      referenceAssetIds: ["ref-char-7"],
    }).decision;
    assert(d.renderMode === "VEO_REFERENCE", `identity-critical -> ${d.renderMode}`);
    assert(d.referenceAssetIds.includes("ref-char-7"), "reference asset tracked for targeted staleness");
  });

  await runTest("RM8 cinematic importance alone does NOT force Veo", () => {
    const scene = mkScene("sc-aa00bb11cc99");
    const d = decide(mkShot("sh-aa00bb11cc99", scene.sceneId, { shotPurpose: "ESTABLISH" }), scene, {
      visualType: "ENVIRONMENT", moodWorld: true, importance: "HIGH", subjectMovement: false, environmentalDynamics: false,
    }).decision;
    assert(!String(d.renderMode).startsWith("VEO"), `importance-only stays cheap: ${d.renderMode}`);
  });

  await runTest("RM9 low-value candidate under budget → REMOTION_MOTION", () => {
    const scene = mkScene("sc-bb00cc11dd22", { beatIds: ["b1", "b2"] });
    const mk = (id, purpose, sig) => mkShot(id, scene.sceneId, { shotPurpose: purpose, beatIds: ["b1", "b2"] });
    const plan = {
      version: "1.0.0", shotPlanId: "sp-abcdef123456", projectId: "p-fix1",
      platform: "youtube", contentClass: "FACTUAL",
      sourceSceneGraphRef: { sceneGraphId: "sg-abcdef123456", fingerprint: null },
      shots: [
        mk("sh-111111111111", "ESTABLISH", {}),
        mk("sh-222222222222", "REVEAL", {}),
      ],
      fingerprint: "0123456789abcdef", status: "GENERATED",
    };
    const r = vm.decidePlanProduction({
      projectId: "p-fix1", shotPlan: plan, sceneGraph: { scenes: [scene] },
      contentClass: "FACTUAL", platform: "youtube", now: NOW,
      signalsByShot: {
        "sh-111111111111": { visualType: "CHARACTER_SCENE", emotionalCharacterBeat: true, subjectMovement: true, physicalInteraction: true, essentialToUnderstanding: true, turningPoint: true },
        "sh-222222222222": { visualType: "CHARACTER_SCENE", emotionalCharacterBeat: true, subjectMovement: true },
      },
      budget: { maxGeneratedMotionShots: 0 },
    });
    assert(r.ok, "plan decided");
    for (const d of r.decisions) {
      assert(d.renderMode === "REMOTION_MOTION" || d.renderMode === "STATIC_IMAGE", `${d.shotId} honestly rendered (${d.renderMode})`);
    }
    assert(r.decisions.every((d) => !String(d.renderMode).startsWith("VEO")), "zero Veo under zero-budget");
  });

  await runTest("RM10 no model ID selected anywhere", () => {
    const scene = mkScene("sc-cc00dd11ee22");
    const d = decide(mkShot("sh-cc00dd11ee22", scene.sceneId, { shotPurpose: "REVEAL", actionIntent: "gates open" }), scene, {
      visualType: "CHARACTER_SCENE", emotionalCharacterBeat: true, subjectMovement: true,
      temporalTransformation: true, essentialToUnderstanding: true, stateTransition: true, startState: "a", endState: "b",
    }).decision;
    const text = [...d.decisionReasons, ...d.renderModeReasons, ...d.modalityReasons].join("\n");
    assert(!/veo[\s-]?3|gemini|nano[\s-]?banana|imagen|omni/i.test(text.replace(/VEO_[A-Z_]+/g, "")), "no model ID in decision text");
    const v = vm.validateDecision({ decision: { ...d, renderModeReasons: ["use veo-3.1-fast for this"] }, context: {} });
    assert(!v.valid && v.errors.some((e) => e.code === "MODEL_SELECTED"), "model ID in reasons rejected");
    // Canonical sources carry workflow names (VEO_FIRST_*) but no model matrix.
    const dir = path.join(__dirname, "..", "..", "lib", "visual-motion");
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith(".js")) continue;
      const src = fs.readFileSync(path.join(dir, f), "utf8")
        .split("\n").filter((l) => !/_PATTERN\s*=/.test(l)).join("\n")
        .replace(/VEO_[A-Z_]+/g, "");
      assert(!/veo[\s-]?3|gemini|nano[\s-]?banana|imagen|omni\b/i.test(src), `${f} hard-codes no model`);
    }
  });

  // ---------------- MIXED 10-SHOT V6 GATE ----------------
  await runTest("10-shot mixed gate: diverse modalities, honest render modes, no all-Veo", () => {
    const scene = mkScene("sc-600d600d600d", { beatIds: ["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9", "b10"] });
    const shots = [
      ["sh-000000000001", "ESTABLISH", { visualType: "ENVIRONMENT", moodWorld: true, subjectMovement: false, environmentalDynamics: false }],
      ["sh-000000000002", "DEMONSTRATE", { visualType: "MAP", spatialMovement: true, cameraMovementNeeded: true }],
      ["sh-000000000003", "EVIDENCE_VISUAL", { visualType: "EVIDENCE", numericTrend: true, subjectMovement: false }],
      ["sh-000000000004", "DEMONSTRATE", { visualType: "DIAGRAM", mechanismProcess: true, revealProgression: true }],
      ["sh-000000000005", "EVIDENCE_VISUAL", { visualType: "EVIDENCE", evidenceLabeling: true, subjectMovement: false }],
      ["sh-000000000006", "CONTRAST", { visualType: "COMPARISON", sideBySideDifference: true, simultaneousPresentation: true, subjectMovement: false }],
      ["sh-000000000007", "REVEAL", { visualType: "CHARACTER_SCENE", emotionalCharacterBeat: true, subjectMovement: true, physicalInteraction: true, essentialToUnderstanding: true, turningPoint: true, actionIntent: "they struggle at the gate" }],
      ["sh-000000000008", "ESTABLISH", { visualType: "CHARACTER_SCENE", reconstructionIntent: true, subjectMovement: false }],
      ["sh-000000000009", "DETAIL", { visualType: "EVIDENCE", textualEmphasis: true, subjectMovement: false }],
      ["sh-000000000010", "PROCESS_STEP", { visualType: "TIMELINE", historicalSequence: true, revealProgression: true }],
    ].map(([id, purpose, sig]) => ({ shot: mkShot(id, scene.sceneId, { shotPurpose: purpose, beatIds: scene.beatIds }), sig }));
    const plan = {
      version: "1.0.0", shotPlanId: "sp-600d600d600d", projectId: "p-gate",
      platform: "youtube", contentClass: "FACTUAL",
      sourceSceneGraphRef: { sceneGraphId: "sg-600d600d600d", fingerprint: null },
      shots: shots.map((s) => s.shot), fingerprint: "0123456789abcdef", status: "GENERATED",
    };
    const signalsByShot = Object.fromEntries(shots.map((s, i) => [s.shot.shotId, s.sig]));
    const r = vm.decidePlanProduction({
      projectId: "p-gate", shotPlan: plan, sceneGraph: { scenes: [scene] },
      contentClass: "FACTUAL", platform: "youtube", now: NOW, signalsByShot,
    });
    assert(r.ok, "gate plan decided");
    const mods = r.decisions.map((d) => d.visualModality);
    const modes = r.decisions.map((d) => d.renderMode);
    assert(new Set(mods).size >= 8, `diverse modalities (${new Set(mods).size}): ${mods.join(",")}`);
    assert(modes.includes("STATIC_IMAGE") && modes.includes("REMOTION_MOTION"), "static + remotion present");
    assert(modes.some((m) => String(m).startsWith("VEO")), "Veo present where earned");
    assert(!(modes.every((m) => String(m).startsWith("VEO"))), "not all-Veo");
    for (const d of r.decisions) {
      const v = vm.validateDecision({ decision: d, context: { shot: plan.shots.find((s) => s.shotId === d.shotId), scene } });
      assert(v.valid, `${d.shotId} validates: ${JSON.stringify(v.errors)}`);
    }
    console.log("  gate table:");
    const purposeOf = (id) => shots.find((s) => s.shot.shotId === id).shot.shotPurpose;
    for (const d of r.decisions) {
      console.log(`  | ${d.shotId.slice(-4)} | ${purposeOf(d.shotId)} | ${d.visualModality} | ${d.renderMode} | ${(d.modalityReasons[0] || "").slice(0, 60)} | PASS |`);
    }
    globalThis.__gate10 = r;
  });

  // ---------------- LONG-FORM MODALITY / RENDER REGRESSION ----------------
  await runTest("long-form: modality + render-mode distributions, deterministic", async () => {
    const roles = ["hook", "development", "development", "development", "payoff"];
    const texts = [
      "Why does the harbor logbook matter? The archive documents the crossing in detail.",
      "The migration route runs north along the coast, marker by marker.",
      "The mechanism works step by step as each progression unfolds in order.",
      "They struggled at the gate in a desperate escape, fighting through the breach.",
      "Finally the town settled into the harbor we know today.",
      "Records show the ledger registered every arrival. The archive documents each name.",
    ];
    const sections = [];
    for (let i = 0; i < 24; i++) {
      sections.push({ sectionId: `long-sec-${i}`, storyFunction: roles[i % roles.length], claimRefs: i % 3 === 0 ? [`clm-long-${i}`] : [], draftText: texts[i % texts.length] });
    }
    const draft = { draftId: "drf-long-fix1", sections };
    const plan = await ss.runStoryToVisualStructure({ projectId: "p-long", storyDraft: draft, contentClass: "FACTUAL", platform: "youtube" }, { persist: false });
    assert(plan.status === "VISUAL_STRUCTURE_READY", "structure ready");
    const provider = (shot, scene, beatMap) => {
      const beats = (shot.beatIds || []).map((id) => beatMap.beats.find((b) => b.beatId === id)).filter(Boolean);
      const text = beats.map((b) => b.summary || "").join(" ").toLowerCase();
      const sig = { visualType: ({ EVIDENCE_VISUAL: "EVIDENCE", ESTABLISH: "ENVIRONMENT", DEMONSTRATE: "DIAGRAM", REVEAL: "CHARACTER_SCENE", DETAIL: "OBJECT", CONTRAST: "COMPARISON", RESOLUTION: "ENVIRONMENT", PROCESS_STEP: "TIMELINE" })[shot.shotPurpose] || "ENVIRONMENT" };
      if (/map|route|migration/.test(text)) { sig.visualType = "MAP"; sig.spatialMovement = true; }
      if (/timeline|chronolog/.test(text)) { sig.visualType = "TIMELINE"; sig.historicalSequence = true; }
      if (/diagram|mechanism|step by step|how it works/.test(text)) { sig.visualType = "DIAGRAM"; sig.mechanismProcess = true; }
      if (/record|archive|document|ledger/.test(text) && shot.shotPurpose === "EVIDENCE_VISUAL") { sig.visualType = "EVIDENCE"; sig.evidenceLabeling = true; }
      if (/ledger|registered/.test(text) && shot.shotPurpose !== "EVIDENCE_VISUAL") sig.numericTrend = true;
      if (/chase|struggle|fight|escape|attack|lunge|flee|pursuit/.test(text)) {
        sig.visualType = "CHARACTER_SCENE"; sig.emotionalCharacterBeat = true;
        Object.assign(sig, { subjectMovement: true, physicalInteraction: true, essentialToUnderstanding: true, turningPoint: true, importance: "HIGH" });
      }
      if (/route|journey/.test(text)) Object.assign(sig, { cameraMovementNeeded: true, revealProgression: true });
      if (/progression|unfolds/.test(text)) Object.assign(sig, { revealProgression: true, temporalTransformation: true });
      if (/drift|atmosphere/.test(text)) sig.environmentalDynamics = true;
      for (const k of ["subjectMovement", "physicalInteraction", "essentialToUnderstanding", "temporalTransformation", "environmentalDynamics", "revealProgression", "causeEffectOverTime", "cameraMovementNeeded", "turningPoint", "emotionalPayoff"]) {
        if (sig[k] === undefined) sig[k] = false;
      }
      return sig;
    };
    const mkRun = () => vm.decidePlanProduction({
      projectId: "p-long", shotPlan: plan.shotPlan, sceneGraph: plan.sceneGraph, beatMap: plan.beatMap,
      contentClass: "FACTUAL", platform: "youtube", now: NOW,
      signalProvider: (shot, scene) => provider(shot, scene, plan.beatMap),
    });
    const r1 = mkRun();
    const r2 = mkRun();
    assert(r1.ok && r2.ok, "both runs decided");
    assert(r1.decisions.every((d) => d.status === "DECISION_READY"), "no review leftovers in long-form");
    const modDist = {};
    const modeDist = {};
    for (const d of r1.decisions) {
      modDist[d.visualModality] = (modDist[d.visualModality] || 0) + 1;
      modeDist[d.renderMode] = (modeDist[d.renderMode] || 0) + 1;
    }
    console.log(`  shots=${r1.decisions.length} modalities=${JSON.stringify(modDist)} modes=${JSON.stringify(modeDist)} elapsed=${r1.elapsedMs}ms`);
    assert(Object.keys(modDist).length >= 4, "no modality collapse");
    assert(!(Object.keys(modeDist).length === 1 && modeDist.VEO_FIRST_FRAME), "no all-Veo routing");
    assert(JSON.stringify(r1.decisions.map((d) => d.fingerprint)) === JSON.stringify(r2.decisions.map((d) => d.fingerprint)), "deterministic");
    assert(r1.elapsedMs < 5000, "bounded runtime");
    globalThis.__longFix1 = { modDist, modeDist, count: r1.decisions.length, elapsed: r1.elapsedMs };
  });

  // ---------------- PROMPT COMPILER REGRESSION ----------------
  await runTest("compiler regression: render modes drive lazy packages, ownership unchanged", async () => {
    const scene = mkScene("sc-c0c0c0c0c0c0");
    const mkIn = (shot, d, over = {}) => ({
      decision: d,
      compilerInput: {
        projectId: "p-fix1", shot, scene,
        beatMap: beatMapFor([{ beatId: "b1", summary: "Test beat summary with documented records.", claimRefs: [], storySectionRef: "sec-1" }]),
        platform: "youtube", contentClass: "FACTUAL", overrides: over.overrides || {}, referenceAssets: over.referenceAssets,
      },
    });
    // STATIC_IMAGE render mode → IMAGE only.
    const shotA = mkShot("sh-c0c0c0c0c0a0", scene.sceneId, { shotPurpose: "EVIDENCE_VISUAL" });
    const dA = decide(shotA, scene, { evidenceLabeling: true, subjectMovement: false }).decision;
    assert(dA.renderMode === "STATIC_IMAGE", "precondition");
    const rA = await vm.compileForDecision(mkIn(shotA, dA));
    assert(rA.ok && rA.packages.length === 1 && rA.packages[0].targetKind === "IMAGE", "STATIC_IMAGE → IMAGE only");
    // REMOTION_MOTION → IMAGE + plan, no VIDEO.
    const shotB = mkShot("sh-c0c0c0c0c0b0", scene.sceneId, { shotPurpose: "DEMONSTRATE" });
    const dB = decide(shotB, scene, { visualType: "MAP", spatialMovement: true, cameraMovementNeeded: true }).decision;
    assert(dB.renderMode === "REMOTION_MOTION", "precondition");
    const rB = await vm.compileForDecision(mkIn(shotB, dB));
    assert(rB.ok && rB.packages.length === 1 && rB.editorMotionPlan, "REMOTION → IMAGE + plan, no VIDEO");
    // VEO_FIRST_FRAME reference-first → IMAGE + VIDEO.
    const sceneC = mkScene("sc-c0c0c0c0c0c1", { subjectRefs: ["char-1"] });
    const shotC = mkShot("sh-c0c0c0c0c0c1", sceneC.sceneId, { shotPurpose: "REVEAL", subjectRefs: ["char-1"], actionIntent: "the figure steps forward" });
    const dC = decide(shotC, sceneC, {
      visualType: "CHARACTER_SCENE", emotionalCharacterBeat: true, subjectMovement: true,
      physicalInteraction: true, essentialToUnderstanding: true,
      recurringEntities: [{ entityId: "char-1", kind: "CHARACTER", hasApprovedReference: true }],
    }).decision;
    assert(["VEO_FIRST_FRAME", "VEO_REFERENCE"].includes(dC.renderMode), `precondition, got ${dC.renderMode}`);
    const rC = await vm.compileForDecision(mkIn(shotC, dC, {
      overrides: { actionIntent: "the figure steps forward" },
      referenceAssets: [{ assetId: "char-1", kind: "CHARACTER", version: "v1" }],
    }));
    assert(rC.ok && rC.packages.length === 2, "reference-first → IMAGE + VIDEO");
    // VEO_FIRST_LAST → IMAGE + VIDEO.
    const shotD = mkShot("sh-c0c0c0c0c0d0", scene.sceneId, { shotPurpose: "REVEAL", actionIntent: "gate swings open" });
    const dD = decide(shotD, scene, {
      visualType: "CHARACTER_SCENE", emotionalCharacterBeat: true, subjectMovement: true,
      temporalTransformation: true, essentialToUnderstanding: true,
      stateTransition: true, startState: "sealed", endState: "open",
    }).decision;
    assert(dD.renderMode === "VEO_FIRST_LAST", "precondition");
    const rD = await vm.compileForDecision(mkIn(shotD, dD, { overrides: { actionIntent: "gate swings open" } }));
    assert(rD.ok && rD.packages.length === 2, "VEO_FIRST_LAST → IMAGE + VIDEO");
    // VEO_REFERENCE text-free but asset-light → VIDEO only when no start asset must be created.
    const shotE = mkShot("sh-c0c0c0c0c0e0", scene.sceneId, { shotPurpose: "ESTABLISH", actionIntent: "mist drifts" });
    const dE = decide(shotE, scene, {
      visualType: "ENVIRONMENT", moodWorld: true, environmentalDynamics: true,
      temporalTransformation: true, essentialToUnderstanding: true,
    }).decision;
    assert(dE.renderMode === "VEO_FIRST_FRAME" && dE.referenceStrategy === "TEXT_BASED", `precondition, got ${dE.renderMode}`);
    const rE = await vm.compileForDecision(mkIn(shotE, dE, { overrides: { actionIntent: "mist drifts", environmentMotion: "drifting mist" } }));
    assert(rE.ok && rE.packages.length === 1 && rE.packages[0].targetKind === "VIDEO", "text-based VEO → VIDEO only");
    // Compiler ownership unchanged.
    const raw = await pc.compilePromptPackage({
      projectId: "p-fix1", shot: shotA, scene,
      beatMap: beatMapFor([{ beatId: "b1", summary: "x", claimRefs: [], storySectionRef: "sec-1" }]),
      platform: "youtube", contentClass: "FACTUAL",
    }, { persist: false });
    assert(raw.status === "PROMPT_TARGET_REQUIRED", "compiler still caller-driven, no strategy logic inside");
  });

  // ---------------- STALENESS BOUNDARIES ----------------
  await runTest("staleness: beat change stales modality; reference stales renderer only; models never stale", () => {
    const scene = mkScene("sc-d00dd00dd00d");
    const shot = mkShot("sh-d00dd00dd00d", scene.sceneId, { shotPurpose: "REVEAL", subjectRefs: ["char-7"], actionIntent: "she turns" });
    const beatMap = beatMapFor([{ beatId: "b1", summary: "She turns to face the gate.", claimRefs: [], storySectionRef: "sec-1", narrativeRole: "REVEAL" }]);
    const d = decide(shot, scene, {
      visualType: "CHARACTER_SCENE", emotionalCharacterBeat: true, subjectMovement: true,
      physicalInteraction: true, essentialToUnderstanding: true,
      recurringEntities: [{ entityId: "char-7", kind: "CHARACTER", hasApprovedReference: true }],
      referenceAssetIds: ["ref-char-7"],
    }, { beatMap, referenceAssets: [{ assetId: "ref-char-7", kind: "CHARACTER", version: "v1" }] }).decision;
    assert(d.status === "DECISION_READY", "precondition ready");
    // Beat meaning changes → modality stale.
    const changedBeats = beatMapFor([{ beatId: "b1", summary: "Completely different beat meaning now.", claimRefs: [], storySectionRef: "sec-1", narrativeRole: "RESOLUTION" }]);
    const s1 = vm.checkDecisionStaleness(d, { shot, scene, beatMap: changedBeats });
    assert(s1.stale && s1.reasons.some((r) => /beat .*modality stale/.test(r)), "beat change stales modality");
    // Reference availability changes → renderer-only staleness, modality unaffected.
    const s2 = vm.checkDecisionStaleness(d, {
      shot, scene, beatMap,
      referenceAssets: [{ assetId: "ref-char-7", version: "v2" }],
    });
    assert(s2.stale && s2.rendererOnly.length === 1 && /modality unaffected/.test(s2.rendererOnly[0]), "reference change is renderer-scoped");
    // Provider/model availability changes → never stale.
    const s3 = vm.checkDecisionStaleness(d, {
      shot, scene, beatMap,
      referenceAssets: [{ assetId: "ref-char-7", version: "v1" }],
      modelAvailability: { veoFirstFrame: false, veoFirstLast: true },
      supportedCapabilities: ["VIDEO_GENERATION"],
    });
    assert(!s3.stale, "model changes never stale the modality");
  });

  // ---------------- FACTUAL / FICTION / HYBRID MODALITY ----------------
  await runTest("factual numbers → CHART; folklore → dramatized modality without promotion", () => {
    const scene = mkScene("sc-e00ee00ee00e");
    const factual = decide(mkShot("sh-e00ee00ee00a", scene.sceneId, { shotPurpose: "DEMONSTRATE", claimRefs: ["clm-1"] }), scene, {
      visualType: "EVIDENCE", numericTrend: true, subjectMovement: false,
    }, { contentClass: "FACTUAL" }).decision;
    assert(factual.visualModality === "CHART", "numbers/trends → CHART");
    assert(!String(factual.renderMode).startsWith("VEO"), "factual chart never cinematic Veo");
    const folk = decide(mkShot("sh-e00ee00ee00b", scene.sceneId, { shotPurpose: "REVEAL" }), scene, {
      visualType: "ENVIRONMENT", moodWorld: true, reconstructionIntent: false, subjectMovement: false,
      classificationRefs: [{ claimId: "clm-h-000", classification: "FOLKLORE" }],
    }, { contentClass: "HYBRID" }).decision;
    assert(["ATMOSPHERE", "RECONSTRUCTION", "CHARACTER_MOMENT"].includes(folk.visualModality), `folklore dramatized, got ${folk.visualModality}`);
    assert(folk.framing !== "EVIDENCE_VISUAL", "dramatized modality never upgrades folklore to fact");
    const v = vm.validateDecision({ decision: folk, context: {} });
    assert(v.valid, `hybrid decision validates: ${JSON.stringify(v.errors)}`);
  });

  await runTest("fiction horror uses grammar but is not routed entirely to Veo", async () => {
    const draft = {
      draftId: "drf-fhorror-fix1",
      sections: [
        { sectionId: "f1", storyFunction: "hook", claimRefs: [], draftText: "The corridor breathed cold air. Dust drifted in the still atmosphere." },
        { sectionId: "f2", storyFunction: "development", claimRefs: [], draftText: "A cracked portrait covered the wall. Lan read the inscription aloud." },
        { sectionId: "f3", storyFunction: "development", claimRefs: [], draftText: "It lunged from the dark. They ran in a desperate escape, struggling at the gate." },
        { sectionId: "f4", storyFunction: "payoff", claimRefs: [], draftText: "By morning the ward was empty and the door stood open." },
      ],
    };
    const plan = await ss.runStoryToVisualStructure({ projectId: "p-fh", storyDraft: draft, contentClass: "FICTION", platform: "youtube" }, { persist: false });
    assert(plan.status === "VISUAL_STRUCTURE_READY", "structure ready");
    const r = vm.decidePlanProduction({
      projectId: "p-fh", shotPlan: plan.shotPlan, sceneGraph: plan.sceneGraph, beatMap: plan.beatMap,
      contentClass: "FICTION", platform: "youtube", now: NOW,
      signalProvider: (shot, scene) => {
        const beats = (shot.beatIds || []).map((id) => plan.beatMap.beats.find((b) => b.beatId === id)).filter(Boolean);
        const text = beats.map((b) => b.summary || "").join(" ").toLowerCase();
        const sig = { visualType: "ENVIRONMENT" };
        if (/portrait|inscription|read/.test(text)) { sig.visualType = "EVIDENCE"; sig.textualEmphasis = true; }
        if (/breathed|drift|atmosphere|morning|empty/.test(text)) sig.moodWorld = true;
        if (/lunge|ran|escape|struggl/.test(text)) {
          sig.visualType = "CHARACTER_SCENE"; sig.emotionalCharacterBeat = true;
          Object.assign(sig, { subjectMovement: true, physicalInteraction: true, essentialToUnderstanding: true, turningPoint: true });
        }
        for (const k of ["subjectMovement", "physicalInteraction", "essentialToUnderstanding", "temporalTransformation", "environmentalDynamics", "revealProgression", "causeEffectOverTime", "cameraMovementNeeded", "turningPoint", "emotionalPayoff"]) {
          if (sig[k] === undefined) sig[k] = false;
        }
        return sig;
      },
    });
    assert(r.ok, "plan decided");
    const veoCount = r.decisions.filter((d) => String(d.renderMode).startsWith("VEO")).length;
    assert(veoCount >= 1 && veoCount < r.decisions.length, `horror mixed render (${veoCount}/${r.decisions.length} Veo)`);
    for (const d of r.decisions) assert(d.claimRefs.length === 0, "fiction adds zero evidence");
  });

  // ---------------- PLATFORM NEUTRALITY + MEMORY ----------------
  await runTest("platform never dictates modality; orientation still flows from profile", () => {
    const mk = (platform) => {
      const scene = mkScene("sc-f00ff00ff00f");
      return decide(mkShot("sh-f00ff00ff00f", scene.sceneId, { shotPurpose: "DEMONSTRATE" }), scene, {
        visualType: "MAP", spatialMovement: true, cameraMovementNeeded: true,
      }, { platform }).decision;
    };
    const yt = mk("youtube");
    const tt = mk("tiktok");
    assert(yt.visualModality === "MAP", "youtube modality is MAP");
    assert(tt.visualModality === yt.visualModality, "a MAP remains a MAP on any platform");
    assert(yt.requiredCapabilities.includes("LANDSCAPE_OUTPUT") && tt.requiredCapabilities.includes("PORTRAIT_OUTPUT"), "layout adapts per profile");
  });

  await runTest("memory warns on repeated modality patterns without forcing", () => {
    const scene = mkScene("sc-0dec0dec0dec", { beatIds: ["b1", "b2", "b3", "b4", "b5"] });
    const shots = ["sh-0dec0dec0de1", "sh-0dec0dec0de2", "sh-0dec0dec0de3", "sh-0dec0dec0de4", "sh-0dec0dec0de5"]
      .map((id) => mkShot(id, scene.sceneId, { shotPurpose: "DEMONSTRATE", beatIds: scene.beatIds }));
    const plan = {
      version: "1.0.0", shotPlanId: "sp-0dec0dec0dec", projectId: "p-mem",
      platform: "youtube", contentClass: "FACTUAL",
      sourceSceneGraphRef: { sceneGraphId: "sg-0dec0dec0dec", fingerprint: null },
      shots, fingerprint: "0123456789abcdef", status: "GENERATED",
    };
    const signalsByShot = Object.fromEntries(shots.map((s) => [s.shotId, { visualType: "MAP", spatialMovement: true, cameraMovementNeeded: true }]));
    const r = vm.decidePlanProduction({
      projectId: "p-mem", shotPlan: plan, sceneGraph: { scenes: [scene] },
      contentClass: "FACTUAL", platform: "youtube", now: NOW, signalsByShot,
      creativeMemoryContext: { advisoryOnly: true, avoidPatterns: ["same MAP opening repeatedly"] },
    });
    assert(r.ok, "plan decided");
    assert(r.warnings.some((w) => w.startsWith("MEMORY_ADVISORY")), "memory advisory surfaced");
    assert(r.warnings.some((w) => w.startsWith("ANTI_TEMPLATE")), "anti-template grammar check fired");
    assert(r.decisions.every((d) => d.visualModality === "MAP"), "genuinely-required repetition NOT forced to vary");
  });

  console.log(`\n=== FIX 1 visual-story-grammar: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(`FATAL: ${e.stack || e}`); process.exit(1); });

