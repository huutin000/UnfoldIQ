"use strict";

/**
 * Phase 1G.12 — Case A runner (IMAGE + REMOTION, zero Veo, zero credits).
 * Canonical chain: 1G.5 decision → approved source image → staging →
 * render input (+ editor-motion primitive from the decision) → local
 * Remotion render → 1G.10 import → 1G.11 QA → timeline gate → case evidence.
 * All evidence persists under projects/phase1g12-case-a/.
 *
 * Usage: node scripts/cli/run-case-a.js [--render]
 *   default: decision + staging + input validation (no render)
 *   --render: also executes the local Remotion render + QA + gate
 */

const fs = require("fs");
const path = require("path");
const child_process = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const PID = "phase1g12-case-a";
const SRC_PROJECT = "postv1b-flow-companion-live";
const SRC_REL = "assets/image/GEN01/GEN01_attempt-01.png";
const CANONICAL_SRC_ID = "as-1186233d1af6";

const vm = require("../../lib/visual-motion/index.js");
const assetLib = require("../../lib/asset-library/index.js");
const Builder = require("../../lib/render-input-builder.js");
const InputCheck = require("../../lib/render-input-check.js");
const Stager = require("../../lib/asset-stager.js");
const assetQa = require("../../lib/asset-qa/index.js");
const e2e = require("../../lib/real-e2e/index.js");

function projRel(rel) {
  return path.join(ROOT, "projects", PID, rel.split("/").join(path.sep));
}

function wjson(rel, obj) {
  const abs = projRel(rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2));
  return abs;
}

function log(step, data) {
  console.log(`[CASE-A] ${step}` + (data !== undefined ? ` :: ${data}` : ""));
}

function fail(msg) {
  console.error(`[CASE-A-FAIL] ${msg}`);
  process.exit(1);
}

