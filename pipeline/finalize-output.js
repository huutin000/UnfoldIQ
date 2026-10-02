"use strict";
// pipeline/finalize-output.js — STEP-13 Branch B (orchestration side).
// finalize({projectRoot,projectId,attemptId,opts}) promotes a fully accepted
// attempt output to out/<projectId>/final.mp4 (atomic tmp+rename) plus
// sidecars. Guards: attempt PASSED (or RENDERED + QA PASS recorded),
// fingerprint current (else STALE_INPUT), no blockers, no OPEN ERROR/BLOCKER
// issues, technical PASS + acceptable visual review. Never deletes attempt
// evidence. No network, no AI, no provider calls.

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

function tryRequire(abs) {
  try {
    return require(abs);
  } catch (e) {
    return null;
  }
}

function readJson(abs) {
  return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
}

function writeJson(abs, obj) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(obj, null, 2), "utf8");
}

function existsFile(abs) {
  try {
    return fs.statSync(abs).isFile();
  } catch (e) {
    return false;
  }
}

function loadStateDoc(projectRoot, projectId) {
  var SS = tryRequire(path.join(__dirname, "state-store.js"));
  if (SS && typeof SS.loadState === "function") {
    var s = SS.loadState(projectRoot, projectId);
    if (s && !(s.status === "NEW" && !(s.attempts || []).length)) return s;
    return null;
  }
  var legacy = path.join(projectRoot, "projects", projectId, "render", "pipeline-state.json");
  try {
    return readJson(legacy);
  } catch (e) {
    return null;
  }
}

function fingerprintIdOf(fp) {
  if (!fp) return null;
  if (typeof fp.fingerprintId === "string") return fp.fingerprintId;
  if (typeof fp.hash === "string") return fp.hash;
  try {
    var FP = tryRequire(path.join(__dirname, "input-fingerprint.js"));
    if (FP) return FP.fingerprintIdOf(fp);
  } catch (e) {}
  return null;
}
function fail(code, message, extra) {
  var err = new Error(code + ": " + message);
  err.code = code;
  if (extra && typeof extra === "object") {
    Object.keys(extra).forEach(function (k) { err[k] = extra[k]; });
  }
  throw err;
}

