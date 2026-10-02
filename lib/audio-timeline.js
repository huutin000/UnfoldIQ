"use strict";
// lib/audio-timeline.js — STEP-11 Branch B
// Measured-timeline assembly from voice/music/sfx tracks + intentional tails.
// Anonymous silence is always rejected. Never auto playbackRate. No fabrication.

function toNum(v, d) {
  return (typeof v === "number" && isFinite(v)) ? v : d;
}

function maxEnd(clips) {
  var m = 0;
  (clips || []).forEach(function (c) {
    var s = toNum(c.startMs, 0);
    var d = toNum(c.durationMs, 0);
    var e = s + d;
    if (e > m) m = e;
  });
  return m;
}

function buildAudioTimeline(opts) {
  opts = opts || {};
  var voice = Array.isArray(opts.voice) ? opts.voice : [];
  var music = Array.isArray(opts.music) ? opts.music : [];
  var sfx = Array.isArray(opts.sfx) ? opts.sfx : [];
  var intentionalTails = Array.isArray(opts.intentionalTails) ? opts.intentionalTails : [];

  var conflicts = [];
  var tails = [];
  var issues = [];

  // Validate times; compute ends
  function endOf(c) { return toNum(c.startMs, 0) + toNum(c.durationMs, 0); }

  // Overlapping voice clips → VOICE_OVERLAP (block)
  var sortedVoice = voice.slice().sort(function (a, b) { return toNum(a.startMs, 0) - toNum(b.startMs, 0); });
  for (var i = 1; i < sortedVoice.length; i++) {
    var prevEnd = endOf(sortedVoice[i - 1]);
    var curStart = toNum(sortedVoice[i].startMs, 0);
    if (curStart < prevEnd) {
      conflicts.push({ kind: "VOICE_OVERLAP", detail: "Voice clips overlap: index " + (i - 1) + " end " + prevEnd + " vs start " + curStart, blocksReady: true });
    }
  }

  // music/sfx negative times → INVALID_TIME (block)
  music.concat(sfx).concat(voice).forEach(function (c, idx) {
    if (toNum(c.startMs, 0) < 0 || toNum(c.durationMs, NaN) < 0 || !isFinite(toNum(c.durationMs, NaN))) {
      conflicts.push({ kind: "INVALID_TIME", detail: "Negative/invalid time on clip index " + idx + " (" + JSON.stringify({ startMs: c.startMs, durationMs: c.durationMs }) + ")", blocksReady: true });
    }
  });

  var voiceEndMs = voice.length ? maxEnd(voice) : 0;
  var musicEndMs = music.length ? maxEnd(music) : 0;
  var sfxEndMs = sfx.length ? maxEnd(sfx) : 0;

  // Intentional tails: purpose required else REJECTED as anonymous
  var tailEnds = [];
  intentionalTails.forEach(function (t, idx) {
    t = t || {};
    var kind = String(t.kind || "");
    var purpose = t.purpose;
    var hasPurpose = typeof purpose === "string" && purpose.trim() !== "";
    // Any gap claim like silence-tail / pad-to-target or tail without purpose → rejected
    if (kind === "silence-tail" || kind === "pad-to-target" || !hasPurpose) {
      issues.push({ kind: "ANONYMOUS_SILENCE_REJECTED", detail: "Tail " + idx + " kind=" + (kind || "(none)") + " rejected: anonymous silence (purpose required)", blocksReady: true });
      tails.push({ kind: kind || "unknown", startMs: t.startMs, endMs: t.endMs, purpose: purpose || null, status: "REJECTED" });
      return;
    }
    if (t.kind !== "outro" && t.kind !== "music-tail" && t.kind !== "visual-hold") {
      issues.push({ kind: "ANONYMOUS_SILENCE_REJECTED", detail: "Tail " + idx + " kind=" + kind + " rejected: unknown tail kind", blocksReady: true });
      tails.push({ kind: kind, startMs: t.startMs, endMs: t.endMs, purpose: purpose, status: "REJECTED" });
      return;
    }
    tails.push({ kind: t.kind, startMs: t.startMs, endMs: t.endMs, purpose: purpose, status: "ACCEPTED" });
    if (typeof t.endMs === "number" && isFinite(t.endMs)) tailEnds.push(t.endMs);
  });

  // SFX without purpose or purpose filler → warning FILLER_SFX (blocksReady false but review)
  sfx.forEach(function (c, idx) {
    var p = c.purpose;
    if (!p || (typeof p === "string" && (p.trim() === "" || p === "filler"))) {
      issues.push({ kind: "FILLER_SFX", detail: "SFX clip " + idx + " (" + (c.clipId || c.audioId || c.id || idx) + ") without purpose — review", blocksReady: false, review: true });
    }
  });

  var tailMax = tailEnds.length ? Math.max.apply(null, tailEnds) : 0;
  var actualEndMs = Math.max(voiceEndMs, musicEndMs, sfxEndMs, tailMax);

  var blocked = conflicts.some(function (c) { return c.blocksReady; }) ||
    issues.some(function (s) { return s.blocksReady; });
  var review = issues.some(function (s) { return s.review; });
  var status = blocked ? "BLOCKED" : (review ? "REVIEW_REQUIRED" : "READY");

  return {
    conflicts: conflicts,
    tails: tails,
    issues: issues,
    voiceEndMs: voiceEndMs,
    musicEndMs: musicEndMs,
    sfxEndMs: sfxEndMs,
    actualEndMs: actualEndMs,
    status: status,
    blocksReady: blocked
  };
}