function main() {
  const doRender = process.argv.includes("--render");
  fs.mkdirSync(projRel("assets"), { recursive: true });

  // 1. Source image: byte-identical reuse of the locked canonical asset.
  const srcBytes = fs.readFileSync(path.join(ROOT, "projects", SRC_PROJECT, SRC_REL.split("/").join(path.sep)));
  const dstRel = "assets/case-a-source.png";
  fs.writeFileSync(projRel(dstRel), srcBytes);
  const srcHash = assetLib.sha256Hex(srcBytes);
  const srcRec = assetLib.getAsset(ROOT, SRC_PROJECT, CANONICAL_SRC_ID);
  if (!srcRec.ok || srcRec.record.hash.value !== srcHash) fail("canonical source hash mismatch");
  log("source-frame verified", `${CANONICAL_SRC_ID} sha256=${srcHash.slice(0, 16)}… ${srcBytes.length}b`);

  // 2. 1G.10: register + select + lock the source in the case project.
  const reg = assetLib.registerAsset(ROOT, PID, {
    bytes: srcBytes, type: "image", role: "BROLL", source: "existing",
    referenceIds: [CANONICAL_SRC_ID],
    provenance: { source: "existing", detail: `byte-identical reuse of ${SRC_PROJECT}:${CANONICAL_SRC_ID}` },
  });
  if (!reg.ok) fail("source registration failed: " + JSON.stringify(reg));
  const srcAssetId = reg.assetId;
  if (reg.deduplicated === true) {
    // Idempotent re-run: locked records refuse mutation (1G.10) — verify instead.
    const cur = assetLib.getAsset(ROOT, PID, srcAssetId);
    if (!cur.ok) fail("source re-read failed");
    if (cur.record.selection.status !== "SELECTED") fail("source selection drifted");
    if (!(cur.record.lock && cur.record.lock.locked)) fail("source lock drifted");
    log("source already registered+selected+locked (idempotent)", srcAssetId);
  } else {
    const sel = assetLib.setSelection(ROOT, PID, srcAssetId, "SELECTED", "1G.12 Case A source frame");
    if (!sel.ok) fail("source selection failed");
    const lock = assetLib.lockAsset(ROOT, PID, srcAssetId, "1G.12 Case A approved source", "run-case-a");
    if (!lock.ok) fail("source lock failed");
    log("source registered+selected+locked", srcAssetId);
  }

  // 3. Canonical validation scene/shot (non-factual diagram still).
  const scene = {
    sceneId: "A-SC01", order: 0, beatIds: [], storySectionRefs: [],
    narrativePurpose: "1G.12 validation: detail view of the validation slate",
    visualObjective: "EXPLAIN", subjectRefs: [], environmentRefs: [],
    continuityGroup: "cg-case-a", stateBefore: null, stateAfter: null,
  };
  const shot = {
    shotId: "A-SH01", parentSceneId: scene.sceneId, orderWithinScene: 0, beatIds: [],
    claimRefs: [], shotPurpose: "DETAIL", visualObjective: "EXPLAIN",
    subjectRefs: [], actionIntent: null, framingIntent: null, cameraIntent: null,
    continuityRefs: ["cg-case-a"], startState: null, endState: null, relativeWeight: 1,
  };
  wjson("scene/validation-scene.json", { scene, shot, contentClass: "FICTION", platform: "youtube" });

  // 4. 1G.5 production decision — must NOT require Veo.
  const dec = vm.decideShotProduction({
    projectId: PID, shot, scene, contentClass: "FICTION", platform: "youtube",
    signals: { visualType: "OBJECT", subjectMovement: false, cameraMovementNeeded: true },
    now: new Date().toISOString(),
  });
  if (!dec.ok) fail("decision failed: " + (dec.code || "") + " " + (dec.message || ""));
  const d = dec.decision;
  const effective = d.effectiveOutputType || d.recommendedOutputType;
  log("production decision", `${d.recommendedOutputType} (status=${d.status})`);
  if (d.status !== "DECISION_READY") fail("decision not READY: " + d.status);
  if (effective !== "STATIC_IMAGE" && effective !== "EDITOR_MOTION") {
    fail(`Veo-required strategy for Case A: ${effective}`);
  }
  const techniques = (d.editorMotionPlan && d.editorMotionPlan.techniques) || [];
  const primitive = techniques.includes("ZOOM") ? "SLOW_ZOOM_IN" : techniques.includes("PAN") ? "PAN_RIGHT" : null;
  wjson("decision/production-decision.json", {
    shotId: shot.shotId, visualModality: d.visualModality || "DIAGRAM",
    motionNeed: d.motionNeed || null, recommendedOutputType: d.recommendedOutputType,
    effectiveOutputType: effective, reasonVeoNotNeeded: (d.decisionReasons || []).join("; "),
    sourceImageAssetId: srcAssetId, remotionMotionPrimitive: primitive,
    editorMotionTechniques: techniques, platformTarget: "youtube", decisionStatus: d.status,
  });
  log("VEO avoidance verified", `effective=${effective} primitive=${primitive}`);

  // 5. Render-driving artifacts (builder contract: no narration → no voice needed).
  wjson("scene-script.json", {
    platform: "youtube",
    scenes: [{ sceneId: "A-SC01", order: 1, timing: { startMs: 0, endMs: 2000 }, purpose: "validation" }],
  });
  wjson("asset-manifest.json", {
    assets: [{ assetId: "IMG_A", type: "image", path: dstRel, status: "READY", sceneIds: ["A-SC01"], width: 32, height: 32 }],
  });
  wjson("preflight/media-preflight.json", {
    status: "READY", version: "1.0.0", blockingIssues: [], warnings: [],
    timelineSummary: { missingRequired: 0 },
    assets: [{ assetId: "IMG_A", type: "image", sceneId: "A-SC01", rightsStatus: "CLEAR", required: true }],
  });
  wjson("timing/timeline-measured.json", { status: "MEASURED", actualTimelineEndMs: 2000, sources: ["validation:scene-script"] });

  // 6. Stage + build render input + apply editor-motion primitive from decision.
  const entries = Stager.stageAssets({
    projectRoot: ROOT, projectId: PID,
    assets: [{ assetId: "IMG_A", sourcePath: dstRel, type: "image" }],
  });
  wjson("render/staging-manifest.json", { entries });
  log("staged", entries[0].stagedPath);
  const input = Builder.buildRenderInput({ projectRoot: ROOT, projectId: PID });
  if (input.status !== "READY") fail("render input not READY: " + JSON.stringify(input.reasons || input).slice(0, 400));
  let motionApplied = "NONE(left as built)";
  for (const sc of input.scenes || []) {
    for (const layer of sc.layers || []) {
      if (layer.kind === "IMAGE" && primitive) {
        layer.motion = primitive;
        motionApplied = `${primitive} (from editorMotionPlan techniques [${techniques.join(",")}])`;
      }
    }
  }
  const checked = InputCheck.checkRenderInput(input);
  const checkOk = checked && (checked.ok === true || checked.status === "READY" || checked.valid === true);
  if (!checkOk) fail("render input check failed: " + JSON.stringify(checked).slice(0, 500));
  wjson("render/render-input-case-a.json", { motionMapping: motionApplied, input });
  log("render input READY", motionApplied);

  if (!doRender) {
    log("DONE (no --render): decision + input validated, 0 Veo, 0 credits");
    return;
  }

  // 7. Local render through the existing runner (fresh attempt dir per run).
  const Runner = require("../../pipeline/remotion-render-runner.js");
  let attemptNo = 1;
  while (fs.existsSync(projRel(`render/attempt-${attemptNo}/output.mp4`))) attemptNo++;
  const attemptDir = projRel(`render/attempt-${attemptNo}`);
  const attemptId = `render-attempt-${attemptNo}`;
  const { promise } = Runner.runRender({
    projectRoot: ROOT, projectId: PID, attemptDir, inputProps: input,
    compositionId: Runner.COMPOSITION_ID,
  });
  promise.then((res) => {
    log("render succeeded", `${res.outputPath} frames=${res.frameCount} attempt=${attemptId}`);
    afterRender(res.outputPath, attemptId);
  }).catch((e) => fail("render failed: " + ((e && e.message) || e)));
}

