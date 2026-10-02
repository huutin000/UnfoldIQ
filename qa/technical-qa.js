"use strict";
// qa/technical-qa.js — STEP-13 Branch C.
// Machine technical QA for a render attempt. Bytes, not meaning: file
// existence, container readability (ffprobe, guarded), stream/dimension/fps
// expectations, audio expectation, output correlation, truncation, duration.
// Never fabricates PASS: ffprobe missing/unreadable -> UNKNOWN checks +
// status REVIEW_REQUIRED.
//
// Expected values resolve in order:
//   dims/fps/duration/audio: attempt.renderConfig.expected* overrides,
//   then projects/<id>/render/render-plan.json composition,
//   then projects/<id>/timing/timeline-measured.json (duration only).
// When unresolvable the check is UNKNOWN (never assumed).
//
// NOTE (schema divergence, documented): schemas/render-qa.schema.json types
// duration.expectedMs/actualMs/deltaMs as number, but this module emits null
// when unmeasurable (ffprobe unavailable) per the STEP-13 spec. Fully
// measured PASS docs are schema-valid; UNKNOWN docs carry explicit nulls
// rather than fabricated numbers.

var childProcess = require("child_process");
var fs = require("fs");
var path = require("path");

var QA_VERSION = "1.0.0";
var DURATION_TOLERANCE_MS = 500;
var PROBE_TIMEOUT_MS = 15000;
var TRUNCATION_FRACTION = 0.5;
var FPS_TOLERANCE = 0.5;

function nowIso() {
  return new Date().toISOString();
}

function toleranceForExpected(expectedMs) {
  if (typeof expectedMs !== "number" || !isFinite(expectedMs) || expectedMs <= 0) {
    return DURATION_TOLERANCE_MS;
  }
  return Math.max(DURATION_TOLERANCE_MS, Math.round(expectedMs * 0.02));
}

function existsFile(abs) {
  try {
    return fs.statSync(abs).isFile();
  } catch (e) {
    return false;
  }
}

function readJsonQuiet(abs) {
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8").replace(/^\uFEFF/, ""));
  } catch (e) {
    return null;
  }
}

// Guarded ffprobe: { ok:true, streams, format, sizeBytes } or
// { ok:false, reason } where reason is ANALYZER_UNAVAILABLE (no ffprobe),
// UNREADABLE (spawn/read failure), or INVALID_CONTAINER (no parseable JSON).
function readProbe(absPath) {
  var sizeBytes = null;
  try {
    var st = fs.statSync(absPath);
    if (!st.isFile()) return { ok: false, reason: "UNREADABLE" };
    sizeBytes = st.size;
  } catch (e) {
    return { ok: false, reason: "UNREADABLE" };
  }
  var r;
  try {
    r = childProcess.spawnSync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", absPath],
      { timeout: PROBE_TIMEOUT_MS, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true }
    );
  } catch (e) {
    return { ok: false, reason: "UNREADABLE" };
  }
  if (r.error) {
    if (r.error.code === "ENOENT") return { ok: false, reason: "ANALYZER_UNAVAILABLE" };
    return { ok: false, reason: "UNREADABLE" };
  }
  if (!r || r.status !== 0 || !r.stdout) {
    return { ok: false, reason: "INVALID_CONTAINER" };
  }
  var data;
  try {
    data = JSON.parse(String(r.stdout));
  } catch (e) {
    return { ok: false, reason: "INVALID_CONTAINER" };
  }
  return {
    ok: true,
    streams: Array.isArray(data.streams) ? data.streams : [],
    format: data.format && typeof data.format === "object" ? data.format : {},
    sizeBytes: sizeBytes
  };
}

function parseFps(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return isFinite(value) && value > 0 ? value : null;
  var s = String(value).trim();
  if (!s || s === "0/0") return null;
  var m = s.match(/^(\d+(?:\.\d+)?)(?:\/(\d+(?:\.\d+)?))?$/);
  if (!m) return null;
  var num = parseFloat(m[1]);
  var den = m[2] === undefined ? 1 : parseFloat(m[2]);
  if (!isFinite(num) || !isFinite(den) || den <= 0 || num <= 0) return null;
  return num / den;
}