function reconcileSceneVoice(opts) {
  opts = opts || {};
  var scenePlannedEndMs = toNum(opts.scenePlannedEndMs, 0);
  var voiceEndMs = toNum(opts.voiceEndMs, 0);
  var sceneId = opts.sceneId || null;
  if (voiceEndMs <= scenePlannedEndMs) {
    var decision = voiceEndMs === scenePlannedEndMs ? "OK" : "VISUAL_HOLD_ACCEPTED";
    // If exactly equal OK; if voice shorter, visual hold accepted (visual dwells).
    return { decision: decision, sceneId: sceneId, scenePlannedEndMs: scenePlannedEndMs, voiceEndMs: voiceEndMs, overMs: 0 };
  }
  return {
    decision: "RECONCILE_REQUIRED",
    sceneId: sceneId,
    scenePlannedEndMs: scenePlannedEndMs,
    voiceEndMs: voiceEndMs,
    overMs: voiceEndMs - scenePlannedEndMs,
    options: ["extend-visual-dwell", "additional-valid-visual", "shorten-planned-pause", "revise-script", "regenerate-voice", "split-scene"]
  };
}

function proposePlaybackRate(opts) {
  opts = opts || {};
  if (opts.explicit !== true) {
    return { accepted: false, reason: "EXPLICIT_REQUIRED — playbackRate never auto-applied" };
  }
  var rate = opts.rate !== undefined ? opts.rate : opts.playbackRate;
  if (typeof rate !== "number" || !isFinite(rate)) {
    return { accepted: false, reason: "INVALID_RATE — rate must be a number" };
  }
  if (rate < 0.9 || rate > 1.1) {
    return { accepted: false, reason: "OUT_OF_RANGE — rate must be within [0.9,1.1]" };
  }
  return { accepted: true, rate: rate, current: opts.current, endMs: opts.endMs, targetMs: opts.targetMs };
}

function buildMeasuredTimeline(opts) {
  opts = opts || {};
  var projectId = opts.projectId || "unknown";
  function v(k) {
    var n = opts[k];
    return (typeof n === "number" && isFinite(n) && n >= 0) ? n : 0;
  }
  var voiceEndMs = v("voiceEndMs");
  var visualPlannedEndMs = v("visualPlannedEndMs");
  var captionEndMs = v("captionEndMs");
  var musicEndMs = v("musicEndMs");
  var sfxEndMs = v("sfxEndMs");
  var intentionalOutroEndMs = v("intentionalOutroEndMs");
  var sources = Array.isArray(opts.sources) ? opts.sources : [];
  // target NEVER included in max
  var actualTimelineEndMs = Math.max(voiceEndMs, visualPlannedEndMs, captionEndMs, musicEndMs, sfxEndMs, intentionalOutroEndMs);

  var status = "MEASURED";
  var notes = [];
  var out = {
    version: "1.0.0",
    projectId: projectId,
    voiceEndMs: voiceEndMs,
    visualPlannedEndMs: visualPlannedEndMs,
    captionEndMs: captionEndMs,
    musicEndMs: musicEndMs,
    sfxEndMs: sfxEndMs,
    intentionalOutroEndMs: intentionalOutroEndMs,
    actualTimelineEndMs: actualTimelineEndMs,
    sources: sources,
    status: status,
    generatedAt: new Date().toISOString()
  };
  if (opts.durationTargetMs !== undefined && opts.durationTargetMs !== null) {
    out.targetMsReference = opts.durationTargetMs;
    out.note = "target never pads timeline";
    notes.push("target never pads timeline");
  }
  var blackTail = sources.some(function (s) {
    return typeof s === "string" && (s.indexOf("black-tail") !== -1 || s.indexOf("pad-to-target") !== -1);
  });
  if (blackTail) {
    out.status = "REVIEW_REQUIRED";
    out.issues = [{ kind: "BLACK_TAIL_REJECTED", detail: "Black-tail / pad-to-target source rejected", blocksReady: true }];
  }
  if (notes.length) out.notes = notes;
  return out;
}

module.exports = {
  buildAudioTimeline: buildAudioTimeline,
  reconcileSceneVoice: reconcileSceneVoice,
  proposePlaybackRate: proposePlaybackRate,
  buildMeasuredTimeline: buildMeasuredTimeline
};