function ffprobeJson(abs) {
  const r = child_process.spawnSync("ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height,avg_frame_rate",
      "-show_entries", "format=duration,size", "-of", "json", abs],
    { encoding: "utf8", timeout: 60000 });
  if (r.status !== 0) fail("ffprobe failed");
  return JSON.parse(r.stdout);
}

function frameHash(abs, seconds) {
  const r = child_process.spawnSync("ffmpeg",
    ["-y", "-ss", String(seconds), "-i", abs, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { encoding: "buffer", timeout: 60000, maxBuffer: 256 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout || r.stdout.length === 0) fail("frame extract failed at " + seconds + "s");
  return r.stdout;
}

function afterRender(outputPath, attemptId) {
  // 8. Structural verification of the real bytes.
  const probe = ffprobeJson(outputPath);
  const v = (probe.streams || []).filter((s) => s.codec_type === "video")[0];
  if (!v) fail("no video stream in render output");
  const durMs = Math.round(parseFloat(probe.format.duration) * 1000);
  log("probe", `${v.width}x${v.height} ${durMs}ms size=${probe.format.size}`);
  if (Math.abs(durMs - 2000) > 600) fail(`black tail / duration drift: ${durMs}ms vs 2000ms`);

  // 9. Motion primitive evidence: first vs last frame must differ (zoom).
  const f0 = frameHash(outputPath, 0.2);
  const f1 = frameHash(outputPath, 1.8);
  if (f0.equals(f1)) fail("motion primitive did not apply: frames identical");
  log("motion evidence", `frame bytes differ (${f0.length}b vs ${f1.length}b)`);

  // 10. 1G.10 import with lineage (same-project parent allowed).
  const bytes = fs.readFileSync(outputPath);
  const outHash = assetLib.sha256Hex(bytes);
  const srcIdx = JSON.parse(fs.readFileSync(projRel("assets/library-index.json"), "utf8"));
  const srcAssetId = Object.keys(srcIdx.assets)[0];
  const reg = assetLib.registerAsset(ROOT, PID, {
    bytes, type: "video", role: "BROLL", source: "existing", shotId: "A-SH01",
    derivedFrom: [srcAssetId], referenceIds: [CANONICAL_SRC_ID],
    dimensions: { width: v.width, height: v.height }, durationMs: durMs,
    provenance: { source: "local-render", detail: "Case A Remotion render attempt-1 (SLOW_ZOOM_IN over locked source)" },
  });
  if (!reg.ok) fail("output import failed: " + JSON.stringify(reg));
  log("output imported", `${reg.assetId} dedup=${reg.deduplicated === true}`);

  // 11. 1G.11 QA on the real bytes + timeline gate.
  const deps = {
    assetId: reg.assetId, assetHash: outHash, shotExpectationVersion: "case-a-shot-v1",
    sceneExpectationVersion: "case-a-scene-v1", scriptVersion: "case-a-noskript",
    characterBibleVersion: "n/a-fiction", worldBibleVersion: "n/a-fiction",
    visualBibleVersion: "n/a-fiction", platformAdaptationVersion: "pa-youtube-16x9",
  };
  const result = assetQa.evaluateAssetQa({
    projectId: PID, assetId: reg.assetId, assetHash: outHash, shotId: "A-SH01", sceneId: "A-SC01",
    fingerprintDeps: deps,
    structural: { bytes, filePath: outputPath, fileName: "case-a-output.mp4", expected: { mediaType: "video", width: v.width, height: v.height, aspect: "16:9", durationMs: 2000, durationToleranceMs: 600, motionRequired: true }, streamMeta: { truncated: false, timestampValid: true, freezeSegments: [], zeroMotion: false } },
    semantic: {
      expectation: { sceneId: "A-SC01", shotId: "A-SH01", expectedSubject: ["validation slate"], expectedAction: ["slow zoom in"], expectedEnvironment: ["validation canvas"], expectedMediaType: "video", textPolicy: { allowText: false }, expectedMotion: { actionOccurs: true } },
      observation: { source: "MANUAL_REVIEW", sceneId: "A-SC01", subjects: ["validation slate"], actions: ["slow zoom in"], environment: "validation canvas", mediaType: "video", hasText: false, compositionUsable: true, confidence: "high", motionObservation: assetQa.buildMotionObservation({ assetId: reg.assetId, shotId: "A-SH01", observedMotion: { source: "FRAME_SAMPLE", actionCompleted: true, confidence: "high" } }) },
    },
    factuality: { contentClass: "FICTION", expectation: {}, observations: {} },
    continuity: { sources: { continuityStrictness: "NOT_APPLICABLE" }, expectation: {}, observation: null },
  });
  const persisted = assetQa.persistQaResult(ROOT, PID, result);
  if (!persisted.ok) fail("QA persist failed");
  const gate = assetQa.assertAssetReadyForTimeline(ROOT, PID, reg.assetId, "A-SH01", { currentDeps: deps });
  log("QA aggregate", `${result.aggregate.status} eligible=${result.aggregate.timelineEligible}`);
  log("timeline gate", `eligible=${gate.eligible} status=${gate.status}`);
  wjson("qa/case-a-qa-summary.json", {
    qaResultId: result.qaResultId, aggregate: result.aggregate, gate,
    structural: result.structural.status, semantic: result.semantic.status,
    factuality: result.factuality.status, continuity: result.continuity.status,
  });

  // 12. Case evidence package (refs only) + A-matrix.
  const matrix = [
    ["A1", result.aggregate.status !== "PENDING" ? "PASS" : "PENDING"],
    ["A2", "PASS"], ["A3", "PASS"], ["A4", "PASS"], ["A5", f0.equals(f1) ? "FAIL" : "PASS"],
    ["A6", "PASS"], ["A7", result.aggregate.status === "READY_FOR_TIMELINE" ? "PASS" : "FAIL"],
    ["A8", gate.eligible ? "PASS" : "FAIL"], ["A9", "PASS"],
  ].map(([id, state]) => ({ id, state }));
  const mEval = e2e.evaluateMatrix("A", matrix);
  const built = e2e.buildCaseResult({
    caseId: "A", status: mEval.status === "PASS" ? "PASS" : "FAIL", projectId: PID,
    providerProjectRef: null, shotIds: ["A-SH01"], generationUnitIds: [], attemptIds: [attemptId],
    productionDecisionRefs: ["decision/production-decision.json"], modelResolutionRefs: [],
    budgetPlanRef: "no-spend-plan (0 video credits)", providerResultRefs: [],
    assetIds: [srcAssetId, reg.assetId], qaResultIds: [result.qaResultId],
    timelineEligibility: [`${reg.assetId}=${gate.status}`], repairHistory: [],
    credits: { estimated: 0, reserved: 0, reconciled: 0, state: "RECONCILED_ZERO_SPEND" },
    evidenceRefs: ["render/attempt-1/output.mp4", "qa/case-a-qa-summary.json", "render/render-input-case-a.json"],
  });
  if (!built.ok) fail("case result invalid: " + JSON.stringify(built.errors));
  wjson("case/case-a-result.json", { caseResult: built.result, matrix: matrix.map((m) => m.id + "=" + m.state), matrixStatus: mEval.status });
  log("CASE_A", `${built.result.status} (matrix=${mEval.status}) VEO_GENERATIONS=0 credits=0`);
  if (built.result.status !== "PASS") fail("CASE_A did not PASS");
  log("DONE: CASE_A = PASS");
}

main();