function parseDurationMs(value) {
  if (value === null || value === undefined) return null;
  var sec = typeof value === "number" ? value : parseFloat(String(value));
  if (!isFinite(sec) || sec < 0) return null;
  return Math.round(sec * 1000);
}

function parseIntOrNull(value) {
  if (value === null || value === undefined) return null;
  var n = parseInt(String(value), 10);
  return isFinite(n) ? n : null;
}

function resolveOutputAbs(projectRoot, projectId, attempt) {
  var out = attempt && attempt.outputPath;
  if (typeof out !== "string" || out.length === 0) return null;
  if (path.isAbsolute(out)) return out;
  var rel = out.split("/").join(path.sep);
  return path.join(projectRoot, "projects", projectId, rel);
}

function loadPlanComposition(projectRoot, projectId) {
  var abs = path.join(projectRoot, "projects", projectId, "render", "render-plan.json");
  var doc = readJsonQuiet(abs);
  if (doc && doc.composition && typeof doc.composition === "object") return doc.composition;
  return null;
}

function loadPlanAudioExpected(projectRoot, projectId) {
  var abs = path.join(projectRoot, "projects", projectId, "render", "render-plan.json");
  var doc = readJsonQuiet(abs);
  if (!doc || !doc.audioTracks || typeof doc.audioTracks !== "object") return null;
  var kinds = ["voice", "music", "sfx"];
  for (var i = 0; i < kinds.length; i++) {
    var tracks = doc.audioTracks[kinds[i]];
    if (Array.isArray(tracks) && tracks.length > 0) return true;
  }
  return false;
}

function loadTimelineEndMs(projectRoot, projectId) {
  var cands = [
    path.join(projectRoot, "projects", projectId, "timing", "timeline-measured.json"),
    path.join(projectRoot, "projects", projectId, "render", "timeline-measured.json")
  ];
  for (var i = 0; i < cands.length; i++) {
    var doc = readJsonQuiet(cands[i]);
    if (doc && typeof doc.actualTimelineEndMs === "number" && isFinite(doc.actualTimelineEndMs)) {
      return doc.actualTimelineEndMs;
    }
  }
  return null;
}