function sha256File(abs) {
  var h = crypto.createHash("sha256");
  var fd = fs.openSync(abs, "r");
  try {
    var buf = Buffer.alloc(1024 * 1024);
    var n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      h.update(buf.slice(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
}

// Best-effort duration via ffprobe when present; otherwise null (caller
// falls back to plan frames). Guarded: ffprobe absence is not an error.
function probeDurationMs(outputAbs) {
  try {
    var cp = require("child_process");
    var r = cp.spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", outputAbs], { encoding: "utf8", timeout: 15000 });
    if (r && r.status === 0 && r.stdout) {
      var secs = parseFloat(String(r.stdout).trim());
      if (isFinite(secs) && secs > 0) return Math.round(secs * 1000);
    }
  } catch (e) {}
  return null;
}

function currentFingerprint(projectRoot, projectId) {
  var Builder = tryRequire(path.join(__dirname, "..", "lib/render-input-builder.js"));
  if (!Builder) return null;
  var FP = tryRequire(path.join(__dirname, "input-fingerprint.js"));
  var renderDir = path.join(projectRoot, "projects", projectId, "render");
  var input = Builder.buildRenderInput({ projectRoot: projectRoot, projectId: projectId });
  var plan = readJson(path.join(renderDir, "render-plan.json"));
  var staging = null;
  try {
    staging = readJson(path.join(renderDir, "staging-manifest.json"));
  } catch (e) {}
  var docs = { renderInput: input, renderPlan: plan, stagingManifest: staging };
  if (FP) return FP.computeFingerprint(projectRoot, projectId, docs);
  var Orch = tryRequire(path.join(__dirname, "render-orchestrator.js"));
  if (!Orch) return null;
  return Orch.computeFingerprint(projectRoot, projectId, docs);
}

function finalize(args) {
  args = args || {};
  var projectRoot = args.projectRoot;
  var projectId = args.projectId;
  var attemptId = args.attemptId;
  var opts = args.opts || {};
  if (!projectRoot || typeof projectRoot !== "string") fail("BAD_ARGS", "projectRoot required");
  if (!projectId || typeof projectId !== "string") fail("BAD_ARGS", "projectId required");

  var renderDir = path.join(projectRoot, "projects", projectId, "render");
  var state = loadStateDoc(projectRoot, projectId);
  if (!state) fail("NO_STATE", "no pipeline state for " + projectId);

  var attempt = null;
  if (attemptId) {
    (state.attempts || []).forEach(function (a) {
      if (a && (a.attemptId === attemptId || String(a.number) === String(attemptId))) attempt = a;
    });
    if (!attempt) fail("UNKNOWN_ATTEMPT", "no such attempt: " + attemptId);
  } else {
    var list = state.attempts || [];
    attempt = list.length ? list[list.length - 1] : null;
    if (!attempt) fail("NO_ATTEMPTS", "no attempts to finalize");
  }

  // Guard 1: attempt PASSED, or RENDERED with QA PASS recorded.
  var techStatus = attempt.technicalQa && attempt.technicalQa.status;
  var accepted = attempt.status === "PASSED" ||
    (attempt.status === "RENDERED" && techStatus === "PASS");
  if (!accepted) {
    fail("NOT_ACCEPTED", "attempt " + attempt.attemptId + " status=" + attempt.status +
      " technicalQa=" + (techStatus || "none") + "; need PASSED or RENDERED+QA PASS",
      { attemptId: attempt.attemptId });
  }

  // Guard 2: fingerprint current (fingerprintId comparison; legacy hash fallback).
  var fpNow = null;
  try {
    fpNow = currentFingerprint(projectRoot, projectId);
  } catch (e) {
    fail("STALE_INPUT", "cannot recompute fingerprint: " + ((e && e.message) || String(e)));
  }
  var thenId = fingerprintIdOf(attempt.inputFingerprint);
  var nowId = fingerprintIdOf(fpNow);
  if (thenId && nowId && thenId !== nowId) {
    fail("STALE_INPUT", "attempt fingerprint " + thenId + " != current " + nowId,
      { attemptId: attempt.attemptId });
  }

  // Guard 3: no blockers.
  if (Array.isArray(state.blockers) && state.blockers.length) {
    fail("BLOCKED", state.blockers.length + " blocker(s) present", { attemptId: attempt.attemptId });
  }

  // Guard 4: no OPEN ERROR/BLOCKER issues (Branch A severities).
  var openSevere = (state.issues || []).filter(function (i) {
    if (!i || i.status !== "OPEN") return false;
    if (i.severity === "BLOCKER" || i.severity === "ERROR") return true;
    if (i.blocking === true) return true;
    return /ERROR|BLOCKER|FAILED/i.test(String(i.code || "") + " " + String(i.severity || ""));
  });
  if (openSevere.length) {
    fail("BLOCKED", openSevere.length + " open ERROR/BLOCKER issue(s)",
      { attemptId: attempt.attemptId });
  }

  // Guard 5: technical PASS recorded.
  if (techStatus !== "PASS" && attempt.status !== "PASSED") {
    fail("QA_NOT_PASSING", "technical QA status=" + (techStatus || "none"), { attemptId: attempt.attemptId });
  }

  // Guard 6: visual acceptable — a human/agent review decision APPROVE
  // (reviewState HUMAN_REVIEWED/AGENT_REVIEWED), or for TEST-ONLY fixtures a
  // machine check when opts.allowMachineOnly is true. visualQa null otherwise
  // blocks production promotion.
  var vq = attempt.visualQa || null;
  var visualDecision = vq && (vq.decision || vq.status);
  var reviewState = vq && (vq.reviewState || vq.review_state);
  var visualOk = visualDecision === "APPROVE" ||
    reviewState === "HUMAN_REVIEWED" || reviewState === "AGENT_REVIEWED" ||
    (opts.allowMachineOnly === true && (visualDecision === "MACHINE_CHECKED" || techStatus === "PASS"));
  if (!visualOk) {
    fail("VISUAL_REVIEW_REQUIRED", "no APPROVE/HUMAN_REVIEWED/AGENT_REVIEWED visual decision" +
      (opts.allowMachineOnly === true ? "" : " (hint: TEST-ONLY fixtures may pass allowMachineOnly:true)"),
      { attemptId: attempt.attemptId });
  }

  // Guard 7: output file exists.
  var outputAbs = attempt.outputPath && path.isAbsolute(attempt.outputPath)
    ? attempt.outputPath
    : path.join(renderDir, "attempts", attempt.attemptId, "output.mp4");
  if (!existsFile(outputAbs)) fail("OUTPUT_MISSING", "attempt output not found: " + outputAbs);

  // Promote atomically; keep previous final.
  var outDir = path.join(projectRoot, "out", projectId);
  fs.mkdirSync(outDir, { recursive: true });
  var finalAbs = path.join(outDir, "final.mp4");
  var prevAbs = path.join(outDir, "final.prev.mp4");
  if (existsFile(finalAbs)) {
    try {
      fs.copyFileSync(finalAbs, prevAbs);
    } catch (e) {}
  }
  var tmpAbs = path.join(outDir, "final.mp4.tmp-" + process.pid);
  fs.copyFileSync(outputAbs, tmpAbs);
  fs.renameSync(tmpAbs, finalAbs);

  // Sidecars: captions + render manifest + QA report + provenance summary.
  var plan = readJson(path.join(renderDir, "render-plan.json"));
  var sidecars = [];
  function copySidecar(srcAbs, destName) {
    if (!existsFile(srcAbs)) return null;
    var dest = path.join(outDir, destName);
    fs.copyFileSync(srcAbs, dest);
    sidecars.push(destName);
    return destName;
  }
  copySidecar(path.join(projectRoot, "projects", projectId, "captions", "captions.srt"), "captions.srt");
  copySidecar(path.join(projectRoot, "projects", projectId, "captions", "captions.vtt"), "captions.vtt");
  copySidecar(path.join(renderDir, "render-plan.json"), "render-plan.json");
  copySidecar(path.join(renderDir, "staging-manifest.json"), "staging-manifest.json");
  copySidecar(path.join(renderDir, "attempts", attempt.attemptId, "qa", "technical-qa.json"), "qa-report.json");

  var comp = plan.composition || {};
  var durationMs = probeDurationMs(finalAbs);
  if (durationMs === null && typeof comp.durationMs === "number") durationMs = comp.durationMs;
  var stat = fs.statSync(finalAbs);
  var artifact = {
    version: "1.0.0",
    projectId: projectId,
    attemptId: attempt.attemptId,
    createdAt: new Date().toISOString(),
    finalPath: ["out", projectId, "final.mp4"].join("/"),
    sha256: sha256File(finalAbs),
    sizeBytes: stat.size,
    durationMs: durationMs,
    durationInFrames: comp.durationInFrames || null,
    width: comp.width || null,
    height: comp.height || null,
    fps: comp.fps || null,
    codec: (attempt.renderConfig && attempt.renderConfig.codec) || "h264",
    audio: { tracks: ["voice", "music", "sfx"] },
    captions: { mode: (plan.captionTrack && plan.captionTrack.mode) || null,
      sidecars: sidecars.filter(function (s) { return /^captions\./.test(s); }) },
    inputFingerprint: attempt.inputFingerprint || null,
    renderPlanHash: attempt.renderPlanHash || plan.planHash || null,
    qa: { technical: techStatus || null, visual: visualDecision || reviewState || null },
    provenance: { planGeneratedAt: plan.generatedAt || null, platform: plan.platform || null },
    sidecars: sidecars
  };
  writeJson(path.join(outDir, "final-artifact.json"), artifact);
  writeJson(path.join(outDir, "provenance.json"), {
    version: "1.0.0",
    projectId: projectId,
    attemptId: attempt.attemptId,
    finalizedAt: artifact.createdAt,
    inputFingerprint: artifact.inputFingerprint,
    renderPlanHash: artifact.renderPlanHash,
    sha256: artifact.sha256
  });
  sidecars.push("final-artifact.json");
  sidecars.push("provenance.json");

  // Branch A compatibility record: pipeline/reconcile.js checks
  // projects/<id>/render/final-artifact.json with {outputPath, inputFingerprint}.
  // Attempt evidence is never deleted — no cleanup of attempts/ here.
  try {
    writeJson(path.join(renderDir, "final-artifact.json"), {
      version: artifact.version,
      projectId: projectId,
      attemptId: attempt.attemptId,
      createdAt: artifact.createdAt,
      outputPath: ["out", projectId, "final.mp4"].join("/"),
      inputFingerprint: attempt.inputFingerprint || null,
      renderPlanHash: artifact.renderPlanHash,
      sha256: artifact.sha256,
      sizeBytes: artifact.sizeBytes
    });
  } catch (e) {}

  return { ok: true, projectId: projectId, attemptId: attempt.attemptId,
    finalPath: ["out", projectId, "final.mp4"].join("/"),
    artifactPath: ["out", projectId, "final-artifact.json"].join("/"),
    sha256: artifact.sha256, sizeBytes: artifact.sizeBytes, sidecars: sidecars };
}

module.exports = {
  finalize: finalize
};
