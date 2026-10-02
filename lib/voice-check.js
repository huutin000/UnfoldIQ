"use strict";
// lib/voice-check.js — STEP-11 Branch B
// QA gate for a single narration voice artifact.
// Render-ready voice requires timingStatus MEASURED (probe-measured duration).
// Never fabricates timing/metadata/loudness. No network, no installs.

var fs = require("fs");
var path = require("path");

function checkVoice(opts) {
  opts = opts || {};
  var projectRoot = opts.projectRoot;
  var projectId = opts.projectId;
  var voice = opts.voice || {};
  var audioId = voice.audioId || voice.id || "unknown";
  var checks = [];
  var blocksReady = false;

  function push(check, status, detail, block) {
    checks.push({ check: check, status: status, detail: detail });
    if (block) blocksReady = true;
  }

  // Resolve artifact path
  var absPath = null;
  if (voice.path) {
    absPath = path.isAbsolute(String(voice.path))
      ? String(voice.path)
      : projectRoot
        ? path.join(String(projectRoot), String(voice.path))
        : String(voice.path);
    // also try projects/<id>/ prefix when projectRoot points at repo root
    if (!fs.existsSync(absPath) && projectRoot && projectId) {
      var alt = path.join(String(projectRoot), "projects", String(projectId), String(voice.path));
      if (fs.existsSync(alt)) absPath = alt;
    }
  }

  var fileExists = !!(absPath && fs.existsSync(absPath));
  if (!absPath || !fileExists) {
    push("FILE_EXISTS", "FAIL", "MISSING_FILE — artifact not found: " + (voice.path || "(no path)"), true);
    // PRONUNCIATION always present
    push("PRONUNCIATION", "PASS", "NOT_REVIEWED — pronunciation never auto-claimed", false);
    var qaNoFile = voice.optional ? "PLANNED" : "BLOCKED";
    return {
      audioId: audioId,
      qaStatus: qaNoFile,
      durationMs: null,
      timingStatus: "UNKNOWN",
      checks: checks,
      blocksReady: voice.optional ? false : true
    };
  }
  push("FILE_EXISTS", "PASS", "Artifact present: " + absPath, false);

  // size > 0
  var size = -1;
  try {
    size = fs.statSync(absPath).size;
  } catch (e) {
    push("FILE_SIZE", "FAIL", "STAT_FAILED — " + (e && e.message ? e.message : String(e)), true);
    size = -1;
  }
  if (size === 0) {
    push("FILE_SIZE", "FAIL", "ZERO_BYTE — file is 0 bytes", true);
  } else if (size > 0) {
    push("FILE_SIZE", "PASS", "size " + size + " bytes", false);
  }

  // Duration measurable via media-probe (Branch A creates lib/media-probe.js). Lazy require.
  var durationMs = null;
  var timingStatus = "UNKNOWN";
  var timingSource = null;
  if (size !== 0) {
    var measured = null;
    try {
      var probe = require("./media-probe");
      if (probe && typeof probe.probe === "function") {
        var r = probe.probe(absPath);
        var md = (r && r.metadata) || r || {};
        if (md && typeof md.durationMs === "number" && isFinite(md.durationMs) && md.durationMs > 0) {
          measured = Math.round(md.durationMs);
          if (r && r.evidence && r.evidence.source) timingSource = r.evidence.source;
        } else if (md && typeof md.durationMs === "number" && md.durationMs === 0) {
          measured = 0;
        }
      }
    } catch (e) {
      measured = null;
    }
    if (measured !== null && measured > 0) {
      durationMs = measured;
      timingStatus = "MEASURED";
      push("DURATION", "PASS", "Measured durationMs=" + durationMs, false);
    } else if (typeof voice.durationMs === "number" && isFinite(voice.durationMs) && voice.durationMs > 0) {
      durationMs = Math.round(voice.durationMs);
      timingStatus = "UNKNOWN";
      timingSource = "provided";
      push("DURATION", "REVIEW", "DURATION_UNKNOWN — probe unmeasurable; using provided durationMs=" + durationMs + " (timingSource=provided, not measured)", false);
    } else {
      push("DURATION", "REVIEW", "DURATION_UNKNOWN — duration unmeasurable", false);
    }
  }

  // Language
  var expected = voice.expectedLanguage || voice.expectedLang;
  var lang = voice.language || voice.lang;
  if (expected && lang && String(expected).toLowerCase() !== String(lang).toLowerCase()) {
    push("LANGUAGE", "REVIEW", "LANGUAGE_MISMATCH — expected " + expected + " got " + lang, false);
  } else if (expected && lang) {
    push("LANGUAGE", "PASS", "language " + lang, false);
  } else {
    push("LANGUAGE", "PASS", "No language mismatch claimable (expected=" + (expected || "n/a") + " lang=" + (lang || "n/a") + ")", false);
  }

  // Alignment when plannedText + transcriptText present
  if (voice.plannedText !== undefined && voice.plannedText !== null &&
      voice.transcriptText !== undefined && voice.transcriptText !== null &&
      String(voice.plannedText).trim() !== "" && String(voice.transcriptText).trim() !== "") {
    var alignment = null;
    try {
      var ta = require("./transcript-alignment");
      alignment = ta.alignScriptTranscript(voice.plannedText, voice.transcriptText);
    } catch (e) {
      push("ALIGNMENT", "REVIEW", "ALIGNMENT_ERROR — " + (e && e.message ? e.message : String(e)), false);
    }
    if (alignment) {
      if (alignment.classification === "MATERIAL_DIFFERENCE") {
        var reason = (alignment.differences && alignment.differences[0] && alignment.differences[0].reason) || "MATERIAL";
        push("ALIGNMENT", "REVIEW", "TRANSCRIPT_MATERIAL_MISMATCH — " + reason, true);
      } else if (alignment.classification === "MINOR_DIFFERENCE") {
        push("ALIGNMENT", "PASS", "Minor transcript difference (punctuation/case/filler)", false);
      } else if (alignment.classification === "MATCH") {
        push("ALIGNMENT", "PASS", "Transcript matches script", false);
      } else {
        push("ALIGNMENT", "REVIEW", "Transcript classification UNKNOWN", false);
      }
    }
  } else {
    push("ALIGNMENT", "PASS", "No plannedText+transcriptText pair — alignment skipped (not claimed)", false);
  }

  // Truncation: plannedDurationMs set and measured < 50%
  if (typeof voice.plannedDurationMs === "number" && durationMs !== null) {
    if (durationMs < voice.plannedDurationMs * 0.5) {
      push("TRUNCATION", "FAIL", "TRUNCATED_NARRATION — measured " + durationMs + "ms < 50% of planned " + voice.plannedDurationMs + "ms", true);
    } else {
      push("TRUNCATION", "PASS", "measured " + durationMs + "ms vs planned " + voice.plannedDurationMs + "ms", false);
    }
  }

  // Leading silence
  if (Array.isArray(voice.segments) && voice.segments.length > 0) {
    var first = voice.segments[0];
    if (first && typeof first.startMs === "number" && first.startMs > 2000) {
      push("LEADING_SILENCE", "REVIEW", "LEADING_SILENCE — first segment starts at " + first.startMs + "ms", false);
    } else {
      push("LEADING_SILENCE", "PASS", "No leading silence claim", false);
    }
    var last = voice.segments[voice.segments.length - 1];
    if (durationMs !== null && last && typeof last.endMs === "number") {
      var tail = durationMs - last.endMs;
      if (tail > 3000) {
        push("TRAILING_SILENCE", "REVIEW", "TRAILING_SILENCE — trailing gap " + tail + "ms", false);
      } else {
        push("TRAILING_SILENCE", "PASS", "No trailing silence claim", false);
      }
    } else {
      push("TRAILING_SILENCE", "PASS", "Trailing silence not measurable — not claimed", false);
    }
  }

  // Pronunciation: always PASS NOT_REVIEWED
  push("PRONUNCIATION", "PASS", "NOT_REVIEWED — pronunciation never auto-claimed", false);

  var hasFail = checks.some(function (c) { return c.status === "FAIL"; });
  var hasReview = checks.some(function (c) { return c.status === "REVIEW"; });
  var qaStatus = "READY";
  if (hasFail) qaStatus = "BLOCKED";
  else if (hasReview) qaStatus = "REVIEW_REQUIRED";

  return {
    audioId: audioId,
    qaStatus: qaStatus,
    durationMs: durationMs,
    timingStatus: timingStatus,
    checks: checks,
    blocksReady: blocksReady
  };
}

module.exports = { checkVoice: checkVoice };