function runTechnicalQa(args) {
  args = args || {};
  var projectRoot = args.projectRoot;
  var projectId = args.projectId;
  var attempt = args.attempt || {};
  if (!projectRoot || typeof projectRoot !== "string") throw new Error("runTechnicalQa: projectRoot required");
  if (!projectId || typeof projectId !== "string") throw new Error("runTechnicalQa: projectId required");

  var attemptId = attempt.attemptId || "attempt-unknown";
  var pid = attempt.projectId || projectId;
  var cfg = (attempt.renderConfig && typeof attempt.renderConfig === "object") ? attempt.renderConfig : {};

  var outAbs = resolveOutputAbs(projectRoot, projectId, attempt);
  var attemptDir = outAbs ? path.dirname(outAbs) : null;

  var planComp = loadPlanComposition(projectRoot, projectId);

  var expectedWidth = typeof cfg.expectedWidth === "number" ? cfg.expectedWidth
    : (planComp && typeof planComp.width === "number" ? planComp.width : null);
  var expectedHeight = typeof cfg.expectedHeight === "number" ? cfg.expectedHeight
    : (planComp && typeof planComp.height === "number" ? planComp.height : null);
  var expectedFps = typeof cfg.expectedFps === "number" ? cfg.expectedFps
    : (planComp && typeof planComp.fps === "number" ? planComp.fps : null);
  var expectedMs = typeof cfg.expectedDurationMs === "number" ? cfg.expectedDurationMs
    : (planComp && typeof planComp.durationMs === "number" ? planComp.durationMs
      : loadTimelineEndMs(projectRoot, projectId));
  var expectedAudio = typeof cfg.expectedAudio === "boolean" ? cfg.expectedAudio
    : loadPlanAudioExpected(projectRoot, projectId);
  if (expectedAudio === null || expectedAudio === undefined) expectedAudio = false;

  var checks = [];
  function push(check, result, detail) {
    checks.push({ check: check, result: result, detail: String(detail || "") });
  }

  var fileOk = !!outAbs && existsFile(outAbs);
  push("file-exists", fileOk ? "PASS" : "FAIL",
    fileOk ? "output present: " + outAbs : "output missing: " + String((attempt && attempt.outputPath) || "none"));

  var sizeBytes = null;
  if (!fileOk) {
    push("non-zero-size", "FAIL", "no file to measure");
  } else {
    try {
      sizeBytes = fs.statSync(outAbs).size;
    } catch (e) {
      sizeBytes = null;
    }
    push("non-zero-size", (typeof sizeBytes === "number" && sizeBytes > 0) ? "PASS" : "FAIL",
      "sizeBytes=" + String(sizeBytes));
  }

  var probe = outAbs ? readProbe(outAbs) : { ok: false, reason: "UNREADABLE" };
  var probeUnavailable = !probe.ok && probe.reason === "ANALYZER_UNAVAILABLE";

  if (probe.ok) {
    push("readable-container", "PASS", "ffprobe parsed streams+format");
  } else if (probeUnavailable) {
    push("readable-container", "UNKNOWN", "ANALYZER_UNAVAILABLE: ffprobe not on PATH; container not verified");
  } else {
    push("readable-container", "FAIL", "probe failed: " + probe.reason);
  }

  var video = null;
  var audio = null;
  var actualMs = null;
  if (probe.ok) {
    var streams = probe.streams;
    for (var i = 0; i < streams.length; i++) {
      if (streams[i] && streams[i].codec_type === "video" && !video) video = streams[i];
      if (streams[i] && streams[i].codec_type === "audio" && !audio) audio = streams[i];
    }
    actualMs = parseDurationMs(probe.format.duration);
    if (actualMs === null && video) actualMs = parseDurationMs(video.duration);
  }

  if (!probe.ok && probeUnavailable) {
    push("video-stream", "UNKNOWN", "ANALYZER_UNAVAILABLE");
  } else {
    push("video-stream", video ? "PASS" : "FAIL",
      video ? ("codec=" + (video.codec_name || "?")) : "no video stream in container");
  }

  if (!probe.ok && probeUnavailable) {
    push("dims-match", "UNKNOWN", "ANALYZER_UNAVAILABLE");
  } else if (video && expectedWidth && expectedHeight) {
    var w = parseIntOrNull(video.width);
    var h = parseIntOrNull(video.height);
    push("dims-match", (w === expectedWidth && h === expectedHeight) ? "PASS" : "FAIL",
      "expected=" + expectedWidth + "x" + expectedHeight + " actual=" + w + "x" + h);
  } else if (video) {
    push("dims-match", "UNKNOWN", "no expected dimensions resolvable; actual=" +
      parseIntOrNull(video.width) + "x" + parseIntOrNull(video.height));
  } else {
    push("dims-match", "FAIL", "no video stream to measure");
  }

  if (!probe.ok && probeUnavailable) {
    push("fps-match", "UNKNOWN", "ANALYZER_UNAVAILABLE");
  } else if (video && typeof expectedFps === "number") {
    var actualFps = parseFps(video.avg_frame_rate !== undefined ? video.avg_frame_rate : video.r_frame_rate);
    if (actualFps === null) {
      push("fps-match", "UNKNOWN", "fps not reported by probe");
    } else {
      push("fps-match", Math.abs(actualFps - expectedFps) <= FPS_TOLERANCE ? "PASS" : "FAIL",
        "expected=" + expectedFps + " actual=" + actualFps.toFixed(3));
    }
  } else if (video) {
    push("fps-match", "UNKNOWN", "no expected fps resolvable");
  } else {
    push("fps-match", "FAIL", "no video stream to measure");
  }

  if (!probe.ok && probeUnavailable) {
    push("audio-expected", "UNKNOWN", "ANALYZER_UNAVAILABLE");
  } else if (expectedAudio && !audio) {
    push("audio-expected", "FAIL", "narration/mix expected but no audio stream present");
  } else if (expectedAudio && audio) {
    push("audio-expected", "PASS", "audio stream present as expected");
  } else if (!expectedAudio && !audio) {
    push("audio-expected", "PASS", "no audio expected and none present");
  } else {
    push("audio-expected", "PASS", "audio present; none required (note only, never failed)");
  }

  if (!fileOk) {
    push("output-correlation", "FAIL", "no output file to correlate");
  } else if (!attemptDir || !outAbs) {
    push("output-correlation", "FAIL", "outputPath unresolvable");
  } else {
    var inside = outAbs.indexOf(attemptDir + path.sep) === 0 || outAbs === path.join(attemptDir, path.basename(outAbs));
    var probedSize = probe.ok && probe.format && probe.format.size !== undefined
      ? parseInt(String(probe.format.size), 10) : null;
    var sizeMatch = (probedSize === null || sizeBytes === null) ? null : (probedSize === sizeBytes);
    if (!inside) {
      push("output-correlation", "FAIL", "outputPath outside attempt dir: " + outAbs);
    } else if (sizeMatch === false) {
      push("output-correlation", "FAIL",
        "size mismatch fs=" + sizeBytes + " probe=" + probedSize);
    } else if (sizeMatch === null) {
      push("output-correlation", (!probe.ok && probeUnavailable) ? "UNKNOWN" : "REVIEW",
        "size cross-check unavailable (probe size not reported); path inside attempt dir");
    } else {
      push("output-correlation", "PASS",
        "inside attempt dir; sizeBytes=" + sizeBytes + " matches probe");
    }
  }

  if (actualMs === null || typeof expectedMs !== "number") {
    push("truncation", "UNKNOWN",
      "needs measured actualMs and expectedMs (actual=" + String(actualMs) + " expected=" + String(expectedMs) + ")");
  } else {
    push("truncation", actualMs >= expectedMs * TRUNCATION_FRACTION ? "PASS" : "FAIL",
      "actualMs=" + actualMs + " expectedMs=" + expectedMs + " floor50%=" + Math.round(expectedMs * TRUNCATION_FRACTION));
  }

  var toleranceMs = toleranceForExpected(typeof expectedMs === "number" ? expectedMs : null);
  var deltaMs = (typeof expectedMs === "number" && typeof actualMs === "number") ? (actualMs - expectedMs) : null;
  var durationResult;
  if (deltaMs === null) {
    durationResult = "UNKNOWN";
  } else {
    durationResult = Math.abs(deltaMs) <= toleranceMs ? "PASS" : "FAIL";
  }
  var duration = {
    expectedMs: typeof expectedMs === "number" ? expectedMs : null,
    actualMs: typeof actualMs === "number" ? actualMs : null,
    deltaMs: deltaMs,
    toleranceMs: toleranceMs,
    result: durationResult
  };

  var summary = { pass: 0, fail: 0, review: 0, unknown: 0 };
  checks.forEach(function (c) {
    if (c.result === "PASS") summary.pass += 1;
    else if (c.result === "FAIL") summary.fail += 1;
    else if (c.result === "REVIEW") summary.review += 1;
    else summary.unknown += 1;
  });
  if (durationResult === "FAIL") summary.fail += 0; // duration is reported separately, not double-counted
  var status = summary.fail > 0 || durationResult === "FAIL" ? "FAIL"
    : (summary.unknown > 0 || summary.review > 0 || durationResult !== "PASS") ? "REVIEW_REQUIRED" : "PASS";

  return {
    version: QA_VERSION,
    projectId: pid,
    attemptId: attemptId,
    generatedAt: nowIso(),
    checks: checks,
    summary: summary,
    duration: duration,
    status: status,
    reviewState: "MACHINE_CHECKED",
    outputPath: (attempt && attempt.outputPath) || null,
    sizeBytes: sizeBytes
  };
}

module.exports = {
  runTechnicalQa: runTechnicalQa,
  readProbe: readProbe,
  toleranceForExpected: toleranceForExpected,
  DURATION_TOLERANCE_MS: DURATION_TOLERANCE_MS,
  PROBE_TIMEOUT_MS: PROBE_TIMEOUT_MS
};
